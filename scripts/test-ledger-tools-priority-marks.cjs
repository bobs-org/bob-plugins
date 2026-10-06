// Tests for bob-ledger-tools priority marks (bob-cli-4p ledger-marks).
// Covers the canonical-field parser, the lenient ladder-config
// reader, the mark model and tooltip, the element builder, the Live
// Preview decoration, the rendered-view post-processor, the ladder
// snapshot cache, the session toggle, the `api.priorityMarks` v1
// namespace, and the styles.css contract. The `### Priority marks`
// display contract in bob-cli `docs/projects.md` is authoritative;
// PM vectors below are that contract's conformance vectors verbatim.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");

const editorInfoField = { _priorityField: "info" };
const editorLivePreviewField = { _priorityField: "live" };

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
  Module._load = function loadWithPriorityStubs(request) {
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
  PRIORITY_MARK_VALUES,
  priorityMarkSource,
  priorityMarkSourceInText,
  coercePriorityLadder,
  priorityMarkModel,
  buildPriorityMarkElement,
} = helpers;

const HINT = "Ctrl+Shift+P to change";
const LADDER = Object.freeze([
  Object.freeze({ label: "P1", value: "high", minDays: 2, maxDays: 7 }),
  Object.freeze({ label: "P2", value: "medium", minDays: 8, maxDays: 30 }),
  Object.freeze({ label: "P3", value: "low", minDays: 31, maxDays: 90 }),
  Object.freeze({ label: "P4", value: "lowest", minDays: 91, maxDays: 365 }),
]);

function tooltipOn(label, value, rolls) {
  return label + " \u00b7 " + value + " priority\n" + rolls + "\n" + HINT;
}

// Conformance vectors PM1-PM5 verbatim (default ladder above).
test("parser accepts the PM1-PM5 conformance vectors verbatim", () => {
  const pm1 = "- [ ] #task A [priority:: high] ^a";
  const s1 = priorityMarkSource(pm1);
  assert.ok(s1);
  assert.equal(s1.value, "high");
  assert.equal(s1.foldSpace, true);
  assert.equal(pm1.slice(s1.fieldStart, s1.fieldEnd), "[priority:: high]");
  const m1 = priorityMarkModel(s1.value, LADDER);
  assert.equal(m1.glyph, "bars");
  assert.equal(m1.filled, 4);
  assert.equal(m1.label, "P1");
  assert.equal(m1.tooltip, tooltipOn("P1", "High", "Rolls 2\u20137 days ahead"));

  const pm2 = "- [?] #task B [priority::medium] [scheduled::2026-10-22]";
  const s2 = priorityMarkSource(pm2);
  assert.ok(s2);
  assert.equal(s2.value, "medium");
  const m2 = priorityMarkModel(s2.value, LADDER);
  assert.equal(m2.filled, 3);
  assert.equal(m2.tooltip, tooltipOn("P2", "Medium", "Rolls 8\u201330 days ahead"));

  const pm3 = "- [ ] #task C (priority:: low)";
  const s3 = priorityMarkSource(pm3);
  assert.ok(s3);
  assert.equal(s3.value, "low");
  assert.equal(pm3.slice(s3.fieldStart, s3.fieldEnd), "(priority:: low)");
  const m3 = priorityMarkModel(s3.value, LADDER);
  assert.equal(m3.filled, 2);
  assert.equal(m3.tooltip, tooltipOn("P3", "Low", "Rolls 31\u201390 days ahead"));

  const pm4 = "- [ ] #task D [ priority:: lowest ]";
  const s4 = priorityMarkSource(pm4);
  assert.ok(s4);
  assert.equal(s4.value, "lowest");
  assert.equal(pm4.slice(s4.fieldStart, s4.fieldEnd), "[ priority:: lowest ]");
  const m4 = priorityMarkModel(s4.value, LADDER);
  assert.equal(m4.filled, 1);
  assert.equal(m4.tooltip, tooltipOn("P4", "Lowest", "Rolls 91\u2013365 days ahead"));

  const pm5 = "- [ ] #task E [priority:: highest]";
  const s5 = priorityMarkSource(pm5);
  assert.ok(s5);
  assert.equal(s5.value, "highest");
  const m5 = priorityMarkModel(s5.value, LADDER);
  assert.equal(m5.glyph, "urgent");
  assert.equal(m5.label, null);
  assert.equal(
    m5.tooltip,
    "Highest priority\nNot on the P1\u2013P4 ladder\n" + HINT,
  );
});

