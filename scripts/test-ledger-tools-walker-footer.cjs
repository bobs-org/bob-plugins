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

class TestMarkdownView {}

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
      MarkdownView: TestMarkdownView,
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
  freshnessFooterFit,
  freshnessFooterHiddenView,
  freshnessFooterPaint,
  laneWalkQueueFromTasks,
  laneWalkerFooterReadLatestWorkLog,
  laneWalkerFooterView,
  linksWalkerFooterActivate,
  linksWalkerFooterRequest,
  linksWalkerFooterView,
  walkerFooterClearView,
  walkerFooterReviewView,
  walkerFooterPushReviewAttention,
  walkerFooterPushBankAttention,
  walkerFooterWalkMode,
  readyBadgeModel,
  readyBudgetFromTasks,
  bankWalkBuildEntries,
  bankWalkLocate,
  bankWalkPlan,
  bankWalkerFooterView,
  bankWalkerFooterMeterFromReport,
  bankWalkerFooterArm,
  bankWalkerFooterActivate,
  bankWalkerFooterRequest,
  bankWalkerFooterTakeMeter,
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

test("links panel shows resolved destinations, dashed create targets, and safe clear states", () => {
  const both = linksWalkerFooterView({
    ok: true,
    prev: {
      text: "prev",
      target: "2026/20261111",
      path: "2026/20261111.md",
      exists: true,
    },
    next: {
      text: "next",
      target: "2026/20261113",
      path: "2026/20261113.md",
      exists: true,
    },
  });
  assert.equal(both.visible, true);
  assert.equal(both.panel, "links");
  assert.equal(both.glyph, "⇄");
  assert.equal(both.linkPrev.text, "‹ Wed Nov 11");
  assert.equal(both.linkNext.text, "Fri Nov 13 ›");
  assert.match(both.tooltip, /2026\/20261111\.md/);

  const duplicateBasenames = linksWalkerFooterView({
    ok: true,
    prev: {
      text: "prev",
      target: "areas/20261111",
      path: "areas/20261111.md",
      exists: true,
    },
    next: {
      text: "next",
      target: "projects/20261111",
      path: "projects/20261111.md",
      exists: true,
    },
  });
  assert.match(duplicateBasenames.linkPrev.text, /areas\/Wed Nov 11/);
  assert.match(duplicateBasenames.linkNext.text, /projects\/Wed Nov 11/);

  const missing = linksWalkerFooterView({
    ok: true,
    prev: null,
    next: {
      text: "W47 ›",
      target: "2026/2026-W47",
      path: "2026/2026-W47.md",
      exists: false,
    },
  });
  assert.equal(missing.linkState, "next-only");
  assert.equal(missing.linkNext.text, "W47+ ›");
  assert.equal(missing.linkNext.createEligible, true);
  assert.match(missing.linkNext.tooltip, /No W47 note yet — \]\] creates it/);
  assert.equal(missing.linkStatusText, "no prev");

  const empty = linksWalkerFooterView({ ok: true, prev: null, next: null });
  assert.equal(empty.linkState, "empty");
  assert.equal(empty.linkStatusText, "no ‹ / › links in this note");
  const openNote = linksWalkerFooterView(null, { state: "open-note" });
  assert.equal(openNote.linkStatusText, "open a note");
  const unavailable = linksWalkerFooterView(null, { state: "unavailable" });
  assert.equal(unavailable.linkStatusText, "links unavailable");
});

test("links panel painter exposes safe direction buttons and dashed creation state", () => {
  const host = new TestElement("div");
  const view = linksWalkerFooterView({
    ok: true,
    prev: null,
    next: {
      text: "W47 ›",
      target: "2026/2026-W47",
      path: "2026/2026-W47.md",
      exists: false,
    },
  });
  const parts = freshnessFooterPaint(host, view);
  assert.equal(parts.button.children[0].text, "⇄");
  assert.equal(parts.linkNext.tagName, "button");
  assert.equal(parts.linkNext.attrs.type, "button");
  assert.equal(parts.linkNext.attrs["data-walk-link-direction"], "next");
  assert.equal(parts.linkNext.disabled, false);
  assert.equal(parts.linkNext.classList.contains("bob-freshness-link-create"), true);
  assert.equal(parts.linkPrev.attrs.hidden, "hidden");
  assert.equal(host.classList.contains("bob-freshness-links"), true);
  assert.match(deepText(host), /W47\+ ›/);
  assert.doesNotMatch(deepText(host), /<script>/);
});

function createLinkFooterHarness({ mode = "n", content = "[[target|next]]" } = {}) {
  const state = { mode, content, path: "notes/source.md" };
  const view = new TestMarkdownView();
  view.file = { path: state.path, extension: "md" };
  view.editor = {
    getValue: () => state.content,
    cm: { state: { doc: {} } },
  };
  const calls = [];
  const commands = {
    commands: {
      "bob-navigation-hotkeys:repeat-next-bracket-walk": {},
      "bob-navigation-hotkeys:open-prev-link": {},
      "bob-navigation-hotkeys:open-next-link": {},
    },
    executeCommandById: (id) => calls.push(id),
  };
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.app = {
    workspace: { getActiveViewOfType: () => view },
    commands,
  };
  plugin.dependencyNavApi = () => ({
    walkMode: {
      version: 2,
      current: () => state.mode,
      links: ({ path, content: source }) => ({
        ok: true,
        prev: null,
        next: {
          text: "next",
          target: source.includes("changed") ? "changed" : "target",
          path: source.includes("changed") ? "changed.md" : "target.md",
          exists: true,
        },
        path,
      }),
    },
  });
  plugin.freshnessStatusEl = new TestElement("div");
  return { plugin, state, view, calls };
}

