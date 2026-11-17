// Writer-agnostic guarded update session (bob-cli-lt category-new).
// Preview is keyed by revision, expect, and vault generation; Apply runs
// only after a matching successful preview; open editors save first and a
// generation move re-previews; inverse-op Undo is staged, not reconstructed.
// Album and bank sessions are thin wrappers over this controller.
const GUARDED_UPDATE_PREVIEW_DEBOUNCE_MS = 250;
const GUARDED_UPDATE_LOCK_RETRY_MS = 1000;
const GUARDED_UPDATE_LOCK_WAIT_BUDGET_MS = 10 * 60 * 1000;
const GUARDED_UPDATE_LOCK_TICKER_MS = 1000;
const GUARDED_UPDATE_LOCK_WAIT_HINT = "Nothing was written. Press Enter to try again.";

function guardedUpdateJsonObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function guardedUpdateReportLockBusy(report) {
  if (!guardedUpdateJsonObject(report) || report.ok === true) return false;
  const failure = guardedUpdateJsonObject(report.error)
    ? report.error
    : (guardedUpdateJsonObject(report.failure) ? report.failure : null);
  return Boolean(failure && failure.code === "lock_busy");
}

function guardedUpdateReportChanged(report) {
  if (!guardedUpdateJsonObject(report)) return false;
  if (report.changed === true) return true;
  return Array.isArray(report.changed) && report.changed.length > 0;
}

function guardedUpdateAfterFingerprint(report, fallback) {
  if (guardedUpdateJsonObject(report)) {
    if (typeof report.after_fingerprint === "string" && report.after_fingerprint) {
      return report.after_fingerprint;
    }
    if (typeof report.fingerprint_after === "string" && report.fingerprint_after) {
      return report.fingerprint_after;
    }
  }
  return typeof fallback === "string" ? fallback : "";
}

function guardedUpdateIsLockBusy(outcome, failureFromReport) {
  if (!outcome || outcome.ok !== true || !outcome.report || outcome.report.ok === true) {
    return false;
  }
  if (typeof failureFromReport === "function") {
    try {
      const failure = failureFromReport(outcome.report);
      if (failure && failure.code === "lock_busy") return true;
    } catch (_) {}
  }
  return guardedUpdateReportLockBusy(outcome.report);
}

function guardedUpdateSameConsequence(left, right) {
  if (!guardedUpdateJsonObject(left) || !guardedUpdateJsonObject(right)) return false;
  if (String(left.consequence || "") !== String(right.consequence || "")) return false;
  const keysOf = (report) => {
    const derived = Array.isArray(report.derived_keys)
      ? report.derived_keys.filter((key) => typeof key === "string" && key)
      : [];
    const perOp = (Array.isArray(report.per_op) ? report.per_op : [])
      .map((op) => op && op.derived_key)
      .filter((key) => typeof key === "string" && key);
    return [...new Set(derived.concat(perOp))].join("\0");
  };
  if (keysOf(left) !== keysOf(right)) return false;
  const opsOf = (report) => (Array.isArray(report.per_op) ? report.per_op : []).map((op) => ({
    summary: op && op.summary != null ? String(op.summary) : "",
    outcome: op && op.outcome != null ? String(op.outcome) : "",
    filled: Number.isInteger(op && op.filled) ? op.filled : null,
    count: Number.isInteger(op && op.count) ? op.count : null,
    newly_invalid: Number.isInteger(op && op.newly_invalid) ? op.newly_invalid : null,
  }));
  if (JSON.stringify(opsOf(left)) !== JSON.stringify(opsOf(right))) return false;
  const tally = (report, field) => {
    if (Number.isInteger(report[field])) return report[field];
    return (Array.isArray(report.per_op) ? report.per_op : []).reduce((sum, op) => {
      const value = op && op[field];
      return sum + (Number.isInteger(value) ? value : 0);
    }, 0);
  };
  return tally(left, "affected") === tally(right, "affected")
    && tally(left, "count") === tally(right, "count")
    && tally(left, "newly_invalid") === tally(right, "newly_invalid");
}

