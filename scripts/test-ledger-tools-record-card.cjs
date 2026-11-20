// Record Card shell, choices, discrete writes, close ladder, and YAML return.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin {
  constructor(app) { this.app = app; }
  registerEditorExtension() {}
  registerMarkdownPostProcessor() {}
  registerEvent() {}
  addCommand(command) { (this.commands ||= []).push(command); }
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
    this.value = "";
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
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  removeAttribute(name) { this.attrs.delete(name); }
  appendChild(node) { node.parentNode?.removeChild?.(node); node.parentNode = this; this.children.push(node); return node; }
  insertBefore(node, before) { node.parentNode?.removeChild?.(node); node.parentNode = this; const i = this.children.indexOf(before); this.children.splice(i < 0 ? this.children.length : i, 0, node); return node; }
  removeChild(node) { const i = this.children.indexOf(node); if (i >= 0) this.children.splice(i, 1); node.parentNode = null; return node; }
  empty() { while (this.firstChild) this.removeChild(this.firstChild); }
  remove() { this.parentNode?.removeChild?.(this); }
  addEventListener(type, fn, capture) { const key = capture ? `${type}:capture` : type; const rows = this.listeners.get(key) || []; rows.push(fn); this.listeners.set(key, rows); }
  removeEventListener(type, fn, capture) {
    const key = capture ? `${type}:capture` : type;
    const rows = this.listeners.get(key) || [];
    this.listeners.set(key, rows.filter((item) => item !== fn));
  }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  focus() { if (!this.disabled) this.ownerDocument.activeElement = this; }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  dispatchEvent(event) {
    const payload = event || {};
    if (!payload.target) payload.target = this;
    if (payload.capture === true && this.ownerDocument === this) {
      for (const callback of this.listeners.get(`${payload.type}:capture`) || []) callback(payload);
    }
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
      const attr = /^\[([\w-]+)(?:='([^']*)')?(?:="([^"]*)")?\]$/.exec(value);
      const taggedAttr = /^([a-z][\w-]*)\[([\w-]+)(?:='([^']*)')?(?:="([^"]*)")?\]$/i.exec(value);
      const hasAttr = (name, expected) => this.attrs.has(name) && (expected === undefined || expected === "" || this.getAttribute(name) === expected);
      return Boolean((cls && this.classList.contains(cls[1])) || (tag && this.tagName === tag[0].toUpperCase()) ||
        (attr && hasAttr(attr[1], attr[2] || attr[3])) ||
        (taggedAttr && this.tagName === taggedAttr[1].toUpperCase() && hasAttr(taggedAttr[2], taggedAttr[3] || taggedAttr[4])));
    });
  }
  closest(selector) { let node = this; while (node) { if (node.nodeType === 1 && node.matches(selector)) return node; node = node.parentNode; } return null; }
  querySelectorAll(selector) { const found = []; const walk = (node) => { for (const child of node.children || []) { if (child.matches(selector)) found.push(child); walk(child); } }; walk(this); return found; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function makeDoc() {
  const doc = {
    activeElement: null,
    listeners: new Map(),
    createElement(tag) { return new FakeNode(tag, this); },
    createTextNode(text) { return new FakeNode("", this, String(text)); },
    addEventListener(type, fn, capture) {
      const key = capture ? `${type}:capture` : type;
      const rows = this.listeners.get(key) || [];
      rows.push(fn);
      this.listeners.set(key, rows);
    },
    removeEventListener(type, fn, capture) {
      const key = capture ? `${type}:capture` : type;
      const rows = this.listeners.get(key) || [];
      this.listeners.set(key, rows.filter((item) => item !== fn));
    },
    dispatchEvent(event) {
      const payload = event || {};
      const key = payload.capture ? `${payload.type}:capture` : payload.type;
      for (const callback of this.listeners.get(`${payload.type}:capture`) || []) callback(payload);
      for (const callback of this.listeners.get(key) || []) callback(payload);
      return true;
    },
  };
  return doc;
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const CLOCK = { today: "2026-11-17", now: new Date(2026, 10, 17, 12, 0, 0) };
const choice = (value, label, count = 0) => ({ value, label, count });
const field = (key, kind, extra = {}) => ({
  key, label: extra.label || key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
  kind, required: extra.required === true, list: extra.list === true,
  choices: extra.choices || [], min: extra.min, max: extra.max, suggest: extra.suggest === true,
  values: extra.values,
});

function albumEntry(overrides = {}) {
  return {
    path: "eat.md", stem: "eat", title: "Restaurants", noun: "restaurant", emoji: "🍽️",
    summary: null, label: "Restaurant", plural: "restaurants", singular: "restaurant",
    dated_notes: false, legacy: [], schema_fingerprint: "sha256:eat",
    parent: "body", parent_kind: "area", owner: "body", root: "body",
    breadcrumb: ["Body"], group_field: "status", index_by: "status", index_facets: [],
    records: 1, groups: [], needs_status: 0, last_record: "eat/smashburger.md",
    index: { state: "current" }, issues: [], fields: [
      field("status", "choices", { required: true, choices: [
        choice("to_try", "🔖 To try", 4), choice("loved", "💚 Loved", 2),
        choice("skip", "Skip", 0), choice("closed", "Closed", 1),
        choice("maybe", "Maybe", 0), choice("later", "Later", 0),
        choice("c7", "Seven", 0), choice("c8", "Eight", 0), choice("c9", "Nine", 0),
        choice("c10", "Ten", 0),
      ] }),
      field("cuisine", "choices", { choices: [choice("burgers", "Burgers"), choice("pizza", "Pizza")] }),
      field("visited", "date"),
      field("url", "url"),
      field("notes", "text"),
    ],
    ...overrides,
  };
}

function reportOf(albums, extra = {}) {
  return helpers.albumIndexReport({
    schema_version: 1, ok: true, albums: Array.isArray(albums) ? albums : [albums],
    catalogs: [], counts: { albums: 1, records: 1, roots: 1 },
    capabilities: ["record_values_v1"],
    ...extra,
  });
}

function showReport(overrides = {}) {
  return {
    schema_version: 1,
    type: "eat",
    ok: true,
    fields: albumEntry().fields,
    record: {
      stem: "smashburger",
      path: "eat/smashburger.md",
      title: "Smashburger",
      heading: "Smashburger",
      fingerprint: "sha256:rec1",
      schema_fingerprint: "sha256:eat",
      frontmatter_end_line: 9,
      properties: [
        { key: "status", label: "Status", kind: "choices", required: true, state: "set", value: "to_try", display: "🔖 To try", line: 5 },
        { key: "cuisine", label: "Cuisine", kind: "choices", required: false, state: "none", value: null, display: "", line: null },
        { key: "visited", label: "Visited", kind: "date", required: false, state: "none", value: null, display: "", line: null },
        { key: "url", label: "Url", kind: "url", required: false, state: "set", value: "https://example.test", display: "https://example.test", line: 7 },
        { key: "notes", label: "Notes", kind: "text", required: false, state: "none", value: null, display: "", line: null },
      ],
      identity: [{ key: "parent", line: 2, value: "[[eat]]" }],
      other: [],
      findings: [],
      ...(overrides.record || {}),
    },
    ...overrides,
  };
}

function applyReport(overrides = {}) {
  return {
    schema_version: 1, command: "update", ok: true, dry_run: false,
    changed: ["status"], stem: "smashburger", path: "eat/smashburger.md",
    fingerprint_before: "sha256:rec1", fingerprint_after: "sha256:rec2",
    consequence: "Status 🔖 To try → 💚 Loved",
    inverse_ops: [{ op: "field.set", field: "status", value: "to_try" }],
    properties: [
      { key: "status", state: "set", value: "loved", display: "💚 Loved" },
    ],
    changes: [{ field: "status", from: "to_try", to: "loved" }],
    error: null,
    ...overrides,
  };
}

function fixture(options = {}) {
  TestNotice.messages = [];
  const albums = options.albums || [albumEntry()];
  const doc = makeDoc();
  const files = new Map();
  const caches = new Map();
  const add = (path, frontmatter, heading) => {
    files.set(path, { path });
    caches.set(path, { frontmatter, headings: heading ? [{ level: 1, heading }] : [] });
  };
  add("body.md", { type: "[[area]]", root_parent: true }, "Body");
  add("eat.md", { type: "[[album]]" }, "Restaurants");
  add("eat/smashburger.md", {
    type: "[[record]]", parent: "[[eat]]", title: "Smashburger",
    status: "to_try", url: "https://example.test",
  }, "Smashburger");
  add("inbox.md", { type: "[[note]]" }, "Inbox");
  for (const [path, cache] of Object.entries(options.extraCaches || {})) {
    add(path, cache.frontmatter || {}, cache.heading);
  }
  const leaves = [];
  const app = {
    document: doc,
    vault: {
      getAbstractFileByPath: (path) => files.get(path) || null,
      read: async (file) => options.sources?.[file?.path || file] || "---\nstatus: to_try\nurl: https://example.test\n---\n",
    },
    metadataCache: {
      getFirstLinkpathDest: (target) => files.get(`${String(target).replace(/\.md$/i, "")}.md`) || null,
      getFileCache: (file) => caches.get(file?.path) || null,
      on(event, fn) { (this._handlers ||= []).push({ event, fn }); return { unload() {} }; },
    },
    workspace: {
      trigger() {},
      getLeavesOfType: () => leaves,
      getMostRecentLeaf: () => leaves[0] || null,
      activeLeaf: null,
      openLinkText: async () => {},
    },
  };
  const plugin = new LedgerToolsPlugin(app);
  const state = { report: reportOf(albums, options.reportExtra), stale: false, generation: 1, reportGeneration: 1 };
  plugin.albumReportState = () => state;
  plugin.apiAlbumSubscribe = (fn) => { fn(state); return () => {}; };
  plugin.recordSheetActive = true;
  plugin.recordSheetDay = CLOCK.today;
  plugin.recordSheetDesktop = () => options.desktop !== false;
  plugin.albumHeaderDesktop = () => options.desktop !== false;
  plugin.albumDataActive = true;
  plugin.setupRecordUpdate();
  plugin.recordSheetOverlays = new Map();
  plugin.recordSheetPushOverlay = () => {};
  plugin.albumSetTimeout = (fn) => setTimeout(fn, 0);
  plugin.albumClearTimeout = (timer) => clearTimeout(timer);
  plugin.albumSchemaSaveOpenEditors = async () => ({ ok: true });
  plugin.openAlbumSchemaEntry = async (opts) => { plugin._schemaOpens = [...(plugin._schemaOpens || []), opts]; return { ok: true }; };
  plugin._shows = 0;
  plugin._previews = 0;
  plugin._applies = [];
  plugin.apiRecordShow = async () => {
    plugin._shows += 1;
    return options.show || { ok: true, report: showReport() };
  };
  plugin.apiRecordUpdatePreview = async () => { plugin._previews += 1; return { ok: true, report: applyReport({ dry_run: true }) }; };
  plugin.apiRecordUpdateApply = async (_type, _stem, envelope) => {
    plugin._applies.push(JSON.parse(envelope));
    return options.apply || { ok: true, report: applyReport() };
  };
  plugin.apiRecordUpdateCapable = () => options.capable !== false;
  plugin.getActiveMarkdownView = () => ({ file: { path: options.activePath || "eat/smashburger.md" } });
  const world = { app, caches, doc, files, plugin, state, leaves };
  return world;
}

function sheetModel(world, path = "eat/smashburger.md") {
  const cache = world.caches.get(path);
  const gate = helpers.recordSheetGate({
    path, frontmatter: cache.frontmatter, report: world.state.report, desktop: true,
    metadataCache: world.app.metadataCache, vault: world.app.vault,
  });
  return helpers.recordSheetModel({
    path, frontmatter: cache.frontmatter, report: world.state.report, heading: "Smashburger",
    clock: CLOCK, metadataCache: world.app.metadataCache, vault: world.app.vault, gate,
  });
}

async function openCard(options = {}) {
  const world = fixture(options);
  const opened = await world.plugin.openRecordCard({
    filePath: options.filePath || "eat/smashburger.md",
    field: options.field,
    stage: options.stage,
  });
  await pause(0);
  return { ...world, opened, modal: opened.modal };
}

function keyEvent(key, extra = {}) {
  return { type: "keydown", key, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...extra };
}

test("targets include ghosts in schema order and skip identity rows", () => {
  const world = fixture();
  const model = sheetModel(world);
  const targets = helpers.recordCardTargets(model, showReport());
  assert.deepEqual(targets.map((row) => row.key), ["status", "cuisine", "visited", "url", "notes"]);
  assert.equal(targets.find((row) => row.key === "cuisine").ghost, true);
  assert.equal(targets.find((row) => row.key === "status").ghost, false);
  assert.equal(helpers.recordCardOpeningSelection(targets, "visited"), "visited");
  assert.equal(helpers.recordCardOpeningSelection(targets.filter((row) => row.key !== "status"), ""), "cuisine");
  const missingRequired = [{ key: "status", required: true, state: "missing" }, { key: "notes", required: false, state: "none" }];
  assert.equal(helpers.recordCardOpeningSelection(missingRequired, ""), "status");
  assert.equal(helpers.recordCardOpeningSelection([], "status"), "");
  assert.equal(helpers.recordCardPreserveSelection(targets, "visited", 2), "visited");
  assert.equal(helpers.recordCardPreserveSelection(targets.filter((row) => row.key !== "visited"), "visited", 2), "url");
  assert.equal(helpers.recordCardNavigate(targets, "status", 1), "cuisine");
  assert.equal(helpers.recordCardNavigate(targets, "notes", 1), "status");
  assert.equal(helpers.recordCardHomeEnd(targets, "end"), "notes");
});

test("choice digits stay in schema order while filtering", () => {
  const field = albumEntry().fields[0];
  const all = helpers.recordCardChoiceList(field);
  assert.equal(all.length, 10);
  assert.equal(all[9].digit, null);
  assert.equal(helpers.recordCardChoiceByDigit(all, 2).value, "loved");
  const filtered = helpers.recordCardFilterChoices(all, "loved");
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].digit, 2);
  assert.equal(helpers.recordCardChoiceByDigit(filtered, 1), null);
  assert.equal(helpers.recordCardFilterChoices(all, "nope").length, 0);
  assert.equal(helpers.recordCardTodayValue(CLOCK), "2026-11-17");
  assert.match(helpers.recordCardRequiredClearMessage({ label: "Status", kind: "choices", field }), /Status is required — pick one of 10 choices/);
});

