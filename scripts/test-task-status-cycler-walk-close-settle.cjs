// Review-walk close ordering with the real cycler and taskSettle provider.
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { Cm6MappingEditor } = require("./cm6-mapping-editor.cjs");
const {
  TaskStatusCyclerPlugin,
  createInMemoryObsidianApp,
  attachActiveMarkdownView,
  flushAsyncActions,
  installTasksCloseCommand,
} = require("./task-status-cycler-harness.cjs");
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");

const NOTE_PATH = "Areas/home.md";
const TODAY = "2026-11-25";

function makeFixture() {
  const source = [
    "---",
    "type: [[area]]",
    "---",
    "## Tasks",
    "",
    "- [ ] #task Before the landing ^before",
    "- [ ] #task Landed close [id:: landed] ^landed",
    "- [ ] #task After the landing ^after",
  ].join("\n");
  const harness = createInMemoryObsidianApp({ [NOTE_PATH]: source });
  const targetLine = source.split("\n").findIndex((line) => line.includes("^landed"));
  const editor = new Cm6MappingEditor(source, { line: targetLine, ch: 4 });
  editor.replaceRange = (replacement, from, to = from) => {
    editor.transaction({ changes: [{ from, to, text: replacement }] });
  };
  const listeners = {};
  editor.on = (name, listener) => { (listeners[name] || (listeners[name] = [])).push(listener); };
  editor.off = (name, listener) => {
    listeners[name] = (listeners[name] || []).filter((candidate) => candidate !== listener);
  };
  editor.emit = (name, args) => { for (const listener of listeners[name] || []) listener(args); };

  const plugin = new TaskStatusCyclerPlugin();
  plugin.getCreatedDateString = () => TODAY;
  plugin.scheduleCenterEditorLineInView = () => {};
  const { view } = attachActiveMarkdownView(plugin, harness, editor, NOTE_PATH);
  const leaves = [{ view }];
  harness.app.workspace.iterateAllLeaves = (visit) => leaves.forEach(visit);
  harness.app.workspace.getLeavesOfType = (type) => type === "markdown" ? leaves.slice() : [];

  const ledger = new LedgerToolsPlugin(harness.app);
  ledger.app = harness.app;
  harness.app.plugins.plugins["bob-ledger-tools"].api.taskSettle = ledger.taskSettleApi();

  return { harness, editor, plugin, source };
}

test("landed close settles before one walk continuation and pinned successor focus wins", async () => {
  const fixture = makeFixture();
  const { editor, plugin } = fixture;
  const tasks = installTasksCloseCommand(plugin, editor);
  const successor = { path: "Areas/next.md", line: 12, ch: 0 };
  const continued = [];
  let finalizeCalls = 0;
  let continuedBuffer = "";
  plugin.finalizeClosedTasks = async (_closed, context) => {
    finalizeCalls += 1;
    if (context.successorJumpBox) context.successorJumpBox.jump = successor;
    return { jump: successor };
  };
  plugin.app.plugins.plugins["bob-navigation-hotkeys"] = {
    api: {
      version: 3,
      claimReviewWalkCompletion: () => false,
      reviewWalk: {
        version: 1,
        capture: () => ({ key: "landed", seq: 1, epoch: 1 }),
        continue(origin, outcome) {
          continuedBuffer = editor.getValue();
          continued.push({ origin, outcome });
          return Promise.resolve({ ok: true, advanced: false, followed: true });
        },
      },
    },
  };

  const initialStatus = plugin.getActiveTaskStatus(editor);
  assert.equal(initialStatus?.symbol, " ");
  const walk = plugin.getReviewWalkApi();
  const origin = walk.capture(editor);
  const successorNoticeBox = {};
  const successorJumpBox = {};
  const wrote = await plugin.toggleActiveCheckboxOpenDoneAndPropagate(
    editor,
    { path: NOTE_PATH },
    initialStatus,
    {
      successorNoticeTarget: "return",
      successorNoticeBox,
      successorJumpTarget: "return",
      successorJumpBox,
      openingKeys: ["Control", "Enter"],
    },
  );
  plugin.continueReviewWalkSilently(walk, origin, wrote === true
    ? {
      kind: "complete",
      ...(successorNoticeBox.text ? { notice: successorNoticeBox.text } : {}),
      ...(successorJumpBox.jump ? { follow: successorJumpBox.jump } : {}),
    }
    : null);
  await flushAsyncActions();

  const closedLine = continuedBuffer.split("\n").find((line) => line.includes("^landed"));
  const closedLineIndex = continuedBuffer.split("\n").findIndex((line) => line.includes("^landed"));
  const doneHeaderIndex = continuedBuffer.split("\n").findIndex((line) => line === "### Done & Canceled");
  assert.equal((continuedBuffer.match(/\[x\] #task Landed close/g) || []).length, 1,
    JSON.stringify({ continued: continued[0], continuedBuffer, wrote, finalizeCalls }));
  assert.match(closedLine || "", /^- \[x\] #task Landed close/);
  assert.ok(doneHeaderIndex >= 0 && closedLineIndex > doneHeaderIndex,
    "the close settle is visible before the walk continues");
  assert.equal(finalizeCalls, 1, "the close finalizes once");
  assert.deepEqual(tasks.executed, ["obsidian-tasks-plugin:set-status-symbol-to-x"]);
  assert.equal(continued.length, 1, "the walk advances at most once");
  assert.deepEqual(continued[0].outcome, { kind: "complete", follow: successor },
    "the pinned successor follow wins over the settle cursor");
});
