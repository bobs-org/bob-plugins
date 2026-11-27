// Album, temporal, and bank setup shared-foot adapters (bob-cli-pf adapters).
// Identity-only and collapsed cards keep the foot; fence/category helpers do
// not. Native Properties still hide only record (album) and bank (hub).
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
const StateEffect = { define: () => { const type = { of(value) { return { type, value, is: (other) => other === type }; } }; return type; } };
const StateField = { define: (spec) => ({ stateField: true, spec }) };
class WidgetType {}
class RangeSetBuilder { constructor() { this.rows = []; } add(from, to, deco) { this.rows.push({ from, to, deco }); } finish() { return this.rows; } }
const Decoration = {
  none: [],
  widget: (options) => ({ ...options, startSide: options.side }),
  replace: (options) => ({ ...options, startSide: 0, replace: true, spec: options, range(from, to) { return { from, to, value: this }; } }),
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
    Notice: TestNotice, Plugin: TestPlugin, Platform: { isDesktopApp: true },
    normalizePath: (value) => value, editorInfoField, editorLivePreviewField,
    parseYaml: () => ({}),
  };
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value }, StateEffect, StateField, RangeSetBuilder };
  if (request === "@codemirror/view") return {
    Decoration, WidgetType, ViewPlugin: { fromClass: (cls, options) => ({ cls, options }) },
    EditorView,
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
  get className() { return this.getAttribute("class") || ""; }
  set className(value) { this.setAttribute("class", value); }
  get textContent() { return this.nodeType === 3 ? this._text : this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { this._text = String(value); if (this.nodeType === 1) this.children = [new FakeNode("", this.ownerDocument, this._text)]; }
  get childNodes() { return this.children; }
  get firstChild() { return this.children[0] || null; }
  get isConnected() { let item = this; while (item) { if (item.root) return true; item = item.parentNode; } return false; }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  hasAttribute(name) { return this.attrs.has(name); }
  removeAttribute(name) { this.attrs.delete(name); }
  appendChild(node) { return this.insertBefore(node, null); }
  insertBefore(node, before) {
    node.parentNode?.removeChild?.(node);
    node.parentNode = this;
    const i = before ? this.children.indexOf(before) : -1;
    this.children.splice(i < 0 ? this.children.length : i, 0, node);
    return node;
  }
  removeChild(node) { const i = this.children.indexOf(node); if (i >= 0) this.children.splice(i, 1); node.parentNode = null; return node; }
  remove() { this.parentNode?.removeChild?.(this); }
  addEventListener(type, fn) { const rows = this.listeners.get(type) || []; rows.push(fn); this.listeners.set(type, rows); }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  matches(selector) {
    return String(selector).split(",").some((part) => {
      const value = part.trim();
      const cls = /^\.([\w-]+)$/.exec(value);
      const tag = /^[a-z][\w-]*$/i.exec(value);
      const tagClass = /^([a-z][\w-]*)\.([\w-]+)$/i.exec(value);
      const attr = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(value);
      const taggedAttr = /^([a-z][\w-]*)\[([\w-]+)(?:="([^"]*)")?\]$/i.exec(value);
      const hasAttr = (name, expected) => this.attrs.has(name) && (expected === undefined || this.getAttribute(name) === expected);
      return Boolean((tagClass && this.tagName === tagClass[1].toUpperCase() && this.classList.contains(tagClass[2]))
        || (cls && this.classList.contains(cls[1]))
        || (tag && this.tagName === tag[0].toUpperCase())
        || (attr && hasAttr(attr[1], attr[2]))
        || (taggedAttr && this.tagName === taggedAttr[1].toUpperCase() && hasAttr(taggedAttr[2], taggedAttr[3])));
    });
  }
  closest(selector) { let node = this; while (node) { if (node.nodeType === 1 && node.matches(selector)) return node; node = node.parentNode; } return null; }
  querySelectorAll(selector) { const found = []; const walk = (node) => { for (const child of node.children || []) { if (child.matches(selector)) found.push(child); walk(child); } }; walk(this); return found; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function makeDoc() {
  const doc = {
    activeElement: null,
    createElement(tag) { return new FakeNode(tag, this); },
    createTextNode(text) { return new FakeNode("", this, String(text)); },
  };
  doc.body = doc.createElement("body");
  doc.body.root = true;
  return doc;
}

function node(doc, tag, cls = "", text = "") {
  const item = doc.createElement(tag);
  if (cls) item.setAttribute("class", cls);
  if (text) item.appendChild(doc.createTextNode(text));
  return item;
}

const FOOT = ".bob-property-card-foot";
const OWNED = helpers.PROPERTY_CARD_OWNED_PROPERTY_CLASS;
const album = (overrides = {}) => ({
  path: "eat.md", stem: "eat", title: "Restaurants", noun: "restaurant",
  parent: "body", parent_kind: "area", owner: "body", root: "body",
  breadcrumb: ["This is only a display string"], fields: [{ key: "status", label: "Status", kind: "text" }],
  issues: [], index: { state: "current" }, ...overrides,
});
function report(entry = album()) {
  return helpers.albumIndexReport({ schema_version: 1, ok: true, albums: [entry], catalogs: [], counts: {} });
}

function albumPlugin(options = {}) {
  const doc = makeDoc();
  const files = new Map(["eat.md", "body.md"].map((path) => [path, { path }]));
  const caches = new Map([
    ["eat.md", { frontmatter: { type: "[[album]]", ...(options.frontmatter || {}) }, headings: [{ level: 1, heading: "Restaurants" }] }],
    ["body.md", { frontmatter: { type: "[[area]]", root_parent: true }, headings: [{ level: 1, heading: "Body" }] }],
  ]);
  const writes = [];
  const app = {
    vault: {
      getAbstractFileByPath: (path) => files.get(path) || null,
      modify: async (...args) => { writes.push(args); },
    },
    metadataCache: {
      getFirstLinkpathDest: (target) => files.get(`${String(target).replace(/\.md$/i, "")}.md`) || null,
      getFileCache: (file) => caches.get(file?.path) || null,
      on: () => ({}),
    },
  };
  const plugin = new LedgerToolsPlugin(app);
  plugin.albumReportState = () => (options.report === undefined
    ? { report: report(options.entry || album()), stale: false }
    : options.report);
  plugin.albumHeaderActive = true;
  plugin.albumHeaderReading = new Set();
  plugin.albumHeaderEditors = new Set();
  plugin._spawns = 0;
  plugin.spawnBob = async () => { plugin._spawns += 1; throw new Error("unexpected spawn"); };
  if (options.source) plugin.albumHeaderRememberSource("eat.md", options.source);
  return { app, caches, doc, files, plugin, writes };
}

// The cabinet stack is last unless a floor rail exists, in which case the
// stack sits immediately above that floor. The stack still ends in Properties.
function footLast(card) {
  const kids = card.children.filter((child) => child.nodeType === 1);
  const last = kids.at(-1);
  const floor = last?.getAttribute?.("data-card-floor") === "link-walk";
  const stack = floor ? kids.at(-2) : last;
  if ((stack?.getAttribute("class") || "").split(/\s+/)[0] !== "bob-property-card-cabinets") return false;
  const fronts = stack.children.filter((child) => child.nodeType === 1);
  const foot = fronts.at(-1);
  return (foot?.getAttribute("class") || "").split(/\s+/)[0] === "bob-property-card-foot"
    && foot.getAttribute("data-cabinet-kind") === "properties";
}

function readingProperties(doc, keys) {
  const preview = node(doc, "div", "markdown-preview-view");
  const sizer = node(doc, "div", "markdown-preview-sizer");
  const header = node(doc, "div", "mod-header");
  const properties = node(doc, "div", "metadata-container");
  for (const key of keys) {
    const row = node(doc, "div", "metadata-property");
    row.setAttribute("data-property-key", key);
    properties.appendChild(row);
  }
  header.appendChild(properties);
  sizer.appendChild(header);
  sizer.appendChild(node(doc, "h1", "", "Title"));
  preview.appendChild(sizer);
  return { preview, properties };
}

function yaml(rows) {
  return ["---", ...rows, "---", "body"].join("\n");
}

test("album identity-only cards still carry the foot with a faint missing stamp", () => {
  helpers.propertyCardFootResetAll();
  const { plugin, doc } = albumPlugin({
    report: { report: null, stale: false },
    source: yaml(["type: \"[[album]]\"", "parent: \"[[body]]\"", "title: Restaurants"]),
  });
  const card = plugin.albumHeaderCardModelFor("eat.md");
  assert.equal(card.body, null);
  const header = plugin.albumHeaderBuildEl(card, plugin.albumHeaderOptions("eat.md", plugin.albumReportState(), null), doc);
  assert.ok(header.querySelector(FOOT), "identity-only album keeps the foot");
  assert.equal(footLast(header), true);
  assert.match(header.querySelector(".bob-property-card-foot-stamp").textContent, /no created date/);
  assert.equal(plugin._spawns, 0);
  helpers.propertyCardFootResetAll();
});

test("album report cards mark record→schema, keep the foot last, and hide only record", () => {
  helpers.propertyCardFootResetAll();
  const source = yaml([
    "type: \"[[album]]\"", "parent: \"[[body]]\"", "emoji: \"🍽️\"", "summary: Places",
    "record:", "  fields: []", "created: 2026-06-11",
  ]);
  const { plugin, doc } = albumPlugin({
    source,
    frontmatter: { parent: "[[body]]", emoji: "🍽️", summary: "Places", created: "2026-06-11" },
  });
  const { preview, properties } = readingProperties(doc, ["record", "title", "aliases"]);
  plugin.paintAlbumHeaderReading(preview, "eat.md");
  const header = preview.querySelector(".bob-album-header");
  assert.ok(header.querySelector(FOOT));
  assert.equal(footLast(header), true);
  const spec = plugin.albumHeaderFootSpec("eat.md", plugin.albumHeaderCardModelFor("eat.md"));
  assert.equal(spec.inventory.rows.find((row) => row.key === "type")?.mark, "tile");
  assert.equal(spec.inventory.rows.find((row) => row.key === "parent")?.mark, "kicker");
  assert.equal(spec.inventory.rows.find((row) => row.key === "emoji")?.mark, "tile");
  assert.equal(spec.inventory.rows.find((row) => row.key === "summary")?.mark, "subtitle");
  assert.equal(spec.inventory.rows.find((row) => row.key === "record")?.mark, "schema");
  assert.equal(spec.inventory.rows.find((row) => row.key === "record")?.nested, "schema");
  assert.equal(spec.inventory.rows.find((row) => row.key === "created")?.mark, "foot");
  assert.equal(properties.querySelector('[data-property-key="record"]').classList.contains(OWNED), true);
  assert.equal(properties.querySelector('[data-property-key="title"]').classList.contains(OWNED), false);
  assert.equal(properties.querySelector('[data-property-key="aliases"]').classList.contains(OWNED), false);
  plugin.albumHeaderDesktop = () => false;
  const mobile = plugin.albumHeaderFootSpec("eat.md", plugin.albumHeaderCardModelFor("eat.md"));
  assert.equal(mobile.inventory.rows.find((row) => row.key === "record")?.nested, null);
  assert.equal(plugin._spawns, 0);
  helpers.propertyCardFootResetAll();
});

test("album adapter unbind releases its path and leaves other notes open", () => {
  helpers.propertyCardFootResetAll();
  const { plugin, doc } = albumPlugin({
    source: yaml(["type: \"[[album]]\"", "title: Restaurants"]),
  });
  const card = plugin.albumHeaderCardModelFor("eat.md");
  const header = plugin.albumHeaderBuildEl(card, plugin.albumHeaderOptions("eat.md", plugin.albumReportState(), card.body), doc);
  const scope = node(doc, "div", "markdown-preview-view");
  scope.appendChild(header);
  plugin.albumHeaderFootBind();
  plugin.albumHeaderTrackFoot(scope, "eat.md", header);
  helpers.propertyCardFootSetOpen("eat.md", true);
  helpers.propertyCardFootSetOpen("other.md", true);
  plugin.albumHeaderFootUnbind();
  assert.equal(helpers.propertyCardFootIsOpen("eat.md"), false);
  assert.equal(helpers.propertyCardFootIsOpen("other.md"), true, "unbind does not reset-all");
  helpers.propertyCardFootResetAll();
});

test("a closing album pane preserves its peer foot and can reopen the same note", () => {
  helpers.propertyCardFootResetAll();
  const doc = makeDoc();
  const path = "eat.md";
  const tracked = new Set();
  const mount = (scope) => {
    const card = node(doc, "section", "bob-album-header");
    card.appendChild(node(doc, "footer", "bob-property-card-foot"));
    scope.appendChild(card);
    return card;
  };
  const firstPane = node(doc, "div", "markdown-preview-view");
  const peerPane = node(doc, "div", "markdown-preview-view");
  doc.body.appendChild(firstPane);
  doc.body.appendChild(peerPane);
  const firstCard = mount(firstPane);
  const peerCard = mount(peerPane);
  const track = (scope, card) => helpers.propertyCardFootAdapterTrack(scope, path, card, tracked);
  track(firstPane, firstCard);
  track(peerPane, peerCard);
  assert.equal(helpers.propertyCardFootLiveMountsFor(path).length, 2);

  firstCard.remove();
  firstPane.remove();
  track(firstPane, null);
  const peerView = { dom: peerPane, file: { path } };
  assert.equal(helpers.propertyCardFootMountsFor(path).length, 1, "closing prunes only the detached pane mount");
  assert.equal(helpers.propertyCardCanToggleProperties(peerView), true, "the other pane remains actionable");
  assert.equal(helpers.propertyCardToggleProperties(peerView), true);
  assert.equal(helpers.propertyCardFootIsOpen(path), true);

  const reopenedPane = node(doc, "div", "markdown-preview-view");
  doc.body.appendChild(reopenedPane);
  const reopenedCard = mount(reopenedPane);
  track(reopenedPane, reopenedCard);
  const reopenedView = { dom: reopenedPane, file: { path } };
  assert.equal(helpers.propertyCardFootLiveMountsFor(path).length, 2, "reopening registers one fresh foot beside the live peer");
  assert.equal(helpers.propertyCardCanToggleProperties(peerView), true);
  assert.equal(helpers.propertyCardCanToggleProperties(reopenedView), true);
  assert.equal(helpers.propertyCardToggleProperties(reopenedView), true);
  assert.equal(helpers.propertyCardFootIsOpen(path), false, "both panes share the note's disclosure state");
  helpers.propertyCardFootResetAll();
});

test("album EnsureSource stays quiet without vault.read", () => {
  const { plugin } = albumPlugin();
  assert.equal(helpers.propertyCardFootAdapterCanRead(plugin), false);
  assert.equal(plugin.albumHeaderEnsureSource("eat.md"), null);
});

test("day/week/quarter/year identity-only cards still carry a quiet foot", () => {
  helpers.propertyCardFootResetAll();
  const plugin = new LedgerToolsPlugin({
    vault: { getAbstractFileByPath: () => null },
    metadataCache: { getFileCache: () => null, on: () => ({}) },
  });
  plugin.intentionCardToday = () => "2026-11-20";
  plugin._spawns = 0;
  plugin.spawnBob = async () => { plugin._spawns += 1; throw new Error("unexpected spawn"); };
  const doc = makeDoc();
  const today = "2026-11-20";
  const notes = [
    ["2026/20261120.md", "day"],
    ["2026/2026-W47.md", "week"],
    ["2026/2026-Q4.md", "quarter"],
    ["2026.md", "year"],
  ];
  for (const [path, kind] of notes) {
    const model = helpers.intentionCardModelFor(path, { type: `[[${kind}]]` }, today);
    assert.equal(model.hasContent, false, `${kind} identity-only`);
    const card = helpers.intentionCardBuildDom(model, plugin, doc);
    assert.ok(card.querySelector(FOOT), `${kind} identity-only keeps the foot`);
    assert.equal(footLast(card), true);
    assert.equal(card.querySelector(".bob-property-card-foot-stamp"), null, `${kind} missing created stays quiet`);
  }
  const full = helpers.intentionCardModelFor("2026/20261120.md", {
    type: "[[day]]", intentions: ["Ship"], created: "2026-11-20T07:55:00-05:00",
  }, today);
  plugin.intentionCardSourceCache = new Map([["2026/20261120.md", {
    path: "2026/20261120.md",
    source: yaml(["type: \"[[day]]\"", "intentions:", "  - Ship", "created: 2026-11-20T07:55:00-05:00"]),
    frontmatter: { type: "[[day]]", intentions: ["Ship"], created: "2026-11-20T07:55:00-05:00" },
  }]]);
  const painted = helpers.intentionCardBuildDom(full, plugin, doc);
  assert.ok(painted.querySelector(FOOT));
  assert.match(painted.querySelector(".bob-property-card-foot-stamp").textContent, /created/);
  const spec = plugin.intentionCardFootSpec("2026/20261120.md", full);
  assert.equal(spec.inventory.rows.find((row) => row.key === "type")?.mark, "tile");
  assert.equal(spec.inventory.rows.find((row) => row.key === "intentions")?.mark, "intentions");
  assert.equal(spec.inventory.rows.find((row) => row.key === "created")?.mark, "foot");
  assert.equal(plugin._spawns, 0);
  helpers.propertyCardFootResetAll();
});

test("bank setup appends the foot after BuildEl, including collapsed, and hides only bank", () => {
  helpers.propertyCardFootResetAll();
  const writes = [];
  const app = {
    vault: {
      getAbstractFileByPath: (p) => ({ path: p }),
      read: async () => "",
      cachedRead: async () => "",
      modify: async (...args) => { writes.push(args); },
    },
    metadataCache: { getFileCache: () => ({ frontmatter: {} }), on: () => ({}) },
    workspace: { on: () => ({}), getLeavesOfType: () => [], openLinkText: async () => {} },
  };
  const plugin = new LedgerToolsPlugin(app);
  plugin._spawns = 0;
  plugin.spawnBob = async () => { plugin._spawns += 1; throw new Error("unexpected spawn"); };
  plugin.bankSetupActive = true;
  plugin.bankSetupExpanded = new Map([["bank.md", false]]);
  plugin.albumSetTimeout = (fn) => { fn(); return 1; };
  plugin.albumClearTimeout = () => {};
  const decoded = helpers.bankDecodeConfig(JSON.stringify({
    schema_version: 1, ok: true, state: "valid",
    categories: [{ key: "coffee", label: "Coffee" }],
    accounts: [{ alias: "checking", label: "WF Checking" }],
  }), "");
  plugin.bankSetupLastState = {
    results: { [plugin.bankSetupConfigKey()]: { report: decoded.report, stale: false, error: null, refreshing: false } },
  };
  plugin.bankSetupRememberSource("bank.md", yaml(["bank:", "  accounts: {}", "created: 2026-01-02"]));
  const doc = makeDoc();
  const model = plugin.bankSetupModelFor("bank.md");
  assert.equal(model.expanded, false);
  const header = plugin.bankSetupBuildReading(model, { ...plugin.bankSetupOptions("bank.md", model) }, doc);
  assert.ok(header.querySelector(FOOT), "collapsed setup keeps the foot");
  const collapsedBody = header.querySelector(".bob-bank-setup-body");
  assert.ok(collapsedBody, "collapsed setup keeps an empty hidden body shell for aria-controls");
  assert.equal(collapsedBody.getAttribute("hidden"), "");
  assert.equal(collapsedBody.children.length, 0);
  assert.equal(footLast(header), true);
  assert.match(header.querySelector(".bob-property-card-foot-stamp").textContent, /no created date|created/);
  const helper = helpers.bankSetupBuildEl(model, {}, doc);
  assert.equal(helper.querySelector(FOOT), null, "the BuildEl helper stays foot-free");
  const collapsedCard = plugin.bankSetupFootCard({ identity: null, model });
  assert.equal(collapsedCard.bodyPainted, false);
  const spec = plugin.bankSetupFootSpec("bank.md", collapsedCard);
  assert.equal(spec.inventory.rows.find((row) => row.key === "bank")?.mark, null,
    "a collapsed body paints no bank mapping");
  assert.equal(spec.inventory.rows.find((row) => row.key === "bank")?.nested, "setup");
  assert.equal(spec.inventory.rows.find((row) => row.key === "created")?.mark, "foot");
  const paintedCard = plugin.bankSetupFootCard({
    identity: { title: "Bank", summary: "Bank hub", owners: [{ path: "cash.md", title: "Cash" }] },
    model: { ...model, expanded: true },
  });
  const painted = plugin.bankSetupFootSpec("bank.md", paintedCard);
  assert.equal(painted.inventory.rows.find((row) => row.key === "bank")?.mark, "setup");
  assert.deepEqual(plugin.bankSetupFootWhere(paintedCard), {
    type: "tile",
    parent: "kicker",
    summary: "subtitle",
    bank: "setup",
    created: "foot",
  });
  plugin.bankSetupDesktop = () => false;
  const mobile = plugin.bankSetupFootSpec("bank.md", collapsedCard);
  assert.equal(mobile.inventory.rows.find((row) => row.key === "bank")?.nested, null);

  const { preview, properties } = readingProperties(doc, ["bank", "title", "aliases"]);
  plugin.bankSetupDesktop = () => true;
  plugin.paintBankSetupReading(preview, "bank.md");
  assert.equal(properties.querySelector('[data-property-key="bank"]').classList.contains(OWNED), true);
  assert.equal(properties.querySelector('[data-property-key="title"]').classList.contains(OWNED), false);
  assert.equal(plugin._spawns, 0);
  assert.deepEqual(writes, []);
  helpers.propertyCardFootResetAll();
});

test("adapter EnsureSource caches a first empty read without refresh", async () => {
  helpers.propertyCardFootResetAll();
  let refresh = 0;
  const cache = new Map();
  const flights = new Map();
  const plugin = {
    app: {
      vault: {
        getAbstractFileByPath: (path) => ({ path }),
        read: async () => "",
      },
    },
  };
  const flight = helpers.propertyCardFootAdapterEnsureSource(plugin, "bank.md", {
    cache, flights, refresh: () => { refresh += 1; },
  });
  assert.ok(flight);
  await flight;
  assert.equal(cache.get("bank.md"), "");
  assert.equal(refresh, 0, "the first empty read does not refresh");
  helpers.propertyCardFootResetAll();
});

test("tag search opens a tag query for adapters and record sheets, with command fallback", () => {
  const queries = [];
  const app = {
    internalPlugins: {
      getPluginById: (id) => id === "global-search" ? {
        instance: { openGlobalSearch: (query) => { queries.push(query); } },
      } : null,
    },
  };
  assert.equal(helpers.propertyCardFootAdapterSearchTag({ app }, "phase"), true);
  assert.equal(helpers.propertyCardFootAdapterSearchTag({ app }, "#phase"), true);
  const recordPlugin = new LedgerToolsPlugin({ ...app });
  assert.equal(recordPlugin.recordSheetSearchTag("phase"), true);
  assert.deepEqual(queries, ["tag:#phase", "tag:#phase", "tag:#phase"]);

  let fallbackCommand = "";
  const fallbackApp = { commands: { executeCommandById: (id) => { fallbackCommand = id; return true; } } };
  assert.equal(helpers.propertyCardFootAdapterSearchTag({ app: fallbackApp }, "#phase"), true);
  assert.equal(fallbackCommand, "global-search:open");
});