test("Ctrl+N/P helper accepts only the exact navigation chords", () => {
  const delta = helpers.recordCardCtrlNavDelta;
  assert.equal(delta({ key: "n", ctrlKey: true }), 1);
  assert.equal(delta({ key: "N", ctrlKey: true }), 1);
  assert.equal(delta({ key: "x", code: "KeyN", ctrlKey: true }), 1);
  assert.equal(delta({ key: "p", ctrlKey: true }), -1);
  assert.equal(delta({ key: "P", ctrlKey: true }), -1);
  assert.equal(delta({ key: "x", code: "KeyP", ctrlKey: true }), -1);
  for (const event of [
    { key: "n", ctrlKey: true, shiftKey: true },
    { key: "n", ctrlKey: true, altKey: true },
    { key: "n", ctrlKey: true, metaKey: true },
    { key: "n", metaKey: true },
    { key: "n" },
    { key: "n", ctrlKey: true, isComposing: true },
    null,
  ]) assert.equal(delta(event), 0);
});

test("Ctrl+N/P navigate record choices in inputs and browse rows", async () => {
  const { modal } = await openCard();
  try {
    modal.recordOpenStage("choices", "status");
    const input = modal.contentEl.querySelector("[data-record-input='choice-filter']");
    const originalFilter = input.value;
    let event = keyEvent("n", { ctrlKey: true, target: input });
    modal.recordOnKeyDown(event);
    assert.equal(modal.selectedChoice, "loved");
    assert.equal(event.defaultPrevented, true);
    assert.equal(input.value, originalFilter);
    event = keyEvent("p", { ctrlKey: true, target: input });
    modal.recordOnKeyDown(event);
    assert.equal(modal.selectedChoice, "to_try");
    event = keyEvent("p", { ctrlKey: true, target: input });
    modal.recordOnKeyDown(event);
    assert.equal(modal.selectedChoice, "c10", "choice navigation wraps backward");
    event = keyEvent("n", { ctrlKey: true, target: input });
    modal.recordOnKeyDown(event);
    assert.equal(modal.selectedChoice, "to_try", "choice navigation wraps forward");

    input.value = "love";
    input.dispatchEvent({ type: "input", target: input });
    modal.recordOnKeyDown(keyEvent("n", { ctrlKey: true, target: input }));
    assert.equal(modal.selectedChoice, "loved", "filter limits navigation to visible choices");

    for (const event of [
      keyEvent("N", { ctrlKey: true, shiftKey: true, target: input }),
      keyEvent("n", { ctrlKey: true, altKey: true, target: input }),
      keyEvent("n", { metaKey: true, target: input }),
    ]) {
      const before = modal.selectedChoice;
      modal.recordOnKeyDown(event);
      assert.equal(modal.selectedChoice, before);
      assert.equal(event.defaultPrevented, undefined);
    }

    modal.recordOnKeyDown(keyEvent("Escape", { target: input }));
    let outside = keyEvent("n", { ctrlKey: true, target: modal.contentEl });
    modal.recordOnKeyDown(outside);
    assert.equal(modal.selectedKey, "cuisine", "choice-stage navigation also works outside its input");
    assert.equal(outside.defaultPrevented, true);
    modal.recordSelect("notes");
    modal.recordOnKeyDown(keyEvent("n", { ctrlKey: true }));
    assert.equal(modal.selectedKey, "status", "browse navigation wraps and includes ghost rows");
    const back = keyEvent("p", { ctrlKey: true });
    modal.recordOnKeyDown(back);
    assert.equal(modal.selectedKey, "notes");
    assert.equal(back.defaultPrevented, true);
  } finally { modal.close(); }
});

