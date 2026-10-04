const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  notices,
  helpers,
  createPomodoroMovePickerHarness,
} = require("./navigation-hotkeys-harness.cjs");

function createPomodoroEntryMoveSession(harness, cursorLine, overrides = {}) {
  const { editor, sourceFile, view } = harness;
  const sourceContent = editor.getValue();
  const discovery = helpers.discoverPomodoroEntryMoveTargets(
    sourceContent,
    cursorLine,
  );
  return {
    discovery,
    session: Object.freeze({
      sourceFile,
      sourcePath: sourceFile.path,
      sourceView: view,
      editor,
      sourceContent,
      cursor: Object.freeze({ line: cursorLine, ch: 0 }),
      scroll: null,
      countExplicit: false,
      ignoredCount: 0,
      discovery,
      entries: discovery.context.entries,
      sourceEntry: discovery.context.entry,
      ...overrides,
    }),
  };
}

test("Pomodoro entry move picker opens sessions, ignores counts, and clears the shared move picker slot", () => {
  const harness = createPomodoroMovePickerHarness({
    cursor: { line: 9, ch: 0 },
  });
  const { editor, plugin, view } = harness;
  assert.equal(
    plugin.openPomodoroEntryMovePicker(editor, view, {
      countExplicit: true,
      additionalTaskCount: 3,
    }),
    true,
  );
  const picker = plugin.activeTaskMoveDestinationPicker;
  assert.equal(picker instanceof helpers.PomodoroEntryMovePickerModal, true);
  assert.equal(picker.isOpen, true);
  assert.equal(picker.session.countExplicit, true);
  assert.equal(picker.session.ignoredCount, 3);
  assert.deepEqual(
    picker.session.discovery.targets.map((target) => target.line),
    [10],
  );
  assert.match(picker.getSubtitle(), /count ignored on a Pomodoro entry/);

  picker.close();
  assert.equal(plugin.activeTaskMoveDestinationPicker, null);
});

test("commitPomodoroEntryMoveSession on an existing row applies one guarded move transaction", async () => {
  notices.length = 0;
  const harness = createPomodoroMovePickerHarness({
    cursor: { line: 9, ch: 999 },
  });
  const { editor } = harness;
  const { discovery, session } = createPomodoroEntryMoveSession(harness, 9, {
    cursor: Object.freeze({ line: 9, ch: 999 }),
  });
  const rows = helpers.createPomodoroBulletMovePickerRows(
    discovery.context.entries,
    discovery.entryLine,
    "verify",
    { mode: "entry" },
  );
  const row = rows.find((item) => item.kind === "existing");
  const expectedPlan = helpers.planPomodoroBulletMove(session.sourceContent, {
    scope: "entry",
    targets: discovery.targets,
    sourceEntryLine: discovery.entryLine,
    sourceRawLine: discovery.rawEntryLine,
    destination: { kind: "existing", entryLine: row.entry.entryLine },
  });

  assert.equal(expectedPlan.sourcePomodoroDeleted, true);
  assert.equal(
    await harness.plugin.commitPomodoroEntryMoveSession(session, row),
    true,
  );
  assert.equal(editor.getValue(), expectedPlan.after);
  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.undoGroups, 1);
  assert.deepEqual(editor.cursor, {
    line: expectedPlan.firstMovedLine,
    ch: expectedPlan.after.split("\n")[expectedPlan.firstMovedLine].length,
  });
  assert.equal(notices.at(-1), "Moved 1 bullet from Pomodoro #4 to VERIFY");
});

test("commitPomodoroEntryMoveSession on a rename row applies one guarded transaction; unchanged writes nothing", async () => {
  notices.length = 0;
  const harness = createPomodoroMovePickerHarness({
    cursor: { line: 9, ch: 2 },
  });
  const { editor, plugin } = harness;
  const { session } = createPomodoroEntryMoveSession(harness, 9, {
    cursor: Object.freeze({ line: 9, ch: 2 }),
  });

  const row = { kind: "rename", name: "renamed body" };
  assert.equal(await plugin.commitPomodoroEntryMoveSession(session, row), true);
  const afterLines = editor.getValue().split("\n");
  assert.equal(afterLines[9], "- [ ] () — RENAMED BODY");
  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.undoGroups, 1);
  assert.deepEqual(editor.cursor, { line: 9, ch: 2 });
  assert.equal(notices.at(-1), "Renamed Pomodoro #4 to RENAMED BODY");

  const { session: unchangedSession } = createPomodoroEntryMoveSession(
    harness,
    9,
    { cursor: Object.freeze({ line: 9, ch: 2 }) },
  );
  assert.equal(
    await plugin.commitPomodoroEntryMoveSession(unchangedSession, row),
    false,
  );
  assert.equal(editor.transactions.length, 1);
  assert.equal(notices.at(-1), "Pomodoro #4 is already named RENAMED BODY");
});

