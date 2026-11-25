const test = require("node:test");
const assert = require("node:assert/strict");
const {
  Plugin,
  helpers,
  resetNotices,
  localDate,
  createEditor,
  createTFile,
  createMarkdownView,
  createTaskModeHarness,
  sourceForPomodoroLink,
} = require("./block-id-prompt-harness.cjs");

const TODAY = localDate(2026, 7, 16);
const TODAY_TEXT = "2026-07-16";
const READY = "- [ ] #task Ship it ^ship";
const NEXT = "- [*] #task Ship it ^ship";

function activationPlan(content) {
  const plan = helpers.planTargetTaskUpdate(content, 0, {
    activationEligible: true,
    now: TODAY,
  });
  assert.ok(plan);
  assert.equal(plan.content, NEXT);
  return plan;
}

function installTaskSettle(plugin, methods) {
  plugin.app = plugin.app || {};
  plugin.app.plugins = plugin.app.plugins || { plugins: {} };
  const settle = {
    version: methods.version == null ? 1 : methods.version,
  };
  if (methods.settleNote) settle.settleNote = methods.settleNote;
  if (methods.applyToEditor) settle.applyToEditor = methods.applyToEditor;
  if (methods.flushPending) settle.flushPending = methods.flushPending;
  if (methods.schedulePending) settle.schedulePending = methods.schedulePending;
  plugin.app.plugins.plugins["bob-ledger-tools"] = { api: { taskSettle: settle } };
  return settle;
}

function replaceWhole(editor, next) {
  const current = editor.getValue();
  const lines = current.split("\n");
  const last = lines[lines.length - 1] || "";
  editor.replaceRange(next, { line: 0, ch: 0 }, { line: Math.max(lines.length - 1, 0), ch: last.length });
}

function makeClosedPlugin(content, path = "Tasks.md") {
  resetNotices();
  const file = createTFile(path);
  const writes = [];
  const plugin = new Plugin();
  plugin.now = () => TODAY;
  plugin.suppressEditorScans = () => {};
  plugin.app = {
    plugins: { plugins: {} },
    workspace: {
      getLeavesOfType: () => [],
      getActiveViewOfType: () => null,
      getActiveFile: () => null,
    },
    vault: {
      read: async (target) => (target.path === path ? content : null),
      modify: async (target, next) => {
        writes.push({ path: target.path, content: next });
      },
    },
  };
  const source = {
    sourcePath: "Daily.md",
    editor: createEditor("unrelated source"),
  };
  return { plugin, file, source, writes };
}

function makeOpenPlugin(content, { path = "Tasks.md", sameNote = false } = {}) {
  resetNotices();
  const file = createTFile(path);
  const editor = createEditor(content);
  const view = createMarkdownView(file);
  view.editor = editor;
  const writes = [];
  const plugin = new Plugin();
  plugin.now = () => TODAY;
  plugin.suppressEditorScans = () => {};
  plugin.app = {
    plugins: { plugins: {} },
    workspace: {
      getLeavesOfType: (type) => (type === "markdown" ? [{ view }] : []),
      getActiveViewOfType: () => view,
      getActiveFile: () => file,
    },
    vault: {
      read: async (target) => (target.path === path ? content : null),
      modify: async (target, next) => {
        writes.push({ path: target.path, content: next });
      },
    },
  };
  const source = sameNote
    ? { sourcePath: path, editor }
    : { sourcePath: "Daily.md", editor: createEditor("unrelated source") };
  return { plugin, file, source, editor, writes };
}

test("lookupTaskSettle accepts only taskSettle v1 and survives throws", () => {
  assert.equal(helpers.lookupTaskSettle(null), null);
  assert.equal(helpers.lookupTaskSettle({}), null);
  assert.equal(helpers.lookupTaskSettle({ plugins: { plugins: {} } }), null);

  const old = { plugins: { plugins: { "bob-ledger-tools": { api: { taskSettle: { version: 0 } } } } } };
  assert.equal(helpers.lookupTaskSettle(old), null);

  const v2 = { plugins: { plugins: { "bob-ledger-tools": { api: { taskSettle: { version: 2 } } } } } };
  assert.equal(helpers.lookupTaskSettle(v2), null);

  const live = { version: 1, settleNote() {} };
  const current = { plugins: { plugins: { "bob-ledger-tools": { api: { taskSettle: live } } } } };
  assert.equal(helpers.lookupTaskSettle(current), live);

  const viaGet = {
    plugins: {
      plugins: {},
      getPlugin: (id) => (id === "bob-ledger-tools" ? { api: { taskSettle: live } } : null),
    },
  };
  assert.equal(helpers.lookupTaskSettle(viaGet), live);

  const throwing = {
    plugins: {
      get plugins() {
        throw new Error("plugin map exploded");
      },
    },
  };
  assert.equal(helpers.lookupTaskSettle(throwing), null);
});

