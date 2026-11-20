// Intention update session: a thin wrapper over the shared guarded
// session with periods preview/apply, inverse-op Undo, pane saves, and the
// per-path optimistic overlay. The server fingerprint rides every envelope;
// whole-file hashes are never used as expect values.
function createIntentionUpdateSession(init = {}, deps = {}) {
  const subjectPath = typeof albumReportPath === "function"
    ? albumReportPath(init.subjectPath || init.ownPath || "")
    : String(init.subjectPath || init.ownPath || "");
  const subject = String(init.subject || subjectPath);
  const inner = createGuardedUpdateSession({
    identity: subjectPath || subject,
    ownPath: subjectPath,
    savePaths: [subjectPath].filter(Boolean),
    allowDirectApply: true,
    expect: init.expect,
    undo: init.undo,
    debounceMs: INTENTION_UPDATE_PREVIEW_DEBOUNCE_MS,
    lockRetryMs: init.lockRetryMs,
    lockWaitBudgetMs: init.lockWaitBudgetMs,
    buildEnvelope: intentionUpdateEnvelopeText,
    isStaleCode: intentionIsStaleUpdateCode,
    failureFromReport: (report) => (intentionJsonObject(report) && intentionJsonObject(report.error) ? report.error : {}),
    snapshotExtras: { subjectPath, subject },
    copy: {
      previewEmpty: "There is nothing to preview.",
      previewFailed: "The intention preview failed.",
      previewRefused: "The intention preview was refused.",
      applyFailed: "The intention apply failed.",
      applyRefused: "The intention apply was refused.",
      stalePreview: "The vault changed while this preview was running.",
      stalePreviewHint: "Refresh the card and preview the retained draft against the current fingerprint.",
      staleGeneration: "The vault changed under this preview.",
      staleGenerationHint: "Preview again before applying; nothing was written.",
      saveUnsupported: "Open editors could not confirm the note is saved.",
      saveUnsupportedHint: "Save every pane showing the note in Source mode, then preview again. Nothing was written.",
      saveFailedHint: "Apply is refused until every pane showing the note saves. Nothing was written.",
      supersededDuringSave: "The draft changed while panes were saving; preview the current draft before applying.",
      saveInvalidated: "Saving changed the vault; preview again before applying.",
      nothingToUndo: "There is no intention edit to undo.",
      syncWarningHint: "The intention edit is saved and Undo is available. Retry sync with `bob vault-sync` only.",
      retryHint: "Retry `bob vault-sync` later. The saved edit and Undo are kept.",
    },
  }, deps);

  function staleFingerprint(result) {
    const report = result && result.report;
    if (report && typeof report.fingerprint_before === "string" && report.fingerprint_before) {
      return report.fingerprint_before;
    }
    return "";
  }

  // The ops behind the current apply, so the overlay can read a restored
  // summary's drafted date from the exact op the writer applied.
  let appliedOps = [];

  async function settle(result) {
    if (!result) return result;
    const stale = result.ok === false && (
      result.kind === "stale"
      || result.code === "stale_note"
      || (result.report && result.report.error && result.report.error.code === "stale_note")
    );
    if (stale) {
      const fingerprint = staleFingerprint(result);
      if (fingerprint) inner.rebase(fingerprint);
      return result;
    }
    if (result.ok === true && result.changed === true && result.report && typeof deps.onApplied === "function") {
      try { deps.onApplied(result, appliedOps.slice()); } catch (_) {}
    }
    return result;
  }

  return {
    setDraft: (ops) => {
      appliedOps = Array.isArray(ops) ? ops.slice() : [];
      return inner.setDraft(ops);
    },
    previewNow: inner.previewNow,
    apply: async () => settle(await inner.apply()),
    applyOps: async (ops) => {
      appliedOps = Array.isArray(ops) ? ops.slice() : [];
      return settle(await inner.applyOps(ops));
    },
    // Undo stages the inverse ops (which arms a debounced preview), then
    // applies them directly. Rebasing onto the staged expect cancels that
    // timer, so no stray dry run races the guarded apply.
    undo: async () => {
      const staged = inner.stageUndo();
      if (!staged || staged.ok !== true) return staged;
      const state = inner.getState();
      const ops = state.draftOps;
      inner.rebase(state.expect);
      appliedOps = ops.slice();
      return settle(await inner.applyOps(ops));
    },
    stopWaiting: inner.stopWaiting,
    stageUndo: inner.stageUndo,
    retrySync: inner.retrySync,
    noteGenerationChanged: inner.noteGenerationChanged,
    rebase: inner.rebase,
    close: inner.close,
    getState: inner.getState,
  };
}

function intentionUpdateServiceDeps(plugin, options = {}) {
  const subject = String(options.subject || "");
  const subjectPath = typeof albumReportPath === "function"
    ? albumReportPath(options.subjectPath || "")
    : String(options.subjectPath || "");
  const saveEditors = options.saveEditors || ((paths) =>
    typeof albumSchemaSaveOpenEditors === "function"
      ? albumSchemaSaveOpenEditors(plugin, paths)
      : Promise.resolve({
        ok: false, code: "save-unsupported",
        message: "Open editors could not confirm they are saved.",
      }));
  return {
    spawnPreview: (_identity, envelopeText) => plugin.apiIntentionUpdatePreview(subject, envelopeText),
    spawnApply: (_identity, envelopeText, applyOptions) =>
      plugin.apiIntentionUpdateApply(subject, envelopeText, {
        ...applyOptions,
        ownPaths: [subjectPath].filter(Boolean),
      }),
    spawnVaultSync: () =>
      typeof plugin.apiAlbumVaultSyncRetry === "function"
        ? plugin.apiAlbumVaultSyncRetry()
        : Promise.resolve({ ok: false, code: "sync-unsupported", message: "Sync retry is unavailable here." }),
    saveEditors,
    getGeneration: () => {
      try {
        if (plugin && Number.isInteger(plugin.albumVaultGeneration)) return plugin.albumVaultGeneration;
      } catch (_) {}
      return 0;
    },
    timers: options.timers,
    onChange: options.onChange,
    onApplied: (result, ops) => {
      const report = result && result.report;
      if (!report) return;
      plugin.intentionUpdateRememberUndo(
        subjectPath,
        report.inverse_ops,
        report.fingerprint_after,
      );
      if (typeof plugin.intentionCardPushOverlay === "function") {
        plugin.intentionCardPushOverlay(subjectPath, intentionOverlayFromReport(report, ops));
      }
    },
  };
}
