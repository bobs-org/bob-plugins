// Tests for bob-ledger-tools task theme marks (bob-cli-dm.5.1 task-theme-editor).
// Covers the canonical explicit-field source, the pill / unknown / repair
// model, lazy tooltip copy and reason phrases, the listener-free element,
// Live Preview folded decorations, selection folding, click reveal, source
// and code exclusion, closed-task history, the session toggle, popout gate
// mirroring, unload cleanup, and the styles.css contract. The PT13 contract
// in bob-cli `docs/pomodoro-themes.md` is authoritative.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");

const editorInfoField = { _taskThemeField: "info" };
const editorLivePreviewField = { _taskThemeField: "live" };

let capturedMarkClass = null;

class StubWidgetType {}

class StubRangeSetBuilder {
  constructor() {
    this.adds = [];
  }

  add(from, to, value) {
    this.adds.push({ from, to, value });
  }

  finish() {
    return { _decorations: true, adds: this.adds.slice() };
  }
}

const StubDecoration = {
  none: { _decorationNone: true },
  replace: (spec) => ({ _decorationReplace: true, ...spec }),
};

const StubStateEffect = {
  define() {
    const type = {};
    type.of = (value) => {
      const effect = { value, _effectType: type };
      effect.is = (other) => other === type;
      return effect;
    };
    return type;
  },
};

const StubViewPlugin = {
  fromClass(cls, options) {
    capturedMarkClass = cls;
    return { _viewPlugin: true, cls, options };
  },
};

function stubSyntaxTree(state) {
  const tag = state && state._treeTag;
  if (tag === "codeblock") {
    return {
      resolveInner: () => ({ name: "HyperMD-codeblock", parent: null }),
    };
  }
  if (tag === "inline") {
    return {
      resolveInner: () => ({
        name: "inline-code",
        parent: { name: "Document", parent: null },
      }),
    };
  }
  return { resolveInner: () => null };
}

class TestMarkdownView {}

class TestPlugin {
  constructor(app) {
    this.app = app;
  }

  addCommand(command) {
    this.commands = this.commands || [];
    this.commands.push(command);
  }

  registerEditorExtension(extension) {
    this.editorExtensions = this.editorExtensions || [];
    this.editorExtensions.push(extension);
  }

  registerMarkdownPostProcessor(handler, sortOrder) {
    this.postProcessors = this.postProcessors || [];
    this.postProcessors.push({ handler, sortOrder });
  }

  registerEvent(ref) {
    this.registeredEvents = this.registeredEvents || [];
    this.registeredEvents.push(ref);
  }

  registerMarkdownCodeBlockProcessor(language, handler) {
    this.codeBlocks = this.codeBlocks || {};
    this.codeBlocks[language] = handler;
  }

  registerInterval(handle) {
    this.intervals = this.intervals || [];
    this.intervals.push(handle);
    return handle;
  }
}

class TestNotice {
  constructor(message) {
    TestNotice.messages.push(String(message));
  }
}
TestNotice.messages = [];

function installStubs() {
  const originalLoad = Module._load;
  Module._load = function loadWithTaskThemeStubs(request) {
    if (request === "obsidian") {
      return {
        MarkdownView: TestMarkdownView,
        Notice: TestNotice,
        Platform: { isDesktopApp: true },
        Plugin: TestPlugin,
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
        EditorView: { updateListener: { of: (listener) => ({ listener }) } },
        keymap: { of: (value) => value },
        ViewPlugin: StubViewPlugin,
        Decoration: StubDecoration,
        WidgetType: StubWidgetType,
      };
    }
    if (request === "@codemirror/language") {
      return { syntaxTree: stubSyntaxTree };
    }
    return originalLoad.call(this, request, ...Array.prototype.slice.call(arguments, 1));
  };
  return originalLoad;
}

const MAIN_PATH = require.resolve("../plugins/bob-ledger-tools/main.js");

function loadPluginModule() {
  const originalLoad = installStubs();
  try {
    delete require.cache[MAIN_PATH];
    return require(MAIN_PATH);
  } finally {
    Module._load = originalLoad;
  }
}

const LedgerToolsPlugin = loadPluginModule();
const { helpers } = LedgerToolsPlugin;

const {
  taskThemeMarkSource,
  taskThemeMarkSourceInText,
  taskThemeMarkSourcesInText,
  taskThemeMarkModel,
  taskThemeMarkRawValue,
  taskThemeReasonFor,
  taskThemeTooltipText,
  buildTaskThemeMarkElement,
  ensureTaskThemeMarksRefresh,
  taskThemeFallbackFold,
  pomodoroThemeInlineFields,
  pomodoroThemeCanonicalDailyPath,
} = helpers;

