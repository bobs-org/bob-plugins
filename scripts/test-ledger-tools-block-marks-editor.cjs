// Focused Live Preview/runtime coverage for blocked-reason marks.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const editorInfoField = { name: "editor-info" };
const editorLivePreviewField = { name: "live-preview" };
let capturedMarkClass = null;

class StubRangeSetBuilder {
  constructor() { this.adds = []; }
  add(from, to, value) { this.adds.push({ from, to, value }); }
  finish() { return { adds: this.adds.slice() }; }
}

const StubStateEffect = {
  define() {
    const type = {};
    type.of = (value) => ({ value, is: (other) => other === type });
    return type;
  },
};

const StubDecoration = {
  none: { none: true },
  line: (spec) => ({ line: true, ...spec }),
  replace: (spec) => ({ replace: true, ...spec }),
};

class StubPlugin {
  constructor(app) { this.app = app; }
}

class StubNotice {
  constructor(message) { StubNotice.messages.push(String(message)); }
}
StubNotice.messages = [];

const originalLoad = Module._load;
Module._load = function loadWithBlockMarkEditorStubs(request) {
  if (request === "obsidian") {
    return {
      MarkdownView: class MarkdownView {},
      Notice: StubNotice,
      Platform: { isDesktopApp: true },
      Plugin: StubPlugin,
      normalizePath: (value) => value,
      parseYaml: (text) => JSON.parse(text),
      editorInfoField,
      editorLivePreviewField,
    };
  }
  if (request === "@codemirror/state") {
    return {
      Prec: { highest: (value) => value },
      StateEffect: StubStateEffect,
      RangeSetBuilder: StubRangeSetBuilder,
    };
  }
  if (request === "@codemirror/view") {
    return {
      EditorView: { updateListener: { of: (listener) => listener } },
      keymap: { of: (value) => value },
      ViewPlugin: {
        fromClass(cls, options) {
          capturedMarkClass = cls;
          return { cls, options };
        },
      },
      Decoration: StubDecoration,
      WidgetType: class WidgetType {},
    };
  }
  if (request === "@codemirror/language") {
    return {
      syntaxTree(state) {
        const ranges = Array.isArray(state && state.codeRanges) ? state.codeRanges : [];
        return {
          resolveInner(pos) {
            const match = ranges.find((range) => pos >= range.from && pos < range.to);
            if (!match) return null;
            if (match.kind === "hmd-fence") return { name: "hmd-codeblock", parent: null };
            return { name: match.kind === "fence" ? "HyperMD-codeblock" : "inline-code", parent: null };
          },
        };
      },
    };
  }
  return originalLoad.call(this, request, ...Array.prototype.slice.call(arguments, 1));
};

const MAIN_PATH = require.resolve("../plugins/bob-ledger-tools/main.js");
delete require.cache[MAIN_PATH];
const LedgerToolsPlugin = require(MAIN_PATH);
Module._load = originalLoad;

const TODAY = "2026-11-01";
const FUTURE = "2026-11-20";
const OPEN_TASK = {
  id: "dep",
  status: { type: "TODO" },
  path: "Projects/Example.md",
  blockId: "dep",
  description: "Finish the battery #task [id:: dep]",
};

function makeDoc(text) {
  const rows = [];
  let from = 0;
  const source = String(text || "");
  const lines = source.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const value = lines[index];
    rows.push({ from, to: from + value.length, number: index + 1, text: value });
    from += value.length + 1;
  }
  return {
    length: source.length,
    lines: rows.length,
    lineAt(pos) {
      const point = Math.max(0, Math.min(Number(pos) || 0, source.length));
      return rows.find((row, index) => point <= row.to || index === rows.length - 1) || rows[rows.length - 1];
    },
  };
}

function stateFor(text, { live = true, path = "Projects/Example.md", codeRanges = [], selection = [] } = {}) {
  return {
    doc: makeDoc(text),
    codeRanges,
    selection: { ranges: selection },
    field(field) {
      if (field === editorLivePreviewField) return live;
      if (field === editorInfoField) return { file: { path } };
      throw new Error("Unknown state field");
    },
  };
}

