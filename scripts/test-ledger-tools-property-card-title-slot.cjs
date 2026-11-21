// Property-card title slot: one card node mounts between the inline title and
// native Properties in the Live Preview .cm-sizer or the Reading .mod-header.
// Covers insertion order for every Properties shape, re-insertion, release
// generations, denials, self-release, measure, and plugin teardown.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin {
  constructor(app) { this.app = app; }
  registerEditorExtension() {}
  registerMarkdownPostProcessor() {}
  registerEvent() {}
}
class TestNotice { constructor(message) { this.message = String(message); } }

const Platform = { isDesktopApp: true };
const StateEffect = { define: () => ({ of(value) { return { effect: this, value }; }, is(other) { return this === other; } }) };
class WidgetType {}
class RangeSetBuilder { constructor() { this.rows = []; } add(from, to, deco) { this.rows.push({ from, to, deco }); } finish() { return this.rows; } }
const Decoration = { none: [], widget: (options) => ({ ...options }) };
const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownRenderChild: class { constructor(el) { this.containerEl = el; } },
    Notice: TestNotice, Plugin: TestPlugin, Platform,
    normalizePath: (value) => value, editorInfoField: { info: true }, editorLivePreviewField: { live: true },
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

const SLOT = "bob-property-card-title-slot";

class FakeNode {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase();
    this.nodeType = 1;
    this.ownerDocument = doc;
    this.parentNode = null;
    this.children = [];
    this.attrs = new Map();
    this.root = false;
    const self = this;
    this.classList = {
      add(name) { const xs = new Set(self.classNames()); xs.add(name); self.setAttribute("class", [...xs].join(" ")); },
      remove(name) { self.setAttribute("class", self.classNames().filter((x) => x !== name).join(" ")); },
      contains(name) { return self.classNames().includes(name); },
    };
  }
  classNames() { return (this.getAttribute("class") || "").split(/\s+/).filter(Boolean); }
  setAttribute(name, value) { this.attrs.set(name, String(value)); this.ownerDocument.writes.push(["attr", name]); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  removeAttribute(name) { this.attrs.delete(name); }
  hasAttribute(name) { return this.attrs.has(name); }
  get isConnected() { let node = this; while (node) { if (node.root) return true; node = node.parentNode; } return false; }
  get nextElementSibling() { const xs = this.parentNode?.children || []; const i = xs.indexOf(this); return i >= 0 ? xs[i + 1] || null : null; }
  get previousElementSibling() { const xs = this.parentNode?.children || []; const i = xs.indexOf(this); return i > 0 ? xs[i - 1] : null; }
  get firstElementChild() { return this.children[0] || null; }
  appendChild(node) { return this.insertBefore(node, null); }
  insertBefore(node, anchor) {
    if (this.ownerDocument.failInsert) throw new Error("insert refused");
    if (anchor && anchor.parentNode !== this) throw new Error("anchor is not a child");
    node.parentNode?.removeChild(node);
    const index = anchor ? this.children.indexOf(anchor) : this.children.length;
    this.children.splice(index, 0, node);
    node.parentNode = this;
    this.ownerDocument.writes.push(["insert", node]);
    return node;
  }
  removeChild(node) { const i = this.children.indexOf(node); if (i >= 0) this.children.splice(i, 1); node.parentNode = null; return node; }
  remove() { this.parentNode?.removeChild(this); }
  replaceWith(node) { const parent = this.parentNode; parent.insertBefore(node, this); parent.removeChild(this); }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  matches(selector) {
    return String(selector).split(",").some((part) => {
      const classes = part.trim().split(".").filter(Boolean);
      return classes.length > 0 && classes.every((name) => this.classList.contains(name));
    });
  }
  closest(selector) { let node = this; while (node) { if (node.matches(selector)) return node; node = node.parentNode; } return null; }
  querySelectorAll(selector) {
    const found = [];
    const walk = (node) => { for (const child of node.children) { if (child.matches(selector)) found.push(child); walk(child); } };
    walk(this);
    return found;
  }
}

function makeDoc() {
  const doc = { writes: [], failInsert: false, mutation: [], resize: [] };
  doc.createElement = (tag) => new FakeNode(tag, doc);
  doc.defaultView = {
    MutationObserver: class {
      constructor(callback) { this.callback = callback; this.targets = []; doc.mutation.push(this); }
      observe(target, options) { this.targets.push({ target, options }); }
      disconnect() { this.targets = []; this.disconnected = true; }
      fire() { this.callback([], this); }
    },
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; this.targets = []; doc.resize.push(this); }
      observe(target) { this.targets.push({ target }); }
      disconnect() { this.targets = []; this.disconnected = true; }
      fire() { this.callback([], this); }
    },
  };
  doc.body = doc.createElement("body");
  doc.body.root = true;
  return doc;
}

