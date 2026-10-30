// Nav §19 text mentions: reserved 💬 label, mentions switch, Task Card
// counts, Linked-from stage rows, courtesy write, and unlink downgrade
// (bob-cli-e8.8; docs/task-relations.md §19 copy table).
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const notices = [];
const originalLoad = Module._load;
function loadWithObsidianStubs(request, parent, isMain) {
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
}
Module._load = loadWithObsidianStubs;
const NavigationHotkeysPlugin = require("../plugins/bob-navigation-hotkeys/main.js");
const { helpers } = NavigationHotkeysPlugin;
Module._load = originalLoad;

function resetNotices() {
  notices.length = 0;
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
    plugins: { plugins: {} },
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

function stubRelationIndex(plugin, options = {}) {
  const api = {
    version: options.version === undefined ? 2 : options.version,
    ready: () => true,
    scanMentions: options.scanMentions || (() => []),
    linkedFrom: options.linkedFrom || (() => []),
    incoming: options.incoming || (() => []),
    labelSuggestions: () => [],
  };
  plugin.app.plugins = {
    plugins: { "bob-ledger-tools": { api: { relationIndex: api } } },
  };
  return api;
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

function mentionPair(overrides = {}) {
  return {
    sourceKey: "Tasks.md:2",
    targetKey: "Tasks.md\u0000target",
    source: {
      path: "Tasks.md",
      blockId: "",
      line: 1,
      text: "- [ ] #task Source says things",
      status: " ",
    },
    target: { path: "Tasks.md", blockId: "target" },
    display: "mention",
    count: 1,
    occurrences: [
      { line: 2, ch: 20, site: "note", excerpt: "Merged into ⟦this task⟧" },
    ],
    ...overrides,
  };
}

test("MN15: 💬-first labels are reserved in every nav label path", () => {
  assert.equal(helpers.normalizeRelationLabel("💬 mentions"), null);
  assert.equal(helpers.normalizeRelationLabel("💬 other"), null);
  assert.equal(helpers.normalizeRelationLabel("see also"), "see also");
  assert.equal(
    helpers.describeRelationLabelRefusal("💬 mentions"),
    "💬 is reserved for text mentions",
  );
  assert.equal(
    helpers.describeRelationLabelRefusal("💬 other"),
    "💬 is reserved for text mentions",
  );
  assert.equal(helpers.describeRelationLabelRefusal("see also"), null);
  assert.deepEqual(helpers.normalizeOptionalRelationLabel("💬 x"), {
    ok: false,
    reason: "reserved",
  });
});

test("MN15/MN16: LINKS rejects 💬 labels; LINKED FROM keeps only 💬 mentions", () => {
  const links = helpers.parseLinksLine(
    "- 🪢 **LINKS:** duplicate of [[#^a]] • 💬 mentions [[#^b]]",
    { isDirectChildOfTask: true },
  );
  assert.equal(links.verdict, "malformed");
  const linksAlias = helpers.parseLinksLine("- 🪢 **LINKS:** [[#^a|💬 hi]]", {
    isDirectChildOfTask: true,
  });
  assert.equal(linksAlias.verdict, "malformed");
  const mention = helpers.parseLinkedFromLine(
    "- 🪢 **LINKED FROM:** [[#^a]] (💬 mentions)",
    { isDirectChildOfTask: true },
  );
  assert.equal(mention.verdict, "accept");
  assert.equal(mention.entries[0].label, "💬 mentions");
  const other = helpers.parseLinkedFromLine(
    "- 🪢 **LINKED FROM:** [[#^a]] (💬 other)",
    { isDirectChildOfTask: true },
  );
  assert.equal(other.verdict, "malformed");
});

test("MN15: planLinksEdit refuses 💬 labels as reserved", () => {
  const planned = helpers.planLinksEdit("- [ ] #task T ^t", 0, {
    add: [{ link: "[[#^a]]", label: "💬 mentions" }],
  });
  assert.equal(planned.ok, false);
  assert.equal(planned.reason, "invalid-label");
  assert.equal(planned.labelReason, "reserved");
});

test("MN15: applyRelationEdit surfaces the reserved-label message", async () => {
  const harness = makePlugin({
    "Tasks.md": "- [ ] #task Source ^source\n- [ ] #task Target ^target",
  });
  const outcome = await harness.plugin.applyRelationEdit({
    sources: [{ path: "Tasks.md", line: 0, blockId: "source" }],
    add: [{ path: "Tasks.md", blockId: "target", label: "💬 mentions" }],
    linkedFromLinesEnabled: true,
    linkedFromMentionsEnabled: true,
    cancelLabels: { keys: [], labels: {} },
    completeLabels: { keys: [], labels: {} },
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, "invalid-label");
  assert.equal(outcome.notice, "💬 is reserved for text mentions");
});

test("mentions kill switch defaults on, honors false, and warns invalid", () => {
  helpers.resetRelationsLinkedFromMentionsConfigCache();
  const makeFs = (contents) => ({
    statSync: () => ({ mtimeMs: 10, size: contents.length }),
    readFileSync: () => contents,
  });
  const parse = (value) => ({
    relations: { linked_from_mentions: value },
  });
  assert.equal(
    helpers.loadRelationsLinkedFromMentionsEnabled({
      configPath: "/test/config",
      fsModule: makeFs("x"),
      parseYaml: () => parse(true),
    }),
    true,
  );
  helpers.resetRelationsLinkedFromMentionsConfigCache();
  assert.equal(
    helpers.loadRelationsLinkedFromMentionsEnabled({
      configPath: "/test/config",
      fsModule: { statSync: () => null, readFileSync: () => { throw Object.assign(new Error("no"), { code: "ENOENT" }); } },
      parseYaml: parse,
    }),
    true,
  );
  helpers.resetRelationsLinkedFromMentionsConfigCache();
  assert.equal(
    helpers.loadRelationsLinkedFromMentionsEnabled({
      configPath: "/test/config",
      fsModule: makeFs("x"),
      parseYaml: () => parse("yes"),
    }),
    true,
  );
});

function taskCardSummary(rows, version = 2) {
  const harness = makePlugin({});
  stubRelationIndex(harness.plugin, {
    version,
    incoming: () => rows.filter((row) => !row || row.kind !== "mention"),
    linkedFrom: () => rows,
  });
  return helpers.taskCardLinkedFromSummary(
    {
      valid: true,
      type: "single",
      targets: [{ path: "Tasks.md", rawLine: "- [ ] #task T ^t" }],
    },
    { app: harness.plugin.app, filePath: "Tasks.md" },
  );
}

function relationRow(name, label = "duplicate of") {
  return {
    kind: "relation",
    source: { path: "A.md", blockId: "s1", line: 1, text: `- [ ] #task ${name}` },
    label,
    alsoMentioned: false,
  };
}

function mentionRow(name, display = "mention") {
  return {
    kind: "mention",
    source: { path: "B.md", blockId: "s2", line: 4, text: `- [ ] #task ${name}` },
    display,
    count: 2,
    occurrences: [{ line: 5, ch: 3, site: "note", excerpt: `Says ⟦this task⟧ twice` }],
  };
}

test("Task Card count: relations-only keeps N · first name", () => {
  const summary = taskCardSummary([relationRow("Alpha"), relationRow("Beta", "see also")]);
  assert.equal(summary.count, 2);
  assert.equal(summary.detail, "2 · Alpha");
});

test("Task Card count: v1 index keeps N · first name", () => {
  const summary = taskCardSummary([relationRow("Alpha")], 1);
  assert.equal(summary.count, 1);
  assert.equal(summary.detail, "1 · Alpha");
});

test("Task Card count: mentions-only reads M 💬 · first name", () => {
  const summary = taskCardSummary([mentionRow("Gamma")]);
  assert.equal(summary.count, 1);
  assert.equal(summary.detail, "1 💬 · Gamma");
});

test("Task Card count: both reads N · R relation(s) · M 💬", () => {
  const single = taskCardSummary([relationRow("Alpha"), mentionRow("G1"), mentionRow("G2")]);
  assert.equal(single.count, 3);
  assert.equal(single.detail, "3 · 1 relation · 2 💬");
  const plural = taskCardSummary([relationRow("A"), relationRow("B"), mentionRow("G1")]);
  assert.equal(plural.count, 3);
  assert.equal(plural.detail, "3 · 2 relations · 1 💬");
});

test("Linked-from stage: v2 rows map to relation + mention CURRENT rows", () => {
  const edges = [
    {
      source: { path: "A.md", blockId: "s1", line: 1, text: "- [ ] #task Alpha" },
      label: "duplicate of",
    },
    mentionRow("Gamma"),
  ];
  const rows = helpers.relationStageIncomingRowsFromEdges(edges, null, "");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].label, "duplicated by");
  assert.equal(rows[0].mention, undefined);
  const mention = rows[1];
  assert.equal(mention.mention, true);
  assert.equal(mention.mentionPill, "💬 mentioned in");
  assert.equal(mention.mentionDisplay, "mention");
  assert.equal(mention.mentionCount, 2);
  assert.equal(mention.mentionExcerpt, "Says ⟦this task⟧ twice");
  assert.equal(mention.note, "B");
  assert.equal(mention.label, null);
  const embed = helpers.relationStageIncomingRowsFromEdges(
    [mentionRow("Delta", "embed")],
    null,
    "",
  )[0];
  assert.equal(embed.mentionPill, "💬 embedded in");
});

test("Linked-from stage: view keeps mention rows CURRENT and already linked", () => {
  const current = helpers.relationStageIncomingRowsFromEdges([mentionRow("Gamma")], null, "");
  const items = helpers.planLinkedFromStageView({
    sources: [{ path: "T.md", line: 0, blockId: "t" }],
    current,
    candidates: [],
    query: "",
    linkedKeys: new Set([helpers.relationStageRowKey("B.md", "s2")]),
    previousDailyPath: "",
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].mention, true);
  assert.equal(items[0].stageSection, "current");
  assert.equal(items[0].alreadyLinked, true);
});

test("Linked-from stage: decorate prefers linkedFrom v2 over incoming", () => {
  const notes = {
    "Tasks.md": "- [ ] #task Target ^target",
    "B.md": "- [ ] #task Gamma ^s2",
  };
  const harness = makePlugin(notes);
  const buildStage = () => harness.plugin.buildVaultRelationStage({
    filePath: "Tasks.md",
    content: notes["Tasks.md"],
    parentLines: [0],
    direction: "from",
  });
  stubRelationIndex(harness.plugin, {
    version: 1,
    incoming: () => [
      {
        source: { path: "B.md", blockId: "s2", line: 1, text: "- [ ] #task Gamma ^s2" },
        label: "duplicate of",
      },
    ],
  });
  const v1 = buildStage();
  assert.equal(v1.current.length, 1);
  assert.equal(v1.current[0].mention, undefined);
  stubRelationIndex(harness.plugin, {
    version: 2,
    incoming: () => {
      throw new Error("v1 must not be read when v2 is available");
    },
    linkedFrom: () => [mentionRow("Gamma")],
  });
  const v2 = buildStage();
  assert.equal(v2.current.length, 1);
  assert.equal(v2.current[0].mention, true);
  assert.equal(v2.current[0].mentionPill, "💬 mentioned in");
  assert.equal(v2.current[0].mentionExcerpt, "Says ⟦this task⟧ twice");
});

test("Linked-from stage: footer hints follow the mention row kind", () => {
  const notes = { "Tasks.md": "- [ ] #task T ^t" };
  const harness = makePlugin(notes);
  const picker = makeRelationPicker(
    harness.plugin,
    "from",
    [{ path: "Tasks.md", line: 0, blockId: "t" }],
    notes,
  );
  const mention = {
    kind: "local-task",
    mention: true,
    stageSection: "current",
    alreadyLinked: true,
  };
  picker.visibleItems = [mention, { kind: "local-task", stageSection: "results" }];
  picker.selectedIndex = 0;
  const hints = picker.getRelationStageFooterHints();
  assert.deepEqual(hints.map((hint) => hint.label), [
    "navigate",
    "open mention",
    "add relation",
    "flip direction",
    "dismiss",
  ]);
  picker.selectedIndex = 1;
  assert.ok(
    picker.getRelationStageFooterHints().some((hint) => hint.label === "link here"),
  );
});

test("Linked-from stage: consequence strip names the mention gesture", () => {
  assert.equal(
    helpers.relationStageConsequenceStrip(
      { mention: true, stageSection: "current" },
      { marked: [], direction: "from" },
    ),
    "↵ opens it in its note · ⇧↵ adds a relation",
  );
});

test("MN19: ↵ on a mention row opens the source at the occurrence", async () => {
  const notes = { "Tasks.md": "- [ ] #task T ^t" };
  const harness = makePlugin(notes);
  const picker = makeRelationPicker(
    harness.plugin,
    "from",
    [{ path: "Tasks.md", line: 0, blockId: "t" }],
    notes,
  );
  const calls = [];
  harness.plugin.openRelationMentionSource = async (row, ownerPath) => {
    calls.push([row, ownerPath]);
    return true;
  };
  const item = { mention: true, path: "B.md", blockId: "s2" };
  assert.equal(await picker.chooseRelationTask(item), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], item);
  assert.equal(calls[0][1], "Tasks.md");
});

