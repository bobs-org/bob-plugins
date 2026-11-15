// One stale-while-revalidate Areas report shared by rendered notes. Vault
// changes only refresh the read-only list; catalog writes happen only from
// the explicit Sync action.
class BobLedgerToolsAreasDataMixin {
  areasTimerApi() {
    if (this.areasTimers && typeof this.areasTimers === "object") return this.areasTimers;
    return typeof window !== "undefined" && window ? window : globalThis;
  }

  areasSetTimeout(callback, delay) {
    const timers = this.areasTimerApi();
    const schedule = timers && typeof timers.setTimeout === "function" ? timers.setTimeout.bind(timers) : setTimeout;
    return schedule(callback, delay);
  }

  areasClearTimeout(timer) {
    if (timer === null || timer === undefined) return;
    const timers = this.areasTimerApi();
    const clear = timers && typeof timers.clearTimeout === "function" ? timers.clearTimeout.bind(timers) : clearTimeout;
    clear(timer);
  }

  areasReportState() {
    const report = this.areasReport || null;
    return {
      report,
      stale: Boolean(report && (this.areasReportStale || this.areasReportGeneration < this.areasVaultGeneration)),
      unavailable: !report,
      refreshing: Boolean(this.areasListFlight),
      error: this.areasReportError || null,
      errorModel: this.areasReportError ? areasErrorModel(this.areasReportError) : null,
      generation: this.areasVaultGeneration || 0,
      reportGeneration: this.areasReportGeneration,
      today: this.areasLocalDay || areasLocalDate(),
      syncBusy: Boolean(this.areasSyncBusy),
      syncError: this.areasSyncError || null,
      syncErrorModel: this.areasSyncError ? areasErrorModel(this.areasSyncError) : null,
    };
  }

  areasNotify() {
    if (this.areasDataActive === false || !(this.areasSubscribers instanceof Set)) return;
    const state = this.areasReportState();
    for (const subscriber of this.areasSubscribers) {
      try { subscriber(state); } catch (_error) { /* one pane cannot break another */ }
    }
  }

  areasSpawnCommand(args, decoder) {
    return bobSpawnJson(args, decoder, {
      commandLabel: args && args[1] === "sync" ? "bob areas sync" : "bob areas list",
      resolveBobPath: () => typeof this.apiStatsBobPath === "function" ? this.apiStatsBobPath() : { path: "bob", source: "path" },
      getVaultPath: () => typeof this.statsVaultBasePath === "function" ? this.statsVaultBasePath() : null,
      timeout: AREAS_LIST_TIMEOUT_MS,
      maxBuffer: AREAS_LIST_MAX_BUFFER,
      firstLine: statsFirstLine,
    });
  }

  areasSpawnList() {
    return this.areasSpawnCommand(areasListArgs(), areasDecodeListReport);
  }

  areasSpawnSync() {
    return this.areasSpawnCommand(areasSyncArgs(), areasDecodeSyncReport);
  }

  areasStartListFetch(generation) {
    const epoch = this.areasDataEpoch || 0;
    const flight = { generation, epoch, promise: null };
    this.areasListFlight = flight;
    this.areasNotify();
    const run = async () => {
      try {
        const result = await this.areasSpawnList();
        if (this.areasDataActive === false || this.areasDataEpoch !== epoch) return this.areasReportState();
        if (result && result.ok && result.report) {
          this.areasReport = result.report;
          this.areasReportGeneration = generation;
          this.areasReportStale = generation < (this.areasVaultGeneration || 0);
          this.areasReportError = null;
          for (const entry of result.report.areas || []) this.areasKnownPaths.add(areasReportPath(entry.path));
          if (result.report.root && result.report.root.path) this.areasKnownPaths.add(areasReportPath(result.report.root.path));
        } else {
          this.areasReportStale = Boolean(this.areasReport);
          this.areasReportError = result || { code: "failed", message: "bob areas list failed." };
        }
      } catch (error) {
        if (this.areasDataActive !== false && this.areasDataEpoch === epoch) {
          this.areasReportStale = Boolean(this.areasReport);
          this.areasReportError = { code: "failed", message: error && error.message ? String(error.message) : "bob areas list failed." };
        }
      }
      return this.areasReportState();
    };
    flight.promise = Promise.resolve().then(run).finally(() => {
      if (this.areasListFlight !== flight) return;
      this.areasListFlight = null;
      this.areasNotify();
      if (this.areasDataActive !== false && (this.areasReportGeneration || 0) < (this.areasVaultGeneration || 0)) {
        this.areasScheduleRevalidate("changed-during-fetch");
      }
    });
    return flight;
  }

