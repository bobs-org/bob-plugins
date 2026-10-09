// Tests for bob-ledger-tools task tag marks (task-tag-marks).
// Covers the boundary token parser, the task-line gate, the tooltip,
// the element builder, the Live Preview decoration (inclusive reveal,
// code exclusion), the rendered-view post-processor (TR vectors), the
// session toggle, onload wiring, and the styles.css contract. The
// `docs/task-tag-marks.md` display contract in bob-cli is
// authoritative; TT/TR vectors below are that contract's conformance
// vectors verbatim (tasks_results = hide).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");

const editorInfoField = { _taskTagField: "info" };
const editorLivePreviewField = { _taskTagField: "live" };

let capturedMarkClass = null;

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
    capturedMarkClass = cls;
    return { _viewPlugin: true, cls, options };
  },
};

function stubSyntaxTree(state) {
  const tag = state && state._treeTag;
  if (tag === "codeblock") {
    return {
      resolveInner: () => ({ name: "HyperMD-codeblock", parent: null }),
    };
  }
  if (tag === "inline") {
    return {
      resolveInner: () => ({
        name: "inline-code",
        parent: { name: "Document", parent: null },
      }),
    };
  }
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

function installStubs(isDesktopApp = true) {
  const originalLoad = Module._load;
  Module._load = function loadWithTaskTagStubs(request) {
    if (request === "obsidian") {
      return {
        MarkdownView: TestMarkdownView,
        Notice: TestNotice,
        Platform: { isDesktopApp },
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

function loadPluginModule(isDesktopApp = true) {
  const originalLoad = installStubs(isDesktopApp);
  try {
    delete require.cache[MAIN_PATH];
    return require(MAIN_PATH);
  } finally {
    Module._load = originalLoad;
  }
}

const LedgerToolsPlugin = loadPluginModule(true);
const { helpers } = LedgerToolsPlugin;

const {
  TASK_TAG_MARK_TEXT,
  TASK_TAG_MARK_TOOLTIP,
  REF_TASK_TAG_TEXT,
  REF_TASK_MARK_TOOLTIP,
  REF_TASK_MARK_LABEL,
  REF_TASK_MARK_CLASS,
  REF_TASK_HIDDEN_CLASS,
  refTaskPairEnd,
  taskTagMarkTokenRanges,
  taskTagMarkRanges,
  taskTagMarkElementEligible,
  isRefTaskTagAnchor,
  refTaskPairAnchor,
  annotateTaskTagMark,
  annotateRefTaskMark,
  stripTaskTagMark,
  stripRefTaskHidden,
  buildTaskTagMarkElement,
  ensureTaskTagMarksRefresh,
  priorityMarkSource,
  dateMarkSources,
} = helpers;

const TOOLTIP = "#task \u00b7 tracked task\nCtrl+Shift+] to demote to a bullet";
const REF_TOOLTIP = "#task #ref \u00b7 reference reading task";
const REF_LABEL = "Reference reading task";

function rangeList(ranges) {
  return ranges.map((range) => [range.from, range.to]);
}

test("TT vectors verbatim: task-line gate plus boundary tokens", () => {
  assert.equal(TASK_TAG_MARK_TEXT, "#task");
  assert.equal(TASK_TAG_MARK_TOOLTIP, TOOLTIP);
  assert.deepEqual(rangeList(taskTagMarkRanges("- [ ] #task Buy milk")), [[6, 11]]);
  assert.deepEqual(
    rangeList(taskTagMarkRanges("- [x] #task Report [completion:: 2026-10-05]")),
    [[6, 11]],
  );
  assert.deepEqual(
    rangeList(taskTagMarkRanges("- [?] #task #gtd #context/home Check weather")),
    [[6, 11]],
  );
  assert.deepEqual(rangeList(taskTagMarkRanges("> - [ ] #task Quoted")), [[8, 13]]);
  assert.deepEqual(rangeList(taskTagMarkRanges("1. [ ] #task Numbered")), [[7, 12]]);
  assert.deepEqual(
    rangeList(taskTagMarkRanges("- [x] (1645-1710) #task #sase Research")),
    [[18, 23]],
  );
  assert.deepEqual(rangeList(taskTagMarkRanges("- [ ] Pack charger")), []);
  assert.deepEqual(rangeList(taskTagMarkRanges("- #task Launch epic!")), []);
  assert.deepEqual(rangeList(taskTagMarkRanges("- [ ] #tasks a")), []);
  assert.deepEqual(rangeList(taskTagMarkRanges("- [ ] #task/sub a")), []);
  assert.deepEqual(rangeList(taskTagMarkRanges("- [ ] #Task a")), []);
  assert.deepEqual(
    rangeList(taskTagMarkRanges("- [ ] Note `the #task tag` here")),
    [[16, 21]],
  );
  assert.deepEqual(rangeList(taskTagMarkRanges("- [ ] foo#task")), []);
  assert.deepEqual(rangeList(taskTagMarkRanges("- [ ] #task! Ship it")), [[6, 11]]);
  assert.deepEqual(
    rangeList(taskTagMarkRanges("- [ ] #task  [created::2026-10-07]")),
    [[6, 11]],
  );
  assert.deepEqual(rangeList(taskTagMarkRanges("- [ ] #task A #task B")), [
    [6, 11],
    [14, 19],
  ]);
  assert.deepEqual(
    rangeList(
      taskTagMarkRanges("- [ ] #task A [priority:: high] [created:: 2026-10-07]"),
    ),
    [[6, 11]],
  );
  assert.deepEqual(rangeList(taskTagMarkRanges("Paragraph #task text")), []);
  assert.deepEqual(rangeList(taskTagMarkRanges("- [ ] #task")), [[6, 11]]);
  assert.deepEqual(rangeList(taskTagMarkRanges("- [ ] (#task) parens")), []);
});

test("TT13-TT14 cursor reveal is inclusive", () => {
  const line = "- [ ] #task  [created::2026-10-07]";
  assert.deepEqual(rangeList(taskTagMarkRanges(line)), [[6, 11]]);
  const plugin = pluginWithTaskTag();
  const at = (from, to) => makeView({ lines: [line], selection: [{ from, to }] });
  assert.equal(plugin.buildTaskTagMarkDecorations(at(12, 12)).adds.length, 1);
  const milk = "- [ ] #task Buy milk";
  assert.equal(
    plugin.buildTaskTagMarkDecorations(
      makeView({ lines: [milk], selection: [{ from: 5, to: 5 }] }),
    ).adds.length,
    1,
  );
  for (const sel of [
    { from: 6, to: 6 },
    { from: 11, to: 11 },
    { from: 0, to: 20 },
  ]) {
    assert.equal(
      plugin.buildTaskTagMarkDecorations(makeView({ lines: [milk], selection: [sel] }))
        .adds.length,
      0,
      JSON.stringify(sel),
    );
  }
});

test("TT16 coexistence: task tag range is disjoint from priority and date marks", () => {
  const line = "- [ ] #task A [priority:: high] [created:: 2026-10-07]";
  const taskRanges = taskTagMarkRanges(line);
  assert.deepEqual(rangeList(taskRanges), [[6, 11]]);
  const priority = priorityMarkSource(line);
  assert.ok(priority);
  assert.ok(priority.fieldStart >= 11);
  const dates = dateMarkSources(line);
  assert.ok(dates.length >= 1);
  for (const date of dates) {
    assert.ok(date.fieldStart >= 11);
    assert.ok(taskRanges[0].to <= date.fieldStart);
  }
  assert.ok(taskRanges[0].to <= priority.fieldStart);
});

test("tooltip is exact and never contains a double colon", () => {
  assert.equal(TASK_TAG_MARK_TOOLTIP, TOOLTIP);
  assert.ok(TOOLTIP.indexOf("::") === -1);
  assert.ok(TOOLTIP.indexOf("#task") !== -1);
  assert.ok(TOOLTIP.indexOf("Ctrl+Shift+]") !== -1);
  assert.equal(taskTagMarkTokenRanges(null).length, 0);
  assert.equal(taskTagMarkRanges(null).length, 0);
  assert.equal(taskTagMarkRanges("").length, 0);
});

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

test("element structure: empty widget span with tooltip attributes", () => {
  const doc = fakeElementDoc();
  const span = buildTaskTagMarkElement(doc);
  assert.ok(span);
  assert.equal(span.attrs.class, "bob-task-tag-mark");
  assert.equal(span.attrs.role, "img");
  assert.equal(span.attrs["aria-label"], TOOLTIP);
  assert.equal(span.attrs["data-tooltip-position"], "top");
  assert.equal(span.children.length, 0);
  assert.equal(buildTaskTagMarkElement(null), null);
  assert.equal(buildTaskTagMarkElement({}), null);
});

function makeDoc(lines) {
  let offset = 0;
  const lineObjs = lines.map((text, index) => {
    const from = offset;
    const to = from + text.length;
    offset = to + 1;
    return { from, to, text, number: index + 1 };
  });
  return {
    length: Math.max(0, offset - 1),
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

function makeView({
  lines,
  selection = [],
  live = true,
  path = "a.md",
  treeTag = null,
} = {}) {
  const doc = makeDoc(lines);
  return {
    visibleRanges: [{ from: 0, to: doc.length }],
    state: {
      doc,
      _treeTag: treeTag,
      selection: { ranges: selection },
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

function makeSurfaceApp({ triggers = [], leaves = null } = {}) {
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
      getLeavesOfType: leaves || (() => []),
      trigger: (event) => triggers.push(event),
    },
    metadataCache: {
      on: () => ({}),
      getCache: () => ({}),
      getFirstLinkpathDest: () => null,
    },
    commands: {},
    plugins: { plugins: {} },
  };
}

function pluginWithTaskTag() {
  const plugin = new LedgerToolsPlugin(makeSurfaceApp(), {});
  plugin.taskTagMarksEnabled = true;
  return plugin;
}

test("Live Preview decorations cover exactly the tag and respect reveal and code", () => {
  const plugin = pluginWithTaskTag();
  const line = "- [ ] #task Buy milk";
  const built = plugin.buildTaskTagMarkDecorations(makeView({ lines: [line] }));
  assert.equal(built.adds.length, 1);
  assert.equal(built.adds[0].from, 6);
  assert.equal(built.adds[0].to, 11);
  const widget = built.adds[0].value.widget;
  assert.ok(widget instanceof StubWidgetType);
  const rebuilt = plugin.buildTaskTagMarkDecorations(makeView({ lines: [line] }));
  assert.equal(widget.eq(rebuilt.adds[0].value.widget), true);

  const two = plugin.buildTaskTagMarkDecorations(
    makeView({ lines: ["- [ ] #task A #task B"] }),
  );
  assert.equal(two.adds.length, 2);
  assert.deepEqual(
    two.adds.map((add) => [add.from, add.to]),
    [
      [6, 11],
      [14, 19],
    ],
  );

  assert.equal(
    plugin.buildTaskTagMarkDecorations(makeView({ lines: [line], live: false })),
    StubDecoration.none,
  );
  assert.equal(
    plugin.buildTaskTagMarkDecorations(makeView({ lines: [line], treeTag: "codeblock" }))
      .adds.length,
    0,
  );
  assert.equal(
    plugin.buildTaskTagMarkDecorations(makeView({ lines: [line], treeTag: "inline" }))
      .adds.length,
    0,
  );
  assert.equal(
    plugin.buildTaskTagMarkDecorations(
      makeView({ lines: ["- [ ] Note `the #task tag` here"], treeTag: "inline" }),
    ).adds.length,
    0,
  );
  assert.equal(
    plugin.buildTaskTagMarkDecorations(makeView({ lines: ["- plain bullet #task"] }))
      .adds.length,
    0,
  );
  assert.equal(
    plugin.buildTaskTagMarkDecorations(makeView({ lines: ["- [ ] #tasks a"] }))
      .adds.length,
    0,
  );
  plugin.taskTagMarksEnabled = false;
  assert.equal(
    plugin.buildTaskTagMarkDecorations(makeView({ lines: [line] })),
    StubDecoration.none,
  );
  plugin.taskTagMarksEnabled = true;
  assert.equal(
    plugin.buildTaskTagMarkDecorations(makeView({ lines: [line], path: null })),
    StubDecoration.none,
  );
});

test("widget mousedown reveals the tag start", () => {
  const plugin = pluginWithTaskTag();
  const line = "- [ ] #task Buy milk";
  const view = makeView({ lines: [line] });
  const widget = plugin.buildTaskTagMarkDecorations(view).adds[0].value.widget;
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

function fakeRenderTree() {
  function makeEl(tag) {
    const node = {
      nodeType: 1,
      tagName: String(tag).toUpperCase(),
      nodeName: String(tag).toUpperCase(),
      className: "",
      textContent: "",
      childNodes: [],
      parentNode: null,
      ownerDocument: null,
      _attrs: {},
      classList: {
        add(name) {
          const parts = String(node.className || "")
            .split(/\s+/)
            .filter((part) => part !== "");
          if (!parts.includes(name)) {
            parts.push(name);
          }
          node.className = parts.join(" ");
        },
        remove(name) {
          node.className = String(node.className || "")
            .split(/\s+/)
            .filter((part) => part !== "" && part !== name)
            .join(" ");
        },
        contains(name) {
          return String(node.className || "")
            .split(/\s+/)
            .includes(name);
        },
      },
      getAttribute(name) {
        if (name === "class") {
          return node.className;
        }
        return Object.prototype.hasOwnProperty.call(node._attrs, name)
          ? node._attrs[name]
          : null;
      },
      setAttribute(name, value) {
        node._attrs[name] = String(value);
        if (name === "class") {
          node.className = String(value);
        }
      },
      removeAttribute(name) {
        delete node._attrs[name];
      },
      appendChild(child) {
        child.parentNode = node;
        node.childNodes.push(child);
        return child;
      },
    };
    return node;
  }
  const doc = {
    createElement: (tag) => makeEl(tag),
    createElementNS: (ns, tag) => makeEl(tag),
    createTextNode: (value) => ({
      nodeType: 3,
      nodeValue: String(value),
      textContent: String(value),
      parentNode: null,
      ownerDocument: doc,
    }),
    createTreeWalker: (root) => {
      const all = [];
      const stack = [root];
      while (stack.length > 0) {
        const node = stack.pop();
        if (!node) {
          continue;
        }
        if (node.nodeType === 3) {
          all.push(node);
          continue;
        }
        const kids = node.childNodes || [];
        for (let index = kids.length - 1; index >= 0; index -= 1) {
          stack.push(kids[index]);
        }
      }
      let at = 0;
      return { nextNode: () => (at < all.length ? all[at++] : null) };
    },
  };
  const root = makeEl("div");
  root.ownerDocument = doc;
  return { root, doc, makeEl };
}

function makeAnchor(fx, { text = "#task", href = "#task", className = "tag" } = {}) {
  const anchor = fx.makeEl("a");
  anchor.className = className;
  anchor.textContent = text;
  if (href !== null) {
    anchor.setAttribute("href", href);
  }
  return anchor;
}

function makeTaskLi(fx, anchor) {
  const li = fx.makeEl("li");
  li.className = "task-list-item";
  fx.root.appendChild(li);
  li.appendChild(anchor);
  return li;
}

function annotatedAnchors(fx) {
  const found = [];
  const stack = [fx.root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (
      node.nodeType === 1 &&
      String(node.className || "")
        .split(/\s+/)
        .includes("bob-task-tag-mark")
    ) {
      found.push(node);
    }
    for (const child of node.childNodes || []) {
      stack.push(child);
    }
  }
  return found;
}

test("TR vectors verbatim: rendered views annotate eligible anchors in place", () => {
  const plugin = pluginWithTaskTag();
  const ctx = { sourcePath: "a.md" };

  const fx1 = fakeRenderTree();
  const a1 = makeAnchor(fx1);
  makeTaskLi(fx1, a1);
  assert.equal(taskTagMarkElementEligible(a1, fx1.root), true);
  plugin.renderTaskTagMarksIn(fx1.root, ctx);
  assert.equal(annotatedAnchors(fx1).length, 1);
  assert.equal(a1.getAttribute("aria-label"), TOOLTIP);
  assert.equal(a1.getAttribute("data-tooltip-position"), "top");
  assert.ok(a1.textContent === "#task");
  plugin.renderTaskTagMarksIn(fx1.root, ctx);
  assert.equal(annotatedAnchors(fx1).length, 1);

  const fx2 = fakeRenderTree();
  const li2 = fx2.makeEl("li");
  li2.className = "task-list-item";
  fx2.root.appendChild(li2);
  const p2 = fx2.makeEl("p");
  li2.appendChild(p2);
  const a2 = makeAnchor(fx2);
  p2.appendChild(a2);
  assert.equal(taskTagMarkElementEligible(a2, fx2.root), true);
  plugin.renderTaskTagMarksIn(fx2.root, ctx);
  assert.equal(annotatedAnchors(fx2).length, 1);

  const fx3 = fakeRenderTree();
  const outer3 = fx3.makeEl("li");
  outer3.className = "task-list-item";
  fx3.root.appendChild(outer3);
  const ul3 = fx3.makeEl("ul");
  outer3.appendChild(ul3);
  const inner3 = fx3.makeEl("li");
  ul3.appendChild(inner3);
  const a3 = makeAnchor(fx3);
  inner3.appendChild(a3);
  assert.equal(taskTagMarkElementEligible(a3, fx3.root), false);
  plugin.renderTaskTagMarksIn(fx3.root, ctx);
  assert.equal(annotatedAnchors(fx3).length, 0);

  const fx4 = fakeRenderTree();
  const outer4 = fx4.makeEl("li");
  fx4.root.appendChild(outer4);
  const ul4 = fx4.makeEl("ul");
  outer4.appendChild(ul4);
  const inner4 = fx4.makeEl("li");
  inner4.className = "task-list-item";
  ul4.appendChild(inner4);
  const a4 = makeAnchor(fx4);
  inner4.appendChild(a4);
  assert.equal(taskTagMarkElementEligible(a4, fx4.root), true);
  plugin.renderTaskTagMarksIn(fx4.root, ctx);
  assert.equal(annotatedAnchors(fx4).length, 1);

  for (const bad of ["#Task", "#tasks"]) {
    const fx = fakeRenderTree();
    const badAnchor = makeAnchor(fx, { text: bad, href: bad });
    makeTaskLi(fx, badAnchor);
    assert.equal(taskTagMarkElementEligible(badAnchor, fx.root), false);
    plugin.renderTaskTagMarksIn(fx.root, ctx);
    assert.equal(annotatedAnchors(fx).length, 0, bad);
  }

  const fx6 = fakeRenderTree();
  const tasksRow = fx6.makeEl("li");
  tasksRow.className = "plugin-tasks-list-item";
  fx6.root.appendChild(tasksRow);
  const desc = fx6.makeEl("span");
  desc.className = "task-description";
  tasksRow.appendChild(desc);
  const a6 = makeAnchor(fx6);
  desc.appendChild(a6);
  assert.equal(taskTagMarkElementEligible(a6, fx6.root), false);
  plugin.renderTaskTagMarksIn(fx6.root, ctx);
  assert.equal(annotatedAnchors(fx6).length, 0);

  const fx7 = fakeRenderTree();
  const detached = makeAnchor(fx7);
  fx7.root.appendChild(detached);
  assert.equal(taskTagMarkElementEligible(detached, fx7.root), false);
  const orphan = makeAnchor(fx7);
  assert.equal(taskTagMarkElementEligible(orphan, fx7.root), false);

  const fxCode = fakeRenderTree();
  const liCode = fxCode.makeEl("li");
  liCode.className = "task-list-item";
  fxCode.root.appendChild(liCode);
  const code = fxCode.makeEl("code");
  liCode.appendChild(code);
  const aCode = makeAnchor(fxCode);
  code.appendChild(aCode);
  assert.equal(taskTagMarkElementEligible(aCode, fxCode.root), false);

  const fxOff = fakeRenderTree();
  const aOff = makeAnchor(fxOff);
  makeTaskLi(fxOff, aOff);
  plugin.taskTagMarksEnabled = false;
  plugin.renderTaskTagMarksIn(fxOff.root, ctx);
  assert.equal(annotatedAnchors(fxOff).length, 0);
});

test("TR9 toggle strips document-wide and re-annotates on enable", () => {
  const savedDocument = global.document;
  const fx = fakeRenderTree();
  const anchor = makeAnchor(fx);
  makeTaskLi(fx, anchor);
  const body = fx.root;
  body.querySelectorAll = (selector) => {
    const found = [];
    const stack = [body];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node.nodeType === 1) {
        const classes = String(node.className || "").split(/\s+/);
        if (selector === "a.tag.bob-task-tag-mark") {
          if (
            String(node.tagName).toUpperCase() === "A" &&
            classes.includes("bob-task-tag-mark")
          ) {
            found.push(node);
          }
        } else if (selector === "a.tag") {
          if (String(node.tagName).toUpperCase() === "A") {
            found.push(node);
          }
        }
      }
      for (const child of node.childNodes || []) {
        stack.push(child);
      }
    }
    return found;
  };
  global.document = { body, createElement: fx.doc.createElement.bind(fx.doc) };
  try {
    const plugin = pluginWithTaskTag();
    assert.equal(plugin.taskTagMarksEnabled, true);
    plugin.renderTaskTagMarksIn(fx.root, { sourcePath: "a.md" });
    assert.equal(annotatedAnchors(fx).length, 1);
    assert.equal(plugin.toggleTaskTagMarks(), false);
    assert.equal(annotatedAnchors(fx).length, 0);
    assert.equal(anchor.getAttribute("aria-label"), null);
    assert.equal(plugin.toggleTaskTagMarks(), true);
    assert.equal(annotatedAnchors(fx).length, 1);
    assert.equal(anchor.getAttribute("aria-label"), TOOLTIP);
  } finally {
    if (savedDocument === undefined) {
      delete global.document;
    } else {
      global.document = savedDocument;
    }
  }
});

test("annotate and strip helpers are idempotent and defensive", () => {
  const fx = fakeRenderTree();
  const anchor = makeAnchor(fx);
  makeTaskLi(fx, anchor);
  assert.equal(annotateTaskTagMark(anchor), true);
  assert.equal(annotateTaskTagMark(anchor), true);
  assert.equal(anchor.getAttribute("aria-label"), TOOLTIP);
  assert.equal(stripTaskTagMark(anchor), true);
  assert.equal(anchor.getAttribute("aria-label"), null);
  assert.equal(anchor.getAttribute("data-tooltip-position"), null);
  assert.equal(annotateTaskTagMark(null), false);
  assert.equal(stripTaskTagMark(null), false);
  assert.equal(taskTagMarkElementEligible(null, fx.root), false);
});

test("session toggle and onload wiring", () => {
  capturedMarkClass = null;
  const savedDocument = global.document;
  const classes = new Set();
  global.document = {
    body: {
      classList: {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
      },
    },
  };
  TestNotice.messages = [];
  try {
    const triggers = [];
    const dispatched = [];
    const leaves = () => [
      { view: { editor: { cm: { dispatch: (tr) => dispatched.push(tr) } } } },
    ];
    const plugin = new LedgerToolsPlugin(makeSurfaceApp({ triggers, leaves }), {});
    plugin.onload();
    try {
      assert.equal(plugin.taskTagMarksEnabled, true);
      assert.ok(classes.has("bob-task-tag-marks"));
      const toggle = (plugin.commands || []).find(
        (command) => command.id === "toggle-task-tag-marks",
      );
      assert.ok(toggle);
      assert.equal(toggle.name, "Toggle task tag marks");
      assert.ok((plugin.editorExtensions || []).length >= 4);
      assert.ok(capturedMarkClass);
      const posts = (plugin.postProcessors || []).filter(
        (entry) => entry.sortOrder === 50,
      );
      assert.ok(posts.length >= 3);
      plugin.refreshTaskTagMarkEditors();
      assert.equal(dispatched.length, 1);
      assert.ok(dispatched[0].effects);
      assert.equal(plugin.toggleTaskTagMarks(), false);
      assert.equal(classes.has("bob-task-tag-marks"), false);
      assert.equal(plugin.toggleTaskTagMarks(), true);
      assert.equal(classes.has("bob-task-tag-marks"), true);
      assert.ok(
        TestNotice.messages.indexOf("Task tag marks off") !== -1,
        JSON.stringify(TestNotice.messages),
      );
      assert.ok(
        TestNotice.messages.indexOf("Task tag marks on") !== -1,
        JSON.stringify(TestNotice.messages),
      );
      assert.ok(
        triggers.indexOf("obsidian-tasks-plugin:reload-open-search-results") !== -1,
      );
      plugin.taskTagMarksEnabled = false;
      assert.equal(
        plugin.buildTaskTagMarkDecorations(makeView({ lines: ["- [ ] #task A"] })),
        StubDecoration.none,
      );
    } finally {
      plugin.onunload();
    }
    assert.equal(classes.has("bob-task-tag-marks"), false);
  } finally {
    if (savedDocument === undefined) {
      delete global.document;
    } else {
      global.document = savedDocument;
    }
  }
});

test("styles.css contract: teal identity ink, glyph, both hosts, hover, hide in Tasks, resting, print, motion", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "..", "plugins", "bob-ledger-tools", "styles.css"),
    "utf8",
  );
  const count = (needle) => css.split(needle).length - 1;
  assert.equal(count("--bob-task-tag-glyph:"), 1);
  assert.equal(count("--bob-task-tag-hue:"), 1);
  const hueAt = css.indexOf("--bob-task-tag-hue:");
  const hueLine = css.slice(hueAt, css.indexOf(";", hueAt) + 1);
  assert.ok(hueLine.indexOf("var(--color-cyan, #00bfbc)") !== -1);
  assert.ok(hueLine.indexOf("var(--text-normal)") !== -1);
  assert.ok(css.indexOf("stroke-width='1.8'") !== -1);
  assert.ok(css.indexOf("stroke-width='1.6'") === -1);
  assert.ok(
    css.indexOf("--bob-task-tag-ink: var(--bob-task-tag-color, var(--bob-task-tag-hue))") !== -1,
  );
  assert.ok(
    css.indexOf("body.bob-task-tag-marks a.tag.bob-task-tag-mark:hover") !== -1,
  );
  assert.ok(
    css.indexOf("color-mix(in srgb, var(--bob-task-tag-ink) 14%, transparent)") !== -1,
  );
  assert.ok(
    css.indexOf(
      "color-mix(in srgb, var(--bob-task-tag-color, var(--bob-task-tag-hue)) 40%, var(--text-faint))",
    ) !== -1,
  );
  assert.ok(css.indexOf("opacity: 0.75") !== -1);
  const hostAt = css.indexOf("body.bob-task-tag-marks a.tag.bob-task-tag-mark {");
  assert.ok(hostAt !== -1);
  const hostBlock = css.slice(hostAt, css.indexOf("}", hostAt) + 1);
  assert.ok(hostBlock.indexOf("--bob-task-tag-ink:") === -1);
  const blockStart = css.indexOf("Task tag marks (task-tag-marks)");
  const blockEnd = css.indexOf("Task Link In Progress marks");
  assert.ok(blockStart !== -1 && blockEnd !== -1 && blockEnd > blockStart);
  const block = css.slice(blockStart, blockEnd);
  for (const banned of [
    "--color-red",
    "--color-orange",
    "--color-yellow",
    "--color-green",
    "--color-blue",
    "--task-status-",
  ]) {
    assert.ok(block.indexOf(banned) === -1, banned);
  }
  assert.ok(css.indexOf("M6.5 3 5.5 13M10.5 3 9.5 13M3.5 6.25h9M3.5 9.75h9") !== -1);
  assert.ok(
    css.indexOf("body.bob-task-tag-marks .bob-task-tag-mark") !== -1,
  );
  assert.ok(
    css.indexOf("body.bob-task-tag-marks a.tag.bob-task-tag-mark") !== -1,
  );
  assert.ok(css.indexOf("mask-image: var(--bob-task-tag-glyph)") !== -1);
  assert.ok(css.indexOf("-webkit-mask-image: var(--bob-task-tag-glyph)") !== -1);
  const tasksSelector =
    "body.bob-task-tag-marks .plugin-tasks-list-item .task-description a.tag:is(";
  assert.ok(css.indexOf(tasksSelector) !== -1);
  const tasksAt = css.indexOf(tasksSelector);
  const tasksBlock = css.slice(tasksAt, tasksAt + 400);
  assert.ok(tasksBlock.indexOf("display: none") !== -1);
  assert.ok(tasksBlock.indexOf('[data-tag-name="#task"]') !== -1);
  assert.ok(tasksBlock.indexOf('[href="#task"]') !== -1);
  assert.ok(
    css.indexOf('li.task-list-item[data-task="x"] .bob-task-tag-mark') !== -1,
  );
  assert.ok(
    css.indexOf('.HyperMD-task-line[data-task="x"] .bob-task-tag-mark') !== -1,
  );
  assert.ok(css.indexOf("print-color-adjust: exact") !== -1);
  assert.ok(css.indexOf("-webkit-print-color-adjust: exact") !== -1);
  assert.ok(css.indexOf("prefers-reduced-motion") !== -1);
  assert.ok(css.indexOf("color: transparent") !== -1);
});

test("TT20-TT28 verbatim: the #task #ref pair yields one ref range spanning both tokens", () => {
  assert.equal(REF_TASK_TAG_TEXT, "#ref");
  assert.equal(REF_TASK_MARK_TOOLTIP, REF_TOOLTIP);
  assert.equal(REF_TASK_MARK_LABEL, REF_LABEL);
  assert.ok(REF_TOOLTIP.indexOf("::") === -1);
  const kinds = (line) => taskTagMarkRanges(line).map((range) => range.kind);
  const spans = (line) =>
    taskTagMarkRanges(line).map((range) => [range.from, range.to]);

  // TT20: the pair on an open line is one range covering both tokens.
  assert.deepEqual(spans("- [ ] #task #ref Harness Engineering"), [[6, 16]]);
  assert.deepEqual(kinds("- [ ] #task #ref Harness Engineering"), ["ref"]);
  // TT21: the pair on a closed line (resting tone is CSS).
  assert.deepEqual(
    spans("- [x] #task #ref Done book [completion:: 2026-10-05]"),
    [[6, 16]],
  );
  assert.deepEqual(
    kinds("- [x] #task #ref Done book [completion:: 2026-10-05]"),
    ["ref"],
  );
  // TT22: `#REF` pairs (case-insensitive partner).
  assert.deepEqual(spans("- [ ] #task #REF Loud"), [[6, 16]]);
  assert.deepEqual(kinds("- [ ] #task #REF Loud"), ["ref"]);
  // TT23: extra whitespace between the tokens still pairs.
  assert.deepEqual(spans("- [ ] #task   #ref Extra spaces"), [[6, 18]]);
  assert.deepEqual(kinds("- [ ] #task   #ref Extra spaces"), ["ref"]);
  // TT24: `#task #references` is the hash only.
  assert.deepEqual(spans("- [ ] #task #references Not a ref"), [[6, 11]]);
  assert.deepEqual(kinds("- [ ] #task #references Not a ref"), ["task"]);
  // TT25: `#ref #task` order is the hash only, on `#task`.
  assert.deepEqual(spans("- [ ] #ref #task Reversed"), [[11, 16]]);
  assert.deepEqual(kinds("- [ ] #ref #task Reversed"), ["task"]);
  // TT26: `#ref` alone gets no mark.
  assert.deepEqual(spans("- [ ] #ref Alone"), []);
  // TT27: the pair on a non-task line gets no mark.
  assert.deepEqual(spans("- #task #ref Not a task"), []);
  assert.deepEqual(spans("Paragraph #task #ref text"), []);
  // TT28: inline code still reports from the core (like TT10); the
  // decoration builder drops it.
  assert.deepEqual(spans("- [ ] Note `the #task #ref pair` here"), [[16, 26]]);
  assert.deepEqual(kinds("- [ ] Note `the #task #ref pair` here"), ["ref"]);
  // Mixed lines keep each token's own kind.
  assert.deepEqual(spans("- [ ] #task A #task #ref B"), [
    [6, 11],
    [14, 24],
  ]);
  assert.deepEqual(kinds("- [ ] #task A #task #ref B"), ["task", "ref"]);
  // The token scanner itself is unchanged (no kind, hash only).
  assert.deepEqual(
    taskTagMarkTokenRanges("- [ ] #task #ref Harness").map((range) => [
      range.from,
      range.to,
    ]),
    [[6, 11]],
  );
  // Pair-end helper boundaries.
  assert.equal(refTaskPairEnd("- [ ] #task #ref Harness", 11), 16);
  assert.equal(refTaskPairEnd("- [ ] #task #references No", 11), -1);
  assert.equal(refTaskPairEnd("- [ ] #task#ref No", 11), -1);
  assert.equal(refTaskPairEnd("- [ ] #task", 11), -1);
  assert.equal(refTaskPairEnd(null, 11), -1);
});

test("Live Preview ref decorations replace the whole pair and reveal both tags at once", () => {
  const plugin = pluginWithTaskTag();
  const line = "- [ ] #task #ref Harness Engineering";
  const built = plugin.buildTaskTagMarkDecorations(makeView({ lines: [line] }));
  assert.equal(built.adds.length, 1);
  assert.equal(built.adds[0].from, 6);
  assert.equal(built.adds[0].to, 16);
  const widget = built.adds[0].value.widget;
  assert.equal(widget.key, "ref-task-mark");
  const rebuilt = plugin.buildTaskTagMarkDecorations(makeView({ lines: [line] }));
  assert.equal(widget.eq(rebuilt.adds[0].value.widget), true);
  // A hash widget and a book widget never compare equal.
  const hash = plugin.buildTaskTagMarkDecorations(
    makeView({ lines: ["- [ ] #task Plain"] }),
  ).adds[0].value.widget;
  assert.equal(hash.key, "task-tag-mark");
  assert.equal(widget.eq(hash), false);
  assert.equal(hash.eq(widget), false);
  // Reveal is inclusive over the whole span: a cursor touching either
  // tag (or a selection covering both) exposes both raw tags.
  for (const sel of [
    { from: 6, to: 6 },
    { from: 11, to: 11 },
    { from: 12, to: 12 },
    { from: 16, to: 16 },
    { from: 0, to: 20 },
  ]) {
    assert.equal(
      plugin.buildTaskTagMarkDecorations(makeView({ lines: [line], selection: [sel] }))
        .adds.length,
      0,
      JSON.stringify(sel),
    );
  }
  assert.equal(
    plugin.buildTaskTagMarkDecorations(makeView({ lines: [line], selection: [{ from: 5, to: 5 }] }))
      .adds.length,
    1,
  );
  // Code exclusion still drops the pair (TT28).
  assert.equal(
    plugin.buildTaskTagMarkDecorations(
      makeView({ lines: ["- [ ] Note `the #task #ref pair` here"], treeTag: "inline" }),
    ).adds.length,
    0,
  );
});

test("ref element structure: book classes, reference label, and tooltip", () => {
  const doc = fakeElementDoc();
  const span = buildTaskTagMarkElement(doc, "ref");
  assert.ok(span);
  assert.equal(span.attrs.class, "bob-task-tag-mark " + REF_TASK_MARK_CLASS);
  assert.equal(span.attrs.role, "img");
  assert.equal(span.attrs["aria-label"], REF_LABEL);
  assert.equal(span.attrs.title, REF_TOOLTIP);
  assert.equal(span.attrs["data-tooltip-position"], "top");
  assert.equal(span.children.length, 0);
  // The hash path is unchanged.
  const hash = buildTaskTagMarkElement(doc);
  assert.equal(hash.attrs.class, "bob-task-tag-mark");
  assert.equal(hash.attrs["aria-label"], TOOLTIP);
});

function makePairTree({ refText = "#ref", gap = " ", taskText = "#task" } = {}) {
  const fx = fakeRenderTree();
  const li = fx.makeEl("li");
  li.className = "task-list-item";
  fx.root.appendChild(li);
  const task = makeAnchor(fx, { text: taskText, href: taskText });
  li.appendChild(task);
  const space = fx.doc.createTextNode(gap);
  li.appendChild(space);
  const ref = makeAnchor(fx, { text: refText, href: refText });
  li.appendChild(ref);
  return { fx, li, task, ref };
}

test("TR10 verbatim: the #task anchor becomes the book and the adjacent #ref anchor hides", () => {
  const plugin = pluginWithTaskTag();
  const ctx = { sourcePath: "a.md" };
  const { fx, task, ref } = makePairTree();
  assert.equal(taskTagMarkElementEligible(task, fx.root), true);
  assert.equal(isRefTaskTagAnchor(ref), true);
  assert.equal(refTaskPairAnchor(task), ref);
  plugin.renderTaskTagMarksIn(fx.root, ctx);
  const classes = String(task.className || "").split(/\s+/);
  assert.ok(classes.includes("bob-task-tag-mark"));
  assert.ok(classes.includes(REF_TASK_MARK_CLASS));
  assert.equal(task.getAttribute("aria-label"), REF_LABEL);
  assert.equal(task.getAttribute("title"), REF_TOOLTIP);
  assert.ok(task.textContent === "#task");
  assert.ok(
    String(ref.className || "").split(/\s+/).includes(REF_TASK_HIDDEN_CLASS),
  );
  // Idempotent: a second pass changes nothing.
  plugin.renderTaskTagMarksIn(fx.root, ctx);
  assert.ok(
    String(ref.className || "").split(/\s+/).includes(REF_TASK_HIDDEN_CLASS),
  );
  // Case-insensitive partner.
  const loud = makePairTree({ refText: "#REF", gap: "  " });
  assert.equal(refTaskPairAnchor(loud.task), loud.ref);
  plugin.renderTaskTagMarksIn(loud.fx.root, ctx);
  assert.ok(
    String(loud.task.className || "").split(/\s+/).includes(REF_TASK_MARK_CLASS),
  );
  // A non-whitespace gap breaks the pair: the hash stays a hash and
  // the `#ref` pill is untouched.
  const broken = makePairTree({ gap: " and " });
  assert.equal(refTaskPairAnchor(broken.task), null);
  plugin.renderTaskTagMarksIn(broken.fx.root, ctx);
  const brokenClasses = String(broken.task.className || "").split(/\s+/);
  assert.ok(brokenClasses.includes("bob-task-tag-mark"));
  assert.ok(!brokenClasses.includes(REF_TASK_MARK_CLASS));
  assert.ok(
    !String(broken.ref.className || "").split(/\s+/).includes(REF_TASK_HIDDEN_CLASS),
  );
});

test("TR11 verbatim: #task #references and reversed order keep the hash only", () => {
  const plugin = pluginWithTaskTag();
  const ctx = { sourcePath: "a.md" };
  const fx = fakeRenderTree();
  const li = fx.makeEl("li");
  li.className = "task-list-item";
  fx.root.appendChild(li);
  const task = makeAnchor(fx);
  li.appendChild(task);
  li.appendChild(fx.doc.createTextNode(" "));
  const longer = makeAnchor(fx, { text: "#references", href: "#references" });
  li.appendChild(longer);
  assert.equal(isRefTaskTagAnchor(longer), false);
  assert.equal(refTaskPairAnchor(task), null);
  plugin.renderTaskTagMarksIn(fx.root, ctx);
  assert.ok(String(task.className || "").split(/\s+/).includes("bob-task-tag-mark"));
  assert.ok(
    !String(task.className || "").split(/\s+/).includes(REF_TASK_MARK_CLASS),
  );

  const rev = fakeRenderTree();
  const revLi = rev.makeEl("li");
  revLi.className = "task-list-item";
  rev.root.appendChild(revLi);
  const first = makeAnchor(rev, { text: "#ref", href: "#ref" });
  revLi.appendChild(first);
  revLi.appendChild(rev.doc.createTextNode(" "));
  const second = makeAnchor(rev);
  revLi.appendChild(second);
  assert.equal(taskTagMarkElementEligible(second, rev.root), true);
  assert.equal(refTaskPairAnchor(second), null);
  plugin.renderTaskTagMarksIn(rev.root, ctx);
  assert.ok(
    String(second.className || "").split(/\s+/).includes("bob-task-tag-mark"),
  );
  assert.ok(
    !String(second.className || "").split(/\s+/).includes(REF_TASK_MARK_CLASS),
  );
});

test("TR12 verbatim: Tasks rows never annotate (the #ref book is CSS-only)", () => {
  const plugin = pluginWithTaskTag();
  const ctx = { sourcePath: "a.md" };
  const fx = fakeRenderTree();
  const tasksRow = fx.makeEl("li");
  tasksRow.className = "plugin-tasks-list-item";
  fx.root.appendChild(tasksRow);
  const desc = fx.makeEl("span");
  desc.className = "task-description";
  tasksRow.appendChild(desc);
  const ref = makeAnchor(fx, { text: "#ref", href: "#ref" });
  desc.appendChild(ref);
  assert.equal(taskTagMarkElementEligible(ref, fx.root), false);
  plugin.renderTaskTagMarksIn(fx.root, ctx);
  assert.equal(String(ref.className || "").split(/\s+/).includes("bob-task-tag-mark"), false);
  assert.equal(
    String(ref.className || "").split(/\s+/).includes(REF_TASK_HIDDEN_CLASS),
    false,
  );
});

test("TR13 toggle covers the new classes: off strips the book and reveals #ref, on restores both", () => {
  const savedDocument = global.document;
  const { fx, task, ref } = makePairTree();
  const body = fx.root;
  body.querySelectorAll = (selector) => {
    const wants = String(selector || "")
      .split(".")
      .filter((part) => part !== "" && part !== "a" && part !== "tag");
    const found = [];
    const stack = [body];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node.nodeType === 1) {
        const classes = String(node.className || "").split(/\s+/);
        if (
          String(node.tagName).toUpperCase() === "A" &&
          wants.every((want) => classes.includes(want))
        ) {
          found.push(node);
        }
      }
      for (const child of node.childNodes || []) {
        stack.push(child);
      }
    }
    return found;
  };
  global.document = { body, createElement: fx.doc.createElement.bind(fx.doc) };
  try {
    const plugin = pluginWithTaskTag();
    plugin.renderTaskTagMarksIn(fx.root, { sourcePath: "a.md" });
    assert.ok(String(task.className || "").split(/\s+/).includes(REF_TASK_MARK_CLASS));
    assert.ok(
      String(ref.className || "").split(/\s+/).includes(REF_TASK_HIDDEN_CLASS),
    );
    assert.equal(plugin.toggleTaskTagMarks(), false);
    assert.ok(
      !String(task.className || "").split(/\s+/).includes(REF_TASK_MARK_CLASS),
    );
    assert.ok(
      !String(task.className || "").split(/\s+/).includes("bob-task-tag-mark"),
    );
    assert.ok(
      !String(ref.className || "").split(/\s+/).includes(REF_TASK_HIDDEN_CLASS),
    );
    assert.equal(ref.getAttribute("aria-label"), null);
    assert.equal(plugin.toggleTaskTagMarks(), true);
    assert.ok(String(task.className || "").split(/\s+/).includes(REF_TASK_MARK_CLASS));
    assert.ok(
      String(ref.className || "").split(/\s+/).includes(REF_TASK_HIDDEN_CLASS),
    );
    assert.equal(task.getAttribute("aria-label"), REF_LABEL);
    // Direct helper round-trip.
    assert.equal(annotateRefTaskMark(task, ref), true);
    assert.equal(stripRefTaskHidden(ref), true);
    assert.ok(
      !String(ref.className || "").split(/\s+/).includes(REF_TASK_HIDDEN_CLASS),
    );
    assert.equal(annotateRefTaskMark(null, ref), false);
    assert.equal(stripRefTaskHidden(null), false);
    assert.equal(refTaskPairAnchor(null), null);
    assert.equal(isRefTaskTagAnchor(null), false);
  } finally {
    if (savedDocument === undefined) {
      delete global.document;
    } else {
      global.document = savedDocument;
    }
  }
});

test("styles.css contract for reference reading tasks: glyph, variant, resting, hidden partner, Tasks book", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "..", "plugins", "bob-ledger-tools", "styles.css"),
    "utf8",
  );
  const count = (needle) => css.split(needle).length - 1;
  assert.equal(count("--bob-ref-task-glyph:"), 1);
  const glyphAt = css.indexOf("--bob-ref-task-glyph:");
  const glyphLine = css.slice(glyphAt, css.indexOf(";", glyphAt) + 1);
  assert.ok(glyphLine.indexOf("viewBox='0 0 16 16'") !== -1);
  assert.ok(glyphLine.indexOf("stroke-width='1.8'") !== -1);
  assert.ok(glyphLine.indexOf("stroke-linecap='round'") !== -1);
  assert.ok(glyphLine.indexOf("stroke-linejoin='round'") !== -1);
  assert.ok(glyphLine.indexOf("M8 4.5") !== -1);
  assert.ok(
    css.indexOf("body.bob-task-tag-marks .bob-task-tag-mark.bob-ref-task-mark::before") !== -1,
  );
  assert.ok(css.indexOf("mask-image: var(--bob-ref-task-glyph)") !== -1);
  assert.ok(css.indexOf("-webkit-mask-image: var(--bob-ref-task-glyph)") !== -1);
  for (const status of ["x", "X", "-"]) {
    assert.ok(
      css.indexOf(
        `li.task-list-item[data-task="${status}"] .bob-task-tag-mark.bob-ref-task-mark`,
      ) !== -1,
      status,
    );
    assert.ok(
      css.indexOf(
        `.HyperMD-task-line[data-task="${status}"] .bob-task-tag-mark.bob-ref-task-mark`,
      ) !== -1,
      status,
    );
  }
  const hiddenSelector = "body.bob-task-tag-marks a.tag.bob-ref-task-hidden";
  assert.ok(css.indexOf(hiddenSelector) !== -1);
  const hiddenAt = css.indexOf(hiddenSelector);
  assert.ok(css.slice(hiddenAt, hiddenAt + 300).indexOf("display: none") !== -1);
  const tasksSelector =
    "body.bob-task-tag-marks .plugin-tasks-list-item .task-description a.tag:is(";
  const tasksRefAt = css.indexOf(tasksSelector, css.indexOf("--bob-ref-task-glyph:"));
  assert.ok(tasksRefAt !== -1);
  const tasksRefBlock = css.slice(tasksRefAt, tasksRefAt + 500);
  assert.ok(tasksRefBlock.indexOf('[data-tag-name="#ref" i]') !== -1);
  assert.ok(tasksRefBlock.indexOf('[href="#ref" i]') !== -1);
  assert.ok(tasksRefBlock.indexOf("display: inline-block") !== -1);
  assert.ok(tasksRefBlock.indexOf("color: transparent") !== -1);
  const tasksRefBefore = css.slice(tasksRefAt, tasksRefAt + 2500);
  assert.ok(tasksRefBefore.indexOf("mask-image: var(--bob-ref-task-glyph)") !== -1);
});
