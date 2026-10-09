// Tests for the bob-ledger-tools unblocked hand-off glyph (bob-cli-5w
// phase `ledger_glyph`). Covers the read-time model
// (`unblockedTodayLinks`): a done-today prerequisite shows the glyph;
// done yesterday does not; a struck link does not; a closed entry does
// not; and several prerequisites give `+N`. Also covers the tooltip,
// the element builder, the Live Preview decorations and widget, the
// Reading-view post-processor, the session toggle, the
// `api.unblockedGlyph` v1 namespace, rebuild triggers, the lazy
// StateEffect, and the styles.css contract. The epic plan
// `plan:202610/successor_links.md` §`ledger_glyph` is authoritative.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");

const editorInfoField = { _unblockedField: "info" };
const editorLivePreviewField = { _unblockedField: "live" };

let capturedGlyphClass = null;
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
    capturedGlyphClass = cls;
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
  Module._load = function loadWithUnblockedStubs(request) {
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
  UNBLOCKED_GLYPH_TEXT,
  unblockedGlyphTooltip,
  unblockedGlyphDoneToday,
  unblockedTodayLinks,
  buildUnblockedGlyphElement,
  ensureUnblockedGlyphRefresh,
  todayDailyPath,
} = helpers;

const DAILY = todayDailyPath(new Date(), {});
assert.ok(DAILY, "test daily path resolves");
// Require-time eager `StateEffect.define()` calls: exactly the
// freshness-marks refresh. Later tests may trigger this family's
// lazy define, so the count is pinned here, before any test runs.
const EAGER_DEFINES = stateEffectDefines;

// A fixed local noon: `planDayNumber` reads local days, so Date
// objects on the same local day are robust in every timezone.
const TODAY = new Date(2026, 9, 9, 12, 0, 0);
const TODAY_MORNING = new Date(2026, 9, 9, 8, 0, 0);
const YESTERDAY = new Date(2026, 9, 8, 12, 0, 0);

// --- Stub vault ------------------------------------------------------------

// A Tasks-cache task: `{ id, dependsOn, status, doneDate, description,
// path, blockLink }`. `status` is a Tasks status type string.
function cacheTask({
  id = null,
  dependsOn = [],
  status = "TODO",
  doneDate = null,
  description = "Some task",
  taskPath = "sase.md",
  blockId = "some-task",
} = {}) {
  return {
    id,
    dependsOn: Array.isArray(dependsOn) ? dependsOn.slice() : [],
    status: { type: status, name: status.toLowerCase() },
    doneDate,
    description,
    path: taskPath,
    blockLink: " ^" + blockId,
  };
}

function linkedTask(overrides = {}) {
  return cacheTask({
    dependsOn: ["fix-apollo"],
    status: "TODO",
    description: "Re-launch all failed agents on apollo!",
    taskPath: "sase.md",
    blockId: "relaunch-agents",
    ...overrides,
  });
}

function prereqTask(overrides = {}) {
  return cacheTask({
    id: "fix-apollo",
    dependsOn: [],
    status: "DONE",
    doneDate: TODAY_MORNING,
    description: "Fix apollo machine!",
    taskPath: "sase.md",
    blockId: "fix-apollo",
    ...overrides,
  });
}

function makeGlyphApp({ cache = [], triggers = [], leaves = [] } = {}) {
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
      getCache: () => null,
      getFirstLinkpathDest: () => null,
    },
    commands: {},
    plugins: {
      plugins: {
        "obsidian-tasks-plugin": {
          getTasks: () => cache,
        },
      },
    },
  };
}

function makeGlyphPlugin(app) {
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.setupUnblockedGlyph();
  plugin.unblockedGlyphEnabled = true;
  return plugin;
}

function glyphPluginFor(cache) {
  return makeGlyphPlugin(makeGlyphApp({ cache }));
}

const OPEN_ENTRY = "- [ ] () — FIX";
const POMODOROS = "## Pomodoros";

function dailyBody(...rows) {
  return [POMODOROS, OPEN_ENTRY, ...rows].join("\n");
}

