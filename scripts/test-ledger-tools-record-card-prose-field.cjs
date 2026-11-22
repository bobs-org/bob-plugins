// Record Card prose fields (S15): proseField on the text, suggest, and list
// stages, the field-mode link stage, the kept live input across repaints,
// the Esc ladder's band rung, and key routing ahead of the card's own keys.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");
const { helpers: navHelpers } = require("./navigation-hotkeys-harness.cjs");
const { createTaskLinksApi, taskLinksApp } = require("./prose-task-links-harness.cjs");

class TestPlugin {
  constructor(app) { this.app = app; }
  registerEditorExtension() {}
  registerMarkdownPostProcessor() {}
  registerEvent() {}
  addCommand(command) { (this.commands ||= []).push(command); }
}
class TestNotice { constructor(message) { TestNotice.messages.push(String(message)); } }
TestNotice.messages = [];

const StateEffect = { define: () => ({ of(value) { return { effect: this, value }; }, is(other) { return this === other; } }) };
class WidgetType {}
class RangeSetBuilder { constructor() { this.rows = []; } add(from, to, deco) { this.rows.push({ from, to, deco }); } finish() { return this.rows; } }
const Decoration = { none: [], widget: (options) => ({ widget: options.widget, side: options.side }) };
const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownRenderChild: class { constructor(el) { this.containerEl = el; } },
    Notice: TestNotice, Plugin: TestPlugin, Platform: { isDesktopApp: true },
    normalizePath: (value) => value, editorInfoField: { info: true }, editorLivePreviewField: { live: true },
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
    this.selectionStart = 0;
    this.selectionEnd = 0;
    const self = this;
    this.classList = {
      add(name) { const xs = new Set((self.getAttribute("class") || "").split(/\s+/).filter(Boolean)); xs.add(name); self.setAttribute("class", [...xs].join(" ")); },
      remove(name) { const xs = (self.getAttribute("class") || "").split(/\s+/).filter((x) => x && x !== name); self.setAttribute("class", xs.join(" ")); },
      contains(name) { return (self.getAttribute("class") || "").split(/\s+/).includes(name); },
      toggle(name, force) {
        const on = force === undefined ? !this.contains(name) : Boolean(force);
        if (on) this.add(name); else this.remove(name);
        return on;
      },
    };
    this.style = { setProperty() {} };
  }
  get textContent() { return this.nodeType === 3 ? this._text : this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { this._text = String(value); if (this.nodeType === 1) this.children = value === "" ? [] : [new FakeNode("", this.ownerDocument, this._text)]; }
  get firstChild() { return this.children[0] || null; }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  hasAttribute(name) { return this.attrs.has(name); }
  removeAttribute(name) { this.attrs.delete(name); }
  appendChild(node) { node.parentNode?.removeChild?.(node); node.parentNode = this; this.children.push(node); return node; }
  insertBefore(node, before) { node.parentNode?.removeChild?.(node); node.parentNode = this; const i = this.children.indexOf(before); this.children.splice(i < 0 ? this.children.length : i, 0, node); return node; }
  removeChild(node) { const i = this.children.indexOf(node); if (i >= 0) this.children.splice(i, 1); node.parentNode = null; this.ownerDocument.removed.add(node); return node; }
  empty() { while (this.firstChild) this.removeChild(this.firstChild); }
  remove() { this.parentNode?.removeChild?.(this); }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  createEl(tag, options = {}) {
    const node = new FakeNode(tag, this.ownerDocument);
    if (options.cls) node.setAttribute("class", String(options.cls).trim());
    if (options.text) node.textContent = String(options.text);
    for (const [name, value] of Object.entries(options.attr || {})) node.setAttribute(name, value);
    return this.appendChild(node);
  }
  addEventListener(type, fn, capture) { const key = capture ? `${type}:capture` : type; const rows = this.listeners.get(key) || []; rows.push(fn); this.listeners.set(key, rows); }
  removeEventListener(type, fn, capture) {
    const key = capture ? `${type}:capture` : type;
    this.listeners.set(key, (this.listeners.get(key) || []).filter((item) => item !== fn));
  }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  focus() { if (!this.disabled) this.ownerDocument.activeElement = this; }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  dispatchEvent(event) {
    const payload = event || {};
    if (!payload.target) payload.target = this;
    for (const callback of this.listeners.get(`${payload.type}:capture`) || []) callback(payload);
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
      const attr = /^\[([\w-]+)(?:\^?='([^']*)')?(?:="([^"]*)")?\]$/.exec(value);
      const prefix = /^\[([\w-]+)\^='([^']*)'\]$/.exec(value);
      const taggedAttr = /^([a-z][\w-]*)\[([\w-]+)(?:='([^']*)')?(?:="([^"]*)")?\]$/i.exec(value);
      const hasAttr = (name, expected) => this.attrs.has(name) && (expected === undefined || expected === "" || this.getAttribute(name) === expected);
      if (prefix) return this.attrs.has(prefix[1]) && String(this.getAttribute(prefix[1])).startsWith(prefix[2]);
      return Boolean((cls && this.classList.contains(cls[1])) || (tag && this.tagName === tag[0].toUpperCase()) ||
        (attr && hasAttr(attr[1], attr[2] || attr[3])) ||
        (taggedAttr && this.tagName === taggedAttr[1].toUpperCase() && hasAttr(taggedAttr[2], taggedAttr[3] || taggedAttr[4])));
    });
  }
  closest(selector) { let node = this; while (node) { if (node.nodeType === 1 && node.matches(selector)) return node; node = node.parentNode; } return null; }
  querySelectorAll(selector) {
    const parts = String(selector).trim().split(/\s+/);
    const found = [];
    const walk = (node, depth) => {
      for (const child of node.children || []) {
        if (child.nodeType !== 1) continue;
        if (child.matches(parts[depth])) {
          if (depth === parts.length - 1) found.push(child);
          else walk(child, depth + 1);
        }
        walk(child, depth);
      }
    };
    walk(this, 0);
    return [...new Set(found)];
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function makeDoc() {
  const doc = {
    activeElement: null,
    listeners: new Map(),
    removed: new Set(),
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
      this.listeners.set(key, (this.listeners.get(key) || []).filter((item) => item !== fn));
    },
    // Native insertText: replace the selection in the focused control and
    // fire one bubbling input event, as Chromium does.
    execCommand(command, _show, text) {
      const el = this.activeElement;
      if (command !== "insertText" || !el) return false;
      const value = String(el.value || "");
      el.value = value.slice(0, el.selectionStart) + String(text) + value.slice(el.selectionEnd);
      const caret = el.selectionStart + String(text).length;
      el.selectionStart = caret;
      el.selectionEnd = caret;
      el.dispatchEvent({ type: "input", inputType: "insertText", isComposing: false });
      return true;
    },
  };
  doc.defaultView = { setTimeout, clearTimeout, Event: Object, InputEvent: Object, document: doc };
  return doc;
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const CLOCK = { today: "2026-11-17" };
const choice = (value, label, count = 0) => ({ value, label, count });
const field = (key, kind, extra = {}) => ({
  key, label: extra.label || key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
  kind, required: extra.required === true, list: extra.list === true,
  choices: extra.choices || [], suggest: extra.suggest === true, values: extra.values,
});

function albumEntry() {
  return {
    path: "eat.md", stem: "eat", title: "Restaurants", noun: "restaurant", emoji: "🍽️",
    summary: null, label: "Restaurant", plural: "restaurants", singular: "restaurant",
    dated_notes: false, legacy: [], schema_fingerprint: "sha256:eat",
    parent: "body", parent_kind: "area", owner: "body", root: "body",
    breadcrumb: ["Body"], group_field: "status", index_by: "status", index_facets: [],
    records: 1, groups: [], needs_status: 0, last_record: "eat/smashburger.md",
    index: { state: "current" }, issues: [], fields: [
      field("status", "choices", { required: true, choices: [choice("to_try", "To try"), choice("loved", "Loved")] }),
      field("claim", "text"),
      field("location", "text", { suggest: true, values: [{ value: "cranford", count: 3 }, { value: "clark", count: 2 }] }),
      field("visited", "date"),
      field("spot", "link"),
      field("tags", "text", { list: true }),
      field("refs", "link", { list: true }),
      field("url", "url"),
    ],
  };
}

function showReport() {
  return {
    schema_version: 1, type: "eat", ok: true, fields: albumEntry().fields,
    record: {
      stem: "smashburger", path: "eat/smashburger.md", title: "Smashburger", heading: "Smashburger",
      fingerprint: "sha256:rec1", schema_fingerprint: "sha256:eat", frontmatter_end_line: 9,
      properties: [
        { key: "status", label: "Status", kind: "choices", required: true, state: "set", value: "to_try", display: "To try", line: 5 },
        { key: "claim", label: "Claim", kind: "text", required: false, state: "none", value: null, display: "", line: null },
        { key: "location", label: "Location", kind: "text", required: false, state: "none", value: null, display: "", line: null },
        { key: "visited", label: "Visited", kind: "date", required: false, state: "none", value: null, display: "", line: null },
        { key: "spot", label: "Spot", kind: "link", required: false, state: "none", value: null, display: "", line: null },
        { key: "tags", label: "Tags", kind: "text", required: false, state: "none", value: null, display: "", line: null },
        { key: "refs", label: "Refs", kind: "link", required: false, state: "none", value: null, display: "", line: null },
        { key: "url", label: "Url", kind: "url", required: false, state: "set", value: "https://example.test", display: "https://example.test", line: 7 },
      ],
      identity: [{ key: "parent", line: 2, value: "[[eat]]" }], other: [], findings: [],
    },
  };
}

function applyReport(overrides = {}) {
  return {
    schema_version: 1, command: "update", ok: true, dry_run: false,
    changed: ["claim"], stem: "smashburger", path: "eat/smashburger.md",
    fingerprint_before: "sha256:rec1", fingerprint_after: "sha256:rec2",
    consequence: "Claim set", inverse_ops: [], properties: [], changes: [], error: null,
    ...overrides,
  };
}

function navNote(path, extra = {}) {
  const stem = path.split("/").pop().replace(/\.md$/, "");
  return {
    path, tier: extra.tier || "living", insertTarget: path.replace(/\.md$/, ""), stem,
    aliases: extra.aliases || [], headings: extra.headings || [], blocks: extra.blocks || [], inbound: extra.inbound || 0,
  };
}
const NOTES = [
  navNote("cranford.md", { inbound: 3, headings: [{ title: "Food", level: 2, ordinal: 0 }] }),
  navNote("clark.md"),
  navNote("eat.md"),
];

// The real nav controller behind a fake api: same attach contract, fixed
// candidates, and a record of every attach call.
function realProseApi(attaches, taskLinks = createTaskLinksApi()) {
  const app = taskLinksApp(taskLinks);
  return {
    version: 2,
    attach(options) {
      attaches.push(options);
      return navHelpers.attachProseField({
        ...options, app, notes: NOTES, hintDebounceMs: 0,
        parentPaths: [], linkedPaths: [], recentPaths: [],
        resolveLink: (link) => NOTES.find((row) => row.insertTarget === link.target) || null,
      });
    },
  };
}

// A scripted handle: tests set `open` and `consume` to drive routing.
function fakeProseApi(log) {
  return {
    version: 1,
    attach(options) {
      const handle = {
        options, open: false, consume: new Set(), detached: false, rebinds: [],
        handleKeydown(event) { log.push(["key", event.key]); return this.consume.has(event.key); },
        backOut() { log.push(["backOut"]); if (!this.open) return false; this.open = false; return true; },
        isLinkOpen() { return this.open; },
        rebind(next) { this.rebinds.push(next); return true; },
        detach() { this.detached = true; log.push(["detach"]); },
      };
      log.push(["attach", options]);
      log.handles.push(handle);
      return handle;
    },
  };
}

function fixture(options = {}) {
  TestNotice.messages = [];
  const doc = makeDoc();
  const files = new Map();
  const caches = new Map();
  const add = (path, frontmatter, heading) => {
    files.set(path, { path });
    caches.set(path, { frontmatter, headings: heading ? [{ level: 1, heading }] : [] });
  };
  add("body.md", { type: "[[area]]", root_parent: true }, "Body");
  add("eat.md", { type: "[[album]]" }, "Restaurants");
  add("eat/smashburger.md", { type: "[[record]]", parent: "[[eat]]", title: "Smashburger", status: "to_try" }, "Smashburger");
  const app = {
    document: doc,
    plugins: { plugins: options.prose ? { "bob-navigation-hotkeys": { api: { version: 3, proseField: options.prose } } } : {} },
    vault: {
      getAbstractFileByPath: (path) => files.get(path) || null,
      read: async () => "---\nstatus: to_try\n---\n",
    },
    metadataCache: {
      getFirstLinkpathDest: (target) => files.get(`${String(target).replace(/\.md$/i, "")}.md`) || null,
      getFileCache: (file) => caches.get(file?.path) || null,
      on() { return { unload() {} }; },
    },
    workspace: { trigger() {}, getLeavesOfType: () => [], getMostRecentLeaf: () => null, activeLeaf: null, openLinkText: async () => {} },
  };
  const plugin = new LedgerToolsPlugin(app);
  const state = {
    report: helpers.albumIndexReport({
      schema_version: 1, ok: true, albums: [albumEntry()], catalogs: [],
      counts: { albums: 1, records: 1, roots: 1 }, capabilities: ["record_values_v1"],
    }),
    stale: false, generation: 1, reportGeneration: 1,
  };
  plugin.albumReportState = () => state;
  plugin.apiAlbumSubscribe = (fn) => { fn(state); return () => {}; };
  plugin.recordSheetActive = true;
  plugin.recordSheetDay = CLOCK.today;
  plugin.recordSheetDesktop = () => true;
  plugin.albumHeaderDesktop = () => true;
  plugin.albumDataActive = true;
  plugin.setupRecordUpdate();
  plugin.recordSheetOverlays = new Map();
  plugin.recordSheetPushOverlay = () => {};
  plugin.albumSetTimeout = (fn) => setTimeout(fn, 0);
  plugin.albumClearTimeout = (timer) => clearTimeout(timer);
  plugin._applies = [];
  plugin.apiRecordShow = async () => ({ ok: true, report: showReport() });
  plugin.apiRecordUpdatePreview = async () => ({ ok: true, report: applyReport({ dry_run: true }) });
  plugin.apiRecordUpdateApply = async (_type, _stem, envelope) => {
    plugin._applies.push(JSON.parse(envelope));
    return { ok: true, report: applyReport() };
  };
  plugin.apiRecordUpdateCapable = () => true;
  plugin.getActiveMarkdownView = () => ({ file: { path: "eat/smashburger.md" } });
  return { app, doc, plugin };
}

async function openCard(options = {}) {
  const world = fixture(options);
  const opened = await world.plugin.openRecordCard({ filePath: "eat/smashburger.md" });
  await pause(0);
  return { ...world, modal: opened.modal };
}

function keyEvent(key, extra = {}) {
  return { type: "keydown", key, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...extra };
}

function stageInput(modal, kind) {
  const key = kind === "list" ? "stage-list-item" : `stage-${kind}`;
  return modal.contentEl.querySelector(`[data-record-input='${key}']`);
}

// Type like a user: the text lands in the live input, the caret follows,
// and one input event bubbles to both the controller and the card.
function typeInto(input, value) {
  input.focus();
  input.value = value;
  input.selectionStart = value.length;
  input.selectionEnd = value.length;
  input.dispatchEvent({ type: "input", inputType: "insertText", isComposing: false });
}

function press(modal, input, key, extra = {}) {
  const event = keyEvent(key, { target: input, ...extra });
  modal.recordOnKeyDown(event);
  return event;
}

function release(input, key) {
  input.dispatchEvent({ type: "keyup", key, target: input });
}

async function untilCard(predicate) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return;
    await pause(5);
  }
  assert.ok(predicate(), "Record Card did not settle");
}

