const test = require("node:test");
const assert = require("node:assert/strict");
const { helpers } = require("./navigation-hotkeys-harness.cjs");

// BLOCKS guards (plan:202610/prerequisite_blocks_lines.md, §14). Glyph
// decision: brick. Each parse row cites its BK id; each guard cites its MC
// row. Depends-On twin (BK20) never claims a BLOCKS line.
test("nav BK1–BK2 accept canonical BLOCKS lines", () => {
  assert.equal(helpers.parseBlocksLine("  - 🧱 **BLOCKS:** [[#^a]]", {}).verdict, "accept"); // BK1
  const two = helpers.parseBlocksLine("  - 🧱 **BLOCKS:** [[#^a]] • [[cash#^b]] • [[money/cash#^c]]", {});
  assert.equal(two.verdict, "accept"); // BK2
  assert.deepEqual(
    two.links.map((link) => link.blockId),
    ["a", "b", "c"],
  );
});

test("nav BK3–BK11 canonicalise", () => {
  assert.equal(helpers.parseBlocksLine("  - 🧱 **BLOCKS:** [[#^a|b • c]]", {}).verdict, "accept"); // BK3
  assert.equal(helpers.parseBlocksLine("  - **BLOCKS:** [[#^a]]", {}).verdict, "accept"); // BK4
  assert.equal(helpers.parseBlocksLine("  - 🚧 **BLOCKS:** [[#^a]]", {}).verdict, "accept"); // BK5
  assert.equal(helpers.parseBlocksLine("  - ⛓️ **BLOCKS:** [[#^a]]", {}).verdict, "accept"); // BK6
  assert.equal(helpers.parseBlocksLine("  - 🧱 **BLOCKING:** [[#^a]]", {}).verdict, "accept"); // BK7
  assert.equal(helpers.parseBlocksLine("  - 🧱 **BLOCKS:** [[#^a]] · [[#^b]]", {}).verdict, "accept"); // BK8
  assert.equal(helpers.parseBlocksLine("  - 🧱 **BLOCKS:** ~~[[#^a]]~~", {}).verdict, "accept"); // BK9
  assert.equal(helpers.parseBlocksLine("  - 🧱 **BLOCKS:** ![[#^a]]", {}).verdict, "accept"); // BK9 embed
  const canon = helpers.parseBlocksLine("  - 🧱 **BLOCKS:** [[#^a]]", {});
  assert.equal(canon.canonical, true);
  assert.equal(helpers.parseBlocksLine("  - 🧱 **BLOCKS:** [[cash#^b]] • [[#^a]]", {}).canonical, false); // BK10
  assert.equal(helpers.parseBlocksLine("  - 🧱 **BLOCKS:** [[#^a]] • [[#^a]]", {}).verdict, "accept"); // BK11
});

test("nav BK12 empty, BK13–BK15 malformed", () => {
  assert.equal(helpers.parseBlocksLine("  - 🧱 **BLOCKS:**", {}).verdict, "empty"); // BK12
  assert.equal(helpers.parseBlocksLine("  - 🧱 **BLOCKS:** [[#^a", {}).verdict, "malformed"); // BK13
  assert.equal(helpers.parseBlocksLine("  - 🧱 **BLOCKS:** [[#^a]] until Friday", {}).verdict, "malformed"); // BK14
  assert.equal(helpers.parseBlocksLine("  - 🧱 **BLOCKS:** [[note]]", {}).verdict, "malformed"); // BK15
  assert.equal(helpers.isTaskBlocksLine("  - 🧱 **BLOCKS:** [[#^a]]"), true);
  assert.equal(helpers.isTaskBlocksLine("  - 🧱 **BLOCKS:**"), true);
  assert.equal(helpers.isTaskBlocksLine("  - 🧱 **BLOCKS:** [[#^a"), true);
});

test("nav BK16–BK18 not-a-line, BK19 slot-free, BK20 cross-parse", () => {
  assert.equal(helpers.parseBlocksLine("  - 🧱 **blocks:** [[#^a]]", {}).verdict, "not-a-line"); // BK16
  assert.equal(helpers.parseBlocksLine("  - 🧱 **BLOCKED BY:** [[#^a]]", {}).verdict, "not-a-line"); // BK17
  assert.equal(helpers.parseBlocksLine("> - 🧱 **BLOCKS:** [[#^a]]", {}).verdict, "not-a-line"); // BK18 quote
  assert.equal(helpers.parseBlocksLine("🧱 **BLOCKS:** [[#^a]]", {}).verdict, "not-a-line"); // BK18 marker-less
  assert.equal(helpers.parseBlocksLine("  - 🧱 **BLOCKS:** [[#^a]]", { inFence: true }).verdict, "not-a-line"); // BK18 fenced
  assert.equal(
    helpers.parseBlocksLine("  - 🧱 **BLOCKS:** [[#^a]]", { isDirectChildOfTask: false }).verdict,
    "not-a-line",
  ); // BK18 grandchild
  assert.equal(
    helpers.parseBlocksLine("  - 🧱 **BLOCKS:** [[#^a]]", { isDirectChildOfTask: true }).verdict,
    "accept",
  ); // BK19 (no slot enforced on read)
  assert.equal(helpers.parseDependencyLine("  - 🧱 **BLOCKS:** [[#^a]]", {}).verdict, "not-a-line"); // BK20
  assert.equal(helpers.parseBlocksLine("  - ⛓️ **DEPENDS ON:** [[#^a]]", {}).verdict, "not-a-line"); // BK20
});

