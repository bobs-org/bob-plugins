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

const {
  parseDependencyLine,
  dependencyChipModel,
  buildDependencyChipElement,
  dependencyChipLineOwnedByTask,
  dependencyReadingOwnText,
  dependencyReadingAnchorOwner,
  dependencyReadingLabelElement,
  dependencyReadingBlockId,
} = helpers;

// DP vectors copied from docs/task-dependencies.md §11.1.
test("DP parse vectors", () => {
  const cases = [
    ["DP1", "- ⛓️ **DEPENDS ON:** [[#^hospital-swarm]]", {}, "accept", 1],
    ["DP2", "- ⛓️ **DEPENDS ON:** [[cash#^unemployment]]", {}, "accept", 1],
    ["DP3", "- ⛓️ **DEPENDS ON:** [[money/cash#^unemployment]]", {}, "accept", 1],
    ["DP4", "- ⛓️ **DEPENDS ON:** [[#^a]] • [[#^b]]", {}, "accept", 2],
    ["DP5", "- ⛓️ **DEPENDS ON:** [[#^a|b • c]]", {}, "accept", 1],
    ["DP6", "- ⛓️ **DEPENDS ON:** ~~[[#^a]]~~", {}, "accept", 1],
    ["DP7", "- ⛓️ **DEPENDS ON:** ![[#^a]]", {}, "accept", 1],
    ["DP8", "- 🔗 **DEPENDS ON:** [[#^a]]", {}, "accept", 1],
    ["DP9", "- **DEPENDS ON:** [[#^a]]", {}, "accept", 1],
    ["DP10", "- ⛓️ **DEPENDENCIES:** [[#^a]]", {}, "accept", 1],
    ["DP11", "- ⛓ **DEPENDS ON:** [[#^a]]", {}, "accept", 1],
    ["DP12", "- ⛓️ **DEPENDS ON:** [[#^a]] · [[#^b]]", {}, "accept", 2],
    ["DP13", "- ⛓️ **DEPENDS ON:** [[#^a]], [[#^b]]", {}, "accept", 2],
    ["DP14", "- ⛓️ **DEPENDS ON:** [[#^a]] [[#^b]]", {}, "accept", 2],
    ["DP15", "- ⛓️ **DEPENDS ON:** [[#^a", {}, "malformed"],
    ["DP16", "- ⛓️ **DEPENDS ON:** [[#^a]] needs review", {}, "malformed"],
    ["DP17", "- ⛓️ **DEPENDS ON:**", {}, "empty"],
    ["DP18", "- ⛓️ **DEPENDS ON:** [[#^a]]", { inCode: true }, "not-a-line"],
    ["DP19", "- ⛓️ **DEPENDS ON:** [[#^a]]", { isDirectChild: false }, "not-a-line"],
    ["DP20", "- ⛓️ **DEPENDS ON:** [[#^a]]", { inWorkLog: true }, "not-a-line"],
    ["DP21", "- ⛓️ **DEPENDS ON:** [[#^a]]", {}, "accept", 1],
    ["DP22", "- ⛓️ **DEPENDS ON:** [[#^a|swarm]]", {}, "accept", 1],
    ["DP23", "- ⛓️ **DEPENDS ON:** [[note]]", {}, "malformed"],

    ["DP24", "- 🔗️ **DEPENDS ON:** [[#^a]]", {}, "not-a-line"],
    ["DP25", "- ⛓️ **DEPENDS ON:** [[note#Heading]]", {}, "malformed"],
    ["DP26", "- ⛓️ **DEPENDS ON:** • ,", {}, "malformed"],
    ["DP27", "- ⛓️ **depends on:** [[#^a]]", {}, "not-a-line"],
    ["DP28", "⛓️ **DEPENDS ON:** [[#^a]]", {}, "not-a-line"],
    ["DP29", "> - ⛓️ **DEPENDS ON:** [[#^a]]", {}, "not-a-line"],
  ];
  for (const [id, line, opts, verdict, count] of cases) {
    const parsed = parseDependencyLine(line, opts);
    assert.equal(parsed.verdict, verdict, id + " verdict for " + line);
    if (verdict === "accept") {
      assert.equal(parsed.targets.length, count, id + " count");
    }
  }
  // Canonical writer form stays canonical; tolerated variants do not.
  assert.equal(parseDependencyLine("- ⛓️ **DEPENDS ON:** [[#^a]]").canonical, true, "DP1 canonical");
  assert.equal(parseDependencyLine("- ⛓️ **DEPENDS ON:** [[#^a]] • [[#^b]]").canonical, true, "DP4 canonical");
  for (const line of [
    "- ⛓️ **DEPENDS ON:** ~~[[#^a]]~~",
    "- ⛓️ **DEPENDS ON:** ![[#^a]]",
    "- 🔗 **DEPENDS ON:** [[#^a]]",
    "- **DEPENDS ON:** [[#^a]]",
    "- ⛓️ **DEPENDENCIES:** [[#^a]]",
    "- ⛓ **DEPENDS ON:** [[#^a]]",
    "- ⛓️ **DEPENDS ON:** [[#^a]] · [[#^b]]",
    "- ⛓️ **DEPENDS ON:** [[#^a|swarm]]",
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
  const lineFor = (id) => "- ⛓️ **DEPENDS ON:** [[#^" + id + "]]";
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
    "- ⛓️ **DEPENDS ON:** [[#^a]] • [[#^e]]",
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

  // DC7: a missing target never blocks (R4) and never counts as waiting.
  model = dependencyChipModel(lineFor("missing"), "a.md", depLookup([]));
  assert.equal(model.chips[0].state, "broken");
  assert.ok(model.chips[0].text.indexOf("^missing") !== -1);
  assert.equal(model.summary, "✓ all clear");

  // DC8: a non-task block never blocks (R5) and never counts as waiting.
  model = dependencyChipModel(lineFor("nt"), "a.md", depLookup([["nt", { isTask: false, path: "a.md" }]]));
  assert.equal(model.chips[0].state, "not-task");
  assert.equal(model.summary, "✓ all clear");

  // DC7/DC8 beside an open prerequisite: only the open one counts.
  model = dependencyChipModel(
    "- ⛓️ **DEPENDS ON:** [[#^a]] • [[#^missing]] • [[#^nt]]",
    "a.md",
    depLookup([
      ["a", depTask({ blockId: "a", symbol: " ", description: "Open" })],
      ["nt", { isTask: false, path: "a.md" }],
    ]),
  );
  assert.equal(model.summary, "waiting on 1");

  model = dependencyChipModel(
    "- ⛓️ **DEPENDS ON:** [[sase_bug_bash#^e2e-sase-8v]]",
    "body.md",
    depLookup([["e2e-sase-8v", depTask({ blockId: "e2e-sase-8v", symbol: " ", description: "Run e2e", path: "sase_bug_bash.md" })]]),
  );
  assert.equal(model.chips[0].noteLabel, "↗ sase_bug_bash");

  const fourDone = dependencyChipModel(
    "- ⛓️ **DEPENDS ON:** [[#^a]] • [[#^b]] • [[#^c]] • [[#^d]]",
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
    lines: lineObjs.length,
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
  const task = "- [ ] #task T ^t";
  const line = "  - ⛓️ **DEPENDS ON:** [[#^a]]";
  const tasks = [depTask({ blockId: "a", symbol: " ", description: "Alpha", path: "a.md" })];
  const plugin = depPluginWithTasks([line], tasks);
  const view = makeDepView({ lines: [task, line] });
  const decorations = plugin.buildDependencyChipDecorations(view);
  assert.equal(decorations.adds.length, 1);
  const [add] = decorations.adds;
  assert.ok(add.value.widget);
  assert.equal(add.value._decorationReplace, true);

  const selected = makeDepView({
    lines: [task, line],
    selection: [{ from: task.length + 1, to: task.length + 6 }],
  });
  assert.equal(plugin.buildDependencyChipDecorations(selected).adds.length, 0);

  const coded = makeDepView({ lines: [task, line], treeTag: "codeblock" });
  assert.equal(plugin.buildDependencyChipDecorations(coded).adds.length, 0, "no chips in code");

  // Only visible ranges are processed: the offscreen duplicate builds nothing.
  const offscreen = makeDepView({ lines: [task, line, "plain", line] });
  offscreen.visibleRanges = [{ from: 0, to: task.length + 1 + line.length }];
  assert.equal(plugin.buildDependencyChipDecorations(offscreen).adds.length, 1);

  const all = plugin.buildDependencyChipDecorations(makeDepView({ lines: [task, line] }));
  assert.equal(all.adds.length, 1);

  const first = plugin.buildDependencyChipDecorations(view).adds[0].value.widget;
  const second = plugin.buildDependencyChipDecorations(makeDepView({ lines: [task, line] })).adds[0].value.widget;
  assert.equal(first.eq(second), true);
  const changedTasks = [depTask({ blockId: "a", symbol: "*", description: "Alpha", path: "a.md" })];
  const changedPlugin = depPluginWithTasks([line], changedTasks);
  const changed = changedPlugin.buildDependencyChipDecorations(makeDepView({ lines: [task, line] })).adds[0].value.widget;
  assert.equal(first.eq(changed), false);
});

test("decoration skips paragraphs, grandchildren, and Work Log lines", () => {
  const tasks = [depTask({ blockId: "a", symbol: " ", description: "Alpha", path: "a.md" })];
  const plugin = depPluginWithTasks([], tasks);
  // Paragraph: no list marker, no task parent.
  assert.equal(
    plugin.buildDependencyChipDecorations(makeDepView({ lines: ["para ⛓️ **DEPENDS ON:** [[#^a]]"] })).adds.length,
    0,
    "paragraph",
  );
  // Grandchild (DP19): nested two levels under the task.
  assert.equal(
    plugin.buildDependencyChipDecorations(
      makeDepView({ lines: ["- [ ] #task T ^t", "  - outer", "    - ⛓️ **DEPENDS ON:** [[#^a]]"] }),
    ).adds.length,
    0,
    "grandchild",
  );
  // Work Log entry (DP20).
  assert.equal(
    plugin.buildDependencyChipDecorations(
      makeDepView({ lines: ["- [ ] #task T ^t", "  - 🛠️ **WORK LOG**", "    - ⛓️ **DEPENDS ON:** [[#^a]]"] }),
    ).adds.length,
    0,
    "work log",
  );
  // Direct child still decorates.
  assert.equal(
    plugin.buildDependencyChipDecorations(
      makeDepView({ lines: ["- [ ] #task T ^t", "  - ⛓️ **DEPENDS ON:** [[#^a]]"] }),
    ).adds.length,
    1,
    "direct child",
  );
});

test("widget identity covers the line and the interactive flag", () => {
  const task = "- [ ] #task T ^t";
  const line = "  - ⛓️ **DEPENDS ON:** [[#^a]]";
  const tasks = [depTask({ blockId: "a", symbol: " ", description: "Alpha", path: "a.md" })];
  const navApi = {
    version: 1,
    openDependencyStage: () => Promise.resolve({ ok: true }),
    removeDependency: () => Promise.resolve({ ok: true }),
  };
  const plain = depPluginWithTasks([line], tasks);
  const live = depPluginWithTasks([line], tasks, { navApi });
  const widget = (withNav, lines) =>
    (withNav ? live : plain).buildDependencyChipDecorations(makeDepView({ lines })).adds[0].value.widget;
  const base = widget(false, [task, line]);
  // Same line, same api: equal.
  assert.equal(base.eq(widget(false, [task, line])), true);
  // A line inserted above shifts the line number: not equal.
  assert.equal(base.eq(widget(false, ["- [ ] #task Before ^b", task, line])), false);
  // Nav's api loading later flips interactivity: not equal.
  assert.equal(base.eq(widget(true, [task, line])), false);
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
    "- ⛓️ **DEPENDS ON:** [[#^a]]",
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
      handlers: {},
      addEventListener: (name, handler) => {
        node.handlers[name] = handler;
      },
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

function readingDepRow(fixture, blockIds) {
  // Builds a parent task row containing one Depends-On row, as Reading
  // view renders it: emoji text, bold label, and one anchor per block id
  // joined by raw separators.
  const { root, doc, el } = fixture;
  const taskLi = el("li");
  taskLi.ownerDocument = doc;
  taskLi.appendChild(doc.createTextNode("Make appt "));
  const nested = el("ul");
  taskLi.appendChild(nested);
  const li = el("li");
  li.ownerDocument = doc;
  nested.appendChild(li);
  li.appendChild(doc.createTextNode("⛓️ "));
  const strong = el("strong");
  strong.ownerDocument = doc;
  strong.textContent = "DEPENDS ON:";
  li.appendChild(strong);
  const anchors = [];
  blockIds.forEach((blockId, index) => {
    if (index > 0) {
      li.appendChild(doc.createTextNode(" • "));
    } else {
      li.appendChild(doc.createTextNode(" "));
    }
    const anchor = el("a");
    anchor.ownerDocument = doc;
    anchor.className = "internal-link";
    anchor.setAttribute("data-href", "a.md#^" + blockId);
    anchor.setAttribute("href", "a.md#^" + blockId);
    anchor.appendChild(doc.createTextNode("Task " + blockId));
    li.appendChild(anchor);
    anchors.push(anchor);
  });
  root.appendChild(taskLi);
  return { taskLi, li, strong, anchors };
}

function collectReadingClasses(node, out = []) {
  if (node._attrs && node._attrs.class) {
    out.push(node._attrs.class);
  }
  for (const child of node.childNodes || node.children || []) {
    if (child && (child.childNodes || child.children)) {
      collectReadingClasses(child, out);
    }
  }
  return out;
}

test("reading view decorates only the Depends-On row, hides chrome, stays idempotent", () => {
  const tasks = [
    depTask({ blockId: "a", symbol: " ", description: "Alpha task", path: "a.md" }),
    depTask({ blockId: "b", symbol: "x", description: "Beta task", path: "a.md", type: "DONE" }),
  ];
  const plugin = depPluginWithTasks([], tasks);
  const fixture = fakeReadingDoc();
  const { taskLi, li, strong, anchors } = readingDepRow(fixture, ["a", "b"]);
  const [anchorA, anchorB] = anchors;
  plugin.renderDependencyChipsIn(fixture.root, { sourcePath: "a.md" });
  // The parent task row stays undecorated even though it contains the label.
  assert.equal(taskLi.className.indexOf("bob-dep-row"), -1);
  assert.ok(li.className.indexOf("bob-dep-row") !== -1);
  assert.ok(anchorA.className.indexOf("bob-dep-chip") !== -1);
  assert.equal(anchorA.getAttribute("href"), "a.md#^a");
  // Status-symbol boxes render on both chips.
  const classes = collectReadingClasses(li).join(" ");
  assert.ok(classes.indexOf("bob-dep-chip-box") !== -1);
  // Done text is struck through inside its own span.
  assert.ok(classes.indexOf("bob-dep-chip-text") !== -1);
  // The bold label is hidden and the raw separators are blanked.
  assert.equal(strong.getAttribute("data-bob-dep-hidden"), "1");
  assert.ok(anchorB.className.indexOf("is-done") !== -1);
  for (const child of li.childNodes || []) {
    if (child && child.nodeType === 3) {
      assert.ok(String(child.nodeValue || "").indexOf("•") === -1, "separator hidden");
    }
  }
  const before = li.childNodes.length;
  plugin.renderDependencyChipsIn(fixture.root, { sourcePath: "a.md" });
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

test("reading view collapses more than three Done targets to one chip", () => {
  const tasks = ["a", "b", "c", "d"].map((blockId) =>
    depTask({ blockId, symbol: "x", description: "Done " + blockId, path: "a.md", type: "DONE" }),
  );
  const plugin = depPluginWithTasks([], tasks);
  const fixture = fakeReadingDoc();
  const { li, anchors } = readingDepRow(fixture, ["a", "b", "c", "d"]);
  plugin.renderDependencyChipsIn(fixture.root, { sourcePath: "a.md" });
  for (const anchor of anchors) {
    assert.equal(anchor.getAttribute("data-bob-dep-collapsed"), "1");
  }
  const classes = collectReadingClasses(li).join(" ");
  assert.ok(classes.indexOf("is-done-collapsed") !== -1);
  let collapsedFound = false;
  const scan = (node) => {
    if (node && node.nodeType === 1) {
      const cls = node._attrs && node._attrs.class ? String(node._attrs.class) : "";
      if (cls.indexOf("is-done-collapsed") !== -1 && node.textContent === "✓×4") {
        collapsedFound = true;
      }
    }
    for (const child of (node && node.childNodes) || []) {
      scan(child);
    }
  };
  scan(li);
  assert.ok(collapsedFound, "collapsed chip shows ✓×4");
});

test("DC chip model vectors by id: DC2, DC5, DC6, DC9", () => {
  const lineFor = (id) => "- ⛓️ **DEPENDS ON:** [[#^" + id + "]]";
  // DC2: Next shows `*`.
  let model = dependencyChipModel(
    lineFor("n"),
    "a.md",
    depLookup([["n", depTask({ blockId: "n", symbol: "*", description: "Next one" })]]),
  );
  assert.equal(model.chips[0].state, "next");
  assert.equal(model.chips[0].symbol, "*");
  assert.equal(model.summary, "waiting on 1");
  // DC5: Done shows `✓`; beside an open target the summary still waits.
  model = dependencyChipModel(
    "- ⛓️ **DEPENDS ON:** [[#^open]] • [[#^done]]",
    "a.md",
    depLookup([
      ["open", depTask({ blockId: "open", symbol: " ", description: "Open" })],
      ["done", depTask({ blockId: "done", symbol: "x", description: "Done", type: "DONE" })],
    ]),
  );
  assert.equal(model.chips[1].state, "done");
  assert.equal(model.chips[1].symbol, "✓");
  assert.equal(model.summary, "waiting on 1");
  // DC6: Cancelled shows `✕`, visibly different from Done's `✓`.
  model = dependencyChipModel(
    lineFor("c"),
    "a.md",
    depLookup([["c", depTask({ blockId: "c", symbol: "-", description: "Cancelled", type: "CANCELLED" })]]),
  );
  assert.equal(model.chips[0].state, "cancelled");
  assert.equal(model.chips[0].symbol, "✕");
  // DC9: a cross-note target carries `↗ note` and counts as waiting.
  model = dependencyChipModel(
    "- ⛓️ **DEPENDS ON:** [[sase_bug_bash#^e2e]]",
    "body.md",
    depLookup([["e2e", depTask({ blockId: "e2e", symbol: " ", description: "Run e2e", path: "sase_bug_bash.md" })]]),
  );
  assert.equal(model.chips[0].noteLabel, "↗ sase_bug_bash");
  assert.equal(model.summary, "waiting on 1");
});

test("chip actions send the 0-based line index through nav api v1", () => {
  const task = "- [ ] #task T ^t";
  const line = "  - ⛓️ **DEPENDS ON:** [[#^a]]";
  const tasks = [depTask({ blockId: "a", symbol: " ", description: "Alpha", path: "a.md" })];
  const seen = { open: [], remove: [] };
  const navApi = {
    version: 1,
    openDependencyStage: (ref) => {
      seen.open.push(ref);
      return Promise.resolve({ ok: true });
    },
    removeDependency: (parentRef, target) => {
      seen.remove.push([parentRef, target]);
      return Promise.resolve({ ok: true });
    },
  };
  const plugin = depPluginWithTasks([line], tasks, { navApi });
  const widget = plugin.buildDependencyChipDecorations(makeDepView({ lines: [task, line] })).adds[0].value.widget;
  // The widget sits on the second note line: 0-based line 1 (contract §9).
  assert.equal(widget.meta.lineNumber, 1);
  plugin.dependencyRemoveChip(widget.model.chips[0], "a.md", widget.meta);
  plugin.dependencyOpenStage("a.md", widget.meta);
  assert.deepEqual(seen.remove[0][0], { path: "a.md", line: 1 });
  assert.deepEqual(seen.remove[0][1], { path: "a.md", blockId: "a" });
  assert.deepEqual(seen.open[0], { path: "a.md", line: 1 });
});

test("chip hover passes the chip element and its row to the preview", () => {
  const seen = [];
  const app = makeDepApp({ tasks: [] });
  app.workspace.trigger = (name, payload) => {
    seen.push([name, payload]);
  };
  const plugin = new LedgerToolsPlugin(app, {});
  const rowEl = { id: "row" };
  const chipEl = { id: "chip" };
  plugin.dependencyHoverTarget("a#^a", "a.md", {}, chipEl, rowEl);
  assert.equal(seen.length, 1);
  assert.equal(seen[0][0], "hover-link");
  assert.equal(seen[0][1].targetEl, chipEl);
  assert.equal(seen[0][1].hoverParent, rowEl);
  assert.equal(seen[0][1].linktext, "a#^a");
});

test("chip lookup index lives on the freshness memo", () => {
  const tasks = [depTask({ blockId: "a", symbol: " ", description: "Alpha", path: "a.md" })];
  const plugin = depPluginWithTasks([], tasks);
  plugin.freshnessMemo = { tasks, tasksGen: 0 };
  const first = plugin.dependencyTasksIndex();
  assert.ok(first instanceof Map);
  assert.equal(first.get("a.md a").description, "Alpha");
  // A current memo reuses the same index object.
  assert.equal(plugin.dependencyTasksIndex(), first);
  // A rebuilt memo drops the index with it.
  plugin.freshnessMemo = { tasks, tasksGen: 0 };
  assert.notEqual(plugin.dependencyTasksIndex(), first);
});

test("reading view hides actions when the line cannot be derived", async () => {
  const tasks = [depTask({ blockId: "a", symbol: " ", description: "Alpha", path: "a.md" })];
  const navApi = {
    version: 1,
    openDependencyStage: () => Promise.resolve({ ok: true }),
    removeDependency: () => Promise.resolve({ ok: true }),
  };
  const plugin = depPluginWithTasks([], tasks, { navApi });
  const fixture = fakeReadingDoc();
  const { li } = readingDepRow(fixture, ["a"]);
  plugin.renderDependencyChipsIn(fixture.root, { sourcePath: "a.md" });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  const classes = collectReadingClasses(li).join(" ");
  assert.ok(classes.indexOf("bob-dep-chip") !== -1, "chips still render");
  assert.equal(classes.indexOf("bob-dep-chip-remove"), -1, "no remove without a line");
  assert.equal(classes.indexOf("bob-dep-add"), -1, "no add without a line");
});

test("reading view actions carry the derived 0-based line", async () => {
  const tasks = [depTask({ blockId: "a", symbol: " ", description: "Alpha", path: "a.md" })];
  const seen = { open: [], remove: [] };
  const navApi = {
    version: 1,
    openDependencyStage: (ref) => {
      seen.open.push(ref);
      return Promise.resolve({ ok: true });
    },
    removeDependency: (parentRef, target) => {
      seen.remove.push([parentRef, target]);
      return Promise.resolve({ ok: true });
    },
  };
  const noteText = ["- [ ] #task T ^t", "  - prose", "  - ⛓️ **DEPENDS ON:** [[#^a]]"].join("\n");
  const app = makeDepApp({ tasks, navApi });
  app.vault.getAbstractFileByPath = (filePath) => (filePath === "a.md" ? { path: "a.md" } : null);
  app.vault.cachedRead = () => Promise.resolve(noteText);
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.dependencyChipsEnabled = true;
  const fixture = fakeReadingDoc();
  const { li, anchors } = readingDepRow(fixture, ["a"]);
  plugin.renderDependencyChipsIn(fixture.root, { sourcePath: "a.md" });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  // The Depends-On row is the third note line: 0-based line 2.
  assert.equal(await plugin.dependencyReadingLineFor("a.md", ["a"]), 2);
  const findByClass = (root, cls) => {
    let found = null;
    const scan = (node) => {
      if (found || !node || node.nodeType !== 1) {
        return;
      }
      if (String((node._attrs && node._attrs.class) || "").split(/\s+/).includes(cls)) {
        found = node;
        return;
      }
      for (const child of node.childNodes || []) {
        scan(child);
      }
    };
    scan(root);
    return found;
  };
  const remove = findByClass(li, "bob-dep-chip-remove");
  assert.ok(remove, "remove renders once the line is known");
  remove.handlers.click({});
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(seen.remove[0][0], { path: "a.md", line: 2 });
  assert.deepEqual(seen.remove[0][1], { path: "a.md", blockId: "a" });
  const add = findByClass(li, "bob-dep-add");
  assert.ok(add, "add renders once the line is known");
  add.handlers.click({});
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(seen.open[0], { path: "a.md", line: 2 });
  void anchors;
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
