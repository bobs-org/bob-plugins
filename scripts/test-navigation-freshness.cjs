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

function queueEntry(overrides = {}) {
  return {
    key: "a.md:3",
    path: "a.md",
    line: 3,
    lineNumber: 2,
    text: "Buy milk",
    originalMarkdown: "- [ ] #task Buy milk",
    blockId: null,
    state: "new",
    tier: "1 · NEW",
    fresh: null,
    dueOn: null,
    daysOverdue: null,
    interval: 7,
    rank: 1,
    ...overrides,
  };
}

function threeQueue() {
  return [
    queueEntry({
      key: "a.md:3",
      path: "a.md",
      line: 3,
      originalMarkdown: "- [ ] #task Buy milk",
      state: "new",
      rank: 1,
    }),
    queueEntry({
      key: "b.md:10",
      path: "b.md",
      line: 10,
      originalMarkdown: "- [ ] #task Walk dog",
      state: "rotten",
      dueOn: "2026-09-30",
      daysOverdue: 4,
      fresh: "2026-09-23",
      rank: 2,
    }),
    queueEntry({
      key: "c.md:5",
      path: "c.md",
      line: 5,
      originalMarkdown: "- [ ] #task File taxes",
      state: "resurfaced",
      dueOn: "2026-10-01",
      daysOverdue: 0,
      fresh: "2026-09-20",
      rank: 3,
    }),
  ];
}

test("missing ledger-tools api refuses the review namespace", () => {
  assert.equal(helpers.getReviewFreshnessApi(null), null);
  assert.equal(helpers.getReviewFreshnessApi({}), null);
  assert.equal(
    helpers.getReviewFreshnessApi({
      plugins: { plugins: {} },
    }),
    null,
  );
  assert.equal(
    helpers.getReviewFreshnessApi({
      plugins: { plugins: { "bob-ledger-tools": { api: { version: 2 } } } },
    }),
    null,
  );
  assert.equal(
    helpers.getReviewFreshnessApi({
      plugins: {
        plugins: { "bob-ledger-tools": { api: { version: 3 } } },
      },
    }),
    null,
  );
  const freshness = { version: 1 };
  assert.equal(
    helpers.getReviewFreshnessApi({
      plugins: {
        plugins: {
          "bob-ledger-tools": { api: { version: 3, freshness } },
        },
      },
    }),
    freshness,
  );
});

test("review jump on an empty queue", () => {
  assert.deepEqual(helpers.planReviewJump([], { direction: 1 }), {
    kind: "empty",
  });
  assert.deepEqual(helpers.planReviewJump(null, { direction: -1 }), {
    kind: "empty",
  });
});

test("review jump from a queued task goes to the neighbor", () => {
  const queue = threeQueue();
  const next = helpers.planReviewJump(queue, {
    direction: 1,
    cursor: { path: "a.md", line: 3, text: "- [ ] #task Buy milk" },
  });
  assert.equal(next.kind, "jump");
  assert.equal(next.entry.key, "b.md:10");
  assert.equal(next.rank, 2);
  assert.equal(next.total, 3);
  assert.equal(next.wrapped, false);

  const prev = helpers.planReviewJump(queue, {
    direction: -1,
    cursor: { path: "b.md", line: 10, text: "- [ ] #task Walk dog" },
  });
  assert.equal(prev.entry.key, "a.md:3");
  assert.equal(prev.rank, 1);
  assert.equal(prev.wrapped, false);
});

test("review jump wraps at the ends", () => {
  const queue = threeQueue();
  const wrappedNext = helpers.planReviewJump(queue, {
    direction: 1,
    cursor: { path: "c.md", line: 5, text: "unrelated cursor text" },
  });
  assert.equal(wrappedNext.entry.key, "a.md:3");
  assert.equal(wrappedNext.wrapped, true);

  const wrappedPrev = helpers.planReviewJump(queue, {
    direction: -1,
    cursor: { path: "a.md", line: 3, text: "- [ ] #task Buy milk" },
  });
  assert.equal(wrappedPrev.entry.key, "c.md:5");
  assert.equal(wrappedPrev.rank, 3);
  assert.equal(wrappedPrev.wrapped, true);
});

test("review jump from elsewhere goes to the first or last entry", () => {
  const queue = threeQueue();
  const next = helpers.planReviewJump(queue, {
    direction: 1,
    cursor: { path: "elsewhere.md", line: 1, text: "- [ ] #task Other" },
  });
  assert.equal(next.entry.key, "a.md:3");
  assert.equal(next.wrapped, false);

  const prev = helpers.planReviewJump(queue, {
    direction: -1,
    cursor: null,
  });
  assert.equal(prev.entry.key, "c.md:5");
  assert.equal(prev.wrapped, false);
});

test("review jump matches a moved cursor task by text", () => {
  const queue = threeQueue();
  const next = helpers.planReviewJump(queue, {
    direction: 1,
    cursor: { path: "b.md", line: 99, text: "- [ ] #task Walk dog" },
  });
  assert.equal(next.entry.key, "c.md:5");
});

test("review jump from a just-stamped rank goes to the entry after it", () => {
  const queue = threeQueue();
  const plan = helpers.planReviewJump(queue, {
    direction: 1,
    stamped: { keys: ["a.md:3"], rank: 1, count: 1 },
  });
  assert.equal(plan.kind, "jump");
  assert.equal(plan.entry.key, "b.md:10");
  assert.equal(plan.wrapped, false);
});

test("review jump skips just-stamped keys the lagging cache still shows", () => {
  const queue = threeQueue();
  const plan = helpers.planReviewJump(queue, {
    direction: 1,
    stamped: { keys: ["a.md:3", "b.md:10"], rank: 2, count: 2 },
  });
  assert.equal(plan.kind, "jump");
  assert.equal(plan.entry.key, "c.md:5");
});

test("review jump after stamping everything reports empty or wraps", () => {
  const queue = threeQueue();
  const emptied = helpers.planReviewJump(queue, {
    direction: 1,
    stamped: { keys: ["a.md:3", "b.md:10", "c.md:5"], rank: 3, count: 3 },
  });
  assert.equal(emptied.kind, "empty");

  const wrapped = helpers.planReviewJump(queue.slice(0, 2), {
    direction: 1,
    stamped: { keys: ["b.md:10"], rank: 2, count: 1 },
  });
  assert.equal(wrapped.entry.key, "a.md:3");
  assert.equal(wrapped.wrapped, true);
});

test("review queue line resolves at the entry line", () => {
  const content = [
    "# Tasks",
    "",
    "- [ ] #task Buy milk",
    "- [ ] #task Walk dog",
  ].join("\n");
  const resolved = helpers.resolveReviewQueueLine(content, {
    path: "a.md",
    line: 3,
    originalMarkdown: "- [ ] #task Buy milk",
  });
  assert.deepEqual(resolved, { ok: true, line: 2, source: "line" });
});

