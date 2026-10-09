const test = require("node:test");
const assert = require("node:assert/strict");
const {
  TaskStatusCyclerPlugin,
  helpers,
  MarkdownView,
  notices,
  createInMemoryObsidianApp,
  getEmbeddedTarget,
  createTextEditor,
  attachActiveMarkdownView,
} = require("./task-status-cycler-harness.cjs");

test("direct Done Tasks task reopens through the metadata-aware fallback", () => {
  const editor = createTextEditor(
    "- [x] #task Finished [completion:: 2026-07-11] ^finished",
    { line: 0, ch: 4 },
  );
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = {
    commands: { commands: {}, executeCommandById: () => false },
  };
  assert.equal(plugin.toggleActiveCheckboxOpenDone(editor), true);
  assert.equal(editor.getValue(), "- [ ] #task Finished ^finished");
});

test("recursive completion status policy includes Next without broadening excluded statuses", () => {
  const cases = [
    { symbol: " ", traversable: true, closable: true },
    { symbol: "*", traversable: true, closable: true },
    { symbol: "/", traversable: true, closable: true },
    { symbol: "x", traversable: true, closable: false },
    { symbol: "-", traversable: false, closable: false },
    { symbol: "?", traversable: false, closable: false },
  ];

  for (const { symbol, traversable, closable } of cases) {
    const taskStatus = helpers.getTaskStatusForLine(`- [${symbol}] #task Example`);
    assert.equal(
      helpers.isTranscludedCompletionTraversableStatus(taskStatus),
      traversable,
      `traversability for [${symbol}]`,
    );
    assert.equal(
      helpers.isTranscludedCompletionClosableStatus(taskStatus),
      closable,
      `closability for [${symbol}]`,
    );
  }

  assert.equal(helpers.isTranscludedCompletionTraversableStatus(null), false);
  assert.equal(helpers.isTranscludedCompletionClosableStatus(null), false);
});

test("recursive completion closes a Next root and its nested Next descendant", async () => {
  const harness = createInMemoryObsidianApp({
    "Daily.md": "## Pomodoros\n- [ ] Focus\n\t- ![[Root#^root]]",
    "Root.md": [
      "- [*] #task Parent [priority:: high] [completion:: stale] ^root",
      "\t- ![[#^child]]",
      "- [*] #task Child keeps metadata [effort:: 2] ^child",
    ].join("\n"),
  });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  plugin.getCompletionDateString = () => "2026-07-11";

  const result = await plugin.completeTranscludedTaskTargetTree(
    getEmbeddedTarget("![[Root#^root]]"),
    { activePath: "Daily.md", originPath: "Daily.md", editor: null },
    new Set(),
  );

  assert.deepEqual(result, {
    visited: true,
    changed: true,
    closed: [
      { path: "Root.md", blockId: "child" },
      { path: "Root.md", blockId: "root" },
    ],
  });
  assert.equal(
    harness.getSource("Root.md"),
    [
      "- [x] #task Parent [priority:: high]  [completion:: 2026-07-11] ^root",
      "\t- ![[#^child]]",
      "- [x] #task Child keeps metadata [effort:: 2]  [completion:: 2026-07-11] ^child",
    ].join("\n"),
  );
});

test("recursive completion traverses Done parents and skips excluded siblings", async () => {
  const harness = createInMemoryObsidianApp({
    "Daily.md": "## Pomodoros\n- [ ] Focus\n\t- ![[Tree#^parent]]",
    "Tree.md": [
      "- [x] #task Already done ^parent",
      "\t- ![[#^canceled]]",
      "\t- ![[#^custom]]",
      "\t- ![[#^next]]",
      "- [-] #task Canceled ^canceled",
      "- [?] #task Custom ^custom",
      "- [*] #task Eligible sibling ^next",
    ].join("\n"),
  });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  plugin.getCompletionDateString = () => "2026-07-11";

  const result = await plugin.completeTranscludedTaskTargetTree(
    getEmbeddedTarget("![[Tree#^parent]]"),
    { activePath: "Daily.md", originPath: "Daily.md", editor: null },
    new Set(),
  );

  assert.deepEqual(result, {
    visited: true,
    changed: true,
    closed: [{ path: "Tree.md", blockId: "next" }],
  });
  assert.equal(
    harness.getSource("Tree.md"),
    [
      "- [x] #task Already done ^parent",
      "\t- ![[#^canceled]]",
      "\t- ![[#^custom]]",
      "\t- ![[#^next]]",
      "- [-] #task Canceled ^canceled",
      "- [?] #task Custom ^custom",
      "- [x] #task Eligible sibling  [completion:: 2026-07-11] ^next",
    ].join("\n"),
  );
});

