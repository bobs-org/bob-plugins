// Structure-settle integration (bob-cli-q4.9.1.3).
// Promote/demote plans compose with settle in one staged transaction;
// nonempty o/O scaffolds settle on flush; empty-abandon stays byte-identical.
const assert = require("node:assert/strict");
const test = require("node:test");
const { Cm6MappingEditor } = require("./cm6-mapping-editor.cjs");
const {
  TaskStatusCyclerPlugin,
  helpers,
  createInMemoryObsidianApp,
  attachActiveMarkdownView,
  findPromptHeading,
  acceptPickerDestination,
  acceptSelectedPickerRow,
} = require("./task-status-cycler-harness.cjs");
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");

const AREA = "Areas/home.md";
const DATE = "2026-11-25";

function areaSource(extra = "") {
  const head = ["---", "type: [[area]]", "---", ""];
  const body = [
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
  ];
  return extra
    ? head.concat(extra.split("\n"), body).join("\n")
    : head.concat(body).join("\n");
}

function attachRealTaskSettle(harness) {
  const ledger = new LedgerToolsPlugin(harness.app);
  ledger.app = harness.app;
  const holder = harness.app.plugins.plugins["bob-ledger-tools"];
  holder.api.taskSettle = ledger.taskSettleApi();
  return ledger;
}

function attachViewLeaves(harness, view) {
  const leaves = [{ view }];
  harness.app.workspace.iterateAllLeaves = (visit) => {
    leaves.forEach((leaf) => visit(leaf));
  };
  harness.app.workspace.getLeavesOfType = (type) =>
    type === "markdown" ? leaves.slice() : [];
  return leaves;
}

function attachNavJumps(harness) {
  const jumps = [];
  harness.app.plugins.plugins["bob-navigation-hotkeys"] = {
    api: {
      recordJump(from, to) {
        jumps.push({ from, to });
        return true;
      },
    },
  };
  return jumps;
}

function makeEditor(source, cursor) {
  const editor = new Cm6MappingEditor(source, cursor);
  editor.replaceRange = (replacement, from, to = from) => {
    editor.transaction({
      changes: [{ from, to, text: replacement }],
    });
  };
  const listeners = {};
  editor.on = (name, fn) => {
    (listeners[name] || (listeners[name] = [])).push(fn);
  };
  editor.off = (name, fn) => {
    listeners[name] = (listeners[name] || []).filter((item) => item !== fn);
  };
  editor.emit = (name, args) => {
    for (const fn of listeners[name] || []) fn(args);
  };
  return editor;
}

function makeHarness(source, cursor, path = AREA, { settle = true } = {}) {
  const harness = createInMemoryObsidianApp({ [path]: source });
  const editor = makeEditor(source, cursor);
  const plugin = new TaskStatusCyclerPlugin();
  plugin.getCreatedDateString = () => DATE;
  plugin.enterVimInsertMode = () => {};
  const attached = attachActiveMarkdownView(plugin, harness, editor, path);
  attachViewLeaves(harness, attached.view);
  if (settle) attachRealTaskSettle(harness);
  const jumps = attachNavJumps(harness);
  const centered = [];
  plugin.centerEditorLineInView = (activeEditor, line, ch) => {
    centered.push({ line, ch, sameEditor: activeEditor === editor });
    return true;
  };
  return {
    harness,
    editor,
    plugin,
    view: attached.view,
    jumps,
    centered,
    path,
  };
}

function assertSettled(plugin, path, contents) {
  const again = plugin.settleTargetContents(path, contents);
  assert.equal(again.changed, false, "a second pure settle is a no-op");
}