test("Ctrl+N/P navigate suggestions while typed text keeps its native behavior", async () => {
  const { modal } = await openCard();
  try {
    modal.recordOpenStage("suggest", "notes");
    const input = modal.contentEl.querySelector("[data-record-input='stage-suggest']");
    const deltas = [];
    modal.recordMoveSuggest = (delta) => deltas.push(delta);
    const next = keyEvent("n", { ctrlKey: true, target: input });
    modal.recordOnKeyDown(next);
    assert.equal(next.defaultPrevented, true);
    assert.deepEqual(deltas, [1]);
    const previous = keyEvent("p", { ctrlKey: true, target: input });
    modal.recordOnKeyDown(previous);
    assert.equal(previous.defaultPrevented, true);
    assert.deepEqual(deltas, [1, -1]);
    modal.recordOnKeyDown(keyEvent("Escape", { target: input }));
    modal.recordOpenStage("text", "notes");
    const text = modal.contentEl.querySelector("[data-record-input='stage-text']");
    text.value = "draft";
    modal.stageDraftText = "draft";
    const native = keyEvent("n", { ctrlKey: true, target: text });
    modal.recordOnKeyDown(native);
    assert.equal(native.defaultPrevented, undefined);
    assert.equal(modal.stageDraftText, "draft");
  } finally { modal.close(); }
});

