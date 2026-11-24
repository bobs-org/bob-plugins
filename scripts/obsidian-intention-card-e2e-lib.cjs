#!/usr/bin/env node
// Offline fixture, clock, key, and assertion helpers for the real-Obsidian
// intention card proof. Nothing here launches Obsidian or bob.
"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const HELP_TEXT = [
  "Usage: node scripts/obsidian-intention-card-e2e.cjs [OPTIONS]",
  "",
  "Prove the intention card, card editor, navigation, YAML excursion, entry points,",
  "stale drafts, and fail-open behavior in an isolated Obsidian vault with a real bob.",
  "Requires BOB_BIN (debug binary built from BOB_CLI_DIR) and BOB_CLI_DIR.",
  "Run the real walkthrough under xvfb-run -a on Linux.",
  "",
  "Options:",
  "  -e, --executable PATH   Obsidian Electron binary",
  "  -o, --out DIRECTORY    Save PNG screenshots here",
  "  -r, --report PATH      Write the structured JSON report here",
  "  -s, --self-test        Validate fixtures and probes without launching apps",
  "  -h, --help             Print this help",
].join("\n");

// The seven frontmatter keys the card owns; every other Property stays visible.
const OWNED_KEYS = Object.freeze([
  "intentions", "summary", "summary_digest", "summary_drafted",
  "reflection", "review_digest", "review_drafted",
]);

function parseArgs(argv) {
  const args = { executable: null, out: null, report: null, selfTest: false, help: false };
  const input = Array.isArray(argv) ? argv.slice() : [];
  const value = (flag, name, index) => {
    const next = input[index];
    if (!next || next.startsWith("-")) throw new Error(flag + " requires a " + name + " value");
    return next;
  };
  for (let i = 0; i < input.length; i += 1) {
    const flag = input[i];
    if (flag === "-e" || flag === "--executable") args.executable = value("--executable", "PATH", ++i);
    else if (flag === "-o" || flag === "--out") args.out = value("--out", "DIRECTORY", ++i);
    else if (flag === "-r" || flag === "--report") args.report = value("--report", "PATH", ++i);
    else if (flag === "-s" || flag === "--self-test") args.selfTest = true;
    else if (flag === "-h" || flag === "--help") args.help = true;
    else throw new Error("Unknown argument: " + flag);
  }
  return args;
}

// ---- Calendar helpers (independent of the plugin's subject model) ----

function parseDate(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || ""));
  if (!match) throw new Error("bad date " + text);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

function utcOf(text) {
  const { y, m, d } = parseDate(text);
  return Date.UTC(y, m - 1, d);
}

function dateText(ms) {
  const date = new Date(ms);
  return [date.getUTCFullYear(), String(date.getUTCMonth() + 1).padStart(2, "0"), String(date.getUTCDate()).padStart(2, "0")].join("-");
}

function shiftDays(text, delta) {
  return dateText(utcOf(text) + delta * 86_400_000);
}

function localToday(now = new Date()) {
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
}

function isoWeek(text) {
  const ms = utcOf(text);
  const weekday = (new Date(ms).getUTCDay() + 6) % 7; // Monday = 0
  const thursday = ms + (3 - weekday) * 86_400_000;
  const year = new Date(thursday).getUTCFullYear();
  const jan4 = Date.UTC(year, 0, 4);
  const jan4Weekday = (new Date(jan4).getUTCDay() + 6) % 7;
  const week1Monday = jan4 - jan4Weekday * 86_400_000;
  const week = Math.floor((thursday - week1Monday) / (7 * 86_400_000)) + 1;
  return { year, week, monday: dateText(ms - weekday * 86_400_000) };
}

// Bob's quarters are groups of ISO weeks: 1–13, 14–26, 27–39, 40–52/53.
function quarterOfWeek(week) {
  return Math.min(4, Math.ceil(week / 13));
}

function dayPath(text) {
  const { y } = parseDate(text);
  return y + "/" + text.replace(/-/g, "") + ".md";
}

function weekId(text) {
  const { year, week } = isoWeek(text);
  return year + "-W" + String(week).padStart(2, "0");
}

function weekPathOf(id) {
  return id.slice(0, 4) + "/" + id + ".md";
}

