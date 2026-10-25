// Day strip Live Preview block-widget mount, controls, and config gate.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const editorInfoField = {};
const editorLivePreviewField = {};
let stateEffectDefines = 0;
let stateFieldDefines = 0;

class StubWidgetType {}
class StubDecorationSet {
  constructor(ranges) { this.ranges = ranges || []; }
  iter() {
    let index = 0;
    const ranges = this.ranges;
    return {
      get value() { return ranges[index] ? ranges[index].value : null; },
      get from() { return ranges[index] ? ranges[index].from : null; },
      next() { index += 1; },
    };
  }
  map(changes) {
    return new StubDecorationSet(this.ranges.map((range) => ({
      ...range,
      from: changes.mapPos(range.from, 1),
      to: changes.mapPos(range.to, 1),
    })));
  }
}
const StubDecoration = {
  none: new StubDecorationSet([]),
  widget(spec) {
    return {
      spec,
      range(position) { return { from: position, to: position, value: this }; },
    };
  },
  set(ranges) { return new StubDecorationSet(ranges); },
};
const StubStateEffect = {
  define() {
    stateEffectDefines += 1;
    const type = {};
    type.of = (value) => ({ value, is: (other) => other === type });
    return type;
  },
};
const StubStateField = {
  define(spec) { stateFieldDefines += 1; return spec; },
};
class TestPlugin {
  constructor(app) { this.app = app; }
  addCommand(command) { (this.commands ||= []).push(command); }
  registerEditorExtension(extension) { (this.editorExtensions ||= []).push(extension); }
}
class TestNotice { constructor(message) { TestNotice.messages.push(String(message)); } }
TestNotice.messages = [];

const originalLoad = Module._load;
Module._load = function loadWithDayStripStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownRenderChild: class {},
      MarkdownView: class {},
      Notice: TestNotice,
      Platform: { isDesktopApp: true },
      Plugin: TestPlugin,
      normalizePath: (value) => value,
      parseYaml(text) {
        const match = /(?:^|\n)\s*day\s*:\s*([^\s#]+)/i.exec(String(text));
        return match ? { day: match[1] } : {};
      },
      editorInfoField,
      editorLivePreviewField,
    };
  }
  if (request === "@codemirror/state") {
    return {
      Prec: { highest: (value) => value },
      StateEffect: StubStateEffect,
      StateField: StubStateField,
      RangeSetBuilder: class {},
    };
  }
  if (request === "@codemirror/view") {
    return {
      EditorView: {
        decorations: { from: (field, get) => ({ field, get, fromField: true }) },
        updateListener: { of: (listener) => ({ listener }) },
      },
      keymap: { of: (value) => value },
      ViewPlugin: { fromClass: (cls, options) => ({ cls, options }) },
      Decoration: StubDecoration,
      WidgetType: StubWidgetType,
    };
  }
  if (request === "@codemirror/language") return { syntaxTree: () => null };
  return originalLoad.call(this, request, parent, isMain);
};
const MAIN_PATH = require.resolve("../plugins/bob-ledger-tools/main.js");
delete require.cache[MAIN_PATH];
const LedgerToolsPlugin = require(MAIN_PATH);
Module._load = originalLoad;

function makeDoc(lines) {
  return {
    length: lines.join("\n").length,
    lines: lines.length,
    line(number) { return { text: lines[number - 1] || "" }; },
  };
}
function makeState(doc, path, live = true) {
  return {
    doc,
    field(field) {
      if (field === editorInfoField) return { file: { path } };
      if (field === editorLivePreviewField) return live;
      throw new Error("Unknown editor field");
    },
  };
}
function ranges(value) {
  const cursor = value && value.decorations ? value.decorations.iter() : null;
  const found = [];
  let guard = 0;
  while (cursor && cursor.value && guard++ < 100) {
    found.push({ from: cursor.from, value: cursor.value });
    cursor.next();
  }
  return found;
}
function makePlugin() {
  const app = {
    localStore: new Map(),
    leaves: [],
    loadLocalStorage(key) { return this.localStore.get(key); },
    saveLocalStorage(key, value) { this.localStore.set(key, value); },
    workspace: { getLeavesOfType: () => app.leaves },
  };
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.dayStripLocalNow = () => "2026-10-24";
  plugin.dayStripCanSpawn = () => true;
  plugin.dayStripConfigEnabled = () => true;
  return plugin;
}

