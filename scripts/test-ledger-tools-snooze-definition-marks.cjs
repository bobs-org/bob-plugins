// Tests for bob-ledger-tools snooze definition marks (SM-D).
// `docs/snooze-marks.md` in bob-cli is the authoritative display
// contract; the `definition` group in
// `tests/fixtures/snooze/marks.json` is its executable data. Every
// SM-D vector below runs verbatim through the shared display model,
// and the Live Preview and Reading surfaces prove the runtime guards:
// non-daily hosts only, exact task token plus trailing unique id, no
// code or fences, open status, ready cache, both toggles on, and a
// live ledger link winning over the clock.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");
const {
  CANONICAL_DIR,
} = require("./snooze-model-vectors.cjs");

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
  Module._load = function loadWithSnoozeMarkStubs(request) {
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
        EditorView: { scrollIntoView: (position) => ({ position }) },
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
    return originalLoad.call(this, request);
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

const LedgerToolsPlugin = loadPluginModule({ livePreview: true });
const { helpers } = LedgerToolsPlugin;

const {
  SNOOZE_DEFINITION_OPEN_STATUSES,
  snoozeDefinitionMarkForVector,
  snoozeDefinitionCountdownText,
  snoozeDefinitionColonTime,
  snoozeDefinitionNowMinutes,
  snoozeDefinitionTooltip,
  snoozeDefinitionHintLine,
  buildSnoozeMarkElement,
  SnoozeMarkWidget,
  ensureSnoozeMarksRefresh,
} = helpers;

const PLUGIN_FIXTURE_PATH = path.join(
  __dirname,
  "..",
  "plugins",
  "bob-ledger-tools",
  "scripts",
  "fixtures",
  "snooze",
  "marks.json",
);

function readCanonicalMarks() {
  return JSON.parse(
    fs.readFileSync(path.join(CANONICAL_DIR, "marks.json"), "utf8"),
  );
}

function readPluginMarks() {
  return JSON.parse(fs.readFileSync(PLUGIN_FIXTURE_PATH, "utf8"));
}

test("definition fixture copy is byte-identical to the canonical bob-cli fixture", () => {
  const canonical = fs.readFileSync(path.join(CANONICAL_DIR, "marks.json"));
  const copy = fs.readFileSync(PLUGIN_FIXTURE_PATH);
  assert.ok(copy.equals(canonical), "plugin marks.json matches canonical marks.json");
});

test("canonical definition group has 20 unique SM-D vectors", () => {
  const fixture = readCanonicalMarks();
  assert.equal(fixture.schema_version, 1);
  const defs = fixture.groups.definition;
  assert.equal(defs.length, 20);
  const ids = defs.map((item) => item.id);
  assert.deepEqual(ids, [
    "SM-D01", "SM-D02", "SM-D03", "SM-D04", "SM-D05",
    "SM-D06", "SM-D07", "SM-D08", "SM-D09", "SM-D10",
    "SM-D11", "SM-D12", "SM-D13", "SM-D14", "SM-D15",
    "SM-D16", "SM-D17", "SM-D18", "SM-D19", "SM-D20",
  ]);
  for (const item of defs) {
    assert.deepEqual(item.runners, ["js"]);
  }
});

test("every canonical SM-D vector runs verbatim through the shared display model", () => {
  const fixture = readPluginMarks();
  for (const item of fixture.groups.definition) {
    const actual = snoozeDefinitionMarkForVector(item.input);
    assert.deepEqual(
      {
        mark: actual.mark,
        text: actual.text,
        tone: actual.tone,
        tooltip: actual.tooltip,
        navigates_to: actual.navigates_to,
      },
      item.expected,
      item.id + " display model",
    );
  }
});

test("open statuses are exactly star, slash, and question", () => {
  assert.deepEqual(SNOOZE_DEFINITION_OPEN_STATUSES.slice(), ["*", "/", "?"]);
  assert.ok(Object.isFrozen(SNOOZE_DEFINITION_OPEN_STATUSES));
});

test("countdown words never reflow the line", () => {
  assert.equal(snoozeDefinitionCountdownText(150), "in 2h 30m");
  assert.equal(snoozeDefinitionCountdownText(45), "in 45m");
  assert.equal(snoozeDefinitionCountdownText(60), "in 1h");
  assert.equal(snoozeDefinitionCountdownText(0), "in 0m");
  assert.equal(snoozeDefinitionCountdownText(-5), "in 0m");
  assert.equal(snoozeDefinitionCountdownText(null), "in 0m");
});

test("time parsing is strict HHMM and HH:MM", () => {
  assert.equal(snoozeDefinitionColonTime("1530"), "15:30");
  assert.equal(snoozeDefinitionColonTime("2400"), null);
  assert.equal(snoozeDefinitionColonTime("1560"), null);
  assert.equal(snoozeDefinitionColonTime("930"), null);
  assert.equal(snoozeDefinitionNowMinutes("13:00"), 780);
  assert.equal(snoozeDefinitionNowMinutes("9:05"), 545);
  assert.equal(snoozeDefinitionNowMinutes("24:00"), null);
  assert.equal(snoozeDefinitionNowMinutes("13:0"), null);
});

test("tooltips carry state words, never contain ::, and hint per platform", () => {
  assert.equal(
    snoozeDefinitionTooltip("asleep", "15:30", "in 2h 30m", "other"),
    "Snoozed until 15:30 \u00b7 in 2h 30m\nCtrl-click to open the Snoozed row",
  );
  assert.equal(
    snoozeDefinitionTooltip("due", "15:30", null, "other"),
    "Snoozed until 15:30 \u00b7 due \u2014 waking\nCtrl-click to open the Snoozed row",
  );
  assert.equal(
    snoozeDefinitionTooltip("blocked", "15:30", null, "other"),
    "Snoozed until 15:30 \u00b7 waits on prerequisites\nCtrl-click to open the Snoozed row",
  );
  assert.equal(
    snoozeDefinitionHintLine("mac"),
    "\u2318-click to open the Snoozed row",
  );
  assert.equal(snoozeDefinitionHintLine("mobile"), "");
  assert.equal(
    snoozeDefinitionTooltip("asleep", "15:30", "in 1h", "mobile"),
    "Snoozed until 15:30 \u00b7 in 1h",
  );
  for (const state of ["asleep", "due", "blocked"]) {
    for (const platform of ["other", "mac", "mobile"]) {
      assert.ok(
        !snoozeDefinitionTooltip(state, "15:30", "in 1h", platform).includes("::"),
        state + "/" + platform + " has no ::",
      );
    }
  }
});

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

test("mark element is an empty copy-safe host with tone, key, and time", () => {
  const doc = fakeElementDoc();
  const dom = buildSnoozeMarkElement(doc, {
    key: "job.md#email-dan",
    time: "15:30",
    tone: "indigo",
    tooltip: "Snoozed until 15:30 \u00b7 in 2h 30m",
  });
  assert.ok(dom);
  assert.equal(dom.textContent, "");
  assert.equal(
    dom.attrs.class,
    "bob-snooze-mark bob-snooze-mark--indigo",
  );
  assert.equal(dom.attrs.role, "img");
  assert.equal(dom.attrs["data-tooltip-position"], "top");
  assert.equal(dom.attrs["data-bob-snooze-key"], "job.md#email-dan");
  assert.equal(dom.attrs["data-bob-snooze-time"], "15:30");
  assert.ok(!("title" in dom.attrs));
  const due = buildSnoozeMarkElement(doc, {
    key: "job.md#email-dan",
    time: "15:30",
    tone: "due",
    tooltip: "x",
    pulse: true,
  });
  assert.ok(due.attrs.class.includes("is-pulsing"));
  assert.equal(buildSnoozeMarkElement(doc, { key: "", time: "15:30" }), null);
  assert.equal(
    buildSnoozeMarkElement(doc, { key: "k", time: "3:30" }),
    null,
  );
  assert.equal(buildSnoozeMarkElement(null, { key: "k" }), null);
});

test("widget eq ignores the pulse so the due transition never replays", () => {
  const first = new SnoozeMarkWidget("k", "15:30", "amber", "tip", true, null);
  const second = new SnoozeMarkWidget("k", "15:30", "amber", "tip", false, null);
  assert.ok(first.eq(second));
  const retimed = new SnoozeMarkWidget("k", "19:00", "amber", "tip", false, null);
  assert.ok(!first.eq(retimed));
  const retold = new SnoozeMarkWidget("k", "15:30", "amber", "changed", false, null);
  assert.ok(!first.eq(retold));
  const muted = new SnoozeMarkWidget("k", "15:30", "muted", "tip", false, null);
  assert.ok(!first.eq(muted));
});

test("widget mousedown: modifier jumps, plain click places the cursor", () => {
  const doc = fakeElementDoc();
  const realDocument = globalThis.document;
  globalThis.document = doc;
  try {
    let jumped = null;
    const widget = new SnoozeMarkWidget(
      "job.md#email-dan",
      "15:30",
      "indigo",
      "tip",
      false,
      (key) => {
        jumped = key;
      },
    );
    let dispatched = null;
    const view = {
      posAtDOM: () => 42,
      dispatch: (transaction) => {
        dispatched = transaction;
      },
      focus: () => {
        view.focused = true;
      },
    };
    const dom = widget.toDOM(view);
    dom.handlers.mousedown({ button: 0, ctrlKey: true, preventDefault: () => {} });
    assert.equal(jumped, "job.md#email-dan");
    assert.equal(dispatched, null);
    jumped = null;
    dom.handlers.mousedown({ button: 0, preventDefault: () => {} });
    assert.equal(jumped, null);
    assert.deepEqual(dispatched, { selection: { anchor: 42 } });
    assert.equal(view.focused, true);
  } finally {
    if (realDocument === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = realDocument;
    }
  }
});

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
    visibleRanges: options.visibleRanges || [{ from: 0, to: doc.length }],
    dispatch: () => {},
  };
}

