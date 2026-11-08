const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    class EmptyClass {}
    return {
      MarkdownRenderChild: EmptyClass,
      MarkdownView: EmptyClass,
      Notice: EmptyClass,
      Plugin: EmptyClass,
      normalizePath: (value) => value,
      parseYaml: () => ({}),
    };
  }
  if (request === "@codemirror/state") {
    return { Prec: { highest: (value) => value } };
  }
  if (request === "@codemirror/view") {
    return {
      EditorView: class EditorView {},
      keymap: { of: (value) => value },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers } = LedgerToolsPlugin;
Module._load = originalLoad;

const fixture = JSON.parse(
  fs.readFileSync(
    path.join(
      __dirname,
      "../plugins/bob-ledger-tools/scripts/fixtures/meet_event_run/vectors.json",
    ),
    "utf8",
  ),
);

const DAILY_PATH = "2026/20261101.md";

function parseNow(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(text);
  assert.ok(match, `bad clock ${text}`);
  const [, year, month, day, hour, minute, second] = match.map(Number);
  return new Date(year, month - 1, day, hour, minute, second);
}

function vectorFrontmatter(source) {
  const match = /^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/.exec(String(source || ""));
  if (!match) return {};
  const frontmatter = {};
  for (const line of match[1].split("\n")) {
    const field = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!field) continue;
    let value = field[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else if (value.toLowerCase() === "true") {
      value = true;
    } else if (value.toLowerCase() === "false") {
      value = false;
    }
    frontmatter[field[1]] = value;
  }
  return frontmatter;
}

function clockResolverFor(vector) {
  const sources = new Map(Object.entries(vector.notes || {}));
  sources.set(DAILY_PATH, vector.day);
  const files = new Map([...sources.keys()].map((path) => [path, { path }]));
  const resolve = (target) => {
    const name = String(target || "").replace(/\.md$/i, "");
    const exact = `${name}.md`;
    if (files.has(exact)) return files.get(exact);
    const basename = name.split("/").pop().toLowerCase();
    return [...files.values()].find((file) => file.path.split("/").pop().replace(/\.md$/i, "").toLowerCase() === basename) || null;
  };
  const vault = { getAbstractFileByPath: (path) => files.get(path) || null };
  const metadataCache = {
    getFileCache: (file) => ({ frontmatter: vectorFrontmatter(sources.get(file.path)) }),
    getFirstLinkpathDest: (target) => resolve(target),
  };
  return (link, line) => {
    const file = link && link.pathPart ? resolve(link.pathPart) : files.get(DAILY_PATH);
    if (!file) return null;
    return helpers.taskEffectiveClockResolution(file.path, line, metadataCache, vault);
  };
}

// Vectors whose gesture has no Obsidian counterpart, with the reason.
const CAPTURE_ONLY = {
  "drop-removes-an-event-from-the-run": "`~K` drops are capture grammar; Obsidian edits the lineup by hand",
  "kept-swap-into-off-clock-meet-moves-key": "kept-ledger swaps are capture-only; se<X> never swaps sessions",
  "kept-swap-out-of-off-clock-meet-restores-worked-key": "kept-ledger swaps are capture-only; se<X> never swaps sessions",
};

// The line the capture token starts, and the `se<X>` gesture that mirrors it.
function gestureFor(vector) {
  const lines = vector.day.split("\n");
  const sectionStart = lines.findIndex((line) => /^## Pomodoros\s*$/.test(line));
  const entries = [];
  for (let index = sectionStart + 1; index < lines.length; index += 1) {
    if (/^- \[ \]/.test(lines[index])) entries.push(index);
  }
  let target;
  if (/meet/i.test(vector.token)) {
    target = entries.find((index) => /— MEET\s*$/.test(lines[index]));
  } else {
    target =
      entries.find((index) => /^- \[ \] \(\)/.test(lines[index])) ?? entries[0];
    // An unnamed later start can join a meeting the plain `=` would not: when
    // bob-cli wrote the MEET row, mirror the `se<X>` gesture on that row.
    const meetIndex = entries.find((index) => /— MEET\s*$/.test(lines[index]));
    if (meetIndex !== undefined && meetIndex !== target) {
      const expectedMeet = String(vector.expected_day || "")
        .split("\n")
        .find((item) => item.endsWith("— MEET"));
      if (expectedMeet && expectedMeet !== lines[meetIndex]) target = meetIndex;
    }
  }
  assert.notEqual(target, undefined, `${vector.id}: no target entry`);
  const suffix = /^=(\d*(?:[-+]\d*)?)/.exec(vector.token);
  return { lines, target, trigger: `se${suffix ? suffix[1] : ""}` };
}

function applyGesture(vector) {
  const { lines, target, trigger } = gestureFor(vector);
  const typed = lines[target].replace(/\([^)]*\)/, `(${trigger})`);
  const cursorCh = typed.indexOf(`(${trigger})`) + 1 + trigger.length;
  const document = lines.slice();
  document[target] = typed;
  const now = parseNow(vector.now);
  const expansion = helpers.findExpansion(typed, cursorCh, now);
  assert.ok(expansion, `${vector.id}: no expansion`);
  const adjusted = helpers.applyEventRunToExpansion(document, target, expansion, now, {
    resolveClock: clockResolverFor(vector),
  });
  const line =
    typed.slice(0, adjusted.expansion.fromCh) +
    adjusted.expansion.replacement +
    typed.slice(adjusted.expansion.toCh);
  return { adjusted, line, target, lines };
}

for (const vector of fixture.cases) {
  if (CAPTURE_ONLY[vector.id]) {
    test(`shared vector (capture-only): ${vector.id}`, () => {
      assert.ok(CAPTURE_ONLY[vector.id].length > 0);
    });
    continue;
  }
  test(`shared vector: ${vector.id}`, () => {
    const { adjusted, line, target } = applyGesture(vector);
    const expectedDay = vector.expected_day.split("\n");
    const name = /— ([A-Z]+)\s*$/.exec(vector.day.split("\n")[target])[1];
    const expectedLine = expectedDay.find((item) => item.endsWith(`— ${name}`));
    assert.equal(line, expectedLine);
    assert.ok(line.includes(`**${vector.expected_span}**`), "expected span");
    assert.equal(/\[off::/.test(line), vector.expected_off_clock);
    assert.equal(/\[t::/.test(line), !vector.expected_off_clock);
    assert.equal(adjusted.offClock, vector.expected_off_clock);
    const codes = adjusted.notices.map((notice) => notice.code);
    if (vector.expected_warning) {
      assert.ok(codes.includes(vector.expected_warning), `${codes} lacks warning`);
    } else {
      assert.deepEqual(codes, []);
    }
    if (vector.expected_source) {
      assert.equal(adjusted.eventRun.source, vector.expected_source);
    } else if (name === "MEET") {
      assert.equal(adjusted.eventRun, null);
    }
  });
}

test("every vector is either mirrored or listed as capture-only", () => {
  const ids = fixture.cases.map((item) => item.id);
  for (const id of Object.keys(CAPTURE_ONLY)) assert.ok(ids.includes(id), id);
});

test("off-clock tag detection mirrors bob's Rust rules for every spelling", () => {
  const tag = helpers.eventTaskOffClockTagRange;
  assert.deepEqual(tag("- [*] #task **1200-1300** Lunch #untracked [root:: love]"), {
    start: 32,
    end: 42,
  });
  assert.deepEqual(tag("- [*] #task **1200-1300** Lunch #offclock [root:: love]"), {
    start: 32,
    end: 41,
  });
  assert.deepEqual(tag("- [*] #task **1200-1300** Lunch #Off-Clock)"), { start: 32, end: 42 });
  assert.deepEqual(tag("- [*] #task **1200-1300** Lunch #off"), { start: 32, end: 36 });
  assert.equal(helpers.eventTaskLineIsOffClock("- [*] #task **1200-1300** Lunch #on #off"), false);
  assert.ok(helpers.eventTaskLineIsOffClock("- [*] #task **1200-1300** Lunch #UNTRACKED."));
  assert.ok(helpers.eventTaskLineIsOffClock("- [*] #task **1200-1300** Lunch #OFFCLOCK."));
  assert.ok(helpers.eventTaskLineIsOffClock("- [*] #task **1200-1300** #offclock Lunch"));
  assert.ok(!helpers.eventTaskLineIsOffClock("- [*] #task **1200-1300** `#untracked` in code"));
  assert.ok(!helpers.eventTaskLineIsOffClock("- [*] #task **1200-1300** [see #offclock](https://example.com)"));
  assert.ok(!helpers.eventTaskLineIsOffClock("- [*] #task **1200-1300** lunch#untracked glued"));
  assert.ok(!helpers.eventTaskLineIsOffClock("- [*] #task **1200-1300** #untrackedly"));
  assert.ok(!helpers.eventTaskLineIsOffClock("- [*] #task **1200-1300** Lunch #offclock/nested"));
  assert.ok(!helpers.eventTaskLineIsOffClock("- [*] #task **1200-1300** Lunch #off-clocked"));
});

test("clean titles strip every off-clock spelling and its sentence punctuation", () => {
  for (const tag of ["#offclock", "#OFF-CLOCK.", "#untracked!"]) {
    assert.equal(helpers.eventRunCleanTitle(` Lunch ${tag}`), "Lunch");
  }
  assert.equal(helpers.eventRunCleanTitle(" Lunch #offclock [buffer:: +15m] ^lunch"), "Lunch");
  assert.equal(helpers.eventRunCleanTitle(" Plan#offclock"), "Plan#offclock");
});

test("Event rows carry status, clock, ids, and clean titles", () => {
  const rows = helpers.eventRunEventRows([
    "## Events",
    "- [ ] #task **1200-1300** Lunch with Kelly [📅](https://x.test/e) #untracked [root:: love] [type:: MEET] ^lunch",
    "- [x] #task **1300-1330** Done ^done",
    "- **1400-1430** context row",
    "```",
    "- [ ] #task **1500-1530** fenced ^fenced",
    "```",
    "## Pomodoros",
    "- [ ] #task **1600-1630** outside ^outside",
  ]);
  assert.deepEqual(
    rows.map((row) => [row.title, row.open, row.offClock, row.blockId, row.timeRange]),
    [
      ["Lunch with Kelly", true, true, "lunch", "1200-1300"],
      ["Done", false, false, "done", "1300-1330"],
    ],
  );
});

test("N\\p and N\\P keep the row's key; a bare span is stamped [off::]; a conflict resolves to [t::]", () => {
  const offClock = "- [ ] (**1200-1300** [off:: 60m]) — MEET";
  assert.equal(helpers.changePomodoroLineUnits(offClock, 2), "- [ ] (**1200-1310** [off:: 70m]) — MEET");
  assert.equal(helpers.changePomodoroLineUnits(offClock, -3), "- [ ] (**1200-1245** [off:: 45m]) — MEET");
  const bare = "- [ ] (**1200-1300**) — MEET";
  assert.equal(helpers.changePomodoroLineUnits(bare, 2), "- [ ] (**1200-1310** [off:: 70m]) — MEET");
  assert.equal(helpers.changePomodoroLineUnits(bare, -3), "- [ ] (**1200-1245** [off:: 45m]) — MEET");
  const withOther = "- [ ] (**1200-1300** [foo:: 1]) — MEET";
  assert.equal(helpers.changePomodoroLineUnits(withOther, 1), "- [ ] (**1200-1305** [off:: 65m] [foo:: 1]) — MEET");
  const tracked = "- [ ] (**1200-1225** [t:: 25m]) — BOB";
  assert.equal(helpers.changePomodoroLineUnits(tracked, 1), "- [ ] (**1200-1230** [t:: 30m]) — BOB");
  const keysUpper = "- [ ] (**1200-1225** [OFF:: 25m] [foo:: 1]) — BOB";
  assert.equal(helpers.changePomodoroLineUnits(keysUpper, 1), "- [ ] (**1200-1230** [off:: 30m] [foo:: 1]) — BOB");
  const conflict = "- [ ] (**1200-1225** [t:: 25m] [off:: 40m]) — BOB";
  assert.equal(helpers.changePomodoroLineUnits(conflict, 1), "- [ ] (**1200-1230** [t:: 30m]) — BOB");
  const hours = "- [ ] (**1200-1330** [off:: 1h 30m]) — BOB";
  assert.equal(helpers.changePomodoroLineUnits(hours, 1), "- [ ] (**1200-1335** [off:: 95m]) — BOB");
});

test("N\\o and N\\O keep every key and field byte-for-byte", () => {
  const bare = "- [ ] (**1200-1300**) — MEET";
  assert.equal(helpers.offsetPomodoroLineRange(bare, 10), "- [ ] (**1210-1310**) — MEET");
  assert.equal(helpers.offsetPomodoroLineRange(bare, -10), "- [ ] (**1150-1250**) — MEET");
  const offClock = "- [ ] (**1200-1300** [off:: 60m] [foo:: 1]) — MEET";
  assert.equal(helpers.offsetPomodoroLineRange(offClock, 10), "- [ ] (**1210-1310** [off:: 60m] [foo:: 1]) — MEET");
  assert.equal(helpers.offsetPomodoroLineRange(offClock, -10), "- [ ] (**1150-1250** [off:: 60m] [foo:: 1]) — MEET");
  const worked = "- [ ] (**1200-1225** [t:: 25m]) — BOB";
  assert.equal(helpers.offsetPomodoroLineRange(worked, 10), "- [ ] (**1210-1235** [t:: 25m]) — BOB");
});

test("pomodoroSessionClock reads all five row shapes like Rust session_clock", () => {
  const clock = (line) => helpers.pomodoroSessionClock(line);
  assert.deepEqual(clock("- [x] (**1030-1055** [t:: 25m]) — BUILD"), { kind: "worked", minutes: 25, stamped: true, conflict: false });
  assert.deepEqual(clock("- [x] (**1030-1055** [T:: 1h 30m]) — BUILD"), { kind: "worked", minutes: 90, stamped: true, conflict: false });
  assert.deepEqual(clock("- [x] (**1030-1055** \u23f1 20m) — BUILD"), { kind: "worked", minutes: 20, stamped: true, conflict: false });
  assert.deepEqual(clock("- [x] (**1200-1300** [off:: 42m]) — MEET"), { kind: "off-clock", minutes: 42, stamped: true, conflict: false });
  assert.deepEqual(clock("- [x] (**1200-1300** [OFF:: 1h 30m]) — MEET"), { kind: "off-clock", minutes: 90, stamped: true, conflict: false });
  assert.deepEqual(clock("- [x] (**1200-1300**) — MEET"), { kind: "off-clock", minutes: 60, stamped: false, conflict: false });
  assert.deepEqual(clock("- [x] (**2330-0030**) — MEET"), { kind: "off-clock", minutes: 60, stamped: false, conflict: false });
  assert.deepEqual(clock("- [x] (**1200-1300** [t:: 25m] [off:: 42m]) — MEET"), { kind: "worked", minutes: 25, stamped: true, conflict: true });
  assert.deepEqual(clock("- [ ] () — MEET"), { kind: "placeholder", minutes: null, stamped: false, conflict: false });
  // A key without a readable number counts the span.
  assert.deepEqual(clock("- [x] (**1200-1300** [off:: soon]) — MEET"), { kind: "off-clock", minutes: 60, stamped: true, conflict: false });
});

test("setPomodoroLineClock moves the recorded minutes between keys like Rust set_ledger_clock", () => {
  const set = helpers.setPomodoroLineClock;
  assert.equal(set("- [x] (**1200-1300** [t:: 60m]) — MEET", "off-clock"), "- [x] (**1200-1300** [off:: 60m]) — MEET");
  assert.equal(set("- [x] (**1200-1300** [off:: 45m] [foo:: 1]) — MEET", "worked"), "- [x] (**1200-1300** [t:: 45m] [foo:: 1]) — MEET");
  assert.equal(set("- [x] (**0800-0900**) — WALK", "off-clock"), "- [x] (**0800-0900** [off:: 60m]) — WALK");
  assert.equal(set("- [x] (**0800-0900**) — WALK", "worked"), "- [x] (**0800-0900** [t:: 60m]) — WALK");
  assert.equal(set("- [x] (**0800-0900** [t:: 60m] [off:: 30m]) — WALK", "off-clock"), "- [x] (**0800-0900** [off:: 60m]) — WALK");
  assert.equal(set("- [x] (**0800-0900** [t:: 60m] [off:: 30m]) — WALK", "worked"), "- [x] (**0800-0900** [t:: 60m]) — WALK");
  assert.equal(set("- [x] (**0800-0900** \u23f1 20m) — WALK", "off-clock"), "- [x] (**0800-0900** [off:: 20m]) — WALK");
  // Already on the target clock, or untimed: untouched.
  assert.equal(set("- [x] (**0800-0900** [t:: 25m]) — WALK", "worked"), "- [x] (**0800-0900** [t:: 25m]) — WALK");
  assert.equal(set("- [x] (**0800-0900** [off:: 25m]) — WALK", "off-clock"), "- [x] (**0800-0900** [off:: 25m]) — WALK");
  assert.equal(set("- [ ] () — WALK", "off-clock"), "- [ ] () — WALK");
});

const WARN_DAY = [
  "## Events",
  "- [ ] #task **1200-1230** Standup ^standup",
  "- [x] #task **1245-1300** Done thing ^done",
  "- [ ] #task **1330-1400** Own ^own",
  "",
  "## Pomodoros",
  "- [ ] (**1150-1215** [t:: 25m]) — BOB",
  "  - [[#^own]]",
  "- [ ] (**1150-1215**) — MEET",
];

test("a non-MEET se<X> start warns when it newly crosses an open event", () => {
  const lines = WARN_DAY.slice();
  lines[6] = "- [ ] (se) — BOB";
  const now = new Date(2026, 10, 1, 11, 47, 0);
  const expansion = helpers.findExpansion(lines[6], "- [ ] (se".length, now);
  const adjusted = helpers.applyEventRunToExpansion(lines, 6, expansion, now);
  assert.equal(adjusted.expansion.replacement.includes("[t::"), true);
  assert.deepEqual(adjusted.notices, [
    {
      code: "pomodoro_runs_past_event",
      message: "⚠ BOB 1150-1215 runs 15m into Standup (1200-1230) · se2 ends at 1200",
    },
  ]);
});

test("a counted start that fits ends before the event and stays silent", () => {
  const lines = WARN_DAY.slice();
  lines[6] = "- [ ] (se2) — BOB";
  const now = new Date(2026, 10, 1, 11, 47, 0);
  const expansion = helpers.findExpansion(lines[6], "- [ ] (se2".length, now);
  const adjusted = helpers.applyEventRunToExpansion(lines, 6, expansion, now);
  assert.deepEqual(adjusted.notices, []);
});

test("a start with no fitting count omits the fit draft", () => {
  const lines = WARN_DAY.slice();
  lines[6] = "- [ ] (se) — BOB";
  const now = new Date(2026, 10, 1, 11, 58, 0);
  const expansion = helpers.findExpansion(lines[6], "- [ ] (se".length, now);
  const adjusted = helpers.applyEventRunToExpansion(lines, 6, expansion, now);
  assert.equal(adjusted.notices.length, 1);
  assert.equal(adjusted.notices[0].message.includes("·"), false);
  assert.match(adjusted.notices[0].message, /^⚠ BOB 1200-1225 runs 25m into Standup \(1200-1230\)$/);
});

test("MEET sessions, own-lineup events, and done events never warn", () => {
  const meet = WARN_DAY.slice();
  meet[8] = "- [ ] (se) — MEET";
  const now = new Date(2026, 10, 1, 11, 47, 0);
  const meetExpansion = helpers.findExpansion(meet[8], "- [ ] (se".length, now);
  assert.deepEqual(helpers.applyEventRunToExpansion(meet, 8, meetExpansion, now).notices, []);

  const own = WARN_DAY.slice();
  own[6] = "- [ ] (se60) — BOB";
  const late = new Date(2026, 10, 1, 13, 7, 0);
  const ownExpansion = helpers.findExpansion(own[6], "- [ ] (se60".length, late);
  assert.deepEqual(helpers.applyEventRunToExpansion(own, 6, ownExpansion, late).notices, []);
  // 1310-1410 crosses the own-lineup event at 1330 and nothing else.
});

test("\\p and \\o warn on new crossings only; \\P never warns", () => {
  const lines = WARN_DAY.slice();
  lines[6] = "- [ ] (**1135-1145** [t:: 10m]) — BOB";
  const old = helpers.parseTimeRange(lines[6]);
  const extended = helpers.changePomodoroLineUnits(lines[6], 4);
  assert.equal(
    helpers.eventRunRewriteNotice(lines, 6, "extend", old, helpers.parseTimeRange(extended)).message,
    "⚠ BOB 1135-1205 runs 5m into Standup (1200-1230) · 3\\p ends at 1200",
  );
  // The span already crossed the event: a further extension is silent.
  const crossed = "- [ ] (**1135-1205** [t:: 30m]) — BOB";
  const crossedLines = lines.slice();
  crossedLines[6] = crossed;
  const further = helpers.changePomodoroLineUnits(crossed, 1);
  assert.equal(
    helpers.eventRunRewriteNotice(
      crossedLines,
      6,
      "extend",
      helpers.parseTimeRange(crossed),
      helpers.parseTimeRange(further),
    ),
    null,
  );
  const shifted = helpers.offsetPomodoroLineRange(lines[6], 25);
  assert.equal(
    helpers.eventRunRewriteNotice(lines, 6, "later", old, helpers.parseTimeRange(shifted)).message,
    "⚠ BOB 1200-1210 runs 10m into Standup (1200-1230) · 3\\o ends at 1200",
  );
  const shrunk = helpers.changePomodoroLineUnits(lines[6], -1);
  assert.equal(
    helpers.eventRunRewriteNotice(lines, 6, "shrink", old, helpers.parseTimeRange(shrunk)),
    null,
  );
  const meetLines = lines.slice();
  meetLines[6] = "- [ ] (**1135-1145** [t:: 10m]) — MEET";
  assert.equal(
    helpers.eventRunRewriteNotice(meetLines, 6, "extend", old, helpers.parseTimeRange(extended)),
    null,
  );
});

const bufferFixture = JSON.parse(
  fs.readFileSync(
    path.join(
      __dirname,
      "../plugins/bob-ledger-tools/scripts/fixtures/event_buffer/vectors.json",
    ),
    "utf8",
  ),
);

test("event_buffer row vectors: parse, buffered span, clean title, field, label", () => {
  assert.ok(Array.isArray(bufferFixture.row) && bufferFixture.row.length > 0);
  for (const vector of bufferFixture.row) {
    const rows = helpers.eventRunEventRows(["## Events", vector.line, "## Pomodoros"]);
    assert.equal(rows.length, 1, vector.id);
    const row = rows[0];
    assert.equal(row.title, vector.title, vector.id);
    assert.equal(row.buffer.beforeMin, vector.before, `${vector.id} before`);
    assert.equal(row.buffer.afterMin, vector.after, `${vector.id} after`);
    assert.equal(row.bufferedTimeRange, vector.buffered_span, `${vector.id} span`);
    assert.equal(helpers.eventBufferField(row.buffer), vector.field, `${vector.id} field`);
    assert.equal(helpers.eventBufferLabel(row.buffer), vector.label, `${vector.id} label`);
  }
});

test("event_buffer conflict vectors: shared predicate", () => {
  assert.ok(Array.isArray(bufferFixture.conflict) && bufferFixture.conflict.length > 0);
  for (const vector of bufferFixture.conflict) {
    const lines = ["## Events", ...String(vector.day).replace(/\n$/, "").split("\n"), "## Pomodoros"];
    const rows = helpers.eventRunEventRows(lines);
    const hhmm = (value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(2));
    const span = { start: hhmm(vector.new[0]), end: hhmm(vector.new[1]) };
    const old = vector.old
      ? { start: hhmm(vector.old[0]), end: hhmm(vector.old[1]) }
      : null;
    const crossed = helpers.eventRunNewCrossings(lines, lines.length - 1, span, old, rows);
    if (!vector.crossed) {
      assert.equal(crossed.length, 0, vector.id);
      continue;
    }
    assert.equal(crossed.length, 1, vector.id);
    assert.equal(crossed[0].blockId, vector.crossed, vector.id);
    assert.equal(crossed[0].conflict.overlapMinutes, vector.overlap_minutes, `${vector.id} overlap`);
    assert.equal(crossed[0].conflict.bufferPart, vector.buffer_part, `${vector.id} part`);
    const fit = crossed[0].conflict.fitStartMin;
    if (vector.fit == null) {
      assert.equal(fit, null, `${vector.id} fit`);
    } else {
      const hours = Math.floor(fit / 60);
      const minutes = fit % 60;
      assert.equal(
        `${String(hours).padStart(2, "0")}${String(minutes).padStart(2, "0")}`,
        vector.fit,
        `${vector.id} fit`,
      );
    }
  }
});

test("event_buffer description vectors stay bob-cli's HTML reader", () => {
  assert.ok(Array.isArray(bufferFixture.description) && bufferFixture.description.length > 0);
});

test("a buffered se<X> start warns into the lead-in and fits at the buffered start", () => {
  const lines = [
    "## Events",
    "- [ ] #task **1200-1300** Lunch [buffer:: -30m +15m] ^lunch",
    "",
    "## Pomodoros",
    "- [ ] (se) — BOB",
  ];
  const now = new Date(2026, 10, 1, 11, 10, 0);
  const expansion = helpers.findExpansion(lines[4], "- [ ] (se".length, now);
  const adjusted = helpers.applyEventRunToExpansion(lines, 4, expansion, now);
  assert.deepEqual(adjusted.notices, [
    {
      code: "pomodoro_runs_past_event",
      message: "⚠ BOB 1110-1135 runs 5m into Lunch's −30m buffer (1200-1300) · se4 ends at 1130",
    },
  ]);
});

test("a start that runs through the meeting names the event plus its buffer label", () => {
  const lines = [
    "## Events",
    "- [ ] #task **1200-1300** Lunch [buffer:: -30m +15m] ^lunch",
    "",
    "## Pomodoros",
    "- [ ] (se) — BOB",
  ];
  const now = new Date(2026, 10, 1, 11, 10, 0);
  lines[4] = "- [ ] (se13) — BOB";
  const expansion = helpers.findExpansion(lines[4], "- [ ] (se13".length, now);
  const adjusted = helpers.applyEventRunToExpansion(lines, 4, expansion, now);
  assert.equal(
    adjusted.notices[0].message,
    "⚠ BOB 1110-1215 runs 45m into Lunch (1200-1300 −30m +15m) · se4 ends at 1130",
  );
});

test("a lead-out start names the after buffer and offers no fit", () => {
  const lines = [
    "## Events",
    "- [ ] #task **1200-1300** Lunch [buffer:: +15m] ^lunch",
    "",
    "## Pomodoros",
    "- [ ] (se) — BOB",
  ];
  const now = new Date(2026, 10, 1, 13, 5, 0);
  const expansion = helpers.findExpansion(lines[4], "- [ ] (se".length, now);
  const adjusted = helpers.applyEventRunToExpansion(lines, 4, expansion, now);
  assert.equal(adjusted.notices.length, 1);
  assert.equal(
    adjusted.notices[0].message,
    "⚠ BOB 1305-1330 runs 10m into Lunch's +15m buffer (1200-1300)",
  );
});

test("an Event Task with a typed off-clock tag is painted by the Event scan", () => {
  const scan = helpers.gcalEventsScanMarkdown([
    "## Events",
    "- [*] #task **1200-1300** Lunch #untracked [root:: love] ^lunch",
    "- [*] #task **1400-1430** Standup ^standup",
    "- **1500-1530** Context #untracked",
    "- [*] #task **1600-1630** Gym #offclock ^gym",
    "- [*] #task **1700-1730** Pickup #Off-Clock ^pickup",
  ]);
  assert.deepEqual(
    scan.rows.map((row) => [row.time, row.offClock]),
    [
      ["1200-1300", true],
      ["1400-1430", false],
      ["1500-1530", false],
      ["1600-1630", true],
      ["1700-1730", true],
    ],
  );
  assert.deepEqual(scan.rows[0].offClockTag, { start: 32, end: 42 });
  assert.deepEqual(scan.rows[3].offClockTag, { start: 30, end: 39 });
});

function fakeDoc() {
  const make = (tag) => {
    const attrs = new Map();
    return {
      tag,
      children: [],
      textContent: "",
      setAttribute: (name, value) => attrs.set(name, String(value)),
      getAttribute: (name) => (attrs.has(name) ? attrs.get(name) : null),
      appendChild(child) {
        this.children.push(child);
      },
    };
  };
  return { createElement: make };
}

test("an off-clock session's home chip is dashed, shows its minutes, and says so", () => {
  const model = {
    state: "attributed",
    label: "sase",
    chip: "sase",
    hue: "blue",
    off_clock: true,
    minutes: 90,
    tooltip: "sase · 90m off the clock",
  };
  const chip = helpers.buildPomodoroHomeChipElement(fakeDoc(), model);
  assert.equal(chip.getAttribute("data-home-off-clock"), "true");
  assert.equal(chip.getAttribute("title"), "sase · 90m off the clock");
  assert.equal(chip.getAttribute("aria-label"), "Pomodoro home: sase (off-clock)");
  assert.equal(chip.children.length, 3);
  assert.equal(chip.children[1].textContent, "sase");
  assert.equal(chip.children[2].getAttribute("class"), "bob-pomodoro-home-minutes");
  assert.equal(chip.children[2].textContent, "1h 30m");
  const worked = helpers.buildPomodoroHomeChipElement(fakeDoc(), {
    ...model,
    off_clock: false,
    minutes: undefined,
    tooltip: "sase · 1 task · 25m",
  });
  assert.equal(worked.getAttribute("data-home-off-clock"), null);
  assert.equal(worked.getAttribute("title"), "sase · 1 task · 25m");
  assert.equal(worked.getAttribute("aria-label"), "Pomodoro home: sase");
  assert.equal(worked.children.length, 2);
});

test("Reading view marks the off-clock tag link and dashes the row's time pill", () => {
  const attrs = (initial = {}) => {
    const map = new Map(Object.entries(initial));
    return {
      setAttribute: (name, value) => map.set(name, String(value)),
      getAttribute: (name) => (map.has(name) ? map.get(name) : null),
    };
  };
  const classes = new Set();
  const doc = {
    createElement: () => ({ className: "", textContent: "" }),
    createTextNode: (text) => ({ text }),
  };
  const tagAttrs = attrs();
  const tag = {
    ...tagAttrs,
    textContent: "#Untracked",
    ownerDocument: doc,
    classList: { add: (name) => classes.add(name) },
    children: null,
    replaceChildren(...children) {
      this.children = children;
    },
  };
  const other = {
    ...attrs(),
    textContent: "#task",
    classList: { add: () => assert.fail("only off-clock tags are marked") },
  };
  const row = { querySelectorAll: () => [other, tag] };
  const timeAttrs = attrs();
  const timeEl = { ...timeAttrs };
  const painted = LedgerToolsPlugin.prototype.calendarEventPaintOffClockTag.call({}, row, timeEl);
  assert.equal(painted, true);
  assert.ok(classes.has("bob-calendar-event-off-clock"));
  assert.equal(tag.getAttribute("data-off-clock"), "true");
  assert.equal(tag.getAttribute("title"), "Off-clock · on the calendar, off the clock");
  assert.equal(timeEl.getAttribute("data-off-clock"), "true");
  assert.equal(tag.children[0].className, "bob-calendar-event-off-clock-hash");
  assert.equal(tag.children[0].textContent, "#");
  assert.equal(tag.children[1].text, "Untracked");

  const plainRow = { querySelectorAll: () => [other] };
  assert.equal(
    LedgerToolsPlugin.prototype.calendarEventPaintOffClockTag.call({}, plainRow, { ...attrs() }),
    false,
  );
});

test("Reading view marks every off-clock tag spelling and nothing else", () => {
  const paint = LedgerToolsPlugin.prototype.calendarEventPaintOffClockTag;
  for (const [text, painted] of [
    ["#offclock", true],
    ["#OffClock", true],
    ["#off-clock", true],
    ["#untracked", true],
    ["#off-clocked", false],
    ["#offclock/nested", false],
    ["#task", false],
  ]) {
    const map = new Map();
    const timeMap = new Map();
    const tag = {
      textContent: text,
      ownerDocument: null,
      classList: { add: () => {} },
      setAttribute: (name, value) => map.set(name, String(value)),
      getAttribute: (name) => (map.has(name) ? map.get(name) : null),
    };
    const timeEl = {
      setAttribute: (name, value) => timeMap.set(name, String(value)),
      getAttribute: (name) => (timeMap.has(name) ? timeMap.get(name) : null),
    };
    assert.equal(paint.call({}, { querySelectorAll: () => [tag] }, timeEl), painted, text);
    assert.equal(timeEl.getAttribute("data-off-clock"), painted ? "true" : null, text);
  }
});
