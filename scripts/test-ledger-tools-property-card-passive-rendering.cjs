const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin {
  constructor(app) { this.app = app; }
  registerEditorExtension() {}
  registerMarkdownPostProcessor() {}
  registerEvent(value) { return value; }
}

const editorInfoField = { info: true };
const editorLivePreviewField = { live: true };
const StateEffect = { define: () => ({ of(value) { return { value }; } }) };
const StateField = { define: (spec) => ({ stateField: true, spec }) };
class WidgetType {}
class RangeSetBuilder { add() {} finish() { return []; } }
const Decoration = {
  none: [],
  widget: (options) => options,
  replace: (options) => options,
  line: (options) => options,
  set: (ranges) => ranges,
};
const EditorView = {
  decorations: { from: (field, get) => ({ field, get }) },
  editorAttributes: { of: (value) => value, from: (field, get) => ({ field, get }) },
};

const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownRenderChild: class { constructor(el) { this.containerEl = el; } },
    Notice: class {}, Plugin: TestPlugin, Platform: { isDesktopApp: true },
    normalizePath: (value) => value, parseYaml: () => ({}), editorInfoField, editorLivePreviewField,
  };
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value }, StateEffect, StateField, RangeSetBuilder };
  if (request === "@codemirror/view") return {
    Decoration, WidgetType, ViewPlugin: { fromClass: (cls, options) => ({ cls, options }) }, EditorView,
  };
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers: H } = LedgerToolsPlugin;
Module._load = originalLoad;

const SRC = "../plugins/bob-ledger-tools/src/";
const sourceFiles = {
  bank: ["248c-plugin-bank-setup-hosts.js", "paintBankSetupReading"],
  album: ["241v-plugin-album-header.js", "paintAlbumHeaderReading"],
  record: ["242kb-plugin-record-sheet-title.js", "paintRecordSheetReading"],
  area: ["249d-plugin-home-card-host.js", "paintHomeCardReading"],
  project: ["249d-plugin-home-card-host.js", "paintHomeCardReading"],
  notebook: ["249i-plugin-notebook-card-host.js", "paintNotebookCardReading"],
  prose: ["249n-plugin-prose-note-card-host.js", "paintProseNoteCardReading"],
  ref: ["249s-plugin-ref-note-card-host.js", "paintRefNoteCardReading"],
};

