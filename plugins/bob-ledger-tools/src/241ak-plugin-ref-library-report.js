// One shared, read-only `bob ref list` snapshot for mounted Ref Cards.
// Identity belongs to each note; this report only patches fields Bob owns.

const REF_LIBRARY_REPORT_SCHEMA_VERSION = 1;
const REF_LIBRARY_REPORT_REVALIDATE_DEBOUNCE_MS = 1500;
const REF_LIBRARY_REPORT_FRESH_MS = 60 * 1000;
const REF_LIBRARY_REPORT_OPEN_REFRESH_MS = 5 * 60 * 1000;
const REF_LIBRARY_REPORT_TIMEOUT_MS = BOB_SPAWN_TIMEOUT_MS;
const REF_LIBRARY_REPORT_MAX_BUFFER = BOB_SPAWN_MAX_BUFFER;

function refLibraryReportArgs() {
  return REF_LIBRARY_REPORT_ARGV.slice();
}

function refLibraryReportObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function refLibraryReportString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function refLibraryReportCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function refLibraryReportPath(value) {
  return typeof value === "string"
    ? value.replace(/\\/g, "/").replace(/^\.\//, "").trim()
    : "";
}

function refLibraryReportNormalizeTask(value) {
  if (!refLibraryReportObject(value)) return null;
  return {
    path: refLibraryReportString(value.path),
    block_id: refLibraryReportString(value.block_id),
    link: refLibraryReportString(value.link),
    mark: refLibraryReportString(value.mark),
    archived: typeof value.archived === "boolean" ? value.archived : null,
    priority: refLibraryReportString(value.priority),
    scheduled: refLibraryReportString(value.scheduled),
  };
}

function refLibraryReportNormalizePrerequisite(value) {
  if (!refLibraryReportObject(value)) return null;
  return {
    id: refLibraryReportString(value.id),
    title: refLibraryReportString(value.title),
    path: refLibraryReportString(value.path),
    block_id: refLibraryReportString(value.block_id),
    link: refLibraryReportString(value.link),
    mark: refLibraryReportString(value.mark),
    ref_path: refLibraryReportString(value.ref_path),
  };
}

function refLibraryReportNormalizeBlockedReason(value) {
  if (!refLibraryReportObject(value)) return null;
  if (value.kind === "local_dependency") {
    return {
      kind: value.kind,
      prerequisites: Array.isArray(value.prerequisites)
        ? value.prerequisites.map(refLibraryReportNormalizePrerequisite).filter(Boolean)
        : null,
    };
  }
  if (value.kind === "local_schedule") {
    return { kind: value.kind, date: refLibraryReportString(value.date) };
  }
  if (value.kind === "project") {
    return {
      kind: value.kind,
      project: refLibraryReportString(value.project),
      link: refLibraryReportString(value.link),
    };
  }
  return null;
}

function refLibraryReportNormalizeEarlier(value) {
  if (!refLibraryReportObject(value)) return null;
  return {
    target: refLibraryReportString(value.target),
    label: refLibraryReportString(value.label),
    kind: value.kind === "reading" || value.kind === "replaced" ? value.kind : null,
  };
}

function refLibraryReportNormalizeRow(value) {
  if (!refLibraryReportObject(value)) return null;
  const path = refLibraryReportPath(value.path);
  if (!path) return null;
  const identity = refLibraryReportObject(value.identity)
    ? {
        keys: Array.isArray(value.identity.keys)
          ? value.identity.keys.map(refLibraryReportString).filter(Boolean)
          : null,
        arxiv: refLibraryReportString(value.identity.arxiv),
        doi: refLibraryReportString(value.identity.doi),
      }
    : null;
  const snapshot = refLibraryReportObject(value.snapshot)
    ? {
        synced_at: refLibraryReportString(value.snapshot.synced_at),
        highlights_count: refLibraryReportCount(value.snapshot.highlights_count),
      }
    : null;
  const diagnostics = Array.isArray(value.diagnostics)
    ? value.diagnostics.map((item) => refLibraryReportObject(item)
      ? { code: refLibraryReportString(item.code), detail: refLibraryReportString(item.detail) }
      : null).filter(Boolean)
    : null;
  return {
    path,
    link: refLibraryReportString(value.link),
    title: refLibraryReportString(value.title),
    origin: refLibraryReportString(value.origin),
    ref_type: refLibraryReportString(value.ref_type),
    era: refLibraryReportString(value.era),
    status: refLibraryReportString(value.status),
    status_sync: refLibraryReportString(value.status_sync),
    reading_state: refLibraryReportString(value.reading_state),
    blocked: typeof value.blocked === "boolean" ? value.blocked : null,
    blocked_by: Array.isArray(value.blocked_by)
      ? value.blocked_by.map(refLibraryReportNormalizeBlockedReason).filter(Boolean)
      : null,
    parent: refLibraryReportString(value.parent),
    task: refLibraryReportNormalizeTask(value.task),
    earlier: Array.isArray(value.earlier)
      ? value.earlier.map(refLibraryReportNormalizeEarlier).filter(Boolean)
      : null,
    reading: refLibraryReportCount(value.reading),
    identity,
    author: refLibraryReportString(value.author),
    published: refLibraryReportString(value.published),
    captured: refLibraryReportString(value.captured),
    added: refLibraryReportString(value.added),
    added_at: refLibraryReportString(value.added_at),
    finished: refLibraryReportString(value.finished),
    source_pdf: refLibraryReportString(value.source_pdf),
    audio: refLibraryReportString(value.audio),
    annotation_count: refLibraryReportCount(value.annotation_count),
    comment_count: refLibraryReportCount(value.comment_count),
    snapshot,
    diagnostics,
  };
}

function refLibraryReportDeepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) refLibraryReportDeepFreeze(child);
  return Object.freeze(value);
}