const HINT = "Ctrl+Shift+P t to change";

function fakeElementDoc() {
  function el(tag) {
    return {
      tagName: tag,
      attrs: {},
      children: [],
      handlers: {},
      textContent: "",
      setAttribute(name, value) {
        this.attrs[name] = String(value);
      },
      getAttribute(name) {
        return Object.prototype.hasOwnProperty.call(this.attrs, name)
          ? this.attrs[name]
          : null;
      },
      appendChild(child) {
        this.children.push(child);
        if (child && typeof child.text === "string") {
          this.textContent += child.text;
        }
        return child;
      },
      addEventListener(name, handler) {
        this.handlers[name] = handler;
      },
      closest(selector) {
        if (selector === ".bob-pomo-theme[data-task-theme-kind]") {
          return this;
        }
        return null;
      },
    };
  }
  return {
    createElement: (tag) => el(tag),
    createElementNS: (ns, tag) => el(tag),
    createTextNode: (value) => ({ text: String(value) }),
  };
}

function makeDoc(lines) {
  let offset = 0;
  const lineObjs = lines.map((text, index) => {
    const from = offset;
    const to = from + text.length;
    offset = to + 1;
    return { from, to, text, number: index + 1 };
  });
  return {
    length: Math.max(0, offset - 1),
    lineAt(pos) {
      for (const line of lineObjs) {
        if (pos >= line.from && pos <= line.to) {
          return line;
        }
      }
      return lineObjs[lineObjs.length - 1];
    },
    toString() {
      return lines.join("\n");
    },
  };
}

function makeView({
  lines,
  selection = [],
  live = true,
  path = "a.md",
  treeTag = null,
} = {}) {
  const doc = makeDoc(lines);
  return {
    visibleRanges: [{ from: 0, to: doc.length }],
    dom: {
      handlers: {},
      addEventListener(name, handler) {
        this.handlers[name] = handler;
      },
      removeEventListener(name, handler) {
        if (this.handlers[name] === handler) {
          delete this.handlers[name];
        }
      },
    },
    state: {
      doc,
      _treeTag: treeTag,
      selection: { ranges: selection },
      field: (field) => {
        if (field === editorLivePreviewField) {
          return live;
        }
        if (field === editorInfoField) {
          return path ? { file: { path } } : null;
        }
        return null;
      },
    },
    posAtDOM: () => 42,
    dispatched: [],
    dispatch(tr) {
      this.dispatched.push(tr);
    },
    focused: false,
    focus() {
      this.focused = true;
    },
  };
}

function makeSurfaceApp({ triggers = [] } = {}) {
  const workspaceHandlers = {};
  const metadataHandlers = {};
  return {
    vault: {
      getAbstractFileByPath: () => null,
      cachedRead: () => Promise.resolve(null),
    },
    workspace: {
      on: (event, handler) => {
        workspaceHandlers[event] = workspaceHandlers[event] || [];
        workspaceHandlers[event].push(handler);
        return { event, handler };
      },
      offref: () => {},
      onLayoutReady: () => {},
      getActiveFile: () => null,
      getLeavesOfType: () => [],
      trigger: (event, ...args) => {
        triggers.push(event);
        for (const handler of workspaceHandlers[event] || []) {
          handler(...args);
        }
      },
    },
    metadataCache: {
      on: (event, handler) => {
        metadataHandlers[event] = metadataHandlers[event] || [];
        metadataHandlers[event].push(handler);
        return { event, handler };
      },
      trigger: (event, ...args) => {
        for (const handler of metadataHandlers[event] || []) {
          handler(...args);
        }
      },
      getCache: () => ({}),
      getFirstLinkpathDest: () => null,
    },
    commands: {},
    plugins: { plugins: {} },
  };
}

function pluginWithThemeStubs({ known = () => true, hue = null } = {}) {
  const plugin = new LedgerToolsPlugin(makeSurfaceApp(), {});
  plugin.taskThemeMarksEnabled = true;
  plugin.pomodoroThemeColorsEnabled = true;
  plugin.pomodoroThemeIsKnown = (key) => {
    try {
      return known(key);
    } catch (error) {
      return true;
    }
  };
  plugin.pomodoroThemeHueFor = (key, name) => {
    if (typeof hue === "function") {
      return hue(key, name);
    }
    if (hue) {
      return hue;
    }
    return { hue: "blue", hue_source: "hash" };
  };
  return plugin;
}

