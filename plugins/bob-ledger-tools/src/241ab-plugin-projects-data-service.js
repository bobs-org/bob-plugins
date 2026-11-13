// Projects shared report/sync service (mixin half). Helpers live in
// 241aa-plugin-projects-data.js.
class BobLedgerToolsProjectsDataMixin {
  projectsTimerApi() {
    if (this.projectsTimers && typeof this.projectsTimers === "object") {
      return this.projectsTimers;
    }
    return typeof window !== "undefined" && window ? window : globalThis;
  }

  projectsSetTimeout(callback, delay) {
    const timers = this.projectsTimerApi();
    const schedule = timers && typeof timers.setTimeout === "function"
      ? timers.setTimeout.bind(timers)
      : setTimeout;
    return schedule(callback, delay);
  }

  projectsClearTimeout(timer) {
    if (timer === null || timer === undefined) {
      return;
    }
    const timers = this.projectsTimerApi();
    const clear = timers && typeof timers.clearTimeout === "function"
      ? timers.clearTimeout.bind(timers)
      : clearTimeout;
    clear(timer);
  }

  projectsReportState() {
    const report = this.projectsReport || null;
    return {
      report,
      stale: Boolean(report && (this.projectsReportStale || (this.projectsReportGeneration || 0) < (this.projectsVaultGeneration || 0))),
      unavailable: !report,
      refreshing: Boolean(this.projectsListFlight),
      error: this.projectsReportError || null,
      errorModel: this.projectsReportError ? projectsErrorModel(this.projectsReportError) : null,
      generation: this.projectsVaultGeneration || 0,
      reportGeneration: this.projectsReportGeneration,
      today: this.projectsLocalDay || projectsLocalDate(),
      syncBusy: Boolean(this.projectsSyncBusy),
      syncError: this.projectsSyncError || null,
      syncErrorModel: this.projectsSyncError ? projectsErrorModel(this.projectsSyncError) : null,
    };
  }

  projectsNotify() {
    if (this.projectsDataActive === false || !(this.projectsSubscribers instanceof Set)) {
      return;
    }
    const state = this.projectsReportState();
    for (const subscriber of this.projectsSubscribers) {
      try {
        subscriber(state);
      } catch (error) {
        // A mounted renderer cannot break shared data refresh for other views.
      }
    }
  }

  projectsWaitersStore() {
    if (!Array.isArray(this.projectsListWaiters)) {
      this.projectsListWaiters = [];
    }
    return this.projectsListWaiters;
  }

  projectsWaitForReportGeneration(generation) {
    return new Promise((resolve) => {
      this.projectsWaitersStore().push({ generation, resolve });
    });
  }

  projectsResolveWaiters(generation = Number.POSITIVE_INFINITY) {
    const waiters = this.projectsWaitersStore();
    const keep = [];
    const state = this.projectsReportState();
    for (const waiter of waiters) {
      if (waiter.generation <= generation || this.projectsDataActive === false) {
        try {
          waiter.resolve(state);
        } catch (error) {
          // Waiter cleanup is best-effort.
        }
      } else {
        keep.push(waiter);
      }
    }
    this.projectsListWaiters = keep;
  }

  projectsSpawnCommand(args, decoder, options = {}) {
    return bobSpawnJson(args, decoder, {
      ...options,
      commandLabel: args && args[1] === "sync" ? "bob projects sync" : "bob projects list",
      resolveBobPath: () =>
        typeof this.apiStatsBobPath === "function"
          ? this.apiStatsBobPath()
          : { path: "bob", source: "path" },
      getVaultPath: () =>
        typeof this.statsVaultBasePath === "function" ? this.statsVaultBasePath() : null,
      timeout: PROJECTS_LIST_TIMEOUT_MS,
      maxBuffer: PROJECTS_LIST_MAX_BUFFER,
      firstLine: statsFirstLine,
    });
  }

  projectsSpawnList(options = {}) {
    return this.projectsSpawnCommand(projectsListArgs(), projectsDecodeListReport, options);
  }

  projectsSpawnSync(options = {}) {
    return this.projectsSpawnCommand(projectsSyncArgs(), projectsDecodeSyncReport, options);
  }