test("review queue line follows a moved line to its unique match", () => {
  const content = ["# Tasks", "- [ ] #task Walk dog", ""].join("\n");
  const resolved = helpers.resolveReviewQueueLine(content, {
    path: "a.md",
    line: 3,
    originalMarkdown: "- [ ] #task Walk dog",
  });
  assert.deepEqual(resolved, { ok: true, line: 1, source: "text" });
});

test("review queue line goes stale on duplicates or a missing line", () => {
  const duplicated = [
    "- [ ] #task Buy milk",
    "- [ ] #task Buy milk",
  ].join("\n");
  assert.deepEqual(
    helpers.resolveReviewQueueLine(duplicated, {
      path: "a.md",
      line: 1,
      originalMarkdown: "- [ ] #task Buy milk",
    }),
    { ok: true, line: 0, source: "line" },
  );
  assert.deepEqual(
    helpers.resolveReviewQueueLine(duplicated, {
      path: "a.md",
      line: 9,
      originalMarkdown: "- [ ] #task Buy milk",
    }),
    { ok: false, reason: "stale" },
  );
  assert.deepEqual(
    helpers.resolveReviewQueueLine("- [ ] #task Other", {
      path: "a.md",
      line: 1,
      originalMarkdown: "- [ ] #task Buy milk",
    }),
    { ok: false, reason: "stale" },
  );
});

test("review jump notices name the state", () => {
  const queue = threeQueue();
  assert.equal(helpers.buildReviewJumpNotice(queue[0], 1, 3), "Review 1/3 · NEW");
  assert.equal(
    helpers.buildReviewJumpNotice(queue[1], 2, 3),
    "Review 2/3 · rotten 4d",
  );
  assert.equal(
    helpers.buildReviewJumpNotice(queue[2], 3, 3),
    "Review 3/3 · resurfaced",
  );
  assert.equal(
    helpers.buildReviewJumpNotice(queue[0], 1, 3, { wrapped: true }),
    "Review 1/3 · NEW · wrapped around",
  );
  assert.equal(
    helpers.buildReviewEmptyNotice({ refreshedToday: 12 }),
    "Nothing due for review · ✓ 12 today",
  );
});

test("fresh stamp targets refuse closed and recurring tasks", () => {
  assert.deepEqual(
    helpers.classifyFreshStampTarget("- [ ] #task Buy milk"),
    { ok: true, refusal: null },
  );
  for (const status of [" ", "/", "*", "?"]) {
    assert.equal(
      helpers.classifyFreshStampTarget(`- [${status}] #task Open`).ok,
      true,
      `status ${status} stamps`,
    );
  }
  assert.deepEqual(
    helpers.classifyFreshStampTarget("- [x] #task Done"),
    { ok: false, refusal: "closed" },
  );
  assert.deepEqual(
    helpers.classifyFreshStampTarget("- [-] #task Dropped"),
    { ok: false, refusal: "closed" },
  );
  assert.deepEqual(
    helpers.classifyFreshStampTarget(
      "- [ ] #task Water plants [repeat:: every day]",
    ),
    { ok: false, refusal: "recurring" },
  );
  assert.deepEqual(
    helpers.classifyFreshStampTarget("- just a bullet"),
    { ok: false, refusal: "not-task" },
  );
  assert.equal(
    helpers.freshStampRefusalNotice("recurring"),
    "recurring · not reviewed",
  );
  assert.equal(
    helpers.freshStampRefusalNotice("closed"),
    "Task is closed · not reviewed",
  );
});

test("fresh stamp batch stamps every target and nothing else", () => {
  const content = [
    "- [ ] #task Buy milk",
    "- [ ] #task Walk dog",
    "- [x] #task Done",
  ].join("\n");
  const stamper = (line) => `${line} [fresh:: 2026-10-08]`;
  const plan = helpers.planFreshStampBatch(content, [0, 1], stamper, "2026-10-08");
  assert.equal(plan.ok, true);
  assert.equal(
    plan.content,
    [
      "- [ ] #task Buy milk [fresh:: 2026-10-08]",
      "- [ ] #task Walk dog [fresh:: 2026-10-08]",
      "- [x] #task Done",
    ].join("\n"),
  );
  assert.equal(plan.stamped.length, 2);
  assert.equal(plan.stamped[0].before, "- [ ] #task Buy milk");
});

test("one refusal refuses the whole fresh stamp batch", () => {
  const content = ["- [ ] #task Buy milk", "- [x] #task Done"].join("\n");
  const plan = helpers.planFreshStampBatch(
    content,
    [0, 1],
    (line) => `${line} [fresh:: 2026-10-08]`,
    "2026-10-08",
  );
  assert.equal(plan.ok, false);
  assert.equal(plan.refusal, "closed");
  assert.equal(plan.content, content);
  assert.deepEqual(plan.stamped, []);

  const recurring = helpers.planFreshStampBatch(
    "- [ ] #task Water plants 🔁",
    [0],
    (line) => `${line} [fresh:: 2026-10-08]`,
    "2026-10-08",
  );
  assert.equal(recurring.ok, false);
  assert.equal(recurring.refusal, "recurring");
});

test("a throwing stamper refuses the fresh stamp batch", () => {
  const plan = helpers.planFreshStampBatch(
    "- [ ] #task Buy milk",
    [0],
    () => {
      throw new Error("nope");
    },
    "2026-10-08",
  );
  assert.equal(plan.ok, false);
  assert.equal(plan.refusal, "stamp");
});

test("fresh stamp plus Work Log prepends only stamped Pending targets", () => {
  const content = [
    "- [/] #task Parent [fresh:: 2026-10-08] ^parent",
    "  - 🗓️ **SCHEDULE LOG**",
    "    - *2026-10-07* — moved the date",
    "  - 🛠️ **WORK LOG**",
    "    + *2026-10-06* — older parent work",
    "  - [/] #task Child ^child",
    "    - 🛠️ **WORK LOG**",
    "      - *2026-10-05* — child work",
    "- [*] #task Next",
  ].join("\r\n");
  const plan = helpers.planFreshStampBatchWithWorkLogs(
    content,
    [0, 5, 8],
    (line) => line,
    "2026-10-08",
    "  Finished\tparent :: note  ",
  );
  assert.equal(plan.ok, true);
  assert.equal(plan.workLogWrittenCount, 2);
  assert.equal(
    plan.content,
    [
      "- [/] #task Parent [fresh:: 2026-10-08] ^parent",
      "  - 🗓️ **SCHEDULE LOG**",
      "    - *2026-10-07* — moved the date",
      "  - 🛠️ **WORK LOG**",
      "    + *2026-10-08* — Finished parent :: note",
      "    + *2026-10-06* — older parent work",
      "  - [/] #task Child ^child",
      "    - 🛠️ **WORK LOG**",
      "      - *2026-10-08* — Finished parent :: note",
      "      - *2026-10-05* — child work",
      "- [*] #task Next",
    ].join("\r\n"),
  );
  assert.doesNotMatch(plan.content, /[^\r]\n/);
});

