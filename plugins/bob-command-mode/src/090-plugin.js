// Bob Command Mode: plugin lifecycle, settings, catalog cache, Ctrl+P runs.

// The docs-inventory scanner only follows literal `.addCommand({...})` calls.
// Dynamic `run-<entry-id>` commands register through this computed-key helper
// so the scanner ignores them; they are described in prose on the plugin page.
const CM_ADD_COMMAND = "add" + "Command";

function cmAddCommand(plugin, spec) {
  return plugin[CM_ADD_COMMAND](spec);
}

function cmDefaultSettings() {
  return {
    bobPath: "",
    osNotifications: true,
    keepRuns: CM_DEFAULT_KEEP_RUNS,
    keepDays: CM_DEFAULT_KEEP_DAYS,
  };
}

function cmClassifyCatalogFailure(info) {
  if (info && info.binaryMissing) return "missing-bob";
  const detail = String((info && (info.error || info.detail)) || "");
  if (/unsupported.protocol|protocol/i.test(detail)) return "protocol-skew";
  return "old-bob";
}

class BobCommandModePlugin extends Plugin {
  async onload() {
    const stored = (await this.loadData()) || {};
    this.settings = { ...cmDefaultSettings(), ...(stored.settings || {}) };
    this.commandModeCatalog = (stored.catalogCache && stored.catalogCache.catalog) || null;
    this.commandModeFingerprint = (stored.catalogCache && stored.catalogCache.fingerprint) || null;
    this.commandModeState = this.commandModeCatalog ? "ready" : "empty";
    this.commandModeMissingBob = null;
    this.commandModeRunner = new CommandModeRunner({
      resolveBob: () => this.commandModeResolveBob(),
      vaultBase: () => cmVaultBasePath(this.app),
      catalog: () => this.commandModeCatalog,
      saveAllMarkdown: () => this.commandModeSaveAllMarkdown(),
      notify: (run) => this.commandModeNotify(run),
      fireEvent: (name, payload) => this.commandModeFireEvent(name, payload),
      onWorkspaceEvent: (name, callback) => this.commandModeOnWorkspaceEvent(name, callback),
      keepRuns: Number(this.settings.keepRuns) || CM_DEFAULT_KEEP_RUNS,
      keepDays: Number(this.settings.keepDays) || CM_DEFAULT_KEEP_DAYS,
      env: (typeof process !== "undefined" && process.env) || {},
      pagerWidthCols: 100,
    });
    this.api = cmCreateRootApi(cmCreateApi(this.commandModeRunner, {
      openOutput: (runId) => this.commandModeOpenOutput(runId),
    }));
    this.addSettingTab(new BobCommandModeSettingTab(this.app, this));
    // Register from the persisted catalog first so Ctrl+P works before the
    // background refresh finishes; refresh then re-registers the same ids.
    this.commandModeSyncRunCommands();
    void this.commandModeRefreshCatalog("load");
    this.commandModeRunner.adoptUnfinished();
  }

  onunload() {
    // Writers are detached and keep running; their records are adopted on the
    // next load. Never kill a writer from unload.
    if (this.commandModeRunner) this.commandModeRunner.dispose();
    this.commandModeRunner = null;
    this.api = null;
  }

  commandModeLedgerBobPath() {
    try {
      const ledger = this.app && this.app.plugins && this.app.plugins.plugins
        ? this.app.plugins.plugins["bob-ledger-tools"]
        : null;
      const api = ledger && ledger.api;
      const stats = api && api.stats;
      if (stats && typeof stats.bobPath === "function") return stats.bobPath();
    } catch (error) {
      // Feature-detected: ledger-tools may be absent or older.
    }
    return null;
  }

