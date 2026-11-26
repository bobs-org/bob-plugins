// Notebook Card local model, shell DOM, and mounted-card fallback contract.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin {
  constructor(app) { this.app = app; }
  registerEditorExtension() {}
  registerMarkdownPostProcessor() {}
  registerEvent() {}
}

const editorInfoField = { info: true };
const editorLivePreviewField = { live: true };
const StateEffect = { define: () => { const type = { of(value) { return { type, value, is: (other) => other === type }; } }; return type; } };
class WidgetType {}
class RangeSetBuilder { constructor() { this.rows = []; } add(from, to, deco) { this.rows.push({ from, to, deco }); } finish() { return this.rows; } }
const Decoration = { none: [], widget: (options) => ({ ...options }) };
const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownRenderChild: class {}, MarkdownView: class {}, Notice: class {}, Plugin: TestPlugin,
    Platform: { isDesktopApp: true }, normalizePath: (value) => value, parseYaml: () => ({}),
    editorInfoField, editorLivePreviewField,
  };
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value }, StateEffect, RangeSetBuilder };
  if (request === "@codemirror/view") return {
    Decoration, WidgetType, ViewPlugin: { fromClass: (cls, options) => ({ cls, options }) },
    EditorView: { editorAttributes: { of: (attributes) => attributes } },
  };
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers: H } = LedgerToolsPlugin;
Module._load = originalLoad;

class FakeText {
  constructor(text, doc) { this.nodeType = 3; this.nodeValue = String(text); this.ownerDocument = doc; this.parentNode = null; }
  get textContent() { return this.nodeValue; }
  contains(node) { return node === this; }
}

