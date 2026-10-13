// Daily Stats data path (api.stats v2): resolution order, spawn arguments
// and env, cache/coalescing/debounce, rollover, error cards, and unload
// cleanup. Pure helpers come from the built plugin's exports; the fetch
// cache is driven through the real `apiStatsFetch` with a stubbed spawn.
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  LedgerToolsPlugin,
  makeFreshnessApp,
  withMissingConfig,
} = require("./ledger-tools-harness.cjs");

const {
  STATS_SCHEMA_VERSION,
  statsBobCandidatePaths,
  statsBobTriedList,
  statsBuildArgs,
  statsCacheKey,
  statsDecodeReport,
  statsErrorModel,
  statsExpandHome,
  statsHomeDir,
  statsNormalizeOffset,
  statsNormalizeRange,
  statsResolveBobPath,
} = LedgerToolsPlugin.helpers;

function makePlugin() {
  const app = makeFreshnessApp({ tasks: [] });
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.onload();
  return plugin;
}

function okReport(metrics = [{ id: "worked" }]) {
  return { ok: true, schema_version: 1, today: "2026-10-11", metrics };
}

test("stats resolution prefers stats.bob_path, then candidates, then PATH", () => {
  const configured = statsResolveBobPath({
    configured: "~/bin/bob",
    home: "/home/b",
    existsSync: () => true,
  });
  assert.deepEqual(configured, { path: "/home/b/bin/bob", source: "config" });
  const candidate = statsResolveBobPath({
    configured: "",
    home: "/home/b",
    existsSync: (path) => path === "/home/b/.local/bin/bob",
  });
  assert.deepEqual(candidate, {
    path: "/home/b/.local/bin/bob",
    source: "candidate",
  });
  const onPath = statsResolveBobPath({
    configured: "",
    home: "/home/b",
    existsSync: () => false,
  });
  assert.deepEqual(onPath, { path: "bob", source: "path" });
});

test("stats home expansion and range/offset normalization", () => {
  assert.equal(statsExpandHome("~/bin/bob", "/home/b"), "/home/b/bin/bob");
  assert.equal(statsExpandHome("~", "/home/b"), "/home/b");
  assert.equal(statsExpandHome("/usr/bin/bob", "/home/b"), "/usr/bin/bob");
  assert.equal(statsNormalizeRange("4w", "7d"), "4w");
  assert.equal(statsNormalizeRange("3m", "4w"), "3m");
  assert.equal(statsNormalizeRange("2026-09-13..2026-10-10", "4w"), "2026-09-13..2026-10-10");
  assert.equal(statsNormalizeRange("bogus", "4w"), "4w");
  assert.equal(statsNormalizeRange("", "4w"), "4w");
  assert.equal(statsNormalizeOffset(2), 2);
  assert.equal(statsNormalizeOffset(-1), 0);
  assert.equal(statsNormalizeOffset("x"), 0);
});

test("stats fetch always runs show -a -f json plus the chosen flags", () => {
  assert.deepEqual(statsBuildArgs({}), ["stats", "show", "-a", "-f", "json", "-r", "4w"]);
  assert.deepEqual(statsBuildArgs({ range: "7d", offset: 2, compare: true }), [
    "stats",
    "show",
    "-a",
    "-f",
    "json",
    "-r",
    "7d",
    "-o",
    "2",
    "-c",
  ]);
  assert.deepEqual(statsBuildArgs({ range: "bogus", fallbackRange: "7d" }), [
    "stats",
    "show",
    "-a",
    "-f",
    "json",
    "-r",
    "7d",
  ]);
  assert.notEqual(
    statsCacheKey(statsBuildArgs({ range: "7d" })),
    statsCacheKey(statsBuildArgs({ range: "4w" })),
  );
});

