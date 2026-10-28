// Lane walk queue: membership, parity, lane order, ranks, identity,
// unavailable, memo, and frozen shape (api.laneWalk v2).
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin {
  constructor(app) {
    this.app = app;
  }

  addCommand() {}
  registerEditorExtension() {}
  registerEvent() {}
  registerMarkdownCodeBlockProcessor() {}
  registerInterval(handle) {
    return handle;
  }
}

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: class {},
      Notice: class {},
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
  dashboardLaneBudgetFromTasks,
  freshnessRowKey,
  laneWalkQueueFromTasks,
  readyCountFromTasks,
  defaultPlanCaps,
} = helpers;

const DAY = new Date(2026, 9, 28);

function task(overrides = {}) {
  return {
    status: { type: "TODO", name: "Todo", symbol: " " },
    tags: ["#task"],
    path: "notes/a.md",
    lineNumber: 0,
    originalMarkdown: "- [ ] #task body",
    description: "body",
    isBlocked: () => false,
    ...overrides,
  };
}

function pendingTask(overrides = {}) {
  return task({
    status: { type: "IN_PROGRESS", name: "In Progress", symbol: "/" },
    originalMarkdown: "- [/] #task pending body",
    description: "pending body",
    ...overrides,
  });
}

function nextTask(overrides = {}) {
  return task({
    status: { type: "ON_HOLD", name: "Next", symbol: "*" },
    originalMarkdown: "- [*] #task next body",
    description: "next body",
    ...overrides,
  });
}

function makePlugin({
  tasks,
  today = () => false,
  cacheState = "Warm",
  todayReady = true,
  dateText = "2026-10-28",
  todayGen = 1,
  gateMemo = null,
  review = () => false,
} = {}) {
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.app = {
    plugins: {
      plugins: {
        "obsidian-tasks-plugin": {
          getTasks: () => tasks,
          getState: () => cacheState,
        },
      },
    },
    vault: {},
    workspace: {},
  };
  plugin.todayCacheGen = todayGen;
  plugin.laneWalkMemo = null;
  plugin.todayLocalDate = () => dateText;
  plugin.tasksCacheState = () => cacheState;
  plugin.isTodayCacheReady = () => todayReady;
  plugin.isTodayTask = today;
  plugin.freshnessEnsureMemo = () => gateMemo;
  plugin.freshnessReviewPredicate = () => review;
  return plugin;
}

test("membership: pending/next/ready in, exclusions counted, today dropped", () => {
  const keep = pendingTask({ path: "notes/a.md", lineNumber: 0 });
  const keepNext = nextTask({ path: "notes/a.md", lineNumber: 4 });
  const keepReady = task({ path: "notes/a.md", lineNumber: 8 });
  const tasks = [
    keep,
    keepNext,
    keepReady,
    task({
      status: { type: "DONE", name: "Done", symbol: "x" },
      path: "notes/a.md",
      lineNumber: 9,
    }),
    task({
      status: { type: "CANCELLED", name: "Cancelled", symbol: "-" },
      path: "notes/a.md",
      lineNumber: 16,
    }),
    task({
      status: { type: "NON_TASK", name: "Unknown", symbol: "?" },
      path: "notes/a.md",
      lineNumber: 17,
      originalMarkdown: "- [?] #task unknown",
    }),
    pendingTask({ tags: ["#task", "#hide"], path: "notes/a.md", lineNumber: 10 }),
    pendingTask({ path: "notes/a.md", lineNumber: 11, scheduledDate: "2026-10-29" }),
    pendingTask({ path: "_templates/a.md", lineNumber: 12 }),
    pendingTask({ path: "notes/x_conflicts.md", lineNumber: 13 }),
    pendingTask({ path: "dash.md", lineNumber: 14 }),
    pendingTask({
      path: "notes/a.md",
      lineNumber: 15,
      isBlocked: () => true,
    }),
    pendingTask({ path: "notes/today.md", lineNumber: 0 }),
    task({ tags: ["#task", "#hide"], path: "notes/a.md", lineNumber: 18 }),
    task({ path: "notes/a.md", lineNumber: 19, scheduledDate: "2026-10-29" }),
    task({ path: "_templates/ready.md", lineNumber: 20 }),
    task({ path: "notes/x_conflicts.md", lineNumber: 21 }),
    task({ path: "dash.md", lineNumber: 22 }),
    task({ path: "notes/a.md", lineNumber: 23, isBlocked: () => true }),
    task({ path: "notes/today-ready.md", lineNumber: 0 }),
  ];
  const todaySet = new Set(["notes/today.md:1", "notes/today-ready.md:1"]);
  const isToday = (t) => {
    const line = Number.isInteger(t.lineNumber) ? t.lineNumber + 1 : 1;
    return todaySet.has(`${t.path}:${line}`);
  };
  const { entries, counts } = laneWalkQueueFromTasks(tasks, DAY, isToday);
  assert.equal(entries.length, 3);
  assert.deepEqual(
    entries.map((entry) => entry.lane),
    ["pending", "next", "ready"],
  );
  assert.equal(counts.todayPending, 1);
  assert.equal(counts.todayNext, 0);
  assert.equal(counts.todayReady, 1);
  assert.equal(counts.reviewReady, 0);
  assert.equal(counts.pending, 1);
  assert.equal(counts.next, 1);
  assert.equal(counts.ready, 1);
  assert.equal(counts.total, 3);
  assert.ok(!entries.some((entry) => entry.path === "notes/today.md"));
  assert.ok(!entries.some((entry) => entry.path === "notes/today-ready.md"));
});

