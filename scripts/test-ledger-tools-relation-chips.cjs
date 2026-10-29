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

function hideNodeFields(node, fields) {
  for (const field of fields) {
    Object.defineProperty(node, field, {
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }
  assert.deepEqual(fields.filter((field) => Object.keys(node).includes(field)), []);
}
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
  relationFitMentionQuote,
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

function liveMention(source, { display = "mention", count = 1, occurrences = [], task: sourceTask = null } = {}) {
  const blockId = source && (source.blockId || source.id) || "";
  return {
    kind: "mention", display, count, occurrences,
    other: { path: source.path, blockId, resolved: true, task: sourceTask || source },
  };
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
    ["implemented by", "implements"],
    ["verified by", "verifies"],
  ]);
  assert.equal(relationInversePhrase("Merged Into"), "merged from");
  assert.equal(relationInversePhrase("DUPLICATE OF"), "duplicated by");
  assert.equal(relationInversePhrase("Implemented By"), "implements");
  assert.equal(relationInversePhrase("VERIFIED BY"), "verifies");
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
  const reading = task({
    blockId: "reading",
    id: "reading",
    description: "reading task",
    status: "DONE",
    symbol: "x",
  });
  const implemented = relationChipModelForRow({
    direction: "from",
    lineText: "- 🪢 **LINKED FROM:** [[#^reading]] (implemented by)",
    sourcePath: "feature.md",
    live: [liveFrom({ path: "reading.md", blockId: "reading" }, { label: "implemented by", task: reading })],
    lookup: lookupFor([reading]),
    resolve: resolveFor(),
  });
  assert.equal(implemented.chips[0].inverse, "implements");
  assert.equal(implemented.chips[0].label, "implemented by");
  const doc = new MiniDoc();
  const html = serializeNode(buildRelationChipElement(doc, implemented, {}));
  assert.match(html, /implements/);
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
    hideNodeFields(this, ["parentNode", "ownerDocument"]);
  }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name === "class") this.className = String(value); }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; }
  // Hidden back-references bound assert diffs; this descriptor keeps inspect and reporter output short.
  [require("node:util").inspect.custom]() {
    const cls = String(this.className || "");
    const kids = Array.isArray(this.childNodes) ? this.childNodes.length : 0;
    let raw = "";
    if (this.nodeType === 3) raw = String(this.nodeValue || "");
    else {
      const first = this.childNodes.find((node) => node && node.nodeType === 3);
      if (first) raw = String(first.nodeValue || "");
    }
    const flat = raw.replace(/\s+/g, " ");
    const text = flat.length > 40 ? flat.slice(0, 40) + "…" : flat;
    const dot = cls ? "." + cls.split(/\s+/).filter(Boolean).join(".") : "";
    return `MiniNode(${this.tagName}${dot} children=${kids} text=${JSON.stringify(text)})`;
  }
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
  contains(node) {
    let current = node;
    while (current) {
      if (current === this) return true;
      current = current.parentNode || null;
    }
    return false;
  }
  addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); }
  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
    for (const handler of this.listeners.focus || []) handler({ target: this });
  }
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
  constructor() {
    this.activeElement = null;
    this.body = this.createElement("body");
  }
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

