// --- Reading Board data path (bob-cli-99.2) -------------------------------
// Bob owns the reading queue and all blocking rules. This fragment only
// builds the `bob ref list` argv, decodes its JSON, and keeps a small
// stale-while-revalidate cache for mounted board views.

const READING_BOARD_SCHEMA_VERSION = 1;
const READING_BOARD_CACHE_SIZE = 4;
const READING_BOARD_REVALIDATE_DEBOUNCE_MS = 1500;

function readingBoardBuildArgs(options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  const args = ["ref", "list", "-s", "ready,next,wip", "-A", "-f", "json"];
  const parent = typeof opts.parent === "string" ? opts.parent.trim() : "";
  if (parent) {
    args.push("-P", parent);
  }
  const rawTypes = Array.isArray(opts.type)
    ? opts.type
    : Array.isArray(opts.types)
      ? opts.types
      : typeof opts.type === "string"
        ? opts.type.split(",")
        : typeof opts.types === "string"
          ? opts.types.split(",")
          : [];
  const types = rawTypes
    .filter((type) => typeof type === "string")
    .map((type) => type.trim())
    .filter(Boolean);
  if (types.length > 0) {
    args.push("-t", types.join(","));
  }
  return args;
}

function readingBoardJsonObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readingBoardString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readingBoardNormalizePrerequisite(value) {
  if (!readingBoardJsonObject(value)) {
    return null;
  }
  return {
    id: readingBoardString(value.id),
    title: readingBoardString(value.title),
    path: readingBoardString(value.path),
    block_id: readingBoardString(value.block_id),
    link: readingBoardString(value.link),
    mark: readingBoardString(value.mark),
    ref_path: readingBoardString(value.ref_path),
  };
}

function readingBoardNormalizeReason(value) {
  if (!readingBoardJsonObject(value)) {
    return null;
  }
  const prerequisites = Array.isArray(value.prerequisites)
    ? value.prerequisites.map(readingBoardNormalizePrerequisite).filter(Boolean)
    : [];
  return {
    kind: readingBoardString(value.kind),
    date: readingBoardString(value.date),
    project: readingBoardString(value.project),
    link: readingBoardString(value.link),
    prerequisites,
  };
}

function readingBoardNormalizeTask(value) {
  if (!readingBoardJsonObject(value)) {
    return null;
  }
  return {
    path: readingBoardString(value.path),
    block_id: readingBoardString(value.block_id),
    link: readingBoardString(value.link),
    mark: readingBoardString(value.mark),
    archived: value.archived === true,
    priority: readingBoardString(value.priority),
    scheduled: readingBoardString(value.scheduled),
  };
}

function readingBoardNormalizeRow(value) {
  if (!readingBoardJsonObject(value)) {
    return null;
  }
  const hasBlockedBy = Array.isArray(value.blocked_by);
  const rawBlockedBy = hasBlockedBy ? value.blocked_by : [];
  const task = readingBoardNormalizeTask(value.task);
  return {
    path: readingBoardString(value.path),
    title: readingBoardString(value.title) || readingBoardString(value.path) || "Untitled reference",
    type: readingBoardString(value.ref_type) || readingBoardString(value.type),
    parent: readingBoardString(value.parent),
    era: readingBoardString(value.era),
    status: readingBoardString(value.status),
    reading_state: readingBoardString(value.reading_state),
    blocked: value.blocked === true,
    blocked_by: rawBlockedBy.map(readingBoardNormalizeReason).filter(Boolean),
    task,
    added: readingBoardString(value.added),
    // `bob ref list` emits the audio path (or null). The board only needs to
    // know whether a path is present, but keep that contract at the boundary.
    audio: typeof value.audio === "string" && value.audio.trim().length > 0,
    annotation_count:
      Number.isInteger(value.annotation_count) && value.annotation_count >= 0
        ? value.annotation_count
        : 0,
    source: readingBoardString(value.source) || readingBoardString(value.origin),
    source_pdf: readingBoardString(value.source_pdf),
    status_sync: readingBoardString(value.status_sync),
    _legacy_blocked_by: value.blocked === true && !hasBlockedBy,
  };
}

