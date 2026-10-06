const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  notices,
  NavigationHotkeysPlugin,
  helpers,
  TransactionEditor,
  createTaskMovePickerHarness,
  createPomodoroMovePickerHarness,
  createBulletPropertyPickerHarness,
  openPropertyStage,
  pomodoroFixtureLines,
} = require("./navigation-hotkeys-harness.cjs");

test("bullet property picker reconciles duplicate bare and counted opens", () => {
  {
    const { open, plugin } = createBulletPropertyPickerHarness();
    assert.equal(open(), true);
    const barePicker = plugin.activeBulletPropertyPicker;
    assert.equal(barePicker.isOpen, true);
    assert.equal(barePicker.taskSession, null);

    assert.equal(
      open({ countExplicit: true, additionalTaskCount: 1 }),
      true,
    );
    const countedPicker = plugin.activeBulletPropertyPicker;
    assert.notEqual(countedPicker, barePicker);
    assert.equal(barePicker.isOpen, false);
    assert.equal(countedPicker.isOpen, true);
    assert.equal(countedPicker.taskSession.explicit, true);
    assert.equal(countedPicker.taskSession.actualCount, 2);
  }

  {
    const { open, plugin } = createBulletPropertyPickerHarness();
    assert.equal(open(), true);
    const firstPicker = plugin.activeBulletPropertyPicker;
    assert.equal(open(), true);
    assert.equal(plugin.activeBulletPropertyPicker, firstPicker);
    assert.equal(firstPicker.isOpen, true);
  }

  {
    const { open, plugin } = createBulletPropertyPickerHarness();
    assert.equal(
      open({ countExplicit: true, additionalTaskCount: 1 }),
      true,
    );
    const countedPicker = plugin.activeBulletPropertyPicker;
    assert.equal(open(), true);
    assert.equal(plugin.activeBulletPropertyPicker, countedPicker);
    assert.equal(countedPicker.isOpen, true);
    assert.equal(countedPicker.taskSession.explicit, true);
  }
});

test("bullet property picker close lifecycle clears tracking for fresh sessions", async () => {
  const { editor, open, plugin } = createBulletPropertyPickerHarness();
  assert.equal(open({ countExplicit: true, additionalTaskCount: 0 }), true);
  const firstPicker = plugin.activeBulletPropertyPicker;
  const firstSession = firstPicker.taskSession;

  // Obsidian's Escape handling closes the modal through this lifecycle.
  firstPicker.close();
  assert.equal(plugin.activeBulletPropertyPicker, null);

  editor.cursor = { line: 1, ch: 0 };
  assert.equal(open({ countExplicit: true, additionalTaskCount: 0 }), true);
  const secondPicker = plugin.activeBulletPropertyPicker;
  assert.notEqual(secondPicker.taskSession, firstSession);
  assert.deepEqual(
    secondPicker.taskSession.targets.map((target) => target.line),
    [1],
  );

  await openPropertyStage(secondPicker, "p");
  assert.equal(plugin.activeBulletPropertyPicker, secondPicker);
  await secondPicker.openItemAtIndex(0);
  assert.equal(plugin.activeBulletPropertyPicker, null);
  assert.match(editor.getLine(1), /\[p:: high\]/);

  editor.cursor = { line: 2, ch: 0 };
  assert.equal(open({ countExplicit: true, additionalTaskCount: 0 }), true);
  const thirdPicker = plugin.activeBulletPropertyPicker;
  assert.notEqual(thirdPicker.taskSession, secondPicker.taskSession);
  assert.deepEqual(
    thirdPicker.taskSession.targets.map((target) => target.line),
    [2],
  );
  assert.equal(thirdPicker.isOpen, true);
});

