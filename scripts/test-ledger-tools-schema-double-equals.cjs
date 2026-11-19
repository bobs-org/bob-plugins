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
  addCommand() {}
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
  operator: "indentAuto",
  keyBufferEmpty: true,
  countPending: false,
  registerPending: false,
});

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
    inEditor: true,
    livePreview: true,
    vim: actingVim,
    target: "album",
    canHandleKey: true,
    ...overrides,
  };
}

test("gate acts for album and bank notes", () => {
  assert.deepEqual(helpers.schemaDoubleEqualsGate(actingInput()), {
    act: true, reason: "schema-key",
  });
  assert.deepEqual(helpers.schemaDoubleEqualsGate(actingInput({ target: "bank" })), {
    act: true, reason: "schema-key",
  });
});

test("canonical record notes act through the Record Card", () => {
  assert.equal(helpers.schemaDoubleEqualsTargetKind({
    path: "eat/nagi.md", frontmatter: { type: "[[record]]" },
  }), "record");
  assert.deepEqual(helpers.schemaDoubleEqualsGate(actingInput({ target: "record" })), {
    act: true, reason: "schema-key",
  });
});

test("bank month notes keep their Vim reindent", () => {
  assert.equal(helpers.schemaDoubleEqualsTargetKind({
    path: "bank/2026-11.md", frontmatter: { type: "[[bank_month]]" },
  }), null);
  assert.equal(helpers.schemaDoubleEqualsGate(actingInput({ target: null })).reason, "not-schema-note");
});

test("mixed record types fall through", () => {
  assert.equal(helpers.schemaDoubleEqualsTargetKind({
    path: "eat/nagi.md", frontmatter: { type: ["[[record]]", "[[album]]"] },
  }), "album");
  assert.equal(helpers.schemaDoubleEqualsTargetKind({
    path: "eat/nagi.md", frontmatter: { type: ["[[record]]", "[[area]]"] },
  }), null);
});

