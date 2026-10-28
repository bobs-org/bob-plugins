// Lane walk navigation: planner, runtime, toast, and review-walk isolation.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const notices = [];
global.Notice = class {
  constructor(message) {
    notices.push(message && typeof message === "object" ? "[fragment]" : String(message));
    this.message = message;
  }

  hide() {
    this.hidden = true;
  }
};
global.window = global.window || { setTimeout: (callback) => callback() };
if (typeof global.document === "undefined") {
  // Keep the fallback path: no DOM in these tests unless a case installs one.
}

class TestMarkdownView {}
class TestPlugin {}
const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: TestMarkdownView,
      Modal: class {},
      Notice: global.Notice,
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
    class TestEditorView {}
    TestEditorView.updateListener = { of: (listener) => ({ listener }) };
    return { EditorView: TestEditorView, keymap: { of: (value) => value } };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const NavigationHotkeysPlugin = require("../plugins/bob-navigation-hotkeys/main.js");
const { helpers } = NavigationHotkeysPlugin;
Module._load = originalLoad;

const {
  planLaneWalkJump,
  planLaneWalkLaneJump,
  resolveLaneWalkOrigin,
  buildLaneWalkAnchor,
  buildLaneWalkNoticeModel,
  buildLaneWalkEmptyNoticeModel,
  formatLaneWalkNoticeText,
  readLatestWorkLog,
  reviewQueueEntryKey,
  renderLaneWalkNoticeFragment,
  renderLaneWalkEmptyFragment,
} = helpers;

const DAY = "2026-10-28";

function laneEntry({ lane, path = "walk.md", line, text }) {
  const box = lane === "next" ? "*" : lane === "ready" ? " " : "/";
  const laneLabel =
    lane === "next" ? "NEXT" : lane === "ready" ? "READY" : "PENDING";
  const key = `${path}:${line}`;
  return {
    key,
    path,
    line,
    lineNumber: line - 1,
    originalMarkdown: `- [${box}] #task ${text}`,
    text,
    blockId: null,
    lane,
    laneLabel,
    created: null,
    rank: 0,
    total: 0,
    laneRank: 0,
    laneTotal: 0,
  };
}

function rankedList(rows) {
  const totals = { pending: 0, next: 0, ready: 0 };
  for (const row of rows) {
    const lane =
      row.lane === "next" || row.lane === "ready" ? row.lane : "pending";
    totals[lane] += 1;
  }
  const seen = { pending: 0, next: 0, ready: 0 };
  return rows.map((row, index) => {
    const lane =
      row.lane === "next" || row.lane === "ready" ? row.lane : "pending";
    seen[lane] += 1;
    return {
      ...row,
      rank: index + 1,
      total: rows.length,
      laneRank: seen[lane],
      laneTotal: totals[lane],
    };
  });
}

function makeQueue(rows) {
  const entries = rankedList(rows);
  return {
    available: true,
    entries,
    counts: {
      pending: entries.filter((entry) => entry.lane === "pending").length,
      next: entries.filter((entry) => entry.lane === "next").length,
      ready: entries.filter((entry) => entry.lane === "ready").length,
      total: entries.length,
      todayPending: 0,
      todayNext: 0,
      todayReady: 0,
      reviewReady: 0,
    },
  };
}

function makePlugin({ queue, cursor = null, landings = null, failFirstStale = false }) {
  const plugin = Object.create(NavigationHotkeysPlugin.prototype);
  plugin.app = {
    plugins: {
      plugins: {
        "bob-ledger-tools": {
          api: { laneWalk: { version: 2, queue: () => queue } },
        },
      },
    },
    vault: {},
    workspace: {},
  };
  plugin.laneWalkAnchor = null;
  plugin.laneWalkChain = Promise.resolve();
  plugin.laneWalkNotice = null;
  plugin.reviewAnchor = { key: "review", day: DAY };
  plugin.reviewLanding = { path: "review.md" };
  plugin.reviewWalkCurrent = { path: "review.md" };
  plugin.reviewWalkBusy = () => false;
  plugin.isVimNormalModeEditor = () => false;
  plugin.laneReleaseDateText = () => DAY;
  plugin.getReviewJumpCursor = () => cursor;
  plugin.getReviewWalkOriginCursor = () => null;
  plugin.getActiveMarkdownView = () => null;
  const calls = [];
  let staleOnce = failFirstStale;
  plugin.landOnWalkEntry = async (entry) => {
    calls.push(entry.key);
    if (staleOnce) {
      staleOnce = false;
      return { ok: false, stale: true, settled: Promise.resolve(false) };
    }
    if (landings) {
      landings.push(entry.key);
    }
    return { ok: true, stale: false, settled: Promise.resolve(true) };
  };
  plugin.readLinkPickerNoteContent = async () => null;
  plugin._laneCalls = calls;
  return plugin;
}

class FakeEl {
  constructor(tag) {
    this.tag = tag;
    this.classes = [];
    this.attrs = {};
    this.children = [];
    this.text = null;
  }

