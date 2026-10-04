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
  installTasksCloseCommand,
} = require("./task-status-cycler-harness.cjs");

test("direct open/done transitions include incomplete statuses without broadening excluded statuses", () => {
  const cases = [
    { symbol: " ", eligible: true, reopenable: false, next: "x" },
    { symbol: "*", eligible: true, reopenable: false, next: "x" },
    { symbol: "x", eligible: true, reopenable: true, next: " " },
    { symbol: "/", eligible: true, reopenable: false, next: "x" },
    { symbol: "-", eligible: false, reopenable: false, next: null },
    { symbol: "?", eligible: false, reopenable: false, next: null },
  ];

  for (const { symbol, eligible, reopenable, next } of cases) {
    const taskStatus = helpers.getTaskStatusForLine(`- [${symbol}] #task Example`);
    assert.equal(
      helpers.isOpenDoneTaskStatus(taskStatus),
      eligible,
      `eligibility for [${symbol}]`,
    );
    assert.equal(
      helpers.getNextOpenDoneSymbol(taskStatus),
      next,
      `transition for [${symbol}]`,
    );
    assert.equal(
      helpers.isTranscludedReopenableStatus(taskStatus),
      reopenable,
      `reopen policy for [${symbol}]`,
    );
  }
  assert.equal(helpers.isTranscludedReopenableStatus(null), false);
});

test("Ctrl+Enter block-link selection recognizes live and retired forms", () => {
  const cases = [
    { line: "- ![[Tasks#^embed|Embedded]]", embedded: true },
    { line: "- [[Tasks#^plain|Plain]]", embedded: false },
    { line: "- 🍅 [[Tasks#^marked|Marked]]", embedded: false },
    { line: "- ~~[[Tasks#^retired|Retired]]~~", embedded: false },
  ];
  for (const { line, embedded } of cases) {
    const target = helpers.getTaskBlockLinkTargetFromLine(
      line,
      "Daily.md",
      3,
      0,
    );
    assert.ok(target, line);
    assert.equal(target.embedded, embedded, line);
    assert.equal(target.sourcePath, "Daily.md");
  }

  const mixed = "- [[A#^first]] and 🍅 ~~[[B#^second|Second]]~~";
  assert.equal(
    helpers.getTaskBlockLinkTargetFromLine(mixed, "Daily.md", 0, 0),
    null,
  );
  assert.equal(
    helpers.getTaskBlockLinkTargetFromLine(
      mixed,
      "Daily.md",
      0,
      mixed.indexOf("🍅"),
    ).blockId,
    "second",
  );
  assert.equal(
    helpers.getTaskBlockLinkTargetFromLine("- [[A#Heading]]", "Daily.md", 0),
    null,
  );
  assert.equal(
    helpers.getTaskBlockLinkTargetFromLine("- [[A#^bad id]]", "Daily.md", 0),
    null,
  );
  assert.deepEqual(
    helpers.collectTaskBlockLinkTargetsInLineRange(
      ["- [[A#^first]]", "- [[B#^second]]"],
      "Daily.md",
      1,
      0,
    ),
    [],
  );

  const fencedEditor = createTextEditor(
    "```md\n- [[Tasks#^example]]\n```",
    { line: 1, ch: 7 },
  );
  const plugin = new TaskStatusCyclerPlugin();
  assert.equal(
    plugin.getActiveLineTaskBlockLinkTarget(fencedEditor, "Daily.md"),
    null,
  );
});

