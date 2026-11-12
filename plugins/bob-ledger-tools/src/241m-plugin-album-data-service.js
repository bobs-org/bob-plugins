// Album shared report/sync service (mixin half). Helpers live in 241l-plugin-album-data.js.
class BobLedgerToolsAlbumDataMixin {
  albumTimerApi() {
    if (this.albumTimers && typeof this.albumTimers === "object") {
      return this.albumTimers;
    }
    return typeof window !== "undefined" && window ? window : globalThis;
  }

  albumSetTimeout(callback, delay) {
    const timers = this.albumTimerApi();
    const schedule = timers && typeof timers.setTimeout === "function"
      ? timers.setTimeout.bind(timers)
      : setTimeout;
    return schedule(callback, delay);
  }

  albumClearTimeout(timer) {
    if (timer === null || timer === undefined) {
      return;
    }
    const timers = this.albumTimerApi();
    const clear = timers && typeof timers.clearTimeout === "function"
      ? timers.clearTimeout.bind(timers)
      : clearTimeout;
    clear(timer);
  }

  albumReportState() {
    const report = this.albumReport || null;
    return {
      report,
      stale: Boolean(report && (this.albumReportStale || (this.albumReportGeneration || 0) < (this.albumVaultGeneration || 0))),
      unavailable: !report,
      refreshing: Boolean(this.albumListFlight),
      error: this.albumReportError || null,
      errorModel: this.albumReportError ? albumErrorModel(this.albumReportError) : null,
      generation: this.albumVaultGeneration || 0,
      reportGeneration: this.albumReportGeneration,
      today: this.albumLocalDay || albumLocalDate(),
      syncBusy: Boolean(this.albumSyncBusy),
      syncError: this.albumSyncError || null,
      syncErrorModel: this.albumSyncError ? albumErrorModel(this.albumSyncError) : null,
    };
  }

  albumNotify() {
    if (this.albumDataActive === false || !(this.albumSubscribers instanceof Set)) {
      return;
    }
    const state = this.albumReportState();
    for (const subscriber of this.albumSubscribers) {
      try {
        subscriber(state);
      } catch (error) {
        // A mounted renderer cannot break shared data refresh for other views.
      }
    }
  }

  albumWaitersStore() {
    if (!Array.isArray(this.albumListWaiters)) {
      this.albumListWaiters = [];
    }
    return this.albumListWaiters;
  }

  albumWaitForReportGeneration(generation) {
    return new Promise((resolve) => {
      this.albumWaitersStore().push({ generation, resolve });
    });
  }

  albumResolveWaiters(generation = Number.POSITIVE_INFINITY) {
    const waiters = this.albumWaitersStore();
    const keep = [];
    const state = this.albumReportState();
    for (const waiter of waiters) {
      if (waiter.generation <= generation || this.albumDataActive === false) {
        try {
          waiter.resolve(state);
        } catch (error) {
          // Waiter cleanup is best-effort.
        }
      } else {
        keep.push(waiter);
      }
    }
    this.albumListWaiters = keep;
  }

  albumSpawnCommand(args, decoder, options = {}) {
    return bobSpawnJson(args, decoder, {
      ...options,
      commandLabel: args && args[1] === "sync" ? "bob albums sync" : "bob albums list",
      resolveBobPath: () =>
        typeof this.apiStatsBobPath === "function"
          ? this.apiStatsBobPath()
          : { path: "bob", source: "path" },
      getVaultPath: () =>
        typeof this.statsVaultBasePath === "function" ? this.statsVaultBasePath() : null,
      timeout: ALBUM_LIST_TIMEOUT_MS,
      maxBuffer: ALBUM_LIST_MAX_BUFFER,
      firstLine: statsFirstLine,
    });
  }

  albumSpawnList(options = {}) {
    return this.albumSpawnCommand(albumListArgs(), albumDecodeListReport, options);
  }

  albumSpawnSync(options = {}) {
    return this.albumSpawnCommand(albumSyncArgs(), albumDecodeSyncReport, options);
  }