test("blank Work Log summary and stamp refusal never create a log marker", () => {
  const content = "- [/] #task Pending\r\n- [x] #task Closed";
  const blank = helpers.planFreshStampBatchWithWorkLogs(
    content,
    [0],
    (line) => line,
    "2026-10-08",
    " \t ",
  );
  assert.equal(blank.ok, true);
  assert.equal(blank.workLogWrittenCount, 0);
  assert.equal(blank.content, content);

  const refused = helpers.planFreshStampBatchWithWorkLogs(
    content,
    [0, 1],
    (line) => line,
    "2026-10-08",
    "Did something",
  );
  assert.equal(refused.ok, false);
  assert.equal(refused.content, content);
  assert.equal(refused.workLogWrittenCount, 0);
  assert.doesNotMatch(refused.content, /WORK LOG/);
});

test("fresh stamp notices adjust the pre-write counts", () => {
  assert.equal(
    helpers.buildFreshStampNotice({
      changed: 1,
      dueAfter: 22,
      newAfter: 3,
      refreshedAfter: 13,
      budget: null,
    }),
    "Fresh ✓ 1 task · 22 due (3 new) · ✓ 13 today",
  );
  assert.equal(
    helpers.buildFreshStampNotice({
      changed: 3,
      dueAfter: 20,
      newAfter: 1,
      refreshedAfter: 13,
      budget: 15,
    }),
    "Fresh ✓ 3 tasks · 20 due (1 new) · ✓ 13/15",
  );
  assert.equal(
    helpers.buildFreshStampNotice({
      changed: 2,
      dueAfter: 20,
      newAfter: 0,
      refreshedAfter: 15,
      budget: 15,
    }),
    "Fresh ✓ 2 tasks · 20 due (0 new) · ✓ 15/15 · done for today",
  );
});

test("today detection only matches today's fresh field", () => {
  assert.equal(
    helpers.freshStampLineHasToday(
      "- [ ] #task Buy milk [fresh:: 2026-10-08]",
      "2026-10-08",
    ),
    true,
  );
  assert.equal(
    helpers.freshStampLineHasToday(
      "- [ ] #task Buy milk [fresh:: 2026-10-01]",
      "2026-10-08",
    ),
    false,
  );
  assert.equal(
    helpers.freshStampLineHasToday("- [ ] #task Buy milk", "2026-10-08"),
    false,
  );
});

test("stamped refs match the pre-write queue by line or text", () => {
  const queue = threeQueue();
  const matched = helpers.matchFreshStampRefs(queue, [
    { path: "a.md", line: 2, raw: "- [ ] #task Buy milk" },
    { path: "zzz.md", line: 0, raw: "- [ ] #task Missing" },
  ]);
  assert.deepEqual(matched.keys, ["a.md:3"]);
  assert.equal(matched.rank, 1);
  assert.equal(matched.count, 1);
  assert.equal(matched.newCount, 1);

  const moved = helpers.matchFreshStampRefs(queue, [
    { path: "b.md", line: 77, raw: "- [ ] #task Walk dog" },
  ]);
  assert.deepEqual(moved.keys, ["b.md:10"]);
  assert.equal(moved.rank, 2);
  assert.equal(moved.newCount, 0);
});

test("review refresh keydown matches Alt+F with and without Shift", () => {
  const down = (overrides = {}) => ({
    ctrlKey: false,
    metaKey: false,
    altKey: true,
    shiftKey: false,
    code: "KeyF",
    key: "f",
    ...overrides,
  });
  assert.equal(helpers.isReviewRefreshKeydown(down(), false), true);
  assert.equal(helpers.isReviewRefreshKeydown(down(), true), false);
  assert.equal(
    helpers.isReviewRefreshKeydown(down({ shiftKey: true, key: "F" }), true),
    true,
  );
  assert.equal(
    helpers.isReviewRefreshKeydown(down({ shiftKey: true, key: "F" }), false),
    false,
  );
  assert.equal(
    helpers.isReviewRefreshKeydown(down({ ctrlKey: true }), false),
    false,
  );
  assert.equal(
    helpers.isReviewRefreshKeydown(down({ metaKey: true }), false),
    false,
  );
  assert.equal(
    helpers.isReviewRefreshKeydown(down({ altKey: false }), false),
    false,
  );
  assert.equal(
    helpers.isReviewRefreshKeydown(down({ code: "KeyG", key: "g" }), false),
    false,
  );
});

test("tier-aware jump notices name each tier", () => {
  const v4 = (overrides = {}) => ({
    key: "a.md:1",
    path: "a.md",
    line: 1,
    originalMarkdown: "- [ ] #task T",
    state: null,
    bucket: null,
    tier: "new",
    tierLabel: "NEW",
    lane: "ready",
    created: "2026-09-30",
    fresh: null,
    dueOn: null,
    daysOverdue: null,
    interval: 7,
    rank: 1,
    tierRank: 1,
    tierTotal: 1,
    ...overrides,
  });
  const today = { todayText: "2026-10-08" };
  assert.equal(
    helpers.buildReviewJumpNotice(v4(), 1, 5, today),
    "Review 1/5 · NEW 1/1",
  );
  assert.equal(
    helpers.buildReviewJumpNotice(
      v4({
        key: "p.md:1", path: "p.md",
        tier: "pending", tierLabel: "PENDING", lane: "pending",
        fresh: "2026-10-07", dueOn: "2026-10-08", daysOverdue: 0,
        interval: 1, tierRank: 2, tierTotal: 3,
      }),
      2, 5, today,
    ),
    "Review 2/5 · PENDING 2/3 · confirmed yesterday\nStill pending? Alt+F keep · Alt+N release · Ctrl+Shift+Enter today",
  );
  assert.equal(
    helpers.buildReviewJumpNotice(
      v4({
        key: "n.md:1", path: "n.md",
        tier: "next", tierLabel: "NEXT", lane: "next",
        fresh: null, dueOn: null, daysOverdue: null,
        interval: 1, tierRank: 1, tierTotal: 2,
      }),
      3, 5, today,
    ),
    "Review 3/5 · NEXT 1/2 · never confirmed\nStill next? Alt+F keep · Alt+N release · Ctrl+Shift+Enter today",
  );
  assert.equal(
    helpers.buildReviewJumpNotice(
      v4({
        key: "r.md:1", path: "r.md",
        tier: "returned", tierLabel: "RETURNED", lane: "ready",
        fresh: "2026-10-05", dueOn: "2026-10-07", daysOverdue: 1,
        interval: 7, tierRank: 1, tierTotal: 1,
      }),
      4, 5, today,
    ),
    "Review 4/5 · RETURNED 1/1 · back since Oct 7",
  );
  assert.equal(
    helpers.buildReviewJumpNotice(
      v4({
        key: "o.md:1", path: "o.md",
        tier: "rotten", tierLabel: "ROTTEN", lane: "ready",
        fresh: "2026-09-28", dueOn: "2026-10-05", daysOverdue: 3,
        interval: 7, tierRank: 1, tierTotal: 1,
      }),
      5, 5, today,
    ),
    "Review 5/5 · ROTTEN 1/1 · rotten 3d · every 7d",
  );
  assert.equal(
    helpers.buildReviewJumpNotice(
      v4({
        key: "o2.md:1", path: "o2.md",
        tier: "rotten", tierLabel: "ROTTEN", lane: "ready",
        fresh: "2026-10-07", dueOn: "2026-10-08", daysOverdue: 0,
        interval: 1, tierRank: 1, tierTotal: 1,
      }),
      5, 5, today,
    ),
    "Review 5/5 · ROTTEN 1/1 · due today · every 1d",
  );
});