const LINK_ROW = "\t- [[sase#^relaunch-agents]]";

// --- The read-time model ---------------------------------------------------

test("a done-today prerequisite shows the glyph", () => {
  const found = unblockedTodayLinks(dailyBody(LINK_ROW), [linkedTask(), prereqTask()], TODAY);
  assert.equal(found.length, 1);
  assert.equal(found[0].line, 2);
  assert.equal(found[0].target, "sase");
  assert.equal(found[0].blockId, "relaunch-agents");
  assert.deepEqual(found[0].unblockedBy, ["Fix apollo machine!"]);
  assert.equal(
    dailyBody(LINK_ROW).split("\n")[found[0].line].slice(found[0].ch, found[0].ch + 2),
    "[[",
  );
});

test("done yesterday does not show the glyph", () => {
  const found = unblockedTodayLinks(
    dailyBody(LINK_ROW),
    [linkedTask(), prereqTask({ doneDate: YESTERDAY })],
    TODAY,
  );
  assert.deepEqual(found, []);
});

test("a struck link does not show the glyph", () => {
  const found = unblockedTodayLinks(
    dailyBody("\t- ~~[[sase#^relaunch-agents]]~~"),
    [linkedTask(), prereqTask()],
    TODAY,
  );
  assert.deepEqual(found, []);
});

test("a closed entry does not show the glyph", () => {
  const closed = [
    POMODOROS,
    "- [x] (**0900-0930** [t:: 30m]) — FIX",
    LINK_ROW,
  ].join("\n");
  const found = unblockedTodayLinks(closed, [linkedTask(), prereqTask()], TODAY);
  assert.deepEqual(found, []);
});

test("several prerequisites give +N", () => {
  const tasks = [
    linkedTask({ dependsOn: ["fix-apollo", "ship-agents"] }),
    prereqTask(),
    prereqTask({
      id: "ship-agents",
      blockId: "ship-agents",
      description: "Ship the agents!",
    }),
    prereqTask({
      id: "old-news",
      blockId: "old-news",
      description: "Old news",
      doneDate: YESTERDAY,
    }),
  ];
  // `old-news` is not a prerequisite, so only the two done-today
  // prerequisites name the glyph.
  const found = unblockedTodayLinks(dailyBody(LINK_ROW), tasks, TODAY);
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].unblockedBy, ["Fix apollo machine!", "Ship the agents!"]);
  assert.equal(
    unblockedGlyphTooltip(found[0].unblockedBy),
    "Unblocked today by ✓ Fix apollo machine! +1 more",
  );
});

test("the model refuses every non-glyph shape", () => {
  const tasks = [linkedTask(), prereqTask()];
  // A cold cache draws nothing.
  assert.deepEqual(unblockedTodayLinks(dailyBody(LINK_ROW), [], TODAY), []);
  assert.deepEqual(unblockedTodayLinks(dailyBody(LINK_ROW), null, TODAY), []);
  // A done linked task is history, not a live link.
  assert.deepEqual(
    unblockedTodayLinks(
      dailyBody(LINK_ROW),
      [linkedTask({ status: "DONE" }), prereqTask()],
      TODAY,
    ),
    [],
  );
  // A cancelled prerequisite never completed anything.
  assert.deepEqual(
    unblockedTodayLinks(
      dailyBody(LINK_ROW),
      [linkedTask(), prereqTask({ status: "CANCELLED" })],
      TODAY,
    ),
    [],
  );
  // A done prerequisite with no done date has no today.
  assert.deepEqual(
    unblockedTodayLinks(
      dailyBody(LINK_ROW),
      [linkedTask(), prereqTask({ doneDate: null })],
      TODAY,
    ),
    [],
  );
  // An unresolvable block id draws nothing.
  assert.deepEqual(
    unblockedTodayLinks(dailyBody("\t- [[sase#^missing]]"), tasks, TODAY),
    [],
  );
  // A linked task with no dependencies draws nothing.
  assert.deepEqual(
    unblockedTodayLinks(
      dailyBody(LINK_ROW),
      [linkedTask({ dependsOn: [] }), prereqTask()],
      TODAY,
    ),
    [],
  );
  // Bad input yields empty lists, never throws.
  assert.deepEqual(unblockedTodayLinks(null, tasks, TODAY), []);
  assert.deepEqual(unblockedTodayLinks(dailyBody(LINK_ROW), tasks, null), []);
  assert.deepEqual(unblockedTodayLinks(42, 42, 42), []);
});

