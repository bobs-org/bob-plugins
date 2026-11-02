const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { LedgerToolsPlugin, makeFreshnessApp, withMissingConfig } = require("./ledger-tools-harness.cjs");
const {
  CLOCKS,
  clockFixtureReport,
  clockEmptyOffClockReport,
  clockAdoptionGapReport,
  clockCountTotalReport,
  clockPinnedOffClockReport,
} = require("./stats-clock-fixtures.cjs");

const {
  STATS_CLOCK_VALUES,
  STATS_CLOCK_STORAGE_KEY,
  statsBuildArgs,
  statsCacheKey,
  statsClockBreakdown,
  statsClockCapability,
  statsMetricEffectiveClock,
  statsNormalizeClock,
  statsPartsClockBreakdown,
  statsRequestFor,
} = LedgerToolsPlugin.helpers;

const CLOCK_OPTIONS = [
  { value: "worked", label: "Worked", description: "Work clock", minutes: 60, display: "1h 00m" },
  { value: "off-clock", label: "Off-clock", description: "Off the clock", minutes: 30, display: "30m" },
  { value: "total", label: "Total", description: "Both clocks", minutes: 90, display: "1h 30m" },
];

function clockReport(clock = "worked", since = "2026-10-09") {
  return {
    ok: true,
    schema_version: 1,
    today: "2026-10-11",
    range: { preset: "4w", offset: 0, label: "Sep 13 – Oct 10", includes_today: true },
    clock: { value: clock, since, options: CLOCK_OPTIONS },
    metrics: [{
      id: "worked",
      label: clock === "worked" ? "Worked" : clock === "off-clock" ? "Off-clock" : "Total",
      kind: "pomodoro",
      unit: "minutes",
      parameters: { clock: { value: clock } },
      summary: { total: { value: clock === "total" ? 90 : clock === "off-clock" ? 30 : 60, display: "1h 30m" } },
      points: [],
    }],
  };
}

function makeApp(stored = null) {
  const app = makeFreshnessApp({ tasks: [] });
  const values = new Map();
  if (stored !== null) values.set(STATS_CLOCK_STORAGE_KEY, stored);
  app.__storage = values;
  app.__loads = 0;
  app.__saves = [];
  app.loadLocalStorage = (key) => {
    if (key === STATS_CLOCK_STORAGE_KEY) app.__loads += 1;
    return values.has(key) ? values.get(key) : null;
  };
  app.saveLocalStorage = (key, value) => {
    app.__saves.push([key, value]);
    values.set(key, value);
  };
  return app;
}

function makePlugin(app = makeApp()) {
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.onload();
  return plugin;
}

class FakeElement {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = doc;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.checked = false;
    this.textContent = "";
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  appendChild(node) { this.children.push(node); return node; }
  addEventListener(name, listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(listener);
  }
  fire(name, detail = {}) {
    for (const listener of this.listeners.get(name) || []) {
      listener({
        ...detail,
        preventDefault() { detail.prevented = true; },
        stopPropagation() { detail.stopped = true; },
      });
    }
  }
  focus() { this.ownerDocument.activeElement = this; }
}

function fakeDocument() {
  const doc = { activeElement: null };
  doc.createElement = (tag) => new FakeElement(tag, doc);
  return doc;
}

function fakeView(sourcePath = "dash_stats.md") {
  return {
    sourcePath,
    el: { isShown: () => true },
    statsClockSupported: false,
    statsClockPreferenceApplied: false,
  };
}

test("clock helpers preserve only canonical values and supplied display detail", () => {
  assert.deepEqual(STATS_CLOCK_VALUES, ["worked", "off-clock", "total"]);
  assert.equal(statsNormalizeClock("off-clock"), "off-clock");
  assert.equal(statsNormalizeClock("future"), "worked");
  assert.equal(statsClockCapability(clockReport()).since, "2026-10-09");
  assert.equal(statsClockCapability({ ...clockReport(), clock: { ...clockReport().clock, since: null } }), null);
  assert.equal(statsClockCapability({ schema_version: 1 }), null);
  assert.deepEqual(statsClockBreakdown({
    worked: { value: 60, display: "1h 00m" },
    off_clock: { value: 30, display: "30m" },
  }), {
    worked: { value: 60, display: "1h 00m" },
    off_clock: { value: 30, display: "30m" },
  });
  assert.equal(statsClockBreakdown({ worked: { value: 60, display: "1h" } }), null);
  assert.deepEqual(statsPartsClockBreakdown({ theme: { GTD: {
    worked: { value: 15, display: "15m" }, off_clock: { value: 5, display: "5m" },
  } }, unused: { item: { worked: { value: 1, display: "1" }, off_clock: { value: 1, display: "1" } } } }), {
    theme: { GTD: { worked: { value: 15, display: "15m" }, off_clock: { value: 5, display: "5m" } } },
  });
});

