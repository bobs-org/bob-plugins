const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { LedgerToolsPlugin } = require("./ledger-tools-harness.cjs");

const {
  BANK_SCHEMA_VERSION,
  BANK_CACHE_SIZE,
  bankBuildArgs,
  bankCacheKey,
  bankDecodeList,
  bankDecodeReport,
  bankErrorModel,
  bankFormatCents,
  bankPresentList,
  bankPresentReport,
  bankBadgeSpecForStrip,
  bankBadgePeriodStart,
  bankBadgeOlderBobRefusal,
  bankPeriodSpecForStrip,
  bankPeriodOlderBobRefusal,
  periodNotesIsoWeekMonday,
} = LedgerToolsPlugin.helpers;

const fixtureDir = path.join(
  __dirname,
  "../plugins/bob-ledger-tools/scripts/fixtures/bank",
);

function readFixture(name) {
  return fs.readFileSync(path.join(fixtureDir, name), "utf8");
}

const listDocument = JSON.parse(readFixture("list-waiting.json"));
const reportDocument = JSON.parse(readFixture("report-month.json"));
const teachingDocument = JSON.parse(readFixture("teaching-empty.json"));

test("bank argv is keyed by command and exact flags", () => {
  assert.deepEqual(bankBuildArgs({}), ["bank", "list", "-f", "json"]);
  assert.deepEqual(bankBuildArgs({ command: "list", all: true, month: "2026-11" }), [
    "bank", "list", "-a", "-m", "2026-11", "-f", "json",
  ]);
  assert.deepEqual(bankBuildArgs({ command: "report", month: "2026-11" }), [
    "bank", "report", "-m", "2026-11", "-f", "json",
  ]);
  assert.deepEqual(bankBuildArgs({ command: "report", date: "2026-11-14" }), [
    "bank", "report", "-D", "2026-11-14", "-f", "json",
  ]);
  assert.deepEqual(bankBuildArgs({ command: "report", week: "2026-W46" }), [
    "bank", "report", "-w", "2026-W46", "-f", "json",
  ]);
  assert.deepEqual(bankBuildArgs({ command: "report", period: "2026-Q4", summary: true }), [
    "bank", "report", "-p", "2026-Q4", "-s", "-f", "json",
  ]);
  assert.deepEqual(bankBuildArgs({ command: "report", period: "all", summary: true }), [
    "bank", "report", "-p", "all", "-s", "-f", "json",
  ]);
  assert.deepEqual(bankBuildArgs({ command: "report", period: "2026-W46", summary: true, charts: true }), [
    "bank", "report", "-p", "2026-W46", "-s", "-c", "-f", "json",
  ]);
  assert.equal(BANK_CACHE_SIZE, 32);
  assert.equal(
    bankCacheKey(bankBuildArgs({ command: "report", month: "2026-10" })),
    JSON.stringify(["bank", "report", "-m", "2026-10", "-f", "json"]),
  );
  assert.deepEqual(bankBadgeSpecForStrip("day", "2026-11-14"), { command: "report", date: "2026-11-14" });
  assert.deepEqual(bankBadgeSpecForStrip("week", "2026-W46"), { command: "report", week: "2026-W46" });
  assert.deepEqual(bankBadgeSpecForStrip("quarter", "2026-Q4"), { command: "report", period: "2026-Q4", summary: true });
  assert.deepEqual(bankBadgeSpecForStrip("year", "2026"), { command: "report", period: "2026", summary: true });
  assert.deepEqual(bankBadgeSpecForStrip("all", "all"), { command: "report", period: "all", summary: true });
  assert.equal(bankBadgePeriodStart("day", "2026-11-14"), "2026-11-14");
  assert.equal(bankBadgePeriodStart("week", "2026-W46"), "2026-11-09");
  assert.equal(bankBadgePeriodStart("quarter", "2026-Q4"), "2026-09-28");
  assert.equal(bankBadgePeriodStart("year", "2026"), "2025-12-29");
  assert.equal(bankBadgePeriodStart("all", "all"), null);
  assert.equal(
    bankBadgeOlderBobRefusal({ exitCode: 2, code: "bad-json", message: "not JSON" }, ["bank", "report", "-p", "2026", "-s", "-f", "json"]),
    true,
  );
  assert.equal(
    bankBadgeOlderBobRefusal({ exitCode: 2, detail: "error: unexpected argument '-p' found" }, ["bank", "report", "-p", "all", "-s", "-f", "json"]),
    true,
  );
  assert.equal(
    bankBadgeOlderBobRefusal({ exitCode: 2, code: "bad-json", message: "not JSON" }, ["bank", "report", "-D", "2026-11-14", "-f", "json"]),
    false,
  );
  assert.deepEqual(bankPeriodSpecForStrip("week", "2026-W46"), {
    command: "report", period: "2026-W46", summary: true, charts: true,
  });
  assert.deepEqual(bankPeriodSpecForStrip("quarter", "2026-Q4"), {
    command: "report", period: "2026-Q4", summary: true, charts: true,
  });
  assert.deepEqual(bankPeriodSpecForStrip("year", "2026"), {
    command: "report", period: "2026", summary: true, charts: true,
  });
  assert.deepEqual(bankPeriodSpecForStrip("all", "all"), {
    command: "report", period: "all", summary: true, charts: true,
  });
  assert.equal(bankPeriodSpecForStrip("day", "2026-11-14"), null);
  assert.deepEqual(
    bankBuildArgs({ command: "report", period: "2026-W46", summary: true, charts: true }),
    ["bank", "report", "-p", "2026-W46", "-s", "-c", "-f", "json"],
  );
  assert.deepEqual(
    bankBuildArgs({ command: "report", period: "2026-Q4", summary: true }),
    ["bank", "report", "-p", "2026-Q4", "-s", "-f", "json"],
    "charts: true is the only path that appends -c",
  );
  assert.equal(
    bankPeriodOlderBobRefusal(
      { exitCode: 2, detail: "error: unexpected argument '-c' found" },
      ["bank", "report", "-p", "2026-W46", "-s", "-c", "-f", "json"],
    ),
    true,
  );
  assert.equal(
    bankPeriodOlderBobRefusal(
      { exitCode: 2, code: "bad-json", message: "not JSON" },
      ["bank", "report", "-p", "2026-W46", "-s", "-c", "-f", "json"],
    ),
    true,
  );
  assert.equal(
    bankPeriodOlderBobRefusal(
      { exitCode: 2, detail: "error: unexpected argument '-c' found" },
      ["bank", "report", "-w", "2026-W46", "-f", "json"],
    ),
    false,
  );
  assert.equal(
    bankBadgeOlderBobRefusal(
      { exitCode: 2, detail: "error: unexpected argument '-c' found" },
      ["bank", "report", "-p", "2026-W46", "-s", "-c", "-f", "json"],
    ),
    false,
    "the badge recognizer keeps matching -p/-s only",
  );
});