  projectsStartListFetch(generation) {
    const epoch = this.projectsDataEpoch || 0;
    if ((this.projectsQueuedGeneration || 0) <= generation) {
      this.projectsQueuedGeneration = 0;
    }
    const flight = { generation, epoch, promise: null };
    this.projectsListFlight = flight;
    this.projectsNotify();
    const run = async () => {
      try {
        const result = await this.projectsSpawnList();
        if (this.projectsDataActive === false || this.projectsDataEpoch !== epoch) {
          return this.projectsReportState();
        }
        if (result && result.ok && result.report) {
          this.projectsReport = result.report;
          this.projectsReportGeneration = generation;
          this.projectsReportStale = generation < (this.projectsVaultGeneration || 0);
          this.projectsReportError = null;
        } else {
          this.projectsReportStale = Boolean(this.projectsReport);
          this.projectsReportError = result || {
            code: "failed",
            message: "bob projects list failed.",
          };
        }
      } catch (error) {
        if (this.projectsDataActive !== false && this.projectsDataEpoch === epoch) {
          this.projectsReportStale = Boolean(this.projectsReport);
          this.projectsReportError = {
            code: "failed",
            message: error && error.message ? String(error.message) : "bob projects list failed.",
          };
        }
      }
      return this.projectsReportState();
    };
    flight.promise = Promise.resolve()
      .then(run)
      .finally(() => {
        if (this.projectsListFlight !== flight) {
          return;
        }
        this.projectsListFlight = null;
        this.projectsResolveWaiters(generation);
        const queued = this.projectsQueuedGeneration || 0;
        if (
          this.projectsDataActive !== false && queued > generation &&
          this.projectsRevalidateTimer === null
        ) {
          this.projectsQueuedGeneration = 0;
          this.projectsStartListFetch(queued);
        }
        this.projectsNotify();
      });
    return flight;
  }

  apiProjectsReport(options = {}) {
    const opts = projectsJsonObject(options) ? options : {};
    if (this.projectsDataActive === false) {
      return Promise.resolve(this.projectsReportState());
    }
    const target = Math.max(
      this.projectsVaultGeneration || 0,
      Number.isInteger(opts.requiredGeneration) ? opts.requiredGeneration : 0,
    );
    const force = opts.force === true;
    const wait = opts.wait === true;
    if (this.projectsListFlight) {
      const flight = this.projectsListFlight;
      if (target > flight.generation) {
        this.projectsQueuedGeneration = Math.max(this.projectsQueuedGeneration || 0, target);
      }
      if (wait) {
        return this.projectsWaitForReportGeneration(target);
      }
      return Promise.resolve(this.projectsReportState());
    }
    if (
      !force && this.projectsReport && !this.projectsReportStale &&
      (this.projectsReportGeneration || 0) >= target
    ) {
      return Promise.resolve(this.projectsReportState());
    }
    if (force && this.projectsReport) {
      this.projectsReportStale = true;
      this.projectsNotify();
    }
    const generation = Math.max(target, this.projectsVaultGeneration || 0);
    this.projectsStartListFetch(generation);
    if (this.projectsReport && !wait) {
      return Promise.resolve(this.projectsReportState());
    }
    return this.projectsWaitForReportGeneration(generation);
  }

  projectsRevalidateAfterSync() {
    const flight = this.projectsListFlight;
    if (flight && flight.promise) {
      return flight.promise.then(() => {
        if (this.projectsDataActive === false) {
          return this.projectsReportState();
        }
        return this.apiProjectsReport({ force: true, wait: true });
      });
    }
    return this.apiProjectsReport({ force: true, wait: true });
  }

  apiProjectsSubscribe(subscriber) {
    if (typeof subscriber !== "function" || this.projectsDataActive === false) {
      return () => {};
    }
    if (!(this.projectsSubscribers instanceof Set)) {
      this.projectsSubscribers = new Set();
    }
    this.projectsSubscribers.add(subscriber);
    try {
      subscriber(this.projectsReportState());
    } catch (error) {
      // A subscriber may mount before its renderer is ready.
    }
    void this.apiProjectsReport();
    return () => {
      this.projectsSubscribers.delete(subscriber);
    };
  }

  apiProjectsInvalidate(reason = "manual") {
    if (this.projectsDataActive === false) {
      return this.projectsReportState();
    }
    this.projectsVaultGeneration = (this.projectsVaultGeneration || 0) + 1;
    this.projectsInvalidationReason = String(reason || "vault");
    if (this.projectsReport) {
      this.projectsReportStale = true;
    }
    if (this.projectsListFlight) {
      this.projectsQueuedGeneration = Math.max(
        this.projectsQueuedGeneration || 0,
        this.projectsVaultGeneration,
      );
    }
    this.projectsNotify();
    this.projectsScheduleRevalidate(reason);
    return this.projectsReportState();
  }

