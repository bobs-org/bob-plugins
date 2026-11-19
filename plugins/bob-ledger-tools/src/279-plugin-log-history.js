// --- api.logs v1: the read-only bob-cli phrase catalog plus a session overlay.
// bob owns source scanning and ranking; this plugin only caches the JSON and
// lets successful local writes appear before bob's next scan completes.

const LOG_HISTORY_KINDS = Object.freeze(["schedule", "work", "rotten", "cancel"]);
const LOG_HISTORY_REVALIDATE_MS = 1000;

function logHistoryNormalizeQuery(value) {
  try {
    return String(value == null ? "" : value)
      .normalize("NFC")
      .toLowerCase()
      .split(/\s+/u)
      .filter(Boolean)
      .join(" ");
  } catch (_error) {
    return "";
  }
}

function logHistoryDecodeReport(stdout, stderr) {
  let body;
  try {
    body = JSON.parse(String(stdout == null ? "" : stdout));
  } catch (_error) {
    return {
      ok: false,
      code: "bad-json",
      message: "bob logs returned output that is not JSON.",
      detail: statsFirstLine(stderr),
    };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, code: "bad-shape", message: "bob logs returned an unexpected JSON shape.", detail: statsFirstLine(stderr) };
  }
  if (body.schema_version !== 1) {
    return { ok: false, code: "schema-mismatch", message: `bob logs returned schema ${String(body.schema_version)}; this plugin reads schema 1.`, detail: statsFirstLine(stderr) };
  }
  if (body.ok !== true || !Array.isArray(body.logs)) {
    const inner = body.error && typeof body.error === "object" ? body.error : {};
    return {
      ok: false,
      code: typeof inner.code === "string" ? inner.code : "bad-shape",
      message: typeof inner.message === "string" ? inner.message : "bob logs returned a report without logs.",
      detail: statsFirstLine(stderr),
    };
  }
  const logs = body.logs.filter((log) =>
    log && typeof log === "object" && LOG_HISTORY_KINDS.includes(log.kind) && Array.isArray(log.phrases),
  );
  if (logs.length !== body.logs.length) {
    return { ok: false, code: "bad-shape", message: "bob logs returned a malformed log catalog.", detail: statsFirstLine(stderr) };
  }
  return { ok: true, report: body };
}

function logHistoryStampForOverlay(at, kind) {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return String(at || "");
  const pad = (value) => String(value).padStart(2, "0");
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return kind === "work" ? `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}` : day;
}

function logHistoryPhraseFromOverlay(entry, recencyRank, kind) {
  return {
    text: entry.text,
    key: entry.key,
    uses: 1,
    last_used: logHistoryStampForOverlay(entry.at, kind),
    score: 1,
    recency_rank: recencyRank,
    match: null,
  };
}

function logHistoryMergeOverlay(catalog, overlay) {
  if (!catalog || !Array.isArray(catalog.logs)) return null;
  const byKind = overlay && typeof overlay === "object" ? overlay : {};
  const logs = catalog.logs.map((log) => {
    const entries = Array.isArray(byKind[log.kind]) ? byKind[log.kind] : [];
    const newestByKey = new Map();
    for (const entry of entries) {
      if (!entry || typeof entry.text !== "string") continue;
      const key = logHistoryNormalizeQuery(entry.key || entry.text);
      const at = typeof entry.at === "string" ? entry.at : "";
      if (!key || !at) continue;
      const previous = newestByKey.get(key);
      if (!previous || at > previous.at) newestByKey.set(key, { ...entry, key, at });
    }
    const orderedOverlay = [...newestByKey.values()].sort((a, b) =>
      b.at.localeCompare(a.at) || a.key.localeCompare(b.key),
    );
    const overlayRank = new Map(
      orderedOverlay.map((entry, index) => [entry.key, index - orderedOverlay.length]),
    );
    const phraseByKey = new Map();
    for (const phrase of log.phrases) {
      if (!phrase || typeof phrase.key !== "string") continue;
      phraseByKey.set(phrase.key, { ...phrase });
    }
    for (const entry of orderedOverlay) {
      const rank = overlayRank.get(entry.key);
      const existing = phraseByKey.get(entry.key);
      if (existing) {
        existing.text = entry.text;
        existing.last_used = logHistoryStampForOverlay(entry.at, log.kind);
        existing.recency_rank = rank;
      } else {
        phraseByKey.set(entry.key, logHistoryPhraseFromOverlay(entry, rank, log.kind));
      }
    }
    const phrases = [...phraseByKey.values()].sort((a, b) =>
      Number(a.recency_rank) - Number(b.recency_rank) || a.key.localeCompare(b.key),
    );
    return { ...log, phrases };
  });
  return { ...catalog, logs };
}

