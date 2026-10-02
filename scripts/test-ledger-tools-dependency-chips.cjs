// Tests for bob-ledger-tools dependency chips (bob-cli-3n chips).
// Covers the Depends-On grammar, the chip model, the Live Preview
// decoration, the Reading view post-processor, and nav api v1 feature
// detection. `docs/task-dependencies.md` §§2, 7, 11.1 (DP) and 11.5 (DC)
// in bob-cli is authoritative; vectors are copied from those sections.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const editorInfoField = { _depField: "info" };
const editorLivePreviewField = { _depField: "live" };

let capturedChipClass = null;
let chipRefreshEffectType = null;

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
    chipRefreshEffectType = type;
    return type;
  },
};

const StubViewPlugin = {
  fromClass(cls, options) {
    capturedChipClass = cls;
    return { _viewPlugin: true, cls, options };
  },
};

function stubSyntaxTree(state) {
  const tag = state && state._treeTag;
  if (tag === "codeblock") {
    return { resolveInner: () => ({ name: "HyperMD-codeblock", parent: null }) };
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
Module._load = function loadWithChipStubs(request, parent, isMain) {
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
    return { Prec: { highest: (value) => value }, StateEffect: StubStateEffect, RangeSetBuilder: StubRangeSetBuilder };
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

const { parseDependencyLine, dependencyChipModel, buildDependencyChipElement } = helpers;

// DP vectors copied from docs/task-dependencies.md §11.1.
test("DP parse vectors", () => {
  const cases = [
    ["DP1", "⛓️ **DEPENDS ON:** [[#^hospital-swarm]]", {}, "accept", 1],
    ["DP2", "⛓️ **DEPENDS ON:** [[cash#^unemployment]]", {}, "accept", 1],
    ["DP3", "⛓️ **DEPENDS ON:** [[money/cash#^unemployment]]", {}, "accept", 1],
    ["DP4", "⛓️ **DEPENDS ON:** [[#^a]] • [[#^b]]", {}, "accept", 2],
    ["DP5", "⛓️ **DEPENDS ON:** [[#^a|b • c]]", {}, "accept", 1],
    ["DP6", "⛓️ **DEPENDS ON:** ~~[[#^a]]~~", {}, "accept", 1],
    ["DP7", "⛓️ **DEPENDS ON:** ![[#^a]]", {}, "accept", 1],
    ["DP8", "🔗 **DEPENDS ON:** [[#^a]]", {}, "accept", 1],
    ["DP9", "**DEPENDS ON:** [[#^a]]", {}, "accept", 1],
    ["DP10", "⛓️ **DEPENDENCIES:** [[#^a]]", {}, "accept", 1],
    ["DP11", "⛓ **DEPENDS ON:** [[#^a]]", {}, "accept", 1],
    ["DP12", "⛓️ **DEPENDS ON:** [[#^a]] · [[#^b]]", {}, "accept", 2],
    ["DP13", "⛓️ **DEPENDS ON:** [[#^a]], [[#^b]]", {}, "accept", 2],
    ["DP14", "⛓️ **DEPENDS ON:** [[#^a]] [[#^b]]", {}, "accept", 2],
    ["DP15", "⛓️ **DEPENDS ON:** [[#^a", {}, "malformed"],
    ["DP16", "⛓️ **DEPENDS ON:** [[#^a]] needs review", {}, "malformed"],
    ["DP17", "⛓️ **DEPENDS ON:**", {}, "empty"],
    ["DP18", "⛓️ **DEPENDS ON:** [[#^a]]", { inCode: true }, "not-a-line"],
    ["DP19", "⛓️ **DEPENDS ON:** [[#^a]]", { isDirectChild: false }, "not-a-line"],
    ["DP20", "⛓️ **DEPENDS ON:** [[#^a]]", { inWorkLog: true }, "not-a-line"],
    ["DP21", "⛓️ **DEPENDS ON:** [[#^a]]", {}, "accept", 1],
    ["DP22", "⛓️ **DEPENDS ON:** [[#^a|swarm]]", {}, "accept", 1],
    ["DP23", "⛓️ **DEPENDS ON:** [[note]]", {}, "malformed"],
  ];
  for (const [id, line, opts, verdict, count] of cases) {
    const parsed = parseDependencyLine(line, opts);
    assert.equal(parsed.verdict, verdict, id + " verdict for " + line);
    if (verdict === "accept") {
      assert.equal(parsed.targets.length, count, id + " count");
    }
  }
  // Canonical writer form stays canonical; tolerated variants do not.
  assert.equal(parseDependencyLine("⛓️ **DEPENDS ON:** [[#^a]]").canonical, true, "DP1 canonical");
  assert.equal(parseDependencyLine("⛓️ **DEPENDS ON:** [[#^a]] • [[#^b]]").canonical, true, "DP4 canonical");
  for (const line of [
    "⛓️ **DEPENDS ON:** ~~[[#^a]]~~",
    "⛓️ **DEPENDS ON:** ![[#^a]]",
    "🔗 **DEPENDS ON:** [[#^a]]",
    "**DEPENDS ON:** [[#^a]]",
    "⛓️ **DEPENDENCIES:** [[#^a]]",
    "⛓ **DEPENDS ON:** [[#^a]]",
    "⛓️ **DEPENDS ON:** [[#^a]] · [[#^b]]",
    "⛓️ **DEPENDS ON:** [[#^a|swarm]]",
  ]) {
    assert.equal(parseDependencyLine(line).canonical, false, "non-canonical for " + line);
  }
});

function depTask({ blockId, symbol = " ", description = "Task", path = "a.md", type = "TODO" }) {
  return { path, blockLink: " ^" + blockId, description, status: { symbol, type } };
}

function depLookup(entries) {
  const map = new Map(entries);
  return (linkpath, blockId) => {
    if (map.has(blockId)) {
      return map.get(blockId);
    }
    return null;
  };
}

// DC vectors copied from docs/task-dependencies.md §11.5.
test("DC chip model vectors", () => {
  const lineFor = (id) => "⛓️ **DEPENDS ON:** [[#^" + id + "]]";
  let model = dependencyChipModel(lineFor("a"), "a.md", depLookup([["a", depTask({ blockId: "a", symbol: " ", description: "Todo task" })]]));
  assert.equal(model.chips[0].state, "todo");
  assert.equal(model.chips[0].symbol, "○");
  assert.equal(model.summary, "waiting on 1");

  model = dependencyChipModel(lineFor("b"), "a.md", depLookup([["b", depTask({ blockId: "b", symbol: "*", description: "Next task", type: "TODO" })]]));
  assert.equal(model.chips[0].state, "next");
  assert.equal(model.summary, "waiting on 1");

  model = dependencyChipModel(lineFor("c"), "a.md", depLookup([["c", depTask({ blockId: "c", symbol: "/", description: "Doing", type: "IN_PROGRESS" })]]));
  assert.equal(model.chips[0].state, "in-progress");
  assert.equal(model.summary, "waiting on 1");

  model = dependencyChipModel(lineFor("d"), "a.md", depLookup([["d", depTask({ blockId: "d", symbol: "?", description: "Blocked one", type: "ON_HOLD" })]]));
  assert.equal(model.chips[0].state, "blocked");
  assert.equal(model.summary, "waiting on 1");

  model = dependencyChipModel(lineFor("e"), "a.md", depLookup([["e", depTask({ blockId: "e", symbol: "x", description: "Done one", type: "DONE" })]]));
  assert.equal(model.chips[0].state, "done");
  assert.equal(model.summary, "✓ all clear");

  const both = dependencyChipModel(
    "⛓️ **DEPENDS ON:** [[#^a]] • [[#^e]]",
    "a.md",
    depLookup([
      ["a", depTask({ blockId: "a", symbol: " ", description: "Open" })],
      ["e", depTask({ blockId: "e", symbol: "x", description: "Done", type: "DONE" })],
    ]),
  );
  assert.equal(both.summary, "waiting on 1");

  model = dependencyChipModel(lineFor("f"), "a.md", depLookup([["f", depTask({ blockId: "f", symbol: "-", description: "Cancelled", type: "CANCELLED" })]]));
  assert.equal(model.chips[0].state, "cancelled");
  assert.notEqual(model.chips[0].symbol, "✓");

  model = dependencyChipModel(lineFor("missing"), "a.md", depLookup([]));
  assert.equal(model.chips[0].state, "broken");
  assert.ok(model.chips[0].text.indexOf("^missing") !== -1);
  assert.equal(model.summary, "waiting on 1");

  model = dependencyChipModel(lineFor("nt"), "a.md", depLookup([["nt", { isTask: false, path: "a.md" }]]));
  assert.equal(model.chips[0].state, "not-task");
  assert.equal(model.summary, "waiting on 1");

  model = dependencyChipModel(
    "⛓️ **DEPENDS ON:** [[sase_bug_bash#^e2e-sase-8v]]",
    "body.md",
    depLookup([["e2e-sase-8v", depTask({ blockId: "e2e-sase-8v", symbol: " ", description: "Run e2e", path: "sase_bug_bash.md" })]]),
  );
  assert.equal(model.chips[0].noteLabel, "↗ sase_bug_bash");

  const fourDone = dependencyChipModel(
    "⛓️ **DEPENDS ON:** [[#^a]] • [[#^b]] • [[#^c]] • [[#^d]]",
    "a.md",
    depLookup([
      ["a", depTask({ blockId: "a", symbol: "x", description: "A", type: "DONE" })],
      ["b", depTask({ blockId: "b", symbol: "x", description: "B", type: "DONE" })],
      ["c", depTask({ blockId: "c", symbol: "x", description: "C", type: "DONE" })],
      ["d", depTask({ blockId: "d", symbol: "x", description: "D", type: "DONE" })],
    ]),
  );
  assert.ok(fourDone.doneCollapsed);
  assert.equal(fourDone.doneCollapsed.text, "✓×4");
  assert.equal(fourDone.summary, "✓ all clear");

  const long = dependencyChipModel(
    lineFor("long"),
    "a.md",
    depLookup([["long", depTask({ blockId: "long", symbol: " ", description: "x".repeat(60) })]]),
  );
  assert.ok(long.chips[0].text.length <= 41);
  assert.equal(long.chips[0].fullText.length, 60);
  assert.ok(long.chips[0].tooltip.indexOf("x".repeat(10)) !== -1);
});

function makeDepDoc(lines) {
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

function makeDepView({ lines, selection = [], live = true, path = "a.md", treeTag = null } = {}) {
  const doc = makeDepDoc(lines);
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

function makeDepApp({ tasks = [], navApi = null } = {}) {
  return {
    vault: { getAbstractFileByPath: () => null, cachedRead: () => Promise.resolve(null) },
    workspace: { on: () => ({}), offref: () => {}, onLayoutReady: () => {}, getActiveFile: () => null, getLeavesOfType: () => [], trigger: () => {} },
    metadataCache: {
      on: () => ({}),
      getCache: () => ({}),
      getFirstLinkpathDest: (linkpath) => ({ path: String(linkpath || "").replace(/\.md$/i, "") + ".md" }),
    },
    plugins: {
      plugins: {
        "obsidian-tasks-plugin": { getTasks: () => tasks },
        ...(navApi ? { "bob-navigation-hotkeys": { api: navApi } } : {}),
      },
    },
  };
}

function depPluginWithTasks(lines, tasks, options = {}) {
  const plugin = new LedgerToolsPlugin(makeDepApp({ tasks, navApi: options.navApi || null }), {});
  plugin.dependencyChipsEnabled = true;
  return plugin;
}

test("decoration builds one widget, reveals on cursor, skips code and ranges", () => {
  const line = "  - ⛓️ **DEPENDS ON:** [[#^a]]";
  const tasks = [depTask({ blockId: "a", symbol: " ", description: "Alpha", path: "a.md" })];
  const plugin = depPluginWithTasks([line], tasks);
  const view = makeDepView({ lines: [line] });
  const decorations = plugin.buildDependencyChipDecorations(view);
  assert.equal(decorations.adds.length, 1);
  const [add] = decorations.adds;
  assert.ok(add.value.widget);
  assert.equal(add.value._decorationReplace, true);

  const selected = makeDepView({ lines: [line], selection: [{ from: 0, to: 5 }] });
  assert.equal(plugin.buildDependencyChipDecorations(selected).adds.length, 0);

  const coded = makeDepView({ lines: [line], treeTag: "codeblock" });
  assert.equal(plugin.buildDependencyChipDecorations(coded).adds.length, 0, "no chips in code");

  const offscreen = makeDepView({ lines: [line, "plain", line] });
  offscreen.visibleRanges = [{ from: 0, to: 2 }];
  const all = plugin.buildDependencyChipDecorations(makeDepView({ lines: [line] }));
  assert.equal(all.adds.length, 1);

  const first = plugin.buildDependencyChipDecorations(view).adds[0].value.widget;
  const second = plugin.buildDependencyChipDecorations(makeDepView({ lines: [line] })).adds[0].value.widget;
  assert.equal(first.eq(second), true);
  const changedTasks = [depTask({ blockId: "a", symbol: "*", description: "Alpha", path: "a.md" })];
  const changedPlugin = depPluginWithTasks([line], changedTasks);
  const changed = changedPlugin.buildDependencyChipDecorations(makeDepView({ lines: [line] })).adds[0].value.widget;
  assert.equal(first.eq(changed), false);
});

test("element hides actions without nav api v1", () => {
  function fakeDoc() {
    function el(tag) {
      const node = {
        tag, children: [], _attrs: {}, handlers: {},
        setAttribute(name, value) {
          this._attrs[name] = value;
        },
        getAttribute(name) {
          return this._attrs[name];
        },
        appendChild(child) {
          this.children.push(child);
          return child;
        },
        addEventListener(name, handler) {
          this.handlers[name] = handler;
        },
      };
      return node;
    }
    return {
      createElement: (tag) => el(tag),
      createTextNode: (text) => ({ text }),
    };
  }
  function collectClasses(node, out = []) {
    if (node._attrs && node._attrs.class) {
      out.push(node._attrs.class);
    }
    for (const child of node.children || []) {
      if (child.children) {
        collectClasses(child, out);
      }
    }
    return out;
  }
  const model = dependencyChipModel(
    "⛓️ **DEPENDS ON:** [[#^a]]",
    "a.md",
    depLookup([["a", depTask({ blockId: "a", symbol: " ", description: "Alpha" })]]),
  );
  const doc = fakeDoc();
  const plain = buildDependencyChipElement(doc, model, { interactive: false });
  assert.ok(plain);
  assert.equal(collectClasses(plain).join(" ").indexOf("bob-dep-chip-remove"), -1);
  assert.equal(collectClasses(plain).join(" ").indexOf("bob-dep-add"), -1);
  const interactive = buildDependencyChipElement(doc, model, { interactive: true });
  assert.ok(collectClasses(interactive).join(" ").indexOf("bob-dep-chip-remove") !== -1);
  assert.ok(collectClasses(interactive).join(" ").indexOf("bob-dep-add") !== -1);
});

test("nav api feature detection gates actions", () => {
  const withApi = new LedgerToolsPlugin(
    makeDepApp({ tasks: [], navApi: { version: 1, openDependencyStage: () => Promise.resolve({ ok: true }), removeDependency: () => Promise.resolve({ ok: true }) } }),
    {},
  );
  assert.ok(withApi.dependencyNavApi());
  const withoutApi = new LedgerToolsPlugin(makeDepApp({ tasks: [] }), {});
  assert.equal(withoutApi.dependencyNavApi(), null);
  const oldApi = new LedgerToolsPlugin(makeDepApp({ tasks: [], navApi: { version: 0 } }), {});
  assert.equal(oldApi.dependencyNavApi(), null);
});

function fakeReadingDoc() {
  function el(tag) {
    const node = {
      nodeType: 1,
      tagName: String(tag).toUpperCase(),
      nodeName: String(tag).toUpperCase(),
      className: "",
      childNodes: [],
      parentNode: null,
      ownerDocument: null,
      dataset: {},
      _attrs: {},
      classList: {
        add: (name) => {
          const parts = String(node.className || "").split(/\s+/).filter(Boolean);
          if (!parts.includes(name)) {
            parts.push(name);
          }
          node.className = parts.join(" ");
        },
        contains: (name) => String(node.className || "").split(/\s+/).includes(name),
      },
      getAttribute: (name) => {
        if (name === "class") {
          return node.className;
        }
        return node._attrs[name] || null;
      },
      setAttribute: (name, value) => {
        node._attrs[name] = value;
        if (name === "class") {
          node.className = String(value);
        }
      },
      appendChild: (child) => {
        child.parentNode = node;
        node.childNodes.push(child);
        return child;
      },
      insertBefore: (child, ref) => {
        child.parentNode = node;
        const at = ref ? node.childNodes.indexOf(ref) : -1;
        if (at === -1) {
          node.childNodes.push(child);
        } else {
          node.childNodes.splice(at, 0, child);
        }
        return child;
      },
      addEventListener: () => {},
      querySelectorAll: (selector) => {
        const out = [];
        const stack = [node];
        while (stack.length > 0) {
          const current = stack.pop();
          if (current !== node && selector === "a.internal-link" && current.tagName === "A" && String(current.className || "").split(/\s+/).includes("internal-link")) {
            out.push(current);
          }
          if (selector === "li" && current.tagName === "LI") {
            out.push(current);
          }
          for (const child of current.childNodes || []) {
            if (child.nodeType === 1) {
              stack.push(child);
            }
          }
        }
        return out;
      },
    };
    return node;
  }
  const doc = {
    createElement: (tag) => el(tag),
    createTextNode: (value) => ({ nodeType: 3, nodeValue: value, textContent: value, parentNode: null, ownerDocument: doc }),
  };
  const root = el("div");
  root.ownerDocument = doc;
  return { root, doc, el };
}

test("reading view decorates links, keeps anchors, stays idempotent", () => {
  const tasks = [depTask({ blockId: "a", symbol: " ", description: "Alpha task", path: "a.md" })];
  const plugin = depPluginWithTasks([], tasks);
  const { root, doc, el } = fakeReadingDoc();
  const li = el("li");
  li.ownerDocument = doc;
  li.textContent = "⛓️ DEPENDS ON: link";
  root.appendChild(li);
  const anchor = el("a");
  anchor.ownerDocument = doc;
  anchor.className = "internal-link";
  anchor.setAttribute("data-href", "a.md#^a");
  anchor.setAttribute("href", "a.md#^a");
  anchor.textContent = "link";
  li.appendChild(anchor);
  li.textContent = "⛓️ DEPENDS ON: link";
  plugin.renderDependencyChipsIn(root, { sourcePath: "a.md" });
  assert.ok(li.className.indexOf("bob-dep-row") !== -1);
  assert.ok(anchor.className.indexOf("bob-dep-chip") !== -1);
  assert.equal(anchor.getAttribute("href"), "a.md#^a");
  const before = li.childNodes.length;
  plugin.renderDependencyChipsIn(root, { sourcePath: "a.md" });
  assert.equal(li.childNodes.length, before);

  const coded = fakeReadingDoc();
  const code = coded.el("code");
  coded.root.appendChild(code);
  const innerLi = coded.el("li");
  innerLi.ownerDocument = coded.doc;
  code.appendChild(innerLi);
  const innerA = coded.el("a");
  innerA.ownerDocument = coded.doc;
  innerA.className = "internal-link";
  innerA.setAttribute("data-href", "a.md#^a");
  innerLi.appendChild(innerA);
  plugin.renderDependencyChipsIn(coded.root, { sourcePath: "a.md" });
  assert.equal(innerA.className.indexOf("bob-dep-chip"), -1);
});

test("toggle flips the body class and onload wires chips", () => {
  const savedDocument = global.document;
  const classes = new Set();
  global.document = { body: { classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) } } };
  try {
    capturedChipClass = null;
    const plugin = new LedgerToolsPlugin(makeDepApp({ tasks: [] }), {});
    plugin.onload();
    try {
      const toggle = (plugin.commands || []).find((command) => command.id === "toggle-dependency-chips");
      assert.ok(toggle);
      assert.equal(toggle.name, "Toggle dependency chips");
      assert.ok((plugin.editorExtensions || []).length >= 2);
      assert.ok(capturedChipClass);
      assert.ok((plugin.postProcessors || []).length >= 1);
      const before = plugin.dependencyChipsEnabled;
      plugin.toggleDependencyChips();
      assert.equal(plugin.dependencyChipsEnabled, !before);
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
