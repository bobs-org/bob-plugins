// Card floor (bob-cli-ra rail): dock, append-above, release, and guards.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin {
  constructor(app) { this.app = app; }
}

const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownRenderChild: class {},
      Notice: class {},
      Plugin: TestPlugin,
      Platform: { isDesktopApp: true },
      normalizePath: (value) => value,
    };
  }
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value } };
  if (request === "@codemirror/view") {
    return { EditorView: class {}, keymap: { of: (value) => value } };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { helpers: H } = require("../plugins/bob-ledger-tools/main.js");
Module._load = originalLoad;

class FakeText {
  constructor(text) { this.nodeType = 3; this.nodeValue = String(text); this.parentNode = null; }
  get textContent() { return this.nodeValue; }
}

class FakeNode {
  constructor(tag, doc) {
    this.tagName = String(tag).toUpperCase();
    this.nodeType = 1;
    this.ownerDocument = doc;
    this.parentNode = null;
    this.childNodes = [];
    this.attrs = new Map();
  }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  removeAttribute(name) { this.attrs.delete(name); }
  appendChild(node) {
    if (node.parentNode && typeof node.parentNode.removeChild === "function" && node.parentNode !== this) {
      node.parentNode.removeChild(node);
    } else if (node.parentNode === this) {
      this.childNodes = this.childNodes.filter((c) => c !== node);
    }
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }
  insertBefore(node, ref) {
    if (node.parentNode && typeof node.parentNode.removeChild === "function" && node.parentNode !== this) {
      node.parentNode.removeChild(node);
    } else if (node.parentNode === this) {
      this.childNodes = this.childNodes.filter((c) => c !== node);
    }
    node.parentNode = this;
    const at = ref ? this.childNodes.indexOf(ref) : -1;
    if (at < 0) this.childNodes.push(node);
    else this.childNodes.splice(at, 0, node);
    return node;
  }
  removeChild(node) {
    this.childNodes = this.childNodes.filter((c) => c !== node);
    if (node.parentNode === this) node.parentNode = null;
    return node;
  }
  remove() {
    if (this.parentNode && typeof this.parentNode.removeChild === "function") {
      this.parentNode.removeChild(this);
    } else {
      this.parentNode = null;
    }
  }
}

function makeDoc() {
  return {
    createElement(tag) { return new FakeNode(tag, this); },
    createTextNode(text) { return new FakeText(text); },
  };
}

function makeCard(doc, count = 2) {
  const card = doc.createElement("div");
  for (let i = 0; i < count; i += 1) card.appendChild(doc.createElement("section"));
  return card;
}

function makeRail(doc) {
  const rail = doc.createElement("nav");
  rail.setAttribute("class", "bob-property-card-rail");
  return rail;
}

test("floor constants: link-walk value", () => {
  assert.equal(H.PROPERTY_CARD_FLOOR_ATTR, "data-card-floor");
  assert.equal(H.PROPERTY_CARD_FLOOR_VALUE, "link-walk");
});

test("dock: marks the rail and keeps it last", () => {
  const doc = makeDoc();
  const card = makeCard(doc);
  const rail = makeRail(doc);
  const out = H.propertyCardFloorDock(card, rail);
  assert.equal(out, rail);
  assert.equal(rail.getAttribute("data-card-floor"), "link-walk");
  assert.equal(card.children.at(-1), rail);
  assert.equal(H.propertyCardFloorOf(card), rail);
});

test("dock: replaces an existing direct-child floor", () => {
  const doc = makeDoc();
  const card = makeCard(doc);
  const first = makeRail(doc);
  H.propertyCardFloorDock(card, first);
  assert.equal(card.children.length, 3);
  const second = makeRail(doc);
  H.propertyCardFloorDock(card, second);
  assert.equal(card.children.length, 3, "no duplicate floor");
  assert.equal(card.children.at(-1), second);
  assert.equal(H.propertyCardFloorOf(card), second);
  assert.equal(first.parentNode, null, "the old floor is detached");
});

test("append: inserts above the floor, else appends", () => {
  const doc = makeDoc();
  const card = makeCard(doc);
  const rail = makeRail(doc);
  H.propertyCardFloorDock(card, rail);
  const node = doc.createElement("section");
  const out = H.propertyCardFloorAppend(card, node);
  assert.equal(out, node);
  assert.deepEqual(card.children, [card.children[0], card.children[1], node, rail]);
  const bare = makeCard(doc);
  const tail = doc.createElement("section");
  H.propertyCardFloorAppend(bare, tail);
  assert.equal(bare.children.at(-1), tail);
});

test("release: removes the direct-child floor only", () => {
  const doc = makeDoc();
  const card = makeCard(doc);
  const rail = makeRail(doc);
  H.propertyCardFloorDock(card, rail);
  const removed = H.propertyCardFloorRelease(card);
  assert.equal(removed, rail);
  assert.equal(card.children.length, 2);
  assert.equal(H.propertyCardFloorOf(card), null);
  assert.equal(H.propertyCardFloorRelease(card), null, "second release is null");
});

test("floor ignores nested floors and never throws", () => {
  const doc = makeDoc();
  const card = makeCard(doc);
  const inner = doc.createElement("section");
  card.children[0].appendChild(inner);
  inner.setAttribute("data-card-floor", "link-walk");
  assert.equal(H.propertyCardFloorOf(card), null, "only direct children count");
  assert.equal(H.propertyCardFloorRelease(card), null);
  assert.equal(H.propertyCardFloorDock(null, makeRail(doc)), null);
  assert.equal(H.propertyCardFloorDock(makeCard(doc), null), null);
  assert.equal(H.propertyCardFloorDock({}, {}), null);
  assert.equal(H.propertyCardFloorAppend(null, makeRail(doc)), null);
  assert.equal(H.propertyCardFloorAppend(makeCard(doc), null), null);
  assert.equal(H.propertyCardFloorRelease(null), null);
  const throwing = { get children() { throw new Error("boom"); } };
  assert.equal(H.propertyCardFloorOf(throwing), null);
  assert.equal(H.propertyCardFloorDock(throwing, makeRail(doc)), null);
});

test("rail step items: wraps, tooltip, and source add nothing when absent", () => {
  const doc = makeDoc();
  const rail = H.propertyCardBuildRail(doc, {
    prev: { label: "bob_git", target: "bob_git", wraps: true, tooltip: "]n · wraps to bob_git, first of bob's 3 open projects", source: "authored", ariaLabel: "]n · wraps to bob_git" },
    next: { label: "x", target: "x" },
  });
  assert.ok(rail);
  const prev = rail.items.prev;
  assert.equal(prev.getAttribute("data-source"), "authored");
  assert.equal(prev.getAttribute("title"), "]n · wraps to bob_git, first of bob's 3 open projects");
  assert.equal(prev.getAttribute("aria-label"), "]n · wraps to bob_git");
  const wrap = prev.children.find((c) => c.getAttribute && c.getAttribute("class") === "bob-property-card-rail-wrap");
  assert.ok(wrap, "a wrapping arm adds the quiet wrap span");
  assert.equal(wrap.getAttribute("aria-hidden"), "true");
  assert.equal(wrap.childNodes.map((n) => n.nodeValue).join(""), "↺");
  const next = rail.items.next;
  assert.equal(next.getAttribute("data-source"), null);
  assert.equal(next.getAttribute("title"), null);
  assert.ok(!next.children.some((c) => c.getAttribute && c.getAttribute("class") === "bob-property-card-rail-wrap"));
});
