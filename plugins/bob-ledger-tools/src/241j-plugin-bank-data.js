// Shared bank data service: cached `bob bank list|report` reads, filtered
// invalidation, subscribe/teardown. Bob owns every total; this fragment
// only moves JSON. A late response never overwrites a newer generation.

class BobLedgerToolsBankDataMixin {
  bankTimerApi() {
    if (this.bankTimers && typeof this.bankTimers === "object") {
      return this.bankTimers;
    }
    return typeof window !== "undefined" && window ? window : globalThis;
  }

  bankSetTimeout(callback, delay) {
    const timers = this.bankTimerApi();
    const schedule = timers && typeof timers.setTimeout === "function"
      ? timers.setTimeout.bind(timers)
      : setTimeout;
    return schedule(callback, delay);
  }

  bankClearTimeout(timer) {
    if (timer === null || timer === undefined) {
      return;
    }
    const timers = this.bankTimerApi();
    const clear = timers && typeof timers.clearTimeout === "function"
      ? timers.clearTimeout.bind(timers)
      : clearTimeout;
    clear(timer);
  }

  bankCacheStore() {
    if (!(this.bankCache instanceof Map)) {
      this.bankCache = new Map();
    }
    return this.bankCache;
  }

  bankMountsStore() {
    if (!(this.bankMounts instanceof Set)) {
      this.bankMounts = new Set();
    }
    return this.bankMounts;
  }

  bankFlightsStore() {
    if (!(this.bankFlights instanceof Map)) {
      this.bankFlights = new Map();
    }
    return this.bankFlights;
  }

  bankPendingStore() {
    if (!(this.bankPendingFetches instanceof Map)) {
      this.bankPendingFetches = new Map();
    }
    return this.bankPendingFetches;
  }

  bankLatestStore() {
    if (!(this.bankLatestGeneration instanceof Map)) {
      this.bankLatestGeneration = new Map();
    }
    return this.bankLatestGeneration;
  }

  bankCacheGet(key) {
    const store = this.bankCacheStore();
    const entry = store.get(key);
    if (!entry) {
      return null;
    }
    store.delete(key);
    store.set(key, entry);
    return entry;
  }

  bankCacheSet(key, report, generation) {
    const store = this.bankCacheStore();
    const existing = store.get(key);
    if (existing && Number(existing.generation) > Number(generation)) {
      return existing;
    }
    if (store.has(key)) {
      store.delete(key);
    }
    const entry = { report, fetchedAt: Date.now(), generation: Number(generation) || 0 };
    store.set(key, entry);
    while (store.size > BANK_CACHE_SIZE) {
      const oldest = store.keys().next();
      if (oldest.done) {
        break;
      }
      store.delete(oldest.value);
    }
    return entry;
  }

  bankLastGoodReport(key) {
    const cached = this.bankCacheGet(key);
    return cached ? cached.report : null;
  }

  bankUnloadedResult(key) {
    return {
      report: null,
      stale: false,
      key,
      error: { code: "unloaded", message: "Bank data has unloaded.", detail: "" },
    };
  }

  bankSpawnFetch(args, options = {}) {
    const command = Array.isArray(args) && args[1] === "report" ? "report" : "list";
    const decoder = command === "report" ? bankDecodeReport : bankDecodeList;
    return bobSpawnJson(args, decoder, {
      ...options,
      commandLabel: command === "report" ? "bob bank report" : "bob bank list",
      resolveBobPath: () =>
        typeof this.apiStatsBobPath === "function"
          ? this.apiStatsBobPath()
          : { path: "bob", source: "path" },
      getVaultPath: () =>
        typeof this.statsVaultBasePath === "function"
          ? this.statsVaultBasePath()
          : null,
      timeout: BOB_SPAWN_TIMEOUT_MS,
      maxBuffer: BOB_SPAWN_MAX_BUFFER,
      firstLine: statsFirstLine,
    });
  }

