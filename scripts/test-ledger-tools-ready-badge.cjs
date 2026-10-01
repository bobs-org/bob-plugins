// Focused READY backlog coverage for the shared daily/dashboard badge
// (`docs/plan.md` "READY backlog" is the authoritative definition).
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
  coercePlanCaps,
  defaultPlanCaps,
  effectivePlanCaps,
  planBlockModel,
  readyBadgeModel,
  readyBudgetFromTasks,
  readyCountFromTasks,
  readyTaskVisible,
} = helpers;

function readyTask(overrides = {}) {
  return {
    status: { type: "TODO", name: "Todo", symbol: " " },
    tags: ["#task"],
    path: "notes/a.md",
    isBlocked: () => false,
    ...overrides,
  };
}

function laneTask(overrides = {}) {
  return {
    status: { type: "TODO", name: "Todo", symbol: " " },
    tags: [],
    path: "notes/a.md",
    ...overrides,
  };
}

// --- Config ---------------------------------------------------------------

test("max_ready defaults to 100 for missing, absent, and null values", () => {
  assert.equal(defaultPlanCaps().maxReady, 100);
  assert.equal(effectivePlanCaps({}).maxReady, 100);
  assert.equal(effectivePlanCaps({ maxReady: null }).maxReady, 100);
  assert.equal(coercePlanCaps({}).caps.maxReady, 100);
  assert.equal(coercePlanCaps({ max_ready: null }).caps.maxReady, 100);
  assert.equal(coercePlanCaps({ maxReady: null }).caps.maxReady, 100);
});

test("max_ready accepts a custom positive cap", () => {
  assert.equal(coercePlanCaps({ max_ready: 42 }).caps.maxReady, 42);
  assert.equal(coercePlanCaps({ maxReady: 7 }).caps.maxReady, 7);
  assert.equal(effectivePlanCaps({ maxReady: 250 }).maxReady, 250);
});

test("max_ready rejects zero, negative, fractions, strings, booleans, and overflow", () => {
  for (const value of [0, -1, 1.5, "many", true, false, 4294967296, Number.MAX_SAFE_INTEGER]) {
    const { caps, invalid } = coercePlanCaps({ max_ready: value });
    assert.equal(invalid, true, `expected invalid for ${String(value)}`);
    assert.deepEqual(caps, defaultPlanCaps());
  }
  assert.equal(effectivePlanCaps({ maxReady: 0 }).maxReady, 100);
  assert.equal(effectivePlanCaps({ maxReady: -3 }).maxReady, 100);
  assert.equal(effectivePlanCaps({ maxReady: 2.5 }).maxReady, 100);
  assert.equal(effectivePlanCaps({ maxReady: "many" }).maxReady, 100);
  assert.equal(effectivePlanCaps({ maxReady: 4294967296 }).maxReady, 100);
});

test("old configurations and legacy max_now still load", () => {
  const { caps, invalid } = coercePlanCaps({ max_now: 20, maxNext: 7 });
  assert.equal(invalid, false);
  assert.equal(caps.maxNext, 7);
  assert.equal(caps.maxReady, 100);
  assert.deepEqual(coercePlanCaps({ max_now: 4 }).caps, defaultPlanCaps());
});

// --- Boundaries ------------------------------------------------------------

test("READY boundary: only a strict excess turns red", () => {
  const day = new Date(2026, 8, 30);
  const makeTasks = (count) =>
    Array.from({ length: count }, (_, index) =>
      readyTask({ path: `notes/ready-${index}.md` }),
    );
  for (const count of [0, 99, 100]) {
    const budget = readyBudgetFromTasks(makeTasks(count), day, undefined, () => false);
    assert.equal(budget.count, count);
    assert.equal(budget.cap, 100);
    assert.equal(budget.over, false);
  }
  const over = readyBudgetFromTasks(makeTasks(101), day, undefined, () => false);
  assert.equal(over.count, 101);
  assert.equal(over.over, true);
  const modelOk = readyBadgeModel({ count: 100, cap: 100, over: false });
  assert.equal(modelOk.text, "READY 100/100");
  assert.equal(modelOk.over, false);
  const modelOver = readyBadgeModel({ count: 101, cap: 100, over: true });
  assert.equal(modelOver.text, "READY 101/100");
  assert.equal(modelOver.over, true);
  assert.match(modelOver.tooltip, /1 over the limit/);
});

