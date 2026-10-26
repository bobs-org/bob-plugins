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

test("counted Depends-on removal recovers residents with [unblocked::]", () => {
  const input = [
    "---",
    'type: "[[project]]"',
    "status: wip",
    "---",
    "",
    "- [?] #task #prj Ship [dependsOn:: Project__setup] [fresh:: 2026-10-10] ^prj",
    "  - ⛓️ **DEPENDS ON:** [[#^setup]]",
    "- [?] #task Draft [fresh:: 2026-10-10] #prj_is_blocked ^draft",
    "- [ ] #task Setup ^setup",
  ].join("\n");
  const session = helpers.discoverCountedObsidianTaskTargets(input, 5, 0);
  const dependencyTask = helpers
    .getOpenLocalTasks(input)
    .find((task) => task.existingBlockId === "setup");
  const calls = [];
  const plan = helpers.planCountedLocalTaskDependency(
    input,
    session,
    dependencyTask,
    "Project.md",
    {
      recovery: {
        registry: helpers.parseTasksStatusRegistry(compatibleTasksSettings()),
        today: new Date(2026, 9, 12, 12),
        vaultContents: null,
        markUnblockedLine: (line) => {
          calls.push(line);
          return `${line} [unblocked:: 2026-10-12]`;
        },
      },
    },
  );
  assert.equal(plan.valid, true, plan.error);
  assert.equal(plan.operation, "remove");
  assert.match(plan.content, /^- \[ \] #task #prj Ship/m);
  assert.doesNotMatch(plan.content, /DEPENDS ON/);
  const draft = plan.content.split("\n").find((line) => /Draft/.test(line));
  assert.match(draft, /^- \[ \] #task Draft/);
  assert.doesNotMatch(draft, /#prj_is_blocked/);
  assert.match(draft, /\[unblocked:: 2026-10-12\]/);
  assert.ok(calls.length >= 1);
});

test("counted Depends-on removal writes [unblocked::] through the wired freshness API", async () => {
  notices.length = 0;
  const input = [
    "---",
    'type: "[[project]]"',
    "status: wip",
    "---",
    "",
    "- [?] #task #prj Ship [dependsOn:: Project__setup] [fresh:: 2026-10-10] ^prj",
    "  - ⛓️ **DEPENDS ON:** [[#^setup]]",
    "- [?] #task Draft [fresh:: 2026-10-10] #prj_is_blocked ^draft",
    "- [ ] #task Setup ^setup",
  ].join("\n");
  const cursor = { line: 5, ch: 8 };
  const editor = new TransactionEditor(input, cursor);
  const file = { path: "Project.md", extension: "md" };
  const session = helpers.discoverCountedObsidianTaskTargets(input, 5, 0);
  const dependencyTask = helpers
    .getOpenLocalTasks(input)
    .find((task) => task.existingBlockId === "setup");
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getLeavesOfType: () => [] },
    vault: {
      getMarkdownFiles: () => [file],
      cachedRead: async () => input,
      adapter: {
        read: async () => JSON.stringify(compatibleTasksSettings()),
      },
    },
  };
  plugin.getActiveMarkdownView = () => ({ editor, file });
  // The writer under test; removing the markUnblockedLine wiring in
  // applyCountedLocalTaskDependency must fail this test.
  plugin.getFreshnessApi = () => ({
    markUnblockedLine(line, options) {
      const today =
        options.today instanceof Date
          ? `${options.today.getFullYear()}-${String(options.today.getMonth() + 1).padStart(2, "0")}-${String(options.today.getDate()).padStart(2, "0")}`
          : String(options.today || "2026-10-12");
      return line.replace(
        /(?= \^[A-Za-z0-9-]+\s*$)/,
        ` [unblocked:: ${today}]`,
      );
    },
  });

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
  assert.match(editor.content, /^- \[ \] #task #prj Ship/m);
  assert.doesNotMatch(editor.content, /DEPENDS ON/);
  const draft = editor.content.split("\n").find((line) => /Draft/.test(line));
  assert.match(draft, /^- \[ \] #task Draft/);
  assert.doesNotMatch(draft, /#prj_is_blocked/);
  assert.match(draft, /\[unblocked:: \d{4}-\d{2}-\d{2}\]/);
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

test("transclusion toggles refuse generated BLOCKS lines with their notice", async () => {
  const blocksLine = "  - 🧱 **BLOCKS:** [[#^t1]]";
  const blocksEditor = new TransactionEditor(blocksLine, { line: 0, ch: 20 });
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => ({ path: "Here.md", extension: "md" }) },
  };

  notices.length = 0;
  assert.equal(await plugin.toggleCurrentLineTransclusions(blocksEditor), false);
  assert.equal(blocksEditor.content, blocksLine);
  assert.deepEqual(blocksEditor.transactions, []);
  assert.equal(notices.at(-1), helpers.BLOCKS_GENERATED_LINE_NOTICE);

  const countedEditor = new TransactionEditor(blocksLine, { line: 0, ch: 20 });
  notices.length = 0;
  assert.equal(
    await plugin.toggleCountedLineTransclusions(
      countedEditor,
      { line: 0, ch: 20 },
      0,
    ),
    false,
  );
  assert.equal(countedEditor.content, blocksLine);
  assert.deepEqual(countedEditor.transactions, []);
  assert.equal(notices.at(-1), helpers.BLOCKS_GENERATED_LINE_NOTICE);

  const ordinaryEditor = new TransactionEditor("- [[Target]]", {
    line: 0,
    ch: 5,
  });
  notices.length = 0;
  assert.equal(
    await plugin.toggleCurrentLineTransclusions(ordinaryEditor),
    true,
  );
  assert.equal(ordinaryEditor.content, "- ![[Target]]");
  assert.equal(notices.length, 0);
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

test("counted add below a prerequisite follows BLOCKS shifts (bob-cli-95)", () => {
  const stamp = (line, dateText) => `${line} [fresh:: ${dateText || "2026-10-08"}]`;
  const content = [
    "- [ ] #task Target ^target",
    "- [ ] #task First ^first",
    "- [ ] #task Second ^second",
  ].join("\n");
  const session = Object.freeze({
    explicit: true,
    targets: Object.freeze([
      Object.freeze({ line: 1, rawLine: "- [ ] #task First ^first" }),
      Object.freeze({ line: 2, rawLine: "- [ ] #task Second ^second" }),
    ]),
  });
  const beforeSession = JSON.stringify(session);
  const dependencyTask = Object.freeze({
    line: 0,
    rawLine: "- [ ] #task Target ^target",
    existingIdField: null,
    existingBlockId: "target",
  });
  for (const blocksLinesEnabled of [false, true]) {
    const plan = helpers.planCountedLocalTaskDependency(
      content,
      session,
      dependencyTask,
      "Tasks.md",
      {
        blocksLinesEnabled,
        vaultFiles: ["Tasks.md"],
        resolveLinkpath: () => "Tasks.md",
        stampLine: stamp,
        freshDateText: "2026-10-08",
      },
    );
    assert.equal(plan.valid, true, `${blocksLinesEnabled} ${plan.error}`);
    assert.equal(plan.operation, "add");
    assert.equal(plan.targetCount, 2);
    assert.equal(plan.changedTaskCount, 2);
    // Both sources gain the dependency and a stamp; the prerequisite never
    // gains a source stamp.
    const lines = plan.content.split("\n");
    const firstIdx = lines.findIndex((line) => /#task.*\^first/.test(line));
    const secondIdx = lines.findIndex((line) => /#task.*\^second/.test(line));
    const targetIdx = lines.findIndex((line) => /#task.*\^target/.test(line));
    assert.ok(firstIdx !== -1 && secondIdx !== -1 && targetIdx !== -1);
    assert.match(lines[firstIdx], /\[dependsOn:: Tasks__target\]/);
    assert.match(lines[secondIdx], /\[dependsOn:: Tasks__target\]/);
    assert.match(lines[firstIdx], /\[fresh:: 2026-10-08\]/);
    assert.match(lines[secondIdx], /\[fresh:: 2026-10-08\]/);
    assert.doesNotMatch(lines[targetIdx], /\[fresh:: 2026-10-08\]/);
    // Generated rows never receive source stamps.
    for (const line of lines) {
      if (/DEPENDS ON|🧱 \*\*BLOCKS:\*\*/.test(line)) {
        assert.doesNotMatch(line, /\[fresh::/);
      }
    }
    if (blocksLinesEnabled) {
      const blocksRows = lines.filter((line) => /🧱 \*\*BLOCKS:\*\*/.test(line));
      assert.equal(blocksRows.length, 1, `one reverse row, saw:\n${plan.content}`);
      assert.match(blocksRows[0], /\[\[#\^first\]\]/);
      assert.match(blocksRows[0], /\[\[#\^second\]\]/);
      // The planner must not park the cursor on the generated BLOCKS line.
      const cursorText = lines[plan.cursorLine] || "";
      assert.match(cursorText, /\^first/);
      assert.doesNotMatch(cursorText, /BLOCKS/);
    } else {
      assert.doesNotMatch(plan.content, /BLOCKS/);
    }
  }
  assert.equal(JSON.stringify(session), beforeSession, "input session stays unchanged");
});

test("counted remove follows BLOCKS deletions above the sources", () => {
  const added = [
    "- [ ] #task Target [id:: Tasks__target] ^target",
    "  - \u{1f9f1} **BLOCKS:** [[#^first]] \u2022 [[#^second]]",
    "- [?] #task First [dependsOn:: Tasks__target] ^first",
    "  - \u26d3\ufe0f **DEPENDS ON:** [[#^target]]",
    "- [?] #task Second [dependsOn:: Tasks__target] ^second",
    "  - \u26d3\ufe0f **DEPENDS ON:** [[#^target]]",
  ].join("\n");
  const session = Object.freeze({
    explicit: true,
    targets: Object.freeze([
      Object.freeze({ line: 2, rawLine: "- [?] #task First [dependsOn:: Tasks__target] ^first" }),
      Object.freeze({ line: 4, rawLine: "- [?] #task Second [dependsOn:: Tasks__target] ^second" }),
    ]),
  });
  const dependencyTask = Object.freeze({
    line: 0,
    rawLine: "- [ ] #task Target [id:: Tasks__target] ^target",
    existingIdField: "Tasks__target",
    existingBlockId: "target",
  });
  const plan = helpers.planCountedLocalTaskDependency(
    added,
    session,
    dependencyTask,
    "Tasks.md",
    {
      blocksLinesEnabled: true,
      vaultFiles: ["Tasks.md"],
      resolveLinkpath: () => "Tasks.md",
    },
  );
  assert.equal(plan.valid, true, plan.error);
  assert.equal(plan.operation, "remove");
  assert.equal(plan.changedTaskCount, 2);
  assert.doesNotMatch(plan.content, /dependsOn::/);
  assert.doesNotMatch(plan.content, /DEPENDS ON/);
  assert.doesNotMatch(plan.content, /BLOCKS/);
  // Partial session: the already-linked source stays, the unlinked source
  // gains the link. The planner reports only the changed source.
  const partial = [
    "- [ ] #task Target [id:: Tasks__target] ^target",
    "  - \u{1f9f1} **BLOCKS:** [[#^first]]",
    "- [?] #task First [dependsOn:: Tasks__target] ^first",
    "  - \u26d3\ufe0f **DEPENDS ON:** [[#^target]]",
    "- [ ] #task Second ^second",
  ].join("\n");
  const partialSession = Object.freeze({
    explicit: true,
    targets: Object.freeze([
      Object.freeze({ line: 2, rawLine: "- [?] #task First [dependsOn:: Tasks__target] ^first" }),
      Object.freeze({ line: 4, rawLine: "- [ ] #task Second ^second" }),
    ]),
  });
  const mixed = helpers.planCountedLocalTaskDependency(
    partial,
    partialSession,
    dependencyTask,
    "Tasks.md",
    {
      blocksLinesEnabled: true,
      vaultFiles: ["Tasks.md"],
      resolveLinkpath: () => "Tasks.md",
    },
  );
  assert.equal(mixed.valid, true, mixed.error);
  assert.equal(mixed.operation, "add");
  assert.equal(mixed.changedTaskCount, 1);
  assert.equal(mixed.unchangedTaskCount, 1);
  const mixedLines = mixed.content.split("\n");
  const mixedSecond = mixedLines.find((line) => /#task.*\^second/.test(line));
  assert.match(mixedSecond, /\[dependsOn:: Tasks__target\]/);
});

test("counted runtime commits once with the mapped first-source cursor", async () => {
  const content = [
    "- [ ] #task Target ^target",
    "- [ ] #task First ^first",
    "- [ ] #task Second ^second",
  ].join("\n");
  const cursor = { line: 1, ch: 3 };
  const editor = new TransactionEditor(content, cursor);
  const session = helpers.discoverCountedObsidianTaskTargets(content, 1, 1);
  assert.equal(session.targets.length, 2);
  const dependencyTask = helpers
    .getOpenLocalTasks(content)
    .find((task) => task.existingBlockId === "target");
  const file = { path: "Tasks.md", extension: "md" };
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getLeavesOfType: () => [] },
    vault: { getMarkdownFiles: () => [{ path: "Tasks.md" }] },
  };
  plugin.getActiveMarkdownView = () => ({ editor, file });
  plugin.readDependencyVaultFileList = () => ["Tasks.md"];
  plugin.dependencyLinkpathResolver = () => () => "Tasks.md";
  plugin.readTasksStatusRegistry = async () => null;
  const applied = await plugin.applyCountedLocalTaskDependency(
    editor,
    cursor,
    file.path,
    session,
    dependencyTask,
    { blocksLinesEnabled: true },
  );
  assert.equal(applied, true);
  assert.equal(editor.undoGroups, 1, "one Ctrl+Z per counted gesture");
  const lines = editor.content.split("\n");
  assert.match(editor.content, /\[dependsOn:: Tasks__target\]/);
  // Cursor stays on the first source (First), never on the BLOCKS line.
  const cursorLineText = lines[editor.cursor.line] || "";
  assert.match(cursorLineText, /\^first/);
  assert.doesNotMatch(cursorLineText, /BLOCKS/);
  // Stale preimage refuses with no partial commit.
  const staleEditor = new TransactionEditor(content, cursor);
  const stalePlugin = new NavigationHotkeysPlugin();
  stalePlugin.app = plugin.app;
  stalePlugin.getActiveMarkdownView = () => ({ editor: staleEditor, file });
  staleEditor.content = content.replace("First", "First edited");
  const refused = await stalePlugin.applyCountedLocalTaskDependency(
    staleEditor,
    cursor,
    file.path,
    session,
    dependencyTask,
    { blocksLinesEnabled: true },
  );
  assert.equal(refused, false);
  assert.equal(staleEditor.undoGroups, 0);
});
