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

function stubSpan(options = {}, parent = null) {
  const span = {
    tag: "span",
    cls: options.cls,
    text: options.text,
    title: options.title,
    href: options.href,
    attrs: {},
    listeners: [],
    handlers: {},
    parentNode: parent,
    setAttribute: (name, value) => {
      span.attrs[name] = value;
    },
    hasAttribute: () => false,
    setText: (value) => {
      span.text = String(value);
    },
    addEventListener: (name, handler) => {
      span.listeners.push(name);
      span.handlers[name] = span.handlers[name] || [];
      span.handlers[name].push(handler);
    },
    remove: () => {
      if (parent && Array.isArray(parent.children)) {
        const at = parent.children.indexOf(span);
        if (at !== -1) {
          parent.children.splice(at, 1);
        }
      }
    },
  };
  return span;
}

function stubAnchor(options = {}) {
  const anchor = {
    tag: "a",
    cls: options.cls,
    text: options.text,
    title: options.title,
    href: options.href,
    attrs: {},
    listeners: [],
    handlers: {},
    children: [],
    parentNode: null,
    isConnected: true,
    createEl: (tag, childOptions = {}) => {
      const span = stubSpan(childOptions, anchor);
      anchor.children.push(span);
      return span;
    },
    querySelector: (selector) => {
      const cls = String(selector).replace(/^\./, "");
      return (
        anchor.children.find((child) =>
          String(child.cls || "")
            .split(/\s+/)
            .includes(cls),
        ) || null
      );
    },
    querySelectorAll: (selector) => {
      const cls = String(selector).replace(/^\./, "");
      return anchor.children.filter((child) =>
        String(child.cls || "")
          .split(/\s+/)
          .includes(cls),
      );
    },
    setAttribute: (name, value) => {
      anchor.attrs[name] = value;
    },
    hasAttribute: () => false,
    setText: (value) => {
      anchor.text = String(value);
    },
    addEventListener: (name, handler) => {
      anchor.listeners.push(name);
      anchor.handlers[name] = anchor.handlers[name] || [];
      anchor.handlers[name].push(handler);
    },
    removeChild: (child) => {
      const at = anchor.children.indexOf(child);
      if (at !== -1) {
        anchor.children.splice(at, 1);
      }
    },
    remove: () => {
      if (anchor.parentNode && Array.isArray(anchor.parentNode.children)) {
        const at = anchor.parentNode.children.indexOf(anchor);
        if (at !== -1) {
          anchor.parentNode.children.splice(at, 1);
        }
      }
    },
  };
  return anchor;
}

function stubHost() {
  const listeners = [];
  const el = {
    attrs: {},
    children: [],
    createEl: (tag, options = {}) => {
      const child = stubAnchor(options);
      child.parentNode = el;
      el.children.push(child);
      return child;
    },
    setAttribute: () => {},
    contains: (node) => node && node.parentNode === el,
  };
  return { el, listeners };
}

function readyChildTexts(anchor) {
  const label = anchor.querySelector(".bob-plan-ready-label");
  const value = anchor.querySelector(".bob-plan-ready-value");
  return {
    label: label ? label.text : null,
    value: value ? value.text : null,
    labelCount: anchor.querySelectorAll(".bob-plan-ready-label").length,
    valueCount: anchor.querySelectorAll(".bob-plan-ready-value").length,
  };
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
  // A same-day confirmation keeps the fixture in gated READY: an
  // unstamped task would sit in NEW review instead.
  const tasks = [
    readyTask({
      path: "notes/a.md",
      description: "- [ ] #task Do it [fresh:: 2026-09-30]",
      originalMarkdown: "- [ ] #task Do it [fresh:: 2026-09-30]",
    }),
  ];
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
    // Structured content: separate label and value spans, no flattened text.
    const shown = readyChildTexts(anchor);
    assert.equal(shown.labelCount, 1);
    assert.equal(shown.valueCount, 1);
    assert.equal(shown.label, "READY");
    assert.equal(shown.value, "1/100");
    assert.ok(anchor.text === undefined || anchor.text === "");
    // The live badge gates READY and carries total lane pressure,
    // while the bare model above keeps the legacy tooltip.
    assert.equal(
      anchor.title,
      "READY 1/100 · lane 1 = 0 new + 0 rotten + 1 ready",
    );
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
    last: null,
    createEl: (tag, options = {}) => {
      const child = stubAnchor(options);
      child.hasAttribute = () => true;
      host.last = child;
      return child;
    },
  };
  const anchor = plugin.paintReadyElement(host, { count: 3, cap: 100, over: false }, { sourcePath: "2026/20260930.md" });
  assert.ok(anchor);
  const shown = readyChildTexts(anchor);
  assert.equal(shown.label, "READY");
  assert.equal(shown.value, "3/100");
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
  const tasks = [
    readyTask({
      path: "notes/a.md",
      description: "- [ ] #task Do it [fresh:: 2026-09-30]",
      originalMarkdown: "- [ ] #task Do it [fresh:: 2026-09-30]",
    }),
  ];
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

