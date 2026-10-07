// Tests for the compact persistent review footer and shared
// `freshnessReviewEntryView` presentation (freshness namespace v7).
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
  freshnessFooterGroups,
  freshnessFooterPaint,
  freshnessFooterView,
  freshnessMatchQueueCursor,
  freshnessQueue,
  freshnessReviewEntryView,
  freshnessTierFooterLabel,
} = helpers;

const D = "2026-10-08";
const CFG = {
  interval: 7,
  intervalFromConfig: false,
  pendingInterval: 1,
  nextInterval: 1,
  rottenDailyBudget: null,
};

function sRow(overrides = {}) {
  return {
    path: "a.md",
    line: 1,
    statusSymbol: undefined,
    isTodo: true,
    recurring: false,
    laneVisible: true,
    isDailyNote: false,
    isToday: false,
    scheduled: null,
    created: null,
    rawLine: "- [ ] #task T",
    noteRefreshRaw: undefined,
    ...overrides,
  };
}

function queueEntry(overrides = {}) {
  return {
    key: "a.md:1",
    path: "a.md",
    line: 1,
    lineNumber: 0,
    originalMarkdown: "- [ ] #task T",
    text: "T",
    state: "new",
    bucket: "new",
    tier: "new",
    tierLabel: "NEW",
    lane: "ready",
    created: null,
    fresh: null,
    dueOn: null,
    daysOverdue: null,
    interval: 7,
    rank: 1,
    tierRank: 1,
    tierTotal: 1,
    ...overrides,
  };
}

function makeStatusEl() {
  const classes = new Set();
  const el = {
    text: "",
    textContent: "",
    attrs: {},
    handlers: {},
    style: {},
    children: [],
    clientWidth: 800,
    scrollWidth: 400,
    disabled: false,
    tabIndex: 0,
    setText(value) {
      this.text = String(value);
      this.textContent = String(value);
    },
    setAttribute(key, value) {
      this.attrs[key] = String(value);
    },
    removeAttribute(key) {
      delete this.attrs[key];
    },
    empty() {
      this.children = [];
      this.text = "";
      this.textContent = "";
    },
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      has: (name) => classes.has(name),
    },
    addEventListener(event, handler) {
      this.handlers[event] = handler;
    },
    removeEventListener(event) {
      delete this.handlers[event];
    },
    createEl(tag, options = {}) {
      const child = makeStatusEl();
      child.tag = tag;
      child.cls = options.cls || "";
      if (options.cls) {
        for (const name of String(options.cls).split(/\s+/)) {
          if (name) child.classList.add(name);
        }
      }
      this.children.push(child);
      return child;
    },
  };
  return el;
}

