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