function snoozeSnapshot(overrides = {}) {
  return {
    key: "job.md#email-dan",
    identity: "job.md#^email-dan",
    line: 8,
    minutes: 930,
    hhmm: "15:30",
    target: "job",
    blockId: "email-dan",
    route: "job.md",
    state: "asleep",
    history: false,
    wokeAt: null,
    children: 0,
    childrenText: "",
    source: "- **1530** [[job#^email-dan]]",
    ...overrides,
  };
}

function makeSnoozeMarkPlugin(options = {}) {
  const instance = Object.create(LedgerToolsPlugin.prototype);
  instance.snoozeMarksEnabled = options.enabled !== false;
  instance.snoozeMarksTimer = null;
  instance.snoozeJumpInFlight = false;
  instance.snoozeDueSeen = new Map();
  const snapshot = snoozeSnapshot(options.snapshot);
  instance.snoozedCache = {
    date: "2026-11-05",
    dailyPath: "2026/20261105.md",
    zone: "America/New_York",
    nowMinutes: 780,
    rows: [snapshot],
    byKey: new Map(
      options.empty ? [] : [[snapshot.key, snapshot]],
    ),
    planned: options.empty ? [] : [snapshot.identity],
    blocked: [],
    nextWakeAt: "15:30",
    detailsSignature: "sig",
  };
  instance.todayCache = {
    rank: new Map(options.todayKeys || []),
  };
  instance.isSnoozedCacheReady =
    options.ready === false ? () => false : () => true;
  const fixed =
    options.now instanceof Date ? options.now : new Date(2026, 10, 5, 13, 0);
  instance.snoozeMarksNow = () => fixed;
  instance.app = { workspace: { getLeavesOfType: () => [] } };
  return instance;
}

