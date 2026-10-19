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

function installStubs() {
  const originalLoad = Module._load;
  Module._load = function loadWithTodayMarkStubs(request) {
    if (request === "obsidian") {
      return {
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
        RangeSetBuilder: null,
      };
    }
    if (request === "@codemirror/view") {
      return {
        EditorView: {},
        keymap: { of: (value) => value },
        ViewPlugin: null,
        Decoration: null,
        WidgetType: StubWidgetType,
      };
    }
    if (request === "@codemirror/language") {
      return { syntaxTree: () => null };
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
