// UB conformance vectors mirror `docs/freshness.md` §10b (bob-cli),
// with D = today = 2026-10-08. The keep vectors follow the selected
// `unblock_keeps = yes` branch.
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  helpers,
  D,
  CFG,
  sRow,
  readyRow,
} = require("./ledger-tools-harness.cjs");

const {
  freshnessBucketForState,
  freshnessEvaluate,
  freshnessMarkUnblockedLine,
  freshnessQueue,
  freshnessReviewEntryView,
  freshnessTasksSuffixStart,
  readFreshness,
} = helpers;

function unblockedRow(line, overrides = {}) {
  return sRow({
    rawLine: line,
    ...overrides,
  });
}

test("UB1 marks an in-scope Ready recovery and evaluates it as a TICKLER", () => {
  const line =
    "- [ ] #task Recovered [fresh:: 2026-10-01] [unblocked:: 2026-10-05] [created:: 2026-09-01]";
  const marked = freshnessMarkUnblockedLine(line, {
    today: D,
    status: " ",
  });
  assert.equal(
    marked,
    "- [ ] #task Recovered [fresh:: 2026-10-01] [unblocked:: 2026-10-08] [created:: 2026-09-01]",
  );

  const evaluated = freshnessEvaluate(unblockedRow(marked), D, CFG);
  assert.equal(evaluated.state, "resurfaced");
  assert.equal(freshnessBucketForState(evaluated.state), "rotten");
  assert.equal(evaluated.returnedBy, "unblocked");
  assert.equal(evaluated.unblockedOn, D);
  assert.equal(evaluated.dueOn, D);
  assert.equal(evaluated.tier, "tickler");
});

test("UB2-UB6 skip NEW, scheduled, lane, recurring, hidden, and Today rows", () => {
  const cases = [
    ["UB2 NEW", "- [ ] #task New", { status: " " }],
    [
      "UB3 scheduled tickler",
      "- [ ] #task Scheduled [fresh:: 2026-10-01] [scheduled:: 2026-10-07]",
      { status: " " },
    ],
    [
      "UB4 Next",
      "- [*] #task Next [fresh:: 2026-10-01]",
      { status: "*" },
    ],
    [
      "UB4 Pending",
      "- [/] #task Pending [fresh:: 2026-10-01]",
      { status: "/" },
    ],
    [
      "UB5 recurring",
      "- [ ] #task Recurring [fresh:: 2026-10-01] [repeat:: every week]",
      { status: " " },
    ],
    [
      "UB6 hidden",
      "- [ ] #task Hidden [fresh:: 2026-10-01] #hide",
      { status: " " },
    ],
    [
      "daily note",
      "- [ ] #task Daily [fresh:: 2026-10-01]",
      { status: " ", isDailyNote: true },
    ],
    [
      "Today-linked",
      "- [ ] #task Today [fresh:: 2026-10-01]",
      { status: " ", isToday: true },
    ],
  ];
  for (const [name, line, options] of cases) {
    assert.equal(freshnessMarkUnblockedLine(line, { today: D, ...options }), line, name);
  }
});

test("UB9 fresh equal to unblocked resurfaces; UB10 chooses the latest return date", () => {
  const tied = freshnessEvaluate(
    unblockedRow(
      "- [ ] #task Tied [fresh:: 2026-10-08] [unblocked:: 2026-10-08]",
    ),
    D,
    CFG,
  );
  assert.equal(tied.state, "resurfaced");
  assert.equal(tied.returnedBy, "unblocked");
  assert.equal(tied.dueOn, D);

  const latest = freshnessEvaluate(
    unblockedRow(
      "- [ ] #task Both [fresh:: 2026-10-01] [scheduled:: 2026-10-06] [unblocked:: 2026-10-07]",
      { scheduled: "2026-10-06" },
    ),
    D,
    CFG,
  );
  assert.equal(latest.returnedBy, "unblocked");
  assert.equal(latest.dueOn, "2026-10-07");
});

