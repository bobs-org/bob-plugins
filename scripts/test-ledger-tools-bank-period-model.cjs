const assert = require("node:assert/strict");
const test = require("node:test");
const { LedgerToolsPlugin } = require("./ledger-tools-harness.cjs");

const {
  bankDecodeReport,
  bankPeriodChartsModel,
  bankPeriodCompact,
  bankPeriodIdentityMatches,
  bankPeriodViewOf,
  bankBadgeAmount,
  periodNotesIsoWeekMonday,
  bankIsoShiftDays,
} = LedgerToolsPlugin.helpers;

function totals(overrides = {}) {
  return {
    in_cents: 0, out_cents: 0, net_cents: 0, refund_cents: 0,
    transfer_out_cents: 0, transfer_in_cents: 0, cash_out_cents: 0,
    cash_traced_cents: 0, unclassified_out_cents: 0, unclassified_in_cents: 0,
    ...overrides,
  };
}

function entry(overrides = {}) {
  const inCents = overrides.in_cents || 0;
  const outCents = overrides.out_cents || 0;
  return {
    id: "2026-11-09",
    kind: "day",
    label: "Mon 9",
    start: "2026-11-09",
    end: "2026-11-09",
    group: null,
    so_far: false,
    state: "tracked",
    waiting: 0,
    rows: 0,
    top_out: [],
    target: { path: "bank/2026-11.md", line: 12 },
    ...overrides,
    in_cents: inCents,
    out_cents: outCents,
    net_cents: Object.prototype.hasOwnProperty.call(overrides, "net_cents")
      ? overrides.net_cents
      : inCents - outCents,
  };
}

function weekDays(fill) {
  const days = [
    ["2026-11-09", "Mon 9"],
    ["2026-11-10", "Tue 10"],
    ["2026-11-11", "Wed 11"],
    ["2026-11-12", "Thu 12"],
    ["2026-11-13", "Fri 13"],
    ["2026-11-14", "Sat 14"],
    ["2026-11-15", "Sun 15"],
  ];
  return days.map(([id, label], index) => entry({
    id, label, start: id, end: id, ...(fill(id, label, index) || {}),
  }));
}

function weekCharts(fill, extra = {}) {
  const buckets = weekDays(fill || ((id) => (
    id === "2026-11-11"
      ? {
        state: "tracked",
        out_cents: 24977,
        waiting: 7,
        rows: 7,
        top_out: [{ key: "groceries", emoji: "🛒", label: "Groceries", out_cents: 14210 }],
      }
      : { state: "awaiting_import", so_far: id === "2026-11-14" }
  )));
  return {
    version: 1,
    granularity: "day",
    buckets,
    groups: [],
    categories: extra.categories || {
      limit: 5,
      series: [
        { key: "groceries", emoji: "🛒", label: "Groceries", kind: "category", out_cents: 14210, share: 0.569, rows: 3 },
        { key: "dining", emoji: "🍽", label: "Dining", kind: "category", out_cents: 6420, share: 0.257, rows: 2 },
        { key: "unclassified", emoji: "●", label: "Unclassified", kind: "unclassified", out_cents: 2047, share: 0.082, rows: 1 },
      ],
      rest: { count: 2, out_cents: 2300, share: 0.092, rows: 2 },
    },
  };
}

function report(overrides = {}) {
  return {
    command: "report",
    teaching_empty: false,
    period: {
      kind: "week",
      key: "2026-W46",
      start: "2026-11-09",
      end: "2026-11-15",
      label: "2026-W46 · Nov 9–15, 2026",
      so_far: true,
      note: null,
    },
    totals: totals({ out_cents: 24977, net_cents: -24977 }),
    breakdown: [],
    days: [],
    waiting: { period: 7, all: 7, oldest: "2026-11-11" },
    coverage: {
      tracked_since: "2026-11-01",
      imported_through: "2026-11-11",
      start: "2026-11-09",
      through: "2026-11-11",
      complete: false,
    },
    navigation: {
      waiting: { path: "bank/2026-11.md", line: 12, date: "2026-11-11" },
      first: { path: "bank/2026-11.md", line: 12, date: "2026-11-11" },
      months: ["bank/2026-11.md"],
    },
    charts: weekCharts(),
    ...overrides,
  };
}

