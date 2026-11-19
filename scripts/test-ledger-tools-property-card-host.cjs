// Shared property-card host: one lifecycle for album, record, and bank.
// Covers setup idempotence, two panes, stale bindings, late attachment,
// teardown, failed-mount rollback, coalesced refresh, embed eligibility,
// and editorAttributes restoration.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin {
  constructor(app) { this.app = app; }
  registerEditorExtension(extension) { (this.extensions ||= []).push(extension); }
  registerMarkdownPostProcessor(handler, order) { (this.postProcessors ||= []).push({ handler, order }); }
  registerEvent(ref) { (this.events ||= []).push(ref); return ref; }
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

class FakeNode {
  constructor(tag, doc) {
    this.tagName = tag ? tag.toUpperCase() : "#TEXT";
    this.nodeType = 1;
    this.ownerDocument = doc;
    this.parentNode = null;
    this.children = [];
    this.attrs = new Map();
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
      return Boolean(cls && this.classList.contains(cls[1]));
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

function makeDoc() {
  return {
    createElement(tag) { return new FakeNode(tag, this); },
    createTextNode() { return new FakeNode("", this); },
  };
}

function preview(doc, cls = "markdown-preview-view") {
  const root = doc.createElement("div");
  root.setAttribute("class", cls);
  return root;
}

function fakePlugin() {
  const timers = new Map();
  let next = 0;
  const plugin = new LedgerToolsPlugin({
    workspace: { getLeavesOfType: () => [], on: () => ({}) },
    metadataCache: {},
    vault: {},
  });
  plugin.albumSetTimeout = (fn, ms) => { const id = ++next; timers.set(id, { fn, ms }); return id; };
  plugin.albumClearTimeout = (id) => { timers.delete(id); };
  plugin.flush = () => {
    const rows = [...timers.values()];
    timers.clear();
    for (const row of rows) row.fn();
  };
  plugin.pendingTimers = timers;
  return plugin;
}

function makeHost(plugin, extra = {}) {
  const painted = [];
  const removed = [];
  const host = helpers.createPropertyCardHost({
    plugin,
    kind: extra.kind || "probe",
    readingPriority: extra.readingPriority || 41,
    allowEmbedDisplay: extra.allowEmbedDisplay === true,
    fields: {
      active: "probeActive",
      reading: "probeReading",
      readingPending: "probePending",
      readingTimers: "probeTimers",
      editors: "probeEditors",
      editorScopes: "probeScopes",
      refreshTimer: "probeRefreshTimer",
      keySlots: "probeKeySlots",
    },
    setTimeout: (fn, ms) => plugin.albumSetTimeout(fn, ms),
    clearTimeout: (id) => plugin.albumClearTimeout(id),
    acceptReading: (el, ctx) => Boolean(el && ctx?.sourcePath),
    paintReading: (el, path) => { painted.push({ el, path }); el.setAttribute("data-painted", path); },
    removeReading: (root, scope, path) => { removed.push({ root, scope, path }); root?.removeAttribute?.("data-painted"); },
    livePath: (view) => view?.path || null,
    buildDecorations: (view) => [{ path: view?.path || "" }],
    editorAttributes: (view) => (plugin.probeScopes?.get(view) ? { class: "bob-probe-surface" } : {}),
    cleanEditor: (view) => host.cleanEditor(view, {
      unmark: (scope) => scope?.classList?.remove?.("bob-probe-surface"),
    }),
    ...extra,
  });
  host.painted = painted;
  host.removed = removed;
  return host;
}

test("host helpers are exported beside ownership", () => {
  assert.equal(typeof helpers.createPropertyCardHost, "function");
  assert.equal(helpers.PROPERTY_CARD_HOST_REFRESH_MS, 100);
  assert.equal(typeof helpers.propertyCardReadingRoot, "function");
  assert.equal(typeof helpers.propertyCardReadingScope, "function");
  assert.equal(typeof helpers.propertyCardNodeBelongs, "function");
});

test("setup registers once and a second setup does not duplicate processors", () => {
  const plugin = fakePlugin();
  const host = makeHost(plugin);
  host.setup();
  host.setup();
  assert.equal(plugin.postProcessors.length, 1);
  assert.equal(plugin.postProcessors[0].order, 41);
  assert.equal(plugin.extensions.length, 1);
  assert.equal(plugin.probeActive, true);
});

test("two panes of the same path both paint, and a stale unload keeps the live one", () => {
  const plugin = fakePlugin();
  const host = makeHost(plugin, { allowEmbedDisplay: true });
  host.setup();
  const doc = makeDoc();
  const first = preview(doc);
  const second = preview(doc);
  const children = [];
  host.renderInReading(first, { sourcePath: "eat.md", addChild: (child) => children.push(child) });
  host.renderInReading(second, { sourcePath: "eat.md", addChild: (child) => children.push(child) });
  plugin.flush();
  assert.equal(host.painted.length, 2);
  assert.equal(first.getAttribute("data-painted"), "eat.md");
  assert.equal(second.getAttribute("data-painted"), "eat.md");
  children[0].onunload();
  assert.equal(second.getAttribute("data-painted"), "eat.md");
  assert.equal(plugin.probeReading.size, 1);
});

test("detached then attached roots paint on refresh and teardown cancels pending batches", () => {
  const plugin = fakePlugin();
  const host = makeHost(plugin, { allowEmbedDisplay: true });
  host.setup();
  const doc = makeDoc();
  const chunk = doc.createElement("div");
  host.renderInReading(chunk, { sourcePath: "eat.md", addChild() {} });
  plugin.flush();
  assert.equal(host.painted.length, 0);
  const root = preview(doc);
  root.appendChild(chunk);
  host.scheduleRefresh();
  assert.equal([...plugin.pendingTimers.values()].some((row) => row.ms === 100), true);
  plugin.flush();
  assert.equal(host.painted.some((row) => row.el === chunk), true);
  host.renderInReading(preview(doc), { sourcePath: "eat.md", addChild() {} });
  host.dispose();
  assert.equal(plugin.pendingTimers.size, 0);
  assert.equal(plugin.probeActive, false);
  assert.equal(plugin.probePending.size, 0);
});

test("a new host defaults to excluding embeds, while adapters may opt in", () => {
  const deniedPlugin = fakePlugin();
  const denied = makeHost(deniedPlugin);
  denied.setup();
  const doc = makeDoc();
  const parent = preview(doc);
  const embed = preview(doc, "markdown-embed");
  parent.appendChild(embed);
  denied.renderInReading(embed, { sourcePath: "eat.md", addChild() {} });
  deniedPlugin.flush();
  assert.equal(denied.painted.length, 0);

  const optedPlugin = fakePlugin();
  const opted = makeHost(optedPlugin, { allowEmbedDisplay: true });
  opted.setup();
  opted.renderInReading(embed, { sourcePath: "eat.md", addChild() {} });
  optedPlugin.flush();
  assert.equal(opted.painted.length, 1);
});

test("failed mounts roll back through commitMount and editorAttributes restore owned classes", () => {
  const plugin = fakePlugin();
  const owned = [];
  const released = [];
  const host = makeHost(plugin, {
    ownKeys: (scope, path) => owned.push({ scope, path }),
    releaseKeys: (scope, path) => released.push({ scope, path }),
  });
  host.setup();
  const doc = makeDoc();
  const scope = preview(doc);
  host.commitMount(scope, "eat.md", false);
  assert.equal(released.length, 1);
  host.commitMount(scope, "eat.md", true);
  assert.equal(owned.length, 1);
  const view = { path: "eat.md", dom: scope };
  host.setEditorScope(view, true, {
    mark: (node) => node.classList.add("bob-probe-surface"),
    unmark: (node) => node.classList.remove("bob-probe-surface"),
  });
  const extension = host.createExtension();
  const attributes = extension.options.provide();
  assert.equal(attributes(view).class, "bob-probe-surface");
  host.cleanEditor(view, { unmark: (node) => node.classList.remove("bob-probe-surface") });
  assert.deepEqual(attributes(view), {});
});

test("album, record, and bank keep their Reading priorities and existing method names", () => {
  const plugin = fakePlugin();
  plugin.setupAlbumHeader();
  plugin.setupRecordSheet();
  plugin.setupBankSetup();
  const orders = plugin.postProcessors.map((row) => row.order);
  assert.deepEqual(orders, [49, 49, 47]);
  assert.equal(plugin.extensions.length, 3);
  plugin.setupAlbumHeader();
  plugin.setupRecordSheet();
  plugin.setupBankSetup();
  assert.equal(plugin.postProcessors.length, 3, "repeat setup must not re-register");
  assert.equal(typeof plugin.renderAlbumHeaderInReading, "function");
  assert.equal(typeof plugin.renderRecordSheetInReading, "function");
  assert.equal(typeof plugin.renderBankSetupInReading, "function");
  assert.equal(typeof plugin.createAlbumHeaderExtension, "function");
  assert.equal(typeof plugin.createRecordSheetExtension, "function");
  assert.equal(typeof plugin.createBankSetupExtension, "function");
  plugin.teardownAlbumHeader();
  plugin.teardownRecordSheet();
  plugin.teardownBankSetup();
  assert.equal(plugin.albumHeaderActive, false);
  assert.equal(plugin.recordSheetActive, false);
  assert.equal(plugin.bankSetupActive, false);
});

test("workspace events refresh by default, and an adapter handler replaces that refresh", () => {
  const listen = (plugin) => {
    const handlers = new Map();
    plugin.app.workspace.on = (name, fn) => { handlers.set(name, fn); return { name }; };
    return handlers;
  };
  const refreshQueued = (plugin) => [...plugin.pendingTimers.values()].some((row) => row.ms === 100);

  const plain = fakePlugin();
  const plainEvents = listen(plain);
  makeHost(plain, { workspaceEvents: ["file-open"] }).setup();
  plainEvents.get("file-open")();
  assert.equal(refreshQueued(plain), true, "no handler: the event schedules the coalesced refresh");

  const handled = fakePlugin();
  const handledEvents = listen(handled);
  const seen = [];
  const host = makeHost(handled, {
    workspaceEvents: ["layout-change", "file-open"],
    onWorkspaceEvent: (name, controller) => seen.push({ name, controller }),
  });
  host.setup();
  handledEvents.get("layout-change")();
  handledEvents.get("file-open")();
  assert.deepEqual(seen.map((row) => row.name), ["layout-change", "file-open"]);
  assert.equal(seen[0].controller, host);
  assert.equal(refreshQueued(handled), false, "the handler replaces the refresh");
  host.dispose();
  handledEvents.get("file-open")();
  assert.equal(seen.length, 2, "a disposed host ignores late workspace events");
});

test("record file-open and layout-change schedule only its Reading-view mount", () => {
  const plugin = fakePlugin();
  const handlers = new Map();
  plugin.app.workspace.on = (name, fn) => { handlers.set(name, fn); return { name }; };
  let mounts = 0;
  plugin.scheduleRecordSheetReadingViewMount = () => { mounts += 1; };
  plugin.setupRecordSheet();
  // Setup's own subscription may already have queued a refresh; drop it so
  // only the workspace events below are measured.
  plugin.pendingTimers.clear();
  plugin.recordSheetRefreshTimer = null;
  handlers.get("file-open")();
  handlers.get("layout-change")();
  assert.equal(mounts, 2);
  assert.equal(plugin.recordSheetRefreshTimer == null, true, "no full record refresh on file-open");
  assert.equal(plugin.pendingTimers.size, 0);
  plugin.teardownRecordSheet();
});

test("album and bank skip editorAttributes and workspace events; record keeps both", () => {
  const plugin = fakePlugin();
  plugin.setupAlbumHeader();
  plugin.setupRecordSheet();
  plugin.setupBankSetup();
  const album = plugin.createAlbumHeaderExtension();
  const record = plugin.createRecordSheetExtension();
  const bank = plugin.createBankSetupExtension();
  assert.equal(album.options.provide, undefined);
  assert.equal(typeof record.options.provide, "function");
  assert.equal(bank.options.provide, undefined);
  assert.equal((plugin.events || []).length, 2, "only record listens for layout-change/file-open");
});

test("a host without editorAttributes does not install the facet", () => {
  const plugin = fakePlugin();
  const host = helpers.createPropertyCardHost({
    plugin,
    kind: "bare",
    readingPriority: 41,
    fields: {
      active: "bareActive",
      reading: "bareReading",
      readingPending: "barePending",
      readingTimers: "bareTimers",
      editors: "bareEditors",
      editorScopes: "bareScopes",
      refreshTimer: "bareRefreshTimer",
    },
    setTimeout: (fn, ms) => plugin.albumSetTimeout(fn, ms),
    clearTimeout: (id) => plugin.albumClearTimeout(id),
    buildDecorations: () => [],
  });
  host.setup();
  const extension = host.createExtension();
  assert.equal(extension.options.provide, undefined);
});

test("record Source-mode lint stays on the bank adapter, not behind an LP return", () => {
  const plugin = fakePlugin();
  plugin.setupBankSetup();
  const extension = plugin.createBankSetupExtension();
  const view = {
    path: "bank.md",
    state: { doc: { toString: () => "---\nbank: {}\n---\n", lines: 3, line: () => ({ from: 0, to: 0 }) } },
    dom: { closest: () => null },
  };
  plugin.bankSetupLivePath = () => null;
  plugin.bankSetupSourcePath = () => "bank.md";
  plugin.bankSetupLintState = () => ({ path: "bank.md", marks: [] });
  const decorations = plugin.buildBankSetupDecorations(view);
  assert.ok(decorations);
  assert.equal(typeof extension.cls, "function");
});
