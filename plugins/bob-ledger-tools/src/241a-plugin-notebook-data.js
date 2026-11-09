// Shared notebook catalog data and refresh lifecycle. Bob remains the source
// of truth; this fragment validates its versioned JSON and shares one
// stale-while-revalidate report and one sync operation across mounted views.

const NOTEBOOK_REPORT_SCHEMA_VERSION = 1;
const NOTEBOOK_LIST_TIMEOUT_MS = BOB_SPAWN_TIMEOUT_MS;
const NOTEBOOK_LIST_MAX_BUFFER = BOB_SPAWN_MAX_BUFFER;
const NOTEBOOK_REVALIDATE_DEBOUNCE_MS = 300;
const NOTEBOOK_SYNC_DEBOUNCE_MS = 3000;
const NOTEBOOK_ROLLOVER_INTERVAL_MS = 60 * 1000;

function notebookListArgs() {
  return ["notebooks", "list", "-f", "json"];
}

function notebookSyncArgs() {
  return ["notebooks", "sync", "-f", "json"];
}

function notebookJsonObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function notebookJsonString(value) {
  return typeof value === "string" && value.length > 0;
}

function notebookNullableString(value) {
  return value === null || typeof value === "string";
}

function notebookJsonCount(value) {
  return Number.isInteger(value) && value >= 0;
}

function notebookIssueRows(value) {
  return Array.isArray(value) && value.every((issue) =>
    notebookJsonObject(issue) &&
    notebookJsonString(issue.code) &&
    (issue.severity === "error" || issue.severity === "warning") &&
    (issue.line === null || issue.line === undefined || notebookJsonCount(issue.line)) &&
    typeof issue.message === "string",
  );
}

function notebookEntryShape(entry) {
  return notebookJsonObject(entry) &&
    notebookJsonString(entry.stem) &&
    notebookJsonString(entry.path) &&
    notebookJsonString(entry.title) &&
    notebookNullableString(entry.summary) &&
    notebookNullableString(entry.parent) &&
    notebookNullableString(entry.parent_kind) &&
    notebookNullableString(entry.owner) &&
    notebookNullableString(entry.root) &&
    Array.isArray(entry.breadcrumb) && entry.breadcrumb.every((part) => typeof part === "string") &&
    Array.isArray(entry.children) && entry.children.every((part) => typeof part === "string") &&
    notebookJsonCount(entry.notes) &&
    Array.isArray(entry.sections) && entry.sections.every((section) =>
      notebookJsonObject(section) && notebookJsonString(section.title) && notebookJsonCount(section.notes),
    ) &&
    notebookNullableString(entry.last_note) &&
    notebookIssueRows(entry.issues);
}

function notebookCatalogShape(catalog) {
  return notebookJsonObject(catalog) &&
    notebookJsonString(catalog.host) &&
    notebookJsonString(catalog.path) &&
    notebookNullableString(catalog.root) &&
    ["current", "stale", "missing", "damaged"].includes(catalog.state) &&
    notebookJsonCount(catalog.notebooks) &&
    notebookIssueRows(catalog.issues);
}

