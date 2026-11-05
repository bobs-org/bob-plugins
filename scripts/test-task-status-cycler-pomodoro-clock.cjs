// Ctrl+Enter stamps the closed Pomodoro's clock key from the counted-links rule
// (plan:202611/off_clock_pomodoros.md). bob-cli owns the shared vectors in
// tests/fixtures/pomodoro_clock/vectors.json; the copy under
// plugins/task-status-cycler/scripts/fixtures/pomodoro_clock/ is
// byte-for-byte identical. Starts belong to bob-ledger-tools.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  TaskStatusCyclerPlugin,
  helpers,
  notices,
  ledgerToolsHelpers,
  createInMemoryObsidianApp,
  createTextEditor,
  attachActiveMarkdownView,
} = require("./task-status-cycler-harness.cjs");
const { clockEnvFor, planCapsForVector } = require("./pomodoro-clock-vector-helpers.cjs");

const fixture = JSON.parse(
  fs.readFileSync(
    path.join(
      __dirname,
      "../plugins/task-status-cycler/scripts/fixtures/pomodoro_clock/vectors.json",
    ),
    "utf8",
  ),
);

const DAILY_PATH = "2026/20261101.md";

// Vectors whose gesture has no Ctrl+Enter counterpart, with the reason.
const ELSEWHERE = {
  "unlinked-stays-on-the-clock": "start: driven by bob-ledger-tools se<X>",
  "all-off-clock-non-meet": "start: driven by bob-ledger-tools se<X>",
  "mixed-stays-on-the-clock": "start: driven by bob-ledger-tools se<X>",
  "unresolved-stays-on-the-clock": "start: driven by bob-ledger-tools se<X>",
  "alias-off-clock": "start: driven by bob-ledger-tools se<X>",
  "nested-tag-rejected": "start: driven by bob-ledger-tools se<X>",
  "meet-run-ignores-future-off-clock-queue": "start: driven by bob-ledger-tools se<X>",
  "close-mixed-after-dropping-on-clock": "`x~2` drops are capture grammar; Obsidian drops by hand",
  "kept-ledger-swap-switches-key": "kept-ledger swaps are capture-only",
  "running-link-restamps": "link starts are capture-only",
};

function makePlugin(harness, editor, nowMinutes) {
  const plugin = new TaskStatusCyclerPlugin();
  plugin.getScheduleLogDateString = () => "2026-11-01";
  plugin.getPomodoroWorkLogStamp = () => "2026-11-01 09:00";
  plugin.scheduleCenterEditorLineInView = () => {};
  plugin.getEventTaskClockTodayPath = () => DAILY_PATH;
  plugin.getEventTaskClockNowMinutes = () => nowMinutes;
  attachActiveMarkdownView(plugin, harness, editor, DAILY_PATH);
  if (!harness.app.commands) {
    harness.app.commands = { commands: {}, executeCommandById: () => false };
  }
  return plugin;
}