function ctx(overrides = {}) {
  return {
    kind: "week",
    periodId: "2026-W46",
    today: "2026-11-14",
    stale: false,
    refreshFailed: false,
    badgeEnabled: true,
    view: "both",
    collapsed: false,
    ...overrides,
  };
}

test("compact labels follow the k/m ladder and keep sub-dollar cents", () => {
  assert.equal(bankPeriodCompact(42), "$0.42");
  assert.equal(bankPeriodCompact(8400), "$84");
  assert.equal(bankPeriodCompact(100000), "$1k");
  assert.equal(bankPeriodCompact(250000), "$2.5k");
  assert.equal(bankPeriodCompact(1200000), "$12k");
  assert.equal(bankPeriodCompact(150000000), "$1.5m");
  assert.equal(bankBadgeAmount(142, "quarter"), "$1");
  assert.equal(bankBadgeAmount(42, "quarter"), "$0.42");
  assert.equal(bankBadgeAmount(141850, "quarter"), "$1,419");
});

test("invalid persisted view and collapsed values fall back to both / expanded", () => {
  assert.equal(bankPeriodViewOf("cashflow"), "cashflow");
  assert.equal(bankPeriodViewOf("categories"), "categories");
  assert.equal(bankPeriodViewOf("both"), "both");
  assert.equal(bankPeriodViewOf("Both"), "both");
  assert.equal(bankPeriodViewOf(null), "both");
  const collapsed = bankPeriodChartsModel(report(), ctx({ collapsed: "true" }));
  assert.equal(collapsed.header.collapsed, false);
  const valid = bankPeriodChartsModel(report(), ctx({ collapsed: true, view: "categories" }));
  assert.equal(valid.header.collapsed, true);
  assert.deepEqual(valid.header.shown, []);
  assert.equal(valid.header.view, "categories");
  assert.equal(valid.header.nextView, "both");
});

test("panel model states: teaching-empty, older-bob, unavailable, empty, waiting, charts, stale", () => {
  assert.equal(bankPeriodChartsModel({ teaching_empty: true }, ctx()).reason, "teaching-empty");
  assert.equal(bankPeriodChartsModel({ teaching_empty: true }, ctx()).state, "hidden");
  assert.equal(bankPeriodChartsModel(report(), ctx({ olderBob: true })).reason, "older-bob");
  assert.equal(bankPeriodChartsModel(null, ctx()).state, "unavailable");
  assert.equal(bankPeriodChartsModel({ command: "report" }, ctx()).state, "unavailable");
  const missing = report();
  delete missing.charts;
  assert.equal(bankPeriodChartsModel(missing, ctx()).reason, "missing-charts");
  const empty = report({
    totals: totals(),
    waiting: { period: 0, all: 0, oldest: null },
    charts: weekCharts(() => ({ state: "tracked" })),
  });
  assert.equal(bankPeriodChartsModel(empty, ctx()).reason, "empty");
  const waiting = report({
    totals: totals(),
    waiting: { period: 3, all: 3, oldest: "2026-11-11" },
  });
  assert.equal(bankPeriodChartsModel(waiting, ctx({ badgeEnabled: true })).reason, "waiting-badge");
  assert.equal(bankPeriodChartsModel(waiting, ctx({ badgeEnabled: true })).state, "hidden");
  const waitingShown = bankPeriodChartsModel(waiting, ctx({ badgeEnabled: false }));
  assert.equal(waitingShown.state, "waiting");
  assert.match(waitingShown.waitingLine.text, /3 waiting/);
  assert.match(waitingShown.waitingLine.text, /oldest Nov 11/);
  const counted = bankPeriodChartsModel(report(), ctx());
  assert.equal(counted.state, "charts");
  assert.equal(counted.stale, false);
  const stale = bankPeriodChartsModel(report(), ctx({ stale: true, refreshFailed: true }));
  assert.equal(stale.state, "charts");
  assert.equal(stale.stale, true);
  assert.match(stale.hint, /Refresh failed/);
  assert.match(stale.cashflow.columns[2].tooltip, /last good values shown/);
});

