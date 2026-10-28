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
  // Keep the fallback path: no DOM in these tests.
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
  buildLaneWalkAnchor,
  buildLaneWalkNoticeModel,
  buildLaneWalkEmptyNoticeModel,
  formatLaneWalkNoticeText,
  readLatestWorkLog,
  reviewQueueEntryKey,
} = helpers;

const DAY = "2026-10-28";

function laneEntry({ lane, path = "walk.md", line, text }) {
  const key = `${path}:${line}`;
  return {
    key,
    path,
    line,
    lineNumber: line - 1,
    originalMarkdown: `- [${lane === "pending" ? "/" : "*"}] #task ${text}`,
    text,
    blockId: null,
    lane,
    laneLabel: lane === "pending" ? "PENDING" : "NEXT",
    created: null,
    rank: 0,
    total: 0,
    laneRank: 0,
    laneTotal: 0,
  };
}

function rankedList(rows) {
  const pending = rows.filter((row) => row.lane === "pending").length;
  const next = rows.length - pending;
  let seenPending = 0;
  let seenNext = 0;
  return rows.map((row, index) => {
    const laneRank = row.lane === "pending" ? (seenPending += 1) : (seenNext += 1);
    return {
      ...row,
      rank: index + 1,
      total: rows.length,
      laneRank,
      laneTotal: row.lane === "pending" ? pending : next,
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
      total: entries.length,
      todayPending: 0,
      todayNext: 0,
    },
  };
}

function makePlugin({ queue, cursor = null, landings = null, failFirstStale = false }) {
  const plugin = Object.create(NavigationHotkeysPlugin.prototype);
  plugin.app = {
    plugins: {
      plugins: {
        "bob-ledger-tools": {
          api: { laneWalk: { version: 1, queue: () => queue } },
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

test("planner: endpoints ignore cursor, anchor, and count", () => {
  const queue = makeQueue([
    laneEntry({ lane: "pending", line: 1, text: "a" }),
    laneEntry({ lane: "next", line: 2, text: "b" }),
  ]);
  const cursor = { path: "walk.md", line: 2, text: queue.entries[1].originalMarkdown };
  const anchor = buildLaneWalkAnchor(queue.entries[1], DAY);
  const first = planLaneWalkJump(queue.entries, {
    direction: 1,
    cursor,
    anchor,
    todayText: DAY,
    repeat: 5,
    endpoint: "first",
  });
  assert.equal(first.entry.text, "a");
  const last = planLaneWalkJump(queue.entries, {
    direction: 1,
    cursor,
    anchor,
    todayText: DAY,
    repeat: 5,
    endpoint: "last",
  });
  assert.equal(last.entry.text, "b");
});

test("planner: empty list returns empty", () => {
  assert.equal(planLaneWalkJump([], { direction: 1, todayText: DAY }).kind, "empty");
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
  // Step from a moving cursor so each press advances.
  const cursors = [
    { path: "walk.md", line: 1, text: queue.entries[0].originalMarkdown },
    { path: "walk.md", line: 2, text: queue.entries[1].originalMarkdown },
    { path: "walk.md", line: 3, text: queue.entries[2].originalMarkdown },
  ];
  let cursorIndex = 0;
  plugin.getReviewJumpCursor = () => cursors[Math.min(cursorIndex, cursors.length - 1)];
  const pending = [plugin.jumpToLaneTask(1), plugin.jumpToLaneTask(1), plugin.jumpToLaneTask(1)];
  // Advance the stubbed cursor as landings complete.
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
  for (const laneWalk of [undefined, { version: 0, queue: () => ({}) }]) {
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
  assert.equal(formatLaneWalkNoticeText(next), next.text);
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
    many.push(laneEntry({ lane: index <= 20 ? "pending" : "next", line: index, text: `t${index}` }));
  }
  const queue = makeQueue(many);
  const model = buildLaneWalkNoticeModel(queue.entries[0], {
    rank: 1,
    total: 40,
    laneRank: 1,
    laneTotal: 20,
    wrapped: false,
    list: queue.entries,
  });
  assert.equal(model.railMode, "bar");
  const few = buildLaneWalkNoticeModel(queue.entries[0], {
    rank: 1,
    total: 40,
    laneRank: 1,
    laneTotal: 20,
    wrapped: false,
    list: queue.entries.slice(0, 8),
  });
  assert.equal(few.railMode, "dots");
  const withToday = buildLaneWalkEmptyNoticeModel({ todayPending: 2, todayNext: 1 });
  assert.ok(withToday.text.includes("TODAY 3"));
  const bare = buildLaneWalkEmptyNoticeModel({});
  assert.ok(bare.text.includes("No Pending or Next tasks"));
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
