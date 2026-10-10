const assert = require("node:assert/strict");
const test = require("node:test");
const {
  LedgerToolsPlugin,
  helpers,
  coerceFreshnessConfig,
  freshnessCounts,
  freshnessIntervalForLine,
  freshnessQueue,
  freshnessStampLine,
  D,
  CFG,
  sRow,
  laneRow,
  makeFreshnessApp,
  withMissingConfig,
  checklistTaskRow,
} = require("./ledger-tools-harness.cjs");
test("project tracking stays special while reference tasks use ordinary Ready freshness", () => {
  const { freshnessEvaluate } = helpers;
  const project = freshnessEvaluate(
    sRow({ rawLine: "- [ ] #task Project ^prj", blockId: "prj" }),
    D,
    CFG,
  );
  assert.equal(project.state, "new");
  assert.equal(project.tier, "projects");

  const hiddenProject = freshnessEvaluate(
    sRow({ rawLine: "- [ ] #task Project #hide ^prj", blockId: "prj", laneVisible: false }),
    D,
    CFG,
  );
  assert.equal(hiddenProject.tier, null);

  const reference = sRow({
    path: "same.md",
    line: 1,
    rawLine: "- [ ] #task #REF Read [fresh:: 2026-10-06] [keeps:: 3] ^ref-essay",
    blockId: "ref-essay",
    tags: ["#task", "#REF"],
  });
  const ordinary = sRow({
    path: "same.md",
    line: 1,
    rawLine: "- [ ] #task Read [fresh:: 2026-10-06] [keeps:: 3] ^ordinary",
  });
  const config = { ...CFG, interval: 2, intervalFromConfig: true };
  const referenceEval = freshnessEvaluate(reference, D, config);
  const ordinaryEval = freshnessEvaluate(ordinary, D, config);
  assert.deepEqual(referenceEval, ordinaryEval);
  assert.equal(referenceEval.state, "rotten");
  assert.equal(referenceEval.tier, "rotten");
  assert.equal(referenceEval.intervalSource, "config");
  assert.equal(referenceEval.dueOn, "2026-10-08");

  const unstampedRef = freshnessEvaluate(
    sRow({ rawLine: "- [ ] #task #ref Read ^ref" }),
    D,
    CFG,
  );
  assert.equal(unstampedRef.state, "new");
  assert.equal(unstampedRef.tier, "new");
  assert.equal(helpers.freshnessBucketForState(unstampedRef.state), "new");

  const hiddenReference = freshnessEvaluate(
    sRow({ rawLine: "- [ ] #task #ref Read #hide ^ref", laneVisible: false }),
    D,
    CFG,
  );
  assert.equal(hiddenReference.state, null);
  assert.equal(hiddenReference.tier, null);
});

test("reference tasks match ordinary interval precedence and lane behavior", () => {
  const intervalConfig = { ...CFG, interval: 9, intervalFromConfig: true };
  for (const [line, noteRefreshRaw, expected] of [
    ["- [ ] #task #ref A [fresh:: 2026-10-03] [refresh:: 2] ^ref", "4", { days: 2, source: "task" }],
    ["- [ ] #task #ref A [fresh:: 2026-10-03] ^ref", "4", { days: 4, source: "note" }],
    ["- [ ] #task #ref A [fresh:: 2026-10-03] ^ref", null, { days: 9, source: "config" }],
  ]) {
    const ordinaryLine = line.replace(" #ref", "");
    const ref = helpers.freshnessEvaluate(
      sRow({ rawLine: line, noteRefreshRaw }),
      D,
      intervalConfig,
    );
    const ordinary = helpers.freshnessEvaluate(
      sRow({ rawLine: ordinaryLine, noteRefreshRaw }),
      D,
      intervalConfig,
    );
    assert.deepEqual(ref, ordinary);
    assert.equal(ref.intervalDays, expected.days);
    assert.equal(ref.intervalSource, expected.source);
  }

  for (const [symbol, lane, intervalSource] of [
    ["/", "pending", "pending"],
    ["*", "next", "next"],
  ]) {
    const refLine = "- [" + symbol + "] #task #ref A [fresh:: 2026-10-07] ^ref";
    const ordinaryLine = refLine.replace(" #ref", "");
    const ref = helpers.freshnessEvaluate(
      { ...laneRow("same.md", 1, symbol, "2026-10-07", null), rawLine: refLine },
      D,
      CFG,
    );
    const ordinary = helpers.freshnessEvaluate(
      { ...laneRow("same.md", 1, symbol, "2026-10-07", null), rawLine: ordinaryLine },
      D,
      CFG,
    );
    assert.deepEqual(ref, ordinary);
    assert.equal(ref.lane, lane);
    assert.equal(ref.state, null);
    assert.equal(ref.tier, lane);
    assert.equal(ref.intervalDays, 1);
    assert.equal(ref.intervalSource, intervalSource);
  }

  for (const [symbol, laneKey] of [["/", "pendingInterval"], ["*", "nextInterval"]]) {
    const disabled = { ...CFG, [laneKey]: null };
    const ref = helpers.freshnessEvaluate(
      { ...laneRow("same.md", 1, symbol, "2026-10-01", null), rawLine: "- [" + symbol + "] #task #ref A ^ref" },
      D,
      disabled,
    );
    const ordinary = helpers.freshnessEvaluate(
      { ...laneRow("same.md", 1, symbol, "2026-10-01", null), rawLine: "- [" + symbol + "] #task A ^plain" },
      D,
      disabled,
    );
    assert.deepEqual(ref, ordinary);
    assert.equal(ref.tier, null);
    assert.equal(ref.dueOn, null);
  }

  assert.deepEqual(
    freshnessIntervalForLine("- [/] #task #ref A ^ref", null, CFG),
    { days: 1, source: "pending", ready: { days: 7, source: "default" } },
  );
  assert.deepEqual(
    freshnessIntervalForLine("- [ ] #task #ref A", null, intervalConfig),
    { days: 9, source: "config", ready: { days: 9, source: "config" } },
  );
});