class FakeNode {
  constructor(tag, doc) {
    this.tagName = String(tag).toUpperCase();
    this.nodeType = 1;
    this.ownerDocument = doc;
    this.parentNode = null;
    this.childNodes = [];
    this.attrs = new Map();
    this.listeners = new Map();
    const self = this;
    this.classList = {
      add(name) { const xs = new Set(self.className.split(/\s+/).filter(Boolean)); xs.add(name); self.setAttribute("class", [...xs].join(" ")); },
      remove(name) { self.setAttribute("class", self.className.split(/\s+/).filter((x) => x && x !== name).join(" ")); },
      contains(name) { return self.className.split(/\s+/).includes(name); },
    };
  }
  get className() { return this.getAttribute("class") || ""; }
  get children() { return this.childNodes.filter((node) => node.nodeType === 1); }
  get textContent() { return this.childNodes.map((node) => node.textContent).join(""); }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  hasAttribute(name) { return this.attrs.has(name); }
  appendChild(node) { node.parentNode?.removeChild?.(node); node.parentNode = this; this.childNodes.push(node); return node; }
  insertBefore(node, before) {
    node.parentNode?.removeChild?.(node);
    const at = before ? this.childNodes.indexOf(before) : -1;
    node.parentNode = this;
    if (at < 0) this.childNodes.push(node); else this.childNodes.splice(at, 0, node);
    return node;
  }
  removeChild(node) { const i = this.childNodes.indexOf(node); if (i >= 0) this.childNodes.splice(i, 1); node.parentNode = null; return node; }
  contains(node) { return node === this || this.childNodes.some((child) => child.contains(node)); }
  addEventListener(type, callback) { const list = this.listeners.get(type) || []; list.push(callback); this.listeners.set(type, list); }
  fire(type, extra = {}) {
    const event = { type, button: 0, ...extra, preventDefault() { this.defaultPrevented = true; } };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }
  matches(selector) {
    return String(selector).split(",").some((raw) => {
      const part = raw.trim();
      const tag = /^([a-z][a-z0-9-]*)/i.exec(part)?.[1];
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      for (const cls of part.match(/\.[\w-]+/g) || []) if (!this.classList.contains(cls.slice(1))) return false;
      for (const [, name, value] of part.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
        if (!this.hasAttribute(name)) return false;
        if (value !== undefined && this.getAttribute(name) !== value) return false;
      }
      return true;
    });
  }
  closest(selector) { let node = this; while (node) { if (node.nodeType === 1 && node.matches(selector)) return node; node = node.parentNode; } return null; }
  querySelectorAll(selector) {
    const found = [];
    const walk = (node) => { for (const child of node.children) { if (child.matches(selector)) found.push(child); walk(child); } };
    walk(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function makeDoc() {
  return {
    createElement(tag) { return new FakeNode(tag, this); },
    createTextNode(text) { return new FakeText(text, this); },
  };
}

const headingSource = "---\ntype: [[notebook]]\naliases: [Alias]\nsummary: A short summary\n---\n# Opening Title\n\nBody text.\n";

test("notebook model uses opening H1, alias, and humanized stem in order", () => {
  const headed = H.notebookCardModel({
    path: "Notes/Developer_tools.md",
    frontmatter: { type: "[[notebook]]", aliases: ["Alias"], summary: "A short summary" },
    sourceText: headingSource,
  });
  assert.equal(headed.title.text, "Opening Title");
  assert.equal(headed.title.source, "h1");
  assert.equal(headingSource.slice(headed.title.range.from, headed.title.range.to), "Opening Title");
  assert.equal(headed.summary, "A short summary");
  assert.equal(headed.summaryMissing, false);

  const alias = H.notebookCardModel({
    path: "Notes/Developer_tools.md", frontmatter: { type: "notebook", aliases: ["Alias"] },
  });
  assert.equal(alias.title.text, "Alias");
  assert.equal(alias.title.source, "alias");
  assert.equal(alias.summaryMissing, true);

  const stem = H.notebookCardModel({ path: "Notes/Developer_tools.md", frontmatter: { type: "[[notebook]]" } });
  assert.equal(stem.title.text, "Developer tools");
  assert.equal(stem.title.source, "stem");
  assert.equal(stem.route, "@Developer_tools");
});

test("notebook model reuses ancestry, preserves a four-crumb cap, and puts hue on the root", () => {
  const headerModel = { crumbs: [
    { kind: "root", path: "Areas/Dev.md", stem: "Dev", title: "Development" },
    { kind: "notebook", path: "Notes/Parent.md", stem: "Parent", title: "Parent note" },
    { kind: "notebook", path: "Notes/Child.md", stem: "Child", title: "Child note" },
    { kind: "self", path: "Notes/Leaf.md", stem: "Leaf", title: "Leaf" },
  ] };
  const row = H.notebookCardModel({
    path: "Notes/Leaf.md", frontmatter: { type: "[[notebook]]" }, headerModel, hue: "blue",
  });
  assert.deepEqual(row.crumbs.map((crumb) => crumb.text), ["Development", "Parent note", "Child note"]);
  assert.equal(row.crumbs[0].pip, "blue");
  assert.equal(row.crumbs[0].kind, "root");
  assert.equal(row.crumbs[1].pip, undefined);
  assert.equal(row.crumbs.at(-1).target, "Notes/Child.md");
  assert.equal(H.notebookCardModel({ path: "done/old.md", frontmatter: { type: "[[notebook]]" } }), null);
  assert.equal(H.notebookCardModel({ path: "Notes/plain.md", frontmatter: { type: "[[prose]]" } }), null);
});

test("notebook DOM builds accessible spine identity, fold, summary ghost, route, and reserved report slot", () => {
  const doc = makeDoc();
  const model = H.notebookCardModel({
    path: "Notes/Developer_tools.md",
    frontmatter: { type: "[[notebook]]", summary: "A short summary" },
    sourceText: headingSource,
    headerModel: { crumbs: [{ kind: "root", path: "Areas/Dev.md", title: "Development" }] },
    hue: "green",
  });
  const opened = [];
  const links = [];
  const folds = [];
  const card = H.notebookCardBuildEl(doc, model, {
    onAddSummary: () => opened.push(true),
    onLink: (target) => links.push(target),
    onToggleFold: (collapsed) => folds.push(collapsed),
    appendFoot: (parent, current, ownerDoc) => {
      const foot = ownerDoc.createElement("div");
      foot.setAttribute("class", "bob-property-card-foot");
      parent.appendChild(foot);
    },
  });
  assert.ok(card.classList.contains("bob-home-card"));
  assert.equal(card.getAttribute("data-card-kind"), "notebook");
  assert.equal(card.getAttribute("aria-label"), "Notebook: Opening Title");
  assert.equal(card.querySelector(".bob-property-card-tile").getAttribute("data-tile-form"), "spine");
  assert.equal(card.querySelector(".bob-property-card-title").textContent, "Opening Title");
  const crumb = card.querySelector(".bob-property-card-kicker-link");
  assert.equal(crumb.textContent, "Development");
  assert.equal(crumb.querySelector(".bob-property-card-kicker-pip").getAttribute("data-root-hue"), "green");
  crumb.fire("click");
  assert.deepEqual(links, ["Areas/Dev.md"]);
  assert.equal(card.querySelector(".bob-notebook-card-summary").textContent, "A short summary");
  assert.equal(card.querySelector(".bob-notebook-card-readouts").getAttribute("data-state"), "reserved");
  assert.ok(card.querySelector(".bob-property-card-foot"));
  const fold = card.querySelector(".bob-notebook-card-fold");
  assert.ok(card.querySelector(".bob-notebook-card-details"));
  assert.equal(card.querySelectorAll(`[id="${fold.getAttribute("aria-controls")}"]`).length, 1, "the controlled accessibility target has one stable id");
  fold.fire("click");
  assert.deepEqual(folds, [true]);

  const ghost = H.notebookCardBuildEl(doc, { ...model, summary: "", summaryMissing: true }, {
    onAddSummary: () => opened.push(true),
  }).querySelector(".bob-notebook-card-add-summary");
  assert.equal(ghost.textContent, "＋ Add summary");
  ghost.fire("click");
  assert.deepEqual(opened, [true]);
});

test("the header fallback recognizes a mounted Reading card and a Live Preview widget", () => {
  const root = makeDoc().createElement("div");
  const readingCard = root.ownerDocument.createElement("section");
  readingCard.setAttribute("class", "bob-notebook-card");
  readingCard.setAttribute("data-notebook-source", "Notes/Leaf.md");
  root.appendChild(readingCard);
  assert.equal(H.notebookCardMountedInSurface(root, "Notes/Leaf.md"), true);
  assert.equal(H.notebookCardMountedInSurface(root, "Notes/Other.md"), false);

  const editor = root.ownerDocument.createElement("div");
  editor.setAttribute("class", "cm-editor");
  const widget = root.ownerDocument.createElement("section");
  widget.setAttribute("class", "bob-notebook-card");
  widget.setAttribute("data-notebook-source", "Notes/Leaf.md");
  widget.setAttribute("data-cm-widget", "true");
  editor.appendChild(widget);
  assert.equal(H.notebookCardMountedInSurface(editor, "Notes/Leaf.md"), true);
});
