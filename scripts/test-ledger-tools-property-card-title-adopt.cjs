// Property-card adopter glue (bob-cli-o6 collection-cards): slot mount plus
// title ownership plus body fallback, on fake Live Preview and Reading DOM.
// Covers Reading and deferred Live Preview mounts, denials, onLost
// remounting, release, generations, sticky unstable and insert-failed
// fallbacks, same-node re-adoption, in-place patching, and the one-heading
// rule.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin {
  constructor(app) { this.app = app; }
  registerEditorExtension(extension) { (this.extensions ||= []).push(extension); }
  registerMarkdownPostProcessor() {}
  registerEvent() {}
}

const Platform = { isDesktopApp: true };
const editorInfoField = { info: true };
const editorLivePreviewField = { live: true };
const StateEffect = { define: () => { const type = { of(value) { return { type, value, is: (other) => other === type }; } }; return type; } };
const StateField = { define: (spec) => ({ stateField: true, spec }) };
class WidgetType {}
class RangeSetBuilder { constructor() { this.rows = []; } add(from, to, deco) { this.rows.push({ from, to, deco }); } finish() { return this.rows; } }
const Decoration = {
  none: [],
  widget: (options) => ({ ...options }),
  replace: (spec) => ({ spec, range(from, to) { return { from, to, value: this }; } }),
  set: (ranges) => ranges,
};
const EditorView = {
  decorations: { from: (field, get) => ({ facet: "decorations", field, get }) },
  editorAttributes: { of: (value) => value, from: (field, get) => ({ facet: "editorAttributes", field, get }) },
};
const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownRenderChild: class { constructor(el) { this.containerEl = el; } },
    Notice: class {}, Plugin: TestPlugin, Platform,
    normalizePath: (value) => value, editorInfoField, editorLivePreviewField,
  };
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value }, StateEffect, StateField, RangeSetBuilder };
  if (request === "@codemirror/view") return {
    Decoration, WidgetType, EditorView, ViewPlugin: { fromClass: (cls, options) => ({ cls, options }) },
  };
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers: H } = LedgerToolsPlugin;
Module._load = originalLoad;

const SLOT = "bob-property-card-title-slot";
const OWNS = "bob-property-card-owns-title";
const SOURCE = "bob-property-card-title-source";

