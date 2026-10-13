// --- Daily Stats data path (api.stats v2, bob-cli-6l page) -------------------
// Spawns `bob stats show -a -f json` with stale-while-revalidate caching so
// one call serves tiles, focus, and panels. bob-cli owns every value,
// summary, and display string; this file only moves JSON. Readers decode
// defensively and reject only a different `schema_version`.

const STATS_FETCH_TIMEOUT_MS = 20000;
const STATS_FETCH_MAX_BUFFER = 32 * 1024 * 1024;
const STATS_CACHE_SIZE = 8;
const STATS_REVALIDATE_DEBOUNCE_MS = 3000;
const STATS_SCHEMA_VERSION = 1;
const STATS_RANGE_PRESETS = ["7d", "4w", "3m", "1y", "all"];
const STATS_DEFAULT_RANGE = "4w";
// GUI Obsidian on macOS lacks the shell PATH, so desktop `bob` resolution
// tries these before falling back to `bob` on PATH. Entries without a
// leading `/` are relative to the home directory.
const STATS_BOB_CANDIDATES = [
  ".cargo/bin/bob",
  ".local/bin/bob",
  "/opt/homebrew/bin/bob",
  "/usr/local/bin/bob",
];

function statsExpandHome(rawPath, home) {
  const text = typeof rawPath === "string" ? rawPath : "";
  if (text === "~") {
    return typeof home === "string" && home ? home : text;
  }
  if (text.startsWith("~/")) {
    return typeof home === "string" && home ? home + text.slice(1) : text;
  }
  return text;
}

function statsStripOneTrailingSlash(home) {
  if (typeof home === "string" && home.length > 1 && home.endsWith("/")) {
    return home.slice(0, -1);
  }
  return home;
}

function statsHomeDir(options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  let osModule = opts.osModule;
  if (osModule === undefined) {
    try {
      osModule = planRequireOptionalNodeModule("os");
    } catch (error) {
      osModule = null;
    }
  }
  try {
    if (osModule && typeof osModule.homedir === "function") {
      const home = osModule.homedir();
      if (typeof home === "string" && home.trim()) {
        return statsStripOneTrailingSlash(home);
      }
    }
  } catch (error) {
    // Fall through to $HOME below.
  }
  let env = opts.env;
  if (env === undefined) {
    try {
      env =
        typeof process !== "undefined" && process && process.env
          ? process.env
          : {};
    } catch (error) {
      env = {};
    }
  }
  try {
    if (env && typeof env.HOME === "string" && env.HOME.trim()) {
      return statsStripOneTrailingSlash(env.HOME);
    }
  } catch (error) {
    // Fall through to "" below.
  }
  return "";
}

// Absolute paths to probe for `bob`, in STATS_BOB_CANDIDATES order.
// Entries starting with `/` are used verbatim; home-relative entries
// join under `home` only when it is non-empty, so a cwd-relative path
// is never probed. Never throws.
function statsBobCandidatePaths(home) {
  try {
    const base = typeof home === "string" && home ? home : "";
    const paths = [];
    for (const entry of STATS_BOB_CANDIDATES) {
      if (typeof entry !== "string" || !entry) {
        continue;
      }
      if (entry.startsWith("/")) {
        paths.push(entry);
      } else if (base) {
        paths.push(`${base}/${entry}`);
      }
    }
    return paths;
  } catch (error) {
    return [];
  }
}

// User-facing "Tried" list from the same source of truth as resolution.
// When the resolved path came from config, only it was attempted.
// Never throws; on failure falls back to `["bob (PATH)"]`.
function statsBobTriedList(options = {}) {
  try {
    const opts = options && typeof options === "object" ? options : {};
    const resolved = opts.resolved;
    if (resolved && typeof resolved === "object" && resolved.source === "config") {
      if (typeof resolved.path === "string" && resolved.path) {
        return [resolved.path];
      }
    }
    const home =
      opts.home !== undefined ? opts.home : statsHomeDir(opts);
    return [...statsBobCandidatePaths(home), "bob (PATH)"];
  } catch (error) {
    return ["bob (PATH)"];
  }
}