test("link drafts keep bare names, subpaths, and authored aliases", () => {
  assert.deepEqual(helpers.recordCardParseLinkDraft("[[eat/smashburger|Smash]]"), {
    kind: "wikilink", value: "[[eat/smashburger|Smash]]", target: "eat/smashburger", subpath: "", alias: "Smash",
  });
  const heading = helpers.recordCardParseLinkDraft(" [[nj_towns#^z-cranford|cranford]] ");
  assert.equal(heading.target, "nj_towns");
  assert.equal(heading.subpath, "#^z-cranford");
  assert.equal(heading.alias, "cranford");
  assert.equal(helpers.recordCardParseLinkDraft("[[cranford]]").alias, null);
  assert.equal(helpers.recordCardParseLinkDraft("[[sase#Overview]]").subpath, "#Overview");
  assert.equal(helpers.recordCardParseLinkDraft("cranford").kind, "bare");
  assert.equal(helpers.recordCardParseLinkDraft("").kind, "empty");
  assert.equal(helpers.recordCardParseLinkDraft("[[open").kind, "bare");
  assert.equal(helpers.recordCardLinkCandidates, undefined, "the per-card note matcher is retired");
});

test("only prose stages complete links; the link stage uses field mode", () => {
  assert.equal(helpers.recordCardStageProseMode("text", { kind: "text" }), "inline");
  assert.equal(helpers.recordCardStageProseMode("suggest", { kind: "text", suggest: true }), "inline");
  assert.equal(helpers.recordCardStageProseMode("link", { kind: "link" }), "field");
  assert.equal(helpers.recordCardStageProseMode("list", { kind: "text", list: true }), "inline");
  assert.equal(helpers.recordCardStageProseMode("list", { kind: "link", list: true }), "field");
  for (const kind of ["date", "number", "url", "choices"]) {
    assert.equal(helpers.recordCardStageProseMode(kind, { kind }), null, kind);
  }
  for (const scalar of ["date", "number", "url"]) {
    assert.equal(helpers.recordCardStageProseMode("list", { kind: scalar, list: true }), null, scalar);
  }
  assert.equal(helpers.recordCardStageProseMode("list", { kind: "choices", list: true, choices: [choice("a", "A")] }), null);
});