  createEl(tag, options = {}) {
    const el = new FakeEl(tag);
    if (typeof options.cls === "string" && options.cls) {
      el.classes.push(...options.cls.split(/\s+/).filter(Boolean));
    }
    if (typeof options.text === "string") el.text = options.text;
    if (options.attr && typeof options.attr === "object") {
      for (const [key, value] of Object.entries(options.attr)) {
        el.attrs[key] = String(value);
      }
    }
    this.children.push(el);
    return el;
  }

  createDiv(options = {}) {
    return this.createEl("div", options);
  }

  createSpan(options = {}) {
    return this.createEl("span", options);
  }

  setAttribute(key, value) {
    this.attrs[String(key)] = String(value);
  }
}

function collect(node, predicate, out = []) {
  if (predicate(node)) out.push(node);
  for (const child of node.children || []) collect(child, predicate, out);
  return out;
}

function classOf(node) {
  return (node.classes || []).join(" ");
}

const three = () =>
  makeQueue([
    laneEntry({ lane: "pending", line: 1, text: "p1" }),
    laneEntry({ lane: "pending", line: 2, text: "p2" }),
    laneEntry({ lane: "next", line: 3, text: "n1" }),
    laneEntry({ lane: "next", line: 4, text: "n2" }),
    laneEntry({ lane: "ready", line: 5, text: "r1" }),
    laneEntry({ lane: "ready", line: 6, text: "r2" }),
  ]);

test("planner: cursor on an entry steps ±1", () => {
  const queue = makeQueue([
    laneEntry({ lane: "pending", line: 1, text: "a" }),
    laneEntry({ lane: "pending", line: 2, text: "b" }),
  ]);
  const cursor = { path: "walk.md", line: 1, text: queue.entries[0].originalMarkdown };
  const forward = planLaneWalkJump(queue.entries, { direction: 1, cursor, todayText: DAY });
  assert.equal(forward.entry.text, "b");
  assert.equal(forward.wrapped, false);
  const back = planLaneWalkJump(queue.entries, {
    direction: -1,
    cursor: { path: "walk.md", line: 2, text: queue.entries[1].originalMarkdown },
    todayText: DAY,
  });
  assert.equal(back.entry.text, "a");
});

test("planner: duplicate-text rows resolve by proximity", () => {
  const queue = makeQueue([
    laneEntry({ lane: "pending", path: "n.md", line: 1, text: "same" }),
    laneEntry({ lane: "pending", path: "n.md", line: 5, text: "same" }),
    laneEntry({ lane: "pending", path: "n.md", line: 9, text: "same" }),
  ]);
  const cursor = { path: "n.md", line: 5, text: queue.entries[1].originalMarkdown };
  const plan = planLaneWalkJump(queue.entries, { direction: 1, cursor, todayText: DAY });
  assert.equal(plan.entry.line, 9);
});

test("planner: anchor whose key survives steps from it", () => {
  const queue = makeQueue([
    laneEntry({ lane: "pending", line: 1, text: "a" }),
    laneEntry({ lane: "pending", line: 2, text: "b" }),
  ]);
  const anchor = buildLaneWalkAnchor(queue.entries[0], DAY);
  const plan = planLaneWalkJump(queue.entries, { direction: 1, anchor, todayText: DAY });
  assert.equal(plan.entry.text, "b");
  assert.equal(plan.origin, "anchor");
});

test("planner: anchored task that left the walk continues by tuple insertion", () => {
  const queue = makeQueue([
    laneEntry({ lane: "pending", path: "a.md", line: 1, text: "a" }),
    laneEntry({ lane: "pending", path: "c.md", line: 1, text: "c" }),
  ]);
  const anchor = { day: DAY, key: "gone", lane: "pending", path: "b.md", line: 1, text: "x" };
  const forward = planLaneWalkJump(queue.entries, { direction: 1, anchor, todayText: DAY });
  assert.equal(forward.entry.path, "c.md");
  const back = planLaneWalkJump(queue.entries, { direction: -1, anchor, todayText: DAY });
  assert.equal(back.entry.path, "a.md");
});

test("planner: yesterday anchor is ignored", () => {
  const queue = makeQueue([
    laneEntry({ lane: "pending", line: 1, text: "a" }),
    laneEntry({ lane: "pending", line: 2, text: "b" }),
  ]);
  const anchor = { ...buildLaneWalkAnchor(queue.entries[1], DAY), day: "2026-10-27" };
  const plan = planLaneWalkJump(queue.entries, { direction: 1, anchor, todayText: DAY });
  assert.equal(plan.entry.text, "a");
});

