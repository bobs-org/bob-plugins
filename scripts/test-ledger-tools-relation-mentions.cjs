const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");

const taskMentionVectors = require("../plugins/bob-ledger-tools/scripts/fixtures/task_mentions/vectors.json");

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
    return {
      MarkdownView: TestMarkdownView,
      Notice: TestNotice,
      Platform: { isDesktopApp: true },
      Plugin: TestPlugin,
      normalizePath: (value) => value,
      // The mention switch config in these tests is JSON; the YAML shape is
      // covered by bob-cli's own config tests.
      parseYaml: (text) => JSON.parse(String(text || "{}")),
    };
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

function makeFile(filePath, content, cache = {}) {
  return { path: filePath, content, cache: { links: [], blocks: {}, ...cache } };
}

function metadataFor(content) {
  const links = [];
  for (const match of String(content).matchAll(/\[\[([^\]]+)\]\]/gu)) {
    const target = match[1].split("|")[0];
    if (/#\^[A-Za-z0-9-]+/u.test(target)) links.push({ link: target });
  }
  const blocks = {};
  for (const match of String(content).matchAll(/(?:^|\s)\^([A-Za-z0-9-]+)(?=\s|$)/gmu)) blocks[match[1]] = { id: match[1] };
  return { links, blocks };
}