test("in-place replace composes conversion with settle in one undo", () => {
  const source = [
    "---",
    "type: [[area]]",
    "---",
    "## Tasks",
    "",
    "- parent",
    "\t- [ ] #task Nested ^nest",
    "- [ ] #task Other ^other",
  ].join("\n");
  const ctx = makeHarness(source, { line: 6, ch: 6 });
  const plan = ctx.plugin.getActiveObsidianTaskToggle(ctx.editor);
  assert.equal(plan.mode, "replace");
  const undoBefore = ctx.editor.undoGroups;
  assert.equal(ctx.plugin.toggleActiveObsidianTask(ctx.editor, plan, ctx.view), true);
  const after = ctx.editor.getValue();
  assert.match(after, /\t- Nested \^nest/);
  assert.match(after, /- \[ \] #task Other \^other/);
  assertSettled(ctx.plugin, AREA, after);
  assert.equal(ctx.editor.undoGroups, undoBefore + 1);
  assert.equal(ctx.centered.length, 0, "settle mapping is not overwritten by center");
});

test("counted replaceLines settles once without regrouping between items", () => {
  const source = [
    "---",
    "type: [[area]]",
    "---",
    "## Notes",
    "",
    "- [ ] #task Alpha",
    "- [ ] #task Beta",
    "- [ ] #task Gamma",
  ].join("\n");
  const ctx = makeHarness(source, { line: 5, ch: 4 });
  let settleCalls = 0;
  const inner = ctx.plugin.applyTaskSettleToEditor.bind(ctx.plugin);
  ctx.plugin.applyTaskSettleToEditor = (...args) => {
    settleCalls += 1;
    return inner(...args);
  };
  const plan = ctx.plugin.getActiveObsidianTaskToggle(ctx.editor, 1);
  assert.equal(plan.mode, "replaceLines");
  assert.equal(ctx.plugin.toggleActiveObsidianTask(ctx.editor, plan, ctx.view), true);
  assert.equal(settleCalls, 1);
  const after = ctx.editor.getValue();
  assert.match(after, /^- Alpha/m);
  assert.match(after, /^- Beta/m);
  assert.match(after, /^- \[ \] #task Gamma/m);
  assertSettled(ctx.plugin, AREA, after);
  assert.equal(ctx.editor.undoGroups, 1);
});

test("promotion to Tasks settles the moved block and records the stay jump", () => {
  const source = areaSource("## Ideas\n\n- Ship it\n\t- child\n");
  const shipLine = source.split("\n").findIndex((line) => line === "- Ship it");
  const ctx = makeHarness(source, { line: shipLine, ch: 2 });
  assert.equal(
    ctx.plugin.toggleActiveObsidianTask(
      ctx.editor,
      ctx.plugin.getActiveObsidianTaskToggle(ctx.editor),
      ctx.view,
    ),
    true,
  );
  const prompt = ctx.plugin.demotionSectionPicker.snapshot.plan;
  assert.equal(prompt.promptKind, "promotion");
  const tasks = {
    kind: "existing",
    heading: findPromptHeading(prompt, "Tasks"),
  };
  const undoBefore = ctx.editor.undoGroups;
  assert.equal(acceptPickerDestination(ctx.plugin, tasks), true);
  const after = ctx.editor.getValue();
  assert.match(after, /#task Ship it/);
  assert.match(after, /\t- child/);
  assert.match(after, /### /);
  assert.equal(after.includes("## Ideas"), false);
  assertSettled(ctx.plugin, AREA, after);
  assert.equal(ctx.editor.undoGroups, undoBefore + 1);
  assert.equal(ctx.jumps.length, 1);
  assert.equal(ctx.jumps[0].from.path, AREA);
  assert.equal(ctx.centered.length, 0);
});

test("demotion picker submission settles children with the moved task", () => {
  const source = [
    "---",
    "type: [[area]]",
    "---",
    "## Tasks",
    "",
    "- [ ] #task Alpha",
    "\t- child note",
    "- [/] #task Beta",
    "",
    "## Notes",
    "",
    "- already there",
  ].join("\n");
  const ctx = makeHarness(source, { line: 5, ch: 4 });
  assert.equal(
    ctx.plugin.toggleActiveObsidianTask(
      ctx.editor,
      ctx.plugin.getActiveObsidianTaskToggle(ctx.editor),
      ctx.view,
    ),
    true,
  );
  const prompt = ctx.plugin.demotionSectionPicker.snapshot.plan;
  assert.equal(prompt.promptKind, "demotion");
  assert.equal(
    acceptPickerDestination(ctx.plugin, {
      kind: "existing",
      heading: findPromptHeading(prompt, "Notes"),
    }),
    true,
  );
  const after = ctx.editor.getValue();
  assert.match(after, /## Notes/);
  assert.match(after, /^- Alpha/m);
  assert.match(after, /\t- child note/);
  assertSettled(ctx.plugin, AREA, after);
});

test("stale picker snapshot refuses without writing", () => {
  const source = areaSource("## Ideas\n\n- Ship it\n");
  const shipLine = source.split("\n").findIndex((line) => line === "- Ship it");
  const ctx = makeHarness(source, { line: shipLine, ch: 2 });
  assert.equal(
    ctx.plugin.toggleActiveObsidianTask(
      ctx.editor,
      ctx.plugin.getActiveObsidianTaskToggle(ctx.editor),
      ctx.view,
    ),
    true,
  );
  ctx.editor.replaceRange("x", { line: shipLine, ch: 2 }, { line: shipLine, ch: 2 });
  assert.equal(acceptSelectedPickerRow(ctx.plugin), false);
  assert.match(ctx.editor.getValue(), /^- xShip it/m);
  assert.equal(ctx.editor.getValue().includes("#task Ship it"), false);
});

test("missing provider falls back to the existing conversion write", () => {
  const source = [
    "## Notes",
    "",
    "- [ ] #task Alpha",
    "- [ ] #task Beta",
  ].join("\n");
  const ctx = makeHarness(source, { line: 2, ch: 0 }, "Daily.md", { settle: false });
  const plan = ctx.plugin.getActiveObsidianTaskToggle(ctx.editor, 1);
  assert.equal(plan.mode, "replaceLines");
  assert.equal(ctx.plugin.toggleActiveObsidianTask(ctx.editor, plan, ctx.view), true);
  assert.equal(
    ctx.editor.getValue(),
    ["## Notes", "", "- Alpha", "- Beta"].join("\n"),
  );
  assert.deepEqual(ctx.editor.getCursor(), { line: 2, ch: 0 });
});

test("stale preimage after a picker snapshot abandons the move", () => {
  const source = areaSource("## Ideas\n\n- Ship it\n");
  const ctx = makeHarness(source, { line: 5, ch: 2 });
  const live = ctx.plugin.applyTaskSettleToEditor;
  ctx.plugin.applyTaskSettleToEditor = (editor, path, options) => {
    editor.replaceRange("drift", { line: 0, ch: 0 }, { line: 0, ch: 0 });
    return live.call(ctx.plugin, editor, path, options);
  };
  const plan = {
    mode: "replace",
    line: 5,
    sourceLineText: "- Ship it",
    lineText: `- [ ] #task Ship it [created::${DATE}]`,
    cursorLine: 5,
    cursorCh: 12,
  };
  assert.equal(ctx.plugin.applyObsidianTaskReplacePlan(ctx.editor, plan, ctx.view), false);
});

test("empty o abandon stays byte-identical with the provider loaded", () => {
  const source = areaSource();
  const origin = source.split("\n").findIndex((line) => line.includes("^idea"));
  const ctx = makeHarness(source, { line: origin, ch: 8 });
  ctx.plugin.applyVimOpenLine(ctx.editor, "below");
  assert.match(ctx.editor.getValue(), /#task  \[created::/);
  ctx.editor.emit("vim-mode-change", { mode: "normal" });
  assert.equal(ctx.editor.getValue(), source);
  assert.equal(ctx.plugin.flushOpenLineScaffold("blur"), false);
});

test("nonempty o scaffold settles on insert-leave and ignores a second flush", () => {
  const source = areaSource();
  const origin = source.split("\n").findIndex((line) => line.includes("^idea"));
  const ctx = makeHarness(source, { line: origin, ch: 8 });
  ctx.plugin.applyVimOpenLine(ctx.editor, "below");
  const pending = ctx.plugin.openLineScaffold;
  assert.ok(pending && pending.scaffold.kind === "task");
  const empty = pending.scaffold.emptyText;
  const filled = empty.replace("#task  ", "#task Hello ");
  ctx.editor.replaceRange(
    filled,
    { line: pending.scaffold.lineIndex, ch: 0 },
    { line: pending.scaffold.lineIndex, ch: empty.length },
  );
  assert.equal(ctx.plugin.flushOpenLineScaffold("insert-leave"), true);
  const after = ctx.editor.getValue();
  assert.match(after, /#task Hello /);
  assert.match(after, /### /);
  assertSettled(ctx.plugin, AREA, after);
  assert.equal(ctx.plugin.flushOpenLineScaffold("blur"), false);
  assert.equal(ctx.plugin.openLineScaffold, null);
});

test("nonempty O scaffold on a reused editor is dropped", () => {
  const source = areaSource();
  const origin = source.split("\n").findIndex((line) => line.includes("^idea"));
  const ctx = makeHarness(source, { line: origin, ch: 8 });
  ctx.plugin.applyVimOpenLine(ctx.editor, "above");
  const pending = ctx.plugin.openLineScaffold;
  const empty = pending.scaffold.emptyText;
  const filled = empty.replace("#task  ", "#task Above ");
  ctx.editor.replaceRange(
    filled,
    { line: pending.scaffold.lineIndex, ch: 0 },
    { line: pending.scaffold.lineIndex, ch: empty.length },
  );
  ctx.view.file = { path: "Areas/other.md" };
  assert.equal(ctx.plugin.flushOpenLineScaffold("leaf"), false);
  assert.match(ctx.editor.getValue(), /#task Above /);
  assert.equal(ctx.editor.getValue().includes("### "), false);
});

test("missing provider leaves a nonempty scaffold un-settled", () => {
  const source = "- [ ] #task Ship";
  const ctx = makeHarness(source, { line: 0, ch: 8 }, "Daily.md", { settle: false });
  ctx.plugin.applyVimOpenLine(ctx.editor, "below");
  const pending = ctx.plugin.openLineScaffold;
  const empty = pending.scaffold.emptyText;
  const filled = empty.replace("#task  ", "#task Hello ");
  ctx.editor.replaceRange(
    filled,
    { line: pending.scaffold.lineIndex, ch: 0 },
    { line: pending.scaffold.lineIndex, ch: empty.length },
  );
  assert.equal(ctx.plugin.flushOpenLineScaffold("insert-leave"), false);
  assert.equal(ctx.editor.getValue(), `${source}\n${filled}`);
});

test("CRLF nonempty scaffold settle keeps CRLF", () => {
  const source = areaSource().replace(/\n/g, "\r\n");
  const origin = source.split(/\r?\n/).findIndex((line) => line.includes("^idea"));
  const ctx = makeHarness(source, { line: origin, ch: 8 });
  ctx.plugin.applyVimOpenLine(ctx.editor, "below");
  const pending = ctx.plugin.openLineScaffold;
  const empty = pending.scaffold.emptyText;
  const filled = empty.replace("#task  ", "#task Hello ");
  ctx.editor.replaceRange(
    filled,
    { line: pending.scaffold.lineIndex, ch: 0 },
    { line: pending.scaffold.lineIndex, ch: empty.length },
  );
  assert.equal(ctx.plugin.flushOpenLineScaffold("insert-leave"), true);
  const after = ctx.editor.getValue();
  assert.ok(after.includes("\r\n"));
  assert.match(after, /#task Hello /);
  assert.match(after, /### /);
});
