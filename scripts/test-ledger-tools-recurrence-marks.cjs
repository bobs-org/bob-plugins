// Tests for bob-ledger-tools recurrence marks (bob-cli-ak recurrence-marks).
// Covers the canonical repeat parser, the spoken-cadence label grammar,
// the model and tooltip, the element builder, the guarded family
// dispatchers, Live Preview decorations, the rendered-view
// post-processor, rollover passthrough, the unchanged `api.dateMarks`
// v1, and the styles.css contract. The `docs/date-marks.md` display
// contract in bob-cli is authoritative; RM/RN/RR/RO/RA vectors below
// are that contract's conformance vectors verbatim.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");

const editorInfoField = { _dateMarkField: "info" };
const editorLivePreviewField = { _dateMarkField: "live" };

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
}

class TestNotice {
  constructor(message) {
    TestNotice.messages.push(String(message));
  }
}
TestNotice.messages = [];

function installStubs(isDesktopApp = true) {
  const originalLoad = Module._load;
  Module._load = function loadWithRecurrenceStubs(request) {
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
  recurrenceMarkCanonicalField,
  recurrenceRuleParts,
  recurrenceMarkLabel,
  recurrenceMarkModel,
  recurrenceMarkGuarded,
  recurrenceMarkRenderedGuard,
  buildRecurrenceMarkElement,
  buildDateMarkElement,
  dateFamilyMarkSources,
  dateFamilyMarkSourcesInText,
  dateFamilyMarkModel,
  dateMarkSources,
  dateMarkModel,
} = helpers;

test("recurrence helpers are exported and frozen where shaped", () => {
  for (const name of [
    "recurrenceMarkCanonicalField",
    "recurrenceRuleParts",
    "recurrenceMarkLabel",
    "recurrenceMarkModel",
    "recurrenceMarkGuarded",
    "recurrenceMarkRenderedGuard",
    "buildRecurrenceMarkElement",
    "dateFamilyMarkSources",
    "dateFamilyMarkSourcesInText",
    "dateFamilyMarkModel",
  ]) {
    assert.equal(typeof helpers[name], "function", name);
  }
  const canonical = recurrenceMarkCanonicalField(
    "- [ ] #task A [repeat:: every day]",
  );
  assert.ok(Object.isFrozen(canonical));
  const model = recurrenceMarkModel("every day");
  assert.ok(Object.isFrozen(model));
  const parts = recurrenceRuleParts("every day");
  assert.ok(Object.isFrozen(parts));
});

test("RM1 daily with when done: fold, label, tooltip", () => {
  const line =
    "- [?] #task #gtd #pre Brush teeth  [repeat:: every day when done]  [created:: 2026-10-21]";
  const sources = dateFamilyMarkSources(line);
  const repeat = sources.filter((entry) => entry.field === "repeat");
  assert.equal(repeat.length, 1);
  assert.equal(repeat[0].foldLength, 2);
  const model = dateFamilyMarkModel(repeat[0], "2026-10-21");
  assert.equal(model.label, "daily");
  assert.equal(
    model.tooltip,
    "Repeats every day when done\nNext date counts from completion",
  );
  assert.equal(model.whenDone, true);
  // The created mark stays and the ranges are disjoint and sorted.
  const created = sources.filter((entry) => entry.field === "created");
  assert.equal(created.length, 1);
  assert.ok(repeat[0].fieldEnd <= created[0].fieldStart);
  assert.ok(sources[0].fieldStart <= sources[1].fieldStart);
});

test("RM2 non-checklist row without when done still marks", () => {
  const line = "- [ ] #task Water plants [repeat:: every day]";
  const sources = dateFamilyMarkSources(line);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].field, "repeat");
  const model = dateFamilyMarkModel(sources[0], "2026-10-21");
  assert.equal(model.label, "daily");
  assert.equal(
    model.tooltip,
    "Repeats every day\nNext date follows the schedule",
  );
  assert.equal(model.whenDone, false);
});

test("RM3 weekday plurals keep the full name", () => {
  assert.equal(recurrenceMarkLabel("every week on Monday when done"), "Mondays");
  assert.equal(recurrenceMarkLabel("every week on Sunday"), "Sundays");
  assert.equal(recurrenceMarkLabel("every Friday"), "Fridays");
  assert.equal(
    recurrenceMarkModel("every week on Monday when done").tooltip,
    "Repeats every week on Monday when done\nNext date counts from completion",
  );
});

