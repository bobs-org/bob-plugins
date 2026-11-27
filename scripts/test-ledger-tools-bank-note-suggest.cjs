// Past bank-row note library and deterministic in-card ranking.
const assert = require("node:assert/strict");
const test = require("node:test");
const { LedgerToolsPlugin } = require("./ledger-tools-harness.cjs");

const h = LedgerToolsPlugin.helpers;

function month(rows) {
  return [
    "---",
    'parent: "[[bank]]"',
    'type: "[[bank_month]]"',
    "month: 2026-11",
    "---",
    "",
    "# November 2026",
    "",
    ...rows,
    "",
  ].join("\n");
}

function entry(text, date, payee = "Amazon Reta* Ue4v4", path = `bank/${date.slice(0, 7)}.md`, line = 1) {
  return Object.freeze({
    key: h.bankNoteFold(text), text, path, line, date, payee,
    merchantKey: h.bankNoteMerchantKey(payee),
    merchantLabel: h.bankNoteMerchantLabel(payee),
  });
}

function library(entries) {
  return Object.freeze({ available: true, entries: Object.freeze(entries) });
}

test("merchant families remove order codes and store numbers without merging sub-merchants", () => {
  for (const payee of ["Amazon Reta* Ue4v4", "Amazon Reta* Pd4tc", "AMAZON RETA*BV5NH"]) {
    assert.equal(h.bankNoteMerchantKey(payee), "amazon reta");
  }
  assert.equal(h.bankNoteMerchantLabel("Amazon Reta* Ue4v4"), "Amazon Reta");
  assert.equal(h.bankNoteMerchantKey("Amazon Mktpl"), "amazon mktpl");
  assert.notEqual(h.bankNoteMerchantKey("Delivery *Sushi"), h.bankNoteMerchantKey("Delivery *Pizza"));
  assert.equal(h.bankNoteMerchantKey("Track 5 Coffee"), "track 5 coffee");
  assert.equal(h.bankNoteMerchantKey("Shop #123 123456"), "shop #");
});

test("folding handles accents, curly quotes, case, and whitespace", () => {
  assert.equal(h.bankNoteFold("  Café  ‘KELLY’  “gift”  "), `cafe 'kelly' "gift"`);
});

test("library keeps only unchanged editable notes and memoizes exact file contents", () => {
  const content = month([
    "## Wed Nov 18",
    "- [x] $1.00 Amazon Reta* Pd4tc — Ask Kelly?",
    "- [x] $2.00 Amazon Reta* Re4tc — with [[people/kelly|Kelly]] at lunch",
    "- [x] $3.00 Amazon Reta* Oe4tc — #gift for Kelly",
    "- [x] $4.00 Amazon Reta* Xe4tc",
    "- [x] $5.00 Amazon Reta* Ze4tc —   ",
    "",
  ]);
  const cache = new Map();
  const first = h.bankNoteLibraryFromContents([{ path: "bank/2026-11.md", content }], cache);
  assert.equal(first.available, true);
  assert.deepEqual(first.entries.map((row) => row.text), ["Ask Kelly?"]);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.entries), true);
  assert.equal(Object.isFrozen(first.entries[0]), true);
  const firstRecord = first.entries[0];
  const second = h.bankNoteLibraryFromContents([{ path: "bank/2026-11.md", content }], cache);
  assert.equal(second.entries[0], firstRecord, "unchanged month reuses frozen row records");
  const edited = h.bankNoteLibraryFromContents([{
    path: "bank/2026-11.md",
    content: content.replace("Ask Kelly?", "Ask Kelly? updated"),
  }], cache);
  assert.notEqual(edited.entries[0], firstRecord, "changed month is re-tokenized");
});