test("typed stage painter keeps the live input and band host across paints", () => {
  const doc = makeDoc();
  const target = { key: "claim", label: "Claim", field: { key: "claim", kind: "text" } };
  const host = doc.createElement("div");
  const paint = (text, extra = {}) => helpers.recordCardPaintTypedStage(doc, host, {
    kind: "text", target, draft: { text, list: [], itemDraft: "" }, reportField: null,
    preview: extra.preview || null, plugin: null, recordPath: "eat/smashburger.md", applying: false,
  });
  const first = paint("see [[cra");
  const band = host.querySelector("[data-record-band]");
  assert.ok(band, "prose stages get a band host under the field");
  assert.equal(host.children.indexOf(band), host.children.indexOf(first) + 1);
  first.value = "see [[cran";
  let assigned = 0;
  const realValue = first.value;
  Object.defineProperty(first, "value", {
    configurable: true,
    get() { return this._value ?? realValue; },
    set(next) { assigned += 1; this._value = next; },
  });
  const second = paint("see [[cran", { preview: { consequence: "Claim set", warnings: [] } });
  assert.equal(second, first, "the same element survives the repaint");
  assert.equal(host.querySelector("[data-record-band]"), band);
  assert.equal(assigned, 0, "an unchanged value is never reassigned");
  assert.match(host.textContent, /Claim text/);
  assert.match(host.textContent, /Claim set/);
  const labelAt = host.children.findIndex((node) => node.classList.contains("bob-record-card-stage-label"));
  assert.ok(labelAt < host.children.indexOf(first), "the label stays above the kept field");
  helpers.recordCardPaintTypedStage(doc, host, {
    kind: "text", target, draft: { text: "see [[", list: [], itemDraft: "" }, reportField: null,
    preview: null, plugin: null, recordPath: "", applying: false, composing: true,
  });
  assert.equal(assigned, 0, "a repaint during IME composition never rewrites the field");
  paint("reset");
  assert.equal(assigned, 1, "an external draft change still reaches the field");
  const other = helpers.recordCardPaintTypedStage(doc, host, {
    kind: "text", target: { ...target, key: "notes" }, draft: { text: "", list: [], itemDraft: "" },
    reportField: null, preview: null, plugin: null, recordPath: "", applying: false,
  });
  assert.notEqual(other, first, "another field gets its own input");
  const dateHost = doc.createElement("div");
  helpers.recordCardPaintTypedStage(doc, dateHost, {
    kind: "date", target: { key: "visited", label: "Visited", field: { key: "visited", kind: "date" } },
    draft: { text: "", list: [], itemDraft: "" }, reportField: null, preview: null, plugin: null, recordPath: "", applying: false,
  });
  assert.equal(dateHost.querySelector("[data-record-band]"), null, "date stays literal");
  const listHost = doc.createElement("div");
  const listPaint = (itemDraft, list) => helpers.recordCardPaintTypedStage(doc, listHost, {
    kind: "list", target: { key: "tags", label: "Tags", field: { key: "tags", kind: "text", list: true } },
    draft: { text: "", list, itemDraft }, reportField: null, preview: null, plugin: null, recordPath: "", applying: false,
  });
  const item = listPaint("[[cl", ["a"]);
  assert.equal(listPaint("[[cl", ["a", "b"]), item);
  assert.deepEqual(listHost.querySelectorAll(".bob-record-card-chip-text").map((node) => node.textContent), ["a", "b"]);
  assert.ok(listHost.children.indexOf(listHost.querySelector(".bob-record-card-chip-list")) < listHost.children.indexOf(item));
});

