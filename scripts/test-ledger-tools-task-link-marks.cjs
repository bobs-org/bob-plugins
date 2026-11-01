// Tests for bob-ledger-tools task link marks (bob-cli-f5 phase `core`).
// Covers the pure core only: the block-link scanner (TS), the
// document-level line eligibility (TC), the target-line parser and state
// model (pure TR1-TR10, TR14, TR17 by parsing), the tooltip model (TT),
// and the styles.css contract (TG). The `docs/task-link-marks.md`
// display contract in bob-cli is authoritative; the vectors below are
// that contract's conformance vectors verbatim (ledger_rows = skip,
// dim_closed_links = no).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");

const editorInfoField = { _taskLinkField: "info" };
const editorLivePreviewField = { _taskLinkField: "live" };

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
  widget: (spec) => ({ _decorationWidget: true, ...spec }),
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
  Module._load = function loadWithTaskLinkStubs(request) {
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
  taskLinkMarkSpans,
  taskLinkMarkIsLedgerTaskLinkLine,
  taskLinkMarkLineEligible,
  taskLinkMarkParseTaskLine,
  taskLinkMarkStateFromSymbol,
  taskLinkMarkTooltip,
} = helpers;

assert.ok(typeof taskLinkMarkSpans === "function", "taskLinkMarkSpans is exported");
assert.ok(typeof taskLinkMarkLineEligible === "function", "taskLinkMarkLineEligible is exported");
assert.ok(typeof taskLinkMarkParseTaskLine === "function", "taskLinkMarkParseTaskLine is exported");
assert.ok(typeof taskLinkMarkStateFromSymbol === "function", "taskLinkMarkStateFromSymbol is exported");
assert.ok(typeof taskLinkMarkTooltip === "function", "taskLinkMarkTooltip is exported");

function spanSummary(span) {
  return { at: span.at, linkpath: span.linkpath, blockId: span.blockId, kind: span.kind, alias: span.alias };
}

test("TS vectors verbatim: block-link scanner", () => {
  // TS1
  assert.deepEqual(
    taskLinkMarkSpans("See [[bob#^fix]] now").map(spanSummary),
    [{ at: 4, linkpath: "bob", blockId: "fix", kind: "wiki", alias: null }],
  );
  // TS2
  {
    const spans = taskLinkMarkSpans("See [[bob#^fix|the fix]]");
    assert.equal(spans.length, 1);
    assert.equal(spans[0].at, 4);
    assert.equal(spans[0].alias, "the fix");
  }
  // TS3
  {
    const spans = taskLinkMarkSpans("[[#^fix]]");
    assert.equal(spans.length, 1);
    assert.equal(spans[0].at, 0);
    assert.equal(spans[0].linkpath, "");
    assert.equal(spans[0].blockId, "fix");
  }
  // TS4
  assert.deepEqual(taskLinkMarkSpans("![[bob#^fix]]").map(spanSummary), []);
  // TS5
  {
    const spans = taskLinkMarkSpans("~~[[bob#^fix]]~~");
    assert.equal(spans.length, 1);
    assert.equal(spans[0].at, 0);
  }
  // TS6
  assert.deepEqual(taskLinkMarkSpans("`[[bob#^fix]]`").map(spanSummary), []);
  // TS7
  {
    const spans = taskLinkMarkSpans("[the fix](bob.md#^fix)");
    assert.equal(spans.length, 1);
    assert.equal(spans[0].at, 0);
    assert.equal(spans[0].linkpath, "bob.md");
    assert.equal(spans[0].blockId, "fix");
    assert.equal(spans[0].kind, "md");
  }
  // TS8
  {
    const spans = taskLinkMarkSpans("[x](<my note.md#^fix>)");
    assert.equal(spans.length, 1);
    assert.equal(spans[0].linkpath, "my note.md");
  }
  // TS9
  {
    const spans = taskLinkMarkSpans("[x](my%20note.md#^fix)");
    assert.equal(spans.length, 1);
    assert.equal(spans[0].linkpath, "my note.md");
  }
  // TS10
  {
    const spans = taskLinkMarkSpans("[x](bob.md#%5Efix)");
    assert.equal(spans.length, 1);
    assert.equal(spans[0].blockId, "fix");
  }
  // TS11
  assert.deepEqual(taskLinkMarkSpans("[[bob]] [[bob#Plan]] [x](https://e.com/a#^fix)").map(spanSummary), []);
  // TS12
  assert.deepEqual(taskLinkMarkSpans("![x](bob.md#^fix)").map(spanSummary), []);
  // TS13
  {
    const spans = taskLinkMarkSpans("[[bob#^fix]] and [[#^ship]]");
    assert.equal(spans.length, 2);
    assert.ok(spans[0].at < spans[1].at);
    assert.equal(spans[0].blockId, "fix");
    assert.equal(spans[1].blockId, "ship");
  }
  // TS14
  assert.deepEqual(taskLinkMarkSpans("[[bob#^not an id]]").map(spanSummary), []);
  // TS15
  assert.deepEqual(taskLinkMarkSpans("%%[[bob#^fix]]%%").map(spanSummary), []);
});