test("dedupe keeps the spelling from the newest use and drops the card row itself", () => {
  const source = month([
    "## Tue Nov 17",
    "- [x] $1.00 Amazon Reta* Pd4tc — Ask Kelly?",
    "## Wed Nov 18",
    "- [x] $1.00 Amazon Reta* Re4tc — ASK KELLY?",
  ]);
  const data = h.bankNoteLibraryFromContents([{ path: "bank/2026-11.md", content: source }]);
  assert.equal(data.entries.length, 2);
  const row = { path: "bank/2026-12.md", line: 12, date: "2026-11-18", payee: "Amazon Reta* Xe4tc" };
  assert.equal(h.bankNoteSuggest({ library: data, query: "", row })[0].text, "ASK KELLY?");
  const onlySelf = library([entry("Ask Kelly?", "2026-11-18", row.payee, row.path, row.line)]);
  assert.deepEqual(h.bankNoteSuggest({ library: onlySelf, query: "", row }), []);
});

test("empty query shows only affine notes and frecency beats a newer one-off", () => {
  const entries = [
    entry("Ask Kelly?", "2026-11-22", "Amazon Reta* Pd4tc", "bank/2026-10.md", 11),
    entry("Ask Kelly?", "2026-11-23", "Amazon Reta* Re4tc", "bank/2026-10.md", 12),
    entry("Ask Kelly?", "2026-11-24", "AMAZON RETA*BV5NH", "bank/2026-11.md", 2),
    entry("Ask Kelly?", "2026-11-24", "Amazon Reta* Xe4tc", "bank/2026-11.md", 3),
    entry("Ask Karen", "2026-11-25", "Amazon Reta* Be4tc", "bank/2026-11.md", 4),
    entry("Cafe lunch", "2026-11-25", "Corner Cafe", "bank/2026-11.md", 5),
  ];
  const rows = h.bankNoteSuggest({
    library: library(entries),
    query: "",
    row: { path: "bank/2026-11.md", line: 99, date: "2026-11-25", payee: "Amazon Reta* Ue4v4" },
  });
  assert.deepEqual(rows.map((row) => row.text), ["Ask Kelly?", "Ask Karen"]);
  assert.equal(rows[0].affine, true);
  assert.equal(rows[0].meta, "4× · Nov 24");
});

test("query classes, affinity, exact match, two-character global minimum, and four-row limit", () => {
  const entries = [
    entry("Ask Kelly?", "2026-11-24", "Amazon Reta* Pd4tc", "bank/2026-11.md", 1),
    entry("Ask dinner", "2026-11-24", "Amazon Reta* Re4tc", "bank/2026-11.md", 2),
    entry("Ask Abby", "2026-11-24", "Corner Cafe", "bank/2026-11.md", 3),
    entry("Not Ask Kelly", "2026-11-24", "Corner Cafe", "bank/2026-11.md", 4),
    entry("Not Ask Abby", "2026-11-24", "Corner Cafe", "bank/2026-11.md", 5),
    entry("Not Ask Rita", "2026-11-24", "Corner Cafe", "bank/2026-11.md", 6),
    entry("Not Ask Mo", "2026-11-24", "Corner Cafe", "bank/2026-11.md", 7),
    entry("Not Asking", "2026-11-24", "Corner Cafe", "bank/2026-11.md", 8),
    entry("Abby gift", "2026-11-24", "Corner Cafe", "bank/2026-11.md", 9),
  ];
  const row = { path: "bank/2026-11.md", line: 99, date: "2026-11-25", payee: "Amazon Reta* Ue4v4" };
  const oneCharacter = h.bankNoteSuggest({ library: library(entries), query: "a", row });
  assert.ok(oneCharacter.every((item) => item.affine));
  assert.ok(!oneCharacter.some((item) => item.text === "Abby gift"));
  const trailing = h.bankNoteSuggest({ library: library(entries), query: "Ask ", row });
  assert.deepEqual(trailing.slice(0, 2).map((item) => item.text), ["Ask dinner", "Ask Kelly?"]);
  assert.deepEqual(trailing.slice(0, 2).map((item) => item.affine), [true, true]);
  assert.ok(!trailing.some((item) => item.text === "Not Asking"));
  assert.deepEqual(h.bankNoteSuggest({ library: library(entries), query: "ask kelly?", row }).map((item) => item.text), []);
  const twoChars = h.bankNoteSuggest({ library: library(entries), query: "ab", row });
  assert.ok(twoChars.some((item) => item.text === "Abby gift"));
  assert.equal(h.bankNoteSuggest({ library: library(entries), query: "not ask", row }).length, 4);
  assert.ok(h.bankNoteSuggest({ library: library(entries), query: "not ask", row })
    .every((item) => item.matchClass === 0 || item.matchClass === 1));
});