test("hide rule with the badge on and off, and waiting-only copy", () => {
  const waiting = report({ totals: totals(), waiting: { period: 2, all: 2, oldest: "2026-11-12" } });
  assert.equal(bankPeriodChartsModel(waiting, ctx({ badgeEnabled: true })).state, "hidden");
  const shown = bankPeriodChartsModel(waiting, ctx({ badgeEnabled: false }));
  assert.equal(shown.state, "waiting");
  assert.equal(shown.waitingLine.target.path, "bank/2026-11.md");
});

test("today's real shape: one counted day, six awaiting_import, $249.77 out", () => {
  const model = bankPeriodChartsModel(report(), ctx());
  assert.equal(model.state, "charts");
  assert.equal(model.cashflow.encoding, "markers");
  assert.equal(model.cashflow.columns.length, 7);
  const counted = model.cashflow.columns.find((column) => column.id === "2026-11-11");
  assert.equal(counted.outCents, 24977);
  assert.equal(counted.inCents, 0);
  assert.equal(counted.state, "tracked");
  assert.equal(counted.outRatio, 1);
  assert.equal(counted.extremeOut, true);
  assert.match(counted.readout, /out \$249\.77/);
  assert.match(counted.readout, /7 rows/);
  const awaiting = model.cashflow.columns.filter((column) => column.state === "awaiting_import");
  assert.equal(awaiting.length, 6);
  assert.ok(awaiting.every((column) => column.decorations.includes("hatch")));
  assert.match(model.ariaLabel, /6 of 7 days not imported yet/);
  assert.equal(model.header.switchShown, true);
  assert.deepEqual(model.header.shown, ["cashflow", "categories"]);
});

test("in-only shows cashflow and hides the view switch", () => {
  const buckets = weekDays((id) => (
    id === "2026-11-14" ? { in_cents: 250000, state: "tracked", so_far: true } : { state: "tracked" }
  ));
  const model = bankPeriodChartsModel(report({
    totals: totals({ in_cents: 250000, net_cents: 250000 }),
    waiting: { period: 0, all: 0, oldest: null },
    charts: { version: 1, granularity: "day", buckets, groups: [], categories: { limit: 5, series: [], rest: null } },
  }), ctx());
  assert.deepEqual(model.header.shown, ["cashflow"]);
  assert.equal(model.header.switchShown, false);
  assert.equal(model.categories, null);
  const payday = model.cashflow.columns.find((column) => column.id === "2026-11-14");
  assert.equal(payday.marker, true);
  assert.equal(payday.extremeInLabel, "+$2.5k");
});

