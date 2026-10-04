const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  notices,
  NavigationHotkeysPlugin,
  helpers,
  TransactionEditor,
  pomodoroFixtureLines,
  countedPomodoroReorderLines,
  currentPomodoroSwapLines,
  currentPomodoroSwappedLines,
} = require("./navigation-hotkeys-harness.cjs");

test("dash restore suppresses editor notice after deliberate navigation", async () => {
  notices.length = 0;
  let activeFile = { path: "dash.md" };
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => activeFile },
  };
  plugin.restoreActiveDashLocation = () => ({
    active: false,
    applied: false,
    needsQueryRetry: false,
  });
  plugin.restoreOrDeferDashLocation({ cursor: { line: 0, ch: 0 } }, 1);
  activeFile = { path: "Other.md" };
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(notices, []);
});

test("open-task dispatch timeout is registered for plugin cleanup", () => {
  const cleanups = [];
  const plugin = new NavigationHotkeysPlugin();
  plugin.register = (cleanup) => cleanups.push(cleanup);
  plugin.markOpenTaskJumpDispatch({}, 1);
  assert.equal(cleanups.length, 1);
  cleanups[0]();
});

test("jumpToOpenObsidianTask moves a placeholder Pomodoro entry in one undo group and reports the destination", () => {
  const lines = pomodoroFixtureLines();
  const editor = new TransactionEditor(lines.join("\n"), { line: 9, ch: 50 }, 512);
  const plugin = new NavigationHotkeysPlugin();
  plugin.register = () => {};
  plugin.app = {};
  notices.length = 0;

  const expectedPlan = helpers.planPomodoroEntryReorder(lines.join("\n"), {
    sourceEntryLine: 9,
    sourceRawLine: "- [ ] () — BODY",
    direction: 1,
  });

  const handled = plugin.jumpToOpenObsidianTask(editor, 1);

  assert.equal(handled, true);
  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.undoGroups, 1);
  assert.equal(editor.getValue(), expectedPlan.after);
  assert.deepEqual(editor.getCursor(), {
    line: expectedPlan.movedEntryLine,
    ch: "- [ ] () — BODY".length,
  });
  assert.equal(notices.at(-1), "Moved BODY down");
});

test("jumpToOpenObsidianTask swaps current and future Pomodoros in one undo group", () => {
  const lines = currentPomodoroSwapLines();
  const expected = currentPomodoroSwappedLines().join("\n");

  for (const [cursorLine, direction, notice, expectedCursorLine] of [
    [3, 1, "Moved ALPHA down", 5],
    [5, -1, "Moved BETA up", 3],
  ]) {
    const editor = new TransactionEditor(lines.join("\n"), {
      line: cursorLine,
      ch: 80,
    });
    const plugin = new NavigationHotkeysPlugin();
    plugin.register = () => {};
    plugin.app = {};
    notices.length = 0;

    const handled = plugin.jumpToOpenObsidianTask(editor, direction);

    assert.equal(handled, true);
    assert.equal(editor.transactions.length, 1);
    assert.equal(editor.undoGroups, 1);
    assert.equal(editor.getValue(), expected);
    assert.deepEqual(editor.getCursor(), {
      line: expectedCursorLine,
      ch: String(expected.split("\n")[expectedCursorLine]).length,
    });
    assert.equal(notices.at(-1), notice);
  }
});

test("jumpToOpenObsidianTask keeps current-swap transaction failures local", () => {
  class IgnoredTransactionEditor extends TransactionEditor {
    transaction(transaction) {
      this.transactions.push(JSON.parse(JSON.stringify(transaction)));
    }
  }

  const lines = currentPomodoroSwapLines();
  const editor = new IgnoredTransactionEditor(lines.join("\n"), {
    line: 3,
    ch: 0,
  });
  const plugin = new NavigationHotkeysPlugin();
  plugin.register = () => {};
  plugin.app = {};
  notices.length = 0;

  const handled = plugin.jumpToOpenObsidianTask(editor, 1);

  assert.equal(handled, true);
  assert.equal(editor.transactions.length, 1);
  assert.deepEqual(editor.getCursor(), { line: 3, ch: 0 });
  assert.equal(editor.getValue(), lines.join("\n"));
  assert.equal(notices.at(-1), "Pomodoro move failed; nothing was moved");
  assert.ok(!plugin.pendingOpenTaskJumpCenterDeferred);
});

