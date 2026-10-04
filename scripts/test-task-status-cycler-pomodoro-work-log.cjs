const test = require("node:test");
const assert = require("node:assert/strict");
const {
  TaskStatusCyclerPlugin,
  helpers,
  createInMemoryObsidianApp,
  createTextEditor,
} = require("./task-status-cycler-harness.cjs");

test("Pomodoro Work Log Task Link recognition accepts every link shape and rejects ambiguous bodies", () => {
  const accepted = [
    "\t- [[Target#^task]]",
    "\t- ![[Target#^task]]",
    "\t- [[Target#^task|Alias]]",
    "\t- ~~[[Target#^task]]~~",
    "\t- 🍅 [[Target#^task]]",
    "\t- 🍅 ~~[[Target#^task]]~~",
    "\t- [[Target#^task]]#",
    "\t- ~~[[Target#^task]]~~#",
  ];
  for (const line of accepted) {
    const target = helpers.getPomodoroWorkLogTaskLinkTarget(line);
    assert.ok(target, `expected a Task Link target for: ${line}`);
    assert.equal(target.blockId, "task");
  }

  const rejected = [
    "\t- [[A#^a]] and [[B#^b]]",
    "\t- prose before [[A#^a]]",
    "\t- just a plain note",
    "\t- Mix ![[A#^a]] with [[B#^b]]",
  ];
  for (const line of rejected) {
    assert.equal(
      helpers.getPomodoroWorkLogTaskLinkTarget(line),
      null,
      `expected no Task Link target for: ${line}`,
    );
  }
});

test("Pomodoro Work Log descendant tree keeps relative depth and drops blank lines", () => {
  const lines = [
    "- [ ] Focus",
    "\t- [[Target#^task]]",
    "\t\t- First note",
    "\t\t",
    "\t\t- Second note",
    "\t\t\t- Nested detail",
    "\t- Sibling bullet",
  ];
  const endLine = helpers.findTaskChildBlockEndLine(lines, 1);
  const tree = helpers.collectPomodoroWorkLogDescendantTree(lines, 1, endLine);
  assert.deepEqual(tree, [
    { marker: "-", bodyText: "First note", children: [] },
    {
      marker: "-",
      bodyText: "Second note",
      children: [{ marker: "-", bodyText: "Nested detail", children: [] }],
    },
  ]);
});

test("Pomodoro Work Log note-group collection scopes to direct children and requires descendants", () => {
  const lines = [
    "## Pomodoros",
    "- [ ] Focus",
    "\t- [[A#^a]]",
    "\t\t- Note under A",
    "\t- [[B#^b]]",
    "\t- [[C#^c]]",
    "\t\t- [[D#^d]]",
    "\t\t\t- Nested note under D",
    "- [ ] Other",
    "\t- [[E#^e]]",
    "\t\t- Note under a different Pomodoro",
  ];
  const section = helpers.findPomodorosSectionInLines(lines);
  const range = helpers.getSubBulletBlockRange(lines, 1, section);
  const groups = helpers.collectPomodoroWorkLogNoteGroups(lines, 1, range);
  // B has no descendants, so it is not collected; C's own descendant (D) is
  // not itself a note group, since D is not a direct child of the Pomodoro;
  // E belongs to a different Pomodoro entirely.
  assert.deepEqual(groups.map((group) => group.target.blockId), ["a", "c"]);
});

test("Work Log entry body formats as *date* — summary", () => {
  assert.equal(
    helpers.formatWorkLogEntryBody("Read `research.15`!", "2026-08-26"),
    "*2026-08-26* — Read `research.15`!",
  );
});

test("buildWorkLogEntryLines dates depth-1 entries and drops an empty-bodied entry's whole subtree", () => {
  const roots = [
    { marker: "-", bodyText: "First note", children: [] },
    {
      marker: "-",
      bodyText: "Second note",
      children: [{ marker: "-", bodyText: "Nested detail", children: [] }],
    },
    {
      marker: "-",
      bodyText: "",
      children: [{ marker: "-", bodyText: "orphaned", children: [] }],
    },
  ];
  assert.deepEqual(helpers.buildWorkLogEntryLines(roots, "\t\t", "-", "2026-08-26"), [
    "\t\t- *2026-08-26* — First note",
    "\t\t- *2026-08-26* — Second note",
    "\t\t\t- Nested detail",
  ]);
});

test("planPomodoroWorkLogGroupInsertion creates a fresh tab-indented marker for a childless task", () => {
  const plan = helpers.planPomodoroWorkLogGroupInsertion(
    ["- [ ] #task Target ^t"],
    0,
    [{ marker: "-", bodyText: "Did work", children: [] }],
    "2026-08-26",
  );
  assert.equal(plan.insertLine, 1);
  assert.deepEqual(plan.insertedLines, [
    "\t- 🛠️ **WORK LOG**",
    "\t\t- *2026-08-26* — Did work",
  ]);
});

