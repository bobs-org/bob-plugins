const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { LedgerToolsPlugin } = require("./ledger-tools-harness.cjs");

const {
  bankClassifyLine,
  bankDiscoverMonthPaths,
  bankLocateDayHeading,
  bankMonthFromPath,
  bankParseAmountLead,
  bankParseDayHeading,
  bankRecognizeRow,
  bankRelevantPath,
  bankScanSource,
} = LedgerToolsPlugin.helpers;

const fixtureDir = path.join(
  __dirname,
  "../plugins/bob-ledger-tools/scripts/fixtures/bank",
);
const monthNote = fs.readFileSync(path.join(fixtureDir, "month-2026-11.md"), "utf8");
const emptyNote = fs.readFileSync(path.join(fixtureDir, "empty-month.md"), "utf8");
const month = { year: 2026, month: 11 };

test("only the hub and canonical month paths are bank-relevant", () => {
  assert.equal(bankRelevantPath("bank.md"), true);
  assert.equal(bankMonthFromPath("bank/2026-11.md").key, "2026-11");
  assert.equal(bankRelevantPath("bank/2026-11.md"), true);
  assert.equal(bankRelevantPath("bank/notes.md"), false);
  assert.equal(bankRelevantPath("cash.md"), false);
  assert.equal(bankRelevantPath("area/bank.md"), false);
  const discovered = bankDiscoverMonthPaths([
    { path: "bank/2026-11.md" },
    { path: "bank/2026-10.md" },
    { path: "bank/readme.md" },
    { path: "bank.md" },
    { path: "cash.md" },
  ]);
  assert.deepEqual(discovered.map((entry) => entry.path), ["bank/2026-10.md", "bank/2026-11.md"]);
});

test("amount leads match the Rust grammar vectors", () => {
  assert.equal(bankParseAmountLead("$13.71 Smash").cents, -1371);
  assert.equal(bankParseAmountLead("**$13.71** Smash").cents, -1371);
  assert.equal(bankParseAmountLead("+$1,250.00 Payroll").cents, 125000);
  assert.equal(bankParseAmountLead("−$4.25 fee").cents, -425);
  assert.equal(bankParseAmountLead("$0.10 a").cents, -10);
  assert.equal(bankParseAmountLead("$0.20 b").cents, -20);
  assert.equal(bankParseAmountLead("$1.234 bad").kind, "unparsed");
  assert.equal(bankParseAmountLead("3 things").kind, "not-amount");
  assert.equal(bankParseAmountLead("$").kind, "stub");
  assert.equal(bankParseAmountLead("$   ").kind, "stub");
  assert.equal(bankClassifyLine("- [ ] 3 things").kind, "not-a-row");
  assert.equal(bankClassifyLine("total: 12.00").kind, "not-a-row");
  assert.equal(bankClassifyLine("- [x] $").kind, "stub");
  assert.equal(bankClassifyLine("- [ ] $").kind, "stub");
});

test("day headings parse canonical, month-day, and ISO spellings", () => {
  for (const title of ["Thu Nov 12", "Nov 12", "2026-11-12", "2026-11-12 Thu"]) {
    assert.equal(bankParseDayHeading(title, month).date.iso, "2026-11-12", title);
  }
  assert.equal(bankParseDayHeading("2026-11-12 Wed", month).weekday_mismatch, true);
  assert.equal(bankParseDayHeading("Notes", month), null);
  assert.equal(bankParseDayHeading("2026-11-12 trip retro", month), null);
});

test("source scan keeps spans and ignores fences, stubs, children, and non-day sections", () => {
  const scan = bankScanSource("bank/2026-11.md", monthNote);
  const payees = scan.rows.map((row) => row.spans.line.text);
  assert.equal(scan.rows.some((row) => /Inside a non-day section/.test(row.spans.line.text)), false);
  assert.equal(scan.rows.some((row) => /indented child/.test(row.spans.line.text)), false);
  assert.equal(scan.rows.some((row) => /inside a fence/.test(row.spans.line.text)), false);
  assert.equal(scan.rows.some((row) => row.spans.line.text.trim() === "- [x] $"), false);
  assert.ok(payees.some((line) => line.includes("ShopRite")));
  assert.ok(payees.some((line) => line.includes("ATM withdrawal")));

  const shopLine = scan.rows.find((row) => row.spans.line.text.includes("ShopRite"));
  const shop = bankRecognizeRow("bank/2026-11.md", monthNote, shopLine.line);
  assert.ok(shop);
  assert.equal(shop.date, "2026-11-12");
  assert.equal(shop.spans.checkbox.text, "[ ]");
  assert.equal(shop.spans.amount.text, "$61.20");
  assert.equal(shop.spans.line.text.includes("ShopRite"), true);
  assert.equal(shop.cents, -6120);

  const bold = scan.rows.find((row) => row.spans.line.text.includes("Smashburger"));
  assert.equal(bold.spans.amount.text, "**$13.71**");
  assert.equal(bold.cents, -1371);

  const minus = scan.rows.find((row) => row.spans.line.text.includes("fee"));
  assert.equal(minus.spans.amount.text, "−$4.25");
  assert.equal(minus.cents, -425);

  const imported = scan.rows.find((row) => row.spans.line.text.includes("ATM withdrawal"));
  assert.equal(imported.date, "2026-11-13");
  assert.equal(imported.acknowledged, true);
});

test("empty month notes have no rows and arbitrary dollar signs are not bank rows", () => {
  const empty = bankScanSource("bank/2026-09.md", emptyNote);
  assert.equal(empty.rows.length, 0);
  assert.equal(bankRecognizeRow("ideas.md", "- [ ] $12.00 coffee", 1), null);
  assert.equal(bankRecognizeRow("bank/2026-11.md", "The price is $12.00 today.", 1), null);
});

test("heading location requires a real day heading in the current source", () => {
  const found = bankLocateDayHeading(monthNote, "2026-11", "2026-11-12");
  assert.ok(found.line > 1);
  assert.match(found.heading, /Thu Nov 12/);
  assert.equal(found.text.startsWith("## "), true);
  assert.equal(bankLocateDayHeading(monthNote, "2026-11", "2026-11-01"), null);
  assert.equal(bankLocateDayHeading(emptyNote, "2026-09", "2026-09-01"), null);
  assert.equal(bankLocateDayHeading(monthNote, "2026-11", "2026-11-14"), null);
});
