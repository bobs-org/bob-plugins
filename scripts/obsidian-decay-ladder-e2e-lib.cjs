// Pure fixture and assertion helpers for the decay-ladder real-Obsidian e2e.
// Offline self-test imports these so wrong log bodies, missing card rows,
// and mismatched keep lines fail without launching Obsidian.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SHRUG = "🤷 no reason given";
const LEAF = "🍂";
const ROTTEN_MARKER = "🥀 **ROTTEN LOG**";

const TASKS = Object.freeze({
  wip: Object.freeze({
    id: "wip-1",
    description: "Write migration notes",
    created: "2026-10-28",
  }),
  next: Object.freeze({
    id: "next-1",
    description: "Ship the importer",
    created: "2026-10-28",
  }),
  ready: Object.freeze({
    id: "ready-1",
    description: "Review the queue",
    created: "2026-10-30",
  }),
  p4: Object.freeze({
    id: "p4-1",
    description: "Roll P4 again",
    created: "2026-09-01",
    scheduled: "2026-10-01",
  }),
  skipA: Object.freeze({
    id: "skip-a",
    description: "Batch skip A",
    created: "2026-10-30",
  }),
  skipB: Object.freeze({
    id: "skip-b",
    description: "Batch skip B",
    created: "2026-10-30",
  }),
});

const CARD_TITLES = Object.freeze({
  wip: "Kept 2× in WIP",
  next: "Kept 2× in Next",
  ready: "Kept 2× in Ready",
  p4: "Kept 2× at P4",
});

const CARD_STEP_LABELS = Object.freeze({
  wip: "Move to Next",
  next: "Move to Ready",
  ready: "Defer to P1",
  p4: "Roll again at P4",
});

function scratchRoot(repoRoot) {
  return path.join(path.resolve(repoRoot), ".tmp-dl-e2e");
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

function parseDay(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || ""));
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function fixtureDates(now) {
  const today = now instanceof Date ? now : new Date(2026, 10, 3);
  const start = parseDay("2026-11-03") || today;
  return {
    today: fmtDate(start),
    createdWip: TASKS.wip.created,
    createdReady: TASKS.ready.created,
    createdP4: TASKS.p4.created,
    initialFresh: "2026-11-01",
    day1: fmtDate(start),
    day2: addDays(start, 1),
    day3: addDays(start, 2),
    day4: addDays(start, 3),
    day5: addDays(start, 4),
    year: String(start.getFullYear()),
    stamp: `${start.getFullYear()}${pad2(start.getMonth() + 1)}${pad2(start.getDate())}`,
  };
}

function rungPrep(rung) {
  return rung === "WIP" || rung === "Next" || rung === "Ready" ? "in" : "at";
}

function keptBody(reason, keeps, rung) {
  const text = String(reason || "").trim() ? String(reason).trim() : SHRUG;
  return `${text} · kept ${Number(keeps)}× ${rungPrep(rung)} ${rung}`;
}

function stayBody(reason, keeps, rung) {
  const text = String(reason || "").trim() ? String(reason).trim() : SHRUG;
  const noun = Number(keeps) === 1 ? "keep" : "keeps";
  return `${text} · stayed ${rungPrep(rung)} ${rung} after ${Number(keeps)} ${noun}`;
}

function stepBody(from, to, keeps) {
  const after = `after ${Number(keeps)} ${Number(keeps) === 1 ? "keep" : "keeps"}`;
  if (from === to) return `${LEAF} rolled again at ${from} · ${after}`;
  return `${LEAF} ${from} → ${to} · ${after}`;
}

function dropBody(from, keeps) {
  return `${LEAF} ${from} → dropped · after ${Number(keeps)} ${Number(keeps) === 1 ? "keep" : "keeps"}`;
}

