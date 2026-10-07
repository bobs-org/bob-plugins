// Tests for bob-ledger-tools Task Link In Progress marks (bob-cli-56
// phase `progress-marks`). Covers the dedicated-link parser, the
// section-wide link model, the live-doc status reader, the element
// builder, the Live Preview decorations and widget, the Reading-view
// post-processor, the optimistic hints, the session toggle, the
// `api.progressMarks` v1 namespace, rebuild triggers, the lazy
// StateEffect, and the styles.css contract. The epic plan
// `plan:202610/in_progress_task_link_marks.md` §4 (vectors P1-P14) is
// authoritative; the P vectors below encode it verbatim with `D` the
// daily content and `T` a project note holding `- [s] #task Fix ^fix`.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");

const editorInfoField = { _progressField: "info" };
const editorLivePreviewField = { _progressField: "live" };

let capturedMarkClass = null;
let stateEffectDefines = 0;

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
    stateEffectDefines += 1;
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
  Module._load = function loadWithProgressStubs(request) {
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
  PROGRESS_MARK_TOOLTIP,
  progressMarkLinkFromBody,
  progressMarkLinks,
  progressMarkLiveStatus,
  buildProgressMarkElement,
  ensureProgressMarksRefresh,
  todayDailyPath,
} = helpers;

const DAILY = todayDailyPath(new Date(), {});
assert.ok(DAILY, "test daily path resolves");
// Require-time eager `StateEffect.define()` calls: exactly the
// freshness-marks refresh. Later tests may trigger this family's
// lazy define, so the count is pinned here, before any test runs.
const EAGER_DEFINES = stateEffectDefines;

// --- Stub vault ------------------------------------------------------------

// `tasks`: `{ "<path>": { "<blockId>": { line, task } } }`.
function makeProgressApp({ tasks = {}, triggers = [], leaves = [] } = {}) {
  return {
    vault: {
      getAbstractFileByPath: () => null,
      cachedRead: () => Promise.resolve(null),
    },
    workspace: {
      on: () => ({}),
      offref: () => {},
      onLayoutReady: () => {},
      getActiveFile: () => null,
      getLeavesOfType: () => leaves,
      trigger: (event) => triggers.push(event),
    },
    metadataCache: {
      on: () => ({}),
      getCache: (filePath) => {
        const note = tasks[filePath];
        if (!note) {
          return null;
        }
        const blocks = {};
        const listItems = [];
        for (const [blockId, row] of Object.entries(note)) {
          blocks[blockId] = { position: { start: { line: row.line } } };
          if (row.task !== null && row.task !== undefined) {
            listItems.push({
              position: { start: { line: row.line } },
              task: row.task,
            });
          }
        }
        return { blocks, listItems };
      },
      getFirstLinkpathDest: (target, _sourcePath) => {
        if (target === "T") {
          return { path: "T.md" };
        }
        return null;
      },
    },
    commands: {},
    plugins: { plugins: {} },
  };
}

function makeProgressPlugin(app) {
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.setupProgressMarks();
  plugin.progressMarksEnabled = true;
  return plugin;
}

function tasksWithStatus(status) {
  return makeProgressApp({
    tasks: { "T.md": { fix: { line: 0, task: status } } },
  });
}

const OPEN_ENTRY = "- [ ] (**0940-1010** [t:: 30m])";
const POMODOROS = "## Pomodoros";

function dailyBody(...rows) {
  return [POMODOROS, OPEN_ENTRY, ...rows].join("\n");
}

// --- P1-P14: the link model ------------------------------------------------

test("P1/P3/P4: open entries mark plain and aliased links", () => {
  const aliased = dailyBody("\t- [[T#^fix|Fix]]");
  const found = progressMarkLinks(aliased);
  assert.equal(found.length, 1);
  assert.equal(found[0].line, 2);
  assert.equal(found[0].target, "T");
  assert.equal(found[0].blockId, "fix");
  assert.equal(
    aliased.split("\n")[found[0].line].slice(found[0].ch, found[0].ch + 2),
    "[[",
  );

  const placeholder = [POMODOROS, "- [ ] ()", "\t- [[T#^fix]]"].join("\n");
  assert.equal(progressMarkLinks(placeholder).length, 1);

  const named = [POMODOROS, "- [ ] () — GOALS", "\t- [[T#^fix|Fix]]"].join(
    "\n",
  );
  const namedFound = progressMarkLinks(named);
  assert.equal(namedFound.length, 1);
  assert.equal(namedFound[0].target, "T");
});

