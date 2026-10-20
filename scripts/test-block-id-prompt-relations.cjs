const test = require("node:test");
const assert = require("node:assert/strict");
const { helpers, createTaskLinkHarness, noticeMessages, resetNotices } = require("./block-id-prompt-harness.cjs");
const vectors = require("./relation-line-vectors.cjs");

test("block-id-prompt LK1–LK19 recognises only relation line shapes", () => {
  for (const vector of vectors.managed) {
    assert.equal(helpers.isTaskRelationLine(vectors.asLine(vector.line)), true, `${vector.id}: ${vector.line}`);
  }
  for (const vector of vectors.notRelation) {
    assert.equal(helpers.isTaskRelationLine(vector.line), false, `${vector.id}: ${vector.line}`);
  }
  assert.equal(helpers.isTaskRelationLine(vectors.contextual, { inFence: true }), false); // LK15
  assert.equal(helpers.isTaskRelationLine(vectors.contextual, { isDirectChildOfTask: false }), false); // LK15
  assert.equal(helpers.isTaskRelationLine(vectors.dependency), false); // LK19
  assert.equal(helpers.isTaskRelationLine(vectors.blocks), false); // LK19
  assert.equal(helpers.isTaskDependencyLine("  - 🪢 **LINKS:** [[#^a]]"), false); // LK19
  assert.equal(helpers.isTaskBlocksLine("  - 🪢 **LINKS:** [[#^a]]"), false); // LK19
});

test("block-id-prompt MC10 skips relations in Pomodoro cleanup and MC13 refuses both relation gestures", () => {
  const lines = ["- [ ] P (0900-0930)", "  - 🪢 **LINKS:** [[#^d]]"];
  assert.equal(helpers.isTaskLinkExclusionLine(lines[1]), true);
  assert.deepEqual(helpers.collectPomodoroEntryBlockLinks(lines, 0, 1), []); // MC10
  assert.equal(helpers.TASK_LINKS_LINE_NOTICE, "🪢 LINKS entries are relations, not Task Links · edit them with Ctrl+Shift+L"); // MC13
  assert.equal(helpers.TASK_LINKED_FROM_LINE_NOTICE, "🪢 LINKED FROM is generated from other tasks' LINKS lines · change it with Ctrl+Shift+Alt+L"); // MC13
  assert.equal(helpers.taskRelationLineNotice("  - 🪢 **LINKED FROM:** [[#^t]]"), helpers.TASK_LINKED_FROM_LINE_NOTICE);
});

test("block-id-prompt MC13 refuses Ctrl+Shift+Enter on either relation line", async () => {
  for (const [line, expected] of [
    ["  - 🪢 **LINKS:** [[Tasks#^ship]]", helpers.TASK_LINKS_LINE_NOTICE],
    ["  - 🪢 **LINKED FROM:** [[Tasks#^ship]]", helpers.TASK_LINKED_FROM_LINE_NOTICE],
  ]) {
    resetNotices();
    const content = `- [ ] #task Owner ^owner\n${line}`;
    const h = createTaskLinkHarness({
      files: { "Notes.md": content, "Tasks.md": "- [ ] #task Target ^ship", "Daily.md": "## Pomodoros" },
      activePath: "Notes.md",
      cursor: { line: 1, ch: line.indexOf("Tasks") + 1 },
    });
    await h.plugin.openPomodoroTaskLink(h.editor, h.view);
    assert.deepEqual(noticeMessages, [expected]);
    assert.equal(h.editor.getValue(), content);
    assert.deepEqual(h.writes, []);
  }
});