test("closed-reference retirement is ancestry-aware, resolved, fenced, and idempotent", () => {
  const source = [
    "- [ ] #task Parent ^parent",
    "\t- ![[#^local|Local]] and ![[Projects/Alpha#^review|Review]]",
    "\t\t- ~~![[Alpha#^review|Stale embed]]~~",
    "- Unmanaged tree",
    "\t- ![[Alpha#^review|Protected]]",
    "```md",
    "- [ ] #task Example ^fake",
    "\t- ![[Alpha#^review|Fenced]]",
    "```",
    "## Pomodoros",
    "- [ ] Focus",
    "  - Prefix ![[Alpha#^review|One]] and ![[Beta#^other]] suffix",
    "## Notes",
    "- prose ![[Alpha#^review|Not a descendant]]",
  ].join("\r\n");
  const resolve = (pathPart) => {
    if (pathPart === "Projects/Alpha" || pathPart === "Alpha") {
      return "Projects/Alpha.md";
    }
    if (pathPart === "Beta") return "Beta.md";
    return null;
  };
  const closed = [
    { path: "Tasks.md", blockId: "local" },
    { path: "Projects/Alpha.md", blockId: "review" },
  ];
  const result = helpers.retireClosedTaskReferencesInText(
    source,
    "Tasks.md",
    closed,
    resolve,
  );
  assert.equal(result.retired, 4);
  assert.match(result.text, /~~\[\[#\^local\|Local\]\]~~/);
  assert.match(result.text, /~~\[\[Projects\/Alpha#\^review\|Review\]\]~~/);
  assert.match(result.text, /~~\[\[Alpha#\^review\|Stale embed\]\]~~/);
  assert.match(result.text, /Prefix ~~\[\[Alpha#\^review\|One\]\]~~ and !\[\[Beta/);
  assert.match(result.text, /\t- !\[\[Alpha#\^review\|Protected\]\]/);
  assert.match(result.text, /!\[\[Alpha#\^review\|Fenced\]\]/);
  assert.equal(result.text.includes("\r\n"), true);
  const second = helpers.retireClosedTaskReferencesInText(
    result.text,
    "Tasks.md",
    closed,
    resolve,
  );
  assert.equal(second.changed, false);
  assert.equal(second.retired, 0);
});

test("reopened-reference restoration is ancestry-aware, conservative, and idempotent", () => {
  const source = [
    "- [ ] #task Parent [dependsOn:: Projects__Alpha__review] ^parent",
    "\t- ~~[[#^local|Local alias]]~~ and ~~[[Projects/Alpha#^review|Review]]~~",
    "\t- ~~before [[Alpha#^review|Broad task strike]] after~~",
    "\t- [[Alpha#^review|Already live]] and ~~[[Missing#^review|Unresolved]]~~",
    "- Unmanaged tree",
    "\t- ~~[[Alpha#^review|Protected]]~~",
    "```md",
    "- [ ] #task Example",
    "\t- ~~[[Alpha#^review|Fenced]]~~",
    "```",
    "## Pomodoros",
    "- [x] History",
    "\t- 🍅 ~~[[Alpha#^review|History alias]]~~ and ~~[[Alpha#^review|Again]]~~",
    "\t- ~~before [[Alpha#^review|Broad history strike]] after~~",
  ].join("\r\n");
  const resolve = (pathPart) => {
    if (pathPart === "Projects/Alpha" || pathPart === "Alpha") {
      return "Projects/Alpha.md";
    }
    return null;
  };
  const reopened = [
    { path: "Tasks.md", blockId: "local" },
    { path: "Projects/Alpha.md", blockId: "review" },
  ];
  const result = helpers.restoreReopenedTaskReferencesInText(
    source,
    "Tasks.md",
    reopened,
    resolve,
  );
  assert.equal(result.restored, 5);
  assert.match(result.text, /!\[\[#\^local\|Local alias\]\]/);
  assert.match(result.text, /!\[\[Projects\/Alpha#\^review\|Review\]\]/);
  assert.match(
    result.text,
    /~~before !\[\[Alpha#\^review\|Broad task strike\]\] after~~/,
  );
  assert.match(result.text, /\[\[Alpha#\^review\|Already live\]\]/);
  assert.match(result.text, /~~\[\[Missing#\^review\|Unresolved\]\]~~/);
  assert.match(result.text, /- Unmanaged tree\r\n\t- ~~\[\[Alpha/);
  assert.match(result.text, /```md\r\n- \[ \] #task Example\r\n\t- ~~\[\[Alpha/);
  assert.match(
    result.text,
    /🍅 \[\[Alpha#\^review\|History alias\]\] and \[\[Alpha#\^review\|Again\]\]/,
  );
  assert.match(
    result.text,
    /~~before \[\[Alpha#\^review\|Broad history strike\]\] after~~/,
  );
  assert.match(
    result.text,
    /\[dependsOn:: Projects__Alpha__review\] \^parent/,
  );
  assert.equal(result.text.includes("\r\n"), true);
  const second = helpers.restoreReopenedTaskReferencesInText(
    result.text,
    "Tasks.md",
    reopened,
    resolve,
  );
  assert.equal(second.changed, false);
  assert.equal(second.restored, 0);
});

test("retirement preserves task-tree markers and unmarks Pomodoro embeds", () => {
  const source = [
    "- [ ] #task Parent",
    "  - 🍅 ![[A#^done|Task tree]]",
    "## Pomodoros",
    "- [ ] Open",
    "  - 🍅 ![[A#^done|Open session]]",
    "- [x] Done",
    "  - ![[A#^done|Done session]]",
  ].join("\n");
  const result = helpers.retireClosedTaskReferencesInText(
    source,
    "Daily.md",
    [{ path: "A.md", blockId: "done" }],
    () => "A.md",
  );
  assert.match(result.text, /- 🍅 ~~\[\[A#\^done\|Task tree\]\]~~/);
  assert.match(result.text, /- \[ \] Open\n  - ~~\[\[A#\^done\|Open session\]\]~~/);
  assert.match(result.text, /- \[x\] Done\n  - ~~\[\[A#\^done\|Done session\]\]~~/);
});

test("done Pomodoro retirement removes only the matching embedded marker", () => {
  const source = [
    "## Pomodoros",
    "- [x] Done",
    "  - 🍅 ![[A#^done|Retire]] and 🍅 [[B#^live|Preserve]]",
    "  - 🍅 ~~![[A#^done|Stale embed]]~~ and ~~[[C#^history]]~~",
  ].join("\n");
  const result = helpers.retireClosedTaskReferencesInText(
    source,
    "Daily.md",
    [{ path: "A.md", blockId: "done" }],
    () => "A.md",
  );
  assert.equal(
    result.text,
    [
      "## Pomodoros",
      "- [x] Done",
      "  - ~~[[A#^done|Retire]]~~ and 🍅 [[B#^live|Preserve]]",
      "  - ~~[[A#^done|Stale embed]]~~ and ~~[[C#^history]]~~",
    ].join("\n"),
  );
  const second = helpers.retireClosedTaskReferencesInText(
    result.text,
    "Daily.md",
    [{ path: "A.md", blockId: "done" }],
    () => "A.md",
  );
  assert.equal(second.changed, false);
  assert.equal(second.retired, 0);
});

test("retirement stops at prose boundaries and pairs strikethrough spans", () => {
  const source = [
    "- [ ] #task Parent",
    "Paragraph separating the following list.",
    "  - ![[A#^review|Protected]]",
    "- [ ] #task Other",
    "  - ~~before~~![[A#^review|Retire]]~~after~~",
    "  - ~~![[A#^review|Already struck]]~~",
  ].join("\n");
  const result = helpers.retireClosedTaskReferencesInText(
    source,
    "Tasks.md",
    [{ path: "A.md", blockId: "review" }],
    () => "A.md",
  );
  assert.equal(result.retired, 2);
  assert.match(result.text, /  - !\[\[A#\^review\|Protected\]\]/);
  assert.match(
    result.text,
    /~~before~~ ~~\[\[A#\^review\|Retire\]\]~~ ~~after~~/,
  );
  assert.match(result.text, /~~\[\[A#\^review\|Already struck\]\]~~/);
});

test("retired Pomodoro links are not copied into the next Pomodoro", () => {
  const lines = [
    "## Pomodoros",
    "- [ ] First",
    "  - ~~[[Tasks#^done|Done]]~~",
    "- [ ] Second",
  ];
  const section = helpers.findPomodorosSectionInLines(lines);
  const plan = helpers.buildPomodoroCompletionPlan(lines, section, 1);
  assert.deepEqual(plan.copiedBulletLines, []);
  assert.equal(plan.createdPomodoro, false);
});

test("retirement coordinator rewrites active editor and vault notes together", async () => {
  const harness = createInMemoryObsidianApp({
    "Daily.md": "## Pomodoros\n- [x] Focus\n  - ![[Tasks#^done|Done]]",
    "Tasks.md": [
      "- [x] #task Done ^done",
      "  - ![[#^done|Self reference]]",
    ].join("\n"),
  });
  let activeText = harness.getSource("Daily.md");
  let cursor = { line: 2, ch: 4 };
  const editor = {
    getValue: () => activeText,
    getCursor: () => cursor,
    setCursor: (next) => { cursor = next; },
    getLine: (line) => activeText.split("\n")[line] || "",
    replaceRange: (text, from, to) => {
      const lines = activeText.split("\n");
      lines[from.line] = `${lines[from.line].slice(0, from.ch)}${text}${lines[to.line].slice(to.ch)}`;
      activeText = lines.join("\n");
    },
  };
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  const result = await plugin.retireClosedTaskReferences(
    [{ path: "Tasks.md", blockId: "done" }],
    { editor, activePath: "Daily.md" },
  );
  assert.equal(result.retired, 2);
  assert.match(activeText, /  - ~~\[\[Tasks#\^done\|Done\]\]~~/);
  assert.match(harness.getSource("Tasks.md"), /~~\[\[#\^done\|Self reference\]\]~~/);
});

test("restoration coordinator rewrites active and vault notes, preserves the cursor, and isolates failures", async () => {
  notices.length = 0;
  const harness = createInMemoryObsidianApp({
    "Daily.md": "## Pomodoros\n- [x] Focus\n  - 🍅 ~~[[Tasks#^done|Done]]~~",
    "Tasks.md": [
      "- [ ] #task Parent",
      "  - ~~[[#^done|Dependency]]~~",
      "- [ ] #task Reopened ^done",
    ].join("\n"),
    "Broken.md": "- [ ] #task Parent\n  - ~~[[Tasks#^done]]~~",
  });
  const originalCachedRead = harness.app.vault.cachedRead;
  harness.app.vault.cachedRead = async (file) => {
    if (file.path === "Broken.md") throw new Error("unreadable");
    return originalCachedRead(file);
  };
  const editor = createTextEditor(harness.getSource("Daily.md"), {
    line: 2,
    ch: 8,
  });
  const originalCursor = editor.getCursor();
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  const result = await plugin.restoreReopenedTaskReferences(
    [
      { path: "Tasks.md", blockId: "done" },
      { path: "Tasks.md", blockId: "done" },
      { path: "Tasks.md" },
    ],
    { editor, activePath: "Daily.md" },
  );
  assert.equal(result.restored, 2);
  assert.equal(result.failures.length, 1);
  assert.match(editor.getValue(), /🍅 \[\[Tasks#\^done\|Done\]\]/);
  assert.match(harness.getSource("Tasks.md"), /!\[\[#\^done\|Dependency\]\]/);
  assert.deepEqual(editor.getCursor(), originalCursor);
  assert.match(notices.at(-1), /Reopened tasks, but 1 note/);
});

test("close and reopen reference mutations share one serialized queue", async () => {
  const plugin = new TaskStatusCyclerPlugin();
  const order = [];
  let releaseRetirement;
  const retirementGate = new Promise((resolve) => {
    releaseRetirement = resolve;
  });
  plugin.retireClosedTaskReferencesNow = async (identities) => {
    order.push(`retire:${identities.length}`);
    await retirementGate;
    return { retired: 0, failures: [] };
  };
  plugin.restoreReopenedTaskReferencesNow = async (identities) => {
    order.push(`restore:${identities.length}`);
    return { restored: 0, failures: [] };
  };
  const identities = [
    { path: "Tasks.md", blockId: "same" },
    { path: "Tasks.md", blockId: "same" },
  ];
  const retiring = plugin.retireClosedTaskReferences(identities, {});
  const restoring = plugin.restoreReopenedTaskReferences(identities, {});
  await Promise.resolve();
  assert.deepEqual(order, ["retire:1"]);
  releaseRetirement();
  await Promise.all([retiring, restoring]);
  assert.deepEqual(order, ["retire:1", "restore:1"]);
});

test("post-close finalizer serializes dependent recovery before reference retirement", async () => {
  const plugin = new TaskStatusCyclerPlugin();
  const order = [];
  plugin.recoverBlockedDependentsNow = async (identities) => {
    order.push(`recover:${identities.length}`);
    return { reopened: 1, failures: [] };
  };
  plugin.retireClosedTaskReferencesNow = async (identities) => {
    order.push(`retire:${identities.length}`);
    return { retired: 2, failures: [] };
  };
  const result = await plugin.finalizeClosedTasks(
    [{ path: "Tasks.md", blockId: "root", taskId: "root-id" }],
    {},
  );
  assert.deepEqual(order, ["recover:1", "retire:1"]);
  assert.deepEqual(result, {
    reopened: 1,
    retired: 2,
    recoveryFailures: [],
    retirementFailures: [],
    successors: null,
    successorNotice: null,
  });
});

test("dependent recovery uses live editor buffers and preserves the cursor", async () => {
  const disk = [
    "- [ ] #task Root [id:: root] ^root",
    "- [?] #task Dependent [dependsOn:: root] ^dependent",
  ].join("\n");
  const live = disk.replace("- [ ] #task Root", "- [x] #task Root");
  const harness = createInMemoryObsidianApp({ "Tasks.md": disk });
  const editor = createTextEditor(live, { line: 1, ch: 18 });
  const plugin = new TaskStatusCyclerPlugin();
  attachActiveMarkdownView(plugin, harness, editor, "Tasks.md");
  const cursor = editor.getCursor();

  const result = await plugin.recoverBlockedDependentsNow(
    [{ path: "Tasks.md", blockId: "root" }],
    { editor, activePath: "Tasks.md" },
  );
  assert.equal(result.reopened, 1);
  assert.match(editor.getValue(), /^- \[ \] #task Dependent/m);
  assert.deepEqual(editor.getCursor(), cursor);
  assert.equal(harness.getSource("Tasks.md"), disk);
  const second = await plugin.recoverBlockedDependentsNow(
    [{ path: "Tasks.md", taskId: "root" }],
    { editor, activePath: "Tasks.md" },
  );
  assert.equal(second.reopened, 0);
});

test("dependent recovery preserves successful siblings across stale and failed notes", async () => {
  notices.length = 0;
  const harness = createInMemoryObsidianApp({
    "Closed.md": "- [x] #task Root [id:: root] ^root",
    "Good.md": "- [?] #task Good [dependsOn:: root] ^good",
    "Stale.md": "- [?] #task Stale [dependsOn:: root] ^stale",
    "BrokenRead.md": "- [?] #task Unreadable [dependsOn:: root] ^unreadable",
    "BrokenWrite.md": "- [?] #task Unwritable [dependsOn:: root] ^unwritable",
  });
  const cachedRead = harness.app.vault.cachedRead;
  harness.app.vault.cachedRead = async (file) => {
    if (file.path === "BrokenRead.md") throw new Error("read failed");
    return cachedRead(file);
  };
  const process = harness.app.vault.process;
  harness.app.vault.process = async (file, updateSourceText) => {
    if (file.path === "BrokenWrite.md") throw new Error("write failed");
    if (file.path === "Stale.md") {
      return process(file, (text) =>
        updateSourceText(text.replace("Stale", "Stale changed")),
      );
    }
    return process(file, updateSourceText);
  };
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  const result = await plugin.recoverBlockedDependentsNow(
    [{ path: "Closed.md", blockId: "root" }],
    {},
  );
  assert.equal(result.reopened, 1);
  assert.equal(result.failures.length, 3);
  assert.match(harness.getSource("Good.md"), /^- \[ \] #task Good/);
  assert.match(harness.getSource("Stale.md"), /^- \[\?\] #task Stale changed/);
  assert.match(harness.getSource("BrokenWrite.md"), /^- \[\?\]/);
  assert.match(notices.at(-1), /3 notes could not be checked/);
});

test("no-op vault transforms and irrelevant retirement files avoid process writes", async () => {
  let processCalls = 0;
  const file = { path: "Notes.md" };
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = {
    vault: {
      getMarkdownFiles: () => [file],
      cachedRead: async () => "No dependency links here",
      process: async () => { processCalls += 1; },
    },
    metadataCache: {},
  };
  assert.equal(await plugin.processVaultFileText(file, (text) => text), false);
  await plugin.retireClosedTaskReferences(
    [{ path: "Tasks.md", blockId: "done" }, { path: "Tasks.md" }],
    {},
  );
  assert.equal(processCalls, 0);
});

test("ambiguity scans and notices are cached while dependency identity lines stay stable", async () => {
  notices.length = 0;
  let reads = 0;
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = {
    vault: {
      getMarkdownFiles: () => [{ path: "Other.md" }],
      cachedRead: async () => {
        reads += 1;
        return "ordinary prose";
      },
    },
  };
  const file = { path: "Tasks.md" };
  const first = await plugin.findAmbiguousDependencyIds(
    ["abc123"],
    file,
    "- [ ] #task Target [id:: abc123] ^target\nfirst prose",
  );
  const second = await plugin.findAmbiguousDependencyIds(
    ["abc123"],
    file,
    "- [ ] #task Target [id:: abc123] ^target\nchanged prose",
  );
  assert.deepEqual([...first], []);
  assert.deepEqual([...second], []);
  assert.equal(reads, 1);

  plugin.notifyDependencyIssue(file, "ambiguity", ["duplicate"]);
  plugin.notifyDependencyIssue(file, "ambiguity", ["duplicate"]);
  assert.equal(notices.length, 1);
});

test("non-Vim open/done command finalizes the closed task identity", async () => {
  const plugin = new TaskStatusCyclerPlugin();
  const taskStatus = helpers.getTaskStatusForLine(
    "- [ ] #task Close through command ^close",
  );
  const editor = {};
  const view = Object.assign(new MarkdownView(), {
    editor,
    file: { path: "Tasks.md" },
  });
  plugin.app = { workspace: { getActiveFile: () => view.file } };
  plugin.getActiveTaskStatus = () => taskStatus;
  plugin.toggleActiveCheckboxOpenDone = () => true;
  let finalized = null;
  plugin.finalizeClosedTasks = async (identities) => { finalized = identities; };

  assert.equal(plugin.handleToggleOpenDoneCommand(false, editor, view), true);
  await Promise.resolve();
  assert.deepEqual(finalized, [{ path: "Tasks.md", blockId: "close" }]);
});

test("non-Vim open/done command restores the reopened task identity", async () => {
  const plugin = new TaskStatusCyclerPlugin();
  const taskStatus = helpers.getTaskStatusForLine(
    "- [x] #task Reopen through command [completion:: stale] ^reopen",
  );
  const editor = {};
  const view = Object.assign(new MarkdownView(), {
    editor,
    file: { path: "Tasks.md" },
  });
  plugin.app = { workspace: { getActiveFile: () => view.file } };
  plugin.getActiveTaskStatus = () => taskStatus;
  plugin.toggleActiveCheckboxOpenDone = () => true;
  let restored = null;
  plugin.restoreReopenedTaskReferences = async (identities) => {
    restored = identities;
  };

  assert.equal(plugin.handleToggleOpenDoneCommand(false, editor, view), true);
  await Promise.resolve();
  assert.deepEqual(restored, [{ path: "Tasks.md", blockId: "reopen" }]);
});

test("full Pomodoro completion retires embeds only after carry-forward planning", async () => {
  const daily = [
    "## Pomodoros",
    "- [ ] Focus",
    "\t- ![[Root#^root|Finished work]]",
    "\t- [[Continue#^continue|Carry forward]]",
    "\t- Mix ![[Mixed#^mixed|Retire mixed]] with [[Continue#^other|Do not copy]]",
  ].join("\n");
  const harness = createInMemoryObsidianApp({
    "Daily.md": daily,
    "Root.md": "- [ ] #task Root ^root",
    "Continue.md": [
      "- [ ] #task Continue ^continue",
      "- [ ] #task Other ^other",
    ].join("\n"),
    "Mixed.md": "- [ ] #task Mixed ^mixed",
  });
  const editor = createTextEditor(daily, { line: 1, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  plugin.getCompletionDateString = () => "2026-07-11";
  plugin.scheduleCenterEditorLineInView = () => {};

  assert.equal(
    await plugin.completeActivePomodoroTask(
      editor,
      { path: "Daily.md" },
      { pomodoroLine: 1 },
    ),
    true,
  );
  assert.match(harness.getSource("Root.md"), /^- \[x\] #task Root/);
  assert.match(
    editor.getValue(),
    /- \[x\] Focus\n\t- ~~\[\[Root#\^root\|Finished work\]\]~~\n\t- 🍅 \[\[Continue#\^continue\|Carry forward\]\]\n\t- Mix ~~\[\[Mixed#\^mixed\|Retire mixed\]\]~~ with 🍅 \[\[Continue#\^other\|Do not copy\]\]/,
  );
  assert.equal((editor.getValue().match(/Root#\^root/g) || []).length, 1);
  assert.equal((editor.getValue().match(/Mixed#\^mixed/g) || []).length, 1);
  assert.equal((editor.getValue().match(/Continue#\^continue/g) || []).length, 2);
  assert.equal((editor.getValue().match(/Continue#\^other/g) || []).length, 1);
  assert.match(
    editor.getValue(),
    /- \[ \] \(\)\n\t- \[\[Continue#\^continue\|Carry forward\]\]$/,
  );
  assert.deepEqual(editor.getCursor(), { line: 5, ch: 7 });
  assert.match(harness.getSource("Continue.md"), /^- \[\/\] #task Continue/m);
});

test("full Pomodoro completion recovers after a deduplicated multi-target batch", async () => {
  const daily = [
    "## Pomodoros",
    "- [ ] Focus",
    "\t- ![[A#^a]]",
    "\t- ![[A#^a|Repeated]]",
    "\t- ![[B#^b]]",
  ].join("\n");
  const harness = createInMemoryObsidianApp({
    "Daily.md": daily,
    "A.md": "- [ ] #task A [id:: a] ^a",
    "B.md": "- [/] #task B (id:: b) ^b",
    "Dependent.md": "- [?] #task Dependent [dependsOn:: a, b] ^dependent",
  });
  const editor = createTextEditor(daily, { line: 1, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  plugin.getCompletionDateString = () => "2026-07-16";
  plugin.scheduleCenterEditorLineInView = () => {};

  assert.equal(
    await plugin.completeActivePomodoroTask(
      editor,
      harness.app.vault.getAbstractFileByPath("Daily.md"),
    ),
    true,
  );
  assert.match(harness.getSource("A.md"), /^- \[x\] #task A/m);
  assert.match(harness.getSource("B.md"), /^- \[x\] #task B/m);
  assert.match(harness.getSource("Dependent.md"), /^- \[ \] #task Dependent/m);
});

test("full Pomodoro completion moves a marked same-note link without history", async () => {
  const daily = [
    "- [ ] #task Target ^gtd",
    "## Pomodoros",
    "- [ ] (**1110-1135** [t:: 25m])",
    "  - [[#^gtd]]#",
    "  - foo bar baz",
  ].join("\n");
  const harness = createInMemoryObsidianApp({ "Daily.md": daily });
  const editor = createTextEditor(daily, { line: 2, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  plugin.scheduleCenterEditorLineInView = () => {};

  assert.equal(
    await plugin.completeActivePomodoroTask(
      editor,
      { path: "Daily.md" },
      { pomodoroLine: 2 },
    ),
    true,
  );
  assert.equal(
    editor.getValue(),
    [
      "- [ ] #task Target ^gtd",
      "## Pomodoros",
      "- [x] (**1110-1135** [t:: 25m])",
      "  - foo bar baz",
      "- [ ] ()",
      "  - [[#^gtd]]",
    ].join("\n"),
  );
  assert.deepEqual(editor.getCursor(), { line: 4, ch: 7 });
  assert.equal((editor.getValue().match(/#\^gtd/g) || []).length, 1);
  assert.equal((editor.getValue().match(/- \[ \] \(\)/g) || []).length, 1);
  assert.equal(editor.getValue().includes("]]#"), false);
  assert.equal(editor.getValue().includes("🍅"), false);
});