test("P2/P12: Next, Ready, Blocked, done, and cancelled targets get no mark", () => {
  for (const status of ["*", " ", "?", "x", "-"]) {
    const plugin = makeProgressPlugin(tasksWithStatus(status));
    const decorations = plugin.buildProgressMarkDecorations(
      makeView({ lines: dailyBody("\t- [[T#^fix]]").split("\n") }),
    );
    assert.equal(decorations.adds.length, 0, `status ${status}`);
  }
  // The candidate is still found: only the status gate refuses.
  assert.equal(
    progressMarkLinks(dailyBody("\t- [[T#^fix]]")).length,
    1,
  );
});

test("P5: closed entries never mark, even with 🍅 history", () => {
  const closed = [
    POMODOROS,
    "- [x] (**0900-0930** [t:: 30m])",
    "\t- 🍅 [[T#^fix]]",
  ].join("\n");
  assert.deepEqual(progressMarkLinks(closed), []);
});

test("P6/P7: embedded and struck links never mark", () => {
  assert.deepEqual(
    progressMarkLinks(dailyBody("\t- ![[T#^fix]]")),
    [],
  );
  assert.deepEqual(
    progressMarkLinks(dailyBody("\t- ~~[[T#^fix]]~~")),
    [],
  );
  assert.equal(progressMarkLinkFromBody("![[T#^fix]]"), null);
  assert.equal(progressMarkLinkFromBody("~~[[T#^fix]]~~"), null);
});

test("P8: both trailing-# move-only forms mark", () => {
  for (const body of ["[[T#^fix]]#", "[[T#^fix]] #"]) {
    const token = progressMarkLinkFromBody(body);
    assert.ok(token, body);
    assert.equal(token.blockId, "fix");
  }
  const content = dailyBody("\t- [[T#^fix]]#", "\t- [[T#^fix]] #");
  assert.equal(progressMarkLinks(content).length, 2);
  // Today still excludes `#` lines: `060-today.js` is untouched by
  // this phase (verified by diff, not by a new export).
});

test("P9: nested and prose-mixed links never mark", () => {
  // Nested under another bullet: deeper than the first-child indent.
  assert.deepEqual(
    progressMarkLinks(dailyBody("\t- parent", "\t\t- [[T#^fix]]")),
    [],
  );
  assert.deepEqual(
    progressMarkLinks(dailyBody("\t- read [[T#^fix]] today")),
    [],
  );
});

test("P10: fenced, off-section, and off-note links never mark", () => {
  const fenced = [
    POMODOROS,
    OPEN_ENTRY,
    "```",
    "- [[T#^fix]]",
    "```",
  ].join("\n");
  assert.deepEqual(progressMarkLinks(fenced), []);

  const offSection = [
    "## Tasks",
    "- [ ] #task Other",
    "\t- [[T#^fix]]",
    POMODOROS,
    OPEN_ENTRY,
  ].join("\n");
  assert.deepEqual(progressMarkLinks(offSection), []);

  // Outside today's daily note the extension builds nothing.
  const plugin = makeProgressPlugin(tasksWithStatus("/"));
  assert.equal(
    plugin.buildProgressMarkDecorations(
      makeView({
        lines: dailyBody("\t- [[T#^fix]]").split("\n"),
        path: "1999/19990101.md",
      }),
    ),
    StubDecoration.none,
  );
  assert.equal(
    plugin.buildProgressMarkDecorations(
      makeView({
        lines: dailyBody("\t- [[T#^fix]]").split("\n"),
        live: false,
      }),
    ),
    StubDecoration.none,
  );
});