function refLibraryReportFreezeMap(map) {
  for (const method of ["set", "delete", "clear"]) {
    Object.defineProperty(map, method, {
      configurable: false,
      enumerable: false,
      writable: false,
      value() { throw new TypeError("Ref-library report snapshots are immutable."); },
    });
  }
  return Object.freeze(map);
}

function refLibraryReportDecode(stdout, stderr = "") {
  let body;
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
  if (!refLibraryReportObject(body)) {
    return { ok: false, code: "bad-shape", message: "bob ref list returned no report object.", detail: statsFirstLine(stderr) };
  }
  if (body.schema_version !== REF_LIBRARY_REPORT_SCHEMA_VERSION) {
    return {
      ok: false,
      code: "schema-mismatch",
      message: `bob ref list returned schema ${String(body.schema_version)}, this card reads schema ${REF_LIBRARY_REPORT_SCHEMA_VERSION}.`,
      detail: statsFirstLine(stderr),
    };
  }
  if (body.ok === false) {
    const error = refLibraryReportObject(body.error) ? body.error : {};
    return {
      ok: false,
      code: refLibraryReportString(error.code) || "bob-error",
      message: refLibraryReportString(error.message) || "bob ref list reported an error.",
      detail: statsFirstLine(stderr),
    };
  }
  if (!Array.isArray(body.refs)) {
    return { ok: false, code: "bad-shape", message: "bob ref list returned a report without refs.", detail: statsFirstLine(stderr) };
  }
  const rowsByPath = new Map();
  for (const value of body.refs) {
    const row = refLibraryReportNormalizeRow(value);
    if (!row) {
      return { ok: false, code: "bad-shape", message: "bob ref list returned a row without a path.", detail: statsFirstLine(stderr) };
    }
    refLibraryReportDeepFreeze(row);
    rowsByPath.set(row.path, row);
  }
  const coverage = refLibraryReportDeepFreeze({
    ref_dir: refLibraryReportObject(body.coverage)
      ? refLibraryReportString(body.coverage.ref_dir)
      : null,
  });
  const report = Object.freeze({
    schema_version: REF_LIBRARY_REPORT_SCHEMA_VERSION,
    generated_at: refLibraryReportString(body.generated_at),
    coverage,
    rowsByPath: refLibraryReportFreezeMap(rowsByPath),
  });
  return { ok: true, report };
}