function quarterId(text) {
  const { year, week } = isoWeek(text);
  return year + "-Q" + quarterOfWeek(week);
}

function yearId(text) {
  return String(isoWeek(text).year);
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortDayLabel(text) {
  const date = new Date(utcOf(text));
  return WEEKDAYS[date.getUTCDay()] + " " + MONTHS[date.getUTCMonth()] + " " + date.getUTCDate();
}

// bob's period range label (bob-cli periods/labels.rs): `Nov 16 – 22`,
// `Oct 26 – Nov 1`, or `Dec 28, 2026 – Jan 3, 2027`.
function periodRangeLabel(start, end) {
  const a = parseDate(start);
  const b = parseDate(end);
  if (a.y !== b.y) return MONTHS[a.m - 1] + " " + a.d + ", " + a.y + " – " + MONTHS[b.m - 1] + " " + b.d + ", " + b.y;
  if (a.m !== b.m) return MONTHS[a.m - 1] + " " + a.d + " – " + MONTHS[b.m - 1] + " " + b.d;
  return MONTHS[a.m - 1] + " " + a.d + " – " + b.d;
}

// The day card's path-computed title: `Fri, Nov 20, 2026`.
function dayCardTitle(text) {
  const date = new Date(utcOf(text));
  return WEEKDAYS[date.getUTCDay()] + ", " + MONTHS[date.getUTCMonth()] + " " + date.getUTCDate() + ", " + date.getUTCFullYear();
}

function monthDayLabel(text) {
  const date = new Date(utcOf(text));
  return MONTHS[date.getUTCMonth()] + " " + date.getUTCDate();
}

// bob-cli docs/periods.md summary provenance recipe.
function summaryDigest(text) {
  const normalized = String(text).replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/\s+$/, "")).join("\n").trim();
  return "sha256:" + crypto.createHash("sha256").update(normalized, "utf8").digest("hex").slice(0, 16);
}

// ---- Fixtures ----

function yamlString(value) {
  return JSON.stringify(String(value));
}

function dayNote(date, { intentions, summary, summaryDigest: digest, summaryDrafted, reflection, review, extra = [], malformed = null, body = "" } = {}) {
  const previous = shiftDays(date, -1);
  const next = shiftDays(date, 1);
  const week = weekId(date);
  const lines = [
    "---",
    "parent: '[[" + weekPathOf(week).replace(/\.md$/, "") + "]]'",
    'type: "[[day]]"',
    "date: " + date,
    "id: " + date.replace(/-/g, ""),
    "mood: steady",
    "tags:",
    "  - daily",
  ];
  if (Array.isArray(intentions)) {
    lines.push("intentions:");
    for (const item of intentions) lines.push("  - " + yamlString(item));
  }
  if (malformed) lines.push(malformed);
  if (summary !== undefined) lines.push("summary: " + yamlString(summary));
  if (digest) lines.push("summary_digest: " + yamlString(digest));
  if (summaryDrafted) lines.push("summary_drafted: " + summaryDrafted);
  if (reflection !== undefined) {
    lines.push("reflection: |-");
    for (const line of String(reflection).split("\n")) lines.push(line ? "  " + line : "");
  }
  if (review) {
    lines.push("review_digest: " + yamlString(review.digest));
    lines.push("review_drafted: " + review.drafted);
  }
  lines.push(...extra, "---", "");
  lines.push("# " + date + " " + shortDayLabel(date).slice(0, 3), "");
  lines.push("[[" + dayPath(previous).replace(/\.md$/, "") + "|prev]] · [[" + weekPathOf(week).replace(/\.md$/, "") + "|" + week.slice(5) + "]] · [[" + dayPath(next).replace(/\.md$/, "") + "|next]]", "");
  lines.push("- [ ] #task [[gtd_daily]] GTD-ANCHOR-" + date + " [root:: gtd] ^gtd", "");
  lines.push("## Notes", "", "- Body sentinel for " + date + ".", body);
  return lines.join("\n").replace(/\n+$/, "") + "\n";
}

