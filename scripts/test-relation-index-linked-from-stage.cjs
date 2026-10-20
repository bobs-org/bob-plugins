// Seam: the live ledger relation index feeds nav's Linked-from CURRENT
// list (`docs/task-relations.md`). Sources of every checkbox status must
// appear, including Next `[*]` and Blocked `[?]`.
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

class TestMarkdownView {}
class TestPlugin {
  constructor(app) {
    this.app = app;
  }
  registerEvent(ref) {
    this.registeredEvents = this.registeredEvents || [];
    this.registeredEvents.push(ref);
  }
  registerEditorExtension(extension) {
    this.editorExtensions = this.editorExtensions || [];
    this.editorExtensions.push(extension);
  }
  addCommand() {}
  registerInterval(handle) {
    return handle;
  }
}
class TestModal {
  constructor(app) {
    this.app = app;
    this.contentEl = { empty: () => {} };
    this.modalEl = { removeClass: () => {} };
  }
}
class TestNotice {
  constructor(message) {
    TestNotice.messages.push(String(message));
  }
}
TestNotice.messages = [];

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: TestMarkdownView,
      Modal: TestModal,
      Notice: TestNotice,
      Platform: { isDesktopApp: true },
      Plugin: TestPlugin,
      normalizePath: (value) => value,
      parseYaml: parseTestYaml,
    };
  }
  if (request === "@codemirror/state") {
    return { Prec: { highest: (value) => value } };
  }
  if (request === "@codemirror/view") {
    return {
      EditorView: { updateListener: { of: (listener) => ({ listener }) } },
      keymap: { of: (value) => value },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const NavigationHotkeysPlugin = require("../plugins/bob-navigation-hotkeys/main.js");
const { helpers } = NavigationHotkeysPlugin;
Module._load = originalLoad;

class Events {
  constructor() {
    this.listeners = new Map();
  }
  on(name, callback) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(callback);
    return { name, callback };
  }
  emit(name, ...args) {
    for (const callback of this.listeners.get(name) || []) callback(...args);
  }
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

async function waitUntil(predicate, message) {
  const end = Date.now() + 1000;
  while (!predicate() && Date.now() < end) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(predicate(), true, message);
}

function makeFile(path, content, cache = {}) {
  return { path, content, cache: { links: [], blocks: {}, ...cache } };
}

function makeRelationPicker(plugin, direction, sources, stage) {
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
  picker.vaultStage = stage;
  picker.markedLines = new Set();
  picker.taskItemsByLine = new Map();
  picker.clearPendingBatch = () => {};
  picker.refuseDependencyStale = () => false;
  return picker;
}

const TASKS_MD = [
  "- [ ] #task Owner ^owner",
  "  - 🪢 **LINKED FROM:** [[#^next]] (follow-up of) • [[#^blocked]] • [[#^progress]] • [[#^done]] • [[#^cancelled]] • [[Other#^cross]]",
  "- [*] #task Next source ^next",
  "  - 🪢 **LINKS:** follow-up of [[#^owner]]",
  "- [?] #task Blocked source ^blocked",
  "  - 🪢 **LINKS:** [[#^owner]]",
  "- [/] #task Progress source ^progress",
  "  - 🪢 **LINKS:** [[#^owner]]",
  "- [x] #task Done source ^done",
  "  - 🪢 **LINKS:** [[#^owner]]",
  "- [-] #task Cancelled source ^cancelled",
  "  - 🪢 **LINKS:** [[#^owner]]",
].join("\n");

const OTHER_MD = [
  "- [*] #task Cross source ^cross",
  "  - 🪢 **LINKS:** [[Tasks#^owner]]",
].join("\n");

test("Linked-from CURRENT lists every checkbox status from the live index", async () => {
  const tasksFile = makeFile("Tasks.md", TASKS_MD, {
    links: [
      { link: "#^owner" },
      { link: "#^next" },
      { link: "#^blocked" },
      { link: "#^progress" },
      { link: "#^done" },
      { link: "#^cancelled" },
      { link: "Other#^cross" },
    ],
    blocks: {
      owner: {},
      next: {},
      blocked: {},
      progress: {},
      done: {},
      cancelled: {},
    },
  });
  const otherFile = makeFile("Other.md", OTHER_MD, {
    links: [{ link: "Tasks#^owner" }],
    blocks: { cross: {} },
  });
  const byPath = new Map([
    [tasksFile.path, tasksFile],
    [otherFile.path, otherFile],
  ]);
  const vaultEvents = new Events();
  const metadataEvents = new Events();
  const workspaceEvents = new Events();
  const ownerEditor = new TestEditor(TASKS_MD);
  const app = {
    workspace: {
      ...workspaceEvents,
      on: workspaceEvents.on.bind(workspaceEvents),
      getActiveViewOfType: () => app.activeView || null,
      getActiveFile: () => tasksFile,
      getLeavesOfType: (type) =>
        type === "markdown"
          ? [{ view: { file: { path: "Tasks.md" }, editor: ownerEditor } }]
          : [],
    },
    metadataCache: {
      on: metadataEvents.on.bind(metadataEvents),
      getFileCache: (file) =>
        (typeof file === "string" ? byPath.get(file) : file)?.cache || null,
      getCache: (path) => byPath.get(path)?.cache || null,
      getFirstLinkpathDest: (target, sourcePath) => {
        if (!target) return byPath.get(sourcePath) || null;
        const candidate = target.endsWith(".md") ? target : `${target}.md`;
        return byPath.get(candidate) || null;
      },
    },
    vault: {
      on: vaultEvents.on.bind(vaultEvents),
      getMarkdownFiles: () => Array.from(byPath.values()),
      getAbstractFileByPath: (path) => byPath.get(path) || null,
      cachedRead: async (file) => file.content,
      read: async (file) => file.content,
      process: async (file, transform) => {
        file.content = String(transform(String(file.content || "")));
        byPath.set(file.path, file);
      },
    },
    plugins: { plugins: { "obsidian-tasks-plugin": { getTasks: () => [] } } },
  };

  const ledger = new LedgerToolsPlugin(app, {});
  ledger.initializeRelationIndex();
  ledger.startRelationIndexScan();
  const relationIndex = ledger.relationIndexApi();
  await waitUntil(() => relationIndex.ready(), "relation index should finish scanning");

  const plugin = new NavigationHotkeysPlugin();
  plugin.app = app;
  app.plugins.plugins["bob-ledger-tools"] = { api: { relationIndex } };
  app.plugins.plugins["bob-navigation-hotkeys"] = plugin;

  const stage = plugin.buildVaultRelationStage({
    filePath: "Tasks.md",
    content: TASKS_MD,
    parentLines: [0],
    direction: "from",
  });
  const items = helpers.planRelationStageItemsFromVault(stage, "");
  const current = items.filter((item) => item.stageSection === "current");
  const results = items.filter((item) => item.stageSection === "results");
  const currentIds = current.map((row) => row.blockId).sort();
  assert.deepEqual(currentIds, [
    "blocked",
    "cancelled",
    "cross",
    "done",
    "next",
    "progress",
  ]);
  assert.equal(current.length, 6);
  const nextRow = current.find((row) => row.blockId === "next");
  assert.equal(nextRow.label, "followed up by");
  const resultIds = new Set(results.map((row) => row.blockId));
  for (const id of currentIds) {
    assert.equal(resultIds.has(id), false, `${id} must not also appear in RESULTS`);
  }

  const crossRow = current.find((row) => row.blockId === "cross");
  assert.equal(crossRow.displayText, "Cross source");
  assert.equal(crossRow.text, "Cross source");
  assert.equal(crossRow.status, "*");
  assert.equal(crossRow.open, true);
  assert.equal(crossRow.closed, false);
  assert.equal(crossRow.line, 0);

  const picker = makeRelationPicker(
    plugin,
    "from",
    [{ path: "Tasks.md", line: 0, blockId: "owner" }],
    stage,
  );
  assert.equal(await picker.chooseRelationTask(nextRow), true);
  const after = ownerEditor.getValue();
  const expected = [
    "- [ ] #task Owner ^owner",
    "  - 🪢 **LINKED FROM:** [[#^blocked]] • [[#^cancelled]] • [[#^done]] • [[#^progress]] • [[Other#^cross]]",
    "- [*] #task Next source ^next",
    "- [?] #task Blocked source ^blocked",
    "  - 🪢 **LINKS:** [[#^owner]]",
    "- [/] #task Progress source ^progress",
    "  - 🪢 **LINKS:** [[#^owner]]",
    "- [x] #task Done source ^done",
    "  - 🪢 **LINKS:** [[#^owner]]",
    "- [-] #task Cancelled source ^cancelled",
    "  - 🪢 **LINKS:** [[#^owner]]",
  ].join("\n");
  assert.equal(after, expected);
  assert.equal(otherFile.content, OTHER_MD);
});
