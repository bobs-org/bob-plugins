// Pending task-settle scheduler and published API (bob-cli-q4.8.1.3).
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");
const { Cm6MappingEditor } = require("./cm6-mapping-editor.cjs");

class TestMarkdownView {}
class TestPlugin {
  constructor(app) { this.app = app; }
  addCommand(command) {
    this.commands = this.commands || [];
    this.commands.push(command);
    return command;
  }
  registerEvent(ref) {
    this.registeredEvents = this.registeredEvents || [];
    this.registeredEvents.push(ref);
  }
  registerEditorExtension(extension) {
    this.editorExtensions = this.editorExtensions || [];
    this.editorExtensions.push(extension);
  }
}

class TestEditorView {}
TestEditorView.updateListener = {
  of: (listener) => ({ kind: "updateListener", listener }),
};
TestEditorView.domEventHandlers = (handlers) => ({ kind: "domEventHandlers", handlers });

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
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value } };
  if (request === "@codemirror/view") {
    return { EditorView: TestEditorView, keymap: { of: (value) => value } };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers } = LedgerToolsPlugin;
Module._load = originalLoad;

const AREA = "Areas/home.md";
const OTHER = "Areas/other.md";
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

class FakeTimers {
  constructor() { this.timers = []; }
  setTimeout(callback, delay) {
    const timer = { callback, delay, cleared: false };
    this.timers.push(timer);
    return timer;
  }
  clearTimeout(timer) { timer.cleared = true; }
  last() { return this.timers[this.timers.length - 1]; }
  fire(timer, includeCleared = false) {
    if (timer && (!timer.cleared || includeCleared)) timer.callback();
  }
}

class TestEditor extends Cm6MappingEditor {
  constructor(text) { super(text, { line: 8, ch: 0 }); }
  getScrollInfo() { return { left: 0, top: 0, clientHeight: 400 }; }
}

function makeApp(editors) {
  const events = new Map();
  const leaves = editors.map(({ editor, path }) => {
    const view = new TestMarkdownView();
    view.editor = editor;
    view.file = { path };
    view.getViewType = () => "markdown";
    return { view };
  });
  const workspace = {
    iterateAllLeaves(visit) { leaves.forEach(visit); },
    getLeavesOfType(type) { return type === "markdown" ? leaves : []; },
    on(name, callback) {
      if (!events.has(name)) events.set(name, []);
      events.get(name).push(callback);
      return { name, callback };
    },
  };
  return {
    workspace,
    events,
    leaves,
    plugins: { plugins: {} },
    internalPlugins: { plugins: { "daily-notes": { instance: { options: {} } } } },
    vault: { getAbstractFileByPath: () => null },
    metadataCache: {},
  };
}

function makeScheduler(timers, apply) {
  return helpers.taskSettleCreatePendingScheduler({
    delayMs: 500,
    setTimeout: timers.setTimeout.bind(timers),
    clearTimeout: timers.clearTimeout.bind(timers),
    apply,
  });
}

function identity(blockId, line, text) { return { blockId, line, text }; }

test("rapid repeated task taps rearm 500 ms and stale generations cannot drain", () => {
  const timers = new FakeTimers();
  const editor = {};
  const applied = [];
  const scheduler = makeScheduler(timers, (entry) => applied.push(entry.identity.text));
  const first = scheduler.schedule(editor, AREA, identity("design", 8, "[ ] first"));
  const firstTimer = timers.last();
  const second = scheduler.schedule(editor, AREA, identity("design", 8, "[/] second"));
  const secondTimer = timers.last();
  const third = scheduler.schedule(editor, AREA, identity("design", 8, "[*] third"));
  const thirdTimer = timers.last();

  assert.equal(first.scheduled, true);
  assert.equal(second.reset, true);
  assert.equal(third.reset, true);
  assert.equal(firstTimer.delay, 500);
  assert.equal(secondTimer.cleared, true);
  assert.equal(thirdTimer.delay, 500);
  timers.fire(firstTimer, true);
  timers.fire(secondTimer, true);
  assert.deepEqual(applied, [], "stale timers do not apply or clear the current entry");
  timers.fire(thirdTimer);
  assert.deepEqual(applied, ["[*] third"], "the latest tap identity is applied once");
  assert.equal(scheduler.size, 0);

  const noIdEditor = {};
  scheduler.schedule(noIdEditor, AREA, identity(null, 8, "- [ ] #task First status"));
  const noIdFirst = timers.last();
  const noIdReset = scheduler.schedule(noIdEditor, AREA, identity(null, 8, "- [/] #task Updated status"));
  assert.equal(noIdReset.reset, true, "the line hint keeps a no-block-id task stable across status text changes");
  assert.equal(noIdFirst.cleared, true);
});

