// Writer-agnostic guarded update session (bob-cli-lt category-new).
// Preview is keyed by revision, expect, and vault generation; Apply runs
// only after a matching successful preview; open editors save first and a
// generation move re-previews; inverse-op Undo is staged, not reconstructed.
// Album and bank sessions are thin wrappers over this controller.
const GUARDED_UPDATE_PREVIEW_DEBOUNCE_MS = 250;

function guardedUpdateJsonObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function guardedUpdateCopy(overrides = {}) {
  return {
    previewEmpty: "There is nothing to preview.",
    previewFailed: "The update preview failed.",
    previewRefused: "The update preview was refused.",
    applyFailed: "The update apply failed.",
    applyRefused: "The update apply was refused.",
    stalePreview: "The vault changed while this preview was running.",
    stalePreviewHint: "Refresh and preview the retained draft against the current fingerprint.",
    staleGeneration: "The vault changed under this preview.",
    staleGenerationHint: "Preview again before applying; nothing was written.",
    saveUnsupported: "Open editors could not confirm they are saved.",
    saveUnsupportedHint: "Save every pane showing the file in Source mode, then preview again. Nothing was written.",
    saveFailedHint: "Apply is refused until every pane showing the file saves. Nothing was written.",
    supersededDuringSave: "The draft changed while panes were saving; preview the current draft before applying.",
    saveInvalidated: "Saving changed the vault; preview again before applying.",
    nothingToUndo: "There is no edit to undo.",
    syncWarningHint: "The edit is committed and Undo is available. Retry sync with `bob vault-sync` only.",
    retryHint: "Retry `bob vault-sync` later. The committed edit and Undo are kept.",
    ...overrides,
  };
}

