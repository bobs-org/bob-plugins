// Tests for bob-ledger-tools snooze row paint (SM-R).
// `docs/snooze-marks.md` in bob-cli is the authoritative display
// contract; the `rows` group in `tests/fixtures/snooze/marks.json`
// is its executable data. Every SM-R vector below runs verbatim
// through the shared display model, and the runtime proves the
// structural-H2, fence, duplicate-header, historical, and toggle
// guards.
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
        line: (spec) => ({ kind: "line", spec }),
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
  Module._load = function loadWithSnoozeRowPaintStubs(request) {
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
  snoozeRowPaintModelForVector,
  snoozeRowSummaryModelForVector,
  snoozeRowPaintCountdownText,
  snoozeRowPaintColonTime,
  snoozeRowPaintNowMinutes,
  snoozeRowPaintIgnoredReason,
  snoozeRowPaintWokeLabel,
  buildSnoozeRowChipElement,
  buildSnoozeHeadingChipElement,
  snoozeRowPaintPresentation,
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

test("row-paint fixture copy is byte-identical to the canonical bob-cli fixture", () => {
  const canonical = fs.readFileSync(path.join(CANONICAL_DIR, "marks.json"));
  const copy = fs.readFileSync(PLUGIN_FIXTURE_PATH);
  assert.ok(copy.equals(canonical), "plugin marks.json matches canonical marks.json");
});

test("canonical rows group has 18 unique SM-R vectors", () => {
  const fixture = readCanonicalMarks();
  assert.equal(fixture.schema_version, 1);
  const rows = fixture.groups.rows;
  assert.equal(rows.length, 18);
  const ids = rows.map((item) => item.id);
  assert.deepEqual(ids, [
    "SM-R01", "SM-R02", "SM-R03", "SM-R04", "SM-R05",
    "SM-R06", "SM-R07", "SM-R08", "SM-R09", "SM-R10",
    "SM-R11", "SM-R12", "SM-R13", "SM-R14", "SM-R15",
    "SM-R16", "SM-R17", "SM-R18",
  ]);
  for (const item of rows) {
    assert.deepEqual(item.runners, ["js"]);
  }
  const allIds = Object.values(fixture.groups).flat().map((row) => row.id);
  assert.equal(new Set(allIds).size, allIds.length);
});

test("every canonical SM-R paint vector runs verbatim through the shared display model", () => {
  const fixture = readPluginMarks();
  for (const item of fixture.groups.rows.filter((row) => row.mode === "paint")) {
    const actual = snoozeRowPaintModelForVector(item.input);
    assert.deepEqual(
      {
        live_countdown: actual.live_countdown,
        paint: actual.paint,
        status_text: actual.status_text,
        time_pill: actual.time_pill,
      },
      item.expected,
      item.id + " display model",
    );
  }
});

test("every canonical SM-R summary vector runs verbatim through the shared summary model", () => {
  const fixture = readPluginMarks();
  for (const item of fixture.groups.rows.filter((row) => row.mode === "summary")) {
    const actual = snoozeRowSummaryModelForVector(item.input);
    assert.deepEqual(
      { summary: actual.summary },
      item.expected,
      item.id + " heading summary",
    );
  }
});

test("countdown words never reflow the row", () => {
  assert.equal(snoozeRowPaintCountdownText(150), "in 2h 30m");
  assert.equal(snoozeRowPaintCountdownText(45), "in 45m");
  assert.equal(snoozeRowPaintCountdownText(60), "in 1h");
  assert.equal(snoozeRowPaintCountdownText(0), "in 0m");
  assert.equal(snoozeRowPaintCountdownText(-5), "in 0m");
});

test("time parsing is strict HHMM and HH:MM", () => {
  assert.equal(snoozeRowPaintColonTime("1530"), "15:30");
  assert.equal(snoozeRowPaintColonTime("2400"), null);
  assert.equal(snoozeRowPaintColonTime("1560"), null);
  assert.equal(snoozeRowPaintNowMinutes("13:00"), 780);
  assert.equal(snoozeRowPaintNowMinutes("24:00"), null);
});

test("ignored reasons are short, accurate, and never contain ::", () => {
  assert.equal(
    snoozeRowPaintIgnoredReason({ is_task: true, is_event: false, resolution: "found", status: " " }, "1530"),
    "Ready \u2014 won't wake",
  );
  assert.equal(
    snoozeRowPaintIgnoredReason({ is_task: true, is_event: false, resolution: "missing", status: "*" }, "1530"),
    "Missing \u2014 won't wake",
  );
  assert.equal(
    snoozeRowPaintIgnoredReason({ is_task: true, is_event: false, resolution: "found", status: "*" }, "1530"),
    "Duplicate \u2014 earliest wins",
  );
  for (const reason of [
    snoozeRowPaintIgnoredReason({ is_task: false }, "1530"),
    snoozeRowPaintIgnoredReason({ is_task: true, is_event: true, resolution: "found", status: "*" }, "1530"),
    snoozeRowPaintIgnoredReason({ is_task: true, is_event: false, resolution: "missing", status: "*" }, "1530"),
    snoozeRowPaintIgnoredReason({ is_task: true, is_event: false, resolution: "found", status: "*" }, "1530"),
  ]) {
    assert.ok(!String(reason).includes("::"), reason + " has no ::");
  }
});

test("history woke label parses strict HH:MM", () => {
  assert.equal(
    snoozeRowPaintWokeLabel("- ~~**1530** [[job#^email-dan]]~~ \u00b7 woke 15:32"),
    "15:32",
  );
  assert.equal(snoozeRowPaintWokeLabel("no woke here"), null);
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
  };
}

test("row and heading chips are copy-safe, labelled, and never contain ::", () => {
  const doc = fakeElementDoc();
  const chip = buildSnoozeRowChipElement(doc, {
    paint: "asleep",
    timePill: "15:30",
    statusText: "in 2h 30m",
  });
  assert.equal(chip.getAttribute("role"), "img");
  assert.equal(chip.getAttribute("aria-label"), "in 2h 30m");
  assert.equal(chip.textContent, "");
  assert.ok(!String(chip.getAttribute("aria-label")).includes("::"));
  const heading = buildSnoozeHeadingChipElement(doc, "2 asleep \u00b7 next 15:30");
  assert.equal(heading.getAttribute("role"), "img");
  assert.equal(heading.getAttribute("aria-label"), "2 asleep \u00b7 next 15:30");
  assert.ok(!String(heading.getAttribute("aria-label")).includes("::"));
  assert.equal(buildSnoozeRowChipElement(doc, { paint: "none" }), null);
  assert.equal(buildSnoozeHeadingChipElement(doc, ""), null);
});

test("classifier states map to the documented paint", () => {
  assert.equal(snoozeRowPaintPresentation("asleep", "15:30", null).paint, "asleep");
  assert.equal(snoozeRowPaintPresentation("due", "15:30", null).paint, "due");
  assert.equal(snoozeRowPaintPresentation("blocked", "15:30", null).paint, "blocked");
  assert.equal(snoozeRowPaintPresentation("woken", null, "15:32").paint, "history");
  assert.equal(snoozeRowPaintPresentation("previous_day", "15:30", null).paint, "historical");
  assert.equal(snoozeRowPaintPresentation("ready", null, null).statusText, "Ready \u2014 won't wake");
  assert.equal(snoozeRowPaintPresentation("duplicate", null, null).statusText, "Duplicate \u2014 earliest wins");
  assert.equal(snoozeRowPaintPresentation("bogus", null, null).paint, "none");
});

test("duplicate headers and non-daily paths stay neutral at runtime", () => {
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.app = { metadataCache: { getFirstLinkpathDest: () => null }, vault: {} };
  plugin.snoozeMarksEnabled = true;
  plugin.todayCache = { rank: new Map() };
  const duplicate = [
    "## Snoozed",
    "- **1530** [[job#^email-dan]]",
    "## Snoozed",
    "- **1600** [[job#^other]]",
  ].join("\n");
  assert.equal(
    plugin.snoozeRowPaintClassify("2026/20261105.md", duplicate, new Date("2026-11-05T13:00:00")),
    null,
  );
  assert.equal(
    plugin.snoozeRowPaintClassify("notes/job.md", "- **1530** [[job#^a]]", new Date("2026-11-05T13:00:00")),
    null,
  );
  plugin.snoozeMarksEnabled = false;
  assert.equal(
    plugin.snoozeRowPaintClassify(
      "2026/20261105.md",
      "## Snoozed\n- **1530** [[job#^email-dan]]",
      new Date("2026-11-05T13:00:00"),
    ),
    null,
  );
});
