// Property-card kit: whole-container frontmatter ownership. Generation-bound
// release, Source toggle in the same transaction, path change, embed/popover
// and mobile denial, idempotent re-own, inert plus the focusin guard, and
// the CSS variables / direct-child fallback.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

class TestPlugin {
  constructor(app) { this.app = app; }
  registerEditorExtension(extension) { (this.extensions ||= []).push(extension); }
  registerMarkdownPostProcessor(handler, order) { (this.postProcessors ||= []).push({ handler, order }); }
  registerEvent(ref) { (this.events ||= []).push(ref); return ref; }
}

const editorInfoField = { info: true };
const editorLivePreviewField = { live: true };
const Platform = { isDesktopApp: true };
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

const OWNS = "bob-property-card-owns-frontmatter";

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
    this.inert = false;
    this.focused = false;
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
  setAttribute(name, value) {
    this.attrs.set(name, String(value));
    if (name === "inert") this.inert = true;
  }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  removeAttribute(name) {
    this.attrs.delete(name);
    if (name === "inert") this.inert = false;
  }
  appendChild(node) { node.parentNode?.removeChild?.(node); node.parentNode = this; this.childNodes.push(node); return node; }
  removeChild(node) { const i = this.childNodes.indexOf(node); if (i >= 0) this.childNodes.splice(i, 1); node.parentNode = null; return node; }
  contains(node) { return node === this || this.childNodes.some((child) => child.contains(node)); }
  matches(selector) {
    return String(selector).split(",").some((raw) => {
      const part = raw.trim();
      const tag = /^([a-z][a-z0-9-]*)/i.exec(part)?.[1];
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      const cls = part.match(/\.[\w-]+/g) || [];
      if (!tag && !cls.length) return false;
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
  addEventListener(type, fn) {
    const list = this.listeners.get(type) || [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  removeEventListener(type, fn) {
    const list = (this.listeners.get(type) || []).filter((item) => item !== fn);
    this.listeners.set(type, list);
  }
  dispatch(type, event) {
    for (const fn of this.listeners.get(type) || []) fn(event);
  }
  focus() { this.focused = true; }
}

function makeDoc() {
  const observers = [];
  const doc = {
    observers,
    createElement(tag) { return new FakeNode(tag, doc); },
    createTextNode(text) { return new FakeText(text, doc); },
    defaultView: {
      MutationObserver: class {
        constructor(callback) { this.callback = callback; observers.push(this); }
        observe(target, options) { this.target = target; this.options = options; this.connected = true; }
        disconnect() { this.connected = false; }
        trigger() { if (this.connected) this.callback([]); }
      },
    },
  };
  return doc;
}

function el(doc, tag, cls, ...kids) {
  const node = doc.createElement(tag);
  if (cls) node.setAttribute("class", cls);
  for (const kid of kids) node.appendChild(typeof kid === "string" ? doc.createTextNode(kid) : kid);
  return node;
}

function liveFixture(doc = makeDoc()) {
  const scope = el(doc, "div", "cm-editor");
  const scroller = el(doc, "div", "cm-scroller");
  const sizer = el(doc, "div", "cm-sizer");
  const title = el(doc, "div", "inline-title", "Note");
  const container = el(doc, "div", "metadata-container");
  const input = el(doc, "input", "metadata-input");
  const contentWrap = el(doc, "div", "cm-contentContainer");
  const content = el(doc, "div", "cm-content");
  container.appendChild(el(doc, "div", "metadata-property", input));
  contentWrap.appendChild(content);
  sizer.appendChild(title);
  sizer.appendChild(container);
  sizer.appendChild(contentWrap);
  scroller.appendChild(sizer);
  scope.appendChild(scroller);
  return { doc, scope, sizer, title, container, input, content };
}

function readingFixture(doc = makeDoc()) {
  const scope = el(doc, "div", "markdown-preview-view");
  const sizer = el(doc, "div", "markdown-preview-sizer");
  const header = el(doc, "div", "mod-header");
  const title = el(doc, "div", "inline-title", "Note");
  const container = el(doc, "div", "metadata-container");
  const input = el(doc, "input", "metadata-input");
  container.appendChild(el(doc, "div", "metadata-property", input));
  header.appendChild(title);
  header.appendChild(container);
  sizer.appendChild(header);
  scope.appendChild(sizer);
  return { doc, scope, sizer, header, title, container, input };
}

function fakeState({ path = "note.md", live = true, fields = new Map() } = {}) {
  return {
    field(field) {
      if (field === editorLivePreviewField) return live;
      if (field === editorInfoField) return { file: path === null ? null : { path } };
      return fields.has(field) ? fields.get(field) : undefined;
    },
  };
}

function tr(state, effects = []) {
  return { effects, state, startState: state };
}

function fakeView({ embed = false, live = true, path = "note.md", text } = {}) {
  const fx = liveFixture();
  if (embed) el(fx.doc, "div", "markdown-embed").appendChild(fx.scope);
  const field = H.propertyCardFrontmatterOwnershipExtension();
  const fields = new Map([[field, H.propertyCardFrontmatterFieldCreate()]]);
  const view = { dom: fx.scope, dispatched: [], live, path, focused: false, contentDOM: fx.content, fx };
  const stateFor = () => fakeState({ path: view.path, live: view.live, fields });
  view.state = stateFor();
  view.dispatch = (spec) => {
    view.dispatched.push(spec);
    const next = stateFor();
    fields.set(field, H.propertyCardFrontmatterFieldReduce(fields.get(field), tr(next, [].concat(spec.effects || []))));
    view.state = next;
    H.propertyCardFrontmatterSyncEditor(view);
  };
  view.reconfigure = () => {
    fields.set(field, H.propertyCardFrontmatterFieldReduce(fields.get(field), tr(stateFor())));
    view.state = stateFor();
    H.propertyCardFrontmatterSyncEditor(view);
  };
  view.owner = () => fields.get(field).owner;
  view.focus = () => { view.focused = true; fx.content.focused = true; };
  void text;
  return view;
}

function queue() {
  const jobs = [];
  const defer = (fn) => jobs.push(fn);
  defer.flush = () => { while (jobs.length) jobs.shift()(); };
  defer.size = () => jobs.length;
  return defer;
}

function owned(container) {
  return container.inert === true && container.getAttribute("aria-hidden") === "true" && container.getAttribute("inert") === "";
}

function native(container) {
  return container.inert === false && container.getAttribute("aria-hidden") == null && container.getAttribute("inert") == null;
}

test("Source toggle and path change drop the owner in the same transaction", () => {
  const effect = H.propertyCardFrontmatterEnsureEffect();
  const start = H.propertyCardFrontmatterFieldCreate();
  const ownedState = fakeState({ path: "a.md", live: true });
  const ownedValue = H.propertyCardFrontmatterFieldReduce(start, tr(ownedState, [effect.of({ own: { path: "a.md", generation: 3 } })]));
  assert.equal(ownedValue.owner.generation, 3);
  assert.deepEqual(H.propertyCardFrontmatterFieldAttributes(ownedValue), { class: OWNS });

  const source = H.propertyCardFrontmatterFieldReduce(ownedValue, tr(fakeState({ path: "a.md", live: false })));
  assert.equal(source.owner, null, "Source mode drops the owner in this transaction");
  assert.equal(H.propertyCardFrontmatterFieldAttributes(source), null);

  const again = H.propertyCardFrontmatterFieldReduce(start, tr(ownedState, [effect.of({ own: { path: "a.md", generation: 4 } })]));
  const moved = H.propertyCardFrontmatterFieldReduce(again, tr(fakeState({ path: "b.md", live: true })));
  assert.equal(moved.owner, null, "a file change drops the owner in this transaction");
});

test("the ownership coordinator registers its Live Preview StateField", () => {
  const plugin = new TestPlugin({ workspace: {} });
  const extension = H.propertyCardFrontmatterOwnershipExtension();

  H.propertyCardFrontmatterCoordinatorBind(plugin, "day");
  H.propertyCardFrontmatterCoordinatorBind(plugin, "record");

  assert.deepEqual(plugin.extensions, [extension], "all card adapters share one registered ownership field");
});

test("deferred editor ownership: async dispatch, idempotent path, generations, releaseAll", () => {
  const defer = queue();
  const view = fakeView();
  const handle = H.propertyCardOwnFrontmatterInEditor(view, { path: "note.md", defer });
  assert.equal(typeof handle, "function");
  assert.equal(view.dispatched.length, 0, "nothing dispatches synchronously");
  assert.ok(owned(view.fx.container), "inert lands immediately");
  assert.equal(H.propertyCardOwnFrontmatterInEditor(view, { path: "note.md", defer }), handle, "pending same path");
  defer.flush();
  assert.equal(view.dispatched.length, 1);
  assert.equal(view.owner().generation, handle.generation);
  assert.equal(H.propertyCardOwnFrontmatterInEditor(view, { path: "note.md", defer }), handle);
  defer.flush();
  assert.equal(view.dispatched.length, 1, "the same path dispatches once");

  view.path = "other.md";
  const next = H.propertyCardOwnFrontmatterInEditor(view, { path: "other.md", defer });
  assert.notEqual(next, handle);
  assert.ok(next.generation > handle.generation, "a new path gets a new generation");
  defer.flush();
  assert.equal(view.owner().generation, next.generation);
  const count = view.dispatched.length;
  handle();
  defer.flush();
  assert.equal(view.dispatched.length, count, "an old handle cannot release a newer owner");
  assert.equal(view.owner().generation, next.generation);
  assert.ok(owned(view.fx.container));

  view.live = false;
  view.reconfigure();
  assert.equal(view.owner(), null, "Source mode drops the field owner");
  assert.ok(native(view.fx.container), "Source restores the container in the same update");
  assert.equal(H.propertyCardOwnFrontmatterInEditor(view, { path: "other.md", defer }), null, "Source mode is denied");
  view.live = true;
  view.reconfigure();
  assert.equal(H.propertyCardOwnFrontmatterInEditor(view, { path: "other.md", defer }), next, "the same handle returns");
  defer.flush();
  assert.equal(view.owner().generation, next.generation, "a dropped owner is re-dispatched");
  assert.ok(owned(view.fx.container));

  next();
  next();
  assert.equal(defer.size(), 1, "release is deferred and idempotent");
  defer.flush();
  assert.equal(view.owner(), null);
  assert.ok(native(view.fx.container));

  const a = fakeView();
  const b = fakeView({ path: "b.md" });
  H.propertyCardOwnFrontmatterInEditor(a, { path: "note.md", defer });
  H.propertyCardOwnFrontmatterInEditor(b, { path: "b.md", defer });
  defer.flush();
  assert.ok(a.owner() && b.owner());
  H.propertyCardFrontmatterReleaseAll();
  defer.flush();
  assert.equal(a.owner(), null);
  assert.equal(b.owner(), null);
  assert.ok(native(a.fx.container));
  assert.ok(native(b.fx.container));
});

test("a replaced owner released before its effect lands never strands the old container", () => {
  const defer = queue();
  const view = fakeView();
  const first = H.propertyCardOwnFrontmatterInEditor(view, { path: "note.md", defer });
  defer.flush();
  assert.equal(view.owner().generation, first.generation);
  view.path = "other.md";
  const second = H.propertyCardOwnFrontmatterInEditor(view, { path: "other.md", defer });
  second();
  defer.flush();
  assert.equal(view.owner(), null);
  assert.ok(native(view.fx.container));
});

test("editor denial: embeds, popovers, mobile, missing views, missing fields", () => {
  const defer = queue();
  assert.equal(H.propertyCardOwnFrontmatterInEditor(fakeView({ embed: true }), { path: "note.md", defer }), null);
  assert.equal(H.propertyCardOwnFrontmatterInEditor(null, { path: "note.md", defer }), null);
  assert.equal(H.propertyCardOwnFrontmatterInEditor(fakeView(), { path: "", defer }), null);
  const bare = fakeView();
  bare.state = { ...bare.state, field: (field) => (field === editorLivePreviewField ? true : undefined) };
  assert.equal(H.propertyCardOwnFrontmatterInEditor(bare, { path: "note.md", defer }), null, "no kit field installed");
  assert.equal(defer.size(), 0);

  const doc = makeDoc();
  const canvas = el(doc, "div", "canvas-node");
  const scope = el(doc, "div", "cm-editor");
  canvas.appendChild(scope);
  assert.equal(H.propertyCardFrontmatterScopeDenied(scope), true);
  const print = el(doc, "div", "print", el(doc, "div", "markdown-preview-view"));
  assert.equal(H.propertyCardFrontmatterScopeDenied(print.children[0]), true);
  const popover = el(doc, "div", "hover-popover", el(doc, "div", "cm-editor"));
  assert.equal(H.propertyCardFrontmatterScopeDenied(popover.children[0]), true);
  assert.equal(H.propertyCardFrontmatterScopeDenied(el(doc, "div", "cm-editor")), false);

  Platform.isDesktopApp = false;
  try {
    assert.equal(H.propertyCardOwnFrontmatterInEditor(fakeView(), { path: "note.md", defer }), null, "mobile is denied");
    const fx = readingFixture();
    assert.equal(H.propertyCardOwnFrontmatterInReading(fx.scope, { path: "note.md" }), null, "mobile Reading is denied");
  } finally {
    Platform.isDesktopApp = true;
  }
});

test("Reading adds the class, inert, and a generation-bound observer", () => {
  const fx = readingFixture();
  const handle = H.propertyCardOwnFrontmatterInReading(fx.scope, { path: "note.md" });
  assert.equal(typeof handle, "function");
  assert.ok(fx.scope.classList.contains(OWNS));
  assert.ok(owned(fx.container));
  const observer = fx.doc.observers[0];
  assert.equal(observer.target, fx.scope);
  assert.deepEqual(observer.options, { childList: true, subtree: true });

  const replacement = el(fx.doc, "div", "metadata-container", el(fx.doc, "input", "metadata-input"));
  fx.header.removeChild(fx.container);
  fx.header.appendChild(replacement);
  observer.trigger();
  assert.ok(owned(replacement), "a re-rendered container is re-owned");
  assert.ok(native(fx.container), "the old container is cleared");

  handle();
  assert.ok(!fx.scope.classList.contains(OWNS));
  assert.ok(native(replacement));
  assert.equal(observer.connected, false, "release disconnects the observer");
});

test("Reading generations: an old handle never clears a newer owner", () => {
  const fx = readingFixture();
  const first = H.propertyCardOwnFrontmatterInReading(fx.scope, { path: "note.md" });
  const observer = fx.doc.observers[0];
  const second = H.propertyCardOwnFrontmatterInReading(fx.scope, { path: "note.md" });
  assert.ok(second.generation > first.generation);
  assert.equal(observer.connected, false, "a newer owner replaces the old observer");
  first();
  assert.ok(fx.scope.classList.contains(OWNS), "an old handle never clears a newer owner");
  assert.ok(owned(fx.container));
  H.propertyCardFrontmatterReleaseAll();
  assert.ok(!fx.scope.classList.contains(OWNS));
  assert.ok(native(fx.container));
  second();
  assert.ok(!fx.scope.classList.contains(OWNS));
});

test("Reading ignores embeds, editor scopes, and missing paths", () => {
  const recognizerPath = "x.md";
  const doc = makeDoc();
  const embed = el(doc, "div", "markdown-embed", el(doc, "div", "markdown-preview-view"));
  assert.equal(H.propertyCardOwnFrontmatterInReading(embed.children[0], { path: recognizerPath }), null);
  assert.equal(H.propertyCardOwnFrontmatterInReading(el(doc, "div", "cm-editor"), { path: recognizerPath }), null);
  const fx = readingFixture();
  assert.equal(H.propertyCardOwnFrontmatterInReading(fx.scope, { path: "" }), null);
});

test("focusin inside the hidden container returns focus to the editor", () => {
  const defer = queue();
  const view = fakeView();
  H.propertyCardOwnFrontmatterInEditor(view, { path: "note.md", defer });
  defer.flush();
  view.fx.scope.dispatch("focusin", { target: view.fx.input, preventDefault() {}, stopPropagation() {} });
  assert.equal(view.focused, true);
  assert.equal(view.fx.content.focused, true);

  const fx = readingFixture();
  H.propertyCardOwnFrontmatterInReading(fx.scope, { path: "note.md" });
  fx.scope.focused = false;
  fx.scope.dispatch("focusin", { target: fx.input, preventDefault() {}, stopPropagation() {} });
  assert.equal(fx.scope.focused, true, "Reading returns focus to the preview scope");
});

test("propertyCardOwnFrontmatter dispatches by scope", () => {
  const defer = queue();
  const view = fakeView();
  const handle = H.propertyCardOwnFrontmatter(view.dom, { path: "note.md", view, defer });
  assert.equal(typeof handle, "function");
  defer.flush();
  assert.equal(view.owner().generation, handle.generation);
  assert.equal(H.propertyCardOwnFrontmatter(view.dom, { path: "note.md" }), null, "an editor scope needs its view");
  const other = fakeView();
  assert.equal(H.propertyCardOwnFrontmatter(other.dom, { path: "note.md", view, defer }), null, "the view must own the scope");
  const fx = readingFixture();
  assert.equal(typeof H.propertyCardOwnFrontmatter(fx.scope, { path: "note.md" }), "function");
  assert.ok(fx.scope.classList.contains(OWNS));
  assert.equal(H.propertyCardOwnFrontmatter(makeDoc().createElement("div"), { path: "note.md" }), null);
  H.propertyCardFrontmatterReleaseAll();
  defer.flush();
});

test("source/cache evidence requires a closed duplicate-free matching mapping", () => {
  const parse = (yaml) => Object.fromEntries(String(yaml).split(/\r?\n/).filter(Boolean).map((line) => {
    const index = line.indexOf(":");
    return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
  }));
  const source = "---\ntype: album\nsummary: Reading\n---\n# Album\n";
  assert.equal(H.propertyCardFrontmatterCacheEvidence(source, { type: "album", summary: "Reading", position: { start: 0, end: 4 } }, parse), true);
  assert.equal(H.propertyCardFrontmatterCacheEvidence(source, { type: "album", summary: "stale" }, parse), false);
  assert.equal(H.propertyCardFrontmatterCacheEvidence("---\ntype: album\n", { type: "album" }, parse), false);
  assert.equal(H.propertyCardFrontmatterCacheEvidence("---\ntype: album\ntype: record\n---\n", { type: "record" }, parse), false);
  assert.equal(H.propertyCardFrontmatterCacheEvidence("# no frontmatter\n", {}, parse), false);
});

test("mounted card ownership is capability and source gated, then releases on cache invalidation", () => {
  const callbacks = new Map();
  const metadataCache = {
    getFileCache: () => ({ frontmatter: { type: "album", summary: "Reading" } }),
    on(name, callback) {
      const list = callbacks.get(name) || [];
      list.push(callback);
      callbacks.set(name, list);
      return { name, callback };
    },
  };
  const plugin = new TestPlugin({
    workspace: { getLeavesOfType: () => [], on: () => ({}) },
    vault: { getAbstractFileByPath: (path) => ({ path }), on: () => ({}) },
    metadataCache,
  });
  plugin.propertyCapabilityRoutingReady = () => true;
  plugin.propertyCapabilityCurrentBobKey = () => "bob:/usr/bin/bob";
  plugin.propertyCapabilityConfirmed = (key) => key === "bob:/usr/bin/bob";
  const fx = readingFixture();
  const mount = el(fx.doc, "section", "bob-album-header bob-property-card");
  mount.setAttribute("data-album-source", "note.md");
  mount.appendChild(el(fx.doc, "footer", "bob-property-card-foot"));
  fx.scope.appendChild(mount);
  const view = { file: { path: "note.md" }, getMode: () => "preview" };
  const sourceText = "---\ntype: album\nsummary: Reading\n---\n# Album\n";
  const parse = (yaml) => Object.fromEntries(String(yaml).split(/\r?\n/).filter(Boolean).map((line) => {
    const index = line.indexOf(":");
    return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
  }));
  H.propertyCardFrontmatterCoordinatorBind(plugin, "album");
  const release = H.propertyCardFrontmatterOwnMounted(plugin, {
    scope: fx.scope, view, path: "note.md", kind: "album", mount, sourceText,
    currentPath: () => view.file.path,
    active: () => true,
    parseYaml: parse,
  });
  assert.equal(typeof release, "function");
  assert.ok(fx.scope.classList.contains(OWNS));
  assert.ok(owned(fx.container));

  for (const callback of callbacks.get("changed") || []) callback({ path: "note.md" });
  assert.ok(!fx.scope.classList.contains(OWNS), "metadata invalidation releases ownership synchronously");
  assert.ok(native(fx.container));

  metadataCache.getFileCache = () => ({ frontmatter: { type: "album", summary: "stale" } });
  assert.equal(H.propertyCardFrontmatterOwnMounted(plugin, {
    scope: fx.scope, view, path: "note.md", kind: "album", mount, sourceText,
    currentPath: () => view.file.path,
    active: () => true,
    parseYaml: parse,
  }), null, "source/cache skew fails open");
  assert.ok(native(fx.container));
});

test("supported card kinds own independent panes; replacement, stale release, and unload are generation safe", () => {
  const frontmatterByPath = new Map();
  const callbacks = new Map();
  const metadataCache = {
    getFileCache: (file) => ({ frontmatter: frontmatterByPath.get(file?.path) || null }),
    on(name, callback) {
      const list = callbacks.get(name) || [];
      list.push(callback);
      callbacks.set(name, list);
      return { name, callback };
    },
  };
  const plugin = new TestPlugin({
    workspace: { getLeavesOfType: () => [], on: () => ({}) },
    vault: { getAbstractFileByPath: (path) => ({ path }), on: () => ({}) },
    metadataCache,
  });
  plugin.propertyCapabilityRoutingReady = () => true;
  plugin.propertyCapabilityCurrentBobKey = () => "bob:/usr/bin/bob";
  plugin.propertyCapabilityConfirmed = () => true;
  const parse = (yaml) => Object.fromEntries(String(yaml).split(/\r?\n/).filter(Boolean).map((line) => {
    const index = line.indexOf(":");
    return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
  }));
  const mountFor = (doc, scope, kind, path) => {
    const cls = kind === "album" ? "bob-album-header" : kind === "record" ? "bob-record-sheet" : "bob-intention-card";
    const attr = kind === "album" ? "data-album-source" : kind === "record" ? "data-record-source" : "data-intention-source";
    const mount = el(doc, "section", `${cls} bob-property-card`);
    mount.setAttribute(attr, path);
    mount.appendChild(el(doc, "footer", "bob-property-card-foot"));
    scope.appendChild(mount);
    return mount;
  };
  const acquire = (scope, view, mount, kind, path, sourceText) => H.propertyCardFrontmatterOwnMounted(plugin, {
    scope, view, mount, kind, path, sourceText,
    currentPath: () => view.file.path,
    active: () => true,
    parseYaml: parse,
  });
  const records = [];
  for (const kind of ["album", "record", "day", "week", "quarter", "year"]) {
    const path = `${kind}.md`;
    const sourceText = `---\ntype: ${kind}\n---\n`;
    frontmatterByPath.set(path, { type: kind });
    const fx = readingFixture();
    const view = { file: { path }, getMode: () => "preview" };
    const mount = mountFor(fx.doc, fx.scope, kind, path);
    const release = acquire(fx.scope, view, mount, kind, path, sourceText);
    assert.equal(typeof release, "function", `${kind} can own after its card and foot mount`);
    assert.ok(fx.scope.classList.contains(OWNS));
    records.push({ fx, view, mount, release, kind, path, sourceText });
  }

  const panes = [readingFixture(), readingFixture()];
  const path = "same.md";
  const sourceText = "---\ntype: album\n---\n";
  frontmatterByPath.set(path, { type: "album" });
  const paneReleases = panes.map((fx) => {
    const view = { file: { path }, getMode: () => "preview" };
    return acquire(fx.scope, view, mountFor(fx.doc, fx.scope, "album", path), "album", path, sourceText);
  });
  assert.ok(paneReleases.every((release) => typeof release === "function"), "two panes of one note are independent owners");
  paneReleases[0]();
  assert.ok(!panes[0].scope.classList.contains(OWNS));
  assert.ok(panes[1].scope.classList.contains(OWNS));

  const first = records.find((record) => record.kind === "day");
  const oldRelease = first.release;
  first.fx.scope.removeChild(first.mount);
  const replacement = mountFor(first.fx.doc, first.fx.scope, "day", first.path);
  const newRelease = acquire(first.fx.scope, first.view, replacement, "day", first.path, first.sourceText);
  assert.equal(typeof newRelease, "function", "a replacement mount reacquires under a new generation");
  oldRelease();
  assert.ok(first.fx.scope.classList.contains(OWNS), "an old release cannot clear the replacement owner");
  H.propertyCardFrontmatterCoordinatorReconcile(plugin);
  assert.ok(first.fx.scope.classList.contains(OWNS));

  for (const kind of ["album", "record", "day", "week", "quarter", "year"]) {
    H.propertyCardFrontmatterCoordinatorReleaseKind(plugin, kind);
  }
  for (const record of records) {
    assert.ok(!record.fx.scope.classList.contains(OWNS), `${record.kind} unload releases its scopes`);
    assert.ok(native(record.fx.container));
  }
  assert.ok(!panes[1].scope.classList.contains(OWNS));
});

test("host register installs the field once; teardown releaseAll is exported", () => {
  const plugin = new TestPlugin({ workspace: { getLeavesOfType: () => [], on: () => ({}) } });
  const field = H.propertyCardFrontmatterOwnershipExtension();
  assert.equal(H.propertyCardHostRegisterFrontmatterOwnership(plugin), true);
  assert.equal(H.propertyCardHostRegisterFrontmatterOwnership(plugin), false);
  assert.equal(plugin.extensions.filter((item) => item === field).length, 1);
  assert.equal(plugin._propertyCardFrontmatterOwnershipRegistered, true);
  assert.equal(typeof H.propertyCardFrontmatterReleaseAll, "function");
});

test("kit CSS sets Obsidian visibility variables and a direct-child fallback", () => {
  const css = fs.readFileSync(path.join(__dirname, "../plugins/bob-ledger-tools/styles.css"), "utf8");
  assert.match(css, /\.cm-editor\.bob-property-card-owns-frontmatter,\s*\n\.markdown-preview-view\.bob-property-card-owns-frontmatter \{/);
  assert.match(css, /--metadata-display-editing:\s*none;/);
  assert.match(css, /--metadata-display-reading:\s*none;/);
  const hide = css.split("\n").filter((line) => line.includes(".bob-property-card-owns-frontmatter") && line.includes(".metadata-container"));
  assert.deepEqual(hide.map((line) => line.replace(/\s*[,{]\s*$/, "")), [
    ".cm-editor.bob-property-card-owns-frontmatter > .cm-scroller > .cm-sizer > .metadata-container",
    ".markdown-preview-view.bob-property-card-owns-frontmatter > .markdown-preview-sizer > .mod-header > .metadata-container",
  ]);
  assert.equal(/\n\.metadata-container\s*\{[^}]*display:\s*none/.test(css), false, "no global metadata-container hide");
});