// --- Live refresh ----------------------------------------------------------

function paintOnParent(plugin, parent, budget) {
  const anchor = plugin.paintReadyElement(parent, budget, {
    sourcePath: "dash.md",
  });
  assert.ok(anchor);
  return anchor;
}

function refreshWith(plugin, anchor, parent, budget) {
  plugin.readyWidgets = new Set([
    { el: anchor, sourcePath: "dash.md", component: null },
  ]);
  const stubBudget = plugin.readyBudget;
  plugin.readyBudget = () => budget;
  try {
    assert.equal(plugin.refreshReadyBadges(new Date(2026, 8, 30)), true);
  } finally {
    if (stubBudget === undefined) {
      delete plugin.readyBudget;
    } else {
      plugin.readyBudget = stubBudget;
    }
  }
}

test("READY renders label/value spans for every budget state", () => {
  const plugin = new LedgerToolsPlugin(makeApp(), {});
  plugin.onload();
  try {
    const cases = [
      [{ count: 0, cap: 100, over: false }, "0/100", false],
      [{ count: 42, cap: 100, over: false }, "42/100", false],
      [{ count: 100, cap: 100, over: false }, "100/100", false],
      [{ count: 101, cap: 100, over: true }, "101/100", true],
      [{ count: null, cap: 100, over: false }, "–", false],
      [{ count: null, cap: 7, over: false }, "–", false],
    ];
    for (const [budget, value, over] of cases) {
      const parent = stubHost().el;
      const anchor = paintOnParent(plugin, parent, budget);
      const shown = readyChildTexts(anchor);
      assert.equal(shown.labelCount, 1, `label count for ${value}`);
      assert.equal(shown.valueCount, 1, `value count for ${value}`);
      assert.equal(shown.label, "READY");
      assert.equal(shown.value, value);
      assert.equal(anchor.cls.includes("bob-plan-over"), over);
      assert.equal(
        anchor.cls.includes("bob-plan-unavailable"),
        budget.count === null,
      );
    }
  } finally {
    plugin.onunload();
  }
});