test("unblockedGlyphDoneToday needs DONE plus a today done date", () => {
  const day = 20261009;
  assert.equal(unblockedGlyphDoneToday(prereqTask(), day), true);
  assert.equal(unblockedGlyphDoneToday(prereqTask({ doneDate: YESTERDAY }), day), false);
  assert.equal(unblockedGlyphDoneToday(prereqTask({ status: "CANCELLED" }), day), false);
  assert.equal(unblockedGlyphDoneToday(prereqTask({ doneDate: null }), day), false);
  assert.equal(unblockedGlyphDoneToday(linkedTask(), day), false);
  assert.equal(unblockedGlyphDoneToday(null, day), false);
  assert.equal(unblockedGlyphDoneToday(prereqTask(), null), false);
  // String done dates parse too.
  assert.equal(
    unblockedGlyphDoneToday(prereqTask({ doneDate: "2026-10-09T12:00:00" }), day),
    true,
  );
});

// --- Tooltip and element ---------------------------------------------------

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

test("tooltip names one prerequisite and counts several", () => {
  assert.equal(UNBLOCKED_GLYPH_TEXT, "🔓");
  assert.equal(
    unblockedGlyphTooltip(["Fix apollo machine!"]),
    "Unblocked today by ✓ Fix apollo machine!",
  );
  assert.equal(
    unblockedGlyphTooltip(["A", "B", "C"]),
    "Unblocked today by ✓ A +2 more",
  );
  assert.equal(unblockedGlyphTooltip([]), "Unblocked today");
  assert.equal(unblockedGlyphTooltip(null), "Unblocked today");

  const doc = fakeElementDoc();
  const span = buildUnblockedGlyphElement(doc, "Unblocked today by ✓ Fix apollo machine!");
  assert.ok(span);
  assert.equal(span.attrs.class, "bob-unblocked-glyph");
  assert.equal(span.attrs.role, "img");
  assert.equal(span.attrs["aria-label"], "Unblocked today by ✓ Fix apollo machine!");
  assert.equal(span.attrs.title, "Unblocked today by ✓ Fix apollo machine!");
  assert.equal(span.attrs["data-tooltip-position"], "top");
  assert.equal(span.textContent, "🔓");

  assert.equal(buildUnblockedGlyphElement(null, "x"), null);
  assert.equal(buildUnblockedGlyphElement(doc, "").textContent, "🔓");
});

// --- Live Preview ----------------------------------------------------------

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

function liveCache() {
  return [linkedTask(), prereqTask()];
}

test("Live Preview places one glyph after each unblocked link", () => {
  const plugin = glyphPluginFor(liveCache());
  const lines = dailyBody(LINK_ROW, "\t- [[sase#^other]]").split("\n");
  const decorations = plugin.buildUnblockedGlyphDecorations(
    makeView({ lines }),
  );
  // Only `^relaunch-agents` had a prerequisite completed today.
  assert.equal(decorations.adds.length, 1);
  const add = decorations.adds[0];
  assert.equal(add.from, add.to);
  const linkLine = lines[2];
  const linkEnd = linkLine.indexOf("]]") + 2;
  assert.equal(add.from, lines.slice(0, 2).join("\n").length + 1 + linkEnd);
  const widget = add.value.widget;
  assert.ok(widget instanceof StubWidgetType);
  assert.equal(
    widget.key,
    "Unblocked today by ✓ Fix apollo machine!",
    "eq compares the tooltip, not the line shape",
  );

  const rebuilt = plugin.buildUnblockedGlyphDecorations(makeView({ lines }));
  assert.equal(widget.eq(rebuilt.adds[0].value.widget), true);
  assert.equal(widget.eq(null), false);
  assert.equal(widget.eq({ key: widget.key }), false);
});