function makePlugin(tasks = [OPEN_TASK]) {
  const memo = { tasks };
  const events = [];
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.app = {
    plugins: { plugins: { "obsidian-tasks-plugin": { getTasks: () => tasks } } },
    workspace: { trigger: (name) => events.push(name) },
  };
  plugin.freshnessEnsureMemo = () => memo;
  plugin.dateMarksToday = () => TODAY;
  plugin.blockMarksEnabled = true;
  plugin.blockMarksLadder = null;
  plugin.blockMarksLadderReady = true;
  plugin.blockMarkEditorViews = new Set();
  plugin.blockMarkTooltipBindings = new Map();
  plugin.blockMarkResumeDocuments = new WeakSet();
  plugin.blockMarkResumeWindows = new WeakSet();
  plugin.priorityLadderSnapshot = () => { throw new Error("render path attempted ladder I/O"); };
  plugin.registerDomEvent = (target, event, callback) => events.push({ target, event, callback });
  return { plugin, memo, events };
}

function makeView(text, options = {}) {
  const listeners = new Map();
  const view = {
    state: stateFor(text, options),
    visibleRanges: [{ from: 0, to: makeDoc(text).length }],
    dom: {
      ownerDocument: options.ownerDocument || null,
      addEventListener(name, callback, capture) { listeners.set(name, { callback, capture }); },
      removeEventListener(name) { listeners.delete(name); },
    },
    dispatch(transaction) { (this.dispatched || (this.dispatched = [])).push(transaction); },
    posAtDOM() { return 0; },
    listeners,
  };
  return view;
}

function lineMarks(decorations) {
  return (decorations && decorations.adds || []).filter((entry) => entry.value && entry.value.line);
}

function replaceMarks(decorations) {
  return (decorations && decorations.adds || []).filter((entry) => entry.value && entry.value.replace);
}

const WAITING = `- [?] #task Water plants [scheduled:: ${FUTURE}]`;

test("Live Preview emits own-row line attributes once across visible ranges", () => {
  const { plugin } = makePlugin();
  const view = makeView(`${WAITING}\n- [*] #task Next task`);
  view.visibleRanges = [{ from: 0, to: 40 }, { from: 0, to: 70 }];
  const marks = lineMarks(plugin.buildBlockMarkDecorations(view));
  assert.equal(marks.length, 1);
  assert.deepEqual(marks[0].value.attributes, {
    "data-bob-block": "date",
    "data-bob-block-family": "waiting",
  });
});

test("neutral rows, inline code, and fenced content stay unmarked", () => {
  const { plugin } = makePlugin();
  const plain = "- [*] #task Next [scheduled:: 2026-11-20]";
  const inline = "- [?] `#task` example [scheduled:: 2026-11-20]";
  const fenced = "- [?] #task Example [scheduled:: 2026-11-20]";
  const hmdFenced = "- [?] #task Live fence [scheduled:: 2026-11-20]";
  const inlineStart = inline.indexOf("#task");
  const fenceStart = fenced.indexOf("#task");
  const hmdStart = hmdFenced.indexOf("#task");
  const text = [plain, inline, fenced, hmdFenced].join("\n");
  const secondFrom = plain.length + 1;
  const thirdFrom = secondFrom + inline.length + 1;
  const fourthFrom = thirdFrom + fenced.length + 1;
  const view = makeView(text, {
    codeRanges: [
      { from: secondFrom + inlineStart, to: secondFrom + inlineStart + 5, kind: "inline" },
      { from: thirdFrom + fenceStart, to: thirdFrom + fenceStart + 5, kind: "fence" },
      { from: fourthFrom + hmdStart, to: fourthFrom + hmdStart + 5, kind: "hmd-fence" },
    ],
  });
  assert.equal(lineMarks(plugin.buildBlockMarkDecorations(view)).length, 0);
});

test("current unsaved document text changes or removes the visible mark", () => {
  const { plugin } = makePlugin();
  const view = makeView(WAITING);
  assert.equal(lineMarks(plugin.buildBlockMarkDecorations(view))[0].value.attributes["data-bob-block"], "date");
  view.state = stateFor("- [?] #task Water plants", { path: "Projects/Example.md" });
  assert.equal(lineMarks(plugin.buildBlockMarkDecorations(view))[0].value.attributes["data-bob-block"], "stale");
  view.state = stateFor("- [*] #task Water plants [scheduled:: 2026-11-20]");
  assert.equal(lineMarks(plugin.buildBlockMarkDecorations(view)).length, 0);
});