test("a different task flushes its predecessor before arming the replacement", () => {
  const timers = new FakeTimers();
  const editor = {};
  const applied = [];
  const scheduler = makeScheduler(timers, (entry) => applied.push(entry.identity.blockId));
  scheduler.schedule(editor, AREA, identity("a", 1, "A"));
  scheduler.schedule(editor, AREA, identity("b", 2, "B"));
  assert.deepEqual(applied, ["a"]);
  assert.equal(scheduler.size, 1);
  assert.equal(scheduler.peek(editor).identity.blockId, "b");
});

test("global flush drains different editors and a fired timer cannot repeat it", () => {
  const timers = new FakeTimers();
  const first = {};
  const second = {};
  const applied = [];
  const scheduler = makeScheduler(timers, (entry) => applied.push(entry.path));
  scheduler.schedule(first, AREA, identity("a", 1, "A"));
  const firstTimer = timers.last();
  scheduler.schedule(second, OTHER, identity("b", 2, "B"));
  const secondTimer = timers.last();
  const outcomes = scheduler.flushPending();
  assert.equal(outcomes.length, 2);
  assert.deepEqual(applied, [AREA, OTHER]);
  assert.equal(firstTimer.cleared, true);
  assert.equal(secondTimer.cleared, true);
  timers.fire(firstTimer, true);
  timers.fire(secondTimer, true);
  assert.deepEqual(applied, [AREA, OTHER]);
  assert.equal(scheduler.size, 0);
});

test("divergent views of one path are dropped instead of racing writes", () => {
  const timers = new FakeTimers();
  const first = {};
  const second = {};
  const applied = [];
  const scheduler = makeScheduler(timers, (entry) => applied.push(entry.editor));
  scheduler.schedule(first, AREA, identity("a", 1, "A"));
  const oldTimer = timers.last();
  const refused = scheduler.schedule(second, AREA, identity("b", 2, "B"));
  assert.equal(refused.scheduled, false);
  assert.equal(refused.reason, "shared-path");
  assert.equal(scheduler.size, 0);
  timers.fire(oldTimer, true);
  assert.deepEqual(applied, [], "neither view can overwrite the shared note");
});

test("reentrant schedules survive a drain and apply exceptions are contained", () => {
  const timers = new FakeTimers();
  const editor = {};
  const applied = [];
  let scheduler;
  scheduler = makeScheduler(timers, (entry) => {
    applied.push(entry.identity.blockId);
    if (entry.identity.blockId === "first") {
      scheduler.schedule(editor, AREA, identity("second", 2, "second"));
    }
  });
  scheduler.schedule(editor, AREA, identity("first", 1, "first"));
  scheduler.flushPending();
  assert.deepEqual(applied, ["first"]);
  assert.equal(scheduler.size, 1, "work scheduled reentrantly is a new generation");
  scheduler.flushPending();
  assert.deepEqual(applied, ["first", "second"]);

  const broken = makeScheduler(timers, () => { throw new Error("boom"); });
  broken.schedule({}, OTHER, identity("broken", 0, "broken"));
  const result = broken.flushPending();
  assert.equal(result[0].result.reason, "error");
  assert.equal(broken.size, 0);
});

test("published taskSettle API is frozen, versioned, and found at the runtime path", () => {
  const editor = new TestEditor(AREA_INPUT);
  const app = makeApp([{ editor, path: AREA }]);
  const plugin = new LedgerToolsPlugin(app);
  const namespace = plugin.taskSettleApi();
  for (const method of ["settleNote", "applyToEditor", "schedulePending", "flushPending"]) {
    assert.equal(typeof namespace[method], "function", method);
  }
  assert.equal(namespace.version, 1);
  assert.equal(Object.isFrozen(namespace), true);
  plugin.api = Object.freeze({ version: 3, taskSettle: namespace });
  app.plugins.plugins["bob-ledger-tools"] = plugin;
  assert.equal(
    app.plugins.plugins["bob-ledger-tools"]?.api?.taskSettle,
    namespace,
    "consumers resolve the published namespace at the documented path",
  );
});

