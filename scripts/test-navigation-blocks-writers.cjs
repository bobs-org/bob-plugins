// BLOCKS immediate nav writer vectors (bob-cli-7e.7).
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const notices = [];
const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    class EmptyClass {}
    return {
      MarkdownView: EmptyClass,
      Modal: class {},
      Notice: class { constructor(message) { notices.push(String(message)); } },
      Plugin: EmptyClass,
      parseYaml: () => ({}),
    };
  }
  if (request === "@codemirror/view") return { EditorView: class {} };
  return originalLoad.call(this, request, parent, isMain);
};
const NavigationHotkeysPlugin = require("../plugins/bob-navigation-hotkeys/main.js");
const { helpers } = NavigationHotkeysPlugin;
Module._load = originalLoad;

function compatibleTasksSettings() {
  return {
    globalFilter: "#task",
    statusSettings: {
      coreStatuses: [],
      customStatuses: [{ symbol: "?", name: "Blocked", nextStatusSymbol: " ", availableAsCommand: true, type: "ON_HOLD" }],
    },
  };
}

class TestEditor {
  constructor(content) { this.content = String(content || ""); this.undoGroups = 0; this.lastAnnotation = null; }
  getValue() { return this.content; }
  transaction(transaction) {
    this.lastAnnotation = transaction.annotation || null;
    const changes = [...(transaction.changes || [])].sort((a, b) => b.from.line - a.from.line || b.from.ch - a.from.ch);
    if (changes.length > 0) this.undoGroups += 1;
    const lines = this.content.split(/\r?\n/);
    for (const change of changes) {
      const offset = (position) => lines.slice(0, position.line).reduce((sum, line) => sum + line.length + (this.content.includes("\r\n") ? 2 : 1), 0) + position.ch;
      const start = offset(change.from);
      const end = offset(change.to || change.from);
      this.content = this.content.slice(0, start) + change.text + this.content.slice(end);
    }
  }
}

function makePlugin(notes, options = {}) {
  const store = new Map(Object.entries(notes));
  const openEditors = new Map();
  const settingsPath = ".obsidian/plugins/obsidian-tasks-plugin/data.json";
  let mutated = false;
  const vault = {
    getMarkdownFiles: () => [...store.keys()].filter((path) => /\.md$/i.test(path)).map((path) => ({ path })),
    getAbstractFileByPath: (path) => store.has(path) || path === settingsPath ? { path } : null,
    cachedRead: async (file) => {
      if (file.path === settingsPath) return JSON.stringify(compatibleTasksSettings());
      const content = String(store.get(file.path) || "");
      if (!mutated && options.mutateAfterRead && options.mutateAfterRead.path === file.path) {
        mutated = true;
        store.set(file.path, options.mutateAfterRead.content);
      }
      return content;
    },
    read: async (file) => file.path === settingsPath ? JSON.stringify(compatibleTasksSettings()) : vault.cachedRead(file),
    process: async (file, transform) => { store.set(file.path, String(transform(String(store.get(file.path) || "")))); },
  };
  const metadataCache = {
    getFirstLinkpathDest: (linkpath) => {
      const wanted = String(linkpath || "").replace(/\.md$/i, "");
      const exact = `${wanted}.md`;
      if (store.has(exact)) return { path: exact };
      const matches = [...store.keys()].filter((path) => /\.md$/i.test(path) && path.split("/").pop().replace(/\.md$/i, "").toLowerCase() === wanted.toLowerCase());
      return matches.length === 1 ? { path: matches[0] } : null;
    },
  };
  const app = {
    vault,
    metadataCache,
    workspace: {
      getLeavesOfType: () => [...openEditors].map(([path, editor]) => ({ view: { file: { path }, editor } })),
      getActiveFile: () => null,
    },
  };
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = app;
  return { plugin, store, openEditors };
}

function fixture({ sameNote = false, dependentId = "dependent", targetStatus = " ", targetBlocks = "", mutateAfterRead = null } = {}) {
  const owner = `- [${targetStatus}] #task Prerequisite [id:: prerequisite] ^target${targetBlocks}`;
  const dependent = `- [ ] #task Dependent${dependentId ? ` ^${dependentId}` : ""}`;
  const parentContent = sameNote ? `${dependent}\n${owner}` : dependent;
  const notes = sameNote ? { "Tasks.md": parentContent } : { "Tasks.md": parentContent, "Other.md": owner };
  const harness = makePlugin(notes, { mutateAfterRead });
  const editor = new TestEditor(parentContent);
  harness.openEditors.set("Tasks.md", editor);
  return { ...harness, editor, parentContent, ownerPath: sameNote ? "Tasks.md" : "Other.md" };
}