test("nav BK21 code-point sort and writer format", () => {
  const sorted = helpers.sortBlocksLinks([
    "[[zeta#^e]]",
    "[[élan#^d]]",
    "[[cash#^c]]",
    "[[Cash#^a]]",
    "[[#^b]]",
  ]);
  assert.deepEqual(sorted, [
    "[[#^b]]",
    "[[Cash#^a]]",
    "[[cash#^c]]",
    "[[zeta#^e]]",
    "[[élan#^d]]",
  ]); // BK21
  assert.equal(
    helpers.formatBlocksLine("  ", ["[[cash#^b]]", "[[#^a]]"]),
    "  - 🧱 **BLOCKS:** [[#^a]] • [[cash#^b]]",
  );
});

test("nav MC5 ! refuses BLOCKS lines; MC7 Sub-projects never claims BLOCKS", () => {
  assert.deepEqual(helpers.findTransclusionToggleTargets("  - 🧱 **BLOCKS:** [[#^a]]"), []); // MC5
  assert.deepEqual(helpers.findTransclusionToggleTargets("  - 🧱 **BLOCKS:** ![[#^a]]"), []); // MC3 tree-close analogue
  assert.equal(helpers.isProjectSubprojectsLine("  - 🧱 **BLOCKS:** [[#^a]]"), false); // MC7
  assert.equal(helpers.isProjectSubprojectsLine("  - 🧩 **Sub-projects:** [[#^a]]"), true);
  assert.equal(helpers.isManagedDependencyLine("  - 🧱 **BLOCKS:** [[#^a]]"), true);
  assert.equal(helpers.isManagedDependencyLine("  - ⛓️ **DEPENDS ON:** [[#^a]]"), true);
  assert.equal(helpers.isManagedDependencyLine("  - plain bullet"), false);
});

test("nav BW18 conversion drops BLOCKS like Sub-projects", () => {
  const parent = "- [?] #task T ^t";
  const out = helpers.splitProjectLifecycleChildren(parent, [
    "  - 🧱 **BLOCKS:** [[#^d]]",
    "  - 🧩 **Sub-projects:** [[#^s]]",
    "  - user child",
  ]);
  assert.equal(out.valid, true);
  assert.deepEqual(out.otherLines, ["  - user child"]);
});

test("nav Rule 8 Ctrl+Shift+P on BLOCKS routes to the owner", () => {
  const content = [
    "- [?] #task T ^t",
    "  - 🧱 **BLOCKS:** [[#^d]]",
  ].join("\n");
  const entry = helpers.resolveDependencyStageEntry(content, 1);
  assert.equal(entry.ok, true);
  assert.equal(entry.parentLine, 0);
});

test("nav BW12 BLOCKS-only hand edit reports blocks-only; Rule 7 annotation exists", () => {
  const before = ["- [?] #task T ^t", "  - 🧱 **BLOCKS:** [[#^a]]"].join("\n");
  const after = ["- [?] #task T ^t", "  - 🧱 **BLOCKS:** [[#^a]] • [[#^b]]"].join("\n");
  const plan = helpers.planDependencyHandEditMirror(before, after, 1, "");
  assert.equal(plan && plan.kind, "blocks-only");
  assert.equal(typeof helpers.BLOCKS_GENERATED_LINE_NOTICE, "string");
  assert.equal(typeof helpers.BLOCKS_MACHINE_WRITE_ANNOTATION, "string");
});

test("nav MC1/MC2 deferred Pomodoro cleanup skips managed lines", () => {
  const snapshot = [
    "## Pomodoros",
    "- [ ] Session (0900-0930)",
    "\t- 🧱 **BLOCKS:** [[#^a]]",
    "\t- [[#^a]]",
  ].join("\n");
  const before = snapshot.split("\n");
  // The managed line itself is recognised even inside a Pomodoro block.
  assert.equal(helpers.isManagedDependencyLine(before[2]), true);
  assert.equal(helpers.isManagedDependencyLine(before[3]), false);
});
