// Task Card relation actions and both stage directions (`docs/task-relations.md`
// LG1–LG15; bob-cli-a2.11/a2.12).
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

function parseTestYaml(text) {
  const result = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#") || /^\s/.test(line)) {
      continue;
    }
    const match = /^([^:]+):(.*)$/.exec(line);
    if (!match) {
      throw new Error("malformed yaml");
    }
    result[match[1].trim()] = match[2].trim() || null;
  }
  return result;
}

const notices = [];
const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    class EmptyClass {}
    class TestModal {
      constructor(app) {
        this.app = app;
        this.contentEl = { empty: () => {} };
        this.modalEl = { removeClass: () => {} };
      }
    }
    return {
      MarkdownView: EmptyClass,
      Modal: TestModal,
      Notice: class {
        constructor(message) {
          notices.push(String(message));
        }
      },
      Plugin: EmptyClass,
      parseYaml: parseTestYaml,
    };
  }
  if (request === "@codemirror/view") {
    return { EditorView: class EditorView {} };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const NavigationHotkeysPlugin = require("../plugins/bob-navigation-hotkeys/main.js");
const { helpers } = NavigationHotkeysPlugin;
Module._load = originalLoad;

const BASE_DATE = new Date(2026, 9, 3);

function buildConfig() {
  const config = helpers.validateBulletPropertyConfig({
    properties: [
      { name: "scheduled", values: "date" },
      {
        name: "priority",
        values: "priority",
        schedules: "scheduled",
        levels: [
          { label: "P1", value: "high", min_days: 2, max_days: 7 },
          { label: "P2", value: "medium", min_days: 8, max_days: 30 },
          { label: "P3", value: "low", min_days: 31, max_days: 90 },
          { label: "P4", value: "lowest", min_days: 91, max_days: 365 },
          { label: "P5", value: "later", min_days: 366, max_days: 400 },
        ],
      },
      { name: "dependsOn", values: "local_task_id" },
      { name: "effort", values: ["small", "large"] },
    ],
  });
  assert.ok(config);
  return config;
}

function sequence(values) {
  let index = 0;
  return () => values[index++ % values.length];
}

function makeCardModel(overrides = {}) {
  const content =
    overrides.content ||
    "- [ ] #task Ship report [priority:: medium] [scheduled:: 2026-10-12] [effort:: small] ^ship";
  const lineText = overrides.lineText || content.split(/\r?\n/)[0];
  return helpers.planTaskCard({
    config: buildConfig(),
    content,
    lineText,
    cursorLine: 0,
    filePath: "Tasks/Alpha.md",
    propertyContext: { isObsidianTask: true },
    baseDate: BASE_DATE,
    random: sequence([0.1, 0.35, 0.6, 0.8, 0.95, 0.2, 0.45, 0.7]),
    freshnessApi: {
      setRefreshLine() {},
      config() {
        return { interval: 7 };
      },
    },
    ...overrides,
  });
}

class TestEditor {
  constructor(content) {
    this.content = String(content || "");
    this.undoGroups = 0;
    this.lastAnnotation = null;
  }
  getValue() {
    return this.content;
  }
  transaction(transaction) {
    this.lastAnnotation = transaction.annotation || null;
    const changes = [...(transaction.changes || [])].sort(
      (a, b) => b.from.line - a.from.line || b.from.ch - a.from.ch,
    );
    if (changes.length > 0) this.undoGroups += 1;
    const lines = this.content.split(/\r?\n/);
    for (const change of changes) {
      const offset = (position) =>
        lines
          .slice(0, position.line)
          .reduce(
            (sum, line) =>
              sum + line.length + (this.content.includes("\r\n") ? 2 : 1),
            0,
          ) + position.ch;
      const start = offset(change.from);
      const end = offset(change.to || change.from);
      this.content =
        this.content.slice(0, start) + change.text + this.content.slice(end);
    }
  }
}

function makePlugin(notes) {
  const store = new Map(Object.entries(notes));
  const openEditors = new Map();
  const vault = {
    getMarkdownFiles: () =>
      [...store.keys()]
        .filter((path) => /\.md$/i.test(path))
        .map((path) => ({ path })),
    getAbstractFileByPath: (path) => (store.has(path) ? { path } : null),
    cachedRead: async (file) => String(store.get(file.path) || ""),
    read: async (file) => vault.cachedRead(file),
    process: async (file, transform) => {
      store.set(file.path, String(transform(String(store.get(file.path) || ""))));
    },
  };
  const metadataCache = {
    getFirstLinkpathDest: (linkpath) => {
      const wanted = String(linkpath || "").replace(/\.md$/i, "");
      const exact = `${wanted}.md`;
      if (store.has(exact)) return { path: exact };
      const matches = [...store.keys()].filter(
        (path) =>
          /\.md$/i.test(path) &&
          path.split("/").pop().replace(/\.md$/i, "").toLowerCase() ===
            wanted.toLowerCase(),
      );
      return matches.length === 1 ? { path: matches[0] } : null;
    },
  };
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    vault,
    metadataCache,
    workspace: {
      getLeavesOfType: () =>
        [...openEditors].map(([path, editor]) => ({
          view: { file: { path }, editor },
        })),
      getActiveFile: () => null,
    },
  };
  return { plugin, store, openEditors };
}

function snapshotMap(notes) {
  return helpers.createDependencySnapshotMap(
    Object.entries(notes).map(([path, content]) => ({ path, content })),
  );
}

function relationStageHarness(notes, ownerPath, parentLines) {
  const snapshots = snapshotMap(notes);
  const index = helpers.indexDependencyStageNotesFromSnapshots(snapshots);
  const ownerContent = String(notes[ownerPath] || "");
  const currentRows = [];
  const linkedKeys = new Set();
  for (const parentLine of parentLines) {
    const resolved = helpers.resolveRelationStageCurrent(
      ownerContent,
      parentLine,
      ownerPath,
      index,
      snapshots.get(ownerPath) || null,
    );
    assert.equal(resolved.ok, true);
    for (const row of resolved.rows) {
      const key =
        row.path && row.blockId
          ? helpers.relationStageRowKey(row.path, row.blockId)
          : `missing:${row.path}#^${row.blockId}`;
      if (row.path && row.blockId) linkedKeys.add(key);
      currentRows.push(row);
    }
  }
  const candidates = helpers.collectVaultRelationCandidatesFromSnapshots(
    snapshots,
    { dependentPath: ownerPath, dependentLines: new Set(parentLines) },
  );
  const raw = {
    candidates,
    current: currentRows,
    linkedKeys,
    files: new Map(Object.entries(notes)),
    index,
    cacheReady: true,
    prerequisiteIds: new Set(),
    todayMap: new Map(),
    dependent: { path: ownerPath, line: parentLines[0] },
    parentLines,
    poolSize: candidates.length,
    refreshOf: null,
  };
  return helpers.decorateRelationVaultStage(raw);
}

function makeRelationPicker(plugin, direction, sources, notes) {
  const picker = Object.create(helpers.BulletPropertyPickerModal.prototype);
  picker.plugin = plugin;
  picker.filePath = sources[0].path;
  picker.cursor = { line: sources[0].line };
  picker.stage = "value";
  picker.relationStage = true;
  picker.relationStageDirection = direction;
  picker.selectedPropertyItem = {
    property: { name: "linksTo", values: "local_task_id" },
  };
  picker.vaultStage = {
    direction,
    sources,
    files: new Map(Object.entries(notes)),
  };
  picker.markedLines = new Set();
  picker.taskItemsByLine = new Map();
  picker.clearPendingBatch = () => {};
  picker.refuseDependencyStale = () => false;
  return picker;
}

function beginRelationLabel(picker, targets, raw, mode = "add") {
  picker.getRawQuery = () => raw;
  picker.showRelationLabelStage(targets, { mode });
  // The lightweight picker harness does not mount the modal DOM, so stage
  // fields normally set by applyOptions are supplied explicitly.
  picker.stage = "relation-label";
  picker.relationLabelTargets = targets;
  picker.relationLabelMode = mode;
}

function makeCancelCuePicker(notes, sourceRows, target) {
  const harness = makePlugin(notes);
  const config = {
    keys: ["duplicate of", "superseded by"],
    labels: {
      "duplicate of": "duplicate of",
      "superseded by": "superseded by",
    },
  };
  harness.plugin.loadRelationsCancelLabels = () => config;
  harness.plugin.readDependencyVaultFileList = () =>
    Object.keys(notes).map((path) => ({ path }));
  const picker = makeRelationPicker(
    harness.plugin,
    "to",
    sourceRows.map((source) => ({ path: "Tasks.md", ...source })),
    notes,
  );
  picker.getEditorContent = () => String(notes["Tasks.md"] || "");
  picker.readRelationLabelSuggestions = () => [
    { key: "see", label: "see", count: 4, hidden: false, inverse: null },
  ];
  beginRelationLabel(picker, [target], "");
  picker.renderResults = () => {
    picker.visibleItems = picker.getRelationLabelPreviewItems();
  };
  picker.renderResults();
  return { ...harness, picker };
}

function stubCyclerApi(plugin, available = true) {
  plugin.app.plugins = {
    plugins: {
      "task-status-cycler": available
        ? {
            api: {
              version: 3,
              completeTaskLineText() { return { ok: true, unchanged: false, lineText: "" }; },
              finalizeClosedTasks() { return {}; },
            },
          }
        : { api: { version: 2 } },
    },
  };
}

function makeCompleteCuePicker(notes, sourceRows, target, options = {}) {
  const harness = makePlugin(notes);
  stubCyclerApi(harness.plugin, options.cycler !== false);
  const cancel = options.cancel || { keys: [], labels: {} };
  const complete = options.complete || {
    keys: ["implemented by", "verified by"],
    labels: {
      "implemented by": "implemented by",
      "verified by": "verified by",
    },
  };
  harness.plugin.loadRelationsCloseLabels = () => ({
    cancel,
    complete,
    warnings: [],
  });
  harness.plugin.loadRelationsCancelLabels = () => cancel;
  harness.plugin.readDependencyVaultFileList = () =>
    Object.keys(notes).map((path) => ({ path }));
  const picker = makeRelationPicker(
    harness.plugin,
    options.direction || "to",
    sourceRows.map((source) => ({ path: source.path || "Tasks.md", ...source })),
    notes,
  );
  picker.getEditorContent = () => String(notes[picker.filePath] || notes["Tasks.md"] || "");
  picker.readRelationLabelSuggestions = () => options.suggestions || [
    { key: "see", label: "see", count: 4, hidden: false, inverse: null },
    {
      key: "implemented by",
      label: "implemented by",
      count: options.implementedCount || 0,
      hidden: options.implementedHidden === true,
      inverse: "implements",
    },
  ];
  beginRelationLabel(picker, [target], options.query || "");
  picker.renderResults = () => {
    picker.visibleItems = picker.getRelationLabelPreviewItems();
  };
  picker.applyOptions = () => {};
  picker.relationStageListOptions = () => ({});
  picker.clearRelationLabelSubscriptions = () => {};
  picker.resetLocalTaskMarks = () => {};
  picker.renderResults();
  return { ...harness, picker };
}

function currentOtherNotes(overrides = {}) {
  return {
    "Current.md":
      overrides.current || "- [ ] #task Current ^current",
    "Other.md": overrides.other || "- [ ] #task Other ^other",
  };
}

function makeCurrentOtherPicker(direction, notes, extra = {}) {
  const harness = makePlugin(notes);
  const currentEditor = new TestEditor(notes["Current.md"]);
  const otherEditor = new TestEditor(notes["Other.md"]);
  harness.openEditors.set("Current.md", currentEditor);
  harness.openEditors.set("Other.md", otherEditor);
  const currentLine = String(notes["Current.md"] || "").split(/\r?\n/)[0];
  const otherLine = String(notes["Other.md"] || "").split(/\r?\n/)[0];
  const picker = makeRelationPicker(
    harness.plugin,
    direction,
    [
      {
        path: "Current.md",
        line: 0,
        blockId: extra.currentBlockId,
        displayText: "Current",
        rawLine: currentLine,
      },
    ],
    notes,
  );
  picker.editor = currentEditor;
  const other = {
    path: "Other.md",
    line: 0,
    blockId: extra.otherBlockId,
    displayText: "Other",
    rawLine: otherLine,
    stageSection: extra.stageSection || "results",
    alreadyLinked: extra.alreadyLinked === true,
  };
  return { harness, picker, currentEditor, otherEditor, other };
}

