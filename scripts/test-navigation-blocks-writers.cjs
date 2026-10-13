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

function resolveSameNote(note) {
  return note ? `${note}.md` : "Tasks.md";
}

test("BW9 counted same-note add-to-all lists every dependent on one sorted BLOCKS line (570/270)", () => {
  const input = [
    "- [ ] #task One ^one",
    "- [ ] #task Two ^two",
    "- [ ] #task Three ^three",
    "- [ ] #task Target [id:: Tasks__target] ^target",
  ].join("\n");
  const session = helpers.discoverCountedObsidianTaskTargets(input, 0, 2);
  const dependencyTask = helpers.getOpenLocalTasks(input).find((task) => task.line === 3);
  const added = helpers.planCountedLocalTaskDependency(input, session, dependencyTask, "Tasks.md", {
    blocksLinesEnabled: true,
  });
  assert.equal(added.valid, true);
  assert.equal(added.operation, "add");
  // BK21: Unicode code-point order (`three` before `two`).
  assert.match(added.content, /🧱 \*\*BLOCKS:\*\* \[\[#\^one\]\] • \[\[#\^three\]\] • \[\[#\^two\]\]/);
  assert.equal(added.blocksFollowUps.length, 0);
});

test("counted remove-from-all drops every dependent from the same-note BLOCKS line (420)", () => {
  const input = [
    "- [?] #task One [dependsOn:: Tasks__target] ^one",
    "  - ⛓️ **DEPENDS ON:** [[#^target]]",
    "- [?] #task Two [dependsOn:: Tasks__target] ^two",
    "  - ⛓️ **DEPENDS ON:** [[#^target]]",
    "- [ ] #task Target [id:: Tasks__target] ^target",
    "  - 🧱 **BLOCKS:** [[#^one]] • [[#^two]]",
  ].join("\n");
  let working = input;
  for (const parentLine of [2, 0]) {
    const plan = helpers.planDependencyEdit({
      content: working,
      parentPath: "Tasks.md",
      parentLine,
      remove: [{ path: "Tasks.md", blockId: "target" }],
      files: { "Tasks.md": working },
      vaultFiles: ["Tasks.md"],
      resolveLinkpath: resolveSameNote,
      blocksLinesEnabled: true,
    });
    assert.equal(plan.ok, true);
    working = plan.nextContent;
  }
  assert.doesNotMatch(working, /🧱 \*\*BLOCKS:/);
  assert.doesNotMatch(working, /DEPENDS ON/);
});

test("vault counted add composes cross-note follow-ups for every source (420)", () => {
  const source = [
    "- [ ] #task One ^one",
    "- [ ] #task Two ^two",
  ].join("\n");
  const target = "- [ ] #task Prerequisite [id:: prerequisite] ^target";
  const followUps = [];
  let working = source;
  for (const parentLine of [1, 0]) {
    const plan = helpers.planDependencyEdit({
      content: working,
      parentPath: "Tasks.md",
      parentLine,
      add: [{ path: "Other.md", blockId: "target" }],
      files: { "Tasks.md": working, "Other.md": target },
      vaultFiles: ["Tasks.md", "Other.md"],
      resolveLinkpath: (note) => (note === "Other" ? "Other.md" : "Tasks.md"),
      blocksLinesEnabled: true,
    });
    assert.equal(plan.ok, true);
    followUps.push(...plan.blocksFollowUps);
    working = plan.nextContent;
  }
  assert.equal(followUps.length, 2);
  assert.deepEqual(followUps.map((entry) => entry.path), ["Other.md", "Other.md"]);
});

test("marked batch add writes every same-note target onto BLOCKS in one plan (430)", () => {
  const content = [
    "- [ ] #task Dependent ^dependent",
    "- [ ] #task Alpha [id:: alpha] ^alpha",
    "- [ ] #task Beta [id:: beta] ^beta",
  ].join("\n");
  const plan = helpers.planDependencyEdit({
    content,
    parentPath: "Tasks.md",
    parentLine: 0,
    add: [
      { path: "Tasks.md", blockId: "alpha" },
      { path: "Tasks.md", blockId: "beta" },
    ],
    files: { "Tasks.md": content },
    vaultFiles: ["Tasks.md"],
    resolveLinkpath: resolveSameNote,
    blocksLinesEnabled: true,
  });
  assert.equal(plan.ok, true);
  assert.match(plan.nextContent, /🧱 \*\*BLOCKS:\*\* \[\[#\^dependent\]\]/);
  assert.equal((plan.nextContent.match(/🧱 \*\*BLOCKS:/g) || []).length, 2);
});

test("counted Ctrl+D clears same-note BLOCKS when the last dependents leave (600)", async () => {
  const lines = [
    "- [?] #task P [dependsOn:: Here__a] ^p",
    "  - ⛓️ **DEPENDS ON:** [[#^a]]",
    "- [?] #task Q [dependsOn:: Here__a] ^q",
    "  - ⛓️ **DEPENDS ON:** [[#^a]]",
    "- [ ] #task A [id:: Here__a] ^a",
    "  - 🧱 **BLOCKS:** [[#^p]] • [[#^q]]",
  ];
  const content = lines.join("\n");
  const editor = new TestEditor(content);
  const session = helpers.discoverCountedObsidianTaskTargets(content, 0, 1);
  const file = { path: "Here.md", extension: "md" };
  const h = makePlugin({ "Here.md": content });
  h.plugin.getActiveMarkdownView = () => ({ editor, file });
  h.plugin.app.workspace.getActiveFile = () => file;
  h.openEditors.set("Here.md", editor);
  const result = await h.plugin.deleteCountedDependencyLinesAndFields(
    editor,
    { line: 0, ch: 2 },
    file.path,
    session,
  );
  assert.equal(result.deleted, true);
  assert.doesNotMatch(editor.getValue(), /DEPENDS ON|dependsOn|🧱 \*\*BLOCKS:/);
});

test("BW10 hand-edit add mirrors the new target onto BLOCKS when the cursor leaves", async () => {
  const oldContent = [
    "- [ ] #task Dependent ^dependent",
    "- [ ] #task Prerequisite [id:: prerequisite] ^target",
  ].join("\n");
  const newContent = [
    "- [ ] #task Dependent ^dependent",
    "  - ⛓️ **DEPENDS ON:** [[#^target]]",
    "- [ ] #task Prerequisite [id:: prerequisite] ^target",
  ].join("\n");
  const h = makePlugin({ "Tasks.md": newContent });
  const editor = new TestEditor(newContent);
  h.openEditors.set("Tasks.md", editor);
  const outcome = await h.plugin.mirrorDependencyHandEdit(
    editor,
    "Tasks.md",
    oldContent,
    1,
    "",
    { baselineLine: 0 },
  );
  assert.equal(outcome.mirrored, true);
  assert.match(editor.getValue(), /🧱 \*\*BLOCKS:\*\* \[\[#\^dependent\]\]/);
  assert.match(editor.getValue(), /\[dependsOn:: prerequisite\]/);
});

test("BW10 hand-edit remove and BW11 undo re-fire drop the dependent from BLOCKS", async () => {
  const oldContent = [
    "- [?] #task Dependent [dependsOn:: prerequisite] ^dependent",
    "  - ⛓️ **DEPENDS ON:** [[Other#^target]]",
  ].join("\n");
  const newContent = "- [?] #task Dependent [dependsOn:: prerequisite] ^dependent";
  const target = [
    "- [ ] #task Prerequisite [id:: prerequisite] ^target",
    "  - 🧱 **BLOCKS:** [[Tasks#^dependent]]",
  ].join("\n");
  const h = makePlugin({ "Tasks.md": newContent, "Other.md": target });
  const editor = new TestEditor(newContent);
  h.openEditors.set("Tasks.md", editor);
  const outcome = await h.plugin.mirrorDependencyHandEdit(
    editor,
    "Tasks.md",
    oldContent,
    0,
    "  - ⛓️ **DEPENDS ON:** [[Other#^target]]",
    { baselineLine: 1 },
  );
  assert.equal(outcome.mirrored, true);
  assert.doesNotMatch(h.store.get("Other.md"), /🧱 \*\*BLOCKS:/);
  assert.doesNotMatch(editor.getValue(), /dependsOn|DEPENDS ON/);
});

test("hand-edit clear path routes through the BLOCKS seam (600)", () => {
  const oldContent = [
    "- [?] #task Dependent [dependsOn:: prerequisite] ^dependent",
    "  - ⛓️ **DEPENDS ON:** [[#^target]]",
    "- [ ] #task Prerequisite [id:: prerequisite] ^target",
    "  - 🧱 **BLOCKS:** [[#^dependent]]",
  ].join("\n");
  const newContent = [
    "- [?] #task Dependent [dependsOn:: prerequisite] ^dependent",
    "- [ ] #task Prerequisite [id:: prerequisite] ^target",
    "  - 🧱 **BLOCKS:** [[#^dependent]]",
  ].join("\n");
  const plan = helpers.planDependencyHandEditMirror(oldContent, newContent, 0, "  - ⛓️ **DEPENDS ON:** [[#^target]]", 1);
  assert.ok(plan);
  assert.ok(plan.kind === "clear-field" || plan.kind === "clear-empty" || plan.kind === "touch");
  const existing = helpers.collectBlocksExistingRefs(oldContent, 0, "Tasks.md", resolveSameNote);
  assert.equal(existing.length, 1);
  assert.equal(existing[0].blockId, "target");
  const edit = helpers.planDependencyEdit({
    content: newContent,
    parentPath: "Tasks.md",
    parentLine: 0,
    add: [],
    remove: [],
    files: { "Tasks.md": newContent },
    vaultFiles: ["Tasks.md"],
    resolveLinkpath: resolveSameNote,
    blocksLinesEnabled: true,
    blocksExisting: existing,
    mirrorTouch: true,
  });
  assert.equal(edit.ok, true);
  assert.doesNotMatch(edit.nextContent, /🧱 \*\*BLOCKS:/);
});

test("BW18 conversion never copies a BLOCKS line as a user child", () => {
  const parent = "- [?] #task Convert me ^t";
  const forward = helpers.splitProjectLifecycleChildren(parent, [
    "  - ⛓️ **DEPENDS ON:** [[#^a]]",
    "  - 🧱 **BLOCKS:** [[#^d]]",
    "  - 🧩 **Sub-projects:** [[#^s]]",
    "  - keep me",
  ]);
  assert.equal(forward.valid, true);
  assert.equal(forward.dependencyLine, "  - ⛓️ **DEPENDS ON:** [[#^a]]");
  assert.deepEqual(forward.otherLines, ["  - keep me"]);
  const reverse = helpers.splitProjectLifecycleChildren(parent, [
    "  - 🧱 **BLOCKS:** [[#^d]]",
    "  - user child",
  ]);
  assert.equal(reverse.valid, true);
  assert.equal(reverse.dependencyLine, null);
  assert.deepEqual(reverse.otherLines, ["  - user child"]);
});

test("BW19 Ctrl+Shift+M moves the owner's BLOCKS line with rebased links and never duplicates it", () => {
  const source = [
    "- [ ] #task Owner ^owner",
    "  - 🧱 **BLOCKS:** [[#^d]]",
    "- [ ] #task Dependent ^d",
  ].join("\n");
  const destination = [
    "---",
    'type: "[[project]]"',
    "status: waiting",
    "---",
    "## Tasks",
    "",
  ].join("\n");
  const discovery = helpers.discoverMovableObsidianTaskTargets(source, 0, 0);
  const plan = helpers.planTaskMoveAcrossFiles({
    sourcePath: "Source.md",
    destinationPath: "Dest.md",
    sourceContent: source,
    destinationContent: destination,
    targets: discovery.targets,
    parseYaml: (text) => {
      const result = {};
      for (const line of String(text || "").split(/\r?\n/)) {
        const match = /^([^:]+):(.*)$/.exec(line);
        if (!match) continue;
        let value = match[2].trim();
        if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
          value = value.slice(1, -1);
        }
        result[match[1].trim()] = value;
      }
      return result;
    },
  });
  assert.equal(plan.valid, true, plan.error);
  const nextDestination = plan.changes.get("Dest.md").after;
  const nextSource = plan.changes.get("Source.md").after;
  assert.equal((nextDestination.match(/🧱 \*\*BLOCKS:/g) || []).length, 1);
  assert.match(nextDestination, /🧱 \*\*BLOCKS:\*\* \[\[Source#\^d\]\]/);
  assert.doesNotMatch(nextSource, /🧱 \*\*BLOCKS:/);
  assert.match(nextSource, /#task Dependent \^d/);
});
