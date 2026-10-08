// Tests for the RECURRING walk tier (freshness namespace v9).
// `docs/freshness.md` §10 in bob-cli is the authoritative definition;
// the RC-vectors below encode the "Recurring tier (RC1–RC12)" block
// verbatim, with today `2026-10-08` and the default config
// (interval 7, lanes 1).
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  LedgerToolsPlugin,
  helpers,
  freshnessCounts,
  freshnessQueue,
  freshnessStatusView,
  D,
  CFG,
  sRow,
  laneRow,
  makeFreshnessApp,
  withMissingConfig,
} = require("./ledger-tools-harness.cjs");

const {
  freshnessEvaluate,
  freshnessOccursOn,
  freshnessTierLabel,
  freshnessTierFooterLabel,
  freshnessReviewEntryView,
  freshnessFooterGroups,
  freshnessFooterView,
  freshnessRowFromTask,
  freshnessMarkModel,
  freshnessMarkResolution,
  freshnessMarkSource,
  freshnessTaskStatus,
} = helpers;

// A Ready `[ ]` recurring row in `a.md` unless noted.
function recurRow(overrides = {}) {
  return sRow({
    rawLine: "- [ ] #task Recurring",
    recurring: true,
    ...overrides,
  });
}

test("RC1 arrived: past scheduled walks RECURRING with lane and null state", () => {
  const evaluated = freshnessEvaluate(
    recurRow({
      rawLine:
        "- [ ] #task Pay salary [repeat:: every month on the 1st] [scheduled:: 2026-10-01]",
      scheduled: "2026-10-01",
    }),
    D,
    CFG,
  );
  assert.equal(evaluated.tier, "recurring");
  assert.equal(evaluated.lane, "ready");
  assert.equal(evaluated.state, null);
  assert.equal(helpers.freshnessBucketForState(evaluated.state), null);
  assert.equal(evaluated.dueOn, "2026-10-01");
  assert.equal(evaluated.daysOverdue, 7);
  assert.equal(evaluated.decide, false);
  assert.equal(freshnessTierLabel(evaluated.tier), "RECURRING");
  assert.equal(freshnessTierFooterLabel(evaluated.tier), "RECUR");
});

test("RC2 arrives today: due today with zero days overdue", () => {
  const evaluated = freshnessEvaluate(
    recurRow({ scheduled: "2026-10-08" }),
    D,
    CFG,
  );
  assert.equal(evaluated.tier, "recurring");
  assert.equal(evaluated.dueOn, "2026-10-08");
  assert.equal(evaluated.daysOverdue, 0);
});

test("RC3 not yet: future scheduled walks nowhere", () => {
  const evaluated = freshnessEvaluate(
    recurRow({ scheduled: "2026-10-09", laneVisible: false }),
    D,
    CFG,
  );
  assert.equal(evaluated.tier, null);
  assert.equal(evaluated.state, null);
});

test("RC4 due only, past: the due date is the occurrence", () => {
  const evaluated = freshnessEvaluate(
    recurRow({
      rawLine: "- [ ] #task Yearly [repeat:: every year] [due:: 2026-10-05]",
      scheduled: null,
      due: "2026-10-05",
    }),
    D,
    CFG,
  );
  assert.equal(evaluated.tier, "recurring");
  assert.equal(evaluated.dueOn, "2026-10-05");
  assert.equal(evaluated.daysOverdue, 3);
});

test("RC5 due only, future: walks nowhere", () => {
  const evaluated = freshnessEvaluate(
    recurRow({ scheduled: null, due: "2026-10-20" }),
    D,
    CFG,
  );
  assert.equal(evaluated.tier, null);
});

test("RC6 earliest date wins across start and due", () => {
  assert.equal(
    freshnessOccursOn({ scheduled: null, due: "2026-10-20", start: "2026-10-02" }),
    "2026-10-02",
  );
  assert.equal(
    freshnessOccursOn({ scheduled: "2026-10-01", due: "2026-10-05", start: "2026-10-02" }),
    "2026-10-01",
  );
  assert.equal(freshnessOccursOn({}), null);
  assert.equal(
    freshnessOccursOn({ scheduled: null, due: null, start: null }),
    null,
  );
  const evaluated = freshnessEvaluate(
    recurRow({ scheduled: null, due: "2026-10-20", start: "2026-10-02" }),
    D,
    CFG,
  );
  assert.equal(evaluated.tier, "recurring");
  assert.equal(evaluated.dueOn, "2026-10-02");
  assert.equal(evaluated.daysOverdue, 6);
});