test("async link preview paints only for the still-selected mode and editor revision", async () => {
  const { plugin, state } = createLinkFooterHarness();
  let resolvePreview;
  plugin.dependencyNavApi = () => ({
    walkMode: {
      version: 2,
      current: () => state.mode,
      links: () => new Promise((resolve) => { resolvePreview = resolve; }),
    },
  });
  linksWalkerFooterRequest(plugin);
  await Promise.resolve();
  assert.equal(typeof resolvePreview, "function");
  state.mode = "w";
  resolvePreview({
    ok: true,
    prev: null,
    next: { text: "next", target: "target", path: "target.md", exists: true },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.notEqual(plugin.freshnessFooterLastView?.panel, "links");

  state.mode = "n";
  plugin.linkWalkerFooterGeneration = 0;
  let resolveSecond;
  plugin.dependencyNavApi = () => ({
    walkMode: {
      version: 2,
      current: () => state.mode,
      links: () => new Promise((resolve) => { resolveSecond = resolve; }),
    },
  });
  linksWalkerFooterRequest(plugin);
  await Promise.resolve();
  state.content = "[[changed|next]]";
  resolveSecond({
    ok: true,
    prev: null,
    next: { text: "next", target: "target", path: "target.md", exists: true },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.notEqual(plugin.freshnessFooterLastView?.panel, "links");
});

test("link direction activation revalidates the preview and calls the existing command", async () => {
  const { plugin, state, calls } = createLinkFooterHarness();
  linksWalkerFooterRequest(plugin);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(plugin.freshnessFooterLastView.panel, "links");
  assert.equal(linksWalkerFooterActivate(plugin, "next"), true);
  assert.deepEqual(calls, ["bob-navigation-hotkeys:open-next-link"]);

  state.mode = "w";
  assert.equal(linksWalkerFooterActivate(plugin, "next"), false);
  assert.deepEqual(calls, ["bob-navigation-hotkeys:open-next-link"]);
});

test("links main button repeats the n walk through the existing bracket command", () => {
  const calls = [];
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.app = {
    commands: {
      commands: { "bob-navigation-hotkeys:repeat-next-bracket-walk": {} },
      executeCommandById: (id) => calls.push(id),
    },
  };
  plugin.dependencyNavApi = () => ({
    walkMode: { version: 2, current: () => "n", links: () => ({ ok: true }) },
  });
  plugin.freshnessStatusClicked();
  assert.deepEqual(calls, ["bob-navigation-hotkeys:repeat-next-bracket-walk"]);
});

test("walker painter stamps the active family and swaps panels synchronously", () => {
  const laneQueue = snapshot(
    [entry("pending", "notes/a.md", 0, { rank: 1, total: 1, laneRank: 1, laneTotal: 1 })],
    { pending: 1, total: 1 },
  );
  const host = new TestElement("div");
  freshnessFooterPaint(host, laneWalkerFooterView(laneQueue, {}));
  assert.equal(host.attrs["data-walker-panel"], "w");
  assert.equal(host.classList.contains("bob-freshness-lanes"), true);

  freshnessFooterPaint(host, linksWalkerFooterView({
    ok: true,
    prev: { text: "prev", target: "a", path: "a.md", exists: true },
    next: { text: "next", target: "b", path: "b.md", exists: true },
  }));
  assert.equal(host.attrs["data-walker-panel"], "n");
  assert.equal(host.classList.contains("bob-freshness-lanes"), false);
  assert.equal(host.classList.contains("bob-freshness-links"), true);

  freshnessFooterPaint(host, walkerFooterClearView(
    { counts: { walk: 0, byTier: {} }, tasksAvailable: true },
    { navAvailable: true },
  ));
  assert.equal(host.attrs["data-walker-panel"], "s");
  assert.equal(host.classList.contains("bob-freshness-links"), false);
  assert.match(deepText(host), /Review clear/);

  freshnessFooterPaint(host, freshnessFooterHiddenView());
  assert.equal(host.attrs["data-walker-panel"], "hidden");
  assert.equal(host.classList.contains("bob-freshness-hidden"), true);
});

test("walker count-only repaints update text in place without rebuilding the footer", () => {
  const host = new TestElement("div");
  const one = snapshot(
    [entry("pending", "notes/a.md", 0, { rank: 1, total: 1, laneRank: 1, laneTotal: 1 })],
    { pending: 1, total: 1 },
  );
  const parts = freshnessFooterPaint(host, laneWalkerFooterView(one, {}));
  const slots = host.children.slice();
  assert.ok(slots.length > 0);

  const two = snapshot(
    [
      entry("pending", "notes/a.md", 0, { rank: 1, total: 2, laneRank: 1, laneTotal: 2 }),
      entry("ready", "notes/b.md", 1, { rank: 2, total: 2, laneRank: 1, laneTotal: 1 }),
    ],
    { pending: 2, ready: 1, total: 2 },
  );
  const repainted = freshnessFooterPaint(host, laneWalkerFooterView(two, {}));
  assert.equal(host.attrs["data-walker-panel"], "w");
  assert.equal(repainted.button, parts.button);
  assert.equal(repainted.due, parts.due);
  assert.equal(repainted.context, parts.context);
  assert.equal(repainted.detail, parts.detail);
  assert.equal(repainted.hint, parts.hint);
  assert.equal(repainted.meter, parts.meter);
  assert.deepEqual(host.children, slots);
  assert.match(deepText(host), /Lanes 2/);
});

test("walker review export keeps the gated clear state behind the preview", () => {
  const view = walkerFooterReviewView(
    { counts: { walk: 0, byTier: {} }, queue: [], tasksAvailable: true },
    { navAvailable: true, todayText: "2026-10-28", queue: [] },
  );
  assert.equal(view.visible, true);
  assert.equal(view.mode, "clear");
  assert.equal(view.dueText, "Review clear");
});

function makePushPlugin({ mode = "w", version = 3, withSetAttention = true, throwing = false } = {}) {
  const calls = [];
  const walkMode = { version };
  if (withSetAttention) {
    walkMode.current = () => mode;
    walkMode.setAttention = (type, value) => {
      calls.push({ type, value });
      if (throwing) {
        throw new Error("nav down");
      }
      return { ok: true };
    };
  }
  const plugin = {
    dependencyNavApi: () => ({ walkMode }),
    freshnessMemo: null,
  };
  return { plugin, walkMode, calls };
}

function commitmentMemo({ byTier = {}, walk = 0, tasksAvailable = true } = {}) {
  return { counts: { byTier, walk }, tasksAvailable };
}

test("push sends the first nonzero commitment tier off-s", () => {
  const { plugin, calls } = makePushPlugin({ mode: "w" });
  walkerFooterPushReviewAttention(
    plugin,
    { legacy: false, mode: "w" },
    commitmentMemo({ byTier: { pending: 2, next: 1 }, walk: 9 }),
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, "s");
  assert.equal(calls[0].value.tier, "pending");
  assert.match(calls[0].value.label, /Review: 9 due/);
  assert.match(calls[0].value.label, /3 commitments/);
});

test("rotten-only and post-only queues push null", () => {
  for (const byTier of [{ rotten: 4, walk: 4 }, { post: 2 }]) {
    const { plugin, calls } = makePushPlugin({ mode: "w" });
    walkerFooterPushReviewAttention(plugin, { legacy: false, mode: "w" }, commitmentMemo({ byTier, walk: 4 }));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].value, null);
  }
});

test("mode s, legacy routes, and unavailable tasks push null", () => {
  const { plugin: onS, calls: onSCalls } = makePushPlugin({ mode: "s" });
  walkerFooterPushReviewAttention(onS, { legacy: false, mode: "s" }, commitmentMemo({ byTier: { next: 1 }, walk: 1 }));
  assert.deepEqual(onSCalls[0].value, null);
  const { plugin: legacy, calls: legacyCalls } = makePushPlugin({ mode: "w" });
  walkerFooterPushReviewAttention(legacy, { legacy: true, mode: null }, commitmentMemo({ byTier: { next: 1 }, walk: 1 }));
  assert.deepEqual(legacyCalls[0].value, null);
  const { plugin: noTasks, calls: noTasksCalls } = makePushPlugin({ mode: "w" });
  walkerFooterPushReviewAttention(noTasks, { legacy: false, mode: "w" }, commitmentMemo({ byTier: { next: 1 }, walk: 1, tasksAvailable: false }));
  assert.deepEqual(noTasksCalls[0].value, null);
  const { plugin: noMemo, calls: noMemoCalls } = makePushPlugin({ mode: "w" });
  noMemo.freshnessMemo = null;
  noMemo.freshnessEnsureMemo = () => null;
  walkerFooterPushReviewAttention(noMemo, { legacy: false, mode: "w" }, null);
  assert.deepEqual(noMemoCalls[0].value, null);
});

test("old or missing nav attention makes no call and throwing never escapes", () => {
  const { plugin: old, calls: oldCalls } = makePushPlugin({ mode: "w", version: 2 });
  walkerFooterPushReviewAttention(old, { legacy: false, mode: "w" }, commitmentMemo({ byTier: { next: 1 }, walk: 1 }));
  assert.equal(oldCalls.length, 0);
  const { plugin: missing } = makePushPlugin({ mode: "w" });
  missing.dependencyNavApi = () => ({});
  assert.doesNotThrow(() => walkerFooterPushReviewAttention(missing, { legacy: false, mode: "w" }, commitmentMemo({ byTier: { next: 1 }, walk: 1 })));
  const { plugin: throwing, calls: throwingCalls } = makePushPlugin({ mode: "w", throwing: true });
  assert.doesNotThrow(() => walkerFooterPushReviewAttention(
    throwing,
    { legacy: false, mode: "w" },
    commitmentMemo({ byTier: { next: 1 }, walk: 1 }),
  ));
  assert.equal(throwingCalls.length, 1);
});

test("updateFreshnessStatusBar pushes non-null off-s and null on s", () => {
  let mode = "w";
  const calls = [];
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.app = {
    commands: { commands: {}, executeCommandById: () => {} },
    workspace: { getActiveViewOfType: () => null },
  };
  plugin.dependencyNavApi = () => ({
    walkMode: {
      version: 3,
      current: () => mode,
      setAttention: (type, value) => {
        calls.push({ mode, type, value });
        return { ok: true };
      },
    },
  });
  plugin.laneWalkApi = () => ({ version: 2, queue: () => ({ available: false }) });
  plugin.freshnessFooterCursor = () => null;
  plugin.freshnessStatusEl = new TestElement("div");
  plugin.freshnessEnsureMemo = () => commitmentMemo({ byTier: { next: 2 }, walk: 5 });
  plugin.freshnessMemo = plugin.freshnessEnsureMemo();
  mode = "w";
  plugin.updateFreshnessStatusBar();
  assert.ok(calls.length >= 1);
  assert.notEqual(calls.at(-1).value, null);
  assert.equal(calls.at(-1).value.tier, "next");
  mode = "s";
  plugin.updateFreshnessStatusBar();
  assert.equal(calls.at(-1).value, null);
  assert.equal(walkerFooterWalkMode(plugin).mode, "s");
});

test("unload callback clears the dot and tolerates missing or old nav", () => {
  const seen = [];
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.app = {
    workspace: { on: () => ({}), onLayoutReady: () => {} },
    commands: { commands: {} },
    plugins: { plugins: {} },
  };
  plugin.dependencyNavApi = () => ({
    walkMode: {
      version: 3,
      current: () => "w",
      setAttention: (type, value) => {
        seen.push({ type, value });
        return { ok: true };
      },
    },
  });
  plugin.addStatusBarItem = () => new TestElement("div");
  const registered = [];
  plugin.register = (fn) => registered.push(fn);
  plugin.registerEvent = () => {};
  plugin.registerEditorExtension = () => {};
  plugin.setupFreshnessStatusBar();
  assert.ok(registered.length >= 2);
  for (const fn of registered) {
    assert.doesNotThrow(fn);
  }
  assert.deepEqual(seen.at(-1), { type: "s", value: null });
  const missing = Object.create(LedgerToolsPlugin.prototype);
  missing.app = plugin.app;
  missing.dependencyNavApi = () => null;
  missing.addStatusBarItem = () => new TestElement("div");
  const missingRegistered = [];
  missing.register = (fn) => missingRegistered.push(fn);
  missing.registerEvent = () => {};
  missing.registerEditorExtension = () => {};
  missing.setupFreshnessStatusBar();
  for (const fn of missingRegistered) {
    assert.doesNotThrow(fn);
  }
  const old = Object.create(LedgerToolsPlugin.prototype);
  old.app = plugin.app;
  old.dependencyNavApi = () => ({ walkMode: { version: 2, setAttention: () => { throw new Error("should not be called"); } } });
  old.addStatusBarItem = () => new TestElement("div");
  const oldRegistered = [];
  old.register = (fn) => oldRegistered.push(fn);
  old.registerEvent = () => {};
  old.registerEditorExtension = () => {};
  old.setupFreshnessStatusBar();
  for (const fn of oldRegistered) {
    assert.doesNotThrow(fn);
  }
});

function bankRow(date, line, cents, payee, waiting = true) {
  return {
    path: "bank/2026-11.md",
    line,
    date,
    cents,
    waiting,
    payee,
    ackId: null,
    text: `- [${waiting ? " " : "x"}] ${cents >= 0 ? "+" : ""}$${(Math.abs(cents) / 100).toFixed(2)} ${payee}`,
  };
}

function bankSnap(rows, generation = 4) {
  const built = bankWalkBuildEntries(rows);
  const waiting = rows.filter((row) => row.waiting).length;
  const files = {
    "bank/2026-11.md": {
      month: "2026-11",
      headings: [...new Set(rows.map((row) => row.date))].map((date) => ({
        date,
        line: Math.min(...rows.filter((row) => row.date === date).map((row) => row.line)) - 1,
      })),
    },
  };
  return {
    available: true,
    version: 1,
    generation,
    scope: built.scope,
    counts: {
      rows: rows.length,
      waiting,
      days: built.days.length,
      waitingDays: built.days.filter((day) => day.waiting > 0).length,
      months: 1,
      waitingMonths: waiting > 0 ? 1 : 0,
    },
    entries: built.entries,
    days: built.days,
    files,
  };
}

const WAITING_ROWS = [
  bankRow("2026-11-10", 4, -1100, "Mon one"),
  bankRow("2026-11-10", 5, -1200, "Mon two"),
  bankRow("2026-11-10", 6, -1300, "Mon three"),
  bankRow("2026-11-12", 10, -2100, "Wed one"),
  bankRow("2026-11-12", 11, -2200, "Wed two"),
  bankRow("2026-11-13", 20, -4250, "ShopRite"),
  bankRow("2026-11-13", 21, -1500, "Thu two"),
  bankRow("2026-11-13", 22, -1600, "Thu three"),
  bankRow("2026-11-13", 23, -1700, "Thu four"),
  bankRow("2026-11-14", 30, -3100, "Fri one"),
];

const ALL_ROWS = [
  bankRow("2026-11-03", 3, -500, "Old one", false),
  bankRow("2026-11-04", 8, -1240, "Coffee", false),
  bankRow("2026-11-04", 9, 120000, "Payroll inflow", false),
  bankRow("2026-11-04", 10, -800, "Snack", false),
  bankRow("2026-11-04", 11, -900, "Fare", false),
  bankRow("2026-11-04", 12, -700, "Tip", false),
  bankRow("2026-11-05", 16, -300, "Later", false),
];

function bankArms(snapshot, cursor) {
  const prev = bankWalkPlan(snapshot, { direction: -1, dayJump: true, cursor, anchor: null });
  const next = bankWalkPlan(snapshot, { direction: 1, dayJump: true, cursor, anchor: null });
  return {
    prev: bankWalkerFooterArm(prev, "prev", snapshot.scope),
    next: bankWalkerFooterArm(next, "next", snapshot.scope),
    prevPlan: prev,
    nextPlan: next,
  };
}

function bankMeterOk() {
  return bankWalkerFooterMeterFromReport(
    {
      today: "2026-11-14",
      accounts: [
        { label: "Checking", kind: "checking", status: "balanced" },
        { label: "Card", kind: "credit", status: "balanced" },
      ],
    },
    { currentGeneration: 4, resultGeneration: 4 },
  );
}

test("bank panel paints every WAITING and ALL state from one snapshot", () => {
  const waiting = bankSnap(WAITING_ROWS);
  assert.equal(waiting.scope, "waiting");
  assert.equal(waiting.counts.waiting, 10);
  const shop = waiting.entries.find((entry) => entry.payee === "ShopRite");
  const onRowCursor = { path: shop.path, line0: shop.line - 1 };
  const onRowArms = bankArms(waiting, onRowCursor);
  const onRow = bankWalkerFooterView(waiting, {
    located: { inBank: true, path: shop.path, date: shop.date, line0: shop.line - 1, entry: shop, member: true },
    arms: onRowArms,
    meter: bankMeterOk(),
    hue: "magenta",
  });
  assert.equal(onRow.visible, true);
  assert.equal(onRow.panel, "bank");
  assert.equal(onRow.glyph, "$");
  assert.equal(onRow.dueText, `WAITING ${shop.rank}/${waiting.entries.length}`);
  assert.equal(onRow.contextText, `${shop.label} ${shop.dayRank}/${shop.dayTotal}`);
  assert.equal(onRow.detailText, "$42.50 ShopRite");
  assert.equal(onRow.detailCompactText, "$42.50");
  assert.equal(onRow.hintText, "Ctrl+Enter file");
  assert.equal(onRow.inflow, false);
  assert.equal(onRow.meterText, "✓ balanced");
  assert.equal(onRow.meterTone, "ok");
  assert.equal(onRow.linkPrev.text, "‹ Nov 12");
  assert.equal(onRow.linkNext.text, "Nov 14 ›");
  assert.equal(onRow.linkPrev.ariaLabel, `Previous bank day: ${onRowArms.prevPlan.entry.label}, 2 waiting`);
  assert.match(onRow.tooltip, /WAITING — 10 rows wait across 4 days/);
  assert.match(onRow.tooltip, /\$42\.50 ShopRite/);
  assert.match(onRow.tooltip, /bank\/2026-11\.md:20/);
  assert.doesNotMatch(onRow.dueText, /%/);

  const inBank = bankWalkerFooterView(waiting, {
    located: { inBank: true, path: shop.path, date: shop.date, line0: 18, entry: null, member: false },
    arms: bankArms(waiting, { path: shop.path, line0: 18 }),
    meter: bankMeterOk(),
  });
  assert.equal(inBank.dueText, "WAITING 10");
  assert.equal(inBank.contextText, shop.label);
  assert.equal(inBank.detailText, "");
  assert.equal(inBank.hintText, "]] next waiting");
  assert.equal(inBank.linkPrev.text, "‹ Nov 12");

  const outside = bankWalkerFooterView(waiting, {
    located: { inBank: false, path: "notes/gtd.md", date: null, line0: 0, entry: null, member: false },
    arms: { prev: { text: "should-not-show" }, next: { text: "nope" } },
    meter: bankMeterOk(),
  });
  assert.equal(outside.dueText, "WAITING 10");
  assert.equal(outside.contextText, "]] oldest");
  assert.equal(outside.detailText, "");
  assert.equal(outside.linkPrev, null);
  assert.equal(outside.linkNext, null);
  assert.deepEqual(
    outside.groups.map((group) => `${group.label} ${group.count}`),
    waiting.days.map((day) => `${day.label} ${day.count}`),
  );

  const daily = bankWalkerFooterView(waiting, {
    located: { inBank: false, path: "2026/20261113.md", date: null, line0: 2, entry: null, member: false },
    dailyEntry: { date: "2026-11-13", label: "Fri Nov 13" },
    meter: bankMeterOk(),
  });
  assert.equal(daily.contextText, "]] Fri Nov 13");

  const all = bankSnap(ALL_ROWS);
  assert.equal(all.scope, "all");
  const coffee = all.entries.find((entry) => entry.payee === "Coffee");
  const allRow = bankWalkerFooterView(all, {
    located: { inBank: true, path: coffee.path, date: coffee.date, line0: coffee.line - 1, entry: coffee, member: true },
    arms: bankArms(all, { path: coffee.path, line0: coffee.line - 1 }),
    meter: bankMeterOk(),
  });
  assert.equal(allRow.dueText, `ALL ${coffee.rank}/${all.entries.length}`);
  assert.match(allRow.contextText, /Nov 4 /);
  assert.equal(allRow.detailText, "$12.40 Coffee");
  assert.equal(allRow.hintText, "]} next day");
  assert.equal(allRow.linkPrev.text, "‹ Nov 3");
  assert.equal(allRow.linkNext.text, "Nov 5 ›");

  const payroll = all.entries.find((entry) => entry.payee === "Payroll inflow");
  const inflow = bankWalkerFooterView(all, {
    located: { inBank: true, path: payroll.path, date: payroll.date, line0: payroll.line - 1, entry: payroll, member: true },
    arms: bankArms(all, { path: payroll.path, line0: payroll.line - 1 }),
  });
  assert.equal(inflow.inflow, true);
  assert.match(inflow.detailText, /\+\$1,200\.00 Payroll inflow/);

  const allInBank = bankWalkerFooterView(all, {
    located: { inBank: true, path: coffee.path, date: coffee.date, line0: 6, entry: null, member: false },
    arms: bankArms(all, { path: coffee.path, line0: 6 }),
    meter: bankMeterOk(),
  });
  assert.equal(allInBank.dueText, `ALL ${all.counts.rows}`);
  assert.equal(allInBank.detailText, "");
  assert.equal(allInBank.hintText, "]] next row");

  const allOutside = bankWalkerFooterView(all, {
    located: { inBank: false, path: "inbox.md", date: null, line0: 0, entry: null, member: false },
    meter: bankMeterOk(),
  });
  assert.equal(allOutside.contextText, "]] latest day");
  assert.equal(allOutside.groups.length, 0);
  assert.equal(allOutside.linkPrev, null);

  const empty = bankWalkerFooterView({
    available: true,
    version: 1,
    generation: 1,
    scope: "all",
    counts: { rows: 0, waiting: 0, days: 0, waitingDays: 0, months: 0, waitingMonths: 0 },
    entries: [],
    days: [],
    files: {},
  }, { meter: bankMeterOk() });
  assert.equal(empty.dueText, "No bank rows");
  assert.equal(empty.hintText, "bob bank import");
  assert.equal(empty.meterText, "");
  assert.match(empty.tooltip, /bob bank import/);
});

test("bank money and day fractions appear only on the cursor row", () => {
  const waiting = bankSnap(WAITING_ROWS);
  const shop = waiting.entries.find((entry) => entry.payee === "ShopRite");
  const offMember = bankWalkerFooterView(waiting, {
    located: { inBank: true, path: shop.path, date: shop.date, line0: 18, entry: null, member: false },
    arms: bankArms(waiting, { path: shop.path, line0: 18 }),
  });
  assert.equal(offMember.detailText, "");
  assert.doesNotMatch(offMember.dueText, /\//);
  assert.doesNotMatch(offMember.contextText, /\d+\/\d+/);
  const outside = bankWalkerFooterView(waiting, {
    located: { inBank: false, path: "daily.md", date: null, line0: 0, entry: null, member: false },
  });
  assert.equal(outside.detailText, "");
  assert.doesNotMatch(outside.dueText, /\//);
});

test("bank day arms equal the shared planner including wrap", () => {
  const waiting = bankSnap(WAITING_ROWS);
  const first = waiting.entries[0];
  const last = waiting.entries[waiting.entries.length - 1];
  const fromLast = bankArms(waiting, { path: last.path, line0: last.line - 1 });
  assert.equal(fromLast.nextPlan.wrapped, true);
  assert.equal(fromLast.next.text, `↻ ${fromLast.nextPlan.entry.short} ›`);
  assert.match(fromLast.next.ariaLabel, /Next bank day:/);
  const fromFirst = bankArms(waiting, { path: first.path, line0: first.line - 1 });
  assert.equal(fromFirst.prevPlan.wrapped, true);
  assert.equal(fromFirst.prev.text, `‹ ↻ ${fromFirst.prevPlan.entry.short}`);
  const view = bankWalkerFooterView(waiting, {
    located: { inBank: true, path: last.path, date: last.date, line0: last.line - 1, entry: last, member: true },
    arms: { prev: fromLast.prev, next: fromLast.next },
  });
  assert.equal(view.linkNext.text, fromLast.next.text);
});

test("bank meter is honest about generation, ranking, and empty accounts", () => {
  const today = "2026-11-14";
  const balanced = bankWalkerFooterMeterFromReport({
    today,
    accounts: [
      { label: "Checking", kind: "checking", status: "balanced" },
      { label: "Cash", kind: "cash", status: "untracked" },
      { label: "Ghost", kind: "checking", status: "untracked" },
    ],
  }, { currentGeneration: 3, resultGeneration: 3 });
  assert.equal(balanced.text, "✓ balanced");
  assert.equal(balanced.state, "ok");

  const ranked = bankWalkerFooterMeterFromReport({
    today,
    accounts: [
      { label: "Card", kind: "credit", status: "unverified" },
      { label: "Savings", kind: "savings", status: "stale", balance_asof: "2026-11-02" },
      { label: "Checking", kind: "checking", status: "gap" },
      { label: "Brokerage", kind: "brokerage", status: "delta", delta_cents: 320 },
      { label: "Wallet", kind: "cash", status: "delta", delta_cents: 99999 },
    ],
  }, { currentGeneration: 3, resultGeneration: 3 });
  assert.equal(ranked.state, "delta");
  assert.equal(ranked.text, "Δ $3.20");
  assert.ok(ranked.lines.some((line) => line.includes("Checking gap")));
  assert.ok(ranked.lines.some((line) => /stale 12d/.test(line)));
  assert.equal(ranked.lines.some((line) => /Wallet/.test(line)), false);

  const staleGen = bankWalkerFooterMeterFromReport(
    { today, accounts: [{ label: "Checking", kind: "checking", status: "balanced" }] },
    { currentGeneration: 5, resultGeneration: 4 },
  );
  assert.equal(staleGen.state, "stale-generation");
  assert.equal(staleGen.text, "");

  const none = bankWalkerFooterMeterFromReport(
    { today, accounts: [{ label: "Cash", kind: "cash", status: "untracked" }] },
    { currentGeneration: 1, resultGeneration: 1 },
  );
  assert.equal(none.state, "empty");
  assert.equal(none.text, "");
});

test("bank shed order is groups, compact detail, detail, day arms, hint, then meter", () => {
  const waiting = bankSnap(WAITING_ROWS);
  const shop = waiting.entries.find((entry) => entry.payee === "ShopRite");
  const view = bankWalkerFooterView(waiting, {
    located: { inBank: true, path: shop.path, date: shop.date, line0: shop.line - 1, entry: shop, member: true },
    arms: bankArms(waiting, { path: shop.path, line0: shop.line - 1 }),
    meter: { text: "Δ $3.20", state: "delta", lines: ["Checking Δ $3.20"] },
  });
  view.groups = waiting.days.map((day) => ({ key: day.date, label: day.label, count: String(day.count) }));
  view.groupsText = view.groups.map((group) => `${group.label} ${group.count}`).join(" · ");
  const el = new TestElement("div");
  el.clientWidth = 1000;
  const omitted = (node) => Boolean(node && node.classList.contains("bob-freshness-omit"));
  const widthOf = (node) => {
    if (!node || omitted(node)) return 0;
    if (node.classList.contains("bob-freshness-main")) return 50;
    if (node.classList.contains("bob-freshness-context")) return 30;
    if (node.classList.contains("bob-freshness-link-arm")) return 25;
    if (node.classList.contains("bob-freshness-link-separator")) return 5;
    if (node.classList.contains("bob-freshness-detail")) {
      return String(node.text).length > 8 ? 40 : 18;
    }
    if (node.classList.contains("bob-freshness-hint")) return 20;
    if (node.classList.contains("bob-freshness-meter")) return 20;
    if (node.classList.contains("bob-freshness-groups")) {
      return node.children.reduce((sum, child) => {
        if (omitted(child)) return sum;
        return sum + (child.classList.contains("bob-freshness-group") ? 12 : 5);
      }, 0);
    }
    return 0;
  };
  Object.defineProperty(el, "scrollWidth", {
    configurable: true,
    get() {
      return this.children.reduce((sum, child) => sum + widthOf(child), 0);
    },
  });
  const parts = freshnessFooterPaint(el, view);
  el.clientWidth = 1000;
  assert.deepEqual(freshnessFooterFit(el, parts, view), {
    groups: true, groupsShown: 4, detail: true, hint: true, meter: true, arms: true,
  });
  el.clientWidth = 200;
  const afterGroups = freshnessFooterFit(el, parts, view);
  assert.equal(afterGroups.groups, false);
  assert.equal(afterGroups.detail, true);
  assert.equal(afterGroups.arms, true);
  assert.equal(parts.detail.text, "$42.50");
  el.clientWidth = 180;
  const afterDetail = freshnessFooterFit(el, parts, view);
  assert.equal(afterDetail.detail, false);
  assert.equal(afterDetail.arms, true);
  el.clientWidth = 119;
  const afterArms = freshnessFooterFit(el, parts, view);
  assert.equal(afterArms.arms, false);
  assert.equal(afterArms.hint, true);
  el.clientWidth = 99;
  const afterHint = freshnessFooterFit(el, parts, view);
  assert.equal(afterHint.hint, false);
  assert.equal(afterHint.meter, true);
  el.clientWidth = 50;
  const afterMeter = freshnessFooterFit(el, parts, view);
  assert.equal(afterMeter.meter, false);
});

test("bank painter stamps family b, hue, scope, inflow, and arm labels", () => {
  const waiting = bankSnap(WAITING_ROWS);
  const shop = waiting.entries.find((entry) => entry.payee === "ShopRite");
  const view = bankWalkerFooterView(waiting, {
    located: { inBank: true, path: shop.path, date: shop.date, line0: shop.line - 1, entry: shop, member: true },
    arms: bankArms(waiting, { path: shop.path, line0: shop.line - 1 }),
    meter: { text: "Δ $3.20", state: "delta", lines: [] },
    hue: "aqua",
  });
  const host = new TestElement("div");
  const parts = freshnessFooterPaint(host, view);
  assert.equal(host.attrs["data-walker-panel"], "b");
  assert.equal(host.attrs["data-bank-hue"], "aqua");
  assert.equal(host.attrs["data-bank-scope"], "waiting");
  assert.equal(host.classList.contains("bob-freshness-bank"), true);
  assert.equal(parts.icon.text, "$");
  assert.equal(parts.linkPrev.attrs["aria-label"], view.linkPrev.ariaLabel);
  assert.equal(parts.linkNext.disabled, false);
  assert.equal(parts.detail.classList.contains("bob-freshness-inflow"), false);
  assert.equal(parts.meter.classList.contains("bob-freshness-meter-warn"), true);
  const payrollRows = ALL_ROWS.map((row) => ({ ...row }));
  const all = bankSnap(payrollRows);
  const payroll = all.entries.find((entry) => entry.payee === "Payroll inflow");
  const inflowView = bankWalkerFooterView(all, {
    located: { inBank: true, path: payroll.path, date: payroll.date, line0: payroll.line - 1, entry: payroll, member: true },
    arms: bankArms(all, { path: payroll.path, line0: payroll.line - 1 }),
    meter: bankMeterOk(),
  });
  freshnessFooterPaint(host, inflowView);
  assert.equal(host.attrs["data-bank-scope"], "all");
  assert.equal(host.classList.contains("bob-freshness-inflow") || parts.detail.classList.contains("bob-freshness-inflow"), true);
});

function makeBankFooterPlugin({ mode = "b", version = 4, snapshot = null, cursor = null } = {}) {
  const calls = [];
  const fetches = [];
  const writes = [];
  const spawns = [];
  const walkMode = {
    version,
    current: () => mode,
    setAttention: (type, value) => {
      calls.push({ type, value });
      return { ok: true };
    },
  };
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.app = {
    commands: {
      commands: {
        "bob-navigation-hotkeys:repeat-next-bracket-walk": {},
        "bob-navigation-hotkeys:jump-to-prev-bank-day": {},
        "bob-navigation-hotkeys:jump-to-next-bank-day": {},
      },
      executeCommandById: (id) => calls.push(id),
    },
    workspace: { getActiveViewOfType: () => null },
    vault: { modify: (...args) => writes.push(args) },
  };
  plugin.dependencyNavApi = () => ({ walkMode });
  plugin.bankWalkApi = () => ({
    version: 1,
    snapshot: () => snapshot,
    locate: (snap, cur) => bankWalkLocate(snap, cur),
    plan: (snap, options) => bankWalkPlan(snap, options),
    anchor: () => null,
  });
  plugin.freshnessFooterCursor = () => cursor;
  plugin.freshnessStatusEl = new TestElement("div");
  plugin.freshnessEnsureMemo = () => ({ counts: { walk: 0, byTier: {} }, tasksAvailable: true });
  plugin.freshnessMemo = plugin.freshnessEnsureMemo();
  plugin.bankVaultGeneration = snapshot && snapshot.generation ? snapshot.generation : 4;
  plugin.apiBankFetch = (options) => {
    fetches.push(options);
    return Promise.resolve({
      report: {
        today: "2026-11-14",
        accounts: [{ label: "Checking", kind: "checking", status: "balanced" }],
      },
      generation: plugin.bankVaultGeneration,
    });
  };
  plugin.bobSpawnJson = () => {
    spawns.push("bob");
    return Promise.resolve(null);
  };
  plugin.bankSpawnFetch = (...args) => {
    spawns.push(args);
    return Promise.resolve(null);
  };
  return { plugin, walkMode, calls, fetches, writes, spawns };
}

test("bank footer hides while indexing, on other families, and when nav predates v4", () => {
  const waiting = bankSnap(WAITING_ROWS);
  const hidden = bankWalkerFooterView(waiting, { navVersion: 3 });
  assert.equal(hidden.visible, false);
  const { plugin: oldNav } = makeBankFooterPlugin({ version: 3, snapshot: waiting });
  bankWalkerFooterRequest(oldNav);
  assert.equal(oldNav.freshnessFooterLastView.visible, false);

  const { plugin: indexing } = makeBankFooterPlugin({
    snapshot: { available: false, reason: "indexing" },
  });
  bankWalkerFooterRequest(indexing);
  assert.equal(indexing.freshnessFooterLastView.visible, false);

  const { plugin: other } = makeBankFooterPlugin({ mode: "w", snapshot: waiting });
  other.updateFreshnessStatusBar();
  assert.notEqual(other.freshnessFooterLastView.panel, "bank");

  const { plugin: unset } = makeBankFooterPlugin({ mode: null, snapshot: waiting });
  unset.dependencyNavApi = () => ({
    walkMode: { version: 4, current: () => null, setAttention: () => ({ ok: true }) },
  });
  unset.updateFreshnessStatusBar();
  assert.equal(unset.freshnessFooterLastView.visible, false);
});

test("bank attention is waiting-amber off-b and null on b, zero, or old nav", () => {
  const waiting = bankSnap(WAITING_ROWS);
  const { plugin, calls } = makeBankFooterPlugin({ mode: "w", snapshot: waiting });
  walkerFooterPushBankAttention(plugin, { legacy: false, mode: "w" }, waiting);
  assert.equal(calls[0].type, "b");
  assert.equal(calls[0].value.tier, "waiting");
  assert.match(calls[0].value.label, /Bank: 10 waiting · oldest .* — click to show/);

  const onB = makeBankFooterPlugin({ mode: "b", snapshot: waiting });
  walkerFooterPushBankAttention(onB.plugin, { legacy: false, mode: "b" }, waiting);
  assert.equal(onB.calls[0].value, null);

  const none = bankSnap(ALL_ROWS);
  const clear = makeBankFooterPlugin({ mode: "w", snapshot: none });
  walkerFooterPushBankAttention(clear.plugin, { legacy: false, mode: "w" }, none);
  assert.equal(clear.calls[0].value, null);

  const old = makeBankFooterPlugin({ mode: "w", version: 3, snapshot: waiting });
  walkerFooterPushBankAttention(old.plugin, { legacy: false, mode: "w" }, waiting);
  assert.equal(old.calls.length, 0);

  const { plugin: bar, calls: barCalls } = makeBankFooterPlugin({ mode: "w", snapshot: waiting });
  bar.updateFreshnessStatusBar();
  assert.ok(barCalls.some((call) => call.type === "b" && call.value && call.value.tier === "waiting"));
});

test("bank clicks route to bracket repeat and day-jump commands", () => {
  const waiting = bankSnap(WAITING_ROWS);
  const { plugin, calls } = makeBankFooterPlugin({ mode: "b", snapshot: waiting });
  plugin.freshnessStatusClicked();
  assert.deepEqual(calls.filter((call) => typeof call === "string"), [
    "bob-navigation-hotkeys:repeat-next-bracket-walk",
  ]);
  assert.equal(bankWalkerFooterActivate(plugin, "next"), true);
  assert.equal(bankWalkerFooterActivate(plugin, "prev"), true);
  assert.deepEqual(calls.filter((call) => typeof call === "string"), [
    "bob-navigation-hotkeys:repeat-next-bracket-walk",
    "bob-navigation-hotkeys:jump-to-next-bank-day",
    "bob-navigation-hotkeys:jump-to-prev-bank-day",
  ]);
  const { plugin: other } = makeBankFooterPlugin({ mode: "n", snapshot: waiting });
  assert.equal(bankWalkerFooterActivate(other, "next"), false);
});

test("bank paint fetches list through the data service and never writes or spawns bob", async () => {
  const waiting = bankSnap(WAITING_ROWS);
  const shop = waiting.entries.find((entry) => entry.payee === "ShopRite");
  const { plugin, fetches, writes, spawns } = makeBankFooterPlugin({
    mode: "b",
    snapshot: waiting,
    cursor: { path: shop.path, line0: shop.line - 1 },
  });
  bankWalkerFooterRequest(plugin);
  assert.equal(plugin.freshnessFooterLastView.panel, "bank");
  assert.deepEqual(fetches, [{ command: "list" }]);
  bankWalkerFooterRequest(plugin);
  assert.deepEqual(fetches, [{ command: "list" }]);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(plugin.freshnessFooterLastView.meterText, "✓ balanced");
  bankWalkerFooterRequest(plugin);
  assert.deepEqual(fetches, [{ command: "list" }]);
  plugin.bankVaultGeneration = 9;
  const stale = bankWalkerFooterTakeMeter(plugin);
  assert.equal(stale.state, "stale-generation");
  assert.equal(stale.text, "");
  assert.equal(writes.length, 0);
  assert.equal(spawns.length, 0);
});

test("unload on walkMode v4 clears the bank attention without changing v3", () => {
  const seen = [];
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.app = {
    workspace: { on: () => ({}), onLayoutReady: () => {} },
    commands: { commands: {} },
    plugins: { plugins: {} },
  };
  plugin.dependencyNavApi = () => ({
    walkMode: {
      version: 4,
      current: () => "w",
      setAttention: (type, value) => {
        seen.push({ type, value });
        return { ok: true };
      },
    },
  });
  plugin.addStatusBarItem = () => new TestElement("div");
  const registered = [];
  plugin.register = (fn) => registered.push(fn);
  plugin.registerEvent = () => {};
  plugin.registerEditorExtension = () => {};
  plugin.setupFreshnessStatusBar();
  for (const fn of registered) {
    assert.doesNotThrow(fn);
  }
  assert.deepEqual(seen.filter((call) => call.type === "b").at(-1), { type: "b", value: null });
  assert.deepEqual(seen.filter((call) => call.type === "s").at(-1), { type: "s", value: null });
});

test("bank walker footer stylesheet defines the b crossfade and bank tones", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const css = fs.readFileSync(
    path.join(__dirname, "../plugins/bob-ledger-tools/styles.css"),
    "utf8",
  );
  assert.match(css, /@keyframes bob-walker-panel-in-b/);
  assert.match(css, /data-walker-panel="b"/);
  assert.match(css, /data-bank-scope="waiting"/);
  assert.match(css, /bob-freshness-inflow/);
  assert.match(css, /bob-freshness-meter-warn/);
  assert.match(css, /font-variant-numeric:\s*tabular-nums/);
});
