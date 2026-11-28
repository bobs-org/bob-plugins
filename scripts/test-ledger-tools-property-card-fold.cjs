const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");
class TestPlugin { constructor(app) { this.app = app; } }
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
    Notice: class {}, Plugin: TestPlugin,
    Platform: { isDesktopApp: true }, normalizePath: (value) => value,
    editorInfoField, editorLivePreviewField, parseYaml: () => ({}),
  };
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value }, StateEffect, StateField, RangeSetBuilder };
  if (request === "@codemirror/view") return {
    Decoration, WidgetType, ViewPlugin: { fromClass: (cls, options) => ({ cls, options }) }, EditorView,
  };
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers } = LedgerToolsPlugin;
Module._load = originalLoad;

class FoldNode {
  constructor(tag, doc, text = "") {
    this.tagName = tag ? tag.toUpperCase() : "#TEXT";
    this.nodeType = tag ? 1 : 3;
    this.ownerDocument = doc;
    this.parentNode = null;
    this.children = [];
    this.attrs = new Map();
    this.listeners = new Map();
    this.disabled = false;
    this.rect = { width: 20, height: 16 };
    this.scrolls = [];
    this._text = text;
    const self = this;
    this.classList = {
      add(name) { const names = new Set((self.getAttribute("class") || "").split(/\s+/).filter(Boolean)); names.add(name); self.setAttribute("class", [...names].join(" ")); },
      remove(name) { self.setAttribute("class", (self.getAttribute("class") || "").split(/\s+/).filter((item) => item && item !== name).join(" ")); },
      contains(name) { return (self.getAttribute("class") || "").split(/\s+/).includes(name); },
    };
  }
  get textContent() { return this.nodeType === 3 ? this._text : this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { this._text = String(value); if (this.nodeType === 1) this.children = [new FoldNode("", this.ownerDocument, this._text)]; }
  get isConnected() { let item = this; while (item) { if (item.root === true) return true; item = item.parentNode; } return false; }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  removeAttribute(name) { this.attrs.delete(name); }
  appendChild(node) { node.parentNode?.removeChild?.(node); node.parentNode = this; this.children.push(node); return node; }
  removeChild(node) { const index = this.children.indexOf(node); if (index >= 0) this.children.splice(index, 1); node.parentNode = null; return node; }
  remove() { this.parentNode?.removeChild?.(this); }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  matches(selector) {
    const cls = /^\.([\w-]+)$/.exec(selector);
    const attr = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(selector);
    const id = /^#([\w-]+)$/.exec(selector);
    return Boolean((cls && this.classList.contains(cls[1]))
      || (attr && this.attrs.has(attr[1]) && (attr[2] === undefined || this.getAttribute(attr[1]) === attr[2]))
      || (id && this.getAttribute("id") === id[1]));
  }
  querySelectorAll(selector) {
    const found = [];
    const walk = (node) => {
      for (const child of node.children || []) {
        if (child.nodeType === 1 && child.matches(selector)) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  getBoundingClientRect() { return this.rect; }
  addEventListener(type, callback) { const items = this.listeners.get(type) || []; items.push(callback); this.listeners.set(type, items); }
  scrollIntoView(options) { this.scrolls.push(options); }
}

function foldDoc() {
  return {
    createElement(tag) { return new FoldNode(tag, this); },
    createTextNode(text) { return new FoldNode("", this, String(text)); },
  };
}

function root(doc) {
  const node = doc.createElement("div");
  node.root = true;
  return node;
}

// The compact card-details control is the only fold `_` targets directly;
// cabinet rows route by semantic kind through the cabinet router.
function foldButton(doc, path, open = false, compact = true) {
  const button = doc.createElement("button");
  helpers.propertyCardDecorateFoldControl(button, {
    kind: "album", path, open, bodyId: helpers.propertyCardFoldNextId(),
    tooltip: "Toggle album schema (_) ", keyLive: false, compact,
  });
  return button;
}

test("fold state follows species defaults and health-stamped choices", () => {
  assert.equal(Object.hasOwn(helpers.propertyCardSpecies("bank"), "foldDefault"), false);
  assert.equal(Object.hasOwn(helpers.propertyCardSpecies("album"), "foldDefault"), false);
  assert.equal(Object.hasOwn(helpers.propertyCardSpecies("prose"), "foldDefault"), false);
  for (const kind of ["record", "area", "project"]) {
    assert.equal(helpers.propertyCardSpecies(kind).foldDefault, true);
  }
  for (const kind of ["day", "week", "quarter", "year"]) {
    assert.equal(Object.hasOwn(helpers.propertyCardSpecies(kind), "foldDefault"), false);
  }

  assert.equal(helpers.propertyCardFoldResolve({ foldDefault: false }), false);
  assert.equal(helpers.propertyCardFoldResolve({ foldDefault: true }), true);
  assert.equal(helpers.propertyCardFoldResolve({ foldDefault: false, problems: "invalid:a" }), true);
  assert.equal(helpers.propertyCardFoldResolve({ choice: { open: false, problems: "invalid:a" }, problems: "invalid:a" }), false);
  assert.equal(helpers.propertyCardFoldResolve({ choice: { open: true, problems: "invalid:a" }, problems: "invalid:a" }), true);
  assert.equal(helpers.propertyCardFoldResolve({ choice: { open: false, problems: "invalid:a" }, problems: "invalid:b" }), true);

  const restamped = helpers.propertyCardFoldRestamp({ open: false, problems: "invalid:a" }, "");
  assert.deepEqual(restamped, { open: false, problems: "" });
  assert.equal(helpers.propertyCardFoldResolve({ choice: restamped, problems: "", foldDefault: true }), false);
  assert.equal(helpers.propertyCardFoldResolve({ choice: restamped, problems: "invalid:a", foldDefault: true }), true,
    "a later break resurfaces after a healthy paint restamped the choice");
  assert.equal(helpers.propertyCardFoldRestamp({ open: false, problems: "invalid:a" }, "invalid:a").problems, "invalid:a");
});

test("fold target is connected, visible, path-matched, registered, and view-local", () => {
  const doc = foldDoc();
  const plugin = {};
  let calls = 0;
  const unregister = helpers.propertyCardRegisterFoldKind(plugin, "album", {
    toggle(path, view) { calls += 1; assert.equal(path, "eat.md"); assert.ok(view); return true; },
  });
  const ownRoot = root(doc);
  const ownButton = foldButton(doc, "eat.md");
  ownRoot.appendChild(ownButton);
  const view = { file: { path: "eat.md" }, dom: ownRoot };
  assert.equal(ownButton.getAttribute("data-card-fold-role"), "details");
  assert.equal(helpers.propertyCardFoldTarget(view).element, ownButton);
  assert.equal(helpers.propertyCardCanToggleDetails(view), true);

  const cabinetRoot = root(doc);
  const cabinetButton = foldButton(doc, "eat.md", false, false);
  cabinetRoot.appendChild(cabinetButton);
  assert.equal(cabinetButton.getAttribute("data-card-fold-role"), "cabinet");
  assert.equal(helpers.propertyCardCanToggleDetails({ file: { path: "eat.md" }, dom: cabinetRoot }), false,
    "a cabinet row is never the details target");

  const paneRoot = root(doc);
  const paneButton = foldButton(doc, "eat.md");
  paneRoot.appendChild(paneButton);
  assert.equal(helpers.propertyCardFoldTarget({ file: { path: "eat.md" }, dom: paneRoot }).element, paneButton);
  assert.equal(helpers.propertyCardCanToggleDetails({ file: { path: "eat.md" }, dom: root(doc) }), false,
    "the active view cannot see a same-note fold from another pane");

  const embedButton = foldButton(doc, "embed/other.md");
  ownRoot.appendChild(embedButton);
  assert.equal(helpers.propertyCardFoldTarget(view).element, ownButton, "an embed for another note is ignored");

  const hidden = foldButton(doc, "eat.md");
  hidden.rect = { width: 0, height: 0 };
  const hiddenRoot = root(doc);
  hiddenRoot.appendChild(hidden);
  assert.equal(helpers.propertyCardCanToggleDetails({ file: { path: "eat.md" }, dom: hiddenRoot }), false);
  const disabled = foldButton(doc, "eat.md");
  disabled.disabled = true;
  const disabledRoot = root(doc);
  disabledRoot.appendChild(disabled);
  assert.equal(helpers.propertyCardCanToggleDetails({ file: { path: "eat.md" }, dom: disabledRoot }), false);
  const detached = foldButton(doc, "eat.md");
  assert.equal(detached.isConnected, false);
  assert.equal(helpers.propertyCardCanToggleDetails({ file: { path: "eat.md" }, dom: detached }), false);

  const bodyless = doc.createElement("div");
  bodyless.setAttribute("class", "static-fold-row");
  bodyless.setAttribute("aria-expanded", "false");
  const staticRoot = root(doc);
  staticRoot.appendChild(bodyless);
  assert.equal(helpers.propertyCardCanToggleDetails({ file: { path: "eat.md" }, dom: staticRoot }), false);
  assert.equal(helpers.propertyCardFoldTarget(view).element, ownButton);
  assert.equal(helpers.propertyCardToggleDetails({ file: { path: "eat.md" }, dom: root(doc) }), false);
  assert.equal(calls, 0);
  assert.equal(unregister(), true);
  assert.equal(helpers.propertyCardCanToggleDetails(view), false);
});

test("fold row has a live body id, unique mount ids, attention, and a conditional keycap", () => {
  const doc = foldDoc();
  const host = root(doc);
  const first = helpers.propertyCardBuildFoldRow(doc, {
    kind: "album", path: "eat.md", noun: "Schema", summary: "2 fields · 12 restaurants",
    open: false, keyLive: true, tooltip: "Toggle album schema (_) ",
    attention: { icon: "⚠", word: "1 warning", tone: "warn", title: "Needs review", amount: "$900" },
  });
  const body = doc.createElement("div");
  body.setAttribute("id", first.bodyId);
  body.setAttribute("hidden", "");
  host.appendChild(first.element);
  host.appendChild(body);
  // A delegated fold row is a cabinet head: the disclosure control carries
  // the fold identity, and the trailing slot holds attention and the keycap.
  assert.match(first.element.getAttribute("class"), /\bbob-cabinet-head\b/);
  assert.equal(first.control.getAttribute("aria-controls"), first.bodyId);
  assert.equal(host.querySelectorAll(`[id="${first.bodyId}"]`).length, 1);
  assert.equal(first.control.getAttribute("aria-keyshortcuts"), "_");
  assert.equal(first.control.getAttribute("title"), "Toggle album schema (_) ");
  assert.equal(first.element.querySelector(".bob-cabinet-keycap").textContent, "_");
  assert.equal(first.element.querySelector(".bob-cabinet-attention").textContent, "⚠1 warning");
  assert.doesNotMatch(first.element.textContent, /\$900/);

  const second = helpers.propertyCardBuildFoldRow(doc, {
    kind: "album", path: "eat.md", noun: "Schema", summary: "2 fields", open: true, keyLive: false,
  });
  assert.notEqual(second.bodyId, first.bodyId);
  assert.equal(second.control.getAttribute("aria-keyshortcuts"), null);
  assert.equal(second.element.querySelector(".bob-cabinet-keycap").textContent, "",
    "the keycap slot stays in the row but is empty when keys are not live");
});

test("the details command queues a pending reveal that the next open row consumes", async () => {
  const doc = foldDoc();
  const host = root(doc);
  const button = foldButton(doc, "eat.md", false);
  host.appendChild(button);
  let toggles = 0;
  const unregister = helpers.propertyCardRegisterFoldKind({}, "album", {
    toggle(path) { toggles += 1; assert.equal(path, "eat.md"); button.setAttribute("aria-expanded", "true"); return true; },
  });
  const view = { file: { path: "eat.md" }, dom: host };
  assert.equal(helpers.propertyCardToggleDetails(view), true);
  assert.equal(toggles, 1);
  const open = helpers.propertyCardBuildFoldRow(doc, {
    kind: "album", path: "eat.md", noun: "Schema", open: true,
  });
  host.appendChild(open.element);
  await Promise.resolve();
  assert.deepEqual(open.control.scrolls, [{ block: "nearest" }]);
  assert.equal(helpers.propertyCardFoldConsumePendingReveal("eat.md", true), false);
  unregister();
});

test("fold keycap appears only for desktop Live Preview Vim", () => {
  const plugin = { app: { vault: { getConfig: (key) => key === "vimMode" } } };
  assert.equal(helpers.propertyCardFoldKeyLive(plugin, "live-preview"), true);
  assert.equal(helpers.propertyCardFoldKeyLive(plugin, "reading"), false);
  assert.equal(helpers.propertyCardFoldKeyLive({ app: { vault: { getConfig: () => false } } }, "live-preview"), false);
});

test("stored boolean collapse maps to an open/closed choice", () => {
  assert.deepEqual(helpers.propertyCardFoldChoiceFromStored(true), { open: false, problems: "" });
  assert.deepEqual(helpers.propertyCardFoldChoiceFromStored(false), { open: true, problems: "" });
  assert.deepEqual(helpers.propertyCardFoldChoiceFromStored({ open: false, problems: "x" }), { open: false, problems: "x" });
  assert.equal(helpers.propertyCardFoldChoiceFromStored(null), null);
});

test("compact decorate stamps fold attrs, a hidden shell, and a hover keycap", async () => {
  const doc = foldDoc();
  const host = root(doc);
  const button = doc.createElement("button");
  host.appendChild(button);
  const bodyId = helpers.propertyCardFoldNextId();
  assert.equal(helpers.propertyCardDecorateFoldControl(button, {
    kind: "record", path: "eat/nagi.md", open: false, bodyId, compact: true,
    tooltip: "Toggle record details (_)", keyLive: true,
  }), true);
  assert.equal(button.getAttribute("data-card-fold"), "record");
  assert.equal(button.getAttribute("data-card-fold-source"), "eat/nagi.md");
  assert.equal(button.getAttribute("aria-expanded"), "false");
  assert.equal(button.getAttribute("aria-controls"), bodyId);
  assert.equal(button.getAttribute("aria-keyshortcuts"), "_");
  assert.equal(button.getAttribute("title"), "Toggle record details (_)");
  assert.equal(button.classList.contains("bob-property-card-fold-compact"), true);
  assert.equal(button.querySelector(".bob-property-card-fold-keycap").textContent, "_");
  const shell = helpers.propertyCardFoldHiddenBody(doc, bodyId);
  host.appendChild(shell);
  assert.equal(shell.getAttribute("hidden"), "");
  assert.equal(host.querySelectorAll(`[id="${bodyId}"]`).length, 1);

  const unregister = helpers.propertyCardRegisterFoldKind({}, "record", {
    toggle() { button.setAttribute("aria-expanded", "true"); return true; },
  });
  assert.equal(helpers.propertyCardToggleDetails({ file: { path: "eat/nagi.md" }, dom: host }), true);
  const openButton = doc.createElement("button");
  host.appendChild(openButton);
  helpers.propertyCardDecorateFoldControl(openButton, {
    kind: "record", path: "eat/nagi.md", open: true, bodyId: helpers.propertyCardFoldNextId(), compact: true,
  });
  await Promise.resolve();
  assert.deepEqual(openButton.scrolls, [{ block: "nearest" }]);
  unregister();
});
