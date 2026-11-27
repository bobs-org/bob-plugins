const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin {
  constructor(app) {
    this.app = app;
    this._cleanups = [];
  }
  register(fn) { this._cleanups.push(fn); }
  registerEditorExtension() {}
  registerMarkdownPostProcessor() {}
  registerEvent() {}
  addCommand(command) {
    if (!Array.isArray(this.commands)) this.commands = [];
    this.commands.push(command);
  }
}
class MarkdownView {}
class TestNotice { constructor(message) { TestNotice.messages.push(String(message)); } }
TestNotice.messages = [];

const editorInfoField = { info: true };
const editorLivePreviewField = { live: true };
const StateEffect = { define: () => ({ of(value) { return { value, effect: this, value }; }, is(other) { return this === other; } }) };
class WidgetType {}
class RangeSetBuilder { constructor() { this.rows = []; } add(from, to, deco) { this.rows.push({ from, to, deco }); } finish() { return this.rows; } }
const Decoration = { none: [], widget: (options) => ({ widget: options.widget, side: options.side }) };
const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownRenderChild: class { constructor(el) { this.containerEl = el; } },
    MarkdownView,
    Notice: TestNotice, Plugin: TestPlugin, Platform: { isDesktopApp: true },
    normalizePath: (value) => value, editorInfoField, editorLivePreviewField,
  };
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value }, StateEffect, RangeSetBuilder };
  if (request === "@codemirror/view") return {
    Decoration, WidgetType, ViewPlugin: { fromClass: (cls, options) => ({ cls, options }) },
  };
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers } = LedgerToolsPlugin;
Module._load = originalLoad;

const actingVim = Object.freeze({
  readable: true,
  insertMode: false,
  visualMode: false,
  replaceMode: false,
  operator: null,
  keyBufferEmpty: true,
  countPending: false,
  registerPending: false,
});

function actingArm(overrides = {}) {
  return {
    reason: "schema-key",
    canAct: () => true,
    run() {},
    ...overrides,
  };
}

function actingInput(overrides = {}) {
  return {
    key: "=",
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
    inContent: true,
    livePreview: true,
    vim: actingVim,
    arm: actingArm(),
    context: {},
    ...overrides,
  };
}

test("bare = acts with a registry-backed arm", () => {
  assert.deepEqual(helpers.propertyCardBareKeyGate(actingInput()), {
    act: true, reason: "schema-key",
  });
  assert.deepEqual(helpers.propertyCardBareKeyGate(actingInput({ shiftKey: true })), {
    act: true, reason: "schema-key",
  });
});

test("bare = falls through without an actionable arm", () => {
  assert.equal(helpers.propertyCardBareKeyGate(actingInput({ arm: null })).reason, "unregistered-arm");
  assert.equal(helpers.propertyCardBareKeyGate(actingInput({
    arm: actingArm({ canAct: () => false }),
  })).reason, "arm-not-actionable");
  assert.equal(helpers.propertyCardBareKeyGate(actingInput({
    arm: actingArm({ canAct: () => { throw new Error("boom"); } }),
  })).reason, "arm-not-actionable");
});

test("canonical record notes resolve through the Record Card", () => {
  assert.equal(helpers.schemaDoubleEqualsTargetKind({
    path: "eat/nagi.md", frontmatter: { type: "[[record]]" },
  }), "record");
});

test("bank month notes keep their Vim reindent", () => {
  assert.equal(helpers.schemaDoubleEqualsTargetKind({
    path: "bank/2026-11.md", frontmatter: { type: "[[bank_month]]" },
  }), null);
});

test("mixed record types fall through", () => {
  assert.equal(helpers.schemaDoubleEqualsTargetKind({
    path: "eat/nagi.md", frontmatter: { type: ["[[record]]", "[[album]]"] },
  }), "album");
  assert.equal(helpers.schemaDoubleEqualsTargetKind({
    path: "eat/nagi.md", frontmatter: { type: ["[[record]]", "[[area]]"] },
  }), null);
});

test("area, project, and daily notes miss the builtin registry", () => {
  assert.equal(helpers.schemaDoubleEqualsTargetKind({
    path: "life.md", frontmatter: { type: "[[area]]" },
  }), null);
  assert.equal(helpers.schemaDoubleEqualsTargetKind({
    path: "prj.md", frontmatter: { type: "[[project]]" },
  }), null);
  assert.equal(helpers.schemaDoubleEqualsTargetKind({
    path: "2026-11-17.md", frontmatter: { type: "[[day]]" },
  }), null);
  assert.equal(helpers.propertyCardBareKeyGate(actingInput({
    arm: actingArm({ canAct: () => false }),
  })).reason, "arm-not-actionable");
});

test("target kind selects bank hub then album type", () => {
  assert.equal(helpers.schemaDoubleEqualsTargetKind({
    path: "bank.md", frontmatter: {},
  }), "bank");
  assert.equal(helpers.schemaDoubleEqualsTargetKind({
    path: "eat.md", frontmatter: { type: "[[album]]" },
  }), "album");
  assert.equal(helpers.schemaDoubleEqualsTargetKind({
    path: "eat.md", frontmatter: { type: ["[[album]]"] },
  }), "album");
});

test("counted, register, and operator-pending = fall through", () => {
  assert.equal(helpers.propertyCardBareKeyGate(actingInput({
    vim: { ...actingVim, countPending: true },
  })).reason, "counted");
  assert.equal(helpers.propertyCardBareKeyGate(actingInput({
    vim: { ...actingVim, registerPending: true },
  })).reason, "register");
  for (const operator of ["indentAuto", "delete", "find"]) {
    assert.equal(helpers.propertyCardBareKeyGate(actingInput({
      vim: { ...actingVim, operator },
    })).reason, "operator-pending", operator);
  }
  assert.equal(helpers.propertyCardBareKeyGate(actingInput({
    vim: { ...actingVim, keyBufferEmpty: false },
  })).reason, "key-buffer");
});

test("insert, visual, replace, source, and outside-content fall through", () => {
  assert.equal(helpers.propertyCardBareKeyGate(actingInput({
    vim: { ...actingVim, insertMode: true },
  })).reason, "not-normal");
  assert.equal(helpers.propertyCardBareKeyGate(actingInput({
    vim: { ...actingVim, visualMode: true },
  })).reason, "not-normal");
  assert.equal(helpers.propertyCardBareKeyGate(actingInput({
    vim: { ...actingVim, replaceMode: true },
  })).reason, "not-normal");
  assert.equal(helpers.propertyCardBareKeyGate(actingInput({ livePreview: false })).reason, "not-live-preview");
  assert.equal(helpers.propertyCardBareKeyGate(actingInput({ inContent: false })).reason, "not-content");
});