// Resolve the `bob` binary: `stats.bob_path` (tilde-expanded) first, then
// the well-known install locations, else `bob` on PATH. Never throws.
// Returns `{ path, source }` with source `config | candidate | path`.
function statsResolveBobPath(options = {}) {
  const home = options.home !== undefined ? options.home : statsHomeDir(options);
  const configured =
    typeof options.configured === "string" && options.configured.trim()
      ? statsExpandHome(options.configured.trim(), home)
      : "";
  if (configured) {
    return { path: configured, source: "config" };
  }
  const existsSync =
    options.existsSync ||
    (() => {
      try {
        const fsModule = planRequireOptionalNodeModule("fs");
        return fsModule && typeof fsModule.existsSync === "function"
          ? (candidate) => {
              try {
                return fsModule.existsSync(candidate);
              } catch (error) {
                return false;
              }
            }
          : () => false;
      } catch (error) {
        return () => false;
      }
    })();
  for (const candidate of statsBobCandidatePaths(home)) {
    try {
      if (existsSync(candidate)) {
        return { path: candidate, source: "candidate" };
      }
    } catch (error) {
      // Try the next candidate.
    }
  }
  return { path: "bob", source: "path" };
}

// Read one `stats.<key>` value from the bob config file, guarded for
// mobile and missing files. Returns undefined when unreadable.
function statsReadConfigValue(key, options = {}) {
  try {
    const fsModule =
      options.fsModule === undefined
        ? planRequireOptionalNodeModule("fs")
        : options.fsModule;
    if (!fsModule || typeof fsModule.readFileSync !== "function") {
      return undefined;
    }
    const yamlParser =
      options.parseYaml === undefined ? parseYaml : options.parseYaml;
    if (typeof yamlParser !== "function") {
      return undefined;
    }
    const configPath =
      options.configPath || planConfigPath({ env: options.env });
    let text = null;
    try {
      text = fsModule.readFileSync(configPath, "utf8");
    } catch (error) {
      return undefined;
    }
    if (typeof text !== "string" || !text.trim()) {
      return undefined;
    }
    const parsed = yamlParser(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    const block = parsed.stats;
    if (!block || typeof block !== "object" || Array.isArray(block)) {
      return undefined;
    }
    return block[key];
  } catch (error) {
    return undefined;
  }
}

function statsNormalizeRange(value, fallback) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    return fallback;
  }
  if (STATS_RANGE_PRESETS.includes(text)) {
    return text;
  }
  if (/^\d+[dwmy]$/.test(text)) {
    return text;
  }
  const rangeMatch = text.match(/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/);
  if (rangeMatch) {
    return `${rangeMatch[1]}..${rangeMatch[2]}`;
  }
  return fallback;
}

function statsNormalizeOffset(value) {
  const offset = Number(value);
  if (!Number.isInteger(offset) || offset < 0) {
    return 0;
  }
  return offset;
}

// Build the argv for one fetch: always `stats show -a -f json` plus the
// chosen flags, so one call serves tiles, focus, and panels.
function statsBuildArgs(options = {}) {
  const fallback =
    typeof options.fallbackRange === "string" && options.fallbackRange
      ? options.fallbackRange
      : STATS_DEFAULT_RANGE;
  const args = ["stats", "show", "-a", "-f", "json"];
  const range = statsNormalizeRange(options.range, fallback);
  if (range) {
    args.push("-r", range);
  }
  const offset = statsNormalizeOffset(options.offset);
  if (offset > 0) {
    args.push("-o", String(offset));
  }
  if (options.compare === true) {
    args.push("-c");
  }
  if (Array.isArray(options.metrics) && options.metrics.length > 0) {
    for (const id of options.metrics) {
      if (typeof id === "string" && id.trim()) {
        args.push(id.trim());
      }
    }
  }
  return args;
}

function statsCacheKey(args) {
  try {
    return JSON.stringify(Array.isArray(args) ? args : []);
  } catch (error) {
    return String(args);
  }
}