// Decode only the fields this presentation needs. Missing fields in an
// older bob are normalized to null/[] while a private capability bit lets
// the model explain why that older response cannot show a wake reason.
function readingBoardDecodeReport(stdout, stderr) {
  let body = null;
  try {
    body = JSON.parse(String(stdout === undefined ? "" : stdout));
  } catch (error) {
    return {
      ok: false,
      code: "bad-json",
      message: "bob ref list returned output that is not JSON.",
      detail: statsFirstLine(stderr),
    };
  }
  if (!readingBoardJsonObject(body)) {
    return {
      ok: false,
      code: "bad-shape",
      message: "bob ref list returned an unexpected JSON shape.",
      detail: statsFirstLine(stderr),
    };
  }
  if (body.schema_version !== READING_BOARD_SCHEMA_VERSION) {
    return {
      ok: false,
      code: "schema-mismatch",
      message: `bob ref list returned schema ${String(body.schema_version)}, this board reads schema ${READING_BOARD_SCHEMA_VERSION}.`,
      detail: statsFirstLine(stderr),
    };
  }
  if (body.ok === false) {
    const inner = readingBoardJsonObject(body.error) ? body.error : {};
    return {
      ok: false,
      code: readingBoardString(inner.code) || "bob-error",
      message: readingBoardString(inner.message) || "bob ref list reported an error.",
      detail: statsFirstLine(stderr),
    };
  }
  if (!Array.isArray(body.refs)) {
    return {
      ok: false,
      code: "bad-shape",
      message: "bob ref list returned a report without refs.",
      detail: statsFirstLine(stderr),
    };
  }
  const refs = body.refs.map(readingBoardNormalizeRow).filter(Boolean);
  return {
    ok: true,
    report: {
      schema_version: READING_BOARD_SCHEMA_VERSION,
      generated_at: readingBoardString(body.generated_at),
      refs,
      _legacy_blocked_by: refs.some((row) => row._legacy_blocked_by),
    },
  };
}

function readingBoardCacheKey(args) {
  try {
    return JSON.stringify(Array.isArray(args) ? args : []);
  } catch (error) {
    return String(args);
  }
}

function readingBoardErrorModel(result, options = {}) {
  const error = readingBoardJsonObject(result) ? result : { code: "failed" };
  const tried = Array.isArray(options.tried)
    ? options.tried
    : Array.isArray(error.tried)
      ? error.tried
      : [];
  if (error.code === "bob-not-found" && /needs the desktop app/i.test(String(error.message || ""))) {
    return {
      code: "desktop-only",
      title: "The Reading Board needs the desktop app",
      hint: "bob runs only in Obsidian on a computer. Open this vault there to see the board.",
      retry: false,
    };
  }
  if (error.code === "bob-not-found") {
    return {
      code: "bob-not-found",
      title: "bob was not found",
      hint: tried.length > 0
        ? `Tried ${tried.join(", ")}. Set stats.bob_path in ~/.config/bob/config.yml.`
        : "Set stats.bob_path in ~/.config/bob/config.yml.",
      retry: true,
    };
  }
  if (error.code === "timeout") {
    return {
      code: "timeout",
      title: "bob ref list timed out",
      hint: "Retry once, then run bob ref list -s ready,next,wip -A -f json in a terminal.",
      retry: true,
    };
  }
  if (error.code === "schema-mismatch") {
    return {
      code: "schema-mismatch",
      title: "bob ref list uses a different schema",
      hint: "Update bob-cli and Bob Ledger Tools together, then retry.",
      retry: true,
    };
  }
  return {
    code: typeof error.code === "string" ? error.code : "failed",
    title: "bob ref list failed",
    hint: error.detail || error.message || "Retry once, then run bob ref list in a terminal.",
    retry: true,
  };
}

function readingBoardLocalDate(now = new Date()) {
  try {
    const date = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  } catch (error) {
    return "";
  }
}

class BobLedgerToolsReadingBoardDataMixin {
  readingBoardCacheStore() {
    if (!(this.readingBoardCache instanceof Map)) {
      this.readingBoardCache = new Map();
    }
    return this.readingBoardCache;
  }

  readingBoardCacheGet(key) {
    const store = this.readingBoardCacheStore();
    const entry = store.get(key);
    if (!entry) {
      return null;
    }
    store.delete(key);
    store.set(key, entry);
    return entry;
  }

  readingBoardCacheSet(key, report) {
    const store = this.readingBoardCacheStore();
    if (store.has(key)) {
      store.delete(key);
    }
    store.set(key, { report, fetchedAt: Date.now() });
    while (store.size > READING_BOARD_CACHE_SIZE) {
      const oldest = store.keys().next();
      if (oldest.done) {
        break;
      }
      store.delete(oldest.value);
    }
  }

