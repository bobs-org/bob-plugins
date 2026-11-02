const test = require("node:test");
const assert = require("node:assert/strict");
const {
  TaskStatusCyclerPlugin,
  helpers,
  MarkdownView,
  createInMemoryObsidianApp,
  createTextEditor,
  attachActiveMarkdownView,
  registerTaskToggleVimAction,
  flushAsyncActions,
} = require("./task-status-cycler-harness.cjs");

test("Pomodoro marker helpers normalize every block link and preserve fences and EOLs", () => {
  const source = [
    "  - Work on [[A#^plain|Alias]] and ![[B#^embed]]",
    "  - 🍅   ~~[[C#^struck]]~~ and 🍅 🍅 [[D#^duplicate]]",
    "```md",
    "  - [[E#^fenced]]",
    "```",
  ].join("\r\n");
  const marked = helpers.rewritePomodoroMarkersInText(source, true);
  assert.match(
    marked,
    /Work on 🍅 \[\[A#\^plain\|Alias\]\] and 🍅 !\[\[B#\^embed\]\]/,
  );
  assert.match(marked, /- 🍅 ~~\[\[C#\^struck\]\]~~ and 🍅 \[\[D#\^duplicate\]\]/);
  assert.match(marked, /```md\r\n  - \[\[E#\^fenced\]\]\r\n```/);
  assert.equal(marked.includes("\r\n"), true);
  assert.equal(helpers.rewritePomodoroMarkersInText(marked, true), marked);

  const stripped = helpers.rewritePomodoroMarkersInText(marked, false);
  assert.match(stripped, /Work on \[\[A#\^plain\|Alias\]\] and !\[\[B#\^embed\]\]/);
  assert.match(stripped, /- ~~\[\[C#\^struck\]\]~~ and \[\[D#\^duplicate\]\]/);
  assert.match(stripped, /  - \[\[E#\^fenced\]\]/);
});

test("completed Pomodoro markers are normalized per occurrence", () => {
  const source = [
    "  - [[A#^plain|Alias]] and 🍅   ![[B#^embed]]",
    "  - ~~[[C#^unmarked-history]]~~ and 🍅   ~~[[D#^marked-history]]~~",
    "  - 🍅 🍅 [[E#^duplicate]] and 🍅 ![[F#^stray-embed]]",
    "```md",
    "  - [[G#^fenced]]",
    "```",
  ].join("\r\n");
  const rewritten = helpers.rewritePomodoroMarkersInText(
    source,
    helpers.completedPomodoroMarkerPolicy,
  );
  assert.match(
    rewritten,
    /🍅 \[\[A#\^plain\|Alias\]\] and !\[\[B#\^embed\]\]/,
  );
  assert.match(
    rewritten,
    /~~\[\[C#\^unmarked-history\]\]~~ and 🍅 ~~\[\[D#\^marked-history\]\]~~/,
  );
  assert.match(
    rewritten,
    /🍅 \[\[E#\^duplicate\]\] and !\[\[F#\^stray-embed\]\]/,
  );
  assert.match(rewritten, /```md\r\n  - \[\[G#\^fenced\]\]\r\n```/);
  assert.equal(
    helpers.rewritePomodoroMarkersInText(
      rewritten,
      helpers.completedPomodoroMarkerPolicy,
    ),
    rewritten,
  );
});

test("move-only Pomodoro links require a strict immediate hash directive", () => {
  const parsed = helpers.getMoveOnlyPomodoroBlockLinkFromListItem(
    "\t- [[Projects/Focus.md#^review-1|Review alias]]#  ",
  );
  assert.ok(parsed);
  assert.equal(parsed.target.pathPart, "Projects/Focus");
  assert.equal(parsed.target.blockId, "review-1");
  assert.equal(
    parsed.destinationLineText,
    "\t- [[Projects/Focus.md#^review-1|Review alias]]  ",
  );
  assert.equal(
    helpers.getBareNonEmbeddedBlockLinkTargetFromListItem(
      "\t- [[Projects/Focus.md#^review-1|Review alias]]#  ",
    ).blockId,
    "review-1",
  );

  const strictLinks = helpers.classifyPomodoroSubBullets(
    ["\t- [[#^ordinary]]", "\t- [[#^move-only]]#"],
    { startLine: 0, endLine: 2 },
  );
  assert.deepEqual(
    strictLinks.moveOnlyTaskLinkBullets.map((bullet) => bullet.line),
    [1],
  );
  assert.deepEqual(
    strictLinks.startableNonTranscludedTaskLinkBullets.map(
      (bullet) => bullet.line,
    ),
    [0],
  );

  const nonMatches = [
    "\t- ![[#^embedded]]#",
    "\t- ~~[[#^retired]]~~#",
    "\t- prose [[#^mixed]]#",
    "\t- [[#^mixed]]# trailing prose",
    "\t- [[#^spaced]] #",
    "\t- [[#^double]]##",
    "\t- [[#^tagged]] #carry",
    "\t- #tag [[#^prefixed]]#",
    "\t- [[#^hash-alias|Literal #]]",
  ];
  for (const line of nonMatches) {
    assert.equal(
      helpers.getMoveOnlyPomodoroBlockLinkFromListItem(line),
      null,
      line,
    );
  }

  const ordinary = helpers.classifyPomodoroSubBullets(
    nonMatches,
    { startLine: 0, endLine: nonMatches.length },
  );
  assert.deepEqual(ordinary.moveOnlyTaskLinkBullets, []);

  const fencedLines = [
    "```md",
    "\t- [[#^fenced]]#",
    "```",
  ];
  const fenced = helpers.classifyPomodoroSubBullets(
    fencedLines,
    { startLine: 0, endLine: fencedLines.length },
  );
  assert.deepEqual(fenced.moveOnlyTaskLinkBullets, []);
  assert.deepEqual(
    fenced.noteBullets.map((bullet) => bullet.line),
    [0, 1, 2],
  );
});

test("Pomodoro move-only planner toggles links across additional physical lines", () => {
  const lines = [
    "## Pomodoros",
    "- [ ] Focus",
    "\t- [[#^first|First alias]]  ",
    "\t- [[Projects/Tasks.md#^second]]#\t",
    "\t- prose is left alone",
    "\t- [[#^third]]",
    "- [ ] Later",
    "\t- [[#^later]]",
  ];

  const counted = helpers.buildPomodoroMoveOnlyTogglePlan(lines, 2, 3);
  assert.equal(counted.eligible, true);
  assert.equal(counted.startLine, 2);
  assert.equal(counted.endLine, 6);
  assert.deepEqual(
    counted.edits.map(({ type, line, lineText }) => ({ type, line, lineText })),
    [
      { type: "add", line: 2, lineText: "\t- [[#^first|First alias]]#  " },
      { type: "remove", line: 3, lineText: "\t- [[Projects/Tasks.md#^second]]\t" },
      { type: "add", line: 5, lineText: "\t- [[#^third]]#" },
    ],
  );

  const bare = helpers.buildPomodoroMoveOnlyTogglePlan(lines, 2, 0);
  assert.deepEqual(
    bare.edits.map(({ type, line, lineText }) => ({ type, line, lineText })),
    [{ type: "add", line: 2, lineText: "\t- [[#^first|First alias]]#  " }],
  );

  const explicitOne = helpers.buildPomodoroMoveOnlyTogglePlan(lines, 2, 1);
  assert.equal(explicitOne.endLine, 4);
  assert.deepEqual(explicitOne.edits.map((edit) => edit.type), ["add", "remove"]);

  const clamped = helpers.buildPomodoroMoveOnlyTogglePlan(lines, 3, 20);
  assert.equal(clamped.endLine, 6);
  assert.deepEqual(clamped.edits.map((edit) => edit.line), [3, 5]);
});

test("Pomodoro move-only planner round trips exact text and rejects strict non-matches", () => {
  const base = ["## Pomodoros", "- [ ] Focus"];
  const originalLine = "\t- [[Projects/Tasks.md#^marked|Marked alias]]\t  ";
  const addition = helpers.buildPomodoroMoveOnlyTogglePlan(
    [...base, originalLine],
    2,
    0,
  );
  assert.equal(addition.eligible, true);
  assert.equal(addition.edits[0].type, "add");
  const markedLine = addition.edits[0].lineText;
  assert.equal(markedLine, "\t- [[Projects/Tasks.md#^marked|Marked alias]]#\t  ");

  const removal = helpers.buildPomodoroMoveOnlyTogglePlan(
    [...base, markedLine],
    2,
    0,
  );
  assert.equal(removal.eligible, true);
  assert.equal(removal.edits[0].type, "remove");
  assert.equal(removal.edits[0].lineText, originalLine);

  const rejectedLines = [
    "\t- ![[#^embedded]]#",
    "\t- ~~[[#^retired]]~~#",
    "\t- prose [[#^mixed]]",
    "\t- [[#^first]] and [[#^second]]",
    "\t- [[#^bad id]]",
    "\t- [[#^spaced]] #",
    "\t- [[#^double]]##",
    "\t- [[#^trailing]]# trailing prose",
  ];
  for (const lineText of rejectedLines) {
    const plan = helpers.buildPomodoroMoveOnlyTogglePlan(
      [...base, lineText],
      2,
      0,
    );
    assert.equal(plan.eligible, false, lineText);
    assert.deepEqual(plan.edits, [], lineText);
  }

  assert.equal(
    helpers.buildPomodoroMoveOnlyTogglePlan(
      ["## Pomodoros", "- [x] Finished", "\t- [[#^done]]"],
      2,
      0,
    ).eligible,
    false,
  );
  assert.equal(
    helpers.buildPomodoroMoveOnlyTogglePlan(
      ["## Other", "- [ ] Focus", "\t- [[#^outside]]"],
      2,
      0,
    ).eligible,
    false,
  );
  assert.equal(
    helpers.buildPomodoroMoveOnlyTogglePlan(
      [
        "## Pomodoros",
        "- [ ] Focus",
        "```md",
        "\t- [[#^fenced]]",
        "```",
      ],
      3,
      0,
    ).eligible,
    false,
  );
});

test("bare Pomodoro move-only toggle round trips a valid alias and preserves the cursor", async () => {
  const daily = [
    "- [/] #task Same-note target ^local",
    "## Pomodoros",
    "- [ ] Focus",
    "\t- [[#^local|Local alias]]\t  ",
  ].join("\n");
  const harness = createInMemoryObsidianApp({ "Daily.md": daily });
  const originalCursor = { line: 3, ch: 12 };
  const editor = createTextEditor(daily, originalCursor);
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  const activeFile = harness.app.vault.getAbstractFileByPath("Daily.md");

  assert.equal(
    await plugin.togglePomodoroMoveOnlyRange(editor, activeFile, 0),
    true,
  );
  assert.equal(
    editor.getLine(3),
    "\t- [[#^local|Local alias]]#\t  ",
  );
  assert.deepEqual(editor.getCursor(), originalCursor);

  plugin.resolveTranscludedBlockTarget = async () => {
    throw new Error("removals must not resolve targets");
  };
  assert.equal(
    await plugin.togglePomodoroMoveOnlyRange(editor, activeFile, 0),
    true,
  );
  assert.equal(editor.getValue(), daily);
  assert.deepEqual(editor.getCursor(), originalCursor);
});

test("Pomodoro move-only runtime removes locally and validates additions independently", async () => {
  const daily = [
    "- [/] #task Same-note target ^local",
    "## Pomodoros",
    "- [ ] Focus",
    "\t- [[#^local|Local alias]]  ",
    "\t- [[Tasks#^done|Valid marked]]#\t",
    "\t- [[Missing#^gone|Stale marked]]#",
    "\t- [[Unreadable#^blocked|Unreadable marked]]#",
    "\t- [[Notes#^not-task|No-longer task]]#",
    "\t- [[Tasks#^done|Valid addition]]",
    "\t- [[Tasks#^missing|Missing addition]]",
    "\t- [[Notes#^not-task|Non-task addition]]",
    "\t- [[Unreadable#^blocked|Unreadable addition]]",
    "\t- prose",
    "- [ ] Later",
    "\t- [[#^later]]",
  ].join("\n");
  const harness = createInMemoryObsidianApp({
    "Daily.md": daily,
    "Tasks.md": "- [x] Completed #task ^done",
    "Notes.md": "- Plain note target ^not-task",
    "Unreadable.md": "- [ ] #task Unreadable ^blocked",
  });
  const read = harness.app.vault.read;
  harness.app.vault.read = async (file) => {
    if (file.path === "Unreadable.md") {
      throw new Error("unreadable");
    }
    return read(file);
  };
  const originalCursor = { line: 3, ch: 12 };
  const editor = createTextEditor(daily, originalCursor);
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;

  assert.equal(
    await plugin.togglePomodoroMoveOnlyRange(
      editor,
      harness.app.vault.getAbstractFileByPath("Daily.md"),
      20,
    ),
    true,
  );
  assert.deepEqual(editor.getCursor(), originalCursor);
  assert.equal(
    editor.getValue(),
    [
      "- [/] #task Same-note target ^local",
      "## Pomodoros",
      "- [ ] Focus",
      "\t- [[#^local|Local alias]]#  ",
      "\t- [[Tasks#^done|Valid marked]]\t",
      "\t- [[Missing#^gone|Stale marked]]",
      "\t- [[Unreadable#^blocked|Unreadable marked]]",
      "\t- [[Notes#^not-task|No-longer task]]",
      "\t- [[Tasks#^done|Valid addition]]#",
      "\t- [[Tasks#^missing|Missing addition]]",
      "\t- [[Notes#^not-task|Non-task addition]]",
      "\t- [[Unreadable#^blocked|Unreadable addition]]",
      "\t- prose",
      "- [ ] Later",
      "\t- [[#^later]]",
    ].join("\n"),
  );
});

test("Pomodoro move-only runtime protects live lines after asynchronous failures", async () => {
  const daily = [
    "- [ ] #task Valid ^valid",
    "## Pomodoros",
    "- [ ] Focus",
    "\t- [[Missing#^stale|Marked]]#",
    "\t- [[#^valid|Addition]]",
  ].join("\n");
  const harness = createInMemoryObsidianApp({ "Daily.md": daily });
  const originalCursor = { line: 3, ch: 5 };
  const editor = createTextEditor(daily, originalCursor);
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  plugin.resolveTranscludedBlockTarget = async () => {
    const liveLine = editor.getLine(3);
    editor.replaceRange(
      "\t- [[Missing#^stale|User changed alias]]#",
      { line: 3, ch: 0 },
      { line: 3, ch: liveLine.length },
    );
    throw new Error("resolver failed");
  };

  assert.equal(
    await plugin.togglePomodoroMoveOnlyRange(
      editor,
      harness.app.vault.getAbstractFileByPath("Daily.md"),
      1,
    ),
    false,
  );
  assert.equal(editor.getLine(3), "\t- [[Missing#^stale|User changed alias]]#");
  assert.equal(editor.getLine(4), "\t- [[#^valid|Addition]]");
  assert.deepEqual(editor.getCursor(), originalCursor);
});

test("Pomodoro hash Vim mapping distinguishes bare and explicit repeats", async () => {
  const originalWindow = global.window;
  const actions = new Map();
  const mappings = [];
  global.window = {
    CodeMirrorAdapter: {
      Vim: {
        defineAction: (name, handler) => actions.set(name, handler),
        mapCommand: (key, type, name, args, options) =>
          mappings.push({ key, type, name, args, options }),
      },
    },
  };

  try {
    const calls = [];
    const editor = {};
    const file = { path: "Daily.md" };
    const view = Object.assign(new MarkdownView(), { editor, file });
    const plugin = new TaskStatusCyclerPlugin();
    plugin.app = {
      workspace: {
        getActiveViewOfType: () => view,
        getActiveFile: () => file,
      },
    };
    let rejectNextCall = false;
    plugin.togglePomodoroMoveOnlyRange = async (...args) => {
      calls.push(args);
      if (rejectNextCall) {
        throw new Error("contained action failure");
      }
      return true;
    };

    assert.equal(plugin.registerVimMappings(), true);
    assert.ok(
      mappings.some(
        (mapping) =>
          mapping.key === "#" &&
          mapping.type === "action" &&
          mapping.name === "taskStatusCyclerTogglePomodoroMoveOnly" &&
          mapping.options.context === "normal",
      ),
    );

    const action = actions.get("taskStatusCyclerTogglePomodoroMoveOnly");
    action({}, { repeat: 1, repeatIsExplicit: false });
    action({}, { repeat: 1, repeatIsExplicit: true });
    action({}, { repeat: 4, repeatIsExplicit: true });
    assert.deepEqual(calls, [
      [editor, file, 0],
      [editor, file, 1],
      [editor, file, 4],
    ]);
    assert.equal(helpers.getPomodoroMoveOnlyAdditionalLines(), 0);
    assert.equal(
      helpers.getPomodoroMoveOnlyAdditionalLines({
        repeat: 9,
        repeatIsExplicit: false,
      }),
      0,
    );

    rejectNextCall = true;
    action({}, { repeat: 2, repeatIsExplicit: true });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(calls[3], [editor, file, 2]);
  } finally {
    if (originalWindow === undefined) {
      delete global.window;
    } else {
      global.window = originalWindow;
    }
  }
});

test("Pomodoro completion marks originals and carries clean live copies", () => {
  const lines = [
    "## Pomodoros",
    "- [ ] Focus",
    "  - 🍅   [[Tasks#^live|Live]] and [[Tasks#^other]]",
    "  - 🍅 ![[Tasks#^embedded|Embedded]]",
    "  - ~~[[Tasks#^retired|Unmarked retirement]]~~",
    "  - 🍅   ~~[[Tasks#^marked-retired|Marked retirement]]~~",
  ];
  const section = helpers.findPomodorosSectionInLines(lines);
  const plan = helpers.buildPomodoroCompletionPlan(lines, section, 1);
  assert.deepEqual(plan.copiedBulletLines, [
    "  - [[Tasks#^live|Live]] and [[Tasks#^other]]",
  ]);
  const replacements = new Map(
    plan.edits
      .filter((edit) => edit.type === "replaceLine")
      .map((edit) => [edit.line, edit.lineText]),
  );
  assert.equal(
    replacements.get(2),
    "  - 🍅 [[Tasks#^live|Live]] and 🍅 [[Tasks#^other]]",
  );
  assert.equal(replacements.get(3), "  - ![[Tasks#^embedded|Embedded]]");
  assert.equal(replacements.has(4), false);
  assert.equal(
    replacements.get(5),
    "  - 🍅 ~~[[Tasks#^marked-retired|Marked retirement]]~~",
  );
});

test("Pomodoro completion groups worked-on links before deferred marked links before a later Pomodoro", () => {
  const lines = [
    "## Pomodoros",
    "- [ ] First",
    "\t- [[Tasks#^ordinary-one|Ordinary one]]",
    "\t- [[Projects/Focus#^move-one|Move one]]#",
    "\t- keep this note",
    "\t- [[#^move-two]]#",
    "\t- [[Tasks#^ordinary-two|Ordinary two]]",
    "- [ ] Later",
    "\t- [[Tasks#^later|Keep later]]",
  ];
  const section = helpers.findPomodorosSectionInLines(lines);
  const plan = helpers.buildPomodoroCompletionPlan(lines, section, 1);
  assert.equal(plan.createdPomodoro, true);
  assert.equal(plan.cursorTargetLine, 5);
  assert.deepEqual(plan.copiedBulletLines, [
    "\t- [[Tasks#^ordinary-one|Ordinary one]]",
    "\t- [[Tasks#^ordinary-two|Ordinary two]]",
    "\t- [[Projects/Focus#^move-one|Move one]]",
    "\t- [[#^move-two]]",
  ]);
  assert.deepEqual(
    plan.sourceBullets.moveOnlyTaskLinkBullets.map((bullet) => bullet.line),
    [3, 5],
  );
  assert.deepEqual(
    plan.sourceBullets.startableNonTranscludedTaskLinkBullets.map(
      (bullet) => bullet.line,
    ),
    [2, 6],
  );

  const editor = createTextEditor(lines.join("\n"), { line: 1, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.scheduleCenterEditorLineInView = () => {};
  assert.equal(
    plugin.applyPomodoroCompletionPlan(editor, plan, editor.getCursor()),
    true,
  );
  assert.equal(
    editor.getValue(),
    [
      "## Pomodoros",
      "- [x] First",
      "\t- 🍅 [[Tasks#^ordinary-one|Ordinary one]]",
      "\t- keep this note",
      "\t- 🍅 [[Tasks#^ordinary-two|Ordinary two]]",
      "- [ ] ()",
      "\t- [[Tasks#^ordinary-one|Ordinary one]]",
      "\t- [[Tasks#^ordinary-two|Ordinary two]]",
      "\t- [[Projects/Focus#^move-one|Move one]]",
      "\t- [[#^move-two]]",
      "- [ ] Later",
      "\t- [[Tasks#^later|Keep later]]",
    ].join("\n"),
  );
  assert.deepEqual(editor.getCursor(), { line: 5, ch: 7 });
  assert.equal((editor.getValue().match(/- \[ \] \(\)/g) || []).length, 1);
  assert.equal(editor.getValue().includes("]]#"), false);
  assert.equal(editor.getValue().includes("🍅 [[Projects/Focus#^move-one"), false);
});

test("Pomodoro completion carries the closed Pomodoro name onto created entries", () => {
  const lines = [
    "## Pomodoros",
    "- [ ] (**1815-1905** [t:: 50m])   — RELEASE",
    "\t- [[Tasks#^ordinary-one|Ordinary one]]",
    "\t- [[Projects/Focus#^move-one|Move one]]#",
    "\t- keep this note",
    "\t- [[#^move-two]]#",
    "\t- [[Tasks#^ordinary-two|Ordinary two]]",
    "- [ ] Later",
    "\t- [[Tasks#^later|Keep later]]",
  ];
  const section = helpers.findPomodorosSectionInLines(lines);
  const plan = helpers.buildPomodoroCompletionPlan(lines, section, 1);
  const insert = plan.edits.find((edit) => edit.type === "insertLines");

  assert.ok(insert);
  assert.equal(insert.lines[0], "- [ ] () — RELEASE");
  assert.equal(plan.createdPomodoroName, "RELEASE");
  assert.deepEqual(plan.copiedBulletLines, [
    "\t- [[Tasks#^ordinary-one|Ordinary one]]",
    "\t- [[Tasks#^ordinary-two|Ordinary two]]",
    "\t- [[Projects/Focus#^move-one|Move one]]",
    "\t- [[#^move-two]]",
  ]);
});

test("buildPomodoroCompletionPlan groups a #-marked bullet above several unmarked bullets", () => {
  const lines = [
    "## Pomodoros",
    "- [ ] First",
    "  - [[A#^m1|M1]]#",
    "  - [[B#^o1|O1]]",
    "  - note in the middle",
    "  - [[C#^m2|M2]]#",
    "  - [[D#^o2|O2]]",
    "  - [[E#^o3|O3]]",
    "  - [[F#^m3|M3]]#",
  ];
  const section = helpers.findPomodorosSectionInLines(lines);
  const plan = helpers.buildPomodoroCompletionPlan(lines, section, 1);
  assert.deepEqual(plan.copiedBulletLines, [
    "  - [[B#^o1|O1]]",
    "  - [[D#^o2|O2]]",
    "  - [[E#^o3|O3]]",
    "  - [[A#^m1|M1]]",
    "  - [[C#^m2|M2]]",
    "  - [[F#^m3|M3]]",
  ]);

  const editor = createTextEditor(lines.join("\n"), { line: 1, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.scheduleCenterEditorLineInView = () => {};
  plugin.applyPomodoroCompletionPlan(editor, plan, editor.getCursor());
  assert.equal(
    editor.getValue(),
    [
      "## Pomodoros",
      "- [x] First",
      "  - 🍅 [[B#^o1|O1]]",
      "  - note in the middle",
      "  - 🍅 [[D#^o2|O2]]",
      "  - 🍅 [[E#^o3|O3]]",
      "- [ ] ()",
      "  - [[B#^o1|O1]]",
      "  - [[D#^o2|O2]]",
      "  - [[E#^o3|O3]]",
      "  - [[A#^m1|M1]]",
      "  - [[C#^m2|M2]]",
      "  - [[F#^m3|M3]]",
    ].join("\n"),
  );
});

test("buildPomodoroCompletionPlan carries a duplicate target as both an ordinary and a marked bullet", () => {
  const lines = [
    "## Pomodoros",
    "- [ ] First",
    "  - [[A#^dup|Ordinary alias]]",
    "  - [[A#^dup|Marked alias]]#",
  ];
  const section = helpers.findPomodorosSectionInLines(lines);
  const plan = helpers.buildPomodoroCompletionPlan(lines, section, 1);
  assert.deepEqual(plan.copiedBulletLines, [
    "  - [[A#^dup|Ordinary alias]]",
    "  - [[A#^dup|Marked alias]]",
  ]);
});

test("buildPomodoroCompletionPlan keeps source order when every carried link is marked", () => {
  const lines = [
    "## Pomodoros",
    "- [ ] First",
    "  - [[A#^m1|M1]]#",
    "  - [[B#^m2|M2]]#",
    "  - [[C#^m3|M3]]#",
  ];
  const section = helpers.findPomodorosSectionInLines(lines);
  const plan = helpers.buildPomodoroCompletionPlan(lines, section, 1);
  assert.deepEqual(plan.copiedBulletLines, [
    "  - [[A#^m1|M1]]",
    "  - [[B#^m2|M2]]",
    "  - [[C#^m3|M3]]",
  ]);
});

test("buildPomodoroCompletionPlan keeps source order when every carried link is unmarked", () => {
  const lines = [
    "## Pomodoros",
    "- [ ] First",
    "  - [[A#^o1|O1]]",
    "  - [[B#^o2|O2]]",
    "  - [[C#^o3|O3]]",
  ];
  const section = helpers.findPomodorosSectionInLines(lines);
  const plan = helpers.buildPomodoroCompletionPlan(lines, section, 1);
  assert.deepEqual(plan.copiedBulletLines, [
    "  - [[A#^o1|O1]]",
    "  - [[B#^o2|O2]]",
    "  - [[C#^o3|O3]]",
  ]);
});

test("Ctrl+Enter groups worked-on links above deferred marked links, keeping a note bullet in place", async () => {
  const daily = [
    "## Pomodoros",
    "- [ ] (**1110-1135** [t:: 25m])",
    "  - [[Tasks#^ordinary-one|Ordinary one]]",
    "  - [[Projects/Focus#^move-one|Move one]]#",
    "  - keep this note",
    "  - [[#^move-two]]#",
    "  - [[Tasks#^ordinary-two|Ordinary two]]",
  ].join("\n");
  const harness = createInMemoryObsidianApp({ "Daily.md": daily });
  const editor = createTextEditor(daily, { line: 1, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.scheduleCenterEditorLineInView = () => {};
  attachActiveMarkdownView(plugin, harness, editor);
  const action = registerTaskToggleVimAction(plugin);

  action({});
  await flushAsyncActions();

  assert.equal(
    editor.getValue(),
    [
      "## Pomodoros",
      "- [x] (**1110-1135** [t:: 25m])",
      "  - 🍅 [[Tasks#^ordinary-one|Ordinary one]]",
      "  - keep this note",
      "  - 🍅 [[Tasks#^ordinary-two|Ordinary two]]",
      "- [ ] ()",
      "  - [[Tasks#^ordinary-one|Ordinary one]]",
      "  - [[Tasks#^ordinary-two|Ordinary two]]",
      "  - [[Projects/Focus#^move-one|Move one]]",
      "  - [[#^move-two]]",
    ].join("\n"),
  );
});

test("deferred-only close deletes the emptied entry and carries stripped links", () => {
  const lines = [
    "## Pomodoros",
    "- [ ] (1000-1025) — FOCUS",
    "\t- [[Tasks#^a|A]]#",
    "\t- [[Tasks#^b|B]]#",
    "- [ ] Later",
    "\t- [[Tasks#^later|Keep later]]",
  ];
  const section = helpers.findPomodorosSectionInLines(lines);
  const plan = helpers.buildPomodoroCompletionPlan(lines, section, 1);
  assert.equal(plan.deferredOnlyClose, true);
  // The `#` deferral markers are stripped for the carried copies.
  assert.deepEqual(plan.copiedBulletLines, [
    "\t- [[Tasks#^a|A]]",
    "\t- [[Tasks#^b|B]]",
  ]);
  // The entry line goes as a removal, not an `[x]` rewrite, and the
  // placeholder insert still addresses the pre-edit block end.
  assert.deepEqual(
    plan.edits.map((edit) => [edit.type, edit.line]),
    [
      ["removeLine", 1],
      ["removeLine", 2],
      ["removeLine", 3],
      ["insertLines", 4],
    ],
  );
  // The cursor lands on the placeholder at the entry's former start.
  assert.equal(plan.cursorTargetLine, 1);

  const editor = createTextEditor(lines.join("\n"), { line: 1, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.scheduleCenterEditorLineInView = () => {};
  assert.equal(
    plugin.applyPomodoroCompletionPlan(editor, plan, editor.getCursor()),
    true,
  );
  assert.equal(
    editor.getValue(),
    [
      "## Pomodoros",
      "- [ ] () — FOCUS",
      "\t- [[Tasks#^a|A]]",
      "\t- [[Tasks#^b|B]]",
      "- [ ] Later",
      "\t- [[Tasks#^later|Keep later]]",
    ].join("\n"),
  );
  assert.deepEqual(editor.getCursor(), { line: 1, ch: 7 });
});

test("deferred-only close at EOF leaves no dangling newline", () => {
  const lines = [
    "## Pomodoros",
    "- [ ] (1000-1025) — FOCUS",
    "\t- [[Tasks#^a|A]]#",
  ];
  const section = helpers.findPomodorosSectionInLines(lines);
  const plan = helpers.buildPomodoroCompletionPlan(lines, section, 1);
  assert.equal(plan.deferredOnlyClose, true);

  const editor = createTextEditor(lines.join("\n"), { line: 1, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.scheduleCenterEditorLineInView = () => {};
  plugin.applyPomodoroCompletionPlan(editor, plan, editor.getCursor());
  assert.equal(
    editor.getValue(),
    ["## Pomodoros", "- [ ] () — FOCUS", "\t- [[Tasks#^a|A]]"].join("\n"),
  );
});

test("a close with a remaining copyable link keeps the [x] entry", () => {
  const lines = [
    "## Pomodoros",
    "- [ ] (1000-1025) — FOCUS",
    "\t- [[Tasks#^a|A]]#",
    "\t- [[Tasks#^b|B]]",
  ];
  const section = helpers.findPomodorosSectionInLines(lines);
  const plan = helpers.buildPomodoroCompletionPlan(lines, section, 1);
  assert.equal(plan.deferredOnlyClose, false);

  const editor = createTextEditor(lines.join("\n"), { line: 1, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.scheduleCenterEditorLineInView = () => {};
  plugin.applyPomodoroCompletionPlan(editor, plan, editor.getCursor());
  assert.equal(
    editor.getValue(),
    [
      "## Pomodoros",
      "- [x] (1000-1025) — FOCUS",
      "\t- 🍅 [[Tasks#^b|B]]",
      "- [ ] () — FOCUS",
      "\t- [[Tasks#^b|B]]",
      "\t- [[Tasks#^a|A]]",
    ].join("\n"),
  );
});

test("a prose sibling keeps the closed entry on a deferred close", () => {
  const lines = [
    "## Pomodoros",
    "- [ ] (1000-1025) — FOCUS",
    "\t- [[Tasks#^a|A]]#",
    "\t- keep this note",
  ];
  const section = helpers.findPomodorosSectionInLines(lines);
  const plan = helpers.buildPomodoroCompletionPlan(lines, section, 1);
  assert.equal(plan.deferredOnlyClose, false);

  const editor = createTextEditor(lines.join("\n"), { line: 1, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.scheduleCenterEditorLineInView = () => {};
  plugin.applyPomodoroCompletionPlan(editor, plan, editor.getCursor());
  assert.equal(
    editor.getValue(),
    [
      "## Pomodoros",
      "- [x] (1000-1025) — FOCUS",
      "\t- keep this note",
      "- [ ] () — FOCUS",
      "\t- [[Tasks#^a|A]]",
    ].join("\n"),
  );
});

test("Ctrl+Enter deferred-only close deletes the entry in one gesture", async () => {
  const daily = [
    "## Pomodoros",
    "- [ ] (1000-1025) — FOCUS",
    "\t- [[Tasks#^a|A]]#",
    "\t- [[Tasks#^b|B]]#",
  ].join("\n");
  const harness = createInMemoryObsidianApp({ "Daily.md": daily });
  const editor = createTextEditor(daily, { line: 1, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.scheduleCenterEditorLineInView = () => {};
  attachActiveMarkdownView(plugin, harness, editor);
  const action = registerTaskToggleVimAction(plugin);

  action({});
  await flushAsyncActions();

  assert.equal(
    editor.getValue(),
    ["## Pomodoros", "- [ ] () — FOCUS", "\t- [[Tasks#^a|A]]", "\t- [[Tasks#^b|B]]"].join(
      "\n",
    ),
  );
});

test("deferred-only close keeps a separated prose child and deletes fence-only leftovers whole", () => {
  // Exact move-only spelling: immediately adjacent `#`.
  const withProse = [
    "## Pomodoros",
    "- [ ] (1000-1025) — FOCUS",
    "  - [[Tasks#^a|A]]#",
    "",
    "  - retain this prose",
    "- [ ] () — NEXT",
  ];
  {
    const section = helpers.findPomodorosSectionInLines(withProse);
    const plan = helpers.buildPomodoroCompletionPlan(withProse, section, 1);
    assert.equal(plan.deferredOnlyClose, false);
    assert.equal(plan.cursorTargetLine, 4);
  }
  // Fence-only remainder: whole block goes, stripped link carried.
  const fenced = [
    "## Pomodoros",
    "- [ ] (1000-1025) — FOCUS",
    "  - [[Tasks#^a|A]]#",
    "  ```",
    "  - example",
    "  ```",
    "- [ ] () — NEXT",
  ];
  {
    const section = helpers.findPomodorosSectionInLines(fenced);
    const plan = helpers.buildPomodoroCompletionPlan(fenced, section, 1);
    assert.equal(plan.deferredOnlyClose, true);
    assert.deepEqual(plan.copiedBulletLines, ["  - [[Tasks#^a|A]]"]);
    const editor = createTextEditor(fenced.join("\n"), { line: 1, ch: 4 });
    const plugin = new TaskStatusCyclerPlugin();
    plugin.scheduleCenterEditorLineInView = () => {};
    plugin.applyPomodoroCompletionPlan(editor, plan, editor.getCursor());
    assert.equal(
      editor.getValue(),
      [
        "## Pomodoros",
        "- [ ] () — FOCUS",
        "  - [[Tasks#^a|A]]",
        "- [ ] () — NEXT",
      ].join("\n"),
    );
  }
  // LF/CRLF with and without final newline: the planner sees editor lines
  // (split by the file's own ending, so no stray `\r`), and a
  // continuation-only remainder still deletes whole-block.
  for (const ending of ["\n", "\r\n"]) {
    for (const finalNewline of [false, true]) {
      const build = (body) => body.join(ending) + (finalNewline ? ending : "");
      const raw = build([
        "## Pomodoros",
        "- [ ] (1000-1025) — FOCUS",
        "  - [[Tasks#^a|A]]#",
        "  continuation only",
        "- [ ] () — NEXT",
      ]).split(ending);
      const section = helpers.findPomodorosSectionInLines(raw);
      const plan = helpers.buildPomodoroCompletionPlan(raw, section, 1);
      assert.equal(plan.deferredOnlyClose, true);
    }
  }
});

test("deferred-only successor relocation uses the inserted placeholder", () => {
  const plugin = new TaskStatusCyclerPlugin();
  const lines = [
    "## Pomodoros",
    "- [ ] () — FOCUS",
    "  - [[Tasks#^a|A]]",
    "- [ ] Later",
  ];
  assert.equal(
    plugin.relocateSuccessorClosingEntry(lines, {
      line: 1,
      lineText: "- [ ] (1000-1025) — FOCUS",
      name: "FOCUS",
      createdPomodoro: true,
      createdName: "FOCUS",
      deletedClosedEntry: true,
      createdLineText: "- [ ] () — FOCUS",
    }),
    1,
  );
});


test("the completion plan leaves a timed headline's key and span alone unless a session clock is given", () => {
  const lines = [
    "## Pomodoros",
    "- [ ] (**1200-1300**) — MEET",
    "  - [[#^lunch]]",
    "- [ ] () — BOB",
  ];
  const section = helpers.findPomodorosSectionInLines(lines);
  const plan = helpers.buildPomodoroCompletionPlan(lines, section, 1);
  const replacements = new Map(
    plan.edits
      .filter((edit) => edit.type === "replaceLine")
      .map((edit) => [edit.line, edit.lineText]),
  );
  assert.equal(replacements.get(1), "- [x] (**1200-1300**) — MEET");
  for (const text of replacements.values()) {
    assert.equal(text.includes("[t::"), false);
  }
});

test("Ctrl+Enter close names use pre-close Task Link types and R6 outcomes", async () => {
  const lines = [
    "## Pomodoros",
    "- [ ] () — BUILD + FIX + READ",
    "\t- [[Tasks#^fix]]",
    "\t- [[Tasks#^build]]#",
    "\t- ![[Tasks#^read]]",
  ];
  const section = helpers.findPomodorosSectionInLines(lines);
  const bullets = helpers.classifyPomodoroSubBullets(
    lines,
    { startLine: 2, endLine: 5 },
  );
  const calls = {};
  const typeParts = (name) => String(name || "")
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => ({ name: part, key: part.toLowerCase(), isType: true }));
  const themes = {
    version: 1,
    effectiveTypeFor({ line, text }) {
      const taskLine = String(text || "").split("\n")[line - 1] || "";
      const match = /#(build|fix|read)\b/i.exec(taskLine);
      return match ? { theme: { key: match[1].toLowerCase() } } : null;
    },
    isMeetName: (name) => String(name || "").trim().toLowerCase() === "meet",
    typeComponentsOf: typeParts,
    narrowClosed(name, worked) {
      calls.narrow = { name, worked: worked.slice() };
      return "FIX + READ";
    },
    shed(name, before, after) {
      calls.shed = { name, before: before.slice(), after: after.slice() };
      return "BUILD + FIX";
    },
  };
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = { plugins: { plugins: { "bob-ledger-tools": { api: { themes } } } } };
  plugin.resolveTranscludedBlockTarget = async (target) => {
    const type = target.blockId;
    return {
      file: { path: "Tasks.md" },
      line: 0,
      sourceText: `- [ ] #${type} ${type} work ^${type}`,
    };
  };

  const names = await plugin.resolvePomodoroCloseNames(
    lines,
    section,
    1,
    { activePath: "Daily.md", originPath: "Daily.md" },
    bullets,
  );
  assert.deepEqual(calls.narrow, {
    name: "BUILD + FIX + READ",
    worked: ["fix", "read"],
  });
  assert.deepEqual(calls.shed, {
    name: "BUILD + FIX + READ",
    before: ["fix", "build", "read"],
    after: ["fix", "build"],
  });
  assert.deepEqual(names, {
    closedName: "FIX + READ",
    continuationName: "BUILD + FIX",
    shed: ["READ"],
  });

  const plan = helpers.buildPomodoroCompletionPlan(lines, section, 1, names);
  const closeEdit = plan.edits.find((edit) => edit.type === "replaceLine" && edit.line === 1);
  const createEdit = plan.edits.find((edit) => edit.type === "insertLines");
  assert.equal(closeEdit.lineText, "- [x] () — FIX + READ");
  assert.equal(createEdit.lines[0], "- [ ] () — BUILD + FIX");
});

test("MEET close names are passed through without resolving or shedding types", async () => {
  const lines = ["## Pomodoros", "- [ ] () — MEET"];
  const section = helpers.findPomodorosSectionInLines(lines);
  const plugin = new TaskStatusCyclerPlugin();
  let resolved = 0;
  plugin.app = {
    plugins: {
      plugins: {
        "bob-ledger-tools": {
          api: { themes: {
            version: 1,
            isMeetName: (name) => String(name).toLowerCase() === "meet",
            effectiveTypeFor: () => { resolved += 1; return null; },
            narrowClosed: () => { resolved += 1; return "changed"; },
            shed: () => { resolved += 1; return "changed"; },
          } },
        },
      },
    },
  };
  const names = await plugin.resolvePomodoroCloseNames(
    lines,
    section,
    1,
    { activePath: "Daily.md", originPath: "Daily.md" },
  );
  assert.deepEqual(names, { closedName: "MEET", continuationName: "MEET", shed: [] });
  assert.equal(resolved, 0);
});

test("Ctrl+Enter applies narrowed closed and shed continuation names", async () => {
  const daily = [
    "## Pomodoros",
    "- [ ] () — BUILD + FIX + READ",
    "\t- [[Tasks#^fix]]",
    "\t- [[Tasks#^build]]#",
    "\t- ![[Tasks#^read]]",
  ].join("\n");
  const harness = createInMemoryObsidianApp({ "Daily.md": daily });
  const editor = createTextEditor(daily, { line: 1, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.scheduleCenterEditorLineInView = () => {};
  attachActiveMarkdownView(plugin, harness, editor);
  const parts = (name) => String(name || "")
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => ({ name: part, key: part.toLowerCase(), isType: true }));
  harness.app.plugins.plugins["bob-ledger-tools"].api.themes = {
    version: 1,
    effectiveTypeFor({ line, text }) {
      const body = String(text || "").split("\n")[line - 1] || "";
      const match = /#(build|fix|read)\b/i.exec(body);
      return match ? { theme: { key: match[1].toLowerCase() } } : null;
    },
    isMeetName: (name) => String(name || "").trim().toLowerCase() === "meet",
    typeComponentsOf: parts,
    narrowClosed(name, worked) {
      const selected = new Set(worked);
      return parts(name)
        .filter((part) => selected.has(part.key))
        .map((part) => part.name)
        .join(" + ");
    },
    shed(name, before, after) {
      const prior = new Set(before);
      const carried = new Set(after);
      const original = parts(name);
      const drop = new Set(original
        .filter((part) => prior.has(part.key) && !carried.has(part.key))
        .map((part) => part.key));
      if (original.every((part) => drop.has(part.key))) {
        drop.delete(original[0].key);
      }
      return original
        .filter((part) => !drop.has(part.key))
        .map((part) => part.name)
        .join(" + ");
    },
  };
  plugin.resolveTranscludedBlockTarget = async (target) => ({
    file: { path: "Tasks.md" },
    line: 0,
    sourceText: `- [ ] #${target.blockId} work ^${target.blockId}`,
    blockId: target.blockId,
  });
  plugin.resolvePomodoroCloseClock = async () => null;
  plugin.completePomodoroTranscludedTaskBullets = async () => [];
  plugin.startPomodoroNonTranscludedTaskBullets = async () => {};
  plugin.finalizeClosedTasks = async () => {};

  assert.equal(
    await plugin.completeActivePomodoroTask(
      editor,
      harness.app.vault.getAbstractFileByPath("Daily.md"),
      { pomodoroLine: 1 },
    ),
    true,
  );
  const result = editor.getValue();
  assert.match(result, /^- \[x\] \(\) — FIX \+ READ$/m);
  assert.match(result, /^- \[ \] \(\) — BUILD \+ FIX$/m);
});

test("MEET continuations follow the last open block and keep the cursor on next work", () => {
  const lines = [
    "## Pomodoros",
    "- [ ] (**0800-0815**) — mEeT",
    "  - [[#^ended]]",
    "  - [[#^later]]#",
    "- [ ] () — BUILD",
    "  - [[#^build]]",
    "- [ ] () — PLAN",
    "  - plan note",
    "",
    "    - nested plan note",
    "- [x] (**0700-0730**) — DONE",
  ];
  const section = helpers.findPomodorosSectionInLines(lines);
  const plan = helpers.buildPomodoroCompletionPlan(lines, section, 1);
  const insert = plan.edits.find((edit) => edit.type === "insertLines");

  assert.equal(plan.placedLast, true);
  assert.equal(plan.createdPomodoroName, "mEeT");
  assert.equal(insert.line, 10);
  assert.equal(plan.cursorTargetLine, 3);

  const editor = createTextEditor(lines.join("\n"), { line: 1, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.scheduleCenterEditorLineInView = () => {};
  assert.equal(plugin.applyPomodoroCompletionPlan(editor, plan, editor.getCursor()), true);
  assert.equal(
    editor.getValue(),
    [
      "## Pomodoros",
      "- [x] (**0800-0815**) — mEeT",
      "  - 🍅 [[#^ended]]",
      "- [ ] () — BUILD",
      "  - [[#^build]]",
      "- [ ] () — PLAN",
      "  - plan note",
      "",
      "    - nested plan note",
      "- [ ] () — mEeT",
      "  - [[#^ended]]",
      "  - [[#^later]]",
      "- [x] (**0700-0730**) — DONE",
    ].join("\n"),
  );
  assert.equal(editor.getCursor().line, 3);
});

test("deferred-only MEET continuations go last and successor relocation finds them", () => {
  const lines = [
    "## Pomodoros",
    "- [ ] (**0800-0815**) — MEET",
    "  - [[#^later]]#",
    "- [ ] () — BUILD",
    "  - [[#^build]]",
    "- [ ] () — PLAN",
  ];
  const section = helpers.findPomodorosSectionInLines(lines);
  const plan = helpers.buildPomodoroCompletionPlan(lines, section, 1);
  assert.equal(plan.deferredOnlyClose, true);
  assert.equal(plan.placedLast, true);
  assert.equal(plan.edits.find((edit) => edit.type === "insertLines").line, 6);
  assert.equal(plan.cursorTargetLine, 1);

  const editor = createTextEditor(lines.join("\n"), { line: 1, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.scheduleCenterEditorLineInView = () => {};
  assert.equal(plugin.applyPomodoroCompletionPlan(editor, plan, editor.getCursor()), true);
  assert.equal(
    editor.getValue(),
    [
      "## Pomodoros",
      "- [ ] () — BUILD",
      "  - [[#^build]]",
      "- [ ] () — PLAN",
      "- [ ] () — MEET",
      "  - [[#^later]]",
    ].join("\n"),
  );
  assert.equal(editor.getCursor().line, 1);
  assert.equal(
    plugin.relocateSuccessorClosingEntry(editor.getValue().split("\n"), {
      line: 1,
      deletedClosedEntry: true,
      createdLineText: "- [ ] () — MEET",
    }),
    4,
  );
});

test("MEET without an open entry below and non-MEET closes keep the immediate slot", () => {
  const noAnchor = [
    "## Pomodoros",
    "- [ ] () — BUILD",
    "- [ ] () — MEET",
    "  - [[#^carry]]",
    "- [x] (**0700-0730**) — DONE",
  ];
  const noAnchorPlan = helpers.buildPomodoroCompletionPlan(
    noAnchor,
    helpers.findPomodorosSectionInLines(noAnchor),
    2,
  );
  assert.equal(noAnchorPlan.placedLast, false);
  assert.equal(noAnchorPlan.edits.find((edit) => edit.type === "insertLines").line, 4);

  const build = [
    "## Pomodoros",
    "- [ ] () — BUILD",
    "  - [[#^carry]]",
    "- [ ] () — PLAN",
  ];
  const buildPlan = helpers.buildPomodoroCompletionPlan(
    build,
    helpers.findPomodorosSectionInLines(build),
    1,
  );
  assert.equal(buildPlan.placedLast, false);
  assert.equal(buildPlan.edits.find((edit) => edit.type === "insertLines").line, 3);
});

test("MEET continuations ignore fenced candidates and insert before the fence", () => {
  const lines = [
    "## Pomodoros",
    "- [ ] (**0800-0815**) — MEET",
    "  - [[#^later]]#",
    "- [ ] () — BUILD",
    "```md",
    "- [ ] () — FAKE",
    "```",
  ];
  const section = helpers.findPomodorosSectionInLines(lines);
  const plan = helpers.buildPomodoroCompletionPlan(lines, section, 1);
  assert.equal(plan.placedLast, true);
  assert.equal(plan.deferredOnlyClose, true);
  assert.equal(plan.edits.find((edit) => edit.type === "insertLines").line, 4);
  assert.equal(plan.cursorTargetLine, 1);

  const editor = createTextEditor(lines.join("\n"), { line: 1, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.scheduleCenterEditorLineInView = () => {};
  assert.equal(plugin.applyPomodoroCompletionPlan(editor, plan, editor.getCursor()), true);
  assert.equal(
    editor.getValue(),
    [
      "## Pomodoros",
      "- [ ] () — BUILD",
      "- [ ] () — MEET",
      "  - [[#^later]]",
      "```md",
      "- [ ] () — FAKE",
      "```",
    ].join("\n"),
  );
  assert.equal(editor.getCursor().line, 1);
});

test("MEET continuations ignore tilde fences and indented fakes", () => {
  const tilde = [
    "## Pomodoros",
    "- [ ] (**0800-0815**) — MEET",
    "  - [[#^later]]#",
    "- [ ] () — BUILD",
    "~~~md",
    "- [ ] () — FAKE",
    "~~~",
  ];
  const tildePlan = helpers.buildPomodoroCompletionPlan(
    tilde,
    helpers.findPomodorosSectionInLines(tilde),
    1,
  );
  assert.equal(tildePlan.placedLast, true);
  assert.equal(tildePlan.edits.find((edit) => edit.type === "insertLines").line, 4);

  const indented = [
    "## Pomodoros",
    "- [ ] (**0800-0815**) — MEET",
    "  - [[#^later]]#",
    "- [ ] () — BUILD",
    "  - [[#^build]]",
    "  - [ ] () — FAKE indented",
  ];
  const indentedPlan = helpers.buildPomodoroCompletionPlan(
    indented,
    helpers.findPomodorosSectionInLines(indented),
    1,
  );
  assert.equal(indentedPlan.placedLast, true);
  assert.equal(indentedPlan.edits.find((edit) => edit.type === "insertLines").line, 6);

  const onlyFenced = [
    "## Pomodoros",
    "- [ ] (**0800-0815**) — MEET",
    "  - [[#^later]]#",
    "```md",
    "- [ ] () — FAKE",
    "```",
  ];
  const onlyPlan = helpers.buildPomodoroCompletionPlan(
    onlyFenced,
    helpers.findPomodorosSectionInLines(onlyFenced),
    1,
  );
  assert.equal(onlyPlan.placedLast, false);
  assert.equal(onlyPlan.edits.find((edit) => edit.type === "insertLines").line, 3);
});

test("MEET continuations trim trailing blanks and keep interior content", () => {
  const deferred = [
    "## Pomodoros",
    "- [ ] (**0800-0815**) — MEET",
    "  - [[#^later]]#",
    "- [ ] () — PLAN",
    "  - plan note",
    "",
    "- [x] (**0700-0730**) — DONE",
  ];
  const deferredPlan = helpers.buildPomodoroCompletionPlan(
    deferred,
    helpers.findPomodorosSectionInLines(deferred),
    1,
  );
  assert.equal(deferredPlan.placedLast, true);
  assert.equal(deferredPlan.deferredOnlyClose, true);
  assert.equal(deferredPlan.edits.find((edit) => edit.type === "insertLines").line, 5);
  assert.equal(deferredPlan.cursorTargetLine, 1);

  const deferredEditor = createTextEditor(deferred.join("\n"), { line: 1, ch: 4 });
  const deferredPlugin = new TaskStatusCyclerPlugin();
  deferredPlugin.scheduleCenterEditorLineInView = () => {};
  assert.equal(
    deferredPlugin.applyPomodoroCompletionPlan(deferredEditor, deferredPlan, deferredEditor.getCursor()),
    true,
  );
  assert.equal(
    deferredEditor.getValue(),
    [
      "## Pomodoros",
      "- [ ] () — PLAN",
      "  - plan note",
      "- [ ] () — MEET",
      "  - [[#^later]]",
      "",
      "- [x] (**0700-0730**) — DONE",
    ].join("\n"),
  );
  assert.equal(deferredEditor.getCursor().line, 1);

  const retained = [
    "## Pomodoros",
    "- [ ] (**0800-0815**) — MEET",
    "  - note keeps the closed session",
    "  - [[#^later]]#",
    "- [ ] () — PLAN",
    "  - plan note",
    "",
    "- [x] (**0700-0730**) — DONE",
  ];
  const retainedPlan = helpers.buildPomodoroCompletionPlan(
    retained,
    helpers.findPomodorosSectionInLines(retained),
    1,
  );
  assert.equal(retainedPlan.placedLast, true);
  assert.equal(retainedPlan.deferredOnlyClose, false);
  assert.equal(retainedPlan.edits.find((edit) => edit.type === "insertLines").line, 6);
  assert.equal(retainedPlan.cursorTargetLine, 3);

  const retainedEditor = createTextEditor(retained.join("\n"), { line: 1, ch: 4 });
  const retainedPlugin = new TaskStatusCyclerPlugin();
  retainedPlugin.scheduleCenterEditorLineInView = () => {};
  assert.equal(
    retainedPlugin.applyPomodoroCompletionPlan(retainedEditor, retainedPlan, retainedEditor.getCursor()),
    true,
  );
  assert.equal(
    retainedEditor.getValue(),
    [
      "## Pomodoros",
      "- [x] (**0800-0815**) — MEET",
      "  - note keeps the closed session",
      "- [ ] () — PLAN",
      "  - plan note",
      "- [ ] () — MEET",
      "  - [[#^later]]",
      "",
      "- [x] (**0700-0730**) — DONE",
    ].join("\n"),
  );
  assert.equal(retainedEditor.getCursor().line, 3);
});

test("deferred-only MEET successor lands under the created continuation, not the older MEET", () => {
  const pre = [
    "## Pomodoros",
    "- [ ] (**0800-0815**) — MEET",
    "  - [[#^later]]#",
    "- [ ] () — MEET",
    "  - [[#^existing]]",
    "- [ ] () — BUILD",
    "  - [[#^build]]",
    "- [ ] () — PLAN",
  ];
  const section = helpers.findPomodorosSectionInLines(pre);
  const plan = helpers.buildPomodoroCompletionPlan(pre, section, 1);
  assert.equal(plan.deferredOnlyClose, true);
  assert.equal(plan.placedLast, true);
  assert.equal(plan.cursorTargetLine, 1);

  const editor = createTextEditor(pre.join("\n"), { line: 1, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.scheduleCenterEditorLineInView = () => {};
  assert.equal(plugin.applyPomodoroCompletionPlan(editor, plan, editor.getCursor()), true);
  const after = editor.getValue().split("\n");
  // Created MEET is last, older MEET unchanged, cursor on BUILD.
  assert.deepEqual(after, [
    "## Pomodoros",
    "- [ ] () — MEET",
    "  - [[#^existing]]",
    "- [ ] () — BUILD",
    "  - [[#^build]]",
    "- [ ] () — PLAN",
    "- [ ] () — MEET",
    "  - [[#^later]]",
  ]);
  assert.equal(editor.getCursor().line, 1);
  assert.equal(after[editor.getCursor().line], "- [ ] () — MEET");

  // Simulate a line-shifting Work Log write above the ledger.
  const shifted = ["# shift1", "# shift2", ...after];
  const insert = plan.edits.find((edit) => edit && edit.type === "insertLines");
  const blockLines = insert.lines.slice();
  const hint = {
    line: 1,
    deletedClosedEntry: true,
    createdLineText: blockLines[0],
    createdBlockLines: blockLines.slice(),
    createdInsertLine: insert.line,
    createdPomodoro: true,
    createdName: "MEET",
  };
  const relocated = plugin.relocateSuccessorClosingEntry(shifted, hint);
  const expectedCreated = shifted.findIndex(
    (line, index) => line === "- [ ] () — MEET" && shifted[index + 1] === "  - [[#^later]]",
  );
  assert.equal(relocated, expectedCreated);
  // Older MEET still holds only its original link.
  const olderIndex = shifted.findIndex(
    (line, index) => line === "- [ ] () — MEET" && shifted[index + 1] === "  - [[#^existing]]",
  );
  assert.notEqual(olderIndex, -1);
  assert.notEqual(olderIndex, expectedCreated);

  const placements = [
    {
      key: "k1",
      rowIndex: 0,
      blockLink: "[[sase#^new-task]]",
      anchor: { kind: "closing", entryLine: relocated, bulletLine: null },
    },
  ];
  const insertion = helpers.planSuccessorInsertions(shifted, placements, {
    closingEntry: relocated,
    createdEntry: { line: relocated },
  });
  assert.equal(insertion.skipped.length, 0);
  assert.equal(insertion.links.length, 1);
  assert.equal(insertion.links[0].entry_created, true);
  assert.equal(insertion.links[0].next_up, false);
  const finalLines = insertion.text.split("\n");
  const createdAfter = finalLines.findIndex(
    (line, index) => line === "- [ ] () — MEET" && finalLines[index + 1] === "  - [[#^later]]",
  );
  // Successor joins the created continuation's children.
  assert.equal(finalLines[createdAfter + 2], "\t- [[sase#^new-task]]");
  // Older MEET unchanged: its single child is still the original link.
  const olderAfter = finalLines.findIndex(
    (line, index) => line === "- [ ] () — MEET" && finalLines[index + 1] === "  - [[#^existing]]",
  );
  assert.notEqual(olderAfter, -1);
  assert.notEqual(finalLines[olderAfter + 2], "\t- [[sase#^new-task]]");
});

test("retained MEET successor beats same-name reuse and keeps case 3 below the close", () => {
  const pre = [
    "## Pomodoros",
    "- [ ] (**0800-0815**) — MEET",
    "  - note keeps the closed session",
    "  - [[#^later]]#",
    "- [ ] () — MEET",
    "  - [[#^existing]]",
    "- [ ] () — BUILD",
    "  - [[#^build]]",
  ];
  const section = helpers.findPomodorosSectionInLines(pre);
  const plan = helpers.buildPomodoroCompletionPlan(pre, section, 1);
  assert.equal(plan.deferredOnlyClose, false);
  assert.equal(plan.placedLast, true);
  assert.equal(plan.cursorTargetLine, 3);

  const editor = createTextEditor(pre.join("\n"), { line: 1, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.scheduleCenterEditorLineInView = () => {};
  assert.equal(plugin.applyPomodoroCompletionPlan(editor, plan, editor.getCursor()), true);
  const after = editor.getValue().split("\n");
  assert.deepEqual(after, [
    "## Pomodoros",
    "- [x] (**0800-0815**) — MEET",
    "  - note keeps the closed session",
    "- [ ] () — MEET",
    "  - [[#^existing]]",
    "- [ ] () — BUILD",
    "  - [[#^build]]",
    "- [ ] () — MEET",
    "  - [[#^later]]",
  ]);
  assert.equal(editor.getCursor().line, 3);

  const shifted = ["# shift1", "# shift2", ...after];
  const insert = plan.edits.find((edit) => edit && edit.type === "insertLines");
  const blockLines = insert.lines.slice();
  // Relocate the closed [x] entry by headline despite the shift.
  const closedHint = {
    line: 1,
    lineText: "- [ ] (**0800-0815**) — MEET",
    name: "MEET",
  };
  const relocated = plugin.relocateSuccessorClosingEntry(shifted, closedHint);
  const expectedClosed = shifted.findIndex((line) => line.startsWith("- [x] (**0800-0815**)"));
  assert.equal(relocated, expectedClosed);

  // Block identity finds the created continuation, not the older same-name MEET.
  let createdLine = null;
  for (let line = relocated + 1; line + blockLines.length <= shifted.length; line += 1) {
    let matches = true;
    for (let index = 0; index < blockLines.length; index += 1) {
      if (shifted[line + index] !== blockLines[index]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      createdLine = line;
      break;
    }
  }
  const expectedCreated = shifted.findIndex(
    (line, index) => line === "- [ ] () — MEET" && shifted[index + 1] === "  - [[#^later]]",
  );
  assert.equal(createdLine, expectedCreated);
  const olderIndex = shifted.findIndex(
    (line, index) => line === "- [ ] () — MEET" && shifted[index + 1] === "  - [[#^existing]]",
  );
  assert.notEqual(olderIndex, -1);
  assert.ok(olderIndex < createdLine);

  const placements = [
    {
      key: "k1",
      rowIndex: 0,
      blockLink: "[[sase#^new-task]]",
      anchor: { kind: "closing", entryLine: relocated, bulletLine: null },
    },
  ];
  const insertion = helpers.planSuccessorInsertions(shifted, placements, {
    closingEntry: relocated,
    createdEntry: { line: createdLine },
  });
  assert.equal(insertion.links[0].entry_created, true);
  assert.equal(insertion.links[0].next_up, false);
  const finalLines = insertion.text.split("\n");
  assert.equal(finalLines[createdLine + 2], "\t- [[sase#^new-task]]");
  const olderAfter = finalLines.findIndex(
    (line, index) => line === "- [ ] () — MEET" && finalLines[index + 1] === "  - [[#^existing]]",
  );
  assert.notEqual(finalLines[olderAfter + 2], "\t- [[sase#^new-task]]");

  // Case 3 stays directly below the closed entry when no created entry exists
  // and no open same-name entry follows: a fresh FIX close with no FIX below.
  const case3Day = ["## Pomodoros", "- [x] () — FIX", "- [ ] () — BUILD"];
  const case3Section = helpers.findPomodorosSectionInLines(case3Day);
  const case3RangeEnd = helpers.getSubBulletBlockRange(case3Day, 1, case3Section).endLine;
  const case3Placements = [
    {
      key: "k1",
      rowIndex: 0,
      blockLink: "[[sase#^new-task]]",
      anchor: { kind: "closing", entryLine: 1, bulletLine: null },
    },
  ];
  const case3 = helpers.planSuccessorInsertions(case3Day, case3Placements, {
    closingEntry: 1,
  });
  // No open FIX below, so the pass mints a placeholder directly below the
  // closed entry instead of carrying the successor to the ledger end.
  const placeholderAt = case3.splices.find((splice) => splice.lines[0] === "- [ ] () — FIX");
  assert.ok(placeholderAt);
  assert.equal(placeholderAt.at, case3RangeEnd);
});