function notebookReportPath(value) {
  const path = typeof value === "string"
    ? value
    : value && typeof value.path === "string"
      ? value.path
      : "";
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function notebookIndexReport(report) {
  const notebooksByPath = new Map();
  const notebooksByStem = new Map();
  const catalogsByHostPath = new Map();
  for (const notebook of report.notebooks) {
    notebooksByPath.set(notebookReportPath(notebook.path), notebook);
    notebooksByStem.set(notebook.stem, notebook);
  }
  for (const catalog of report.catalogs) {
    catalogsByHostPath.set(notebookReportPath(catalog.path), catalog);
  }
  return { ...report, notebooksByPath, notebooksByStem, catalogsByHostPath };
}

function notebookDecodeListReport(stdout, stderr = "") {
  let body;
  try {
    body = JSON.parse(String(stdout === undefined ? "" : stdout));
  } catch (error) {
    return {
      ok: false,
      code: "bad-json",
      message: "bob notebooks list returned invalid JSON.",
      detail: statsFirstLine(stderr),
    };
  }
  if (!notebookJsonObject(body)) {
    return { ok: false, code: "bad-shape", message: "bob notebooks list returned no report object.", detail: statsFirstLine(stderr) };
  }
  if (body.schema_version !== NOTEBOOK_REPORT_SCHEMA_VERSION) {
    return { ok: false, code: "schema-mismatch", message: "bob notebooks list uses a different schema.", detail: statsFirstLine(stderr) };
  }
  if (
    typeof body.ok !== "boolean" ||
    !Array.isArray(body.notebooks) || !body.notebooks.every(notebookEntryShape) ||
    !Array.isArray(body.catalogs) || !body.catalogs.every(notebookCatalogShape) ||
    !notebookJsonObject(body.counts) ||
    !notebookJsonCount(body.counts.notebooks) ||
    !notebookJsonCount(body.counts.roots) ||
    !notebookJsonCount(body.counts.errors) ||
    !notebookJsonCount(body.counts.warnings) ||
    (body.findings !== undefined && !Array.isArray(body.findings))
  ) {
    return { ok: false, code: "bad-shape", message: "bob notebooks list returned an incomplete report.", detail: statsFirstLine(stderr) };
  }
  // `ok: false` is a valid list: its rows and findings still describe the
  // damaged notebooks and catalogs that the UI must keep visible.
  return { ok: true, report: notebookIndexReport(body) };
}

function notebookDecodeSyncReport(stdout, stderr = "") {
  let body;
  try {
    body = JSON.parse(String(stdout === undefined ? "" : stdout));
  } catch (error) {
    return {
      ok: false,
      code: "bad-json",
      message: "bob notebooks sync returned invalid JSON.",
      detail: statsFirstLine(stderr),
    };
  }
  if (!notebookJsonObject(body)) {
    return { ok: false, code: "bad-shape", message: "bob notebooks sync returned no report object.", detail: statsFirstLine(stderr) };
  }
  if (body.schema_version !== NOTEBOOK_REPORT_SCHEMA_VERSION) {
    return { ok: false, code: "schema-mismatch", message: "bob notebooks sync uses a different schema.", detail: statsFirstLine(stderr) };
  }
  if (
    typeof body.ok !== "boolean" || body.command !== "sync" ||
    !Array.isArray(body.changed) || !body.changed.every((path) => typeof path === "string") ||
    !Array.isArray(body.changes) || !Array.isArray(body.catalogs) ||
    !body.catalogs.every(notebookCatalogShape) || !Array.isArray(body.findings) ||
    !Array.isArray(body.warnings)
  ) {
    return { ok: false, code: "bad-shape", message: "bob notebooks sync returned an incomplete report.", detail: statsFirstLine(stderr) };
  }
  // A well-formed refusal (for example, a damaged catalog) is transport
  // success with an operation-level `ok: false` for the shared sync caller.
  return { ok: true, report: body };
}

function notebookTypeNames(value) {
  if (Array.isArray(value)) {
    return value.flatMap((part) => notebookTypeNames(part));
  }
  if (typeof value !== "string") {
    return [];
  }
  let text = value.trim();
  if (!text) {
    return [];
  }
  if ((text.startsWith("\"") && text.endsWith("\"")) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1).trim();
  }
  if (text.startsWith("[[") && text.endsWith("]]" ) && /^\[\[[^\[\]]+\]\]$/.test(text)) {
    text = text.slice(2, -2).split("|")[0].split("#")[0].trim();
  } else if (text.startsWith("[") && text.endsWith("]")) {
    return text.slice(1, -1).split(",").flatMap((part) => notebookTypeNames(part));
  }
  if (text.startsWith("- ")) {
    return notebookTypeNames(text.slice(2));
  }
  if (text.startsWith("[[") && text.endsWith("]]")) {
    text = text.slice(2, -2).split("|")[0].split("#")[0].trim();
  }
  text = text.replace(/\.md$/i, "").trim().toLowerCase();
  return text ? [text] : [];
}