function makeApp(files, tasks = []) {
  const vaultEvents = new Events();
  const metadataEvents = new Events();
  const workspaceEvents = new Events();
  const byPath = new Map(files.map((file) => [file.path, file]));
  const aliases = new Map();
  for (const file of files) {
    const noExtension = file.path.replace(/\.md$/iu, "");
    if (!aliases.has(noExtension)) aliases.set(noExtension, file.path);
    const basename = noExtension.split("/").pop();
    if (!aliases.has(basename)) aliases.set(basename, file.path);
  }
  const app = {
    workspace: {
      ...workspaceEvents,
      on: workspaceEvents.on.bind(workspaceEvents),
      getActiveViewOfType: () => app.activeView || null,
    },
    metadataCache: {
      on: metadataEvents.on.bind(metadataEvents),
      getFileCache: (file) => (typeof file === "string" ? byPath.get(file) : file)?.cache || null,
      getCache: (filePath) => byPath.get(filePath)?.cache || null,
      getFirstLinkpathDest: (target, sourcePath) => {
        if (!target) return byPath.get(sourcePath) || null;
        const candidate = aliases.get(target) || (target.endsWith(".md") ? target : target + ".md");
        return byPath.get(candidate) || null;
      },
    },
    vault: {
      on: vaultEvents.on.bind(vaultEvents),
      getMarkdownFiles: () => Array.from(byPath.values()),
      getAbstractFileByPath: (filePath) => byPath.get(filePath) || null,
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
  const end = Date.now() + 2000;
  while (!predicate() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(predicate(), true, message);
}

// Temporary XDG config home enabling `relations.linked_from_mentions`.
// Returns a cleanup function; the caller must reset the loader cache.
function enableMentionsSwitch() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bob-mention-switch-"));
  fs.mkdirSync(path.join(tmp, "bob"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "bob", "config.yml"), JSON.stringify({ relations: { linked_from_mentions: true } }));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = tmp;
  helpers.resetRelationIndexMentionsConfigCache();
  return () => {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    helpers.resetRelationIndexMentionsConfigCache();
    fs.rmSync(tmp, { recursive: true, force: true });
  };
}

function disableMentionsSwitch() {
  const previous = process.env.XDG_CONFIG_HOME;
  delete process.env.XDG_CONFIG_HOME;
  helpers.resetRelationIndexMentionsConfigCache();
  return () => {
    if (previous !== undefined) process.env.XDG_CONFIG_HOME = previous;
    helpers.resetRelationIndexMentionsConfigCache();
  };
}

// Resolver mirroring the test app's getFirstLinkpathDest over a notes dict.
function notesResolver(notes) {
  const paths = Object.keys(notes);
  const aliases = new Map();
  for (const filePath of paths) {
    const noExtension = filePath.replace(/\.md$/iu, "");
    if (!aliases.has(noExtension)) aliases.set(noExtension, filePath);
    const basename = noExtension.split("/").pop();
    if (!aliases.has(basename)) aliases.set(basename, filePath);
  }
  return (target, sourcePath) => {
    if (!target) return sourcePath;
    const candidate = aliases.get(target) || (target.endsWith(".md") ? target : target + ".md");
    if (candidate && notes[candidate] !== undefined) return candidate;
    if (notes[target] !== undefined) return target;
    return null;
  };
}

function pairKey(source, target) {
  return `${source}\u0000${target}`;
}

test("task_mentions fixture copies byte-for-byte and carries version 1", () => {
  const cliPath = path.join(__dirname, "..", "..", "..", "..", "..", "tests", "fixtures", "task_mentions", "vectors.json");
  let cliRaw = null;
  try {
    cliRaw = fs.readFileSync(cliPath, "utf8");
  } catch (error) {
    cliRaw = null;
  }
  const pluginPath = path.join(__dirname, "..", "plugins", "bob-ledger-tools", "scripts", "fixtures", "task_mentions", "vectors.json");
  const pluginRaw = fs.readFileSync(pluginPath, "utf8");
  if (cliRaw !== null) assert.equal(pluginRaw, cliRaw, "plugin fixture must copy bob-cli vectors byte-for-byte");
  const parsed = JSON.parse(pluginRaw);
  assert.equal(parsed.version, 1);
  assert.ok(Array.isArray(parsed.vectors) && parsed.vectors.length >= 16);
  assert.deepEqual(
    parsed.vectors.map((vector) => vector.id).sort(),
    ["MN1", "MN10", "MN11", "MN12", "MN2", "MN21", "MN22", "MN23", "MN25", "MN3", "MN4", "MN5", "MN6", "MN7", "MN8", "MN9"].sort(),
  );
});

test("mention scanner agrees with every shared MN vector (MN22 on the JS side)", () => {
  for (const vector of taskMentionVectors.vectors) {
    const notes = vector.notes || {};
    const records = new Map();
    for (const [filePath, content] of Object.entries(notes)) {
      records.set(filePath, helpers.parseTaskRelationFile(content, filePath));
    }
    const { mentionGroups } = helpers.relationIndexResolveMentionPairs(records, notesResolver(notes));
    const actual = [];
    for (const group of mentionGroups.values()) {
      const first = group.occurrences[0];
      actual.push({
        source: group.sourceKey,
        target: `${group.targetPath}#^${group.targetBlockId}`,
        count: group.count,
        display: group.display,
        site: first.site,
        excerpt: first.excerpt,
      });
    }
    actual.sort((left, right) => (left.source < right.source ? -1 : left.source > right.source ? 1 : 0));
    const expected = (vector.occurrences || []).map((occurrence) => ({
      source: occurrence.source,
      target: occurrence.target,
      count: occurrence.count,
      display: occurrence.display,
      site: occurrence.site,
      excerpt: occurrence.excerpt,
    }));
    expected.sort((left, right) => (left.source < right.source ? -1 : left.source > right.source ? 1 : 0));
    assert.deepEqual(actual, expected, `${vector.id}: occurrence set, display, site, and excerpt`);
  }
});

test("mention scanner reports UTF-16 columns past Unicode (MN22)", () => {
  const content = "- [ ] #task Unicode source ^s\n  - café 日本語 [[#^t]] before\n- [ ] #task Target ^t\n";
  const parsed = helpers.parseTaskRelationFile(content, "uni.md");
  assert.equal(parsed.mentionOccurrences.length, 1);
  const occurrence = parsed.mentionOccurrences[0];
  assert.equal(occurrence.line, 2);
  assert.equal(occurrence.ch, 13);
  assert.equal(occurrence.site, "note");
  assert.equal(occurrence.excerpt, "café 日本語 ⟦this task⟧ before");
});

test("reserved 💬 labels are refused (MN15) and LINKED FROM mentions are typed (MN16)", () => {
  const links = helpers.parseTaskRelationLine("  - 🪢 **LINKS:** [[#^t]] (💬 mentions)");
  assert.equal(links.verdict, "malformed");
  const linked = helpers.parseTaskRelationLine("  - 🪢 **LINKED FROM:** [[#^s]] (💬 mentions)");
  assert.equal(linked.verdict, "accepted");
  assert.equal(linked.entries[0].kind, "mention");
  assert.equal(linked.entries[0].label, "💬 mentions");
  const other = helpers.parseTaskRelationLine("  - 🪢 **LINKED FROM:** [[#^s]] (💬 other)");
  assert.equal(other.verdict, "malformed");
  // MN16: a v1 consumer that ignores `kind` still reads the stored entry as
  // an ordinary labelled row.
  assert.equal(linked.entries[0].target, "");
  assert.equal(linked.entries[0].blockId, "s");
});

test("relationIndex v2 keeps incoming/outgoing relations-only with typed linkedFrom", async () => {
  const restore = enableMentionsSwitch();
  try {
    const source = makeFile("notes/source.md", "- [ ] #task Source ^source\n  - 🪢 **LINKS:** follow-up of [[notes/target#^target]]\n  - mentions [[notes/target#^target]]", { links: [{ link: "notes/target#^target" }], blocks: { source: {} } });
    const target = makeFile("notes/target.md", "- [ ] #task Target ^target", { blocks: { target: {} } });
    const app = makeApp([source, target]);
    app._aliases.set("notes/target", "notes/target.md");
    const plugin = new LedgerToolsPlugin(app, {});
    plugin.initializeRelationIndex();
    plugin.setupRelationIndex();
    plugin.startRelationIndexScan();
    const api = plugin.relationIndexApi();
    await waitUntil(() => api.ready(), "initial scan should finish");
    assert.equal(api.version, 2);
    assert.equal(api.outgoing("notes/source.md", "source").length, 1, "outgoing stays relations-only");
    assert.equal(api.incoming("notes/target.md", "target").length, 1, "incoming stays relations-only");
    const rows = api.linkedFrom("notes/target.md", "target");
    assert.equal(rows.filter((row) => row.kind === "relation").length, 1);
    const relation = rows.find((row) => row.kind === "relation");
    assert.equal(relation.alsoMentioned, true, "MN8: mixed pair marks the relation row");
    assert.equal(rows.filter((row) => row.kind === "mention").length, 0, "MN8: no separate mention row for a related pair");
    assert.deepEqual(api.labelSuggestions().map((row) => row.label).filter((label) => label.startsWith("💬")), []);
    plugin.teardownRelationIndex();
  } finally {
    restore();
  }
});

test("relationIndex publishes mention rows and omits dependency-joined pairs (M7)", async () => {
  const restore = enableMentionsSwitch();
  try {
    const mention = makeFile("notes/mention.md", "- [ ] #task Mentioner ^mentioner\n  - see [[notes/target#^target]]", { links: [{ link: "notes/target#^target" }], blocks: { mentioner: {} } });
    const dependent = makeFile("notes/dependent.md", "- [ ] #task Dependent ^dependent\n  - ⛓️ **DEPENDS ON:** [[notes/target#^target]]\n  - see [[notes/target#^target]]", { links: [{ link: "notes/target#^target" }], blocks: { dependent: {} } });
    const target = makeFile("notes/target.md", "- [ ] #task Target ^target", { blocks: { target: {} } });
    const app = makeApp([mention, dependent, target]);
    app._aliases.set("notes/target", "notes/target.md");
    const plugin = new LedgerToolsPlugin(app, {});
    plugin.initializeRelationIndex();
    plugin.setupRelationIndex();
    plugin.startRelationIndexScan();
    const api = plugin.relationIndexApi();
    await waitUntil(() => api.ready(), "initial scan should finish");
    const rows = api.linkedFrom("notes/target.md", "target");
    const mentions = rows.filter((row) => row.kind === "mention");
    assert.equal(mentions.length, 1, "MN9: dependency-joined pair omitted, plain mention kept");
    assert.equal(mentions[0].source.blockId, "mentioner");
    assert.equal(mentions[0].display, "mention");
    assert.equal(mentions[0].count, 1);
    assert.equal(mentions[0].occurrences[0].site, "note");
    assert.equal(mentions[0].occurrences[0].excerpt, "see ⟦this task⟧");
    plugin.teardownRelationIndex();
  } finally {
    restore();
  }
});

test("relationIndex overlay updates mention rows from unsaved editor text", async () => {
  const restore = enableMentionsSwitch();
  try {
    const source = makeFile("notes/source.md", "- [ ] #task Source ^source", { blocks: { source: {} } });
    const target = makeFile("notes/target.md", "- [ ] #task Target ^target", { blocks: { target: {} } });
    const app = makeApp([source, target]);
    app._aliases.set("notes/target", "notes/target.md");
    const plugin = new LedgerToolsPlugin(app, {});
    plugin.initializeRelationIndex();
    plugin.setupRelationIndex();
    plugin.startRelationIndexScan();
    const api = plugin.relationIndexApi();
    await waitUntil(() => api.ready(), "initial scan should finish");
    assert.equal(api.linkedFrom("notes/target.md", "target").length, 0);
    const view = new TestMarkdownView();
    view.file = source;
    view.editor = { getValue: () => "- [ ] #task Source ^source\n  - see [[notes/target#^target]]" };
    app.activeView = view;
    assert.equal(plugin.refreshRelationIndexOverlay(), true);
    const rows = api.linkedFrom("notes/target.md", "target");
    assert.equal(rows.filter((row) => row.kind === "mention").length, 1, "unsaved editor text publishes instantly");
    plugin.teardownRelationIndex();
  } finally {
    restore();
  }
});

test("scanMentions returns resolved pairs when on and [] when off", async () => {
  const mention = makeFile("notes/mention.md", "- [ ] #task Mentioner ^mentioner\n  - see [[notes/target#^target]]", { links: [{ link: "notes/target#^target" }], blocks: { mentioner: {} } });
  const target = makeFile("notes/target.md", "- [ ] #task Target ^target", { blocks: { target: {} } });
  const app = makeApp([mention, target]);
  app._aliases.set("notes/target", "notes/target.md");
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.initializeRelationIndex();
  plugin.setupRelationIndex();
  plugin.startRelationIndexScan();
  const api = plugin.relationIndexApi();
  await waitUntil(() => api.ready(), "initial scan should finish");
  const restoreOff = disableMentionsSwitch();
  try {
    assert.deepEqual(api.scanMentions("any [[notes/target#^target]]", "notes/mention.md"), [], "switch off mints nothing and returns []");
  } finally {
    restoreOff();
  }
  const restoreOn = enableMentionsSwitch();
  try {
    const pairs = api.scanMentions("- [ ] #task Mentioner ^mentioner\n  - see [[notes/target#^target]]", "notes/mention.md");
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0].display, "mention");
    assert.equal(pairs[0].count, 1);
    assert.equal(pairs[0].occurrences[0].site, "note");
    plugin.teardownRelationIndex();
  } finally {
    restoreOn();
  }
});