test("membership: review-bucket Ready tasks are excluded and counted as reviewReady", () => {
  const ready = task({ path: "notes/a.md", lineNumber: 0 });
  const review = task({ path: "notes/b.md", lineNumber: 0 });
  const { entries, counts } = laneWalkQueueFromTasks(
    [ready, review],
    DAY,
    () => false,
    { isReviewBucket: (t) => t.path === "notes/b.md" },
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].lane, "ready");
  assert.equal(entries[0].path, "notes/a.md");
  assert.equal(counts.ready, 1);
  assert.equal(counts.reviewReady, 1);
  assert.equal(counts.todayReady, 0);
});

test("parity: pending/next match the dash section; ready matches readyCountFromTasks", () => {
  const tasks = [
    pendingTask({ path: "b.md", lineNumber: 0 }),
    pendingTask({ path: "a.md", lineNumber: 4 }),
    nextTask({ path: "a.md", lineNumber: 1 }),
    nextTask({ path: "c.md", lineNumber: 2 }),
    task({ path: "a.md", lineNumber: 9 }),
    task({ path: "review.md", lineNumber: 0 }),
    task({ path: "today.md", lineNumber: 0 }),
  ];
  const isToday = (t) => t.path === "today.md" || t.path === "c.md";
  const isReview = (t) => t.path === "review.md";
  const caps = defaultPlanCaps();
  const gated = laneWalkQueueFromTasks(tasks, DAY, isToday, {
    isReviewBucket: isReview,
  });
  for (const lane of ["pending", "next"]) {
    const budget = dashboardLaneBudgetFromTasks(tasks, DAY, caps, lane, isToday);
    const laneEntries = gated.entries.filter((entry) => entry.lane === lane);
    assert.equal(laneEntries.length, budget.section);
  }
  assert.equal(
    gated.entries.filter((entry) => entry.lane === "ready").length,
    readyCountFromTasks(tasks, DAY, isToday, isReview),
  );

  const ungated = laneWalkQueueFromTasks(tasks, DAY, isToday);
  assert.equal(
    ungated.entries.filter((entry) => entry.lane === "ready").length,
    readyCountFromTasks(tasks, DAY, isToday),
  );

  let calls = 0;
  const throwing = (t) => {
    calls += 1;
    if (calls > 1) {
      throw new Error("gate boom");
    }
    return false;
  };
  const fallback = laneWalkQueueFromTasks(tasks, DAY, isToday, {
    isReviewBucket: throwing,
  });
  assert.equal(
    fallback.entries.filter((entry) => entry.lane === "ready").length,
    readyCountFromTasks(tasks, DAY, isToday, throwing),
  );
  assert.equal(fallback.counts.reviewReady, 0);
});

test("order: pending, then next, then ready, path then line inside each lane", () => {
  const tasks = [
    nextTask({ path: "b.md", lineNumber: 0 }),
    pendingTask({ path: "b.md", lineNumber: 2 }),
    nextTask({ path: "a.md", lineNumber: 5 }),
    pendingTask({ path: "a.md", lineNumber: 1 }),
    task({ path: "b.md", lineNumber: 8 }),
    task({ path: "a.md", lineNumber: 3 }),
  ];
  const { entries } = laneWalkQueueFromTasks(tasks, DAY, () => false);
  assert.deepEqual(
    entries.map((entry) => `${entry.lane}:${entry.path}:${entry.line}`),
    [
      "pending:a.md:2",
      "pending:b.md:3",
      "next:a.md:6",
      "next:b.md:1",
      "ready:a.md:4",
      "ready:b.md:9",
    ],
  );
});

test("ranks: rank/total plus per-lane laneRank/laneTotal", () => {
  const tasks = [
    pendingTask({ path: "a.md", lineNumber: 0 }),
    pendingTask({ path: "a.md", lineNumber: 1 }),
    nextTask({ path: "a.md", lineNumber: 2 }),
    task({ path: "a.md", lineNumber: 3 }),
    task({ path: "a.md", lineNumber: 4 }),
  ];
  const { entries } = laneWalkQueueFromTasks(tasks, DAY, () => false);
  assert.deepEqual(
    entries.map((entry) => [entry.rank, entry.total]),
    [
      [1, 5],
      [2, 5],
      [3, 5],
      [4, 5],
      [5, 5],
    ],
  );
  assert.deepEqual(
    entries.map((entry) => [entry.lane, entry.laneRank, entry.laneTotal]),
    [
      ["pending", 1, 2],
      ["pending", 2, 2],
      ["next", 1, 1],
      ["ready", 1, 2],
      ["ready", 2, 2],
    ],
  );
});

