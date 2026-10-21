// Relation chips (ledger-chips). LC vectors come from the approved
// task-relations plan (§10 chips, LC1–LC18); the shared inverse table is
// pinned by scripts/relation-inverse-vectors.cjs.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const editorInfoField = { field: "info" };
const editorLivePreviewField = { field: "live" };
class StubWidgetType {}
class StubRangeSetBuilder {
  constructor() { this.adds = []; }
  add(from, to, value) { this.adds.push({ from, to, value }); }
  finish() { return { adds: this.adds.slice() }; }
}
const StubDecoration = {
  none: { none: true },
  replace: (value) => ({ replace: true, ...value }),
  widget: (value) => ({ widget: true, ...value }),
};
const StubStateEffect = {
  define() {
    const type = {};
    type.of = (value) => ({ value, is: (other) => type === other });
    return type;
  },
};
const StubViewPlugin = { fromClass: (cls, options) => ({ cls, options }) };
class TestMarkdownView {}
class TestPlugin {
  constructor(app) { this.app = app; }
  addCommand(command) { (this.commands ||= []).push(command); }
  registerEditorExtension(extension) { (this.editorExtensions ||= []).push(extension); }
  registerMarkdownPostProcessor(handler, order) { (this.postProcessors ||= []).push({ handler, order }); }
  registerEvent(ref) { (this.registeredEvents ||= []).push(ref); }
  registerInterval(handle) { (this.intervals ||= []).push(handle); return handle; }
}
class TestNotice { constructor(message) { TestNotice.messages.push(String(message)); } }
TestNotice.messages = [];