test("Pomodoro child ownership is status-neutral and bounded by contiguous list structure", () => {
  const lines = [
    "## Pomodoros",
    "- [x] Historical",
    "\t- direct child",
    "\t\t- nested child",
    "- [ ] Open",
    "  - open child",
    "  prose boundary",
    "    - orphan after prose",
    "- [/] In progress",
    "\t- progress child",
    "",
    "\t- orphan after blank",
    "- [-] Canceled",
    "\t- canceled child",
    "## Tasks",
    "\t- outside the section",
  ];

  for (const [activeLine, pomodoroLine, symbol] of [
    [2, 1, "x"],
    [3, 1, "x"],
    [5, 4, " "],
    [9, 8, "/"],
    [13, 12, "-"],
  ]) {
    const context = helpers.getOwningPomodoroContextForLine(lines, activeLine);
    assert.ok(context, `expected line ${activeLine} to resolve`);
    assert.equal(context.pomodoroLine, pomodoroLine);
    assert.equal(context.taskStatus.symbol, symbol);
    assert.equal(context.activeLine, activeLine);
  }

  for (const activeLine of [0, 1, 4, 6, 7, 8, 10, 11, 12, 14, 15]) {
    assert.equal(
      helpers.getOwningPomodoroContextForLine(lines, activeLine),
      null,
      `line ${activeLine} must not resolve across a structural boundary`,
    );
  }

  const qualifiesForParentCompletion = (activeLine) => {
    const context = helpers.getOwningPomodoroContextForLine(lines, activeLine);
    return !!context && context.taskStatus.symbol === " ";
  };
  assert.equal(qualifiesForParentCompletion(5), true);
  for (const activeLine of [2, 3, 9, 13]) {
    assert.equal(qualifiesForParentCompletion(activeLine), false);
  }
});

test("daily-note paths follow the canonical YYYY/YYYYMMDD.md layout", () => {
  assert.equal(
    helpers.getDailyNoteDateFromPath("2026/20260727.md"),
    "2026-07-27",
  );
  assert.equal(helpers.isDailyNotePath("2026/20260727.md"), true);
  assert.equal(helpers.isDailyNotePath("2024/20240229.md"), true);

  for (const path of [
    "2026/20260727_poms.md",
    "2026/20260727_done.md",
    "2025/20260727.md",
    "20260727.md",
    "2026/07/20260727.md",
    "2026/20261332.md",
    "2026/20260231.md",
    "2023/20230229.md",
    "projects/foo.md",
  ]) {
    assert.equal(
      helpers.getDailyNoteDateFromPath(path),
      null,
      `${path} must not be a daily note`,
    );
    assert.equal(helpers.isDailyNotePath(path), false);
  }
});

test("parsePomodoroEntryLineParts reads placeholder and range names conservatively", () => {
  const cases = [
    [
      "- [ ] ()",
      { placeholder: true, rangeText: "()", name: null, trailingText: "" },
    ],
    [
      "- [ ] ( )",
      { placeholder: true, rangeText: "( )", name: null, trailingText: "" },
    ],
    [
      "- [x] (**1540-1615** [t:: 35m])  — PAGER",
      {
        placeholder: false,
        rangeText: "(**1540-1615** [t:: 35m])",
        name: "PAGER",
        trailingText: "",
      },
    ],
    [
      "- [ ] (**09:20-09:50**) — DEEP WORK",
      {
        placeholder: false,
        rangeText: "(**09:20-09:50**)",
        name: "DEEP WORK",
        trailingText: "",
      },
    ],
    [
      "- [ ] () — deep work",
      {
        placeholder: true,
        rangeText: "()",
        name: "deep work",
        trailingText: "",
      },
    ],
    [
      "- [ ] () —",
      { placeholder: true, rangeText: "()", name: null, trailingText: "" },
    ],
    [
      "- [ ] () note — X",
      {
        placeholder: true,
        rangeText: "()",
        name: null,
        trailingText: " note — X",
      },
    ],
    [
      "- [x] (**0920-0950** [t:: 30m — ish])",
      {
        placeholder: false,
        rangeText: "(**0920-0950** [t:: 30m — ish])",
        name: null,
        trailingText: "",
      },
    ],
  ];

  for (const [lineText, expected] of cases) {
    assert.deepEqual(helpers.parsePomodoroEntryLineParts(lineText), expected);
  }

  assert.equal(helpers.parsePomodoroEntryLineParts("- [ ] Focus — X"), null);
  assert.equal(helpers.parsePomodoroEntryLineParts("plain text () — X"), null);
});

test("formatPomodoroPlaceholderLine keeps unnamed placeholders canonical", () => {
  for (const name of [null, "", "   \t "]) {
    assert.equal(helpers.formatPomodoroPlaceholderLine(name), "- [ ] ()");
  }

  assert.equal(
    helpers.formatPomodoroPlaceholderLine("RELEASE"),
    "- [ ] () — RELEASE",
  );
  assert.equal(
    helpers.formatPomodoroPlaceholderLine("   release prep   "),
    "- [ ] () — release prep",
  );
});