test("READY custom-cap boundary", () => {
  const day = new Date(2026, 8, 30);
  const makeTasks = (count) =>
    Array.from({ length: count }, (_, index) =>
      readyTask({ path: `notes/c-${index}.md` }),
    );
  const at = readyBudgetFromTasks(makeTasks(5), day, { maxReady: 5 }, () => false);
  assert.equal(at.over, false);
  const past = readyBudgetFromTasks(makeTasks(6), day, { maxReady: 5 }, () => false);
  assert.equal(past.over, true);
  assert.equal(past.cap, 5);
});

test("READY over is independent of the PLAN ledger status", () => {
  const model = planBlockModel({
    content: "## Pomodoros\n\n- [ ] () — ONE\n- [ ] () — TWO\n- [ ] () — THREE\n- [ ] () — FOUR\n",
    tasks: [readyTask({ path: "notes/a.md" })],
    today: new Date(2026, 8, 30),
    caps: defaultPlanCaps(),
    sourcePath: "2026/20260930.md",
    app: {},
    isToday: () => false,
  });
  assert.equal(model.budget.status, "over");
  assert.equal(model.readyText, "READY 1/100");
  assert.equal(model.over, true);
  const calm = planBlockModel({
    content: "## Pomodoros\n\n- [ ] () — GOALS\n",
    tasks: Array.from({ length: 101 }, (_, index) =>
      readyTask({ path: `notes/r-${index}.md` }),
    ),
    today: new Date(2026, 8, 30),
    caps: defaultPlanCaps(),
    sourcePath: "2026/20260930.md",
    app: {},
    isToday: () => false,
  });
  assert.equal(calm.budget.status, "ok");
  assert.equal(calm.readyText, "READY 101/100");
  assert.equal(calm.ready.over, true);
  // READY over never changes the PLAN status.
  assert.equal(calm.budget.status, "ok");
});

// --- Predicate --------------------------------------------------------------

test("READY predicate: statuses, custom TODO symbols, and non-tasks", () => {
  const day = new Date(2026, 8, 30);
  const tasks = [
    readyTask({ path: "notes/todo.md" }),
    readyTask({
      path: "notes/custom.md",
      status: { type: "TODO", name: "Custom todo", symbol: "?" },
    }),
    readyTask({
      path: "notes/next.md",
      status: { type: "ON_HOLD", name: "Next", symbol: "*" },
    }),
    readyTask({
      path: "notes/pending.md",
      status: { type: "IN_PROGRESS", name: "In Progress", symbol: "/" },
    }),
    readyTask({
      path: "notes/done.md",
      status: { type: "DONE", name: "Done", symbol: "x" },
    }),
    readyTask({
      path: "notes/cancelled.md",
      status: { type: "CANCELLED", name: "Canceled", symbol: "-" },
    }),
    readyTask({
      path: "notes/note.md",
      status: { type: "NON_TASK", name: "Note", symbol: "~" },
    }),
  ];
  assert.equal(readyCountFromTasks(tasks, day, () => false), 2);
});

test("READY predicate: blocked uses the full list, even outside the queue", () => {
  const day = new Date(2026, 8, 30);
  const blocker = readyTask({ path: "notes/blocker.md" });
  const blocked = readyTask({
    path: "notes/blocked.md",
    isBlocked: (all) => Array.isArray(all) && all.includes(blocker),
  });
  assert.equal(readyCountFromTasks([blocked, blocker], day, () => false), 1);
  const throwing = readyTask({
    path: "notes/throw.md",
    isBlocked: () => {
      throw new Error("blocked check failed");
    },
  });
  // A throwing blocked check degrades to unblocked (existing adapter), so the
  // task still counts here; the api layer treats a throwing isToday as
  // unavailable instead of partial.
  assert.equal(readyCountFromTasks([throwing], day, () => false), 1);
});