test("without nav the typed stages stay plain typing", async () => {
  const { modal, plugin } = await openCard();
  try {
    modal.recordOpenStage("text", "claim");
    const input = stageInput(modal, "text");
    typeInto(input, "see [[cra");
    assert.equal(modal.stageDraftText, "see [[cra");
    assert.equal(modal.recordProseBinding || null, null);
    await modal.session.previewNow();
    press(modal, input, "Enter");
    await untilCard(() => plugin._applies.length === 1);
    assert.deepEqual(plugin._applies[0].ops, [{ op: "field.set", field: "claim", value: "see [[cra" }]);
  } finally { modal.close(); }
});

test("each prose stage attaches once with the record as sourcePath", async () => {
  const log = []; log.handles = [];
  const { modal } = await openCard({ prose: fakeProseApi(log) });
  try {
    const attaches = () => log.filter((row) => row[0] === "attach").map((row) => row[1]);
    modal.recordOpenStage("text", "claim");
    const input = stageInput(modal, "text");
    assert.equal(attaches().length, 1);
    const opts = attaches()[0];
    assert.equal(opts.inputEl, input);
    assert.equal(opts.bandHost, modal.contentEl.querySelector("[data-record-band]"));
    assert.equal(opts.sourcePath(), "eat/smashburger.md");
    assert.equal(opts.mode, "inline");
    assert.equal(opts.recall, null);
    assert.equal(opts.ownKeys, false);
    assert.equal(opts.links, true);
    assert.equal(opts.tasks, true);
    typeInto(input, "see [[cr");
    typeInto(input, "see [[cra");
    assert.equal(stageInput(modal, "text"), input, "per-keystroke paints keep the element");
    assert.equal(attaches().length, 1, "repaints never reattach");
    assert.equal(log.handles[0].rebinds.length, 0);
    modal.recordOpenStage("link", "spot");
    assert.equal(log.handles[0].detached, true, "changing stage detaches the old field");
    assert.equal(attaches()[1].mode, "field");
    modal.recordOpenStage("list", "tags");
    assert.equal(attaches()[2].inputEl, stageInput(modal, "list"));
    assert.equal(attaches()[2].mode, "inline");
    modal.recordOpenStage("list", "refs");
    assert.equal(attaches()[3].mode, "field");
    modal.recordOpenStage("suggest", "location");
    assert.equal(attaches()[4].mode, "inline");
    const count = attaches().length;
    modal.recordOpenStage("date", "visited");
    modal.recordOpenStage("url", "url");
    modal.recordOpenStage("choices", "status");
    assert.equal(attaches().length, count, "date, URL, and choices stay literal");
    assert.equal(log.handles.every((handle) => handle.detached), true);
    modal.recordOpenStage("text", "claim");
    modal.close();
    assert.equal(log.handles.at(-1).detached, true, "closing the card detaches");
  } finally { if (!modal.closed) modal.close(); }
});