  apiAreasReport(options = {}) {
    const opts = areasJsonObject(options) ? options : {};
    if (this.areasDataActive === false) return Promise.resolve(this.areasReportState());
    if (this.areasListFlight) {
      const flight = this.areasListFlight;
      if (!opts.wait) return Promise.resolve(this.areasReportState());
      return flight.promise.then(() => {
        if (this.areasReportStale && this.areasDataActive !== false) return this.apiAreasReport({ force: true, wait: true });
        return this.areasReportState();
      });
    }
    if (!opts.force && this.areasReport && !this.areasReportStale && this.areasReportGeneration >= this.areasVaultGeneration) {
      return Promise.resolve(this.areasReportState());
    }
    if (opts.force && this.areasReport) {
      this.areasReportStale = true;
      this.areasNotify();
    }
    const generation = this.areasVaultGeneration || 0;
    const flight = this.areasStartListFetch(generation);
    if (this.areasReport && !opts.wait) return Promise.resolve(this.areasReportState());
    return flight.promise;
  }

  apiAreasSubscribe(subscriber) {
    if (typeof subscriber !== "function" || this.areasDataActive === false) return () => {};
    if (!(this.areasSubscribers instanceof Set)) this.areasSubscribers = new Set();
    this.areasSubscribers.add(subscriber);
    try { subscriber(this.areasReportState()); } catch (_error) { /* render may not be mounted yet */ }
    void this.apiAreasReport();
    return () => this.areasSubscribers.delete(subscriber);
  }

  apiAreasInvalidate(reason = "manual") {
    if (this.areasDataActive === false) return this.areasReportState();
    this.areasVaultGeneration = (this.areasVaultGeneration || 0) + 1;
    this.areasInvalidationReason = String(reason || "vault");
    if (this.areasReport) this.areasReportStale = true;
    this.areasNotify();
    this.areasScheduleRevalidate(reason);
    return this.areasReportState();
  }

  areasScheduleRevalidate(reason = "vault") {
    void reason;
    if (this.areasDataActive === false || !(this.areasSubscribers instanceof Set) || this.areasSubscribers.size === 0) return;
    this.areasClearTimeout(this.areasRevalidateTimer);
    this.areasRevalidateTimer = this.areasSetTimeout(() => {
      this.areasRevalidateTimer = null;
      if (this.areasDataActive !== false && this.areasSubscribers.size > 0) void this.apiAreasReport({ force: true });
    }, AREAS_REVALIDATE_DEBOUNCE_MS);
  }

  areasFrontmatterFor(file, eventData) {
    if (eventData && areasJsonObject(eventData.frontmatter)) return eventData.frontmatter;
    try {
      const cache = this.app?.metadataCache?.getFileCache?.(file);
      return cache && areasJsonObject(cache.frontmatter) ? cache.frontmatter : {};
    } catch (_error) { return {}; }
  }

  areasDailyPath() {
    try { return typeof this.currentTodayDailyPath === "function" ? areasReportPath(this.currentTodayDailyPath(new Date())) : ""; }
    catch (_error) { return ""; }
  }

  areasIsRelevant(fileOrPath, frontmatter = null) {
    const path = areasReportPath(fileOrPath);
    if (!path) return false;
    if (this.areasKnownPaths instanceof Set && this.areasKnownPaths.has(path)) return true;
    const rootPath = this.areasReport?.root?.path || "area.md";
    return areasRelevantPath(fileOrPath, {
      rootPath,
      dailyPath: this.areasDailyPath(),
      frontmatter: frontmatter || (fileOrPath && typeof fileOrPath === "object" ? this.areasFrontmatterFor(fileOrPath) : null),
    });
  }