test("obsolete reference interval keys are ignored and project config still validates", () => {
  for (const oldValue of [3, null, false, "soon", { days: 3 }]) {
    for (const key of ["reference_interval", "referenceInterval"]) {
      const result = coerceFreshnessConfig({ interval: 5, [key]: oldValue });
      assert.equal(result.invalid, false, key + ":" + JSON.stringify(oldValue));
      assert.equal(result.config.interval, 5);
      assert.equal(result.config.projectInterval, null);
    }
  }
  assert.equal(coerceFreshnessConfig({ project_interval: 1 }).config.projectInterval, 1);
  assert.equal(coerceFreshnessConfig({ project_interval: false }).invalid, true);
  assert.equal(coerceFreshnessConfig({ project_interval: 366 }).invalid, true);
});

test("references use ordinary keep decisions and the nine-tier queue shape", () => {
  const config = {
    ...CFG,
    decay: { enabled: true, keeps: 3, enter: null },
  };
  const ref = sRow({
    path: "r.md",
    line: 1,
    rawLine: "- [ ] #task #ref Read [fresh:: 2026-10-05] [scheduled:: 2026-10-07] [keeps:: 3] ^ref",
    scheduled: "2026-10-07",
  });
  const plain = sRow({
    path: "r.md",
    line: 1,
    rawLine: "- [ ] #task Read [fresh:: 2026-10-05] [scheduled:: 2026-10-07] [keeps:: 3] ^plain",
    scheduled: "2026-10-07",
  });
  const refEval = helpers.freshnessEvaluate(ref, D, config);
  assert.deepEqual(refEval, helpers.freshnessEvaluate(plain, D, config));
  assert.equal(refEval.tier, "tickler");
  assert.equal(refEval.state, "resurfaced");
  assert.equal(refEval.decide, true);

  const rows = [
    sRow({ path: "new.md", line: 1, rawLine: "- [ ] #task #ref Unread ^ref" }),
    sRow({ path: "plain.md", line: 1, rawLine: "- [ ] #task Plain" }),
    sRow({ path: "old.md", line: 1, rawLine: "- [ ] #task #REF Old [fresh:: 2026-09-20] ^ref" }),
  ];
  const queue = freshnessQueue(rows, D, CFG);
  assert.deepEqual(queue.map((entry) => entry.tier), ["new", "new", "rotten"]);
  const counts = freshnessCounts(rows, D, CFG);
  assert.deepEqual(Object.keys(counts.byTier), [
    "pre", "new", "projects", "pending", "next", "recurring", "tickler", "rotten", "post",
  ]);
  assert.equal(counts.walk, 3);
  assert.equal(counts.referencesDue, undefined);
});

