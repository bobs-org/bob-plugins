const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
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
const Decoration = { none: [], widget: (options) => ({ ...options, startSide: options.side }), replace: (options) => ({ ...options, startSide: 0, replace: true }) };
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
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  focus() { if (!this.disabled) this.ownerDocument.activeElement = this; }
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
      const tagClass = /^([a-z][\w-]*)\.([\w-]+)$/i.exec(value);
      const attr = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(value);
      const taggedAttr = /^([a-z][\w-]*)\[([\w-]+)(?:="([^"]*)")?\]$/i.exec(value);
      const hasAttr = (name, expected) => this.attrs.has(name) && (expected === undefined || this.getAttribute(name) === expected);
      return Boolean((tagClass && this.tagName === tagClass[1].toUpperCase() && this.classList.contains(tagClass[2])) || (cls && this.classList.contains(cls[1])) || (tag && this.tagName === tag[0].toUpperCase()) ||
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

const CLOCK = { today: "2026-11-17", now: new Date(2026, 10, 17, 12, 0, 0) };
const HIDES = helpers.RECORD_SHEET_HIDES_CLASS;

const choice = (value, label) => ({ value, label, count: 0 });
const field = (key, kind, extra = {}) => ({
  key, label: extra.label || key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
  kind, required: extra.required === true, list: extra.list === true,
  choices: extra.choices || [], min: extra.min, max: extra.max, suggest: extra.suggest === true,
});

function albumEntry(overrides = {}) {
  return {
    path: "eat.md", stem: "eat", title: "Restaurants", noun: "restaurant", emoji: "🍽️",
    summary: null, label: "Restaurant", plural: "restaurants", singular: "restaurant",
    dated_notes: false, legacy: ["old_place"], schema_fingerprint: "sha256:eat",
    parent: "body", parent_kind: "area", owner: "body", root: "body",
    breadcrumb: ["Body"], group_field: "status", index_by: "status", index_facets: [],
    records: 1, groups: [{ value: "to_try", label: "To try", count: 1, peek: [] }],
    needs_status: 0, last_record: "eat/smashburger.md",
    index: { state: "current" }, issues: [], fields: [
      field("status", "choice", { required: true, choices: [choice("to_try", "🔖 To try"), choice("loved", "💚 Loved")] }),
      field("cuisine", "choice", { choices: [choice("burgers", "Burgers"), choice("pizza", "Pizza")] }),
      field("location", "text"),
      field("visited", "date"),
      field("notes", "text"),
    ],
    ...overrides,
  };
}

function moviesAlbum(overrides = {}) {
  return albumEntry({
    path: "movies.md", stem: "movies", title: "Movies", noun: "movie", emoji: "🎬",
    label: "Movie", plural: "movies", singular: "movie", group_field: "status", index_by: "status",
    last_record: "movies/heat.md", legacy: [], schema_fingerprint: "sha256:movies",
    fields: [
      field("status", "choice", { required: true, choices: [choice("to_watch", "To watch"), choice("watched", "Watched")] }),
      field("watched_on", "date"),
      field("rating", "number", { min: 1, max: 5 }),
    ],
    ...overrides,
  });
}

function saseAlbum(overrides = {}) {
  return albumEntry({
    path: "sase.md", stem: "sase", title: "SASE", noun: "bead", emoji: "🧶",
    label: "Bead", plural: "beads", singular: "bead", group_field: "status", index_by: "status",
    last_record: "sase/bead_lifecycle.md", legacy: [], schema_fingerprint: "sha256:sase",
    fields: [
      field("status", "choice", { required: true, choices: [choice("open", "Open"), choice("closed", "Closed")] }),
      field("started", "date", { required: true }),
      field("url", "url"),
      field("related", "link"),
      field("count", "number"),
      field("tags", "text", { list: true }),
      field("notes", "text"),
    ],
    ...overrides,
  });
}

function subscriptionsAlbum(overrides = {}) {
  return albumEntry({
    path: "subscriptions.md", stem: "subscriptions", title: "Subscriptions", noun: "subscription",
    emoji: "🔁", label: "Subscription", plural: "subscriptions", singular: "subscription",
    group_field: "status", index_by: "status", last_record: "subscriptions/tunely.md",
    legacy: [], schema_fingerprint: "sha256:subs",
    fields: [
      field("status", "choice", { required: true, choices: [choice("active", "💚 Active"), choice("to_decide", "🤔 To decide")] }),
      field("amount", "number", { required: true }),
      field("cadence", "choice", { required: true, choices: [choice("monthly", "Monthly"), choice("yearly", "Yearly")] }),
      field("match", "text", { list: true }),
      field("recur_id", "text"),
      field("url", "url"),
    ],
    ...overrides,
  });
}

function reportOf(albums, extra = {}) {
  return helpers.albumIndexReport({
    schema_version: 1, ok: true, albums: Array.isArray(albums) ? albums : [albums],
    catalogs: [], counts: { albums: 1, records: 1, roots: 1 },
    capabilities: ["record_values_v1"],
    ...extra,
  });
}

function fixture(options = {}) {
  const albums = options.albums || [albumEntry(), moviesAlbum(), saseAlbum(), subscriptionsAlbum()];
  const doc = makeDoc();
  const files = new Map();
  const caches = new Map();
  const add = (path, frontmatter, heading) => {
    files.set(path, { path });
    caches.set(path, {
      frontmatter,
      headings: heading ? [{ level: 1, heading }] : [],
    });
  };
  add("body.md", { type: "[[area]]", root_parent: true }, "Body");
  add("eat.md", { type: "[[album]]" }, "Restaurants");
  add("movies.md", { type: "[[album]]" }, "Movies");
  add("sase.md", { type: "[[album]]" }, "SASE");
  add("subscriptions.md", { type: "[[album]]" }, "Subscriptions");
  add("eat/smashburger.md", {
    type: "[[record]]", parent: "[[eat]]", title: "Smashburger", created: "2025-08-08",
    status: "to_try", cuisine: "burgers", location: "See [[body]] downtown",
    visited: "2026-11-16", notes: "Crispy fries", old_place: "Mall kiosk", extra: null,
  }, "Smashburger");
  add("movies/heat.md", {
    type: "[[record]]", parent: "[[movies]]", title: "Heat", status: "to_watch",
  }, "Heat");
  add("sase/bead_lifecycle.md", {
    type: "[[record]]", parent: "[[sase]]", title: "Bead lifecycle", created: "2026-11-17T07:55:00",
    status: "open", started: "2026-11-17", url: "https://example.test/beads",
    related: "[[sase]]", count: 3, tags: ["phase", "record sheet"], notes: "See [[eat/smashburger]] too",
  }, "Bead lifecycle");
  add("subscriptions/tunely.md", {
    type: "[[record]]", parent: "[[subscriptions]]", title: "Tunely", created: "2026-11-16",
    status: "active", amount: 9.99, cadence: "monthly", match: ["TUNELY*MEDIA", "Tunely, Inc"],
    recur_id: "rec_123", url: "https://tunely.example/account",
  }, "Tunely");
  for (const [path, cache] of Object.entries(options.extraCaches || {})) {
    add(path, cache.frontmatter || {}, cache.heading);
  }
  const app = {
    vault: {
      getAbstractFileByPath: (path) => files.get(path) || null,
      read: async (file) => options.sources?.[file?.path || file] || "",
    },
    metadataCache: {
      getFirstLinkpathDest: (target) => files.get(`${String(target).replace(/\.md$/i, "")}.md`) || null,
      getFileCache: (file) => caches.get(file?.path) || null,
      on() { return { unload() {} }; },
    },
    workspace: {
      trigger() {},
      getLeavesOfType: () => [],
      getMostRecentLeaf: () => null,
      openLinkText: async () => {},
    },
  };
  const plugin = new LedgerToolsPlugin(app);
  const state = { report: reportOf(albums, options.reportExtra), stale: false };
  plugin.albumReportState = () => state;
  plugin.apiAlbumSubscribe = (fn) => { fn(state); return () => {}; };
  plugin.recordSheetActive = true;
  plugin.recordSheetReading = new Set();
  plugin.recordSheetReadingPending = new Map();
  plugin.recordSheetReadingTimers = new Map();
  plugin.recordSheetEditors = new Set();
  plugin.recordSheetEditorScopes = new Map();
  plugin.recordSheetEditorCache = new WeakMap();
  plugin.recordSheetCollapsed = new Map();
  plugin.recordSheetFolds = new Map();
  plugin.recordSheetOverlays = new Map();
  plugin.recordSheetOwnedKey = "";
  plugin.recordSheetDomBuilds = 0;
  plugin.recordSheetDay = CLOCK.today;
  plugin.subscriptionSurfacesActive = true;
  plugin.subscriptionSurfacesReading = new Set();
  plugin.subscriptionSurfacesEditors = new Set();
  plugin.subscriptionSurfacesReport = options.subscriptionReport || null;
  plugin.subscriptionSurfacesUnsubscribe = () => {};
  plugin.apiBankSubscribe = () => () => {};
  const timers = new Map();
  let nextTimer = 0;
  plugin.albumSetTimeout = (fn) => { timers.set(++nextTimer, fn); return nextTimer; };
  plugin.albumClearTimeout = (timer) => timers.delete(timer);
  const flush = () => { const cbs = [...timers.values()]; timers.clear(); cbs.forEach((fn) => fn()); };
  plugin.notebookCatalogLivePath = (view) => view.path || null;
  plugin._spawns = 0;
  plugin.spawnBob = async () => { plugin._spawns += 1; throw new Error("unexpected spawn"); };
  plugin.flushRecordSheet = flush;
  return { app, caches, doc, files, plugin, state, flush, timers };
}

function gateFor(path, frontmatter, report, extra = {}) {
  const { app } = extra.world || fixture();
  return helpers.recordSheetGate({
    path, frontmatter, report, desktop: extra.desktop !== false,
    metadataCache: extra.metadataCache || app.metadataCache,
    vault: extra.vault || app.vault,
  });
}

function modelFor(path, frontmatter, album, extra = {}) {
  const world = extra.world || fixture({ albums: [album] });
  const gate = helpers.recordSheetGate({
    path, frontmatter, report: world.state.report, desktop: true,
    metadataCache: world.app.metadataCache, vault: world.app.vault,
  });
  return helpers.recordSheetModel({
    path, frontmatter, report: world.state.report, heading: extra.heading,
    clock: extra.clock || CLOCK, overlay: extra.overlay, gate,
    metadataCache: world.app.metadataCache, vault: world.app.vault,
    collapsed: extra.collapsed === true, foldOpen: extra.foldOpen === true,
    hue: extra.hue || "", subscription: extra.subscription || null,
  });
}

function assertHomes(model, expected) {
  for (const [key, home] of Object.entries(expected)) {
    assert.equal(model.coverage[key], home, `${key} home`);
  }
  const row = new Set(model.rows.map((item) => item.key));
  const ghost = new Set(model.ghosts.map((item) => item.key));
  const fold = new Set(model.fold.map((item) => item.key));
  for (const key of row) {
    assert.equal(ghost.has(key), false, `${key} row+ghost`);
    assert.equal(fold.has(key), false, `${key} row+fold`);
  }
  for (const key of ghost) assert.equal(fold.has(key), false, `${key} ghost+fold`);
}

function liveView(doc, path, text, live = true) {
  const lines = text.split("\n").map((line, i, rows) => {
    const from = rows.slice(0, i).reduce((sum, item) => sum + item.length + 1, 0);
    return { from, to: from + line.length };
  });
  const sourceView = node(doc, "div", "markdown-source-view");
  const root = node(doc, "div", "cm-editor");
  const scroller = node(doc, "div", "cm-scroller");
  const sizer = node(doc, "div", "cm-sizer");
  sizer.appendChild(node(doc, "div", "metadata-container"));
  sizer.appendChild(node(doc, "div", "inline-title"));
  scroller.appendChild(sizer);
  root.appendChild(scroller);
  sourceView.appendChild(root);
  return {
    path, dom: root, sourceView, scroller, sizer,
    state: {
      doc: { toString: () => text, line: (n) => lines[n - 1], get lines() { return lines.length; }, get length() { return text.length; } },
      field(key) {
        if (key === editorLivePreviewField) return live;
        if (key === editorInfoField) return { file: { path } };
        return undefined;
      },
    },
  };
}

test("gate accepts only a canonical desktop record under its album folder", () => {
  const world = fixture();
  const report = world.state.report;
  const smash = world.caches.get("eat/smashburger.md").frontmatter;
  const ok = gateFor("eat/smashburger.md", smash, report, { world });
  assert.equal(ok.mount, true);
  assert.equal(ok.hideEligible, true);
  assert.equal(ok.editable, true);
  assert.equal(ok.reason, "ok");

  assert.equal(gateFor("eat/smashburger.md", smash, report, { world, desktop: false }).reason, "mobile");
  assert.equal(gateFor("eat/smashburger.md", smash, null, { world }).reason, "no-report");
  assert.equal(gateFor("eat/smashburger.md", null, report, { world }).reason, "no-metadata");
  assert.equal(gateFor("bank/2026-11.md", { type: "[[bank_month]]" }, report, { world }).reason, "bank-month");
  assert.equal(gateFor("eat/smashburger.md", { type: ["[[record]]", "[[album]]"], parent: "[[eat]]" }, report, { world }).reason, "mixed-type");
  assert.equal(gateFor("eat/smashburger.md", { type: "[[restaurant]]", parent: "[[eat]]" }, report, { world }).reason, "other-type");
  assert.equal(gateFor("eat/smashburger.md", { type: "[[project]]", parent: "[[eat]]" }, report, { world }).reason, "other-type");
  assert.equal(gateFor("eat/smashburger.md", { parent: "[[eat]]" }, report, { world }).reason, "not-record");
  assert.equal(gateFor("eat/smashburger.md", { type: "[[record]]" }, report, { world }).reason, "missing-parent");
  assert.equal(gateFor("eat/smashburger.md", { type: "[[record]]", parent: ["[[eat]]", "[[movies]]"] }, report, { world }).reason, "ambiguous-parent");
  assert.equal(gateFor("eat/smashburger.md", { type: "[[record]]", parent: "[[eat/smashburger]]" }, report, { world }).reason, "cyclic-parent");
  assert.equal(gateFor("eat/smashburger.md", { type: "[[record]]", parent: "[[body]]" }, report, { world }).reason, "non-album-parent");
  assert.equal(gateFor("movies/heat.md", { type: "[[record]]", parent: "[[eat]]" }, report, { world }).reason, "mismatched-parent");
  assert.equal(gateFor("eat/nested/down.md", { type: "[[record]]", parent: "[[eat]]" }, report, { world }).reason, "nested-folder");
  assert.equal(gateFor("inbox.md", { type: "[[record]]", parent: "[[eat]]" }, report, { world }).reason, "outside-folder");
});

test("broken schema still mounts; capability only changes eligibility", () => {
  const brokenAlbum = albumEntry({
    schema_fingerprint: null,
    issues: [{ severity: "error", code: "album_schema_invalid", message: "record.fields is invalid", path: "eat.md", line: 4, suggestions: [] }],
  });
  const world = fixture({ albums: [brokenAlbum] });
  const smash = world.caches.get("eat/smashburger.md").frontmatter;
  const broken = gateFor("eat/smashburger.md", smash, world.state.report, { world });
  assert.equal(broken.mount, true);
  assert.equal(broken.state, "broken");
  assert.equal(broken.hideEligible, false);
  assert.equal(broken.editable, false);
  assert.equal(broken.reason, "broken-schema");

  const healthy = albumEntry();
  const missingCaps = fixture({ albums: [healthy], reportExtra: { capabilities: undefined } });
  delete missingCaps.state.report.capabilities;
  const noCap = gateFor("eat/smashburger.md", smash, missingCaps.state.report, { world: missingCaps });
  assert.equal(noCap.mount, true);
  assert.equal(noCap.hideEligible, false);
  assert.equal(noCap.reason, "no-capability");

  const badCaps = fixture({ albums: [healthy], reportExtra: { capabilities: "record_values_v1" } });
  const malformed = gateFor("eat/smashburger.md", smash, badCaps.state.report, { world: badCaps });
  assert.equal(malformed.mount, true);
  assert.equal(malformed.hideEligible, false);
  assert.equal(malformed.reason, "malformed-capability");
});

test("eat, movies, sase, and subscription fixtures cover every authored key once", () => {
  const eatFm = {
    type: "[[record]]", parent: "[[eat]]", title: "Smashburger", created: "2025-08-08",
    status: "to_try", cuisine: "burgers", location: "See [[body]] downtown",
    visited: "2026-11-16", notes: "Crispy fries", old_place: "Mall kiosk", extra: null,
  };
  const eat = modelFor("eat/smashburger.md", eatFm, albumEntry(), { heading: "Smashburger" });
  assert.deepEqual(eat.rows.map((row) => row.key), ["status", "cuisine", "location", "visited", "notes"]);
  assertHomes(eat, {
    parent: "breadcrumb", type: "identity", title: "sheet", created: "footer",
    status: "row", cuisine: "row", location: "row", visited: "row", notes: "row",
    old_place: "fold", extra: "fold",
  });
  assert.equal(eat.createdFooter, "added Aug 8, 2025");
  assert.equal(eat.fold.find((item) => item.key === "old_place").legacy, true);
  assert.equal(eat.fold.find((item) => item.key === "extra").text, "—");
  assert.equal(eat.rows.find((row) => row.key === "visited").text, "yesterday");
  assert.match(eat.rows.find((row) => row.key === "location").spans.find((span) => span.kind === "link").text, /Body|body/);

  const movie = modelFor("movies/heat.md", {
    type: "[[record]]", parent: "[[movies]]", title: "Heat", status: "to_watch",
  }, moviesAlbum(), { heading: "Heat" });
  assert.deepEqual(movie.rows.map((row) => row.key), ["status"]);
  assert.deepEqual(movie.ghosts.map((row) => row.key), ["watched_on", "rating"]);
  assertHomes(movie, { parent: "breadcrumb", type: "identity", title: "sheet", status: "row", watched_on: "ghost", rating: "ghost" });

  const bead = modelFor("sase/bead_lifecycle.md", {
    type: "[[record]]", parent: "[[sase]]", title: "Bead lifecycle", created: "2026-11-17T07:55:00",
    status: "open", started: "2026-11-17", url: "https://example.test/beads",
    related: "[[sase]]", count: 3, tags: ["phase", "record sheet"], notes: "See [[eat/smashburger]] too",
  }, saseAlbum(), { heading: "Bead lifecycle" });
  assert.equal(bead.createdFooter, "added today, 7:55 AM");
  assert.equal(bead.rows.find((row) => row.key === "started").text, "today");
  assert.equal(bead.rows.find((row) => row.key === "url").href, "https://example.test/beads");
  assert.equal(bead.rows.find((row) => row.key === "related").spans[0].kind, "link");
  assert.equal(bead.rows.find((row) => row.key === "count").numeric, true);
  assert.equal(bead.rows.find((row) => row.key === "tags").chips.length, 2);

  const sub = modelFor("subscriptions/tunely.md", {
    type: "[[record]]", parent: "[[subscriptions]]", title: "Tunely",
    status: "active", amount: 9.99, cadence: "monthly", match: ["TUNELY*MEDIA", "Tunely, Inc"],
    recur_id: "rec_123", url: "https://tunely.example/account",
  }, subscriptionsAlbum(), { heading: "Tunely" });
  assert.match(sub.rows.find((row) => row.key === "amount").text, /\$9\.99/);
  assert.deepEqual(sub.rows.find((row) => row.key === "match").chips.map((chip) => chip.text), ["TUNELY*MEDIA", "Tunely, Inc"]);
  assertHomes(sub, {
    parent: "breadcrumb", type: "identity", title: "sheet",
    status: "row", amount: "row", cadence: "row", match: "row", recur_id: "row", url: "row",
  });
});

test("invalid shapes stay visible and never coerce; missing differs from empty", () => {
  const fm = {
    type: "[[record]]", parent: "[[sase]]", title: "Broken bead",
    status: "unknown", started: "not-a-date", url: "javascript:alert(1)",
    related: 12, count: "3", tags: "phase", notes: "",
  };
  const model = modelFor("sase/bead_lifecycle.md", fm, saseAlbum(), { heading: "Broken bead" });
  const byKey = Object.fromEntries(model.rows.map((row) => [row.key, row]));
  assert.equal(byKey.status.state, "invalid");
  assert.equal(byKey.started.state, "invalid");
  assert.equal(byKey.url.state, "invalid");
  assert.equal(byKey.related.state, "invalid");
  assert.equal(byKey.count.state, "invalid");
  assert.equal(byKey.tags.state, "invalid");
  assert.equal(model.ghosts.some((item) => item.key === "notes"), true);
  const missing = modelFor("sase/bead_lifecycle.md", {
    type: "[[record]]", parent: "[[sase]]", title: "Sparse",
  }, saseAlbum(), { heading: "Sparse" });
  assert.equal(missing.rows.find((row) => row.key === "status").state, "missing");
  assert.equal(missing.rows.find((row) => row.key === "started").state, "missing");
  assert.deepEqual(missing.ghosts.map((row) => row.key), ["url", "related", "count", "tags", "notes"]);
  const bounds = modelFor("movies/heat.md", {
    type: "[[record]]", parent: "[[movies]]", status: "watched", rating: 9,
  }, moviesAlbum(), { heading: "Heat" });
  assert.equal(bounds.rows.find((row) => row.key === "rating").state, "invalid");
});

test("title lives in the sheet regardless of H1 agreement; created coverage is unchanged", () => {
  const base = {
    type: "[[record]]", parent: "[[eat]]", title: "Smashburger", created: "2025-08-08", status: "to_try",
  };
  const match = modelFor("eat/smashburger.md", base, albumEntry(), { heading: "Smashburger" });
  assert.equal(match.coverage.title, "sheet");
  assert.equal(match.fold.some((item) => item.key === "title"), false);
  const mismatch = modelFor("eat/smashburger.md", base, albumEntry(), { heading: "A burger" });
  assert.equal(mismatch.coverage.title, "sheet");
  assert.equal(mismatch.fold.some((item) => item.key === "title"), false);
  const noH1 = modelFor("eat/smashburger.md", base, albumEntry(), { heading: "" });
  assert.equal(noH1.coverage.title, "sheet");
  const invalidCreated = modelFor("eat/smashburger.md", { ...base, created: "soon" }, albumEntry(), { heading: "Smashburger" });
  assert.equal(invalidCreated.coverage.created, "fold");
  assert.equal(invalidCreated.createdFooter, null);
  assert.match(invalidCreated.fold.find((item) => item.key === "created").lint, /invalid date/);
  const absentCreated = modelFor("eat/smashburger.md", { type: "[[record]]", parent: "[[eat]]", status: "to_try" }, albumEntry(), { heading: "Smashburger" });
  assert.equal(absentCreated.createdFooter, null);
  assert.equal(absentCreated.coverage.created, undefined);
  const yesterday = modelFor("eat/smashburger.md", { ...base, created: "2026-11-16" }, albumEntry(), { heading: "Smashburger" });
  assert.equal(yesterday.createdFooter, "added yesterday");
});

test("title row uses literal frontmatter title, then H1, then filename stem", () => {
  const { plugin, doc, caches } = fixture();
  const record = caches.get("eat/smashburger.md");
  record.frontmatter.title = "  [[x]] <b> #tag  ";
  record.headings = [{ level: 1, heading: "Legacy heading" }];
  const root = node(doc, "div", "markdown-preview-view");
  const sheet = plugin.paintRecordSheetReading(root, "eat/smashburger.md");
  const title = sheet.querySelector(".bob-record-sheet-title");
  assert.equal(title.tagName, "DIV");
  assert.equal(title.getAttribute("role"), "heading");
  assert.equal(title.getAttribute("aria-level"), "1");
  assert.equal(title.textContent, "[[x]] <b> #tag");
  assert.equal(title.querySelector("b"), null, "title markup stays text");
  assert.equal(sheet.getAttribute("aria-label"), "[[x]] <b> #tag record details");

  delete record.frontmatter.title;
  const legacyTitle = plugin.paintRecordSheetReading(root, "eat/smashburger.md");
  assert.equal(legacyTitle.querySelector(".bob-record-sheet-title").textContent, "Legacy heading");
  record.headings = [];
  const stemTitle = plugin.paintRecordSheetReading(root, "eat/smashburger.md");
  assert.equal(stemTitle.querySelector(".bob-record-sheet-title").textContent, "smashburger");

  const broken = albumEntry({
    issues: [{ severity: "error", code: "album_schema_invalid", message: "bad schema", path: "eat.md", line: 1, suggestions: [] }],
    schema_fingerprint: "",
  });
  const brokenWorld = fixture({ albums: [broken] });
  const brokenRoot = node(brokenWorld.doc, "div", "markdown-preview-view");
  const brokenSheet = brokenWorld.plugin.paintRecordSheetReading(brokenRoot, "eat/smashburger.md");
  assert.equal(brokenSheet.querySelector(".bob-record-sheet-title").textContent, "Smashburger");
  assert.match(brokenSheet.querySelector(".bob-record-sheet-warning").textContent, /bad schema/);
});

test("record link labels prefer frontmatter title over a legacy H1", () => {
  const { app, caches } = fixture();
  caches.get("eat/smashburger.md").headings = [{ level: 1, heading: "Old heading" }];
  const linked = helpers.recordSheetValueModel(field("related", "link"), "[[eat/smashburger]]", {
    clock: CLOCK,
    sourcePath: "sase/bead_lifecycle.md",
    metadataCache: app.metadataCache,
    vault: app.vault,
  });
  assert.equal(linked.text, "Smashburger");
  assert.equal(linked.spans[0].text, "Smashburger");
});

test("Live Preview places H1-less sheets after frontmatter and before body sections", () => {
  const { plugin, doc } = fixture();
  const frontmatterOnly = "---\ntitle: Bare\n---\n";
  const notesBody = `${frontmatterOnly}## Notes\n\n- item`;
  const legacyH1 = `${frontmatterOnly}# Bare\n\n## Notes\n`;
  assert.equal(plugin.recordSheetAnchor(liveView(doc, "eat/bare.md", frontmatterOnly), frontmatterOnly), frontmatterOnly.length);
  assert.equal(plugin.recordSheetAnchor(liveView(doc, "eat/bare.md", notesBody), notesBody), notesBody.indexOf("## Notes"));
  const headingEnd = legacyH1.indexOf("\n", legacyH1.indexOf("# Bare"));
  assert.equal(plugin.recordSheetAnchor(liveView(doc, "eat/bare.md", legacyH1), legacyH1), headingEnd);
});

test("reading Record Card precedes the authored legacy H1", () => {
  const { plugin, doc } = fixture();
  const root = node(doc, "div", "markdown-preview-view");
  const heading = node(doc, "h1", "", "Legacy heading");
  root.appendChild(heading);
  const sheet = plugin.paintRecordSheetReading(root, "eat/smashburger.md");
  assert.ok(root.children.indexOf(sheet) < root.children.indexOf(heading), "the card must precede the body heading");
});

test("collapsed summary leads with the group choice and keeps per-path fold state", () => {
  const fm = {
    type: "[[record]]", parent: "[[eat]]", title: "Smashburger",
    status: "loved", cuisine: "pizza", notes: "Good",
  };
  const collapsed = modelFor("eat/smashburger.md", fm, albumEntry(), { heading: "Smashburger", collapsed: true });
  assert.deepEqual(collapsed.choiceChips.map((chip) => chip.text), ["💚 Loved", "Pizza"]);
  assert.match(String(collapsed.fieldCount), /5/);
  const { plugin, doc, caches } = fixture();
  caches.get("eat/smashburger.md").frontmatter.status = "loved";
  caches.get("eat/smashburger.md").frontmatter.cuisine = "pizza";
  const root = node(doc, "div", "markdown-preview-view");
  root.appendChild(node(doc, "h1", "", "Smashburger"));
  plugin.recordSheetSetCollapsed("eat/smashburger.md", true);
  plugin.recordSheetSetFold("eat/smashburger.md", true);
  const sheet = plugin.paintRecordSheetReading(root, "eat/smashburger.md");
  assert.equal(sheet.querySelectorAll(".bob-album-schema-field-key").length, 0, "record sheet paints no field keycaps");
  assert.match(sheet.querySelector(".bob-record-sheet-summary").textContent, /Loved/);
  assert.equal(plugin.recordSheetIsCollapsed("eat/smashburger.md"), true);
  assert.equal(plugin.recordSheetFoldOpen("eat/smashburger.md"), true);
  const other = node(doc, "div", "markdown-preview-view");
  other.appendChild(node(doc, "h1", "", "Heat"));
  plugin.paintRecordSheetReading(other, "movies/heat.md");
  assert.equal(plugin.recordSheetIsCollapsed("movies/heat.md"), false);
});

test("DOM keeps HTML-looking values as text, rejects dangerous URLs, and exposes YAML jumps", async () => {
  const world = fixture({
    sources: {
      "eat/smashburger.md": "---\ntype: [[record]]\nparent: [[eat]]\nstatus: to_try\nnotes: <img src=x>\n---\n# Smashburger\n",
    },
  });
  world.caches.get("eat/smashburger.md").frontmatter.notes = "<img src=x onerror=alert(1)>";
  world.caches.get("eat/smashburger.md").frontmatter.location = "javascript:alert(1)";
  const { plugin, doc, app } = world;
  const root = node(doc, "div", "markdown-preview-view");
  root.appendChild(node(doc, "h1", "", "Smashburger"));
  const sheet = plugin.paintRecordSheetReading(root, "eat/smashburger.md");
  assert.equal(plugin._spawns, 0);
  assert.equal(sheet.querySelectorAll("script").length, 0);
  assert.equal(sheet.textContent.includes("<img src=x onerror=alert(1)>"), true);
  assert.equal(sheet.querySelectorAll(".bob-record-sheet-url").length, 0);
  assert.equal(sheet.getAttribute("role"), "group");
  assert.match(sheet.getAttribute("aria-label"), /Smashburger record details/);
  const collapse = sheet.querySelector(".bob-record-sheet-collapse");
  assert.equal(collapse.getAttribute("aria-expanded"), "true");
  const status = sheet.querySelector("[data-record-key=\"status\"]");
  assert.equal(status.getAttribute("tabindex"), "0");
  const leaf = {
    view: { file: { path: "eat/smashburger.md" }, editor: { setCursor() { leaf.cursor = arguments[0]; }, scrollIntoView() {} } },
    async openFile() { leaf.opened = true; },
  };
  app.workspace.getLeavesOfType = () => [leaf];
  const jumped = await plugin.recordSheetJumpYaml("eat/smashburger.md", "status");
  assert.equal(jumped.ok, true);
  assert.equal(leaf.cursor.line, 3);
  plugin.recordSheetSetFold("eat/smashburger.md", true);
  plugin.paintRecordSheetReading(root, "eat/smashburger.md");
  assert.equal(plugin._spawns, 0);
  assert.equal(root.classList.contains(HIDES), true);
});

test("YAML jumps leave Live Preview and await raw Source before placing the cursor", async () => {
  const { plugin, app } = fixture();
  const events = [];
  let viewState = { mode: "source", source: false, file: "eat/smashburger.md", scroll: 17 };
  let release;
  const transition = new Promise(resolve => { release = resolve; });
  const leaf = {
    view: {
      file: { path: "eat/smashburger.md" },
      getState: () => viewState,
      async setState(next) { await transition; viewState = next; events.push("source"); },
      editor: {
        setCursor(cursor) { assert.equal(viewState.source, true); events.push(cursor); },
        scrollIntoView() {}, focus() { events.push("focus"); },
      },
    },
    async openFile(file, options) {
      assert.equal(file.path, "eat/smashburger.md");
      assert.deepEqual(options.state, { mode: "source", source: true });
      // Obsidian may keep an already-open file's current view state.
    },
  };
  app.workspace.getLeavesOfType = () => [leaf];
  app.workspace.setActiveLeaf = selected => { assert.equal(selected, leaf); events.push("active"); };
  const pending = plugin.recordSheetOpenSource("eat/smashburger.md", 4);
  await Promise.resolve();
  assert.deepEqual(events, [], "cursor must wait for the mode transition");
  release();
  assert.deepEqual(await pending, { ok: true, line: 4 });
  assert.equal(viewState.scroll, 17);
  assert.deepEqual(events, ["source", "active", { line: 3, ch: 0 }, "focus"]);
});

test("YAML jump fallback explicitly requests raw Source and keeps unrelated view state", async () => {
  const { plugin, app } = fixture();
  const current = { type: "markdown", state: { mode: "preview", source: false, file: "eat/smashburger.md", scroll: 9 } };
  const leaf = {
    view: { file: { path: "eat/smashburger.md" } },
    getViewState: () => current,
    async setViewState(next) { this.next = next; },
  };
  app.workspace.getLeavesOfType = () => [leaf];
  assert.equal((await plugin.recordSheetOpenSource("eat/smashburger.md", 1)).ok, true);
  assert.deepEqual(leaf.next.state, { mode: "source", source: true, file: "eat/smashburger.md", scroll: 9 });
  assert.equal(current.state.source, false, "the saved return state is untouched");
});

test("Live Preview caches decorations across body edits and rebuilds on model changes", () => {
  const { plugin, doc } = fixture();
  const heading = "---\ntype: [[record]]\nparent: [[eat]]\nstatus: to_try\n---\n# Smashburger\nbody\n";
  const view = liveView(doc, "eat/smashburger.md", heading, true);
  const first = plugin.buildRecordSheetDecorations(view);
  const builds = plugin.recordSheetDomBuilds;
  assert.equal(first.length, 1);
  const again = plugin.buildRecordSheetDecorations(view);
  assert.equal(again, first);
  assert.equal(plugin.recordSheetDomBuilds, builds);
  view.state.doc = liveView(doc, "eat/smashburger.md", `${heading}more body\n`, true).state.doc;
  const bodyEdit = plugin.buildRecordSheetDecorations(view);
  assert.equal(bodyEdit, first);
  assert.equal(plugin.recordSheetDomBuilds, builds);
  plugin.recordSheetDay = "2026-11-18";
  plugin.refreshRecordSheetOverlay("eat/smashburger.md", { properties: { status: "loved" }, changedKeys: ["status"] });
  const overlayed = plugin.buildRecordSheetDecorations(view);
  assert.notEqual(overlayed, first);
  const widget = overlayed[0].deco.widget.toDOM();
  assert.match(widget.textContent, /Loved/);
  assert.equal(widget.querySelectorAll(".bob-record-sheet-row").some((row) => row.classList.contains("is-changed")), true);
  assert.equal(view.dom.classList.contains(HIDES), true);
});

test("Source mode stays native YAML and Live Preview restores after the switch", () => {
  const { plugin, doc, caches } = fixture();
  plugin.notebookCatalogLivePath = LedgerToolsPlugin.prototype.notebookCatalogLivePath;
  const text = "---\ntype: [[record]]\nparent: [[eat]]\n---\n# Smashburger\n";
  const source = liveView(doc, "eat/smashburger.md", text, false);
  assert.deepEqual(plugin.buildRecordSheetDecorations(source), Decoration.none);
  assert.equal(source.dom.classList.contains(helpers.RECORD_SHEET_SURFACE_CLASS), false);
  assert.equal(source.dom.classList.contains(HIDES), false);
  const live = liveView(doc, "eat/smashburger.md", text, true);
  const decorations = plugin.buildRecordSheetDecorations(live);
  assert.equal(decorations.length, 1);
  assert.equal(live.dom.classList.contains(helpers.RECORD_SHEET_SURFACE_CLASS), true);
  assert.equal(live.dom.classList.contains(HIDES), true);
  assert.equal(live.sourceView.classList.contains(HIDES), false);
  caches.get("eat/smashburger.md").frontmatter.type = "[[note]]";
  live.state.doc = liveView(doc, "eat/smashburger.md", "---\ntype: [[note]]\n---\n# Smashburger\n", true).state.doc;
  assert.deepEqual(plugin.buildRecordSheetDecorations(live), Decoration.none);
  assert.equal(live.dom.classList.contains(HIDES), false);
});

test("CodeMirror preserves mounted sheet ownership across focus-only class replacement", () => {
  const { plugin, doc, caches } = fixture();
  const text = "---\ntype: [[record]]\nparent: [[eat]]\n---\n# Smashburger\n";
  const view = liveView(doc, "eat/smashburger.md", text, true);
  const extension = plugin.createRecordSheetExtension();
  const instance = new extension.cls(view);
  const attributes = extension.options.provide();
  const expected = `${helpers.RECORD_SHEET_SURFACE_CLASS} ${HIDES}`;
  const builds = plugin.recordSheetDomBuilds;
  view.dom.setAttribute("class", "cm-editor cm-focused");
  instance.update({ view, focusChanged: true });
  assert.equal(attributes(view).class, expected);
  assert.equal(plugin.recordSheetDomBuilds, builds, "focus does not require a sheet rebuild");
  assert.equal(attributes(liveView(doc, "ordinary.md", "body", true)).class, undefined);

  caches.get("eat/smashburger.md").frontmatter.type = "[[note]]";
  plugin.buildRecordSheetDecorations(view);
  assert.deepEqual(attributes(view), {}, "gate loss releases CodeMirror ownership");
  caches.get("eat/smashburger.md").frontmatter.type = "[[record]]";
  plugin.buildRecordSheetDecorations(view);
  assert.equal(attributes(view).class, expected);
  instance.destroy();
  assert.deepEqual(attributes(view), {}, "destroy releases CodeMirror ownership");
  plugin.buildRecordSheetDecorations(view);
  plugin.teardownRecordSheet();
  assert.deepEqual(attributes(view), {}, "disable cannot leave hidden native fields");
});

test("Reading paints one owned sheet, ignores nested embeds, and cleans up on unload", () => {
  const { plugin, doc, flush } = fixture();
  const preview = node(doc, "div", "markdown-preview-view");
  preview.appendChild(node(doc, "h1", "", "Smashburger"));
  const chunk = node(doc, "p");
  preview.appendChild(chunk);
  const embed = node(doc, "div", "markdown-embed");
  const embedPreview = node(doc, "div", "markdown-preview-view");
  embedPreview.appendChild(node(doc, "h1", "", "Heat"));
  embed.appendChild(embedPreview);
  preview.appendChild(embed);
  const second = node(doc, "div", "markdown-preview-view");
  second.appendChild(node(doc, "h1", "", "Smashburger"));
  const children = [];
  plugin.renderRecordSheetInReading(preview, { sourcePath: "eat/smashburger.md", addChild: (child) => children.push(child) });
  plugin.renderRecordSheetInReading(chunk, { sourcePath: "eat/smashburger.md", addChild: (child) => children.push(child) });
  plugin.renderRecordSheetInReading(embedPreview, { sourcePath: "movies/heat.md", addChild: (child) => children.push(child) });
  plugin.renderRecordSheetInReading(second, { sourcePath: "eat/smashburger.md", addChild: (child) => children.push(child) });
  flush();
  assert.equal(preview.querySelectorAll(".bob-record-sheet").length, 2, "own sheet plus nested embed");
  assert.equal(embedPreview.querySelectorAll(".bob-record-sheet").length, 1);
  assert.equal(second.querySelectorAll(".bob-record-sheet").length, 1);
  assert.equal(preview.classList.contains(helpers.RECORD_SHEET_SURFACE_CLASS), true);
  assert.equal(preview.classList.contains(HIDES), true);
  assert.equal(second.classList.contains(HIDES), true);
  assert.equal(embed.classList.contains(HIDES), false, "embeds keep their own Properties");
  const detached = node(doc, "div");
  plugin.renderRecordSheetInReading(detached, { sourcePath: "eat/smashburger.md", addChild() {} });
  flush();
  assert.equal(detached.querySelectorAll(".bob-record-sheet").length, 0);
  children.filter((child) => child.containerEl === preview || child.containerEl === chunk)
    .forEach((child) => child.onunload());
  assert.equal(preview.querySelectorAll(".bob-record-sheet").length, 1, "embed sheet remains");
  assert.equal(embedPreview.querySelectorAll(".bob-record-sheet").length, 1);
  assert.equal(second.querySelectorAll(".bob-record-sheet").length, 1);
});

test("subscription header yields to the sheet, docks one timeline, and survives standalone cleanup", () => {
  const subscriptionReport = {
    ok: true, schema_version: 1, today: "2026-11-17", teaching_empty: false, command: "subscriptions",
    subscriptions: [{
      stem: "tunely", path: "subscriptions/tunely.md", title: "Tunely", cadence: "monthly",
      amount_cents: 999, monthly_cents: 999, next_expected: "2026-12-21",
      charges: { latest: { date: "2026-11-21" } },
      timeline: [
        { start: "2026-01-21", due: "2026-02-21", state: "charged" },
        { start: "2026-11-21", due: "2026-12-21", state: "charged" },
      ],
      findings: [],
    }],
    findings: [],
  };
  const { plugin, doc } = fixture({
    albums: [subscriptionsAlbum()],
    subscriptionReport,
  });
  const root = node(doc, "div", "markdown-preview-view");
  root.appendChild(node(doc, "h1", "", "Tunely"));
  const standalone = plugin.paintSubscriptionHeaderReading(root, "inbox.md");
  assert.equal(standalone, null);
  plugin.recordSheetActive = false;
  const header = plugin.paintSubscriptionHeaderReading(root, "subscriptions/tunely.md");
  assert.equal(header != null, true);
  assert.equal(root.querySelectorAll(".bob-subscription-header").length, 1);
  plugin.recordSheetActive = true;
  const sheet = plugin.paintRecordSheetReading(root, "subscriptions/tunely.md");
  plugin.paintSubscriptionHeaderReading(root, "subscriptions/tunely.md");
  assert.equal(sheet.querySelectorAll(".bob-subscription-header").length, 1);
  assert.equal(root.querySelectorAll(".bob-subscription-header").length, 1);
  assert.equal(sheet.querySelector(".bob-subscription-header").getAttribute("data-bob-record-sheet-band"), "true");
  helpers.albumCleanSubscriptionHeader(root);
  assert.equal(sheet.querySelectorAll(".bob-subscription-header").length, 1);
});

test("owned-path yield restores the standalone subscription header when the sheet unmounts", () => {
  const subscriptionReport = {
    ok: true, command: "subscriptions", subscriptions: [{
      path: "subscriptions/tunely.md", title: "Tunely", cadence: "monthly",
      amount_cents: 999, monthly_cents: 999, timeline: [{ start: "2026-01-21", due: "2026-02-21", state: "charged" }],
      charges: { latest: { date: "2026-11-21" } }, findings: [],
    }], findings: [],
  };
  const { plugin, doc, caches } = fixture({ albums: [subscriptionsAlbum()], subscriptionReport });
  const root = node(doc, "div", "markdown-preview-view");
  root.appendChild(node(doc, "h1", "", "Tunely"));
  plugin.paintRecordSheetReading(root, "subscriptions/tunely.md");
  assert.equal(plugin.recordSheetOwnsPath("subscriptions/tunely.md"), true);
  assert.equal(plugin.paintSubscriptionHeaderReading(root, "subscriptions/tunely.md"), null);
  caches.get("subscriptions/tunely.md").frontmatter.type = "[[note]]";
  plugin.paintRecordSheetReading(root, "subscriptions/tunely.md");
  assert.equal(plugin.recordSheetOwnsPath("subscriptions/tunely.md"), false);
  const restored = plugin.paintSubscriptionHeaderReading(root, "subscriptions/tunely.md");
  assert.equal(restored != null, true);
  assert.equal(root.querySelectorAll(".bob-subscription-header").length, 1);
});

test("hide class applies exactly when the gate is hide-eligible", () => {
  const { plugin, doc, caches } = fixture();
  const root = node(doc, "div", "markdown-preview-view");
  root.appendChild(node(doc, "h1", "", "Smashburger"));
  const sheet = plugin.paintRecordSheetReading(root, "eat/smashburger.md");
  assert.equal(plugin.recordSheetOwnsPath("eat/smashburger.md"), true);
  assert.equal(plugin.recordSheetGateFor("eat/smashburger.md").hideEligible, true);
  assert.equal(root.classList.contains(HIDES), true);
  assert.equal(sheet.classList.contains(HIDES), false);
  assert.equal(plugin.recordSheetEditorScopes.size, 0);
  const view = liveView(doc, "eat/smashburger.md", "---\ntype: [[record]]\nparent: [[eat]]\n---\n# Smashburger\n", true);
  plugin.buildRecordSheetDecorations(view);
  assert.equal(view.dom.classList.contains(HIDES), true);
  assert.equal(view.sourceView.classList.contains(HIDES), false);
  const edit = root.querySelector(".bob-record-sheet-edit");
  assert.equal(edit && edit.textContent, "⊞ Edit");
  caches.get("eat/smashburger.md").frontmatter.type = "[[note]]";
  assert.equal(plugin.paintRecordSheetReading(root, "eat/smashburger.md"), null);
  assert.equal(root.classList.contains(HIDES), false);
  plugin.teardownRecordSheet();
  assert.equal(plugin.recordSheetActive, false);
  assert.equal(view.dom.classList.contains(HIDES), false);
});

test("metadata edits on an open path refresh after eligibility is restored", () => {
  const { plugin } = fixture();
  let refreshes = 0;
  plugin.scheduleRecordSheetRefresh = () => { refreshes += 1; };
  const openPath = { view: { file: { path: "eat/smashburger.md" } } };
  plugin.app.workspace.getLeavesOfType = () => [openPath];
  assert.equal(plugin.recordSheetHasOpenPath("eat/smashburger.md"), true);
  plugin.recordSheetOnMetadata({ path: "eat/smashburger.md" });
  assert.equal(refreshes, 1);
  plugin.recordSheetOnMetadata({ path: "eat.md" });
  assert.equal(refreshes, 1);

  let editorRefreshes = 0;
  openPath.view.editor = { cm: { dispatch: () => { editorRefreshes += 1; } } };
  plugin.refreshRecordSheetEditors();
  assert.equal(editorRefreshes, 1);
});

test("Properties selectors follow the observed editor and Reading paths and leave embedded Properties visible", () => {
  const styles = fs.readFileSync(path.join(__dirname, "../plugins/bob-ledger-tools/styles.css"), "utf8");
  const editorProperties = `.cm-editor.${HIDES} > .cm-scroller > .cm-sizer > .metadata-container`;
  const editorTitle = `.cm-editor.${HIDES} > .cm-scroller > .cm-sizer > .inline-title`;
  const readingProperties = `.markdown-preview-view.${HIDES} > .markdown-preview-sizer > .mod-header > .metadata-container`;
  const readingTitle = `.markdown-preview-view.${HIDES} > .markdown-preview-sizer > .mod-header > .inline-title`;
  for (const selector of [editorProperties, readingProperties]) {
    assert.ok(styles.includes(`${selector} .metadata-property.bob-record-sheet-owned-property`));
    assert.ok(!styles.includes(`${selector},`) && !styles.includes(`${selector} {`),
      "the entire native Properties container must never be hidden");
  }
  for (const selector of [editorTitle, readingTitle]) {
    assert.ok(styles.includes(selector), `missing observed Properties selector: ${selector}`);
  }
  assert.ok(styles.includes(`.${HIDES} .markdown-embed .metadata-container:not(.is-collapsed)`),
    "expanded embedded Properties remain visible inside a hidden parent");
  for (const obsoleteSelector of [
    `.${HIDES} > .metadata-container`,
    `.markdown-source-view.${HIDES} > .metadata-container`,
    `.markdown-preview-view.${HIDES} > .metadata-container`,
    `.workspace-leaf-content.${HIDES} > .view-content > .metadata-container`,
    `.cm-editor.${HIDES} .metadata-container`,
  ]) {
    assert.doesNotMatch(styles, new RegExp(obsoleteSelector.replaceAll(".", "\\.").replaceAll(" ", "\\s+")),
      `obsolete direct or unbounded Properties selector remains: ${obsoleteSelector}`);
  }

  const editorWorld = fixture();
  const view = liveView(editorWorld.doc, "eat/smashburger.md", "---\ntype: [[record]]\nparent: [[eat]]\n---\n# Smashburger\n", true);
  editorWorld.plugin.buildRecordSheetDecorations(view);
  assert.equal(view.dom.classList.contains(HIDES), true, "Live Preview hide ownership sits on the observed .cm-editor");
  assert.equal(view.sourceView.classList.contains(HIDES), false, "the broader source view does not own the hide");
  assert.equal(view.dom.children[0], view.scroller);
  assert.equal(view.scroller.children[0], view.sizer);
  assert.equal(view.sizer.children[0].classList.contains("metadata-container"), true);

  const readingWorld = fixture();
  const preview = node(readingWorld.doc, "div", "markdown-preview-view");
  const sizer = node(readingWorld.doc, "div", "markdown-preview-sizer");
  const header = node(readingWorld.doc, "div", "mod-header mod-ui");
  const ownProperties = node(readingWorld.doc, "div", "metadata-container");
  const ownTitle = node(readingWorld.doc, "div", "inline-title");
  header.appendChild(ownProperties);
  header.appendChild(ownTitle);
  sizer.appendChild(header);
  preview.appendChild(sizer);
  const embed = node(readingWorld.doc, "div", "markdown-embed internal-embed");
  const embedPreview = node(readingWorld.doc, "div", "markdown-preview-view");
  const embedSizer = node(readingWorld.doc, "div", "markdown-preview-sizer");
  const embedHeader = node(readingWorld.doc, "div", "mod-header mod-ui");
  const embedProperties = node(readingWorld.doc, "div", "metadata-container");
  embedHeader.appendChild(embedProperties);
  embedSizer.appendChild(embedHeader);
  embedPreview.appendChild(embedSizer);
  embed.appendChild(embedPreview);
  sizer.appendChild(embed);
  readingWorld.plugin.paintRecordSheetReading(preview, "eat/smashburger.md");
  assert.equal(preview.classList.contains(HIDES), true, "the owning Reading surface receives the hide class");
  assert.equal(embedPreview.classList.contains(HIDES), false, "nested embedded notes never receive hide ownership");
  assert.equal(ownProperties.parentNode, header);
  assert.equal(embedProperties.parentNode, embedHeader);
  assert.equal(embedProperties.closest(".markdown-embed"), embed);
  const hover = node(readingWorld.doc, "div", "hover-popover");
  const hoverPreview = node(readingWorld.doc, "div", "markdown-preview-view");
  hover.appendChild(hoverPreview);
  readingWorld.plugin.paintRecordSheetReading(hoverPreview, "eat/smashburger.md");
  assert.equal(hoverPreview.classList.contains(HIDES), false, "hover previews keep their native Properties");
});

test("native Properties hides only card title/schema rows and restores them on eligibility loss", () => {
  for (const mode of ["live", "reading"]) {
    const { plugin, doc, caches } = fixture();
    const view = liveView(doc, "eat/smashburger.md", "---\ntype: [[record]]\nparent: [[eat]]\n---\n", true);
    const scope = mode === "live" ? view.dom : node(doc, "div", "markdown-preview-view");
    let properties = view.sizer.querySelector(".metadata-container");
    if (mode === "reading") {
      const sizer = scope.appendChild(node(doc, "div", "markdown-preview-sizer"));
      const header = sizer.appendChild(node(doc, "div", "mod-header"));
      properties = header.appendChild(node(doc, "div", "metadata-container"));
    }
    const addRow = (container, key) => {
      const row = container.appendChild(node(doc, "div", "metadata-property"));
      row.setAttribute("data-property-key", key);
      return row;
    };
    const keys = ["title", "status", "location", "visited", "parent", "type", "created", "old_place", "source_url", "unrecognized"];
    const rows = keys.map((key) => addRow(properties, key));
    const embed = properties.appendChild(node(doc, "div", "internal-embed"));
    const nestedRow = addRow(embed.appendChild(node(doc, "div", "metadata-container")), "status");
    const hoverRow = addRow(properties.appendChild(node(doc, "div", "hover-popover")), "status");
    const addButton = properties.appendChild(node(doc, "button", "metadata-add-button", "Add property"));
    const paint = () => mode === "live" ? plugin.buildRecordSheetDecorations(view)
      : plugin.paintRecordSheetReading(scope, "eat/smashburger.md");
    const hidden = () => rows.filter((row) => row.classList.contains("bob-record-sheet-owned-property"))
      .map((row) => row.getAttribute("data-property-key"));
    paint();
    assert.deepEqual(hidden(), ["title", "status", "location", "visited"], mode);
    assert.equal(nestedRow.classList.contains("bob-record-sheet-owned-property"), false);
    assert.equal(hoverRow.classList.contains("bob-record-sheet-owned-property"), false);
    assert.equal(addButton.classList.contains("bob-record-sheet-owned-property"), false);
    // Collapsing the sheet/fold does not expose duplicate schema fields.
    plugin.recordSheetSetCollapsed("eat/smashburger.md", true);
    plugin.recordSheetSetFold("eat/smashburger.md", true);
    paint();
    assert.deepEqual(hidden(), ["title", "status", "location", "visited"]);
    caches.get("eat/smashburger.md").frontmatter.type = "[[note]]";
    paint();
    assert.deepEqual(hidden(), [], "changing type restores every native row");
    assert.equal(plugin.recordSheetNativePropertiesScopes.size, 0);
  }
});

test("failed sheet construction keeps native properties visible and retries before hiding", () => {
  const { plugin, doc } = fixture();
  const view = liveView(doc, "eat/smashburger.md", "---\ntype: [[record]]\nparent: [[eat]]\n---\n", true);
  const properties = view.sizer.querySelector(".metadata-container");
  const row = properties.appendChild(node(doc, "div", "metadata-property"));
  row.setAttribute("data-property-key", "status");
  const build = plugin.recordSheetBuildMounted;
  plugin.recordSheetBuildMounted = () => null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    plugin.buildRecordSheetDecorations(view);
    assert.equal(view.dom.classList.contains(HIDES), false);
    assert.equal(row.classList.contains("bob-record-sheet-owned-property"), false);
  }
  plugin.recordSheetBuildMounted = build;
  assert.equal(plugin.buildRecordSheetDecorations(view).length, 1);
  assert.equal(view.dom.classList.contains(HIDES), true);
  assert.equal(row.classList.contains("bob-record-sheet-owned-property"), true);
});

