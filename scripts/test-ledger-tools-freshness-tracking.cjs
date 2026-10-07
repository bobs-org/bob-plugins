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
test("tracking review: visible ^prj walks PROJECTS, hidden ^prj is out, hidden ^ref is REFERENCES", () => {
  const { freshnessEvaluate } = helpers;
  const empty = freshnessEvaluate(
    sRow({ rawLine: "- [ ] #task Project ^prj", blockId: "prj", projectReadyCount: 0 }),
    D,
    CFG,
  );
  assert.equal(empty.state, "new");
  assert.equal(empty.tier, "projects");

  const stamped = freshnessEvaluate(
    sRow({
      rawLine: "- [ ] #task Project [fresh:: 2026-10-08] ^prj",
      blockId: "prj",
      projectReadyCount: 0,
    }),
    D,
    CFG,
  );
  assert.equal(stamped.state, "fresh");
  assert.equal(stamped.tier, null);

  // Open tasks in the same note no longer suppress: sync owns `#hide`.
  const populated = freshnessEvaluate(
    sRow({ rawLine: "- [ ] #task Project ^prj", blockId: "prj", projectReadyCount: 1 }),
    D,
    CFG,
  );
  assert.equal(populated.state, "new");
  assert.equal(populated.tier, "projects");

  const hiddenPrj = freshnessEvaluate(
    sRow({ rawLine: "- [ ] #task Project #hide ^prj", blockId: "prj", laneVisible: false }),
    D,
    CFG,
  );
  assert.equal(hiddenPrj.state, null);
  assert.equal(hiddenPrj.tier, null);

  const hiddenRef = freshnessEvaluate(
    sRow({ rawLine: "- [ ] #task Read #hide ^ref", blockId: "ref" }),
    D,
    CFG,
  );
  assert.equal(hiddenRef.state, "new");
  assert.equal(hiddenRef.tier, "references");

  const hidden = freshnessEvaluate(
    sRow({ rawLine: "- [ ] #task Read #hide", laneVisible: false }),
    D,
    CFG,
  );
  assert.equal(hidden.state, null);
  assert.equal(hidden.tier, null);

  const nearMatch = freshnessEvaluate(
    sRow({ rawLine: "- [ ] #task Read ^prj-extra", blockId: "prj-extra" }),
    D,
    CFG,
  );
  assert.equal(nearMatch.tier, "new");
});

test("tracking review: lane ^prj keeps its lane with the Ready cadence", () => {
  const { freshnessEvaluate } = helpers;
  const row = {
    path: "p.md",
    line: 2,
    statusSymbol: "/",
    isTodo: false,
    recurring: false,
    laneVisible: true,
    isDailyNote: false,
    isToday: false,
    scheduled: null,
    created: null,
    rawLine: "- [/] #task Project ^prj",
    noteRefreshRaw: undefined,
    blockId: "prj",
  };
  const evaluated = freshnessEvaluate(row, D, CFG);
  assert.equal(evaluated.lane, "pending");
  assert.equal(evaluated.state, null);
  assert.equal(evaluated.tier, "projects");
  assert.equal(evaluated.intervalDays, 7);
  assert.equal(evaluated.intervalSource, "default");
});

test("tracking counts decouple states from the nine-key tier histogram", () => {
  const emptyPrj = sRow({
    rawLine: "- [ ] #task Project ^prj",
    blockId: "prj",
    projectReadyCount: 0,
  });
  const hiddenRef = sRow({
    rawLine: "- [ ] #task Read #hide ^ref",
    blockId: "ref",
  });
  const lanePrj = {
    path: "p.md",
    line: 2,
    statusSymbol: "/",
    isTodo: false,
    recurring: false,
    laneVisible: true,
    isDailyNote: false,
    isToday: false,
    scheduled: null,
    created: null,
    rawLine: "- [/] #task Project ^prj",
    noteRefreshRaw: undefined,
    blockId: "prj",
  };
  const report = freshnessCounts([emptyPrj, hiddenRef, lanePrj], D, CFG);
  assert.equal(report.new, 2);
  assert.equal(report.due, 2);
  assert.equal(report.projectsDue, 2);
  assert.equal(report.referencesDue, 1);
  assert.equal(report.byTier.new, 0);
  assert.equal(report.byTier.projects, 2);
  assert.equal(report.byTier.references, 1);
  assert.equal(
    report.walk,
    report.byTier.pre +
      report.byTier.new +
      report.byTier.projects +
      report.byTier.pending +
      report.byTier.next +
      report.byTier.tickler +
      report.byTier.references +
      report.byTier.rotten +
      report.byTier.post,
  );
});