test("planner: no origin lands on first/last, wrap sets wrapped", () => {
  const queue = makeQueue([
    laneEntry({ lane: "pending", line: 1, text: "a" }),
    laneEntry({ lane: "next", line: 2, text: "b" }),
  ]);
  assert.equal(planLaneWalkJump(queue.entries, { direction: 1, todayText: DAY }).entry.text, "a");
  assert.equal(planLaneWalkJump(queue.entries, { direction: -1, todayText: DAY }).entry.text, "b");
  const cursor = { path: "walk.md", line: 2, text: queue.entries[1].originalMarkdown };
  const wrapped = planLaneWalkJump(queue.entries, { direction: 1, cursor, todayText: DAY });
  assert.equal(wrapped.entry.text, "a");
  assert.equal(wrapped.wrapped, true);
});

test("planner: counts work including wrap during a count", () => {
  const queue = makeQueue([
    laneEntry({ lane: "pending", line: 1, text: "a" }),
    laneEntry({ lane: "pending", line: 2, text: "b" }),
    laneEntry({ lane: "next", line: 3, text: "c" }),
  ]);
  const cursor = { path: "walk.md", line: 3, text: queue.entries[2].originalMarkdown };
  const plan = planLaneWalkJump(queue.entries, { direction: 1, cursor, todayText: DAY, repeat: 2 });
  assert.equal(plan.entry.text, "b");
  assert.equal(plan.wrapped, true);
});

test("planner: empty list returns empty", () => {
  assert.equal(planLaneWalkJump([], { direction: 1, todayText: DAY }).kind, "empty");
});

test("planner: ]w from the last NEXT entry lands on READY 1", () => {
  const queue = three();
  const cursor = {
    path: "walk.md",
    line: 4,
    text: queue.entries[3].originalMarkdown,
  };
  const plan = planLaneWalkJump(queue.entries, { direction: 1, cursor, todayText: DAY });
  assert.equal(plan.entry.lane, "ready");
  assert.equal(plan.entry.text, "r1");
  assert.equal(plan.laneRank, 1);
});

test("planner: last READY wraps to PENDING 1", () => {
  const queue = three();
  const cursor = {
    path: "walk.md",
    line: 6,
    text: queue.entries[5].originalMarkdown,
  };
  const plan = planLaneWalkJump(queue.entries, { direction: 1, cursor, todayText: DAY });
  assert.equal(plan.entry.lane, "pending");
  assert.equal(plan.entry.text, "p1");
  assert.equal(plan.wrapped, true);
});

test("planner: READY tuple insertion continues from the gap", () => {
  const queue = makeQueue([
    laneEntry({ lane: "next", path: "a.md", line: 1, text: "n" }),
    laneEntry({ lane: "ready", path: "c.md", line: 1, text: "r" }),
  ]);
  const anchor = {
    day: DAY,
    key: "gone",
    lane: "ready",
    path: "b.md",
    line: 1,
    text: "x",
  };
  const forward = planLaneWalkJump(queue.entries, {
    direction: 1,
    anchor,
    todayText: DAY,
  });
  assert.equal(forward.entry.path, "c.md");
  assert.equal(forward.origin, "anchor-gap");
});

test("planner: lane-change from a released NEXT task stays in NEXT", () => {
  const nextA = laneEntry({ lane: "next", path: "a.md", line: 1, text: "keep-a" });
  const nextC = laneEntry({ lane: "next", path: "c.md", line: 1, text: "keep-c" });
  const moved = laneEntry({ lane: "ready", path: "b.md", line: 4, text: "released" });
  const queue = makeQueue([nextA, nextC, moved]);
  const anchor = {
    day: DAY,
    key: moved.key,
    lane: "next",
    path: moved.path,
    line: moved.line,
    text: moved.originalMarkdown,
  };
  const cursor = {
    path: moved.path,
    line: moved.line,
    text: moved.originalMarkdown,
  };
  const forward = planLaneWalkJump(queue.entries, {
    direction: 1,
    cursor,
    anchor,
    todayText: DAY,
  });
  assert.equal(forward.entry.text, "keep-c");
  assert.equal(forward.origin, "lane-change");
  const back = planLaneWalkJump(queue.entries, {
    direction: -1,
    cursor,
    anchor,
    todayText: DAY,
  });
  assert.equal(back.entry.text, "keep-a");
  const origin = resolveLaneWalkOrigin(queue.entries, { cursor, anchor, todayText: DAY });
  assert.equal(origin.kind, "lane-change");
  assert.equal(origin.lane, "next");
});

test("planner: lane-change uses tuple insertion when the key is listed in another lane", () => {
  const queue = makeQueue([
    laneEntry({ lane: "next", path: "a.md", line: 1, text: "n" }),
    laneEntry({ lane: "ready", path: "b.md", line: 4, text: "moved" }),
  ]);
  const moved = queue.entries[1];
  const anchor = {
    day: DAY,
    key: moved.key,
    lane: "next",
    path: moved.path,
    line: moved.line,
    text: moved.originalMarkdown,
  };
  const origin = resolveLaneWalkOrigin(queue.entries, { anchor, todayText: DAY });
  assert.equal(origin.kind, "lane-change");
  const forward = planLaneWalkJump(queue.entries, {
    direction: 1,
    anchor,
    todayText: DAY,
  });
  assert.equal(forward.entry.lane, "ready");
  assert.equal(forward.origin, "lane-change");
});

