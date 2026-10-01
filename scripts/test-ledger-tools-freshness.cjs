// Tests for the bob-ledger-tools freshness namespace and status bar
// (api v3). `docs/freshness.md` in bob-cli is the authoritative
// definition; the P-vectors below encode the "Placement conformance
// examples" (§9) and the S-vectors the "State conformance examples"
// (§10) verbatim, with D = `2026-10-08` and today `2026-10-08`.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestMarkdownView {}

class TestPlugin {
  constructor(app) {
    this.app = app;
  }

  addCommand(command) {
    this.commands = this.commands || [];
    this.commands.push(command);
  }

  registerEditorExtension(extension) {
    this.editorExtensions = this.editorExtensions || [];
    this.editorExtensions.push(extension);
  }

  registerEvent(ref) {
    this.registeredEvents = this.registeredEvents || [];
    this.registeredEvents.push(ref);
  }

  registerMarkdownCodeBlockProcessor(language, handler) {
    this.codeBlocks = this.codeBlocks || {};
    this.codeBlocks[language] = handler;
  }

  registerInterval(handle) {
    this.intervals = this.intervals || [];
    this.intervals.push(handle);
    return handle;
  }
}

class TestNotice {
  constructor(message) {
    TestNotice.messages.push(String(message));
  }
}
TestNotice.messages = [];

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: TestMarkdownView,
      Notice: TestNotice,
      Platform: { isDesktopApp: true },
      Plugin: TestPlugin,
      normalizePath: (value) => value,
      parseYaml: (text) => JSON.parse(text),
    };
  }
  if (request === "@codemirror/state") {
    return { Prec: { highest: (value) => value } };
  }
  if (request === "@codemirror/view") {
    return {
      EditorView: { updateListener: { of: (listener) => ({ listener }) } },
      keymap: { of: (value) => value },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers } = LedgerToolsPlugin;
Module._load = originalLoad;

const {
  TODAY_RELOAD_EVENT,
  coerceFreshnessConfig,
  defaultFreshnessConfig,
  freshnessBlock,
  freshnessCounts,
  freshnessIntervalFor,
  freshnessQueue,
  freshnessState,
  freshnessStatusView,
  freshnessSetRefreshLine,
  freshnessStampLine,
  loadFreshnessConfig,
  readFreshness,
} = helpers;

const D = "2026-10-08";
const CFG = { interval: 7, intervalFromConfig: false, staleDailyBudget: null };

// docs/freshness.md §9: input line, expected line, `changed`.
const PLACEMENT_VECTORS = [
  ["P1", "- [ ] #task Buy milk", "- [ ] #task Buy milk [fresh:: 2026-10-08]", true],
  [
    "P2",
    "- [ ] #task Buy milk [created::2026-09-29]",
    "- [ ] #task Buy milk [fresh:: 2026-10-08] [created::2026-09-29]",
    true,
  ],
  [
    "P3",
    "- [ ] #task Pick up Abby ^pickup",
    "- [ ] #task Pick up Abby [fresh:: 2026-10-08] ^pickup",
    true,
  ],
  [
    "P4",
    "- [ ] #task Plan trip [created::2026-08-26] #hide [priority:: high] ^trip",
    "- [ ] #task Plan trip [fresh:: 2026-10-08] [created::2026-08-26] #hide [priority:: high] ^trip",
    true,
  ],
  [
    "P5",
    "- [ ] #task Read X [[#^h-8bac|🔖]] [h:: e629] [created::2026-08-28]",
    "- [ ] #task Read X [[#^h-8bac|🔖]] [h:: e629] [fresh:: 2026-10-08] [created::2026-08-28]",
    true,
  ],
  [
    "P6",
    "- [ ] #task Rahway  [created:: 2026-07-15]  [scheduled:: 2026-08-10] ^rahway",
    "- [ ] #task Rahway [fresh:: 2026-10-08] [created:: 2026-07-15]  [scheduled:: 2026-08-10] ^rahway",
    true,
  ],
  [
    "P7",
    "- [ ] #task Buy milk [fresh:: 2026-10-01] [created::2026-09-29]",
    "- [ ] #task Buy milk [fresh:: 2026-10-08] [created::2026-09-29]",
    true,
  ],
  [
    "P8",
    "- [ ] #task Buy milk [fresh:: 2026-10-08] [created::2026-09-29]",
    "- [ ] #task Buy milk [fresh:: 2026-10-08] [created::2026-09-29]",
    false,
  ],
  [
    "P9",
    "- [ ] #task Buy milk [created::2026-09-29] [fresh:: 2026-10-01]",
    "- [ ] #task Buy milk [fresh:: 2026-10-08] [created::2026-09-29]",
    true,
  ],
  [
    "P10",
    "- [ ] #task A [fresh:: 2026-09-01] B [fresh:: 2026-09-20] [created::2026-09-01]",
    "- [ ] #task A B [fresh:: 2026-10-08] [created::2026-09-01]",
    true,
  ],
  [
    "P11",
    "- [ ] #task Rename queue input [refresh:: 14] [created::2026-09-10] [priority:: low]",
    "- [ ] #task Rename queue input [fresh:: 2026-10-08] [refresh:: 14] [created::2026-09-10] [priority:: low]",
    true,
  ],
  [
    "P14a",
    "- [ ] #task #hide ^x",
    "- [ ] #task [fresh:: 2026-10-08] #hide ^x",
    true,
  ],
  [
    "P14b",
    "- [ ] #task #prj Ship it #hide ^prj",
    "- [ ] #task #prj Ship it [fresh:: 2026-10-08] #hide ^prj",
    true,
  ],
  [
    "P15",
    "- [ ] #task Call mom (created:: 2026-09-01)",
    "- [ ] #task Call mom [fresh:: 2026-10-08] (created:: 2026-09-01)",
    true,
  ],
  [
    "P16",
    "\t- [?] #task Deferred [created::2026-09-01] [scheduled:: 2026-10-20]",
    "\t- [?] #task Deferred [fresh:: 2026-10-08] [created::2026-09-01] [scheduled:: 2026-10-20]",
    true,
  ],
  [
    "P18",
    "> - [ ] #task Quoted [created::2026-09-01]",
    "> - [ ] #task Quoted [fresh:: 2026-10-08] [created::2026-09-01]",
    true,
  ],
];

test("placement vectors P1-P11, P14-P16, P18 stamp canonically", () => {
  for (const [id, input, expected, changed] of PLACEMENT_VECTORS) {
    const stamped = freshnessStampLine(input, D);
    assert.equal(stamped.line, expected, `${id}: stamped line`);
    assert.equal(stamped.changed, changed, `${id}: changed`);
    assert.equal(stamped.refused, null, `${id}: not refused`);
  }
});

test("P12 set and clear refresh stamps alongside", () => {
  const p2 = "- [ ] #task Buy milk [fresh:: 2026-10-08] [created::2026-09-29]";
  const set = freshnessSetRefreshLine(
    "- [ ] #task Buy milk [created::2026-09-29]",
    30,
    D,
  );
  assert.equal(
    set.line,
    "- [ ] #task Buy milk [fresh:: 2026-10-08] [refresh:: 30] [created::2026-09-29]",
  );
  assert.equal(set.changed, true);
  const cleared = freshnessSetRefreshLine(p2.replace("[fresh:: 2026-10-08] ", "[fresh:: 2026-10-08] [refresh:: 30] "), null, D);
  assert.equal(cleared.line, p2);
});

test("P13 recurring and P17 done tasks are refused unchanged", () => {
  const recurring =
    "- [ ] #task Water plants [repeat:: every week] [created::2026-09-01]";
  const refusedRecurring = freshnessStampLine(recurring, D);
  assert.equal(refusedRecurring.line, recurring);
  assert.equal(refusedRecurring.changed, false);
  assert.equal(refusedRecurring.refused, "recurring");

  const done = "- [x] #task Old [completion:: 2026-10-01]";
  const refusedClosed = freshnessStampLine(done, D);
  assert.equal(refusedClosed.line, done);
  assert.equal(refusedClosed.changed, false);
  assert.equal(refusedClosed.refused, "closed");

  const plain = "just a bullet, not a task";
  assert.equal(freshnessStampLine(plain, D).refused, "not_task");
});

test("reader reports misplaced and duplicate fields", () => {
  const misplaced = readFreshness(
    "- [ ] #task Buy milk [created::2026-09-29] [fresh:: 2026-10-01]",
    D,
  );
  assert.ok(misplaced.lints.includes("fresh_misplaced"), "P9 lint");
  assert.equal(misplaced.fresh, "2026-10-01");

  const duplicates = readFreshness(
    "- [ ] #task A [fresh:: 2026-09-01] B [fresh:: 2026-09-20] [created::2026-09-01]",
    D,
  );
  assert.ok(duplicates.lints.includes("fresh_duplicate"), "P10 lint");
  assert.equal(duplicates.fresh, "2026-09-20");
});

// docs/freshness.md §10: a Ready, visible, non-recurring task in `a.md`
// unless noted.
function sRow(overrides = {}) {
  return {
    path: "a.md",
    line: 1,
    isTodo: true,
    recurring: false,
    laneVisible: true,
    isDailyNote: false,
    isToday: false,
    scheduled: null,
    rawLine: "- [ ] #task T",
    noteRefreshRaw: undefined,
    ...overrides,
  };
}

test("S1 new through S4 overdue", () => {
  assert.equal(freshnessState(sRow(), D, CFG), "new");
  const fresh = freshnessState(
    sRow({ rawLine: "- [ ] #task T [fresh:: 2026-10-02]" }),
    D,
    CFG,
  );
  assert.equal(fresh, "fresh");
  const boundary = helpers.freshnessEvaluate(
    sRow({ rawLine: "- [ ] #task T [fresh:: 2026-10-01]" }),
    D,
    CFG,
  );
  assert.equal(boundary.state, "stale");
  assert.equal(boundary.dueOn, "2026-10-08");
  assert.equal(boundary.daysOverdue, 0);
  const overdue = helpers.freshnessEvaluate(
    sRow({ rawLine: "- [ ] #task T [fresh:: 2026-09-20]" }),
    D,
    CFG,
  );
  assert.equal(overdue.state, "stale");
  assert.equal(overdue.dueOn, "2026-09-27");
  assert.equal(overdue.daysOverdue, 11);
  const freshDue = helpers.freshnessEvaluate(
    sRow({ rawLine: "- [ ] #task T [fresh:: 2026-10-02]" }),
    D,
    CFG,
  );
  assert.equal(freshDue.dueOn, "2026-10-09");
});

test("S5 task beats note, S6 note beats config, S7 config", () => {
  const task = helpers.freshnessEvaluate(
    sRow({
      rawLine: "- [ ] #task T [fresh:: 2026-10-01] [refresh:: 14]",
      noteRefreshRaw: 3,
    }),
    D,
    CFG,
  );
  assert.equal(task.state, "fresh");
  assert.equal(task.intervalDays, 14);
  assert.equal(task.intervalSource, "task");

  const note = helpers.freshnessEvaluate(
    sRow({
      rawLine: "- [ ] #task T [fresh:: 2026-10-05]",
      noteRefreshRaw: 3,
    }),
    D,
    CFG,
  );
  assert.equal(note.state, "stale");
  assert.equal(note.intervalSource, "note");

  const config = helpers.freshnessEvaluate(
    sRow({ rawLine: "- [ ] #task T [fresh:: 2026-10-01]" }),
    D,
    { interval: 10, intervalFromConfig: true, staleDailyBudget: null },
  );
  assert.equal(config.state, "fresh");
  assert.equal(config.intervalSource, "config");
});

test("S8 invalid overrides fall through with lints", () => {
  const evaluated = helpers.freshnessEvaluate(
    sRow({
      rawLine: "- [ ] #task T [fresh:: 2026-10-01] [refresh:: 0]",
      noteRefreshRaw: "soon",
    }),
    D,
    CFG,
  );
  assert.ok(evaluated.lints.includes("refresh_invalid"));
  assert.ok(evaluated.lints.includes("task_refresh_invalid"));
  assert.equal(evaluated.intervalDays, 7);
  assert.equal(evaluated.intervalSource, "default");
});

test("S9 malformed and S10 future stamps read as new", () => {
  const malformed = helpers.freshnessEvaluate(
    sRow({ rawLine: "- [ ] #task T [fresh:: 2026-13-01]" }),
    D,
    CFG,
  );
  assert.equal(malformed.state, "new");
  assert.ok(malformed.lints.includes("fresh_malformed"));

  const future = helpers.freshnessEvaluate(
    sRow({ rawLine: "- [ ] #task T [fresh:: 2026-10-09]" }),
    D,
    CFG,
  );
  assert.equal(future.state, "new");
  assert.ok(future.lints.includes("fresh_future"));
});

test("S11 resurfaced beats stale, S12 scheduled-equals-fresh stays fresh", () => {
  const resurfaced = helpers.freshnessEvaluate(
    sRow({
      rawLine:
        "- [ ] #task T [fresh:: 2026-10-05] [scheduled:: 2026-10-07]",
      scheduled: "2026-10-07",
    }),
    D,
    CFG,
  );
  assert.equal(resurfaced.state, "resurfaced");
  assert.equal(resurfaced.dueOn, "2026-10-07");

  assert.equal(
    freshnessState(
      sRow({
        rawLine:
          "- [ ] #task T [fresh:: 2026-10-07] [scheduled:: 2026-10-07]",
        scheduled: "2026-10-07",
      }),
      D,
      CFG,
    ),
    "fresh",
  );
});

test("S13 out-of-scope rows read null", () => {
  const cases = [
    sRow({ recurring: true }),
    sRow({ laneVisible: false }),
    sRow({ isTodo: false }),
    sRow({ path: "_templates/x.md", laneVisible: false }),
    sRow({ path: "2026/20261008.md", isDailyNote: true }),
    sRow({ isToday: true }),
  ];
  for (const row of cases) {
    assert.equal(freshnessState(row, D, CFG), null, JSON.stringify(row));
  }
});

test("S14 queue order is NEW by path then DUE by due date", () => {
  const rows = [
    sRow({ path: "b.md", line: 3 }),
    sRow({ path: "a.md", line: 9 }),
    sRow({
      path: "c.md",
      line: 2,
      rawLine: "- [ ] #task C [fresh:: 2026-09-24]",
    }),
    sRow({
      path: "a.md",
      line: 4,
      rawLine: "- [ ] #task R [fresh:: 2026-10-05] [scheduled:: 2026-10-07]",
      scheduled: "2026-10-07",
    }),
    sRow({
      path: "a.md",
      line: 2,
      rawLine: "- [ ] #task S [fresh:: 2026-09-30]",
    }),
  ];
  const queue = freshnessQueue(rows, D, CFG);
  assert.deepEqual(
    queue.map((entry) => `${entry.path}:${entry.line}`),
    ["a.md:9", "b.md:3", "c.md:2", "a.md:2", "a.md:4"],
  );
  assert.deepEqual(
    queue.map((entry) => entry.rank),
    [1, 2, 3, 4, 5],
  );
  assert.deepEqual(
    queue.map((entry) => entry.tier),
    ["1 · NEW", "1 · NEW", "2 · DUE", "2 · DUE", "2 · DUE"],
  );
});

test("S15 refreshed_today spans lanes and the budget needs zero new", () => {
  const rows = [
    sRow({
      path: "a.md",
      line: 1,
      isTodo: false,
      laneVisible: false,
      rawLine: "- [*] #task Next [fresh:: 2026-10-08]",
    }),
    sRow({
      path: "a.md",
      line: 2,
      isTodo: false,
      laneVisible: false,
      rawLine: "- [x] #task Done [fresh:: 2026-10-08]",
    }),
    sRow({
      path: "a.md",
      line: 3,
      rawLine: "- [ ] #task Old [fresh:: 2026-10-07]",
    }),
  ];
  const counts = freshnessCounts(rows, D, {
    interval: 7,
    intervalFromConfig: false,
    staleDailyBudget: 2,
  });
  assert.equal(counts.refreshedToday, 2);
  assert.equal(counts.new, 0);
  assert.equal(counts.budgetMet, true);

  const withNew = freshnessCounts(
    [...rows, sRow({ path: "b.md", line: 1 })],
    D,
    { interval: 7, intervalFromConfig: false, staleDailyBudget: 2 },
  );
  assert.equal(withNew.new, 1);
  assert.equal(withNew.budgetMet, false);
});

test("config coercion keeps defaults, flags invalid, ignores unknown keys", () => {
  assert.deepEqual(defaultFreshnessConfig(), {
    interval: 7,
    staleDailyBudget: null,
  });
  assert.equal(freshnessBlock({}), undefined);
  assert.deepEqual(freshnessBlock({ freshness: { interval: 3 } }), {
    interval: 3,
  });

  const good = coerceFreshnessConfig({
    interval: 10,
    stale_daily_budget: 15,
    unknown_key: "ignored",
  });
  assert.equal(good.invalid, false);
  assert.equal(good.config.interval, 10);
  assert.equal(good.config.staleDailyBudget, 15);

  assert.equal(coerceFreshnessConfig(undefined).invalid, false);
  assert.equal(coerceFreshnessConfig(null).invalid, false);
  for (const block of [
    { interval: 0 },
    { interval: 366 },
    { interval: "soon" },
    { interval: 7.5 },
    { stale_daily_budget: 0 },
    { stale_daily_budget: "soon" },
    [1, 2],
  ]) {
    const coerced = coerceFreshnessConfig(block);
    assert.equal(coerced.invalid, true, JSON.stringify(block));
    assert.deepEqual(
      { interval: coerced.config.interval, staleDailyBudget: coerced.config.staleDailyBudget },
      { interval: 7, staleDailyBudget: null },
    );
  }
});

test("loadFreshnessConfig reads the block with plan-style injectables", () => {
  const missing = loadFreshnessConfig({
    fsModule: {
      readFileSync: () => {
        const error = new Error("missing");
        error.code = "ENOENT";
        throw error;
      },
    },
    parseYaml: (text) => JSON.parse(text),
    Platform: { isDesktopApp: true },
    configPath: "/cfg/bob/config.yml",
  });
  assert.equal(missing.invalid, false);
  assert.equal(missing.config.interval, 7);

  const good = loadFreshnessConfig({
    fsModule: {
      readFileSync: () => JSON.stringify({ freshness: { interval: 10 } }),
    },
    parseYaml: (text) => JSON.parse(text),
    Platform: { isDesktopApp: true },
    configPath: "/cfg/bob/config.yml",
  });
  assert.equal(good.invalid, false);
  assert.equal(good.config.interval, 10);

  const bad = loadFreshnessConfig({
    fsModule: {
      readFileSync: () => JSON.stringify({ freshness: { interval: "soon" } }),
    },
    parseYaml: (text) => JSON.parse(text),
    Platform: { isDesktopApp: true },
    configPath: "/cfg/bob/config.yml",
  });
  assert.equal(bad.invalid, true);
  assert.equal(bad.config.interval, 7);

  const mobile = loadFreshnessConfig({
    fsModule: { readFileSync: () => "{}" },
    Platform: { isDesktopApp: false },
  });
  assert.equal(mobile.invalid, false);
});

test("interval precedence is task, note, config, default", () => {
  assert.deepEqual(freshnessIntervalFor(14, 3, CFG), {
    days: 14,
    source: "task",
  });
  assert.deepEqual(freshnessIntervalFor(null, 3, CFG), {
    days: 3,
    source: "note",
  });
  assert.deepEqual(
    freshnessIntervalFor(null, null, {
      interval: 10,
      intervalFromConfig: true,
      staleDailyBudget: null,
    }),
    { days: 10, source: "config" },
  );
  assert.deepEqual(freshnessIntervalFor(null, null, CFG), {
    days: 7,
    source: "default",
  });
});

// --- Plugin behaviour -------------------------------------------------------

function makeFreshnessTask(overrides = {}) {
  return {
    status: { type: "TODO", name: "Todo", symbol: " " },
    tags: [],
    path: "notes/a.md",
    lineNumber: 0,
    description: "Do it",
    originalMarkdown: "- [ ] #task Do it",
    ...overrides,
  };
}

function makeFreshnessApp({ tasks, frontmatter = {}, triggers = [] } = {}) {
  return {
    vault: {
      getAbstractFileByPath: () => null,
      cachedRead: () => Promise.resolve(null),
    },
    workspace: {
      on: () => ({}),
      offref: () => {},
      onLayoutReady: () => {},
      getActiveFile: () => null,
      trigger: (event) => triggers.push(event),
    },
    metadataCache: {
      on: () => ({}),
      getCache: (file) => {
        const path = file && file.path;
        if (!path || frontmatter[path] === undefined) {
          return {};
        }
        return { frontmatter: { task_refresh: frontmatter[path] } };
      },
      getFirstLinkpathDest: () => null,
    },
    commands: {},
    plugins: {
      plugins: {
        "obsidian-tasks-plugin": { getTasks: () => tasks },
      },
    },
  };
}

function withMissingConfig(run) {
  const savedXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = "/definitely/missing/freshness-test";
  try {
    return run();
  } finally {
    if (savedXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = savedXdg;
    }
  }
}

test("api v3 shape keeps every v2 member", () => {
  withMissingConfig(() => {
    const tasks = [makeFreshnessTask()];
    const plugin = new LedgerToolsPlugin(makeFreshnessApp({ tasks }), {});
    plugin.onload();
    try {
      assert.equal(plugin.api.version, 3);
      for (const key of [
        "caps",
        "planBudget",
        "todayKeys",
        "isToday",
        "todayRank",
        "nextBudget",
        "pendingBudget",
      ]) {
        assert.equal(typeof plugin.api[key], "function", `v2 member ${key}`);
      }
      assert.equal(plugin.api.nowBudget, undefined);
      const freshness = plugin.api.freshness;
      assert.equal(freshness.version, 1);
      for (const key of [
        "config",
        "stampLine",
        "setRefreshLine",
        "state",
        "isDue",
        "tier",
        "rank",
        "intervalFor",
        "queue",
        "counts",
        "lints",
      ]) {
        assert.equal(typeof freshness[key], "function", `freshness ${key}`);
      }
      assert.deepEqual(freshness.config(), {
        interval: 7,
        staleDailyBudget: null,
        invalid: false,
      });
      assert.equal(freshness.state(tasks[0]), "new");
      assert.equal(freshness.isDue(tasks[0]), true);
      assert.equal(freshness.tier(tasks[0]), "1 · NEW");
      assert.equal(freshness.rank(tasks[0]), 0);
      assert.deepEqual(freshness.intervalFor(tasks[0]), {
        days: 7,
        source: "default",
      });
      assert.equal(freshness.queue().length, 1);
      assert.equal(freshness.counts().due, 1);
      assert.deepEqual(freshness.lints(), []);
      assert.equal(
        freshness.stampLine("- [ ] #task Buy milk", "2026-10-08"),
        "- [ ] #task Buy milk [fresh:: 2026-10-08]",
      );
    } finally {
      plugin.onunload();
    }
  });
});

test("memo invalidates on a new tasks array, rollover, and frontmatter", () => {
  withMissingConfig(() => {
    const triggers = [];
    let tasks = [makeFreshnessTask()];
    const frontmatter = {};
    const app = makeFreshnessApp({ tasks: undefined, frontmatter, triggers });
    app.plugins.plugins["obsidian-tasks-plugin"].getTasks = () => tasks;
    const plugin = new LedgerToolsPlugin(app, {});
    plugin.onload();
    try {
      const first = plugin.freshnessEnsureMemo(new Date(2026, 9, 8));
      assert.equal(first.queue.length, 1);
      const same = plugin.freshnessEnsureMemo(new Date(2026, 9, 8));
      assert.equal(same, first, "same array, date, frontmatter: memoized");
      assert.deepEqual(triggers, [], "task edits never fire the reload event");

      tasks = [makeFreshnessTask()];
      const rebuilt = plugin.freshnessEnsureMemo(new Date(2026, 9, 8));
      assert.notEqual(rebuilt, first, "new getTasks() array rebuilds");
      assert.deepEqual(triggers, [], "still no reload for task edits");

      const rolled = plugin.refreshFreshnessForRollover(new Date(2026, 9, 9));
      assert.equal(rolled, true);
      assert.equal(
        plugin.freshnessEnsureMemo(new Date(2026, 9, 9)).dateText,
        "2026-10-09",
      );
      assert.equal(
        plugin.refreshFreshnessForRollover(new Date(2026, 9, 9)),
        false,
      );

      frontmatter["notes/a.md"] = 30;
      const bumped = plugin.refreshFreshnessForChangedFile({
        path: "notes/a.md",
      });
      assert.equal(bumped, true);
      assert.equal(
        plugin.refreshFreshnessForChangedFile({ path: "notes/a.md" }),
        false,
        "same frontmatter value does not bump twice",
      );
      assert.equal(
        plugin.refreshFreshnessForChangedFile({ path: "notes/unseen.md" }),
        false,
        "unseen paths without task_refresh stay quiet",
      );
    } finally {
      plugin.onunload();
    }
  });
});

test("the reload event fires only when the due key set changes", () => {
  withMissingConfig(() => {
    const triggers = [];
    const tasks = [
      makeFreshnessTask({
        path: "notes/a.md",
        lineNumber: 0,
        description: "Old",
        originalMarkdown: "- [ ] #task Old [fresh:: 2026-10-01]",
      }),
    ];
    const frontmatter = {};
    const app = makeFreshnessApp({ tasks: undefined, frontmatter, triggers });
    app.plugins.plugins["obsidian-tasks-plugin"].getTasks = () => tasks;
    const plugin = new LedgerToolsPlugin(app, {});
    plugin.onload();
    try {
      plugin.freshnessEnsureMemo(new Date(2026, 9, 8));
      assert.deepEqual(triggers, []);

      // A longer interval clears the STALE entry, so the due set changes.
      frontmatter["notes/a.md"] = 30;
      plugin.refreshFreshnessForChangedFile({ path: "notes/a.md" });
      assert.deepEqual(triggers, [TODAY_RELOAD_EVENT]);

      // An unrelated note leaves the due set alone: no further reload.
      frontmatter["notes/other.md"] = 30;
      plugin.refreshFreshnessForChangedFile({ path: "notes/other.md" });
      assert.deepEqual(triggers, [TODAY_RELOAD_EVENT]);
    } finally {
      plugin.onunload();
    }
  });
});

test("status bar text covers every state, and a missing host stays quiet", () => {
  assert.deepEqual(
    freshnessStatusView(null, { tasksAvailable: false }),
    { text: "⟳ –", tooltip: "Tasks unavailable", mode: "unavailable" },
  );
  assert.equal(
    freshnessStatusView(
      { due: 23, new: 3, resurfaced: 2, stale: 18, refreshedToday: 12 },
      { mostOverdue: 11 },
    ).text,
    "⟳ 23 due · 3 new · ✓ 12 today",
  );
  assert.equal(
    freshnessStatusView(
      { due: 23, new: 3, resurfaced: 2, stale: 18, refreshedToday: 12 },
      { mostOverdue: 11 },
    ).mode,
    "new",
  );
  const budgeted = freshnessStatusView(
    {
      due: 5,
      new: 0,
      resurfaced: 1,
      stale: 4,
      refreshedToday: 12,
      budget: 15,
      budgetMet: false,
    },
    { mostOverdue: 4 },
  );
  assert.equal(budgeted.text, "⟳ 5 due · 0 new · ✓ 12/15 today");
  assert.equal(budgeted.mode, "due");
  assert.equal(
    freshnessStatusView(
      { due: 0, new: 0, resurfaced: 0, stale: 0, refreshedToday: 12 },
      {},
    ).mode,
    "clear",
  );
  assert.equal(
    freshnessStatusView(
      {
        due: 0,
        new: 0,
        resurfaced: 0,
        stale: 0,
        refreshedToday: 15,
        budget: 15,
        budgetMet: true,
      },
      {},
    ).mode,
    "budget",
  );

  withMissingConfig(() => {
    const plugin = new LedgerToolsPlugin(
      makeFreshnessApp({ tasks: [makeFreshnessTask()] }),
      {},
    );
    plugin.onload();
    try {
      assert.equal(plugin.freshnessStatusEl, null);
      plugin.updateFreshnessStatusBar();
      plugin.scheduleFreshnessStatusBar();
    } finally {
      plugin.onunload();
    }
  });
});

function makeStatusEl() {
  const classes = new Set();
  return {
    text: "",
    attrs: {},
    handlers: {},
    style: {},
    setText(value) {
      this.text = String(value);
    },
    setAttribute(key, value) {
      this.attrs[key] = String(value);
    },
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      has: (name) => classes.has(name),
    },
    addEventListener(event, handler) {
      this.handlers[event] = handler;
    },
  };
}