test("week markers hang Out below the line; mirrored ratios collapse a zero side", () => {
  const week = bankPeriodChartsModel(report(), ctx());
  assert.equal(week.cashflow.encoding, "markers");
  assert.equal(week.cashflow.inBandRatio, null);
  const buckets = [];
  const start = periodNotesIsoWeekMonday(2026, 40);
  for (let weekNo = 40; weekNo <= 53; weekNo += 1) {
    const monday = periodNotesIsoWeekMonday(2026, weekNo);
    buckets.push(entry({
      id: `2026-W${String(weekNo).padStart(2, "0")}`,
      kind: "week",
      label: `W${weekNo}`,
      start: monday,
      end: bankIsoShiftDays(monday, 6),
      out_cents: weekNo === 46 ? 10000 : 0,
      state: "tracked",
    }));
  }
  const quarter = bankPeriodChartsModel({
    ...report(),
    period: {
      kind: "quarter",
      key: "2026-Q4",
      start: periodNotesIsoWeekMonday(2026, 40),
      end: bankIsoShiftDays(periodNotesIsoWeekMonday(2026, 53), 6),
      label: "2026-Q4",
      so_far: true,
      note: null,
    },
    totals: totals({ out_cents: 10000, net_cents: -10000 }),
    waiting: { period: 0, all: 0, oldest: null },
    charts: {
      version: 1,
      granularity: "week",
      buckets,
      groups: [],
      categories: {
        limit: 5,
        series: [{ key: "groceries", emoji: "🛒", label: "Groceries", kind: "category", out_cents: 10000, share: 1, rows: 1 }],
        rest: null,
      },
    },
  }, ctx({ kind: "quarter", periodId: "2026-Q4" }));
  assert.equal(quarter.cashflow.encoding, "mirrored");
  assert.equal(quarter.cashflow.columns.length, 14);
  assert.equal(quarter.cashflow.inBandRatio, 0, "a zero In side collapses the In band");
  assert.equal(quarter.cashflow.maxIn, 0);
  assert.equal(quarter.cashflow.maxOut, 10000);
});

test("categories keep pinned cash/unclassified, rest, and the one-leftover series row", () => {
  const model = bankPeriodChartsModel(report(), ctx());
  assert.equal(model.categories.rows.length, 4);
  assert.equal(model.categories.rows[2].amber, true);
  assert.equal(model.categories.rows[3].rest, true);
  assert.equal(model.categories.rows[3].label, "2 more");
  assert.equal(model.categories.rows[3].muted, true);
  const leftover = bankPeriodChartsModel(report({
    charts: weekCharts(null, {
      categories: {
        limit: 5,
        series: [
          { key: "groceries", emoji: "🛒", label: "Groceries", kind: "category", out_cents: 14210, share: 0.569, rows: 3 },
          { key: "dining", emoji: "🍽", label: "Dining", kind: "category", out_cents: 6420, share: 0.257, rows: 2 },
          { key: "unclassified", emoji: "●", label: "Unclassified", kind: "unclassified", out_cents: 2047, share: 0.082, rows: 1 },
          { key: "cash", emoji: "🏧", label: "Cash", kind: "cash", out_cents: 2300, share: 0.092, rows: 2 },
        ],
        rest: null,
      },
    }),
  }), ctx());
  assert.equal(leftover.categories.rows.length, 4);
  assert.match(leftover.categories.rows.find((row) => row.kind === "cash").label, /destination unknown/);
  assert.equal(leftover.categories.rows.some((row) => row.rest), false);
});

test("every bucket state has words, decorations, and table-twin rows", () => {
  const buckets = weekDays((id) => ({
    "2026-11-09": { state: "untracked" },
    "2026-11-10": { state: "partial", out_cents: 100 },
    "2026-11-11": { state: "tracked", in_cents: 100, out_cents: 24977, waiting: 7, rows: 7 },
    "2026-11-12": { state: "awaiting_import" },
    "2026-11-13": { state: "future" },
    "2026-11-14": { state: "tracked", so_far: true, in_cents: 50 },
    "2026-11-15": { state: "tracked" },
  })[id]);
  const model = bankPeriodChartsModel(report({
    totals: totals({ in_cents: 50, out_cents: 25077, net_cents: 50 - 25077 }),
    charts: { version: 1, granularity: "day", buckets, groups: [], categories: weekCharts().categories },
  }), ctx());
  const byId = Object.fromEntries(model.cashflow.columns.map((column) => [column.id, column]));
  assert.deepEqual(byId["2026-11-09"].words, ["not tracked"]);
  assert.ok(byId["2026-11-09"].decorations.includes("untracked"));
  assert.deepEqual(byId["2026-11-10"].words, ["partly covered"]);
  assert.ok(byId["2026-11-10"].decorations.includes("partial"));
  assert.ok(byId["2026-11-12"].decorations.includes("hatch"));
  assert.deepEqual(byId["2026-11-13"].words, ["future"]);
  assert.ok(byId["2026-11-13"].decorations.includes("stub"));
  assert.ok(byId["2026-11-14"].decorations.includes("so_far"));
  assert.ok(byId["2026-11-11"].decorations.includes("waiting"));
  assert.equal(model.tables.cashflow.rows.length, 7);
  assert.equal(model.tables.categories.rows.length, 4);
  assert.match(byId["2026-11-11"].tooltip, /Click to open Wed Nov 11 in the bank month note/);
  assert.match(byId["2026-11-11"].tooltip, /Net −\$248\.77/);
  assert.equal(model.tables.cashflow.rows.find((row) => row.period === "Wed 11").net, "−$248.77");
});

