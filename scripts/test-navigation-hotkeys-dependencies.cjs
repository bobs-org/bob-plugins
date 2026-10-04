const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  notices,
  NavigationHotkeysPlugin,
  helpers,
  TransactionEditor,
  RecordingFallbackEditor,
  compatibleTasksSettings,
  assertLineBoundedTransaction,
} = require("./navigation-hotkeys-harness.cjs");

test("counted dependencies converge mixed sources and maintain one link per parent", () => {
  const input = [
    "- [ ] #task One [dependsOn:: Tasks__target] ^one",
    "- [/] #task Two ^two",
    "- [*] #task Three [dependsOn:: legacy-target] ^three",
    "- [ ] #task Target [id:: legacy-target] ^target",
  ].join("\n");
  const session = helpers.discoverCountedObsidianTaskTargets(input, 0, 2);
  const dependencyTask = helpers
    .getOpenLocalTasks(input)
    .find((task) => task.line === 3);
  const added = helpers.planCountedLocalTaskDependency(
    input,
    session,
    dependencyTask,
    "Tasks.md",
  );
  assert.equal(added.valid, true);
  assert.equal(added.operation, "add");
  assert.equal(added.targetCount, 3);
  // An existing `[id::]` is never rewritten: the kept id resolves the field.
  assert.equal(
    (added.content.match(/\[dependsOn:: legacy-target\]/g) || []).length,
    3,
  );
  assert.equal(
    (added.content.match(/⛓️ \*\*DEPENDS ON:\*\* \[\[#\^target\]\]/g) || [])
      .length,
    3,
  );
  assert.match(added.content, /Target \[id:: legacy-target\] \^target/);
  assert.doesNotMatch(added.content, /Tasks__target/);

  const removeSession = helpers.discoverCountedObsidianTaskTargets(
    added.content,
    0,
    2,
  );
  const updatedDependencyTask = helpers
    .getOpenLocalTasks(added.content)
    .find((task) => task.existingBlockId === "target");
  const removed = helpers.planCountedLocalTaskDependency(
    added.content,
    removeSession,
    updatedDependencyTask,
    "Tasks.md",
  );
  assert.equal(removed.valid, true);
  assert.equal(removed.operation, "remove");
  assert.doesNotMatch(removed.content, /dependsOn|⛓️/);
  assert.match(removed.content, /Target \[id:: legacy-target\] \^target/);
});

test("counted and single dependency gestures refuse inside a blockquote (DP29)", () => {
  const input = [
    "- [ ] #task One ^one",
    "> - [ ] #task Quoted ^quoted",
    "- [ ] #task Target ^target",
  ].join("\n");
  const quotedPlan = helpers.planDependencyEdit({
    content: input,
    parentLine: 1,
    parentPath: "Tasks.md",
    add: [{ path: "Tasks.md", blockId: "target" }],
    remove: [],
    files: { "Tasks.md": input },
  });
  assert.equal(quotedPlan.ok, false);
  assert.equal(quotedPlan.reason, "in-blockquote");
  assert.equal(
    helpers.dependencyPlanFailureNotice(quotedPlan.reason, "add"),
    "⛓ Dependencies can't be edited inside a blockquote",
  );
  const session = helpers.discoverCountedObsidianTaskTargets(input, 0, 1);
  const dependencyTask = helpers
    .getOpenLocalTasks(input)
    .find((task) => task.line === 2);
  const counted = helpers.planCountedLocalTaskDependency(
    input,
    session,
    dependencyTask,
    "Tasks.md",
  );
  assert.equal(counted.valid, false);
  assert.match(counted.error, /blockquote/);
  assert.equal(counted.content, input);
});

test("counted dependency candidates exclude every source and expose mixed state", () => {
  const input = [
    "- [ ] #task One [dependsOn:: Tasks__target] ^one",
    "- [/] #task Two ^two",
    "- [*] #task Three [dependsOn:: Tasks__target] ^three",
    "- [ ] #task Target ^target",
  ].join("\n");
  const items = helpers.createBulletPropertyLocalTaskItems(input, {
    excludeLines: new Set([0, 1, 2]),
    dependencyValueSets: [
      new Set(["Tasks__target"]),
      new Set(),
      new Set(["Tasks__target"]),
    ],
    filePath: "Tasks.md",
  });
  assert.deepEqual(items.map((item) => item.line), [3]);
  assert.equal(items[0].linkState, "mixed");
  assert.equal(items[0].linkedSourceCount, 2);
  assert.equal(items[0].sourceCount, 3);
});

test("counted dependency block-ID prompting is planned atomically", () => {
  const input = [
    "- [ ] #task One ^one",
    "- [/] #task Two ^two",
    "- [ ] #task Target",
  ].join("\r\n");
  const session = helpers.discoverCountedObsidianTaskTargets(input, 0, 1);
  const dependencyTask = helpers
    .getOpenLocalTasks(input)
    .find((task) => task.line === 2);
  const needsPrompt = helpers.planCountedLocalTaskDependency(
    input,
    session,
    dependencyTask,
    "Tasks.md",
  );
  assert.equal(needsPrompt.valid, false);
  assert.equal(needsPrompt.needsBlockIdPrompt, true);
  assert.equal(needsPrompt.content, input);

  const planned = helpers.planCountedLocalTaskDependency(
    input,
    session,
    dependencyTask,
    "Tasks.md",
    { confirmedBlockId: "target" },
  );
  assert.equal(planned.valid, true);
  assert.equal(planned.content.includes("\r\n"), true);
  assert.match(planned.content, /Target \[id:: Tasks__target\] \^target/);
  assert.equal(
    (planned.content.match(/\[dependsOn:: Tasks__target\]/g) || []).length,
    2,
  );
  assert.equal(
    (planned.content.match(/⛓️ \*\*DEPENDS ON:\*\* \[\[#\^target\]\]/g) || [])
      .length,
    2,
  );

  const stale = input.replace("#task Two", "#task Two changed");
  const rejected = helpers.planCountedLocalTaskDependency(
    stale,
    session,
    dependencyTask,
    "Tasks.md",
    { confirmedBlockId: "target" },
  );
  assert.equal(rejected.valid, false);
  assert.equal(rejected.stale, true);
  assert.equal(rejected.content, stale);
  assert.doesNotMatch(rejected.content, /dependsOn|\[id::/);
});

test("counted dependency runtime applies target, parents, and navigation in one undo group", async () => {
  const input = [
    "- [ ] #task One ^one",
    "- [/] #task Two ^two",
    "- [ ] #task Target ^target",
  ].join("\r\n");
  const cursor = { line: 0, ch: 8 };
  const editor = new TransactionEditor(input, cursor, 455);
  const session = helpers.discoverCountedObsidianTaskTargets(input, 0, 1);
  const dependencyTask = helpers
    .getOpenLocalTasks(input)
    .find((task) => task.existingBlockId === "target");
  const file = { path: "Tasks.md", extension: "md" };
  const plugin = new NavigationHotkeysPlugin();
  plugin.getActiveMarkdownView = () => ({ editor, file });

  assert.equal(
    await plugin.applyCountedLocalTaskDependency(
      editor,
      cursor,
      file.path,
      session,
      dependencyTask,
    ),
    true,
  );
  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.undoGroups, 1);
  assert.deepEqual(editor.transactionScrollTops, [455]);
  assert.deepEqual(editor.transactions[0].selection, {
    from: cursor,
    to: cursor,
  });
  assert.equal(editor.content.includes("\r\n"), true);
  assert.equal(
    (editor.content.match(/\[dependsOn:: Tasks__target\]/g) || []).length,
    2,
  );
  assert.equal(
    (editor.content.match(/⛓️ \*\*DEPENDS ON:\*\* \[\[#\^target\]\]/g) || [])
      .length,
    2,
  );
  assert.match(editor.content, /Target \[id:: Tasks__target\] \^target/);
});

test("cross-file toggle changes only the source link", async () => {
  const activeFile = { path: "Here.md", extension: "md" };
  const lines = [
    "- [/] #task Parent ^parent",
    "  - [[Other#^target]]",
    "context below",
  ];
  const editor = new TransactionEditor(lines.join("\n"), { line: 1, ch: 12 });
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => activeFile },
  };

  assert.equal(await plugin.toggleCurrentLineTransclusions(editor), true);

  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.undoGroups, 1);
  assertLineBoundedTransaction(editor.transactions[0], lines, [1]);
  assert.deepEqual(editor.transactions[0].selection, {
    from: { line: 1, ch: 13 },
    to: { line: 1, ch: 13 },
  });
  assert.equal(editor.getLine(1), "  - ![[Other#^target]]");
  assert.doesNotMatch(editor.getLine(0), /dependsOn/);
  assert.doesNotMatch(editor.getLine(0), /- \[\?\]/);
});
test("cross-file write failure still toggles only the source link", async () => {
  const activeFile = { path: "Here.md", extension: "md" };
  const targetFile = { path: "Other.md", extension: "md" };
  const lines = [
    "- [ ] #task Parent ^parent",
    "  - [[Other#^target]]",
    "context below",
  ];
  const editor = new TransactionEditor(lines.join("\n"), { line: 1, ch: 12 });
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => activeFile },
    metadataCache: { getFirstLinkpathDest: () => targetFile },
    vault: {
      cachedRead: async () => "- [ ] #task Target ^target",
      process: async () => {
        throw new Error("write failed");
      },
    },
  };

  assert.equal(await plugin.toggleCurrentLineTransclusions(editor), true);

  assert.equal(editor.transactions.length, 1);
  assertLineBoundedTransaction(editor.transactions[0], lines, [1]);
  assert.equal(editor.getLine(1), "  - ![[Other#^target]]");
  assert.doesNotMatch(editor.getLine(0), /dependsOn/);
  assert.doesNotMatch(editor.getLine(0), /- \[\?\]/);
});

test("line-local fallback applies bottom-up and preserves CRLF", async () => {
  const activeFile = { path: "Here.md", extension: "md" };
  const lines = Array.from({ length: 22 }, (_, index) => `context ${index}`);
  const activeLine = 6;
  lines[3] = "- [/] #task Parent ^parent";
  lines[4] = "  - supporting detail";
  lines[5] = "  - another detail";
  lines[activeLine] = "  - [[#^target]]";
  lines[15] = "- [ ] #task Target ^target";
  const editor = new RecordingFallbackEditor(lines.join("\r\n"), {
    line: activeLine,
    ch: 12,
  });
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => activeFile },
  };

  assert.equal(await plugin.toggleCurrentLineTransclusions(editor), true);

  assert.deepEqual(
    editor.replaceCalls.map((call) => call.from.line),
    [activeLine],
  );
  assert.equal(
    editor.replaceCalls.every((call) => call.from.line === call.to.line),
    true,
  );
  assert.deepEqual(editor.events, [`replace:${activeLine}`, "cursor"]);
  assert.deepEqual(editor.setCursorCalls, [{ line: activeLine, ch: 13 }]);
  const expected = lines.slice();
  expected[activeLine] = "  - ![[#^target]]";
  assert.equal(editor.content, expected.join("\r\n"));
  assert.equal(lines[3], "- [/] #task Parent ^parent");
  assert.equal(lines[15], "- [ ] #task Target ^target");
});
test("source line-count invariant rejects embedded newline changes", async () => {
  const activeFile = { path: "Here.md", extension: "md" };
  const editor = new TransactionEditor("before\n- [[Target]]\nafter", {
    line: 1,
    ch: 4,
  });
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => activeFile },
  };

  assert.equal(
    await plugin.applyDependencyAwareTransclusionChanges(editor, [
      { line: 1, nextLineText: "- ![[Target]]\nextra" },
    ]),
    false,
  );
  assert.equal(editor.content, "before\n- [[Target]]\nafter");
  assert.deepEqual(editor.transactions, []);
});

test("pure toggle refuses when the source changed under it", async () => {
  let reads = 0;
  const drifting = {
    getValue: () =>
      reads++ === 0 ? "- [[Target]]" : "- [[Target]] edited",
  };
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => ({ path: "Here.md" }) },
  };

  assert.equal(
    await plugin.applyDependencyAwareTransclusionChanges(drifting, [
      { line: 0, nextLineText: "- ![[Target]]" },
    ]),
    false,
  );
});
test("counted transclusion toggle evaluates each line independently", () => {
  const result = helpers.toggleLineRangeTransclusions(
    ["- [[a]] and ![[b]]", "- ![[c]]"],
    0,
    1,
  );
  assert.deepEqual(
    result.changesByLine.map((change) => change.nextLineText),
    ["- ![[a]] and ![[b]]", "- [[c]]"],
  );
  assert.equal(
    helpers.toggleLineTransclusions("prefix [[a]] and [[b]]").line,
    "prefix ![[a]] and ![[b]]",
  );
});

test("transclusion toggle is refused on Depends-On lines", async () => {
  const line = "  - ⛓️ **DEPENDS ON:** [[#^a]] • [[Other#^b]]";
  assert.deepEqual(helpers.findTransclusionToggleTargets(line), []);
  assert.equal(helpers.toggleLineTransclusions(line).found, false);
  const editor = new TransactionEditor(
    [
      "- [?] #task P [dependsOn:: Here__a, Other__b] ^p",
      line,
      "- [x] #task A [id:: Here__a] ^a",
    ].join("\n"),
    { line: 1, ch: 5 },
  );
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => ({ path: "Here.md", extension: "md" }) },
  };
  notices.length = 0;
  assert.equal(await plugin.toggleCurrentLineTransclusions(editor), false);
  assert.equal(editor.transactions.length, 0);
  assert.equal(editor.content.split("\n")[1], line);
  assert.match(notices.at(-1), /Ctrl\+Shift\+P/);
});