test("CL1-CL7: exact checklist scope, precedence, and unchanged state buckets", () => {
  const cl1 = checklistTaskRow(
    "- [ ] #task #gtd #pre Brush teeth [repeat:: every day when done] [scheduled:: 2026-10-01]",
    ["#task", "#gtd", "#pre"],
    { recurrence: { rule: "every day" } },
  );
  assert.equal(cl1.statusSymbol, " ");
  assert.equal(cl1.checklist, "pre");
  const cl1Eval = helpers.freshnessEvaluate(cl1, D, CFG);
  assert.equal(cl1Eval.tier, "pre");
  assert.equal(cl1Eval.lane, "ready");
  assert.equal(cl1Eval.state, null);
  assert.equal(helpers.freshnessBucketForState(cl1Eval.state), null);
  assert.equal(cl1Eval.dueOn, null);

  const cl2 = checklistTaskRow(
    "- [?] #task #gtd #pre Check weather [repeat:: every day when done] [scheduled:: 2026-10-08]",
    ["#task", "#gtd", "#pre"],
  );
  const cl2Eval = helpers.freshnessEvaluate(cl2, D, CFG);
  assert.equal(cl2.statusSymbol, "?");
  assert.equal(cl2Eval.tier, "pre");
  assert.equal(cl2Eval.lane, null);
  assert.equal(freshnessQueue([cl2], D, CFG).length, 1);

  const excluded = [
    checklistTaskRow("- [?] #task #gtd #pre Blocked", ["#task", "#gtd", "#pre"], { blocked: true }),
    checklistTaskRow("- [ ] #task #gtd #pre Tomorrow [scheduled:: 2026-10-09]", ["#task", "#gtd", "#pre"]),
    checklistTaskRow("- [ ] #task #gtd #pre Hidden #hide", ["#task", "#gtd", "#pre", "#hide"]),
    checklistTaskRow("- [ ] #task #gtd #pre Template", ["#task", "#gtd", "#pre"], { path: "_templates/daily.md" }),
  ];
  assert.deepEqual(excluded.map((row) => helpers.freshnessEvaluate(row, D, CFG).tier), [null, null, null, null]);
  assert.equal(freshnessQueue(excluded, D, CFG).length, 0);

  const todayAndDaily = [
    sRow({ checklist: "pre", recurring: true, path: "gtd_daily.md", rawLine: "- [ ] #task #gtd #pre Daily" }),
    sRow({ checklist: "pre", isDailyNote: true, path: "2026/20261008.md", rawLine: "- [ ] #task #gtd #pre Daily note" }),
    sRow({ checklist: "pre", isToday: true, rawLine: "- [ ] #task #gtd #pre Today" }),
  ];
  assert.deepEqual(todayAndDaily.map((row) => helpers.freshnessEvaluate(row, D, CFG).tier), ["pre", "pre", "pre"]);

  for (const [tags, expected] of [
    [["#pre"], null],
    [["#gtd", "#pressed_juice"], null],
    [["#gtd/pre"], null],
    [["#GTD", "#Pre"], "pre"],
    [["#gtd", "#pre", "#post"], "pre"],
    [["#gtd", "#post"], "post"],
  ]) {
    const row = checklistTaskRow("- [ ] #task tagged", tags);
    assert.equal(row.checklist, expected, JSON.stringify(tags));
    assert.equal(
      helpers.freshnessEvaluate(row, D, CFG).tier,
      expected || "new",
    );
  }

  const cl7 = checklistTaskRow(
    "- [ ] #task #gtd #post Write retro",
    ["#task", "#gtd", "#post"],
  );
  const cl7Eval = helpers.freshnessEvaluate(cl7, D, CFG);
  assert.equal(cl7Eval.tier, "post");
  assert.equal(cl7Eval.state, "new");
  assert.equal(helpers.freshnessBucketForState(cl7Eval.state), "new");
  assert.equal(cl7Eval.dueOn, null);

  const noWrittenStatus = checklistTaskRow(
    "not a task line",
    ["#task", "#gtd", "#pre"],
  );
  assert.equal(noWrittenStatus.statusSymbol, null);
  assert.equal(helpers.freshnessEvaluate(noWrittenStatus, D, CFG).tier, null);
});

