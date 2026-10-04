const test = require("node:test");
const assert = require("node:assert/strict");
const {
  TaskStatusCyclerPlugin,
  createInMemoryObsidianApp,
  createTextEditor,
  attachActiveMarkdownView,
  registerTaskToggleVimAction,
  flushAsyncActions,
} = require("./task-status-cycler-harness.cjs");

test("selected Done Pomodoro transclusion reopens only its cross-file root", async () => {
  const daily = "## Pomodoros\n- [ ] Focus\n\t- ![[Tree#^root|Work]]";
  const harness = createInMemoryObsidianApp({
    "Daily.md": daily,
    "Tree.md": [
      "- [x] #task Root [completion:: 2026-07-11] ^root",
      "\t- ![[#^child]]",
      "- [x] #task Child [completion:: 2026-07-11] ^child",
    ].join("\n"),
  });
  const editor = createTextEditor(daily, { line: 2, ch: 10 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;

  assert.deepEqual(
    await plugin.handleActiveTaskBlockLinkOpenDone(
      editor,
      harness.app.vault.getAbstractFileByPath("Daily.md"),
    ),
    { resolved: true, changed: true },
  );
  assert.equal(
    harness.getSource("Tree.md"),
    [
      "- [ ] #task Root ^root",
      "\t- ![[#^child]]",
      "- [x] #task Child [completion:: 2026-07-11] ^child",
    ].join("\n"),
  );
  assert.equal(editor.getValue(), daily);
});

test("selected same-file Done target reopens root-only in the live editor", async () => {
  const daily = [
    "## Tasks",
    "- [x] #task Root [completion:: stale] ^root",
    "\t- ![[#^child]]",
    "- [x] #task Child [completion:: stale] ^child",
    "- [ ] #task Dependency holder",
    "\t- ~~[[#^root|Root]]~~ and ~~[[#^child|Child]]~~",
    "## Pomodoros",
    "- [ ] Focus",
    "\t- ![[#^root]]",
  ].join("\n");
  const harness = createInMemoryObsidianApp({ "Daily.md": daily });
  const editor = createTextEditor(daily, { line: 8, ch: 8 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;

  assert.deepEqual(
    await plugin.handleActiveTaskBlockLinkOpenDone(
      editor,
      harness.app.vault.getAbstractFileByPath("Daily.md"),
    ),
    { resolved: true, changed: true },
  );
  assert.match(editor.getValue(), /^- \[ \] #task Root \^root/m);
  assert.match(editor.getValue(), /^- \[x\] #task Child \[completion:: stale\] \^child/m);
  assert.match(editor.getValue(), /\t- !\[\[#\^root\]\]$/m);
  assert.match(
    editor.getValue(),
    /\t- !\[\[#\^root\|Root\]\] and ~~\[\[#\^child\|Child\]\]~~/,
  );
});

test("selected retired link reopens its root and restores the historical occurrence", async () => {
  const daily = "## Pomodoros\n- [x] History\n\t- 🍅 ~~[[Tasks#^done|Alias]]~~";
  const harness = createInMemoryObsidianApp({
    "Daily.md": daily,
    "Tasks.md": "- [x] #task Done [completion:: stale] ^done",
  });
  const editor = createTextEditor(daily, { line: 2, ch: 18 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;

  assert.deepEqual(
    await plugin.handleActiveTaskBlockLinkOpenDone(
      editor,
      harness.app.vault.getAbstractFileByPath("Daily.md"),
    ),
    { resolved: true, changed: true },
  );
  assert.equal(harness.getSource("Tasks.md"), "- [ ] #task Done ^done");
  assert.equal(
    editor.getValue(),
    "## Pomodoros\n- [x] History\n\t- 🍅 [[Tasks#^done|Alias]]",
  );
});

test("incomplete selected Pomodoro transclusion still closes recursively", async () => {
  const daily = "## Pomodoros\n- [ ] Focus\n\t- ![[Tree#^root]]";
  const harness = createInMemoryObsidianApp({
    "Daily.md": daily,
    "Tree.md": [
      "- [ ] #task Root ^root",
      "\t- ![[#^child]]",
      "- [*] #task Child ^child",
    ].join("\n"),
  });
  const editor = createTextEditor(daily, { line: 2, ch: 9 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  plugin.getCompletionDateString = () => "2026-07-12";
  plugin.finalizeClosedTasks = async () => ({ reopened: 0, retired: 0 });

  assert.deepEqual(
    await plugin.handleActiveTaskBlockLinkOpenDone(
      editor,
      harness.app.vault.getAbstractFileByPath("Daily.md"),
    ),
    { resolved: true, changed: true },
  );
  assert.match(harness.getSource("Tree.md"), /^- \[x\] #task Root/m);
  assert.match(harness.getSource("Tree.md"), /^- \[x\] #task Child/m);
});

test("Done Pomodoro reopens direct roots and clears only its block-link markers", async () => {
  const daily = [
    "## Pomodoros",
    "- [x] Finished session",
    "\t- 🍅 ![[Tasks#^done|Embedded]] and 🍅 [[Tasks#^done|Duplicate]]",
    "\t- 🍅 ~~[[Tasks#^retired|Retired]]~~ and 🍅 [[Tasks#^open|Open]]",
    "\t- 🍅 [[Tasks#^progress]] and 🍅 [[Tasks#^next]] and 🍅 [[Tasks#^canceled]]",
    "\t- 🍅 [[Tasks#^custom]] and 🍅 [[Missing#^missing]] and 🍅 [[Bad#^stale]]",
    "\t- Keep this unrelated 🍅 tomato and prose exactly as written",
    "```md",
    "\t- 🍅 [[Tasks#^done|Fenced example]]",
    "```",
    "- [ ] Later session",
    "\t- 🍅 [[Tasks#^carry|Carry]]",
  ].join("\n");
  const tasks = [
    "- [x] #task Done [completion:: old] ^done",
    "\t- ![[#^child]]",
    "- [x] #task Done child [completion:: old] ^child",
    "- [X] #task Retired root [completion:: old] ^retired",
    "- [ ] #task Open ^open",
    "- [/] #task In progress ^progress",
    "- [*] #task Next ^next",
    "- [-] #task Canceled ^canceled",
    "- [?] #task Custom ^custom",
    "- [ ] #task Carry ^carry",
  ].join("\n");
  const harness = createInMemoryObsidianApp({
    "Daily.md": daily,
    "Tasks.md": tasks,
    "Bad.md": "- [x] #task Unreadable ^stale",
  });
  const originalRead = harness.app.vault.read;
  harness.app.vault.read = async (file) => {
    if (file.path === "Bad.md") throw new Error("unreadable");
    return originalRead(file);
  };
  const originalProcess = harness.app.vault.process;
  let tasksWrites = 0;
  harness.app.vault.process = async (file, updateSourceText) => {
    if (file.path === "Tasks.md") tasksWrites += 1;
    return originalProcess(file, updateSourceText);
  };
  const editor = createTextEditor(daily, { line: 1, ch: 5 });
  const originalCursor = editor.getCursor();
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;

  assert.equal(
    await plugin.reopenActivePomodoroTask(
      editor,
      harness.app.vault.getAbstractFileByPath("Daily.md"),
      plugin.getActivePomodoroTaskContext(
        editor,
        plugin.getActiveTaskStatus(editor),
        "x",
      ),
    ),
    true,
  );

  const expectedDaily = [
    "## Pomodoros",
    "- [ ] Finished session",
    "\t- ![[Tasks#^done|Embedded]] and [[Tasks#^done|Duplicate]]",
    "\t- [[Tasks#^retired|Retired]] and [[Tasks#^open|Open]]",
    "\t- [[Tasks#^progress]] and [[Tasks#^next]] and [[Tasks#^canceled]]",
    "\t- [[Tasks#^custom]] and [[Missing#^missing]] and [[Bad#^stale]]",
    "\t- Keep this unrelated 🍅 tomato and prose exactly as written",
    "```md",
    "\t- 🍅 [[Tasks#^done|Fenced example]]",
    "```",
    "- [ ] Later session",
    "\t- 🍅 [[Tasks#^carry|Carry]]",
  ].join("\n");
  assert.equal(editor.getValue(), expectedDaily);
  assert.deepEqual(editor.getCursor(), originalCursor);
  assert.equal(tasksWrites, 2, "duplicate links should not duplicate source writes");
  assert.match(harness.getSource("Tasks.md"), /^- \[ \] #task Done \^done/m);
  assert.match(harness.getSource("Tasks.md"), /^- \[ \] #task Retired root \^retired/m);
  assert.match(harness.getSource("Tasks.md"), /^- \[x\] #task Done child/m);
  assert.match(harness.getSource("Tasks.md"), /^- \[ \] #task Open/m);
  assert.match(harness.getSource("Tasks.md"), /^- \[\/\] #task In progress/m);
  assert.match(harness.getSource("Tasks.md"), /^- \[\*\] #task Next/m);
  assert.match(harness.getSource("Tasks.md"), /^- \[-\] #task Canceled/m);
  assert.match(harness.getSource("Tasks.md"), /^- \[\?\] #task Custom/m);
  assert.equal(harness.getSource("Bad.md"), "- [x] #task Unreadable ^stale");
});

test("Done Pomodoro reopen restores its own block reference after reopening direct roots", async () => {
  const daily = [
    "## Pomodoros",
    "- [x] Finished session ^session",
    "\t- ~~[[Tasks#^root|Root]]~~",
  ].join("\n");
  const tasks = [
    "- [x] #task Root [dependsOn:: keep] [id:: Tasks__root] [completion:: stale] ^root",
    "- [ ] #task Session dependency",
    "\t- ~~[[Daily#^session|Session]]~~",
  ].join("\n");
  const harness = createInMemoryObsidianApp({
    "Daily.md": daily,
    "Tasks.md": tasks,
  });
  const editor = createTextEditor(daily, { line: 1, ch: 5 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;

  assert.equal(
    await plugin.reopenActivePomodoroTask(
      editor,
      harness.app.vault.getAbstractFileByPath("Daily.md"),
      { pomodoroLine: 1 },
    ),
    true,
  );
  assert.match(editor.getValue(), /^- \[ \] Finished session \^session/m);
  assert.match(editor.getValue(), /\t- \[\[Tasks#\^root\|Root\]\]/);
  assert.match(
    harness.getSource("Tasks.md"),
    /^- \[ \] #task Root \[dependsOn:: keep\] \[id:: Tasks__root\] \^root/m,
  );
  assert.match(
    harness.getSource("Tasks.md"),
    /\t- !\[\[Daily#\^session\|Session\]\]/,
  );
});

test("Done Pomodoro markers remain when the Todo transition does not occur", async () => {
  const daily = [
    "## Pomodoros",
    "- [x] Finished session",
    "\t- 🍅 [[Missing#^stale|Keep history]]",
  ].join("\n");
  const harness = createInMemoryObsidianApp({ "Daily.md": daily });
  const editor = createTextEditor(daily, { line: 1, ch: 5 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  plugin.setActiveCheckboxStatus = () => false;

  assert.equal(
    await plugin.reopenActivePomodoroTask(
      editor,
      harness.app.vault.getAbstractFileByPath("Daily.md"),
      { pomodoroLine: 1 },
    ),
    false,
  );
  assert.equal(editor.getValue(), daily);
});

test("registered Ctrl+Enter completes an open Pomodoro from every non-selected-embed child shape", async () => {
  const cases = [
    {
      name: "prose bullet",
      children: ["\t- planning notes"],
      cursor: { line: 2, ch: 0 },
    },
    {
      name: "plain block link",
      children: ["\t- [[Missing#^plain|Plain]]"],
      cursor: { line: 2, ch: 0 },
    },
    {
      name: "marked block link",
      children: ["\t- 🍅 [[Missing#^marked|Marked]]"],
      cursor: { line: 2, ch: 0 },
    },
    {
      name: "nested bullet",
      children: ["\t- parent note", "\t\t- nested note"],
      cursor: { line: 3, ch: 0 },
    },
    {
      name: "child checkbox",
      children: ["\t- [ ] Child checkbox"],
      cursor: { line: 2, ch: 5 },
      unchangedChild: "\t- [ ] Child checkbox",
    },
    {
      name: "ambiguous embedded links",
      children: ["\t- ![[Missing#^one]] and ![[Missing#^two]]"],
      cursor: { line: 2, ch: 0 },
    },
  ];

  for (const testCase of cases) {
    const daily = [
      "## Pomodoros",
      "- [ ] Focus",
      ...testCase.children,
    ].join("\n");
    const harness = createInMemoryObsidianApp({ "Daily.md": daily });
    const editor = createTextEditor(daily, testCase.cursor);
    const plugin = new TaskStatusCyclerPlugin();
    plugin.scheduleCenterEditorLineInView = () => {};
    attachActiveMarkdownView(plugin, harness, editor);
    const action = registerTaskToggleVimAction(plugin);

    action({});
    await flushAsyncActions();

    assert.equal(editor.getLine(1), "- [x] Focus", testCase.name);
    if (testCase.unchangedChild) {
      assert.equal(editor.getLine(2), testCase.unchangedChild, testCase.name);
    }
  }
});

test("registered Ctrl+Enter immediately recovers a same-file dependent", async () => {
  const source = [
    "- [ ] #task Root [id:: root]",
    "- [?] #task Dependent [dependsOn:: root] ^dependent",
  ].join("\n");
  const harness = createInMemoryObsidianApp({ "Tasks.md": source });
  harness.app.commands = { commands: {}, executeCommandById: () => false };
  const editor = createTextEditor(source, { line: 0, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.getCompletionDateString = () => "2026-07-16";
  attachActiveMarkdownView(plugin, harness, editor, "Tasks.md");
  const action = registerTaskToggleVimAction(plugin);

  action({});
  await flushAsyncActions();
  await plugin.referenceMutationQueue;

  assert.match(editor.getValue(), /^- \[x\] #task Root \[id:: root\]/m);
  assert.match(editor.getValue(), /^- \[ \] #task Dependent/m);
});

test("registered Ctrl+Enter immediately recovers a cross-file dependent", async () => {
  const daily = "- [[Tasks#^root|Root]]";
  const harness = createInMemoryObsidianApp({
    "Daily.md": daily,
    "Tasks.md": "- [/] #task Root [id:: root] ^root",
    "Dependent.md": "- [?] #task Dependent (dependsOn:: root) ^dependent",
  });
  harness.app.commands = { commands: {}, executeCommandById: () => false };
  const editor = createTextEditor(daily, { line: 0, ch: 5 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.getCompletionDateString = () => "2026-07-16";
  attachActiveMarkdownView(plugin, harness, editor);
  const action = registerTaskToggleVimAction(plugin);

  action({});
  await flushAsyncActions();
  await plugin.referenceMutationQueue;

  assert.match(harness.getSource("Tasks.md"), /^- \[x\] #task Root/m);
  assert.match(harness.getSource("Dependent.md"), /^- \[ \] #task Dependent/m);
  assert.equal(editor.getValue(), "- ~~[[Tasks#^root|Root]]~~");
});

test("child-line Ctrl+Enter produces the same rollover and cursor target as parent completion", async () => {
  const daily = [
    "- [ ] #task Carry ^carry",
    "- [ ] #task Move ^move",
    "## Pomodoros",
    "- [ ] Focus",
    "\t- [[#^carry|Carry]]",
    "\t- [[#^move|Move]]#",
    "\t- keep this note",
    "- [ ] Later",
    "\t- later note",
  ].join("\n");

  const runCompletion = async (cursor) => {
    const harness = createInMemoryObsidianApp({ "Daily.md": daily });
    const editor = createTextEditor(daily, cursor);
    const plugin = new TaskStatusCyclerPlugin();
    plugin.scheduleCenterEditorLineInView = () => {};
    attachActiveMarkdownView(plugin, harness, editor);
    const action = registerTaskToggleVimAction(plugin);
    action({});
    await flushAsyncActions();
    return { text: editor.getValue(), cursor: editor.getCursor() };
  };

  const parentResult = await runCompletion({ line: 3, ch: 4 });
  const childResult = await runCompletion({ line: 6, ch: 6 });
  assert.deepEqual(childResult, parentResult);
  assert.equal(
    childResult.text,
    [
      "- [/] #task Carry ^carry",
      "- [ ] #task Move ^move",
      "## Pomodoros",
      "- [x] Focus",
      "\t- 🍅 [[#^carry|Carry]]",
      "\t- keep this note",
      "- [ ] ()",
      "\t- [[#^carry|Carry]]",
      "\t- [[#^move|Move]]",
      "- [ ] Later",
      "\t- later note",
    ].join("\n"),
  );
  assert.deepEqual(childResult.cursor, { line: 6, ch: 7 });
  assert.equal((childResult.text.match(/- \[ \] \(\)/g) || []).length, 1);
  assert.equal(childResult.text.includes("]]#"), false);
});

test("Ctrl+Enter preserves cross-file move-only targets while ordinary duplicates still start", async () => {
  const daily = [
    "## Pomodoros",
    "- [ ] Focus",
    "\t- [[Tasks#^todo|Todo]]#",
    "\t- [[Tasks#^next|Next]]#",
    "\t- [[Tasks#^duplicate|Ordinary duplicate]]",
    "\t- [[Tasks#^duplicate|Move-only duplicate]]#",
  ].join("\n");
  const tasks = [
    "- [ ] #task Todo ^todo",
    "- [*] #task Next ^next",
    "- [ ] #task Duplicate ^duplicate",
  ].join("\n");
  const harness = createInMemoryObsidianApp({
    "Daily.md": daily,
    "Tasks.md": tasks,
  });
  const editor = createTextEditor(daily, { line: 1, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.scheduleCenterEditorLineInView = () => {};
  attachActiveMarkdownView(plugin, harness, editor);
  const action = registerTaskToggleVimAction(plugin);

  action({});
  await flushAsyncActions();

  assert.equal(
    harness.getSource("Tasks.md"),
    [
      "- [ ] #task Todo ^todo",
      "- [*] #task Next ^next",
      "- [/] #task Duplicate ^duplicate",
    ].join("\n"),
  );
  assert.equal(editor.getLine(1), "- [x] Focus");
  assert.equal(editor.getValue().includes("]]#"), false);
});

test("selected embedded Pomodoro children keep recursive close and root-only reopen dispatch", async () => {
  for (const symbol of [" ", "/", "*"]) {
    const daily = "## Pomodoros\n- [ ] Focus\n\t- ![[Tree#^root]]";
    const tree = [
      `- [${symbol}] #task Root ^root`,
      "\t- ![[#^child]]",
      "- [/] #task Child ^child",
    ].join("\n");
    const harness = createInMemoryObsidianApp({
      "Daily.md": daily,
      "Tree.md": tree,
    });
    const editor = createTextEditor(daily, { line: 2, ch: 0 });
    const plugin = new TaskStatusCyclerPlugin();
    plugin.getCompletionDateString = () => "2026-07-16";
    plugin.finalizeClosedTasks = async () => ({ reopened: 0, retired: 0 });
    let parentCompletions = 0;
    const completeParent = plugin.completeActivePomodoroTask.bind(plugin);
    plugin.completeActivePomodoroTask = async (...args) => {
      parentCompletions += 1;
      return completeParent(...args);
    };
    attachActiveMarkdownView(plugin, harness, editor);
    const action = registerTaskToggleVimAction(plugin);

    action({});
    await flushAsyncActions();
    await plugin.referenceMutationQueue;

    assert.equal(parentCompletions, 0, `selected [${symbol}] root`);
    assert.equal(
      editor.getValue(),
      "## Pomodoros\n- [ ] Focus\n\t- ~~[[Tree#^root]]~~",
      `selected [${symbol}] root`,
    );
    assert.match(harness.getSource("Tree.md"), /^- \[x\] #task Root/m);
    assert.match(harness.getSource("Tree.md"), /^- \[x\] #task Child/m);
  }

  const daily = "## Pomodoros\n- [ ] Focus\n\t- ![[Tree#^root]]";
  const tree = [
    "- [x] #task Root [completion:: stale] ^root",
    "\t- ![[#^child]]",
    "- [x] #task Child [completion:: stale] ^child",
  ].join("\n");
  const harness = createInMemoryObsidianApp({
    "Daily.md": daily,
    "Tree.md": tree,
  });
  const editor = createTextEditor(daily, { line: 2, ch: 0 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.restoreReopenedTaskReferences = async () => ({
    restored: 0,
    failures: [],
  });
  let parentCompletions = 0;
  plugin.completeActivePomodoroTask = async () => {
    parentCompletions += 1;
    return true;
  };
  attachActiveMarkdownView(plugin, harness, editor);
  const action = registerTaskToggleVimAction(plugin);

  action({});
  await flushAsyncActions();

  assert.equal(parentCompletions, 0);
  assert.equal(editor.getLine(1), "- [ ] Focus");
  assert.match(harness.getSource("Tree.md"), /^- \[ \] #task Root \^root/m);
  assert.match(
    harness.getSource("Tree.md"),
    /^- \[x\] #task Child \[completion:: stale\] \^child/m,
  );
});

test("selected unresolved or excluded embedded children are consumed as no-ops", async () => {
  const cases = [
    { name: "stale", targetSource: null },
    { name: "non-task", targetSource: "- Plain note block ^root" },
    { name: "excluded", targetSource: "- [-] #task Canceled ^root" },
  ];

  for (const testCase of cases) {
    const daily = "## Pomodoros\n- [ ] Focus\n\t- ![[Target#^root]]";
    const sources = { "Daily.md": daily };
    if (testCase.targetSource !== null) {
      sources["Target.md"] = testCase.targetSource;
    }
    const harness = createInMemoryObsidianApp(sources);
    const editor = createTextEditor(daily, { line: 2, ch: 0 });
    const plugin = new TaskStatusCyclerPlugin();
    let parentCompletions = 0;
    plugin.completeActivePomodoroTask = async () => {
      parentCompletions += 1;
      return true;
    };
    attachActiveMarkdownView(plugin, harness, editor);
    const action = registerTaskToggleVimAction(plugin);

    action({});
    await flushAsyncActions();

    assert.equal(parentCompletions, 0, testCase.name);
    assert.equal(editor.getValue(), daily, testCase.name);
    if (testCase.targetSource !== null) {
      assert.equal(
        harness.getSource("Target.md"),
        testCase.targetSource,
        testCase.name,
      );
    }
  }
});

test("Ctrl+Enter behavior stays generic outside open Pomodoro child ranges", async () => {
  {
    const daily = "- [ ] Ordinary checkbox\n## Pomodoros\n- [ ] Focus\n\t- note";
    const harness = createInMemoryObsidianApp({ "Daily.md": daily });
    const editor = createTextEditor(daily, { line: 0, ch: 4 });
    const plugin = new TaskStatusCyclerPlugin();
    attachActiveMarkdownView(plugin, harness, editor);
    registerTaskToggleVimAction(plugin)({});
    await flushAsyncActions();
    assert.equal(editor.getLine(0), "- [x] Ordinary checkbox");
    assert.equal(editor.getLine(2), "- [ ] Focus");
  }

  {
    const daily = [
      "- [ ] Linked task ^target",
      "- [[#^target]]",
      "## Pomodoros",
      "- [ ] Focus",
      "\t- note",
    ].join("\n");
    const harness = createInMemoryObsidianApp({ "Daily.md": daily });
    const editor = createTextEditor(daily, { line: 1, ch: 0 });
    const plugin = new TaskStatusCyclerPlugin();
    attachActiveMarkdownView(plugin, harness, editor);
    registerTaskToggleVimAction(plugin)({});
    await flushAsyncActions();
    await plugin.referenceMutationQueue;
    assert.equal(editor.getLine(0), "- [x] Linked task ^target");
    assert.equal(editor.getLine(1), "- ~~[[#^target]]~~");
    assert.equal(editor.getLine(3), "- [ ] Focus");
  }

  {
    const daily = "- ![[Tasks#^a]]";
    const harness = createInMemoryObsidianApp({
      "Daily.md": daily,
      "Tasks.md": "- [ ] #task A ^a",
    });
    const editor = createTextEditor(daily, { line: 0, ch: 3 });
    const plugin = new TaskStatusCyclerPlugin();
    plugin.getCompletionDateString = () => "2026-07-16";
    attachActiveMarkdownView(plugin, harness, editor);
    const toggle = registerTaskToggleVimAction(plugin);
    toggle({});
    await flushAsyncActions();
    await plugin.referenceMutationQueue;
    assert.equal(editor.getLine(0), "- ~~[[Tasks#^a]]~~");
    assert.match(harness.getSource("Tasks.md"), /^- \[x\] #task A/m);
    toggle({});
    await flushAsyncActions();
    await plugin.referenceMutationQueue;
    assert.equal(editor.getLine(0), "- [[Tasks#^a]]");
    assert.match(harness.getSource("Tasks.md"), /^- \[ \] #task A \^a/m);
  }

  {
    const daily = "## Pomodoros\n- [x] Historical\n\t- [ ] Child checkbox";
    const harness = createInMemoryObsidianApp({ "Daily.md": daily });
    const editor = createTextEditor(daily, { line: 2, ch: 5 });
    const plugin = new TaskStatusCyclerPlugin();
    attachActiveMarkdownView(plugin, harness, editor);
    registerTaskToggleVimAction(plugin)({});
    await flushAsyncActions();
    assert.equal(editor.getLine(1), "- [x] Historical");
    assert.equal(editor.getLine(2), "\t- [x] Child checkbox");
  }

  {
    const daily = "## Pomodoros\n- [-] Canceled\n\t- ![[Tree#^root]]";
    const tree = [
      "- [x] #task Root [completion:: stale] ^root",
      "\t- ![[#^child]]",
      "- [x] #task Child [completion:: stale] ^child",
    ].join("\n");
    const harness = createInMemoryObsidianApp({
      "Daily.md": daily,
      "Tree.md": tree,
    });
    const editor = createTextEditor(daily, { line: 2, ch: 0 });
    const plugin = new TaskStatusCyclerPlugin();
    plugin.restoreReopenedTaskReferences = async () => ({
      restored: 0,
      failures: [],
    });
    attachActiveMarkdownView(plugin, harness, editor);
    registerTaskToggleVimAction(plugin)({});
    await flushAsyncActions();
    assert.equal(editor.getLine(1), "- [-] Canceled");
    assert.match(harness.getSource("Tree.md"), /^- \[ \] #task Root \^root/m);
    assert.match(harness.getSource("Tree.md"), /^- \[x\] #task Child/m);
  }
});

