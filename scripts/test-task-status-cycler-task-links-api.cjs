const test = require("node:test");
const assert = require("node:assert/strict");
const {
  TaskStatusCyclerPlugin,
  helpers,
  MarkdownView,
  notices,
  createInMemoryObsidianApp,
  createTextEditor,
  attachActiveMarkdownView,
  registerTaskToggleVimAction,
  flushAsyncActions,
  createCompleteAtCursorPlugin,
  installTasksCloseCommand,
} = require("./task-status-cycler-harness.cjs");

test("plain Task Link in an open Pomodoro closes the task root-only and strikes the link", async () => {
  for (const symbol of [" ", "*", "/"]) {
    const daily = [
      "## Pomodoros",
      "- [ ] (**0920-0950** [t:: 30m])",
      "\t- [[Tasks#^a]]",
    ].join("\n");
    const harness = createInMemoryObsidianApp({
      "Daily.md": daily,
      "Tasks.md": `- [${symbol}] #task A ^a`,
    });
    const editor = createTextEditor(daily, { line: 2, ch: 5 });
    const plugin = new TaskStatusCyclerPlugin();
    plugin.getCompletionDateString = () => "2026-07-16";
    plugin.scheduleCenterEditorLineInView = () => {};
    attachActiveMarkdownView(plugin, harness, editor);
    const action = registerTaskToggleVimAction(plugin);

    action({});
    await flushAsyncActions();
    await plugin.referenceMutationQueue;

    assert.equal(editor.getLine(1), "- [ ] (**0920-0950** [t:: 30m])", `symbol [${symbol}]`);
    assert.equal(editor.getLine(2), "\t- ~~[[Tasks#^a]]~~", `symbol [${symbol}]`);
    assert.match(harness.getSource("Tasks.md"), /^- \[x\] #task A .*\[completion:: 2026-07-16\] \^a/m);
    assert.equal(editor.getValue().includes("- [ ] ()"), false, `symbol [${symbol}]`);
  }
});

test("marked plain Task Link drops its marker when struck under Pomodoro ancestry", async () => {
  const daily = [
    "## Pomodoros",
    "- [ ] (**0920-0950** [t:: 30m])",
    "\t- 🍅 [[Tasks#^a|A]]",
  ].join("\n");
  const harness = createInMemoryObsidianApp({
    "Daily.md": daily,
    "Tasks.md": "- [ ] #task A ^a",
  });
  const editor = createTextEditor(daily, { line: 2, ch: 6 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.getCompletionDateString = () => "2026-07-16";
  plugin.scheduleCenterEditorLineInView = () => {};
  attachActiveMarkdownView(plugin, harness, editor);
  const action = registerTaskToggleVimAction(plugin);

  action({});
  await flushAsyncActions();
  await plugin.referenceMutationQueue;

  assert.equal(editor.getLine(1), "- [ ] (**0920-0950** [t:: 30m])");
  assert.equal(editor.getLine(2), "\t- ~~[[Tasks#^a|A]]~~");
  assert.match(harness.getSource("Tasks.md"), /^- \[x\] #task A/m);
});

test("plain Pomodoro Task Link closes root-only while embedded closes recursively", async () => {
  const daily = "## Pomodoros\n- [ ] Focus\n\t- [[Tree#^root]]";
  const tree = [
    "- [ ] #task Root ^root",
    "\t- ![[#^child]]",
    "- [ ] #task Child ^child",
  ].join("\n");
  const harness = createInMemoryObsidianApp({
    "Daily.md": daily,
    "Tree.md": tree,
  });
  const editor = createTextEditor(daily, { line: 2, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.getCompletionDateString = () => "2026-07-16";
  plugin.scheduleCenterEditorLineInView = () => {};
  attachActiveMarkdownView(plugin, harness, editor);
  const action = registerTaskToggleVimAction(plugin);

  action({});
  await flushAsyncActions();
  await plugin.referenceMutationQueue;

  assert.equal(editor.getLine(1), "- [ ] Focus");
  assert.equal(editor.getLine(2), "\t- ~~[[Tree#^root]]~~");
  assert.match(harness.getSource("Tree.md"), /^- \[x\] #task Root/m);
  assert.match(harness.getSource("Tree.md"), /^- \[ \] #task Child \^child/m);
});

test("embedded Pomodoro Task Link still closes recursively and retires to struck form", async () => {
  const daily = "## Pomodoros\n- [ ] Focus\n\t- ![[Tree#^root]]";
  const tree = [
    "- [ ] #task Root ^root",
    "\t- ![[#^child]]",
    "- [ ] #task Child ^child",
  ].join("\n");
  const harness = createInMemoryObsidianApp({
    "Daily.md": daily,
    "Tree.md": tree,
  });
  const editor = createTextEditor(daily, { line: 2, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.getCompletionDateString = () => "2026-07-16";
  plugin.scheduleCenterEditorLineInView = () => {};
  attachActiveMarkdownView(plugin, harness, editor);
  const action = registerTaskToggleVimAction(plugin);

  action({});
  await flushAsyncActions();
  await plugin.referenceMutationQueue;

  assert.equal(editor.getLine(1), "- [ ] Focus");
  assert.equal(editor.getLine(2), "\t- ~~[[Tree#^root]]~~");
  assert.match(harness.getSource("Tree.md"), /^- \[x\] #task Root/m);
  assert.match(harness.getSource("Tree.md"), /^- \[x\] #task Child/m);
});

test("Ctrl+Enter toggles a struck plain Pomodoro link back to open", async () => {
  const daily = "## Pomodoros\n- [ ] Focus\n\t- ~~[[Tasks#^a]]~~";
  const harness = createInMemoryObsidianApp({
    "Daily.md": daily,
    "Tasks.md": "- [x] #task A [completion:: 2026-07-16] ^a",
  });
  const editor = createTextEditor(daily, { line: 2, ch: 6 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.scheduleCenterEditorLineInView = () => {};
  attachActiveMarkdownView(plugin, harness, editor);
  const action = registerTaskToggleVimAction(plugin);

  action({});
  await flushAsyncActions();
  await plugin.referenceMutationQueue;

  assert.match(harness.getSource("Tasks.md"), /^- \[ \] #task A \^a/m);
  assert.equal(editor.getLine(2), "\t- [[Tasks#^a]]");
  assert.equal(editor.getLine(1), "- [ ] Focus");
});

test("same-file plain Task Link closes and strikes the correct line", async () => {
  const daily = [
    "## Pomodoros",
    "- [ ] Focus",
    "\t- [[#^a]]",
    "- [ ] #task Same-file ^a",
  ].join("\n");
  const harness = createInMemoryObsidianApp({ "Daily.md": daily });
  const editor = createTextEditor(daily, { line: 2, ch: 5 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.getCompletionDateString = () => "2026-07-16";
  plugin.scheduleCenterEditorLineInView = () => {};
  attachActiveMarkdownView(plugin, harness, editor);
  const action = registerTaskToggleVimAction(plugin);

  action({});
  await flushAsyncActions();
  await plugin.referenceMutationQueue;

  assert.equal(editor.getLine(1), "- [ ] Focus");
  assert.equal(editor.getLine(2), "\t- ~~[[#^a]]~~");
  assert.match(editor.getValue(), /^- \[x\] #task Same-file .*\[completion:: 2026-07-16\] \^a/m);
});

test("cursor selects which of several Task Links closes and strikes", async () => {
  const daily = [
    "## Pomodoros",
    "- [ ] Focus",
    "\t- [[Tasks#^a|A]] and [[Tasks#^b|B]]",
  ].join("\n");
  const tasks = [
    "- [ ] #task A ^a",
    "- [ ] #task B ^b",
  ].join("\n");
  const harness = createInMemoryObsidianApp({
    "Daily.md": daily,
    "Tasks.md": tasks,
  });
  const line = "\t- [[Tasks#^a|A]] and [[Tasks#^b|B]]";
  const secondStart = line.indexOf("[[Tasks#^b");
  const editor = createTextEditor(daily, { line: 2, ch: secondStart + 3 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.getCompletionDateString = () => "2026-07-16";
  plugin.scheduleCenterEditorLineInView = () => {};
  attachActiveMarkdownView(plugin, harness, editor);
  const action = registerTaskToggleVimAction(plugin);

  action({});
  await flushAsyncActions();
  await plugin.referenceMutationQueue;

  assert.equal(editor.getLine(1), "- [ ] Focus");
  assert.equal(editor.getLine(2), "\t- [[Tasks#^a|A]] and ~~[[Tasks#^b|B]]~~");
  assert.match(harness.getSource("Tasks.md"), /^- \[ \] #task A \^a/m);
  assert.match(harness.getSource("Tasks.md"), /^- \[x\] #task B/m);
});

test("plain links to Blocked or non-task blocks still complete the Pomodoro", async () => {
  for (const targetSource of [
    "- [?] #task Blocked ^blocked",
    "- Just a bullet ^plain",
  ]) {
    const daily = [
      "## Pomodoros",
      "- [ ] Focus",
      targetSource.includes("#task")
        ? "\t- [[Tasks#^blocked|Blocked]]"
        : "\t- [[Tasks#^plain|Plain]]",
    ].join("\n");
    const blockId = targetSource.includes("#task") ? "blocked" : "plain";
    const harness = createInMemoryObsidianApp({
      "Daily.md": daily,
      "Tasks.md": targetSource,
    });
    const editor = createTextEditor(daily, { line: 2, ch: 5 });
    const plugin = new TaskStatusCyclerPlugin();
    plugin.scheduleCenterEditorLineInView = () => {};
    attachActiveMarkdownView(plugin, harness, editor);
    const action = registerTaskToggleVimAction(plugin);

    action({});
    await flushAsyncActions();
    await plugin.referenceMutationQueue;

    assert.equal(editor.getLine(1), "- [x] Focus", targetSource);
    assert.equal(harness.getSource("Tasks.md"), targetSource, targetSource);
  }
});

test("strike and unstrike helpers are idempotent, alias-preserving, and marker-aware", () => {
  const selection = { pathPart: "Tasks", blockId: "a", startIndex: 3, embedded: false };
  assert.equal(
    helpers.strikeSelectedTaskBlockLinkInLine("\t- ~~[[Tasks#^a]]~~", selection, { pomodoro: true }),
    null,
  );
  assert.equal(
    helpers.unstrikeSelectedTaskBlockLinkInLine("\t- ~~before [[Tasks#^a]] after~~", selection),
    null,
  );
  assert.equal(
    helpers.strikeSelectedTaskBlockLinkInLine("\t- [[Tasks#^a|Alias]]", selection, { pomodoro: true }),
    "\t- ~~[[Tasks#^a|Alias]]~~",
  );
  assert.equal(
    helpers.strikeSelectedTaskBlockLinkInLine("\t- 🍅 [[Tasks#^a]]", selection, { pomodoro: false }),
    "\t- 🍅 ~~[[Tasks#^a]]~~",
  );
  assert.equal(
    helpers.strikeSelectedTaskBlockLinkInLine("\t- 🍅 [[Tasks#^a]]", selection, { pomodoro: true }),
    "\t- ~~[[Tasks#^a]]~~",
  );
  const struck = helpers.strikeSelectedTaskBlockLinkInLine("\t- [[Tasks#^a|A]]", selection, { pomodoro: true });
  assert.equal(struck, "\t- ~~[[Tasks#^a|A]]~~");
  assert.equal(
    helpers.unstrikeSelectedTaskBlockLinkInLine(struck, selection),
    "\t- [[Tasks#^a|A]]",
  );
});

test("completeTaskAtCursor closes each open symbol through the Tasks command", async () => {
  for (const symbol of [" ", "*", "/", "?"]) {
    const editor = createTextEditor(
      `- [${symbol}] #task Brush teeth ^chore`,
      { line: 0, ch: 4 },
    );
    const plugin = createCompleteAtCursorPlugin(editor);
    const { doneCommand, executed } = installTasksCloseCommand(plugin, editor);
    const finalized = [];
    plugin.finalizeClosedTasks = async (identities) => {
      finalized.push(identities);
      return { reopened: 0, retired: 0, recoveryFailures: [], retirementFailures: [] };
    };

    const result = await plugin.completeTaskAtCursor(editor);
    assert.deepEqual(result, { ok: true, lineDelta: 0, successorNotice: null }, symbol);
    assert.deepEqual(executed, [doneCommand], symbol);
    assert.equal(editor.getLine(0), "- [x] #task Brush teeth ^chore", symbol);
    assert.ok(!editor.getValue().includes("[fresh::"), symbol);
    assert.deepEqual(
      finalized,
      [[{ path: "gtd_daily.md", blockId: "chore" }]],
      symbol,
    );
  }
});

test("completeTaskAtCursor insert-above reports lineDelta 1 and never stamps", async () => {
  const editor = createTextEditor(
    "- [ ] #task Brush teeth [repeat:: every day when done] ^chore",
    { line: 0, ch: 4 },
  );
  const plugin = createCompleteAtCursorPlugin(editor);
  const { doneCommand, executed } = installTasksCloseCommand(plugin, editor, {
    insertAbove: true,
  });
  let stampCalls = 0;
  plugin.getFreshnessStampLine = () => (line, dateText) => {
    stampCalls += 1;
    return `${line} [fresh:: ${dateText}]`;
  };
  const finalized = [];
  plugin.finalizeClosedTasks = async (identities) => {
    finalized.push(identities);
    return { reopened: 0, retired: 0, recoveryFailures: [], retirementFailures: [] };
  };

  const result = await plugin.completeTaskAtCursor(editor);
  assert.deepEqual(result, { ok: true, lineDelta: 1, successorNotice: null });
  assert.deepEqual(executed, [doneCommand]);
  assert.equal(stampCalls, 0);
  assert.equal(editor.lineCount(), 2);
  assert.equal(
    editor.getLine(0),
    "- [ ] #task Brush teeth [repeat:: every day when done] ^chore",
  );
  assert.equal(
    editor.getLine(1),
    "- [x] #task Brush teeth [repeat:: every day when done] ^chore",
  );
  assert.ok(!editor.getValue().includes("[fresh::"));
  assert.deepEqual(finalized, [[{ path: "gtd_daily.md", blockId: "chore" }]]);
});

test("completeTaskAtCursor refuses closed, cancelled, and non-task lines", async () => {
  for (const [lineText, reason] of [
    ["- [x] #task Already done ^chore", "not-open"],
    ["- [-] #task Cancelled ^chore", "not-open"],
    ["- [ ] plain checkbox", "not-task"],
    ["Just a paragraph with #task in it", "not-task"],
  ]) {
    const editor = createTextEditor(lineText, { line: 0, ch: 0 });
    const plugin = createCompleteAtCursorPlugin(editor);
    const { executed } = installTasksCloseCommand(plugin, editor);
    const result = await plugin.completeTaskAtCursor(editor);
    assert.deepEqual(result, { ok: false, reason }, lineText);
    assert.deepEqual(executed, [], lineText);
    assert.equal(editor.getValue(), lineText, lineText);
  }
});

test("completeTaskAtCursor refuses a missing Tasks command with no write", async () => {
  const editor = createTextEditor("- [ ] #task Brush teeth ^chore", { line: 0, ch: 4 });
  const plugin = createCompleteAtCursorPlugin(editor);
  let wrote = false;
  const originalReplace = editor.replaceRange;
  editor.replaceRange = (...args) => {
    wrote = true;
    return originalReplace(...args);
  };
  let finalized = 0;
  plugin.finalizeClosedTasks = async () => {
    finalized += 1;
  };

  const result = await plugin.completeTaskAtCursor(editor);
  assert.deepEqual(result, { ok: false, reason: "tasks-command-missing" });
  assert.equal(wrote, false);
  assert.equal(finalized, 0);
  assert.equal(editor.getLine(0), "- [ ] #task Brush teeth ^chore");
});

test("Ctrl+Enter still refuses [?] while completeTaskAtCursor closes it", async () => {
  const lineText = "- [?] #task Brush teeth ^chore";
  const editor = createTextEditor(lineText, { line: 0, ch: 4 });
  const plugin = createCompleteAtCursorPlugin(editor);
  const view = Object.assign(new MarkdownView(), {
    editor,
    file: { path: "gtd_daily.md" },
  });
  assert.equal(plugin.handleToggleOpenDoneCommand(true, editor, view), false);
  assert.equal(plugin.handleToggleOpenDoneCommand(false, editor, view), false);
  assert.equal(editor.getValue(), lineText);

  installTasksCloseCommand(plugin, editor);
  const result = await plugin.completeTaskAtCursor(editor);
  assert.deepEqual(result, { ok: true, lineDelta: 0, successorNotice: null });
  assert.equal(editor.getLine(0), "- [x] #task Brush teeth ^chore");
});

test("completeTaskAtCursor reports not-closed when Tasks does not write [x]", async () => {
  const editor = createTextEditor("- [ ] #task Brush teeth ^chore", { line: 0, ch: 4 });
  const plugin = createCompleteAtCursorPlugin(editor);
  const doneCommand = "obsidian-tasks-plugin:set-status-symbol-to-x";
  plugin.app.commands = {
    commands: { [doneCommand]: {} },
    executeCommandById: () => true,
  };
  let finalized = 0;
  plugin.finalizeClosedTasks = async () => {
    finalized += 1;
  };

  const result = await plugin.completeTaskAtCursor(editor);
  assert.deepEqual(result, { ok: false, reason: "not-closed" });
  assert.equal(finalized, 0);
  assert.equal(editor.getLine(0), "- [ ] #task Brush teeth ^chore");
});

test("recovery api is frozen at version 2 and recovers without striking references", async () => {
  const plugin = new TaskStatusCyclerPlugin();
  plugin.addCommand = () => {};
  plugin.registerEvent = () => {};
  plugin.registerChildBulletInputListeners = () => {};
  plugin.registerPomodoroBulletToggleInputListeners = () => {};
  plugin.registerCountedTaskCycleInputListeners = () => {};
  plugin.app = {
    workspace: { on: () => ({}), onLayoutReady: () => {} },
    vault: { on: () => ({}) },
  };
  plugin.onload();

  assert.equal(plugin.api.version, 2);
  assert.equal(Object.isFrozen(plugin.api), true);
  assert.equal(typeof plugin.api.recoverBlockedDependents, "function");
  assert.equal(typeof plugin.api.completeTaskAtCursor, "function");

  const harness = createInMemoryObsidianApp({
    "Daily.md": "## Pomodoros\n- [ ] Focus\n\t- ![[Tasks#^root]]",
    "Tasks.md": [
      "- [-] #task Root [id:: root] ^root",
      "- [?] #task Dependent [dependsOn:: root] ^dependent",
    ].join("\n"),
  });
  plugin.app = harness.app;

  assert.deepEqual(
    await plugin.api.recoverBlockedDependents([], {}),
    { reopened: 0, failures: [] },
  );

  const result = await plugin.api.recoverBlockedDependents(
    [{ path: "Tasks.md", blockId: "root" }],
    {},
  );
  assert.deepEqual(result, { reopened: 1, failures: [] });
  assert.match(harness.getSource("Tasks.md"), /^- \[ \] #task Dependent .* \^dependent/m);
  assert.match(harness.getSource("Tasks.md"), /^- \[-\] #task Root \[id:: root\] \^root/m);
  assert.equal(
    harness.getSource("Daily.md"),
    "## Pomodoros\n- [ ] Focus\n\t- ![[Tasks#^root]]",
  );
});

test("recovery api never throws and reports failures", async () => {
  const plugin = new TaskStatusCyclerPlugin();
  plugin.referenceMutationQueue = Promise.resolve();
  plugin.recoverBlockedDependentsNow = async () => {
    throw new Error("vault unavailable");
  };
  const result = await plugin.recoverBlockedDependents(
    [{ path: "Tasks.md", blockId: "root" }],
    {},
  );
  assert.deepEqual(result, { reopened: 0, failures: ["vault unavailable"] });
});

test("future-scheduled dependents stay Blocked on the planner, api, and close paths", async () => {
  const documents = [
    {
      path: "Tasks.md",
      text: [
        "- [x] #task Root [id:: root] ^root",
        "- [?] #task Future bracket [dependsOn:: root] [scheduled:: 2026-10-05] ^future-bracket",
        "- [?] #task Future paren [dependsOn:: root] (scheduled:: 2026-10-05) ^future-paren",
        "- [?] #task Today [dependsOn:: root] [scheduled:: 2026-09-30] ^today",
        "- [?] #task Past [dependsOn:: root] [scheduled:: 2026-09-01] ^past",
        "- [?] #task Plain [dependsOn:: root] ^plain",
      ].join("\n"),
    },
  ];
  const plan = helpers.buildBlockedDependentRecoveryPlan(
    documents,
    [{ path: "Tasks.md", blockId: "root" }],
    { today: "2026-09-30" },
  );
  assert.deepEqual(
    plan.edits.map((edit) => edit.sourceLineText.match(/\^([^ ]+)$/)[1]).sort(),
    ["past", "plain", "today"],
  );

  const defaulted = helpers.buildBlockedDependentRecoveryPlan(documents, [
    { path: "Tasks.md", blockId: "root" },
  ]);
  assert.ok(Array.isArray(defaulted.edits));

  const harness = createInMemoryObsidianApp({
    "Tasks.md": [
      "- [x] #task Root [id:: root] ^root",
      "- [?] #task Future [dependsOn:: root] [scheduled:: 2026-10-05] ^future",
      "- [?] #task Plain [dependsOn:: root] ^plain",
    ].join("\n"),
  });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  plugin.getScheduleLogDateString = () => "2026-09-30";

  const apiResult = await plugin.recoverBlockedDependentsNow(
    [{ path: "Tasks.md", blockId: "root" }],
    {},
  );
  assert.equal(apiResult.reopened, 1);
  assert.match(harness.getSource("Tasks.md"), /^- \[\?\] #task Future/m);
  assert.match(harness.getSource("Tasks.md"), /^- \[ \] #task Plain .* \^plain/m);

  const closeHarness = createInMemoryObsidianApp({
    "Tasks.md": [
      "- [x] #task Root [id:: root] ^root",
      "- [?] #task Future [dependsOn:: root] [scheduled:: 2026-10-05] ^future",
      "- [?] #task Plain [dependsOn:: root] ^plain",
    ].join("\n"),
  });
  const closePlugin = new TaskStatusCyclerPlugin();
  closePlugin.app = closeHarness.app;
  closePlugin.getScheduleLogDateString = () => "2026-09-30";
  const finalized = await closePlugin.finalizeClosedTasks(
    [{ path: "Tasks.md", blockId: "root" }],
    {},
  );
  // One gated plan recovers Plain to its derived rank, so the reopened
  // count propagates from that same plan instead of a legacy second scan.
  assert.equal(finalized.reopened, 1);
  assert.equal(finalized.successors.unblocked.length, 1);
  assert.equal(
    finalized.successors.unblocked[0].not_linked,
    "not_planned_today",
  );
  assert.match(closeHarness.getSource("Tasks.md"), /^- \[\?\] #task Future/m);
  assert.match(closeHarness.getSource("Tasks.md"), /^- \[ \] #task Plain .* \^plain/m);
});

test("Ctrl+Enter on a Task Link to a Cancelled task leaves the Pomodoro open", async () => {
  notices.length = 0;
  const daily = [
    "## Pomodoros",
    "- [ ] (**0920-0950** [t:: 30m])",
    "\t- [[Tasks#^a]]",
  ].join("\n");
  const harness = createInMemoryObsidianApp({
    "Daily.md": daily,
    "Tasks.md": "- [-] #task A ^a",
  });
  const editor = createTextEditor(daily, { line: 2, ch: 5 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.getCompletionDateString = () => "2026-07-16";
  plugin.scheduleCenterEditorLineInView = () => {};
  attachActiveMarkdownView(plugin, harness, editor);
  const action = registerTaskToggleVimAction(plugin);

  action({});
  await flushAsyncActions();
  await plugin.referenceMutationQueue;

  assert.equal(editor.getLine(1), "- [ ] (**0920-0950** [t:: 30m])");
  assert.equal(editor.getLine(2), "\t- [[Tasks#^a]]");
  assert.equal(editor.getValue(), daily);
  assert.equal(harness.getSource("Tasks.md"), "- [-] #task A ^a");
  assert.match(notices.at(-1), /Task is cancelled; reopen it with ⌥\] first/);

  assert.deepEqual(
    await plugin.handleActiveTaskBlockLinkOpenDone(
      editor,
      harness.app.vault.getAbstractFileByPath("Daily.md"),
    ),
    { resolved: true, changed: false },
  );
  assert.equal(editor.getValue(), daily);
});