test("projects tier walks with commitment rank and empty-project notice", () => {
  assert.equal(
    helpers.reviewEntryMachineTier({ tier: "projects" }),
    "projects",
  );
  assert.equal(
    helpers.reviewFreshnessSupportsTrackers({ trackerReview: true }),
    true,
  );
  assert.equal(helpers.reviewFreshnessSupportsTrackers({}), false);
  assert.equal(helpers.reviewFreshnessSupportsTrackers(null), false);
  const entry = {
    key: "p.md:1",
    path: "p.md",
    line: 1,
    originalMarkdown: "- [ ] #task Project ^prj",
    state: "new",
    bucket: "new",
    tier: "projects",
    tierLabel: "PROJECTS",
    lane: "ready",
    created: null,
    fresh: null,
    dueOn: null,
    daysOverdue: null,
    interval: 7,
    rank: 2,
    tierRank: 1,
    tierTotal: 1,
  };
  assert.equal(
    helpers.buildReviewJumpNotice(entry, 2, 6, { todayText: "2026-10-08" }),
    "Review 2/6 · PROJECTS 1/1 · Empty project · never confirmed · every 7d",
  );
  const stamped = {
    ...entry,
    fresh: "2026-10-01",
    dueOn: "2026-10-08",
    daysOverdue: 0,
  };
  assert.equal(
    helpers.buildReviewJumpNotice(stamped, 2, 6, { todayText: "2026-10-08" }),
    "Review 2/6 · PROJECTS 1/1 · Empty project · due today · confirmed Oct 1 · every 7d",
  );
  // Without the capability the walk still lands; only the project
  // detail is withheld.
  assert.equal(
    helpers.buildReviewJumpNotice(entry, 2, 6, {
      todayText: "2026-10-08",
      trackers: false,
    }),
    "Review 2/6 · PROJECTS 1/1",
  );
});

test("references tier walks with commitment rank and reference notice", () => {
  assert.equal(
    helpers.reviewEntryMachineTier({ tier: "references" }),
    "references",
  );
  // The walk counts references as commitments, not upkeep.
  const queue = [
    { key: "r.md:1", tier: "references" },
    { key: "o.md:1", tier: "rotten" },
  ];
  assert.deepEqual(helpers.reviewWalkRemaining(queue, new Set()), {
    commitments: 1,
    rotten: 1,
  });
  assert.deepEqual(
    helpers.reviewWalkRemaining(queue, new Set(["r.md:1"])),
    { commitments: 0, rotten: 1 },
  );
  // Stepping REFERENCES → ROTTEN crosses the boundary.
  assert.equal(
    helpers.buildReviewBoundaryNotice({
      originTier: "references", destTier: "rotten",
      commitmentsLeft: 0, rottenLeft: 1,
    }),
    "Commitments done — 1 ROTTEN left",
  );
  const entry = {
    key: "r.md:1",
    path: "r.md",
    line: 1,
    originalMarkdown: "- [ ] #task Read ^ref",
    state: "new",
    bucket: "new",
    tier: "references",
    tierLabel: "REFERENCES",
    lane: "ready",
    created: null,
    fresh: null,
    dueOn: null,
    daysOverdue: null,
    interval: 7,
    rank: 5,
    tierRank: 1,
    tierTotal: 1,
  };
  assert.equal(
    helpers.buildReviewJumpNotice(entry, 5, 6, { todayText: "2026-10-08" }),
    "Review 5/6 · REFERENCES 1/1 · Reference · never confirmed · every 7d",
  );
  const stamped = {
    ...entry,
    fresh: "2026-10-01",
    dueOn: "2026-10-08",
    daysOverdue: 0,
  };
  assert.equal(
    helpers.buildReviewJumpNotice(stamped, 5, 6, { todayText: "2026-10-08" }),
    "Review 5/6 · REFERENCES 1/1 · Reference · due today · confirmed Oct 1 · every 7d",
  );
  // A references-tier entry never authorizes an exact keep: the
  // matcher refuses it with `tier`, like PROJECTS.
  const match = helpers.matchFreshStampExactEntry(
    [{ ...stamped, line: 1 }],
    { path: "r.md", line: 0, raw: "- [ ] #task Read ^ref" },
  );
  assert.equal(match.ok, false);
  assert.equal(match.reason, "tier");
});

test("jump notices use reviewEntryView when provided and keep the fallback", () => {
  const v4 = (overrides = {}) => ({
    key: "a.md:1",
    path: "a.md",
    line: 1,
    originalMarkdown: "- [ ] #task T",
    state: null,
    bucket: null,
    tier: "pending",
    tierLabel: "PENDING",
    lane: "pending",
    created: "2026-09-30",
    fresh: "2026-10-07",
    dueOn: "2026-10-08",
    daysOverdue: 0,
    interval: 1,
    rank: 2,
    tierRank: 2,
    tierTotal: 3,
    ...overrides,
  });
  const reviewEntryView = () => ({
    ok: true,
    tier: "pending",
    label: "PENDING",
    detail: "confirmed yesterday",
    compact: "confirmed yesterday",
    actionHint:
      "Still pending? Alt+F keep · Alt+N release · Ctrl+Shift+Enter today",
  });
  assert.equal(
    helpers.buildReviewJumpNotice(v4(), 2, 5, {
      todayText: "2026-10-08",
      reviewEntryView,
    }),
    "Review 2/5 · PENDING 2/3 · confirmed yesterday\nStill pending? Alt+F keep · Alt+N release · Ctrl+Shift+Enter today",
  );
  assert.equal(
    helpers.buildReviewJumpNotice(v4(), 2, 5, {
      todayText: "2026-10-08",
      wrapped: true,
      reviewEntryView,
    }),
    "Review 2/5 · PENDING 2/3 · confirmed yesterday\nStill pending? Alt+F keep · Alt+N release · Ctrl+Shift+Enter today · wrapped around",
  );
  assert.equal(
    helpers.buildReviewJumpNotice(v4(), 2, 5, {
      reviewEntryView: () => {
        throw new Error("boom");
      },
    }),
    "Review 2/5 · PENDING 2/3 · confirmed yesterday\nStill pending? Alt+F keep · Alt+N release · Ctrl+Shift+Enter today",
  );
  const project = v4({
    tier: "projects",
    tierLabel: "PROJECTS",
    lane: "ready",
    fresh: null,
    dueOn: null,
    daysOverdue: null,
    interval: 7,
    tierRank: 1,
    tierTotal: 1,
  });
  assert.equal(
    helpers.buildReviewJumpNotice(project, 2, 6, {
      todayText: "2026-10-08",
      trackers: false,
      reviewEntryView: () => ({
        ok: true,
        tier: "projects",
        label: "PROJECTS",
        detail: "Empty project · never confirmed · every 7d",
        compact: "Empty project",
        actionHint: "",
      }),
    }),
    "Review 2/6 · PROJECTS 1/1",
  );
});