function stubRelationBlockIdPrompt(picker) {
  const prompts = [];
  picker.showBlockIdStage = (snapshot, options) => {
    prompts.push({ snapshot, options });
    picker.stage = "blockid";
    return false;
  };
  picker.refuseDependencyStale = (message = "changed — reopen") => {
    assert.fail(`stale refusal: ${message}`);
  };
  return prompts;
}

test("LG3: typed relation labels commit their text through the relation field", async (t) => {
  await t.test("add writes the typed label and mirror", async () => {
    const notes = {
      "Source.md": "- [ ] #task Source ^source",
      "Target.md": "- [ ] #task Target ^target",
    };
    const harness = makePlugin(notes);
    const sourceEditor = new TestEditor(notes["Source.md"]);
    const targetEditor = new TestEditor(notes["Target.md"]);
    harness.openEditors.set("Source.md", sourceEditor);
    harness.openEditors.set("Target.md", targetEditor);
    const target = { path: "Target.md", line: 0, blockId: "target", displayText: "Target" };
    const picker = makeRelationPicker(harness.plugin, "to", [
      { path: "Source.md", line: 0, blockId: "source", displayText: "Source" },
    ], notes);
    beginRelationLabel(picker, [target], "son of");
    const row = picker.getRelationLabelPreviewItems()[0];
    assert.equal(row.typed, true);
    assert.equal(await picker.commitRelationLabel(row), true);
    assert.match(sourceEditor.getValue(), /son of \[\[Target#\^target\]\]/);
    assert.match(targetEditor.getValue(), /LINKED FROM:\*\* \[\[Source#\^source\]\] \(son of\)/);
    assert.doesNotMatch(sourceEditor.getValue() + targetEditor.getValue(), /\btrue\b/);
  });

  await t.test("typed text is normalized before commit", async () => {
    const notes = {
      "Source.md": "- [ ] #task Source ^source",
      "Target.md": "- [ ] #task Target ^target",
    };
    const harness = makePlugin(notes);
    const sourceEditor = new TestEditor(notes["Source.md"]);
    harness.openEditors.set("Source.md", sourceEditor);
    const picker = makeRelationPicker(harness.plugin, "to", [
      { path: "Source.md", line: 0, blockId: "source" },
    ], notes);
    const target = { path: "Target.md", line: 0, blockId: "target" };
    beginRelationLabel(picker, [target], "son   of:");
    assert.equal(await picker.commitRelationLabel(picker.getRelationLabelPreviewItems()[0]), true);
    assert.match(sourceEditor.getValue(), /son of \[\[Target#\^target\]\]/);
  });

  await t.test("relabel replaces an existing label and its mirror", async () => {
    const notes = {
      "Source.md": ["- [ ] #task Source ^source", "  - 🪢 **LINKS:** see [[Target#^target]]"].join("\n"),
      "Target.md": ["- [ ] #task Target ^target", "  - 🪢 **LINKED FROM:** [[Source#^source]] (see)"].join("\n"),
    };
    const harness = makePlugin(notes);
    const sourceEditor = new TestEditor(notes["Source.md"]);
    const targetEditor = new TestEditor(notes["Target.md"]);
    harness.openEditors.set("Source.md", sourceEditor);
    harness.openEditors.set("Target.md", targetEditor);
    const target = relationStageHarness(notes, "Source.md", [0]).current[0];
    const picker = makeRelationPicker(harness.plugin, "to", [
      { path: "Source.md", line: 0, blockId: "source", displayText: "Source" },
    ], notes);
    beginRelationLabel(picker, [target], "son of", "relabel");
    assert.equal(await picker.commitRelationLabel(picker.getRelationLabelPreviewItems()[0]), true);
    assert.match(sourceEditor.getValue(), /son of \[\[Target#\^target\]\]/);
    assert.match(targetEditor.getValue(), /\(son of\)/);
    assert.doesNotMatch(sourceEditor.getValue(), /see \[\[Target/);
  });

  await t.test("Linked from labels the other task's LINKS line", async () => {
    const notes = {
      "Current.md": "- [ ] #task Current ^current",
      "Other.md": "- [ ] #task Other ^other",
    };
    const harness = makePlugin(notes);
    const currentEditor = new TestEditor(notes["Current.md"]);
    const otherEditor = new TestEditor(notes["Other.md"]);
    harness.openEditors.set("Current.md", currentEditor);
    harness.openEditors.set("Other.md", otherEditor);
    const picker = makeRelationPicker(harness.plugin, "from", [
      { path: "Current.md", line: 0, blockId: "current", displayText: "Current" },
    ], notes);
    const other = { path: "Other.md", line: 0, blockId: "other", displayText: "Other" };
    beginRelationLabel(picker, [other], "son of");
    assert.equal(await picker.commitRelationLabel(picker.getRelationLabelPreviewItems()[0]), true);
    assert.match(otherEditor.getValue(), /son of \[\[Current#\^current\]\]/);
    assert.match(currentEditor.getValue(), /LINKED FROM:\*\* \[\[Other#\^other\]\] \(son of\)/);
    assert.doesNotMatch(currentEditor.getValue(), /\*\*LINKS:\*\*/);
  });

  await t.test("suggestion, plain, and raw-input paths remain supported", async () => {
    const notes = {
      "Source.md": "- [ ] #task Source ^source",
      "Target.md": "- [ ] #task Target ^target",
    };
    const target = { path: "Target.md", line: 0, blockId: "target" };
    const createPicker = () => {
      const harness = makePlugin(notes);
      const editor = new TestEditor(notes["Source.md"]);
      harness.openEditors.set("Source.md", editor);
      const picker = makeRelationPicker(harness.plugin, "to", [
        { path: "Source.md", line: 0, blockId: "source" },
      ], notes);
      return { picker, editor };
    };

    const suggestion = createPicker();
    beginRelationLabel(suggestion.picker, [target], "see");
    assert.equal(await suggestion.picker.commitRelationLabel({ kind: "relation-label", typed: false, label: "see also" }), true);
    assert.match(suggestion.editor.getValue(), /see also \[\[Target#\^target\]\]/);

    const plain = createPicker();
    beginRelationLabel(plain.picker, [target], "");
    assert.equal(await plain.picker.commitRelationLabel(plain.picker.getRelationLabelPreviewItems()[0]), true);
    assert.match(plain.editor.getValue(), /LINKS:\*\* \[\[Target#\^target\]\]/);
    assert.doesNotMatch(plain.editor.getValue(), /LINKS:\*\* [^\n]+\[\[Target/);

    const raw = createPicker();
    beginRelationLabel(raw.picker, [target], "son of");
    assert.equal(await raw.picker.commitRelationLabel(undefined), true);
    assert.match(raw.editor.getValue(), /son of \[\[Target#\^target\]\]/);
  });
});

test("Linked from Shift+Enter goes through the relation field and labels the source", async () => {
  const notes = currentOtherNotes();
  const { picker, currentEditor, otherEditor, other } = makeCurrentOtherPicker(
    "from",
    notes,
    { currentBlockId: "current", otherBlockId: "other" },
  );
  assert.equal(picker.stage, "value");
  picker.getRawQuery = () => "son of";
  assert.equal(picker.chooseRelationTask(other, { withLabel: true }), false);
  assert.equal(picker.stage, "relation-label");
  assert.equal(picker.getRelationLabelSubtitle(), "Other (Other) — son of → this");
  assert.equal(
    await picker.commitRelationLabel(picker.getRelationLabelPreviewItems()[0]),
    true,
  );
  assert.match(otherEditor.getValue(), /son of \[\[Current#\^current\]\]/);
  assert.match(
    currentEditor.getValue(),
    /LINKED FROM:\*\* \[\[Other#\^other\]\] \(son of\)/,
  );
  assert.doesNotMatch(currentEditor.getValue(), /\*\*LINKS:\*\*/);
});

test("Linked from Shift+Enter relabels a CURRENT source", async () => {
  const notes = currentOtherNotes({
    current: [
      "- [ ] #task Current ^current",
      "  - 🪢 **LINKED FROM:** [[Other#^other]] (see)",
    ].join("\n"),
    other: [
      "- [ ] #task Other ^other",
      "  - 🪢 **LINKS:** see [[Current#^current]]",
    ].join("\n"),
  });
  const { picker, currentEditor, otherEditor, other } = makeCurrentOtherPicker(
    "from",
    notes,
    {
      currentBlockId: "current",
      otherBlockId: "other",
      stageSection: "current",
      alreadyLinked: true,
    },
  );
  picker.getRawQuery = () => "son of";
  assert.equal(picker.chooseRelationTask(other, { withLabel: true }), false);
  assert.equal(picker.stage, "relation-label");
  assert.equal(
    await picker.commitRelationLabel(picker.getRelationLabelPreviewItems()[0]),
    true,
  );
  assert.match(otherEditor.getValue(), /son of \[\[Current#\^current\]\]/);
  assert.doesNotMatch(otherEditor.getValue(), /see \[\[Current/);
  assert.match(currentEditor.getValue(), /\(son of\)/);
  assert.doesNotMatch(currentEditor.getValue(), /\*\*LINKS:\*\*/);
});

test("Linked from prompts for the owner's id then links", async (t) => {
  await t.test("plain Enter writes the owner id and the reverse link", async () => {
    const notes = currentOtherNotes({
      current: "- [ ] #task Current",
    });
    const { picker, currentEditor, otherEditor, other } = makeCurrentOtherPicker(
      "from",
      notes,
      { otherBlockId: "other" },
    );
    const prompts = stubRelationBlockIdPrompt(picker);
    assert.equal(
      await picker.commitRelationEdit({
        add: [other],
        remove: [],
        relabel: [],
      }),
      false,
    );
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0].options.mode, "relation-target");
    assert.equal(prompts[0].snapshot.path, "Current.md");
    assert.equal(picker.stage, "blockid");
    assert.equal(
      await picker.confirmRelationTargetBlockId({ valid: true, id: "current" }),
      true,
    );
    assert.match(currentEditor.getValue(), /\^current/);
    assert.match(
      currentEditor.getValue(),
      /LINKED FROM:\*\* \[\[Other#\^other\]\]/,
    );
    assert.match(otherEditor.getValue(), /LINKS:\*\* \[\[Current#\^current\]\]/);
  });

  await t.test("Shift+Enter labels the source after the owner id prompt", async () => {
    const notes = currentOtherNotes({
      current: "- [ ] #task Current",
    });
    const { picker, currentEditor, otherEditor, other } = makeCurrentOtherPicker(
      "from",
      notes,
      { otherBlockId: "other" },
    );
    const prompts = stubRelationBlockIdPrompt(picker);
    picker.getRawQuery = () => "son of";
    assert.equal(picker.chooseRelationTask(other, { withLabel: true }), false);
    assert.equal(picker.stage, "relation-label");
    assert.equal(
      await picker.commitRelationLabel(picker.getRelationLabelPreviewItems()[0]),
      false,
    );
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0].snapshot.path, "Current.md");
    assert.equal(picker.stage, "blockid");
    assert.equal(
      await picker.confirmRelationTargetBlockId({ valid: true, id: "current" }),
      true,
    );
    assert.match(currentEditor.getValue(), /\^current/);
    assert.match(
      currentEditor.getValue(),
      /LINKED FROM:\*\* \[\[Other#\^other\]\] \(son of\)/,
    );
    assert.match(
      otherEditor.getValue(),
      /son of \[\[Current#\^current\]\]/,
    );
  });
});

test("Linked-from cancel label follows the source after the owner mirror shifts it", async () => {
  const initial = "- [ ] #task Owner\n- [ ] #task Source";
  const notes = { "Tasks.md": initial };
  const harness = makePlugin(notes);
  harness.plugin.loadRelationsCancelLabels = () => ({
    keys: ["duplicate of", "superseded by"],
    labels: { "duplicate of": "duplicate of", "superseded by": "superseded by" },
  });
  harness.plugin.loadRelationsCloseLabels = () => ({
    cancel: { keys: ["duplicate of", "superseded by"], labels: { "duplicate of": "duplicate of", "superseded by": "superseded by" } },
    complete: { keys: [], labels: {} },
    warnings: [],
  });
  const applyRelationEdit = harness.plugin.applyRelationEdit.bind(harness.plugin);
  harness.plugin.applyRelationEdit = async (args) => {
    return applyRelationEdit({
      ...args,
      cancelLabels: { keys: ["duplicate of", "superseded by"], labels: { "duplicate of": "duplicate of", "superseded by": "superseded by" } },
      cancelDate: "2026-10-03",
    });
  };
  const editor = new TestEditor(initial);
  harness.openEditors.set("Tasks.md", editor);
  const ownerLine = initial.split("\n")[0];
  const sourceLine = initial.split("\n")[1];
  const picker = makeRelationPicker(harness.plugin, "from", [{
    path: "Tasks.md",
    line: 0,
    blockId: null,
    displayText: "Owner",
    rawLine: ownerLine,
  }], notes);
  picker.editor = editor;
  const source = {
    path: "Tasks.md",
    line: 1,
    blockId: null,
    displayText: "Source",
    rawLine: sourceLine,
    stageSection: "results",
  };
  const prompts = stubRelationBlockIdPrompt(picker);
  picker.getRawQuery = () => "superseded by";
  assert.equal(picker.chooseRelationTask(source, { withLabel: true }), false);
  assert.equal(picker.stage, "relation-label");
  assert.equal(await picker.commitRelationLabel(picker.getRelationLabelPreviewItems()[0]), false);
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].snapshot.path, "Tasks.md");
  // The focused fixture omits the app-level relation config file, so keep
  // the writer's preview parity gate out of this line-shift regression.
  picker.relationCancelExpected = null;
  picker.relationCloseExpected = null;
  assert.equal(await picker.confirmRelationTargetBlockId({ valid: true, id: "owner" }), true);
  assert.match(editor.getValue(), /^- \[ \] #task Owner .*\^owner$/m);
  assert.match(editor.getValue(), /^- \[-] #task Source .*\[cancelled::/m);
  assert.doesNotMatch(notices.slice(-3).join("\n"), /A counted task changed while the picker was open/);
});

test("Links to prompts for the selected task's id then links", async () => {
  const notes = currentOtherNotes({
    other: "- [ ] #task Other",
  });
  const { picker, currentEditor, otherEditor, other } = makeCurrentOtherPicker(
    "to",
    notes,
    { currentBlockId: "current" },
  );
  const prompts = stubRelationBlockIdPrompt(picker);
  assert.equal(
    await picker.commitRelationEdit({
      add: [other],
      remove: [],
      relabel: [],
    }),
    false,
  );
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].options.mode, "relation-target");
  assert.equal(prompts[0].snapshot.path, "Other.md");
  assert.equal(
    await picker.confirmRelationTargetBlockId({ valid: true, id: "other" }),
    true,
  );
  assert.match(currentEditor.getValue(), /LINKS:\*\* \[\[Other#\^other\]\]/);
  assert.match(
    otherEditor.getValue(),
    /LINKED FROM:\*\* \[\[Current#\^current\]\]/,
  );
});

test("Linked-from toasts name the source task", async () => {
  const addNotes = currentOtherNotes();
  const added = makeCurrentOtherPicker("from", addNotes, {
    currentBlockId: "current",
    otherBlockId: "other",
  });
  const addStart = notices.length;
  added.picker.getRawQuery = () => "son of";
  beginRelationLabel(added.picker, [added.other], "son of");
  assert.equal(
    await added.picker.commitRelationLabel(
      added.picker.getRelationLabelPreviewItems()[0],
    ),
    true,
  );
  assert.equal(
    notices[notices.length - 1],
    "🪢 “Other” now links here · son of",
  );
  assert.equal(notices.length, addStart + 1);

  const relabelNotes = currentOtherNotes({
    current: [
      "- [ ] #task Current ^current",
      "  - 🪢 **LINKED FROM:** [[Other#^other]] (see)",
    ].join("\n"),
    other: [
      "- [ ] #task Other ^other",
      "  - 🪢 **LINKS:** see [[Current#^current]]",
    ].join("\n"),
  });
  const relabeled = makeCurrentOtherPicker("from", relabelNotes, {
    currentBlockId: "current",
    otherBlockId: "other",
    stageSection: "current",
    alreadyLinked: true,
  });
  const relabelStart = notices.length;
  beginRelationLabel(relabeled.picker, [relabeled.other], "son of", "relabel");
  assert.equal(
    await relabeled.picker.commitRelationLabel(
      relabeled.picker.getRelationLabelPreviewItems()[0],
    ),
    true,
  );
  assert.equal(notices[notices.length - 1], "🪢 Relabeled “Other” · son of");
  assert.equal(notices.length, relabelStart + 1);

  const removeNotes = currentOtherNotes({
    current: [
      "- [ ] #task Current ^current",
      "  - 🪢 **LINKED FROM:** [[Other#^other]]",
    ].join("\n"),
    other: [
      "- [ ] #task Other ^other",
      "  - 🪢 **LINKS:** [[Current#^current]]",
    ].join("\n"),
  });
  const removed = makeCurrentOtherPicker("from", removeNotes, {
    currentBlockId: "current",
    otherBlockId: "other",
    stageSection: "current",
    alreadyLinked: true,
  });
  const removeStart = notices.length;
  assert.equal(
    await removed.picker.commitRelationEdit({
      add: [],
      remove: [removed.other],
      relabel: [],
    }),
    true,
  );
  assert.equal(notices[notices.length - 1], "🪢 Unlinked “Other”");
  assert.equal(notices.length, removeStart + 1);

  const linksToNotes = currentOtherNotes();
  const linksTo = makeCurrentOtherPicker("to", linksToNotes, {
    currentBlockId: "current",
    otherBlockId: "other",
  });
  const linksToStart = notices.length;
  assert.equal(
    await linksTo.picker.commitRelationEdit({
      add: [linksTo.other],
      remove: [],
      relabel: [],
    }),
    true,
  );
  assert.equal(notices[notices.length - 1], "🪢 Linked to “Other”");
  assert.equal(notices.length, linksToStart + 1);
});

test("links-to row follows blocks with N, first label, cut target, and +K", () => {
  const content = [
    "- [ ] #task Ship report ^ship",
    "  - 🪢 **LINKS:** see [[Other#^target]] • [[#^second]]",
  ].join("\n");
  const taskCache = {
    ready: true,
    tasks: [
      { blockId: "target", displayText: "Target task with a long name here" },
    ],
  };
  const model = makeCardModel({ content, taskCache });
  const ids = model.rows.map((row) => row.id);
  assert.deepEqual(ids, [
    "schedule",
    "depends-on",
    "blocks",
    "links-to",
    "linked-from",
    "review-every",
    "cancel",
    "lane",
    "theme",
  ]);
  const row = model.rows.find((entry) => entry.id === "links-to");
  assert.equal(row.kind, "action");
  assert.equal(row.action, "links");
  assert.equal(row.label, "Links to");
  assert.equal(row.enabled, true);
  assert.equal(row.detail, "2 · see Target task with a long… +1");
  assert.equal(model.availability.linksTo, true);
  const presented = helpers.orderedTaskCardRows(model);
  const linksTo = presented.find((entry) => entry.id === "links-to");
  assert.equal(linksTo.label, "Links to…");
  assert.equal(linksTo.shortcut, "l");
  assert.equal(linksTo.detail, "2 · see Target task with a long… +1");
});

test("links-to row stays available on closed tasks and empty LINKS lines", () => {
  const closed = makeCardModel({
    content: "- [x] #task Done thing ^done",
  });
  const closedRow = closed.rows.find((row) => row.id === "links-to");
  assert.equal(closedRow.enabled, true);
  assert.equal(closedRow.detail, "");
  const plain = makeCardModel({
    content: "- [ ] #task Fresh ^fresh",
  });
  assert.equal(
    plain.rows.find((row) => row.id === "links-to").enabled,
    true,
  );
});

test("links-to row refuses non-tasks and read-only notes", () => {
  const prose = makeCardModel({ content: "just prose" });
  assert.equal(
    prose.rows.find((row) => row.id === "links-to").unavailableReason,
    "Links require a #task checkbox",
  );
  const archived = makeCardModel({
    content: "- [ ] #task Old ^old",
    filePath: "done/2026/Old.md",
  });
  assert.equal(
    archived.rows.find((row) => row.id === "links-to").unavailableReason,
    "This task is in a read-only note",
  );
});

test("card keycap l opens Links to; input focus keeps it quiet", () => {
  const model = makeCardModel({ content: "- [ ] #task T ^t" });
  const intent = helpers.resolveTaskCardKey(model, { key: "l" });
  assert.equal(intent.type, "open-action");
  assert.equal(intent.rowId, "links-to");
  assert.equal(intent.action, "links");
  assert.equal(
    helpers.resolveTaskCardKey(model, { key: "l", inTextInput: true }),
    null,
  );
  assert.equal(helpers.TASK_CARD_ROW_ORDER.includes("links-to"), true);
  assert.equal(helpers.TASK_CARD_ROW_SHORTCUTS["links-to"], "l");
});

test("card ⇧L shows live incoming detail and routes Ctrl+D by direction", () => {
  const content = "- [ ] #task Target task ^target";
  const incoming = [{ source: { path: "Other.md", blockId: "source", text: "Source task" } }];
  const app = {
    plugins: {
      plugins: {
        "bob-ledger-tools": {
          api: {
            relationIndex: {
              version: 1,
              ready: () => true,
              incoming: (path, blockId) => {
                assert.equal(path, "Tasks/Alpha.md");
                assert.equal(blockId, "target");
                return incoming;
              },
            },
          },
        },
      },
    },
  };
  const model = makeCardModel({ content, app });
  const row = model.rows.find((entry) => entry.id === "linked-from");
  assert.equal(row.enabled, true);
  assert.equal(row.detail, "1 · Source task");
  const reverse = helpers.resolveTaskCardKey(model, { key: "L", shiftKey: true });
  assert.equal(reverse.type, "open-action");
  assert.equal(reverse.rowId, "linked-from");
  assert.equal(reverse.action, "linked-from");
  const forwardClear = helpers.resolveTaskCardKey(
    makeCardModel({ content, selectedRowId: "links-to" }),
    { key: "d", ctrlKey: true },
  );
  assert.equal(forwardClear.type, "clear-relations");
  const reverseClear = helpers.resolveTaskCardKey(
    makeCardModel({ content, selectedRowId: "linked-from" }),
    { key: "d", ctrlKey: true },
  );
  assert.equal(reverseClear.type, "unavailable");
  assert.match(reverseClear.reason, /LINKED FROM is generated/);
});

test("index-only Linked-from rows convert 1-based edges into nav records", () => {
  const rows = helpers.relationStageIncomingRowsFromEdges(
    [
      {
        source: {
          path: "Tasks.md",
          blockId: "bar",
          line: 4,
          text: "- [*] #task bar baz buz [created::2026-10-20] ^bar",
          status: "NEXT",
        },
        label: "son of",
      },
    ],
    { byKey: new Map() },
    "",
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].line, 3);
  assert.equal(rows[0].displayText, "bar baz buz");
  assert.equal(rows[0].text, "bar baz buz");
  assert.equal(rows[0].status, "*");
  assert.equal(rows[0].open, true);
  assert.equal(rows[0].closed, false);

  const done = helpers.relationStageIncomingRowsFromEdges(
    [
      {
        source: {
          path: "Tasks.md",
          blockId: "done",
          line: 1,
          text: "#task Done source",
          status: "DONE",
        },
      },
    ],
    { byKey: new Map() },
    "",
  );
  assert.equal(done[0].status, "x");
  assert.equal(done[0].closed, true);
  assert.equal(done[0].open, false);
});

test("card ⇧L detail cleans a raw index task line", () => {
  const content = "- [ ] #task Target task ^target";
  const incoming = [
    {
      source: {
        path: "Other.md",
        blockId: "source",
        text: "- [*] #task Source task ^source",
      },
    },
  ];
  const app = {
    plugins: {
      plugins: {
        "bob-ledger-tools": {
          api: {
            relationIndex: {
              version: 1,
              ready: () => true,
              incoming: () => incoming,
            },
          },
        },
      },
    },
  };
  const model = makeCardModel({ content, app });
  const row = model.rows.find((entry) => entry.id === "linked-from");
  assert.equal(row.detail, "1 · Source task");
});

test("Linked-from scans source LINKS, reverses built-in phrases, and ignores stored mirrors", () => {
  const notes = {
    "Tasks.md": [
      "- [ ] #task Source ^source",
      "  - 🪢 **LINKS:** merged into [[Target#^target]]",
      "- [ ] #task Mirror-only target ^mirror",
      "  - 🪢 **LINKED FROM:** [[#^source]] (merged from)",
    ].join("\n"),
    "Target.md": "- [ ] #task Target ^target",
    "done/Old.md": "- [x] #task Archived source ^archived",
  };
  const snapshots = snapshotMap(notes);
  const index = helpers.indexDependencyStageNotesFromSnapshots(snapshots);
  const incoming = helpers.collectRelationStageIncomingFromSnapshots(
    snapshots,
    index,
    { path: "Target.md", blockId: "target", line: 0 },
  );
  assert.equal(incoming.length, 1);
  assert.equal(incoming[0].path, "Tasks.md");
  assert.equal(incoming[0].label, "merged from");
  assert.equal(incoming[0].searchText.includes("Source"), true);
  assert.deepEqual(
    helpers.collectRelationStageIncomingFromSnapshots(
      snapshots,
      index,
      { path: "Tasks.md", blockId: "mirror", line: 2 },
    ),
    [],
  );
  assert.equal(helpers.inverseRelationPhrase("duplicate of"), "duplicated by");
  assert.equal(helpers.inverseRelationPhrase("implemented by"), "implements");
  assert.equal(helpers.inverseRelationPhrase("verified by"), "verifies");
  assert.equal(helpers.inverseRelationPhrase("see also"), "see also → this");

  const view = helpers.planLinkedFromStageView({
    sources: [{ path: "Target.md", blockId: "target", line: 0 }],
    current: incoming,
    candidates: incoming,
    linkedKeys: new Set([helpers.relationStageRowKey("Tasks.md", "source")]),
  });
  assert.equal(view.length, 1);
  assert.equal(view[0].stageSection, "current");
  assert.equal(view[0].alreadyLinked, true);
});

test("LG7: reverse-stage Enter writes the source's LINKS and target mirror", async () => {
  const notes = {
    "Source.md": "- [ ] #task Source ^source",
    "Target.md": "- [ ] #task Target ^target",
  };
  const harness = makePlugin(notes);
  const sourceEditor = new TestEditor(notes["Source.md"]);
  const targetEditor = new TestEditor(notes["Target.md"]);
  harness.openEditors.set("Source.md", sourceEditor);
  harness.openEditors.set("Target.md", targetEditor);
  const picker = makeRelationPicker(
    harness.plugin,
    "from",
    [{ path: "Target.md", line: 0, blockId: "target", displayText: "Target" }],
    notes,
  );
  const committed = await picker.commitRelationEdit({
    add: [{
      path: "Source.md",
      line: 0,
      blockId: "source",
      displayText: "Source",
      label: "duplicate of",
      stageSection: "results",
    }],
    remove: [],
    relabel: [],
  });
  assert.equal(committed, true);
  assert.match(sourceEditor.getValue(), /duplicate of \[\[Target#\^target\]\]/);
  assert.match(targetEditor.getValue(), /LINKED FROM:\*\* \[\[Source#\^source\]\] \(duplicate of\)/);
});

test("LG12: counted Links to applies the chosen labelled target to every source", async () => {
  const notes = {
    "Sources.md": [
      "- [ ] #task First source ^first",
      "- [ ] #task Second source ^second",
      "- [ ] #task Third source ^third",
    ].join("\n"),
    "Target.md": "- [ ] #task Target ^target",
  };
  const harness = makePlugin(notes);
  const sourceEditor = new TestEditor(notes["Sources.md"]);
  harness.openEditors.set("Sources.md", sourceEditor);
  const picker = makeRelationPicker(
    harness.plugin,
    "to",
    [
      { path: "Sources.md", line: 0, blockId: "first" },
      { path: "Sources.md", line: 1, blockId: "second" },
      { path: "Sources.md", line: 2, blockId: "third" },
    ],
    notes,
  );
  const committed = await picker.commitRelationEdit({
    add: [{
      path: "Target.md",
      line: 0,
      blockId: "target",
      label: "shared context",
      stageSection: "results",
    }],
    remove: [],
    relabel: [],
  });
  assert.equal(committed, true);
  assert.equal((sourceEditor.getValue().match(/shared context \[\[Target#\^target\]\]/g) || []).length, 3);
  assert.equal((harness.store.get("Target.md").match(/\(shared context\)/g) || []).length, 3);
});

test("LG8: Ctrl+Shift+P on a LINKS line resolves to the owner's stage", () => {
  const content = [
    "- [ ] #task Source ^source",
    "  - 🪢 **LINKS:** [[Other#^target]]",
  ].join("\n");
  const entry = helpers.resolveDependencyStageEntry(content, 1);
  assert.equal(entry.ok, true);
  assert.equal(entry.lineKind, "links");
  assert.equal(entry.parentLine, 0);
  const taskLine = helpers.resolveDependencyStageEntry(content, 0);
  assert.equal(taskLine.lineKind, null);
});

test("pool keeps closed tasks and done/ archives, drops dailies and templates", () => {
  const notes = {
    "Tasks.md": "- [ ] #task Owner ^owner",
    "Other.md": "- [ ] #task Open ^open\n- [x] #task Shut ^shut",
    "done/Old.md": "- [x] #task Ancient ^ancient",
    "2026/20261020.md": "- [ ] #task Daily ^daily",
    "_templates/T.md": "- [ ] #task Template ^template",
  };
  const candidates = helpers.collectVaultRelationCandidatesFromSnapshots(
    snapshotMap(notes),
    { dependentPath: "Tasks.md", dependentLines: new Set([0]) },
  );
  const byId = new Map(candidates.map((entry) => [entry.blockId, entry]));
  assert.ok(byId.has("open"));
  assert.ok(byId.has("shut"));
  assert.equal(byId.get("shut").closed, true);
  assert.ok(byId.has("ancient"));
  assert.equal(byId.get("ancient").archived, true);
  assert.ok(!byId.has("daily"));
  assert.ok(!byId.has("template"));
  assert.ok(!byId.has("owner"));
  assert.equal(helpers.isRelationStageExcludedPath("done/Old.md"), false);
  assert.equal(helpers.isRelationStageExcludedPath("2026/20261020.md"), true);
});

test("stage lists CURRENT in authored order, then RESULTS, then CLOSED", () => {
  const notes = {
    "Tasks.md": [
      "- [ ] #task Owner ^owner",
      "  - 🪢 **LINKS:** see [[Other#^beta]] • [[Other#^alpha]]",
    ].join("\n"),
    "Other.md": [
      "- [ ] #task Alpha ^alpha",
      "- [ ] #task Beta ^beta",
      "- [ ] #task Gamma ^gamma",
      "- [x] #task Shut ^shut",
    ].join("\n"),
    "done/Old.md": "- [x] #task Ancient ^ancient",
  };
  const stage = relationStageHarness(notes, "Tasks.md", [0]);
  assert.match(stage.title, /🪢 Links · Owner/);
  const items = helpers.planRelationStageItemsFromVault(stage, "");
  const sections = items
    .filter((item) => item.kind === "local-task")
    .map((item) => item.stageSection);
  assert.deepEqual(sections, ["current", "current", "closed", "closed"]);
  assert.deepEqual(
    items
      .filter((item) => item.stageSection === "current")
      .map((item) => [item.blockId, item.label]),
    [
      ["beta", "see"],
      ["alpha", null],
    ],
  );
  // Other-note Ready tasks need typing: empty query gates them out.
  assert.ok(!items.some((item) => item.blockId === "gamma"));
  const typed = helpers.planRelationStageItemsFromVault(stage, "gam");
  const gamma = typed.find((item) => item.blockId === "gamma");
  assert.equal(gamma.stageSection, "results");
  assert.equal(gamma.alreadyLinked, false);
  assert.equal(gamma.needsBlockIdPrompt, false);
  const closedIds = items
    .filter((item) => item.stageSection === "closed")
    .map((item) => item.blockId);
  assert.deepEqual(closedIds, ["shut", "ancient"]);
  assert.equal(
    items.find((item) => item.blockId === "ancient").archived,
    true,
  );
  // The owner itself never appears, and linked rows leave the pool.
  assert.ok(!items.some((item) => item.blockId === "owner"));
  assert.ok(!items.some((item) => item.blockId === "beta" && item.stageSection !== "current"));
});

test("LG4: missing CURRENT targets stay removable; malformed lines refuse", () => {
  const notes = {
    "Tasks.md": "- [ ] #task Owner ^owner\n  - 🪢 **LINKS:** [[Gone#^gone]]",
    "Other.md": "- [ ] #task Else ^else",
  };
  const stage = relationStageHarness(notes, "Tasks.md", [0]);
  const items = helpers.planRelationStageItemsFromVault(stage, "");
  const current = items.filter((item) => item.stageSection === "current");
  assert.equal(current.length, 1);
  assert.equal(current[0].missing, true);
  assert.equal(current[0].alreadyLinked, true);
  assert.equal(current[0].disabled, undefined);
  const bad = helpers.resolveRelationStageCurrent(
    "- [ ] #task Owner ^owner\n  - 🪢 **LINKS:** [[#^a]] until Friday",
    0,
    "Tasks.md",
    helpers.indexDependencyStageNotesFromSnapshots(
      helpers.createDependencySnapshotMap([
        { path: "Tasks.md", content: "- [ ] #task Owner ^owner" },
      ]),
    ),
  );
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, "malformed-links-line");
});

test("prerequisite targets badge; id-less rows prompt", () => {
  const notes = {
    "Tasks.md": [
      "- [ ] #task Owner ^owner",
      "  - ⛓️ **DEPENDS ON:** [[Other#^beta]]",
      "- [ ] #task No id here",
    ].join("\n"),
    "Other.md": "- [ ] #task Beta ^beta",
  };
  const snapshots = snapshotMap(notes);
  const index = helpers.indexDependencyStageNotesFromSnapshots(snapshots);
  const ownerContent = notes["Tasks.md"];
  const prerequisiteIds = helpers.relationStagePrerequisiteIdentities(
    ownerContent,
    0,
    "Tasks.md",
    index,
  );
  const raw = {
    candidates: helpers.collectVaultRelationCandidatesFromSnapshots(
      snapshots,
      { dependentPath: "Tasks.md", dependentLines: new Set([0]) },
    ),
    current: [],
    linkedKeys: new Set(),
    files: new Map(Object.entries(notes)),
    index,
    cacheReady: true,
    prerequisiteIds,
    todayMap: new Map(),
    dependent: { path: "Tasks.md", line: 0 },
    parentLines: [0],
    poolSize: 2,
    refreshOf: null,
  };
  const stage = helpers.decorateRelationVaultStage(raw);
  // Same-note rows show without typing; other-note rows need a query.
  const sameNote = helpers.planRelationStageItemsFromVault(stage, "");
  const noId = sameNote.find((item) => item.displayText === "No id here");
  assert.equal(noId.needsBlockIdPrompt, true);
  assert.equal(noId.needsPromptForAdd, true);
  const typed = helpers.planRelationStageItemsFromVault(stage, "beta");
  const beta = typed.find((item) => item.blockId === "beta");
  assert.equal(beta.prerequisite, true);
});

test("subtitle, consequence strip, live sentence, and label refusal copy", () => {
  const stage = { current: [{}, {}], poolSize: 9 };
  assert.equal(
    helpers.relationStageSubtitle(stage, null, {}),
    "Links to 2 · searching 9 tasks · ⇥ to mark several · does not block",
  );
  assert.equal(
    helpers.relationStageSubtitle({ current: [], poolSize: 9 }, null, {}),
    "Links to nothing yet · searching 9 tasks · ⇥ to mark several · does not block",
  );
  assert.equal(
    helpers.relationStageSubtitle(stage, { add: 2, remove: 1, needId: 0 }, {}),
    "2 to link · 1 to unlink · ↵ to apply",
  );
  // RESULTS copy: links only, never anything else.
  assert.equal(
    helpers.relationStageConsequenceStrip({ kind: "local-task", stageSection: "results" }, {}),
    "Links only · never blocks, schedules, or changes status",
  );
  // CURRENT copy names both gestures.
  assert.equal(
    helpers.relationStageConsequenceStrip({ kind: "local-task", stageSection: "current" }, {}),
    "↵ unlinks · ⇧↵ relabels",
  );
  // Archived rows explain the live-only mirror (LG6).
  assert.equal(
    helpers.relationStageConsequenceStrip(
      { kind: "local-task", stageSection: "closed", archived: true },
      {},
    ),
    "Archived · its LINKED FROM shows live only",
  );
  // Marked rows commit together (LG15).
  assert.equal(
    helpers.relationStageConsequenceStrip(null, {
      marked: [{ stageSection: "results" }, { stageSection: "current" }],
    }),
    "↵ links 1 · ↵ unlinks 1 · never blocks, schedules, or changes status",
  );
  assert.equal(
    helpers.relationStageLiveSentence("Ship", "see also", "Target"),
    "Ship — see also → Target",
  );
  assert.equal(helpers.relationStageLiveSentence("Ship", "", "Target"), "Ship → Target");
  // LG3: labels validate like capture; empty is a plain link.
  assert.equal(helpers.describeRelationLabelRefusal(""), null);
  assert.equal(helpers.describeRelationLabelRefusal("see also"), null);
  assert.match(helpers.describeRelationLabelRefusal("x".repeat(41)), /40/);
  assert.match(helpers.describeRelationLabelRefusal("see (old)"), /cannot contain/);
  assert.equal(
    helpers.relationCancelHandEditHint("duplicate of"),
    "⊘ “duplicate of” cancels only from the Links stage or capture · this task stays open",
  );
  assert.equal(
    helpers.relationCompleteHandEditHint("implemented by"),
    "✓ “implemented by” completes only from the Links stage or capture · this task stays open",
  );
  assert.equal(
    helpers.relationCloseConfirmBanner(2, 0),
    "⊘ Cancels 2 tasks — ↵ again to confirm",
  );
  assert.equal(
    helpers.relationCloseConfirmBanner(0, 2),
    "✓ Completes 2 tasks — ↵ again to confirm",
  );
  assert.equal(
    helpers.relationCloseConfirmBanner(1, 1),
    "Closes 2 tasks · ✓ 1 · ⊘ 1 — ↵ again to confirm",
  );
  assert.equal(helpers.relationCloseFooterEnterLabel({ completeCount: 1 }), "link & complete");
  assert.equal(
    helpers.relationCloseFooterEnterLabel({ cancelCount: 1, completeCount: 1 }),
    "link & close",
  );
  assert.equal(
    helpers.relationLabelCancelConsequenceStrip(
      { kind: "relation-label", label: "implemented by" },
      {
        preview: {
          completes: [{ text: "Ship it", projectOpenTasks: 2 }],
          cancels: [],
        },
      },
    ),
    "✓ Completes “Ship it” · unblocks dependents · offers successors · its 2 open tasks stay open",
  );
  assert.equal(
    helpers.relationLabelCancelConsequenceStrip(
      { kind: "relation-label", label: "implemented by" },
      {
        preview: {
          inverseHint: "“implements” never completes · to finish “Target”, use ⇧L with “implemented by”",
          completes: [],
          cancels: [],
        },
      },
    ),
    "“implements” never completes · to finish “Target”, use ⇧L with “implemented by”",
  );
  assert.equal(
    helpers.relationLabelCancelConsequenceStrip(
      { kind: "relation-label", label: "implemented by" },
      {
        preview: {
          completeSources: [{ text: "Ship it", status: "x", verdict: "already_closed" }],
          completes: [],
          cancels: [],
        },
      },
    ),
    "Already Done · link only",
  );
  assert.equal(
    helpers.relationLabelCancelConsequenceStrip(
      { kind: "relation-label", label: "implemented by" },
      { preview: { staysDone: true, completes: [], cancels: [] } },
    ),
    "stays Done · reopen with Alt+[",
  );
  assert.equal(
    helpers.relationLabelCancelConsequenceStrip(
      { kind: "relation-label", label: "supersedes" },
      { preview: { inverseHint: "“supersedes” never cancels · to retire “Target”, use ⇧L", cancels: [] } },
    ),
    "“supersedes” never cancels · to retire “Target”, use ⇧L",
  );
  assert.equal(
    helpers.relationLabelCancelConsequenceStrip(
      { kind: "relation-label", label: "duplicate of" },
      {
        preview: {
          sources: [{ text: "Ship it", blockId: "prj", projectOpenTasks: 1 }],
          cancels: [{ text: "Ship it", blockId: "prj", projectOpenTasks: 1 }],
        },
      },
    ),
    "⊘ Cancels “Ship it” · removes its links from today's open Pomodoros · unblocks dependents · its 1 open task stays open",
  );
  assert.equal(
    helpers.relationLabelCancelConsequenceStrip(
      { kind: "relation-label", label: "duplicate of" },
      {
        preview: {
          sources: [{ text: "Ship it", blockId: "prj", projectOpenTasks: 2 }],
          cancels: [{ text: "Ship it", blockId: "prj", projectOpenTasks: 2 }],
        },
      },
    ),
    "⊘ Cancels “Ship it” · removes its links from today's open Pomodoros · unblocks dependents · its 2 open tasks stay open",
  );
});

test("cancel labels overlay at zero uses and render the live source cue", () => {
  const notes = {
    "Tasks.md": "- [ ] #task Source ^source\n- [ ] #task Target ^target",
  };
  const { picker } = makeCancelCuePicker(
    notes,
    [{ line: 0, blockId: "source" }],
    { path: "Tasks.md", line: 1, blockId: "target", displayText: "Target" },
  );
  const item = picker.visibleItems.find((row) => row.label === "duplicate of");
  assert.ok(item, "a configured label appears before its first use");
  assert.equal(item.count, 0);
  assert.equal(item.configuredCancel, true);
  picker.selectedIndex = picker.visibleItems.indexOf(item);
  const spans = [];
  const subtitle = {
    empty() { spans.length = 0; },
    createSpan(options) { spans.push(options); },
  };
  assert.equal(picker.renderPickerSubtitle(subtitle), true);
  assert.deepEqual(spans.map((span) => span.text), [
    "⊘ ",
    "Source",
    " — duplicate of → Target",
  ]);
  assert.match(spans[1].cls, /relation-cancel-source/);
  const strip = {
    spans: [],
    empty() { this.spans = []; },
    createSpan(options) { this.spans.push(options); },
  };
  picker.ensureRelationConsequenceStrip = () => strip;
  picker.refreshRelationConsequenceStrip();
  assert.match(
    strip.spans[0].text,
    /⊘ Cancels “Source” · removes its links from today's open Pomodoros · unblocks dependents/,
  );
});

test("recurring cancel rows are disabled and a multi-source cancel needs a second Return", async () => {
  const recurringNotes = {
    "Tasks.md": "- [ ] #task Recurring 🔁 ^recurring\n- [ ] #task Target ^target",
  };
  const recurring = makeCancelCuePicker(
    recurringNotes,
    [{ line: 0, blockId: "recurring" }],
    { path: "Tasks.md", line: 1, blockId: "target", displayText: "Target" },
  );
  const recurringItem = recurring.picker.visibleItems.find((row) => row.label === "duplicate of");
  assert.equal(recurringItem.disabled, true);
  assert.equal(
    recurringItem.disabledReason,
    "“Recurring 🔁” repeats — cancel it with Obsidian Tasks first",
  );
  let recurringWrites = 0;
  recurring.plugin.applyRelationEdit = async () => {
    recurringWrites += 1;
    return { ok: true };
  };
  assert.equal(await recurring.picker.commitRelationLabel(recurringItem), false);
  assert.equal(recurringWrites, 0);

  const notes = {
    "Tasks.md": [
      "- [ ] #task First ^first",
      "- [ ] #task Second ^second",
      "- [ ] #task Target ^target",
    ].join("\n"),
  };
  const batch = makeCancelCuePicker(
    notes,
    [
      { line: 0, blockId: "first" },
      { line: 1, blockId: "second" },
    ],
    { path: "Tasks.md", line: 2, blockId: "target", displayText: "Target" },
  );
  const { picker } = batch;
  const itemIndex = picker.visibleItems.findIndex((row) => row.label === "duplicate of");
  picker.selectedIndex = itemIndex;
  let writes = 0;
  let writeArgs = null;
  batch.plugin.applyRelationEdit = async (args) => {
    writes += 1;
    writeArgs = args;
    return { ok: true };
  };
  const confirmStrip = {
    spans: [],
    empty() { this.spans = []; },
    createSpan(options) { this.spans.push(options); },
  };
  picker.ensureRelationConsequenceStrip = () => confirmStrip;
  assert.equal(await picker.commitRelationLabel(picker.visibleItems[itemIndex]), false);
  assert.equal(writes, 0, "the first Return only opens the confirmation step");
  assert.equal(picker.getRelationLabelFooterHints()[4].label, "again to confirm");
  picker.refreshRelationConsequenceStrip();
  assert.equal(
    confirmStrip.spans[0].text,
    "⊘ Cancels 2 tasks — ↵ again to confirm",
  );
  assert.equal(await picker.commitRelationLabel(picker.visibleItems[itemIndex]), true);
  assert.equal(writes, 1);
  assert.equal(
    writeArgs.expectedCancelEffects.sources.filter((source) => source.cancels).length,
    2,
  );
});

test("complete labels overlay at zero uses and render the live source cue", () => {
  const notes = {
    "Tasks.md": "- [ ] #task Source ^source\n- [ ] #task Target ^target",
  };
  const { picker } = makeCompleteCuePicker(
    notes,
    [{ line: 0, blockId: "source", displayText: "Source" }],
    { path: "Tasks.md", line: 1, blockId: "target", displayText: "Target", rawLine: "- [ ] #task Target ^target" },
  );
  const item = picker.visibleItems.find((row) => row.label === "implemented by");
  assert.ok(item, "a configured complete label appears before its first use");
  assert.equal(item.count, 0);
  assert.equal(item.configuredComplete, true);
  picker.selectedIndex = picker.visibleItems.indexOf(item);
  const spans = [];
  const subtitle = {
    empty() { spans.length = 0; },
    createSpan(options) { spans.push(options); },
  };
  assert.equal(picker.renderPickerSubtitle(subtitle), true);
  assert.deepEqual(spans.map((span) => span.text), [
    "✓ ",
    "Source",
    " — implemented by → Target",
  ]);
  assert.match(spans[1].cls, /relation-complete-source/);
  const strip = {
    spans: [],
    empty() { this.spans = []; },
    createSpan(options) { this.spans.push(options); },
  };
  picker.ensureRelationConsequenceStrip = () => strip;
  picker.refreshRelationConsequenceStrip();
  assert.match(
    strip.spans[0].text,
    /✓ Completes “Source” · unblocks dependents · offers successors/,
  );
  assert.equal(picker.getRelationLabelFooterHints()[4].label, "link & complete");
});

test("complete labels keep used-count meta, hide overlay, and stay inert without config", () => {
  const notes = {
    "Tasks.md": "- [ ] #task Source ^source\n- [ ] #task Target ^target",
  };
  const used = makeCompleteCuePicker(
    notes,
    [{ line: 0, blockId: "source" }],
    { path: "Tasks.md", line: 1, blockId: "target", displayText: "Target" },
    { implementedCount: 14 },
  );
  const usedItem = used.picker.visibleItems.find((row) => row.label === "implemented by");
  assert.equal(usedItem.count, 14);
  assert.equal(usedItem.configuredComplete, true);
  const metas = [];
  const usedRow = {
    classList: { add() {} },
    setAttribute() {},
    createDiv() {
      return {
        classList: { add() {} },
        createDiv(options) {
          metas.push(options);
          return {
            classList: { add() {} },
            createSpan() { return {}; },
            appendText() {},
          };
        },
      };
    },
  };
  used.picker.renderRelationLabelItem(usedItem, usedRow, "");
  assert.equal(
    metas.find((meta) => meta && /complete-meta/.test(meta.cls)).text,
    "used 14× · ✓ completes",
  );

  const hidden = makeCompleteCuePicker(
    notes,
    [{ line: 0, blockId: "source" }],
    { path: "Tasks.md", line: 1, blockId: "target", displayText: "Target" },
    { implementedHidden: true },
  );
  assert.equal(
    hidden.picker.visibleItems.some((row) => row.label === "implemented by"),
    false,
  );
  hidden.picker.relationLabelShowHidden = true;
  hidden.picker.renderResults();
  const hiddenItem = hidden.picker.visibleItems.find((row) => row.label === "implemented by");
  assert.equal(hiddenItem.hidden, true);
  assert.equal(hiddenItem.configuredComplete, true);

  const inert = makeCancelCuePicker(
    notes,
    [{ line: 0, blockId: "source" }],
    { path: "Tasks.md", line: 1, blockId: "target", displayText: "Target" },
  );
  assert.equal(
    inert.picker.visibleItems.some((row) => row.configuredComplete === true),
    false,
  );
  const cancelItem = inert.picker.visibleItems.find((row) => row.label === "duplicate of");
  assert.equal(cancelItem.configuredCancel, true);
  inert.picker.selectedIndex = inert.picker.visibleItems.indexOf(cancelItem);
  assert.equal(inert.picker.getRelationLabelFooterHints()[4].label, "link & cancel");
});

test("complete-label copy covers verdicts, inverse hint, cancelled target, and cycler disable", () => {
  const notes = {
    "Tasks.md": "- [ ] #task Source ^source\n- [ ] #task Target ^target",
    "Other.md": "- [x] #task Remote ^remote",
  };
  const inverse = makeCompleteCuePicker(
    notes,
    [{ line: 0, blockId: "source", displayText: "Source" }],
    { path: "Tasks.md", line: 1, blockId: "target", displayText: "Target" },
    { query: "implements" },
  );
  const inverseItem = inverse.picker.visibleItems.find((row) => row.label === "implements" || row.typed);
  inverse.picker.selectedIndex = inverse.picker.visibleItems.indexOf(inverseItem);
  const inverseStrip = {
    spans: [],
    empty() { this.spans = []; },
    createSpan(options) { this.spans.push(options); },
  };
  inverse.picker.ensureRelationConsequenceStrip = () => inverseStrip;
  inverse.picker.refreshRelationConsequenceStrip();
  assert.match(
    inverseStrip.spans[0].text,
    /“implements” never completes · to finish “Target”, use ⇧L with “implemented by”/,
  );

  const cancelledTarget = makeCompleteCuePicker(
    notes,
    [{ line: 0, blockId: "source", displayText: "Source" }],
    {
      path: "Tasks.md",
      line: 1,
      blockId: "target",
      displayText: "Target",
      rawLine: "- [-] #task Target ^target",
    },
  );
  const completeItem = cancelledTarget.picker.visibleItems.find((row) => row.label === "implemented by");
  cancelledTarget.picker.selectedIndex = cancelledTarget.picker.visibleItems.indexOf(completeItem);
  const caveatStrip = {
    spans: [],
    empty() { this.spans = []; },
    createSpan(options) { this.spans.push(options); },
  };
  cancelledTarget.picker.ensureRelationConsequenceStrip = () => caveatStrip;
  cancelledTarget.picker.refreshRelationConsequenceStrip();
  assert.ok(caveatStrip.spans.some((span) => /is Cancelled/.test(span.text)));

  const oldCycler = makeCompleteCuePicker(
    notes,
    [{ line: 0, blockId: "source", displayText: "Source" }],
    { path: "Tasks.md", line: 1, blockId: "target", displayText: "Target" },
    { cycler: false },
  );
  const disabled = oldCycler.picker.visibleItems.find((row) => row.label === "implemented by");
  assert.equal(disabled.disabled, true);
  assert.equal(disabled.disabledReason, "Update Task Status Cycler to complete from a link");
});

test("recurring complete rows are disabled and a multi-source complete needs a second Return", async () => {
  const recurringNotes = {
    "Tasks.md": "- [ ] #task Recurring 🔁 ^recurring\n- [ ] #task Target ^target",
  };
  const recurring = makeCompleteCuePicker(
    recurringNotes,
    [{ line: 0, blockId: "recurring", displayText: "Recurring 🔁" }],
    { path: "Tasks.md", line: 1, blockId: "target", displayText: "Target" },
  );
  const recurringItem = recurring.picker.visibleItems.find((row) => row.label === "implemented by");
  assert.equal(recurringItem.disabled, true);
  assert.equal(
    recurringItem.disabledReason,
    "“Recurring 🔁” repeats — complete it in Obsidian so Tasks writes the next one",
  );

  const notes = {
    "Tasks.md": [
      "- [ ] #task First ^first",
      "- [ ] #task Second ^second",
      "- [ ] #task Target ^target",
    ].join("\n"),
  };
  const batch = makeCompleteCuePicker(
    notes,
    [
      { line: 0, blockId: "first", displayText: "First" },
      { line: 1, blockId: "second", displayText: "Second" },
    ],
    { path: "Tasks.md", line: 2, blockId: "target", displayText: "Target" },
  );
  const { picker } = batch;
  const itemIndex = picker.visibleItems.findIndex((row) => row.label === "implemented by");
  picker.selectedIndex = itemIndex;
  let writes = 0;
  batch.plugin.applyRelationEdit = async () => {
    writes += 1;
    return { ok: true };
  };
  picker.commitRelationEdit = async () => {
    writes += 1;
    return true;
  };
  const confirmStrip = {
    spans: [],
    empty() { this.spans = []; },
    createSpan(options) { this.spans.push(options); },
  };
  picker.ensureRelationConsequenceStrip = () => confirmStrip;
  assert.equal(await picker.commitRelationLabel(picker.visibleItems[itemIndex]), false);
  assert.equal(writes, 0, "the first Return only opens the confirmation step");
  assert.equal(picker.getRelationLabelFooterHints()[4].label, "again to confirm");
  picker.refreshRelationConsequenceStrip();
  assert.equal(
    confirmStrip.spans[0].text,
    "✓ Completes 2 tasks — ↵ again to confirm",
  );
  picker.handleKeydown({
    key: "Escape",
    preventDefault() {},
    stopPropagation() {},
  });
  assert.equal(picker.stage, "relation-label", "Escape disarms without leaving the field");
  assert.equal(picker.relationCancelConfirmNonce, null);
  picker.selectedIndex = picker.visibleItems.findIndex((row) => row.label === "implemented by");
  assert.equal(await picker.commitRelationLabel(picker.visibleItems[picker.selectedIndex]), false);
  assert.equal(writes, 0, "Escape disarms the confirm step");
  assert.equal(await picker.commitRelationLabel(picker.visibleItems[picker.selectedIndex]), true);
  assert.equal(writes, 1);
});

test("mixed closing banner and footer name both effects", () => {
  assert.equal(
    helpers.relationCloseConfirmBanner(2, 1),
    "Closes 3 tasks · ✓ 1 · ⊘ 2 — ↵ again to confirm",
  );
  assert.equal(
    helpers.relationCloseFooterEnterLabel({
      cancelCount: 1,
      completeCount: 1,
      confirming: false,
    }),
    "link & close",
  );
  assert.equal(
    helpers.relationLabelCancelConsequenceStrip(
      { kind: "relation-label", label: "implemented by" },
      { confirmBanner: helpers.relationCloseConfirmBanner(1, 1) },
    ),
    "Closes 2 tasks · ✓ 1 · ⊘ 1 — ↵ again to confirm",
  );
});

test("LG15: marked rows plan one commit with adds and unlinks split", () => {
  const planned = helpers.planRelationStageCommit([
    { kind: "local-task", path: "O.md", line: 3, blockId: "a", stageSection: "results" },
    { kind: "local-task", path: "O.md", line: 4, blockId: "b", stageSection: "results" },
    { kind: "local-task", path: "T.md", line: 0, blockId: "gone", stageSection: "current", alreadyLinked: true },
    { kind: "stage-more", stageSection: "results", disabled: true },
    { kind: "local-task", path: "O.md", line: 5, blockId: "c", stageSection: "results", disabled: true, disabledReason: "this task" },
  ]);
  assert.equal(planned.add.length, 2);
  assert.equal(planned.remove.length, 1);
  assert.equal(planned.remove[0].blockId, "gone");
});

test("LG1: stage link writes LINKS, mirror, and mint in one transaction", async () => {
  const source = "- [ ] #task Source\n- [ ] #task Target ^target";
  const harness = makePlugin({ "Tasks.md": source });
  const editor = new TestEditor(source);
  harness.openEditors.set("Tasks.md", editor);
  const outcome = await harness.plugin.applyRelationEdit({
    sources: [{ path: "Tasks.md", line: 0 }],
    add: [{ path: "Tasks.md", blockId: "target" }],
    linkedFromLinesEnabled: true,
  });
  assert.equal(outcome.ok, true);
  assert.equal(editor.undoGroups, 1);
  assert.match(editor.getValue(), /🪢 \*\*LINKS:\*\* \[\[#\^target\]\]/);
  assert.match(editor.getValue(), /🪢 \*\*LINKED FROM:\*\* \[\[#\^\w/);
  assert.match(outcome.notice, /🪢 Linked to/);
});

test("LG2: cross-note mirror follows; a changed target suffixes the notice", async () => {
  const harness = makePlugin({
    "Tasks.md": "- [ ] #task Source ^source",
    "Other.md": "- [ ] #task Target ^target",
  });
  const editor = new TestEditor("- [ ] #task Source ^source");
  harness.openEditors.set("Tasks.md", editor);
  const outcome = await harness.plugin.applyRelationEdit({
    sources: [{ path: "Tasks.md", line: 0, blockId: "source" }],
    add: [{ path: "Other.md", blockId: "target" }],
    linkedFromLinesEnabled: true,
  });
  assert.equal(outcome.ok, true);
  assert.match(
    harness.store.get("Other.md"),
    /🪢 \*\*LINKED FROM:\*\* \[\[Tasks#\^source\]\]/,
  );

  const stale = makePlugin({
    "Tasks.md": "- [ ] #task Source ^source",
    "Other.md": "- [ ] #task Target ^target",
  });
  stale.openEditors.set("Tasks.md", new TestEditor("- [ ] #task Source ^source"));
  const original = stale.plugin.app.vault.cachedRead;
  let otherReads = 0;
  stale.plugin.app.vault.cachedRead = async (file) => {
    const content = await original(file);
    if (file.path === "Other.md") {
      otherReads += 1;
      if (otherReads > 1) return `${content}\nchanged`;
    }
    return content;
  };
  const failed = await stale.plugin.applyRelationEdit({
    sources: [{ path: "Tasks.md", line: 0, blockId: "source" }],
    add: [{ path: "Other.md", blockId: "target" }],
    linkedFromLinesEnabled: true,
  });
  assert.equal(failed.ok, true);
  assert.match(failed.notice, /🪢 LINKED FROM not updated/);
});

test("LG4: CURRENT unlink removes the entry and its mirror entry", async () => {
  const harness = makePlugin({
    "Tasks.md": "- [ ] #task Source ^source\n  - 🪢 **LINKS:** [[Other#^target]]",
    "Other.md":
      "- [ ] #task Target ^target\n  - 🪢 **LINKED FROM:** [[Tasks#^source]]",
  });
  const editor = new TestEditor(harness.store.get("Tasks.md"));
  harness.openEditors.set("Tasks.md", editor);
  const outcome = await harness.plugin.applyRelationEdit({
    sources: [{ path: "Tasks.md", line: 0, blockId: "source" }],
    remove: [{ path: "Other.md", blockId: "target" }],
    linkedFromLinesEnabled: true,
  });
  assert.equal(outcome.ok, true);
  assert.doesNotMatch(editor.getValue(), /\*\*LINKS:\*\*/);
  assert.doesNotMatch(harness.store.get("Other.md"), /\*\*LINKED FROM:\*\*/);
  assert.match(outcome.notice, /🪢 Unlinked/);
});

test("LG6: archived targets link with the live-only suffix and no mirror", async () => {
  const harness = makePlugin({
    "Tasks.md": "- [ ] #task Source ^source",
    "done/Old.md": "- [x] #task Ancient ^ancient",
  });
  const editor = new TestEditor("- [ ] #task Source ^source");
  harness.openEditors.set("Tasks.md", editor);
  const outcome = await harness.plugin.applyRelationEdit({
    sources: [{ path: "Tasks.md", line: 0, blockId: "source" }],
    add: [{ path: "done/Old.md", blockId: "ancient" }],
    linkedFromLinesEnabled: true,
  });
  assert.equal(outcome.ok, true);
  assert.match(editor.getValue(), /\[\[done\/Old#\^ancient\]\]/);
  assert.match(outcome.notice, /archived: shown live only/);
  assert.doesNotMatch(harness.store.get("done/Old.md"), /LINKED FROM/);
});

test("LG13: linking never stamps, routes, or touches Depends-On lines", async () => {
  const source = [
    "- [ ] #task Source",
    "  - ⛓️ **DEPENDS ON:** [[Other#^up]]",
    "- [ ] #task Target ^target",
  ].join("\n");
  const harness = makePlugin({ "Tasks.md": source });
  const editor = new TestEditor(source);
  harness.openEditors.set("Tasks.md", editor);
  const outcome = await harness.plugin.applyRelationEdit({
    sources: [{ path: "Tasks.md", line: 0 }],
    add: [{ path: "Tasks.md", blockId: "target" }],
    linkedFromLinesEnabled: true,
  });
  assert.equal(outcome.ok, true);
  assert.match(editor.getValue(), /⛓️ \*\*DEPENDS ON:\*\* \[\[Other#\^up\]\]/);
  assert.doesNotMatch(editor.getValue(), /WORK LOG|SCHEDULE LOG|CANCEL LOG/);
});

test("LG15: two targets link in one gesture with one notice", async () => {
  const source = "- [ ] #task Source ^source\n- [ ] #task A ^a\n- [ ] #task B ^b";
  const harness = makePlugin({ "Tasks.md": source });
  const editor = new TestEditor(source);
  harness.openEditors.set("Tasks.md", editor);
  const planned = helpers.planRelationStageCommit([
    { kind: "local-task", path: "Tasks.md", line: 1, blockId: "a", stageSection: "results" },
    { kind: "local-task", path: "Tasks.md", line: 2, blockId: "b", stageSection: "results" },
  ]);
  const outcome = await harness.plugin.applyRelationEdit({
    sources: [{ path: "Tasks.md", line: 0, blockId: "source" }],
    add: planned.add,
    remove: planned.remove,
    linkedFromLinesEnabled: true,
  });
  assert.equal(outcome.ok, true);
  assert.equal(editor.undoGroups, 1);
  assert.match(outcome.notice, /Linked 2 tasks/);
});

test("LG5: id-less targets refuse at the writer, so the stage prompts first", async () => {
  const harness = makePlugin({
    "Tasks.md": "- [ ] #task Source ^source\n- [ ] #task No id",
  });
  harness.openEditors.set(
    "Tasks.md",
    new TestEditor(harness.store.get("Tasks.md")),
  );
  const outcome = await harness.plugin.applyRelationEdit({
    sources: [{ path: "Tasks.md", line: 0, blockId: "source" }],
    add: [{ path: "Tasks.md", line: 1 }],
    linkedFromLinesEnabled: true,
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, "target-needs-id");
});

test("LG7: Ctrl+Shift+P resolves LINKED FROM to its owner's reverse stage", () => {
  const content = [
    "- [ ] #task Target ^target",
    "  - 🪢 **LINKED FROM:** [[Source#^source]]",
  ].join("\n");
  const entry = helpers.resolveDependencyStageEntry(content, 1);
  assert.equal(entry.ok, true);
  assert.equal(entry.lineKind, "linked-from");
  assert.equal(entry.parentLine, 0);
});

test("api.relations openStage opens both directions at v1", async () => {
  const calls = [];
  const fake = {
    openRelationStageForRef: async (ref) => {
      calls.push(ref);
      return { ok: true };
    },
  };
  const api = helpers.createRelationsNavApi(fake);
  assert.equal(api.version, 1);
  const opened = await api.openStage({ path: "Tasks.md", line: 0, direction: "to" });
  assert.equal(opened.ok, true);
  assert.deepEqual(calls, [{ path: "Tasks.md", line: 0, direction: "to" }]);
  const reverse = await api.openStage({ path: "Tasks.md", line: 0, direction: "from" });
  assert.equal(reverse.ok, true);
  assert.deepEqual(calls[1], { path: "Tasks.md", line: 0, direction: "from" });
  const missing = await helpers.createRelationsNavApi(null).openStage({ path: "T.md", line: 0 });
  assert.equal(missing.ok, false);
});

test("relation-label stage Tab, Ctrl+D, pipe, and Ctrl+H mirror the card", async () => {
  const notes = currentOtherNotes();
  const { picker } = makeCurrentOtherPicker("to", notes, {});
  let query = "";
  const hidden = new Set();
  const catalog = [
    { key: "see", name: "see", count: 3, hidden: false, inverse: null },
    { key: "implements", name: "implements", count: 2, hidden: false, inverse: null },
  ];
  const writes = [];
  let relationLabelsChanged = null;
  let relationLabelUnsubscribes = 0;
  picker.app = {
    plugins: {
      plugins: {
        "bob-ledger-tools": {
          api: {
            relationLabels: {
              version: 1,
              rows(prefix, options = {}) {
                const needle = String(prefix || "").trim().toLowerCase();
                return catalog
                  .map((row) => ({ ...row, hidden: hidden.has(row.key) }))
                  .filter((row) => options.hidden === "include" || (options.hidden === "only" ? row.hidden : !row.hidden))
                  .filter((row) => !needle || row.name.toLowerCase().includes(needle));
              },
              hiddenCount: () => hidden.size,
              onChange(listener) {
                relationLabelsChanged = listener;
                return () => { relationLabelUnsubscribes += 1; };
              },
              async hide(label) {
                writes.push(["hide", label]);
                hidden.add(String(label).toLowerCase());
                return { ok: true };
              },
              async unhide(label) {
                writes.push(["unhide", label]);
                hidden.delete(String(label).toLowerCase());
                return { ok: true };
              },
            },
          },
        },
      },
    },
  };
  beginRelationLabel(picker, [{ path: "Other.md", line: 0, blockId: "other" }], "");
  picker.getRawQuery = () => query;
  let renders = 0;
  picker.renderResults = () => {
    renders += 1;
    picker.visibleItems = picker.getRelationLabelPreviewItems();
  };
  const opened = [];
  picker.openItemAtIndex = async (index) => {
    opened.push(index);
    return true;
  };
  const renameRequests = [];
  picker.openRelationLabelRenameForStage = (item) => {
    renameRequests.push(item);
    return true;
  };
  picker.visibleItems = picker.getRelationLabelPreviewItems();
  const initialRenders = renders;
  relationLabelsChanged();
  assert.ok(renders > initialRenders, "catalog changes refresh the open relation-label stage");

  const key = (name, fields = {}) => ({
    key: name,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; },
    ...fields,
  });

  assert.equal(picker.handleRelationLabelKeydown(key("Tab")), true);
  assert.deepEqual(opened.pop(), 1, "row zero Tab accepts the top visible label");

  assert.equal(picker.handleRelationLabelKeydown(key("n", { ctrlKey: true })), true);
  assert.equal(picker.selectedIndex, 1, "Ctrl+N selects the first suggestion without changing the query");
  assert.equal(query, "");
  assert.equal(picker.handleRelationLabelKeydown(key("r", { ctrlKey: true })), true);
  assert.equal(renameRequests[0].label, "see", "Ctrl+R opens rename for the selected catalog label");
  assert.equal(renameRequests[0].typed, false);
  assert.equal(picker.handleRelationLabelKeydown(key("Tab")), true);
  assert.deepEqual(opened.pop(), 1, "Tab accepts the selected label");

  assert.equal(picker.handleRelationLabelKeydown(key("d", { ctrlKey: true })), true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(writes[0], ["hide", "see"]);
  assert.equal(picker.relationLabelGhosts.get("see").hidden, true);

  assert.equal(picker.handleRelationLabelKeydown(key("h", { ctrlKey: true })), true);
  assert.equal(picker.relationLabelShowHidden, true);
  assert.equal(picker.visibleItems.some((row) => row.kind === "relation-label-heading"), true);

  query = "a one-off label";
  picker.selectedIndex = 0;
  picker.renderResults();
  assert.equal(picker.handleRelationLabelKeydown(key("d", { ctrlKey: true })), true);
  assert.equal(picker.relationLabelOneOff, true);
  assert.equal(picker.handleRelationLabelKeydown(key("|", { shiftKey: true })), true);
  assert.equal(picker.relationLabelOneOff, true);
  picker.clearRelationLabelSubscriptions();
  assert.equal(relationLabelUnsubscribes, 1, "stage teardown releases the catalog listener");
});

test("relation-label rename preview reports done/ impact and checks affected editors", async () => {
  const preview = {
    ok: true,
    mode: "dry_run",
    from: { name: "see" },
    to: { name: "reference to" },
    merge: true,
    files: [
      { path: "tasks/a.md", links: 2, mirrors: 1, lines: [{ before: "see", after: "reference to" }] },
      { path: "done/old.md", links: 1, mirrors: 0, lines: [{ before: "see", after: "reference to" }] },
    ],
    counts: { links: 3, notes: 2, mirrors: 1, done_links: 1 },
  };
  const summary = helpers.formatRelationLabelRenamePreview(preview);
  assert.match(summary.title, /3 links in 2 notes · 1 mirror · 1 in done\//);
  assert.deepEqual(helpers.relationLabelRenameFilePaths(preview), ["tasks/a.md", "done/old.md"]);
  assert.equal(summary.merge, true);

  const leaves = [
    { view: { file: { path: "tasks/a.md" }, editor: { getValue: () => "disk a" } } },
    { view: { file: { path: "done/old.md" }, editor: { getValue: () => "unsaved old" } } },
    { view: { file: { path: "other.md" }, editor: { getValue: () => "not in the rename" } } },
  ];
  const app = {
    workspace: { iterateAllLeaves(callback) { leaves.forEach(callback); } },
    vault: { async read(file) { return file.path === "tasks/a.md" ? "disk a" : "disk old"; } },
  };
  assert.deepEqual(await helpers.relationLabelDirtyEditorPaths(app, preview), ["done/old.md"]);
});

test("relation-label rename modal re-previews, saves the active note, and confirms merges", async () => {
  const calls = [];
  let saves = 0;
  const report = {
    ok: true,
    mode: "dry_run",
    from: { key: "see", name: "see" },
    to: { key: "reference to", name: "reference to" },
    merge: true,
    files: [{ path: "tasks/a.md", links: 1, mirrors: 1, lines: [] }],
    counts: { links: 1, notes: 1, mirrors: 1, done_links: 0 },
    state: { note: "hidden state remains hidden" },
    inverse: { note: "no inverse change" },
    sync: { pre: "skipped", post: "complete" },
    warnings: [],
  };
  const activeView = {
    file: { path: "tasks/a.md" },
    editor: { getValue: () => "disk content" },
    async save() { saves += 1; },
  };
  const relationLabels = {
    version: 1,
    async rename(from, to, options) {
      calls.push({ from, to, options });
      return { ok: true, report };
    },
  };
  const app = {
    plugins: { plugins: { "bob-ledger-tools": { api: { relationLabels } } } },
    workspace: {
      getActiveViewOfType: () => activeView,
      iterateAllLeaves(callback) { callback({ view: activeView }); },
    },
    vault: { async read() { return "disk content"; } },
  };
  const modal = new helpers.RelationLabelRenameModal(app, "see");
  modal.nameInput = { value: "reference to" };
  modal.mergeToggle = { checked: true };
  modal.mergeConfirmToggle = { checked: false };
  modal.close = () => {};
  const preview = await modal.previewRename();
  assert.match(preview.title, /1 link in 1 note · 1 mirror/);
  assert.equal(saves, 1, "active editor is saved before showing the dry-run plan");
  assert.equal(modal.renamePreview.merge, true, "the merge is previewed before its separate confirmation");

  modal.mergeConfirmToggle.checked = true;
  modal.renderRenamePreview();
  assert.equal(await modal.applyRename(), true);
  assert.equal(saves, 2, "active editor is saved again immediately before apply");
  assert.deepEqual(calls.map((call) => call.options), [
    { dryRun: true, merge: true, via: "bob-navigation-hotkeys" },
    { dryRun: true, merge: true, via: "bob-navigation-hotkeys" },
    { dryRun: false, merge: true, via: "bob-navigation-hotkeys" },
  ]);
});

test("Bob: Relation labels manager keeps hidden labels visible and delegates hide and unhide", async () => {
  const hidden = new Set(["retired"]);
  const writes = [];
  const api = {
    version: 1,
    rows(_query, options = {}) {
      return [
        { key: "see", name: "see", count: 2, hidden: hidden.has("see"), inverse: null },
        { key: "retired", name: "retired", count: 0, hidden: hidden.has("retired"), inverse: null },
      ].filter((row) => options.hidden === "include" || (options.hidden === "only" ? row.hidden : !row.hidden));
    },
    async hide(name) { writes.push(["hide", name]); hidden.add(name); return { ok: true }; },
    async unhide(name) { writes.push(["unhide", name]); hidden.delete(name); return { ok: true }; },
  };
  const app = { plugins: { plugins: { "bob-ledger-tools": { api: { relationLabels: api } } } } };
  const manager = new helpers.RelationLabelManagerModal(app, {});
  manager.renderResults = () => {};
  await manager.refreshRelationLabelManagerRows();
  assert.deepEqual(manager.items.map((row) => [row.name, row.hidden]), [["see", false], ["retired", true]]);
  await manager.toggleRelationLabel(manager.items[0]);
  assert.deepEqual(writes[0], ["hide", "see"]);
  await manager.toggleRelationLabel(manager.items[1]);
  assert.deepEqual(writes[1], ["unhide", "retired"]);
  assert.equal(hidden.has("retired"), false);
});

test("one-off labels hide through bob only after the relation commit succeeds", async () => {
  const notes = currentOtherNotes();
  const { picker, currentEditor } = makeCurrentOtherPicker("to", notes, {});
  const target = { path: "Other.md", line: 0, blockId: "other" };
  const hideCalls = [];
  picker.app = {
    plugins: {
      plugins: {
        "bob-ledger-tools": {
          api: {
            relationLabels: {
              version: 1,
              rows: () => [],
              hiddenCount: () => 0,
              async hide(label, options) {
                hideCalls.push([label, options]);
                return { ok: true };
              },
            },
          },
        },
      },
    },
  };
  beginRelationLabel(picker, [target], "prompted the purchase of");
  picker.getRelationLabelPreviewItems();
  picker.relationLabelOneOff = true;
  const item = picker.getRelationLabelPreviewItems()[0];
  assert.equal(await picker.commitRelationLabel(item), true);
  assert.match(currentEditor.getValue(), /prompted the purchase of \[\[Other#\^other\]\]/);
  assert.deepEqual(hideCalls, [["prompted the purchase of", { allowUnused: true }]]);
});

// LG16: `~` anywhere in a Links / Linked-from filter flips the stage in
// place, keeping the filter text and caret. The typed `~` never enters the
// filter, repeats are ignored, and counted sessions refuse the flip.
function makeFlipPicker(direction, query, extra = {}) {
  const notes = {
    "Current.md": "- [ ] #task Current owner ^owner",
    "Other.md": "- [ ] #task Footnote task ^foot\n- [ ] #task Unrelated ^other",
  };
  const harness = makePlugin(notes);
  const editor = new TestEditor(notes["Current.md"]);
  harness.openEditors.set("Current.md", editor);
  harness.openEditors.set("Other.md", new TestEditor(notes["Other.md"]));
  const picker = Object.create(helpers.BulletPropertyPickerModal.prototype);
  picker.plugin = harness.plugin;
  picker.app = harness.plugin.app;
  picker.filePath = "Current.md";
  picker.editor = editor;
  picker.cursor = { line: 0 };
  picker.lineText = String(notes["Current.md"]).split(/\r?\n/)[0];
  picker.taskSession = extra.taskSession || null;
  picker.linkSession = null;
  picker.stage = "value";
  picker.relationStage = true;
  picker.relationStageDirection = direction;
  picker.selectedPropertyItem = {
    property: { name: "linksTo", values: "local_task_id" },
  };
  picker.selectedIndex = 0;
  picker.markedLines = new Set(extra.marks || []);
  picker.taskItemsByLine = new Map();
  picker.items = [];
  picker.visibleItems = [];
  picker.opening = false;
  picker.pendingBatch = null;
  const caret = extra.caret === undefined ? String(query).length : extra.caret;
  picker.inputEl = {
    value: query,
    selectionStart: caret,
    selectionEnd: caret,
    setSelectionRange(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end;
    },
    setAttribute() {},
  };
  return { harness, picker, editor };
}

function tildeKeyEvent(overrides = {}) {
  let prevented = false;
  let stopped = false;
  return {
    event: {
      key: "~",
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: true,
      isComposing: false,
      keyCode: 0,
      repeat: false,
      target: null,
      preventDefault() {
        prevented = true;
      },
      stopPropagation() {
        stopped = true;
      },
      ...overrides,
    },
    get prevented() {
      return prevented;
    },
    get stopped() {
      return stopped;
    },
  };
}

test("LG16: ~ flips Links to Linked from in place, keeping the filter", () => {
  const { picker } = makeFlipPicker("to", "foot");
  picker.showRelationStage("to");
  assert.equal(picker.relationStageDirection, "to");
  const flipped = picker.flipRelationStageDirection();
  assert.equal(flipped, true);
  assert.equal(picker.relationStageDirection, "from");
  assert.match(picker.title, /Linked from/);
  assert.equal(picker.inputEl.value, "foot");
  const texts = picker.items.map((item) => item.searchText || "");
  assert.ok(texts.length > 0);
  assert.ok(texts.every((text) => text.toLowerCase().includes("foot")));
  assert.equal(picker.markedLines.size, 0);
  assert.equal(picker.selectedIndex, 0);
});

test("LG16: mid-query caret survives the flip and a second ~ flips back", () => {
  const { picker } = makeFlipPicker("to", "foot", { caret: 2 });
  picker.showRelationStage("to");
  picker.flipRelationStageDirection();
  assert.equal(picker.relationStageDirection, "from");
  assert.equal(picker.inputEl.value, "foot");
  assert.equal(picker.inputEl.selectionStart, 2);
  assert.equal(picker.inputEl.selectionEnd, 2);
  picker.flipRelationStageDirection();
  assert.equal(picker.relationStageDirection, "to");
  assert.equal(picker.inputEl.value, "foot");
});

test("LG16: a ~ keydown flips through handleKeydown and never types", () => {
  const { picker } = makeFlipPicker("to", "foot");
  picker.showRelationStage("to");
  const box = tildeKeyEvent();
  box.event.target = picker.inputEl;
  picker.handleKeydown(box.event);
  assert.equal(box.prevented, true);
  assert.equal(picker.relationStageDirection, "from");
  assert.equal(picker.inputEl.value, "foot");
});

test("LG16: counted sessions refuse the flip to Linked from", () => {
  notices.length = 0;
  const { picker } = makeFlipPicker("to", "foot", {
    taskSession: {
      explicit: true,
      targets: [{ line: 0 }, { line: 1 }],
    },
    marks: ["Current.md\x000"],
  });
  picker.showRelationStage("to");
  picker.markedLines = new Set(["Current.md\x000"]);
  const before = picker.inputEl.value;
  const flipped = picker.flipRelationStageDirection();
  assert.equal(flipped, false);
  assert.equal(picker.relationStageDirection, "to");
  assert.equal(picker.inputEl.value, before);
  assert.equal(picker.markedLines.size, 1);
  assert.ok(notices.some((message) => /Linked from needs a single task/.test(message)));
});

test("LG16: modified, composing, repeat, and busy ~ keydowns do not flip", () => {
  for (const modifiers of [
    { ctrlKey: true },
    { metaKey: true },
    { altKey: true },
  ]) {
    const { picker } = makeFlipPicker("to", "foot");
    picker.showRelationStage("to");
    const { event } = tildeKeyEvent(modifiers);
    picker.handleKeydown(event);
    assert.equal(picker.relationStageDirection, "to");
    assert.equal(picker.inputEl.value, "foot");
  }
  for (const inert of [{ isComposing: true }, { keyCode: 229 }]) {
    const { picker } = makeFlipPicker("to", "foot");
    picker.showRelationStage("to");
    const box = tildeKeyEvent(inert);
    picker.handleKeydown(box.event);
    assert.equal(picker.relationStageDirection, "to");
    assert.equal(box.prevented, false);
  }
  {
    const { picker } = makeFlipPicker("to", "foot");
    picker.showRelationStage("to");
    const box = tildeKeyEvent({ repeat: true });
    picker.handleKeydown(box.event);
    assert.equal(box.prevented, true);
    assert.equal(picker.relationStageDirection, "to");
    assert.equal(picker.inputEl.value, "foot");
  }
  {
    const { picker } = makeFlipPicker("to", "foot");
    picker.showRelationStage("to");
    picker.opening = true;
    const box = tildeKeyEvent();
    picker.handleKeydown(box.event);
    assert.equal(picker.relationStageDirection, "to");
  }
});

test("LG16: ~ in the relation-label stage is not intercepted", () => {
  const { picker } = makeFlipPicker("to", "foot");
  picker.showRelationStage("to");
  picker.stage = "relation-label";
  picker.handleRelationLabelKeydown = () => false;
  const box = tildeKeyEvent();
  picker.handleKeydown(box.event);
  assert.equal(box.prevented, false);
  assert.equal(picker.relationStageDirection, "to");
});

test("LG16: a stale refresh for the old direction never replaces the new stage", () => {
  const { picker } = makeFlipPicker("to", "");
  picker.showRelationStage("to");
  const seed = picker.relationStageSeed;
  picker.flipRelationStageDirection();
  assert.notEqual(picker.relationStageSeed, seed);
  const stale = { ...picker.vaultStage, refreshOf: seed };
  picker.applyVaultStageItems(stale);
  assert.notEqual(picker.vaultStage, stale);
  assert.equal(picker.relationStageDirection, "from");
});

test("LG16: footer offers ~ flip direction in single sessions only", () => {
  const single = makeFlipPicker("to", "").picker;
  single.showRelationStage("to");
  assert.ok(
    single
      .getRelationStageFooterHints()
      .some((hint) => hint.keys.includes("~") && /flip direction/.test(hint.label)),
  );
  const counted = makeFlipPicker("to", "", {
    taskSession: { explicit: true, targets: [{ line: 0 }] },
  }).picker;
  counted.showRelationStage("to");
  assert.ok(
    !counted
      .getRelationStageFooterHints()
      .some((hint) => hint.keys.includes("~")),
  );
});
