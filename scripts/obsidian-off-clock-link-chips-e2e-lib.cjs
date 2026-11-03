// Pure fixture and assertion helpers for the off-clock link chip e2e.
// Offline self-test imports these so missing chips, wrong tooltips, mismatched
// Event Task look, and unordered 🔓/🔑/chip hosts fail without launching Obsidian.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

function scratchRoot(repoRoot) {
  return path.join(path.resolve(repoRoot), ".tmp-oc-e2e");
}

function makeScratch(repoRoot, prefix) {
  const root = scratchRoot(repoRoot);
  fs.mkdirSync(root, { recursive: true });
  const safe = String(prefix || "run").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+/, "") || "run";
  return fs.mkdtempSync(path.join(root, `${safe}-`));
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function fmtDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function addDays(base, days) {
  const next = new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
  return fmtDate(next);
}

function fixtureDates(now) {
  const today = now instanceof Date ? now : new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  return {
    today: fmtDate(today),
    yesterday: fmtDate(yesterday),
    year: String(today.getFullYear()),
    stamp: `${today.getFullYear()}${pad2(today.getMonth() + 1)}${pad2(today.getDate())}`,
    yesterdayYear: String(yesterday.getFullYear()),
    yesterdayStamp: `${yesterday.getFullYear()}${pad2(yesterday.getMonth() + 1)}${pad2(yesterday.getDate())}`,
  };
}

function dailyPathFor(dates) {
  const d = dates || fixtureDates();
  return `${d.year}/${d.stamp}.md`;
}

function pastDailyPathFor(dates) {
  const d = dates || fixtureDates();
  return `${d.yesterdayYear}/${d.yesterdayStamp}.md`;
}