test("task move picker reconciles duplicate bare and counted opens", () => {
  {
    const { editor, plugin, view } = createTaskMovePickerHarness();
    assert.equal(plugin.openTaskMoveDestinationPicker(editor, view), true);
    const barePicker = plugin.activeTaskMoveDestinationPicker;
    assert.equal(barePicker.isOpen, true);
    assert.equal(barePicker.session.countExplicit, false);

    assert.equal(
      plugin.openTaskMoveDestinationPicker(editor, view, {
        countExplicit: true,
        additionalTaskCount: 1,
      }),
      true,
    );
    const countedPicker = plugin.activeTaskMoveDestinationPicker;
    assert.notEqual(countedPicker, barePicker);
    assert.equal(barePicker.isOpen, false);
    assert.equal(countedPicker.isOpen, true);
    assert.equal(countedPicker.session.countExplicit, true);
    assert.equal(countedPicker.session.discovery.actualCount, 2);
  }

  {
    const { editor, plugin, view } = createTaskMovePickerHarness();
    assert.equal(plugin.openTaskMoveDestinationPicker(editor, view), true);
    const firstPicker = plugin.activeTaskMoveDestinationPicker;
    assert.equal(plugin.openTaskMoveDestinationPicker(editor, view), true);
    assert.equal(plugin.activeTaskMoveDestinationPicker, firstPicker);
    assert.equal(firstPicker.isOpen, true);
  }

  {
    const { editor, plugin, view } = createTaskMovePickerHarness();
    assert.equal(
      plugin.openTaskMoveDestinationPicker(editor, view, {
        countExplicit: true,
        additionalTaskCount: 1,
      }),
      true,
    );
    const countedPicker = plugin.activeTaskMoveDestinationPicker;
    assert.equal(plugin.openTaskMoveDestinationPicker(editor, view), true);
    assert.equal(plugin.activeTaskMoveDestinationPicker, countedPicker);
    assert.equal(countedPicker.isOpen, true);
    assert.equal(countedPicker.session.countExplicit, true);
  }
});

test("task move picker close lifecycle clears tracking for fresh sessions", async () => {
  const { editor, plugin, view } = createTaskMovePickerHarness();
  assert.equal(plugin.openTaskMoveDestinationPicker(editor, view), true);
  const firstPicker = plugin.activeTaskMoveDestinationPicker;

  firstPicker.close();
  assert.equal(plugin.activeTaskMoveDestinationPicker, null);

  editor.cursor = { line: 1, ch: 0 };
  assert.equal(plugin.openTaskMoveDestinationPicker(editor, view), true);
  const secondPicker = plugin.activeTaskMoveDestinationPicker;
  assert.notEqual(secondPicker.session, firstPicker.session);
  assert.deepEqual(secondPicker.session.cursor, { line: 1, ch: 0 });

  const selection = secondPicker.openItemAtIndex(0);
  assert.equal(plugin.activeTaskMoveDestinationPicker, null);
  await selection;

  editor.cursor = { line: 2, ch: 0 };
  assert.equal(plugin.openTaskMoveDestinationPicker(editor, view), true);
  const thirdPicker = plugin.activeTaskMoveDestinationPicker;
  assert.notEqual(thirdPicker.session, secondPicker.session);
  assert.deepEqual(thirdPicker.session.cursor, { line: 2, ch: 0 });
  assert.equal(thirdPicker.isOpen, true);
});

test("Pomodoro bullet move picker opens sessions and clears the shared move picker slot", () => {
  const { editor, plugin, view } = createPomodoroMovePickerHarness({
    cursor: { line: 2, ch: 0 },
  });
  assert.equal(
    plugin.openPomodoroBulletMovePicker(editor, view, {
      countExplicit: true,
      additionalTaskCount: 1,
    }),
    true,
  );
  const picker = plugin.activeTaskMoveDestinationPicker;
  assert.equal(picker instanceof helpers.PomodoroBulletMovePickerModal, true);
  assert.equal(picker.isOpen, true);
  assert.equal(
    picker.placeholder,
    "Filter open Pomodoros, type a name, = same, or =NAME split",
  );
  assert.equal(picker.session.countExplicit, true);
  assert.deepEqual(
    picker.session.discovery.targets.map((target) => target.line),
    [2, 3],
  );

  picker.close();
  assert.equal(plugin.activeTaskMoveDestinationPicker, null);
});