test("late Properties replacements and renamed keys stay scoped and observers disconnect on teardown", () => {
  const { plugin, doc } = fixture();
  const observers = [];
  doc.defaultView = { MutationObserver: class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(scope, options) { this.scope = scope; this.options = options; }
    disconnect() { this.disconnected = true; }
  } };
  const view = liveView(doc, "eat/smashburger.md", "---\ntype: [[record]]\nparent: [[eat]]\n---\n", true);
  const initial = view.sizer.querySelector(".metadata-container");
  initial.remove();
  plugin.buildRecordSheetDecorations(view);
  assert.equal(observers.length, 1);
  assert.deepEqual(observers[0].options.attributeFilter, ["data-property-key"]);
  const properties = view.sizer.appendChild(node(doc, "div", "metadata-container"));
  const row = properties.appendChild(node(doc, "div", "metadata-property"));
  row.setAttribute("data-property-key", "status");
  observers[0].callback();
  assert.equal(row.classList.contains("bob-record-sheet-owned-property"), true);
  row.setAttribute("data-property-key", "unrelated");
  observers[0].callback();
  assert.equal(row.classList.contains("bob-record-sheet-owned-property"), false);
  row.setAttribute("data-property-key", "location");
  observers[0].callback();
  assert.equal(row.classList.contains("bob-record-sheet-owned-property"), true);
  properties.remove();
  observers[0].callback();
  assert.equal(row.classList.contains("bob-record-sheet-owned-property"), false, "detached rows lose ownership");
  view.sizer.appendChild(properties);
  observers[0].callback();
  plugin.teardownRecordSheet();
  assert.equal(observers[0].disconnected, true);
  assert.equal(row.classList.contains("bob-record-sheet-owned-property"), false);
  observers[0].callback();
  assert.equal(row.classList.contains("bob-record-sheet-owned-property"), false, "late callbacks cannot restore hiding");
});