test("planner: a cursor on a different live entry still wins over lane-change", () => {
  const queue = three();
  const moved = queue.entries[4];
  const other = queue.entries[1];
  const anchor = {
    day: DAY,
    key: moved.key,
    lane: "next",
    path: moved.path,
    line: moved.line,
    text: moved.originalMarkdown,
  };
  const cursor = {
    path: other.path,
    line: other.line,
    text: other.originalMarkdown,
  };
  const plan = planLaneWalkJump(queue.entries, {
    direction: 1,
    cursor,
    anchor,
    todayText: DAY,
  });
  assert.equal(plan.origin, "cursor");
  assert.equal(plan.entry.text, "n1");
});

test("lane jump: ]W PENDING → NEXT 1, NEXT → READY 1, READY → PENDING 1 wrapped", () => {
  const queue = three();
  const fromPending = planLaneWalkLaneJump(queue.entries, {
    direction: 1,
    cursor: { path: "walk.md", line: 1, text: queue.entries[0].originalMarkdown },
    todayText: DAY,
  });
  assert.equal(fromPending.entry.text, "n1");
  assert.equal(fromPending.laneRank, 1);
  assert.equal(fromPending.laneJump, true);
  const fromNext = planLaneWalkLaneJump(queue.entries, {
    direction: 1,
    cursor: { path: "walk.md", line: 3, text: queue.entries[2].originalMarkdown },
    todayText: DAY,
  });
  assert.equal(fromNext.entry.text, "r1");
  const fromReady = planLaneWalkLaneJump(queue.entries, {
    direction: 1,
    cursor: { path: "walk.md", line: 5, text: queue.entries[4].originalMarkdown },
    todayText: DAY,
  });
  assert.equal(fromReady.entry.text, "p1");
  assert.equal(fromReady.wrapped, true);
});

test("lane jump: [W reverse, including PENDING → READY 1 wrapped", () => {
  const queue = three();
  const fromPending = planLaneWalkLaneJump(queue.entries, {
    direction: -1,
    cursor: { path: "walk.md", line: 1, text: queue.entries[0].originalMarkdown },
    todayText: DAY,
  });
  assert.equal(fromPending.entry.text, "r1");
  assert.equal(fromPending.wrapped, true);
  const fromReady = planLaneWalkLaneJump(queue.entries, {
    direction: -1,
    cursor: { path: "walk.md", line: 5, text: queue.entries[4].originalMarkdown },
    todayText: DAY,
  });
  assert.equal(fromReady.entry.text, "n1");
});

test("lane jump: from mid-lane [W lands on the previous lane's first task", () => {
  const queue = three();
  const plan = planLaneWalkLaneJump(queue.entries, {
    direction: -1,
    cursor: { path: "walk.md", line: 4, text: queue.entries[3].originalMarkdown },
    todayText: DAY,
  });
  assert.equal(plan.entry.text, "p1");
  assert.equal(plan.laneRank, 1);
});

test("lane jump: empty lanes are skipped", () => {
  const queue = makeQueue([
    laneEntry({ lane: "pending", line: 1, text: "p" }),
    laneEntry({ lane: "ready", line: 2, text: "r" }),
  ]);
  const plan = planLaneWalkLaneJump(queue.entries, {
    direction: 1,
    cursor: { path: "walk.md", line: 1, text: queue.entries[0].originalMarkdown },
    todayText: DAY,
  });
  assert.equal(plan.entry.text, "r");
});

test("lane jump: one non-empty lane lands on its first task, wrapped", () => {
  const queue = makeQueue([
    laneEntry({ lane: "ready", line: 1, text: "r1" }),
    laneEntry({ lane: "ready", line: 2, text: "r2" }),
  ]);
  const plan = planLaneWalkLaneJump(queue.entries, {
    direction: 1,
    cursor: { path: "walk.md", line: 2, text: queue.entries[1].originalMarkdown },
    todayText: DAY,
  });
  assert.equal(plan.entry.text, "r1");
  assert.equal(plan.laneRank, 1);
  assert.equal(plan.wrapped, true);
});

test("lane jump: an emptied origin lane steps to its neighbours", () => {
  const queue = makeQueue([
    laneEntry({ lane: "pending", line: 1, text: "p" }),
    laneEntry({ lane: "ready", line: 2, text: "r" }),
  ]);
  const anchor = {
    day: DAY,
    key: "gone-next",
    lane: "next",
    path: "walk.md",
    line: 9,
    text: "x",
  };
  const forward = planLaneWalkLaneJump(queue.entries, {
    direction: 1,
    anchor,
    todayText: DAY,
  });
  assert.equal(forward.entry.text, "r");
  const back = planLaneWalkLaneJump(queue.entries, {
    direction: -1,
    anchor,
    todayText: DAY,
  });
  assert.equal(back.entry.text, "p");
});

