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
const { Cm6MappingEditor } = require("./cm6-mapping-editor.cjs");

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
function stubOnloadAndRegister(plugin) {
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
  return registered;
}

test("stage edit-task-dependencies registers with no default hotkey", () => {
  const { plugin } = stubPlugin({ "Tasks.md": "- [ ] #task T ^t\n" });
  const registered = stubOnloadAndRegister(plugin);
  const entry = registered.find((command) => command.id === "edit-task-dependencies");
  assert.ok(entry, "edit-task-dependencies is registered");
  assert.equal(entry.hotkeys, undefined);
});

test("task-card-depends-on registers Ctrl+Shift+B and opens the Depends on row", () => {
  const { plugin } = stubPlugin({ "Tasks.md": "- [ ] #task T ^t\n" });
  const registered = stubOnloadAndRegister(plugin);
  const entry = registered.find((command) => command.id === "task-card-depends-on");
  assert.ok(entry, "task-card-depends-on is registered");
  assert.equal(entry.name, "Task card: Blocked by (Depends on)");
  assert.deepEqual(entry.hotkeys, [{ modifiers: ["Ctrl", "Shift"], key: "B" }]);
  const opens = [];
  plugin.openBulletPropertyPicker = (editor, options) => {
    opens.push({ editor, options });
    return true;
  };
  const editor = { id: "cursor-editor" };
  entry.editorCallback(editor);
  assert.equal(opens.length, 1);
  assert.equal(opens[0].editor, editor);
  assert.deepEqual(opens[0].options, { initialTaskCardRow: "depends-on" });
});

