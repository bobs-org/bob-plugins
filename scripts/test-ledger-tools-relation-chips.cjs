// Relation chips (bob-cli-a2 chips). LC vectors come from the approved
// task-relations plan (§10 chips, LC1–LC14); the `inverse_phrases =
// builtin` and `linked_from_remove = yes` decisions are covered with
// the model and both render surfaces.
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

const {
  relationInversePhrase,
  relationChipModelForRow,
  buildRelationChipElement,
  RELATION_INVERSE_PHRASES,
  RELATION_STALE_TOOLTIP,
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

function liveTo(target, { label = null, resolved = true, task = null } = {}) {
  return { label, other: { path: target.path, blockId: target.blockId, resolved, task } };
}

function liveFrom(source, { label = null, task = null } = {}) {
  return { label, other: { path: source.path, blockId: source.blockId, resolved: true, task } };
}

test("LC1 one unlabelled open target renders links-to arrow chip", () => {
  const target = task({ blockId: "t", id: "t", description: "Target" });
  const model = relationChipModelForRow({
    direction: "to", lineText: "- 🪢 **LINKS:** [[#^t]]", sourcePath: "a.md",
    live: [liveTo({ path: "a.md", blockId: "t" }, { task: target })],
    lookup: lookupFor([target]), resolve: resolveFor(),
  });
  assert.equal(model.label, "🪢 links to");
  assert.equal(model.labelled, false);
  assert.equal(model.liveCount, 1);
  assert.equal(model.chips.length, 1);
  const chip = model.chips[0];
  assert.equal(chip.state, "todo");
  assert.equal(chip.symbol, "○");
  assert.equal(chip.text, "Target");
  assert.equal(chip.live, true);
  assert.equal(chip.stale, false);
  assert.equal(chip.broken, false);
});

test("LC2 labelled target carries a pill", () => {
  const target = task({ blockId: "t", id: "t", description: "Target" });
  const model = relationChipModelForRow({
    direction: "to", lineText: "- 🪢 **LINKS:** follow-up of [[#^t]]", sourcePath: "a.md",
    live: [liveTo({ path: "a.md", blockId: "t" }, { label: "follow-up of", task: target })],
    lookup: lookupFor([target]), resolve: resolveFor(),
  });
  assert.equal(model.labelled, true);
  assert.equal(model.chips[0].label, "follow-up of");
  assert.equal(model.chips[0].inverse, null);
});

test("LC3 closed and archived targets dim without strike; #hide mutes", () => {
  const done = task({ blockId: "d", id: "d", description: "Finished", status: "DONE", symbol: "x" });
  const model = relationChipModelForRow({
    direction: "to", lineText: "- 🪢 **LINKS:** [[#^d]]", sourcePath: "a.md",
    live: [liveTo({ path: "a.md", blockId: "d" }, { task: done })],
    lookup: lookupFor([done]), resolve: resolveFor(),
  });
  assert.equal(model.chips[0].state, "done");
  assert.equal(model.chips[0].symbol, "✓");

  const archived = task({ blockId: "cap", id: "cap", description: "Old", path: "done/bob_done.md", status: "DONE", symbol: "x" });
  const archivedModel = relationChipModelForRow({
    direction: "to", lineText: "- 🪢 **LINKS:** [[done/bob_done#^cap]]", sourcePath: "a.md",
    live: [liveTo({ path: "done/bob_done.md", blockId: "cap" }, { task: archived })],
    lookup: lookupFor([archived]), resolve: resolveFor(),
  });
  const chip = archivedModel.chips[0];
  assert.equal(chip.archived, true);
  assert.equal(chip.noteLabel, "↗ bob_done");

  const hidden = task({ blockId: "h", id: "h", description: "Quiet", tags: ["#hide"] });
  const hiddenModel = relationChipModelForRow({
    direction: "to", lineText: "- 🪢 **LINKS:** [[#^h]]", sourcePath: "a.md",
    live: [liveTo({ path: "a.md", blockId: "h" }, { task: hidden })],
    lookup: lookupFor([hidden]), resolve: resolveFor(),
  });
  assert.equal(hiddenModel.chips[0].hidden, true);

  // The element never strikes: no line-through wrapper exists.
  const doc = new MiniDoc();
  const el = buildRelationChipElement(doc, archivedModel, {});
  assert.ok(el);
  assert.equal(findByClass(el, "bob-relation-chip").length, 1);
  assert.ok(findByClass(el, "bob-relation-chip")[0].className.includes("is-archived"));
});

test("LC4 unresolvable target is a dashed missing chip", () => {
  const model = relationChipModelForRow({
    direction: "to", lineText: "- 🪢 **LINKS:** [[missing#^x]]", sourcePath: "a.md",
    live: [liveTo({ path: "", blockId: "x" }, { resolved: false })],
    lookup: lookupFor([]), resolve: resolveFor(),
  });
  const chip = model.chips[0];
  assert.equal(chip.broken, true);
  assert.equal(chip.symbol, "⚠");
  assert.equal(chip.text, "^x not found");
  assert.match(chip.tooltip, /⚠ \^x not found/);
});

test("LC5 LINKED FROM shows the builtin inverse phrase", () => {
  assert.deepEqual(RELATION_INVERSE_PHRASES, [
    ["merged into", "merged from"],
    ["duplicate of", "duplicated by"],
    ["follow-up of", "followed up by"],
    ["superseded by", "supersedes"],
    ["split from", "split into"],
  ]);
  assert.equal(relationInversePhrase("Merged Into"), "merged from");
  assert.equal(relationInversePhrase("DUPLICATE OF"), "duplicated by");
  assert.equal(relationInversePhrase("see"), null);
  const source = task({ blockId: "s", id: "s", description: "Source", status: "DONE", symbol: "x" });
  const model = relationChipModelForRow({
    direction: "from", lineText: "- 🪢 **LINKED FROM:** [[#^s]] (merged into)", sourcePath: "a.md",
    live: [liveFrom({ path: "a.md", blockId: "s" }, { label: "merged into", task: source })],
    lookup: lookupFor([source]), resolve: resolveFor(),
  });
  assert.equal(model.label, "🪢 linked from");
  assert.equal(model.chips[0].inverse, "merged from");
  assert.equal(model.chips[0].label, "merged into");
});

test("LC6 LINKED FROM with an unknown label reads chip, label, this", () => {
  const source = task({ blockId: "s", id: "s", description: "Source" });
  const model = relationChipModelForRow({
    direction: "from", lineText: "- 🪢 **LINKED FROM:** [[#^s]] (see)", sourcePath: "a.md",
    live: [liveFrom({ path: "a.md", blockId: "s" }, { label: "see", task: source })],
    lookup: lookupFor([source]), resolve: resolveFor(),
  });
  const chip = model.chips[0];
  assert.equal(chip.inverse, null);
  assert.equal(chip.label, "see");
  assert.equal(chip.symbol, "○");
  const doc = new MiniDoc();
  const el = buildRelationChipElement(doc, model, {});
  const html = serializeNode(el);
  assert.match(html, /bob-relation-pill/);
  assert.match(html, /→ this/);
});

test("LC7 live edges missing from the text append in canonical order", () => {
  const mkTarget = (blockId, path = "a.md") => task({ blockId, id: blockId, description: "T" + blockId, path });
  const zebra = mkTarget("z");
  const alpha = mkTarget("a");
  const model = relationChipModelForRow({
    direction: "to", lineText: "- 🪢 **LINKS:**", sourcePath: "a.md",
    live: [
      liveTo({ path: "a.md", blockId: "z" }, { task: zebra }),
      liveTo({ path: "a.md", blockId: "a" }, { task: alpha }),
    ],
    lookup: lookupFor([zebra, alpha]), resolve: resolveFor(),
  });
  assert.ok(model);
  assert.deepEqual(model.chips.map((chip) => chip.blockId), ["a", "z"]);
  assert.ok(model.chips.every((chip) => chip.live));
});

test("LC8 stored entries that are no longer live are dashed and uncounted", () => {
  const gone = task({ blockId: "gone", id: "gone", description: "Gone" });
  const here = task({ blockId: "here", id: "here", description: "Here" });
  const model = relationChipModelForRow({
    direction: "from", lineText: "- 🪢 **LINKED FROM:** [[#^gone]] • [[#^here]]", sourcePath: "a.md",
    live: [liveFrom({ path: "a.md", blockId: "here" }, { task: here })],
    lookup: lookupFor([gone, here]), resolve: resolveFor(),
  });
  const stale = model.chips.find((chip) => chip.blockId === "gone");
  const live = model.chips.find((chip) => chip.blockId === "here");
  assert.equal(stale.stale, true);
  assert.equal(stale.live, false);
  assert.match(stale.tooltip, new RegExp(RELATION_STALE_TOOLTIP.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(live.live, true);
  assert.equal(model.liveCount, 1);
});

test("LC9 three or more closed chips collapse to ✓×N and expand", () => {
  const sources = ["a", "b", "c", "d"].map((id) =>
    task({ blockId: id, id, description: "Source " + id, status: "DONE", symbol: "x" }));
  const model = relationChipModelForRow({
    direction: "from",
    lineText: "- 🪢 **LINKED FROM:** [[#^a]] • [[#^b]] • [[#^c]] • [[#^d]]",
    sourcePath: "a.md",
    live: sources.map((source) => liveFrom({ path: "a.md", blockId: source.id }, { task: source })),
    lookup: lookupFor(sources), resolve: resolveFor(),
  });
  assert.deepEqual(model.collapsed, { count: 4 });
  const doc = new MiniDoc();
  const el = buildRelationChipElement(doc, model, {});
  const collapsed = findByClass(el, "bob-relation-collapsed");
  assert.equal(collapsed.length, 1);
  assert.match(collapsed[0].childNodes.map((node) => node.textContent).join(""), /✓×4/);
  assert.equal(findByClass(el, "bob-relation-chip").length, 0);
  fire(collapsed[0], "click");
  assert.equal(findByClass(el, "bob-relation-chip").length, 4);
  assert.equal(findByClass(el, "bob-relation-collapsed").length, 0);

  const pair = sources.slice(0, 2);
  const open = relationChipModelForRow({
    direction: "from", lineText: "- 🪢 **LINKED FROM:** [[#^a]] • [[#^b]]", sourcePath: "a.md",
    live: pair.map((source) => liveFrom({ path: "a.md", blockId: source.id }, { task: source })),
    lookup: lookupFor(sources), resolve: resolveFor(),
  });
  assert.equal(open.collapsed, null);
});

test("LC10 labelled rows wrap one entry per visual row", () => {
  const first = task({ blockId: "a", id: "a", description: "First" });
  const second = task({ blockId: "b", id: "b", description: "Second" });
  const model = relationChipModelForRow({
    direction: "to", lineText: "- 🪢 **LINKS:** see [[#^a]] • follow-up of [[#^b]]", sourcePath: "a.md",
    live: [
      liveTo({ path: "a.md", blockId: "a" }, { label: "see", task: first }),
      liveTo({ path: "a.md", blockId: "b" }, { label: "follow-up of", task: second }),
    ],
    lookup: lookupFor([first, second]), resolve: resolveFor(),
  });
  const doc = new MiniDoc();
  const el = buildRelationChipElement(doc, model, {});
  assert.ok(el.className.includes("is-labelled"));
  const entries = findByClass(el, "bob-relation-entry");
  assert.equal(entries.length, 2);
  for (const entry of entries) {
    assert.equal(findByClass(entry, "bob-relation-pill").length, 1);
    assert.equal(findByClass(entry, "bob-relation-chip").length, 1);
  }
  const plain = relationChipModelForRow({
    direction: "to", lineText: "- 🪢 **LINKS:** [[#^a]]", sourcePath: "a.md",
    live: [liveTo({ path: "a.md", blockId: "a" }, { task: first })],
    lookup: lookupFor([first]), resolve: resolveFor(),
  });
  const plainEl = buildRelationChipElement(doc, plain, {});
  assert.equal(findByClass(plainEl, "bob-relation-entry").length, 0);
  assert.match(serializeNode(plainEl), /→/);
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

function makeRelationsNavApi(calls) {
  return {
    version: 3,
    relations: {
      version: 1,
      openStage(ref) {
        calls.push(["openStage", ref]);
        return Promise.resolve({ ok: true });
      },
      removeLink(sourceRef, targetRef) {
        calls.push(["removeLink", sourceRef, targetRef]);
        return Promise.resolve({ ok: true });
      },
    },
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

function relationModelFor(targets, { direction = "to", line = null, sourcePath = "a.md" } = {}) {
  const lineText = line || (direction === "to"
    ? "- 🪢 **LINKS:** " + targets.map((id) => "[[#^" + id + "]]").join(" • ")
    : "- 🪢 **LINKED FROM:** " + targets.map((id) => "[[#^" + id + "]]").join(" • "));
  const tasks = targets.map((id) => task({ blockId: id, id, description: "Task " + id }));
  const live = targets.map((id) => direction === "to"
    ? liveTo({ path: sourcePath, blockId: id }, { task: tasks.find((item) => item.id === id) })
    : liveFrom({ path: sourcePath, blockId: id }, { task: tasks.find((item) => item.id === id) }));
  return relationChipModelForRow({
    direction, lineText, sourcePath: sourcePath, live,
    lookup: lookupFor(tasks, sourcePath), resolve: resolveFor(sourcePath),
  });
}

// LC11: ＋ and × render only with nav api.relations v1, with the Rule 9
// aria labels; without the api the row stays navigation-only.
test("LC11 controls need api.relations v1; linked_from_remove calls removeLink(S, T)", async () => {
  TestNotice.messages = [];
  const target = task({ blockId: "t", id: "t", description: "Target" });
  const model = relationChipModelForRow({
    direction: "to", lineText: "- 🪢 **LINKS:** [[#^t]]", sourcePath: "a.md",
    live: [liveTo({ path: "a.md", blockId: "t" }, { task: target })],
    lookup: lookupFor([target]), resolve: resolveFor(),
  });
  const calls = [];
  const plugin = new LedgerToolsPlugin(makeApp([target], "", makeRelationsNavApi(calls)), {});
  const mini = new MiniDoc();
  const el = buildRelationChipElement(mini, model, {
    plugin,
    sourcePath: "a.md",
    interactive: true,
    onRemove: (chip) => plugin.relationRemoveLink(chip, "a.md", { lineNumber: 1, direction: "to", ownerBlockId: "owner" }),
    onAdd: () => plugin.relationOpenStage("a.md", { lineNumber: 1, direction: "to" }),
  });
  const add = findByClass(el, "bob-dep-add");
  assert.equal(add.length, 1);
  assert.equal(add[0].getAttribute("aria-label"), "Link this task to another");
  const remove = findByClass(el, "bob-dep-chip-remove");
  assert.equal(remove.length, 1);
  assert.equal(remove[0].getAttribute("aria-label"), "Unlink Target");
  fire(add[0], "click");
  fire(remove[0], "click");
  assert.equal(calls[0][0], "openStage");
  assert.deepEqual(calls[0][1], { path: "a.md", line: 1, direction: "to" });
  assert.equal(calls[1][0], "removeLink");
  assert.deepEqual(calls[1][1], { path: "a.md", line: 1, blockId: "owner" });
  assert.deepEqual(calls[1][2], { path: "a.md", blockId: "t" });
  await Promise.resolve();
  assert.deepEqual(TestNotice.messages, []);

  const plain = buildRelationChipElement(new MiniDoc(), model, {});
  assert.equal(findByClass(plain, "bob-dep-add").length, 0);
  assert.equal(findByClass(plain, "bob-dep-chip-remove").length, 0);

  // LINKED FROM × removes the edge from the source task (decision
  // `linked_from_remove = yes`); the aria names the source.
  const source = task({ blockId: "s", id: "s", description: "Source", path: "b.md" });
  const fromModel = relationChipModelForRow({
    direction: "from", lineText: "- 🪢 **LINKED FROM:** [[b#^s]]", sourcePath: "a.md",
    live: [liveFrom({ path: "b.md", blockId: "s" }, { task: source })],
    lookup: lookupFor([source]), resolve: resolveFor(),
  });
  const fromCalls = [];
  const fromPlugin = new LedgerToolsPlugin(makeApp([source], "", makeRelationsNavApi(fromCalls)), {});
  const fromEl = buildRelationChipElement(new MiniDoc(), fromModel, {
    plugin: fromPlugin,
    sourcePath: "a.md",
    interactive: true,
    onRemove: (chip) => fromPlugin.relationRemoveLink(chip, "a.md", { lineNumber: 1, direction: "from", ownerBlockId: "here" }),
    onAdd: () => fromPlugin.relationOpenStage("a.md", { lineNumber: 1, direction: "from" }),
  });
  const fromAdd = findByClass(fromEl, "bob-dep-add");
  assert.equal(fromAdd[0].getAttribute("aria-label"), "Choose a task that links here");
  const fromRemove = findByClass(fromEl, "bob-dep-chip-remove");
  assert.equal(fromRemove[0].getAttribute("aria-label"), "Remove the link from Source");
  fire(fromRemove[0], "click");
  assert.deepEqual(fromCalls[0], ["removeLink", { path: "b.md", line: null, blockId: "s" }, { path: "a.md", line: 1, blockId: "here" }]);

  // The real namespace is still v0, so chips stay navigation-only.
  const navigating = new LedgerToolsPlugin(makeApp([target], "", { version: 3, relations: { version: 0 } }), {});
  assert.equal(navigating.relationsNavApi(), null);
});

// LC12: one toggle and one refresh cover dependency, BLOCKS, and
// relation rows.
test("LC12 toggle-dependency-chips covers both relation rows", () => {
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

// LC13: malformed and not-a-line rows never get chips.
test("LC13 malformed and not-a-line rows have no model", () => {
  const target = task({ blockId: "t", id: "t", description: "Target" });
  const live = [liveTo({ path: "a.md", blockId: "t" }, { task: target })];
  const lookup = lookupFor([target]);
  const resolve = resolveFor();
  assert.equal(relationChipModelForRow({ direction: "to", lineText: "- 🪢 **links:** [[#^t]]", sourcePath: "a.md", live, lookup, resolve }), null);
  assert.equal(relationChipModelForRow({ direction: "to", lineText: "- 🪢 **LINKS:** [[#^t", sourcePath: "a.md", live, lookup, resolve }), null);
  assert.equal(relationChipModelForRow({ direction: "to", lineText: "- 🪢 **LINKS:** [[#^t]] trailing", sourcePath: "a.md", live, lookup, resolve }), null);
  assert.equal(relationChipModelForRow({ direction: "to", lineText: "> - 🪢 **LINKS:** [[#^t]]", sourcePath: "a.md", live, lookup, resolve }), null);
  assert.equal(relationChipModelForRow({ direction: "to", lineText: "- 🪢 **LINKED FROM:** [[#^t]]", sourcePath: "a.md", live, lookup, resolve }), null, "wrong direction");
  assert.equal(relationChipModelForRow({ direction: "from", lineText: "- 🪢 **LINKS:** [[#^t]]", sourcePath: "a.md", live, lookup, resolve }), null, "wrong direction");
  assert.equal(buildRelationChipElement(new MiniDoc(), null, {}), null);
});

// LC14: an entry typed in the editor before save updates the target
// row in the same session through the index overlay.
test("LC14 unsaved editor text refreshes the live model", async () => {
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
  let model = plugin.relationChipModelForLine({ path: "a.md", text: lines[1], owner });
  assert.equal(model.chips[0].label, null);
  const editorView = new TestMarkdownView();
  editorView.file = files[0];
  editorView.editor = { getValue: () => ["- [ ] #task Source ^source", "  - 🪢 **LINKS:** fresh [[#^target]]", "- [ ] #task Target ^target"].join("\n") };
  app.activeView = editorView;
  app.workspace.getActiveViewOfType = () => app.activeView;
  assert.equal(plugin.refreshRelationIndexOverlay(), true);
  model = plugin.relationChipModelForLine({ path: "a.md", text: "  - 🪢 **LINKS:** fresh [[#^target]]", owner });
  assert.equal(model.chips[0].label, "fresh");
  plugin.teardownRelationIndex();
});

test("Live Preview decorates relation rows from the index", () => {
  const target = task({ blockId: "target", id: "target", description: "Target", lineNumber: 2 });
  const source = task({ blockId: "source", id: "source", description: "Source", lineNumber: 0 });
  const lines = ["- [ ] #task Source ^source", "  - 🪢 **LINKS:** [[#^target]]", "- [ ] #task Target ^target"];
  const files = [
    { path: "a.md", content: lines.join("\n"), cache: { links: [{ link: "#^target" }], blocks: { source: {}, target: {} } } },
  ];
  const plugin = new LedgerToolsPlugin(makeApp([source, target], lines.join("\n"), null, files), {});
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
  assert.equal(decorations.adds.length, 1);
  const widget = decorations.adds[0].value.widget;
  assert.equal(widget.model.chips.length, 1);
  assert.equal(widget.model.chips[0].text, "Target");
  assert.equal(widget.meta.interactive, false);
  assert.equal(widget.meta.direction, "to");
  plugin.teardownRelationIndex();
});

test("Reading view decorates stored anchors and appends live edges", async () => {
  const target = task({ blockId: "target", id: "target", description: "Target", lineNumber: 2, path: "a.md" });
  const source = task({ blockId: "source", id: "source", description: "Source", lineNumber: 0, path: "a.md" });
  const lines = ["- [ ] #task Source ^source", "  - 🪢 **LINKS:** [[#^target]]", "- [ ] #task Target ^target"];
  const plugin = new LedgerToolsPlugin(makeApp([source, target], lines.join("\n")), {});
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
  assert.ok(row.className.includes("bob-relation-row"));
  assert.ok(anchor.className.includes("bob-relation-chip"));
  assert.equal(findByClass(row, "bob-dep-add").length, 0);
  assert.equal(findByClass(row, "bob-dep-chip-remove").length, 0);
  plugin.teardownRelationIndex();
});

test("Reading view with api.relations v1 shows ＋ and ×", async () => {
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
  const add = findByClass(row, "bob-dep-add");
  const remove = findByClass(row, "bob-dep-chip-remove");
  assert.equal(add.length, 1);
  assert.equal(remove.length, 1);
  assert.equal(add[0].getAttribute("aria-label"), "Link this task to another");
  assert.equal(remove[0].getAttribute("aria-label"), "Unlink Target");
  fire(add[0], "click");
  fire(remove[0], "click");
  assert.equal(calls[0][0], "openStage");
  assert.deepEqual(calls[0][1], { path: "a.md", line: 1, direction: "to" });
  assert.equal(calls[1][0], "removeLink");
  assert.deepEqual(calls[1][1], { path: "a.md", line: 1, blockId: "source" });
  assert.deepEqual(calls[1][2], { path: "a.md", blockId: "target" });
  plugin.teardownRelationIndex();
});