test("Linked-from stage: ⇧↵ on a mention row adds a relation for the source", async () => {
  const notes = { "Tasks.md": "- [ ] #task T ^t" };
  const harness = makePlugin(notes);
  const picker = makeRelationPicker(
    harness.plugin,
    "from",
    [{ path: "Tasks.md", line: 0, blockId: "t" }],
    notes,
  );
  const calls = [];
  picker.showRelationLabelStage = (targets, options) => {
    calls.push([targets, options]);
    return true;
  };
  const item = { mention: true, path: "B.md", blockId: "s2" };
  assert.equal(await picker.chooseRelationTask(item, { withLabel: true }), true);
  assert.deepEqual(calls, [[[item], { mode: "add" }]]);
});

test("Linked-from stage: toggling a mention row is refused with the notice", async () => {
  resetNotices();
  const notes = { "Tasks.md": "- [ ] #task T ^t" };
  const harness = makePlugin(notes);
  const picker = makeRelationPicker(
    harness.plugin,
    "from",
    [{ path: "Tasks.md", line: 0, blockId: "t" }],
    notes,
  );
  let committed = false;
  harness.plugin.applyRelationEdit = async () => {
    committed = true;
    return { ok: true };
  };
  const item = {
    mention: true,
    stageSection: "current",
    alreadyLinked: true,
    path: "B.md",
    blockId: "s2",
    displayText: "Gamma task",
  };
  assert.equal(
    await picker.commitRelationEdit({ add: [], remove: [item], relabel: [] }),
    false,
  );
  assert.equal(committed, false);
  assert.deepEqual(notices, [
    "💬 This comes from a link in “Gamma task”'s text · edit it there (↵ opens it)",
  ]);
});

