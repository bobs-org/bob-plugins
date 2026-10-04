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