test("Pomodoro bullet toggle accepts empty indented list items", () => {
  for (const sourceLineText of [
    "\t- ",
    "  - ",
    "\t\t- ",
    "\t* ",
    "\t-   ",
    "\t-",
  ]) {
    const lines = [
      "## Pomodoros",
      "- [x] Earlier Pomodoro",
      sourceLineText,
      "## Notes",
    ];
    assert.deepEqual(
      helpers.getPomodoroBulletToggle(lines, 2),
      {
        line: 2,
        direction: "to-pomodoro",
        sourceLineText,
        lineText: "- [ ] ()",
        cursorCh: 7,
      },
      JSON.stringify(sourceLineText),
    );
  }
});

test("Pomodoro bullet toggle rejects non-empty or out-of-section bullets", () => {
  for (const sourceLineText of [
    "\t- [[sase#^read-sase-beads]]",
    "\t- [ ] ",
    "- ",
  ]) {
    assert.equal(
      helpers.getPomodoroBulletToggle(
        ["## Pomodoros", sourceLineText, "## Notes"],
        1,
      ),
      null,
      JSON.stringify(sourceLineText),
    );
  }

  assert.equal(
    helpers.getPomodoroBulletToggle(
      ["## Pomodoros", "- [x] Focus", "## Notes", "\t- "],
      3,
    ),
    null,
  );
});

test("Pomodoro bullet toggle reverses only empty open childless placeholders", () => {
  for (const sourceLineText of ["- [ ] ()", "- [ ] ( )"]) {
    assert.deepEqual(
      helpers.getPomodoroBulletToggle(
        ["## Pomodoros", sourceLineText, "## Notes"],
        1,
      ),
      {
        line: 1,
        direction: "to-bullet",
        sourceLineText,
        lineText: "\t- ",
        cursorCh: 3,
      },
      sourceLineText,
    );
  }

  for (const sourceLineText of [
    "- [ ] (**0630-0645** [t:: 15m])",
    "- [x] ()",
    "- [/] ()",
    "- [-] ()",
    "- [ ] () ^blockid",
    "- [ ] () 🍅 [[x#^y]]",
  ]) {
    assert.equal(
      helpers.getPomodoroBulletToggle(
        ["## Pomodoros", sourceLineText, "## Notes"],
        1,
      ),
      null,
      sourceLineText,
    );
  }

  assert.equal(
    helpers.getPomodoroBulletToggle(
      ["## Pomodoros", "- [ ] ()", "\t- child", "## Notes"],
      1,
    ),
    null,
  );
  assert.equal(
    helpers.getPomodoroBulletToggle(
      ["## Pomodoros", "## Notes", "- [ ] ()"],
      2,
    ),
    null,
  );
});

test("Pomodoro bullet toggle reverses named empty open childless placeholders", () => {
  assert.deepEqual(
    helpers.getPomodoroBulletToggle(
      ["## Pomodoros", "- [ ] () — RELEASE", "## Notes"],
      1,
    ),
    {
      line: 1,
      direction: "to-bullet",
      sourceLineText: "- [ ] () — RELEASE",
      lineText: "\t- ",
      cursorCh: 3,
    },
  );
});

test("Pomodoro bullet toggle round trips and normalizes child indentation", () => {
  for (const [sourceLineText, normalizedLineText] of [
    ["\t- ", "\t- "],
    ["  - ", "\t- "],
  ]) {
    const lines = ["## Pomodoros", sourceLineText, "## Notes"];
    const forward = helpers.getPomodoroBulletToggle(lines, 1);
    assert.ok(forward);
    lines[1] = forward.lineText;

    const reverse = helpers.getPomodoroBulletToggle(lines, 1);
    assert.ok(reverse);
    assert.equal(reverse.lineText, normalizedLineText);
  }
});

test("Pomodoro bullet toggle changes only the eligible line in a realistic daily shape", () => {
  const lines = [
    "## Pomodoros",
    "- [x] (**0630-0645** [t:: 15m])",
    "\t- ~~[[Tasks#^done|Done]]~~",
    "- [ ] ()",
    "\t- [[Tasks#^open|Open]]",
    "- [ ] ()",
    "\t- ",
    "## Notes",
  ];
  const original = [...lines];

  assert.equal(helpers.getPomodoroBulletToggle(lines, 1), null);
  assert.equal(helpers.getPomodoroBulletToggle(lines, 3), null);
  assert.equal(helpers.getPomodoroBulletToggle(lines, 5), null);

  const toggle = helpers.getPomodoroBulletToggle(lines, 6);
  assert.ok(toggle);
  lines[toggle.line] = toggle.lineText;
  assert.equal(lines[6], "- [ ] ()");
  for (let line = 0; line < lines.length; line += 1) {
    if (line !== 6) {
      assert.equal(lines[line], original[line], `line ${line}`);
    }
  }
});

