const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  notices,
  NavigationHotkeysPlugin,
  helpers,
  TransactionEditor,
  vimTransactionEditor,
  pomodoroFixtureLines,
  countedPomodoroReorderLines,
  countedCurrentPomodoroSwapLines,
} = require("./navigation-hotkeys-harness.cjs");

test("physical Ctrl+Shift+J/K consume a Vim count once and pass it to the shared route", () => {
  const makeEvent = (overrides = {}) => {
    const calls = { prevent: 0, stop: 0, immediate: 0 };
    return {
      key: "J",
      code: "KeyJ",
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false,
      preventDefault: () => {
        calls.prevent += 1;
      },
      stopPropagation: () => {
        calls.stop += 1;
      },
      stopImmediatePropagation: () => {
        calls.immediate += 1;
      },
      calls,
      ...overrides,
    };
  };
  const inputState = {
    keyBuffer: [],
    repeat: null,
    reason: "",
    getRepeat: () => null,
  };
  const cm = {
    state: { vim: { mode: "normal", inputState } },
    getCursor: () => ({ line: 0, ch: 0 }),
  };
  const editor = { cm: { cm } };
  const view = { editor };
  const plugin = new NavigationHotkeysPlugin();
  plugin.handledOpenTaskJumpEvents = new WeakSet();
  plugin.getFocusedMarkdownEditorView = () => view;
  const jumps = [];
  plugin.jumpToOpenObsidianTask = (receivedEditor, direction, repeat) => {
    jumps.push({ editor: receivedEditor, direction, repeat });
    return true;
  };

  const bare = makeEvent();
  assert.equal(plugin.handleOpenTaskJumpPhysicalKeydown(bare), true);
  assert.deepEqual(bare.calls, { prevent: 1, stop: 1, immediate: 1 });
  assert.deepEqual(inputState.keyBuffer, []);
  assert.equal(inputState.repeat, null);
  assert.equal(inputState.reason, "open-task-jump");
  assert.deepEqual(jumps, [{ editor, direction: 1, repeat: 1 }]);
  assert.equal(plugin.handleOpenTaskJumpPhysicalKeydown(bare), false);
  assert.equal(jumps.length, 1);

  inputState.keyBuffer = ["3"];
  inputState.repeat = 3;
  inputState.reason = "";
  inputState.getRepeat = () => 3;
  const counted = makeEvent();
  assert.equal(plugin.handleOpenTaskJumpPhysicalKeydown(counted), true);
  assert.deepEqual(counted.calls, { prevent: 1, stop: 1, immediate: 1 });
  assert.deepEqual(inputState.keyBuffer, []);
  assert.equal(inputState.repeat, null);
  assert.equal(inputState.reason, "counted-open-task-jump");
  assert.deepEqual(jumps[1], { editor, direction: 1, repeat: 3 });

  inputState.keyBuffer = ["3"];
  inputState.repeat = 3;
  inputState.reason = "";
  inputState.getRepeat = () => 3;
  const countedUp = makeEvent({ key: "K", code: "KeyK" });
  assert.equal(plugin.handleOpenTaskJumpPhysicalKeydown(countedUp), true);
  assert.equal(inputState.reason, "counted-open-task-jump");
  assert.deepEqual(jumps[2], { editor, direction: -1, repeat: 3 });

  inputState.keyBuffer = ["3"];
  inputState.repeat = 3;
  inputState.reason = "";
  inputState.getRepeat = () => 3;
  for (const mode of ["insert", "visual", "visual-line", "replace"]) {
    cm.state.vim.mode = mode;
    const event = makeEvent();
    assert.equal(plugin.handleOpenTaskJumpPhysicalKeydown(event), false);
    assert.equal(event.calls.prevent, 0);
    assert.deepEqual(inputState.keyBuffer, ["3"]);
  }
  cm.state.vim.mode = "normal";

  for (const overrides of [
    { ctrlKey: false },
    { shiftKey: false },
    { altKey: true },
    { metaKey: true },
    { code: "KeyM", key: "M" },
  ]) {
    const event = makeEvent(overrides);
    assert.equal(plugin.handleOpenTaskJumpPhysicalKeydown(event), false);
    assert.equal(event.calls.prevent, 0);
    assert.deepEqual(inputState.keyBuffer, ["3"]);
  }

  delete cm.state.vim;
  const disabled = makeEvent();
  assert.equal(plugin.handleOpenTaskJumpPhysicalKeydown(disabled), false);
  assert.equal(disabled.calls.prevent, 0);

  cm.state.vim = { mode: "normal", inputState };
  plugin.getFocusedMarkdownEditorView = () => null;
  const unfocused = makeEvent();
  assert.equal(plugin.handleOpenTaskJumpPhysicalKeydown(unfocused), false);
  assert.equal(unfocused.calls.prevent, 0);
  assert.deepEqual(inputState.keyBuffer, ["3"]);
});