  areasRememberFile(file, eventData, reason) {
    const path = areasReportPath(file);
    if (!path) return false;
    const wasRelevant = this.areasKnownPaths.has(path) || this.areasIsRelevant(path);
    const frontmatter = this.areasFrontmatterFor(file, eventData);
    const relevant = areasRelevantPath(file, {
      rootPath: this.areasReport?.root?.path || "area.md",
      dailyPath: this.areasDailyPath(),
      frontmatter,
    });
    if (relevant) this.areasKnownPaths.add(path);
    else this.areasKnownPaths.delete(path);
    if (wasRelevant || relevant) this.apiAreasInvalidate(reason);
    return wasRelevant || relevant;
  }

  areasHandleMetadataChanged(file, data) {
    if (this.areasDataActive === false) return;
    this.areasRememberFile(file, data, "metadata-change");
  }

  areasHandleVaultEvent(event, file, oldPath) {
    if (this.areasDataActive === false) return;
    const path = areasReportPath(file);
    const oldKey = areasReportPath(oldPath);
    if (event === "delete") {
      const relevant = this.areasKnownPaths.has(path) || this.areasIsRelevant(path);
      this.areasKnownPaths.delete(path);
      if (relevant) this.apiAreasInvalidate("markdown-delete");
      return;
    }
    const oldRelevant = Boolean(oldKey && (this.areasKnownPaths.has(oldKey) || this.areasIsRelevant(oldKey)));
    if (event === "rename" && oldKey) this.areasKnownPaths.delete(oldKey);
    const frontmatter = this.areasFrontmatterFor(file);
    const currentRelevant = areasRelevantPath(file, {
      rootPath: this.areasReport?.root?.path || "area.md",
      dailyPath: this.areasDailyPath(),
      frontmatter,
    });
    if (currentRelevant) this.areasKnownPaths.add(path);
    else this.areasKnownPaths.delete(path);
    if (oldRelevant || currentRelevant) this.apiAreasInvalidate(`markdown-${event}`);
  }

  areasSeedRelevantPaths(files = null) {
    if (this.areasDataActive === false) return;
    const paths = new Set();
    try {
      const sourceFiles = Array.isArray(files) ? files : this.app?.vault?.getMarkdownFiles?.() || [];
      const rootPath = this.areasReport?.root?.path || "area.md";
      const dailyPath = this.areasDailyPath();
      for (const file of sourceFiles) {
        if (areasRelevantPath(file, { rootPath, dailyPath, frontmatter: this.areasFrontmatterFor(file) })) paths.add(areasReportPath(file));
      }
    } catch (_error) { /* later events populate the set */ }
    this.areasKnownPaths = paths;
  }

  areasRefreshRollover(now = new Date()) {
    const day = areasLocalDate(now);
    if (!day || day === this.areasLocalDay) return false;
    this.areasLocalDay = day;
    this.apiAreasInvalidate("day-rollover");
    return true;
  }

  async apiAreasSync() {
    if (this.areasDataActive === false) return { ok: false, error: { code: "unloaded", message: "Areas data has unloaded." } };
    if (this.areasSyncFlight) return this.areasSyncFlight;
    const epoch = this.areasDataEpoch || 0;
    this.areasSyncBusy = true;
    this.areasSyncError = null;
    this.areasNotify();
    let flight;
    const run = async () => {
      let result;
      try { result = await this.areasSpawnSync(); }
      catch (error) { result = { ok: false, code: "failed", message: error && error.message ? String(error.message) : "bob areas sync failed." }; }
      let operation;
      if (!result || !result.ok || !result.report) operation = { ok: false, error: result || { code: "failed", message: "bob areas sync failed." }, report: null };
      else if (result.report.ok !== true) {
        const error = result.report.error || {};
        operation = { ok: false, error: { code: error.code || "sync-refused", message: error.message || "bob areas sync could not complete.", detail: error.detail || error.hint || "" }, report: result.report };
      } else operation = { ok: true, error: null, report: result.report };
      if (this.areasDataActive === false || this.areasDataEpoch !== epoch) return { ...operation, refreshed: this.areasReportState() };
      this.areasSyncError = operation.error;
      this.areasVaultGeneration = (this.areasVaultGeneration || 0) + 1;
      this.areasReportStale = Boolean(this.areasReport);
      this.areasNotify();
      let refreshed = this.areasReportState();
      try { refreshed = await this.apiAreasReport({ force: true, wait: true }); } catch (_error) { /* keep the last good report */ }
      if (this.areasDataActive !== false && this.areasDataEpoch === epoch) {
        this.areasSyncBusy = false;
        this.areasNotify();
      }
      return { ...operation, refreshed };
    };
    flight = Promise.resolve().then(run).catch((error) => {
      const failure = { code: "failed", message: error && error.message ? String(error.message) : "bob areas sync failed." };
      if (this.areasDataActive !== false && this.areasDataEpoch === epoch) {
        this.areasSyncBusy = false;
        this.areasSyncError = failure;
        this.areasNotify();
      }
      return { ok: false, error: failure, report: null, refreshed: this.areasReportState() };
    }).finally(() => {
      if (this.areasSyncFlight === flight) this.areasSyncFlight = null;
    });
    this.areasSyncFlight = flight;
    return flight;
  }

