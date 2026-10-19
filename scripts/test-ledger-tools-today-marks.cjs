// Tests for bob-ledger-tools Today marks pure core (mark_core).
// Covers the trailing-id rule, the insert offset (original-line
// UTF-16 coordinates), the line candidate, the duplicate-id guard,
// the session text and tooltip, the entrance window, the modifier
// check, the listener-free element, the Live Preview widget `eq` and
// mousedown routing, and the styles.css contract. The
// `docs/today-marks.md` display contract in bob-cli is authoritative;
// TM1–TM23 vectors below are that contract's pure halves verbatim.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");

class StubWidgetType {}

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

class TestMarkdownView {}

class TestPlugin {
  constructor(app) {
    this.app = app;
  }
}

class TestNotice {
  constructor(message) {
    TestNotice.messages.push(String(message));
  }
}
TestNotice.messages = [];

let livePreviewFields = null;

function installStubs(options = {}) {
  const livePreview = options.livePreview === true;
  const originalLoad = Module._load;
  const editorInfoField = {};
  const editorLivePreviewField = {};
  class TestRangeSetBuilder {
    constructor() {
      this.ranges = [];
    }

    add(from, to, decoration) {
      this.ranges.push({ from, to, decoration });
    }

    finish() {
      return this.ranges.slice();
    }
  }
  const decoration = livePreview
    ? {
        none: Object.freeze({ kind: "none" }),
        widget: (spec) => ({ kind: "widget", spec }),
      }
    : null;
  const viewPlugin = livePreview
    ? {
        fromClass: (pluginClass, options) => ({ pluginClass, options }),
      }
    : null;
  livePreviewFields = {
    editorInfoField,
    editorLivePreviewField,
    decoration,
    viewPlugin,
  };
  Module._load = function loadWithTodayMarkStubs(request) {
    if (request === "obsidian") {
      return {
        editorInfoField,
        editorLivePreviewField,
        MarkdownView: TestMarkdownView,
        Notice: TestNotice,
        Platform: {},
        Plugin: TestPlugin,
        normalizePath: (value) => value,
        parseYaml: (text) => JSON.parse(text),
      };
    }
    if (request === "@codemirror/state") {
      return {
        Prec: { highest: (value) => value },
        StateEffect: StubStateEffect,
        RangeSetBuilder: livePreview ? TestRangeSetBuilder : null,
      };
    }
    if (request === "@codemirror/view") {
      return {
        EditorView: {
          scrollIntoView: (position, options) => ({ position, options }),
        },
        keymap: { of: (value) => value },
        ViewPlugin: viewPlugin,
        Decoration: decoration,
        WidgetType: StubWidgetType,
      };
    }
    if (request === "@codemirror/language") {
      return {
        syntaxTree: livePreview
          ? (state) => state && state.tree
          : () => null,
      };
    }
    return originalLoad.call(this, request, ...Array.prototype.slice.call(arguments, 1));
  };
  return originalLoad;
}

const MAIN_PATH = require.resolve("../plugins/bob-ledger-tools/main.js");

function loadPluginModule(options = {}) {
  const originalLoad = installStubs(options);
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
  TODAY_MARK_OPEN_STATUSES,
  todayMarkTrailingBlockId,
  todayMarkInsertOffset,
  todayMarkLineCandidate,
  todayMarkDuplicateIds,
  todayMarkSessionText,
  todayMarkTooltip,
  todayMarkEntering,
  todayMarkModifierPressed,
  buildTodayMarkElement,
  TodayMarkWidget,
  ensureTodayMarksRefresh,
  freshnessMarkPosInCode,
} = helpers;

function fakeElementDoc() {
  function el(tag) {
    return {
      tagName: tag,
      attrs: {},
      children: [],
      handlers: {},
      textContent: "unset",
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
        return child;
      },
      addEventListener(name, handler) {
        this.handlers[name] = handler;
      },
    };
  }
  return {
    createElement: (tag) => el(tag),
    createElementNS: (ns, tag) => el(tag),
    createTextNode: (value) => ({ text: String(value) }),
  };
}

function textDocument(text) {
  const source = String(text || "");
  const rawLines = source.split("\n");
  const lines = [];
  let from = 0;
  for (let index = 0; index < rawLines.length; index += 1) {
    const lineText = rawLines[index];
    const to = from + lineText.length;
    lines.push({ number: index + 1, from, to, text: lineText });
    from = to + (index + 1 < rawLines.length ? 1 : 0);
  }
  function byNumber(number) {
    return lines[number - 1] || null;
  }
  function byPosition(position) {
    const safe = Math.max(0, Math.min(Number(position) || 0, source.length));
    return (
      lines.find((line) => safe >= line.from && safe <= line.to) ||
      lines[lines.length - 1]
    );
  }
  return {
    lines: lines.length,
    length: source.length,
    line: byNumber,
    lineAt: byPosition,
    toString: () => source,
  };
}

