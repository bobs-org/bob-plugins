// Soft-line field: one stored line that wraps, folds pasted line breaks to
// spaces, and grows to about six lines. Covers fold vectors, paste trim,
// attach attributes and idempotence, beforeinput prevention, the three paste
// fallbacks, skip, the input safety net, and autosize.
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

const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownRenderChild: class { constructor(el) { this.containerEl = el; } },
      Notice: TestNotice, Plugin: TestPlugin, Platform: { isDesktopApp: true },
      normalizePath: (value) => value,
    };
  }
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value } };
  if (request === "@codemirror/view") return { Decoration: {}, WidgetType: class {} };
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const H = LedgerToolsPlugin.helpers;
Module._load = originalLoad;

class FakeArea {
  constructor(doc, execCommand) {
    this.tagName = "TEXTAREA";
    this.ownerDocument = doc || {};
    if (execCommand !== undefined) this.ownerDocument.execCommand = execCommand;
    this.attrs = new Map([["class", ""]]);
    this.listeners = new Map();
    this.style = {};
    this.value = "";
    this.selectionStart = 0;
    this.selectionEnd = 0;
    this.dispatched = [];
  }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  removeAttribute(name) { this.attrs.delete(name); }
  get classList() {
    const self = this;
    return {
      add(name) {
        const xs = new Set((self.getAttribute("class") || "").split(/\s+/).filter(Boolean));
        xs.add(name);
        self.setAttribute("class", [...xs].join(" "));
      },
      contains(name) { return (self.getAttribute("class") || "").split(/\s+/).includes(name); },
    };
  }
  addEventListener(type, fn) {
    const rows = this.listeners.get(type) || [];
    rows.push(fn);
    this.listeners.set(type, rows);
  }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  setRangeText(value, start, end, mode) {
    const current = String(this.value);
    this.value = `${current.slice(0, start)}${value}${current.slice(end)}`;
    const caret = mode === "end" ? start + String(value).length : start;
    this.selectionStart = caret;
    this.selectionEnd = caret;
  }
  dispatchEvent(event) {
    this.dispatched.push(event);
    for (const fn of this.listeners.get(event.type) || []) fn(event);
    return true;
  }
  fire(type, event = {}) {
    const prevented = { value: false };
    const payload = {
      type, target: this, bubbles: true,
      preventDefault() { prevented.value = true; },
      ...event,
    };
    for (const fn of this.listeners.get(type) || []) fn(payload);
    return { payload, prevented: prevented.value };
  }
}

function pasted(text) {
  const event = {
    clipboardData: { getData: () => text },
    defaultPrevented: false,
    preventDefault() { event.defaultPrevented = true; },
  };
  return event;
}

test("fold replaces each break run and its touching spaces with one space", () => {
  assert.deepEqual(H.bobSoftLineFold("a\nb"), { value: "a b", folded: true });
  assert.deepEqual(H.bobSoftLineFold("a\r\nb"), { value: "a b", folded: true });
  assert.deepEqual(H.bobSoftLineFold("a\rb"), { value: "a b", folded: true });
  assert.deepEqual(H.bobSoftLineFold("a\u2028b\u2029c"), { value: "a b c", folded: true });
  assert.deepEqual(H.bobSoftLineFold("a  \n  b"), { value: "a b", folded: true });
  assert.deepEqual(H.bobSoftLineFold("a\n\n\nb"), { value: "a b", folded: true });
  assert.deepEqual(H.bobSoftLineFold("\na\n"), { value: " a ", folded: true });
  assert.deepEqual(H.bobSoftLineFold("a  b\tc"), { value: "a  b\tc", folded: false });
  assert.deepEqual(H.bobSoftLineFold("plain"), { value: "plain", folded: false });
});

test("paste text without a break is untouched; otherwise it is trimmed then folded", () => {
  assert.deepEqual(H.bobSoftLinePasteText("plain text"), { value: "plain text", folded: false });
  assert.deepEqual(H.bobSoftLinePasteText("  a\nb  "), { value: "a b", folded: true });
  assert.deepEqual(H.bobSoftLinePasteText("a\r\nb"), { value: "a b", folded: true });
});