test("effective clock honors a pinned Pomodoro and leaves other metric families alone", () => {
  assert.equal(statsMetricEffectiveClock({ kind: "pomodoro", parameters: { clock: { value: "off-clock" } } }, clockReport()), "off-clock");
  assert.equal(statsMetricEffectiveClock({ kind: "pomodoro", parameters: {} }, clockReport("total")), "total");
  assert.equal(statsMetricEffectiveClock({ kind: "pomodoro", parameters: {} }, {}), "worked");
  assert.equal(statsMetricEffectiveClock({ kind: "task", parameters: { clock: "total" } }, clockReport()), null);
});

test("shared synthetic clock reports keep scalar, part, and summary splits consistent", () => {
  const fixtureFile = path.join(__dirname, "../plugins/bob-ledger-tools/scripts/fixtures/stats/synthetic-clocks.json");
  const checkedIn = JSON.parse(fs.readFileSync(fixtureFile, "utf8"));
  for (const clock of CLOCKS) {
    const report = clockFixtureReport(clock);
    assert.deepEqual(checkedIn[clock], report);
    const metric = report.metrics[0];
    assert.equal(report.clock.value, clock);
    assert.equal(metric.parameters.clock, clock);
    const complete = metric.points.filter((point) => point.provisional !== true);
    const summary = metric.summary.total;
    const expectedTotal = complete.reduce((sum, point) => sum + point.value, 0);
    assert.equal(summary.value, expectedTotal);
    for (const point of complete) {
      if (clock === "total") {
        assert.equal(point.clock_breakdown.worked.value + point.clock_breakdown.off_clock.value, point.value);
        for (const dimension of ["theme", "area", "root_parent", "project"]) {
          for (const [key, part] of Object.entries(point.parts[dimension])) {
            const split = point.parts_clock_breakdown[dimension][key];
            assert.equal(split.worked.value + split.off_clock.value, part);
          }
        }
      }
    }
    if (clock === "total") {
      assert.equal(metric.summary.total_clock_breakdown.worked.value + metric.summary.total_clock_breakdown.off_clock.value, summary.value);
    }
  }
  assert.deepEqual(checkedIn.emptyOffClock, clockEmptyOffClockReport());
  assert.deepEqual(checkedIn.adoptionGap, clockAdoptionGapReport());
  assert.deepEqual(checkedIn.countTotal, clockCountTotalReport());
  assert.deepEqual(checkedIn.pinnedOffClock, clockPinnedOffClockReport());
});

test("clock flags add only nondefault lenses and leave the Day strip key unchanged", async () => {
  await withMissingConfig(async () => {
    assert.deepEqual(statsBuildArgs({}), ["stats", "show", "-a", "-f", "json", "-r", "4w"]);
    assert.deepEqual(statsBuildArgs({ clock: "worked" }), statsBuildArgs({}));
    assert.deepEqual(statsBuildArgs({ range: "7d", offset: 2, compare: true, clock: "off-clock" }), [
      "stats", "show", "-a", "-f", "json", "-r", "7d", "-o", "2", "-c", "-k", "off-clock",
    ]);
    assert.ok(statsBuildArgs({ clock: "total", metrics: ["worked"] }).includes("total"));
    const dash = statsRequestFor({ range: undefined, offset: 0, clock: "worked" });
    const strip = statsRequestFor({});
    assert.equal(dash.key, strip.key);
    assert.notEqual(statsCacheKey(statsBuildArgs({})), statsCacheKey(statsBuildArgs({ clock: "off-clock" })));
    assert.notEqual(statsCacheKey(statsBuildArgs({ clock: "off-clock" })), statsCacheKey(statsBuildArgs({ clock: "total" })));
  });
});

test("stored clock loads once, waits for a capable Worked bootstrap, then applies", async () => {
  await withMissingConfig(async () => {
    const app = makeApp("total");
    const plugin = makePlugin(app);
    try {
      assert.equal(app.__loads, 1);
      plugin.statsLoadClockPreference();
      assert.equal(app.__loads, 1);
      const state = plugin.statsViewStateFor("dash_stats.md");
      const view = fakeView();
      assert.equal(state.clock, "worked");
      assert.equal(plugin.statsFetchArgsFor(view).clock, "worked");
      assert.equal(plugin.statsClockObserveReport(view, clockReport("worked"), "worked"), "retry");
      assert.equal(state.clock, "total");
      assert.equal(plugin.statsFetchArgsFor(view).clock, "total");
      assert.deepEqual(statsBuildArgs(plugin.statsFetchArgsFor(view)).slice(-2), ["-k", "total"]);
    } finally {
      plugin.onunload();
    }
  });
});