test("RM4 monthly ordinals use the written token", () => {
  assert.equal(recurrenceMarkLabel("every month on the 1st"), "monthly \u00b7 1st");
  assert.equal(
    recurrenceMarkLabel("every month on the last Friday"),
    "monthly \u00b7 last Fri",
  );
  assert.equal(
    recurrenceMarkLabel("every month on the 2nd Wednesday"),
    "monthly \u00b7 2nd Wed",
  );
});

test("RM5 every N days stays verbatim with its count", () => {
  assert.equal(recurrenceMarkLabel("every 30 days when done"), "every 30 days");
  assert.equal(recurrenceMarkLabel("every 28 days"), "every 28 days");
});

test("RM6 weekly, N-week, and yearly forms", () => {
  assert.equal(recurrenceMarkLabel("every 1 week"), "weekly");
  assert.equal(recurrenceMarkLabel("every 3 weeks on Friday"), "every 3 weeks \u00b7 Fri");
  assert.equal(recurrenceMarkLabel("every January on the 15th"), "yearly \u00b7 Jan 15");
});

test("RM7 week lists join with Tue, Fri and weekday alone", () => {
  assert.equal(
    recurrenceMarkLabel("every week on Tuesday, Friday"),
    "weekly \u00b7 Tue, Fri",
  );
  assert.equal(
    recurrenceMarkLabel("every week on Tuesday and Friday"),
    "weekly \u00b7 Tue, Fri",
  );
  assert.equal(recurrenceMarkLabel("every weekday"), "weekdays");
});

test("RM8 unknown rules stay verbatim", () => {
  assert.equal(
    recurrenceMarkLabel("every April and December on the 1st and 24th"),
    "every April and December on the 1st and 24th",
  );
  for (const rule of [
    "every constructor",
    "every week on constructor",
    "every constructor on the 1st",
  ]) {
    assert.equal(recurrenceMarkLabel(rule), rule);
    assert.equal(recurrenceMarkLabel(rule + " when done"), rule);
    const model = recurrenceMarkModel(rule + " when done");
    assert.equal(model.label, rule);
    assert.equal(model.tooltip, "Repeats " + rule + " when done\nNext date counts from completion");
  }
});

test("RM9 parens and padded brackets are canonical", () => {
  const paren = dateFamilyMarkSources("- [ ] #task B (repeat:: every week)");
  assert.equal(paren.length, 1);
  assert.equal(dateFamilyMarkModel(paren[0]).label, "weekly");
  const padded = dateFamilyMarkSources("- [ ] #task C [ repeat:: every  day ]");
  assert.equal(padded.length, 1);
  assert.equal(dateFamilyMarkModel(padded[0]).label, "daily");
});

test("RM10 case is preserved in the rule and tooltip", () => {
  const sources = dateFamilyMarkSources("- [ ] #task D [repeat:: Every Day When Done]");
  assert.equal(sources.length, 1);
  const model = dateFamilyMarkModel(sources[0]);
  assert.equal(model.label, "daily");
  assert.equal(
    model.tooltip,
    "Repeats Every Day When Done\nNext date counts from completion",
  );
});

test("RM11 cursor in the field reveals it, RM12 closed rows still mark", () => {
  const line = "- [ ] #task E [repeat:: every day]";
  const sources = dateFamilyMarkSources(line);
  assert.equal(sources.length, 1);
  assert.equal(typeof sources[0].foldLength, "number");
  const closed = dateFamilyMarkSources(
    "- [x] #task #gtd #pre Old [repeat:: every day]",
  );
  assert.equal(closed.filter((entry) => entry.field === "repeat").length, 1);
  assert.equal(recurrenceMarkGuarded("- [x] #task #gtd #pre Old [repeat:: every day]"), false);
});