test("list decoder accepts the waiting fixture and keeps integer cents", () => {
  const decoded = bankDecodeList(JSON.stringify(listDocument), "");
  assert.equal(decoded.ok, true);
  assert.equal(decoded.report.schema_version, BANK_SCHEMA_VERSION);
  assert.equal(decoded.report.teaching_empty, false);
  assert.equal(decoded.report.filter, "waiting");
  assert.equal(decoded.report.counts.waiting, 2);
  assert.equal(decoded.report.days.length, 2);
  assert.equal(decoded.report.days[0].path, "bank/2026-10.md");
  assert.equal(decoded.report.days[1].rows[0].cents, -6120);
  assert.equal(decoded.report.days[1].rows[0].payee, "ShopRite");
  assert.equal(decoded.report.accounts[0].balance_cents, null);
  assert.equal(decoded.report.accounts[0].status, "unverified");
});

test("report decoder preserves transfers, cash, inflows, and account caveats", () => {
  const decoded = bankDecodeReport(JSON.stringify(reportDocument), "");
  assert.equal(decoded.ok, true);
  assert.equal(decoded.report.period.key, "2026-11");
  assert.equal(decoded.report.period.note, null);
  assert.equal(decoded.report.totals.transfer_out_cents, 10000);
  assert.equal(decoded.report.totals.cash_out_cents, 6350);
  assert.equal(decoded.report.totals.in_cents, 201500);
  assert.equal(decoded.report.totals.unclassified_out_cents, 30);
  assert.equal(decoded.report.waiting.all, 2);
  assert.equal(decoded.report.accounts[0].hint.includes("No import yet"), true);
  assert.equal(decoded.report.accounts[1].kind, "cash");
  const shop = decoded.report.days[1].rows.find((row) => row.payee === "ShopRite");
  assert.equal(shop.flagged, true);
  assert.equal(shop.note, "with Kelly");
  assert.deepEqual(shop.links, ["[[shoprite]]"]);
  assert.equal(decoded.report.coverage, null, "older bob reports remain supported");
  assert.equal(decoded.report.navigation, null, "older bob reports remain supported");
});