test("setup lazily registers the block StateField and Toggle Day stats", () => {
  assert.equal(stateEffectDefines, 1, "require time retains one eager StateEffect.define()");
  const plugin = makePlugin();
  plugin.setupDayStripMount();
  assert.equal(stateFieldDefines, 1);
  assert.equal(stateEffectDefines, 1, "setup leaves the refresh effect lazy");
  assert.equal(plugin.editorExtensions[0], plugin.dayStripMountField);
  assert.ok(plugin.commands.some((item) => item.name === "Toggle Day stats"));
  const provided = plugin.dayStripMountField.provide(plugin.dayStripMountField);
  assert.equal(provided.fromField, true);
  // CodeMirror's decorations facet only accepts a DecorationSet; the
  // { path, day, decorations } field value must be unwrapped.
  assert.equal(typeof provided.get, "function", "provider maps the field value");
  const doc = makeDoc(["- [ ] Work"]);
  const value = plugin.dayStripMountField.create(makeState(doc, "2026/20261024.md"));
  assert.equal(provided.get(value), value.decorations);
  const inactive = plugin.dayStripMountField.create(makeState(doc, "Projects/alpha.md"));
  assert.equal(provided.get(inactive), StubDecoration.none);
});

test("canonical Live Preview daily notes get a block widget at doc.length", () => {
  const plugin = makePlugin();
  plugin.setupDayStripMount();
  const doc = makeDoc(["## Pomodoros", "- [ ] Work"]);
  const value = plugin.dayStripMountField.create(makeState(doc, "2026/20261024.md"));
  const mounted = ranges(value);
  assert.equal(value.day, "2026-10-24");
  assert.equal(mounted.length, 1);
  assert.equal(mounted[0].from, doc.length);
  assert.equal(mounted[0].value.spec.block, true);
  assert.equal(mounted[0].value.spec.side, 1);
  const widget = mounted[0].value.spec.widget;
  assert.equal(widget.ignoreEvent(), true);
  assert.equal(widget.estimatedHeight, 48);
  const equalWidget = plugin.dayStripMountDecoration(value.path, value.day, doc)
    .ranges[0].value.spec.widget;
  assert.equal(widget.eq(equalWidget), true);
  assert.equal(widget.eq(plugin.dayStripMountDecoration(value.path, "2026-10-23", doc)
    .ranges[0].value.spec.widget), false);
});

test("identity, Live Preview, desktop, config, toggle, and matching fence gate the widget", () => {
  const plugin = makePlugin();
  plugin.setupDayStripMount();
  const field = plugin.dayStripMountField;
  const noMount = (doc, path, live = true) =>
    ranges(field.create(makeState(doc, path, live))).length === 0;
  const doc = makeDoc(["- [ ] Work"]);
  assert.equal(noMount(doc, "Projects/alpha.md"), true);
  assert.equal(noMount(doc, "2026/20261025.md"), true, "future notes stay empty");
  assert.equal(noMount(doc, "2026/20261024.md", false), true, "Source mode stays empty");
  plugin.dayStripCanSpawn = () => false;
  assert.equal(noMount(doc, "2026/20261024.md"), true, "mobile or no-bob hosts stay empty");
  plugin.dayStripCanSpawn = () => true;
  plugin.dayStripConfigEnabled = () => false;
  assert.equal(noMount(doc, "2026/20261024.md"), false, "transactions use the cached config");
  assert.equal(plugin.dayStripCheckConfig(), true);
  assert.equal(noMount(doc, "2026/20261024.md"), true);
  plugin.dayStripConfigEnabled = () => true;
  assert.equal(plugin.dayStripCheckConfig(), true);
  plugin.dayStripSessionEnabled = false;
  assert.equal(noMount(doc, "2026/20261024.md"), true);
  plugin.dayStripSessionEnabled = true;

  const ownDay = makeDoc(["- [ ] Work", "\x60\x60\x60bob-day-stats", "day: 2026-10-24", "\x60\x60\x60"]);
  const noDay = makeDoc(["- [ ] Work", "\x60\x60\x60bob-day-stats", "group: day", "\x60\x60\x60"]);
  const otherDay = makeDoc(["- [ ] Work", "\x60\x60\x60bob-day-stats", "day: 2026-10-23", "\x60\x60\x60"]);
  assert.equal(noMount(ownDay, "2026/20261024.md"), true);
  assert.equal(noMount(noDay, "2026/20261024.md"), true);
  assert.equal(noMount(otherDay, "2026/20261024.md"), false);
});