test("lane jump: no origin lands on the first / last non-empty lane", () => {
  const queue = three();
  const forward = planLaneWalkLaneJump(queue.entries, { direction: 1, todayText: DAY });
  assert.equal(forward.entry.text, "p1");
  assert.equal(forward.wrapped, false);
  const back = planLaneWalkLaneJump(queue.entries, { direction: -1, todayText: DAY });
  assert.equal(back.entry.text, "r1");
  assert.equal(back.wrapped, false);
});

test("lane jump: counts cycle along occupied lanes", () => {
  const queue = three();
  const two = planLaneWalkLaneJump(queue.entries, {
    direction: 1,
    todayText: DAY,
    repeat: 2,
  });
  assert.equal(two.entry.text, "n1");
  const four = planLaneWalkLaneJump(queue.entries, {
    direction: 1,
    todayText: DAY,
    repeat: 4,
  });
  assert.equal(four.entry.text, "p1");
  assert.equal(four.wrapped, true);
});

test("lane jump: lane-change origin uses the anchor's lane", () => {
  const queue = three();
  const moved = queue.entries[4];
  const anchor = {
    day: DAY,
    key: moved.key,
    lane: "next",
    path: moved.path,
    line: moved.line,
    text: moved.originalMarkdown,
  };
  const cursor = {
    path: moved.path,
    line: moved.line,
    text: moved.originalMarkdown,
  };
  const plan = planLaneWalkLaneJump(queue.entries, {
    direction: 1,
    cursor,
    anchor,
    todayText: DAY,
  });
  assert.equal(plan.fromLane, "next");
  assert.equal(plan.entry.text, "r1");
});

test("lane jump: yesterday anchor is ignored", () => {
  const queue = three();
  const anchor = { ...buildLaneWalkAnchor(queue.entries[2], DAY), day: "2026-10-27" };
  const plan = planLaneWalkLaneJump(queue.entries, {
    direction: 1,
    anchor,
    todayText: DAY,
  });
  assert.equal(plan.entry.text, "p1");
  assert.equal(plan.wrapped, false);
});

test("lane jump: empty list returns empty", () => {
  assert.equal(planLaneWalkLaneJump([], { direction: 1, todayText: DAY }).kind, "empty");
});

test("runtime: same-note landing places cursor and leaves review state untouched", async () => {
  notices.length = 0;
  const queue = makeQueue([laneEntry({ lane: "pending", line: 1, text: "a" })]);
  const landings = [];
  const plugin = makePlugin({ queue, landings });
  const beforeAnchor = plugin.reviewAnchor;
  const ok = await plugin.jumpToLaneTask(1);
  assert.equal(ok, true);
  assert.deepEqual(landings, [queue.entries[0].key]);
  assert.equal(plugin.reviewAnchor, beforeAnchor);
  assert.deepEqual(plugin.reviewLanding, { path: "review.md" });
  assert.deepEqual(plugin.reviewWalkCurrent, { path: "review.md" });
  assert.ok(plugin.laneWalkAnchor && plugin.laneWalkAnchor.key === queue.entries[0].key);
});

test("runtime: three queued presses land three different entries in order", async () => {
  const queue = makeQueue([
    laneEntry({ lane: "pending", line: 1, text: "a" }),
    laneEntry({ lane: "pending", line: 2, text: "b" }),
    laneEntry({ lane: "next", line: 3, text: "c" }),
  ]);
  const landings = [];
  const plugin = makePlugin({ queue, landings });
  const cursors = [
    { path: "walk.md", line: 1, text: queue.entries[0].originalMarkdown },
    { path: "walk.md", line: 2, text: queue.entries[1].originalMarkdown },
    { path: "walk.md", line: 3, text: queue.entries[2].originalMarkdown },
  ];
  let cursorIndex = 0;
  plugin.getReviewJumpCursor = () => cursors[Math.min(cursorIndex, cursors.length - 1)];
  const pending = [plugin.jumpToLaneTask(1), plugin.jumpToLaneTask(1), plugin.jumpToLaneTask(1)];
  const originalLand = plugin.landOnWalkEntry;
  plugin.landOnWalkEntry = async (entry) => {
    const result = await originalLand(entry);
    cursorIndex += 1;
    return result;
  };
  await Promise.all(pending);
  assert.equal(landings.length, 3);
  assert.deepEqual(new Set(landings).size, 3);
});

test("runtime: stale line re-reads once, then shows the changed notice", async () => {
  notices.length = 0;
  const queue = makeQueue([laneEntry({ lane: "pending", line: 1, text: "a" })]);
  const plugin = makePlugin({ queue, failFirstStale: true });
  const ok = await plugin.jumpToLaneTask(1);
  assert.equal(ok, true);
  assert.equal(plugin._laneCalls.length, 2);
});

test("runtime: review lock swallows the press silently", async () => {
  notices.length = 0;
  const queue = makeQueue([laneEntry({ lane: "pending", line: 1, text: "a" })]);
  const plugin = makePlugin({ queue });
  plugin.reviewWalkBusy = () => true;
  const ok = await plugin.jumpToLaneTask(1);
  assert.equal(ok, false);
  assert.equal(notices.length, 0);
});