test("open-task command ids omit repeat so the shared route resolves the pending Vim count", () => {
  // The omitted third argument is load-bearing: undefined means "resolve the
  // pending Vim count", whereas an explicit 1 would drop a typed count when
  // the Obsidian command route wins the dual-dispatch race.
  const plugin = new NavigationHotkeysPlugin();
  const commands = [];
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
  const calls = [];
  plugin.jumpToOpenObsidianTask = (editor, direction, repeat) => {
    calls.push({ editor, direction, repeat });
    return true;
  };

  plugin.onload();
  const next = commands.find((item) => item.id === "jump-to-next-open-task");
  const prev = commands.find((item) => item.id === "jump-to-prev-open-task");
  assert.ok(next);
  assert.ok(prev);
  const editor = {};
  next.editorCallback(editor);
  prev.editorCallback(editor);
  assert.deepEqual(calls, [
    { editor, direction: 1, repeat: undefined },
    { editor, direction: -1, repeat: undefined },
  ]);
});

test("command-route jumpToOpenObsidianTask consumes a pending Vim count for a planned Pomodoro move", () => {
  const lines = countedPomodoroReorderLines();
  const editor = vimTransactionEditor(lines.join("\n"), { line: 5, ch: 50 }, {
    inputState: { keyBuffer: ["3"] },
  });
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

  const handled = plugin.jumpToOpenObsidianTask(editor, 1);

  assert.equal(handled, true);
  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.undoGroups, 1);
  assert.equal(editor.getValue(), expectedPlan.after);
  assert.deepEqual(editor.getCursor(), {
    line: expectedPlan.movedEntryLine,
    ch: "- [ ] () — BODY".length,
  });
  assert.equal(notices.at(-1), "Moved BODY down 3 positions");
  assert.deepEqual(editor.vimInputState.keyBuffer, []);
  assert.equal(editor.vimInputState.reason, "counted-open-task-jump");
});

test("command-route jumpToOpenObsidianTask consumes a pending Vim count for a current Pomodoro swap", () => {
  const lines = countedCurrentPomodoroSwapLines();
  const editor = vimTransactionEditor(lines.join("\n"), { line: 1, ch: 80 }, {
    inputState: { keyBuffer: ["2"] },
  });
  const plugin = new NavigationHotkeysPlugin();
  plugin.register = () => {};
  plugin.app = {};
  notices.length = 0;

  const handled = plugin.jumpToOpenObsidianTask(editor, 1);

  assert.equal(handled, true);
  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.undoGroups, 1);
  assert.equal(
    editor.getValue(),
    [
      "## Pomodoros",
      "- [ ] (**0900-0930** [t:: 30m]) — B",
      "- [ ] () — C",
      "- [ ] (  ) — A",
    ].join("\n"),
  );
  assert.deepEqual(editor.getCursor(), {
    line: 3,
    ch: "- [ ] (  ) — A".length,
  });
  assert.equal(notices.at(-1), "Moved A down 2 positions");
  assert.deepEqual(editor.vimInputState.keyBuffer, []);
  assert.equal(editor.vimInputState.reason, "counted-open-task-jump");
});