test("old-bob and broken-schema sheets leave Properties visible", () => {
  const noCap = fixture({
    albums: [albumEntry()],
    reportExtra: { capabilities: [] },
  });
  const noCapRoot = node(noCap.doc, "div", "markdown-preview-view");
  noCapRoot.appendChild(node(noCap.doc, "h1", "", "Smashburger"));
  noCap.plugin.paintRecordSheetReading(noCapRoot, "eat/smashburger.md");
  assert.equal(noCap.plugin.recordSheetGateFor("eat/smashburger.md").hideEligible, false);
  assert.equal(noCap.plugin.recordSheetGateFor("eat/smashburger.md").reason, "no-capability");
  assert.equal(noCapRoot.classList.contains(HIDES), false);
  assert.equal(noCapRoot.querySelector(".bob-record-sheet-edit"), null);
  const broken = albumEntry({
    issues: [{ severity: "error", code: "album_schema_invalid", message: "bad schema", path: "eat.md", line: 1, suggestions: [] }],
    schema_fingerprint: "",
  });
  const brokenWorld = fixture({ albums: [broken] });
  const brokenRoot = node(brokenWorld.doc, "div", "markdown-preview-view");
  brokenRoot.appendChild(node(brokenWorld.doc, "h1", "", "Smashburger"));
  brokenWorld.plugin.paintRecordSheetReading(brokenRoot, "eat/smashburger.md");
  assert.equal(brokenWorld.plugin.recordSheetGateFor("eat/smashburger.md").hideEligible, false);
  assert.equal(brokenRoot.classList.contains(HIDES), false);
  assert.equal(brokenRoot.querySelector(".bob-record-sheet-edit"), null);
});

