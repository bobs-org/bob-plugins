const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin {
  constructor(app) { this.app = app; }
}

const originalLoad = Module._load;
Module._load = function loadObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownRenderChild: class {},
      Notice: class {},
      Platform: { isDesktopApp: false },
      Plugin: TestPlugin,
      normalizePath: (value) => value,
      parseYaml: () => ({}),
    };
  }
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value } };
  if (request === "@codemirror/view") return {};
  return originalLoad.call(this, request, parent, isMain);
};

let LedgerToolsPlugin;
try {
  LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
} finally {
  Module._load = originalLoad;
}

const {
  gcalEventsFindSection,
  gcalEventsHasPomodorosSection,
  gcalEventsScanMarkdown,
  gcalEventsShouldSyncCreatedFile,
  gcalEventsStampState,
  gcalEventsTimeState,
  gcalEventsWaitForPomodoros,
  GCAL_EVENTS_STAMP_STALE_AFTER_MINUTES,
  todayDailyPath,
} = LedgerToolsPlugin.helpers;

test("calendar scan stays within an unfenced Events section", () => {
  const lines = [
    "## Notes",
    "```md",
    "## Events",
    "- [ ] #task **0900-0930** fake ^fake",
    "```",
    "## Events",
    "- [*] #task **0830-0900** Interview [📅](https://calendar.test/e) ^interview",
    "- **all day** School holiday [📅](https://calendar.test/a)",
    "- **0915-1000** Class · *maybe*",
    "## Pomodoros",
    "- [ ] () — PLAN",
  ];
  const found = gcalEventsFindSection(lines, "Events");
  assert.deepEqual(found, { headingLine: 5, start: 6, end: 9 });
  const scan = gcalEventsScanMarkdown(lines, { isToday: true, nowMinutes: 8 * 60 + 45 });
  assert.deepEqual(scan.rows.map((row) => [row.kind, row.time, row.state]), [
    ["task", "0830-0900", "running"],
    ["context", "all day", null],
    ["context", "0915-1000", null],
  ]);
  assert.deepEqual(scan.rows[2].tags.map((tag) => tag.name), ["maybe"]);
  assert.deepEqual(scan.rows[0].badges.map((badge) => badge.badge), ["📅"]);
  assert.equal(scan.stamp, null);
});

test("calendar scan finds same-day and dated Events stamps and ignores lookalikes", () => {
  const sameDay = "*↻ synced 14:05 · [you@example.com](https://calendar.google.com/calendar/r/day/2026/10/30?authuser=you%40example.com)*";
  const dated = "*↻ synced Thu 2026-10-29 21:40 · [you@example.com](https://calendar.google.com/calendar/r/day/2026/10/31?authuser=you%40example.com)*";
  const withRows = [
    "↻ outside",
    "## Events",
    "",
    sameDay,
    "- [*] #task **0830-0900** Interview [📅](https://calendar.test/e) ^interview",
    "- ↻ list row",
    "```",
    "↻ fenced",
    "```",
    "## Pomodoros",
    dated,
  ];
  const scan = gcalEventsScanMarkdown(withRows, { isToday: true, nowMinutes: 8 * 60 + 45 });
  assert.equal(scan.stamp.line, 3);
  assert.equal(scan.stamp.glyphStart, sameDay.indexOf("↻"));
  assert.deepEqual(scan.stamp.synced, { date: null, minutes: 14 * 60 + 5 });
  assert.deepEqual(scan.rows.map((row) => [row.kind, row.time, row.state]), [
    ["task", "0830-0900", "running"],
  ]);

  const datedOnly = [
    "## Events",
    "",
    dated,
    "## Pomodoros",
  ];
  const datedScan = gcalEventsScanMarkdown(datedOnly);
  assert.equal(datedScan.rows.length, 0);
  assert.equal(datedScan.stamp.line, 2);
  assert.deepEqual(datedScan.stamp.synced, { date: "2026-10-29", minutes: 21 * 60 + 40 });

  const emptySection = gcalEventsScanMarkdown(["## Events", "", sameDay, "## Pomodoros"]);
  assert.equal(emptySection.rows.length, 0);
  assert.equal(emptySection.stamp.synced.minutes, 14 * 60 + 5);

  const underscore = gcalEventsScanMarkdown([
    "## Events",
    "",
    "_↻ synced 12:00 · [you@example.com](https://example.com)_",
    "## Pomodoros",
  ]);
  assert.deepEqual(underscore.stamp.synced, { date: null, minutes: 12 * 60 });
});

