const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");
const { clockEnvFor, planCapsForVector } = require("./pomodoro-clock-vector-helpers.cjs");

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

const DAILY_PATH = "2026/20261101.md";

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

function clockResolverFor(vector) {
  const env = clockEnvFor(vector.notes, DAILY_PATH, vector.day);
  const caps = planCapsForVector(vector, helpers.defaultPlanCaps());
  return (link, line) => {
    const file = link && link.pathPart
      ? env.resolve(link.pathPart)
      : env.files.get(DAILY_PATH);
    if (!file) return null;
    return helpers.taskEffectiveClockResolution(file.path, line, env.metadataCache, env.vault, caps);
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
    resolveClock: clockResolverFor(vector),
  });
  const line =
    typed.slice(0, adjusted.expansion.fromCh) +
    adjusted.expansion.replacement +
    typed.slice(adjusted.expansion.toCh);
  return { adjusted, line, target, lines };
}

for (const vector of fixture.cases) {
  if (ELSEWHERE[vector.id] || vector.token !== "=") {
    test(`shared vector (elsewhere): ${vector.id}`, () => {
      assert.ok(ELSEWHERE[vector.id] || vector.token !== "=");
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

test("closed tasks use their own line type without changing the closed suggestion result", () => {
  const notes = {
    "love.md": "---\ntype: [[area]]\noffclock_types: [SIDE QUEST]\n---\n- [x] #task Old errand [type:: SIDE QUEST] ^done\n",
  };
  const line = "- [x] #task Old errand [type:: SIDE QUEST] ^done";
  const env = clockEnvFor(notes, DAILY_PATH);
  const caps = planCapsForVector({}, helpers.defaultPlanCaps());
  const clock = helpers.taskEffectiveClockResolution(
    "love.md",
    line,
    env.metadataCache,
    env.vault,
    caps,
  );
  assert.equal(clock.offClock, true);
  assert.equal(clock.source, "note");
  const suggestion = helpers.pomodoroThemeSuggestWithDiagnostics({
    path: "love.md",
    line,
    metadataCache: env.metadataCache,
    vault: env.vault,
    config: { readingType: caps.readingTheme, defaultType: caps.defaultType },
  });
  assert.deepEqual(suggestion.warnings, [{ code: "closed_task" }]);
});

test("offclock_types follows the empty, scalar, list, and invalid YAML value rules", () => {
  const parsed = helpers.pomodoroClockOffclockTypes;
  for (const value of [undefined, null, "", [], [null, " "]]) {
    assert.deepEqual(parsed(value === undefined ? {} : { offclock_types: value }), { kind: "absent" });
  }
  assert.deepEqual(parsed({ offclock_types: " meet " }), { kind: "valid", keys: new Set(["meet"]) });
  assert.deepEqual(parsed({ offclock_types: ["Meet", "MEET", null, " "] }), { kind: "valid", keys: new Set(["meet"]) });
  for (const value of [
    7,
    true,
    {},
    ["A + B"],
    ["OFF"],
    ["ON"],
    ["OFFCLOCK"],
    ["OFF-CLOCK"],
    ["UNTRACKED"],
    [["MEET"]],
    ["MEET", 7],
  ]) {
    assert.deepEqual(parsed({ offclock_types: value }), { kind: "invalid" });
  }
});

test("an invalid type-list warning names offclock_types", () => {
  const vector = fixture.cases.find((item) => item.id === "invalid-type-list-item-stays-worked");
  const line = vector.notes["love.md"].split("\n").find((item) => item.includes("^sync"));
  const env = clockEnvFor(vector.notes, DAILY_PATH, vector.day);
  const caps = planCapsForVector(vector, helpers.defaultPlanCaps());
  const resolution = helpers.taskEffectiveClockResolution(
    "love.md",
    line,
    env.metadataCache,
    env.vault,
    caps,
  );
  const notice = helpers.pomodoroClockResolutionNotices([
    { token: "[[love#^sync]]", text: "Sync", resolution },
  ])[0];
  assert.equal(notice.code, "note_offclock_invalid");
  assert.match(notice.message, /invalid offclock_types/);
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

test("taskEffectiveOffClock inherits offclock: from the nearest area or project", () => {
  const env = clockEnvFor({
    "love.md": "---\ntype: [[area]]\noffclock: true\n---\n",
    "abby.md": "---\ntype: [[area]]\nparent: [[love]]\n---\n",
    "fun.md": "---\ntype: [[area]]\nparent: [[love]]\noffclock: false\n---\n",
    "surf.md": "---\ntype: [[area]]\nparent: [[fun]]\noffclock: true\n---\n",
    "dog.md": "---\ntype: [[article]]\nparent: [[love]]\noffclock: false\n---\n",
    "invalid.md": "---\ntype: [[project]]\nparent: [[love]]\noffclock: maybe\n---\n",
  });
  const resolve = (path, line) =>
    helpers.taskEffectiveOffClock(path, line, env.metadataCache, env.vault);
  assert.deepEqual(resolve("love.md", "- [ ] #task Lunch ^lunch"), {
    offClock: true,
    source: "note",
    notePath: "love.md",
  });
  assert.deepEqual(resolve("abby.md", "- [ ] #task Pickup ^pickup"), {
    offClock: true,
    source: "note",
    notePath: "love.md",
  });
  assert.deepEqual(resolve("fun.md", "- [ ] #task Park ^park"), {
    offClock: false,
    source: "note",
    notePath: "fun.md",
  });
  assert.deepEqual(resolve("surf.md", "- [ ] #task Surf ^surf"), {
    offClock: true,
    source: "note",
    notePath: "surf.md",
  });
  assert.deepEqual(resolve("dog.md", "- [ ] #task Walk Lenard ^lenard"), {
    offClock: true,
    source: "note",
    notePath: "love.md",
  });
  assert.deepEqual(resolve("invalid.md", "- [ ] #task Maybe later ^maybe"), {
    offClock: false,
    source: "invalid_note",
    notePath: "invalid.md",
  });
  assert.deepEqual(resolve("love.md", "- [ ] #task Work call #on ^call"), {
    offClock: false,
    source: "on_tag",
    notePath: null,
  });
  assert.deepEqual(resolve("fun.md", "- [ ] #task Park #off ^park"), {
    offClock: true,
    source: "off_tag",
    notePath: null,
  });
  assert.deepEqual(
    resolve("love.md", "- [ ] #task Work call #on #off ^call"),
    { offClock: false, source: "on_tag", notePath: null },
  );
  assert.deepEqual(
    helpers.taskEffectiveOffClock("love.md", "- [ ] #task Lunch ^lunch", null, null),
    { offClock: false, source: "default", notePath: null },
  );
});

test("taskEffectiveOffClock follows [root::] off a daily note", () => {
  const env = clockEnvFor({
    "love.md": "---\ntype: [[area]]\noffclock: true\n---\n",
    "abby.md": "---\ntype: [[area]]\nparent: [[love]]\n---\n",
  }, "## Events\n- [ ] #task **1100-1130** Pickup [root:: abby] ^pickup\n");
  assert.deepEqual(
    helpers.taskEffectiveOffClock(
      DAILY_PATH,
      "- [ ] #task **1100-1130** Pickup [root:: abby] ^pickup",
      env.metadataCache,
      env.vault,
    ),
    { offClock: true, source: "note", notePath: "love.md" },
  );
  assert.deepEqual(
    helpers.taskEffectiveOffClock(
      DAILY_PATH,
      "- [ ] #task Orphan [root:: missing] ^orphan",
      env.metadataCache,
      env.vault,
    ),
    { offClock: false, source: "default", notePath: null },
  );
});

test("#on wins over #off and #off does not match #offclock", () => {
  assert.equal(helpers.eventTaskLineIsOffClock("- [ ] #task Lunch #off"), true);
  assert.equal(helpers.eventTaskLineIsOffClock("- [ ] #task Lunch #offclock"), true);
  assert.equal(helpers.eventTaskLineIsOffClock("- [ ] #task Lunch #on #off"), false);
  assert.equal(helpers.eventTaskLineIsOffClock("- [ ] #task Lunch #office"), false);
  assert.equal(helpers.eventTaskLineIsOffClock("- [ ] #task Lunch #one"), false);
  assert.equal(helpers.eventTaskClockTag("- [ ] #task Lunch #on #off").conflict, true);
});