test("midnight rollover uses the plugin tick and never leaves a hanging timeout", () => {
  const { plugin, flush, timers } = fixture();
  const dateText = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  plugin.recordSheetToday = (now) => now ? dateText(now) : "2032-05-06";
  plugin.setupRecordSheet();
  assert.equal(plugin.recordSheetDay, "2032-05-06");
  assert.equal(plugin.recordSheetMidnightTimer == null || plugin.recordSheetMidnightTimer === undefined, true);
  assert.equal(plugin.refreshRecordSheetForRollover(new Date(2032, 4, 6, 12, 0, 0)), false);
  assert.equal(plugin.refreshRecordSheetForRollover(new Date(2032, 4, 7, 0, 1, 0)), true);
  assert.equal(plugin.recordSheetDay, "2032-05-07");
  assert.equal(timers.size > 0, true);
  plugin.teardownRecordSheet();
  flush();
  assert.equal(plugin.recordSheetActive, false);
  assert.equal(timers.size, 0);
});

test("Reading view fallback mounts frontmatter-only records once and merges with post-processing", async () => {
  const source = "---\ntype: [[record]]\nparent: [[eat]]\ntitle: Bare\n---\n";
  const { plugin, doc, app, flush } = fixture({
    extraCaches: { "eat/bare.md": { frontmatter: { type: "[[record]]", parent: "[[eat]]", title: "Bare" }, heading: "" } },
    sources: { "eat/bare.md": source },
  });
  const preview = node(doc, "div", "markdown-preview-view");
  const sizer = node(doc, "div", "markdown-preview-sizer");
  preview.appendChild(sizer);
  const view = { file: { path: "eat/bare.md" }, containerEl: preview, getMode: () => "preview" };
  app.workspace.getLeavesOfType = () => [{ view }];
  plugin.setupRecordSheet();

  await plugin.mountRecordSheetFrontmatterOnlyViews();
  assert.equal(sizer.querySelectorAll(".bob-record-sheet").length, 1);
  assert.equal(sizer.querySelector(".bob-record-sheet-title").textContent, "Bare");
  await plugin.mountRecordSheetFrontmatterOnlyViews();
  assert.equal(sizer.querySelectorAll(".bob-record-sheet").length, 1);

  const children = [];
  plugin.renderRecordSheetInReading(sizer, {
    sourcePath: "eat/bare.md",
    addChild(child) { children.push(child); },
  });
  flush();
  assert.equal(plugin.recordSheetReading.size, 1);
  assert.equal(sizer.querySelectorAll(".bob-record-sheet").length, 1);
  plugin.teardownRecordSheet();
  assert.equal(sizer.querySelectorAll(".bob-record-sheet").length, 0);
});