test("Pomodoro toggle key gate does not shadow bare Option bracket cycling", () => {
  const ctrlAltRight = {
    code: "BracketRight",
    ctrlKey: true,
    altKey: true,
    shiftKey: false,
    metaKey: false,
  };
  assert.equal(helpers.getPomodoroBulletToggleKeydown(ctrlAltRight), true);
  for (const event of [
    { ...ctrlAltRight, ctrlKey: false },
    { ...ctrlAltRight, altKey: false },
    { ...ctrlAltRight, shiftKey: true },
    { ...ctrlAltRight, metaKey: true },
    { ...ctrlAltRight, code: "BracketLeft" },
  ]) {
    assert.equal(helpers.getPomodoroBulletToggleKeydown(event), false);
  }

  assert.equal(
    helpers.getOptionBracketTaskCycleDirection({
      ...ctrlAltRight,
      ctrlKey: false,
    }),
    1,
  );
  assert.equal(
    helpers.getOptionBracketTaskCycleDirection({
      ...ctrlAltRight,
      ctrlKey: false,
      code: "BracketLeft",
    }),
    -1,
  );
  assert.equal(helpers.getOptionBracketTaskCycleDirection(ctrlAltRight), null);
});

test("Pomodoro toggle command is daily-only and places the cursor for both directions", () => {
  const source = ["## Pomodoros", "- [x] Earlier", "\t- "].join("\n");
  const editor = createTextEditor(source, { line: 2, ch: 0 });
  const dailyView = Object.assign(new MarkdownView(), {
    editor,
    file: { path: "2026/20260727.md" },
  });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => dailyView.file },
  };

  assert.equal(
    plugin.handlePomodoroBulletToggleCommand(true, editor, dailyView),
    true,
  );
  assert.equal(
    plugin.handlePomodoroBulletToggleCommand(false, editor, dailyView),
    true,
  );
  assert.equal(editor.getLine(2), "- [ ] ()");
  assert.deepEqual(editor.getCursor(), { line: 2, ch: 7 });

  assert.equal(
    plugin.handlePomodoroBulletToggleCommand(false, editor, dailyView),
    true,
  );
  assert.equal(editor.getLine(2), "\t- ");
  assert.deepEqual(editor.getCursor(), { line: 2, ch: 3 });

  const nonDailyEditor = createTextEditor(source, { line: 2, ch: 0 });
  const nonDailyView = Object.assign(new MarkdownView(), {
    editor: nonDailyEditor,
    file: { path: "projects/notes.md" },
  });
  assert.equal(
    plugin.handlePomodoroBulletToggleCommand(
      false,
      nonDailyEditor,
      nonDailyView,
    ),
    false,
  );
  assert.equal(nonDailyEditor.getValue(), source);
});

test("Pomodoro Vim fallback consumes eligible keydowns once and lets others fall through", () => {
  const source = ["## Pomodoros", "- [x] Earlier", "\t- "].join("\n");
  const editor = createTextEditor(source, { line: 2, ch: 0 });
  const view = Object.assign(new MarkdownView(), {
    editor,
    file: { path: "2026/20260727.md" },
  });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => view.file },
  };
  plugin.handledPomodoroBulletToggleEvents = new WeakSet();
  plugin.getFocusedMarkdownEditorView = () => view;
  plugin.resolveNormalModeVimCm = () => ({});

  const calls = { prevent: 0, stop: 0, immediate: 0 };
  const event = {
    preventDefault: () => { calls.prevent += 1; },
    stopPropagation: () => { calls.stop += 1; },
    stopImmediatePropagation: () => { calls.immediate += 1; },
  };
  assert.equal(plugin.dispatchPomodoroBulletToggleEvent(event), true);
  assert.equal(editor.getLine(2), "- [ ] ()");
  assert.deepEqual(calls, { prevent: 1, stop: 1, immediate: 1 });
  assert.equal(plugin.dispatchPomodoroBulletToggleEvent(event), false);
  assert.deepEqual(calls, { prevent: 1, stop: 1, immediate: 1 });

  editor.setCursor({ line: 1, ch: 0 });
  const ineligibleEvent = {
    preventDefault: () => { calls.prevent += 1; },
    stopPropagation: () => { calls.stop += 1; },
  };
  assert.equal(
    plugin.dispatchPomodoroBulletToggleEvent(ineligibleEvent),
    false,
  );
  assert.deepEqual(calls, { prevent: 1, stop: 1, immediate: 1 });
});