test("Live Preview draws nothing without a warm cache or a live link", () => {
  // A cold Tasks cache draws nothing.
  const cold = makeGlyphPlugin(makeGlyphApp({ cache: null }));
  assert.equal(
    cold.buildUnblockedGlyphDecorations(
      makeView({ lines: dailyBody(LINK_ROW).split("\n") }),
    ).adds.length,
    0,
  );
  // Done yesterday draws nothing.
  const stale = glyphPluginFor([
    linkedTask(),
    prereqTask({ doneDate: YESTERDAY }),
  ]);
  assert.equal(
    stale.buildUnblockedGlyphDecorations(
      makeView({ lines: dailyBody(LINK_ROW).split("\n") }),
    ).adds.length,
    0,
  );
  // Outside today's daily note the extension builds nothing.
  const plugin = glyphPluginFor(liveCache());
  assert.equal(
    plugin.buildUnblockedGlyphDecorations(
      makeView({
        lines: dailyBody(LINK_ROW).split("\n"),
        path: "1999/19990101.md",
      }),
    ),
    StubDecoration.none,
  );
  assert.equal(
    plugin.buildUnblockedGlyphDecorations(
      makeView({ lines: dailyBody(LINK_ROW).split("\n"), live: false }),
    ),
    StubDecoration.none,
  );
});