test("legacy sole-link children toggle purely, without field or status writes", async () => {
  const activeFile = { path: "Here.md", extension: "md" };
  const lines = [
    "- [/] #task Parent ^parent",
    "  - [[#^child]]",
    "- [ ] #task Child ^child",
  ];
  const editor = new TransactionEditor(lines.join("\n"), { line: 1, ch: 5 });
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => activeFile },
  };

  assert.equal(await plugin.toggleCurrentLineTransclusions(editor), true);
  assert.equal(editor.transactions.length, 1);
  assert.deepEqual(
    editor.transactions[0].changes.map((change) => change.from.line),
    [1],
  );
  assert.equal(editor.getLine(0), "- [/] #task Parent ^parent");
  assert.equal(editor.getLine(1), "  - ![[#^child]]");
  assert.equal(editor.getLine(2), "- [ ] #task Child ^child");

  assert.equal(await plugin.toggleCurrentLineTransclusions(editor), true);
  assert.equal(editor.getLine(1), "  - [[#^child]]");
  assert.equal(editor.getLine(0), "- [/] #task Parent ^parent");
  assert.equal(editor.getLine(2), "- [ ] #task Child ^child");
});

test("Ctrl+D on the Depends on row clears the line, field, and legacy children", async () => {
  const activeFile = { path: "Here.md", extension: "md" };
  const editor = new TransactionEditor(
    [
      "- [?] #task P [dependsOn:: Here__a] ^p",
      "  - ⛓️ **DEPENDS ON:** [[#^a]]",
      "  - ![[#^a]]",
      "- [x] #task A [id:: Here__a] ^a",
    ].join("\n"),
    { line: 0, ch: 2 },
  );
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => activeFile },
    vault: {
      adapter: { read: async () => JSON.stringify(compatibleTasksSettings()) },
    },
  };
  notices.length = 0;
  const result = await plugin.deleteBulletPropertyValue(
    editor,
    { line: 0, ch: 2 },
    "dependsOn",
    {},
  );
  assert.equal(result.deleted, true);
  assert.match(editor.getValue(), /- \[ \] #task P \^p$/m);
  assert.doesNotMatch(editor.getValue(), /DEPENDS ON|dependsOn/);
  assert.doesNotMatch(editor.getValue(), /\[\[#\^a\]\]/);
  assert.match(notices.at(-1), /No longer waits on/);
});

test("Ctrl+D clears a field-only dependency without a line", async () => {
  const activeFile = { path: "Here.md", extension: "md" };
  const editor = new TransactionEditor(
    [
      "- [?] #task P [dependsOn:: Here__a] ^p",
      "- [x] #task A [id:: Here__a] ^a",
    ].join("\n"),
    { line: 0, ch: 2 },
  );
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => activeFile },
    vault: {
      adapter: { read: async () => JSON.stringify(compatibleTasksSettings()) },
    },
  };
  const result = await plugin.deleteBulletPropertyValue(
    editor,
    { line: 0, ch: 2 },
    "dependsOn",
    {},
  );
  assert.equal(result.deleted, true);
  // The field-only clear recovers immediately (ADJ-8): the only prerequisite
  // is closed, so nothing still blocks.
  assert.match(editor.getValue(), /- \[ \] #task P \^p$/m);
  assert.doesNotMatch(editor.getValue(), /dependsOn/);
});

test("counted Ctrl+D on the Depends on row clears every targeted task", async () => {
  const lines = [
    "- [?] #task P [dependsOn:: Here__a] ^p",
    "  - ⛓️ **DEPENDS ON:** [[#^a]]",
    "- [?] #task Q [dependsOn:: Here__a] ^q",
    "  - ⛓️ **DEPENDS ON:** [[#^a]]",
    "- [x] #task A [id:: Here__a] ^a",
  ];
  const editor = new TransactionEditor(lines.join("\n"), { line: 0, ch: 2 });
  const session = helpers.discoverCountedObsidianTaskTargets(
    editor.content,
    0,
    1,
  );
  assert.deepEqual(
    session.targets.map((target) => target.line),
    [0, 2],
  );
  const file = { path: "Here.md", extension: "md" };
  const plugin = new NavigationHotkeysPlugin();
  plugin.getActiveMarkdownView = () => ({ editor, file });
  plugin.app = {
    workspace: { getActiveFile: () => file },
    vault: {
      adapter: { read: async () => JSON.stringify(compatibleTasksSettings()) },
    },
  };
  const result = await plugin.deleteCountedBulletPropertyValue(
    editor,
    { line: 0, ch: 2 },
    file.path,
    session,
    "dependsOn",
  );
  assert.equal(result.deleted, true);
  assert.match(editor.getValue(), /- \[ \] #task P \^p$/m);
  assert.match(editor.getValue(), /- \[ \] #task Q \^q$/m);
  assert.doesNotMatch(editor.getValue(), /DEPENDS ON|dependsOn/);
});

test("findRemovedLineText reports deleted lines", () => {
  assert.equal(
    helpers.findRemovedLineText("a\nb\nc", "a\nc"),
    "b",
  );
  assert.equal(
    helpers.findRemovedLineText("a\nb\nc", "a\nx\nc"),
    "b",
  );
  assert.equal(helpers.findRemovedLineText("a\nb", "a\nb"), "");
  assert.equal(helpers.findRemovedLineText("a", "a\nb"), "");
});

test("hand-edit mirror projects an edited line into the field", async () => {
  const content = [
    "- [ ] #task P ^p",
    "  - ⛓️ **DEPENDS ON:** [[#^a]]",
    "- [ ] #task A ^a",
  ].join("\n");
  const plan = helpers.planDependencyHandEditMirror(content, content, 1, "");
  assert.equal(plan.kind, "touch");
  assert.equal(plan.owning, 0);
  const editor = new TransactionEditor(content, { line: 2, ch: 0 });
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => ({ path: "Here.md" }) },
  };
  const result = await plugin.mirrorDependencyHandEdit(
    editor,
    "Here.md",
    content,
    1,
    "",
  );
  assert.equal(result.mirrored, true);
  assert.match(editor.getValue(), /\[dependsOn:: Here__a\]/);
  assert.match(editor.getValue(), /- \[ \] #task A \[id:: Here__a\] \^a/);
  // The hand-added open prerequisite blocks the dependent.
  assert.match(editor.getValue(), /- \[\?\] #task P \[dependsOn:: Here__a\] \^p$/m);
});

test("hand-edit mirror canonicalises a hand-written line variant", async () => {
  const content = [
    "- [ ] #task P [dependsOn:: Here__a] ^p",
    "  - 🔗 **DEPENDENCIES:** [[#^a]]",
    "- [ ] #task A [id:: Here__a] ^a",
  ].join("\n");
  const editor = new TransactionEditor(content, { line: 3, ch: 0 });
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => ({ path: "Here.md" }) },
  };
  const result = await plugin.mirrorDependencyHandEdit(
    editor,
    "Here.md",
    content,
    1,
    "",
  );
  assert.equal(result.mirrored, true);
  assert.match(
    editor.getValue(),
    /  - ⛓️ \*\*DEPENDS ON:\*\* \[\[#\^a\]\]/,
  );
  // Canonicalising keeps the block the open prerequisite implies.
  assert.match(editor.getValue(), /- \[\?\] #task P /m);
});

test("hand-edit mirror drops a linkless line and the field", async () => {
  const content = [
    "- [?] #task P [dependsOn:: Here__a] ^p",
    "  - ⛓️ **DEPENDS ON:**",
    "- [x] #task A [id:: Here__a] ^a",
  ].join("\n");
  const plan = helpers.planDependencyHandEditMirror(content, content, 1, "");
  assert.equal(plan.kind, "clear-empty");
  const editor = new TransactionEditor(content, { line: 2, ch: 0 });
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => ({ path: "Here.md" }) },
  };
  const result = await plugin.mirrorDependencyHandEdit(
    editor,
    "Here.md",
    content,
    1,
    "",
    { registry: helpers.parseTasksStatusRegistry(compatibleTasksSettings()) },
  );
  assert.equal(result.mirrored, true);
  assert.match(editor.getValue(), /- \[ \] #task P \^p$/m);
  assert.doesNotMatch(editor.getValue(), /DEPENDS ON|dependsOn/);
});

test("hand-edit mirror clears the field after the line is deleted", async () => {
  const oldContent = [
    "- [?] #task P [dependsOn:: Here__a] ^p",
    "  - ⛓️ **DEPENDS ON:** [[#^a]]",
    "- [x] #task A [id:: Here__a] ^a",
  ].join("\n");
  const newContent = [
    "- [?] #task P [dependsOn:: Here__a] ^p",
    "- [x] #task A [id:: Here__a] ^a",
  ].join("\n");
  const removed = helpers.findRemovedLineText(oldContent, newContent);
  assert.match(removed, /DEPENDS ON/);
  const plan = helpers.planDependencyHandEditMirror(
    oldContent,
    newContent,
    1,
    removed,
  );
  assert.equal(plan.kind, "clear-field");
  const editor = new TransactionEditor(newContent, { line: 1, ch: 0 });
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => ({ path: "Here.md" }) },
  };
  const result = await plugin.mirrorDependencyHandEdit(
    editor,
    "Here.md",
    oldContent,
    1,
    removed,
    { registry: helpers.parseTasksStatusRegistry(compatibleTasksSettings()) },
  );
  assert.equal(result.mirrored, true);
  assert.match(editor.getValue(), /- \[ \] #task P \^p$/m);
  assert.doesNotMatch(editor.getValue(), /dependsOn/);
});

test("hand-edit mirror leaves malformed lines alone", async () => {
  const content = [
    "- [ ] #task P ^p",
    "  - ⛓️ **DEPENDS ON:** [[#^a]] plus prose",
    "- [ ] #task A ^a",
  ].join("\n");
  assert.equal(
    helpers.planDependencyHandEditMirror(content, content, 1, ""),
    null,
  );
  const editor = new TransactionEditor(content, { line: 2, ch: 0 });
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => ({ path: "Here.md" }) },
  };
  const result = await plugin.mirrorDependencyHandEdit(
    editor,
    "Here.md",
    content,
    1,
    "",
  );
  assert.equal(result.mirrored, false);
  assert.equal(editor.getValue(), content);
});

