const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin {
  constructor(app) { this.app = app; }
  registerEditorExtension() {}
  registerMarkdownPostProcessor() {}
  registerEvent() {}
}
class TestNotice { constructor(message) { TestNotice.messages.push(String(message)); } }
TestNotice.messages = [];

const editorInfoField = { info: true };
const editorLivePreviewField = { live: true };
const StateEffect = { define: () => ({ of(value) { return { effect: this, value }; }, is(other) { return this === other; } }) };
class WidgetType {}
class RangeSetBuilder { constructor() { this.rows = []; } add(from, to, deco) { this.rows.push({ from, to, deco }); } finish() { return this.rows; } }
const Decoration = { none: [], widget: (options) => ({ widget: options.widget, side: options.side }) };
const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownRenderChild: class { constructor(el) { this.containerEl = el; } },
    Notice: TestNotice, Plugin: TestPlugin, Platform: { isDesktopApp: true },
    normalizePath: (value) => value, editorInfoField, editorLivePreviewField,
  };
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value }, StateEffect, RangeSetBuilder };
  if (request === "@codemirror/view") return {
    Decoration, WidgetType, ViewPlugin: { fromClass: (cls, options) => ({ cls, options }) },
  };
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers } = LedgerToolsPlugin;
Module._load = originalLoad;