test("Esc ladder and status copy", () => {
  assert.equal(helpers.recordCardEscLadder({ pendingApply: true }), "ignore");
  assert.equal(helpers.recordCardEscLadder({ menuOpen: true }), "close-menu");
  assert.equal(helpers.recordCardEscLadder({ stage: { kind: "choices" } }), "cancel-stage");
  assert.equal(helpers.recordCardEscLadder({}), "close-card");
  assert.equal(helpers.recordCardStatusText({ statusKind: "reading" }), helpers.RECORD_CARD_READING_TEXT);
  assert.equal(helpers.recordCardStatusText({ statusKind: "saved" }), helpers.RECORD_CARD_SAVED_TEXT);
  assert.equal(helpers.recordCardStatusText({ statusKind: "stale" }), helpers.RECORD_CARD_STALE_TEXT);
  assert.equal(helpers.recordCardStatusText({ statusKind: "refusal", refusalMessage: "Nope", refusalHint: "hint" }), "Nope hint");
});

test("empty schema still offers YAML, schema, and close", async () => {
  const emptyAlbum = albumEntry({ fields: [] });
  const { modal } = await openCard({
    albums: [emptyAlbum],
    show: { ok: true, report: showReport({ fields: [], record: { properties: [] } }) },
  });
  await pause(0);
  assert.match(modal.contentEl.textContent, /declares no fields/);
  const actions = helpers.recordCardAllActions(modal.recordStatusModel()).map((row) => row.action);
  assert.equal(actions.includes("yaml"), true);
  assert.equal(actions.includes("schema"), true);
  assert.equal(actions.includes("close"), true);
  assert.equal(modal.recordSelected(), null);
});

test("palette on a non-record teaches and never guesses", async () => {
  const world = fixture({ activePath: "inbox.md" });
  const result = await world.plugin.openRecordCard();
  assert.equal(result.ok, false);
  assert.equal(result.reason, "other-type");
  assert.equal(TestNotice.messages.includes(helpers.RECORD_CARD_NON_RECORD_NOTICE), true);
});

test("mobile and missing report stay notices", async () => {
  const mobile = await fixture({ desktop: false }).plugin.openRecordCard({ filePath: "eat/smashburger.md" });
  assert.equal(mobile.reason, "mobile");
  const world = fixture({ reportExtra: { albums: [] } });
  world.state.report = helpers.albumIndexReport({ schema_version: 1, ok: true, albums: [], catalogs: [], counts: {}, capabilities: ["record_values_v1"] });
  const missing = await world.plugin.openRecordCard({ filePath: "eat/smashburger.md" });
  assert.equal(missing.ok, false);
});

test("opens cached rows, reads once, and waits for a fingerprint before writes", async () => {
  let resolveShow;
  const pending = new Promise((resolve) => { resolveShow = resolve; });
  const world = fixture();
  world.plugin.apiRecordShow = async () => { world.plugin._shows = (world.plugin._shows || 0) + 1; return pending; };
  const opened = await world.plugin.openRecordCard({ filePath: "eat/smashburger.md" });
  const modal = opened.modal;
  assert.ok(modal);
  // The species badge (sheet tile with the album emoji, word Record) leads
  // the header, so the h2 shows the title without the emoji.
  const badge = modal.contentEl.querySelector(".bob-property-card-identity");
  assert.equal(badge.getAttribute("data-card-kind"), "record");
  assert.equal(badge.querySelector(".bob-property-card-tile").getAttribute("data-tile-form"), "sheet");
  assert.equal(badge.querySelector(".bob-property-card-tile").textContent, "🍽️");
  assert.equal(badge.querySelector(".bob-property-card-identity-word").textContent, "Record");
  assert.equal(modal.contentEl.querySelector(".bob-record-card-title").textContent, "Smashburger");
  assert.match(modal.contentEl.textContent, /Restaurants › Restaurant · eat\/smashburger.md/);
  assert.match(modal.contentEl.textContent, /Reading record/);
  assert.equal(modal.writable, true);
  assert.equal(modal.session, null);
  assert.equal(world.plugin._shows, 1);
  const apply = await modal.recordApplyChoice("loved");
  assert.equal(apply, null);
  resolveShow({ ok: true, report: showReport() });
  await pause(0);
  assert.ok(modal.session);
  assert.equal(modal.statusKind === "reading", false);
});