function el(doc, classes, parent) {
  const node = doc.createElement("div");
  if (classes) node.setAttribute("class", classes);
  if (parent) parent.appendChild(node);
  return node;
}

// Live Preview: .markdown-source-view.is-live-preview > .cm-editor > .cm-scroller > .cm-sizer
function liveScope(doc, { properties = true, title = true, content = true, sizer = true, live = true, host = doc.body } = {}) {
  const source = el(doc, "markdown-source-view mod-cm6" + (live ? " is-live-preview" : ""), host);
  const scope = el(doc, "cm-editor", source);
  const scroller = el(doc, "cm-scroller", scope);
  const parts = { doc, source, scope, scroller };
  if (!sizer) return parts;
  parts.sizer = el(doc, "cm-sizer", scroller);
  if (title) parts.title = el(doc, "inline-title", parts.sizer);
  if (properties) parts.properties = el(doc, "metadata-container", parts.sizer);
  if (content) parts.content = el(doc, "cm-contentContainer", parts.sizer);
  doc.writes.length = 0;
  return parts;
}

// Reading: .markdown-preview-view > .markdown-preview-sizer > .mod-header
function readingScope(doc, { properties = true, title = true, header = true, host = doc.body } = {}) {
  const scope = el(doc, "markdown-preview-view markdown-rendered", host);
  const sizer = el(doc, "markdown-preview-sizer", scope);
  const parts = { doc, scope, sizer };
  if (header) {
    parts.header = el(doc, "mod-header", sizer);
    if (title) parts.title = el(doc, "inline-title", parts.header);
    if (properties) parts.properties = el(doc, "metadata-container", parts.header);
  }
  parts.section = el(doc, "el-p", sizer);
  doc.writes.length = 0;
  return parts;
}

function card(doc) { return el(doc, "bob-property-card bob-title-slot-probe"); }
function order(parent) { return parent.children.map((node) => node.classNames()[0]); }
function liveObservers(doc) { return [...doc.mutation, ...doc.resize].filter((observer) => observer.targets.length > 0); }

test.afterEach(() => {
  helpers.propertyCardTitleSlotReleaseAll();
  Platform.isDesktopApp = true;
});

test("Live Preview mounts between the inline title and Properties for every Properties shape", () => {
  const doc = makeDoc();
  const visible = liveScope(doc);
  const node = card(doc);
  const release = helpers.propertyCardMountInTitleSlot(visible.scope, node, { path: "alpha.md", kind: "probe" });
  assert.equal(typeof release, "function");
  assert.deepEqual(order(visible.sizer), ["inline-title", "bob-property-card", "metadata-container", "cm-contentContainer"]);
  assert.equal(node.classList.contains(SLOT), true);
  assert.equal(node.getAttribute("data-title-slot-mode"), "live");
  assert.equal(node.getAttribute("data-title-slot-kind"), "probe");
  const slot = helpers.propertyCardTitleSlotFor(visible.scope);
  assert.equal(slot.mode, "live");
  assert.equal(slot.parent, visible.sizer);
  assert.equal(slot.anchor, visible.properties);

  const hidden = liveScope(doc, { properties: false });
  const other = card(doc);
  helpers.propertyCardMountInTitleSlot(hidden.scope, other, { path: "beta.md" });
  assert.deepEqual(order(hidden.sizer), ["inline-title", "bob-property-card", "cm-contentContainer"]);
  assert.equal(other.hasAttribute("data-title-slot-kind"), false);

  const nested = liveScope(doc, { properties: false });
  const wrapper = el(doc, "some-plugin-wrapper");
  hidden.doc.body.appendChild(wrapper);
  nested.sizer.insertBefore(wrapper, nested.content);
  el(doc, "metadata-container", wrapper);
  const third = card(doc);
  helpers.propertyCardMountInTitleSlot(nested.scope, third, {});
  assert.equal(third.nextElementSibling, nested.content, "a nested .metadata-container is not the anchor");
  assert.equal(helpers.propertyCardTitleSlotLiveCount(), 3);
});