test("a replaced input is rebound instead of reattached", async () => {
  const log = []; log.handles = [];
  const { modal } = await openCard({ prose: fakeProseApi(log) });
  try {
    modal.recordOpenStage("text", "claim");
    const stage = modal.contentEl.querySelector("[data-record-card-stage]");
    // Simulate a host that cannot keep the element (no insertBefore).
    stage.insertBefore = undefined;
    modal.stageDraftText = "x";
    modal.recordTypedInput();
    const input = stageInput(modal, "text");
    const handle = log.handles[0];
    assert.equal(log.filter((row) => row[0] === "attach").length, 1);
    assert.ok(handle.rebinds.length >= 1, "each rebuilt field is rebound");
    assert.equal(handle.rebinds.at(-1).inputEl, input);
    assert.equal(handle.rebinds.at(-1).bandHost, modal.contentEl.querySelector("[data-record-band]"));
  } finally { modal.close(); }
});

test("the band sees keys first and its Enter, Tab, and arrows never reach the card", async () => {
  const log = []; log.handles = [];
  const { modal, plugin } = await openCard({ prose: fakeProseApi(log) });
  try {
    modal.recordOpenStage("suggest", "location");
    const input = stageInput(modal, "suggest");
    const handle = log.handles[0];
    handle.open = true;
    for (const key of ["Enter", "Tab", "ArrowDown"]) handle.consume.add(key);
    const moves = [];
    modal.recordMoveSuggest = (delta) => moves.push(delta);
    modal.recordTab = async () => { throw new Error("Tab must not reach the card"); };
    typeInto(input, "near [[cra");
    for (const key of ["Enter", "Tab", "ArrowDown"]) {
      const event = press(modal, input, key);
      assert.equal(event.defaultPrevented, true, key);
      assert.equal(event.stopped, true, key);
    }
    assert.deepEqual(moves, [], "suggest cycling waits for the band");
    assert.equal(plugin._applies.length, 0);
    // An open band that declines Enter (Shift+Enter in a textarea) still
    // stops it: a half-typed link is never saved.
    handle.consume.delete("Enter");
    const shifted = press(modal, input, "Enter", { shiftKey: true });
    assert.equal(shifted.defaultPrevented, true);
    assert.equal(plugin._applies.length, 0);
    handle.open = false;
    press(modal, input, "ArrowUp");
    assert.deepEqual(moves, [-1], "a closed band hands arrows back to the suggestions");
    assert.deepEqual(log.filter((row) => row[0] === "key").map((row) => row[1]),
      ["Enter", "Tab", "ArrowDown", "Enter", "ArrowUp"]);
  } finally { modal.close(); }
});