const AREA = "notes/bob.md";
const DAILY = "2026/20261101.md";

function eligible(lines, index, filePath) {
  return taskLinkMarkLineEligible(lines, index, filePath);
}

function dailyLedger(bodyLines) {
  return [
    "---",
    "title: daily",
    "---",
    "## Pomodoros",
    "- [ ] (0900-0930)",
    ...bodyLines,
  ];
}

test("TC vectors verbatim: document-level line eligibility", () => {
  // TC1 prose line in an area note.
  assert.equal(eligible(["See [[bob#^fix]] now"], 0, AREA), true);
  // TC2 inside a fenced code block.
  assert.equal(eligible(["```", "See [[bob#^fix]]", "```"], 1, AREA), false);
  // TC3 inside a multi-line %% … %% comment.
  assert.equal(eligible(["%%", "See [[bob#^fix]]", "%%"], 1, AREA), false);
  // TC4 frontmatter.
  assert.equal(eligible(["---", "title: x", "---", "See [[bob#^fix]]"], 1, AREA), false);
  // TC5 managed edge rows (all verdicts except not-a-line).
  for (const row of [
    "⛓️ **DEPENDS ON:** [[#^a]]",
    "- [ ] **BLOCKS:** [[#^a]]",
    "- [ ] **LINKS:** [[#^a]]",
    "- [ ] **LINKED FROM:** [[#^a]]",
    "- [ ] 🧩 **Sub-projects:** [[#^a]]",
  ]) {
    assert.equal(eligible([row], 0, AREA), false, row);
  }
  // TC6 a #task line whose title mentions a link.
  assert.equal(eligible(["- [ ] #task Fix with [[bob#^fix]] ^mine"], 0, AREA), true);
  // TC7 log entries.
  assert.equal(eligible(["- [ ] CANCEL LOG [[bob#^fix]] ^a"], 0, AREA), true);
  assert.equal(eligible(["- [ ] SCHEDULE LOG [[bob#^fix]] ^a"], 0, AREA), true);
  // TC8 dedicated ledger rows (skip branch): no ring.
  for (const body of [
    "[[bob#^fix]]",
    "🍅 [[bob#^fix]]",
    "~~[[bob#^fix]]~~",
    "🍅 ~~[[bob#^fix]]~~",
    "[[bob#^fix]] #",
  ]) {
    const lines = dailyLedger([`    - ${body}`]);
    assert.equal(eligible(lines, 5, DAILY), false, body);
    assert.equal(taskLinkMarkIsLedgerTaskLinkLine(lines, 5, DAILY), true, body);
  }
  // TC9 nested under a ledger Task Link.
  {
    const lines = dailyLedger(["    - [[bob#^fix]]", "        - see [[bob#^other]]"]);
    assert.equal(eligible(lines, 6, DAILY), true);
  }
  // TC10 ledger entry direct child with mixed prose.
  {
    const lines = dailyLedger(["    - pair with [[bob#^fix]]"]);
    assert.equal(eligible(lines, 5, DAILY), true);
  }
  // TC11 bullet in an area note.
  assert.equal(eligible(["- [[bob#^fix]]"], 0, AREA), true);
  // TC12 daily note outside ## Pomodoros.
  {
    const lines = ["## Notes", "See [[bob#^fix]]", "## Pomodoros", "- [ ] (0900-0930)"];
    assert.equal(eligible(lines, 1, DAILY), true);
  }
  // TC13 heading, blockquote, callout.
  assert.equal(eligible(["# See [[bob#^fix]]"], 0, AREA), true);
  assert.equal(eligible(["> See [[bob#^fix]]"], 0, AREA), true);
  assert.equal(eligible(["> [!note] See [[bob#^fix]]"], 0, AREA), true);
});

test("pure TR vectors verbatim: parser plus state model", () => {
  const stateOf = (line, statusType) => {
    const parsed = taskLinkMarkParseTaskLine(line);
    assert.ok(parsed && parsed.hasTask, `expected a task line: ${line}`);
    return taskLinkMarkStateFromSymbol(parsed.symbol, statusType);
  };
  // TR1-TR6 by symbol.
  assert.equal(stateOf("- [ ] #task Fix ^fix"), "ready");
  assert.equal(stateOf("- [*] #task Fix ^fix"), "next");
  assert.equal(stateOf("- [/] #task Fix ^fix"), "in-progress");
  assert.equal(stateOf("- [?] #task Fix ^fix"), "blocked");
  assert.equal(stateOf("- [x] #task Fix ^fix"), "done");
  assert.equal(stateOf("- [X] #task Fix ^fix"), "done");
  assert.equal(stateOf("- [-] #task Fix ^fix"), "cancelled");
  // TR7 fallback by Tasks status type.
  assert.equal(taskLinkMarkStateFromSymbol(">", "DONE"), "done");
  assert.equal(taskLinkMarkStateFromSymbol(">", "CANCELLED"), "cancelled");
  assert.equal(taskLinkMarkStateFromSymbol(">", "NON_TASK"), null);
  assert.equal(taskLinkMarkStateFromSymbol(">", "TODO"), "ready");
  // TR8 no #task.
  {
    const parsed = taskLinkMarkParseTaskLine("- [ ] Pack charger ^fix");
    assert.ok(parsed && !parsed.hasTask);
  }
  // TR9 plain bullet.
  {
    const parsed = taskLinkMarkParseTaskLine("- Plain bullet ^fix");
    assert.ok(!parsed || !parsed.hasTask);
  }
  // TR10 paragraph.
  {
    const parsed = taskLinkMarkParseTaskLine("Some text ^fix");
    assert.ok(!parsed || !parsed.hasTask);
  }
  // TR14 #task inside code is not a task.
  {
    const parsed = taskLinkMarkParseTaskLine("- [ ] `#task` in code ^fix");
    assert.ok(parsed && !parsed.hasTask);
  }
  // TR17 kind glyphs never change the state: ^prj, #ref, Event Tasks ring by status.
  assert.equal(stateOf("- [ ] #task Ship ^prj"), "ready");
  assert.equal(stateOf("- [/] #task #ref Read ^queue"), "in-progress");
});

