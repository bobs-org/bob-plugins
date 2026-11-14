const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { LedgerToolsPlugin } = require("./ledger-tools-harness.cjs");

const {
  BANK_SCHEMA_VERSION,
  bankBuildArgs,
  bankCacheKey,
  bankDecodeList,
  bankDecodeReport,
  bankErrorModel,
  bankFormatCents,
  bankPresentList,
  bankPresentReport,
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
  assert.equal(
    bankCacheKey(bankBuildArgs({ command: "report", month: "2026-10" })),
    JSON.stringify(["bank", "report", "-m", "2026-10", "-f", "json"]),
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