// ---- Fake DOM ----
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
    this.root = false;
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
  get isConnected() { let node = this; while (node) { if (node.root) return true; node = node.parentNode; } return false; }
  get nextElementSibling() { const xs = this.parentNode?.children || []; const i = xs.indexOf(this); return i >= 0 ? xs[i + 1] || null : null; }
  get firstChild() { return this.childNodes[0] || null; }
  get nextSibling() { const xs = this.parentNode?.childNodes || []; const i = xs.indexOf(this); return i >= 0 ? xs[i + 1] || null : null; }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  hasAttribute(name) { return this.attrs.has(name); }
  removeAttribute(name) { this.attrs.delete(name); }
  appendChild(node) { return this.insertBefore(node, null); }
  insertBefore(node, anchor) {
    if (this.ownerDocument.failInsert) throw new Error("insert refused");
    node.parentNode?.removeChild?.(node);
    const index = anchor ? this.childNodes.indexOf(anchor) : -1;
    if (index >= 0) this.childNodes.splice(index, 0, node);
    else this.childNodes.push(node);
    node.parentNode = this;
    this.ownerDocument.inserts.push(node);
    return node;
  }
  removeChild(node) { const i = this.childNodes.indexOf(node); if (i >= 0) this.childNodes.splice(i, 1); node.parentNode = null; return node; }
  remove() { this.parentNode?.removeChild(this); }
  addEventListener(type, fn) { const rows = this.listeners.get(type) || []; rows.push(fn); this.listeners.set(type, rows); }
  fire(type, event = {}) { for (const fn of this.listeners.get(type) || []) fn({ type, preventDefault() {}, ...event }); }
  contains(node) { return node === this || this.childNodes.some((child) => child.contains(node)); }
  matches(selector) {
    return String(selector).split(",").some((raw) => {
      const part = raw.trim();
      const attr = /\[([\w-]+)(?:="([^"]*)")?\]/.exec(part);
      const bare = part.replace(/\[.*\]$/, "");
      const tag = /^([a-z][a-z0-9-]*)/i.exec(bare)?.[1];
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      const cls = bare.match(/\.[\w-]+/g) || [];
      if (!tag && !cls.length && !attr) return false;
      if (attr && !(this.attrs.has(attr[1]) && (attr[2] === undefined || this.attrs.get(attr[1]) === attr[2]))) return false;
      return cls.every((name) => this.classList.contains(name.slice(1)));
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
  const doc = { inserts: [], failInsert: false, observers: [], activeElement: null };
  doc.createElement = (tag) => new FakeNode(tag, doc);
  doc.createTextNode = (text) => new FakeText(text, doc);
  doc.defaultView = {
    MutationObserver: class {
      constructor(callback) { this.callback = callback; this.targets = []; doc.observers.push(this); }
      observe(target, options) { this.targets.push({ target, options }); }
      disconnect() { this.targets = []; }
      fire() { if (this.targets.length) this.callback([], this); }
    },
  };
  doc.body = doc.createElement("body");
  doc.body.root = true;
  return doc;
}

function el(doc, tag, cls, ...kids) {
  const node = doc.createElement(tag);
  if (cls) node.setAttribute("class", cls);
  for (const kid of kids) node.appendChild(typeof kid === "string" ? doc.createTextNode(kid) : kid);
  return node;
}

function fireSlotObservers(doc, parent) {
  for (const observer of doc.observers.slice()) {
    if (observer.targets.some((row) => row.target === parent)) observer.fire();
  }
}

// Reading: .markdown-preview-view > .markdown-preview-sizer > .mod-header,
// then a rendered H1 section.
function readingPane(doc, { title = "Restaurants", host = doc.body } = {}) {
  const scope = el(doc, "div", "markdown-preview-view markdown-rendered");
  host.appendChild(scope);
  const sizer = el(doc, "div", "markdown-preview-sizer");
  scope.appendChild(sizer);
  const header = el(doc, "div", "mod-header");
  sizer.appendChild(header);
  const inline = el(doc, "div", "inline-title", title);
  header.appendChild(inline);
  const properties = el(doc, "div", "metadata-container");
  header.appendChild(properties);
  const h1 = el(doc, "h1", "", title);
  const section = el(doc, "div", "el-h1", h1);
  sizer.appendChild(section);
  sizer.appendChild(el(doc, "div", "el-p", el(doc, "p", "", "Places to eat.")));
  return { doc, scope, sizer, header, inline, properties, h1, section };
}

// Live Preview: .markdown-source-view.is-live-preview > .cm-editor >
// .cm-scroller > .cm-sizer > [.inline-title, .metadata-container,
// .cm-contentContainer], with a fake EditorView carrying the kit field.
const ALBUM = "---\ntype: \"[[album]]\"\n---\n# Restaurants\nPlaces to eat.\n";
function fakeCmDoc(text) {
  const lines = [];
  let cursor = 0;
  for (const line of text.split("\n")) { lines.push({ text: line, from: cursor, to: cursor + line.length }); cursor += line.length + 1; }
  return { lines: lines.length, length: text.length, line: (n) => ({ number: n, ...lines[n - 1] }), toString: () => text };
}
function livePane(doc, { live = true, path = "eat.md", host = doc.body } = {}) {
  const source = el(doc, "div", `markdown-source-view mod-cm6${live ? " is-live-preview" : ""}`);
  host.appendChild(source);
  const scope = el(doc, "div", "cm-editor");
  source.appendChild(scope);
  const scroller = el(doc, "div", "cm-scroller");
  scope.appendChild(scroller);
  const sizer = el(doc, "div", "cm-sizer");
  scroller.appendChild(sizer);
  const inline = el(doc, "div", "inline-title", "Restaurants");
  sizer.appendChild(inline);
  const properties = el(doc, "div", "metadata-container");
  sizer.appendChild(properties);
  sizer.appendChild(el(doc, "div", "cm-contentContainer"));
  const field = H.propertyCardTitleOwnershipExtension();
  const fields = new Map([[field, H.propertyCardTitleFieldCreate()]]);
  const view = { dom: scope, dispatched: [], live, path };
  const stateFor = () => ({
    doc: fakeCmDoc(ALBUM),
    selection: { ranges: [{ from: 0, to: 0 }] },
    field(which) {
      if (which === editorLivePreviewField) return view.live;
      if (which === editorInfoField) return { file: { path: view.path } };
      return fields.has(which) ? fields.get(which) : undefined;
    },
  });
  view.state = stateFor();
  view.dispatch = (spec) => {
    view.dispatched.push(spec);
    const next = stateFor();
    fields.set(field, H.propertyCardTitleFieldReduce(fields.get(field), { effects: [].concat(spec.effects || []), docChanged: false, state: next, startState: next }));
    view.state = next;
  };
  view.owner = () => fields.get(field).owner;
  view.requestMeasure = () => { view.measures = (view.measures || 0) + 1; };
  return { doc, source, scope, scroller, sizer, inline, properties, view };
}

function queue() {
  const jobs = [];
  const defer = (fn) => jobs.push(fn);
  defer.flush = () => { while (jobs.length) jobs.shift()(); };
  defer.size = () => jobs.length;
  return defer;
}

// A kit album card: section.bob-property-card with a promoted title heading.
function card(doc, title = "Restaurants") {
  const root = el(doc, "section", "bob-album-header bob-property-card");
  H.propertyCardApplyIdentity(root, { kind: "album", title });
  const block = H.propertyCardBuildTitleBlock(doc, { kind: "album", title, kicker: [{ text: "Body", target: "body.md" }] });
  root.appendChild(block.element);
  return root;
}

function heading(node) { return node.querySelector(".bob-property-card-title"); }

// Exactly one visible level-one heading: aria-level=1 nodes plus native h1
// elements the kit has not hidden.
function levelOneCount(scope) {
  const aria = scope.querySelectorAll("[aria-level=\"1\"]").length;
  const h1 = scope.querySelectorAll("h1").filter((node) => !node.classList.contains(SOURCE)).length;
  return aria + h1;
}

test.afterEach(() => {
  H.propertyCardAdoptReleaseAll();
  H.propertyCardTitleSlotReleaseAll();
  H.propertyCardTitleReleaseAll();
  Platform.isDesktopApp = true;
});

test("Reading: mounts before Properties, owns the title, hides the H1, and promotes the one heading", () => {
  const doc = makeDoc();
  const pane = readingPane(doc);
  const node = card(doc);
  assert.equal(levelOneCount(pane.scope), 1, "native: one H1");
  const result = H.propertyCardAdoptTitle(pane.scope, node, {
    path: "eat.md", kind: "album", recognizer: H.propertyCardAlbumTitleRecognizer("Restaurants"),
  });
  assert.equal(result.mode, "slot");
  assert.equal(typeof result.release, "function");
  assert.equal(node.parentNode, pane.header);
  assert.equal(node.nextElementSibling, pane.properties, "the card sits before native Properties");
  assert.equal(node.classList.contains(SLOT), true);
  assert.equal(pane.scope.classList.contains(OWNS), true, "the inline title is hidden by the owning scope");
  assert.equal(pane.h1.classList.contains(SOURCE), true, "the redundant H1 is tagged, never deleted");
  assert.equal(heading(node).getAttribute("aria-level"), "1");
  assert.equal(heading(node).getAttribute("role"), "heading");
  assert.equal(levelOneCount(pane.scope), 1, "owned: exactly one level-one heading, the card's");
  assert.deepEqual(
    { ...H.propertyCardAdoptedEntry(pane.scope), generation: 0 },
    { node, path: "eat.md", kind: "album", mode: "slot", owned: true, pending: false, generation: 0 },
  );
});

test("Live Preview: returns slot at once, then mounts and dispatches ownership outside the update", () => {
  const doc = makeDoc();
  const pane = livePane(doc);
  const node = card(doc);
  const defer = queue();
  const result = H.propertyCardAdoptTitle(pane.scope, node, {
    path: "eat.md", kind: "album", view: pane.view, defer,
    recognizer: H.propertyCardAlbumTitleRecognizer("Restaurants"),
    currentPath: () => H.propertyCardLiveCurrentPath(pane.view),
  });
  assert.equal(result.mode, "slot");
  assert.equal(node.parentNode, null, "nothing mutates the DOM synchronously");
  assert.equal(pane.view.dispatched.length, 0, "nothing dispatches synchronously");
  assert.equal(H.propertyCardAdoptedEntry(pane.scope).pending, true);
  assert.equal(heading(node).getAttribute("aria-level"), null, "demoted until ownership is held");
  defer.flush();
  assert.equal(node.parentNode, pane.sizer);
  assert.equal(node.nextElementSibling, pane.properties);
  assert.equal(pane.view.dispatched.length, 1, "the ownership effect dispatched once");
  assert.equal(pane.view.owner()?.path, "eat.md");
  assert.equal(heading(node).getAttribute("aria-level"), "1");
  assert.equal(H.propertyCardAdoptedEntry(pane.scope).owned, true);
  assert.equal(H.propertyCardLiveCurrentPath(pane.view), "eat.md");
});

test("no slot (embed, mobile, Source mode) falls back with the heading demoted and no ownership", () => {
  const doc = makeDoc();
  const recognizer = H.propertyCardAlbumTitleRecognizer("Restaurants");
  const embedHost = el(doc, "div", "markdown-embed");
  doc.body.appendChild(embedHost);
  const embed = readingPane(doc, { host: embedHost });
  const source = livePane(doc, { live: false });
  const desktop = readingPane(doc);
  const cases = [
    ["embed", embed.scope, null],
    ["Source mode", source.scope, source.view],
  ];
  for (const [name, scope, view] of cases) {
    const node = card(doc);
    const result = H.propertyCardAdoptTitle(scope, node, { path: "eat.md", kind: "album", view, recognizer, defer: queue() });
    assert.equal(result.mode, "fallback", name);
    assert.equal(node.parentNode, null, `${name}: the adapter keeps body placement`);
    assert.equal(heading(node).getAttribute("aria-level"), null, `${name}: demoted`);
    assert.equal(heading(node).getAttribute("role"), null, `${name}: demoted`);
    assert.equal(scope.classList.contains(OWNS), false, `${name}: no ownership`);
    assert.equal(H.propertyCardAdoptedEntry(scope), null);
  }
  assert.equal(source.view.dispatched.length, 0);
  Platform.isDesktopApp = false;
  const mobile = card(doc);
  assert.equal(H.propertyCardAdoptTitle(desktop.scope, mobile, { path: "eat.md", recognizer }).mode, "fallback", "mobile");
  assert.equal(desktop.h1.classList.contains(SOURCE), false);
  assert.equal(H.propertyCardAdoptTitle(null, mobile, {}).mode, "fallback");
});

test("onLost(path-changed) releases the title in the same frame, notifies once deferred, and a re-adopt remounts", () => {
  const doc = makeDoc();
  const pane = readingPane(doc);
  const node = card(doc);
  const defer = queue();
  let leafPath = "eat.md";
  const lost = [];
  const options = {
    path: "eat.md", kind: "album", defer, recognizer: H.propertyCardAlbumTitleRecognizer("Restaurants"),
    currentPath: () => leafPath, onLost: (reason) => lost.push(reason),
  };
  H.propertyCardAdoptTitle(pane.scope, node, options);
  leafPath = "other.md";
  fireSlotObservers(doc, pane.header);
  assert.equal(node.parentNode, null, "the primitive took the card out");
  assert.equal(pane.scope.classList.contains(OWNS), false, "inline title returns in the same frame");
  assert.equal(pane.h1.classList.contains(SOURCE), false, "the H1 returns in the same frame");
  assert.equal(heading(node).getAttribute("aria-level"), null);
  assert.equal(H.propertyCardAdoptedEntry(pane.scope), null);
  assert.deepEqual(lost, [], "the adapter hears about it deferred");
  defer.flush();
  assert.deepEqual(lost, ["path-changed"]);
  defer.flush();
  assert.deepEqual(lost, ["path-changed"], "exactly once");
  leafPath = "eat.md";
  const again = H.propertyCardAdoptTitle(pane.scope, node, options);
  assert.equal(again.mode, "slot", "path-changed is not sticky");
  assert.equal(node.parentNode, pane.header);
  assert.equal(pane.scope.classList.contains(OWNS), true);
});

test("release restores native rendering in the same frame and never calls onLost", () => {
  const doc = makeDoc();
  const pane = readingPane(doc);
  const node = card(doc);
  const lost = [];
  const { release } = H.propertyCardAdoptTitle(pane.scope, node, {
    path: "eat.md", recognizer: H.propertyCardAlbumTitleRecognizer("Restaurants"), onLost: (reason) => lost.push(reason), defer: queue(),
  });
  release();
  release();
  assert.equal(node.parentNode, null);
  assert.equal(node.classList.contains(SLOT), false);
  assert.equal(pane.scope.classList.contains(OWNS), false);
  assert.equal(pane.h1.classList.contains(SOURCE), false);
  assert.equal(heading(node).getAttribute("aria-level"), null);
  assert.equal(H.propertyCardTitleSlotLiveCount(), 0);
  assert.deepEqual(lost, []);
  assert.equal(levelOneCount(pane.scope), 1, "native: the H1 is the one heading again");
});

test("an old handle never clears a newer adoption", () => {
  const doc = makeDoc();
  const pane = readingPane(doc);
  const first = card(doc);
  const second = card(doc, "Eateries");
  const old = H.propertyCardAdoptTitle(pane.scope, first, { path: "eat.md", recognizer: H.propertyCardAlbumTitleRecognizer("Restaurants") });
  const fresh = H.propertyCardAdoptTitle(pane.scope, second, { path: "eat.md", recognizer: H.propertyCardAlbumTitleRecognizer("Eateries") });
  assert.equal(first.parentNode, null, "the replaced node left the slot");
  assert.equal(heading(first).getAttribute("aria-level"), null);
  old.release();
  assert.equal(second.parentNode, pane.header);
  assert.equal(pane.scope.classList.contains(OWNS), true);
  assert.equal(H.propertyCardAdoptedEntry(pane.scope).node, second);
  fresh.release();
  assert.equal(second.parentNode, null);
});

test("unstable and insert-failed paths stay in the fallback until a new path or an explicit release", () => {
  const doc = makeDoc();
  const pane = readingPane(doc);
  const node = card(doc);
  const defer = queue();
  const lost = [];
  const options = (path) => ({
    path, recognizer: H.propertyCardAlbumTitleRecognizer("Restaurants"), defer,
    currentPath: () => path, onLost: (reason) => lost.push(reason),
  });
  H.propertyCardAdoptTitle(pane.scope, node, options("eat.md"));
  for (let round = 0; round <= H.PROPERTY_CARD_TITLE_SLOT_REINSERT_BUDGET && node.parentNode; round += 1) {
    node.remove();
    fireSlotObservers(doc, pane.header);
  }
  assert.equal(H.propertyCardAdoptedEntry(pane.scope), null);
  assert.equal(pane.scope.classList.contains(OWNS), false);
  defer.flush();
  assert.deepEqual(lost, ["unstable"]);
  assert.equal(H.propertyCardAdoptTitle(pane.scope, node, options("eat.md")).mode, "fallback", "sticky for the same path");
  assert.equal(H.propertyCardAdoptTitle(pane.scope, node, options("other.md")).mode, "slot", "a new path clears it");
  H.propertyCardAdoptRelease(pane.scope);

  const live = livePane(doc);
  const liveNode = card(doc);
  const liveDefer = queue();
  const liveLost = [];
  const liveOptions = {
    path: "eat.md", view: live.view, defer: liveDefer, recognizer: H.propertyCardAlbumTitleRecognizer("Restaurants"),
    currentPath: () => "eat.md", onLost: (reason) => liveLost.push(reason),
  };
  assert.equal(H.propertyCardAdoptTitle(live.scope, liveNode, liveOptions).mode, "slot");
  doc.failInsert = true;
  liveDefer.flush();
  doc.failInsert = false;
  assert.deepEqual(liveLost, ["insert-failed"], "the adapter refreshes into its fallback widget");
  assert.equal(live.view.dispatched.length, 0, "no ownership after a failed mount");
  assert.equal(heading(liveNode).getAttribute("aria-level"), null);
  assert.equal(H.propertyCardAdoptTitle(live.scope, liveNode, liveOptions).mode, "fallback");
  assert.equal(H.propertyCardAdoptRelease(live.scope), false, "nothing mounted, memory cleared");
  assert.equal(H.propertyCardAdoptTitle(live.scope, liveNode, liveOptions).mode, "slot");
  liveDefer.flush();
  assert.equal(liveNode.parentNode, live.sizer);
});

test("a same-node re-adopt never remounts; a changed recognizer key re-owns", () => {
  const doc = makeDoc();
  const pane = readingPane(doc);
  const node = card(doc);
  const first = H.propertyCardAdoptTitle(pane.scope, node, { path: "eat.md", kind: "album", recognizer: H.propertyCardAlbumTitleRecognizer("Restaurants") });
  const stats = H.propertyCardTitleSlotStats(pane.scope);
  const inserts = doc.inserts.length;
  const generation = H.propertyCardAdoptedEntry(pane.scope).generation;
  const again = H.propertyCardAdoptTitle(pane.scope, node, { path: "eat.md", kind: "album", recognizer: H.propertyCardAlbumTitleRecognizer("Restaurants") });
  assert.equal(again.release, first.release, "same handle");
  assert.equal(doc.inserts.length, inserts, "no DOM insertion");
  assert.equal(H.propertyCardTitleSlotStats(pane.scope).generation, stats.generation, "no remount");
  assert.equal(H.propertyCardAdoptedEntry(pane.scope).generation, generation);
  assert.equal(pane.h1.classList.contains(SOURCE), true);
  H.propertyCardAdoptTitle(pane.scope, node, { path: "eat.md", kind: "album", recognizer: H.propertyCardAlbumTitleRecognizer("Eateries") });
  assert.equal(H.propertyCardTitleSlotStats(pane.scope).generation, stats.generation, "still no remount");
  assert.equal(pane.h1.classList.contains(SOURCE), false, "the new title no longer matches the H1, so it shows");
  assert.equal(pane.scope.classList.contains(OWNS), true);
  assert.equal(levelOneCount(pane.scope), 2, "an unrecognized H1 stays visible as authored content");
});

test("propertyCardAdoptPatch swaps children and attributes but keeps the slot class and attributes", () => {
  const doc = makeDoc();
  const pane = readingPane(doc);
  const node = card(doc);
  node.setAttribute("data-stale", "yes");
  H.propertyCardAdoptTitle(pane.scope, node, { path: "eat.md", kind: "album", recognizer: H.propertyCardAlbumTitleRecognizer("Restaurants") });
  const generation = H.propertyCardTitleSlotStats(pane.scope).generation;
  const fresh = card(doc, "Restaurants");
  fresh.setAttribute("data-album-body", "report");
  fresh.appendChild(el(doc, "button", "bob-album-schema-summary", "▸ Schema"));
  assert.equal(H.propertyCardAdoptPatch(node, fresh), node);
  assert.equal(node.classList.contains(SLOT), true);
  assert.equal(node.getAttribute("data-title-slot-mode"), "reading");
  assert.equal(node.getAttribute("data-title-slot-kind"), "album");
  assert.equal(node.getAttribute("data-album-body"), "report");
  assert.equal(node.hasAttribute("data-stale"), false);
  assert.equal(node.querySelectorAll(".bob-album-schema-summary").length, 1);
  assert.equal(fresh.childNodes.length, 0, "fresh's children moved");
  assert.equal(node.parentNode, pane.header);
  assert.equal(H.propertyCardTitleSlotStats(pane.scope).generation, generation, "the body joins without a remount");
  H.propertyCardAdoptTitle(pane.scope, node, { path: "eat.md", kind: "album", recognizer: H.propertyCardAlbumTitleRecognizer("Restaurants") });
  assert.equal(levelOneCount(pane.scope), 1, "the re-adopt re-syncs the patched heading");
});

test("heading helpers, reading-view lookup, and releaseAll", () => {
  const doc = makeDoc();
  const node = card(doc);
  H.propertyCardDemoteTitleHeading(node);
  assert.equal(heading(node).hasAttribute("aria-level"), false);
  H.propertyCardPromoteTitleHeading(node);
  assert.equal(heading(node).getAttribute("aria-level"), "1");

  const pane = readingPane(doc);
  const container = el(doc, "div", "markdown-reading-view");
  doc.body.appendChild(container);
  container.appendChild(pane.scope);
  const renderer = { updateHeader() { this.updated = (this.updated || 0) + 1; } };
  const leaf = { view: { file: { path: "eat.md" }, previewMode: { containerEl: container, renderer } } };
  const app = { workspace: { getLeavesOfType: () => [{ view: {} }, leaf] } };
  const reading = H.propertyCardReadingViewFor(app, pane.scope);
  assert.equal(reading.view, renderer);
  assert.equal(reading.currentPath(), "eat.md");
  assert.equal(H.propertyCardReadingViewFor(app, readingPane(doc).scope), null);
  assert.equal(H.propertyCardReadingViewFor(null, pane.scope), null);

  H.propertyCardAdoptTitle(pane.scope, node, { path: "eat.md", view: reading.view, currentPath: reading.currentPath, recognizer: H.propertyCardAlbumTitleRecognizer("Restaurants") });
  assert.equal(renderer.updated, 1, "Reading re-measures the header after insertion");
  const live = livePane(doc);
  const liveNode = card(doc);
  const defer = queue();
  H.propertyCardAdoptTitle(live.scope, liveNode, { path: "eat.md", view: live.view, defer, recognizer: H.propertyCardAlbumTitleRecognizer("Restaurants") });
  defer.flush();
  H.propertyCardAdoptReleaseAll();
  assert.equal(node.parentNode, null);
  assert.equal(liveNode.parentNode, null);
  assert.equal(pane.scope.classList.contains(OWNS), false);
  assert.equal(H.propertyCardTitleSlotLiveCount(), 0);
  assert.equal(H.propertyCardAdoptedEntry(pane.scope), null);
  assert.equal(H.propertyCardAdoptedEntry(live.scope), null);
});