const MENTION_FLAGS = { linesEnabled: true, mentionsEnabled: true };

test("MN18: courtesy write mints the source and mirrors same-note (💬 mentions)", async () => {
  const before = [
    "- [ ] #task Source says things",
    "- [ ] #task Target lands here ^target",
  ].join("\n");
  const after = [
    "- [ ] #task Source says things",
    "  - Merged into [[#^target]]",
    "- [ ] #task Target lands here ^target",
  ].join("\n");
  const harness = makePlugin({ "Tasks.md": before });
  stubRelationIndex(harness.plugin, {
    scanMentions: (content) =>
      String(content).includes("Merged into") ? [mentionPair()] : [],
  });
  const editor = new TestEditor(after);
  harness.openEditors.set("Tasks.md", editor);
  const outcome = await harness.plugin.mirrorMentionHandEdit(
    editor,
    "Tasks.md",
    before,
    MENTION_FLAGS,
  );
  assert.equal(outcome.mirrored, true);
  const lines = editor.getValue().split("\n");
  const minted = (lines[0].match(/\^([A-Za-z0-9-]+)/) || [])[1];
  assert.ok(minted, "id-less source is minted");
  assert.match(
    editor.getValue(),
    new RegExp(`LINKED FROM.*\\[\\[#\\^${minted}\\]\\] \\(💬 mentions\\)`),
  );
});

