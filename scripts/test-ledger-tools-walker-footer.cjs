// Walker footer's w panel: queue counts, validated positions, clear states,
// work-log detail, host routing, and parity with the dashboard lane badges.
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

class TestElement {
  constructor(tag = "div", className = "") {
    this.tagName = tag;
    this.text = "";
    this.children = [];
    this.attrs = {};
    this.handlers = {};
    this.classes = new Set(String(className).split(/\s+/).filter(Boolean));
    this.classList = {
      add: (name) => this.classes.add(name),
      remove: (name) => this.classes.delete(name),
      contains: (name) => this.classes.has(name),
    };
    this.clientWidth = 0;
    this.scrollWidth = 0;
  }

  createEl(tag, options = {}) {
    const child = new TestElement(tag, options.cls || "");
    this.children.push(child);
    return child;
  }

  empty() {
    this.text = "";
    this.children = [];
  }

  setText(value) {
    this.text = String(value == null ? "" : value);
    this.children = [];
  }

  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }

  removeAttribute(name) {
    delete this.attrs[name];
  }

  addEventListener(name, callback) {
    this.handlers[name] = callback;
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
  dashboardLaneBadgeModel,
  dashboardLaneBudgetFromTasks,
  defaultPlanCaps,
  freshnessFooterPaint,
  laneWalkQueueFromTasks,
  laneWalkerFooterReadLatestWorkLog,
  laneWalkerFooterView,
  readyBadgeModel,
  readyBudgetFromTasks,
} = helpers;

const DAY = new Date(2026, 9, 28);
const DAY_TEXT = "2026-10-28";

function entry(lane, path, lineNumber, overrides = {}) {
  return {
    key: `${path}:${lineNumber + 1}`,
    path,
    line: lineNumber + 1,
    lineNumber,
    originalMarkdown: `- [ ] #task ${lane} task`,
    text: `${lane} task`,
    created: null,
    lane,
    rank: 1,
    total: 1,
    laneRank: 1,
    laneTotal: 1,
    ...overrides,
  };
}

function snapshot(entries, counts = {}, date = DAY_TEXT) {
  return {
    available: true,
    date,
    entries,
    counts: {
      pending: 0,
      next: 0,
      ready: 0,
      total: entries.length,
      todayPending: 0,
      todayNext: 0,
      todayReady: 0,
      reviewReady: 0,
      ...counts,
    },
  };
}

function task(overrides = {}) {
  return {
    status: { type: "TODO", name: "Todo", symbol: " " },
    tags: ["#task"],
    path: "notes/a.md",
    lineNumber: 0,
    blockLink: " ^a1",
    originalMarkdown: "- [ ] #task body",
    description: "body",
    isBlocked: () => false,
    ...overrides,
  };
}

function pendingTask(overrides = {}) {
  return task({
    status: { type: "IN_PROGRESS", name: "In Progress", symbol: "/" },
    ...overrides,
  });
}

function nextTask(overrides = {}) {
  return task({
    status: { type: "ON_HOLD", name: "Next", symbol: "*" },
    ...overrides,
  });
}

function deepText(node) {
  if (!node) return "";
  return String(node.text || "") + (node.children || []).map(deepText).join("");
}

test("off-row panel shows lane membership, over-cap counts, and the Today meter", () => {
  const entries = [
    entry("pending", "notes/a.md", 0, { rank: 1, total: 3, laneRank: 1, laneTotal: 2 }),
    entry("pending", "notes/a.md", 4, { rank: 2, total: 3, laneRank: 2, laneTotal: 2 }),
    entry("ready", "notes/b.md", 1, { rank: 3, total: 3, laneRank: 1, laneTotal: 1 }),
  ];
  const view = laneWalkerFooterView(
    snapshot(entries, { pending: 2, ready: 1, total: 3, todayNext: 2 }),
    { caps: { maxPending: 1, maxNext: 4, maxReady: 9 } },
  );

  assert.equal(view.visible, true);
  assert.equal(view.panel, "lanes");
  assert.equal(view.dueText, "Lanes 3");
  assert.equal(view.contextText, "]] next");
  assert.equal(view.meterText, "TODAY 2");
  assert.deepEqual(view.groups, [
    { key: "pending", label: "WIP", count: "2/1" },
    { key: "next", label: "NEXT", count: "0" },
    { key: "ready", label: "READY", count: "1" },
  ]);
  assert.match(view.tooltip, /WIP 2 of 1 \(over\)/);
  assert.match(view.tooltip, /NEXT 0 of 4/);
  assert.match(view.tooltip, /TODAY 2 already planned/);
});