test("area, project, and daily notes fall through", () => {
  assert.equal(helpers.schemaDoubleEqualsTargetKind({
    path: "life.md", frontmatter: { type: "[[area]]" },
  }), null);
  assert.equal(helpers.schemaDoubleEqualsTargetKind({
    path: "prj.md", frontmatter: { type: "[[project]]" },
  }), null);
  assert.equal(helpers.schemaDoubleEqualsTargetKind({
    path: "2026-11-17.md", frontmatter: { type: "[[day]]" },
  }), null);
  assert.equal(helpers.schemaDoubleEqualsGate(actingInput({ target: null })).reason, "not-schema-note");
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

test("counted, register, other operators, and no pending operator fall through", () => {
  assert.equal(helpers.schemaDoubleEqualsGate(actingInput({
    vim: { ...actingVim, countPending: true },
  })).reason, "counted");
  assert.equal(helpers.schemaDoubleEqualsGate(actingInput({
    vim: { ...actingVim, registerPending: true },
  })).reason, "register");
  assert.equal(helpers.schemaDoubleEqualsGate(actingInput({
    vim: { ...actingVim, operator: "delete" },
  })).reason, "no-pending-equals");
  assert.equal(helpers.schemaDoubleEqualsGate(actingInput({
    vim: { ...actingVim, operator: null },
  })).reason, "no-pending-equals");
});

test("insert, visual, source, and outside-editor fall through", () => {
  assert.equal(helpers.schemaDoubleEqualsGate(actingInput({
    vim: { ...actingVim, insertMode: true },
  })).reason, "not-normal");
  assert.equal(helpers.schemaDoubleEqualsGate(actingInput({
    vim: { ...actingVim, visualMode: true },
  })).reason, "not-normal");
  assert.equal(helpers.schemaDoubleEqualsGate(actingInput({ livePreview: false })).reason, "not-live-preview");
  assert.equal(helpers.schemaDoubleEqualsGate(actingInput({ inEditor: false })).reason, "outside-editor");
});

test("Ctrl, Alt, Meta, repeat, composing, and defaultPrevented fall through", () => {
  assert.equal(helpers.schemaDoubleEqualsGate(actingInput({ ctrlKey: true })).reason, "modified");
  assert.equal(helpers.schemaDoubleEqualsGate(actingInput({ altKey: true })).reason, "modified");
  assert.equal(helpers.schemaDoubleEqualsGate(actingInput({ metaKey: true })).reason, "modified");
  assert.equal(helpers.schemaDoubleEqualsGate(actingInput({ repeat: true })).reason, "repeat");
  assert.equal(helpers.schemaDoubleEqualsGate(actingInput({ isComposing: true })).reason, "composing");
  assert.equal(helpers.schemaDoubleEqualsGate(actingInput({ defaultPrevented: true })).reason, "default-prevented");
});

test("missing handleKey and non-equals fall through", () => {
  assert.equal(helpers.schemaDoubleEqualsGate(actingInput({ canHandleKey: false })).reason, "no-handle-key");
  assert.equal(helpers.schemaDoubleEqualsGate(actingInput({ key: "a" })).reason, "not-equals");
  assert.equal(helpers.schemaDoubleEqualsGate(actingInput({ vim: { ...actingVim, readable: false } })).reason, "no-vim");
});

test("Shift with key = still acts", () => {
  assert.deepEqual(helpers.schemaDoubleEqualsGate(actingInput({ shiftKey: true })), {
    act: true, reason: "schema-key",
  });
});

test("vim snapshot reads a lone pending = and count or register state", () => {
  const pending = helpers.schemaDoubleEqualsVimSnapshot({
    state: {
      vim: {
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

function makeKeyEvent(overrides = {}) {
  const counts = { preventDefault: 0, stopPropagation: 0, immediate: 0 };
  const editorEl = { className: "cm-editor" };
  return {
    key: "=",
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
    target: {
      closest(sel) { return sel === ".cm-editor" ? editorEl : null; },
      editorEl,
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
      operator: "indentAuto",
      keyBuffer: [],
      prefixRepeat: [],
      motionRepeat: [],
      registerName: null,
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
    },
  };
  view.file = { path };
  view.editor = { cm: { cm } };
  view.containerEl = {
    contains(el) { return el && el.className === "cm-editor"; },
  };
  view.getState = () => ({ source: !live });
  view.cm = cm;
  return view;
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

test("album note consumes ==, injects Esc, and opens the schema card", () => {
  const content = "# Eat\n";
  const harness = makeHarness("eat.md", {
    frontmatter: { type: "[[album]]" },
    content,
  });
  withGlobals(harness.win, harness.doc, () => {
    harness.plugin.setupSchemaDoubleEquals();
    const event = makeKeyEvent();
    harness.win.dispatch(event);
    assert.deepEqual(event.counts, { preventDefault: 1, stopPropagation: 1, immediate: 1 });
    assert.deepEqual(harness.handleKeyCalls, [[harness.view.cm, "<Esc>", "mapping"]]);
    assert.deepEqual(harness.albumCalls, [{ filePath: "eat.md" }]);
    assert.equal(harness.bankCalls.length, 0);
    assert.equal(harness.view.cm.getValue(), content);
  });
});

test("bank.md opens the bank setup card", () => {
  const harness = makeHarness("bank.md", { frontmatter: { type: "[[area]]" } });
  withGlobals(harness.win, harness.doc, () => {
    harness.plugin.setupSchemaDoubleEquals();
    harness.win.dispatch(makeKeyEvent());
    assert.deepEqual(harness.bankCalls, [{ sourcePath: "bank.md" }]);
    assert.equal(harness.albumCalls.length, 0);
    assert.equal(harness.handleKeyCalls.length, 1);
  });
});

test("ordinary notes keep native ==", () => {
  const harness = makeHarness("inbox.md", { frontmatter: {} });
  withGlobals(harness.win, harness.doc, () => {
    harness.plugin.setupSchemaDoubleEquals();
    const event = makeKeyEvent();
    harness.win.dispatch(event);
    assert.deepEqual(event.counts, { preventDefault: 0, stopPropagation: 0, immediate: 0 });
    assert.equal(harness.handleKeyCalls.length, 0);
    assert.equal(harness.albumCalls.length, 0);
    assert.equal(harness.bankCalls.length, 0);
    assert.equal(harness.recordCalls.length, 0);
  });
});

test("record note consumes ==, injects Esc, and opens the Record Card", () => {
  const content = "# Nagi\n";
  const harness = makeHarness("eat/nagi.md", {
    frontmatter: { type: "[[record]]" },
    content,
  });
  withGlobals(harness.win, harness.doc, () => {
    harness.plugin.setupSchemaDoubleEquals();
    const event = makeKeyEvent();
    harness.win.dispatch(event);
    assert.deepEqual(event.counts, { preventDefault: 1, stopPropagation: 1, immediate: 1 });
    assert.deepEqual(harness.handleKeyCalls, [[harness.view.cm, "<Esc>", "mapping"]]);
    assert.deepEqual(harness.recordCalls, [{ filePath: "eat/nagi.md" }]);
    assert.equal(harness.albumCalls.length, 0);
    assert.equal(harness.bankCalls.length, 0);
    assert.equal(harness.view.cm.getValue(), content);
  });
});

test("counted and register == on records keep native reindent", () => {
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
      harness.win.dispatch(makeKeyEvent());
      assert.equal(harness.recordCalls.length, 0);
      assert.equal(harness.handleKeyCalls.length, 0);
    });
  }
});

test("window plus document dispatch of the same event acts once", () => {
  const harness = makeHarness("eat.md", { frontmatter: { type: "[[album]]" } });
  withGlobals(harness.win, harness.doc, () => {
    harness.plugin.setupSchemaDoubleEquals();
    const event = makeKeyEvent();
    harness.win.dispatch(event);
    harness.doc.dispatch(event);
    assert.equal(harness.albumCalls.length, 1);
    assert.equal(harness.handleKeyCalls.length, 1);
    assert.equal(event.counts.preventDefault, 1);
  });
});

test("a throwing entry function does not escape the listener", () => {
  const harness = makeHarness("eat.md", { frontmatter: { type: "[[album]]" } });
  harness.plugin.openAlbumSchemaEntry = () => { throw new Error("boom"); };
  withGlobals(harness.win, harness.doc, () => {
    harness.plugin.setupSchemaDoubleEquals();
    assert.doesNotThrow(() => harness.win.dispatch(makeKeyEvent()));
    assert.equal(harness.handleKeyCalls.length, 1);
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
    harness.win.dispatch(makeKeyEvent());
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

test("synthetic fourth kind opens without changing the gate or dispatcher", () => {
  const fourthCalls = [];
  const harness = makeHarness("fourth.md", { frontmatter: { type: "[[note]]" } });
  withGlobals(harness.win, harness.doc, () => {
    harness.plugin.setupSchemaDoubleEquals();
    assert.equal(harness.plugin.registerPropertyCard({
      kind: "fourth",
      match: ({ path }) => path === "fourth.md",
      open: () => { fourthCalls.push("fourth"); },
    }), true);
    assert.deepEqual(helpers.schemaDoubleEqualsGate(actingInput({ target: "fourth" })), {
      act: true, reason: "schema-key",
    });
    const event = makeKeyEvent();
    harness.win.dispatch(event);
    assert.deepEqual(event.counts, { preventDefault: 1, stopPropagation: 1, immediate: 1 });
    assert.deepEqual(fourthCalls, ["fourth"]);
    assert.equal(harness.albumCalls.length, 0);
    assert.equal(harness.bankCalls.length, 0);
    assert.equal(harness.recordCalls.length, 0);
    const both = makeKeyEvent();
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
    assert.deepEqual(helpers.schemaDoubleEqualsGate(actingInput({ target: "fourth" })).reason, "not-schema-note");
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
    const event = makeKeyEvent();
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
      const missEvent = makeKeyEvent();
      miss.win.dispatch(missEvent);
      assert.deepEqual(missEvent.counts, { preventDefault: 0, stopPropagation: 0, immediate: 0 });
      miss.plugin.teardownSchemaDoubleEquals();
    });
    harness.plugin.teardownSchemaDoubleEquals();
  });
});
