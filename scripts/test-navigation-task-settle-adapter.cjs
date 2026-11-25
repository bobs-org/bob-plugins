// Navigation settle adapter (bob-cli-q4.10.1.1 settle-bridge).
//
// Real ledger-tools taskSettle v1 plus missing/old/throwing doubles.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");
const { Cm6MappingEditor } = require("./cm6-mapping-editor.cjs");
const { ModalStub } = require("./modal-harness.cjs");

class TestMarkdownView {}
class TestPlugin {
  constructor(app) {
    this.app = app;
  }
  addCommand(command) {
    this.commands = this.commands || [];
    this.commands.push(command);
  }
  registerEditorExtension() {}
  registerEvent(ref) {
    this.registeredEvents = this.registeredEvents || [];
    this.registeredEvents.push(ref);
  }
  registerMarkdownCodeBlockProcessor() {}
  registerMarkdownPostProcessor() {}
  registerInterval(handle) {
    return handle;
  }
}

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    class EmptyClass {}
    class TestModal extends ModalStub {}
    class TestNotice {
      constructor() {}
    }
    return {
      MarkdownRenderChild: EmptyClass,
      MarkdownRenderer: EmptyClass,
      MarkdownView: TestMarkdownView,
      Modal: TestModal,
      Notice: TestNotice,
      Platform: { isDesktopApp: true },
      Plugin: TestPlugin,
      PluginSettingTab: EmptyClass,
      Setting: EmptyClass,
      Scope: EmptyClass,
      normalizePath: (value) => value,
      parseYaml: () => ({}),
      setIcon: undefined,
    };
  }
  if (request === "@codemirror/state") {
    return {
      Prec: { highest: (value) => value },
      StateEffect: { define: () => ({ of: (value) => value }) },
      StateField: { define: (spec) => Object.freeze({ ...spec }) },
      EditorState: {},
      Transaction: {},
    };
  }
  if (request === "@codemirror/view") {
    const emptyDecoration = { map: () => emptyDecoration };
    return {
      EditorView: class EditorView {},
      keymap: { of: (value) => value },
      Decoration: {
        none: emptyDecoration,
        line: (spec) => ({ range: (from) => ({ from, spec }) }),
        set: (ranges) => ({ ranges, map: () => ({ ranges }) }),
      },
    };
  }
  if (request === "@codemirror/commands") {
    return { undoDepth: (state) => state.undoGroups };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const NavigationHotkeysPlugin = require("../plugins/bob-navigation-hotkeys/main.js");
const { helpers } = NavigationHotkeysPlugin;
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

class SettleEditor extends Cm6MappingEditor {
  constructor(content, cursor = { line: 0, ch: 0 }) {
    super(content, cursor);
    this.setValueCalls = [];
    this.scrollToCalls = [];
  }
  setValue(text) {
    this.setValueCalls.push(String(text));
    this.content = String(text);
  }
  scrollTo(left, top) {
    this.scrollToCalls.push({ left, top });
  }
}

function makeView(editor, path) {
  const view = new TestMarkdownView();
  view.editor = editor;
  view.file = { path };
  view.getViewType = () => "markdown";
  return view;
}

function makeApp({ editor, path, extra = [] }) {
  const view = makeView(editor, path);
  const leaves = [{ view, pinned: false }, ...extra];
  return {
    workspace: {
      activeLeaf: leaves[0],
      iterateAllLeaves(visit) {
        for (const leaf of leaves) visit(leaf);
      },
      getLeavesOfType(type) {
        return type === "markdown" ? leaves : [];
      },
      getActiveViewOfType() {
        return leaves[0].view;
      },
      getActiveFile() {
        return leaves[0].view.file;
      },
      on() {
        return { unload() {} };
      },
    },
    plugins: { plugins: {} },
    internalPlugins: {
      plugins: {
        "daily-notes": { instance: { options: { folder: "2026", format: "YYYYMMDD" } } },
      },
    },
    vault: {
      getAbstractFileByPath() {
        return null;
      },
      createFolder() {
        throw new Error("daily files must not be created");
      },
      on() {
        return { unload() {} };
      },
    },
    metadataCache: {},
    view,
    leaves,
  };
}

function attachLedger(app) {
  const ledger = new LedgerToolsPlugin();
  ledger.app = app;
  const settle = ledger.taskSettleApi();
  app.plugins.plugins["bob-ledger-tools"] = { api: { taskSettle: settle } };
  return ledger;
}

function makeNav(app) {
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = app;
  plugin.vimJumpHistory = helpers.createVimJumpHistory();
  plugin.recordJump = function recordJump(from, to) {
    this.jumps = this.jumps || [];
    this.jumps.push({ from, to });
    return true;
  };
  return plugin;
}

test("settle adapter helpers and flush inventory are exported", () => {
  for (const name of [
    "lookupNavTaskSettleApi",
    "resolveNavTaskIdentity",
    "composeNavLineMaps",
    "navTaskSettlePlanCursor",
    "prepareNavSettledPostimage",
    "wrapNavCommandForSettleFlush",
    "navGuardEditorPath",
    "mapReviewQueueEntryThroughSettle",
  ]) {
    assert.equal(typeof helpers[name], "function", `${name} is exported`);
  }
  assert.equal(helpers.NAV_TASK_SETTLE_API_VERSION, 1);
  assert.ok(helpers.NAV_TASK_SETTLE_FLUSH_ROUTES.physical.includes("handleOpenTaskJumpPhysicalKeydown"));
  assert.ok(helpers.NAV_TASK_SETTLE_FLUSH_ROUTES.publicApi.includes("reviewWalk.capture"));
});

test("missing, old, and throwing providers leave the gesture write in place", () => {
  const editor = new SettleEditor("before\n", { line: 0, ch: 0 });
  const app = makeApp({ editor, path: AREA });
  const plugin = makeNav(app);
  const missing = plugin.applyNavSettledEditorWrite(editor, AREA, {
    expected: "before\n",
    contents: "after\n",
  });
  assert.equal(missing.kind, "fallback");
  assert.equal(missing.applied, true);
  assert.equal(editor.getValue(), "after\n");
  assert.equal(missing.provider, "none");

  editor.transaction({
    changes: [{ from: { line: 0, ch: 0 }, to: { line: 0, ch: 5 }, text: "before" }],
  });
  app.plugins.plugins["bob-ledger-tools"] = {
    api: { taskSettle: { version: 0, settleNote() {}, applyToEditor() {}, flushPending() {} } },
  };
  const old = plugin.applyNavSettledEditorWrite(editor, AREA, {
    expected: editor.getValue(),
    contents: "legacy\n",
  });
  assert.equal(old.kind, "fallback");
  assert.equal(editor.getValue(), "legacy\n");

  const throwing = new SettleEditor("start\n", { line: 0, ch: 0 });
  const throwApp = makeApp({ editor: throwing, path: AREA });
  throwApp.plugins.plugins["bob-ledger-tools"] = {
    api: {
      taskSettle: {
        version: 1,
        settleNote() {
          throw new Error("settleNote failed");
        },
        applyToEditor() {
          throw new Error("apply failed");
        },
        flushPending() {
          return [];
        },
      },
    },
  };
  const throwNav = makeNav(throwApp);
  const threw = throwNav.applyNavSettledEditorWrite(throwing, AREA, {
    expected: "start\n",
    contents: "gesture\n",
  });
  assert.equal(threw.kind, "fallback");
  assert.equal(throwing.getValue(), "gesture\n");
});

test("a provider that already changed the buffer is never written twice", () => {
  const editor = new SettleEditor("start\n", { line: 0, ch: 0 });
  const app = makeApp({ editor, path: AREA });
  app.plugins.plugins["bob-ledger-tools"] = {
    api: {
      taskSettle: {
        version: 1,
        settleNote() {
          return { contents: "start\n", changed: false, lineMap: {}, warnings: [] };
        },
        applyToEditor(target) {
          target.transaction({
            changes: [{ from: { line: 0, ch: 0 }, to: { line: 0, ch: 5 }, text: "wrote" }],
          });
          throw new Error("after write");
        },
        flushPending() {
          return [];
        },
      },
    },
  };
  const plugin = makeNav(app);
  const result = plugin.applyNavSettledEditorWrite(editor, AREA, {
    expected: "start\n",
    contents: "gesture\n",
  });
  assert.equal(result.applied, true);
  assert.equal(editor.getValue(), "wrote\n");
  assert.notEqual(editor.getValue(), "gesture\n");
});

test("staged apply with the real provider is one grouped transaction", () => {
  const expected = AREA_INPUT.replace(
    "- [/] #task Finish the design ^design",
    "- [ ] #task Finish the design ^design",
  );
  const editor = new SettleEditor(expected, { line: 8, ch: 4 });
  const app = makeApp({ editor, path: AREA });
  attachLedger(app);
  const plugin = makeNav(app);
  const result = plugin.applyNavSettledEditorWrite(editor, AREA, {
    expected,
    contents: AREA_INPUT,
    identity: {
      blockId: "design",
      line: 8,
      text: "- [/] #task Finish the design ^design",
    },
    today: TODAY,
    dailyPath: DAILY,
  });
  assert.equal(result.kind, "applied");
  assert.equal(result.applied, true);
  assert.equal(editor.transactions.length, 1);
  assert.notEqual(editor.getValue(), expected);
  assert.notEqual(editor.getValue(), AREA_INPUT);
  assert.match(editor.getValue(), /### Next & In Progress/);
  assert.deepEqual(editor.setValueCalls, []);
});

test("noop settle does not write", () => {
  const text = "---\ntype: [[area]]\n---\n## Tasks\n\n- [ ] #task Stay put ^stay\n";
  const editor = new SettleEditor(text, { line: 5, ch: 0 });
  const app = makeApp({ editor, path: "Areas/stay.md" });
  attachLedger(app);
  const plugin = makeNav(app);
  const result = plugin.applyNavSettledEditorWrite(editor, "Areas/stay.md", {
    expected: text,
    contents: text,
    today: TODAY,
    dailyPath: DAILY,
  });
  assert.equal(result.applied, false);
  assert.equal(result.reason, "noop");
  assert.equal(editor.getValue(), text);
  assert.equal(editor.transactions.length, 0);
});

test("stale preimage refuses without writing", () => {
  const editor = new SettleEditor(AREA_INPUT, { line: 8, ch: 2 });
  const app = makeApp({ editor, path: AREA });
  attachLedger(app);
  const plugin = makeNav(app);
  const before = editor.getCursor();
  const result = plugin.applyNavSettledEditorWrite(editor, AREA, {
    expected: "stale\n",
    contents: AREA_INPUT,
    today: TODAY,
    dailyPath: DAILY,
  });
  assert.equal(result.kind, "refused");
  assert.equal(result.reason, "preimage");
  assert.equal(editor.getValue(), AREA_INPUT);
  assert.deepEqual(editor.getCursor(), before);
});

test("A-to-B editor switch refuses even with equal contents", () => {
  const editor = new SettleEditor(AREA_INPUT, { line: 8, ch: 0 });
  const app = makeApp({ editor, path: "Areas/other.md" });
  attachLedger(app);
  const plugin = makeNav(app);
  const result = plugin.applyNavSettledEditorWrite(editor, AREA, {
    expected: AREA_INPUT,
    contents: AREA_INPUT,
    today: TODAY,
    dailyPath: DAILY,
  });
  assert.equal(result.kind, "refused");
  assert.equal(result.reason, "path");
  assert.equal(editor.getValue(), AREA_INPUT);
});

test("own-task cursor stays and records one jump; other cursors follow the map", () => {
  const stayEditor = new SettleEditor(AREA_INPUT, { line: 8, ch: 6 });
  const stayApp = makeApp({ editor: stayEditor, path: AREA });
  attachLedger(stayApp);
  const stayNav = makeNav(stayApp);
  const stay = stayNav.applyNavSettledEditorWrite(stayEditor, AREA, {
    expected: AREA_INPUT,
    contents: AREA_INPUT,
    identity: {
      blockId: "design",
      line: 8,
      text: "- [/] #task Finish the design ^design",
    },
    today: TODAY,
    dailyPath: DAILY,
  });
  assert.equal(stay.applied, true);
  assert.equal(stay.cursor.line, 8);
  assert.ok(stay.jumpTarget);
  assert.equal(stay.jumpTarget.blockId, "design");
  assert.ok(stay.jumpTarget.line > 8);
  assert.equal(stayNav.jumps.length, 1);

  const otherEditor = new SettleEditor(AREA_INPUT, { line: 7, ch: 2 });
  const otherApp = makeApp({ editor: otherEditor, path: AREA });
  attachLedger(otherApp);
  const otherNav = makeNav(otherApp);
  const other = otherNav.applyNavSettledEditorWrite(otherEditor, AREA, {
    expected: AREA_INPUT,
    contents: AREA_INPUT,
    identity: {
      blockId: "design",
      line: 8,
      text: "- [/] #task Finish the design ^design",
    },
    today: TODAY,
    dailyPath: DAILY,
  });
  const mapped = other.lineMap[7];
  assert.equal(typeof mapped, "number");
  assert.equal(other.cursor.line, mapped);
  assert.equal(other.jumpTarget, null);
});

test("annotated writes keep the machine annotation; restore never settles", () => {
  const expected = AREA_INPUT.replace(
    "- [/] #task Finish the design ^design",
    "- [ ] #task Finish the design ^design",
  );
  const editor = new SettleEditor(expected, { line: 8, ch: 0 });
  const app = makeApp({ editor, path: AREA });
  attachLedger(app);
  const plugin = makeNav(app);
  const annotated = plugin.applyNavSettledAnnotatedWrite(editor, AREA, {
    expected,
    contents: AREA_INPUT,
    identity: {
      blockId: "design",
      line: 8,
      text: "- [/] #task Finish the design ^design",
    },
    annotation: helpers.BLOCKS_MACHINE_WRITE_ANNOTATION,
    today: TODAY,
    dailyPath: DAILY,
  });
  assert.equal(annotated.applied, true);
  assert.match(editor.getValue(), /### Next & In Progress/);
  assert.equal(
    editor.transactions[0].annotation,
    helpers.BLOCKS_MACHINE_WRITE_ANNOTATION,
  );

  const original = AREA_INPUT;
  const restoreEditor = new SettleEditor(editor.getValue(), { line: 8, ch: 0 });
  const restoreApp = makeApp({ editor: restoreEditor, path: AREA });
  attachLedger(restoreApp);
  const restoreNav = makeNav(restoreApp);
  const restored = restoreNav.applyNavSettledRestoreWrite(restoreEditor, AREA, {
    expected: restoreEditor.getValue(),
    contents: original,
    annotation: helpers.BLOCKS_MACHINE_WRITE_ANNOTATION,
  });
  assert.equal(restored.kind, "restore");
  assert.equal(restoreEditor.getValue(), original);
  assert.doesNotMatch(restoreEditor.getValue(), /### Next & In Progress/);
});

test("file postimage settles closed-note bytes without a second vault pass", () => {
  const app = makeApp({ editor: new SettleEditor(AREA_INPUT), path: AREA });
  attachLedger(app);
  const plugin = makeNav(app);
  const prepared = plugin.prepareNavSettledFilePostimage(AREA, AREA_INPUT, {
    today: TODAY,
    dailyPath: DAILY,
  });
  assert.equal(prepared.changed, true);
  assert.match(prepared.contents, /### Next & In Progress/);
  const again = plugin.prepareNavSettledFilePostimage(AREA, prepared.contents, {
    today: TODAY,
    dailyPath: DAILY,
  });
  assert.equal(again.changed, false);
  assert.equal(again.contents, prepared.contents);
});
