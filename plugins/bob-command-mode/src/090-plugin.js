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
    this.commandModeStickyNotices = new Map();
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
    this.addCommand({
      id: "rerun-last",
      name: "Bob: Rerun last command",
      callback: () => this.commandModeRerun(this.commandModeRunner && this.commandModeRunner.newestRecord()),
    });
    // Register from the persisted catalog first so Ctrl+P works before the
    // background refresh finishes; refresh then re-registers the same ids.
    this.commandModeSyncRunCommands();
    this.commandModeStartStatusChip();
    void this.commandModeRefreshCatalog("load");
    this.commandModeRunner.adoptUnfinished();
  }

  onunload() {
    // Writers are detached and keep running; their records are adopted on the
    // next load. Never kill a writer from unload.
    if (this.commandModeRunner) this.commandModeRunner.dispose();
    if (this.commandModeStatusTimer) clearInterval(this.commandModeStatusTimer);
    this.commandModeStatusTimer = null;
    for (const notice of this.commandModeStickyNotices.values()) {
      try { if (notice && typeof notice.hide === "function") notice.hide(); }
      catch (error) { /* Best effort during unload. */ }
    }
    if (this.commandModeStickyNotices) this.commandModeStickyNotices.clear();
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

  commandModeStartStatusChip() {
    if (typeof this.addStatusBarItem !== "function") return;
    try {
      this.commandModeStatusEl = this.addStatusBarItem();
      if (!this.commandModeStatusEl) return;
      this.commandModeStatusEl.addClass("bob-cmd-chip");
      this.commandModeStatusEl.style.display = "none";
      this.commandModeStatusEl.addEventListener("keydown", (event) => {
        if (event && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          const active = this.commandModeRunner && this.commandModeRunner.activeRecords();
          const newest = active && active[active.length - 1];
          if (newest) void this.commandModeOpenOutput(newest.id);
        }
      });
      this.commandModeRefreshStatusChip();
      this.commandModeStatusTimer = setInterval(() => this.commandModeRefreshStatusChip(), 250);
      if (this.commandModeStatusTimer && typeof this.commandModeStatusTimer.unref === "function") this.commandModeStatusTimer.unref();
    } catch (error) {
      this.commandModeStatusEl = null;
    }
  }

  commandModeRefreshStatusChip(nowMs = Date.now()) {
    const runner = this.commandModeRunner;
    if (!runner || !this.commandModeStatusEl) return { visible: false, runs: 0 };
    return cmRenderStatusChip(
      this.commandModeStatusEl,
      runner.activeRecords(),
      nowMs,
      (runId) => this.commandModeOpenOutput(runId),
      (runId) => this.commandModeProgressText(runId),
    );
  }

  commandModeProgressText(runId) {
    const runner = this.commandModeRunner;
    if (!runner) return "";
    let fd = null;
    try {
      const file = cmRunFilePaths(runner.runsDir(), String(runId || ""), runner.pathModule()).out;
      const fsModule = runner.fs();
      const size = fsModule.statSync(file).size;
      const length = Math.min(8192, size);
      const bytes = Buffer.alloc(length);
      fd = fsModule.openSync(file, "r");
      fsModule.readSync(fd, bytes, 0, length, Math.max(0, size - length));
      const lines = cmStripAnsi(bytes.toString("utf8")).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      return lines[lines.length - 1] || "";
    } catch (error) {
      return "";
    } finally {
      if (fd !== null) {
        try { runner.fs().closeSync(fd); } catch (error) { /* Best effort. */ }
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
      const notice = { ...(outcome || {}) };
      const record = cmToastRun(notice);
      const source = [notice.reason, record.summary].filter(Boolean).join("\n");
      const actions = Array.isArray(notice.actions) ? [...notice.actions] : [];
      if (/bob not found/i.test(source) && !actions.some((action) => action.id === "open-settings")) {
        actions.push({ id: "open-settings", label: "Open settings" });
      }
      if (/(?:dirty.*paths?|paths?.*dirty|uncommitted\s+(?:edits|changes)|working tree.*dirty)/i.test(source)) {
        notice.reason = "Commit pending edits first";
        notice.actions = [...actions, { id: "sync-vault-retry", label: "Sync vault, then retry" }];
      } else {
        notice.actions = actions;
      }
      if (record.entry_id === "projects-sync" && notice.outcome === "completed") {
        notice.actions.push({ id: "run", label: "Reconcile tasks", entryId: "task-reconcile", argv: ["task", "reconcile"] });
      }
      const sticky = notice.outcome === "failed" || notice.outcome === "unknown";
      const stickyKey = String(record.entry_id || notice.entryId || notice.runId || "bob");
      if (sticky && this.commandModeStickyNotices) {
        const previous = this.commandModeStickyNotices.get(stickyKey);
        try { if (previous && typeof previous.hide === "function") previous.hide(); }
        catch (error) { /* A prior notice may already be closed. */ }
      }
      const fragment = cmCreateToastFragment(
        notice,
        (action, card) => this.commandModeRunToastAction(action, card),
        (runId) => this.commandModeOpenOutput(runId),
      );
      if (!fragment) {
        new Notice(cmToastSummary(notice), cmToastDuration(notice));
        return null;
      }
      const card = new Notice(fragment, cmToastDuration(notice));
      if (sticky && this.commandModeStickyNotices) this.commandModeStickyNotices.set(stickyKey, card);
      this.commandModeMaybeNotifyOS(notice);
      return card;
    } catch (error) {
      // Headless or unloaded: the record already carries the truth.
      return null;
    }
  }

  commandModeMaybeNotifyOS(outcome) {
    const record = cmToastRun(outcome);
    if (this.settings.osNotifications === false || Number(record.duration_ms) <= 15000) return false;
    try {
      if (typeof document !== "undefined" && typeof document.hasFocus === "function" && document.hasFocus()) return false;
      if (typeof Notification !== "function") return false;
      const title = cmToastTitle(outcome) + " · " + String(outcome.outcome || "completed");
      const notification = new Notification(title, { body: cmToastSummary(outcome) });
      notification.onclick = () => {
        try { if (typeof window !== "undefined" && typeof window.focus === "function") window.focus(); }
        catch (error) { /* The shell may not expose focus. */ }
        void this.commandModeOpenOutput(record.id || outcome.runId);
      };
      return true;
    } catch (error) {
      // OS notification APIs can be unavailable or denied; the in-app toast remains.
      return false;
    }
  }

  async commandModeRunToastAction(action, outcome = {}) {
    if (!action || !action.id) return { ok: false, reason: "unknown action" };
    const record = cmToastRun(outcome);
    const runner = this.commandModeRunner;
    switch (action.id) {
      case "output":
        return this.commandModeOpenOutput(record.id || outcome.runId);
      case "retry":
        return this.commandModeRerun(record);
      case "copy": {
        try {
          const clipboard = typeof navigator !== "undefined" && navigator.clipboard;
          if (!clipboard || typeof clipboard.writeText !== "function") return { ok: false, reason: "clipboard unavailable" };
          await clipboard.writeText(cmToastArgv(outcome));
          return { ok: true };
        } catch (error) {
          return { ok: false, reason: String((error && error.message) || error) };
        }
      }
      case "open-vault-note": {
        const workspace = this.app && this.app.workspace;
        if (!action.path || !workspace || typeof workspace.openLinkText !== "function") return { ok: false, reason: "note opener unavailable" };
        try { await workspace.openLinkText(String(action.path), "", false); return { ok: true }; }
        catch (error) { return { ok: false, reason: String((error && error.message) || error) }; }
      }
      case "open-settings": {
        try {
          const setting = this.app && this.app.setting;
          if (setting && typeof setting.open === "function") setting.open();
          if (setting && typeof setting.openTabById === "function") setting.openTabById("bob-command-mode");
          return { ok: Boolean(setting) };
        } catch (error) { return { ok: false, reason: String((error && error.message) || error) }; }
      }
      case "run":
        if (!runner || !Array.isArray(action.argv)) return { ok: false, reason: "runner unavailable" };
        return runner.run(action.argv, { entryId: action.entryId, title: action.label, trigger: "toast-action" });
      case "rerun-with-carry":
        return this.commandModeRerun(record, { carry: action.carry, preview: false });
      case "sync-vault-retry": {
        if (!runner) return { ok: false, reason: "runner unavailable" };
        const synced = await runner.run(["vault-sync", "run"], { entryId: "vault-sync", title: "Sync vault", trigger: "toast-action" });
        if (!synced || synced.outcome !== "completed") return synced;
        return this.commandModeRerun(record);
      }
      case "reload-plugins": {
        const plugins = this.app && this.app.plugins;
        if (!plugins || typeof plugins.disablePlugin !== "function" || typeof plugins.enablePlugin !== "function") {
          return { ok: false, reason: "plugin reload unavailable" };
        }
        const ids = Array.isArray(action.pluginIds) ? [...action.pluginIds] : [];
        const own = ids.filter((id) => id !== "bob-command-mode");
        if (ids.includes("bob-command-mode")) own.push("bob-command-mode");
        try {
          for (const id of own) {
            await plugins.disablePlugin(id);
            await plugins.enablePlugin(id);
          }
          return { ok: true, pluginIds: own };
        } catch (error) { return { ok: false, reason: String((error && error.message) || error) }; }
      }
      default:
        return { ok: false, reason: "unknown action: " + action.id };
    }
  }

  commandModeRerun(record, options = {}) {
    const runner = this.commandModeRunner;
    const current = record || (runner && runner.newestRecord());
    if (!runner || !current || !Array.isArray(current.argv)) return Promise.resolve({ ok: false, reason: "no command to rerun" });
    let words = [...current.argv];
    if (words.length && (words[0] === "bob" || words[0] === current.bob_path || /(?:^|\/)bob$/.test(String(words[0])))) words.shift();
    const entry = current.entry_id ? cmEntryById(runner.catalog(), current.entry_id) : null;
    if (entry && Array.isArray(entry.path) && entry.path.every((word, index) => words[index] === word)) {
      let rest = words.slice(entry.path.length);
      const previewFlags = Array.isArray(entry.preview) ? new Set(entry.preview.map(String)) : new Set();
      rest = rest.filter((word) => !previewFlags.has(String(word)));
      if (Array.isArray(entry.fixed)) {
        let cursor = 0;
        for (const fixed of entry.fixed) {
          const index = rest.indexOf(String(fixed), cursor);
          if (index >= 0) {
            rest.splice(index, 1);
            cursor = index;
          }
        }
      }
      words = [...entry.path, ...rest];
    }
    const carry = Array.isArray(options.carry) ? options.carry.map(String) : [];
    words.push(...carry);
    const preview = options.preview === undefined ? Boolean(current.preview) : Boolean(options.preview);
    return runner.run(words, {
      entryId: current.entry_id || undefined,
      title: current.title || undefined,
      trigger: "retry",
      preview,
    });
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