test("runtime: missing or old api shows the required notice", async () => {
  for (const laneWalk of [undefined, { version: 1, queue: () => ({}) }, { version: 0, queue: () => ({}) }]) {
    notices.length = 0;
    const queue = makeQueue([laneEntry({ lane: "pending", line: 1, text: "a" })]);
    const plugin = makePlugin({ queue });
    plugin.app.plugins.plugins["bob-ledger-tools"].api.laneWalk = laneWalk;
    const ok = await plugin.jumpToLaneTask(1);
    assert.equal(ok, false);
    assert.ok(notices.some((message) => String(message).includes("lane walk api required")));
  }
});

test("runtime: unavailable reasons show their notices and never the empty card", async () => {
  for (const [reason, fragment] of [
    ["tasks", "Tasks is still indexing"],
    ["today", "today's plan is still loading"],
  ]) {
    notices.length = 0;
    const plugin = makePlugin({ queue: { available: false, reason } });
    const ok = await plugin.jumpToLaneTask(1);
    assert.equal(ok, false);
    assert.ok(notices.some((message) => String(message).includes(fragment)));
  }
});

test("runtime: no vault write happens", async () => {
  const queue = makeQueue([laneEntry({ lane: "pending", line: 1, text: "a" })]);
  const plugin = makePlugin({ queue });
  let wrote = false;
  plugin.app.vault.modify = () => {
    wrote = true;
    return Promise.resolve();
  };
  await plugin.jumpToLaneTask(1);
  assert.equal(wrote, false);
});

test("runtime: jump-to-next-lane / jump-to-prev-lane are registered; first/last are gone", () => {
  const plugin = new NavigationHotkeysPlugin();
  const commands = [];
  plugin.app = {
    workspace: {
      getActiveFile: () => null,
      on: () => ({}),
      onLayoutReady: () => {},
    },
  };
  plugin.addCommand = (spec) => commands.push(spec);
  plugin.register = () => {};
  plugin.registerEvent = () => {};
  plugin.registerEditorExtension = () => {};
  plugin.registerVimMappingsWhenReady = () => {};
  plugin.registerVimJumpHistoryVaultEvents = () => {};
  plugin.registerOpenTaskJumpInputListeners = () => {};
  plugin.registerReviewRefreshInputListeners = () => {};
  plugin.registerCountedTransclusionToggleInputListeners = () => {};
  plugin.registerCountedBulletPropertyInputListeners = () => {};
  plugin.registerCountedTaskMoveInputListeners = () => {};
  plugin.registerCountedLaneToggleInputListeners = () => {};
  plugin.registerClearSearchHighlightInputListeners = () => {};
  plugin.captureActiveFilePosition = () => {};
  plugin.refreshDashScrollCaptureTarget = () => {};
  plugin.ensureTemplaterNewNoteTrigger = () => {};
  plugin.onload();
  const ids = commands.map((command) => command.id);
  assert.ok(ids.includes("jump-to-next-lane"));
  assert.ok(ids.includes("jump-to-prev-lane"));
  assert.ok(ids.includes("jump-to-next-lane-task"));
  assert.ok(ids.includes("jump-to-prev-lane-task"));
  assert.ok(!ids.includes("jump-to-first-lane-task"));
  assert.ok(!ids.includes("jump-to-last-lane-task"));
  const nextLane = commands.find((command) => command.id === "jump-to-next-lane");
  assert.equal(nextLane.name, "Jump to the first task of the next lane off today's plan");
  assert.equal(Object.hasOwn(nextLane, "hotkeys"), false);
});

test("runtime: counted ]W consumes the count before any await", async () => {
  const order = [];
  const queue = three();
  const plugin = makePlugin({ queue });
  plugin.consumePendingLaneWalkRepeat = (options) => {
    order.push("count");
    return 2;
  };
  const originalLand = plugin.landOnWalkEntry;
  plugin.landOnWalkEntry = async (entry) => {
    order.push("land");
    return originalLand(entry);
  };
  await plugin.jumpToLaneTask(1, { laneJump: true });
  assert.equal(order[0], "count");
  assert.ok(order.indexOf("count") < order.indexOf("land"));
  assert.equal(plugin._laneCalls[0], queue.entries[2].key);
});

test("runtime: lane jumps use the lane planner on stale retry", async () => {
  const queue = three();
  const plugin = makePlugin({ queue, failFirstStale: true });
  plugin.getReviewJumpCursor = () => ({
    path: "walk.md",
    line: 1,
    text: queue.entries[0].originalMarkdown,
  });
  await plugin.jumpToLaneTask(1, { laneJump: true });
  assert.equal(plugin._laneCalls.length, 2);
  assert.equal(plugin._laneCalls[0], queue.entries[2].key);
  assert.equal(plugin._laneCalls[1], queue.entries[2].key);
});

