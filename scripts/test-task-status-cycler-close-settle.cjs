// Close-settle integration (bob-cli-q4.9.1.2 close-settle).
// Ctrl+Enter, completeTaskAtCursor, and transcluded completion settle
// through the real ledger-tools provider before successor finalization.
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  TaskStatusCyclerPlugin,
  helpers,
  createInMemoryObsidianApp,
  createTextEditor,
  attachActiveMarkdownView,
  installTasksCloseCommand,
} = require("./task-status-cycler-harness.cjs");
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");

const DAILY = "Daily.md";

function attachRealTaskSettle(harness) {
  const ledger = new LedgerToolsPlugin(harness.app);
  ledger.app = harness.app;
  const holder = harness.app.plugins.plugins["bob-ledger-tools"];
  holder.api.taskSettle = ledger.taskSettleApi();
  return ledger;
}

function attachViewLeaves(harness, view) {
  // The provider guards editor writes by resolving the owning Markdown
  // view through workspace leaves; the harness only sets
  // getActiveViewOfType, so wire the same view into both leaf APIs.
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

function dailySource(lines) {
  return ["## Tasks", "", ...lines].join("\n");
}

test("completeTaskAtCursor settles the closed note before finalizing", async () => {
  const path = "Areas/home.md";
  const source = [
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
  const harness = createInMemoryObsidianApp({ [path]: source });
  const editor = createTextEditor(source, { line: 8, ch: 6 });
  const plugin = new TaskStatusCyclerPlugin();
  const attached = attachActiveMarkdownView(plugin, harness, editor, path);
  attachViewLeaves(harness, attached.view);
  attachRealTaskSettle(harness);
  const jumps = attachNavJumps(harness);
  installTasksCloseCommand(plugin, editor);

  const result = await plugin.completeTaskAtCursor(editor);
  assert.equal(result.ok, true);
  // Reported delta stays about the Tasks rewrite, not added group headings.
  assert.equal(result.lineDelta, 0);
  const after = editor.getValue();
  assert.match(after, /^- \[x\] #task Finish the design \^design/m);
  assert.match(after, /### Done & Canceled/);
  // Full-note settle ran: a second pure settle is a no-op.
  const again = plugin.settleTargetContents(path, after);
  assert.equal(again.changed, false);
  // Stay-cursor jump recorded exactly once for the moved task.
  assert.equal(jumps.length, 1);
  assert.equal(jumps[0].from.path, path);
  assert.equal(jumps[0].to.path, path);
  assert.ok(jumps[0].from.line > jumps[0].to.line);
});

test("completeTaskAtCursor without a provider keeps the Tasks close", async () => {
  const source = dailySource(["- [ ] #task Ship it"]);
  const harness = createInMemoryObsidianApp({ [DAILY]: source });
  const editor = createTextEditor(source, { line: 2, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  attachActiveMarkdownView(plugin, harness, editor, DAILY);
  installTasksCloseCommand(plugin, editor);

  const result = await plugin.completeTaskAtCursor(editor);
  assert.equal(result.ok, true);
  assert.match(editor.getValue(), /^- \[x\] #task Ship it/m);
});

test("recurring close locates the [x] row, not the spawned next occurrence", async () => {
  const source = dailySource(["- [ ] #task Water plants 🔁 every day ^plants"]);
  const harness = createInMemoryObsidianApp({ [DAILY]: source });
  const editor = createTextEditor(source, { line: 2, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  const attached = attachActiveMarkdownView(plugin, harness, editor, DAILY);
  attachViewLeaves(harness, attached.view);
  attachRealTaskSettle(harness);
  installTasksCloseCommand(plugin, editor, { insertAbove: true });

  const result = await plugin.completeTaskAtCursor(editor);
  assert.equal(result.ok, true);
  // Tasks mock inserts the open recurrence above (line count +1).
  assert.equal(result.lineDelta, 1);
  const after = editor.getValue();
  assert.match(after, /^- \[ \] #task Water plants 🔁 every day \^plants/m);
  assert.match(after, /^- \[x\] #task Water plants 🔁 every day \^plants/m);
  const located = plugin.locateSettledClosedTask(editor, {
    blockId: "plants",
    closedText: "- [x] #task Water plants 🔁 every day ^plants",
    hintLine: 2,
  });
  assert.ok(Number.isInteger(located));
  assert.match(editor.getLine(located), /^- \[x\] /);
});

test("idless rows verify by exact text and survive settle", async () => {
  const source = dailySource([
    "- [ ] #task First",
    "- [ ] #task Second",
  ]);
  const harness = createInMemoryObsidianApp({ [DAILY]: source });
  const editor = createTextEditor(source, { line: 3, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  const attached = attachActiveMarkdownView(plugin, harness, editor, DAILY);
  attachViewLeaves(harness, attached.view);
  attachRealTaskSettle(harness);
  installTasksCloseCommand(plugin, editor);

  const result = await plugin.completeTaskAtCursor(editor);
  assert.equal(result.ok, true);
  const after = editor.getValue();
  assert.match(after, /^- \[x\] #task Second/m);
  const located = plugin.locateSettledClosedTask(editor, {
    blockId: null,
    closedText: "- [x] #task Second",
    hintLine: 3,
  });
  assert.equal(located, 3);
});

test("Ctrl+Enter local fallback settles before successor finalization", async () => {
  const source = dailySource(["- [ ] #task Fallback close"]);
  const harness = createInMemoryObsidianApp({ [DAILY]: source });
  const editor = createTextEditor(source, { line: 2, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  const attachedFallback = attachActiveMarkdownView(plugin, harness, editor, DAILY);
  attachViewLeaves(harness, attachedFallback.view);
  harness.app.commands = { commands: {}, executeCommandById: () => false };
  attachRealTaskSettle(harness);
  attachNavJumps(harness);
  const taskStatus = helpers.getTaskStatusForLine(editor.getLine(2), 2);
  const file = harness.app.vault.getAbstractFileByPath(DAILY);

  const wrote = await plugin.toggleActiveCheckboxOpenDoneAndPropagate(
    editor,
    file,
    taskStatus,
    {},
  );
  assert.equal(wrote, true);
  const after = editor.getValue();
  assert.match(after, /^- \[x\] #task Fallback close/m);
  const again = plugin.settleTargetContents(DAILY, after);
  assert.equal(again.changed, false);
});

test("same-note transcluded close composes settle in one staged write", async () => {
  const target = "- [ ] #task Shared target ^shared";
  const source = ["- [ ] #task Local ![[Target#^shared]]", target].join("\n");
  const harness = createInMemoryObsidianApp({
    [DAILY]: source,
    "Target.md": target,
  });
  const editor = createTextEditor(source, { line: 1, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  const attached = attachActiveMarkdownView(plugin, harness, editor, DAILY);
  attachViewLeaves(harness, attached.view);
  attachRealTaskSettle(harness);
  const resolvedTarget = {
    file: harness.app.vault.getAbstractFileByPath(DAILY),
    line: 1,
    blockId: "shared",
    taskStatus: helpers.getTaskStatusForLine(target, 1),
    sourceText: source,
  };
  const context = { editor, activePath: DAILY, originPath: DAILY };

  const wrote = await plugin.replaceResolvedTranscludedTaskLine(
    resolvedTarget,
    context,
    "x",
    { settlePolicy: "immediate" },
  );
  assert.equal(wrote, true);
  assert.match(editor.getLine(1), /^- \[x\] #task Shared target.*\^shared/);
  const again = plugin.settleTargetContents(DAILY, editor.getValue());
  assert.equal(again.changed, false);
});

test("other-note transcluded close settles inside the same vault write", async () => {
  const target = "- [ ] #task Remote target ^remote";
  const source = "- [ ] #task Local ![[Remote#^remote]]";
  const harness = createInMemoryObsidianApp({
    [DAILY]: source,
    "Remote.md": target,
  });
  const editor = createTextEditor(source, { line: 0, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  const attached = attachActiveMarkdownView(plugin, harness, editor, DAILY);
  attachViewLeaves(harness, attached.view);
  attachRealTaskSettle(harness);
  let processCalls = 0;
  const vault = harness.app.vault;
  const innerProcess = vault.process.bind(vault);
  vault.process = async (file, update) => {
    processCalls += 1;
    return innerProcess(file, update);
  };
  const resolvedTarget = {
    file: harness.app.vault.getAbstractFileByPath("Remote.md"),
    line: 0,
    blockId: "remote",
    taskStatus: helpers.getTaskStatusForLine(target, 0),
    sourceText: target,
  };
  const context = { editor, activePath: DAILY, originPath: DAILY };

  const wrote = await plugin.replaceResolvedTranscludedTaskLine(
    resolvedTarget,
    context,
    "x",
    { settlePolicy: "immediate" },
  );
  assert.equal(wrote, true);
  assert.equal(processCalls, 1);
  const remoteAfter = harness.getSource("Remote.md");
  assert.match(remoteAfter, /^- \[x\] #task Remote target.*\^remote/);
  assert.equal(editor.getValue(), source);
  const again = plugin.settleTargetContents("Remote.md", remoteAfter);
  assert.equal(again.changed, false);
});

test("stale transcluded lines re-resolve the block ID against live text", async () => {
  const moved = ["- [ ] #task Other", "- [ ] #task Moved ^moved"].join("\n");
  const plugin = new TaskStatusCyclerPlugin();
  const liveLine = plugin.resolveLiveTranscludedCloseLine(moved, "moved", 4);
  assert.equal(liveLine, 1);
  assert.equal(plugin.resolveLiveTranscludedCloseLine(moved, "missing", 0), null);
});

test("deferred cycling policy never takes the immediate close settle", async () => {
  const source = dailySource(["- [ ] #task Cycle me"]);
  const harness = createInMemoryObsidianApp({ [DAILY]: source });
  harness.app.commands = { commands: {}, executeCommandById: () => false };
  const editor = createTextEditor(source, { line: 2, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  const attached = attachActiveMarkdownView(plugin, harness, editor, DAILY);
  attachViewLeaves(harness, attached.view);
  attachRealTaskSettle(harness);
  const jumps = attachNavJumps(harness);
  const taskStatus = helpers.getTaskStatusForLine(editor.getLine(2), 2);

  let settleCalls = 0;
  const innerSettle = plugin.applyTaskSettleToEditor.bind(plugin);
  plugin.applyTaskSettleToEditor = (...args) => {
    settleCalls += 1;
    return innerSettle(...args);
  };
  const wrote = plugin.setActiveCheckboxStatus(editor, taskStatus, "/", {
    settlePolicy: "deferred",
  });
  assert.equal(wrote, true);
  assert.equal(settleCalls, 0, "deferred cycle writes do not settle per-row");
  assert.equal(jumps.length, 0);
  assert.equal(helpers.closeSettleNormalizePolicyForWrite("deferred", "x"), "deferred");
  assert.equal(helpers.closeSettleNormalizePolicyForWrite("immediate", "x"), "immediate");
  assert.equal(helpers.closeSettleNormalizePolicyForWrite("immediate", "/"), "none");
});

test("refused closes leave the note untouched", async () => {
  const plugin = new TaskStatusCyclerPlugin();
  assert.equal(plugin.locateSettledClosedTask(null, null), null);
  assert.equal(
    plugin.locateSettledClosedTask({ getLine: () => "- [ ] #task Open" }, {
      blockId: null,
      closedText: "- [x] #task Open",
      hintLine: 0,
    }),
    null,
  );
});