test("modified, repeat, composing, and defaultPrevented fall through", () => {
  assert.equal(helpers.propertyCardBareKeyGate(actingInput({ ctrlKey: true })).reason, "modified");
  assert.equal(helpers.propertyCardBareKeyGate(actingInput({ altKey: true })).reason, "modified");
  assert.equal(helpers.propertyCardBareKeyGate(actingInput({ metaKey: true })).reason, "modified");
  assert.equal(helpers.propertyCardBareKeyGate(actingInput({ repeat: true })).reason, "repeat");
  assert.equal(helpers.propertyCardBareKeyGate(actingInput({ isComposing: true })).reason, "composing");
  assert.equal(helpers.propertyCardBareKeyGate(actingInput({ defaultPrevented: true })).reason, "default-prevented");
});

test("other bare keys and unreadable Vim fall through", () => {
  assert.equal(helpers.propertyCardBareKeyGate(actingInput({ key: "a" })).reason, "not-bare-key");
  assert.equal(helpers.propertyCardBareKeyGate(actingInput({ vim: { ...actingVim, readable: false } })).reason, "no-vim");
});

test("bare = acts through the shared gate with shifted input", () => {
  assert.deepEqual(helpers.propertyCardBareKeyGate(actingInput({ shiftKey: true })), {
    act: true, reason: "schema-key",
  });
});

const actingBareVim = Object.freeze({
  readable: true,
  insertMode: false,
  visualMode: false,
  replaceMode: false,
  operator: null,
  keyBufferEmpty: true,
  countPending: false,
  registerPending: false,
});

function bareGateInput(overrides = {}) {
  return {
    key: "-",
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
    inContent: true,
    livePreview: true,
    vim: actingBareVim,
    arm: { reason: "test-arm", canAct: () => true, run() {} },
    context: {},
    ...overrides,
  };
}

test("bare-key arms act on -, _, =, and shifted or unshifted +", () => {
  assert.deepEqual(helpers.propertyCardBareKeyGate(bareGateInput()), {
    act: true, reason: "test-arm",
  });
  assert.deepEqual(helpers.propertyCardBareKeyGate(bareGateInput({ key: "+", shiftKey: true })), {
    act: true, reason: "test-arm",
  });
  assert.deepEqual(helpers.propertyCardBareKeyGate(bareGateInput({ key: "+", shiftKey: false })), {
    act: true, reason: "test-arm",
  });
  assert.deepEqual(helpers.propertyCardBareKeyGate(bareGateInput({ key: "_", shiftKey: true })), {
    act: true, reason: "test-arm",
  });
  assert.deepEqual(helpers.propertyCardBareKeyGate(bareGateInput({ key: "=" })), {
    act: true, reason: "test-arm",
  });
  assert.deepEqual(helpers.propertyCardBareKeyGate(bareGateInput({ key: "=", shiftKey: true })), {
    act: true, reason: "test-arm",
  });
});

test("bare-key gate names each fall-through", () => {
  for (const [overrides, reason] of [
    [{ ctrlKey: true }, "modified"],
    [{ altKey: true }, "modified"],
    [{ metaKey: true }, "modified"],
    [{ repeat: true }, "repeat"],
    [{ isComposing: true }, "composing"],
    [{ defaultPrevented: true }, "default-prevented"],
    [{ inContent: false }, "not-content"],
    [{ livePreview: false }, "not-live-preview"],
    [{ vim: { ...actingBareVim, readable: false } }, "no-vim"],
    [{ vim: { ...actingBareVim, insertMode: true } }, "not-normal"],
    [{ vim: { ...actingBareVim, visualMode: true } }, "not-normal"],
    [{ vim: { ...actingBareVim, replaceMode: true } }, "not-normal"],
    [{ vim: { ...actingBareVim, operator: "indentAuto" } }, "operator-pending"],
    [{ vim: { ...actingBareVim, operator: "delete" } }, "operator-pending"],
    [{ vim: { ...actingBareVim, keyBufferEmpty: false } }, "key-buffer"],
    [{ vim: { ...actingBareVim, countPending: true } }, "counted"],
    [{ vim: { ...actingBareVim, registerPending: true } }, "register"],
  ]) {
    assert.equal(helpers.propertyCardBareKeyGate(bareGateInput(overrides)).reason, reason);
  }
  assert.equal(helpers.propertyCardBareKeyGate(bareGateInput({ arm: null })).reason, "unregistered-arm");
  assert.equal(helpers.propertyCardBareKeyGate(bareGateInput({
    arm: { reason: "test-arm", canAct: () => false, run() {} },
  })).reason, "arm-not-actionable");
});

test("content-target helper accepts the editor contentDOM and refuses inputs and nested editables", () => {
  const contentDOM = { tagName: "DIV", className: "cm-content" };
  const view = { editor: { cm: { contentDOM } } };
  assert.equal(helpers.schemaDoubleEqualsEventInContent({ target: contentDOM }, view), true);

  const line = {
    tagName: "DIV",
    closest(sel) { return sel === "[contenteditable]" ? contentDOM : null; },
  };
  assert.equal(helpers.schemaDoubleEqualsEventInContent({ target: line }, view), true);

  const searchInput = {
    tagName: "INPUT",
    closest(sel) { return sel === "[contenteditable]" ? contentDOM : sel === ".cm-editor" ? { className: "cm-editor" } : null; },
  };
  assert.equal(helpers.schemaDoubleEqualsEventInContent({ target: searchInput }, view), false, "Vim search panel");

  const propertyInput = {
    tagName: "INPUT",
    closest(sel) { return sel === ".cm-editor" ? { className: "cm-editor" } : null; },
  };
  assert.equal(helpers.schemaDoubleEqualsEventInContent({ target: propertyInput }, view), false, "native property input");

  const inlineTitle = {
    tagName: "DIV",
    closest(sel) { return sel === "[contenteditable]" ? inlineTitle : sel === ".cm-editor" ? { className: "cm-editor" } : null; },
  };
  assert.equal(helpers.schemaDoubleEqualsEventInContent({ target: inlineTitle }, view), false, "inline title");
});