test("jumpToOpenObsidianTask refuses current-up without jumping or mutating", () => {
  const lines = pomodoroFixtureLines();
  const editor = new TransactionEditor(lines.join("\n"), { line: 4, ch: 3 }, 512);
  const plugin = new NavigationHotkeysPlugin();
  plugin.register = () => {};
  plugin.app = {};
  notices.length = 0;

  const handled = plugin.jumpToOpenObsidianTask(editor, -1);

  assert.equal(handled, true);
  assert.equal(editor.transactions.length, 0);
  assert.deepEqual(editor.getCursor(), { line: 4, ch: 3 });
  assert.equal(editor.getValue(), lines.join("\n"));
  assert.equal(
    notices.at(-1),
    "Pomodoro #2 cannot move up across the current/history boundary",
  );
});

test("jumpToOpenObsidianTask still jumps normally off past/cancelled Pomodoro entries, a sub-bullet, and a plain task line", () => {
  const lines = pomodoroFixtureLines();
  const pastPomodoroEditor = new TransactionEditor(
    lines.join("\n"),
    { line: 1, ch: 2 },
    512,
  );
  const plugin = new NavigationHotkeysPlugin();
  plugin.register = () => {};
  plugin.app = {};

  const expectedFromPast = helpers.getOpenObsidianTaskJumpLine(lines, 1, 1);
  assert.equal(plugin.jumpToOpenObsidianTask(pastPomodoroEditor, 1), true);
  assert.equal(pastPomodoroEditor.transactions.length, 0);
  assert.deepEqual(pastPomodoroEditor.getCursor(), {
    line: expectedFromPast,
    ch: 0,
  });
  assert.equal(pastPomodoroEditor.getValue(), lines.join("\n"));

  const cancelledLines = pomodoroFixtureLines();
  cancelledLines[6] = "- [-] ()";
  const cancelledEditor = new TransactionEditor(
    cancelledLines.join("\n"),
    { line: 6, ch: 2 },
    512,
  );
  const cancelledPlugin = new NavigationHotkeysPlugin();
  cancelledPlugin.register = () => {};
  cancelledPlugin.app = {};
  const expectedFromCancelled = helpers.getOpenObsidianTaskJumpLine(
    cancelledLines,
    6,
    1,
  );
  assert.equal(
    cancelledPlugin.jumpToOpenObsidianTask(cancelledEditor, 1),
    true,
  );
  assert.equal(cancelledEditor.transactions.length, 0);
  assert.deepEqual(cancelledEditor.getCursor(), {
    line: expectedFromCancelled,
    ch: 0,
  });
  assert.equal(cancelledEditor.getValue(), cancelledLines.join("\n"));

  const subBulletEditor = new TransactionEditor(
    lines.join("\n"),
    { line: 7, ch: 1 },
    512,
  );
  const subBulletPlugin = new NavigationHotkeysPlugin();
  subBulletPlugin.register = () => {};
  subBulletPlugin.app = {};
  const expectedFromSubBullet = helpers.getOpenObsidianTaskJumpLine(lines, 7, 1);
  assert.equal(subBulletPlugin.jumpToOpenObsidianTask(subBulletEditor, 1), true);
  assert.equal(subBulletEditor.transactions.length, 0);
  assert.deepEqual(subBulletEditor.getCursor(), {
    line: expectedFromSubBullet,
    ch: 0,
  });

  const taskLines = ["- [ ] #task A", "- [ ] #task B"];
  const taskEditor = new TransactionEditor(taskLines.join("\n"), {
    line: 0,
    ch: 0,
  });
  const taskPlugin = new NavigationHotkeysPlugin();
  taskPlugin.register = () => {};
  taskPlugin.app = {};
  const expectedFromTask = helpers.getOpenObsidianTaskJumpLine(taskLines, 0, 1);
  assert.equal(taskPlugin.jumpToOpenObsidianTask(taskEditor, 1), true);
  assert.equal(taskEditor.transactions.length, 0);
  assert.deepEqual(taskEditor.getCursor(), { line: expectedFromTask, ch: 0 });
});