test("RC7 undated: no occurrence, no tier", () => {
  const evaluated = freshnessEvaluate(
    recurRow({
      rawLine: "- [ ] #task Water plants [repeat:: every week]",
      scheduled: null,
      due: null,
      start: null,
    }),
    D,
    CFG,
  );
  assert.equal(evaluated.tier, null);
  assert.equal(evaluated.state, null);
});

test("RC8 lanes: recurring lane rows keep their lane with null state", () => {
  for (const [symbol, lane] of [
    ["*", "next"],
    ["/", "pending"],
  ]) {
    const row = laneRow("a.md", 1, symbol, null, null);
    row.recurring = true;
    row.scheduled = "2026-10-01";
    const evaluated = freshnessEvaluate(row, D, CFG);
    assert.equal(evaluated.tier, "recurring", `lane ${lane} walks RECURRING`);
    assert.equal(evaluated.lane, lane);
    assert.equal(evaluated.state, null);
    assert.equal(evaluated.dueOn, "2026-10-01");
    assert.equal(evaluated.daysOverdue, 7);
  }
});

test("RC9 exclusions: Today, daily note, hidden, blocked, templates, [?] stay out", () => {
  const rows = [
    recurRow({ scheduled: "2026-10-01", isToday: true }),
    recurRow({
      scheduled: "2026-10-01",
      path: "2026/20261008.md",
      isDailyNote: true,
    }),
    recurRow({ scheduled: "2026-10-01", laneVisible: false }),
    recurRow({ scheduled: "2026-10-01", laneVisible: false }),
    recurRow({
      scheduled: "2026-10-01",
      path: "_templates/daily.md",
      laneVisible: false,
    }),
    recurRow({
      rawLine: "- [?] #task Blocked [repeat:: every week] [scheduled:: 2026-10-01]",
      statusSymbol: "?",
      isTodo: false,
      scheduled: "2026-10-01",
    }),
  ];
  assert.deepEqual(
    rows.map((row) => freshnessEvaluate(row, D, CFG).tier),
    [null, null, null, null, null, null],
  );
  assert.deepEqual(
    rows.map((row) => freshnessEvaluate(row, D, CFG).state),
    [null, null, null, null, null, null],
  );
  assert.equal(freshnessQueue(rows, D, CFG).length, 0);
});

test("RC10 checklist wins: a recurring chore stays in its checklist tier", () => {
  const evaluated = freshnessEvaluate(
    sRow({
      checklist: "pre",
      recurring: true,
      rawLine:
        "- [ ] #task #gtd #pre Brush teeth [repeat:: every day when done] [scheduled:: 2026-10-01]",
      scheduled: "2026-10-01",
    }),
    D,
    CFG,
  );
  assert.equal(evaluated.tier, "pre");
});

test("RC11 a stray stamp is ignored: recurring with null state", () => {
  const evaluated = freshnessEvaluate(
    recurRow({
      rawLine:
        "- [ ] #task Stamped [fresh:: 2026-10-08] [scheduled:: 2026-10-01]",
      scheduled: "2026-10-01",
    }),
    D,
    CFG,
  );
  assert.equal(evaluated.tier, "recurring");
  assert.equal(evaluated.state, null);
  assert.equal(evaluated.dueOn, "2026-10-01");
});

test("RC12 order and counts: due_on, then path, then line; recurring adds no due", () => {
  const rows = [
    sRow({ path: "b.md", line: 3, recurring: true, scheduled: "2026-10-05" }),
    sRow({ path: "a.md", line: 9, recurring: true, scheduled: "2026-10-05" }),
    sRow({ path: "a.md", line: 2, recurring: true, scheduled: "2026-10-01" }),
    sRow({ path: "w.md", line: 1, rawLine: "- [ ] #task New" }),
    laneRow("n.md", 1, "*", "2026-10-07", null),
    sRow({
      path: "t.md",
      line: 1,
      rawLine: "- [ ] #task Tickler [fresh:: 2026-10-05] [scheduled:: 2026-10-07]",
      scheduled: "2026-10-07",
    }),
  ];
  const queue = freshnessQueue(rows, D, CFG);
  assert.deepEqual(
    queue.map((entry) => `${entry.path}:${entry.line}`),
    ["w.md:1", "n.md:1", "a.md:2", "a.md:9", "b.md:3", "t.md:1"],
  );
  assert.deepEqual(
    queue.map((entry) => entry.tier),
    ["new", "next", "recurring", "recurring", "recurring", "tickler"],
  );
  const report = freshnessCounts(rows, D, CFG);
  assert.equal(report.byTier.recurring, 3);
  assert.equal(report.recurringDue, 3);
  assert.equal(report.walk, 6);
  assert.equal(report.due, 2);
  assert.equal(report.upkeepToday, 0);
  assert.equal(
    report.walk,
    Object.values(report.byTier).reduce((sum, count) => sum + count, 0),
  );
});