test("planPomodoroWorkLogGroupInsertion prepends under an existing canonical marker", () => {
  const lines = [
    "- [ ] #task Target ^t",
    "\t- 🛠️ **WORK LOG**",
    "\t\t- *2026-08-20* — Old entry",
  ];
  const plan = helpers.planPomodoroWorkLogGroupInsertion(
    lines,
    0,
    [{ marker: "-", bodyText: "New entry", children: [] }],
    "2026-08-26",
  );
  assert.equal(plan.insertLine, 2);
  assert.deepEqual(plan.insertedLines, ["\t\t- *2026-08-26* — New entry"]);
});

test("planPomodoroWorkLogGroupInsertion prepends under the legacy 'Work log' spelling", () => {
  const lines = [
    "- [ ] #task Target ^t",
    "\t- **Work log:**",
    "\t\t- *2026-08-20* — Old entry",
  ];
  const plan = helpers.planPomodoroWorkLogGroupInsertion(
    lines,
    0,
    [{ marker: "-", bodyText: "New entry", children: [] }],
    "2026-08-26",
  );
  assert.equal(plan.insertLine, 2);
  assert.deepEqual(plan.insertedLines, ["\t\t- *2026-08-26* — New entry"]);
});

test("planPomodoroWorkLogGroupInsertion ignores a Work Log marker belonging to a nested child task", () => {
  const lines = [
    "- [ ] #task Parent ^p",
    "\t- [ ] #task Child ^c",
    "\t\t- 🛠️ **WORK LOG**",
    "\t\t\t- *2026-08-20* — Child entry",
  ];
  const plan = helpers.planPomodoroWorkLogGroupInsertion(
    lines,
    0,
    [{ marker: "-", bodyText: "Parent note", children: [] }],
    "2026-08-26",
  );
  assert.equal(plan.insertLine, 4);
  assert.equal(plan.insertedLines[0], "\t- 🛠️ **WORK LOG**");
});

test("planPomodoroWorkLogGroupInsertion inherits an existing two-space entry indent without mixing tabs", () => {
  const lines = [
    "- [ ] #task Target ^t",
    "  - 🛠️ **WORK LOG**",
    "    - *2026-08-20* — Old entry",
  ];
  const plan = helpers.planPomodoroWorkLogGroupInsertion(
    lines,
    0,
    [{ marker: "-", bodyText: "New entry", children: [] }],
    "2026-08-26",
  );
  assert.deepEqual(plan.insertedLines, ["    - *2026-08-26* — New entry"]);
});

