// `[S` / `]S` cycle occupied review groups and always land on the
// destination group's first due task (plan:202610/review_group_navigation).
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const notices = [];

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    class EmptyClass {}
    class TestNotice {
      constructor(message) {
        notices.push(String(message));
      }
    }
    return {
      MarkdownView: EmptyClass,
      Modal: EmptyClass,
      Notice: TestNotice,
      Plugin: EmptyClass,
      parseYaml: () => ({}),
    };
  }
  if (request === "@codemirror/view") {
    return { EditorView: class EditorView {} };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const NavigationHotkeysPlugin = require("../plugins/bob-navigation-hotkeys/main.js");
const { helpers } = NavigationHotkeysPlugin;
Module._load = originalLoad;

const {
  planReviewGroupJump,
  resolveReviewGroupOriginTier,
  reviewGroupOccupiedTiers,
  reviewAnchorIsAnswerEvidence,
  reviewGroupExcludedKeys,
  REVIEW_GROUP_TIER_ORDER,
  buildReviewAnchor,
  reviewWalkCurrentRef,
  planReviewJump,
  reviewEntryMachineTier,
} = helpers;

const DAY = "2026-10-29";
const TIERS = [
  "pre",
  "new",
  "projects",
  "pending",
  "next",
  "recurring",
  "tickler",
  "rotten",
  "post",
];

function entry({
  tier,
  path,
  line,
  text,
  rank,
  tierRank = 1,
  tierTotal = 1,
  extra = {},
}) {
  const markdown =
    extra.originalMarkdown ||
    (tier === "next"
      ? `- [*] #task ${text}`
      : tier === "pending"
        ? `- [/] #task ${text}`
        : `- [ ] #task ${text}`);
  return {
    key: `${path}:${line}`,
    path,
    line,
    originalMarkdown: markdown,
    text,
    state: null,
    bucket: null,
    tier,
    tierLabel: String(tier || "").toUpperCase(),
    lane: "ready",
    fresh: null,
    dueOn: null,
    daysOverdue: null,
    interval: 7,
    rank,
    tierRank,
    tierTotal,
    ...extra,
  };
}

function rowsForTiers(tiers, perTier = 2) {
  const rows = [];
  let rank = 1;
  for (const tier of tiers) {
    for (let index = 1; index <= perTier; index += 1) {
      rows.push(
        entry({
          tier,
          path: `${tier}.md`,
          line: index,
          text: `${tier} ${index}`,
          rank,
          tierRank: index,
          tierTotal: perTier,
        }),
      );
      rank += 1;
    }
  }
  return rows;
}

function nineTierQueue() {
  return rowsForTiers(TIERS, 2);
}

function cursorFor(row) {
  return {
    path: row.path,
    line: row.line,
    text: row.originalMarkdown,
  };
}

function jump(queue, direction, extra = {}) {
  return planReviewGroupJump(queue, {
    direction,
    todayText: DAY,
    ...extra,
  });
}

function firstOf(queue, tier, tierRank = 1) {
  return queue.find(
    (row) =>
      reviewEntryMachineTier(row) === tier && row.tierRank === tierRank,
  );
}

test("canonical group order includes legacy references between tickler and rotten", () => {
  assert.deepEqual(REVIEW_GROUP_TIER_ORDER, [
    "pre",
    "new",
    "projects",
    "pending",
    "next",
    "recurring",
    "tickler",
    "references",
    "rotten",
    "post",
  ]);
});

test("nine current tiers: both directions from first, middle, and last rows land on group row one", () => {
  const queue = nineTierQueue();
  assert.equal(reviewGroupOccupiedTiers(queue).length, 9);
  for (const tier of TIERS) {
    const first = firstOf(queue, tier, 1);
    const last = firstOf(queue, tier, 2);
    for (const origin of [first, last]) {
      const forward = jump(queue, 1, { cursor: cursorFor(origin) });
      const back = jump(queue, -1, { cursor: cursorFor(origin) });
      const originIndex = TIERS.indexOf(tier);
      const nextTier = TIERS[(originIndex + 1) % TIERS.length];
      const prevTier = TIERS[(originIndex + TIERS.length - 1) % TIERS.length];
      assert.equal(forward.kind, "jump", `${tier} forward`);
      assert.equal(forward.entry.key, firstOf(queue, nextTier).key);
      assert.equal(forward.entry.tierRank, 1);
      assert.equal(back.kind, "jump", `${tier} back`);
      assert.equal(back.entry.key, firstOf(queue, prevTier).key);
      assert.equal(back.entry.tierRank, 1);
      assert.equal(forward.wrapped, tier === "post");
      assert.equal(back.wrapped, tier === "pre");
    }
  }
});

test("empty tiers are skipped; wrap uses occupied ends", () => {
  const queue = rowsForTiers(["new", "next", "post"], 2);
  const next = firstOf(queue, "next", 2);
  const forward = jump(queue, 1, { cursor: cursorFor(next) });
  const back = jump(queue, -1, { cursor: cursorFor(next) });
  const two = jump(queue, 1, { cursor: cursorFor(next), repeat: 2 });
  assert.equal(forward.entry.key, firstOf(queue, "post").key);
  assert.equal(forward.wrapped, false);
  assert.equal(back.entry.key, firstOf(queue, "new").key);
  assert.equal(back.wrapped, false);
  assert.equal(two.entry.key, firstOf(queue, "new").key);
  assert.equal(two.wrapped, true);
  assert.equal(two.entry.tierRank, 1);
});

test("absent PRE and POST wrap at occupied ends", () => {
  const queue = rowsForTiers(["new", "pending", "rotten"], 1);
  const fromNew = jump(queue, -1, {
    cursor: cursorFor(firstOf(queue, "new")),
  });
  const fromRotten = jump(queue, 1, {
    cursor: cursorFor(firstOf(queue, "rotten")),
  });
  assert.equal(fromNew.entry.key, firstOf(queue, "rotten").key);
  assert.equal(fromNew.wrapped, true);
  assert.equal(fromRotten.entry.key, firstOf(queue, "new").key);
  assert.equal(fromRotten.wrapped, true);
});

test("one occupied group cycles to its first row, including from that row", () => {
  const queue = rowsForTiers(["next"], 3);
  const first = firstOf(queue, "next", 1);
  const middle = firstOf(queue, "next", 2);
  for (const origin of [first, middle]) {
    const forward = jump(queue, 1, { cursor: cursorFor(origin) });
    const back = jump(queue, -1, { cursor: cursorFor(origin) });
    assert.equal(forward.entry.key, first.key);
    assert.equal(forward.wrapped, true);
    assert.equal(back.entry.key, first.key);
    assert.equal(back.wrapped, true);
  }
});

test("one-row queue and empty queue", () => {
  const one = rowsForTiers(["new"], 1);
  const cycled = jump(one, 1, { cursor: cursorFor(one[0]) });
  assert.equal(cycled.kind, "jump");
  assert.equal(cycled.entry.key, one[0].key);
  assert.equal(cycled.wrapped, true);
  assert.deepEqual(planReviewGroupJump([], { direction: 1 }), { kind: "empty" });
  assert.deepEqual(planReviewGroupJump(null, { direction: -1 }), {
    kind: "empty",
  });
});

test("counted jumps wrap with modular arithmetic, including multiple circuits", () => {
  const queue = rowsForTiers(["new", "next", "post"], 1);
  const origin = firstOf(queue, "next");
  const one = jump(queue, 1, { cursor: cursorFor(origin), repeat: 1 });
  const two = jump(queue, 1, { cursor: cursorFor(origin), repeat: 2 });
  const three = jump(queue, 1, { cursor: cursorFor(origin), repeat: 3 });
  const four = jump(queue, 1, { cursor: cursorFor(origin), repeat: 4 });
  const huge = jump(queue, 1, { cursor: cursorFor(origin), repeat: 1001 });
  assert.equal(one.entry.key, firstOf(queue, "post").key);
  assert.equal(one.wrapped, false);
  assert.equal(two.entry.key, firstOf(queue, "new").key);
  assert.equal(two.wrapped, true);
  assert.equal(three.entry.key, firstOf(queue, "next").key);
  assert.equal(three.wrapped, true);
  assert.equal(four.entry.key, firstOf(queue, "post").key);
  assert.equal(four.wrapped, true);
  assert.equal(huge.entry.key, two.entry.key);
  assert.equal(huge.wrapped, true);
});

test("no origin: ]S first occupied, [S last occupied, initial entry is not a wrap", () => {
  const queue = rowsForTiers(["new", "next", "post"], 2);
  const forward = jump(queue, 1);
  const back = jump(queue, -1);
  const twoForward = jump(queue, 1, { repeat: 2 });
  const fourForward = jump(queue, 1, { repeat: 4 });
  assert.equal(forward.entry.key, firstOf(queue, "new").key);
  assert.equal(forward.wrapped, false);
  assert.equal(forward.originTier, null);
  assert.equal(back.entry.key, firstOf(queue, "post").key);
  assert.equal(back.wrapped, false);
  assert.equal(twoForward.entry.key, firstOf(queue, "next").key);
  assert.equal(twoForward.wrapped, false);
  assert.equal(fourForward.entry.key, firstOf(queue, "new").key);
  assert.equal(fourForward.wrapped, true);
});

test("origin prefers a live cursor row over the previous landing", () => {
  const queue = nineTierQueue();
  const pending = firstOf(queue, "pending", 2);
  const next = firstOf(queue, "next", 1);
  const current = reviewWalkCurrentRef(next, next.path, DAY);
  const landing = buildReviewAnchor(queue, [next.key], next.rank, DAY);
  const plan = jump(queue, 1, {
    cursor: cursorFor(pending),
    current,
    anchor: landing,
  });
  assert.equal(plan.originTier, "pending");
  assert.equal(plan.entry.key, firstOf(queue, "next").key);
});

test("off-queue cursor uses a live same-day current task", () => {
  const queue = nineTierQueue();
  const next = firstOf(queue, "next", 2);
  const current = reviewWalkCurrentRef(next, next.path, DAY);
  const plan = jump(queue, 1, {
    cursor: { path: "elsewhere.md", line: 9, text: "- [ ] #task no" },
    current,
  });
  assert.equal(plan.originTier, "next");
  assert.equal(plan.entry.key, firstOf(queue, "recurring").key);
});

test("emptied origin group uses the same-day anchor tier and skips that group", () => {
  const queue = rowsForTiers(["new", "next", "post"], 1);
  const next = firstOf(queue, "next");
  const answered = buildReviewAnchor(queue, [next.key], next.rank, DAY, {
    answered: true,
  });
  assert.equal(reviewAnchorIsAnswerEvidence(answered), true);
  const remaining = jump(queue, 1, { anchor: answered });
  assert.equal(remaining.originTier, "next");
  assert.equal(remaining.entry.key, firstOf(queue, "post").key);
  const excluded = reviewGroupExcludedKeys(queue, {
    anchor: answered,
    todayText: DAY,
  });
  assert.equal(excluded.has(next.key), true);
  assert.ok(!remaining.entry || remaining.entry.key !== next.key);
});

test("a landing anchor does not hide its row on the next circuit", () => {
  const queue = rowsForTiers(["next"], 2);
  const first = firstOf(queue, "next", 1);
  const landing = buildReviewAnchor(queue, [first.key], first.rank, DAY);
  assert.equal(reviewAnchorIsAnswerEvidence(landing), false);
  const excluded = reviewGroupExcludedKeys(queue, {
    anchor: landing,
    todayText: DAY,
  });
  assert.equal(excluded.size, 0);
  const cycled = jump(queue, 1, {
    cursor: cursorFor(first),
    anchor: landing,
  });
  assert.equal(cycled.entry.key, first.key);
  assert.equal(cycled.total, 2);
});

test("answeredKeys exclude only identity-verified same-day rows", () => {
  const queue = rowsForTiers(["new", "next"], 1);
  const next = firstOf(queue, "next");
  const reused = {
    ...next,
    originalMarkdown: "- [ ] #task someone else",
    text: "someone else",
  };
  const answeredKeys = {
    day: DAY,
    keys: new Set([next.key]),
    texts: new Map([[next.key, next.originalMarkdown]]),
  };
  const live = jump(queue, 1, { answeredKeys, cursor: cursorFor(queue[0]) });
  assert.equal(live.entry.key, queue[0].key);
  assert.equal(live.wrapped, true);
  const shifted = jump([queue[0], reused], 1, {
    answeredKeys,
    cursor: cursorFor(queue[0]),
  });
  assert.equal(shifted.entry.key, reused.key);
});

test("old-day anchors and current refs cannot supply an origin", () => {
  const queue = rowsForTiers(["new", "next", "post"], 1);
  const next = firstOf(queue, "next");
  const yesterday = buildReviewAnchor(queue, [next.key], next.rank, "2026-10-28", {
    answered: true,
  });
  const staleCurrent = reviewWalkCurrentRef(next, next.path, "2026-10-28");
  const plan = jump(queue, 1, {
    cursor: { path: "no.md", line: 1, text: "nope" },
    current: staleCurrent,
    anchor: yesterday,
  });
  assert.equal(plan.originTier, null);
  assert.equal(plan.entry.key, firstOf(queue, "new").key);
  assert.equal(plan.wrapped, false);
});

test("duplicate text prefers the cursor line; a reused line number is not enough", () => {
  const twins = [
    entry({
      tier: "next",
      path: "dup.md",
      line: 1,
      text: "Same",
      rank: 1,
      extra: { originalMarkdown: "- [*] #task Same" },
    }),
    entry({
      tier: "next",
      path: "dup.md",
      line: 4,
      text: "Same",
      rank: 2,
      tierRank: 2,
      extra: { originalMarkdown: "- [*] #task Same" },
    }),
    entry({
      tier: "post",
      path: "post.md",
      line: 1,
      text: "Close",
      rank: 3,
    }),
  ];
  const fromSecond = jump(twins, 1, {
    cursor: { path: "dup.md", line: 4, text: "- [*] #task Same" },
  });
  assert.equal(fromSecond.originTier, "next");
  assert.equal(fromSecond.entry.key, "post.md:1");
  const lineOnly = jump(twins, 1, {
    cursor: { path: "dup.md", line: 4, text: "- [ ] #task Other occupant" },
  });
  assert.equal(lineOnly.originTier, null);
  assert.equal(lineOnly.entry.key, "dup.md:1");
});

test("legacy returned, resurfaced, supported REFERENCES, and unknown tiers", () => {
  const queue = [
    entry({
      tier: "returned",
      path: "ret.md",
      line: 1,
      text: "Returned",
      rank: 1,
    }),
    entry({
      tier: "tickler",
      path: "tick.md",
      line: 1,
      text: "Tickler",
      rank: 2,
      extra: { state: "resurfaced" },
    }),
    entry({
      tier: "references",
      path: "ref.md",
      line: 1,
      text: "Legacy ref",
      rank: 3,
      extra: { legacyReferenceTier: true },
    }),
    entry({
      tier: "mystery",
      path: "x.md",
      line: 1,
      text: "Unknown",
      rank: 4,
    }),
    entry({
      tier: "rotten",
      path: "rot.md",
      line: 1,
      text: "Rotten",
      rank: 5,
    }),
  ];
  assert.deepEqual(reviewGroupOccupiedTiers(queue), [
    "tickler",
    "references",
    "rotten",
  ]);
  const fromTickler = jump(queue, 1, { cursor: cursorFor(queue[0]) });
  assert.equal(fromTickler.originTier, "tickler");
  assert.equal(fromTickler.entry.key, "ref.md:1");
  const fromRef = jump(queue, 1, { cursor: cursorFor(queue[2]) });
  assert.equal(fromRef.entry.key, "rot.md:1");
  const unknownOrigin = resolveReviewGroupOriginTier(queue, {
    originResolved: true,
    originTier: "not-a-tier",
  });
  assert.equal(unknownOrigin, "not-a-tier");
  const fromUnknown = jump(queue, 1, {
    originResolved: true,
    originTier: "not-a-tier",
  });
  assert.equal(fromUnknown.entry.key, "ret.md:1");
});

test("pinned origin on retry recomputes from the original group, not the failed target", () => {
  const before = rowsForTiers(["new", "next", "recurring", "post"], 1);
  const after = rowsForTiers(["new", "next", "post"], 1);
  const origin = firstOf(before, "next");
  const first = jump(before, 1, { cursor: cursorFor(origin) });
  assert.equal(first.entry.key, firstOf(before, "recurring").key);
  const retried = jump(after, 1, {
    originResolved: true,
    originTier: first.originTier,
  });
  assert.equal(retried.originTier, "next");
  assert.equal(retried.entry.key, firstOf(after, "post").key);
});

test("rank and total count remaining unanswered rows, including visited ones", () => {
  const queue = nineTierQueue();
  const next = firstOf(queue, "next", 2);
  const landing = buildReviewAnchor(queue, [next.key], next.rank, DAY);
  const plan = jump(queue, 1, {
    cursor: cursorFor(next),
    anchor: landing,
  });
  assert.equal(plan.total, queue.length);
  assert.equal(plan.rank, queue.findIndex((row) => row.tier === "recurring") + 1);
});

function groupMethodHarness({ queues, landings }) {
  const seen = { landCalls: [], landEntries: [] };
  const plugin = new NavigationHotkeysPlugin();
  plugin.register = () => {};
  const queueCalls = [];
  const freshness = {
    version: 4,
    queue: () => {
      queueCalls.push(true);
      return queues[Math.min(queueCalls.length, queues.length) - 1];
    },
    counts: () => ({ upkeepToday: 3, refreshedToday: 3 }),
    stampLine: () => {
      throw new Error("group jumps never stamp");
    },
    setRefreshLine: () => {
      throw new Error("group jumps never set refresh");
    },
    keepLine: () => {
      throw new Error("group jumps never keep");
    },
  };
  plugin.app = {
    plugins: {
      plugins: { "bob-ledger-tools": { api: { version: 3, freshness } } },
    },
    vault: {
      getAbstractFileByPath: () => {
        throw new Error("group tests stub landing; vault is never read");
      },
    },
    workspace: { getActiveFile: () => null, on: () => ({}) },
  };
  plugin.getActiveMarkdownView = () => null;
  plugin.reviewAnchor = null;
  plugin.reviewWalkCurrent = null;
  plugin.reviewAnsweredKeys = { day: null, keys: new Set(), texts: new Map() };
  plugin.landOnReviewQueueEntry = async (row) => {
    seen.landCalls.push(row);
    seen.landEntries.push(row && row.key);
    return landings[Math.min(seen.landCalls.length, landings.length) - 1];
  };
  plugin.reviewQuickRollLine = async () => "";
  return { plugin, seen };
}

function vimReviewEditor(options = {}) {
  const path = options.path || "t0.md";
  const lineText = options.text || "- [ ] #task t0";
  const line = Number.isInteger(options.line) ? options.line : 0;
  const inputState = {
    keyBuffer: [],
    prefixRepeat: Array.isArray(options.prefixRepeat)
      ? options.prefixRepeat.slice()
      : [],
    motionRepeat: [],
    reason: "",
    getRepeat: () => null,
  };
  const cm = {
    getCursor: () => ({ line, ch: 0 }),
    state: {
      vim: {
        mode: options.mode || "normal",
        inputState,
      },
    },
  };
  const editor = {
    cm: { cm },
    getCursor: () => ({ line, ch: 0 }),
    getLine: (index) => (index === line ? lineText : ""),
    getValue: () => lineText,
  };
  return { editor, inputState, path };
}

function attachVimReviewView(plugin, vim, filePath) {
  plugin.getActiveMarkdownView = () => ({
    editor: vim.editor,
    file: { path: filePath || vim.path, extension: "md" },
  });
}

test("jumpToDueTask groupJump lands once, records a landing anchor, and never writes", async () => {
  const queue = nineTierQueue();
  const origin = firstOf(queue, "next", 2);
  const { plugin, seen } = groupMethodHarness({
    queues: [queue],
    landings: [{ ok: true, stale: false }],
  });
  plugin.getReviewJumpCursor = () => cursorFor(origin);
  notices.length = 0;
  assert.equal(await plugin.jumpToDueTask(1, { groupJump: true }), true);
  assert.deepEqual(seen.landEntries, [firstOf(queue, "recurring").key]);
  assert.equal(plugin.reviewAnchor.keys[0], firstOf(queue, "recurring").key);
  assert.equal(plugin.reviewAnchor.answered, false);
  assert.equal(notices.length, 1);
  assert.match(notices.at(-1), /Review /);
});

test("groupJump bypasses return-to-current and wins over endpoint", async () => {
  const queue = nineTierQueue();
  const currentRow = firstOf(queue, "pending", 1);
  const { plugin, seen } = groupMethodHarness({
    queues: [queue],
    landings: [{ ok: true, stale: false }],
  });
  plugin.reviewWalkCurrent = reviewWalkCurrentRef(
    currentRow,
    currentRow.path,
    DAY,
  );
  plugin.laneReleaseDateText = () => DAY;
  plugin.getReviewJumpCursor = () => ({
    path: "elsewhere.md",
    line: 1,
    text: "# filler",
  });
  plugin.returnToReviewWalkCurrent = async () => {
    throw new Error("group jumps never return");
  };
  notices.length = 0;
  assert.equal(
    await plugin.jumpToDueTask(-1, { groupJump: true, endpoint: "first" }),
    true,
  );
  assert.deepEqual(seen.landEntries, [firstOf(queue, "projects").key]);
});

test("stale group retry pins the original origin; a vanished target recomputes from it", async () => {
  const before = rowsForTiers(["new", "next", "recurring", "post"], 1);
  const after = rowsForTiers(["new", "next", "post"], 1);
  const { plugin, seen } = groupMethodHarness({
    queues: [before, after],
    landings: [{ ok: false, stale: true }, { ok: true, stale: false }],
  });
  plugin.getReviewJumpCursor = () => cursorFor(firstOf(before, "next"));
  notices.length = 0;
  assert.equal(await plugin.jumpToDueTask(1, { groupJump: true }), true);
  assert.deepEqual(seen.landEntries, [
    firstOf(before, "recurring").key,
    firstOf(after, "post").key,
  ]);
  assert.equal(notices.length, 1);
});

test("empty reread, repeated staleness, hard failure, missing API, and busy lock", async () => {
  const queue = nineTierQueue();
  const origin = firstOf(queue, "next");
  const empty = groupMethodHarness({
    queues: [queue, []],
    landings: [{ ok: false, stale: true }],
  });
  empty.plugin.getReviewJumpCursor = () => cursorFor(origin);
  notices.length = 0;
  assert.equal(await empty.plugin.jumpToDueTask(1, { groupJump: true }), false);
  assert.match(notices.at(-1), /Nothing due for review/);

  const stale = groupMethodHarness({
    queues: [queue, queue],
    landings: [{ ok: false, stale: true }, { ok: false, stale: true }],
  });
  stale.plugin.getReviewJumpCursor = () => cursorFor(origin);
  notices.length = 0;
  assert.equal(await stale.plugin.jumpToDueTask(1, { groupJump: true }), false);
  assert.equal(stale.seen.landCalls.length, 2);
  assert.equal(notices.at(-1), "Review queue changed — try again");

  const hard = groupMethodHarness({
    queues: [queue],
    landings: [{ ok: false, stale: false }],
  });
  hard.plugin.getReviewJumpCursor = () => cursorFor(origin);
  notices.length = 0;
  assert.equal(await hard.plugin.jumpToDueTask(1, { groupJump: true }), false);
  assert.equal(hard.seen.landCalls.length, 1);
  assert.equal(notices.at(-1), "Could not jump to task");

  const missing = groupMethodHarness({ queues: [queue], landings: [] });
  missing.plugin.app = {};
  notices.length = 0;
  assert.equal(await missing.plugin.jumpToDueTask(1, { groupJump: true }), false);
  assert.equal(notices.at(-1), "Bob Ledger Tools api v3 required");

  const busy = groupMethodHarness({
    queues: [queue],
    landings: [{ ok: true, stale: false }],
  });
  busy.plugin.reviewWalkLock = Date.now() + 60_000;
  busy.plugin.reviewAdvanceNow = () => Date.now();
  assert.equal(await busy.plugin.jumpToDueTask(1, { groupJump: true }), false);
  assert.equal(busy.seen.landCalls.length, 0);
});

test("groupJump consumes a Vim count before the first await", async () => {
  const queue = rowsForTiers(["new", "next", "post"], 1);
  const vim = vimReviewEditor({
    prefixRepeat: ["2"],
    path: "next.md",
    text: firstOf(queue, "next").originalMarkdown,
  });
  const { plugin, seen } = groupMethodHarness({
    queues: [queue],
    landings: [{ ok: true, stale: false }],
  });
  attachVimReviewView(plugin, vim, "next.md");
  plugin.getReviewJumpCursor = () => cursorFor(firstOf(queue, "next"));
  notices.length = 0;
  assert.equal(await plugin.jumpToDueTask(1, { groupJump: true }), true);
  assert.deepEqual(seen.landEntries, [firstOf(queue, "new").key]);
  assert.deepEqual(vim.inputState.prefixRepeat, []);
  assert.equal(vim.inputState.reason, "counted-review-jump");
  assert.match(notices.at(-1), /wrapped around/);
});

test("registered uppercase commands reverse directions and keep family s", async () => {
  const commands = [];
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: {
      getActiveFile: () => null,
      on: () => ({}),
      onLayoutReady: () => {},
    },
  };
  plugin.addCommand = (command) => commands.push(command);
  plugin.register = () => {};
  plugin.registerEvent = () => {};
  plugin.registerVimMappingsWhenReady = () => {};
  plugin.registerVimJumpHistoryVaultEvents = () => {};
  plugin.registerOpenTaskJumpInputListeners = () => {};
  plugin.registerReviewRefreshInputListeners = () => {};
  plugin.registerCountedTransclusionToggleInputListeners = () => {};
  plugin.registerCountedBulletPropertyInputListeners = () => {};
  plugin.registerCountedTaskMoveInputListeners = () => {};
  plugin.registerCountedLaneToggleInputListeners = () => {};
  plugin.registerClearSearchHighlightInputListeners = () => {};
  plugin.onload();
  const first = commands.find((item) => item.id === "jump-to-first-due-task");
  const last = commands.find((item) => item.id === "jump-to-last-due-task");
  assert.equal(
    first.name,
    "Jump to the first task of the previous review group",
  );
  assert.equal(last.name, "Jump to the first task of the next review group");
  const calls = [];
  const types = [];
  plugin.jumpToDueTask = (direction, options) => {
    calls.push({ direction, options });
    return true;
  };
  plugin.rememberBracketRepeatType = (type) => types.push(type);
  first.callback();
  last.callback();
  assert.deepEqual(calls, [
    { direction: -1, options: { groupJump: true } },
    { direction: 1, options: { groupJump: true } },
  ]);
  assert.deepEqual(types, ["s", "s"]);
});