test("report decoder validates and passes through optional badge coverage and navigation", () => {
  const extended = JSON.parse(JSON.stringify(reportDocument));
  extended.period.kind = "period-kind-from-a-newer-bob";
  extended.coverage = {
    tracked_since: "2026-11-01",
    imported_through: "2026-11-12",
    start: "2026-11-01",
    through: "2026-11-12",
    complete: false,
  };
  extended.navigation = {
    waiting: null,
    first: { path: "bank/2026-11.md", line: 12, date: "2026-11-12" },
    months: ["bank/2026-11.md"],
  };
  const decoded = bankDecodeReport(JSON.stringify(extended), "");
  assert.equal(decoded.ok, true);
  assert.equal(decoded.report.period.kind, extended.period.kind);
  assert.deepEqual(decoded.report.coverage, extended.coverage);
  assert.deepEqual(decoded.report.navigation, extended.navigation);
  assert.deepEqual(bankPresentReport(decoded.report).navigation, extended.navigation);

  const badCoverage = JSON.parse(JSON.stringify(extended));
  badCoverage.coverage.tracked_since = "2026-02-30";
  assert.equal(bankDecodeReport(JSON.stringify(badCoverage), "").code, "bad-shape");
  const badNavigation = JSON.parse(JSON.stringify(extended));
  badNavigation.navigation.first.line = 0;
  assert.equal(bankDecodeReport(JSON.stringify(badNavigation), "").code, "bad-shape");
  const badMonths = JSON.parse(JSON.stringify(extended));
  badMonths.navigation.months = [""];
  assert.equal(bankDecodeReport(JSON.stringify(badMonths), "").code, "bad-shape");
});

test("teaching-empty is success and never a zero-dollar report", () => {
  const list = bankDecodeList(JSON.stringify(teachingDocument), "");
  const report = bankDecodeReport(JSON.stringify(teachingDocument), "");
  assert.equal(list.ok, true);
  assert.equal(list.report.teaching_empty, true);
  assert.equal(list.report.days, undefined);
  assert.equal(report.ok, true);
  assert.equal(report.report.teaching_empty, true);
  assert.equal(bankPresentList(list.report).kind, "teaching-empty");
  assert.equal(bankPresentReport(report.report).kind, "teaching-empty");
});

test("malformed JSON, schema mismatch, and bob errors never become zero success", () => {
  assert.equal(bankDecodeList("not json", "first stderr").code, "bad-json");
  assert.equal(bankDecodeList("[]", "").code, "bad-shape");
  assert.equal(
    bankDecodeList(JSON.stringify({ ok: true, schema_version: 2, days: [], counts: { rows: 0, waiting: 0, flagged: 0 } }), "").code,
    "schema-mismatch",
  );
  const bobError = bankDecodeReport(
    JSON.stringify({ ok: false, schema_version: 1, error: { code: "usage", message: "pass at most one period" } }),
    "",
  );
  assert.equal(bobError.code, "usage");
  assert.equal(bobError.message, "pass at most one period");
  const stringError = bankDecodeList(
    JSON.stringify({ ok: false, schema_version: 1, error: "hub missing" }),
    "",
  );
  assert.equal(stringError.code, "bob-error");
  assert.equal(stringError.message, "hub missing");
});