test("runtime: unknown-lane entries are dropped", async () => {
  const ghost = laneEntry({ lane: "pending", line: 1, text: "ghost" });
  ghost.lane = "ghost";
  const keep = laneEntry({ lane: "pending", line: 2, text: "keep" });
  const plugin = makePlugin({
    queue: {
      available: true,
      entries: [ghost, keep],
      counts: {
        pending: 1,
        next: 0,
        ready: 0,
        total: 1,
        todayPending: 0,
        todayNext: 0,
        todayReady: 0,
        reviewReady: 0,
      },
    },
  });
  await plugin.jumpToLaneTask(1);
  assert.equal(plugin._laneCalls[0], keep.key);
});

test("toast: model and text for pending, next, wrapped, work log, created", () => {
  const queue = makeQueue([
    laneEntry({ lane: "pending", line: 1, text: "fix sync" }),
    laneEntry({ lane: "next", line: 2, text: "write docs" }),
  ]);
  const pending = buildLaneWalkNoticeModel(queue.entries[0], {
    rank: 1,
    total: 2,
    laneRank: 1,
    laneTotal: 1,
    wrapped: false,
    list: queue.entries,
    workLog: { date: "2026-10-28", summary: "did the thing" },
  });
  assert.equal(pending.laneLabel, "PENDING");
  assert.ok(pending.text.includes("PENDING 1 of 1"));
  assert.ok(pending.text.includes("walk 1/2"));
  assert.ok(pending.text.includes("🛠️ Oct 28"));
  assert.ok(pending.text.includes("Alt+N release"));
  const next = buildLaneWalkNoticeModel(queue.entries[1], {
    rank: 2,
    total: 2,
    laneRank: 1,
    laneTotal: 1,
    wrapped: true,
    list: queue.entries,
  });
  assert.ok(next.text.includes("NEXT 1 of 1"));
  assert.ok(next.text.includes("wrapped around"));
  assert.ok(next.text.includes("Alt+N release"));
  assert.equal(formatLaneWalkNoticeText(next), next.text);
});

test("toast: READY model uses the Alt+N next hint", () => {
  const queue = makeQueue([
    { ...laneEntry({ lane: "ready", line: 3, text: "backlog" }), created: "2026-10-03" },
  ]);
  const model = buildLaneWalkNoticeModel(queue.entries[0], {
    rank: 1,
    total: 1,
    laneRank: 1,
    laneTotal: 1,
    wrapped: false,
    list: queue.entries,
  });
  assert.equal(model.lane, "ready");
  assert.equal(model.laneLabel, "READY");
  assert.equal(model.hintAction, "next");
  assert.ok(model.text.includes("READY 1 of 1"));
  assert.ok(model.text.includes("created Oct 3"));
  assert.ok(model.text.includes("Alt+N next"));
  assert.ok(!model.text.includes("Alt+N release"));
});

test("toast: ambiguous or malformed work log means no chip", () => {
  const content = [
    "- [/] #task a",
    "\t- 🛠️ **WORK LOG**",
    "\t\t- *2026-10-28* — good",
    "\t- 🛠️ **WORK LOG**",
    "\t\t- *2026-10-27* — older",
  ].join("\n");
  assert.equal(readLatestWorkLog(content, 0), null);
  const bad = ["- [/] #task a", "\t- 🛠️ **WORK LOG**", "\t\t- not a log line"].join("\n");
  assert.equal(readLatestWorkLog(bad, 0), null);
});

test("toast: rail switches past 30 entries and empty variants read correctly", () => {
  const many = [];
  for (let index = 1; index <= 40; index += 1) {
    many.push(
      laneEntry({
        lane: index <= 10 ? "pending" : index <= 20 ? "next" : "ready",
        line: index,
        text: `t${index}`,
      }),
    );
  }
  const queue = makeQueue(many);
  const model = buildLaneWalkNoticeModel(queue.entries[0], {
    rank: 1,
    total: 40,
    laneRank: 1,
    laneTotal: 10,
    wrapped: false,
    list: queue.entries,
  });
  assert.equal(model.railMode, "bar");
  const few = buildLaneWalkNoticeModel(queue.entries[0], {
    rank: 1,
    total: 40,
    laneRank: 1,
    laneTotal: 10,
    wrapped: false,
    list: queue.entries.slice(0, 8),
  });
  assert.equal(few.railMode, "dots");
  const withToday = buildLaneWalkEmptyNoticeModel({
    todayPending: 2,
    todayNext: 1,
    todayReady: 4,
  });
  assert.ok(withToday.text.includes("TODAY 7"));
  assert.ok(withToday.text.includes("Every Pending, Next, and Ready task is on today's plan"));
  const review = buildLaneWalkEmptyNoticeModel({ reviewReady: 3, todayReady: 1 });
  assert.ok(review.text.includes("REVIEW 3"));
  assert.ok(review.text.includes("]s walks NEW and ROTTEN"));
  const bare = buildLaneWalkEmptyNoticeModel({});
  assert.ok(bare.text.includes("No Pending, Next, or Ready tasks"));
});

