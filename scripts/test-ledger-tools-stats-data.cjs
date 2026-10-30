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
  STATS_CACHE_SIZE,
  STATS_MAX_CLEAN_AGE_MS,
  STATS_MAX_PENDING_KEYS,
  STATS_SCHEMA_VERSION,
  statsBlockViewIsShown,
  statsBobCandidatePaths,
  statsBobTriedList,
  statsBuildArgs,
  statsCacheEntryIsDirty,
  statsCacheKey,
  statsDecodeReport,
  statsErrorModel,
  statsExpandHome,
  statsHomeDir,
  statsNormalizeGroup,
  statsNormalizeOffset,
  statsNormalizeRange,
  statsRequestFor,
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

test("stats group emits -g before metric ids and rejects the rest", () => {
  assert.equal(statsNormalizeGroup("day"), "day");
  assert.equal(statsNormalizeGroup("week"), "week");
  assert.equal(statsNormalizeGroup("month"), "month");
  assert.equal(statsNormalizeGroup("year"), "");
  assert.equal(statsNormalizeGroup(""), "");
  assert.equal(statsNormalizeGroup(null), "");
  assert.deepEqual(statsBuildArgs({ group: "day" }), [
    "stats",
    "show",
    "-a",
    "-f",
    "json",
    "-r",
    "4w",
    "-g",
    "day",
  ]);
  assert.deepEqual(statsBuildArgs({ group: "bogus" }), [
    "stats",
    "show",
    "-a",
    "-f",
    "json",
    "-r",
    "4w",
  ]);
  assert.deepEqual(statsBuildArgs({ group: "week", metrics: ["worked"] }), [
    "stats",
    "show",
    "-a",
    "-f",
    "json",
    "-r",
    "4w",
    "-g",
    "week",
    "worked",
  ]);
  assert.notEqual(
    statsCacheKey(statsBuildArgs({})),
    statsCacheKey(statsBuildArgs({ group: "day" })),
  );
});

test("stats request resolves one shared key for the page and strip defaults", async () => {
  await withMissingConfig(async () => {
    const page = statsRequestFor({ range: undefined, offset: 0 });
    const strip = statsRequestFor({});
    assert.deepEqual(page.args, strip.args);
    assert.equal(page.key, strip.key);
    const ranged = statsRequestFor({ range: "2026-10-04..2026-10-11", group: "day" });
    assert.ok(ranged.args.includes("-g"));
    assert.ok(ranged.args.includes("day"));
    assert.notEqual(ranged.key, strip.key);
  });
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
      assert.equal(result.exitCode, null);
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
      const setupFailure = await plugin.statsSpawnFetch([], {
        execFile: (path, args, options, callback) => {
          const error = new Error("not connected");
          error.code = 2;
          callback(error, JSON.stringify({ schema_version: 1, ok: false, error: { code: "not_connected", message: "not connected" } }), "");
        },
        resolved: { path: "bob", source: "path" },
      });
      assert.equal(setupFailure.exitCode, 2);
      assert.equal(setupFailure.code, "not_connected");
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

test("stats fetch shares one flight per key and queues distinct keys FIFO", async () => {
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
      // A different key mid-flight queues behind it; repeat callers for
      // the queued key share its entry.
      plugin.statsFlight = null;
      plugin.statsPendingFetch = null;
      plugin.statsPendingQueue = [];
      plugin.statsPendingByKey = new Map();
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
      assert.equal(waitingResult.report, waitingAgainResult.report);
    } finally {
      plugin.onunload();
    }
  });
});

test("stats fetch never loses waiters: A in flight, B then C settle with own reports", async () => {
  await withMissingConfig(async () => {
    const plugin = makePlugin();
    try {
      let spawns = 0;
      let release = null;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      plugin.statsSpawnFetch = async (args) => {
        spawns += 1;
        await gate;
        const text = args.join(",");
        const id = text.includes("3m") ? "C" : text.includes("4w") ? "B" : "A";
        return { ok: true, report: okReport([{ id }]) };
      };
      const a = plugin.apiStatsFetch({ range: "7d" });
      const b = plugin.apiStatsFetch({ range: "4w" });
      const c = plugin.apiStatsFetch({ range: "3m" });
      release();
      const [aResult, bResult, cResult] = await Promise.all([a, b, c]);
      assert.equal(spawns, 3);
      assert.equal(aResult.report.metrics[0].id, "A");
      assert.equal(bResult.report.metrics[0].id, "B");
      assert.equal(cResult.report.metrics[0].id, "C");
      for (const result of [aResult, bResult, cResult]) {
        assert.equal(result.stale, false);
        assert.equal(result.error, null);
      }
    } finally {
      plugin.onunload();
    }
  });
});