test("period identity rejects the wrong key or the right key with the wrong bounds", () => {
  const ok = report();
  assert.equal(bankPeriodIdentityMatches(ok, ctx()), true);
  assert.equal(bankPeriodChartsModel(ok, ctx({ periodId: "2026-W45" })).reason, "period-mismatch");
  const wrongBounds = report({
    period: { ...ok.period, start: "2026-11-02", end: "2026-11-08" },
  });
  assert.equal(bankPeriodIdentityMatches(wrongBounds, ctx()), false);
  assert.equal(bankPeriodChartsModel(wrongBounds, ctx()).reason, "period-mismatch");
});

test("14-week Q4, 53-week ISO year fallback, all-time leading ghost, year grain, null charts, single bucket", () => {
  const q4Buckets = [];
  for (let weekNo = 40; weekNo <= 53; weekNo += 1) {
    const monday = periodNotesIsoWeekMonday(2026, weekNo);
    q4Buckets.push(entry({
      id: `2026-W${String(weekNo).padStart(2, "0")}`,
      kind: "week",
      label: `W${weekNo}`,
      start: monday,
      end: bankIsoShiftDays(monday, 6),
      out_cents: weekNo === 46 ? 5000 : 0,
      state: "tracked",
    }));
  }
  const q4 = bankPeriodChartsModel({
    ...report(),
    period: {
      kind: "quarter", key: "2026-Q4",
      start: periodNotesIsoWeekMonday(2026, 40),
      end: bankIsoShiftDays(periodNotesIsoWeekMonday(2026, 53), 6),
      label: "2026-Q4", so_far: true, note: null,
    },
    totals: totals({ out_cents: 5000, net_cents: -5000 }),
    waiting: { period: 0, all: 0, oldest: null },
    charts: {
      version: 1, granularity: "week", buckets: q4Buckets, groups: [],
      categories: { limit: 5, series: [{ key: "g", emoji: "", label: "G", kind: "category", out_cents: 5000, share: 1, rows: 1 }], rest: null },
    },
  }, ctx({ kind: "quarter", periodId: "2026-Q4" }));
  assert.equal(q4.cashflow.columns.length, 14);

  const isoBuckets = [];
  for (let weekNo = 1; weekNo <= 53; weekNo += 1) {
    const monday = periodNotesIsoWeekMonday(2026, weekNo);
    const quarter = weekNo <= 13 ? "Q1" : weekNo <= 26 ? "Q2" : weekNo <= 39 ? "Q3" : "Q4";
    isoBuckets.push(entry({
      id: `2026-W${String(weekNo).padStart(2, "0")}`,
      kind: "week",
      label: `W${weekNo}`,
      start: monday,
      end: bankIsoShiftDays(monday, 6),
      group: quarter,
      out_cents: weekNo === 46 ? 8000 : 0,
      state: "tracked",
    }));
  }
  const isoGroups = [1, 2, 3, 4].map((quarter) => {
    const startWeek = (quarter - 1) * 13 + 1;
    const lastWeek = quarter === 4 ? 53 : quarter * 13;
    return entry({
      id: `2026-Q${quarter}`,
      kind: "quarter",
      label: `Q${quarter}`,
      start: periodNotesIsoWeekMonday(2026, startWeek),
      end: bankIsoShiftDays(periodNotesIsoWeekMonday(2026, lastWeek), 6),
      group: null,
      out_cents: quarter === 4 ? 8000 : 0,
      state: "tracked",
    });
  });
  const iso = bankPeriodChartsModel({
    ...report(),
    period: {
      kind: "iso_year", key: "2026",
      start: periodNotesIsoWeekMonday(2026, 1),
      end: bankIsoShiftDays(periodNotesIsoWeekMonday(2026, 53), 6),
      label: "2026", so_far: true, note: null,
    },
    totals: totals({ out_cents: 8000, net_cents: -8000 }),
    waiting: { period: 0, all: 0, oldest: null },
    charts: {
      version: 1, granularity: "week", buckets: isoBuckets, groups: isoGroups,
      categories: { limit: 5, series: [{ key: "g", emoji: "", label: "G", kind: "category", out_cents: 8000, share: 1, rows: 1 }], rest: null },
    },
  }, ctx({ kind: "year", periodId: "2026" }));
  assert.equal(iso.cashflow.columns.length, 53);
  assert.equal(iso.cashflow.fallbackColumns.length, 4);
  assert.equal(iso.cashflow.fallbackColumns[3].label, "Q4");

  const yearBuckets = [
    entry({
      id: "2019", kind: "year", label: "2019", start: "2019-01-01", end: "2019-12-29",
      state: "untracked",
    }),
    entry({
      id: "2026", kind: "year", label: "2026", start: "2025-12-29", end: "2027-01-03",
      out_cents: 4000, state: "tracked",
    }),
  ];
  const years = bankPeriodChartsModel({
    ...report(),
    period: {
      kind: "all_time", key: "all",
      start: "2019-01-01", end: "2027-01-03",
      label: "All time", so_far: true, note: null,
    },
    totals: totals({ out_cents: 4000, net_cents: -4000 }),
    waiting: { period: 0, all: 0, oldest: null },
    charts: {
      version: 1, granularity: "year", buckets: yearBuckets, groups: [],
      categories: { limit: 5, series: [{ key: "g", emoji: "", label: "G", kind: "category", out_cents: 4000, share: 1, rows: 1 }], rest: null },
    },
  }, ctx({ kind: "all", periodId: "all" }));
  assert.equal(years.cashflow.encoding, "mirrored");
  assert.equal(years.cashflow.columns.length, 2);
  assert.equal(years.cashflow.ghost, null);

  const quarterBuckets = [
    entry({
      id: "2019-Q1", kind: "quarter", label: "Q1", start: "2018-12-31", end: "2019-03-31",
      group: "2019", state: "untracked",
    }),
    entry({
      id: "2019-Q2", kind: "quarter", label: "Q2", start: "2019-04-01", end: "2019-06-30",
      group: "2019", state: "untracked",
    }),
    entry({
      id: "2026-Q4", kind: "quarter", label: "Q4", start: "2026-09-28", end: "2027-01-03",
      group: "2026", out_cents: 4000, state: "tracked",
    }),
  ];
  const ghost = bankPeriodChartsModel({
    ...report(),
    period: {
      kind: "all_time", key: "all",
      start: "2018-12-31", end: "2027-01-03",
      label: "All time", so_far: true, note: null,
    },
    totals: totals({ out_cents: 4000, net_cents: -4000 }),
    waiting: { period: 0, all: 0, oldest: null },
    charts: {
      version: 1, granularity: "quarter",
      buckets: quarterBuckets,
      groups: [
        entry({
          id: "2019", kind: "year", label: "2019", start: "2018-12-31", end: "2019-06-30",
          group: null, state: "untracked",
        }),
        entry({
          id: "2026", kind: "year", label: "2026", start: "2026-09-28", end: "2027-01-03",
          group: null, out_cents: 4000, state: "tracked",
        }),
      ],
      categories: { limit: 5, series: [{ key: "g", emoji: "", label: "G", kind: "category", out_cents: 4000, share: 1, rows: 1 }], rest: null },
    },
  }, ctx({ kind: "all", periodId: "all" }));
  assert.ok(ghost.cashflow.ghost);
  assert.match(ghost.cashflow.columns[0].label, /2019 · not tracked/);
  assert.equal(ghost.cashflow.columns[0].ghost, true);
  assert.equal(ghost.cashflow.columns.length, 2);

  const nullCharts = bankPeriodChartsModel(report({
    charts: null,
    waiting: { period: 0, all: 0, oldest: null },
  }), ctx());
  assert.equal(nullCharts.state, "charts");
  assert.equal(nullCharts.cashflow, null);
  assert.deepEqual(nullCharts.header.shown, []);

  const single = bankPeriodChartsModel({
    ...report(),
    period: {
      kind: "all_time", key: "all",
      start: "2026-09-28", end: "2027-01-03",
      label: "All time", so_far: true, note: null,
    },
    charts: {
      version: 1,
      granularity: "quarter",
      buckets: [
        entry({
          id: "2026-Q4", kind: "quarter", label: "Q4",
          start: "2026-09-28", end: "2027-01-03",
          group: "2026", out_cents: 24977, state: "tracked",
        }),
      ],
      groups: [],
      categories: weekCharts().categories,
    },
  }, ctx({ kind: "all", periodId: "all" }));
  assert.equal(single.cashflow, null);
  assert.deepEqual(single.header.shown, ["categories"]);
  assert.equal(single.header.switchShown, false);
});