test("vim snapshot reads bare normal-mode = and count or register state", () => {
  const pending = helpers.schemaDoubleEqualsVimSnapshot({
    state: {
      vim: {
        insertMode: false,
        visualMode: false,
        replaceMode: false,
        inputState: {
          operator: null,
          keyBuffer: [],
          prefixRepeat: [],
          motionRepeat: [],
          registerName: null,
        },
      },
    },
  });
  assert.deepEqual(pending, actingVim);

  const counted = helpers.schemaDoubleEqualsVimSnapshot({
    state: {
      vim: {
        inputState: {
          operator: "indentAuto",
          keyBuffer: "",
          prefixRepeat: ["3"],
          motionRepeat: [],
        },
      },
    },
  });
  assert.equal(counted.readable, true);
  assert.equal(counted.keyBufferEmpty, true);
  assert.equal(counted.countPending, true);

  const motion = helpers.schemaDoubleEqualsVimSnapshot({
    state: {
      vim: {
        inputState: {
          operator: "indentAuto",
          keyBuffer: [],
          prefixRepeat: [],
          motionRepeat: ["2"],
        },
      },
    },
  });
  assert.equal(motion.countPending, true);

  const missing = helpers.schemaDoubleEqualsVimSnapshot({});
  assert.equal(missing.readable, false);
});

function makeListenerHost() {
  const listeners = [];
  return {
    listeners,
    addEventListener(type, handler, capture) {
      listeners.push({ type, handler, capture });
    },
    removeEventListener(type, handler, capture) {
      const index = listeners.findIndex(
        (entry) => entry.type === type && entry.handler === handler && entry.capture === capture,
      );
      if (index >= 0) listeners.splice(index, 1);
    },
    dispatch(event) {
      for (const entry of [...listeners]) {
        if (entry.type === "keydown") entry.handler(event);
      }
    },
  };
}

function makeKeyEvent(view, overrides = {}) {
  const counts = { preventDefault: 0, stopPropagation: 0, immediate: 0 };
  return {
    key: "=",
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
    target: view && view.contentDOM ? view.contentDOM : {
      tagName: "DIV",
      closest() { return null; },
    },
    preventDefault() { counts.preventDefault += 1; },
    stopPropagation() { counts.stopPropagation += 1; },
    stopImmediatePropagation() { counts.immediate += 1; },
    counts,
    ...overrides,
  };
}

function makeView(path, options = {}) {
  const view = new MarkdownView();
  const content = options.content || "# note\n";
  const live = options.live !== false;
  const vimState = options.vimState || {
    insertMode: false,
    visualMode: false,
    replaceMode: false,
    inputState: {
      operator: null,
      keyBuffer: [],
      prefixRepeat: [],
      motionRepeat: [],
      registerName: null,
    },
  };
  const contentDOM = options.contentDOM || {
    tagName: "DIV",
    className: "cm-content",
    closest(sel) {
      return sel === "[contenteditable]" ? contentDOM
        : sel === ".cm-editor" ? { className: "cm-editor" }
        : null;
    },
  };
  const cm = {
    getCursor() { return { line: 0, ch: 0 }; },
    getValue() { return content; },
    state: { vim: vimState },
    cm6: {
      state: {
        field(field) {
          if (field === editorLivePreviewField) return live;
          return undefined;
        },
      },
      contentDOM,
    },
  };
  view.file = { path };
  view.editor = { cm: { cm, contentDOM } };
  view.mountedNodes = [];
  view.containerEl = {
    contains(el) { return el && (el.className === "cm-editor" || el === contentDOM || view.mountedNodes.includes(el)); },
  };
  view.getState = () => ({ source: !live });
  view.cm = cm;
  view.contentDOM = contentDOM;
  return view;
}

function bareVimState(overrides = {}) {
  return {
    insertMode: false,
    visualMode: false,
    replaceMode: false,
    inputState: {
      operator: null,
      keyBuffer: [],
      prefixRepeat: [],
      motionRepeat: [],
      registerName: null,
    },
    ...overrides,
  };
}

function bareKeyEvent(view, overrides = {}) {
  return makeKeyEvent(view, {
    key: "-",
    ...overrides,
  });
}

function pendingVimState(overrides = {}) {
  return {
    insertMode: false,
    visualMode: false,
    replaceMode: false,
    inputState: {
      operator: "indentAuto",
      keyBuffer: [],
      prefixRepeat: [],
      motionRepeat: [],
      registerName: null,
    },
    ...overrides,
  };
}

function makeHarness(path, options = {}) {
  const view = makeView(path, options);
  const albumCalls = [];
  const bankCalls = [];
  const recordCalls = [];
  const handleKeyCalls = [];
  const win = makeListenerHost();
  const doc = makeListenerHost();
  win.CodeMirrorAdapter = {
    Vim: {
      handleKey(...args) { handleKeyCalls.push(args); },
    },
  };
  const frontmatter = options.frontmatter || {};
  const plugin = new LedgerToolsPlugin({
    workspace: {
      getActiveViewOfType(type) {
        return type === MarkdownView ? view : null;
      },
    },
    metadataCache: {
      getFileCache(file) {
        return file && file.path === path ? { frontmatter } : null;
      },
    },
    vault: {
      getAbstractFileByPath(p) { return p === path ? view.file : null; },
    },
  });
  plugin.openAlbumSchemaEntry = (args) => { albumCalls.push(args); };
  plugin.openBankSetupCard = (args) => { bankCalls.push(args); };
  plugin.openRecordCard = (args) => { recordCalls.push(args); };
  return { plugin, view, win, doc, albumCalls, bankCalls, recordCalls, handleKeyCalls };
}

function withGlobals(win, doc, fn) {
  const originalWindow = global.window;
  const originalDocument = global.document;
  global.window = win;
  global.document = doc;
  try {
    return fn();
  } finally {
    if (originalWindow === undefined) delete global.window;
    else global.window = originalWindow;
    if (originalDocument === undefined) delete global.document;
    else global.document = originalDocument;
  }
}

test("single = opens the schema card with no Esc", () => {
  const content = "# Eat\n";
  const harness = makeHarness("eat.md", {
    frontmatter: { type: "[[album]]" },
    content,
  });
  withGlobals(harness.win, harness.doc, () => {
    harness.plugin.setupSchemaDoubleEquals();
    const event = makeKeyEvent(harness.view);
    harness.win.dispatch(event);
    assert.deepEqual(event.counts, { preventDefault: 1, stopPropagation: 1, immediate: 1 });
    assert.equal(harness.handleKeyCalls.length, 0, "single = injects no Esc");
    assert.deepEqual(harness.albumCalls, [{ filePath: "eat.md" }]);
    assert.equal(harness.bankCalls.length, 0);
    assert.equal(harness.view.cm.getValue(), content);
  });
});

test("bank.md opens the bank setup card", () => {
  const harness = makeHarness("bank.md", { frontmatter: { type: "[[area]]" } });
  withGlobals(harness.win, harness.doc, () => {
    harness.plugin.setupSchemaDoubleEquals();
    harness.win.dispatch(makeKeyEvent(harness.view));
    assert.deepEqual(harness.bankCalls, [{ sourcePath: "bank.md" }]);
    assert.equal(harness.albumCalls.length, 0);
    assert.equal(harness.handleKeyCalls.length, 0, "single = injects no Esc");
  });
});

