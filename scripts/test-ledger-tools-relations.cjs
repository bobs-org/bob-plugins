const test = require("node:test");
const assert = require("node:assert/strict");
const { helpers } = require("./ledger-tools-harness.cjs");
const vectors = require("./relation-line-vectors.cjs");

test("ledger LK1–LK19 recognises relation shapes and keeps them out of plan links", () => {
  for (const vector of vectors.managed) {
    const line = vectors.asLine(vector.line);
    assert.equal(helpers.isTaskRelationLine(line), true, `${vector.id}: ${line}`);
    assert.deepEqual(helpers.planBlockLinks(line, "2026/20261020.md"), [], `${vector.id}: budget exclusion`);
  }
  for (const vector of vectors.notRelation) {
    assert.equal(helpers.isTaskRelationLine(vector.line), false, `${vector.id}: ${vector.line}`);
  }
  assert.equal(helpers.isTaskRelationLine(vectors.contextual, { inFence: true }), false); // LK15
  assert.equal(helpers.isTaskRelationLine(vectors.contextual, { isDirectChildOfTask: false }), false); // LK15
  assert.equal(helpers.isTaskRelationLine(vectors.dependency), false); // LK19
  assert.equal(helpers.isTaskRelationLine(vectors.blocks), false); // LK19
  assert.equal(helpers.parseDependencyLine("  - 🪢 **LINKS:** [[#^a]]").verdict, "not-a-line"); // LK19
  assert.equal(helpers.parseBlocksLine("  - 🪢 **LINKS:** [[#^a]]").verdict, "not-a-line"); // LK19
});
