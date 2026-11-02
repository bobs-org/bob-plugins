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