class FakeNode {
  constructor(tag, doc, text = "") {
    this.tagName = tag ? tag.toUpperCase() : "#TEXT";
    this.nodeType = tag ? 1 : 3;
    this.ownerDocument = doc;
    this.parentNode = null;
    this.children = [];
    this.attrs = new Map();
    this.listeners = new Map();
    this._text = text;
    this.disabled = false;
    const self = this;
    this.classList = {
      add(name) { const xs = new Set((self.getAttribute("class") || "").split(/\s+/).filter(Boolean)); xs.add(name); self.setAttribute("class", [...xs].join(" ")); },
      remove(name) { const xs = (self.getAttribute("class") || "").split(/\s+/).filter((x) => x && x !== name); self.setAttribute("class", xs.join(" ")); },
      contains(name) { return (self.getAttribute("class") || "").split(/\s+/).includes(name); },
    };
  }
  get textContent() { return this.nodeType === 3 ? this._text : this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { this._text = String(value); if (this.nodeType === 1) this.children = [new FakeNode("", this.ownerDocument, this._text)]; }
  get firstChild() { return this.children[0] || null; }
  get nextSibling() { const xs = this.parentNode?.children || []; return xs[xs.indexOf(this) + 1] || null; }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  removeAttribute(name) { this.attrs.delete(name); }
  appendChild(node) { node.parentNode?.removeChild?.(node); node.parentNode = this; this.children.push(node); return node; }
  insertBefore(node, before) { node.parentNode?.removeChild?.(node); node.parentNode = this; const i = this.children.indexOf(before); this.children.splice(i < 0 ? this.children.length : i, 0, node); return node; }
  removeChild(node) { const i = this.children.indexOf(node); if (i >= 0) this.children.splice(i, 1); node.parentNode = null; return node; }
  remove() { this.parentNode?.removeChild?.(this); }
  addEventListener(type, fn) { const rows = this.listeners.get(type) || []; rows.push(fn); this.listeners.set(type, rows); }
  fire(type) { for (const fn of this.listeners.get(type) || []) fn({ preventDefault() {} }); }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  focus() { this.ownerDocument.activeElement = this; }
  matches(selector) {
    return String(selector).split(",").some((part) => {
      const value = part.trim();
      const cls = /^\.([\w-]+)$/.exec(value);
      const tag = /^[a-z][\w-]*$/i.exec(value);
      const attr = /^\[([\w-]+)="([^"]+)"\]$/.exec(value);
      return Boolean((cls && this.classList.contains(cls[1])) || (tag && this.tagName === tag[0].toUpperCase()) || (attr && this.getAttribute(attr[1]) === attr[2]));
    });
  }
  closest(selector) { let node = this; while (node) { if (node.nodeType === 1 && node.matches(selector)) return node; node = node.parentNode; } return null; }
  querySelectorAll(selector) { const found = []; const walk = (node) => { for (const child of node.children || []) { if (child.matches(selector)) found.push(child); walk(child); } }; walk(this); return found; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function makeDoc() {
  return {
    activeElement: null,
    createElement(tag) { return new FakeNode(tag, this); },
    createTextNode(text) { return new FakeNode("", this, String(text)); },
  };
}
function node(doc, tag, cls = "", text = "") {
  const item = doc.createElement(tag);
  if (cls) item.setAttribute("class", cls);
  if (text) item.appendChild(doc.createTextNode(text));
  return item;
}

const album = (overrides = {}) => ({
  path: "eat.md", stem: "eat", title: "Restaurants", noun: "restaurant",
  parent: "body", parent_kind: "area", owner: "body", root: "body",
  breadcrumb: ["This is only a display string"], fields: [], issues: [],
  index: { state: "current" }, ...overrides,
});
function report(entry = album()) {
  return helpers.albumIndexReport({ schema_version: 1, ok: true, albums: [entry], catalogs: [], counts: {} });
}
function fixture(entry = album()) {
  const doc = makeDoc();
  const files = new Map(["eat.md", "body.md"].map((path) => [path, { path }]));
  const caches = new Map([
    ["eat.md", { frontmatter: { type: "[[album]]" }, headings: [{ level: 1, heading: "Restaurants" }] }],
    ["body.md", { frontmatter: { type: "[[area]]", root_parent: true }, headings: [{ level: 1, heading: "Body" }] }],
  ]);
  const app = {
    vault: { getAbstractFileByPath: (path) => files.get(path) || null },
    metadataCache: {
      getFirstLinkpathDest: (target) => files.get(`${String(target).replace(/\.md$/i, "")}.md`) || null,
      getFileCache: (file) => caches.get(file?.path) || null,
    },
  };
  const plugin = new LedgerToolsPlugin(app);
  const state = { report: report(entry), stale: false };
  plugin.albumReportState = () => state;
  plugin.albumHeaderActive = true;
  plugin.albumHeaderReading = new Set();
  plugin.albumHeaderEditors = new Set();
  plugin.albumSetTimeout = setTimeout;
  plugin.albumClearTimeout = clearTimeout;
  plugin.notebookCatalogLivePath = (view) => view.path || null;
  return { app, caches, doc, plugin, state };
}

test("header resolves real parent paths and ignores breadcrumb labels", () => {
  const { app } = fixture();
  const model = helpers.albumHeaderModel(report(), "eat.md", {
    sourcePath: "eat.md", metadataCache: app.metadataCache, vault: app.vault,
  });
  assert.deepEqual(model.crumbs.map((crumb) => crumb.path), ["body.md", "eat.md"]);
  assert.deepEqual(model.crumbs.map((crumb) => crumb.title), ["Body", "Restaurants"]);
  assert.equal(model.captureText, "Name @eat/");
  const broken = helpers.albumHeaderModel(report(album({ parent: "missing" })), "eat.md", {
    sourcePath: "eat.md", metadataCache: app.metadataCache, vault: app.vault,
  });
  assert.equal(broken.broken, true);
  assert.deepEqual(broken.crumbs.map((crumb) => crumb.path), ["eat.md"]);
});

test("schema model preserves declaration and choice order; empty and invalid routes stay explicit", () => {
  const { app } = fixture();
  const fields = [
    { key: "status", label: "Status", kind: "text", required: true, list: false, choices: [{ value: "a", label: "First" }, { value: "b", label: "Second" }] },
    { key: "tags", label: "Tags", kind: "text", required: false, list: true, choices: [] },
  ];
  const model = helpers.albumHeaderModel(report(album({ fields })), "eat.md", {
    sourcePath: "eat.md", metadataCache: app.metadataCache, vault: app.vault,
  });
  assert.deepEqual(model.fields.map((field) => field.key), ["status", "tags"]);
  assert.deepEqual(model.fields[0].choices, ["First", "Second"]);
  assert.equal(model.fields[1].list, true);
  assert.equal(helpers.albumHeaderModel(report(album({ fields: [] })), "eat.md", {
    sourcePath: "eat.md", metadataCache: app.metadataCache, vault: app.vault,
  }).emptySchema, true);
  const noNoun = helpers.albumHeaderModel(report(album({ noun: null })), "eat.md", {
    sourcePath: "eat.md", metadataCache: app.metadataCache, vault: app.vault,
  });
  assert.equal(noNoun.captureText, "");
  assert.match(noNoun.routeReason, /noun/i);
  assert.equal(helpers.albumHeaderIsAlbumSource("---\ntype: [[album]]\n---"), true);
  assert.equal(helpers.albumHeaderIsAlbumSource("---\ntype: [[project]]\n---"), false);
});

test("broken schema remains visible and disables the capture route with its diagnostic", () => {
  const { app, plugin, doc } = fixture(album({
    noun: null,
    fields: undefined,
    issues: [{ severity: "error", code: "album_schema_invalid", message: "record.fields is invalid" }],
  }));
  const model = helpers.albumHeaderModel(report(album({
    noun: null,
    fields: undefined,
    issues: [{ severity: "error", code: "album_schema_invalid", message: "record.fields is invalid" }],
  })), "eat.md", { sourcePath: "eat.md", metadataCache: app.metadataCache, vault: app.vault });
  assert.match(model.routeReason, /record\.fields is invalid/);
  const root = node(doc, "div", "markdown-preview-view");
  plugin.paintAlbumHeaderReading(root, "eat.md");
  const button = root.querySelector(".bob-album-header-copy");
  assert.equal(button.disabled, true);
  assert.equal(root.querySelector(".bob-album-schema-empty").textContent, "No fields are declared for this album.");
  assert.equal(root.querySelector(".bob-album-schema-issue").textContent, "record.fields is invalid");
});

test("rendering is idempotent, keeps schema labels as text, scopes Properties, and clears on type change", () => {
  const { caches, doc, plugin } = fixture(album({
    fields: [{ key: "status", label: "<Status>", kind: "text", required: true, list: true,
      choices: [{ value: "a", label: "First" }, { value: "b", label: "Second" }] }],
  }));
  const root = node(doc, "div", "markdown-preview-view");
  const property = node(doc, "div");
  property.setAttribute("class", "metadata-property");
  property.setAttribute("data-property-key", "record");
  const h1 = node(doc, "h1", "", "Restaurants");
  root.appendChild(property);
  root.appendChild(h1);

  plugin.paintAlbumHeaderReading(root, "eat.md");
  plugin.paintAlbumHeaderReading(root, "eat.md");
  assert.equal(root.querySelectorAll(".bob-album-header").length, 1);
  assert.equal(root.classList.contains("bob-album-header-surface"), true);
  const header = root.querySelector(".bob-album-header");
  assert.equal(header.textContent.includes("<Status>"), true);
  assert.equal(header.querySelectorAll("script").length, 0);
  assert.equal(header.querySelectorAll(".bob-album-schema-field").length, 1);
  assert.equal(header.textContent.indexOf("First") < header.textContent.indexOf("Second"), true);
  assert.equal(header.querySelector(".bob-album-header-copy").getAttribute("title"), "Copy Name @eat/");

  const other = node(doc, "div", "markdown-preview-view");
  const otherProperty = node(doc, "div");
  otherProperty.setAttribute("class", "metadata-property");
  otherProperty.setAttribute("data-property-key", "record");
  other.appendChild(otherProperty);
  assert.equal(other.classList.contains("bob-album-header-surface"), false);

  caches.get("eat.md").frontmatter.type = "[[project]]";
  plugin.paintAlbumHeaderReading(root, "eat.md");
  assert.equal(root.querySelectorAll(".bob-album-header").length, 0);
  assert.equal(root.classList.contains("bob-album-header-surface"), false);
  assert.equal(property.parentNode, root);
});

test("clipboard failure is surfaced and does not mutate a note", async () => {
  const { plugin } = fixture();
  const model = helpers.albumHeaderModel(report(), "eat.md", {
    sourcePath: "eat.md", metadataCache: plugin.app.metadataCache, vault: plugin.app.vault,
  });
  const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async () => { throw new Error("denied"); } } } });
  TestNotice.messages.length = 0;
  try {
    const result = await plugin.albumHeaderCopyCapture(model);
    assert.equal(result.ok, false);
    assert.match(TestNotice.messages.at(-1), /Could not copy/);
  } finally {
    if (previous) Object.defineProperty(globalThis, "navigator", previous);
    else delete globalThis.navigator;
  }
});

