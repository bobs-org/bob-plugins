// Pure fixture and assertion helpers for the keep-moving real-Obsidian e2e.
// Offline self-test imports these so empty tooltips, missing compact pills,
// and unordered mark hosts fail without launching Obsidian.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

function scratchRoot(repoRoot) {
  return path.join(path.resolve(repoRoot), ".tmp-km-e2e");
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

// The ⏭ host holds only the count text (the glyph is a CSS mask), so the
// compact assertion checks the count attribute, the bare digit text, and
// the glyph child — never a spelled-out word.
function assertKeepMovingCount(mark, count) {
  const want = Number(count);
  if (!mark) return { ok: false, reason: "missing mark" };
  const got = Number(mark.count);
  const text = String(mark.text || "").replace(/\s+/g, "");
  if (got !== want) return { ok: false, reason: `count=${got} want=${want}`, mark };
  if (text !== String(want)) {
    return { ok: false, reason: `text=${JSON.stringify(text)} want=${JSON.stringify(String(want))}`, mark };
  }
  if (!mark.glyph) return { ok: false, reason: "missing glyph child", mark };
  if (/\bkeep\b|\bmoving\b/i.test(String(mark.text || ""))) {
    return { ok: false, reason: "compact pill must stay a bare count", mark };
  }
  return { ok: true, mark };
}

// The animation promise is about a 1 s update with a documented 500 ms
// allowance for Obsidian's cache and editor refresh scheduling.
function assertUpdateWithinBudget(elapsedMs, targetMs = 1000, toleranceMs = 500) {
  const elapsed = Number(elapsedMs);
  const target = Number(targetMs);
  const tolerance = Number(toleranceMs);
  const budgetMs = target + tolerance;
  const ok = Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= budgetMs;
  return { ok, elapsedMs: elapsed, targetMs: target, toleranceMs: target, budgetMs };
}

function animationBurstCount(events, windowMs = 180) {
  const list = Array.isArray(events) ? events : [];
  const timed = [];
  let untimed = 0;
  for (const event of list) {
    const stamp = Number(event && event.t);
    if (Number.isFinite(stamp)) timed.push(stamp);
    else untimed += 1;
  }
  timed.sort((left, right) => left - right);
  let bursts = 0;
  let last = null;
  for (const stamp of timed) {
    if (last === null || stamp - last > windowMs) bursts += 1;
    last = stamp;
  }
  return bursts + untimed;
}

function assertSingleAnimation(events, blockId) {
  const matching = (Array.isArray(events) ? events : []).filter(
    (event) => !blockId || String(event && event.blockId || "") === String(blockId),
  );
  // Same-millisecond starts on every visible row for one owner are one
  // count-change burst, not extra animations. Untimed records stay distinct
  // so the offline self-test still rejects a duplicated animation.
  const bursts = animationBurstCount(matching);
  return {
    ok: bursts === 1,
    count: matching.length,
    bursts,
    events: matching,
  };
}

function collapseConsecutive(order) {
  const seq = [];
  for (const item of Array.isArray(order) ? order : []) {
    if (seq.length && seq[seq.length - 1] === item) continue;
    seq.push(item);
  }
  return seq;
}

// KP2 Reading/Live Preview order on the all-marks row: the link, then the
// past (🔓), the dependents (🔑), the project (⏭), and the clock last (off).
function assertKeepMovingOrder(order) {
  const seq = collapseConsecutive(
    (Array.isArray(order) ? order : []).filter(
      (item) => item === "link" || item === "unblocked" || item === "frees" || item === "keep-moving" || item === "off",
    ),
  );
  const joined = seq.join(",");
  if (joined !== "link,unblocked,frees,keep-moving,off") {
    return { ok: false, reason: `order=${joined} want=link,unblocked,frees,keep-moving,off`, order: seq };
  }
  return { ok: true, order: seq };
}

// Strict KP2 for Live Preview: CodeMirror rows never carry an
// `a.internal-link`, so the link seat is absent and every other family
// must render.
function assertKeepMovingLiveOrder(order) {
  const seq = collapseConsecutive(
    (Array.isArray(order) ? order : []).filter(
      (item) => item === "link" || item === "unblocked" || item === "frees" || item === "keep-moving" || item === "off",
    ),
  );
  const joined = seq.join(",");
  if (joined !== "unblocked,frees,keep-moving,off") {
    return { ok: false, reason: `order=${joined} want=unblocked,frees,keep-moving,off`, order: seq };
  }
  return { ok: true, order: seq };
}

// Relative KP2/KP4 for Reading: every rendered family keeps its contracted
// seat even when a sibling family cannot render on this display. The
// unmodified frees and off-chip harnesses show the same Reading absences
// here (no 🔓, no off chip), so the strict full-order form stays a Live
// Preview assertion only.
function assertKeepMovingRelativeOrder(order) {
  const seq = collapseConsecutive(
    (Array.isArray(order) ? order : []).filter(
      (item) => item === "link" || item === "unblocked" || item === "frees" || item === "keep-moving" || item === "off",
    ),
  );
  const at = (name) => seq.indexOf(name);
  const problems = [];
  if (!seq.includes("keep-moving")) problems.push("missing keep-moving");
  if (at("frees") !== -1 && at("keep-moving") !== -1 && !(at("frees") < at("keep-moving"))) {
    problems.push("keep-moving must follow frees");
  }
  if (at("unblocked") !== -1 && at("frees") !== -1 && !(at("unblocked") < at("frees"))) {
    problems.push("frees must follow the unblocked glyph");
  }
  if (at("keep-moving") !== -1 && at("off") !== -1 && !(at("keep-moving") < at("off"))) {
    problems.push("off chip must stay last");
  }
  if (at("off") !== -1 && at("off") !== seq.length - 1) problems.push("off chip must stay last");
  if (at("link") !== -1 && !(at("link") < at("keep-moving"))) problems.push("mark must follow the link");
  if (problems.length) return { ok: false, reason: problems.join("; "), order: seq };
  return { ok: true, order: seq };
}

function assertLinkThenKeepMoving(order) {
  const seq = collapseConsecutive(
    (Array.isArray(order) ? order : []).filter((item) => item === "link" || item === "keep-moving"),
  );
  const joined = seq.join(",");
  if (joined !== "link,keep-moving") {
    return { ok: false, reason: `order=${joined} want=link,keep-moving`, order: seq };
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

function expectedKmTooltip() {
  return [
    "Closing this offers 4 tasks to keep job_email_recruiters moving",
    "It's the last job_email_recruiters task planned today",
    "• Ecogpt · Next",
    "• Ray Lyles · Next",
    "• Product Engineer · Next",
    "+1 more",
    "ready in job_email_recruiters · not dependents",
  ].join("\n");
}

function expectedAllTooltip() {
  return [
    "Closing this offers 1 task to keep km_all moving",
    "It's the last km_all task planned today",
    "• All sibling · Next",
    "ready in km_all · not dependents",
  ].join("\n");
}

// KB7: the screenshot project is a sub-project of job_2026; X is its
// only live link and four Next residents stay offerable.
function recruiterNote() {
  return [
    "---",
    'type: "[[project]]"',
    "status: wip",
    'parent: "[[job_2026]]"',
    "---",
    "- [ ] #task Root ^prj",
    "- [*] #task Reply to Luzern ^luzern",
    "- [*] #task Ecogpt ^ecogpt",
    "- [*] #task Ray Lyles ^ray-lyles",
    "- [*] #task Product Engineer ^product-engineer-dan-dowd",
    "- [*] #task Senior Rust ^senior-rust-java-engineer",
    "",
  ].join("\n");
}

function jobNote() {
  return [
    "---",
    "type: [[area]]",
    "---",
    "",
  ].join("\n");
}

function jobProjectNote() {
  return ["---", 'type: "[[project]]"', 'parent: "[[job]]"', "status: wip", "---",
    "- [ ] #task Job 2026 ^prj", "\t- 🧩 **Sub-projects:** [[job_email_recruiters]] • [[km_all]]", ""].join("\n");
}

// KP2: one row wearing every mark — 🔓 (unblocked today), 🔑 (one dependent),
// ⏭ (one offered sibling), and the off chip (tagged #off).
function allNote(dates) {
  const d = dates || fixtureDates();
  return [
    "---",
    'type: "[[project]]"',
    "status: wip",
    'parent: "[[job_2026]]"',
    "---",
    "- [ ] #task All root ^prj",
    `- [x] #task All done [id:: alldone] [completion:: ${d.today}] ^alldone`,
    "- [*] #task All owner [id:: allx] [dependsOn:: alldone] #off ^allx",
    "- [?] #task All dependent [dependsOn:: allx] ^alld",
    "- [*] #task All sibling ^ally",
    "",
  ].join("\n");
}

// KB6: a root project with a Sub-projects marker is an umbrella, so its
// linked task never gets the mark.
function umbrellaNote() {
  return [
    "---",
    'type: "[[project]]"',
    "status: wip",
    "root: true",
    "---",
    "- [ ] #task Um root ^prj",
    "\t- 🧩 **Sub-projects:** [[um_child]]",
    "- [*] #task Um task ^umtask",
    "",
  ].join("\n");
}

// KB6: a standalone project under an area has no mark even with residents.
function standaloneNote() {
  return ["---", 'type: "[[project]]"', 'parent: "[[job]]"', "status: wip", "---",
    "- [ ] #task Standalone ^prj", "- [*] #task Planned ^standalone", "- [*] #task Remaining ^remaining", ""].join("\n");
}

function dailyNote(dates) {
  const d = dates || fixtureDates();
  return [
    `# ${d.today}`,
    "",
    "## Pomodoros",
    "",
    "- [ ] () — WRITE",
    "\t- [[job_email_recruiters#^luzern]]",
    "",
    "- [ ] () — EVERYTHING",
    "\t- [[km_all#^allx]]",
    "",
    "- [ ] () — ROOT",
    "\t- [[standalone#^standalone]]",
    "",
    "- [ ] () — UMBRELLA",
    "\t- [[um#^umtask]]",
    "",
    "- [ ] (**0900-0930** [t:: 30m]) — MIXED",
    "\t- read [[job_email_recruiters#^luzern]] first",
    "\t- ![[job_email_recruiters#^luzern]]",
    "\t- ~~[[job_email_recruiters#^luzern]]~~",
    "",
    "- [x] (**0800-0815** [t:: 15m]) — CLOSED",
    "\t- [[job_email_recruiters#^luzern]]",
    "",
    "## Events",
    "",
    "- [ ] Event",
    "\t- [[job_email_recruiters#^luzern]]",
    "",
  ].join("\n");
}

// KB3: striking U's link passes the baton to X.
function struckSiblingLine() {
  return "\t- ~~[[job_email_recruiters#^ecogpt]]~~";
}

function siblingLine() {
  return "\t- [[job_email_recruiters#^ecogpt]]";
}

const EXPECTED_MARKS = Object.freeze([
  Object.freeze({ id: "ROOT", blockId: "standalone", count: 0, context: /standalone#\^standalone|standalone > \^standalone/ }),
  Object.freeze({ id: "KM4", blockId: "luzern", count: 4, context: /job_email_recruiters#\^luzern|job_email_recruiters > \^luzern/ }),
  Object.freeze({ id: "KMALL", blockId: "allx", count: 1, context: /km_all#\^allx|km_all > \^allx/, unblocked: true }),
  Object.freeze({ id: "UMBRELLA", blockId: "umtask", count: 0, context: /um#\^umtask|um > \^umtask/ }),
]);

const BARE_ROWS = Object.freeze([
  Object.freeze({ id: "KM6-root", needle: /standalone#\^standalone|standalone > \^standalone/, label: "standalone root project link" }),
  Object.freeze({ id: "KM6-umbrella", needle: /um#\^umtask|um > \^umtask/, label: "umbrella project link" }),
  Object.freeze({ id: "KMFL6", needle: /Struck|~~/, label: "struck link" }),
  Object.freeze({ id: "KMFL7", needle: /^Embed:|!\[\[/, label: "embed link" }),
  Object.freeze({ id: "KMFL8", needle: /read .* first/i, label: "mixed prose" }),
  Object.freeze({ id: "KMFL11", needle: /\bEvent\b/, label: "Events section" }),
]);

module.exports = {
  scratchRoot,
  makeScratch,
  pad2,
  fmtDate,
  addDays,
  fixtureDates,
  dailyPathFor,
  normalizeTooltip,
  assertExactTooltip,
  markForBlockId,
  markForContext,
  assertKeepMovingCount,
  assertUpdateWithinBudget,
  assertSingleAnimation,
  collapseConsecutive,
  assertKeepMovingOrder,
  assertKeepMovingLiveOrder,
  assertKeepMovingRelativeOrder,
  assertLinkThenKeepMoving,
  assertBare,
  expectedKmTooltip,
  expectedAllTooltip,
  recruiterNote,
  jobNote,
  jobProjectNote,
  allNote,
  umbrellaNote,
  standaloneNote,
  dailyNote,
  struckSiblingLine,
  siblingLine,
  EXPECTED_MARKS,
  BARE_ROWS,
};