function codeTree(codeRanges = []) {
  return {
    resolveInner(position) {
      const range = codeRanges.find(
        (item) => position >= item.from && position < item.to,
      );
      return range ? { name: range.name || "inline-code", parent: null } : null;
    },
  };
}

function liveView(text, filePath, fields, options = {}) {
  const doc = textDocument(text);
  const state = {
    doc,
    tree: codeTree(options.codeRanges),
    field(field) {
      if (field === fields.editorInfoField) {
        return { file: { path: filePath } };
      }
      if (field === fields.editorLivePreviewField) {
        return options.live !== false;
      }
      return null;
    },
  };
  return {
    state,
    visibleRanges:
      options.visibleRanges || [{ from: 0, to: doc.length }],
    dispatch: () => {},
  };
}

function makeLiveMarkPlugin(Plugin, details = [], options = {}) {
  const instance = Object.create(Plugin.prototype);
  const key = "area.md#fix";
  instance.todayMarksEnabled = true;
  instance.todayMarksTimer = null;
  instance.todayJumpInFlight = false;
  instance.todayEnteredAt = new Map();
  instance.todayCache = {
    rank: new Map(options.keys === undefined ? [[key, 0]] : options.keys.map((value, index) => [value, index])),
    details: new Map([[key, details]]),
    dailyPath: "2026/20261019.md",
  };
  instance.isTodayCacheReady = () => options.ready !== false;
  return instance;
}

function setTodayFromLedger(plugin, helpers, content) {
  const dailyPath = "2026/20261019.md";
  const links = helpers.computeTodayLinks(content, dailyPath);
  const resolved = helpers.resolveTodayLinkKeys(
    links,
    dailyPath,
    (target) => (target === "T" ? { path: "area.md" } : null),
  );
  const keys = Array.from(new Set(resolved.map((item) => item.key)));
  plugin.todayCache.rank = new Map(
    keys.map((key, index) => [key, index]),
  );
  plugin.todayCache.details = helpers.todayLinkDetails(resolved, {
    runningEntryLine: helpers.todayRunningEntryLine(
      helpers.todayOpenEntries(content),
    ),
  });
}

function liveMarkRanges(plugin, text, fields, options = {}) {
  const view = liveView(text, options.filePath || "area.md", fields, options);
  const result = plugin.buildTodayMarkDecorations(view);
  return {
    result,
    view,
    ranges: Array.isArray(result) ? result : [],
    widgets: Array.isArray(result)
      ? result.map((range) => range.decoration.spec.widget)
      : [],
  };
}

test("open statuses are exactly space, star, slash, and question", () => {
  assert.deepEqual(TODAY_MARK_OPEN_STATUSES.slice(), [" ", "*", "/", "?"]);
  assert.ok(Object.isFrozen(TODAY_MARK_OPEN_STATUSES));
});

test("trailing-id rules: leading space, trailing-only, valid charset", () => {
  assert.equal(todayMarkTrailingBlockId("- [ ] #task Fix ^fix"), "fix");
  assert.equal(todayMarkTrailingBlockId("- [ ] #task Fix ^fix   "), "fix");
  assert.equal(todayMarkTrailingBlockId("- [ ] #task Fix ^a-b9Z"), "a-b9Z");
  assert.equal(todayMarkTrailingBlockId("- [ ] #task Fix^fix"), null);
  assert.equal(todayMarkTrailingBlockId("- [ ] #task Fix ^fix more"), null);
  assert.equal(todayMarkTrailingBlockId("- [ ] #task Fix ^fi_x"), null);
  assert.equal(todayMarkTrailingBlockId("- [ ] #task Fix ^"), null);
  assert.equal(todayMarkTrailingBlockId("- [ ] #task Fix"), null);
  assert.equal(todayMarkTrailingBlockId(""), null);
  assert.equal(todayMarkTrailingBlockId(null), null);
});

test("candidate: TM9 closed stays null, TM10 open statuses pass", () => {
  assert.equal(todayMarkLineCandidate("- [x] #task Fix ^fix"), null);
  assert.equal(todayMarkLineCandidate("- [X] #task Fix ^fix"), null);
  assert.equal(todayMarkLineCandidate("- [-] #task Fix ^fix"), null);
  for (const status of [" ", "*", "/", "?"]) {
    const candidate = todayMarkLineCandidate(
      "- [" + status + "] #task Fix ^fix",
    );
    assert.ok(candidate);
    assert.equal(candidate.blockId, "fix");
    assert.equal(candidate.status, status);
  }
  assert.equal(todayMarkLineCandidate(null), null);
  assert.equal(todayMarkLineCandidate("- [ ] Pack charger ^fix"), null);
});

test("candidate: TM11 needs an exact #task tag and a trailing id", () => {
  assert.equal(todayMarkLineCandidate("- [ ] #tasks Fix ^fix"), null);
  assert.equal(todayMarkLineCandidate("- [ ] #Task Fix ^fix"), null);
  assert.equal(todayMarkLineCandidate("- [ ] #task Fix"), null);
  assert.equal(todayMarkLineCandidate("- [ ] #task Fix ^fix more"), null);
});

