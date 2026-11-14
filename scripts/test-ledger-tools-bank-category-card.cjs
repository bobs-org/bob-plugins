// Pure Category card, write, and advance models (bob-cli-lc.5 card-model).
// Every fixture is synthetic; monetary totals come from the checked-in bob
// bank JSON captures. Covers typed and imported rows, notes, flags, links,
// [acct::], other block IDs, CRLF, fenced lookalikes, wrap-around, flagged
// waiting rows, duplicate [cat:: fields, an inflow, and each footer variant.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { LedgerToolsPlugin } = require("./ledger-tools-harness.cjs");

const h = LedgerToolsPlugin.helpers;
const fixtureDir = path.join(__dirname, "../plugins/bob-ledger-tools/scripts/fixtures/bank");

function categories() {
  return [
    { key: "coffee", emoji: "☕", label: "Coffee", builtin: false, hotkey: "c", group: "Everyday", hidden: false },
    { key: "groceries", emoji: "🛒", label: "Groceries", builtin: false, hotkey: "g", group: "Everyday", hidden: false },
    { key: "transit", emoji: "🚆", label: "Transit", builtin: false, hotkey: "n", group: null, hidden: false },
    { key: "home", emoji: "🏠", label: "Housing", builtin: false, hotkey: "1", group: "Bills", hidden: false },
    { key: "kids", emoji: "🧸", label: "Kids", builtin: false, hotkey: null, group: null, hidden: true },
    { key: "income", emoji: "💵", label: "Income", builtin: true, hotkey: "i", group: "Money moves", hidden: false },
    { key: "transfer", emoji: "↔️", label: "Transfer", builtin: true, hotkey: "t", group: "Money moves", hidden: false },
  ];
}

function row(overrides = {}) {
  return {
    path: "bank/2026-11.md",
    line: 7,
    date: "2026-11-12",
    account: "checking",
    cents: -645,
    payee: "Corner Cafe",
    category: null,
    links: [],
    note: null,
    flagged: false,
    acknowledged: false,
    id: null,
    origin: "typed",
    ...overrides,
  };
}

test("decode keeps hotkey, group, hidden, and suggestion; old bob degrades", () => {
  const listDoc = JSON.parse(fs.readFileSync(path.join(fixtureDir, "list-waiting.json"), "utf8"));
  const decoded = h.bankDecodeList(JSON.stringify(listDoc), "");
  assert.equal(decoded.ok, true);
  const groceries = decoded.report.categories.find((c) => c.key === "groceries");
  assert.equal(groceries.hotkey, "g");
  assert.equal(groceries.group, null);
  assert.equal(groceries.hidden, false);
  const cash = decoded.report.categories.find((c) => c.key === "cash");
  assert.equal(cash.hotkey, "a");
  assert.equal(cash.group, "Money moves");
  const reportDoc = JSON.parse(fs.readFileSync(path.join(fixtureDir, "report-month.json"), "utf8"));
  const report = h.bankDecodeReport(JSON.stringify(reportDoc), "");
  assert.equal(report.ok, true);
  const shop = report.report.days.flatMap((d) => d.rows).find((r) => r.payee === "ShopRite");
  assert.deepEqual(shop.suggestion, { category: "groceries", source: "learned" });
  // Old bob without new fields still decodes; card model reports old-bob.
  const oldDoc = JSON.parse(JSON.stringify(listDoc));
  for (const c of oldDoc.categories) {
    delete c.hotkey;
    delete c.group;
    delete c.hidden;
  }
  for (const day of oldDoc.days) {
    for (const r of day.rows) {
      delete r.suggestion;
    }
  }
  const old = h.bankDecodeList(JSON.stringify(oldDoc), "");
  assert.equal(old.ok, true);
  assert.ok(old.report.categories.every((c) => c.hotkey === null && c.group === null && c.hidden === false));
  assert.ok(old.report.days.every((d) => d.rows.every((r) => r.suggestion === null)));
  assert.equal(h.bankCategoryOldBob(old.report.categories), true);
  assert.equal(h.bankCategoryOldBob(decoded.report.categories), false);
  // Invalid shapes coerce to null rather than failing the read.
  assert.equal(h.bankNormalizeHotkey("cc"), null);
  assert.equal(h.bankNormalizeHotkey(3), null);
  assert.equal(h.bankNormalizeGroup("  "), null);
  assert.deepEqual(h.bankNormalizeSuggestion({ category: "x", source: "nope" }), null);
  assert.deepEqual(h.bankNormalizeSuggestion(null), null);
});