function weekNote(id, monday, { intentions } = {}) {
  const [year, wk] = id.split("-W");
  const number = Number(wk);
  const prevMonday = shiftDays(monday, -7);
  const nextMonday = shiftDays(monday, 7);
  const prevId = weekId(prevMonday);
  const nextId = weekId(nextMonday);
  const quarter = year + "-Q" + quarterOfWeek(number);
  const title = id + " · " + periodRangeLabel(monday, shiftDays(monday, 6));
  const lines = ["---", "parent: \"[[" + year + "/" + quarter + "]]\"", 'type: "[[day]]"', "id: " + id, "date: " + monday, "end: " + shiftDays(monday, 6),
    "aliases:", "  - " + yamlString(title), "tags:", "  - weekly"];
  if (Array.isArray(intentions)) {
    lines.push("intentions:");
    for (const item of intentions) lines.push("  - " + yamlString(item));
  }
  // bob's scaffold H1 (also the first alias), which the period card hides.
  lines.push("---", "", "# " + title, "");
  lines.push("[[" + weekPathOf(prevId).replace(/\.md$/, "") + "|‹ " + prevId.slice(5) + "]] · [[" + year + "/" + quarter + "|↑ " + quarter + "]] · [[" + weekPathOf(nextId).replace(/\.md$/, "") + "|" + nextId.slice(5) + " ›]]", "");
  const days = [];
  for (let i = 0; i < 7; i += 1) {
    const day = shiftDays(monday, i);
    days.push("[[" + dayPath(day).replace(/\.md$/, "") + "|" + shortDayLabel(day) + "]]");
  }
  lines.push(days.join(" · "), "", "```bob-stats-strip", "", "```", "", "## Notes", "", "- Week body sentinel " + id + ".");
  return lines.join("\n") + "\n";
}

// The H1-less 2025 daily shape: a `day::` body line, no H1, no nav line. The
// day card mounts with its path-computed title and hides nothing.
function legacyDayNote(date) {
  const week = weekId(date);
  return [
    "---",
    "parent: '[[" + weekPathOf(week).replace(/\.md$/, "") + "]]'",
    'type: "[[day]]"',
    "date: " + date,
    "tags:",
    "  - daily",
    "---",
    "day::" + date + " " + shortDayLabel(date).slice(0, 3),
    "",
    "Related notes:",
    "- [[" + dayPath(shiftDays(date, -1)).replace(/\.md$/, "") + "]]",
    "- [[" + dayPath(shiftDays(date, 1)).replace(/\.md$/, "") + "]]",
    "- Body sentinel for the legacy daily " + date + ".",
  ].join("\n") + "\n";
}

function quarterNote(id, { intentions } = {}) {
  const year = id.slice(0, 4);
  const lines = ["---", "parent: \"[[" + year + "]]\"", 'type: "[[day]]"', "id: " + id, "tags:", "  - quarterly"];
  if (Array.isArray(intentions)) {
    lines.push("intentions:");
    for (const item of intentions) lines.push("  - " + yamlString(item));
  }
  lines.push("---", "", "# " + id, "", "## Notes", "", "- Quarter body sentinel " + id + ".");
  return lines.join("\n") + "\n";
}