test("call-time feature detection safely handles absent, old, and throwing providers", () => {
  const app = { plugins: { plugins: {} } };
  let existingWrites = 0;
  function applyWithOptionalSettle(method, args, existingGestureWrite) {
    // Keep this lookup and version/method check at the call site; plugins can
    // reload or change while an editor command is running.
    const provider = app.plugins.plugins["bob-ledger-tools"]?.api?.taskSettle;
    if (provider?.version === 1 && typeof provider[method] === "function") {
      try {
        const result = provider[method](...args);
        if (result && result.applied) return result;
      } catch (_error) {
        // A provider skew or exception leaves the consumer's gesture write intact.
      }
    }
    return existingGestureWrite();
  }

  const write = () => { existingWrites += 1; return "gesture-write"; };
  assert.equal(applyWithOptionalSettle("applyToEditor", [], write), "gesture-write", "absent plugin falls back");
  app.plugins.plugins["bob-ledger-tools"] = { api: { taskSettle: { version: 0, applyToEditor() {} } } };
  assert.equal(applyWithOptionalSettle("applyToEditor", [], write), "gesture-write", "old provider falls back");
  app.plugins.plugins["bob-ledger-tools"].api.taskSettle = {
    version: 1,
    applyToEditor() { throw new Error("provider error"); },
  };
  assert.equal(applyWithOptionalSettle("applyToEditor", [], write), "gesture-write", "throwing provider falls back");
  assert.equal(existingWrites, 3, "provider failures preserve one ordinary gesture write each");
  app.plugins.plugins["bob-ledger-tools"].api.taskSettle = {
    version: 1,
    applyToEditor: (value) => ({ applied: true, value }),
  };
  assert.deepEqual(
    applyWithOptionalSettle("applyToEditor", ["live"], write),
    { applied: true, value: "live" },
    "the current provider is re-read at the next call",
  );
  assert.equal(existingWrites, 3, "a successful provider replaces the fallback write");
});

test("pending flush applies the current live editor and drops a buffer after it switches paths", () => {
  const timers = new FakeTimers();
  const editor = new TestEditor(AREA_INPUT);
  const app = makeApp([{ editor, path: AREA }]);
  const plugin = new LedgerToolsPlugin(app);
  plugin.taskSettlePendingScheduler = makeScheduler(timers, (entry) => plugin.taskSettleApplyPending(entry));
  const namespace = plugin.taskSettleApi();
  const taskIdentity = identity("design", 8, "- [/] #task Finish the design ^design");
  const scheduled = namespace.schedulePending({ editor, path: AREA, identity: taskIdentity });
  assert.equal(scheduled.scheduled, true);
  const timer = timers.last();
  const flushed = namespace.flushPending();
  assert.equal(flushed[0].result.applied, true);
  assert.notEqual(editor.getValue(), AREA_INPUT);
  const settled = editor.getValue();
  timers.fire(timer, true);
  assert.equal(editor.getValue(), settled, "an explicit flush makes its old timer inert");

  const switched = new TestEditor(AREA_INPUT);
  const switchedApp = makeApp([{ editor: switched, path: AREA }]);
  const switchedPlugin = new LedgerToolsPlugin(switchedApp);
  const switchedTimers = new FakeTimers();
  switchedPlugin.taskSettlePendingScheduler = makeScheduler(
    switchedTimers,
    (entry) => switchedPlugin.taskSettleApplyPending(entry),
  );
  switchedPlugin.taskSettleApi().schedulePending({
    editor: switched,
    path: AREA,
    identity: taskIdentity,
  });
  const switchedTimer = switchedTimers.last();
  switchedApp.leaves[0].view.file.path = OTHER;
  switchedTimers.fire(switchedTimer);
  assert.equal(switched.getValue(), AREA_INPUT);
  assert.equal(switched.transactions.length, 0, "the switched-to note receives no stale write");
});