test("bracket and paren fields parse with UTF-16 offsets", () => {
  const bracket = "- [ ] Do thing [theme:: WRITE]";
  const source = taskThemeMarkSource(bracket);
  assert.ok(source);
  assert.equal(source.state, "set");
  assert.equal(source.value, "WRITE");
  assert.equal(source.key, "write");
  assert.equal(bracket.slice(source.fieldStart, source.fieldEnd), "[theme:: WRITE]");
  assert.equal(source.foldSpace, true);

  const paren = "- [ ] Do thing (theme:: BUILD)";
  const s2 = taskThemeMarkSource(paren);
  assert.ok(s2);
  assert.equal(s2.value, "BUILD");
  assert.equal(paren.slice(s2.fieldStart, s2.fieldEnd), "(theme:: BUILD)");

  const noSpace = "- [ ] Do x[theme:: WRITE]";
  const s3 = taskThemeMarkSource(noSpace);
  assert.ok(s3);
  assert.equal(s3.foldSpace, false);

  const inText = taskThemeMarkSourceInText("prefix [theme:: WRITE] suffix");
  assert.ok(inText);
  assert.equal(inText.value, "WRITE");
  assert.equal(inText.foldSpace, undefined);

  const keyAsValue = "- [ ] Repeat [theme:: theme]";
  const fields = pomodoroThemeInlineFields(keyAsValue);
  assert.equal(fields.length, 1);
  assert.equal(keyAsValue.slice(fields[0].valueStart, fields[0].valueEnd), "theme");
  assert.equal(fields[0].value, "theme");

  const spaced = "- [ ] Do thing [theme :: FIX]";
  const spacedSource = taskThemeMarkSource(spaced);
  assert.ok(spacedSource);
  assert.equal(spacedSource.value, "FIX");
  assert.equal(
    spaced.slice(spacedSource.fieldStart, spacedSource.fieldEnd),
    "[theme :: FIX]",
  );

  const tabbed = "- [ ] Do thing (theme\t:: FIX)";
  const tabbedSource = taskThemeMarkSource(tabbed);
  assert.ok(tabbedSource);
  assert.equal(tabbedSource.value, "FIX");
  assert.equal(
    tabbed.slice(tabbedSource.fieldStart, tabbedSource.fieldEnd),
    "(theme\t:: FIX)",
  );
});

test("duplicates and invalids are repair, never a pill", () => {
  const dupe = "- [ ] A [theme:: WRITE] [theme:: BUILD]";
  const dSource = taskThemeMarkSource(dupe);
  assert.ok(dSource);
  assert.equal(dSource.state, "repair");
  assert.equal(dSource.repair, "duplicate");

  const invalid = "- [ ] A [theme:: ???]";
  const iSource = taskThemeMarkSource(invalid);
  assert.ok(iSource);
  assert.equal(iSource.state, "repair");
  assert.equal(iSource.repair, "invalid");

  const dupeModel = taskThemeMarkModel(
    { state: "repair", repair: "duplicate", fields: [{ value: "WRITE" }] },
    {},
  );
  assert.equal(dupeModel.kind, "repair");
  assert.equal(dupeModel.repair, "duplicate");

  const invalidModel = taskThemeMarkModel(
    { state: "repair", repair: "invalid", fields: [{ value: "???" }] },
    {},
  );
  assert.equal(invalidModel.kind, "repair");
  assert.ok(invalidModel.label);

  assert.equal(taskThemeMarkModel({ state: "none" }, {}), null);
  assert.equal(taskThemeMarkModel(null, {}), null);
  assert.equal(taskThemeMarkRawValue({ fields: [{ value: "  WRITE  " }] }), "WRITE");
  assert.equal(taskThemeMarkRawValue({ fields: [] }), "theme");
});

test("no inherited ghost pill and closed history", () => {
  // A task line without an explicit field gets no mark even though a
  // note/reading/review default may exist.
  assert.equal(taskThemeMarkSource("- [ ] Plain task without field"), null);
  assert.equal(taskThemeMarkSourceInText("plain prose [theme::"), null);
  assert.equal(taskThemeMarkSource("plain prose [theme:: WRITE]"), null);
  // Closed tasks keep their historical pill.
  const closed = "- [x] Done [theme:: WRITE]";
  const source = taskThemeMarkSource(closed);
  assert.ok(source);
  assert.equal(source.state, "set");
  assert.equal(source.value, "WRITE");
  const cancelled = "- [-] Cancelled (theme:: BUILD)";
  assert.equal(taskThemeMarkSource(cancelled).value, "BUILD");
});