test("clockless and no-adoption reports fall back to Worked without erasing preference", async () => {
  await withMissingConfig(async () => {
    const app = makeApp("off-clock");
    const plugin = makePlugin(app);
    try {
      const state = plugin.statsViewStateFor("dash_stats.md");
      const view = fakeView();
      state.clock = "off-clock";
      assert.equal(plugin.statsClockObserveReport(view, { schema_version: 1, metrics: [] }, "off-clock"), "retry");
      assert.equal(view.statsClockSupported, false);
      assert.equal(plugin.statsFetchArgsFor(view).clock, "worked");
      assert.equal(plugin.statsClockPreference, "off-clock");
      assert.equal(plugin.statsClockObserveReport(view, clockReport("worked", null), "worked"), "ready");
      assert.equal(plugin.statsClockPreference, "off-clock");
      assert.equal(plugin.statsClockControl(fakeDocument(), view, clockReport("worked", null)), null);
    } finally {
      plugin.onunload();
    }
  });
});

test("clock radio group is report-driven, native, labeled, and persists selection", async () => {
  await withMissingConfig(async () => {
    const app = makeApp();
    const plugin = makePlugin(app);
    try {
      const view = fakeView();
      view.statsClockSupported = true;
      view.report = clockReport();
      view.chartId = "clock-test";
      const state = plugin.statsViewStateFor(view.sourcePath);
      Object.assign(state, {
        range: "7d",
        offset: 2,
        compare: true,
        focus: "family_time",
        pinnedDay: "2026-10-09",
        pinnedBucket: { start: "2026-10-06", end: "2026-10-12" },
      });
      plugin.paintStatsBlock = () => {};
      const group = plugin.statsClockControl(fakeDocument(), view, view.report);
      const radios = group.children.slice(1).map((row) => row.children[0]);
      assert.equal(group.getAttribute("aria-label"), "Stats clock");
      assert.deepEqual(radios.map((radio) => radio.getAttribute("value")), STATS_CLOCK_VALUES);
      assert.ok(radios.every((radio) => radio.getAttribute("type") === "radio"));
      assert.equal(new Set(radios.map((radio) => radio.getAttribute("name"))).size, 1);
      assert.equal(radios.filter((radio) => radio.checked).length, 1);
      assert.match(radios[1].getAttribute("aria-label"), /Off the clock.*30m/);
      radios[1].checked = true;
      radios[1].fire("change");
      assert.equal(state.clock, "off-clock");
      assert.deepEqual({ range: state.range, offset: state.offset, compare: state.compare, focus: state.focus, pinnedDay: state.pinnedDay, pinnedBucket: state.pinnedBucket }, {
        range: "7d", offset: 2, compare: true, focus: "family_time", pinnedDay: "2026-10-09", pinnedBucket: { start: "2026-10-06", end: "2026-10-12" },
      });
      assert.deepEqual(app.__saves.at(-1), [STATS_CLOCK_STORAGE_KEY, "off-clock"]);
    } finally {
      plugin.onunload();
    }
  });
});

test("storage failures keep an in-memory clock choice operational", async () => {
  await withMissingConfig(async () => {
    const app = makeFreshnessApp({ tasks: [] });
    app.loadLocalStorage = () => { throw new Error("denied"); };
    app.saveLocalStorage = () => { throw new Error("denied"); };
    const plugin = makePlugin(app);
    try {
      assert.equal(plugin.statsClockPreference, "worked");
      const view = fakeView();
      view.statsClockSupported = true;
      view.report = clockReport();
      assert.equal(plugin.statsSetClockForView(view, "total"), true);
      assert.equal(plugin.statsViewStateFor(view.sourcePath).clock, "total");
      assert.equal(plugin.statsClockPreference, "total");
    } finally {
      plugin.onunload();
    }
  });
});

