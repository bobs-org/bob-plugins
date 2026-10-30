// --- Daily Stats data path (api.stats v2, bob-cli-6l page) -------------------
// Spawns `bob stats show -a -f json` with stale-while-revalidate caching so
// one call serves tiles, focus, and panels. bob-cli owns every value,
// summary, and display string; this file only moves JSON. Readers decode
// defensively and reject only a different `schema_version`.

const BOB_SPAWN_TIMEOUT_MS = 20000;
const BOB_SPAWN_MAX_BUFFER = 32 * 1024 * 1024;
const STATS_FETCH_TIMEOUT_MS = BOB_SPAWN_TIMEOUT_MS;
const STATS_FETCH_MAX_BUFFER = BOB_SPAWN_MAX_BUFFER;
const STATS_CACHE_SIZE = 16;
const STATS_REVALIDATE_DEBOUNCE_MS = 3000;
// A cache entry older than this is dirty even when no vault event fired.
// It catches review-journal syncs from other hosts under hidden `.bob/`,
// for which Obsidian fires no vault events.
const STATS_MAX_CLEAN_AGE_MS = 10 * 60 * 1000;
const STATS_MAX_PENDING_KEYS = 8;
const STATS_SCHEMA_VERSION = 1;
const STATS_RANGE_PRESETS = ["7d", "4w", "3m", "1y", "all"];
const STATS_DEFAULT_RANGE = "4w";
const STATS_GROUP_IDS = ["day", "week", "month"];
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

