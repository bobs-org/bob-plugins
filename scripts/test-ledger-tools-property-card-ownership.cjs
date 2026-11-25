// Shared property-card ownership: one mount owns selected native rows.
// Covers two panes, stale releases, replacement DOM, renames, denied scopes,
// null/throwing mounts, and cleanup for record, album, and bank adapters.
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
const Decoration = { none: [], widget: (options) => ({ ...options }) };
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
    EditorView: { editorAttributes: { of: (attributes) => attributes } },
  };
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers } = LedgerToolsPlugin;
Module._load = originalLoad;

const OWNED = "bob-property-card-owned-property";

class FakeNode {
  constructor(tag, doc, text = "") {
    this.tagName = tag ? tag.toUpperCase() : "#TEXT";
    this.nodeType = tag ? 1 : 3;
    this.ownerDocument = doc;
    this.parentNode = null;
    this.children = [];
    this.attrs = new Map();
    this._text = text;
    const self = this;
    this.classList = {
      add(name) { const xs = new Set((self.getAttribute("class") || "").split(/\s+/).filter(Boolean)); xs.add(name); self.setAttribute("class", [...xs].join(" ")); },
      remove(name) { const xs = (self.getAttribute("class") || "").split(/\s+/).filter((x) => x && x !== name); self.setAttribute("class", xs.join(" ")); },
      contains(name) { return (self.getAttribute("class") || "").split(/\s+/).includes(name); },
    };
  }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  appendChild(node) { node.parentNode?.removeChild?.(node); node.parentNode = this; this.children.push(node); return node; }
  removeChild(node) { const i = this.children.indexOf(node); if (i >= 0) this.children.splice(i, 1); node.parentNode = null; return node; }
  remove() { this.parentNode?.removeChild?.(this); }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  matches(selector) {
    return String(selector).split(",").some((part) => {
      const value = part.trim();
      const cls = /^\.([\w-]+)$/.exec(value);
      if (cls) return this.classList.contains(cls[1]);
      return false;
    });
  }
  closest(selector) { let node = this; while (node) { if (node.nodeType === 1 && node.matches(selector)) return node; node = node.parentNode; } return null; }
  querySelectorAll(selector) {
    const found = [];
    const walk = (node) => { for (const child of node.children || []) { if (child.matches(selector)) found.push(child); walk(child); } };
    walk(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function makeDoc(observers = []) {
  const doc = {
    activeElement: null,
    createElement(tag) { return new FakeNode(tag, doc); },
    createTextNode(text) { return new FakeNode("", doc, String(text)); },
    defaultView: {
      MutationObserver: class {
        constructor(callback) { this.callback = callback; observers.push(this); }
        observe() { this.observed = true; }
        disconnect() { this.disconnected = true; }
      },
    },
  };
  return doc;
}

function editorScope(doc) {
  const scope = doc.createElement("div");
  scope.setAttribute("class", "cm-editor");
  const scroller = doc.createElement("div");
  scroller.setAttribute("class", "cm-scroller");
  const sizer = doc.createElement("div");
  sizer.setAttribute("class", "cm-sizer");
  const container = doc.createElement("div");
  container.setAttribute("class", "metadata-container");
  scope.ownerDocument = doc;
  sizer.appendChild(container);
  scroller.appendChild(sizer);
  scope.appendChild(scroller);
  scope.ownerDocument = doc;
  return { scope, container };
}

function readingScope(doc) {
  const scope = doc.createElement("div");
  scope.setAttribute("class", "markdown-preview-view");
  const sizer = doc.createElement("div");
  sizer.setAttribute("class", "markdown-preview-sizer");
  const header = doc.createElement("div");
  header.setAttribute("class", "mod-header");
  const container = doc.createElement("div");
  container.setAttribute("class", "metadata-container");
  header.appendChild(container);
  sizer.appendChild(header);
  scope.appendChild(sizer);
  scope.ownerDocument = doc;
  return { scope, container };
}

function addRow(doc, container, key) {
  const row = doc.createElement("div");
  row.setAttribute("class", "metadata-property");
  row.setAttribute("data-property-key", key);
  container.appendChild(row);
  return row;
}

function makePlugin() {
  return new LedgerToolsPlugin({ workspace: { getLeavesOfType: () => [] }, metadataCache: {}, vault: {} });
}

test("two panes own the same keys independently", () => {
  const doc = makeDoc();
  const first = editorScope(doc);
  const second = editorScope(doc);
  const firstRow = addRow(doc, first.container, "record");
  const secondRow = addRow(doc, second.container, "record");
  const other = addRow(doc, second.container, "unrelated");
  const releaseFirst = helpers.propertyCardOwnKeys(first.scope, ["record"]);
  const releaseSecond = helpers.propertyCardOwnKeys(second.scope, ["record"]);
  assert.equal(firstRow.classList.contains(OWNED), true);
  assert.equal(secondRow.classList.contains(OWNED), true);
  assert.equal(other.classList.contains(OWNED), false);
  releaseFirst();
  assert.equal(firstRow.classList.contains(OWNED), false);
  assert.equal(secondRow.classList.contains(OWNED), true);
  releaseSecond();
  assert.equal(secondRow.classList.contains(OWNED), false);
});

test("stale release cannot clear a newer mount", () => {
  const doc = makeDoc();
  const { scope, container } = editorScope(doc);
  const row = addRow(doc, container, "bank");
  const stale = helpers.propertyCardOwnKeys(scope, ["bank"]);
  helpers.propertyCardOwnKeys(scope, ["bank"]);
  assert.equal(row.classList.contains(OWNED), true);
  stale();
  assert.equal(row.classList.contains(OWNED), true, "old handle is inert after replacement");
  helpers.propertyCardReleaseScope(scope);
  assert.equal(row.classList.contains(OWNED), false);
});

test("replacement Properties DOM and renamed keys stay scoped", () => {
  const observers = [];
  const doc = makeDoc(observers);
  const { scope, container } = editorScope(doc);
  container.remove();
  helpers.propertyCardOwnKeys(scope, ["status"]);
  assert.equal(observers.length, 1);
  assert.deepEqual(observers[0].observed, true);
  const sizer = scope.children[0]?.children[0];
  const replacement = doc.createElement("div");
  replacement.setAttribute("class", "metadata-container");
  sizer.appendChild(replacement);
  const row = addRow(doc, replacement, "status");
  observers[0].callback();
  assert.equal(row.classList.contains(OWNED), true);
  row.setAttribute("data-property-key", "unrelated");
  observers[0].callback();
  assert.equal(row.classList.contains(OWNED), false);
  row.setAttribute("data-property-key", "status");
  observers[0].callback();
  assert.equal(row.classList.contains(OWNED), true);
});

test("denied scopes keep native fields", () => {
  const doc = makeDoc();
  assert.doesNotThrow(() => helpers.propertyCardOwnKeys(null, ["record"]));
  const embed = doc.createElement("div");
  embed.setAttribute("class", "markdown-embed");
  const preview = doc.createElement("div");
  preview.setAttribute("class", "markdown-preview-view");
  embed.appendChild(preview);
  preview.ownerDocument = doc;
  const release = helpers.propertyCardOwnKeys(preview, ["record"]);
  assert.equal(typeof release, "function");
  release();
  const hover = doc.createElement("div");
  hover.setAttribute("class", "hover-popover");
  hover.ownerDocument = doc;
  helpers.propertyCardOwnKeys(hover, ["bank"]);
  const plain = doc.createElement("div");
  plain.ownerDocument = doc;
  helpers.propertyCardOwnKeys(plain, ["bank"]);
});

test("record adapter owns schema rows plus sheet title only", () => {
  const doc = makeDoc();
  const plugin = makePlugin();
  const { scope, container } = editorScope(doc);
  const rows = ["status", "location"].map((key) => addRow(doc, container, key));
  const title = addRow(doc, container, "title");
  const unrelated = addRow(doc, container, "parent");
  const model = (extra = {}) => ({
    hideEligible: true,
    rows: [{ key: "status" }, { key: "location" }],
    ghosts: [],
    coverage: { title: "sheet" },
    ...extra,
  });
  plugin.recordSheetSetNativeProperties(scope, model());
  for (const row of [...rows, title]) assert.equal(row.classList.contains(OWNED), true);
  assert.equal(unrelated.classList.contains(OWNED), false);
  plugin.recordSheetSetNativeProperties(scope, model({ coverage: { title: "other" } }));
  assert.equal(title.classList.contains(OWNED), false);
  assert.equal(rows[0].classList.contains(OWNED), true);
  plugin.recordSheetSetNativeProperties(scope, model({ hideEligible: false }));
  assert.equal(rows[0].classList.contains(OWNED), false);
  assert.equal(plugin.recordSheetNativePropertiesScopes.size, 0);
});

test("record adapter denies embeds and null mounts", () => {
  const doc = makeDoc();
  const plugin = makePlugin();
  const { scope, container } = editorScope(doc);
  const row = addRow(doc, container, "status");
  const embedScope = doc.createElement("div");
  embedScope.setAttribute("class", "cm-editor markdown-embed");
  embedScope.ownerDocument = doc;
  plugin.recordSheetSetNativeProperties(embedScope, {
    hideEligible: true, rows: [{ key: "status" }], ghosts: [], coverage: { title: "sheet" },
  });
  assert.equal(row.classList.contains(OWNED), false);
  plugin.recordSheetSetNativeProperties(null, null);
  plugin.recordSheetSetNativeProperties(scope, null);
  assert.equal(plugin.recordSheetNativePropertiesScopes.size, 0);
});

test("album owns exactly record and bank owns exactly bank", () => {
  const doc = makeDoc();
  const plugin = makePlugin();
  const album = editorScope(doc);
  const recordRow = addRow(doc, album.container, "record");
  const albumOther = addRow(doc, album.container, "bank");
  plugin.albumHeaderOwnKeys(album.scope);
  assert.equal(recordRow.classList.contains(OWNED), true);
  assert.equal(albumOther.classList.contains(OWNED), false);
  plugin.albumHeaderReleaseKeys(album.scope);
  assert.equal(recordRow.classList.contains(OWNED), false);

  const bank = readingScope(doc);
  const bankRow = addRow(doc, bank.container, "bank");
  const bankOther = addRow(doc, bank.container, "record");
  plugin.bankSetupOwnKeys(bank.scope);
  assert.equal(bankRow.classList.contains(OWNED), true);
  assert.equal(bankOther.classList.contains(OWNED), false);
  plugin.bankSetupReleaseKeys(bank.scope);
  assert.equal(bankRow.classList.contains(OWNED), false);
});

test("failed mounts roll back and teardown clears every adapter", () => {
  const doc = makeDoc();
  const plugin = makePlugin();
  const { scope, container } = editorScope(doc);
  const row = addRow(doc, container, "status");
  plugin.recordSheetSetNativeProperties(scope, {
    hideEligible: true, rows: [{ key: "status" }], ghosts: [], coverage: { title: "sheet" },
  });
  assert.equal(row.classList.contains(OWNED), true);
  plugin.recordSheetSetNativeProperties(scope, null);
  assert.equal(row.classList.contains(OWNED), false);
  const album = editorScope(doc);
  const albumRow = addRow(doc, album.container, "record");
  plugin.albumHeaderOwnKeys(album.scope);
  assert.equal(albumRow.classList.contains(OWNED), true);
  plugin.albumHeaderReleaseKeys(album.scope);
  assert.equal(albumRow.classList.contains(OWNED), false);
  plugin.recordSheetSetNativeProperties(scope, {
    hideEligible: true, rows: [{ key: "status" }], ghosts: [], coverage: { title: "sheet" },
  });
  assert.equal(row.classList.contains(OWNED), true);
  plugin.teardownRecordSheet?.();
  assert.equal(row.classList.contains(OWNED), false);
});

test("a pane's stale binding for an earlier note keeps the current card's rows owned", () => {
  const doc = makeDoc();
  const plugin = makePlugin();
  const { scope, container } = readingScope(doc);
  const row = addRow(doc, container, "record");
  // One pane shows an earlier album, then a later one: same native view scope.
  plugin.albumHeaderOwnKeys(scope, "albums/earlier.md");
  plugin.albumHeaderOwnKeys(scope, "albums/current.md");
  plugin.albumHeaderReleaseKeys(scope, "albums/earlier.md");
  assert.equal(row.classList.contains(OWNED), true, "stale path leaves the current mount owned");
  plugin.albumHeaderReleaseKeys(scope, "albums/current.md");
  assert.equal(row.classList.contains(OWNED), false);

  const bank = readingScope(doc);
  const bankRow = addRow(doc, bank.container, "bank");
  plugin.bankSetupOwnKeys(bank.scope, "bank/setup.md");
  plugin.bankSetupReleaseKeys(bank.scope, "elsewhere.md");
  assert.equal(bankRow.classList.contains(OWNED), true);
  plugin.bankSetupReleaseKeys(bank.scope, "bank/setup.md");
  assert.equal(bankRow.classList.contains(OWNED), false);
});

test("one card's teardown never clears another card's newer owner of the scope", () => {
  const doc = makeDoc();
  const plugin = makePlugin();
  const { scope, container } = editorScope(doc);
  const recordKey = addRow(doc, container, "record");
  const status = addRow(doc, container, "status");
  const recordModel = { hideEligible: true, rows: [{ key: "status" }], ghosts: [], coverage: { title: "body" } };
  // The editor navigates from an album to a record, then the album's plugin
  // releases its old mount: the record keeps its rows.
  plugin.albumHeaderOwnKeys(scope, "albums/eat.md");
  plugin.recordSheetSetNativeProperties(scope, recordModel);
  assert.equal(status.classList.contains(OWNED), true);
  assert.equal(recordKey.classList.contains(OWNED), false, "new owner's keys replace the old set");
  plugin.albumHeaderReleaseKeys(scope);
  plugin.bankSetupReleaseKeys(scope);
  assert.equal(status.classList.contains(OWNED), true);
  // And back: the record's clear leaves the album's newer mount alone.
  plugin.albumHeaderOwnKeys(scope, "albums/eat.md");
  plugin.recordSheetSetNativeProperties(scope, null);
  assert.equal(recordKey.classList.contains(OWNED), true);
  assert.equal(status.classList.contains(OWNED), false);
  plugin.albumHeaderReleaseKeys(scope);
  assert.equal(recordKey.classList.contains(OWNED), false);
});

test("plugin teardown releases every album and bank mount", () => {
  const doc = makeDoc();
  const plugin = makePlugin();
  const album = editorScope(doc);
  const albumRow = addRow(doc, album.container, "record");
  const bank = readingScope(doc);
  const bankRow = addRow(doc, bank.container, "bank");
  plugin.albumHeaderOwnKeys(album.scope, "albums/eat.md");
  plugin.bankSetupOwnKeys(bank.scope, "bank/setup.md");
  plugin.teardownAlbumHeader();
  plugin.teardownBankSetup();
  assert.equal(albumRow.classList.contains(OWNED), false);
  assert.equal(bankRow.classList.contains(OWNED), false);
  assert.equal(plugin.albumHeaderKeySlots.size, 0);
  assert.equal(plugin.bankSetupKeySlots.size, 0);
});

function livePreviewEditor(doc) {
  // Obsidian nests the CodeMirror editor under the .markdown-source-view that
  // carries album and bank surface classes; native Properties sit below it.
  const source = doc.createElement("div");
  source.setAttribute("class", "markdown-source-view is-live-preview");
  const { scope, container } = editorScope(doc);
  source.appendChild(scope);
  source.ownerDocument = doc;
  return { source, editor: scope, container, view: { dom: scope, state: { doc: {
    toString: () => "---\n---\n# Note\n", length: 15, lines: 4,
    line: (number) => ({ number, from: 0, to: 0, text: "" }),
  } } } };
}

test("Live Preview album and bank cards own rows under the CodeMirror editor", () => {
  const doc = makeDoc();
  const plugin = makePlugin();
  const album = livePreviewEditor(doc);
  const recordRow = addRow(doc, album.container, "record");
  const albumOther = addRow(doc, album.container, "summary");
  plugin.albumHeaderLivePath = () => "albums/eat.md";
  plugin.albumHeaderState = () => null;
  plugin.albumHeaderCardModelFor = () => ({
    identity: { kind: "album", path: "albums/eat.md", stem: "eat", title: "Eat", emoji: "", summary: "", owners: [] },
    body: { path: "albums/eat.md" }, title: "Eat", subtitle: "",
  });
  plugin.albumHeaderOptions = () => ({});
  plugin.albumHeaderBuildEl = () => doc.createElement("div");
  plugin.buildAlbumHeaderDecorations(album.view);
  assert.equal(album.source.classList.contains("bob-album-header-surface"), true);
  assert.equal(recordRow.classList.contains(OWNED), true);
  assert.equal(albumOther.classList.contains(OWNED), false);
  plugin.albumHeaderCleanEditor(album.view);
  assert.equal(recordRow.classList.contains(OWNED), false);

  const bank = livePreviewEditor(doc);
  const bankRow = addRow(doc, bank.container, "bank");
  plugin.bankSetupLivePath = () => "bank.md";
  plugin.bankSetupModelFor = () => ({ signature: "s" });
  plugin.bankSetupOptions = () => ({ sourcePath: "bank.md" });
  plugin.bankSetupBuildReading = () => doc.createElement("div");
  plugin.bankSetupLiveDecorations(bank.view, "bank.md");
  assert.equal(bankRow.classList.contains(OWNED), true);
  plugin.bankSetupModelFor = () => null;
  plugin.bankSetupLiveDecorations(bank.view, "bank.md");
  assert.equal(bankRow.classList.contains(OWNED), false, "a failed mount restores the native row");
});

test("one bounded stylesheet rule hides owned rows without a species surface gate", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const css = fs.readFileSync(path.join(__dirname, "../plugins/bob-ledger-tools/styles.css"), "utf8");
  assert.match(css, /\.bob-property-card\s*\{[\s\S]*?--bob-property-card-accent:/);
  assert.match(css, /\.bob-property-card\[data-root-hue="blue"\]\s*\{\s*--bob-property-card-accent:/);
  assert.match(css, /\.bob-record-sheet\s*\{[\s\S]*?--bob-property-card-tint:\s*4%/);
  assert.match(css, /\.bob-bank-setup-body\s*\{[\s\S]*?font-size:\s*0\.9em/);
  const owned = css.split("\n").filter((line) => line.includes(".metadata-property.bob-property-card-owned-property"));
  assert.deepEqual(owned.map((line) => line.replace(/\s*[,{]\s*$/, "")), [
    ".cm-editor > .cm-scroller > .cm-sizer > .metadata-container .metadata-property.bob-property-card-owned-property",
    ".markdown-preview-view > .markdown-preview-sizer > .mod-header > .metadata-container .metadata-property.bob-property-card-owned-property",
  ]);
  assert.equal(/data-property-key="(record|bank)"\]\s*\{\s*display:\s*none/.test(css), false, "no unbounded key hiding");
});