  projectsScheduleRevalidate(reason = "vault") {
    void reason;
    if (
      this.projectsDataActive === false ||
      !(this.projectsSubscribers instanceof Set) ||
      this.projectsSubscribers.size === 0
    ) {
      return;
    }
    this.projectsClearTimeout(this.projectsRevalidateTimer);
    this.projectsRevalidateTimer = this.projectsSetTimeout(() => {
      this.projectsRevalidateTimer = null;
      if (this.projectsDataActive !== false && this.projectsSubscribers.size > 0) {
        void this.apiProjectsReport({ force: true });
      }
    }, PROJECTS_REVALIDATE_DEBOUNCE_MS);
  }

  projectsFingerprintStore() {
    if (!(this.projectsFingerprintByPath instanceof Map)) {
      this.projectsFingerprintByPath = new Map();
    }
    return this.projectsFingerprintByPath;
  }

  projectsGenerationStore() {
    if (!(this.projectsFingerprintGeneration instanceof Map)) {
      this.projectsFingerprintGeneration = new Map();
    }
    return this.projectsFingerprintGeneration;
  }

  projectsBeginFingerprint(path) {
    const generations = this.projectsGenerationStore();
    const next = (generations.get(path) || 0) + 1;
    generations.set(path, next);
    return next;
  }

  projectsFingerprintIsCurrent(path, generation) {
    return this.projectsGenerationStore().get(path) === generation;
  }

  projectsFrontmatterFor(file, eventData) {
    const payload = projectsEventPayload(eventData);
    if (payload.frontmatter) {
      return payload.frontmatter;
    }
    try {
      const cache = this.app && this.app.metadataCache &&
        typeof this.app.metadataCache.getFileCache === "function"
        ? this.app.metadataCache.getFileCache(file)
        : null;
      return cache && projectsJsonObject(cache.frontmatter) ? cache.frontmatter : {};
    } catch (error) {
      return {};
    }
  }

  projectsCachedText(file) {
    try {
      const cache = this.app && this.app.metadataCache &&
        typeof this.app.metadataCache.getFileCache === "function"
        ? this.app.metadataCache.getFileCache(file)
        : null;
      if (cache && typeof cache.text === "string") {
        return cache.text;
      }
    } catch (error) {
      // Cache text is optional; vault reads fill it when needed.
    }
    try {
      const vault = this.app && this.app.vault;
      if (vault && typeof vault.cachedRead === "function") {
        return vault.cachedRead(file);
      }
      if (vault && typeof vault.read === "function") {
        return vault.read(file);
      }
    } catch (error) {
      return "";
    }
    return "";
  }

  projectsFinishSeedRead() {
    this.projectsSeedPending = Math.max(0, (this.projectsSeedPending || 0) - 1);
    if (
      this.projectsSeeding !== true &&
      (this.projectsSeedPending || 0) === 0 &&
      this.projectsMetadataReady !== true &&
      this.projectsDataActive !== false
    ) {
      this.projectsMetadataReady = true;
    }
  }

  projectsApplyFingerprint(path, next, options = {}) {
    const store = this.projectsFingerprintStore();
    const previous = store.get(path) || null;
    store.set(path, next);
    if (options.invalidate !== false) {
      this.apiProjectsInvalidate(options.reason || "markdown-change");
    }
    if (
      this.projectsMetadataReady &&
      options.sync !== false &&
      projectsFingerprintNeedsSync(previous, next)
    ) {
      this.projectsScheduleSync(options.syncReason || "fingerprint-change");
    }
    return true;
  }

  projectsIngestFile(file, eventData, options = {}) {
    if (this.projectsDataActive === false) {
      return false;
    }
    const path = projectsReportPath(file && file.path);
    if (!path || !projectsRelevantPath(file)) {
      return false;
    }
    const generation = this.projectsBeginFingerprint(path);
    const payload = projectsEventPayload(eventData);
    const frontmatter = this.projectsFrontmatterFor(file, eventData);
    const applyText = (text) => {
      if (this.projectsDataActive === false || !this.projectsFingerprintIsCurrent(path, generation)) {
        return false;
      }
      return this.projectsApplyFingerprint(
        path,
        projectsFingerprint(frontmatter, text),
        options,
      );
    };
    if (payload.text !== null) {
      return applyText(payload.text);
    }
    let read;
    try {
      read = this.projectsCachedText(file);
    } catch (error) {
      read = "";
    }
    if (read && typeof read.then === "function") {
      if (options.seed) {
        this.projectsSeedPending = (this.projectsSeedPending || 0) + 1;
      }
      Promise.resolve(read).then((text) => {
        applyText(typeof text === "string" ? text : "");
        if (options.seed) {
          this.projectsFinishSeedRead();
        }
      }, () => {
        if (this.projectsFingerprintIsCurrent(path, generation)) {
          applyText("");
        }
        if (options.seed) {
          this.projectsFinishSeedRead();
        }
      });
      return true;
    }
    return applyText(typeof read === "string" ? read : "");
  }