test("Reading mounts before Properties or appends to .mod-header", () => {
  const doc = makeDoc();
  const visible = readingScope(doc);
  const node = card(doc);
  assert.equal(typeof helpers.propertyCardMountInTitleSlot(visible.scope, node, { path: "alpha.md" }), "function");
  assert.deepEqual(order(visible.header), ["inline-title", "bob-property-card", "metadata-container"]);
  assert.equal(node.getAttribute("data-title-slot-mode"), "reading");

  const hidden = readingScope(doc, { properties: false });
  const other = card(doc);
  helpers.propertyCardMountInTitleSlot(hidden.scope, other, { path: "beta.md" });
  assert.deepEqual(order(hidden.header), ["inline-title", "bob-property-card"]);
  assert.equal(other.nextElementSibling, null);

  const nested = readingScope(doc, { properties: false });
  const wrapper = el(doc, "callout", nested.header);
  el(doc, "metadata-container", wrapper);
  const third = card(doc);
  helpers.propertyCardMountInTitleSlot(nested.scope, third, {});
  assert.deepEqual(order(nested.header), ["inline-title", "callout", "bob-property-card"], "nested Properties are ignored");
});

test("the observer re-inserts a removed node and re-anchors before new Properties", () => {
  const doc = makeDoc();
  const parts = liveScope(doc);
  const node = card(doc);
  const view = { measures: 0, requestMeasure() { this.measures += 1; } };
  helpers.propertyCardMountInTitleSlot(parts.scope, node, { path: "alpha.md", view });
  const observer = doc.mutation[0];
  assert.deepEqual(observer.targets.map((row) => row.target), [parts.sizer, parts.source]);
  assert.deepEqual(observer.targets[0].options, { childList: true });
  assert.deepEqual(observer.targets[1].options, { attributes: true, attributeFilter: ["class"] });
  assert.ok(observer.targets.every((row) => !row.options.subtree), "never observes subtree");

  node.remove();
  observer.fire();
  assert.deepEqual(order(parts.sizer), ["inline-title", "bob-property-card", "metadata-container", "cm-contentContainer"]);

  // Obsidian re-renders Properties right after the inline title.
  const fresh = el(doc, "metadata-container");
  parts.properties.remove();
  parts.sizer.insertBefore(fresh, parts.sizer.children[1]);
  assert.deepEqual(order(parts.sizer), ["inline-title", "metadata-container", "bob-property-card", "cm-contentContainer"]);
  observer.fire();
  assert.deepEqual(order(parts.sizer), ["inline-title", "bob-property-card", "metadata-container", "cm-contentContainer"]);
  assert.equal(node.nextElementSibling, fresh);
  assert.equal(helpers.propertyCardTitleSlotStats(parts.scope).reinserts, 2);
  assert.ok(view.measures >= 3, "every Live Preview insertion re-measures");

  doc.writes.length = 0;
  observer.fire();
  assert.deepEqual(doc.writes, [], "a node already in place causes no DOM write");
});

test("a replaced .mod-header moves the card and its observers", () => {
  const doc = makeDoc();
  const parts = readingScope(doc);
  const node = card(doc);
  helpers.propertyCardMountInTitleSlot(parts.scope, node, { path: "alpha.md" });
  const observer = doc.mutation[0];
  assert.deepEqual(observer.targets.map((row) => row.target), [parts.header, parts.sizer]);
  const header = el(doc, "mod-header");
  el(doc, "inline-title", header);
  const properties = el(doc, "metadata-container", header);
  parts.header.replaceWith(header);
  observer.fire();
  assert.equal(node.parentNode, header);
  assert.equal(node.nextElementSibling, properties);
  assert.deepEqual(observer.targets.map((row) => row.target), [header, parts.sizer], "observers follow the new header");
  assert.equal(helpers.propertyCardTitleSlotStats(parts.scope).reinserts, 1);
});

test("exhausting the re-insertion budget self-releases as unstable", () => {
  const doc = makeDoc();
  const parts = liveScope(doc);
  const node = card(doc);
  const lost = [];
  helpers.propertyCardMountInTitleSlot(parts.scope, node, { path: "alpha.md", onLost: (reason) => lost.push(reason) });
  const observer = doc.mutation[0];
  for (let i = 0; i < helpers.PROPERTY_CARD_TITLE_SLOT_REINSERT_BUDGET; i += 1) {
    parts.sizer.appendChild(node); // another writer keeps moving it
    observer.fire();
    assert.equal(node.nextElementSibling, parts.properties);
  }
  parts.sizer.appendChild(node);
  observer.fire();
  assert.deepEqual(lost, ["unstable"]);
  assert.equal(node.parentNode, null);
  assert.equal(helpers.propertyCardTitleSlotLiveCount(), 0);
  assert.equal(liveObservers(doc).length, 0);
});

