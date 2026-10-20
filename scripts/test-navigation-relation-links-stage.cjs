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
      "Source.md": "- [ ] #task Source ^source",
      "Target.md": "- [ ] #task Target ^target",
    };
    const harness = makePlugin(notes);
    const sourceEditor = new TestEditor(notes["Source.md"]);
    const targetEditor = new TestEditor(notes["Target.md"]);
    harness.openEditors.set("Source.md", sourceEditor);
    harness.openEditors.set("Target.md", targetEditor);
    const picker = makeRelationPicker(harness.plugin, "from", [
      { path: "Source.md", line: 0, blockId: "source", displayText: "Source" },
    ], notes);
    const target = { path: "Target.md", line: 0, blockId: "target", displayText: "Target" };
    beginRelationLabel(picker, [target], "son of");
    assert.equal(await picker.commitRelationLabel(picker.getRelationLabelPreviewItems()[0]), true);
    assert.match(sourceEditor.getValue(), /son of \[\[Target#\^target\]\]/);
    assert.match(targetEditor.getValue(), /LINKED FROM:\*\* \[\[Source#\^source\]\] \(son of\)/);
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