test("card sections follow first-appearance order; hidden never renders; inflow reorders", () => {
  const sections = h.bankCategorySections(categories());
  assert.deepEqual(sections.map((s) => s.group), ["Everyday", null, "Bills", "Money moves"]);
  assert.ok(sections.every((s) => s.tiles.every((t) => t.key !== "kids")));
  const untitled = sections.find((s) => s.group === null);
  assert.deepEqual(untitled.tiles.map((t) => t.key), ["transit"]);
  const inflow = h.bankCategorySections(categories(), { inflow: true });
  assert.equal(inflow[0].group, "Money moves");
  assert.ok(inflow.slice(1).every((s) => s.dimmed === true));
  assert.ok(inflow[0].tiles.every((t) => t.dimmed === false));
  const table = h.bankCategoryKeyTable(categories());
  assert.equal(table.get("c"), "coffee");
  assert.equal(table.has("q"), false);
  assert.ok(!table.has("k") || table.get("k") !== "kids");
});

test("highlight follows row category then suggestion; each footer variant", () => {
  const cats = categories();
  assert.equal(h.bankCategoryHighlightKey(cats, "coffee", { category: "groceries", source: "learned" }), "coffee");
  assert.equal(h.bankCategoryHighlightKey(cats, null, { category: "groceries", source: "bank" }), "groceries");
  assert.equal(h.bankCategoryHighlightKey(cats, null, null), null);
  assert.equal(h.bankCategoryHighlightKey(cats, "kids", { category: "groceries", source: "learned" }), "groceries");
  let footer = h.bankCategoryCardFooter("coffee", "☕ Coffee", { category: "coffee", source: "learned" }, "☕ Coffee");
  assert.equal(footer.kind, "agree");
  assert.match(footer.text, /learned/);
  footer = h.bankCategoryCardFooter("coffee", "☕ Coffee", { category: "groceries", source: "rule" }, "🛒 Groceries");
  assert.equal(footer.kind, "row");
  assert.match(footer.text, /on the row/);
  footer = h.bankCategoryCardFooter(null, null, { category: "groceries", source: "bank" }, "🛒 Groceries");
  assert.equal(footer.kind, "suggestion");
  footer = h.bankCategoryCardFooter(null, null, null, null);
  assert.equal(footer.kind, "none");
  assert.equal(footer.text, "pick a category");
  const model = h.bankCategoryCardModel({ categories: cats, row: row({ category: "coffee" }), suggestion: { category: "coffee", source: "learned" }, mode: "close" });
  assert.equal(model.kind, "card");
  assert.equal(model.highlightKey, "coffee");
  const inflowModel = h.bankCategoryCardModel({ categories: cats, row: row({ cents: 200000, category: null }), suggestion: null, mode: "close" });
  assert.equal(inflowModel.inflow, true);
  assert.equal(inflowModel.sections[0].group, "Money moves");
  const setModel = h.bankCategoryCardModel({ categories: cats, row: row({ acknowledged: true }), suggestion: null, mode: "set" });
  assert.equal(setModel.header.state, "acknowledged");
  assert.equal(setModel.progress, null);
  const restricted = h.bankCategoryCardModel({ categories: null, row: row(), mode: "close", reason: "bob missing" });
  assert.equal(restricted.kind, "restricted");
  assert.equal(restricted.reason, "bob missing");
  assert.equal(restricted.hint, "bob missing");
  assert.match(restricted.footer.text, /acknowledge/);
  const loading = h.bankCategoryCardModel({ categories: null, row: row(), mode: "close", reason: "loading…" });
  assert.equal(loading.hint, "loading…");
  const duplicated = h.bankCategoryCardModel({ categories: null, row: row(), mode: "close" });
  assert.equal(duplicated.hint, "categories unavailable");
  assert.doesNotMatch(duplicated.hint, /categories unavailable —/);
  const progressed = h.bankCategoryCardModel({
    categories: cats, row: row(), mode: "close",
    progress: { filed: 2, total: 5, waiting: 3 },
    path: "bank/2026-11.md",
  });
  assert.equal(progressed.progress.month, "November");
  assert.equal(h.bankCategoryMonthLabel("bank/2026-07.md"), "July");
  assert.equal(h.bankCategoryDayLabel("2026-11-12"), "Nov 12");
  assert.equal(
    h.bankCategoryAnnounceText({ amount: "$6.45", categoryLabel: "Coffee", nextAmount: "$12.90" }),
    "Filed $6.45 as Coffee · next $12.90 waiting",
  );
  assert.equal(
    h.bankCategoryAnnounceText({ amount: "$6.45", categoryLabel: null, nextAmount: "$12.90" }),
    "Filed $6.45 · no category · next $12.90 waiting",
  );
  assert.equal(
    h.bankCategoryAnnounceText({ amount: "$6.45", categoryLabel: "Coffee" }),
    "Filed $6.45 as Coffee",
  );
});