test("P11: unresolved targets and non-task blocks get no mark", () => {
  const plugin = makeProgressPlugin(tasksWithStatus("/"));
  // `[[Missing#^fix]]` resolves to nothing.
  const missing = plugin.buildProgressMarkDecorations(
    makeView({ lines: dailyBody("\t- [[Missing#^fix]]").split("\n") }),
  );
  assert.equal(missing.adds.length, 0);
  // A cached block with no task row is a non-task block.
  const nonTask = makeProgressPlugin(
    makeProgressApp({ tasks: { "T.md": { fix: { line: 0 } } } }),
  );
  const rendered = nonTask.buildProgressMarkDecorations(
    makeView({ lines: dailyBody("\t- [[T#^fix]]").split("\n") }),
  );
  assert.equal(rendered.adds.length, 0);
});

test("P13: a same-note target reads the live doc", () => {
  const live = [
    POMODOROS,
    OPEN_ENTRY,
    "\t- [[#^here]]",
    "## Tasks",
    "- [/] #task Mine ^here",
  ].join("\n");
  assert.equal(progressMarkLiveStatus(live, "here"), "/");
  const released = live.replace("- [/] #task Mine ^here", "- [*] #task Mine ^here");
  assert.equal(progressMarkLiveStatus(released, "here"), "*");
  assert.equal(progressMarkLiveStatus(live, "gone"), null);
  assert.equal(progressMarkLiveStatus("", "here"), null);

  const plugin = makeProgressPlugin(makeProgressApp({ tasks: {} }));
  assert.equal(
    plugin.progressMarkStatusFor("", "here", DAILY, live),
    "/",
  );
  assert.equal(
    plugin.progressMarkStatusFor("", "here", DAILY, released),
    "*",
  );
});

test("P14: expect() wins until the cache agrees or 4 s pass", () => {
  const plugin = makeProgressPlugin(tasksWithStatus("*"));
  assert.equal(
    plugin.progressMarkStatusFor("T", "fix", DAILY, null),
    "*",
  );
  plugin.progressMarksApi().expect([
    { path: "T.md", blockId: "fix", status: "/" },
  ]);
  assert.equal(
    plugin.progressMarkStatusFor("T", "fix", DAILY, null),
    "/",
  );
  // The cache agreeing drops the hint.
  const agreed = makeProgressPlugin(tasksWithStatus("/"));
  agreed.progressMarkHints = plugin.progressMarkHints;
  assert.equal(
    agreed.progressMarkStatusFor("T", "fix", DAILY, null),
    "/",
  );
  assert.equal(agreed.progressMarkHints.size, 0);
  // Expiry hands the win back to the cache.
  plugin.progressMarksApi().expect([
    { path: "T.md", blockId: "fix", status: "/" },
  ]);
  for (const entry of plugin.progressMarkHints.values()) {
    entry.expiresAt = Date.now() - 1;
  }
  assert.equal(
    plugin.progressMarkStatusFor("T", "fix", DAILY, null),
    "*",
  );
  assert.equal(plugin.progressMarkHints.size, 0);
});

// --- Widget DOM ------------------------------------------------------------