test("validated row shows its lane rank, answer hint, and newest Work Log age", () => {
  const sourceLines = [
    "- [*] #task next task",
    "  - 🛠️ **WORK LOG**",
    "    - *2026-10-27 14:15* — shipped the patch",
  ];
  const next = entry("next", "notes/a.md", 0, {
    originalMarkdown: sourceLines[0],
    rank: 1,
    total: 1,
    laneRank: 1,
    laneTotal: 1,
  });
  const workLog = laneWalkerFooterReadLatestWorkLog(sourceLines, 0);
  const view = laneWalkerFooterView(
    snapshot([next], { next: 1, total: 1 }),
    {
      caps: { maxPending: 10, maxNext: 15, maxReady: 100 },
      cursor: { path: "notes/a.md", line0: 0, sourceLine: sourceLines[0] },
      workLog,
    },
  );

  assert.deepEqual(workLog, {
    date: "2026-10-27",
    time: "14:15",
    summary: "shipped the patch",
  });
  assert.equal(view.dueText, "Lanes 1/1");
  assert.equal(view.contextText, "NEXT 1/1");
  assert.equal(view.detailText, "worked yesterday");
  assert.equal(view.hintText, "Alt+N release");
  assert.equal(view.current.lane, "next");
  assert.match(view.tooltip, /🛠️ Oct 27 14:15 — shipped the patch/);
});

test("READY rows hint Alt+N next and stale or invalid rows never get a position", () => {
  const row = entry("ready", "notes/a.md", 3, {
    originalMarkdown: "- [ ] #task ready",
    rank: 2,
    total: 2,
    laneRank: 1,
    laneTotal: 1,
  });
  const queue = snapshot(
    [
      entry("pending", "notes/a.md", 0, { rank: 1, total: 2, laneRank: 1, laneTotal: 1 }),
      row,
    ],
    { pending: 1, ready: 1, total: 2 },
  );
  const cursor = { path: "notes/a.md", line0: 3, sourceLine: row.originalMarkdown };
  const view = laneWalkerFooterView(queue, { cursor });
  assert.equal(view.dueText, "Lanes 2/2");
  assert.equal(view.contextText, "READY 1/1");
  assert.equal(view.hintText, "Alt+N next");

  const stale = laneWalkerFooterView(queue, {
    cursor: { ...cursor, sourceLine: "- [ ] #task different" },
  });
  assert.equal(stale.current, null);
  assert.equal(stale.dueText, "Lanes 2");
  assert.equal(stale.contextText, "]] next");

  const invalidRank = laneWalkerFooterView(
    snapshot([entry("ready", "notes/a.md", 3, {
      originalMarkdown: row.originalMarkdown,
      rank: 0,
      total: 1,
      laneRank: 1,
      laneTotal: 1,
    })], { ready: 1, total: 1 }),
    { cursor: { path: "notes/a.md", line0: 3, sourceLine: row.originalMarkdown } },
  );
  assert.equal(invalidRank.current, null);
  assert.equal(invalidRank.dueText, "Lanes 1");
});

test("clear states distinguish Today, review, no work, and unavailable data", () => {
  const today = laneWalkerFooterView(
    snapshot([], { todayPending: 2, todayReady: 1 }),
  );
  assert.equal(today.visible, true);
  assert.equal(today.dueText, "Lanes clear");
  assert.equal(today.meterText, "TODAY 3");

  const review = laneWalkerFooterView(
    snapshot([], { todayNext: 1, reviewReady: 2 }),
  );
  assert.equal(review.dueText, "Lanes clear");
  assert.equal(review.groupsText, "REVIEW 2");
  assert.equal(review.meterText, "TODAY 1");
  assert.equal(review.hintText, "]s walks NEW and ROTTEN");

  const none = laneWalkerFooterView(snapshot([]));
  assert.equal(none.visible, true);
  assert.equal(none.dueText, "No Pending, Next, or Ready tasks");
  assert.equal(none.meterText, "");

  assert.equal(
    laneWalkerFooterView({ available: false, reason: "today" }).visible,
    false,
  );
});

test("work-log parser refuses ambiguous markers and malformed newest entries", () => {
  assert.equal(
    laneWalkerFooterReadLatestWorkLog(
      [
        "- [ ] #task body",
        "  - 🛠️ **WORK LOG**",
        "    - *2026-10-27* — first",
        "  - **Work log:**",
      ],
      0,
    ),
    null,
  );
  assert.equal(
    laneWalkerFooterReadLatestWorkLog(
      ["- [ ] #task body", "  - 🛠️ **WORK LOG**", "    - broken newest entry"],
      0,
    ),
    null,
  );
});