test("non-integer cents and numeric payees are rejected", () => {
  const badCents = JSON.parse(JSON.stringify(listDocument));
  badCents.days[1].rows[0].cents = 61.2;
  assert.equal(bankDecodeList(JSON.stringify(badCents), "").code, "bad-shape");
  const stringCents = JSON.parse(JSON.stringify(listDocument));
  stringCents.days[1].rows[0].cents = "-6120";
  assert.equal(bankDecodeList(JSON.stringify(stringCents), "").code, "bad-shape");
  const numericPayee = JSON.parse(JSON.stringify(listDocument));
  numericPayee.days[1].rows[0].payee = 12;
  assert.equal(bankDecodeList(JSON.stringify(numericPayee), "").code, "bad-shape");
  const infTotals = JSON.parse(JSON.stringify(reportDocument));
  infTotals.totals.out_cents = Number.POSITIVE_INFINITY;
  assert.equal(bankDecodeReport(JSON.stringify(infTotals), "").code, "bad-shape");
});

test("cent formatting is exact and presentation models do not invent totals", () => {
  assert.equal(bankFormatCents(-10), "$0.10");
  assert.equal(bankFormatCents(-20), "$0.20");
  assert.equal(bankFormatCents(-30), "$0.30");
  assert.equal(bankFormatCents(125000), "+$1,250.00");
  assert.equal(bankFormatCents(-123456), "$1,234.56");
  assert.equal(bankFormatCents(0), "$0.00");
  assert.equal(bankFormatCents(1.5), null);
  const presented = bankPresentReport(bankDecodeReport(JSON.stringify(reportDocument), "").report);
  assert.equal(presented.totals.outText, "$1,362.56");
  assert.equal(presented.totals.inText, "+$2,015.00");
  assert.equal(presented.days[1].rows.find((row) => row.payee === "Salary").amountText, "+$2,000.00");
  const list = bankPresentList(bankDecodeList(JSON.stringify(listDocument), "").report);
  assert.equal(list.days[1].rows[0].amountText, "$61.20");
  assert.equal(list.counts.waiting, 2);
});

test("bank error cards explain not-found, timeout, schema, and bob errors", () => {
  const notFound = bankErrorModel(
    { code: "bob-not-found" },
    { tried: ["/home/b/.local/bin/bob", "bob (PATH)"] },
  );
  assert.match(notFound.hint, /stats\.bob_path/);
  const desktopOnly = bankErrorModel({
    code: "bob-not-found",
    message: "Spawning bob needs the desktop app.",
  });
  assert.equal(desktopOnly.code, "desktop-only");
  assert.equal(desktopOnly.retry, false);
  assert.match(bankErrorModel({ code: "timeout" }).title, /timed out/);
  assert.match(bankErrorModel({ code: "schema-mismatch" }).hint, /update bob-cli/i);
  assert.equal(bankErrorModel({ code: "bob-error", message: "No vault" }).hint, "No vault");
});

function chartEntry(overrides = {}) {
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
    in_cents: inCents,
    out_cents: outCents,
    net_cents: inCents - outCents,
    waiting: 0,
    rows: 0,
    top_out: [],
    target: { path: "bank/2026-11.md", line: 12 },
    ...overrides,
    net_cents: Object.prototype.hasOwnProperty.call(overrides, "net_cents")
      ? overrides.net_cents
      : (overrides.in_cents || 0) - (overrides.out_cents || 0),
  };
}