test("stats spawn passes vault env, NO_COLOR, timeout, and a large buffer", async () => {
  await withMissingConfig(async () => {
    const plugin = makePlugin();
    try {
      const seen = {};
      const stubExec = (path, args, options, callback) => {
        seen.path = path;
        seen.args = args;
        seen.options = options;
        callback(null, JSON.stringify(okReport()), "");
      };
      const result = await plugin.statsSpawnFetch(["stats", "show"], {
        execFile: stubExec,
        resolved: { path: "/home/b/.cargo/bin/bob", source: "candidate" },
        tried: ["tried"],
        vaultPath: "/vault",
      });
      assert.equal(result.ok, true);
      assert.equal(seen.path, "/home/b/.cargo/bin/bob");
      assert.deepEqual(seen.args, ["stats", "show"]);
      assert.equal(seen.options.env.BOB_DIR, "/vault");
      assert.equal(seen.options.env.NO_COLOR, "1");
      assert.equal(seen.options.timeout, 20000);
      assert.ok(seen.options.maxBuffer >= 1024 * 1024);
    } finally {
      plugin.onunload();
    }
  });
});

test("stats spawn maps ENOENT, timeouts, and stderr to named errors", async () => {
  await withMissingConfig(async () => {
    const plugin = makePlugin();
    try {
      const missing = await plugin.statsSpawnFetch([], {
        execFile: (path, args, options, callback) => {
          const error = new Error("spawn ENOENT");
          error.code = "ENOENT";
          callback(error, "", "");
        },
        resolved: { path: "bob", source: "path" },
        tried: ["bob (PATH)"],
      });
      assert.equal(missing.code, "bob-not-found");
      const timedOut = await plugin.statsSpawnFetch([], {
        execFile: (path, args, options, callback) => {
          const error = new Error("timeout");
          error.killed = true;
          callback(error, "", "first stderr line\nsecond");
        },
        resolved: { path: "bob", source: "path" },
      });
      assert.equal(timedOut.code, "timeout");
      assert.equal(timedOut.detail, "first stderr line");
    } finally {
      plugin.onunload();
    }
  });
});

test("stats decode accepts schema 1 and rejects the rest defensively", () => {
  assert.equal(STATS_SCHEMA_VERSION, 1);
  assert.equal(statsDecodeReport(JSON.stringify(okReport())).ok, true);
  assert.equal(statsDecodeReport("not json", "").code, "bad-json");
  assert.equal(
    statsDecodeReport(JSON.stringify({ ok: true, schema_version: 2, metrics: [] }), "").code,
    "schema-mismatch",
  );
  const bobError = statsDecodeReport(
    JSON.stringify({ ok: false, schema_version: 1, error: { code: "usage", message: "bad flag" } }),
    "",
  );
  assert.equal(bobError.code, "usage");
  assert.equal(bobError.message, "bad flag");
  assert.equal(
    statsDecodeReport(JSON.stringify({ ok: true, schema_version: 1 }), "").code,
    "bad-shape",
  );
});

test("stats error cards name the cause and the stats.bob_path fix", () => {
  const notFound = statsErrorModel(
    { code: "bob-not-found" },
    { tried: ["/home/b/.cargo/bin/bob", "bob (PATH)"] },
  );
  assert.equal(notFound.title, "bob was not found");
  assert.match(notFound.hint, /stats\.bob_path/);
  assert.match(notFound.hint, /bob \(PATH\)/);
  assert.equal(notFound.retry, true);
  assert.equal(statsErrorModel({ code: "timeout" }).title, "bob stats timed out");
  assert.match(statsErrorModel({ code: "schema-mismatch" }).title, /newer or older/);
  const failed = statsErrorModel({ code: "failed", detail: "first stderr line" });
  assert.equal(failed.hint, "first stderr line");
});

test("stats fetch shares one flight and coalesces one follow-up", async () => {
  await withMissingConfig(async () => {
    const plugin = makePlugin();
    try {
      let spawns = 0;
      plugin.statsSpawnFetch = async (args) => {
        spawns += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { ok: true, report: okReport([{ id: `m${spawns}` }]) };
      };
      const [first, second] = await Promise.all([
        plugin.apiStatsFetch({ range: "7d" }),
        plugin.apiStatsFetch({ range: "7d" }),
      ]);
      assert.equal(spawns, 1);
      assert.equal(first.report.metrics[0].id, "m1");
      assert.equal(second.report.metrics[0].id, "m1");
      // A different key mid-flight becomes the single follow-up.
      plugin.statsFlight = null;
      plugin.statsPendingFetch = null;
      plugin.statsCache.clear();
      spawns = 0;
      let release = null;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      plugin.statsSpawnFetch = async () => {
        spawns += 1;
        await gate;
        return { ok: true, report: okReport() };
      };
      const slow = plugin.apiStatsFetch({ range: "7d" });
      const waiting = plugin.apiStatsFetch({ range: "4w" });
      const waitingAgain = plugin.apiStatsFetch({ range: "4w" });
      release();
      const [slowResult, waitingResult, waitingAgainResult] = await Promise.all([
        slow,
        waiting,
        waitingAgain,
      ]);
      assert.equal(spawns, 2);
      assert.equal(slowResult.stale, false);
      assert.equal(waitingResult.stale, false);
      assert.equal(waitingAgainResult.stale, false);
    } finally {
      plugin.onunload();
    }
  });
});