  setupAreasData() {
    this.areasDataActive = true;
    this.areasDataEpoch = (this.areasDataEpoch || 0) + 1;
    this.areasVaultGeneration = 0;
    this.areasReport = null;
    this.areasReportGeneration = -1;
    this.areasReportStale = true;
    this.areasReportError = null;
    this.areasSyncBusy = false;
    this.areasSyncError = null;
    this.areasSyncFlight = null;
    this.areasListFlight = null;
    this.areasSubscribers = new Set();
    this.areasKnownPaths = new Set();
    this.areasRevalidateTimer = null;
    this.areasRolloverTimer = null;
    this.areasLocalDay = areasLocalDate();
    try {
      const cache = this.app?.metadataCache;
      if (cache?.on) this.registerEvent(cache.on("changed", (file, data) => this.areasHandleMetadataChanged(file, data)));
    } catch (_error) { /* partial app hosts can omit metadata events */ }
    try {
      const vault = this.app?.vault;
      if (vault?.on) for (const event of ["create", "modify", "delete", "rename"]) this.registerEvent(vault.on(event, (file, oldPath) => this.areasHandleVaultEvent(event, file, oldPath)));
    } catch (_error) { /* partial app hosts can omit vault events */ }
    try {
      const workspace = this.app?.workspace;
      if (workspace?.on) for (const event of ["file-open", "active-leaf-change"]) this.registerEvent(workspace.on(event, () => this.areasScheduleRevalidate(`workspace-${event}`)));
      if (workspace?.onLayoutReady) workspace.onLayoutReady(() => this.areasSeedRelevantPaths());
    } catch (_error) { /* layout readiness is optional */ }
    try {
      if (typeof this.registerDomEvent === "function" && typeof window !== "undefined" && window) {
        this.registerDomEvent(window, "focus", () => this.areasScheduleRevalidate("window-focus"));
        if (typeof document !== "undefined" && document) this.registerDomEvent(document, "visibilitychange", () => {
          if (document.visibilityState === "visible") this.areasScheduleRevalidate("document-visible");
        });
      }
    } catch (_error) { /* focus/visibility are best-effort */ }
    try {
      const timers = this.areasTimerApi();
      if (timers?.setInterval && ((this.areasTimers && typeof this.areasTimers === "object") || (typeof window !== "undefined" && window))) {
        this.areasRolloverTimer = timers.setInterval(() => this.areasRefreshRollover(new Date()), AREAS_ROLLOVER_INTERVAL_MS);
        this.registerInterval?.(this.areasRolloverTimer);
      }
    } catch (_error) { this.areasRolloverTimer = null; }
  }

  teardownAreasData() {
    this.areasDataActive = false;
    this.areasDataEpoch = (this.areasDataEpoch || 0) + 1;
    this.areasClearTimeout(this.areasRevalidateTimer);
    this.areasRevalidateTimer = null;
    if (this.areasRolloverTimer !== null && this.areasRolloverTimer !== undefined) {
      try { this.areasTimerApi()?.clearInterval?.(this.areasRolloverTimer); } catch (_error) { /* best-effort */ }
    }
    this.areasRolloverTimer = null;
    this.areasSubscribers?.clear?.();
    this.areasKnownPaths?.clear?.();
    this.areasReport = null;
    this.areasReportError = null;
    this.areasSyncBusy = false;
    this.areasSyncError = null;
  }
}
