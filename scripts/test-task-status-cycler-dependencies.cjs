const test = require("node:test");
const assert = require("node:assert/strict");
const {
  TaskStatusCyclerPlugin,
  helpers,
  MarkdownView,
  notices,
  createInMemoryObsidianApp,
  createTextEditor,
} = require("./task-status-cycler-harness.cjs");

test("dependency normalizer writes path-qualified IDs and is idempotent", () => {
  const source = [
    "- [ ] #task Parent [dependsOn:: a1b2c3, custom] ^parent",
    "- [ ] #task Existing [id:: a1b2c3] ^review",
    "- [ ] #task Legacy [id:: custom] ^legacy",
  ].join("\n");
  const result = helpers.normalizeTaskDependencyBlockIds(
    source,
    "projects/Shared.md",
  );
  assert.equal(result.changed, true);
  assert.match(result.text, /\[id:: projects__Shared__review\] \^review/);
  assert.match(result.text, /\[id:: projects__Shared__legacy\] \^legacy/);
  assert.match(
    result.text,
    /\[dependsOn:: projects__Shared__review, projects__Shared__legacy\]/,
  );
  assert.equal(
    helpers.normalizeTaskDependencyBlockIds(result.text, "projects/Shared.md").changed,
    false,
  );
});

test("Tasks-generated IDs become local block IDs when none exists", () => {
  const result = helpers.normalizeTaskDependencyBlockIds(
    "- [ ] #task Target [id:: z9y8x7]",
    "Nested/Target.md",
  );
  assert.equal(
    result.text,
    "- [ ] #task Target [id:: Nested__Target__z9y8x7] ^z9y8x7",
  );
  assert.deepEqual(result.idMap, { z9y8x7: "Nested__Target__z9y8x7" });
});

test("note rename rewrites target IDs and yields exact propagation mappings", () => {
  const result = helpers.rewriteRenamedDependencyIds(
    "- [ ] #task Target [id:: Old__Path__review] ^review\n",
    "Old/Path.md",
    "New/Home.md",
  );
  assert.equal(
    result.text,
    "- [ ] #task Target [id:: New__Home__review] ^review\n",
  );
  assert.deepEqual(result.idMap, {
    Old__Path__review: "New__Home__review",
  });
});

test("note rename also rewrites same-file dependsOn references", () => {
  const result = helpers.rewriteRenamedDependencyIds(
    [
      "- [ ] #task Parent [dependsOn:: Old__Path__review] ^parent",
      "- [ ] #task Target [id:: Old__Path__review] ^review",
    ].join("\n"),
    "Old/Path.md",
    "New/Home.md",
  );
  assert.match(result.text, /\[dependsOn:: New__Home__review\]/);
  assert.match(result.text, /\[id:: New__Home__review\] \^review/);
});

test("dependency normalization skips unsupported paths and fenced examples", () => {
  const source = [
    "```md",
    "- [ ] #task Example [id:: abc123] ^example",
    "- [ ] #task Parent [dependsOn:: abc123]",
    "```",
    "- [ ] #task Real [id:: def456] ^real",
  ].join("\n");
  const supported = helpers.normalizeTaskDependencyBlockIds(source, "Tasks.md");
  assert.match(supported.text, /Example \[id:: abc123\] \^example/);
  assert.match(supported.text, /Parent \[dependsOn:: abc123\]/);
  assert.match(supported.text, /Real \[id:: Tasks__real\] \^real/);

  const unsupported = helpers.normalizeTaskDependencyBlockIds(
    "- [ ] #task Real [id:: def456] ^real",
    "Spaced Note.md",
  );
  assert.equal(helpers.dependencyId("Spaced Note.md", "real"), null);
  assert.equal(unsupported.changed, false);
  assert.equal(unsupported.unsupportedPath, true);
});