  projectsHandleMetadataChanged(file, data) {
    if (this.projectsLayoutReady !== true || this.projectsDataActive === false) {
      return;
    }
    if (projectsRelevantPath(file)) {
      this.projectsIngestFile(file, data, { reason: "metadata-change" });
    }
  }

  projectsHandleVaultEvent(event, file, oldPath) {
    if (this.projectsLayoutReady !== true || this.projectsDataActive === false) {
      return;
    }
    const oldKey = projectsReportPath(oldPath);
    if (event === "delete") {
      const path = projectsReportPath(file);
      const previous = this.projectsFingerprintStore().get(path) || null;
      this.projectsFingerprintStore().delete(path);
      this.projectsBeginFingerprint(path);
      if (projectsRelevantPath(file) || previous) {
        this.apiProjectsInvalidate("markdown-delete");
      }
      if (previous && (previous.isProject || previous.isHost)) {
        this.projectsScheduleSync("project-delete");
      }
      return;
    }
    const currentRelevant = projectsRelevantPath(file);
    const oldRelevant = oldKey ? projectsRelevantPath(oldKey) : false;
    if (!currentRelevant && !oldRelevant) {
      return;
    }
    if (event === "rename" && oldKey) {
      const old = this.projectsFingerprintStore().get(oldKey) || null;
      this.projectsFingerprintStore().delete(oldKey);
      this.projectsBeginFingerprint(oldKey);
      if (old && (old.isProject || old.isHost)) {
        this.projectsScheduleSync("project-rename");
      }
    }
    if (currentRelevant) {
      this.projectsIngestFile(file, null, { reason: `markdown-${event}` });
    } else {
      this.apiProjectsInvalidate(`markdown-${event}`);
    }
  }

  projectsSeedFingerprints(files = null) {
    if (
      this.projectsDataActive === false ||
      this.projectsMetadataReady ||
      this.projectsSeedStarted
    ) {
      return;
    }
    this.projectsSeedStarted = true;
    this.projectsLayoutReady = true;
    this.projectsFingerprintByPath = new Map();
    this.projectsSeedPending = 0;
    this.projectsSeeding = true;
    try {
      const sourceFiles = Array.isArray(files)
        ? files
        : this.app && this.app.vault &&
          typeof this.app.vault.getMarkdownFiles === "function"
          ? this.app.vault.getMarkdownFiles()
          : [];
      for (const file of Array.isArray(sourceFiles) ? sourceFiles : []) {
        if (projectsRelevantPath(file)) {
          this.projectsIngestFile(file, null, {
            invalidate: false,
            sync: false,
            seed: true,
            reason: "seed",
          });
        }
      }
    } catch (error) {
      // Metadata readiness is best-effort; later changes will fill the map.
    }
    this.projectsSeeding = false;
    if ((this.projectsSeedPending || 0) === 0) {
      this.projectsMetadataReady = true;
    }
  }

  projectsScheduleSync(reason = "fingerprint-change") {
    void reason;
    if (this.projectsDataActive === false) {
      return false;
    }
    if (this.projectsSyncFlight || this.projectsSyncBusy) {
      this.projectsSyncTrailing = true;
      return false;
    }
    this.projectsClearTimeout(this.projectsSyncDebounceTimer);
    this.projectsSyncDebounceTimer = this.projectsSetTimeout(() => {
      this.projectsSyncDebounceTimer = null;
      if (this.projectsDataActive !== false && !this.projectsSyncFlight && !this.projectsSyncBusy) {
        void this.apiProjectsSync({ automatic: true });
      }
    }, PROJECTS_SYNC_DEBOUNCE_MS);
    return true;
  }

