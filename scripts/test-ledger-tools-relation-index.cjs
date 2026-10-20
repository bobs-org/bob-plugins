const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");
const vectors = require("./relation-line-vectors.cjs");

class TestMarkdownView {}
class TestPlugin {
  constructor(app) { this.app = app; }
  registerEvent(ref) { this.registeredEvents = this.registeredEvents || []; this.registeredEvents.push(ref); }
  registerEditorExtension(extension) { this.editorExtensions = this.editorExtensions || []; this.editorExtensions.push(extension); }
  addCommand() {}
  registerInterval(handle) { return handle; }
}
class TestNotice { constructor() {} }

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return { MarkdownView: TestMarkdownView, Notice: TestNotice, Platform: { isDesktopApp: true }, Plugin: TestPlugin, normalizePath: (value) => value, parseYaml: () => ({}) };
  }
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value } };
  if (request === "@codemirror/view") return { EditorView: { updateListener: { of: (listener) => ({ listener }) } }, keymap: { of: (value) => value } };
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers } = LedgerToolsPlugin;
Module._load = originalLoad;

class Events {
  constructor() { this.listeners = new Map(); }
  on(name, callback) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(callback);
    return { name, callback };
  }
  emit(name, ...args) { for (const callback of this.listeners.get(name) || []) callback(...args); }
}

function makeFile(path, content, cache = {}) {
  return { path, content, cache: { links: [], blocks: {}, ...cache } };
}

function makeApp(files, tasks = []) {
  const vaultEvents = new Events();
  const metadataEvents = new Events();
  const workspaceEvents = new Events();
  const byPath = new Map(files.map((file) => [file.path, file]));
  const aliases = new Map();
  const app = {
    workspace: {
      ...workspaceEvents,
      on: workspaceEvents.on.bind(workspaceEvents),
      getActiveViewOfType: () => app.activeView || null,
    },
    metadataCache: {
      on: metadataEvents.on.bind(metadataEvents),
      getFileCache: (file) => (typeof file === "string" ? byPath.get(file) : file) ?.cache || null,
      getCache: (path) => byPath.get(path)?.cache || null,
      getFirstLinkpathDest: (target, sourcePath) => {
        if (!target) return byPath.get(sourcePath) || null;
        const candidate = aliases.get(target) || (target.endsWith(".md") ? target : target + ".md");
        return byPath.get(candidate) || null;
      },
    },
    vault: {
      on: vaultEvents.on.bind(vaultEvents),
      getMarkdownFiles: () => Array.from(byPath.values()),
      getAbstractFileByPath: (path) => byPath.get(path) || null,
      cachedRead: async (file) => file.content,
    },
    plugins: { plugins: { "obsidian-tasks-plugin": { getTasks: () => tasks } } },
    _events: { vaultEvents, metadataEvents, workspaceEvents },
    _files: byPath,
    _aliases: aliases,
  };
  return app;
}