test("rebuilds on document, viewport, live-preview, path, and refresh effect, never selection alone", () => {
  const { plugin } = makePlugin();
  const before = stateFor(WAITING, { live: true, path: "Projects/Example.md" });
  const afterLive = stateFor(WAITING, { live: false, path: "Projects/Example.md" });
  const afterPath = stateFor(WAITING, { live: true, path: "Projects/Other.md" });
  assert.equal(plugin.blockMarkShouldRebuild({ docChanged: true }), true);
  assert.equal(plugin.blockMarkShouldRebuild({ viewportChanged: true }), true);
  assert.equal(plugin.blockMarkShouldRebuild({ selectionSet: true }), false);
  assert.equal(plugin.blockMarkShouldRebuild({ startState: before, state: afterLive }), true);
  assert.equal(plugin.blockMarkShouldRebuild({ startState: before, state: afterPath }), true);
  const refresh = LedgerToolsPlugin.helpers.ensureBlockMarksRefresh();
  assert.equal(plugin.blockMarkShouldRebuild({ transactions: [{ effects: refresh.of(null) }] }), true);
});

test("hot model calls use the in-memory ladder and project lookup is memoized per path", () => {
  const projectTask = {
    id: "project",
    status: { type: "ON_HOLD" },
    path: "Projects/Example.md",
    blockId: "prj",
    description: "Example #task [dependsOn:: dep] ^prj",
  };
  const tasks = [OPEN_TASK, projectTask];
  let scans = 0;
  const find = tasks.find;
  tasks.find = function countedFind(...args) {
    scans += 1;
    return find.apply(this, args);
  };
  const { plugin, memo } = makePlugin(tasks);
  plugin.blockMarksLadder = null;
  let ladderReads = 0;
  plugin.priorityLadderSnapshot = () => {
    ladderReads += 1;
    throw new Error("render path attempted ladder I/O");
  };
  const model = plugin.blockMarkModelForLine("Projects/Example.md", WAITING);
  assert.equal(model.key, "date");
  assert.equal(plugin.blockMarkProjectReason("Projects/Example.md"), "after Finish the battery");
  assert.equal(plugin.blockMarkProjectReason("Projects/Example.md"), "after Finish the battery");
  assert.equal(scans, 1);
  assert.equal(ladderReads, 0);
  assert.ok(memo.blockMarksProjectTasksByPath instanceof Map);
});

test("capture-phase tooltip attaches to the existing checkbox and restores owned attributes", () => {
  const { plugin } = makePlugin();
  plugin.blockMarksTimers = { set: () => 1, clear: () => {} };
  const row = {
    parentElement: null,
    classList: { contains: (name) => name === "HyperMD-task-line" },
  };
  const attrs = new Map([["aria-label", "Existing name"], ["data-tooltip-position", "left"]]);
  const input = {
    tagName: "INPUT",
    isConnected: true,
    parentElement: row,
    classList: { contains: (name) => name === "task-list-item-checkbox" },
    getAttribute: (name) => attrs.has(name) ? attrs.get(name) : null,
    setAttribute: (name, value) => attrs.set(name, String(value)),
    removeAttribute: (name) => attrs.delete(name),
  };
  const view = makeView(WAITING);
  view.posAtDOM = () => 0;
  const extension = plugin.createBlockMarkExtension();
  const instance = new capturedMarkClass(view);
  assert.equal(view.listeners.get("mouseover").capture, true);
  instance.onMouseOver({ target: input });
  assert.match(attrs.get("aria-label"), /^Blocked · until /);
  assert.equal(attrs.get("data-tooltip-position"), "top");

  view.state = stateFor("- [*] #task Water plants", { path: "Projects/Example.md" });
  instance.update({ docChanged: true, view });
  assert.equal(attrs.get("aria-label"), "Existing name");
  assert.equal(attrs.get("data-tooltip-position"), "left");
  instance.destroy();
  assert.equal(view.listeners.has("mouseover"), false);
  assert.equal(plugin.blockMarkTooltipBindings.size, 0);
  assert.ok(extension);
});

