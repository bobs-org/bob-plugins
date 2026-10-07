const assert = require("node:assert/strict");
const test = require("node:test");
const {
  helpers,
  freshnessCounts,
  freshnessQueue,
  D,
  CFG,
  sRow,
  laneRow,
  readyRow,
} = require("./ledger-tools-harness.cjs");
test("Q1 Bryan's example orders A, D, C, B by interval, lateness, newest created", () => {
  const d = readyRow("d.md", 1, "2026-10-07", "2026-09-01");
  d.rawLine = "- [ ] #task A [fresh:: 2026-10-07] [refresh:: 1]";
  const c = readyRow("c.md", 1, "2026-09-28", "2026-09-04");
  const b = readyRow("b.md", 1, "2026-09-28", "2026-09-01");
  const a = readyRow("a.md", 1, "2026-09-30", "2026-09-01");
  const ordered = freshnessQueue([d, c, b, a], D, CFG);
  assert.deepEqual(
    ordered.map((entry) => `${entry.path}:${entry.line}`),
    ["d.md:1", "c.md:1", "b.md:1", "a.md:1"],
  );
  assert.deepEqual(
    ordered.map((entry) => entry.tier),
    ["rotten", "rotten", "rotten", "rotten"],
  );
  assert.equal(ordered[0].interval, 1);
  assert.equal(ordered[0].dueOn, "2026-10-08");
});

test("Q2 tier order beats path order", () => {
  const fresh = readyRow("e.md", 1, null, null);
  const pending = laneRow("d.md", 1, "/", "2026-10-07", null);
  const next = laneRow("c.md", 1, "*", "2026-10-07", null);
  const tickler = readyRow("b.md", 1, "2026-10-05", null);
  tickler.scheduled = "2026-10-07";
  tickler.rawLine =
    "- [ ] #task R [fresh:: 2026-10-05] [scheduled:: 2026-10-07]";
  const rotten = readyRow("a.md", 1, "2026-09-20", null);
  const ordered = freshnessQueue([rotten, tickler, next, pending, fresh], D, CFG);
  assert.deepEqual(
    ordered.map((entry) => `${entry.path}:${entry.line}`),
    ["e.md:1", "d.md:1", "c.md:1", "b.md:1", "a.md:1"],
  );
  assert.deepEqual(
    ordered.map((entry) => entry.tier),
    ["new", "pending", "next", "tickler", "rotten"],
  );
  assert.deepEqual(
    ordered.map((entry) => entry.tierLabel),
    ["NEW", "PENDING", "NEXT", "TICKLER", "ROTTEN"],
  );
});

test("L1 lane due and stamped today", () => {
  const todayRow = laneRow("a.md", 1, "*", "2026-10-08", null);
  const evaluatedToday = helpers.freshnessEvaluate(todayRow, D, CFG);
  assert.equal(evaluatedToday.state, null);
  assert.equal(evaluatedToday.tier, null);
  assert.equal(evaluatedToday.lane, "next");
  const due = laneRow("a.md", 2, "*", "2026-10-07", null);
  const evaluated = helpers.freshnessEvaluate(due, D, CFG);
  assert.equal(evaluated.state, null);
  assert.equal(evaluated.tier, "next");
  assert.equal(evaluated.lane, "next");
  assert.equal(evaluated.dueOn, "2026-10-08");
  assert.equal(evaluated.daysOverdue, 0);
  assert.equal(evaluated.intervalDays, 1);
  assert.equal(evaluated.intervalSource, "next");
});

test("L2 lane overrides refresh", () => {
  const input = laneRow("a.md", 1, "/", "2026-10-07", null);
  input.rawLine = "- [/] #task Lane [fresh:: 2026-10-07] [refresh:: 30]";
  const evaluated = helpers.freshnessEvaluate(input, D, CFG);
  assert.equal(evaluated.tier, "pending");
  assert.equal(evaluated.intervalDays, 1);
  assert.equal(evaluated.intervalSource, "pending");
});