async function waitUntil(predicate, message) {
  const end = Date.now() + 1000;
  while (!predicate() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(predicate(), true, message);
}

test("ledger parser agrees with shared LK vectors and parses source task children", () => {
  for (const vector of vectors.managed) {
    const line = vectors.asLine(vector.line);
    const parsed = helpers.parseTaskRelationLine(line);
    assert.equal(parsed.verdict, "accept" === vector.verdict ? "accepted" : vector.verdict, `${vector.id}: ${line}`);
    if (vector.direction === "outgoing" && parsed.verdict === "accepted") assert.equal(parsed.kind, "links", line);
    if (vector.direction === "incoming" && parsed.verdict === "accepted") assert.equal(parsed.kind, "linkedFrom", line);
  }
  for (const vector of vectors.notRelation) {
    assert.equal(helpers.parseTaskRelationLine(vector.line).verdict, "not-a-line", vector.line);
  }
  const parsed = helpers.parseTaskRelationFile([
    "- [ ] #task Source ^source",
    "  - 🪢 **LINKS:** follow-up of [[done/target#^done-id]] • [[#^local]]",
    "  - [ ] #task No id",
    "    - 🪢 **LINKS:** [[missing#^missing]]",
    "    - ordinary nested list item",
    "      - 🪢 **LINKS:** [[#^nested-not-owned]]",
    "  ```md",
    "  - 🪢 **LINKS:** [[#^fenced]]",
    "  ```",
  ].join("\n"), "notes/source.md");
  assert.equal(parsed.outgoing.length, 3);
  assert.deepEqual(parsed.outgoing.map((edge) => edge.targetRef.blockId), ["done-id", "local", "missing"]);
  assert.equal(parsed.outgoing[0].label, "follow-up of");
  assert.equal(parsed.outgoing[2].source.blockId, "", "a source without an id still gets an outgoing index row");
});

test("relationIndex scans done sources, resolves both directions, and orders label suggestions", async () => {
  const source = makeFile("notes/source.md", [
    "- [ ] #task Source ^source",
    "  - 🪢 **LINKS:** Follow-up [[done/target#^target]] • follow-UP [[notes/other#^other]]",
  ].join("\n"), { links: [{ link: "done/target#^target" }, { link: "notes/other#^other" }], blocks: { source: {}, target: {} } });
  const doneSource = makeFile("done/archived.md", [
    "- [x] #task Archived source ^archived",
    "  - 🪢 **LINKS:** see [[notes/source#^source]]",
  ].join("\n"), { links: [{ link: "notes/source#^source" }], blocks: { archived: {} } });
  const target = makeFile("done/target.md", "- [x] #task Target ^target", { blocks: { target: {} } });
  const other = makeFile("notes/other.md", "- [ ] #task Other ^other", { blocks: { other: {} } });
  const prefiltered = makeFile("notes/prefiltered.md", "- [ ] #task Skipped ^skipped\n  - 🪢 **LINKS:** [[notes/source#^source]]");
  const idless = makeFile("notes/idless.md", "- [ ] #task No id\n  - 🪢 **LINKS:** [[missing#^missing]]", { links: [{ link: "missing#^missing" }] });
  const tasks = [{ path: "done/target.md", lineNumber: 0, status: { type: "DONE" }, description: "Task memo target" }];
  const app = makeApp([source, doneSource, target, other, prefiltered, idless], tasks);
  app._aliases.set("done/target", "done/target.md");
  app._aliases.set("notes/other", "notes/other.md");
  app._aliases.set("notes/source", "notes/source.md");
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.initializeRelationIndex();
  plugin.setupRelationIndex();
  plugin.startRelationIndexScan();
  const api = plugin.relationIndexApi();
  await waitUntil(() => api.ready(), "initial relation scan should finish");
  assert.equal(api.version, 1);
  assert.equal(api.outgoing("notes/source.md", "source").length, 2);
  assert.equal(api.outgoing("done/archived.md", "archived").length, 1, "done/ is indexed as a read-only source");
  assert.equal(api.outgoing("notes/prefiltered.md", "skipped").length, 0, "startup prefilter skips notes with no cached block links");
  assert.equal(api.outgoing("notes/source.md", "- [ ] #task Source ^source").length, 2, "outgoing accepts a task line as its second argument");
  assert.equal(api.outgoing("notes/idless.md", "- [ ] #task No id").length, 1, "idless source tasks can be queried by line text");
  assert.equal(api.outgoing("notes/idless.md", 1).length, 1, "outgoing accepts a 1-based task line number");
  const incoming = api.incoming("done/target.md", "target");
  assert.equal(incoming.length, 1);
  assert.equal(incoming[0].source.path, "notes/source.md");
  assert.equal(incoming[0].target.text, "Task memo target");
  assert.equal(incoming[0].target.status, "DONE");
  assert.deepEqual(api.labelSuggestions().map((row) => [row.label, row.count]), [["Follow-up", 2], ["see", 1]]);
  assert.deepEqual(api.labelSuggestions("foll").map((row) => row.count), [2]);
  assert.equal(api.generation > 0, true);
});

test("relationIndex applies changed, delete, rename, and unsaved editor overlays", async () => {
  const source = makeFile("notes/source.md", "- [ ] #task Source ^source\n  - 🪢 **LINKS:** [[notes/target#^target]]", { links: [{ link: "notes/target#^target" }], blocks: { source: {} } });
  const target = makeFile("notes/target.md", "- [ ] #task Target ^target", { blocks: { target: {} } });
  const app = makeApp([source, target]);
  app._aliases.set("notes/target", "notes/target.md");
  app._aliases.set("notes/new-target", "notes/new-target.md");
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.initializeRelationIndex();
  plugin.setupRelationIndex();
  plugin.startRelationIndexScan();
  const api = plugin.relationIndexApi();
  await waitUntil(() => api.ready(), "initial relation scan should finish");
  assert.equal(api.incoming("notes/target.md", "target").length, 1);

  const changed = "- [ ] #task Source ^source\n  - 🪢 **LINKS:** [[notes/new-target#^new]]";
  source.content = changed;
  source.cache.links = [{ link: "notes/new-target#^new" }];
  app._events.metadataEvents.emit("changed", source, changed);
  assert.equal(api.outgoing("notes/source.md", "source")[0].target.blockId, "new");

  const newTarget = makeFile("notes/new-target.md", "- [ ] #task New target ^new", { blocks: { new: {} } });
  app._files.set(newTarget.path, newTarget);
  app._events.vaultEvents.emit("create", newTarget);
  await waitUntil(() => api.incoming("notes/new-target.md", "new").length === 1, "changed edge should resolve after the target appears");

  const view = new TestMarkdownView();
  view.file = source;
  view.editor = { getValue: () => "- [ ] #task Source ^source\n  - 🪢 **LINKS:** label [[notes/target#^target]]" };
  app.activeView = view;
  assert.equal(plugin.refreshRelationIndexOverlay(), true);
  assert.equal(api.incoming("notes/target.md", "target").length, 1, "unsaved editor text replaces the stored outgoing row");
  assert.equal(api.outgoing("notes/source.md", "source")[0].label, "label");

  app._events.vaultEvents.emit("delete", newTarget);
  assert.equal(api.incoming("notes/new-target.md", "new").length, 0);
  const renamed = makeFile("notes/renamed.md", "- [ ] #task New target ^new", { blocks: { new: {} } });
  app._files.delete("notes/new-target.md");
  app._files.set("notes/renamed.md", renamed);
  app._aliases.set("notes/new-target", "notes/renamed.md");
  app._events.vaultEvents.emit("rename", renamed, "notes/new-target.md");
  await waitUntil(() => plugin.relationIndexFiles.has("notes/renamed.md"), "renamed target should be re-read");
  assert.equal(api.incoming("notes/renamed.md", "new").length, 0, "active unsaved source overlay remains authoritative");

  const renamedSource = makeFile("notes/source-renamed.md", source.content, source.cache);
  app._files.delete("notes/source.md");
  app._files.set(renamedSource.path, renamedSource);
  app._events.vaultEvents.emit("rename", renamedSource, "notes/source.md");
  await waitUntil(() => api.outgoing("notes/source-renamed.md", "source").length === 1, "renamed source should be re-read");
  assert.equal(api.incoming("notes/renamed.md", "new")[0].source.path, "notes/source-renamed.md");
  plugin.teardownRelationIndex();
});