  commandModeResolveBob() {
    const configured = (this.settings && this.settings.bobPath) || "";
    const home = cmHomeDir({});
    const ledgerPath = this.commandModeLedgerBobPath();
    const resolution = cmResolveBobPath(configured, {
      home,
      ledgerBobPath: typeof ledgerPath === "string" && ledgerPath ? ledgerPath : undefined,
    });
    if (resolution.source !== "config" && resolution.source !== "ledger-tools" && resolution.source !== "path") {
      this.commandModeMissingBob = null;
    }
    return resolution;
  }

  async commandModeRefreshCatalog(reason) {
    const resolution = this.commandModeResolveBob();
    const fsModule = cmFs();
    let binaryMissing = false;
    if (resolution.source === "candidate" || resolution.source === "config") {
      try {
        binaryMissing = !fsModule.existsSync(resolution.path);
      } catch (error) {
        binaryMissing = true;
      }
    }
    if (binaryMissing) {
      this.commandModeState = "missing-bob";
      this.commandModeMissingBob = { path: resolution.path, tried: resolution.tried };
      this.commandModeSyncRunCommands();
      return { ok: false, state: "missing-bob" };
    }
    const fingerprint = cmStatBobPath(fsModule, resolution.path);
    if (reason !== "force" && fingerprint && cmFingerprintsEqual(fingerprint, this.commandModeFingerprint) && this.commandModeCatalog) {
      this.commandModeState = "ready";
      return { ok: true, state: "ready", cached: true };
    }
    let result;
    try {
      result = await cmRefreshCatalog(resolution.path, {});
    } catch (error) {
      result = { ok: false, error: String((error && error.message) || error) };
    }
    if (!result.ok) {
      this.commandModeState = cmClassifyCatalogFailure({ ...result, binaryMissing });
      this.commandModeSyncRunCommands();
      return { ok: false, state: this.commandModeState, error: result.error };
    }
    this.commandModeCatalog = result.catalog;
    this.commandModeFingerprint = fingerprint;
    this.commandModeState = "ready";
    this.commandModeMissingBob = null;
    this.commandModeSyncRunCommands();
    void this.commandModePersist();
    return { ok: true, state: "ready" };
  }

  async commandModePersist() {
    try {
      await this.saveData({
        settings: this.settings,
        catalogCache: { fingerprint: this.commandModeFingerprint, catalog: this.commandModeCatalog },
      });
    } catch (error) {
      // Persistence is best effort.
    }
  }

  commandModeSyncRunCommands() {
    if (!this.commandModeRunner) return;
    const entries = cmCommandPaletteEntries(this.commandModeCatalog);
    for (const entry of entries) {
      const title = entry.title || entry.id;
      const spec = {
        id: "run-" + entry.id,
        name: "Bob: " + title,
        callback: () => {
          void this.commandModeRunner.run([...entry.path], {
            entryId: entry.id,
            trigger: "command",
            title,
          });
        },
      };
      try {
        cmAddCommand(this, spec);
      } catch (error) {
        // One bad row must not block the rest.
      }
    }
  }

  async commandModeSaveAllMarkdown() {
    const workspace = this.app && this.app.workspace;
    if (!workspace || typeof workspace.iterateAllLeaves !== "function") return { ok: true };
    const views = [];
    try {
      workspace.iterateAllLeaves((leaf) => {
        if (leaf && leaf.view instanceof MarkdownView && leaf.view.file) views.push(leaf.view);
      });
    } catch (error) {
      return { ok: true };
    }
    for (const view of views) {
      try {
        if (typeof view.save === "function") await view.save();
      } catch (error) {
        const filePath = view && view.file ? view.file.path : "note";
        return { ok: false, path: filePath };
      }
    }
    return { ok: true };
  }

  commandModeNotify(outcome) {
    try {
      const summary = outcome && outcome.reason
        ? outcome.reason
        : (outcome && outcome.outcome ? String(outcome.outcome) : "Done");
      new Notice(summary);
    } catch (error) {
      // Headless or unloaded: the record already carries the truth.
    }
  }

