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

function assertNoHide(root) {
  const walk = (node) => {
    if (node?.classList?.contains?.(HIDES)) assert.equal(HIDES, "absent");
    for (const child of node?.children || []) walk(child);
  };
  walk(root);
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
  sourceView.appendChild(root);
  return {
    path, dom: root, sourceView,
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
    parent: "breadcrumb", type: "identity", title: "heading", created: "footer",
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
  assertHomes(movie, { parent: "breadcrumb", type: "identity", title: "heading", status: "row", watched_on: "ghost", rating: "ghost" });

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
    parent: "breadcrumb", type: "identity", title: "heading",
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

test("title and created coverage follows H1 agreement, missing H1, and invalid dates", () => {
  const base = {
    type: "[[record]]", parent: "[[eat]]", title: "Smashburger", created: "2025-08-08", status: "to_try",
  };
  const match = modelFor("eat/smashburger.md", base, albumEntry(), { heading: "Smashburger" });
  assert.equal(match.coverage.title, "heading");
  assert.equal(match.fold.some((item) => item.key === "title"), false);
  const mismatch = modelFor("eat/smashburger.md", base, albumEntry(), { heading: "A burger" });
  assert.equal(mismatch.coverage.title, "fold");
  assert.match(mismatch.fold.find((item) => item.key === "title").lint, /heading/);
  const noH1 = modelFor("eat/smashburger.md", base, albumEntry(), { heading: "" });
  assert.equal(noH1.coverage.title, "fold");
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
  assertNoHide(root);
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
  assert.equal(view.sourceView.classList.contains(HIDES), false);
});

test("Source mode stays native YAML and Live Preview restores after the switch", () => {
  const { plugin, doc } = fixture();
  plugin.notebookCatalogLivePath = LedgerToolsPlugin.prototype.notebookCatalogLivePath;
  const text = "---\ntype: [[record]]\nparent: [[eat]]\n---\n# Smashburger\n";
  const source = liveView(doc, "eat/smashburger.md", text, false);
  assert.deepEqual(plugin.buildRecordSheetDecorations(source), Decoration.none);
  assert.equal(source.sourceView.classList.contains(helpers.RECORD_SHEET_SURFACE_CLASS), false);
  const live = liveView(doc, "eat/smashburger.md", text, true);
  const decorations = plugin.buildRecordSheetDecorations(live);
  assert.equal(decorations.length, 1);
  assert.equal(live.sourceView.classList.contains(helpers.RECORD_SHEET_SURFACE_CLASS), true);
  assert.equal(live.sourceView.classList.contains(HIDES), false);
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
  assertNoHide(preview);
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

test("hide class stays dormant even when the sheet is hide-eligible", () => {
  const { plugin, doc } = fixture();
  const root = node(doc, "div", "markdown-preview-view");
  root.appendChild(node(doc, "h1", "", "Smashburger"));
  const sheet = plugin.paintRecordSheetReading(root, "eat/smashburger.md");
  assert.equal(plugin.recordSheetOwnsPath("eat/smashburger.md"), true);
  assert.equal(plugin.recordSheetGateFor("eat/smashburger.md").hideEligible, true);
  assert.equal(root.classList.contains(HIDES), false);
  assert.equal(sheet.classList.contains(HIDES), false);
  assert.equal(plugin.recordSheetEditorScopes.size, 0);
  const view = liveView(doc, "eat/smashburger.md", "---\ntype: [[record]]\nparent: [[eat]]\n---\n# Smashburger\n", true);
  plugin.buildRecordSheetDecorations(view);
  assert.equal(view.sourceView.classList.contains(HIDES), false);
  plugin.teardownRecordSheet();
  assert.equal(plugin.recordSheetActive, false);
});

test("midnight rollover uses the plugin tick and never leaves a hanging timeout", () => {
  const { plugin, flush, timers } = fixture();
  plugin.setupRecordSheet();
  assert.equal(plugin.recordSheetMidnightTimer == null || plugin.recordSheetMidnightTimer === undefined, true);
  assert.equal(plugin.refreshRecordSheetForRollover(new Date(2026, 10, 17, 12, 0, 0)), false);
  plugin.recordSheetDay = "2026-11-17";
  assert.equal(plugin.refreshRecordSheetForRollover(new Date(2026, 10, 18, 0, 1, 0)), true);
  assert.equal(plugin.recordSheetDay, "2026-11-18");
  assert.equal(timers.size > 0, true);
  plugin.teardownRecordSheet();
  flush();
  assert.equal(plugin.recordSheetActive, false);
  assert.equal(timers.size, 0);
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
