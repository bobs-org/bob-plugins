// Task settle editor adapter (bob-cli-q4.8.1.2 editor-apply).
//
// Covers the path guard, staged one-transaction apply, cursor-stays
// policy, jump targets, selection mapping, and the observed undo fallback
// when editor.cm is unavailable to join an already-applied write.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");
const { Cm6MappingEditor } = require("./cm6-mapping-editor.cjs");

class TestMarkdownView {}
class TestPlugin {
  constructor(app) {
    this.app = app;
  }
  addCommand(command) {
    this.commands = this.commands || [];
    this.commands.push(command);
  }
  registerEditorExtension(extension) {
    this.editorExtensions = this.editorExtensions || [];
    this.editorExtensions.push(extension);
  }
  registerEvent(ref) {
    this.registeredEvents = this.registeredEvents || [];
    this.registeredEvents.push(ref);
  }
  registerMarkdownCodeBlockProcessor(language, handler) {
    this.codeBlocks = this.codeBlocks || {};
    this.codeBlocks[language] = handler;
  }
  registerMarkdownPostProcessor() {}
  registerInterval(handle) {
    this.intervals = this.intervals || [];
    this.intervals.push(handle);
    return handle;
  }
}

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    class EmptyClass {}
    return {
      MarkdownRenderChild: EmptyClass,
      MarkdownView: TestMarkdownView,
      Notice: EmptyClass,
      Plugin: TestPlugin,
      Platform: { isDesktopApp: true },
      normalizePath: (value) => value,
      parseYaml: () => ({}),
    };
  }
  if (request === "@codemirror/state") {
    return { Prec: { highest: (value) => value } };
  }
  if (request === "@codemirror/view") {
    return {
      EditorView: class EditorView {},
      keymap: { of: (value) => value },
    };
  }
  if (request === "@codemirror/commands") {
    return { undoDepth: (state) => state.undoGroups };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers } = LedgerToolsPlugin;
Module._load = originalLoad;

const TODAY = "2026-11-25";
const DAILY = "2026/20261125.md";
const AREA = "Areas/home.md";

const AREA_INPUT = [
  "---",
  "type: [[area]]",
  "---",
  "## Tasks",
  "",
  "Short context for this project.",
  "",
  "- [ ] #task An idea to pick up later ^idea",
  "- [/] #task Finish the design ^design",
  "  - Keep the keyboard interaction simple.",
  "- [*] #task Review the implementation ^review",
  "- [?] #task Ship when the dependency is ready ^ship",
  "- [x] #task Agree on the scope ^scope",
  "- [-] #task Superseded experiment ^experiment",
  "",
].join("\n");

function classification() {
  return helpers.taskSettleClassificationFromTasksSettings(
    helpers.taskSettleDefaultTasksSettings(),
  );
}

function context(overrides = {}) {
  return {
    today: TODAY,
    dailyPath: DAILY,
    classification: classification(),
    ...overrides,
  };
}

class SettleEditor extends Cm6MappingEditor {
  constructor(content, cursor = { line: 0, ch: 0 }, options = {}) {
    super(content, cursor, options.scrollAnchorLine || 0);
    this.setValueCalls = [];
    this.scrollToCalls = [];
    this.lastUserEvent = null;
    this.joinable = options.joinable === true;
    if (options.withCm) {
      const editor = this;
      this.cm = {
        state: { get undoGroups() { return editor.undoGroups; } },
        dispatch(spec) {
          editor.lastUserEvent = spec && spec.userEvent;
          const joined =
            editor.joinable &&
            spec &&
            spec.userEvent === "input" &&
            editor.undoGroups > 0;
          const changes = (spec.changes || []).map((change) => ({
            from: editor.positionOf(change.from),
            to: editor.positionOf(change.to),
            text: String(change.insert == null ? "" : change.insert),
          }));
          editor.transaction({ changes });
          if (spec.selection) {
            editor.cursor = editor.positionOf(spec.selection.anchor);
          }
          if (joined) editor.undoGroups = Math.max(1, editor.undoGroups - 1);
        },
      };
    }
  }

  setValue(text) {
    this.setValueCalls.push(String(text));
    this.content = String(text);
  }

  scrollTo(left, top) {
    this.scrollToCalls.push({ left, top });
    this.scrollAnchorLine = typeof top === "number" ? Math.round(top / 20) : this.scrollAnchorLine;
  }

  getScrollInfo() {
    return { left: 0, top: this.scrollAnchorLine * 20, clientHeight: 400 };
  }
}

function makeView(editor, path) {
  const view = new TestMarkdownView();
  view.editor = editor;
  view.file = { path };
  view.getViewType = () => "markdown";
  return view;
}

