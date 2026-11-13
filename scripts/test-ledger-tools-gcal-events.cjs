const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin {
  constructor(app) { this.app = app; }
}

const editorInfoField = { _gcalField: "info" };
const editorLivePreviewField = { _gcalField: "live" };

class StubWidgetType {}

class StubRangeSetBuilder {
  constructor() {
    this.adds = [];
  }

  add(from, to, value) {
    this.adds.push({ from, to, value });
  }

  finish() {
    return { _decorations: true, adds: this.adds.slice() };
  }
}

const StubDecoration = {
  none: { _decorationNone: true },
  mark: (spec) => ({ _decorationMark: true, ...spec }),
  replace: (spec) => ({ _decorationReplace: true, ...spec }),
  line: (spec) => ({ _decorationLine: true, ...spec }),
  widget: (spec) => ({ _decorationWidget: true, ...spec }),
};

const StubStateEffect = {
  define() {
    const type = {};
    type.of = (value) => {
      const effect = { value, _effectType: type };
      effect.is = (other) => other === type;
      return effect;
    };
    return type;
  },
};

const StubViewPlugin = {
  fromClass(cls, options) {
    return { _viewPlugin: true, cls, options };
  },
};

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
      editorInfoField,
      editorLivePreviewField,
    };
  }
  if (request === "@codemirror/state") {
    return {
      Prec: { highest: (value) => value },
      StateEffect: StubStateEffect,
      RangeSetBuilder: StubRangeSetBuilder,
    };
  }
  if (request === "@codemirror/view") {
    return {
      EditorView: class {},
      keymap: { of: (value) => value },
      ViewPlugin: StubViewPlugin,
      Decoration: StubDecoration,
      WidgetType: StubWidgetType,
    };
  }
  if (request === "@codemirror/language") {
    return { syntaxTree: () => ({ resolveInner: () => null }) };
  }
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
  gcalEventsBufferPhase,
  gcalEventsTimeAttributes,
  gcalEventsWingModel,
  buildCalendarEventBufferWing,
  calendarEventPaintBufferWings,
  buildCalendarEventOffClockChip,
  CalendarEventOffClockChipWidget,
  GCAL_EVENTS_OFF_CLOCK_TITLE,
  GCAL_EVENTS_ON_CLOCK_TITLE,
  gcalEventsClockTooltip,
  gcalEventsFromNoteTitle,
  gcalEventsEnrichScannedClocks,
  gcalEventsPaintClockMarks,
  gcalEventsDecodeSync,
  gcalEventsDecodeDeprecations,
  gcalEventsDeprecationNoticeText,
  gcalEventsShowDeprecationNotice,
  gcalEventsFindPendingTag,
  gcalEventsNoteReady,
  gcalEventsWaitForRenderedNote,
  gcalEventsWaitForPomodoros,
  gcalEventsSyncArgs,
  gcalEventsWaitingNoticeText,
  gcalEventsHeldNoticeText,
  gcalEventsShowWaitingNotice,
  gcalEventsShowHeldNotice,
  GCAL_EVENTS_SETTLE_MS,
  GCAL_EVENTS_STAMP_STALE_AFTER_MINUTES,
  formatLocalDate,
  todayDailyPath,
  gmailEventsShouldSyncCreatedFile,
  gmailEventsDecodeSync,
  gmailEventsSyncArgs,
  gmailEventsFailureKind,
  gmailEventsShowFailureNotice,
  gmailEventsRecentArchiveCount,
  gmailEventsShowRecentArchiveNotice,
  GMAIL_EVENTS_SYNC_TIMEOUT_MS,
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

test("afternoon and evening spans stay future until they start (ES1-ES10)", () => {
  // ES1: the reported bug — 10:00 with an 18:30 meeting painted `past`.
  assert.equal(gcalEventsTimeState("1830-1900", 10 * 60, true, true), "future");
  // ES2: a midday meeting is future in the morning.
  assert.equal(gcalEventsTimeState("1200-1230", 10 * 60, true, true), "future");
  // ES3: a meeting in progress is running.
  assert.equal(gcalEventsTimeState("0945-1015", 10 * 60, true, true), "running");
  // ES4: a finished morning meeting is past.
  assert.equal(gcalEventsTimeState("0815-0830", 10 * 60, true, true), "past");
  // ES5-ES7: a midnight-crossing span shifts an early `now` onto the next day.
  assert.equal(gcalEventsTimeState("2300-0030", 23 * 60 + 45, true, true), "running");
  assert.equal(gcalEventsTimeState("2300-0030", 0 * 60 + 10, true, true), "running");
  assert.equal(gcalEventsTimeState("2300-0030", 22 * 60, true, true), "future");
  // ES8: a buffered evening meeting is future with a lead-in wing at 18:10.
  assert.equal(gcalEventsTimeState("1830-1900", 18 * 60 + 10, true, true, { beforeMin: 30, afterMin: 0 }), "future");
  assert.equal(gcalEventsBufferPhase("1830-1900", 18 * 60 + 10, true, true, { beforeMin: 30, afterMin: 0 }), "lead-in");
  // ES9: a buffered midday span has no state in lead-out, then reads past.
  assert.equal(gcalEventsTimeState("1200-1300", 13 * 60 + 5, true, true, { beforeMin: 30, afterMin: 15 }), null);
  assert.equal(gcalEventsBufferPhase("1200-1300", 13 * 60 + 5, true, true, { beforeMin: 30, afterMin: 15 }), "lead-out");
  assert.equal(gcalEventsTimeState("1200-1300", 13 * 60 + 20, true, true, { beforeMin: 30, afterMin: 15 }), "past");
  // ES10: any span in a note that is not today's has no state.
  assert.equal(gcalEventsTimeState("1830-1900", 10 * 60, false, true), null);
});