// Every fixture is relative to the run's local date so the plugin's real
// clock and bob's BOB_NOW agree. Boundary fixtures are fixed historical dates.
function fixturePlan(today) {
  parseDate(today);
  const yesterday = shiftDays(today, -1);
  const stamped = shiftDays(today, -2);
  const empty = shiftDays(today, -3);
  const malformed = shiftDays(today, -4);
  const landing = shiftDays(today, -5);
  const tomorrow = shiftDays(today, 1);
  // An empty future day for the set-intentions ghost (tomorrow stays missing).
  const future = shiftDays(today, 3);
  // A fixed, unused past date in the H1-less legacy shape.
  const legacy = "2025-03-01";
  const week = weekId(today);
  const weekMonday = isoWeek(today).monday;
  const quarter = quarterId(today);
  const year = yearId(today);
  const stampedSummary = "Shipped the card display and the guarded editor.";
  const plan = {
    today, yesterday, stamped, empty, malformed, landing, tomorrow, future, legacy, week, weekMonday, quarter, year,
    stampedSummary,
    stampedDigest: summaryDigest(stampedSummary),
    stampedDrafted: shiftDays(today, -1),
    paths: {
      today: dayPath(today), yesterday: dayPath(yesterday), stamped: dayPath(stamped),
      empty: dayPath(empty), malformed: dayPath(malformed), landing: dayPath(landing), tomorrow: dayPath(tomorrow),
      future: dayPath(future), legacy: dayPath(legacy),
      week: weekPathOf(week), quarter: year === quarter.slice(0, 4) ? quarter.slice(0, 4) + "/" + quarter + ".md" : quarter.slice(0, 4) + "/" + quarter + ".md",
      year: year + ".md", embed: "embeds-today.md", ordinary: "ordinary.md",
      boundaryDay: "2026/20260101.md", boundaryPrevDay: "2025/20251231.md",
      boundaryWeek: "2026/2026-W01.md", boundaryPrevWeek: "2025/2025-W52.md",
      boundaryQuarter: "2025/2025-Q4.md", boundaryNextQuarter: "2026/2026-Q1.md",
    },
    intentions: {
      today: ["Ship the intention card", "Walk after lunch"],
      yesterday: ["Draft the acceptance runner"],
      stamped: ["Write the display", "Write the editor", "Write the docs"],
      week: ["Land the card epic"],
      quarter: ["Make reflection a habit"],
      boundaryDay: ["Start the year gently"],
      boundaryWeek: ["Set the yearly rhythm"],
    },
  };
  const notes = {
    "gtd_daily.md": "# GTD daily\n",
    [plan.paths.today]: dayNote(today, { intentions: plan.intentions.today }),
    [plan.paths.yesterday]: dayNote(yesterday, { intentions: plan.intentions.yesterday }),
    [plan.paths.stamped]: dayNote(stamped, {
      intentions: plan.intentions.stamped,
      summary: stampedSummary,
      summaryDigest: plan.stampedDigest,
      summaryDrafted: plan.stampedDrafted,
      reflection: "The display landed cleanly.\n\nThe editor needed two passes.",
      review: { digest: "sha256:00112233445566aa", drafted: plan.stampedDrafted },
    }),
    [plan.paths.empty]: dayNote(empty, {}),
    [plan.paths.malformed]: dayNote(malformed, { malformed: "intentions: 7" }),
    // The landing proof's own empty day: first add, overlay, last remove.
    [plan.paths.landing]: dayNote(landing, {}),
    [plan.paths.future]: dayNote(future, {}),
    [plan.paths.legacy]: legacyDayNote(legacy),
    [plan.paths.week]: weekNote(week, weekMonday, { intentions: plan.intentions.week }),
    [plan.paths.quarter]: quarterNote(quarter, { intentions: plan.intentions.quarter }),
    [plan.paths.embed]: "---\ntype: \"[[note]]\"\n---\n\n# Embeds today\n\n![[" + plan.paths.today.replace(/\.md$/, "") + "]]\n",
    [plan.paths.ordinary]: "---\ntype: \"[[note]]\"\n---\n\n# Ordinary\n\nNothing to see.\n",
    [plan.paths.boundaryDay]: dayNote("2026-01-01", { intentions: plan.intentions.boundaryDay }),
    [plan.paths.boundaryWeek]: weekNote("2026-W01", "2025-12-29", { intentions: plan.intentions.boundaryWeek }),
    [plan.paths.boundaryPrevWeek]: weekNote("2025-W52", "2025-12-22", {}),
    [plan.paths.boundaryQuarter]: quarterNote("2025-Q4", { intentions: ["Close the year"] }),
  };
  const fixed = [plan.paths.boundaryDay, plan.paths.boundaryWeek, plan.paths.boundaryPrevWeek, plan.paths.boundaryQuarter, plan.paths.legacy];
  const relative = [plan.paths.today, plan.paths.yesterday, plan.paths.stamped, plan.paths.empty, plan.paths.malformed, plan.paths.landing,
    plan.paths.future, plan.paths.week, plan.paths.quarter];
  for (const name of relative) {
    if (fixed.includes(name)) throw new Error("today-relative fixture collides with a boundary fixture: " + name);
  }
  for (const missing of [plan.paths.tomorrow, plan.paths.year, plan.paths.boundaryPrevDay, plan.paths.boundaryNextQuarter]) {
    if (notes[missing]) throw new Error("fixture that must stay missing was seeded: " + missing);
  }
  return { plan, notes };
}