test("blocked-dependent planner matches the CLI dependency truth table", () => {
  const documents = [
    {
      path: "Targets.md",
      text: [
        "- [x] #task Closed root [id:: root] ^root",
        "- [ ] #task Other open (id:: other) ^other",
        "- [!] #task Unknown target [id:: unknown] ^unknown",
        "```md",
        "- [ ] #task Fenced target [id:: fenced] ^fenced",
        "```",
      ].join("\n"),
    },
    {
      path: "Dependents.md",
      text: [
        "- [?] #task Bracket [dependsOn:: root] ^bracket",
        "- [?] #task Parenthesized (dependsOn:: root) ^paren",
        "- [?] #task Missing is ignored [dependsOn:: root, missing] ^missing",
        "- [?] #task Other remains open [dependsOn:: root, other] ^remaining",
        "- [?] #task Unknown is not open [dependsOn:: root, unknown] ^unknown-parent",
        "- [?] #task Self remains blocked [id:: self] [dependsOn:: root, self] ^self",
        "- [?] #task Cycle A [id:: cycle-a] [dependsOn:: root, cycle-b] ^cycle-a",
        "- [?] #task Cycle B [id:: cycle-b] [dependsOn:: cycle-a] ^cycle-b",
        "- [ ] #task Already active [dependsOn:: root] ^active",
        "- [x] #task Done dependent [dependsOn:: root] ^done",
        "- [-] #task Canceled dependent [dependsOn:: root] ^canceled",
        "- [~] #task Non-task dependent [dependsOn:: root] ^non-task",
        "- [!] #task Unknown dependent [dependsOn:: root] ^unknown-status",
        "- [?] #task No dependencies ^unrelated",
        "```tasks",
        "- [?] #task Fenced dependent [dependsOn:: root] ^fenced-parent",
        "```",
      ].join("\n"),
    },
  ];
  const plan = helpers.buildBlockedDependentRecoveryPlan(
    documents,
    [
      { path: "Targets.md", blockId: "root" },
      { path: "Targets.md", blockId: "root" },
    ],
  );
  assert.deepEqual(plan.closedIds, ["root"]);
  assert.deepEqual(
    plan.edits.map((edit) => edit.sourceLineText.match(/\^([^ ]+)$/)[1]),
    ["bracket", "paren", "missing", "unknown-parent"],
  );

  const duplicateOpen = helpers.buildBlockedDependentRecoveryPlan(
    [
      ...documents,
      {
        path: "Duplicate.md",
        text: "- [ ] #task Open duplicate [id:: root] ^duplicate",
      },
    ],
    [{ path: "Targets.md", blockId: "root" }],
  );
  assert.equal(duplicateOpen.edits.length, 0);

  const absentIdentity = helpers.buildBlockedDependentRecoveryPlan(
    documents,
    [{ path: "Targets.md", blockId: "absent" }],
  );
  assert.equal(absentIdentity.edits.length, 0);
});