test("CL8-CL12: nine tier order, checklist-only due counts, and completion semantics", () => {
  const rows = [
    sRow({ path: "a.md", line: 1, checklist: "pre", recurring: true, rawLine: "- [ ] #task #gtd #pre Pre" }),
    sRow({ path: "b.md", line: 1, rawLine: "- [ ] #task New" }),
    sRow({ path: "c.md", line: 1, blockId: "prj", rawLine: "- [ ] #task Project [fresh:: 2026-10-01] ^prj" }),
    laneRow("d.md", 1, "/", "2026-10-07", null),
    laneRow("e.md", 1, "*", "2026-10-07", null),
    sRow({ path: "f.md", line: 1, rawLine: "- [ ] #task Tickler [fresh:: 2026-10-05] [scheduled:: 2026-10-07]", scheduled: "2026-10-07" }),
    sRow({ path: "g.md", line: 1, blockId: "ref", rawLine: "- [ ] #task Reference [fresh:: 2026-10-01] ^ref" }),
    sRow({ path: "h.md", line: 1, rawLine: "- [ ] #task Rotten [fresh:: 2026-10-01]" }),
    sRow({ path: "i.md", line: 1, checklist: "post", rawLine: "- [ ] #task #gtd #post Post" }),
  ];
  const queue = freshnessQueue(rows, D, CFG);
  assert.deepEqual(queue.map((entry) => entry.tier), [
    "pre", "new", "projects", "pending", "next", "tickler", "rotten", "rotten", "post",
  ]);
  assert.equal(queue[0].lane, "ready");
  assert.equal(queue.at(-1).lane, "ready");
  const counts = freshnessCounts(rows, D, CFG);
  assert.equal(counts.preDue, 1);
  assert.equal(counts.postDue, 1);
  assert.equal(counts.walk, 9);
  assert.equal(counts.walk, Object.values(counts.byTier).reduce((sum, count) => sum + count, 0));
  assert.equal(counts.byTier.pre, 1);
  assert.equal(counts.byTier.post, 1);

  const recurring = "- [ ] #task #gtd #pre Water plants [fresh:: 2026-10-08] [keeps:: 3] [repeat:: every day]";
  assert.equal(freshnessStampLine(recurring, D).refused, "recurring");
  assert.equal(helpers.freshnessKeepLine(recurring, D).refused, "recurring");
  const recurringRow = sRow({
    checklist: "pre",
    recurring: true,
    rawLine: recurring,
  });
  const recurringEval = helpers.freshnessEvaluate(recurringRow, D, CFG);
  assert.equal(recurringEval.tier, "pre");
  assert.equal(recurringEval.keeps, 3);
  assert.equal(recurringEval.decide, false);

  const completed = checklistTaskRow(
    "- [x] #task #gtd #pre Chore [completion:: 2026-10-08]",
    ["#task", "#gtd", "#pre"],
  );
  const nextOccurrence = checklistTaskRow(
    "- [ ] #task #gtd #pre Chore [repeat:: every day when done] [scheduled:: 2026-10-09]",
    ["#task", "#gtd", "#pre"],
  );
  assert.equal(helpers.freshnessEvaluate(completed, D, CFG).tier, null);
  assert.equal(helpers.freshnessEvaluate(nextOccurrence, D, CFG).tier, null);

  const nextChecklist = checklistTaskRow("- [*] #task #gtd #pre Next", ["#task", "#gtd", "#pre"]);
  assert.equal(helpers.freshnessEvaluate(nextChecklist, D, CFG).tier, "pre");
  assert.equal(helpers.freshnessEvaluate(nextChecklist, D, CFG).lane, "next");
  const refChecklist = checklistTaskRow(
    "- [ ] #task #gtd #post Reference ^ref",
    ["#task", "#gtd", "#post"],
    { lineNumber: 1 },
  );
  refChecklist.blockId = "ref";
  assert.equal(helpers.freshnessEvaluate(refChecklist, D, CFG).tier, "post");

  const missingWhenDone = checklistTaskRow(
    "- [ ] #task #gtd #pre Daily [repeat:: every day]",
    ["#task", "#gtd", "#pre"],
    { recurrence: { rule: "every day" } },
  );
  assert.equal(helpers.freshnessEvaluate(missingWhenDone, D, CFG).tier, "pre");
});

test("freshness namespace v11 retires reference-only capability flags", () => {
  withMissingConfig(() => {
    const plugin = new LedgerToolsPlugin(makeFreshnessApp({}), {});
    plugin.onload();
    try {
      assert.equal(plugin.api.freshness.version, 11);
      assert.equal(plugin.api.freshness.referenceReview, undefined);
      assert.equal(plugin.api.freshness.refTagIdentity, undefined);
      assert.equal(plugin.api.version, 3);
    } finally {
      plugin.onunload();
    }
  });
});

// __FRESHNESS_TEST_END__
