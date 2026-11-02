// Pure fixture and assertion helpers for the frees-marks real-Obsidian e2e.
// Offline self-test imports these so empty tooltips, missing compact pills,
// and unordered 🔓/🔑 hosts fail without launching Obsidian.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

function scratchRoot(repoRoot) {
  return path.join(path.resolve(repoRoot), ".tmp-fm-e2e");
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
  return {
    today: fmtDate(today),
    plus2: addDays(today, 2),
    year: String(today.getFullYear()),
    stamp: `${today.getFullYear()}${pad2(today.getMonth() + 1)}${pad2(today.getDate())}`,
  };
}

function dailyPathFor(dates) {
  const d = dates || fixtureDates();
  return `${d.year}/${d.stamp}.md`;
}

function compactPill(count) {
  return `🔑${Number(count)}`;
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
  if (!tip) return { ok: false, reason: "empty tooltip text", aria, tip, expected, ariaOk };
  if (tip !== expected) {
    return {
      ok: false,
      reason: `tooltip ${JSON.stringify(tip)} != ${JSON.stringify(expected)}`,
      aria,
      tip,
      expected,
      ariaOk,
    };
  }
  return { ok: true, tip, aria, ariaOk, expected };
}

function markForBlockId(marks, blockId) {
  const id = String(blockId || "");
  const list = (marks || []).filter((item) => item && String(item.blockId || "") === id);
  return { all: list, visible: list.filter((item) => item.visible !== false) };
}

function markForContext(marks, needle) {
  const pattern = needle instanceof RegExp ? needle : new RegExp(String(needle || ""));
  const list = (marks || []).filter((item) => item && pattern.test(String(item.context || "")));
  return { all: list, visible: list.filter((item) => item.visible !== false) };
}

function assertCompactCount(mark, count) {
  const want = Number(count);
  if (!mark) return { ok: false, reason: "missing mark" };
  const got = Number(mark.count);
  const text = String(mark.text || "").replace(/\s+/g, "");
  if (got !== want) return { ok: false, reason: `count=${got} want=${want}`, mark };
  if (text !== compactPill(want)) {
    return { ok: false, reason: `text=${JSON.stringify(text)} want=${JSON.stringify(compactPill(want))}`, mark };
  }
  if (/\bfrees\b/i.test(String(mark.text || ""))) {
    return { ok: false, reason: "compact pill must not spell frees", mark };
  }
  return { ok: true, mark };
}

function collapseConsecutive(order) {
  const seq = [];
  for (const item of Array.isArray(order) ? order : []) {
    if (seq.length && seq[seq.length - 1] === item) continue;
    seq.push(item);
  }
  return seq;
}

function assertGlyphThenMark(order) {
  const seq = collapseConsecutive(
    (Array.isArray(order) ? order : []).filter((item) => item === "unblocked" || item === "frees"),
  );
  const joined = seq.join(",");
  if (joined !== "unblocked,frees") {
    return { ok: false, reason: `order=${joined} want=unblocked,frees`, order: seq };
  }
  return { ok: true, order: seq };
}

function assertBare(marks, needle, label) {
  const found = markForContext(marks, needle);
  if (found.visible.length > 0) {
    return { ok: false, reason: `${label} unexpectedly marked`, mark: found.visible[0] };
  }
  return { ok: true };
}

function expectedFc1Tooltip() {
  return [
    "Closing this frees 1 task",
    "• Launch another epic chain for sase task beads! · sase",
  ].join("\n");
}

function expectedFc7Tooltip() {
  return [
    "Closing this frees 1 task",
    "• 🧩 sase_blog project",
  ].join("\n");
}

function expectedFc8Tooltip() {
  return [
    "Closing this frees 1 task",
    "• Hidden dependent · sase · hidden",
  ].join("\n");
}

function expectedFc13Tooltip() {
  return [
    "Closing this frees 3 tasks",
    "• FC13 free one · sase",
    "• FC13 free two · sase",
    "• FC13 free three · sase",
    "Also blocks 2 waiting on other work",
  ].join("\n");
}

function expectedFc14Tooltip() {
  return [
    "Closing this frees 5 tasks",
    "• FC14 free one · sase",
    "• FC14 free two · sase",
    "• FC14 free three · sase",
    "+2 more",
  ].join("\n");
}

function expectedSameTooltip() {
  return [
    "Closing this frees 1 task",
    "• Same-note dependent · this note",
  ].join("\n");
}