test("Ctrl+Shift+J/K dispatch guard performs exactly one Pomodoro move per physical press", () => {
  const lines = pomodoroFixtureLines();
  const editor = new TransactionEditor(lines.join("\n"), { line: 9, ch: 0 }, 512);
  const plugin = new NavigationHotkeysPlugin();
  const cleanups = [];
  plugin.register = (cleanup) => cleanups.push(cleanup);
  plugin.app = {};
  notices.length = 0;

  const first = plugin.jumpToOpenObsidianTask(editor, 1);
  const second = plugin.jumpToOpenObsidianTask(editor, 1);

  assert.equal(first, true);
  assert.equal(second, false);
  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.undoGroups, 1);
  cleanups.forEach((cleanup) => cleanup());
});

test("Ctrl+Shift+J/K dispatch guard performs exactly one current Pomodoro swap per physical press", () => {
  const lines = currentPomodoroSwapLines();
  const editor = new TransactionEditor(lines.join("\n"), { line: 3, ch: 0 }, 512);
  const plugin = new NavigationHotkeysPlugin();
  const cleanups = [];
  plugin.register = (cleanup) => cleanups.push(cleanup);
  plugin.app = {};
  notices.length = 0;

  const first = plugin.jumpToOpenObsidianTask(editor, 1);
  const second = plugin.jumpToOpenObsidianTask(editor, 1);

  assert.equal(first, true);
  assert.equal(second, false);
  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.undoGroups, 1);
  assert.equal(editor.getValue(), currentPomodoroSwappedLines().join("\n"));
  assert.equal(notices.filter((message) => message.startsWith("Moved ")).length, 1);
  cleanups.forEach((cleanup) => cleanup());
});

test("counted jumpToOpenObsidianTask moves a planned Pomodoro N positions in one undo group", () => {
  const lines = countedPomodoroReorderLines();
  const editor = new TransactionEditor(lines.join("\n"), { line: 5, ch: 50 }, 512);
  const plugin = new NavigationHotkeysPlugin();
  plugin.register = () => {};
  plugin.app = {};
  notices.length = 0;

  const expectedPlan = helpers.planPomodoroEntryReorder(lines.join("\n"), {
    sourceEntryLine: 5,
    sourceRawLine: "- [ ] () — BODY",
    direction: 1,
    repeat: 3,
  });

  const handled = plugin.jumpToOpenObsidianTask(editor, 1, 3);

  assert.equal(handled, true);
  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.undoGroups, 1);
  assert.equal(editor.getValue(), expectedPlan.after);
  assert.deepEqual(editor.getCursor(), {
    line: expectedPlan.movedEntryLine,
    ch: "- [ ] () — BODY".length,
  });
  assert.equal(notices.at(-1), "Moved BODY down 3 positions");
  assert.ok(!plugin.pendingOpenTaskJumpCenterDeferred);
});

test("an impossible counted Pomodoro move refuses without jumping or mutating", () => {
  const lines = countedPomodoroReorderLines();
  const editor = new TransactionEditor(lines.join("\n"), { line: 5, ch: 3 }, 512);
  const plugin = new NavigationHotkeysPlugin();
  plugin.register = () => {};
  plugin.app = {};
  notices.length = 0;

  const handled = plugin.jumpToOpenObsidianTask(editor, 1, 4);

  assert.equal(handled, true);
  assert.equal(editor.transactions.length, 0);
  assert.deepEqual(editor.getCursor(), { line: 5, ch: 3 });
  assert.equal(editor.getValue(), lines.join("\n"));
  assert.equal(
    notices.at(-1),
    "BODY cannot move down 4 positions without crossing the last planned Pomodoro",
  );
  assert.ok(!plugin.pendingOpenTaskJumpCenterDeferred);
});