test("late timers after teardown do not paint, and YAML on a broken schema opens the album", async () => {
  const broken = albumEntry({
    issues: [{ severity: "error", code: "album_schema_invalid", message: "bad schema", path: "eat.md", line: 6, suggestions: [] }],
    schema_fingerprint: "",
  });
  const { plugin, doc, app, flush } = fixture({ albums: [broken] });
  const root = node(doc, "div", "markdown-preview-view");
  root.appendChild(node(doc, "h1", "", "Smashburger"));
  const sheet = plugin.paintRecordSheetReading(root, "eat/smashburger.md");
  assert.match(sheet.querySelector(".bob-record-sheet-warning").textContent, /bad schema/);
  const leaf = {
    view: { file: { path: "eat.md" }, editor: { setCursor() { leaf.cursor = arguments[0]; }, scrollIntoView() {} } },
    async openFile(file, state) { leaf.file = file; leaf.state = state; },
  };
  app.workspace.getLeavesOfType = () => [leaf];
  const result = await plugin.recordSheetJumpAlbumYaml("eat.md", 6);
  assert.equal(result.ok, true);
  assert.equal(leaf.cursor.line, 5);
  plugin.renderRecordSheetInReading(root, { sourcePath: "eat/smashburger.md", addChild() {} });
  plugin.teardownRecordSheet();
  flush();
  assert.equal(plugin.recordSheetActive, false);
});