test("release handles are generation-bound, idempotent, and complete", () => {
  const doc = makeDoc();
  const parts = liveScope(doc);
  const node = card(doc);
  const view = { requestMeasure() {} };
  const stale = helpers.propertyCardMountInTitleSlot(parts.scope, node, { path: "alpha.md", kind: "probe", view });
  doc.writes.length = 0;
  const current = helpers.propertyCardMountInTitleSlot(parts.scope, node, { path: "alpha.md", kind: "probe", view });
  assert.equal(doc.writes.filter((row) => row[0] === "insert").length, 0, "same node, same scope: no re-insert");
  assert.equal(parts.sizer.children.filter((child) => child === node).length, 1);
  assert.equal(helpers.propertyCardTitleSlotLiveCount(), 1);
  stale();
  assert.equal(node.parentNode, parts.sizer, "an old handle is a no-op after a re-mount");
  assert.equal(helpers.propertyCardTitleSlotMountedNode(parts.scope), node);
  current();
  assert.equal(node.parentNode, null);
  assert.equal(node.classList.contains(SLOT), false);
  assert.equal(node.hasAttribute("data-title-slot-mode"), false);
  assert.equal(node.hasAttribute("data-title-slot-kind"), false);
  assert.equal(liveObservers(doc).length, 0, "every observer disconnected");
  assert.equal(helpers.propertyCardTitleSlotLiveCount(), 0);
  assert.doesNotThrow(() => current());
  assert.equal(helpers.propertyCardTitleSlotMountedNode(parts.scope), null);
});

test("moving a node to another scope releases the first; a new node replaces the old", () => {
  const doc = makeDoc();
  const first = liveScope(doc);
  const second = readingScope(doc);
  const node = card(doc);
  const lost = [];
  const releaseFirst = helpers.propertyCardMountInTitleSlot(first.scope, node, { path: "alpha.md", onLost: (r) => lost.push(r) });
  helpers.propertyCardMountInTitleSlot(second.scope, node, { path: "alpha.md" });
  assert.equal(node.parentNode, second.header);
  assert.equal(node.getAttribute("data-title-slot-mode"), "reading");
  assert.equal(helpers.propertyCardTitleSlotMountedNode(first.scope), null);
  assert.equal(helpers.propertyCardTitleSlotLiveCount(), 1);
  releaseFirst();
  assert.equal(node.parentNode, second.header, "the released scope's handle never touches the new mount");
  assert.deepEqual(lost, [], "an explicit move never fires onLost");

  const replacement = card(doc);
  helpers.propertyCardMountInTitleSlot(second.scope, replacement, { path: "beta.md" });
  assert.equal(node.parentNode, null, "the old node is removed");
  assert.equal(node.classList.contains(SLOT), false);
  assert.deepEqual(order(second.header), ["inline-title", "bob-property-card", "metadata-container"]);
  assert.equal(helpers.propertyCardTitleSlotLiveCount(), 1);
});

test("denied scopes return null with no DOM change", () => {
  const doc = makeDoc();
  const node = card(doc);
  const denied = (scope, label) => {
    doc.writes.length = 0;
    assert.equal(helpers.propertyCardTitleSlotFor(scope), null, label);
    assert.equal(helpers.propertyCardMountInTitleSlot(scope, node, { path: "alpha.md" }), null, label);
    assert.equal(node.parentNode, null, label);
    assert.equal(node.classList.contains(SLOT), false, label);
    assert.equal(doc.writes.filter((row) => row[0] === "insert").length, 0, label);
  };
  denied(null, "null scope");
  denied({ classList: { contains: () => true } }, "non-element scope");
  denied(el(doc, "workspace-leaf", doc.body), "other scope class");
  for (const boundary of ["markdown-embed", "internal-embed", "hover-popover", "canvas-node", "print"]) {
    const host = el(doc, boundary, doc.body);
    denied(readingScope(doc, { host }).scope, boundary + " reading");
    denied(liveScope(doc, { host }).scope, boundary + " live");
  }
  denied(liveScope(doc, { live: false }).scope, "Source mode");
  denied(liveScope(doc, { sizer: false }).scope, "missing .cm-sizer");
  denied(liveScope(doc, { content: false }).scope, "missing .cm-contentContainer");
  denied(readingScope(doc, { header: false }).scope, "missing .mod-header");
  const orphan = liveScope(doc);
  orphan.source.remove();
  denied(orphan.scope, "disconnected scope");
  const bare = el(doc, "cm-editor", doc.body);
  denied(bare, "cm-editor without a source view");
  Platform.isDesktopApp = false;
  denied(liveScope(doc).scope, "mobile live");
  denied(readingScope(doc).scope, "mobile reading");
  Platform.isDesktopApp = true;
  assert.equal(helpers.propertyCardMountInTitleSlot(liveScope(doc).scope, null, {}), null, "missing node");
  assert.equal(helpers.propertyCardTitleSlotLiveCount(), 0);
});