test("READY live refresh keeps the anchor, spans, and handlers", () => {
  const plugin = new LedgerToolsPlugin(makeApp(), {});
  plugin.onload();
  try {
    const parent = stubHost().el;
    const anchor = paintOnParent(plugin, parent, {
      count: 3,
      cap: 100,
      over: false,
    });
    const before = readyChildTexts(anchor);
    assert.equal(before.value, "3/100");
    const listenersBefore = anchor.listeners.length;
    const handlersBefore = Object.values(anchor.handlers).map(
      (list) => list.length,
    );

    refreshWith(plugin, anchor, parent, { count: 4, cap: 100, over: false });

    // Same anchor object: listeners and widget registration survive.
    assert.equal(plugin.readyWidgets.size, 1);
    const [widget] = Array.from(plugin.readyWidgets);
    assert.equal(widget.el, anchor);
    const after = readyChildTexts(anchor);
    assert.equal(after.labelCount, 1);
    assert.equal(after.valueCount, 1);
    assert.equal(after.label, "READY");
    assert.equal(after.value, "4/100");
    assert.ok(anchor.text === undefined || anchor.text === "");
    assert.equal(anchor.listeners.length, listenersBefore);
    assert.deepEqual(
      Object.values(anchor.handlers).map((list) => list.length),
      handlersBefore,
    );

    // Repeated refreshes never accumulate spans.
    refreshWith(plugin, anchor, parent, { count: 5, cap: 100, over: false });
    refreshWith(plugin, anchor, parent, { count: 5, cap: 100, over: false });
    const repeated = readyChildTexts(anchor);
    assert.equal(repeated.labelCount, 1);
    assert.equal(repeated.valueCount, 1);
    assert.equal(repeated.value, "5/100");
    assert.equal(anchor.children.length, 2);
  } finally {
    plugin.onunload();
  }
});

test("READY refresh crosses the over-cap boundary and back", () => {
  const plugin = new LedgerToolsPlugin(makeApp(), {});
  plugin.onload();
  try {
    const parent = stubHost().el;
    const anchor = paintOnParent(plugin, parent, {
      count: 100,
      cap: 100,
      over: false,
    });
    assert.equal(anchor.cls.includes("bob-plan-over"), false);

    refreshWith(plugin, anchor, parent, {
      count: 101,
      cap: 100,
      over: true,
    });
    const over = readyChildTexts(anchor);
    assert.equal(over.value, "101/100");
    assert.equal(anchor.cls.includes("bob-plan-over"), true);
    assert.match(anchor.attrs["aria-label"], /101 of 100/);
    assert.match(anchor.attrs["aria-label"], /over the limit/);
    assert.match(anchor.attrs.title, /1 over the limit/);

    refreshWith(plugin, anchor, parent, {
      count: 99,
      cap: 100,
      over: false,
    });
    const back = readyChildTexts(anchor);
    assert.equal(back.labelCount, 1);
    assert.equal(back.valueCount, 1);
    assert.equal(back.value, "99/100");
    assert.equal(anchor.cls.includes("bob-plan-over"), false);
  } finally {
    plugin.onunload();
  }
});

test("READY refresh crosses the unavailable boundary and back", () => {
  const plugin = new LedgerToolsPlugin(makeApp(), {});
  plugin.onload();
  try {
    const parent = stubHost().el;
    const anchor = paintOnParent(plugin, parent, {
      count: 2,
      cap: 100,
      over: false,
    });
    assert.equal(readyChildTexts(anchor).value, "2/100");

    refreshWith(plugin, anchor, parent, {
      count: null,
      cap: 100,
      over: false,
    });
    const off = readyChildTexts(anchor);
    assert.equal(off.labelCount, 1);
    assert.equal(off.valueCount, 1);
    assert.equal(off.label, "READY");
    assert.equal(off.value, "–");
    assert.equal(anchor.cls.includes("bob-plan-unavailable"), true);
    assert.match(anchor.attrs["aria-label"], /unavailable/);

    refreshWith(plugin, anchor, parent, {
      count: 2,
      cap: 100,
      over: false,
    });
    const on = readyChildTexts(anchor);
    assert.equal(on.labelCount, 1);
    assert.equal(on.valueCount, 1);
    assert.equal(on.value, "2/100");
    assert.equal(anchor.cls.includes("bob-plan-unavailable"), false);
  } finally {
    plugin.onunload();
  }
});

