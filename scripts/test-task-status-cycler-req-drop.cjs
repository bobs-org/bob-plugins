// Requirement drop / restore (bob-cli-on.10.1.3): Alt+[ reasons and Alt+]
// restores run the RW twin as one undo step each.
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

const REQ_TEXT = [
  "- [ ] #task Ship the exporter",
  "\t- [ ] Handles supported inputs",
  "\t\t- Fixture: windows.csv",
  "\t- [ ] Benchmarks within 5%",
].join("\n");

function makePlugin(text = REQ_TEXT, line = 1) {
  notices.length = 0;
  const { app } = createInMemoryObsidianApp({ "Daily.md": text });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = {
    ...app,
    workspace: {
      getActiveFile: () => ({ path: "Daily.md" }),
      getActiveViewOfType: () => null,
    },
    commands: { commands: {}, executeCommandById: () => false },
  };
  return plugin;
}

function viewFor(plugin, editor) {
  const harness = { app: plugin.app };
  const attached = attachActiveMarkdownView(plugin, harness, editor, "Daily.md");
  const view = Object.assign(new MarkdownView(), { editor, file: attached.file });
  plugin.app.workspace.getActiveViewOfType = () => view;
  return view;
}

function countingEditor(text, cursor) {
  const editor = createTextEditor(text, cursor);
  let calls = 0;
  const original = editor.replaceRange;
  editor.replaceRange = (...args) => {
    calls += 1;
    return original(...args);
  };
  editor.replaceRangeCalls = () => calls;
  return editor;
}

function installFakeNav(plugin) {
  const attached = [];
  const used = [];
  const previous = (plugin.app.plugins && plugin.app.plugins.plugins) || {};
  plugin.app.plugins = {
    plugins: {
      ...previous,
      "bob-navigation-hotkeys": {
        api: {
          version: 1,
          logRecall: {
            version: 1,
            attach: (opts) => {
              attached.push(opts && opts.kind);
              return { detach: () => {} };
            },
            noteUsed: (kind, text) => {
              used.push([kind, text]);
              return true;
            },
          },
        },
      },
    },
  };
  return { attached, used };
}

test("drop dry-run refuses already-dropped and carried lines", () => {
  const plugin = makePlugin();
  const dropped = "- [ ] #task Ship it\n\t- [-] Old req";
  const editor = createTextEditor(dropped, { line: 1, ch: 5 });
  viewFor(plugin, editor);
  notices.length = 0;
  // Route through the drop entry: it dry-runs with an empty reason first.
  assert.equal(plugin.handleCycleCommand(false, editor, viewFor(plugin, editor), -1), true);
  // The dropped line refuses with the writer message; bytes stay identical.
  // (The modal never opens on refusal.)
  assert.ok(notices.length > 0);
  const carried = "- [ ] #task Ship it\n\t- [>] Carried stub [[#^abc|Alias]]";
  const carriedEditor = createTextEditor(carried, { line: 1, ch: 5 });
  viewFor(plugin, carriedEditor);
  notices.length = 0;
  assert.equal(plugin.handleCycleCommand(false, carriedEditor, viewFor(plugin, carriedEditor), -1), true);
  assert.equal(carriedEditor.getValue(), carried);
  assert.ok(notices.some((m) => m.includes("Carried")));
});

test("drop submit writes one undo step and counts nested descendants", () => {
  const plugin = makePlugin();
  const editor = countingEditor(REQ_TEXT, { line: 1, ch: 3 });
  viewFor(plugin, editor);
  const info = plugin.cyclerReqInfoAtCursor(editor);
  assert.ok(info);
  // Submit directly (bypasses the modal) with a reason.
  notices.length = 0;
  const before = editor.replaceRangeCalls();
  assert.equal(plugin.cyclerReqSubmitDrop({ lineIndex: 1, preimage: REQ_TEXT.split("\n")[1], reqText: "Handles supported inputs", cursorCh: 3 }, "no time"), true);
  // Whole-note replacement lands as a single replaceRange (one undo step).
  assert.equal(editor.replaceRangeCalls() - before, 1);
  assert.match(editor.getLine(1), /\[-]/);
  assert.ok(editor.getValue().includes("no time"));
  assert.ok(notices.some((m) => m.includes("Dropped")));
  assert.ok(notices.some((m) => m.includes("Handles supported inputs")));
});

test("drop without a reason writes no log unless one exists", () => {
  const plugin = makePlugin();
  const editor = createTextEditor(REQ_TEXT, { line: 3, ch: 3 });
  viewFor(plugin, editor);
  notices.length = 0;
  assert.equal(plugin.cyclerReqSubmitDrop({ lineIndex: 3, preimage: REQ_TEXT.split("\n")[3], reqText: "Benchmarks within 5%", cursorCh: 3 }, ""), true);
  assert.match(editor.getLine(3), /\[-]/);
  assert.ok(!editor.getValue().includes("CANCEL LOG"));
  assert.ok(notices.some((m) => m.includes("Dropped")));
});