test("widget mousedown places the cursor past the link", () => {
  const plugin = glyphPluginFor(liveCache());
  const view = makeView({ lines: dailyBody(LINK_ROW).split("\n") });
  const widget = plugin.buildUnblockedGlyphDecorations(view).adds[0].value
    .widget;
  const savedDocument = global.document;
  const handlers = {};
  global.document = {
    createElement: () => ({
      _attrs: {},
      children: [],
      textContent: "",
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
  const plugin = glyphPluginFor(liveCache());
  const extension = plugin.createUnblockedGlyphExtension();
  assert.ok(extension);
  const GlyphClass = capturedGlyphClass;
  assert.ok(GlyphClass);
  const view = makeView({ lines: dailyBody(LINK_ROW).split("\n") });
  const instance = new GlyphClass(view);
  assert.equal(instance.decorations.adds.length, 1);

  // The cursor alone never rebuilds: the glyph covers no source text.
  instance.update({ view, selectionSet: true });
  assert.equal(instance.decorations.adds.length, 1);
  assert.equal(plugin.unblockedGlyphShouldRebuild({ selectionSet: true }), false);

  assert.equal(plugin.unblockedGlyphShouldRebuild({ docChanged: true }), true);
  assert.equal(
    plugin.unblockedGlyphShouldRebuild({ viewportChanged: true }),
    true,
  );
  assert.equal(plugin.unblockedGlyphShouldRebuild(null), false);
  assert.equal(plugin.unblockedGlyphShouldRebuild({}), false);

  const refresh = ensureUnblockedGlyphRefresh();
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
    nextSibling: null,
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
    nextSibling: null,
    dataset: {},
    ownerDocument: null,
    textContentValue: null,
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
  anchor.appendChild(doc.createTextNode("Re-launch"));
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

function glyphsIn(doc) {
  return doc.created.filter(
    (node) => node.getAttribute("class") === "bob-unblocked-glyph",
  );
}

test("Reading view glyphs unblocked rows and dedupes", () => {
  const doc = readingDoc();
  const plugin = glyphPluginFor(liveCache());
  const root = readingSection(doc, {
    rows: [(d) => plainRow(d, "sase#^relaunch-agents")],
  });
  const ctx = { sourcePath: DAILY };
  plugin.renderUnblockedGlyphIn(root, ctx);
  const glyphs = glyphsIn(doc);
  assert.equal(glyphs.length, 1);
  assert.equal(
    glyphs[0].getAttribute("aria-label"),
    "Unblocked today by ✓ Fix apollo machine!",
  );
  assert.equal(
    glyphs[0].getAttribute("title"),
    "Unblocked today by ✓ Fix apollo machine!",
  );
  const row = root
    .querySelectorAll("li")
    .find((li) => li.childNodes.indexOf(glyphs[0]) !== -1);
  assert.ok(row, "the glyph lands on its own row");
  assert.equal(row.dataset.bobUnblockedProcessed, "1");
  // The glyph sits after the link, never before it.
  const anchorIndex = row.childNodes.findIndex(
    (child) => child.tagName === "A",
  );
  assert.equal(row.childNodes[anchorIndex + 1], glyphs[0]);

  // A second pass inserts nothing more.
  const before = row.childNodes.length;
  plugin.renderUnblockedGlyphIn(root, ctx);
  assert.equal(row.childNodes.length, before);
});

test("Reading view refuses every non-glyph row", () => {
  const cases = {
    "blocked prereq yesterday": {
      cache: [linkedTask(), prereqTask({ doneDate: YESTERDAY })],
    },
    "closed entry": { entryTask: "x", cache: liveCache() },
    "cancelled entry": { entryTask: "-", cache: liveCache() },
    "other heading": { heading: "Tasks", cache: liveCache() },
  };
  for (const [name, options] of Object.entries(cases)) {
    const doc = readingDoc();
    const plugin = glyphPluginFor(options.cache);
    const root = readingSection(doc, {
      heading: options.heading || "Pomodoros",
      entryTask: options.entryTask || " ",
      rows: [(d) => plainRow(d, "sase#^relaunch-agents")],
    });
    plugin.renderUnblockedGlyphIn(root, { sourcePath: DAILY });
    assert.equal(glyphsIn(doc).length, 0, name);
  }

  // Prose-mixed, nested, and struck rows stay clean.
  const doc = readingDoc();
  const plugin = glyphPluginFor(liveCache());
  const root = readingSection(doc, {
    rows: [
      (d) => {
        const li = d.createElement("li");
        li.appendChild(readingText("read "));
        li.appendChild(readingLink(d, "sase#^relaunch-agents"));
        li.appendChild(readingText(" today"));
        return li;
      },
      (d, inner) => {
        const li = d.createElement("li");
        li.appendChild(readingText("nested"));
        const sub = d.createElement("ul");
        li.appendChild(sub);
        const deep = d.createElement("li");
        deep.appendChild(readingLink(d, "sase#^relaunch-agents"));
        sub.appendChild(deep);
        void inner;
        return li;
      },
      (d) => {
        const li = d.createElement("li");
        const struck = d.createElement("s");
        struck.appendChild(readingLink(d, "sase#^relaunch-agents"));
        li.appendChild(struck);
        return li;
      },
    ],
  });
  plugin.renderUnblockedGlyphIn(root, { sourcePath: DAILY });
  assert.equal(glyphsIn(doc).length, 0);

  // Off-note and disabled passes stay silent and never throw.
  plugin.renderUnblockedGlyphIn(root, { sourcePath: "1999/19990101.md" });
  plugin.unblockedGlyphEnabled = false;
  plugin.renderUnblockedGlyphIn(root, { sourcePath: DAILY });
  plugin.renderUnblockedGlyphIn(null, null);
  assert.equal(glyphsIn(doc).length, 0);
});

// --- api, toggle, and wiring ------------------------------------------------

test("api.unblockedGlyph v1 is additive, sync, and never throwing", () => {
  const plugin = glyphPluginFor(liveCache());
  const api = plugin.unblockedGlyphApi();
  assert.equal(api.version, 1);
  assert.deepEqual(Object.keys(api).sort(), ["isEnabled", "refresh", "version"]);
  assert.ok(Object.isFrozen(api));
  assert.equal(typeof api.refresh, "function");
  assert.equal(typeof api.isEnabled, "function");
  assert.equal(api.isEnabled(), true);

  // The namespace installs on the plugin class, so the frozen
  // top-level api in lifecycle picks it up without a version bump.
  assert.equal(
    Object.getOwnPropertyNames(LedgerToolsPlugin.prototype).indexOf(
      "unblockedGlyphApi",
    ) !== -1,
    true,
  );

  // Never throws, even on garbage.
  assert.doesNotThrow(() => api.refresh());
  assert.doesNotThrow(() => api.isEnabled());
  const bare = new LedgerToolsPlugin(makeGlyphApp(), {});
  assert.doesNotThrow(() => bare.unblockedGlyphApi().refresh());
  assert.equal(bare.unblockedGlyphApi().isEnabled(), false);
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
  const plugin = makeGlyphPlugin(makeGlyphApp({ leaves }));
  const commands = plugin.commands.filter(
    (command) => command.id === "toggle-unblocked-glyph",
  );
  assert.equal(commands.length, 1);
  assert.equal(
    plugin.postProcessors.filter((entry) => entry.sortOrder === 50).length >= 1,
    true,
  );
  assert.ok(plugin.editorExtensions.length >= 1);

  assert.equal(plugin.toggleUnblockedGlyph(), false);
  assert.deepEqual(TestNotice.messages.slice(-1), ["Unblocked glyph off"]);
  assert.equal(plugin.toggleUnblockedGlyph(), true);
  assert.deepEqual(TestNotice.messages.slice(-1), ["Unblocked glyph on"]);

  // Only today's daily-note editors refresh.
  dispatched.length = 0;
  plugin.refreshUnblockedGlyphEditors();
  assert.equal(
    dispatched.filter(([leaf]) => leaf === "daily").length,
    1,
  );
  assert.equal(
    dispatched.filter(([leaf]) => leaf === "other").length,
    0,
  );

  // The consolidated fan-out reaches the glyph.
  plugin.unblockedGlyphTimer = null;
  plugin.scheduleLiveWidgetRefresh();
  assert.notEqual(plugin.unblockedGlyphTimer, null);
  clearTimeout(plugin.unblockedGlyphTimer);
  plugin.unblockedGlyphTimer = null;
});

test("changed-file and rollover refreshes", () => {
  const plugin = glyphPluginFor(liveCache());
  assert.equal(plugin.refreshUnblockedGlyphForChangedFile({ path: DAILY }), true);
  clearTimeout(plugin.unblockedGlyphTimer);
  plugin.unblockedGlyphTimer = null;
  assert.equal(
    plugin.refreshUnblockedGlyphForChangedFile({ path: "unrelated.md" }),
    false,
  );
  assert.equal(plugin.refreshUnblockedGlyphForChangedFile(null), false);

  assert.equal(plugin.refreshUnblockedGlyphForRollover(new Date()), false);
  plugin.unblockedGlyphDay = "1999/19990101.md";
  assert.equal(plugin.refreshUnblockedGlyphForRollover(new Date()), true);
});

test("the refresh effect stays lazy: one eager define", () => {
  assert.equal(EAGER_DEFINES, 1, "no new eager define at require time");
  const first = ensureUnblockedGlyphRefresh();
  assert.ok(first);
  assert.equal(ensureUnblockedGlyphRefresh(), first, "lazy effect memoizes");
});

test("styles.css contract: faint glyph, Done token, toggle", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "../plugins/bob-ledger-tools/styles.css"),
    "utf8",
  );
  assert.ok(css.includes(".bob-unblocked-glyph"), "host class");
  assert.ok(
    css.includes(
      "--bob-unblocked-glyph-color, var(--task-status-done, var(--text-muted))",
    ),
    "muted Done token stack (no hex: the theme-safe gate forbids it)",
  );
  assert.ok(css.includes("opacity: 0.55"), "faint at reduced opacity");
  assert.ok(css.includes("margin-inline-start: 0.3em"), "sits after the link");
  assert.ok(
    css.includes("body:not(.bob-unblocked-glyphs) .bob-unblocked-glyph"),
    "session toggle hides",
  );
});