test("stats queue caps at 8 distinct pending keys with explicit cancellation", async () => {
  await withMissingConfig(async () => {
    assert.equal(STATS_MAX_PENDING_KEYS, 8);
    const plugin = makePlugin();
    try {
      let spawns = 0;
      let release = null;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      plugin.statsSpawnFetch = async (args) => {
        spawns += 1;
        await gate;
        return { ok: true, report: okReport([{ id: args.join(",") }]) };
      };
      const ranges = ["7d", "4w", "3m", "1y", "all", "2d", "2w", "2m", "2y", "3d"];
      const pending = ranges.map((range) => plugin.apiStatsFetch({ range }));
      release();
      const settled = await Promise.all(pending);
      // The running key plus 8 queued keys spawn; the oldest pending key
      // (4w) is dropped and settled with an explicit cancellation.
      assert.equal(spawns, 9);
      assert.equal(settled[1].report, null);
      assert.equal(settled[1].stale, false);
      assert.equal(settled[1].error.code, "cancelled");
      assert.equal(settled[0].report.metrics[0].id.includes("7d"), true);
      assert.equal(settled[9].stale, false);
      assert.equal(settled[9].error, null);
    } finally {
      plugin.onunload();
    }
  });
});

test("stats cache is a 16-entry LRU keyed by the argument list", async () => {
  await withMissingConfig(async () => {
    assert.equal(STATS_CACHE_SIZE, 16);
    const plugin = makePlugin();
    try {
      plugin.statsSpawnFetch = async (args) => ({
        ok: true,
        report: okReport([{ id: args.join(",") }]),
      });
      const ranges = [
        "7d", "4w", "3m", "1y", "all", "2d", "2w", "2m", "2y",
        "3d", "3w", "6m", "5d", "9d", "10d", "11d", "12d",
      ];
      for (const range of ranges) {
        const result = await plugin.apiStatsFetch({ range });
        assert.equal(result.stale, false);
      }
      assert.equal(plugin.statsCache.size, 16);
      // The oldest entry (7d) evicted; the newest (12d) kept.
      assert.equal(plugin.statsCacheGet(statsCacheKey(statsBuildArgs({ range: "7d" }))), null);
      assert.notEqual(
        plugin.statsCacheGet(statsCacheKey(statsBuildArgs({ range: "12d" }))),
        null,
      );
    } finally {
      plugin.onunload();
    }
  });
});

test("stats warm remount with a clean fresh entry spawns nothing", async () => {
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
      assert.equal(version, 1);
      const second = await plugin.apiStatsFetch({ range: "7d" });
      assert.equal(second.report.metrics[0].id, "v1");
      assert.equal(second.stale, false);
      assert.equal(version, 1);
      assert.equal(plugin.statsFlight, null);
      const peeked = plugin.statsPeek({ range: "7d" });
      assert.notEqual(peeked, null);
      assert.equal(peeked.report.metrics[0].id, "v1");
      assert.equal(peeked.dirty, false);
    } finally {
      plugin.onunload();
    }
  });
});

test("stats change bump makes the next hit spawn exactly once", async () => {
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
      plugin.scheduleStatsRevalidateForFile({});
      const secondPromise = plugin.apiStatsFetch({ range: "7d" });
      const flight = plugin.statsFlight;
      const second = await secondPromise;
      assert.equal(second.report.metrics[0].id, "v1");
      assert.equal(second.stale, true);
      assert.notEqual(flight, null);
      await flight.promise;
      assert.equal(version, 2);
      const third = await plugin.apiStatsFetch({ range: "7d" });
      assert.equal(third.report.metrics[0].id, "v2");
      assert.equal(third.stale, false);
      assert.equal(version, 2);
    } finally {
      plugin.onunload();
    }
  });
});

