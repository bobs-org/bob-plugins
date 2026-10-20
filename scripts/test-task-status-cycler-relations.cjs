const test = require("node:test");
const assert = require("node:assert/strict");
const { helpers } = require("./task-status-cycler-harness.cjs");
const vectors = require("./relation-line-vectors.cjs");

test("cycler LK1–LK19 recognises only relation line shapes", () => {
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

test("cycler MC10, MC11, MC12 and MC14 keep relations inert while allowing root-only gestures", () => {
  const line = "  - 🪢 **LINKS:** ![[#^d]]";
  assert.equal(helpers.isTaskLinkExclusionLine(line), true); // MC10
  assert.equal(helpers.isTaskLinkGestureLine(line), true); // MC14
  assert.equal(helpers.getPlainBulletFormatToggle(line, 1), null); // no reformat
  const source = ["- [ ] #task T ^t", line].join("\n");
  assert.deepEqual(helpers.collectEmbeddedTranscludedTaskTargetsInListItemBlock(source, 0), []); // MC11
  const retired = helpers.retireClosedTaskReferencesInText(source, "n.md", [{ path: "n.md", blockId: "d" }], () => ({ path: "n.md" }));
  assert.equal(retired.text, source); // MC12
  assert.equal(helpers.parseSuccessorLiveLink("  - 🪢 **LINKED FROM:** [[#^d]]"), null); // MC10
  const pomodoro = ["- [ ] P (0900-0930)", "\t- 🪢 **LINKS:** [[#^d]]"];
  const classified = helpers.classifyPomodoroSubBullets(pomodoro, { startLine: 1, endLine: 2 });
  assert.equal(classified.copyableTaskLinkBullets.length, 0); // MC10
  assert.equal(classified.transcludedTaskLinkBullets.length, 0); // MC10
});