test("command-route jumpToOpenObsidianTask consumes a pending Vim count for a circular jump", () => {
  const lines = pomodoroFixtureLines();
  const editor = vimTransactionEditor(lines.join("\n"), { line: 1, ch: 2 }, {
    inputState: { keyBuffer: ["3"] },
  });
  const plugin = new NavigationHotkeysPlugin();
  plugin.register = () => {};
  plugin.app = {};

  const expectedLine = helpers.getOpenObsidianTaskJumpLine(lines, 1, 1, 3);
  assert.equal(plugin.jumpToOpenObsidianTask(editor, 1), true);
  assert.equal(editor.transactions.length, 0);
  assert.equal(editor.getValue(), lines.join("\n"));
  assert.deepEqual(editor.getCursor(), { line: expectedLine, ch: 0 });
  assert.ok(plugin.pendingOpenTaskJumpCenterDeferred);
  assert.deepEqual(editor.vimInputState.keyBuffer, []);
  assert.equal(editor.vimInputState.reason, "counted-open-task-jump");
});

test("dispatch guard applies a command-route Vim count when the capture route fires second", () => {
  const lines = countedPomodoroReorderLines();
  const editor = vimTransactionEditor(lines.join("\n"), { line: 5, ch: 0 }, {
    inputState: { keyBuffer: ["3"] },
  });
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
  const first = plugin.jumpToOpenObsidianTask(editor, 1);
  const second = plugin.jumpToOpenObsidianTask(editor, 1, 1);

  assert.equal(first, true);
  assert.equal(second, false);
  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.undoGroups, 1);
  assert.equal(editor.getValue(), expectedPlan.after);
  assert.equal(notices.filter((message) => message.startsWith("Moved ")).length, 1);
  assert.equal(notices.at(-1), "Moved BODY down 3 positions");
  cleanups.forEach((cleanup) => cleanup());
});

test("dispatch guard leaves pending Vim state untouched when the capture route already consumed the count", () => {
  const lines = countedPomodoroReorderLines();
  const editor = vimTransactionEditor(lines.join("\n"), { line: 5, ch: 0 }, {
    inputState: { keyBuffer: ["9"] },
  });
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
  const pendingBeforeSuppressed = [...editor.vimInputState.keyBuffer];
  const reasonBeforeSuppressed = editor.vimInputState.reason;
  const second = plugin.jumpToOpenObsidianTask(editor, 1);

  assert.equal(first, true);
  assert.equal(second, false);
  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.undoGroups, 1);
  assert.equal(editor.getValue(), expectedPlan.after);
  assert.equal(notices.filter((message) => message.startsWith("Moved ")).length, 1);
  assert.deepEqual(editor.vimInputState.keyBuffer, pendingBeforeSuppressed);
  assert.equal(editor.vimInputState.reason, reasonBeforeSuppressed);
  assert.deepEqual(editor.vimInputState.keyBuffer, ["9"]);
  cleanups.forEach((cleanup) => cleanup());
});

test("command-route jumpToOpenObsidianTask without a pending count moves one step and does not reset Vim state", () => {
  const lines = countedPomodoroReorderLines();
  const editor = vimTransactionEditor(lines.join("\n"), { line: 5, ch: 50 }, {
    inputState: { keyBuffer: [], getRepeat: () => null },
  });
  const plugin = new NavigationHotkeysPlugin();
  plugin.register = () => {};
  plugin.app = {};
  notices.length = 0;

  const expectedPlan = helpers.planPomodoroEntryReorder(lines.join("\n"), {
    sourceEntryLine: 5,
    sourceRawLine: "- [ ] () — BODY",
    direction: 1,
  });

  const handled = plugin.jumpToOpenObsidianTask(editor, 1);

  assert.equal(handled, true);
  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.undoGroups, 1);
  assert.equal(editor.getValue(), expectedPlan.after);
  assert.equal(notices.at(-1), "Moved BODY down");
  assert.deepEqual(editor.vimInputState.keyBuffer, []);
  assert.equal(editor.vimInputState.reason, "");
});