test("Ctrl+Shift+M dispatcher preserves task moves and routes Pomodoro sub-bullets and entries", () => {
  const plugin = new NavigationHotkeysPlugin();
  const calls = [];
  plugin.openTaskMoveDestinationPicker = () => {
    calls.push("task");
    return "task";
  };
  plugin.openPomodoroBulletMovePicker = () => {
    calls.push("pomodoro");
    return "pomodoro";
  };
  plugin.openPomodoroEntryMovePicker = () => {
    calls.push("pomodoro-entry");
    return "pomodoro-entry";
  };

  const taskEditor = new TransactionEditor("- [ ] #task Outside ^outside", {
    line: 0,
    ch: 0,
  });
  assert.equal(
    plugin.openTaskMoveOrPomodoroBulletPicker(taskEditor, {
      editor: taskEditor,
      file: { path: "Tasks.md", extension: "md" },
    }),
    "task",
  );

  const pomodoroEditor = new TransactionEditor(
    pomodoroFixtureLines().join("\n"),
    { line: 5, ch: 0 },
  );
  assert.equal(
    plugin.openTaskMoveOrPomodoroBulletPicker(pomodoroEditor, {
      editor: pomodoroEditor,
      file: { path: "Daily/2026-08-26.md", extension: "md" },
    }),
    "pomodoro",
  );

  const entryEditor = new TransactionEditor(
    pomodoroFixtureLines().join("\n"),
    { line: 9, ch: 0 },
  );
  assert.equal(
    plugin.openTaskMoveOrPomodoroBulletPicker(entryEditor, {
      editor: entryEditor,
      file: { path: "Daily/2026-08-26.md", extension: "md" },
    }),
    "pomodoro-entry",
  );
  assert.deepEqual(calls, ["task", "pomodoro", "pomodoro-entry"]);
});

test("move task command keeps Ctrl+Shift+M binding and calls the combined dispatcher", () => {
  const plugin = new NavigationHotkeysPlugin();
  const commands = [];
  let routed = null;
  plugin.app = {
    workspace: {
      getActiveFile: () => null,
      on: () => ({}),
      onLayoutReady: () => {},
    },
  };
  plugin.addCommand = (command) => commands.push(command);
  plugin.register = () => {};
  plugin.registerEvent = () => {};
  plugin.registerVimMappingsWhenReady = () => {};
  plugin.registerOpenTaskJumpInputListeners = () => {};
  plugin.registerCountedTransclusionToggleInputListeners = () => {};
  plugin.registerCountedBulletPropertyInputListeners = () => {};
  plugin.registerCountedTaskMoveInputListeners = () => {};
  plugin.registerClearSearchHighlightInputListeners = () => {};
  plugin.openTaskMoveOrPomodoroBulletPicker = (editor, view) => {
    routed = { editor, view };
    return true;
  };

  plugin.onload();
  const command = commands.find((item) => item.id === "move-tasks-to-note");
  assert.ok(command);
  assert.deepEqual(command.hotkeys, [{ modifiers: ["Ctrl", "Shift"], key: "M" }]);

  const editor = {};
  const view = {};
  assert.equal(command.editorCallback(editor, view), true);
  assert.deepEqual(routed, { editor, view });
});