test("broken schema and missing capability open read-only", async () => {
  const brokenAlbum = albumEntry({ schema_fingerprint: "", issues: [{ severity: "error", message: "bad schema", line: 3 }] });
  const broken = await openCard({ albums: [brokenAlbum] });
  assert.equal(broken.opened.readOnly, true);
  assert.match(broken.modal.contentEl.textContent, /bad schema|invalid/i);
  const oldBob = await openCard({ reportExtra: { capabilities: [] } });
  assert.equal(oldBob.opened.readOnly, true);
  assert.match(oldBob.modal.contentEl.textContent, /Update bob to edit here/);
});

test("choice click, Enter, and digit emit one field.set with no preview", async () => {
  const { plugin, modal } = await openCard();
  await pause(0);
  modal.recordSelect("status");
  await modal.recordApplyChoice("loved");
  assert.equal(plugin._previews || 0, 0);
  assert.equal(plugin._applies.length, 1);
  assert.deepEqual(plugin._applies[0].ops, [{ op: "field.set", field: "status", value: "loved" }]);
  assert.equal(plugin._applies[0].expect, "sha256:rec1");
  assert.match(modal.contentEl.textContent, /Saved/);
  modal.recordOnKeyDown(keyEvent("2"));
  await pause(0);
  assert.equal(plugin._applies.length, 2);
});

test("today, optional clear, and required-clear refusal", async () => {
  const { plugin, modal } = await openCard();
  await pause(0);
  plugin.apiRecordUpdateApply = async (_type, _stem, envelope) => {
    plugin._applies.push(JSON.parse(envelope));
    return { ok: true, report: applyReport({ changed: ["visited"], inverse_ops: [{ op: "field.unset", field: "visited" }] }) };
  };
  modal.recordSelect("visited");
  await modal.recordApplyToday();
  assert.deepEqual(plugin._applies.at(-1).ops, [{ op: "field.set", field: "visited", value: "2026-11-17" }]);
  plugin._applies = [];
  modal.recordSelect("url");
  plugin.apiRecordUpdateApply = async (_type, _stem, envelope) => {
    plugin._applies.push(JSON.parse(envelope));
    return { ok: true, report: applyReport({ changed: ["url"], inverse_ops: [{ op: "field.set", field: "url", value: "https://example.test" }] }) };
  };
  await modal.recordClear();
  assert.deepEqual(plugin._applies.at(-1).ops, [{ op: "field.unset", field: "url" }]);
  plugin._applies = [];
  modal.recordSelect("status");
  await modal.recordClear();
  assert.equal(plugin._applies.length, 0);
  assert.match(modal.contentEl.textContent, /Status is required/);
});

test("no-op does not manufacture a save; stale keeps the draft for retry", async () => {
  const { plugin, modal } = await openCard({
    apply: { ok: true, report: applyReport({ changed: [] }) },
  });
  await pause(0);
  await modal.recordApplyChoice("to_try");
  assert.equal(modal.contentEl.textContent.includes("✓ Saved"), false);
  plugin.apiRecordUpdateApply = async () => ({
    ok: false, kind: "stale", code: "stale_record",
    message: "stale", report: { error: { code: "stale_record" }, record: { fingerprint: "sha256:new" } },
  });
  await modal.recordApplyChoice("loved");
  assert.match(modal.contentEl.textContent, /changed elsewhere/);
  assert.ok(modal.retainedOps);
});

test("typed external refresh holds the draft and stale warning until an explicit retry", async () => {
  const { plugin, modal } = await openCard();
  try {
    modal.recordOpenStage("text", "notes");
    modal.stageDraftText = "Keep my draft";
    modal.recordTypedInput();
    await modal.session.previewNow();
    assert.equal(modal.session.getState().canApply, true);
    const ops = modal.session.getState().draftOps;
    const changed = showReport();
    changed.record.fingerprint = "sha256:external";
    plugin.apiRecordShow = async () => ({ ok: true, report: changed });
    await modal.recordRefresh({ keepStage: true });
    assert.equal(modal.statusKind, "stale");
    assert.equal(modal.stageDraftText, "Keep my draft");
    assert.deepEqual(modal.retainedOps, ops);
    assert.equal(modal.session.getState().canApply, false);
    assert.match(modal.contentEl.textContent, /changed elsewhere/);
    const previews = plugin._previews;
    await modal.recordRefresh({ keepStage: true });
    await pause(300);
    assert.equal(modal.statusKind, "stale", "report notifications must not erase the warning");
    assert.equal(plugin._previews, previews, "refresh must not re-preview the retained intent");
    assert.equal(plugin._applies.length, 0);
    const input = modal.contentEl.querySelector("[data-record-input='stage-text']");
    modal.recordOnKeyDown(keyEvent("Enter", { target: input }));
    await modal.session.previewNow();
    assert.notEqual(modal.statusKind, "stale");
    assert.equal(modal.session.getState().canApply, true);
    assert.equal(plugin._applies.length, 0, "retry previews before the next explicit save");
    await modal.recordSaveTyped(0);
    assert.equal(plugin._applies.length, 1);
    assert.equal(plugin._applies[0].expect, "sha256:external");
    assert.deepEqual(plugin._applies[0].ops, ops);
  } finally { modal.close(); }
});