test("drop with an existing log prepends and restores keep the log", () => {
  const withLog = [
    "- [ ] #task Ship it",
    "\t- [-] Old req",
    "\t\t- ❌ **CANCEL LOG**",
    "\t\t\t- *2026-11-01* — first reason",
    "\t- [ ] Fresh req",
  ].join("\n");
  const plugin = makePlugin(withLog, 4);
  const editor = createTextEditor(withLog, { line: 4, ch: 5 });
  viewFor(plugin, editor);
  assert.equal(plugin.cyclerReqSubmitDrop({ lineIndex: 4, preimage: withLog.split("\n")[4], reqText: "Fresh req", cursorCh: 5 }, "second"), true);
  assert.ok(editor.getValue().includes("second"));
  assert.ok(editor.getValue().includes("CANCEL LOG"));
  // Restore the dropped row: cancel log stays, mark returns to open.
  const afterDrop = editor.getValue();
  const dropLine = afterDrop.split("\n").findIndex((line) => line.includes("Fresh req"));
  assert.ok(dropLine >= 0);
  notices.length = 0;
  const restoreEditor = editor;
  const info = plugin.cyclerReqInfoForText(afterDrop, dropLine);
  assert.ok(info);
  assert.equal(plugin.cyclerReqHandleRestore(false, restoreEditor, viewFor(plugin, restoreEditor), info), true);
  assert.match(restoreEditor.getLine(dropLine), /\[ \]/);
  assert.ok(restoreEditor.getValue().includes("CANCEL LOG"));
  assert.ok(notices.some((m) => m.includes("Restored")));
});

test("restore on a pending req shows the owner copy", () => {
  const plugin = makePlugin();
  const editor = createTextEditor(REQ_TEXT, { line: 1, ch: 3 });
  const v = viewFor(plugin, editor);
  notices.length = 0;
  const info = plugin.cyclerReqInfoAtCursor(editor);
  assert.equal(plugin.cyclerReqHandleRestore(false, editor, v, info), true);
  assert.equal(editor.getValue(), REQ_TEXT);
  assert.ok(notices.some((m) => m.includes("Requirements are met")));
});

test("stale preimage between prompt and submit refuses", () => {
  const plugin = makePlugin();
  const editor = createTextEditor(REQ_TEXT, { line: 1, ch: 3 });
  viewFor(plugin, editor);
  // Capture the preimage, then edit the line before submitting.
  const preimage = REQ_TEXT.split("\n")[1];
  editor.replaceRange("CHANGED", { line: 1, ch: 0 }, { line: 1, ch: 1 });
  notices.length = 0;
  assert.equal(plugin.cyclerReqSubmitDrop({ lineIndex: 1, preimage, reqText: "Handles supported inputs", cursorCh: 3 }, "late"), false);
  assert.ok(notices.some((m) => m.includes("The line changed")));
});

test("opening the drop modal writes nothing until submit", () => {
  const plugin = makePlugin();
  const editor = createTextEditor(REQ_TEXT, { line: 1, ch: 3 });
  const v = viewFor(plugin, editor);
  const before = editor.getValue();
  notices.length = 0;
  assert.equal(plugin.handleCycleCommand(false, editor, v, -1), true);
  // The modal opened; no write landed yet.
  assert.equal(editor.getValue(), before);
});

test("drop attaches Log Recall and records nonempty reasons", () => {
  const plugin = makePlugin();
  const editor = createTextEditor(REQ_TEXT, { line: 1, ch: 3 });
  viewFor(plugin, editor);
  const { attached, used } = installFakeNav(plugin);
  // Open the modal: attach runs with kind cancel.
  notices.length = 0;
  assert.equal(plugin.handleCycleCommand(false, editor, viewFor(plugin, editor), -1), true);
  assert.ok(attached.includes("cancel"));
  // Submit records the reason.
  assert.equal(plugin.cyclerReqSubmitDrop({ lineIndex: 1, preimage: REQ_TEXT.split("\n")[1], reqText: "Handles supported inputs", cursorCh: 3 }, "deferred"), true);
  assert.deepEqual(used, [["cancel", "deferred"]]);
  // Empty reasons never call noteUsed.
  const plugin2 = makePlugin();
  const editor2 = createTextEditor(REQ_TEXT, { line: 3, ch: 3 });
  viewFor(plugin2, editor2);
  const nav2 = installFakeNav(plugin2);
  assert.equal(plugin2.cyclerReqSubmitDrop({ lineIndex: 3, preimage: REQ_TEXT.split("\n")[3], reqText: "Benchmarks within 5%", cursorCh: 3 }, ""), true);
  assert.equal(nav2.used.length, 0);
});