test("attach marks the element once and sets soft-line attributes", () => {
  const area = new FakeArea();
  H.bobSoftLineAttach(area);
  assert.equal(area.getAttribute("data-soft-line"), "true");
  assert.ok(area.classList.contains("bob-soft-line"));
  assert.equal(area.getAttribute("rows"), "1");
  assert.equal(area.getAttribute("wrap"), "soft");
  assert.equal(area.getAttribute("enterkeyhint"), "done");
  assert.equal(area.getAttribute("aria-multiline"), null);
  const before = (area.listeners.get("paste") || []).length;
  H.bobSoftLineAttach(area);
  assert.equal((area.listeners.get("paste") || []).length, before, "wires once");
});

test("beforeinput prevents line-break insertions", () => {
  const area = new FakeArea();
  H.bobSoftLineAttach(area);
  for (const kind of ["insertLineBreak", "insertParagraph"]) {
    const { prevented } = area.fire("beforeinput", { inputType: kind });
    assert.equal(prevented, true, kind);
  }
  const { prevented } = area.fire("beforeinput", { inputType: "insertText" });
  assert.equal(prevented, false);
});

test("paste inserts through execCommand first and calls onFold", () => {
  const inserted = [];
  const area = new FakeArea({}, (command, ui, value) => {
    inserted.push([command, value]);
    area.value = `x${value}y`;
    area.selectionStart = area.selectionEnd = 1 + String(value).length;
    return true;
  });
  const folds = [];
  H.bobSoftLineAttach(area, { onFold: (why) => folds.push(why) });
  const event = pasted("a\nb");
  area.fire("paste", event);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(inserted, [["insertText", "a b"]]);
  assert.deepEqual(folds, ["paste"]);
});

test("paste falls back to setRangeText plus an input event", () => {
  const area = new FakeArea();
  area.value = "axc";
  area.selectionStart = 1;
  area.selectionEnd = 2;
  const folds = [];
  H.bobSoftLineAttach(area, { onFold: (why) => folds.push(why) });
  const seen = [];
  area.addEventListener("input", () => seen.push(area.value));
  const event = pasted("b\nc");
  area.fire("paste", event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(area.value, "ab cc");
  assert.ok(seen.includes("ab cc"), "a bubbling input event follows the fallback");
  assert.deepEqual(folds, ["paste"]);
});

test("paste falls back to a value splice with the caret set", () => {
  const area = new FakeArea();
  area.setRangeText = undefined;
  area.value = "axc";
  area.selectionStart = 1;
  area.selectionEnd = 2;
  const folds = [];
  H.bobSoftLineAttach(area, { onFold: (why) => folds.push(why) });
  const event = pasted("b\nc");
  area.fire("paste", event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(area.value, "ab cc");
  assert.deepEqual([area.selectionStart, area.selectionEnd], [4, 4]);
  assert.deepEqual(folds, ["paste"]);
});

test("skip leaves the paste native", () => {
  const area = new FakeArea();
  area.value = "keep";
  const folds = [];
  H.bobSoftLineAttach(area, { skip: () => true, onFold: () => folds.push("paste") });
  const event = pasted("a\nb");
  area.fire("paste", event);
  assert.equal(event.defaultPrevented, false);
  assert.equal(area.value, "keep");
  assert.deepEqual(folds, []);
});

test("the input safety net folds a slipped break and keeps the caret", () => {
  const area = new FakeArea();
  const folds = [];
  H.bobSoftLineAttach(area, { onFold: (why) => folds.push(why) });
  area.value = "ab\ncd";
  area.selectionStart = 3;
  area.selectionEnd = 3;
  area.fire("input", {});
  assert.equal(area.value, "ab cd");
  assert.deepEqual([area.selectionStart, area.selectionEnd], [3, 3]);
  assert.deepEqual(folds, ["input"]);
});

test("autosize reports css, js, and null", () => {
  const saved = globalThis.CSS;
  try {
    globalThis.CSS = { supports: () => true };
    assert.equal(H.bobSoftLineAutosize(new FakeArea()), "css");
  } finally {
    if (saved === undefined) delete globalThis.CSS;
    else globalThis.CSS = saved;
  }
  const area = new FakeArea();
  area.scrollHeight = 100;
  area.offsetHeight = 30;
  area.clientHeight = 28;
  assert.equal(H.bobSoftLineAutosize(area), "js");
  assert.equal(area.style.height, "102px");
  assert.equal(H.bobSoftLineAutosize({}), null);
});