test("command-route jumpToOpenObsidianTask keeps repeat 1 for non-Vim and wrong-mode editors", () => {
  const lines = countedPomodoroReorderLines();
  const expectedPlan = helpers.planPomodoroEntryReorder(lines.join("\n"), {
    sourceEntryLine: 5,
    sourceRawLine: "- [ ] () — BODY",
    direction: 1,
  });

  const runUncountedMove = (editor, app) => {
    const plugin = new NavigationHotkeysPlugin();
    plugin.register = () => {};
    plugin.app = app;
    notices.length = 0;
    const handled = plugin.jumpToOpenObsidianTask(editor, 1);
    assert.equal(handled, true);
    assert.equal(editor.transactions.length, 1);
    assert.equal(editor.undoGroups, 1);
    assert.equal(editor.getValue(), expectedPlan.after);
    assert.equal(notices.at(-1), "Moved BODY down");
  };

  const plainEditor = new TransactionEditor(lines.join("\n"), { line: 5, ch: 50 }, 512);
  runUncountedMove(plainEditor, {});

  for (const mode of ["insert", "visual", "visual-line", "replace"]) {
    const editor = vimTransactionEditor(lines.join("\n"), { line: 5, ch: 50 }, {
      mode,
      inputState: { keyBuffer: ["3"] },
    });
    runUncountedMove(editor, {});
    assert.deepEqual(editor.vimInputState.keyBuffer, ["3"]);
    assert.equal(editor.vimInputState.reason, "");
  }
});

test("command-route jumpToOpenObsidianTask resolves the count from the passed editor, not a foreign pane", () => {
  const lines = countedPomodoroReorderLines();
  const editor = vimTransactionEditor(lines.join("\n"), { line: 5, ch: 50 }, {
    inputState: { keyBuffer: ["3"] },
  });
  const foreignEditor = vimTransactionEditor(lines.join("\n"), { line: 5, ch: 50 }, {
    inputState: { keyBuffer: ["9"] },
  });
  const plugin = new NavigationHotkeysPlugin();
  plugin.register = () => {};
  plugin.app = {
    workspace: {
      getActiveViewOfType: () => ({
        file: { extension: "md", path: "other.md" },
        editor: foreignEditor,
      }),
    },
  };
  notices.length = 0;

  const expectedPlan = helpers.planPomodoroEntryReorder(lines.join("\n"), {
    sourceEntryLine: 5,
    sourceRawLine: "- [ ] () — BODY",
    direction: 1,
    repeat: 3,
  });

  const handled = plugin.jumpToOpenObsidianTask(editor, 1);

  assert.equal(handled, true);
  assert.equal(editor.getValue(), expectedPlan.after);
  assert.equal(notices.at(-1), "Moved BODY down 3 positions");
  assert.deepEqual(editor.vimInputState.keyBuffer, []);
  assert.equal(editor.vimInputState.reason, "counted-open-task-jump");
  assert.deepEqual(foreignEditor.vimInputState.keyBuffer, ["9"]);
  assert.equal(foreignEditor.vimInputState.reason, "");
});

test("explicit jumpToOpenObsidianTask repeat wins over a different pending Vim count", () => {
  const lines = countedPomodoroReorderLines();
  const editor = vimTransactionEditor(lines.join("\n"), { line: 5, ch: 50 }, {
    inputState: { keyBuffer: ["3"] },
  });
  const plugin = new NavigationHotkeysPlugin();
  plugin.register = () => {};
  plugin.app = {};
  notices.length = 0;

  const expectedPlan = helpers.planPomodoroEntryReorder(lines.join("\n"), {
    sourceEntryLine: 5,
    sourceRawLine: "- [ ] () — BODY",
    direction: 1,
    repeat: 2,
  });

  const handled = plugin.jumpToOpenObsidianTask(editor, 1, 2);

  assert.equal(handled, true);
  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.getValue(), expectedPlan.after);
  assert.equal(notices.at(-1), "Moved BODY down 2 positions");
  assert.deepEqual(editor.vimInputState.keyBuffer, ["3"]);
  assert.equal(editor.vimInputState.reason, "");
});

test("getPendingVimRepeat falls back to prefixRepeat and motionRepeat when getRepeat is absent", () => {
  const cmWithoutRepeat = {
    state: {
      vim: {
        inputState: {
          keyBuffer: [],
          prefixRepeat: ["1", "2"],
          motionRepeat: [],
        },
      },
    },
  };
  assert.deepEqual(helpers.getPendingVimRepeat(cmWithoutRepeat), {
    repeat: 12,
    explicit: true,
  });

  const cmProduct = {
    state: {
      vim: {
        inputState: {
          keyBuffer: [],
          prefixRepeat: ["2"],
          motionRepeat: ["3"],
        },
      },
    },
  };
  assert.deepEqual(helpers.getPendingVimRepeat(cmProduct), {
    repeat: 6,
    explicit: true,
  });

  const cmEmpty = {
    state: {
      vim: {
        inputState: {
          keyBuffer: [],
          prefixRepeat: [],
          motionRepeat: [],
        },
      },
    },
  };
  assert.deepEqual(helpers.getPendingVimRepeat(cmEmpty), {
    repeat: 1,
    explicit: false,
  });
});