function statsNormalizeGroup(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (STATS_GROUP_IDS.includes(text)) {
    return text;
  }
  return "";
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
  const group = statsNormalizeGroup(options.group);
  if (group) {
    args.push("-g", group);
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

// Resolve the configured fallback range, then build the argv and its key.
// Both the page default and the strip default call with `{}` so they share
// one cache entry. Never throws.
function statsRequestFor(options = {}) {
  try {
    const opts = options && typeof options === "object" ? options : {};
    let fallbackRange = STATS_DEFAULT_RANGE;
    try {
      const configured = statsReadConfigValue("range");
      if (typeof configured === "string" && configured.trim()) {
        fallbackRange = configured.trim();
      }
    } catch (error) {
      // Config default is best-effort.
    }
    if (typeof opts.fallbackRange === "string" && opts.fallbackRange.trim()) {
      fallbackRange = opts.fallbackRange.trim();
    }
    const args = statsBuildArgs({ ...opts, fallbackRange });
    return { args, key: statsCacheKey(args) };
  } catch (error) {
    const args = statsBuildArgs({});
    return { args, key: statsCacheKey(args) };
  }
}

// True when a cache entry must revalidate: its fetch started before the
// latest vault change, or it is older than the max clean age. Never throws.
function statsCacheEntryIsDirty(entry, now, gen) {
  try {
    if (!entry || typeof entry !== "object") {
      return true;
    }
    if (
      typeof entry.gen === "number" &&
      typeof gen === "number" &&
      entry.gen < gen
    ) {
      return true;
    }
    const fetchedAt = Number(entry.fetchedAt);
    const at = Number(now);
    const base = Number.isFinite(at) ? at : Date.now();
    if (!Number.isFinite(fetchedAt)) {
      return true;
    }
    return base - fetchedAt > STATS_MAX_CLEAN_AGE_MS;
  } catch (error) {
    return true;
  }
}

// True when a Stats block element is on screen: the tab is visible and the
// element reports itself shown. Unknown hosts count as shown so first paint
// never stalls. Never throws.
function statsBlockViewIsShown(view) {
  try {
    if (
      typeof document !== "undefined" &&
      document &&
      typeof document.visibilityState === "string" &&
      document.visibilityState !== "visible"
    ) {
      return false;
    }
  } catch (error) {
    // Fall through to the element checks.
  }
  try {
    const el = view && view.el;
    if (!el) {
      return false;
    }
    if (typeof el.isShown === "function") {
      try {
        return el.isShown() !== false;
      } catch (error) {
        // Fall through below.
      }
    }
    if (typeof el.checkVisibility === "function") {
      try {
        const shown = el.checkVisibility();
        if (shown === false) {
          return false;
        }
      } catch (error) {
        // Fall through below.
      }
    }
    if ("isConnected" in el && el.isConnected === false) {
      return false;
    }
    return true;
  } catch (error) {
    return true;
  }
}

function statsCancelledResult() {
  return {
    report: null,
    stale: false,
    error: { code: "cancelled", message: "Stats fetch cancelled.", detail: "" },
  };
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

// Shared desktop process boundary for bob JSON commands. The caller owns
// command-specific decoding; this helper only resolves/spawns bob and maps
// process failures. Keep the vault and color environment consistent across
// blocks that read bob output.
function bobSpawnJson(args, decode, options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  const execFile =
    opts.execFile ||
    (() => {
      try {
        const childProcess = planRequireOptionalNodeModule("child_process");
        return childProcess && typeof childProcess.execFile === "function"
          ? childProcess.execFile
          : null;
      } catch (error) {
        return null;
      }
    })();
  let resolved = opts.resolved;
  if (!resolved) {
    try {
      resolved = typeof opts.resolveBobPath === "function"
        ? opts.resolveBobPath()
        : { path: "bob", source: "path" };
    } catch (error) {
      resolved = { path: "bob", source: "path" };
    }
  }
  if (!resolved || typeof resolved.path !== "string" || !resolved.path) {
    resolved = { path: "bob", source: "path" };
  }
  const tried = Array.isArray(opts.tried)
    ? opts.tried
    : statsBobTriedList({ resolved });
  const commandLabel =
    typeof opts.commandLabel === "string" && opts.commandLabel
      ? opts.commandLabel
      : "bob";
  const timeout =
    Number.isFinite(opts.timeout) && opts.timeout > 0
      ? opts.timeout
      : BOB_SPAWN_TIMEOUT_MS;
  const maxBuffer =
    Number.isFinite(opts.maxBuffer) && opts.maxBuffer > 0
      ? opts.maxBuffer
      : BOB_SPAWN_MAX_BUFFER;
  const firstLine = typeof opts.firstLine === "function" ? opts.firstLine : statsFirstLine;
  const decoder = typeof decode === "function" ? decode : () => ({
    ok: false,
    code: "bad-shape",
    message: `${commandLabel} returned no JSON decoder.`,
    detail: "",
  });
  return new Promise((resolve) => {
    if (typeof execFile !== "function") {
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
        opts.vaultPath !== undefined
          ? opts.vaultPath
          : typeof opts.getVaultPath === "function"
            ? opts.getVaultPath()
            : null;
      if (vaultPath) {
        env.BOB_DIR = vaultPath;
      }
      env.NO_COLOR = "1";
    } catch (error) {
      // Environment augmentation is best-effort.
    }
    let settled = false;
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };
    const decodeOutput = (stdout, stderr, exitCode = null) => {
      let result = null;
      try {
        result = decoder(stdout, stderr, exitCode);
      } catch (error) {
        result = {
          ok: false,
          code: "bad-json",
          message: `${commandLabel} output could not be decoded.`,
          detail: firstLine(stderr),
        };
      }
      if (result && result.ok) {
        return { ok: true, report: result.report, exitCode };
      }
      const failure = result && typeof result === "object" ? result : {};
      return {
        ok: false,
        code: typeof failure.code === "string" ? failure.code : "failed",
        message:
          typeof failure.message === "string" && failure.message
            ? failure.message
            : `${commandLabel} failed.`,
        detail: failure.detail || firstLine(stderr),
        tried,
        exitCode,
      };
    };
    const notFound = () => ({
      ok: false,
      code: "bob-not-found",
      message: `bob was not found at ${resolved.path}.`,
      detail: "",
      tried,
    });
    try {
      const child = execFile(
        resolved.path,
        Array.isArray(args) ? args : [],
        { env, timeout, maxBuffer },
        (error, stdout, stderr) => {
          if (error && error.code === "ENOENT") {
            finish(notFound());
            return;
          }
          if (error && error.killed) {
            finish({
              ok: false,
              code: "timeout",
              message: `${commandLabel} timed out after ${Math.round(timeout / 1000)} s.`,
              detail: firstLine(stderr),
              tried,
            });
            return;
          }
          const exitCode = error && Number.isInteger(error.code)
            ? error.code
            : null;
          const decoded = decodeOutput(stdout, stderr, exitCode);
          finish(decoded);
        },
      );
      void child;
    } catch (error) {
      if (error && error.code === "ENOENT") {
        finish(notFound());
        return;
      }
      finish({
        ok: false,
        code: "failed",
        message:
          error && error.message
            ? String(error.message)
            : `${commandLabel} failed to run.`,
        detail: "",
        tried,
      });
    }
  });
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

  statsSpawnFetch(args, options = {}) {
    return bobSpawnJson(args, statsDecodeReport, {
      ...options,
      commandLabel: "bob stats",
      resolveBobPath: () =>
        typeof this.apiStatsBobPath === "function"
          ? this.apiStatsBobPath()
          : { path: "bob", source: "path" },
      getVaultPath: () => this.statsVaultBasePath(),
      timeout: STATS_FETCH_TIMEOUT_MS,
      maxBuffer: STATS_FETCH_MAX_BUFFER,
      firstLine: statsFirstLine,
    });
  }

  // Public: fetch a stats report. Resolves `{ report, stale, error }`.
  // Clean cache hits return immediately with no spawn; dirty hits return
  // the stale frame immediately while one background refresh runs; misses
  // queue behind the single running spawn. Each key settles with its own
  // result, so no waiter is lost. Pass `revalidate: "never"` to skip the
  // background refresh. Never rejects.
  apiStatsFetch(options = {}) {
    const opts = options && typeof options === "object" ? options : {};
    const { args, key } = statsRequestFor(opts);
    const cached = this.statsCacheGet(key);
    if (cached && opts.revalidate === "never") {
      return Promise.resolve({ report: cached.report, stale: false, error: null });
    }
    let now = null;
    try {
      now = Date.now();
    } catch (error) {
      now = cached ? cached.fetchedAt : 0;
    }
    const dirty = statsCacheEntryIsDirty(cached, now, this.statsChangeGenValue());
    if (cached && !dirty) {
      return Promise.resolve({ report: cached.report, stale: false, error: null });
    }
    if (cached) {
      // Stale-while-revalidate: hand back the stale frame now; the
      // queued flight refreshes the cache and notifies subscribers.
      this.statsEnsureQueued(key, args, opts);
      return Promise.resolve({ report: cached.report, stale: true, error: null });
    }
    if (this.statsFlight && this.statsFlight.key === key) {
      return new Promise((resolve) => {
        this.statsFlight.waiters.push(resolve);
      });
    }
    const queued = this.statsPendingByKeyStore().get(key);
    if (queued) {
      return new Promise((resolve) => {
        queued.waiters.push(resolve);
      });
    }
    const entry = { key, args, opts: { ...opts }, waiters: [], hadCached: false };
    const promise = new Promise((resolve) => {
      entry.waiters.push(resolve);
    });
    this.statsEnqueueFetch(entry);
    return promise;
  }

  // Debounced revalidation: bump the change generation on every trigger,
  // then repaint ~3 s later when a Stats view is mounted. At most one
  // timer. Hidden views never spawn; they revalidate when shown.
  scheduleStatsRevalidate(reason) {
    void reason;
    try {
      this.statsBumpChangeGen();
    } catch (error) {
      // Generation bump is best-effort.
    }
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