test("SB1-SB9 dependent IDs match the successor mint vectors", () => {
  const cases = [
    ["SB1", "- [?] #task Renew the library books", [], "renew-library-books"],
    ["SB2", "- [?] #task Fix apollo machine", [], "fix-apollo-machine"],
    ["SB3", "- [?] #task Add support for new `%hold` directive", [], "hold"],
    ["SB4", "- [?] #task Review [[sase#^fix-apollo|apollo fix]] notes", [], "apollo-fix"],
    ["SB5", "- [?] #task Book flights [scheduled:: 2026-10-13] #task", [], "book-flights"],
    ["SB6", "- [?] #task Book flights [scheduled:: 2026-10-13] #task", ["book-flights"], "book-flights-2"],
    ["SB7", "- [?] #task Fix it", ["fix", ...Array.from({ length: 8 }, (_, index) => `fix-${index + 2}`)], "task"],
    ["SB8", "- [?] #task é🚀", [], "task"],
    ["SB9", "- [?] #task é🚀", ["task", "task-2"], "task-3"],
  ];
  for (const [id, line, used, expected] of cases) assert.equal(helpers.mintDependentBlockId(line, used), expected, id);
});

test("BW1 same-note add mints and writes BLOCKS in the dependent's single transaction", async () => {
  const h = fixture({ sameNote: true, dependentId: "" });
  const outcome = await h.plugin.applyDependencyEdit({
    editor: h.editor, parentPath: "Tasks.md", parentLine: 0,
    add: [{ path: "Tasks.md", blockId: "target" }],
  });
  assert.equal(outcome.ok, true);
  assert.equal(h.editor.undoGroups, 1);
  assert.equal(h.editor.lastAnnotation, helpers.BLOCKS_MACHINE_WRITE_ANNOTATION);
  assert.match(h.editor.getValue(), /\^dependent/);
  assert.match(h.editor.getValue(), /🧱 \*\*BLOCKS:\*\* \[\[#\^dependent\]\]/);
  assert.match(h.editor.getValue(), /⛓️ \*\*DEPENDS ON:\*\* \[\[#\^target\]\]/);
});

test("BW2 cross-note add follows the dependent commit and writes the target note", async () => {
  const h = fixture();
  const outcome = await h.plugin.applyDependencyEdit({
    editor: h.editor, parentPath: "Tasks.md", parentLine: 0,
    add: [{ path: "Other.md", blockId: "target" }],
  });
  assert.equal(outcome.ok, true);
  assert.match(h.editor.getValue(), /DEPENDS ON/);
  assert.match(h.store.get("Other.md"), /🧱 \*\*BLOCKS:\*\* \[\[Tasks#\^dependent\]\]/);
});

test("BW4 cross-note target preparation precedes the reverse-line preimage", async () => {
  const h = makePlugin({
    "Tasks.md": "- [ ] #task Dependent ^dependent",
    "Other.md": "- [ ] #task Prerequisite ^target",
  });
  const editor = new TestEditor("- [ ] #task Dependent ^dependent");
  h.openEditors.set("Tasks.md", editor);
  const outcome = await h.plugin.applyDependencyEdit({
    editor, parentPath: "Tasks.md", parentLine: 0,
    add: [{ path: "Other.md", blockId: "target" }],
  });
  assert.equal(outcome.ok, true);
  assert.match(h.store.get("Other.md"), /\[id:: [^\]]+\]/);
  assert.match(h.store.get("Other.md"), /🧱 \*\*BLOCKS:\*\* \[\[Tasks#\^dependent\]\]/);
});

test("BW3 stale cross-note preimage leaves the forward write standing and shows the suffix", async () => {
  const h = fixture({
    mutateAfterRead: { path: "Other.md", content: "- [ ] #task Prerequisite [id:: prerequisite] ^target\nConcurrent edit" },
  });
  const outcome = await h.plugin.applyDependencyEdit({
    editor: h.editor, parentPath: "Tasks.md", parentLine: 0,
    add: [{ path: "Other.md", blockId: "target" }],
  });
  assert.equal(outcome.ok, true);
  assert.match(h.editor.getValue(), /DEPENDS ON/);
  assert.match(outcome.notice, /· 🧱 BLOCKS not updated/);
  assert.match(h.store.get("Other.md"), /Concurrent edit/);
});

test("BW5 removal deletes the reverse line when its last dependent leaves", () => {
  const source = "- [?] #task Dependent [dependsOn:: prerequisite] ^dependent\n  - ⛓️ **DEPENDS ON:** [[Other#^target]]";
  const target = "- [ ] #task Prerequisite [id:: prerequisite] ^target\n  - 🧱 **BLOCKS:** [[Tasks#^dependent]]";
  const plan = helpers.planDependencyEdit({
    content: source, parentPath: "Tasks.md", parentLine: 0,
    remove: [{ path: "Other.md", blockId: "target" }],
    files: { "Tasks.md": source, "Other.md": target },
    vaultFiles: ["Tasks.md", "Other.md"],
    resolveLinkpath: (note) => note === "Other" ? "Other.md" : "Tasks.md",
    blocksLinesEnabled: true,
  });
  assert.equal(plan.ok, true);
  assert.doesNotMatch(plan.nextContent, /🧱 \*\*BLOCKS:/);
  assert.equal(plan.blocksFollowUps.length, 1);
  assert.deepEqual(plan.blocksFollowUps[0].remove, ["Tasks.md#^dependent"]);
});

test("BW6 an already mirrored edge is a byte-identical no-op", () => {
  const source = "- [?] #task Dependent [dependsOn:: prerequisite] ^dependent\n  - ⛓️ **DEPENDS ON:** [[Other#^target]]";
  const target = "- [ ] #task Prerequisite [id:: prerequisite] ^target\n  - 🧱 **BLOCKS:** [[Tasks#^dependent]]";
  const plan = helpers.planDependencyEdit({
    content: source, parentPath: "Tasks.md", parentLine: 0,
    add: [{ path: "Other.md", blockId: "target" }],
    files: { "Tasks.md": source, "Other.md": target },
    vaultFiles: ["Tasks.md", "Other.md"],
    resolveLinkpath: (note) => note === "Other" ? "Other.md" : "Tasks.md",
    blocksLinesEnabled: true,
  });
  assert.equal(plan.changed, false);
  assert.equal(plan.nextContent, source);
  assert.equal(plan.blocksFollowUps.length, 0);
});

test("BW7 closed owners stay frozen", async () => {
  const h = fixture({ targetStatus: "x" });
  const before = h.store.get("Other.md");
  const outcome = await h.plugin.applyDependencyEdit({
    editor: h.editor, parentPath: "Tasks.md", parentLine: 0,
    add: [{ path: "Other.md", blockId: "target" }],
  });
  assert.equal(outcome.ok, true);
  assert.equal(h.store.get("Other.md"), before);
});

test("BW8 malformed reverse lines stay untouched and report the failed mirror", async () => {
  const h = fixture({ targetBlocks: "\n  - 🧱 **BLOCKS:** [[#^other]] prose" });
  const before = h.store.get("Other.md");
  const outcome = await h.plugin.applyDependencyEdit({
    editor: h.editor, parentPath: "Tasks.md", parentLine: 0,
    add: [{ path: "Other.md", blockId: "target" }],
  });
  assert.equal(outcome.ok, true);
  assert.match(h.editor.getValue(), /DEPENDS ON/);
  assert.equal(h.store.get("Other.md"), before);
  assert.match(outcome.notice, /· 🧱 BLOCKS not updated/);
});

test("BW15 config defaults on, honors false, and invalid values fall back on", () => {
  helpers.resetBlocksLinesConfigCache();
  const makeFs = (contents) => ({
    statSync: () => ({ mtimeMs: 10, size: contents.length }),
    readFileSync: () => contents,
  });
  const parse = (value) => ({ dependencies: { blocks_lines: value.trim() === "false" ? false : value.trim() === "true" ? true : value.trim() } });
  assert.equal(helpers.loadBlocksLinesEnabled({ configPath: "/test/config", fsModule: makeFs("false"), parseYaml: parse }), false);
  helpers.resetBlocksLinesConfigCache();
  assert.equal(helpers.loadBlocksLinesEnabled({ configPath: "/test/config", fsModule: makeFs("invalid"), parseYaml: () => ({ dependencies: { blocks_lines: "false" } }) }), true);
  helpers.resetBlocksLinesConfigCache();
  const missing = {
    statSync: () => { const error = new Error("missing"); error.code = "ENOENT"; throw error; },
    readFileSync: () => { const error = new Error("missing"); error.code = "ENOENT"; throw error; },
  };
  assert.equal(helpers.loadBlocksLinesEnabled({ configPath: "/missing/config", fsModule: missing }), true);
});

test("BW17 planner output follows BK21 Unicode code-point ordering", () => {
  const content = "- [ ] #task Owner ^owner";
  const plan = helpers.planBlocksLineEdit(content, 0, [
    "[[zeta#^e]]", "[[élan#^d]]", "[[cash#^c]]", "[[Cash#^a]]", "[[#^b]]",
  ]);
  assert.equal(plan.ok, true);
  assert.equal(plan.nextContent, "- [ ] #task Owner ^owner\n\t- 🧱 **BLOCKS:** [[#^b]] • [[Cash#^a]] • [[cash#^c]] • [[zeta#^e]] • [[élan#^d]]");
});

test("duplicate BLOCKS children merge their known dependents and preserve CRLF", () => {
  const content = "- [ ] #task Owner ^owner\r\n\t- 🧱 **BLOCKS:** [[#^a]]\r\n\t- 🧱 **BLOCKS:** [[#^b]]\r\n";
  const plan = helpers.planBlocksLineEdit(content, 0, ["[[#^a]]", "[[#^b]]"]);
  assert.equal(plan.changed, true);
  assert.equal(plan.nextContent, "- [ ] #task Owner ^owner\r\n\t- 🧱 **BLOCKS:** [[#^a]] • [[#^b]]\r\n");
});