test("identity: keys match freshnessRowKey", () => {
  const pending = pendingTask({ path: "a.md", lineNumber: 3, blockLink: " ^abc" });
  const ready = task({ path: "a.md", lineNumber: 7, blockLink: " ^def" });
  const { entries } = laneWalkQueueFromTasks([pending, ready], DAY, () => false);
  assert.equal(entries.length, 2);
  for (const entry of entries) {
    assert.equal(entry.key, freshnessRowKey(entry));
  }
  assert.equal(entries[0].blockId, "abc");
  assert.equal(entries[1].blockId, "def");
  assert.equal(entries[1].lane, "ready");
});

test("unavailable: throwing isToday propagates to the caller", () => {
  assert.throws(() =>
    laneWalkQueueFromTasks([pendingTask()], DAY, () => {
      throw new Error("today boom");
    }),
  );
});

test("mixin: memo hits and invalidates; version 2; ready matches the chip", () => {
  const tasks = [
    pendingTask({ path: "a.md", lineNumber: 0 }),
    task({ path: "a.md", lineNumber: 2 }),
  ];
  const gateMemo = { tasksAvailable: true, identity: 1 };
  const plugin = makePlugin({
    tasks,
    gateMemo,
    review: () => false,
  });
  const first = plugin.apiLaneWalkQueue(DAY);
  assert.equal(first.available, true);
  assert.equal(plugin.laneWalkApi().version, 2);
  const second = plugin.apiLaneWalkQueue(DAY);
  assert.equal(second, first);

  const otherTasks = [task({ path: "b.md", lineNumber: 0 })];
  plugin.app.plugins.plugins["obsidian-tasks-plugin"].getTasks = () => otherTasks;
  const afterTasks = plugin.apiLaneWalkQueue(DAY);
  assert.notEqual(afterTasks, first);

  plugin.app.plugins.plugins["obsidian-tasks-plugin"].getTasks = () => tasks;
  plugin.laneWalkMemo = null;
  const baseline = plugin.apiLaneWalkQueue(DAY);
  plugin.todayLocalDate = () => "2026-10-29";
  const afterDate = plugin.apiLaneWalkQueue(DAY);
  assert.notEqual(afterDate, baseline);

  plugin.todayLocalDate = () => "2026-10-28";
  plugin.laneWalkMemo = null;
  const baselineGen = plugin.apiLaneWalkQueue(DAY);
  plugin.todayCacheGen = 2;
  const afterGen = plugin.apiLaneWalkQueue(DAY);
  assert.notEqual(afterGen, baselineGen);

  plugin.todayCacheGen = 1;
  plugin.laneWalkMemo = null;
  const baselineGate = plugin.apiLaneWalkQueue(DAY);
  plugin.freshnessEnsureMemo = () => ({ tasksAvailable: true, identity: 2 });
  const afterGate = plugin.apiLaneWalkQueue(DAY);
  assert.notEqual(afterGate, baselineGate);

  plugin.freshnessEnsureMemo = () => gateMemo;
  plugin.laneWalkMemo = null;
  const queue = plugin.apiLaneWalkQueue(DAY);
  const budget = plugin.readyBudget(DAY);
  assert.equal(queue.counts.ready, budget.count);
});

test("mixin: unavailable reasons for tasks, today, and error", () => {
  const pluginTasks = makePlugin({ tasks: null });
  pluginTasks.app = { plugins: { plugins: {} } };
  assert.equal(pluginTasks.apiLaneWalkQueue(DAY).reason, "tasks");

  const pluginCold = makePlugin({
    tasks: [pendingTask()],
    cacheState: "Cold",
  });
  assert.equal(pluginCold.apiLaneWalkQueue(DAY).reason, "tasks");

  const pluginToday = makePlugin({
    tasks: [pendingTask()],
    todayReady: false,
  });
  assert.equal(pluginToday.apiLaneWalkQueue(DAY).reason, "today");

  const pluginError = makePlugin({
    tasks: [pendingTask()],
    today: () => {
      throw new Error("today boom");
    },
  });
  assert.equal(pluginError.apiLaneWalkQueue(DAY).reason, "error");
});

test("shape: the result and its entries are frozen", () => {
  const { entries, counts } = laneWalkQueueFromTasks(
    [pendingTask(), task()],
    DAY,
    () => false,
  );
  assert.ok(Object.isFrozen(entries));
  assert.ok(Object.isFrozen(counts));
  assert.ok(Object.isFrozen(entries[0]));
  assert.equal(typeof counts.ready, "number");
  assert.equal(typeof counts.todayReady, "number");
  assert.equal(typeof counts.reviewReady, "number");
});