test("unknown and known hues", () => {
  const field = { state: "set", value: "WRITE", key: "write" };
  const known = taskThemeMarkModel(field, {
    known: true,
    hue: "aqua",
    hueSource: "area",
  });
  assert.equal(known.kind, "pill");
  assert.equal(known.hue, "aqua");
  assert.equal(known.hueSource, "area");

  const unknown = taskThemeMarkModel(field, { known: false });
  assert.equal(unknown.kind, "unknown");
  assert.equal(unknown.hue, null);

  const doc = fakeElementDoc();
  const pillEl = buildTaskThemeMarkElement(doc, known, {});
  assert.equal(pillEl.attrs.class, "bob-pomo-theme");
  assert.equal(pillEl.attrs["data-theme-key"], "write");
  assert.equal(pillEl.attrs["data-theme-hue"], "aqua");
  assert.equal(pillEl.attrs["data-task-theme-kind"], "pill");
  assert.ok(pillEl.children.length >= 1);

  const unknownEl = buildTaskThemeMarkElement(doc, unknown, {});
  assert.ok(unknownEl.attrs.class.indexOf("bob-pomo-theme-unknown") !== -1);
  assert.equal(unknownEl.attrs["data-theme-hue"], undefined);

  const repair = taskThemeMarkModel(
    { state: "repair", repair: "invalid", fields: [{ value: "???" }] },
    {},
  );
  const repairEl = buildTaskThemeMarkElement(doc, repair, {});
  assert.ok(repairEl.attrs.class.indexOf("bob-pomo-theme-repair") !== -1);
  assert.equal(repairEl.attrs["data-theme-repair"], "invalid");

  const exempt = taskThemeMarkModel(field, {
    known: true,
    hue: "gray",
    hueSource: "exempt",
  });
  const exemptEl = buildTaskThemeMarkElement(doc, exempt, {});
  assert.ok(exemptEl.attrs.class.indexOf("bob-pomo-theme-muted") !== -1);

  const unconfigured = taskThemeMarkModel(field, {
    known: true,
    hue: "gray",
    hueSource: "unconfigured",
  });
  const unconfiguredEl = buildTaskThemeMarkElement(doc, unconfigured, {});
  assert.ok(unconfiguredEl.attrs.class.indexOf("bob-pomo-theme-muted") !== -1);
  assert.ok(
    unconfiguredEl.attrs.class.indexOf("bob-pomo-theme-unconfigured") !== -1,
  );

  assert.equal(buildTaskThemeMarkElement(null, known, {}), null);
  assert.equal(buildTaskThemeMarkElement(doc, null, {}), null);
  assert.equal(
    buildTaskThemeMarkElement(doc, { kind: "nope", label: "x" }, {}),
    null,
  );
});

test("tooltip copy, reason phrases, and no double-colons", () => {
  assert.equal(
    taskThemeTooltipText("WRITE", "pill", "sase_blog suggests WRITE"),
    "Task theme WRITE \u00b7 sase_blog suggests WRITE \u00b7 " + HINT,
  );
  assert.equal(
    taskThemeTooltipText("READ", "pill", null),
    "Task theme READ \u00b7 no default here \u00b7 " + HINT,
  );
  assert.equal(
    taskThemeTooltipText("READ", "pill", undefined),
    "Task theme READ \u00b7 " + HINT,
  );
  assert.ok(
    taskThemeTooltipText("WRITE", "unknown", null).indexOf("Unknown theme") !== -1,
  );
  assert.ok(
    taskThemeTooltipText("x", "repair", null).indexOf("Needs repair") !== -1,
  );
  for (const copy of [
    taskThemeTooltipText("WRITE", "pill", "sase_blog suggests WRITE"),
    taskThemeTooltipText("WRITE", "unknown", null),
    taskThemeTooltipText("x", "repair", null),
  ]) {
    assert.equal(copy.indexOf("::"), -1);
  }

  assert.equal(
    taskThemeReasonFor({
      source: "note",
      theme: { name: "WRITE" },
      from: { stem: "sase_blog" },
    }),
    "sase_blog suggests WRITE",
  );
  assert.equal(
    taskThemeReasonFor({ source: "reading", theme: { name: "READ" } }),
    "reading tasks suggest READ",
  );
  assert.equal(
    taskThemeReasonFor({
      source: "note",
      theme: { name: "PLAN" },
      from: { stem: "gtd_daily" },
    }),
    "gtd_daily suggests PLAN",
  );
  assert.equal(taskThemeReasonFor(null), null);
  assert.equal(taskThemeReasonFor({ source: "task", theme: { name: "X" } }), null);
  assert.equal(
    taskThemeReasonFor({
      source: "task",
      theme: { name: "X" },
      inherited: { source: "note", theme: { name: "W" }, from: { stem: "s" } },
    }),
    "s suggests W",
  );
});

