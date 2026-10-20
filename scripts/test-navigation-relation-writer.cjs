// LINKS / LINKED FROM planner twin and applyRelationEdit (bob-cli-a2.9).
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
      Notice: class {
        constructor(message) {
          notices.push(String(message));
        }
      },
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

test("LW1 inserts an unlabelled LINKS line in the empty slot", () => {
  const plan = helpers.planLinksEdit("- [ ] #task T ^t", 0, {
    add: [{ link: "[[#^t]]" }],
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.nextContent, "- [ ] #task T ^t\n\t- 🪢 **LINKS:** [[#^t]]");
  assert.deepEqual(plan.report.added, ["[[#^t]]"]);
});

test("LW2 appends a labelled entry and LW3 is a byte-identical no-op", () => {
  const existing = "- [ ] #task T ^t\n  - 🪢 **LINKS:** [[#^a]]";
  const added = helpers.planLinksEdit(existing, 0, {
    add: [{ link: "[[#^t]]", label: "see" }],
  });
  assert.equal(added.nextContent, "- [ ] #task T ^t\n  - 🪢 **LINKS:** [[#^a]] • see [[#^t]]");
  const same = helpers.planLinksEdit(existing, 0, { add: [{ link: "[[#^a]]" }] });
  assert.equal(same.changed, false);
  assert.equal(same.nextContent, existing);
});

test("LW4 relabels in place and LW5/LW6 remove entries", () => {
  const existing = "- [ ] #task T ^t\n  - 🪢 **LINKS:** [[#^a]]";
  const relabel = helpers.planLinksEdit(existing, 0, {
    add: [{ link: "[[#^a]]", label: "see" }],
  });
  assert.equal(relabel.nextContent, "- [ ] #task T ^t\n  - 🪢 **LINKS:** see [[#^a]]");
  const removed = helpers.planLinksEdit(existing, 0, { remove: ["[[#^a]]"] });
  assert.equal(removed.nextContent, "- [ ] #task T ^t");
  const three = "- [ ] #task T ^t\n  - 🪢 **LINKS:** [[#^a]] • [[#^b]] • [[#^c]]";
  const middle = helpers.planLinksEdit(three, 0, { remove: ["[[#^b]]"] });
  assert.equal(middle.nextContent, "- [ ] #task T ^t\n  - 🪢 **LINKS:** [[#^a]] • [[#^c]]");
});

test("LW7 places LINKS after Sub-projects and LINKED FROM after LINKS", () => {
  const managed = [
    "- [ ] #task T ^t",
    "  - ❌ **CANCEL LOG**",
    "    - archived note",
    "  - ⛓️ **DEPENDS ON:** [[#^up]]",
    "    - nested dependency note",
    "  - 🧱 **BLOCKS:** [[#^down]]",
    "  - 🧩 **Sub-projects:** [[Child]]",
    "  - user child",
  ].join("\n");
  const linksSlot = helpers.relationInsertSlot(managed.split("\n"), 0, "links");
  assert.equal(linksSlot.lineIndex, 7);
  const withLinks = [
    "- [ ] #task T ^t",
    "  - 🧩 **Sub-projects:** [[Child]]",
    "  - 🪢 **LINKS:** [[#^a]]",
    "  - user child",
  ].join("\n");
  const fromSlot = helpers.relationInsertSlot(withLinks.split("\n"), 0, "linked-from");
  assert.equal(fromSlot.lineIndex, 3);
});

test("LW8 inserts LINKS as the first child when only user children exist", () => {
  const slot = helpers.relationInsertSlot(
    ["- [ ] #task T ^t", "  - user child", "  - 🗓️ **SCHEDULE LOG**"],
    0,
    "links",
  );
  assert.equal(slot.lineIndex, 1);
});

test("LW9 merges duplicate LINKS lines with first label winning", () => {
  const duplicate = [
    "- [ ] #task T ^t",
    "  - 🪢 **LINKS:** see [[#^a]]",
    "  - 🪢 **LINKS:** other [[#^a]] • [[#^b]]",
  ].join("\n");
  const plan = helpers.planLinksEdit(duplicate, 0, {
    add: [{ link: "[[#^c]]" }],
  });
  assert.equal(
    plan.nextContent,
    "- [ ] #task T ^t\n  - 🪢 **LINKS:** see [[#^a]] • [[#^b]] • [[#^c]]",
  );
});

test("LW10 refuses a malformed LINKS line", () => {
  const plan = helpers.planLinksEdit(
    "- [ ] #task T ^t\n  - 🪢 **LINKS:** [[#^a]] until Friday",
    0,
    { add: [{ link: "[[#^b]]" }] },
  );
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, "malformed-links-line");
  assert.equal(plan.notice, "its LINKS line is malformed");
});