async function closeFirstTimedRow(vector, mutate = (day) => day, taskEffectiveOffClock = null) {
  const day = mutate(vector.day);
  const lines = day.split("\n");
  const pomodoroLine = lines.findIndex((line) => /^- \[ \] \(\*\*\d{4}-\d{4}\*\*/.test(line));
  assert.notEqual(pomodoroLine, -1, `${vector.id}: no running row`);
  const [hours, minutes] = vector.now.slice(11, 16).split(":").map(Number);
  const harness = createInMemoryObsidianApp({ ...(vector.notes || {}), [DAILY_PATH]: day });
  const hasTypeClockInput = Boolean(vector.config) || Object.values(vector.notes || {}).some(
    (source) => /(?:^|\n)offclock_types\s*:/.test(String(source || "")),
  );
  let effectiveClock = taskEffectiveOffClock;
  if (typeof effectiveClock !== "function" && hasTypeClockInput) {
    const env = clockEnvFor(vector.notes, DAILY_PATH, day);
    const caps = planCapsForVector(vector, ledgerToolsHelpers.defaultPlanCaps());
    effectiveClock = (path, line) => ledgerToolsHelpers.taskEffectiveOffClock(
      path,
      line,
      env.metadataCache,
      env.vault,
      caps,
    );
  }
  if (typeof effectiveClock === "function") {
    harness.app.plugins.plugins["bob-ledger-tools"].api.pomodoroClock = {
      version: 1,
      taskEffectiveOffClock: effectiveClock,
    };
  }
  const editor = createTextEditor(day, { line: pomodoroLine, ch: 4 });
  const plugin = makePlugin(harness, editor, hours * 60 + minutes);
  notices.length = 0;
  const completed = await plugin.completeActivePomodoroTask(
    editor,
    { path: DAILY_PATH },
    { pomodoroLine },
  );
  return { completed, value: editor.getValue(), notices: notices.slice() };
}

const closedRow = (text) => text.split("\n").find((line) => /^- \[x\] \(/.test(line));

for (const vector of fixture.cases) {
  if (ELSEWHERE[vector.id] || vector.token !== "x") {
    test(`shared vector (elsewhere): ${vector.id}`, () => {
      assert.ok(ELSEWHERE[vector.id] || vector.token !== "x");
    });
    continue;
  }
  test(`shared vector: ${vector.id}`, async () => {
    assert.equal(vector.token, "x", `${vector.id}: only \`x\` closes map to Ctrl+Enter`);
    const result = await closeFirstTimedRow(vector);
    assert.equal(result.completed, true);
    if (vector.id === "close-defers-not-started-off-clock") {
      // The not-started event is deferred to the next Pomodoro, so the close
      // keeps no link: unlinked, worked. Per the g4 keep policy the closed
      // `[x]` row survives with its minutes, exactly as bob writes it, while
      // the deferred link is carried to the created placeholder.
      assert.equal(closedRow(result.value), closedRow(vector.expected_day));
      assert.match(result.value, /^- \[ \] \(\) — MEET\n\s+- \[\[#\^lunch\]\]$/m);
      assert.equal(vector.expected_off_clock, false);
      return;
    }
    // The closed headline is byte-for-byte what bob writes; the lineup
    // beneath it follows the plugin's own bullet style.
    assert.equal(closedRow(result.value), closedRow(vector.expected_day));
    assert.equal(/\[off::/.test(closedRow(result.value)), vector.expected_off_clock);
  });
}

test("every close vector is either mirrored here or listed as handled elsewhere", () => {
  const ids = fixture.cases.map((item) => item.id);
  for (const id of Object.keys(ELSEWHERE)) assert.ok(ids.includes(id), id);
  const mirrored = fixture.cases.filter((item) => item.token === "x" && !ELSEWHERE[item.id]);
  assert.deepEqual(
    mirrored.map((item) => item.id),
    ["close-defers-not-started-off-clock", "bare-row-restamped-at-close", "conflict-row-at-close"],
  );
});

const ledger = (rows) => ["## Pomodoros", ...rows].join("\n");
const task = (text) => `- [*] #task ${text}`;

test("a worked row closes off the clock when every kept link is #offclock", async () => {
  const result = await closeFirstTimedRow({
    id: "worked-to-off-clock",
    now: "2026-11-01 09:00:00",
    notes: { "bob.md": [task("Walk ^walk #offclock"), task("Cook #untracked ^cook")].join("\n") },
    day: ledger([
      "- [ ] (**0800-0900** [t:: 60m]) — HOME",
      "  - [[bob#^walk]]",
      "  - [[bob#^cook]]",
    ]),
  });
  assert.equal(closedRow(result.value), "- [x] (**0800-0900** [off:: 60m]) — HOME");
});

const inheritedCloseVector = {
  id: "inherited-close",
  now: "2026-11-01 09:00:00",
  notes: {
    "love.md": "---\ntype: [[area]]\noffclock: true\n---\n- [*] #task Lunch ^lunch\n",
  },
  day: ledger([
    "- [ ] (**0800-0900** [t:: 60m]) — LUNCH",
    "  - [[love#^lunch]]",
  ]),
};

test("a close uses ledger-tools' effective task clock API when available", async () => {
  const calls = [];
  const result = await closeFirstTimedRow(
    inheritedCloseVector,
    (day) => day,
    (path, line) => {
      calls.push([path, line]);
      return path === "love.md"
        ? { offClock: true, source: "note", notePath: path }
        : { offClock: false, source: "default", notePath: null };
    },
  );
  assert.equal(closedRow(result.value), "- [x] (**0800-0900** [off:: 60m]) — LUNCH");
  assert.deepEqual(calls, [["love.md", "- [*] #task Lunch ^lunch"]]);
});

test("a close still accepts a boolean from the effective clock API", async () => {
  const result = await closeFirstTimedRow(
    inheritedCloseVector,
    (day) => day,
    (path) => path === "love.md",
  );
  assert.equal(closedRow(result.value), "- [x] (**0800-0900** [off:: 60m]) — LUNCH");
});

test("a close without the clock API keeps an untagged inherited task on the clock", async () => {
  const result = await closeFirstTimedRow(inheritedCloseVector);
  assert.equal(closedRow(result.value), "- [x] (**0800-0900** [t:: 60m]) — LUNCH");
});

test("an off-clock row closes back onto the clock when it also links a worked task", async () => {
  const result = await closeFirstTimedRow({
    id: "off-clock-to-worked",
    now: "2026-11-01 09:00:00",
    notes: { "bob.md": [task("Walk the dog #offclock ^walk"), task("Fix the parser ^parser")].join("\n") },
    day: ledger([
      "- [ ] (**0800-0900** [off:: 60m] [foo:: 1]) — HOME",
      "  - [[bob#^walk]]",
      "  - [[bob#^parser]]",
    ]),
  });
  assert.equal(closedRow(result.value), "- [x] (**0800-0900** [t:: 60m] [foo:: 1]) — HOME");
  assert.deepEqual(result.notices, ["◌ HOME stays on the clock: it also links Fix the parser"]);
});

test("an unresolved link keeps the session worked and names itself in the notice", async () => {
  const result = await closeFirstTimedRow({
    id: "unresolved",
    now: "2026-11-01 09:00:00",
    notes: { "bob.md": task("Walk the dog #offclock ^walk") },
    day: ledger([
      "- [ ] (**0800-0900** [off:: 60m]) — LUNCH",
      "  - [[bob#^walk]]",
      "  - [[bob#^gone]]",
    ]),
  });
  assert.equal(closedRow(result.value), "- [x] (**0800-0900** [t:: 60m]) — LUNCH");
  assert.deepEqual(result.notices, ["◌ LUNCH stays on the clock: [[bob#^gone]] does not resolve"]);
});

test("a struck or embedded #offclock link still counts at close", async () => {
  const result = await closeFirstTimedRow({
    id: "struck",
    now: "2026-11-01 09:00:00",
    notes: { "bob.md": task("Walk the dog #offclock ^walk") },
    day: ledger([
      "- [ ] (**0800-0900** [t:: 60m]) — WALK",
      "  - 🍅 ~~[[bob#^walk]]~~",
    ]),
  });
  assert.equal(closedRow(result.value), "- [x] (**0800-0900** [off:: 60m]) — WALK");
});

test("a link the close defers does not count: a mixed session leaves its on-clock link behind", async () => {
  const result = await closeFirstTimedRow({
    id: "deferred-on-clock",
    now: "2026-11-01 09:00:00",
    notes: { "bob.md": [task("Walk the dog #offclock ^walk"), task("Fix the parser ^parser")].join("\n") },
    day: ledger([
      "- [ ] (**0800-0900** [t:: 60m]) — HOME",
      "  - [[bob#^walk]]",
      "  - [[bob#^parser]]#",
    ]),
  });
  assert.equal(closedRow(result.value), "- [x] (**0800-0900** [off:: 60m]) — HOME");
});

test("an untimed placeholder close has no key to stamp", async () => {
  const day = ledger(["- [ ] () — BOB", "  - [[bob#^walk]]"]);
  const harness = createInMemoryObsidianApp({
    "bob.md": task("Walk the dog #offclock ^walk"),
    [DAILY_PATH]: day,
  });
  const editor = createTextEditor(day, { line: 1, ch: 4 });
  const plugin = makePlugin(harness, editor, 540);
  const completed = await plugin.completeActivePomodoroTask(editor, { path: DAILY_PATH }, { pomodoroLine: 1 });
  assert.equal(completed, true);
  assert.equal(closedRow(editor.getValue()), "- [x] () — BOB");
});

test("the completion plan stamps the key only when a session clock is given", () => {
  const lines = ["## Pomodoros", "- [ ] (**1200-1300**) — MEET", "  - [[#^lunch]]", "- [ ] () — BOB"];
  const section = helpers.findPomodorosSectionInLines(lines);
  const headline = (plan) =>
    plan.edits.find((edit) => edit.type === "replaceLine" && edit.line === 1).lineText;
  assert.equal(headline(helpers.buildPomodoroCompletionPlan(lines, section, 1)), "- [x] (**1200-1300**) — MEET");
  assert.equal(
    headline(helpers.buildPomodoroCompletionPlan(lines, section, 1, { sessionClock: "off-clock" })),
    "- [x] (**1200-1300** [off:: 60m]) — MEET",
  );
  assert.equal(
    headline(helpers.buildPomodoroCompletionPlan(lines, section, 1, { sessionClock: "worked" })),
    "- [x] (**1200-1300** [t:: 60m]) — MEET",
  );
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
    "  - ⛓️ **DEPENDS ON:** [[bob#^dependency]]",
    "    - [[bob#^deeper]]",
    "  ```",
    "  - [[bob#^fenced]]",
    "  ```",
    "  - [[bob#^last|alias]]",
    "- [ ] () — NEXT",
    "  - [[bob#^other]]",
  ];
  assert.deepEqual(
    helpers.collectPomodoroClockLinks(lines, 0).map((link) => [link.pathPart, link.blockId, link.embedded]),
    [
      ["", "plain", false],
      ["bob", "marked", false],
      ["", "struck", false],
      ["bob", "embedded", true],
      ["bob", "last", false],
    ],
  );
});

test("the off-clock tag follows bob's rules for every spelling", () => {
  const has = helpers.pomodoroClockLineHasOffClockTag;
  for (const line of [
    "- [*] #task Lunch #off [root:: love]",
    "- [*] #task Lunch #untracked [root:: love]",
    "- [*] #task Lunch #OFFCLOCK.",
    "- [*] #task Lunch #Off-Clock)",
    "- [*] #offclock Lunch",
  ]) {
    assert.equal(has(line), true, line);
  }
  for (const line of [
    "- [*] #task `#untracked` in code",
    "- [*] #task [see #offclock](https://example.com)",
    "- [*] #task lunch#untracked glued",
    "- [*] #task Lunch #offclock/nested",
    "- [*] #task Lunch #off-clocked",
    "- [*] #task Lunch",
  ]) {
    assert.equal(has(line), false, line);
  }
  assert.equal(has("- [*] #task Work #on #off [root:: love]"), false);
  assert.equal(helpers.pomodoroClockLineTagResolution("- [*] #task Work #on #off").conflict, true);
});

test("setPomodoroLineClock moves the recorded minutes between keys like Rust set_ledger_clock", () => {
  const set = helpers.setPomodoroLineClock;
  assert.equal(set("- [x] (**1200-1300** [t:: 60m]) — MEET", "off-clock"), "- [x] (**1200-1300** [off:: 60m]) — MEET");
  assert.equal(set("- [x] (**1200-1300** [off:: 45m] [foo:: 1]) — MEET", "worked"), "- [x] (**1200-1300** [t:: 45m] [foo:: 1]) — MEET");
  assert.equal(set("- [x] (**0800-0900**) — WALK", "off-clock"), "- [x] (**0800-0900** [off:: 60m]) — WALK");
  assert.equal(set("- [x] (**0800-0900**) — WALK", "worked"), "- [x] (**0800-0900** [t:: 60m]) — WALK");
  assert.equal(set("- [x] (08:00-09:00) — WALK", "off-clock"), "- [x] (**08:00-09:00** [off:: 60m]) — WALK");
  assert.equal(set("- [x] (**0800-0900** [t:: 60m] [off:: 30m]) — WALK", "off-clock"), "- [x] (**0800-0900** [off:: 60m]) — WALK");
  assert.equal(set("- [x] (**0800-0900** [t:: 60m] [off:: 30m]) — WALK", "worked"), "- [x] (**0800-0900** [t:: 60m]) — WALK");
  assert.equal(set("- [x] (**0800-0900** ⏱ 20m) — WALK", "off-clock"), "- [x] (**0800-0900** [off:: 20m]) — WALK");
  assert.equal(set("- [x] (**2330-0030**) — WALK", "off-clock"), "- [x] (**2330-0030** [off:: 60m]) — WALK");
  // Already on the target clock, or untimed: untouched.
  assert.equal(set("- [x] (**0800-0900** [t:: 25m]) — WALK", "worked"), "- [x] (**0800-0900** [t:: 25m]) — WALK");
  assert.equal(set("- [x] (**0800-0900** [off:: 25m]) — WALK", "off-clock"), "- [x] (**0800-0900** [off:: 25m]) — WALK");
  assert.equal(set("- [x] () — WALK", "off-clock"), "- [x] () — WALK");
});

test("planPomodoroCloseClock follows the verdict over resolved, unresolved, and absent links", async () => {
  const lines = [
    "- [ ] (**0800-0900** [t:: 60m]) — HOME",
    "  - [[bob#^a]]",
    "  - [[bob#^b]]",
  ];
  const resolver = (map) => async (link) => map[link.blockId] ?? null;
  const off = await helpers.planPomodoroCloseClock(lines, 0, "HOME", resolver({
    a: "- [*] #task A #offclock ^a",
    b: "- [*] #task B #off-clock ^b",
  }));
  assert.equal(off.clock, "off-clock");
  assert.equal(off.message, null);
  const mixed = await helpers.planPomodoroCloseClock(lines, 0, "HOME", resolver({
    a: "- [*] #task A #offclock ^a",
    b: "- [*] #task B ^b",
  }));
  assert.equal(mixed.clock, "worked");
  assert.equal(mixed.message, "◌ HOME stays on the clock: it also links B");
  const unresolved = await helpers.planPomodoroCloseClock(lines, 0, "", resolver({ a: "- [*] #task A #offclock ^a" }));
  assert.equal(unresolved.clock, "worked");
  assert.equal(unresolved.message, "◌ the session stays on the clock: [[bob#^b]] does not resolve");
  const throwing = await helpers.planPomodoroCloseClock(lines, 0, "HOME", async () => {
    throw new Error("boom");
  });
  assert.equal(throwing.clock, "worked");
  const unlinked = await helpers.planPomodoroCloseClock(["- [ ] (**0800-0900** [off:: 60m]) — HOME"], 0, "HOME", resolver({}));
  assert.equal(unlinked.clock, "worked");
  assert.equal(unlinked.message, null);
});