test("Live Preview folds, reveals, and refuses code", () => {
  const plugin = pluginWithThemeStubs();
  const line = "- [ ] Do thing [theme:: WRITE]";
  const source = taskThemeMarkSource(line);
  const folded = plugin.buildTaskThemeMarkDecorations(makeView({ lines: [line] }));
  assert.equal(folded.adds.length, 1);
  assert.equal(folded.adds[0].from, source.fieldStart - 1);
  assert.equal(folded.adds[0].to, source.fieldEnd);
  const widget = folded.adds[0].value.widget;
  assert.ok(widget instanceof StubWidgetType);
  const rebuilt = plugin.buildTaskThemeMarkDecorations(makeView({ lines: [line] }));
  assert.equal(widget.eq(rebuilt.adds[0].value.widget), true);

  plugin.taskThemeMarksGeneration = 1;
  const genOne = plugin.buildTaskThemeMarkDecorations(makeView({ lines: [line] }));
  plugin.taskThemeMarksGeneration = 2;
  const genTwo = plugin.buildTaskThemeMarkDecorations(makeView({ lines: [line] }));
  assert.equal(
    genOne.adds[0].value.widget.eq(genTwo.adds[0].value.widget),
    false,
  );

  const spacedLine = "- [ ] Do thing [theme :: FIX]";
  const spacedFolded = plugin.buildTaskThemeMarkDecorations(
    makeView({ lines: [spacedLine] }),
  );
  assert.equal(spacedFolded.adds.length, 1);

  const tabLine = "- [ ] Do thing (theme\t:: FIX)";
  const tabFolded = plugin.buildTaskThemeMarkDecorations(
    makeView({ lines: [tabLine] }),
  );
  assert.equal(tabFolded.adds.length, 1);

  const dupeLine = "- [ ] A [theme:: WRITE] [theme:: BUILD]";
  const dupeFolded = plugin.buildTaskThemeMarkDecorations(
    makeView({ lines: [dupeLine] }),
  );
  assert.equal(dupeFolded.adds.length, 2);
  assert.equal(dupeFolded.adds[0].value.widget.model.kind, "repair");
  assert.equal(dupeFolded.adds[1].value.widget.model.kind, "repair");
  assert.equal(taskThemeMarkSourcesInText(dupeLine).length, 2);

  // Touching the field reveals source.
  const revealed = plugin.buildTaskThemeMarkDecorations(
    makeView({ lines: [line], selection: [{ from: source.fieldStart, to: source.fieldStart }] }),
  );
  assert.equal(revealed.adds.length, 0);

  // An endpoint strictly inside the folded run keeps that endpoint
  // unfolded (two spaces so the probe sits strictly inside the run).
  const doubleLine = "- [ ] Do thing  [theme:: WRITE]";
  const doubleSource = taskThemeMarkSource(doubleLine);
  const foldedWhitespace = plugin.buildTaskThemeMarkDecorations(
    makeView({
      lines: [doubleLine],
      selection: [{ from: doubleSource.fieldStart - 1, to: doubleSource.fieldStart - 1 }],
    }),
  );
  assert.equal(foldedWhitespace.adds.length, 1);
  assert.equal(foldedWhitespace.adds[0].from, doubleSource.fieldStart);

  // Multiselection with one touching range still reveals.
  const multi = plugin.buildTaskThemeMarkDecorations(
    makeView({
      lines: [line],
      selection: [
        { from: 0, to: 0 },
        { from: source.fieldStart, to: source.fieldEnd },
      ],
    }),
  );
  assert.equal(multi.adds.length, 0);

  // Source mode stays raw.
  assert.equal(
    plugin.buildTaskThemeMarkDecorations(makeView({ lines: [line], live: false })),
    StubDecoration.none,
  );
  // Fenced code and inline code stay raw.
  assert.equal(
    plugin.buildTaskThemeMarkDecorations(
      makeView({ lines: [line], treeTag: "codeblock" }),
    ).adds.length,
    0,
  );
  assert.equal(
    plugin.buildTaskThemeMarkDecorations(
      makeView({ lines: [line], treeTag: "inline" }),
    ).adds.length,
    0,
  );
  // Prose and non-task lines stay raw.
  assert.equal(
    plugin.buildTaskThemeMarkDecorations(makeView({ lines: ["plain [theme:: WRITE]"] })).adds
      .length,
    0,
  );
  // Repair still decorates with the repair kind.
  const repairLine = "- [ ] A [theme:: ???]";
  const repairBuilt = plugin.buildTaskThemeMarkDecorations(
    makeView({ lines: [repairLine] }),
  );
  assert.equal(repairBuilt.adds.length, 1);
  assert.equal(repairBuilt.adds[0].value.widget.model.kind, "repair");
});

test("fallback fold mirrors the selection rule", () => {
  assert.equal(taskThemeFallbackFold(10, 20, 1, []), 1);
  assert.equal(taskThemeFallbackFold(10, 20, 1, [{ from: 12, to: 12 }]), null);
  assert.equal(taskThemeFallbackFold(10, 20, 2, [{ from: 9, to: 9 }]), 0);
  assert.equal(taskThemeFallbackFold("x", "y", 1, []), 0);
});