test("L3 lane exclusions have no tier", () => {
  const fresh = "2026-10-07";
  const recurring = laneRow("a.md", 1, "*", fresh, null);
  recurring.recurring = true;
  const todayMember = laneRow("a.md", 2, "*", fresh, null);
  todayMember.isToday = true;
  const daily = laneRow("2026/20261008.md", 1, "*", fresh, null);
  daily.isDailyNote = true;
  const hidden = laneRow("a.md", 3, "*", fresh, null);
  hidden.laneVisible = false;
  for (const [name, candidate] of [
    ["recurring", recurring],
    ["today", todayMember],
    ["daily", daily],
    ["hidden", hidden],
  ]) {
    const evaluated = helpers.freshnessEvaluate(candidate, D, CFG);
    assert.equal(evaluated.tier, null, `${name} must be in no tier`);
    assert.equal(evaluated.state, null, `${name} keeps a null state`);
  }
});

test("L4 lane off switch and null default", () => {
  const off = { ...CFG, nextInterval: null };
  const never = laneRow("a.md", 1, "*", null, null);
  const evaluated = helpers.freshnessEvaluate(never, D, off);
  assert.equal(evaluated.tier, null);
  assert.equal(evaluated.intervalDays, 7);
  assert.equal(evaluated.intervalSource, "default");
  const evaluatedOn = helpers.freshnessEvaluate(never, D, CFG);
  assert.equal(evaluatedOn.tier, "next");
  assert.equal(evaluatedOn.intervalDays, 1);
});

test("L5 lane order never stamped first", () => {
  const z = laneRow("z.md", 9, "/", null, "2026-09-01");
  const b = laneRow("b.md", 1, "/", "2026-10-01", "2026-09-15");
  const a5 = laneRow("a.md", 5, "/", "2026-10-07", "2026-09-10");
  const a2 = laneRow("a.md", 2, "/", "2026-10-07", "2026-09-20");
  const a1 = laneRow("a.md", 1, "/", "2026-10-07", null);
  const ordered = freshnessQueue([a1, a2, a5, b, z], D, CFG);
  assert.deepEqual(
    ordered.map((entry) => `${entry.path}:${entry.line}`),
    ["z.md:9", "b.md:1", "a.md:5", "a.md:2", "a.md:1"],
  );
  assert.deepEqual(
    ordered.map((entry) => entry.tier),
    ["pending", "pending", "pending", "pending", "pending"],
  );
});

test("R1 TICKLER beats older ROTTEN", () => {
  const tickler = readyRow("b.md", 1, "2026-10-05", null);
  tickler.scheduled = "2026-10-07";
  tickler.rawLine =
    "- [ ] #task R [fresh:: 2026-10-05] [scheduled:: 2026-10-07]";
  const rotten = readyRow("a.md", 1, "2026-09-20", null);
  const ordered = freshnessQueue([rotten, tickler], D, CFG);
  assert.deepEqual(
    ordered.map((entry) => `${entry.path}:${entry.line}`),
    ["b.md:1", "a.md:1"],
  );
  assert.deepEqual(
    ordered.map((entry) => entry.tier),
    ["tickler", "rotten"],
  );
});

test("R2 tickler orders by schedule then newest created", () => {
  const x = readyRow("x.md", 1, "2026-10-05", "2026-09-01");
  x.scheduled = "2026-10-06";
  x.rawLine = "- [ ] #task X [fresh:: 2026-10-05] [scheduled:: 2026-10-06]";
  const w = readyRow("w.md", 1, "2026-10-05", "2026-09-05");
  w.scheduled = "2026-10-07";
  w.rawLine = "- [ ] #task W [fresh:: 2026-10-05] [scheduled:: 2026-10-07]";
  const y = readyRow("y.md", 1, "2026-10-05", "2026-09-01");
  y.scheduled = "2026-10-07";
  y.rawLine = "- [ ] #task Y [fresh:: 2026-10-05] [scheduled:: 2026-10-07]";
  const ordered = freshnessQueue([y, w, x], D, CFG);
  assert.deepEqual(
    ordered.map((entry) => `${entry.path}:${entry.line}`),
    ["x.md:1", "w.md:1", "y.md:1"],
  );
});