test("row value text and access names describe the card action", () => {
  assert.equal(helpers.recordSheetAccessName("Status", "🔖 To try"), "Status: 🔖 To try. Change Status");
  assert.equal(helpers.recordSheetAccessName("Notes", ""), "Change Notes");
  assert.equal(helpers.recordSheetRowValueText({ state: "missing" }), "missing");
  assert.equal(
    helpers.recordSheetRowValueText({ state: "set", list: true, chips: [{ text: "a" }, { text: "b" }] }),
    "a, b",
  );
  assert.equal(
    helpers.recordSheetRowValueText({ state: "set", kind: "choice", chips: [{ text: "💚 Loved" }] }),
    "💚 Loved",
  );
  assert.equal(
    helpers.recordSheetRowValueText({ state: "set", spans: [{ text: "See " }, { text: "body", kind: "link" }] }),
    "See body",
  );
});

test("keyboard row targets retain a layout box and the shared field columns", () => {
  const styles = fs.readFileSync(path.join(__dirname, "../plugins/bob-ledger-tools/styles.css"), "utf8");
  const row = styles.match(/^\.bob-record-sheet-row\s*\{([^}]+)\}/m)?.[1];
  assert.ok(row, "the focusable row needs a layout rule");
  // A fake DOM accepts focus on display:contents; the real Electron proof rejected it.
  assert.match(row, /display:\s*grid\s*;/);
  assert.match(row, /grid-column:\s*1\s*\/\s*-1\s*;/);
  assert.match(row, /grid-template-columns:\s*subgrid\s*;/);
  assert.match(styles, /@media\s*\(max-width:\s*375px\)[\s\S]*?\.bob-record-sheet-row\s*\{\s*display:\s*block;/);
});