test("candidate: TM21 code is left for the call-site code check", () => {
  const candidate = todayMarkLineCandidate(
    "- [ ] Note `the #task tag` here ^code",
  );
  assert.ok(candidate);
  const inlineTree = {
    resolveInner: () => ({ name: "inline-code", parent: null }),
  };
  assert.equal(
    freshnessMarkPosInCode(inlineTree, candidate.tagFrom + 1),
    true,
  );
  const plainTree = { resolveInner: () => null };
  const plain = todayMarkLineCandidate("- [ ] #task Fix ^fix");
  assert.ok(plain);
  assert.equal(freshnessMarkPosInCode(plainTree, plain.tagFrom + 1), false);
});

test("insert offset: #task first lands before the title", () => {
  assert.equal(todayMarkInsertOffset("- [ ] #task Fix ^fix"), 12);
  assert.equal(
    "- [ ] #task Fix ^fix".slice(todayMarkInsertOffset("- [ ] #task Fix ^fix")),
    "Fix ^fix",
  );
});

test("insert offset: TM16 #task #ref spans the pair, #prj sits between", () => {
  const refLine = "- [ ] #task #ref Read ^read";
  assert.equal(todayMarkInsertOffset(refLine), 17);
  assert.equal(refLine.slice(17), "Read ^read");
  const prjLine = "- [ ] #task #prj Work ^work";
  assert.equal(todayMarkInsertOffset(prjLine), 12);
  assert.equal(prjLine.slice(12), "#prj Work ^work");
  const refCandidate = todayMarkLineCandidate(refLine);
  assert.ok(refCandidate);
  assert.equal(refCandidate.insertCh, 17);
  const prjCandidate = todayMarkLineCandidate(prjLine);
  assert.ok(prjCandidate);
  assert.equal(prjCandidate.insertCh, 12);
});

test("insert offset: mid-body #task falls back to the body start", () => {
  const line = "- [ ] Fix #task stuff ^mid";
  assert.equal(todayMarkInsertOffset(line), 6);
  const candidate = todayMarkLineCandidate(line);
  assert.ok(candidate);
  assert.equal(candidate.insertCh, 6);
});

test("insert offset: blockquote, spaces, numbered, empty title, emoji", () => {
  const quoted = "> - [ ] #task Quoted ^q";
  assert.equal(todayMarkInsertOffset(quoted), 14);
  assert.equal(quoted.slice(14), "Quoted ^q");
  const spaced = "- [ ]   #task   Spaced ^sp";
  assert.equal(todayMarkInsertOffset(spaced), 16);
  assert.equal(spaced.slice(16), "Spaced ^sp");
  const numbered = "1. [ ] #task Numbered ^n";
  assert.equal(todayMarkInsertOffset(numbered), 13);
  assert.equal(numbered.slice(13), "Numbered ^n");
  const emptyTitle = "- [ ] #task ^empty";
  assert.equal(todayMarkInsertOffset(emptyTitle), 12);
  const emoji = "- [ ] #task \u{1F389} Party ^fun";
  assert.equal(todayMarkInsertOffset(emoji), 12);
  assert.equal(emoji.slice(12), "\u{1F389} Party ^fun");
});

test("duplicates: TM15 marks neither line", () => {
  const lines = [
    "- [ ] #task Fix ^fix",
    "- [*] #task Fix again ^fix",
    "- [ ] #task Other ^other",
  ];
  assert.deepEqual(todayMarkDuplicateIds(lines, ["fix", "other"]), ["fix"]);
  assert.deepEqual(todayMarkDuplicateIds(lines, ["other"]), []);
  assert.deepEqual(
    todayMarkDuplicateIds(new Set(lines), ["fix", "other"]),
    ["fix"],
  );
  assert.deepEqual(todayMarkDuplicateIds([], ["fix"]), []);
  assert.deepEqual(todayMarkDuplicateIds(null, ["fix"]), []);
});

test("session text: named, home label, range-only, unnamed", () => {
  assert.equal(
    todayMarkSessionText({ name: "GTD", range: "0725-0815" }),
    "GTD 0725\u20130815",
  );
  assert.equal(todayMarkSessionText({ name: "BLOG" }), "BLOG");
  assert.equal(
    todayMarkSessionText({ name: null, label: "bob \u00b7 dev +1", range: "0900-0930" }),
    "bob \u00b7 dev +1 0900\u20130930",
  );
  assert.equal(
    todayMarkSessionText({ name: null, label: null, range: "0940-1010" }),
    "0940\u20131010",
  );
  assert.equal(
    todayMarkSessionText({ name: null, label: null, range: null }),
    "unnamed Pomodoro",
  );
  assert.equal(todayMarkSessionText(null), "unnamed Pomodoro");
});