test("not-counted parts omit badge waiting when the badge is on, and include it when off", () => {
  const withTransfers = report({
    totals: totals({
      out_cents: 24977, net_cents: -24977,
      transfer_out_cents: 50000, transfer_in_cents: 40000,
      unclassified_in_cents: 200, cash_traced_cents: 4000,
    }),
    coverage: {
      tracked_since: "2026-11-11",
      imported_through: "2026-11-11",
      start: "2026-11-11",
      through: "2026-11-11",
      complete: false,
    },
  });
  const badged = bankPeriodChartsModel(withTransfers, ctx({ badgeEnabled: true }));
  assert.deepEqual(badged.notCounted.map((part) => part.key), ["transfers", "unclassified_in", "cash"]);
  assert.match(badged.notCounted[0].text, /transfers ↔ \$500\.00/);
  const unbadged = bankPeriodChartsModel(withTransfers, ctx({ badgeEnabled: false }));
  assert.ok(unbadged.notCounted.some((part) => part.key === "waiting"));
  assert.ok(unbadged.notCounted.some((part) => part.key === "coverage"));
});

test("digest changes when the view, collapse, or stale flag changes", () => {
  const both = bankPeriodChartsModel(report(), ctx());
  const cashflow = bankPeriodChartsModel(report(), ctx({ view: "cashflow" }));
  const collapsed = bankPeriodChartsModel(report(), ctx({ collapsed: true }));
  const stale = bankPeriodChartsModel(report(), ctx({ stale: true }));
  assert.equal(typeof both.digest, "string");
  assert.notEqual(both.digest, cashflow.digest);
  assert.notEqual(both.digest, collapsed.digest);
  assert.notEqual(both.digest, stale.digest);
  assert.deepEqual(cashflow.header.shown, ["cashflow"]);
});

test("decoded -c JSON round-trips through the panel model", () => {
  const body = {
    ok: true,
    schema_version: 1,
    today: "2026-11-14",
    categories: [],
    accounts: [],
    issues: { errors: 0, warnings: 0 },
    findings: [],
    period: report().period,
    totals: report().totals,
    breakdown: [],
    days: [],
    waiting: report().waiting,
    coverage: report().coverage,
    navigation: report().navigation,
    flagged: 0,
    charts: weekCharts(),
  };
  const decoded = bankDecodeReport(JSON.stringify(body), "");
  assert.equal(decoded.ok, true);
  const model = bankPeriodChartsModel(decoded.report, ctx());
  assert.equal(model.state, "charts");
  assert.equal(model.cashflow.columns.length, 7);
});