function createGuardedUpdateSession(init = {}, deps = {}) {
  const identity = String(init.identity || "");
  const ownPath = typeof init.ownPath === "string" ? init.ownPath : identity;
  const extras = guardedUpdateJsonObject(init.snapshotExtras) ? init.snapshotExtras : {};
  const copy = guardedUpdateCopy(init.copy);
  const debounceMs = Number.isFinite(init.debounceMs) && init.debounceMs >= 0
    ? init.debounceMs
    : GUARDED_UPDATE_PREVIEW_DEBOUNCE_MS;
  const buildEnvelope = typeof init.buildEnvelope === "function"
    ? init.buildEnvelope
    : (expect, ops) => JSON.stringify({ schema_version: 1, expect: String(expect), ops: Array.isArray(ops) ? ops : [] });
  const isStaleCode = typeof init.isStaleCode === "function"
    ? init.isStaleCode
    : () => false;
  const failureFromReport = typeof init.failureFromReport === "function"
    ? init.failureFromReport
    : (report) => {
      if (guardedUpdateJsonObject(report) && guardedUpdateJsonObject(report.error)) return report.error;
      if (guardedUpdateJsonObject(report) && guardedUpdateJsonObject(report.failure)) return report.failure;
      return {};
    };
  const timers = deps.timers || null;
  const session = {
    epoch: 1,
    closed: false,
    status: "browsing",
    revision: 0,
    draftOps: [],
    expect: typeof init.expect === "string" ? init.expect : "",
    preview: null,
    refusal: null,
    syncWarning: null,
    undo: null,
    applyPromise: null,
    previewTimer: null,
    previewFlight: null,
  };
  try {
    const seed = init && init.undo;
    if (seed && Array.isArray(seed.inverseOps) && seed.inverseOps.length > 0) {
      session.undo = {
        inverseOps: seed.inverseOps.map((op) => (op && typeof op === "object" ? { ...op } : op)),
        afterFingerprint: typeof seed.afterFingerprint === "string" ? seed.afterFingerprint : "",
      };
    }
  } catch (_) {}

  function setTimeout(callback, delay) {
    if (timers && typeof timers.setTimeout === "function") {
      return timers.setTimeout(callback, delay);
    }
    return globalThis.setTimeout(callback, delay);
  }

  function clearTimeout(timer) {
    if (timer === null || timer === undefined) {
      return;
    }
    if (timers && typeof timers.clearTimeout === "function") {
      timers.clearTimeout(timer);
      return;
    }
    globalThis.clearTimeout(timer);
  }

  function notify() {
    try {
      if (typeof deps.onChange === "function") {
        deps.onChange(snapshot());
      }
    } catch (error) {
      // State notification never breaks the session.
    }
  }

  function vaultGeneration() {
    try {
      const generation = typeof deps.getGeneration === "function" ? deps.getGeneration() : 0;
      return Number.isInteger(generation) ? generation : 0;
    } catch (error) {
      return 0;
    }
  }

  function previewMatchesCurrent(preview) {
    return Boolean(preview) &&
      preview.epoch === session.epoch &&
      preview.revision === session.revision &&
      preview.identity === identity &&
      preview.expect === session.expect &&
      preview.generation === vaultGeneration();
  }

  function canApply() {
    return session.status === "preview-ready" &&
      !session.closed &&
      !session.applyPromise &&
      previewMatchesCurrent(session.preview) &&
      Boolean(session.preview && session.preview.report && session.preview.report.ok === true);
  }

  function snapshot() {
    const previewReport = session.preview && session.preview.report ? session.preview.report : null;
    return {
      status: session.status,
      identity,
      ownPath,
      revision: session.revision,
      expect: session.expect,
      draftOps: session.draftOps.slice(),
      canApply: canApply(),
      busy: session.status === "preview-pending" || session.status === "applying",
      consequence: previewReport && session.status === "preview-ready"
        ? String(previewReport.consequence || "")
        : "",
      preview: previewReport,
      refusal: session.refusal ? { ...session.refusal } : null,
      undoAvailable: Boolean(session.undo && Array.isArray(session.undo.inverseOps) && session.undo.inverseOps.length > 0),
      syncWarning: session.syncWarning ? { ...session.syncWarning } : null,
      ...extras,
    };
  }

  function clearPreviewTimer() {
    clearTimeout(session.previewTimer);
    session.previewTimer = null;
  }

  function schedulePreview(immediate) {
    if (session.closed || session.draftOps.length === 0) {
      return;
    }
    clearPreviewTimer();
    if (immediate === true) {
      void requestPreview();
      return;
    }
    session.status = "preview-pending";
    session.refusal = null;
    notify();
    session.previewTimer = setTimeout(() => {
      session.previewTimer = null;
      if (!session.closed) {
        void requestPreview();
      }
    }, debounceMs);
  }

  function refusalFromFailure(kind, failure, fallbackMessage) {
    const code = typeof failure.code === "string" ? failure.code : "refused";
    return {
      kind: isStaleCode(code) ? "stale" : kind,
      code,
      message: typeof failure.message === "string" ? failure.message : fallbackMessage,
      hint: failure.hint == null ? "" : String(failure.hint),
      opIndex: failure.op_index == null ? null : failure.op_index,
      field: failure.field == null ? null : String(failure.field),
      choice: failure.choice == null ? null : String(failure.choice),
      path: failure.path == null ? null : String(failure.path),
      line: failure.line == null ? null : failure.line,
      keyPath: failure.key_path == null ? null : String(failure.key_path),
      affected: failure.affected == null ? null : failure.affected,
    };
  }

  async function requestPreview() {
    if (session.closed || session.draftOps.length === 0) {
      return { ok: false, code: "empty-draft", message: copy.previewEmpty };
    }
    const revision = session.revision;
    const epoch = session.epoch;
    const expect = session.expect;
    const generation = vaultGeneration();
    const envelopeText = buildEnvelope(expect, session.draftOps);
    session.status = "preview-pending";
    session.refusal = null;
    notify();
    let outcome;
    try {
      outcome = await deps.spawnPreview(identity, envelopeText);
    } catch (error) {
      outcome = {
        ok: false,
        code: "failed",
        message: error && error.message ? String(error.message) : copy.previewFailed,
      };
    }
    if (session.closed || session.epoch !== epoch || session.revision !== revision) {
      return { ok: false, code: "superseded", message: "A newer draft superseded this preview." };
    }
    session.previewFlight = null;
    if (generation !== vaultGeneration()) {
      session.preview = null;
      session.status = "refused";
      session.refusal = {
        kind: "stale",
        code: "stale_generation",
        message: copy.stalePreview,
        hint: copy.stalePreviewHint,
      };
      notify();
      return { ok: false, ...session.refusal };
    }
    if (!outcome || outcome.ok !== true || !outcome.report) {
      session.preview = null;
      session.status = "refused";
      session.refusal = {
        kind: outcome && outcome.code === "timeout" ? "timeout-unknown" : "transport",
        code: (outcome && outcome.code) || "failed",
        message: (outcome && outcome.message) || copy.previewFailed,
        hint: outcome && (outcome.detail || outcome.hint)
          ? String(outcome.detail || outcome.hint)
          : "Nothing was written. Refresh and preview again.",
      };
      notify();
      return { ok: false, ...session.refusal };
    }
    const report = outcome.report;
    if (report.ok !== true) {
      const failure = failureFromReport(report);
      session.preview = null;
      session.status = "refused";
      session.refusal = refusalFromFailure("refused", failure, copy.previewRefused);
      notify();
      return { ok: false, ...session.refusal };
    }
    session.preview = { epoch, revision, identity, expect, generation, envelopeText, report };
    session.status = "preview-ready";
    session.refusal = null;
    notify();
    return { ok: true, report };
  }

  function setDraft(ops) {
    if (session.closed) {
      return snapshot();
    }
    const next = Array.isArray(ops) ? ops.slice() : [];
    session.revision += 1;
    session.draftOps = next;
    session.preview = null;
    if (next.length === 0) {
      session.status = session.syncWarning ? "saved-with-sync-warning" : "browsing";
      session.refusal = null;
      clearPreviewTimer();
      notify();
      return snapshot();
    }
    // A change to the draft invalidates Apply eligibility immediately;
    // the debounced preview re-arms it only for the new revision.
    session.status = "draft";
    session.refusal = null;
    notify();
    schedulePreview(false);
    return snapshot();
  }

  function noteGenerationChanged() {
    if (session.closed) {
      return snapshot();
    }
    if (session.status === "preview-ready" && !previewMatchesCurrent(session.preview)) {
      session.preview = null;
      session.status = "refused";
      session.refusal = {
        kind: "stale",
        code: "stale_generation",
        message: copy.staleGeneration,
        hint: copy.staleGenerationHint,
      };
      notify();
    }
    return snapshot();
  }

  function rebase(expect) {
    if (session.closed) return snapshot();
    session.expect = typeof expect === "string" ? expect : "";
    session.revision += 1;
    session.preview = null;
    session.refusal = null;
    session.status = session.draftOps.length ? "draft" : (session.syncWarning ? "saved-with-sync-warning" : "browsing");
    clearPreviewTimer();
    notify();
    return snapshot();
  }

  async function apply() {
    if (session.closed) {
      return { ok: false, code: "closed", message: "The edit session is closed." };
    }
    if (session.applyPromise) {
      return session.applyPromise;
    }
    if (!canApply()) {
      return { ok: false, code: "not-previewed", message: "Enter is inert until a current preview succeeds." };
    }
    const preview = session.preview;
    const epoch = session.epoch;
    const run = (async () => {
      session.status = "applying";
      notify();
      if (typeof deps.saveEditors !== "function") {
        session.status = "refused";
        session.refusal = {
          kind: "save",
          code: "save-unsupported",
          message: copy.saveUnsupported,
          hint: copy.saveUnsupportedHint,
        };
        notify();
        return { ok: false, ...session.refusal };
      }
      let saved;
      try {
        saved = await deps.saveEditors([ownPath]);
      } catch (error) {
        saved = { ok: false, message: error && error.message ? String(error.message) : "Saving failed." };
      }
      if (session.closed || session.epoch !== epoch) {
        return { ok: false, code: "superseded", message: "The session closed during save." };
      }
      if (!saved || saved.ok !== true) {
        session.preview = null;
        session.status = "refused";
        session.refusal = {
          kind: "save",
          code: (saved && saved.code) || "save-failed",
          message: (saved && saved.message) || "Saving the open editors failed.",
          hint: copy.saveFailedHint,
        };
        notify();
        return { ok: false, ...session.refusal };
      }
      if (session.revision !== preview.revision ||
          (session.preview !== preview && vaultGeneration() === preview.generation) ||
          session.expect !== preview.expect || session.epoch !== preview.epoch) {
        return { ok: false, code: "superseded-during-save", message: copy.supersededDuringSave };
      }
      if (vaultGeneration() !== preview.generation || !previewMatchesCurrent(preview)) {
        session.preview = null;
        session.status = "preview-pending";
        notify();
        await requestPreview();
        return { ok: false, code: "save-invalidated", message: copy.saveInvalidated };
      }
      let outcome;
      try {
        outcome = await deps.spawnApply(identity, preview.envelopeText, { ownPath });
      } catch (error) {
        outcome = {
          ok: false,
          code: "failed",
          message: error && error.message ? String(error.message) : copy.applyFailed,
        };
      }
      if (session.closed || session.epoch !== epoch || session.revision !== preview.revision) {
        return { ok: false, code: "superseded", message: "A newer session superseded this apply." };
      }
      if (!outcome || outcome.ok !== true || !outcome.report) {
        session.preview = null;
        session.status = "refused";
        const unknown = Boolean(outcome && (outcome.code === "timeout" || outcome.unknown === true));
        session.refusal = {
          kind: unknown ? "timeout-unknown" : "transport",
          code: (outcome && outcome.code) || "failed",
          message: (outcome && outcome.message) || copy.applyFailed,
          hint: unknown
            ? "The outcome is unknown: refresh and explicitly reconcile before retrying. Never blind-retry."
            : "Nothing was written. Refresh and preview again.",
        };
        notify();
        return { ok: false, ...session.refusal };
      }
      const report = outcome.report;
      if (report.ok !== true) {
        const failure = failureFromReport(report);
        session.preview = null;
        session.status = "refused";
        session.refusal = refusalFromFailure("refused", failure, copy.applyRefused);
        notify();
        return { ok: false, ...session.refusal };
      }
      if (report.changed !== true) {
        session.revision += 1;
        session.draftOps = [];
        session.preview = null;
        session.refusal = null;
        session.status = session.syncWarning ? "saved-with-sync-warning" : "browsing";
        notify();
        return { ok: true, changed: false, report, refreshed: outcome.refreshed || null };
      }
      session.expect = String(report.after_fingerprint || session.expect);
      session.undo = {
        inverseOps: Array.isArray(report.inverse_ops) ? report.inverse_ops : [],
        afterFingerprint: String(report.after_fingerprint || ""),
      };
      session.revision += 1;
      session.draftOps = [];
      session.preview = null;
      session.refusal = null;
      const postSyncFailed = Boolean(
        (report.sync && report.sync.post === "failed") ||
        (Array.isArray(report.warnings) && report.warnings.some((warning) => /saved locally/i.test(String(warning)))),
      );
      if (postSyncFailed) {
        session.syncWarning = {
          message: "Saved locally; sync failed.",
          hint: copy.syncWarningHint,
        };
        session.status = "saved-with-sync-warning";
      } else {
        session.syncWarning = null;
        session.status = "browsing";
      }
      notify();
      return { ok: true, changed: true, report, refreshed: outcome.refreshed || null };
    })();
    session.applyPromise = run;
    try {
      return await run;
    } finally {
      if (session.applyPromise === run) {
        session.applyPromise = null;
      }
      if (!session.closed && session.status === "applying") {
        session.status = "draft";
        notify();
      }
    }
  }

  function stageUndo() {
    if (session.closed) {
      return { ok: false, code: "closed", message: "The edit session is closed." };
    }
    if (!session.undo || !Array.isArray(session.undo.inverseOps) || session.undo.inverseOps.length === 0) {
      return { ok: false, code: "nothing-to-undo", message: copy.nothingToUndo };
    }
    if (session.undo.afterFingerprint) session.expect = session.undo.afterFingerprint;
    setDraft(session.undo.inverseOps.map((op) => ({ ...op })));
    return { ok: true, revision: session.revision };
  }

  async function retrySync() {
    if (session.closed) {
      return { ok: false, code: "closed", message: "The edit session is closed." };
    }
    if (session.status !== "saved-with-sync-warning") {
      return { ok: false, code: "nothing-to-retry", message: "There is no failed sync to retry." };
    }
    if (typeof deps.spawnVaultSync !== "function") {
      return { ok: false, code: "sync-unsupported", message: "Sync retry is unavailable here." };
    }
    let outcome;
    try {
      outcome = await deps.spawnVaultSync();
    } catch (error) {
      outcome = { ok: false, code: "failed", message: error && error.message ? String(error.message) : "Sync retry failed." };
    }
    if (session.closed) {
      return { ok: false, code: "closed", message: "The edit session is closed." };
    }
    if (outcome && outcome.ok === true) {
      session.syncWarning = null;
      session.status = "browsing";
      notify();
      return { ok: true };
    }
    session.syncWarning = {
      message: "Saved locally; sync failed.",
      hint: (outcome && (outcome.detail || outcome.message)) || copy.retryHint,
    };
    notify();
    return { ok: false, code: (outcome && outcome.code) || "sync-failed", message: session.syncWarning.hint };
  }

  function close() {
    session.epoch += 1;
    session.closed = true;
    clearPreviewTimer();
    session.previewFlight = null;
  }

  return {
    setDraft,
    previewNow: () => {
      clearPreviewTimer();
      return requestPreview();
    },
    apply,
    stageUndo,
    retrySync,
    noteGenerationChanged,
    rebase,
    close,
    getState: snapshot,
  };
}