// Defensive decode: accept schema 1 reports, reject everything else with
// a named error. Returns `{ ok: true, report }` or
// `{ ok: false, code, message, detail }`.
function statsDecodeReport(stdout, stderr) {
  let body = null;
  try {
    body = JSON.parse(String(stdout === undefined ? "" : stdout));
  } catch (error) {
    return {
      ok: false,
      code: "bad-json",
      message: "bob stats returned output that is not JSON.",
      detail: statsFirstLine(stderr),
    };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      code: "bad-shape",
      message: "bob stats returned an unexpected JSON shape.",
      detail: statsFirstLine(stderr),
    };
  }
  if (body.schema_version !== STATS_SCHEMA_VERSION) {
    return {
      ok: false,
      code: "schema-mismatch",
      message: `bob stats returned schema ${String(body.schema_version)}, this block reads schema ${STATS_SCHEMA_VERSION}.`,
      detail: statsFirstLine(stderr),
    };
  }
  if (body.ok === false) {
    const inner = body.error && typeof body.error === "object" ? body.error : {};
    return {
      ok: false,
      code:
        typeof inner.code === "string" && inner.code ? inner.code : "bob-error",
      message:
        typeof inner.message === "string" && inner.message
          ? inner.message
          : "bob stats reported an error.",
      detail: statsFirstLine(stderr),
    };
  }
  if (!Array.isArray(body.metrics)) {
    return {
      ok: false,
      code: "bad-shape",
      message: "bob stats returned a report without metrics.",
      detail: statsFirstLine(stderr),
    };
  }
  return { ok: true, report: body };
}

function statsFirstLine(stderr) {
  try {
    const text = String(stderr === undefined ? "" : stderr);
    const line = text.split("\n").map((part) => part.trim()).find(Boolean);
    return line || "";
  } catch (error) {
    return "";
  }
}

// Actionable error card model: what happened, what to try, and whether a
// Retry button applies. Never throws.
function statsErrorModel(result, options = {}) {
  const resolved =
    result && typeof result === "object" ? result : { code: "unknown" };
  if (resolved.code === "bob-not-found") {
    const tried = Array.isArray(options.tried) ? options.tried : [];
    return {
      code: "bob-not-found",
      title: "bob was not found",
      hint:
        tried.length > 0
          ? `Tried ${tried.join(", ")}. Set stats.bob_path in ~/.config/bob/config.yml.`
          : "Set stats.bob_path in ~/.config/bob/config.yml.",
      retry: true,
    };
  }
  if (resolved.code === "timeout") {
    return {
      code: "timeout",
      title: "bob stats timed out",
      hint: "The vault may be large; retry once before investigating.",
      retry: true,
    };
  }
  if (resolved.code === "schema-mismatch") {
    return {
      code: "schema-mismatch",
      title: "bob stats is newer or older than this block",
      hint: "Update bob-cli and Bob Ledger Tools together, then retry.",
      retry: true,
    };
  }
  return {
    code: typeof resolved.code === "string" ? resolved.code : "failed",
    title: "bob stats failed",
    hint: resolved.detail || resolved.message || "Retry once, then run bob stats in a terminal.",
    retry: true,
  };
}

class BobLedgerToolsStatsDataMixin {
  statsVaultBasePath() {
    try {
      const adapter = this.app && this.app.vault && this.app.vault.adapter;
      if (adapter && typeof adapter.basePath === "string" && adapter.basePath) {
        return adapter.basePath;
      }
      if (adapter && typeof adapter.getBasePath === "function") {
        const basePath = adapter.getBasePath();
        if (typeof basePath === "string" && basePath) {
          return basePath;
        }
      }
    } catch (error) {
      // Fall through to null below.
    }
    return null;
  }

  statsConfiguredBobPath() {
    const value = statsReadConfigValue("bob_path");
    return typeof value === "string" && value.trim() ? value.trim() : "";
  }

  // Public: where the Stats block finds `bob`. Synchronous, never throws.
  apiStatsBobPath() {
    try {
      return statsResolveBobPath({
        configured: this.statsConfiguredBobPath(),
      });
    } catch (error) {
      return { path: "bob", source: "path" };
    }
  }

  statsCacheStore() {
    if (!(this.statsCache instanceof Map)) {
      this.statsCache = new Map();
    }
    return this.statsCache;
  }

  statsCacheGet(key) {
    const store = this.statsCacheStore();
    const entry = store.get(key);
    if (!entry) {
      return null;
    }
    // LRU touch: reinsert so the oldest entry evicts first.
    store.delete(key);
    store.set(key, entry);
    return entry;
  }

  statsCacheSet(key, report) {
    const store = this.statsCacheStore();
    if (store.has(key)) {
      store.delete(key);
    }
    store.set(key, { report, fetchedAt: Date.now() });
    while (store.size > STATS_CACHE_SIZE) {
      const oldest = store.keys().next();
      if (oldest.done) {
        break;
      }
      store.delete(oldest.value);
    }
  }