test("toggle is reversible, refreshes views, rerenders Tasks, and shows exact Notices", () => {
  StubNotice.messages.length = 0;
  const { plugin, events } = makePlugin();
  const gates = [];
  const refreshes = [];
  plugin.applyMarkGateClass = (name, enabled) => gates.push([name, enabled]);
  plugin.runBlockMarksRefresh = (allowSwap) => refreshes.push(allowSwap);
  assert.equal(plugin.toggleBlockMarks(), false);
  assert.equal(plugin.toggleBlockMarks(), true);
  assert.deepEqual(gates, [["bob-block-marks", false], ["bob-block-marks", true]]);
  assert.deepEqual(refreshes, [true, true]);
  assert.deepEqual(events, [
    "obsidian-tasks-plugin:reload-open-search-results",
    "obsidian-tasks-plugin:reload-open-search-results",
  ]);
  assert.deepEqual(StubNotice.messages, ["Blocked-reason marks off", "Blocked-reason marks on"]);
});

test("ladder invalidation compares semantic content and resume registers each editor document", () => {
  const { plugin, events } = makePlugin();
  plugin.blockMarksLadderReady = false;
  plugin.blockMarksLadderSignature = null;
  let ladder = [{ label: "P1", value: "high" }];
  plugin.priorityLadderCache = { checkedAt: 10 };
  plugin.priorityLadderSnapshot = () => ({ ladder });
  let schedules = 0;
  plugin.scheduleBlockMarksRefresh = () => { schedules += 1; };
  assert.equal(plugin.refreshBlockMarksLadder(), false);
  assert.equal(plugin.refreshBlockMarksLadder(), false);
  ladder = [{ label: "P2", value: "high" }];
  assert.equal(plugin.refreshBlockMarksLadder(), true);
  assert.equal(schedules, 1);

  plugin.blockMarksDay = "2026-11-01";
  assert.equal(plugin.refreshBlockMarksForRollover(new Date(2026, 10, 1, 12)), false);
  assert.equal(plugin.refreshBlockMarksForRollover(new Date(2026, 10, 2, 12)), true);
  assert.equal(schedules, 2);

  const documentEvents = [];
  const windowEvents = [];
  const doc = { visibilityState: "hidden", defaultView: {} };
  plugin.registerDomEvent = (target, event, callback) => {
    (target === doc ? documentEvents : windowEvents).push({ event, callback });
  };
  plugin.blockMarksOnResume = () => { events.push("resume"); };
  plugin.registerBlockMarksResumeHooks({ dom: { ownerDocument: doc } });
  plugin.registerBlockMarksResumeHooks({ dom: { ownerDocument: doc } });
  assert.equal(documentEvents.length, 1);
  assert.equal(windowEvents.length, 1);
  documentEvents[0].callback();
  assert.equal(events.includes("resume"), false);
  doc.visibilityState = "visible";
  documentEvents[0].callback();
  windowEvents[0].callback();
  assert.equal(events.filter((event) => event === "resume").length, 2);
});

test("setup owns the gate and plugin-registered unload cleanup", () => {
  const { plugin } = makePlugin();
  plugin.blockMarksLadderReady = false;
  let syncGate = null;
  let cleanup = null;
  const gates = [];
  plugin.applyMarkGateClass = (name, enabled) => gates.push([name, enabled]);
  plugin.registerMarkGatePopoutSync = (name, getEnabled) => { syncGate = { name, getEnabled }; };
  plugin.register = (callback) => { cleanup = callback; };
  plugin.setupBlockMarkRefreshListeners = () => {};
  plugin.priorityLadderSnapshot = () => ({ ladder: null });
  plugin.setupBlockMarks();
  assert.deepEqual(gates, [["bob-block-marks", true]]);
  assert.equal(syncGate.name, "bob-block-marks");
  assert.equal(syncGate.getEnabled(), true);
  assert.equal(typeof cleanup, "function");
  cleanup();
  assert.deepEqual(gates, [["bob-block-marks", true], ["bob-block-marks", false]]);
});