const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: TestMarkdownView, Notice: TestNotice, Platform: { isDesktopApp: true }, Plugin: TestPlugin,
      normalizePath: (value) => value, parseYaml: (value) => JSON.parse(value),
      editorInfoField, editorLivePreviewField,
    };
  }
  if (request === "@codemirror/state") {
    return { Prec: { highest: (value) => value }, StateEffect: StubStateEffect, RangeSetBuilder: StubRangeSetBuilder };
  }
  if (request === "@codemirror/view") {
    return { EditorView: { updateListener: { of: (value) => value } }, keymap: { of: (value) => value }, ViewPlugin: StubViewPlugin, Decoration: StubDecoration, WidgetType: StubWidgetType };
  }
  if (request === "@codemirror/language") {
    return { syntaxTree: () => ({ resolveInner: () => null }) };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const helpers = LedgerToolsPlugin.helpers;
Module._load = originalLoad;
const inverseVectors = require("./relation-inverse-vectors.cjs");

const {
  relationInversePhrase,
  relationBlockModelForTask,
  buildRelationBlockElement,
  RELATION_INVERSE_PHRASES,
  RELATION_STALE_TOOLTIP,
  RELATION_BLOCK_ROW_TOOLTIP,
} = helpers;

function task({ blockId, id, description = "Task", path = "a.md", status = "TODO", symbol = " ", tags = [], lineNumber }) {
  return {
    id, path, blockLink: blockId ? " ^" + blockId : "", description,
    status: { type: status, symbol }, tags, lineNumber,
  };
}

function lookupFor(tasks, source = "a.md") {
  return (linkpath, blockId) => {
    const targetPath = linkpath ? (linkpath.endsWith(".md") ? linkpath : linkpath + ".md") : source;
    return tasks.find((item) => item.path === targetPath && String(item.blockLink || "").trim().replace(/^\^/, "") === blockId) || null;
  };
}

function resolveFor(source = "a.md") {
  return (linkpath) => {
    const raw = String(linkpath || "").trim();
    if (!raw) return source;
    return raw.endsWith(".md") ? raw : raw + ".md";
  };
}

function edgeTo(target, { label = null, resolved, task = null } = {}) {
  return { label, other: { path: target.path, blockId: target.blockId, resolved: resolved === undefined ? true : resolved, task } };
}

function edgeFrom(source, { label = null, task = null } = {}) {
  return { label, other: { path: source.path, blockId: source.blockId, resolved: true, task } };
}

const OWNER = { blockId: "owner", text: "- [ ] #task Owner ^owner", line: 1 };

function blockFor({ linksText = null, linkedFromText = null, outgoing = [], incoming = [], tasks = [], sourcePath = "a.md", owner = OWNER } = {}) {
  return relationBlockModelForTask({
    sourcePath, owner, linksText, linkedFromText, outgoing, incoming,
    lookup: lookupFor(tasks, sourcePath), resolve: resolveFor(sourcePath),
  });
}

test("LC1 one unlabelled relation renders one links block with no arrow", () => {
  const target = task({ blockId: "t", id: "t", description: "Target" });
  const model = blockFor({
    linksText: "- 🪢 **LINKS:** [[#^t]]", tasks: [target],
    outgoing: [edgeTo({ path: "a.md", blockId: "t" }, { task: target })],
  });
  assert.equal(model.label, "🪢 links");
  assert.equal(model.tooltip, RELATION_BLOCK_ROW_TOOLTIP);
  assert.equal(model.labelled, false);
  assert.equal(model.liveCount, 1);
  assert.equal(model.plain.length, 1);
  assert.equal(model.outgoing.length, 0);
  assert.equal(model.incoming.length, 0);
  const chip = model.plain[0];
  assert.equal(chip.state, "todo");
  assert.equal(chip.symbol, "○");
  assert.equal(chip.text, "Target");
  assert.equal(chip.live, true);
  assert.equal(chip.stale, false);
  assert.equal(chip.relKind, "plain");
  assert.equal(chip.storedOn, "this");
  const doc = new MiniDoc();
  const el = buildRelationBlockElement(doc, model, { mode: "full" });
  assert.ok(el);
  assert.equal(el.attributes["aria-label"], "🪢 links, 1 live");
  assert.match(serializeNode(el), /🪢 links/);
  assert.doesNotMatch(serializeNode(el), /→/);
  assert.equal(findByClass(el, "bob-dep-add").length, 0, "no ＋ without interactive");
});

test("LC2 labelled target carries a pill and an arrow", () => {
  const target = task({ blockId: "t", id: "t", description: "Target" });
  const model = blockFor({
    linksText: "- 🪢 **LINKS:** follow-up of [[#^t]]", tasks: [target],
    outgoing: [edgeTo({ path: "a.md", blockId: "t" }, { label: "follow-up of", task: target })],
  });
  assert.equal(model.labelled, true);
  assert.equal(model.plain.length, 0);
  assert.equal(model.outgoing.length, 1);
  assert.equal(model.outgoing[0].label, "follow-up of");
  assert.equal(model.outgoing[0].inverse, null);
  const doc = new MiniDoc();
  const el = buildRelationBlockElement(doc, model, { mode: "full" });
  const entries = findByClass(el, "bob-relation-entry");
  assert.equal(entries.length, 1);
  assert.match(serializeNode(entries[0]), /follow-up of/);
  assert.match(serializeNode(entries[0]), /→/);
});

test("LC3 closed and archived targets dim without strike; #hide mutes", () => {
  const done = task({ blockId: "d", id: "d", description: "Finished", status: "DONE", symbol: "x" });
  const archived = task({ blockId: "cap", id: "cap", description: "Old", path: "done/bob_done.md", status: "DONE", symbol: "x" });
  const hidden = task({ blockId: "h", id: "h", description: "Quiet", tags: ["#hide"] });
  const model = blockFor({
    linksText: "- 🪢 **LINKS:** [[#^d]] • [[done/bob_done#^cap]] • [[#^h]]",
    tasks: [done, archived, hidden],
    outgoing: [
      edgeTo({ path: "a.md", blockId: "d" }, { task: done }),
      edgeTo({ path: "done/bob_done.md", blockId: "cap" }, { task: archived }),
      edgeTo({ path: "a.md", blockId: "h" }, { task: hidden }),
    ],
  });
  assert.equal(model.plain.length, 3);
  assert.equal(model.plain[0].state, "done");
  assert.equal(model.plain[0].symbol, "✓");
  const cap = model.plain.find((chip) => chip.blockId === "cap");
  assert.equal(cap.archived, true);
  assert.equal(cap.noteLabel, "↗ bob_done");
  const quiet = model.plain.find((chip) => chip.blockId === "h");
  assert.equal(quiet.hidden, true);

  // The element never strikes: no line-through wrapper exists.
  const doc = new MiniDoc();
  const el = buildRelationBlockElement(doc, model, {});
  assert.ok(el);
  assert.equal(findByClass(el, "bob-relation-chip").length, 3);
  const chipsById = new Map(findByClass(el, "bob-relation-chip").map((node) => [node.getAttribute("aria-label").split(" ")[0], node]));
  assert.ok(chipsById.get("Old").className.includes("is-archived"));
  assert.ok(chipsById.get("Quiet").className.includes("is-muted"));
});

test("LC4 unresolvable target is a dashed missing chip", () => {
  const model = blockFor({
    linksText: "- 🪢 **LINKS:** [[missing#^x]]",
    outgoing: [edgeTo({ path: "", blockId: "x" }, { resolved: false })],
  });
  const chip = model.plain[0];
  assert.equal(chip.broken, true);
  assert.equal(chip.symbol, "⚠");
  assert.equal(chip.text, "^x not found");
  assert.match(chip.tooltip, /⚠ \^x not found/);
});

test("LC5 and LC6 incoming statements share the single links heading", () => {
  assert.deepEqual(RELATION_INVERSE_PHRASES, inverseVectors.RELATION_INVERSE_VECTORS);
  for (const [input, expected] of inverseVectors.RELATION_INVERSE_PROBES) {
    assert.equal(relationInversePhrase(input), expected, `inverse of ${JSON.stringify(input)}`);
  }
  const merged = task({ blockId: "m", id: "m", description: "Merged", status: "DONE", symbol: "x" });
  const seen = task({ blockId: "s", id: "s", description: "Seen" });
  const model = blockFor({
    linkedFromText: "- 🪢 **LINKED FROM:** [[#^m]] (merged into) • [[#^s]] (see)",
    tasks: [merged, seen],
    incoming: [
      edgeFrom({ path: "a.md", blockId: "m" }, { label: "merged into", task: merged }),
      edgeFrom({ path: "a.md", blockId: "s" }, { label: "see", task: seen }),
    ],
  });
  assert.equal(model.label, "🪢 links");
  assert.equal(model.incoming.length, 2);
  assert.equal(model.incoming[0].inverse, "merged from");
  assert.equal(model.incoming[0].label, "merged into");
  assert.equal(model.incoming[1].inverse, null);
  assert.equal(model.incoming[1].label, "see");
  const doc = new MiniDoc();
  const el = buildRelationBlockElement(doc, model, { mode: "full" });
  assert.match(serializeNode(el), /merged from/);
  assert.match(serializeNode(el), /→ this/);
});

test("LC7 live edges missing from the text append in canonical order", () => {
  const mkTarget = (blockId, path = "a.md") => task({ blockId, id: blockId, description: "T" + blockId, path });
  const zebra = mkTarget("z");
  const alpha = mkTarget("a");
  const model = blockFor({
    linksText: "- 🪢 **LINKS:**",
    tasks: [zebra, alpha],
    outgoing: [
      edgeTo({ path: "a.md", blockId: "z" }, { task: zebra }),
      edgeTo({ path: "a.md", blockId: "a" }, { task: alpha }),
    ],
  });
  assert.ok(model);
  assert.deepEqual(model.plain.map((chip) => chip.blockId), ["a", "z"]);
  assert.ok(model.plain.every((chip) => chip.live));
});

test("LC8 stored entries that are no longer live are dashed and uncounted", () => {
  const gone = task({ blockId: "gone", id: "gone", description: "Gone" });
  const here = task({ blockId: "here", id: "here", description: "Here" });
  const model = blockFor({
    linkedFromText: "- 🪢 **LINKED FROM:** [[#^gone]] • [[#^here]]",
    tasks: [gone, here],
    incoming: [edgeFrom({ path: "a.md", blockId: "here" }, { task: here })],
  });
  assert.equal(model.incoming.length, 0, "unlabelled incoming renders as plain");
  assert.equal(model.plain.length, 2);
  const live = model.plain.find((chip) => chip.blockId === "here");
  assert.equal(live.live, true);
  const stale = model.plain.find((chip) => chip.blockId === "gone");
  assert.equal(stale.blockId, "gone");
  assert.equal(stale.stale, true);
  assert.equal(stale.live, false);
  assert.match(stale.tooltip, new RegExp(RELATION_STALE_TOOLTIP.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(model.liveCount, 1);
});

test("LC9 three or more closed chips collapse to ✓×N and expand", () => {
  const sources = ["a", "b", "c", "d"].map((id) =>
    task({ blockId: id, id, description: "Source " + id, status: "DONE", symbol: "x" }));
  const model = blockFor({
    linkedFromText: "- 🪢 **LINKED FROM:** " + sources.map((source) => `[[#^${source.id}]]`).join(" • "),
    tasks: sources,
    incoming: sources.map((source) => edgeFrom({ path: "a.md", blockId: source.id }, { task: source })),
  });
  assert.deepEqual(model.collapsed, { count: 4 });
  const doc = new MiniDoc();
  const el = buildRelationBlockElement(doc, model, { mode: "full" });
  const collapsed = findByClass(el, "bob-relation-collapsed");
  assert.equal(collapsed.length, 1);
  assert.match(collapsed[0].childNodes.map((node) => node.textContent).join(""), /✓×4/);
  assert.equal(findByClass(el, "bob-relation-chip").length, 0);
  fire(collapsed[0], "click");
  assert.equal(findByClass(el, "bob-relation-chip").length, 4);
  assert.equal(findByClass(el, "bob-relation-collapsed").length, 0);
});

test("LC10 statements wrap one entry per visual row; plains wrap chipless", () => {
  const first = task({ blockId: "a", id: "a", description: "First" });
  const second = task({ blockId: "b", id: "b", description: "Second" });
  const model = blockFor({
    linksText: "- 🪢 **LINKS:** see [[#^a]] • follow-up of [[#^b]]",
    tasks: [first, second],
    outgoing: [
      edgeTo({ path: "a.md", blockId: "a" }, { label: "see", task: first }),
      edgeTo({ path: "a.md", blockId: "b" }, { label: "follow-up of", task: second }),
    ],
  });
  const doc = new MiniDoc();
  const el = buildRelationBlockElement(doc, model, {});
  assert.ok(el.className.includes("is-labelled"));
  const entries = findByClass(el, "bob-relation-entry");
  assert.equal(entries.length, 2);
  for (const entry of entries) {
    assert.equal(findByClass(entry, "bob-relation-pill").length, 1);
    assert.equal(findByClass(entry, "bob-relation-chip").length, 1);
  }
  const plainTarget = task({ blockId: "p", id: "p", description: "Plain" });
  const plain = blockFor({
    linksText: "- 🪢 **LINKS:** [[#^p]]", tasks: [plainTarget],
    outgoing: [edgeTo({ path: "a.md", blockId: "p" }, { task: plainTarget })],
  });
  const plainEl = buildRelationBlockElement(doc, plain, {});
  assert.equal(findByClass(plainEl, "bob-relation-entry").length, 0);
  assert.equal(findByClass(plainEl, "bob-relation-chip").length, 1);
});

test("LC11 controls need api.relations; v2 unlink and removeStatement win over v1", async () => {
  TestNotice.messages = [];
  const target = task({ blockId: "t", id: "t", description: "Target" });
  const model = blockFor({
    linksText: "- 🪢 **LINKS:** [[#^t]]", tasks: [target],
    outgoing: [edgeTo({ path: "a.md", blockId: "t" }, { task: target })],
  });
  const calls = [];
  const plugin = new LedgerToolsPlugin(makeApp([target], "", makeRelationsNavApi(calls)), {});
  const mini = new MiniDoc();
  const el = buildRelationBlockElement(mini, model, {
    mode: "full",
    sourcePath: "a.md",
    interactive: true,
    onRemove: (chip) => plugin.relationRemoveLink(chip, "a.md", { lineNumber: 1, ownerBlockId: "owner" }),
    onAdd: () => plugin.relationOpenStage("a.md", { lineNumber: 1 }),
  });
  const add = findByClass(el, "bob-dep-add");
  assert.equal(add.length, 1);
  assert.equal(add[0].getAttribute("aria-label"), "Link another task");
  const remove = findByClass(el, "bob-dep-chip-remove");
  assert.equal(remove.length, 1);
  assert.equal(remove[0].getAttribute("aria-label"), "Unlink Target");
  fire(add[0], "click");
  fire(remove[0], "click");
  assert.equal(calls[0][0], "openStage");
  assert.deepEqual(calls[0][1], { path: "a.md", line: 1, direction: "to" });
  assert.equal(calls[1][0], "removeLink");
  assert.deepEqual(calls[1][1], { path: "a.md", line: 1, blockId: "owner" });
  assert.deepEqual(calls[1][2], { path: "a.md", line: null, blockId: "t" });
  await Promise.resolve();
  assert.deepEqual(TestNotice.messages, []);

  // Statement × names the label; with v2 present it removes the record.
  const labelled = blockFor({
    linksText: "- 🪢 **LINKS:** follow-up of [[#^t]]", tasks: [target],
    outgoing: [edgeTo({ path: "a.md", blockId: "t" }, { label: "follow-up of", task: target })],
  });
  const v2calls = [];
  const v2plugin = new LedgerToolsPlugin(makeApp([target], "", makeRelationsNavApi(v2calls, { v2: true })), {});
  const v2el = buildRelationBlockElement(new MiniDoc(), labelled, {
    mode: "full", sourcePath: "a.md", interactive: true,
    onRemove: (chip) => v2plugin.relationRemoveLink(chip, "a.md", { lineNumber: 1, ownerBlockId: "owner" }),
    onAdd: () => {},
  });
  const v2remove = findByClass(v2el, "bob-dep-chip-remove");
  assert.equal(v2remove[0].getAttribute("aria-label"), "Remove 'follow-up of'");
  fire(v2remove[0], "click");
  assert.deepEqual(v2calls[0], ["removeStatement", { path: "a.md", line: 1, blockId: "owner" }, { path: "a.md", line: null, blockId: "t" }]);

  // Plain × with v2 present unlinks the pair.
  const v2plainCalls = [];
  const v2plainPlugin = new LedgerToolsPlugin(makeApp([target], "", makeRelationsNavApi(v2plainCalls, { v2: true })), {});
  const v2plainEl = buildRelationBlockElement(new MiniDoc(), model, {
    mode: "full", sourcePath: "a.md", interactive: true,
    onRemove: (chip) => v2plainPlugin.relationRemoveLink(chip, "a.md", { lineNumber: 1, ownerBlockId: "owner" }),
    onAdd: () => {},
  });
  fire(findByClass(v2plainEl, "bob-dep-chip-remove")[0], "click");
  assert.deepEqual(v2plainCalls[0], ["unlink", { path: "a.md", line: 1, blockId: "owner" }, { path: "a.md", line: null, blockId: "t" }]);

  // Incoming statement × with v1 only removes the peer's record.
  const source = task({ blockId: "s", id: "s", description: "Source", path: "b.md" });
  const fromModel = blockFor({
    linkedFromText: "- 🪢 **LINKED FROM:** [[b#^s]] (merged into)", tasks: [source],
    incoming: [edgeFrom({ path: "b.md", blockId: "s" }, { label: "merged into", task: source })],
  });
  const fromCalls = [];
  const fromPlugin = new LedgerToolsPlugin(makeApp([source], "", makeRelationsNavApi(fromCalls)), {});
  const fromEl = buildRelationBlockElement(new MiniDoc(), fromModel, {
    mode: "full", sourcePath: "a.md", interactive: true,
    onRemove: (chip) => fromPlugin.relationRemoveLink(chip, "a.md", { lineNumber: 1, ownerBlockId: "here" }),
    onAdd: () => {},
  });
  const fromRemove = findByClass(fromEl, "bob-dep-chip-remove");
  assert.equal(fromRemove[0].getAttribute("aria-label"), "Remove 'merged into'");
  fire(fromRemove[0], "click");
  assert.deepEqual(fromCalls[0], ["removeLink", { path: "b.md", line: null, blockId: "s" }, { path: "a.md", line: 1, blockId: "here" }]);

  // Without nav there are no controls: navigation only.
  const plain = buildRelationBlockElement(new MiniDoc(), model, {});
  assert.equal(findByClass(plain, "bob-dep-add").length, 0);
  assert.equal(findByClass(plain, "bob-dep-chip-remove").length, 0);

  // The real namespace is still v0, so chips stay navigation-only.
  const navigating = new LedgerToolsPlugin(makeApp([target], "", { version: 3, relations: { version: 0 } }), {});
  assert.equal(navigating.relationsNavApi(), null);
});

// LC12: one toggle and one refresh cover dependency, BLOCKS, and
// relation rows.
test("LC12 toggle-dependency-chips covers the merged relation block", () => {
  const plugin = new LedgerToolsPlugin(makeApp([]), {});
  plugin.dependencyChipsEnabled = true;
  plugin.setupDependencyChips();
  assert.equal(plugin.editorExtensions.length, 3, "dependency, BLOCKS, and relation extensions");
  assert.equal(plugin.postProcessors.length, 3, "dependency, BLOCKS, and relation post-processors");
  const toggle = plugin.commands.find((command) => command.id === "toggle-dependency-chips");
  assert.ok(toggle);
  assert.equal(toggle.callback(), false);
  assert.equal(plugin.dependencyChipsEnabled, false);
});

// LC13: malformed and not-a-line rows have no block.
test("LC13 malformed and not-a-line rows have no block", () => {
  const target = task({ blockId: "t", id: "t", description: "Target" });
  const live = [edgeTo({ path: "a.md", blockId: "t" }, { task: target })];
  const lookup = lookupFor([target]);
  const resolve = resolveFor();
  const base = { sourcePath: "a.md", owner: OWNER, outgoing: live, lookup, resolve };
  assert.equal(relationBlockModelForTask({ ...base, linksText: "- 🪢 **links:** [[#^t]]" }), null);
  assert.equal(relationBlockModelForTask({ ...base, linksText: "- 🪢 **LINKS:** [[#^t" }), null);
  assert.equal(relationBlockModelForTask({ ...base, linksText: "- 🪢 **LINKED FROM:** [[#^t]]" }), null, "wrong kind");
  assert.equal(relationBlockModelForTask({ ...base, linkedFromText: "- 🪢 **LINKS:** [[#^t]]" }), null, "wrong kind");
  assert.equal(relationBlockModelForTask({ ...base, linksText: null, linkedFromText: null }), null, "no lines");
  assert.equal(relationBlockModelForTask({ ...base }), null, "no lines at all");
  assert.equal(buildRelationBlockElement(new MiniDoc(), null, {}), null);
});

// LC14: an entry typed in the editor before save updates the target
// row in the same session through the index overlay.
test("LC14 unsaved editor text refreshes the live block", async () => {
  const lines = ["- [ ] #task Source ^source", "  - 🪢 **LINKS:** [[#^target]]", "- [ ] #task Target ^target"];
  const files = [
    { path: "a.md", content: lines.join("\n"), cache: { links: [{ link: "#^target" }], blocks: { source: {}, target: {} } } },
  ];
  const app = makeApp([], lines.join("\n"), null, files);
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.dependencyChipsEnabled = true;
  plugin.initializeRelationIndex();
  plugin.setupRelationIndex();
  plugin.startRelationIndexScan();
  const api = plugin.relationIndexApi();
  const end = Date.now() + 2000;
  while (!api.ready() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(api.ready(), true);
  const owner = { blockId: "source", text: lines[0], line: 1 };
  let model = plugin.relationBlockModelForOwner({ path: "a.md", owner, lines: [{ text: lines[1], lineNumber: 1 }] });
  assert.equal(model.outgoing.length, 0);
  assert.equal(model.plain[0].label, null);
  const editorView = new TestMarkdownView();
  editorView.file = files[0];
  editorView.editor = { getValue: () => ["- [ ] #task Source ^source", "  - 🪢 **LINKS:** fresh [[#^target]]", "- [ ] #task Target ^target"].join("\n") };
  app.activeView = editorView;
  app.workspace.getActiveViewOfType = () => app.activeView;
  assert.equal(plugin.refreshRelationIndexOverlay(), true);
  model = plugin.relationBlockModelForOwner({ path: "a.md", owner, lines: [{ text: "  - 🪢 **LINKS:** fresh [[#^target]]", lineNumber: 1 }] });
  assert.equal(model.outgoing[0].label, "fresh");
  plugin.teardownRelationIndex();
});

// LC15: one block for a plain pair stored twice, a plain stored once,
// an outgoing statement, and an incoming statement.
test("LC15 mixed pairs render one block: plains, then statements", () => {
  const both = task({ blockId: "x", id: "x", description: "Both" });
  const other = task({ blockId: "y", id: "y", description: "Why", path: "b.md" });
  const out = task({ blockId: "z", id: "z", description: "Zed" });
  const inc = task({ blockId: "w", id: "w", description: "Dub", path: "b.md" });
  const model = relationBlockModelForTask({
    sourcePath: "a.md", owner: OWNER,
    linksText: "- 🪢 **LINKS:** [[#^x]] • follow-up of [[#^z]]",
    linkedFromText: "- 🪢 **LINKED FROM:** [[#^x]] • [[b#^y]] • [[b#^w]] (merged into)",
    outgoing: [
      edgeTo({ path: "a.md", blockId: "x" }, { task: both }),
      edgeTo({ path: "a.md", blockId: "z" }, { label: "follow-up of", task: out }),
    ],
    incoming: [
      edgeFrom({ path: "a.md", blockId: "x" }, { task: both }),
      edgeFrom({ path: "b.md", blockId: "y" }, { task: other }),
      edgeFrom({ path: "b.md", blockId: "w" }, { label: "merged into", task: inc }),
    ],
    lookup: lookupFor([both, other, out, inc], "a.md"), resolve: resolveFor(),
  });
  assert.equal(model.label, "🪢 links");
  assert.deepEqual(model.plain.map((chip) => chip.blockId), ["x", "y"]);
  assert.equal(model.plain.find((chip) => chip.blockId === "x").storedOn, "both");
  assert.equal(model.plain.find((chip) => chip.blockId === "y").storedOn, "other");
  assert.deepEqual(model.outgoing.map((chip) => chip.label), ["follow-up of"]);
  assert.deepEqual(model.incoming.map((chip) => chip.label), ["merged into"]);
  assert.equal(model.incoming[0].inverse, "merged from");
  // One block only: plains wrap, statements take one row each.
  const doc = new MiniDoc();
  const el = buildRelationBlockElement(doc, model, { mode: "full" });
  assert.equal(findByClass(el, "bob-dep-label").length, 1);
  assert.equal(findByClass(el, "bob-relation-entry").length, 1, "full mode carries the outgoing statement; incoming lives on the continuation row");
  const continuation = buildRelationBlockElement(new MiniDoc(), model, { mode: "continuation" });
  assert.equal(findByClass(continuation, "bob-dep-label").length, 0, "no heading on the continuation row");
  assert.equal(findByClass(continuation, "bob-relation-entry").length, 1, "continuation carries the incoming statements only");
  const single = relationBlockModelForTask({
    sourcePath: "a.md", owner: OWNER,
    linksText: "- 🪢 **LINKS:** [[#^x]] • follow-up of [[#^z]]",
    linkedFromText: null,
    outgoing: [
      edgeTo({ path: "a.md", blockId: "x" }, { task: both }),
      edgeTo({ path: "a.md", blockId: "z" }, { label: "follow-up of", task: out }),
    ],
    incoming: [edgeFrom({ path: "b.md", blockId: "w" }, { label: "merged into", task: inc })],
    lookup: lookupFor([both, other, out, inc], "a.md"), resolve: resolveFor(),
  });
  assert.equal(single.hasContinuation, false);
  const singleEl = buildRelationBlockElement(new MiniDoc(), single, { mode: "full" });
  assert.equal(findByClass(singleEl, "bob-relation-entry").length, 2, "one line carries every statement");
});

// LC16: a plain record stored on the other task renders the same block.
test("LC16 incoming-only plain renders like a stored plain", () => {
  const peer = task({ blockId: "s", id: "s", description: "Peer", path: "b.md" });
  const stored = blockFor({
    linksText: "- 🪢 **LINKS:** [[b#^s]]", tasks: [peer],
    outgoing: [edgeTo({ path: "b.md", blockId: "s" }, { task: peer })],
  });
  const mirrored = blockFor({
    linkedFromText: "- 🪢 **LINKED FROM:** [[b#^s]]", tasks: [peer],
    incoming: [edgeFrom({ path: "b.md", blockId: "s" }, { task: peer })],
  });
  for (const model of [stored, mirrored]) {
    assert.equal(model.plain.length, 1);
    assert.equal(model.plain[0].text, "Peer");
    assert.equal(model.outgoing.length, 0);
    assert.equal(model.incoming.length, 0);
  }
  assert.equal(stored.plain[0].storedOn, "this");
  assert.equal(mirrored.plain[0].storedOn, "other");
});

// LC17: a pair with a plain record and a statement renders only the statement.
test("LC17 redundant plains hide behind the pair statement", () => {
  const peer = task({ blockId: "t", id: "t", description: "Peer" });
  const model = blockFor({
    linksText: "- 🪢 **LINKS:** [[#^t]] • follow-up of [[#^t]]", tasks: [peer],
    outgoing: [
      edgeTo({ path: "a.md", blockId: "t" }, { task: peer }),
      edgeTo({ path: "a.md", blockId: "t" }, { label: "follow-up of", task: peer }),
    ],
  });
  assert.equal(model.plain.length, 0, "redundant plain renders nothing");
  assert.equal(model.outgoing.length, 1);
  assert.equal(model.outgoing[0].label, "follow-up of");
});

// LC18: Live Preview groups both relation lines into one block; a
// selection touching either line reveals both raw lines.
test("LC18 Live Preview mounts one block plus a continuation row", () => {
  const target = task({ blockId: "target", id: "target", description: "Target", lineNumber: 2 });
  const other = task({ blockId: "other", id: "other", description: "Other", lineNumber: 4 });
  const source = task({ blockId: "source", id: "source", description: "Source", lineNumber: 0 });
  const lines = [
    "- [ ] #task Source ^source",
    "  - 🪢 **LINKS:** follow-up of [[#^target]]",
    "  - 🪢 **LINKED FROM:** [[#^other]] (merged into)",
    "- [ ] #task Target ^target",
    "- [ ] #task Other ^other",
  ];
  const files = [
    { path: "a.md", content: lines.join("\n"), cache: { links: [{ link: "#^target" }, { link: "#^other" }], blocks: { source: {}, target: {}, other: {} } } },
  ];
  const plugin = new LedgerToolsPlugin(makeApp([source, target, other], lines.join("\n"), null, files), {});
  plugin.dependencyChipsEnabled = true;
  plugin.initializeRelationIndex();
  plugin.relationIndexApplyFile("a.md", lines.join("\n"));
  const doc = makeDoc(lines);
  const view = {
    visibleRanges: [{ from: 0, to: doc.length }],
    state: {
      doc, selection: { ranges: [] },
      field: (field) => field === editorLivePreviewField ? true : field === editorInfoField ? { file: { path: "a.md" } } : null,
    },
  };
  const decorations = plugin.buildRelationChipDecorations(view);
  assert.equal(decorations.adds.length, 2);
  const modes = decorations.adds.map((add) => add.value.widget.meta.mode).sort();
  assert.deepEqual(modes, ["continuation", "full"]);
  const full = decorations.adds.find((add) => add.value.widget.meta.mode === "full").value.widget;
  assert.equal(full.model.label, "🪢 links");
  assert.equal(full.model.outgoing.length, 1);
  const cont = decorations.adds.find((add) => add.value.widget.meta.mode === "continuation").value.widget;
  assert.equal(cont.model, full.model, "both widgets share one block");
  // A selection touching the second line reveals both raw lines.
  const touched = {
    visibleRanges: [{ from: 0, to: doc.length }],
    state: {
      doc,
      selection: { ranges: [{ from: doc.line(3).from, to: doc.line(3).to }] },
      field: view.state.field,
    },
  };
  assert.equal(plugin.buildRelationChipDecorations(touched).adds.length, 0);
  plugin.teardownRelationIndex();
});

test("LC18 Reading view hides the second relation li under one block", async () => {
  const target = task({ blockId: "target", id: "target", description: "Target", lineNumber: 2, path: "a.md" });
  const source = task({ blockId: "source", id: "source", description: "Source", lineNumber: 0, path: "a.md" });
  const lines = ["- [ ] #task Source ^source", "  - 🪢 **LINKS:** [[#^target]]", "  - 🪢 **LINKED FROM:** [[#^target]]"];
  const plugin = new LedgerToolsPlugin(makeApp([source, target], lines.join("\n")), {});
  plugin.dependencyChipsEnabled = true;
  plugin.initializeRelationIndex();
  plugin.relationIndexApplyFile("a.md", "- [ ] #task Source ^source\n  - 🪢 **LINKS:** [[#^target]]\n- [ ] #task Target ^target");
  const docNode = new MiniDoc();
  const root = docNode.createElement("div");
  const ownerLi = docNode.createElement("li");
  ownerLi.appendChild(docNode.createTextNode("#task Source"));
  const list = docNode.createElement("ul"); ownerLi.appendChild(list);
  const linkRow = docNode.createElement("li");
  linkRow.appendChild(docNode.createTextNode("🪢 "));
  const strong = docNode.createElement("strong"); strong.appendChild(docNode.createTextNode("LINKS:")); linkRow.appendChild(strong);
  linkRow.appendChild(docNode.createTextNode(" "));
  const anchor = docNode.createElement("a"); anchor.classList.add("internal-link"); anchor.setAttribute("data-href", "#^target"); anchor.setAttribute("href", "#^target"); anchor.appendChild(docNode.createTextNode("Target")); linkRow.appendChild(anchor);
  list.appendChild(linkRow);
  const fromRow = docNode.createElement("li");
  fromRow.appendChild(docNode.createTextNode("🪢 "));
  const fromStrong = docNode.createElement("strong"); fromStrong.appendChild(docNode.createTextNode("LINKED FROM:")); fromRow.appendChild(fromStrong);
  list.appendChild(fromRow);
  root.appendChild(ownerLi);
  await plugin.renderRelationChipsIn(root, { sourcePath: "a.md", getSectionInfo: () => ({ lineStart: 0, lineEnd: 2 }) });
  assert.ok(linkRow.className.includes("bob-relation-block"));
  assert.equal(linkRow.dataset.bobRelationProcessed, "1");
  assert.equal(fromRow.dataset.bobRelationHidden, "1", "the second relation li hides");
  assert.equal(findByClass(linkRow, "bob-relation-chip").length, 1, "one chip, not one per line");
  plugin.teardownRelationIndex();
});

test("Reading view block shows ＋ and × with api.relations v1", async () => {
  const target = task({ blockId: "target", id: "target", description: "Target", lineNumber: 2, path: "a.md" });
  const source = task({ blockId: "source", id: "source", description: "Source", lineNumber: 0, path: "a.md" });
  const lines = ["- [ ] #task Source ^source", "  - 🪢 **LINKS:** [[#^target]]", "- [ ] #task Target ^target"];
  const calls = [];
  const plugin = new LedgerToolsPlugin(makeApp([source, target], lines.join("\n"), makeRelationsNavApi(calls)), {});
  plugin.dependencyChipsEnabled = true;
  plugin.initializeRelationIndex();
  plugin.relationIndexApplyFile("a.md", lines.join("\n"));
  const docNode = new MiniDoc();
  const root = docNode.createElement("div");
  const ownerLi = docNode.createElement("li");
  ownerLi.appendChild(docNode.createTextNode("#task Source"));
  const list = docNode.createElement("ul"); ownerLi.appendChild(list);
  const row = docNode.createElement("li");
  row.appendChild(docNode.createTextNode("🪢 "));
  const strong = docNode.createElement("strong"); strong.appendChild(docNode.createTextNode("LINKS:")); row.appendChild(strong);
  row.appendChild(docNode.createTextNode(" "));
  const anchor = docNode.createElement("a"); anchor.classList.add("internal-link"); anchor.setAttribute("data-href", "#^target"); anchor.setAttribute("href", "#^target"); anchor.appendChild(docNode.createTextNode("Target")); row.appendChild(anchor);
  list.appendChild(row);
  const targetLi = docNode.createElement("li"); targetLi.appendChild(docNode.createTextNode("#task Target"));
  root.appendChild(ownerLi); root.appendChild(targetLi);
  await plugin.renderRelationChipsIn(root, { sourcePath: "a.md", getSectionInfo: () => ({ lineStart: 0, lineEnd: 2 }) });
  assert.ok(row.className.includes("bob-relation-block"));
  assert.match(row.getAttribute("aria-label"), /🪢 links, 1 live/);
  const add = findByClass(row, "bob-dep-add");
  const remove = findByClass(row, "bob-dep-chip-remove");
  assert.equal(add.length, 1);
  assert.equal(remove.length, 1);
  assert.equal(add[0].getAttribute("aria-label"), "Link another task");
  assert.equal(remove[0].getAttribute("aria-label"), "Unlink Target");
  fire(add[0], "click");
  fire(remove[0], "click");
  assert.equal(calls[0][0], "openStage");
  assert.deepEqual(calls[0][1], { path: "a.md", line: 1, direction: "to" });
  assert.equal(calls[1][0], "removeLink");
  assert.deepEqual(calls[1][1], { path: "a.md", line: 1, blockId: "source" });
  assert.deepEqual(calls[1][2], { path: "a.md", line: null, blockId: "target" });
  plugin.teardownRelationIndex();
});

class MiniNode {
  constructor(tag, nodeType = 1, value = "") {
    this.tagName = tag.toUpperCase(); this.nodeName = this.tagName; this.nodeType = nodeType;
    this.nodeValue = nodeType === 3 ? value : null; this.childNodes = []; this.parentNode = null;
    this.attributes = {}; this.style = {}; this.dataset = {}; this.ownerDocument = null;
    this.className = ""; this.listeners = {};
    this.classList = {
      add: (...names) => { this.className = Array.from(new Set((this.className + " " + names.join(" ")).trim().split(/\s+/).filter(Boolean))).join(" "); },
      remove: (...names) => { this.className = this.className.split(/\s+/).filter((name) => name && !names.includes(name)).join(" "); },
      contains: (name) => this.className.split(/\s+/).includes(name),
    };
  }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name === "class") this.className = String(value); }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; }
  removeAttribute(name) { delete this.attributes[name]; }
  appendChild(child) { child.parentNode = this; child.ownerDocument = this.ownerDocument; this.childNodes.push(child); return child; }
  insertBefore(child, before) {
    child.parentNode = this; child.ownerDocument = this.ownerDocument;
    const at = before ? this.childNodes.indexOf(before) : -1;
    if (at === -1) this.childNodes.push(child);
    else this.childNodes.splice(at, 0, child);
    return child;
  }
  removeChild(child) { this.childNodes = this.childNodes.filter((node) => node !== child); child.parentNode = null; return child; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); }
  get firstChild() { return this.childNodes[0] || null; }
  get textContent() { return this.nodeType === 3 ? this.nodeValue : this.childNodes.map((node) => node.textContent).join(""); }
  set textContent(value) { this.childNodes = []; this.appendChild(new MiniNode("#text", 3, String(value))); }
  querySelectorAll(selector) {
    const found = [];
    const matches = (node) => selector === "li" ? node.tagName === "LI" : selector === "a.internal-link" ? node.tagName === "A" && node.classList.contains("internal-link") : false;
    const visit = (node) => { for (const child of node.childNodes || []) { if (child.nodeType === 1 && matches(child)) found.push(child); if (child.nodeType === 1) visit(child); } };
    visit(this); return found;
  }
}
class MiniDoc {
  createElement(tag) { const node = new MiniNode(tag); node.ownerDocument = this; return node; }
  createTextNode(text) { const node = new MiniNode("#text", 3, String(text)); node.ownerDocument = this; return node; }
}

