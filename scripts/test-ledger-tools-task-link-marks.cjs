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

test("TS16-TS17 vectors verbatim: code delimiters and comment text", () => {
  // TS16 `%%` in inline code is literal.
  {
    const spans = taskLinkMarkSpans("`%%` then [[bob#^fix]]");
    assert.deepEqual(spans.map(spanSummary), [{ at: 10, linkpath: "bob", blockId: "fix", kind: "wiki", alias: null }]);
  }
  // TS17 text after a closed comment is prose.
  {
    const spans = taskLinkMarkSpans("%% hidden %% [[bob#^fix]]");
    assert.deepEqual(spans.map(spanSummary), [{ at: 13, linkpath: "bob", blockId: "fix", kind: "wiki", alias: null }]);
  }
});

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

test("TC14-TC15 vectors: a closing fence matches its opener", () => {
  const link = "[[bob#^fix]]";
  // A four-backtick fence is not closed by a three-backtick line (the
  // landing audit's reproduction): both the three-backtick line and the
  // link inside stay fenced, and the four-backtick closer ends the fence.
  const lines = ["````markdown", "```", link, "````", link];
  assert.equal(eligible(lines, 2, AREA), false, "link inside a longer fence");
  assert.equal(eligible(lines, 1, AREA), false, "shorter run inside a longer fence");
  assert.equal(eligible(lines, 3, AREA), false, "the closing fence line");
  assert.equal(eligible(lines, 4, AREA), true, "prose after the real closer");
  // A longer closer closes a shorter opener.
  assert.equal(eligible(["```", link, "`````", link], 3, AREA), true);
  // Tilde fences: only a tilde run of enough length closes one, and a
  // backtick run is content.
  assert.equal(eligible(["~~~~", link, "~~~", link, "~~~~", link], 3, AREA), false);
  assert.equal(eligible(["~~~~", link, "~~~", link, "~~~~", link], 5, AREA), true);
  assert.equal(eligible(["~~~", link, "```", link, "~~~", link], 3, AREA), false);
  assert.equal(eligible(["~~~", link, "```", link, "~~~", link], 5, AREA), true);
  assert.equal(eligible(["```", link, "~~~", link, "```", link], 3, AREA), false);
  // Fence-like content: a closing line cannot carry an info string, and
  // trailing spaces are fine.
  assert.equal(eligible(["```", "```js", link, "```  ", link], 2, AREA), false);
  assert.equal(eligible(["```", "```js", link, "```  ", link], 4, AREA), true);
  // A backtick fence's info string cannot hold a backtick, so the line is
  // inline code and opens nothing.
  assert.equal(eligible(["```a`b```", link], 1, AREA), true);
  // An unclosed fence runs to the end of the document.
  assert.equal(eligible(["```", link, link], 2, AREA), false);
  // Indented fences (list-item nesting) open and close the same way.
  assert.equal(eligible(["- item", "  ```", "  " + link, "  ```", "  " + link], 2, AREA), false);
  assert.equal(eligible(["- item", "  ```", "  " + link, "  ```", "  " + link], 4, AREA), true);
  // Fence lines never touch comment state, and comments never open fences.
  assert.equal(eligible(["```", "%%", "```", link], 3, AREA), true);
  assert.equal(eligible(["%%", "```", "%%", link], 3, AREA), true);
  assert.equal(eligible(["%%", "```", link, "%%", link], 4, AREA), true);
});

test("TC16-TC17 vectors: code delimiters never open comments", () => {
  const link = "[[bob#^fix]]";
  // The landing audit's reproduction: `%%` in inline code is literal.
  assert.equal(eligible(["`%%` is a literal delimiter", link], 1, AREA), true);
  assert.equal(eligible(["``a %% b`` text", link], 1, AREA), true);
  // The same line's own links stay eligible and scan normally.
  assert.equal(
    taskLinkMarkSpans("`%%` then [[bob#^fix]]").map(spanSummary).length,
    1,
  );
  // A fenced `%%` run never changes later prose.
  assert.equal(eligible(["```", "%%", "```", link], 3, AREA), true);
  assert.equal(eligible(["```", "%% open", "```", "text", link], 4, AREA), true);
  // A real `%%` outside the fence still opens a comment.
  assert.equal(eligible(["```", "%% open", "```", "%% more", link], 4, AREA), false);
  // Backticks inside a comment are comment text, not code.
  assert.equal(eligible(["%% `", "still comment", "%%", link], 1, AREA), false);
  assert.equal(eligible(["%% `", "still comment", "%%", link], 3, AREA), true);
  // An unmatched backtick run is literal and does not hide a comment.
  assert.equal(eligible(["a ` b %%", "hidden " + link, "%%", link], 1, AREA), false);
  assert.equal(eligible(["a ` b %%", "hidden " + link, "%%", link], 3, AREA), true);
});