test("stats change during a flight leaves the stored entry dirty", async () => {
  await withMissingConfig(async () => {
    const plugin = makePlugin();
    try {
      let release = null;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      plugin.statsSpawnFetch = async () => {
        await gate;
        return { ok: true, report: okReport() };
      };
      const pending = plugin.apiStatsFetch({ range: "7d" });
      plugin.scheduleStatsRevalidateForFile({});
      release();
      const result = await pending;
      assert.equal(result.stale, false);
      const peeked = plugin.statsPeek({ range: "7d" });
      assert.notEqual(peeked, null);
      assert.equal(peeked.dirty, true);
      // The next hit therefore revalidates instead of serving the frame.
      const again = await plugin.apiStatsFetch({ range: "7d" });
      assert.equal(again.stale, true);
    } finally {
      plugin.onunload();
    }
  });
});

test("stats entries older than the max clean age read dirty", async () => {
  await withMissingConfig(async () => {
    assert.ok(STATS_MAX_CLEAN_AGE_MS >= 10 * 60 * 1000);
    const plugin = makePlugin();
    try {
      plugin.statsSpawnFetch = async () => ({ ok: true, report: okReport() });
      await plugin.apiStatsFetch({ range: "7d" });
      const key = statsRequestFor({ range: "7d" }).key;
      const entry = plugin.statsCacheGet(key);
      assert.notEqual(entry, null);
      assert.equal(statsCacheEntryIsDirty(entry, Date.now(), plugin.statsChangeGenValue()), false);
      const aged = { ...entry, fetchedAt: entry.fetchedAt - STATS_MAX_CLEAN_AGE_MS - 1000 };
      assert.equal(statsCacheEntryIsDirty(aged, Date.now(), plugin.statsChangeGenValue()), true);
      assert.equal(statsCacheEntryIsDirty(null, Date.now(), 0), true);
    } finally {
      plugin.onunload();
    }
  });
});

test("stats revalidate never skips a miss but skips dirty hits", async () => {
  await withMissingConfig(async () => {
    const plugin = makePlugin();
    try {
      let spawns = 0;
      plugin.statsSpawnFetch = async () => {
        spawns += 1;
        return { ok: true, report: okReport() };
      };
      const miss = await plugin.apiStatsFetch({ range: "7d", revalidate: "never" });
      assert.equal(miss.stale, false);
      assert.equal(spawns, 1);
      plugin.scheduleStatsRevalidateForFile({});
      const skipped = await plugin.apiStatsFetch({ range: "7d", revalidate: "never" });
      assert.equal(skipped.stale, false);
      assert.equal(spawns, 1);
      assert.equal(plugin.statsFlight, null);
    } finally {
      plugin.onunload();
    }
  });
});

test("stats peek reads synchronously and listeners fire per store", async () => {
  await withMissingConfig(async () => {
    const plugin = makePlugin();
    try {
      assert.equal(plugin.statsPeek({ range: "7d" }), null);
      const seen = [];
      const unsubscribe = plugin.statsOnCacheUpdate((key) => seen.push(key));
      plugin.statsSpawnFetch = async () => ({ ok: true, report: okReport() });
      await plugin.apiStatsFetch({ range: "7d" });
      const wanted = statsRequestFor({ range: "7d" }).key;
      assert.deepEqual(seen, [wanted]);
      const peeked = plugin.statsPeek({ range: "7d" });
      assert.notEqual(peeked, null);
      assert.equal(typeof peeked.fetchedAt, "number");
      assert.equal(peeked.dirty, false);
      unsubscribe();
      plugin.scheduleStatsRevalidateForFile({});
      const refreshPromise = plugin.apiStatsFetch({ range: "7d" });
      const refreshFlight = plugin.statsFlight;
      await refreshPromise;
      assert.notEqual(refreshFlight, null);
      await refreshFlight.promise;
      assert.deepEqual(seen, [wanted]);
    } finally {
      plugin.onunload();
    }
  });
});

test("stats unload settles every waiter with cancellation", async () => {
  await withMissingConfig(async () => {
    const plugin = makePlugin();
    try {
      let release = null;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      plugin.statsSpawnFetch = async () => {
        await gate;
        return { ok: true, report: okReport() };
      };
      const running = plugin.apiStatsFetch({ range: "7d" });
      const queued = plugin.apiStatsFetch({ range: "4w" });
      plugin.onunload();
      const [runningResult, queuedResult] = await Promise.all([running, queued]);
      assert.equal(runningResult.report, null);
      assert.equal(runningResult.error.code, "cancelled");
      assert.equal(queuedResult.report, null);
      assert.equal(queuedResult.error.code, "cancelled");
      release();
    } finally {
      try {
        plugin.onunload();
      } catch (error) {
        // Already unloaded.
      }
    }
  });
});

