// Pure fixture and assertion helpers for the snooze-marks real-Obsidian e2e.
// Offline self-test imports these so empty tooltips, missing pills, and
// unordered mark hosts fail without launching Obsidian.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

function scratchRoot(repoRoot) {
  return path.join(path.resolve(repoRoot), ".tmp-sn-e2e");
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

function fmtClockMinute(value) {
  const minute = Math.max(0, Math.min(1439, Number(value) || 0));
  return `${pad2(Math.floor(minute / 60))}${pad2(minute % 60)}`;
}

function fmtColonClock(hhmm) {
  const text = String(hhmm || "");
  return `${text.slice(0, 2)}:${text.slice(2, 4)}`;
}

function fixtureDates(now) {
  const today = now instanceof Date ? now : new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  return {
    today: `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`,
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

// Clocks relative to now, all same-day. Near midnight the caller marks the
// time-sensitive assertions skipped instead of asserting across a date line.
function fixtureClocks(now) {
  const date = now instanceof Date ? now : new Date();
  const minute = date.getHours() * 60 + date.getMinutes();
  const nearMidnight = minute < 150 || minute > 1290;
  const asleep = minute + 150;
  const due = minute - 45;
  const freshWoke = minute - 25;
  const settledWoke = minute - 75;
  const runningStart = minute - 10;
  const runningEnd = minute + 20;
  const sameDay = (value) => Number.isFinite(value) && value >= 0 && value < 1440;
  return {
    nowMinutes: minute,
    nearMidnight,
    asleepHhmm: fmtClockMinute(asleep),
    dueHhmm: fmtClockMinute(due),
    freshHhmm: fmtClockMinute(freshWoke),
    freshWokeHhmm: fmtClockMinute(freshWoke),
    settledWokeHhmm: fmtClockMinute(settledWoke),
    runningSpan: `${fmtClockMinute(runningStart)}-${fmtClockMinute(runningEnd)}`,
    stable: !nearMidnight && sameDay(asleep) && sameDay(due) && sameDay(freshWoke) && sameDay(settledWoke),
  };
}

function jobNote() {
  return [
    "# Snooze jobs",
    "",
    "- [*] #task Asleep alpha with a deliberately long title that keeps going past any comfortable reading width so narrow layouts prove they stay readable ^sz-asleep",
    "- [*] #task Due beta ^sz-due",
    "- [?] #task Blocked gamma ^sz-blocked",
    "- [ ] #task Ready delta ^sz-ready",
    "- [*] #task Woken epsilon ^sz-woken",
    "- [*] #task Settled zeta ^sz-woken2",
    "- [*] #task Plain eta ^sz-plain",
    "- [*] #task Dup one ^sz-dup",
    "- [*] #task Dup two ^sz-dup",
    "- [x] #task Done theta ^sz-done",
    "",
  ].join("\n");
}

function dailyNote(dates, clocks) {
  const d = dates || fixtureDates();
  const c = clocks || fixtureClocks();
  return [
    `# ${d.today}`,
    "",
    "## Events",
    "",
    `- [/] #task **${c.runningSpan}** Standup [root:: bob] [type:: MEET] ^evt-running`,
    "",
    "## Pomodoros",
    "",
    "- [ ] () — WRITE",
    "\t- [[job#^sz-woken]]",
    "\t- [[job#^sz-woken2]]",
    "\t- [[job#^sz-plain]]",
    "",
    `- [ ] (**${c.runningSpan}** [t:: 25m]) — MEET`,
    "\t- [[#^evt-running]]",
    "",
    "## Snoozed",
    "",
    `- **${c.asleepHhmm}** [[job#^sz-asleep]]`,
    `- **${c.dueHhmm}** [[job#^sz-due]]`,
    `- **${c.dueHhmm}** [[job#^sz-blocked]]`,
    `- **${c.asleepHhmm}** [[job#^sz-ready]]`,
    `- **${c.asleepHhmm}** [[nope#^sz-gone]]`,
    `- **${c.asleepHhmm}** [[job#^sz-dup]]`,
    `- **${c.asleepHhmm}** [[job#^sz-done]]`,
    `- ~~**${c.dueHhmm}** [[job#^sz-woken]]~~ · woke ${fmtColonClock(c.freshWokeHhmm)}`,
    `- ~~**${c.dueHhmm}** [[job#^sz-woken2]]~~ · woke ${fmtColonClock(c.settledWokeHhmm)}`,
    "",
  ].join("\n");
}

function yesterdayNote(dates, clocks) {
  const d = dates || fixtureDates();
  const c = clocks || fixtureClocks();
  return [
    `# ${d.yesterdayYear}-${pad2(1)}-${pad2(1)}`,
    "",
    "## Pomodoros",
    "",
    "- [ ] () — WRITE",
    "\t- [[job#^sz-woken]]",
    "",
    "## Snoozed",
    "",
    `- **${c.settledWokeHhmm}** [[job#^sz-asleep]]`,
    `- ~~**${c.freshHhmm}** [[job#^sz-woken]]~~ · woke ${fmtColonClock(c.freshWokeHhmm)}`,
    "",
  ].join("\n");
}

function planNote() {
  return [
    "# Plan host",
    "",
    "```bob-plan",
    "```",
    "",
  ].join("\n");
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
      reason: `tooltip ${JSON.stringify(tip)} != ${JSON.stringify(expected)}`,
      aria,
      tip,
      expected,
      ariaOk,
      ok: false,
    };
  }
  return { ok: true, tip, aria, ariaOk, expected };
}

function assertNoDoubleColon(text) {
  const value = String(text || "");
  return { ok: !/::/.test(value), text: value.slice(0, 200) };
}

function marksForKey(marks, key) {
  const id = String(key || "");
  const list = (Array.isArray(marks) ? marks : []).filter((item) => item && String(item.key || "") === id);
  return { all: list, visible: list.filter((item) => item.visible !== false) };
}

function chipText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

module.exports = {
  scratchRoot,
  makeScratch,
  pad2,
  fmtClockMinute,
  fmtColonClock,
  fixtureDates,
  dailyPathFor,
  pastDailyPathFor,
  fixtureClocks,
  jobNote,
  dailyNote,
  yesterdayNote,
  planNote,
  normalizeTooltip,
  assertExactTooltip,
  assertNoDoubleColon,
  marksForKey,
  chipText,
};