test("c cycles clocks only from the free dash surface and preserves native guards", async () => {
  await withMissingConfig(async () => {
    const plugin = makePlugin();
    try {
      const view = fakeView();
      view.statsClockSupported = true;
      view.report = clockReport();
      const doc = fakeDocument();
      const root = new FakeElement("div", doc);
      plugin.paintStatsBlock = () => { plugin.__painted = (plugin.__painted || 0) + 1; };
      plugin.statsInstallClockShortcut(root, view, view.report);
      const event = { key: "c", target: root, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
      root.fire("keydown", event);
      assert.equal(plugin.statsViewStateFor(view.sourcePath).clock, "off-clock");
      assert.equal(event.prevented, true);
      assert.equal(event.stopped, true);
      const input = new FakeElement("input", doc);
      const guarded = { key: "c", target: input, preventDefault() { this.prevented = true; } };
      root.fire("keydown", guarded);
      assert.equal(guarded.prevented, undefined);
      const modified = { key: "c", target: root, ctrlKey: true, preventDefault() { this.prevented = true; } };
      root.fire("keydown", modified);
      assert.equal(modified.prevented, undefined);
    } finally {
      plugin.onunload();
    }
  });
});

test("clean cached Worked paints synchronously and switching back does not spawn", async () => {
  await withMissingConfig(async () => {
    const plugin = makePlugin();
    try {
      const view = fakeView();
      view.statsClockSupported = true;
      view.statsClockPreferenceApplied = true;
      const state = plugin.statsViewStateFor(view.sourcePath);
      state.clock = "worked";
      const options = plugin.statsFetchArgsFor(view);
      const key = statsRequestFor(options).key;
      const report = clockReport("worked");
      plugin.statsCacheSet(key, report, 0);
      plugin.statsPaintGens = new Map();
      plugin.paintStatsSkeleton = () => {};
      let painted = null;
      plugin.renderStatsResult = (target, result) => { painted = result.report; };
      plugin.statsScheduleClockPrefetch = () => {};
      plugin.apiStatsFetch = () => { throw new Error("clean cache should not spawn"); };
      plugin.paintStatsBlock(view);
      assert.equal(painted, report);
    } finally {
      plugin.onunload();
    }
  });
});

test("cache notifications do not interrupt a foreground paint or recursively prefetch", async () => {
  await withMissingConfig(async () => {
    const plugin = makePlugin();
    try {
      const view = fakeView();
      plugin.statsBlockViews = new Set([view]);
      const key = statsRequestFor(plugin.statsFetchArgsFor(view)).key;
      view.statsForegroundKey = key;
      const paints = [];
      plugin.paintStatsBlock = (target, options) => paints.push(options);
      plugin.statsRepaintBlocksForKey(key);
      assert.equal(paints.length, 0, "the waiting foreground fetch owns this frame");
      view.statsForegroundKey = null;
      plugin.statsRepaintBlocksForKey(key);
      assert.equal(paints.length, 1);
      assert.equal(paints[0].prefetchClock, false, "cache updates never initiate prefetch");
    } finally {
      plugin.onunload();
    }
  });
});

test("idle lens prefetch deduplicates, skips fresh keys, and cancels on unload", async () => {
  await withMissingConfig(async () => {
    const previousWindow = global.window;
    const callbacks = [];
    const cancelled = [];
    global.window = {
      requestIdleCallback(callback) { callbacks.push(callback); return callbacks.length - 1; },
      cancelIdleCallback(id) { cancelled.push(id); },
    };
    const plugin = makePlugin();
    try {
      const view = fakeView();
      view.statsClockSupported = true;
      view.statsClockPreferenceApplied = true;
      const state = plugin.statsViewStateFor(view.sourcePath);
      state.clock = "worked";
      plugin.statsBlockViews = new Set([view]);
      plugin.statsPeek = () => null;
      const calls = [];
      plugin.apiStatsFetch = (options) => { calls.push(options); return Promise.resolve({ report: null }); };
      const report = clockReport("worked");
      view.report = report;
      const request = statsRequestFor(plugin.statsFetchArgsFor(view));
      plugin.statsScheduleClockPrefetch(view, report, request);
      plugin.statsScheduleClockPrefetch(view, report, request);
      assert.equal(callbacks.length, 2);
      for (const callback of callbacks) callback();
      assert.deepEqual(calls.map((options) => options.clock).sort(), ["off-clock", "total"]);
      assert.ok(calls.every((options) => options.prefetch === true));

      plugin.statsPeek = (options) => options.clock === "off-clock" ? { dirty: false } : null;
      plugin.statsScheduleClockPrefetch(view, report, request);
      assert.equal(callbacks.length, 3, "only the uncached Total lens schedules");
      plugin.statsCancelClockPrefetch();
      assert.deepEqual(cancelled, [2]);
      assert.equal(plugin.statsClockIdleTasks.size, 0);
    } finally {
      plugin.onunload();
      if (previousWindow === undefined) delete global.window;
      else global.window = previousWindow;
    }
  });
});

test("foreground queue entries outrank and promote queued idle prefetches", async () => {
  await withMissingConfig(async () => {
    const plugin = makePlugin();
    try {
      plugin.statsFlight = { key: "in-flight", waiters: [] };
      const entry = (key, prefetch) => ({ key, args: [], opts: {}, waiters: [], prefetch });
      plugin.statsEnqueueFetch(entry("idle", true));
      plugin.statsEnqueueFetch(entry("user", false));
      assert.deepEqual(plugin.statsPendingQueue.map((item) => item.key), ["user", "idle"]);
      plugin.statsEnqueueFetch(entry("same", true));
      plugin.statsEnqueueFetch(entry("same", false));
      assert.deepEqual(plugin.statsPendingQueue.map((item) => item.key), ["user", "same", "idle"]);
      assert.equal(plugin.statsPendingByKey.get("same").prefetch, false);
    } finally {
      plugin.onunload();
    }
  });
});