  albumStartListFetch(generation) {
    const epoch = this.albumDataEpoch || 0;
    if ((this.albumQueuedGeneration || 0) <= generation) {
      this.albumQueuedGeneration = 0;
    }
    const flight = { generation, epoch, promise: null };
    this.albumListFlight = flight;
    this.albumNotify();
    const run = async () => {
      try {
        const result = await this.albumSpawnList();
        if (this.albumDataActive === false || this.albumDataEpoch !== epoch) {
          return this.albumReportState();
        }
        if (result && result.ok && result.report) {
          this.albumReport = result.report;
          this.albumReportGeneration = generation;
          this.albumReportStale = generation < (this.albumVaultGeneration || 0);
          this.albumReportError = null;
          this.albumRememberStems(result.report);
        } else {
          this.albumReportStale = Boolean(this.albumReport);
          this.albumReportError = result || {
            code: "failed",
            message: "bob albums list failed.",
          };
        }
      } catch (error) {
        if (this.albumDataActive !== false && this.albumDataEpoch === epoch) {
          this.albumReportStale = Boolean(this.albumReport);
          this.albumReportError = {
            code: "failed",
            message: error && error.message ? String(error.message) : "bob albums list failed.",
          };
        }
      }
      return this.albumReportState();
    };
    flight.promise = Promise.resolve()
      .then(run)
      .finally(() => {
        if (this.albumListFlight !== flight) {
          return;
        }
        this.albumListFlight = null;
        this.albumResolveWaiters(generation);
        const queued = this.albumQueuedGeneration || 0;
        if (
          this.albumDataActive !== false && queued > generation &&
          this.albumRevalidateTimer === null
        ) {
          this.albumQueuedGeneration = 0;
          this.albumStartListFetch(queued);
        }
        this.albumNotify();
      });
    return flight;
  }

  apiAlbumReport(options = {}) {
    const opts = albumJsonObject(options) ? options : {};
    if (this.albumDataActive === false) {
      return Promise.resolve(this.albumReportState());
    }
    const target = Math.max(
      this.albumVaultGeneration || 0,
      Number.isInteger(opts.requiredGeneration) ? opts.requiredGeneration : 0,
    );
    const force = opts.force === true;
    const wait = opts.wait === true;
    if (this.albumListFlight) {
      const flight = this.albumListFlight;
      if (target > flight.generation) {
        this.albumQueuedGeneration = Math.max(this.albumQueuedGeneration || 0, target);
      }
      if (wait) {
        return this.albumWaitForReportGeneration(target);
      }
      return Promise.resolve(this.albumReportState());
    }
    if (
      !force && this.albumReport && !this.albumReportStale &&
      (this.albumReportGeneration || 0) >= target
    ) {
      return Promise.resolve(this.albumReportState());
    }
    if (force && this.albumReport) {
      this.albumReportStale = true;
      this.albumNotify();
    }
    const generation = Math.max(target, this.albumVaultGeneration || 0);
    this.albumStartListFetch(generation);
    if (this.albumReport && !wait) {
      return Promise.resolve(this.albumReportState());
    }
    return this.albumWaitForReportGeneration(generation);
  }

  albumRevalidateAfterSync() {
    const flight = this.albumListFlight;
    if (flight && flight.promise) {
      // A list started before the write cannot prove the catalogs after it.
      // Wait for that flight, then force a new report without overlapping it.
      return flight.promise.then(() => {
        if (this.albumDataActive === false) {
          return this.albumReportState();
        }
        return this.apiAlbumReport({ force: true, wait: true });
      });
    }
    return this.apiAlbumReport({ force: true, wait: true });
  }

  apiAlbumSubscribe(subscriber) {
    if (typeof subscriber !== "function" || this.albumDataActive === false) {
      return () => {};
    }
    if (!(this.albumSubscribers instanceof Set)) {
      this.albumSubscribers = new Set();
    }
    this.albumSubscribers.add(subscriber);
    try {
      subscriber(this.albumReportState());
    } catch (error) {
      // A subscriber may mount before its renderer is ready.
    }
    void this.apiAlbumReport();
    return () => {
      this.albumSubscribers.delete(subscriber);
    };
  }