test("sheet affordances open the card: Edit, rows, chips, ghosts, missing", () => {
  const { plugin, doc } = fixture({
    extraCaches: {
      "eat/bare.md": { frontmatter: { type: "[[record]]", parent: "[[eat]]", title: "Bare" }, heading: "Bare" },
    },
  });
  const calls = [];
  plugin.openRecordCard = (options) => { calls.push(options); return { ok: true }; };
  const root = node(doc, "div", "markdown-preview-view");
  root.appendChild(node(doc, "h1", "", "Bare"));
  const sheet = plugin.paintRecordSheetReading(root, "eat/bare.md");
  const edit = sheet.querySelector(".bob-record-sheet-edit");
  assert.equal(edit && edit.textContent, "⊞ Edit");
  assert.equal(edit.getAttribute("title"), "Edit fields (==, Ctrl+Shift+P)");
  edit.click();
  assert.deepEqual(calls, [{ filePath: "eat/bare.md" }]);
  const rows = sheet.querySelectorAll(".bob-record-sheet-row");
  const statusRow = rows.find((row) => row.getAttribute("data-record-key") === "status");
  assert.equal(statusRow.getAttribute("role"), "button");
  assert.equal(statusRow.getAttribute("aria-haspopup"), "dialog");
  assert.match(statusRow.getAttribute("aria-label"), /Status: missing/);
  statusRow.click();
  assert.deepEqual(calls[1], { filePath: "eat/bare.md", field: "status" });
  statusRow.dispatchEvent({ type: "keydown", key: "Enter" });
  assert.deepEqual(calls[2], { filePath: "eat/bare.md", field: "status" });
  const pill = sheet.querySelector(".bob-record-sheet-missing");
  assert.equal(pill.getAttribute("data-record-key"), "status");
  pill.click();
  assert.deepEqual(calls[3], { filePath: "eat/bare.md", field: "status", stage: true });
  const ghost = sheet.querySelector(".bob-record-sheet-ghost");
  assert.equal(ghost.getAttribute("data-record-key"), "cuisine");
  assert.equal(ghost.getAttribute("aria-label"), "Add Cuisine");
  ghost.dispatchEvent({ type: "keydown", key: " " });
  assert.deepEqual(calls[4], { filePath: "eat/bare.md", field: "cuisine", stage: true });
  assert.equal(calls.length, 5);
});

test("value chips open the field stage; wikilinks keep navigation", () => {
  const { plugin, doc } = fixture();
  const calls = [];
  plugin.openRecordCard = (options) => { calls.push(options); return { ok: true }; };
  const root = node(doc, "div", "markdown-preview-view");
  root.appendChild(node(doc, "h1", "", "Smashburger"));
  const sheet = plugin.paintRecordSheetReading(root, "eat/smashburger.md");
  const chip = sheet.querySelector(".bob-record-sheet-chip");
  assert.equal(chip.getAttribute("data-record-key"), "status");
  chip.click();
  assert.deepEqual(calls, [{ filePath: "eat/smashburger.md", field: "status", stage: true }]);
  const rows = sheet.querySelectorAll(".bob-record-sheet-row");
  const locationRow = rows.find((row) => row.getAttribute("data-record-key") === "location");
  const link = locationRow.querySelector(".bob-record-sheet-link");
  assert.ok(link, "location renders a wikilink");
  link.click();
  assert.equal(calls.length, 1, "wikilink clicks navigate instead of opening the card");
});

test("stage:true resolves to the field stage kind", () => {
  const { plugin } = fixture();
  const model = plugin.recordSheetModelFor("eat/smashburger.md");
  assert.equal(plugin.recordCardRequestedStage(model, "status", true), "choices");
  assert.equal(plugin.recordCardRequestedStage(model, "visited", true), "date");
  assert.equal(plugin.recordCardRequestedStage(model, "status", undefined), null);
  assert.equal(plugin.recordCardRequestedStage(model, "status", "text"), "text");
  assert.equal(plugin.recordCardRequestedStage(model, "nope", true), null);
});