test("a buffer delays past fade and lights lead-in / lead-out wings", () => {
  const buffer = { beforeMin: 30, afterMin: 15 };
  assert.equal(gcalEventsTimeState("1200-1300", 11 * 60 + 40, true, true, buffer), "future");
  assert.equal(gcalEventsBufferPhase("1200-1300", 11 * 60 + 40, true, true, buffer), "lead-in");
  assert.equal(gcalEventsTimeState("1200-1300", 12 * 60 + 15, true, true, buffer), "running");
  assert.equal(gcalEventsBufferPhase("1200-1300", 12 * 60 + 15, true, true, buffer), null);
  assert.equal(gcalEventsTimeState("1200-1300", 13 * 60 + 5, true, true, buffer), null);
  assert.equal(gcalEventsBufferPhase("1200-1300", 13 * 60 + 5, true, true, buffer), "lead-out");
  assert.equal(gcalEventsTimeState("1200-1300", 13 * 60 + 20, true, true, buffer), "past");
  assert.equal(gcalEventsBufferPhase("1200-1300", 13 * 60 + 20, true, true, buffer), null);
});

test("calendar scan reads [buffer::] and exposes wing data", () => {
  const scan = gcalEventsScanMarkdown(
    [
      "## Events",
      "- [*] #task **1200-1300** Lunch #offclock [buffer:: -30m +15m] [root:: love] ^lunch",
      "- [*] #task **1400-1430** Standup ^standup",
      "- **1500-1530** Context [buffer:: -15m]",
    ],
    { isToday: true, nowMinutes: 11 * 60 + 40 },
  );
  assert.deepEqual(scan.rows[0].buffer, { beforeMin: 30, afterMin: 15 });
  assert.equal(scan.rows[0].bufferedTimeRange, "1130-1315");
  assert.equal(scan.rows[0].bufferPhase, "lead-in");
  assert.equal(scan.rows[0].state, "future");
  assert.equal(scan.rows[1].buffer, null);
  assert.equal(scan.rows[2].buffer, null);
  const attrs = gcalEventsTimeAttributes(scan.rows[0], "blue");
  assert.equal(attrs["data-buffer-before"], "30");
  assert.equal(attrs["data-buffer-after"], "15");
  assert.equal(attrs["data-buffer-phase"], "lead-in");
  assert.equal(attrs.title, "Holds 11:30–13:15 · 30m before · 15m after");
  const before = gcalEventsWingModel(scan.rows[0], "before", "blue");
  assert.equal(before.label, "30m");
  assert.equal(before.phase, "lead-in");
  assert.equal(before.offClock, true);
  const after = gcalEventsWingModel(scan.rows[0], "after", "blue");
  assert.equal(after.label, "15m");
  assert.equal(after.phase, null);
});

