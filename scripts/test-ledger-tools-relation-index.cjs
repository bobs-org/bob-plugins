const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");
const vectors = require("./relation-line-vectors.cjs");
const relationLabelVectors = require("../plugins/bob-ledger-tools/scripts/fixtures/relation_labels/vectors.json");

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

function makeOnloadApp(files, tasks = []) {
  const vaultEvents = new Events();
  const metadataEvents = new Events();
  const workspaceEvents = new Events();
  const byPath = new Map(files.map((file) => [file.path, file]));
  const aliases = new Map();
  const reads = [];
  let layoutReadyCallback = null;
  const app = {
    workspace: {
      on: workspaceEvents.on.bind(workspaceEvents),
      offref: () => {},
      onLayoutReady: (callback) => {
        layoutReadyCallback = callback;
      },
      getActiveViewOfType: () => app.activeView || null,
      getActiveFile: () => null,
    },
    metadataCache: {
      on: metadataEvents.on.bind(metadataEvents),
      getFileCache: (file) => (typeof file === "string" ? byPath.get(file) : file)?.cache || null,
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
      cachedRead: async (file) => {
        reads.push(file && file.path);
        return file.content;
      },
      read: async (file) => {
        reads.push(file && file.path);
        return file.content;
      },
    },
    plugins: { plugins: { "obsidian-tasks-plugin": { getTasks: () => tasks } } },
    _events: { vaultEvents, metadataEvents, workspaceEvents },
    _files: byPath,
    _aliases: aliases,
    _reads: reads,
    _getLayoutReadyCallback: () => layoutReadyCallback,
  };
  return app;
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
  assert.equal(api.version, 2);
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

test("relationIndex registers after layout-ready and never reads non-markdown during startup replay", async () => {
  const source = makeFile("notes/source.md", "- [ ] #task Source ^source\n  - 🪢 **LINKS:** [[notes/target#^target]]", { links: [{ link: "notes/target#^target" }], blocks: { source: {} } });
  const target = makeFile("notes/target.md", "- [ ] #task Target ^target", { blocks: { target: {} } });
  const plain = makeFile("notes/plain.md", "- [ ] #task Plain ^plain", { blocks: { plain: {} } });
  const pdf = makeFile("lit_review/huge.pdf", "%PDF-binary", {});
  const png = makeFile("img.png", "png-binary", {});
  const mp3 = makeFile("audio.mp3", "mp3-binary", {});
  const files = [source, target, plain, pdf, png, mp3];
  const app = makeOnloadApp(files);
  app._aliases.set("notes/target", "notes/target.md");
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.onload();
  const layoutReady = app._getLayoutReadyCallback();
  assert.equal(typeof layoutReady, "function", "onload must defer relation setup to onLayoutReady");
  for (const file of files) {
    app._events.vaultEvents.emit("create", file);
  }
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(app._reads.length, 0, "no vault reads before layout-ready");
  assert.equal(plugin.relationIndexFiles.size, 0, "no files indexed before layout-ready");
  layoutReady();
  const api = plugin.relationIndexApi();
  await waitUntil(() => api.ready(), "relation scan should finish after layout-ready");
  for (const readPath of app._reads) {
    assert.match(readPath, /\.md$/i, `only markdown files are read, got ${readPath}`);
  }
  assert.equal(app._reads.includes("lit_review/huge.pdf"), false);
  assert.equal(app._reads.includes("img.png"), false);
  assert.equal(app._reads.includes("audio.mp3"), false);
  for (const key of plugin.relationIndexFiles.keys()) {
    assert.match(key, /\.md$/i, `only markdown files are stored, got ${key}`);
  }
  assert.equal(api.outgoing("notes/source.md", "source").length, 1);
  assert.equal(api.incoming("notes/target.md", "target").length, 1);
  plugin.onunload();
});

test("relationIndex ignores non-markdown live events", async () => {
  const source = makeFile("notes/source.md", "- [ ] #task Source ^source\n  - 🪢 **LINKS:** [[notes/target#^target]]", { links: [{ link: "notes/target#^target" }], blocks: { source: {} } });
  const target = makeFile("notes/target.md", "- [ ] #task Target ^target", { blocks: { target: {} } });
  const app = makeApp([source, target]);
  app._aliases.set("notes/target", "notes/target.md");
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.initializeRelationIndex();
  plugin.setupRelationIndex();
  plugin.startRelationIndexScan();
  const api = plugin.relationIndexApi();
  await waitUntil(() => api.ready(), "initial relation scan should finish");
  const reads = [];
  const originalCachedRead = app.vault.cachedRead;
  app.vault.cachedRead = async (file) => {
    reads.push(file && file.path);
    return originalCachedRead(file);
  };
  app.vault.read = async (file) => {
    reads.push(file && file.path);
    return file.content;
  };
  const pdf = makeFile("lit_review/huge.pdf", "%PDF-binary", {});
  app._files.set(pdf.path, pdf);
  app._events.vaultEvents.emit("create", pdf);
  app._events.vaultEvents.emit("modify", pdf);
  app._events.metadataEvents.emit("changed", pdf, "%PDF-binary");
  plugin.relationIndexScheduleTargetRead(pdf);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(reads.length, 0, "non-markdown create/modify/changed/target reads cause no vault read");
  assert.equal(plugin.relationIndexFiles.has("lit_review/huge.pdf"), false);
  const fresh = makeFile("notes/fresh.md", "- [ ] #task Fresh ^fresh\n  - 🪢 **LINKS:** [[notes/target#^target]]", { links: [{ link: "notes/target#^target" }], blocks: { fresh: {} } });
  app._files.set(fresh.path, fresh);
  app._events.vaultEvents.emit("create", fresh);
  await waitUntil(() => api.outgoing("notes/fresh.md", "fresh").length === 1, "new markdown create should be read and indexed");
  assert.equal(reads.includes("notes/fresh.md"), true);
  plugin.teardownRelationIndex();
});

test("relationIndex layout-ready after unload registers nothing", async () => {
  const source = makeFile("notes/source.md", "- [ ] #task Source ^source\n  - 🪢 **LINKS:** [[notes/target#^target]]", { links: [{ link: "notes/target#^target" }], blocks: { source: {} } });
  const target = makeFile("notes/target.md", "- [ ] #task Target ^target", { blocks: { target: {} } });
  const app = makeOnloadApp([source, target]);
  app._aliases.set("notes/target", "notes/target.md");
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.onload();
  const layoutReady = app._getLayoutReadyCallback();
  assert.equal(typeof layoutReady, "function");
  plugin.onunload();
  layoutReady();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(plugin.relationIndexListeners.size, 0, "no relation listeners after unload");
  assert.equal(plugin.relationIndexFiles.size, 0, "no scan started after unload");
  assert.equal(plugin.relationIndexApi().ready(), false);
  assert.equal(app._reads.length, 0, "no vault reads after unload");
});

test("parseTaskRelationFile indexes every checkbox status as a task", () => {
  const parsed = helpers.parseTaskRelationFile(
    [
      "- [ ] #task Todo source ^todo",
      "  - 🪢 **LINKS:** [[#^target]]",
      "- [*] #task Next source ^next",
      "  - 🪢 **LINKS:** [[#^target]]",
      "- [/] #task Progress source ^progress",
      "  - 🪢 **LINKS:** [[#^target]]",
      "- [?] #task Blocked source ^blocked",
      "  - 🪢 **LINKS:** [[#^target]]",
      "- [x] #task Done source ^done",
      "  - 🪢 **LINKS:** [[#^target]]",
      "- [-] #task Cancelled source ^cancelled",
      "  - 🪢 **LINKS:** [[#^target]]",
      "- [>] #task Scheduled source ^sched",
      "  - 🪢 **LINKS:** [[#^target]]",
      "- #task text [x] ^stray",
      "  - 🪢 **LINKS:** [[#^ignored-stray]]",
      "- [ ] untagged ^plain",
      "  - 🪢 **LINKS:** [[#^ignored-plain]]",
    ].join("\n"),
    "notes/source.md",
  );
  const expected = [
    ["todo", "TODO"],
    ["next", "NEXT"],
    ["progress", "IN_PROGRESS"],
    ["blocked", "BLOCKED"],
    ["done", "DONE"],
    ["cancelled", "CANCELLED"],
    ["sched", "TODO"],
  ];
  assert.equal(parsed.outgoing.length, expected.length);
  assert.deepEqual(
    parsed.outgoing.map((edge) => edge.source.blockId),
    expected.map(([id]) => id),
  );
  for (const [blockId, status] of expected) {
    const task = parsed.tasks.get(blockId);
    assert.ok(task, `${blockId} should be in tasks`);
    assert.equal(task.status, status, `${blockId} status`);
    assert.equal(task.blockId, blockId);
  }
  assert.equal(parsed.tasks.has("stray"), false);
  assert.equal(parsed.tasks.has("plain"), false);
  assert.equal(
    parsed.outgoing.some((edge) => edge.targetRef.blockId === "ignored-stray"),
    false,
  );
  assert.equal(
    parsed.outgoing.some((edge) => edge.targetRef.blockId === "ignored-plain"),
    false,
  );
});

test("relationIndex incoming and suggestions include Next and Blocked sources", async () => {
  const nextSource = makeFile(
    "notes/next.md",
    [
      "- [*] #task Next source ^next",
      "  - 🪢 **LINKS:** follow-up of [[notes/target#^target]]",
    ].join("\n"),
    { links: [{ link: "notes/target#^target" }], blocks: { next: {} } },
  );
  const blockedSource = makeFile(
    "notes/blocked.md",
    [
      "- [?] #task Blocked source ^blocked",
      "  - 🪢 **LINKS:** [[notes/target#^target]]",
    ].join("\n"),
    { links: [{ link: "notes/target#^target" }], blocks: { blocked: {} } },
  );
  const target = makeFile(
    "notes/target.md",
    "- [ ] #task Target ^target",
    { links: [{ link: "notes/next#^next" }], blocks: { target: {} } },
  );
  const questionTarget = makeFile(
    "notes/question.md",
    [
      "- [?] #task Question target ^question",
      "  - 🪢 **LINKS:** [[notes/other#^other]]",
    ].join("\n"),
    { links: [{ link: "notes/other#^other" }] },
  );
  const other = makeFile("notes/other.md", "- [ ] #task Other ^other", {
    blocks: { other: {} },
    links: [{ link: "notes/question#^question" }],
  });
  const questionSource = makeFile(
    "notes/from-question.md",
    [
      "- [ ] #task Points at question ^from-q",
      "  - 🪢 **LINKS:** [[notes/question#^question]]",
    ].join("\n"),
    { links: [{ link: "notes/question#^question" }], blocks: { "from-q": {} } },
  );
  const app = makeApp([
    nextSource,
    blockedSource,
    target,
    questionTarget,
    other,
    questionSource,
  ]);
  app._aliases.set("notes/target", "notes/target.md");
  app._aliases.set("notes/question", "notes/question.md");
  app._aliases.set("notes/other", "notes/other.md");
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.initializeRelationIndex();
  plugin.setupRelationIndex();
  plugin.startRelationIndexScan();
  const api = plugin.relationIndexApi();
  await waitUntil(() => api.ready(), "relation scan should finish");

  const incoming = api.incoming("notes/target.md", "target");
  assert.equal(incoming.length, 2);
  const incomingIds = incoming.map((edge) => edge.source.blockId).sort();
  assert.deepEqual(incomingIds, ["blocked", "next"]);
  assert.equal(api.outgoing("notes/next.md", "next").length, 1);
  assert.equal(api.outgoing("notes/blocked.md", "blocked").length, 1);
  assert.equal(api.outgoing("notes/next.md", "next")[0].target.blockId, "target");
  assert.equal(api.outgoing("notes/blocked.md", "blocked")[0].target.blockId, "target");

  const questionIncoming = api.incoming("notes/question.md", "question");
  assert.equal(questionIncoming.length, 1, "a [?] target with no cached block resolves from text");
  assert.equal(questionIncoming[0].source.blockId, "from-q");
  assert.equal(questionIncoming[0].target.resolved, true);

  assert.deepEqual(
    api.labelSuggestions().map((row) => [row.label, row.count]),
    [["follow-up of", 1]],
  );
  plugin.teardownRelationIndex();
});

test("relation-label JS mirrors match the shared bob-cli vectors", () => {
  for (const vector of relationLabelVectors.key) {
    assert.equal(helpers.relationLabelKey(vector.input), vector.expected, vector.name);
  }

  for (const vector of relationLabelVectors.catalog) {
    const edges = vector.notes.flatMap((note) =>
      helpers.parseTaskRelationFile(note.body, note.path).outgoing,
    );
    const rows = helpers.relationLabelCatalogRows(edges, {});
    assert.deepEqual(
      rows.map(({ key, name, count, spellings, inverse }) => ({ key, name, count, spellings, inverse })),
      vector.expected,
      vector.name,
    );
  }

  for (const vector of relationLabelVectors.fold) {
    const events = vector.events
      .map((entry) => helpers.relationLabelParseJournalLine(entry.body, entry.path, entry.line))
      .filter(Boolean);
    const prefs = helpers.relationLabelFoldEvents(events).byKey;
    assert.deepEqual(
      Object.keys(prefs).filter((key) => prefs[key].hidden).sort(),
      vector.expected_hidden,
      vector.name,
    );
    assert.deepEqual(
      Object.fromEntries(Object.entries(prefs).map(([key, pref]) => [key, pref.name])),
      vector.expected_names,
      vector.name,
    );
  }

  for (const vector of relationLabelVectors.rank) {
    const rows = vector.labels.map((row) => ({
      ...row,
      key: helpers.relationLabelKey(row.name),
    }));
    assert.deepEqual(
      helpers.relationLabelRankRows(rows, vector.query, vector.hidden).map((row) => row.name),
      vector.expected,
      vector.name,
    );
  }
});

test("api.relationLabels reads folded preferences and delegates desktop writes to bob", async () => {
  const plugin = new LedgerToolsPlugin(makeApp([]), {});
  plugin.initializeRelationIndex();
  plugin.relationIndexState = {
    generation: 1,
    ready: true,
    forward: new Map(),
    reverse: new Map(),
    edges: [
      { source: { path: "tasks/a.md" }, relationLine: 2, label: "see" },
      { source: { path: "tasks/b.md" }, relationLine: 2, label: "See" },
      { source: { path: "_templates/daily.md" }, relationLine: 2, label: "template" },
    ],
  };
  plugin.relationLabelsJournalFold = helpers.relationLabelFoldEvents([
    helpers.relationLabelParseJournalLine(
      '{"v":1,"ts":"2026-10-24T09:41:07-04:00","host":"mac","kind":"relation_label.hide","key":"see","name":"see"}',
      "mac.jsonl",
      1,
    ),
  ]);
  const api = plugin.relationLabelsApi();
  assert.equal(api.version, 1);
  assert.deepEqual(api.rows("", { hidden: "exclude" }), []);
  assert.deepEqual(api.rows("", { hidden: "only" }).map((row) => [row.key, row.name, row.count, row.hidden]), [
    ["see", "see", 2, true],
  ]);
  assert.equal(api.hiddenCount(), 1);
  assert.deepEqual(api.rows("", { hidden: "include" }).map((row) => row.key), ["see"]);

  const writes = [];
  const changes = [];
  plugin.relationLabelsWriteSpawn = async (args, via) => {
    writes.push({ args, via });
    return { ok: true };
  };
  plugin.refreshRelationLabelsJournal = async () => plugin.relationLabelsPrefs();
  api.onChange((_rows, reason) => changes.push(reason));
  assert.equal((await api.hide("new relation", { allowUnused: true, via: "test-client" })).ok, true);
  assert.deepEqual(writes, [{ args: ["relations", "hide", "new relation", "--allow-unused"], via: "test-client" }]);
  assert.deepEqual(changes, ["write"]);
  assert.equal((await api.rename("see", "reference to", { dryRun: true, merge: true, via: "test-client" })).ok, true);
  assert.deepEqual(writes[1], {
    args: ["relations", "rename", "see", "reference to", "--dry-run", "--merge"],
    via: "test-client",
  });
  assert.deepEqual(changes, ["write"], "a preview does not refresh or emit a write notification");
  assert.equal((await api.rename("see", "reference to", { via: "test-client" })).ok, true);
  assert.deepEqual(writes[2], {
    args: ["relations", "rename", "see", "reference to"],
    via: "test-client",
  });
  assert.deepEqual(changes, ["write", "write"], "a committed rename refreshes the journal mirror");
  plugin.teardownRelationIndex();
});

function wrapRelationIndexCounters(plugin) {
  let publishes = 0;
  let memoBuilds = 0;
  const originalPublish = plugin.publishRelationIndex;
  const originalMemo = plugin.relationIndexTaskMemo;
  plugin.publishRelationIndex = function wrappedPublish(...args) {
    publishes += 1;
    return originalPublish.apply(this, args);
  };
  plugin.relationIndexTaskMemo = function wrappedMemo(...args) {
    const missed = !this.relationIndexTaskMemoCache;
    const result = originalMemo.apply(this, args);
    if (missed) memoBuilds += 1;
    return result;
  };
  return {
    originalPublish,
    counts: () => ({ publishes, memoBuilds }),
    reset: () => {
      publishes = 0;
      memoBuilds = 0;
    },
  };
}

test("relationIndex coalesces a metadata storm to one publish and one task memo", async () => {
  const stormSize = 40;
  const files = [];
  const tasks = [];
  for (let index = 0; index < stormSize; index += 1) {
    const path = `notes/source-${index}.md`;
    const targetPath = `notes/target-${index}.md`;
    files.push(makeFile(
      path,
      `- [ ] #task Source ${index} ^source-${index}\n  - 🪢 **LINKS:** [[${targetPath}#^target-${index}]]`,
      { links: [{ link: `${targetPath}#^target-${index}` }], blocks: { [`source-${index}`]: {} } },
    ));
    files.push(makeFile(
      targetPath,
      `- [ ] #task Target ${index} ^target-${index}`,
      { blocks: { [`target-${index}`]: {} } },
    ));
    tasks.push({
      path,
      lineNumber: 0,
      status: { type: "TODO" },
      description: `Source ${index}`,
    });
  }
  const app = makeApp(files, tasks);
  for (let index = 0; index < stormSize; index += 1) {
    app._aliases.set(`notes/target-${index}`, `notes/target-${index}.md`);
  }
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.initializeRelationIndex();
  plugin.setupRelationIndex();
  plugin.startRelationIndexScan();
  const api = plugin.relationIndexApi();
  await waitUntil(() => api.ready(), "initial relation scan should finish");

  const counters = wrapRelationIndexCounters(plugin);
  const uncoalescedStart = performance.now();
  for (let index = 0; index < stormSize; index += 1) {
    const source = files[index * 2];
    plugin.relationIndexApplyFile(source.path, source.content);
    plugin.flushRelationIndexPublish();
  }
  const uncoalescedMs = performance.now() - uncoalescedStart;
  assert.equal(counters.counts().publishes, stormSize);
  assert.equal(counters.counts().memoBuilds, 1, "flushed publishes in one turn reuse the task memo");
  await Promise.resolve();
  counters.reset();

  const notifications = [];
  api.onChange((event) => notifications.push(event.generation));
  const coalescedStart = performance.now();
  for (let index = 0; index < stormSize; index += 1) {
    const source = files[index * 2];
    const changed = `- [ ] #task Source ${index} ^source-${index}\n  - 🪢 **LINKS:** storm-${index} [[notes/target-${index}.md#^target-${index}]]`;
    source.content = changed;
    app._events.metadataEvents.emit("changed", source, changed);
  }
  const eventStackMs = performance.now() - coalescedStart;
  assert.equal(counters.counts().publishes, 0, "the storm defers the rebuild off the event stack");
  assert.equal(notifications.length, 0, "onChange waits for the coalesced publish");
  await Promise.resolve();
  const coalescedMs = performance.now() - coalescedStart;
  assert.equal(counters.counts().publishes, 1, "one publish after the coalesced turn");
  assert.equal(counters.counts().memoBuilds, 1, "one task memo build for the coalesced turn");
  assert.equal(notifications.length, 1, "listeners see one atomic publication");
  assert.equal(
    api.outgoing(`notes/source-${stormSize - 1}.md`, `source-${stormSize - 1}`)[0].label,
    `storm-${stormSize - 1}`,
  );
  assert.equal(counters.counts().publishes, 1, "a v1 read after the turn does not publish again");
  console.log(JSON.stringify({
    relation_index_storm: {
      events: stormSize,
      uncoalesced_publish_ms: Number(uncoalescedMs.toFixed(2)),
      coalesced_event_stack_ms: Number(eventStackMs.toFixed(2)),
      coalesced_turn_ms: Number(coalescedMs.toFixed(2)),
      publishes: counters.counts().publishes,
      memo_builds: counters.counts().memoBuilds,
    },
  }));
  plugin.teardownRelationIndex();
});

test("relationIndex v1 reads flush a pending publish", async () => {
  const source = makeFile(
    "notes/source.md",
    "- [ ] #task Source ^source\n  - 🪢 **LINKS:** [[notes/target#^target]]",
    { links: [{ link: "notes/target#^target" }], blocks: { source: {} } },
  );
  const target = makeFile("notes/target.md", "- [ ] #task Target ^target", { blocks: { target: {} } });
  const app = makeApp([source, target]);
  app._aliases.set("notes/target", "notes/target.md");
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.initializeRelationIndex();
  plugin.setupRelationIndex();
  plugin.startRelationIndexScan();
  const api = plugin.relationIndexApi();
  await waitUntil(() => api.ready(), "initial relation scan should finish");

  const counters = wrapRelationIndexCounters(plugin);
  const before = api.generation;
  const changed = "- [ ] #task Source ^source\n  - 🪢 **LINKS:** fresh-label [[notes/target#^target]]";
  source.content = changed;
  app._events.metadataEvents.emit("changed", source, changed);
  assert.equal(counters.counts().publishes, 0, "the event itself does not publish");
  assert.equal(api.outgoing("notes/source.md", "source")[0].label, "fresh-label");
  assert.equal(api.generation, before + 1);
  assert.equal(counters.counts().publishes, 1, "the v1 read flushes the pending rebuild");
  await Promise.resolve();
  assert.equal(counters.counts().publishes, 1, "the later microtask does not publish a second time");
  plugin.teardownRelationIndex();
});