test("document changes update the mapped end and an own-day fence stands the mount down", () => {
  const plugin = makePlugin();
  plugin.setupDayStripMount();
  let configReads = 0;
  plugin.dayStripConfigEnabled = () => { configReads += 1; return true; };
  const field = plugin.dayStripMountField;
  const beforeDoc = makeDoc(["- [ ] Work"]);
  const beforeState = makeState(beforeDoc, "2026/20261024.md");
  const before = field.create(beforeState);
  const afterDoc = makeDoc(["- [ ] Work", "append"]);
  const after = field.update(before, {
    startState: beforeState,
    state: makeState(afterDoc, "2026/20261024.md"),
    docChanged: true,
    changes: { mapPos: (position) => position + afterDoc.length - beforeDoc.length },
  });
  assert.equal(ranges(after)[0].from, afterDoc.length);
  assert.equal(after.decorations.ranges[0].value.spec, before.decorations.ranges[0].value.spec);

  const fenceDoc = makeDoc(["- [ ] Work", "\x60\x60\x60bob-day-stats", "\x60\x60\x60"]);
  const fenced = field.update(after, {
    startState: makeState(afterDoc, "2026/20261024.md"),
    state: makeState(fenceDoc, "2026/20261024.md"),
    docChanged: true,
    changes: { mapPos: () => fenceDoc.length },
  });
  assert.equal(ranges(fenced).length, 0);
  const restoredDoc = makeDoc(["- [ ] Work"]);
  const restored = field.update(fenced, {
    startState: makeState(fenceDoc, "2026/20261024.md"),
    state: makeState(restoredDoc, "2026/20261024.md"),
    docChanged: true,
    changes: { mapPos: () => restoredDoc.length },
  });
  assert.equal(ranges(restored).length, 1);
  assert.equal(configReads, 0, "editor transactions never read the config file");
});

test("toDOM paints/registers live hosts and suppresses popover and canvas DOM", () => {
  const plugin = makePlugin();
  plugin.setupDayStripMount();
  let paints = 0;
  let checks = 0;
  plugin.dayStripPaint = () => { paints += 1; };
  plugin.dayStripCheck = () => { checks += 1; };
  plugin.dayStripObserve = () => {};
  plugin.dayStripReleaseRecord = (record) => plugin.dayStripViewsStore().delete(record);
  const doc = makeDoc(["- [ ] Work"]);
  const widget = ranges(plugin.dayStripMountField.create(makeState(doc, "2026/20261024.md")))[0]
    .value.spec.widget;
  const ownerDocument = { createElement: () => ({ setAttribute(name, value) { this[name] = value; } }) };
  const ordinary = { dom: { ownerDocument, closest: () => null } };
  const host = widget.toDOM(ordinary);
  assert.equal(paints, 1);
  assert.equal(checks, 1);
  assert.equal(plugin.dayStripViewsStore().size, 1);
  const blockedWidget = plugin.dayStripMountDecoration("2026/20261024.md", "2026-10-24", doc)
    .ranges[0].value.spec.widget;
  const blocked = blockedWidget.toDOM({
    dom: { ownerDocument, closest: (selector) => selector.includes("canvas-node") ? {} : null },
  });
  assert.equal(blocked.hidden, true);
  assert.equal(plugin.dayStripViewsStore().size, 1);
  assert.equal(paints, 1);
  widget.destroy(host);
  assert.equal(plugin.dayStripViewsStore().size, 0);
});

test("toggle/config refresh effects are lazy and session state needs no vault writes", () => {
  const plugin = makePlugin();
  let enabled = true;
  plugin.dayStripConfigEnabled = () => enabled;
  const dispatches = [];
  plugin.app.leaves = [{ view: { editor: { cm: { dispatch: (tr) => dispatches.push(tr) } } } }];
  plugin.setupDayStripMount();
  const field = plugin.dayStripMountField;
  const doc = makeDoc(["- [ ] Work"]);
  const state = makeState(doc, "2026/20261024.md");
  let value = field.create(state);
  plugin.toggleDayStripMount();
  assert.equal(stateEffectDefines, 2, "refresh effect is first defined by a control action");
  value = field.update(value, { state, startState: state, effects: dispatches.at(-1).effects });
  assert.equal(ranges(value).length, 0);
  plugin.toggleDayStripMount();
  value = field.update(value, { state, startState: state, effects: dispatches.at(-1).effects });
  assert.equal(ranges(value).length, 1);
  enabled = false;
  assert.equal(plugin.dayStripCheckConfig(), true);
  value = field.update(value, { state, startState: state, effects: dispatches.at(-1).effects });
  assert.equal(ranges(value).length, 0);
});

test("each strip re-check cycle re-reads stats.day_strip and refreshes editors on a flip", () => {
  const plugin = makePlugin();
  let enabled = true;
  let configReads = 0;
  plugin.dayStripConfigEnabled = () => { configReads += 1; return enabled; };
  const dispatches = [];
  plugin.app.leaves = [{ view: { editor: { cm: { dispatch: (tr) => dispatches.push(tr) } } } }];
  plugin.setupDayStripMount();
  plugin.dayStripCheck = () => {};
  configReads = 0;
  plugin.dayStripCheckAll();
  assert.equal(configReads, 0, "no strips, no config read");
  plugin.dayStripViewsStore().add({ el: {} });
  plugin.dayStripCheckAll();
  assert.equal(configReads, 1);
  assert.equal(dispatches.length, 0, "an unchanged config dispatches nothing");
  enabled = false;
  plugin.dayStripCheckAll();
  assert.equal(plugin.dayStripConfigCached(), false);
  assert.equal(dispatches.length, 1, "a flip refreshes every markdown editor");
});
