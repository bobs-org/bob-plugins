// Tests for bob-ledger-tools task link marks, Live Preview phase
// (bob-cli-f5 phase `live_preview`). Covers the target resolver (live
// document, then the Tasks memo, then the metadata cache), the CM6
// decoration builder over a fake view, the widget DOM, the click rules,
// the session toggle, the coalesced refresh plumbing, the swap rule, the
// ring-last ordering pin, and the viewport-limited performance bound.
// The `docs/task-link-marks.md` display contract in bob-cli is
// authoritative: the TC, TR, and TT rows below are its conformance
// vectors (ledger_rows = skip, dim_closed_links = no). Every test injects
// its clock and fakes `app`; nothing reads the wall clock or the disk.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");

const editorInfoField = { _taskLinkField: "info" };
const editorLivePreviewField = { _taskLinkField: "live" };
const PlatformStub = { isDesktopApp: true };

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
  mark: (spec) => ({ _decorationMark: true, ...spec }),
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

let capturedPluginClass = null;
const StubViewPlugin = {
  fromClass(cls, options) {
    capturedPluginClass = cls;
    return { _viewPlugin: true, cls, options };
  },
};

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

  registerMarkdownCodeBlockProcessor() {}

  registerInterval(handle) {
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
  Module._load = function loadWithTaskLinkLiveStubs(request) {
    if (request === "obsidian") {
      return {
        MarkdownView: TestMarkdownView,
        Notice: TestNotice,
        Platform: PlatformStub,
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
      return { syntaxTree: () => ({ resolveInner: () => null }) };
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
  TASK_LINK_MARK_PAINTED_MAX,
  TASK_LINK_MARK_SWAP_MS,
  TaskLinkMarkWidget,
  buildTaskLinkMarkElement,
  ensureTaskLinkMarksRefresh,
  taskLinkMarkLiveDocModel,
  taskLinkMarkNewViewState,
  taskLinkMarkSwapFor,
} = helpers;

assert.ok(typeof TaskLinkMarkWidget === "function", "TaskLinkMarkWidget is exported");

// --- Fake DOM -----------------------------------------------------------

class FakeNode {
  constructor(tagName) {
    this.tagName = tagName;
    this.attrs = new Map();
    this.listeners = {};
    this.textContent = "";
  }

  setAttribute(name, value) {
    this.attrs.set(name, String(value));
  }

  getAttribute(name) {
    return this.attrs.has(name) ? this.attrs.get(name) : null;
  }

  hasAttribute(name) {
    return this.attrs.has(name);
  }

  addEventListener(type, handler) {
    (this.listeners[type] = this.listeners[type] || []).push(handler);
  }

  fire(type, event) {
    for (const handler of this.listeners[type] || []) {
      handler(event);
    }
  }

  get classes() {
    return (this.getAttribute("class") || "").split(/\s+/).filter(Boolean);
  }
}

class FakeBody {
  constructor() {
    this.set = new Set();
    this.classList = {
      add: (name) => this.set.add(name),
      remove: (name) => this.set.delete(name),
      contains: (name) => this.set.has(name),
    };
  }
}

function makeDocument() {
  return { createElement: (tag) => new FakeNode(tag), body: new FakeBody() };
}

// --- Fake vault: notes drive the metadata cache --------------------------

function stripInlineCode(line) {
  return line.replace(/`[^`]*`/g, "");
}

function cacheFromText(text) {
  const blocks = {};
  const listItems = [];
  const tags = [];
  text.split("\n").forEach((line, index) => {
    const item = line.match(/^\s*[-*+]\s+\[(.)\]/);
    if (/^\s*[-*+]\s/.test(line)) {
      listItems.push({ position: { start: { line: index } }, ...(item ? { task: item[1] } : {}) });
    }
    const id = line.match(/\s\^([A-Za-z0-9-]+)\s*$/);
    if (id) {
      blocks[id[1]] = { id: id[1], position: { start: { line: index } } };
    }
    if (/(^|\s)#task(?![\w/-])/.test(stripInlineCode(line))) {
      tags.push({ tag: "#task", position: { start: { line: index } } });
    }
  });
  return { blocks, listItems, tags };
}

function task(taskPath, id, symbol, description, type) {
  return {
    path: taskPath,
    blockLink: ` ^${id}`,
    status: { symbol, type: type || (symbol === "x" ? "DONE" : symbol === "-" ? "CANCELLED" : symbol === "/" ? "IN_PROGRESS" : "TODO") },
    description,
    originalMarkdown: `- [${symbol}] #task ${description} ^${id}`,
    lineNumber: 0,
  };
}

// `notes`: `{ "<path>": "<markdown>" }`. `tasks`: an array of Tasks rows,
// or undefined for "Tasks plugin absent".
function makeEnv({ notes = {}, tasks, leaves = [] } = {}) {
  const handlers = { meta: {}, vault: {} };
  const opens = [];
  const reads = { count: 0 };
  const noRead = () => {
    reads.count += 1;
    throw new Error("render must never read from disk");
  };
  const destFor = (linkpath) => {
    const wanted = String(linkpath).replace(/\.md$/i, "");
    for (const notePath of Object.keys(notes)) {
      const bare = notePath.replace(/\.md$/i, "");
      if (bare === wanted || bare.split("/").pop() === wanted) {
        return { path: notePath, extension: "md" };
      }
    }
    return null;
  };
  const spies = { dest: 0, getTasks: 0 };
  const app = {
    vault: {
      on: (name, fn) => {
        (handlers.vault[name] = handlers.vault[name] || []).push(fn);
        return { name };
      },
      getAbstractFileByPath: () => null,
      cachedRead: noRead,
      read: noRead,
      adapter: { read: noRead },
    },
    workspace: {
      on: () => ({}),
      offref: () => {},
      onLayoutReady: () => {},
      getActiveFile: () => null,
      getLeavesOfType: () => leaves,
      trigger: () => {},
      openLinkText: (...args) => {
        opens.push(args);
        return Promise.resolve();
      },
    },
    metadataCache: {
      on: (name, fn) => {
        (handlers.meta[name] = handlers.meta[name] || []).push(fn);
        return { name };
      },
      getCache: (notePath) => (notes[notePath] === undefined ? null : cacheFromText(notes[notePath])),
      getFirstLinkpathDest: (linkpath) => {
        spies.dest += 1;
        return destFor(linkpath);
      },
    },
    plugins: {
      plugins:
        tasks === undefined
          ? {}
          : {
              "obsidian-tasks-plugin": {
                getTasks: () => {
                  spies.getTasks += 1;
                  return tasks;
                },
              },
            },
    },
    commands: {},
  };
  const plugin = new LedgerToolsPlugin(app, {});
  const clock = { now: 1_000_000 };
  plugin.taskLinkMarksClock = () => clock.now;
  const timers = { queue: [], nextId: 1, cleared: [] };
  plugin.taskLinkMarksTimers = {
    set: (fn) => {
      const id = timers.nextId;
      timers.nextId += 1;
      timers.queue.push({ id, fn });
      return id;
    },
    clear: (id) => {
      timers.cleared.push(id);
      timers.queue = timers.queue.filter((entry) => entry.id !== id);
    },
  };
  plugin.setupTaskLinkMarks();
  return { app, plugin, handlers, opens, reads, spies, clock, timers, leaves };
}

function makeView(text, filePath, { live = true, ranges, posAtDOM } = {}) {
  const doc = { toString: () => text, length: text.length };
  const view = {
    state: {
      doc,
      field(field) {
        if (field === editorLivePreviewField) {
          return live;
        }
        if (field === editorInfoField) {
          return { file: filePath ? { path: filePath } : null };
        }
        throw new Error("unknown field");
      },
    },
    visibleRanges: ranges || [{ from: 0, to: text.length }],
    dispatched: [],
    focused: 0,
    dispatch(spec) {
      this.dispatched.push(spec);
    },
    posAtDOM: posAtDOM || (() => 0),
    focus() {
      this.focused += 1;
    },
  };
  return view;
}

function ringsOf(env, view, reason = "init") {
  const set = env.plugin.buildTaskLinkMarkDecorations(view, reason);
  return (set && set.adds ? set.adds : []).map((add) => {
    const widget = add.value.widget;
    return {
      from: add.from,
      to: add.to,
      side: add.value.side,
      kind: add.value._decorationWidget ? "widget" : "other",
      widget,
      state: widget.state,
      tooltip: widget.tooltip,
      swap: widget.swap,
      key: widget.key,
      linktext: widget.linktext,
    };
  });
}

function withDocument(fn) {
  const fake = makeDocument();
  const original = globalThis.document;
  globalThis.document = fake;
  try {
    return fn(fake);
  } finally {
    if (original === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = original;
    }
  }
}

const BOB = "bob.md";
const BOB_TEXT = [
  "- [ ] #task Fix the parser crash ^fix",
  "- [ ] #task Other ^other",
  "- [ ] #task Ship it ^ship",
].join("\n");
const SOURCE = "notes/area.md";
const DAILY = "2026/20261101.md";

function bobEnv(extra = {}) {
  return makeEnv({
    notes: { [BOB]: BOB_TEXT, [SOURCE]: "", [DAILY]: "", ...(extra.notes || {}) },
    tasks: extra.tasks === undefined ? [task(BOB, "fix", " ", "Fix the parser crash"), task(BOB, "other", " ", "Other"), task(BOB, "ship", " ", "Ship it")] : extra.tasks,
  });
}

// Line-level helper: rings that land on `lines[index]`.
function ringsOnLine(env, lines, index, filePath) {
  const text = lines.join("\n");
  const starts = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  const rings = ringsOf(env, makeView(text, filePath));
  return rings.filter((ring) => ring.from >= starts[index] && ring.from <= starts[index] + lines[index].length);
}

// --- TC vectors through the decoration builder -------------------------------

function dailyLedger(bodyLines) {
  return ["---", "title: daily", "---", "## Pomodoros", "- [ ] (0900-0930)", ...bodyLines];
}

test("TC vectors verbatim through the decoration builder", () => {
  const env = bobEnv();
  const count = (lines, index, filePath) => ringsOnLine(env, lines, index, filePath).length;
  // TC1 prose line in an area note.
  assert.equal(count(["See [[bob#^fix]] now"], 0, SOURCE), 1);
  // TC2 inside a fenced code block.
  assert.equal(count(["```", "See [[bob#^fix]]", "```"], 1, SOURCE), 0);
  // TC3 inside a multi-line %% … %% comment.
  assert.equal(count(["%%", "See [[bob#^fix]]", "%%"], 1, SOURCE), 0);
  // TC4 frontmatter.
  assert.equal(count(["---", "title: x [[bob#^fix]]", "---", "See"], 1, SOURCE), 0);
  // TC5 managed edge rows, malformed included.
  for (const row of [
    "⛓️ **DEPENDS ON:** [[bob#^fix]]",
    "- [ ] **BLOCKS:** [[bob#^fix]]",
    "- [ ] **LINKS:** [[bob#^fix]]",
    "- [ ] **LINKED FROM:** [[bob#^fix]]",
    "- [ ] 🧩 **Sub-projects:** [[bob#^fix]]",
  ]) {
    assert.equal(count([row], 0, SOURCE), 0, row);
  }
  // TC6 a #task line whose title mentions a link.
  assert.equal(count(["- [ ] #task Fix with [[bob#^fix]] ^mine"], 0, SOURCE), 1);
  // TC7 log entries.
  assert.equal(count(["- [ ] CANCEL LOG [[bob#^fix]] ^a"], 0, SOURCE), 1);
  assert.equal(count(["- [ ] SCHEDULE LOG [[bob#^fix]] ^a"], 0, SOURCE), 1);
  assert.equal(count(["- [ ] WORK LOG [[bob#^fix]] ^a"], 0, SOURCE), 1);
  assert.equal(count(["- [ ] ROTTEN LOG [[bob#^fix]] ^a"], 0, SOURCE), 1);
  // TC8 dedicated ledger rows (ledger_rows = skip): no ring.
  for (const body of ["[[bob#^fix]]", "🍅 [[bob#^fix]]", "~~[[bob#^fix]]~~", "🍅 ~~[[bob#^fix]]~~", "[[bob#^fix]] #"]) {
    assert.equal(count(dailyLedger([`    - ${body}`]), 5, DAILY), 0, body);
  }
  // TC9 nested under a ledger Task Link.
  assert.equal(count(dailyLedger(["    - [[bob#^fix]]", "        - see [[bob#^other]]"]), 6, DAILY), 1);
  // TC10 a ledger entry's direct child with mixed prose.
  assert.equal(count(dailyLedger(["    - pair with [[bob#^fix]]"]), 5, DAILY), 1);
  // TC11 `- [[bob#^fix]]` in an area note.
  assert.equal(count(["- [[bob#^fix]]"], 0, SOURCE), 1);
  // TC12 a daily note outside `## Pomodoros`.
  assert.equal(count(["## Notes", "See [[bob#^fix]]", "## Pomodoros", "- [ ] (0900-0930)"], 1, DAILY), 1);
  // TC13 heading, blockquote, callout.
  assert.equal(count(["# See [[bob#^fix]]"], 0, SOURCE), 1);
  assert.equal(count(["> See [[bob#^fix]]"], 0, SOURCE), 1);
  assert.equal(count(["> [!note] See [[bob#^fix]]"], 0, SOURCE), 1);
});

test("TC14-TC18 vectors through the decoration builder (bob-cli-f5)", () => {
  const env = bobEnv();
  const count = (lines, index, filePath) => ringsOnLine(env, lines, index, filePath).length;
  const link = "[[bob#^fix]]";
  // A four-backtick fence is not closed by a three-backtick line.
  const nested = ["````markdown", "```", link, "````", link];
  assert.equal(count(nested, 2, SOURCE), 0, "link inside the longer fence");
  assert.equal(count(nested, 4, SOURCE), 1, "prose after the real closer");
  // Tilde fences, shorter marker runs, and fence-like content.
  assert.equal(count(["~~~~", link, "~~~", link, "~~~~", link], 3, SOURCE), 0);
  assert.equal(count(["~~~~", link, "~~~", link, "~~~~", link], 5, SOURCE), 1);
  assert.equal(count(["```", "```js", link, "```", link], 2, SOURCE), 0);
  assert.equal(count(["```", "```js", link, "```", link], 4, SOURCE), 1);
  // `%%` in inline code is a literal delimiter, not a comment opener.
  assert.equal(count(["`%%` is a literal delimiter", link], 1, SOURCE), 1);
  // `%%` inside a fenced block does not change later prose either.
  assert.equal(count(["```", "%%", "```", link], 3, SOURCE), 1);
  // A real multi-line comment hides its middle, and the text on its opening
  // and closing lines outside the comment keeps its ring.
  const comment = [link + " %% " + link, link, link + " %% " + link, link];
  assert.deepEqual(
    ringsOnLine(env, comment, 0, SOURCE).map((ring) => ring.from),
    [0],
    "the link before the opener rings, the one inside does not",
  );
  assert.equal(count(comment, 1, SOURCE), 0, "a line wholly inside the comment");
  assert.deepEqual(
    ringsOnLine(env, comment, 2, SOURCE).map((ring) => ring.from - (comment[0].length + 1 + comment[1].length + 1)),
    [comment[2].lastIndexOf("[[")],
    "the link before the closing delimiter is comment text; the one after rings",
  );
  const closing = ["%% hidden", "after %% " + link, link];
  assert.equal(count(closing, 1, SOURCE), 1, "text after the closing delimiter is prose");
  assert.equal(count(closing, 2, SOURCE), 1);
  // TC19: ordinary prose that begins with a managed-label word keeps its
  // ring, while the actual managed rows stay unmarked.
  for (const prose of [
    "Links worth reading: " + link,
    "- Links worth reading: " + link,
    "Review **LINKS** in " + link,
    "**LINKS:** no list marker or glyph " + link,
    "- Blocks of time: " + link,
  ]) {
    assert.equal(count([prose], 0, SOURCE), 1, prose);
  }
  for (const row of [
    "- ⛓️ **DEPENDS ON:** " + link,
    "- **BLOCKS:** " + link,
    "  - 🪢 **LINKS:** " + link,
    "- **LINKED FROM:** " + link,
    "- 🧩 **Sub-projects:** " + link,
    "- **LINKS** malformed " + link,
  ]) {
    assert.equal(count([row], 0, SOURCE), 0, row);
  }
  // Block ids inside a fence or comment never feed the live line map.
  const live = helpers.taskLinkMarkLiveDocModel(["```", "- [ ] #task Hidden ^fix", "```"].join("\n"), SOURCE);
  assert.equal(live.blocks.has("fix"), false);
});

test("the builder honors the other eligibility rules", () => {
  const env = bobEnv();
  // Embeds, headings, notes, and plain checklist links get nothing.
  const text = "![[bob#^fix]] [[bob#Plan]] [[bob]] `[[bob#^fix]]` [x](https://e.com/a#^fix) [[bob#^missing]]";
  assert.deepEqual(ringsOf(env, makeView(text, SOURCE)), []);
  // A struck link puts the ring before the opening strike.
  const struck = ringsOf(env, makeView("~~[[bob#^fix]]~~ done", SOURCE));
  assert.equal(struck.length, 1);
  assert.equal(struck[0].from, 0);
  // Markdown links resolve, with the decoded linkpath as link text.
  const markdown = ringsOf(env, makeView("[the fix](bob.md#^fix) and [x](<bob.md#^ship>)", SOURCE));
  assert.deepEqual(markdown.map((ring) => ring.linktext), ["bob.md#^fix", "bob.md#^ship"]);
  // Two links, two rings in document order.
  const two = ringsOf(env, makeView("[[bob#^fix]] and [[bob#^ship]]", SOURCE));
  assert.deepEqual(two.map((ring) => ring.from), [0, 17]);
  // Source mode and fileless editors draw nothing.
  assert.deepEqual(ringsOf(env, makeView("[[bob#^fix]]", SOURCE, { live: false })), []);
  assert.deepEqual(ringsOf(env, makeView("[[bob#^fix]]", null)), []);
});

test("dim_closed_links = no: a closed link gets only the ring widget", () => {
  const env = bobEnv({ tasks: [task(BOB, "fix", "x", "Fix"), task(BOB, "other", "-", "Other")] });
  const rings = ringsOf(env, makeView("[[bob#^fix]] [[bob#^other]]", SOURCE));
  assert.deepEqual(rings.map((ring) => ring.state), ["done", "cancelled"]);
  assert.ok(rings.every((ring) => ring.kind === "widget"));
});

// --- TR vectors through each data source ----------------------------------

const LINK = "See [[bob#^fix]]";

function stateVia(env, source = SOURCE, text = LINK) {
  const rings = ringsOf(env, makeView(text, source));
  assert.ok(rings.length <= 1);
  return rings.length === 1 ? rings[0].state : null;
}

test("TR1-TR6 by checkbox symbol through the Tasks memo", () => {
  const expected = { " ": "ready", "*": "next", "/": "in-progress", "?": "blocked", x: "done", X: "done", "-": "cancelled" };
  for (const [symbol, state] of Object.entries(expected)) {
    const env = makeEnv({ notes: { [BOB]: "", [SOURCE]: "" }, tasks: [task(BOB, "fix", symbol, "Fix")] });
    assert.equal(stateVia(env), state, `memo [${symbol}]`);
  }
});

test("TR1-TR6 by checkbox symbol through the metadata cache", () => {
  const expected = { " ": "ready", "*": "next", "/": "in-progress", "?": "blocked", x: "done", "-": "cancelled" };
  for (const [symbol, state] of Object.entries(expected)) {
    const env = makeEnv({ notes: { [BOB]: `- [${symbol}] #task Fix ^fix`, [SOURCE]: "" } });
    assert.equal(stateVia(env), state, `cache [${symbol}]`);
  }
});

test("TR7 falls back to the Tasks status type", () => {
  const byType = { DONE: "done", CANCELLED: "cancelled", NON_TASK: null, TODO: "ready", IN_PROGRESS: "ready" };
  for (const [type, state] of Object.entries(byType)) {
    const env = makeEnv({ notes: { [BOB]: "", [SOURCE]: "" }, tasks: [task(BOB, "fix", ">", "Fix", type)] });
    assert.equal(stateVia(env), state, `memo [>] ${type}`);
  }
  // A custom symbol in the cache or live doc looks its type up in the memo.
  const env = makeEnv({
    notes: { [BOB]: "- [>] #task Fix ^fix", [SOURCE]: "" },
    tasks: [task(BOB, "elsewhere", ">", "Elsewhere", "DONE")],
  });
  assert.equal(stateVia(env), "done");
});

test("TR8-TR12 and TR14 give no ring, through every source", () => {
  const cases = [
    ["TR8 no #task", "- [ ] Pack charger ^fix"],
    ["TR9 plain bullet", "- Plain bullet ^fix"],
    ["TR10 paragraph", "Some text ^fix"],
    ["TR14 #task in code", "- [ ] `#task` in code ^fix"],
    ["TR11 id absent", "- [ ] #task Fix ^elsewhere"],
  ];
  for (const [label, line] of cases) {
    const env = makeEnv({ notes: { [BOB]: line, [SOURCE]: "" } });
    assert.equal(stateVia(env), null, `cache ${label}`);
    // The live document is authoritative for a same-note target.
    const live = makeEnv({ notes: { [SOURCE]: "" } });
    assert.equal(stateVia(live, SOURCE, `${line}\n[[#^fix]]`), null, `live ${label}`);
  }
  // TR14 through the memo: the row's own markdown has no #task token.
  const memoRow = { ...task(BOB, "fix", " ", "in code"), originalMarkdown: "- [ ] `#task` in code ^fix" };
  assert.equal(stateVia(makeEnv({ notes: { [BOB]: "", [SOURCE]: "" }, tasks: [memoRow] })), null);
  // TR12 an unresolved note.
  assert.equal(stateVia(makeEnv({ notes: { [SOURCE]: "" }, tasks: [] })), null);
});

test("TR13 a duplicate id is neutral in the memo, the live doc, and nowhere guessed", () => {
  const memo = makeEnv({
    notes: { [BOB]: "", [SOURCE]: "" },
    tasks: [task(BOB, "fix", " ", "First"), task(BOB, "fix", "x", "Second")],
  });
  assert.equal(stateVia(memo), null);
  assert.ok(memo.plugin.dependencyTasksDuplicateKeys().has(`${BOB}\u0000fix`));
  // The index keeps its first-row slot and return shape.
  const index = memo.plugin.dependencyTasksIndex();
  assert.ok(index instanceof Map);
  assert.equal(index.get(`${BOB}\u0000fix`).description, "First");
  // A live document with the id on two lines.
  const live = makeEnv({ notes: { [SOURCE]: "" } });
  const text = "- [ ] #task One ^fix\n- [ ] #task Two ^fix\n[[#^fix]]";
  assert.equal(stateVia(live, SOURCE, text), null);
  // Fenced duplicates are not blocks, so the single real line rings.
  const fenced = "- [ ] #task One ^fix\n```\n- [ ] #task Two ^fix\n```\n[[#^fix]]";
  assert.equal(stateVia(live, SOURCE, fenced), "ready");
});

test("TR15 same-note live document shows an unsaved status change on the same frame", () => {
  // The cache and memo still say `[ ]`; the editor document says `[x]`.
  const env = makeEnv({
    notes: { [SOURCE]: "- [ ] #task Fix ^fix" },
    tasks: [task(SOURCE, "fix", " ", "Fix")],
  });
  assert.equal(stateVia(env, SOURCE, "- [x] #task Fix ^fix\n[[#^fix]]"), "done");
  assert.equal(stateVia(env, SOURCE, "- [ ] #task Fix ^fix\n[[#^fix]]"), "ready");
  // Also by an explicit self-referencing linkpath.
  assert.equal(stateVia(env, SOURCE, "- [/] #task Fix ^fix\n[[area#^fix]]"), "in-progress");
});

test("TR16 falls back to the metadata cache without a title", () => {
  const absent = makeEnv({ notes: { [BOB]: "- [/] #task Fix ^fix", [SOURCE]: "" } });
  const rings = ringsOf(absent, makeView(LINK, SOURCE));
  assert.equal(rings.length, 1);
  assert.equal(rings[0].state, "in-progress");
  assert.equal(rings[0].tooltip, "In Progress · bob");
  // Tasks present but the key is not indexed yet: same fallback.
  const notYet = makeEnv({ notes: { [BOB]: "- [/] #task Fix ^fix", [SOURCE]: "" }, tasks: [] });
  assert.equal(ringsOf(notYet, makeView(LINK, SOURCE))[0].tooltip, "In Progress · bob");
});

test("TR17 ^prj, #ref, and Event Tasks ring by status", () => {
  const env = makeEnv({
    notes: { [BOB]: "", [SOURCE]: "" },
    tasks: [task(BOB, "prj", " ", "Ship the project"), task(BOB, "queue", "/", "#ref Read the paper"), task(BOB, "evt", "x", "Standup")],
  });
  const rings = ringsOf(env, makeView("[[bob#^prj]] [[bob#^queue]] [[bob#^evt]]", SOURCE));
  assert.deepEqual(rings.map((ring) => ring.state), ["ready", "in-progress", "done"]);
});

test("source precedence: live doc, then Tasks memo, then metadata cache", () => {
  // Memo beats cache when both resolve the key.
  const both = makeEnv({
    notes: { [BOB]: "- [ ] #task Fix ^fix", [SOURCE]: "" },
    tasks: [task(BOB, "fix", "*", "Fix")],
  });
  assert.equal(stateVia(both), "next");
  // A memo miss falls through to the cache.
  const miss = makeEnv({ notes: { [BOB]: "- [?] #task Fix ^fix", [SOURCE]: "" }, tasks: [task(BOB, "other", " ", "Other")] });
  assert.equal(stateVia(miss), "blocked");
  // The live doc beats both for a same-note target.
  const live = makeEnv({ notes: { [SOURCE]: "- [ ] #task Fix ^fix" }, tasks: [task(SOURCE, "fix", "*", "Fix")] });
  assert.equal(stateVia(live, SOURCE, "- [-] #task Fix ^fix\n[[#^fix]]"), "cancelled");
  // A link to another file never reads the live doc.
  assert.equal(stateVia(both, SOURCE, "- [x] #task Fix ^fix\n[[bob#^fix]]"), "next");
});

test("render never reads from disk, and resolves each unique link once per build", () => {
  const env = bobEnv();
  const lines = [];
  for (let index = 0; index < 40; index += 1) {
    lines.push("[[bob#^fix]] and [[bob#^ship]] and [[bob#^fix]]");
  }
  const before = env.spies.dest;
  const rings = ringsOf(env, makeView(lines.join("\n"), SOURCE));
  assert.equal(rings.length, 120);
  assert.equal(env.spies.dest - before, 2, "two unique (linkpath, id) pairs, two path resolutions");
  assert.equal(env.reads.count, 0);
});

// --- TT through the widget DOM ---------------------------------------------

function domOf(ring) {
  return withDocument(() => ring.widget.toDOM(makeView("", SOURCE)));
}

test("TT vectors through the widget DOM", () => {
  const env = makeEnv({
    notes: { [BOB]: "", [SOURCE]: "", "prj/rap/now_rap_target.md": "" },
    tasks: [
      task(BOB, "fix", "/", "Fix the parser crash"),
      task(SOURCE, "mine", " ", "Mine"),
      task("prj/rap/now_rap_target.md", "t", "x", "Target"),
      { ...task(BOB, "rich", " ", "x"), originalMarkdown: "- [ ] #task See [[bob#^x|the plan]] [due:: 2026-01-01] ^rich", description: "See [[bob#^x|the plan]] [due:: 2026-01-01]" },
      task(BOB, "long", " ", `Fix ${"x".repeat(95)}`),
      task(BOB, "colon", " ", "a :: b"),
    ],
  });
  const ring = (text, source = SOURCE) => ringsOf(env, makeView(text, source))[0];
  // TT1 another note's task.
  assert.equal(ring("[[bob#^fix]]").tooltip, "Fix the parser crash\nIn Progress · bob");
  // TT2 same-note target.
  assert.equal(ring("[[#^mine]]\n- [ ] #task Mine ^mine").tooltip, "Mine\nReady · this note");
  // TT3 nested path shows the basename.
  assert.equal(ring("[[now_rap_target#^t]]").tooltip, "Target\nDone · now_rap_target");
  // TT4 cleaned.
  const cleaned = ring("[[bob#^rich]]").tooltip;
  assert.ok(!/\[\[|\^rich|due::/.test(cleaned), cleaned);
  assert.ok(cleaned.endsWith("Ready · bob"));
  // TT5 95-character title.
  const longFirst = ring("[[bob#^long]]").tooltip.split("\n")[0];
  assert.equal(longFirst.length, 80);
  assert.ok(longFirst.endsWith("…"));
  // TT7 no stray `::`.
  assert.ok(!ring("[[bob#^colon]]").tooltip.includes("::"));
  // The DOM carries the tooltip as aria-label, never as title.
  const dom = domOf(ring("[[bob#^fix]]"));
  assert.equal(dom.getAttribute("aria-label"), "Fix the parser crash\nIn Progress · bob");
  assert.equal(dom.getAttribute("role"), "img");
  assert.equal(dom.getAttribute("data-tooltip-position"), "top");
  assert.equal(dom.getAttribute("data-state"), "in-progress");
  assert.equal(dom.hasAttribute("title"), false);
  assert.deepEqual(dom.classes, ["bob-task-link-mark"]);
  assert.equal(dom.textContent, "");
  // TT6 title unknown.
  const bare = makeEnv({ notes: { [BOB]: "- [/] #task Fix ^fix", [SOURCE]: "" } });
  assert.equal(domOf(ringsOf(bare, makeView(LINK, SOURCE))[0]).getAttribute("aria-label"), "In Progress · bob");
});

test("buildTaskLinkMarkElement is a listener-free host and rejects bad states", () => {
  const fake = makeDocument();
  const swapped = buildTaskLinkMarkElement(fake, { state: "done", tooltip: "x :: y", swap: true });
  assert.deepEqual(swapped.classes, ["bob-task-link-mark", "bob-task-link-mark-swap"]);
  assert.equal(swapped.getAttribute("aria-label"), "x : y");
  assert.deepEqual(swapped.listeners, {});
  assert.equal(buildTaskLinkMarkElement(fake, { state: "wat" }), null);
  assert.equal(buildTaskLinkMarkElement(null, { state: "done" }), null);
  assert.equal(buildTaskLinkMarkElement(fake, { state: "ready" }).getAttribute("aria-label"), "Ready");
});

// --- Interaction -----------------------------------------------------------

function mouse(over = {}) {
  const event = { button: 0, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...over };
  return event;
}

test("plain click places the caret before the link and never navigates", () => {
  const env = bobEnv();
  const view = makeView("Intro\nSee [[bob#^fix]]", SOURCE, { posAtDOM: () => 10 });
  const ring = ringsOf(env, view)[0];
  const dom = withDocument(() => ring.widget.toDOM(view));
  const event = mouse();
  dom.fire("mousedown", event);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(view.dispatched, [{ selection: { anchor: 10 } }]);
  assert.equal(view.focused, 1);
  assert.deepEqual(env.opens, []);
});

test("Mod+click opens the link exactly like Mod+clicking the link text", () => {
  const env = bobEnv();
  const view = makeView("See [[bob#^fix]]", SOURCE);
  const ring = ringsOf(env, view)[0];
  const dom = withDocument(() => ring.widget.toDOM(view));
  // Ctrl elsewhere.
  PlatformStub.isMacOS = false;
  dom.fire("mousedown", mouse({ ctrlKey: true }));
  assert.deepEqual(env.opens, [["bob#^fix", SOURCE, "tab"]]);
  assert.deepEqual(view.dispatched, []);
  // Cmd on macOS; Ctrl alone no longer counts.
  PlatformStub.isMacOS = true;
  try {
    dom.fire("mousedown", mouse({ ctrlKey: true }));
    assert.equal(env.opens.length, 1);
    dom.fire("mousedown", mouse({ metaKey: true }));
    assert.equal(env.opens.length, 2);
  } finally {
    delete PlatformStub.isMacOS;
  }
  // Only the primary button acts.
  dom.fire("mousedown", mouse({ button: 2, ctrlKey: true }));
  assert.equal(env.opens.length, 2);
  // A same-note link keeps its empty linkpath.
  const same = makeEnv({ notes: { [SOURCE]: "- [ ] #task Fix ^fix" } });
  const sameView = makeView("- [ ] #task Fix ^fix\n[[#^fix]]", SOURCE);
  const sameDom = withDocument(() => ringsOf(same, sameView)[0].widget.toDOM(sameView));
  sameDom.fire("mousedown", mouse({ ctrlKey: true }));
  assert.deepEqual(same.opens, [["#^fix", SOURCE, "tab"]]);
});

// --- Widget identity ---------------------------------------------------------

test("widget eq compares key, state, tooltip, swap, and the click target", () => {
  const base = { key: "k", state: "ready", tooltip: "t", swap: false, linktext: "bob#^fix", sourcePath: SOURCE };
  const widget = new TaskLinkMarkWidget(base);
  assert.equal(widget.eq(new TaskLinkMarkWidget({ ...base })), true);
  for (const change of [{ key: "k2" }, { state: "done" }, { tooltip: "u" }, { swap: true }, { linktext: "x#^fix" }, { sourcePath: "other.md" }]) {
    assert.equal(widget.eq(new TaskLinkMarkWidget({ ...base, ...change })), false, JSON.stringify(change));
  }
  assert.equal(widget.eq({}), false);
});

// --- Ordering pin ---------------------------------------------------------------

test("the ring is always last at a shared offset", () => {
  const env = bobEnv();
  const rings = ringsOf(env, makeView("[[bob#^fix]] and [[bob#^ship]]", SOURCE));
  assert.ok(rings.every((ring) => ring.side === 0));
  // The builder output is sorted by position for RangeSetBuilder.
  assert.deepEqual(rings.map((ring) => ring.from), rings.map((ring) => ring.from).slice().sort((a, b) => a - b));
  // Every other widget family that can share a link's start offset sorts
  // before side 0 (Today -1, In Progress -1, ledger type prefix -2), and
  // the families anchored after a link (side 1) sort after it.
  const src = path.join(__dirname, "..", "plugins/bob-ledger-tools/src");
  const sideOf = (file) => {
    const match = fs.readFileSync(path.join(src, file), "utf8").match(/side:\s*(-?\d+)/g) || [];
    return match.map((entry) => Number(entry.replace(/side:\s*/, "")));
  };
  for (const file of ["275-plugin-today-marks.js", "268-plugin-progress-marks.js", "268-plugin-ledger-type-marks.js"]) {
    assert.ok(sideOf(file).length > 0 && sideOf(file).every((side) => side < 0), file);
  }
  for (const file of ["271-plugin-unblocked-glyph.js", "273-plugin-pomodoro-home-chips.js"]) {
    assert.ok(sideOf(file).length > 0 && sideOf(file).every((side) => side > 0), file);
  }
});

// --- Toggle ----------------------------------------------------------------------

test("setup registers the toggle command, the gate, the extension, and the listeners", () => {
  withDocument((fake) => {
    const env = bobEnv();
    assert.equal(env.plugin.taskLinkMarksEnabled, true);
    assert.ok(fake.body.set.has("bob-task-link-marks"));
    const command = env.plugin.commands.find((entry) => entry.id === "toggle-task-link-marks");
    assert.equal(command.name, "Toggle task link marks");
    assert.equal(env.plugin.editorExtensions.length, 1);
    assert.deepEqual(Object.keys(env.handlers.meta).sort(), ["changed", "resolved"]);
    assert.deepEqual(Object.keys(env.handlers.vault).sort(), ["delete", "rename"]);
  });
});

test("the toggle flips the flag and gate, clears the rings, and notices", () => {
  withDocument((fake) => {
    TestNotice.messages.length = 0;
    const env = bobEnv();
    const view = makeView("See [[bob#^fix]]", SOURCE);
    env.plugin.taskLinkMarkViews.add(view);
    assert.equal(ringsOf(env, view).length, 1);
    const command = env.plugin.commands.find((entry) => entry.id === "toggle-task-link-marks");
    command.callback();
    assert.equal(env.plugin.taskLinkMarksEnabled, false);
    assert.equal(fake.body.set.has("bob-task-link-marks"), false);
    assert.deepEqual(TestNotice.messages, ["Task link marks off"]);
    assert.deepEqual(ringsOf(env, view), []);
    // Editors are told to rebuild.
    const refresh = ensureTaskLinkMarksRefresh();
    assert.ok(view.dispatched.some((spec) => spec.effects && spec.effects.is(refresh)));
    command.callback();
    assert.equal(env.plugin.taskLinkMarksEnabled, true);
    assert.equal(fake.body.set.has("bob-task-link-marks"), true);
    assert.deepEqual(TestNotice.messages, ["Task link marks off", "Task link marks on"]);
    assert.equal(ringsOf(env, view).length, 1);
  });
});

test("the toggle also mirrors the gate into popout documents", () => {
  withDocument(() => {
    const env = bobEnv();
    const popout = makeDocument();
    env.plugin.applyMarkGateClassToPopout("bob-task-link-marks", true, null, { document: popout });
    assert.ok(popout.body.set.has("bob-task-link-marks"));
    env.plugin.toggleTaskLinkMarks();
    assert.equal(popout.body.set.has("bob-task-link-marks"), false);
    env.plugin.toggleTaskLinkMarks();
    assert.equal(popout.body.set.has("bob-task-link-marks"), true);
  });
});

// --- Refresh plumbing ------------------------------------------------------------

test("every trigger schedules one coalesced refresh that rebuilds all editors", () => {
  const env = bobEnv();
  const swept = [];
  env.plugin.sweepTaskLinkMarksReading = () => swept.push("sweep");
  const view = makeView("See [[bob#^fix]]", SOURCE);
  env.plugin.taskLinkMarkViews.add(view);
  const refresh = ensureTaskLinkMarksRefresh();
  // metadataCache changed / resolved and vault rename / delete.
  for (const fire of [
    () => env.handlers.meta.changed[0]({ path: BOB }),
    () => env.handlers.meta.resolved[0](),
    () => env.handlers.vault.rename[0]({ path: BOB }, "old.md"),
    () => env.handlers.vault.delete[0]({ path: BOB }),
  ]) {
    fire();
  }
  assert.equal(env.timers.queue.length, 1, "four triggers, one pending timer");
  env.timers.queue.shift().fn();
  assert.equal(view.dispatched.length, 1);
  assert.ok(view.dispatched[0].effects.is(refresh));
  assert.deepEqual(swept, ["sweep"]);
  assert.equal(env.plugin.taskLinkMarksTimer, null);
  // The live-widget fan-out is a trigger too, and re-arms after a run.
  for (const name of [
    "scheduleReadyRefresh", "scheduleDashboardLaneRefresh", "scheduleFreshnessStatusBar", "scheduleFreshnessMarksRefresh",
    "scheduleReviewChipsRefresh", "scheduleCrowdedRefresh", "scheduleReadyNotesRefresh", "scheduleNoteReadyHeadingsRefresh",
    "scheduleDependencyChipsRefresh", "scheduleProgressMarksRefresh", "scheduleUnblockedGlyphRefresh", "scheduleTodayMarksRefresh",
  ]) {
    env.plugin[name] = () => {};
  }
  env.plugin.scheduleLiveWidgetRefresh();
  assert.equal(env.timers.queue.length, 1);
  env.plugin.cancelTaskLinkMarksRefresh();
  assert.equal(env.timers.queue.length, 0);
  assert.equal(env.plugin.taskLinkMarksTimer, null);
});

test("the refresh reaches leaf editors the extension has not tracked", () => {
  const leafView = makeView("", SOURCE);
  const env = makeEnv({ notes: { [BOB]: BOB_TEXT, [SOURCE]: "" }, leaves: [{ view: { editor: { cm: leafView } } }] });
  env.plugin.runTaskLinkMarksRefresh();
  assert.equal(leafView.dispatched.length, 1);
});

test("setup hands off to the Reading-view phase through guarded hooks", () => {
  const calls = [];
  const original = LedgerToolsPlugin.prototype.setupTaskLinkMarksReading;
  LedgerToolsPlugin.prototype.setupTaskLinkMarksReading = function setup() {
    calls.push("setup");
  };
  try {
    bobEnv();
    assert.deepEqual(calls, ["setup"]);
  } finally {
    if (original) {
      LedgerToolsPlugin.prototype.setupTaskLinkMarksReading = original;
    } else {
      delete LedgerToolsPlugin.prototype.setupTaskLinkMarksReading;
    }
  }
});

test("the lifecycle calls one setupMarkFamilies and stays within the fragment limit", () => {
  const src = path.join(__dirname, "..", "plugins/bob-ledger-tools/src");
  const lifecycle = fs.readFileSync(path.join(src, "170-plugin-lifecycle.js"), "utf8");
  assert.ok(lifecycle.split("\n").length <= 1000);
  assert.equal((lifecycle.match(/this\.setupMarkFamilies\(\);/g) || []).length, 1);
  for (const name of ["setupFreshnessMarks", "setupTaskTagMarks", "setupPriorityMarks", "setupDateMarks", "setupProgressMarks", "setupLedgerTypeMarks", "setupTodayMarks"]) {
    assert.ok(!lifecycle.includes(`this.${name}();`), name);
  }
  const order = [];
  const env = bobEnv();
  for (const name of ["setupFreshnessMarks", "setupTaskTagMarks", "setupPriorityMarks", "setupDateMarks", "setupProgressMarks", "setupLedgerTypeMarks", "setupTodayMarks", "setupTaskLinkMarks"]) {
    env.plugin[name] = () => order.push(name);
  }
  env.plugin.setupMarkFamilies();
  assert.deepEqual(order, ["setupFreshnessMarks", "setupTaskTagMarks", "setupPriorityMarks", "setupDateMarks", "setupProgressMarks", "setupLedgerTypeMarks", "setupTodayMarks", "setupTaskLinkMarks"]);
});

// --- Rebuild triggers ---------------------------------------------------------

function update(over = {}) {
  const fields = { live: true, path: SOURCE };
  const stateWith = (f) => ({
    field(field) {
      if (field === editorLivePreviewField) {
        return f.live;
      }
      if (field === editorInfoField) {
        return { file: { path: f.path } };
      }
      throw new Error("unknown field");
    },
  });
  return {
    docChanged: false,
    viewportChanged: false,
    selectionSet: false,
    transactions: [],
    startState: stateWith(fields),
    state: stateWith({ ...fields, ...(over.after || {}) }),
    ...over.flags,
    ...(over.transactions ? { transactions: over.transactions } : {}),
  };
}

test("rebuild reasons: refresh, doc, mode, viewport, and never selection alone", () => {
  const env = bobEnv();
  const reason = (u) => env.plugin.taskLinkMarkRebuildReason(u);
  const refresh = ensureTaskLinkMarksRefresh();
  assert.equal(reason(update()), null);
  assert.equal(reason(update({ flags: { selectionSet: true } })), null);
  assert.equal(env.plugin.taskLinkMarkShouldRebuild(update({ flags: { selectionSet: true } })), false);
  assert.equal(reason(update({ flags: { docChanged: true } })), "doc");
  assert.equal(reason(update({ flags: { viewportChanged: true } })), "viewport");
  assert.equal(reason(update({ after: { live: false } })), "mode");
  assert.equal(reason(update({ after: { path: "notes/other.md" } })), "mode");
  assert.equal(reason(update({ transactions: [{ effects: [refresh.of(null)] }], flags: { docChanged: true } })), "refresh");
  assert.equal(reason(update({ transactions: [{ effects: [{ is: () => false }] }] })), null);
  assert.equal(env.plugin.taskLinkMarkShouldRebuild(null), false);
});

test("the view plugin rebuilds on refresh and doc changes, keeps decorations on selection-only updates", () => {
  const env = bobEnv();
  const extension = env.plugin.editorExtensions[0];
  assert.ok(extension._viewPlugin);
  const Cls = capturedPluginClass;
  const view = makeView("See [[bob#^fix]]", SOURCE);
  const instance = new Cls(view);
  assert.ok(env.plugin.taskLinkMarkViews.has(view));
  assert.equal(instance.decorations.adds.length, 1);
  const first = instance.decorations;
  instance.update({ ...update({ flags: { selectionSet: true } }), view });
  assert.equal(instance.decorations, first, "selection-only update keeps the same decorations");
  const refresh = ensureTaskLinkMarksRefresh();
  instance.update({ ...update({ transactions: [{ effects: [refresh.of(null)] }] }), view });
  assert.notEqual(instance.decorations, first);
  assert.equal(instance.decorations.adds.length, 1);
  const second = instance.decorations;
  instance.update({ ...update({ flags: { docChanged: true } }), view });
  assert.notEqual(instance.decorations, second);
  instance.destroy();
  assert.equal(env.plugin.taskLinkMarkViews.has(view), false);
});

// --- Swap rule -------------------------------------------------------------------

test("swap rule: never on first paint, once on a state change, never on scroll", () => {
  // Tasks rows are mutable so the second pass sees a new state.
  const rows = [task(BOB, "fix", " ", "Fix")];
  const env = makeEnv({ notes: { [BOB]: "", [SOURCE]: "" }, tasks: rows });
  const view = makeView("See [[bob#^fix]]", SOURCE);
  const build = (reason) => ringsOf(env, view, reason)[0];
  const rebuildTasks = (symbol) => {
    // A new Tasks array and generation, as a real cache-update would.
    rows[0] = task(BOB, "fix", symbol, "Fix");
    env.app.plugins.plugins["obsidian-tasks-plugin"].getTasks = () => rows.slice();
    env.plugin.freshnessTasksGen = (env.plugin.freshnessTasksGen || 0) + 1;
  };
  // First paint, startup, and a plain rerender never swap.
  assert.equal(build("init").swap, false);
  assert.equal(build("refresh").swap, false);
  assert.equal(build("doc").swap, false);
  // A scroll-driven rebuild that sees a new state records it without swapping.
  rebuildTasks("*");
  assert.equal(build("viewport").swap, false);
  assert.equal(build("refresh").swap, false, "the viewport build already painted the new state");
  // A refresh that sees a change swaps; the same pass again stays stable.
  rebuildTasks("x");
  const swapped = build("refresh");
  assert.equal(swapped.state, "done");
  assert.equal(swapped.swap, true);
  const stable = build("doc");
  assert.equal(stable.swap, true, "the swap flag survives rebuilds inside the window");
  assert.equal(swapped.widget.eq(stable.widget), true, "stable identity keeps the animation running");
  // Past the window the ring settles without a replay.
  env.clock.now += TASK_LINK_MARK_SWAP_MS + 1;
  assert.equal(build("refresh").swap, false);
  assert.equal(build("refresh").swap, false);
});

test("swap rule: every editor animates its own change, new editors do not", () => {
  const rows = [task(BOB, "fix", " ", "Fix")];
  const env = makeEnv({ notes: { [BOB]: "", [SOURCE]: "" }, tasks: rows });
  const viewA = makeView("[[bob#^fix]]", SOURCE);
  const viewB = makeView("[[bob#^fix]]", SOURCE);
  ringsOf(env, viewA, "init");
  ringsOf(env, viewB, "init");
  rows[0] = task(BOB, "fix", "x", "Fix");
  env.app.plugins.plugins["obsidian-tasks-plugin"].getTasks = () => rows.slice();
  env.plugin.freshnessTasksGen = (env.plugin.freshnessTasksGen || 0) + 1;
  assert.equal(ringsOf(env, viewA, "refresh")[0].swap, true);
  assert.equal(ringsOf(env, viewB, "refresh")[0].swap, true);
  const viewC = makeView("[[bob#^fix]]", SOURCE);
  assert.equal(ringsOf(env, viewC, "refresh")[0].swap, false, "first paint in a new editor");
});

test("swap rule: a same-note live edit swaps on the doc rebuild; a toggle resets it", () => {
  const env = makeEnv({ notes: { [SOURCE]: "" } });
  const text = (symbol) => `- [${symbol}] #task Fix ^fix\n[[#^fix]]`;
  const first = makeView(text(" "), SOURCE);
  assert.equal(ringsOf(env, first, "init")[0].swap, false);
  // The same editor view, a new document version.
  first.state.doc = { toString: () => text("x") };
  const ring = ringsOf(env, first, "doc")[0];
  assert.equal(ring.state, "done");
  assert.equal(ring.swap, true);
  // A toggle is a fresh start.
  env.plugin.toggleTaskLinkMarks();
  env.plugin.toggleTaskLinkMarks();
  env.clock.now += 10 * TASK_LINK_MARK_SWAP_MS;
  first.state.doc = { toString: () => text("-") };
  assert.equal(ringsOf(env, first, "refresh")[0].swap, false);
});

test("taskLinkMarkSwapFor keeps a bounded LRU of painted keys", () => {
  const state = taskLinkMarkNewViewState();
  for (let index = 0; index < TASK_LINK_MARK_PAINTED_MAX + 500; index += 1) {
    assert.equal(taskLinkMarkSwapFor(state, `k${index}`, "ready", 0, true), false);
  }
  assert.equal(state.painted.size, TASK_LINK_MARK_PAINTED_MAX);
  // The oldest keys were evicted, so they cannot swap; recent keys still can.
  assert.equal(state.painted.has("k0"), false);
  assert.equal(taskLinkMarkSwapFor(state, "k0", "done", 0, true), false);
  const recent = `k${TASK_LINK_MARK_PAINTED_MAX + 499}`;
  assert.equal(taskLinkMarkSwapFor(state, recent, "done", 0, true), true);
  assert.equal(taskLinkMarkSwapFor(state, "x", "ready", 0, true), false);
  assert.equal(taskLinkMarkSwapFor(null, "x", "ready", 0, true), false);
});

// --- Live document model -------------------------------------------------------------

test("the live document model indexes ids and survives bad input", () => {
  const model = taskLinkMarkLiveDocModel("a ^one\n```\nb ^two\n```\nc ^one", "x.md");
  assert.deepEqual(model.blocks.get("one"), [0, 4]);
  assert.equal(model.blocks.has("two"), false);
  assert.deepEqual(model.starts, [0, 7, 11, 18, 22]);
  assert.equal(taskLinkMarkLiveDocModel(null, "x.md").lines.length, 1);
});

test("the document model is memoised per document version", () => {
  const env = bobEnv();
  const view = makeView("See [[bob#^fix]]", SOURCE);
  const a = env.plugin.taskLinkMarkDocModelFor(view.state.doc, SOURCE);
  assert.equal(env.plugin.taskLinkMarkDocModelFor(view.state.doc, SOURCE), a);
  assert.notEqual(env.plugin.taskLinkMarkDocModelFor({ toString: () => "other" }, SOURCE), a);
});

// --- Performance -----------------------------------------------------------------------

test("a viewport-limited build over a 1,000-line note stays fast", () => {
  const rows = [];
  for (let index = 0; index < 100; index += 1) {
    rows.push(task(BOB, `t${index}`, index % 6 === 0 ? "x" : " ", `Task number ${index}`));
  }
  const env = makeEnv({ notes: { [BOB]: "", [SOURCE]: "" }, tasks: rows });
  const lines = [];
  for (let index = 0; index < 1000; index += 1) {
    lines.push(`Line ${index} links [[bob#^t${index % 100}]] and [[bob#^t${(index * 7) % 100}]] plus [[dev_tools#^z-241023-0r|tmux]]`);
  }
  const text = lines.join("\n");
  const starts = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  const hr = () => Number(process.hrtime.bigint()) / 1e6;
  // CPU time with a warm-up and best-of samples, as the other performance
  // tests do (`test-block-id-prompt-task-wikilink-index-performance.cjs`):
  // a full-suite run once failed this guard at 29.6 ms on a wall-clock
  // sample that scheduler preemption or a GC pause had inflated.
  const cpuMs = () => {
    const usage = process.cpuUsage();
    return (usage.user + usage.system) / 1000;
  };
  const bestOf = (samples, run) => {
    let best = Infinity;
    for (let sample = 0; sample < samples; sample += 1) {
      const started = cpuMs();
      run(sample);
      best = Math.min(best, cpuMs() - started);
    }
    return best;
  };
  // Cold: the first build splits the document and walks its fences once.
  const viewport = makeView(text, SOURCE, { ranges: [{ from: starts[400], to: starts[460] }] });
  const cold = ringsOf(env, viewport);
  assert.equal(cold.length, 122, "two task links on each of 61 visible lines");
  // Every sample is a new document version, so it pays the cold cost.
  const coldMs = bestOf(3, (sample) => {
    const fresh = makeView(`${text}${" ".repeat(sample + 1)}`, SOURCE, { ranges: [{ from: starts[400], to: starts[460] }] });
    assert.equal(ringsOf(env, fresh).length, 122);
  });
  assert.ok(coldMs < 100, `cold viewport build took ${coldMs.toFixed(1)}ms of CPU`);
  // Warm: the same document version, a scrolled viewport.
  const scrollTo = (first) => {
    const scrolled = makeView(text, SOURCE, { ranges: [{ from: starts[first], to: starts[first + 60] }] });
    scrolled.state.doc = viewport.state.doc;
    return scrolled;
  };
  const warm = ringsOf(env, scrollTo(500));
  assert.equal(warm.length, 122);
  const warmMs = bestOf(5, (sample) => {
    assert.equal(ringsOf(env, scrollTo(500 + sample * 7)).length, 122);
  });
  assert.ok(warmMs < 25, `warm viewport build took ${warmMs.toFixed(1)}ms of CPU`);
  // A keystroke: a new document version rebuilds the model, then the viewport.
  const keystroke = ringsOf(env, makeView(`${text} `, SOURCE, { ranges: [{ from: starts[500], to: starts[560] }] }), "doc");
  assert.equal(keystroke.length, 122);
  const keystrokeMs = bestOf(5, (sample) => {
    const typed = makeView(`${text} ${"x".repeat(sample + 2)}`, SOURCE, { ranges: [{ from: starts[500], to: starts[560] }] });
    assert.equal(ringsOf(env, typed, "doc").length, 122);
  });
  assert.ok(keystrokeMs < 25, `keystroke rebuild took ${keystrokeMs.toFixed(1)}ms of CPU`);
  // The whole note: 2,000 task links, 3 resolver lookups at most per unique id.
  const full = makeView(text, SOURCE);
  full.state.doc = viewport.state.doc;
  const t2 = hr();
  const all = ringsOf(env, full);
  const fullMs = hr() - t2;
  assert.equal(all.length, 2000);
  assert.ok(fullMs < 500, `full build took ${fullMs.toFixed(1)}ms`);
  assert.equal(env.reads.count, 0);
});

test("the Tasks snapshot is read once per memo generation, not once per link", () => {
  const env = bobEnv();
  ringsOf(env, makeView(Array.from({ length: 200 }, () => "[[bob#^fix]]").join("\n"), SOURCE));
  assert.ok(env.spies.getTasks <= 3, `getTasks called ${env.spies.getTasks} times`);
});