test("deleted-task timer and explicit flush produce no writes", () => {
  const timers = new FakeTimers();
  const editor = new TestEditor(AREA_INPUT);
  const app = makeApp([{ editor, path: AREA }]);
  const plugin = new LedgerToolsPlugin(app);
  plugin.taskSettlePendingScheduler = makeScheduler(timers, (entry) => plugin.taskSettleApplyPending(entry));
  const outcome = plugin.taskSettleApplyPending({
    editor,
    path: AREA,
    identity: { blockId: "deleted", line: 8 },
  });
  assert.equal(outcome.applied, false);
  assert.equal(outcome.reason, "identity");
  assert.equal(editor.transactions.length, 0);
  assert.equal(editor.getValue(), AREA_INPUT);

  plugin.taskSettleApi().schedulePending({
    editor,
    path: AREA,
    identity: { blockId: "deleted", line: 8 },
  });
  timers.fire(timers.last());
  assert.equal(editor.transactions.length, 0, "a deleted-task timer flush does not write");

  plugin.taskSettleApi().schedulePending({
    editor,
    path: AREA,
    identity: { blockId: "deleted", line: 8 },
  });
  const flushed = plugin.taskSettleFlushPending();
  assert.equal(flushed.length, 1);
  assert.equal(flushed[0].result.applied, false);
  assert.equal(flushed[0].result.reason, "identity");
  assert.equal(editor.transactions.length, 0, "an explicit deleted-task flush does not write");
});

test("pending work drops when the live task identity disappears or becomes ambiguous", () => {
  const timers = new FakeTimers();
  const editor = new TestEditor(AREA_INPUT);
  const app = makeApp([{ editor, path: AREA }]);
  const plugin = new LedgerToolsPlugin(app);
  plugin.taskSettlePendingScheduler = makeScheduler(timers, (entry) => plugin.taskSettleApplyPending(entry));
  plugin.taskSettleApi().schedulePending({
    editor,
    path: AREA,
    identity: identity("design", 8, "- [/] #task Finish the design ^design"),
  });
  editor.content = AREA_INPUT.replace("^design", "^removed");
  timers.fire(timers.last());
  assert.equal(editor.transactions.length, 0, "a deleted task does not receive a later write");

  const ambiguous = new TestEditor(AREA_INPUT);
  const ambiguousApp = makeApp([{ editor: ambiguous, path: AREA }]);
  const ambiguousPlugin = new LedgerToolsPlugin(ambiguousApp);
  const ambiguousTimers = new FakeTimers();
  ambiguousPlugin.taskSettlePendingScheduler = makeScheduler(
    ambiguousTimers,
    (entry) => ambiguousPlugin.taskSettleApplyPending(entry),
  );
  ambiguousPlugin.taskSettleApi().schedulePending({
    editor: ambiguous,
    path: AREA,
    identity: identity(null, 8, "- [/] #task Finish the design ^design"),
  });
  ambiguous.content = AREA_INPUT.replace("## Tasks\n", "## Tasks\n\n").replace(
    "- [/] #task Finish the design ^design",
    "- [/] #task Finish the design ^design\n- [/] #task Finish the design ^design",
  );
  ambiguousTimers.fire(ambiguousTimers.last());
  assert.equal(ambiguous.transactions.length, 0, "an ambiguous exact-text fallback is dropped");
});

test("pending history joins only when the buffer matches the latest schedule snapshot", () => {
  const editor = new TestEditor(AREA_INPUT);
  const app = makeApp([{ editor, path: AREA }]);
  const plugin = new LedgerToolsPlugin(app);
  const timers = new FakeTimers();
  const joinHistory = [];
  plugin.taskSettleApplyToEditor = (_editor, _path, options) => {
    joinHistory.push(options.joinHistory);
    return { applied: true, changed: true };
  };
  plugin.taskSettlePendingScheduler = makeScheduler(
    timers,
    (entry) => plugin.taskSettleApplyPending(entry),
  );
  plugin.taskSettleApi().schedulePending({
    editor,
    path: AREA,
    identity: identity("design", 8, "- [/] #task Finish the design ^design"),
  });
  const timer = timers.last();
  editor.content += "An unrelated edit\n";
  timers.fire(timer);
  assert.deepEqual(joinHistory, [false], "later edits are never grouped into the gesture event");

  const unchanged = new TestEditor(AREA_INPUT);
  const unchangedApp = makeApp([{ editor: unchanged, path: AREA }]);
  const unchangedPlugin = new LedgerToolsPlugin(unchangedApp);
  const unchangedTimers = new FakeTimers();
  const unchangedJoin = [];
  unchangedPlugin.taskSettleApplyToEditor = (_editor, _path, options) => {
    unchangedJoin.push(options.joinHistory);
    return { applied: true, changed: true };
  };
  unchangedPlugin.taskSettlePendingScheduler = makeScheduler(
    unchangedTimers,
    (entry) => unchangedPlugin.taskSettleApplyPending(entry),
  );
  unchangedPlugin.taskSettleApi().schedulePending({
    editor: unchanged,
    path: AREA,
    identity: identity("design", 8, "- [/] #task Finish the design ^design"),
  });
  unchangedTimers.fire(unchangedTimers.last());
  assert.deepEqual(unchangedJoin, [true], "an unchanged post-gesture buffer may join its history event");
});