class BobLedgerToolsRefLibraryReportMixin {
  refLibraryReportTimerApi() {
    if (this.refLibraryReportTimers && typeof this.refLibraryReportTimers === "object") {
      return this.refLibraryReportTimers;
    }
    return typeof window !== "undefined" && window ? window : globalThis;
  }

  refLibraryReportSetTimeout(callback, delay) {
    const timers = this.refLibraryReportTimerApi();
    const schedule = timers && typeof timers.setTimeout === "function"
      ? timers.setTimeout.bind(timers)
      : setTimeout;
    return schedule(callback, delay);
  }

  refLibraryReportClearTimeout(timer) {
    if (timer === null || timer === undefined) return;
    const timers = this.refLibraryReportTimerApi();
    const clear = timers && typeof timers.clearTimeout === "function"
      ? timers.clearTimeout.bind(timers)
      : clearTimeout;
    clear(timer);
  }

  refLibraryReportNow() {
    try {
      return typeof this.refLibraryReportClock === "function"
        ? Number(this.refLibraryReportClock())
        : Date.now();
    } catch (error) {
      return Date.now();
    }
  }

  refLibraryReportAge() {
    if (!Number.isFinite(this.refLibraryReportReceivedAt)) return null;
    return Math.max(0, this.refLibraryReportNow() - this.refLibraryReportReceivedAt);
  }

  refLibraryReportState() {
    const snapshot = this.refLibraryReportSnapshot || null;
    const ageMs = this.refLibraryReportAge();
    return {
      snapshot,
      rowsByPath: snapshot ? snapshot.rowsByPath : null,
      coverage: snapshot ? snapshot.coverage : null,
      generated_at: snapshot ? snapshot.generated_at : null,
      ageMs,
      stale: Boolean(snapshot && (this.refLibraryReportStale || ageMs > REF_LIBRARY_REPORT_FRESH_MS)),
      refreshing: Boolean(this.refLibraryReportFlight),
      error: this.refLibraryReportError || null,
    };
  }

  refLibraryReportRow(path) {
    const rows = this.refLibraryReportSnapshot && this.refLibraryReportSnapshot.rowsByPath;
    return rows instanceof Map ? rows.get(refLibraryReportPath(path)) || null : null;
  }

  refLibraryReportNotify() {
    if (this.refLibraryReportActive === false || !(this.refLibraryReportSubscribers instanceof Map)) return;
    const state = this.refLibraryReportState();
    for (const entry of this.refLibraryReportSubscribers.values()) {
      try {
        entry.callback(state);
      } catch (error) {
        // A mounted card cannot interrupt the report delivery to other cards.
      }
    }
  }

  refLibraryReportMountedPaths() {
    const paths = new Set();
    if (this.refLibraryReportSubscribers instanceof Map) {
      for (const entry of this.refLibraryReportSubscribers.values()) {
        if (entry.path) paths.add(entry.path);
      }
    }
    return paths;
  }

  refLibraryReportResidencePaths() {
    const paths = new Set();
    if (this.refLibraryReportSubscribers instanceof Map) {
      for (const entry of this.refLibraryReportSubscribers.values()) {
        if (entry.residencePath) paths.add(entry.residencePath);
        const row = entry.path ? this.refLibraryReportRow(entry.path) : null;
        const residence = row && row.task ? refLibraryReportPath(row.task.path) : "";
        if (residence) paths.add(residence);
      }
    }
    return paths;
  }

  refLibraryReportListen(source, event, callback) {
    if (!source || typeof source.on !== "function") return;
    try {
      const ref = source.on(event, callback);
      if (ref) this.refLibraryReportEventRefs.push({ source, ref });
    } catch (error) {
      // Event support differs across desktop, mobile, and test hosts.
    }
  }

