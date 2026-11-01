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

test("Work Log entry body formats as *stamp* — summary", () => {
  assert.equal(
    helpers.formatWorkLogEntryBody("Read `research.15`!", "2026-08-26 14:32"),
    "*2026-08-26 14:32* — Read `research.15`!",
  );
});

test("buildWorkLogEntryLines stamps depth-1 entries and drops an empty-bodied entry's whole subtree", () => {
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
  assert.deepEqual(helpers.buildWorkLogEntryLines(roots, "\t\t", "-", "2026-08-26 14:32"), [
    "\t\t- *2026-08-26 14:32* — First note",
    "\t\t- *2026-08-26 14:32* — Second note",
    "\t\t\t- Nested detail",
  ]);
});

test("planPomodoroWorkLogGroupInsertion creates a fresh tab-indented marker for a childless task", () => {
  const plan = helpers.planPomodoroWorkLogGroupInsertion(
    ["- [ ] #task Target ^t"],
    0,
    [{ marker: "-", bodyText: "Did work", children: [] }],
    "2026-08-26 14:32",
  );
  assert.equal(plan.insertLine, 1);
  assert.deepEqual(plan.insertedLines, [
    "\t- 🛠️ **WORK LOG**",
    "\t\t- *2026-08-26 14:32* — Did work",
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
    "2026-08-26 14:32",
  );
  assert.equal(plan.insertLine, 2);
  assert.deepEqual(plan.insertedLines, ["\t\t- *2026-08-26 14:32* — New entry"]);
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
    "2026-08-26 14:32",
  );
  assert.equal(plan.insertLine, 2);
  assert.deepEqual(plan.insertedLines, ["\t\t- *2026-08-26 14:32* — New entry"]);
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
    "2026-08-26 14:32",
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
    "2026-08-26 14:32",
  );
  assert.deepEqual(plan.insertedLines, ["    - *2026-08-26 14:32* — New entry"]);
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
  plugin.getPomodoroWorkLogStamp = () => "2026-08-26 14:32";
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
      "\t\t- *2026-08-26 14:32* — Read `research.15`!",
      "\t\t- *2026-08-26 14:32* — Launched `0eg` agent to create epic!\n",
    ].join("\n"),
  );
  assert.equal(
    harness.getSource("sase_clean_release.md"),
    [
      "- [/] #task Clean release ^prj",
      "\t- 🛠️ **WORK LOG**",
      "\t\t- *2026-08-26 14:32* — Launched `research.18`!\n",
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
  plugin.getPomodoroWorkLogStamp = () => "2026-08-27 14:32";
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
      "\t\t- *2026-08-27 14:32* — Did some work",
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
  plugin.getPomodoroWorkLogStamp = () => "2026-08-26 14:32";
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
      "\t\t- *2026-08-26 14:32* — First session note",
      "\t\t- *2026-08-26 14:32* — Second session note\n",
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
  plugin.getPomodoroWorkLogStamp = () => "2026-08-26 14:32";
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
      "\t\t- *2026-08-26 14:32* — New note",
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
  plugin.getPomodoroWorkLogStamp = () => "2026-08-26 14:32";
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
  plugin.getPomodoroWorkLogStamp = () => "2026-08-26 14:32";
  plugin.scheduleCenterEditorLineInView = () => {};

  assert.equal(
    await plugin.completeActivePomodoroTask(editor, { path: "Daily.md" }, { pomodoroLine: 1 }),
    true,
  );
  assert.equal(harness.getSource("Target.md"), "- [/] #task Target ^t");
});


test("formatWorkLogStamp matches the shared conformance vectors", () => {
  const vectors = [
    [new Date(2026, 10, 1, 14, 32, 59), "2026-11-01 14:32"],
    [new Date(2026, 10, 1, 9, 5, 0), "2026-11-01 09:05"],
    [new Date(2026, 11, 31, 23, 59, 59), "2026-12-31 23:59"],
    [new Date(2027, 0, 1, 0, 0, 0), "2027-01-01 00:00"],
  ];
  for (const [instant, stamp] of vectors) {
    assert.equal(helpers.formatWorkLogStamp(instant), stamp);
  }
  assert.equal(
    helpers.formatWorkLogEntryBody("Finished the API review", "2026-11-01 14:32"),
    "*2026-11-01 14:32* — Finished the API review",
  );
});

test("full Pomodoro completion gives every Task Link of one close a single clock read and stamp", async () => {
  const daily = [
    "## Pomodoros",
    "- [ ] Focus",
    "\t- [[Target#^t]]",
    "\t\t- First session note",
    "\t- [[Other#^o]]",
    "\t\t- Other task note",
    "\t- [[Target#^t]]",
    "\t\t- Second session note",
  ].join("\n");
  const harness = createInMemoryObsidianApp({
    "Daily.md": daily,
    "Target.md": "- [ ] #task Target ^t",
    "Other.md": "- [ ] #task Other ^o",
  });
  const editor = createTextEditor(daily, { line: 1, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  // Each call would yield a different minute if the close read the clock
  // more than once.
  let reads = 0;
  plugin.getPomodoroWorkLogStamp = () => {
    reads += 1;
    return `2026-08-26 14:${String(30 + reads).padStart(2, "0")}`;
  };
  plugin.scheduleCenterEditorLineInView = () => {};

  assert.equal(
    await plugin.completeActivePomodoroTask(editor, { path: "Daily.md" }, { pomodoroLine: 1 }),
    true,
  );
  assert.equal(reads, 1);
  assert.equal(
    harness.getSource("Target.md"),
    [
      "- [/] #task Target ^t",
      "\t- 🛠️ **WORK LOG**",
      "\t\t- *2026-08-26 14:31* — First session note",
      "\t\t- *2026-08-26 14:31* — Second session note\n",
    ].join("\n"),
  );
  assert.equal(
    harness.getSource("Other.md"),
    [
      "- [/] #task Other ^o",
      "\t- 🛠️ **WORK LOG**",
      "\t\t- *2026-08-26 14:31* — Other task note\n",
    ].join("\n"),
  );
});

test("closing yesterday's daily note stamps the write instant, not the note's filename date", async () => {
  const daily = [
    "## Pomodoros",
    "- [ ] (**2255-2320** [t:: 25m])",
    "\t- [[Target#^t]]",
    "\t\t- Forgotten session note",
  ].join("\n");
  const harness = createInMemoryObsidianApp({
    "2026/20260825.md": daily,
    "Target.md": "- [ ] #task Target ^t",
  });
  const editor = createTextEditor(daily, { line: 1, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  plugin.scheduleCenterEditorLineInView = () => {};

  // The default seam reads the clock; pin `new Date()` to the next morning.
  const RealDate = Date;
  const instant = new RealDate(2026, 7, 26, 9, 7, 42).getTime();
  class FixedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) {
        super(instant);
      } else {
        super(...args);
      }
    }

    static now() {
      return instant;
    }
  }
  global.Date = FixedDate;
  let closed;
  try {
    closed = await plugin.completeActivePomodoroTask(
      editor,
      { path: "2026/20260825.md" },
      { pomodoroLine: 1 },
    );
  } finally {
    global.Date = RealDate;
  }

  assert.equal(closed, true);
  assert.equal(
    harness.getSource("Target.md"),
    [
      "- [/] #task Target ^t",
      "\t- 🛠️ **WORK LOG**",
      "\t\t- *2026-08-26 09:07* — Forgotten session note\n",
    ].join("\n"),
  );
});
