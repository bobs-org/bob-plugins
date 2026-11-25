// Cycler taskSettle adapter (bob-cli-q4.9.1.1 settle-bridge).
// Call-time lookup, guarded apply, pending observer jumps, write policy,
// and stay-cursor recordJump order. No production gesture starts settling here.
const assert = require("node:assert/strict");
const test = require("node:test");
const { Cm6MappingEditor } = require("./cm6-mapping-editor.cjs");
const {
  TaskStatusCyclerPlugin,
  MarkdownView,
  helpers,
} = require("./task-status-cycler-harness.cjs");
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");

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
  constructor(text, cursor = { line: 8, ch: 6 }) {
    super(text, cursor);
  }
  getScrollInfo() { return { left: 0, top: 0, clientHeight: 400 }; }
}

function makeApp(editors) {
  const events = new Map();
  const leaves = editors.map(({ editor, path }) => {
    const view = new MarkdownView();
    view.editor = editor;
    view.file = { path };
    view.getViewType = () => "markdown";
    return { view };
  });
  const workspace = {
    iterateAllLeaves(visit) { leaves.forEach(visit); },
    getLeavesOfType(type) { return type === "markdown" ? leaves : []; },
    getActiveViewOfType() { return leaves[0] ? leaves[0].view : null; },
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
  return LedgerToolsPlugin.helpers.taskSettleCreatePendingScheduler({
    delayMs: 500,
    setTimeout: timers.setTimeout.bind(timers),
    clearTimeout: timers.clearTimeout.bind(timers),
    apply,
  });
}

function identity(blockId, line, text) {
  return { blockId, line, text };
}

function attachNavJumps(app, jumps) {
  app.plugins.plugins["bob-navigation-hotkeys"] = {
    api: {
      recordJump(from, to) {
        jumps.push({ from, to });
        return true;
      },
    },
  };
}

function makeCycler(app) {
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = app;
  return plugin;
}

function makeLivePair(options = {}) {
  const editor = new TestEditor(options.text || AREA_INPUT, options.cursor || { line: 8, ch: 6 });
  const app = makeApp([{ editor, path: options.path || AREA }]);
  const timers = new FakeTimers();
  const ledger = new LedgerToolsPlugin(app);
  ledger.app = app;
  ledger.taskSettlePendingScheduler = makeScheduler(
    timers,
    (entry) => ledger.taskSettleApplyPending(entry),
  );
  app.plugins.plugins["bob-ledger-tools"] = {
    api: Object.freeze({ version: 3, taskSettle: ledger.taskSettleApi() }),
  };
  const jumps = [];
  attachNavJumps(app, jumps);
  return { editor, app, timers, ledger, cycler: makeCycler(app), jumps };
}

test("write policy and identity snapshots stay explicit", () => {
  assert.deepEqual(helpers.TASK_SETTLE_WRITE_POLICY, {
    immediate: "immediate",
    deferred: "deferred",
    none: "none",
  });
  const plugin = makeCycler({ plugins: { plugins: {} } });
  assert.equal(plugin.taskSettleWritePolicy("immediate"), "immediate");
  assert.equal(plugin.taskSettleWritePolicy("deferred"), "deferred");
  assert.equal(plugin.taskSettleWritePolicy("none"), "none");
  assert.equal(plugin.taskSettleWritePolicy("other"), "none");
  const snap = plugin.snapshotTaskSettleIdentity(
    "- [/] #task Finish the design ^design",
    8,
  );
  assert.equal(snap.blockId, "design");
  assert.equal(snap.line, 8);
  assert.match(snap.text, /Finish the design/);
});

test("missing, old, and throwing providers leave the existing write in place", () => {
  const plugin = makeCycler({ plugins: { plugins: {} } });
  assert.equal(plugin.resolveTaskSettleApi(), null);
  assert.equal(plugin.applyTaskSettleToEditor({}, AREA).reason, "missing");
  assert.equal(plugin.schedulePendingTaskSettle({}).reason, "missing");
  assert.deepEqual(plugin.flushPendingTaskSettle(), []);
  assert.equal(plugin.settleTargetContents(AREA, "x").reason, "missing");

  plugin.app.plugins.plugins["bob-ledger-tools"] = {
    api: { taskSettle: { version: 0, applyToEditor() { return { applied: true }; } } },
  };
  assert.equal(plugin.applyTaskSettleToEditor({}, AREA).reason, "missing");

  plugin.app.plugins.plugins["bob-ledger-tools"].api.taskSettle = {
    version: 1,
    applyToEditor() { throw new Error("provider error"); },
    schedulePending() { throw new Error("provider error"); },
    settleNote() { throw new Error("provider error"); },
    flushPending() { throw new Error("provider error"); },
  };
  assert.equal(plugin.applyTaskSettleToEditor({}, AREA).reason, "error");
  assert.equal(plugin.schedulePendingTaskSettle({ editor: {} }).reason, "error");
  assert.equal(plugin.settleTargetContents(AREA, "x").reason, "error");
  assert.deepEqual(plugin.flushPendingTaskSettle(), []);
});

test("real provider immediate settle records Ctrl+O to the moved task exactly once", () => {
  const { editor, cycler, jumps } = makeLivePair();
  const result = cycler.applyTaskSettleToEditor(editor, AREA, {
    identity: identity("design", 8, "- [/] #task Finish the design ^design"),
  });
  assert.equal(result.applied, true);
  assert.equal(result.cursor.line, 8, "stay keeps the physical line");
  assert.ok(result.jumpTarget);
  assert.ok(result.jumpTarget.line > 8, "the task moved away from the stay line");
  assert.equal(jumps.length, 1);
  assert.equal(jumps[0].from.line, result.jumpTarget.line, "Ctrl+O origin is the moved task");
  assert.equal(jumps[0].from.path, AREA);
  assert.equal(jumps[0].to.line, result.cursor.line, "jump destination is the stay cursor");
  assert.equal(jumps[0].to.path, AREA);
  cycler.recordTaskSettleResultJump(AREA, null, result, { editor, path: AREA });
  assert.equal(jumps.length, 1, "the shared recorder does not write the same jump twice");
});

test("pending callback and flush share one jump on the real provider", () => {
  const { editor, cycler, timers, jumps } = makeLivePair();
  const scheduled = cycler.schedulePendingTaskSettle({
    editor,
    path: AREA,
    identity: identity("design", 8, "- [/] #task Finish the design ^design"),
  });
  assert.equal(scheduled.scheduled, true);
  const timer = timers.last();
  const flushed = cycler.flushPendingTaskSettle({ editor });
  assert.equal(flushed[0].result.applied, true);
  assert.equal(jumps.length, 1, "callback plus returned flush array record once");
  assert.equal(jumps[0].from.line, flushed[0].result.jumpTarget.line);
  assert.equal(jumps[0].to.line, flushed[0].result.cursor.line);
  timers.fire(timer, true);
  assert.equal(jumps.length, 1, "a stale timer cannot record a second jump");
});

test("timer-driven onSettled records the stay jump once through the real provider", () => {
  const { editor, cycler, timers, jumps } = makeLivePair();
  cycler.schedulePendingTaskSettle({
    editor,
    path: AREA,
    identity: identity("design", 8, "- [/] #task Finish the design ^design"),
  });
  timers.fire(timers.last());
  assert.equal(jumps.length, 1);
  assert.ok(jumps[0].from.line > jumps[0].to.line);
});

test("older v1 providers that ignore onSettled still record from flush results", () => {
  const editor = new TestEditor(AREA_INPUT);
  const app = makeApp([{ editor, path: AREA }]);
  const jumps = [];
  attachNavJumps(app, jumps);
  let pending = null;
  const jumpTarget = { path: AREA, line: 14, ch: 6, blockId: "design", text: "moved" };
  const cursor = { line: 8, ch: 6 };
  app.plugins.plugins["bob-ledger-tools"] = {
    api: {
      taskSettle: {
        version: 1,
        applyToEditor() {
          return { applied: true, changed: true, jumpTarget, cursor };
        },
        settleNote: (request) => ({ contents: request.contents, changed: false, lineMap: {} }),
        schedulePending(request) {
          pending = { editor: request.editor, path: request.path, generation: 7 };
          return { scheduled: true, generation: 7 };
        },
        flushPending() {
          return [{
            path: pending.path,
            generation: pending.generation,
            result: { applied: true, changed: true, jumpTarget, cursor },
          }];
        },
      },
    },
  };
  const cycler = makeCycler(app);
  const scheduled = cycler.schedulePendingTaskSettle({
    editor,
    path: AREA,
    identity: identity("design", 8, "- [/] #task Finish the design ^design"),
  });
  assert.equal(scheduled.scheduled, true);
  cycler.flushPendingTaskSettle({ editor });
  assert.equal(jumps.length, 1, "updated cycler records jumps when ledger-tools omits onSettled");
  assert.equal(jumps[0].from.line, 14);
  assert.equal(jumps[0].to.line, 8);
});

test("stale preimage, invalid identity, and note switch refuse without recording a jump", () => {
  const { editor, cycler, jumps, app, timers } = makeLivePair();
  const refused = cycler.applyTaskSettleToEditor(editor, AREA, {
    expected: "not the live buffer",
    contents: AREA_INPUT.replace("[/]", "[x]"),
    identity: identity("design", 8, "- [/] #task Finish the design ^design"),
  });
  assert.equal(refused.applied, false);
  assert.equal(refused.reason, "preimage");
  assert.equal(editor.getValue(), AREA_INPUT);
  assert.equal(jumps.length, 0);

  cycler.schedulePendingTaskSettle({
    editor,
    path: AREA,
    identity: identity("deleted", 8, "- [/] gone"),
  });
  timers.fire(timers.last());
  assert.equal(jumps.length, 0);
  assert.equal(editor.transactions.length, 0);

  cycler.schedulePendingTaskSettle({
    editor,
    path: AREA,
    identity: identity("design", 8, "- [/] #task Finish the design ^design"),
  });
  app.leaves[0].view.file.path = OTHER;
  timers.fire(timers.last());
  assert.equal(jumps.length, 0, "a late result does not record a jump for a newer note");
  assert.equal(editor.getValue(), AREA_INPUT);
});

test("a throwing consumer observer does not replay the write or steal a second jump", () => {
  const { editor, cycler, jumps, timers } = makeLivePair();
  let observed = 0;
  cycler.schedulePendingTaskSettle({
    editor,
    path: AREA,
    identity: identity("design", 8, "- [/] #task Finish the design ^design"),
    onSettled() {
      observed += 1;
      throw new Error("consumer boom");
    },
  });
  const flushed = cycler.flushPendingTaskSettle({ editor });
  assert.equal(flushed[0].result.applied, true);
  assert.equal(observed, 1);
  assert.equal(jumps.length, 1);
  assert.notEqual(editor.getValue(), AREA_INPUT);
});

test("pure target-buffer settle uses the real provider without touching the editor", () => {
  const { editor, cycler } = makeLivePair();
  const before = editor.getValue();
  const settled = cycler.settleTargetContents(AREA, AREA_INPUT);
  assert.equal(settled.changed, true);
  assert.match(settled.contents, /### Next & In Progress/);
  assert.equal(editor.getValue(), before);
  assert.equal(editor.transactions.length, 0);
});