test("MN18: courtesy write mirrors cross-note targets through a follow-up", async () => {
  const before = "- [ ] #task Source says things";
  const after = "- [ ] #task Source says things\n  - See [[Other#^target]]";
  const harness = makePlugin({
    "Tasks.md": before,
    "Other.md": "- [ ] #task Target lands here ^target",
  });
  stubRelationIndex(harness.plugin, {
    scanMentions: (content) =>
      String(content).includes("See [[Other") ? [mentionPair({
        sourceKey: "Tasks.md:1",
        targetKey: "Other.md\u0000target",
        source: { path: "Tasks.md", blockId: "", line: 1, text: "- [ ] #task Source says things", status: " " },
        target: { path: "Other.md", blockId: "target" },
        occurrences: [{ line: 2, ch: 8, site: "note", excerpt: "See ⟦this task⟧" }],
      })] : [],
  });
  const editor = new TestEditor(after);
  harness.openEditors.set("Tasks.md", editor);
  const outcome = await harness.plugin.mirrorMentionHandEdit(
    editor,
    "Tasks.md",
    before,
    MENTION_FLAGS,
  );
  assert.equal(outcome.mirrored, true);
  const minted = (editor.getValue().split("\n")[0].match(/\^([A-Za-z0-9-]+)/) || [])[1];
  assert.ok(minted, "id-less source is minted");
  assert.match(
    harness.store.get("Other.md"),
    new RegExp(`LINKED FROM.*\\[\\[Tasks#\\^${minted}\\]\\] \\(💬 mentions\\)`),
  );
});