function normalizeTooltip(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function assertExactTooltip(observed) {
  const aria = normalizeTooltip(observed && observed.aria);
  const tip = normalizeTooltip(observed && observed.tip);
  const expected = normalizeTooltip(observed && observed.expected);
  const ariaOk = Boolean(expected) && aria === expected;
  if (!expected) return { ok: false, reason: "missing expected tooltip", aria, tip, ariaOk };
  if (tip && tip !== expected) {
    return {
      ok: false,
      reason: `tooltip ${JSON.stringify(tip)} != ${JSON.stringify(expected)}`,
      aria,
      tip,
      expected,
      ariaOk,
    };
  }
  if (!ariaOk) {
    return { ok: false, reason: `aria ${JSON.stringify(aria)} != ${JSON.stringify(expected)}`, aria, tip, expected, ariaOk };
  }
  return { ok: true, tip, aria, ariaOk, expected };
}

function chipForBlockId(chips, blockId) {
  const id = String(blockId || "");
  const list = (chips || []).filter((item) => item && String(item.blockId || "") === id);
  return { all: list, visible: list.filter((item) => item.visible !== false) };
}

function chipForContext(rows, needle) {
  const pattern = needle instanceof RegExp ? needle : new RegExp(String(needle || ""));
  const list = (rows || []).filter((item) => item && pattern.test(String(item.context || "") + String(item.href || "")));
  return list;
}

function visibleChip(row) {
  if (!row || !Array.isArray(row.chips)) return null;
  return row.chips.find((item) => item && item.visible !== false) || null;
}

function assertChip(row, expected) {
  const chip = visibleChip(row);
  if (!expected || expected.chip === false) {
    if (chip) return { ok: false, reason: "unexpected chip", chip, row };
    return { ok: true };
  }
  if (!chip) return { ok: false, reason: "missing chip", row };
  if (chip.text !== "off") {
    return { ok: false, reason: `text=${JSON.stringify(chip.text)} want="off"`, chip };
  }
  if (expected.source && chip.source !== expected.source) {
    return { ok: false, reason: `source=${chip.source} want=${expected.source}`, chip };
  }
  if (expected.aria) {
    const tip = assertExactTooltip({ aria: chip.aria, expected: expected.aria });
    if (!tip.ok) return tip;
  }
  return { ok: true, chip };
}

function assertBare(rows, needle, label) {
  const found = chipForContext(rows, needle);
  const marked = found.filter((row) => visibleChip(row));
  if (marked.length > 0) {
    return { ok: false, reason: `${label} unexpectedly chipped`, row: marked[0] };
  }
  return { ok: true };
}

function collapseConsecutive(order) {
  const seq = [];
  for (const item of Array.isArray(order) ? order : []) {
    if (seq.length && seq[seq.length - 1] === item) continue;
    seq.push(item);
  }
  return seq;
}

function assertOp2Order(order) {
  const seq = collapseConsecutive(
    (Array.isArray(order) ? order : []).filter(
      (item) => item === "link" || item === "unblocked" || item === "frees" || item === "chip",
    ),
  );
  const joined = seq.join(",");
  if (joined !== "link,unblocked,frees,chip") {
    return { ok: false, reason: `order=${joined} want=link,unblocked,frees,chip`, order: seq };
  }
  return { ok: true, order: seq };
}

function assertLinkThenChip(order) {
  const seq = collapseConsecutive(
    (Array.isArray(order) ? order : []).filter((item) => item === "link" || item === "chip"),
  );
  const joined = seq.join(",");
  if (joined !== "link,chip") {
    return { ok: false, reason: `order=${joined} want=link,chip`, order: seq };
  }
  return { ok: true, order: seq };
}

function assertNoRing(row) {
  if (!row) return { ok: false, reason: "missing row" };
  if (row.ring) return { ok: false, reason: "status ring on a ledger row", row };
  const hasRing = (Array.isArray(row.order) ? row.order : []).includes("ring");
  if (hasRing) return { ok: false, reason: "bob-task-link-mark in order", order: row.order };
  return { ok: true };
}

function assertSharedLook(link, eventChip) {
  if (!link) return { ok: false, reason: "missing link chip styles" };
  if (!eventChip) return { ok: false, reason: "missing Event Task chip styles" };
  const fields = ["outlineStyle", "outlineColor", "color", "fontSize", "maskImage"];
  const diffs = [];
  for (const field of fields) {
    const left = String(link[field] || "");
    const right = String(eventChip[field] || "");
    if (!left || !right) {
      diffs.push(`${field} missing link=${left} event=${right}`);
      continue;
    }
    if (left !== right) diffs.push(`${field} link=${left} event=${right}`);
  }
  if (diffs.length) return { ok: false, reason: diffs.join("; "), link, eventChip };
  return { ok: true };
}

function assertUpdateWithinBudget(elapsedMs, targetMs = 1000, toleranceMs = 500) {
  const elapsed = Number(elapsedMs);
  const target = Number(targetMs);
  const tolerance = Number(toleranceMs);
  const budgetMs = target + tolerance;
  const ok = Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= budgetMs;
  return { ok, elapsedMs: elapsed, targetMs: target, toleranceMs: tolerance, budgetMs };
}

function assertSameFrame(elapsedMs, budgetMs = 400) {
  const elapsed = Number(elapsedMs);
  const budget = Number(budgetMs);
  const ok = Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= budget;
  return { ok, elapsedMs: elapsed, budgetMs: budget };
}

function loveNote(dates) {
  const d = dates || fixtureDates();
  return [
    "---",
    'type: "[[area]]"',
    "offclock: true",
    "---",
    "# love",
    "",
    "- [ ] #task Lunch ^lunch",
    "- [ ] #task Lunch on-clock #on ^lunch-on",
    "- [x] #task Done today prereq [id:: done-today] [completion:: " + d.today + "] ^done-today",
    "- [ ] #task Both marks owner [id:: both] [dependsOn:: done-today] ^both-1",
    "- [?] #task Freed by both [dependsOn:: both] ^both-d",
    "- [/] #task In progress lunch ^lunch-wip",
    "",
  ].join("\n");
}

function abbyNote() {
  return [
    "---",
    'type: "[[area]]"',
    'parent: "[[love]]"',
    "---",
    "# abby",
    "",
    "- [ ] #task Pickup ^pickup",
    "",
  ].join("\n");
}

function funNote() {
  return [
    "---",
    'type: "[[area]]"',
    'parent: "[[love]]"',
    "offclock: false",
    "---",
    "# fun",
    "",
    "- [ ] #task Park ^park",
    "- [ ] #task Tagged park #off ^park-off",
    "",
  ].join("\n");
}

function funNoteOffclockTrue() {
  return funNote().replace("offclock: false", "offclock: true");
}

function bobNote() {
  return [
    "---",
    'type: "[[project]]"',
    "---",
    "# bob",
    "",
    "- [ ] #task Walk #off ^walk",
    "- [ ] #task Walk alias #OFFCLOCK ^walk-alias",
    "- [ ] #task Fix the parser ^parser",
    "- [ ] #task Untagged walk ^walk-plain",
    "",
  ].join("\n");
}

function bobNoteWithPlainOff() {
  return bobNote().replace("- [ ] #task Untagged walk ^walk-plain", "- [ ] #task Untagged walk #off ^walk-plain");
}

function dailyNote(dates) {
  const d = dates || fixtureDates();
  return [
    `# ${d.today}`,
    "",
    "## Events",
    "",
    "- [ ] #task **1200-1230** School pickup #off ^evt-off",
    "- [ ] #task **1300-1330** Park [root:: abby] ^evt-inherited",
    "- [ ] Event",
    "\t- [[love#^lunch]]",
    "",
    "## Notes",
    "",
    "- [[love#^lunch]]",
    "",
    "## Pomodoros",
    "",
    "- [ ] () — LUNCH",
    "\t- [[love#^lunch]]",
    "\t- [[abby#^pickup]]",
    "\t- [[fun#^park]]",
    "\t- [[fun#^park-off]]",
    "\t- [[love#^lunch-on]]",
    "\t- [[bob#^walk]]",
    "\t- [[bob#^walk-alias]]",
    "\t- [[bob#^parser]]",
    "\t- [[bob#^walk-plain]]",
    "\t- [[love#^both-1]]",
    "\t- [[love#^lunch-wip]]",
    "\t- [[#^local]]",
    "",
    "- [ ] (**1210-1235** [t:: 25m]) — MEET",
    "\t- [[#^evt-off]]",
    "\t- [[#^evt-inherited]]",
    "",
    "- [ ] () — BUILD",
    "\t- [[love#^lunch]]",
    "\t- [[bob#^parser]]",
    "\t- 🍅 [[love#^lunch]]",
    "\t- [[love#^lunch]] #",
    "\t- ~~[[love#^lunch]]~~",
    "\t- [[love#^lunch|Lunch]]",
    "\t- ![[love#^lunch]]",
    "\t- lunch with [[love#^lunch]]",
    "\t- another child",
    "\t\t- [[love#^lunch]]",
    "",
    "- [x] (**0800-0815** [off:: 60m]) — LUNCH",
    "\t- [[love#^lunch]]",
    "",
    "## Tasks",
    "",
    "- [ ] #task Local walk ^local",
    "",
  ].join("\n");
}

function pastDailyNote(dates) {
  const d = dates || fixtureDates();
  return [
    `# ${d.yesterday}`,
    "",
    "## Pomodoros",
    "",
    "- [ ] () — LUNCH",
    "\t- [[love#^lunch]]",
    "",
  ].join("\n");
}

function localWalkOffLine() {
  return "- [ ] #task Local walk #off ^local";
}

const CHIP_ROWS = Object.freeze([
  Object.freeze({ id: "OC1", blockId: "lunch", source: "note", aria: "Off-clock · from love", kind: "plain-lunch" }),
  Object.freeze({ id: "OR3", blockId: "pickup", source: "note", aria: "Off-clock · from love" }),
  Object.freeze({ id: "OR5", blockId: "park-off", source: "off_tag", aria: "Off-clock · tagged #off" }),
  Object.freeze({ id: "OR1", blockId: "walk", source: "off_tag", aria: "Off-clock · tagged #off" }),
  Object.freeze({ id: "OR2", blockId: "walk-alias", source: "off_tag", aria: "Off-clock · tagged #OFFCLOCK" }),
  Object.freeze({ id: "OP2", blockId: "both-1", source: "note", aria: "Off-clock · from love", unblocked: true, frees: true }),
  Object.freeze({ id: "OP5", blockId: "lunch-wip", source: "note", aria: "Off-clock · from love", progress: true }),
  Object.freeze({ id: "OR11", blockId: "evt-off", source: "off_tag", aria: "Off-clock · tagged #off" }),
  Object.freeze({ id: "OR12", blockId: "evt-inherited", source: "note", aria: "Off-clock · from love" }),
]);

const BARE_ROWS = Object.freeze([
  Object.freeze({ id: "OR4", blockId: "park", label: "fun.md offclock:false" }),
  Object.freeze({ id: "OR6", blockId: "lunch-on", label: "#on override" }),
  Object.freeze({ id: "OC14", blockId: "parser", label: "on-clock bob parser" }),
  Object.freeze({ id: "liveness-plain", blockId: "walk-plain", label: "untagged bob walk before edit" }),
  Object.freeze({ id: "OR17-before", blockId: "local", label: "unsaved same-note before #off" }),
]);

module.exports = {
  scratchRoot,
  makeScratch,
  pad2,
  fmtDate,
  addDays,
  fixtureDates,
  dailyPathFor,
  pastDailyPathFor,
  normalizeTooltip,
  assertExactTooltip,
  chipForBlockId,
  chipForContext,
  visibleChip,
  assertChip,
  assertBare,
  collapseConsecutive,
  assertOp2Order,
  assertLinkThenChip,
  assertNoRing,
  assertSharedLook,
  assertUpdateWithinBudget,
  assertSameFrame,
  loveNote,
  abbyNote,
  funNote,
  funNoteOffclockTrue,
  bobNote,
  bobNoteWithPlainOff,
  dailyNote,
  pastDailyNote,
  localWalkOffLine,
  CHIP_ROWS,
  BARE_ROWS,
};