test("cursor leave, blur, active-leaf, and file-open flushes use registered lifecycle hooks", () => {
  const editor = new TestEditor(AREA_INPUT);
  let currentLine = 9;
  const cmView = {
    state: {
      selection: { main: { head: 0 } },
      doc: { lineAt: () => ({ number: currentLine }) },
    },
  };
  editor.cm = cmView;
  const app = makeApp([{ editor, path: AREA }]);
  const plugin = new LedgerToolsPlugin(app);
  const timers = new FakeTimers();
  const applied = [];
  plugin.taskSettlePendingScheduler = makeScheduler(timers, (entry) => applied.push(entry.path));
  plugin.taskSettleInstallPendingLifecycle();
  const updateExtension = plugin.editorExtensions.find((entry) => entry.kind === "updateListener");
  const blurExtension = plugin.editorExtensions.find((entry) => entry.kind === "domEventHandlers");
  assert.ok(updateExtension);
  assert.ok(blurExtension);
  assert.deepEqual([...app.events.keys()].sort(), ["active-leaf-change", "file-open"]);

  plugin.taskSettleSchedulePending({
    editor,
    path: AREA,
    identity: identity("design", 8, "- [/] #task Finish the design ^design"),
  });
  updateExtension.listener({ selectionSet: true, view: cmView });
  assert.equal(plugin.taskSettlePendingScheduler.size, 1, "cursor on the task keeps the timer armed");
  currentLine = 5;
  updateExtension.listener({ selectionSet: true, view: cmView });
  assert.deepEqual(applied, [AREA], "leaving the identity line flushes that editor");

  plugin.taskSettleSchedulePending({
    editor,
    path: AREA,
    identity: identity("design", 8, "- [/] #task Finish the design ^design"),
  });
  blurExtension.handlers.blur({}, cmView);
  assert.deepEqual(applied, [AREA, AREA], "blur flushes the editor's pending work");

  const second = {};
  plugin.taskSettleSchedulePending({ editor: second, path: OTHER, identity: identity("other", 0, "other") });
  for (const listener of app.events.get("active-leaf-change")) listener();
  assert.deepEqual(applied, [AREA, AREA, OTHER], "active-leaf change flushes across editors");
  plugin.taskSettleSchedulePending({ editor: second, path: OTHER, identity: identity("other", 0, "other") });
  for (const listener of app.events.get("file-open")) listener();
  assert.deepEqual(applied, [AREA, AREA, OTHER, OTHER], "file-open flushes across editors");

  const pendingTimer = timers.last();
  plugin.taskSettleSchedulePending({ editor: second, path: OTHER, identity: identity("other", 0, "other") });
  plugin.taskSettleDisposePendingLifecycle();
  assert.equal(plugin.taskSettlePendingScheduler, null);
  assert.equal(pendingTimer.cleared, true, "unload cancels all timers");
  timers.fire(pendingTimer, true);
  assert.equal(applied.length, 4, "unload makes stale timer callbacks inert");
});

test("ledger-tools command wrappers flush only when a command executes", () => {
  const app = makeApp([]);
  const plugin = new LedgerToolsPlugin(app);
  plugin.manifest = { id: "bob-ledger-tools" };
  let flushes = 0;
  let callbacks = 0;
  plugin.taskSettleFlushPending = () => { flushes += 1; };
  const command = {
    id: "bob-ledger-tools:test",
    callback() { callbacks += 1; },
    checkCallback(checking) { if (!checking) callbacks += 1; return true; },
  };
  app.commands = { commands: new Map([[command.id, command]]) };
  assert.equal(plugin.taskSettleWrapRegisteredCommands(), 1);
  assert.equal(plugin.taskSettleWrapRegisteredCommands(), 0, "a command is wrapped only once");
  command.checkCallback(true);
  assert.equal(flushes, 0, "availability checks do not drain pending work");
  command.callback();
  command.checkCallback(false);
  assert.equal(flushes, 2);
  assert.equal(callbacks, 2);
  plugin.taskSettleDisposePendingLifecycle();
});