test("Reading view inserts hatched buffer wings beside the time pill", () => {
  const attrs = () => {
    const map = new Map();
    return {
      setAttribute: (name, value) => map.set(name, String(value)),
      getAttribute: (name) => (map.has(name) ? map.get(name) : null),
      removeAttribute: (name) => map.delete(name),
      _map: map,
    };
  };
  const children = [];
  const wrap = {
    classList: { contains: (name) => name === "bob-calendar-event-time-wrap" },
    children,
    querySelectorAll: (sel) => (sel.includes("buffer") ? children.filter((node) => node.className === "bob-calendar-event-buffer") : []),
    insertBefore(node, ref) {
      const at = children.indexOf(ref);
      if (at < 0) children.unshift(node);
      else children.splice(at, 0, node);
      return node;
    },
    appendChild(node) {
      children.push(node);
      return node;
    },
  };
  const timeEl = {
    ...attrs(),
    ownerDocument: {
      createElement: (tag) => {
        const elAttrs = attrs();
        return {
          tag,
          className: "",
          textContent: "",
          ...elAttrs,
        };
      },
    },
    parentNode: wrap,
  };
  wrap.children.push(timeEl);
  const row = { querySelectorAll: () => [] };
  const model = {
    buffer: { beforeMin: 30, afterMin: 15 },
    bufferPhase: "lead-in",
    offClock: true,
    bufferedStartMinutes: 11 * 60 + 30,
    bufferedEndMinutes: 13 * 60 + 15,
    bufferedTimeRange: "1130-1315",
  };
  assert.equal(calendarEventPaintBufferWings(row, timeEl, model, "blue"), true);
  assert.equal(children[0].className, "bob-calendar-event-buffer");
  assert.equal(children[0].textContent, "30m");
  assert.equal(children[0].getAttribute("data-side"), "before");
  assert.equal(children[0].getAttribute("data-buffer-phase"), "lead-in");
  assert.equal(children[0].getAttribute("data-off-clock"), "true");
  assert.equal(children[2].getAttribute("data-side"), "after");
  assert.equal(children[2].textContent, "15m");
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
  const now = new Date();
  const callbacks = {};
  const layoutReadyCallbacks = [];
  const app = {
    internalPlugins: { plugins: {} },
    workspace: { onLayoutReady(callback) { layoutReadyCallbacks.push(callback); } },
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
  for (const callback of layoutReadyCallbacks.splice(0)) callback();
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
    { timeoutMs: 1000, pollMs: 100, settleMs: 0, now: () => now, delay: async (ms) => { now += ms; } },
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

test("pending Templater tags are found everywhere except fenced and inline code", () => {
  assert.deepEqual(
    gcalEventsFindPendingTag("---\ntitle: <% tp.file.title %>\n---\n\n## Pomodoros\n"),
    { line: 2, excerpt: "title: <% tp.file.title %>" },
  );
  assert.equal(gcalEventsFindPendingTag("# Friday\n\n## Pomodoros\n"), null);
  assert.equal(gcalEventsFindPendingTag("# <%* Friday %>\n\n## Pomodoros\n").line, 1);
  assert.equal(gcalEventsFindPendingTag("<%- partial %>\n\n## Pomodoros\n").line, 1);
  assert.equal(
    gcalEventsFindPendingTag("# Friday\n\n```md\n<% not a tag %>\n```\n\n## Pomodoros\n"),
    null,
  );
  assert.equal(
    gcalEventsFindPendingTag("# Friday\n\n~~~md\n<% nope %>\n~~~\n\n## Pomodoros\n"),
    null,
  );
  assert.equal(
    gcalEventsFindPendingTag("# Friday\n\n`<% tp %>` docs\n\n## Pomodoros\n"),
    null,
  );
  const found = gcalEventsFindPendingTag(`<% ${"x".repeat(100)} %>\n\n## Pomodoros\n`);
  assert.equal(found.line, 1);
  assert.ok(found.excerpt.length <= 60);
});

test("a raw template is not ready; a rendered note is", () => {
  assert.equal(gcalEventsNoteReady("# Friday\n<% tp.file.title %>\n\n## Pomodoros\n"), false);
  assert.equal(gcalEventsNoteReady("# Friday\n"), false);
  assert.equal(gcalEventsNoteReady("# Friday\n\n## Pomodoros\n"), true);
  assert.equal(gcalEventsNoteReady("# Friday\n\n```\n<% x %>\n```\n\n## Pomodoros\n"), true);
  assert.equal(gcalEventsNoteReady(null), false);
});

test("the waiter settles on two identical ready reads", async () => {
  const ready = "# Friday\n\n## Pomodoros\n";
  let now = 0;
  let reads = 0;
  const becameReady = await gcalEventsWaitForRenderedNote(
    async () => {
      reads += 1;
      return reads >= 3 ? ready : "# Friday\n";
    },
    { timeoutMs: 5000, pollMs: 100, now: () => now, delay: async (ms) => { now += ms; } },
  );
  assert.equal(becameReady, true);
  assert.ok(reads > 3);
  assert.ok(now >= GCAL_EVENTS_SETTLE_MS);
});

test("the waiter restarts settle when the note changes", async () => {
  const first = "# Friday\n\n## Pomodoros\n";
  const second = "# Friday!\n\n## Pomodoros\n";
  let now = 0;
  let reads = 0;
  const becameReady = await gcalEventsWaitForRenderedNote(
    async () => {
      reads += 1;
      return reads < 3 ? first : second;
    },
    { timeoutMs: 5000, pollMs: 100, now: () => now, delay: async (ms) => { now += ms; } },
  );
  assert.equal(becameReady, true);
  assert.ok(now >= GCAL_EVENTS_SETTLE_MS);
});

test("gcal sync spawns with --format json", () => {
  assert.deepEqual(gcalEventsSyncArgs(), ["gcal", "sync", "-q", "--format", "json"]);
});

test("gcalEventsDecodeSync accepts held and ignores unknown future fields", () => {
  const ok = gcalEventsDecodeSync(JSON.stringify({
    schema_version: 1,
    ok: true,
    status: "held",
    future_field: { nested: true },
  }), "");
  assert.equal(ok.ok, true);
  assert.equal(ok.report.status, "held");
  assert.deepEqual(ok.report.deprecations, []);
  const waiting = gcalEventsDecodeSync(JSON.stringify({
    schema_version: 1,
    ok: true,
    status: "waiting",
    waiting: { reason: "note_unrendered", detail: "d", hint: "h", line: 3 },
  }), "");
  assert.equal(waiting.ok, true);
  assert.equal(waiting.report.waiting.reason, "note_unrendered");
});

test("waiting and held notices fire once per day", () => {
  const seen = [];
  const notice = (text) => seen.push(text);
  const day = new Date(2026, 10, 9, 12, 0, 0);
  const otherDay = new Date(2026, 10, 10, 12, 0, 0);
  const waiting = { status: "waiting", waiting: { reason: "note_unrendered" } };
  const state = {};
  assert.equal(gcalEventsShowWaitingNotice(state, waiting, { notice, now: day }), true);
  assert.deepEqual(seen, [gcalEventsWaitingNoticeText()]);
  assert.equal(gcalEventsShowWaitingNotice(state, waiting, { notice, now: day }), false);
  assert.equal(seen.length, 1);
  assert.equal(gcalEventsShowWaitingNotice(state, waiting, { notice, now: otherDay }), true);
  assert.equal(seen.length, 2);
  assert.equal(
    gcalEventsShowWaitingNotice({}, { status: "waiting", waiting: { reason: "note_missing" } }, { notice, now: day }),
    false,
  );
  assert.equal(gcalEventsShowWaitingNotice({}, { status: "waiting" }, { notice, now: day }), false);
  assert.equal(gcalEventsShowWaitingNotice({}, { status: "written" }, { notice, now: day }), false);

  const heldState = {};
  const held = { status: "held" };
  assert.equal(gcalEventsShowHeldNotice(heldState, held, { notice, now: day }), true);
  assert.equal(seen[seen.length - 1], gcalEventsHeldNoticeText());
  assert.equal(gcalEventsShowHeldNotice(heldState, held, { notice, now: day }), false);
  assert.equal(gcalEventsShowHeldNotice({}, { status: "written" }, { notice, now: day }), false);
});

test("calendar hook spawns sync after the wait times out and notices waiting", async () => {
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.app = { vault: { read: async () => "# Friday\n<% tp.file.title %>\n\n## Pomodoros\n" } };
  plugin.gcalSyncOnCreateEnabled = true;
  plugin.gcalSyncNoticeDays = new Set();
  let spawned = null;
  plugin.bobSpawnJson = async (args, decode, options) => {
    spawned = args.slice();
    assert.equal(options.commandLabel, "bob gcal sync");
    return decode(JSON.stringify({
      schema_version: 1,
      ok: true,
      status: "waiting",
      waiting: { reason: "note_unrendered", detail: "d", hint: "h", line: 2 },
    }), "");
  };
  const result = await plugin.gcalSyncCreatedDailyNote(
    { path: "2026/20261109.md" },
    { timeoutMs: 200, pollMs: 50, settleMs: 50 },
  );
  assert.equal(result, true);
  assert.deepEqual(spawned, ["gcal", "sync", "-q", "--format", "json"]);
  assert.ok(plugin.gcalSyncNoticeDays.has(formatLocalDate(new Date())));
});

test("calendar hook notices a held sync once per day", async () => {
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.app = { vault: { read: async () => "# Friday\n\n## Pomodoros\n" } };
  plugin.gcalSyncOnCreateEnabled = true;
  plugin.gcalSyncNoticeDays = new Set();
  plugin.bobSpawnJson = async (args, decode) => decode(JSON.stringify({
    schema_version: 1,
    ok: true,
    status: "held",
  }), "");
  const first = await plugin.gcalSyncCreatedDailyNote(
    { path: "2026/20261109.md" },
    { timeoutMs: 5000, pollMs: 50, settleMs: 50 },
  );
  assert.equal(first, true);
  assert.equal(plugin.gcalSyncNoticeDays.size, 1);
  const second = await plugin.gcalSyncCreatedDailyNote(
    { path: "2026/20261109.md" },
    { timeoutMs: 5000, pollMs: 50, settleMs: 50 },
  );
  assert.equal(second, true);
  assert.equal(plugin.gcalSyncNoticeDays.size, 1);
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

function gcalMakeDoc(lines) {
  const text = lines.join("\n");
  return {
    _text: text,
    toString() {
      return this._text;
    },
  };
}

function gcalMakeView({ lines, selection = [], path = null, live = true, doc = null }) {
  const resolvedPath = path || todayDailyPath(new Date());
  const stateDoc = doc || gcalMakeDoc(lines);
  return {
    state: {
      doc: stateDoc,
      selection: { ranges: selection },
      field: (field) => {
        if (field === editorLivePreviewField) return live;
        if (field === editorInfoField) return { file: { path: resolvedPath } };
        return null;
      },
    },
  };
}

function gcalPlugin() {
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.app = { internalPlugins: { plugins: {} } };
  plugin.calendarEventsPaintEnabled = true;
  plugin.calendarEventScanCache = null;
  return plugin;
}

function gcalLineOffsets(lines, index) {
  let offset = 0;
  for (let i = 0; i < index; i += 1) offset += lines[i].length + 1;
  return offset;
}

test("off-clock Live Preview paints one chip widget and no split marks", () => {
  const lines = [
    "## Events",
    "- [*] #task **0800-0815** Swings! [📅](https://example.test/e) #offclock [root:: love] ^swings",
    "## Pomodoros",
  ];
  const plugin = gcalPlugin();
  const built = plugin.buildCalendarEventDecorations(gcalMakeView({ lines }));
  const adds = built.adds;
  const tagStart = lines[1].indexOf("#offclock");
  const base = gcalLineOffsets(lines, 1);
  const offClock = adds.filter(
    (add) => add.from === base + tagStart && add.to === base + tagStart + "#offclock".length,
  );
  assert.equal(offClock.length, 1);
  assert.equal(offClock[0].value._decorationReplace, true);
  assert.ok(offClock[0].value.widget instanceof StubWidgetType);
  assert.equal(offClock[0].value.widget.text, "offclock");
  const marks = adds.filter(
    (add) => add.value && (add.value.class === "bob-calendar-event-off-clock"
      || add.value.class === "bob-calendar-event-off-clock-hash"),
  );
  assert.equal(marks.length, 0);
});

test("off-clock chip preserves alias spelling and case", () => {
  for (const [tag, label] of [["#Untracked", "Untracked"], ["#off-clock", "off-clock"]]) {
    const lines = [
      "## Events",
      `- [*] #task **0800-0815** Swings! [📅](https://example.test/e) ${tag} ^swings`,
      "## Pomodoros",
    ];
    const plugin = gcalPlugin();
    const built = plugin.buildCalendarEventDecorations(gcalMakeView({ lines }));
    const tagStart = lines[1].indexOf(tag);
    const base = gcalLineOffsets(lines, 1);
    const found = built.adds.filter(
      (add) => add.from === base + tagStart && add.to === base + tagStart + tag.length,
    );
    assert.equal(found.length, 1, tag);
    assert.equal(found[0].value.widget.text, label, tag);
  }
});

test("off-clock chip reveals the raw tag while the cursor is on the line", () => {
  const lines = [
    "## Events",
    "- [*] #task **0800-0815** Swings! [📅](https://example.test/e) #offclock [root:: love] ^swings",
    "## Pomodoros",
  ];
  const plugin = gcalPlugin();
  const base = gcalLineOffsets(lines, 1);
  const built = plugin.buildCalendarEventDecorations(
    gcalMakeView({ lines, selection: [{ from: base, to: base }] }),
  );
  const offClock = built.adds.filter(
    (add) => add.value && add.value.widget instanceof StubWidgetType,
  );
  assert.equal(offClock.length, 0);
  const time = built.adds.filter(
    (add) => add.value && add.value.class === "bob-calendar-event-time",
  );
  assert.ok(time.length >= 1);
  assert.equal(time[0].value.attributes["data-off-clock"], "true");
});

test("buffer and off-clock decorations stay sorted and disjoint", () => {
  const lines = [
    "## Events",
    "- [*] #task **1200-1300** Lunch #offclock [buffer:: -30m +15m] [root:: love] ^lunch",
    "## Pomodoros",
  ];
  const plugin = gcalPlugin();
  let built;
  assert.doesNotThrow(() => {
    built = plugin.buildCalendarEventDecorations(gcalMakeView({ lines }));
  });
  const adds = built.adds;
  for (let i = 1; i < adds.length; i += 1) {
    assert.ok(
      adds[i - 1].from < adds[i].from
        || (adds[i - 1].from === adds[i].from && adds[i - 1].to <= adds[i].to),
      `out of order at ${i}`,
    );
  }
  const tagStart = lines[1].indexOf("#offclock");
  const base = gcalLineOffsets(lines, 1);
  const replace = adds.find(
    (add) => add.from === base + tagStart && add.value && add.value._decorationReplace,
  );
  assert.ok(replace);
  for (const add of adds) {
    if (add === replace) continue;
    if (!add.value || add.value._decorationLine) continue;
    const cls = add.value.class || "";
    if (cls !== "bob-calendar-event-time" && cls !== "bob-calendar-event-buffer-field") continue;
    assert.ok(
      replace.to <= add.from || replace.from >= add.to,
      `off-clock replace overlaps ${cls}`,
    );
  }
});

test("a selection-only update reuses the cached scan", () => {
  const lines = [
    "## Events",
    "- [*] #task **0800-0815** Swings! [📅](https://example.test/e) #offclock ^swings",
    "## Pomodoros",
  ];
  const plugin = gcalPlugin();
  const doc = gcalMakeDoc(lines);
  plugin.buildCalendarEventDecorations(gcalMakeView({ lines, doc }));
  const first = plugin.calendarEventScanCache;
  assert.ok(first);
  const other = gcalLineOffsets(lines, 2);
  plugin.buildCalendarEventDecorations(
    gcalMakeView({ lines, doc, selection: [{ from: other, to: other }] }),
  );
  assert.equal(plugin.calendarEventScanCache, first);
});

test("the off-clock chip DOM carries the class, marker, and title", () => {
  const attrs = new Map();
  const doc = {
    createElement: () => ({
      className: "",
      textContent: "",
      setAttribute: (name, value) => attrs.set(name, String(value)),
    }),
  };
  const el = buildCalendarEventOffClockChip(doc, "offclock");
  assert.equal(el.className, "bob-calendar-event-off-clock");
  assert.equal(el.textContent, "offclock");
  assert.equal(attrs.get("data-off-clock"), "true");
  assert.equal(attrs.get("title"), GCAL_EVENTS_OFF_CLOCK_TITLE);
  assert.equal(GCAL_EVENTS_OFF_CLOCK_TITLE, "Off-clock · on the calendar, off the clock");
});

function clockEnvFor(notes) {
  const sources = new Map(Object.entries(notes || {}));
  const files = new Map([...sources.keys()].map((path) => [path, { path }]));
  const resolve = (target) => {
    const name = String(target || "").replace(/\.md$/i, "");
    const exact = `${name}.md`;
    if (files.has(exact)) return files.get(exact);
    const basename = name.split("/").pop().toLowerCase();
    return [...files.values()].find((file) =>
      file.path.split("/").pop().replace(/\.md$/i, "").toLowerCase() === basename
    ) || null;
  };
  const vault = { getAbstractFileByPath: (path) => files.get(path) || null };
  const metadataCache = {
    getFileCache: (file) => {
      const source = sources.get(file.path) || "";
      const match = /^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/.exec(source);
      const frontmatter = {};
      if (match) {
        for (const line of match[1].split("\n")) {
          const field = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
          if (!field) continue;
          let value = field[2].trim();
          if (
            (value.startsWith('"') && value.endsWith('"'))
            || (value.startsWith("'") && value.endsWith("'"))
          ) {
            value = value.slice(1, -1);
          } else if (value.toLowerCase() === "true") {
            value = true;
          } else if (value.toLowerCase() === "false") {
            value = false;
          }
          frontmatter[field[1]] = value;
        }
      }
      return { frontmatter };
    },
    getFirstLinkpathDest: (target) => resolve(target),
  };
  return { vault, metadataCache };
}

function loveClockEnv() {
  return clockEnvFor({
    "love.md": "---\ntype: [[area]]\noffclock: true\n---\n",
    "abby.md": "---\ntype: [[area]]\nparent: [[love]]\n---\n",
  });
}

test("scan treats #on as on-clock even beside an off spelling", () => {
  const scan = gcalEventsScanMarkdown([
    "## Events",
    "- [*] #task **1200-1300** Planning #on #off [root:: love] ^plan",
    "- [*] #task **1400-1430** Lunch #off ^lunch",
    "## Pomodoros",
  ]);
  assert.equal(scan.rows[0].offClock, false);
  assert.equal(scan.rows[0].clockSource, "on_tag");
  assert.ok(scan.rows[0].offClockTag);
  assert.equal(scan.rows[1].offClock, true);
  assert.equal(scan.rows[1].clockSource, "off_tag");
});

test("inherited off-clock Event Tasks dash the pill with a from-note tooltip", () => {
  const env = loveClockEnv();
  const daily = todayDailyPath(new Date());
  const lines = [
    "## Events",
    "- [*] #task **1200-1300** Lunch [root:: abby] ^lunch",
    "- [*] #task **1400-1430** Planning #on [root:: love] ^plan",
    "- [*] #task **1500-1530** Gym #off ^gym",
    "## Pomodoros",
  ];
  const scanned = gcalEventsScanMarkdown(lines);
  gcalEventsEnrichScannedClocks(scanned, lines, {
    path: daily,
    metadataCache: env.metadataCache,
    vault: env.vault,
  });
  assert.equal(scanned.rows[0].offClock, true);
  assert.equal(scanned.rows[0].clockSource, "note");
  assert.equal(scanned.rows[0].clockNote, "love.md");
  assert.equal(scanned.rows[0].offClockTag, null);
  assert.equal(gcalEventsClockTooltip(scanned.rows[0]), "Off-clock · from love");
  assert.equal(gcalEventsFromNoteTitle("love.md"), "Off-clock · from love");
  const inherited = gcalEventsTimeAttributes(scanned.rows[0]);
  assert.equal(inherited["data-off-clock"], "true");
  assert.equal(inherited.title, "Off-clock · from love");

  assert.equal(scanned.rows[1].offClock, false);
  assert.equal(scanned.rows[1].clockSource, "on_tag");
  assert.equal(gcalEventsClockTooltip(scanned.rows[1]), GCAL_EVENTS_ON_CLOCK_TITLE);
  const onClock = gcalEventsTimeAttributes(scanned.rows[1]);
  assert.equal(onClock["data-off-clock"], undefined);
  assert.equal(onClock.title, GCAL_EVENTS_ON_CLOCK_TITLE);

  assert.equal(scanned.rows[2].offClock, true);
  assert.equal(scanned.rows[2].clockSource, "off_tag");
  assert.equal(gcalEventsClockTooltip(scanned.rows[2]), "");
  assert.equal(gcalEventsTimeAttributes(scanned.rows[2])["data-off-clock"], "true");
});

test("Live Preview dashes inherited rows and keeps #off chips", () => {
  const env = loveClockEnv();
  const lines = [
    "## Events",
    "- [*] #task **1200-1300** Lunch [root:: abby] ^lunch",
    "- [*] #task **1400-1430** Gym #offclock ^gym",
    "- [*] #task **1500-1530** Planning #on [root:: love] ^plan",
    "## Pomodoros",
  ];
  const plugin = gcalPlugin();
  plugin.app = { ...plugin.app, metadataCache: env.metadataCache, vault: env.vault };
  const built = plugin.buildCalendarEventDecorations(gcalMakeView({ lines }));
  const adds = built.adds;
  const lunch = gcalLineOffsets(lines, 1);
  const gym = gcalLineOffsets(lines, 2);
  const planning = gcalLineOffsets(lines, 3);
  const lunchTime = adds.find((add) =>
    add.value && add.value.class === "bob-calendar-event-time" && add.from >= lunch && add.from < gym,
  );
  const gymTime = adds.find((add) =>
    add.value && add.value.class === "bob-calendar-event-time" && add.from >= gym && add.from < planning,
  );
  const planTime = adds.find((add) =>
    add.value && add.value.class === "bob-calendar-event-time" && add.from >= planning,
  );
  assert.ok(lunchTime);
  assert.equal(lunchTime.value.attributes["data-off-clock"], "true");
  assert.equal(lunchTime.value.attributes.title, "Off-clock · from love");
  const lunchChip = adds.filter((add) =>
    add.value && add.value.widget instanceof StubWidgetType && add.from >= lunch && add.from < gym,
  );
  assert.equal(lunchChip.length, 0);

  assert.ok(gymTime);
  assert.equal(gymTime.value.attributes["data-off-clock"], "true");
  const gymChip = adds.filter((add) =>
    add.value && add.value.widget instanceof StubWidgetType && add.from >= gym && add.from < planning,
  );
  assert.equal(gymChip.length, 1);
  assert.equal(gymChip[0].value.widget.text, "offclock");

  assert.ok(planTime);
  assert.equal(planTime.value.attributes["data-off-clock"], undefined);
  assert.equal(planTime.value.attributes.title, GCAL_EVENTS_ON_CLOCK_TITLE);
});

test("Reading view dashes inherited pills and tooltips #on overrides", () => {
  const attrs = () => {
    const map = new Map();
    return {
      setAttribute: (name, value) => map.set(name, String(value)),
      getAttribute: (name) => (map.has(name) ? map.get(name) : null),
      _map: map,
    };
  };
  const inheritedTime = { ...attrs() };
  assert.equal(
    gcalEventsPaintClockMarks({ querySelectorAll: () => [] }, inheritedTime, {
      offClock: true,
      clockSource: "note",
      clockNote: "love.md",
    }),
    false,
  );
  assert.equal(inheritedTime.getAttribute("data-off-clock"), "true");
  assert.equal(inheritedTime.getAttribute("title"), "Off-clock · from love");

  const onMap = new Map();
  const onTag = {
    textContent: "#on",
    classList: { add: () => {} },
    setAttribute: (name, value) => onMap.set(name, String(value)),
    getAttribute: (name) => (onMap.has(name) ? onMap.get(name) : null),
  };
  const onTime = { ...attrs() };
  gcalEventsPaintClockMarks({ querySelectorAll: () => [onTag] }, onTime, {
    offClock: false,
    clockSource: "on_tag",
    clockNote: null,
  });
  assert.equal(onTime.getAttribute("data-off-clock"), null);
  assert.equal(onTime.getAttribute("title"), GCAL_EVENTS_ON_CLOCK_TITLE);
  assert.equal(onMap.get("title"), GCAL_EVENTS_ON_CLOCK_TITLE);
});

test("gcalEventsDecodeSync treats missing deprecations as empty", () => {
  const ok = gcalEventsDecodeSync(JSON.stringify({
    schema_version: 1,
    ok: true,
    status: "unchanged",
  }));
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.report.deprecations, []);
  assert.deepEqual(gcalEventsDecodeDeprecations(undefined), []);
  assert.deepEqual(gcalEventsDecodeDeprecations(null), []);
  assert.deepEqual(gcalEventsDecodeDeprecations("nope"), []);
});

test("gcalEventsDecodeSync keeps additive deprecations[]", () => {
  const records = [
    {
      calendar_id: "primary",
      event_id: "e1",
      title: "Swings!",
      token: "#offclock",
      where: "title",
      replacement: "#off",
      drop_suggested: true,
      on_wins: false,
    },
    {
      calendar_id: "primary",
      event_id: "e2",
      title: "Gym",
      token: "#offclock",
      where: "description",
      replacement: "#off",
      drop_suggested: false,
      on_wins: false,
    },
    {
      calendar_id: "primary",
      event_id: "e2",
      title: "Gym",
      token: "#untracked",
      where: "title",
      replacement: "#off",
      drop_suggested: false,
      on_wins: false,
    },
  ];
  const ok = gcalEventsDecodeSync(JSON.stringify({
    schema_version: 1,
    ok: true,
    status: "written",
    deprecations: records,
  }));
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.report.deprecations, records);
  assert.equal(
    gcalEventsDeprecationNoticeText(records.slice(0, 1)),
    "1 calendar event still uses #offclock · run bob gcal list",
  );
  assert.equal(
    gcalEventsDeprecationNoticeText(records.slice(0, 2)),
    "2 calendar events still use #offclock · run bob gcal list",
  );
  assert.equal(
    gcalEventsDeprecationNoticeText(records),
    "2 calendar events still use deprecated clock tags · run bob gcal list",
  );
});

test("deprecation Notice fires once per day from a successful auto-sync", () => {
  const records = [
    { calendar_id: "primary", event_id: "e1", token: "#offclock" },
    { calendar_id: "primary", event_id: "e2", token: "#offclock" },
    { calendar_id: "primary", event_id: "e3", token: "#offclock" },
  ];
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.gcalDeprecationNoticeDays = new Set();
  const notices = [];
  const now = new Date(2026, 10, 3, 9, 0, 0);
  const later = new Date(2026, 10, 3, 18, 0, 0);
  const nextDay = new Date(2026, 10, 4, 9, 0, 0);
  const report = { deprecations: records };
  assert.equal(
    gcalEventsShowDeprecationNotice(plugin, report, { now, notice: (text) => notices.push(text) }),
    true,
  );
  assert.equal(
    gcalEventsShowDeprecationNotice(plugin, report, { now: later, notice: (text) => notices.push(text) }),
    false,
  );
  assert.deepEqual(notices, ["3 calendar events still use #offclock · run bob gcal list"]);
  assert.equal(
    gcalEventsShowDeprecationNotice(plugin, report, { now: nextDay, notice: (text) => notices.push(text) }),
    true,
  );
  assert.equal(notices.length, 2);
  assert.equal(
    gcalEventsShowDeprecationNotice(plugin, { deprecations: [] }, { now: nextDay, notice: (text) => notices.push(text) }),
    false,
  );
  assert.equal(notices.length, 2);
});

test("gmail sync-on-create gate only accepts today's canonical daily note", () => {
  const now = new Date(2026, 9, 30, 9, 0, 0);
  const app = { internalPlugins: { plugins: {} } };
  assert.equal(gmailEventsShouldSyncCreatedFile(true, { path: todayDailyPath(now) }, app, now), true);
  assert.equal(gmailEventsShouldSyncCreatedFile(false, { path: todayDailyPath(now) }, app, now), false);
  assert.equal(gmailEventsShouldSyncCreatedFile(true, { path: "2026/20261029.md" }, app, now), false);
  assert.deepEqual(gmailEventsSyncArgs(), ["gmail", "sync", "-q", "-f", "json", "-r", "30"]);
  assert.equal(GMAIL_EVENTS_SYNC_TIMEOUT_MS, 120000);
});

test("gmailEventsDecodeSync accepts schema_version 1", () => {
  const ok = gmailEventsDecodeSync(JSON.stringify({
    schema_version: 1,
    ok: true,
    pulled: 1,
  }));
  assert.equal(ok.ok, true);
  assert.equal(ok.report.pulled, 1);
  assert.equal(gmailEventsDecodeSync("{").ok, false);
  assert.equal(gmailEventsDecodeSync(JSON.stringify({ schema_version: 2, ok: true })).ok, false);
  const fail = gmailEventsDecodeSync(JSON.stringify({
    schema_version: 1,
    ok: false,
    error: { kind: "writer", message: "not the writer host" },
  }));
  assert.equal(fail.ok, false);
  assert.equal(fail.code, "writer");
});

test("gmailEventsFailureKind routes exit 1 to a Notice and exit 2 / unknown subcommand to info", () => {
  assert.equal(gmailEventsFailureKind({ ok: true }), null);
  assert.equal(gmailEventsFailureKind({ ok: false, exitCode: 1 }), "notice");
  assert.equal(gmailEventsFailureKind({ ok: false, exitCode: 2 }), "info");
  assert.equal(gmailEventsFailureKind({ ok: false, message: "unknown subcommand 'gmail'" }), "info");
  const notices = [];
  const plugin = { gmailSyncNoticeDays: new Set() };
  const now = new Date(2026, 10, 7, 9, 0, 0);
  assert.equal(gmailEventsShowFailureNotice(plugin, now, (text) => notices.push(text)), true);
  assert.equal(gmailEventsShowFailureNotice(plugin, now, (text) => notices.push(text)), false);
  assert.deepEqual(notices, ["Gmail sync failed · run `bob gmail doctor`"]);
});

test("morning archive notice validates the snapshot and deduplicates by local day and note", () => {
  const item = (thread_id) => ({
    thread_id,
    note: `mail/2026/${thread_id}.md`,
    archived_at: "2026-11-13T08:15:00-05:00",
    message_count: 2,
    label: { name: "bob/closed", id: "Label_42" },
    state: "archived",
  });
  const report = {
    recent_archive: {
      since: "2026-11-12T00:00:00-05:00",
      count: 1,
      items: [item("thread-a")],
    },
  };
  assert.equal(gmailEventsRecentArchiveCount(report), 1);
  const notices = [];
  const state = {};
  const day = new Date(2026, 10, 13, 9, 0, 0);
  const file = { path: "2026/20261113.md" };
  assert.equal(gmailEventsShowRecentArchiveNotice(state, report, file, day, (text) => notices.push(text)), true);
  assert.equal(gmailEventsShowRecentArchiveNotice(state, report, file, day, (text) => notices.push(text)), false);
  assert.deepEqual(notices, ["⤓ Bob archived 1 Gmail thread since yesterday — tasks you closed."]);
  assert.equal(gmailEventsShowRecentArchiveNotice(state, report, { path: "2026/20261113-copy.md" }, day, (text) => notices.push(text)), true);
  assert.equal(gmailEventsShowRecentArchiveNotice(state, report, file, new Date(2026, 10, 14, 9), (text) => notices.push(text)), true);

  const plural = { recent_archive: { ...report.recent_archive, count: 2, items: [item("thread-a"), item("thread-b")] } };
  assert.equal(gmailEventsRecentArchiveCount(plural), 2);
  assert.equal(gmailEventsShowRecentArchiveNotice({}, plural, file, day, (text) => notices.push(text)), true);
  assert.equal(notices.at(-1), "⤓ Bob archived 2 Gmail threads since yesterday — tasks you closed.");
  for (const malformed of [
    {},
    { recent_archive: { since: "bad", count: 1, items: [item("thread-a")] } },
    { recent_archive: { since: report.recent_archive.since, count: 2, items: [item("thread-a")] } },
    { recent_archive: { ...report.recent_archive, items: [{ ...item("thread-a"), state: "would_archive" }] } },
  ]) {
    assert.equal(gmailEventsRecentArchiveCount(malformed), null);
    assert.equal(gmailEventsShowRecentArchiveNotice({}, malformed, file, day, (text) => notices.push(text)), false);
  }
});

test("shared create listener runs gmail after gcal, and gmail when gcal is off", async () => {
  const now = new Date();
  const callbacks = {};
  const layoutReadyCallbacks = [];
  const app = {
    internalPlugins: { plugins: {} },
    workspace: { onLayoutReady(callback) { layoutReadyCallbacks.push(callback); } },
    vault: {
      on(event, callback) { callbacks[event] = callback; return { event, callback }; },
    },
  };
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.app = app;
  plugin.addCommand = () => {};
  plugin.registerEvent = () => {};
  const order = [];
  plugin.gcalSyncCreatedDailyNote = async () => { order.push("gcal"); };
  plugin.gmailSyncCreatedDailyNote = async () => { order.push("gmail"); };
  plugin.setupGcalSyncOnCreate();
  plugin.setupGmailSyncOnCreate();
  assert.equal(plugin.gmailSyncOnCreateEnabled, true);
  for (const callback of layoutReadyCallbacks.splice(0)) callback();
  const today = { path: todayDailyPath(now) };
  callbacks.create(today);
  callbacks.create(today);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(order, ["gcal", "gmail"]);

  plugin.gcalSyncOnCreateEnabled = false;
  plugin.gcalSyncCreatedPaths.clear();
  order.length = 0;
  callbacks.create(today);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(order, ["gmail"]);

  plugin.gmailSyncOnCreateEnabled = false;
  plugin.gcalSyncCreatedPaths.clear();
  order.length = 0;
  callbacks.create(today);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(order, []);
  assert.equal(plugin.toggleGmailSyncOnCreate(), true);
});

test("gmailSyncCreatedDailyNote spawns bob gmail sync with a 120s timeout", async () => {
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.gmailSyncOnCreateEnabled = true;
  plugin.app = {
    vault: { read: async () => "# Friday\n\n## Pomodoros\n" },
  };
  const calls = [];
  plugin.bobSpawnJson = async (args, decode, options) => {
    calls.push({ args, options });
    return { ok: true, report: { schema_version: 1, ok: true } };
  };
  assert.equal(await plugin.gmailSyncCreatedDailyNote({ path: "2026/20261107.md" }), true);
  assert.deepEqual(calls[0].args, ["gmail", "sync", "-q", "-f", "json", "-r", "30"]);
  assert.equal(calls[0].options.timeout, 120000);
  assert.equal(calls[0].options.commandLabel, "bob gmail sync");

  plugin.bobSpawnJson = async () => ({ ok: false, exitCode: 2, message: "unknown subcommand" });
  const infos = [];
  const originalInfo = console.info;
  console.info = (message) => infos.push(String(message));
  try {
    assert.equal(await plugin.gmailSyncCreatedDailyNote({ path: "2026/20261107.md" }), false);
  } finally {
    console.info = originalInfo;
  }
  assert.ok(infos[0].includes("bob gmail sync skipped"));
});

