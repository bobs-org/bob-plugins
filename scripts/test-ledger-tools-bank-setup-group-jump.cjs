// Bank Setup card category-group jumps: Shift+J/K step between group
// labels in painted order, hotkeys match lowercase only, and jumps never
// write. Pure navigation: selection, reveal, and announcement only.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin {
  constructor(app) { this.app = app; }
  addCommand(command) { (this.commands ||= []).push(command); }
  registerEditorExtension() {}
  registerMarkdownPostProcessor() {}
  registerEvent() {}
  registerInterval(handle) { return handle; }
  registerDomEvent() { return { unregister: () => {} }; }
}
class TestNotice { constructor(message) { TestNotice.messages.push(message); } }
TestNotice.messages = [];

const editorInfoField = { info: true };
const editorLivePreviewField = { live: true };
const StateEffect = { define: () => ({ of(value) { return { effect: this, value }; }, is(other) { return this === other; } }) };
class WidgetType {}
class RangeSetBuilder { constructor() { this.rows = []; } add(from, to, deco) { this.rows.push(from, to, deco); } finish() { return this.rows; } }
const Decoration = { none: [], widget: (options) => ({ widget: options.widget, side: options.side }) };
const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownRenderChild: class { constructor(el) { this.containerEl = el; } },
    Notice: TestNotice, Plugin: TestPlugin, Platform: { isDesktopApp: true, isMacOS: false },
    MarkdownView: class MarkdownView {},
    normalizePath: (value) => value, parseYaml: (text) => JSON.parse(text),
    editorInfoField, editorLivePreviewField,
  };
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value }, StateEffect, RangeSetBuilder };
  if (request === "@codemirror/view") return {
    Decoration, WidgetType, ViewPlugin: { fromClass: (cls, options) => ({ cls, options }) }, EditorView: {},
  };
  if (request === "@codemirror/language") return {};
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const H = LedgerToolsPlugin.helpers;
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
      toggle(name, force) {
        if (force === true) this.add(name);
        else if (force === false) this.remove(name);
        else if (this.contains(name)) this.remove(name);
        else this.add(name);
      },
    };
  }
  get className() { return this.getAttribute("class") || ""; }
  set className(value) { this.attrs.set("class", String(value)); }
  get textContent() { return this.nodeType === 3 ? this._text : this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { this._text = String(value); if (this.nodeType === 1) this.children = value ? [new FakeNode("", this.ownerDocument, this._text)] : []; }
  get firstChild() { return this.children[0] || null; }
  get childNodes() { return this.children; }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  removeAttribute(name) { this.attrs.delete(name); }
  appendChild(node) { node.parentNode?.removeChild?.(node); node.parentNode = this; this.children.push(node); return node; }
  removeChild(node) { const i = this.children.indexOf(node); if (i >= 0) this.children.splice(i, 1); node.parentNode = null; return node; }
  empty() { while (this.firstChild) this.removeChild(this.firstChild); }
  addEventListener(type, fn) { const rows = this.listeners.get(type) || []; rows.push(fn); this.listeners.set(type, rows); }
  removeEventListener(type, fn) {
    const rows = (this.listeners.get(type) || []).filter((entry) => entry !== fn);
    this.listeners.set(type, rows);
  }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  focus() { if (!this.disabled) this.ownerDocument.activeElement = this; }
  getBoundingClientRect() { return { left: 0, top: 10, width: 10, height: 10 }; }
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
}

function makeDoc() {
  return {
    activeElement: null,
    createElement(tag) { return new FakeNode(tag, this); },
    createTextNode(text) { return new FakeNode("", this, String(text)); },
  };
}

function configCategory(overrides = {}) {
  return {
    key: "coffee", emoji: "☕", label: "Coffee", builtin: false, declared: true,
    hotkey: "c", hotkey_source: "explicit", group: "Everyday", hidden: false,
    line: 13, source_line: 13, rows: 5, rule_refs: 0, ...overrides,
  };
}