test("LW11 normalises and refuses labels", () => {
  const collapse = helpers.planLinksEdit("- [ ] #task T ^t", 0, {
    add: [{ link: "[[#^t]]", label: " Follow-up  of:" }],
  });
  assert.match(collapse.nextContent, /Follow-up of \[\[#\^t\]\]/);
  const tooLong = helpers.planLinksEdit("- [ ] #task T ^t", 0, {
    add: [{ link: "[[#^t]]", label: "a".repeat(41) }],
  });
  assert.equal(tooLong.ok, false);
  assert.equal(tooLong.reason, "invalid-label");
  const badChar = helpers.planLinksEdit("- [ ] #task T ^t", 0, {
    add: [{ link: "[[#^t]]", label: "see (old)" }],
  });
  assert.equal(badChar.ok, false);
});

test("LW12 reuses a 4-space child indent", () => {
  const slot = helpers.relationInsertSlot(
    ["- [ ] #task T ^t", "    - user child"],
    0,
    "links",
  );
  assert.equal(slot.indent, "    ");
  assert.equal(slot.lineIndex, 1);
});

test("LW13 canonical link forms match Rust", () => {
  assert.equal(
    helpers.canonicalDependencyLink(
      { path: "other.md", blockId: "t" },
      "body.md",
      ["note.md", "dir/note.md", "other.md", "done/x_done.md"],
    ).text,
    "[[other#^t]]",
  );
  assert.equal(
    helpers.canonicalDependencyLink(
      { path: "dir/note.md", blockId: "t" },
      "body.md",
      ["note.md", "dir/note.md", "other.md", "done/x_done.md"],
    ).text,
    "[[dir/note#^t]]",
  );
  assert.equal(
    helpers.canonicalDependencyLink(
      { path: "done/x_done.md", blockId: "t" },
      "body.md",
      ["note.md", "dir/note.md", "other.md", "done/x_done.md"],
    ).text,
    "[[done/x_done#^t]]",
  );
});

test("LW14 / LK20 LINKED FROM sort is byte-identical to Rust", () => {
  const formatted = helpers.formatLinkedFromLine("\t", [
    { link: "[[zeta#^e]]" },
    { link: "[[élan#^d]]" },
    { link: "[[cash#^c]]" },
    { link: "[[Cash#^a]]" },
    { link: "[[#^b]]" },
  ]);
  assert.equal(
    formatted,
    "\t- 🪢 **LINKED FROM:** [[#^b]] • [[Cash#^a]] • [[cash#^c]] • [[zeta#^e]] • [[élan#^d]]",
  );
  assert.equal(
    helpers.formatLinksLine("  ", [
      { link: "[[#^a]]", label: "see" },
      { link: "[[cash#^b]]" },
    ]),
    "  - 🪢 **LINKS:** see [[#^a]] • [[cash#^b]]",
  );
});

test("Rule 6 LINKED FROM planner table", () => {
  const desired = [{ link: "[[#^s]]", label: null }];
  const inserted = helpers.planLinkedFromLine("- [ ] #task T ^t\n  - child", 0, desired);
  assert.equal(inserted.kind, "inserted");
  const rewritten = helpers.planLinkedFromLine(
    "- [ ] #task T ^t\n  - 🪢 **LINKED FROM:** [[#^old]]",
    0,
    desired,
  );
  assert.equal(rewritten.kind, "rewritten");
  const canonicalized = helpers.planLinkedFromLine(
    "- [ ] #task T ^t\n  - **BACKLINKS:** [[#^s]]",
    0,
    desired,
  );
  assert.equal(canonicalized.kind, "canonicalized");
  const removed = helpers.planLinkedFromLine(
    "- [ ] #task T ^t\n  - 🪢 **LINKED FROM:** [[#^s]]",
    0,
    [],
  );
  assert.equal(removed.kind, "removed");
  const deduplicated = helpers.planLinkedFromLine(
    "- [ ] #task T ^t\n  - 🪢 **LINKED FROM:** [[#^s]]\n  - 🪢 **LINKED FROM:** [[#^s]]",
    0,
    desired,
  );
  assert.equal(deduplicated.kind, "deduplicated");
  const malformed = helpers.planLinkedFromLine(
    "- [ ] #task T ^t\n  - 🪢 **LINKED FROM:** [[#^s]] extra",
    0,
    desired,
  );
  assert.equal(malformed.ok, false);
  assert.equal(malformed.kind, "malformed");
});

test("linkedFromDesiredAfterDelta keeps labels and sorts", () => {
  const parsed = helpers.parseLinkedFromLine(
    "- 🪢 **LINKED FROM:** [[z#^last]] (see) • [[#^keep]]",
  );
  const desired = helpers.linkedFromDesiredAfterDelta(
    parsed.entries,
    (entry) => ({
      identity: entry.blockId,
      link: entry.note ? `[[${entry.note}#^${entry.blockId}]]` : `[[#^${entry.blockId}]]`,
    }),
    [{ identity: "new", link: "[[a#^new]]", label: "next" }],
    ["last"],
  );
  assert.deepEqual(
    desired.map((entry) => [entry.link, entry.label]),
    [
      ["[[#^keep]]", null],
      ["[[a#^new]]", "next"],
    ],
  );
});

test("LG14 kill switch defaults on, honors false, and invalid values fall back on", () => {
  helpers.resetRelationsLinkedFromLinesConfigCache();
  const makeFs = (contents) => ({
    statSync: () => ({ mtimeMs: 10, size: contents.length }),
    readFileSync: () => contents,
  });
  const parse = (value) => ({
    relations: {
      linked_from_lines:
        value.trim() === "false" ? false : value.trim() === "true" ? true : value.trim(),
    },
  });
  assert.equal(
    helpers.loadRelationsLinkedFromLinesEnabled({
      configPath: "/test/config",
      fsModule: makeFs("false"),
      parseYaml: parse,
    }),
    false,
  );
  helpers.resetRelationsLinkedFromLinesConfigCache();
  assert.equal(
    helpers.loadRelationsLinkedFromLinesEnabled({
      configPath: "/test/config",
      fsModule: makeFs("invalid"),
      parseYaml: () => ({ relations: { linked_from_lines: "false" } }),
    }),
    true,
  );
  helpers.resetRelationsLinkedFromLinesConfigCache();
  const missing = {
    statSync: () => {
      const error = new Error("missing");
      error.code = "ENOENT";
      throw error;
    },
    readFileSync: () => {
      const error = new Error("missing");
      error.code = "ENOENT";
      throw error;
    },
  };
  assert.equal(
    helpers.loadRelationsLinkedFromLinesEnabled({
      configPath: "/missing/config",
      fsModule: missing,
    }),
    true,
  );
});

test("LG1 same-note add mints and writes LINKS plus LINKED FROM in one transaction", async () => {
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
  assert.equal(editor.lastAnnotation, helpers.RELATIONS_MACHINE_WRITE_ANNOTATION);
  assert.match(editor.getValue(), /\^source/);
  assert.match(editor.getValue(), /🪢 \*\*LINKS:\*\* \[\[#\^target\]\]/);
  assert.match(editor.getValue(), /🪢 \*\*LINKED FROM:\*\* \[\[#\^source\]\]/);
});

test("LG2 cross-note T follows the source commit; a changed target suffixes the notice", async () => {
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
  assert.match(editor.getValue(), /🪢 \*\*LINKS:\*\* \[\[Other#\^target\]\]/);
  assert.match(harness.store.get("Other.md"), /🪢 \*\*LINKED FROM:\*\* \[\[Tasks#\^source\]\]/);

  const stale = makePlugin({
    "Tasks.md": "- [ ] #task Source ^source",
    "Other.md": "- [ ] #task Target ^target",
  });
  const staleEditor = new TestEditor("- [ ] #task Source ^source");
  stale.openEditors.set("Tasks.md", staleEditor);
  let otherReads = 0;
  const originalCachedRead = stale.plugin.app.vault.cachedRead;
  stale.plugin.app.vault.cachedRead = async (file) => {
    const content = await originalCachedRead(file);
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
  assert.match(staleEditor.getValue(), /LINKS/);
  assert.match(failed.notice, /🪢 LINKED FROM not updated/);
});

test("LG4 unlinks and relabels in place with the mirror", async () => {
  const source = [
    "- [ ] #task Source ^source",
    "  - 🪢 **LINKS:** see [[#^target]]",
    "- [ ] #task Target ^target",
    "  - 🪢 **LINKED FROM:** [[#^source]] (see)",
  ].join("\n");
  const harness = makePlugin({ "Tasks.md": source });
  const editor = new TestEditor(source);
  harness.openEditors.set("Tasks.md", editor);
  const relabel = await harness.plugin.applyRelationEdit({
    sources: [{ path: "Tasks.md", line: 0, blockId: "source" }],
    relabel: [{ path: "Tasks.md", blockId: "target", label: "follow-up of" }],
    linkedFromLinesEnabled: true,
  });
  assert.equal(relabel.ok, true);
  assert.match(editor.getValue(), /follow-up of \[\[#\^target\]\]/);
  assert.match(editor.getValue(), /\[\[#\^source\]\] \(follow-up of\)/);

  const unlinked = await harness.plugin.applyRelationEdit({
    sources: [{ path: "Tasks.md", line: 0, blockId: "source" }],
    remove: [{ path: "Tasks.md", blockId: "target" }],
    linkedFromLinesEnabled: true,
  });
  assert.equal(unlinked.ok, true);
  assert.doesNotMatch(editor.getValue(), /\*\*LINKS:\*\*/);
  assert.doesNotMatch(editor.getValue(), /\*\*LINKED FROM:\*\*/);
});

test("LG6 archived targets write LINKS without a mirror", async () => {
  const harness = makePlugin({
    "Tasks.md": "- [ ] #task Source ^source",
    "done/old_done.md": "- [x] #task Archived ^arch",
  });
  const editor = new TestEditor("- [ ] #task Source ^source");
  harness.openEditors.set("Tasks.md", editor);
  const outcome = await harness.plugin.applyRelationEdit({
    sources: [{ path: "Tasks.md", line: 0, blockId: "source" }],
    add: [{ path: "done/old_done.md", blockId: "arch" }],
    linkedFromLinesEnabled: true,
  });
  assert.equal(outcome.ok, true);
  assert.match(editor.getValue(), /\[\[done\/old_done#\^arch\]\]/);
  assert.doesNotMatch(harness.store.get("done/old_done.md"), /LINKED FROM/);
  assert.match(outcome.notice, /archived: shown live only/);
});

test("LG13 relation writes never stamp or change status", async () => {
  const source = "- [ ] #task Inbox item ^source\n- [ ] #task Target ^target";
  const harness = makePlugin({ "Tasks.md": source });
  const editor = new TestEditor(source);
  harness.openEditors.set("Tasks.md", editor);
  const outcome = await harness.plugin.applyRelationEdit({
    sources: [{ path: "Tasks.md", line: 0, blockId: "source" }],
    add: [{ path: "Tasks.md", blockId: "target", label: "see" }],
    linkedFromLinesEnabled: true,
  });
  assert.equal(outcome.ok, true);
  assert.doesNotMatch(editor.getValue(), /\[fresh::/);
  assert.doesNotMatch(editor.getValue(), /\[keeps::/);
  assert.match(editor.getValue(), /^- \[ \] #task Inbox item/m);
  assert.match(editor.getValue(), /^- \[ \] #task Target/m);
});

test("LG14 kill switch writes LINKS without a mirror or source mint", async () => {
  const source = "- [ ] #task Source\n- [ ] #task Target ^target";
  const harness = makePlugin({ "Tasks.md": source });
  const editor = new TestEditor(source);
  harness.openEditors.set("Tasks.md", editor);
  const outcome = await harness.plugin.applyRelationEdit({
    sources: [{ path: "Tasks.md", line: 0 }],
    add: [{ path: "Tasks.md", blockId: "target" }],
    linkedFromLinesEnabled: false,
  });
  assert.equal(outcome.ok, true);
  assert.match(editor.getValue(), /🪢 \*\*LINKS:\*\*/);
  assert.doesNotMatch(editor.getValue(), /LINKED FROM/);
  assert.equal(editor.getValue().split("\n")[0].includes("^"), false);
});

test("api.relations v1: removeLink works and openStage settles false without a plugin", async () => {
  const api = helpers.createRelationsNavApi(null);
  assert.equal(api.version, 1);
  const opened = await api.openStage({ path: "Tasks.md", line: 0, direction: "to" });
  assert.equal(opened.ok, false);
  const missing = await api.removeLink({}, {});
  assert.equal(missing.ok, false);

  const source = [
    "- [ ] #task Source ^source",
    "  - 🪢 **LINKS:** [[Other#^target]]",
  ].join("\n");
  const harness = makePlugin({
    "Tasks.md": source,
    "Other.md": "- [ ] #task Target ^target\n  - 🪢 **LINKED FROM:** [[Tasks#^source]]",
  });
  const editor = new TestEditor(source);
  harness.openEditors.set("Tasks.md", editor);
  const pluginApi = helpers.createRelationsNavApi(harness.plugin);
  const removed = await pluginApi.removeLink(
    { path: "Tasks.md", line: 0, blockId: "source" },
    { path: "Other.md", blockId: "target" },
  );
  assert.equal(removed.ok, true);
  assert.doesNotMatch(editor.getValue(), /\*\*LINKS:\*\*/);
});

test("createDependencyNavApi mounts relations beside blocks", () => {
  const api = helpers.createDependencyNavApi(null);
  assert.equal(api.relations.version, 1);
  assert.equal(typeof api.relations.removeLink, "function");
  assert.equal(typeof api.relations.openStage, "function");
});

test("LG10: hand-edited LINKS mirrors to LINKED FROM and re-fires after undo", async () => {
  const before = [
    "- [ ] #task Source ^source",
    "- [ ] #task Target ^target",
  ].join("\n");
  const after = [
    "- [ ] #task Source ^source",
    "  - 🪢 **LINKS:** follow-up of [[#^target]]",
    "- [ ] #task Target ^target",
  ].join("\n");
  const harness = makePlugin({ "Tasks.md": before });
  const editor = new TestEditor(after);
  harness.openEditors.set("Tasks.md", editor);
  const mirrored = await harness.plugin.mirrorDependencyHandEdit(
    editor,
    "Tasks.md",
    before,
    0,
    "",
    { baselineLine: 0 },
  );
  assert.equal(mirrored.mirrored, true);
  assert.equal(editor.lastAnnotation, helpers.RELATIONS_MACHINE_WRITE_ANNOTATION);
  assert.match(editor.getValue(), /LINKED FROM:\*\* \[\[#\^source\]\] \(follow-up of\)/);

  // Undo removes the authored edge. The next cursor-leave reconciliation
  // sees that inverse delta and removes the generated source line again.
  editor.content = before;
  const undone = await harness.plugin.mirrorDependencyHandEdit(
    editor,
    "Tasks.md",
    after,
    0,
    "",
    { baselineLine: 0 },
  );
  assert.equal(undone.mirrored, true);
  assert.doesNotMatch(editor.getValue(), /LINKED FROM/);
});

test("LG11: hand-editing generated LINKED FROM only shows its notice", async () => {
  const before = [
    "- [ ] #task Source ^source",
    "- [ ] #task Target ^target",
  ].join("\n");
  const after = [
    "- [ ] #task Source ^source",
    "- [ ] #task Target ^target",
    "  - 🪢 **LINKED FROM:** [[#^source]]",
  ].join("\n");
  const harness = makePlugin({ "Tasks.md": before });
  const editor = new TestEditor(after);
  harness.openEditors.set("Tasks.md", editor);
  notices.length = 0;
  const outcome = await harness.plugin.mirrorDependencyHandEdit(
    editor,
    "Tasks.md",
    before,
    1,
    "",
    { baselineLine: 1 },
  );
  assert.equal(outcome.mirrored, false);
  assert.match(notices.join("\n"), /LINKED FROM is generated/);
  assert.doesNotMatch(editor.getValue(), /LINKS:/);
});

test("LG9: Ctrl+D's writer clears outgoing links and their generated mirrors", async () => {
  const source = [
    "- [ ] #task Source ^source",
    "  - 🪢 **LINKS:** see [[Other#^target]] • [[Other#^second]]",
  ].join("\n");
  const harness = makePlugin({
    "Tasks.md": source,
    "Other.md": [
      "- [ ] #task Target ^target",
      "  - 🪢 **LINKED FROM:** [[Tasks#^source]] (see)",
      "- [ ] #task Second ^second",
      "  - 🪢 **LINKED FROM:** [[Tasks#^source]]",
    ].join("\n"),
  });
  const editor = new TestEditor(source);
  harness.openEditors.set("Tasks.md", editor);
  const cleared = await harness.plugin.removeAllRelationLinksByRef({
    path: "Tasks.md",
    line: 0,
    blockId: "source",
  });
  assert.equal(cleared.ok, true);
  assert.equal(cleared.removed, 2);
  assert.doesNotMatch(editor.getValue(), /LINKS/);
  assert.doesNotMatch(harness.store.get("Other.md"), /LINKED FROM/);
});
