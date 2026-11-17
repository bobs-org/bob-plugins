// Bank config update service (mixin half). Preview is a dry-run with no
// locks and no vault bytes; apply serializes across cards, suppresses only
// the writer's own `bank.md` echo, and forces a fresh bank report so an
// older in-flight list cannot become the post-write display. Sync-only
// recovery runs `bob vault-sync` and never replays the mutation.
class BobLedgerToolsBankConfigUpdateMixin {
  bankConfigUpdateOwnPathsStore() {
    if (!(this.bankConfigUpdateOwnPaths instanceof Set)) {
      this.bankConfigUpdateOwnPaths = new Set();
    }
    return this.bankConfigUpdateOwnPaths;
  }

  setupBankConfigUpdate() {
    this.bankConfigUpdateOwnPaths = new Set();
    this.bankConfigUpdateFlight = null;
    this.bankConfigUpdateBusy = false;
  }

  teardownBankConfigUpdate() {
    this.bankConfigUpdateBusy = false;
    this.bankConfigUpdateFlight = null;
    if (this.bankConfigUpdateOwnPaths instanceof Set) {
      this.bankConfigUpdateOwnPaths.clear();
    }
  }

  bankSpawnConfigUpdate(envelopeText, options = {}) {
    const opts = bankJsonObject(options) ? options : {};
    const dryRun = opts.dryRun === true;
    return bobSpawnJson(
      bankConfigUpdateArgs({ dryRun }),
      bankDecodeConfigUpdateReport,
      {
        ...opts,
        stdin: typeof envelopeText === "string" ? envelopeText : "",
        commandLabel: dryRun ? "bob bank config update -d" : "bob bank config update",
        resolveBobPath: () =>
          typeof this.apiStatsBobPath === "function"
            ? this.apiStatsBobPath()
            : { path: "bob", source: "path" },
        getVaultPath: () =>
          typeof this.statsVaultBasePath === "function" ? this.statsVaultBasePath() : null,
        timeout: BANK_CONFIG_UPDATE_TIMEOUT_MS,
        maxBuffer: BANK_CONFIG_UPDATE_MAX_BUFFER,
        firstLine: statsFirstLine,
      },
    );
  }

  apiBankConfigUpdatePreview(envelopeText, options = {}) {
    if (this.bankDataActive === false) {
      return Promise.resolve({ ok: false, code: "unloaded", message: "Bank data has unloaded." });
    }
    return this.bankSpawnConfigUpdate(envelopeText, { ...options, dryRun: true });
  }

  async bankConfigRevalidateAfterApply() {
    try {
      this.apiBankInvalidate("config-update");
    } catch (error) {
      // Invalidation is best-effort; the forced fetch below still runs.
    }
    let refreshed = null;
    try {
      refreshed = await this.apiBankRefresh({
        command: "config",
        force: true,
        requiredGeneration: this.bankVaultGeneration || 0,
      });
    } catch (error) {
      refreshed = null;
    }
    try {
      this.bankRevalidateMounts();
    } catch (error) {
      // Mount revalidation is best-effort after a write.
    }
    return refreshed;
  }

  apiBankConfigUpdateApply(envelopeText, options = {}) {
    const opts = bankJsonObject(options) ? options : {};
    if (this.bankDataActive === false) {
      return Promise.resolve({ ok: false, code: "unloaded", message: "Bank data has unloaded." });
    }
    if (this.bankConfigUpdateFlight) {
      return Promise.resolve({
        ok: false,
        code: "apply-busy",
        message: "Another bank config apply is already running.",
        hint: "Wait for it to settle, then preview again.",
      });
    }
    const epoch = this.bankDataEpoch || 0;
    const ownPath = typeof opts.ownPath === "string" && opts.ownPath
      ? bankNormalizePath(opts.ownPath)
      : BANK_CONFIG_UPDATE_HUB_PATH;
    const run = async () => {
      if (this.bankDataActive === false || (this.bankDataEpoch || 0) !== epoch) {
        return { ok: false, code: "unloaded", message: "Bank data has unloaded." };
      }
      if (this.bankConfigUpdateFlight && this.bankConfigUpdateFlight !== applyPromise) {
        return {
          ok: false,
          code: "apply-busy",
          message: "Another bank config apply is already running.",
          hint: "Wait for it to settle, then preview again.",
        };
      }
      this.bankConfigUpdateBusy = true;
      if (ownPath) {
        this.bankConfigUpdateOwnPathsStore().add(ownPath);
      }
      let outcome;
      try {
        outcome = await this.bankSpawnConfigUpdate(envelopeText, { ...opts, dryRun: false });
      } catch (error) {
        outcome = {
          ok: false,
          code: "failed",
          message: error && error.message ? String(error.message) : "bob bank config update failed.",
        };
      }
      const wrote = Boolean(
        outcome && outcome.ok && outcome.report && outcome.report.ok === true &&
        outcome.report.dry_run === false && outcome.report.changed === true,
      );
      const unknown = Boolean(outcome && !outcome.ok && (outcome.code === "timeout" || outcome.code === "failed"));
      const maybeWrote = wrote || unknown;
      if (this.bankDataActive === false || (this.bankDataEpoch || 0) !== epoch) {
        if (this.bankConfigUpdateFlight === applyPromise) {
          this.bankConfigUpdateFlight = null;
        }
        this.bankConfigUpdateBusy = false;
        return { ...outcome, refreshed: null, wrote, unknown };
      }
      this.bankConfigUpdateBusy = false;
      if (this.bankConfigUpdateFlight === applyPromise) {
        this.bankConfigUpdateFlight = null;
      }
      let refreshed = null;
      try {
        refreshed = await this.bankConfigRevalidateAfterApply();
      } catch (error) {
        refreshed = null;
      }
      if (ownPath) {
        this.bankConfigUpdateOwnPathsStore().delete(ownPath);
      }
      void maybeWrote;
      return { ...outcome, refreshed, wrote, unknown };
    };
    const applyPromise = Promise.resolve().then(run);
    this.bankConfigUpdateFlight = applyPromise;
    return applyPromise;
  }