test("stats cache is a small LRU keyed by the argument list", async () => {
  await withMissingConfig(async () => {
    const plugin = makePlugin();
    try {
      plugin.statsSpawnFetch = async (args) => ({
        ok: true,
        report: okReport([{ id: args.join(",") }]),
      });
      const ranges = ["7d", "4w", "3m", "1y", "all", "2d", "2w", "2m", "2y"];
      for (const range of ranges) {
        const result = await plugin.apiStatsFetch({ range });
        assert.equal(result.stale, false);
      }
      assert.equal(plugin.statsCache.size, 8);
      // The oldest entry (7d) evicted; the newest (2y) kept.
      assert.equal(plugin.statsCacheGet(statsCacheKey(statsBuildArgs({ range: "7d" }))), null);
      assert.notEqual(
        plugin.statsCacheGet(statsCacheKey(statsBuildArgs({ range: "2y" }))),
        null,
      );
    } finally {
      plugin.onunload();
    }
  });
});

test("stats stale entries return immediately and refresh in the background", async () => {
  await withMissingConfig(async () => {
    const plugin = makePlugin();
    try {
      let version = 0;
      plugin.statsSpawnFetch = async () => {
        version += 1;
        const current = version;
        return { ok: true, report: okReport([{ id: `v${current}` }]) };
      };
      const first = await plugin.apiStatsFetch({ range: "7d" });
      assert.equal(first.report.metrics[0].id, "v1");
      assert.equal(first.stale, false);
      const second = await plugin.apiStatsFetch({ range: "7d" });
      assert.equal(second.report.metrics[0].id, "v1");
      assert.equal(second.stale, true);
      // The background flight refreshes the cache.
      await plugin.statsFlight.promise;
      const third = plugin.statsCacheGet(
        statsCacheKey(statsBuildArgs({ range: "7d", fallbackRange: "4w" })),
      );
      assert.notEqual(third, null);
      assert.equal(third.report.metrics[0].id, "v2");
      assert.equal(version, 2);
    } finally {
      plugin.onunload();
    }
  });
});

test("stats api v2 keeps append and adds fetch plus bobPath", async () => {
  await withMissingConfig(async () => {
    const plugin = makePlugin();
    try {
      assert.equal(plugin.api.version, 3);
      assert.equal(plugin.api.stats.version, 2);
      assert.equal(typeof plugin.api.stats.append, "function");
      assert.equal(typeof plugin.api.stats.host, "function");
      assert.equal(typeof plugin.api.stats.fetch, "function");
      assert.equal(typeof plugin.api.stats.bobPath, "function");
      const resolved = plugin.api.stats.bobPath();
      assert.equal(typeof resolved.path, "string");
      assert.ok(["config", "candidate", "path"].includes(resolved.source));
    } finally {
      plugin.onunload();
    }
  });
});

test("statsHomeDir defaults to the real home and strips a trailing slash", () => {
  const os = require("node:os");
  assert.equal(statsHomeDir(), os.homedir());
  assert.equal(statsHomeDir({ osModule: null, env: { HOME: "/Users/x" } }), "/Users/x");
  assert.equal(statsHomeDir({ osModule: null, env: {} }), "");
  assert.equal(
    statsHomeDir({ osModule: null, env: { HOME: "/Users/b/" } }),
    "/Users/b",
  );
});

