// Album schema update session: a thin wrapper over the writer-agnostic
// guarded update session. Behavior and tests stay unchanged.
function createAlbumUpdateSession(init = {}, deps = {}) {
  const stem = String(init.stem || "");
  const albumPath = albumReportPath(init.albumPath || `${stem}.md`);
  return createGuardedUpdateSession({
    identity: stem,
    ownPath: albumPath,
    expect: init.expect,
    undo: init.undo,
    debounceMs: ALBUM_UPDATE_PREVIEW_DEBOUNCE_MS,
    buildEnvelope: albumUpdateEnvelopeText,
    isStaleCode: albumIsStaleUpdateCode,
    failureFromReport: (report) => (albumJsonObject(report) && albumJsonObject(report.error) ? report.error : {}),
    snapshotExtras: { stem, albumPath },
    copy: {
      previewEmpty: "There is nothing to preview.",
      previewFailed: "The schema preview failed.",
      previewRefused: "The schema preview was refused.",
      applyFailed: "The schema apply failed.",
      applyRefused: "The schema apply was refused.",
      stalePreview: "The vault changed while this preview was running.",
      stalePreviewHint: "Refresh the album and preview the retained draft against the current schema.",
      staleGeneration: "The vault changed under this preview.",
      staleGenerationHint: "Preview again before applying; nothing was written.",
      saveUnsupported: "The album editor could not confirm open panes are saved.",
      saveUnsupportedHint: "Save every pane showing the album in Source mode, then preview again. Nothing was written.",
      saveFailedHint: "Apply is refused until every pane showing the album saves. Nothing was written.",
      supersededDuringSave: "The schema draft changed while panes were saving; preview the current draft before applying.",
      saveInvalidated: "Saving changed the vault; preview again before applying.",
      nothingToUndo: "There is no schema edit to undo.",
      syncWarningHint: "The schema edit is committed and Undo is available. Retry sync with `bob vault-sync` only.",
      retryHint: "Retry `bob vault-sync` later. The committed edit and Undo are kept.",
    },
  }, deps);
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