class BobLedgerToolsLogHistoryMixin {
  logHistoryIsDesktop() {
    try {
      return typeof Platform !== "undefined" && Platform && Platform.isDesktopApp === true;
    } catch (_error) {
      return false;
    }
  }

  logHistoryCacheStore() {
    if (!this.logHistoryCache || typeof this.logHistoryCache !== "object") this.logHistoryCache = null;
    if (!(this.logHistoryOverlay instanceof Object)) this.logHistoryOverlay = {};
    if (!(this.logHistoryListeners instanceof Set)) this.logHistoryListeners = new Set();
    if (!(this.logHistoryUnsupportedPaths instanceof Set)) this.logHistoryUnsupportedPaths = new Set();
    return this.logHistoryCache;
  }

  apiLogsSnapshot() {
    try {
      const cached = this.logHistoryCacheStore();
      return cached ? logHistoryMergeOverlay(cached.catalog, this.logHistoryOverlay) : null;
    } catch (_error) {
      return null;
    }
  }

  apiLogsNotify(reason) {
    const snapshot = this.apiLogsSnapshot();
    try {
      for (const listener of [...(this.logHistoryListeners || [])]) {
        try { listener(snapshot, reason); } catch (_error) { /* one listener cannot break others */ }
      }
    } catch (_error) { /* notifications are best-effort */ }
  }

  logHistoryBobPath() {
    try {
      if (typeof this.apiStatsBobPath === "function") {
        const resolved = this.apiStatsBobPath();
        if (resolved && typeof resolved.path === "string" && resolved.path) return resolved;
      }
    } catch (_error) { /* use PATH fallback */ }
    return { path: "bob", source: "path" };
  }

  async logHistorySpawnFetch(resolved) {
    return bobSpawnJson(["logs", "list", "--format", "json"], logHistoryDecodeReport, {
      resolved,
      commandLabel: "bob logs",
      getVaultPath: () => this.statsVaultBasePath(),
      timeout: BOB_SPAWN_TIMEOUT_MS,
      maxBuffer: BOB_SPAWN_MAX_BUFFER,
      firstLine: statsFirstLine,
    });
  }

  logHistoryResult(status, cached, error = null) {
    return {
      status,
      catalog: cached ? logHistoryMergeOverlay(cached.catalog, this.logHistoryOverlay) : null,
      fetchedAt: cached && cached.fetchedAt ? cached.fetchedAt : null,
      ...(error ? { error } : {}),
    };
  }

  async apiLogsFetch(options = {}) {
    try {
      const cached = this.logHistoryCacheStore();
      if (!this.logHistoryIsDesktop()) return this.logHistoryResult("unavailable", cached);
      const resolved = this.logHistoryBobPath();
      const bobKey = resolved.path;
      if (this.logHistoryUnsupportedPaths.has(bobKey)) return this.logHistoryResult("unsupported", cached);
      const force = Boolean(options && options.force === true);
      if (this.logHistoryFlight) {
        if (cached && !force) return this.logHistoryResult("stale", cached);
        return this.logHistoryFlight;
      }
      if (cached && !force) {
        this.startLogHistoryFetch(resolved);
        return this.logHistoryResult("stale", cached);
      }
      return await this.startLogHistoryFetch(resolved);
    } catch (error) {
      const cached = this.logHistoryCacheStore();
      return this.logHistoryResult(cached ? "stale" : "error", cached, { message: String(error && error.message || error) });
    }
  }