  bankFetchesFor(spec = {}) {
    const opts = bankJsonObject(spec) ? spec : {};
    if (Array.isArray(opts.fetches)) {
      return opts.fetches.filter((entry) => bankJsonObject(entry));
    }
    const fetches = [];
    if (opts.list === true || opts.command === "list") {
      fetches.push({ command: "list", all: opts.all === true, month: opts.month });
    }
    if (opts.command === "report" || opts.report === true || opts.month || opts.date || opts.day) {
      fetches.push({
        command: "report",
        month: opts.month,
        date: opts.date,
        day: opts.day,
        week: opts.week,
        year: opts.year,
      });
    }
    if (fetches.length === 0 && (opts.month || opts.date || opts.day)) {
      fetches.push({ command: "report", month: opts.month, date: opts.date, day: opts.day });
    }
    if (fetches.length === 0) {
      fetches.push({ command: "list" });
    }
    return fetches;
  }

  apiBankFetch(options = {}) {
    const opts = bankJsonObject(options) ? options : {};
    const force = opts.force === true;
    const args = bankBuildArgs(opts);
    const key = bankCacheKey(args);
    if (this.bankDataActive === false) {
      return Promise.resolve(this.bankUnloadedResult(key));
    }
    const generation = Math.max(
      this.bankVaultGeneration || 0,
      Number.isInteger(opts.requiredGeneration) ? opts.requiredGeneration : 0,
    );
    this.bankLatestStore().set(key, Math.max(this.bankLatestStore().get(key) || 0, generation));
    const cached = this.bankCacheGet(key);
    const flight = this.bankFlightsStore().get(key);
    if (flight) {
      if (!force && generation <= flight.generation && cached) {
        return Promise.resolve({
          report: cached.report,
          stale: true,
          error: null,
          key,
          generation: cached.generation,
        });
      }
      if (!force && generation <= flight.generation) {
        return flight.promise;
      }
      return this.bankQueueFetch(key, args, opts, generation, true);
    }
    if (cached && !force && generation <= (cached.generation || 0)) {
      this.bankStartFetch(args, key, { ...opts, force: true }, generation);
      return Promise.resolve({
        report: cached.report,
        stale: true,
        error: null,
        key,
        generation: cached.generation,
      });
    }
    return this.bankStartFetch(args, key, opts, generation).promise;
  }

  apiBankRefresh(options = {}) {
    return this.apiBankFetch({ ...(bankJsonObject(options) ? options : {}), force: true });
  }

  bankQueueFetch(key, args, opts, generation, waitForResult) {
    const pendingStore = this.bankPendingStore();
    let resolve = null;
    const result = waitForResult
      ? new Promise((done) => { resolve = done; })
      : null;
    let pending = pendingStore.get(key);
    if (!pending) {
      pending = { key, args, opts: { ...opts, force: true }, generation, waiters: [] };
      pendingStore.set(key, pending);
    } else {
      pending.opts = { ...pending.opts, ...opts, force: true };
      pending.generation = Math.max(pending.generation, generation);
      pending.args = args;
    }
    this.bankLatestStore().set(key, Math.max(this.bankLatestStore().get(key) || 0, generation));
    if (resolve) {
      pending.waiters.push(resolve);
    }
    return result || Promise.resolve({ report: null, stale: false, error: null, queued: true, key });
  }