test("full Pomodoro completion copies Task Link sub-bullet notes into linked tasks' Work Logs", async () => {
  const daily = [
    "## Pomodoros",
    "- [ ] (**1235-1340** [t:: 65m])",
    "\t- 🍅 ~~[[sase_monitor_gate#^epic]]~~",
    "\t\t- Read `research.15`!",
    "\t\t- Launched `0eg` agent to create epic!",
    "\t- 🍅 [[sase_clean_release#^prj]]",
    "\t\t- Launched `research.18`!",
    "\t- ~~[[sase_monitor_gate#^epic]]~~",
  ].join("\n");
  const harness = createInMemoryObsidianApp({
    "2026/20260826.md": daily,
    "sase_monitor_gate.md": "- [ ] #task Monitor gate ^epic",
    "sase_clean_release.md": "- [ ] #task Clean release ^prj",
  });
  const editor = createTextEditor(daily, { line: 1, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  plugin.getPomodoroWorkLogDateString = () => "2026-08-26";
  plugin.scheduleCenterEditorLineInView = () => {};

  assert.equal(
    await plugin.completeActivePomodoroTask(
      editor,
      { path: "2026/20260826.md" },
      { pomodoroLine: 1 },
    ),
    true,
  );
  assert.equal(
    harness.getSource("sase_monitor_gate.md"),
    [
      "- [ ] #task Monitor gate ^epic",
      "\t- 🛠️ **WORK LOG**",
      "\t\t- *2026-08-26* — Read `research.15`!",
      "\t\t- *2026-08-26* — Launched `0eg` agent to create epic!\n",
    ].join("\n"),
  );
  assert.equal(
    harness.getSource("sase_clean_release.md"),
    [
      "- [/] #task Clean release ^prj",
      "\t- 🛠️ **WORK LOG**",
      "\t\t- *2026-08-26* — Launched `research.18`!\n",
    ].join("\n"),
  );
  // This is a copy, not a move: the daily note's own sub-sub-bullets stay put.
  assert.match(
    editor.getValue(),
    /Read `research\.15`!\n\t\t- Launched `0eg` agent to create epic!\n\t- 🍅 \[\[sase_clean_release#\^prj\]\]\n\t\t- Launched `research\.18`!/,
  );
});

test("full Pomodoro completion adjusts the created-Pomodoro cursor for a same-note Work Log insertion", async () => {
  const daily = [
    "- [ ] #task Target ^gtd",
    "## Pomodoros",
    "- [ ] (**1110-1135** [t:: 25m])",
    "  - [[#^gtd]]",
    "    - Did some work",
  ].join("\n");
  const harness = createInMemoryObsidianApp({ "Daily.md": daily });
  const editor = createTextEditor(daily, { line: 2, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  plugin.getPomodoroWorkLogDateString = () => "2026-08-27";
  plugin.scheduleCenterEditorLineInView = () => {};

  assert.equal(
    await plugin.completeActivePomodoroTask(
      editor,
      { path: "Daily.md" },
      { pomodoroLine: 2 },
    ),
    true,
  );
  assert.equal(
    editor.getValue(),
    [
      "- [/] #task Target ^gtd",
      "\t- 🛠️ **WORK LOG**",
      "\t\t- *2026-08-27* — Did some work",
      "## Pomodoros",
      "- [x] (**1110-1135** [t:: 25m])",
      "  - 🍅 [[#^gtd]]",
      "    - Did some work",
      "- [ ] ()",
      "  - [[#^gtd]]",
    ].join("\n"),
  );
  // The created Pomodoro's cursor target shifted down by the two inserted
  // Work Log lines, and still lands on the created placeholder's `()`.
  assert.deepEqual(editor.getCursor(), { line: 7, ch: 7 });
});

test("full Pomodoro completion keeps two same-task Work Log note sets in source order", async () => {
  const daily = [
    "## Pomodoros",
    "- [ ] Focus",
    "\t- [[Target#^t]]",
    "\t\t- First session note",
    "\t- [[Target#^t]]",
    "\t\t- Second session note",
  ].join("\n");
  const harness = createInMemoryObsidianApp({
    "Daily.md": daily,
    "Target.md": "- [ ] #task Target ^t",
  });
  const editor = createTextEditor(daily, { line: 1, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  plugin.getPomodoroWorkLogDateString = () => "2026-08-26";
  plugin.scheduleCenterEditorLineInView = () => {};

  assert.equal(
    await plugin.completeActivePomodoroTask(editor, { path: "Daily.md" }, { pomodoroLine: 1 }),
    true,
  );
  assert.equal(
    harness.getSource("Target.md"),
    [
      "- [/] #task Target ^t",
      "\t- 🛠️ **WORK LOG**",
      "\t\t- *2026-08-26* — First session note",
      "\t\t- *2026-08-26* — Second session note\n",
    ].join("\n"),
  );
});

test("full Pomodoro completion prepends new Work Log entries above an existing one and preserves CRLF", async () => {
  const daily = [
    "## Pomodoros",
    "- [ ] Focus",
    "\t- [[Target#^t]]",
    "\t\t- New note",
  ].join("\n");
  const harness = createInMemoryObsidianApp({
    "Daily.md": daily,
    "Target.md": [
      "- [ ] #task Target ^t",
      "\t- 🛠️ **WORK LOG**",
      "\t\t- *2026-08-01* — Old note",
    ].join("\r\n"),
  });
  const editor = createTextEditor(daily, { line: 1, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  plugin.getPomodoroWorkLogDateString = () => "2026-08-26";
  plugin.scheduleCenterEditorLineInView = () => {};

  assert.equal(
    await plugin.completeActivePomodoroTask(editor, { path: "Daily.md" }, { pomodoroLine: 1 }),
    true,
  );
  const target = harness.getSource("Target.md");
  assert.equal(
    target,
    [
      "- [/] #task Target ^t",
      "\t- 🛠️ **WORK LOG**",
      "\t\t- *2026-08-26* — New note",
      "\t\t- *2026-08-01* — Old note",
    ].join("\r\n"),
  );
  assert.equal(target.includes("\n") && !target.includes("\r\n"), false);
});

test("full Pomodoro completion skips an unresolvable link and a link to a non-task block without failing", async () => {
  const daily = [
    "## Pomodoros",
    "- [ ] Focus",
    "\t- [[Missing#^x]]",
    "\t\t- orphan note",
    "\t- [[Plain#^y]]",
    "\t\t- also ignored",
  ].join("\n");
  const harness = createInMemoryObsidianApp({
    "Daily.md": daily,
    "Plain.md": "- Just a bullet ^y",
  });
  const editor = createTextEditor(daily, { line: 1, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  plugin.getPomodoroWorkLogDateString = () => "2026-08-26";
  plugin.scheduleCenterEditorLineInView = () => {};

  assert.equal(
    await plugin.completeActivePomodoroTask(editor, { path: "Daily.md" }, { pomodoroLine: 1 }),
    true,
  );
  assert.equal(harness.getSource("Plain.md"), "- Just a bullet ^y");
  assert.equal(editor.getValue().includes("WORK LOG"), false);
});

test("full Pomodoro completion does not start a Work Log for a Task Link with no sub-sub-bullets", async () => {
  const daily = ["## Pomodoros", "- [ ] Focus", "\t- [[Target#^t]]"].join("\n");
  const harness = createInMemoryObsidianApp({
    "Daily.md": daily,
    "Target.md": "- [ ] #task Target ^t",
  });
  const editor = createTextEditor(daily, { line: 1, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  plugin.getPomodoroWorkLogDateString = () => "2026-08-26";
  plugin.scheduleCenterEditorLineInView = () => {};

  assert.equal(
    await plugin.completeActivePomodoroTask(editor, { path: "Daily.md" }, { pomodoroLine: 1 }),
    true,
  );
  assert.equal(harness.getSource("Target.md"), "- [/] #task Target ^t");
});