test("RN1 unreadable rules get no mark", () => {
  assert.deepEqual(dateFamilyMarkSources("[repeat:: weekly]").filter((e) => e.field === "repeat"), []);
  assert.deepEqual(dateFamilyMarkSources("[Repeat:: every day]").filter((e) => e.field === "repeat"), []);
  assert.deepEqual(dateFamilyMarkSources("[repeat :: every day]").filter((e) => e.field === "repeat"), []);
  assert.deepEqual(
    dateFamilyMarkSources("[repeat:: every day; when done]").filter((e) => e.field === "repeat"),
    [],
  );
  assert.deepEqual(
    dateFamilyMarkSources("[repeat:: every day] [repeat:: every week]").filter((e) => e.field === "repeat"),
    [],
  );
  assert.deepEqual(dateFamilyMarkSources("[repeat:: every day)").filter((e) => e.field === "repeat"), []);
  assert.equal(recurrenceMarkModel("weekly"), null);
  assert.equal(recurrenceMarkModel("every day; x"), null);
  assert.equal(recurrenceMarkModel("every"), null);
  for (const rule of ["every\tday", "every\u00a0day"]) {
    assert.equal(recurrenceMarkModel(rule), null);
    assert.equal(recurrenceMarkCanonicalField("[repeat:: " + rule + "]"), null);
  }
  assert.equal(recurrenceMarkCanonicalField("[repeat::\tevery day]"), null);
  assert.equal(recurrenceMarkCanonicalField("[repeat:: every day\t]"), null);
  assert.equal(recurrenceMarkModel("every  day").label, "daily");
  assert.equal(recurrenceMarkModel("Every Day").label, "daily");
});

test("RN2 the checklist guard follows membership, not the glyph slot", () => {
  assert.equal(
    dateFamilyMarkSources("- [?] #task #gtd #pre Brush [repeat:: every day]").filter((e) => e.field === "repeat").length,
    0,
  );
  assert.equal(
    dateFamilyMarkSources("- [ ] #task Brush #gtd #post [repeat:: every day]").filter((e) => e.field === "repeat").length,
    0,
  );
  assert.equal(recurrenceMarkGuarded("- [?] #task #gtd #pre Brush [repeat:: every day]"), true);
  assert.equal(recurrenceMarkGuarded("- [ ] #task Water plants [repeat:: every day]"), false);
  assert.equal(recurrenceMarkGuarded("- [?] #task #gtd #pre Brush [repeat:: every day when done]"), false);
});

