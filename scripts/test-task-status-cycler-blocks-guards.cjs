const test = require("node:test");
const assert = require("node:assert/strict");
const { helpers } = require("./task-status-cycler-harness.cjs");

// BLOCKS guards for task-status-cycler (plan:202610/prerequisite_blocks_lines.md
// §14). Glyph decision: brick. Each row cites its BK/MC id.
test("cycler BK1–BK12 accept and empty", () => {
  assert.equal(helpers.isTaskBlocksLine("  - 🧱 **BLOCKS:** [[#^a]]"), true); // BK1
  assert.equal(helpers.isTaskBlocksLine("  - 🧱 **BLOCKS:** [[#^a]] • [[cash#^b]]"), true); // BK2
  assert.equal(helpers.isTaskBlocksLine("  - 🧱 **BLOCKS:** [[#^a|b • c]]"), true); // BK3
  assert.equal(helpers.isTaskBlocksLine("  - **BLOCKS:** [[#^a]]"), true); // BK4
  assert.equal(helpers.isTaskBlocksLine("  - 🚧 **BLOCKS:** [[#^a]]"), true); // BK5
  assert.equal(helpers.isTaskBlocksLine("  - ⛓️ **BLOCKS:** [[#^a]]"), true); // BK6
  assert.equal(helpers.isTaskBlocksLine("  - 🧱 **BLOCKING:** [[#^a]]"), true); // BK7
  assert.equal(helpers.isTaskBlocksLine("  - 🧱 **BLOCKS:** [[#^a]] · [[#^b]]"), true); // BK8
  assert.equal(helpers.isTaskBlocksLine("  - 🧱 **BLOCKS:** ~~[[#^a]]~~"), true); // BK9
  assert.equal(helpers.isTaskBlocksLine("  - 🧱 **BLOCKS:** ![[#^a]]"), true); // BK9 embed
  assert.equal(helpers.isTaskBlocksLine("  - 🧱 **BLOCKS:** [[cash#^b]] • [[#^a]]"), true); // BK10
  assert.equal(helpers.isTaskBlocksLine("  - 🧱 **BLOCKS:** [[#^a]] • [[#^a]]"), true); // BK11
  assert.equal(helpers.isTaskBlocksLine("  - 🧱 **BLOCKS:**"), true); // BK12 empty
});

test("cycler BK13–BK15 malformed stay guarded, BK16–BK18 unguarded", () => {
  assert.equal(helpers.isTaskBlocksLine("  - 🧱 **BLOCKS:** [[#^a"), true); // BK13
  assert.equal(helpers.isTaskBlocksLine("  - 🧱 **BLOCKS:** [[#^a]] until Friday"), true); // BK14
  assert.equal(helpers.isTaskBlocksLine("  - 🧱 **BLOCKS:** [[note]]"), true); // BK15
  assert.equal(helpers.isTaskBlocksLine("  - 🧱 **blocks:** [[#^a]]"), false); // BK16
  assert.equal(helpers.isTaskBlocksLine("  - 🧱 **BLOCKED BY:** [[#^a]]"), false); // BK17
  assert.equal(helpers.isTaskBlocksLine("> - 🧱 **BLOCKS:** [[#^a]]"), false); // BK18 quote
  assert.equal(helpers.isTaskBlocksLine("🧱 **BLOCKS:** [[#^a]]"), false); // BK18 marker-less
  assert.equal(helpers.isTaskBlocksLine("  - ⛓️ **DEPENDS ON:** [[#^a]]"), false); // BK20
  assert.equal(helpers.isTaskDependencyLine("  - 🧱 **BLOCKS:** [[#^a]]"), false); // BK20
  assert.equal(helpers.isManagedDependencyLine("  - 🧱 **BLOCKS:** [[#^a]]"), true); // MC1/MC2
  assert.equal(helpers.isManagedDependencyLine("  - plain"), false);
});

test("cycler MC4 strike/restore skip BLOCKS lines", () => {
  const source = [
    "- [ ] #task T ^t",
    "  - 🧱 **BLOCKS:** ![[#^d]]",
  ].join("\n");
  const retired = helpers.retireClosedTaskReferencesInText(
    source,
    "n.md",
    [{ path: "n.md", blockId: "d" }],
    () => ({ path: "n.md" }),
  );
  assert.equal(retired.text, source);
  const struck = [
    "- [ ] #task T ^t",
    "  - 🧱 **BLOCKS:** ~~[[#^d]]~~",
  ].join("\n");
  const restored = helpers.restoreReopenedTaskReferencesInText(
    struck,
    "n.md",
    [{ path: "n.md", blockId: "d" }],
    () => ({ path: "n.md" }),
  );
  assert.equal(restored.text, struck);
});

test("cycler MC3 tree close skips BLOCKS embeds", () => {
  const source = [
    "- [ ] #task T ^t",
    "  - 🧱 **BLOCKS:** ![[#^d]]",
  ].join("\n");
  assert.deepEqual(
    helpers.collectEmbeddedTranscludedTaskTargetsInListItemBlock(source, 0),
    [],
  );
});

test("cycler MC1/MC2 Pomodoro and successor scanners skip managed lines", () => {
  assert.equal(helpers.parseSuccessorLiveLink("  - 🧱 **BLOCKS:** [[#^d]]"), null); // MC1
  assert.equal(helpers.parseSuccessorLiveLink("  - ⛓️ **DEPENDS ON:** [[#^d]]"), null); // MC2
  const lines = ["- [ ] P (0900-0930)", "\t- 🧱 **BLOCKS:** [[#^d]]"];
  const classified = helpers.classifyPomodoroSubBullets(lines, { startLine: 1, endLine: 2 });
  assert.equal(classified.copyableTaskLinkBullets.length, 0);
  assert.equal(classified.transcludedTaskLinkBullets.length, 0);
  assert.equal(classified.noteBullets.length, 1);
});

test("cycler Rule 8 Ctrl+Enter is root-only and Alt+]/Alt+[ never reformat BLOCKS", () => {
  assert.equal(helpers.getPlainBulletFormatToggle("  - 🧱 **BLOCKS:** [[#^a]]", 1), null);
  // isActiveTaskDependencyLine / getActiveTaskDependencyLinkTarget are plugin
  // methods over isManagedDependencyLine (Rule 8): the shape gate is covered
  // here, the method wiring by the picker tests.
  assert.equal(helpers.isManagedDependencyLine("  - 🧱 **BLOCKS:** [[#^a]]"), true);
});