test("footer lane counts match the existing dashboard badges and TODAY exclusions", () => {
  const tasks = [
    pendingTask({ path: "notes/p.md", tags: ["#task"], description: "pending" }),
    pendingTask({ path: "notes/p2.md", tags: ["#task"], description: "pending two" }),
    pendingTask({ path: "notes/pt.md", tags: ["#task", "#today"], description: "pending today" }),
    nextTask({ path: "notes/n.md", tags: ["#task"], description: "next" }),
    nextTask({ path: "notes/n2.md", tags: ["#task"], description: "next two" }),
    nextTask({ path: "notes/nt.md", tags: ["#task", "#today"], description: "next today" }),
    task({ path: "notes/r.md", tags: ["#task"], description: "ready" }),
    task({ path: "notes/r2.md", tags: ["#task"], description: "ready two" }),
    task({ path: "notes/rt.md", tags: ["#task", "#today"], description: "ready today" }),
    task({ path: "notes/review.md", tags: ["#task", "#review"], description: "ready review" }),
  ];
  const caps = { ...defaultPlanCaps(), maxPending: 1, maxNext: 1, maxReady: 1 };
  const isToday = (item) => item.tags.includes("#today");
  const isReview = (item) => item.tags.includes("#review");
  const queue = laneWalkQueueFromTasks(tasks, DAY, isToday, {
    isReviewBucket: isReview,
  });
  const pendingBadge = dashboardLaneBadgeModel(
    dashboardLaneBudgetFromTasks(tasks, DAY, caps, "pending", isToday),
    "pending",
  );
  const nextBadge = dashboardLaneBadgeModel(
    dashboardLaneBudgetFromTasks(tasks, DAY, caps, "next", isToday),
    "next",
  );
  const readyBadge = readyBadgeModel(
    readyBudgetFromTasks(tasks, DAY, caps, isToday, isReview),
  );
  const view = laneWalkerFooterView(
    { available: true, date: DAY_TEXT, entries: queue.entries, counts: queue.counts },
    { caps },
  );

  assert.equal(queue.counts.pending, pendingBadge.section);
  assert.equal(queue.counts.next, nextBadge.section);
  assert.equal(queue.counts.ready, readyBadge.count);
  assert.deepEqual(
    view.groups.map(({ key, count }) => [key, count]),
    [
      ["pending", `${pendingBadge.section}/${pendingBadge.cap}`],
      ["next", `${nextBadge.section}/${nextBadge.cap}`],
      ["ready", `${readyBadge.count}/${readyBadge.cap}`],
    ],
  );
  assert.equal(queue.counts.todayPending, 1);
  assert.equal(queue.counts.todayNext, 1);
  assert.equal(queue.counts.todayReady, 1);
  assert.equal(queue.counts.reviewReady, 1);
});

test("painter marks the lane panel and uses the lane icon and hue", () => {
  const queue = snapshot(
    [entry("ready", "notes/a.md", 0, { originalMarkdown: "- [ ] #task ready" })],
    { ready: 1, total: 1 },
  );
  const view = laneWalkerFooterView(queue, {
    cursor: { path: "notes/a.md", line0: 0, sourceLine: "- [ ] #task ready" },
  });
  const host = new TestElement("div");
  const parts = freshnessFooterPaint(host, view);

  assert.equal(parts.icon.text, "≡");
  assert.equal(parts.context.attrs["data-review-tier"], "ready");
  assert.equal(host.classList.contains("bob-freshness-lanes"), true);
  assert.match(deepText(host), /Lanes 1\/1/);
});

test("status button repeats the persisted w walk and does not change the mode", () => {
  const queue = snapshot(
    [entry("next", "notes/a.md", 0, { originalMarkdown: "- [*] #task next" })],
    { next: 1, total: 1 },
  );
  const calls = [];
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.app = {
    commands: {
      commands: { "bob-navigation-hotkeys:repeat-next-bracket-walk": {} },
      executeCommandById: (id) => calls.push(id),
    },
  };
  plugin.dependencyNavApi = () => ({
    walkMode: { version: 1, current: () => "w" },
  });
  plugin.laneWalkApi = () => ({ version: 2, queue: () => queue });
  plugin.freshnessFooterCursor = () => ({
    path: "notes/a.md",
    line0: 0,
    sourceLine: "- [*] #task next",
  });
  plugin.freshnessStatusEl = new TestElement("div");
  plugin.updateFreshnessStatusBar();

  assert.equal(plugin.freshnessFooterLastView.panel, "lanes");
  assert.equal(plugin.freshnessFooterLastView.dueText, "Lanes 1/1");
  plugin.freshnessStatusClicked();
  assert.deepEqual(calls, ["bob-navigation-hotkeys:repeat-next-bracket-walk"]);
});