test("UB11 scheduled wins a tie with the unblock date", () => {
  const evaluated = freshnessEvaluate(
    unblockedRow(
      "- [ ] #task Both [fresh:: 2026-10-01] [scheduled:: 2026-10-07] [unblocked:: 2026-10-07]",
      { scheduled: "2026-10-07" },
    ),
    D,
    CFG,
  );
  assert.equal(evaluated.state, "resurfaced");
  assert.equal(evaluated.returnedBy, "scheduled");
  assert.equal(evaluated.dueOn, "2026-10-07");
});

test("unblocked reader takes the latest valid duplicate and reports malformed values", () => {
  const duplicate = readFreshness(
    "- [ ] #task A [fresh:: 2026-10-01] [unblocked:: 2026-10-05] [unblocked:: 2026-10-07]",
    D,
  );
  assert.equal(duplicate.unblocked, "2026-10-07");
  assert.ok(duplicate.lints.includes("unblocked_duplicate"));

  const malformed = readFreshness(
    "- [ ] #task A [fresh:: 2026-10-01] [unblocked:: 2026-13-01]",
    D,
  );
  assert.equal(malformed.unblocked, null);
  assert.ok(malformed.lints.includes("unblocked_malformed"));
});

test("UB12 unblocked remains outside the Tasks suffix before scheduled/dependency fields", () => {
  const line =
    "- [ ] #task Recovered [fresh:: 2026-10-01] [unblocked:: 2026-10-08] [scheduled:: 2026-10-09] [dependsOn:: lane-root] [id:: lane-task] ^lane-task";
  assert.equal(freshnessTasksSuffixStart(line), line.indexOf("[scheduled::"));
  const read = readFreshness(line, D);
  assert.equal(read.unblocked, D);

  const marked = freshnessMarkUnblockedLine(
    line.replace("2026-10-08]", "2026-10-05]"),
    { today: D, status: " " },
  );
  assert.equal(
    marked,
    "- [ ] #task Recovered [fresh:: 2026-10-01] [unblocked:: 2026-10-08] [scheduled:: 2026-10-09] [dependsOn:: lane-root] [id:: lane-task] ^lane-task",
  );
});

test("UB14 TICKLERs with the same due date sort only by path and line", () => {
  const line =
    "- [ ] #task Recovered [fresh:: 2026-10-01] [unblocked:: 2026-10-08]";
  const b = readyRow("b.md", 1, "2026-10-01", "2026-10-01");
  b.rawLine = line;
  const aLate = readyRow("a.md", 8, "2026-10-01", "2026-10-01");
  aLate.rawLine = line;
  const aEarly = readyRow("a.md", 3, "2026-10-01", "2026-10-09");
  aEarly.rawLine = line;
  const queue = freshnessQueue([b, aLate, aEarly], D, CFG);
  assert.deepEqual(
    queue.map((entry) => `${entry.path}:${entry.line}`),
    ["a.md:3", "a.md:8", "b.md:1"],
  );
  assert.ok(queue.every((entry) => entry.returnedBy === "unblocked"));
  assert.ok(queue.every((entry) => entry.dueOn === D));
  const view = freshnessReviewEntryView(queue[0]);
  assert.match(view.detail, /^unblocked /);
});

test("UB15 a scheduled ^prj resurfaces in PROJECTS", () => {
  const evaluated = freshnessEvaluate(
    unblockedRow(
      "- [ ] #task #prj Project [fresh:: 2026-10-01] [scheduled:: 2026-10-07] ^prj",
      { blockId: "prj", scheduled: "2026-10-07" },
    ),
    D,
    CFG,
  );
  assert.equal(evaluated.state, "resurfaced");
  assert.equal(evaluated.returnedBy, "scheduled");
  assert.equal(evaluated.tier, "projects");
  assert.equal(evaluated.dueOn, "2026-10-07");
});