test("recurring rows adapt due and start from Tasks fields and inline fallbacks", () => {
  const task = {
    status: { type: "TODO", name: "Todo", symbol: " " },
    tags: ["#task"],
    path: "notes/a.md",
    lineNumber: 4,
    description: "- [ ] #task Adapt [due:: 2026-10-06]",
    originalMarkdown: "- [ ] #task Adapt [due:: 2026-10-06]",
    dueDate: new Date(2026, 9, 5),
    startDate: new Date(2026, 9, 2),
  };
  const row = freshnessRowFromTask(task, task.lineNumber, {
    list: [task],
    todayDay: 20261008,
    isToday: () => false,
  });
  assert.equal(row.due, "2026-10-05");
  assert.equal(row.start, "2026-10-02");
  const inline = freshnessRowFromTask(
    {
      status: { type: "TODO", name: "Todo", symbol: " " },
      tags: ["#task"],
      path: "notes/a.md",
      lineNumber: 0,
      description:
        "- [ ] #task Inline [start:: 2026-10-03] [due:: 2026-10-06]",
      originalMarkdown:
        "- [ ] #task Inline [start:: 2026-10-03] [due:: 2026-10-06]",
    },
    0,
    { list: [], todayDay: 20261008, isToday: () => false },
  );
  assert.equal(inline.due, "2026-10-06");
  assert.equal(inline.start, "2026-10-03");
  assert.equal(freshnessOccursOn(inline), "2026-10-03");
});

test("status view counts RECURRING as a due commitment tier", () => {
  const view = freshnessStatusView(
    {
      due: 0,
      new: 0,
      resurfaced: 0,
      rotten: 0,
      walk: 2,
      refreshedToday: 0,
      upkeepToday: 0,
      byTier: {
        pre: 0,
        new: 0,
        projects: 0,
        pending: 0,
        next: 0,
        recurring: 2,
        tickler: 0,
        references: 0,
        rotten: 0,
        post: 0,
      },
    },
    {},
  );
  assert.match(view.text, /2 recurring/);
  assert.match(view.tooltip, /RECURRING 2/);
  assert.equal(view.mode, "due");
});

test("footer groups, entry view, and legend cover RECURRING", () => {
  const groups = freshnessFooterGroups({
    walk: 2,
    byTier: { recurring: 2 },
  });
  assert.deepEqual(groups, [{ key: "recurring", label: "RECUR", count: 2 }]);
  const today = freshnessReviewEntryView(
    {
      tier: "recurring",
      tierLabel: "RECURRING",
      dueOn: "2026-10-08",
      daysOverdue: 0,
    },
    { todayText: D },
  );
  assert.equal(today.ok, true);
  assert.equal(today.detail, "recurring · due today");
  assert.equal(today.compact, "recurring · due today");
  assert.equal(
    today.actionHint,
    "Ctrl+Enter done · Ctrl+Shift+Enter today · Ctrl+Shift+P reschedule · ]s skip",
  );
  const overdue = freshnessReviewEntryView(
    {
      tier: "recurring",
      tierLabel: "RECURRING",
      dueOn: "2026-10-01",
      daysOverdue: 7,
    },
    { todayText: D },
  );
  assert.equal(overdue.detail, "recurring · 7d overdue");
  assert.equal(overdue.compact, "recurring · 7d overdue");
  const view = freshnessFooterView({
    counts: { walk: 2, byTier: { recurring: 2 } },
    queue: [{ key: "a.md:2" }, { key: "a.md:9" }],
  });
  assert.equal(view.visible, true);
  assert.equal(view.groupsText, "RECUR 2");
  assert.match(view.tooltip, /RECUR = RECURRING/);
});