test("READY predicate: past, today, and future schedules", () => {
  const day = new Date(2026, 8, 30);
  const past = readyTask({ path: "notes/past.md", scheduledDate: new Date(2026, 8, 29) });
  const today = readyTask({ path: "notes/today.md", scheduledDate: new Date(2026, 8, 30) });
  const future = readyTask({ path: "notes/future.md", scheduledDate: new Date(2026, 9, 5) });
  const unscheduled = readyTask({ path: "notes/none.md" });
  assert.equal(readyCountFromTasks([past, today, future, unscheduled], day, () => false), 3);
});

test("READY predicate: dash self-exclusion, daily files, templates, conflicts, hide", () => {
  const day = new Date(2026, 8, 30);
  const tasks = [
    readyTask({ path: "dash.md" }),
    readyTask({ path: "2026/20260930.md" }),
    readyTask({ path: "notes/keep.md" }),
    readyTask({ path: "_templates/tpl.md" }),
    readyTask({ path: "notes/_conflicts/a.md" }),
    readyTask({ path: "notes/hidden.md", tags: ["#task", "#hide"] }),
    readyTask({ path: "notes/subtag.md", tags: ["#task", "#hide/x"] }),
    readyTask({ path: "notes/upper.md", tags: ["#task", "#Hide"] }),
  ];
  // dash.md, templates, _conflicts, and the exact #hide tag stay out. The
  // hide-subtag distinction is pinned here: `#hide/x` and `#Hide` count for
  // READY (dashboard semantics) even though the broader lane helper hides
  // them.
  assert.equal(readyCountFromTasks(tasks, day, () => false), 4);
});

test("READY predicate: Today exclusion", () => {
  const day = new Date(2026, 8, 30);
  const tasks = [
    readyTask({ path: "notes/a.md" }),
    readyTask({ path: "notes/b.md" }),
  ];
  const isToday = (task) => task.path === "notes/a.md";
  assert.equal(readyCountFromTasks(tasks, day, isToday), 1);
});

test("readyTaskVisible pins the hide-subtag distinction", () => {
  const day = new Date(2026, 8, 30).getFullYear() * 10000 + 9 * 100 + 30;
  assert.equal(readyTaskVisible(readyTask({ tags: ["#task", "#hide"] }), day), false);
  assert.equal(readyTaskVisible(readyTask({ tags: ["#task", "#hide/x"] }), day), true);
  assert.equal(readyTaskVisible(readyTask({ tags: ["#task", "#Hide"] }), day), true);
});

// --- Shared badge ------------------------------------------------------------

function stubHost() {
  const listeners = [];
  const el = {
    attrs: {},
    createEl: (tag, options = {}) => {
      const child = {
        tag,
        cls: options.cls,
        text: options.text,
        title: options.title,
        href: options.href,
        attrs: {},
        listeners: [],
        setAttribute: (name, value) => {
          child.attrs[name] = value;
        },
        hasAttribute: () => false,
        addEventListener: (name, handler) => {
          child.listeners.push(name);
        },
      };
      return child;
    },
    setAttribute: () => {},
  };
  return { el, listeners };
}

function makeApp(overrides = {}) {
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
      openLinkText: () => Promise.resolve(),
      trigger: () => {},
    },
    metadataCache: { on: () => ({}) },
    plugins: { plugins: {} },
    ...overrides,
  };
}