test("tracking queue orders NEW before PROJECTS before lanes", () => {
  const rows = [
    sRow({
      path: "b.md",
      line: 1,
      rawLine: "- [ ] #task Ordinary",
    }),
    sRow({
      path: "a.md",
      line: 1,
      rawLine: "- [ ] #task Project ^prj",
      blockId: "prj",
      projectReadyCount: 0,
    }),
  ];
  const queue = freshnessQueue(rows, D, CFG);
  assert.deepEqual(
    queue.map((entry) => entry.tier),
    ["new", "projects"],
  );
});

test("tracker intervals override every level with project/reference sources", () => {
  const cfg = { ...CFG, projectInterval: 1, referenceInterval: 3 };
  const prj = helpers.freshnessEvaluate(
    sRow({
      rawLine: "- [ ] #task P [fresh:: 2026-10-07] [refresh:: 30] ^prj",
      blockId: "prj",
      tracker: "prj",
      noteRefreshRaw: "14",
      projectOpenCount: 0,
      projectReadyCount: 0,
    }),
    D,
    cfg,
  );
  assert.equal(prj.intervalDays, 1);
  assert.equal(prj.intervalSource, "project");
  assert.equal(prj.dueOn, "2026-10-08");
  assert.equal(prj.tier, "projects");
  const freshRef = helpers.freshnessEvaluate(
    sRow({
      rawLine: "- [ ] #task R [fresh:: 2026-10-06] ^ref",
      blockId: "ref",
      tracker: "ref",
    }),
    D,
    cfg,
  );
  assert.equal(freshRef.intervalDays, 3);
  assert.equal(freshRef.intervalSource, "reference");
  assert.equal(freshRef.state, "fresh");
  const rottenRef = helpers.freshnessEvaluate(
    sRow({
      rawLine: "- [ ] #task R [fresh:: 2026-10-05] ^ref",
      blockId: "ref",
      tracker: "ref",
    }),
    D,
    cfg,
  );
  assert.equal(rottenRef.intervalDays, 3);
  assert.equal(rottenRef.intervalSource, "reference");
  assert.equal(rottenRef.state, "rotten");
  assert.equal(rottenRef.dueOn, "2026-10-08");
  const ordinary = helpers.freshnessEvaluate(
    sRow({ rawLine: "- [ ] #task T [fresh:: 2026-10-01]" }),
    D,
    cfg,
  );
  assert.equal(ordinary.intervalDays, 7);
  assert.equal(ordinary.intervalSource, "default");
  const pendingRef = helpers.freshnessEvaluate(
    laneRow("r.md", 1, "/", "2026-10-05", null),
    D,
    cfg,
  );
  // laneRow has no tracker; attach the reference identity explicitly.
  pendingRef.rawLine = "- [/] #task Walk [fresh:: 2026-10-05] ^ref";
  const pendingEvaluated = helpers.freshnessEvaluate(
    { ...laneRow("r.md", 1, "/", "2026-10-05", null), blockId: "ref", tracker: "ref" },
    D,
    cfg,
  );
  assert.equal(pendingEvaluated.intervalDays, 3);
  assert.equal(pendingEvaluated.intervalSource, "reference");
  assert.equal(pendingEvaluated.tier, "references");
  assert.equal(pendingEvaluated.state, null);
  // A lane `^ref` without a configured reference interval shows the
  // Ready chain, not the lane interval, so the nav refresh row agrees
  // with the queue.
  const unconfigured = helpers.freshnessIntervalForLine(
    "- [/] #task R ^ref",
    null,
    CFG,
  );
  assert.equal(unconfigured.days, 7);
  assert.equal(unconfigured.source, "default");
  assert.equal(
    helpers.freshnessIntervalForLine(
      "- [ ] #task P [fresh:: 2026-10-07] ^prj",
      null,
      cfg,
    ).source,
    "project",
  );
  assert.equal(
    helpers.freshnessIntervalForLine(
      "- [ ] #task R [fresh:: 2026-10-05] ^ref",
      null,
      cfg,
    ).source,
    "reference",
  );
});