test("tooltip: TM1 running, TM2 queued, and the platform variants", () => {
  const running = todayMarkTooltip(
    [{ name: "GTD", range: "0725-0815", running: true }],
    { platform: "other" },
  );
  assert.equal(
    running,
    "Today \u00b7 running in GTD 0725\u20130815\nCtrl-click to open in today's note",
  );
  const queued = todayMarkTooltip(
    [{ name: "BLOG", range: null, running: false }],
    { platform: "other" },
  );
  assert.equal(
    queued,
    "Today \u00b7 queued in BLOG\nCtrl-click to open in today's note",
  );
  const mac = todayMarkTooltip(
    [{ name: "GTD", range: "0725-0815", running: true }],
    { platform: "mac" },
  );
  assert.equal(
    mac,
    "Today \u00b7 running in GTD 0725\u20130815\n\u2318-click to open in today's note",
  );
  const mobile = todayMarkTooltip(
    [{ name: "GTD", range: "0725-0815", running: true }],
    { platform: "mobile" },
  );
  assert.equal(mobile, "Today \u00b7 running in GTD 0725\u20130815");
});

test("tooltip: running wins as primary with a +N more suffix", () => {
  const details = [
    { name: "BLOG", range: null, running: false },
    { name: "GTD", range: "0725-0815", running: true },
    { name: "EXTRA", range: null, running: false },
  ];
  const tooltip = todayMarkTooltip(details, { platform: "other" });
  assert.equal(
    tooltip,
    "Today \u00b7 running in GTD 0725\u20130815 +2 more\nCtrl-click to open in today's note",
  );
  const queuedPair = todayMarkTooltip(
    [
      { name: "BLOG", range: null, running: false },
      { name: null, label: null, range: "0940-1010", running: false },
    ],
    { platform: "mobile" },
  );
  assert.equal(queuedPair, "Today \u00b7 queued in BLOG +1 more");
});

test("tooltip: empty input yields Today and output never has ::", () => {
  assert.equal(todayMarkTooltip([]), "Today");
  assert.equal(todayMarkTooltip(null), "Today");
  assert.equal(todayMarkTooltip("nope"), "Today");
  const samples = [
    todayMarkTooltip([{ name: "GTD", range: "0725-0815", running: true }]),
    todayMarkTooltip([{ name: "BLOG", running: false }], { platform: "mac" }),
    todayMarkTooltip(
      [{ name: null, label: "bob \u00b7 dev +1", range: "0900-0930", running: true }],
      { platform: "mobile" },
    ),
    todayMarkTooltip([{ name: null, label: null, range: null }]),
  ];
  for (const sample of samples) {
    assert.ok(sample.indexOf("::") === -1);
  }
});

test("entering window: 600 ms after join, never before or at load", () => {
  assert.equal(todayMarkEntering(1000, 1000), true);
  assert.equal(todayMarkEntering(1000, 1599), true);
  assert.equal(todayMarkEntering(1000, 1600), false);
  assert.equal(todayMarkEntering(1000, 999), false);
  assert.equal(todayMarkEntering(null, 1000), false);
  assert.equal(todayMarkEntering(1000, null), false);
});

test("modifier: primary button with meta on mac, ctrl elsewhere", () => {
  assert.equal(todayMarkModifierPressed({ button: 0, metaKey: true }, true), true);
  assert.equal(todayMarkModifierPressed({ button: 0, metaKey: true }, false), false);
  assert.equal(todayMarkModifierPressed({ button: 0, ctrlKey: true }, false), true);
  assert.equal(todayMarkModifierPressed({ button: 0, ctrlKey: true }, true), false);
  assert.equal(todayMarkModifierPressed({ button: 2, ctrlKey: true }, false), false);
  assert.equal(todayMarkModifierPressed({ ctrlKey: true }, false), true);
  assert.equal(todayMarkModifierPressed(null, false), false);
});

test("element: empty span with tooltip attributes and no listeners", () => {
  const doc = fakeElementDoc();
  const tooltip = "Today \u00b7 running in GTD 0725\u20130815";
  const span = buildTodayMarkElement(doc, {
    key: "notes/T.md#fix",
    tooltip,
    entering: true,
  });
  assert.ok(span);
  assert.equal(span.getAttribute("class"), "bob-today-mark is-entering");
  assert.equal(span.getAttribute("role"), "img");
  assert.equal(span.getAttribute("aria-label"), tooltip);
  assert.equal(span.getAttribute("data-tooltip-position"), "top");
  assert.equal(span.getAttribute("data-bob-today-key"), "notes/T.md#fix");
  assert.equal(span.getAttribute("title"), null);
  assert.equal(span.textContent, "");
  assert.deepEqual(span.children, []);
  assert.deepEqual(span.handlers, {});
  const calm = buildTodayMarkElement(doc, {
    key: "notes/T.md#fix",
    tooltip,
    entering: false,
  });
  assert.equal(calm.getAttribute("class"), "bob-today-mark");
  assert.equal(buildTodayMarkElement(doc, { key: "", tooltip }), null);
  assert.equal(buildTodayMarkElement(doc, { tooltip }), null);
  assert.equal(buildTodayMarkElement(null, { key: "k", tooltip }), null);
});

