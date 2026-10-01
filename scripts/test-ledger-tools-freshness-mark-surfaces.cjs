// Tests for bob-ledger-tools freshness mark surfaces (mark-surfaces).
// Covers the Live Preview ViewPlugin decoration, the rendered-view
// post-processor, the cached mark snapshot, the session toggle, and the
// repair flag. `docs/freshness.md` §§11-12 in bob-cli is authoritative;
// M/N/C vectors live in test-ledger-tools-freshness-mark.cjs.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const editorInfoField = { _freshnessField: "info" };
const editorLivePreviewField = { _freshnessField: "live" };

let capturedMarkClass = null;
let refreshEffectType = null;

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
    refreshEffectType = type;
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
  if (tag === "nested-code") {
    return {
      resolveInner: () => ({
        name: "leaf",
        parent: { name: "HyperMD-codeblock", parent: null },
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

const originalLoad = Module._load;
Module._load = function loadWithSurfaceStubs(request, parent, isMain) {
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
  return originalLoad.call(this, request, parent, isMain);
};

const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers } = LedgerToolsPlugin;
Module._load = originalLoad;

const {
  freshnessMarkSource,
  freshnessMarkSourceInText,
  freshnessMarkResolution,
  freshnessMarkModel,
  freshnessMarkConsensus,
  freshnessTaskStatus,
} = helpers;

const D = "2026-10-08";
const CFG = { interval: 7, intervalFromConfig: false, staleDailyBudget: null };

function sRow(overrides = {}) {
  return {
    path: "a.md",
    line: 1,
    lineNumber: 0,
    isTodo: true,
    recurring: false,
    laneVisible: true,
    isDailyNote: false,
    isToday: false,
    scheduled: null,
    rawLine: "- [ ] #task T",
    noteRefreshRaw: undefined,
    ...overrides,
  };
}

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

function makeSurfaceApp({ triggers = [] } = {}) {
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
      getLeavesOfType: () => [],
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

function withMissingConfig(run) {
  const saved = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = "/definitely/missing/freshness-mark-test";
  try {
    return run();
  } finally {
    if (saved === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = saved;
    }
  }
}

function pluginWithSnapshot(rows) {
  const plugin = new LedgerToolsPlugin(makeSurfaceApp(), {});
  plugin.freshnessMarksEnabled = true;
  plugin.freshnessMarkSnapshot = {
    dateText: D,
    config: CFG,
    memo: { rows },
    index: null,
  };
  return plugin;
}

test("Live Preview decorates the folded range including space and refresh", () => {
  const line =
    "- [ ] #task Rename queue input [fresh:: 2026-10-05] [refresh:: 14]";
  const plugin = pluginWithSnapshot([sRow({ rawLine: line })]);
  const view = makeView({ lines: [line] });
  const decorations = plugin.buildFreshnessMarkDecorations(view);
  assert.equal(decorations.adds.length, 1);
  const source = freshnessMarkSource(line, D);
  assert.equal(source.text, "[fresh:: 2026-10-05] [refresh:: 14]");
  assert.equal(source.foldSpace, true);
  const [add] = decorations.adds;
  assert.equal(add.from, 0 + source.fieldStart - 1);
  assert.equal(add.to, 0 + source.fieldEnd);
  assert.equal(add.value._decorationReplace, true);
  const widget = add.value.widget;
  assert.ok(widget);
  assert.equal(widget.foldSpace, true);
  assert.equal(widget.model.label, "3d");
  assert.equal(widget.model.intervalLabel, "/14d");
});

test("Live Preview reveals the raw field when the cursor overlaps either edge", () => {
  const line = "- [ ] #task Buy milk [fresh:: 2026-10-05]";
  const source = freshnessMarkSource(line, D);
  const absFrom = source.fieldStart;
  const absTo = source.fieldEnd;
  for (const selection of [
    [{ from: absFrom, to: absFrom }],
    [{ from: absTo, to: absTo }],
    [{ from: absFrom - 2, to: absFrom }],
    [{ from: absTo, to: absTo + 2 }],
    [{ from: 0, to: absTo + 10 }],
  ]) {
    const plugin = pluginWithSnapshot([sRow({ rawLine: line })]);
    const view = makeView({ lines: [line], selection });
    const decorations = plugin.buildFreshnessMarkDecorations(view);
    assert.equal(
      decorations.adds.length,
      0,
      "overlap reveals for " + JSON.stringify(selection),
    );
  }
  const plugin = pluginWithSnapshot([sRow({ rawLine: line })]);
  const view = makeView({
    lines: [line],
    selection: [{ from: 0, to: absFrom - 1 }],
  });
  assert.equal(plugin.buildFreshnessMarkDecorations(view).adds.length, 1);
});

test("Live Preview skips codeblock and inline code spans", () => {
  const line = "- [ ] #task Buy milk [fresh:: 2026-10-05]";
  for (const treeTag of ["codeblock", "inline", "nested-code"]) {
    const plugin = pluginWithSnapshot([sRow({ rawLine: line })]);
    const view = makeView({ lines: [line], treeTag });
    assert.equal(
      plugin.buildFreshnessMarkDecorations(view).adds.length,
      0,
      "no mark inside " + treeTag,
    );
  }
  const plugin = pluginWithSnapshot([sRow({ rawLine: line })]);
  assert.equal(
    plugin.buildFreshnessMarkDecorations(makeView({ lines: [line] })).adds
      .length,
    1,
  );
});

test("source mode and marks-off yield no decorations", () => {
  const line = "- [ ] #task Buy milk [fresh:: 2026-10-05]";
  const plugin = pluginWithSnapshot([sRow({ rawLine: line })]);
  assert.equal(
    plugin.buildFreshnessMarkDecorations(
      makeView({ lines: [line], live: false }),
    ),
    StubDecoration.none,
  );
  plugin.freshnessMarksEnabled = false;
  assert.equal(
    plugin.buildFreshnessMarkDecorations(makeView({ lines: [line] })),
    StubDecoration.none,
  );
  const noFile = pluginWithSnapshot([sRow({ rawLine: line })]);
  assert.equal(
    noFile.buildFreshnessMarkDecorations(
      makeView({ lines: [line], path: null }),
    ),
    StubDecoration.none,
  );
});

test("update rebuilds on the refresh effect and widget eq is stable", () => {
  const plugin = pluginWithSnapshot([]);
  assert.equal(
    plugin.freshnessMarkShouldRebuild({ docChanged: true }),
    true,
  );
  assert.equal(
    plugin.freshnessMarkShouldRebuild({ viewportChanged: true }),
    true,
  );
  assert.equal(
    plugin.freshnessMarkShouldRebuild({ selectionSet: true }),
    true,
  );
  assert.equal(plugin.freshnessMarkShouldRebuild({}), false);
  assert.equal(plugin.freshnessMarkShouldRebuild(null), false);
  const effect = refreshEffectType.of(null);
  assert.equal(
    plugin.freshnessMarkShouldRebuild({
      transactions: [{ effects: [effect] }],
    }),
    true,
  );
  assert.equal(
    plugin.freshnessMarkShouldRebuild({
      transactions: [{ effects: [{ is: () => false }] }],
    }),
    false,
  );
  const liveState = (live) => ({ field: (f) => (f === editorLivePreviewField ? live : null) });
  assert.equal(
    plugin.freshnessMarkShouldRebuild({
      startState: liveState(true),
      state: liveState(false),
    }),
    true,
  );

  const line = "- [ ] #task Buy milk [fresh:: 2026-10-05]";
  const source = freshnessMarkSource(line, D);
  const a = pluginWithSnapshot([sRow({ rawLine: line })]);
  const model = a.freshnessMarkModelForLine({
    path: "a.md",
    lineNumber: 0,
    text: line,
    source,
  });
  assert.ok(model);
  const decorations = a.buildFreshnessMarkDecorations(
    makeView({ lines: [line] }),
  );
  const widget = decorations.adds[0].value.widget;
  assert.ok(widget instanceof StubWidgetType);
  assert.equal(widget.eq(widget), true);
  const other = a.buildFreshnessMarkDecorations(
    makeView({ lines: [line] }),
  ).adds[0].value.widget;
  assert.equal(widget.eq(other), true);
  const changedLine = "- [ ] #task Buy milk [fresh:: 2026-10-01]";
  const b = pluginWithSnapshot([sRow({ rawLine: changedLine })]);
  const secondDecorations = b.buildFreshnessMarkDecorations(
    makeView({ lines: [changedLine] }),
  );
  assert.equal(widget.eq(secondDecorations.adds[0].value.widget), false);
});

test("widget click reveals the field at the folded offset", () => {
  const line = "- [ ] #task Buy milk [fresh:: 2026-10-05]";
  const plugin = pluginWithSnapshot([sRow({ rawLine: line })]);
  const widget = plugin.buildFreshnessMarkDecorations(
    makeView({ lines: [line] }),
  ).adds[0].value.widget;
  assert.equal(widget.foldSpace, true);

  function fakeEl() {
    return {
      _attrs: {},
      children: [],
      handlers: {},
      setAttribute(name, value) {
        this._attrs[name] = value;
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
  const savedDocument = global.document;
  global.document = {
    createElement: () => fakeEl(),
    createElementNS: () => fakeEl(),
    createTextNode: (text) => ({ text }),
  };
  try {
    const view = makeView({ lines: [line] });
    view.posAtDOM = () => 100;
    const dom = widget.toDOM(view);
    assert.ok(dom);
    assert.equal(typeof dom.handlers.mousedown, "function");
    let prevented = false;
    dom.handlers.mousedown({ preventDefault: () => (prevented = true) });
    assert.equal(prevented, true);
    assert.equal(view.dispatched.length, 1);
    assert.equal(view.dispatched[0].selection.anchor, 100 + 1);
    assert.equal(view.focused, true);
  } finally {
    if (savedDocument === undefined) {
      delete global.document;
    } else {
      global.document = savedDocument;
    }
  }
});

test("line resolver prefers exact, then consensus, then unresolved", () => {
  const readyLine = "- [ ] #task A [fresh:: 2026-10-01]";
  const readySource = freshnessMarkSource(readyLine, D);
  const exact = pluginWithSnapshot([
    sRow({ path: "a.md", lineNumber: 0, rawLine: readyLine }),
    sRow({ path: "a.md", lineNumber: 5, rawLine: readyLine }),
  ]);
  const exactModel = exact.freshnessMarkModelForLine({
    path: "a.md",
    lineNumber: 0,
    text: readyLine,
    source: readySource,
  });
  assert.equal(exactModel.resolved, true);
  assert.equal(exactModel.tone, "due");

  const pair = [
    sRow({ path: "a.md", lineNumber: 0, rawLine: readyLine }),
    sRow({ path: "a.md", lineNumber: 1, rawLine: readyLine }),
  ];
  const consensus = pluginWithSnapshot(pair);
  const consensusModel = consensus.freshnessMarkModelForLine({
    path: "other.md",
    lineNumber: 9,
    text: readyLine,
    source: readySource,
  });
  void consensusModel;

  const samePath = pluginWithSnapshot(pair);
  const agreed = samePath.freshnessMarkModelForLine({
    path: "a.md",
    lineNumber: 9,
    text: readyLine,
    source: readySource,
  });
  assert.equal(agreed.resolved, true);
  assert.equal(agreed.tone, "due");

  const nextLine = "- [*] #task A [fresh:: 2026-10-01]";
  const mixed = pluginWithSnapshot([
    sRow({ path: "a.md", lineNumber: 0, rawLine: readyLine }),
    sRow({
      path: "a.md",
      lineNumber: 1,
      rawLine: nextLine,
      isTodo: false,
    }),
  ]);
  const disagreed = mixed.freshnessMarkModelForLine({
    path: "a.md",
    lineNumber: 9,
    text: readyLine,
    source: readySource,
  });
  assert.equal(disagreed.resolved, false);
  assert.equal(disagreed.tone, "aging");

  const empty = pluginWithSnapshot([]);
  const unresolved = empty.freshnessMarkModelForLine({
    path: "a.md",
    lineNumber: 9,
    text: readyLine,
    source: readySource,
  });
  assert.equal(unresolved.resolved, false);
  assert.equal(unresolved.tone, "aging");
});

test("decoration builds reuse the snapshot without touching the loader", () => {
  const line = "- [ ] #task Buy milk [fresh:: 2026-10-05]";
  const plugin = pluginWithSnapshot([sRow({ rawLine: line })]);
  let memoCalls = 0;
  plugin.freshnessEnsureMemo = () => {
    memoCalls += 1;
    return plugin.freshnessMarkSnapshot.memo;
  };
  const view = makeView({ lines: [line] });
  assert.equal(plugin.buildFreshnessMarkDecorations(view).adds.length, 1);
  assert.equal(plugin.buildFreshnessMarkDecorations(view).adds.length, 1);
  assert.equal(memoCalls, 0);
});

function fakeRenderEl() {
  function makeNode() {
    return null;
  }
  void makeNode;
  function el(tag, className = "") {
    const node = {
      nodeType: 1,
      tagName: String(tag).toUpperCase(),
      nodeName: String(tag).toUpperCase(),
      className,
      childNodes: [],
      parentNode: null,
      ownerDocument: null,
      classList: {
        contains: (name) =>
          String(node.className || "")
            .split(/\s+/)
            .includes(name),
      },
      getAttribute: (name) =>
        name === "class" ? node.className : (node._attrs || {})[name] || null,
      setAttribute(name, value) {
        node._attrs = node._attrs || {};
        node._attrs[name] = value;
        if (name === "class") {
          node.className = String(value);
        }
      },
      appendChild(child) {
        child.parentNode = node;
        node.childNodes.push(child);
        return child;
      },
      insertBefore(child, ref) {
        child.parentNode = node;
        const at = ref ? node.childNodes.indexOf(ref) : -1;
        if (at === -1) {
          node.childNodes.push(child);
        } else {
          node.childNodes.splice(at, 0, child);
        }
        return child;
      },
      removeChild(child) {
        const at = node.childNodes.indexOf(child);
        if (at !== -1) {
          node.childNodes.splice(at, 1);
        }
        child.parentNode = null;
        return child;
      },
    };
    return node;
  }
  function text(value, doc) {
    return {
      nodeType: 3,
      nodeValue: value,
      textContent: value,
      parentNode: null,
      ownerDocument: doc,
    };
  }
  const doc = {
    createElement: (tag) => el(tag),
    createElementNS: (ns, tag) => el(tag),
    createTextNode: (value) => text(value, doc),
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
  const root = el("div");
  root.ownerDocument = doc;
  return { root, doc, el, text };
}

function collectText(root) {
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node.nodeType === 3) {
      out.push(node.nodeValue);
      continue;
    }
    for (const child of node.childNodes || []) {
      stack.push(child);
    }
  }
  return out.join("|");
}

function countMarks(root) {
  let count = 0;
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (
      node.nodeType === 1 &&
      node.className &&
      node.className.split(/\s+/).includes("bob-fresh-mark")
    ) {
      count += 1;
    }
    for (const child of node.childNodes || []) {
      stack.push(child);
    }
  }
  return count;
}

test("rendered views split text nodes and skip excluded ancestors", () => {
  const line = "Buy milk [fresh:: 2026-10-05] done";
  const plugin = pluginWithSnapshot([sRow({ rawLine: line })]);
  const { root, doc, text } = fakeRenderEl();
  const para = doc.createElement("p");
  root.appendChild(para);
  para.appendChild(text("Buy milk [fresh:: 2026-10-05] done", doc));
  plugin.renderFreshnessMarksIn(root, { sourcePath: "a.md" });
  assert.equal(countMarks(root), 1);
  assert.ok(collectText(root).indexOf("[fresh::") === -1);

  const excluded = fakeRenderEl();
  const code = excluded.doc.createElement("code");
  excluded.root.appendChild(code);
  code.appendChild(excluded.text("Buy milk [fresh:: 2026-10-05]", excluded.doc));
  plugin.renderFreshnessMarksIn(excluded.root, { sourcePath: "a.md" });
  assert.equal(countMarks(excluded.root), 0);

  const pre = fakeRenderEl();
  const preEl = pre.doc.createElement("pre");
  pre.root.appendChild(preEl);
  preEl.appendChild(pre.text("Buy milk [fresh:: 2026-10-05]", pre.doc));
  plugin.renderFreshnessMarksIn(pre.root, { sourcePath: "a.md" });
  assert.equal(countMarks(pre.root), 0);

  const pill = fakeRenderEl();
  const pillEl = pill.doc.createElement("span");
  pillEl.className = "dataview inline-field";
  pill.root.appendChild(pillEl);
  pillEl.appendChild(pill.text("Buy milk [fresh:: 2026-10-05]", pill.doc));
  plugin.renderFreshnessMarksIn(pill.root, { sourcePath: "a.md" });
  assert.equal(countMarks(pill.root), 0);
});

test("rendered views stay idempotent", () => {
  const plugin = pluginWithSnapshot([
    sRow({ rawLine: "Buy milk [fresh:: 2026-10-05]" }),
  ]);
  const { root, doc, text } = fakeRenderEl();
  root.appendChild(text("Buy milk [fresh:: 2026-10-05] done", doc));
  plugin.renderFreshnessMarksIn(root, { sourcePath: "a.md" });
  assert.equal(countMarks(root), 1);
  plugin.renderFreshnessMarksIn(root, { sourcePath: "a.md" });
  assert.equal(countMarks(root), 1);
});

test("text resolver reaches consensus and degrades to neutral", () => {
  const readyLine = "- [ ] #task A [fresh:: 2026-10-01]";
  const readySource = freshnessMarkSourceInText(
    "see [fresh:: 2026-10-01] here",
    D,
  );
  assert.ok(readySource);
  const pair = pluginWithSnapshot([
    sRow({ path: "a.md", lineNumber: 0, rawLine: readyLine }),
    sRow({ path: "a.md", lineNumber: 1, rawLine: readyLine }),
  ]);
  const agreed = pair.freshnessMarkModelForText({
    path: "a.md",
    source: readySource,
  });
  assert.equal(agreed.resolved, true);
  assert.equal(agreed.tone, "due");

  const mixed = pluginWithSnapshot([
    sRow({ path: "a.md", lineNumber: 0, rawLine: readyLine }),
    sRow({
      path: "a.md",
      lineNumber: 1,
      rawLine: "- [*] #task A [fresh:: 2026-10-01]",
      isTodo: false,
    }),
  ]);
  const disagreed = mixed.freshnessMarkModelForText({
    path: "a.md",
    source: readySource,
  });
  assert.equal(disagreed.resolved, false);

  const empty = pluginWithSnapshot([]);
  const unresolved = empty.freshnessMarkModelForText({
    path: "a.md",
    source: readySource,
  });
  assert.equal(unresolved.resolved, false);
  assert.equal(unresolved.tone, "aging");
});

test("session toggle flips the body class and notifies", () => {
  const savedDocument = global.document;
  const classes = new Set();
  global.document = {
    body: {
      classList: {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name),
      },
    },
  };
  TestNotice.messages = [];
  try {
    const plugin = new LedgerToolsPlugin(makeSurfaceApp(), {});
    plugin.freshnessMarksEnabled = true;
    assert.equal(plugin.toggleFreshnessMarks(), false);
    assert.equal(classes.has("bob-fresh-marks"), false);
    assert.equal(plugin.toggleFreshnessMarks(), true);
    assert.equal(classes.has("bob-fresh-marks"), true);
    assert.deepEqual(TestNotice.messages, [
      "Freshness marks off",
      "Freshness marks on",
    ]);
    const command = plugin.commands
      ? null
      : null;
    void command;
  } finally {
    if (savedDocument === undefined) {
      delete global.document;
    } else {
      global.document = savedDocument;
    }
  }
});

test("onload registers the toggle, extension, and post-processor", () => {
  capturedMarkClass = null;
  const savedDocument = global.document;
  global.document = {
    body: { classList: { add: () => {}, remove: () => {} } },
  };
  try {
    const plugin = withMissingConfig(() => {
      const instance = new LedgerToolsPlugin(makeSurfaceApp(), {});
      instance.onload();
      return instance;
    });
    try {
      const toggle = (plugin.commands || []).find(
        (command) => command.id === "toggle-freshness-marks",
      );
      assert.ok(toggle);
      assert.equal(toggle.name, "Toggle task freshness marks");
      assert.ok(
        (plugin.editorExtensions || []).length >= 2,
        "tab keymap plus the mark extension",
      );
      assert.ok(capturedMarkClass);
      const post = (plugin.postProcessors || []).find(
        (entry) => entry.sortOrder === 50,
      );
      assert.ok(post);
      const before = plugin.freshnessMarksEnabled;
      plugin.toggleFreshnessMarks();
      assert.equal(plugin.freshnessMarksEnabled, !before);
    } finally {
      plugin.onunload();
    }
  } finally {
    if (savedDocument === undefined) {
      delete global.document;
    } else {
      global.document = savedDocument;
    }
  }
});