test("Esc, q, and Ctrl+[ close the band before the stage", async () => {
  const log = []; log.handles = [];
  const { modal } = await openCard({ prose: fakeProseApi(log) });
  try {
    modal.recordOpenStage("text", "claim");
    const input = stageInput(modal, "text");
    const handle = log.handles[0];
    handle.open = true;
    const esc = keyEvent("Escape", { target: input });
    modal.recordDomKeyListener(esc);
    assert.equal(handle.open, false);
    assert.equal(esc.__schemaEscapeHandled, true);
    assert.deepEqual(modal.stage, { kind: "text", field: "claim" }, "the stage stays open");
    modal.recordOnKeyDown(esc);
    assert.deepEqual(modal.stage, { kind: "text", field: "claim" }, "one layer per press");
    handle.open = true;
    modal.recordDomKeyListener(keyEvent("q", { target: input }));
    assert.equal(handle.open, true, "q types in the field");
    modal.recordDomKeyListener(keyEvent("[", { target: input, ctrlKey: true }));
    assert.equal(handle.open, false);
    assert.ok(modal.stage);
    modal.recordDomKeyListener(keyEvent("Escape", { target: input }));
    assert.equal(modal.stage, null, "with the band closed Esc backs out of the stage");
    assert.equal(handle.detached, true);
  } finally { modal.close(); }
});

test("text stage: [[ completes in place, Enter inserts, the next Enter saves", async () => {
  const attaches = [];
  const { modal, plugin, doc } = await openCard({ prose: realProseApi(attaches) });
  try {
    modal.recordOpenStage("text", "claim");
    const input = stageInput(modal, "text");
    typeInto(input, "best near [[cra");
    assert.equal(modal.recordProseLinkOpen(), true, "typing [[ opens the band");
    assert.match(modal.contentEl.querySelector("[data-record-band]").textContent, /LINK/);
    assert.equal(stageInput(modal, "text"), input, "the field was never replaced");
    assert.equal(doc.removed.has(input), false, "the field never left the document");
    const accept = press(modal, input, "Enter");
    assert.equal(accept.defaultPrevented, true);
    assert.equal(modal.stageDraftText, "best near [[cranford]]");
    assert.equal(modal.recordProseLinkOpen(), false);
    assert.equal(plugin._applies.length, 0, "accepting a row never saves");
    const held = press(modal, input, "Enter", { repeat: true });
    assert.equal(held.defaultPrevented, true);
    assert.equal(plugin._applies.length, 0, "a held Enter cannot accept then save");
    release(input, "Enter");
    await modal.session.previewNow();
    press(modal, input, "Enter");
    await untilCard(() => plugin._applies.length === 1);
    assert.deepEqual(plugin._applies[0].ops, [{ op: "field.set", field: "claim", value: "best near [[cranford]]" }]);
    assert.equal(attaches.length, 1);
  } finally { modal.close(); }
});