test("word-boundary matches follow prefix matches and affine rows lead each class", () => {
  const entries = [
    entry("Cafe note", "2026-11-24", "Amazon Reta* Pd4tc", "bank/2026-11.md", 1),
    entry("Cafe notes", "2026-11-24", "Corner Cafe", "bank/2026-11.md", 2),
    entry("A cafe", "2026-11-24", "Amazon Reta* Re4tc", "bank/2026-11.md", 3),
    entry("Lunch cafe", "2026-11-24", "Corner Cafe", "bank/2026-11.md", 4),
  ];
  const rows = h.bankNoteSuggest({
    library: library(entries), query: "cafe",
    row: { path: "bank/2026-11.md", line: 90, date: "2026-11-25", payee: "Amazon Reta* Ue4v4" },
  });
  assert.equal(rows[0].text, "Cafe note");
  assert.equal(rows[0].matchClass, 0);
  const firstBoundary = rows.findIndex((row) => row.matchClass === 1);
  assert.ok(firstBoundary > 0);
  assert.equal(rows[firstBoundary].affine, true);
});

test("ghost obeys prefix, class, selection, caret, and overflow rules", () => {
  const rows = [{ key: "ask kelly?", text: "Ask Kelly?", matchClass: 0 }];
  assert.equal(h.bankNoteSuggestGhost({ rows, value: "Ask", selectionStart: 3, selectionEnd: 3 }).text, " Kelly?");
  assert.equal(h.bankNoteSuggestGhost({ rows, value: "ask", selectionStart: 3, selectionEnd: 3 }).text, " Kelly?");
  assert.equal(h.bankNoteSuggestGhost({ rows: [{ ...rows[0], matchClass: 1 }], value: "Ask" }), null);
  assert.equal(h.bankNoteSuggestGhost({ rows, value: "Ask", selectedKey: rows[0].key }), null);
  assert.equal(h.bankNoteSuggestGhost({ rows, value: "Ask", selectionStart: 1, selectionEnd: 1 }), null);
  assert.equal(h.bankNoteSuggestGhost({ rows, value: "Ask", scrollWidth: 101, clientWidth: 100 }), null);
});

test("selection steps by key, wraps through the typed query, and restarts from that query", () => {
  const rows = [{ key: "a" }, { key: "b" }, { key: "c" }];
  assert.equal(h.bankNoteSuggestStep(rows, null, 1), "a");
  assert.equal(h.bankNoteSuggestStep(rows, null, -1), "c");
  assert.equal(h.bankNoteSuggestStep(rows, "a", -1), null);
  assert.equal(h.bankNoteSuggestStep(rows, "c", 1), null);
  assert.equal(h.bankNoteSuggestStep(rows, "b", 1), "c");
  assert.equal(h.bankNoteSuggestStep([], null, 1), null);
});

test("meta labels omit single-use counts and add years outside the reference year", () => {
  const entries = [
    entry("For Abby", "2025-11-24", "Corner Cafe", "bank/2025-11.md", 1),
    entry("For Abby", "2025-11-24", "Corner Cafe", "bank/2025-11.md", 2),
  ];
  const rows = h.bankNoteSuggest({
    library: library(entries), query: "for", limit: 4,
    row: { path: "bank/2026-11.md", line: 50, date: "2026-11-25", payee: "Amazon Reta* Ue4v4" },
  });
  assert.equal(rows[0].meta, "Corner Cafe · 2× · Nov 24 2025");
  const single = h.bankNoteSuggest({
    library: library([entries[0]]), query: "for", row: { date: "2025-11-25", payee: "Amazon Reta* Ue4v4" },
  });
  assert.equal(single[0].meta, "Corner Cafe · Nov 24");
});