test("TC18 vector: real multi-line comments exclude only the comment", () => {
  const link = "[[bob#^fix]]";
  const lines = [
    "before " + link + " %% opens here " + link,
    "all hidden " + link,
    "closes %% after " + link,
    "plain " + link,
  ];
  const ctx = helpers.taskLinkMarkDocContext(lines, AREA);
  // The opener and closer lines stay eligible; only the middle is inert.
  assert.equal(ctx.eligible(0), true);
  assert.equal(ctx.eligible(1), false);
  assert.equal(ctx.inert(1), true);
  assert.equal(ctx.eligible(2), true);
  assert.equal(ctx.inert(2), false);
  assert.equal(ctx.eligible(3), true);
  // Span-level exclusions agree with the document: the link before the
  // opening delimiter rings, the one after it does not.
  const opener = taskLinkMarkSpans(lines[0], ctx.excluded(0));
  assert.deepEqual(opener.map((span) => span.at), [7]);
  // Text after the closing delimiter is prose again.
  const closer = taskLinkMarkSpans(lines[2], ctx.excluded(2));
  assert.deepEqual(closer.map((span) => span.at), [lines[2].indexOf("[[")]);
  // Scanned alone, the closing line's stray `%%` looks like an opener, which
  // is why the builder always passes the document's ranges.
  assert.equal(taskLinkMarkSpans(lines[2]).length, 0);
  // A comment closed on the same line as another opener keeps nesting out:
  // `%% a %% text %% b` leaves `text` visible and opens a new comment.
  const mixed = ["%% a %% " + link + " %% b", "hidden " + link, "%%", link];
  const mixedCtx = helpers.taskLinkMarkDocContext(mixed, AREA);
  assert.deepEqual(taskLinkMarkSpans(mixed[0], mixedCtx.excluded(0)).map((span) => span.at), [8]);
  assert.equal(mixedCtx.eligible(1), false);
  assert.equal(mixedCtx.eligible(3), true);
  // Comment text inside frontmatter never opens a comment for the body.
  assert.equal(eligible(["---", "note: '%%'", "---", link], 3, AREA), true);
});

test("TC19 vector: the managed row source fallback is anchored at the row start", () => {
  const managed = helpers.taskLinkMarkIsManagedRowText;
  for (const row of [
    "⛓️ **DEPENDS ON:** [[#^a]]",
    "⛓ **DEPENDS ON:** [[#^a]]",
    "- ⛓️ **DEPENDS ON:** [[#^a]]",
    "- [ ] **BLOCKS:** [[#^a]]",
    "  - 🪢 **LINKS:** [[#^a]]",
    "- **LINKED FROM:** [[#^a]]",
    "- **LINKS**: [[#^a]]",
    "- 🧩 **Sub-projects:** [[#^a]]",
    "🧩 **Sub-projects:** [[#^a]]",
    "- **DEPENDS ON** malformed [[#^a]]",
  ]) {
    assert.equal(managed(row), true, row);
    assert.equal(eligible([row], 0, AREA), false, row);
  }
  // Prose that merely mentions a label word is not a managed row.
  for (const prose of [
    "Links worth reading: [[bob#^fix]]",
    "- Links worth reading: [[bob#^fix]]",
    "- see the **LINKS** section and [[bob#^fix]]",
    "Review **LINKS** in [[bob#^fix]]",
    "**LINKS:** without a list marker or glyph [[bob#^fix]]",
    "- DEPENDS ON: plain [[bob#^fix]]",
    "- **links** lower case [[bob#^fix]]",
  ]) {
    assert.equal(managed(prose), false, prose);
    assert.equal(eligible([prose], 0, AREA), true, prose);
  }
  // The recognised `mentionIsEdgeLine` contract is unchanged: a bulleted
  // line holding a managed label is a (malformed) managed row.
  assert.equal(eligible(["- notes about **DEPENDS ON:** rows [[bob#^fix]]"], 0, AREA), false);
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