function weekCharts(overrides = {}) {
  const days = [
    ["2026-11-09", "Mon 9"],
    ["2026-11-10", "Tue 10"],
    ["2026-11-11", "Wed 11"],
    ["2026-11-12", "Thu 12"],
    ["2026-11-13", "Fri 13"],
    ["2026-11-14", "Sat 14"],
    ["2026-11-15", "Sun 15"],
  ];
  const byId = overrides.byId || {};
  const { byId: _byId, ...rest } = overrides;
  return {
    version: 1,
    granularity: "day",
    buckets: days.map(([id, label]) => chartEntry({
      id,
      label,
      start: id,
      end: id,
      state: id === "2026-11-11" ? "tracked" : "awaiting_import",
      out_cents: id === "2026-11-11" ? 24977 : 0,
      waiting: id === "2026-11-11" ? 7 : 0,
      rows: id === "2026-11-11" ? 7 : 0,
      so_far: id === "2026-11-14",
      top_out: id === "2026-11-11"
        ? [{ key: "groceries", emoji: "🛒", label: "Groceries", out_cents: 14210 }]
        : [],
      ...(byId[id] || {}),
    })),
    groups: [],
    categories: {
      limit: 5,
      series: [
        { key: "groceries", emoji: "🛒", label: "Groceries", kind: "category", out_cents: 14210, share: 0.569, rows: 3 },
        { key: "dining", emoji: "🍽", label: "Dining", kind: "category", out_cents: 6420, share: 0.257, rows: 2 },
        { key: "unclassified", emoji: "●", label: "Unclassified", kind: "unclassified", out_cents: 2047, share: 0.082, rows: 1 },
      ],
      rest: { count: 2, out_cents: 2300, share: 0.092, rows: 2 },
    },
    ...rest,
  };
}

function weekBody(charts) {
  const body = JSON.parse(JSON.stringify(reportDocument));
  body.period = {
    kind: "week",
    key: "2026-W46",
    start: "2026-11-09",
    end: "2026-11-15",
    label: "2026-W46 · Nov 9–15, 2026",
    so_far: true,
    note: null,
  };
  if (charts !== undefined) body.charts = charts;
  return body;
}

test("reports without charts decode exactly as today", () => {
  const decoded = bankDecodeReport(JSON.stringify(reportDocument), "");
  assert.equal(decoded.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(decoded.report, "charts"), false);
  const withNull = JSON.parse(JSON.stringify(reportDocument));
  withNull.charts = null;
  const decodedNull = bankDecodeReport(JSON.stringify(withNull), "");
  assert.equal(decodedNull.ok, true);
  assert.equal(decodedNull.report.charts, null);
});

test("charts decoder accepts a week payload and rejects malformed values with bad-shape", () => {
  const decoded = bankDecodeReport(JSON.stringify(weekBody(weekCharts())), "");
  assert.equal(decoded.ok, true);
  assert.equal(decoded.report.charts.version, 1);
  assert.equal(decoded.report.charts.granularity, "day");
  assert.equal(decoded.report.charts.buckets.length, 7);
  assert.equal(decoded.report.charts.buckets[2].id, "2026-11-11");
  assert.equal(decoded.report.charts.buckets[2].out_cents, 24977);
  assert.equal(decoded.report.charts.buckets[2].net_cents, -24977);
  assert.equal(decoded.report.charts.categories.rest.count, 2);

  const absent = weekBody();
  delete absent.charts;
  assert.equal(Object.prototype.hasOwnProperty.call(bankDecodeReport(JSON.stringify(absent), "").report, "charts"), false);

  const malformed = weekBody([]);
  assert.equal(bankDecodeReport(JSON.stringify(malformed), "").code, "bad-shape");

  const badNet = weekBody(weekCharts());
  badNet.charts.buckets[2].net_cents = 0;
  assert.equal(bankDecodeReport(JSON.stringify(badNet), "").code, "bad-shape");

  const negative = weekBody(weekCharts());
  negative.charts.buckets[2].out_cents = -1;
  negative.charts.buckets[2].net_cents = 1;
  assert.equal(bankDecodeReport(JSON.stringify(negative), "").code, "bad-shape");

  const duplicate = weekBody(weekCharts());
  duplicate.charts.buckets[1].id = duplicate.charts.buckets[0].id;
  assert.equal(bankDecodeReport(JSON.stringify(duplicate), "").code, "bad-shape");

  const gap = weekBody(weekCharts());
  gap.charts.buckets[3].start = "2026-11-13";
  gap.charts.buckets[3].end = "2026-11-13";
  gap.charts.buckets[3].id = "2026-11-13";
  assert.equal(bankDecodeReport(JSON.stringify(gap), "").code, "bad-shape");

  const kindMismatch = weekBody(weekCharts());
  kindMismatch.charts.buckets[0].kind = "week";
  assert.equal(bankDecodeReport(JSON.stringify(kindMismatch), "").code, "bad-shape");

  const badTarget = weekBody(weekCharts());
  badTarget.charts.buckets[0].target = { path: "bank/2026-11.md", line: 0 };
  assert.equal(bankDecodeReport(JSON.stringify(badTarget), "").code, "bad-shape");

  const oversize = weekBody(weekCharts());
  oversize.period.end = "2026-01-01";
  oversize.charts.buckets = Array.from({ length: 65 }, (_, index) => {
    const start = `2026-01-${String(index + 1).padStart(2, "0")}`;
    return chartEntry({ id: start, label: start, start, end: start });
  });
  // 65 days from Jan 1 is not a real month; the length check fires first.
  oversize.period.start = oversize.charts.buckets[0].start;
  oversize.period.end = oversize.charts.buckets[64].end;
  assert.equal(bankDecodeReport(JSON.stringify(oversize), "").code, "bad-shape");
});