// ---- Frontmatter byte boundaries ----

function splitNote(text) {
  const source = String(text);
  if (!source.startsWith("---\n")) return { frontmatter: "", body: source };
  const close = source.indexOf("\n---\n", 3);
  if (close < 0) return { frontmatter: source, body: "" };
  return { frontmatter: source.slice(4, close + 1), body: source.slice(close + 5) };
}

// Top-level YAML blocks keyed by name, preserving each block's exact bytes.
function frontmatterBlocks(text) {
  const blocks = new Map();
  let current = null;
  const frontmatter = splitNote(text).frontmatter;
  for (const line of (frontmatter.endsWith("\n") ? frontmatter.slice(0, -1) : frontmatter).split("\n")) {
    if (!line) { if (current) blocks.set(current, blocks.get(current) + "\n"); continue; }
    const match = /^([A-Za-z_][\w-]*):/.exec(line);
    if (match && !/^\s/.test(line)) {
      current = match[1];
      blocks.set(current, (blocks.get(current) || "") + line + "\n");
    } else if (current) {
      blocks.set(current, blocks.get(current) + line + "\n");
    }
  }
  return blocks;
}

// The body and every unowned top-level key must survive a field write byte for byte.
function assertUnownedBytesKept(before, after, extraBody = null) {
  const a = splitNote(before);
  const b = splitNote(after);
  if (extraBody === null) assert.equal(b.body, a.body, "note body changed");
  else assert.ok(b.body.includes(extraBody), "note body lost " + JSON.stringify(extraBody));
  const blocksA = frontmatterBlocks(before);
  const blocksB = frontmatterBlocks(after);
  for (const [key, bytes] of blocksA) {
    if (OWNED_KEYS.includes(key)) continue;
    assert.equal(blocksB.get(key), bytes, "unowned frontmatter key changed: " + key);
  }
  for (const key of blocksB.keys()) {
    if (!OWNED_KEYS.includes(key)) assert.ok(blocksA.has(key), "unowned frontmatter key appeared: " + key);
  }
}

// ---- Native Properties visibility ----

// A probe row: {key, present, display, visibility, rectVisible, owned}.
function rowHidden(row) {
  return row.display === "none" || row.visibility === "hidden" || row.rectVisible === false;
}

function assertOwnedRows(probe, { hidden, authoredKeys, frontmatterOwned }) {
  assert.ok(probe && Array.isArray(probe.rows), "native Properties probe is missing");
  assert.ok(probe.properties && probe.properties.present === true, "native Properties container is absent");
  if (frontmatterOwned) {
    assert.ok(rowHidden(probe.properties), "native Properties container is visible");
    for (const key of authoredKeys) {
      const rows = probe.rows.filter((row) => row.key === key);
      assert.equal(rows.length, 1, "native Properties key missing or duplicated: " + key);
    }
    return probe.rows.filter((row) => rowHidden(row)).map((row) => row.key).sort();
  }
  assert.ok(!rowHidden(probe.properties), "native Properties container is hidden");
  for (const key of authoredKeys) {
    const rows = probe.rows.filter((row) => row.key === key);
    assert.equal(rows.length, 1, "native Properties key missing or duplicated: " + key);
  }
  const hiddenKeys = [];
  for (const row of probe.rows) {
    const owned = OWNED_KEYS.includes(row.key);
    const isHidden = rowHidden(row);
    if (isHidden) hiddenKeys.push(row.key);
    assert.equal(isHidden, hidden && owned, "native property visibility mismatch: " + row.key + " " + JSON.stringify(row));
  }
  return hiddenKeys.sort();
}

// ---- Keyboard events (CDP Input.dispatchKeyEvent) ----

const KEY_CODES = {
  Enter: [13, "Enter"], Escape: [27, "Escape"], Tab: [9, "Tab"], Backspace: [8, "Backspace"],
  ArrowDown: [40, "ArrowDown"], ArrowUp: [38, "ArrowUp"], End: [35, "End"], Home: [36, "Home"],
  "=": [187, "Equal"], "[": [219, "BracketLeft"], "]": [221, "BracketRight"],
};