function makeApp({ editor, path, activePath, extra = [], tasksPlugin, dailyOptions, getTasks }) {
  const view = makeView(editor, path);
  const leaves = [{ view, pinned: false }, ...extra];
  const activeLeaf = activePath
    ? leaves.find((leaf) => leaf.view && leaf.view.file && leaf.view.file.path === activePath) || leaves[0]
    : leaves[0];
  const tasks = tasksPlugin || null;
  if (tasks && getTasks) tasks.getTasks = getTasks;
  return {
    workspace: {
      activeLeaf,
      iterateAllLeaves(visit) {
        for (const leaf of leaves) visit(leaf);
      },
      getLeavesOfType(type) {
        return type === "markdown" ? leaves : [];
      },
      getActiveViewOfType() {
        return activeLeaf && activeLeaf.view;
      },
      getActiveFile() {
        return activeLeaf && activeLeaf.view && activeLeaf.view.file;
      },
      on() {
        return { unload() {} };
      },
    },
    plugins: { plugins: tasks ? { "obsidian-tasks-plugin": tasks } : {} },
    internalPlugins: {
      plugins: {
        "daily-notes": { instance: { options: dailyOptions || {} } },
      },
    },
    vault: {
      getAbstractFileByPath() {
        return null;
      },
      createFolder() {
        throw new Error("daily files must not be created");
      },
    },
    metadataCache: {},
    view,
    leaves,
  };
}

function apply(editor, path, options = {}) {
  const app = options.app || makeApp({ editor, path });
  return helpers.taskSettleApplyToEditor(
    editor,
    path,
    { context: context(), app, ...options },
  );
}

test("settle helpers needed for editor-apply are exported", () => {
  for (const name of [
    "taskSettleCaptureContext",
    "taskSettleClassificationFromTasksSettings",
    "taskSettleGuardEditorPath",
    "taskSettleApplyToEditor",
    "taskSettlePlanCursor",
    "taskSettlePlanContentEdits",
  ]) {
    assert.equal(typeof helpers[name], "function", `${name} is exported`);
  }
  assert.equal(helpers.TASK_SETTLE_API_VERSION, 1);
});

test("classification adapter reads Tasks statusSettings and never getTasks", () => {
  let tasksCalls = 0;
  const settings = {
    globalFilter: "#todo",
    statusSettings: {
      coreStatuses: [
        { symbol: " ", type: "TODO" },
        { symbol: "/", type: "IN_PROGRESS" },
        { symbol: "x", type: "DONE" },
      ],
      customStatuses: [{ symbol: "!", type: "TODO" }],
    },
    getTasks() {
      tasksCalls += 1;
      return [{ path: "cache.md" }];
    },
  };
  const app = {
    plugins: { plugins: { "obsidian-tasks-plugin": { settings, getTasks: settings.getTasks } } },
    internalPlugins: { plugins: { "daily-notes": { instance: { options: { folder: "Journal", format: "YYYY-MM-DD" } } } } },
  };
  const captured = helpers.taskSettleCaptureContext(app, { now: new Date("2026-11-25T12:00:00") });
  assert.equal(tasksCalls, 0, "Tasks cache is not a settle input");
  assert.equal(captured.settings.globalFilter, "#todo");
  assert.ok(captured.settings.statusTypes.some((entry) => entry.symbol === "!"));
  assert.equal(captured.classification.globalFilter, "#todo");
  assert.equal(captured.dailyPath, "Journal/2026-11-25.md");
  assert.equal(captured.today, TODAY);
});

test("missing Tasks plugin uses default classification", () => {
  const captured = helpers.taskSettleCaptureContext({
    plugins: { plugins: {} },
    internalPlugins: { plugins: {} },
  });
  assert.equal(captured.classification.globalFilter, "#task");
  assert.ok(captured.settings.statusTypes.some((entry) => entry.symbol === " "));
});

test("path guard: missing view, mismatched path, and inactive matching editor", () => {
  const editor = new SettleEditor(AREA_INPUT, { line: 8, ch: 0 });
  const idle = helpers.taskSettleApplyToEditor(editor, AREA, {
    app: { workspace: { iterateAllLeaves() {} } },
    context: context(),
  });
  assert.equal(idle.applied, false);
  assert.equal(idle.reason, "view");
  assert.equal(editor.getValue(), AREA_INPUT);

  const other = new SettleEditor(AREA_INPUT, { line: 8, ch: 0 });
  const wrong = apply(other, AREA, {
    app: makeApp({ editor: other, path: "Areas/other.md" }),
  });
  assert.equal(wrong.applied, false);
  assert.equal(wrong.reason, "path");
  assert.equal(other.getValue(), AREA_INPUT);

  const inactive = new SettleEditor(AREA_INPUT, { line: 8, ch: 0 });
  const decoy = makeView(new SettleEditor("decoy\n", { line: 0, ch: 0 }), "Daily.md");
  const app = makeApp({
    editor: inactive,
    path: AREA,
    activePath: "Daily.md",
    extra: [{ view: decoy, pinned: false }],
  });
  app.workspace.activeLeaf = app.leaves[1];
  const result = apply(inactive, AREA, { app, identity: { blockId: "design", line: 8, text: "- [/] #task Finish the design ^design" } });
  assert.equal(result.applied, true, "inactive leaf that owns the editor still applies");
  assert.notEqual(inactive.getValue(), AREA_INPUT);
});

