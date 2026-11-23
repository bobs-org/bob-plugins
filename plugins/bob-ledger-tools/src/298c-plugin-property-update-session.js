// Property update session: a thin wrapper over the shared guarded session
// with props_v1 preview/apply, inverse-op Undo/Redo, pane saves for any
// Markdown note, and confirmed post-image overlays. Typed previews debounce
// 250 ms; Enter commits only a matching successful preview.
function createPropertyUpdateSession(init = {}, deps = {}) {
  const notePath = propertyNotePath(init.path || init.ownPath || "");
  const history = deps.history || null;
  const overlays = deps.overlays || null;
  let lastProperties = Array.isArray(init.properties)
    ? propertyCloneJson(init.properties)
    : [];
  let historyKind = "edit";

  const inner = createGuardedUpdateSession({
    identity: notePath,
    ownPath: notePath,
    savePaths: [notePath].filter(Boolean),
    allowDirectApply: true,
    expect: init.expect,
    undo: init.undo,
    debounceMs: PROPERTY_UPDATE_PREVIEW_DEBOUNCE_MS,
    lockRetryMs: init.lockRetryMs,
    lockWaitBudgetMs: init.lockWaitBudgetMs,
    buildEnvelope: propertyUpdateEnvelopeText,
    isStaleCode: propertyIsStaleUpdateCode,
    failureFromReport: (report) => (propertyJsonObject(report) && propertyJsonObject(report.error) ? report.error : {}),
    snapshotExtras: { path: notePath, notePath },
    copy: {
      previewEmpty: "There is nothing to preview.",
      previewFailed: "The property preview failed.",
      previewRefused: "The property preview was refused.",
      applyFailed: "The property apply failed.",
      applyRefused: "The property apply was refused.",
      stalePreview: "The vault changed while this preview was running.",
      stalePreviewHint: "Refresh the note and preview the retained draft against the current fingerprint.",
      staleGeneration: "The vault changed under this preview.",
      staleGenerationHint: "Preview again before applying; nothing was written.",
      saveUnsupported: "Open editors could not confirm the note is saved.",
      saveUnsupportedHint: "Save every pane showing the note in Source mode, then preview again. Nothing was written.",
      saveFailedHint: "Apply is refused until every pane showing the note saves. Nothing was written.",
      supersededDuringSave: "The property draft changed while panes were saving; preview the current draft before applying.",
      saveInvalidated: "Saving changed the vault; preview again before applying.",
      nothingToUndo: "There is no property edit to undo.",
      syncWarningHint: "The property edit is saved and Undo is available. Retry sync with `bob vault-sync` only.",
      retryHint: "Retry `bob vault-sync` later. The saved edit and Undo are kept.",
    },
  }, deps);

  function rememberProperties(properties) {
    if (Array.isArray(properties)) lastProperties = propertyCloneJson(properties);
  }

  async function rereadFingerprint() {
    if (typeof deps.spawnShow !== "function") return "";
    let outcome;
    try {
      outcome = await deps.spawnShow(notePath);
    } catch (_) {
      return "";
    }
    const report = outcome && outcome.ok === true && propertyJsonObject(outcome.report) ? outcome.report : null;
    if (!report) return "";
    if (Array.isArray(report.properties)) rememberProperties(report.properties);
    return propertyFingerprintOf(report);
  }

  function publishOverlay(report) {
    if (!overlays || typeof overlays.push !== "function") return;
    overlays.push(notePath, propertyOverlayFromReport(report, lastProperties));
  }

  function rememberHistory(report) {
    if (!history || !report) return;
    const inverse = report.inverse_ops;
    const expect = typeof report.fingerprint_after === "string" ? report.fingerprint_after : "";
    if (historyKind === "undo") {
      history.completeUndo(notePath, inverse, expect);
      return;
    }
    if (historyKind === "redo") {
      history.completeRedo(notePath, inverse, expect);
      return;
    }
    history.pushEdit(notePath, inverse, expect);
  }

  async function settle(result) {
    if (!result) return result;
    const stale = result.ok === false && (
      result.kind === "stale" ||
      result.code === "prop_stale" ||
      (result.report && result.report.error && result.report.error.code === "prop_stale")
    );
    if (stale) {
      const fingerprint = await rereadFingerprint();
      if (fingerprint) inner.rebase(fingerprint);
      return result;
    }
    if (result.ok === true && result.changed === true && result.report) {
      rememberHistory(result.report);
      publishOverlay(result.report);
      if (Array.isArray(result.report.properties)) rememberProperties(result.report.properties);
      if (typeof deps.onApplied === "function") {
        try { deps.onApplied(result); } catch (_) {}
      }
    }
    return result;
  }

  async function replayHistory(kind) {
    if (!history) {
      return { ok: false, code: "nothing-to-undo", message: "There is no property edit to undo." };
    }
    const popped = kind === "redo" ? history.popRedo(notePath) : history.popUndo(notePath);
    if (!popped) {
      return {
        ok: false,
        code: kind === "redo" ? "nothing-to-redo" : "nothing-to-undo",
        message: kind === "redo" ? "There is no property edit to redo." : "There is no property edit to undo.",
      };
    }
    historyKind = kind;
    try {
      inner.rebase(popped.expect);
      const result = await settle(await inner.applyOps(popped.inverseOps));
      const consumed = result && result.ok === true && result.changed === true;
      if (!consumed) {
        if (kind === "redo") history.restoreRedo(notePath, popped);
        else history.restoreUndo(notePath, popped);
      }
      return result;
    } finally {
      historyKind = "edit";
    }
  }

  return {
    setDraft: inner.setDraft,
    previewNow: inner.previewNow,
    invalidateEnter: () => inner.setDraft(inner.getState().draftOps),
    apply: async () => {
      if (!inner.getState().expect) {
        return {
          ok: false,
          code: "unwritable",
          message: "Repair the frontmatter YAML before editing properties.",
        };
      }
      historyKind = "edit";
      return settle(await inner.apply());
    },
    applyOps: async (ops) => {
      if (!inner.getState().expect) {
        return {
          ok: false,
          code: "unwritable",
          message: "Repair the frontmatter YAML before editing properties.",
        };
      }
      historyKind = "edit";
      return settle(await inner.applyOps(ops));
    },
    undo: async () => replayHistory("undo"),
    redo: async () => replayHistory("redo"),
    stopWaiting: inner.stopWaiting,
    stageUndo: inner.stageUndo,
    retrySync: inner.retrySync,
    noteGenerationChanged: inner.noteGenerationChanged,
    rebase: inner.rebase,
    close: inner.close,
    getState: () => {
      const state = inner.getState();
      const hist = history ? history.snapshot(notePath) : { undo: 0, redo: 0 };
      return {
        ...state,
        path: notePath,
        undoAvailable: hist.undo > 0,
        redoAvailable: hist.redo > 0,
        history: hist,
      };
    },
    rememberProperties,
  };
}