function logBullet(date, body) {
  return `\t\t- *${date}* — ${body}`;
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
    "    decay:",
    "      rolls: 2",
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

function field(name, value) {
  return `[${name}:: ${value}]`;
}

function taskLine(options) {
  const status = options.status == null ? " " : String(options.status);
  const parts = [`- [${status}] #task ${options.description}`];
  if (options.fresh) parts.push(field("fresh", options.fresh));
  if (options.refresh) parts.push(field("refresh", options.refresh));
  if (options.keeps != null) parts.push(field("keeps", options.keeps));
  if (options.priority) parts.push(field("priority", options.priority));
  if (options.scheduled) parts.push(field("scheduled", options.scheduled));
  if (options.cancelled) parts.push(field("cancelled", options.cancelled));
  if (options.created) parts.push(field("created", options.created));
  if (options.id) parts.push(field("id", options.id));
  return parts.join(" ");
}

function seedNote(dates) {
  const d = dates || fixtureDates();
  return [
    "# Decay ladder e2e",
    "",
    taskLine({
      status: "/",
      description: TASKS.wip.description,
      fresh: d.initialFresh,
      created: TASKS.wip.created,
      id: TASKS.wip.id,
    }),
    taskLine({
      status: "*",
      description: TASKS.next.description,
      fresh: d.initialFresh,
      created: TASKS.next.created,
      id: TASKS.next.id,
    }),
    taskLine({
      status: " ",
      description: TASKS.ready.description,
      fresh: d.initialFresh,
      created: TASKS.ready.created,
      id: TASKS.ready.id,
    }),
    taskLine({
      status: " ",
      description: TASKS.p4.description,
      fresh: d.initialFresh,
      priority: "lowest",
      scheduled: TASKS.p4.scheduled,
      created: TASKS.p4.created,
      id: TASKS.p4.id,
    }),
    taskLine({
      status: " ",
      description: TASKS.skipA.description,
      fresh: d.initialFresh,
      keeps: 2,
      created: TASKS.skipA.created,
      id: TASKS.skipA.id,
    }),
    taskLine({
      status: " ",
      description: TASKS.skipB.description,
      fresh: d.initialFresh,
      keeps: 2,
      created: TASKS.skipB.created,
      id: TASKS.skipB.id,
    }),
    "",
  ].join("\n");
}

function notePath() {
  return "ladder.md";
}

function extractTaskLine(content, description) {
  const needle = `#task ${description}`;
  const lines = String(content || "").split(/\r?\n/);
  return lines.find((line) => line.includes(needle)) || "";
}

function extractRottenLogBodies(content, description) {
  const lines = String(content || "").split(/\r?\n/);
  const start = lines.findIndex((line) => line.includes(`#task ${description}`));
  if (start < 0) return [];
  const bodies = [];
  let inLog = false;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^[-*+] |\t- /.test(line) === false && line.trim() !== "") break;
    if (/^- \[[^\]]\] /.test(line)) break;
    if (line.includes(ROTTEN_MARKER)) {
      inLog = true;
      continue;
    }
    if (!inLog) {
      if (/^\t- /.test(line) && !/^\t\t/.test(line) && !line.includes(ROTTEN_MARKER)) {
        if (/WORK LOG|SCHEDULE LOG|CANCEL LOG/.test(line)) continue;
        break;
      }
      continue;
    }
    const match = /^\t\t- \*(\d{4}-\d{2}-\d{2})\* — (.+)$/.exec(line);
    if (match) {
      bodies.push({ date: match[1], body: match[2] });
      continue;
    }
    if (/^\t- /.test(line) && !/^\t\t/.test(line)) break;
    if (/^- \[[^\]]\] /.test(line)) break;
  }
  return bodies;
}

function parseTaskLine(line) {
  const text = String(line || "");
  const box = text.match(/^- \[([^\]]*)\] #task /);
  const fieldValue = (name) => {
    const match = new RegExp(`\\[${name}::\\s*([^\\]]*)\\]`).exec(text);
    return match ? match[1].trim() : null;
  };
  return {
    raw: text,
    status: box ? box[1] : null,
    fresh: fieldValue("fresh"),
    refresh: fieldValue("refresh"),
    keeps: fieldValue("keeps"),
    priority: fieldValue("priority"),
    scheduled: fieldValue("scheduled"),
    cancelled: fieldValue("cancelled"),
    id: fieldValue("id"),
    created: fieldValue("created"),
    hasWorkLog: /WORK LOG/.test(text),
  };
}

function assertNoWorkLog(content) {
  if (/\*\*WORK LOG\*\*/.test(String(content || ""))) {
    return { ok: false, reason: "Work Log marker present" };
  }
  return { ok: true };
}

function assertTaskFields(line, expected) {
  const got = parseTaskLine(line);
  const checks = [];
  const eq = (label, want) => {
    if (want === undefined) return;
    const value = got[label];
    if (value !== want) checks.push(`${label}=${JSON.stringify(value)} want=${JSON.stringify(want)}`);
  };
  eq("status", expected.status);
  eq("fresh", expected.fresh);
  eq("keeps", expected.keeps === undefined ? undefined : expected.keeps == null ? null : String(expected.keeps));
  eq("priority", expected.priority);
  eq("cancelled", expected.cancelled);
  eq("id", expected.id);
  if (expected.scheduled === null && got.scheduled) {
    checks.push(`scheduled=${JSON.stringify(got.scheduled)} want absent`);
  } else if (typeof expected.scheduled === "string") {
    eq("scheduled", expected.scheduled);
  } else if (expected.scheduledWindow) {
    const day = parseDay(got.scheduled);
    if (!day) {
      checks.push(`scheduled missing, want window ${expected.scheduledWindow.min}-${expected.scheduledWindow.max}`);
    } else {
      const base = parseDay(expected.scheduledWindow.from);
      const offset = Math.round((day - base) / 86400000);
      if (offset < expected.scheduledWindow.min || offset > expected.scheduledWindow.max) {
        checks.push(`scheduled offset ${offset} outside ${expected.scheduledWindow.min}-${expected.scheduledWindow.max}`);
      }
    }
  }
  if (expected.noKeeps === true && got.keeps != null) {
    checks.push(`keeps=${JSON.stringify(got.keeps)} want absent`);
  }
  if (checks.length) return { ok: false, reason: checks.join("; "), got };
  return { ok: true, got };
}