  refLibraryReportAttachEvents() {
    if (this.refLibraryReportEventsAttached) return;
    this.refLibraryReportEventsAttached = true;
    this.refLibraryReportEventRefs = [];
    const metadataCache = this.app && this.app.metadataCache;
    this.refLibraryReportListen(metadataCache, "changed", (file) => {
      const path = refLibraryReportPath(file && file.path);
      if (!path) return;
      if (this.refLibraryReportMountedPaths().has(path) || this.refLibraryReportResidencePaths().has(path)) {
        this.refLibraryReportScheduleRevalidate("mounted-metadata");
      }
    });
    const vault = this.app && this.app.vault;
    for (const event of ["rename", "delete"]) {
      this.refLibraryReportListen(vault, event, (file, oldPath) => {
        const paths = this.refLibraryReportMountedPaths();
        const currentPath = refLibraryReportPath(file && file.path);
        const previousPath = refLibraryReportPath(oldPath);
        if (paths.has(currentPath) || paths.has(previousPath)) {
          this.refLibraryReportScheduleRevalidate(`mounted-${event}`);
        }
      });
    }
    const workspace = this.app && this.app.workspace;
    this.refLibraryReportListen(workspace, "file-open", (file) => {
      const path = refLibraryReportPath(file && file.path);
      if (
        path && this.refLibraryReportRow(path) &&
        (this.refLibraryReportAge() || 0) > REF_LIBRARY_REPORT_OPEN_REFRESH_MS
      ) {
        this.refLibraryReportScheduleRevalidate("stale-ref-open");
      }
    });
  }

  refLibraryReportReleaseEvents() {
    if (Array.isArray(this.refLibraryReportEventRefs)) {
      for (const { source, ref } of this.refLibraryReportEventRefs) {
        try {
          if (source && typeof source.offref === "function") source.offref(ref);
          else if (ref && typeof ref.off === "function") ref.off();
        } catch (error) {
          // Best-effort event cleanup on old or partial Obsidian hosts.
        }
      }
    }
    this.refLibraryReportEventRefs = [];
    this.refLibraryReportEventsAttached = false;
  }

