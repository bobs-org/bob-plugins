const assert = require("node:assert/strict");
const test = require("node:test");
const {
  helpers,
  collectVaultDependencyCandidates,
  indexDependencyStageNotes,
  collectDependencyStageEdges,
  planDependencyStageView,
  dependencyStageRowKey,
  validateBulletPropertyConfig,
  BulletPropertyPickerModal,
  NavigationHotkeysPlugin,
  notices,
  sleep,
  TransactionEditor,
  stubPlugin,
  stubStageModal,
  stubRowEl,
  rowTitles,
} = require("./navigation-dependencies-stage-harness.cjs");

// A `＋ id` row opens the block-ID prompt without writing: no ids are
// allocated and the editor is untouched until the id is confirmed.
test("stage +id row prompts without writing", async () => {
  const content = [
    "- [ ] #task Parent ^parent",
    "- [ ] #task Target",
  ].join("\n");
  const { plugin } = stubPlugin({ "Tasks.md": content });
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  const modal = stubStageModal(plugin, editor, "Tasks.md", 0);
  const prompts = [];
  modal.showBlockIdStage = (snapshot, options) => {
    prompts.push({ snapshot, options });
    return false;
  };
  const item = {
    path: "Tasks.md",
    line: 1,
    rawLine: "- [ ] #task Target",
    displayText: "Target",
    stageSection: "results",
    disabled: false,
    alreadyLinked: false,
    needsBlockIdPrompt: true,
  };
  const before = notices.length;
  const applied = await modal.chooseTaskDependency(item);
  assert.equal(applied, false);
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].options.mode, "single");
  assert.equal(notices.length, before);
  assert.equal(editor.content, content);
  assert.equal(editor.getLine(1), "- [ ] #task Target");
});

// Dismissing the stage mid-batch (Esc) writes nothing: dismissal drops the
// pending batch state through `onClose` and the editor is untouched.
test("stage dismissal writes no bytes and drops the batch", () => {
  const content = [
    "- [ ] #task Parent ^parent",
    "- [ ] #task Target",
  ].join("\n");
  const { plugin } = stubPlugin({ "Tasks.md": content });
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  const modal = stubStageModal(plugin, editor, "Tasks.md", 0);
  modal.pendingBatch = {
    propertyName: "dependsOn",
    cursorLineText: "- [ ] #task Parent ^parent",
    removals: [],
    readyAdditions: [],
    promptQueue: [],
    promptIndex: 0,
    confirmedById: new Map(),
    reservedIds: new Set(),
    hasVault: false,
  };
  modal.modalEl = { removeClass: () => {} };
  modal.contentEl = { empty: () => {} };
  plugin.activeBulletPropertyPicker = modal;
  modal.onClose();
  assert.equal(modal.pendingBatch, null);
  assert.equal(plugin.activeBulletPropertyPicker, null);
  assert.equal(editor.content, content);
  assert.equal(editor.undoGroups, 0);
});