test("blocked-dependent edits preserve EOLs and skip stale lines idempotently", () => {
  const source = [
    "- [?] #task First [dependsOn:: root] ^first",
    "- [?] #task Second (dependsOn:: root) ^second",
  ].join("\r\n");
  const plan = helpers.buildBlockedDependentRecoveryPlan(
    [{ path: "Tasks.md", text: source }],
    [{ path: "Closed.md", taskId: "root" }],
  );
  const staleSource = source.replace("Second", "Second changed");
  const applied = helpers.applyBlockedDependentRecoveryEdits(
    staleSource,
    plan.edits,
  );
  assert.equal(applied.reopened, 1);
  assert.equal(applied.stale.length, 1);
  assert.match(applied.text, /^- \[ \] #task First/m);
  assert.match(applied.text, /^- \[\?\] #task Second changed/m);
  assert.equal(applied.text.includes("\r\n"), true);
  const second = helpers.applyBlockedDependentRecoveryEdits(
    applied.text,
    plan.edits,
  );
  assert.equal(second.reopened, 0);
  assert.equal(second.text, applied.text);
});

test("normalization mappings propagate to every dependent file", async () => {
  const harness = createInMemoryObsidianApp({
    "Target.md": "- [ ] #task Target [id:: old] ^review",
    "A.md": "- [ ] #task A [dependsOn:: old]",
    "B.md": "- [ ] #task B [dependsOn:: old, keep]",
  });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  await plugin.propagateDependencyBlockIds(
    { old: "Target__review" },
    { path: "Target.md" },
  );
  assert.match(harness.getSource("A.md"), /\[dependsOn:: Target__review\]/);
  assert.match(
    harness.getSource("B.md"),
    /\[dependsOn:: Target__review, keep\]/,
  );
});

test("runtime normalizer skips unsupported paths with one informative notice", async () => {
  notices.length = 0;
  const source = "- [ ] #task Target [id:: abc123] ^target";
  const harness = createInMemoryObsidianApp({ "Spaced Note.md": source });
  harness.app.workspace = {};
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  const file = harness.app.vault.getAbstractFileByPath("Spaced Note.md");

  await plugin.normalizeVaultFileDependencyBlockIds(file);
  await plugin.normalizeVaultFileDependencyBlockIds(file);
  assert.equal(harness.getSource(file.path), source);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /unsupported characters/);
});

test("rename reconciliation rewrites the target and every dependent", async () => {
  const harness = createInMemoryObsidianApp({
    "New/Home.md": "- [ ] #task Target [id:: Old__Home__review] ^review",
    "A.md": "- [ ] #task A [dependsOn:: Old__Home__review]",
    "B.md": "- [ ] #task B [dependsOn:: Old__Home__review]",
  });
  harness.app.workspace = {};
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  assert.equal(
    await plugin.reconcileRenamedDependencyIds(
      harness.app.vault.getAbstractFileByPath("New/Home.md"),
      "Old/Home.md",
    ),
    true,
  );
  assert.match(harness.getSource("New/Home.md"), /\[id:: New__Home__review\]/);
  assert.match(harness.getSource("A.md"), /\[dependsOn:: New__Home__review\]/);
  assert.match(harness.getSource("B.md"), /\[dependsOn:: New__Home__review\]/);
});

test("editor dependency normalization abandons and reschedules stale snapshots", async () => {
  const editor = createTextEditor("- [ ] #task Target [id:: abc123] ^target");
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = { vault: {}, workspace: {} };
  let rescheduled = 0;
  plugin.scheduleActiveEditorDependencyNormalize = () => { rescheduled += 1; };
  plugin.findAmbiguousDependencyIds = async () => {
    editor.replaceRange("typed ", { line: 0, ch: 0 });
    return new Set();
  };
  plugin.propagateDependencyBlockIds = async () => assert.fail("stale mapping propagated");

  assert.equal(
    await plugin.normalizeActiveEditorDependencyBlockIds(
      editor,
      { path: "Tasks.md" },
    ),
    false,
  );
  assert.equal(rescheduled, 1);
  assert.match(editor.getValue(), /^typed .*\[id:: abc123\]/);
});

test("rename reconciliation abandons and reschedules stale editor snapshots", async () => {
  const editor = createTextEditor(
    "- [ ] #task Target [id:: Old__Home__review] ^review",
  );
  const file = { path: "New/Home.md" };
  const view = Object.assign(new MarkdownView(), { editor, file });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = {
    vault: { cachedRead: async () => editor.getValue() },
    workspace: { getActiveViewOfType: () => view },
  };
  plugin.findDependencyIdentityCollisions = async () => {
    editor.replaceRange("typed ", { line: 0, ch: 0 });
    return new Set();
  };
  let rescheduled = 0;
  plugin.scheduleRenamedDependencyReconcile = () => { rescheduled += 1; };
  plugin.propagateDependencyBlockIds = async () => assert.fail("stale rename propagated");

  assert.equal(
    await plugin.reconcileRenamedDependencyIds(file, "Old/Home.md"),
    false,
  );
  assert.equal(rescheduled, 1);
  assert.match(editor.getValue(), /\[id:: Old__Home__review\]/);
});

test("Depends-On line recogniser covers the contract DP vectors", () => {
  const guarded = [
    ["DP1", "  - ⛓️ **DEPENDS ON:** [[#^hospital-swarm]]"],
    ["DP2", "  - ⛓️ **DEPENDS ON:** [[cash#^unemployment]]"],
    ["DP3", "  - ⛓️ **DEPENDS ON:** [[money/cash#^unemployment]]"],
    ["DP4", "  - ⛓️ **DEPENDS ON:** [[#^a]] • [[#^b]]"],
    ["DP5", "  - ⛓️ **DEPENDS ON:** [[#^a|b • c]]"],
    ["DP6", "  - ⛓️ **DEPENDS ON:** ~~[[#^a]]~~"],
    ["DP7", "  - ⛓️ **DEPENDS ON:** ![[#^a]]"],
    ["DP8", "  - 🔗 **DEPENDS ON:** [[#^a]]"],
    ["DP9", "  - **DEPENDS ON:** [[#^a]]"],
    ["DP10", "  - ⛓️ **DEPENDENCIES:** [[#^a]]"],
    ["DP11", "  - ⛓ **DEPENDS ON:** [[#^a]]"],
    ["DP12", "  - ⛓️ **DEPENDS ON:** [[#^a]] · [[#^b]]"],
    ["DP13", "  - ⛓️ **DEPENDS ON:** [[#^a]], [[#^b]]"],
    ["DP14", "  - ⛓️ **DEPENDS ON:** [[#^a]] [[#^b]]"],
    // DP15/DP16 are malformed per the contract but guarded exactly like
    // accepted lines: the cycler never strikes or retires them.
    ["DP15", "  - ⛓️ **DEPENDS ON:** [[#^a"],
    ["DP16", "  - ⛓️ **DEPENDS ON:** [[#^a]] needs review"],
    ["DP17", "  - ⛓️ **DEPENDS ON:**"],
    // DP18/DP19/DP20 share DP1's shape; the context makes them
    // not-a-line for projection, but the shape stays guarded here: this
    // guard is line-level and never sees nesting, so a grandchild
    // (DP19) or a Work Log child (DP20) still counts as a managed line.
    ["DP18-shape", "  - ⛓️ **DEPENDS ON:** [[#^a]]"],
    ["DP19-shape", "  - ⛓️ **DEPENDS ON:** [[#^a]]"],
    ["DP20-shape", "  - ⛓️ **DEPENDS ON:** [[#^a]]"],
    ["DP21", "  - ⛓️ **DEPENDS ON:** [[#^a]]"],
    ["DP22", "  - ⛓️ **DEPENDS ON:** [[#^a|swarm]]"],
    // DP23/DP25/DP26 are malformed per the contract but keep the guarded
    // shape, so the boolean recogniser stays true for them.
    ["DP23", "  - ⛓️ **DEPENDS ON:** [[note]]"],
    ["DP25", "  - ⛓️ **DEPENDS ON:** [[note#Heading]]"],
    ["DP26", "  - ⛓️ **DEPENDS ON:** • ,"],
    // DP30 shares DP1's shape; its Work Log context is pinned by the
    // Rust discovery test and the hooks, not by this shape guard.
    ["DP30-shape", "  - ⛓️ **DEPENDS ON:** [[#^a]]"],
    // DP31 is malformed (prose-only, no link) but guarded exactly like
    // the other malformed vectors: the cycler never strikes it.
    ["DP31", "  - ⛓️ **DEPENDS ON:** needs review"],
  ];
  for (const [id, line] of guarded) {
    assert.equal(helpers.isTaskDependencyLine(line), true, id + ": " + line);
  }
  const unguarded = [
    ["DP24", "  - 🔗️ **DEPENDS ON:** [[#^a]]"],
    ["DP27", "  - ⛓️ **depends on:** [[#^a]]"],
    ["DP28", "⛓️ **DEPENDS ON:** [[#^a]]"],
    ["DP29", "> - ⛓️ **DEPENDS ON:** [[#^a]]"],
    ["task", "- [?] #task Make appt ^rahway"],
    ["schedule-log", "  - 🗓️ **SCHEDULE LOG**"],
    ["transclusion", "  - ![[Tasks#^ship]]"],
    ["bullet", "  - plain bullet"],
  ];
  for (const [id, line] of unguarded) {
    assert.equal(helpers.isTaskDependencyLine(line), false, id + ": " + line);
  }
});

test("close-time retirement skips Depends-On lines", () => {
  const source = [
    "- [ ] #task Dependent [dependsOn:: A__review] ^dep",
    "  - ⛓️ **DEPENDS ON:** ![[A#^review]]",
    "  - ![[A#^review|Control]]",
  ].join("\n");
  const result = helpers.retireClosedTaskReferencesInText(
    source,
    "Tasks.md",
    [{ path: "A.md", blockId: "review" }],
    () => "A.md",
  );
  assert.equal(result.retired, 1);
  assert.match(result.text, /DEPENDS ON:\*\* !\[\[A#\^review\]\]/);
  assert.match(result.text, /~~\[\[A#\^review\|Control\]\]~~/);
});

test("reopen restoration skips Depends-On lines instead of re-embedding them", () => {
  const source = [
    "- [ ] #task Dependent [dependsOn:: A__review] ^dep",
    "  - ⛓️ **DEPENDS ON:** ~~[[A#^review]]~~",
    "  - ~~[[A#^review|Control]]~~",
  ].join("\n");
  const result = helpers.restoreReopenedTaskReferencesInText(
    source,
    "Tasks.md",
    [{ path: "A.md", blockId: "review" }],
    () => "A.md",
  );
  assert.equal(result.restored, 1);
  assert.match(result.text, /DEPENDS ON:\*\* ~~\[\[A#\^review\]\]~~/);
  assert.match(result.text, /!\[\[A#\^review\|Control\]\]/);
});

test("embedded-tree close collection ignores Depends-On lines", () => {
  const source = [
    "- [ ] #task Dependent ^dep",
    "  - ⛓️ **DEPENDS ON:** ![[A#^review]]",
    "  - ![[A#^other]]",
  ].join("\n");
  const targets =
    helpers.collectEmbeddedTranscludedTaskTargetsInListItemBlock(source, 0);
  assert.deepEqual(
    targets.map((target) => target.blockId),
    ["other"],
  );
});

test("Alt-bracket bullet formatting never applies to Depends-On lines", () => {
  assert.equal(
    helpers.getPlainBulletFormatToggle(
      "  - ⛓️ **DEPENDS ON:** [[#^a]] • [[#^b]]",
      1,
    ),
    null,
  );
  assert.equal(
    helpers.getPlainBulletFormatToggle("  - ⛓️ **DEPENDS ON:** [[#^a]]", -1),
    null,
  );
  assert.ok(helpers.getPlainBulletFormatToggle("  - plain bullet", 1));
});

test("Ctrl+Enter on a dependency link closes only the target and runs the recovery", async () => {
  const source = [
    "- [?] #task Dependent ^dep",
    "  - ⛓️ **DEPENDS ON:** [[#^a]]",
    "- [ ] #task Prereq ^a",
  ].join("\n");
  const harness = createInMemoryObsidianApp({ "Tasks.md": source });
  const editor = createTextEditor(source, { line: 1, ch: 25 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  let finalized = null;
  plugin.finalizeClosedTasks = async (identities) => {
    finalized = identities;
    return { reopened: 0, retired: 0 };
  };
  const result = await plugin.handleActiveTaskBlockLinkOpenDone(
    editor,
    harness.app.vault.getAbstractFileByPath("Tasks.md"),
  );
  assert.equal(result.resolved, true);
  // The target closes root-only (the close stamps completion) ...
  assert.match(editor.getValue(), /^- \[x\] #task Prereq .* \^a$/m);
  // ... the Depends-On line is never struck, restored, or reformatted ...
  assert.match(editor.getValue(), /^  - ⛓️ \*\*DEPENDS ON:\*\* \[\[#\^a\]\]$/m);
  assert.ok(editor.getValue().indexOf("~~") === -1);
  // ... and the Blocked-dependent recovery runs.
  assert.ok(finalized);
});

test("Ctrl+Enter on a dependency link reopens only the target, root-only", async () => {
  const source = [
    "- [?] #task Dependent ^dep",
    "  - ⛓️ **DEPENDS ON:** [[#^a]]",
    "- [x] #task Prereq ^a",
  ].join("\n");
  const harness = createInMemoryObsidianApp({ "Tasks.md": source });
  const editor = createTextEditor(source, { line: 1, ch: 25 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  const result = await plugin.handleActiveTaskBlockLinkOpenDone(
    editor,
    harness.app.vault.getAbstractFileByPath("Tasks.md"),
  );
  assert.equal(result.resolved, true);
  assert.equal(result.changed, true);
  // The target reopens root-only ...
  assert.match(editor.getValue(), /^- \[ \] #task Prereq \^a$/m);
  // ... the Depends-On line is never struck, restored, or reformatted ...
  assert.match(editor.getValue(), /^  - ⛓️ \*\*DEPENDS ON:\*\* \[\[#\^a\]\]$/m);
  assert.ok(editor.getValue().indexOf("~~") === -1);
  assert.ok(editor.getValue().indexOf("![[#^a]]") === -1);
});

test("single and counted Alt-bracket cycle the dependency target under the cursor", async () => {
  const source = [
    "- [?] #task Dependent ^dep",
    "  - ⛓️ **DEPENDS ON:** [[#^a]]",
    "- [?] #task Prereq [scheduled:: 2026-08-20] ^a",
    "\t- 🗓️ **SCHEDULE LOG**",
  ].join("\n");
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  {
    const harness = createInMemoryObsidianApp({ "Tasks.md": source });
    const editor = createTextEditor(source, { line: 1, ch: 25 });
    const plugin = new TaskStatusCyclerPlugin();
    plugin.app = harness.app;
    plugin.getScheduleLogDateString = () => "2026-08-17";
    const view = Object.assign(new MarkdownView(), { editor, file: { path: "Tasks.md" } });
    assert.equal(plugin.handleCycleCommand(false, editor, view, 1), true);
    await flush();
    await flush();
    assert.match(editor.getValue(), /^- \[ \] #task Prereq \^a$/m);
    assert.match(editor.getValue(), /^  - ⛓️ \*\*DEPENDS ON:\*\* \[\[#\^a\]\]$/m);
  }
  {
    const harness = createInMemoryObsidianApp({ "Tasks.md": source });
    const editor = createTextEditor(source, { line: 1, ch: 25 });
    const plugin = new TaskStatusCyclerPlugin();
    plugin.app = harness.app;
    plugin.getScheduleLogDateString = () => "2026-08-17";
    const changed = await plugin.cycleTaskStatusRange(editor, { path: "Tasks.md" }, 1, 0);
    assert.equal(changed, true);
    assert.match(editor.getValue(), /^- \[ \] #task Prereq \^a$/m);
    assert.match(editor.getValue(), /^  - ⛓️ \*\*DEPENDS ON:\*\* \[\[#\^a\]\]$/m);
  }
});

test("single and counted Alt-bracket report when the cursor is off every dependency link", async () => {
  // Two links: with a lone link the cursor position is unambiguous and the
  // target cycles, so the notice needs an ambiguous line.
  const source = [
    "- [?] #task Dependent ^dep",
    "  - ⛓️ **DEPENDS ON:** [[#^a]] • [[#^b]]",
    "- [ ] #task Prereq A ^a",
    "- [ ] #task Prereq B ^b",
  ].join("\n");
  const expected = "⛓ Put the cursor on a dependency link to cycle it";
  {
    const harness = createInMemoryObsidianApp({ "Tasks.md": source });
    const editor = createTextEditor(source, { line: 1, ch: 4 });
    const plugin = new TaskStatusCyclerPlugin();
    plugin.app = harness.app;
    const view = Object.assign(new MarkdownView(), { editor, file: { path: "Tasks.md" } });
    notices.length = 0;
    assert.equal(plugin.handleCycleCommand(false, editor, view, 1), true);
    assert.ok(notices.indexOf(expected) !== -1, JSON.stringify(notices));
    assert.equal(editor.getValue(), source);
  }
  {
    const harness = createInMemoryObsidianApp({ "Tasks.md": source });
    const editor = createTextEditor(source, { line: 1, ch: 4 });
    const plugin = new TaskStatusCyclerPlugin();
    plugin.app = harness.app;
    notices.length = 0;
    const changed = await plugin.cycleTaskStatusRange(editor, { path: "Tasks.md" }, 1, 0);
    assert.equal(changed, false);
    assert.ok(notices.indexOf(expected) !== -1, JSON.stringify(notices));
    assert.equal(editor.getValue(), source);
  }
});

test("Ctrl+Enter candidate resolution finds plain links on Depends-On lines", () => {
  const lineText = "  - ⛓️ **DEPENDS ON:** [[#^a]] • [[Tasks#^b]]";
  const first = helpers.getTaskBlockLinkTargetFromLine(
    lineText,
    "Tasks.md",
    1,
    lineText.indexOf("[[#^a]]") + 2,
  );
  assert.equal(first && first.blockId, "a");
  assert.equal(first.embedded, false);
  const second = helpers.getTaskBlockLinkTargetFromLine(
    lineText,
    "Tasks.md",
    1,
    lineText.indexOf("[[Tasks#^b]]") + 2,
  );
  assert.equal(second && second.blockId, "b");
  assert.equal(second.pathPart, "Tasks");
});

test("dependency-id normalisation never edits Depends-On lines", () => {
  const depLine = "  - ⛓️ **DEPENDS ON:** [[#^a]] • [[#^b]]";
  const source = [
    "- [?] #task Dependent [dependsOn:: stale-a, stale-b] ^dep",
    depLine,
    "- [ ] #task A [id:: stale-a] ^a",
    "- [ ] #task B [id:: stale-b] ^b",
  ].join("\n");
  const result = helpers.normalizeTaskDependencyBlockIds(source, "Tasks.md");
  assert.equal(result.changed, true);
  assert.equal(result.text.split("\n")[1], depLine);
  // R1 consistency: the rewritten field mirrors the line's targets in order.
  assert.match(result.text, /\[dependsOn:: Tasks__a, Tasks__b\]/);
  assert.equal(
    helpers.normalizeTaskDependencyBlockIds(result.text, "Tasks.md").changed,
    false,
  );
});

test("note rename rewrites fields while leaving Depends-On lines alone", () => {
  const depLine = "  - ⛓️ **DEPENDS ON:** [[Old/Path#^review]]";
  const source = [
    "- [ ] #task Parent [dependsOn:: Old__Path__review] ^parent",
    depLine,
    "- [ ] #task Target [id:: Old__Path__review] ^review",
  ].join("\n");
  const result = helpers.rewriteRenamedDependencyIds(
    source,
    "Old/Path.md",
    "New/Home.md",
  );
  assert.equal(result.changed, true);
  assert.match(result.text, /\[dependsOn:: New__Home__review\]/);
  assert.match(result.text, /\[id:: New__Home__review\] \^review/);
  // Link healing across the rename is R3 territory, owned by nav-model.
  assert.ok(result.text.includes(depLine));
});