  apiProjectsSync(options = {}) {
    if (this.projectsDataActive === false) {
      return Promise.resolve({
        ok: false,
        error: { code: "unloaded", message: "Projects data has unloaded." },
      });
    }
    if (this.projectsSyncFlight) {
      return this.projectsSyncFlight;
    }
    this.projectsClearTimeout(this.projectsSyncDebounceTimer);
    this.projectsSyncDebounceTimer = null;
    this.projectsSyncTrailing = false;
    const epoch = this.projectsDataEpoch || 0;
    this.projectsSyncBusy = true;
    this.projectsSyncError = null;
    this.projectsNotify();
    let syncPromise;
    const run = async () => {
      let processResult;
      try {
        processResult = await this.projectsSpawnSync();
      } catch (error) {
        processResult = {
          ok: false,
          code: "failed",
          message: error && error.message ? String(error.message) : "bob projects sync failed.",
        };
      }
      let operation;
      if (!processResult || !processResult.ok || !processResult.report) {
        operation = {
          ok: false,
          error: processResult || { code: "failed", message: "bob projects sync failed." },
          report: null,
        };
      } else if (processResult.report.ok !== true) {
        const failure = processResult.report.error || {};
        operation = {
          ok: false,
          error: {
            code: typeof failure.code === "string" ? failure.code : "sync-refused",
            message: typeof failure.message === "string"
              ? failure.message
              : "bob projects sync found a damaged catalog or could not complete.",
            detail: typeof failure.detail === "string"
              ? failure.detail
              : typeof failure.hint === "string" ? failure.hint : "",
          },
          report: processResult.report,
        };
      } else {
        operation = { ok: true, error: null, report: processResult.report };
      }
      if (this.projectsDataActive === false || this.projectsDataEpoch !== epoch) {
        if (this.projectsSyncFlight === syncPromise) {
          this.projectsSyncFlight = null;
        }
        return { ...operation, refreshed: this.projectsReportState() };
      }
      this.projectsSyncBusy = false;
      this.projectsSyncError = operation.error;
      this.projectsLastSyncReport = operation.report;
      if (this.projectsSyncFlight === syncPromise) {
        this.projectsSyncFlight = null;
      }
      this.projectsNotify();
      let refreshed = this.projectsReportState();
      try {
        refreshed = await this.projectsRevalidateAfterSync();
      } catch (error) {
        // The last list report remains visible as stale/unavailable.
      }
      if (
        this.projectsSyncTrailing === true &&
        this.projectsDataActive !== false && this.projectsDataEpoch === epoch &&
        !this.projectsSyncFlight && !this.projectsSyncBusy
      ) {
        this.projectsSyncTrailing = false;
        this.projectsScheduleSync("trailing-change");
      }
      return { ...operation, refreshed };
    };
    syncPromise = Promise.resolve().then(run).catch(async (error) => {
      const failure = {
        code: "failed",
        message: error && error.message ? String(error.message) : "bob projects sync failed.",
      };
      if (this.projectsDataActive !== false && this.projectsDataEpoch === epoch) {
        this.projectsSyncBusy = false;
        this.projectsSyncError = failure;
        if (this.projectsSyncFlight === syncPromise) {
          this.projectsSyncFlight = null;
        }
        this.projectsNotify();
        try {
          await this.projectsRevalidateAfterSync();
        } catch (ignored) {}
        if (
          this.projectsSyncTrailing === true &&
          this.projectsDataActive !== false && this.projectsDataEpoch === epoch &&
          !this.projectsSyncFlight && !this.projectsSyncBusy
        ) {
          this.projectsSyncTrailing = false;
          this.projectsScheduleSync("trailing-change");
        }
      }
      return { ok: false, error: failure, report: null, refreshed: this.projectsReportState() };
    });
    this.projectsSyncFlight = syncPromise;
    void options;
    return syncPromise;
  }

  projectsRefreshRollover(now = new Date()) {
    const day = projectsLocalDate(now);
    if (!day || day === this.projectsLocalDay) {
      return false;
    }
    this.projectsLocalDay = day;
    this.apiProjectsInvalidate("day-rollover");
    return true;
  }

