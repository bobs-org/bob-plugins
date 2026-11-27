"use strict";

const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownView: class {}, Modal: class {}, Notice: class {}, Plugin: class {},
    Platform: { isDesktopApp: true }, normalizePath: (value) => value, parseYaml: () => ({}),
  };
  if (request === "@codemirror/state") return {};
  if (request === "@codemirror/view") return {};
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers: H } = LedgerToolsPlugin;
Module._load = originalLoad;

class TextNode {
  constructor(text, ownerDocument) { this.nodeType = 3; this.nodeValue = String(text); this.ownerDocument = ownerDocument; this.parentNode = null; }
  get textContent() { return this.nodeValue; }
  set textContent(value) { this.nodeValue = String(value); }
}

class Element {
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
    this.classList = {
      add: (...values) => { const names = new Set(this.className.split(/\s+/).filter(Boolean)); values.forEach((value) => names.add(value)); this.className = [...names].join(" "); },
      remove: (...values) => { const names = new Set(values); this.className = this.className.split(/\s+/).filter((value) => value && !names.has(value)).join(" "); },
      contains: (value) => this.className.split(/\s+/).includes(value),
    };
  }
  get className() { return this.getAttribute("class") || ""; }
  set className(value) { this.setAttribute("class", value); }
  get firstChild() { return this.children[0] || null; }
  get textContent() { return this.children.map((child) => child.textContent || "").join(""); }
  set textContent(value) { while (this.firstChild) this.removeChild(this.firstChild); this.appendChild(this.ownerDocument.createTextNode(value)); }
  appendChild(child) { child.parentNode?.removeChild?.(child); child.parentNode = this; this.children.push(child); return child; }
  removeChild(child) { const index = this.children.indexOf(child); if (index >= 0) this.children.splice(index, 1); child.parentNode = null; return child; }
  insertBefore(child, before) { child.parentNode?.removeChild?.(child); const index = this.children.indexOf(before); child.parentNode = this; this.children.splice(index < 0 ? this.children.length : index, 0, child); return child; }
  remove() { this.parentNode?.removeChild?.(this); this.isConnected = false; }
  setAttribute(name, value) { this.attributes.set(String(name), String(value)); }
  getAttribute(name) { return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null; }
  removeAttribute(name) { this.attributes.delete(String(name)); }
  addEventListener(name, callback) { const list = this.listeners.get(name) || []; list.push(callback); this.listeners.set(name, list); }
  getBoundingClientRect() { return { width: 120, height: 24 }; }
  contains(node) { return node === this || this.children.some((child) => child.contains?.(node)); }
  focus() { this.ownerDocument.activeElement = this; }
  matches(selector) {
    const tag = /^([a-z][a-z0-9-]*)/i.exec(selector)?.[1];
    if (tag && this.tagName !== tag.toUpperCase()) return false;
    for (const name of selector.match(/\.[\w-]+/g) || []) if (!this.classList.contains(name.slice(1))) return false;
    for (const match of selector.matchAll(/\[([\w-]+)(?:=['"]([^'"]*)['"])?\]/g)) {
      const [, name, expected] = match;
      const actual = this.getAttribute(name);
      if (actual === null || (expected !== undefined && actual !== expected)) return false;
    }
    return true;
  }
  closest(selector) { let node = this; while (node) { if (node.matches?.(selector)) return node; node = node.parentNode; } return null; }
  querySelectorAll(selector) {
    const result = [];
    const visit = (node) => { for (const child of node.children || []) { if (child.matches?.(selector)) result.push(child); visit(child); } };
    visit(this);
    return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

class Document {
  constructor() { this.activeElement = null; this.roots = []; }
  createElement(tag) { return new Element(tag, this); }
  createTextNode(text) { return new TextNode(text, this); }
  getElementById(id) {
    for (const root of this.roots) {
      if (root.getAttribute?.("id") === id) return root;
      const found = root.querySelector?.("[id]");
      if (found?.getAttribute?.("id") === id) return found;
      const matches = root.querySelectorAll?.("[id]") || [];
      const exact = matches.find((node) => node.getAttribute("id") === id);
      if (exact) return exact;
    }
    return null;
  }
}

function makeCard(doc, path, withSchema = true) {
  const card = doc.createElement("section");
  card.className = "bob-property-card";
  card.setAttribute("data-card-kind", "area");
  doc.roots = [card];
  if (withSchema) {
    const fold = H.propertyCardBuildFoldRow(doc, {
      kind: "album", path, noun: "Schema", summary: "3 fields", open: false,
      keyLive: true,
      attention: { icon: "⚠", word: "Review", count: 2 },
    });
    card.appendChild(fold.element);
    const body = doc.createElement("div");
    body.setAttribute("id", fold.bodyId);
    body.setAttribute("hidden", "");
    body.textContent = "Schema fields";
    card.appendChild(body);
  }
  const foot = H.propertyCardFootBuildEl(doc, {
    path,
    disclosureId: `foot-${Math.random().toString(16).slice(2)}`,
    open: false,
    keyLive: true,
    inventory: { count: 5, rows: [], groups: [], issues: [] },
    stamp: { state: "valid", text: "Created 2026-11-27", tooltip: "Created stamp" },
    handlers: { onToggle: (_path, next) => next },
  });
  assert.ok(foot?.element);
  return { card, foot };
}

test("closed gate preserves existing fold and Properties markup", () => {
  H.propertyCardCabinetStateResetForTests();
  H.propertyCardCabinetProvidersResetForTests();
  H.propertyCardCabinetsSetGateForTests(false);
  const doc = new Document();
  const fold = H.propertyCardBuildFoldRow(doc, { kind: "album", path: "Areas/work.md", noun: "Schema", open: true });
  const foot = H.propertyCardFootBuildEl(doc, { path: "Areas/work.md", inventory: { count: 2 }, open: false });
  assert.equal(fold.element.getAttribute("data-card-fold-role"), null);
  assert.equal(fold.element.classList.contains("bob-cabinet-head"), false);
  assert.equal(foot.element.classList.contains("bob-cabinet-panel"), false);
  assert.equal(foot.element.querySelector(".bob-cabinet-keycap"), null);
});

test("open gate assembles one ordered stack with accessible lazy, reusable provider bodies", async () => {
  H.propertyCardCabinetStateResetForTests();
  H.propertyCardCabinetProvidersResetForTests();
  H.propertyCardCabinetsSetGateForTests(true);
  const path = "Areas/work.md";
  const view = { file: { path }, dom: null };
  let writes = 0;
  const plugin = { app: { vault: { modify: () => { writes += 1; } } } };
  let builds = 0;
  let applies = 0;
  const unregister = H.propertyCardRegisterCabinetProvider(plugin, "areas", {
    applies(context) {
      applies += 1;
      assert.equal(context.path, path);
      assert.equal(context.species, "area");
      assert.match(context.source, /type: area/);
      assert.equal(context.frontmatter.type, "area");
      return { summary: "3 direct · 1 nested", meta: "4 areas" };
    },
    paintKey: () => "catalog-v1",
    buildBody({ doc, container }) {
      builds += 1;
      const content = doc.createElement("p");
      content.textContent = "Area catalog content";
      container.appendChild(content);
    },
  });

  const assemble = (doc) => {
    const { card, foot } = makeCard(doc, path);
    view.dom = card;
    const stack = H.propertyCardCabinetsAssemble(card, path, foot.element, {
      plugin, view, component: plugin, keyLive: true,
      source: "---\ntype: area\n---\n", frontmatter: { type: "area" },
      repaint: () => true,
    });
    assert.ok(stack);
    return { card, stack };
  };

  const doc = new Document();
  const first = assemble(doc);
  let panels = first.stack.querySelectorAll("[data-cabinet-kind]");
  assert.deepEqual(panels.map((panel) => panel.getAttribute("data-cabinet-kind")), ["areas", "schema", "properties"]);
  const schemaButton = panels[1].querySelector("[data-card-fold-role='cabinet'][data-card-fold]");
  assert.equal(schemaButton.getAttribute("data-card-fold"), "album");
  assert.equal(schemaButton.getAttribute("aria-controls"), panels[1].querySelector(".bob-cabinet-drawer").getAttribute("id"));
  assert.equal(panels[0].querySelector(".bob-cabinet-keycap").textContent, "_2");
  assert.equal(panels[1].querySelector(".bob-cabinet-keycap").textContent, "_1");
  assert.equal(panels[1].querySelector(".bob-cabinet-drawer-inner").getAttribute("inert"), "");
  const propertyButton = panels[2].querySelector(".bob-cabinet-toggle");
  assert.equal(propertyButton.getAttribute("aria-expanded"), "false");
  assert.equal(propertyButton.getAttribute("aria-keyshortcuts"), "-");
  assert.equal(panels[2].querySelector(".bob-cabinet-meta").textContent, "Created 2026-11-27");
  assert.equal(panels[2].querySelector(".bob-cabinet-keycap").textContent, "-");
  assert.equal(builds, 0, "a closed content cabinet has no body work");
  assert.equal(applies, 1);
  assert.equal(H.propertyCardCabinetPaintPick(first.stack, H.propertyCardCabinetNumbering(["areas", "schema"])), true);

  const rows = H.propertyCardCabinetsInView(view);
  assert.deepEqual(rows.extras.map(({ kind, number }) => [kind, number]), [["areas", 2], ["schema", 1]]);
  assert.equal(rows.properties.open, false);
  assert.equal(panels[0].querySelector(".bob-cabinet-keycap").textContent, "2");
  assert.equal(panels[1].querySelector(".bob-cabinet-keycap").textContent, "1");
  assert.equal(panels[2].querySelector(".bob-cabinet-keycap").textContent, "-");
  H.propertyCardCabinetPaintPick(first.stack, null);
  assert.equal(panels[0].querySelector(".bob-cabinet-keycap").textContent, "_2");

  H.propertyCardCabinetSetOpen(path, "areas", true);
  const second = assemble(doc);
  panels = second.stack.querySelectorAll("[data-cabinet-kind]");
  assert.deepEqual(panels.map((panel) => panel.getAttribute("data-cabinet-kind")), ["areas", "schema", "properties"]);
  const originalBody = second.stack.querySelector(".bob-cabinet-provider-content");
  assert.ok(originalBody, "opening lazily builds the provider body");
  assert.equal(builds, 1);
  await Promise.resolve();

  const third = assemble(doc);
  assert.equal(third.stack.querySelector(".bob-cabinet-provider-content"), originalBody, "same paint key reuses the body node");
  assert.equal(builds, 1);
  assert.equal(originalBody.parentNode, third.stack.querySelector(".bob-cabinet-drawer-inner"));
  assert.equal(writes, 0);
  unregister();
  H.propertyCardCabinetStateResetForTests();
  H.propertyCardCabinetsSetGateForTests(false);
});

test("Properties collapse returns focus to the disclosure when focus is in its drawer", () => {
  H.propertyCardCabinetStateResetForTests();
  H.propertyCardCabinetsSetGateForTests(true);
  const doc = new Document();
  const foot = H.propertyCardFootBuildEl(doc, {
    path: "Areas/work.md", disclosureId: "focus-foot", open: true,
    inventory: { count: 1, rows: [], groups: [], issues: [] },
    handlers: { onToggle: (_path, next) => next },
  });
  const inner = foot.drawer.querySelector(".bob-cabinet-drawer-inner");
  const focused = doc.createElement("button");
  inner.appendChild(focused);
  doc.activeElement = focused;
  assert.equal(H.propertyCardCabinetFocusHeadOnClose(foot.disclosure, foot.drawer), true);
  assert.equal(doc.activeElement, foot.disclosure);
  H.propertyCardCabinetsSetGateForTests(false);
});

test("album Schema is closed when healthy under the gate and still resurfaces on problems", () => {
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.albumHeaderExpanded = new Map();
  H.propertyCardCabinetsSetGateForTests(false);
  assert.equal(plugin.albumHeaderIsExpanded("eat.md", { schemaInvalid: false, issues: [] }), true);
  H.propertyCardCabinetsSetGateForTests(true);
  assert.equal(plugin.albumHeaderIsExpanded("eat.md", { schemaInvalid: false, issues: [] }), false);
  assert.equal(plugin.albumHeaderIsExpanded("eat.md", { schemaInvalid: true, issues: [{ severity: "error", message: "bad schema" }] }), true);
  H.propertyCardCabinetsSetGateForTests(false);
});