test("ordinary notes keep native =", () => {
  const harness = makeHarness("inbox.md", { frontmatter: {} });
  withGlobals(harness.win, harness.doc, () => {
    harness.plugin.setupSchemaDoubleEquals();
    const event = makeKeyEvent(harness.view);
    harness.win.dispatch(event);
    assert.deepEqual(event.counts, { preventDefault: 0, stopPropagation: 0, immediate: 0 });
    assert.equal(harness.handleKeyCalls.length, 0);
    assert.equal(harness.albumCalls.length, 0);
    assert.equal(harness.bankCalls.length, 0);
    assert.equal(harness.recordCalls.length, 0);
  });
});

test("single = opens the Record Card with no Esc", () => {
  const content = "# Nagi\n";
  const harness = makeHarness("eat/nagi.md", {
    frontmatter: { type: "[[record]]" },
    content,
  });
  withGlobals(harness.win, harness.doc, () => {
    harness.plugin.setupSchemaDoubleEquals();
    const event = makeKeyEvent(harness.view);
    harness.win.dispatch(event);
    assert.deepEqual(event.counts, { preventDefault: 1, stopPropagation: 1, immediate: 1 });
    assert.equal(harness.handleKeyCalls.length, 0, "single = injects no Esc");
    assert.deepEqual(harness.recordCalls, [{ filePath: "eat/nagi.md" }]);
    assert.equal(harness.albumCalls.length, 0);
    assert.equal(harness.bankCalls.length, 0);
    assert.equal(harness.view.cm.getValue(), content);
  });
});

test("habit guard swallows a fast second = and opens once", () => {
  const harness = makeHarness("eat.md", { frontmatter: { type: "[[album]]" } });
  let now = 1000;
  withGlobals(harness.win, harness.doc, () => {
    harness.plugin.setupSchemaDoubleEquals();
    harness.plugin.propertyCardEqualsClock = () => now;
    const first = makeKeyEvent(harness.view);
    harness.win.dispatch(first);
    assert.deepEqual(first.counts, { preventDefault: 1, stopPropagation: 1, immediate: 1 });
    assert.equal(harness.handleKeyCalls.length, 0, "single = injects no Esc");
    assert.deepEqual(harness.albumCalls, [{ filePath: "eat.md" }]);
    now = 1200;
    const second = makeKeyEvent(harness.view);
    harness.win.dispatch(second);
    assert.deepEqual(second.counts, { preventDefault: 1, stopPropagation: 1, immediate: 1 });
    assert.equal(harness.albumCalls.length, 1, "fast second = is swallowed");
    now = 1300;
    const repeated = makeKeyEvent(harness.view, { repeat: true });
    harness.win.dispatch(repeated);
    assert.equal(harness.albumCalls.length, 1, "repeated fast second = is swallowed");
    assert.equal(harness.handleKeyCalls.length, 0);
    harness.plugin.teardownSchemaDoubleEquals();
    assert.equal(harness.plugin.propertyCardEqualsGuardUntil, 0, "teardown clears the guard");
  });
});

test("habit guard releases after 350 ms and other keys disarm", () => {
  const harness = makeHarness("eat.md", { frontmatter: { type: "[[album]]" } });
  let now = 5000;
  withGlobals(harness.win, harness.doc, () => {
    harness.plugin.setupSchemaDoubleEquals();
    harness.plugin.propertyCardEqualsClock = () => now;
    harness.win.dispatch(makeKeyEvent(harness.view));
    assert.equal(harness.albumCalls.length, 1);
    now = 5000 + 351;
    const late = makeKeyEvent(harness.view);
    harness.win.dispatch(late);
    assert.equal(late.counts.preventDefault, 1);
    assert.equal(harness.albumCalls.length, 2, "second = after 350 ms opens again");
    now = 6000;
    harness.win.dispatch(makeKeyEvent(harness.view));
    assert.equal(harness.albumCalls.length, 3);
    now = 6100;
    const other = makeKeyEvent(harness.view, { key: "[" });
    harness.win.dispatch(other);
    assert.deepEqual(other.counts, { preventDefault: 0, stopPropagation: 0, immediate: 0 }, "= then [ disarms");
    assert.equal(harness.albumCalls.length, 3);
    now = 6150;
    harness.win.dispatch(makeKeyEvent(harness.view));
    assert.equal(harness.albumCalls.length, 4, "disarmed = opens normally");
    now = 7000;
    harness.win.dispatch(makeKeyEvent(harness.view));
    assert.equal(harness.albumCalls.length, 5);
    now = 7100;
    const modified = makeKeyEvent(harness.view, { ctrlKey: true });
    harness.win.dispatch(modified);
    assert.deepEqual(modified.counts, { preventDefault: 0, stopPropagation: 0, immediate: 0 }, "modified = disarms");
    assert.equal(harness.albumCalls.length, 5);
    now = 7150;
    harness.win.dispatch(makeKeyEvent(harness.view));
    assert.equal(harness.albumCalls.length, 6, "disarmed = opens normally");
    harness.plugin.teardownSchemaDoubleEquals();
  });
});

test("counted and register = on records keep native reindent", () => {
  for (const vimState of [
    {
      insertMode: false, visualMode: false, replaceMode: false,
      inputState: {
        operator: "indentAuto", keyBuffer: [], prefixRepeat: ["3"], motionRepeat: [], registerName: null,
      },
    },
    {
      insertMode: false, visualMode: false, replaceMode: false,
      inputState: {
        operator: "indentAuto", keyBuffer: [], prefixRepeat: [], motionRepeat: [], registerName: "a",
      },
    },
  ]) {
    const harness = makeHarness("eat/nagi.md", {
      frontmatter: { type: "[[record]]" },
      vimState,
    });
    withGlobals(harness.win, harness.doc, () => {
      harness.plugin.setupSchemaDoubleEquals();
      harness.win.dispatch(makeKeyEvent(harness.view));
      assert.equal(harness.recordCalls.length, 0);
      assert.equal(harness.handleKeyCalls.length, 0);
    });
  }
});

test("window plus document dispatch of the same event acts once", () => {
  const harness = makeHarness("eat.md", { frontmatter: { type: "[[album]]" } });
  withGlobals(harness.win, harness.doc, () => {
    harness.plugin.setupSchemaDoubleEquals();
    const event = makeKeyEvent(harness.view);
    harness.win.dispatch(event);
    harness.doc.dispatch(event);
    assert.equal(harness.albumCalls.length, 1);
    assert.equal(harness.handleKeyCalls.length, 0, "single = injects no Esc");
    assert.equal(event.counts.preventDefault, 1);
  });
});