function snoozeRanges(plugin, text, options = {}) {
  const view = liveView(text, options.filePath || "job.md", livePreviewFields, options);
  const result = plugin.buildSnoozeMarkDecorations(view);
  return {
    result,
    view,
    ranges: Array.isArray(result) ? result : [],
    widgets: Array.isArray(result)
      ? result.map((range) => range.decoration.spec.widget)
      : [],
  };
}

const TASK_LINE = "- [*] #task Email Dan ^email-dan";

test("Live Preview: a snoozed-only task earns an indigo clock", () => {
  const plugin = makeSnoozeMarkPlugin();
  const { ranges, widgets } = snoozeRanges(plugin, TASK_LINE);
  assert.equal(ranges.length, 1);
  assert.equal(widgets.length, 1);
  const widget = widgets[0];
  assert.equal(widget.key, "job.md#email-dan");
  assert.equal(widget.time, "15:30");
  assert.equal(widget.tone, "indigo");
  assert.equal(
    widget.tooltip,
    "Snoozed until 15:30 \u00b7 in 2h 30m\nCtrl-click to open the Snoozed row",
  );
  assert.equal(widget.pulse, false);
});

test("Live Preview: a live ledger link wins and the clock leaves", () => {
  const plugin = makeSnoozeMarkPlugin({
    todayKeys: [["job.md#email-dan", 0]],
  });
  const { ranges } = snoozeRanges(plugin, TASK_LINE);
  assert.equal(ranges.length, 0);
});