  startLogHistoryFetch(resolved) {
    const generation = (this.logHistoryGeneration || 0) + 1;
    this.logHistoryGeneration = generation;
    const run = (async () => {
      const cached = this.logHistoryCacheStore();
      let result;
      try {
        result = await this.logHistorySpawnFetch(resolved);
      } catch (error) {
        result = { ok: false, code: "failed", message: String(error && error.message || error) };
      }
      if (generation !== this.logHistoryGeneration) return this.logHistoryResult("stale", this.logHistoryCacheStore());
      if (result && result.ok && result.report && result.report.schema_version === 1) {
        this.logHistoryCache = { catalog: result.report, fetchedAt: Date.now(), bobPath: resolved.path };
        this.apiLogsNotify("fetch");
        return this.logHistoryResult("ok", this.logHistoryCache);
      }
      const message = String(result && result.message || "bob logs could not be read.");
      const detail = String(result && result.detail || "");
      if (/unrecognized subcommand|unknown (?:subcommand|command).*logs|no such command.*logs|unexpected argument[^\n]*logs/i.test(`${message}\n${detail}`)) {
        this.logHistoryUnsupportedPaths.add(resolved.path);
        if (cached) return this.logHistoryResult("stale", cached, result);
        return this.logHistoryResult("unsupported", null, result);
      }
      if (cached) return this.logHistoryResult("stale", cached, result);
      return this.logHistoryResult(result && result.code === "unavailable" ? "unavailable" : "error", null, result || null);
    })().finally(() => {
      if (this.logHistoryFlight === flight) this.logHistoryFlight = null;
    });
    const flight = run;
    this.logHistoryFlight = flight;
    return flight;
  }

  apiLogsNoteUsed(kind, text) {
    try {
      this.logHistoryCacheStore();
      const normalizedKind = String(kind || "").toLowerCase();
      const value = String(text == null ? "" : text).replace(/\s+/gu, " ").trim();
      const key = logHistoryNormalizeQuery(value);
      if (!LOG_HISTORY_KINDS.includes(normalizedKind) || !key) return false;
      const entries = Array.isArray(this.logHistoryOverlay[normalizedKind])
        ? this.logHistoryOverlay[normalizedKind].slice()
        : [];
      entries.push({ key, text: value, at: new Date().toISOString() });
      this.logHistoryOverlay = { ...this.logHistoryOverlay, [normalizedKind]: entries.slice(-50) };
      this.apiLogsNotify("overlay");
      if (this.logHistoryRevalidateTimer == null) {
        const schedule = typeof window !== "undefined" && typeof window.setTimeout === "function" ? window.setTimeout.bind(window) : setTimeout;
        this.logHistoryRevalidateTimer = schedule(() => {
          this.logHistoryRevalidateTimer = null;
          void this.apiLogsFetch({ force: true });
        }, LOG_HISTORY_REVALIDATE_MS);
      }
      return true;
    } catch (_error) {
      return false;
    }
  }

  onLogsChange(callback) {
    try {
      if (typeof callback !== "function") return () => {};
      this.logHistoryCacheStore();
      this.logHistoryListeners.add(callback);
      return () => { try { this.logHistoryListeners.delete(callback); } catch (_error) {} };
    } catch (_error) {
      return () => {};
    }
  }

  scheduleLogHistoryPrefetch() {
    try {
      if (this.logHistoryPrefetchTimer != null) return;
      const schedule = typeof window !== "undefined" && typeof window.setTimeout === "function" ? window.setTimeout.bind(window) : setTimeout;
      this.logHistoryPrefetchTimer = schedule(() => {
        this.logHistoryPrefetchTimer = null;
        void this.apiLogsFetch();
      }, 5000);
    } catch (_error) { /* prefetch is best-effort */ }
  }

  teardownLogHistory() {
    try { if (this.logHistoryPrefetchTimer != null) clearTimeout(this.logHistoryPrefetchTimer); } catch (_error) {}
    try { if (this.logHistoryRevalidateTimer != null) clearTimeout(this.logHistoryRevalidateTimer); } catch (_error) {}
    this.logHistoryPrefetchTimer = null;
    this.logHistoryRevalidateTimer = null;
    if (this.logHistoryListeners instanceof Set) this.logHistoryListeners.clear();
    this.logHistoryGeneration = (this.logHistoryGeneration || 0) + 1;
    this.logHistoryFlight = null;
  }

  logHistoryApi() {
    return Object.freeze({
      version: 1,
      fetch: (options) => this.apiLogsFetch(options),
      snapshot: () => this.apiLogsSnapshot(),
      noteUsed: (kind, text) => this.apiLogsNoteUsed(kind, text),
      onChange: (callback) => this.onLogsChange(callback),
    });
  }
}
