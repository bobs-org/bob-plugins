// Property-card identity kit (bob-cli-o6 identity-kit): species registry,
// glyph tiles, title block, docked rail, and the offline preview fixtures.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin {
  constructor(app) { this.app = app; }
  registerEditorExtension(extension) { (this.extensions ||= []).push(extension); }
  registerMarkdownPostProcessor(handler, order) { (this.postProcessors ||= []).push({ handler, order }); }
  registerEvent(ref) { (this.events ||= []).push(ref); return ref; }
}

const editorInfoField = { info: true };
const editorLivePreviewField = { live: true };
const StateEffect = { define: () => { const type = { of(value) { return { type, value, is: (other) => other === type }; } }; return type; } };
class WidgetType {}
class RangeSetBuilder { constructor() { this.rows = []; } add(from, to, deco) { this.rows.push({ from, to, deco }); } finish() { return this.rows; } }
const Decoration = { none: [], widget: (options) => ({ ...options }) };
const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownRenderChild: class { constructor(el) { this.containerEl = el; } },
    Notice: class {}, Plugin: TestPlugin, Platform: { isDesktopApp: true },
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
const { helpers: H } = LedgerToolsPlugin;
Module._load = originalLoad;
const { buildCases, caseSpecs } = require("./preview-title-block.cjs");
const { previewDocument } = require("./preview-property-cards.cjs");