function makeDoc(lines) {
  let offset = 0;
  const rows = lines.map((text, i) => { const row = { from: offset, to: offset + text.length, number: i + 1, text }; offset = row.to + 1; return row; });
  return {
    length: Math.max(0, offset - 1),
    line: (n) => rows[n - 1],
    lineAt: (pos) => rows.find((row) => pos >= row.from && pos <= row.to) || rows[rows.length - 1],
  };
}

function makeApp(tasks, text = "", navApi = null, files = null) {
  const plugins = { "obsidian-tasks-plugin": { getTasks: () => tasks } };
  if (navApi) {
    plugins["bob-navigation-hotkeys"] = { api: navApi };
  }
  const byPath = new Map((files || []).map((file) => [file.path, file]));
  return {
    plugins: { plugins },
    workspace: { on: () => ({}), offref: () => {}, onLayoutReady: () => {}, getLeavesOfType: () => [], trigger: () => {}, getActiveViewOfType: () => null },
    vault: {
      getMarkdownFiles: () => Array.from(byPath.values()),
      getAbstractFileByPath: (path) => byPath.get(path) || { path },
      cachedRead: (file) => Promise.resolve((file && typeof file === "object" && file.content !== undefined ? file.content : text)),
      read: (file) => Promise.resolve((file && typeof file === "object" && file.content !== undefined ? file.content : text)),
    },
    metadataCache: {
      on: () => ({}),
      getFirstLinkpathDest: (linkpath) => {
        if (!linkpath) return byPath.get("a.md") || { path: "a.md" };
        const candidate = linkpath.endsWith(".md") ? linkpath : linkpath + ".md";
        return byPath.get(candidate) || null;
      },
      getCache: (path) => (byPath.get(path) || {}).cache || {},
      getFileCache: (file) => (typeof file === "string" ? byPath.get(file) : file)?.cache || null,
    },
  };
}