test("commitPomodoroEntryMoveSession on an empty-source move emits the deleted-Pomodoro notice", async () => {
  notices.length = 0;
  const content = [
    "## Pomodoros",
    "- [ ] () — EMPTY",
    "- [ ] () — OTHER",
    "\t- [[x#^y]]",
  ].join("\n");
  const harness = createPomodoroMovePickerHarness({
    content,
    cursor: { line: 1, ch: 0 },
  });
  const { editor, plugin } = harness;
  const { discovery, session } = createPomodoroEntryMoveSession(harness, 1);
  assert.equal(discovery.bulletCount, 0);
  const row = {
    kind: "existing",
    entry: discovery.context.entries.find((entry) => entry.entryLine === 2),
  };

  assert.equal(await plugin.commitPomodoroEntryMoveSession(session, row), true);
  assert.equal(
    editor.getValue(),
    ["## Pomodoros", "- [ ] () — OTHER", "\t- [[x#^y]]"].join("\n"),
  );
  assert.equal(notices.at(-1), "Deleted empty Pomodoro #1");
});

test("commitPomodoroEntryMoveSession rejects a session whose editor content drifted or whose active view changed", async () => {
  notices.length = 0;
  const harness = createPomodoroMovePickerHarness({
    cursor: { line: 9, ch: 0 },
  });
  const { editor, plugin } = harness;
  const { session } = createPomodoroEntryMoveSession(harness, 9);
  const row = { kind: "rename", name: "won't apply" };

  editor.content = `${editor.content}\nExtra line`;
  assert.equal(await plugin.commitPomodoroEntryMoveSession(session, row), false);
  assert.equal(notices.at(-1), "Source note is no longer active; nothing was moved");

  editor.content = session.sourceContent;
  plugin.getActiveMarkdownView = () => null;
  assert.equal(await plugin.commitPomodoroEntryMoveSession(session, row), false);
});

test("Pomodoro entry picker Ctrl+X merges the highlighted existing row and closes before committing", async () => {
  notices.length = 0;
  const content = [
    "## Pomodoros",
    "- [ ] () — SOURCE",
    "\t- source bullet",
    "- [ ] () — REVIEW",
    "\t- review work detail",
  ].join("\n");
  const { editor, plugin, view } = createPomodoroMovePickerHarness({
    content,
    cursor: { line: 1, ch: 999 },
  });
  assert.equal(plugin.openPomodoroEntryMovePicker(editor, view), true);
  const picker = plugin.activeTaskMoveDestinationPicker;
  picker.inputEl = { value: "review work" };
  picker.visibleItems = picker.getFilteredItems();
  picker.renderResults = function stubbedRenderResults() {
    this.visibleItems = this.getFilteredItems();
    this.selectedIndex = this.clampSelectedIndex(
      this.selectedIndex,
      this.visibleItems.length,
    );
  };
  assert.deepEqual(
    picker.visibleItems.map((row) => row.kind),
    ["rename", "existing"],
  );

  const originalCommit = plugin.commitPomodoroEntryMergeSession.bind(plugin);
  let isOpenDuringCommit = null;
  let activePickerDuringCommit = undefined;
  plugin.commitPomodoroEntryMergeSession = async (session, row) => {
    isOpenDuringCommit = picker.isOpen;
    activePickerDuringCommit = plugin.activeTaskMoveDestinationPicker;
    return originalCommit(session, row);
  };

  const navEvent = {
    key: "n",
    ctrlKey: true,
    altKey: false,
    metaKey: false,
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true;
    },
    stopPropagation() {
      this.stopped = true;
    },
  };
  picker.handleKeydown(navEvent);
  assert.equal(navEvent.prevented, true);
  assert.equal(navEvent.stopped, true);
  assert.equal(picker.selectedIndex, 1);

  const mergeEvent = {
    key: "x",
    ctrlKey: true,
    altKey: false,
    metaKey: false,
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true;
    },
    stopPropagation() {
      this.stopped = true;
    },
  };
  picker.handleKeydown(mergeEvent);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(mergeEvent.prevented, true);
  assert.equal(mergeEvent.stopped, true);
  assert.equal(picker.inputEl.value, "review work");
  assert.equal(isOpenDuringCommit, false);
  assert.equal(activePickerDuringCommit, null);
  assert.equal(plugin.activeTaskMoveDestinationPicker, null);
  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.undoGroups, 1);
  assert.equal(editor.getValue(), [
    "## Pomodoros",
    "- [ ] () — REVIEW + SOURCE",
    "\t- review work detail",
    "\t- source bullet",
  ].join("\n"));
  assert.deepEqual(editor.cursor, {
    line: 1,
    ch: "- [ ] () — REVIEW + SOURCE".length,
  });
  assert.equal(notices.at(-1), "Merged SOURCE into REVIEW + SOURCE");
});