test("widget: eq ignores entering and the callback", () => {
  assert.ok(TodayMarkWidget);
  const jumped = [];
  const first = new TodayMarkWidget("k", "tip", false, (key) => jumped.push(key));
  assert.ok(first.eq(new TodayMarkWidget("k", "tip", true, null)));
  assert.equal(first.eq(new TodayMarkWidget("k", "other", false, null)), false);
  assert.equal(first.eq(new TodayMarkWidget("j", "tip", false, null)), false);
  assert.equal(first.eq(null), false);
  assert.equal(first.eq({ key: "k", tooltip: "tip" }), false);
});

test("widget: plain mousedown moves the cursor, Mod mousedown jumps", () => {
  const savedDocument = global.document;
  const doc = fakeElementDoc();
  global.document = doc;
  try {
    const jumped = [];
    const widget = new TodayMarkWidget("notes/T.md#fix", "tip", false, (key) =>
      jumped.push(key),
    );
    const dispatched = [];
    let focused = 0;
    const dom = widget.toDOM({
      posAtDOM: () => 42,
      dispatch: (trx) => dispatched.push(trx),
      focus: () => (focused += 1),
    });
    assert.ok(dom);
    let prevented = 0;
    dom.handlers.mousedown({ button: 0, preventDefault: () => (prevented += 1) });
    assert.equal(prevented, 1);
    assert.deepEqual(dispatched, [{ selection: { anchor: 42 } }]);
    assert.equal(focused, 1);
    assert.deepEqual(jumped, []);
    const jumper = new TodayMarkWidget("notes/T.md#fix", "tip", false, (key) =>
      jumped.push(key),
    );
    const jumpDom = jumper.toDOM({
      posAtDOM: () => 42,
      dispatch: (trx) => dispatched.push(trx),
      focus: () => (focused += 1),
    });
    jumpDom.handlers.mousedown({
      button: 0,
      ctrlKey: true,
      preventDefault: () => (prevented += 1),
    });
    assert.equal(prevented, 2);
    assert.deepEqual(jumped, ["notes/T.md#fix"]);
    assert.deepEqual(dispatched, [{ selection: { anchor: 42 } }]);
    assert.equal(focused, 1);
  } finally {
    if (savedDocument === undefined) {
      delete global.document;
    } else {
      global.document = savedDocument;
    }
  }
});

test("refresh effect is lazy and stable", () => {
  const first = ensureTodayMarksRefresh();
  assert.ok(first);
  assert.equal(ensureTodayMarksRefresh(), first);
});

test("styles.css implements the glyph anatomy contract", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "..", "plugins", "bob-ledger-tools", "styles.css"),
    "utf8",
  );
  assert.ok(css.indexOf("--bob-today-mark-glyph") !== -1);
  assert.ok(css.indexOf('content: var(--bob-today-mark-glyph, "\u{1F345}")') !== -1);
  assert.ok(css.indexOf(".bob-today-mark::before") !== -1);
  assert.ok(css.indexOf('"Apple Color Emoji", "Segoe UI Emoji"') !== -1);
  assert.ok(css.indexOf("font-variant-emoji: emoji") !== -1);
  assert.ok(
    css.indexOf(
      "color-mix(in srgb, var(--task-status-accent, var(--text-muted)) 14%, transparent)",
    ) !== -1,
  );
  assert.ok(css.indexOf("bob-today-mark-in 180ms") !== -1);
  assert.ok(
    css.indexOf("body.bob-today-marks-off .bob-today-mark") !== -1,
  );
  assert.ok(css.indexOf("@media (prefers-reduced-motion: reduce)") !== -1);
  assert.ok(css.indexOf("@media (forced-colors: active)") !== -1);
  assert.ok(css.indexOf("outline: 1px solid CanvasText") !== -1);
});