test("- toggles only a foot mounted in the active view and injects no Esc", () => {
  helpers.propertyCardFootResetAll();
  const harness = makeHarness("eat/nagi.md", {
    frontmatter: { type: "[[record]]" },
    vimState: bareVimState(),
  });
  const foot = { className: "bob-property-card-foot", isConnected: true };
  harness.view.mountedNodes.push(foot);
  helpers.propertyCardFootRegisterMount(foot, "eat/nagi.md");
  withGlobals(harness.win, harness.doc, () => {
    harness.plugin.setupSchemaDoubleEquals();
    const event = bareKeyEvent(harness.view);
    harness.win.dispatch(event);
    assert.deepEqual(event.counts, { preventDefault: 1, stopPropagation: 1, immediate: 1 });
    assert.equal(harness.handleKeyCalls.length, 0, "bare minus does not cancel a pending operator");
    assert.equal(helpers.propertyCardFootIsOpen("eat/nagi.md"), true);
    assert.equal(harness.recordCalls.length, 0, "the minus arm does not open the species editor");
  });
  helpers.propertyCardFootResetAll();
});

test("- falls through when the active pane has no mounted foot, including a same-path other pane", () => {
  helpers.propertyCardFootResetAll();
  const harness = makeHarness("eat/nagi.md", {
    frontmatter: { type: "[[record]]" },
    vimState: bareVimState(),
  });
  const otherPaneFoot = { className: "bob-property-card-foot", isConnected: true };
  helpers.propertyCardFootRegisterMount(otherPaneFoot, "eat/nagi.md");
  withGlobals(harness.win, harness.doc, () => {
    harness.plugin.setupSchemaDoubleEquals();
    const event = bareKeyEvent(harness.view);
    harness.win.dispatch(event);
    assert.deepEqual(event.counts, { preventDefault: 0, stopPropagation: 0, immediate: 0 });
    assert.equal(harness.handleKeyCalls.length, 0);
    assert.equal(helpers.propertyCardFootIsOpen("eat/nagi.md"), false);
  });
  helpers.propertyCardFootResetAll();
});

test("unregistered + falls through; a registered shifted and unshifted + arm runs with no Esc", () => {
  const harness = makeHarness("eat/nagi.md", {
    frontmatter: { type: "[[record]]" },
    vimState: bareVimState(),
  });
  const seen = [];
  withGlobals(harness.win, harness.doc, () => {
    harness.plugin.setupSchemaDoubleEquals();
    const unregistered = bareKeyEvent(harness.view, { key: "+", shiftKey: true });
    harness.win.dispatch(unregistered);
    assert.equal(unregistered.counts.preventDefault, 0, "plus is absent until registered");
    assert.equal(harness.handleKeyCalls.length, 0);
    assert.equal(harness.plugin.registerPropertyCardSecondKeyArm({
      key: "+", canAct: (context) => context.path === "eat/nagi.md",
      run: (context) => seen.push([context.path, context.frontmatter.type]),
    }), true);
    assert.equal(harness.plugin.registerPropertyCardSecondKeyArm({
      key: "+", canAct: () => true, run() {},
    }), false, "only one plus arm is registered");
    for (const shiftKey of [true, false]) {
      const event = bareKeyEvent(harness.view, { key: "+", shiftKey });
      harness.win.dispatch(event);
      assert.deepEqual(event.counts, { preventDefault: 1, stopPropagation: 1, immediate: 1 });
    }
    assert.deepEqual(seen, [["eat/nagi.md", "[[record]]"], ["eat/nagi.md", "[[record]]"]]);
    assert.equal(harness.handleKeyCalls.length, 0, "bare plus does not inject Esc");
    assert.equal(harness.plugin.unregisterPropertyCardSecondKeyArm("="), false, "built-in arms stay owned here");
    assert.equal(harness.plugin.unregisterPropertyCardSecondKeyArm("+"), true);
  });
});

test("operator-pending - or + falls through with no Esc and no arm", () => {
  helpers.propertyCardFootResetAll();
  const harness = makeHarness("eat/nagi.md", {
    frontmatter: { type: "[[record]]" },
    vimState: pendingVimState(),
  });
  const foot = { className: "bob-property-card-foot", isConnected: true };
  harness.view.mountedNodes.push(foot);
  helpers.propertyCardFootRegisterMount(foot, "eat/nagi.md");
  const seen = [];
  withGlobals(harness.win, harness.doc, () => {
    harness.plugin.setupSchemaDoubleEquals();
    assert.equal(harness.plugin.registerPropertyCardSecondKeyArm({
      key: "+", canAct: () => true, run: () => seen.push("+"),
    }), true);
    for (const key of ["-", "+"]) {
      const event = bareKeyEvent(harness.view, { key });
      harness.win.dispatch(event);
      assert.deepEqual(event.counts, { preventDefault: 0, stopPropagation: 0, immediate: 0 }, key);
    }
    assert.equal(harness.handleKeyCalls.length, 0);
    assert.equal(helpers.propertyCardFootIsOpen("eat/nagi.md"), false);
    assert.deepEqual(seen, []);
  });
  helpers.propertyCardFootResetAll();
});

test("palette command toggles the current Reading view without Vim input", () => {
  helpers.propertyCardFootResetAll();
  const harness = makeHarness("eat.md", { live: false, frontmatter: { type: "[[album]]" } });
  const foot = { className: "bob-property-card-foot", isConnected: true };
  harness.view.mountedNodes.push(foot);
  helpers.propertyCardFootRegisterMount(foot, "eat.md");
  withGlobals(harness.win, harness.doc, () => {
    harness.plugin.setupSchemaDoubleEquals();
    const command = harness.plugin.commands.find((item) => item.id === "toggle-card-properties");
    assert.equal(command.name, "Toggle card properties");
    assert.equal(command.callback(), true);
    assert.equal(helpers.propertyCardFootIsOpen("eat.md"), true);
    assert.equal(harness.handleKeyCalls.length, 0, "palette use does not touch Vim input");
  });
  helpers.propertyCardFootResetAll();
});

function foldControl(path, open = false, kind = "album") {
  const attrs = new Map([
    ["data-card-fold", kind],
    ["data-card-fold-source", path],
    ["aria-expanded", open ? "true" : "false"],
  ]);
  return {
    isConnected: true,
    disabled: false,
    getAttribute(name) { return attrs.has(name) ? attrs.get(name) : null; },
    setAttribute(name, value) { attrs.set(name, String(value)); },
    getBoundingClientRect() { return { width: 10, height: 10 }; },
  };
}