test("planTaskIdentityFromPlan uses the first edit replacement as text", () => {
  assert.equal(helpers.planTaskIdentityFromPlan(null), null);
  assert.equal(helpers.planTaskIdentityFromPlan({ edits: [] }), null);
  const plan = activationPlan(READY);
  assert.deepEqual(helpers.planTaskIdentityFromPlan(plan), { text: NEXT, blockId: "ship" });
});

test("closed target notes settle through vault.modify in the same write", async () => {
  const { plugin, file, source, writes } = makeClosedPlugin(READY);
  const settleCalls = [];
  const applyCalls = [];
  installTaskSettle(plugin, {
    settleNote(request) {
      settleCalls.push(request);
      return { contents: `${request.contents}\nSETTLED`, changed: true, lineMap: {}, warnings: [] };
    },
    applyToEditor(_editor, path, options) {
      applyCalls.push({ path, options });
      return { applied: true };
    },
  });

  const plan = activationPlan(READY);
  const ok = await plugin.applyTargetTaskPlan(file, source, plan, READY);
  assert.equal(ok, true);
  assert.equal(applyCalls.length, 0, "closed notes do not go through applyToEditor");
  assert.equal(settleCalls.length, 1);
  assert.equal(settleCalls[0].path, file.path);
  assert.equal(settleCalls[0].contents, NEXT);
  assert.equal(settleCalls[0].today, TODAY_TEXT);
  assert.deepEqual(writes, [{ path: file.path, content: `${NEXT}\nSETTLED` }]);
});

test("an open target editor settles through applyToEditor and skips vault.modify", async () => {
  const { plugin, file, source, editor, writes } = makeOpenPlugin(READY);
  const applyCalls = [];
  const settleCalls = [];
  installTaskSettle(plugin, {
    settleNote(request) {
      settleCalls.push(request);
      return { contents: request.contents };
    },
    applyToEditor(target, path, options) {
      applyCalls.push({ path, options });
      replaceWhole(target, `${options.contents}\nSETTLED`);
      return { applied: true };
    },
  });

  const plan = activationPlan(READY);
  const ok = await plugin.applyTargetTaskPlan(file, source, plan, READY);
  assert.equal(ok, true);
  assert.equal(settleCalls.length, 0, "open notes do not call settleNote");
  assert.equal(writes.length, 0, "open notes do not vault.modify");
  assert.equal(applyCalls.length, 1);
  assert.equal(applyCalls[0].path, file.path);
  assert.equal(applyCalls[0].options.expected, READY);
  assert.equal(applyCalls[0].options.contents, NEXT);
  assert.equal(applyCalls[0].options.today, TODAY_TEXT);
  assert.deepEqual(applyCalls[0].options.identity, { text: NEXT, blockId: "ship" });
  assert.equal(editor.getValue(), `${NEXT}\nSETTLED`);
});

