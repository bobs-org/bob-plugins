// Record value update session: a thin wrapper over the shared guarded
// session with direct apply, inverse-op Undo, pane saves, and the sheet overlay.
function createRecordUpdateSession(init = {}, deps = {}) {
  const recordPath = typeof albumReportPath === "function"
    ? albumReportPath(init.recordPath || init.ownPath || "")
    : String(init.recordPath || init.ownPath || "");
  const albumPath = typeof albumReportPath === "function"
    ? albumReportPath(init.albumPath || "")
    : String(init.albumPath || "");
  const typeId = String(init.type || init.recordType || "");
  const stem = String(init.stem || "");
  const inner = createGuardedUpdateSession({
    identity: recordPath || `${typeId}:${stem}`,
    ownPath: recordPath,
    savePaths: [recordPath, albumPath].filter(Boolean),
    allowDirectApply: true,
    expect: init.expect,
    undo: init.undo,
    debounceMs: RECORD_UPDATE_PREVIEW_DEBOUNCE_MS,
    lockRetryMs: init.lockRetryMs,
    lockWaitBudgetMs: init.lockWaitBudgetMs,
    buildEnvelope: recordUpdateEnvelopeText,
    isStaleCode: recordIsStaleUpdateCode,
    failureFromReport: (report) => (recordJsonObject(report) && recordJsonObject(report.error) ? report.error : {}),
    snapshotExtras: { recordPath, albumPath, type: typeId, stem },
    copy: {
      previewEmpty: "There is nothing to preview.",
      previewFailed: "The record preview failed.",
      previewRefused: "The record preview was refused.",
      applyFailed: "The record apply failed.",
      applyRefused: "The record apply was refused.",
      stalePreview: "The vault changed while this preview was running.",
      stalePreviewHint: "Refresh the record and preview the retained draft against the current fingerprint.",
      staleGeneration: "The vault changed under this preview.",
      staleGenerationHint: "Preview again before applying; nothing was written.",
      saveUnsupported: "Open editors could not confirm the record is saved.",
      saveUnsupportedHint: "Save every pane showing the record or its album in Source mode, then preview again. Nothing was written.",
      saveFailedHint: "Apply is refused until every pane showing the record or its album saves. Nothing was written.",
      supersededDuringSave: "The record draft changed while panes were saving; preview the current draft before applying.",
      saveInvalidated: "Saving changed the vault; preview again before applying.",
      nothingToUndo: "There is no record edit to undo.",
      syncWarningHint: "The record edit is saved and Undo is available. Retry sync with `bob vault-sync` only.",
      retryHint: "Retry `bob vault-sync` later. The saved edit and Undo are kept.",
    },
  }, deps);

  function staleFingerprint(result) {
    const report = result && result.report;
    const record = report && recordJsonObject(report.record) ? report.record : null;
    if (record && typeof record.fingerprint === "string" && record.fingerprint) return record.fingerprint;
    if (report && typeof report.fingerprint_before === "string" && report.fingerprint_before) {
      return report.fingerprint_before;
    }
    return "";
  }

  async function settle(result) {
    if (!result) return result;
    const stale = result.ok === false && (
      result.kind === "stale" ||
      result.code === "stale_record" ||
      (result.report && result.report.error && result.report.error.code === "stale_record")
    );
    if (stale) {
      const fingerprint = staleFingerprint(result);
      if (fingerprint) inner.rebase(fingerprint);
      return result;
    }
    if (result.ok === true && result.changed === true && result.report && typeof deps.onApplied === "function") {
      try { deps.onApplied(result); } catch (_) {}
    }
    return result;
  }

  return {
    setDraft: inner.setDraft,
    previewNow: inner.previewNow,
    apply: async () => settle(await inner.apply()),
    applyOps: async (ops) => settle(await inner.applyOps(ops)),
    undo: async () => {
      const staged = inner.stageUndo();
      if (!staged || staged.ok !== true) return staged;
      return settle(await inner.applyOps(inner.getState().draftOps));
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

function recordUpdateServiceDeps(plugin, options = {}) {
  const typeId = String(options.type || "");
  const stem = String(options.stem || "");
  const recordPath = typeof albumReportPath === "function"
    ? albumReportPath(options.recordPath || "")
    : String(options.recordPath || "");
  const albumPath = typeof albumReportPath === "function"
    ? albumReportPath(options.albumPath || "")
    : String(options.albumPath || "");
  const saveEditors = options.saveEditors || ((paths) =>
    typeof albumSchemaSaveOpenEditors === "function"
      ? albumSchemaSaveOpenEditors(plugin, paths)
      : Promise.resolve({
        ok: false,
        code: "save-unsupported",
        message: "Open editors could not confirm they are saved.",
      }));
  return {
    spawnPreview: (_identity, envelopeText) => plugin.apiRecordUpdatePreview(typeId, stem, envelopeText),
    spawnApply: (_identity, envelopeText, applyOptions) =>
      plugin.apiRecordUpdateApply(typeId, stem, envelopeText, {
        ...applyOptions,
        ownPaths: [recordPath, albumPath].filter(Boolean),
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
    onApplied: (result) => {
      const report = result && result.report;
      if (!report) return;
      plugin.recordUpdateRememberUndo(
        recordPath,
        report.inverse_ops,
        report.fingerprint_after || report.after_fingerprint,
      );
      if (typeof plugin.recordSheetPushOverlay === "function") {
        plugin.recordSheetPushOverlay(recordPath, recordOverlayFromReport(report));
      }
    },
  };
}