function tooltipInput(attrs) {
  const row = {
    parentElement: null,
    classList: { contains: (name) => name === "HyperMD-task-line" },
  };
  return {
    tagName: "INPUT",
    isConnected: true,
    parentElement: row,
    classList: { contains: (name) => name === "task-list-item-checkbox" },
    getAttribute: (name) => (attrs.has(name) ? attrs.get(name) : null),
    setAttribute: (name, value) => attrs.set(name, String(value)),
    removeAttribute: (name) => attrs.delete(name),
  };
}

test("requestMeasure write-pass attaches tooltips after rebuild", () => {
  const { plugin } = makePlugin();
  plugin.blockMarksTimers = { set: () => 1, clear: () => {} };
  const attrs = new Map();
  const input = tooltipInput(attrs);
  const view = makeView(WAITING);
  view.posAtDOM = () => 0;
  const measures = [];
  view.requestMeasure = (spec) => {
    measures.push(spec);
    const collected = spec.read(view);
    spec.write(collected, view);
  };
  view.dom.querySelectorAll = (sel) => {
    if (String(sel).includes("task-list-item-checkbox")) return [input];
    return [];
  };
  plugin.createBlockMarkExtension();
  const instance = new capturedMarkClass(view);
  assert.equal(measures.length, 1);
  assert.match(attrs.get("aria-label") || "", /^Blocked · until /);
  assert.equal(attrs.get("data-tooltip-position"), "top");

  view.state = stateFor("- [*] #task Water plants", { path: "Projects/Example.md" });
  instance.update({ docChanged: true, view });
  assert.ok(measures.length >= 2, "rebuild schedules another measure");
  assert.equal(attrs.has("aria-label"), false);
  instance.destroy();
});

test("unscanned collect does not restore mouseover tooltip bindings", () => {
  const { plugin } = makePlugin();
  plugin.blockMarksTimers = { set: () => 1, clear: () => {} };
  const attrs = new Map([["aria-label", "Existing name"], ["data-tooltip-position", "left"]]);
  const input = tooltipInput(attrs);
  const view = makeView(WAITING);
  view.posAtDOM = () => 0;
  plugin.createBlockMarkExtension();
  const instance = new capturedMarkClass(view);
  instance.onMouseOver({ target: input });
  assert.match(attrs.get("aria-label"), /^Blocked · until /);
  plugin.applyBlockMarkTooltipTargets(view, { targets: [], scanned: false });
  assert.match(attrs.get("aria-label"), /^Blocked · until /);
  plugin.applyBlockMarkTooltipTargets(view, { targets: [], scanned: true });
  assert.equal(attrs.get("aria-label"), "Existing name");
  assert.equal(attrs.get("data-tooltip-position"), "left");
  instance.destroy();
});

test("prj rows fold the project tag; dep-over-prj keeps it; selection reveals", () => {
  const { plugin } = makePlugin();
  const prj = "- [?] #task E #prj_is_blocked";
  const source = LedgerToolsPlugin.helpers.blockMarkProjectTagSource(prj);
  assert.ok(source);
  const view = makeView(prj);
  const folds = replaceMarks(plugin.buildBlockMarkFoldDecorations(view));
  assert.equal(folds.length, 1);
  assert.equal(folds[0].from, source.tagStart - (source.foldSpace ? 1 : 0));
  assert.equal(folds[0].to, source.tagEnd);
  assert.equal(folds[0].value.widget.foldSpace, true);

  const rebuilt = replaceMarks(plugin.buildBlockMarkFoldDecorations(view));
  assert.equal(folds[0].value.widget.eq(rebuilt[0].value.widget), true);

  const kept = "- [?] #task P #prj_is_blocked [dependsOn:: dep]";
  assert.equal(
    replaceMarks(plugin.buildBlockMarkFoldDecorations(makeView(kept))).length,
    0,
  );

  const revealed = replaceMarks(
    plugin.buildBlockMarkFoldDecorations(
      makeView(prj, {
        selection: [{ from: source.tagStart, to: source.tagStart }],
      }),
    ),
  );
  assert.equal(revealed.length, 0);

  plugin.blockMarksEnabled = false;
  assert.equal(plugin.buildBlockMarkFoldDecorations(makeView(prj)), StubDecoration.none);
  plugin.blockMarksEnabled = true;

  assert.equal(plugin.blockMarkFoldShouldRebuild({ selectionSet: true }), true);
  assert.equal(plugin.blockMarkShouldRebuild({ selectionSet: true }), false);
});