test("daily and dashboard share the READY element contract", () => {
  const day = new Date(2026, 8, 30);
  const tasks = [readyTask({ path: "notes/a.md" })];
  const model = planBlockModel({
    content: "## Pomodoros\n\n- [ ] () — GOALS\n",
    tasks,
    today: day,
    caps: defaultPlanCaps(),
    sourcePath: "2026/20260930.md",
    app: {},
    isToday: () => false,
  });
  assert.equal(model.readyText, "READY 1/100");
  assert.equal(model.readyModel.text, "READY 1/100");
  assert.match(model.readyModel.tooltip, /1 ready tasks; limit 100/);
  assert.match(model.readyModel.tooltip, /excluding Today/);
  assert.match(model.readyModel.tooltip, /Open READY Tasks in dash/);

  const app = makeApp({
    plugins: {
      plugins: {
        "obsidian-tasks-plugin": {
          getTasks: () => tasks,
          getState: () => "Warm",
        },
      },
    },
  });
  const plugin = new LedgerToolsPlugin(app, {});
  const savedXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = "/definitely/missing/ready-badge-test";
  try {
    plugin.onload();
    plugin.rebuildTodayCache("## Pomodoros\n", plugin.currentTodayDailyPath(day) || "2026/20260930.md", day);
    const budget = plugin.readyBudget(day);
    assert.equal(budget.count, 1);
    const host = stubHost().el;
    const anchor = plugin.paintReadyElement(host, budget, { sourcePath: "2026/20260930.md" });
    assert.ok(anchor);
    assert.match(anchor.cls, /bob-plan-chip/);
    assert.match(anchor.cls, /bob-plan-ready/);
    assert.equal(anchor.text, model.readyModel.text);
    assert.equal(anchor.title, model.readyModel.tooltip);
    assert.equal(anchor.href, "dash#READY Tasks");
    assert.ok(anchor.listeners.includes("click"));
    assert.ok(anchor.listeners.includes("keydown"));
    assert.ok(anchor.listeners.includes("mouseover"));
    plugin.onunload();
  } finally {
    if (savedXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = savedXdg;
    }
  }
});

test("READY placeholder keeps the limit in its tooltip", () => {
  const model = readyBadgeModel({ count: null, cap: 100, over: false });
  assert.equal(model.text, "READY –");
  assert.equal(model.placeholder, true);
  assert.equal(model.over, false);
  assert.match(model.tooltip, /limit 100/);
  const custom = readyBadgeModel({ count: null, cap: 7, over: false });
  assert.match(custom.tooltip, /limit 7/);
});

test("READY keyboard and modifier-key navigation", () => {
  const app = makeApp({
    workspace: {
      on: () => ({}),
      offref: () => {},
      onLayoutReady: () => {},
      getActiveFile: () => null,
      openLinkText: () => Promise.resolve(),
      trigger: () => {},
    },
    plugins: { plugins: {} },
    metadataCache: { on: () => ({}) },
  });
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.onload();
  const opened = [];
  plugin.app.workspace.openLinkText = (target, source, newLeaf) => {
    opened.push({ target, source, newLeaf });
    return Promise.resolve();
  };
  const host = {
    createEl: (tag, options = {}) => {
      const handlers = {};
      const child = {
        ...options,
        handlers,
        setAttribute: () => {},
        hasAttribute: () => true,
        addEventListener: (name, handler) => {
          handlers[name] = handlers[name] || [];
          handlers[name].push(handler);
        },
      };
      host.last = child;
      return child;
    },
  };
  const anchor = plugin.paintReadyElement(host, { count: 3, cap: 100, over: false }, { sourcePath: "2026/20260930.md" });
  assert.ok(anchor);
  const click = host.last.handlers.click[0];
  click({ preventDefault: () => {}, ctrlKey: true, metaKey: false });
  assert.equal(opened[0].target, "dash#READY Tasks");
  assert.equal(opened[0].newLeaf, true);
  assert.equal(opened[0].source, "2026/20260930.md");
  const key = host.last.handlers.keydown[0];
  key({ key: "Enter", preventDefault: () => {}, ctrlKey: false, metaKey: true });
  assert.equal(opened[1].newLeaf, true);
  plugin.onunload();
});

// --- Availability ------------------------------------------------------------