  apiRefLibrarySubscribe(callback, options = {}) {
    if (typeof callback !== "function" || this.refLibraryReportActive === false) return () => {};
    if (!Number.isInteger(this.refLibraryReportEpoch)) this.refLibraryReportEpoch = 0;
    if (!(this.refLibraryReportSubscribers instanceof Map)) this.refLibraryReportSubscribers = new Map();
    const wasEmpty = this.refLibraryReportSubscribers.size === 0;
    const opts = typeof options === "string" ? { path: options } : options || {};
    const entry = {
      callback,
      path: refLibraryReportPath(opts.path || opts.refPath),
      residencePath: refLibraryReportPath(opts.residencePath),
    };
    const token = {};
    this.refLibraryReportSubscribers.set(token, entry);
    if (wasEmpty) this.refLibraryReportAttachEvents();
    try {
      callback(this.refLibraryReportState());
    } catch (error) {
      // One renderer cannot prevent other subscribers from mounting.
    }
    if (!this.refLibraryReportSnapshot || (this.refLibraryReportAge() || 0) > REF_LIBRARY_REPORT_FRESH_MS) {
      this.refLibraryReportScheduleRevalidate("first-subscription");
    }
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.refLibraryReportSubscribers.delete(token);
      if (this.refLibraryReportSubscribers.size === 0) {
        this.refLibraryReportClearTimeout(this.refLibraryReportRevalidateTimer);
        this.refLibraryReportRevalidateTimer = null;
        this.refLibraryReportTrailingReady = false;
        this.refLibraryReportReleaseEvents();
      }
    };
  }

  refLibraryReportScheduleRevalidate(_reason = "event") {
    if (
      this.refLibraryReportActive === false ||
      !(this.refLibraryReportSubscribers instanceof Map) ||
      this.refLibraryReportSubscribers.size === 0
    ) return;
    this.refLibraryReportClearTimeout(this.refLibraryReportRevalidateTimer);
    this.refLibraryReportTrailingReady = false;
    this.refLibraryReportRevalidateTimer = this.refLibraryReportSetTimeout(() => {
      this.refLibraryReportRevalidateTimer = null;
      if (
        this.refLibraryReportActive === false ||
        !(this.refLibraryReportSubscribers instanceof Map) ||
        this.refLibraryReportSubscribers.size === 0
      ) return;
      if (this.refLibraryReportFlight) {
        this.refLibraryReportTrailingReady = true;
        return;
      }
      this.refLibraryReportStartFetch();
    }, REF_LIBRARY_REPORT_REVALIDATE_DEBOUNCE_MS);
  }

  refLibraryReportSpawn(options = {}) {
    return bobSpawnJson(refLibraryReportArgs(), refLibraryReportDecode, {
      ...options,
      commandLabel: "bob ref list",
      resolveBobPath: () =>
        typeof this.apiStatsBobPath === "function"
          ? this.apiStatsBobPath()
          : { path: "bob", source: "path" },
      getVaultPath: () =>
        typeof this.statsVaultBasePath === "function" ? this.statsVaultBasePath() : null,
      timeout: REF_LIBRARY_REPORT_TIMEOUT_MS,
      maxBuffer: REF_LIBRARY_REPORT_MAX_BUFFER,
      firstLine: statsFirstLine,
    });
  }

  refLibraryReportStartFetch() {
    if (
      this.refLibraryReportActive === false || this.refLibraryReportFlight ||
      !(this.refLibraryReportSubscribers instanceof Map) || this.refLibraryReportSubscribers.size === 0
    ) return Promise.resolve(this.refLibraryReportState());
    const epoch = this.refLibraryReportEpoch || 0;
    const flight = { epoch, promise: null };
    this.refLibraryReportFlight = flight;
    const run = async () => {
      try {
        const result = await this.refLibraryReportSpawn();
        if (this.refLibraryReportActive === false || this.refLibraryReportEpoch !== epoch) return;
        if (result && result.ok && result.report) {
          this.refLibraryReportSnapshot = result.report;
          this.refLibraryReportReceivedAt = this.refLibraryReportNow();
          this.refLibraryReportStale = false;
          this.refLibraryReportError = null;
        } else {
          this.refLibraryReportStale = Boolean(this.refLibraryReportSnapshot);
          this.refLibraryReportError = result || { code: "failed", message: "bob ref list failed." };
        }
      } catch (error) {
        if (this.refLibraryReportActive !== false && this.refLibraryReportEpoch === epoch) {
          this.refLibraryReportStale = Boolean(this.refLibraryReportSnapshot);
          this.refLibraryReportError = {
            code: "failed",
            message: error && error.message ? String(error.message) : "bob ref list failed.",
          };
        }
      }
    };
    flight.promise = Promise.resolve().then(run).finally(() => {
      if (this.refLibraryReportFlight !== flight) return;
      this.refLibraryReportFlight = null;
      if (this.refLibraryReportActive === false || this.refLibraryReportEpoch !== epoch) return;
      if (this.refLibraryReportSubscribers instanceof Map && this.refLibraryReportSubscribers.size > 0) {
        this.refLibraryReportNotify();
        if (this.refLibraryReportTrailingReady && this.refLibraryReportRevalidateTimer === null) {
          this.refLibraryReportTrailingReady = false;
          this.refLibraryReportStartFetch();
        }
      }
    });
    return flight.promise;
  }

  teardownRefLibraryReport() {
    this.refLibraryReportActive = false;
    this.refLibraryReportEpoch = (this.refLibraryReportEpoch || 0) + 1;
    this.refLibraryReportClearTimeout(this.refLibraryReportRevalidateTimer);
    this.refLibraryReportRevalidateTimer = null;
    this.refLibraryReportTrailingReady = false;
    this.refLibraryReportReleaseEvents();
    if (this.refLibraryReportSubscribers instanceof Map) this.refLibraryReportSubscribers.clear();
    this.refLibraryReportFlight = null;
    this.refLibraryReportSnapshot = null;
    this.refLibraryReportReceivedAt = null;
    this.refLibraryReportStale = false;
    this.refLibraryReportError = null;
  }
}