  readingBoardLastGoodReport(key) {
    const cached = this.readingBoardCacheGet(key);
    if (cached) {
      return cached.report;
    }
    for (const view of this.readingBoardViewsStore()) {
      if (
        view &&
        view.unloaded !== true &&
        readingBoardCacheKey(readingBoardBuildArgs(view.fence || {})) === key &&
        view.report
      ) {
        return view.report;
      }
    }
    return null;
  }

  readingBoardSpawnFetch(args, options = {}) {
    return bobSpawnJson(args, readingBoardDecodeReport, {
      ...options,
      commandLabel: "bob ref list",
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

  // Public: stale-while-revalidate `bob ref list` data keyed by its exact
  // argv. Duplicate reads share a flight; refresh demand is coalesced by key
  // and drained serially so one fence cannot erase another fence's refresh.
  apiReadingBoardFetch(options = {}) {
    const opts = options && typeof options === "object" ? options : {};
    const force = opts.force === true;
    const args = readingBoardBuildArgs(opts);
    const key = readingBoardCacheKey(args);
    const cached = this.readingBoardCacheGet(key);
    const generation = Math.max(
      this.readingBoardVaultGeneration || 0,
      Number.isInteger(opts.requiredGeneration) ? opts.requiredGeneration : 0,
    );
    if (this.readingBoardDataActive === false) {
      return Promise.resolve(this.readingBoardUnloadedResult(key));
    }
    const flight = this.readingBoardFlight;
    if (flight) {
      if (
        flight.key === key &&
        !force &&
        generation <= flight.generation
      ) {
        return cached
          ? Promise.resolve({ report: cached.report, stale: true, error: null, key })
          : flight.promise;
      }
      const queued = this.readingBoardQueueFetch(key, args, opts, generation, force || !cached);
      if (cached && !force && generation <= flight.generation) {
        return Promise.resolve({ report: cached.report, stale: true, error: null, key });
      }
      return queued;
    }

    const started = this.readingBoardStartFetch(args, key, opts, generation);
    return cached && !force && generation <= started.generation
      ? Promise.resolve({ report: cached.report, stale: true, error: null, key })
      : started.promise;
  }

  readingBoardUnloadedResult(key) {
    return {
      report: null,
      stale: false,
      key,
      error: { code: "unloaded", message: "The Reading Board has unloaded.", detail: "" },
    };
  }

  readingBoardQueueFetch(key, args, opts, generation, waitForResult) {
    if (!(this.readingBoardPendingFetches instanceof Map)) {
      this.readingBoardPendingFetches = new Map();
    }
    let resolve = null;
    const result = waitForResult
      ? new Promise((done) => { resolve = done; })
      : null;
    let pending = this.readingBoardPendingFetches.get(key);
    if (!pending) {
      pending = { key, args, opts: { ...opts, force: true }, generation, waiters: [] };
      this.readingBoardPendingFetches.set(key, pending);
    } else {
      pending.opts = { ...pending.opts, ...opts, force: true };
      pending.generation = Math.max(pending.generation, generation);
    }
    if (resolve) {
      pending.waiters.push(resolve);
    }
    return result || Promise.resolve({ report: null, stale: false, error: null, queued: true, key });
  }

  readingBoardStartFetch(args, key, opts, requiredGeneration) {
    const epoch = this.readingBoardDataEpoch || 0;
    const generation = Math.max(
      this.readingBoardVaultGeneration || 0,
      Number.isInteger(requiredGeneration) ? requiredGeneration : 0,
    );
    const flight = { key, args, opts: { ...opts }, generation, epoch, promise: null };
    const finish = (outcome) => {
      if (
        this.readingBoardDataActive !== false &&
        this.readingBoardDataEpoch === epoch
      ) {
        this.readingBoardDeliverFetchResult(flight, outcome);
      }
      return outcome;
    };
    const run = async () => {
      if (
        this.readingBoardDataActive === false ||
        this.readingBoardDataEpoch !== epoch
      ) {
        return this.readingBoardUnloadedResult(key);
      }
      try {
        const result = await this.readingBoardSpawnFetch(args, opts);
        if (result && result.ok) {
          this.readingBoardCacheSet(key, result.report);
          return {
            report: result.report,
            stale: false,
            error: null,
            key,
            generation,
          };
        }
        const staleReport = this.readingBoardLastGoodReport(key);
        return {
          report: staleReport,
          stale: Boolean(staleReport),
          error: result || { code: "failed", message: "bob ref list failed.", detail: "" },
          key,
          generation,
        };
      } catch (error) {
        const failure = {
          ok: false,
          code: "failed",
          message: error && error.message ? String(error.message) : "bob ref list failed.",
          detail: "",
        };
        const staleReport = this.readingBoardLastGoodReport(key);
        return {
          report: staleReport,
          stale: Boolean(staleReport),
          error: failure,
          key,
          generation,
        };
      }
    };
    flight.promise = Promise.resolve()
      .then(run)
      .then(finish)
      .finally(() => {
        if (this.readingBoardFlight === flight) {
          this.readingBoardFlight = null;
          this.readingBoardStartNextFetch(epoch);
        }
      });
    this.readingBoardFlight = flight;
    return flight;
  }

  readingBoardStartNextFetch(epoch = this.readingBoardDataEpoch || 0) {
    if (
      this.readingBoardDataActive === false ||
      this.readingBoardDataEpoch !== epoch ||
      this.readingBoardFlight ||
      !(this.readingBoardPendingFetches instanceof Map)
    ) {
      return;
    }
    const first = this.readingBoardPendingFetches.entries().next();
    if (first.done) {
      return;
    }
    const [key, pending] = first.value;
    this.readingBoardPendingFetches.delete(key);
    const next = this.readingBoardStartFetch(
      pending.args,
      key,
      pending.opts,
      pending.generation,
    );
    for (const waiter of pending.waiters) {
      next.promise.then(waiter, () => waiter(this.readingBoardUnloadedResult(key)));
    }
  }

  readingBoardDeliverFetchResult(flight, result) {
    if (!flight || !result || this.readingBoardDataActive === false) {
      return;
    }
    for (const view of this.readingBoardViewsStore()) {
      if (
        !view ||
        view.unloaded === true ||
        readingBoardCacheKey(readingBoardBuildArgs(view.fence || {})) !== flight.key
      ) {
        continue;
      }
      if (result.error) {
        if (result.report) {
          view.refreshError = { error: result.error, at: Date.now() };
        } else {
          view.refreshError = null;
        }
      } else if (result.report) {
        view.refreshError = null;
        this.readingBoardViewDataApplied(view, result.generation);
      }
      if (typeof this.readingBoardRenderResult === "function") {
        this.readingBoardRenderResult(view, result);
      }
    }
  }

  apiReadingBoardRefresh(options = {}) {
    const opts = options && typeof options === "object" ? options : {};
    return this.apiReadingBoardFetch({ ...opts, force: true });
  }

  readingBoardViewsStore() {
    if (!(this.readingBoardViews instanceof Set)) {
      this.readingBoardViews = new Set();
    }
    return this.readingBoardViews;
  }

  readingBoardViewDataApplied(view, generation) {
    if (view && typeof view === "object") {
      view.dataGeneration = Number.isInteger(generation)
        ? generation
        : this.readingBoardVaultGeneration || 0;
      view.dataAt = Date.now();
    }
  }

  repaintReadingBoardBlocks() {
    try {
      for (const view of this.readingBoardViewsStore()) {
        if (view && typeof this.paintReadingBoardBlock === "function") {
          this.paintReadingBoardBlock(view);
        }
      }
    } catch (error) {
      // Repainting is best-effort; each mounted block owns its error state.
    }
  }

  revalidateReadingBoardBlocks() {
    for (const view of this.readingBoardViewsStore()) {
      if (!view || view.unloaded === true) {
        continue;
      }
      Promise.resolve(this.apiReadingBoardFetch({
        ...(view.fence || {}),
        force: true,
        requiredGeneration: this.readingBoardVaultGeneration || 0,
      })).catch(() => {});
    }
  }

  scheduleReadingBoardRevalidate(reason) {
    void reason;
    if (this.readingBoardViewsStore().size === 0) {
      return;
    }
    const clear =
      typeof window !== "undefined" && typeof window.clearTimeout === "function"
        ? window.clearTimeout.bind(window)
        : clearTimeout;
    const schedule =
      typeof window !== "undefined" && typeof window.setTimeout === "function"
        ? window.setTimeout.bind(window)
        : setTimeout;
    if (this.readingBoardRevalidateTimer !== null && this.readingBoardRevalidateTimer !== undefined) {
      clear(this.readingBoardRevalidateTimer);
    }
    this.readingBoardRevalidateTimer = schedule(() => {
      this.readingBoardRevalidateTimer = null;
      this.revalidateReadingBoardBlocks();
    }, READING_BOARD_REVALIDATE_DEBOUNCE_MS);
  }

  readingBoardVaultChanged() {
    this.readingBoardVaultGeneration = (this.readingBoardVaultGeneration || 0) + 1;
    this.scheduleReadingBoardRevalidate("vault");
  }

  readingBoardActiveLeafChanged(leaf) {
    try {
      const view = leaf && leaf.view;
      const path =
        (view && view.file && view.file.path) ||
        (this.app && this.app.workspace && this.app.workspace.getActiveFile &&
          this.app.workspace.getActiveFile() &&
          this.app.workspace.getActiveFile().path) ||
        "";
      if (!path) {
        return;
      }
      for (const boardView of this.readingBoardViewsStore()) {
        if (
          boardView &&
          boardView.sourcePath === path &&
          (boardView.dataGeneration || 0) < (this.readingBoardVaultGeneration || 0)
        ) {
          this.scheduleReadingBoardRevalidate("stale-active-leaf");
          return;
        }
      }
    } catch (error) {
      // Active-leaf revalidation is best-effort.
    }
  }

  refreshReadingBoardsForRollover(now = new Date()) {
    const day = readingBoardLocalDate(now);
    if (!day) {
      return;
    }
    if (this.readingBoardBlockDay === null || this.readingBoardBlockDay === undefined) {
      this.readingBoardBlockDay = day;
      return;
    }
    if (this.readingBoardBlockDay !== day) {
      this.readingBoardBlockDay = day;
      this.readingBoardVaultGeneration = (this.readingBoardVaultGeneration || 0) + 1;
      this.scheduleReadingBoardRevalidate("local-date-rollover");
    }
  }

  setupReadingBoardData() {
    this.readingBoardDataActive = true;
    this.readingBoardDataEpoch = (this.readingBoardDataEpoch || 0) + 1;
    try {
      const metadataCache = this.app && this.app.metadataCache;
      if (metadataCache && typeof metadataCache.on === "function") {
        this.registerEvent(metadataCache.on("changed", () => this.readingBoardVaultChanged()));
      }
    } catch (error) {
      // Metadata-cache revalidation is best-effort.
    }
    try {
      const vault = this.app && this.app.vault;
      if (vault && typeof vault.on === "function") {
        for (const event of ["create", "delete", "rename"]) {
          this.registerEvent(vault.on(event, () => this.readingBoardVaultChanged()));
        }
      }
    } catch (error) {
      // Vault revalidation is best-effort.
    }
    try {
      const workspace = this.app && this.app.workspace;
      if (workspace && typeof workspace.on === "function") {
        this.registerEvent(
          workspace.on("active-leaf-change", (leaf) => this.readingBoardActiveLeafChanged(leaf)),
        );
      }
    } catch (error) {
      // Active-leaf revalidation is best-effort.
    }
    try {
      if (
        typeof this.registerInterval === "function" &&
        typeof window !== "undefined" &&
        typeof window.setInterval === "function"
      ) {
        this.registerInterval(
          window.setInterval(() => {
            try {
              this.refreshReadingBoardsForRollover(new Date());
            } catch (error) {
              // Rollover is best-effort.
            }
          }, 60 * 1000),
        );
      }
    } catch (error) {
      // Rollover wiring is best-effort.
    }
  }

  teardownReadingBoardData() {
    this.readingBoardDataActive = false;
    this.readingBoardDataEpoch = (this.readingBoardDataEpoch || 0) + 1;
    try {
      if (this.readingBoardRevalidateTimer !== null && this.readingBoardRevalidateTimer !== undefined) {
        const clear =
          typeof window !== "undefined" && typeof window.clearTimeout === "function"
            ? window.clearTimeout.bind(window)
            : clearTimeout;
        clear(this.readingBoardRevalidateTimer);
      }
    } catch (error) {
      // Timer cleanup is best-effort.
    }
    this.readingBoardRevalidateTimer = null;
    this.readingBoardBlockDay = null;
    this.readingBoardVaultGeneration = 0;
    if (this.readingBoardViews instanceof Set) {
      for (const view of this.readingBoardViews) {
        if (view) {
          view.unloaded = true;
        }
      }
      this.readingBoardViews.clear();
    }
    if (this.readingBoardCache instanceof Map) {
      this.readingBoardCache.clear();
    }
    this.readingBoardFlight = null;
    if (this.readingBoardPendingFetches instanceof Map) {
      for (const [key, pending] of this.readingBoardPendingFetches) {
        const result = this.readingBoardUnloadedResult(key);
        for (const waiter of pending.waiters || []) {
          try {
            waiter(result);
          } catch (error) {
            // Unload delivery is best-effort.
          }
        }
      }
      this.readingBoardPendingFetches.clear();
    }
  }
}