test("hand-edit mirror leaves legacy-only children for the hooks", async () => {
  const content = [
    "- [ ] #task P [dependsOn:: Here__a] ^p",
    "  - ![[#^a]]",
    "- [x] #task A [id:: Here__a] ^a",
  ].join("\n");
  assert.equal(
    helpers.planDependencyHandEditMirror(content, content, 0, ""),
    null,
  );
  const editor = new TransactionEditor(content, { line: 2, ch: 0 });
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => ({ path: "Here.md" }) },
  };
  const result = await plugin.mirrorDependencyHandEdit(
    editor,
    "Here.md",
    content,
    0,
    "",
  );
  assert.equal(result.mirrored, false);
  assert.equal(editor.getValue(), content);
});

test("hand-edit mirror blocks when an open prerequisite is added by hand", async () => {
  const content = [
    "- [ ] #task P ^p",
    "  - ⛓️ **DEPENDS ON:** [[#^a]]",
    "- [ ] #task A ^a",
  ].join("\n");
  const editor = new TransactionEditor(content, { line: 2, ch: 0 });
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => ({ path: "Here.md" }) },
  };
  // Even with a freshness stamper available, the mirror never stamps.
  plugin.getFreshnessStampLine = () => (line) => `${line} [fresh:: today]`;
  const result = await plugin.mirrorDependencyHandEdit(
    editor,
    "Here.md",
    content,
    1,
    "",
  );
  assert.equal(result.mirrored, true);
  assert.match(
    editor.getValue(),
    /- \[\?\] #task P \[dependsOn:: Here__a\] \^p$/m,
  );
  assert.match(editor.getValue(), /- \[ \] #task A \[id:: Here__a\] \^a$/m);
  assert.doesNotMatch(editor.getValue(), /fresh::/);
});

