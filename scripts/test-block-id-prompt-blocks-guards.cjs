const test = require("node:test");
const assert = require("node:assert/strict");
const { helpers } = require("./block-id-prompt-harness.cjs");

// BLOCKS guards for block-id-prompt (plan:202610/prerequisite_blocks_lines.md
// §14). Glyph decision: brick. Each row cites its BK/MC id.
test("bip BK1–BK12 accept and empty", () => {
  assert.equal(helpers.isTaskBlocksLine("  - 🧱 **BLOCKS:** [[#^a]]"), true); // BK1
  assert.equal(helpers.isTaskBlocksLine("  - 🧱 **BLOCKS:** [[#^a]] • [[cash#^b]]"), true); // BK2
  assert.equal(helpers.isTaskBlocksLine("  - **BLOCKS:** [[#^a]]"), true); // BK4
  assert.equal(helpers.isTaskBlocksLine("  - 🚧 **BLOCKS:** [[#^a]]"), true); // BK5
  assert.equal(helpers.isTaskBlocksLine("  - ⛓️ **BLOCKS:** [[#^a]]"), true); // BK6
  assert.equal(helpers.isTaskBlocksLine("  - 🧱 **BLOCKING:** [[#^a]]"), true); // BK7
  assert.equal(helpers.isTaskBlocksLine("  - 🧱 **BLOCKS:** [[#^a]] · [[#^b]]"), true); // BK8
  assert.equal(helpers.isTaskBlocksLine("  - 🧱 **BLOCKS:**"), true); // BK12 empty
  assert.equal(helpers.isTaskBlocksLine("  - ⛓️ **DEPENDS ON:** [[#^a]]"), false); // BK20
  assert.equal(helpers.isTaskDependencyLine("  - 🧱 **BLOCKS:** [[#^a]]"), false); // BK20
});

test("bip BK13–BK15 malformed split mirrors the Depends-On twin", () => {
  assert.equal(helpers.isTaskBlocksLine("  - 🧱 **BLOCKS:** [[#^a"), false); // BK13 -> malformed twin
  assert.equal(helpers.isMalformedTaskBlocksLine("  - 🧱 **BLOCKS:** [[#^a"), true);
  assert.equal(helpers.isTaskBlocksLine("  - 🧱 **BLOCKS:** [[#^a]] until Friday"), false); // BK14
  assert.equal(helpers.isMalformedTaskBlocksLine("  - 🧱 **BLOCKS:** [[#^a]] until Friday"), true);
  assert.equal(helpers.isTaskBlocksLine("  - 🧱 **blocks:** [[#^a]]"), false); // BK16
  assert.equal(helpers.isMalformedTaskBlocksLine("  - 🧱 **blocks:** [[#^a]]"), false);
  assert.equal(helpers.isTaskBlocksLine("  - 🧱 **BLOCKED BY:** [[#^a]]"), false); // BK17
  assert.equal(helpers.isManagedDependencyLine("  - 🧱 **BLOCKS:** [[#^a]]"), true); // MC1/MC2
  assert.equal(helpers.isManagedDependencyLine("  - 🧱 **BLOCKS:** [[#^a"), true);
  assert.equal(helpers.isManagedDependencyLine("  - plain"), false);
});

test("bip MC5 Ctrl+Shift+Enter refuses BLOCKS with the generated notice", () => {
  assert.equal(typeof helpers.TASK_BLOCKS_LINE_NOTICE, "string");
  assert.match(helpers.TASK_BLOCKS_LINE_NOTICE, /BLOCKS is generated/);
});

test("bip MC1/MC2 Pomodoro scanners skip managed lines", () => {
  const lines = ["- [ ] P (0900-0930)", "  - 🧱 **BLOCKS:** [[#^d]]"];
  assert.deepEqual(helpers.collectPomodoroEntryBlockLinks(lines, 1, 1), []);
  const content = lines.join("\n");
  const plan = helpers.planPomodoroLinkCleanupForRanges(
    content,
    [{ startLine: 0, endLine: 1 }],
    {
      targetPath: "n.md",
      targetBlockId: "d",
      resolveTarget: () => "n.md",
      sourcePath: "n.md",
    },
  );
  assert.equal(plan.removedCount, 0);
  assert.deepEqual(plan.edits, []);
});
