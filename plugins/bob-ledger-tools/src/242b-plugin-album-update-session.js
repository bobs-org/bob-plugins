// Album schema update session: a DOM-independent, dependency-injected
// edit session over one album. The visible card stays read-only until a
// later phase wires it; this controller owns draft revisions, the typing
// debounce, exact-envelope apply gating, editor-save ordering, Undo
// availability, and sync-only recovery. Every response is keyed by
// session epoch, draft revision, album identity, fingerprint, and vault
// generation; superseded responses are ignored.
function createAlbumUpdateSession(init = {}, deps = {}) {
  const stem = String(init.stem || "");
  const albumPath = albumReportPath(init.albumPath || `${stem}.md`);
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
      preview.stem === stem &&
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
      stem,
      albumPath,
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
    }, ALBUM_UPDATE_PREVIEW_DEBOUNCE_MS);
  }

  async function requestPreview() {
    if (session.closed || session.draftOps.length === 0) {
      return { ok: false, code: "empty-draft", message: "There is nothing to preview." };
    }
    const revision = session.revision;
    const epoch = session.epoch;
    const expect = session.expect;
    const generation = vaultGeneration();
    const envelopeText = albumUpdateEnvelopeText(expect, session.draftOps);
    session.status = "preview-pending";
    session.refusal = null;
    notify();
    let outcome;
    try {
      outcome = await deps.spawnPreview(stem, envelopeText);
    } catch (error) {
      outcome = {
        ok: false,
        code: "failed",
        message: error && error.message ? String(error.message) : "The schema preview failed.",
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
        message: "The vault changed while this preview was running.",
        hint: "Refresh the album and preview the retained draft against the current schema.",
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
        message: (outcome && outcome.message) || "The schema preview failed.",
        hint: outcome && (outcome.detail || outcome.hint)
          ? String(outcome.detail || outcome.hint)
          : "Nothing was written. Refresh and preview again.",
      };
      notify();
      return { ok: false, ...session.refusal };
    }
    const report = outcome.report;
    if (report.ok !== true) {
      const failure = albumJsonObject(report.error) ? report.error : {};
      const code = typeof failure.code === "string" ? failure.code : "refused";
      session.preview = null;
      session.status = "refused";
      session.refusal = {
        kind: albumIsStaleUpdateCode(code) ? "stale" : "refused",
        code,
        message: typeof failure.message === "string" ? failure.message : "The schema preview was refused.",
        hint: failure.hint == null ? "" : String(failure.hint),
        opIndex: failure.op_index == null ? null : failure.op_index,
        field: failure.field == null ? null : String(failure.field),
        choice: failure.choice == null ? null : String(failure.choice),
        path: failure.path == null ? null : String(failure.path),
        line: failure.line == null ? null : failure.line,
        keyPath: failure.key_path == null ? null : String(failure.key_path),
        affected: failure.affected == null ? null : failure.affected,
      };
      notify();
      return { ok: false, ...session.refusal };
    }
    session.preview = { epoch, revision, stem, expect, generation, envelopeText, report };
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

  // A vault generation observed outside the preview (for example the
  // card's subscription firing) invalidates Apply eligibility at once.
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
        message: "The vault changed under this preview.",
        hint: "Preview again before applying; nothing was written.",
      };
      notify();
    }
    return snapshot();
  }

  // Move a retained draft onto a freshly-read schema only after an explicit
  // user action. Rebase never previews or applies by itself.
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
      // Await supported saves of open Markdown editors, including every
      // pane showing the album, before touching the writer. The original
      // `expect` is retained through save and apply so a Source edit can
      // never be silently rebased.
      if (typeof deps.saveEditors !== "function") {
        session.status = "refused";
        session.refusal = {
          kind: "save",
          code: "save-unsupported",
          message: "The album editor could not confirm open panes are saved.",
          hint: "Save every pane showing the album in Source mode, then preview again. Nothing was written.",
        };
        notify();
        return { ok: false, ...session.refusal };
      }
      let saved;
      try {
        saved = await deps.saveEditors([albumPath]);
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
          hint: "Apply is refused until every pane showing the album saves. Nothing was written.",
        };
        notify();
        return { ok: false, ...session.refusal };
      }
      if (vaultGeneration() !== preview.generation) {
        // Saving invalidated the preview: show a fresh preview and require
        // confirmation again instead of applying the old envelope.
        session.preview = null;
        session.status = "preview-pending";
        notify();
        await requestPreview();
        return { ok: false, code: "save-invalidated", message: "Saving changed the vault; preview again before applying." };
      }
      let outcome;
      try {
        outcome = await deps.spawnApply(stem, preview.envelopeText, { ownPath: albumPath });
      } catch (error) {
        outcome = {
          ok: false,
          code: "failed",
          message: error && error.message ? String(error.message) : "The schema apply failed.",
        };
      }
      if (session.closed || session.epoch !== epoch || session.revision !== preview.revision) {
        // Never present a late apply as session state after close or a
        // superseding draft; the committed transaction itself is not
        // cancellable and is left to the refreshed report, not claimed here.
        return { ok: false, code: "superseded", message: "A newer session superseded this apply." };
      }
      if (!outcome || outcome.ok !== true || !outcome.report) {
        session.preview = null;
        session.status = "refused";
        const unknown = Boolean(outcome && (outcome.code === "timeout" || outcome.unknown === true));
        session.refusal = {
          kind: unknown ? "timeout-unknown" : "transport",
          code: (outcome && outcome.code) || "failed",
          message: (outcome && outcome.message) || "The schema apply failed.",
          hint: unknown
            ? "The outcome is unknown: refresh and explicitly reconcile before retrying. Never blind-retry."
            : "Nothing was written. Refresh and preview again.",
        };
        notify();
        return { ok: false, ...session.refusal };
      }
      const report = outcome.report;
      if (report.ok !== true) {
        const failure = albumJsonObject(report.error) ? report.error : {};
        const code = typeof failure.code === "string" ? failure.code : "refused";
        // Stale refreshes land through the service's generation-aware
        // revalidation; the draft stays unconfirmed and is never retried
        // automatically.
        session.preview = null;
        session.status = "refused";
        session.refusal = {
          kind: albumIsStaleUpdateCode(code) ? "stale" : "refused",
          code,
          message: typeof failure.message === "string" ? failure.message : "The schema apply was refused.",
          hint: failure.hint == null ? "" : String(failure.hint),
          opIndex: failure.op_index == null ? null : failure.op_index,
          field: failure.field == null ? null : String(failure.field),
          choice: failure.choice == null ? null : String(failure.choice),
          path: failure.path == null ? null : String(failure.path),
          line: failure.line == null ? null : failure.line,
          keyPath: failure.key_path == null ? null : String(failure.key_path),
          affected: failure.affected == null ? null : failure.affected,
        };
        notify();
        return { ok: false, ...session.refusal };
      }
      if (report.changed !== true) {
        // A no-op applies nothing and must not overwrite Undo.
        session.revision += 1;
        session.draftOps = [];
        session.preview = null;
        session.refusal = null;
        session.status = session.syncWarning ? "saved-with-sync-warning" : "browsing";
        notify();
        return { ok: true, changed: false, report };
      }
      // Success: the fresh baseline moves to the returned fingerprint and
      // the opaque inverse (restoration metadata included) becomes Undo.
      // Inverse YAML is never reconstructed and git history stays linear.
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
          hint: "The schema edit is committed and Undo is available. Retry sync with `bob vault-sync` only.",
        };
        session.status = "saved-with-sync-warning";
      } else {
        session.syncWarning = null;
        session.status = "browsing";
      }
      notify();
      return { ok: true, changed: true, report };
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

  // `u` stages the last successful gesture's inverse on the same
  // preview-and-Enter path. External changes or newly used values can
  // still refuse it through the backend checks.
  function stageUndo() {
    if (session.closed) {
      return { ok: false, code: "closed", message: "The edit session is closed." };
    }
    if (!session.undo || !Array.isArray(session.undo.inverseOps) || session.undo.inverseOps.length === 0) {
      return { ok: false, code: "nothing-to-undo", message: "There is no schema edit to undo." };
    }
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
      hint: (outcome && (outcome.detail || outcome.message)) || "Retry `bob vault-sync` later. The committed edit and Undo are kept.",
    };
    notify();
    return { ok: false, code: (outcome && outcome.code) || "sync-failed", message: session.syncWarning.hint };
  }

  function close() {
    session.epoch += 1;
    session.closed = true;
    clearPreviewTimer();
    session.previewFlight = null;
    // A committed transaction already running is not cancellable: its
    // late result is ignored by epoch, never painted as session state.
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

// Adapter from the shared album service to session dependencies. The
// host still injects `saveEditors` (all panes showing the album) and
// observes vault generations; the session never touches the vault or
// the DOM itself.
function albumUpdateServiceDeps(plugin, options = {}) {
  const saveEditors = options.saveEditors;
  return {
    spawnPreview: (stem, envelopeText) => plugin.apiAlbumUpdatePreview(stem, envelopeText),
    spawnApply: (stem, envelopeText, applyOptions) => plugin.apiAlbumUpdateApply(stem, envelopeText, applyOptions),
    spawnVaultSync: () => plugin.apiAlbumVaultSyncRetry(),
    saveEditors,
    getGeneration: () => {
      try {
        if (plugin && Number.isInteger(plugin.albumVaultGeneration)) {
          return plugin.albumVaultGeneration;
        }
      } catch (error) {
        // Fall through to zero below.
      }
      return 0;
    },
    timers: options.timers,
    onChange: options.onChange,
  };
}