test("key table is case-insensitive; q/Esc cancel; chord and lock are pure state", () => {
  const table = h.bankCategoryKeyTable(categories());
  assert.deepEqual(h.bankCategoryResolveCardKey({ table, key: "C" }), { action: "file", category: "coffee" });
  assert.deepEqual(h.bankCategoryResolveCardKey({ table, key: "g" }), { action: "file", category: "groceries" });
  assert.equal(h.bankCategoryResolveCardKey({ table, key: "q" }).action, "cancel");
  assert.equal(h.bankCategoryResolveCardKey({ table, key: "Q" }).action, "cancel");
  assert.equal(h.bankCategoryResolveCardKey({ table, key: "Escape" }).action, "cancel");
  assert.equal(h.bankCategoryResolveCardKey({ table, key: "Ctrl+[" }).action, "cancel");
  assert.equal(h.bankCategoryResolveCardKey({ table, key: "Enter" }).action, "accept");
  assert.equal(h.bankCategoryResolveCardKey({ table, key: "Ctrl+Enter" }).action, "accept");
  assert.equal(h.bankCategoryResolveCardKey({ table, key: " " }).action, "no-category");
  assert.equal(h.bankCategoryResolveCardKey({ table, key: "ArrowDown" }).action, "move");
  assert.equal(h.bankCategoryResolveCardKey({ table, key: "Ctrl+N" }).action, "move");
  assert.equal(h.bankCategoryResolveCardKey({ table, key: "z" }).action, "ignore");
  const chord = h.bankCategoryChordInit(true);
  assert.equal(h.bankCategoryChordShouldSwallow(chord, "Enter"), true);
  assert.equal(h.bankCategoryChordShouldSwallow(h.bankCategoryChordKeyup(chord), "Enter"), false);
  assert.equal(h.bankCategoryChordShouldSwallow(h.bankCategoryChordInit(false), "Enter"), false);
  const lock = h.bankCategoryLockInit(1000);
  assert.equal(h.bankCategoryLockActive(lock, 1100), true);
  assert.equal(h.bankCategoryLockActive(lock, 1400), false);
});