test("Vim Ctrl+Enter dispatches task transitions and restores a reopened identity", async () => {
  const originalWindow = global.window;
  const actions = new Map();
  const mappings = [];
  const vim = {
    defineAction(name, handler) {
      actions.set(name, handler);
    },
    mapCommand(key, type, name, args, options) {
      mappings.push({ key, type, name, args, options });
    },
  };
  global.window = { CodeMirrorAdapter: { Vim: vim } };

  try {
    let lineText = "- [/] #task Complete the regression fix";
    const editor = {
      getCursor: () => ({ line: 0, ch: 6 }),
      getLine: () => lineText,
      replaceRange: () => assert.fail("Tasks command should handle the write"),
    };
    const view = Object.assign(new MarkdownView(), {
      editor,
      file: { path: "Tasks.md" },
    });
    const doneCommand = "obsidian-tasks-plugin:set-status-symbol-to-x";
    const todoCommand = "obsidian-tasks-plugin:set-status-symbol-to-space";
    const executedCommands = [];
    let restored = null;
    const plugin = new TaskStatusCyclerPlugin();
    plugin.restoreReopenedTaskReferences = async (identities) => {
      restored = identities;
      return { restored: identities.length, failures: [] };
    };
    plugin.app = {
      workspace: {
        getActiveViewOfType: (ViewType) => {
          assert.equal(ViewType, MarkdownView);
          return view;
        },
        getActiveFile: () => view.file,
      },
      commands: {
        commands: { [doneCommand]: {}, [todoCommand]: {} },
        executeCommandById: (commandId) => {
          executedCommands.push(commandId);
          return true;
        },
      },
    };

    assert.equal(plugin.registerVimMappings(), true);
    for (const key of ["<C-CR>", "<C-Enter>"]) {
      assert.ok(
        mappings.some(
          (mapping) =>
            mapping.key === key &&
            mapping.type === "action" &&
            mapping.name === "taskStatusCyclerToggleTaskOpenDone" &&
            mapping.options.context === "normal",
        ),
        `${key} should map to the direct open/done action in normal mode`,
      );
    }

    actions.get("taskStatusCyclerToggleTaskOpenDone")({});
    lineText = "- [*] #task Preserve the existing Next behavior";
    actions.get("taskStatusCyclerToggleTaskOpenDone")({});
    lineText = "- [x] #task Reopen through the Tasks command ^reopen";
    actions.get("taskStatusCyclerToggleTaskOpenDone")({});
    await Promise.resolve();
    assert.deepEqual(executedCommands, [
      doneCommand,
      doneCommand,
      todoCommand,
    ]);
    assert.deepEqual(restored, [{ path: "Tasks.md", blockId: "reopen" }]);
  } finally {
    if (originalWindow === undefined) {
      delete global.window;
    } else {
      global.window = originalWindow;
    }
  }
});

