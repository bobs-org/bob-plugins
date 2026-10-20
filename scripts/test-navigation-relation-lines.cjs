const test = require("node:test");
const assert = require("node:assert/strict");
const { helpers, NavigationHotkeysPlugin, notices } = require("./navigation-hotkeys-harness.cjs");
const vectors = require("./relation-line-vectors.cjs");

test("nav LK1–LK18 parse relation grammar and reject the other relation parser", () => {
  for (const vector of vectors.managed) {
    const parser = vector.direction === "outgoing" ? helpers.parseLinksLine : helpers.parseLinkedFromLine;
    const other = vector.direction === "outgoing" ? helpers.parseLinkedFromLine : helpers.parseLinksLine;
    const line = vectors.asLine(vector.line);
    const parsed = parser(line);
    assert.equal(parsed.verdict, vector.verdict, `${vector.id}: ${line}`);
    assert.equal(other(line).verdict, "not-a-line", `${vector.id}: cross parser`);
    assert.equal(helpers.isTaskRelationLine(line), true, `${vector.id}: relation guard`);
  }
  assert.equal(helpers.parseLinksLine(vectors.asLine(vectors.managed.find((entry) => entry.id === "LK8").line)).entries.length, 1); // LK8 first duplicate wins
  assert.equal(helpers.parseLinksLine("- 🪢 **LINKS:** see:   also [[#^a]]").entries[0].label, "see: also"); // LK9
});

test("nav LK14–LK19 context and cross-parse rules", () => {
  for (const vector of vectors.notRelation) {
    assert.equal(helpers.isTaskRelationLine(vector.line), false, `${vector.id}: ${vector.line}`);
  }
  assert.equal(helpers.parseLinksLine(vectors.contextual, { inFence: true }).verdict, "not-a-line"); // LK15 fenced
  assert.equal(helpers.parseLinksLine(vectors.contextual, { isDirectChildOfTask: false }).verdict, "not-a-line"); // LK15 grandchild
  assert.equal(helpers.isTaskRelationLine("🪢 **LINKS:** [[#^a]]"), false); // LK15 marker-less
  assert.equal(helpers.parseLinksLine(vectors.dependency).verdict, "not-a-line"); // LK19
  assert.equal(helpers.parseLinkedFromLine(vectors.dependency).verdict, "not-a-line"); // LK19
  assert.equal(helpers.parseLinksLine(vectors.blocks).verdict, "not-a-line"); // LK19
  assert.equal(helpers.parseLinkedFromLine(vectors.blocks).verdict, "not-a-line"); // LK19
  assert.equal(helpers.parseDependencyLine("  - 🪢 **LINKS:** [[#^a]]").verdict, "not-a-line"); // LK19
  assert.equal(helpers.parseBlocksLine("  - 🪢 **LINKS:** [[#^a]]").verdict, "not-a-line"); // LK19
  assert.equal(helpers.normalizeRelationLabel("  follow-up:  "), "follow-up");
  assert.equal(helpers.normalizeRelationLabel("too | wide"), null);
});

test("nav MC5 refuses relation embeds and MC16 keeps LINKS while dropping LINKED FROM", () => {
  assert.deepEqual(helpers.findTransclusionToggleTargets("  - 🪢 **LINKS:** ![[#^a]]"), []); // MC5
  assert.deepEqual(helpers.findTransclusionToggleTargets("  - 🪢 **LINKED FROM:** ![[#^a]]"), []); // MC5
  const split = helpers.splitProjectLifecycleChildren("- [?] #task T ^prj", [
    "  - 🪢 **LINKS:** follow-up of [[#^a]]",
    "    - nested user note",
    "  - 🪢 **LINKED FROM:** [[#^b]]",
    "    - generated detail",
    "  - user child",
  ]);
  assert.equal(split.valid, true);
  assert.deepEqual(split.otherLines, [
    "  - 🪢 **LINKS:** follow-up of [[#^a]]",
    "    - nested user note",
    "  - user child",
  ]);
  assert.equal(helpers.TASK_LINKED_FROM_LINE_NOTICE, "🪢 LINKED FROM is generated from other tasks' LINKS lines · change it with Ctrl+Shift+Alt+L");
});

test("nav MC15 hands LINKS edits to the relation mirror and notices generated lines once", async () => {
  const before = [
    "- [ ] #task T [dependsOn:: n__d] ^t",
    "  - ⛓️ **DEPENDS ON:** [[#^d]]",
  ].join("\n");
  for (const [row, expectedNotice] of [
    ["  - 🪢 **LINKS:** follow-up of [[#^d]]", false],
    ["  - 🪢 **LINKED FROM:** [[#^d]]", true],
  ]) {
    notices.length = 0;
    const after = `${before}\n${row}`;
    let dependencyWrites = 0;
    let relationWrites = 0;
    const plugin = Object.create(NavigationHotkeysPlugin.prototype);
    plugin.applyDependencyEdit = async () => {
      dependencyWrites += 1;
      return { ok: true };
    };
    plugin.mirrorRelationHandEdit = async () => {
      relationWrites += 1;
      return { mirrored: true, reason: "relation-edit" };
    };
    const result = await plugin.mirrorDependencyHandEdit(
      { getValue: () => after },
      "n.md",
      before,
      0,
      "",
      { baselineLine: 1 },
    );
    assert.equal(result.reason, expectedNotice ? "relation-only" : "relation-edit");
    assert.equal(dependencyWrites, 0);
    assert.equal(relationWrites, expectedNotice ? 0 : 1);
    assert.equal(notices.length, expectedNotice ? 1 : 0);
    if (expectedNotice) assert.equal(notices[0], helpers.TASK_LINKED_FROM_LINE_NOTICE);
  }
});
