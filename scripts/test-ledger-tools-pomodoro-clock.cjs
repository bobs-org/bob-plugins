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
      "../plugins/bob-ledger-tools/scripts/fixtures/pomodoro_clock/vectors.json",
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

// Vectors whose gesture has no `se<X>` counterpart: closes belong to
// task-status-cycler (test-task-status-cycler-pomodoro-clock.cjs), the rest
// are capture grammar.
const ELSEWHERE = {
  "close-defers-not-started-off-clock": "Ctrl+Enter close: driven by task-status-cycler",
  "close-mixed-after-dropping-on-clock": "close with a `~K` drop: capture grammar; Obsidian drops by hand",
  "kept-ledger-swap-switches-key": "kept-ledger swaps are capture-only; se<X> never swaps sessions",
  "bare-row-restamped-at-close": "Ctrl+Enter close: driven by task-status-cycler",
  "conflict-row-at-close": "Ctrl+Enter close: driven by task-status-cycler",
  "running-link-restamps": "link starts are capture-only; Obsidian edits the lineup by hand",
};

// The task line another note's Task Link names, read from the vector's notes.
function resolverFor(vector) {
  const notes = vector.notes || {};
  return (link) => {
    const body = notes[`${link.pathPart}.md`];
    if (typeof body !== "string") return null;
    return (
      body
        .split("\n")
        .find((line) => new RegExp(`(?:^|\\s)\\^${link.blockId}\\s*$`).test(line)) || null
    );
  };
}

function applyGesture(vector) {
  const lines = vector.day.split("\n");
  const sectionStart = lines.findIndex((line) => /^## Pomodoros\s*$/.test(line));
  const entries = [];
  for (let index = sectionStart + 1; index < lines.length; index += 1) {
    if (/^- \[ \]/.test(lines[index])) entries.push(index);
  }
  const target = /meet/i.test(vector.day.split("\n")[entries[0]] || "")
    ? entries.find((index) => /— MEET\s*$/.test(lines[index]))
    : entries.find((index) => /^- \[ \] \(\)/.test(lines[index])) ?? entries[0];
  assert.notEqual(target, undefined, `${vector.id}: no target entry`);
  assert.equal(vector.token, "=", `${vector.id}: only \`=\` starts map to se<X>`);
  const typed = lines[target].replace(/\([^)]*\)/, "(se)");
  const cursorCh = typed.indexOf("(se)") + 1 + "se".length;
  const document = lines.slice();
  document[target] = typed;
  const now = parseNow(vector.now);
  const expansion = helpers.findExpansion(typed, cursorCh, now);
  assert.ok(expansion, `${vector.id}: no expansion`);
  const adjusted = helpers.applyEventRunToExpansion(document, target, expansion, now, {
    resolveTask: resolverFor(vector),
  });
  const line =
    typed.slice(0, adjusted.expansion.fromCh) +
    adjusted.expansion.replacement +
    typed.slice(adjusted.expansion.toCh);
  return { adjusted, line, target, lines };
}

