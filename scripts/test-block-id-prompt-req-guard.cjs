// Requirement-line guard for Block ID Prompt Ctrl+Shift+Enter
// (bob-cli-on.10.1.5): a req line or carried stub is never linked or unlinked.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  Plugin,
  helpers,
  resetNotices,
  lastNotice,
  createEditor,
  createTFile,
  createMarkdownView,
  createTaskModeHarness,
  UNLINKED_DAILY,
} = require("./block-id-prompt-harness.cjs");

const LANE = helpers.BLOCK_ID_REQ_LANE_COPY;
const CARRIED = helpers.BLOCK_ID_REQ_CARRIED_COPY;

const REQ_NOTE = [
  "- [ ] #task Owner task ^own",
  "  - [ ] Depth one",
  "  - [>] [[#^ship|Carried stub]]",
].join("\n");

function makeReqHarness(cursorLine) {
  resetNotices();
  const editor = createEditor(REQ_NOTE);
  editor.setCursor({ line: cursorLine, ch: 4 });
  const file = createTFile("Tasks.md");
  const view = createMarkdownView(file);
  const writes = [];
  const plugin = new Plugin();
  plugin.app = {
    workspace: { getActiveViewOfType: () => view, getActiveFile: () => file },
    vault: {
      read: async () => UNLINKED_DAILY,
      modify: async (target, content) => {
        writes.push({ path: target.path, content });
      },
    },
  };
  plugin.resolveTodayDailyFile = () => ({ path: "Daily.md" });
  plugin.suppressEditorScans = () => {};
  plugin.pickerRequests = [];
  plugin.promptPomodoroLinkTarget = async (request) => {
    plugin.pickerRequests.push(request);
    return helpers.defaultPomodoroLinkChoice(request.model);
  };
  plugin.startTaskLinkOpen = async () => {
    plugin.taskLinkMode = true;
  };
  return { plugin, editor, view, writes };
}

test("blockIdReqInfoAtLine recognizes reqs and carried stubs", () => {
  assert.equal(helpers.blockIdReqInfoAtLine(REQ_NOTE, 0), null);
  const req = helpers.blockIdReqInfoAtLine(REQ_NOTE, 1);
  assert.ok(req);
  assert.equal(req.depth, 1);
  assert.equal(helpers.blockIdReqRefuseCopy(req), LANE);
  const carried = helpers.blockIdReqInfoAtLine(REQ_NOTE, 2);
  assert.ok(carried);
  assert.equal(helpers.blockIdReqIsCarried(carried), true);
  assert.equal(helpers.blockIdReqRefuseCopy(carried), CARRIED);
});

test("Ctrl+Shift+Enter on a req line refuses with the lane copy and writes nothing", async () => {
  const h = makeReqHarness(1);
  const before = h.editor.getValue();
  await h.plugin.openPomodoroTaskLink(h.editor, h.view);
  assert.equal(h.editor.getValue(), before);
  assert.equal(lastNotice(), LANE);
  assert.equal(h.plugin.pickerRequests.length, 0);
  assert.equal(h.writes.length, 0);
  assert.equal(h.plugin.taskLinkMode, undefined);
});

test("Ctrl+Shift+Enter on a carried stub refuses with the carried copy and never enters task-link mode", async () => {
  const h = makeReqHarness(2);
  const before = h.editor.getValue();
  await h.plugin.openPomodoroTaskLink(h.editor, h.view);
  assert.equal(h.editor.getValue(), before);
  assert.equal(lastNotice(), CARRIED);
  assert.equal(h.plugin.pickerRequests.length, 0);
  assert.equal(h.writes.length, 0);
  assert.equal(h.plugin.taskLinkMode, undefined);
});

test("Ctrl+Shift+Enter on a #task line still links", async () => {
  const h = createTaskModeHarness({
    taskContent: "- [*] #task Ship it ^ship",
    dailyContent: UNLINKED_DAILY,
  });
  await h.plugin.openPomodoroTaskLink(h.editor, h.view);
  assert.equal(h.plugin.pickerRequests.length, 1);
  assert.match(lastNotice(), /Linked/);
  assert.ok(h.writes.length > 0);
});