test("commitPomodoroBulletMoveSession applies one guarded same-file transaction", async () => {
  notices.length = 0;
  const { editor, plugin, sourceFile, view } = createPomodoroMovePickerHarness({
    cursor: { line: 5, ch: 999 },
  });
  const sourceContent = editor.getValue();
  const discovery = helpers.discoverMovablePomodoroBulletTargets(
    sourceContent,
    5,
    0,
  );
  const rows = helpers.createPomodoroBulletMovePickerRows(
    discovery.context.entries,
    discovery.entryLine,
    "verify",
  );
  const row = rows.find((item) => item.kind === "existing");
  const expectedPlan = helpers.planPomodoroBulletMove(sourceContent, {
    targets: discovery.targets,
    sourceEntryLine: discovery.entryLine,
    destination: { kind: "existing", entryLine: row.entry.entryLine },
  });
  const session = Object.freeze({
    sourceFile,
    sourcePath: sourceFile.path,
    sourceView: view,
    editor,
    sourceContent,
    cursor: Object.freeze({ line: 5, ch: 999 }),
    scroll: null,
    countExplicit: false,
    discovery,
    entries: discovery.context.entries,
    sourceEntry: discovery.context.entry,
  });

  assert.equal(expectedPlan.sourcePomodoroDeleted, true);
  assert.equal(await plugin.commitPomodoroBulletMoveSession(session, row), true);
  assert.equal(editor.getValue(), expectedPlan.after);
  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.undoGroups, 1);
  assert.deepEqual(editor.cursor, {
    line: expectedPlan.firstMovedLine,
    ch: expectedPlan.after.split("\n")[expectedPlan.firstMovedLine].length,
  });
  assert.equal(notices.at(-1), "Moved 1 bullet to VERIFY");
});

test("Pomodoro bullet move picker confirms = through the actual picker callback", async () => {
  notices.length = 0;
  const content = [
    "## Pomodoros",
    "- [ ] () — FOCUS",
    "\t- keep",
    "\t- move",
    "- [ ] () — FOCUS",
    "\t- existing",
  ].join("\n");
  const { editor, plugin, view } = createPomodoroMovePickerHarness({
    content,
    cursor: { line: 3, ch: 999 },
  });

  assert.equal(plugin.openPomodoroBulletMovePicker(editor, view), true);
  const picker = plugin.activeTaskMoveDestinationPicker;
  assert.match(picker.getSubtitle(), /= same name · =NAME split/);
  picker.inputEl = { value: "  =  " };
  picker.visibleItems = picker.getFilteredItems();
  assert.deepEqual(picker.visibleItems, [
    {
      kind: "new",
      name: "FOCUS",
      title: "New Pomodoro FOCUS",
      meta: "Created below the current Pomodoro",
    },
  ]);

  await picker.openItemAtIndex(0);

  const expected = [
    "## Pomodoros",
    "- [ ] () — FOCUS",
    "\t- keep",
    "- [ ] () — FOCUS",
    "\t- move",
    "- [ ] () — FOCUS",
    "\t- existing",
  ].join("\n");
  assert.equal(editor.getValue(), expected);
  assert.equal(plugin.activeTaskMoveDestinationPicker, null);
  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.undoGroups, 1);
  assert.deepEqual(editor.cursor, { line: 4, ch: "\t- move".length });
  assert.equal(notices.at(-1), "Moved 1 bullet to new Pomodoro FOCUS");
});