  bankStartFetch(args, key, opts, requiredGeneration) {
    const epoch = this.bankDataEpoch || 0;
    const generation = Math.max(
      this.bankVaultGeneration || 0,
      Number.isInteger(requiredGeneration) ? requiredGeneration : 0,
    );
    this.bankLatestStore().set(key, Math.max(this.bankLatestStore().get(key) || 0, generation));
    const flight = { key, args, opts: { ...opts }, generation, epoch, promise: null };
    const run = async () => {
      if (this.bankDataActive === false || this.bankDataEpoch !== epoch) {
        return this.bankUnloadedResult(key);
      }
      try {
        const result = await this.bankSpawnFetch(args, opts);
        if (this.bankDataActive === false || this.bankDataEpoch !== epoch) {
          return this.bankUnloadedResult(key);
        }
        const latest = this.bankLatestStore().get(key) || 0;
        const superseded = generation < latest;
        if (result && result.ok) {
          this.bankCacheSet(key, result.report, generation);
          return {
            report: result.report,
            stale: superseded,
            error: null,
            key,
            generation,
          };
        }
        const staleReport = this.bankLastGoodReport(key);
        return {
          report: staleReport,
          stale: Boolean(staleReport),
          error: result || { code: "failed", message: "bob bank failed.", detail: "" },
          key,
          generation,
        };
      } catch (error) {
        const staleReport = this.bankLastGoodReport(key);
        return {
          report: staleReport,
          stale: Boolean(staleReport),
          error: {
            ok: false,
            code: "failed",
            message: error && error.message ? String(error.message) : "bob bank failed.",
            detail: "",
          },
          key,
          generation,
        };
      }
    };
    flight.promise = Promise.resolve()
      .then(run)
      .then((outcome) => {
        if (this.bankDataActive !== false && this.bankDataEpoch === epoch) {
          this.bankDeliverFetchResult(flight, outcome);
        }
        return outcome;
      })
      .finally(() => {
        if (this.bankFlightsStore().get(key) === flight) {
          this.bankFlightsStore().delete(key);
          this.bankStartNextFetch(key, epoch);
        }
      });
    this.bankFlightsStore().set(key, flight);
    return flight;
  }

  bankStartNextFetch(key, epoch = this.bankDataEpoch || 0) {
    if (this.bankDataActive === false || this.bankDataEpoch !== epoch) {
      return;
    }
    const pending = this.bankPendingStore().get(key);
    if (!pending) {
      return;
    }
    this.bankPendingStore().delete(key);
    const next = this.bankStartFetch(pending.args, key, pending.opts, pending.generation);
    for (const waiter of pending.waiters) {
      next.promise.then(waiter, () => waiter(this.bankUnloadedResult(key)));
    }
  }

  bankDeliverFetchResult(flight, result) {
    if (!flight || !result || this.bankDataActive === false) {
      return;
    }
    for (const mount of this.bankMountsStore()) {
      if (!mount || mount.unloaded === true) {
        continue;
      }
      const keys = (mount.keys || []).map((entry) => entry.key);
      if (!keys.includes(flight.key)) {
        continue;
      }
      try {
        mount.subscriber(this.bankMountState(mount));
      } catch (error) {
        // A mounted renderer cannot break shared bank refresh.
      }
    }
  }

  bankMountState(mount) {
    const results = {};
    let stale = false;
    let error = null;
    for (const entry of mount.keys || []) {
      const cached = this.bankCacheGet(entry.key);
      const flight = this.bankFlightsStore().get(entry.key);
      results[entry.key] = {
        report: cached ? cached.report : null,
        stale: Boolean(
          cached && (
            (cached.generation || 0) < (this.bankVaultGeneration || 0) ||
            (this.bankLatestStore().get(entry.key) || 0) > (cached.generation || 0)
          ),
        ),
        error: null,
        refreshing: Boolean(flight),
        args: entry.args,
      };
      if (results[entry.key].stale) {
        stale = true;
      }
    }
    return {
      results,
      stale,
      error,
      generation: this.bankVaultGeneration || 0,
      today: this.bankLocalDay || bankLocalDate(),
    };
  }

  apiBankSubscribe(spec, subscriber) {
    if (typeof subscriber !== "function" || this.bankDataActive === false) {
      return () => {};
    }
    const fetches = this.bankFetchesFor(spec);
    const keys = fetches.map((options) => {
      const args = bankBuildArgs(options);
      return { options, args, key: bankCacheKey(args) };
    });
    const mount = { spec, subscriber, keys, unloaded: false };
    this.bankMountsStore().add(mount);
    try {
      subscriber(this.bankMountState(mount));
    } catch (error) {
      // A subscriber may mount before its renderer is ready.
    }
    for (const entry of keys) {
      void this.apiBankFetch(entry.options);
    }
    return () => {
      mount.unloaded = true;
      this.bankMountsStore().delete(mount);
    };
  }