function saseNote(dates) {
  const d = dates || fixtureDates();
  const lines = [
    "# sase",
    "",
    "- [ ] #task FC1 owner [id:: fc1] ^fc1",
    "- [?] #task Launch another epic chain for sase task beads! [dependsOn:: fc1] ^fc1-d",
    "- [ ] #task FC2 owner [id:: fc2] ^fc2",
    "- [?] #task FC2 waiting [dependsOn:: fc2, yopen] ^fc2-d",
    "- [ ] #task FC2 other open [id:: yopen] ^yopen",
    "- [ ] #task FC7 owner [id:: fc7] ^fc7",
    "- [ ] #task FC8 owner [id:: fc8] ^fc8",
    "- [?] #task Hidden dependent [dependsOn:: fc8] #hide ^fc8-d",
    "- [ ] #task FC13 owner [id:: fc13] ^fc13",
    "- [?] #task FC13 free one [dependsOn:: fc13] ^fc13-d1",
    "- [?] #task FC13 free two [dependsOn:: fc13] ^fc13-d2",
    "- [?] #task FC13 free three [dependsOn:: fc13] ^fc13-d3",
    "- [?] #task FC13 wait other [dependsOn:: fc13, yopen] ^fc13-w1",
    `- [?] #task FC13 wait date [dependsOn:: fc13] [scheduled:: ${d.plus2}] ^fc13-w2`,
    "- [ ] #task FC14 owner [id:: fc14] ^fc14",
    "- [?] #task FC14 free one [dependsOn:: fc14] ^fc14-d1",
    "- [?] #task FC14 free two [dependsOn:: fc14] ^fc14-d2",
    "- [?] #task FC14 free three [dependsOn:: fc14] ^fc14-d3",
    "- [?] #task FC14 free four [dependsOn:: fc14] ^fc14-d4",
    "- [?] #task FC14 free five [dependsOn:: fc14] ^fc14-d5",
    `- [x] #task Done today prereq [id:: done-today] [completion:: ${d.today}] ^done-today`,
    "- [ ] #task Both marks owner [id:: both] [dependsOn:: done-today] ^both-1",
    "- [?] #task Freed by both [dependsOn:: both] ^both-d",
    "",
  ];
  return lines.join("\n");
}

function saseBlogNote() {
  return [
    "# sase_blog",
    "",
    "- [?] #task Sase blog [dependsOn:: fc7] ^prj",
    "",
  ].join("\n");
}

function dailyNote(dates) {
  const d = dates || fixtureDates();
  return [
    `# ${d.today}`,
    "",
    "## Pomodoros",
    "",
    "- [ ] () — PLAN",
    "\t- [[sase#^fc1]]",
    "\t- [[sase#^fc2]]",
    "\t- [[sase#^fc7]]",
    "\t- [[sase#^fc8]]",
    "\t- [[sase#^fc13]]",
    "\t- [[sase#^fc14]]",
    "\t- [[sase#^both-1]]",
    "\t- [[#^same-1]]",
    "",
    "- [ ] (**1210-1235** [t:: 25m]) — BUILD",
    "\t- 🍅 [[sase#^fc1]]",
    "\t- [[sase#^fc1]] #",
    "\t- [[sase#^fc1|Read it]]",
    "\t- ~~[[sase#^fc1]]~~",
    "\t- ![[sase#^fc1]]",
    "\t- read [[sase#^fc1]] first",
    "\t- another child",
    "\t\t- [[sase#^fc1]]",
    "",
    "- [x] (**0800-0815** [t:: 15m])",
    "\t- [[sase#^fc1]]",
    "",
    "## Events",
    "",
    "- [ ] Event",
    "\t- [[sase#^fc1]]",
    "",
    "## Tasks",
    "",
    "- [ ] #task Same-note owner [id:: same] ^same-1",
    "- [?] #task Same-note dependent [dependsOn:: same] ^same-d",
    "",
  ].join("\n");
}

function fc1SecondDependentLine() {
  return "- [?] #task FC1 second free [dependsOn:: fc1] ^fc1-d2";
}

const EXPECTED_MARKS = Object.freeze([
  Object.freeze({ id: "FC1", blockId: "fc1", count: 1, context: /sase#\^fc1|sase > \^fc1/ }),
  Object.freeze({ id: "FC7", blockId: "fc7", count: 1, context: /sase#\^fc7|sase > \^fc7/ }),
  Object.freeze({ id: "FC8", blockId: "fc8", count: 1, context: /sase#\^fc8|sase > \^fc8/ }),
  Object.freeze({ id: "FC13", blockId: "fc13", count: 3, context: /sase#\^fc13|sase > \^fc13/ }),
  Object.freeze({ id: "FC14", blockId: "fc14", count: 5, context: /sase#\^fc14|sase > \^fc14/ }),
  Object.freeze({ id: "BOTH", blockId: "both-1", count: 1, context: /sase#\^both-1|sase > \^both-1/, unblocked: true }),
  Object.freeze({ id: "SAME", blockId: "same-1", count: 1, context: /#\^same-1|same-1/ }),
]);

const BARE_ROWS = Object.freeze([
  Object.freeze({ id: "FC2", needle: /sase#\^fc2|sase > \^fc2/, label: "FC2 waiting row" }),
  Object.freeze({ id: "FL6", needle: /Struck|~~/, label: "struck link" }),
  Object.freeze({ id: "FL7", needle: /^Embed:|!\[\[/, label: "embed link" }),
  Object.freeze({ id: "FL8", needle: /read .* first/i, label: "mixed prose" }),
  Object.freeze({ id: "FL11", needle: /\bEvent\b/, label: "Events section" }),
]);

module.exports = {
  scratchRoot,
  makeScratch,
  pad2,
  fmtDate,
  addDays,
  fixtureDates,
  dailyPathFor,
  compactPill,
  normalizeTooltip,
  assertExactTooltip,
  markForBlockId,
  markForContext,
  assertCompactCount,
  collapseConsecutive,
  assertGlyphThenMark,
  assertBare,
  expectedFc1Tooltip,
  expectedFc7Tooltip,
  expectedFc8Tooltip,
  expectedFc13Tooltip,
  expectedFc14Tooltip,
  expectedSameTooltip,
  saseNote,
  saseBlogNote,
  dailyNote,
  fc1SecondDependentLine,
  EXPECTED_MARKS,
  BARE_ROWS,
};