function findChild(el, className) {
  const walk = (node) => {
    if (node.classList && node.classList.has(className)) {
      return node;
    }
    for (const child of node.children || []) {
      const found = walk(child);
      if (found) {
        return found;
      }
    }
    return null;
  };
  return walk(el);
}

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
      getAbstractFileByPath: (filePath) =>
        frontmatter[filePath] !== undefined ? { path: filePath } : null,
      cachedRead: () => Promise.resolve(null),
    },
    workspace: {
      on: () => ({}),
      offref: () => {},
      onLayoutReady: () => {},
      getActiveFile: () => null,
      getActiveViewOfType: () => null,
      trigger: (event) => triggers.push(event),
    },
    metadataCache: {
      on: () => ({}),
      getCache: () => null,
      getFileCache: () => ({}),
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
  process.env.XDG_CONFIG_HOME = "/definitely/missing/freshness-footer-test";
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

test("footer groups omit every zero tier and keep walk order", () => {
  const groups = freshnessFooterGroups({
    new: 0,
    projectsDue: 0,
    pendingDue: 0,
    nextDue: 0,
    resurfaced: 0,
    referencesDue: 0,
    rotten: 0,
    walk: 7,
    byTier: {
      new: 1,
      projects: 0,
      pending: 2,
      next: 0,
      tickler: 1,
      references: 0,
      rotten: 3,
    },
  });
  assert.deepEqual(
    groups.map((group) => group.key + ":" + group.count),
    ["new:1", "pending:2", "tickler:1", "rotten:3"],
  );
  assert.equal(
    groups.some((group) => group.key === "projects"),
    false,
  );
});

test("PRE and POST groups bracket the nine-tier queue and expose completion hints", () => {
  const groups = freshnessFooterGroups({
    walk: 3,
    byTier: {
      pre: 1,
      new: 0,
      projects: 0,
      pending: 0,
      next: 0,
      tickler: 0,
      references: 0,
      rotten: 1,
      post: 1,
    },
  });
  assert.deepEqual(groups.map(({ key, label }) => `${key}:${label}`), [
    "pre:PRE", "rotten:ROTTEN", "post:POST",
  ]);

  const pre = freshnessReviewEntryView(
    queueEntry({ tier: "pre", tierLabel: "PRE", state: null, bucket: null, lane: "ready" }),
    { todayText: D },
  );
  assert.equal(pre.detail, "checklist");
  assert.equal(pre.actionHint, "Ctrl+Enter done · ]s skip");
  const post = freshnessReviewEntryView(
    queueEntry({ tier: "post", tierLabel: "POST", lane: "ready" }),
    { todayText: D },
  );
  assert.equal(post.detail, "closeout");
  assert.equal(post.actionHint, "Ctrl+Enter done · closes the review");

  const currentPre = queueEntry({
    tier: "pre",
    tierLabel: "PRE",
    lane: "ready",
    state: null,
    bucket: null,
    rank: 1,
    tierRank: 1,
    tierTotal: 1,
  });
  const view = freshnessFooterView(
    {
      counts: {
        walk: 2,
        byTier: {
          pre: 1,
          new: 0,
          projects: 0,
          pending: 0,
          next: 0,
          tickler: 0,
          references: 0,
          rotten: 0,
          post: 1,
        },
      },
      queue: [currentPre, queueEntry({ key: "post", tier: "post", tierLabel: "POST" })],
      tasksAvailable: true,
    },
    { current: currentPre, todayText: D },
  );
  assert.equal(view.commitments, 1, "PRE contributes to commitments");
  assert.equal(view.groupsText, "POST 1");
  assert.equal(view.current.actionHint, pre.actionHint);
});

test("a NEW-state tracker appears only in its walk tier", () => {
  const groups = freshnessFooterGroups({
    new: 1,
    projectsDue: 1,
    pendingDue: 0,
    nextDue: 0,
    resurfaced: 0,
    referencesDue: 1,
    rotten: 0,
    walk: 2,
    byTier: {
      new: 0,
      projects: 1,
      pending: 0,
      next: 0,
      tickler: 0,
      references: 1,
      rotten: 0,
    },
  });
  assert.deepEqual(
    groups.map((group) => group.label + " " + group.count),
    ["PROJECTS 1", "REFS 1"],
  );
});

test("empty queue hides the footer even with upkeep or a met budget", () => {
  const hidden = freshnessFooterView(
    {
      counts: {
        walk: 0,
        upkeepToday: 12,
        budget: 15,
        budgetMet: true,
        byTier: {
          new: 0,
          projects: 0,
          pending: 0,
          next: 0,
          tickler: 0,
          references: 0,
          rotten: 0,
        },
      },
      queue: [],
      tasksAvailable: true,
    },
    { navAvailable: true },
  );
  assert.equal(hidden.visible, false);
  assert.equal(hidden.groupsText, "");
  assert.equal(hidden.meterText, "");
});

test("unavailable or missing data never render false counts", () => {
  assert.equal(freshnessFooterView(null).visible, false);
  assert.equal(
    freshnessFooterView({ counts: { walk: 3 }, queue: [{}], tasksAvailable: false }).visible,
    false,
  );
  assert.equal(freshnessFooterView({ queue: null, counts: { walk: 4 } }).visible, false);
});

test("generic summary names due, commitments, and nonempty groups", () => {
  const view = freshnessFooterView(
    {
      counts: {
        walk: 7,
        upkeepToday: 0,
        budget: 15,
        budgetMet: false,
        byTier: {
          new: 1,
          projects: 0,
          pending: 2,
          next: 0,
          tickler: 1,
          references: 0,
          rotten: 3,
        },
      },
      queue: [queueEntry(), queueEntry({ key: "b" })],
      tasksAvailable: true,
    },
    { navAvailable: true },
  );
  assert.equal(view.visible, true);
  assert.equal(view.dueText, "Review 7 due");
  assert.equal(view.contextText, "4 commitments");
  assert.equal(view.hintText, "]s next");
  assert.equal(view.groupsText, "NEW 1 · WIP 2 · TICKS 1 · ROTTEN 3");
  assert.equal(view.meterText, "✓ 0/15 today");
  assert.equal(view.mode, "new");
  const noNav = freshnessFooterView(
    {
      counts: {
        walk: 7,
        upkeepToday: 0,
        budget: 15,
        byTier: {
          new: 1,
          projects: 0,
          pending: 2,
          next: 0,
          tickler: 1,
          references: 0,
          rotten: 3,
        },
      },
      queue: [queueEntry()],
      tasksAvailable: true,
    },
    { navAvailable: false },
  );
  assert.equal(noNav.hintText, "open review");
});

test("current-task context uses shared ranks and compact wording", () => {
  const current = queueEntry({
    key: "p.md:2",
    path: "p.md",
    line: 2,
    lineNumber: 1,
    originalMarkdown: "- [/] #task Pending",
    tier: "pending",
    tierLabel: "PENDING",
    lane: "pending",
    fresh: "2026-10-07",
    dueOn: "2026-10-08",
    daysOverdue: 0,
    interval: 1,
    rank: 2,
    tierRank: 1,
    tierTotal: 2,
  });
  const view = freshnessFooterView(
    {
      counts: {
        walk: 7,
        upkeepToday: 0,
        budget: 15,
        byTier: {
          new: 1,
          projects: 0,
          pending: 2,
          next: 0,
          tickler: 1,
          references: 0,
          rotten: 3,
        },
      },
      queue: [queueEntry(), current],
      tasksAvailable: true,
    },
    { current, navAvailable: true, todayText: D },
  );
  assert.equal(view.dueText, "Review 2/7");
  assert.equal(view.contextText, "WIP 1/2");
  assert.equal(view.detailText, "confirmed yesterday");
  assert.equal(view.hintText, "");
  assert.equal(view.current.actionHint.includes("Ctrl+Alt+F keep"), true);
});

test("only ROTTEN remaining names commitments done or a met budget", () => {
  const rottenQueue = [queueEntry({ tier: "rotten", tierLabel: "ROTTEN", state: "rotten" })];
  const remaining = freshnessFooterView(
    {
      counts: {
        walk: 3,
        upkeepToday: 12,
        budget: 15,
        budgetMet: false,
        byTier: {
          new: 0,
          projects: 0,
          pending: 0,
          next: 0,
          tickler: 0,
          references: 0,
          rotten: 3,
        },
      },
      queue: rottenQueue,
      tasksAvailable: true,
    },
    { navAvailable: true },
  );
  assert.equal(remaining.contextText, "Commitments done");
  assert.equal(remaining.groupsText, "ROTTEN 3");
  assert.equal(remaining.mode, "due");
  const met = freshnessFooterView(
    {
      counts: {
        walk: 3,
        upkeepToday: 15,
        budget: 15,
        budgetMet: true,
        byTier: {
          new: 0,
          projects: 0,
          pending: 0,
          next: 0,
          tickler: 0,
          references: 0,
          rotten: 3,
        },
      },
      queue: rottenQueue,
      tasksAvailable: true,
    },
    { navAvailable: true },
  );
  assert.equal(met.contextText, "Upkeep budget met");
  assert.equal(met.visible, true);
  assert.equal(met.mode, "budget");
});

test("NEW and commitments take precedence over a met budget", () => {
  const view = freshnessFooterView(
    {
      counts: {
        walk: 2,
        upkeepToday: 15,
        budget: 15,
        budgetMet: true,
        byTier: {
          new: 1,
          projects: 0,
          pending: 1,
          next: 0,
          tickler: 0,
          references: 0,
          rotten: 0,
        },
      },
      queue: [queueEntry(), queueEntry({ key: "p", tier: "pending" })],
      tasksAvailable: true,
    },
    { navAvailable: true },
  );
  assert.equal(view.mode, "new");
  assert.equal(view.contextText, "2 commitments");
  assert.equal(view.contextText.includes("budget"), false);
});

test("reviewEntryView compact and detail cover the original freshness tiers", () => {
  const today = { todayText: D };
  assert.deepEqual(freshnessReviewEntryView(null), {
    ok: false,
    tier: "",
    label: "",
    detail: "",
    compact: "",
    actionHint: "",
  });
  assert.equal(freshnessReviewEntryView(queueEntry(), today).detail, "");
  assert.equal(
    freshnessReviewEntryView(
      queueEntry({
        tier: "projects",
        tierLabel: "PROJECTS",
        fresh: null,
        interval: 7,
      }),
      today,
    ).detail,
    "Empty project · never confirmed · every 7d",
  );
  assert.equal(
    freshnessReviewEntryView(
      queueEntry({
        tier: "projects",
        tierLabel: "PROJECTS",
        fresh: null,
      }),
      today,
    ).compact,
    "Empty project",
  );
  assert.equal(
    freshnessReviewEntryView(
      queueEntry({
        tier: "pending",
        tierLabel: "PENDING",
        lane: "pending",
        fresh: "2026-10-07",
        interval: 1,
        daysOverdue: 0,
      }),
      today,
    ).detail,
    "confirmed yesterday",
  );
  assert.equal(
    freshnessReviewEntryView(
      queueEntry({
        tier: "next",
        tierLabel: "NEXT",
        lane: "next",
        fresh: null,
      }),
      today,
    ).compact,
    "never confirmed",
  );
  assert.equal(
    freshnessReviewEntryView(
      queueEntry({
        tier: "tickler",
        tierLabel: "TICKLER",
        fresh: "2026-10-05",
        dueOn: "2026-10-07",
      }),
      today,
    ).detail,
    "back since Oct 7",
  );
  assert.equal(
    freshnessReviewEntryView(
      queueEntry({
        tier: "references",
        tierLabel: "REFERENCES",
        fresh: "2026-10-01",
        dueOn: "2026-10-08",
        daysOverdue: 0,
        interval: 7,
      }),
      today,
    ).detail,
    "Reference · due today · confirmed Oct 1 · every 7d",
  );
  assert.equal(
    freshnessReviewEntryView(
      queueEntry({
        tier: "references",
        tierLabel: "REFERENCES",
      }),
      today,
    ).compact,
    "Reference",
  );
  const rotten = freshnessReviewEntryView(
    queueEntry({
      tier: "rotten",
      tierLabel: "ROTTEN",
      daysOverdue: 3,
      interval: 7,
    }),
    today,
  );
  assert.equal(rotten.detail, "rotten 3d · every 7d");
  assert.equal(rotten.compact, "rotten 3d");
});

test("cursor matching requires a unique verified identity", () => {
  const queue = [
    queueEntry({
      key: "a.md:1",
      path: "a.md",
      line: 1,
      lineNumber: 0,
      originalMarkdown: "- [ ] #task First",
      rank: 1,
    }),
    queueEntry({
      key: "a.md:3",
      path: "a.md",
      line: 3,
      lineNumber: 2,
      originalMarkdown: "- [ ] #task Second",
      rank: 2,
    }),
    queueEntry({
      key: "b.md:1",
      path: "b.md",
      line: 1,
      lineNumber: 0,
      originalMarkdown: "- [ ] #task Other",
      rank: 3,
    }),
  ];
  assert.equal(
    freshnessMatchQueueCursor(queue, {
      path: "a.md",
      line0: 0,
      sourceLine: "- [ ] #task First",
    }).rank,
    1,
  );
  assert.equal(
    freshnessMatchQueueCursor(queue, {
      path: "a.md",
      line0: 4,
      sourceLine: "- [ ] #task Second",
      sourceLines: [
        "- [ ] #task First",
        "",
        "",
        "",
        "- [ ] #task Second",
      ],
    }).rank,
    2,
  );
  assert.equal(
    freshnessMatchQueueCursor(queue, {
      path: "a.md",
      line0: 0,
      sourceLine: "- [ ] #task Stamped today",
    }),
    null,
  );
  const duplicates = [
    queueEntry({
      key: "a.md:1",
      path: "a.md",
      line: 1,
      lineNumber: 0,
      originalMarkdown: "- [ ] #task Twin",
      blockId: "id",
      rank: 1,
    }),
    queueEntry({
      key: "a.md:5",
      path: "a.md",
      line: 5,
      lineNumber: 4,
      originalMarkdown: "- [ ] #task Twin",
      blockId: "id",
      rank: 2,
    }),
  ];
  assert.equal(
    freshnessMatchQueueCursor(duplicates, {
      path: "a.md",
      line0: 2,
      sourceLine: "- [ ] #task Twin",
      sourceLines: [
        "- [ ] #task Twin",
        "",
        "- [ ] #task Twin",
        "",
        "- [ ] #task Twin",
      ],
    }),
    null,
  );
});

test("footer paint hides the host and keeps a stable button", () => {
  const el = makeStatusEl();
  const hidden = freshnessFooterView({ queue: [], counts: { walk: 0 } });
  freshnessFooterPaint(el, hidden);
  assert.equal(el.classList.has("bob-freshness-hidden"), true);
  const button = el.children.find((child) => child.tag === "button");
  assert.ok(button);
  assert.equal(button.disabled, true);
  const shown = freshnessFooterView(
    {
      counts: {
        walk: 1,
        upkeepToday: 0,
        byTier: {
          new: 1,
          projects: 0,
          pending: 0,
          next: 0,
          tickler: 0,
          references: 0,
          rotten: 0,
        },
      },
      queue: [queueEntry()],
      tasksAvailable: true,
    },
    { navAvailable: true },
  );
  freshnessFooterPaint(el, shown);
  assert.equal(el.classList.has("bob-freshness-hidden"), false);
  assert.equal(findChild(el, "bob-freshness-due").textContent, "Review 1 due");
  assert.equal(findChild(el, "bob-freshness-groups").textContent, "NEW 1");
  assert.equal(el.children.find((child) => child.tag === "button"), button);
  assert.equal(button.disabled, false);
});

test("status bar 0-1-0 transitions hide without a reload", () => {
  withMissingConfig(() => {
    let tasks = [];
    const app = makeFreshnessApp({ tasks: undefined });
    app.plugins.plugins["obsidian-tasks-plugin"].getTasks = () => tasks;
    const el = makeStatusEl();
    const plugin = new LedgerToolsPlugin(app, {});
    plugin.addStatusBarItem = () => el;
    plugin.onload();
    try {
      plugin.updateFreshnessStatusBar();
      assert.equal(el.classList.has("bob-freshness-hidden"), true);
      tasks = [makeFreshnessTask()];
      plugin.freshnessMemo = null;
      plugin.updateFreshnessStatusBar();
      assert.equal(el.classList.has("bob-freshness-hidden"), false);
      assert.equal(findChild(el, "bob-freshness-due").textContent, "Review 1 due");
      tasks = [];
      plugin.freshnessMemo = null;
      plugin.updateFreshnessStatusBar();
      assert.equal(el.classList.has("bob-freshness-hidden"), true);
    } finally {
      plugin.onunload();
    }
  });
});

test("cursor-only updates reuse a warm memo", () => {
  withMissingConfig(() => {
    const tasks = [makeFreshnessTask()];
    const app = makeFreshnessApp({ tasks });
    const el = makeStatusEl();
    const plugin = new LedgerToolsPlugin(app, {});
    plugin.addStatusBarItem = () => el;
    plugin.onload();
    try {
      plugin.updateFreshnessStatusBar();
      const memo = plugin.freshnessMemo;
      let ensures = 0;
      const original = plugin.freshnessEnsureMemo.bind(plugin);
      plugin.freshnessEnsureMemo = (...args) => {
        ensures += 1;
        return original(...args);
      };
      plugin.updateFreshnessStatusBar({ contextOnly: true });
      assert.equal(ensures, 0);
      assert.equal(plugin.freshnessMemo, memo);
    } finally {
      plugin.onunload();
    }
  });
});

test("unload disconnects the observer and click handler", () => {
  withMissingConfig(() => {
    const tasks = [makeFreshnessTask()];
    const app = makeFreshnessApp({ tasks });
    const el = makeStatusEl();
    const plugin = new LedgerToolsPlugin(app, {});
    plugin.addStatusBarItem = () => el;
    plugin.onload();
    try {
      plugin.updateFreshnessStatusBar();
      const button = el.children.find((child) => child.tag === "button");
      assert.equal(typeof button.handlers.click, "function");
    } finally {
      plugin.onunload();
    }
    assert.equal(plugin.freshnessFooterObserver, null);
    assert.equal(plugin.freshnessFooterClickBound, null);
    assert.equal(plugin.freshnessStatusEl, null);
  });
});

test("queue-built ranks agree with the footer current entry", () => {
  const rows = [
    sRow({ path: "a.md", line: 1, rawLine: "- [ ] #task New" }),
    sRow({
      path: "b.md",
      line: 2,
      statusSymbol: "/",
      isTodo: false,
      rawLine: "- [/] #task Pending [fresh:: 2026-10-07]",
    }),
    sRow({
      path: "c.md",
      line: 3,
      rawLine: "- [ ] #task Rotten [fresh:: 2026-09-20]",
    }),
  ];
  const queue = freshnessQueue(rows, D, CFG);
  assert.deepEqual(
    queue.map((entry) => entry.tier),
    ["new", "pending", "rotten"],
  );
  const current = queue[1];
  const view = freshnessFooterView(
    {
      counts: {
        walk: 3,
        upkeepToday: 0,
        byTier: {
          new: 1,
          projects: 0,
          pending: 1,
          next: 0,
          tickler: 0,
          references: 0,
          rotten: 1,
        },
      },
      queue,
      tasksAvailable: true,
    },
    { current, todayText: D, navAvailable: true },
  );
  assert.equal(view.dueText, "Review 2/3");
  assert.equal(view.contextText, "WIP 1/1");
  const presentation = freshnessReviewEntryView(current, { todayText: D });
  assert.equal(view.detailText, presentation.compact);
});

test("footer short labels map every tier", () => {
  assert.deepEqual(
    [
      "pre", "new", "projects", "pending", "next",
      "tickler", "references", "rotten", "post",
    ].map((tier) => `${tier}:${freshnessTierFooterLabel(tier)}`),
    [
      "pre:PRE", "new:NEW", "projects:PROJECTS", "pending:WIP",
      "next:NEXT", "tickler:TICKS", "references:REFS",
      "rotten:ROTTEN", "post:POST",
    ],
  );
});

test("current-row footer context uses short labels while entry views keep full labels", () => {
  const today = { todayText: D };
  const ticklerEntry = queueEntry({
    key: "t.md:1",
    tier: "tickler",
    tierLabel: "TICKLER",
    lane: "ready",
    state: "resurfaced",
    fresh: "2026-10-05",
    dueOn: "2026-10-07",
    rank: 5,
    tierRank: 2,
    tierTotal: 14,
  });
  const presentation = freshnessReviewEntryView(ticklerEntry, today);
  assert.equal(presentation.ok, true);
  assert.equal(presentation.tier, "tickler");
  assert.equal(presentation.label, "TICKLER");
  const view = freshnessFooterView(
    {
      counts: {
        walk: 76,
        upkeepToday: 0,
        byTier: {
          pre: 0, new: 0, projects: 0, pending: 10, next: 0,
          tickler: 14, references: 0, rotten: 0, post: 0,
        },
      },
      queue: [ticklerEntry],
      tasksAvailable: true,
    },
    { current: ticklerEntry, todayText: D, navAvailable: true },
  );
  assert.equal(view.dueText, "Review 5/76");
  assert.equal(view.contextText, "TICKS 2/14");
  const pendingEntry = queueEntry({
    key: "p.md:1",
    tier: "pending",
    tierLabel: "PENDING",
    lane: "pending",
    fresh: "2026-10-07",
    interval: 1,
    daysOverdue: 0,
    rank: 5,
    tierRank: 3,
    tierTotal: 10,
  });
  assert.equal(
    freshnessReviewEntryView(pendingEntry, today).label,
    "PENDING",
  );
  const pendingView = freshnessFooterView(
    {
      counts: {
        walk: 76,
        upkeepToday: 0,
        byTier: {
          pre: 0, new: 0, projects: 0, pending: 10, next: 0,
          tickler: 0, references: 0, rotten: 0, post: 0,
        },
      },
      queue: [pendingEntry],
      tasksAvailable: true,
    },
    { current: pendingEntry, todayText: D, navAvailable: true },
  );
  assert.equal(pendingView.contextText, "WIP 3/10");
});

test("legend line lists only the abbreviations shown", () => {
  const legendFor = (view) =>
    view.tooltip.split("\n").find((line) => line.includes(" = "));
  const abbreviated = freshnessFooterView(
    {
      counts: {
        walk: 7,
        upkeepToday: 0,
        byTier: {
          new: 1, projects: 0, pending: 2, next: 0,
          tickler: 1, references: 0, rotten: 3,
        },
      },
      queue: [queueEntry(), queueEntry({ key: "b" })],
      tasksAvailable: true,
    },
    { navAvailable: true },
  );
  assert.equal(
    legendFor(abbreviated),
    "WIP = PENDING · TICKS = TICKLER",
  );
  const refsOnly = freshnessFooterView(
    {
      counts: {
        walk: 2,
        upkeepToday: 0,
        byTier: {
          new: 0, projects: 1, pending: 0, next: 0,
          tickler: 0, references: 1, rotten: 0,
        },
      },
      queue: [queueEntry(), queueEntry({ key: "b" })],
      tasksAvailable: true,
    },
    { navAvailable: true },
  );
  assert.equal(refsOnly.groupsText, "PROJECTS 1 · REFS 1");
  assert.equal(legendFor(refsOnly), "REFS = REFERENCES");
  const plain = freshnessFooterView(
    {
      counts: {
        walk: 2,
        upkeepToday: 0,
        byTier: {
          new: 1, projects: 0, pending: 0, next: 1,
          tickler: 0, references: 0, rotten: 0,
        },
      },
      queue: [queueEntry(), queueEntry({ key: "b" })],
      tasksAvailable: true,
    },
    { navAvailable: true },
  );
  assert.equal(legendFor(plain), undefined);
  assert.match(
    abbreviated.tooltip,
    /Footer splits TICKS from ROTTEN; dashboard ROTTEN chips still fold both\./,
  );
});