function foldScope(control) {
  return { querySelectorAll(selector) { return selector === "[data-card-fold]" ? [control] : []; } };
}

test("shifted bare _ toggles only a registered fold in the active Live Preview view", () => {
  const harness = makeHarness("eat.md", { frontmatter: { type: "[[album]]" }, vimState: bareVimState() });
  const control = foldControl("eat.md");
  harness.view.dom = foldScope(control);
  let calls = 0;
  const unregister = helpers.propertyCardRegisterFoldKind(harness.plugin, "album", {
    toggle(path, view) {
      calls += 1;
      assert.equal(path, "eat.md");
      assert.equal(view, harness.view);
      control.setAttribute("aria-expanded", "true");
      return true;
    },
  });
  try {
    withGlobals(harness.win, harness.doc, () => {
      harness.plugin.setupSchemaDoubleEquals();
      const event = bareKeyEvent(harness.view, { key: "_", shiftKey: true });
      harness.win.dispatch(event);
      assert.deepEqual(event.counts, { preventDefault: 1, stopPropagation: 1, immediate: 1 });
      assert.equal(calls, 1);
      assert.equal(harness.handleKeyCalls.length, 0, "fold toggling does not inject a Vim motion");
    });
  } finally {
    unregister();
  }
});

test("shifted bare _ toggles record, area, and project folds", () => {
  for (const [kind, path, frontmatter] of [
    ["record", "eat/nagi.md", { type: "[[record]]" }],
    ["area", "love.md", { type: "[[area]]" }],
    ["project", "sase_blog.md", { type: "[[project]]" }],
  ]) {
    const harness = makeHarness(path, { frontmatter, vimState: bareVimState() });
    const control = foldControl(path, false, kind);
    harness.view.dom = foldScope(control);
    let calls = 0;
    const unregister = helpers.propertyCardRegisterFoldKind(harness.plugin, kind, {
      toggle(next) { calls += 1; assert.equal(next, path); return true; },
    });
    try {
      withGlobals(harness.win, harness.doc, () => {
        harness.plugin.setupSchemaDoubleEquals();
        const event = bareKeyEvent(harness.view, { key: "_", shiftKey: true });
        harness.win.dispatch(event);
        assert.equal(calls, 1, kind);
        assert.deepEqual(event.counts, { preventDefault: 1, stopPropagation: 1, immediate: 1 }, kind);
        assert.equal(harness.handleKeyCalls.length, 0, kind);
      });
    } finally {
      unregister();
    }
  }
});

test("shifted bare _ falls through on day and period notes", () => {
  for (const [path, frontmatter] of [
    ["2026-11-17.md", { type: "[[day]]" }],
    ["2026-W47.md", { type: "[[week]]" }],
  ]) {
    const harness = makeHarness(path, { frontmatter, vimState: bareVimState() });
    withGlobals(harness.win, harness.doc, () => {
      harness.plugin.setupSchemaDoubleEquals();
      const event = bareKeyEvent(harness.view, { key: "_", shiftKey: true });
      harness.win.dispatch(event);
      assert.deepEqual(event.counts, { preventDefault: 0, stopPropagation: 0, immediate: 0 }, path);
      assert.equal(harness.handleKeyCalls.length, 0, path);
    });
  }
});

test("Toggle card details works in Reading and returns false when no fold is mounted", () => {
  const empty = makeHarness("eat.md", { live: false, frontmatter: { type: "[[album]]" } });
  withGlobals(empty.win, empty.doc, () => {
    empty.plugin.setupSchemaDoubleEquals();
    const command = empty.plugin.commands.find((item) => item.id === "toggle-card-details");
    assert.equal(command.name, "Toggle card details");
    assert.equal(command.callback(), false);
  });

  const harness = makeHarness("eat.md", { live: false, frontmatter: { type: "[[album]]" } });
  const control = foldControl("eat.md");
  harness.view.dom = foldScope(control);
  let calls = 0;
  const unregister = helpers.propertyCardRegisterFoldKind(harness.plugin, "album", {
    toggle(path) { calls += 1; assert.equal(path, "eat.md"); return true; },
  });
  try {
    withGlobals(harness.win, harness.doc, () => {
      harness.plugin.setupSchemaDoubleEquals();
      const command = harness.plugin.commands.find((item) => item.id === "toggle-card-details");
      assert.equal(command.callback(), true);
      assert.equal(calls, 1);
      assert.equal(harness.handleKeyCalls.length, 0);
    });
  } finally {
    unregister();
  }
});

test("teardown clears future arms and makes the palette command inert", () => {
  const harness = makeHarness("eat.md", { frontmatter: { type: "[[album]]" } });
  withGlobals(harness.win, harness.doc, () => {
    harness.plugin.setupSchemaDoubleEquals();
    assert.equal(harness.plugin.registerPropertyCardSecondKeyArm({ key: "+", canAct: () => true, run() {} }), true);
    harness.plugin.teardownSchemaDoubleEquals();
    assert.equal(harness.plugin.propertyCardSecondKeyArmRegistry().has("+"), false);
    const command = harness.plugin.commands.find((item) => item.id === "toggle-card-properties");
    assert.equal(command.callback(), false);
  });
});

test("a throwing entry function does not escape the listener", () => {
  const harness = makeHarness("eat.md", { frontmatter: { type: "[[album]]" } });
  harness.plugin.openAlbumSchemaEntry = () => { throw new Error("boom"); };
  withGlobals(harness.win, harness.doc, () => {
    harness.plugin.setupSchemaDoubleEquals();
    assert.doesNotThrow(() => harness.win.dispatch(makeKeyEvent(harness.view)));
    assert.equal(harness.handleKeyCalls.length, 0, "single = injects no Esc");
  });
});

test("setup does not throw when document exists without window", () => {
  const originalWindow = global.window;
  const originalDocument = global.document;
  delete global.window;
  global.document = makeListenerHost();
  try {
    const plugin = new LedgerToolsPlugin({});
    assert.doesNotThrow(() => plugin.setupSchemaDoubleEquals());
    assert.equal(global.document.listeners.length, 1);
  } finally {
    if (originalWindow === undefined) delete global.window;
    else global.window = originalWindow;
    if (originalDocument === undefined) delete global.document;
    else global.document = originalDocument;
  }
});