test("hand-edit mirror never transfers commitment to the target", async () => {
  const content = [
    "- [*] #task P ^p",
    "  - ⛓️ **DEPENDS ON:** [[#^a]]",
    "- [ ] #task A ^a",
  ].join("\n");
  const editor = new TransactionEditor(content, { line: 2, ch: 0 });
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => ({ path: "Here.md" }) },
  };
  const result = await plugin.mirrorDependencyHandEdit(
    editor,
    "Here.md",
    content,
    1,
    "",
  );
  assert.equal(result.mirrored, true);
  assert.match(editor.getValue(), /- \[\?\] #task P \[dependsOn:: Here__a\] \^p$/m);
  // The stage would raise the open target to Next; the mirror leaves it Ready.
  assert.match(editor.getValue(), /- \[ \] #task A \[id:: Here__a\] \^a$/m);
});

test("hand-edit mirror recovers when the last open prerequisite is removed by hand", async () => {
  const oldContent = [
    "- [?] #task P [dependsOn:: Here__a, Here__b] ^p",
    "  - ⛓️ **DEPENDS ON:** [[#^a]] • [[#^b]]",
    "- [x] #task A [id:: Here__a] ^a",
    "- [ ] #task B [id:: Here__b] ^b",
  ].join("\n");
  const newContent = [
    "- [?] #task P [dependsOn:: Here__a, Here__b] ^p",
    "  - ⛓️ **DEPENDS ON:** [[#^a]]",
    "- [x] #task A [id:: Here__a] ^a",
    "- [ ] #task B [id:: Here__b] ^b",
  ].join("\n");
  const editor = new TransactionEditor(newContent, { line: 3, ch: 0 });
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => ({ path: "Here.md" }) },
    vault: {
      adapter: { read: async () => JSON.stringify(compatibleTasksSettings()) },
    },
  };
  plugin.getFreshnessStampLine = () => (line) => `${line} [fresh:: today]`;
  const result = await plugin.mirrorDependencyHandEdit(
    editor,
    "Here.md",
    oldContent,
    1,
    "",
  );
  assert.equal(result.mirrored, true);
  assert.match(editor.getValue(), /- \[ \] #task P \[dependsOn:: Here__a\] \^p$/m);
  assert.match(
    editor.getValue(),
    /  - ⛓️ \*\*DEPENDS ON:\*\* \[\[#\^a\]\]$/m,
  );
  // The closed prerequisite stays as history; the open one is untouched.
  assert.match(editor.getValue(), /- \[ \] #task B \[id:: Here__b\] \^b$/m);
  assert.doesNotMatch(editor.getValue(), /fresh::/);
});

test("hand-edit mirror leaves a half-typed link alone", async () => {
  const content = [
    "- [ ] #task P ^p",
    "  - ⛓️ **DEPENDS ON:** [[",
    "- [ ] #task A ^a",
  ].join("\n");
  assert.equal(
    helpers.planDependencyHandEditMirror(content, content, 1, ""),
    null,
  );
  const editor = new TransactionEditor(content, { line: 2, ch: 0 });
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => ({ path: "Here.md" }) },
  };
  const result = await plugin.mirrorDependencyHandEdit(
    editor,
    "Here.md",
    content,
    1,
    "",
  );
  assert.equal(result.mirrored, false);
  assert.equal(editor.getValue(), content);
});