function findByClasses(node, names, out = []) {
  if (node && node.nodeType === 1 && node.classList && names.every((name) => node.classList.contains(name))) out.push(node);
  for (const child of node.childNodes || []) findByClasses(child, names, out);
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
    ...extra,
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

test("Reading view groups mention rows, renders the quote, omits ×, and jumps to the source occurrence", async () => {
  const source = task({ blockId: "source", id: "source", description: "Source mentions this", path: "source.md" });
  const content = [
    "- [ ] #task Target ^target",
    "  - 🪢 **LINKED FROM:** [[source#^source]] (💬 mentions)",
  ].join("\n");
  const file = { path: "target.md", content };
  const app = makeApp([source], content, null, [file]);
  const opened = [];
  app.workspace.openLinkText = (...args) => { opened.push(args); return Promise.resolve(); };
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.dependencyChipsEnabled = true;
  plugin.relationIndexApi = () => ({
    linkedFrom: () => [{
      kind: "mention", source: { path: "source.md", blockId: "source", text: "Source mentions this", status: "TODO" },
      display: "mention", count: 4, occurrences: [
        { line: 3, ch: 18, site: "note", excerpt: "Merged into ⟦this task⟧" },
        { line: 5, ch: 8, site: "cancel_log", excerpt: "Cancel for ⟦this task⟧" },
        { line: 7, ch: 4, site: "work_log", excerpt: "Worked on ⟦this task⟧" },
        { line: 9, ch: 10, site: "schedule_log", excerpt: "Rescheduled ⟦this task⟧" },
      ],
    }],
  });
  plugin.relationLookupTask = (path, id) => path === source.path && id === source.id ? source : null;
  plugin.relationResolveLinkpath = (linkpath) => String(linkpath || "").replace(/\.md$/i, "") + ".md";
  const docNode = new MiniDoc();
  const root = docNode.createElement("div");
  const ownerLi = docNode.createElement("li");
  ownerLi.appendChild(docNode.createTextNode("#task Target"));
  const list = docNode.createElement("ul"); ownerLi.appendChild(list);
  const row = docNode.createElement("li");
  row.appendChild(docNode.createTextNode("🪢 "));
  const strong = docNode.createElement("strong"); strong.appendChild(docNode.createTextNode("LINKED FROM:")); row.appendChild(strong);
  row.appendChild(docNode.createTextNode(" "));
  const anchor = docNode.createElement("a"); anchor.classList.add("internal-link"); anchor.setAttribute("data-href", "source#^source"); anchor.setAttribute("href", "source#^source"); anchor.appendChild(docNode.createTextNode("Source")); row.appendChild(anchor);
  list.appendChild(row);
  root.appendChild(ownerLi);
  await plugin.renderRelationChipsIn(root, { sourcePath: "target.md", getSectionInfo: () => ({ lineStart: 0, lineEnd: 1 }) });
  assert.ok(row.className.includes("bob-relation-row"));
  assert.equal(findByClass(row, "bob-relation-pill")[0].textContent, "💬 mentioned in");
  assert.equal(findByClass(row, "bob-mention-quote-target")[0].textContent, "this task");
  assert.equal(findByClass(row, "bob-dep-chip-remove").length, 0);
  const pill = findByClass(row, "bob-relation-pill")[0];
  assert.equal(pill.getAttribute("aria-haspopup"), "dialog");
  assert.equal(pill.getAttribute("role"), "button");
  fire(anchor, "click", { metaKey: true });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(opened, [["source#^source", "target.md", true]]);

  fire(pill, "click");
  let card = findByClass(docNode.body, "bob-mention-card")[0];
  assert.ok(card);
  assert.equal(card.getAttribute("role"), "dialog");
  assert.equal(card.getAttribute("aria-label"), "💬 Mentioned in another task's text · not a relation");
  assert.match(card.textContent, /mentioned 4× in this task/);
  assert.match(card.textContent, /\+1 more/);
  assert.equal(findByClass(card, "bob-mention-card-occurrence").length, 3);
  assert.match(card.textContent, /in a note under it/);
  assert.match(card.textContent, /in its Cancel Log/);
  assert.match(card.textContent, /in its Work Log/);

  fire(card, "keydown", { key: "Escape" });
  assert.equal(findByClass(docNode.body, "bob-mention-card").length, 0);
  assert.equal(docNode.activeElement, pill, "Escape returns focus to the pill");
  await new Promise((resolve) => setTimeout(resolve, 5));

  pill.focus();
  card = findByClass(docNode.body, "bob-mention-card")[0];
  assert.ok(card, "keyboard focus opens the card");
  const occurrences = findByClass(card, "bob-mention-card-occurrence");
  fire(pill, "keydown", { key: "ArrowDown" });
  assert.equal(docNode.activeElement, occurrences[0], "arrow navigation enters the first occurrence");
  fire(card, "keydown", { key: "ArrowRight", target: occurrences[0] });
  assert.equal(docNode.activeElement, occurrences[1], "arrow navigation advances between occurrences");
  let openedOccurrence = null;
  plugin.relationOpenMention = (...args) => { openedOccurrence = args[3]; return true; };
  fire(occurrences[1], "click");
  assert.equal(openedOccurrence.line, 5, "clicking an occurrence opens that location");
  assert.equal(findByClass(docNode.body, "bob-mention-card").length, 0);
  plugin.teardownRelationIndex();
});

test("mention card hover waits, and moving the pointer onto the card keeps it open", async () => {
  const source = task({ blockId: "source", id: "source", description: "Source task", path: "source.md" });
  const model = relationChipModelForRow({
    direction: "from",
    lineText: "- 🪢 **LINKED FROM:** [[source#^source]] (💬 mentions)",
    sourcePath: "target.md",
    live: [liveMention(source, { occurrences: [{ line: 3, ch: 8, site: "note", excerpt: "See ⟦this task⟧" }] })],
    lookup: lookupFor([source], "target.md"),
    resolve: resolveFor("target.md"),
  });
  const plugin = new LedgerToolsPlugin(makeApp([source]), {});
  const doc = new MiniDoc();
  const row = buildRelationChipElement(doc, model, {
    onMention: (chip, pill, event, reason) => plugin.relationOpenMentionCard(chip, "target.md", pill, event, reason),
    onMentionLeave: (pill) => plugin.relationMentionCardPointerLeave(pill),
    onMentionClose: (pill, event, restoreFocus) => plugin.relationCloseMentionCard(Boolean(restoreFocus), pill),
    onMentionNavigate: (pill, event, direction) => plugin.relationMentionCardNavigate(pill, direction),
  });
  const pill = findByClass(row, "bob-relation-pill")[0];
  fire(pill, "mouseenter");
  assert.equal(findByClass(doc.body, "bob-mention-card").length, 0, "hover uses a delay");
  await new Promise((resolve) => setTimeout(resolve, 440));
  const card = findByClass(doc.body, "bob-mention-card")[0];
  assert.ok(card, "hover opens the card after the delay");
  fire(pill, "mouseleave");
  fire(card, "mouseenter");
  await new Promise((resolve) => setTimeout(resolve, 240));
  assert.equal(findByClass(doc.body, "bob-mention-card").length, 1, "hovering the card cancels dismissal");
  fire(card, "mouseleave");
  await new Promise((resolve) => setTimeout(resolve, 240));
  assert.equal(findByClass(doc.body, "bob-mention-card").length, 0, "the card closes after pointer exit");
});

test("Reading view hides only host-note embedded mentions inside a transclusion", async () => {
  const onlyTask = task({ blockId: "only", id: "only", description: "Only echo", path: "target.md" });
  const mixedTask = task({ blockId: "mixed", id: "mixed", description: "Mixed echo", path: "target.md" });
  const host = task({ blockId: "host-source", id: "host-source", description: "Host source", path: "host.md" });
  const other = task({ blockId: "other-source", id: "other-source", description: "Other source", path: "other.md" });
  const content = [
    "- [ ] #task Only echo ^only",
    "  - 🪢 **LINKED FROM:** [[host#^host-source]] (💬 mentions)",
    "- [ ] #task Mixed echo ^mixed",
    "  - 🪢 **LINKED FROM:** [[host#^host-source]] (💬 mentions) • [[other#^other-source]] (💬 mentions)",
  ].join("\n");
  const app = makeApp([onlyTask, mixedTask, host, other], "", null, [{ path: "target.md", content }]);
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.dependencyChipsEnabled = true;
  const hostEdge = {
    kind: "mention", source: { path: "host.md", blockId: "host-source", text: "Host source", status: "TODO" },
    display: "embed", count: 1, occurrences: [{ line: 3, ch: 12, site: "note", excerpt: null }],
  };
  const otherEdge = {
    kind: "mention", source: { path: "other.md", blockId: "other-source", text: "Other source", status: "TODO" },
    display: "embed", count: 1, occurrences: [{ line: 5, ch: 12, site: "note", excerpt: null }],
  };
  plugin.relationIndexApi = () => ({
    linkedFrom: (path, id) => id === "only" ? [hostEdge] : id === "mixed" ? [hostEdge, otherEdge] : [],
  });
  plugin.relationLookupTask = (path, id) => path === "host.md" && id === "host-source" ? host
    : path === "other.md" && id === "other-source" ? other : null;
  plugin.relationResolveLinkpath = (linkpath) => {
    const path = String(linkpath || "").split("#")[0];
    return path ? path + ".md" : "target.md";
  };

  const doc = new MiniDoc();
  const preview = doc.createElement("div");
  preview.classList.add("markdown-preview-view");
  app.workspace.getLeavesOfType = () => [{ view: { file: { path: "host.md" }, containerEl: preview } }];
  const embed = doc.createElement("div");
  embed.classList.add("markdown-embed");
  embed.setAttribute("data-path", "target.md");
  const embeddedContent = doc.createElement("div");
  embed.appendChild(embeddedContent);
  preview.appendChild(embed);
  const addOwner = (id, description, links) => {
    const owner = doc.createElement("li");
    owner.appendChild(doc.createTextNode("#task " + description));
    const list = doc.createElement("ul");
    owner.appendChild(list);
    const row = doc.createElement("li");
    row.appendChild(doc.createTextNode("🪢 "));
    const strong = doc.createElement("strong");
    strong.appendChild(doc.createTextNode("LINKED FROM:"));
    row.appendChild(strong);
    row.appendChild(doc.createTextNode(" "));
    for (let index = 0; index < links.length; index += 1) {
      if (index > 0) row.appendChild(doc.createTextNode(" • "));
      const anchor = doc.createElement("a");
      anchor.classList.add("internal-link");
      anchor.setAttribute("data-href", links[index]);
      anchor.setAttribute("href", links[index]);
      anchor.appendChild(doc.createTextNode(links[index]));
      row.appendChild(anchor);
    }
    list.appendChild(row);
    embeddedContent.appendChild(owner);
    return row;
  };
  const echoOnlyRow = addOwner("only", "Only echo", ["host#^host-source"]);
  const mixedRow = addOwner("mixed", "Mixed echo", ["host#^host-source", "other#^other-source"]);
  await plugin.renderRelationChipsIn(embeddedContent, {
    sourcePath: "target.md",
    getSectionInfo: () => ({ lineStart: 0, lineEnd: 3 }),
  });
  assert.equal(echoOnlyRow.style.display, "none", "an echo-only row is hidden in its host transclusion");
  assert.equal(echoOnlyRow.getAttribute("aria-hidden"), "true");
  assert.equal(findByClass(echoOnlyRow, "bob-relation-pill").length, 0);
  assert.equal(findByClass(mixedRow, "bob-relation-pill").length, 1, "a mention from another source remains");
  assert.equal(findByClasses(mixedRow, ["bob-relation-chip", "is-mention"])[0].textContent.includes("Other source"), true);
  assert.equal(findByClass(mixedRow, "bob-relation-chip").length, 1);
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

test("MN row model separates relations and mentions, marks mixed pairs, and quotes the first prose occurrence", () => {
  const relationSource = task({ blockId: "rel", id: "rel", path: "sources.md", description: "Related source" });
  const mentionSource = task({ blockId: "mention", id: "mention", path: "sources.md", description: "Mention source" });
  const occurrences = [
    { line: 4, ch: 22, site: "note", excerpt: "Merged into ⟦this task⟧ after review" },
    { line: 7, ch: 6, site: "cancel_log", excerpt: "Also mentions ⟦the old plan⟧ here" },
  ];
  const model = relationChipModelForRow({
    direction: "from",
    lineText: "- 🪢 **LINKED FROM:** [[sources#^rel]] (follow-up of) • [[sources#^mention]] (💬 mentions)",
    sourcePath: "target.md",
    live: [
      { kind: "relation", label: "follow-up of", alsoMentioned: true, other: { path: "sources.md", blockId: "rel", resolved: true, task: relationSource } },
      liveMention(mentionSource, { count: 2, occurrences }),
    ],
    lookup: lookupFor([relationSource, mentionSource], "target.md"),
    resolve: resolveFor("target.md"),
  });
  assert.equal(model.tooltip, "Tasks linking here · relations and 💬 text mentions · live");
  assert.deepEqual(model.chips.map((chip) => chip.kind), ["relation", "mention"]);
  assert.equal(model.groups.relations.chips[0].alsoMentioned, true);
  assert.equal(model.groups.mentions.chips[0].count, 2);
  assert.equal(model.groups.mentions.chips[0].quote, "Merged into ⟦this task⟧ after review");

  const doc = new MiniDoc();
  const opened = [];
  const row = buildRelationChipElement(doc, model, {
    interactive: true,
    onOpen: (...args) => opened.push(args),
    onRemove() {},
  });
  assert.equal(findByClass(row, "bob-relation-divider").length, 1);
  assert.equal(findByClass(row, "bob-relation-mixed-marker")[0].getAttribute("title"), "Also mentioned in its text");
  assert.equal(findByClass(row, "bob-relation-pill").map((pill) => pill.textContent).join("|"), "followed up by|💬 mentioned in");
  assert.equal(findByClass(row, "bob-mention-quote-target")[0].textContent, "this task");
  const mentionChip = findByClasses(row, ["bob-relation-chip", "is-mention"])[0];
  assert.equal(findByClass(mentionChip, "bob-dep-chip-remove").length, 0, "mentions have no remove control");
  assert.equal(findByClass(row, "bob-dep-chip-remove").length, 1, "the authored relation retains its remove control");
  fire(mentionChip, "click", { metaKey: true });
  assert.equal(opened.length, 1);
  assert.equal(opened[0][2].kind, "mention");
  assert.equal(opened[0][1].metaKey, true);
});

test("MN quote rules omit title/embed excerpts and fit Unicode around the highlighted token", () => {
  const source = task({ blockId: "s", id: "s", path: "b.md", description: "Source" });
  const titleModel = relationChipModelForRow({
    direction: "from", lineText: "- 🪢 **LINKED FROM:** [[b#^s]] (💬 mentions)", sourcePath: "a.md",
    live: [liveMention(source, { occurrences: [{ line: 1, ch: 8, site: "title", excerpt: null }] })],
    lookup: lookupFor([source]), resolve: resolveFor(),
  });
  assert.equal(titleModel.chips[0].quote, null);
  const embedModel = relationChipModelForRow({
    direction: "from", lineText: "- 🪢 **LINKED FROM:** [[b#^s]] (💬 mentions)", sourcePath: "a.md",
    live: [liveMention(source, { display: "embed", occurrences: [{ line: 3, ch: 4, site: "note", excerpt: null }] })],
    lookup: lookupFor([source]), resolve: resolveFor(),
  });
  assert.equal(embedModel.chips[0].mentionPill, "💬 embedded in");
  assert.equal(embedModel.chips[0].quote, null);
  const marked = relationFitMentionQuote("一二三四五六七八九十十一十二十三十四十五十六十七十八十九二十 ⟦the old plan⟧ end of the very long line", 80);
  assert.ok(Array.from(marked).length <= 80);
  assert.match(marked, /⟦the old plan⟧/);
});

test("MN stale mention rows keep the mention-specific dashed tooltip", () => {
  const source = task({ blockId: "s", id: "s", path: "b.md", description: "Source" });
  const model = relationChipModelForRow({
    direction: "from", lineText: "- 🪢 **LINKED FROM:** [[b#^s]] (💬 mentions)", sourcePath: "a.md",
    live: [], lookup: lookupFor([source]), resolve: resolveFor(),
  });
  const chip = model.chips[0];
  assert.equal(chip.kind, "mention");
  assert.equal(chip.stale, true);
  assert.equal(chip.tooltip, "No longer mentioned here · refreshes on the next reconcile");
  const row = buildRelationChipElement(new MiniDoc(), model, { interactive: true });
  assert.ok(findByClass(row, "bob-relation-chip")[0].className.includes("is-stale"));
  assert.equal(findByClass(row, "bob-dep-chip-remove").length, 0);
});

test("MN seven open mentions collapse after five and expand with +N more", () => {
  const sources = Array.from({ length: 7 }, (_, index) => task({ blockId: "s" + index, id: "s" + index, path: "sources.md", description: "Source " + index }));
  const links = sources.map((source) => "[[sources#^" + source.id + "]] (💬 mentions)").join(" • ");
  const model = relationChipModelForRow({
    direction: "from", lineText: "- 🪢 **LINKED FROM:** " + links, sourcePath: "target.md",
    live: sources.map((source) => liveMention(source)), lookup: lookupFor(sources, "target.md"), resolve: resolveFor("target.md"),
  });
  assert.deepEqual(model.groups.mentions.more, { count: 2 });
  assert.equal(model.groups.mentions.chips.filter((chip) => chip.densityCollapsed).length, 2);
  const row = buildRelationChipElement(new MiniDoc(), model, {});
  assert.equal(findByClasses(row, ["bob-relation-chip", "is-mention"]).length, 5);
  const more = findByClass(row, "bob-relation-more")[0];
  assert.equal(more.textContent, "+2 more");
  fire(more, "click");
  assert.equal(findByClasses(row, ["bob-relation-chip", "is-mention"]).length, 7);
  assert.equal(findByClass(row, "bob-relation-more").length, 0);
});

test("MN linkedFrom v2 feeds mention rows and relationIndex v1 remains a fallback", () => {
  const source = task({ blockId: "s", id: "s", path: "b.md", description: "Source" });
  const plugin = new LedgerToolsPlugin(makeApp([source]), {});
  plugin.relationIndexApi = () => ({
    linkedFrom: () => [{
      kind: "mention", source: { path: "b.md", blockId: "s", line: 1, text: "Source", status: "TODO" },
      display: "mention", count: 1, occurrences: [{ line: 6, ch: 12, site: "note", excerpt: "See ⟦this task⟧" }],
    }],
    incoming: () => { throw new Error("v2 must use linkedFrom"); },
  });
  plugin.relationLookupTask = () => source;
  plugin.relationResolveLinkpath = () => "b.md";
  const owner = { blockId: "target", line: 2 };
  const v2 = plugin.relationChipModelForLine({ path: "a.md", text: "- 🪢 **LINKED FROM:** [[b#^s]] (💬 mentions)", owner });
  assert.equal(v2.chips[0].kind, "mention");
  assert.equal(v2.chips[0].occurrences[0].line, 6);

  let incomingCalls = 0;
  plugin.relationIndexApi = () => ({ incoming: () => { incomingCalls += 1; return [{ label: "follow-up of", source: { path: "b.md", blockId: "s", task: source } }]; } });
  const v1 = plugin.relationChipModelForLine({ path: "a.md", text: "- 🪢 **LINKED FROM:** [[b#^s]] (follow-up of)", owner });
  assert.equal(incomingCalls, 1);
  assert.equal(v1.chips[0].kind, "relation");
  assert.equal(v1.chips[0].inverse, "followed up by");
});

test("MN click opens the source at its occurrence line and column, with Mod-click using a new pane", async () => {
  const opened = [];
  const cursor = [];
  const sourceView = { file: { path: "sources.md" }, editor: { setCursor: (...args) => cursor.push(["cursor", ...args]), focus: () => cursor.push(["focus"]) } };
  const app = makeApp([]);
  app.workspace.openLinkText = (...args) => { opened.push(args); return Promise.resolve(); };
  app.workspace.getLeavesOfType = () => [{ view: sourceView }];
  app.workspace.getActiveViewOfType = () => sourceView;
  const plugin = new LedgerToolsPlugin(app, {});
  const chip = { kind: "mention", path: "sources.md", linktext: "sources#^s", occurrences: [{ line: 4, ch: 22 }] };
  assert.equal(plugin.relationOpenMention(chip, "target.md", { metaKey: true }), true);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(opened, [["sources#^s", "target.md", true]]);
  assert.deepEqual(cursor, [["cursor", 3, 22], ["focus"]]);
});