test("READY never assigns the Obsidian text setter", () => {
  function obsidianSpan(options = {}, parent = null) {
    const span = {
      tag: "span",
      cls: options.cls,
      text: options.text,
      attrs: {},
      parentNode: parent,
      setAttribute(name, value) {
        span.attrs[name] = value;
      },
      setText(value) {
        span.text = String(value);
      },
      remove() {
        if (parent && Array.isArray(parent.children)) {
          const at = parent.children.indexOf(span);
          if (at !== -1) {
            parent.children.splice(at, 1);
          }
        }
      },
    };
    return span;
  }

  function obsidianAnchor(parent, options = {}) {
    const anchor = {
      tag: "a",
      cls: options.cls || "",
      title: options.title || "",
      href: options.href || "",
      attrs: {},
      listeners: [],
      handlers: {},
      children: [],
      parentNode: parent || null,
      isConnected: true,
      assignedTexts: [],
      createEl(tag, childOptions = {}) {
        const span = obsidianSpan(childOptions, anchor);
        anchor.children.push(span);
        return span;
      },
      querySelector(selector) {
        const cls = String(selector).replace(/^\./, "");
        return (
          anchor.children.find((child) =>
            String(child.cls || "")
              .split(/\s+/)
              .includes(cls),
          ) || null
        );
      },
      querySelectorAll(selector) {
        const cls = String(selector).replace(/^\./, "");
        return anchor.children.filter((child) =>
          String(child.cls || "")
            .split(/\s+/)
            .includes(cls),
        );
      },
      setAttribute(name, value) {
        anchor.attrs[name] = value;
      },
      hasAttribute() {
        return false;
      },
      setText(value) {
        anchor.assignedTexts.push(String(value));
        anchor.children.splice(0, anchor.children.length);
      },
      addEventListener(name, handler) {
        anchor.listeners.push(name);
        anchor.handlers[name] = anchor.handlers[name] || [];
        anchor.handlers[name].push(handler);
      },
      removeChild(child) {
        const at = anchor.children.indexOf(child);
        if (at !== -1) {
          anchor.children.splice(at, 1);
        }
        return child;
      },
      remove() {},
    };
    anchor.childNodes = anchor.children;
    // Mimic Obsidian's HTMLElement.text setter: assigning deletes children.
    Object.defineProperty(anchor, "text", {
      configurable: true,
      enumerable: true,
      get() {
        return "";
      },
      set(value) {
        anchor.assignedTexts.push(String(value));
        anchor.children.splice(0, anchor.children.length);
      },
    });
    return anchor;
  }

  function obsidianHost() {
    const el = {
      attrs: {},
      children: [],
      createEl(tag, options = {}) {
        const anchor = obsidianAnchor(el, options);
        anchor.parentNode = el;
        el.children.push(anchor);
        return anchor;
      },
      setAttribute() {},
      contains(node) {
        return Boolean(node) && node.parentNode === el;
      },
    };
    return el;
  }

  const plugin = new LedgerToolsPlugin(makeApp(), {});
  plugin.onload();
  try {
    for (const budget of [
      { count: 3, cap: 100, over: false, value: "3/100" },
      { count: 101, cap: 100, over: true, value: "101/100" },
    ]) {
      const parent = obsidianHost();
      const anchor = plugin.paintReadyElement(parent, budget, {
        sourcePath: "dash.md",
      });
      assert.ok(anchor);
      assert.deepEqual(anchor.assignedTexts, []);
      const painted = readyChildTexts(anchor);
      assert.equal(painted.labelCount, 1);
      assert.equal(painted.valueCount, 1);
      assert.equal(painted.label, "READY");
      assert.equal(painted.value, budget.value);

      plugin.readyWidgets = new Set([
        { el: anchor, sourcePath: "dash.md", component: null },
      ]);
      const stubBudget = plugin.readyBudget;
      plugin.readyBudget = () => budget;
      try {
        assert.equal(plugin.refreshReadyBadges(new Date(2026, 8, 30)), true);
      } finally {
        plugin.readyBudget = stubBudget;
      }
      assert.equal(plugin.readyWidgets.size, 1);
      const [widget] = Array.from(plugin.readyWidgets);
      assert.equal(widget.el, anchor);
      assert.deepEqual(anchor.assignedTexts, []);
      const refreshed = readyChildTexts(anchor);
      assert.equal(refreshed.labelCount, 1);
      assert.equal(refreshed.valueCount, 1);
      assert.equal(refreshed.label, "READY");
      assert.equal(refreshed.value, budget.value);
    }
  } finally {
    plugin.onunload();
  }
});