test("TT vectors verbatim: tooltip model", () => {
  // TT1
  assert.equal(
    taskLinkMarkTooltip({ title: "- [/] #task Fix the parser crash ^fix", state: "in-progress", targetPath: "bob.md", sourcePath: "notes/a.md" }),
    "Fix the parser crash\nIn Progress · bob",
  );
  // TT2
  assert.equal(
    taskLinkMarkTooltip({ title: "- [ ] #task Fix ^fix", state: "ready", targetPath: "notes/a.md", sourcePath: "notes/a.md" }),
    "Fix\nReady · this note",
  );
  // TT3 basename without .md.
  assert.equal(
    taskLinkMarkTooltip({ title: "Do it", state: "done", targetPath: "prj/rap/now_rap_target.md", sourcePath: "notes/a.md" }),
    "Do it\nDone · now_rap_target",
  );
  // TT4 cleaned per dependencyCleanTaskText (links, tags, fields, ^id).
  {
    const label = taskLinkMarkTooltip({
      title: "- [*] #task See [[bob#^x|the plan]] [due:: 2026-01-01] ^fix",
      state: "next",
      targetPath: "bob.md",
      sourcePath: "notes/a.md",
    });
    assert.ok(!label.includes("[[") && !label.includes("^fix") && !label.includes("due::"));
    assert.ok(label.endsWith("Next · bob"));
  }
  // TT5 truncation at 80 characters.
  {
    const longTitle = `Fix ${"x".repeat(95)}`;
    const label = taskLinkMarkTooltip({ title: longTitle, state: "ready", targetPath: "bob.md", sourcePath: "notes/a.md" });
    const first = label.split("\n")[0];
    assert.equal(first.length, 80);
    assert.ok(first.endsWith("…"));
  }
  // TT6 unknown title drops the first line.
  assert.equal(
    taskLinkMarkTooltip({ title: "", state: "in-progress", targetPath: "bob.md", sourcePath: "notes/a.md" }),
    "In Progress · bob",
  );
  // TT7 stray :: becomes :.
  {
    const label = taskLinkMarkTooltip({ title: "a :: b", state: "ready", targetPath: "bob.md", sourcePath: "notes/a.md" });
    assert.ok(!label.includes("::"));
    assert.ok(label.includes("a : b"));
  }
});

test("TG vectors verbatim: styles.css ring family", () => {
  const cssPath = path.join(__dirname, "..", "plugins/bob-ledger-tools", "styles.css");
  const css = fs.readFileSync(cssPath, "utf8");
  // TG1 ready.
  assert.ok(css.includes("--bob-task-link-glyph-ready"), "ready glyph variable");
  assert.ok(css.includes("--bob-task-link-ready-color"), "ready ink hook");
  // TG2 next.
  assert.ok(css.includes("--bob-task-link-glyph-next"), "next glyph variable");
  assert.ok(css.includes("--task-status-next"), "next ink");
  // TG3 in-progress reuses the progress glyph.
  assert.ok(css.includes("--bob-progress-glyph"), "in-progress glyph");
  assert.ok(css.includes("--task-status-in-progress"), "in-progress ink");
  // TG4 blocked.
  assert.ok(css.includes("--bob-task-link-glyph-blocked"), "blocked glyph variable");
  assert.ok(css.includes("--task-status-blocked"), "blocked ink");
  // TG5 done.
  assert.ok(css.includes("--bob-task-link-glyph-done"), "done glyph variable");
  assert.ok(css.includes("--task-status-done"), "done ink");
  // TG6 cancelled.
  assert.ok(css.includes("--bob-task-link-glyph-cancelled"), "cancelled glyph variable");
  assert.ok(css.includes("--task-status-cancelled"), "cancelled ink");
  // Gate and host.
  assert.ok(css.includes("body:not(.bob-task-link-marks) .bob-task-link-mark"), "mark gate");
  assert.ok(css.includes(".bob-task-link-mark[data-state="), "per-state host");
});