test("Live Preview widgets follow album identity and remove the Properties scope on view switches", () => {
  const { doc, plugin } = fixture();
  const text = "---\ntype: [[album]]\n---\nbody";
  const lines = text.split("\n").map((line, i, rows) => {
    const from = rows.slice(0, i).reduce((sum, item) => sum + item.length + 1, 0);
    return { from, to: from + line.length };
  });
  const sourceView = node(doc, "div", "markdown-source-view");
  const root = node(doc, "div", "cm-editor");
  sourceView.appendChild(root);
  const view = { path: "eat.md", dom: root, state: {
    doc: { toString: () => text, line: (n) => lines[n - 1] },
  } };
  const decorations = plugin.buildAlbumHeaderDecorations(view);
  assert.equal(decorations.length, 1);
  assert.equal(sourceView.classList.contains("bob-album-header-surface"), true);
  assert.equal(decorations[0].deco.widget.toDOM().getAttribute("data-album-source"), "eat.md");
  view.path = "body.md";
  assert.deepEqual(plugin.buildAlbumHeaderDecorations(view), Decoration.none);
  assert.equal(sourceView.classList.contains("bob-album-header-surface"), false);
  view.path = "eat.md";
  plugin.buildAlbumHeaderDecorations(view);
  plugin.albumHeaderCleanEditor(view);
  assert.equal(sourceView.classList.contains("bob-album-header-surface"), false);
});