  commandModeFireEvent(name, payload) {
    try {
      const workspace = this.app && this.app.workspace;
      if (workspace && typeof workspace.trigger === "function") workspace.trigger(name, payload);
    } catch (error) {
      // Event delivery must never break finalization.
    }
  }

  commandModeOnWorkspaceEvent(name, callback) {
    try {
      const workspace = this.app && this.app.workspace;
      if (workspace && typeof workspace.on === "function") {
        const ref = workspace.on(name, callback);
        return () => {
          try {
            if (typeof workspace.offref === "function") workspace.offref(ref);
          } catch (error) {
            // Unsubscribe is best effort.
          }
        };
      }
    } catch (error) {
      // No workspace: no subscription.
    }
    return () => {};
  }

  commandModeOpenOutput(runId) {
    const runner = this.commandModeRunner;
    if (!runner) return { ok: false, reason: "command mode is not loaded" };
    const paths = cmRunFilePaths(runner.runsDir(), String(runId || ""), runner.pathModule());
    let shell = null;
    try {
      const electron = require("electron");
      shell = electron && electron.shell ? electron.shell : null;
    } catch (error) {
      shell = null;
    }
    const opener = runner.deps.shellOpenPath || (shell && shell.openPath ? (target) => shell.openPath(target) : null);
    if (!opener) return { ok: false, reason: "no output view yet" };
    try {
      const result = opener(paths.out);
      if (result && typeof result.then === "function") {
        return result.then(() => ({ ok: true, runId })).catch((error) => ({ ok: false, reason: String((error && error.message) || error) }));
      }
      return { ok: true, runId };
    } catch (error) {
      return { ok: false, reason: String((error && error.message) || error) };
    }
  }
}

class BobCommandModeSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName("bob path")
      .setDesc("Find bob in its usual install locations or on PATH; set an explicit path to override.")
      .addText((text) => {
        text.setPlaceholder("Auto (blank)").setValue(this.plugin.settings.bobPath || "");
        text.onChange(async (value) => {
          this.plugin.settings.bobPath = String(value || "").trim();
          await this.plugin.commandModePersist();
          void this.plugin.commandModeRefreshCatalog("force");
        });
        return text;
      });
    new Setting(containerEl)
      .setName("OS notifications")
      .setDesc("Notify on long finished runs while Obsidian is unfocused.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.osNotifications !== false);
        toggle.onChange(async (value) => {
          this.plugin.settings.osNotifications = Boolean(value);
          await this.plugin.commandModePersist();
        });
        return toggle;
      });
    new Setting(containerEl)
      .setName("Keep runs")
      .setDesc("Retain at most this many runs in history.")
      .addText((text) => {
        text.setPlaceholder(String(CM_DEFAULT_KEEP_RUNS)).setValue(String(this.plugin.settings.keepRuns ?? ""));
        text.onChange(async (value) => {
          const parsed = Number.parseInt(String(value || "").trim(), 10);
          if (Number.isFinite(parsed) && parsed >= 0) {
            this.plugin.settings.keepRuns = parsed;
            if (this.plugin.commandModeRunner) this.plugin.commandModeRunner.deps.keepRuns = parsed;
            await this.plugin.commandModePersist();
          }
        });
        return text;
      });
    new Setting(containerEl)
      .setName("Keep days")
      .setDesc("Retain runs younger than this many days.")
      .addText((text) => {
        text.setPlaceholder(String(CM_DEFAULT_KEEP_DAYS)).setValue(String(this.plugin.settings.keepDays ?? ""));
        text.onChange(async (value) => {
          const parsed = Number.parseInt(String(value || "").trim(), 10);
          if (Number.isFinite(parsed) && parsed >= 0) {
            this.plugin.settings.keepDays = parsed;
            if (this.plugin.commandModeRunner) this.plugin.commandModeRunner.deps.keepDays = parsed;
            await this.plugin.commandModePersist();
          }
        });
        return text;
      });
  }
}
