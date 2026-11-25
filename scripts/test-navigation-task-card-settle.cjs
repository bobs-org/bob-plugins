// Task Card, schedule, priority, and quick-roll commits settle (bob-cli-q4.10.1.3).
//
// Card writers stage the full postimage (logs, lane changes, same-note
// Pomodoro cleanup) before settling; every touched note settles; rollback
// restores settled bytes; missing providers fall back to the legacy write.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");
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

const {
  notices,
  NavigationHotkeysPlugin,
  helpers,
  TransactionEditor,
} = require("./navigation-hotkeys-harness.cjs");
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
Module._load = originalLoad;

const TODAY = "2026-11-25";
const BASE_DATE = new Date(2026, 10, 25);
const AREA = "Areas/home.md";
const PRIORITY = {
  name: "priority",
  values: "priority",
  schedules: "scheduled",
  levels: [
    { label: "P1", value: "high", min_days: 2, max_days: 7, minDays: 2, maxDays: 7 },
    { label: "P2", value: "medium", min_days: 8, max_days: 30, minDays: 8, maxDays: 30 },
  ],
};

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

function makeNav(app, editor, path) {
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = app;
  plugin.vimJumpHistory = helpers.createVimJumpHistory();
  plugin.getActiveMarkdownView = () => ({ editor, file: { path } });
  plugin.recordJump = function recordJump(from, to) {
    this.jumps = this.jumps || [];
    this.jumps.push({ from, to });
    return true;
  };
  return plugin;
}

// Deterministic fake v1 provider with genuine fixpoint grouping: task lines
// move under a trailing "## Settled" section exactly once.
function groupingSettle(contents) {
  const lines = String(contents).split("\n");
  if (lines.some((line) => line === "## Settled")) {
    const lineMap = {};
    lines.forEach((_, index) => {
      lineMap[index] = index;
    });
    return { contents: String(contents), changed: false, lineMap, warnings: [] };
  }
  const isTask = (line) => /^- \[[^\]]\]/.test(line);
  const out = [];
  const lineMap = {};
  lines.forEach((line, index) => {
    if (!isTask(line)) {
      lineMap[index] = out.length;
      out.push(line);
    }
  });
  const moved = lines.filter(isTask);
  if (moved.length === 0) {
    return { contents: String(contents), changed: false, lineMap, warnings: [] };
  }
  out.push("## Settled");
  lines.forEach((line, index) => {
    if (isTask(line)) {
      lineMap[index] = out.length;
      out.push(line);
    }
  });
  return { contents: out.join("\n"), changed: true, lineMap, warnings: [] };
}

function makeFakeSettle(seen) {
  return {
    version: 1,
    settleNote(request) {
      seen.notes.push(String(request.contents));
      return groupingSettle(request.contents);
    },
    applyToEditor(editor, path, { expected, contents, cursor }) {
      seen.editorCalls.push({ path, expected, contents });
      const live = String(editor.getValue());
      if (live !== String(expected)) {
        return {
          applied: false,
          changed: false,
          contents: live,
          lineMap: {},
          cursor: cursor || null,
          jumpTarget: null,
          reason: "preimage",
          warnings: [],
          provider: "v1",
        };
      }
      const settled = groupingSettle(contents);
      const liveLines = live.split("\n");
      const last = liveLines.length - 1;
      editor.transaction({
        changes: [
          {
            from: { line: 0, ch: 0 },
            to: { line: last, ch: liveLines[last].length },
            text: settled.contents,
          },
        ],
        selection: cursor ? { from: cursor, to: cursor } : undefined,
      });
      return {
        applied: true,
        changed: settled.contents !== String(expected),
        contents: settled.contents,
        lineMap: settled.lineMap,
        cursor: cursor || null,
        jumpTarget: null,
        reason: null,
        warnings: [],
        historyJoined: false,
        provider: "v1",
      };
    },
    flushPending() {
      return [];
    },
  };
}

function attachFake(app, seen) {
  app.plugins.plugins["bob-ledger-tools"] = { api: { taskSettle: makeFakeSettle(seen) } };
}