test("charts decoder accepts ISO-year groups and null all-time charts", () => {
  const weeks = [];
  for (let week = 1; week <= 53; week += 1) {
    const start = periodNotesIsoWeekMonday(2026, week);
    const end = LedgerToolsPlugin.helpers.bankIsoShiftDays(start, 6);
    const quarter = week <= 13 ? "Q1" : week <= 26 ? "Q2" : week <= 39 ? "Q3" : "Q4";
    weeks.push(chartEntry({
      id: `2026-W${String(week).padStart(2, "0")}`,
      kind: "week",
      label: `W${week}`,
      start,
      end,
      group: quarter,
      state: "tracked",
    }));
  }
  const groups = [1, 2, 3, 4].map((quarter) => {
    const startWeek = (quarter - 1) * 13 + 1;
    const lastWeek = quarter === 4 ? 53 : quarter * 13;
    return chartEntry({
      id: `2026-Q${quarter}`,
      kind: "quarter",
      label: `Q${quarter}`,
      start: periodNotesIsoWeekMonday(2026, startWeek),
      end: LedgerToolsPlugin.helpers.bankIsoShiftDays(periodNotesIsoWeekMonday(2026, lastWeek), 6),
      group: null,
      state: "tracked",
    });
  });
  const body = JSON.parse(JSON.stringify(reportDocument));
  body.period = {
    kind: "iso_year",
    key: "2026",
    start: weeks[0].start,
    end: weeks[52].end,
    label: "2026",
    so_far: true,
    note: null,
  };
  body.charts = {
    version: 1,
    granularity: "week",
    buckets: weeks,
    groups,
    categories: { limit: 5, series: [], rest: null },
  };
  const decoded = bankDecodeReport(JSON.stringify(body), "");
  assert.equal(decoded.ok, true);
  assert.equal(decoded.report.charts.buckets.length, 53);
  assert.equal(decoded.report.charts.groups.length, 4);
  assert.equal(decoded.report.charts.groups[0].group, null);

  const allTime = JSON.parse(JSON.stringify(reportDocument));
  allTime.period = {
    kind: "all_time",
    key: "all",
    start: "2019-01-01",
    end: "2026-11-14",
    label: "All time",
    so_far: true,
    note: null,
  };
  allTime.charts = null;
  const decodedAll = bankDecodeReport(JSON.stringify(allTime), "");
  assert.equal(decodedAll.ok, true);
  assert.equal(decodedAll.report.charts, null);
});

