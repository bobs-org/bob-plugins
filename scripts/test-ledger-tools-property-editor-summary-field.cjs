// Area and Project Summary setting: the Summary stage edits one line in a
// wrapping soft-line textarea, keeps its live N/140 counter, and saves on
// Shift+Enter like Enter.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin { constructor(app) { this.app = app; } }
const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownView: class {}, Modal: class { constructor(app) { this.app = app; } open() {} close() {} },
    Notice: class {}, Plugin: TestPlugin, Platform: { isDesktopApp: true },
    normalizePath: (value) => value, parseYaml: (text) => JSON.parse(text),
  };
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value } };
  if (request === "@codemirror/view") return {
    EditorView: { updateListener: { of: (listener) => ({ listener }) } },
    keymap: { of: (value) => value },
  };
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
Module._load = originalLoad;
const H = LedgerToolsPlugin.helpers;

class FakeEl {
  constructor(tag, doc) {
    this.tagName = String(tag).toUpperCase();
    this.ownerDocument = doc || null;
    this.parentNode = null;
    this.children = [];
    this.attrs = new Map();
    this.listeners = new Map();
    this.style = {};
    this.value = "";
    this.selectionStart = 0;
    this.selectionEnd = 0;
    this.disabled = false;
    this._text = "";
  }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { this._text = String(value); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  setAttribute(name, value) { this.attrs.set(String(name), String(value)); }
  removeAttribute(name) { this.attrs.delete(name); }
  get classList() {
    const self = this;
    return {
      add: (...names) => self.setAttribute("class", [...new Set([...(self.getAttribute("class") || "").split(/\s+/).filter(Boolean), ...names])].join(" ")),
      contains: (name) => (self.getAttribute("class") || "").split(/\s+/).includes(name),
    };
  }
  addEventListener(type, fn) {
    const rows = this.listeners.get(type) || [];
    rows.push(fn);
    this.listeners.set(type, rows);
  }
  appendChild(node) { node.parentNode = this; this.children.push(node); return node; }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const out = [];
    const visit = (node) => {
      for (const child of node.children || []) {
        if (child.tagName && String(selector).includes(child.tagName.toLowerCase())) out.push(child);
        visit(child);
      }
    };
    visit(this);
    return out;
  }
}

function makeDoc() {
  return { activeElement: null, createElement: (tag) => new FakeEl(tag) };
}

function stageKeyEvent(soft) {
  const input = { getAttribute: () => null };
  const target = {
    getAttribute: () => null,
    closest: (selector) => {
      if (selector === "[data-property-stage-input]") return input;
      if (selector === "[data-soft-line]") return soft ? {} : null;
      return null;
    },
  };
  const event = {
    key: "Enter", shiftKey: true, ctrlKey: false, metaKey: false, altKey: false,
    target, defaultPrevented: false, stopped: false,
    preventDefault() { event.defaultPrevented = true; },
    stopPropagation() { event.stopped = true; },
  };
  return event;
}

test("the Summary stage is a soft-line textarea and the counter is unchanged", () => {
  const doc = makeDoc();
  const host = new FakeEl("div", doc);
  const modal = {};
  const painted = H.propertyEditorPaintSummaryStage(doc, host, {
    stageId: 1, settingId: "summary", value: "A calm area",
    counter: "11/140", warnLong: false, disabled: false, previewText: "",
  }, modal);
  assert.ok(painted && painted.input, "the stage paints");
  assert.equal(painted.input.tagName, "TEXTAREA");
  assert.ok(painted.input.classList.contains("is-summary"));
  assert.ok(painted.input.classList.contains("bob-soft-line"));
  assert.equal(painted.input.getAttribute("data-soft-line"), "true");
  assert.match(host.textContent, /11\/140/);
});

test("a fold note surfaces through the setting notes", () => {
  const doc = makeDoc();
  const host = new FakeEl("div", doc);
  H.propertyEditorPaintSummaryStage(doc, host, {
    stageId: 1, settingId: "summary", value: "A calm area",
    counter: "11/140", warnLong: false, disabled: false, previewText: "",
    helpNote: "Line breaks became spaces — a summary is one line.",
  }, {});
  assert.match(host.textContent, /Line breaks became spaces/);
});

test("Shift+Enter saves on a soft-line Summary and passes through elsewhere", () => {
  let saved = 0;
  const modal = Object.create(H.PropertyEditorModal.prototype);
  modal.stage = { kind: "text", id: 7 };
  modal.propertyEditorProseOffer = () => false;
  modal.propertyEditorMoveStageSuggestion = () => false;
  modal.propertyEditorStageView = () => ({ selectedSuggestion: -1 });
  modal.propertyEditorSaveStage = () => { saved += 1; };
  const soft = stageKeyEvent(true);
  modal.propertyEditorOnKeyDown(soft);
  assert.equal(soft.defaultPrevented, true);
  assert.equal(saved, 1, "Shift+Enter saves on the soft-line summary");
  const plain = stageKeyEvent(false);
  modal.propertyEditorOnKeyDown(plain);
  assert.equal(plain.defaultPrevented, false, "the generic text stage keeps Shift+Enter");
  assert.equal(saved, 1);
});