class FakeText {
  constructor(text, doc) { this.nodeType = 3; this.nodeValue = String(text); this.ownerDocument = doc; this.parentNode = null; }
  get textContent() { return this.nodeValue; }
  set textContent(value) { this.nodeValue = String(value); }
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
  set textContent(value) { this.childNodes = []; this.appendChild(this.ownerDocument.createTextNode(value)); }
  get nextElementSibling() {
    const siblings = this.parentNode?.children || [];
    return siblings[siblings.indexOf(this) + 1] || null;
  }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  removeAttribute(name) { this.attrs.delete(name); }
  hasAttribute(name) { return this.attrs.has(name); }
  appendChild(node) { node.parentNode?.removeChild?.(node); node.parentNode = this; this.childNodes.push(node); return node; }
  removeChild(node) { const i = this.childNodes.indexOf(node); if (i >= 0) this.childNodes.splice(i, 1); node.parentNode = null; return node; }
  contains(node) { return node === this || this.childNodes.some((child) => child.contains(node)); }
  addEventListener(type, callback) { const list = this.listeners.get(type) || []; list.push(callback); this.listeners.set(type, list); }
  fire(type, extra = {}) {
    const event = { type, button: 0, defaultPrevented: false, order: [], ...extra };
    event.preventDefault = () => { event.defaultPrevented = true; event.order.push("preventDefault"); };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }
  matches(selector) {
    return String(selector).split(",").some((raw) => {
      const part = raw.trim();
      const tag = /^([a-z][a-z0-9-]*)/i.exec(part)?.[1];
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      for (const cls of part.match(/\.[\w-]+/g) || []) if (!this.classList.contains(cls.slice(1))) return false;
      for (const [, name, value] of part.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
        if (!this.hasAttribute(name)) return false;
        if (value !== undefined && this.getAttribute(name) !== value) return false;
      }
      return true;
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
}

function makeDoc() {
  return {
    createElement(tag) { return new FakeNode(tag, this); },
    createTextNode(text) { return new FakeText(text, this); },
  };
}

const classes = (node) => node.className.split(/\s+/).filter(Boolean);

test("registry covers seven frozen species with words, tiles, icons, and bands", () => {
  assert.equal(H.PROPERTY_CARD_KIND_ATTR, "data-card-kind");
  assert.deepEqual([...H.PROPERTY_CARD_KINDS], ["album", "record", "day", "week", "quarter", "year", "bank"]);
  const expected = {
    album: ["Album", "stack", "library", "", false],
    record: ["Record", "sheet", "file-text", "", false],
    day: ["Day", "leaf", "calendar", "", true],
    week: ["Week", "leaf", "calendar-range", "WEEK", true],
    quarter: ["Quarter", "leaf", "calendar-range", "QTR", true],
    year: ["Year", "leaf", "calendar-range", "YEAR", true],
    bank: ["Bank", "plain", "landmark", "", false],
  };
  for (const kind of H.PROPERTY_CARD_KINDS) {
    const species = H.propertyCardSpecies(kind);
    assert.ok(Object.isFrozen(species), `${kind} is frozen`);
    const [word, tile, icon, band, temporal] = expected[kind];
    assert.deepEqual({ ...species }, { kind, word, tile, icon, band, temporal });
    assert.throws(() => { "use strict"; species.word = "x"; });
  }
  for (const value of ["notebook", "", "ALBUM", "toString", null, undefined, 3]) {
    assert.equal(H.propertyCardSpecies(value), null, String(value));
  }
});

test("accessible names lead with the species word", () => {
  assert.equal(H.propertyCardAccessibleName("album", "Restaurants"), "Album: Restaurants");
  assert.equal(H.propertyCardAccessibleName("day", "Fri, Nov 20, 2026"), "Day: Fri, Nov 20, 2026");
  assert.equal(H.propertyCardAccessibleName("week", "  2026-W47 \n"), "Week: 2026-W47");
  assert.equal(H.propertyCardAccessibleName("bank", ""), "Bank");
  assert.equal(H.propertyCardAccessibleName("record", null), "Record");
  assert.equal(H.propertyCardAccessibleName("notebook", "Ideas"), "Ideas");
});

test("applyIdentity stamps kind, label, and a group role without replacing one", () => {
  const doc = makeDoc();
  const card = doc.createElement("div");
  assert.equal(H.propertyCardApplyIdentity(card, { kind: "album", title: "Restaurants" }), true);
  assert.equal(card.getAttribute("data-card-kind"), "album");
  assert.equal(card.getAttribute("aria-label"), "Album: Restaurants");
  assert.equal(card.getAttribute("role"), "group");

  const region = doc.createElement("section");
  region.setAttribute("role", "region");
  assert.equal(H.propertyCardApplyIdentity(region, { kind: "day", title: "Fri, Nov 20, 2026" }), true);
  assert.equal(region.getAttribute("role"), "region");
  assert.equal(region.getAttribute("aria-label"), "Day: Fri, Nov 20, 2026");

  const untouched = doc.createElement("div");
  assert.equal(H.propertyCardApplyIdentity(untouched, { kind: "notebook", title: "x" }), false);
  assert.equal(untouched.attrs.size, 0);
  assert.equal(H.propertyCardApplyIdentity(null, { kind: "album" }), false);
});

test("glyph tiles: every form, emoji versus icon fallback, and leaf band/value", () => {
  const doc = makeDoc();
  const forms = { album: "stack", record: "sheet", bank: "plain", day: "leaf", week: "leaf", quarter: "leaf", year: "leaf" };
  for (const [kind, form] of Object.entries(forms)) {
    const tile = H.propertyCardBuildGlyphTile(doc, { kind });
    assert.equal(tile.tagName, "SPAN");
    assert.deepEqual(classes(tile), ["bob-property-card-tile"]);
    assert.equal(tile.getAttribute("data-tile-form"), form, kind);
    assert.equal(tile.getAttribute("aria-hidden"), "true");
  }
  const emoji = H.propertyCardBuildGlyphTile(doc, { kind: "album", emoji: "🍽" });
  const glyph = emoji.querySelector(".bob-property-card-tile-glyph");
  assert.equal(glyph.textContent, "🍽");
  assert.equal(glyph.getAttribute("data-icon"), null);

  const icon = H.propertyCardBuildGlyphTile(doc, { kind: "album", emoji: "  " });
  const iconGlyph = icon.querySelector(".bob-property-card-tile-glyph");
  assert.equal(iconGlyph.getAttribute("data-icon"), "library");
  assert.equal(iconGlyph.textContent, "", "setIcon is unavailable in tests, so the glyph stays empty");
  assert.equal(H.propertyCardBuildGlyphTile(doc, { kind: "record" }).querySelector(".bob-property-card-tile-glyph").getAttribute("data-icon"), "file-text");
  assert.equal(H.propertyCardBuildGlyphTile(doc, { kind: "bank", icon: "wallet" }).querySelector(".bob-property-card-tile-glyph").getAttribute("data-icon"), "wallet");

  const day = H.propertyCardBuildGlyphTile(doc, { kind: "day", band: "FRI", value: "20" });
  assert.deepEqual(day.children.map((node) => classes(node)[0]), ["bob-property-card-tile-band", "bob-property-card-tile-value"]);
  assert.equal(day.querySelector(".bob-property-card-tile-band").textContent, "FRI");
  assert.equal(day.querySelector(".bob-property-card-tile-value").textContent, "20");
  assert.equal(day.querySelector(".bob-property-card-tile-glyph"), null);
  const week = H.propertyCardBuildGlyphTile(doc, { kind: "week", value: "47" });
  assert.equal(week.querySelector(".bob-property-card-tile-band").textContent, "WEEK");
  assert.equal(H.propertyCardBuildGlyphTile(doc, { kind: "quarter", value: "Q4" }).querySelector(".bob-property-card-tile-band").textContent, "QTR");
  const year = H.propertyCardBuildGlyphTile(doc, { kind: "year", value: "2026" });
  assert.equal(year.querySelector(".bob-property-card-tile-band").textContent, "YEAR");
  assert.equal(year.querySelector(".bob-property-card-tile-value").getAttribute("data-value-length"), "4");

  assert.equal(H.propertyCardBuildGlyphTile(doc, { kind: "notebook" }), null);
  assert.equal(H.propertyCardBuildGlyphTile(null, { kind: "album" }), null);
});

test("title block: kicker, links, single heading, pill, subtitle, and actions slot", () => {
  const doc = makeDoc();
  const calls = [];
  const block = H.propertyCardBuildTitleBlock(doc, {
    kind: "album",
    title: "Restaurants",
    kicker: [{ text: "Body", target: "body" }, { text: "Food" }, { text: "Gone", target: "gone", unresolved: true }, { text: "  " }],
    pill: { text: "TODAY", tone: "solid" },
    subtitle: "Restaurants Kelly and I have tried.",
    tile: { emoji: "🍽" },
    onLink: (target, event) => { event.order.push(`onLink:${target}`); calls.push(target); },
  });
  const el = block.element;
  assert.deepEqual(classes(el), ["bob-property-card-title-block"]);
  assert.equal(el.getAttribute("data-card-kind"), "album");
  assert.equal(el.children[0], block.tile);
  assert.equal(block.tile.getAttribute("data-tile-form"), "stack");
  const main = el.children[1];
  assert.deepEqual(classes(main), ["bob-property-card-title-main"]);
  assert.deepEqual(main.children.map((node) => classes(node)[0]), [
    "bob-property-card-kicker-row", "bob-property-card-title-row", "bob-property-card-subtitle",
  ]);
  const kickerRow = main.children[0];
  assert.deepEqual(kickerRow.children, [block.kicker, block.actions]);
  assert.equal(block.actions.children.length, 0);
  assert.deepEqual(classes(block.actions), ["bob-property-card-actions"]);

  const parts = block.kicker.children;
  assert.deepEqual(parts.map((node) => classes(node)[0]), [
    "bob-property-card-kicker-species",
    "bob-property-card-kicker-sep", "bob-property-card-kicker-link",
    "bob-property-card-kicker-sep", "bob-property-card-kicker-part",
    "bob-property-card-kicker-sep", "bob-property-card-kicker-link",
  ]);
  assert.equal(parts[0].textContent, "Album");
  for (const sep of block.kicker.querySelectorAll(".bob-property-card-kicker-sep")) {
    assert.equal(sep.getAttribute("aria-hidden"), "true");
    assert.equal(sep.textContent, "·");
  }
  const link = parts[2];
  assert.equal(link.tagName, "A");
  assert.equal(link.getAttribute("data-href"), "body");
  assert.equal(link.getAttribute("href"), "body");
  assert.ok(!link.classList.contains("internal-link"), "kit links never take Obsidian's internal-link handling");
  assert.ok(!link.classList.contains("is-unresolved"));
  assert.ok(parts[6].classList.contains("is-unresolved"));
  assert.equal(parts[4].tagName, "SPAN");
  assert.equal(parts[4].textContent, "Food");

  const click = link.fire("click", { metaKey: true });
  assert.deepEqual(click.order, ["preventDefault", "onLink:body"]);
  assert.equal(click.metaKey, true);
  const right = link.fire("auxclick", { button: 2 });
  assert.equal(right.defaultPrevented, false);
  link.fire("auxclick", { button: 1 });
  assert.deepEqual(calls, ["body", "body"]);

  const headings = el.querySelectorAll("[role=\"heading\"]");
  assert.equal(headings.length, 1);
  assert.equal(headings[0], block.heading);
  assert.equal(block.heading.getAttribute("aria-level"), "1");
  assert.equal(el.querySelectorAll("[aria-level=\"1\"]").length, 1);
  assert.equal(block.heading.textContent, "Restaurants");
  assert.equal(block.pill.getAttribute("data-pill-tone"), "solid");
  assert.equal(block.pill.textContent, "TODAY");
  assert.equal(block.subtitle.textContent, "Restaurants Kelly and I have tried.");

  const outline = H.propertyCardBuildTitleBlock(doc, { kind: "day", title: "Thu, Nov 19, 2026", pill: { text: "YESTERDAY", tone: "outline" } });
  assert.equal(outline.pill.getAttribute("data-pill-tone"), "outline");
  const odd = H.propertyCardBuildTitleBlock(doc, { kind: "week", title: "2026-W47", pill: { text: "THIS WEEK", tone: "loud" } });
  assert.equal(odd.pill.getAttribute("data-pill-tone"), "solid");

  const bare = H.propertyCardBuildTitleBlock(doc, { kind: "bank", title: "Setup", subtitle: "  ", pill: { text: "" } });
  assert.equal(bare.subtitle, null);
  assert.equal(bare.pill, null);
  assert.equal(bare.element.querySelector(".bob-property-card-subtitle"), null);
  assert.equal(bare.element.querySelector(".bob-property-card-pill"), null);
  assert.ok(bare.actions);
  assert.equal(bare.kicker.children.length, 1);
  assert.equal(bare.kicker.textContent, "Bank");
});

test("title block keeps markup-looking text literal and fails closed", () => {
  const doc = makeDoc();
  const block = H.propertyCardBuildTitleBlock(doc, {
    kind: "record", title: "<img src=x onerror=alert(1)> & [[link]]",
    kicker: [{ text: "<b>Album</b>", target: "eat" }], subtitle: "<i>sub</i>",
  });
  assert.equal(block.heading.children.length, 0, "the heading holds only a text node");
  assert.equal(block.heading.textContent, "<img src=x onerror=alert(1)> & [[link]]");
  assert.equal(block.kicker.querySelector(".bob-property-card-kicker-link").textContent, "<b>Album</b>");
  assert.equal(block.subtitle.children.length, 0);
  assert.equal(H.propertyCardBuildTitleBlock(doc, { kind: "notebook", title: "x" }), null);
  assert.equal(H.propertyCardBuildTitleBlock(doc, { kind: "album", title: "   " }), null);
  assert.equal(H.propertyCardBuildTitleBlock(doc, { kind: "album" }), null);
  assert.equal(H.propertyCardBuildTitleBlock(null, { kind: "album", title: "x" }), null);
  assert.equal(H.propertyCardBuildTitleBlock({}, { kind: "album", title: "x" }), null);
});

test("rail: empty is null, gaps hold columns, labels, children, and navigation", () => {
  const doc = makeDoc();
  assert.equal(H.propertyCardBuildRail(doc, {}), null);
  assert.equal(H.propertyCardBuildRail(doc, { prev: { label: "", target: "x" }, children: [] }), null);
  assert.equal(H.propertyCardBuildRail(null, { prev: { label: "Thu 19", target: "x" } }), null);

  const navigated = [];
  const rail = H.propertyCardBuildRail(doc, {
    prev: { label: "Thu 19", shortLabel: "Thu", target: "2026/20261119", ariaLabel: "Previous day" },
    next: { label: "Sat 21", target: "2026/20261121", unresolved: true },
    onNavigate: (direction, item, event) => { event.order.push(`nav:${direction}`); navigated.push([direction, item.target]); },
  });
  assert.equal(rail.element.tagName, "NAV");
  assert.equal(rail.element.getAttribute("aria-label"), "Note navigation");
  const row = rail.element.children[0];
  assert.deepEqual(classes(row), ["bob-property-card-rail-row"]);
  assert.deepEqual(row.children.map((node) => [node.tagName, classes(node)[0], node.getAttribute("data-rail")]), [
    ["A", "bob-property-card-rail-item", "prev"],
    ["SPAN", "bob-property-card-rail-gap", "parent"],
    ["A", "bob-property-card-rail-item", "next"],
  ]);
  assert.equal(rail.items.parent, null);
  assert.equal(rail.children.length, 0);
  assert.equal(rail.element.querySelector(".bob-property-card-rail-children"), null);

  const prev = rail.items.prev;
  assert.equal(prev.getAttribute("data-href"), "2026/20261119");
  assert.equal(prev.getAttribute("href"), "2026/20261119");
  assert.equal(prev.getAttribute("aria-label"), "Previous day");
  assert.ok(!prev.classList.contains("internal-link"));
  assert.equal(prev.children[0].textContent, "‹ ");
  assert.equal(prev.children[0].getAttribute("aria-hidden"), "true");
  assert.equal(prev.querySelector(".bob-property-card-rail-label-wide").textContent, "Thu 19");
  assert.equal(prev.querySelector(".bob-property-card-rail-label-narrow").textContent, "Thu");
  const next = rail.items.next;
  assert.ok(next.classList.contains("is-unresolved"));
  assert.equal(next.querySelector(".bob-property-card-rail-label-narrow").textContent, "Sat 21", "narrow falls back to wide");
  assert.equal(next.children[next.children.length - 1].textContent, " ›");
  assert.equal(next.getAttribute("aria-label"), null);

  const event = prev.fire("click");
  assert.deepEqual(event.order, ["preventDefault", "nav:prev"]);
  next.fire("click");
  assert.deepEqual(navigated, [["prev", "2026/20261119"], ["next", "2026/20261121"]]);

  const children = H.propertyCardBuildRail(doc, {
    label: "Week navigation",
    parent: { label: "2026-Q4", target: "2026/2026-Q4" },
    children: [
      { label: "Thu 19", target: "2026/20261119" },
      { label: "Fri 20", target: "2026/20261120", current: true },
      { label: "Sat 21", target: "2026/20261121", unresolved: true },
      { label: "", target: "skip" },
    ],
    onNavigate: (direction, item) => navigated.push([direction, item.target]),
  });
  assert.equal(children.element.getAttribute("aria-label"), "Week navigation");
  assert.equal(children.items.parent.children[0].textContent, "↑ ");
  assert.equal(children.element.querySelectorAll(".bob-property-card-rail-gap").length, 2);
  const strip = children.element.querySelector(".bob-property-card-rail-children");
  assert.equal(strip.getAttribute("role"), "list");
  assert.equal(children.children.length, 3);
  for (const chip of children.children) {
    assert.equal(chip.tagName, "A");
    assert.equal(chip.getAttribute("role"), "listitem");
  }
  assert.ok(children.children[1].classList.contains("is-current"));
  assert.equal(children.children[1].getAttribute("aria-current"), "true");
  assert.equal(children.children[0].getAttribute("aria-current"), null);
  assert.ok(children.children[2].classList.contains("is-unresolved"));
  children.children[1].fire("click");
  children.items.parent.fire("click");
  assert.deepEqual(navigated.slice(-2), [["child", "2026/20261120"], ["parent", "2026/2026-Q4"]]);

  const childrenOnly = H.propertyCardBuildRail(doc, { children: [{ label: "Q1", target: "2026/2026-Q1" }] });
  assert.equal(childrenOnly.element.querySelectorAll(".bob-property-card-rail-gap").length, 3);
});

test("preview fixtures build offline with the real kit builders", () => {
  const cases = buildCases(H, previewDocument());
  const names = cases.map((item) => item.name);
  for (const spec of caseSpecs()) assert.ok(names.includes(spec.name), spec.name);
  assert.deepEqual(names.filter((name) => name.startsWith("gray-")), ["gray-album", "gray-record", "gray-day-today"]);
  for (const item of cases) {
    assert.ok(item.card.classList.contains("bob-property-card"), item.name);
    assert.equal(item.card.getAttribute("data-card-kind"), item.kind, item.name);
    assert.ok(item.card.getAttribute("aria-label").startsWith(`${H.propertyCardSpecies(item.kind).word}`), item.name);
    assert.equal(item.card.querySelectorAll(".bob-property-card-title").length, 1, item.name);
    assert.equal(item.card.querySelector(".bob-property-card-kicker-species").textContent, H.propertyCardSpecies(item.kind).word);
  }
  const grayTitles = cases.filter((item) => item.grayscale).map((item) => item.title);
  assert.deepEqual(new Set(grayTitles).size, 1, "grayscale twins share one title");
  const week = cases.find((item) => item.name === "week").card;
  assert.equal(week.querySelectorAll(".bob-property-card-rail-chip").length, 7);
  assert.equal(week.querySelectorAll(".bob-property-card-rail-chip.is-current").length, 1);
  const icon = cases.find((item) => item.name === "album-icon").card;
  assert.equal(icon.querySelector(".bob-property-card-tile-glyph").getAttribute("data-icon"), "library");
});