// A same-note marked batch commits the line, the field, and the target id
// in a single editor transaction: one undo group for the whole gesture.
test("stage same-note batch commits in one undo group", async () => {
  const content = [
    "- [ ] #task Parent ^parent",
    "- [ ] #task Target ^target",
  ].join("\n");
  const { plugin } = stubPlugin({ "Tasks.md": content });
  plugin.readDependencyVaultFileList = () => ["Tasks.md"];
  plugin.dependencyLinkpathResolver = () => () => "Tasks.md";
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  const modal = stubStageModal(plugin, editor, "Tasks.md", 0);
  const batch = {
    propertyName: "dependsOn",
    cursorLineText: "- [ ] #task Parent ^parent",
    removals: [],
    readyAdditions: [
      {
        markKey: "Tasks.md#1",
        path: "Tasks.md",
        line: 1,
        rawLine: "- [ ] #task Target ^target",
        displayText: "Target",
        existingIdField: null,
        blockId: "target",
      },
    ],
    promptQueue: [],
    promptIndex: 0,
    confirmedById: new Map(),
    reservedIds: new Set(),
    hasVault: false,
  };
  const applied = await modal.executeDependencyBatch(batch);
  assert.equal(applied, true);
  assert.equal(editor.undoGroups, 1);
  assert.match(editor.content, /⛓️ \*\*DEPENDS ON:\*\* \[\[#\^target\]\]/);
});

// A stale marked row refuses the whole batch before any write and reopens
// the stage fresh: no partial commit, no skip count.
test("stage batch with a stale row refuses and reopens", async () => {
  const content = [
    "- [ ] #task Parent ^parent",
    "- [ ] #task Target ^target",
  ].join("\n");
  const { plugin } = stubPlugin({ "Tasks.md": content });
  plugin.readDependencyVaultFileList = () => ["Tasks.md"];
  plugin.dependencyLinkpathResolver = () => () => "Tasks.md";
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  const modal = stubStageModal(plugin, editor, "Tasks.md", 0);
  const reopened = [];
  plugin.openBulletPropertyPicker = async (reopenEditor, options) => {
    reopened.push(options);
    return true;
  };
  const batch = {
    propertyName: "dependsOn",
    cursorLineText: "- [ ] #task Parent ^parent",
    removals: [],
    readyAdditions: [
      {
        markKey: "Tasks.md#1",
        path: "Tasks.md",
        line: 1,
        rawLine: "- [ ] #task Target ^target",
        displayText: "Target",
        existingIdField: null,
        blockId: "target",
      },
    ],
    promptQueue: [],
    promptIndex: 0,
    confirmedById: new Map(),
    reservedIds: new Set(),
    hasVault: false,
  };
  editor.content = [
    "- [ ] #task Parent ^parent",
    "- [ ] #task Target edited ^target",
  ].join("\n");
  const before = notices.length;
  const applied = await modal.executeDependencyBatch(batch);
  assert.equal(applied, false);
  assert.match(notices[before], /changed — reopen/);
  assert.equal(reopened.length, 1);
  assert.equal(editor.undoGroups, 0);
  assert.doesNotMatch(editor.content, /DEPENDS ON/);
});

// A counted same-note stage add runs the real write: every source task gains
// the link together in the editor bytes, with no stubbed writer.
test("stage counted add applies to every source task", async () => {
  const content = [
    "- [ ] #task First ^first",
    "- [ ] #task Second ^second",
    "- [ ] #task Target ^target",
  ].join("\n");
  const { plugin } = stubPlugin({ "Tasks.md": content });
  plugin.app.plugins = {
    plugins: {
      "obsidian-tasks-plugin": { getState: () => "Warm", getTasks: () => [] },
    },
  };
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  plugin.getActiveMarkdownView = () => ({
    editor,
    file: { path: "Tasks.md" },
  });
  const modal = stubStageModal(plugin, editor, "Tasks.md", 0);
  modal.taskSession = {
    explicit: true,
    targets: [
      { line: 0, rawLine: "- [ ] #task First ^first" },
      { line: 1, rawLine: "- [ ] #task Second ^second" },
    ],
  };
  // Real open: the modal builds its own rows from the vault pool through
  // the production counted property items, with a stubbed Tasks plugin.
  const countedConfig = validateBulletPropertyConfig({
    properties: [{ name: "dependsOn", values: "local_task_id" }],
  });
  const aggregate = helpers.createCountedBulletPropertyItems(
    countedConfig,
    content,
    modal.taskSession,
  );
  assert.equal(aggregate.valid, true, aggregate.error || "counted items build");
  const propertyItem = aggregate.items.find(
    (entry) => entry && entry.property && entry.property.name === "dependsOn",
  );
  assert.ok(propertyItem, "Depends on opens from the counted properties");
  modal.showValueStage(propertyItem);
  await sleep(25);
  const row = modal.visibleItems.find(
    (entry) => entry && entry.displayText === "Target" && !entry.disabled,
  );
  assert.ok(row, "Target reaches the stage the modal built");
  // Real apply: the row the modal built goes through the production entry.
  const applied = await modal.chooseTaskDependency(row);
  assert.equal(applied, true);
  const links = editor.content.match(/⛓️ \*\*DEPENDS ON:\*\* \[\[#\^target\]\]/g) || [];
  assert.equal(links.length, 2, `both sources link the target:\n${editor.content}`);
  assert.equal(editor.undoGroups, 1);
});

// Cycle rows stay guarded in the view the modal actually built: every added
// edge leaves the same dependent, so each row alone closes a cycle back to
// it. Marking (⇥) a guarded row is refused, and applying (↵) writes nothing.
test("stage batch cycle rows stay guarded and write nothing", async () => {
  const content = [
    "- [ ] #task Dependent ^d",
    "- [ ] #task Alpha ^a",
    "  - ⛓️ **DEPENDS ON:** [[#^b]]",
    "- [ ] #task Beta ^b",
    "  - ⛓️ **DEPENDS ON:** [[#^d]]",
  ].join("\n");
  const { plugin } = stubPlugin({ "Tasks.md": content });
  plugin.app.plugins = {
    plugins: {
      "obsidian-tasks-plugin": { getState: () => "Warm", getTasks: () => [] },
    },
  };
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  const modal = stubStageModal(plugin, editor, "Tasks.md", 0);
  // Real open on the dependent through the production value stage.
  modal.selectedPropertyItem = {
    property: { name: "dependsOn", values: "local_task_id" },
  };
  modal.showValueStage(modal.selectedPropertyItem);
  await sleep(25);
  for (const blockId of ["a", "b"]) {
    const row = modal.visibleItems.find((entry) => entry && entry.blockId === blockId);
    assert.ok(row, `${blockId} reaches the stage the modal built`);
    assert.equal(row.disabled, true, `${blockId} stays guarded`);
    assert.match(row.disabledReason || "", /cycle/i, `${blockId} names the cycle`);
    assert.ok(row.cycle && row.cycle.length > 0, `${blockId} carries the cycle path`);
  }
  // Marking (⇥) a guarded row is refused.
  const before = notices.length;
  for (const blockId of ["a", "b"]) {
    modal.selectedIndex = modal.visibleItems.findIndex(
      (entry) => entry && entry.blockId === blockId,
    );
    modal.toggleHighlightedLocalTaskMark();
  }
  assert.equal(modal.getMarkedCount(), 0, "guarded rows never mark");
  const fresh = notices.slice(before);
  assert.equal(fresh.length, 2, `both marks refused, got: ${JSON.stringify(fresh)}`);
  for (const notice of fresh) {
    assert.match(notice, /cycle/i);
  }
  // Applying (↵) with nothing marked writes nothing.
  const applied = await modal.commitMarkedDependencies();
  assert.equal(applied, false);
  assert.equal(editor.content, content);
  assert.equal(editor.undoGroups, 0);
});

// The `edit-task-dependencies` palette command ships with no default
// hotkey: capture the real `addCommand` registration and assert it carries
// no `hotkeys`, so it opens only from the palette (or a user-bound chord).
test("stage edit-task-dependencies registers with no default hotkey", () => {
  const { plugin } = stubPlugin({ "Tasks.md": "- [ ] #task T ^t\n" });
  const registered = [];
  plugin.addCommand = (command) => {
    registered.push(command);
    return command;
  };
  plugin.addRibbonIcon = () => ({});
  plugin.registerEvent = () => {};
  plugin.registerDomEvent = () => {};
  plugin.registerInterval = () => {};
  plugin.registerEditorExtension = () => {};
  plugin.registerVimMappingsWhenReady = () => {};
  plugin.register = () => {};
  plugin.registerOpenTaskJumpInputListeners = () => {};
  plugin.registerReviewRefreshInputListeners = () => {};
  plugin.registerCountedTransclusionToggleInputListeners = () => {};
  plugin.registerCountedBulletPropertyInputListeners = () => {};
  plugin.registerCountedTaskMoveInputListeners = () => {};
  plugin.registerCountedLaneToggleInputListeners = () => {};
  plugin.registerClearSearchHighlightInputListeners = () => {};
  plugin.app.workspace.onLayoutReady = () => {};
  plugin.app.workspace.on = () => ({});
  plugin.app.workspace.getActiveFile = () => null;
  plugin.onload();
  const entry = registered.find((command) => command.id === "edit-task-dependencies");
  assert.ok(entry, "edit-task-dependencies is registered");
  assert.equal(entry.hotkeys, undefined);
});

// The BLOCKED `🔒 waits on N` badge counts open prerequisites only: one
// closed plus one open prerequisite reads `waits on 1` (DC7/DC8).
test("stage waits-on badge counts open prerequisites only", () => {
  const content = [
    "- [ ] #task Owner ^owner",
    "- [?] #task Beta ^beta",
    "  - ⛓️ **DEPENDS ON:** [[#^alpha]] [[#^gamma]]",
    "- [ ] #task Alpha ^alpha",
    "- [x] #task Gamma ^gamma",
  ].join("\n");
  const notes = [{ path: "Tasks.md", content }];
  const plugin = new NavigationHotkeysPlugin();
  plugin.collectStageBufferNotes = () => [];
  plugin.readStageTasksCache = () => ({ ready: false, tasks: [] });
  const stage = plugin.buildVaultDependencyStageFromNotes(notes, {
    filePath: "Tasks.md",
    content,
    parentLines: [0],
  });
  const beta = stage.candidates.find(
    (candidate) => candidate.blockId === "beta",
  );
  assert.ok(beta, "Beta reaches the stage pool");
  assert.equal(beta.openCount, 1);
  const view = planDependencyStageView({
    current: [],
    candidates: stage.candidates,
    query: "Beta",
    dependent: {
      path: "Tasks.md",
      line: 0,
      key: dependencyStageRowKey("Tasks.md", "owner"),
    },
    edges: stage.edges,
    linkedKeys: new Set(),
  });
  const row = view.find((entry) => entry.blockId === "beta");
  assert.ok(row, "Beta renders in the stage view");
  assert.equal(row.stageSection, "blocked");
  assert.equal(row.waitsOn, 1);
});

// Disabled cycle rows tooltip the readable path: task descriptions joined
// by `→`, never raw `path blockId` keys.
test("stage cycle tooltip shows task descriptions", () => {
  const notes = [
    {
      path: "a.md",
      content: "- [ ] #task Alpha ^alpha\n",
    },
    {
      path: "b.md",
      content: [
        "- [?] #task Beta ^beta",
        "  - ⛓️ **DEPENDS ON:** [[a#^alpha]]",
      ].join("\n"),
    },
  ];
  const index = indexDependencyStageNotes(notes);
  const edges = collectDependencyStageEdges(notes, index);
  const pool = collectVaultDependencyCandidates(notes, {
    dependentPath: "a.md",
    dependentLines: new Set([0]),
  });
  const view = planDependencyStageView({
    current: [],
    candidates: pool,
    query: "Beta",
    dependent: {
      path: "a.md",
      line: 0,
      key: dependencyStageRowKey("a.md", "alpha"),
      displayText: "Alpha",
      text: "Alpha",
    },
    edges,
    linkedKeys: new Set(),
  });
  const beta = view.find((row) => row.blockId === "beta");
  assert.ok(beta, "Beta reaches the stage with a matching query");
  assert.equal(beta.disabledReason, "would create a cycle");
  assert.deepEqual(beta.cycleLabels, ["Beta", "Alpha"]);
  const picker = { markedLines: new Set() };
  const rowEl = stubRowEl();
  BulletPropertyPickerModal.prototype.renderTaskValueItem.call(
    picker,
    beta,
    rowEl,
    "Beta",
  );
  assert.ok(
    rowTitles(rowEl).includes("Beta → Alpha"),
    `cycle tooltip reads Beta → Alpha, got ${JSON.stringify(rowTitles(rowEl))}`,
  );
});