test("tier notices fall back without tier ranks and wrap on the last line", () => {
  const legacy = queueEntry({ state: "new" });
  assert.equal(helpers.buildReviewJumpNotice(legacy, 1, 3), "Review 1/3 · NEW");
  const lane = {
    key: "p.md:1", path: "p.md", line: 1,
    originalMarkdown: "- [/] #task P",
    state: null, tier: "pending", tierLabel: "PENDING",
    fresh: "2026-10-01", dueOn: "2026-10-02", daysOverdue: 6,
    interval: 1, tierRank: 3, tierTotal: 3,
  };
  assert.equal(
    helpers.buildReviewJumpNotice(lane, 2, 4, { todayText: "2026-10-08", wrapped: true }),
    "Review 2/4 · PENDING 3/3 · confirmed 7 days ago\nStill pending? Alt+F keep · Alt+N release · Ctrl+Shift+Enter today · wrapped around",
  );
});

test("boundary notice names commitments done and rotten next", () => {
  assert.equal(
    helpers.buildReviewBoundaryNotice({
      originTier: "returned", destTier: "rotten",
      commitmentsLeft: 0, rottenLeft: 4,
    }),
    "Commitments done — 4 ROTTEN left",
  );
  assert.equal(
    helpers.buildReviewBoundaryNotice({
      originTier: "next", destTier: "rotten",
      commitmentsLeft: 2, rottenLeft: 4,
    }),
    "ROTTEN next — 2 commitments still due",
  );
  assert.equal(
    helpers.buildReviewBoundaryNotice({
      originTier: null, destTier: "rotten",
      commitmentsLeft: 0, rottenLeft: 1,
    }),
    "Commitments done — 1 ROTTEN left",
  );
  assert.equal(
    helpers.buildReviewBoundaryNotice({
      originTier: null, destTier: "rotten",
      commitmentsLeft: 2, rottenLeft: 1,
    }),
    null,
  );
  assert.equal(
    helpers.buildReviewBoundaryNotice({
      originTier: "rotten", destTier: "rotten",
      commitmentsLeft: 0, rottenLeft: 2,
    }),
    null,
  );
  assert.equal(
    helpers.buildReviewBoundaryNotice({
      originTier: "next", destTier: "next",
      commitmentsLeft: 1, rottenLeft: 2,
    }),
    null,
  );
});

test("walk anchor records handled keys with their neighbors", () => {
  const queue = ["a", "b", "c", "d"].map((stem, index) => queueEntry({
    key: `${stem}.md:1`, path: `${stem}.md`, line: 1,
    originalMarkdown: `- [ ] #task ${stem}`,
    state: index === 0 ? "new" : "rotten", rank: index + 1,
  }));
  const anchor = helpers.buildReviewAnchor(queue, ["b.md:1"], 2);
  assert.deepEqual(anchor.keys, ["b.md:1"]);
  assert.equal(anchor.rank, 2);
  assert.equal(anchor.count, 1);
  assert.equal(anchor.path, "b.md");
  assert.deepEqual(anchor.afterKeys, ["c.md:1", "d.md:1"]);
  assert.deepEqual(anchor.beforeKeys, ["a.md:1"]);
  assert.equal(helpers.buildReviewAnchor(queue, ["zzz.md:9"], 9), null);
});

test("cursor on a live entry wins over a lagging anchor", () => {
  const queue = ["a", "b", "c"].map((stem, index) => queueEntry({
    key: `${stem}.md:1`, path: `${stem}.md`, line: 1,
    originalMarkdown: `- [ ] #task ${stem}`,
    state: "rotten", rank: index + 1,
  }));
  const anchor = helpers.buildReviewAnchor(queue, ["a.md:1"], 1);
  const plan = helpers.planReviewJump(queue, {
    direction: 1,
    cursor: { path: "b.md", line: 1, text: "- [ ] #task b" },
    anchor,
  });
  assert.equal(plan.entry.key, "c.md:1");
  assert.equal(plan.wrapped, false);
});

test("[s after a stamp goes backwards from the anchor", () => {
  const queue = ["a", "b", "c"].map((stem, index) => queueEntry({
    key: `${stem}.md:1`, path: `${stem}.md`, line: 1,
    originalMarkdown: `- [ ] #task ${stem}`,
    state: "rotten", rank: index + 1,
  }));
  const anchor = helpers.buildReviewAnchor(queue, ["b.md:1"], 2);
  const back = helpers.planReviewJump(queue, { direction: -1, anchor });
  assert.equal(back.entry.key, "a.md:1");
  assert.equal(back.wrapped, false);
  const ontoHandled = helpers.planReviewJump(queue, {
    direction: -1,
    cursor: { path: "b.md", line: 1, text: "- [ ] #task b" },
    anchor,
  });
  assert.equal(ontoHandled.entry.key, "a.md:1");
});

test("release-then-]s continues from the anchor successor", () => {
  const queue = ["a", "b", "c"].map((stem, index) => queueEntry({
    key: `${stem}.md:1`, path: `${stem}.md`, line: 1,
    originalMarkdown: `- [ ] #task ${stem}`,
    state: "rotten", rank: index + 1,
  }));
  const anchor = helpers.buildReviewAnchor(queue, ["a.md:1"], 1);
  // Cache lagging: the released task is still listed.
  const lagging = helpers.planReviewJump(queue, {
    direction: 1,
    cursor: { path: "a.md", line: 1, text: "- [*] #task a" },
    anchor,
  });
  assert.equal(lagging.entry.key, "b.md:1");
  assert.equal(lagging.rank, 1);
  // Cache updated: the released task left the queue.
  const updated = helpers.planReviewJump(queue.slice(1), {
    direction: 1,
    cursor: { path: "a.md", line: 1, text: "- [ ] #task a" },
    anchor,
  });
  assert.equal(updated.entry.key, "b.md:1");
});

test("non-contiguous counted stamp advances past the last handled rank", () => {
  const queue = ["a", "b", "c", "d", "e"].map((stem, index) => queueEntry({
    key: `${stem}.md:1`, path: `${stem}.md`, line: 1,
    originalMarkdown: `- [ ] #task ${stem}`,
    state: "rotten", rank: index + 1,
  }));
  const anchor = helpers.buildReviewAnchor(queue, ["a.md:1", "d.md:1"], 4);
  const forward = helpers.planReviewJump(queue, { direction: 1, anchor });
  assert.equal(forward.entry.key, "e.md:1");
  const backward = helpers.planReviewJump(queue, { direction: -1, anchor });
  assert.equal(backward.entry.key, "c.md:1");
});