test("toast: renderer emits is-ready with an empty box, gaps, and current-lane", () => {
  const queue = three();
  const model = buildLaneWalkNoticeModel(queue.entries[4], {
    rank: 5,
    total: 6,
    laneRank: 1,
    laneTotal: 2,
    wrapped: false,
    list: queue.entries,
  });
  const root = new FakeEl("div");
  renderLaneWalkNoticeFragment(model, root);
  const card = root.children[0];
  assert.ok(classOf(card).includes("is-ready"));
  const box = collect(card, (node) => classOf(node).includes("bob-nh-lane-walk-box"))[0];
  assert.ok(classOf(box).includes("is-empty"));
  assert.equal(box.text, null);
  const gaps = collect(card, (node) => classOf(node).includes("bob-nh-lane-walk-gap"));
  assert.equal(gaps.length, 2);
  const dots = collect(card, (node) => classOf(node).includes("bob-nh-lane-walk-dot"));
  assert.ok(dots.some((dot) => classOf(dot).includes("is-current-lane")));
  const hint = collect(card, (node) => classOf(node).includes("bob-nh-lane-walk-hint"))[0];
  assert.ok(hint.children.some((child) => child.text === " next"));
});

test("toast: bar mode has three segments, current-lane class, caret in the current segment", () => {
  const many = [];
  for (let index = 1; index <= 40; index += 1) {
    many.push(
      laneEntry({
        lane: index <= 5 ? "pending" : index <= 13 ? "next" : "ready",
        line: index,
        text: `t${index}`,
      }),
    );
  }
  const queue = makeQueue(many);
  const current = queue.entries[20];
  const model = buildLaneWalkNoticeModel(current, {
    rank: 21,
    total: 40,
    laneRank: current.laneRank,
    laneTotal: current.laneTotal,
    wrapped: false,
    list: queue.entries,
  });
  const root = new FakeEl("div");
  renderLaneWalkNoticeFragment(model, root);
  const pending = collect(root, (node) => classOf(node).includes("bob-nh-lane-walk-bar-pending"));
  const next = collect(root, (node) => classOf(node).includes("bob-nh-lane-walk-bar-next"));
  const ready = collect(root, (node) => classOf(node).includes("bob-nh-lane-walk-bar-ready"));
  assert.equal(pending.length, 1);
  assert.equal(next.length, 1);
  assert.equal(ready.length, 1);
  assert.ok(classOf(ready[0]).includes("is-current-lane"));
  const caret = collect(ready[0], (node) => classOf(node).includes("bob-nh-lane-walk-caret"));
  assert.equal(caret.length, 1);
  assert.ok(String(caret[0].attrs.style || "").includes("left:"));
});

test("toast: empty variants render review, today-only, and none", () => {
  const review = buildLaneWalkEmptyNoticeModel({ reviewReady: 2, todayPending: 1 });
  const reviewRoot = new FakeEl("div");
  renderLaneWalkEmptyFragment(review, reviewRoot);
  const reviewCard = reviewRoot.children[0];
  assert.ok(
    collect(reviewCard, (node) => node.text === "Ready tasks are waiting in review").length,
  );
  assert.ok(collect(reviewCard, (node) => node.text === "REVIEW 2").length);
  assert.ok(collect(reviewCard, (node) => node.text === "TODAY 1").length);
  assert.ok(collect(reviewCard, (node) => node.text === "]s").length);

  const today = buildLaneWalkEmptyNoticeModel({ todayReady: 3 });
  const todayRoot = new FakeEl("div");
  renderLaneWalkEmptyFragment(today, todayRoot);
  assert.ok(
    collect(todayRoot, (node) =>
      String(node.text || "").includes("Every Pending, Next, and Ready task"),
    ).length,
  );

  const none = buildLaneWalkEmptyNoticeModel({});
  const noneRoot = new FakeEl("div");
  renderLaneWalkEmptyFragment(none, noneRoot);
  assert.ok(
    collect(noneRoot, (node) => node.text === "No Pending, Next, or Ready tasks").length,
  );
});

test("toast: previous lane-walk notice is hidden and fallback text is used", () => {
  notices.length = 0;
  const queue = makeQueue([laneEntry({ lane: "pending", line: 1, text: "a" })]);
  const plugin = makePlugin({ queue });
  let hidden = 0;
  plugin.laneWalkNotice = { hide: () => { hidden += 1; } };
  const model = buildLaneWalkNoticeModel(queue.entries[0], {
    rank: 1,
    total: 1,
    laneRank: 1,
    laneTotal: 1,
    wrapped: false,
    list: queue.entries,
  });
  helpers.showLaneWalkNotice(plugin, model);
  assert.equal(hidden, 1);
  assert.equal(notices.length, 1);
});

test("identity: lane keys match the queue key helper", () => {
  const queue = makeQueue([laneEntry({ lane: "pending", line: 7, text: "a" })]);
  assert.equal(queue.entries[0].key, reviewQueueEntryKey(queue.entries[0]));
});