test("link stage: the whole value is the query and Enter inserts [[path]]", async () => {
  const attaches = [];
  const { modal, plugin, doc } = await openCard({ prose: realProseApi(attaches) });
  try {
    modal.recordOpenStage("link", "spot");
    const input = stageInput(modal, "link");
    assert.equal(modal.contentEl.querySelector(".bob-record-card-link-list"), null, "no second candidate list");
    typeInto(input, "cra");
    assert.equal(modal.recordProseLinkOpen(), true);
    assert.equal(doc.removed.has(input), false, "the field survives the per-keystroke repaint");
    press(modal, input, "ArrowDown");
    press(modal, input, "ArrowUp");
    const accept = press(modal, input, "Tab");
    assert.equal(accept.defaultPrevented, true);
    assert.equal(modal.stageDraftText, "[[cranford]]");
    assert.deepEqual(modal.stage, { kind: "link", field: "spot" }, "Tab accepts instead of advancing");
    assert.equal(plugin._applies.length, 0);
    await modal.session.previewNow();
    press(modal, input, "Enter");
    await untilCard(() => plugin._applies.length === 1);
    assert.deepEqual(plugin._applies[0].ops, [{ op: "field.set", field: "spot", value: "[[cranford]]" }]);
  } finally { modal.close(); }
});

test("link stage: Esc closes only the band and arrows stay inert while closed", async () => {
  const { modal } = await openCard({ prose: realProseApi([]) });
  try {
    modal.recordOpenStage("link", "spot");
    const input = stageInput(modal, "link");
    typeInto(input, "cl");
    assert.equal(modal.recordProseLinkOpen(), true);
    modal.recordDomKeyListener(keyEvent("Escape", { target: input }));
    assert.equal(modal.recordProseLinkOpen(), false);
    assert.deepEqual(modal.stage, { kind: "link", field: "spot" });
    const down = press(modal, input, "ArrowDown");
    assert.equal(down.defaultPrevented, true);
    assert.equal(modal.stageDraftText, "cl", "no hidden candidate cycling rewrites the draft");
    typeInto(input, "cla");
    assert.equal(modal.recordProseLinkOpen(), true, "editing the query reopens the band");
  } finally { modal.close(); }
});