  apiAlbumInvalidate(reason = "manual") {
    if (this.albumDataActive === false) {
      return this.albumReportState();
    }
    this.albumVaultGeneration = (this.albumVaultGeneration || 0) + 1;
    this.albumInvalidationReason = String(reason || "vault");
    if (this.albumReport) {
      this.albumReportStale = true;
    }
    if (this.albumListFlight) {
      this.albumQueuedGeneration = Math.max(
        this.albumQueuedGeneration || 0,
        this.albumVaultGeneration,
      );
    }
    this.albumNotify();
    this.albumScheduleRevalidate(reason);
    return this.albumReportState();
  }

  albumScheduleRevalidate(reason = "vault") {
    void reason;
    if (
      this.albumDataActive === false ||
      !(this.albumSubscribers instanceof Set) ||
      this.albumSubscribers.size === 0
    ) {
      return;
    }
    this.albumClearTimeout(this.albumRevalidateTimer);
    this.albumRevalidateTimer = this.albumSetTimeout(() => {
      this.albumRevalidateTimer = null;
      if (this.albumDataActive !== false && this.albumSubscribers.size > 0) {
        void this.apiAlbumReport({ force: true });
      }
    }, ALBUM_REVALIDATE_DEBOUNCE_MS);
  }

  albumKnownStemsStore() {
    if (!(this.albumKnownStems instanceof Set)) {
      this.albumKnownStems = new Set();
    }
    return this.albumKnownStems;
  }

  albumRememberStems(report) {
    const stems = this.albumKnownStemsStore();
    if (report && Array.isArray(report.albums)) {
      for (const album of report.albums) {
        if (album && typeof album.stem === "string" && album.stem) {
          stems.add(album.stem);
        }
      }
    }
  }

  albumFrontmatterFor(file, eventData) {
    if (eventData && albumJsonObject(eventData.frontmatter)) {
      return eventData.frontmatter;
    }
    try {
      const cache = this.app && this.app.metadataCache &&
        typeof this.app.metadataCache.getFileCache === "function"
        ? this.app.metadataCache.getFileCache(file)
        : null;
      return cache && albumJsonObject(cache.frontmatter) ? cache.frontmatter : {};
    } catch (error) {
      return {};
    }
  }

  albumRecordFrontmatter(file, eventData, options = {}) {
    if (!albumRelevantPath(file)) {
      return false;
    }
    if (!(this.albumFrontmatterByPath instanceof Map)) {
      this.albumFrontmatterByPath = new Map();
    }
    const path = albumReportPath(file.path);
    const previous = this.albumFrontmatterByPath.get(path) || null;
    const next = albumFrontmatterFingerprint(this.albumFrontmatterFor(file, eventData));
    // Store first so generated index writes and any event observed during
    // a sync do not cause the same metadata transition to schedule again.
    this.albumFrontmatterByPath.set(path, next);
    if (next.isAlbum && path) {
      const stem = path.replace(/\.md$/i, "").split("/").pop();
      if (stem) {
        this.albumKnownStemsStore().add(stem);
      }
    }
    if (options.invalidate !== false) {
      this.apiAlbumInvalidate(options.reason || "markdown-change");
    }
    if (
      this.albumMetadataReady &&
      albumFingerprintNeedsSync(previous, next, path, this.albumKnownStemsStore())
    ) {
      const ownPaths = this.albumUpdateOwnPaths instanceof Set ? this.albumUpdateOwnPaths : null;
      if (ownPaths && ownPaths.has(path)) {
        // The writer's own echo: invalidate the display data (already done
        // by the caller via apiAlbumInvalidate) but schedule no duplicate
        // sync or commit for a write the apply lifecycle already owns.
      } else {
        this.albumScheduleSync(options.syncReason || "frontmatter-change");
      }
    }
    return true;
  }

  albumHandleMetadataChanged(file, data) {
    if (albumRelevantPath(file)) {
      this.albumRecordFrontmatter(file, data, { reason: "metadata-change" });
    }
  }