test("a denial after mount releases the scope's existing entry", () => {
  const doc = makeDoc();
  const parts = liveScope(doc);
  const node = card(doc);
  helpers.propertyCardMountInTitleSlot(parts.scope, node, { path: "alpha.md" });
  parts.source.classList.remove("is-live-preview");
  assert.equal(helpers.propertyCardMountInTitleSlot(parts.scope, node, { path: "alpha.md" }), null);
  assert.equal(node.parentNode, null);
  assert.equal(helpers.propertyCardTitleSlotLiveCount(), 0);
});

test("switching to Source self-releases with onLost(denied)", () => {
  const doc = makeDoc();
  const parts = liveScope(doc);
  const node = card(doc);
  const lost = [];
  helpers.propertyCardMountInTitleSlot(parts.scope, node, { path: "alpha.md", onLost: (reason) => lost.push(reason) });
  parts.source.classList.remove("is-live-preview");
  doc.mutation[0].fire();
  assert.deepEqual(lost, ["denied"]);
  assert.equal(node.parentNode, null);
  assert.equal(node.classList.contains(SLOT), false);
  assert.equal(liveObservers(doc).length, 0);
  doc.mutation[0].fire();
  assert.deepEqual(lost, ["denied"], "a released entry never fires twice");
});

test("a currentPath mismatch self-releases with onLost(path-changed)", () => {
  const doc = makeDoc();
  const parts = readingScope(doc);
  const node = card(doc);
  const lost = [];
  let path = "alpha.md";
  helpers.propertyCardMountInTitleSlot(parts.scope, node, { path: "alpha.md", currentPath: () => path, onLost: (reason) => lost.push(reason) });
  doc.mutation[0].fire();
  assert.deepEqual(lost, []);
  assert.equal(node.parentNode, parts.header);
  path = "beta.md";
  doc.mutation[0].fire();
  assert.deepEqual(lost, ["path-changed"]);
  assert.equal(node.parentNode, null);
});

test("a throwing onLost is swallowed and explicit releases never call it", () => {
  const doc = makeDoc();
  const parts = liveScope(doc);
  const node = card(doc);
  let calls = 0;
  const onLost = () => { calls += 1; throw new Error("adapter bug"); };
  helpers.propertyCardMountInTitleSlot(parts.scope, node, { path: "alpha.md", currentPath: () => "", onLost });
  assert.doesNotThrow(() => doc.mutation[0].fire());
  assert.equal(calls, 1);
  assert.equal(helpers.propertyCardTitleSlotLiveCount(), 0);
  const again = card(doc);
  const release = helpers.propertyCardMountInTitleSlot(parts.scope, again, { path: "alpha.md", onLost });
  release();
  assert.equal(helpers.propertyCardTitleSlotRelease(parts.scope), false);
  const third = card(doc);
  helpers.propertyCardMountInTitleSlot(parts.scope, third, { path: "alpha.md", onLost });
  assert.equal(helpers.propertyCardTitleSlotRelease(parts.scope), true);
  assert.equal(third.parentNode, null);
  assert.equal(calls, 1);
});

test("the ResizeObserver re-measures Live Preview and never throws elsewhere", () => {
  const doc = makeDoc();
  const live = liveScope(doc);
  const view = { measures: 0, requestMeasure() { this.measures += 1; } };
  const node = card(doc);
  helpers.propertyCardMountInTitleSlot(live.scope, node, { path: "alpha.md", view });
  assert.equal(view.measures, 1, "one measure after the Live Preview insertion");
  const resize = doc.resize[0];
  assert.equal(resize.targets[0].target, node);
  resize.fire();
  resize.fire();
  assert.equal(view.measures, 3);

  const reading = readingScope(doc);
  const readingView = { measures: 0, requestMeasure() { this.measures += 1; } };
  helpers.propertyCardMountInTitleSlot(reading.scope, card(doc), { view: readingView });
  assert.doesNotThrow(() => doc.resize[1].fire());
  assert.equal(readingView.measures, 0, "Reading never asks CodeMirror to measure");
  const noView = liveScope(doc);
  helpers.propertyCardMountInTitleSlot(noView.scope, card(doc), {});
  assert.doesNotThrow(() => doc.resize[2].fire());
  const throwing = liveScope(doc);
  helpers.propertyCardMountInTitleSlot(throwing.scope, card(doc), { view: { requestMeasure() { throw new Error("gone"); } } });
  assert.doesNotThrow(() => doc.resize[3].fire());
});