test("Live Preview: guards stay neutral (daily, toggle, cache, code, duplicate)", () => {
  const daily = makeSnoozeMarkPlugin();
  assert.equal(snoozeRanges(daily, TASK_LINE, { filePath: "2026/20261105.md" }).ranges.length, 0);
  const off = makeSnoozeMarkPlugin({ enabled: false });
  assert.equal(snoozeRanges(off, TASK_LINE).ranges.length, 0);
  const unready = makeSnoozeMarkPlugin({ ready: false });
  assert.equal(snoozeRanges(unready, TASK_LINE).ranges.length, 0);
  const empty = makeSnoozeMarkPlugin({ empty: true });
  assert.equal(snoozeRanges(empty, TASK_LINE).ranges.length, 0);
  const doc = textDocument(TASK_LINE);
  const inlineFrom = TASK_LINE.indexOf("#task") + 1;
  const coded = makeSnoozeMarkPlugin();
  assert.equal(
    snoozeRanges(coded, TASK_LINE, {
      codeRanges: [{ from: inlineFrom - 1, to: inlineFrom + 6 }],
    }).ranges.length,
    0,
  );
  const dup = makeSnoozeMarkPlugin();
  assert.equal(
    snoozeRanges(dup, TASK_LINE + "\n" + TASK_LINE).ranges.length,
    0,
  );
});

test("Live Preview: closed tasks and missing ids earn no clock", () => {
  const plugin = makeSnoozeMarkPlugin();
  assert.equal(
    snoozeRanges(plugin, "- [x] #task Email Dan ^email-dan").ranges.length,
    0,
  );
  assert.equal(
    snoozeRanges(plugin, "- [*] Email Dan ^email-dan").ranges.length,
    0,
  );
  assert.equal(
    snoozeRanges(plugin, "- [*] #task Email Dan").ranges.length,
    0,
  );
});

test("Live Preview: retiming swaps the widget quietly through eq", () => {
  const plugin = makeSnoozeMarkPlugin();
  const before = snoozeRanges(plugin, TASK_LINE).widgets[0];
  plugin.snoozedCache.byKey.set(
    "job.md#email-dan",
    snoozeSnapshot({ minutes: 1140, hhmm: "19:00" }),
  );
  const after = snoozeRanges(plugin, TASK_LINE).widgets[0];
  assert.ok(after);
  assert.equal(after.time, "19:00");
  assert.ok(!before.eq(after));
  const repeat = snoozeRanges(plugin, TASK_LINE).widgets[0];
  assert.ok(after.eq(repeat));
});

test("Live Preview: the due pulse fires once on the Asleep-to-Due flip", () => {
  const plugin = makeSnoozeMarkPlugin();
  const calm = snoozeRanges(plugin, TASK_LINE).widgets[0];
  assert.equal(calm.tone, "indigo");
  assert.equal(calm.pulse, false);
  plugin.snoozedCache.byKey.set(
    "job.md#email-dan",
    snoozeSnapshot({ state: "due" }),
  );
  const flipping = snoozeRanges(plugin, TASK_LINE).widgets[0];
  assert.equal(flipping.tone, "amber");
  assert.equal(flipping.pulse, true);
  const settled = snoozeRanges(plugin, TASK_LINE).widgets[0];
  assert.equal(settled.tone, "amber");
  assert.equal(settled.pulse, false);
});

test("Live Preview: startup on a due row never pulses", () => {
  const plugin = makeSnoozeMarkPlugin({
    snapshot: { state: "due" },
  });
  const widget = snoozeRanges(plugin, TASK_LINE).widgets[0];
  assert.equal(widget.tone, "amber");
  assert.equal(widget.pulse, false);
});