const WRITE_SOURCE = [
  "---",
  "month: 2026-11",
  "---",
  "",
  "## Thu Nov 12",
  "",
  "- [ ] $6.45 Corner Cafe",
  "- [ ] $61.20 ShopRite [cat:: groceries] ⚑ -- with Kelly [[shoprite]] [acct:: checking] ^bank-aaa111",
  "- [x] $13.71 Smashburger [cat:: dining] ^task-9",
  "- [ ] $4.25 Fee [cat:: dining] [cat:: groceries]",
  "- [x] **$13.71** Bold",
  "```",
  "- [ ] $8.00 inside a fence",
  "```",
  "  - [ ] $9.99 indented child",
  "- [ ] 3 things",
].join("\n");

function captureFor(line, text) {
  return h.bankCategoryCapture({ path: "bank/2026-11.md", line, lineText: text });
}

test("write planner inserts, replaces, and removes in one line; refusals carry the notice", () => {
  const lines = WRITE_SOURCE.split("\n");
  // Close mode insert after the payee span plus tick.
  let plan = h.bankCategoryWritePlan({
    capture: captureFor(7, lines[6]),
    currentPath: "bank/2026-11.md",
    currentSource: WRITE_SOURCE,
    mode: "close",
    categoryKey: "coffee",
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.action, "insert");
  assert.equal(plan.tick, true);
  assert.ok(plan.edits.some((e) => e.insert === "x"));
  assert.ok(plan.edits.some((e) => e.insert === " [cat:: coffee]"));
  // Set mode replaces without ticking and preserves tail bytes.
  plan = h.bankCategoryWritePlan({
    capture: captureFor(8, lines[7]),
    currentPath: "bank/2026-11.md",
    currentSource: WRITE_SOURCE,
    mode: "set",
    categoryKey: "dining",
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.action, "replace");
  assert.equal(plan.tick, false);
  // Space removes the field with one leading space and ticks in close mode.
  plan = h.bankCategoryWritePlan({
    capture: captureFor(8, lines[7]),
    currentPath: "bank/2026-11.md",
    currentSource: WRITE_SOURCE,
    mode: "close",
    categoryKey: null,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.action, "remove");
  assert.ok(plan.edits.some((e) => e.insert === "" && e.toCh > e.fromCh));
  // Refusals: moved text, changed file, ticked row in close mode, duplicate cat, fenced row.
  const moved = h.bankCategoryWritePlan({
    capture: captureFor(7, "- [ ] $6.45 Corner Ate"),
    currentPath: "bank/2026-11.md",
    currentSource: WRITE_SOURCE,
    mode: "close",
    categoryKey: "coffee",
  });
  assert.equal(moved.ok, false);
  assert.match(moved.message, /row changed/);
  const wrongFile = h.bankCategoryWritePlan({
    capture: captureFor(7, lines[6]),
    currentPath: "bank/2026-10.md",
    currentSource: WRITE_SOURCE,
    mode: "close",
    categoryKey: "coffee",
  });
  assert.equal(wrongFile.reason, "file-changed");
  const ticked = h.bankCategoryWritePlan({
    capture: captureFor(9, lines[8]),
    currentPath: "bank/2026-11.md",
    currentSource: WRITE_SOURCE,
    mode: "close",
    categoryKey: "coffee",
  });
  assert.equal(ticked.reason, "not-waiting");
  const dup = h.bankCategoryWritePlan({
    capture: captureFor(10, lines[9]),
    currentPath: "bank/2026-11.md",
    currentSource: WRITE_SOURCE,
    mode: "set",
    categoryKey: "coffee",
  });
  assert.equal(dup.reason, "duplicate-cat");
  // Other block IDs stay plain: ^task-9 is not an ack identity.
  const otherId = h.bankCategoryWritePlan({
    capture: captureFor(9, lines[8]),
    currentPath: "bank/2026-11.md",
    currentSource: WRITE_SOURCE,
    mode: "set",
    categoryKey: null,
  });
  assert.equal(otherId.ok, true);
  assert.equal(otherId.action, "remove");
});

test("write planner resolves imported rows by ID and handles CRLF", () => {
  const lines = WRITE_SOURCE.split("\n");
  const byId = h.bankCategoryWritePlan({
    capture: { path: "bank/2026-11.md", line: 999, lineText: "stale", bankId: "aaa111" },
    currentPath: "bank/2026-11.md",
    currentSource: WRITE_SOURCE,
    mode: "set",
    categoryKey: "coffee",
  });
  assert.equal(byId.ok, true);
  assert.equal(byId.line, 8);
  // CRLF sources resolve and plan the same line bytes.
  const crlf = WRITE_SOURCE.replace(/\n/g, "\r\n");
  const crlfLines = crlf.replace(/^\uFEFF/, "").split("\n").map((l) => l.replace(/\r$/, ""));
  const crlfPlan = h.bankCategoryWritePlan({
    capture: captureFor(7, crlfLines[6]),
    currentPath: "bank/2026-11.md",
    currentSource: crlf,
    mode: "close",
    categoryKey: "coffee",
  });
  assert.equal(crlfPlan.ok, true);
  assert.equal(crlfPlan.action, "insert");
  void lines;
});

test("next-waiting finder walks in order, wraps once, and skips non-rows", () => {
  const first = h.bankCategoryNextWaiting({ source: WRITE_SOURCE, path: "bank/2026-11.md", filedLine: 7 });
  assert.equal(first.row.line, 8);
  assert.equal(first.wrapped, false);
  // Document order continues below; after the last waiting row, wrap once above.
  const second = h.bankCategoryNextWaiting({ source: WRITE_SOURCE, path: "bank/2026-11.md", filedLine: 8 });
  assert.equal(second.row.line, 10);
  assert.equal(second.wrapped, false);
  const wrapped = h.bankCategoryNextWaiting({ source: WRITE_SOURCE, path: "bank/2026-11.md", filedLine: 10 });
  assert.equal(wrapped.row.line, 7);
  assert.equal(wrapped.wrapped, true);
  // Flagged waiting rows count; ticked, fenced, indented, and prose never match.
  const scan = h.bankScanSource("bank/2026-11.md", WRITE_SOURCE);
  const waiting = h.bankCategoryWaitingRows(scan);
  assert.deepEqual(waiting.map((r) => r.line), [7, 8, 10]);
  assert.equal(h.bankCategoryNextWaiting({ source: "## Thu Nov 12\n\n- [x] $1.00 Done\n", path: "bank/2026-11.md", filedLine: 3 }), null);
  // JSON row match prefers ID, else path+line with equal cents and payee.
  const jsonRows = [
    { id: "aaa111", path: "bank/2026-11.md", line: 8, cents: -6120, payee: "ShopRite" },
    { id: null, path: "bank/2026-11.md", line: 7, cents: -645, payee: "Corner Cafe" },
  ];
  assert.equal(h.bankCategoryMatchJsonRow({ id: "aaa111", path: "x", line: 99, cents: 0, payee: "y" }, jsonRows).payee, "ShopRite");
  assert.equal(h.bankCategoryMatchJsonRow({ path: "bank/2026-11.md", line: 7, cents: -645, payee: "Corner Cafe" }, jsonRows).payee, "Corner Cafe");
  assert.equal(h.bankCategoryMatchJsonRow({ path: "bank/2026-11.md", line: 7, cents: -1, payee: "Corner Cafe" }, jsonRows), null);
});

test("session counts progress and the summary owns every number", () => {
  let session = h.bankCategorySessionStart("bank/2026-11.md", 0);
  session = h.bankCategorySessionRecord(session, "accept", 30 * 1000);
  session = h.bankCategorySessionRecord(session, "pick", 60 * 1000);
  session = h.bankCategorySessionRecord(session, "no-category", 108 * 1000);
  assert.deepEqual([session.filed, session.accepted, session.picked, session.noCategory], [3, 1, 1, 1]);
  assert.deepEqual(h.bankCategorySessionProgress(session, 28), { filed: 4, total: 31, waiting: 28 });
  assert.equal(h.bankCategorySessionIdleExpired(session, 108 * 1000 + 16 * 60 * 1000), true);
  assert.equal(h.bankCategorySessionIdleExpired(session, 200 * 1000), false);
  const summary = h.bankCategoryEndOfRunSummary({
    monthLabel: "November",
    filed: 31,
    elapsedMs: 108 * 1000,
    accepted: 24,
    picked: 5,
    noCategory: 2,
    accounts: [{ label: "WF Checking", kind: "checking", status: "balanced", hint: null }],
    waitingByMonth: [{ month: "2026-10", waiting: 2, path: "bank/2026-10.md" }],
  });
  assert.match(summary.line1, /November filed — 31 rows/);
  assert.match(summary.line2, /balanced/);
  assert.match(summary.line2, /2 waiting in 2026-10/);
  assert.match(summary.detail, /24 accepted · 5 picked · 2 without a category/);
  const stale = h.bankCategoryEndOfRunSummary({
    monthLabel: "November",
    filed: 1,
    elapsedMs: 5000,
    accounts: [{ label: "WF Checking", kind: "checking", status: "stale", hint: null }],
    waitingByMonth: [],
  });
  assert.match(stale.line2, /stale/);
  const offline = h.bankCategoryEndOfRunSummary({ monthLabel: "November", filed: 1, elapsedMs: 1000, bobReachable: false });
  assert.equal(offline.line2, null);
  assert.match(offline.line1, /November filed/);
});

function editorFor(source) {
  return {
    source,
    cursor: { line: 1, ch: 0 },
    replacements: [],
    getValue() { return this.source; },
    getLine(line) { return this.source.split("\n")[line] || ""; },
    getCursor() { return this.cursor; },
    setCursor(cursor) { this.cursor = cursor; },
    replaceRange(text, from, to) {
      this.replacements.push({ text, from, to });
      const lines = this.source.split("\n");
      lines[from.line] = text;
      this.source = lines.join("\n");
    },
  };
}

function otherMonthSnapshot() {
  return h.bankWalkBuildSnapshotFromContents([
    {
      path: "bank/2026-11.md",
      content: "# November 2026\n\n## Thu Nov 13\n\n- [x] $1.00 Filed cafe\n",
    },
    {
      path: "bank/2026-10.md",
      content: [
        "# October 2026",
        "",
        "## Fri Oct 30",
        "",
        "- [ ] $4.25 Halloween candy",
        "- [ ] $7.50 Duplicate heading treats",
        "- [ ] $9.99 Empty heading placeholder",
        "",
      ].join("\n"),
    },
  ], 3);
}

test("other-month walk line names the oldest waiting month from the snapshot", () => {
  const snap = otherMonthSnapshot();
  assert.equal(snap.available, true);
  assert.equal(h.bankWalkOtherMonthLine(snap, "bank/2026-11.md"), "]b → October 2026 (3 waiting)");
  assert.equal(h.bankWalkOtherMonthLine(snap, "bank/2026-10.md"), null);
  assert.equal(h.bankWalkOtherMonthLine({ available: false, reason: "indexing" }, "bank/2026-11.md"), null);
  assert.equal(h.bankWalkOtherMonthLine(null, "bank/2026-11.md"), null);
});

test("close advances in note order and anchors the landed waiting row", async () => {
  const path = "bank/2026-11.md";
  const editor = editorFor([
    "## Thu Nov 12",
    "- [ ] $1.00 Corner Cafe ^bank-aaa111",
    "- [ ] $2.00 Market ^bank-bbb222",
    "- [ ] $3.00 Later shop ^bank-ccc333",
    "",
  ].join("\n"));
  const plugin = new LedgerToolsPlugin({ workspace: { getActiveFile: () => ({ path }) } });
  const context = plugin.bankCategoryContextAt(editor, { file: { path } }, 2);
  const modal = {
    mode: "close", editor, context, month: "2026-11",
    session: h.bankCategorySessionStart(path, Date.now()),
    closed: false,
    setNext(nextContext, progress, lock) { this.next = { context: nextContext, progress, lock }; this.waitingRefresh = true; },
    setReport() {},
    paint() {},
    showSummary() {},
  };
  plugin.bankCategoryModal = modal;
  plugin.apiBankRefresh = async () => ({ report: { categories: categories(), days: [] }, error: null });
  assert.equal(await plugin.bankCategoryCommit(modal, "coffee", "pick"), true);
  assert.equal(modal.next.context.row.line, 3);
  assert.equal(modal.next.context.row.payee, "Market");
  const anchor = plugin.bankWalkAnchor();
  assert.equal(anchor.path, path);
  assert.equal(anchor.line, 3);
  assert.equal(h.bankCategoryNextWaiting({
    source: editor.getValue(), path, filedLine: 3,
  }).row.line, 4);
});

test("completing a month anchors the last filed row and surfaces the other-month ]b line", async () => {
  const path = "bank/2026-11.md";
  const editor = editorFor([
    "## Thu Nov 12",
    "- [ ] $1.00 Corner Cafe ^bank-aaa111",
    "",
  ].join("\n"));
  const plugin = new LedgerToolsPlugin({ workspace: { getActiveFile: () => ({ path }) } });
  const context = plugin.bankCategoryContextAt(editor, { file: { path } }, 2);
  let summary = null;
  const modal = {
    mode: "close", editor, context, month: "2026-11",
    session: h.bankCategorySessionStart(path, Date.now()),
    closed: false,
    setNext() { throw new Error("month-local wrap must not fire on the last waiting row"); },
    setReport() {},
    paint() {},
    showSummary(value) { summary = value; },
  };
  plugin.bankCategoryModal = modal;
  plugin.bankWalkSnapshot = () => otherMonthSnapshot();
  plugin.apiBankRefresh = async (spec) => {
    if (spec && spec.command === "list") {
      return { report: { days: [] }, error: null };
    }
    return { report: { period: { label: "November" }, accounts: [], days: [] }, error: null };
  };
  assert.equal(await plugin.bankCategoryCommit(modal, "coffee", "pick"), true);
  const anchor = plugin.bankWalkAnchor();
  assert.equal(anchor.path, path);
  assert.equal(anchor.line, 2);
  assert.equal(summary.walkLine, "]b → October 2026 (3 waiting)");
});

test("completion omits the other-month ]b line when the snapshot has no other waiting months", async () => {
  const path = "bank/2026-11.md";
  const editor = editorFor("## Thu Nov 12\n- [ ] $1.00 Corner Cafe\n");
  const plugin = new LedgerToolsPlugin({ workspace: { getActiveFile: () => ({ path }) } });
  const context = plugin.bankCategoryContextAt(editor, { file: { path } }, 2);
  let summary = null;
  const modal = {
    mode: "close", editor, context, month: "2026-11",
    session: h.bankCategorySessionStart(path, Date.now()),
    closed: false,
    setNext() {},
    setReport() {},
    paint() {},
    showSummary(value) { summary = value; },
  };
  plugin.bankCategoryModal = modal;
  plugin.bankWalkSnapshot = () => h.bankWalkBuildSnapshotFromContents([{
    path, content: "## Thu Nov 12\n- [x] $1.00 Corner Cafe [cat:: coffee]\n",
  }], 1);
  plugin.apiBankRefresh = async () => ({ report: { period: { label: "November" }, accounts: [], days: [] }, error: null });
  assert.equal(await plugin.bankCategoryCommit(modal, "coffee", "pick"), true);
  assert.equal(summary.walkLine, null);
});
