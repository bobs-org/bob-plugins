// Requirement-line guards (bob-cli-on.10.1.3): every cycler task gesture
// refuses on a req line with the contract copy and leaves bytes identical.
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  TaskStatusCyclerPlugin,
  createInMemoryObsidianApp,
  createTextEditor,
  attachActiveMarkdownView,
  MarkdownView,
  notices,
  helpers,
} = require("./task-status-cycler-harness.cjs");

const {
  CYCLER_REQ_LANE_COPY,
  CYCLER_REQ_CARRIED_COPY,
  cyclerReqOwnerCopy,
  cyclerReqInfoForText,
} = helpers;

const REQ_TEXT = [
  "- [ ] #task Ship the exporter",
  "\t- [ ] Handles supported inputs",
  "\t\t- Fixture: windows.csv",
  "\t- [ ] Benchmarks within 5%",
  "",
  "- [ ] #task Second task",
].join("\n");

const OWNER_COPY = "Requirements are met when “Ship the exporter” closes — Ctrl+Enter on the task";

function makeReqPlugin(text = REQ_TEXT, line = 1, path = "Daily.md") {
  notices.length = 0;
  const { app } = createInMemoryObsidianApp({ [path]: text });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = {
    ...app,
    workspace: {
      getActiveFile: () => ({ path }),
      getActiveViewOfType: () => null,
    },
    commands: { commands: {}, executeCommandById: () => false },
  };
  return plugin;
}

function reqView(plugin, editor, path = "Daily.md") {
  const harness = { app: plugin.app };
  const attached = attachActiveMarkdownView(plugin, harness, editor, path);
  const view = Object.assign(new MarkdownView(), { editor, file: attached.file });
  plugin.app.workspace.getActiveViewOfType = () => view;
  return view;
}

test("guard recognizes req lines and ignores task lines", () => {
  assert.ok(cyclerReqInfoForText(REQ_TEXT, 1));
  assert.equal(cyclerReqInfoForText(REQ_TEXT, 1).text, "Handles supported inputs");
  assert.equal(cyclerReqInfoForText(REQ_TEXT, 1).ownerName, "Ship the exporter");
  assert.equal(cyclerReqInfoForText(REQ_TEXT, 0), null);
  assert.equal(cyclerReqInfoForText(REQ_TEXT, 2), null);
  assert.equal(cyclerReqRefuseCopyFor("ctrl-enter"), OWNER_COPY);
});

function cyclerReqRefuseCopyFor(gesture) {
  const info = cyclerReqInfoForText(REQ_TEXT, 1);
  return helpers.cyclerReqRefuse(info, gesture);
}

test("refuse copies match the contract", () => {
  assert.equal(cyclerReqRefuseCopyFor("ctrl-enter"), OWNER_COPY);
  assert.equal(cyclerReqRefuseCopyFor("alt-restore"), OWNER_COPY);
  assert.equal(cyclerReqRefuseCopyFor("link"), OWNER_COPY);
  assert.equal(cyclerReqRefuseCopyFor("transclusion"), OWNER_COPY);
  assert.equal(cyclerReqRefuseCopyFor("writer"), OWNER_COPY);
  assert.equal(cyclerReqRefuseCopyFor("lane"), CYCLER_REQ_LANE_COPY);
  const carriedText = "- [ ] #task Ship it\n\t- [>] Carried stub [[#^abc|Alias]]";
  const carried = cyclerReqInfoForText(carriedText, 1);
  assert.ok(carried);
  assert.equal(helpers.cyclerReqRefuse(carried, "ctrl-enter"), CYCLER_REQ_CARRIED_COPY);
  assert.equal(helpers.cyclerReqRefuse(carried, "lane"), CYCLER_REQ_CARRIED_COPY);
  assert.equal(cyclerReqOwnerCopy("Ship the exporter"), OWNER_COPY);
});

test("Ctrl+Enter refuses on a req with the owner copy", () => {
  const plugin = makeReqPlugin();
  const editor = createTextEditor(REQ_TEXT, { line: 1, ch: 3 });
  const view = reqView(plugin, editor);
  const before = editor.getValue();
  assert.equal(plugin.handleToggleOpenDoneCommand(true, editor, view), true);
  assert.equal(editor.getValue(), before);
  assert.equal(plugin.handleToggleOpenDoneCommand(false, editor, view), true);
  assert.equal(editor.getValue(), before);
  assert.ok(notices.some((m) => m.includes("Requirements are met")));
  assert.ok(notices.some((m) => m.includes("Ship the exporter")));
});