  setupProjectsData() {
    this.projectsDataActive = true;
    this.projectsDataEpoch = (this.projectsDataEpoch || 0) + 1;
    this.projectsVaultGeneration = 0;
    this.projectsReport = null;
    this.projectsReportGeneration = -1;
    this.projectsReportStale = true;
    this.projectsReportError = null;
    this.projectsSyncBusy = false;
    this.projectsSyncError = null;
    this.projectsSyncFlight = null;
    this.projectsSyncTrailing = false;
    this.projectsListFlight = null;
    this.projectsQueuedGeneration = 0;
    this.projectsListWaiters = [];
    this.projectsSubscribers = new Set();
    this.projectsFingerprintByPath = new Map();
    this.projectsFingerprintGeneration = new Map();
    this.projectsMetadataReady = false;
    this.projectsLayoutReady = false;
    this.projectsSeedStarted = false;
    this.projectsSeedPending = 0;
    this.projectsSeeding = false;
    this.projectsRevalidateTimer = null;
    this.projectsSyncDebounceTimer = null;
    this.projectsRolloverTimer = null;
    this.projectsLocalDay = projectsLocalDate();

    try {
      const metadataCache = this.app && this.app.metadataCache;
      if (metadataCache && typeof metadataCache.on === "function") {
        this.registerEvent(metadataCache.on("changed", (file, data) => this.projectsHandleMetadataChanged(file, data)));
      }
    } catch (error) {
      // Metadata-cache notifications are optional on mobile and test hosts.
    }
    try {
      const vault = this.app && this.app.vault;
      if (vault && typeof vault.on === "function") {
        for (const event of ["create", "modify", "delete", "rename"]) {
          this.registerEvent(vault.on(event, (file, oldPath) => this.projectsHandleVaultEvent(event, file, oldPath)));
        }
      }
    } catch (error) {
      // Vault notifications are optional on partial app hosts.
    }
    try {
      const workspace = this.app && this.app.workspace;
      if (workspace && typeof workspace.on === "function") {
        for (const event of ["file-open", "active-leaf-change"]) {
          this.registerEvent(workspace.on(event, () => this.projectsScheduleRevalidate(`workspace-${event}`)));
        }
      }
      if (workspace && typeof workspace.onLayoutReady === "function") {
        workspace.onLayoutReady(() => {
          this.projectsLayoutReady = true;
          this.projectsSeedFingerprints();
        });
      }
    } catch (error) {
      // Some test hosts do not implement layout readiness.
    }
    try {
      if (typeof this.registerDomEvent === "function" && typeof window !== "undefined" && window) {
        this.registerDomEvent(window, "focus", () => this.projectsScheduleRevalidate("window-focus"));
        if (typeof document !== "undefined" && document) {
          this.registerDomEvent(document, "visibilitychange", () => {
            if (document.visibilityState === "visible") {
              this.projectsScheduleRevalidate("document-visible");
            }
          });
        }
      }
    } catch (error) {
      // Focus and visibility are best-effort on restricted hosts.
    }
    try {
      const timers = this.projectsTimerApi();
      const hasTimerHost = Boolean(
        (this.projectsTimers && typeof this.projectsTimers === "object") ||
        (typeof window !== "undefined" && window),
      );
      const setIntervalFn = hasTimerHost && timers && typeof timers.setInterval === "function"
        ? timers.setInterval.bind(timers)
        : null;
      if (setIntervalFn) {
        this.projectsRolloverTimer = setIntervalFn(() => this.projectsRefreshRollover(new Date()), PROJECTS_ROLLOVER_INTERVAL_MS);
        if (typeof this.registerInterval === "function") {
          this.registerInterval(this.projectsRolloverTimer);
        }
      }
    } catch (error) {
      this.projectsRolloverTimer = null;
    }
  }

  teardownProjectsData() {
    this.projectsDataActive = false;
    this.projectsLayoutReady = false;
    this.projectsSeedStarted = false;
    this.projectsDataEpoch = (this.projectsDataEpoch || 0) + 1;
    this.projectsClearTimeout(this.projectsRevalidateTimer);
    this.projectsClearTimeout(this.projectsSyncDebounceTimer);
    this.projectsRevalidateTimer = null;
    this.projectsSyncDebounceTimer = null;
    this.projectsSyncTrailing = false;
    if (this.projectsRolloverTimer !== null && this.projectsRolloverTimer !== undefined) {
      const timers = this.projectsTimerApi();
      if (timers && typeof timers.clearInterval === "function") {
        timers.clearInterval(this.projectsRolloverTimer);
      }
    }
    this.projectsRolloverTimer = null;
    this.projectsResolveWaiters(0);
    if (this.projectsSubscribers instanceof Set) {
      this.projectsSubscribers.clear();
    }
    if (this.projectsFingerprintByPath instanceof Map) {
      this.projectsFingerprintByPath.clear();
    }
    if (this.projectsFingerprintGeneration instanceof Map) {
      this.projectsFingerprintGeneration.clear();
    }
    this.projectsReport = null;
    this.projectsReportError = null;
    this.projectsSyncBusy = false;
    this.projectsSyncError = null;
  }
}