test("hosts without observers still mount and release", () => {
  const doc = makeDoc();
  doc.defaultView = {};
  const parts = readingScope(doc);
  const node = card(doc);
  const release = helpers.propertyCardMountInTitleSlot(parts.scope, node, { path: "alpha.md" });
  assert.equal(node.parentNode, parts.header);
  release();
  assert.equal(node.parentNode, null);
});

test("an insertion that throws returns null and leaves no entry", () => {
  const doc = makeDoc();
  const parts = liveScope(doc);
  const node = card(doc);
  doc.failInsert = true;
  assert.equal(helpers.propertyCardMountInTitleSlot(parts.scope, node, { path: "alpha.md" }), null);
  assert.equal(helpers.propertyCardTitleSlotLiveCount(), 0);
  assert.equal(node.classList.contains(SLOT), false);
  assert.equal(doc.mutation.length + doc.resize.length, 0);
});

test("a later mount prunes entries whose scope was disconnected", () => {
  const doc = makeDoc();
  const closed = liveScope(doc);
  const open = liveScope(doc);
  helpers.propertyCardMountInTitleSlot(closed.scope, card(doc), { path: "alpha.md" });
  helpers.propertyCardMountInTitleSlot(open.scope, card(doc), { path: "alpha.md" });
  assert.equal(helpers.propertyCardTitleSlotLiveCount(), 2);
  closed.source.remove();
  helpers.propertyCardMountInTitleSlot(open.scope, helpers.propertyCardTitleSlotMountedNode(open.scope), { path: "alpha.md" });
  assert.equal(helpers.propertyCardTitleSlotLiveCount(), 1);
  assert.equal(doc.mutation.filter((observer) => observer.targets.some((row) => closed.sizer === row.target)).length, 0);
});

test("ReleaseAll and plugin teardown leave no slot node and no live observer", () => {
  const doc = makeDoc();
  const nodes = [];
  for (const parts of [liveScope(doc), readingScope(doc), liveScope(doc)]) {
    const node = card(doc);
    nodes.push(node);
    helpers.propertyCardMountInTitleSlot(parts.scope, node, { path: "alpha.md", view: { requestMeasure() {} }, onLost: () => assert.fail("teardown never calls onLost") });
  }
  assert.equal(helpers.propertyCardTitleSlotLiveCount(), 3);
  helpers.propertyCardTitleSlotReleaseAll();
  assert.equal(helpers.propertyCardTitleSlotLiveCount(), 0);
  assert.equal(doc.body.querySelectorAll("." + SLOT).length, 0);
  assert.ok(nodes.every((node) => node.parentNode === null));
  assert.equal(liveObservers(doc).length, 0);

  const parts = readingScope(doc);
  const node = card(doc);
  helpers.propertyCardMountInTitleSlot(parts.scope, node, { path: "alpha.md" });
  const plugin = new LedgerToolsPlugin({ workspace: { getLeavesOfType: () => [] }, metadataCache: {}, vault: {} });
  plugin.teardownLedgerToolsSurfaces();
  assert.equal(node.parentNode, null, "the plugin's own teardown releases title-slot mounts");
  assert.equal(helpers.propertyCardTitleSlotLiveCount(), 0);
  assert.equal(liveObservers(doc).length, 0);
});

function rect(top, height) { return { top, bottom: top + height, height, left: 0, right: 700, width: 700 }; }

test("Reading re-measures through the renderer's updateHeader", () => {
  const doc = makeDoc();
  const parts = readingScope(doc);
  const renderer = { headers: 0, updateHeader() { this.headers += 1; } };
  helpers.propertyCardMountInTitleSlot(parts.scope, card(doc), { path: "alpha.md", view: renderer });
  assert.equal(renderer.headers, 1, "one header re-measure after the Reading insertion");
  doc.resize[0].fire();
  assert.equal(renderer.headers, 2, "every size change re-measures the cached header height");
});