function propertyUpdateServiceDeps(plugin, options = {}) {
  const notePath = propertyNotePath(options.path || options.ownPath || "");
  const saveEditors = options.saveEditors || ((paths) =>
    typeof albumSchemaSaveOpenEditors === "function"
      ? albumSchemaSaveOpenEditors(plugin, paths)
      : Promise.resolve({
        ok: false,
        code: "save-unsupported",
        message: "Open editors could not confirm they are saved.",
      }));
  return {
    spawnPreview: (_identity, envelopeText) => plugin.apiPropertyUpdatePreview(notePath, envelopeText),
    spawnApply: (_identity, envelopeText, applyOptions) =>
      plugin.apiPropertyUpdateApply(notePath, envelopeText, {
        ...applyOptions,
        ownPaths: [notePath].filter(Boolean),
      }),
    spawnShow: () => plugin.apiPropertyShow(notePath),
    spawnVaultSync: () =>
      typeof plugin.apiAlbumVaultSyncRetry === "function"
        ? plugin.apiAlbumVaultSyncRetry()
        : Promise.resolve({ ok: false, code: "sync-unsupported", message: "Sync retry is unavailable here." }),
    saveEditors,
    getGeneration: () => {
      try {
        if (plugin && Number.isInteger(plugin.propertyVaultGeneration)) return plugin.propertyVaultGeneration;
        if (plugin && Number.isInteger(plugin.albumVaultGeneration)) return plugin.albumVaultGeneration;
      } catch (_) {}
      return 0;
    },
    timers: options.timers,
    onChange: options.onChange,
    history: options.history || (plugin && plugin.propertyHistory) || null,
    overlays: options.overlays || (plugin && plugin.propertyOverlays) || null,
    onApplied: options.onApplied,
  };
}