test("counted priority card commit settles the full note in one transaction", async () => {
  const content = [
    "---",
    "type: [[area]]",
    "---",
    "## Tasks",
    "",
    "- [ ] #task Alpha ^alpha",
    "- [*] #task Gamma ^gamma",
    "- [ ] #task Beta ^beta",
    "",
  ].join("\n");
  const editor = new TransactionEditor(content, { line: 5, ch: 5 });
  const app = makeApp({ editor, path: AREA });
  attachLedger(app);
  const plugin = makeNav(app, editor, AREA);
  const session = helpers.discoverCountedObsidianTaskTargets(content, 5, 0);
  assert.equal(session.valid, true);

  const ok = await plugin.setCountedBulletPriorityValue(
    editor,
    { line: 5, ch: 5 },
    AREA,
    session,
    PRIORITY,
    PRIORITY.levels[0],
    // The Task Card dispatch (450-picker-keydown) always sets settleNav.
    { baseDate: BASE_DATE, random: () => 0, settleNav: true },
  );
  assert.equal(ok, true);
  const after = String(editor.getValue());
  // The rolled future date lands on the task and the note is grouped.
  assert.match(after, /\[scheduled:: 2026-11-27\]/);
  assert.match(after, /^### /m);
  assert.equal(editor.transactions.length, 1);
  // A second settle over the written bytes is unchanged.
  const again = plugin.prepareNavSettledFilePostimage(AREA, after, { today: TODAY });
  assert.equal(again.changed, false);
  assert.equal(again.contents, after);
});

test("counted property delete writes plan.content and falls back without a provider", async () => {
  for (const settleNav of [true, false]) {
    const content = [
      "- [ ] #task Alpha [scheduled:: 2099-01-01] ^alpha",
      "- [ ] #task Beta [scheduled:: 2099-01-01] ^beta",
    ].join("\n");
    const editor = new TransactionEditor(content, { line: 0, ch: 5 });
    const app = makeApp({ editor, path: "Tasks.md" });
    const plugin = makeNav(app, editor, "Tasks.md");
    const session = helpers.discoverCountedObsidianTaskTargets(content, 0, 1);
    assert.equal(session.valid, true);

    const result = await plugin.deleteCountedBulletPropertyValue(
      editor,
      { line: 0, ch: 5 },
      "Tasks.md",
      session,
      "scheduled",
      { settleNav },
    );
    assert.ok(result && result.deleted === true, "delete succeeds (no undefined postimage)");
    assert.doesNotMatch(String(editor.getValue()), /\[scheduled::/);
    assert.match(String(editor.getValue()), /Alpha/);
    assert.equal(editor.transactions.length, 1);
  }
});

test("project-schedule delete settles and returns the settled line", async () => {
  const seen = { notes: [], editorCalls: [] };
  const content = [
    "---",
    "type: [[project]]",
    "---",
    "- [ ] #task Ship it [scheduled:: 2099-01-01] ^prj",
    "- [ ] #task Other ^other",
  ].join("\n");
  const editor = new TransactionEditor(content, { line: 3, ch: 5 });
  const app = makeApp({ editor, path: "Projects/app.md" });
  attachFake(app, seen);
  const plugin = makeNav(app, editor, "Projects/app.md");

  const result = await plugin.deleteProjectNoteScheduledValue(
    editor,
    { line: 3, ch: 5 },
    "Projects/app.md",
    "- [ ] #task Ship it [scheduled:: 2099-01-01] ^prj",
    "2099-01-01",
    { settleNav: true },
  );
  assert.ok(result && result.deleted === true);
  assert.equal(seen.editorCalls.length, 1);
  // Full postimage (planned delete plus stamp) went through the provider.
  assert.match(seen.editorCalls[0].contents, /Ship it/);
  assert.doesNotMatch(seen.editorCalls[0].contents, /\[scheduled::/);
  const settled = String(editor.getValue());
  assert.match(settled, /## Settled/);
  // The returned line is resolved from the settled bytes, not the staged text.
  assert.ok(settled.includes(result.line));
  assert.match(result.line, /\^prj/);
});

test("link batch settles every note and rolls back from settled bytes", async () => {
  const seen = { notes: [], editorCalls: [] };
  const first = new TransactionEditor("- [ ] #task One ^a1", { line: 0, ch: 5 });
  const second = new TransactionEditor("- [ ] #task Two ^a2", { line: 0, ch: 5 });
  const app = makeApp({ editor: first, path: "One.md" });
  attachFake(app, seen);
  const plugin = makeNav(app, first, "One.md");
  const extraLeaves = [
    { view: makeView(first, "One.md"), pinned: false },
    { view: makeView(second, "Two.md"), pinned: false },
  ];
  app.workspace.getLeavesOfType = (type) =>
    type === "markdown" ? extraLeaves : [];
  app.workspace.iterateAllLeaves = (visit) => {
    for (const leaf of extraLeaves) visit(leaf);
  };
  const planned = [
    {
      group: { path: "One.md", file: { path: "One.md" }, content: "- [ ] #task One ^a1" },
      plan: { content: "- [*] #task One ^a1", futureScheduledTaskLines: [] },
    },
    {
      group: { path: "Two.md", file: { path: "Two.md" }, content: "- [ ] #task Two ^a2" },
      plan: { content: "- [*] #task Two ^a2", futureScheduledTaskLines: [] },
    },
  ];
  const writes = [];
  const original = plugin.writeLinkPickerNoteChange.bind(plugin);
  let calls = 0;
  plugin.writeLinkPickerNoteChange = async (...args) => {
    calls += 1;
    writes.push({ path: args[0], before: args[2], after: args[3] });
    if (calls === 2) throw new Error("second target failed");
    const settled = await original(...args);
    writes[calls - 1].result = settled;
    return settled;
  };
  const commit = await plugin.commitLinkPickerNoteWrites(planned, {
    pomodoroSnapshot: null,
    dailyCleanupPlan: null,
    foldedDailyPath: null,
    settleNav: true,
    settleToday: TODAY,
  });
  assert.equal(commit.ok, false);
  // The first note rolled back to its pre-write bytes ...
  assert.equal(String(first.getValue()), "- [ ] #task One ^a1");
  // ... from its settled after-text: the rollback preimage is the settled write.
  assert.equal(writes.length, 2 + 1);
  assert.match(writes[0].result, /## Settled/);
  assert.equal(writes[2].before, writes[0].result);
  assert.equal(writes[2].after, "- [ ] #task One ^a1");
});

test("missing provider keeps the legacy direct write for counted priority", async () => {
  const content = ["- [ ] #task Alpha ^alpha", "- [ ] #task Beta ^beta"].join("\n");
  const editor = new TransactionEditor(content, { line: 0, ch: 5 });
  const app = makeApp({ editor, path: "Tasks.md" });
  const plugin = makeNav(app, editor, "Tasks.md");
  const session = helpers.discoverCountedObsidianTaskTargets(content, 0, 0);
  assert.equal(session.valid, true);

  const ok = await plugin.setCountedBulletPriorityValue(
    editor,
    { line: 0, ch: 5 },
    "Tasks.md",
    session,
    PRIORITY,
    PRIORITY.levels[0],
    { baseDate: BASE_DATE, random: () => 0, settleNav: true },
  );
  assert.equal(ok, true);
  assert.match(String(editor.getValue()), /\[priority:: high\]/);
  assert.match(String(editor.getValue()), /\[scheduled:: 2026-11-27\]/);
});

test("navResolveWrittenTaskLineText resolves by identity", () => {
  const resolve = helpers.navResolveWrittenTaskLineText;
  assert.equal(typeof resolve, "function");
  const settled = [
    "## Later",
    "",
    "- [ ] #task Beta ^beta",
    "- [ ] #task Alpha ^alpha",
  ].join("\n");
  assert.equal(resolve(settled, "- [ ] #task Alpha ^alpha"), "- [ ] #task Alpha ^alpha");
  // A surviving block ID wins over changed text: the settled line is returned.
  assert.equal(
    resolve("moved\n- [ ] #task Alpha ^alpha\n", "- [ ] #task Gone ^alpha"),
    "- [ ] #task Alpha ^alpha",
  );
  // A vanished identity falls back to the staged text.
  assert.equal(
    resolve("moved\n- [ ] #task Alpha ^alpha\n", "- [ ] #task Gone ^missing"),
    "- [ ] #task Gone ^missing",
  );
  const ambiguous = "- [ ] #task Same\n- [ ] #task Same";
  assert.equal(resolve(ambiguous, "- [ ] #task Same"), "- [ ] #task Same");
});