test("the Live Preview measure rescues a scroll target CodeMirror would drop", () => {
  const doc = makeDoc();
  const parts = liveScope(doc);
  const requests = [];
  const scrollDOM = { scrollTop: 0, getBoundingClientRect: () => rect(80, 900) };
  const contentDOM = { getBoundingClientRect: () => rect(1100 - scrollDOM.scrollTop, 4000) };
  const view = { viewState: { scrollTarget: { range: { head: 900 } } }, scrollDOM, contentDOM, requestMeasure(request) { requests.push(request); } };
  helpers.propertyCardMountInTitleSlot(parts.scope, card(doc), { path: "alpha.md", view });
  const [rescue] = requests;
  assert.equal(typeof rescue.read, "function");
  const shift = rescue.read(view);
  assert.equal(shift, 1020, "content top below the visible scroller: shift it to the scroller top");
  rescue.write(shift, view);
  assert.equal(scrollDOM.scrollTop, 1020);
  assert.equal(requests.length, 2, "a follow-up request keeps CodeMirror's measure loop running");
  assert.equal(requests[1].read(view), null);
  assert.equal(rescue.read(view), null, "content in view: CodeMirror scrolls on its own");
  view.viewState.scrollTarget = null;
  scrollDOM.scrollTop = 0;
  assert.equal(rescue.read(view), null, "no pending target: never scroll");
  assert.equal(rescue.read({}), null, "missing CodeMirror internals degrade to a plain measure");
  assert.doesNotThrow(() => rescue.write(null, view));
  assert.equal(scrollDOM.scrollTop, 0);
});

test("Live Preview keeps the visible text still when an off-screen card resizes", () => {
  const doc = makeDoc();
  const parts = liveScope(doc);
  const node = card(doc);
  let height = 120;
  let top = -500;
  node.getBoundingClientRect = () => rect(top, height);
  const scrollDOM = { scrollTop: 0, getBoundingClientRect: () => rect(80, 900) };
  const view = { scrollDOM, requestMeasure() {} };
  helpers.propertyCardMountInTitleSlot(parts.scope, node, { path: "alpha.md", view });
  assert.equal(scrollDOM.scrollTop, 0, "a fresh insertion at the top of the note never scrolls");
  scrollDOM.scrollTop = 2000;
  height = 420;
  doc.resize[0].fire();
  assert.equal(scrollDOM.scrollTop, 2300, "growth above the visible area moves scrollTop with it");
  height = 220;
  doc.resize[0].fire();
  assert.equal(scrollDOM.scrollTop, 2100, "shrinking moves it back");
  top = 200;
  height = 320;
  doc.resize[0].fire();
  assert.equal(scrollDOM.scrollTop, 2100, "a visible card's growth moves the text naturally");

  // A late mount while the reader is scrolled into the body.
  const late = liveScope(doc);
  const lateNode = card(doc);
  lateNode.getBoundingClientRect = () => rect(-900, 300);
  const lateScroll = { scrollTop: 1500, getBoundingClientRect: () => rect(80, 900) };
  helpers.propertyCardMountInTitleSlot(late.scope, lateNode, { path: "alpha.md", view: { scrollDOM: lateScroll, requestMeasure() {} } });
  assert.equal(lateScroll.scrollTop, 1800, "a fresh off-screen insertion keeps the restored position");
  lateNode.remove();
  doc.mutation[doc.mutation.length - 1].fire();
  assert.equal(lateNode.parentNode, late.sizer);
  assert.equal(lateScroll.scrollTop, 1800, "re-inserting a node Obsidian moved never adjusts");

  const reading = readingScope(doc);
  const readingNode = card(doc);
  readingNode.getBoundingClientRect = () => rect(-900, 300);
  helpers.propertyCardMountInTitleSlot(reading.scope, readingNode, { path: "alpha.md", view: { scrollDOM: lateScroll, updateHeader() {} } });
  assert.equal(lateScroll.scrollTop, 1800, "Reading scrollers anchor natively");
});

test("a closed leaf self-releases with onLost(disconnected)", () => {
  const doc = makeDoc();
  const parts = liveScope(doc);
  const node = card(doc);
  const lost = [];
  helpers.propertyCardMountInTitleSlot(parts.scope, node, { path: "alpha.md", onLost: (reason) => lost.push(reason) });
  parts.source.remove();
  parts.properties.remove();
  doc.mutation[0].fire();
  assert.deepEqual(lost, ["disconnected"]);
  assert.equal(helpers.propertyCardTitleSlotLiveCount(), 0);
  assert.equal(liveObservers(doc).length, 0);
});