test("stats mac regression: un-injected resolution probes the real home first", () => {
  const os = require("node:os");
  const expectedHome = os.homedir();
  const probes = [];
  const resolved = statsResolveBobPath({
    configured: "",
    existsSync: (candidate) => {
      probes.push(candidate);
      return candidate === `${expectedHome}/.cargo/bin/bob`;
    },
  });
  assert.equal(probes[0], `${expectedHome}/.cargo/bin/bob`);
  assert.deepEqual(resolved, {
    path: `${expectedHome}/.cargo/bin/bob`,
    source: "candidate",
  });
});

test("stats absolute candidates are probed verbatim with no doubled slashes", () => {
  const probes = [];
  const resolved = statsResolveBobPath({
    configured: "",
    home: "/Users/b",
    existsSync: (candidate) => {
      probes.push(candidate);
      return candidate === "/opt/homebrew/bin/bob";
    },
  });
  assert.deepEqual(resolved, { path: "/opt/homebrew/bin/bob", source: "candidate" });
  for (const probe of probes) {
    assert.ok(!probe.includes("//"), `probe must not contain //: ${probe}`);
  }
});

test("stats with no home probes only absolute candidates", () => {
  const probes = [];
  const resolved = statsResolveBobPath({
    configured: "",
    home: "",
    osModule: null,
    env: {},
    existsSync: (candidate) => {
      probes.push(candidate);
      return false;
    },
  });
  assert.deepEqual(resolved, { path: "bob", source: "path" });
  assert.deepEqual(probes, ["/opt/homebrew/bin/bob", "/usr/local/bin/bob"]);
  for (const probe of probes) {
    assert.ok(!probe.startsWith("."), `no relative probe: ${probe}`);
  }
});

test("stats tilde config expands against the real home", () => {
  const os = require("node:os");
  const resolved = statsResolveBobPath({ configured: "~/.cargo/bin/bob" });
  assert.deepEqual(resolved, {
    path: `${os.homedir()}/.cargo/bin/bob`,
    source: "config",
  });
});

test("stats candidate and tried lists share one source of truth", () => {
  assert.deepEqual(statsBobCandidatePaths("/Users/b"), [
    "/Users/b/.cargo/bin/bob",
    "/Users/b/.local/bin/bob",
    "/opt/homebrew/bin/bob",
    "/usr/local/bin/bob",
  ]);
  assert.deepEqual(statsBobTriedList({ home: "/Users/b" }), [
    "/Users/b/.cargo/bin/bob",
    "/Users/b/.local/bin/bob",
    "/opt/homebrew/bin/bob",
    "/usr/local/bin/bob",
    "bob (PATH)",
  ]);
  assert.deepEqual(statsBobTriedList({ resolved: { path: "/x/bob", source: "config" } }), [
    "/x/bob",
  ]);
});

test("stats spawn bob-not-found tried list uses the real home", async () => {
  await withMissingConfig(async () => {
    const os = require("node:os");
    const plugin = makePlugin();
    try {
      const result = await plugin.statsSpawnFetch([], {
        execFile: (path, args, options, callback) => {
          const error = new Error("spawn ENOENT");
          error.code = "ENOENT";
          callback(error, "", "");
        },
        resolved: { path: "bob", source: "path" },
      });
      assert.equal(result.code, "bob-not-found");
      assert.equal(result.tried[0], `${os.homedir()}/.cargo/bin/bob`);
      for (const entry of result.tried) {
        assert.ok(!entry.startsWith("//"), `tried must not start with //: ${entry}`);
        assert.ok(!entry.startsWith("/."), `tried must not start with /.: ${entry}`);
      }
    } finally {
      plugin.onunload();
    }
  });
});

test("stats unload clears views, timers, cache, and flights", async () => {
  await withMissingConfig(async () => {
    const plugin = makePlugin();
    plugin.statsBlockViews = new Set([{ el: {} }]);
    plugin.statsCacheSet("key", okReport());
    plugin.statsFlight = { key: "key", promise: Promise.resolve() };
    plugin.onunload();
    assert.equal(plugin.statsBlockViews.size, 0);
    assert.equal(plugin.statsCache.size, 0);
    assert.equal(plugin.statsFlight, null);
    assert.equal(plugin.statsPendingFetch, null);
  });
});