test("unchanged refresh preserves a current typed preview and one Tab advance", async () => {
  const { plugin, modal } = await openCard();
  try {
    modal.recordOpenStage("url", "url");
    modal.stageDraftText = "https://changed.test";
    modal.recordTypedInput();
    await modal.session.previewNow();
    const before = modal.session.getState();
    await modal.recordRefresh({ keepStage: true });
    assert.equal(modal.session.getState().canApply, true);
    assert.equal(modal.session.getState().revision, before.revision);
    assert.notEqual(modal.statusKind, "stale");
    assert.equal(modal.stageDraftText, "https://changed.test");
    await modal.recordTab(1);
    assert.equal(plugin._applies.length, 1);
    assert.equal(modal.selectedKey, "notes");
  } finally { modal.close(); }
});

test("typed writer stale refusal cancels queued Tab and stays visible after refresh", async () => {
  const { plugin, modal } = await openCard();
  try {
    modal.recordOpenStage("url", "url");
    modal.stageDraftText = "https://changed.test";
    modal.recordTypedInput();
    await modal.session.previewNow();
    const changed = showReport();
    changed.record.fingerprint = "sha256:external";
    plugin.apiRecordShow = async () => ({ ok: true, report: changed });
    plugin.apiRecordUpdateApply = async () => ({ ok: false, kind: "stale", code: "stale_record",
      report: { error: { code: "stale_record" }, record: { fingerprint: "sha256:external" } } });
    await modal.recordTab(1);
    await pause(300);
    assert.equal(modal.statusKind, "stale");
    assert.equal(modal.pendingTab, null);
    assert.equal(modal.selectedKey, "url");
    assert.equal(modal.stageDraftText, "https://changed.test");
    assert.ok(modal.retainedOps);
    assert.equal(modal.session.getState().canApply, false);
    assert.match(modal.contentEl.textContent, /changed elsewhere/);
  } finally { modal.close(); }
});

test("unchanged refresh preserves a queued Tab while its real session previews", async () => {
  const { plugin, modal } = await openCard();
  let release;
  plugin.apiRecordUpdatePreview = () => new Promise(resolve => { release = resolve; });
  try {
    modal.recordOpenStage("url", "url");
    modal.stageDraftText = "https://changed.test";
    modal.recordTypedInput();
    const preview = modal.session.previewNow();
    await modal.recordTab(1);
    await modal.recordRefresh({ keepStage: true });
    assert.equal(modal.pendingTab?.field, "url");
    release({ ok: true, report: applyReport({ dry_run: true }) });
    await preview;
    await pause(20);
    assert.equal(plugin._applies.length, 1);
    assert.equal(modal.selectedKey, "notes");
  } finally { modal.close(); }
});

test("double Enter and in-flight apply latch", async () => {
  let resolveApply;
  const { modal } = await openCard();
  await pause(0);
  modal.recordPlugin.apiRecordUpdateApply = () => new Promise((resolve) => { resolveApply = resolve; });
  const first = modal.recordApplyChoice("loved");
  const second = modal.recordApplyChoice("skip");
  assert.equal(await second, null);
  resolveApply({ ok: true, report: applyReport() });
  await first;
});

test("IME and filter typing never navigate or apply", async () => {
  const { modal } = await openCard();
  await pause(0);
  modal.recordOpenStage("choices", "status");
  const input = modal.contentEl.querySelector("[data-record-input='choice-filter']");
  assert.ok(input);
  input.value = "j";
  input.dispatchEvent({ type: "input", target: input });
  modal.recordOnKeyDown(keyEvent("j", { target: input }));
  assert.equal(modal.selectedKey, "status");
  modal.recordOnKeyDown(keyEvent("1", { target: input, isComposing: true }));
  modal.recordOnKeyDown(keyEvent("1", { keyCode: 229 }));
});

test("Undo uses the stored inverse and survives close/reopen", async () => {
  const { plugin, modal } = await openCard();
  await pause(0);
  await modal.recordApplyChoice("loved");
  const undo = plugin.recordUpdateLastUndo("eat/smashburger.md");
  assert.ok(undo);
  plugin.apiRecordUpdateApply = async (_type, _stem, envelope) => {
    plugin._undoEnvelope = JSON.parse(envelope);
    return { ok: true, report: applyReport({ changed: ["status"], fingerprint_after: "sha256:rec3", inverse_ops: [] }) };
  };
  await modal.recordUndo();
  assert.deepEqual(plugin._undoEnvelope.ops, [{ op: "field.set", field: "status", value: "to_try" }]);
  modal.close();
  const again = await plugin.openRecordCard({ filePath: "eat/smashburger.md" });
  await pause(0);
  assert.ok(plugin.recordUpdateLastUndo("eat/smashburger.md"));
  again.modal.close();
});

test("refresh keeps selection and filter; late reads after close are ignored", async () => {
  let resolveShow;
  const { plugin, modal } = await openCard();
  await pause(0);
  modal.recordSelect("visited");
  modal.recordOpenStage("choices", "status");
  modal.choiceFilter = "love";
  plugin.apiRecordShow = () => new Promise((resolve) => { resolveShow = resolve; });
  const pending = modal.recordRead();
  modal.close();
  resolveShow({ ok: true, report: showReport({ record: { fingerprint: "sha256:late" } }) });
  await pending;
  assert.equal(modal.closed, true);
  assert.equal(modal.session, null);
});

test("Esc/q/Ctrl+[ climb menu then stage then card; q types in the filter", async () => {
  const { modal } = await openCard();
  await pause(0);
  modal.menuOpen = true;
  assert.equal(modal.recordHandleEscape(), "stay");
  assert.equal(modal.menuOpen, false);
  modal.recordOpenStage("choices", "status");
  assert.equal(modal.recordHandleEscape(), "stay");
  assert.equal(modal.stage, null);
  const behind = { received: false };
  const event = keyEvent("q");
  event.target = { closest: () => null };
  modal.recordBackOut(event);
  assert.equal(event.stopped, true);
  assert.equal(modal.closed, true);
  const world = await openCard();
  await pause(0);
  world.modal.recordOpenStage("choices", "status");
  const input = world.modal.contentEl.querySelector("[data-record-input='choice-filter']");
  world.modal.recordOnKeyDown(keyEvent("q", { target: input }));
  assert.equal(world.modal.closed, false);
  world.modal.onEscapeKey(keyEvent("Escape"));
  assert.equal(world.modal.stage, null);
});