test("status bar clicks through, falling back to freshness.md", () => {
  withMissingConfig(() => {
    const executed = [];
    const opened = [];
    const el = makeStatusEl();
    const app = makeFreshnessApp({ tasks: [makeFreshnessTask()] });
    app.commands = {
      commands: {
        "bob-navigation-hotkeys:jump-to-next-due-task": {},
      },
      executeCommandById: (id) => executed.push(id),
    };
    app.workspace.openLinkText = (target) => opened.push(target);
    const plugin = new LedgerToolsPlugin(app, {});
    plugin.addStatusBarItem = () => el;
    plugin.onload();
    try {
      assert.equal(plugin.freshnessStatusEl, el);
      plugin.updateFreshnessStatusBar();
      assert.equal(el.text, "⟳ 1 due · 1 new · ✓ 0 today");
      el.handlers.click();
      assert.deepEqual(executed, [
        "bob-navigation-hotkeys:jump-to-next-due-task",
      ]);
      assert.deepEqual(opened, []);
    } finally {
      plugin.onunload();
    }

    const fallbackEl = makeStatusEl();
    const fallbackOpened = [];
    const fallbackApp = makeFreshnessApp({ tasks: [] });
    fallbackApp.workspace.openLinkText = (target) =>
      fallbackOpened.push(target);
    const fallback = new LedgerToolsPlugin(fallbackApp, {});
    fallback.addStatusBarItem = () => fallbackEl;
    fallback.onload();
    try {
      fallback.updateFreshnessStatusBar();
      assert.equal(fallbackEl.text, "⟳ 0 due · 0 new · ✓ 0 today");
      fallbackEl.handlers.click();
      assert.deepEqual(fallbackOpened, ["freshness"]);
    } finally {
      fallback.onunload();
    }
  });
});

test("every freshness api member is synchronous and never throws", () => {
  withMissingConfig(() => {
    const plugin = new LedgerToolsPlugin(makeFreshnessApp({}), {});
    plugin.onload();
    try {
      const freshness = plugin.api.freshness;
      assert.equal(freshness.state(null), null);
      assert.equal(freshness.isDue(undefined), false);
      assert.equal(freshness.tier(42), "");
      assert.equal(
        freshness.rank(null),
        Number.MAX_SAFE_INTEGER,
      );
      assert.deepEqual(freshness.intervalFor(null), {
        days: 7,
        source: "default",
      });
      assert.deepEqual(freshness.queue(), []);
      assert.equal(freshness.counts().due, 0);
      assert.deepEqual(freshness.lints(), []);
      assert.equal(freshness.stampLine(null), "");
      assert.equal(typeof freshness.stampLine("x"), "string");
    } finally {
      plugin.onunload();
    }
  });
});
// __FRESHNESS_TEST_END__