test("Pomodoro bullet move picker reserves =NAME for peeling a named merged component", () => {
  const content = [
    "## Pomodoros",
    "- [ ] () — BUILD + REVIEW + EMAIL",
    "\t- build",
    "\t- email",
    "- [ ] () — OTHER",
  ].join("\n");
  const discovery = helpers.discoverMovablePomodoroBulletTargets(content, 3, 0);
  const splitRows = helpers.createPomodoroBulletMovePickerRows(
    discovery.context.entries,
    discovery.entryLine,
    "=email",
  );
  assert.deepEqual(splitRows, [
    {
      kind: "split",
      name: "EMAIL",
      remainingName: "BUILD + REVIEW",
      title: "Split off EMAIL",
      meta: "Creates a new Pomodoro below; source becomes BUILD + REVIEW",
      badge: "Split",
    },
  ]);

  const middleRows = helpers.createPomodoroBulletMovePickerRows(
    discovery.context.entries,
    discovery.entryLine,
    "= review",
  );
  assert.deepEqual(middleRows, [
    {
      kind: "split",
      name: "REVIEW",
      remainingName: "BUILD + EMAIL",
      title: "Split off REVIEW",
      meta: "Creates a new Pomodoro below; source becomes BUILD + EMAIL",
      badge: "Split",
    },
  ]);

  const sameNameRows = helpers.createPomodoroBulletMovePickerRows(
    discovery.context.entries,
    discovery.entryLine,
    "=",
  );
  assert.equal(sameNameRows[0].kind, "new");
  assert.equal(sameNameRows[0].name, "BUILD + REVIEW + EMAIL");

  const plusRows = helpers.createPomodoroBulletMovePickerRows(
    discovery.context.entries,
    discovery.entryLine,
    "+",
  );
  assert.equal(plusRows[0].kind, "new");
  assert.equal(plusRows[0].name, "+");

  const doublePlusRows = helpers.createPomodoroBulletMovePickerRows(
    discovery.context.entries,
    discovery.entryLine,
    "++",
  );
  assert.equal(doublePlusRows[0].kind, "new");
  assert.equal(doublePlusRows[0].name, "++");
  assert.equal(
    doublePlusRows.some((row) => row.kind === "split"),
    false,
  );

  const cPlusPlusRows = helpers.createPomodoroBulletMovePickerRows(
    discovery.context.entries,
    discovery.entryLine,
    "C++",
  );
  assert.equal(cPlusPlusRows[0].kind, "new");
  assert.equal(cPlusPlusRows[0].name, "C++");

  const entryPlusPlusRows = helpers.createPomodoroBulletMovePickerRows(
    discovery.context.entries,
    discovery.entryLine,
    "++",
    { mode: "entry" },
  );
  assert.equal(entryPlusPlusRows[0].kind, "rename");
  assert.equal(entryPlusPlusRows[0].name, "++");

  const entryEqualsRows = helpers.createPomodoroBulletMovePickerRows(
    discovery.context.entries,
    discovery.entryLine,
    "=",
    { mode: "entry" },
  );
  assert.equal(entryEqualsRows[0].kind, "rename");
  assert.equal(entryEqualsRows[0].name, "=");

  const entryEqualsNameRows = helpers.createPomodoroBulletMovePickerRows(
    discovery.context.entries,
    discovery.entryLine,
    "=EMAIL",
    { mode: "entry" },
  );
  assert.equal(entryEqualsNameRows[0].kind, "rename");
  assert.equal(entryEqualsNameRows[0].name, "=EMAIL");

  const missingComponentRows = helpers.createPomodoroBulletMovePickerRows(
    discovery.context.entries,
    discovery.entryLine,
    "=focus",
  );
  assert.deepEqual(missingComponentRows, [
    {
      kind: "invalid",
      statusText: "FOCUS is not part of this Pomodoro's name",
    },
  ]);

  const invalidContent = [
    "## Pomodoros",
    "- [ ] () — C++",
    "\t- work",
  ].join("\n");
  const invalidDiscovery = helpers.discoverMovablePomodoroBulletTargets(
    invalidContent,
    2,
    0,
  );
  const invalidRows = helpers.createPomodoroBulletMovePickerRows(
    invalidDiscovery.context.entries,
    invalidDiscovery.entryLine,
    "=review",
  );
  assert.deepEqual(invalidRows, [
    {
      kind: "invalid",
      statusText: "REVIEW is not part of this Pomodoro's name",
    },
  ]);
});

test("Pomodoro bullet move picker confirms =email through the actual picker callback", async () => {
  notices.length = 0;
  const content = [
    "## Pomodoros",
    "- [ ] (**0920-0950** [t:: 30m]) — BUILD + REVIEW + EMAIL",
    "\t- build work",
    "\t- review work",
    "\t- email one",
    "\t\t- follow-up",
    "\t- email two",
  ].join("\n");
  const { editor, plugin, view } = createPomodoroMovePickerHarness({
    content,
    cursor: { line: 4, ch: 999 },
  });

  assert.equal(
    plugin.openPomodoroBulletMovePicker(editor, view, {
      countExplicit: true,
      additionalTaskCount: 1,
    }),
    true,
  );
  const picker = plugin.activeTaskMoveDestinationPicker;
  picker.inputEl = { value: "=email" };
  picker.visibleItems = picker.getFilteredItems();
  assert.deepEqual(
    picker.visibleItems.map((row) => row.kind),
    ["split"],
  );

  await picker.openItemAtIndex(0);

  const expected = [
    "## Pomodoros",
    "- [ ] (**0920-0950** [t:: 30m]) — BUILD + REVIEW",
    "\t- build work",
    "\t- review work",
    "- [ ] () — EMAIL",
    "\t- email one",
    "\t\t- follow-up",
    "\t- email two",
  ].join("\n");
  assert.equal(editor.getValue(), expected);
  assert.equal(plugin.activeTaskMoveDestinationPicker, null);
  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.undoGroups, 1);
  assert.deepEqual(editor.cursor, { line: 5, ch: "\t- email one".length });
  assert.equal(
    notices.at(-1),
    "Split 2 bullets into new Pomodoro EMAIL; source is now BUILD + REVIEW",
  );
});