function guardedUpdateLockWaitText(lockWait) {
  if (!lockWait) return "";
  if (lockWait.stopping) return "Stopping after the current attempt…";
  const elapsed = Number(lockWait.elapsedMs);
  const seconds = Math.max(0, Math.floor((Number.isFinite(elapsed) ? elapsed : 0) / 1000));
  return `Waiting for another Bob vault maintenance run… ${seconds}s · saves when it finishes · Esc stops waiting`;
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
    lockWaitStopped: "Stopped waiting for another Bob vault maintenance run.",
    lockWaitBudget: "Gave up waiting for another Bob vault maintenance run after 10 minutes.",
    lockWaitHint: GUARDED_UPDATE_LOCK_WAIT_HINT,
    ...overrides,
  };
}

function createGuardedUpdateSession(init = {}, deps = {}) {
  const identity = String(init.identity || "");
  const ownPath = typeof init.ownPath === "string" ? init.ownPath : identity;
  const savePaths = Array.isArray(init.savePaths) && init.savePaths.length
    ? init.savePaths.map((path) => String(path || "")).filter(Boolean)
    : [ownPath];
  const allowDirectApply = init.allowDirectApply === true;
  const extras = guardedUpdateJsonObject(init.snapshotExtras) ? init.snapshotExtras : {};
  const copy = guardedUpdateCopy(init.copy);
  const debounceMs = Number.isFinite(init.debounceMs) && init.debounceMs >= 0
    ? init.debounceMs
    : GUARDED_UPDATE_PREVIEW_DEBOUNCE_MS;
  const lockRetryMs = Number.isFinite(init.lockRetryMs) && init.lockRetryMs >= 0
    ? init.lockRetryMs
    : GUARDED_UPDATE_LOCK_RETRY_MS;
  const lockWaitBudgetMs = Number.isFinite(init.lockWaitBudgetMs) && init.lockWaitBudgetMs >= 0
    ? init.lockWaitBudgetMs
    : GUARDED_UPDATE_LOCK_WAIT_BUDGET_MS;
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
    lockWait: null,
    lockNotice: null,
    lockRetryTimer: null,
    lockRetryResolve: null,
    lockTickerTimer: null,
    lockAttemptInFlight: false,
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

  function nowMs() {
    if (timers && typeof timers.now === "number" && Number.isFinite(timers.now)) {
      return timers.now;
    }
    if (timers && typeof timers.now === "function") {
      try {
        const value = Number(timers.now());
        if (Number.isFinite(value)) return value;
      } catch (_) {}
    }
    return Date.now();
  }

  function clearLockRetryWait(reason) {
    const resolve = session.lockRetryResolve;
    session.lockRetryResolve = null;
    clearTimeout(session.lockRetryTimer);
    session.lockRetryTimer = null;
    if (typeof resolve === "function") {
      resolve(reason || "cleared");
    }
  }

  function clearLockTicker() {
    clearTimeout(session.lockTickerTimer);
    session.lockTickerTimer = null;
  }

  function dropLockWait(reason) {
    clearLockTicker();
    clearLockRetryWait(reason);
    session.lockWait = null;
    session.lockAttemptInFlight = false;
  }

  function startLockTicker() {
    clearLockTicker();
    const tick = () => {
      session.lockTickerTimer = null;
      if (session.closed || !session.lockWait) return;
      notify();
      session.lockTickerTimer = setTimeout(tick, GUARDED_UPDATE_LOCK_TICKER_MS);
    };
    session.lockTickerTimer = setTimeout(tick, GUARDED_UPDATE_LOCK_TICKER_MS);
  }

  function waitForRetry() {
    return new Promise((resolve) => {
      session.lockRetryResolve = resolve;
      session.lockRetryTimer = setTimeout(() => {
        session.lockRetryTimer = null;
        session.lockRetryResolve = null;
        resolve("timeout");
      }, lockRetryMs);
    });
  }

  function lockWaitSnapshot() {
    if (!session.lockWait) return null;
    return {
      since: session.lockWait.since,
      elapsedMs: Math.max(0, nowMs() - session.lockWait.since),
      attempts: session.lockWait.attempts,
      stopping: session.lockWait.stopping === true,
    };
  }

  function finishLockWaitWithoutWrite(reason) {
    const bobMessage = session.lockWait && typeof session.lockWait.message === "string"
      ? session.lockWait.message
      : "";
    const message = reason === "budget"
      ? (copy.lockWaitBudget || bobMessage)
      : (copy.lockWaitStopped || bobMessage || "Stopped waiting for another Bob vault maintenance run.");
    dropLockWait(reason);
    session.lockNotice = {
      message,
      hint: copy.lockWaitHint || GUARDED_UPDATE_LOCK_WAIT_HINT,
    };
    session.status = "preview-ready";
    session.refusal = null;
    notify();
    return {
      ok: false,
      code: reason === "budget" ? "lock-wait-budget" : "lock-wait-stopped",
      message,
      hint: session.lockNotice.hint,
    };
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
      busy: session.status === "preview-pending" || session.status === "applying" || Boolean(session.lockWait),
      consequence: previewReport && (session.status === "preview-ready" || session.lockWait)
        ? String(previewReport.consequence || "")
        : "",
      preview: previewReport,
      lockWait: lockWaitSnapshot(),
      lockNotice: session.lockNotice ? { ...session.lockNotice } : null,
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
    dropLockWait("superseded");
    session.lockNotice = null;
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
    dropLockWait("superseded");
    session.lockNotice = null;
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
      session.lockNotice = null;
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
        saved = await deps.saveEditors(savePaths.slice());
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
      let captured = preview;
      let attempts = 0;
      for (;;) {
        if (session.closed || session.epoch !== epoch || session.revision !== captured.revision) {
          dropLockWait("superseded");
          return { ok: false, code: "superseded", message: "A newer session superseded this apply." };
        }
        if (session.lockWait && session.lockWait.stopping) {
          return finishLockWaitWithoutWrite("stopped");
        }
        if (session.lockWait && nowMs() - session.lockWait.since >= lockWaitBudgetMs) {
          return finishLockWaitWithoutWrite("budget");
        }
        if (session.lockWait && vaultGeneration() !== captured.generation) {
          session.lockAttemptInFlight = true;
          let dry;
          try {
            dry = await deps.spawnPreview(identity, captured.envelopeText);
          } catch (error) {
            dry = {
              ok: false,
              code: "failed",
              message: error && error.message ? String(error.message) : copy.previewFailed,
            };
          }
          session.lockAttemptInFlight = false;
          if (session.closed || session.epoch !== epoch || session.revision !== captured.revision) {
            dropLockWait("superseded");
            return { ok: false, code: "superseded", message: "A newer session superseded this apply." };
          }
          if (session.lockWait && session.lockWait.stopping) {
            return finishLockWaitWithoutWrite("stopped");
          }
          const dryReport = dry && dry.ok === true && dry.report && dry.report.ok === true ? dry.report : null;
          if (dryReport && guardedUpdateSameConsequence(captured.report, dryReport)) {
            captured = {
              ...captured,
              generation: vaultGeneration(),
              report: dryReport,
            };
            session.preview = captured;
            notify();
          } else {
            dropLockWait();
            session.lockNotice = null;
            if (dryReport) {
              session.preview = {
                epoch,
                revision: captured.revision,
                identity,
                expect: captured.expect,
                generation: vaultGeneration(),
                envelopeText: captured.envelopeText,
                report: dryReport,
              };
              session.status = "preview-ready";
              session.refusal = null;
              notify();
              return { ok: false, code: "save-invalidated", message: copy.saveInvalidated };
            }
            if (!dry || dry.ok !== true || !dry.report) {
              session.preview = null;
              session.status = "refused";
              session.refusal = {
                kind: dry && dry.code === "timeout" ? "timeout-unknown" : "transport",
                code: (dry && dry.code) || "failed",
                message: (dry && dry.message) || copy.previewFailed,
                hint: copy.saveInvalidated,
              };
              notify();
              return { ok: false, code: "save-invalidated", message: copy.saveInvalidated };
            }
            const failure = failureFromReport(dry.report);
            session.preview = null;
            session.status = "refused";
            session.refusal = refusalFromFailure("refused", failure, copy.previewRefused);
            notify();
            return { ok: false, code: "save-invalidated", message: copy.saveInvalidated };
          }
        }
        attempts += 1;
        if (session.lockWait) {
          session.lockWait.attempts = attempts;
        }
        session.lockAttemptInFlight = true;
        notify();
        let outcome;
        try {
          outcome = await deps.spawnApply(identity, captured.envelopeText, { ownPath });
        } catch (error) {
          outcome = {
            ok: false,
            code: "failed",
            message: error && error.message ? String(error.message) : copy.applyFailed,
          };
        }
        session.lockAttemptInFlight = false;
        if (session.closed || session.epoch !== epoch || session.revision !== captured.revision) {
          dropLockWait("superseded");
          return { ok: false, code: "superseded", message: "A newer session superseded this apply." };
        }
        if (guardedUpdateIsLockBusy(outcome, failureFromReport)) {
          const failure = failureFromReport(outcome.report) || {};
          if (!session.lockWait) {
            session.lockWait = {
              since: nowMs(),
              attempts,
              message: typeof failure.message === "string" && failure.message
                ? failure.message
                : "another Bob vault maintenance run is already active",
              stopping: false,
            };
            startLockTicker();
          } else {
            session.lockWait.attempts = attempts;
            if (typeof failure.message === "string" && failure.message) {
              session.lockWait.message = failure.message;
            }
          }
          if (session.lockWait.stopping) {
            return finishLockWaitWithoutWrite("stopped");
          }
          if (nowMs() - session.lockWait.since >= lockWaitBudgetMs) {
            return finishLockWaitWithoutWrite("budget");
          }
          notify();
          const waitReason = await waitForRetry();
          if (!session.lockWait) {
            if (session.lockNotice) {
              return {
                ok: false,
                code: waitReason === "budget" ? "lock-wait-budget" : "lock-wait-stopped",
                message: session.lockNotice.message,
                hint: session.lockNotice.hint,
              };
            }
            return { ok: false, code: "superseded", message: "A newer session superseded this apply." };
          }
          continue;
        }
        dropLockWait();
        session.lockNotice = null;
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
          return { ok: false, ...session.refusal, report };
        }
        if (!guardedUpdateReportChanged(report)) {
          session.revision += 1;
          session.draftOps = [];
          session.preview = null;
          session.refusal = null;
          session.status = session.syncWarning ? "saved-with-sync-warning" : "browsing";
          notify();
          return { ok: true, changed: false, report, refreshed: outcome.refreshed || null };
        }
        const afterFingerprint = guardedUpdateAfterFingerprint(report, session.expect);
        session.expect = afterFingerprint;
        session.undo = {
          inverseOps: Array.isArray(report.inverse_ops) ? report.inverse_ops : [],
          afterFingerprint,
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
      }
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
      } else if (!session.closed && session.lockNotice && session.status === "preview-ready") {
        notify();
      }
    }
  }

  async function applyOps(ops) {
    if (allowDirectApply !== true) {
      return {
        ok: false,
        code: "direct-apply-disabled",
        message: "This session applies only after a current preview.",
      };
    }
    if (session.closed) {
      return { ok: false, code: "closed", message: "The edit session is closed." };
    }
    if (session.applyPromise) {
      return session.applyPromise;
    }
    const next = Array.isArray(ops) ? ops.slice() : [];
    if (!next.length) {
      return { ok: false, code: "empty-ops", message: copy.previewEmpty };
    }
    dropLockWait("direct-apply");
    session.lockNotice = null;
    session.revision += 1;
    session.draftOps = next;
    session.refusal = null;
    const expect = session.expect;
    const generation = vaultGeneration();
    session.preview = {
      epoch: session.epoch,
      revision: session.revision,
      identity,
      expect,
      generation,
      envelopeText: buildEnvelope(expect, next),
      report: { ok: true, consequence: "", changed: true },
    };
    session.status = "preview-ready";
    notify();
    return apply();
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
    dropLockWait("closed");
    session.previewFlight = null;
  }

  function stopWaiting() {
    if (session.closed || !session.lockWait) {
      return snapshot();
    }
    session.lockWait.stopping = true;
    clearLockTicker();
    clearLockRetryWait("stopped");
    if (!session.lockAttemptInFlight) {
      return finishLockWaitWithoutWrite("stopped"), snapshot();
    }
    notify();
    return snapshot();
  }

  return {
    setDraft,
    previewNow: () => {
      clearPreviewTimer();
      return requestPreview();
    },
    apply,
    applyOps,
    stopWaiting,
    stageUndo,
    retrySync,
    noteGenerationChanged,
    rebase,
    close,
    getState: snapshot,
  };
}