  apiBankInvalidate(reason = "manual") {
    if (this.bankDataActive === false) {
      return;
    }
    this.bankVaultGeneration = (this.bankVaultGeneration || 0) + 1;
    this.bankInvalidationReason = String(reason || "vault");
    this.bankScheduleRevalidate(reason);
  }

  apiBankMonthPaths() {
    try {
      const files = this.app && this.app.vault && typeof this.app.vault.getMarkdownFiles === "function"
        ? this.app.vault.getMarkdownFiles()
        : [];
      return bankDiscoverMonthPaths(files);
    } catch (error) {
      return [];
    }
  }

  bankApi() {
    return Object.freeze({
      version: 1,
      fetch: (options) => this.apiBankFetch(options),
      refresh: (options) => this.apiBankRefresh(options),
      subscribe: (spec, subscriber) => this.apiBankSubscribe(spec, subscriber),
      invalidate: (reason) => this.apiBankInvalidate(reason),
      monthPaths: () => this.apiBankMonthPaths(),
      locateHeading: (source, month, date) => bankLocateDayHeading(source, month, date),
      recognize: (path, source, line) => bankRecognizeRow(path, source, line),
      ...(typeof this.apiBankActions === "function" ? this.apiBankActions() : {}),
    });
  }

  bankScheduleRevalidate(reason = "vault") {
    void reason;
    if (this.bankDataActive === false || this.bankMountsStore().size === 0) {
      return;
    }
    this.bankClearTimeout(this.bankRevalidateTimer);
    this.bankRevalidateTimer = this.bankSetTimeout(() => {
      this.bankRevalidateTimer = null;
      this.bankRevalidateMounts();
    }, BANK_REVALIDATE_DEBOUNCE_MS);
  }

  bankRevalidateMounts() {
    if (this.bankDataActive === false) {
      return;
    }
    const generation = this.bankVaultGeneration || 0;
    const seen = new Set();
    for (const mount of this.bankMountsStore()) {
      if (!mount || mount.unloaded === true) {
        continue;
      }
      for (const entry of mount.keys || []) {
        if (seen.has(entry.key)) {
          continue;
        }
        seen.add(entry.key);
        void this.apiBankFetch({
          ...entry.options,
          force: true,
          requiredGeneration: generation,
        });
      }
    }
  }

  bankHandleFileEvent(file, oldPath) {
    const current = bankRelevantPath(file);
    const previous = oldPath ? bankRelevantPath(oldPath) : false;
    if (!current && !previous) {
      return;
    }
    this.apiBankInvalidate("vault");
  }

  bankRefreshRollover(now = new Date()) {
    const day = bankLocalDate(now);
    if (!day) {
      return false;
    }
    if (this.bankLocalDay === null || this.bankLocalDay === undefined) {
      this.bankLocalDay = day;
      return false;
    }
    if (this.bankLocalDay === day) {
      return false;
    }
    this.bankLocalDay = day;
    this.apiBankInvalidate("local-date-rollover");
    return true;
  }