test("= closes before schema; YAML Done restores and reopens the same field", async () => {
  const { plugin, modal, leaves, files } = await openCard();
  await pause(0);
  let state = { type: "markdown", state: { mode: "source", source: false } };
  const leaf = {
    view: {
      file: files.get("eat/smashburger.md"), editor: { setCursor() {}, scrollIntoView() {} }, save: async () => {},
      getState: () => state.state,
      setState: async (next) => { state = { ...state, state: next }; },
    },
    getViewState: () => state,
    setViewState: async (next) => { state = next; leaf.restored = next; },
    openFile: async (_file, options) => { state = { ...state, state: { ...state.state, ...options.state } }; },
  };
  leaves.push(leaf);
  plugin.app.workspace.activeLeaf = leaf;
  modal.recordSelect("url");
  await modal.recordSchema();
  assert.equal(modal.closed, true);
  assert.deepEqual(plugin._schemaOpens[0], { filePath: "eat/smashburger.md", field: "url" });
  const opened = await plugin.openRecordCard({ filePath: "eat/smashburger.md", field: "url" });
  await pause(0);
  await opened.modal.recordYaml();
  const excursion = plugin.albumYamlExcursionForLeaf(leaf);
  assert.equal(excursion.kind, "record");
  assert.equal(excursion.recordPath, "eat/smashburger.md");
  assert.equal(helpers.albumYamlExcursionOwnPath(excursion), "eat/smashburger.md");
  assert.equal(state.state.source, true, "YAML opens raw Source even when starting in Live Preview");
  const done = await plugin.albumYamlDone({ leaf });
  assert.equal(done.ok, true);
  assert.equal(done.reopened, true);
  assert.equal(plugin.recordCardModal.selectedKey, "url");
  assert.equal(state.state.source, false, "Done restores Live Preview");
});

test("live region announces selection and save; labels stay text", async () => {
  const world = fixture();
  const model = sheetModel(world);
  const card = helpers.recordCardBuildEl(model, {
    selectedKey: "status",
    targets: helpers.recordCardTargets(model, showReport()),
    status: { statusKind: "saved", writable: true, target: { key: "status", kind: "choices", field: albumEntry().fields[0] } },
    announce: "Saved",
  }, makeDoc());
  assert.equal(helpers.recordCardRegion(card, "live").textContent, "Saved");
  assert.match(card.textContent, /Status/);
  assert.equal(card.innerHTML, undefined);
});

test("teardown closes the card and ignores late callbacks", async () => {
  const { plugin, modal } = await openCard();
  await pause(0);
  plugin.teardownRecordCard();
  assert.equal(modal.closed, true);
  assert.equal(plugin.recordCardModal, null);
});

test("typed previews and saves waiting for preview never claim a writer is saving", async () => {
  const { plugin, modal } = await openCard();
  let releasePreview;
  plugin.apiRecordUpdatePreview = () => new Promise(resolve => { releasePreview = resolve; });
  try {
    modal.recordOpenStage("text", "notes");
    modal.stageDraftText = "A new note";
    modal.recordTypedInput();
    assert.equal(modal.pendingApply, false);
    assert.equal(modal.statusKind, "previewing");
    assert.match(modal.contentEl.textContent, /Checking value…/);
    assert.doesNotMatch(modal.contentEl.textContent, /Saving…/);
    const result = await modal.recordSaveTyped(0);
    assert.equal(result.code, "preview-pending");
    assert.equal(modal.statusKind, "previewing");
    assert.equal(plugin._applies.length, 0);
    assert.equal(helpers.recordCardStatusText({statusKind:"saving",pendingApply:true}), "Saving…");
    modal.stageDraftText = "";
    modal.recordTypedInput();
    assert.equal(modal.statusKind, "", "returning to the seed clears the preview label");
    modal.stageDraftText = "Another note";
    modal.recordTypedInput();
    modal.recordCancelStage();
    assert.equal(modal.statusKind, "", "cancel clears the preview label");
  } finally {
    modal.close();
    releasePreview?.({ok:false,message:"Test closed"});
  }
});

async function untilCard(predicate) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return;
    await pause(5);
  }
  assert.ok(predicate(), "Record Card did not settle");
}

for (const previewReady of [false, true]) {
  for (const direction of [1, -1]) {
    test(`typed Tab advances once after ${previewReady ? "ready" : "pending"} preview, direction ${direction}`, async () => {
      const { plugin, modal } = await openCard();
      let releasePreview;
      plugin.apiRecordUpdatePreview = () => new Promise(resolve => { releasePreview = resolve; });
      const report = applyReport({ changed: ["url"], properties: showReport().record.properties.map(p =>
        p.key === "url" ? { ...p, value: "https://example.test/new", display: "https://example.test/new" } : p) });
      plugin.apiRecordUpdateApply = async (_type, _stem, envelope) => {
        plugin._applies.push(JSON.parse(envelope));
        return { ok: true, report };
      };
      try {
        modal.recordOpenStage("url", "url");
        modal.stageDraftText = "https://example.test/new";
        modal.recordTypedInput();
        await untilCard(() => Boolean(releasePreview));
        if (previewReady) {
          releasePreview({ ok: true, report: { ...report, dry_run: true } });
          await untilCard(() => modal.sessionState?.canApply);
        }
        await modal.recordTab(direction);
        if (!previewReady) {
          assert.equal(plugin._applies.length, 0, "pending preview cannot write");
          releasePreview({ ok: true, report: { ...report, dry_run: true } });
        }
        await untilCard(() => plugin._applies.length === 1 && !modal.pendingApply);
        assert.equal(modal.selectedKey, direction === 1 ? "notes" : "visited");
        assert.deepEqual(modal.stage, { field: modal.selectedKey, kind: direction === 1 ? "text" : "date" });
        assert.equal(modal.pendingTab, null);
        assert.equal(plugin._applies.length, 1);
        assert.ok(plugin._applies[0].expect);
        assert.deepEqual(plugin._applies[0].ops, [{ op: "field.set", field: "url", value: "https://example.test/new" }]);
      } finally { modal.close(); }
    });
  }
}