test("widget click reveals the field at the folded offset", () => {
  const plugin = pluginWithThemeStubs();
  const line = "- [ ] Do thing [theme:: WRITE]";
  const view = makeView({ lines: [line] });
  const widget = plugin.buildTaskThemeMarkDecorations(view).adds[0].value.widget;
  const savedDocument = global.document;
  const handlers = {};
  global.document = {
    createElement: () => ({
      _attrs: {},
      attrs: {},
      children: [],
      setAttribute(name, value) {
        this.attrs[name] = value;
      },
      appendChild(child) {
        this.children.push(child);
        return child;
      },
      addEventListener(name, handler) {
        handlers[name] = handler;
      },
    }),
    createTextNode: (value) => ({ text: String(value) }),
  };
  try {
    const dom = widget.toDOM(view);
    assert.ok(dom);
    let prevented = false;
    handlers.mousedown({ preventDefault: () => (prevented = true) });
    assert.equal(prevented, true);
    assert.equal(view.dispatched.length, 1);
    // The decoration starts at the first folded space, so the caret lands
    // one folded space after the widget anchor.
    assert.equal(view.dispatched[0].selection.anchor, 42 + widget.foldLength);
    assert.equal(view.focused, true);
    assert.ok(widget.foldLength >= 1);
  } finally {
    if (savedDocument === undefined) {
      delete global.document;
    } else {
      global.document = savedDocument;
    }
  }
});

test("session toggle, gates, and onload wiring", () => {
  capturedMarkClass = null;
  const savedDocument = global.document;
  const mainClasses = new Set();
  const mainDoc = {
    body: {
      classList: {
        add: (name) => mainClasses.add(name),
        remove: (name) => mainClasses.delete(name),
      },
    },
  };
  global.document = mainDoc;
  TestNotice.messages = [];
  try {
    const triggers = [];
    const app = makeSurfaceApp({ triggers });
    const plugin = new LedgerToolsPlugin(app, {});
    plugin.setupTaskThemeMarks();
    plugin.setupPomodoroThemeChips();
    try {
      assert.equal(plugin.taskThemeMarksEnabled, true);
      assert.equal(plugin.pomodoroThemeColorsEnabled, true);
      assert.ok(mainClasses.has("bob-task-theme-marks"));
      assert.ok(mainClasses.has("bob-pomo-theme-colors"));
      const ids = (plugin.commands || []).map((command) => command.id);
      assert.ok(ids.indexOf("toggle-task-theme-marks") !== -1);
      assert.ok(ids.indexOf("toggle-pomodoro-theme-colors") !== -1);
      assert.ok((plugin.editorExtensions || []).length >= 1);
      assert.ok(capturedMarkClass);

      // Independent toggles: colors off keeps pills readable.
      assert.equal(plugin.toggleTaskThemeMarks(), false);
      assert.equal(mainClasses.has("bob-task-theme-marks"), false);
      assert.equal(mainClasses.has("bob-pomo-theme-colors"), true);
      assert.equal(plugin.togglePomodoroThemeColors(), false);
      assert.equal(mainClasses.has("bob-pomo-theme-colors"), false);
      assert.equal(plugin.toggleTaskThemeMarks(), true);
      assert.equal(plugin.togglePomodoroThemeColors(), true);
      assert.ok(
        TestNotice.messages.indexOf("Task theme off") !== -1 ||
          TestNotice.messages.indexOf("Task theme marks off") !== -1,
      );
      // While off, the builder stays silent.
      plugin.taskThemeMarksEnabled = false;
      assert.equal(
        plugin.buildTaskThemeMarkDecorations(
          makeView({ lines: ["- [ ] A [theme:: WRITE]"] }),
        ),
        StubDecoration.none,
      );
      plugin.taskThemeMarksEnabled = true;
    } finally {
      plugin.teardownTaskThemeMarksAndColors();
    }
    assert.equal(mainClasses.has("bob-task-theme-marks"), false);
    assert.equal(mainClasses.has("bob-pomo-theme-colors"), false);
    void triggers;
  } finally {
    if (savedDocument === undefined) {
      delete global.document;
    } else {
      global.document = savedDocument;
    }
  }
});