function notebookNormalizeParent(value) {
  if (Array.isArray(value)) {
    return value.map(notebookNormalizeParent).filter(Boolean).sort().join("\u0000");
  }
  if (notebookJsonObject(value) && typeof value.path === "string") {
    value = value.path;
  }
  if (typeof value !== "string") {
    return "";
  }
  let text = value.trim();
  if ((text.startsWith("\"") && text.endsWith("\"")) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1).trim();
  }
  if (text.startsWith("[[") && text.endsWith("]]")) {
    text = text.slice(2, -2).split("|")[0].trim();
  }
  text = text.split("#")[0].replace(/\\/g, "/").replace(/\.md$/i, "").trim();
  return text;
}

function notebookNormalizeSummary(value) {
  if (Array.isArray(value)) {
    return value.map(notebookNormalizeSummary).filter(Boolean).join("\n");
  }
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function notebookFrontmatterFingerprint(frontmatter) {
  const data = notebookJsonObject(frontmatter) ? frontmatter : {};
  const types = [...new Set(notebookTypeNames(data.type))].sort();
  return {
    types,
    typeKey: types.join("\u0000"),
    isNotebook: types.includes("notebook"),
    parent: notebookNormalizeParent(data.parent),
    summary: notebookNormalizeSummary(data.summary),
  };
}

function notebookFingerprintNeedsSync(previous, next) {
  if (!next) {
    return Boolean(previous && previous.isNotebook);
  }
  if (!previous) {
    return next.isNotebook;
  }
  if (previous.isNotebook !== next.isNotebook) {
    return true;
  }
  return Boolean(next.isNotebook && (
    previous.typeKey !== next.typeKey ||
    previous.parent !== next.parent ||
    previous.summary !== next.summary
  ));
}

function notebookIsMarkdownFile(fileOrPath) {
  const path = typeof fileOrPath === "string"
    ? fileOrPath
    : fileOrPath && typeof fileOrPath.path === "string"
      ? fileOrPath.path
      : "";
  return /\.md$/i.test(path);
}

function notebookRelevantPath(fileOrPath) {
  if (!notebookIsMarkdownFile(fileOrPath)) {
    return false;
  }
  const path = notebookReportPath(typeof fileOrPath === "string" ? fileOrPath : fileOrPath.path);
  return !path.split("/").some((part) =>
    part === ".obsidian" || part === ".bob" || part === "node_modules" || part.startsWith("."),
  );
}

function notebookLocalDate(now = new Date()) {
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

function notebookErrorModel(error) {
  const source = notebookJsonObject(error) ? error : { code: "failed" };
  const code = typeof source.code === "string" ? source.code : "failed";
  if (code === "bob-not-found" && /needs the desktop app/i.test(String(source.message || ""))) {
    return { code: "desktop-only", hint: "Notebook data needs desktop Obsidian, where bob can run." };
  }
  if (code === "bob-not-found") {
    return { code, hint: "bob was not found. Install or update bob-cli, or set stats.bob_path." };
  }
  if (code === "timeout") {
    return { code, hint: "bob notebooks timed out. Retry, then check bob notebooks list in a terminal." };
  }
  if (code === "schema-mismatch" || code === "bad-json" || code === "bad-shape") {
    return { code, hint: "Update bob-cli and Bob Ledger Tools together, then retry." };
  }
  return {
    code,
    hint: source.detail || source.message || "Notebook data is unavailable. Retry bob notebooks list.",
  };
}

class BobLedgerToolsNotebookDataMixin {
  notebookTimerApi() {
    if (this.notebookTimers && typeof this.notebookTimers === "object") {
      return this.notebookTimers;
    }
    return typeof window !== "undefined" && window ? window : globalThis;
  }

  notebookSetTimeout(callback, delay) {
    const timers = this.notebookTimerApi();
    const schedule = timers && typeof timers.setTimeout === "function"
      ? timers.setTimeout.bind(timers)
      : setTimeout;
    return schedule(callback, delay);
  }

  notebookClearTimeout(timer) {
    if (timer === null || timer === undefined) {
      return;
    }
    const timers = this.notebookTimerApi();
    const clear = timers && typeof timers.clearTimeout === "function"
      ? timers.clearTimeout.bind(timers)
      : clearTimeout;
    clear(timer);
  }

  notebookReportState() {
    const report = this.notebookReport || null;
    return {
      report,
      stale: Boolean(report && (this.notebookReportStale || (this.notebookReportGeneration || 0) < (this.notebookVaultGeneration || 0))),
      unavailable: !report,
      refreshing: Boolean(this.notebookListFlight),
      error: this.notebookReportError || null,
      errorModel: this.notebookReportError ? notebookErrorModel(this.notebookReportError) : null,
      generation: this.notebookVaultGeneration || 0,
      reportGeneration: this.notebookReportGeneration,
      today: this.notebookLocalDay || notebookLocalDate(),
      syncBusy: Boolean(this.notebookSyncBusy),
      syncError: this.notebookSyncError || null,
      syncErrorModel: this.notebookSyncError ? notebookErrorModel(this.notebookSyncError) : null,
    };
  }

  notebookNotify() {
    if (this.notebookDataActive === false || !(this.notebookSubscribers instanceof Set)) {
      return;
    }
    const state = this.notebookReportState();
    for (const subscriber of this.notebookSubscribers) {
      try {
        subscriber(state);
      } catch (error) {
        // A mounted renderer cannot break shared data refresh for other views.
      }
    }
  }

  notebookWaitersStore() {
    if (!Array.isArray(this.notebookListWaiters)) {
      this.notebookListWaiters = [];
    }
    return this.notebookListWaiters;
  }

  notebookWaitForReportGeneration(generation) {
    return new Promise((resolve) => {
      this.notebookWaitersStore().push({ generation, resolve });
    });
  }

  notebookResolveWaiters(generation = Number.POSITIVE_INFINITY) {
    const waiters = this.notebookWaitersStore();
    const keep = [];
    const state = this.notebookReportState();
    for (const waiter of waiters) {
      if (waiter.generation <= generation || this.notebookDataActive === false) {
        try {
          waiter.resolve(state);
        } catch (error) {
          // Waiter cleanup is best-effort.
        }
      } else {
        keep.push(waiter);
      }
    }
    this.notebookListWaiters = keep;
  }

  notebookSpawnCommand(args, decoder, options = {}) {
    return bobSpawnJson(args, decoder, {
      ...options,
      commandLabel: args && args[1] === "sync" ? "bob notebooks sync" : "bob notebooks list",
      resolveBobPath: () =>
        typeof this.apiStatsBobPath === "function"
          ? this.apiStatsBobPath()
          : { path: "bob", source: "path" },
      getVaultPath: () =>
        typeof this.statsVaultBasePath === "function" ? this.statsVaultBasePath() : null,
      timeout: NOTEBOOK_LIST_TIMEOUT_MS,
      maxBuffer: NOTEBOOK_LIST_MAX_BUFFER,
      firstLine: statsFirstLine,
    });
  }

  notebookSpawnList(options = {}) {
    return this.notebookSpawnCommand(notebookListArgs(), notebookDecodeListReport, options);
  }

  notebookSpawnSync(options = {}) {
    return this.notebookSpawnCommand(notebookSyncArgs(), notebookDecodeSyncReport, options);
  }

  notebookStartListFetch(generation) {
    const epoch = this.notebookDataEpoch || 0;
    if ((this.notebookQueuedGeneration || 0) <= generation) {
      this.notebookQueuedGeneration = 0;
    }
    const flight = { generation, epoch, promise: null };
    this.notebookListFlight = flight;
    this.notebookNotify();
    const run = async () => {
      try {
        const result = await this.notebookSpawnList();
        if (this.notebookDataActive === false || this.notebookDataEpoch !== epoch) {
          return this.notebookReportState();
        }
        if (result && result.ok && result.report) {
          this.notebookReport = result.report;
          this.notebookReportGeneration = generation;
          this.notebookReportStale = generation < (this.notebookVaultGeneration || 0);
          this.notebookReportError = null;
        } else {
          this.notebookReportStale = Boolean(this.notebookReport);
          this.notebookReportError = result || {
            code: "failed",
            message: "bob notebooks list failed.",
          };
        }
      } catch (error) {
        if (this.notebookDataActive !== false && this.notebookDataEpoch === epoch) {
          this.notebookReportStale = Boolean(this.notebookReport);
          this.notebookReportError = {
            code: "failed",
            message: error && error.message ? String(error.message) : "bob notebooks list failed.",
          };
        }
      }
      return this.notebookReportState();
    };
    flight.promise = Promise.resolve()
      .then(run)
      .finally(() => {
        if (this.notebookListFlight !== flight) {
          return;
        }
        this.notebookListFlight = null;
        this.notebookResolveWaiters(generation);
        const queued = this.notebookQueuedGeneration || 0;
        if (
          this.notebookDataActive !== false && queued > generation &&
          this.notebookRevalidateTimer === null
        ) {
          this.notebookQueuedGeneration = 0;
          this.notebookStartListFetch(queued);
        }
        this.notebookNotify();
      });
    return flight;
  }

  apiNotebookReport(options = {}) {
    const opts = notebookJsonObject(options) ? options : {};
    if (this.notebookDataActive === false) {
      return Promise.resolve(this.notebookReportState());
    }
    const target = Math.max(
      this.notebookVaultGeneration || 0,
      Number.isInteger(opts.requiredGeneration) ? opts.requiredGeneration : 0,
    );
    const force = opts.force === true;
    const wait = opts.wait === true;
    if (this.notebookListFlight) {
      const flight = this.notebookListFlight;
      if (target > flight.generation) {
        this.notebookQueuedGeneration = Math.max(this.notebookQueuedGeneration || 0, target);
      }
      if (wait) {
        return this.notebookWaitForReportGeneration(target);
      }
      return Promise.resolve(this.notebookReportState());
    }
    if (
      !force && this.notebookReport && !this.notebookReportStale &&
      (this.notebookReportGeneration || 0) >= target
    ) {
      return Promise.resolve(this.notebookReportState());
    }
    if (force && this.notebookReport) {
      this.notebookReportStale = true;
      this.notebookNotify();
    }
    const generation = Math.max(target, this.notebookVaultGeneration || 0);
    this.notebookStartListFetch(generation);
    if (this.notebookReport && !wait) {
      return Promise.resolve(this.notebookReportState());
    }
    return this.notebookWaitForReportGeneration(generation);
  }

  notebookRevalidateAfterSync() {
    const flight = this.notebookListFlight;
    if (flight && flight.promise) {
      // A list started before the write cannot prove the catalogs after it.
      // Wait for that flight, then force a new report without overlapping it.
      return flight.promise.then(() => {
        if (this.notebookDataActive === false) {
          return this.notebookReportState();
        }
        return this.apiNotebookReport({ force: true, wait: true });
      });
    }
    return this.apiNotebookReport({ force: true, wait: true });
  }

  apiNotebookSubscribe(subscriber) {
    if (typeof subscriber !== "function" || this.notebookDataActive === false) {
      return () => {};
    }
    if (!(this.notebookSubscribers instanceof Set)) {
      this.notebookSubscribers = new Set();
    }
    this.notebookSubscribers.add(subscriber);
    try {
      subscriber(this.notebookReportState());
    } catch (error) {
      // A subscriber may mount before its renderer is ready.
    }
    void this.apiNotebookReport();
    return () => {
      this.notebookSubscribers.delete(subscriber);
    };
  }

  apiNotebookInvalidate(reason = "manual") {
    if (this.notebookDataActive === false) {
      return this.notebookReportState();
    }
    this.notebookVaultGeneration = (this.notebookVaultGeneration || 0) + 1;
    this.notebookInvalidationReason = String(reason || "vault");
    if (this.notebookReport) {
      this.notebookReportStale = true;
    }
    if (this.notebookListFlight) {
      this.notebookQueuedGeneration = Math.max(
        this.notebookQueuedGeneration || 0,
        this.notebookVaultGeneration,
      );
    }
    this.notebookNotify();
    this.notebookScheduleRevalidate(reason);
    return this.notebookReportState();
  }

  notebookScheduleRevalidate(reason = "vault") {
    void reason;
    if (
      this.notebookDataActive === false ||
      !(this.notebookSubscribers instanceof Set) ||
      this.notebookSubscribers.size === 0
    ) {
      return;
    }
    this.notebookClearTimeout(this.notebookRevalidateTimer);
    this.notebookRevalidateTimer = this.notebookSetTimeout(() => {
      this.notebookRevalidateTimer = null;
      if (this.notebookDataActive !== false && this.notebookSubscribers.size > 0) {
        void this.apiNotebookReport({ force: true });
      }
    }, NOTEBOOK_REVALIDATE_DEBOUNCE_MS);
  }

  notebookFrontmatterFor(file, eventData) {
    if (eventData && notebookJsonObject(eventData.frontmatter)) {
      return eventData.frontmatter;
    }
    try {
      const cache = this.app && this.app.metadataCache &&
        typeof this.app.metadataCache.getFileCache === "function"
        ? this.app.metadataCache.getFileCache(file)
        : null;
      return cache && notebookJsonObject(cache.frontmatter) ? cache.frontmatter : {};
    } catch (error) {
      return {};
    }
  }

  notebookRecordFrontmatter(file, eventData, options = {}) {
    if (!notebookRelevantPath(file)) {
      return false;
    }
    if (!(this.notebookFrontmatterByPath instanceof Map)) {
      this.notebookFrontmatterByPath = new Map();
    }
    const path = notebookReportPath(file.path);
    const previous = this.notebookFrontmatterByPath.get(path) || null;
    const next = notebookFrontmatterFingerprint(this.notebookFrontmatterFor(file, eventData));
    // Store first so catalog writes and any event observed during a sync do
    // not cause the same metadata transition to schedule another sync.
    this.notebookFrontmatterByPath.set(path, next);
    if (options.invalidate !== false) {
      this.apiNotebookInvalidate(options.reason || "markdown-change");
    }
    if (
      this.notebookMetadataReady && notebookFingerprintNeedsSync(previous, next)
    ) {
      this.notebookScheduleSync("frontmatter-change");
    }
    return true;
  }

  notebookHandleMetadataChanged(file, data) {
    if (notebookRelevantPath(file)) {
      this.notebookRecordFrontmatter(file, data, { reason: "metadata-change" });
    }
  }

  notebookHandleVaultEvent(event, file, oldPath) {
    const oldKey = notebookReportPath(oldPath);
    if (event === "delete") {
      const previous = this.notebookFrontmatterByPath instanceof Map
        ? this.notebookFrontmatterByPath.get(notebookReportPath(file))
        : null;
      if (this.notebookFrontmatterByPath instanceof Map) {
        this.notebookFrontmatterByPath.delete(notebookReportPath(file));
      }
      if (notebookRelevantPath(file)) {
        this.apiNotebookInvalidate("markdown-delete");
      }
      if (previous && previous.isNotebook) {
        this.notebookScheduleSync("notebook-delete");
      }
      return;
    }
    const currentRelevant = notebookRelevantPath(file);
    const oldRelevant = oldKey ? notebookRelevantPath(oldKey) : false;
    if (!currentRelevant && !oldRelevant) {
      return;
    }
    if (event === "rename" && oldKey && this.notebookFrontmatterByPath instanceof Map) {
      const old = this.notebookFrontmatterByPath.get(oldKey) || null;
      this.notebookFrontmatterByPath.delete(oldKey);
      if (old && old.isNotebook) {
        this.notebookScheduleSync("notebook-rename");
      }
    }
    if (currentRelevant) {
      this.notebookRecordFrontmatter(file, null, { reason: `markdown-${event}` });
    } else {
      this.apiNotebookInvalidate(`markdown-${event}`);
    }
  }

  notebookSeedFrontmatterFingerprints(files = null) {
    if (this.notebookDataActive === false || this.notebookMetadataReady) {
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
        if (notebookRelevantPath(file)) {
          next.set(notebookReportPath(file.path), notebookFrontmatterFingerprint(this.notebookFrontmatterFor(file)));
        }
      }
    } catch (error) {
      // Metadata readiness is best-effort; later changes will fill the map.
    }
    this.notebookFrontmatterByPath = next;
    this.notebookMetadataReady = true;
  }

  notebookScheduleSync(reason = "frontmatter-change") {
    void reason;
    if (this.notebookDataActive === false || this.notebookSyncFlight || this.notebookSyncBusy) {
      return false;
    }
    this.notebookClearTimeout(this.notebookSyncDebounceTimer);
    this.notebookSyncDebounceTimer = this.notebookSetTimeout(() => {
      this.notebookSyncDebounceTimer = null;
      if (this.notebookDataActive !== false && !this.notebookSyncFlight && !this.notebookSyncBusy) {
        void this.apiNotebookSync({ automatic: true });
      }
    }, NOTEBOOK_SYNC_DEBOUNCE_MS);
    return true;
  }

  apiNotebookSync(options = {}) {
    if (this.notebookDataActive === false) {
      return Promise.resolve({ ok: false, error: { code: "unloaded", message: "Notebook data has unloaded." } });
    }
    if (this.notebookSyncFlight) {
      return this.notebookSyncFlight;
    }
    this.notebookClearTimeout(this.notebookSyncDebounceTimer);
    this.notebookSyncDebounceTimer = null;
    const epoch = this.notebookDataEpoch || 0;
    this.notebookSyncBusy = true;
    this.notebookSyncError = null;
    this.notebookNotify();
    let syncPromise;
    const run = async () => {
      let processResult;
      try {
        processResult = await this.notebookSpawnSync();
      } catch (error) {
        processResult = {
          ok: false,
          code: "failed",
          message: error && error.message ? String(error.message) : "bob notebooks sync failed.",
        };
      }
      let operation;
      if (!processResult || !processResult.ok || !processResult.report) {
        operation = {
          ok: false,
          error: processResult || { code: "failed", message: "bob notebooks sync failed." },
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
              : "bob notebooks sync found a damaged catalog or could not complete.",
            detail: typeof failure.detail === "string" ? failure.detail : "",
          },
          report: processResult.report,
        };
      } else {
        operation = { ok: true, error: null, report: processResult.report };
      }
      if (this.notebookDataActive === false || this.notebookDataEpoch !== epoch) {
        if (this.notebookSyncFlight === syncPromise) {
          this.notebookSyncFlight = null;
        }
        return { ...operation, refreshed: this.notebookReportState() };
      }
      this.notebookSyncBusy = false;
      this.notebookSyncError = operation.error;
      this.notebookLastSyncReport = operation.report;
      if (this.notebookSyncFlight === syncPromise) {
        this.notebookSyncFlight = null;
      }
      this.notebookNotify();
      let refreshed = this.notebookReportState();
      try {
        // Re-read even after a partial/refused sync. Catalog state comes from
        // the list report, never from the sync command's optimistic result.
        refreshed = await this.notebookRevalidateAfterSync();
      } catch (error) {
        // The last report remains visible as stale/unavailable on failure.
      }
      return { ...operation, refreshed };
    };
    syncPromise = Promise.resolve().then(run).catch(async (error) => {
      const failure = {
        code: "failed",
        message: error && error.message ? String(error.message) : "bob notebooks sync failed.",
      };
      if (this.notebookDataActive !== false && this.notebookDataEpoch === epoch) {
        this.notebookSyncBusy = false;
        this.notebookSyncError = failure;
        if (this.notebookSyncFlight === syncPromise) {
          this.notebookSyncFlight = null;
        }
        this.notebookNotify();
        try {
          await this.notebookRevalidateAfterSync();
        } catch (ignored) {}
      }
      return { ok: false, error: failure, report: null, refreshed: this.notebookReportState() };
    });
    this.notebookSyncFlight = syncPromise;
    void options;
    return syncPromise;
  }

  notebookRefreshRollover(now = new Date()) {
    const day = notebookLocalDate(now);
    if (!day || day === this.notebookLocalDay) {
      return false;
    }
    this.notebookLocalDay = day;
    this.notebookNotify();
    return true;
  }

  setupNotebookData() {
    this.notebookDataActive = true;
    this.notebookDataEpoch = (this.notebookDataEpoch || 0) + 1;
    this.notebookVaultGeneration = 0;
    this.notebookReport = null;
    this.notebookReportGeneration = -1;
    this.notebookReportStale = true;
    this.notebookReportError = null;
    this.notebookSyncBusy = false;
    this.notebookSyncError = null;
    this.notebookSyncFlight = null;
    this.notebookListFlight = null;
    this.notebookQueuedGeneration = 0;
    this.notebookListWaiters = [];
    this.notebookSubscribers = new Set();
    this.notebookFrontmatterByPath = new Map();
    this.notebookMetadataReady = false;
    this.notebookRevalidateTimer = null;
    this.notebookSyncDebounceTimer = null;
    this.notebookRolloverTimer = null;
    this.notebookLocalDay = notebookLocalDate();

    try {
      const metadataCache = this.app && this.app.metadataCache;
      if (metadataCache && typeof metadataCache.on === "function") {
        this.registerEvent(metadataCache.on("changed", (file, data) => this.notebookHandleMetadataChanged(file, data)));
      }
    } catch (error) {
      // Metadata-cache notifications are optional on mobile and test hosts.
    }
    try {
      const vault = this.app && this.app.vault;
      if (vault && typeof vault.on === "function") {
        for (const event of ["create", "modify", "delete", "rename"]) {
          this.registerEvent(vault.on(event, (file, oldPath) => this.notebookHandleVaultEvent(event, file, oldPath)));
        }
      }
    } catch (error) {
      // Vault notifications are optional on partial app hosts.
    }
    try {
      const workspace = this.app && this.app.workspace;
      if (workspace && typeof workspace.on === "function") {
        for (const event of ["file-open", "active-leaf-change"]) {
          this.registerEvent(workspace.on(event, () => this.notebookScheduleRevalidate(`workspace-${event}`)));
        }
      }
      if (workspace && typeof workspace.onLayoutReady === "function") {
        workspace.onLayoutReady(() => this.notebookSeedFrontmatterFingerprints());
      }
    } catch (error) {
      // Some test hosts do not implement layout readiness.
    }
    try {
      if (typeof this.registerDomEvent === "function" && typeof window !== "undefined" && window) {
        this.registerDomEvent(window, "focus", () => this.notebookScheduleRevalidate("window-focus"));
        if (typeof document !== "undefined" && document) {
          this.registerDomEvent(document, "visibilitychange", () => {
            if (document.visibilityState === "visible") {
              this.notebookScheduleRevalidate("document-visible");
            }
          });
        }
      }
    } catch (error) {
      // Focus and visibility are best-effort on restricted hosts.
    }
    try {
      const timers = this.notebookTimerApi();
      const hasTimerHost = Boolean(
        (this.notebookTimers && typeof this.notebookTimers === "object") ||
        (typeof window !== "undefined" && window),
      );
      const setIntervalFn = hasTimerHost && timers && typeof timers.setInterval === "function"
        ? timers.setInterval.bind(timers)
        : null;
      if (setIntervalFn) {
        this.notebookRolloverTimer = setIntervalFn(() => this.notebookRefreshRollover(new Date()), NOTEBOOK_ROLLOVER_INTERVAL_MS);
        if (typeof this.registerInterval === "function") {
          this.registerInterval(this.notebookRolloverTimer);
        }
      }
    } catch (error) {
      this.notebookRolloverTimer = null;
    }
  }

  teardownNotebookData() {
    this.notebookDataActive = false;
    this.notebookDataEpoch = (this.notebookDataEpoch || 0) + 1;
    this.notebookClearTimeout(this.notebookRevalidateTimer);
    this.notebookClearTimeout(this.notebookSyncDebounceTimer);
    this.notebookRevalidateTimer = null;
    this.notebookSyncDebounceTimer = null;
    if (this.notebookRolloverTimer !== null && this.notebookRolloverTimer !== undefined) {
      const timers = this.notebookTimerApi();
      if (timers && typeof timers.clearInterval === "function") {
        timers.clearInterval(this.notebookRolloverTimer);
      }
    }
    this.notebookRolloverTimer = null;
    this.notebookResolveWaiters(0);
    if (this.notebookSubscribers instanceof Set) {
      this.notebookSubscribers.clear();
    }
    if (this.notebookFrontmatterByPath instanceof Map) {
      this.notebookFrontmatterByPath.clear();
    }
    this.notebookReport = null;
    this.notebookReportError = null;
    this.notebookSyncBusy = false;
    this.notebookSyncError = null;
  }
}