test("anchor wraps at both ends", () => {
  const queue = ["a", "b"].map((stem, index) => queueEntry({
    key: `${stem}.md:1`, path: `${stem}.md`, line: 1,
    originalMarkdown: `- [ ] #task ${stem}`,
    state: "rotten", rank: index + 1,
  }));
  const atEnd = helpers.planReviewJump(queue, {
    direction: 1,
    anchor: helpers.buildReviewAnchor(queue, ["b.md:1"], 2),
  });
  assert.equal(atEnd.entry.key, "a.md:1");
  assert.equal(atEnd.wrapped, true);
  const atStart = helpers.planReviewJump(queue, {
    direction: -1,
    anchor: helpers.buildReviewAnchor(queue, ["a.md:1"], 1),
  });
  assert.equal(atStart.entry.key, "b.md:1");
  assert.equal(atStart.wrapped, true);
  const emptied = helpers.planReviewJump(queue, {
    direction: 1,
    anchor: helpers.buildReviewAnchor(queue, ["a.md:1", "b.md:1"], 2),
  });
  assert.equal(emptied.kind, "empty");
});

test("advance across NEXT to RETURNED to ROTTEN lands the boundary", () => {
  const tiered = (stem, tier, index, total) => queueEntry({
    key: `${stem}.md:1`, path: `${stem}.md`, line: 1,
    originalMarkdown: `- [ ] #task ${stem}`,
    state: null, tier, tierLabel: tier.toUpperCase(),
    fresh: "2026-10-07", dueOn: "2026-10-08", daysOverdue: 0,
    interval: 1, rank: index, tierRank: 1, tierTotal: total,
  });
  const queue = [
    tiered("n", "next", 1, 1),
    tiered("r", "returned", 2, 1),
    tiered("o", "rotten", 3, 1),
  ];
  const afterNext = helpers.buildReviewAnchor(queue, ["n.md:1"], 1);
  const toReturned = helpers.planReviewJump(queue, { direction: 1, anchor: afterNext });
  assert.equal(toReturned.entry.key, "r.md:1");
  assert.equal(
    helpers.buildReviewBoundaryNotice({
      originTier: toReturned.originTier,
      destTier: "returned",
      ...helpers.reviewWalkRemaining(queue, new Set(afterNext.keys)),
    }),
    null,
  );
  const afterReturned = helpers.buildReviewAnchor(queue, ["n.md:1", "r.md:1"], 2);
  const toRotten = helpers.planReviewJump(queue, { direction: 1, anchor: afterReturned });
  assert.equal(toRotten.entry.key, "o.md:1");
  const remaining = helpers.reviewWalkRemaining(queue, new Set(afterReturned.keys));
  assert.deepEqual(remaining, { commitments: 0, rotten: 1 });
  assert.equal(
    helpers.buildReviewBoundaryNotice({
      originTier: toRotten.originTier,
      destTier: "rotten",
      commitmentsLeft: remaining.commitments,
      rottenLeft: remaining.rotten,
    }),
    "Commitments done — 1 ROTTEN left",
  );
});

test("tier capability gates on the freshness namespace version", () => {
  assert.equal(helpers.reviewFreshnessSupportsTiers(null), false);
  assert.equal(helpers.reviewFreshnessSupportsTiers({}), false);
  assert.equal(helpers.reviewFreshnessSupportsTiers({ version: 3 }), false);
  assert.equal(helpers.reviewFreshnessSupportsTiers({ version: 4 }), true);
});

test("empty queue notice reads the upkeep meter", () => {
  assert.equal(
    helpers.buildReviewEmptyNotice({ refreshedToday: 12, upkeepToday: 7 }),
    "Nothing due for review · ✓ 7 today",
  );
  assert.equal(
    helpers.buildReviewEmptyNotice({ refreshedToday: 12 }),
    "Nothing due for review · ✓ 12 today",
  );
});

test("refresh row reads lane intervals from the api with the once-Ready return", () => {
  const v4 = (lanes) => ({
    config: () => ({ interval: 7 }),
    stampLine: (line) => line,
    setRefreshLine: (line) => line,
    intervalForLine: (line, raw) => {
      if (/\[\*\]/.test(String(line))) {
        return {
          days: 1, source: "next",
          ready: /refresh::/.test(String(line))
            ? { days: 14, source: "task" }
            : { days: 7, source: "config" },
        };
      }
      if (/\[\/\]/.test(String(line))) {
        return { days: 1, source: "pending", ready: { days: 7, source: "config" } };
      }
      return { days: 7, source: lanes === "default" ? "default" : "config", ready: null };
    },
  });
  const next = helpers.describeRefreshRow("- [*] #task T", {
    cursorLine: 0, freshnessApi: v4(),
  });
  assert.equal(next.detail, "refresh · every 1 d (next lane)");
  const nextOwn = helpers.describeRefreshRow("- [*] #task T [refresh:: 14]", {
    cursorLine: 0, freshnessApi: v4(),
  });
  assert.equal(nextOwn.detail, "refresh · every 1 d (next lane) · 14 d once Ready");
  const pending = helpers.describeRefreshRow("- [/] #task T", {
    cursorLine: 0, freshnessApi: v4(),
  });
  assert.equal(pending.detail, "refresh · every 1 d (pending lane)");
  const implicit = helpers.describeRefreshRow("- [ ] #task T", {
    cursorLine: 0, freshnessApi: v4("default"),
  });
  assert.equal(implicit.detail, "refresh · every 7 d (default)");
  // v3 namespaces keep the local chain.
  const legacy = helpers.describeRefreshRow("- [ ] #task T", {
    cursorLine: 0,
    freshnessApi: { config: () => ({ interval: 7 }) , stampLine: (l) => l, setRefreshLine: (l) => l },
  });
  assert.equal(legacy.detail, "refresh · every 7 d (config)");
});