test("mark gates hold in popout windows for both toggles", () => {
  const savedDocument = global.document;
  const makeGateDocument = () => {
    const classes = new Set();
    return {
      body: {
        classList: {
          add: (name) => classes.add(name),
          remove: (name) => classes.delete(name),
        },
      },
      _classes: classes,
    };
  };
  const popoutLeaf = (doc) => ({
    view: { file: { path: "other.md" } },
    containerEl: { ownerDocument: doc },
  });
  const mainDoc = makeGateDocument();
  const earlyPopoutDoc = makeGateDocument();
  const leaves = [popoutLeaf(earlyPopoutDoc)];
  const windowOpenHandlers = [];
  const app = makeSurfaceApp();
  app.workspace.getLeavesOfType = () => leaves;
  app.workspace.on = (event, handler) => {
    if (event === "window-open") {
      windowOpenHandlers.push(handler);
    }
    return {};
  };
  global.document = mainDoc;
  try {
    const plugin = new LedgerToolsPlugin(app, {});
    plugin.setupTaskThemeMarks();
    plugin.setupPomodoroThemeChips();
    const has = (doc, name) => doc._classes.has(name);
    assert.equal(has(mainDoc, "bob-task-theme-marks"), true);
    assert.equal(has(earlyPopoutDoc, "bob-task-theme-marks"), true);
    assert.equal(has(mainDoc, "bob-pomo-theme-colors"), true);
    assert.equal(has(earlyPopoutDoc, "bob-pomo-theme-colors"), true);
    assert.ok(windowOpenHandlers.length >= 2, "both gates mirror window-open");
    const latePopoutDoc = makeGateDocument();
    for (const handler of windowOpenHandlers) {
      handler({ doc: latePopoutDoc }, undefined);
    }
    assert.equal(has(latePopoutDoc, "bob-task-theme-marks"), true);
    assert.equal(has(latePopoutDoc, "bob-pomo-theme-colors"), true);
    assert.equal(plugin.toggleTaskThemeMarks(), false);
    assert.equal(has(mainDoc, "bob-task-theme-marks"), false);
    assert.equal(has(earlyPopoutDoc, "bob-task-theme-marks"), false);
    assert.equal(has(latePopoutDoc, "bob-task-theme-marks"), false);
    // Colors stay on while task marks go off: independence.
    assert.equal(has(mainDoc, "bob-pomo-theme-colors"), true);
    assert.equal(plugin.togglePomodoroThemeColors(), false);
    assert.equal(has(mainDoc, "bob-pomo-theme-colors"), false);
    const offPopoutDoc = makeGateDocument();
    for (const handler of windowOpenHandlers) {
      handler(undefined, { document: offPopoutDoc });
    }
    assert.equal(has(offPopoutDoc, "bob-task-theme-marks"), false);
    assert.equal(has(offPopoutDoc, "bob-pomo-theme-colors"), false);
    leaves.push(popoutLeaf(offPopoutDoc));
    assert.equal(plugin.toggleTaskThemeMarks(), true);
    assert.equal(plugin.togglePomodoroThemeColors(), true);
    assert.equal(has(offPopoutDoc, "bob-task-theme-marks"), true);
    assert.equal(has(offPopoutDoc, "bob-pomo-theme-colors"), true);
  } finally {
    if (savedDocument === undefined) {
      delete global.document;
    } else {
      global.document = savedDocument;
    }
  }
});

test("lazy hover enriches only the hovered pill", () => {
  const plugin = pluginWithThemeStubs();
  const doc = fakeElementDoc();
  const model = taskThemeMarkModel(
    { state: "set", value: "WRITE", key: "write" },
    { known: true, hue: "blue", hueSource: "hash" },
  );
  const mark = buildTaskThemeMarkElement(doc, model, {});
  mark.closest = () => mark;
  plugin.pomodoroThemeSuggestFor = () => ({
    source: "task",
    theme: { key: "write", name: "WRITE" },
    inherited: {
      source: "note",
      theme: { key: "build", name: "BUILD" },
      from: { stem: "sase_blog" },
    },
  });
  const view = makeView({ lines: ["- [ ] A [theme:: WRITE]"] });
  view.posAtDOM = () => 5;
  assert.equal(plugin.taskThemeEnrichMarkElement(view, mark), true);
  assert.ok(mark.attrs["aria-label"].indexOf("sase_blog suggests BUILD") !== -1);
  assert.equal(mark.attrs["aria-label"].indexOf("::"), -1);
  assert.equal(mark.attrs["data-task-theme-enriched"], "true");
  // Second enrichment is a no-op that keeps the first copy.
  const first = mark.attrs["aria-label"];
  assert.equal(plugin.taskThemeEnrichMarkElement(view, mark), true);
  assert.equal(mark.attrs["aria-label"], first);
});