test("tracker config rejects booleans and out-of-range values", () => {
  for (const block of [
    { project_interval: false },
    { reference_interval: false },
    { project_interval: true },
    { reference_interval: 0 },
    { project_interval: 366 },
    { reference_interval: "soon" },
    { reference_interval: 7.5 },
  ]) {
    assert.equal(coerceFreshnessConfig(block).invalid, true, JSON.stringify(block));
  }
  assert.equal(coerceFreshnessConfig({ project_interval: 1 }).config.projectInterval, 1);
  assert.equal(coerceFreshnessConfig({ reference_interval: 3 }).config.referenceInterval, 3);
  assert.equal(coerceFreshnessConfig({}).config.projectInterval, null);
  assert.equal(coerceFreshnessConfig({}).config.referenceInterval, null);
});

test("references walk with the reference cadence in every lane", () => {
  const { freshnessEvaluate, freshnessQueue, freshnessCounts } = helpers;
  const cfg = { ...CFG, referenceInterval: 7 };
  // Stamped 6 days ago: fresh, no tier. Stamped 7 days ago: due.
  const freshRef = freshnessEvaluate(
    sRow({ rawLine: "- [ ] #task R [fresh:: 2026-10-02] ^ref", blockId: "ref" }),
    D,
    cfg,
  );
  assert.equal(freshRef.state, "fresh");
  assert.equal(freshRef.tier, null);
  const dueRef = freshnessEvaluate(
    sRow({ rawLine: "- [ ] #task R [fresh:: 2026-10-01] ^ref", blockId: "ref" }),
    D,
    cfg,
  );
  assert.equal(dueRef.state, "rotten");
  assert.equal(dueRef.tier, "references");
  assert.equal(dueRef.intervalDays, 7);
  assert.equal(dueRef.intervalSource, "reference");
  // A disabled pending lane still reviews references.
  const off = { ...cfg, pendingInterval: null };
  const laneRef = freshnessEvaluate(
    { ...laneRow("r.md", 1, "/", "2026-10-01", null), blockId: "ref", tracker: "ref" },
    D,
    off,
  );
  assert.equal(laneRef.lane, "pending");
  assert.equal(laneRef.state, null);
  assert.equal(laneRef.tier, "references");
  // Nine-tier order with stable ties, and the walk sums the histogram.
  const rows = [
    sRow({ path: "g.md", line: 1, rawLine: "- [ ] #task Ordinary" }),
    sRow({ path: "f.md", line: 1, rawLine: "- [ ] #task P ^prj", blockId: "prj" }),
    laneRow("e.md", 1, "/", "2026-10-07", null),
    laneRow("d.md", 1, "*", "2026-10-07", null),
    sRow({
      path: "c.md",
      line: 1,
      rawLine: "- [ ] #task Back [fresh:: 2026-10-05]",
      scheduled: "2026-10-07",
    }),
    sRow({ path: "b.md", line: 1, rawLine: "- [ ] #task R [fresh:: 2026-10-01] ^ref", blockId: "ref" }),
    sRow({ path: "a.md", line: 1, rawLine: "- [ ] #task Old [fresh:: 2026-09-20]" }),
  ];
  const queue = freshnessQueue(rows, D, cfg);
  assert.deepEqual(
    queue.map((entry) => entry.tier),
    ["new", "projects", "pending", "next", "tickler", "references", "rotten"],
  );
  const report = freshnessCounts(rows, D, cfg);
  assert.equal(report.walk, report.byTier.pre + report.byTier.new + report.byTier.projects + report.byTier.pending + report.byTier.next + report.byTier.tickler + report.byTier.references + report.byTier.rotten + report.byTier.post);
  assert.equal(report.referencesDue, 1);
  assert.equal(report.byTier.references, 1);
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
    "pre", "new", "projects", "pending", "next", "tickler", "references", "rotten", "post",
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

test("referenceReview capability advertises the references tier", () => {
  withMissingConfig(() => {
    const plugin = new LedgerToolsPlugin(makeFreshnessApp({}), {});
    plugin.onload();
    try {
      assert.equal(plugin.api.freshness.trackerReview, true);
      assert.equal(plugin.api.freshness.referenceReview, true);
    } finally {
      plugin.onunload();
    }
  });
});

// __FRESHNESS_TEST_END__