function fakeElementDoc() {
  function el(tag) {
    return {
      tagName: tag,
      attrs: {},
      children: [],
      handlers: {},
      setAttribute(name, value) {
        this.attrs[name] = String(value);
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

test("tooltip, element structure, and eq", () => {
  assert.equal(PROGRESS_MARK_TOOLTIP, "In Progress\nAlt+[ or Alt+] → Next");
  assert.ok(PROGRESS_MARK_TOOLTIP.indexOf("::") === -1);

  const doc = fakeElementDoc();
  const span = buildProgressMarkElement(doc, "fix");
  assert.ok(span);
  assert.equal(span.attrs.class, "bob-progress-mark");
  assert.equal(span.attrs.role, "img");
  assert.equal(span.attrs["aria-label"], PROGRESS_MARK_TOOLTIP);
  assert.ok(span.attrs["aria-label"].indexOf("::") === -1);
  assert.equal(span.attrs["data-tooltip-position"], "top");
  assert.equal(span.attrs["data-block-id"], "fix");

  assert.equal(buildProgressMarkElement(null, "fix"), null);
  assert.equal(buildProgressMarkElement(doc, ""), null);
  assert.equal(buildProgressMarkElement(doc, "has space"), null);
  assert.equal(buildProgressMarkElement(doc, null), null);
});

function makeDoc(lines) {
  let offset = 0;
  const lineObjs = lines.map((text, index) => {
    const from = offset;
    const to = from + text.length;
    offset = to + 1;
    return { from, to, text, number: index + 1 };
  });
  const text = lines.join("\n");
  return {
    length: Math.max(0, offset - 1),
    toString() {
      return text;
    },
    line(number) {
      return lineObjs[number - 1];
    },
    lineAt(pos) {
      for (const line of lineObjs) {
        if (pos >= line.from && pos <= line.to) {
          return line;
        }
      }
      return lineObjs[lineObjs.length - 1];
    },
  };
}

function makeView({ lines, live = true, path = DAILY } = {}) {
  const doc = makeDoc(lines);
  return {
    visibleRanges: [{ from: 0, to: doc.length }],
    state: {
      doc,
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

test("Live Preview places one widget at each In Progress link", () => {
  const plugin = makeProgressPlugin(tasksWithStatus("/"));
  const lines = dailyBody("\t- [[T#^fix]]", "\t- [[T#^other]]").split("\n");
  const decorations = plugin.buildProgressMarkDecorations(
    makeView({ lines }),
  );
  // Only `^fix` resolves to an In Progress task.
  assert.equal(decorations.adds.length, 1);
  const add = decorations.adds[0];
  assert.equal(add.from, add.to);
  const linkLine = lines[2];
  assert.equal(add.from, lines.slice(0, 2).join("\n").length + 1 + 3);
  assert.equal(linkLine.slice(3, 5), "[[");
  const widget = add.value.widget;
  assert.ok(widget instanceof StubWidgetType);
  assert.equal(widget.key, "fix");

  const rebuilt = plugin.buildProgressMarkDecorations(makeView({ lines }));
  assert.equal(widget.eq(rebuilt.adds[0].value.widget), true);

  const other = makeProgressPlugin(tasksWithStatus("/"));
  const aliased = other.buildProgressMarkDecorations(
    makeView({ lines: dailyBody("\t- [[T#^fix]] #").split("\n") }),
  );
  assert.equal(aliased.adds.length, 1);
  assert.equal(
    widget.eq(aliased.adds[0].value.widget),
    true,
    "eq compares the block id, not the line shape",
  );
  assert.equal(widget.eq(null), false);
  assert.equal(widget.eq({ key: "fix" }), false);
});

test("widget mousedown places the cursor at the link start", () => {
  const plugin = makeProgressPlugin(tasksWithStatus("/"));
  const view = makeView({ lines: dailyBody("\t- [[T#^fix]]").split("\n") });
  const widget = plugin.buildProgressMarkDecorations(view).adds[0].value
    .widget;
  const savedDocument = global.document;
  const handlers = {};
  global.document = {
    createElement: () => ({
      _attrs: {},
      children: [],
      setAttribute(name, value) {
        this._attrs[name] = value;
      },
      appendChild(child) {
        this.children.push(child);
        return child;
      },
      addEventListener(name, handler) {
        handlers[name] = handler;
      },
    }),
  };
  try {
    const dom = widget.toDOM(view);
    assert.ok(dom);
    let prevented = false;
    handlers.mousedown({ preventDefault: () => (prevented = true) });
    assert.equal(prevented, true);
    assert.equal(view.dispatched.length, 1);
    assert.equal(view.dispatched[0].selection.anchor, 42);
    assert.equal(view.focused, true);
  } finally {
    if (savedDocument === undefined) {
      delete global.document;
    } else {
      global.document = savedDocument;
    }
  }
});

test("rebuild triggers skip the cursor but take doc, viewport, and refresh", () => {
  const plugin = makeProgressPlugin(tasksWithStatus("/"));
  const extension = plugin.createProgressMarkExtension();
  assert.ok(extension);
  const MarkClass = capturedMarkClass;
  assert.ok(MarkClass);
  const view = makeView({
    lines: dailyBody("\t- [[T#^fix]]").split("\n"),
  });
  const instance = new MarkClass(view);
  assert.equal(instance.decorations.adds.length, 1);

  // The cursor alone never rebuilds: the mark covers no source text.
  instance.update({ view, selectionSet: true });
  assert.equal(instance.decorations.adds.length, 1);
  assert.equal(plugin.progressMarkShouldRebuild({ selectionSet: true }), false);

  assert.equal(plugin.progressMarkShouldRebuild({ docChanged: true }), true);
  assert.equal(
    plugin.progressMarkShouldRebuild({ viewportChanged: true }),
    true,
  );
  assert.equal(plugin.progressMarkShouldRebuild(null), false);
  assert.equal(plugin.progressMarkShouldRebuild({}), false);

  const refresh = ensureProgressMarksRefresh();
  instance.update({
    view,
    transactions: [{ effects: refresh.of(null) }],
  });
  assert.equal(instance.decorations.adds.length, 1);
});

// --- Reading view ----------------------------------------------------------

function readingText(value) {
  return {
    nodeType: 3,
    nodeValue: String(value),
    parentNode: null,
    previousSibling: null,
    get textContent() {
      return this.nodeValue;
    },
  };
}

function readingEl(tag, { attrs = {}, children = [] } = {}) {
  const node = {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    attrs: { ...attrs },
    childNodes: [],
    children: [],
    parentNode: null,
    previousSibling: null,
    dataset: {},
    ownerDocument: null,
    get textContent() {
      return this.childNodes
        .map((child) =>
          child.nodeType === 3
            ? child.nodeValue
            : typeof child.textContent === "string"
              ? child.textContent
              : "",
        )
        .join("");
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name)
        ? this.attrs[name]
        : null;
    },
    setAttribute(name, value) {
      this.attrs[name] = String(value);
    },
    querySelectorAll(selector) {
      const found = [];
      const wantTag =
        selector === "li" ? "LI" : selector === "a.internal-link" ? "A" : null;
      const walk = (current) => {
        for (const child of current.childNodes || []) {
          if (child.nodeType !== 1) {
            continue;
          }
          if (child.tagName === wantTag) {
            if (
              wantTag === "LI" ||
              String(child.getAttribute("class") || "")
                .split(/\s+/)
                .indexOf("internal-link") !== -1
            ) {
              found.push(child);
            }
          }
          walk(child);
        }
      };
      walk(this);
      return found;
    },
    appendChild(child) {
      child.parentNode = this;
      const last = this.childNodes[this.childNodes.length - 1] || null;
      if (last) {
        last.nextSibling = child;
        child.previousSibling = last;
      }
      this.childNodes.push(child);
      this.children.push(child);
      return child;
    },
    insertBefore(child, before) {
      child.parentNode = this;
      const index = this.childNodes.indexOf(before);
      if (index === -1) {
        return this.appendChild(child);
      }
      const prev = this.childNodes[index - 1] || null;
      child.previousSibling = prev;
      child.nextSibling = before;
      if (prev) {
        prev.nextSibling = child;
      }
      before.previousSibling = child;
      this.childNodes.splice(index, 0, child);
      this.children.splice(index, 0, child);
      return child;
    },
  };
  for (const child of children) {
    node.appendChild(child);
  }
  return node;
}

function readingDoc() {
  const created = [];
  return {
    created,
    createElement(tag) {
      const node = readingEl(tag);
      node.ownerDocument = this;
      created.push(node);
      return node;
    },
    createTextNode(value) {
      return readingText(value);
    },
  };
}

function readingLink(doc, href) {
  const anchor = doc.createElement("a");
  anchor.setAttribute("class", "internal-link");
  anchor.setAttribute("data-href", href);
  anchor.appendChild(doc.createTextNode("Fix"));
  return anchor;
}

// A Pomodoros section: `div > h2 + ul > li[data-task] > ul > li > a`.
function readingSection(doc, { heading = "Pomodoros", entryTask = " ", rows = [] } = {}) {
  const root = readingEl("div");
  root.ownerDocument = doc;
  const head = doc.createElement("h2");
  head.appendChild(doc.createTextNode(heading));
  root.appendChild(head);
  const top = doc.createElement("ul");
  root.appendChild(top);
  const entry = doc.createElement("li");
  entry.setAttribute("data-task", entryTask);
  entry.appendChild(doc.createTextNode("0940-1010"));
  top.appendChild(entry);
  const inner = doc.createElement("ul");
  entry.appendChild(inner);
  for (const makeRow of rows) {
    inner.appendChild(makeRow(doc, inner));
  }
  return root;
}

function plainRow(doc, href) {
  const li = doc.createElement("li");
  li.appendChild(readingLink(doc, href));
  return li;
}

test("Reading view marks In Progress rows and dedupes", () => {
  const doc = readingDoc();
  const plugin = makeProgressPlugin(tasksWithStatus("/"));
  const root = readingSection(doc, {
    rows: [(d) => plainRow(d, "T#^fix")],
  });
  const ctx = { sourcePath: DAILY };
  plugin.renderProgressMarksIn(root, ctx);
  const marks = doc.created.filter(
    (node) => node.getAttribute("class") === "bob-progress-mark",
  );
  assert.equal(marks.length, 1);
  assert.equal(marks[0].getAttribute("data-block-id"), "fix");
  assert.equal(
    marks[0].getAttribute("aria-label"),
    PROGRESS_MARK_TOOLTIP,
  );
  const row = root
    .querySelectorAll("li")
    .find((li) => li.childNodes.indexOf(marks[0]) !== -1);
  assert.ok(row, "the mark lands on its own row");
  assert.equal(row.dataset.bobProgressProcessed, "1");
  assert.equal(row.childNodes[0], marks[0]);

  // A second pass inserts nothing more.
  const before = row.childNodes.length;
  plugin.renderProgressMarksIn(root, ctx);
  assert.equal(row.childNodes.length, before);
});

test("Reading view refuses every non-mark row", () => {
  const cases = {
    "Next target": { tasks: { "T.md": { fix: { line: 0, task: "*" } } } },
    "closed entry": { entryTask: "x" },
    "cancelled entry": { entryTask: "-" },
    "other heading": { heading: "Tasks" },
  };
  for (const [name, options] of Object.entries(cases)) {
    const doc = readingDoc();
    const plugin = makeProgressPlugin(
      makeProgressApp({ tasks: options.tasks || { "T.md": { fix: { line: 0, task: "/" } } } }),
    );
    const root = readingSection(doc, {
      heading: options.heading || "Pomodoros",
      entryTask: options.entryTask || " ",
      rows: [(d) => plainRow(d, "T#^fix")],
    });
    plugin.renderProgressMarksIn(root, { sourcePath: DAILY });
    assert.equal(
      doc.created.filter(
        (node) => node.getAttribute("class") === "bob-progress-mark",
      ).length,
      0,
      name,
    );
  }

  // Prose-mixed, nested, struck, and trailing-prose rows stay clean.
  const doc = readingDoc();
  const plugin = makeProgressPlugin(tasksWithStatus("/"));
  const root = readingSection(doc, {
    rows: [
      (d) => {
        const li = d.createElement("li");
        li.appendChild(readingText("read "));
        li.appendChild(readingLink(d, "T#^fix"));
        li.appendChild(readingText(" today"));
        return li;
      },
      (d, inner) => {
        const li = d.createElement("li");
        li.appendChild(readingText("nested"));
        const sub = d.createElement("ul");
        li.appendChild(sub);
        const deep = d.createElement("li");
        deep.appendChild(readingLink(d, "T#^fix"));
        sub.appendChild(deep);
        void inner;
        return li;
      },
      (d) => {
        const li = d.createElement("li");
        const struck = d.createElement("s");
        struck.appendChild(readingLink(d, "T#^fix"));
        li.appendChild(struck);
        return li;
      },
    ],
  });
  plugin.renderProgressMarksIn(root, { sourcePath: DAILY });
  assert.equal(
    doc.created.filter(
      (node) => node.getAttribute("class") === "bob-progress-mark",
    ).length,
    0,
  );

  // Off-note and disabled passes stay silent and never throw.
  plugin.renderProgressMarksIn(root, { sourcePath: "1999/19990101.md" });
  plugin.progressMarksEnabled = false;
  plugin.renderProgressMarksIn(root, { sourcePath: DAILY });
  plugin.renderProgressMarksIn(null, null);
  assert.equal(
    doc.created.filter(
      (node) => node.getAttribute("class") === "bob-progress-mark",
    ).length,
    0,
  );
});

test("Reading view allows the 🍅 prefix and the trailing # marker", () => {
  const doc = readingDoc();
  const plugin = makeProgressPlugin(tasksWithStatus("/"));
  const root = readingSection(doc, {
    rows: [
      (d) => {
        const li = d.createElement("li");
        li.appendChild(readingText("🍅 "));
        li.appendChild(readingLink(d, "T#^fix"));
        return li;
      },
      (d) => {
        const li = d.createElement("li");
        li.appendChild(readingLink(d, "T#^fix"));
        li.appendChild(readingText(" #"));
        return li;
      },
    ],
  });
  plugin.renderProgressMarksIn(root, { sourcePath: DAILY });
  assert.equal(
    doc.created.filter(
      (node) => node.getAttribute("class") === "bob-progress-mark",
    ).length,
    2,
  );
});

// --- api, toggle, and wiring ------------------------------------------------

test("api.progressMarks v1 is additive, sync, and never throwing", () => {
  const plugin = makeProgressPlugin(tasksWithStatus("*"));
  const api = plugin.progressMarksApi();
  assert.equal(api.version, 1);
  assert.deepEqual(
    Object.keys(api).sort(),
    ["expect", "isEnabled", "refresh", "version"],
  );
  assert.ok(Object.isFrozen(api));
  assert.equal(typeof api.expect, "function");
  assert.equal(typeof api.refresh, "function");
  assert.equal(typeof api.isEnabled, "function");
  assert.equal(api.isEnabled(), true);

  // Validation: only well-formed entries are stored.
  api.expect(null);
  api.expect("nope");
  api.expect([null, {}, { path: "", blockId: "", status: "" }]);
  assert.equal(plugin.progressMarkHints.size, 0);
  api.expect([{ path: "T.md", blockId: "fix", status: "/" }]);
  assert.equal(plugin.progressMarkHints.size, 1);

  // The namespace installs on the plugin class, so the frozen
  // top-level api in lifecycle picks it up without a version bump.
  assert.equal(
    Object.getOwnPropertyNames(LedgerToolsPlugin.prototype).indexOf(
      "progressMarksApi",
    ) !== -1,
    true,
  );

  // Never throws, even on garbage.
  assert.doesNotThrow(() => api.expect([{ path: 1, blockId: 2, status: 3 }]));
  assert.doesNotThrow(() => api.refresh());
  assert.doesNotThrow(() => api.isEnabled());
  const bare = new LedgerToolsPlugin(makeProgressApp(), {});
  assert.doesNotThrow(() => bare.progressMarksApi().expect(null));
  assert.doesNotThrow(() => bare.progressMarksApi().refresh());
  assert.equal(bare.progressMarksApi().isEnabled(), false);
});

test("session toggle, onload wiring, and refresh fan-out", () => {
  TestNotice.messages = [];
  const dispatched = [];
  const leaves = [
    {
      view: {
        file: { path: DAILY },
        editor: { cm: { dispatch: (tr) => dispatched.push(["daily", tr]) } },
      },
    },
    {
      view: {
        file: { path: "other.md" },
        editor: { cm: { dispatch: (tr) => dispatched.push(["other", tr]) } },
      },
    },
  ];
  const plugin = makeProgressPlugin(makeProgressApp({ leaves }));
  const commands = plugin.commands.filter(
    (command) => command.id === "toggle-progress-marks",
  );
  assert.equal(commands.length, 1);
  assert.equal(
    plugin.postProcessors.filter((entry) => entry.sortOrder === 50).length >= 1,
    true,
  );
  assert.ok(plugin.editorExtensions.length >= 1);

  assert.equal(plugin.toggleProgressMarks(), false);
  assert.deepEqual(TestNotice.messages.slice(-1), ["In Progress marks off"]);
  assert.equal(plugin.toggleProgressMarks(), true);
  assert.deepEqual(TestNotice.messages.slice(-1), ["In Progress marks on"]);

  // Only today's daily-note editors refresh.
  dispatched.length = 0;
  plugin.refreshProgressMarkEditors();
  assert.equal(
    dispatched.filter(([leaf]) => leaf === "daily").length,
    1,
  );
  assert.equal(
    dispatched.filter(([leaf]) => leaf === "other").length,
    0,
  );

  // The consolidated fan-out reaches the marks.
  plugin.progressMarksTimer = null;
  plugin.scheduleLiveWidgetRefresh();
  assert.notEqual(plugin.progressMarksTimer, null);
  clearTimeout(plugin.progressMarksTimer);
  plugin.progressMarksTimer = null;
});

test("changed-file and rollover refreshes", () => {
  const plugin = makeProgressPlugin(tasksWithStatus("/"));
  plugin.buildProgressMarkDecorations(
    makeView({ lines: dailyBody("\t- [[T#^fix]]").split("\n") }),
  );
  assert.ok(plugin.progressMarkLastTargets.has("T.md"));

  assert.equal(plugin.refreshProgressMarksForChangedFile({ path: DAILY }), true);
  clearTimeout(plugin.progressMarksTimer);
  plugin.progressMarksTimer = null;
  assert.equal(plugin.refreshProgressMarksForChangedFile({ path: "T.md" }), true);
  clearTimeout(plugin.progressMarksTimer);
  plugin.progressMarksTimer = null;
  assert.equal(
    plugin.refreshProgressMarksForChangedFile({ path: "unrelated.md" }),
    false,
  );
  assert.equal(plugin.refreshProgressMarksForChangedFile(null), false);

  assert.equal(plugin.refreshProgressMarksForRollover(new Date()), false);
  plugin.progressMarksDay = "1999/19990101.md";
  assert.equal(plugin.refreshProgressMarksForRollover(new Date()), true);
});

test("the refresh effect stays lazy: one eager define", () => {
  assert.equal(EAGER_DEFINES, 1, "no new eager define at require time");
  const first = ensureProgressMarksRefresh();
  assert.ok(first);
  assert.equal(ensureProgressMarksRefresh(), first, "lazy effect memoizes");
});

test("styles.css contract: glyph, box, motion, toggle, calm", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "../plugins/bob-ledger-tools/styles.css"),
    "utf8",
  );
  assert.ok(
    css.includes("--bob-progress-glyph: url(\"data:image/svg+xml,"),
    "glyph mask defined once on body",
  );
  assert.ok(css.includes("M8 4.1A3.9 3.9 0 0 1 8 11.9Z"), "half disc");
  assert.ok(css.includes(".bob-progress-mark"), "host class");
  assert.ok(css.includes(".bob-progress-mark::before"), "mask layer");
  assert.ok(
    css.includes(
      "--bob-progress-mark-color, var(--task-status-in-progress, var(--color-yellow))",
    ),
    "D2 color stack (no hex: the theme-safe gate forbids it)",
  );
  assert.ok(css.includes("margin-inline-end: 0.3em"), "marker slot");
  assert.ok(css.includes("vertical-align: -0.18em"), "baseline sit");
  assert.ok(css.includes("bob-progress-mark-in"), "entrance");
  assert.ok(
    css.includes("body:not(.bob-progress-marks) .bob-progress-mark"),
    "session toggle hides",
  );
  assert.ok(css.includes("prefers-reduced-motion"), "calm by request");
});