test("parser rejects the PM7-PM12 conformance vectors verbatim", () => {
  assert.equal(priorityMarkSource("- [ ] #task F [priority:: High]"), null);
  assert.equal(priorityMarkSource("- [ ] #task G [priority:: P2]"), null);
  assert.equal(
    priorityMarkSource("- [ ] #task H [priority:: high] [priority:: low]"),
    null,
  );
  assert.equal(priorityMarkSource("- [ ] #task I [priority:: high)"), null);
  assert.equal(priorityMarkSource("- plain bullet [priority:: high]"), null);
  // PM12 is code: the pure source still finds the field (mirroring
  // `freshnessMarkSource`), and the decoration builder excludes it
  // via the syntax tree.
  const pm12 = "- [ ] #task J `[priority:: high]`";
  const s12 = priorityMarkSource(pm12);
  assert.ok(s12);
  assert.equal(s12.value, "high");
  // Rendered nodes skip the task-line check (Tasks may have split
  // off the suffix); duplicates and mismatches still reject.
  const t12 = priorityMarkSourceInText("Buy milk [priority:: high] done");
  assert.ok(t12);
  assert.equal(t12.value, "high");
  assert.equal(t12.foldSpace, undefined);
  assert.equal(
    priorityMarkSourceInText("a [priority:: high] b [priority:: low]"),
    null,
  );
  assert.equal(priorityMarkSourceInText("a [priority:: High] b"), null);
});

test("PM6 with the ladder unknown omits P-labels instead of guessing", () => {
  const source = priorityMarkSource("- [?] #task B [priority::medium] x");
  assert.ok(source);
  const model = priorityMarkModel(source.value, null);
  assert.equal(model.filled, 3);
  assert.equal(model.glyph, "bars");
  assert.equal(model.label, null);
  assert.equal(model.tooltip, "Medium priority\n" + HINT);
});

test("PM13-PM17 ladder and line variants hold", () => {
  const single = Object.freeze([
    Object.freeze({ label: "P1", value: "highest", minDays: 1, maxDays: 3 }),
  ]);
  const m13 = priorityMarkModel("highest", single);
  assert.equal(m13.glyph, "urgent");
  assert.equal(m13.label, "P1");
  assert.equal(
    m13.tooltip,
    tooltipOn("P1", "Highest", "Rolls 1\u20133 days ahead"),
  );
  const five = Object.freeze([
    Object.freeze({ label: "P1", value: "high", minDays: 5, maxDays: 5 }),
  ]);
  assert.equal(
    priorityMarkModel("high", five).tooltip,
    tooltipOn("P1", "High", "Rolls 5 days ahead"),
  );
  const one = Object.freeze([
    Object.freeze({ label: "P1", value: "high", minDays: 1, maxDays: 1 }),
  ]);
  assert.equal(
    priorityMarkModel("high", one).tooltip,
    tooltipOn("P1", "High", "Rolls 1 day ahead"),
  );
  // PM14 single-level off-ladder text names the one label.
  assert.equal(
    priorityMarkModel("lowest", five).tooltip,
    "Lowest priority\nNot on the P1 ladder\n" + HINT,
  );
  // PM15 is a resting tone in CSS; the model still fills 4 bars.
  const m15 = priorityMarkModel(
    priorityMarkSource("- [x] #task K [priority:: high]").value,
    LADDER,
  );
  assert.equal(m15.filled, 4);
  assert.equal(m15.glyph, "bars");
  // PM16 is quote-aware.
  const s16 = priorityMarkSource("> - [ ] #task L [priority:: medium]");
  assert.ok(s16);
  assert.equal(s16.value, "medium");
  // PM17 folds no space.
  const pm17 = "- [ ] #task M x[priority:: low]";
  const s17 = priorityMarkSource(pm17);
  assert.ok(s17);
  assert.equal(s17.value, "low");
  assert.equal(s17.foldSpace, false);
  assert.equal(pm17.slice(s17.fieldStart, s17.fieldEnd), "[priority:: low]");
});