test("stats spawn counters record each spawn", async () => {
  await withMissingConfig(async () => {
    const plugin = makePlugin();
    try {
      assert.equal(plugin.statsSpawnCount, 0);
      assert.equal(plugin.statsLastSpawnAt, null);
      plugin.statsSpawnFetch = async () => ({ ok: true, report: okReport() });
      await plugin.apiStatsFetch({ range: "7d" });
      assert.equal(plugin.statsSpawnCount, 1);
      assert.equal(typeof plugin.statsLastSpawnAt, "number");
      await plugin.apiStatsFetch({ range: "7d" });
      assert.equal(plugin.statsSpawnCount, 1);
      plugin.scheduleStatsRevalidateForFile({});
      const dirtyPromise = plugin.apiStatsFetch({ range: "7d" });
      const dirtyFlight = plugin.statsFlight;
      await dirtyPromise;
      assert.notEqual(dirtyFlight, null);
      await dirtyFlight.promise;
      assert.equal(plugin.statsSpawnCount, 2);
    } finally {
      plugin.onunload();
    }
  });
});

test("stats block views count as shown without a visibility host", () => {
  assert.equal(statsBlockViewIsShown({ el: {} }), true);
  assert.equal(statsBlockViewIsShown({}), false);
  assert.equal(statsBlockViewIsShown(null), false);
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

test("stats unload clears views, timers, cache, flights, and queues", async () => {
  await withMissingConfig(async () => {
    const plugin = makePlugin();
    plugin.statsBlockViews = new Set([{ el: {} }]);
    plugin.statsCacheSet("key", okReport());
    plugin.statsFlight = { key: "key", promise: Promise.resolve(), waiters: [] };
    plugin.statsPendingQueueStore().push({
      key: "other",
      args: [],
      opts: {},
      waiters: [],
      hadCached: false,
    });
    plugin.statsPendingByKeyStore().set("other", plugin.statsPendingQueue[0]);
    plugin.statsOnCacheUpdate(() => {});
    plugin.onunload();
    assert.equal(plugin.statsBlockViews.size, 0);
    assert.equal(plugin.statsCache.size, 0);
    assert.equal(plugin.statsFlight, null);
    assert.equal(plugin.statsPendingFetch, null);
    assert.equal(plugin.statsPendingQueue.length, 0);
    assert.equal(plugin.statsPendingByKey.size, 0);
    assert.equal(plugin.statsCacheListeners.size, 0);
  });
});

test("stats queue outcomes carry fetchedAt", async () => {
  await withMissingConfig(async () => {
    const plugin = makePlugin();
    try {
      const report = okReport();
      plugin.statsSpawnFetch = async () => ({ ok: true, report });
      const success = await plugin.apiStatsFetch({ range: "7d" });
      assert.ok(success.report, "success carries a report");
      assert.equal(typeof success.fetchedAt, "number", "success carries fetchedAt");
      const { key } = statsRequestFor({ range: "7d" });
      const stored = plugin.statsCacheGet(key);
      assert.ok(stored, "success stored the cache entry");
      assert.equal(success.fetchedAt, stored.fetchedAt, "success stamp equals the stored entry");
      // Failure with a cached report carries the stale entry's stamp.
      const staleStamp = stored.fetchedAt;
      plugin.statsSpawnFetch = async () => ({ ok: false, code: "timeout", message: "boom", detail: "" });
      const staleOutcome = await new Promise((resolve) => {
        plugin.statsEnqueueFetch({
          key,
          args: statsRequestFor({ range: "7d" }).args,
          opts: { range: "7d" },
          waiters: [resolve],
          hadCached: true,
        });
      });
      assert.equal(staleOutcome.report, stored.report, "stale failure keeps the cached report");
      assert.equal(staleOutcome.stale, true, "stale failure is marked stale");
      assert.equal(staleOutcome.fetchedAt, staleStamp, "stale failure carries the stale stamp");
      // Failure with nothing cached carries a null stamp.
      plugin.statsCacheStore().clear();
      const missOutcome = await new Promise((resolve) => {
        plugin.statsEnqueueFetch({
          key: "missing-key",
          args: [],
          opts: {},
          waiters: [resolve],
          hadCached: false,
        });
      });
      assert.equal(missOutcome.report, null, "miss carries no report");
      assert.equal(missOutcome.fetchedAt, null, "miss carries a null stamp");
    } finally {
      plugin.onunload();
    }
  });
});