// Mixed-tier queue so an endpoint cannot accidentally be scoped to one tier.
function mixedTierQueue() {
  const v4 = (overrides = {}) => ({
    key: "a.md:1",
    path: "a.md",
    line: 1,
    originalMarkdown: "- [ ] #task T",
    state: null,
    bucket: null,
    tier: "new",
    tierLabel: "NEW",
    lane: "ready",
    fresh: null,
    dueOn: null,
    daysOverdue: null,
    interval: 7,
    rank: 1,
    tierRank: 1,
    tierTotal: 1,
    ...overrides,
  });
  return [
    v4({ key: "n.md:1", path: "n.md", originalMarkdown: "- [ ] #task New" }),
    v4({
      key: "p.md:2", path: "p.md", line: 2,
      originalMarkdown: "- [/] #task Pending",
      tier: "pending", tierLabel: "PENDING", lane: "pending",
      fresh: "2026-10-07", dueOn: "2026-10-08", daysOverdue: 0,
      interval: 1, rank: 2, tierRank: 1, tierTotal: 1,
    }),
    v4({
      key: "x.md:3", path: "x.md", line: 3,
      originalMarkdown: "- [*] #task Next",
      tier: "next", tierLabel: "NEXT", lane: "next",
      fresh: null, dueOn: null, daysOverdue: null,
      interval: 1, rank: 3, tierRank: 1, tierTotal: 1,
    }),
    v4({
      key: "r.md:4", path: "r.md", line: 4,
      originalMarkdown: "- [ ] #task Returned",
      tier: "returned", tierLabel: "RETURNED", lane: "ready",
      fresh: "2026-10-05", dueOn: "2026-10-07", daysOverdue: 1,
      interval: 7, rank: 4, tierRank: 1, tierTotal: 1,
    }),
    v4({
      key: "o.md:5", path: "o.md", line: 5,
      originalMarkdown: "- [ ] #task Rotten",
      tier: "rotten", tierLabel: "ROTTEN", lane: "ready",
      fresh: "2026-09-28", dueOn: "2026-10-05", daysOverdue: 3,
      interval: 7, rank: 5, tierRank: 1, tierTotal: 1,
    }),
  ];
}

test("endpoint jumps select the queue ends with full rank and total", () => {
  const queue = mixedTierQueue();
  const first = helpers.planReviewJump(queue, {
    direction: 1,
    endpoint: "first",
    cursor: { path: "x.md", line: 3, text: "- [*] #task Next" },
    anchor: helpers.buildReviewAnchor(queue, ["x.md:3"], 3),
  });
  assert.equal(first.kind, "jump");
  assert.equal(first.entry.key, "n.md:1");
  assert.equal(first.rank, 1);
  assert.equal(first.total, 5);
  assert.equal(first.wrapped, false);
  assert.equal(first.originTier, null);

  const last = helpers.planReviewJump(queue, {
    direction: -1,
    endpoint: "last",
    cursor: { path: "x.md", line: 3, text: "- [*] #task Next" },
    anchor: helpers.buildReviewAnchor(queue, ["x.md:3"], 3),
  });
  assert.equal(last.kind, "jump");
  assert.equal(last.entry.key, "o.md:5");
  assert.equal(last.rank, 5);
  assert.equal(last.total, 5);
  assert.equal(last.wrapped, false);
  assert.equal(last.originTier, null);
});

test("endpoint jumps ignore cursor, anchor, and direction", () => {
  const queue = mixedTierQueue();
  const anchor = helpers.buildReviewAnchor(queue, ["p.md:2", "x.md:3"], 3);
  for (const cursor of [
    { path: "o.md", line: 5, text: "- [ ] #task Rotten" },
    { path: "elsewhere.md", line: 1, text: "- [ ] #task Other" },
    null,
  ]) {
    assert.equal(
      helpers.planReviewJump(queue, { direction: -1, endpoint: "first", cursor, anchor }).entry.key,
      "n.md:1",
    );
    assert.equal(
      helpers.planReviewJump(queue, { direction: 1, endpoint: "last", cursor, anchor }).entry.key,
      "o.md:5",
    );
  }
  // Unrecognized endpoint values keep the relative path.
  const relative = helpers.planReviewJump(queue, {
    direction: 1,
    endpoint: "middle",
    cursor: { path: "n.md", line: 1, text: "- [ ] #task New" },
  });
  assert.equal(relative.entry.key, "p.md:2");
});

test("endpoint jumps on empty and one-entry queues", () => {
  assert.deepEqual(helpers.planReviewJump([], { endpoint: "first" }), {
    kind: "empty",
  });
  assert.deepEqual(helpers.planReviewJump([], { endpoint: "last" }), {
    kind: "empty",
  });
  const solo = [mixedTierQueue()[0]];
  for (const endpoint of ["first", "last"]) {
    const plan = helpers.planReviewJump(solo, {
      endpoint,
      cursor: { path: "n.md", line: 1, text: "- [ ] #task New" },
      anchor: helpers.buildReviewAnchor(solo, ["n.md:1"], 1),
    });
    assert.equal(plan.kind, "jump");
    assert.equal(plan.entry.key, "n.md:1");
    assert.equal(plan.rank, 1);
    assert.equal(plan.total, 1);
    assert.equal(plan.wrapped, false);
  }
});

test("a visited endpoint is still due under its own anchor", () => {
  const queue = mixedTierQueue();
  const afterFirst = helpers.buildReviewAnchor(queue, ["n.md:1"], 1);
  const repeat = helpers.planReviewJump(queue, {
    endpoint: "first",
    anchor: afterFirst,
  });
  assert.equal(repeat.entry.key, "n.md:1");
  assert.equal(repeat.rank, 1);
  assert.equal(repeat.total, 5);

  const afterLast = helpers.buildReviewAnchor(queue, ["o.md:5"], 5);
  const repeatLast = helpers.planReviewJump(queue, {
    endpoint: "last",
    anchor: afterLast,
  });
  assert.equal(repeatLast.entry.key, "o.md:5");
  assert.equal(repeatLast.rank, 5);
  assert.equal(repeatLast.total, 5);
});

test("lowercase steps continue from an endpoint anchor", () => {
  const queue = mixedTierQueue();
  const fromFirst = helpers.buildReviewAnchor(queue, ["n.md:1"], 1);
  const next = helpers.planReviewJump(queue, { direction: 1, anchor: fromFirst });
  assert.equal(next.entry.key, "p.md:2");

  const fromLast = helpers.buildReviewAnchor(queue, ["o.md:5"], 5);
  const prev = helpers.planReviewJump(queue, { direction: -1, anchor: fromLast });
  assert.equal(prev.entry.key, "r.md:4");
  const wrapped = helpers.planReviewJump(queue, { direction: 1, anchor: fromLast });
  assert.equal(wrapped.entry.key, "n.md:1");
  assert.equal(wrapped.wrapped, true);
});

test("a stamped endpoint that moved is stale and cannot land from old text", () => {
  const queue = mixedTierQueue();
  const first = queue[0];
  assert.deepEqual(
    helpers.resolveReviewQueueLine("- [ ] #task Something else", first),
    { ok: false, reason: "stale" },
  );
  assert.deepEqual(
    helpers.resolveReviewQueueLine(
      ["# Tasks", first.originalMarkdown].join("\n"),
      first,
    ),
    { ok: true, line: 1, source: "text" },
  );
});

// Method harness: stubbed ledger-tools api plus landing, with write and
// stamp spies that throw if an endpoint jump attempts to mutate content.
function endpointMethodHarness({ queues, landings }) {
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
      throw new Error("endpoint jumps never stamp");
    },
    setRefreshLine: () => {
      throw new Error("endpoint jumps never set refresh");
    },
  };
  plugin.app = {
    plugins: { plugins: { "bob-ledger-tools": { api: { version: 3, freshness } } } },
    vault: {
      getAbstractFileByPath: () => {
        throw new Error("endpoint tests stub landing; vault is never read");
      },
    },
    workspace: { getActiveFile: () => null, on: () => ({}) },
  };
  plugin.getActiveMarkdownView = () => null;
  plugin.reviewAnchor = null;
  plugin.landOnReviewQueueEntry = async (entry) => {
    seen.landCalls.push(entry);
    seen.landEntries.push(entry && entry.key);
    return landings[Math.min(seen.landCalls.length, landings.length) - 1];
  };
  return { plugin, seen };
}