test("Reading lifecycle unload restores Properties visibility", () => {
  const { doc, plugin } = fixture();
  const root = node(doc, "div", "markdown-preview-view");
  let child;
  plugin.renderAlbumHeaderInReading(root, { sourcePath: "eat.md", addChild(value) { child = value; } });
  assert.equal(root.classList.contains("bob-album-header-surface"), true);
  child.onunload();
  assert.equal(root.classList.contains("bob-album-header-surface"), false);
  assert.equal(root.querySelectorAll(".bob-album-header").length, 0);
});

test("H1-less albums paint at the start and embeds keep their own property scope", () => {
  const { doc, plugin } = fixture();
  const parent = node(doc, "div", "markdown-preview-view");
  const embed = node(doc, "div", "markdown-embed");
  const content = node(doc, "div", "markdown-embed-content");
  const paragraph = node(doc, "p", "", "Album notes");
  content.appendChild(paragraph);
  embed.appendChild(content);
  parent.appendChild(embed);
  const widget = plugin.albumHeaderReadingRoot(paragraph);
  const header = plugin.paintAlbumHeaderReading(widget, "eat.md");
  assert.equal(header, content.children[0]);
  assert.equal(parent.classList.contains("bob-album-header-surface"), false);
  assert.equal(embed.classList.contains("bob-album-header-surface"), true);
  const secondPane = node(doc, "div", "markdown-preview-view");
  plugin.paintAlbumHeaderReading(secondPane, "eat.md");
  assert.equal(secondPane.querySelectorAll(".bob-album-header").length, 1);
  assert.equal(parent.children.filter((child) => child.classList.contains("bob-album-header")).length, 0);
});