  setupBankData() {
    this.bankDataActive = true;
    this.bankDataEpoch = (this.bankDataEpoch || 0) + 1;
    this.bankVaultGeneration = 0;
    this.bankCache = new Map();
    this.bankMounts = new Set();
    this.bankFlights = new Map();
    this.bankPendingFetches = new Map();
    this.bankLatestGeneration = new Map();
    this.bankRevalidateTimer = null;
    this.bankRolloverTimer = null;
    this.bankLocalDay = bankLocalDate();
    try {
      const metadataCache = this.app && this.app.metadataCache;
      if (metadataCache && typeof metadataCache.on === "function") {
        this.registerEvent(metadataCache.on("changed", (file) => this.bankHandleFileEvent(file)));
      }
    } catch (error) {
      // Metadata-cache revalidation is best-effort.
    }
    try {
      const vault = this.app && this.app.vault;
      if (vault && typeof vault.on === "function") {
        for (const event of ["create", "modify", "delete", "rename"]) {
          this.registerEvent(vault.on(event, (file, oldPath) => this.bankHandleFileEvent(file, oldPath)));
        }
      }
    } catch (error) {
      // Vault revalidation is best-effort.
    }
    try {
      const workspace = this.app && this.app.workspace;
      if (workspace && typeof workspace.on === "function") {
        this.registerEvent(workspace.on("active-leaf-change", () => this.bankScheduleRevalidate("active-leaf")));
        this.registerEvent(workspace.on("file-open", () => this.bankScheduleRevalidate("file-open")));
      }
    } catch (error) {
      // Focused-leaf revalidation is best-effort.
    }
    try {
      if (typeof this.registerDomEvent === "function" && typeof window !== "undefined" && window) {
        this.registerDomEvent(window, "focus", () => this.bankScheduleRevalidate("window-focus"));
        if (typeof document !== "undefined" && document) {
          this.registerDomEvent(document, "visibilitychange", () => {
            if (document.visibilityState === "visible") {
              this.bankScheduleRevalidate("document-visible");
            }
          });
        }
      }
    } catch (error) {
      // Focus and visibility are best-effort.
    }
    try {
      const timers = this.bankTimerApi();
      const hasTimerHost = Boolean(
        (this.bankTimers && typeof this.bankTimers === "object") ||
        (typeof window !== "undefined" && window),
      );
      const setIntervalFn = hasTimerHost && timers && typeof timers.setInterval === "function"
        ? timers.setInterval.bind(timers)
        : null;
      if (setIntervalFn) {
        this.bankRolloverTimer = setIntervalFn(() => {
          try {
            this.bankRefreshRollover(new Date());
          } catch (error) {
            // Rollover is best-effort.
          }
        }, BANK_ROLLOVER_INTERVAL_MS);
        if (typeof this.registerInterval === "function") {
          this.registerInterval(this.bankRolloverTimer);
        }
      }
    } catch (error) {
      this.bankRolloverTimer = null;
    }
  }

  teardownBankData() {
    this.bankDataActive = false;
    this.bankDataEpoch = (this.bankDataEpoch || 0) + 1;
    this.bankClearTimeout(this.bankRevalidateTimer);
    this.bankRevalidateTimer = null;
    if (this.bankRolloverTimer !== null && this.bankRolloverTimer !== undefined) {
      const timers = this.bankTimerApi();
      if (timers && typeof timers.clearInterval === "function") {
        timers.clearInterval(this.bankRolloverTimer);
      }
    }
    this.bankRolloverTimer = null;
    this.bankLocalDay = null;
    this.bankVaultGeneration = 0;
    if (this.bankMounts instanceof Set) {
      for (const mount of this.bankMounts) {
        if (mount) {
          mount.unloaded = true;
        }
      }
      this.bankMounts.clear();
    }
    if (this.bankCache instanceof Map) {
      this.bankCache.clear();
    }
    if (this.bankFlights instanceof Map) {
      this.bankFlights.clear();
    }
    if (this.bankPendingFetches instanceof Map) {
      for (const [key, pending] of this.bankPendingFetches) {
        const result = this.bankUnloadedResult(key);
        for (const waiter of pending.waiters || []) {
          try {
            waiter(result);
          } catch (error) {
            // Unload delivery is best-effort.
          }
        }
      }
      this.bankPendingFetches.clear();
    }
    if (this.bankLatestGeneration instanceof Map) {
      this.bankLatestGeneration.clear();
    }
  }
}