test("Ctrl+Enter on a task line wrapping an embedded transclusion closes the source task and recovers its dependents", async () => {
  const blockers = "- [ ] #task ![[Source#^target]] [created:: 2026-08-07]";
  const daily = "## Pomodoros\n- [ ] Focus\n\t- ![[Source#^target]]";
  const harness = createInMemoryObsidianApp({
    "Blockers.md": blockers,
    "Source.md": "- [/] #task Source task [id:: target] ^target",
    "Daily.md": daily,
    "Dependent.md": "- [?] #task Dependent [dependsOn:: target] ^dependent",
  });
  harness.app.commands = { commands: {}, executeCommandById: () => false };
  const editor = createTextEditor(blockers, { line: 0, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.getCompletionDateString = () => "2026-08-07";
  attachActiveMarkdownView(plugin, harness, editor, "Blockers.md");
  const action = registerTaskToggleVimAction(plugin);

  action({});
  await flushAsyncActions();
  await plugin.referenceMutationQueue;

  assert.match(editor.getValue(), /^- \[x\] #task !\[\[Source#\^target\]\] \[created:: 2026-08-07\]/);
  assert.match(
    harness.getSource("Source.md"),
    /^- \[x\] #task Source task \[id:: target\]\s+\[completion:: 2026-08-07\]\s+\^target/,
  );
  assert.match(harness.getSource("Daily.md"), /\t- ~~\[\[Source#\^target\]\]~~/);
  assert.match(harness.getSource("Dependent.md"), /^- \[ \] #task Dependent/m);
});

test("Ctrl+Enter reopen restores both the local line and the transcluded source, un-retiring references", async () => {
  const blockers =
    "- [x] #task ![[Source#^target]] [created:: 2026-08-07]  [completion:: 2026-08-07]";
  const daily = "## Pomodoros\n- [ ] Focus\n\t- ~~[[Source#^target]]~~";
  const harness = createInMemoryObsidianApp({
    "Blockers.md": blockers,
    "Source.md":
      "- [x] #task Source task [id:: target]  [completion:: 2026-08-07] ^target",
    "Daily.md": daily,
  });
  harness.app.commands = { commands: {}, executeCommandById: () => false };
  const editor = createTextEditor(blockers, { line: 0, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  attachActiveMarkdownView(plugin, harness, editor, "Blockers.md");
  const action = registerTaskToggleVimAction(plugin);

  action({});
  await flushAsyncActions();
  await plugin.referenceMutationQueue;

  assert.match(editor.getValue(), /^- \[ \] #task !\[\[Source#\^target\]\] \[created:: 2026-08-07\]/);
  assert.doesNotMatch(editor.getValue(), /completion::/);
  assert.match(harness.getSource("Source.md"), /^- \[ \] #task Source task \[id:: target\] \^target/);
  // Pomodoro-descendant restoration deliberately un-strikes to a plain link
  // rather than re-embedding it, matching the existing carry-forward convention.
  assert.match(harness.getSource("Daily.md"), /\t- \[\[Source#\^target\]\]/);
});

test("Ctrl+Enter reopening the local line over an already-open target does not accidentally close it", async () => {
  const blockers =
    "- [x] #task ![[Source#^target]] [created:: 2026-08-07]  [completion:: 2026-08-07]";
  const harness = createInMemoryObsidianApp({
    "Blockers.md": blockers,
    "Source.md": "- [ ] #task Source task [id:: target] ^target",
  });
  harness.app.commands = { commands: {}, executeCommandById: () => false };
  const editor = createTextEditor(blockers, { line: 0, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  attachActiveMarkdownView(plugin, harness, editor, "Blockers.md");
  const action = registerTaskToggleVimAction(plugin);
  const sourceBefore = harness.getSource("Source.md");

  action({});
  await flushAsyncActions();
  await plugin.referenceMutationQueue;

  assert.match(editor.getValue(), /^- \[ \] #task !\[\[Source#\^target\]\]/);
  assert.equal(harness.getSource("Source.md"), sourceBefore);
});

test("Ctrl+Enter closing the local line over an already-closed target does not write it a second time", async () => {
  const blockers = "- [ ] #task ![[Source#^target]] [created:: 2026-08-07]";
  const harness = createInMemoryObsidianApp({
    "Blockers.md": blockers,
    "Source.md":
      "- [x] #task Source task [id:: target]  [completion:: 2026-08-07] ^target",
  });
  harness.app.commands = { commands: {}, executeCommandById: () => false };
  const editor = createTextEditor(blockers, { line: 0, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  attachActiveMarkdownView(plugin, harness, editor, "Blockers.md");
  const action = registerTaskToggleVimAction(plugin);
  const sourceBefore = harness.getSource("Source.md");
  let finalizeCalls = 0;
  plugin.finalizeClosedTasks = async () => {
    finalizeCalls += 1;
    return { reopened: 0, retired: 0, recoveryFailures: [], retirementFailures: [] };
  };

  action({});
  await flushAsyncActions();
  await plugin.referenceMutationQueue;

  assert.match(editor.getValue(), /^- \[x\] #task !\[\[Source#\^target\]\]/);
  assert.equal(harness.getSource("Source.md"), sourceBefore);
  assert.equal(finalizeCalls, 0);
});

test("Ctrl+Enter hands off a claimed walk landing before Pomodoro handling", async () => {
  const source = "## Pomodoros\n- [ ] Focus\n\t- [ ] #task #gtd #pre Check weather";
  const harness = createInMemoryObsidianApp({ "Daily.md": source });
  const editor = createTextEditor(source, { line: 2, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  attachActiveMarkdownView(plugin, harness, editor, "Daily.md");
  let calls = 0;
  let receivedEditor = null;
  plugin.app.plugins = {
    plugins: {
      "bob-navigation-hotkeys": {
        api: {
          version: 2,
          claimReviewWalkCompletion(candidate) {
            calls += 1;
            receivedEditor = candidate;
            return Promise.resolve({ ok: true });
          },
        },
      },
    },
  };
  const tasks = installTasksCloseCommand(plugin, editor);
  const action = registerTaskToggleVimAction(plugin);

  action({});
  await flushAsyncActions();

  assert.equal(calls, 1);
  assert.equal(receivedEditor, editor);
  assert.equal(editor.getValue(), source);
  assert.deepEqual(tasks.executed, []);
});

test("Ctrl+Enter falls through unchanged when nav declines, is old, missing, or throws", async () => {
  const cases = [
    { name: "no plugin", api: null },
    { name: "api v1", api: { version: 1, claimReviewWalkCompletion: () => Promise.resolve() } },
    { name: "missing version", api: { claimReviewWalkCompletion: () => Promise.resolve() } },
    { name: "no member", api: { version: 2 } },
    { name: "non-promise decline", api: { version: 2, claimReviewWalkCompletion: () => null } },
    { name: "throw", api: { version: 2, claimReviewWalkCompletion() { throw new Error("no claim"); } } },
  ];

  let baseline = null;
  for (const item of cases) {
    const source = "- [ ] #task Example";
    const harness = createInMemoryObsidianApp({ "Daily.md": source });
    const editor = createTextEditor(source, { line: 0, ch: 4 });
    const plugin = new TaskStatusCyclerPlugin();
    attachActiveMarkdownView(plugin, harness, editor, "Daily.md");
    plugin.app.plugins = {
      plugins: item.api
        ? { "bob-navigation-hotkeys": { api: item.api } }
        : {},
    };
    const tasks = installTasksCloseCommand(plugin, editor);
    const action = registerTaskToggleVimAction(plugin);

    action({});
    await flushAsyncActions();

    const result = { text: editor.getValue(), commands: tasks.executed };
    if (baseline === null) baseline = result;
    assert.deepEqual(result, baseline, item.name);
    assert.match(result.text, /^- \[x\] #task Example/);
    assert.deepEqual(result.commands, [tasks.doneCommand]);
  }
});

test("Ctrl+Enter consumes a rejected nav claim without an unhandled rejection", async () => {
  const source = "- [ ] #task Example";
  const harness = createInMemoryObsidianApp({ "Daily.md": source });
  const editor = createTextEditor(source, { line: 0, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  attachActiveMarkdownView(plugin, harness, editor, "Daily.md");
  plugin.app.plugins = {
    plugins: {
      "bob-navigation-hotkeys": {
        api: {
          version: 2,
          claimReviewWalkCompletion: () => Promise.reject(new Error("claim failed")),
        },
      },
    },
  };
  const tasks = installTasksCloseCommand(plugin, editor);
  const action = registerTaskToggleVimAction(plugin);

  action({});
  await flushAsyncActions();

  assert.equal(editor.getValue(), source);
  assert.deepEqual(tasks.executed, []);
});

test("Ctrl+Enter on an unresolvable embedded transclusion still closes the local line without error", async () => {
  const blockers = "- [ ] #task ![[Missing#^nope]] [created:: 2026-08-07]";
  const harness = createInMemoryObsidianApp({ "Blockers.md": blockers });
  harness.app.commands = { commands: {}, executeCommandById: () => false };
  const editor = createTextEditor(blockers, { line: 0, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  attachActiveMarkdownView(plugin, harness, editor, "Blockers.md");
  const action = registerTaskToggleVimAction(plugin);

  action({});
  await flushAsyncActions();
  await plugin.referenceMutationQueue;

  assert.match(editor.getValue(), /^- \[x\] #task !\[\[Missing#\^nope\]\]/);
});

test("Ctrl+Enter on a task line with two embeds and the cursor outside both toggles only the local line", async () => {
  const blockers = "- [ ] #task ![[A#^a]] and ![[B#^b]] [created:: 2026-08-07]";
  const harness = createInMemoryObsidianApp({
    "Blockers.md": blockers,
    "A.md": "- [ ] #task A ^a",
    "B.md": "- [ ] #task B ^b",
  });
  harness.app.commands = { commands: {}, executeCommandById: () => false };
  const editor = createTextEditor(blockers, { line: 0, ch: 0 });
  const plugin = new TaskStatusCyclerPlugin();
  attachActiveMarkdownView(plugin, harness, editor, "Blockers.md");
  const action = registerTaskToggleVimAction(plugin);
  const aBefore = harness.getSource("A.md");
  const bBefore = harness.getSource("B.md");

  action({});
  await flushAsyncActions();
  await plugin.referenceMutationQueue;

  assert.match(editor.getValue(), /^- \[x\] #task !\[\[A#\^a\]\] and !\[\[B#\^b\]\]/);
  assert.equal(harness.getSource("A.md"), aBefore);
  assert.equal(harness.getSource("B.md"), bBefore);
});

test("Ctrl+Enter on a task line inside a fenced code block does not propagate to its embedded transclusion", async () => {
  const blockers = [
    "```md",
    "- [ ] #task ![[Source#^target]] [created:: 2026-08-07]",
    "```",
  ].join("\n");
  const harness = createInMemoryObsidianApp({
    "Blockers.md": blockers,
    "Source.md": "- [ ] #task Source task [id:: target] ^target",
  });
  harness.app.commands = { commands: {}, executeCommandById: () => false };
  const editor = createTextEditor(blockers, { line: 1, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  attachActiveMarkdownView(plugin, harness, editor, "Blockers.md");
  const action = registerTaskToggleVimAction(plugin);
  const sourceBefore = harness.getSource("Source.md");

  action({});
  await flushAsyncActions();
  await plugin.referenceMutationQueue;

  assert.equal(harness.getSource("Source.md"), sourceBefore);
});

test("Ctrl+Enter with a transcluded task line still uses the Tasks-plugin command for the local write", async () => {
  const originalWindow = global.window;
  const actions = new Map();
  const vim = {
    defineAction(name, handler) {
      actions.set(name, handler);
    },
    mapCommand() {},
  };
  global.window = { CodeMirrorAdapter: { Vim: vim } };

  try {
    const lineText = "- [ ] #task ![[Source#^target]] [created:: 2026-08-07]";
    const editor = {
      getCursor: () => ({ line: 0, ch: 6 }),
      getLine: () => lineText,
      replaceRange: () => assert.fail("Tasks command should handle the write"),
    };
    const view = Object.assign(new MarkdownView(), {
      editor,
      file: { path: "Blockers.md" },
    });
    const doneCommand = "obsidian-tasks-plugin:set-status-symbol-to-x";
    const executedCommands = [];
    const plugin = new TaskStatusCyclerPlugin();
    const harness = createInMemoryObsidianApp({
      "Blockers.md": lineText,
      "Source.md": "- [ ] #task Source task [id:: target] ^target",
    });
    plugin.app = {
      ...harness.app,
      workspace: {
        getActiveViewOfType: (ViewType) => {
          assert.equal(ViewType, MarkdownView);
          return view;
        },
        getActiveFile: () => view.file,
      },
      commands: {
        commands: { [doneCommand]: {} },
        executeCommandById: (commandId) => {
          executedCommands.push(commandId);
          return true;
        },
      },
    };

    assert.equal(plugin.registerVimMappings(), true);
    actions.get("taskStatusCyclerToggleTaskOpenDone")({});
    await flushAsyncActions();
    await plugin.referenceMutationQueue;

    assert.deepEqual(executedCommands, [doneCommand]);
    assert.match(
      harness.getSource("Source.md"),
      /^- \[x\] #task Source task \[id:: target\]\s+\[completion::/,
    );
  } finally {
    if (originalWindow === undefined) {
      delete global.window;
    } else {
      global.window = originalWindow;
    }
  }
});