test("]S from ROTTEN lands on POST row one with remaining counts and no skip-complete claim", async () => {
  const rotten = Array.from({ length: 3 }, (_, index) =>
    entry({
      tier: "rotten",
      path: `r${index}.md`,
      line: 1,
      text: `rotten ${index}`,
      rank: index + 1,
      tierRank: index + 1,
      tierTotal: 3,
      extra: { daysOverdue: 3 },
    }),
  );
  const posts = [
    entry({
      tier: "post",
      path: "gtd_daily.md",
      line: 20,
      text: "Morning review",
      rank: 4,
      tierRank: 1,
      tierTotal: 2,
      extra: {
        originalMarkdown:
          "- [ ] #task #gtd #post Morning review [repeat:: every day when done]",
      },
    }),
    entry({
      tier: "post",
      path: "gtd_daily.md",
      line: 21,
      text: "Skipped closeout",
      rank: 5,
      tierRank: 2,
      tierTotal: 2,
      extra: {
        originalMarkdown:
          "- [ ] #task #gtd #post Skipped closeout [repeat:: every day when done]",
      },
    }),
  ];
  const queue = [...rotten, ...posts];
  const { plugin, seen } = groupMethodHarness({
    queues: [queue],
    landings: [{ ok: true, stale: false }],
  });
  plugin.getReviewJumpCursor = () => cursorFor(rotten[1]);
  notices.length = 0;
  assert.equal(await plugin.jumpToDueTask(1, { groupJump: true }), true);
  assert.deepEqual(seen.landEntries, [posts[0].key]);
  const notice = notices.at(-1);
  assert.match(notice, /POST 1\/2/);
  assert.match(notice, /3 ROTTEN left/);
  assert.ok(!notice.includes("Commitments done"));
});

test("lowercase ]s continues from a group landing; a landing is not an answer", () => {
  const queue = nineTierQueue();
  const origin = firstOf(queue, "next", 2);
  const grouped = jump(queue, 1, { cursor: cursorFor(origin) });
  assert.equal(grouped.entry.tier, "recurring");
  assert.equal(grouped.entry.tierRank, 1);
  const landing = buildReviewAnchor(
    queue,
    [grouped.entry.key],
    grouped.rank,
    DAY,
  );
  const stepped = planReviewJump(queue, {
    direction: 1,
    anchor: landing,
    todayText: DAY,
  });
  assert.equal(stepped.entry.key, firstOf(queue, "recurring", 2).key);
  const stillDue = jump(queue, 1, {
    cursor: cursorFor(grouped.entry),
    anchor: landing,
  });
  assert.equal(stillDue.entry.tier, "tickler");
  assert.equal(stillDue.total, queue.length);
});