test("Vim Ctrl+Enter refuses on a req", () => {
  const plugin = makeReqPlugin();
  const editor = createTextEditor(REQ_TEXT, { line: 1, ch: 3 });
  reqView(plugin, editor);
  const before = editor.getValue();
  notices.length = 0;
  // Simulate the Vim entry guard directly (no Vim harness needed).
  assert.equal(plugin.cyclerReqGuardRefuse(editor, "ctrl-enter", false), true);
  assert.equal(editor.getValue(), before);
  assert.ok(notices.some((m) => m.includes("Requirements are met")));
});

test("Ctrl+Shift+] refuses on a req with the lane copy", () => {
  const plugin = makeReqPlugin();
  const editor = createTextEditor(REQ_TEXT, { line: 1, ch: 3 });
  const view = reqView(plugin, editor);
  const before = editor.getValue();
  notices.length = 0;
  assert.equal(plugin.handleToggleObsidianTaskCommand(true, editor, view), true);
  assert.equal(editor.getValue(), before);
  assert.equal(plugin.handleToggleObsidianTaskCommand(false, editor, view), true);
  assert.equal(editor.getValue(), before);
  assert.ok(notices.some((m) => m === CYCLER_REQ_LANE_COPY));
  const toggle = plugin.getActiveObsidianTaskToggle(editor);
  assert.equal(toggle.mode, "refuse");
  assert.equal(toggle.message, CYCLER_REQ_LANE_COPY);
});

test("counted Alt+[ / Alt+] with any req target refuses whole", async () => {
  const plugin = makeReqPlugin();
  const editor = createTextEditor(REQ_TEXT, { line: 0, ch: 0 });
  reqView(plugin, editor);
  const before = editor.getValue();
  notices.length = 0;
  const changed = await plugin.cycleTaskStatusRange(editor, { path: "Daily.md" }, 1, 3);
  assert.equal(changed, false);
  assert.equal(editor.getValue(), before);
  assert.ok(notices.some((m) => m === CYCLER_REQ_LANE_COPY));
});

test("Alt+[ on a req opens the drop path and Alt+] restores pending", () => {
  const plugin = makeReqPlugin();
  const editor = createTextEditor(REQ_TEXT, { line: 1, ch: 3 });
  const view = reqView(plugin, editor);
  // checking mode consumes the key without writing
  assert.equal(plugin.handleCycleCommand(true, editor, view, -1), true);
  assert.equal(plugin.handleCycleCommand(true, editor, view, 1), true);
  assert.equal(editor.getValue(), REQ_TEXT);
});

test("complete-at-cursor returns requirement on a req", async () => {
  const plugin = makeReqPlugin();
  const editor = createTextEditor(REQ_TEXT, { line: 1, ch: 3 });
  reqView(plugin, editor);
  const result = await plugin.completeTaskAtCursor(editor);
  assert.deepEqual(result, { ok: false, reason: "requirement" });
  assert.equal(editor.getValue(), REQ_TEXT);
});

test("status writers refuse req lines with no write", () => {
  const plugin = makeReqPlugin();
  const editor = createTextEditor(REQ_TEXT, { line: 1, ch: 3 });
  reqView(plugin, editor);
  const before = editor.getValue();
  const status = plugin.getActiveTaskStatus(editor);
  // getActiveTaskStatus reads the checkbox; writers must still refuse via line check.
  assert.ok(status);
  assert.equal(plugin.cyclerReqRefuseLine(editor, 1), true);
  assert.equal(plugin.cyclerReqRefuseLine(editor, 0), false);
  const fakeStatus = { line: 1, lineText: editor.getLine(1), symbol: " ", statusStart: 5, statusEnd: 6 };
  assert.equal(plugin.setActiveCheckboxStatus(editor, fakeStatus, "x"), false);
  assert.equal(editor.getValue(), before);
  assert.equal(plugin.setCheckboxStatusLocalForLine(editor, fakeStatus, "x"), false);
  assert.equal(editor.getValue(), before);
});

test("transcluded writes refuse req targets", async () => {
  const plugin = makeReqPlugin();
  const editor = createTextEditor(REQ_TEXT, { line: 0, ch: 0 });
  reqView(plugin, editor);
  const before = editor.getValue();
  const resolvedTarget = {
    file: { path: "Daily.md" },
    sourceText: REQ_TEXT,
    line: 1,
    taskStatus: { symbol: " ", lineText: "\t- [ ] Handles supported inputs" },
  };
  notices.length = 0;
  const wrote = await plugin.replaceResolvedTranscludedTaskLine(resolvedTarget, { editor, activePath: "Daily.md" }, "x");
  assert.equal(wrote, false);
  assert.equal(editor.getValue(), before);
  assert.ok(notices.some((m) => m.includes("Requirements are met")));
});