test("RN3 code still parses pure but decorates nothing", () => {
  assert.ok(recurrenceMarkCanonicalField("- [ ] `[repeat:: every day]`"));
  assert.equal(
    dateFamilyMarkSourcesInText("- [ ] `[repeat:: every day]`").filter((e) => e.field === "repeat").length,
    1,
  );
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

test("element anatomy: repeat host, rule, quiet tone, no date", () => {
  const doc = fakeElementDoc();
  const model = recurrenceMarkModel("every day when done");
  const span = buildRecurrenceMarkElement(doc, model, { foldSpace: true });
  assert.ok(span);
  assert.equal(span.attrs.class, "bob-date-mark");
  assert.equal(span.attrs["data-field"], "repeat");
  assert.equal(span.attrs["data-rule"], "every day when done");
  assert.equal(span.attrs["data-when-done"], "true");
  assert.equal(span.attrs["data-fold-space"], "true");
  assert.equal(span.attrs["data-rendered"], undefined);
  assert.equal(span.attrs["data-date"], undefined);
  assert.equal(span.attrs["data-when"], undefined);
  assert.equal(span.attrs.role, "img");
  assert.equal(span.attrs["aria-label"], model.tooltip);
  assert.equal(span.children.length, 2);
  assert.equal(span.children[1].children[0].text, "daily");
  const rendered = buildRecurrenceMarkElement(doc, model, { rendered: true });
  assert.equal(rendered.attrs["data-rendered"], "true");
  const decorative = buildRecurrenceMarkElement(doc, model, { decorative: true });
  assert.equal(decorative.attrs["aria-hidden"], "true");
  assert.equal(buildRecurrenceMarkElement(null, model, {}), null);
  assert.equal(buildRecurrenceMarkElement(doc, null, {}), null);
  assert.equal(buildRecurrenceMarkElement(doc, { ...model, field: "due" }, {}), null);
  // buildDateMarkElement delegates repeat models.
  const viaDate = buildDateMarkElement(doc, model, { foldSpace: true });
  assert.ok(viaDate);
  assert.equal(viaDate.attrs["data-field"], "repeat");
});

test("family dispatch keeps dates working and sorts adds", () => {
  const line = "- [ ] #task A [repeat:: every day] [created:: 2026-10-21]";
  const family = dateFamilyMarkSources(line);
  assert.equal(family.length, 2);
  assert.equal(family[0].field, "repeat");
  assert.equal(family[1].field, "created");
  assert.ok(family[0].fieldEnd <= family[1].fieldStart);
  const repeatModel = dateFamilyMarkModel(family[0], "2026-10-21");
  assert.equal(repeatModel.label, "daily");
  const dateModel = dateFamilyMarkModel(family[1], "2026-10-21");
  assert.equal(dateModel.field, "created");
  assert.equal(dateMarkModel("created", "2026-10-21", "2026-10-21").label, "today");
  const guarded = dateFamilyMarkSources("- [?] #task #gtd #pre X [repeat:: every day]");
  assert.equal(guarded.filter((e) => e.field === "repeat").length, 0);
  // Lazy guard: no repeat means the resolver never runs.
  let calls = 0;
  const noRepeat = dateFamilyMarkSourcesInText("plain [created:: 2026-10-21]", () => {
    calls += 1;
    return true;
  });
  assert.equal(calls, 0);
  assert.equal(noRepeat.length, 1);
  const dropped = dateFamilyMarkSourcesInText("[repeat:: every day]", () => true);
  assert.equal(dropped.filter((e) => e.field === "repeat").length, 0);
  const kept = dateFamilyMarkSourcesInText("[repeat:: every day]", () => false);
  assert.equal(kept.filter((e) => e.field === "repeat").length, 1);
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

function makeView({ lines, selection = [], live = true, path = "a.md", treeTag = null } = {}) {
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
    stateField: null,
  };
}

function makeSurfaceApp({ triggers = [], leaves = [] } = {}) {
  return {
    vault: { getAbstractFileByPath: () => null, cachedRead: () => Promise.resolve(null) },
    workspace: {
      on: () => ({}),
      offref: () => {},
      onLayoutReady: () => {},
      getActiveFile: () => null,
      getLeavesOfType: () => leaves,
      trigger: (event) => triggers.push(event),
    },
    metadataCache: { on: () => ({}), getCache: () => ({}), getFirstLinkpathDest: () => null },
    commands: {},
    plugins: { plugins: {} },
  };
}

function pluginWithToday(today = "2026-10-21") {
  const plugin = new LedgerToolsPlugin(makeSurfaceApp(), {});
  plugin.dateMarksEnabled = true;
  plugin.dateMarksToday = () => today;
  return plugin;
}

test("Live Preview decorates repeat and respects the guard and code", () => {
  const plugin = pluginWithToday();
  const line = "- [?] #task #gtd #pre Brush teeth  [repeat:: every day when done]  [created:: 2026-10-21]";
  const decorations = plugin.buildDateMarkDecorations(makeView({ lines: [line] }));
  assert.equal(decorations.adds.length, 2);
  assert.ok(decorations.adds[0].to <= decorations.adds[1].from);
  const guarded = plugin.buildDateMarkDecorations(
    makeView({ lines: ["- [?] #task #gtd #pre Brush [repeat:: every day]"] }),
  );
  assert.equal(guarded.adds.length, 0);
  const coded = plugin.buildDateMarkDecorations(
    makeView({ lines: ["- [ ] #task E `[repeat:: every day]`"], treeTag: "inline" }),
  );
  assert.equal(coded.adds.length, 0);
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
      _attrs: {},
      classList: {
        contains: (name) => String(node.className || "").split(/\s+/).includes(name),
      },
      getAttribute: (name) =>
        name === "class" ? node.className : node._attrs[name] !== undefined ? node._attrs[name] : null,
      hasAttribute: (name) => name === "class" || (node._attrs[name] !== undefined && node._attrs[name] !== null),
      setAttribute(name, value) {
        node._attrs[name] = String(value);
        if (name === "class") {
          node.className = String(value);
        }
      },
      querySelector: (selector) => {
        const wanted =
          selector === ".bob-date-mark-label" ? "bob-date-mark-label" : null;
        if (!wanted) {
          return null;
        }
        const stack = node.childNodes.slice();
        while (stack.length > 0) {
          const candidate = stack.pop();
          if (candidate && candidate.nodeType === 1 && String(candidate.className || "").split(/\s+/).includes(wanted)) {
            return candidate;
          }
          for (const child of (candidate && candidate.childNodes) || []) {
            stack.push(child);
          }
        }
        return null;
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
    return { nodeType: 3, nodeValue: value, textContent: value, parentNode: null, ownerDocument: doc };
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
    if (node.nodeType === 1 && node.className && node.className.split(/\s+/).includes("bob-date-mark")) {
      count += 1;
    }
    for (const child of node.childNodes || []) {
      stack.push(child);
    }
  }
  return count;
}

function textPara(fx, textValue) {
  const para = fx.doc.createElement("div");
  fx.root.appendChild(para);
  para.appendChild(fx.text(textValue, fx.doc));
  return para;
}

function renderTaskLi(fx, { status = "?", tags = [], text = "" }) {
  const li = fx.doc.createElement("li");
  li.setAttribute("class", "task-list-item");
  li.setAttribute("data-task", status);
  fx.root.appendChild(li);
  for (const tag of tags) {
    const anchor = fx.doc.createElement("a");
    anchor.setAttribute("class", "tag");
    anchor.textContent = tag;
    anchor.childNodes.push(fx.text(tag, fx.doc));
    li.appendChild(anchor);
    li.appendChild(fx.text(" ", fx.doc));
  }
  const body = fx.text(text, fx.doc);
  li.appendChild(body);
  return { li, body };
}

test("RR1 reading view honors the guard, RO2 rollover skips repeat", () => {
  const plugin = pluginWithToday();
  const open = fakeRenderEl();
  const { body: openBody } = renderTaskLi(open, {
    status: "?",
    tags: ["#task", "#gtd", "#pre"],
    text: "Brush [repeat:: every day]",
  });
  assert.equal(recurrenceMarkRenderedGuard(openBody, open.root), true);
  const done = fakeRenderEl();
  const { body: doneBody } = renderTaskLi(done, {
    status: "?",
    tags: ["#task", "#gtd", "#pre"],
    text: "Brush [repeat:: every day when done]",
  });
  assert.equal(recurrenceMarkRenderedGuard(doneBody, done.root), false);
  // Rendered pass: guarded text keeps its pill, unguarded marks.
  const guardedFx = fakeRenderEl();
  const para = guardedFx.doc.createElement("div");
  guardedFx.root.appendChild(para);
  const li = guardedFx.doc.createElement("li");
  li.setAttribute("class", "task-list-item");
  li.setAttribute("data-task", "?");
  para.appendChild(li);
  const tagAnchor = (value) => {
    const anchor = guardedFx.doc.createElement("a");
    anchor.setAttribute("class", "tag");
    anchor.textContent = value;
    anchor.childNodes.push(guardedFx.text(value, guardedFx.doc));
    return anchor;
  };
  li.appendChild(tagAnchor("#task"));
  li.appendChild(guardedFx.text(" ", guardedFx.doc));
  li.appendChild(tagAnchor("#gtd"));
  li.appendChild(guardedFx.text(" ", guardedFx.doc));
  li.appendChild(tagAnchor("#pre"));
  li.appendChild(guardedFx.text(" ", guardedFx.doc));
  li.appendChild(guardedFx.text("Brush [repeat:: every day]", guardedFx.doc));
  plugin.renderDateMarksIn(guardedFx.root, { sourcePath: "a.md" });
  assert.equal(countMarks(guardedFx.root), 0);
  // Obsidian may invoke the real postprocessor with the task li itself as
  // the root. Root tasks still use their own status and tag membership.
  for (const [status, tags, textValue, expected] of [
    ["?", ["#task", "#gtd", "#pre"], "Brush [repeat:: every day]", 0],
    ["?", ["#task", "#gtd", "#post"], "Brush [repeat:: every day]", 0],
    ["?", ["#task", "#gtd", "#pre"], "Brush [repeat:: every day when done]", 1],
    ["x", ["#task", "#gtd", "#pre"], "Brush [repeat:: every day]", 1],
  ]) {
    const rootFx = fakeRenderEl();
    const { li: rootLi } = renderTaskLi(rootFx, { status, tags, text: textValue });
    plugin.renderDateMarksIn(rootLi, { sourcePath: "a.md" });
    assert.equal(countMarks(rootLi), expected, textValue + " / " + status);
  }
  // A containing wrapper keeps the same guard behavior.
  const nestedFx = fakeRenderEl();
  const nestedPara = nestedFx.doc.createElement("div");
  nestedFx.root.appendChild(nestedPara);
  const nestedLi = nestedFx.doc.createElement("li");
  nestedLi.setAttribute("class", "task-list-item");
  nestedLi.setAttribute("data-task", "?");
  nestedPara.appendChild(nestedLi);
  for (const tag of ["#task", "#gtd", "#post"]) {
    const anchor = nestedFx.doc.createElement("a");
    anchor.setAttribute("class", "tag");
    anchor.textContent = tag;
    anchor.appendChild(nestedFx.text(tag, nestedFx.doc));
    nestedLi.appendChild(anchor);
    nestedLi.appendChild(nestedFx.text(" ", nestedFx.doc));
  }
  nestedLi.appendChild(nestedFx.text("Brush [repeat:: every day]", nestedFx.doc));
  plugin.renderDateMarksIn(nestedFx.root, { sourcePath: "a.md" });
  assert.equal(countMarks(nestedFx.root), 0);
  const plain = fakeRenderEl();
  textPara(plain, "Water plants [repeat:: every day]");
  plugin.renderDateMarksIn(plain.root, { sourcePath: "a.md" });
  assert.equal(countMarks(plain.root), 1);
  // RO2: rollover leaves rendered repeat marks untouched.
  const fx = fakeRenderEl();
  const mark = fx.doc.createElement("span");
  mark.setAttribute("class", "bob-date-mark");
  mark.setAttribute("data-field", "repeat");
  mark.setAttribute("data-rule", "every day");
  mark.setAttribute("data-rendered", "true");
  const savedDocument = global.document;
  global.document = {
    querySelectorAll: (selector) =>
      selector === '.bob-date-mark[data-rendered="true"]' ? [mark] : [],
    createTextNode: (value) => fx.doc.createTextNode(value),
  };
  try {
    assert.equal(plugin.relabelRenderedDateMarks("2026-10-22"), 0);
  } finally {
    if (savedDocument === undefined) {
      delete global.document;
    } else {
      global.document = savedDocument;
    }
  }
});

test("RA1 api.dateMarks stays dates-only and tooltips never contain ::", () => {
  const plugin = pluginWithToday();
  const api = plugin.dateMarksApi();
  assert.deepEqual(Array.from(api.fields), ["created", "scheduled", "completion", "cancelled"]);
  assert.equal(api.model("repeat", "every day"), null);
  const rules = [
    "every day",
    "every day when done",
    "every week on Monday when done",
    "every month on the 1st",
    "every 30 days",
    "every January on the 15th",
    "every April and December on the 1st and 24th",
  ];
  for (const rule of rules) {
    const model = recurrenceMarkModel(rule);
    assert.ok(model, rule);
    assert.ok(model.tooltip.indexOf("::") === -1, model.tooltip);
    assert.ok(model.label.indexOf("::") === -1, model.label);
    assert.ok(model.key.indexOf("::") === -1, model.key);
    assert.ok(model.rule.indexOf("::") === -1, model.rule);
  }
});

test("styles.css contract: repeat glyph, ink, resting, repair flag", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "..", "plugins", "bob-ledger-tools", "styles.css"),
    "utf8",
  );
  const count = (needle) => css.split(needle).length - 1;
  assert.equal(count("--bob-date-glyph-repeat:"), 1);
  assert.ok(css.indexOf('.bob-date-mark[data-field="repeat"]') !== -1);
  assert.ok(css.indexOf('li.task-list-item[data-task="x"] .bob-date-mark[data-field="repeat"]') !== -1);
  assert.ok(css.indexOf('.HyperMD-task-line[data-task="-"] .bob-date-mark[data-field="repeat"]') !== -1);
  assert.equal(count('[data-dv-norm-key="repeat"]'), 1);
  assert.ok(css.indexOf("prefers-reduced-motion") !== -1);
});
