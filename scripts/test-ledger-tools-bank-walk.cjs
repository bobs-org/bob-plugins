// Ledger api.bankWalk v1 — index, overlay, snapshot, planners, resolver.
// Fixture month notes in scripts/fixtures/bank-walk/bank/ plus
// bob-bank-list-all.json captured with:
//   TMP=$(mktemp -d); cp scripts/fixtures/bank-walk/bank.md $TMP/bank.md;
//   mkdir -p $TMP/bank; cp scripts/fixtures/bank-walk/bank/*.md $TMP/bank/;
//   BOB_DIR=$TMP bob bank list -a -f json > scripts/fixtures/bank-walk/bob-bank-list-all.json
// Regenerate the JSON with that exact command after editing the fixtures,
// then assert parity (rows + waiting flags) below.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { LedgerToolsPlugin } = require("./ledger-tools-harness.cjs");
const h = LedgerToolsPlugin.helpers;
const fixtureDir = path.join(__dirname, "../plugins/bob-ledger-tools/scripts/fixtures/bank-walk");
const bankDir = path.join(fixtureDir, "bank");
function readFixture(rel) { return fs.readFileSync(path.join(fixtureDir, rel), "utf8"); }
function monthContents() {
  const out = [];
  for (const name of fs.readdirSync(bankDir).sort()) {
    if (!name.endsWith(".md")) continue;
    out.push({ path: `bank/${name}`, content: fs.readFileSync(path.join(bankDir, name), "utf8") });
  }
  return out;
}
function buildSnapshot(contents, generation = 7) { return h.bankWalkBuildSnapshotFromContents(contents, generation); }
function freshSnapshot() { return buildSnapshot(monthContents(), 7); }
test("membership: only amount-led top-level checkboxes under a day count", () => {
  const oct = monthContents().find((f) => f.path === "bank/2026-10.md").content;
  const nov = monthContents().find((f) => f.path === "bank/2026-11.md").content;
  const scanOct = h.bankScanSource("bank/2026-10.md", oct);
  const scanNov = h.bankScanSource("bank/2026-11.md", nov);
  for (const row of [...scanOct.rows, ...scanNov.rows]) {
    assert.equal(h.bankWalkIsRow(row), Number.isSafeInteger(row.cents));
  }
  const stub = scanNov.rows.find((r) => r.line === 24);
  assert.equal(stub.cents, null);
  assert.equal(h.bankWalkIsRow(stub), false);
  const unparsed = scanNov.rows.find((r) => /Bad decimals/.test(r.spans.line.text));
  assert.ok(unparsed);
  assert.equal(unparsed.cents, null);
  assert.equal(h.bankWalkIsRow(unparsed), false);
  assert.equal(h.bankWalkIsWaiting(stub), false);
  assert.equal(h.bankWalkIsWaiting(unparsed), false);
  const ticked = scanOct.rows.find((r) => r.line === 20);
  assert.equal(ticked.acknowledged, true);
  assert.equal(h.bankWalkIsRow(ticked), true);
  assert.equal(h.bankWalkIsWaiting(ticked), false);
  const capitalX = scanNov.rows.find((r) => r.status === "X");
  assert.ok(capitalX);
  assert.equal(capitalX.acknowledged, true);
  assert.equal(h.bankWalkIsWaiting(capitalX), false);
  const dash = scanNov.rows.find((r) => r.status === "-");
  assert.ok(dash);
  assert.equal(h.bankWalkIsWaiting(dash), true);
  const waiting = scanNov.rows.find((r) => r.line === 39);
  assert.equal(h.bankWalkIsWaiting(waiting), true);
  const scanFence = h.bankScanSource("bank/2026-11.md", nov);
  assert.equal(scanFence.rows.some((r) => /inside a fence/.test(r.spans.line.text)), false);
  assert.equal(scanOct.rows.some((r) => /Inside a non-day/.test(r.spans.line.text)), false);
  assert.equal(scanNov.rows.some((r) => /Above first heading/.test(r.spans.line.text)), false);
  assert.equal(scanNov.rows.some((r) => /indented child/.test(r.spans.line.text)), false);
  assert.equal(scanNov.rows.some((r) => /plain checklist/.test(r.spans.line.text)), false);
});
test("card waiting predicate cannot drift from walk predicate", () => {
  const oct = monthContents().find((f) => f.path === "bank/2026-10.md").content;
  const scan = h.bankScanSource("bank/2026-10.md", oct);
  assert.deepEqual(h.bankCategoryWaitingRows(scan).map((r) => r.line), scan.rows.filter((r) => h.bankWalkIsWaiting(r)).map((r) => r.line));
});
test("snapshot: waiting scope, order, keys, labels, counts", () => {
  const snap = freshSnapshot();
  assert.equal(snap.available, true);
  assert.equal(snap.version, 1);
  assert.equal(snap.generation, 7);
  assert.equal(snap.scope, "waiting");
  assert.equal(snap.counts.rows, 27);
  assert.equal(snap.counts.waiting, 20);
  assert.equal(snap.entries.length, 20);
  assert.equal(snap.counts.days, 8);
  assert.equal(snap.counts.waitingDays, 8);
  for (let i = 1; i < snap.entries.length; i += 1) {
    const a = snap.entries[i - 1];
    const b = snap.entries[i];
    const cmp = a.date < b.date ? -1 : a.date > b.date ? 1 : a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line;
    assert.ok(cmp < 0, `order at ${i}`);
  }
  const halloween = snap.entries.find((e) => e.payee === "Halloween candy");
  assert.ok(halloween);
  assert.equal(halloween.date, "2026-10-31");
  assert.equal(halloween.amountText, h.bankFormatCents(-425));
  assert.equal(halloween.inflow, false);
  assert.equal(halloween.label, "Sat Oct 31");
  assert.equal(halloween.short, "Oct 31");
  assert.equal(halloween.month, "2026-10");
  const inflow = snap.entries.find((e) => e.payee === "Payroll inflow");
  assert.ok(inflow);
  assert.equal(inflow.inflow, true);
  assert.equal(inflow.amountText, h.bankFormatCents(120000));
  assert.ok(inflow.amountText.startsWith("+$"));
  const dupId = snap.entries.filter((e) => e.text.includes("deadbeef"));
  assert.equal(dupId.length, 2);
  for (const e of dupId) assert.ok(!e.key.startsWith("bank:"), `duplicate id falls back ${e.key}`);
  const idRow = snap.entries.find((e) => e.text.includes("Cross-month ISO"));
  assert.ok(idRow && !idRow.key.startsWith("bank:"));
  const noid = snap.entries.filter((e) => e.payee === "No-id shop A");
  assert.equal(noid.length, 2);
  assert.notEqual(noid[0].key, noid[1].key);
  const day = snap.days.find((d) => d.date === "2026-10-31");
  assert.ok(day);
  assert.equal(day.count, day.waiting);
  assert.equal(day.count, 4);
  assert.equal(day.label, "Sat Oct 31");
  assert.ok(Object.keys(snap.files).includes("bank/2026-11.md"));
  assert.ok(snap.files["bank/2026-11.md"].headings.length >= 7);
  assert.ok(Object.isFrozen(snap) && Object.isFrozen(snap.entries) && Object.isFrozen(snap.days));
});
test("parity: index rows and waiting flags equal bob bank list -a", () => {
  const snap = freshSnapshot();
  const doc = JSON.parse(readFixture("bob-bank-list-all.json"));
  assert.equal(doc.ok, true);
  const bobRows = doc.days.flatMap((d) => d.rows.map((r) => ({ path: r.path, line: r.line, date: r.date, waiting: r.acknowledged === false })));
  const diskRows = monthContents().flatMap((f) => {
    const scan = h.bankScanSource(f.path, f.content);
    return scan.rows.filter((r) => h.bankWalkIsRow(r)).map((r) => ({ path: r.path, line: r.line, date: r.date, waiting: r.acknowledged === false }));
  });
  const key = (r) => `${r.path}|${r.line}|${r.date}|${r.waiting ? 1 : 0}`;
  assert.deepEqual(new Set(diskRows.map(key)), new Set(bobRows.map(key)));
  assert.equal(diskRows.length, bobRows.length);
  assert.equal(diskRows.length, doc.counts.rows);
});
test("scope flips to all when nothing waits", () => {
  const contents = monthContents().map((f) => {
    const lines = f.content.split("\n");
    const ticked = lines.map((line) => line.replace("- [ ] $", "- [x] $").replace("- [ ] +$", "- [x] +$").replace("- [-] $", "- [x] $"));
    return { path: f.path, content: ticked.join("\n") };
  });
  const snap = buildSnapshot(contents, 8);
  assert.equal(snap.scope, "all");
  assert.equal(snap.entries.length, snap.counts.rows);
  assert.ok(snap.entries.length > 0);
});
test("step wraps in both directions and both scopes", () => {
  const snap = freshSnapshot();
  const first = snap.entries[0];
  const last = snap.entries[snap.entries.length - 1];
  const prevOfFirst = h.bankWalkPlan(snap, { direction: -1, cursor: { path: first.path, line0: first.line - 1 } });
  assert.equal(prevOfFirst.kind, "jump");
  assert.equal(prevOfFirst.entry.key, last.key);
  assert.equal(prevOfFirst.wrapped, true);
  const nextOfLast = h.bankWalkPlan(snap, { direction: 1, cursor: { path: last.path, line0: last.line - 1 } });
  assert.equal(nextOfLast.entry.key, first.key);
  assert.equal(nextOfLast.wrapped, true);
  const allContents = monthContents().map((f) => ({ path: f.path, content: f.content.split("\n").map((l) => l.replace("- [ ] $", "- [x] $").replace("- [ ] +$", "- [x] +$").replace("- [-] $", "- [x] $")).join("\n") }));
  const all = buildSnapshot(allContents, 9);
  const aFirst = all.entries[0];
  const aLast = all.entries[all.entries.length - 1];
  const aPrev = h.bankWalkPlan(all, { direction: -1, cursor: { path: aFirst.path, line0: aFirst.line - 1 } });
  assert.equal(aPrev.wrapped, true);
  assert.equal(aPrev.entry.key, aLast.key);
  const aNext = h.bankWalkPlan(all, { direction: 1, cursor: { path: aLast.path, line0: aLast.line - 1 } });
  assert.equal(aNext.wrapped, true);
  assert.equal(aNext.entry.key, aFirst.key);
});
test("day jumps skip empty headings, merge duplicates, cross months, step from mid-day", () => {
  const snap = freshSnapshot();
  assert.ok(!snap.days.some((d) => d.date === "2026-10-30"), "empty Fri Oct 30 never a stop");
  assert.ok(!snap.days.some((d) => d.date === "2026-11-15"), "empty Sun Nov 15 never a stop");
  const oct31 = snap.days.find((d) => d.date === "2026-10-31");
  assert.ok(oct31.count >= 4, "duplicate headings merged across files");
  const nov12 = snap.days.find((d) => d.date === "2026-11-12");
  assert.ok(nov12.count >= 5, "duplicate heading same file merged");
  const iso = snap.entries.find((e) => e.payee === "Cross-month ISO back to October");
  assert.ok(iso && iso.date === "2026-10-31");
  const mid = snap.entries.find((e) => e.payee === "ShopRite" && e.date === "2026-11-12");
  const prevDay = h.bankWalkPlan(snap, { direction: -1, dayJump: true, cursor: { path: mid.path, line0: mid.line - 1 } });
  assert.equal(prevDay.kind, "jump");
  assert.equal(prevDay.entry.date, "2026-11-04");
  const firstOfDay = snap.entries.find((e) => e.date === "2026-11-12");
  const nextDay = h.bankWalkPlan(snap, { direction: 1, dayJump: true, cursor: { path: firstOfDay.path, line0: firstOfDay.line - 1 } });
  assert.equal(nextDay.entry.date, "2026-11-13");
  assert.equal(nextDay.entry.payee, "ShopRite");
});
test("counts: N]b, N]B and counted wraps take one snapshot", () => {
  const snap = freshSnapshot();
  const first = snap.entries[0];
  const third = h.bankWalkPlan(snap, { direction: 1, repeat: 3, cursor: { path: first.path, line0: first.line - 1 } });
  assert.equal(third.entry.key, snap.entries[3].key);
  assert.equal(third.rank, 4);
  assert.equal(third.total, snap.entries.length);
  const wrapCount = h.bankWalkPlan(snap, { direction: 1, repeat: snap.entries.length + 1, cursor: { path: first.path, line0: first.line - 1 } });
  assert.equal(wrapCount.wrapped, true);
  const dayFirst = snap.entries.find((e) => e.date === snap.days[0].date);
  const dayJump2 = h.bankWalkPlan(snap, { direction: 1, dayJump: true, repeat: 2, cursor: { path: dayFirst.path, line0: dayFirst.line - 1 } });
  assert.equal(dayJump2.dayIndex, 2);
  assert.equal(dayJump2.entry.date, snap.days[2].date);
});
test("origins: cursor gap, daily, anchor, entry", () => {
  const snap = freshSnapshot();
  const gapAbove = h.bankWalkPlan(snap, { direction: 1, cursor: { path: "bank/2026-10.md", line0: 0 } });
  assert.equal(gapAbove.kind, "jump");
  assert.equal(gapAbove.origin, "cursor-gap");
  assert.equal(gapAbove.entry.key, snap.entries[0].key);
  const tickedLine = monthContents().find((f) => f.path === "bank/2026-10.md").content.split("\n").findIndex((l) => l.includes("Ticked treats"));
  const gapTicked = h.bankWalkPlan(snap, { direction: 1, cursor: { path: "bank/2026-10.md", line0: tickedLine } });
  assert.equal(gapTicked.origin, "cursor-gap");
  const dailyWith = h.bankWalkPlan(snap, { direction: 1, cursor: { path: "2026/20261113.md", line0: 0 } });
  assert.equal(dailyWith.origin, "daily");
  assert.equal(dailyWith.entry.date, "2026-11-13");
  const dailyFirst = snap.days.find((d) => d.date === "2026-11-13").first;
  assert.equal(dailyWith.entry.key, snap.entries[dailyFirst].key);
  const dailyLast = h.bankWalkPlan(snap, { direction: -1, cursor: { path: "2026/20261113.md", line0: 0 } });
  const dayEntries = snap.entries.filter((e) => e.date === "2026-11-13");
  assert.equal(dailyLast.entry.key, dayEntries[dayEntries.length - 1].key);
  const dailyWithout = h.bankWalkPlan(snap, { direction: 1, cursor: { path: "2026/20261114.md", line0: 0 } });
  assert.equal(dailyWithout.origin, "entry");
  const anchor = { key: snap.entries[3].key, path: snap.entries[3].path, line: snap.entries[3].line, date: snap.entries[3].date, text: snap.entries[3].text, day: h.bankLocalDate() };
  const fromAnchor = h.bankWalkPlan(snap, { direction: 1, anchor });
  assert.equal(fromAnchor.origin, "anchor");
  assert.equal(fromAnchor.entry.key, snap.entries[4].key);
  const staleKey = h.bankWalkPlan(snap, { direction: 1, anchor: { key: "bank:dead", path: "bank/2026-11.md", line: 39, date: "2026-11-12", text: "- [ ] gone", day: h.bankLocalDate() } });
  assert.equal(staleKey.origin, "anchor-gap");
  const expired = h.bankWalkPlan(snap, { direction: 1, anchor: { key: snap.entries[0].key, path: snap.entries[0].path, line: snap.entries[0].line, date: snap.entries[0].date, text: snap.entries[0].text, day: "2000-01-01" } });
  assert.equal(expired.origin, "entry");
  const entryNext = h.bankWalkPlan(snap, { direction: 1 });
  assert.equal(entryNext.origin, "entry");
  assert.equal(entryNext.entry.key, snap.entries[0].key);
  assert.equal(entryNext.wrapped, false);
  const entryPrev = h.bankWalkPlan(snap, { direction: -1 });
  assert.equal(entryPrev.entry.key, snap.entries[snap.entries.length - 1].key);
  const entryDayNext = h.bankWalkPlan(snap, { direction: 1, dayJump: true });
  assert.equal(entryDayNext.entry.key, snap.entries[0].key);
});
test("locate: member, gap, daily-outside, nulls", () => {
  const snap = freshSnapshot();
  const first = snap.entries[0];
  const onRow = h.bankWalkLocate(snap, { path: first.path, line0: first.line - 1 });
  assert.equal(onRow.inBank, true);
  assert.equal(onRow.member, true);
  assert.equal(onRow.entry.key, first.key);
  const above = h.bankWalkLocate(snap, { path: "bank/2026-10.md", line0: 0 });
  assert.equal(above.inBank, true);
  assert.equal(above.member, false);
  assert.equal(above.date, null);
  const outside = h.bankWalkLocate(snap, { path: "notes/other.md", line0: 0 });
  assert.equal(outside.inBank, false);
  assert.equal(h.bankWalkLocate(snap, null), null);
  assert.equal(h.bankWalkLocate({ available: false, reason: "indexing" }, { path: "bank/2026-10.md", line0: 0 }), null);
});
test("overlay tick leaves WAITING immediately and beats disk", () => {
  const disk = monthContents();
  const base = buildSnapshot(disk, 11);
  const waitingBefore = base.entries.find((e) => e.payee === "Halloween candy");
  assert.ok(waitingBefore);
  const overlaid = disk.map((f) => {
    if (f.path !== "bank/2026-10.md") return f;
    return { path: f.path, content: f.content.replace("- [ ] $4.25 Halloween candy", "- [x] $4.25 Halloween candy") };
  });
  const after = buildSnapshot(overlaid, 12);
  assert.equal(after.entries.some((e) => e.payee === "Halloween candy"), false);
  assert.equal(after.scope, "waiting");
  assert.ok(after.entries.length === base.entries.length - 1);
});
test("resolve: id, line text, same-day uniqueness, payee-start ch", () => {
  const snap = freshSnapshot();
  const contents = Object.fromEntries(monthContents().map((f) => [f.path, f.content]));
  const tickedRaw = "- [x] $18.00 Ticked treats ^bank-aaaaaaaa";
  const tickedResolve = h.bankWalkResolve({ path: "bank/2026-10.md", content: contents["bank/2026-10.md"], entry: { key: "bank:aaaaaaaa", path: "bank/2026-10.md", line: 20, date: "2026-10-31", text: tickedRaw, ackId: "aaaaaaaa" } });
  assert.equal(tickedResolve.ok, true);
  const shop = snap.entries.find((e) => e.payee === "ShopRite" && e.date === "2026-11-13");
  const okLine = h.bankWalkResolve({ path: shop.path, content: contents[shop.path], entry: shop });
  assert.equal(okLine.ok, true);
  const raw = contents[shop.path].split("\n")[shop.line - 1];
  let expectedCh = 0;
  try { const t = h.bankTokenizeLine(raw); expectedCh = t.payeeSpan ? t.payeeSpan.start : t.amount.end; } catch (e) { expectedCh = 0; }
  assert.equal(okLine.ch, expectedCh);
  assert.ok(expectedCh > 0);
  const moved = h.bankWalkResolve({ path: shop.path, content: contents[shop.path].split("\n").map((l, i) => (i === shop.line - 1 ? "- [ ] $99.99 replaced" : l)).join("\n"), entry: { ...shop, text: "- [ ] $99.99 nowhere in day" } });
  assert.equal(moved.ok, false);
  assert.equal(moved.reason, "missing");
  const dupContent = contents["bank/2026-11.md"];
  const dupEntry = snap.entries.find((e) => e.text.includes("deadbeef"));
  assert.ok(dupEntry);
  const dupResolve = h.bankWalkResolve({ path: "bank/2026-11.md", content: dupContent, entry: { ...dupEntry, ackId: "deadbeef" } });
  assert.equal(dupResolve.ok, false);
  assert.equal(dupResolve.reason, "ambiguous");
  const noid = snap.entries.find((e) => e.payee === "No-id shop A");
  const noidResolve = h.bankWalkResolve({ path: noid.path, content: contents[noid.path], entry: noid });
  assert.equal(noidResolve.ok, true);
  assert.equal(h.bankWalkResolve({ path: "bank/2026-11.md", content: "x", entry: null }).ok, false);
});
test("api guards: frozen, never throws, busy and anchor", () => {
  const snap = freshSnapshot();
  assert.ok(Object.isFrozen(snap.entries[0]));
  assert.throws(() => { snap.entries.push({}); }, TypeError);
  assert.deepEqual(h.bankWalkPlan(null, {}), { kind: "empty", scope: "waiting" });
  assert.equal(h.bankWalkLocate(null, null), null);
  assert.equal(h.bankWalkResolve(null).ok, false);
  assert.equal(h.bankWalkPlan("bad", { direction: 1 }).kind, "empty");
  const api = new LedgerToolsPlugin({ vault: {}, workspace: {} }, {}).bankWalkApi();
  assert.equal(api.version, 1);
  assert.equal(api.plan(null, {}).kind, "empty");
  assert.equal(api.locate(null, null), null);
  assert.equal(api.resolve(null).ok, false);
  assert.equal(api.anchor(), null);
  assert.equal(api.busy(), false);
  api.setAnchor(snap.entries[0]);
  assert.ok(api.anchor() && api.anchor().key === snap.entries[0].key);
  api.setAnchor(null);
  assert.equal(api.anchor(), null);
  const plugin = new LedgerToolsPlugin({ vault: {}, workspace: {} }, {});
  plugin.bankCategoryModal = { closed: false };
  assert.equal(plugin.bankWalkBusy(), true);
  plugin.bankCategoryModal = { closed: true };
  assert.equal(plugin.bankWalkBusy(), false);
  plugin.bankCategoryModal = null;
  assert.equal(plugin.bankWalkBusy(), false);
});
test("mixin snapshot: indexing until ready, overlay signature memo, change registry", () => {
  const fresh = new LedgerToolsPlugin({ vault: {}, workspace: {} }, {});
  const indexing = fresh.bankWalkSnapshot();
  assert.equal(indexing.available, false);
  const plugin = new LedgerToolsPlugin({ vault: { getMarkdownFiles: () => [] }, workspace: { getLeavesOfType: () => [] } }, {});
  plugin.setupBankWalk();
  plugin.teardownBankWalk();
  const unloaded = plugin.bankWalkSnapshot();
  assert.equal(unloaded.available, false);
  let fired = 0;
  const plugin2 = new LedgerToolsPlugin({ vault: {}, workspace: {} }, {});
  plugin2.setupBankWalk();
  const off = plugin2.onBankWalkChange(() => { fired += 1; });
  plugin2.bankWalkFireChange({ generation: 1 });
  assert.equal(fired, 1);
  off();
  plugin2.bankWalkFireChange({ generation: 2 });
  assert.equal(fired, 1);
  plugin2.teardownBankWalk();
});