test("stamp state stays fresh on change, including old, future, and dated stamps", () => {
  assert.equal(GCAL_EVENTS_STAMP_STALE_AFTER_MINUTES, null);
  const now = new Date(2026, 9, 30, 14, 50, 0);
  const fresh = { synced: { date: null, minutes: 14 * 60 + 5 } };
  const old = { synced: { date: null, minutes: 8 * 60 } };
  const future = { synced: { date: null, minutes: 18 * 60 } };
  const dated = { synced: { date: "2026-10-29", minutes: 21 * 60 + 40 } };
  assert.equal(gcalEventsStampState(fresh, { isToday: true, now }), "fresh");
  assert.equal(gcalEventsStampState(old, { isToday: true, now }), "fresh");
  assert.equal(gcalEventsStampState(future, { isToday: true, now }), "fresh");
  assert.equal(gcalEventsStampState(dated, { isToday: true, now }), "fresh");
  assert.equal(gcalEventsStampState(old, { isToday: false, now }), "fresh");
});

test("event clock state distinguishes future, running, and past", () => {
  assert.equal(gcalEventsTimeState("1000-1030", 9 * 60, true, true), "future");
  assert.equal(gcalEventsTimeState("0830-0900", 8 * 60 + 45, true, true), "running");
  assert.equal(gcalEventsTimeState("0830-0900", 10 * 60, true, true), "past");
  assert.equal(gcalEventsTimeState("2300-0030", 23 * 60 + 45, true, true), "running");
  assert.equal(gcalEventsTimeState("0830-0900", 10 * 60, false, true), null);
  assert.equal(gcalEventsTimeState("0830-0900", 10 * 60, true, false), null);
});

test("sync-on-create gate only accepts today's canonical daily note", () => {
  const now = new Date(2026, 9, 30, 9, 0, 0);
  const app = { internalPlugins: { plugins: {} } };
  assert.equal(gcalEventsShouldSyncCreatedFile(true, { path: todayDailyPath(now) }, app, now), true);
  assert.equal(gcalEventsShouldSyncCreatedFile(false, { path: todayDailyPath(now) }, app, now), false);
  assert.equal(gcalEventsShouldSyncCreatedFile(true, { path: "2026/20261029.md" }, app, now), false);
  assert.equal(gcalEventsShouldSyncCreatedFile(true, { path: "Notes/today.md" }, app, now), false);
});

test("create listener runs once for today's note after layout readiness", () => {
  const now = new Date(2026, 9, 30, 9, 0, 0);
  const callbacks = {};
  let layoutReady;
  const app = {
    internalPlugins: { plugins: {} },
    workspace: { onLayoutReady(callback) { layoutReady = callback; } },
    vault: {
      on(event, callback) { callbacks[event] = callback; return { event, callback }; },
    },
  };
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.app = app;
  plugin.addCommand = () => {};
  plugin.registerEvent = () => {};
  let syncs = 0;
  plugin.gcalSyncCreatedDailyNote = () => { syncs += 1; };
  plugin.setupGcalSyncOnCreate();
  assert.equal(plugin.gcalSyncOnCreateEnabled, true);
  layoutReady();
  const today = { path: todayDailyPath(now) };
  callbacks.create(today);
  callbacks.create(today);
  callbacks.create({ path: "2026/20261029.md" });
  assert.equal(syncs, 1);
  assert.equal(plugin.toggleGcalSyncOnCreate(), false);
  assert.equal(plugin.toggleGcalSyncOnCreate(), true);
});

test("sync-on-create waits for Templater's Pomodoros section, then stops at its deadline", async () => {
  let now = 0;
  let reads = 0;
  const becameReady = await gcalEventsWaitForPomodoros(
    async () => (++reads >= 3 ? "# Friday\n\n## Pomodoros\n" : "# Friday\n"),
    { timeoutMs: 1000, pollMs: 100, now: () => now, delay: async (ms) => { now += ms; } },
  );
  assert.equal(becameReady, true);
  assert.equal(reads, 3);
  assert.equal(gcalEventsHasPomodorosSection("# Friday\n```md\n## Pomodoros\n```"), false);

  now = 0;
  const timedOut = await gcalEventsWaitForPomodoros(
    async () => "# Friday\n",
    { timeoutMs: 500, pollMs: 200, now: () => now, delay: async (ms) => { now += ms; } },
  );
  assert.equal(timedOut, false);
  assert.equal(now, 500);
});

test("calendar paint teardown clears the clock refresh interval", () => {
  const originalWindow = global.window;
  let nextHandle = 1;
  const cleared = [];
  global.window = {
    setInterval() { return nextHandle++; },
    clearInterval(handle) { cleared.push(handle); },
  };
  try {
    const plugin = Object.create(LedgerToolsPlugin.prototype);
    plugin.calendarEventsPaintEnabled = true;
    plugin.calendarEventRefreshTimer = null;
    plugin.calendarEventTodayIsVisible = () => true;
    plugin.refreshCalendarEventPaint = () => {};
    plugin.calendarEventUpdateClockTimer();
    assert.equal(plugin.calendarEventRefreshTimer, 1);
    plugin.teardownCalendarEventPainting();
    assert.deepEqual(cleared, [1]);
    assert.equal(plugin.calendarEventRefreshTimer, null);
  } finally {
    if (originalWindow === undefined) delete global.window;
    else global.window = originalWindow;
  }
});