  statsSpawnFetch(args, options = {}) {
    const execFile =
      options.execFile ||
      (() => {
        try {
          const childProcess = planRequireOptionalNodeModule("child_process");
          return (
            childProcess && typeof childProcess.execFile === "function"
              ? childProcess.execFile
              : null
          );
        } catch (error) {
          return null;
        }
      })();
    const resolved =
      options.resolved || (typeof this.apiStatsBobPath === "function"
        ? this.apiStatsBobPath()
        : { path: "bob", source: "path" });
    const tried = options.tried || statsBobTriedList({ resolved });
    return new Promise((resolve) => {
      if (typeof execFile !== "function") {
        // Desktop-only spawn: no child_process off desktop.
        resolve({
          ok: false,
          code: "bob-not-found",
          message: "Spawning bob needs the desktop app.",
          detail: "",
          tried,
        });
        return;
      }
      let env = null;
      try {
        const base = (typeof process !== "undefined" && process.env) || {};
        env = { ...base };
      } catch (error) {
        env = {};
      }
      try {
        const vaultPath =
          options.vaultPath !== undefined
            ? options.vaultPath
            : this.statsVaultBasePath();
        if (vaultPath) {
          env.BOB_DIR = vaultPath;
        }
        env.NO_COLOR = "1";
      } catch (error) {
        // Env augmentation is best-effort.
      }
      let settled = false;
      const finish = (result) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(result);
      };
      let child = null;
      try {
        child = execFile(
          resolved.path,
          args,
          { env, timeout: STATS_FETCH_TIMEOUT_MS, maxBuffer: STATS_FETCH_MAX_BUFFER },
          (error, stdout, stderr) => {
            if (error) {
              if (error.code === "ENOENT") {
                finish({
                  ok: false,
                  code: "bob-not-found",
                  message: `bob was not found at ${resolved.path}.`,
                  detail: "",
                  tried,
                });
                return;
              }
              if (error.killed) {
                finish({
                  ok: false,
                  code: "timeout",
                  message: "bob stats timed out after 20 s.",
                  detail: statsFirstLine(stderr),
                  tried,
                });
                return;
              }
              const decoded = statsDecodeReport(stdout, stderr);
              if (decoded.ok) {
                finish({ ok: true, report: decoded.report });
                return;
              }
              finish({
                ok: false,
                code: decoded.code,
                message: decoded.message,
                detail: decoded.detail || statsFirstLine(stderr),
                tried,
              });
              return;
            }
            finish(statsDecodeReport(stdout, stderr));
          },
        );
      } catch (error) {
        if (error && error.code === "ENOENT") {
          finish({
            ok: false,
            code: "bob-not-found",
            message: `bob was not found at ${resolved.path}.`,
            detail: "",
            tried,
          });
          return;
        }
        finish({
          ok: false,
          code: "failed",
          message:
            error && error.message ? String(error.message) : "bob stats failed to run.",
          detail: "",
          tried,
        });
      }
      void child;
    });
  }

  // Public: fetch a stats report. Resolves `{ report, stale, error }`:
  // a cached report returns immediately as stale while one background
  // revalidation refreshes it; a miss spawns `bob`. At most one spawn
  // is in flight with one coalesced follow-up; concurrent callers for
  // the same arguments share the flight. Never rejects.
  apiStatsFetch(options = {}) {
    const opts = options && typeof options === "object" ? options : {};
    let fallbackRange = STATS_DEFAULT_RANGE;
    try {
      const configuredRange = statsReadConfigValue("range");
      if (typeof configuredRange === "string" && configuredRange.trim()) {
        fallbackRange = configuredRange.trim();
      }
    } catch (error) {
      // Config default is best-effort.
    }
    const args = statsBuildArgs({ ...opts, fallbackRange });
    const key = statsCacheKey(args);
    const cached = this.statsCacheGet(key);
    // Same arguments already in flight: share the flight.
    if (this.statsFlight && this.statsFlight.key === key) {
      return this.statsFlight.promise;
    }
    if (this.statsFlight) {
      // A different key is in flight: coalesce to the single pending
      // follow-up (latest options win); waiters share its promise.
      if (
        !this.statsPendingFetch ||
        statsCacheKey(
          statsBuildArgs({ ...this.statsPendingFetch.opts, fallbackRange }),
        ) !== key
      ) {
        this.statsPendingFetch = { opts: { ...opts }, waiters: [] };
        this.statsPendingFetch.promise = new Promise((resolve) => {
          this.statsPendingFetch.waiters.push(resolve);
        });
      }
      const pending = this.statsPendingFetch;
      if (cached) {
        return Promise.resolve({ report: cached.report, stale: true, error: null });
      }
      return pending.promise;
    }
    const run = async (runArgs, runKey, runOpts, hadCached) => {
      try {
        const result = await this.statsSpawnFetch(runArgs, runOpts);
        if (result && result.ok) {
          this.statsCacheSet(runKey, result.report);
          if (hadCached) {
            // The caller already holds the stale frame; repaint views
            // with the fresh one.
            try {
              this.repaintStatsBlocks();
            } catch (error) {
              // Repaint is best-effort.
            }
          }
          return { report: result.report, stale: false, error: null };
        }
        if (hadCached) {
          const staleEntry = this.statsCacheGet(runKey);
          return {
            report: staleEntry ? staleEntry.report : null,
            stale: true,
            error: result,
          };
        }
        return { report: null, stale: false, error: result };
      } catch (error) {
        const failure = {
          ok: false,
          code: "failed",
          message:
            error && error.message ? String(error.message) : "bob stats failed.",
          detail: "",
        };
        if (hadCached) {
          const staleEntry = this.statsCacheGet(runKey);
          return {
            report: staleEntry ? staleEntry.report : null,
            stale: true,
            error: failure,
          };
        }
        return { report: null, stale: false, error: failure };
      }
    };
    const launch = (launchArgs, launchKey, launchOpts, hadCached) => {
      const promise = run(launchArgs, launchKey, launchOpts, hadCached).finally(
        () => {
          if (this.statsFlight && this.statsFlight.promise === promise) {
            this.statsFlight = null;
          }
          // One coalesced follow-up: the latest request that arrived
          // mid-flight runs next.
          if (this.statsPendingFetch) {
            const pending = this.statsPendingFetch;
            this.statsPendingFetch = null;
            const pendingArgs = statsBuildArgs({
              ...pending.opts,
              fallbackRange,
            });
            const pendingKey = statsCacheKey(pendingArgs);
            const pendingCached = this.statsCacheGet(pendingKey);
            const next = launch(pendingArgs, pendingKey, pending.opts, Boolean(pendingCached));
            for (const waiter of pending.waiters) {
              try {
                next.then(waiter);
              } catch (error) {
                // Waiter delivery is best-effort.
              }
            }
          }
        },
      );
      this.statsFlight = { key: launchKey, promise };
      return promise;
    };
    const flight = launch(args, key, opts, Boolean(cached));
    if (cached) {
      // Stale-while-revalidate: hand back the stale frame now; the
      // flight refreshes the cache and repaints.
      return Promise.resolve({ report: cached.report, stale: true, error: null });
    }
    return flight;
  }

  // Debounced revalidation: only while a Stats view is mounted, at most
  // one timer, ~3 s after the last trigger.
  scheduleStatsRevalidate(reason) {
    void reason;
    try {
      if (!this.statsBlockViews || this.statsBlockViews.size === 0) {
        return;
      }
    } catch (error) {
      return;
    }
    if (this.statsRevalidateTimer !== null && this.statsRevalidateTimer !== undefined) {
      return;
    }
    const schedule =
      typeof window !== "undefined" && typeof window.setTimeout === "function"
        ? window.setTimeout
        : setTimeout;
    this.statsRevalidateTimer = schedule(() => {
      this.statsRevalidateTimer = null;
      try {
        this.revalidateStatsBlocks();
      } catch (error) {
        // Revalidation is best-effort.
      }
    }, STATS_REVALIDATE_DEBOUNCE_MS);
  }

  scheduleStatsRevalidateForFile(file) {
    try {
      if (!file) {
        return;
      }
      // Ledger rows are not Tasks lines, so Tasks `cache-update` alone
      // is not enough: any vault write may move a stat.
      this.scheduleStatsRevalidate("vault");
    } catch (error) {
      // Best-effort only.
    }
  }

  statsAfterJournalAppend() {
    try {
      this.scheduleStatsRevalidate("journal");
    } catch (error) {
      // Best-effort only.
    }
  }
}