test("a Reading header virtualized out of the sizer parks the card instead of losing it", () => {
  const doc = makeDoc();
  const parts = readingScope(doc);
  const node = card(doc);
  const lost = [];
  const renderer = { headers: 0, updateHeader() { this.headers += 1; } };
  let height = 120;
  node.getBoundingClientRect = () => rect(100, node.isConnected ? height : 0);
  const stale = helpers.propertyCardMountInTitleSlot(parts.scope, node, { path: "alpha.md", view: renderer, onLost: (reason) => lost.push(reason) });
  assert.equal(renderer.headers, 1);
  // Scrolling far down: Obsidian detaches .mod-header, card and all.
  parts.header.remove();
  doc.mutation[0].fire();
  assert.deepEqual(lost, [], "a parked header is not a lost slot");
  assert.equal(node.parentNode, parts.header);
  assert.equal(helpers.propertyCardTitleSlotMountedNode(parts.scope), node);
  doc.resize[0].fire();
  assert.equal(renderer.headers, 1, "a detached card never re-measures the header");
  // An adapter refresh while parked keeps the same node under a new handle.
  const current = helpers.propertyCardMountInTitleSlot(parts.scope, node, { path: "alpha.md", view: renderer, onLost: (reason) => lost.push(reason) });
  assert.equal(typeof current, "function");
  stale();
  assert.equal(node.parentNode, parts.header, "the pre-park handle is stale");
  // Scrolling back: the same header returns with the card in place.
  parts.sizer.insertBefore(parts.header, parts.section);
  doc.writes.length = 0;
  doc.mutation[0].fire();
  assert.equal(doc.writes.filter((row) => row[0] === "insert").length, 0, "no re-insert when the header returns as-is");
  assert.equal(helpers.propertyCardTitleSlotStats(parts.scope).reinserts, 0);
  doc.resize[0].fire();
  assert.equal(renderer.headers, 1, "an unchanged height needs no re-measure");
  height = 300;
  doc.resize[0].fire();
  assert.equal(renderer.headers, 2, "a real size change re-measures");
  // A new node while parked cannot mount: body fallback, old card released.
  parts.header.remove();
  doc.mutation[0].fire();
  assert.equal(helpers.propertyCardMountInTitleSlot(parts.scope, card(doc), { path: "alpha.md" }), null);
  assert.equal(helpers.propertyCardTitleSlotLiveCount(), 0);
  assert.equal(node.parentNode, null);
  current();
  assert.deepEqual(lost, []);
});

test("Live Preview never parks: a vanished .cm-sizer child set is a denial", () => {
  const doc = makeDoc();
  const parts = liveScope(doc);
  const lost = [];
  helpers.propertyCardMountInTitleSlot(parts.scope, card(doc), { path: "alpha.md", onLost: (reason) => lost.push(reason) });
  parts.content.remove();
  doc.mutation[0].fire();
  assert.deepEqual(lost, ["denied"]);
});

test("the editor update listener arms the rescue only for an editor with a mounted Live Preview card", () => {
  assert.deepEqual(helpers.propertyCardTitleSlotEditorExtension(), [], "no updateListener facet: an empty extension");
  const doc = makeDoc();
  const parts = liveScope(doc);
  const requests = [];
  const view = { viewState: { scrollTarget: { range: { head: 1 } } }, requestMeasure(request) { requests.push(request); } };
  assert.doesNotThrow(() => helpers.propertyCardTitleSlotOnEditorUpdate({ view }), "inert with no mount");
  assert.equal(requests.length, 0);
  helpers.propertyCardMountInTitleSlot(parts.scope, card(doc), { path: "alpha.md", view });
  requests.length = 0;
  helpers.propertyCardTitleSlotOnEditorUpdate({ view });
  assert.equal(requests.length, 1, "a pending scroll target arms one rescue request");
  assert.equal(typeof requests[0].write, "function");
  helpers.propertyCardTitleSlotOnEditorUpdate({ view });
  assert.equal(requests.length, 1, "the same pending target does not re-arm");
  helpers.propertyCardTitleSlotOnEditorUpdate({ view: { viewState: { scrollTarget: {} }, requestMeasure() { assert.fail("another editor"); } } });
  view.viewState.scrollTarget = null;
  helpers.propertyCardTitleSlotOnEditorUpdate({ view });
  assert.equal(requests.length, 1, "no pending target: nothing to rescue");
  assert.doesNotThrow(() => helpers.propertyCardTitleSlotOnEditorUpdate(null));
});

test("Live Preview measure requests are budgeted so a size loop cannot freeze the renderer", () => {
  const doc = makeDoc();
  const parts = liveScope(doc);
  const requests = [];
  const view = { requestMeasure(request) { requests.push(request); } };
  helpers.propertyCardMountInTitleSlot(parts.scope, card(doc), { path: "alpha.md", view });
  const afterMount = requests.length;
  for (let i = 0; i < 20; i += 1) doc.resize[0].fire();
  assert.ok(requests.length - afterMount < 20, "a tight ResizeObserver loop does not measure on every fire");
  assert.ok(requests.length <= 8, "mount plus the loop stay inside the measure budget");
});
