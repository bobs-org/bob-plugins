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
  empty() { while (this.firstChild) this.removeChild(this.firstChild); }
  remove() { this.parentNode?.removeChild?.(this); }
  addEventListener(type, fn) { const rows = this.listeners.get(type) || []; rows.push(fn); this.listeners.set(type, rows); }
  fire(type, event) {
    const payload = event || { preventDefault() {} };
    for (const fn of this.listeners.get(type) || []) fn(payload);
  }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  focus() { if (!this.disabled) this.ownerDocument.activeElement = this; }
  setSelectionRange(start, end, direction = "none") { this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction; }
  dispatchEvent(event) {
    const payload = event || {};
    if (!payload.target) payload.target = this;
    let current = this;
    while (current) {
      for (const callback of current.listeners?.get?.(payload.type) || []) callback(payload);
      current = current.parentNode;
    }
    return true;
  }
  click() { if (!this.disabled) this.dispatchEvent({ type: "click", preventDefault() {} }); }
  matches(selector) {
    return String(selector).split(",").some((part) => {
      const value = part.trim();
      const cls = /^\.([\w-]+)$/.exec(value);
      const tag = /^[a-z][\w-]*$/i.exec(value);
      const attr = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(value);
      const taggedAttr = /^([a-z][\w-]*)\[([\w-]+)(?:="([^"]*)")?\]$/i.exec(value);
      const hasAttr = (name, expected) => this.attrs.has(name) && (expected === undefined || this.getAttribute(name) === expected);
      return Boolean((cls && this.classList.contains(cls[1])) || (tag && this.tagName === tag[0].toUpperCase()) ||
        (attr && hasAttr(attr[1], attr[2])) ||
        (taggedAttr && this.tagName === taggedAttr[1].toUpperCase() && hasAttr(taggedAttr[2], taggedAttr[3])));
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
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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
  const timers = new Map();
  let nextTimer = 0;
  plugin.albumSetTimeout = (fn) => { timers.set(++nextTimer, fn); return nextTimer; };
  plugin.albumClearTimeout = (timer) => timers.delete(timer);
  const flushReading = () => {
    const callbacks = [...timers.values()];
    timers.clear();
    callbacks.forEach((fn) => fn());
  };
  plugin.notebookCatalogLivePath = (view) => view.path || null;
  return { app, caches, doc, files, plugin, state, flushReading, timers };
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

test("owner ancestry stops without warning at the conventional type note or a direct non-home parent", () => {
  const { app, caches, files } = fixture();
  for (const [path, frontmatter] of [
    ["project.md", { type: "[[project]]", parent: "[[body]]" }],
    ["area.md", { parent: "[[type]]" }],
    ["notebook.md", { type: "[[notebook]]", parent: "[[missing]]" }],
  ]) {
    files.set(path, { path });
    caches.set(path, { frontmatter });
  }
  caches.get("body.md").frontmatter.parent = "[[area]]";
  for (const [parent, expected] of [
    ["project", ["body.md", "project.md", "eat.md"]],
    ["notebook", ["eat.md"]],
  ]) {
    const model = helpers.albumHeaderModel(report(album({ parent })), "eat.md", app);
    assert.deepEqual(model.crumbs.map((crumb) => crumb.path), expected);
    assert.equal(model.broken, false);
    assert.equal(model.cyclic, false);
    assert.equal(model.truncated, false);
    assert.equal(model.ancestryMessage, "");
  }
});

test("missing, malformed, cyclic, and depth-limited owner chains still warn", () => {
  for (const [parent, rawParent, flag] of [
    [null, undefined, "broken"],
    ["missing", undefined, "broken"],
    ["body", "[[missing]]", "broken"],
    ["body", "not a wikilink", "broken"],
    ["body", { invalid: true }, "broken"],
    ["body", "[[body]]", "cyclic"],
    ["body", "[[deep0]]", "truncated"],
  ]) {
    const { app, caches, files } = fixture();
    caches.get("body.md").frontmatter.parent = rawParent;
    for (let i = 0; i < 9; i += 1) {
      files.set(`deep${i}.md`, { path: `deep${i}.md` });
      caches.set(`deep${i}.md`, { frontmatter: { type: "[[project]]", parent: `[[deep${i + 1}]]` } });
    }
    const model = helpers.albumHeaderModel(report(album({ parent })), "eat.md", app);
    assert.equal(model[flag], true, `${parent}: ${JSON.stringify(rawParent)}`);
    assert.match(model.ancestryMessage, /only confirmed notes are linked/);
  }
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
  assert.deepEqual(model.fields[0].choices.map((choice) => choice.label), ["First", "Second"]);
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
  assert.match(root.querySelector(".bob-album-schema-summary").textContent, /record\.fields is invalid/);
  assert.equal(root.querySelector(".bob-album-schema-summary").getAttribute("aria-expanded"), "true");
  assert.equal(root.querySelector(".bob-album-schema-empty"), null);
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
  const { doc, plugin, flushReading } = fixture();
  const root = node(doc, "div", "markdown-preview-view");
  let child;
  plugin.renderAlbumHeaderInReading(root, { sourcePath: "eat.md", addChild(value) { child = value; } });
  flushReading();
  assert.equal(root.classList.contains("bob-album-header-surface"), true);
  child.onunload();
  assert.equal(root.classList.contains("bob-album-header-surface"), false);
  assert.equal(root.querySelectorAll(".bob-album-header").length, 0);
});

test("detached callout chunks never paint reading headers, including after editor attachment", () => {
  const { doc, plugin, flushReading, timers } = fixture();
  const chunks = [node(doc, "div"), node(doc, "div"), node(doc, "div")];
  const children = [];
  for (const el of chunks) plugin.renderAlbumHeaderInReading(el, { sourcePath: "eat.md", addChild: (child) => children.push(child) });
  assert.equal(timers.size, 1, "post-processors coalesce per source");
  flushReading();
  for (const el of chunks) assert.equal(el.querySelectorAll(".bob-album-header").length, 0);
  const editor = node(doc, "div", "cm-editor");
  const content = node(doc, "div", "cm-content");
  editor.appendChild(content);
  chunks.forEach((el) => content.appendChild(el));
  plugin.refreshAlbumHeaderReading();
  assert.equal(editor.querySelectorAll(".bob-album-header").length, 0);
  children.forEach((child) => child.onunload());
  assert.equal(plugin.albumHeaderReading.size, 0);
});

test("reading batches pick attached chunks, stay idempotent, and keep pane/embed lifetimes separate", () => {
  const { doc, plugin, flushReading } = fixture();
  const preview = node(doc, "div", "markdown-preview-view");
  preview.appendChild(node(doc, "h1", "", "Restaurants"));
  const chunk = node(doc, "p");
  preview.appendChild(chunk);
  const detached = node(doc, "div");
  const secondPane = node(doc, "div", "markdown-preview-view");
  const embed = node(doc, "div", "markdown-embed");
  preview.appendChild(embed);
  const children = [];
  const ctx = { sourcePath: "eat.md", addChild: (child) => children.push(child) };
  for (const el of [detached, chunk, chunk, secondPane, embed]) plugin.renderAlbumHeaderInReading(el, ctx);
  flushReading();
  assert.equal(detached.querySelectorAll(".bob-album-header").length, 0);
  assert.equal(preview.querySelectorAll(".bob-album-header").length, 2, "one own header plus one embedded header");
  assert.equal(secondPane.querySelectorAll(".bob-album-header").length, 1);
  const oldChild = children.find((child) => child.containerEl === chunk);
  plugin.renderAlbumHeaderInReading(chunk, ctx);
  flushReading();
  oldChild.onunload();
  assert.equal(preview.querySelectorAll(".bob-album-header").length, 2, "old chunk unload cannot remove the new header");
  children.at(-1).onunload();
  assert.equal(preview.querySelectorAll(".bob-album-header").length, 1);
  assert.equal(embed.querySelectorAll(".bob-album-header").length, 1);
  assert.equal(secondPane.querySelectorAll(".bob-album-header").length, 1);
});

test("chunks attaching before the flush share the preview/sizer identity", () => {
  const { doc, plugin, flushReading } = fixture();
  const preview = node(doc, "div", "markdown-preview-view");
  const sizer = node(doc, "div", "markdown-preview-sizer");
  preview.appendChild(sizer);
  const chunk = node(doc, "div");
  const ctx = { sourcePath: "eat.md", addChild() {} };
  plugin.renderAlbumHeaderInReading(preview, ctx);
  plugin.renderAlbumHeaderInReading(chunk, ctx);
  sizer.appendChild(chunk);
  flushReading();
  assert.equal(preview.querySelectorAll(".bob-album-header").length, 1);
  assert.equal(plugin.albumHeaderReading.size, 1);
  assert.equal(plugin.albumHeaderReadingRoot(preview), plugin.albumHeaderReadingRoot(chunk));
});

test("late reading attachment paints on refresh and unload uses the live surface", () => {
  const { doc, plugin, flushReading } = fixture();
  const chunk = node(doc, "div");
  let child;
  plugin.renderAlbumHeaderInReading(chunk, { sourcePath: "eat.md", addChild(value) { child = value; } });
  flushReading();
  const preview = node(doc, "div", "markdown-preview-view");
  preview.appendChild(chunk);
  plugin.scheduleAlbumHeaderRefresh();
  flushReading();
  plugin.refreshAlbumHeaderReading();
  assert.equal(preview.querySelectorAll(".bob-album-header").length, 1);
  child.onunload();
  assert.equal(preview.querySelectorAll(".bob-album-header").length, 0);
  assert.equal(preview.classList.contains("bob-album-header-surface"), false);
});

test("repaint sweeps stray reading chrome from editor chunks without removing CM widgets", () => {
  const { doc, plugin } = fixture();
  const preview = node(doc, "div", "markdown-preview-view");
  const content = node(doc, "div", "cm-content");
  preview.appendChild(content);
  const stray = node(doc, "section", "bob-album-header");
  stray.setAttribute("data-album-source", "eat.md");
  const legitimate = node(doc, "section", "bob-album-header");
  legitimate.setAttribute("data-album-source", "eat.md");
  legitimate.setAttribute("data-cm-widget", "true");
  content.appendChild(stray);
  content.appendChild(legitimate);
  plugin.paintAlbumHeaderReading(preview, "eat.md");
  assert.equal(stray.parentNode, null);
  assert.equal(legitimate.parentNode, content);
  assert.equal(preview.querySelectorAll(".bob-album-header").length, 2);
});

test("teardown cancels pending reading batches", () => {
  const { doc, plugin, flushReading, timers } = fixture();
  const preview = node(doc, "div", "markdown-preview-view");
  plugin.renderAlbumHeaderInReading(preview, { sourcePath: "eat.md", addChild() {} });
  plugin.teardownAlbumHeader();
  assert.equal(timers.size, 0);
  flushReading();
  assert.equal(preview.querySelectorAll(".bob-album-header").length, 0);
  assert.equal(plugin.albumHeaderReadingPending.size, 0);
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

test("schema summary stays collapsed by default and expands per album in view state", () => {
  const { doc, plugin, flushReading } = fixture(album({
    label: "Restaurant",
    dated_notes: true,
    index_by: "status",
    index_facets: ["location"],
    fields: [
      { key: "status", label: "Status", kind: "choices", required: true, list: false,
        choices: [{ value: "a", label: "First" }, { value: "b", label: "Second" }] },
      { key: "location", label: "Location", kind: "text", required: true, list: false, suggest: true, choices: [] },
    ],
  }));
  const root = node(doc, "div", "markdown-preview-view");
  plugin.renderAlbumHeaderInReading(root, { sourcePath: "eat.md", addChild() {} });
  flushReading();
  const summary = root.querySelector(".bob-album-schema-summary");
  assert.equal(summary.getAttribute("aria-expanded"), "false");
  assert.match(summary.textContent, /Restaurant · 2 fields · dated notes · grouped by Status, sub-grouped by Location/);
  assert.equal(root.querySelector(".bob-album-schema-card").getAttribute("hidden"), "");
  assert.equal(root.querySelectorAll(".bob-album-schema-field").length, 2);
  summary.fire("click");
  const opened = root.querySelector(".bob-album-schema-summary");
  assert.equal(plugin.albumHeaderIsExpanded("eat.md"), true);
  assert.equal(opened.getAttribute("aria-expanded"), "true");
  assert.equal(root.querySelector(".bob-album-schema-card").getAttribute("hidden"), null);
  const other = node(doc, "div", "markdown-preview-view");
  plugin.paintAlbumHeaderReading(other, "eat.md");
  assert.equal(other.querySelector(".bob-album-schema-summary").getAttribute("aria-expanded"), "true");
});

test("chip rows cover kinds, flags, grouping, legacy, and empty teaching copy", () => {
  const { app } = fixture();
  const fields = [
    { key: "status", label: "Status", kind: "choices", required: true, list: false,
      choices: [{ value: "to_try", label: "🔖 To try", count: 11 }, { value: "liked", label: "💚 Liked", count: 86 }] },
    { key: "category", label: "Category", kind: "text", required: true, list: false, suggest: true, filled: 12, choices: [] },
    { key: "location", label: "Location", kind: "text", required: true, list: false, suggest: true, choices: [] },
    { key: "visited", label: "Visited", kind: "date", required: false, list: false, filled: 2, choices: [] },
    { key: "year", label: "Year", kind: "number", required: false, list: false, min: 1888, max: 2100, choices: [] },
    { key: "tags", label: "Tags", kind: "text", required: false, list: true, choices: [] },
    { key: "url", label: "Url", kind: "url", required: false, list: false, filled: 31, choices: [] },
  ];
  const model = helpers.albumHeaderModel(report(album({
    label: "Restaurant", noun: "restaurant", plural: "restaurants", records: 104,
    dated_notes: true, index_by: "status", index_facets: ["location"], legacy: ["old_status"],
    fields,
  })), "eat.md", { sourcePath: "eat.md", metadataCache: app.metadataCache, vault: app.vault });
  const presented = model.fields.map((field) => helpers.albumHeaderPresentField(field, model));
  assert.equal(presented[0].groupsIndex, true);
  assert.equal(presented[2].subgroupsIndex, true);
  assert.equal(presented[0].choices[0].display, "🔖 To try 11");
  assert.equal(presented[1].kindText, "text · suggest");
  assert.equal(presented[4].kindText, "number 1888–2100");
  assert.equal(presented[5].kindText, "list of text");
  assert.equal(presented[3].filledText, "set on 2 of 104");
  const { doc, plugin } = fixture(album({
    label: "Restaurant", records: 104, dated_notes: true, index_by: "status",
    index_facets: ["location"], legacy: ["old_status"], fields,
  }));
  const root = node(doc, "div", "markdown-preview-view");
  plugin.albumHeaderSetExpanded("eat.md", true);
  plugin.paintAlbumHeaderReading(root, "eat.md");
  const header = root.querySelector(".bob-album-header");
  assert.equal(header.querySelectorAll(".bob-album-schema-field").length, 7);
  assert.equal(header.querySelector(".bob-album-schema-legacy").textContent, "old_status");
  assert.equal(header.querySelector(".bob-album-schema-required").getAttribute("aria-label"), "required");
  const emptyRoot = node(doc, "div", "markdown-preview-view");
  const empty = fixture(album({ fields: [] }));
  empty.plugin.paintAlbumHeaderReading(emptyRoot, "eat.md");
  assert.match(emptyRoot.querySelector(".bob-album-schema-summary").textContent, /No fields yet — add one so Name @eat\/ can collect facts/);
  assert.match(emptyRoot.querySelector(".bob-album-schema-empty").textContent, /No fields yet/);
});

test("read-only Schema Card paints counts, lint, and a navigation/y/esc footer", () => {
  const { app, doc, plugin } = fixture(album({
    emoji: "🍽️", label: "Restaurant", noun: "restaurant", plural: "restaurants",
    records: 104, dated_notes: true, index_by: "status",
    fields: [{
      key: "status", label: "Status", kind: "choices", required: true, list: false, line: 12,
      choices: [{ value: "to_try", label: "🔖 To try", count: 11 }],
    }, {
      key: "visited", label: "Visited", kind: "date", required: false, list: false, filled: 2, line: 18, choices: [],
    }],
    issues: [{ severity: "warning", code: "album_index_stale", message: "index is stale", line: 4, suggestions: ["bob albums sync"] }],
  }));
  const model = helpers.albumHeaderModel(report(album({
    emoji: "🍽️", label: "Restaurant", noun: "restaurant", plural: "restaurants",
    records: 104, dated_notes: true, index_by: "status",
    fields: [{
      key: "status", label: "Status", kind: "choices", required: true, list: false, line: 12,
      choices: [{ value: "to_try", label: "🔖 To try", count: 11 }],
    }, {
      key: "visited", label: "Visited", kind: "date", required: false, list: false, filled: 2, line: 18, choices: [],
    }],
    issues: [{ severity: "warning", code: "album_index_stale", message: "index is stale", line: 4, suggestions: ["bob albums sync"] }],
  })), "eat.md", { sourcePath: "eat.md", metadataCache: app.metadataCache, vault: app.vault });
  const card = helpers.albumSchemaCardBuildEl(model, { selectedIndex: 0, desktop: true, handlers: {} }, doc);
  assert.match(card.textContent, /🍽️ Restaurant/);
  assert.match(card.textContent, /104 restaurants · dated notes · grouped by Status/);
  assert.match(card.textContent, /🔖 To try 11/);
  assert.match(card.textContent, /set on 2 of 104/);
  assert.match(card.textContent, /index is stale/);
  assert.match(card.textContent, /bob albums sync/);
  assert.match(card.querySelector(".bob-album-schema-dialog-footer").textContent, /y YAML/);
  assert.match(card.querySelector(".bob-album-schema-dialog-footer").textContent, /esc close/);
  assert.equal(card.textContent.includes("Add field"), false);
  assert.equal(helpers.albumHeaderYamlLine(model, { fieldKey: "visited" }), 18);
  assert.equal(helpers.albumHeaderYamlLine(model, { issue: model.issues[0] }), 4);
  const opened = plugin.openAlbumSchemaCard(model, "eat.md");
  assert.equal(opened.ok, true);
  plugin.albumHeaderDesktop = () => false;
  assert.equal(plugin.openAlbumSchemaCard(model, "eat.md").ok, false);
  const mobile = node(doc, "div", "markdown-preview-view");
  plugin.paintAlbumHeaderReading(mobile, "eat.md");
  assert.equal(mobile.querySelector(".bob-album-header-schema"), null);
  assert.match(mobile.querySelector(".bob-album-schema-mobile-hint").textContent, /Edit this schema in YAML/);
});

test("y jumps to the field or lint line in Source mode without writing the vault", async () => {
  const { plugin } = fixture(album({
    fields: [{ key: "status", label: "Status", kind: "text", required: true, list: false, line: 9, choices: [] }],
  }));
  let cursor = null;
  let opened = null;
  const leaf = {
    view: { file: { path: "eat.md" }, editor: {
      setCursor(value) { cursor = value; },
      scrollIntoView() {},
    } },
    async openFile(file, state) { opened = { file, state }; },
  };
  plugin.app.workspace = {
    getLeavesOfType: () => [leaf],
    getMostRecentLeaf: () => leaf,
    activeLeaf: leaf,
  };
  const writes = [];
  plugin.app.vault.adapter = { write(path, text) { writes.push({ path, text }); } };
  const result = await plugin.albumHeaderJumpYaml("eat.md", 9);
  assert.equal(result.ok, true);
  assert.deepEqual(opened.state, { state: { mode: "source" } });
  assert.deepEqual(cursor, { line: 8, ch: 0 });
  assert.deepEqual(writes, []);
});

test("theme accent, schema button, and keyboard labels stay on the header", () => {
  const { doc, plugin } = fixture(album({
    fields: [{ key: "status", label: "Status", kind: "text", required: true, list: false, choices: [] }],
  }));
  const root = node(doc, "div", "markdown-preview-view");
  plugin.paintAlbumHeaderReading(root, "eat.md");
  const header = root.querySelector(".bob-album-header");
  assert.equal(header.tagName, "SECTION");
  assert.equal(root.querySelector(".bob-album-header-schema").textContent, "⊞ Schema");
  assert.equal(root.querySelector(".bob-album-schema-summary").getAttribute("aria-expanded"), "false");
  const field = root.querySelector(".bob-album-schema-field");
  assert.equal(field.getAttribute("tabindex"), "0");
});

test("schema edit model preserves typed defaults and stable field and choice targets", () => {
  const entry = album({
    schema_fingerprint: "sha256:card",
    fields: [
      { key: "status", label: "Status", kind: "choices", required: true, list: false, choices: [
        { value: "liked", label: "💚 Liked", count: 4 },
      ] },
      { key: "amount", label: "Amount", kind: "number", required: false, list: false, default: 0, min: 0, choices: [] },
      { key: "note", label: "Note", kind: "text", required: false, list: false, default: "", choices: [] },
      { key: "aliases", label: "Aliases", kind: "text", required: false, list: true, default: ["", "zero"], choices: [] },
    ],
  });
  const { app } = fixture(entry);
  const model = helpers.albumHeaderModel(report(entry), "eat.md", {
    sourcePath: "eat.md", metadataCache: app.metadataCache, vault: app.vault,
  });
  assert.equal(model.schemaFingerprint, "sha256:card");
  assert.equal(model.fields[1].defaultPresent, true);
  assert.equal(model.fields[1].default, 0);
  assert.equal(model.fields[2].defaultPresent, true);
  assert.equal(model.fields[2].default, "");
  assert.deepEqual(model.fields[3].default, ["", "zero"]);
  assert.equal(helpers.albumSchemaTypedDefault("ignored", { default: false }, false), false);
  assert.deepEqual(helpers.albumSchemaTypedDefault('["", "new"]', { list: true }), ["", "new"]);
  assert.deepEqual(helpers.albumSchemaChoiceParts("💚 Liked"), { emoji: "💚", label: "Liked" });
  assert.deepEqual(helpers.albumSchemaTargets(model).map((target) => target.key), [
    "stats", "field:status", "choice:status:liked", "add-choice:status",
    "field:amount", "field:note", "field:aliases", "add-field",
  ]);
});

test("Schema Card uses bob's singular display label for one record and keeps the legacy fallback", () => {
  const { app } = fixture();
  const makeModel = (overrides) => {
    const entry = album({ noun: "tv_show", plural: "TV shows", ...overrides });
    return helpers.albumHeaderModel(report(entry), "eat.md", {
      sourcePath: "eat.md", metadataCache: app.metadataCache, vault: app.vault,
    });
  };
  assert.equal(helpers.albumHeaderStatsText(makeModel({ records: 0, singular: "TV show" })), "0 TV shows");
  assert.equal(helpers.albumHeaderStatsText(makeModel({ records: 1, singular: "TV show" })), "1 TV show");
  assert.equal(helpers.albumHeaderStatsText(makeModel({ records: 2, singular: "TV show" })), "2 TV shows");
  assert.equal(helpers.albumHeaderStatsText(makeModel({ records: 1 })), "1 tv_show", "old bob JSON keeps the catalog's prior noun fallback");
});

test("Schema Card key events reorder fields and choices while plain navigation stays read-only", () => {
  const entry = album({
    schema_fingerprint: "sha256:key-events",
    fields: [
      { key: "one", label: "One", kind: "text", choices: [] },
      { key: "two", label: "Two", kind: "text", choices: [] },
      { key: "status", label: "Status", kind: "choices", choices: [
        { value: "first", label: "First" }, { value: "second", label: "Second" },
      ] },
    ],
  });
  const { app, plugin } = fixture(entry);
  app.document = makeDoc();
  plugin.apiAlbumUpdatePreview = async () => ({ ok: true, report: { ok: true, consequence: "preview", per_op: [] } });
  plugin.apiAlbumUpdateApply = async () => ({ ok: true, report: { ok: true, changed: false } });
  plugin.apiAlbumSubscribe = () => () => {};
  plugin.albumReportState = () => ({ report: report(entry), stale: false, generation: 1, reportGeneration: 1 });
  const model = helpers.albumHeaderModel(report(entry), "eat.md", {
    sourcePath: "eat.md", metadataCache: app.metadataCache, vault: app.vault,
  });
  const modal = plugin.openAlbumSchemaCard(model, "eat.md").modal;
  const key = (targetKey, event) => {
    const target = modal.contentEl.querySelector(`[data-target-key="${targetKey}"]`);
    assert.ok(target, `target ${targetKey} exists`);
    target.dispatchEvent({ type: "keydown", ...event, preventDefault() {} });
  };

  modal.schemaSelect("field:one");
  key("field:one", { key: "j", altKey: true });
  assert.deepEqual(modal.session.getState().draftOps, [{ op: "field.move", field: "one", position: 1 }]);
  modal.session.setDraft([]);
  modal.schemaSelect("field:two");
  key("field:two", { key: "k", altKey: true });
  assert.deepEqual(modal.session.getState().draftOps, [{ op: "field.move", field: "two", position: 0 }]);
  modal.session.setDraft([]);
  modal.schemaSelect("choice:status:first");
  key("choice:status:first", { key: "j", altKey: true });
  assert.deepEqual(modal.session.getState().draftOps, [{ op: "choice.move", field: "status", value: "first", position: 1 }]);
  modal.session.setDraft([]);
  const before = modal.selectedKey;
  key("choice:status:first", { key: "j" });
  assert.notEqual(modal.selectedKey, before);
  assert.deepEqual(modal.session.getState().draftOps, [], "plain j changes the landing only");
  modal.close();
});

test("Schema Card preserves typed draft, caret, and focus through report repaint and debounces edits", async () => {
  const entry = album({
    schema_fingerprint: "sha256:stage-paint",
    fields: [{ key: "status", label: "Status", kind: "text", choices: [] }],
  });
  const { app, plugin } = fixture(entry);
  app.document = makeDoc();
  app.workspace = { getLeavesOfType: () => [] };
  const requests = [];
  plugin.apiAlbumUpdatePreview = async (_stem, text) => {
    requests.push(JSON.parse(text));
    return { ok: true, report: { ok: true, consequence: "label updated · no record changes", per_op: [] } };
  };
  plugin.apiAlbumUpdateApply = async () => ({ ok: true, report: { ok: true, changed: false } });
  plugin.apiAlbumSubscribe = () => () => {};
  plugin.albumReportState = () => ({ report: report(entry), stale: false, refreshing: false, generation: 1, reportGeneration: 1 });
  const model = helpers.albumHeaderModel(report(entry), "eat.md", {
    sourcePath: "eat.md", metadataCache: app.metadataCache, vault: app.vault,
  });
  const modal = plugin.openAlbumSchemaCard(model, "eat.md").modal;
  modal.schemaStage("field", "field:status");
  let input = modal.schemaInput("fieldLabel");
  input.focus();
  input.value = "New draft";
  input.setSelectionRange(5, 5, "forward");
  input.dispatchEvent({ type: "input" });
  modal.schemaAlbumState(plugin.albumReportState());
  input = modal.schemaInput("fieldLabel");
  assert.equal(input.value, "New draft");
  assert.equal(app.document.activeElement, input, "repaint restores the same input focus");
  assert.equal(input.selectionStart, 5, "repaint restores the caret");
  input.value = "New draft v2";
  input.setSelectionRange(12, 12, "none");
  input.dispatchEvent({ type: "input" });
  await pause(350);
  assert.equal(requests.length, 1, "typing bursts coalesce into one preview");
  assert.deepEqual(requests[0].ops, [{ op: "field.set", field: "status", set: { label: "New draft v2" }, unset: [] }]);
  const current = modal.schemaInput("fieldLabel");
  assert.equal(current.value, "New draft v2");
  assert.equal(app.document.activeElement, current, "preview repaint leaves typing focus in place");
  assert.equal(current.selectionStart, 12);
  assert.equal(modal.session.getState().canApply, true);
  modal.close();
});

test("Schema Card Enter is gated by current preview across pending, refused, stale, and duplicate input events", async () => {
  const entry = album({
    schema_fingerprint: "sha256:gate-before",
    fields: [{ key: "status", label: "Status", kind: "text", choices: [] }],
  });
  const { app, plugin } = fixture(entry);
  app.document = makeDoc();
  app.workspace = { getLeavesOfType: () => [] };
  const state = { report: report(entry), stale: false, refreshing: false, generation: 1, reportGeneration: 1 };
  const previews = [];
  let applies = 0;
  plugin.apiAlbumUpdatePreview = async (_stem, text) => new Promise((resolve) => previews.push({ request: JSON.parse(text), resolve }));
  plugin.apiAlbumUpdateApply = async () => {
    applies += 1;
    return { ok: true, report: { ok: true, changed: false } };
  };
  plugin.apiAlbumSubscribe = () => () => {};
  plugin.albumVaultGeneration = 1;
  plugin.albumReportState = () => state;
  const model = helpers.albumHeaderModel(state.report, "eat.md", {
    sourcePath: "eat.md", metadataCache: app.metadataCache, vault: app.vault,
  });
  const modal = plugin.openAlbumSchemaCard(model, "eat.md").modal;
  modal.schemaStage("field", "field:status");
  const typeLabel = (value) => {
    const input = modal.schemaInput("fieldLabel");
    input.value = value;
    input.dispatchEvent({ type: "input" });
  };
  const enter = () => modal.schemaInput("fieldLabel").dispatchEvent({ type: "keydown", key: "Enter", preventDefault() {} });

  typeLabel("Refused draft");
  await pause(300);
  assert.equal(previews.length, 1);
  assert.equal(modal.session.getState().status, "preview-pending");
  enter();
  await pause(0);
  assert.equal(applies, 0, "Enter cannot apply while the preview is pending");
  previews[0].resolve({ ok: true, report: { ok: false, error: { code: "used_choice", message: "refused" } } });
  await pause(0);
  enter();
  await pause(0);
  assert.equal(modal.session.getState().status, "refused");
  assert.equal(applies, 0, "Enter cannot apply a refused preview");

  typeLabel("Stale draft");
  await pause(300);
  assert.equal(previews.length, 2);
  state.generation = 2;
  state.reportGeneration = 2;
  plugin.albumVaultGeneration = 2;
  const updated = album({ ...entry, schema_fingerprint: "sha256:gate-current" });
  state.report = report(updated);
  modal.schemaAlbumState(state);
  previews[1].resolve({ ok: true, report: { ok: true, consequence: "shown", per_op: [] } });
  await pause(0);
  assert.equal(modal.session.getState().refusal.kind, "stale");
  enter();
  assert.equal(applies, 0, "a generation-stale preview cannot apply");

  const rebasing = modal.schemaRebaseAndPreview();
  await pause(0);
  assert.equal(previews.length, 3);
  previews[2].resolve({ ok: true, report: { ok: true, consequence: "current consequence", per_op: [] } });
  await rebasing;
  assert.equal(modal.session.getState().canApply, true);
  assert.match(modal.contentEl.querySelector(".bob-album-schema-consequence").textContent, /current consequence/);
  enter();
  enter();
  await pause(20);
  assert.equal(applies, 1, "duplicate Enter events share the session apply guard");
  modal.close();
});

test("a repainted Apply preview uses live session state and double Enter applies once", async () => {
  const entry = album({
    schema_fingerprint: "sha256:apply-live-before",
    fields: [{ key: "status", label: "Status", kind: "text", choices: [] }],
  });
  const { app, plugin } = fixture(entry);
  app.document = makeDoc();
  app.workspace = { getLeavesOfType: () => [] };
  const state = { report: report(entry), stale: false, refreshing: false, generation: 1, reportGeneration: 1 };
  let applies = 0;
  plugin.apiAlbumUpdatePreview = async () => ({
    ok: true, report: { ok: true, consequence: "label changes; records stay unchanged", per_op: [] },
  });
  plugin.apiAlbumUpdateApply = async () => {
    applies += 1;
    const next = album({ ...entry, schema_fingerprint: "sha256:apply-live-after" });
    state.report = report(next);
    state.generation = 2;
    state.reportGeneration = 2;
    plugin.albumVaultGeneration = 2;
    return {
      ok: true,
      report: {
        ok: true, changed: true, after_fingerprint: "sha256:apply-live-after",
        inverse_ops: [{ op: "field.set", field: "status", set: { label: "Status" } }],
        sync: { post: "ok" }, warnings: [],
      },
      refreshed: state,
    };
  };
  plugin.apiAlbumSubscribe = () => () => {};
  plugin.albumVaultGeneration = 1;
  plugin.albumReportState = () => state;
  const model = helpers.albumHeaderModel(state.report, "eat.md", {
    sourcePath: "eat.md", metadataCache: app.metadataCache, vault: app.vault,
  });
  const modal = plugin.openAlbumSchemaCard(model, "eat.md").modal;
  modal.schemaStage("field", "field:status");
  const input = modal.schemaInput("fieldLabel");
  input.value = "Status revised";
  input.dispatchEvent({ type: "input" });
  await pause(300);
  assert.equal(modal.session.getState().canApply, true, "the asynchronous preview has settled");
  assert.match(modal.contentEl.querySelector(".bob-album-schema-consequence")?.textContent || "", /label changes; records stay unchanged/);

  // Keep the already-enabled UI while simulating a stale modal cache. Obsidian's
  // preview completion and a report repaint can cross this event boundary.
  modal.sessionState = { ...modal.sessionState, status: "draft", canApply: false };
  const stageInput = modal.schemaInput("fieldLabel");
  assert.ok(stageInput && stageInput.parentNode, "the focused stage input is connected after preview repaint");
  stageInput.dispatchEvent({ type: "keydown", key: "Enter", preventDefault() {} });
  const selected = modal.contentEl.querySelector('[data-target-key="field:status"]');
  assert.ok(selected && selected.parentNode, "a connected card row is reacquired after the applying repaint");
  selected.focus();
  selected.dispatchEvent({ type: "keydown", key: "Enter", preventDefault() {} });
  await pause(20);
  assert.equal(applies, 1, "the double Enter gesture sends one non-dry update");
  assert.equal(modal.session.getState().expect, "sha256:apply-live-after");
  assert.equal(modal.session.getState().undoAvailable, true, "Undo follows the successful apply");
  modal.close();
});

test("an enabled Apply control routes a newly stale preview to a visible refusal", async () => {
  const entry = album({
    schema_fingerprint: "sha256:apply-stale-before",
    fields: [{ key: "status", label: "Status", kind: "text", choices: [] }],
  });
  const { app, plugin } = fixture(entry);
  app.document = makeDoc();
  app.workspace = { getLeavesOfType: () => [] };
  const state = { report: report(entry), stale: false, refreshing: false, generation: 1, reportGeneration: 1 };
  let applies = 0;
  plugin.apiAlbumUpdatePreview = async () => ({ ok: true, report: { ok: true, consequence: "shown", per_op: [] } });
  plugin.apiAlbumUpdateApply = async () => { applies += 1; return { ok: true, report: { ok: true, changed: false } }; };
  plugin.apiAlbumReport = () => new Promise(() => {});
  plugin.apiAlbumSubscribe = () => () => {};
  plugin.albumVaultGeneration = 1;
  plugin.albumReportState = () => state;
  const model = helpers.albumHeaderModel(state.report, "eat.md", {
    sourcePath: "eat.md", metadataCache: app.metadataCache, vault: app.vault,
  });
  const modal = plugin.openAlbumSchemaCard(model, "eat.md").modal;
  modal.schemaStage("field", "field:status");
  const input = modal.schemaInput("fieldLabel");
  input.value = "Stale edit";
  input.dispatchEvent({ type: "input" });
  await pause(300);
  assert.equal(modal.session.getState().canApply, true);
  const enabledApply = modal.contentEl.querySelector('[data-schema-action="apply"]');
  assert.ok(enabledApply && !enabledApply.disabled);

  state.stale = true;
  state.generation = 2;
  plugin.albumVaultGeneration = 2;
  enabledApply.click();
  await pause(0);
  assert.equal(applies, 0, "a stale preview never reaches the writer");
  assert.equal(modal.session.getState().refusal?.kind, "stale");
  assert.match(modal.contentEl.querySelector(".bob-album-schema-refusal")?.textContent || "", /changed under this preview/);
  assert.ok(modal.contentEl.querySelector('[data-schema-action="rebase-preview"]'), "the stale recovery action is visible");
  modal.close();
});

test("new choice field rows keep live order and values as early and middle choices are removed", () => {
  const entry = album({ schema_fingerprint: "sha256:choice-rows", fields: [] });
  const { app, plugin } = fixture(entry);
  app.document = makeDoc();
  plugin.apiAlbumUpdatePreview = async () => ({ ok: true, report: { ok: true, consequence: "preview", per_op: [] } });
  plugin.apiAlbumUpdateApply = async () => ({ ok: true, report: { ok: true, changed: false } });
  plugin.apiAlbumSubscribe = () => () => {};
  plugin.albumReportState = () => ({ report: report(entry), stale: false, generation: 1, reportGeneration: 1 });
  const model = helpers.albumHeaderModel(report(entry), "eat.md", {
    sourcePath: "eat.md", metadataCache: app.metadataCache, vault: app.vault,
  });
  const modal = plugin.openAlbumSchemaCard(model, "eat.md").modal;
  modal.schemaStage("field-add", "add-field");
  const emit = (name, value) => {
    const input = modal.schemaInput(name);
    assert.ok(input, `${name} exists`);
    if (input.getAttribute("type") === "checkbox") input.checked = value;
    else input.value = value;
    input.dispatchEvent({ type: "input" });
  };
  emit("newFieldLabel", "Rating");
  emit("newFieldKind", "choices");
  modal.schemaStageAddInitialChoice();
  modal.schemaStageAddInitialChoice();
  modal.schemaStageAddInitialChoice();
  const setRow = (index, label, emoji) => {
    emit(`choiceLabel${index}`, label);
    emit(`choiceEmoji${index}`, emoji);
  };
  setRow(0, "Alpha", "🅰️");
  setRow(1, "Bravo", "🅱️");
  setRow(2, "Charlie", "©️");
  setRow(3, "Delta", "🔻");
  const remove = (index) => {
    const button = modal.contentEl.querySelector(`[data-schema-action="remove-initial-choice:${index}"]`);
    assert.ok(button, `remove button ${index} exists`);
    button.click();
  };
  remove(0);
  setRow(0, "Bravo edited", "🅱️");
  setRow(1, "Charlie edited", "©️");
  setRow(2, "Delta edited", "🔻");
  remove(1);
  remove(1);
  assert.deepEqual(modal.schemaBuildStageOp().choices, [{ label: "Bravo edited", emoji: "🅱️" }]);
  assert.equal(modal.stageDraft.initialChoices.length, 1);
  modal.close();
});

test("Schema Card stages typed edits, previews one op, and applies only after confirmation", async () => {
  const entry = album({
    schema_fingerprint: "sha256:card-before",
    fields: [{
      key: "amount", label: "Amount", kind: "number", required: false,
      list: false, default: 2, min: 1, max: 10, choices: [],
    }],
  });
  const { app, plugin, state } = fixture(entry);
  app.document = makeDoc();
  app.workspace = { getLeavesOfType: () => [] };
  const requests = [];
  const applies = [];
  plugin.apiAlbumUpdatePreview = async (stem, text) => {
    requests.push({ stem, body: JSON.parse(text) });
    return { ok: true, report: { ok: true, consequence: "default becomes 0 · no records change", per_op: [] } };
  };
  plugin.apiAlbumUpdateApply = async (stem, text) => {
    applies.push({ stem, body: JSON.parse(text) });
    const next = album({ ...entry, schema_fingerprint: "sha256:card-after", fields: [
      { ...entry.fields[0], default: 0, min: 0 },
    ] });
    state.report = report(next);
    state.generation = 2;
    state.reportGeneration = 2;
    return {
      ok: true,
      report: {
        ok: true, changed: true, dry_run: false, after_fingerprint: "sha256:card-after",
        inverse_ops: [{ op: "field.set", field: "amount", set: { default: 2, min: 1 } }],
        sync: { post: "ok" }, warnings: [],
      },
      refreshed: plugin.albumReportState(),
    };
  };
  plugin.apiAlbumVaultSyncRetry = async () => ({ ok: true });
  plugin.apiAlbumSubscribe = () => () => {};
  plugin.albumReportState = () => ({
    ...state, generation: state.generation || 1,
    reportGeneration: state.reportGeneration || 1,
    stale: false, refreshing: false,
  });
  const model = helpers.albumHeaderModel(state.report, "eat.md", {
    sourcePath: "eat.md", metadataCache: app.metadataCache, vault: app.vault,
  });
  const opened = plugin.openAlbumSchemaCard(model, "eat.md");
  assert.equal(opened.ok, true);
  const modal = opened.modal;
  assert.ok(modal.session);
  assert.equal(modal.selectedKey, "stats");

  modal.schemaStage("field", "field:amount");
  const label = modal.schemaInput("fieldLabel");
  modal.schemaOnKeyDown({ key: "s", target: label, preventDefault() {} });
  assert.equal(modal.session.getState().draftOps.length, 0, "input typing does not trigger suggest hotkey");
  let escapeStopped = false;
  modal.schemaOnKeyDown({
    key: "Escape", target: label, preventDefault() {},
    stopPropagation() { escapeStopped = true; },
  });
  assert.equal(escapeStopped, true, "Escape cancels the stage without closing the outer Obsidian modal");
  assert.equal(modal.stage, null);
  modal.schemaStage("field", "field:amount");
  modal.schemaInput("fieldDefault").value = "0";
  modal.schemaInput("fieldMin").value = "0";
  const op = modal.schemaBuildStageOp();
  assert.deepEqual(op, {
    op: "field.set", field: "amount", set: { default: 0, min: 0 }, unset: [],
  });
  modal.schemaQueueOp(op, "field:amount");
  assert.equal(modal.session.getState().canApply, false);
  await modal.session.previewNow();
  modal.sessionState = modal.session.getState();
  assert.equal(modal.sessionState.canApply, true);
  assert.equal(modal.sessionState.consequence, "default becomes 0 · no records change");
  assert.deepEqual(requests[0].body.ops, [op]);
  assert.match(modal.contentEl.querySelector(".bob-album-schema-dialog").textContent, /default becomes 0/);

  await modal.schemaApply();
  assert.equal(applies.length, 1);
  assert.deepEqual(applies[0].body.ops, [op]);
  assert.equal(modal.session.getState().undoAvailable, true);
  assert.equal(modal.session.getState().expect, "sha256:card-after");
  assert.equal(modal.selectedKey, "field:amount");
  modal.close();
});

test("open album panes save in order and missing save support refuses", async () => {
  const { plugin } = fixture();
  const order = [];
  plugin.app.workspace = { getLeavesOfType: () => [
    { view: { file: { path: "eat.md" }, async save() { order.push("left"); } } },
    { view: { file: { path: "eat.md" }, async save() { order.push("right"); } } },
    { view: { file: { path: "other.md" }, async save() { order.push("other"); } } },
  ] };
  assert.deepEqual(await helpers.albumSchemaSaveOpenEditors(plugin, ["eat.md"]), { ok: true });
  assert.deepEqual(order, ["left", "right"]);
  plugin.app.workspace.getLeavesOfType = () => [{ view: { file: { path: "eat.md" } } }];
  const unsupported = await helpers.albumSchemaSaveOpenEditors(plugin, ["eat.md"]);
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.code, "save-unsupported");
});

test("Schema Card maps album, field, choice, ordering, toggle, and removal gestures", () => {
  const entry = album({
    schema_fingerprint: "sha256:gestures",
    fields: [
      { key: "status", label: "Status", kind: "choices", required: true, suggest: false, list: false,
        choices: [{ value: "liked", label: "💚 Liked" }, { value: "to_try", label: "🔖 To try" }] },
      { key: "amount", label: "Amount", kind: "number", required: false, suggest: false, list: false, choices: [] },
    ],
  });
  const { app, plugin } = fixture(entry);
  app.document = makeDoc();
  plugin.apiAlbumUpdatePreview = async () => ({ ok: true, report: { ok: true, consequence: "preview", per_op: [] } });
  plugin.apiAlbumUpdateApply = async () => ({ ok: true, report: { ok: true, changed: false } });
  plugin.apiAlbumVaultSyncRetry = async () => ({ ok: true });
  plugin.apiAlbumSubscribe = () => () => {};
  plugin.albumReportState = () => ({ report: report(entry), stale: false, generation: 1, reportGeneration: 1 });
  const model = helpers.albumHeaderModel(report(entry), "eat.md", {
    sourcePath: "eat.md", metadataCache: app.metadataCache, vault: app.vault,
  });
  const modal = plugin.openAlbumSchemaCard(model, "eat.md").modal;

  modal.schemaStage("album", "stats");
  modal.schemaInput("useLabel").checked = true;
  modal.schemaInput("albumLabel").value = "Eateries";
  modal.schemaInput("usePlural").checked = true;
  modal.schemaInput("albumPlural").value = "eateries";
  modal.schemaInput("datedNotes").checked = true;
  assert.deepEqual(modal.schemaBuildStageOp(), {
    op: "album.set", set: { label: "Eateries", plural: "eateries", dated_notes: true }, unset: [],
  });

  modal.schemaStage("field-add", "add-field");
  modal.schemaInput("newFieldLabel").value = "Quality";
  modal.schemaInput("newFieldKind").value = "choices";
  modal.schemaInput("newFieldSuggest").checked = true;
  modal.schemaInput("choiceLabel0").value = "Excellent";
  modal.schemaInput("choiceEmoji0").value = "✨";
  assert.deepEqual(modal.schemaBuildStageOp(), {
    op: "field.add", label: "Quality", kind: "choices", list: false, suggest: true,
    position: 2, choices: [{ label: "Excellent", emoji: "✨" }],
  });

  modal.schemaStage("choice-add", "add-choice:status");
  modal.schemaInput("choiceLabel").value = "Regular";
  modal.schemaInput("choiceEmoji").value = "🔁";
  assert.deepEqual(modal.schemaBuildStageOp(), {
    op: "choice.add", field: "status", label: "Regular", position: 2, emoji: "🔁",
  });

  modal.schemaStage("choice", "choice:status:liked");
  modal.schemaInput("choiceLabel").value = "Loved";
  assert.deepEqual(modal.schemaBuildStageOp(), {
    op: "choice.set", field: "status", value: "liked", set: { label: "Loved" },
  }, "label changes preserve the existing emoji");
  modal.schemaInput("choiceLabel").value = "Liked";
  modal.schemaInput("choiceEmoji").value = "⭐";
  assert.deepEqual(modal.schemaBuildStageOp(), {
    op: "choice.set", field: "status", value: "liked", set: { emoji: "⭐" },
  }, "emoji changes preserve the existing label");

  modal.stage = null;
  modal.selectedKey = "field:status";
  modal.schemaToggleSelected("required");
  assert.deepEqual(modal.session.getState().draftOps[0], {
    op: "field.set", field: "status", set: { required: false },
  });
  modal.session.setDraft([]);
  modal.schemaToggleSelected("suggest");
  assert.deepEqual(modal.session.getState().draftOps[0], {
    op: "field.set", field: "status", set: { suggest: true },
  });
  modal.session.setDraft([]);
  modal.schemaMoveSelected(1);
  assert.deepEqual(modal.session.getState().draftOps[0], { op: "field.move", field: "status", position: 1 });
  modal.session.setDraft([]);
  modal.selectedKey = "choice:status:liked";
  modal.schemaMoveSelected(1);
  assert.deepEqual(modal.session.getState().draftOps[0], {
    op: "choice.move", field: "status", value: "liked", position: 1,
  });
  modal.session.setDraft([]);
  modal.schemaRemoveSelected();
  assert.deepEqual(modal.session.getState().draftOps[0], {
    op: "choice.remove", field: "status", value: "liked",
  });
  modal.session.setDraft([]);
  modal.selectedKey = "field:amount";
  modal.schemaRemoveSelected();
  assert.deepEqual(modal.session.getState().draftOps[0], { op: "field.remove", field: "amount" });
  modal.close();
});

test("Schema Card Escape follows one dispatch: stage cancel, draft clear, then close", () => {
  const entry = album({
    schema_fingerprint: "sha256:escape-single-dispatch",
    fields: [{ key: "amount", label: "Amount", kind: "number", choices: [] }],
  });
  const { app, plugin } = fixture(entry);
  const doc = makeDoc();
  app.document = doc;
  plugin.apiAlbumUpdatePreview = async () => ({ ok: true, report: { ok: true, consequence: "preview", per_op: [] } });
  plugin.apiAlbumUpdateApply = async () => ({ ok: true, report: { ok: true, changed: false } });
  plugin.apiAlbumVaultSyncRetry = async () => ({ ok: true });
  plugin.apiAlbumSubscribe = () => () => {};
  plugin.albumReportState = () => ({ report: report(entry), stale: false, generation: 1, reportGeneration: 1 });
  const model = helpers.albumHeaderModel(report(entry), "eat.md", {
    sourcePath: "eat.md", metadataCache: app.metadataCache, vault: app.vault,
  });
  const modal = plugin.openAlbumSchemaCard(model, "eat.md").modal;
  let closes = 0;
  const originalClose = modal.close.bind(modal);
  modal.close = () => { closes += 1; return originalClose(); };
  const makeEscape = (target) => {
    const event = {
      key: "Escape",
      target,
      defaultPrevented: false,
      __schemaEscapeHandled: false,
      preventDefault() { event.defaultPrevented = true; },
      stopPropagation() {},
    };
    return event;
  };
  // Drives Escape the way Obsidian does: capture-phase onEscapeKey first, then
  // the same event bubbles to contentEl.
  const obsidianEscape = (target) => {
    const event = makeEscape(target);
    modal.onEscapeKey(event);
    modal.schemaOnKeyDown(event);
    return event;
  };

  modal.schemaSelect("field:amount");
  modal.schemaStage("field", "field:amount");
  assert.ok(modal.stage, "stage is open");
  const input = modal.schemaInput("fieldLabel");
  assert.ok(input, "stage input exists");
  obsidianEscape(input);
  assert.equal(modal.stage, null, "first Escape cancels the stage");
  assert.ok(modal.session, "modal stays open after stage cancel");
  assert.equal(closes, 0, "no close on stage cancel");
  assert.deepEqual(modal.session.getState().draftOps || [], [], "no draft after stage cancel");
  const focused = doc.activeElement;
  assert.ok(focused, "focus lands somewhere after stage cancel");
  assert.equal(focused.getAttribute("data-target-key"), "field:amount", "focus returns to the selected row");

  modal.schemaQueueOp({ op: "field.set", field: "amount", set: { label: "Total" } }, "field:amount");
  assert.equal(modal.session.getState().draftOps.length, 1, "pending draft queued");
  assert.equal(modal.stage, null);
  const selected = modal.contentEl.querySelector('[data-target-key="field:amount"]');
  assert.ok(selected, "selected row exists for draft Escape");
  obsidianEscape(selected);
  assert.deepEqual(modal.session.getState().draftOps || [], [], "second Escape clears the pending draft");
  assert.ok(modal.session, "modal stays open after draft clear");
  assert.equal(closes, 0, "no close on draft clear and no double handling");

  const browsing = modal.contentEl.querySelector('[data-target-key="field:amount"]');
  obsidianEscape(browsing);
  assert.equal(closes, 1, "third Escape closes the card");
  assert.equal(modal.session, null, "session torn down on close");
});