function assertLogBodies(content, description, expected) {
  const got = extractRottenLogBodies(content, description);
  if (got.length !== expected.length) {
    return {
      ok: false,
      reason: `log count ${got.length} want ${expected.length}`,
      got,
      expected,
    };
  }
  for (let index = 0; index < expected.length; index += 1) {
    const want = expected[index];
    const row = got[index];
    if (want.date && row.date !== want.date) {
      return { ok: false, reason: `log[${index}] date ${row.date} want ${want.date}`, got, expected };
    }
    if (row.body !== want.body) {
      return { ok: false, reason: `log[${index}] ${JSON.stringify(row.body)} want ${JSON.stringify(want.body)}`, got, expected };
    }
  }
  return { ok: true, got };
}

function assertCardProbe(probe, expected) {
  if (!probe || probe.open !== true) {
    return { ok: false, reason: "card is not open", probe };
  }
  const missing = [];
  if (expected.title && String(probe.title || "") !== expected.title) {
    missing.push(`title=${JSON.stringify(probe.title)} want=${JSON.stringify(expected.title)}`);
  }
  if (expected.stepLabel) {
    const step = (probe.rows || []).find((row) => row && row.action === "step");
    if (!step || step.label !== expected.stepLabel) {
      missing.push(`step=${JSON.stringify(step && step.label)} want=${JSON.stringify(expected.stepLabel)}`);
    }
    if (step && step.recommended !== true) {
      missing.push("step is not recommended");
    }
  }
  if (expected.stayPresent !== false) {
    const stay = (probe.rows || []).find((row) => row && row.action === "stay");
    if (!stay) missing.push("stay row missing");
  }
  if (expected.dropPresent !== false) {
    const drop = (probe.rows || []).find((row) => row && row.action === "drop");
    if (!drop) missing.push("drop row missing");
  }
  if (expected.omitLevels === true) {
    const levels = (probe.rows || []).filter((row) => row && String(row.action || "").startsWith("level:"));
    if (levels.length) missing.push(`unexpected level rows ${levels.length}`);
  }
  if (missing.length) return { ok: false, reason: missing.join("; "), probe };
  return { ok: true, probe };
}

function skipNotice(count) {
  const n = Number(count);
  return n === 1 ? "1 needs a decision" : `${n} need a decision`;
}

function assertSkipNotice(text, count) {
  const needle = skipNotice(count);
  if (!String(text || "").includes(needle)) {
    return { ok: false, reason: `notice ${JSON.stringify(text)} missing ${JSON.stringify(needle)}` };
  }
  return { ok: true };
}

function inP1Window(scheduled, fromDate) {
  const day = parseDay(scheduled);
  const base = parseDay(fromDate);
  if (!day || !base) return false;
  const offset = Math.round((day - base) / 86400000);
  return offset >= 3 && offset <= 8;
}

function inP4Window(scheduled, fromDate) {
  const day = parseDay(scheduled);
  const base = parseDay(fromDate);
  if (!day || !base) return false;
  const offset = Math.round((day - base) / 86400000);
  return offset >= 101 && offset <= 365;
}

module.exports = {
  SHRUG,
  LEAF,
  ROTTEN_MARKER,
  TASKS,
  CARD_TITLES,
  CARD_STEP_LABELS,
  scratchRoot,
  makeScratch,
  fmtDate,
  addDays,
  parseDay,
  fixtureDates,
  rungPrep,
  keptBody,
  stayBody,
  stepBody,
  dropBody,
  logBullet,
  configYaml,
  taskLine,
  seedNote,
  notePath,
  extractTaskLine,
  extractRottenLogBodies,
  parseTaskLine,
  assertNoWorkLog,
  assertTaskFields,
  assertLogBodies,
  assertCardProbe,
  skipNotice,
  assertSkipNotice,
  inP1Window,
  inP4Window,
};