function configReport(overrides = {}) {
  return {
    schema_version: 1, ok: true, state: "valid", teaching_empty: false, partial: false,
    today: "2026-11-15", path: "bank.md", line: 6, fingerprint: "sha256:group-jump",
    accounts: [{ alias: "checking", label: "WF Checking", kind: "checking", default: true, start: "2026-11-11", rows: 11, status: "balanced" }],
    categories: [
      configCategory({ key: "income", emoji: "💵", label: "Income", builtin: true, declared: false, hotkey: "i", hotkey_source: "builtin_default", group: "Money moves", line: null, rows: 1 }),
      configCategory(),
      configCategory({ key: "groceries", emoji: "🛒", label: "Groceries", hotkey: "g", line: 14, source_line: 14, rows: 2 }),
      configCategory({ key: "rent", emoji: "🏠", label: "Rent", hotkey: "1", hotkey_source: "explicit", group: "Bills", line: 15, source_line: 15, rows: 4 }),
      configCategory({ key: "car", emoji: "🚗", label: "Car", hotkey: "k", hotkey_source: "explicit", group: "Bills", line: 16, source_line: 16, rows: 3 }),
      configCategory({ key: "kids", emoji: "🧸", label: "Kids", hotkey: null, hotkey_source: "none", hidden: true, line: 20, rows: 3 }),
    ],
    free_hotkeys: ["b", "j"],
    rules: [
      { index: 0, match: "VENMO", payee: "Venmo", cat: "groceries", link: null, line: 30, source_line: 30 },
    ],
    stale_after: { days: 10, explicit: false, line: null },
    findings: [], issues: { errors: 0, warnings: 0 }, starter: null, ...overrides,
  };
}