function methodBody(source, name) {
  const start = source.indexOf(`  ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const end = source.indexOf("\n  }", start);
  assert.notEqual(end, -1, `${name} has a class-method boundary`);
  return source.slice(start, end + 4);
}

// Bank Setup, album Schema, and prose Outline are delegated cabinets; every
// other card exposes its compact card-details control to `_`.
const CABINET_FOLD_KINDS = new Set(["bank", "album", "prose"]);

function foldView(kind, path) {
  const role = CABINET_FOLD_KINDS.has(kind) ? "cabinet" : "details";
  const button = {
    attrs: new Map([["data-card-fold", kind], ["data-card-fold-role", role], ["data-card-fold-source", path], ["aria-expanded", "true"]]),
    isConnected: true,
    getAttribute(name) { return this.attrs.get(name) ?? null; },
    setAttribute(name, value) { this.attrs.set(name, String(value)); },
    getBoundingClientRect() { return { width: 20, height: 16 }; },
  };
  const root = {
    matches() { return false; },
    querySelectorAll(selector) { return selector === "[data-card-fold]" ? [button] : []; },
  };
  button.parentNode = root;
  return { button, view: { file: { path }, dom: root } };
}

function makePlugin(sideEffects, timerQueue, subscriptions) {
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.app = {
    vault: {
      read: async () => "",
      getAbstractFileByPath: (path) => ({ path }),
      modify: async () => { sideEffects.writes += 1; },
      create: async () => { sideEffects.writes += 1; },
      delete: async () => { sideEffects.writes += 1; },
      process: async () => { sideEffects.writes += 1; },
    },
    metadataCache: {},
    workspace: {},
  };
  plugin.spawnBob = async () => { sideEffects.spawns += 1; throw new Error("paint must not spawn bob"); };
  plugin.registerEditorExtension = () => {};
  plugin.registerMarkdownPostProcessor = () => {};
  plugin.registerEvent = (value) => value;
  plugin.albumSetTimeout = (callback, ms) => {
    const timer = { callback, ms, cancelled: false };
    timerQueue.push(timer);
    return timer;
  };
  plugin.albumClearTimeout = (timer) => { if (timer) timer.cancelled = true; };
  plugin.bankSetTimeout = plugin.albumSetTimeout;
  plugin.bankClearTimeout = plugin.albumClearTimeout;

  plugin.bankSetupDesktop = () => true;
  plugin.bankSetupFootBind = () => {};
  plugin.bankSetupFootUnbind = () => {};
  plugin.bankSetupNoteReport = () => {};
  plugin.bankSetupSyncSurfaces = () => {};
  plugin.apiBankSubscribe = (args, callback) => {
    subscriptions.push({ args, callback });
    return () => {};
  };
  plugin.bankSetupModelFor = () => ({ expanded: false, problems: "" });

  plugin.albumHeaderFootBind = () => {};
  plugin.albumHeaderFootUnbind = () => {};
  plugin.apiAlbumSubscribe = (callback) => { subscriptions.push({ args: "album", callback }); return () => {}; };
  plugin.albumHeaderCardModelFor = () => null;
  plugin.albumHeaderModelFor = () => ({ problems: "" });

  plugin.recordSheetToday = () => "2026-11-26";
  plugin.recordSheetCardModelFor = () => null;
  plugin.recordWalkPaintReading = () => {};
  plugin.recordSheetNotifyOwnership = () => {};
  plugin.apiAlbumSubscribe = (callback) => { subscriptions.push({ args: "album", callback }); return () => {}; };

  plugin.homeCardDayTimer = true;
  plugin.homeCardTodayText = () => "2026-11-26";
  plugin.homeCardLiveSubscribe = () => {};
  plugin.homeCardBindFrontmatterOwnership = () => {};
  plugin.homeCardFootBind = () => {};
  plugin.homeCardFootUnbind = () => {};
  plugin.homeCardDesktop = () => true;
  plugin.notebookCardReadingRoot = () => null;
  plugin.proseNoteCardReadingRoot = () => null;
  plugin.notebookCardPropertyHost = () => ({
    refreshReading: () => plugin.paintNotebookCardReading(null, "notebooks.md"),
  });
  plugin.proseNoteCardHost = () => ({
    refreshReading: () => plugin.paintProseNoteCardReading(null, "sase_blog_contents.md"),
  });
  plugin.scheduleNotebookCardRefresh = () => plugin.notebookCardPropertyHost().refreshReading();
  plugin.scheduleProseNoteCardRefresh = () => plugin.proseNoteCardHost().refreshReading();
  plugin.refNoteCardReadingRoot = () => null;
  plugin.refNoteCardPropertyHost = () => ({
    refreshReading: () => plugin.paintRefNoteCardReading(null, "ref/agentic-coding-ci.md"),
  });
  plugin.scheduleRefNoteCardRefresh = () => plugin.refNoteCardPropertyHost().refreshReading();

  const root = {
    classList: { contains: () => false, add() {}, remove() {} },
    querySelectorAll: () => [],
    closest: () => null,
  };
  for (const [rootMethod, scopeMethod] of [
    ["bankSetupReadingRoot", "bankSetupReadingScope"],
    ["albumHeaderReadingRoot", "albumHeaderReadingScope"],
    ["recordSheetReadingRoot", "recordSheetReadingScope"],
    ["homeCardReadingRoot", "homeCardReadingScope"],
  ]) {
    plugin[rootMethod] = () => root;
    plugin[scopeMethod] = () => root;
  }
  for (const method of [
    "bankSetupRemoveReading", "bankSetupRemoveStrays",
    "albumHeaderRemoveReading", "albumHeaderRemoveStrays",
    "recordSheetRemoveReading", "recordSheetRemoveStrays",
    "homeCardRemoveReading", "homeCardRemoveStrays",
  ]) plugin[method] = () => {};

  const paints = Object.create(null);
  for (const [kind, [, method]] of Object.entries(sourceFiles)) {
    if (paints[method]) continue;
    const original = plugin[method].bind(plugin);
    paints[method] = 0;
    plugin[method] = (...args) => { paints[method] += 1; return original(...args); };
  }
  return { plugin, paints, root };
}

test("all card painters are passive and repeated fold refreshes stay read-only", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const forbidden = /processFrontMatter\s*\(|(?:vault\s*\.\s*(?:modify|create|delete|process)|spawnBob|execFileSync?|spawnSync|spawn)\s*\(/;
  for (const [kind, [file, method]] of Object.entries(sourceFiles)) {
    const source = fs.readFileSync(path.join(__dirname, SRC, file), "utf8");
    assert.doesNotMatch(methodBody(source, method), forbidden, `${kind} paint is a passive render`);
  }

  const sideEffects = { writes: 0, spawns: 0 };
  const timerQueue = [];
  const subscriptions = [];
  const { plugin, paints, root } = makePlugin(sideEffects, timerQueue, subscriptions);
  plugin.setupBankSetup();
  plugin.setupAlbumHeader();
  plugin.setupRecordSheet();
  plugin.setupHomeCard();

  const cases = [
    { kind: "bank", path: "bank.md", reading: "bankSetupReading", host: "bankPropertyCardHost", paint: "paintBankSetupReading", setup: "bankSetup" },
    { kind: "album", path: "eat.md", reading: "albumHeaderReading", host: "albumPropertyCardHost", paint: "paintAlbumHeaderReading", setup: "album" },
    { kind: "record", path: "eat/nagi.md", reading: "recordSheetReading", host: "recordPropertyCardHost", paint: "paintRecordSheetReading", setup: "record" },
    { kind: "area", path: "love.md", reading: "homeCardReading", host: "homePropertyCardHost", paint: "paintHomeCardReading", setup: "home" },
    { kind: "project", path: "sase_blog.md", reading: "homeCardReading", host: "homePropertyCardHost", paint: "paintHomeCardReading", setup: "home" },
    { kind: "notebook", path: "notebooks.md", host: "notebookCardPropertyHost", paint: "paintNotebookCardReading" },
    { kind: "prose", path: "sase_blog_contents.md", host: "proseNoteCardHost", paint: "paintProseNoteCardReading" },
    { kind: "ref", path: "ref/agentic-coding-ci.md", host: "refNoteCardPropertyHost", paint: "paintRefNoteCardReading" },
  ];
  for (const item of cases) {
    if (item.reading) plugin[item.reading].add({ el: root, path: item.path, surface: root, scope: root });
  }

  const bankSubscription = subscriptions.find((item) => item.args?.command === "config");
  assert.ok(bankSubscription, "Bank Setup subscribes to the config report");
  assert.deepEqual(bankSubscription.args, { command: "config" });
  assert.equal(paints.paintBankSetupReading, 0, "Bank config paint waits for its subscription callback");

  const toggles = {
    bank: (path) => plugin.bankSetupToggleExpanded(path),
    album: (path) => {
      const open = plugin.albumHeaderIsExpanded(path, {});
      plugin.albumHeaderSetExpanded(path, !open, "");
      return true;
    },
    record: (path) => {
      plugin.recordSheetSetCollapsed(path, !plugin.recordSheetIsCollapsed(path));
      return true;
    },
    area: (path) => { plugin.homeCardSetCollapsed(path, !plugin.homeCardIsCollapsed(path)); return true; },
    project: (path) => { plugin.homeCardSetCollapsed(path, !plugin.homeCardIsCollapsed(path)); return true; },
    notebook: (path) => { plugin.notebookCardSetCollapsed(path, !plugin.notebookCardIsCollapsed(path)); return true; },
    prose: (path) => plugin.proseNoteCardSetExpanded(path, !plugin.proseNoteCardIsExpanded(path)),
    ref: (path) => { plugin.refNoteCardSetCollapsed(path, !plugin.refNoteCardIsCollapsed(path)); return true; },
  };
  const unregister = [];
  for (const kind of Object.keys(toggles)) unregister.push(H.propertyCardRegisterFoldKind(plugin, kind, { toggle: toggles[kind] }));

  for (const item of cases) {
    const { button, view } = foldView(item.kind, item.path);
    for (let i = 0; i < 12; i += 1) {
      button.setAttribute("aria-expanded", i % 2 === 0 ? "true" : "false");
      if (CABINET_FOLD_KINDS.has(item.kind)) {
        // A cabinet row is never the details target; its header click drives
        // the same session-state toggle.
        assert.equal(H.propertyCardToggleDetails(view), false, `${item.kind} cabinet is not a details fold`);
        toggles[item.kind](item.path);
      } else {
        assert.equal(H.propertyCardToggleDetails(view), true, `${item.kind} fold toggle ${i + 1}`);
      }
      plugin[item.host]().refreshReading();
    }
  }

  for (const item of cases.filter((candidate) => candidate.kind === "notebook" || candidate.kind === "prose" || candidate.kind === "ref")) {
    for (let i = 0; i < 12; i += 1) {
      H.propertyCardFootToggle(item.path);
      plugin[item.host]().refreshReading();
    }
  }

  const bankPaintsBeforeConfig = paints.paintBankSetupReading;
  bankSubscription.callback({ results: {} });
  assert.equal(paints.paintBankSetupReading, bankPaintsBeforeConfig, "the config event schedules Bank refresh instead of painting inline");
  const bankTimers = timerQueue.filter((timer) => !timer.cancelled && timer.ms === 100);
  assert.ok(bankTimers.length > 0, "the config event schedules the shared host refresh");
  for (const timer of bankTimers) timer.callback();

  assert.ok(paints.paintBankSetupReading > bankPaintsBeforeConfig);
  assert.ok(paints.paintAlbumHeaderReading >= 12);
  assert.ok(paints.paintRecordSheetReading >= 12);
  assert.ok(paints.paintHomeCardReading >= 24, "Area and Project folds both repaint through the shared home host");
  assert.ok(paints.paintNotebookCardReading >= 24, "Notebook fold and drawer toggles refresh the passive painter");
  assert.ok(paints.paintProseNoteCardReading >= 24, "Prose fold and drawer toggles refresh the passive painter");
  assert.ok(paints.paintRefNoteCardReading >= 24, "Ref fold and drawer toggles refresh the passive painter");
  assert.deepEqual(sideEffects, { writes: 0, spawns: 0 });
  for (const dispose of unregister) dispose();
  plugin.teardownBankSetup();
  plugin.teardownAlbumHeader();
  plugin.teardownRecordSheet();
  plugin.teardownHomeCard();
});

// A small DOM for real cabinet stacks: compound selectors, listeners, click,
// focus, and getElementById over registered roots.
class PassiveText {
  constructor(text, ownerDocument) { this.nodeType = 3; this.nodeValue = String(text); this.ownerDocument = ownerDocument; this.parentNode = null; }
  get textContent() { return this.nodeValue; }
  set textContent(value) { this.nodeValue = String(value); }
}

class PassiveElement {
  constructor(tagName, ownerDocument) {
    this.nodeType = 1;
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.isConnected = true;
    this.disabled = false;
    this.style = {};
    this.classList = {
      add: (...values) => { const names = new Set(this.className.split(/\s+/).filter(Boolean)); values.forEach((value) => names.add(value)); this.className = [...names].join(" "); },
      remove: (...values) => { const names = new Set(values); this.className = this.className.split(/\s+/).filter((value) => value && !names.has(value)).join(" "); },
      contains: (value) => this.className.split(/\s+/).includes(value),
      toggle: (value, force) => {
        const on = force === undefined ? !this.classList.contains(value) : force === true;
        if (on) this.classList.add(value); else this.classList.remove(value);
        return on;
      },
    };
  }
  get className() { return this.getAttribute("class") || ""; }
  set className(value) { this.setAttribute("class", value); }
  get firstChild() { return this.children[0] || null; }
  get textContent() { return this.children.map((child) => child.textContent || "").join(""); }
  set textContent(value) { while (this.firstChild) this.removeChild(this.firstChild); this.appendChild(this.ownerDocument.createTextNode(value)); }
  appendChild(child) { child.parentNode?.removeChild?.(child); child.parentNode = this; this.children.push(child); return child; }
  append(...nodes) { for (const child of nodes) this.appendChild(typeof child === "string" ? this.ownerDocument.createTextNode(child) : child); }
  replaceChildren(...nodes) { while (this.firstChild) this.removeChild(this.firstChild); this.append(...nodes); }
  removeChild(child) { const index = this.children.indexOf(child); if (index >= 0) this.children.splice(index, 1); child.parentNode = null; return child; }
  insertBefore(child, before) { child.parentNode?.removeChild?.(child); const index = this.children.indexOf(before); child.parentNode = this; this.children.splice(index < 0 ? this.children.length : index, 0, child); return child; }
  remove() { this.parentNode?.removeChild?.(this); }
  setAttribute(name, value) { this.attributes.set(String(name), String(value)); }
  getAttribute(name) { return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null; }
  hasAttribute(name) { return this.attributes.has(String(name)); }
  removeAttribute(name) { this.attributes.delete(String(name)); }
  addEventListener(name, callback) { const list = this.listeners.get(name) || []; list.push(callback); this.listeners.set(name, list); }
  removeEventListener(name, callback) { this.listeners.set(name, (this.listeners.get(name) || []).filter((item) => item !== callback)); }
  dispatchEvent() { return true; }
  click() {
    if (this.disabled) return;
    const event = { type: "click", target: this, preventDefault() {}, stopPropagation() {} };
    for (const callback of this.listeners.get("click") || []) callback(event);
  }
  getBoundingClientRect() { return { top: 0, bottom: 24, left: 0, right: 120, width: 120, height: 24 }; }
  scrollIntoView() {}
  contains(node) { return node === this || this.children.some((child) => child.contains?.(node)); }
  focus() { this.ownerDocument.activeElement = this; }
  matches(selector) {
    return String(selector).split(",").some((part) => {
      const value = part.trim();
      const tag = /^([a-z][a-z0-9-]*)/i.exec(value)?.[1];
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      for (const name of value.match(/\.[\w-]+/g) || []) if (!this.classList.contains(name.slice(1))) return false;
      for (const match of value.matchAll(/\[([\w-]+)(?:=['"]?([^'"\]]*)['"]?)?\]/g)) {
        const [, name, expected] = match;
        const actual = this.getAttribute(name);
        if (actual === null || (expected !== undefined && actual !== expected)) return false;
      }
      return true;
    });
  }
  closest(selector) { let node = this; while (node) { if (node.matches?.(selector)) return node; node = node.parentNode; } return null; }
  querySelectorAll(selector) {
    const parts = String(selector).trim().split(/\s+/);
    let scope = [this];
    for (const part of parts) {
      const next = [];
      for (const root of scope) {
        const visit = (node) => { for (const child of node.children || []) { if (child.matches?.(part) && !next.includes(child)) next.push(child); visit(child); } };
        visit(root);
      }
      scope = next;
    }
    return scope;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

class PassiveDocument {
  constructor() { this.activeElement = null; this.roots = []; this.defaultView = { CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } } }; }
  createElement(tag) { return new PassiveElement(tag, this); }
  createTextNode(text) { return new PassiveText(text, this); }
  createDocumentFragment() { return new PassiveElement("#fragment", this); }
  getElementById(id) {
    for (const root of this.roots) {
      if (root.getAttribute?.("id") === id) return root;
      const exact = (root.querySelectorAll?.("[id]") || []).find((node) => node.getAttribute("id") === id);
      if (exact) return exact;
    }
    return null;
  }
}

function passiveKey(key, extra = {}) {
  return {
    key, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false,
    repeat: false, isComposing: false, keyCode: 0, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() {}, stopImmediatePropagation() {},
    ...extra,
  };
}

test("cabinet paint, toggle, pick, cancel, and the footer overlay never write or spawn", () => {
  H.propertyCardCabinetStateResetForTests();
  H.propertyCardCabinetProvidersResetForTests();
  H.propertyCardCabinetPickResetForTests();
  H.propertyCardCabinetPickSetDelayForTests(0);
  const sideEffects = { writes: 0, spawns: 0 };
  const { plugin } = makePlugin(sideEffects, [], []);
  const doc = new PassiveDocument();
  plugin.freshnessStatusEl = doc.createElement("div");
  const path = "Areas/cash.md";
  const source = "---\ntype: \"[[area]]\"\n---\n";
  const builds = { areas: 0, albums: 0 };
  for (const kind of ["areas", "albums"]) {
    H.propertyCardRegisterCabinetProvider(plugin, kind, {
      applies: () => ({ summary: kind === "areas" ? "3 · 1 nested" : "2 · 41 records" }),
      paintKey: () => `${kind}-v1`,
      buildBody({ doc: bodyDoc, container }) {
        builds[kind] += 1;
        const row = bodyDoc.createElement("li");
        row.textContent = `${kind} row`;
        container.appendChild(row);
      },
    });
  }
  const view = { file: { path }, dom: null };
  const paint = () => {
    const card = doc.createElement("section");
    card.className = "bob-property-card";
    card.setAttribute("data-card-kind", "area");
    doc.roots = [card, plugin.freshnessStatusEl];
    const foot = H.propertyCardFootBuildEl(doc, {
      path, disclosureId: "passive-foot", open: false, keyLive: true,
      inventory: { count: 4, rows: [], groups: [], issues: [] },
      handlers: { onToggle: (_path, next) => next },
    });
    card.appendChild(foot.element);
    view.dom = card;
    const stack = H.propertyCardCabinetsAssemble(card, path, foot.element, {
      plugin, view, component: plugin, keyLive: true, source,
      frontmatter: { type: "[[area]]" }, repaint: () => true,
    });
    assert.ok(stack, "the card assembles a cabinet stack");
    return { card, stack };
  };

  // Paint: two closed content cabinets over Properties, no body work yet.
  let { stack } = paint();
  const kinds = () => stack.querySelectorAll("[data-cabinet-kind]").map((panel) => panel.getAttribute("data-cabinet-kind"));
  assert.deepEqual(kinds(), ["areas", "albums", "properties"]);
  assert.deepEqual(builds, { areas: 0, albums: 0 });

  // Toggle: clicking a header opens it in place and builds only that body.
  stack.querySelector("[data-cabinet-kind='areas'] .bob-cabinet-toggle").click();
  assert.equal(H.propertyCardCabinetIsOpen(path, "areas"), true);
  ({ stack } = paint());
  assert.equal(builds.areas >= 1, true);
  assert.equal(builds.albums, 0);
  stack.querySelector("[data-cabinet-kind='areas'] .bob-cabinet-toggle").click();
  assert.equal(H.propertyCardCabinetIsOpen(path, "areas"), false);
  ({ stack } = paint());

  // Pick: `_` with two extras arms the numbered pick and shows the footer
  // overlay; a digit toggles its cabinet and drops the overlay.
  assert.equal(H.propertyCardCabinetUnderscore(view, plugin), true);
  assert.equal(H.propertyCardCabinetPickActive(), true);
  assert.equal(plugin.walkerFooterOverlayStack.length, 1, "the footer overlay is up while armed");
  assert.match(plugin.freshnessStatusEl.textContent, /Cabinets/);
  assert.equal(H.propertyCardCabinetPickOnCaptureKey(passiveKey("1")), false);
  assert.equal(H.propertyCardCabinetPickActive(), false);
  assert.equal(plugin.walkerFooterOverlayStack.length, 0, "the overlay drops on pick");
  assert.equal(H.propertyCardCabinetIsOpen(path, "albums"), true, "1 is the bottom extra");
  ({ stack } = paint());

  // Cancel: Esc, q, and Ctrl+[ disarm without toggling anything; `-` picks
  // Properties.
  for (const event of [passiveKey("Escape"), passiveKey("q"), passiveKey("[", { ctrlKey: true, code: "BracketLeft" })]) {
    assert.equal(H.propertyCardCabinetUnderscore(view, plugin), true);
    assert.equal(H.propertyCardCabinetPickActive(), true);
    H.propertyCardCabinetPickOnCaptureKey(event);
    assert.equal(H.propertyCardCabinetPickActive(), false);
    assert.equal(plugin.walkerFooterOverlayStack.length, 0);
  }
  assert.equal(H.propertyCardCabinetIsOpen(path, "areas"), false);
  assert.equal(H.propertyCardCabinetIsOpen(path, "albums"), true);
  assert.equal(H.propertyCardCabinetUnderscore(view, plugin), true);
  H.propertyCardCabinetPickOnCaptureKey(passiveKey("-"));
  assert.equal(H.propertyCardCabinetPickActive(), false);
  assert.equal(H.propertyCardFootIsOpen(path), true, "- toggles the Properties cabinet");
  paint();

  assert.deepEqual(sideEffects, { writes: 0, spawns: 0 });
  H.propertyCardCabinetPickResetForTests();
  H.propertyCardCabinetProvidersReleasePlugin(plugin);
  H.propertyCardCabinetStateResetForTests();
  H.propertyCardFootResetAll();
});