test("counted jumpToOpenObsidianTask still jumps off non-movable cursor contexts", () => {
  const lines = pomodoroFixtureLines();
  const expectedFromPast = helpers.getOpenObsidianTaskJumpLine(lines, 1, 1, 3);
  const pastPomodoroEditor = new TransactionEditor(
    lines.join("\n"),
    { line: 1, ch: 2 },
    512,
  );
  const plugin = new NavigationHotkeysPlugin();
  plugin.register = () => {};
  plugin.app = {};

  assert.equal(plugin.jumpToOpenObsidianTask(pastPomodoroEditor, 1, 3), true);
  assert.equal(pastPomodoroEditor.transactions.length, 0);
  assert.deepEqual(pastPomodoroEditor.getCursor(), {
    line: expectedFromPast,
    ch: 0,
  });
  assert.equal(pastPomodoroEditor.getValue(), lines.join("\n"));
  assert.ok(plugin.pendingOpenTaskJumpCenterDeferred);

  const subBulletEditor = new TransactionEditor(
    lines.join("\n"),
    { line: 7, ch: 1 },
    512,
  );
  const subBulletPlugin = new NavigationHotkeysPlugin();
  subBulletPlugin.register = () => {};
  subBulletPlugin.app = {};
  const expectedFromSubBullet = helpers.getOpenObsidianTaskJumpLine(lines, 7, 1, 3);
  assert.equal(subBulletPlugin.jumpToOpenObsidianTask(subBulletEditor, 1, 3), true);
  assert.equal(subBulletEditor.transactions.length, 0);
  assert.deepEqual(subBulletEditor.getCursor(), {
    line: expectedFromSubBullet,
    ch: 0,
  });
  assert.ok(subBulletPlugin.pendingOpenTaskJumpCenterDeferred);

  const taskLines = [
    "- [ ] #task A",
    "- [ ] #task B",
    "- [ ] #task C",
    "- [ ] #task D",
  ];
  const taskEditor = new TransactionEditor(taskLines.join("\n"), {
    line: 0,
    ch: 0,
  });
  const taskPlugin = new NavigationHotkeysPlugin();
  taskPlugin.register = () => {};
  taskPlugin.app = {};
  const expectedFromTask = helpers.getOpenObsidianTaskJumpLine(taskLines, 0, 1, 3);
  assert.equal(taskPlugin.jumpToOpenObsidianTask(taskEditor, 1, 3), true);
  assert.equal(taskEditor.transactions.length, 0);
  assert.deepEqual(taskEditor.getCursor(), { line: expectedFromTask, ch: 0 });
  assert.ok(taskPlugin.pendingOpenTaskJumpCenterDeferred);

  const plainLines = ["plain", "- [ ] #task A", "- [ ] #task B", "- [ ] #task C"];
  const plainEditor = new TransactionEditor(plainLines.join("\n"), {
    line: 0,
    ch: 0,
  });
  const plainPlugin = new NavigationHotkeysPlugin();
  plainPlugin.register = () => {};
  plainPlugin.app = {};
  const expectedFromPlain = helpers.getOpenObsidianTaskJumpLine(
    plainLines,
    0,
    1,
    3,
  );
  assert.equal(plainPlugin.jumpToOpenObsidianTask(plainEditor, 1, 3), true);
  assert.equal(plainEditor.transactions.length, 0);
  assert.deepEqual(plainEditor.getCursor(), { line: expectedFromPlain, ch: 0 });
  assert.ok(plainPlugin.pendingOpenTaskJumpCenterDeferred);
});

test("counted open-task jump on a sole current target keeps the existing notice", () => {
  const editor = new TransactionEditor("- [ ] #task Only", { line: 0, ch: 0 });
  const plugin = new NavigationHotkeysPlugin();
  plugin.register = () => {};
  plugin.app = {};
  notices.length = 0;

  assert.equal(plugin.jumpToOpenObsidianTask(editor, 1, 9), false);
  assert.equal(plugin.jumpToOpenObsidianTask(editor, -1, 9), false);
  assert.deepEqual(editor.getCursor(), { line: 0, ch: 0 });
  assert.equal(notices.at(-2), "No next open task");
  assert.equal(notices.at(-1), "No previous open task");
});

test("dispatch guard allows exactly one counted Pomodoro move when the command route also fires", () => {
  const lines = countedPomodoroReorderLines();
  const editor = new TransactionEditor(lines.join("\n"), { line: 5, ch: 0 }, 512);
  const plugin = new NavigationHotkeysPlugin();
  const cleanups = [];
  plugin.register = (cleanup) => cleanups.push(cleanup);
  plugin.app = {};
  notices.length = 0;

  const expectedPlan = helpers.planPomodoroEntryReorder(lines.join("\n"), {
    sourceEntryLine: 5,
    sourceRawLine: "- [ ] () — BODY",
    direction: 1,
    repeat: 3,
  });
  const first = plugin.jumpToOpenObsidianTask(editor, 1, 3);
  const second = plugin.jumpToOpenObsidianTask(editor, 1);

  assert.equal(first, true);
  assert.equal(second, false);
  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.undoGroups, 1);
  assert.equal(editor.getValue(), expectedPlan.after);
  assert.equal(notices.filter((message) => message.startsWith("Moved ")).length, 1);
  cleanups.forEach((cleanup) => cleanup());
});