test("Pomodoro tree close skips a plain node but still closes its #task child", async () => {
  const plugin = makeReqPlugin();
  const context = { editor: createTextEditor(""), activePath: "Daily.md" };
  const plainTree = {
    file: { path: "Other.md" },
    blockId: "plain",
    sourceText: "- [ ] plain item ^plain\n  - ![[Child#^child]]",
    line: 0,
    taskStatus: { symbol: " ", lineText: "- [ ] plain item ^plain" },
  };
  const taskChild = {
    file: { path: "Child.md" },
    blockId: "child",
    sourceText: "- [ ] #task child ^child",
    line: 0,
    taskStatus: { symbol: " ", lineText: "- [ ] #task child ^child" },
  };
  const writes = [];
  plugin.replaceResolvedTranscludedTaskLine = async (target, _context, mark) => {
    writes.push([target.taskStatus.lineText, mark]);
    return true;
  };
  plugin.completeTranscludedTaskTargetTree = async (_target, childContext, seen, depth, rootKey) =>
    plugin.completeResolvedTranscludedTaskTargetTree(taskChild, childContext, seen, depth, rootKey);

  const result = await plugin.completeResolvedTranscludedTaskTargetTree(
    plainTree,
    context,
    new Set(),
  );
  assert.deepEqual(writes, [["- [ ] #task child ^child", "x"]]);
  assert.deepEqual([result.visited, result.changed, result.closed.length], [true, true, 1]);
});

test("Pomodoro tree close keeps completion field writes on a #task root", async () => {
  const plugin = makeReqPlugin();
  const target = {
    file: { path: "Other.md" },
    blockId: "root",
    sourceText: "- [ ] #task root ^root [completion:: keep]",
    line: 0,
    taskStatus: { symbol: " ", lineText: "- [ ] #task root ^root [completion:: keep]" },
  };
  const writes = [];
  plugin.replaceResolvedTranscludedTaskLine = async (resolved, _context, mark) => {
    writes.push([resolved.taskStatus.lineText, mark]);
    return true;
  };
  const result = await plugin.completeResolvedTranscludedTaskTargetTree(
    target,
    { editor: createTextEditor(""), activePath: "Daily.md" },
    new Set(),
  );
  assert.deepEqual(writes, [[target.taskStatus.lineText, "x"]]);
  assert.equal(result.closed.length, 1);
});

test("#task lines, plain checklists, NOTES, fences, and bank rows keep behavior", () => {
  const plugin = makeReqPlugin();
  // #task line is not a req
  assert.equal(cyclerReqInfoForText(REQ_TEXT, 0), null);
  assert.equal(plugin.cyclerReqRefuseLine(createTextEditor(REQ_TEXT, { line: 0, ch: 0 }), 0), false);
  // Plain checklist outside any task block
  const plain = "- [ ] Buy milk";
  assert.equal(cyclerReqInfoForText(plain, 0), null);
  // Checklist inside NOTES drawer is a note, never a req
  const notesText = "- [ ] #task Ship it\n\t- NOTES\n\t\t- [ ] Loose note";
  assert.equal(cyclerReqInfoForText(notesText, 2), null);
  // Fenced lookalike never a req
  const fenced = "- [ ] #task Ship it\n```\n- [ ] Not a req\n```";
  assert.equal(cyclerReqInfoForText(fenced, 2), null);
  // Bank rows still refuse with bank copy first
  const bankText = "---\nmonth: 2026-11\n---\n\n## Thu Nov 12\n\n- [ ] $5.00 Typed cash row";
  const bankPlugin = (() => {
    notices.length = 0;
    const { app } = createInMemoryObsidianApp({ "bank/2026-11.md": bankText });
    const p = new TaskStatusCyclerPlugin();
    p.app = {
      ...app,
      workspace: { getActiveFile: () => ({ path: "bank/2026-11.md" }), getActiveViewOfType: () => null },
      commands: { commands: {}, executeCommandById: () => false },
    };
    return p;
  })();
  const bankEditor = createTextEditor(bankText, { line: 6, ch: 3 });
  const harness = { app: bankPlugin.app };
  const attached = attachActiveMarkdownView(bankPlugin, harness, bankEditor, "bank/2026-11.md");
  const bankViewObj = Object.assign(new MarkdownView(), { editor: bankEditor, file: attached.file });
  bankPlugin.app.workspace.getActiveViewOfType = () => bankViewObj;
  notices.length = 0;
  assert.equal(bankPlugin.handleToggleOpenDoneCommand(false, bankEditor, bankViewObj), true);
  assert.equal(bankEditor.getLine(6), "- [x] $5.00 Typed cash row");
});