test("MN18: courtesy write removes the entry when the link is deleted", async () => {
  const before = [
    "- [ ] #task Source says ^source",
    "  - Merged into [[#^target]]",
    "- [ ] #task Target lands here ^target",
    "  - 🪢 **LINKED FROM:** [[#^source]] (💬 mentions)",
  ].join("\n");
  const after = [
    "- [ ] #task Source says ^source",
    "- [ ] #task Target lands here ^target",
    "  - 🪢 **LINKED FROM:** [[#^source]] (💬 mentions)",
  ].join("\n");
  const harness = makePlugin({ "Tasks.md": before });
  const pair = mentionPair({
    sourceKey: "Tasks.md#^source",
    source: { path: "Tasks.md", blockId: "source", line: 1, text: "- [ ] #task Source says ^source", status: " " },
    occurrences: [{ line: 2, ch: 16, site: "note", excerpt: "Merged into ⟦this task⟧" }],
  });
  stubRelationIndex(harness.plugin, {
    scanMentions: (content) => (String(content).includes("Merged into") ? [pair] : []),
  });
  const editor = new TestEditor(after);
  harness.openEditors.set("Tasks.md", editor);
  const outcome = await harness.plugin.mirrorMentionHandEdit(
    editor,
    "Tasks.md",
    before,
    MENTION_FLAGS,
  );
  assert.equal(outcome.mirrored, true);
  assert.doesNotMatch(editor.getValue(), /💬 mentions/);
});

test("M7: courtesy write suppresses the mention when a dependency joins the pair", async () => {
  const before = [
    "- [ ] #task Source says things",
    "- [ ] #task Target lands here ^target",
  ].join("\n");
  const after = [
    "- [ ] #task Source says things",
    "  - Merged into [[#^target]]",
    "  - ⛓️ **DEPENDS ON:** [[#^target]]",
    "- [ ] #task Target lands here ^target",
  ].join("\n");
  const harness = makePlugin({ "Tasks.md": before });
  stubRelationIndex(harness.plugin, {
    scanMentions: (content) =>
      String(content).includes("Merged into") ? [mentionPair()] : [],
  });
  const editor = new TestEditor(after);
  harness.openEditors.set("Tasks.md", editor);
  const outcome = await harness.plugin.mirrorMentionHandEdit(
    editor,
    "Tasks.md",
    before,
    MENTION_FLAGS,
  );
  assert.equal(outcome.mirrored, false);
  assert.doesNotMatch(editor.getValue(), /LINKED FROM/);
  assert.doesNotMatch(editor.getValue().split("\n")[0], /\^[A-Za-z0-9-]+/);
});

