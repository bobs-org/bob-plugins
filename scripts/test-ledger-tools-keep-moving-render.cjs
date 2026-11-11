const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class StubWidgetType {}
class StubPlugin { constructor(app) { this.app = app; } }
class Element {
  constructor(tag) {
    this.tag = tag;
    this.attributes = {};
    this.children = [];
    this.listeners = {};
    this.classList = { remove: (name) => {
      this.attributes.class = String(this.attributes.class || "").split(/\s+/).filter((item) => item !== name).join(" ");
    } };
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  appendChild(node) { this.children.push(node); }
  addEventListener(name, listener) { this.listeners[name] = listener; }
}

const originalLoad = Module._load;
Module._load = function loadWithKeepMovingWidgetStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownView: class {},
    Notice: class {},
    Platform: { isDesktopApp: true },
    Plugin: StubPlugin,
    normalizePath: (value) => value,
    parseYaml: () => ({}),
  };
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value } };
  if (request === "@codemirror/view") return {
    EditorView: { updateListener: { of: (listener) => ({ listener }) } },
    keymap: { of: (value) => value },
    WidgetType: StubWidgetType,
  };
  return originalLoad.call(this, request, parent, isMain);
};
const Plugin = require("../plugins/bob-ledger-tools/main.js");
Module._load = originalLoad;
const h = Plugin.helpers;

test("keep-moving widget positions the caret and opens its project from a modifier click", () => {
  const oldDocument = global.document;
  const oldWindow = global.window;
  const timers = [];
  global.document = {
    createElement: (tag) => new Element(tag),
    createTextNode: (text) => ({ textContent: String(text) }),
  };
  global.window = { setTimeout: (fn, delay) => { timers.push({ fn, delay }); return timers.length; } };
  try {
    const opened = [];
    const workspace = { openLinkText: (...args) => opened.push(args) };
    const widget = new h.KeepMovingMarkWidget({
      count: 2, blockId: "close", projectPath: "job_email_recruiters.md",
      projectStem: "job_email_recruiters", tick: true,
      rows: [{ title: "Write the brief", lane: "Ready" }],
    }, "2026/20261102.md", workspace);
    assert.equal(widget.eq(new h.KeepMovingMarkWidget({
      count: 2, blockId: "close", projectPath: "job_email_recruiters.md",
      projectStem: "job_email_recruiters", tick: true,
      rows: [{ title: "Write the brief", lane: "Ready" }],
    }, "2026/20261102.md", workspace)), true);
    assert.equal(widget.eq(new h.KeepMovingMarkWidget({
      count: 3, blockId: "close", projectPath: "job_email_recruiters.md",
      projectStem: "job_email_recruiters", tick: true,
      rows: [{ title: "Write the brief", lane: "Ready" }],
    }, "2026/20261102.md", workspace)), false);

    const dispatches = [];
    let focused = 0;
    const view = {
      posAtDOM: () => 41,
      dispatch: (value) => dispatches.push(value),
      focus: () => { focused += 1; },
    };
    const dom = widget.toDOM(view);
    assert.equal(dom.attributes.role, "img");
    assert.equal(dom.attributes["data-count"], "2");
    let prevented = 0;
    dom.listeners.mousedown({ button: 0, preventDefault: () => { prevented += 1; } });
    assert.equal(prevented, 1);
    assert.deepEqual(dispatches, [{ selection: { anchor: 41 } }]);
    assert.equal(focused, 1);
    dom.listeners.mousedown({ button: 0, metaKey: true, preventDefault: () => { prevented += 1; } });
    assert.deepEqual(opened, [["job_email_recruiters", "2026/20261102.md", "tab"]]);
    assert.equal(dispatches.length, 1);
    dom.listeners.mousedown({ button: 2, preventDefault: () => { prevented += 1; } });
    assert.equal(prevented, 2, "right click is left to the editor");
    assert.equal(timers[0].delay, 400);
    timers[0].fn();
    assert.doesNotMatch(dom.attributes.class, /bob-keep-moving-mark-tick/);
  } finally {
    if (oldDocument === undefined) delete global.document; else global.document = oldDocument;
    if (oldWindow === undefined) delete global.window; else global.window = oldWindow;
  }
});
