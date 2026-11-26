const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin {
  constructor(app) { this.app = app; }
  registerEditorExtension() {}
  registerMarkdownPostProcessor() {}
  registerEvent(value) { return value; }
}

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
  line: (options) => options,
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
    Notice: class {}, Plugin: TestPlugin, Platform: { isDesktopApp: true },
    normalizePath: (value) => value, parseYaml: () => ({}), editorInfoField, editorLivePreviewField,
  };
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value }, StateEffect, StateField, RangeSetBuilder };
  if (request === "@codemirror/view") return {
    Decoration, WidgetType, ViewPlugin: { fromClass: (cls, options) => ({ cls, options }) }, EditorView,
  };
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers: H } = LedgerToolsPlugin;
Module._load = originalLoad;

const SRC = "../plugins/bob-ledger-tools/src/";
const sourceFiles = {
  bank: ["248c-plugin-bank-setup-hosts.js", "paintBankSetupReading"],
  album: ["241v-plugin-album-header.js", "paintAlbumHeaderReading"],
  record: ["242kb-plugin-record-sheet-title.js", "paintRecordSheetReading"],
  area: ["249d-plugin-home-card-host.js", "paintHomeCardReading"],
  project: ["249d-plugin-home-card-host.js", "paintHomeCardReading"],
  notebook: ["249i-plugin-notebook-card-host.js", "paintNotebookCardReading"],
  prose: ["249n-plugin-prose-note-card-host.js", "paintProseNoteCardReading"],
};

