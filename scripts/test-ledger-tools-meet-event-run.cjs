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

function parseNow(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(text);
  assert.ok(match, `bad clock ${text}`);
  const [, year, month, day, hour, minute, second] = match.map(Number);
  return new Date(year, month - 1, day, hour, minute, second);
}

// Vectors whose gesture has no Obsidian counterpart, with the reason.
const CAPTURE_ONLY = {
  "drop-removes-an-event-from-the-run": "`~K` drops are capture grammar; Obsidian edits the lineup by hand",
  "kept-swap-into-untracked-meet-drops-t": "kept-ledger swaps are capture-only; se<X> never swaps sessions",
  "kept-swap-out-of-untracked-meet-restores-t": "kept-ledger swaps are capture-only; se<X> never swaps sessions",
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
  }
  assert.notEqual(target, undefined, `${vector.id}: no target entry`);
  const suffix = /^=(\d+)/.exec(vector.token);
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
  const adjusted = helpers.applyEventRunToExpansion(document, target, expansion, now);
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
    assert.equal(/\[t::/.test(line), vector.expected_tracked);
    assert.equal(adjusted.tracked, vector.expected_tracked);
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

test("#untracked tag detection mirrors bob's Rust rules", () => {
  const tag = helpers.eventTaskUntrackedTagRange;
  assert.deepEqual(tag("- [*] #task **1200-1300** Lunch #untracked [root:: love]"), {
    start: 32,
    end: 42,
  });
  assert.ok(helpers.eventTaskLineIsUntracked("- [*] #task **1200-1300** Lunch #UNTRACKED."));
  assert.ok(!helpers.eventTaskLineIsUntracked("- [*] #task **1200-1300** `#untracked` in code"));
  assert.ok(!helpers.eventTaskLineIsUntracked("- [*] #task **1200-1300** [see #untracked](https://example.com)"));
  assert.ok(!helpers.eventTaskLineIsUntracked("- [*] #task **1200-1300** lunch#untracked glued"));
  assert.ok(!helpers.eventTaskLineIsUntracked("- [*] #task **1200-1300** #untrackedly"));
});

test("Event rows carry status, trackedness, ids, and clean titles", () => {
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
    rows.map((row) => [row.title, row.open, row.untracked, row.blockId, row.timeRange]),
    [
      ["Lunch with Kelly", true, true, "lunch", "1200-1300"],
      ["Done", false, false, "done", "1300-1330"],
    ],
  );
});

test("N\\p and N\\P keep an untracked row untracked; tracked rows keep [t::]", () => {
  const untracked = "- [ ] (**1200-1300**) — MEET";
  assert.equal(helpers.changePomodoroLineUnits(untracked, 2), "- [ ] (**1200-1310**) — MEET");
  assert.equal(helpers.changePomodoroLineUnits(untracked, -3), "- [ ] (**1200-1245**) — MEET");
  const withOther = "- [ ] (**1200-1300** [foo:: 1]) — MEET";
  assert.equal(helpers.changePomodoroLineUnits(withOther, 1), "- [ ] (**1200-1305** [foo:: 1]) — MEET");
  const tracked = "- [ ] (**1200-1225** [t:: 25m]) — BOB";
  assert.equal(helpers.changePomodoroLineUnits(tracked, 1), "- [ ] (**1200-1230** [t:: 30m]) — BOB");
});

test("N\\o and N\\O keep an untracked row untracked", () => {
  const untracked = "- [ ] (**1200-1300**) — MEET";
  assert.equal(helpers.offsetPomodoroLineRange(untracked, 10), "- [ ] (**1210-1310**) — MEET");
  assert.equal(helpers.offsetPomodoroLineRange(untracked, -10), "- [ ] (**1150-1250**) — MEET");
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

test("an Event Task with a typed #untracked tag is painted by the Event scan", () => {
  const scan = helpers.gcalEventsScanMarkdown([
    "## Events",
    "- [*] #task **1200-1300** Lunch #untracked [root:: love] ^lunch",
    "- [*] #task **1400-1430** Standup ^standup",
    "- **1500-1530** Context #untracked",
  ]);
  assert.deepEqual(
    scan.rows.map((row) => [row.time, row.untracked]),
    [
      ["1200-1300", true],
      ["1400-1430", false],
      ["1500-1530", false],
    ],
  );
  assert.deepEqual(scan.rows[0].untrackedTag, { start: 32, end: 42 });
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

test("an untracked session's home chip is dashed and says it is not counted", () => {
  const model = {
    state: "attributed",
    label: "sase",
    chip: "sase",
    hue: "blue",
    untracked: true,
    tooltip: "sase · 1 task · 0m",
  };
  const chip = helpers.buildPomodoroHomeChipElement(fakeDoc(), model);
  assert.equal(chip.getAttribute("data-home-untracked"), "true");
  assert.equal(chip.getAttribute("title"), "untracked · not counted\nsase · 1 task · 0m");
  assert.equal(chip.getAttribute("aria-label"), "Pomodoro home: sase (untracked)");
  const tracked = helpers.buildPomodoroHomeChipElement(fakeDoc(), { ...model, untracked: false });
  assert.equal(tracked.getAttribute("data-home-untracked"), null);
  assert.equal(tracked.getAttribute("title"), "sase · 1 task · 0m");
});

test("Reading view marks the #untracked tag link and dashes the row's time pill", () => {
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
    classList: { add: () => assert.fail("only #untracked is marked") },
  };
  const row = { querySelectorAll: () => [other, tag] };
  const timeAttrs = attrs();
  const timeEl = { ...timeAttrs };
  const painted = LedgerToolsPlugin.prototype.calendarEventPaintUntrackedTag.call({}, row, timeEl);
  assert.equal(painted, true);
  assert.ok(classes.has("bob-calendar-event-untracked"));
  assert.equal(tag.getAttribute("data-untracked"), "true");
  assert.equal(tag.getAttribute("title"), "Untracked · on the calendar, off the clock");
  assert.equal(timeEl.getAttribute("data-untracked"), "true");
  assert.equal(tag.children[0].className, "bob-calendar-event-untracked-hash");
  assert.equal(tag.children[0].textContent, "#");
  assert.equal(tag.children[1].text, "Untracked");

  const plainRow = { querySelectorAll: () => [other] };
  assert.equal(
    LedgerToolsPlugin.prototype.calendarEventPaintUntrackedTag.call({}, plainRow, { ...attrs() }),
    false,
  );
});