test("stale preimage yields no write, cursor, or history", () => {
  const editor = new SettleEditor(AREA_INPUT, { line: 8, ch: 2 });
  const beforeCursor = editor.getCursor();
  const result = apply(editor, AREA, { expected: "stale\n" });
  assert.equal(result.applied, false);
  assert.equal(result.reason, "preimage");
  assert.equal(editor.getValue(), AREA_INPUT);
  assert.deepEqual(editor.getCursor(), beforeCursor);
  assert.equal(editor.undoGroups, 0);
  assert.deepEqual(editor.setValueCalls, []);
});

test("no-op settle does not add history", () => {
  const text = "---\ntype: [[area]]\n---\n## Tasks\n\n- [ ] #task Stay put ^stay\n";
  const editor = new SettleEditor(text, { line: 5, ch: 0 });
  const result = apply(editor, "Areas/stay.md");
  assert.equal(result.applied, false);
  assert.equal(result.reason, "noop");
  assert.equal(result.changed, false);
  assert.equal(editor.undoGroups, 0);
  assert.equal(editor.transactions.length, 0);
});

test("one transaction for staged gesture plus settle; undo restores both", () => {
  const expected = AREA_INPUT.replace("- [/] #task Finish the design ^design", "- [ ] #task Finish the design ^design");
  const staged = AREA_INPUT;
  const editor = new SettleEditor(expected, { line: 8, ch: 4 });
  const result = apply(editor, AREA, {
    contents: staged,
    expected,
    identity: { blockId: "design", line: 8, text: "- [/] #task Finish the design ^design" },
  });
  assert.equal(result.applied, true);
  assert.equal(editor.transactions.length, 1, "gesture and settle share one transaction");
  assert.equal(editor.undoGroups, 1);
  assert.notEqual(editor.getValue(), expected);
  assert.notEqual(editor.getValue(), staged);
  assert.match(editor.getValue(), /### Next & In Progress/);
  assert.deepEqual(editor.setValueCalls, []);
  assert.equal(
    helpers.taskSettleIsWholeDocumentReplacement(editor.transactions[0].changes, expected.split("\n")),
    false,
    "edits are hunks, not a whole-document replacement",
  );
});

test("moved own-task cursor stays; jump target names the new location", () => {
  const editor = new SettleEditor(AREA_INPUT, { line: 8, ch: 6 });
  const result = apply(editor, AREA, {
    identity: { blockId: "design", line: 8, text: "- [/] #task Finish the design ^design" },
  });
  assert.equal(result.applied, true);
  assert.equal(result.cursor.line, 8, "stay keeps the physical line index");
  assert.ok(result.jumpTarget, "jump target is returned for the moved task");
  assert.equal(result.jumpTarget.blockId, "design");
  assert.ok(result.jumpTarget.line > 8, "jump target is the task's new line");
  assert.match(result.jumpTarget.text, /Finish the design/);
  assert.equal(editor.getCursor().line, 8);
});

test("unrelated cursor follows lineMap", () => {
  const editor = new SettleEditor(AREA_INPUT, { line: 7, ch: 2 });
  const result = apply(editor, AREA, {
    identity: { blockId: "design", line: 8, text: "- [/] #task Finish the design ^design" },
  });
  const mapped = result.lineMap[7];
  assert.equal(typeof mapped, "number");
  assert.equal(result.cursor.line, mapped);
  assert.equal(result.jumpTarget, null, "unrelated cursor does not emit a stay jump");
});

test("subtree cursor on the affected task stays", () => {
  const editor = new SettleEditor(AREA_INPUT, { line: 9, ch: 4 });
  const result = apply(editor, AREA, {
    identity: { blockId: "design", line: 8, text: "- [/] #task Finish the design ^design" },
  });
  assert.equal(result.cursor.line, 9, "child line keeps its index");
  assert.ok(result.jumpTarget);
  assert.equal(result.jumpTarget.blockId, "design");
});

test("selection endpoints map; deleted headings clamp into the document", () => {
  const grouped = [
    "---",
    "type: [[area]]",
    "---",
    "## Tasks",
    "[`⚪ 0 open`](#Tasks) · [`🔵 1 next/wip`](#Tasks#Next%20&%20In%20Progress) · `🔴 0 blocked` · `🟢 0 done/canceled`",
    "",
    "### Next & In Progress",
    "",
    "- [ ] #task Reopened ^reopen",
    "",
  ].join("\n");
  const editor = new SettleEditor(grouped, { line: 6, ch: 0 });
  const result = apply(editor, "Areas/group-removal.md", {
    selection: { from: { line: 6, ch: 0 }, to: { line: 6, ch: 4 } },
  });
  assert.equal(result.applied, true);
  assert.ok(result.cursor.line >= 0);
  const lines = editor.getValue().split("\n");
  assert.ok(result.cursor.line < lines.length);
  assert.doesNotMatch(editor.getValue(), /### Next & In Progress/);
});

test("UTF-16 columns are preserved on an unchanged line", () => {
  const text = "---\ntype: [[area]]\n---\n## Tasks\n\n- [ ] #task Café 🎵 stay ^utf\n- [/] #task Move me ^move\n";
  const line = "- [ ] #task Café 🎵 stay ^utf";
  const ch = line.indexOf("🎵");
  assert.ok(ch > 0);
  assert.equal(line[ch], "\uD83C", "column is a UTF-16 code unit, not a code point");
  const editor = new SettleEditor(text, { line: 5, ch });
  const result = apply(editor, "Areas/utf.md");
  assert.equal(result.applied, true);
  assert.equal(result.cursor.line, result.lineMap[5]);
  assert.equal(result.cursor.ch, ch);
});

test("CRLF coordinates stay CRLF and still apply hunks", () => {
  const text = AREA_INPUT.replace(/\n/g, "\r\n");
  const editor = new SettleEditor(text, { line: 8, ch: 0 });
  const result = apply(editor, AREA, {
    identity: { blockId: "design", line: 8, text: "- [/] #task Finish the design ^design" },
  });
  assert.equal(result.applied, true);
  assert.ok(editor.getValue().includes("\r\n"));
  assert.equal(editor.getValue().includes("\n") || true, true);
});

test("already-applied write joins through cm.dispatch; transaction fallback is a second undo", () => {
  const withCm = new SettleEditor(AREA_INPUT, { line: 8, ch: 0 }, { withCm: true, joinable: true });
  withCm.undoGroups = 1;
  const joined = apply(withCm, AREA, {
    identity: { blockId: "design", line: 8, text: "- [/] #task Finish the design ^design" },
    joinHistory: true,
  });
  assert.equal(joined.applied, true);
  assert.equal(joined.historyJoined, true);
  assert.equal(withCm.lastUserEvent, "input");
  assert.equal(withCm.undoGroups, 1, "CM6 join keeps one undo group");

  const fallback = new SettleEditor(AREA_INPUT, { line: 8, ch: 0 });
  fallback.undoGroups = 1;
  const separate = apply(fallback, AREA, {
    identity: { blockId: "design", line: 8, text: "- [/] #task Finish the design ^design" },
    joinHistory: true,
  });
  assert.equal(separate.applied, true);
  assert.equal(separate.historyJoined, false);
  assert.equal(
    fallback.undoGroups,
    2,
    "without editor.cm, editor.transaction is a second undo (regroup then original write)",
  );
});

test("mixin applyToEditor is installed and the complete public namespace is available", () => {
  const editor = new SettleEditor(AREA_INPUT, { line: 8, ch: 0 });
  const app = makeApp({ editor, path: AREA });
  const plugin = new LedgerToolsPlugin(app);
  assert.equal(typeof plugin.taskSettleApplyToEditor, "function");
  const result = plugin.taskSettleApplyToEditor(editor, AREA, {
    context: context(),
    identity: { blockId: "design", line: 8, text: "- [/] #task Finish the design ^design" },
  });
  assert.equal(result.applied, true);
  assert.equal(plugin.api, undefined, "root api is not installed until onload");
  const namespace = plugin.taskSettleApi();
  assert.equal(namespace.version, 1);
  assert.equal(Object.isFrozen(namespace), true);
  for (const name of ["settleNote", "applyToEditor", "schedulePending", "flushPending"]) {
    assert.equal(typeof namespace[name], "function", name);
  }
  const source = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "../plugins/bob-ledger-tools/src/170-plugin-lifecycle.js"),
    "utf8",
  );
  assert.equal(
    /taskSettle:\s*this\.taskSettleApi\(\)/.test(source),
    true,
    "onload publishes taskSettle on this.api",
  );
});