  apiBankConfigVaultSyncRetry(options = {}) {
    if (this.bankDataActive === false) {
      return Promise.resolve({ ok: false, code: "unloaded", message: "Bank data has unloaded." });
    }
    return bobSpawnJson(
      bankConfigVaultSyncArgs(),
      bankDecodeConfigVaultSyncResult,
      {
        ...options,
        commandLabel: "bob vault-sync",
        resolveBobPath: () =>
          typeof this.apiStatsBobPath === "function"
            ? this.apiStatsBobPath()
            : { path: "bob", source: "path" },
        getVaultPath: () =>
          typeof this.statsVaultBasePath === "function" ? this.statsVaultBasePath() : null,
        timeout: BANK_CONFIG_UPDATE_TIMEOUT_MS,
        maxBuffer: BANK_CONFIG_UPDATE_MAX_BUFFER,
        firstLine: statsFirstLine,
      },
    );
  }
}

function bankSetupRememberUndo(plugin, inverseOps, afterFingerprint) {
  try {
    if (!plugin || !Array.isArray(inverseOps) || !inverseOps.length) return null;
    const record = {
      inverseOps: inverseOps.map((op) => (op && typeof op === "object" ? { ...op } : op)),
      afterFingerprint: typeof afterFingerprint === "string" ? afterFingerprint : "",
    };
    plugin.bankSetupUndoRecord = record;
    return record;
  } catch (_) {
    return null;
  }
}

function bankSetupLastUndo(plugin) {
  try {
    return plugin && plugin.bankSetupUndoRecord ? plugin.bankSetupUndoRecord : null;
  } catch (_) {
    return null;
  }
}

function bankSetupRecordTiming(plugin, kind, ms) {
  try {
    if (!plugin) return;
    if (!Array.isArray(plugin.bankSetupTimings)) plugin.bankSetupTimings = [];
    const value = Number(ms);
    if (!Number.isFinite(value) || value < 0) return;
    plugin.bankSetupTimings.push({ kind: String(kind || ""), ms: value, at: Date.now() });
    while (plugin.bankSetupTimings.length > 60) plugin.bankSetupTimings.shift();
  } catch (_) {}
}

function createBankConfigUpdateSession(init = {}, deps = {}) {
  return createGuardedUpdateSession({
    identity: "bank",
    ownPath: BANK_CONFIG_UPDATE_HUB_PATH,
    expect: init.expect,
    undo: init.undo,
    debounceMs: BANK_CONFIG_UPDATE_PREVIEW_DEBOUNCE_MS,
    buildEnvelope: bankConfigUpdateEnvelopeText,
    isStaleCode: bankIsStaleConfigUpdateCode,
    failureFromReport: (report) =>
      (bankJsonObject(report) && bankJsonObject(report.failure) ? report.failure : {}),
    snapshotExtras: { hubPath: BANK_CONFIG_UPDATE_HUB_PATH },
    copy: {
      previewEmpty: "There is nothing to preview.",
      previewFailed: "The category preview failed.",
      previewRefused: "The category preview was refused.",
      applyFailed: "The category apply failed.",
      applyRefused: "The category apply was refused.",
      stalePreview: "The vault changed while this preview was running.",
      stalePreviewHint: "Refresh the bank config and preview the retained draft against the current fingerprint.",
      staleGeneration: "The vault changed under this preview.",
      staleGenerationHint: "Preview again before applying; nothing was written.",
      saveUnsupported: "Open editors could not confirm bank.md is saved.",
      saveUnsupportedHint: "Save every pane showing bank.md in Source mode, then preview again. Nothing was written.",
      saveFailedHint: "Apply is refused until every pane showing bank.md saves. Nothing was written.",
      supersededDuringSave: "The category draft changed while panes were saving; preview the current draft before applying.",
      saveInvalidated: "Saving changed the vault; preview again before applying.",
      nothingToUndo: "There is no category edit to undo.",
      syncWarningHint: "The category is committed. Retry sync with `bob vault-sync` only.",
      retryHint: "Retry `bob vault-sync` later. The committed category is kept.",
    },
  }, deps);
}

function bankConfigUpdateServiceDeps(plugin, options = {}) {
  const saveEditors = options.saveEditors || ((paths) =>
    typeof albumSchemaSaveOpenEditors === "function"
      ? albumSchemaSaveOpenEditors(plugin, paths)
      : Promise.resolve({
        ok: false,
        code: "save-unsupported",
        message: "Open editors could not confirm bank.md is saved.",
      }));
  return {
    spawnPreview: (_identity, envelopeText) => plugin.apiBankConfigUpdatePreview(envelopeText),
    spawnApply: (_identity, envelopeText, applyOptions) =>
      plugin.apiBankConfigUpdateApply(envelopeText, applyOptions),
    spawnVaultSync: () => plugin.apiBankConfigVaultSyncRetry(),
    saveEditors,
    getGeneration: () => {
      try {
        if (plugin && Number.isInteger(plugin.bankVaultGeneration)) {
          return plugin.bankVaultGeneration;
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