  albumHandleVaultEvent(event, file, oldPath) {
    const oldKey = albumReportPath(oldPath);
    if (event === "delete") {
      const previous = this.albumFrontmatterByPath instanceof Map
        ? this.albumFrontmatterByPath.get(albumReportPath(file))
        : null;
      if (this.albumFrontmatterByPath instanceof Map) {
        this.albumFrontmatterByPath.delete(albumReportPath(file));
      }
      if (albumRelevantPath(file)) {
        this.apiAlbumInvalidate("markdown-delete");
      }
      if (previous && (previous.isAlbum || previous.isOwner || albumIsMember(previous, file, this.albumKnownStemsStore()))) {
        this.albumScheduleSync("album-delete");
      }
      return;
    }
    const currentRelevant = albumRelevantPath(file);
    const oldRelevant = oldKey ? albumRelevantPath(oldKey) : false;
    if (!currentRelevant && !oldRelevant) {
      return;
    }
    if (event === "rename" && oldKey && this.albumFrontmatterByPath instanceof Map) {
      const old = this.albumFrontmatterByPath.get(oldKey) || null;
      this.albumFrontmatterByPath.delete(oldKey);
      // Renames cross membership boundaries under either identity: the old
      // folder or parent link may have owned the record, and the new one
      // may own it now. Schedule from the old identity; the record below
      // schedules again when the new identity is relevant.
      if (old && (old.isAlbum || old.isOwner || albumIsMember(old, oldKey, this.albumKnownStemsStore()))) {
        this.albumScheduleSync("album-rename");
      }
    }
    if (currentRelevant) {
      this.albumRecordFrontmatter(file, null, { reason: `markdown-${event}` });
    } else {
      this.apiAlbumInvalidate(`markdown-${event}`);
    }
  }

  albumSeedFrontmatterFingerprints(files = null) {
    if (this.albumDataActive === false || this.albumMetadataReady) {
      return;
    }
    const next = new Map();
    try {
      const sourceFiles = Array.isArray(files)
        ? files
        : this.app && this.app.vault &&
          typeof this.app.vault.getMarkdownFiles === "function"
          ? this.app.vault.getMarkdownFiles()
          : [];
      for (const file of Array.isArray(sourceFiles) ? sourceFiles : []) {
        if (albumRelevantPath(file)) {
          const fingerprint = albumFrontmatterFingerprint(this.albumFrontmatterFor(file));
          next.set(albumReportPath(file.path), fingerprint);
          if (fingerprint.isAlbum) {
            const stem = albumReportPath(file.path).replace(/\.md$/i, "").split("/").pop();
            if (stem) {
              this.albumKnownStemsStore().add(stem);
            }
          }
        }
      }
    } catch (error) {
      // Metadata readiness is best-effort; later changes will fill the map.
    }
    this.albumFrontmatterByPath = next;
    this.albumMetadataReady = true;
  }

  albumScheduleSync(reason = "frontmatter-change") {
    void reason;
    if (this.albumDataActive === false) {
      return false;
    }
    if (this.albumUpdateFlight || this.albumUpdateBusy) {
      // A schema apply owns the write lifecycle: never overlap it with a
      // sync. Unrelated changes are remembered, not discarded, and run as
      // one trailing sync after the apply and its refresh settle.
      this.albumSyncTrailing = true;
      return false;
    }
    if (this.albumSyncFlight || this.albumSyncBusy) {
      // A real frontmatter change that arrives during a sync is not
      // discarded: it coalesces into one trailing sync after this flight.
      this.albumSyncTrailing = true;
      return false;
    }
    this.albumClearTimeout(this.albumSyncDebounceTimer);
    this.albumSyncDebounceTimer = this.albumSetTimeout(() => {
      this.albumSyncDebounceTimer = null;
      if (this.albumDataActive !== false && !this.albumSyncFlight && !this.albumSyncBusy) {
        void this.apiAlbumSync({ automatic: true });
      }
    }, ALBUM_SYNC_DEBOUNCE_MS);
    return true;
  }