function walkFixture(total = 2) {
  const world = fixture();
  const { files, caches, app, plugin } = world;
  files.delete("eat/smashburger.md");
  for (let index = 0; index < total; index += 1) {
    const path = `eat/${index}.md`;
    files.set(path, { path, extension: "md" });
    caches.set(path, { frontmatter: { type: "[[record]]", parent: "[[eat]]", title: ["Alpha", "Bravo", "Charlie"][index] } });
  }
  files.get("eat.md").extension = "md";
  app.vault.getMarkdownFiles = () => [...files.values()];
  const lines = helpers.recordWalkRenderLines({ stem: "eat", title: "Restaurants" }, [...files.values()]
    .filter((file) => /^eat\//.test(file.path)).map((file) => ({ ...file, stem: file.path.slice(4, -3), title: caches.get(file.path).frontmatter.title })));
  const source = (index, line = lines[index]) => `---\ntype: "[[record]]"\nparent: "[[eat]]"\n---\n\n${line}\n\n## Notes\n`;
  plugin.recordSheetSourceCache = new Map(lines.map((line, index) => [`eat/${index}.md`, source(index)]));
  return { ...world, lines, source, walk: (index = 0) => plugin.recordWalkFor(`eat/${index}.md`, source(index)) };
}

function walkParagraph(doc, walk) {
  const paragraph = node(doc, "p");
  walk.writtenLinks.forEach((link, index) => {
    if (index) paragraph.appendChild(doc.createTextNode(" · "));
    const anchor = node(doc, "a", "internal-link", link.label);
    anchor.setAttribute("data-href", link.target);
    paragraph.appendChild(anchor);
  });
  return paragraph;
}

test("rail gives both two-record arms the written destination, names wrap, and paints location", () => {
  const { doc, walk } = walkFixture();
  const rail = helpers.recordWalkRailBuildEl(walk(), { hue: "blue" }, doc);
  assert.equal(rail.tagName, "NAV");
  assert.equal(rail.getAttribute("data-root-hue"), "blue");
  for (const direction of ["prev", "next"]) {
    const arm = rail.querySelector(`.is-${direction}`);
    assert.equal(arm.getAttribute("href"), "eat/1");
    assert.match(arm.getAttribute("aria-label"), /Bravo, 2 of 2 in Restaurants/);
  }
  assert.match(rail.querySelector(".is-prev").getAttribute("title"), /Wraps around to Bravo/);
  assert.equal(rail.querySelector(".bob-record-walk-count-wide").textContent, "1 of 2");
  assert.equal(rail.querySelector(".bob-record-walk-count-narrow").textContent, "1/2");
  assert.equal(rail.querySelector(".bob-record-walk-track").getAttribute("aria-hidden"), "true");
  assert.equal(rail.querySelector(".bob-record-walk-thumb").getAttribute("style"), "left: 25%");
  const last = helpers.recordWalkRailBuildEl(walk(1), {}, doc);
  assert.match(last.querySelector(".is-next").getAttribute("title"), /Wraps around to Alpha \(1 of 2\)/);
});

test("singleton, syncing, missing, and damaged rail states never invent a destination or count", () => {
  const solo = walkFixture(1);
  const singleton = helpers.recordWalkRailBuildEl(solo.walk(), {}, solo.doc);
  assert.equal(singleton.querySelectorAll(".bob-record-walk-arm").length, 0);
  assert.equal(singleton.querySelectorAll(".bob-record-walk-track").length, 0);
  assert.equal(singleton.querySelector(".bob-record-walk-count-wide").textContent, "1 of 1");
  const world = walkFixture(3);
  const stale = world.plugin.recordWalkFor("eat/0.md", world.source(0, world.lines[0].replace("eat/2", "eat/gone")));
  const rail = helpers.recordWalkRailBuildEl(stale, {}, world.doc);
  assert.equal(rail.getAttribute("data-walk-state"), "syncing");
  assert.equal(rail.querySelector(".is-prev").getAttribute("href"), "eat/gone");
  assert.equal(rail.querySelector(".bob-record-walk-count-wide").textContent, "⟳");
  assert.doesNotMatch(rail.textContent, /of 3|↺/);
  assert.equal(rail.querySelectorAll(".bob-record-walk-track").length, 0);
  for (const line of ["", `${world.lines[0]} prose`, `${world.lines[0]}\n${world.lines[0]}`]) {
    const model = world.plugin.recordWalkFor("eat/0.md", world.source(0, line));
    assert.equal(helpers.recordWalkRailBuildEl(model, {}, world.doc), null);
  }
});

test("Live Preview rail reveals raw line for any touching selection and survives sheet collapse", () => {
  const { plugin, doc, source } = walkFixture();
  const text = source(0);
  const view = liveView(doc, "eat/0.md", text);
  view.state.selection = { ranges: [{ from: text.length, to: text.length }] };
  const initial = plugin.buildRecordSheetDecorations(view);
  assert.equal(initial.length, 1);
  const replacement = initial.find((row) => row.deco.replace);
  assert.match(text.slice(replacement.from, replacement.to), /^\[\[eat\/1/);
  assert.equal(initial[0].from, replacement.from);
  assert.equal(initial[0].deco.widget.toDOM().querySelector(".bob-record-sheet").classList.contains("docks-record-walk"), true);
  assert.equal(plugin.buildRecordSheetDecorations(view), initial);
  for (const range of [
    { from: replacement.from, to: replacement.from },
    { from: replacement.to, to: replacement.to },
    { from: replacement.from - 1, to: replacement.to + 1 },
  ]) {
    view.state.selection.ranges = [{ from: text.length, to: text.length }, range];
    const revealed = plugin.buildRecordSheetDecorations(view);
    assert.equal(revealed.length, 1);
    assert.equal(revealed[0].deco.widget.toDOM().classList.contains("docks-record-walk"), false);
  }
  view.state.selection.ranges = [{ from: text.length, to: text.length }];
  plugin.recordSheetSetCollapsed("eat/0.md", true);
  assert.equal(plugin.buildRecordSheetDecorations(view)[0].deco.widget.toDOM().querySelectorAll(".bob-record-walk-rail").length, 1);
  assert.deepEqual(plugin.buildRecordSheetDecorations(liveView(doc, "eat/0.md", text, false)), []);
});

test("rail mounts with no album report, keeps moved lines, and follows selection-only updates", () => {
  const { plugin, doc, source, state, lines } = walkFixture();
  state.report = null;
  const text = source(0, `## Notes\n\nMoved prose\n\n${lines[0]}`);
  const view = liveView(doc, "eat/0.md", text);
  const extension = plugin.createRecordSheetExtension();
  const instance = new extension.cls(view);
  assert.equal(instance.decorations.length, 1);
  const row = instance.decorations[0];
  assert.equal(row.from, text.indexOf(lines[0]));
  view.state.selection = { ranges: [{ from: row.from, to: row.from }] };
  instance.update({ view, selectionSet: true });
  assert.equal(instance.decorations.length, 0);
});

test("Reading rail hides only its whole paragraph, stays on collapsed sheet, restores on teardown", () => {
  const { plugin, doc, walk, state } = walkFixture();
  const root = node(doc, "div", "markdown-preview-view");
  const paragraph = walkParagraph(doc, walk());
  const authored = walkParagraph(doc, walk());
  authored.appendChild(doc.createTextNode(" extra prose"));
  root.appendChild(paragraph);
  root.appendChild(authored);
  plugin.recordSheetSetCollapsed("eat/0.md", true);
  const sheet = plugin.paintRecordSheetReading(root, "eat/0.md");
  assert.equal(sheet.querySelectorAll(".bob-record-walk-rail").length, 1);
  assert.equal(paragraph.classList.contains("bob-record-walk-source"), true);
  assert.equal(authored.classList.contains("bob-record-walk-source"), false);
  plugin.paintRecordSheetReading(root, "eat/0.md");
  assert.equal(root.querySelectorAll(".bob-record-walk-rail").length, 1);
  state.report = null;
  plugin.paintRecordSheetReading(root, "eat/0.md");
  assert.equal(root.querySelectorAll(".bob-record-sheet").length, 0);
  assert.equal(root.querySelectorAll(".bob-record-walk-rail").length, 1);
  plugin.recordSheetRemoveReading(root, root, "eat/0.md");
  assert.equal(root.querySelectorAll(".bob-record-walk-rail").length, 0);
  assert.equal(paragraph.classList.contains("bob-record-walk-source"), false);
});

test("rail routes plain clicks through n commands and guards modified and fallback destinations", async () => {
  const { plugin, app, files, walk, doc } = walkFixture();
  const calls = [];
  const leaf = { view: { file: files.get("eat/0.md") } };
  app.workspace.getLeavesOfType = () => [leaf];
  app.workspace.setActiveLeaf = (active) => calls.push(["active", active.view.file.path]);
  app.workspace.openLinkText = async (...args) => calls.push(["open", ...args]);
  app.commands = { commands: { "bob-navigation-hotkeys:open-prev-link": {} }, executeCommandById: (id) => calls.push(["command", id]) };
  assert.equal(await plugin.recordWalkOpen("eat/1", "prev", "eat/0.md", {}), true);
  assert.deepEqual(calls.splice(0), [["active", "eat/0.md"], ["command", "bob-navigation-hotkeys:open-prev-link"]]);
  for (const event of [{ ctrlKey: true }, { metaKey: true }, { button: 1 }]) {
    await plugin.recordWalkOpen("eat/1", "prev", "eat/0.md", event);
    assert.deepEqual(calls.pop(), ["open", "eat/1", "eat/0.md", true]);
  }
  app.commands = null;
  await plugin.recordWalkOpen("eat/1", "prev", "eat/0.md", {});
  assert.deepEqual(calls.pop(), ["open", "eat/1", "eat/0.md", false]);
  files.delete("eat/1.md");
  assert.equal(await plugin.recordWalkOpen("eat/1", "prev", "eat/0.md", { button: 1 }), false);
  assert.match(TestNotice.messages.at(-1), /catching up/);
  assert.deepEqual(calls, []);
  let hover = null;
  let opened = null;
  const rail = helpers.recordWalkRailBuildEl({ ...walk(), ...{ lineState: "stale", lineIndex: 5, writtenPrev: { target: "eat/gone", label: "‹ Gone", stem: "gone" } } }, {
    handlers: { hoverLink: (...args) => { hover = args; }, walkOpen: (...args) => { opened = args; } },
  }, doc);
  const arm = rail.querySelector(".is-prev");
  arm.dispatchEvent({ type: "mouseover" });
  assert.equal(hover[2], "eat/gone");
  arm.dispatchEvent({ type: "auxclick", button: 1 });
  assert.equal(opened[0], "eat/gone");
  assert.equal(opened[1], "prev");
});

test("Reading source refresh ignores a late read invalidated by newer metadata", async () => {
  const { plugin, app, files } = walkFixture();
  plugin.recordSheetSourceCache.clear();
  plugin.recordSheetSourceFlights = new Map();
  const resolvers = [];
  app.vault.read = () => new Promise(resolve => resolvers.push(resolve));
  const old = plugin.recordSheetEnsureWalkSource("eat/0.md");
  await Promise.resolve();
  plugin.recordSheetOnMetadata(files.get("eat/0.md"));
  const current = plugin.recordSheetSourceFlights.get("eat/0.md");
  await Promise.resolve();
  resolvers[1]("new source");
  await current;
  resolvers[0]("stale source");
  await old;
  assert.equal(plugin.recordSheetSourceCache.get("eat/0.md"), "new source");
});