test("missing created sorts after dated peers", () => {
  const dated = laneRow("a.md", 1, "/", "2026-10-07", "2026-09-01");
  const missing = laneRow("a.md", 2, "/", "2026-10-07", null);
  const ordered = freshnessQueue([missing, dated], D, CFG);
  assert.deepEqual(
    ordered.map((entry) => `${entry.path}:${entry.line}`),
    ["a.md:1", "a.md:2"],
  );
  const old = readyRow("a.md", 3, "2026-09-28", "2026-09-01");
  const fresh = readyRow("a.md", 4, "2026-09-28", "2026-09-04");
  const missingRotten = readyRow("a.md", 5, "2026-09-28", null);
  const orderedRotten = freshnessQueue([missingRotten, old, fresh], D, CFG);
  assert.deepEqual(
    orderedRotten.map((entry) => `${entry.path}:${entry.line}`),
    ["a.md:4", "a.md:3", "a.md:5"],
  );
});

test("B1 upkeep counts outside the lanes", () => {
  const rows = [];
  for (let i = 0; i < 10; i += 1) {
    rows.push({
      ...laneRow("lane.md", i + 1, "/", null, null),
      rawLine: `- [/] #task Lane ${i} [fresh:: 2026-10-08]`,
    });
    const evaluated = helpers.freshnessEvaluate(rows[rows.length - 1], D, CFG);
    assert.equal(evaluated.fresh, "2026-10-08");
  }
  // Re-stamp the lane rows with today so refreshedToday counts them.
  const stamped = rows.map((row) => ({
    ...row,
    rawLine: row.rawLine.includes("[fresh::")
      ? row.rawLine
      : row.rawLine + " [fresh:: 2026-10-08]",
  }));
  for (let i = 0; i < 10; i += 1) {
    stamped.push({
      ...laneRow("lane.md", 11 + i, "*", null, null),
      rawLine: `- [*] #task Lane ${10 + i} [fresh:: 2026-10-08]`,
    });
  }
  for (let i = 0; i < 5; i += 1) {
    stamped.push(
      sRow({
        path: "a.md",
        line: i + 1,
        rawLine: `- [ ] #task Ready ${i} [fresh:: 2026-10-08]`,
      }),
    );
  }
  const budget = { ...CFG, rottenDailyBudget: 15 };
  const report = freshnessCounts(stamped, D, budget);
  assert.equal(report.refreshedToday, 25);
  assert.equal(report.upkeepToday, 5);
  assert.equal(report.budgetMet, false);
  const more = [
    ...stamped,
    sRow({
      path: "b.md",
      line: 1,
      statusSymbol: "?",
      isTodo: false,
      laneVisible: false,
      rawLine: "- [?] #task Blocked [fresh:: 2026-10-08]",
    }),
    sRow({
      path: "c.md",
      line: 1,
      statusSymbol: "x",
      isTodo: false,
      laneVisible: false,
      rawLine: "- [x] #task Done [fresh:: 2026-10-08]",
    }),
  ];
  const report2 = freshnessCounts(more, D, budget);
  assert.equal(report2.refreshedToday, 27);
  assert.equal(report2.upkeepToday, 7);
});

test("review model meter uses upkeep and exposes refreshed", () => {
  const { freshnessReviewModel } = helpers;
  const model = freshnessReviewModel(
    {
      due: 1,
      new: 0,
      resurfaced: 0,
      rotten: 1,
      fresh: 0,
      refreshedToday: 25,
      upkeepToday: 5,
      budget: 15,
      budgetMet: false,
    },
    [{ state: "rotten", daysOverdue: 2, interval: 7 }],
  );
  assert.equal(model.meter, "✓ 5/15");
  assert.equal(model.upkeepToday, 5);
  assert.equal(model.refreshedToday, 25);
  assert.equal(model.rottenText, "ROTTEN 1 · ✓ 5/15");
});