// Modifiers bitmask: Alt=1, Ctrl=2, Meta=4, Shift=8.
function keyEvents(key, modifiers = 0) {
  const known = KEY_CODES[key];
  const vk = known ? known[0] : /^\d$/.test(key) ? 48 + Number(key) : key.toUpperCase().charCodeAt(0);
  const code = known ? known[1] : /^[a-z]$/i.test(key) ? "Key" + key.toUpperCase() : /^\d$/.test(key) ? "Digit" + key : key;
  const payload = { key, code, modifiers, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
  const text = modifiers & 7 ? "" : key === "Enter" ? "\r" : key.length === 1 ? key : "";
  return [
    { type: text ? "keyDown" : "rawKeyDown", ...payload, ...(text ? { text, unmodifiedText: text } : {}) },
    { type: "keyUp", ...payload },
  ];
}

// clap's own refusal text from a bob that predates `periods update`.
const OLD_BOB_STDERR = "error: unrecognized subcommand 'update'\n\nUsage: bob periods [OPTIONS] <COMMAND>\n\nFor more information, try '--help'.\n";

function selfTest() {
  assert.equal(weekId("2026-11-20"), "2026-W47");
  assert.equal(weekId("2026-01-01"), "2026-W01");
  assert.equal(weekId("2025-12-31"), "2026-W01");
  assert.equal(weekId("2020-12-31"), "2020-W53");
  assert.equal(quarterId("2026-11-20"), "2026-Q4");
  assert.equal(quarterId("2026-12-31"), "2026-Q4");
  assert.equal(quarterId("2025-12-24"), "2025-Q4");
  assert.equal(yearId("2025-12-31"), "2026");
  assert.equal(dayPath("2025-12-31"), "2025/20251231.md");
  assert.equal(shortDayLabel("2026-11-20"), "Fri Nov 20");
  assert.equal(shiftDays("2026-03-01", -1), "2026-02-28");
  assert.equal(shiftDays("2026-03-08", 1), "2026-03-09");
  assert.match(summaryDigest("a  \r\nb\n"), /^sha256:[0-9a-f]{16}$/);
  assert.equal(summaryDigest("a  \r\nb\n"), summaryDigest("a\nb"));
  const { plan, notes } = fixturePlan("2026-11-20");
  assert.equal(plan.paths.today, "2026/20261120.md");
  assert.equal(plan.paths.week, "2026/2026-W47.md");
  assert.equal(plan.paths.quarter, "2026/2026-Q4.md");
  assert.equal(plan.paths.year, "2026.md");
  assert.ok(notes[plan.paths.today].includes("[[2026/20261119|prev]] · [[2026/2026-W47|W47]] · [[2026/20261121|next]]"));
  assert.ok(notes[plan.paths.stamped].includes("summary_digest: \"" + plan.stampedDigest + "\""));
  for (const key of OWNED_KEYS) assert.ok(notes[plan.paths.stamped].includes("\n" + key + ":"), "stamped fixture lacks " + key);
  assert.ok(notes[plan.paths.malformed].includes("\nintentions: 7\n"));
  assert.ok(!/\nintentions:/.test(notes[plan.paths.empty]));
  assert.ok(!notes[plan.paths.tomorrow] && !notes[plan.paths.year] && !notes[plan.paths.boundaryPrevDay]);
  // Day and period cards: the week carries bob's scaffold H1 and alias, the
  // future day is empty, and the legacy daily has no H1 or nav line.
  assert.equal(periodRangeLabel("2026-11-16", "2026-11-22"), "Nov 16 – 22");
  assert.equal(periodRangeLabel("2026-10-26", "2026-11-01"), "Oct 26 – Nov 1");
  assert.equal(periodRangeLabel("2026-12-28", "2027-01-03"), "Dec 28, 2026 – Jan 3, 2027");
  assert.equal(dayCardTitle("2026-11-20"), "Fri, Nov 20, 2026");
  assert.ok(notes[plan.paths.week].includes("\n# 2026-W47 · Nov 16 – 22\n"));
  assert.ok(notes[plan.paths.week].includes('  - "2026-W47 · Nov 16 – 22"'));
  assert.equal(plan.paths.future, "2026/20261123.md");
  assert.ok(!/\nintentions:/.test(notes[plan.paths.future]));
  assert.equal(plan.paths.legacy, "2025/20250301.md");
  assert.ok(notes[plan.paths.legacy].includes("\nday::2025-03-01 Sat\n"));
  assert.ok(!/\n# /.test(notes[plan.paths.legacy]), "the legacy daily has no H1");
  assert.throws(() => fixturePlan("2025-03-06"), /collides/, "a relative fixture on the legacy date collides");
  assert.ok(notes[plan.paths.embed].includes("![[2026/20261120]]"));
  fixturePlan("2026-06-15");
  assert.throws(() => fixturePlan("2026-01-05"), /collides/);
  // Byte-boundary assertions reject body and unowned-key drift.
  const before = notes[plan.paths.today];
  const rewritten = before.replace('  - "Walk after lunch"\n', '  - "Walk after lunch"\n  - "Third"\n');
  assertUnownedBytesKept(before, rewritten);
  assert.throws(() => assertUnownedBytesKept(before, rewritten.replace("mood: steady", "mood: busy")), /mood/);
  assert.throws(() => assertUnownedBytesKept(before, rewritten.replace("Body sentinel", "Body changed")), /body/);
  assertUnownedBytesKept(before, rewritten.replace("Body sentinel", "Body edit survives. Body sentinel"), "Body edit survives");
  // Native Properties: exactly the owned rows hide while the card is mounted.
  const shown = { present: true, display: "flex", visibility: "visible", rectVisible: true };
  const concealed = { ...shown, display: "none", rectVisible: false };
  const probe = { properties: shown, rows: [{ key: "intentions", ...concealed }, { key: "mood", ...shown }, { key: "summary", ...concealed }] };
  assert.deepEqual(assertOwnedRows(probe, { hidden: true, authoredKeys: ["intentions", "mood", "summary"] }), ["intentions", "summary"]);
  assert.throws(() => assertOwnedRows(probe, { hidden: false, authoredKeys: [] }), /visibility mismatch/);
  assert.throws(() => assertOwnedRows({ ...probe, rows: [{ key: "mood", ...concealed }] }, { hidden: true, authoredKeys: [] }), /mood/);
  assert.throws(() => assertOwnedRows({ ...probe, properties: concealed }, { hidden: true, authoredKeys: [] }), /container is hidden/);
  assert.throws(() => assertOwnedRows(probe, { hidden: true, authoredKeys: ["type"] }), /type/);
  const ownedContainer = { properties: concealed, rows: [{ key: "intentions", ...concealed }, { key: "mood", ...concealed }] };
  assert.deepEqual(assertOwnedRows(ownedContainer, { hidden: true, authoredKeys: ["intentions", "mood"], frontmatterOwned: true }), ["intentions", "mood"]);
  assert.throws(() => assertOwnedRows({ ...ownedContainer, properties: shown }, { hidden: true, authoredKeys: [], frontmatterOwned: true }), /container is visible/);
  // Keys: brackets and modified chords never carry text.
  assert.equal(keyEvents("[")[0].code, "BracketLeft");
  assert.equal(keyEvents("[", 2)[0].type, "rawKeyDown");
  assert.equal(keyEvents("Enter", 8)[0].text, "\r");
  assert.equal(keyEvents("r")[0].text, "r");
  const parsed = parseArgs(["-e", "/opt/obsidian", "-o", "/tmp/shots", "-r", "/tmp/report.json", "--self-test"]);
  assert.ok(parsed.selfTest && parsed.executable === "/opt/obsidian" && parsed.out === "/tmp/shots");
  assert.throws(() => parseArgs(["--report"]), /requires/);
  assert.throws(() => parseArgs(["--bogus"]), /Unknown/);
  assert.match(OLD_BOB_STDERR, /unrecognized subcommand/);
  return true;
}

module.exports = {
  HELP_TEXT, OWNED_KEYS, OLD_BOB_STDERR,
  assertOwnedRows, assertUnownedBytesKept, dayPath, fixturePlan, frontmatterBlocks, isoWeek, keyEvents,
  dayCardTitle, legacyDayNote, localToday, monthDayLabel, parseArgs, periodRangeLabel, quarterId, rowHidden, selfTest, shiftDays, shortDayLabel,
  splitNote, summaryDigest, weekId, yearId,
};