test("Live Preview: Blocked rows wear a muted clock", () => {
  const plugin = makeSnoozeMarkPlugin({
    snapshot: { state: "blocked" },
  });
  const widget = snoozeRanges(plugin, TASK_LINE).widgets[0];
  assert.equal(widget.tone, "muted");
  assert.ok(widget.tooltip.endsWith("waits on prerequisites\nCtrl-click to open the Snoozed row"));
});

function fakeReadingDoc(stamped) {
  return {
    body: {},
    querySelectorAll(selector) {
      if (selector === "li[data-bob-snooze-key]") {
        return stamped.slice();
      }
      return [];
    },
  };
}

function fakeReadingLi(key) {
  const attrs = { "data-task": "*", class: "" };
  if (key) {
    attrs["data-bob-snooze-key"] = key;
  }
  const li = {
    tagName: "LI",
    parentNode: null,
    dataset: key ? { bobSnoozeKey: key } : {},
    ownerDocument: fakeElementDoc(),
    attrs,
    children: [],
    classList: undefined,
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name)
        ? this.attrs[name]
        : null;
    },
    setAttribute(name, value) {
      this.attrs[name] = String(value);
    },
    removeAttribute(name) {
      delete this.attrs[name];
    },
    querySelectorAll() {
      return li.children.slice();
    },
    appendChild(child) {
      try {
        child.parentNode = li;
      } catch (error) {
        // Best-effort linkage.
      }
      li.children.push(child);
      return child;
    },
    removeChild(child) {
      li.children = li.children.filter((item) => item !== child);
      return child;
    },
  };
  return li;
}

test("Reading: desired rows resolve through the same snapshot rules", () => {
  const plugin = makeSnoozeMarkPlugin();
  const li = fakeReadingLi(null);
  const clock = new Date(2026, 10, 5, 13, 0);
  const desired = plugin.snoozeMarkDesiredForRow(li, "job.md#email-dan", 780, clock);
  assert.ok(desired);
  assert.equal(desired.time, "15:30");
  assert.equal(desired.tone, "indigo");
  assert.equal(
    desired.tooltip,
    "Snoozed until 15:30 \u00b7 in 2h 30m\nCtrl-click to open the Snoozed row",
  );
  const tomato = makeSnoozeMarkPlugin({ todayKeys: [["job.md#email-dan", 0]] });
  assert.equal(
    tomato.snoozeMarkDesiredForRow(li, "job.md#email-dan", 780, clock),
    null,
  );
  const off = makeSnoozeMarkPlugin({ enabled: false });
  assert.equal(off.snoozeMarkDesiredForRow(li, "job.md#email-dan", 780, clock), null);
  const unready = makeSnoozeMarkPlugin({ ready: false });
  assert.equal(
    unready.snoozeMarkDesiredForRow(li, "job.md#email-dan", 780, clock),
    null,
  );
});

test("Reading: apply inserts a copy-safe mark and removes it when neutral", () => {
  const plugin = makeSnoozeMarkPlugin();
  const li = fakeReadingLi(null);
  const desired = {
    time: "15:30",
    tone: "indigo",
    tooltip: "Snoozed until 15:30",
  };
  plugin.snoozeMarkStampRow(li, "job.md#email-dan");
  assert.equal(li.attrs["data-bob-snooze-key"], "job.md#email-dan");
  plugin.snoozeMarkApplyToRow(li, "job.md#email-dan", desired);
  assert.equal(li.children.length, 1);
  const mark = li.children[0];
  assert.equal(mark.attrs["data-bob-snooze-key"], "job.md#email-dan");
  assert.equal(mark.attrs["data-bob-snooze-time"], "15:30");
  assert.equal(mark.textContent, "");
  plugin.snoozeMarkApplyToRow(li, "job.md#email-dan", null);
  assert.equal(li.children.length, 0);
});

test("Reading: the sweep refreshes stamped rows without reopening the note", () => {
  const plugin = makeSnoozeMarkPlugin();
  const li = fakeReadingLi("job.md#email-dan");
  li.querySelectorAll = () => [];
  const realDocument = globalThis.document;
  globalThis.document = fakeReadingDoc([li]);
  try {
    plugin.sweepSnoozeMarksReading();
  } finally {
    if (realDocument === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = realDocument;
    }
  }
  assert.equal(li.children.length, 1);
  assert.equal(li.children[0].attrs["data-bob-snooze-time"], "15:30");
});