test("no model output contains a double colon", () => {
  const ladders = [LADDER, null, Object.freeze([])];
  for (const value of PRIORITY_MARK_VALUES) {
    for (const ladder of ladders) {
      const model = priorityMarkModel(value, ladder);
      assert.ok(model, value);
      assert.ok(model.tooltip.indexOf("::") === -1, model.tooltip);
      assert.ok(model.key.indexOf("::") === -1, model.key);
    }
  }
  assert.deepEqual(
    Array.from(PRIORITY_MARK_VALUES).sort(),
    ["high", "highest", "low", "lowest", "medium"],
  );
  assert.equal(priorityMarkModel("P2", LADDER), null);
  // A malformed ladder degrades to unknown, never a guess.
  assert.equal(priorityMarkModel("high", "bogus").label, null);
  assert.equal(priorityMarkModel(null, LADDER), null);
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

test("element structure and the decorative/inheritColor options", () => {
  const doc = fakeElementDoc();
  const model = priorityMarkModel("high", LADDER);
  const span = buildPriorityMarkElement(doc, model, { foldSpace: true });
  assert.ok(span);
  assert.equal(span.attrs.class, "bob-priority-mark");
  assert.equal(span.attrs["data-priority"], "high");
  assert.equal(span.attrs["data-fold-space"], "true");
  assert.equal(span.attrs.role, "img");
  assert.equal(span.attrs["aria-label"], model.tooltip);
  assert.equal(span.attrs["data-tooltip-position"], "top");
  assert.equal(span.children.length, 1);
  assert.equal(span.children[0].attrs.class, "bob-priority-mark-glyph");

  const plain = buildPriorityMarkElement(doc, model, {});
  assert.equal(plain.attrs["data-fold-space"], "false");
  assert.equal(plain.attrs["data-inherit-color"], undefined);

  const decorative = buildPriorityMarkElement(doc, model, {
    decorative: true,
    inheritColor: true,
  });
  assert.equal(decorative.attrs["aria-hidden"], "true");
  assert.equal(decorative.attrs.role, undefined);
  assert.equal(decorative.attrs["aria-label"], undefined);
  assert.equal(decorative.attrs["data-inherit-color"], "true");

  assert.equal(buildPriorityMarkElement(null, model, {}), null);
  assert.equal(buildPriorityMarkElement(doc, null, {}), null);
  assert.equal(
    buildPriorityMarkElement(doc, { value: "P2", glyph: "bars" }, {}),
    null,
  );
  assert.equal(
    buildPriorityMarkElement(doc, { value: "high", glyph: "dots" }, {}),
    null,
  );
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
  process.env.XDG_CONFIG_HOME = "/definitely/missing/priority-marks-test";
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

function pluginWithLadder(ladder = LADDER) {
  const plugin = new LedgerToolsPlugin(makeSurfaceApp(), {});
  plugin.priorityMarksEnabled = true;
  plugin.priorityLadderSnapshot = () => ({ ladder });
  return plugin;
}

test("Live Preview decorations fold space, reveal, and refuse", () => {
  const plugin = pluginWithLadder();
  // PM1 with space folding: the range starts at the folded space.
  const pm1 = "- [ ] #task A [priority:: high] ^a";
  const s1 = priorityMarkSource(pm1);
  const folded = plugin.buildPriorityMarkDecorations(
    makeView({ lines: [pm1] }),
  );
  assert.equal(folded.adds.length, 1);
  assert.equal(folded.adds[0].from, s1.fieldStart - 1);
  assert.equal(folded.adds[0].to, s1.fieldEnd);
  const widget = folded.adds[0].value.widget;
  assert.ok(widget instanceof StubWidgetType);
  assert.equal(widget.foldSpace, true);
  const rebuilt = plugin.buildPriorityMarkDecorations(
    makeView({ lines: [pm1] }),
  );
  assert.equal(widget.eq(rebuilt.adds[0].value.widget), true);

  // PM17 without space folding: the range starts at the bracket.
  const pm17 = "- [ ] #task M x[priority:: low]";
  const s17 = priorityMarkSource(pm17);
  const unfolded = plugin.buildPriorityMarkDecorations(
    makeView({ lines: [pm17] }),
  );
  assert.equal(unfolded.adds.length, 1);
  assert.equal(unfolded.adds[0].from, s17.fieldStart);
  assert.equal(unfolded.adds[0].value.widget.foldSpace, false);

  // Selection reveal: any overlap shows the raw field.
  const revealed = plugin.buildPriorityMarkDecorations(
    makeView({
      lines: [pm1],
      selection: [{ from: s1.fieldStart, to: s1.fieldStart }],
    }),
  );
  assert.equal(revealed.adds.length, 0);

  // No marks in source mode, inside code, on non-task lines, or off.
  assert.equal(
    plugin.buildPriorityMarkDecorations(makeView({ lines: [pm1], live: false })),
    StubDecoration.none,
  );
  assert.equal(
    plugin.buildPriorityMarkDecorations(
      makeView({ lines: [pm1], treeTag: "codeblock" }),
    ).adds.length,
    0,
  );
  assert.equal(
    plugin.buildPriorityMarkDecorations(
      makeView({ lines: ["- plain bullet [priority:: high]"] }),
    ).adds.length,
    0,
  );
  assert.equal(
    plugin.buildPriorityMarkDecorations(
      makeView({ lines: ["- [ ] #task F [priority:: High]"] }),
    ).adds.length,
    0,
  );
  plugin.priorityMarksEnabled = false;
  assert.equal(
    plugin.buildPriorityMarkDecorations(makeView({ lines: [pm1] })),
    StubDecoration.none,
  );
  plugin.priorityMarksEnabled = true;
  assert.equal(
    plugin.buildPriorityMarkDecorations(makeView({ lines: [pm1], path: null })),
    StubDecoration.none,
  );
});

test("a line with fresh and priority fields gets a disjoint decoration", () => {
  const plugin = pluginWithLadder();
  const line = "- [ ] #task T [fresh:: 2026-10-05] [priority:: high]";
  const source = priorityMarkSource(line);
  assert.ok(source);
  const decorations = plugin.buildPriorityMarkDecorations(
    makeView({ lines: [line] }),
  );
  assert.equal(decorations.adds.length, 1);
  assert.equal(decorations.adds[0].from, source.fieldStart - 1);
  assert.equal(decorations.adds[0].to, source.fieldEnd);
  assert.ok(line.slice(decorations.adds[0].to).indexOf("[priority::") === -1);
  assert.ok(
    line
      .slice(0, decorations.adds[0].from + 1)
      .indexOf("[priority::") === -1,
  );
});

test("widget mousedown reveals the field at the folded offset", () => {
  const plugin = pluginWithLadder();
  const line = "- [ ] #task A [priority:: high] ^a";
  const view = makeView({ lines: [line] });
  const widget = plugin.buildPriorityMarkDecorations(view).adds[0].value.widget;
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
    assert.equal(view.dispatched[0].selection.anchor, 42 + 1);
    assert.equal(view.focused, true);
  } finally {
    if (savedDocument === undefined) {
      delete global.document;
    } else {
      global.document = savedDocument;
    }
  }
});

function fakeRenderEl() {
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

function countMarks(root) {
  let count = 0;
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (
      node.nodeType === 1 &&
      node.className &&
      node.className.split(/\s+/).includes("bob-priority-mark")
    ) {
      count += 1;
    }
    for (const child of node.childNodes || []) {
      stack.push(child);
    }
  }
  return count;
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

function taskLi(fx, textValue) {
  const li = fx.doc.createElement("li");
  li.className = "task-list-item";
  fx.root.appendChild(li);
  li.appendChild(fx.text(textValue, fx.doc));
  return li;
}

test("rendered views split task nodes and skip exclusions", () => {
  const plugin = pluginWithLadder();
  const fx = fakeRenderEl();
  taskLi(fx, "Buy milk [priority:: high] done");
  plugin.renderPriorityMarksIn(fx.root, { sourcePath: "a.md" });
  assert.equal(countMarks(fx.root), 1);
  assert.ok(collectText(fx.root).indexOf("[priority::") === -1);
  // Idempotent: a second pass keeps one mark.
  plugin.renderPriorityMarksIn(fx.root, { sourcePath: "a.md" });
  assert.equal(countMarks(fx.root), 1);

  // Non-task `li` gets no mark.
  const plain = fakeRenderEl();
  const plainLi = plain.doc.createElement("li");
  plain.root.appendChild(plainLi);
  plainLi.appendChild(plain.text("Buy milk [priority:: high]", plain.doc));
  plugin.renderPriorityMarksIn(plain.root, { sourcePath: "a.md" });
  assert.equal(countMarks(plain.root), 0);

  // Code, existing marks, and Dataview pills are untouched.
  for (const wrap of ["code", "pre"]) {
    const boxed = fakeRenderEl();
    const box = boxed.doc.createElement(wrap);
    boxed.root.appendChild(box);
    box.appendChild(boxed.text("Buy milk [priority:: high]", boxed.doc));
    plugin.renderPriorityMarksIn(boxed.root, { sourcePath: "a.md" });
    assert.equal(countMarks(boxed.root), 0, wrap);
  }
  const marked = fakeRenderEl();
  const holder = marked.doc.createElement("span");
  holder.className = "bob-priority-mark";
  marked.root.appendChild(holder);
  holder.appendChild(marked.text("Buy milk [priority:: high]", marked.doc));
  plugin.renderPriorityMarksIn(marked.root, { sourcePath: "a.md" });
  assert.equal(countMarks(marked.root), 1);

  const pill = fakeRenderEl();
  const pillLi = pill.doc.createElement("li");
  pillLi.className = "task-list-item";
  pill.root.appendChild(pillLi);
  const pillEl = pill.doc.createElement("span");
  pillEl.className = "dataview inline-field";
  pillLi.appendChild(pillEl);
  pillEl.appendChild(pill.text("Buy milk [priority:: high]", pill.doc));
  plugin.renderPriorityMarksIn(pill.root, { sourcePath: "a.md" });
  assert.equal(countMarks(pill.root), 0);

  // Duplicates in one node get no mark on either.
  const dup = fakeRenderEl();
  taskLi(dup, "a [priority:: high] b [priority:: low]");
  plugin.renderPriorityMarksIn(dup.root, { sourcePath: "a.md" });
  assert.equal(countMarks(dup.root), 0);

  // Disabled marks render nothing.
  const off = fakeRenderEl();
  taskLi(off, "Buy milk [priority:: high]");
  plugin.priorityMarksEnabled = false;
  plugin.renderPriorityMarksIn(off.root, { sourcePath: "a.md" });
  assert.equal(countMarks(off.root), 0);
});

test("ladder coercion is lenient: valid, partial, and unknown", () => {
  const valid = coercePriorityLadder({
    properties: [
      { name: "scheduled", values: "date" },
      {
        name: "priority",
        values: "priority",
        levels: [
          { label: "P1", value: "high", min_days: 2, max_days: 7 },
          { label: "P2", value: "medium", minDays: 8, maxDays: 30 },
          { label: "P3", value: "low", min_days: 31, max_days: 90 },
          { label: "P4", value: "lowest", min_days: 91, max_days: 365 },
        ],
      },
    ],
  });
  assert.ok(valid);
  assert.equal(valid.length, 4);
  assert.deepEqual(valid[1], {
    label: "P2",
    value: "medium",
    minDays: 8,
    maxDays: 30,
  });
  assert.ok(Object.isFrozen(valid));
  assert.ok(Object.isFrozen(valid[0]));

  // Partial: bad levels are skipped, good ones survive.
  const partial = coercePriorityLadder({
    properties: [
      {
        name: "priority",
        values: "priority",
        levels: [
          { label: "", value: "high", min_days: 2, max_days: 7 },
          { label: "P2", value: null, min_days: 8, max_days: 30 },
          { label: "P3", value: "low", min_days: 90, max_days: 31 },
          { label: "P4", value: "lowest", min_days: 91, max_days: 365 },
        ],
      },
    ],
  });
  assert.ok(partial);
  assert.equal(partial.length, 1);
  assert.equal(partial[0].label, "P4");

  // Unknown: no entry, no levels, no properties, bad input.
  assert.equal(
    coercePriorityLadder({ properties: [{ name: "priority" }] }),
    null,
  );
  assert.equal(coercePriorityLadder({ properties: [] }), null);
  assert.equal(coercePriorityLadder({}), null);
  assert.equal(coercePriorityLadder(null), null);
  assert.equal(coercePriorityLadder("properties: []"), null);
  assert.equal(
    coercePriorityLadder({
      properties: [{ name: "priority", values: "priority", levels: [] }],
    }),
    null,
  );
  // The first matching entry wins.
  const two = coercePriorityLadder({
    properties: [
      {
        name: "priority",
        values: "priority",
        levels: [{ label: "P1", value: "high", min_days: 2, max_days: 7 }],
      },
      {
        name: "priority",
        values: "priority",
        levels: [{ label: "Q1", value: "low", min_days: 1, max_days: 1 }],
      },
    ],
  });
  assert.equal(two.length, 1);
  assert.equal(two[0].label, "P1");
});

function withTempConfigHome(files, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "priority-marks-"));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(dir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
    const saved = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = dir;
    try {
      return run(dir);
    } finally {
      if (saved === undefined) {
        delete process.env.XDG_CONFIG_HOME;
      } else {
        process.env.XDG_CONFIG_HOME = saved;
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function ladderConfigJson(levels) {
  return JSON.stringify({
    properties: [{ name: "priority", values: "priority", levels }],
  });
}

const DEFAULT_LEVELS = [
  { label: "P1", value: "high", min_days: 2, max_days: 7 },
  { label: "P2", value: "medium", min_days: 8, max_days: 30 },
  { label: "P3", value: "low", min_days: 31, max_days: 90 },
  { label: "P4", value: "lowest", min_days: 91, max_days: 365 },
];

test("ladder snapshot reads the file and reuses the cache", () => {
  withTempConfigHome({ "bob/config.yml": ladderConfigJson(DEFAULT_LEVELS) }, () => {
    const plugin = new LedgerToolsPlugin(makeSurfaceApp(), {});
    const first = plugin.priorityLadderSnapshot();
    assert.ok(first.ladder);
    assert.equal(first.ladder.length, 4);
    assert.equal(first.ladder[0].label, "P1");
    // Cache reuse: deleting the file within the tick keeps the ladder.
    fs.rmSync(
      path.join(process.env.XDG_CONFIG_HOME, "bob", "config.yml"),
      { force: true },
    );
    const second = plugin.priorityLadderSnapshot();
    assert.ok(second.ladder);
    assert.equal(second.ladder.length, 4);
    // A stale check re-stats and sees the missing file.
    plugin.priorityLadderCache.checkedAt = 0;
    const third = plugin.priorityLadderSnapshot(new Date(Date.now() + 3600 * 1000));
    assert.equal(third.ladder, null);
  });
});

test("ladder snapshot degrades on missing files and parse errors", () => {
  const saved = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = "/definitely/missing/priority-marks-test";
  try {
    const plugin = new LedgerToolsPlugin(makeSurfaceApp(), {});
    assert.equal(plugin.priorityLadderSnapshot().ladder, null);
  } finally {
    if (saved === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = saved;
    }
  }
  withTempConfigHome({ "bob/config.yml": "not json{{{[" }, () => {
    const plugin = new LedgerToolsPlugin(makeSurfaceApp(), {});
    assert.equal(plugin.priorityLadderSnapshot().ladder, null);
  });
});

test("ladder snapshot is unknown on mobile", () => {
  const MobilePlugin = loadPluginModule(false);
  const plugin = new MobilePlugin(makeSurfaceApp(), {});
  assert.equal(plugin.priorityLadderSnapshot().ladder, null);
});

test("api.priorityMarks v1 is additive, sync, and never throwing", () => {
  const savedDocument = global.document;
  const stubDoc = fakeElementDoc();
  stubDoc.body = { classList: { add: () => {}, remove: () => {} } };
  global.document = stubDoc;
  try {
    const plugin = withMissingConfig(() => {
      const instance = new LedgerToolsPlugin(makeSurfaceApp(), {});
      instance.onload();
      return instance;
    });
    try {
      assert.equal(plugin.api.version, 3);
      const api = plugin.api.priorityMarks;
      assert.ok(api);
      assert.equal(api.version, 1);
      assert.ok(Object.isFrozen(api));
      // Missing config: the ladder is unknown, so no P-labels.
      const model = api.model("medium");
      assert.ok(model);
      assert.equal(model.label, null);
      assert.equal(
        model.tooltip,
        "Medium priority\n" + HINT,
      );
      assert.equal(api.model("P2"), null);
      assert.equal(api.model(null), null);

      const host = {
        children: [],
        appendChild(c) {
          this.children.push(c);
          return c;
        },
      };
      const el = api.render(host, "low", {
        decorative: true,
        inheritColor: true,
      });
      assert.ok(el);
      assert.equal(host.children.length, 1);
      assert.equal(api.render(host, "P2", {}), null);
      assert.equal(api.render(null, "low", {}), null);
      assert.equal(api.render({}, "low", {}), null);
      const throwing = {
        appendChild() {
          throw new Error("nope");
        },
      };
      assert.equal(api.render(throwing, "low", {}), null);
      // A throwing snapshot degrades to an unknown ladder, never an
      // exception: the glyph is chosen by value, so it stays truthful.
      const broken = pluginWithLadder();
      broken.priorityLadderSnapshot = () => {
        throw new Error("nope");
      };
      const degraded = broken.priorityMarksApi().model("high");
      assert.ok(degraded);
      assert.equal(degraded.label, null);
      assert.ok(broken.priorityMarksApi().render(host, "high", {}));
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
    const plugin = withMissingConfig(() => {
      const instance = new LedgerToolsPlugin(makeSurfaceApp({ triggers }), {});
      instance.onload();
      return instance;
    });
    try {
      assert.equal(plugin.priorityMarksEnabled, true);
      assert.ok(classes.has("bob-priority-marks"));
      const toggle = (plugin.commands || []).find(
        (command) => command.id === "toggle-priority-marks",
      );
      assert.ok(toggle);
      assert.equal(toggle.name, "Toggle task priority marks");
      assert.ok(
        (plugin.editorExtensions || []).length >= 3,
        "tab keymap plus the fresh and priority mark extensions",
      );
      assert.ok(capturedMarkClass);
      const posts = (plugin.postProcessors || []).filter(
        (entry) => entry.sortOrder === 50,
      );
      assert.ok(posts.length >= 2);
      assert.equal(plugin.togglePriorityMarks(), false);
      assert.equal(classes.has("bob-priority-marks"), false);
      assert.equal(plugin.togglePriorityMarks(), true);
      assert.equal(classes.has("bob-priority-marks"), true);
      assert.ok(
        TestNotice.messages.indexOf("Priority marks off") !== -1,
        JSON.stringify(TestNotice.messages),
      );
      assert.ok(
        TestNotice.messages.indexOf("Priority marks on") !== -1,
        JSON.stringify(TestNotice.messages),
      );
      assert.ok(
        triggers.indexOf(
          "obsidian-tasks-plugin:reload-open-search-results",
        ) !== -1,
      );
      // While off, the builders stay silent.
      plugin.priorityMarksEnabled = false;
      assert.equal(
        plugin.buildPriorityMarkDecorations(
          makeView({ lines: ["- [ ] #task A [priority:: high]"] }),
        ),
        StubDecoration.none,
      );
      const fx = fakeRenderEl();
      taskLi(fx, "Buy milk [priority:: high]");
      plugin.renderPriorityMarksIn(fx.root, { sourcePath: "a.md" });
      assert.equal(countMarks(fx.root), 0);
    } finally {
      plugin.onunload();
    }
    assert.equal(classes.has("bob-priority-marks"), false);
  } finally {
    if (savedDocument === undefined) {
      delete global.document;
    } else {
      global.document = savedDocument;
    }
  }
});

test("styles.css contract: masks, both hosts, repair flag, resting", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "..", "plugins", "bob-ledger-tools", "styles.css"),
    "utf8",
  );
  const count = (needle) => css.split(needle).length - 1;
  // Each mask variable is defined exactly once.
  for (const name of [
    "--bob-priority-glyph-track",
    "--bob-priority-glyph-fill-1",
    "--bob-priority-glyph-fill-2",
    "--bob-priority-glyph-fill-3",
    "--bob-priority-glyph-fill-4",
    "--bob-priority-glyph-urgent",
  ]) {
    assert.equal(count(name + ":"), 1, name);
  }
  // Each of the five values has a rule on both glyph hosts.
  for (const value of PRIORITY_MARK_VALUES) {
    assert.ok(
      css.indexOf('.bob-priority-mark[data-priority="' + value + '"]') !== -1,
      "plugin host: " + value,
    );
    assert.ok(
      css.indexOf('.task-priority[data-task-priority="' + value + '"]') !== -1,
      "tasks host: " + value,
    );
  }
  // The visually-hidden emoji keeps screen-reader text on Tasks hosts.
  assert.ok(css.indexOf("clip-path: inset(50%)") !== -1);
  // The Live Preview repair flag targets leftover priority pills.
  assert.ok(
    css.indexOf('body.bob-priority-marks .markdown-source-view.is-live-preview') !== -1,
  );
  assert.ok(css.indexOf('[data-dv-norm-key="priority"]') !== -1);
  // Closed tasks render resting from the task ancestor.
  assert.ok(
    css.indexOf('li.task-list-item[data-task="x"] .bob-priority-mark') !== -1,
  );
  assert.ok(css.indexOf("prefers-reduced-motion") !== -1);
});