function openCard(report = configReport()) {
  const doc = makeDoc();
  const app = {
    document: doc,
    vault: { getAbstractFileByPath: () => null },
    metadataCache: { getFileCache: () => null, getFirstLinkpathDest: () => null },
    workspace: { getLeavesOfType: () => [] },
  };
  const plugin = new LedgerToolsPlugin(app);
  plugin.bankSetupCardActive = true;
  plugin.bankVaultGeneration = 1;
  plugin.apiBankRefresh = async () => ({ report, stale: false, error: null, generation: 1 });
  plugin.apiBankConfigUpdatePreview = async () => ({ ok: true, report: { ok: true, dry_run: true, changed: false, consequence: "ok", per_op: [], warnings: [] } });
  plugin.apiBankConfigUpdateApply = async (envelopeText) => {
    plugin.applyOps = JSON.parse(envelopeText).ops;
    return { ok: true, report: { ok: true, dry_run: false, changed: true } };
  };
  plugin.apiBankConfigVaultSyncRetry = async () => ({ ok: true });
  const modal = new H.BankSetupCardModal(app, { plugin, report });
  modal.contentEl = doc.createElement("div");
  modal.modalEl = modal.contentEl;
  modal.open();
  return { app, plugin, modal, doc, report };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

async function press(modal, event) {
  const target = modal.contentEl.querySelector("[data-setup-card-focus]") || modal.contentEl;
  target.dispatchEvent({ type: "keydown", preventDefault() {}, ...event });
  await tick();
}

function select(modal, id) {
  assert.equal(modal.selectItem(id), true, `select ${id}`);
}

function announcer(modal) {
  return modal.contentEl.querySelector("[data-arrange-announcer]");
}

function announceText(modal) {
  return announcer(modal)?.textContent || "";
}

const PAINTED_IDS = [
  "group:Money moves", "category:income",
  "group:Everyday", "category:coffee", "category:groceries",
  "group:Bills", "category:rent", "category:car",
  "group:hidden", "category:kids",
];

test("group jumps walk painted groups with parent-first K and HIDDEN last", async () => {
  const { modal } = openCard();
  assert.deepEqual(
    H.bankSetupCardPaintedCategoryItems(modal.model, modal.bankPaintArrange).map((item) => item.id),
    PAINTED_IDS,
  );
  const items = H.bankSetupCardPaintedCategoryItems(modal.model, null);
  assert.deepEqual(
    H.bankSetupCardGroupStep(items, { id: "category:coffee" }, "forward")?.id,
    "group:Bills",
  );
  assert.deepEqual(
    H.bankSetupCardGroupStep(items, { id: "category:groceries" }, "back")?.id,
    "group:Everyday",
    "Shift+K from a tile returns to its own group first",
  );
  assert.deepEqual(
    H.bankSetupCardGroupStep(items, { id: "group:Everyday" }, "back")?.id,
    "group:Money moves",
  );
  assert.equal(H.bankSetupCardGroupStep(items, { id: "group:Money moves" }, "back"), null);
  assert.deepEqual(
    H.bankSetupCardGroupStep(items, { id: "category:car" }, "forward")?.id,
    "group:hidden",
    "HIDDEN is the last group",
  );
  assert.equal(H.bankSetupCardGroupStep(items, { id: "group:hidden" }, "forward"), null);
  assert.equal(H.bankSetupCardGroupStep([], { id: "group:Bills" }, "forward"), null);

  select(modal, "category:coffee");
  await press(modal, { key: "J" });
  assert.equal(modal.selection.id, "group:Bills");
  assert.equal(announceText(modal), "Bills, group 3 of 4");
  await press(modal, { key: "J" });
  assert.equal(modal.selection.id, "group:hidden");
  assert.equal(announceText(modal), "HIDDEN, group 4 of 4");
  await press(modal, { key: "J" });
  assert.equal(modal.selection.id, "group:hidden", "the last group Shift+J stays");
  assert.equal(announceText(modal), "No next group");
  await press(modal, { key: "K" });
  assert.equal(modal.selection.id, "group:Bills");
  select(modal, "category:groceries");
  await press(modal, { key: "K" });
  assert.equal(modal.selection.id, "group:Everyday", "a tile Shift+K lands on its own group");
  assert.equal(announceText(modal), "Everyday, group 2 of 4");
  select(modal, "group:Money moves");
  await press(modal, { key: "K" });
  assert.equal(modal.selection.id, "group:Money moves", "the first group Shift+K stays");
  assert.equal(announceText(modal), "No previous group");
  modal.close();
});

test("Shift+K never fires a hotkey while lowercase keys still select", async () => {
  const { modal } = openCard();
  select(modal, "category:coffee");
  await press(modal, { key: "K" });
  assert.equal(modal.selection.id, "group:Everyday", "Shift+K jumps instead of selecting Car");
  await press(modal, { key: "k" });
  assert.equal(modal.selection.id, "category:car", "lowercase k still picks Car");
  await press(modal, { key: "1" });
  assert.equal(modal.selection.id, "category:rent", "1 still picks the first Bills category");
  await press(modal, { key: "C" });
  assert.equal(modal.selection.id, "category:rent", "an uppercase letter selects nothing");
  await press(modal, { key: "K", ctrlKey: true });
  assert.equal(modal.selection.id, "category:rent", "Ctrl+K never jumps");
  modal.close();
});

test("jumps stay inert on other tabs and behind every gate", async () => {
  const { modal } = openCard();
  modal.setSection("accounts");
  const parked = modal.selection.id;
  await press(modal, { key: "J" });
  assert.equal(modal.selection.id, parked, "no jumps on Accounts");
  modal.setSection("rules");
  await press(modal, { key: "K" });
  assert.equal(modal.selection.id, parked, "no jumps on Rules");
  modal.setSection("categories");
  select(modal, "category:coffee");
  // A stage owns the keyboard.
  modal.stage = { kind: "edit" };
  await press(modal, { key: "J" });
  assert.equal(modal.selection.id, "category:coffee", "no jumps in a stage");
  modal.stage = null;
  // Typing in an input never jumps.
  const input = modal.app.document.createElement("input");
  modal.contentEl.appendChild(input);
  input.dispatchEvent({ type: "keydown", preventDefault() {}, key: "J" });
  await tick();
  assert.equal(modal.selection.id, "category:coffee", "no jumps from an input");
  input.parentNode?.removeChild?.(input);
  // Composition and applying stay put.
  await press(modal, { key: "J", isComposing: true });
  assert.equal(modal.selection.id, "category:coffee", "no jumps during composition");
  const kept = modal.sessionState;
  modal.sessionState = { ...kept, status: "applying" };
  await press(modal, { key: "J" });
  assert.equal(modal.selection.id, "category:coffee", "no jumps while applying");
  modal.sessionState = kept;
  // Hint mode swallows unmatched J/K and survives.
  modal.bankHintMode = { scope: "group:Everyday", id: "category:coffee", gaps: [0], labels: ["a"] };
  modal.paint("body");
  await press(modal, { key: "J" });
  assert.equal(modal.selection.id, "category:coffee", "a swallowed J never jumps");
  assert.ok(modal.bankHintMode, "hint mode survives a swallowed J");
  await press(modal, { key: "k" });
  assert.equal(modal.selection.id, "category:coffee", "a swallowed k never hotkeys");
  assert.ok(modal.bankHintMode, "hint mode survives a swallowed k");
  modal.bankHintMode = null;
  modal.close();
});

test("projected group order drives Shift+J and the arrows while dirty", async () => {
  const { modal } = openCard();
  select(modal, "group:Bills");
  assert.equal(modal.bankArrangeNudge(-1, {}), true);
  assert.deepEqual(modal.bankArrangement.projected("groups"), ["Money moves", "Bills", "Everyday"]);
  select(modal, "group:Money moves");
  await press(modal, { key: "J" });
  assert.equal(modal.selection.id, "group:Bills", "Shift+J follows the projected order");
  select(modal, "category:income");
  assert.equal(modal.moveSelection("forward"), true);
  assert.equal(modal.selection.id, "group:Bills", "arrows follow the same painted order");
  assert.equal(modal.moveSelection("back"), true);
  assert.equal(modal.selection.id, "category:income");
  assert.equal(modal.bankArrangeRevert(), true);
  select(modal, "group:Money moves");
  await press(modal, { key: "J" });
  assert.equal(modal.selection.id, "group:Everyday", "revert restores the saved order");
  modal.close();
});

test("current-group label, footer hint, silence, and reduced-motion bumps", async () => {
  const { modal, plugin } = openCard();
  let drafts = 0;
  const session = modal.session;
  const origSetDraft = session.setDraft.bind(session);
  session.setDraft = (...args) => { drafts += 1; return origSetDraft(...args); };
  select(modal, "category:coffee");
  const everyday = modal.contentEl.querySelector('[data-setup-card-group="Everyday"]');
  assert.ok(everyday, "Everyday label paints");
  assert.ok(everyday.classList.contains("is-current-group"), "the owning label lights up");
  assert.equal(
    modal.contentEl.querySelector('[data-setup-card-group="Bills"]').classList.contains("is-current-group"),
    false,
  );
  assert.equal(
    modal.contentEl.querySelector('[data-setup-card-group="__hidden__"]').classList.contains("is-current-group"),
    false,
  );
  select(modal, "category:kids");
  assert.ok(
    modal.contentEl.querySelector('[data-setup-card-group="__hidden__"]').classList.contains("is-current-group"),
    "the HIDDEN label lights up for a hidden tile",
  );
  const hints = H.bankSetupCardHintItems(modal);
  assert.deepEqual(hints[0], { keys: "⏎", label: "edit" });
  assert.deepEqual(hints[1], { keys: "⇧J/K", label: "group" });
  modal.setSection("accounts");
  assert.ok(
    !H.bankSetupCardHintItems(modal).some((item) => item.keys === "⇧J/K"),
    "no group hint on Accounts",
  );
  modal.setSection("categories");
  select(modal, "category:coffee");
  // The jump repaints, so record scrolls on the prototype: the tile
  // block scrolls first, then the heading, and a missing scroller
  // never throws.
  const scrolled = [];
  FakeNode.prototype.scrollIntoView = function (options) {
    scrolled.push([this.getAttribute("data-setup-card-group") || this.getAttribute("class"), options]);
  };
  await press(modal, { key: "J" });
  assert.equal(modal.selection.id, "group:Bills");
  assert.deepEqual(scrolled[0], ["bob-bank-setup-card-tiles", { block: "nearest" }], "the tile block scrolls first");
  assert.deepEqual(scrolled[1], ["Bills", { block: "nearest" }], "the heading stays visible");
  delete FakeNode.prototype.scrollIntoView;
  await press(modal, { key: "J" });
  assert.equal(modal.selection.id, "group:hidden", "a missing scroller never throws");
  await press(modal, { key: "K" });
  assert.equal(drafts, 0, "jumps never draft");
  assert.deepEqual(session.getState().draftOps, [], "no draft ops for any jump");
  assert.equal(plugin.applyOps, undefined, "no apply for any jump");
  // A clamp bumps once, repeats stay silent, reduced motion stays still.
  select(modal, "group:hidden");
  const edge = modal.contentEl.querySelector('[data-setup-card-group="__hidden__"]');
  const bumps = [];
  edge.animate = (frames, options) => { bumps.push({ frames, options }); return {}; };
  await press(modal, { key: "J" });
  assert.equal(bumps.length, 1, "one vertical bump on the clamp");
  assert.deepEqual(bumps[0].frames, [
    { transform: "translateY(0)" },
    { transform: "translateY(3px)" },
    { transform: "translateY(0)" },
  ]);
  assert.equal(bumps[0].options.duration, 90);
  await press(modal, { key: "J", repeat: true });
  assert.equal(bumps.length, 1, "a held key clamps silently after the first bump");
  const savedMatchMedia = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: true });
  try {
    await press(modal, { key: "J" });
  } finally {
    if (savedMatchMedia === undefined) delete globalThis.matchMedia;
    else globalThis.matchMedia = savedMatchMedia;
  }
  assert.equal(bumps.length, 1, "no bump under reduced motion");
  modal.close();
});
