// Tests for D11 task-type identity: `#TYPE` in the #task slot, ledger
// agreement marks, WCAG contrast of `--bob-type-ink-*`, and Ledger Tools
// words. Owned by bob-cli `docs/task-tag-marks.md` and
// plan:202610/task_types.md D11.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");

const editorInfoField = { _taskTypeField: "info" };
const editorLivePreviewField = { _taskTypeField: "live" };

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
  widget: (spec) => ({ _decorationWidget: true, ...spec }),
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
    return { _viewPlugin: true, cls, options };
  },
};

function stubSyntaxTree() {
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
  Module._load = function loadWithTaskTypeStubs(request) {
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
  TASK_TYPE_IDENTITY_HINT,
  taskTagTypeFieldOf,
  taskTagIdentityKind,
  taskTagIdentityFromField,
  taskTagIdentityFromInherited,
  taskTagIdentityTooltip,
  taskTagIdentityAria,
  taskTagIdentityShown,
  ledgerTypeDisagreeTooltip,
  applyTaskTagTypeAttrs,
  ledgerTypeMarkLinks,
  ledgerTypeMarkKind,
  buildLedgerTypeMarkElement,
  typeAgrees,
  taskTagMarkRanges,
} = helpers;

const GENERIC_TOOLTIP =
  "#task \u00b7 tracked task\nCtrl+Shift+] to demote to a bullet";
const HINT = "Ctrl+Shift+P t to change";
const SLOTS = [
  "blue",
  "orange",
  "aqua",
  "yellow",
  "magenta",
  "green",
  "violet",
  "red",
];
const CSS_PATH = path.join(
  __dirname,
  "..",
  "plugins",
  "bob-ledger-tools",
  "styles.css",
);

function fakeElementDoc() {
  function el(tag) {
    return {
      tagName: tag,
      attrs: {},
      children: [],
      setAttribute(name, value) {
        this.attrs[name] = String(value);
      },
      getAttribute(name) {
        return Object.prototype.hasOwnProperty.call(this.attrs, name)
          ? this.attrs[name]
          : null;
      },
      removeAttribute(name) {
        delete this.attrs[name];
      },
    };
  }
  return {
    createElement: (tag) => el(tag),
  };
}

function hexToRgb(hex) {
  const n = String(hex || "").replace("#", "");
  return [
    parseInt(n.slice(0, 2), 16),
    parseInt(n.slice(2, 4), 16),
    parseInt(n.slice(4, 6), 16),
  ];
}

function mixRgb(a, b, p) {
  return a.map((value, index) => value * p + b[index] * (1 - p));
}

function relativeLuminance(rgb) {
  const lin = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrastRatio(a, b) {
  const L1 = relativeLuminance(a);
  const L2 = relativeLuminance(b);
  const hi = Math.max(L1, L2);
  const lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
}

function parseThemeBlock(css, selector) {
  const start = css.indexOf(selector + " {");
  assert.ok(start !== -1, selector);
  const end = css.indexOf("}", start);
  return css.slice(start, end + 1);
}

function lanePalettes(lightBlock, darkBlock) {
  return {
    light: {
      hues: parseAreaHues(lightBlock),
      text: [34, 34, 34],
      bg: [255, 255, 255],
      blocked: [233, 49, 71],
      inprogress: [224, 172, 0],
      next: [8, 185, 78],
    },
    dark: {
      hues: parseAreaHues(darkBlock),
      text: [218, 218, 218],
      bg: [30, 30, 30],
      blocked: [251, 70, 76],
      inprogress: [224, 222, 113],
      next: [68, 207, 110],
    },
  };
}

test("stylesheet custom properties do not reference themselves", () => {
  const css = fs.readFileSync(CSS_PATH, "utf8");
  const cycle = /(--[\w-]+)\s*:[^;{}]*var\(\s*\1\s*[,)]/g;
  const offenders = Array.from(css.matchAll(cycle), ([declaration, property]) =>
    property + ": " + declaration.trim(),
  );
  assert.deepEqual(offenders, [], "cyclic custom properties: " + offenders.join("; "));
});

function parseAreaHues(block) {
  const hues = {};
  for (const slot of SLOTS) {
    const match = block.match(
      new RegExp("--bob-area-" + slot + ":\\s*(#[0-9a-fA-F]{6})"),
    );
    assert.ok(match, "missing --bob-area-" + slot);
    hues[slot] = match[1];
  }
  return hues;
}

test("explicit and legacy fields, repair, and none", () => {
  const typed = taskTagTypeFieldOf("- [ ] #task Do [type:: FIX]");
  assert.equal(typed.fieldState, "set");
  assert.equal(typed.type, "FIX");
  assert.equal(typed.key, "fix");
  const legacy = taskTagTypeFieldOf("- [ ] #task Do [theme:: WRITE]");
  assert.equal(legacy.fieldState, "set");
  assert.equal(legacy.type, "WRITE");
  const none = taskTagTypeFieldOf("- [ ] #task Restart athena");
  assert.equal(none.fieldState, "none");
  assert.equal(none.type, null);
  const repair = taskTagTypeFieldOf("- [ ] #task Do [type:: ???]");
  assert.equal(repair.fieldState, "repair");
  assert.equal(repair.type, "?");
  assert.equal(taskTagTypeFieldOf(null).fieldState, "none");
});

test("taskTagMarkRanges attach the explicit type without changing offsets", () => {
  const ranges = taskTagMarkRanges("- [ ] #task Do [type:: FIX]");
  assert.equal(ranges.length, 1);
  assert.equal(ranges[0].from, 6);
  assert.equal(ranges[0].to, 11);
  assert.equal(ranges[0].kind, "task");
  assert.equal(ranges[0].type, "FIX");
  assert.equal(ranges[0].fieldState, "set");
});

test("identity kind: repair, unconfigured, muted, inherited, explicit", () => {
  assert.equal(taskTagIdentityKind({ fieldState: "repair" }), "repair");
  assert.equal(taskTagIdentityKind({ hue_source: "unconfigured" }), "unconfigured");
  assert.equal(taskTagIdentityKind({ hue_source: "exempt" }), "muted");
  assert.equal(taskTagIdentityKind({ hue_source: "auto" }), "muted");
  assert.equal(taskTagIdentityKind({ inherited: true }), "inherited");
  assert.equal(taskTagIdentityKind({}), "explicit");
});

test("explicit identity tooltip, aria, shown, and no double-colons", () => {
  const identity = taskTagIdentityFromField(
    { fieldState: "set", type: "FIX", key: "fix" },
    { hue: "aqua", hue_source: "pin", configured: true },
    { suggest: "dev suggests BUILD" },
  );
  assert.equal(identity.state, "explicit");
  assert.equal(identity.type, "FIX");
  assert.equal(identity.hue, "aqua");
  assert.equal(
    taskTagIdentityTooltip(identity),
    "FIX \u00b7 set on this task \u00b7 dev suggests BUILD \u00b7 " + HINT,
  );
  assert.equal(taskTagIdentityAria(identity), "#task \u00b7 type FIX");
  assert.equal(taskTagIdentityShown(identity, false), true);
  assert.equal(taskTagIdentityTooltip(identity).indexOf("::"), -1);
  assert.equal(taskTagIdentityAria(identity).indexOf("::"), -1);
  assert.equal(TASK_TYPE_IDENTITY_HINT, HINT);
});

test("inherited identity is tooltip-only until the toggle is on", () => {
  const identity = taskTagIdentityFromInherited(
    "BUILD",
    "build",
    { hue: "blue", hue_source: "area", configured: true },
    { from: "dev" },
  );
  assert.equal(identity.state, "inherited");
  assert.equal(identity.inherited, true);
  assert.equal(taskTagIdentityTooltip(identity), "BUILD \u00b7 from dev");
  assert.equal(taskTagIdentityAria(identity), GENERIC_TOOLTIP);
  assert.equal(taskTagIdentityShown(identity, false), false);
  assert.equal(taskTagIdentityShown(identity, true), true);
});

test("unconfigured explicit type keeps the name and drops the hue", () => {
  const identity = taskTagIdentityFromField(
    { fieldState: "set", type: "SNACK", key: "snack" },
    { hue: "gray", hue_source: "unconfigured", configured: false },
    {},
  );
  assert.equal(identity.state, "unconfigured");
  assert.equal(identity.type, "SNACK");
  assert.equal(identity.hue, null);
  assert.equal(taskTagIdentityShown(identity, false), true);
});

test("repair identity is always shown as #?", () => {
  const identity = taskTagIdentityFromField(
    { fieldState: "repair", type: "?", repair: "invalid" },
    null,
    {},
  );
  assert.equal(identity.state, "repair");
  assert.equal(identity.type, "?");
  assert.equal(taskTagIdentityShown(identity, false), true);
  assert.equal(
    taskTagIdentityTooltip(identity),
    "#? \u00b7 needs repair\n" + HINT,
  );
  assert.equal(taskTagIdentityAria(identity), "#task \u00b7 type ?");
});

test("applyTaskTagTypeAttrs writes and clears data-bob-type", () => {
  const doc = fakeElementDoc();
  const el = doc.createElement("span");
  const identity = taskTagIdentityFromField(
    { fieldState: "set", type: "FIX", key: "fix" },
    { hue: "aqua", hue_source: "pin", configured: true },
    {},
  );
  assert.equal(applyTaskTagTypeAttrs(el, identity, false), true);
  assert.equal(el.attrs["data-bob-type"], "FIX");
  assert.equal(el.attrs["data-bob-type-hue"], "aqua");
  assert.equal(el.attrs["data-bob-type-state"], "explicit");
  const inherited = taskTagIdentityFromInherited(
    "BUILD",
    "build",
    { hue: "blue", hue_source: "area", configured: true },
    { from: "dev" },
  );
  applyTaskTagTypeAttrs(el, inherited, false);
  assert.equal(el.attrs["data-bob-type"], undefined);
  applyTaskTagTypeAttrs(el, inherited, true);
  assert.equal(el.attrs["data-bob-type"], "BUILD");
  assert.equal(el.attrs["data-bob-type-state"], "inherited");
  applyTaskTagTypeAttrs(el, null, false);
  assert.equal(el.attrs["data-bob-type"], undefined);
});

test("stale or missing identity is a generic glyph", () => {
  assert.equal(taskTagIdentityShown(null, true), false);
  assert.equal(taskTagIdentityTooltip(null), GENERIC_TOOLTIP);
  assert.equal(taskTagIdentityFromInherited("", "x", null, {}), null);
});

test("ledger disagreement and composite quiet prefix", () => {
  const sources = { vocab: null, exempt: ["PLAN"], inventory: [] };
  assert.equal(typeAgrees("fix", "BUILD", sources), false);
  assert.equal(ledgerTypeMarkKind("fix", "BUILD", sources), "disagree");
  assert.equal(ledgerTypeMarkKind("build", "BUILD + FIX", sources), "composite");
  assert.equal(ledgerTypeMarkKind("build", "BUILD", sources), null);
  assert.equal(
    ledgerTypeDisagreeTooltip("BUILD", "FIX"),
    "BUILD task under FIX \u00b7 Ctrl+Shift+M to move \u00b7 Ctrl+Shift+P t to retype",
  );
  assert.equal(ledgerTypeDisagreeTooltip("BUILD", "FIX").indexOf("::"), -1);
});

test("ledgerTypeMarkLinks find dedicated Task Links and keep the entry name", () => {
  const content = [
    "## Pomodoros",
    "- [ ] () — BUILD",
    "\t- [[T#^fix]]",
  ].join("\n");
  const found = ledgerTypeMarkLinks(content);
  assert.equal(found.length, 1);
  assert.equal(found[0].target, "T");
  assert.equal(found[0].blockId, "fix");
  assert.equal(found[0].entryName, "BUILD");
});

test("buildLedgerTypeMarkElement paints disagree and composite", () => {
  const doc = fakeElementDoc();
  const disagree = buildLedgerTypeMarkElement(doc, {
    type: "BUILD",
    hue: "blue",
    kind: "disagree",
    entryName: "FIX",
  });
  assert.equal(disagree.attrs.class, "bob-ledger-type-mark is-disagree");
  assert.equal(disagree.attrs["data-bob-type"], "BUILD");
  assert.equal(disagree.attrs["data-bob-type-hue"], "blue");
  assert.match(disagree.attrs.title, /BUILD task under FIX/);
  const composite = buildLedgerTypeMarkElement(doc, {
    type: "BUILD",
    hue: "blue",
    kind: "composite",
    entryName: "BUILD + FIX",
  });
  assert.equal(composite.attrs.class, "bob-ledger-type-mark is-composite");
  assert.equal(buildLedgerTypeMarkElement(doc, { type: "" }), null);
});

test("inherited toggle is off by default and the command is registered", () => {
  TestNotice.messages = [];
  const plugin = new LedgerToolsPlugin(
    {
      workspace: {
        on: () => ({}),
        offref: () => {},
        onLayoutReady: () => {},
        getLeavesOfType: () => [],
      },
      metadataCache: { on: () => ({}) },
      vault: { on: () => ({}) },
    },
    {},
  );
  plugin.applyMarkGateClass = () => {};
  plugin.registerMarkGatePopoutSync = () => {};
  plugin.setupTaskTagMarks();
  assert.equal(plugin.inheritedTaskTypesEnabled, false);
  const ids = (plugin.commands || []).map((command) => command.id);
  assert.ok(ids.indexOf("toggle-inherited-task-types") !== -1);
  const inherited = (plugin.commands || []).find(
    (command) => command.id === "toggle-inherited-task-types",
  );
  assert.equal(inherited.name, "Toggle inherited task types");
  assert.equal(plugin.toggleInheritedTaskTypes(), true);
  assert.ok(TestNotice.messages.indexOf("Inherited task types on") !== -1);
  assert.equal(plugin.toggleInheritedTaskTypes(), false);
  assert.ok(TestNotice.messages.indexOf("Inherited task types off") !== -1);
});

test("D11 contrast: 8 slots × {plain, Blocked, In Progress, Next} × {light, dark} ≥ 4.5:1", () => {
  const css = fs.readFileSync(CSS_PATH, "utf8");
  const lightBlock = parseThemeBlock(css, ".theme-light");
  const darkBlock = parseThemeBlock(css, ".theme-dark");
  assert.ok(lightBlock.indexOf("--bob-type-ink-yellow") !== -1);
  assert.ok(darkBlock.indexOf("--bob-type-ink-yellow") !== -1);
  const palettes = lanePalettes(lightBlock, darkBlock);
  const wash = 0.07;
  const failures = [];
  for (const [theme, palette] of Object.entries(palettes)) {
    for (const slot of SLOTS) {
      const ink = mixRgb(hexToRgb(palette.hues[slot]), palette.text, 0.55);
      const backgrounds = {
        plain: palette.bg,
        blocked: mixRgb(palette.blocked, palette.bg, wash),
        inprogress: mixRgb(palette.inprogress, palette.bg, wash),
        next: mixRgb(palette.next, palette.bg, wash),
      };
      for (const [lane, bg] of Object.entries(backgrounds)) {
        const ratio = contrastRatio(ink, bg);
        if (ratio < 4.5) {
          failures.push(
            theme + " " + slot + " " + lane + " " + ratio.toFixed(3),
          );
        }
      }
    }
  }
  assert.deepEqual(failures, []);
});

test("muted type ink contrast: plain and lane tints at 7% and 14% × light/dark ≥ 4.5:1", () => {
  const css = fs.readFileSync(CSS_PATH, "utf8");
  const themeBlocks = {
    light: parseThemeBlock(css, ".theme-light"),
    dark: parseThemeBlock(css, ".theme-dark"),
  };
  const palettes = lanePalettes(
    themeBlocks.light,
    themeBlocks.dark,
  );
  const failures = [];
  for (const [theme, palette] of Object.entries(palettes)) {
    const match = themeBlocks[theme].match(/--bob-type-ink-muted:\s*(#[0-9a-fA-F]{6})/);
    assert.ok(match, "missing --bob-type-ink-muted in .theme-" + theme);
    const ink = hexToRgb(match[1]);
    for (const wash of [0.07, 0.14]) {
      const backgrounds = {
        plain: palette.bg,
        blocked: mixRgb(palette.blocked, palette.bg, wash),
        inprogress: mixRgb(palette.inprogress, palette.bg, wash),
        next: mixRgb(palette.next, palette.bg, wash),
      };
      for (const [lane, bg] of Object.entries(backgrounds)) {
        const ratio = contrastRatio(ink, bg);
        if (ratio < 4.5) {
          failures.push(
            theme + " " + Math.round(wash * 100) + "% " + lane + " " + ratio.toFixed(3),
          );
        }
      }
    }
  }
  assert.deepEqual(failures, []);
});

test("exempt PLAN identity stays muted and omits its hue attribute", () => {
  const identity = taskTagIdentityFromField(
    { fieldState: "set", type: "PLAN", key: "plan" },
    { hue: null, hue_source: "exempt", configured: true },
  );
  assert.equal(identity.state, "muted");
  assert.equal(identity.hue, null);
  const el = fakeElementDoc().createElement("span");
  assert.equal(applyTaskTagTypeAttrs(el, identity, false), true);
  assert.equal(el.attrs["data-bob-type"], "PLAN");
  assert.equal(el.attrs["data-bob-type-state"], "muted");
  assert.equal(el.attrs["data-bob-type-hue"], undefined);
});

test("styles.css defines type ink, identity ::after, and ledger marks", () => {
  const css = fs.readFileSync(CSS_PATH, "utf8");
  assert.ok(css.indexOf("content: attr(data-bob-type)") !== -1);
  assert.ok(css.indexOf("content: \"#\" attr(data-bob-type)") !== -1);
  assert.ok(css.indexOf("var(--bob-type-ink-muted)") !== -1);
  assert.ok(css.indexOf(".bob-ledger-type-mark.is-disagree") !== -1);
  assert.ok(css.indexOf(".bob-ledger-type-mark.is-composite") !== -1);
  assert.ok(css.indexOf('[data-dv-norm-key="type"]') !== -1);
  assert.ok(css.indexOf(".bob-task-theme-fold") !== -1);
  assert.ok(css.indexOf("display: none") !== -1);
});

test("helpers never throw on bad input", () => {
  assert.equal(taskTagTypeFieldOf(null).type, null);
  assert.equal(taskTagIdentityFromField(null, null, null), null);
  assert.equal(taskTagIdentityTooltip(null), GENERIC_TOOLTIP);
  assert.equal(ledgerTypeMarkKind(null, "BUILD", {}), null);
  assert.deepEqual(ledgerTypeMarkLinks(null), []);
  assert.equal(buildLedgerTypeMarkElement(null, { type: "FIX" }), null);
  assert.equal(applyTaskTagTypeAttrs(null, null, false), false);
});