test("stale endpoint target reselects the same endpoint in the new queue", async () => {
  const before = mixedTierQueue();
  // The reread queue dropped the old head; ranks are 1-based over it.
  const after = mixedTierQueue()
    .slice(1)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
  const { plugin, seen } = endpointMethodHarness({
    queues: [before, after],
    landings: [{ ok: false, stale: true }, { ok: true, stale: false }],
  });
  notices.length = 0;
  assert.equal(await plugin.jumpToDueTask(1, { endpoint: "first" }), true);
  assert.deepEqual(seen.landEntries, [before[0].key, after[0].key]);
  assert.equal(plugin.reviewAnchor.keys[0], after[0].key);
  assert.equal(plugin.reviewAnchor.rank, 1);
  assert.match(notices.at(-1), /^Review 1\/4 · /);
  assert.ok(!notices.at(-1).includes("wrapped around"));

  const lastHarness = endpointMethodHarness({
    queues: [before, after],
    landings: [{ ok: false, stale: true }, { ok: true, stale: false }],
  });
  notices.length = 0;
  assert.equal(await lastHarness.plugin.jumpToDueTask(-1, { endpoint: "last" }), true);
  assert.deepEqual(lastHarness.seen.landEntries, [before[4].key, after[3].key]);
  assert.equal(lastHarness.plugin.reviewAnchor.keys[0], after[3].key);
  assert.match(notices.at(-1), /^Review 4\/4 · /);
});

test("endpoint retry is bounded and failures preserve the anchor", async () => {
  const queue = mixedTierQueue();
  const anchor = helpers.buildReviewAnchor(queue, ["x.md:3"], 3);

  const retryEmpty = endpointMethodHarness({
    queues: [queue, []],
    landings: [{ ok: false, stale: true }, { ok: true, stale: false }],
  });
  retryEmpty.plugin.reviewAnchor = anchor;
  notices.length = 0;
  assert.equal(await retryEmpty.plugin.jumpToDueTask(1, { endpoint: "first" }), false);
  assert.equal(notices.at(-1), "Nothing due for review · ✓ 3 today");
  assert.equal(retryEmpty.plugin.reviewAnchor, anchor);

  const retryStale = endpointMethodHarness({
    queues: [queue, queue],
    landings: [{ ok: false, stale: true }, { ok: false, stale: true }],
  });
  retryStale.plugin.reviewAnchor = anchor;
  notices.length = 0;
  assert.equal(await retryStale.plugin.jumpToDueTask(-1, { endpoint: "last" }), false);
  assert.equal(retryStale.seen.landCalls.length, 2);
  assert.equal(notices.at(-1), "Review queue changed — try again");
  assert.equal(retryStale.plugin.reviewAnchor, anchor);

  const hardFailure = endpointMethodHarness({
    queues: [queue],
    landings: [{ ok: false, stale: false }],
  });
  hardFailure.plugin.reviewAnchor = anchor;
  notices.length = 0;
  assert.equal(await hardFailure.plugin.jumpToDueTask(1, { endpoint: "first" }), false);
  assert.equal(hardFailure.seen.landCalls.length, 1);
  assert.equal(notices.at(-1), "Could not jump to task");
  assert.equal(hardFailure.plugin.reviewAnchor, anchor);

  const missingApi = endpointMethodHarness({ queues: [queue], landings: [] });
  missingApi.plugin.app = {};
  missingApi.plugin.reviewAnchor = anchor;
  notices.length = 0;
  assert.equal(await missingApi.plugin.jumpToDueTask(1, { endpoint: "first" }), false);
  assert.equal(notices.at(-1), "Bob Ledger Tools api v3 required");
  assert.equal(missingApi.plugin.reviewAnchor, anchor);
});

test("endpoint jump to ROTTEN carries no boundary preamble", async () => {
  const queue = mixedTierQueue();
  const { plugin } = endpointMethodHarness({
    queues: [queue],
    landings: [{ ok: true, stale: false }],
  });
  notices.length = 0;
  assert.equal(await plugin.jumpToDueTask(-1, { endpoint: "last" }), true);
  assert.match(notices.at(-1), /^Review 5\/5 · ROTTEN 1\/1 · rotten 3d · every 7d$/);
  assert.ok(!notices.at(-1).includes("Commitments done"));
  assert.ok(!notices.at(-1).includes("ROTTEN next"));
  // The installed anchor lets lowercase navigation continue from the end.
  const back = helpers.planReviewJump(queue, { direction: -1, anchor: plugin.reviewAnchor });
  assert.equal(back.entry.key, "r.md:4");

  const relative = endpointMethodHarness({
    queues: [queue],
    landings: [{ ok: true, stale: false }],
  });
  relative.plugin.reviewAnchor = helpers.buildReviewAnchor(
    queue,
    ["n.md:1", "p.md:2", "x.md:3", "r.md:4"],
    4,
  );
  notices.length = 0;
  assert.equal(await relative.plugin.jumpToDueTask(1), true);
  assert.ok(notices.at(-1).startsWith("Commitments done — 1 ROTTEN left\n"));
});

test("endpoint notices keep v4 tier details and legacy v3 text", () => {
  const queue = mixedTierQueue();
  assert.equal(
    helpers.buildReviewJumpNotice(queue[0], 1, 5, { todayText: "2026-10-08" }),
    "Review 1/5 · NEW 1/1",
  );
  assert.equal(
    helpers.buildReviewJumpNotice(queueEntry({ state: "new" }), 1, 3),
    "Review 1/3 · NEW",
  );
});

test("onload registers first/last commands routed to the shared jump", () => {
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
  assert.ok(first);
  assert.ok(last);
  assert.equal(first.name, "Jump to first task due for freshness review");
  assert.equal(last.name, "Jump to last task due for freshness review");
  assert.equal(first.hotkeys, undefined);
  assert.equal(last.hotkeys, undefined);
  // Both route through the shared jump with an explicit endpoint, never the
  // relative fallback (forward would map to first, backward to last).
  const calls = [];
  plugin.jumpToDueTask = (direction, options) => {
    calls.push({ direction, options });
    return true;
  };
  first.callback();
  last.callback();
  assert.deepEqual(calls, [
    { direction: 1, options: { endpoint: "first" } },
    { direction: -1, options: { endpoint: "last" } },
  ]);
  // Existing review commands keep working.
  const next = commands.find((item) => item.id === "jump-to-next-due-task");
  const prev = commands.find((item) => item.id === "jump-to-prev-due-task");
  assert.ok(next);
  assert.ok(prev);
});