test("unload cleanups remove both capture listeners", () => {
  const harness = makeHarness("eat.md", { frontmatter: { type: "[[album]]" } });
  withGlobals(harness.win, harness.doc, () => {
    harness.plugin.setupSchemaDoubleEquals();
    assert.equal(harness.win.listeners.length, 1);
    assert.equal(harness.doc.listeners.length, 1);
    assert.equal(harness.win.listeners[0].capture, true);
    assert.equal(harness.doc.listeners[0].capture, true);
    harness.plugin.teardownSchemaDoubleEquals();
    harness.win.dispatch(makeKeyEvent(harness.view));
    assert.equal(harness.albumCalls.length, 0);
    for (const cleanup of harness.plugin._cleanups) cleanup();
    assert.equal(harness.win.listeners.length, 0);
    assert.equal(harness.doc.listeners.length, 0);
  });
});

test("registry resolves bank before album before record", () => {
  const harness = makeHarness("bank.md", { frontmatter: { type: "[[album]]" } });
  withGlobals(harness.win, harness.doc, () => {
    harness.plugin.setupSchemaDoubleEquals();
    const kinds = harness.plugin.propertyCardKinds();
    assert.deepEqual(kinds.slice(0, 3), ["bank", "album", "record"]);
    const bank = harness.plugin.resolvePropertyCard({ path: "bank.md", frontmatter: { type: "[[album]]" } });
    assert.equal(bank && bank.kind, "bank");
    const album = harness.plugin.resolvePropertyCard({ path: "eat.md", frontmatter: { type: "[[album]]" } });
    assert.equal(album && album.kind, "album");
    const record = harness.plugin.resolvePropertyCard({ path: "eat/nagi.md", frontmatter: { type: "[[record]]" } });
    assert.equal(record && record.kind, "record");
    const none = harness.plugin.resolvePropertyCard({ path: "inbox.md", frontmatter: {} });
    assert.equal(none, null);
    harness.plugin.teardownSchemaDoubleEquals();
  });
});

test("synthetic fourth kind opens through the bare-key gate", () => {
  const fourthCalls = [];
  const harness = makeHarness("fourth.md", { frontmatter: { type: "[[note]]" } });
  let now = 1000;
  withGlobals(harness.win, harness.doc, () => {
    harness.plugin.setupSchemaDoubleEquals();
    harness.plugin.propertyCardEqualsClock = () => now;
    assert.equal(harness.plugin.registerPropertyCard({
      kind: "fourth",
      match: ({ path }) => path === "fourth.md",
      open: () => { fourthCalls.push("fourth"); },
    }), true);
    assert.equal(
      helpers.schemaDoubleEqualsTargetKind(
        { path: "fourth.md", frontmatter: { type: "[[note]]" } },
        harness.plugin,
      ),
      "fourth",
    );
    const event = makeKeyEvent(harness.view);
    harness.win.dispatch(event);
    assert.deepEqual(event.counts, { preventDefault: 1, stopPropagation: 1, immediate: 1 });
    assert.equal(harness.handleKeyCalls.length, 0, "single = injects no Esc");
    assert.deepEqual(fourthCalls, ["fourth"]);
    assert.equal(harness.albumCalls.length, 0);
    assert.equal(harness.bankCalls.length, 0);
    assert.equal(harness.recordCalls.length, 0);
    now = 2000;
    const both = makeKeyEvent(harness.view);
    harness.win.dispatch(both);
    harness.doc.dispatch(both);
    assert.deepEqual(fourthCalls, ["fourth", "fourth"]);
    harness.plugin.unregisterPropertyCard("fourth");
    harness.plugin.teardownSchemaDoubleEquals();
  });
});

test("duplicate kinds reject and unregister plus reload restore builtins", () => {
  const harness = makeHarness("eat.md", { frontmatter: { type: "[[album]]" } });
  withGlobals(harness.win, harness.doc, () => {
    harness.plugin.setupSchemaDoubleEquals();
    assert.equal(harness.plugin.registerPropertyCard({
      kind: "album",
      match: () => true,
      open: () => {},
    }), false);
    assert.equal(harness.plugin.registerPropertyCard({
      kind: "fourth",
      match: ({ path }) => path === "fourth.md",
      open: () => {},
    }), true);
    assert.equal(harness.plugin.registerPropertyCard({
      kind: "fourth",
      match: ({ path }) => path === "fourth.md",
      open: () => {},
    }), false);
    assert.equal(harness.plugin.unregisterPropertyCard("fourth"), true);
    assert.equal(harness.plugin.unregisterPropertyCard("fourth"), false);
    assert.equal(harness.plugin.resolvePropertyCard({ path: "fourth.md", frontmatter: {} }), null);
    assert.equal(helpers.schemaDoubleEqualsTargetKind({ path: "fourth.md", frontmatter: {} }), null);
    harness.plugin.teardownSchemaDoubleEquals();
    assert.deepEqual(harness.plugin.propertyCardRegistry(), []);
    harness.plugin.setupSchemaDoubleEquals();
    assert.deepEqual(harness.plugin.propertyCardKinds().slice(0, 3), ["bank", "album", "record"]);
    harness.plugin.teardownSchemaDoubleEquals();
  });
});

test("throwing matchers fail open without consuming Vim keys", () => {
  const harness = makeHarness("fourth.md", { frontmatter: {} });
  const fourthCalls = [];
  harness.plugin.openAlbumSchemaEntry = () => {};
  withGlobals(harness.win, harness.doc, () => {
    harness.plugin.setupSchemaDoubleEquals();
    harness.plugin.unregisterPropertyCard("bank");
    harness.plugin.unregisterPropertyCard("album");
    harness.plugin.unregisterPropertyCard("record");
    assert.equal(harness.plugin.registerPropertyCard({
      kind: "throwing",
      match: () => { throw new Error("boom"); },
      open: () => { fourthCalls.push("throwing"); },
    }), true);
    assert.equal(harness.plugin.registerPropertyCard({
      kind: "fourth",
      match: ({ path }) => path === "fourth.md",
      open: () => { fourthCalls.push("fourth"); },
    }), true);
    const resolved = harness.plugin.resolvePropertyCard({ path: "fourth.md", frontmatter: {} });
    assert.equal(resolved && resolved.kind, "fourth");
    const event = makeKeyEvent(harness.view);
    harness.win.dispatch(event);
    assert.deepEqual(fourthCalls, ["fourth"]);
    assert.deepEqual(event.counts, { preventDefault: 1, stopPropagation: 1, immediate: 1 });
    const miss = makeHarness("inbox.md", { frontmatter: {} });
    withGlobals(miss.win, miss.doc, () => {
      miss.plugin.setupSchemaDoubleEquals();
      miss.plugin.unregisterPropertyCard("bank");
      miss.plugin.unregisterPropertyCard("album");
      miss.plugin.unregisterPropertyCard("record");
      miss.plugin.registerPropertyCard({
        kind: "only-throwing",
        match: () => { throw new Error("boom"); },
        open: () => {},
      });
      const missEvent = makeKeyEvent(miss.view);
      miss.win.dispatch(missEvent);
      assert.deepEqual(missEvent.counts, { preventDefault: 0, stopPropagation: 0, immediate: 0 });
      miss.plugin.teardownSchemaDoubleEquals();
    });
    harness.plugin.teardownSchemaDoubleEquals();
  });
});