  apiAlbumSync(options = {}) {
    if (this.albumDataActive === false) {
      return Promise.resolve({ ok: false, error: { code: "unloaded", message: "Album data has unloaded." } });
    }
    if (this.albumSyncFlight) {
      return this.albumSyncFlight;
    }
    this.albumClearTimeout(this.albumSyncDebounceTimer);
    this.albumSyncDebounceTimer = null;
    this.albumSyncTrailing = false;
    const epoch = this.albumDataEpoch || 0;
    this.albumSyncBusy = true;
    this.albumSyncError = null;
    this.albumNotify();
    let syncPromise;
    const run = async () => {
      let processResult;
      try {
        processResult = await this.albumSpawnSync();
      } catch (error) {
        processResult = {
          ok: false,
          code: "failed",
          message: error && error.message ? String(error.message) : "bob albums sync failed.",
        };
      }
      let operation;
      if (!processResult || !processResult.ok || !processResult.report) {
        operation = {
          ok: false,
          error: processResult || { code: "failed", message: "bob albums sync failed." },
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
              : "bob albums sync found a damaged catalog or could not complete.",
            detail: typeof failure.detail === "string"
              ? failure.detail
              : typeof failure.hint === "string" ? failure.hint : "",
          },
          report: processResult.report,
        };
      } else {
        operation = { ok: true, error: null, report: processResult.report };
      }
      if (this.albumDataActive === false || this.albumDataEpoch !== epoch) {
        if (this.albumSyncFlight === syncPromise) {
          this.albumSyncFlight = null;
        }
        return { ...operation, refreshed: this.albumReportState() };
      }
      this.albumSyncBusy = false;
      this.albumSyncError = operation.error;
      this.albumLastSyncReport = operation.report;
      if (this.albumSyncFlight === syncPromise) {
        this.albumSyncFlight = null;
      }
      this.albumNotify();
      let refreshed = this.albumReportState();
      try {
        // Re-read even after a partial/refused sync. Catalog state comes from
        // the list report, never from the sync command's optimistic result.
        refreshed = await this.albumRevalidateAfterSync();
      } catch (error) {
        // The last report remains visible as stale/unavailable on failure.
      }
      if (
        this.albumSyncTrailing === true &&
        this.albumDataActive !== false && this.albumDataEpoch === epoch &&
        !this.albumSyncFlight && !this.albumSyncBusy
      ) {
        this.albumSyncTrailing = false;
        this.albumScheduleSync("trailing-change");
      }
      return { ...operation, refreshed };
    };
    syncPromise = Promise.resolve().then(run).catch(async (error) => {
      const failure = {
        code: "failed",
        message: error && error.message ? String(error.message) : "bob albums sync failed.",
      };
      if (this.albumDataActive !== false && this.albumDataEpoch === epoch) {
        this.albumSyncBusy = false;
        this.albumSyncError = failure;
        if (this.albumSyncFlight === syncPromise) {
          this.albumSyncFlight = null;
        }
        this.albumNotify();
        try {
          await this.albumRevalidateAfterSync();
        } catch (ignored) {}
        if (
          this.albumSyncTrailing === true &&
          this.albumDataActive !== false && this.albumDataEpoch === epoch &&
          !this.albumSyncFlight && !this.albumSyncBusy
        ) {
          this.albumSyncTrailing = false;
          this.albumScheduleSync("trailing-change");
        }
      }
      return { ok: false, error: failure, report: null, refreshed: this.albumReportState() };
    });
    this.albumSyncFlight = syncPromise;
    void options;
    return syncPromise;
  }

  albumRefreshRollover(now = new Date()) {
    const day = albumLocalDate(now);
    if (!day || day === this.albumLocalDay) {
      return false;
    }
    this.albumLocalDay = day;
    this.albumNotify();
    return true;
  }

  setupAlbumData() {
    this.albumDataActive = true;
    this.albumDataEpoch = (this.albumDataEpoch || 0) + 1;
    this.albumVaultGeneration = 0;
    this.albumReport = null;
    this.albumReportGeneration = -1;
    this.albumReportStale = true;
    this.albumReportError = null;
    this.albumSyncBusy = false;
    this.albumSyncError = null;
    this.albumSyncFlight = null;
    this.albumSyncTrailing = false;
    this.albumUpdateFlight = null;
    this.albumUpdateBusy = false;
    this.albumUpdateOwnPaths = new Set();
    this.albumListFlight = null;
    this.albumQueuedGeneration = 0;
    this.albumListWaiters = [];
    this.albumSubscribers = new Set();
    this.albumFrontmatterByPath = new Map();
    this.albumKnownStems = new Set();
    this.albumMetadataReady = false;
    this.albumRevalidateTimer = null;
    this.albumSyncDebounceTimer = null;
    this.albumRolloverTimer = null;
    this.albumLocalDay = albumLocalDate();

    try {
      const metadataCache = this.app && this.app.metadataCache;
      if (metadataCache && typeof metadataCache.on === "function") {
        this.registerEvent(metadataCache.on("changed", (file, data) => this.albumHandleMetadataChanged(file, data)));
      }
    } catch (error) {
      // Metadata-cache notifications are optional on mobile and test hosts.
    }
    try {
      const vault = this.app && this.app.vault;
      if (vault && typeof vault.on === "function") {
        for (const event of ["create", "modify", "delete", "rename"]) {
          this.registerEvent(vault.on(event, (file, oldPath) => this.albumHandleVaultEvent(event, file, oldPath)));
        }
      }
    } catch (error) {
      // Vault notifications are optional on partial app hosts.
    }
    try {
      const workspace = this.app && this.app.workspace;
      if (workspace && typeof workspace.on === "function") {
        for (const event of ["file-open", "active-leaf-change"]) {
          this.registerEvent(workspace.on(event, () => this.albumScheduleRevalidate(`workspace-${event}`)));
        }
      }
      if (workspace && typeof workspace.onLayoutReady === "function") {
        workspace.onLayoutReady(() => this.albumSeedFrontmatterFingerprints());
      }
    } catch (error) {
      // Some test hosts do not implement layout readiness.
    }
    try {
      if (typeof this.registerDomEvent === "function" && typeof window !== "undefined" && window) {
        this.registerDomEvent(window, "focus", () => this.albumScheduleRevalidate("window-focus"));
        if (typeof document !== "undefined" && document) {
          this.registerDomEvent(document, "visibilitychange", () => {
            if (document.visibilityState === "visible") {
              this.albumScheduleRevalidate("document-visible");
            }
          });
        }
      }
    } catch (error) {
      // Focus and visibility are best-effort on restricted hosts.
    }
    try {
      const timers = this.albumTimerApi();
      const hasTimerHost = Boolean(
        (this.albumTimers && typeof this.albumTimers === "object") ||
        (typeof window !== "undefined" && window),
      );
      const setIntervalFn = hasTimerHost && timers && typeof timers.setInterval === "function"
        ? timers.setInterval.bind(timers)
        : null;
      if (setIntervalFn) {
        this.albumRolloverTimer = setIntervalFn(() => this.albumRefreshRollover(new Date()), ALBUM_ROLLOVER_INTERVAL_MS);
        if (typeof this.registerInterval === "function") {
          this.registerInterval(this.albumRolloverTimer);
        }
      }
    } catch (error) {
      this.albumRolloverTimer = null;
    }
  }

  teardownAlbumData() {
    this.albumDataActive = false;
    this.albumDataEpoch = (this.albumDataEpoch || 0) + 1;
    this.albumClearTimeout(this.albumRevalidateTimer);
    this.albumClearTimeout(this.albumSyncDebounceTimer);
    this.albumRevalidateTimer = null;
    this.albumSyncDebounceTimer = null;
    this.albumSyncTrailing = false;
    if (this.albumRolloverTimer !== null && this.albumRolloverTimer !== undefined) {
      const timers = this.albumTimerApi();
      if (timers && typeof timers.clearInterval === "function") {
        timers.clearInterval(this.albumRolloverTimer);
      }
    }
    this.albumRolloverTimer = null;
    this.albumResolveWaiters(0);
    if (this.albumSubscribers instanceof Set) {
      this.albumSubscribers.clear();
    }
    if (this.albumFrontmatterByPath instanceof Map) {
      this.albumFrontmatterByPath.clear();
    }
    if (this.albumKnownStems instanceof Set) {
      this.albumKnownStems.clear();
    }
    this.albumReport = null;
    this.albumReportError = null;
    this.albumSyncBusy = false;
    this.albumSyncError = null;
    this.albumUpdateBusy = false;
    this.albumUpdateFlight = null;
    if (this.albumUpdateOwnPaths instanceof Set) {
      this.albumUpdateOwnPaths.clear();
    }
  }
}