test("Pomodoro bullet move picker confirms = review through the actual picker callback", async () => {
  notices.length = 0;
  const content = [
    "## Pomodoros",
    "- [ ] (**0920-0950** [t:: 30m]) — BUILD + REVIEW + EMAIL",
    "\t- build work",
    "\t- review work",
    "\t- email one",
    "\t\t- follow-up",
    "\t- email two",
  ].join("\n");
  const { editor, plugin, view } = createPomodoroMovePickerHarness({
    content,
    cursor: { line: 3, ch: 999 },
  });

  assert.equal(plugin.openPomodoroBulletMovePicker(editor, view), true);
  const picker = plugin.activeTaskMoveDestinationPicker;
  picker.inputEl = { value: "= review" };
  picker.visibleItems = picker.getFilteredItems();
  assert.deepEqual(picker.visibleItems, [
    {
      kind: "split",
      name: "REVIEW",
      remainingName: "BUILD + EMAIL",
      title: "Split off REVIEW",
      meta: "Creates a new Pomodoro below; source becomes BUILD + EMAIL",
      badge: "Split",
    },
  ]);

  await picker.openItemAtIndex(0);

  const expected = [
    "## Pomodoros",
    "- [ ] (**0920-0950** [t:: 30m]) — BUILD + EMAIL",
    "\t- build work",
    "\t- email one",
    "\t\t- follow-up",
    "\t- email two",
    "- [ ] () — REVIEW",
    "\t- review work",
  ].join("\n");
  assert.equal(editor.getValue(), expected);
  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.undoGroups, 1);
  assert.deepEqual(editor.cursor, { line: 7, ch: "\t- review work".length });
  assert.equal(
    notices.at(-1),
    "Split 1 bullet into new Pomodoro REVIEW; source is now BUILD + EMAIL",
  );
});

test("Pomodoro bullet move picker confirms =focus by unnaming a single-name source", async () => {
  notices.length = 0;
  const content = [
    "## Pomodoros",
    "- [ ] (**0920-0950** [t:: 30m]) — FOCUS",
    "\t- keep",
    "\t- move",
  ].join("\n");
  const { editor, plugin, view } = createPomodoroMovePickerHarness({
    content,
    cursor: { line: 3, ch: 999 },
  });

  assert.equal(plugin.openPomodoroBulletMovePicker(editor, view), true);
  const picker = plugin.activeTaskMoveDestinationPicker;
  picker.inputEl = { value: "=focus" };
  picker.visibleItems = picker.getFilteredItems();
  assert.deepEqual(picker.visibleItems, [
    {
      kind: "split",
      name: "FOCUS",
      remainingName: "",
      title: "Split off FOCUS",
      meta: "Creates a new Pomodoro below; source becomes unnamed",
      badge: "Split",
    },
  ]);

  await picker.openItemAtIndex(0);

  const expected = [
    "## Pomodoros",
    "- [ ] (**0920-0950** [t:: 30m])",
    "\t- keep",
    "- [ ] () — FOCUS",
    "\t- move",
  ].join("\n");
  assert.equal(editor.getValue(), expected);
  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.undoGroups, 1);
  assert.deepEqual(editor.cursor, { line: 4, ch: "\t- move".length });
  assert.equal(
    notices.at(-1),
    "Split 1 bullet into new Pomodoro FOCUS; source is now unnamed Pomodoro",
  );
});