test("a stale-stamped recurring row marks due with the resolve hint", () => {
  const line =
    "- [ ] #task Stale [fresh:: 2026-10-01] [repeat:: every week] [scheduled:: 2026-10-01]";
  const row = recurRow({ rawLine: line, scheduled: "2026-10-01" });
  const resolution = freshnessMarkResolution(row, D, CFG);
  assert.equal(resolution.tier, "recurring");
  const source = freshnessMarkSource(line, D);
  const model = freshnessMarkModel({
    source,
    today: D,
    interval: { days: 7, source: "default" },
    status: freshnessTaskStatus(line),
    resolution,
  });
  assert.equal(model.tone, "due");
  assert.match(model.tooltip, /complete or reschedule to resolve/);
});

test("freshness namespace v9 advertises the recurringTier capability", () => {
  withMissingConfig(() => {
    const plugin = new LedgerToolsPlugin(makeFreshnessApp({}), {});
    plugin.onload();
    try {
      assert.equal(plugin.api.freshness.version, 9);
      assert.equal(plugin.api.freshness.trackerReview, true);
      assert.equal(plugin.api.freshness.referenceReview, true);
      assert.equal(plugin.api.freshness.checklistTiers, true);
      assert.equal(plugin.api.freshness.recurringTier, true);
    } finally {
      plugin.onunload();
    }
  });
});

test("hidden recurring ^ref keeps ordinary visibility (Rust parity)", () => {
  const hiddenLine =
    "- [ ] #task Hidden [repeat:: every week] [scheduled:: 2026-10-01] ^ref";
  const hiddenTask = {
    status: { type: "TODO", name: "Todo", symbol: " " },
    tags: ["#task", "#hide"],
    path: "a.md",
    lineNumber: 0,
    description: hiddenLine,
    originalMarkdown: hiddenLine,
    blockLink: " ^ref",
  };
  const hiddenRow = freshnessRowFromTask(hiddenTask, 0, {
    list: [hiddenTask],
    todayDay: 20261008,
    isToday: () => false,
  });
  assert.equal(hiddenRow.recurring, true);
  assert.equal(hiddenRow.tracker, "ref");
  assert.equal(
    hiddenRow.laneVisible,
    false,
    "hidden recurring ^ref stays lane-hidden",
  );
  const hiddenEvaluated = freshnessEvaluate(hiddenRow, D, CFG);
  assert.equal(hiddenEvaluated.tier, null);

  const visibleLine =
    "- [ ] #task Visible [repeat:: every week] [scheduled:: 2026-10-01] ^ref";
  const visibleTask = {
    status: { type: "TODO", name: "Todo", symbol: " " },
    tags: ["#task"],
    path: "a.md",
    lineNumber: 1,
    description: visibleLine,
    originalMarkdown: visibleLine,
    blockLink: " ^ref",
  };
  const visibleRow = freshnessRowFromTask(visibleTask, 1, {
    list: [visibleTask],
    todayDay: 20261008,
    isToday: () => false,
  });
  assert.equal(visibleRow.recurring, true);
  assert.equal(visibleRow.laneVisible, true);
  const visibleEvaluated = freshnessEvaluate(visibleRow, D, CFG);
  assert.equal(
    visibleEvaluated.tier,
    "recurring",
    "visible recurring ^ref walks RECURRING, not REFERENCES",
  );
  const queued = freshnessQueue([visibleRow, hiddenRow], D, CFG);
  assert.ok(
    queued.some((entry) => entry.originalMarkdown === visibleLine),
    "visible recurring ^ref is queued",
  );
  assert.ok(
    !queued.some((entry) => entry.originalMarkdown === hiddenLine),
    "hidden recurring ^ref is not queued",
  );

  const ordinaryLine = "- [ ] #task Read #hide ^ref";
  const ordinaryTask = {
    status: { type: "TODO", name: "Todo", symbol: " " },
    tags: ["#task", "#hide"],
    path: "a.md",
    lineNumber: 2,
    description: ordinaryLine,
    originalMarkdown: ordinaryLine,
    blockLink: " ^ref",
  };
  const ordinaryRow = freshnessRowFromTask(ordinaryTask, 2, {
    list: [ordinaryTask],
    todayDay: 20261008,
    isToday: () => false,
  });
  assert.equal(ordinaryRow.recurring, false);
  assert.equal(
    ordinaryRow.laneVisible,
    true,
    "ordinary hidden ^ref keeps the tracker bypass",
  );
  assert.equal(freshnessEvaluate(ordinaryRow, D, CFG).tier, "references");
});