test("READY unavailable without Tasks, on Cold/Initializing, or before Today", () => {
  const day = new Date(2026, 8, 30);
  const tasks = [readyTask({ path: "notes/a.md" })];
  const base = {
    vault: {
      getAbstractFileByPath: (path) => (path ? { path } : null),
      cachedRead: () => Promise.resolve("## Pomodoros\n"),
    },
    workspace: {
      on: () => ({}),
      offref: () => {},
      onLayoutReady: () => {},
      getActiveFile: () => null,
    },
    metadataCache: { on: () => ({}) },
  };
  const savedXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = "/definitely/missing/ready-badge-test";
  try {
    for (const tasksPlugin of [
      undefined,
      { getTasks: () => { throw new Error("no tasks"); } },
      { getTasks: () => tasks, getState: () => "Cold" },
      { getTasks: () => tasks, getState: () => "Initializing" },
    ]) {
      const app = makeApp({
        ...base,
        plugins: { plugins: tasksPlugin ? { "obsidian-tasks-plugin": tasksPlugin } : {} },
      });
      const plugin = new LedgerToolsPlugin(app, {});
      plugin.onload();
      const budget = plugin.readyBudget(day);
      assert.equal(budget.count, null);
      assert.equal(budget.over, false);
      plugin.onunload();
    }
    const warm = makeApp({
      ...base,
      plugins: {
        plugins: {
          "obsidian-tasks-plugin": { getTasks: () => tasks, getState: () => "Warm" },
        },
      },
    });
    const plugin = new LedgerToolsPlugin(warm, {});
    plugin.onload();
    // Before the initial current-day Today build, the count stays unavailable.
    assert.equal(plugin.readyBudget(day).count, null);
    plugin.onunload();
  } finally {
    if (savedXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = savedXdg;
    }
  }
});

test("READY counts a valid empty queue as zero, not unavailable", () => {
  const day = new Date(2026, 8, 30);
  const app = makeApp({
    plugins: {
      plugins: {
        "obsidian-tasks-plugin": { getTasks: () => [], getState: () => "Warm" },
      },
    },
  });
  const savedXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = "/definitely/missing/ready-badge-test";
  try {
    const plugin = new LedgerToolsPlugin(app, {});
    plugin.onload();
    plugin.rebuildTodayCache("## Pomodoros\n", plugin.currentTodayDailyPath(day) || "2026/20260930.md", day);
    const budget = plugin.readyBudget(day);
    assert.equal(budget.count, 0);
    assert.equal(budget.over, false);
    plugin.onunload();
  } finally {
    if (savedXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = savedXdg;
    }
  }
});

test("READY stays compatible with hosts exposing only getTasks()", () => {
  const day = new Date(2026, 8, 30);
  const tasks = [readyTask({ path: "notes/a.md" })];
  const app = makeApp({
    plugins: {
      plugins: { "obsidian-tasks-plugin": { getTasks: () => tasks } },
    },
  });
  const savedXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = "/definitely/missing/ready-badge-test";
  try {
    const plugin = new LedgerToolsPlugin(app, {});
    plugin.onload();
    plugin.rebuildTodayCache("## Pomodoros\n", plugin.currentTodayDailyPath(day) || "2026/20260930.md", day);
    assert.equal(plugin.readyBudget(day).count, 1);
    plugin.onunload();
  } finally {
    if (savedXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = savedXdg;
    }
  }
});

test("READY degrades to unavailable when the Today predicate throws", () => {
  const day = new Date(2026, 8, 30);
  assert.throws(() =>
    readyCountFromTasks([readyTask({ path: "notes/a.md" })], day, () => {
      throw new Error("today failed");
    }),
  );
  const model = planBlockModel({
    content: "## Pomodoros\n\n- [ ] () — GOALS\n",
    tasks: [readyTask({ path: "notes/a.md" })],
    today: day,
    caps: defaultPlanCaps(),
    isToday: () => {
      throw new Error("today failed");
    },
  });
  assert.equal(model.ready, null);
  assert.equal(model.readyText, "READY –");
});