test("Live Preview applies the TM1-TM22 line, cache, and refresh vectors", () => {
  const LivePlugin = loadPluginModule({ livePreview: true });
  const fields = livePreviewFields;
  const openTask = "- [*] #task Fix ^fix";
  const markPlugin = makeLiveMarkPlugin(LivePlugin);
  const tm1Ledger =
    "## Pomodoros\n\n" +
    "- [ ] (**0725-0815** [t:: 50m]) — GTD\n" +
    "    - [[T#^fix]]\n";
  setTodayFromLedger(markPlugin, LivePlugin.helpers, tm1Ledger);

  // TM1: the unique timed running entry supplies the first tooltip line.
  const tm1 = liveMarkRanges(markPlugin, openTask, fields);
  assert.equal(tm1.ranges.length, 1);
  assert.equal(
    tm1.widgets[0].tooltip,
    "Today · running in GTD 0725–0815\nCtrl-click to open in today's note",
  );

  // TM2 and TM3: queued links mark; sticky lanes without ledger membership do not.
  setTodayFromLedger(
    markPlugin,
    LivePlugin.helpers,
    "## Pomodoros\n\n- [ ] () — BLOG\n    - [[T#^fix]]\n",
  );
  assert.equal(liveMarkRanges(markPlugin, openTask, fields).ranges.length, 1);
  setTodayFromLedger(
    markPlugin,
    LivePlugin.helpers,
    "## Pomodoros\n\n- [ ] () — BLOG\n",
  );
  assert.equal(liveMarkRanges(markPlugin, openTask, fields).ranges.length, 0);

  // TM4-TM7: closed Pomodoros do not add membership, but an open plain,
  // tomato-prefixed, or embedded Task Link all mark the source task row.
  setTodayFromLedger(
    markPlugin,
    LivePlugin.helpers,
    "## Pomodoros\n\n- [x] () — GTD\n    - 🍅 [[T#^fix]]\n",
  );
  assert.equal(
    liveMarkRanges(markPlugin, openTask, fields).ranges.length,
    0,
  );
  const liveLinks = [
    "    - [[T#^fix]]",
    "    - 🍅 [[T#^fix]]",
    "    - ![[T#^fix]]",
  ];
  for (const ledgerLink of liveLinks) {
    setTodayFromLedger(
      markPlugin,
      LivePlugin.helpers,
      "## Pomodoros\n\n- [ ] () — GTD\n" + ledgerLink + "\n",
    );
    assert.equal(liveMarkRanges(markPlugin, openTask, fields).ranges.length, 1);
  }

  // TM8-TM11: the ledger mirror excludes struck, nested, mixed-text,
  // move-only, fenced, and out-of-section links; closed Pomodoros and
  // closed task states also stay neutral.
  const fence = "\x60\x60\x60";
  const tm8Ledgers = [
    "## Pomodoros\n\n- [ ] () — GTD\n    - ~~[[T#^fix]]~~\n",
    "## Pomodoros\n\n- [ ] () — GTD\n    - Parent\n        - [[T#^fix]]\n",
    "## Pomodoros\n\n- [ ] () — GTD\n    - Link [[T#^fix]] mixed text\n",
    "## Pomodoros\n\n- [ ] () — GTD\n    - [[T#^fix]]#\n",
    "## Pomodoros\n\n- [ ] () — GTD\n    - " + fence + "\n        - [[T#^fix]]\n    - " + fence + "\n",
    "## Other\n\n- [ ] () — GTD\n    - [[T#^fix]]\n",
    "## Pomodoros\n\n- [x] () — GTD\n    - [[T#^fix]]\n",
  ];
  for (const ledger of tm8Ledgers) {
    setTodayFromLedger(markPlugin, LivePlugin.helpers, ledger);
    assert.equal(liveMarkRanges(markPlugin, openTask, fields).ranges.length, 0);
  }
  for (const status of ["x", "X", "-"]) {
    setTodayFromLedger(
      markPlugin,
      LivePlugin.helpers,
      "## Pomodoros\n\n- [ ] () — GTD\n    - [[T#^fix]]\n",
    );
    assert.equal(
      liveMarkRanges(
        markPlugin,
        "- [" + status + "] #task Fix ^fix",
        fields,
      ).ranges.length,
      0,
    );
  }
  setTodayFromLedger(
    markPlugin,
    LivePlugin.helpers,
    "## Pomodoros\n\n- [ ] () — GTD\n    - [[T#^fix]]\n",
  );
  for (const status of ["?", " "]) {
    assert.equal(
      liveMarkRanges(
        markPlugin,
        "- [" + status + "] #task Fix ^fix",
        fields,
      ).ranges.length,
      1,
    );
  }
  for (const invalid of [
    "- [ ] #tasks Fix ^fix",
    "- [ ] #Task Fix ^fix",
    "- [ ] #task Fix",
    "- [ ] ~~#task Fix~~ ^fix",
  ]) {
    assert.equal(liveMarkRanges(markPlugin, invalid, fields).ranges.length, 0);
  }

  // TM12: detail-only changes update the tooltip while membership stays put.
  setTodayFromLedger(
    markPlugin,
    LivePlugin.helpers,
    "## Pomodoros\n\n" +
      "- [ ] (**0725-0815** [t:: 50m]) — GTD\n" +
      "    - [[T#^fix]]\n" +
      "- [ ] () — BLOG\n" +
      "    - [[T#^fix]]\n",
  );
  const tm12 = liveMarkRanges(markPlugin, openTask, fields);
  assert.match(tm12.widgets[0].tooltip, /running in GTD 0725–0815 \+1 more/);
  setTodayFromLedger(markPlugin, LivePlugin.helpers, tm1Ledger);
  assert.doesNotMatch(
    liveMarkRanges(markPlugin, openTask, fields).widgets[0].tooltip,
    /\+1 more/,
  );

  // TM13-TM15: daily notes, an unready cache, and duplicate ids never mark.
  assert.equal(
    liveMarkRanges(markPlugin, openTask, fields, {
      filePath: "2026/20261019.md",
    }).ranges.length,
    0,
  );
  const unready = makeLiveMarkPlugin(LivePlugin, [], { ready: false });
  assert.equal(liveMarkRanges(unready, openTask, fields).ranges.length, 0);
  const duplicated = liveMarkRanges(
    markPlugin,
    openTask + "\n- [ ] #task Another ^fix",
    fields,
    { visibleRanges: [{ from: 0, to: openTask.length }] },
  );
  assert.equal(duplicated.ranges.length, 0);

  // TM16-TM17: placement follows the identity slot, and cursor-only
  // updates do not rebuild or hide the zero-width widget.
  assert.equal(
    liveMarkRanges(markPlugin, "- [ ] #task #ref Read ^fix", fields)
      .ranges[0].from,
    17,
  );
  assert.equal(
    liveMarkRanges(markPlugin, "- [ ] #task #prj Work ^fix", fields)
      .ranges[0].from,
    12,
  );
  assert.equal(
    markPlugin.todayMarkShouldRebuild({ selectionSet: true }),
    false,
  );
  assert.equal(tm1.widgets[0].entering, false);

  // TM18: only recently entered cache keys get the pop, and unlinking
  // removes the decoration.
  markPlugin.todayEnteredAt.set("area.md#fix", Date.now() - 100);
  assert.equal(
    liveMarkRanges(markPlugin, openTask, fields).widgets[0].entering,
    true,
  );
  markPlugin.todayCache.rank.delete("area.md#fix");
  assert.equal(liveMarkRanges(markPlugin, openTask, fields).ranges.length, 0);
  markPlugin.todayCache.rank.set("area.md#fix", 0);

  // TM20: the session toggle gates Live Preview immediately and restores
  // marks without changing the source document.
  const sourceBefore = textDocument(openTask).toString();
  const togglePlugin = makeLiveMarkPlugin(LivePlugin);
  setTodayFromLedger(togglePlugin, LivePlugin.helpers, tm1Ledger);
  togglePlugin.app = {
    workspace: {
      getLeavesOfType: () => [],
    },
  };
  assert.equal(liveMarkRanges(togglePlugin, openTask, fields).ranges.length, 1);
  assert.equal(togglePlugin.toggleTodayMarks(), false);
  assert.equal(liveMarkRanges(togglePlugin, openTask, fields).ranges.length, 0);
  assert.equal(togglePlugin.toggleTodayMarks(), true);
  assert.equal(liveMarkRanges(togglePlugin, openTask, fields).ranges.length, 1);
  assert.equal(textDocument(openTask).toString(), sourceBefore);

  // TM21: both inline code and a fenced code node stay neutral.
  const lineStart = "- [ ] Note code #task Fix ^fix";
  const inlineTag = lineStart.indexOf("#task") + 1;
  const inline = liveMarkRanges(markPlugin, lineStart, fields, {
    codeRanges: [{ from: inlineTag, to: inlineTag + 5, name: "inline-code" }],
  });
  assert.equal(inline.ranges.length, 0);
  const fenced = liveMarkRanges(markPlugin, openTask, fields, {
    codeRanges: [{ from: 0, to: openTask.length, name: "HyperMD-codeblock" }],
  });
  assert.equal(fenced.ranges.length, 0);

  // TM22: a refresh effect redraws tooltip details without changing keys.
  const refreshPlugin = makeLiveMarkPlugin(LivePlugin);
  setTodayFromLedger(
    refreshPlugin,
    LivePlugin.helpers,
    "## Pomodoros\n\n- [ ] () — BLOG\n    - [[T#^fix]]\n",
  );
  const extension = refreshPlugin.createTodayMarkExtension();
  const view = liveView(openTask, "area.md", fields);
  const viewPlugin = new extension.pluginClass(view);
  assert.match(viewPlugin.decorations[0].decoration.spec.widget.tooltip, /queued in/);
  setTodayFromLedger(
    refreshPlugin,
    LivePlugin.helpers,
    "## Pomodoros\n\n- [ ] (**0900-0930** [t:: 30m]) — BLOG\n" +
      "    - [[T#^fix]]\n",
  );
  viewPlugin.update({
    view,
    transactions: [
      { effects: [LivePlugin.helpers.ensureTodayMarksRefresh().of(null)] },
    ],
  });
  assert.match(viewPlugin.decorations[0].decoration.spec.widget.tooltip, /running in/);
});

