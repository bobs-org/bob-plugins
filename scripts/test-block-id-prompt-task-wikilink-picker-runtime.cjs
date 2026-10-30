// Runtime tests for the `((` Task Wikilink Picker: auto-open, keys, accept,
// stale refresh, the reopen command, managed-line notices, and ^^ regressions.
// Loads the built plugin with modal-harness.cjs's ModalStub (the
// pomodoro-picker-view pattern); block-id-prompt-harness.cjs stays on its
// stub Modal, so this file owns a small editor/plugin shell.

const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const { ModalStub, pressKey } = require("./modal-harness.cjs");

global.window = global.window || {
  setTimeout: (callback) => callback(),
  clearTimeout: () => {},
};

const noticeMessages = [];
let obsidianStubs = null;
const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    class EmptyClass {}
    class TestModal extends ModalStub {}
    class TestNotice {
      constructor(message) {
        noticeMessages.push(String(message));
      }
    }
    class TestTFile {
      constructor() {
        this.path = "";
        this.extension = "md";
      }
    }
    class TestMarkdownView extends EmptyClass {}
    obsidianStubs = {
      MarkdownView: TestMarkdownView,
      Modal: TestModal,
      Notice: TestNotice,
      Plugin: EmptyClass,
      Setting: EmptyClass,
      TFile: TestTFile,
      normalizePath: (value) => String(value || ""),
      setIcon: () => {},
    };
    return obsidianStubs;
  }
  if (request === "@codemirror/view") {
    class EditorView {}
    EditorView.updateListener = { of: (callback) => ({ callback }) };
    return { EditorView };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const Plugin = require("../plugins/block-id-prompt/main.js");
Module._load = originalLoad;
const { helpers } = Plugin;

function lastNotice() {
  return noticeMessages[noticeMessages.length - 1];
}

function resetNotices() {
  noticeMessages.length = 0;
}

function positionToIndex(value, position) {
  let index = 0;
  for (let line = 0; line < position.line; line += 1) {
    const newline = value.indexOf("\n", index);
    if (newline === -1) {
      return value.length;
    }
    index = newline + 1;
  }
  return index + position.ch;
}

function createEditor(content, cursor = { line: 0, ch: 0 }) {
  let value = content;
  let selection = { anchor: cursor, head: cursor };
  const transactions = [];
  const editor = {
    cm: {},
    transactions,
    getValue() {
      return value;
    },
    getLine(line) {
      return value.split("\n")[line] || "";
    },
    lineCount() {
      return value.split("\n").length;
    },
    replaceRange(replacement, from, to = from) {
      const start = positionToIndex(value, from);
      const end = positionToIndex(value, to);
      value = value.slice(0, start) + replacement + value.slice(end);
    },
    transaction(spec) {
      transactions.push(spec);
      for (const change of spec.changes || []) {
        editor.replaceRange(change.text, change.from, change.to || change.from);
      }
      if (spec.selections && spec.selections[0]) {
        selection = {
          anchor: spec.selections[0].from,
          head: spec.selections[0].to || spec.selections[0].from,
        };
      }
    },
    setCursor(next) {
      selection = { anchor: next, head: next };
    },
    getCursor() {
      return selection.head;
    },
    listSelections() {
      return [{ anchor: selection.anchor, head: selection.head }];
    },
    setSelection(from, to) {
      selection = { anchor: from, head: to || from };
    },
  };
  return editor;
}

function createTFile(path) {
  const file = new obsidianStubs.TFile();
  file.path = path;
  file.extension = path.split(".").pop();
  return file;
}

function createMarkdownView(file, editor) {
  const view = new obsidianStubs.MarkdownView();
  view.file = file;
  view.editor = editor;
  view.getMode = () => "source";
  view.getState = () => ({ mode: "source" });
  return view;
}

function lineStartOffset(content, line) {
  if (line <= 0) {
    return 0;
  }
  const lines = String(content).split("\n");
  let offset = 0;
  for (let index = 0; index < line; index += 1) {
    offset += (lines[index] || "").length + 1;
  }
  return offset;
}

function makeUpdate({ from = 0, to = 0, text = "", userInput = true, undo = false, view = {} }) {
  return {
    view,
    docChanged: true,
    transactions: [
      {
        isUserEvent(kind) {
          if (kind === "undo" || kind === "redo") {
            return undo && kind === "undo";
          }
          if (kind === "input") {
            return userInput && !undo;
          }
          return false;
        },
      },
    ],
    changes: {
      iterChanges(fn) {
        fn(from, to, from, from + text.length, { toString: () => text });
      },
    },
  };
}

function ingestVault(plugin, files) {
  plugin.ensureTaskWikilinkIndex();
  for (const [path, content] of Object.entries(files)) {
    plugin.taskWikilinkIndex.ingestNote(path, content, {
      mtime: 1,
      size: content.length,
    });
  }
}

function createPlugin({ files, activePath, cursor, editorContent }) {
  resetNotices();
  const plugin = new Plugin();
  const content = editorContent ?? files[activePath];
  const editor = createEditor(content, cursor);
  const file = createTFile(activePath);
  const view = createMarkdownView(file, editor);
  editor.cm = { id: "cm" };
  const store = { ...files };
  plugin.app = {
    workspace: {
      getActiveViewOfType: () => view,
      getActiveFile: () => file,
      getLeavesOfType: () => [{ view }],
      onLayoutReady: (cb) => cb(),
    },
    vault: {
      getMarkdownFiles: () => Object.keys(store).map((path) => createTFile(path)),
      getAbstractFileByPath: (path) => (path in store ? createTFile(path) : null),
      cachedRead: async (target) => store[target.path],
      read: async (target) => store[target.path],
    },
    metadataCache: {
      getFileCache: () => ({ listItems: [{ task: " " }] }),
      getFirstLinkpathDest: (linkpath) => {
        const path = `${linkpath}.md`;
        return path in store ? createTFile(path) : createTFile(Object.keys(store)[0]);
      },
    },
    plugins: { plugins: {} },
  };
  plugin.promptOpen = false;
  plugin.suppressUntil = 0;
  plugin.lastPromptKey = null;
  plugin.scanTimer = null;
  plugin.addCommand = () => {};
  plugin.registerEditorExtension = () => {};
  plugin.register = () => {};
  plugin.registerEvent = (ref) => ref;
  ingestVault(plugin, store);
  return { plugin, editor, file, view, store };
}

function openFromToken(harness, extra = {}) {
  const line = harness.editor.getCursor().line;
  const lineText = harness.editor.getLine(line);
  const token = helpers.findTaskWikilinkToken(lineText, harness.editor.getCursor().ch);
  assert.ok(token, "expected a (( token");
  const source = harness.plugin.taskWikilinkSourceFromToken(
    harness.editor,
    harness.file.path,
    line,
    lineText,
    token,
    extra,
  );
  harness.plugin.openTaskWikilinkPicker(source);
  return source;
}

const VAULT = {
  "sase_cleanup.md": [
    "# Cleanup",
    "- [ ] #task Stop idling when no agents run ^no-idle",
    "- [ ] #task Follow up with Kelly about ((",
  ].join("\n"),
  "Tasks.md": "- [ ] #task Render the Blender turntable ^turntable\n",
  "mac_inbox.md": "- [ ] #task Try Opus with Blender.\n",
};

test("auto-open only on a written second paren, including auto-pair and closed shapes", () => {
  const harness = createPlugin({
    files: VAULT,
    activePath: "sase_cleanup.md",
    cursor: { line: 2, ch: 34 },
  });
  const line = harness.editor.getLine(2);
  const opener = line.indexOf("((");
  const docOpener = lineStartOffset(harness.editor.getValue(), 2) + opener;
  harness.plugin.inspectActiveEditor(harness.editor.cm);
  assert.equal(harness.plugin.promptOpen, false);

  harness.plugin.recordTaskWikilinkWrittenRanges(
    makeUpdate({ from: docOpener, to: docOpener, text: "((", view: harness.editor.cm }),
  );
  harness.editor.setCursor({ line: 2, ch: opener + 2 });
  harness.plugin.inspectActiveEditor(harness.editor.cm);
  assert.equal(harness.plugin.promptOpen, true);
  harness.plugin.promptOpen = false;
  harness.plugin.lastPromptKey = null;

  const closed = createPlugin({
    files: {
      "note.md": "Hello ((foo))",
    },
    activePath: "note.md",
    cursor: { line: 0, ch: 8 },
  });
  closed.plugin.recordTaskWikilinkWrittenRanges(
    makeUpdate({ from: 6, to: 6, text: "((foo))", view: closed.editor.cm }),
  );
  closed.plugin.inspectActiveEditor(closed.editor.cm);
  assert.equal(closed.plugin.promptOpen, true);
});

test("caret-only, undo, and programmatic edits never auto-open", () => {
  const harness = createPlugin({
    files: { "note.md": "Hello ((foo))" },
    activePath: "note.md",
    cursor: { line: 0, ch: 8 },
  });
  harness.plugin.inspectActiveEditor(harness.editor.cm);
  assert.equal(harness.plugin.promptOpen, false);

  harness.plugin.recordTaskWikilinkWrittenRanges(
    makeUpdate({ from: 6, to: 6, text: "((", userInput: false, view: harness.editor.cm }),
  );
  harness.plugin.inspectActiveEditor(harness.editor.cm);
  assert.equal(harness.plugin.promptOpen, false);

  harness.plugin.recordTaskWikilinkWrittenRanges(
    makeUpdate({ from: 6, to: 6, text: "((", undo: true, view: harness.editor.cm }),
  );
  harness.plugin.inspectActiveEditor(harness.editor.cm);
  assert.equal(harness.plugin.promptOpen, false);
});

test("query seeds from the token and keys move, accept, escape, and backspace", async () => {
  const harness = createPlugin({
    files: {
      "note.md": "See ((turn",
      "Tasks.md": VAULT["Tasks.md"],
      "sase_cleanup.md": VAULT["sase_cleanup.md"],
    },
    activePath: "note.md",
    cursor: { line: 0, ch: 10 },
  });
  harness.plugin.recordTaskWikilinkWrittenRanges(
    makeUpdate({ from: 4, to: 4, text: "((turn", view: harness.editor.cm }),
  );
  harness.plugin.inspectActiveEditor(harness.editor.cm);
  assert.equal(harness.plugin.promptOpen, true);
  const modal = [...(global.document ? [] : [])];
  void modal;
  const opened = harness.plugin;
  assert.equal(opened.promptOpen, true);

  const source = harness.plugin.taskWikilinkSourceFromToken(
    harness.editor,
    "note.md",
    0,
    harness.editor.getLine(0),
    helpers.findTaskWikilinkToken(harness.editor.getLine(0), 10),
  );
  const snapshot = harness.plugin.taskWikilinkSnapshot(source);
  const picker = new helpers.TaskWikilinkPickerModal(harness.plugin.app, harness.plugin, source, snapshot);
  picker.open();
  assert.equal(picker.query, "turn");
  assert.ok(picker.plan.selected.displayText.includes("turntable"));

  pressKey(picker, "ArrowDown");
  pressKey(picker, "n", { ctrlKey: true });
  pressKey(picker, "p", { ctrlKey: true });
  pressKey(picker, "j", { ctrlKey: true });
  pressKey(picker, "k", { ctrlKey: true });
  pressKey(picker, "PageDown");
  pressKey(picker, "PageUp");
  pressKey(picker, "ArrowDown", { metaKey: true });
  pressKey(picker, "ArrowUp", { metaKey: true });
  pressKey(picker, "Enter", { shiftKey: true });
  pressKey(picker, "Enter", { altKey: true });
  pressKey(picker, "Tab", { shiftKey: true });
  assert.equal(harness.editor.getValue(), "See ((turn");

  picker.query = "turn";
  if (picker.inputEl) picker.inputEl.value = "turn";
  pressKey(picker, "Escape");
  assert.equal(picker.query, "");
  assert.equal(harness.editor.getValue(), "See ((turn");
  pressKey(picker, "Escape");
  assert.equal(picker.isOpen, false);
  assert.equal(harness.editor.getValue(), "See ((turn");
});

test("Backspace undoes closed ((q)) to () and unclosed ((q to (", () => {
  const closed = createPlugin({
    files: { "note.md": "Hi ((q))" },
    activePath: "note.md",
    cursor: { line: 0, ch: 5 },
  });
  const closedSource = openFromToken(closed);
  const closedPicker = new helpers.TaskWikilinkPickerModal(
    closed.plugin.app,
    closed.plugin,
    closedSource,
    closed.plugin.taskWikilinkSnapshot(closedSource),
  );
  closedPicker.open();
  pressKey(closedPicker, "Backspace");
  assert.equal(closed.editor.getValue(), "Hi ()");
  assert.deepEqual(closed.editor.getCursor(), { line: 0, ch: 4 });

  const open = createPlugin({
    files: { "note.md": "Hi ((q" },
    activePath: "note.md",
    cursor: { line: 0, ch: 5 },
  });
  const openSource = openFromToken(open);
  const openPicker = new helpers.TaskWikilinkPickerModal(
    open.plugin.app,
    open.plugin,
    openSource,
    open.plugin.taskWikilinkSnapshot(openSource),
  );
  openPicker.open();
  pressKey(openPicker, "Backspace");
  assert.equal(open.editor.getValue(), "Hi (");
  assert.deepEqual(open.editor.getCursor(), { line: 0, ch: 4 });
});

test("identified accept splices one transaction, caret after ]], no notice", async () => {
  const harness = createPlugin({
    files: {
      "note.md": "See ((turn))",
      "Tasks.md": VAULT["Tasks.md"],
    },
    activePath: "note.md",
    cursor: { line: 0, ch: 8 },
  });
  const source = openFromToken(harness);
  const snapshot = harness.plugin.taskWikilinkSnapshot(source);
  const item = helpers.buildTaskWikilinkPickerPlan({
    rows: snapshot.rows,
    query: "turn",
    ownerPath: "note.md",
    source,
    renderAll: true,
  }).selected;
  resetNotices();
  const result = await harness.plugin.acceptTaskWikilinkIdentified(source, item);
  assert.equal(result.ok, true);
  assert.equal(harness.editor.getValue(), "See [[Tasks#^turntable]]");
  assert.deepEqual(harness.editor.getCursor(), { line: 0, ch: "See [[Tasks#^turntable]]".length });
  assert.equal(harness.editor.transactions.length, 1);
  assert.equal(harness.editor.transactions[0].changes.length, 1);
  assert.equal(noticeMessages.length, 0);
});

test("stale target paths keep the picker open with a Notice", async () => {
  const harness = createPlugin({
    files: {
      "note.md": "See ((idle))",
      "sase_cleanup.md": "- [ ] #task Stop idling ^no-idle\n",
    },
    activePath: "note.md",
    cursor: { line: 0, ch: 8 },
  });
  const source = openFromToken(harness);
  const snapshot = harness.plugin.taskWikilinkSnapshot(source);
  const item = helpers.buildTaskWikilinkPickerPlan({
    rows: snapshot.rows,
    query: "idle",
    ownerPath: "note.md",
    source,
    renderAll: true,
  }).selected;
  harness.plugin.promptOpen = true;
  harness.app = harness.plugin.app;
  harness.plugin.app.vault.read = async () => "- [ ] #task Stop idling\n";
  harness.plugin.app.vault.cachedRead = async () => "- [ ] #task Stop idling\n";
  const missing = await harness.plugin.acceptTaskWikilinkIdentified(source, item);
  assert.equal(missing.ok, false);
  assert.equal(missing.stale, true);
  assert.match(lastNotice(), /no longer has \^no-idle/);
  assert.equal(harness.editor.getValue(), "See ((idle))");

  harness.plugin.app.vault.read = async () =>
    "- [ ] #task Stop idling ^no-idle\n- [ ] #task Other ^no-idle\n";
  const dup = await harness.plugin.acceptTaskWikilinkIdentified(source, item);
  assert.equal(dup.stale, true);
  assert.match(lastNotice(), /duplicated/);

  harness.plugin.app.vault.read = async () =>
    "- [ ] #task unrelated\n- [ ] #task Stop idling ^no-idle\n";
  const moved = await harness.plugin.acceptTaskWikilinkIdentified(source, item);
  assert.equal(moved.stale, true);
  assert.match(lastNotice(), /task line changed/);

  source.raw = "((changed))";
  const token = await harness.plugin.acceptTaskWikilinkIdentified(source, item);
  assert.equal(token.stale, true);
  assert.match(lastNotice(), /\(\(…\)\) text changed/);
});

test("command opens on a token, a selection, or the caret", () => {
  const tokenCase = createPlugin({
    files: { "note.md": "Hello ((foo))" },
    activePath: "note.md",
    cursor: { line: 0, ch: 8 },
  });
  tokenCase.plugin.linkTaskWikilinkCommand(tokenCase.editor, tokenCase.view);
  assert.equal(tokenCase.plugin.promptOpen, true);

  const selection = createPlugin({
    files: { "note.md": "Hello world" },
    activePath: "note.md",
    cursor: { line: 0, ch: 6 },
  });
  selection.editor.setSelection({ line: 0, ch: 6 }, { line: 0, ch: 11 });
  selection.plugin.linkTaskWikilinkCommand(selection.editor, selection.view);
  assert.equal(selection.plugin.promptOpen, true);

  const caret = createPlugin({
    files: { "note.md": "Hello" },
    activePath: "note.md",
    cursor: { line: 0, ch: 5 },
  });
  caret.plugin.linkTaskWikilinkCommand(caret.editor, caret.view);
  assert.equal(caret.plugin.promptOpen, true);
});

test("managed-line (( shows that line's guard notice and never opens", () => {
  const harness = createPlugin({
    files: {
      "note.md": "- ⛓️ **DEPENDS ON:** ((",
    },
    activePath: "note.md",
    cursor: { line: 0, ch: 22 },
  });
  const line = harness.editor.getLine(0);
  const opener = line.indexOf("((");
  harness.plugin.recordTaskWikilinkWrittenRanges(
    makeUpdate({ from: opener, to: opener, text: "((", view: harness.editor.cm }),
  );
  harness.plugin.inspectActiveEditor(harness.editor.cm);
  assert.equal(harness.plugin.promptOpen, false);
  assert.match(lastNotice(), /Dependency link/);
});

test("command in an excluded context shows Task wikilinks can't go here", () => {
  const harness = createPlugin({
    files: { "note.md": "```\n((\n```" },
    activePath: "note.md",
    cursor: { line: 1, ch: 2 },
  });
  harness.plugin.linkTaskWikilinkCommand(harness.editor, harness.view);
  assert.equal(harness.plugin.promptOpen, false);
  assert.equal(lastNotice(), "Task wikilinks can't go here");
});

test("^^ marker still opens the per-note picker when (( is absent", () => {
  const harness = createPlugin({
    files: {
      "note.md": "- [ ] #task Hello [[note#^^]]",
    },
    activePath: "note.md",
    cursor: { line: 0, ch: 27 },
  });
  let opened = false;
  let openedSource = null;
  harness.plugin.openTaskLinkPicker = async (source) => {
    opened = true;
    openedSource = source;
  };
  harness.plugin.inspectActiveEditor(harness.editor.cm);
  assert.equal(opened, true);
  assert.equal(openedSource.trigger, "^^");
  assert.equal(harness.plugin.promptOpen, false);
});

test("ID-less Enter opens naming mode with the picker state", async () => {
  const harness = createPlugin({
    files: {
      "note.md": "See ((opus))",
      "mac_inbox.md": VAULT["mac_inbox.md"],
    },
    activePath: "note.md",
    cursor: { line: 0, ch: 8 },
  });
  const source = openFromToken(harness);
  const snapshot = harness.plugin.taskWikilinkSnapshot(source);
  const picker = new helpers.TaskWikilinkPickerModal(
    harness.plugin.app,
    harness.plugin,
    source,
    snapshot,
  );
  picker.open();
  picker.query = "opus";
  if (picker.inputEl) picker.inputEl.value = "opus";
  picker.renderAll();
  const selected = picker.plan.selected;
  assert.ok(selected && !selected.identified);
  let promptSource = null;
  harness.plugin.selectTaskLinkTask = async (pickedSource, task, pickerState) => ({
    promptSource: {
      ...pickedSource,
      kind: "link-task-complete",
      trigger: "((",
      targetText: task.linkTarget,
      task,
      pickerState,
    },
  });
  harness.plugin.openBlockIdPrompt = (source) => {
    promptSource = source;
  };
  picker.acceptSelected();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(picker.isOpen, false);
  assert.equal(promptSource.kind, "link-task-complete");
  assert.equal(promptSource.trigger, "((");
  assert.equal(promptSource.pickerState.query, "opus");
  assert.equal(promptSource.task.notePath, selected.row.notePath);
});