for (const vector of fixture.cases) {
  if (ELSEWHERE[vector.id]) {
    test(`shared vector (elsewhere): ${vector.id}`, () => {
      assert.ok(ELSEWHERE[vector.id].length > 0);
    });
    continue;
  }
  test(`shared vector: ${vector.id}`, () => {
    const { adjusted, line, target, lines } = applyGesture(vector);
    const expectedDay = vector.expected_day.split("\n");
    const name = /— ([A-Z]+)\s*$/.exec(lines[target])[1];
    const expectedLine = expectedDay.find((item) => item.endsWith(`— ${name}`));
    assert.equal(line, expectedLine);
    assert.equal(/\[off::/.test(line), vector.expected_off_clock);
    assert.equal(/\[t::/.test(line), !vector.expected_off_clock);
    assert.equal(adjusted.offClock, vector.expected_off_clock);
    const codes = adjusted.notices.map((notice) => notice.code);
    if (vector.expected_warning) {
      assert.ok(codes.includes(vector.expected_warning), `${codes} lacks warning`);
    } else {
      assert.deepEqual(codes, []);
    }
  });
}

test("every vector is either mirrored here or listed as handled elsewhere", () => {
  const ids = fixture.cases.map((item) => item.id);
  for (const id of Object.keys(ELSEWHERE)) assert.ok(ids.includes(id), id);
});

test("the verdict needs a resolved, nonempty, all-off-clock lineup", () => {
  const verdict = helpers.clockVerdict;
  assert.deepEqual(verdict([]), { kind: "worked", reason: "unlinked", index: null });
  assert.deepEqual(verdict([{ offClock: true }]), { kind: "off-clock", reason: null, index: null });
  assert.deepEqual(verdict([{ offClock: true }, { offClock: true }]), { kind: "off-clock", reason: null, index: null });
  assert.deepEqual(verdict([{ offClock: true }, { offClock: false }]), { kind: "worked", reason: "mixed", index: 1 });
  assert.deepEqual(verdict([{ offClock: false }, { offClock: true }]), { kind: "worked", reason: "mixed", index: 0 });
  assert.deepEqual(verdict([{ offClock: true }, { offClock: null }]), { kind: "worked", reason: "unresolved", index: 1 });
  // Unresolved wins over mixed: the first unresolved link names the reason.
  assert.deepEqual(verdict([{ offClock: false }, { offClock: null }]), { kind: "worked", reason: "unresolved", index: 1 });
});

test("counted links are the direct-child dedicated bullets: plain, struck, marked, or embedded", () => {
  const lines = [
    "- [ ] (**1200-1300** [off:: 60m]) — LUNCH",
    "  - [[#^plain]]",
    "  - 🍅 [[bob#^marked]]",
    "  - 🍅 ~~[[#^struck]]~~",
    "  - ![[bob#^embedded]]",
    "  - [[bob#^deferred]]#",
    "  - a note about [[bob#^mention]] in prose",
    "  - ~~[[bob#^half]]",
    "    - [[bob#^deeper]]",
    "  ```",
    "  - [[bob#^fenced]]",
    "  ```",
    "  - [[bob#^last|alias]]",
    "- [ ] () — NEXT",
    "  - [[bob#^other]]",
  ];
  const links = helpers.pomodoroClockCountedLinks(lines, 0);
  assert.deepEqual(
    links.map((link) => [link.pathPart, link.blockId, link.embedded, link.struck]),
    [
      ["", "plain", false, false],
      ["bob", "marked", false, false],
      ["", "struck", false, true],
      ["bob", "embedded", true, false],
      ["bob", "last", false, false],
    ],
  );
});

test("the lineup clock reads same-note tasks and Event Tasks, and resolves other notes through the callback", () => {
  const lines = [
    "## Events",
    "- [ ] #task **1200-1300** Lunch #offclock ^lunch",
    "",
    "## Tasks",
    "- [ ] #task Walk the dog #off-clock ^walk",
    "- [ ] #task Fix the parser ^parser",
    "- [ ] #task Dup #offclock ^dup",
    "- [ ] #task Dup again ^dup",
    "",
    "## Pomodoros",
    "- [ ] (**1200-1300**) — LUNCH",
    "  - [[#^lunch]]",
    "  - [[#^walk]]",
    "  - [[bob#^elsewhere]]",
  ];
  const resolver = (line) => (link) =>
    link.pathPart === "bob" && link.blockId === "elsewhere" ? line : null;
  const off = helpers.pomodoroLineupClock(lines, 10, resolver("- [ ] #task Cook #untracked ^elsewhere"), "LUNCH");
  assert.equal(off.offClock, true);
  assert.equal(off.notice, null);
  const mixed = helpers.pomodoroLineupClock(lines, 10, resolver("- [ ] #task Fix the parser ^elsewhere"), "LUNCH");
  assert.equal(mixed.offClock, false);
  assert.deepEqual(mixed.notice, {
    code: "pomodoro_clock_mixed",
    message: "◌ LUNCH stays on the clock: it also links Fix the parser",
  });
  const unresolved = helpers.pomodoroLineupClock(lines, 10, resolver(null), "LUNCH");
  assert.equal(unresolved.offClock, false);
  assert.deepEqual(unresolved.notice, {
    code: "pomodoro_clock_mixed",
    message: "◌ LUNCH stays on the clock: [[bob#^elsewhere]] does not resolve",
  });
  // A resolver that throws, or returns a non-task line, is unresolved.
  const throwing = helpers.pomodoroLineupClock(lines, 10, () => {
    throw new Error("boom");
  });
  assert.equal(throwing.offClock, false);
  const notTask = helpers.pomodoroLineupClock(lines, 10, resolver("Just prose ^elsewhere"));
  assert.equal(notTask.offClock, false);
  // An ambiguous same-note id does not resolve.
  const ambiguous = helpers.pomodoroClockLinkFacts(
    lines,
    [{ pathPart: "", blockId: "dup", token: "[[#^dup]]" }],
    null,
  );
  assert.equal(ambiguous[0].offClock, null);
  // The mixed notice names an unnamed session "the session".
  assert.equal(
    helpers.pomodoroLineupClock(lines, 10, resolver("- [ ] #task Fix the parser ^elsewhere")).notice.message,
    "◌ the session stays on the clock: it also links Fix the parser",
  );
  // Only mixed or unresolved lineups that include an off-clock link notice.
  const unlinked = ["## Pomodoros", "- [ ] () — BOB"];
  assert.equal(helpers.pomodoroLineupClock(unlinked, 1, null).notice, null);
  const onClockOnly = ["## Tasks", "- [ ] #task Fix ^fix", "## Pomodoros", "- [ ] () — BOB", "  - [[#^fix]]"];
  assert.equal(helpers.pomodoroLineupClock(onClockOnly, 3, null).notice, null);
});

test("a MEET with no event run takes the clock of its whole lineup", () => {
  const lines = [
    "## Tasks",
    "- [ ] #task Walk the dog #offclock ^walk",
    "## Pomodoros",
    "- [ ] (se) — MEET",
    "  - [[#^walk]]",
  ];
  const now = new Date(2026, 10, 1, 9, 2, 0);
  const expansion = helpers.findExpansion(lines[3], "- [ ] (se".length, now);
  const adjusted = helpers.applyEventRunToExpansion(lines, 3, expansion, now);
  assert.equal(adjusted.offClock, true);
  assert.equal(adjusted.eventRun, null);
  assert.ok(adjusted.expansion.replacement.startsWith("(**0905-0930** [off:: 25m])"));
});

test("a counted suffix keeps its span and still takes the lineup clock", () => {
  const lines = [
    "## Tasks",
    "- [ ] #task Walk the dog #offclock ^walk",
    "## Pomodoros",
    "- [ ] (se3) — WALK",
    "  - [[#^walk]]",
  ];
  const now = new Date(2026, 10, 1, 9, 2, 0);
  const expansion = helpers.findExpansion(lines[3], "- [ ] (se3".length, now);
  const adjusted = helpers.applyEventRunToExpansion(lines, 3, expansion, now);
  assert.equal(adjusted.offClock, true);
  assert.ok(adjusted.expansion.replacement.startsWith("(**0905-0920** [off:: 15m])"));
});