test("task NAME owns typing and Ctrl+Enter without triggering Record Card input or save", async () => {
  const taskLinks = createTaskLinksApi();
  const attaches = [];
  const { modal, plugin } = await openCard({ prose: realProseApi(attaches, taskLinks) });
  try {
    modal.recordOpenStage("text", "claim");
    const input = stageInput(modal, "text");
    typeInto(input, "Follow up ((reply");
    const handle = modal.recordProseBinding.handle;
    assert.equal(handle.isTaskOpen(), true);
    press(modal, input, "Enter");
    release(input, "Enter");
    await pause(0);
    assert.equal(handle.isNaming(), true);
    const draft = modal.stageDraftText;
    const tab = press(modal, input, "Tab");
    assert.equal(tab.defaultPrevented, true, "NAME Tab cycles suggestions before Record Card field navigation");
    assert.match(modal.contentEl.querySelector("[data-record-band]").textContent, /follow-up/);
    const shiftTab = press(modal, input, "Tab", { shiftKey: true });
    assert.equal(shiftTab.defaultPrevented, true);

    let inputEvents = 0;
    input.addEventListener("input", () => { inputEvents += 1; });
    const beforeinput = {
      type: "beforeinput", inputType: "insertFromPaste",
      clipboardData: { getData: () => "fresh-id" },
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() {},
    };
    input.dispatchEvent(beforeinput);
    assert.equal(beforeinput.defaultPrevented, true);
    assert.equal(inputEvents, 0, "cancelled beforeinput emits no input event");
    assert.equal(modal.stageDraftText, draft, "NAME input does not repaint or change the record draft");
    assert.equal(input.value, draft, "NAME editing stays outside the prompt field snapshot");

    const confirm = press(modal, input, "Enter", { metaKey: true });
    await pause(0);
    assert.equal(confirm.defaultPrevented, true, "Cmd+Enter is consumed by task naming");
    assert.equal(taskLinks.state.named.at(-1).id, "fresh-id");
    assert.equal(handle.isTaskOpen(), false);
    assert.deepEqual(modal.stage, { kind: "text", field: "claim" });
    assert.equal(plugin._applies.length, 0, "naming a task never saves the record field");
    assert.match(modal.stageDraftText, /^Follow up \[\[2026\/2026-11-21#\^fresh-id\]\]$/);
  } finally { modal.close(); }
});

test("link stage: (( is field-mode and its named block link parses as a subpath", async () => {
  const taskLinks = createTaskLinksApi();
  const attaches = [];
  const { modal, plugin } = await openCard({ prose: realProseApi(attaches, taskLinks) });
  try {
    modal.recordOpenStage("link", "spot");
    let input = stageInput(modal, "link");
    assert.equal(attaches.at(-1).mode, "field");
    typeInto(input, "Context ((reply");
    assert.equal(modal.recordProseBinding.handle.isTaskOpen(), false, "field mode ignores an opener after offset zero");
    input = stageInput(modal, "link");
    typeInto(input, "((reply");
    const handle = modal.recordProseBinding.handle;
    assert.equal(handle.isTaskOpen(), true, "field mode opens at offset zero");
    assert.equal(taskLinks.state.requests.length, 1);
    press(modal, input, "Enter");
    release(input, "Enter");
    await pause(0);
    assert.equal(handle.isNaming(), true);
    const confirm = press(modal, input, "Enter", { ctrlKey: true });
    await pause(0);
    assert.equal(confirm.defaultPrevented, true);
    assert.equal(plugin._applies.length, 0, "task naming does not save the link field");
    assert.deepEqual(helpers.recordCardParseLinkDraft(modal.stageDraftText), {
      kind: "wikilink",
      value: "[[2026/2026-11-21#^reply-dana]]",
      target: "2026/2026-11-21",
      subpath: "#^reply-dana",
      alias: null,
    });
  } finally { modal.close(); }
});

test("list stage: Enter accepts into the item, then adds it, then saves", async () => {
  const { modal, plugin } = await openCard({ prose: realProseApi([]) });
  try {
    modal.recordOpenStage("list", "tags");
    const input = stageInput(modal, "list");
    typeInto(input, "near [[cl");
    assert.equal(modal.recordProseLinkOpen(), true);
    press(modal, input, "Enter");
    assert.equal(modal.stageItemDraft, "near [[clark]]");
    assert.deepEqual(modal.stageList, [], "accepting a row does not add the item");
    release(input, "Enter");
    press(modal, input, "Enter");
    assert.deepEqual(modal.stageList, ["near [[clark]]"]);
    assert.equal(stageInput(modal, "list"), input);
    assert.equal(input.value, "", "the committed item clears the kept field");
    release(input, "Enter");
    await modal.session.previewNow();
    press(modal, input, "Enter");
    await untilCard(() => plugin._applies.length === 1);
    assert.deepEqual(plugin._applies[0].ops, [{ op: "field.set", field: "tags", value: ["near [[clark]]"] }]);
  } finally { modal.close(); }
});

test("suggest stage keeps its combobox relationship whenever the band is closed", async () => {
  const { modal } = await openCard({ prose: realProseApi([]) });
  try {
    modal.recordOpenStage("suggest", "location");
    const input = stageInput(modal, "suggest");
    assert.equal(input.getAttribute("aria-controls"), "bob-record-card-suggest-location");
    assert.equal(input.getAttribute("aria-expanded"), "true");
    typeInto(input, "near [[cra");
    assert.equal(modal.recordProseLinkOpen(), true);
    assert.match(input.getAttribute("aria-controls"), /^bob-link-band-/, "the open band owns the relationship");
    modal.recordDomKeyListener(keyEvent("Escape", { target: input }));
    assert.equal(input.getAttribute("aria-controls"), "bob-record-card-suggest-location");
    assert.equal(input.getAttribute("aria-expanded"), "true");
    assert.equal(input.getAttribute("role"), "combobox");
  } finally { modal.close(); }
});

test("S15 NAME accept resolving after keyup: one Enter saves the record stage", async () => {
  const taskLinks = createTaskLinksApi();
  const attaches = [];
  const { modal, plugin } = await openCard({ prose: realProseApi(attaches, taskLinks) });
  try {
    modal.recordOpenStage("text", "claim");
    const input = stageInput(modal, "text");
    typeInto(input, "Follow up ((reply");
    const handle = modal.recordProseBinding.handle;
    assert.equal(handle.isTaskOpen(), true);
    press(modal, input, "Enter");
    release(input, "Enter");
    await pause(0);
    assert.equal(handle.isNaming(), true);
    press(modal, input, "Enter");
    release(input, "Enter");
    await pause(20);
    assert.equal(handle.isTaskOpen(), false, "NAME commit closes the band");
    assert.match(modal.stageDraftText, /^Follow up \[\[2026\/2026-11-21#\^reply-dana\]\]$/);
    await modal.session.previewNow();
    const expected = modal.stageDraftText;
    const save = press(modal, input, "Enter");
    release(input, "Enter");
    await untilCard(() => plugin._applies.length === 1);
    assert.equal(save.defaultPrevented, true, "a single Enter saves without retry");
    assert.deepEqual(plugin._applies[0].ops, [{ op: "field.set", field: "claim", value: expected }]);
  } finally { modal.close(); }
});