test("Pomodoro entry picker Ctrl+X refuses rename and empty selections without closing or writing", async () => {
  notices.length = 0;
  const content = [
    "## Pomodoros",
    "- [ ] () — SOURCE",
    "\t- source bullet",
    "- [ ] () — DEST",
    "\t- dest bullet",
  ].join("\n");
  const harness = createPomodoroMovePickerHarness({
    content,
    cursor: { line: 1, ch: 0 },
  });
  assert.equal(
    harness.plugin.openPomodoroEntryMovePicker(harness.editor, harness.view),
    true,
  );
  const picker = harness.plugin.activeTaskMoveDestinationPicker;
  picker.inputEl = { value: "novel name" };
  picker.visibleItems = picker.getFilteredItems();
  assert.deepEqual(picker.visibleItems.map((row) => row.kind), ["rename"]);

  await picker.mergeSelectedItem();
  assert.equal(picker.isOpen, true);
  assert.equal(harness.plugin.activeTaskMoveDestinationPicker, picker);
  assert.equal(harness.editor.getValue(), content);
  assert.equal(harness.editor.transactions.length, 0);
  assert.match(notices.at(-1), /press Enter to rename instead/);

  picker.visibleItems = [];
  await picker.mergeSelectedItem();
  assert.equal(picker.isOpen, true);
  assert.equal(harness.editor.getValue(), content);
  assert.equal(harness.editor.transactions.length, 0);
  assert.match(notices.at(-1), /Select an existing Pomodoro to merge/);
});

test("Pomodoro entry picker Ctrl+X uses the shared opening latch against reentrant merges", async () => {
  const content = [
    "## Pomodoros",
    "- [ ] () — SOURCE",
    "\t- source bullet",
    "- [ ] () — DEST",
    "\t- dest bullet",
  ].join("\n");
  const { editor, plugin, view } = createPomodoroMovePickerHarness({
    content,
    cursor: { line: 1, ch: 0 },
  });
  assert.equal(plugin.openPomodoroEntryMovePicker(editor, view), true);
  const picker = plugin.activeTaskMoveDestinationPicker;
  picker.inputEl = { value: "dest" };
  picker.visibleItems = picker.getFilteredItems();

  let commitCalls = 0;
  let resolveCommit;
  plugin.commitPomodoroEntryMergeSession = async () => {
    commitCalls += 1;
    await new Promise((resolve) => {
      resolveCommit = resolve;
    });
    return true;
  };

  const first = picker.mergeSelectedItem();
  const second = picker.mergeSelectedItem();
  assert.equal(commitCalls, 1);
  resolveCommit();
  await first;
  await second;
  assert.equal(commitCalls, 1);
});

test("Ctrl+X remains entry-specific and does not run from the Pomodoro bullet picker", () => {
  notices.length = 0;
  const { editor, plugin, view } = createPomodoroMovePickerHarness({
    cursor: { line: 5, ch: 0 },
  });
  assert.equal(plugin.openPomodoroBulletMovePicker(editor, view), true);
  const picker = plugin.activeTaskMoveDestinationPicker;
  const event = {
    key: "x",
    ctrlKey: true,
    altKey: false,
    metaKey: false,
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true;
    },
    stopPropagation() {
      this.stopped = true;
    },
  };

  picker.handleKeydown(event);

  assert.equal(event.prevented, false);
  assert.equal(event.stopped, false);
  assert.equal(picker.isOpen, true);
  assert.equal(editor.transactions.length, 0);
  assert.deepEqual(notices, []);
});

test("task move picker closes before commit while other pickers retain delayed close", async () => {
  const destinations = [
    { file: { path: "Area.md", basename: "Area" }, noteInfo: {} },
  ];
  const session = {
    discovery: { actualCount: 2, requestedCount: 2, clamped: false },
  };

  for (const commitResult of [true, false]) {
    const events = [];
    let settleCommit;
    const commit = new Promise((resolve) => {
      settleCommit = resolve;
    });
    const plugin = {
      commitTaskMoveSession: () => {
        events.push("commit");
        return commit;
      },
    };
    const picker = new helpers.TaskMoveDestinationPickerModal(
      {},
      plugin,
      destinations,
      session,
    );
    picker.close = () => events.push("close");

    const selection = picker.openItemAtIndex(0);
    assert.deepEqual(events, ["close", "commit"]);
    await picker.openItemAtIndex(0);
    assert.deepEqual(events, ["close", "commit"]);

    settleCommit(commitResult);
    await selection;
    assert.deepEqual(events, ["close", "commit"]);
  }

  for (const openResult of [true, false]) {
    const events = [];
    let settleOpen;
    const opening = new Promise((resolve) => {
      settleOpen = resolve;
    });
    const picker = new helpers.FilteredPickerModal({}, {
      items: ["item"],
      openItem: () => {
        events.push("open");
        return opening;
      },
    });
    picker.close = () => events.push("close");

    const selection = picker.openItemAtIndex(0);
    assert.deepEqual(events, ["open"]);
    settleOpen(openResult);
    await selection;
    assert.deepEqual(events, openResult ? ["open", "close"] : ["open"]);
  }
});