test("MN7/MN16: relation wins — courtesy write replaces a stale mention entry", async () => {
  const before = [
    "- [ ] #task Source says ^source",
    "  - Merged into [[#^target]]",
    "- [ ] #task Target lands here ^target",
    "  - 🪢 **LINKED FROM:** [[#^source]] (💬 mentions)",
  ].join("\n");
  const after = [
    "- [ ] #task Source says ^source",
    "  - 🪢 **LINKS:** duplicate of [[#^target]]",
    "  - Merged into [[#^target]]",
    "- [ ] #task Target lands here ^target",
    "  - 🪢 **LINKED FROM:** [[#^source]] (💬 mentions)",
  ].join("\n");
  const harness = makePlugin({ "Tasks.md": before });
  const pair = mentionPair({
    sourceKey: "Tasks.md#^source",
    source: { path: "Tasks.md", blockId: "source", line: 1, text: "- [ ] #task Source says ^source", status: " " },
    occurrences: [{ line: 3, ch: 16, site: "note", excerpt: "Merged into ⟦this task⟧" }],
  });
  stubRelationIndex(harness.plugin, {
    scanMentions: (content) => (String(content).includes("Merged into") ? [pair] : []),
  });
  const editor = new TestEditor(after);
  harness.openEditors.set("Tasks.md", editor);
  const outcome = await harness.plugin.mirrorMentionHandEdit(
    editor,
    "Tasks.md",
    before,
    MENTION_FLAGS,
  );
  assert.equal(outcome.mirrored, true);
  assert.match(editor.getValue(), /\[\[#\^source\]\] \(duplicate of\)/);
  assert.doesNotMatch(editor.getValue(), /💬 mentions/);
});

test("courtesy write keeps existing entries on uncertainty and writes nothing", async () => {
  const before = [
    "- [ ] #task Source says ^source",
    "  - Merged into [[#^target]]",
    "- [ ] #task Target lands here ^target",
    "  - 🪢 **LINKED FROM:** [[#^source]] (💬 mentions)",
  ].join("\n");
  const after = [
    "- [ ] #task Source says ^source",
    "  - 🪢 **LINKS:** [[#^target]] trailing prose",
    "- [ ] #task Target lands here ^target",
    "  - 🪢 **LINKED FROM:** [[#^source]] (💬 mentions)",
  ].join("\n");
  const harness = makePlugin({ "Tasks.md": before });
  const pair = mentionPair({
    sourceKey: "Tasks.md#^source",
    source: { path: "Tasks.md", blockId: "source", line: 1, text: "- [ ] #task Source says ^source", status: " " },
  });
  stubRelationIndex(harness.plugin, {
    scanMentions: (content) => (String(content).includes("Merged into") ? [pair] : []),
  });
  const editor = new TestEditor(after);
  harness.openEditors.set("Tasks.md", editor);
  const outcome = await harness.plugin.mirrorMentionHandEdit(
    editor,
    "Tasks.md",
    before,
    MENTION_FLAGS,
  );
  assert.equal(outcome.mirrored, false);
  assert.match(editor.getValue(), /\[\[#\^source\]\] \(💬 mentions\)/);
});

test("courtesy write skips without a v2 index or with the switch off", async () => {
  const before = "- [ ] #task Source";
  const after = "- [ ] #task Source\n  - Merged into [[#^target]]";
  const plain = makePlugin({ "Tasks.md": before });
  stubRelationIndex(plain.plugin, { version: 1, scanMentions: () => [mentionPair()] });
  const editor = new TestEditor(after);
  plain.openEditors.set("Tasks.md", editor);
  const noApi = await plain.plugin.mirrorMentionHandEdit(editor, "Tasks.md", before, MENTION_FLAGS);
  assert.equal(noApi.mirrored, false);
  assert.equal(noApi.reason, "no-index-api");
  const gated = makePlugin({ "Tasks.md": before });
  stubRelationIndex(gated.plugin, { scanMentions: () => [mentionPair()] });
  const gatedEditor = new TestEditor(after);
  gated.openEditors.set("Tasks.md", gatedEditor);
  const off = await gated.plugin.mirrorMentionHandEdit(gatedEditor, "Tasks.md", before, {
    linesEnabled: true,
    mentionsEnabled: false,
  });
  assert.equal(off.mirrored, false);
  assert.equal(off.reason, "switch-off");
  assert.equal(gatedEditor.getValue(), after);
});

test("hand-edit LINKS removal downgrades via the touched-source path", async () => {
  // mirrorRelationHandEdit already replaced T's entry with the removal; the
  // courtesy write sees the touched source and restores the mention entry.
  const before = [
    "- [ ] #task Source says ^source",
    "  - 🪢 **LINKS:** duplicate of [[#^target]]",
    "  - Merged into [[#^target]]",
    "- [ ] #task Target lands ^target",
    "  - 🪢 **LINKED FROM:** [[#^source]] (duplicate of)",
  ].join("\n");
  const after = [
    "- [ ] #task Source says ^source",
    "  - Merged into [[#^target]]",
    "- [ ] #task Target lands ^target",
  ].join("\n");
  const harness = makePlugin({ "Tasks.md": before });
  const pair = mentionPair({
    sourceKey: "Tasks.md#^source",
    source: { path: "Tasks.md", blockId: "source", line: 1, text: "- [ ] #task Source says ^source", status: " " },
    occurrences: [{ line: 2, ch: 16, site: "note", excerpt: "Merged into ⟦this task⟧" }],
  });
  stubRelationIndex(harness.plugin, {
    scanMentions: (content) => (String(content).includes("Merged into") ? [pair] : []),
  });
  const editor = new TestEditor(after);
  harness.openEditors.set("Tasks.md", editor);
  const outcome = await harness.plugin.mirrorMentionHandEdit(
    editor,
    "Tasks.md",
    before,
    MENTION_FLAGS,
  );
  assert.equal(outcome.mirrored, true);
  assert.match(editor.getValue(), /\[\[#\^source\]\] \(💬 mentions\)/);
});

test("fireDependencyHandEditMirror runs the mention convergence after mirrors", async () => {
  const before = "- [ ] #task Source says ^source";
  const after = "- [ ] #task Source says ^source\n  - Merged into [[#^target]]";
  const harness = makePlugin({ "Tasks.md": before });
  const editor = new TestEditor(after);
  harness.openEditors.set("Tasks.md", editor);
  const calls = [];
  harness.plugin.mirrorMentionHandEdit = async (...args) => {
    calls.push(args);
    return Object.freeze({ mirrored: false, reason: "unchanged" });
  };
  await harness.plugin.fireDependencyHandEditMirror({
    editor,
    parentPath: "Tasks.md",
    oldContent: before,
    ownerLine: 0,
    editedLine: 1,
    removedText: "",
    baselineEditedLine: 1,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], editor);
  assert.equal(calls[0][1], "Tasks.md");
  assert.equal(calls[0][2], before);
});

const DOWNGRADE_LABELS = {
  cancelLabels: { keys: [], labels: {} },
  completeLabels: { keys: [], labels: {} },
  cancelDate: "2026-10-03",
  linkedFromLinesEnabled: true,
  linkedFromMentionsEnabled: true,
};

function downgradeHarness() {
  const notes = {
    "Tasks.md": [
      "- [ ] #task Source says ^source",
      "  - 🪢 **LINKS:** duplicate of [[#^target]]",
      "  - Merged into [[#^target]]",
      "- [ ] #task Target lands ^target",
      "  - 🪢 **LINKED FROM:** [[#^source]] (duplicate of)",
    ].join("\n"),
  };
  const harness = makePlugin(notes);
  stubRelationIndex(harness.plugin, {
    scanMentions: (content) =>
      String(content).includes("Merged into")
        ? [
            mentionPair({
              sourceKey: "Tasks.md#^source",
              source: { path: "Tasks.md", blockId: "source", line: 1, text: "- [ ] #task Source says ^source", status: " " },
              occurrences: [{ line: 3, ch: 16, site: "note", excerpt: "Merged into ⟦this task⟧" }],
            }),
          ]
        : [],
  });
  return harness;
}

test("unlink downgrade: removeLink keeps (💬 mentions) with the unlink notice", async () => {
  const harness = downgradeHarness();
  const outcome = await harness.plugin.applyRelationEdit({
    sources: [{ path: "Tasks.md", line: 0, blockId: "source" }],
    add: [],
    remove: [{ path: "Tasks.md", blockId: "target" }],
    ...DOWNGRADE_LABELS,
  });
  assert.equal(outcome.ok, true);
  const next = harness.store.get("Tasks.md");
  assert.doesNotMatch(next, /LINKS:/);
  assert.match(next, /\[\[#\^source\]\] \(💬 mentions\)/);
  assert.equal(
    outcome.relationNotice,
    "Unlinked “Source says” · it still mentions this task in its text",
  );
});

test("unlink without a mention removes the entry with the plain notice", async () => {
  const harness = downgradeHarness();
  harness.plugin.app.plugins.plugins["bob-ledger-tools"].api.relationIndex.scanMentions = () => [];
  const outcome = await harness.plugin.applyRelationEdit({
    sources: [{ path: "Tasks.md", line: 0, blockId: "source" }],
    add: [],
    remove: [{ path: "Tasks.md", blockId: "target" }],
    ...DOWNGRADE_LABELS,
  });
  assert.equal(outcome.ok, true);
  const next = harness.store.get("Tasks.md");
  assert.doesNotMatch(next, /LINKED FROM/);
  assert.equal(outcome.relationNotice, "🪢 Unlinked “Target lands”");
});

test("Links-to Ctrl+D downgrades the mentioned target and removes the other", async () => {
  const notes = {
    "Tasks.md": [
      "- [ ] #task Source says ^source",
      "  - 🪢 **LINKS:** duplicate of [[#^one]] • see also [[#^two]]",
      "  - Merged into [[#^one]]",
      "- [ ] #task First lands ^one",
      "  - 🪢 **LINKED FROM:** [[#^source]] (duplicate of)",
      "- [ ] #task Second lands ^two",
      "  - 🪢 **LINKED FROM:** [[#^source]] (see also)",
    ].join("\n"),
  };
  const harness = makePlugin(notes);
  stubRelationIndex(harness.plugin, {
    scanMentions: (content) =>
      String(content).includes("Merged into")
        ? [
            mentionPair({
              sourceKey: "Tasks.md#^source",
              targetKey: "Tasks.md\u0000one",
              source: { path: "Tasks.md", blockId: "source", line: 1, text: "- [ ] #task Source says ^source", status: " " },
              target: { path: "Tasks.md", blockId: "one" },
              occurrences: [{ line: 3, ch: 16, site: "note", excerpt: "Merged into ⟦this task⟧" }],
            }),
          ]
        : [],
  });
  const outcome = await harness.plugin.removeAllRelationLinksByRef(
    { path: "Tasks.md", line: 0, blockId: "source" },
    { linkedFromLinesEnabled: true, linkedFromMentionsEnabled: true },
  );
  assert.equal(outcome.ok, true);
  assert.equal(outcome.removed, 2);
  const next = harness.store.get("Tasks.md");
  assert.doesNotMatch(next, /LINKS:/);
  assert.match(next, /\[\[#\^source\]\] \(💬 mentions\)/);
  assert.doesNotMatch(next, /see also/);
});

test("verify-only: task-status-cycler still treats a mention row as managed", () => {
  Module._load = loadWithObsidianStubs;
  const CyclerPlugin = require("../plugins/task-status-cycler/main.js");
  Module._load = originalLoad;
  const cycler = CyclerPlugin.helpers;
  const line = "  - 🪢 **LINKED FROM:** [[#^old]] (💬 mentions) • followed up by [[#^new]]";
  assert.equal(cycler.isTaskRelationLine(line), true);
  assert.equal(cycler.isTaskLinkExclusionLine(line), true);
  assert.equal(cycler.isTaskLinkGestureLine(line), true);
});

test("verify-only: block-id-prompt still treats a mention row as managed", () => {
  Module._load = loadWithObsidianStubs;
  const PromptPlugin = require("../plugins/block-id-prompt/main.js");
  Module._load = originalLoad;
  const prompt = PromptPlugin.helpers;
  const line = "  - 🪢 **LINKED FROM:** [[#^old]] (💬 mentions)";
  assert.equal(prompt.isTaskRelationLine(line), true);
  assert.equal(prompt.isTaskLinkExclusionLine(line), true);
  assert.equal(prompt.taskRelationLineNotice(line), prompt.TASK_LINKED_FROM_LINE_NOTICE);
  assert.equal(
    prompt.TASK_LINKED_FROM_LINE_NOTICE,
    "🪢 LINKED FROM is generated from other tasks' LINKS lines and text · change it with Ctrl+Shift+Alt+L",
  );
});
