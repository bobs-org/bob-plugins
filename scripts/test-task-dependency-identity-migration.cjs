const assert = require("node:assert/strict");
const test = require("node:test");

test("identity migration resolves links, refuses ambiguity, and is idempotent", async () => {
  const { planMigration } = await import("./migrate-task-dependency-identities.mjs");
  const files = [
    {
      relativePath: "Parent.md",
      content: [
        "- [ ] #task Parent [dependsOn:: review, local] ^parent",
        "  - ![[projects/Shared#^review]]",
        "  - ![[#^local]]",
        "- [ ] #task Local [id:: local] ^local",
      ].join("\n"),
    },
    {
      relativePath: "projects/Shared.md",
      content: "- [ ] #task Review [id:: review] ^review",
    },
  ];
  const first = planMigration(files);
  assert.equal(first.ambiguous.length, 0);
  assert.equal(first.unresolved.length, 0);
  assert.equal(first.encodingCollisions.length, 0);
  assert.equal(first.targetUpdates, 2);
  const parent = first.files.find((file) => file.relativePath === "Parent.md");
  assert.match(parent.nextContent, /\[dependsOn:: projects__Shared__review, Parent__local\]/);
  assert.match(parent.nextContent, /\[id:: Parent__local\] \^local/);
  assert.match(parent.nextContent, /!\[\[projects\/Shared#\^review\]\]/);
  const shared = first.files.find((file) => file.relativePath === "projects/Shared.md");
  assert.match(shared.nextContent, /\[id:: projects__Shared__review\] \^review/);

  const second = planMigration(first.files.map((file) => ({
    relativePath: file.relativePath,
    content: file.nextContent,
  })));
  assert.equal(second.files.filter((file) => file.changed).length, 0);
});

test("identity migration detects path-encoding and legacy-ID ambiguity", async () => {
  const { planMigration } = await import("./migrate-task-dependency-identities.mjs");
  const collision = planMigration([
    { relativePath: "a/b.md", content: "- [ ] #task One ^review" },
    { relativePath: "a__b.md", content: "- [ ] #task Two ^review" },
  ]);
  assert.equal(collision.encodingCollisions.length, 1);

  const ambiguous = planMigration([
    { relativePath: "Parent.md", content: "- [ ] #task Parent [dependsOn:: old]" },
    { relativePath: "A.md", content: "- [ ] #task A [id:: old] ^a" },
    { relativePath: "B.md", content: "- [ ] #task B [id:: old] ^b" },
  ]);
  assert.equal(ambiguous.ambiguous.length, 1);
});

test("identity migration gives uniquely resolved legacy targets a block ID", async () => {
  const { planMigration } = await import("./migrate-task-dependency-identities.mjs");
  const plan = planMigration([
    {
      relativePath: "Legacy.md",
      content: [
        "- [ ] #task Parent [dependsOn:: launch-hitl]",
        "- [ ] #task Target [id:: launch-hitl]",
      ].join("\n"),
    },
  ]);
  assert.equal(plan.unresolved.length, 0);
  assert.equal(
    plan.files[0].nextContent,
    [
      "- [ ] #task Parent [dependsOn:: Legacy__launch-hitl]",
      "\t- ![[#^launch-hitl]]",
      "- [ ] #task Target [id:: Legacy__launch-hitl] ^launch-hitl",
    ].join("\n"),
  );
});

test("identity migration ignores fenced examples and preserves mixed line endings", async () => {
  const { planMigration } = await import("./migrate-task-dependency-identities.mjs");
  const fenced = [
    "```md\r\n",
    "- [ ] #task Example [id:: abc123] ^example\n",
    "- [ ] #task Example parent [dependsOn:: abc123]\r\n",
    "```\n",
  ].join("");
  const plan = planMigration([
    {
      relativePath: "Tasks.md",
      content:
        fenced +
        "- [ ] #task Parent [dependsOn:: real]\r\n" +
        "- [ ] #task Real [id:: real] ^real\n",
    },
  ]);
  assert.equal(plan.unsupported.length, 0);
  assert.equal(plan.unresolved.length, 0);
  assert.ok(plan.files[0].nextContent.startsWith(fenced));
  assert.match(plan.files[0].nextContent, /\[dependsOn:: Tasks__real\]\r\n/);
  assert.match(plan.files[0].nextContent, /\[id:: Tasks__real\] \^real\n$/);
});

test("identity migration reports positional link-order fallbacks distinctly", async () => {
  const { planMigration } = await import("./migrate-task-dependency-identities.mjs");
  const plan = planMigration([
    {
      relativePath: "Parent.md",
      content: [
        "- [ ] #task Parent [dependsOn:: unmatched]",
        "  - ![[Target#^target]]",
      ].join("\n"),
    },
    {
      relativePath: "Target.md",
      content: "- [ ] #task Target [id:: different] ^target",
    },
  ]);
  assert.equal(plan.positionalFallbacks.length, 1);
  assert.deepEqual(
    {
      filePath: plan.positionalFallbacks[0].filePath,
      line: plan.positionalFallbacks[0].line,
      id: plan.positionalFallbacks[0].id,
      target: `${plan.positionalFallbacks[0].task.filePath}#^${plan.positionalFallbacks[0].task.blockId}`,
    },
    {
      filePath: "Parent.md",
      line: 1,
      id: "unmatched",
      target: "Target.md#^target",
    },
  );
});