test("same-note Pomodoro combined edits settle through applyToEditor", async () => {
  resetNotices();
  const content = [
    "- [?] #task Ship it [scheduled:: 2026-08-20] ^ship",
    "  - 🗓️ **SCHEDULE LOG**",
    "## Pomodoros",
    "- [ ] Current (10:00-10:25)",
  ].join("\n");
  const editor = createEditor(content);
  const source = sourceForPomodoroLink(editor, "Daily.md", 0);
  const plugin = new Plugin();
  plugin.now = () => localDate(2026, 8, 15);
  plugin.resolveTodayDailyFile = () => ({ path: "Daily.md" });
  plugin.resolveTaskFile = (path) => (path === "Daily.md" ? { path: "Daily.md" } : null);
  plugin.resolveReferenceDestination = (reference) =>
    reference.targetText === "" ? { path: "Daily.md" } : null;
  plugin.suppressEditorScans = () => {};
  plugin.app = { plugins: { plugins: {} }, vault: {} };
  const applyCalls = [];
  installTaskSettle(plugin, {
    applyToEditor(target, path, options) {
      applyCalls.push({ path, options });
      replaceWhole(target, `${options.contents}\nSETTLED`);
      return { applied: true };
    },
  });

  const result = await plugin.completePomodoroTaskLink(source, "ship");
  assert.equal(result, true);
  assert.equal(applyCalls.length, 1);
  assert.equal(applyCalls[0].path, "Daily.md");
  assert.equal(applyCalls[0].options.expected, content);
  assert.match(applyCalls[0].options.contents, /\[\*\] #task Ship it \^ship/);
  assert.match(applyCalls[0].options.contents, /\[\[#\^ship\]\]/);
  assert.equal(editor.getValue().endsWith("\nSETTLED"), true);
});

test("same-note source editor settles through applyToEditor", async () => {
  const { plugin, file, source, editor, writes } = makeOpenPlugin(READY, { sameNote: true });
  const applyCalls = [];
  installTaskSettle(plugin, {
    applyToEditor(target, path, options) {
      applyCalls.push({ path, editor: target, options });
      replaceWhole(target, `${options.contents}\nSETTLED`);
      return { applied: true };
    },
  });

  const plan = activationPlan(READY);
  const ok = await plugin.applyTargetTaskPlan(file, source, plan, READY);
  assert.equal(ok, true);
  assert.equal(writes.length, 0);
  assert.equal(applyCalls.length, 1);
  assert.equal(applyCalls[0].editor, source.editor);
  assert.equal(applyCalls[0].path, file.path);
  assert.equal(editor.getValue(), `${NEXT}\nSETTLED`);
});

test("missing, old, throwing, and unapplied providers keep the pre-settle gesture write", async () => {
  const plan = activationPlan(READY);

  const absent = makeClosedPlugin(READY);
  assert.equal(await absent.plugin.applyTargetTaskPlan(absent.file, absent.source, plan, READY), true);
  assert.deepEqual(absent.writes, [{ path: absent.file.path, content: NEXT }]);

  const old = makeClosedPlugin(READY);
  installTaskSettle(old.plugin, {
    version: 0,
    settleNote() {
      return { contents: "should-not-run" };
    },
  });
  assert.equal(await old.plugin.applyTargetTaskPlan(old.file, old.source, plan, READY), true);
  assert.deepEqual(old.writes, [{ path: old.file.path, content: NEXT }]);

  const throwing = makeClosedPlugin(READY);
  installTaskSettle(throwing.plugin, {
    settleNote() {
      throw new Error("provider skew");
    },
  });
  assert.equal(await throwing.plugin.applyTargetTaskPlan(throwing.file, throwing.source, plan, READY), true);
  assert.deepEqual(throwing.writes, [{ path: throwing.file.path, content: NEXT }]);

  const unapplied = makeOpenPlugin(READY);
  const fallbackEditor = unapplied.editor;
  installTaskSettle(unapplied.plugin, {
    applyToEditor() {
      return { applied: false, reason: "stale-preimage" };
    },
    settleNote() {
      return { contents: "should-not-run" };
    },
  });
  assert.equal(
    await unapplied.plugin.applyTargetTaskPlan(unapplied.file, unapplied.source, plan, READY),
    true,
  );
  assert.equal(unapplied.writes.length, 0);
  assert.equal(fallbackEditor.getValue(), NEXT, "discrete applyTaskPlanToEditor fallback");

  const throwingEditor = makeOpenPlugin(READY);
  installTaskSettle(throwingEditor.plugin, {
    applyToEditor() {
      throw new Error("apply exploded");
    },
  });
  assert.equal(
    await throwingEditor.plugin.applyTargetTaskPlan(
      throwingEditor.file,
      throwingEditor.source,
      plan,
      READY,
    ),
    true,
  );
  assert.equal(throwingEditor.editor.getValue(), NEXT);
});

test("applyTargetTaskPlan does not flush pending settle work", async () => {
  const { plugin, file, source, writes } = makeClosedPlugin(READY);
  let flushed = 0;
  installTaskSettle(plugin, {
    flushPending() {
      flushed += 1;
      return [];
    },
    settleNote({ contents }) {
      return { contents };
    },
  });
  const plan = activationPlan(READY);
  assert.equal(await plugin.applyTargetTaskPlan(file, source, plan, READY), true);
  assert.equal(flushed, 0);
  assert.equal(writes.length, 1);
});

test("Ctrl+Shift+Enter flushes pending settle before planning", async () => {
  const { plugin, editor, view } = createTaskModeHarness({
    taskContent: READY,
    dailyContent: "## Pomodoros\n- [ ] Current (10:00-10:25)",
  });
  let flushed = 0;
  installTaskSettle(plugin, {
    flushPending() {
      flushed += 1;
      return [{ path: "Tasks.md", generation: 1, result: {} }];
    },
  });
  plugin.blockIdReqRefuseAtEditor = () => true;
  await plugin.openPomodoroTaskLink(editor, view);
  assert.equal(flushed, 1);
});

test("submitBlockId flushes pending settle at command entry", async () => {
  const plugin = new Plugin();
  plugin.now = () => TODAY;
  plugin.app = { plugins: { plugins: {} }, vault: { read: async () => "" } };
  let flushed = 0;
  installTaskSettle(plugin, {
    flushPending() {
      flushed += 1;
      return [];
    },
  });
  const editor = createEditor("no marker here");
  await plugin.submitBlockId({
    kind: "linked",
    editor,
    line: 0,
    startCh: 0,
    endCh: 2,
    raw: "^^",
    sourcePath: "Daily.md",
    oldId: "ship",
  }, "ship");
  assert.equal(flushed, 1);
});

test("flushTaskSettlePending degrades when the provider is missing or throws", () => {
  const plugin = new Plugin();
  plugin.app = { plugins: { plugins: {} } };
  assert.deepEqual(plugin.flushTaskSettlePending(), []);

  installTaskSettle(plugin, {
    version: 1,
    flushPending() {
      throw new Error("flush exploded");
    },
  });
  assert.deepEqual(plugin.flushTaskSettlePending(), []);

  installTaskSettle(plugin, {
    flushPending() {
      return [{ path: "Tasks.md", generation: 4, result: { applied: true } }];
    },
  });
  assert.equal(plugin.flushTaskSettlePending()[0].generation, 4);
});