test("Today mark lifecycle registers the toggle and keyboard command only", () => {
  const LivePlugin = loadPluginModule({ livePreview: true });
  const instance = makeLiveMarkPlugin(LivePlugin);
  const commands = [];
  const extensions = [];
  let postProcessors = 0;
  instance.addCommand = (command) => commands.push(command);
  instance.registerEditorExtension = (extension) => extensions.push(extension);
  instance.registerMarkdownPostProcessor = () => {
    postProcessors += 1;
  };
  instance.scheduleTodayMarksRefresh = () => {};
  instance.setupTodayMarks();
  assert.deepEqual(
    commands.map((command) => command.id),
    ["toggle-today-marks", "go-to-today-task-link"],
  );
  assert.equal(commands[1].name, "Go to today's Task Link");
  assert.equal(Object.hasOwn(commands[1], "hotkeys"), false);
  assert.equal(extensions.length, 1);
  assert.equal(typeof commands[1].editorCallback, "function");
  assert.equal(postProcessors, 0);
});

test("keyboard jump uses the task under the cursor and reports non-membership", () => {
  const LivePlugin = loadPluginModule({ livePreview: true });
  const fields = livePreviewFields;
  const instance = makeLiveMarkPlugin(LivePlugin);
  const editorLine = "- [*] #task Fix ^fix";
  const cmView = liveView(editorLine, "area.md", fields);
  const editor = {
    cm: cmView,
    getCursor: () => ({ line: 0, ch: 0 }),
    getLine: () => editorLine,
  };
  const markdownView = { file: { path: "area.md" } };
  const jumped = [];
  instance.jumpTodayTaskLink = (key) => {
    jumped.push(key);
    return Promise.resolve(true);
  };
  assert.equal(instance.goToTodayTaskLink(editor, markdownView), true);
  assert.deepEqual(jumped, ["area.md#fix"]);
  instance.todayCache.rank.clear();
  TestNotice.messages = [];
  assert.equal(instance.goToTodayTaskLink(editor, markdownView), false);
  assert.equal(TestNotice.messages.at(-1), "Not on today's plan");
  TestNotice.messages = [];
  assert.equal(
    instance.goToTodayTaskLink(
      { getCursor: () => ({ line: 0 }), getLine: () => "- [ ] Pack charger" },
      markdownView,
    ),
    false,
  );
  assert.equal(TestNotice.messages.at(-1), "No task on this line");
});

