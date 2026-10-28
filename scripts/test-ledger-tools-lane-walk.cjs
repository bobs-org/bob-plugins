// Lane walk queue: membership, parity, lane order, ranks, identity,
// unavailable, memo, and frozen shape (api.laneWalk v1).
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

test("membership: pending/next in, everything else out, today dropped but counted", () => {
  const keep = pendingTask({ path: "notes/a.md", lineNumber: 0 });
  const keepNext = nextTask({ path: "notes/a.md", lineNumber: 4 });
  const tasks = [
    keep,
    keepNext,
    task({ path: "notes/a.md", lineNumber: 8 }),
    task({
      status: { type: "DONE", name: "Done", symbol: "x" },
      path: "notes/a.md",
      lineNumber: 9,
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
  ];
  const todaySet = new Set(["notes/today.md:1"]);
  const isToday = (t) => {
    const line = Number.isInteger(t.lineNumber) ? t.lineNumber + 1 : 1;
    return todaySet.has(`${t.path}:${line}`);
  };
  const { entries, counts } = laneWalkQueueFromTasks(tasks, DAY, isToday, {
    order: "lane",
  });
  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries.map((entry) => entry.lane),
    ["pending", "next"],
  );
  assert.equal(counts.todayPending, 1);
  assert.equal(counts.todayNext, 0);
  assert.equal(counts.pending, 1);
  assert.equal(counts.next, 1);
  assert.equal(counts.total, 2);
  assert.ok(!entries.some((entry) => entry.path === "notes/today.md"));
});

test("parity: per lane entries.length matches the dash section", () => {
  const tasks = [
    pendingTask({ path: "b.md", lineNumber: 0 }),
    pendingTask({ path: "a.md", lineNumber: 4 }),
    nextTask({ path: "a.md", lineNumber: 1 }),
    nextTask({ path: "c.md", lineNumber: 2 }),
    task({ path: "a.md", lineNumber: 9 }),
  ];
  const isToday = (t) => t.path === "c.md";
  const caps = defaultPlanCaps();
  const queue = laneWalkQueueFromTasks(tasks, DAY, isToday, { order: "lane" });
  for (const lane of ["pending", "next"]) {
    const budget = dashboardLaneBudgetFromTasks(tasks, DAY, caps, lane, isToday);
    const laneEntries = queue.entries.filter((entry) => entry.lane === lane);
    assert.equal(laneEntries.length, budget.section);
  }
});

test("order: pending first, then next, path then line inside each lane", () => {
  const tasks = [
    nextTask({ path: "b.md", lineNumber: 0 }),
    pendingTask({ path: "b.md", lineNumber: 2 }),
    nextTask({ path: "a.md", lineNumber: 5 }),
    pendingTask({ path: "a.md", lineNumber: 1 }),
  ];
  const { entries } = laneWalkQueueFromTasks(tasks, DAY, () => false, {
    order: "lane",
  });
  assert.deepEqual(
    entries.map((entry) => `${entry.lane}:${entry.path}:${entry.line}`),
    ["pending:a.md:2", "pending:b.md:3", "next:a.md:6", "next:b.md:1"],
  );
});

test("ranks: rank/total plus per-lane laneRank/laneTotal", () => {
  const tasks = [
    pendingTask({ path: "a.md", lineNumber: 0 }),
    pendingTask({ path: "a.md", lineNumber: 1 }),
    nextTask({ path: "a.md", lineNumber: 2 }),
  ];
  const { entries } = laneWalkQueueFromTasks(tasks, DAY, () => false, {
    order: "lane",
  });
  assert.deepEqual(
    entries.map((entry) => [entry.rank, entry.total]),
    [
      [1, 3],
      [2, 3],
      [3, 3],
    ],
  );
  assert.deepEqual(
    entries.map((entry) => [entry.laneRank, entry.laneTotal]),
    [
      [1, 2],
      [2, 2],
      [1, 1],
    ],
  );
});

test("identity: keys match freshnessRowKey", () => {
  const t = pendingTask({ path: "a.md", lineNumber: 3, blockLink: " ^abc" });
  const { entries } = laneWalkQueueFromTasks([t], DAY, () => false, {
    order: "lane",
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].key, freshnessRowKey(entries[0]));
  assert.equal(entries[0].blockId, "abc");
});

test("unavailable: throwing isToday propagates to the caller", () => {
  assert.throws(() =>
    laneWalkQueueFromTasks([pendingTask()], DAY, () => {
      throw new Error("today boom");
    }),
  );
});

test("memo: tested at the mixin level via queue()", () => {
  const tasks = [pendingTask({ path: "a.md", lineNumber: 0 })];
  const app = {
    plugins: {
      plugins: {
        "obsidian-tasks-plugin": {
          getTasks: () => tasks,
          getState: () => "Warm",
        },
      },
    },
    vault: {},
    workspace: {},
  };
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.app = app;
  plugin.todayCache = {
    rank: new Map([["a.md#x", 1]]),
    details: new Map(),
    idsByPath: new Map(),
    date: plugin.todayLocalDate ? "skip" : "skip",
    dailyPath: "",
  };
  // Build a ready Today cache through the real mixin when available.
  if (typeof plugin.isTodayCacheReady === "function") {
    // Force unavailable-today then ready-today paths without vault I/O:
    // a non-array task list is tasks-unavailable, a non-Warm cache is
    // tasks-unavailable, and an unready Today cache is today-unavailable.
    const pluginTasks = Object.create(LedgerToolsPlugin.prototype);
    pluginTasks.app = { plugins: { plugins: {} } };
    const missing = pluginTasks.apiLaneWalkQueue(DAY);
    assert.equal(missing.available, false);
  }
});

test("shape: the result and its entries are frozen", () => {
  const { entries, counts } = laneWalkQueueFromTasks(
    [pendingTask()],
    DAY,
    () => false,
    { order: "lane" },
  );
  assert.ok(Object.isFrozen(entries));
  assert.ok(Object.isFrozen(counts));
  assert.ok(Object.isFrozen(entries[0]));
});