test("physical counted property chord consumes only explicit normal-mode Vim counts", () => {
  const makeEvent = (overrides = {}) => {
    const calls = { prevent: 0, stop: 0, immediate: 0 };
    return {
      key: "P",
      code: "KeyP",
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false,
      preventDefault: () => {
        calls.prevent += 1;
      },
      stopPropagation: () => {
        calls.stop += 1;
      },
      stopImmediatePropagation: () => {
        calls.immediate += 1;
      },
      calls,
      ...overrides,
    };
  };
  const inputState = {
    keyBuffer: ["2"],
    repeat: 2,
    getRepeat: () => 2,
  };
  const cm = {
    state: { vim: { mode: "normal", inputState } },
    getCursor: () => ({ line: 0, ch: 0 }),
  };
  const editor = { cm: { cm } };
  const view = { editor };
  const plugin = new NavigationHotkeysPlugin();
  plugin.handledCountedBulletPropertyEvents = new WeakSet();
  plugin.getFocusedMarkdownEditorView = () => view;
  const opens = [];
  plugin.openBulletPropertyPicker = (_editor, options) => {
    opens.push(options);
    return true;
  };

  const repeated = makeEvent({ repeat: true });
  assert.equal(plugin.handleCountedBulletPropertyPhysicalKeydown(repeated), false);
  assert.deepEqual(repeated.calls, { prevent: 0, stop: 0, immediate: 0 });
  assert.deepEqual(opens, []);
  assert.deepEqual(inputState.keyBuffer, ["2"]);
  assert.equal(inputState.repeat, 2);

  const counted = makeEvent({ repeat: false });
  assert.equal(plugin.handleCountedBulletPropertyPhysicalKeydown(counted), true);
  assert.deepEqual(opens, [
    { countExplicit: true, additionalTaskCount: 2 },
  ]);
  assert.deepEqual(counted.calls, { prevent: 1, stop: 1, immediate: 1 });
  assert.deepEqual(inputState.keyBuffer, []);
  assert.equal(inputState.repeat, null);

  // The same physical event delivered to both window and document is ignored.
  assert.equal(plugin.handleCountedBulletPropertyPhysicalKeydown(counted), false);
  assert.equal(opens.length, 1);

  inputState.getRepeat = () => null;
  const bare = makeEvent();
  assert.equal(plugin.handleCountedBulletPropertyPhysicalKeydown(bare), false);
  assert.deepEqual(bare.calls, { prevent: 0, stop: 0, immediate: 0 });

  for (const mode of ["insert", "visual", "visual-line", "replace"]) {
    cm.state.vim.mode = mode;
    inputState.keyBuffer = ["3"];
    inputState.getRepeat = () => 3;
    const event = makeEvent();
    assert.equal(plugin.handleCountedBulletPropertyPhysicalKeydown(event), false);
    assert.equal(event.calls.prevent, 0);
  }

  cm.state.vim.mode = "normal";
  for (const overrides of [
    { ctrlKey: false },
    { shiftKey: false },
    { altKey: true },
    { metaKey: true },
    { key: "O", code: "KeyO" },
  ]) {
    const event = makeEvent(overrides);
    assert.equal(plugin.handleCountedBulletPropertyPhysicalKeydown(event), false);
    assert.equal(event.calls.prevent, 0);
  }

  delete cm.state.vim;
  const disabled = makeEvent();
  assert.equal(plugin.handleCountedBulletPropertyPhysicalKeydown(disabled), false);
  assert.equal(disabled.calls.prevent, 0);

  cm.state.vim = { mode: "normal", inputState };
  plugin.getFocusedMarkdownEditorView = () => null;
  const unfocused = makeEvent();
  assert.equal(plugin.handleCountedBulletPropertyPhysicalKeydown(unfocused), false);
  assert.equal(unfocused.calls.prevent, 0);
  assert.equal(opens.length, 1);
});