test("jump: rescan finds the row at its current line after a move", () => {
  const plugin = makeSnoozeMarkPlugin();
  const content = [
    "## Snoozed",
    "",
    "- **1900** [[job#^other]]",
    "- **1530** [[job#^email-dan]]",
  ].join("\n");
  assert.equal(plugin.snoozeMarksFindRowLine(content, "email-dan", 9), 3);
  assert.equal(plugin.snoozeMarksFindRowLine(content, "email-dan", null), 3);
  assert.equal(plugin.snoozeMarksFindRowLine(content, "missing", null), null);
  const moved = [
    "## Snoozed",
    "",
    "- **1530** [[job#^email-dan]]",
    "- **1900** [[job#^other]]",
  ].join("\n");
  assert.equal(plugin.snoozeMarksFindRowLine(moved, "email-dan", 3), 2);
});

test("jump: a vanished row teaches instead of jumping stale", async () => {
  const plugin = makeSnoozeMarkPlugin({ snapshot: { line: 8 } });
  TestNotice.messages = [];
  plugin.app = {
    vault: { cachedRead: () => Promise.resolve("## Snoozed\n") },
    workspace: { iterateAllLeaves: () => {} },
  };
  const result = await plugin.jumpSnoozedRow("job.md#email-dan");
  assert.equal(result, false);
  assert.ok(
    TestNotice.messages.some((message) =>
      String(message).includes("no longer in today's note"),
    ),
  );
});

test("toggle: flipping the snooze gate hides clocks and mirrors popouts", () => {
  const plugin = makeSnoozeMarkPlugin();
  const applied = [];
  plugin.applyMarkGateClass = (name, on) => applied.push([name, on]);
  const synced = [];
  plugin.registerMarkGatePopoutSync = (name, read) => synced.push([name, read()]);
  const commands = [];
  plugin.addCommand = (command) => commands.push(command);
  const extensions = [];
  plugin.registerEditorExtension = (extension) => extensions.push(extension);
  plugin.setupSnoozeMarks();
  assert.ok(plugin.snoozeMarksEnabled);
  assert.ok(commands.some((command) => command.id === "toggle-snooze-marks"));
  assert.ok(commands.some((command) => command.id === "go-to-snoozed-row"));
  assert.equal(extensions.length, 1);
  assert.deepEqual(applied[0], ["bob-snooze-marks-off", false]);
  assert.equal(synced[0][0], "bob-snooze-marks-off");
  assert.equal(synced[0][1], false);
  assert.equal(snoozeRanges(plugin, TASK_LINE).ranges.length, 1);
  const first = plugin.toggleSnoozeMarks();
  assert.equal(first, false);
  assert.equal(plugin.snoozeMarksEnabled, false);
  assert.deepEqual(applied[applied.length - 1], ["bob-snooze-marks-off", true]);
  assert.equal(snoozeRanges(plugin, TASK_LINE).ranges.length, 0);
  const second = plugin.toggleSnoozeMarks();
  assert.equal(second, true);
  assert.equal(plugin.snoozeMarksEnabled, true);
  assert.equal(snoozeRanges(plugin, TASK_LINE).ranges.length, 1);
  assert.ok(
    TestNotice.messages.some((message) => String(message).includes("Snooze marks")),
  );
});

test("styles.css keeps the snooze contract: slot, time, tones, gates", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "..", "plugins", "bob-ledger-tools", "styles.css"),
    "utf8",
  );
  for (const needle of [
    "--bob-snooze-mark-glyph",
    ".bob-snooze-mark {",
    ".bob-snooze-mark::after {",
    "attr(data-bob-snooze-time)",
    "font-variant-numeric: tabular-nums",
    ".bob-snooze-mark--asleep",
    ".bob-snooze-mark--due",
    ".bob-snooze-mark--blocked",
    ".bob-snooze-mark.is-pulsing",
    "@keyframes bob-snooze-mark-due",
    "body.bob-snooze-marks-off .bob-snooze-mark",
    "@media (prefers-reduced-motion: reduce)",
    "@media (forced-colors: active)",
    ".bob-daily-note-view .bob-snooze-mark",
    "line-height: 1",
    "vertical-align: -0.14em",
    "margin-inline: 0.06em 0.3em",
  ]) {
    assert.ok(css.includes(needle), "styles.css contains " + needle);
  }
});