test("Mod-click and keyboard jumps land on the current running Task Link", async () => {
  const LivePlugin = loadPluginModule({ livePreview: true });
  const fields = livePreviewFields;
  const dailyPath = "2026/20261019.md";
  const content = [
    "## Pomodoros",
    "",
    "- [ ] (**0725-0815** [t:: 50m]) — GTD",
    "    - [[area#^fix]]",
    "- [ ] () — BLOG",
    "    - [[area#^fix]]",
  ].join("\n");
  const doc = textDocument(content);
  const dispatched = [];
  const cmView = {
    state: {
      doc,
      selection: {},
    },
    dispatch: (transaction) => dispatched.push(transaction),
  };
  const cursorCalls = [];
  let focused = 0;
  const editor = {
    cm: cmView,
    getValue: () => content,
    setCursor: (cursor) => cursorCalls.push(cursor),
    focus: () => (focused += 1),
  };
  const markdownView = Object.assign(new TestMarkdownView(), {
    file: { path: dailyPath, extension: "md" },
    editor,
  });
  const leaf = { view: markdownView };
  const instance = makeLiveMarkPlugin(LivePlugin, [
    {
      entryLine: 3,
      ledgerLine: 4,
      name: "GTD",
      range: "0725-0815",
      running: true,
      label: "GTD",
    },
    {
      entryLine: 5,
      ledgerLine: 6,
      name: "BLOG",
      range: null,
      running: false,
      label: "BLOG",
    },
  ]);
  instance.todayCache.dailyPath = dailyPath;
  instance.app = {
    metadataCache: {
      getFirstLinkpathDest: (target) =>
        target === "area" ? { path: "area.md" } : null,
    },
    workspace: {
      iterateAllLeaves: (callback) => callback(leaf),
      revealLeaf: async () => {},
      setActiveLeaf: async () => {},
    },
  };

  // The detail line is stale, so the current open daily note is rescanned.
  instance.todayCache.details.set("area.md#fix", [
    { ledgerLine: 99, entryLine: 3, running: true },
  ]);
  assert.equal(await instance.jumpTodayTaskLink("area.md#fix"), true);
  assert.deepEqual(cursorCalls[0], { line: 3, ch: 6 });
  assert.equal(focused, 1);
  assert.ok(dispatched.length > 0);

  // The keyboard command identifies the same task key from T's cursor line.
  const taskLine = "- [*] #task Fix ^fix";
  const taskView = liveView(taskLine, "area.md", fields);
  const taskEditor = {
    cm: taskView,
    getCursor: () => ({ line: 0, ch: 0 }),
    getLine: () => taskLine,
  };
  assert.equal(
    instance.todayMarksTaskAtCursor(
      taskEditor,
      { file: { path: "area.md" } },
    ).key,
    "area.md#fix",
  );

  // Once the live link is gone, the user gets the specified notice.
  editor.getValue = () => "## Pomodoros\n\n- [ ] () — GTD\n";
  TestNotice.messages = [];
  assert.equal(await instance.jumpTodayTaskLink("area.md#fix"), false);
  assert.equal(
    TestNotice.messages.at(-1),
    "This task's Task Link is no longer in today's note",
  );
  TestNotice.messages = [];
  instance.todayCache.rank.clear();
  assert.equal(await instance.jumpTodayTaskLink("area.md#fix"), false);
  assert.equal(
    TestNotice.messages.at(-1),
    "This task's Task Link is no longer in today's note",
  );
});