test("Pomodoro bullet split stale-content guard does not write", async () => {
  notices.length = 0;
  const content = [
    "## Pomodoros",
    "- [ ] () — BUILD + REVIEW",
    "\t- review work",
  ].join("\n");
  const { editor, plugin, view } = createPomodoroMovePickerHarness({
    content,
    cursor: { line: 2, ch: 0 },
  });

  assert.equal(plugin.openPomodoroBulletMovePicker(editor, view), true);
  const picker = plugin.activeTaskMoveDestinationPicker;
  picker.inputEl = { value: "=review" };
  const [row] = picker.getFilteredItems();
  editor.replaceRange("changed", { line: 2, ch: 0 }, { line: 2, ch: 0 });

  assert.equal(await picker.openItem(row), false);
  assert.equal(editor.transactions.length, 0);
  assert.equal(
    notices.at(-1),
    "Source note is no longer active; nothing was split",
  );
});

test("Pomodoro bullet move picker = cancellation, invalid rows, and stale-content guards do not write", async () => {
  notices.length = 0;
  const unnamedContent = [
    "## Pomodoros",
    "- [ ] ()",
    "\t- move",
    "- [ ] () — OTHER",
  ].join("\n");
  const harness = createPomodoroMovePickerHarness({
    content: unnamedContent,
    cursor: { line: 2, ch: 0 },
  });
  assert.equal(
    harness.plugin.openPomodoroBulletMovePicker(harness.editor, harness.view),
    true,
  );
  const picker = harness.plugin.activeTaskMoveDestinationPicker;
  picker.close();
  assert.equal(harness.editor.getValue(), unnamedContent);
  assert.equal(harness.editor.transactions.length, 0);

  const invalidPicker = new helpers.PomodoroBulletMovePickerModal(
    {},
    harness.plugin,
    picker.session,
  );
  assert.equal(
    await invalidPicker.openItem({
      kind: "invalid",
      statusText: "= needs a named source Pomodoro; type a new name instead",
    }),
    false,
  );
  assert.equal(harness.editor.getValue(), unnamedContent);
  assert.equal(harness.editor.transactions.length, 0);

  const content = [
    "## Pomodoros",
    "- [ ] () — FOCUS",
    "\t- move",
    "- [ ] () — OTHER",
  ].join("\n");
  const staleHarness = createPomodoroMovePickerHarness({
    content,
    cursor: { line: 2, ch: 0 },
  });
  assert.equal(
    staleHarness.plugin.openPomodoroBulletMovePicker(
      staleHarness.editor,
      staleHarness.view,
    ),
    true,
  );
  const stalePicker = staleHarness.plugin.activeTaskMoveDestinationPicker;
  stalePicker.inputEl = { value: "=" };
  const [row] = stalePicker.getFilteredItems();
  staleHarness.editor.replaceRange("changed", { line: 2, ch: 0 }, { line: 2, ch: 0 });
  assert.equal(await stalePicker.openItem(row), false);
  assert.equal(staleHarness.editor.transactions.length, 0);
  assert.equal(notices.at(-1), "Source note is no longer active; nothing was moved");
});