test("LAND: unregister bank remains effective during runtime dispatch", () => {
  const harness = makeHarness("bank.md", { frontmatter: {} });
  withGlobals(harness.win, harness.doc, () => {
    harness.plugin.setupSchemaDoubleEquals();
    harness.plugin.unregisterPropertyCard("bank");
    assert.equal(harness.plugin.resolvePropertyCard({ path: "bank.md", frontmatter: {} }), null);
    assert.equal(
      helpers.schemaDoubleEqualsTargetKind({ path: "bank.md", frontmatter: {} }, harness.plugin),
      null,
    );
    harness.win.dispatch(makeKeyEvent(harness.view));
    assert.equal(harness.bankCalls.length, 0);
    harness.plugin.teardownSchemaDoubleEquals();
  });
});

test("facade resolves builtins and extensions through the instance registry", () => {
  const harness = makeHarness("fourth.md", { frontmatter: { type: "[[note]]" } });
  withGlobals(harness.win, harness.doc, () => {
    harness.plugin.setupSchemaDoubleEquals();
    assert.equal(
      helpers.schemaDoubleEqualsTargetKind({ path: "bank.md", frontmatter: {} }),
      "bank",
    );
    assert.equal(
      helpers.schemaDoubleEqualsTargetKind({ path: "eat.md", frontmatter: { type: "[[album]]" } }),
      "album",
    );
    assert.equal(
      helpers.schemaDoubleEqualsTargetKind(
        { path: "eat/nagi.md", frontmatter: { type: "[[record]]" } },
      ),
      "record",
    );
    assert.equal(
      helpers.schemaDoubleEqualsTargetKind({ path: "fourth.md", frontmatter: {} }),
      null,
    );
    assert.equal(
      harness.plugin.registerPropertyCard({
        kind: "fourth",
        match: ({ path }) => path === "fourth.md",
        open: () => {},
      }),
      true,
    );
    assert.equal(
      helpers.schemaDoubleEqualsTargetKind(
        { path: "fourth.md", frontmatter: {} },
        harness.plugin,
      ),
      "fourth",
    );
    assert.equal(
      helpers.schemaDoubleEqualsTargetKind(
        { path: "fourth.md", frontmatter: {} },
        harness.plugin.propertyCardRegistry(),
      ),
      "fourth",
    );
    const resolved = harness.plugin.resolvePropertyCard({ path: "fourth.md", frontmatter: {} });
    assert.equal(resolved && resolved.kind, "fourth");
    const event = makeKeyEvent(harness.view);
    harness.win.dispatch(event);
    assert.equal(event.counts.preventDefault, 1);
    harness.plugin.unregisterPropertyCard("fourth");
    harness.plugin.teardownSchemaDoubleEquals();
  });
});

test("two instances isolate the same extension kind", () => {
  const first = makeHarness("fourth.md", { frontmatter: { type: "[[note]]" } });
  const second = makeHarness("fourth.md", { frontmatter: { type: "[[note]]" } });
  withGlobals(first.win, first.doc, () => {
    first.plugin.setupSchemaDoubleEquals();
    assert.equal(first.plugin.registerPropertyCard({
      kind: "fourth",
      match: ({ path }) => path === "fourth.md",
      open: () => { first.recordCalls.push("fourth"); },
    }), true);
    assert.equal(
      first.plugin.resolvePropertyCard({ path: "fourth.md", frontmatter: {} })?.kind,
      "fourth",
    );
  });
  withGlobals(second.win, second.doc, () => {
    second.plugin.setupSchemaDoubleEquals();
    assert.equal(
      second.plugin.resolvePropertyCard({ path: "fourth.md", frontmatter: {} }),
      null,
    );
    assert.equal(
      helpers.schemaDoubleEqualsTargetKind({ path: "fourth.md", frontmatter: {} }, second.plugin),
      null,
    );
    const event = makeKeyEvent(second.view);
    second.win.dispatch(event);
    assert.deepEqual(event.counts, { preventDefault: 0, stopPropagation: 0, immediate: 0 });
    assert.equal(second.recordCalls.length, 0);
  });
  withGlobals(first.win, first.doc, () => {
    assert.equal(
      helpers.schemaDoubleEqualsTargetKind({ path: "fourth.md", frontmatter: {} }, first.plugin),
      "fourth",
    );
    const event = makeKeyEvent(first.view);
    first.win.dispatch(event);
    assert.deepEqual(event.counts, { preventDefault: 1, stopPropagation: 1, immediate: 1 });
    first.plugin.teardownSchemaDoubleEquals();
  });
  withGlobals(second.win, second.doc, () => {
    second.plugin.teardownSchemaDoubleEquals();
  });
});

test("unregister teardown and setup restore builtins without reviving extensions", () => {
  const harness = makeHarness("eat.md", { frontmatter: { type: "[[album]]" } });
  let now = 1000;
  withGlobals(harness.win, harness.doc, () => {
    harness.plugin.setupSchemaDoubleEquals();
    harness.plugin.propertyCardEqualsClock = () => now;
    assert.equal(harness.plugin.registerPropertyCard({
      kind: "fourth",
      match: ({ path }) => path === "fourth.md",
      open: () => {},
    }), true);
    assert.equal(harness.plugin.unregisterPropertyCard("bank"), true);
    assert.equal(harness.plugin.resolvePropertyCard({ path: "bank.md", frontmatter: {} }), null);
    harness.plugin.teardownSchemaDoubleEquals();
    assert.deepEqual(harness.plugin.propertyCardRegistry(), []);
    harness.plugin.setupSchemaDoubleEquals();
    assert.deepEqual(harness.plugin.propertyCardKinds().slice(0, 3), ["bank", "album", "record"]);
    assert.equal(harness.plugin.resolvePropertyCard({ path: "fourth.md", frontmatter: {} }), null);
    const event = makeKeyEvent(harness.view);
    harness.win.dispatch(event);
    assert.deepEqual(harness.albumCalls, [{ filePath: "eat.md" }]);
    now = 2000;
    const both = makeKeyEvent(harness.view);
    harness.win.dispatch(both);
    harness.doc.dispatch(both);
    assert.equal(harness.albumCalls.length, 2);
    harness.plugin.teardownSchemaDoubleEquals();
  });
});