function makeRelationsNavApi(calls, { v2 = false } = {}) {
  const relations = {
    version: 1,
    openStage(ref) {
      calls.push(["openStage", ref]);
      return Promise.resolve({ ok: true });
    },
    removeLink(sourceRef, targetRef) {
      calls.push(["removeLink", sourceRef, targetRef]);
      return Promise.resolve({ ok: true });
    },
  };
  if (v2) {
    relations.unlink = (first, second) => {
      calls.push(["unlink", first, second]);
      return Promise.resolve({ ok: true });
    };
    relations.removeStatement = (source, target) => {
      calls.push(["removeStatement", source, target]);
      return Promise.resolve({ ok: true });
    };
  }
  return {
    version: 3,
    relations,
  };
}

function findByClass(node, name, out = []) {
  if (node && node.nodeType === 1 && node.classList && node.classList.contains(name)) {
    out.push(node);
  }
  for (const child of node.childNodes || []) {
    findByClass(child, name, out);
  }
  return out;
}

function serializeNode(node) {
  if (!node) return "";
  if (node.nodeType === 3) {
    return JSON.stringify(node.nodeValue);
  }
  const attrs = Object.keys(node.attributes || {}).sort().map((key) => key + "=" + node.attributes[key]).join(" ");
  return "<" + node.tagName + (attrs ? " " + attrs : "") + ">" + (node.childNodes || []).map(serializeNode).join("") + "</" + node.tagName + ">";
}

function fire(node, type, extra = {}) {
  const event = {
    stopPropagation() {},
    preventDefault() {},
    target: node,
    key: extra.key,
  };
  for (const handler of node.listeners[type] || []) {
    handler(event);
  }
}