test("native isOpen regression: pickers attach, close clears slot, reopen works", () => {
  {
    const { open, plugin } = createBulletPropertyPickerHarness();
    assert.equal(open(), true);
    const first = plugin.activeBulletPropertyPicker;
    assert.equal(first.pickerOpen, true);
    assert.equal(first.isOpen, true);
    assert.equal(first.attached, true);
    assert.ok(first.contentEl.children.length > 0);
    assert.ok(first.modalEl.parent !== null);

    first.close();
    assert.equal(plugin.activeBulletPropertyPicker, null);
    assert.equal(first.pickerOpen, false);
    assert.equal(first.isOpen, false);

    assert.equal(open(), true);
    const second = plugin.activeBulletPropertyPicker;
    assert.notEqual(second, first);
    assert.equal(second.pickerOpen, true);
    assert.equal(second.isOpen, true);
    assert.equal(second.attached, true);
    assert.ok(second.contentEl.children.length > 0);
    second.close();
    assert.equal(plugin.activeBulletPropertyPicker, null);
  }

  {
    const { editor, plugin, view } = createTaskMovePickerHarness();
    assert.equal(plugin.openTaskMoveDestinationPicker(editor, view), true);
    const first = plugin.activeTaskMoveDestinationPicker;
    assert.equal(first.pickerOpen, true);
    assert.equal(first.isOpen, true);
    assert.equal(first.attached, true);
    assert.ok(first.contentEl.children.length > 0);
    assert.ok(first.modalEl.parent !== null);

    first.close();
    assert.equal(plugin.activeTaskMoveDestinationPicker, null);
    assert.equal(first.pickerOpen, false);
    assert.equal(first.isOpen, false);

    editor.cursor = { line: 1, ch: 0 };
    assert.equal(plugin.openTaskMoveDestinationPicker(editor, view), true);
    const second = plugin.activeTaskMoveDestinationPicker;
    assert.notEqual(second, first);
    assert.equal(second.pickerOpen, true);
    assert.equal(second.isOpen, true);
    assert.equal(second.attached, true);
    second.close();
    assert.equal(plugin.activeTaskMoveDestinationPicker, null);
  }
});

test("stale registered pickers fail open on the next key", () => {
  {
    const { editor, config, open, plugin } = createBulletPropertyPickerHarness();
    assert.equal(open(), true);
    const live = plugin.activeBulletPropertyPicker;
    live.close();
    assert.equal(plugin.activeBulletPropertyPicker, null);

    const stale = new helpers.BulletPropertyPickerModal(
      {},
      plugin,
      editor,
      { line: 0, ch: 0 },
      "- [ ] #task One",
      config,
      { filePath: "Tasks.md", propertyContext: { valid: true } },
    );
    assert.equal(stale.pickerOpen, false);
    plugin.activeBulletPropertyPicker = stale;

    assert.equal(open(), true);
    const fresh = plugin.activeBulletPropertyPicker;
    assert.notEqual(fresh, stale);
    assert.equal(fresh.pickerOpen, true);
    assert.equal(fresh.attached, true);
    assert.ok(fresh.contentEl.children.length > 0);

    fresh.containerEl = { isConnected: false };
    assert.equal(open(), true);
    const refetched = plugin.activeBulletPropertyPicker;
    assert.notEqual(refetched, fresh);
    assert.equal(refetched.pickerOpen, true);
    assert.equal(refetched.attached, true);
    refetched.close();
    assert.equal(plugin.activeBulletPropertyPicker, null);
  }

  {
    const { editor, plugin, view } = createTaskMovePickerHarness();
    assert.equal(plugin.openTaskMoveDestinationPicker(editor, view), true);
    const live = plugin.activeTaskMoveDestinationPicker;
    const destinations = live.items;
    const session = live.session;
    live.close();
    assert.equal(plugin.activeTaskMoveDestinationPicker, null);

    const stale = new helpers.TaskMoveDestinationPickerModal(
      {},
      plugin,
      destinations,
      session,
    );
    assert.equal(stale.pickerOpen, false);
    plugin.activeTaskMoveDestinationPicker = stale;

    assert.equal(plugin.openTaskMoveDestinationPicker(editor, view), true);
    const fresh = plugin.activeTaskMoveDestinationPicker;
    assert.notEqual(fresh, stale);
    assert.equal(fresh.pickerOpen, true);
    assert.equal(fresh.attached, true);

    fresh.containerEl = { isConnected: false };
    assert.equal(plugin.openTaskMoveDestinationPicker(editor, view), true);
    const refetched = plugin.activeTaskMoveDestinationPicker;
    assert.notEqual(refetched, fresh);
    assert.equal(refetched.pickerOpen, true);
    assert.equal(refetched.attached, true);
    refetched.close();
    assert.equal(plugin.activeTaskMoveDestinationPicker, null);
  }
});
