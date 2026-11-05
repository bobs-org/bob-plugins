// Offline fixtures and assertions for the real-Obsidian quick-roll e2e.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const TASKS = Object.freeze({
  ready: "Quick roll ready task",
  pending: "Quick roll pending task",
  walk: Object.freeze([
    "Quick roll walk one",
    "Quick roll walk two",
    "Quick roll walk three",
  ]),
});

function makeScratch(repoRoot, prefix) {
  const root = path.join(path.resolve(repoRoot), ".tmp-quick-roll-e2e");
  fs.mkdirSync(root, { recursive: true });
  const safe = String(prefix || "run").replace(/[^A-Za-z0-9._-]+/g, "-") || "run";
  return fs.mkdtempSync(path.join(root, `${safe}-`));
}

function dateText(date) {
  const value = date instanceof Date ? date : new Date();
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function addDays(value, amount) {
  const [year, month, day] = String(value).split("-").map(Number);
  const date = new Date(year, month - 1, day + amount);
  return dateText(date);
}

function fixtureDates(now) {
  const today = dateText(now instanceof Date ? now : new Date());
  return Object.freeze({
    today,
    created: addDays(today, -14),
    fresh: addDays(today, -7),
  });
}

function configYaml() {
  return [
    "timezone: America/New_York",
    "properties:",
    "  - name: scheduled",
    "    values: date",
    "  - name: priority",
    "    values: priority",
    "    schedules: scheduled",
    "    levels:",
    "      - label: P1",
    "        value: high",
    "        min_days: 3",
    "        max_days: 8",
    "      - label: P2",
    "        value: medium",
    "        min_days: 9",
    "        max_days: 31",
    "      - label: P3",
    "        value: low",
    "        min_days: 32",
    "        max_days: 100",
    "      - label: P4",
    "        value: lowest",
    "        min_days: 101",
    "        max_days: 365",
    "freshness:",
    "  interval: 1",
    "  pending_interval: 1",
    "  next_interval: 1",
    "  decay:",
    "    pending_keeps: 2",
    "    next_keeps: 2",
    "    ready_keeps: 2",
    "    enter: P1",
    "",
  ].join("\n");
}

function taskLine(description, status, dates, id) {
  return `- [${status}] #task ${description} [fresh:: ${dates.fresh}] [created:: ${dates.created}] [id:: ${id}]`;
}

function seedNote(dates) {
  const d = dates || fixtureDates();
  return [
    "# Quick roll e2e",
    "",
    taskLine(TASKS.ready, " ", d, "quick-ready"),
    taskLine(TASKS.pending, "/", d, "quick-pending"),
    ...TASKS.walk.map((description, index) =>
      taskLine(description, " ", d, `quick-walk-${index + 1}`),
    ),
    "",
  ].join("\n");
}

function notePath() {
  return "quick-roll.md";
}

function extractTaskLine(content, description) {
  return String(content || "").split(/\r?\n/).find((line) =>
    line.includes(`#task ${description}`),
  ) || "";
}

function parseTaskLine(line) {
  const text = String(line || "");
  const status = /^\s*- \[([^\]])\]/.exec(text)?.[1] ?? null;
  const priority = /\[priority::\s*([^\]]+)\]/.exec(text)?.[1] || null;
  const scheduled = /\[scheduled::\s*(\d{4}-\d{2}-\d{2})\]/.exec(text)?.[1] || null;
  return { status, priority, scheduled, text };
}

function inP1Window(scheduled, today) {
  const parse = (value) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
  };
  const scheduledDay = parse(scheduled);
  const baseDay = parse(today);
  if (!scheduledDay || !baseDay) return false;
  const offset = Math.round((scheduledDay - baseDay) / 86400000);
  return offset >= 3 && offset <= 8;
}

function assertP1TaskLine(line, today) {
  const parsed = parseTaskLine(line);
  if (parsed.priority !== "high") return { ok: false, reason: "priority is not P1/high", parsed };
  if (!inP1Window(parsed.scheduled, today)) {
    return { ok: false, reason: "scheduled date is outside the P1 window", parsed };
  }
  return { ok: true, parsed };
}

function assertVisiblePendingCard(probe) {
  if (!probe || (probe.open !== true && probe.pickerOpen !== true)) {
    return { ok: false, reason: "Task Card is not open" };
  }
  if (probe.stage !== "schedule-work-log") return { ok: false, reason: `stage is ${String(probe.stage)}` };
  if (probe.visibility !== "visible") return { ok: false, reason: `modal visibility is ${String(probe.visibility)}` };
  if (probe.quickPending !== false) return { ok: false, reason: "quick-pending class was not cleared" };
  return { ok: true };
}

function assertBusyNotice(notices) {
  const hits = (Array.isArray(notices) ? notices : []).filter((notice) =>
    String(notice).includes("Review walk still settling — press Alt+P again"),
  );
  return hits.length === 1
    ? { ok: true, notice: hits[0] }
    : { ok: false, reason: `expected one Alt+P settling notice, got ${hits.length}`, notices };
}

module.exports = {
  TASKS,
  makeScratch,
  dateText,
  fixtureDates,
  configYaml,
  taskLine,
  seedNote,
  notePath,
  extractTaskLine,
  parseTaskLine,
  inP1Window,
  assertP1TaskLine,
  assertVisiblePendingCard,
  assertBusyNotice,
};