test("task-card-blocks registers Ctrl+Shift+Alt+B and opens the Blocks row", () => {
  const { plugin } = stubPlugin({ "Tasks.md": "- [ ] #task T ^t\n" });
  const registered = stubOnloadAndRegister(plugin);
  const entry = registered.find((command) => command.id === "task-card-blocks");
  assert.ok(entry, "task-card-blocks is registered");
  assert.equal(entry.name, "Task card: Blocks (reverse Depends on)");
  assert.deepEqual(entry.hotkeys, [
    { modifiers: ["Ctrl", "Shift", "Alt"], key: "B" },
  ]);
  const opens = [];
  plugin.openBulletPropertyPicker = (editor, options) => {
    opens.push({ editor, options });
    return true;
  };
  const editor = { id: "cursor-editor" };
  entry.editorCallback(editor);
  assert.deepEqual(opens, [{ editor, options: { initialTaskCardRow: "blocks" } }]);
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


// A same-note prerequisite above the dependent gains a BLOCKS line and shifts
// the dependent down one line. The `[fresh::]` stamp and the cursor follow the
// dependent's post-write line, never the generated BLOCKS line, and the
// viewport stays put (a real CodeMirror maps both through the changes).
const TARGET_ABOVE_PARENT = [
  ...Array.from({ length: 30 }, (_, index) => `- [ ] #task Filler ${index} ^f${index}`),
  "- [ ] #task Target ^target",
  "- [ ] #task Parent ^parent",
  "- [ ] #task Tail ^tail",
].join("\n");
const PARENT_LINE = 31;

function sameNoteStageHarness() {
  const { plugin } = stubPlugin({ "Tasks.md": TARGET_ABOVE_PARENT });
  plugin.readDependencyVaultFileList = () => ["Tasks.md"];
  plugin.dependencyLinkpathResolver = () => () => "Tasks.md";
  plugin.getFreshnessStampLine = () => (line, dateText) =>
    line.replace(/( \^[\w-]+)$/, ` [fresh:: ${dateText}]$1`);
  plugin.getFreshnessDateText = () => "2026-10-18";
  plugin.app.plugins = {
    plugins: {
      "obsidian-tasks-plugin": { getState: () => "Warm", getTasks: () => [] },
    },
  };
  const editor = new Cm6MappingEditor(TARGET_ABOVE_PARENT, { line: PARENT_LINE, ch: 5 }, 12);
  plugin.getActiveMarkdownView = () => ({ editor, file: { path: "Tasks.md" } });
  plugin.app.workspace.getActiveFile = () => ({ path: "Tasks.md" });
  const modal = stubStageModal(plugin, editor, "Tasks.md", PARENT_LINE);
  return { editor, modal };
}

function assertParentStampedAndCursorKept(editor) {
  const lines = editor.getValue().split("\n");
  const parentIndex = lines.findIndex((line) => line.includes("#task Parent"));
  assert.equal(parentIndex, PARENT_LINE + 1);
  assert.match(lines[parentIndex], /\[fresh:: 2026-10-18\] \^parent$/);
  assert.equal(lines[PARENT_LINE], "\t- 🧱 **BLOCKS:** [[#^parent]]");
  assert.equal(editor.getCursor().line, parentIndex);
  assert.equal(editor.getCursor().ch, 5);
  assert.equal(editor.scrollAnchorLine, 12);
  assert.equal(editor.undoGroups, 1);
}

test("stage same-note single add stamps the dependent and keeps its cursor", async () => {
  const { editor, modal } = sameNoteStageHarness();
  const applied = await modal.chooseTaskDependency({
    path: "Tasks.md",
    line: 30,
    rawLine: "- [ ] #task Target ^target",
    displayText: "Target",
    stageSection: "results",
    disabled: false,
    alreadyLinked: false,
    needsBlockIdPrompt: false,
    blockId: "target",
  });
  assert.equal(applied, true);
  assertParentStampedAndCursorKept(editor);
});

test("stage same-note marked batch stamps the dependent and keeps its cursor", async () => {
  const { editor, modal } = sameNoteStageHarness();
  const applied = await modal.executeDependencyBatch({
    propertyName: "dependsOn",
    cursorLineText: "- [ ] #task Parent ^parent",
    removals: [],
    readyAdditions: [
      {
        markKey: "Tasks.md#30",
        path: "Tasks.md",
        line: 30,
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
  });
  assert.equal(applied, true);
  assertParentStampedAndCursorKept(editor);
});

function warmEmptyTasksCache(plugin) {
  plugin.app.plugins = {
    plugins: {
      "obsidian-tasks-plugin": { getState: () => "Warm", getTasks: () => [] },
    },
  };
}

function pressTab(modal) {
  modal.handleKeydown({
    key: "Tab",
    preventDefault() {},
    stopPropagation() {},
  });
}

function stubResultsRender(modal) {
  modal.renderResults = () => {};
}

function pluginWithOpenNotes(notes) {
  const { plugin } = stubPlugin(notes);
  const leaves = Object.entries(notes).map(([path, content]) => ({
    view: {
      file: { path, extension: "md" },
      editor: new TransactionEditor(String(content), { line: 0, ch: 0 }),
    },
  }));
  plugin.app.workspace.getLeavesOfType = (type) =>
    type === "markdown" ? leaves : [];
  return { plugin, leaves };
}

function enterHintLabel(modal) {
  const hints =
    typeof modal.getLocalTaskFooterHints === "function"
      ? modal.getLocalTaskFooterHints()
      : [];
  const hint = hints.find(
    (entry) =>
      entry &&
      Array.isArray(entry.keys) &&
      (entry.keys.includes("↵") || entry.keys.includes("\u21b5")),
  );
  return hint ? hint.label : "";
}

function highlightBlock(modal, blockId) {
  const index = modal.visibleItems.findIndex(
    (entry) => entry && entry.blockId === blockId,
  );
  assert.ok(index >= 0, `row ^${blockId} is visible`);
  modal.selectedIndex = index;
  return index;
}

async function openDependsOn(notes, filePath, cursorLine, options = {}) {
  const { plugin } = options.openNotes
    ? pluginWithOpenNotes(notes)
    : stubPlugin(notes);
  warmEmptyTasksCache(plugin);
  const editor = new TransactionEditor(String(notes[filePath] || ""), {
    line: cursorLine,
    ch: 0,
  });
  plugin.getActiveMarkdownView = () => ({
    editor,
    file: { path: filePath },
  });
  const modal = stubStageModal(plugin, editor, filePath, cursorLine);
  modal.showValueStage(modal.selectedPropertyItem);
  await sleep(25);
  stubResultsRender(modal);
  return { plugin, editor, modal };
}

const WRITE_INTRO = [
  "- [?] #task Write introduction! [id:: B__write] [dependsOn:: B__outline, B__read] ^write",
  "  - ⛓️ **DEPENDS ON:** [[#^outline]] • [[#^read]]",
  "- [ ] #task Outline the post [id:: B__outline] ^outline",
  "- [ ] #task Read sources [id:: B__read] ^read",
].join("\n");

test("Tab marks a same-note CURRENT row and Enter removes it", async () => {
  const { editor, modal } = await openDependsOn(
    { "sase_blog.md": WRITE_INTRO },
    "sase_blog.md",
    0,
  );
  const current = modal.visibleItems.find(
    (entry) => entry && entry.blockId === "read" && entry.stageSection === "current",
  );
  assert.ok(current, "CURRENT ^read is on the stage");
  const startIndex = highlightBlock(modal, "read");
  pressTab(modal);
  assert.equal(modal.getMarkedCount(), 1);
  assert.equal(modal.selectedIndex, (startIndex + 1) % modal.visibleItems.length);
  assert.match(
    modal.getVaultStageSubtitle(modal.visibleItems, modal.items),
    /1 to remove/,
  );
  assert.equal(enterHintLabel(modal), "apply 1");
  const rowEl = stubRowEl();
  modal.renderTaskValueItem(current, rowEl, "");
  assert.ok(
    rowEl.classes.includes("is-marked-remove"),
    `CURRENT row is marked for removal, got ${JSON.stringify(rowEl.classes)}`,
  );
  const applied = await modal.commitMarkedDependencies();
  assert.equal(applied, true);
  assert.doesNotMatch(editor.content, /\[\[#\^read\]\]/);
  assert.match(editor.content, /\[\[#\^outline\]\]/);
  const writeLine = String(editor.getLine(0) || "");
  assert.match(writeLine, /\[dependsOn::[^\]]*B__outline/);
  assert.doesNotMatch(writeLine, /B__read/);
  assert.equal(editor.undoGroups, 1);
});

test("Tab twice unmarks a CURRENT row", async () => {
  const { modal } = await openDependsOn(
    { "sase_blog.md": WRITE_INTRO },
    "sase_blog.md",
    0,
  );
  const startIndex = highlightBlock(modal, "read");
  pressTab(modal);
  assert.equal(modal.getMarkedCount(), 1);
  modal.selectedIndex = startIndex;
  pressTab(modal);
  assert.equal(modal.getMarkedCount(), 0);
});

test("Tab mixed CURRENT removal and RESULTS add apply in one commit", async () => {
  const content = [
    WRITE_INTRO,
    "- [ ] #task Extra candidate [id:: B__extra] ^extra",
  ].join("\n");
  const { editor, modal } = await openDependsOn(
    { "sase_blog.md": content },
    "sase_blog.md",
    0,
  );
  highlightBlock(modal, "read");
  pressTab(modal);
  const extra = modal.visibleItems.find(
    (entry) =>
      entry && entry.blockId === "extra" && entry.stageSection === "results",
  );
  assert.ok(extra, "RESULTS ^extra is on the stage");
  highlightBlock(modal, "extra");
  pressTab(modal);
  assert.equal(modal.getMarkedCount(), 2);
  const applied = await modal.commitMarkedDependencies();
  assert.equal(applied, true);
  assert.doesNotMatch(editor.content, /\[\[#\^read\]\]/);
  assert.match(editor.content, /\[\[#\^outline\]\]/);
  assert.match(editor.content, /\[\[#\^extra\]\]/);
  assert.equal(editor.undoGroups, 1);
});

test("Tab marks a missing CURRENT target and the batch removes it", async () => {
  const content = [
    "- [?] #task Write introduction! [id:: B__write] [dependsOn:: B__gone] ^write",
    "  - ⛓️ **DEPENDS ON:** [[#^gone]]",
    "- [ ] #task Outline the post [id:: B__outline] ^outline",
  ].join("\n");
  const { editor, modal } = await openDependsOn(
    { "sase_blog.md": content },
    "sase_blog.md",
    0,
  );
  const missing = modal.visibleItems.find(
    (entry) =>
      entry &&
      entry.stageSection === "current" &&
      (entry.blockId === "gone" || /not found/.test(entry.displayText || "")),
  );
  assert.ok(missing, "missing CURRENT ^gone is on the stage");
  modal.selectedIndex = modal.visibleItems.indexOf(missing);
  pressTab(modal);
  assert.equal(modal.getMarkedCount(), 1);
  const applied = await modal.commitMarkedDependencies();
  assert.equal(applied, true);
  assert.doesNotMatch(editor.content, /\[\[#\^gone\]\]/);
  assert.doesNotMatch(editor.content, /B__gone/);
});

test("Tab same-note and cross-note CURRENT removals apply in one vault batch", async () => {
  const notes = {
    "sase_blog.md": [
      "- [?] #task Write introduction! [id:: B__write] [dependsOn:: B__outline, Other__x] ^write",
      "  - ⛓️ **DEPENDS ON:** [[#^outline]] • [[Other#^x]]",
      "- [ ] #task Outline the post [id:: B__outline] ^outline",
    ].join("\n"),
    "Other.md": "- [ ] #task Cross note prereq [id:: Other__x] ^x",
  };
  const { editor, modal } = await openDependsOn(
    notes,
    "sase_blog.md",
    0,
    { openNotes: true },
  );
  const sameNote = modal.visibleItems.find(
    (entry) =>
      entry && entry.blockId === "outline" && entry.stageSection === "current",
  );
  const crossNote = modal.visibleItems.find(
    (entry) =>
      entry && entry.blockId === "x" && entry.stageSection === "current",
  );
  assert.ok(sameNote, "same-note CURRENT ^outline is on the stage");
  assert.ok(crossNote, "cross-note CURRENT ^x is on the stage");
  modal.selectedIndex = modal.visibleItems.indexOf(sameNote);
  pressTab(modal);
  modal.selectedIndex = modal.visibleItems.indexOf(crossNote);
  pressTab(modal);
  assert.equal(modal.getMarkedCount(), 2);
  const applied = await modal.commitMarkedDependencies();
  assert.equal(applied, true);
  assert.doesNotMatch(editor.content, /\[\[#\^outline\]\]/);
  assert.doesNotMatch(editor.content, /\[\[Other#\^x\]\]/);
});