test("choice Tab advances exactly once after its guarded save", async () => {
  const { plugin, modal } = await openCard();
  try {
    modal.recordOpenStage("choices", "status");
    modal.selectedChoice = "loved";
    await modal.recordTab(1);
    assert.equal(plugin._applies.length, 1);
    assert.equal(modal.selectedKey, "cuisine");
    assert.deepEqual(modal.stage, { field: "cuisine", kind: "choices" });
  } finally { modal.close(); }
});

test("canceling a pending Tab preview prevents its late save and advance", async () => {
  const { plugin, modal } = await openCard();
  let releasePreview;
  plugin.apiRecordUpdatePreview = () => new Promise(resolve => { releasePreview = resolve; });
  try {
    modal.recordOpenStage("url", "url");
    modal.stageDraftText = "https://example.test/new";
    modal.recordTypedInput();
    await untilCard(() => Boolean(releasePreview));
    await modal.recordTab(1);
    modal.recordCancelStage();
    releasePreview({ ok: true, report: applyReport({ dry_run: true }) });
    await pause(20);
    assert.equal(plugin._applies.length, 0);
    assert.equal(modal.selectedKey, "url");
    assert.equal(modal.stage, null);
    assert.equal(modal.pendingTab, null);
  } finally { modal.close(); }
});

for (const direction of [0, 1, -1]) {
  test(`saving an already refused preview keeps the refusal, direction ${direction}`, async () => {
    const { plugin, modal } = await openCard();
    const refusal = { ok: false, code: "invalid_value", message: "This value is not allowed." };
    plugin.apiRecordUpdatePreview = async () => {
      plugin._previews += 1;
      return refusal;
    };
    try {
      modal.recordOpenStage("text", "notes");
      modal.stageDraftText = "Rejected draft";
      modal.recordTypedInput();
      await modal.session.previewNow();
      assert.equal(modal.sessionState.status, "refused");
      assert.equal(modal.statusKind, "refusal");
      const previews = plugin._previews;
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await modal.recordSaveTyped(direction);
        assert.equal(modal.statusKind, "refusal", "a settled refusal is not a pending preview");
        assert.equal(result.code, refusal.code);
        assert.match(modal.contentEl.textContent, /This value is not allowed/);
        assert.doesNotMatch(modal.contentEl.textContent, /Checking value|Saving/);
        assert.equal(modal.pendingTab, null);
        assert.equal(modal.stageDraftText, "Rejected draft");
        assert.deepEqual(modal.stage, { kind: "text", field: "notes" });
        assert.equal(plugin._applies.length, 0);
      }
      assert.equal(plugin._previews, previews, "save must not schedule repeated refused previews");
      plugin.apiRecordUpdatePreview = async () => ({ ok: true, report: applyReport({ dry_run: true }) });
      modal.stageDraftText = "Corrected draft";
      modal.recordTypedInput();
      await modal.session.previewNow();
      assert.equal(modal.sessionState.canApply, true);
      assert.notEqual(modal.statusKind, "refusal", "editing can recover with a fresh valid preview");
      assert.equal(plugin._applies.length, 0, "the refused Tab must not apply a later corrected draft");
    } finally { modal.close(); }
  });
}

test("refused typed Tab keeps its draft without advancing", async () => {
  const { plugin, modal } = await openCard({ apply: { ok: false, code: "invalid", message: "Refused" } });
  try {
    modal.recordOpenStage("url", "url");
    modal.stageDraftText = "https://example.test/new";
    modal.recordTypedInput();
    await untilCard(() => modal.sessionState?.canApply);
    await modal.recordTab(1);
    assert.equal(plugin._applies.length, 1);
    assert.equal(modal.selectedKey, "url");
    assert.deepEqual(modal.stage, { field: "url", kind: "url" });
    assert.equal(modal.stageDraftText, "https://example.test/new");
    assert.equal(modal.statusKind, "refusal");
    assert.equal(modal.pendingTab, null);
  } finally { modal.close(); }
});

test("Escape during a Tab apply respects the write lock and advances once on completion", async () => {
  const { plugin, modal } = await openCard();
  let finishApply;
  plugin.apiRecordUpdateApply = async (_type, _stem, envelope) => {
    plugin._applies.push(JSON.parse(envelope));
    return new Promise(resolve => { finishApply = resolve; });
  };
  try {
    modal.recordOpenStage("url", "url");
    modal.stageDraftText = "https://example.test/new";
    modal.recordTypedInput();
    await untilCard(() => modal.sessionState?.canApply);
    const saving = modal.recordTab(1);
    await untilCard(() => Boolean(finishApply));
    modal.recordBackOut(keyEvent("Escape"));
    assert.deepEqual(modal.stage, { field: "url", kind: "url" }, "Escape is ignored while the writer is in flight");
    finishApply({ ok: true, report: applyReport({ changed: ["url"] }) });
    await saving;
    assert.equal(plugin._applies.length, 1);
    assert.equal(modal.selectedKey, "notes");
    assert.deepEqual(modal.stage, { field: "notes", kind: "text" });
    assert.equal(modal.pendingTab, null);
  } finally { modal.close(); }
});