test("READY gating excludes review buckets and keeps the partition", () => {
  const day = new Date(2026, 8, 30);
  const tasks = [
    readyTask({ path: "notes/new-a.md" }),
    readyTask({ path: "notes/new-b.md" }),
    readyTask({ path: "notes/rotten-a.md" }),
    readyTask({ path: "notes/ready-a.md" }),
    readyTask({ path: "notes/ready-b.md" }),
  ];
  const isReview = (task) =>
    task.path === "notes/new-a.md" ||
    task.path === "notes/new-b.md" ||
    task.path === "notes/rotten-a.md";
  const ungated = readyCountFromTasks(tasks, day, () => false);
  assert.equal(ungated, 5);
  const gated = readyCountFromTasks(tasks, day, () => false, isReview);
  assert.equal(gated, 2);
  // B = NEW ∪ ROTTEN ∪ READY, pairwise disjoint: the gated count plus
  // the flagged buckets reconstruct the visible pool.
  assert.equal(gated + tasks.filter(isReview).length, ungated);
  // A missing predicate keeps the legacy count.
  assert.equal(
    readyCountFromTasks(tasks, day, () => false, null),
    ungated,
  );
  // A throwing predicate discards the partial gated count and
  // recomputes the legacy count instead of leaving a partial badge.
  let calls = 0;
  const throwing = () => {
    calls += 1;
    if (calls > 1) {
      throw new Error("bucket lookup blew up");
    }
    return true;
  };
  assert.equal(
    readyCountFromTasks(tasks, day, () => false, throwing),
    ungated,
  );
  // A throwing Today predicate still degrades to unavailable, not legacy.
  assert.throws(() =>
    readyCountFromTasks(
      tasks,
      day,
      () => {
        throw new Error("today blew up");
      },
      isReview,
    ),
  );
});

test("gated READY tooltip carries total lane pressure", () => {
  const model = readyBadgeModel(
    { count: 120, cap: 100, over: true },
    { lane: { total: 210, new: 3, rotten: 87, ready: 120 } },
  );
  assert.equal(model.text, "READY 120/100");
  assert.equal(
    model.tooltip,
    "READY 120/100 · lane 210 = 3 new + 87 rotten + 120 ready · 20 over the limit",
  );
  // Without a lane breakdown the legacy tooltip stays byte-identical.
  const legacy = readyBadgeModel({ count: 1, cap: 100, over: false }, {});
  assert.match(legacy.tooltip, /1 ready tasks; limit 100/);
  assert.match(legacy.tooltip, /excluding Today/);
});

test("planBlockModel gates READY and shares the lane tooltip", () => {
  const day = new Date(2026, 8, 30);
  const tasks = [
    readyTask({ path: "notes/new-a.md" }),
    readyTask({ path: "notes/rotten-a.md" }),
    readyTask({ path: "notes/ready-a.md" }),
    readyTask({ path: "notes/ready-b.md" }),
  ];
  const isReview = (task) =>
    task.path !== "notes/ready-a.md" && task.path !== "notes/ready-b.md";
  const gated = planBlockModel({
    content: "",
    tasks,
    today: day,
    caps: {},
    sourcePath: "notes/daily.md",
    app: null,
    isToday: () => false,
    isReviewBucket: isReview,
    review: { new: 1, rotten: 1 },
  });
  assert.equal(gated.readyText, "READY 2/100");
  assert.match(
    gated.readyModel.tooltip,
    /READY 2\/100 · lane 4 = 1 new \+ 1 rotten \+ 2 ready/,
  );
  const legacy = planBlockModel({
    content: "",
    tasks,
    today: day,
    caps: {},
    sourcePath: "notes/daily.md",
    app: null,
    isToday: () => false,
  });
  assert.equal(legacy.readyText, "READY 4/100");
  assert.match(legacy.readyModel.tooltip, /4 ready tasks; limit 100/);
});