function methodBody(source, name) {
  const start = source.indexOf(`  ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const end = source.indexOf("\n  }", start);
  assert.notEqual(end, -1, `${name} has a class-method boundary`);
  return source.slice(start, end + 4);
}

function foldView(kind, path) {
  const button = {
    attrs: new Map([["data-card-fold", kind], ["data-card-fold-source", path], ["aria-expanded", "true"]]),
    isConnected: true,
    getAttribute(name) { return this.attrs.get(name) ?? null; },
    setAttribute(name, value) { this.attrs.set(name, String(value)); },
    getBoundingClientRect() { return { width: 20, height: 16 }; },
  };
  const root = {
    matches() { return false; },
    querySelectorAll(selector) { return selector === "[data-card-fold]" ? [button] : []; },
  };
  button.parentNode = root;
  return { button, view: { file: { path }, dom: root } };
}

function makePlugin(sideEffects, timerQueue, subscriptions) {
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.app = {
    vault: {
      read: async () => "",
      getAbstractFileByPath: (path) => ({ path }),
      modify: async () => { sideEffects.writes += 1; },
      create: async () => { sideEffects.writes += 1; },
      delete: async () => { sideEffects.writes += 1; },
      process: async () => { sideEffects.writes += 1; },
    },
    metadataCache: {},
    workspace: {},
  };
  plugin.spawnBob = async () => { sideEffects.spawns += 1; throw new Error("paint must not spawn bob"); };
  plugin.registerEditorExtension = () => {};
  plugin.registerMarkdownPostProcessor = () => {};
  plugin.registerEvent = (value) => value;
  plugin.albumSetTimeout = (callback, ms) => {
    const timer = { callback, ms, cancelled: false };
    timerQueue.push(timer);
    return timer;
  };
  plugin.albumClearTimeout = (timer) => { if (timer) timer.cancelled = true; };
  plugin.bankSetTimeout = plugin.albumSetTimeout;
  plugin.bankClearTimeout = plugin.albumClearTimeout;

  plugin.bankSetupDesktop = () => true;
  plugin.bankSetupFootBind = () => {};
  plugin.bankSetupFootUnbind = () => {};
  plugin.bankSetupNoteReport = () => {};
  plugin.bankSetupSyncSurfaces = () => {};
  plugin.apiBankSubscribe = (args, callback) => {
    subscriptions.push({ args, callback });
    return () => {};
  };
  plugin.bankSetupModelFor = () => ({ expanded: false, problems: "" });

  plugin.albumHeaderFootBind = () => {};
  plugin.albumHeaderFootUnbind = () => {};
  plugin.apiAlbumSubscribe = (callback) => { subscriptions.push({ args: "album", callback }); return () => {}; };
  plugin.albumHeaderCardModelFor = () => null;
  plugin.albumHeaderModelFor = () => ({ problems: "" });

  plugin.recordSheetToday = () => "2026-11-26";
  plugin.recordSheetCardModelFor = () => null;
  plugin.recordWalkPaintReading = () => {};
  plugin.recordSheetNotifyOwnership = () => {};
  plugin.apiAlbumSubscribe = (callback) => { subscriptions.push({ args: "album", callback }); return () => {}; };

  plugin.homeCardDayTimer = true;
  plugin.homeCardTodayText = () => "2026-11-26";
  plugin.homeCardLiveSubscribe = () => {};
  plugin.homeCardBindFrontmatterOwnership = () => {};
  plugin.homeCardFootBind = () => {};
  plugin.homeCardFootUnbind = () => {};
  plugin.homeCardDesktop = () => true;
  plugin.notebookCardReadingRoot = () => null;
  plugin.proseNoteCardReadingRoot = () => null;
  plugin.notebookCardPropertyHost = () => ({
    refreshReading: () => plugin.paintNotebookCardReading(null, "notebooks.md"),
  });
  plugin.proseNoteCardHost = () => ({
    refreshReading: () => plugin.paintProseNoteCardReading(null, "sase_blog_contents.md"),
  });
  plugin.scheduleNotebookCardRefresh = () => plugin.notebookCardPropertyHost().refreshReading();
  plugin.scheduleProseNoteCardRefresh = () => plugin.proseNoteCardHost().refreshReading();

  const root = {
    classList: { contains: () => false, add() {}, remove() {} },
    querySelectorAll: () => [],
    closest: () => null,
  };
  for (const [rootMethod, scopeMethod] of [
    ["bankSetupReadingRoot", "bankSetupReadingScope"],
    ["albumHeaderReadingRoot", "albumHeaderReadingScope"],
    ["recordSheetReadingRoot", "recordSheetReadingScope"],
    ["homeCardReadingRoot", "homeCardReadingScope"],
  ]) {
    plugin[rootMethod] = () => root;
    plugin[scopeMethod] = () => root;
  }
  for (const method of [
    "bankSetupRemoveReading", "bankSetupRemoveStrays",
    "albumHeaderRemoveReading", "albumHeaderRemoveStrays",
    "recordSheetRemoveReading", "recordSheetRemoveStrays",
    "homeCardRemoveReading", "homeCardRemoveStrays",
  ]) plugin[method] = () => {};

  const paints = Object.create(null);
  for (const [kind, [, method]] of Object.entries(sourceFiles)) {
    if (paints[method]) continue;
    const original = plugin[method].bind(plugin);
    paints[method] = 0;
    plugin[method] = (...args) => { paints[method] += 1; return original(...args); };
  }
  return { plugin, paints, root };
}

test("all card painters are passive and repeated fold refreshes stay read-only", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const forbidden = /processFrontMatter\s*\(|(?:vault\s*\.\s*(?:modify|create|delete|process)|spawnBob|execFileSync?|spawnSync|spawn)\s*\(/;
  for (const [kind, [file, method]] of Object.entries(sourceFiles)) {
    const source = fs.readFileSync(path.join(__dirname, SRC, file), "utf8");
    assert.doesNotMatch(methodBody(source, method), forbidden, `${kind} paint is a passive render`);
  }

  const sideEffects = { writes: 0, spawns: 0 };
  const timerQueue = [];
  const subscriptions = [];
  const { plugin, paints, root } = makePlugin(sideEffects, timerQueue, subscriptions);
  plugin.setupBankSetup();
  plugin.setupAlbumHeader();
  plugin.setupRecordSheet();
  plugin.setupHomeCard();

  const cases = [
    { kind: "bank", path: "bank.md", reading: "bankSetupReading", host: "bankPropertyCardHost", paint: "paintBankSetupReading", setup: "bankSetup" },
    { kind: "album", path: "eat.md", reading: "albumHeaderReading", host: "albumPropertyCardHost", paint: "paintAlbumHeaderReading", setup: "album" },
    { kind: "record", path: "eat/nagi.md", reading: "recordSheetReading", host: "recordPropertyCardHost", paint: "paintRecordSheetReading", setup: "record" },
    { kind: "area", path: "love.md", reading: "homeCardReading", host: "homePropertyCardHost", paint: "paintHomeCardReading", setup: "home" },
    { kind: "project", path: "sase_blog.md", reading: "homeCardReading", host: "homePropertyCardHost", paint: "paintHomeCardReading", setup: "home" },
    { kind: "notebook", path: "notebooks.md", host: "notebookCardPropertyHost", paint: "paintNotebookCardReading" },
    { kind: "prose", path: "sase_blog_contents.md", host: "proseNoteCardHost", paint: "paintProseNoteCardReading" },
  ];
  for (const item of cases) {
    if (item.reading) plugin[item.reading].add({ el: root, path: item.path, surface: root, scope: root });
  }

  const bankSubscription = subscriptions.find((item) => item.args?.command === "config");
  assert.ok(bankSubscription, "Bank Setup subscribes to the config report");
  assert.deepEqual(bankSubscription.args, { command: "config" });
  assert.equal(paints.paintBankSetupReading, 0, "Bank config paint waits for its subscription callback");

  const toggles = {
    bank: (path) => plugin.bankSetupToggleExpanded(path),
    album: (path) => {
      const open = plugin.albumHeaderIsExpanded(path, {});
      plugin.albumHeaderSetExpanded(path, !open, "");
      return true;
    },
    record: (path) => {
      plugin.recordSheetSetCollapsed(path, !plugin.recordSheetIsCollapsed(path));
      return true;
    },
    area: (path) => { plugin.homeCardSetCollapsed(path, !plugin.homeCardIsCollapsed(path)); return true; },
    project: (path) => { plugin.homeCardSetCollapsed(path, !plugin.homeCardIsCollapsed(path)); return true; },
    notebook: (path) => { plugin.notebookCardSetCollapsed(path, !plugin.notebookCardIsCollapsed(path)); return true; },
    prose: (path) => plugin.proseNoteCardSetExpanded(path, !plugin.proseNoteCardIsExpanded(path)),
  };
  const unregister = [];
  for (const kind of Object.keys(toggles)) unregister.push(H.propertyCardRegisterFoldKind(plugin, kind, { toggle: toggles[kind] }));

  for (const item of cases) {
    const { button, view } = foldView(item.kind, item.path);
    for (let i = 0; i < 12; i += 1) {
      button.setAttribute("aria-expanded", i % 2 === 0 ? "true" : "false");
      assert.equal(H.propertyCardToggleDetails(view), true, `${item.kind} fold toggle ${i + 1}`);
      plugin[item.host]().refreshReading();
    }
  }

  for (const item of cases.filter((candidate) => candidate.kind === "notebook" || candidate.kind === "prose")) {
    for (let i = 0; i < 12; i += 1) {
      H.propertyCardFootToggle(item.path);
      plugin[item.host]().refreshReading();
    }
  }

  const bankPaintsBeforeConfig = paints.paintBankSetupReading;
  bankSubscription.callback({ results: {} });
  assert.equal(paints.paintBankSetupReading, bankPaintsBeforeConfig, "the config event schedules Bank refresh instead of painting inline");
  const bankTimers = timerQueue.filter((timer) => !timer.cancelled && timer.ms === 100);
  assert.ok(bankTimers.length > 0, "the config event schedules the shared host refresh");
  for (const timer of bankTimers) timer.callback();

  assert.ok(paints.paintBankSetupReading > bankPaintsBeforeConfig);
  assert.ok(paints.paintAlbumHeaderReading >= 12);
  assert.ok(paints.paintRecordSheetReading >= 12);
  assert.ok(paints.paintHomeCardReading >= 24, "Area and Project folds both repaint through the shared home host");
  assert.ok(paints.paintNotebookCardReading >= 24, "Notebook fold and drawer toggles refresh the passive painter");
  assert.ok(paints.paintProseNoteCardReading >= 24, "Prose fold and drawer toggles refresh the passive painter");
  assert.deepEqual(sideEffects, { writes: 0, spawns: 0 });
  for (const dispose of unregister) dispose();
  plugin.teardownBankSetup();
  plugin.teardownAlbumHeader();
  plugin.teardownRecordSheet();
  plugin.teardownHomeCard();
});