test("hand-edit mirror clears the owning task when its last-child line is deleted", async () => {
  const oldContent = [
    "- [?] #task P [dependsOn:: Here__a] ^p",
    "  - ⛓️ **DEPENDS ON:** [[#^a]]",
    "- [?] #task S [dependsOn:: Here__b] ^s",
    "  - ⛓️ **DEPENDS ON:** [[#^b]]",
    "- [x] #task A [id:: Here__a] ^a",
    "- [x] #task B [id:: Here__b] ^b",
  ].join("\n");
  const newContent = [
    "- [?] #task P [dependsOn:: Here__a] ^p",
    "- [?] #task S [dependsOn:: Here__b] ^s",
    "  - ⛓️ **DEPENDS ON:** [[#^b]]",
    "- [x] #task A [id:: Here__a] ^a",
    "- [x] #task B [id:: Here__b] ^b",
  ].join("\n");
  const removed = helpers.findRemovedLineText(oldContent, newContent);
  assert.match(removed, /DEPENDS ON/);
  const plan = helpers.planDependencyHandEditMirror(
    oldContent,
    newContent,
    1,
    removed,
  );
  // The owner maps by task identity: P at its shifted line, never the
  // sibling S that slid into the deleted index.
  assert.equal(plan.kind, "clear-field");
  assert.equal(plan.owning, 0);
  const editor = new TransactionEditor(newContent, { line: 3, ch: 0 });
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => ({ path: "Here.md" }) },
    vault: {
      adapter: { read: async () => JSON.stringify(compatibleTasksSettings()) },
    },
  };
  const result = await plugin.mirrorDependencyHandEdit(
    editor,
    "Here.md",
    oldContent,
    1,
    removed,
  );
  assert.equal(result.mirrored, true);
  assert.equal(
    editor.getValue(),
    [
      "- [ ] #task P ^p",
      "- [?] #task S [dependsOn:: Here__b] ^s",
      "  - ⛓️ **DEPENDS ON:** [[#^b]]",
      "- [x] #task A [id:: Here__a] ^a",
      "- [x] #task B [id:: Here__b] ^b",
    ].join("\n"),
  );
});