test("styles.css contract for task theme pills", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "..", "plugins", "bob-ledger-tools", "styles.css"),
    "utf8",
  );
  assert.ok(css.indexOf('.bob-pomo-theme-colors .bob-pomo-theme[data-theme-hue="blue"]') !== -1);
  assert.ok(css.indexOf('.bob-pomo-theme[data-task-theme-kind="unknown"]') !== -1);
  assert.ok(css.indexOf('.bob-pomo-theme[data-task-theme-kind="repair"]') !== -1);
  assert.ok(css.indexOf("body:not(.bob-task-theme-marks) .bob-pomo-theme[data-task-theme-kind]") !== -1);
  assert.ok(css.indexOf("body.bob-task-theme-marks .bob-task-theme-native") !== -1);
  assert.ok(css.indexOf('[data-dv-norm-key="theme"]') !== -1);
  assert.ok(css.indexOf("body.bob-task-theme-marks .markdown-source-view.is-live-preview") !== -1);
});

test("helpers never throw on bad input", () => {
  assert.equal(taskThemeMarkSource(null), null);
  assert.equal(taskThemeMarkSourceInText(null), null);
  assert.equal(taskThemeMarkModel(null, null), null);
  assert.equal(taskThemeReasonFor(null), null);
  assert.ok(typeof taskThemeTooltipText(null, null, null) === "string");
  assert.equal(buildTaskThemeMarkElement(null, null, null), null);
  assert.ok(ensureTaskThemeMarksRefresh() !== undefined);
  const plugin = pluginWithThemeStubs();
  assert.equal(plugin.taskThemeMarkShouldRebuild(null), false);
  assert.equal(plugin.taskThemeEnrichMarkElement(null, null), false);
  assert.doesNotThrow(() => plugin.buildTaskThemeMarkDecorations(null));
});

test("canonical daily paths require matching directory and filename years", () => {
  assert.equal(pomodoroThemeCanonicalDailyPath("2026/20261028.md"), true);
  assert.equal(pomodoroThemeCanonicalDailyPath("2025/20261028.md"), false);
  assert.equal(pomodoroThemeCanonicalDailyPath("2026/20260229.md"), false);
  assert.equal(pomodoroThemeCanonicalDailyPath("daily/20261028.md"), false);
});

test("repair tooltips use the raw value, never the whole field span", () => {
  const plugin = pluginWithThemeStubs();
  const invalid = "- [ ] A [theme:: ???]";
  const source = taskThemeMarkSource(invalid);
  assert.equal(source.rawValue, "???");
  const model = plugin.taskThemeResolveModel(source, invalid);
  assert.equal(model.label, "???");
  const tooltip = taskThemeTooltipText(model.label, "repair", null);
  assert.equal(tooltip.indexOf("::"), -1);
  assert.equal(tooltip.indexOf("["), -1);
  assert.ok(tooltip.indexOf("???") !== -1);

  const empty = "- [ ] A [theme:: ]";
  const emptySource = taskThemeMarkSource(empty);
  assert.equal(emptySource.rawValue, "");
  const emptyModel = plugin.taskThemeResolveModel(emptySource, empty);
  assert.equal(emptyModel.label, "theme");
  assert.equal(
    taskThemeTooltipText(emptyModel.label, "repair", null).indexOf("::"),
    -1,
  );
});

test("setup wires theme and metadata refresh; unload removes editor hover", () => {
  capturedMarkClass = null;
  const plugin = pluginWithThemeStubs();
  plugin.setupTaskThemeMarks();
  assert.equal(plugin.taskThemeRefreshEventsWired, true);
  const gen = plugin.taskThemeMarksGeneration || 0;
  plugin.themesNotifyChanged("journal");
  assert.ok((plugin.taskThemeMarksGeneration || 0) > gen);
  plugin.app.metadataCache.trigger("changed");
  assert.ok(plugin.taskThemeRefreshTimer);
  plugin.taskThemeCancelScheduledWork();
  assert.equal(plugin.taskThemeRefreshTimer, null);

  const view = makeView({ lines: ["- [ ] A [theme:: WRITE]"] });
  plugin.taskThemeEnsureHoverForView(view);
  assert.equal(view.dom.__bobTaskThemeHover, true);
  assert.equal(typeof view.dom.handlers.mouseover, "function");
  plugin.teardownTaskThemeMarksAndColors();
  assert.equal(view.dom.__bobTaskThemeHover, false);
  assert.equal(view.dom.handlers.mouseover, undefined);

  const again = pluginWithThemeStubs();
  again.setupTaskThemeMarks();
  const view2 = makeView({ lines: ["- [ ] A [theme:: WRITE]"] });
  assert.ok(capturedMarkClass);
  const instance = new capturedMarkClass(view2);
  assert.equal(view2.dom.__bobTaskThemeHover, true);
  instance.destroy();
  assert.equal(view2.dom.__bobTaskThemeHover, false);
  again.teardownTaskThemeMarksAndColors();
});
