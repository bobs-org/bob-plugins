// Bank category Emoji Slot: fused compose/split, retained rename, explicit
// clear, 248g panel key isolation, and fallback without bob-emoji.
const assert = require("node:assert/strict");
const test = require("node:test");
const { LedgerToolsPlugin } = require("./ledger-tools-harness.cjs");

const h = LedgerToolsPlugin.helpers;
const CATEGORIES = [
  { key: "coffee", label: "Coffee", emoji: "☕", hotkey: "c", group: "Everyday", hidden: false },
  { key: "groceries", label: "Groceries", emoji: "🛒", hotkey: "g", group: "Everyday", hidden: false },
  { key: "kids", label: "Kids", emoji: "🧸", hotkey: null, group: null, hidden: true },
];
const FAMILY = "👨‍👩‍👧";
const FLAG = "🇺🇸";

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
    this._className = "";
    const self = this;
    this.classList = {
      add(name) {
        const xs = new Set((self.getAttribute("class") || "").split(/\s+/).filter(Boolean));
        xs.add(name);
        self.setAttribute("class", [...xs].join(" "));
      },
      remove(name) {
        const xs = (self.getAttribute("class") || "").split(/\s+/).filter((x) => x && x !== name);
        self.setAttribute("class", xs.join(" "));
      },
      contains(name) { return (self.getAttribute("class") || "").split(/\s+/).includes(name); },
    };
  }
  get textContent() { return this.nodeType === 3 ? this._text : this.children.map((child) => child.textContent).join(""); }
  set textContent(value) {
    this._text = String(value);
    if (this.nodeType === 1) this.children = [new FakeNode("", this.ownerDocument, this._text)];
  }
  get firstChild() { return this.children[0] || null; }
  get className() { return this._className; }
  set className(value) {
    this._className = String(value || "");
    this.attrs.set("class", this._className);
  }
  setAttribute(name, value) {
    this.attrs.set(name, String(value));
    if (name === "class") this._className = String(value);
  }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  removeAttribute(name) { this.attrs.delete(name); }
  appendChild(node) {
    node.parentNode?.removeChild?.(node);
    node.parentNode = this;
    this.children.push(node);
    return node;
  }
  removeChild(node) {
    const i = this.children.indexOf(node);
    if (i >= 0) this.children.splice(i, 1);
    node.parentNode = null;
    return node;
  }
  empty() { while (this.firstChild) this.removeChild(this.firstChild); }
  addEventListener(type, fn) {
    const rows = this.listeners.get(type) || [];
    rows.push(fn);
    this.listeners.set(type, rows);
  }
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
  closest(selector) {
    let node = this;
    while (node) {
      if (node.nodeType === 1 && node.matches(selector)) return node;
      node = node.parentNode;
    }
    return null;
  }
  querySelectorAll(selector) {
    const found = [];
    const walk = (node) => {
      for (const child of node.children || []) {
        if (child.matches(selector)) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function makeDoc() {
  return {
    activeElement: null,
    createElement(tag) { return new FakeNode(tag, this); },
    createTextNode(text) { return new FakeNode("", this, String(text)); },
  };
}

function event(key, options = {}) {
  return {
    key,
    ctrlKey: options.ctrlKey === true,
    shiftKey: options.shiftKey === true,
    isComposing: false,
    prevented: false,
    stopped: false,
    target: options.target || null,
    preventDefault() { this.prevented = true; this.defaultPrevented = true; },
    stopPropagation() { this.stopped = true; },
  };
}

test("compose and split round-trip fused labels including ZWJ and flags", () => {
  assert.equal(h.albumEmojiSlotFusedToken("Coffee", "☕"), "☕ Coffee");
  assert.equal(h.albumEmojiSlotFusedToken("Coffee", ""), "Coffee");
  assert.equal(h.albumEmojiSlotFusedToken("", "☕"), "☕");
  assert.deepEqual(h.albumSchemaChoiceParts("☕ Coffee"), { emoji: "☕", label: "Coffee" });
  assert.equal(h.albumEmojiSlotFusedToken("Family", FAMILY), `${FAMILY} Family`);
  assert.deepEqual(h.albumSchemaChoiceParts(`${FAMILY} Family`), { emoji: FAMILY, label: "Family" });
  assert.equal(h.albumEmojiSlotFusedToken("USA", FLAG), `${FLAG} USA`);
  assert.deepEqual(h.albumSchemaChoiceParts(`${FLAG} USA`), { emoji: FLAG, label: "USA" });
  assert.equal(h.bankSetupCardComposeLabel({ emoji: "☕", label: "Coffee" }, { label: "Cafe" }), "☕ Cafe");
  assert.equal(h.bankSetupCardComposeLabel({ emoji: "☕", label: "Coffee" }, { label: "Coffee", emoji: "" }), "Coffee");
});

test("a rename keeps the emoji and an explicit clear removes it", () => {
  const entry = { key: "coffee", label: "Coffee", emoji: "☕" };
  const renamed = h.bankSetupCardSetCategoryOp(entry, { label: "Cafe" });
  assert.equal(renamed.op, "category.set");
  assert.equal(renamed.set.label, "☕ Cafe");
  const cleared = h.bankSetupCardSetCategoryOp(entry, { label: "Coffee", emoji: "" });
  assert.equal(cleared.set.label, "Coffee");
  assert.equal(h.bankSetupCardSetCategoryOp(entry, { label: "Coffee" }), null);
  assert.deepEqual(h.bankCategoryNewDraftOp({
    label: "Fast food", emoji: "🍔", group: "Everyday", hotkey: "b",
  }), { op: "category.add", label: "🍔 Fast food", group: "Everyday", hotkey: "b" });
  assert.deepEqual(h.bankCategoryNewDraftOp({
    label: "🍔 Fast food", emoji: "", group: "Everyday", hotkey: "b",
  }), { op: "category.add", label: "🍔 Fast food", group: "Everyday", hotkey: "b" });
});

test("bank vocabulary is every category emoji; siblings skip hidden and the row being edited", () => {
  const vocab = h.bankCategoryEmojiVocabulary(CATEGORIES);
  assert.deepEqual(vocab.map((row) => row.emoji), ["☕", "🛒", "🧸"]);
  const siblings = h.bankCategoryEmojiSiblings(CATEGORIES, "coffee");
  assert.ok(siblings.every((row) => row.emoji !== "☕"));
  assert.ok(siblings.some((row) => row.emoji === "🛒"));
  assert.ok(!siblings.some((row) => row.label === "Kids"));
});

test("an open panel's Enter picks and never files a new category", async () => {
  const modal = new h.BankCategoryCardModal({}, { categories: CATEGORIES });
  modal.newStage = h.bankCategoryNewStageInit(CATEGORIES, "coffee");
  modal.newStage.label = "Snacks";
  let applied = false;
  modal.applyNewCategoryAndFile = async () => { applied = true; return true; };
  modal.bankEmojiSlot = { isOpen: true, optionRows: [], activeIndex: 0 };
  const enter = event("Enter", {
    target: { closest: (sel) => String(sel).includes("bob-emoji-slot") ? {} : null },
  });
  await modal.routeNewCategoryKey(enter);
  assert.equal(applied, false);
  assert.equal(enter.prevented, true);
  assert.ok(modal.newStage);

  const closed = new h.BankCategoryCardModal({}, { categories: CATEGORIES });
  closed.newStage = h.bankCategoryNewStageInit(CATEGORIES, "coffee");
  closed.newStage.label = "Snacks";
  let filed = false;
  closed.applyNewCategoryAndFile = async () => { filed = true; return true; };
  await closed.routeNewCategoryKey(event("Enter"));
  assert.equal(filed, true);
});

test("the fused slot falls back without bob-emoji and keeps the enable-search hint", () => {
  const doc = makeDoc();
  const host = doc.createElement("div");
  const label = doc.createElement("input");
  host.appendChild(label);
  const owner = { app: { document: doc, plugins: { plugins: {} } }, categories: CATEGORIES };
  const slot = h.bankCategoryEmojiSlotMount(host, label, owner, { emoji: "☕" });
  assert.ok(slot);
  assert.equal(slot.fallback, true);
  const fallback = host.querySelector(".bob-emoji-slot-fallback");
  assert.ok(fallback);
  assert.equal(fallback.getAttribute("placeholder"), "Enable Bob Emoji for search");
  assert.equal(fallback.value, "☕");
});

function emojiSlotTestApi() {
  return {
    version: 1,
    search: (query, options = {}) => [{ emoji: "🍕", name: "pizza", alias: "pizza", category: "Food & Drink" }].slice(0, options.limit || 30),
    suggestForLabel: () => [{ emoji: "☕", name: "coffee", alias: "coffee", category: "Food & Drink" }],
    categories: () => ["Food & Drink"],
    browse: () => [{ emoji: "🍕", name: "pizza", alias: "pizza", category: "Food & Drink" }],
    recents: () => [],
    remember: () => true,
  };
}

function mountBankSlot(overrides = {}, slotOptions = {}) {
  const doc = makeDoc();
  const host = doc.createElement("div");
  const label = doc.createElement("input");
  host.appendChild(label);
  const owner = {
    app: { document: doc, plugins: { plugins: { "bob-emoji": { api: emojiSlotTestApi() } } } },
    categories: CATEGORIES,
    onFieldInput: () => {},
    ...overrides,
  };
  const slot = h.bankCategoryEmojiSlotMount(host, label, owner, { emoji: "", ...slotOptions });
  return { doc, host, label, owner, slot };
}

const hintShown = (host) => {
  const hint = host.querySelector(".bob-emoji-slot-hint");
  return Boolean(hint) && hint.getAttribute("hidden") === null;
};

test("the fused hint shows for an empty slot and follows open, pick, and clear", () => {
  const { host, slot } = mountBankSlot();
  assert.ok(slot && !slot.fallback);
  const well = host.querySelector("[data-emoji-well]");
  assert.ok(well, "Bank setup mounts a glyph well");
  assert.equal(well.getAttribute("title"), "Choose an emoji: click, or Tab here and type to search");
  assert.ok(hintShown(host), "an empty, enabled, closed Bank slot shows its hint");

  well.dispatchEvent({ type: "click" });
  assert.equal(hintShown(host), false, "the hint hides while the panel is open");

  const search = host.querySelector(".bob-emoji-slot-search");
  search.dispatchEvent({
    type: "keydown", key: "Enter",
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() {},
  });
  assert.ok(String(slot.glyph).length > 0, "Enter picks the highlighted emoji");
  assert.equal(hintShown(host), false, "the hint stays hidden after a pick");

  host.querySelector("[data-emoji-well]").dispatchEvent({ type: "click" });
  const reopened = host.querySelector(".bob-emoji-slot-search");
  reopened.value = "";
  reopened.dispatchEvent({
    type: "keydown", key: "Backspace",
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() {},
  });
  assert.equal(slot.glyph, "");
  assert.ok(hintShown(host), "Backspace clearing the glyph brings the hint back");
});

test("the hint stays hidden for filled, disabled, and fallback slots; the Category card shows it", () => {
  const filled = mountBankSlot({}, { emoji: "☕" });
  assert.equal(hintShown(filled.host), false, "a pre-filled Bank glyph hides the hint");

  const disabled = mountBankSlot({}, { disabled: true });
  assert.equal(hintShown(disabled.host), false, "a disabled Bank slot hides the hint");

  const fallbackDoc = makeDoc();
  const fallbackHost = fallbackDoc.createElement("div");
  const fallbackLabel = fallbackDoc.createElement("input");
  fallbackHost.appendChild(fallbackLabel);
  const fallbackOwner = { app: { document: fallbackDoc, plugins: { plugins: {} } }, categories: CATEGORIES };
  const fallback = h.bankCategoryEmojiSlotMount(fallbackHost, fallbackLabel, fallbackOwner, { emoji: "" });
  assert.equal(fallback.fallback, true);
  assert.equal(fallbackHost.querySelector(".bob-emoji-slot-hint"), null, "fallback mode builds no hint");

  const categoryApp = { document: makeDoc(), plugins: { plugins: { "bob-emoji": { api: emojiSlotTestApi() } } } };
  const categoryModal = new h.BankCategoryCardModal(categoryApp, { categories: CATEGORIES });
  const categoryDoc = makeDoc();
  const categoryHost = categoryDoc.createElement("div");
  const categoryLabel = categoryDoc.createElement("input");
  categoryHost.appendChild(categoryLabel);
  const categorySlot = h.bankCategoryEmojiSlotMount(categoryHost, categoryLabel, categoryModal, { emoji: "" });
  assert.ok(categorySlot && !categorySlot.fallback);
  assert.equal(categoryHost.querySelector("[data-emoji-well]").getAttribute("title"),
    "Choose an emoji: click, or Tab here and type to search");
  const categoryHint = categoryHost.querySelector(".bob-emoji-slot-hint");
  assert.ok(categoryHint && categoryHint.getAttribute("hidden") === null,
    "an empty Category card slot shows its hint");
});

test("glyph-well stylesheet beats Obsidian button chrome with no hex colors", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const css = fs.readFileSync(path.join(__dirname, "../plugins/bob-ledger-tools/styles.css"), "utf8");
  const marker = "Glyph well: beat Obsidian";
  const start = css.indexOf(marker);
  assert.ok(start !== -1, "the well override block ships in styles.css");
  const slice = css.slice(start, start + 6000);
  assert.ok(slice.includes(".bob-emoji-slot-fused > button.bob-emoji-slot-well"),
    "a fused well selector outranks button:not(.clickable-icon)");
  for (const property of ["box-shadow: none", "background", "padding", "width"]) {
    assert.ok(slice.includes(property), `the well override sets ${property}`);
  }
  assert.ok(slice.includes(".is-empty") && slice.includes("dashed"), "the empty state sets a dashed border");
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(slice), "the new well and hint rules use CSS variables, not hex colors");
});
