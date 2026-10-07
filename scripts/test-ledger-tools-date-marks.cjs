// Tests for bob-ledger-tools task date marks (bob-cli-53 date-marks).
// Covers the canonical-field parser, the content-start and folding
// rules, the label grammar, the model and tooltip, the element
// builder, the Live Preview decorations, the rendered-view
// post-processor, the midnight rollover, the session toggle, the
// `api.dateMarks` v1 namespace, and the styles.css contract. The
// `docs/date-marks.md` display contract in bob-cli is authoritative;
// DM/DN/RO vectors below are that contract's conformance vectors
// verbatim (today is 2026-10-07, a Wednesday, unless noted).
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
  Module._load = function loadWithDateMarkStubs(request) {
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
  DATE_MARK_FIELDS,
  dateMarkCanonicalFields,
  dateMarkContentStart,
  dateMarkSources,
  dateMarkSourcesInText,
  dateMarkRelativePhrase,
  dateMarkLabel,
  dateMarkModel,
  buildDateMarkElement,
} = helpers;

// Conformance today: 2026-10-07 (Wednesday) unless noted.
const TODAY = "2026-10-07";
const RESCHEDULE = "Ctrl+Shift+P to reschedule";

test("DATE_MARK_FIELDS lists the four dates with verbs", () => {
  assert.ok(Object.isFrozen(DATE_MARK_FIELDS));
  assert.deepEqual(
    DATE_MARK_FIELDS.map((entry) => entry.key),
    ["created", "scheduled", "completion", "cancelled"],
  );
  assert.deepEqual(
    DATE_MARK_FIELDS.map((entry) => entry.verb),
    ["Created", "Scheduled", "Done", "Cancelled"],
  );
  for (const entry of DATE_MARK_FIELDS) {
    assert.ok(Object.isFrozen(entry));
  }
});

test("DM1 created today: label, tooltip, fold, quiet field", () => {
  const line = "- [ ] #task Buy milk [created:: 2026-10-07]";
  const sources = dateMarkSources(line);
  assert.equal(sources.length, 1);
  assert.ok(Object.isFrozen(sources));
  const source = sources[0];
  assert.equal(source.field, "created");
  assert.equal(source.date, TODAY);
  assert.equal(line.slice(source.fieldStart, source.fieldEnd), "[created:: 2026-10-07]");
  assert.equal(source.foldLength, 1);
  const model = dateMarkModel(source.field, source.date, TODAY);
  assert.equal(model.label, "today");
  assert.equal(model.when, "today");
  assert.equal(model.delta, 0);
  assert.equal(model.tooltip, "Created Wed, Oct 7 \u00b7 today");
});

test("DM2 created yesterday without space after the colons", () => {
  const line = "- [ ] #task Call mom [created::2026-10-06] ^call";
  const sources = dateMarkSources(line);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].field, "created");
  assert.equal(line.slice(sources[0].fieldStart, sources[0].fieldEnd), "[created::2026-10-06]");
  const model = dateMarkModel("created", "2026-10-06", TODAY);
  assert.equal(model.label, "yesterday");
  assert.equal(model.when, "past");
  assert.equal(model.tooltip, "Created Tue, Oct 6 \u00b7 yesterday");
});

test("DM3-DM6 scheduled tomorrow, weekday, and month/day labels", () => {
  assert.equal(
    dateMarkModel("scheduled", "2026-10-08", TODAY).tooltip,
    "Scheduled Thu, Oct 8 \u00b7 tomorrow\n" + RESCHEDULE,
  );
  assert.equal(dateMarkModel("scheduled", "2026-10-08", TODAY).label, "tomorrow");
  const dm4 = dateMarkModel("scheduled", "2026-10-09", TODAY);
  assert.equal(dm4.label, "Fri");
  assert.equal(
    dm4.tooltip,
    "Scheduled Fri, Oct 9 \u00b7 in 2 days\n" + RESCHEDULE,
  );
  const dm5 = dateMarkModel("scheduled", "2026-10-13", TODAY);
  assert.equal(dm5.label, "Tue");
  assert.equal(
    dm5.tooltip,
    "Scheduled Tue, Oct 13 \u00b7 in 6 days\n" + RESCHEDULE,
  );
  const dm6 = dateMarkModel("scheduled", "2026-10-14", TODAY);
  assert.equal(dm6.label, "Oct 14");
  assert.equal(
    dm6.tooltip,
    "Scheduled Wed, Oct 14 \u00b7 in 7 days\n" + RESCHEDULE,
  );
});

test("DM7 scheduled today reads with emphasis timing", () => {
  const model = dateMarkModel("scheduled", TODAY, TODAY);
  assert.equal(model.label, "today");
  assert.equal(model.when, "today");
  assert.equal(
    model.tooltip,
    "Scheduled Wed, Oct 7 \u00b7 today\n" + RESCHEDULE,
  );
});

test("DM8 past scheduled uses month/day, never a weekday", () => {
  const model = dateMarkModel("scheduled", "2026-09-04", TODAY);
  assert.equal(model.label, "Sep 4");
  assert.equal(model.when, "past");
  assert.equal(
    model.tooltip,
    "Scheduled Fri, Sep 4 \u00b7 33 days ago\n" + RESCHEDULE,
  );
});

test("DM9 completion on a closed task keeps the timeline grammar", () => {
  const model = dateMarkModel("completion", "2026-10-05", TODAY);
  assert.equal(model.label, "Oct 5");
  assert.equal(
    model.tooltip,
    "Done Mon, Oct 5 \u00b7 2 days ago",
  );
});

test("DM10 cancelled across years appends the year", () => {
  const model = dateMarkModel("cancelled", "2025-12-30", TODAY);
  assert.equal(model.label, "Dec 30, 2025");
  assert.equal(
    model.tooltip,
    "Cancelled Tue, Dec 30, 2025 \u00b7 281 days ago",
  );
});

test("DM11 next-year date appends the year", () => {
  const model = dateMarkModel("scheduled", "2027-01-02", TODAY);
  assert.equal(model.label, "Jan 2, 2027");
  assert.equal(
    model.tooltip,
    "Scheduled Sat, Jan 2, 2027 \u00b7 in 87 days\n" + RESCHEDULE,
  );
});

test("DM12 the weekday rule wins across the year boundary", () => {
  const model = dateMarkModel("scheduled", "2027-01-01", "2026-12-30");
  assert.equal(model.label, "Fri");
  assert.equal(model.delta, 2);
  assert.equal(
    model.tooltip,
    "Scheduled Fri, Jan 1, 2027 \u00b7 in 2 days\n" + RESCHEDULE,
  );
});

test("DM13 two marks in order with folds 1 and 2", () => {
  const line =
    "- [x] #task Review skill [created:: 2026-08-29]  [completion:: 2026-09-03] ^review";
  const sources = dateMarkSources(line);
  assert.equal(sources.length, 2);
  assert.equal(sources[0].field, "created");
  assert.equal(sources[0].foldLength, 1);
  assert.equal(sources[1].field, "completion");
  assert.equal(sources[1].foldLength, 2);
  assert.ok(sources[0].fieldEnd <= sources[1].fieldStart);
  assert.equal(
    dateMarkModel(sources[0].field, sources[0].date, TODAY).label,
    "Aug 29",
  );
  assert.equal(
    dateMarkModel(sources[1].field, sources[1].date, TODAY).label,
    "Sep 3",
  );
});

test("DM14 created and scheduled ranges stay disjoint from the fresh mark", () => {
  const line =
    "- [ ] #task A [fresh:: 2026-10-05] [created::2026-09-29] [scheduled:: 2026-10-09]";
  const sources = dateMarkSources(line);
  assert.equal(sources.length, 2);
  assert.equal(sources[0].field, "created");
  assert.equal(
    dateMarkModel(sources[0].field, sources[0].date, TODAY).label,
    "Sep 29",
  );
  assert.equal(sources[1].field, "scheduled");
  assert.equal(
    dateMarkModel(sources[1].field, sources[1].date, TODAY).label,
    "Fri",
  );
  const freshStart = line.indexOf("[fresh:: 2026-10-05]");
  const freshEnd = freshStart + "[fresh:: 2026-10-05]".length;
  for (const source of sources) {
    assert.ok(source.fieldStart >= freshEnd || source.fieldEnd <= freshStart);
  }
  assert.ok(sources[0].fieldEnd <= sources[1].fieldStart);
});

test("DM15-DM16 paren and padded brackets are canonical", () => {
  const dm15 = dateMarkSources("- [ ] #task B (scheduled:: 2026-10-09)");
  assert.equal(dm15.length, 1);
  assert.equal(
    dateMarkModel(dm15[0].field, dm15[0].date, TODAY).label,
    "Fri",
  );
  const dm16 = dateMarkSources("- [x] #task C [ completion:: 2026-10-07 ]");
  assert.equal(dm16.length, 1);
  assert.equal(
    dateMarkModel(dm16[0].field, dm16[0].date, TODAY).label,
    "today",
  );
});

test("DM17-DM21 line shapes: bullets, quotes, and paragraphs mark", () => {
  const dm17 = dateMarkSources("- Idea for later [created::2026-07-03]");
  assert.equal(dm17.length, 1);
  assert.equal(
    dateMarkModel(dm17[0].field, dm17[0].date, TODAY).label,
    "Jul 3",
  );
  const dm18line = "> - [ ] #task Quoted [created:: 2026-10-01]";
  const dm18 = dateMarkSources(dm18line);
  assert.equal(dm18.length, 1);
  assert.equal(dm18[0].foldLength, 1);
  assert.equal(
    dateMarkModel(dm18[0].field, dm18[0].date, TODAY).label,
    "Oct 1",
  );
  const dm19line = "- [ ] #task D x[created:: 2026-10-01]";
  const dm19 = dateMarkSources(dm19line);
  assert.equal(dm19.length, 1);
  assert.equal(dm19[0].foldLength, 0);
  const dm20line = "- [created:: 2026-10-01] starts the bullet";
  const dm20 = dateMarkSources(dm20line);
  assert.equal(dm20.length, 1);
  assert.equal(dm20[0].foldLength, 0);
  assert.equal(dateMarkContentStart(dm20line), 2);
  const dm21 = dateMarkSources("Paragraph text [scheduled:: 2026-10-09]");
  assert.equal(dm21.length, 1);
  assert.equal(
    dateMarkModel(dm21[0].field, dm21[0].date, TODAY).label,
    "Fri",
  );
});

test("DM22 code still parses pure but decorates nothing (see Live Preview)", () => {
  const line = "- [ ] #task E `[created:: 2026-10-01]`";
  assert.equal(dateMarkSources(line).length, 1);
});

test("DM23 rescheduled is untouched and never a duplicate", () => {
  const line =
    "- [ ] #task G [rescheduled:: 2026-10-09] [scheduled:: 2026-10-10]";
  const sources = dateMarkSources(line);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].field, "scheduled");
  assert.equal(
    line.slice(sources[0].fieldStart, sources[0].fieldEnd),
    "[scheduled:: 2026-10-10]",
  );
  assert.equal(
    dateMarkModel(sources[0].field, sources[0].date, TODAY).label,
    "Sat",
  );
});

test("DN1-DN9 non-canonical fields get no mark", () => {
  assert.deepEqual(dateMarkSources("[scheduled:: 2026-13-01]"), []);
  assert.deepEqual(dateMarkSources("[scheduled:: tomorrow]"), []);
  assert.deepEqual(
    dateMarkSources(
      "- [ ] #task F [scheduled:: 2026-09-10] (scheduled:: 2026-09-11)",
    ),
    [],
  );
  assert.deepEqual(dateMarkSources("[Created:: 2026-10-01]"), []);
  assert.deepEqual(dateMarkSources("[created:: 2026-10-01)"), []);
  assert.deepEqual(dateMarkSources("[created :: 2026-10-01]"), []);
  assert.deepEqual(dateMarkSources("[created:: 2026-10-01T09:30]"), []);
  assert.deepEqual(dateMarkSources("[due:: 2026-10-09]"), []);
  assert.deepEqual(dateMarkSources("[start::1700]"), []);
  // DN9: one broken key never suppresses the others.
  const dn9 = dateMarkSources(
    "- [ ] #task H [scheduled:: 2026-13-01] [created:: 2026-10-01]",
  );
  assert.equal(dn9.length, 1);
  assert.equal(dn9[0].field, "created");
  assert.equal(
    dateMarkModel(dn9[0].field, dn9[0].date, TODAY).label,
    "Oct 1",
  );
});

test("dateMarkContentStart finds content on list, quoted, and plain lines", () => {
  assert.equal(dateMarkContentStart("- [created:: 2026-10-01] x"), 2);
  assert.equal(
    dateMarkContentStart("> - [ ] #task Quoted [created:: 2026-10-01]"),
    8,
  );
  assert.equal(dateMarkContentStart("Paragraph text [scheduled:: x]"), 0);
  assert.equal(dateMarkContentStart(""), 0);
  assert.equal(dateMarkContentStart(null), 0);
});

test("dateMarkRelativePhrase covers the exact-day phrases", () => {
  assert.equal(dateMarkRelativePhrase(0), "today");
  assert.equal(dateMarkRelativePhrase(1), "tomorrow");
  assert.equal(dateMarkRelativePhrase(-1), "yesterday");
  assert.equal(dateMarkRelativePhrase(5), "in 5 days");
  assert.equal(dateMarkRelativePhrase(-33), "33 days ago");
});

test("dateMarkModel rejects unknown fields and bad dates, and falls back on bad today", () => {
  assert.equal(dateMarkModel("due", "2026-10-09", TODAY), null);
  assert.equal(dateMarkModel("created", "2026-13-01", TODAY), null);
  assert.equal(dateMarkModel("created", "tomorrow", TODAY), null);
  assert.equal(dateMarkModel(null, TODAY, TODAY), null);
  assert.equal(dateMarkModel("created", null, TODAY), null);
  const fallback = dateMarkModel("created", TODAY, "not-a-date");
  assert.ok(fallback);
  assert.equal(fallback.date, TODAY);
  assert.equal(dateMarkModel("created", TODAY, null).date, TODAY);
});

test("no model output contains a double colon", () => {
  const dates = [
    TODAY,
    "2026-10-06",
    "2026-10-08",
    "2026-10-09",
    "2026-10-13",
    "2026-10-14",
    "2026-09-04",
    "2026-10-05",
    "2025-12-30",
    "2027-01-02",
  ];
  const todays = [TODAY, "2026-12-30", "not-a-date"];
  for (const field of ["created", "scheduled", "completion", "cancelled"]) {
    for (const date of dates) {
      for (const today of todays) {
        const model = dateMarkModel(field, date, today);
        assert.ok(model, field + " " + date + " " + today);
        assert.ok(model.tooltip.indexOf("::") === -1, model.tooltip);
        assert.ok(model.label.indexOf("::") === -1, model.label);
        assert.ok(model.key.indexOf("::") === -1, model.key);
      }
    }
  }
});

test("a new day always changes the widget key", () => {
  const first = dateMarkModel("scheduled", "2026-10-09", "2026-10-07");
  const second = dateMarkModel("scheduled", "2026-10-09", "2026-10-08");
  assert.ok(first.key);
  assert.ok(second.key);
  assert.notEqual(first.key, second.key);
  assert.equal(first.label, "Fri");
  assert.equal(second.label, "tomorrow");
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

test("element structure and the decorative/inheritColor/rendered options", () => {
  const doc = fakeElementDoc();
  const model = dateMarkModel("scheduled", "2026-10-09", TODAY);
  const span = buildDateMarkElement(doc, model, { foldSpace: true });
  assert.ok(span);
  assert.equal(span.attrs.class, "bob-date-mark");
  assert.equal(span.attrs["data-field"], "scheduled");
  assert.equal(span.attrs["data-date"], "2026-10-09");
  assert.equal(span.attrs["data-when"], "future");
  assert.equal(span.attrs["data-fold-space"], "true");
  assert.equal(span.attrs["data-rendered"], undefined);
  assert.equal(span.attrs.role, "img");
  assert.equal(span.attrs["aria-label"], model.tooltip);
  assert.equal(span.attrs["data-tooltip-position"], "top");
  assert.equal(span.children.length, 2);
  assert.equal(span.children[0].attrs.class, "bob-date-mark-glyph");
  assert.equal(span.children[1].attrs.class, "bob-date-mark-label");
  assert.equal(span.children[1].children[0].text, "Fri");

  const rendered = buildDateMarkElement(doc, model, { rendered: true });
  assert.equal(rendered.attrs["data-fold-space"], "false");
  assert.equal(rendered.attrs["data-rendered"], "true");

  const decorative = buildDateMarkElement(doc, model, {
    decorative: true,
    inheritColor: true,
  });
  assert.equal(decorative.attrs["aria-hidden"], "true");
  assert.equal(decorative.attrs.role, undefined);
  assert.equal(decorative.attrs["aria-label"], undefined);
  assert.equal(decorative.attrs["data-inherit-color"], "true");

  assert.equal(buildDateMarkElement(null, model, {}), null);
  assert.equal(buildDateMarkElement(doc, null, {}), null);
  assert.equal(
    buildDateMarkElement(doc, { ...model, field: "due" }, {}),
    null,
  );
  assert.equal(
    buildDateMarkElement(doc, { ...model, date: "2026-13-01" }, {}),
    null,
  );
  assert.equal(
    buildDateMarkElement(doc, { ...model, label: "" }, {}),
    null,
  );
  assert.equal(
    buildDateMarkElement(doc, { ...model, when: "soon" }, {}),
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

function makeSurfaceApp({ triggers = [], leaves = [] } = {}) {
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
      getCache: () => ({}),
      getFirstLinkpathDest: () => null,
    },
    commands: {},
    plugins: { plugins: {} },
  };
}

function withMissingConfig(run) {
  const saved = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = "/definitely/missing/date-marks-test";
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

function pluginWithToday(today = TODAY) {
  const plugin = new LedgerToolsPlugin(makeSurfaceApp(), {});
  plugin.dateMarksEnabled = true;
  plugin.dateMarksToday = () => today;
  return plugin;
}

test("Live Preview emits several decorations in ascending order", () => {
  const plugin = pluginWithToday();
  const line =
    "- [x] #task Review skill [created:: 2026-08-29]  [completion:: 2026-09-03] ^review";
  const sources = dateMarkSources(line);
  assert.equal(sources.length, 2);
  const decorations = plugin.buildDateMarkDecorations(
    makeView({ lines: [line] }),
  );
  assert.equal(decorations.adds.length, 2);
  assert.equal(
    decorations.adds[0].from,
    sources[0].fieldStart - sources[0].foldLength,
  );
  assert.equal(decorations.adds[0].to, sources[0].fieldEnd);
  assert.equal(
    decorations.adds[1].from,
    sources[1].fieldStart - sources[1].foldLength,
  );
  assert.equal(decorations.adds[1].to, sources[1].fieldEnd);
  assert.ok(decorations.adds[0].to <= decorations.adds[1].from);
  const first = decorations.adds[0].value.widget;
  const rebuilt = plugin.buildDateMarkDecorations(
    makeView({ lines: [line] }),
  );
  assert.equal(first.eq(rebuilt.adds[0].value.widget), true);
  assert.equal(
    first.eq(rebuilt.adds[1].value.widget),
    false,
  );
});

test("Live Preview reveals per field, never the whole line", () => {
  const plugin = pluginWithToday();
  const line =
    "- [x] #task Review skill [created:: 2026-08-29]  [completion:: 2026-09-03] ^review";
  const sources = dateMarkSources(line);
  // A cursor inside `created` reveals only `created`.
  const partial = plugin.buildDateMarkDecorations(
    makeView({
      lines: [line],
      selection: [
        { from: sources[0].fieldStart, to: sources[0].fieldStart },
      ],
    }),
  );
  assert.equal(partial.adds.length, 1);
  assert.equal(
    partial.adds[0].from,
    sources[1].fieldStart - sources[1].foldLength,
  );
  // A cursor inside `completion` reveals only `completion`.
  const other = plugin.buildDateMarkDecorations(
    makeView({
      lines: [line],
      selection: [
        { from: sources[1].fieldEnd, to: sources[1].fieldEnd },
      ],
    }),
  );
  assert.equal(other.adds.length, 1);
  assert.equal(
    other.adds[0].to,
    sources[0].fieldEnd,
  );
});

test("Live Preview refuses source mode, code, and disabled marks", () => {
  const plugin = pluginWithToday();
  const line = "- [ ] #task Buy milk [created:: 2026-10-07]";
  assert.equal(
    plugin.buildDateMarkDecorations(makeView({ lines: [line], live: false })),
    StubDecoration.none,
  );
  assert.equal(
    plugin.buildDateMarkDecorations(
      makeView({ lines: [line], treeTag: "codeblock" }),
    ).adds.length,
    0,
  );
  assert.equal(
    plugin.buildDateMarkDecorations(
      makeView({ lines: [line], treeTag: "inline" }),
    ).adds.length,
    0,
  );
  assert.equal(
    plugin.buildDateMarkDecorations(
      makeView({ lines: ["- [ ] #task F [scheduled:: 2026-13-01]"] }),
    ).adds.length,
    0,
  );
  plugin.dateMarksEnabled = false;
  assert.equal(
    plugin.buildDateMarkDecorations(makeView({ lines: [line] })),
    StubDecoration.none,
  );
  plugin.dateMarksEnabled = true;
  assert.equal(
    plugin.buildDateMarkDecorations(makeView({ lines: [line], path: null })),
    StubDecoration.none,
  );
});

test("widget mousedown anchors at the field start for folds 0, 1, and 2", () => {
  const plugin = pluginWithToday();
  const cases = [
    "- [created:: 2026-10-01] starts the bullet",
    "- [ ] #task Buy milk [created:: 2026-10-07]",
    "- [x] #task Review skill [created:: 2026-08-29]  [completion:: 2026-09-03] ^review",
  ];
  const expected = [0, 1, 1];
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
    createTextNode: (value) => ({ text: String(value) }),
  };
  try {
    cases.forEach((line, index) => {
      const view = makeView({ lines: [line] });
      const decorations = plugin.buildDateMarkDecorations(view);
      assert.ok(decorations.adds.length >= 1, line);
      const widget = decorations.adds[0].value.widget;
      assert.equal(widget.foldLength, expected[index], line);
      const dom = widget.toDOM(view);
      assert.ok(dom);
      let prevented = false;
      handlers.mousedown({ preventDefault: () => (prevented = true) });
      assert.equal(prevented, true);
      const last = view.dispatched[view.dispatched.length - 1];
      assert.equal(last.selection.anchor, 42 + expected[index], line);
      assert.equal(view.focused, true);
    });
    // The double-spaced completion field folds 2.
    const view = makeView({ lines: [cases[2]] });
    const decorations = plugin.buildDateMarkDecorations(view);
    assert.equal(decorations.adds.length, 2);
    assert.equal(decorations.adds[1].value.widget.foldLength, 2);
    const dom = decorations.adds[1].value.widget.toDOM(view);
    assert.ok(dom);
    handlers.mousedown({ preventDefault: () => {} });
    const last = view.dispatched[view.dispatched.length - 1];
    assert.equal(last.selection.anchor, 42 + 2);
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
      get firstChild() {
        return this.childNodes.length > 0 ? this.childNodes[0] : null;
      },
      parentNode: null,
      ownerDocument: null,
      _attrs: {},
      classList: {
        contains: (name) =>
          String(node.className || "")
            .split(/\s+/)
            .includes(name),
      },
      getAttribute: (name) =>
        name === "class"
          ? node.className
          : node._attrs[name] !== undefined
            ? node._attrs[name]
            : null,
      hasAttribute: (name) =>
        name === "class" ||
        (node._attrs[name] !== undefined && node._attrs[name] !== null),
      setAttribute(name, value) {
        node._attrs[name] = String(value);
        if (name === "class") {
          node.className = String(value);
        }
      },
      querySelector: (selector) => {
        const wanted =
          selector === ".bob-date-mark-label"
            ? "bob-date-mark-label"
            : selector === ".bob-date-mark-glyph"
              ? "bob-date-mark-glyph"
              : null;
        if (!wanted) {
          return null;
        }
        const stack = node.childNodes.slice();
        while (stack.length > 0) {
          const candidate = stack.pop();
          if (
            candidate &&
            candidate.nodeType === 1 &&
            String(candidate.className || "")
              .split(/\s+/)
              .includes(wanted)
          ) {
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
      node.className.split(/\s+/).includes("bob-date-mark")
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

function textPara(fx, textValue) {
  const para = fx.doc.createElement("div");
  fx.root.appendChild(para);
  para.appendChild(fx.text(textValue, fx.doc));
  return para;
}

test("rendered views split several fields in one node", () => {
  const plugin = pluginWithToday();
  const fx = fakeRenderEl();
  textPara(
    fx,
    "Review skill [created:: 2026-08-29] done [completion:: 2026-09-03]",
  );
  plugin.renderDateMarksIn(fx.root, { sourcePath: "a.md" });
  assert.equal(countMarks(fx.root), 2);
  assert.ok(collectText(fx.root).indexOf("[created::") === -1);
  assert.ok(collectText(fx.root).indexOf("[completion::") === -1);
  // Idempotent: a second pass keeps two marks.
  plugin.renderDateMarksIn(fx.root, { sourcePath: "a.md" });
  assert.equal(countMarks(fx.root), 2);
  // Non-task lines mark too: paragraphs, quotes, plain bullets.
  const para = fakeRenderEl();
  textPara(para, "Paragraph text [scheduled:: 2026-10-09]");
  plugin.renderDateMarksIn(para.root, { sourcePath: "a.md" });
  assert.equal(countMarks(para.root), 1);
});

test("rendered views skip exclusions and duplicates", () => {
  const plugin = pluginWithToday();
  for (const wrap of ["code", "pre"]) {
    const boxed = fakeRenderEl();
    const box = boxed.doc.createElement(wrap);
    boxed.root.appendChild(box);
    box.appendChild(boxed.text("Buy milk [created:: 2026-10-01]", boxed.doc));
    plugin.renderDateMarksIn(boxed.root, { sourcePath: "a.md" });
    assert.equal(countMarks(boxed.root), 0, wrap);
  }
  for (const cls of ["bob-date-mark", "bob-priority-mark", "bob-fresh-mark"]) {
    const marked = fakeRenderEl();
    const holder = marked.doc.createElement("span");
    holder.className = cls;
    marked.root.appendChild(holder);
    holder.appendChild(
      marked.text("Buy milk [created:: 2026-10-01]", marked.doc),
    );
    const before = countMarks(marked.root);
    plugin.renderDateMarksIn(marked.root, { sourcePath: "a.md" });
    assert.equal(countMarks(marked.root), before, cls);
  }
  const pill = fakeRenderEl();
  const pillEl = pill.doc.createElement("span");
  pillEl.className = "dataview inline-field";
  pill.root.appendChild(pillEl);
  pillEl.appendChild(pill.text("Buy milk [created:: 2026-10-01]", pill.doc));
  plugin.renderDateMarksIn(pill.root, { sourcePath: "a.md" });
  assert.equal(countMarks(pill.root), 0);
  // Duplicates in one node get no mark on either (DN3).
  const dup = fakeRenderEl();
  textPara(
    dup,
    "- [ ] #task F [scheduled:: 2026-09-10] (scheduled:: 2026-09-11)",
  );
  plugin.renderDateMarksIn(dup.root, { sourcePath: "a.md" });
  assert.equal(countMarks(dup.root), 0);
  // Broken dates get no mark (DN1).
  const bad = fakeRenderEl();
  textPara(bad, "When [scheduled:: 2026-13-01] lands");
  plugin.renderDateMarksIn(bad.root, { sourcePath: "a.md" });
  assert.equal(countMarks(bad.root), 0);
  // Disabled marks render nothing.
  const off = fakeRenderEl();
  textPara(off, "Buy milk [created:: 2026-10-01]");
  plugin.dateMarksEnabled = false;
  plugin.renderDateMarksIn(off.root, { sourcePath: "a.md" });
  assert.equal(countMarks(off.root), 0);
});

function fakeRenderedMark(fx, { field, date, when, label, rendered = true }) {
  const mark = fx.doc.createElement("span");
  mark.setAttribute("class", "bob-date-mark");
  mark.setAttribute("data-field", field);
  mark.setAttribute("data-date", date);
  mark.setAttribute("data-when", when);
  if (rendered) {
    mark.setAttribute("data-rendered", "true");
  }
  mark._rendered = rendered;
  const glyph = fx.doc.createElement("span");
  glyph.setAttribute("class", "bob-date-mark-glyph");
  const labelEl = fx.doc.createElement("span");
  labelEl.setAttribute("class", "bob-date-mark-label");
  labelEl.appendChild(fx.doc.createTextNode(label));
  mark.appendChild(glyph);
  mark.appendChild(labelEl);
  mark.ownerDocument = fx.doc;
  return mark;
}

function labelText(mark) {
  const labelEl = mark.querySelector(".bob-date-mark-label");
  return (labelEl.childNodes || [])
    .map((child) => child.nodeValue || child.text || "")
    .join("");
}

test("RO1 rendered marks relabel in place across midnight", () => {
  const fx = fakeRenderEl();
  const mark = fakeRenderedMark(fx, {
    field: "scheduled",
    date: "2026-10-09",
    when: "future",
    label: "Fri",
  });
  const badMark = fakeRenderedMark(fx, {
    field: "due",
    date: "2026-10-09",
    when: "future",
    label: "?",
  });
  const savedDocument = global.document;
  global.document = {
    querySelectorAll: (selector) =>
      selector === '.bob-date-mark[data-rendered="true"]'
        ? [mark, badMark]
        : [],
    createTextNode: (value) => fx.doc.createTextNode(value),
  };
  try {
    const plugin = pluginWithToday("2026-10-08");
    // The unknown field is skipped; the real mark relabels.
    assert.equal(plugin.relabelRenderedDateMarks("2026-10-08"), 1);
    assert.equal(labelText(mark), "tomorrow");
    assert.equal(mark.getAttribute("data-when"), "future");
    assert.equal(
      mark.getAttribute("aria-label"),
      "Scheduled Fri, Oct 9 \u00b7 tomorrow\n" + RESCHEDULE,
    );
    assert.equal(plugin.relabelRenderedDateMarks("2026-10-09"), 1);
    assert.equal(labelText(mark), "today");
    assert.equal(mark.getAttribute("data-when"), "today");
    assert.equal(
      mark.getAttribute("aria-label"),
      "Scheduled Fri, Oct 9 \u00b7 today\n" + RESCHEDULE,
    );
    assert.equal(labelText(badMark), "?");
  } finally {
    if (savedDocument === undefined) {
      delete global.document;
    } else {
      global.document = savedDocument;
    }
  }
});

test("rollover dispatches once per day change and never touches widgets", () => {
  const dispatched = [];
  const leaves = [
    {
      view: {
        editor: {
          cm: {
            dispatch: (tr) => dispatched.push(tr),
          },
        },
      },
    },
  ];
  const fx = fakeRenderEl();
  const widgetMark = fakeRenderedMark(fx, {
    field: "scheduled",
    date: "2026-10-09",
    when: "future",
    label: "Fri",
    rendered: false,
  });
  const savedDocument = global.document;
  global.document = {
    querySelectorAll: (selector) =>
      selector === '.bob-date-mark[data-rendered="true"]' ? [] : [],
    createTextNode: (value) => fx.doc.createTextNode(value),
  };
  try {
    const plugin = new LedgerToolsPlugin(
      makeSurfaceApp({ leaves }),
      {},
    );
    plugin.dateMarksEnabled = true;
    // First check initializes the day without dispatching.
    assert.equal(
      plugin.refreshDateMarksForRollover(new Date(2026, 9, 7, 12)),
      false,
    );
    assert.equal(plugin.dateMarksDay, "2026-10-07");
    assert.equal(dispatched.length, 0);
    // Same day: nothing happens.
    assert.equal(
      plugin.refreshDateMarksForRollover(new Date(2026, 9, 7, 23, 59)),
      false,
    );
    assert.equal(dispatched.length, 0);
    // Day change: one refresh dispatch across every editor.
    assert.equal(
      plugin.refreshDateMarksForRollover(new Date(2026, 9, 8, 0, 1)),
      true,
    );
    assert.equal(plugin.dateMarksDay, "2026-10-08");
    assert.equal(dispatched.length, 1);
    // Live Preview widget DOM (no data-rendered) is never relabeled.
    assert.equal(labelText(widgetMark), "Fri");
    assert.equal(widgetMark.getAttribute("data-when"), "future");
  } finally {
    if (savedDocument === undefined) {
      delete global.document;
    } else {
      global.document = savedDocument;
    }
  }
});

test("api.dateMarks v1 is additive, sync, and never throwing", () => {
  const plugin = pluginWithToday();
  const api = plugin.dateMarksApi();
  assert.ok(api);
  assert.equal(api.version, 1);
  assert.ok(Object.isFrozen(api));
  assert.deepEqual(Array.from(api.fields), [
    "created",
    "scheduled",
    "completion",
    "cancelled",
  ]);
  assert.ok(Object.isFrozen(api.fields));
  const model = api.model("scheduled", "2026-10-09");
  assert.ok(model);
  assert.equal(model.field, "scheduled");
  assert.equal(model.date, "2026-10-09");
  assert.equal(api.model("due", "2026-10-09"), null);
  assert.equal(api.model("created", "2026-13-01"), null);
  assert.equal(api.model(null, null), null);

  const fx = fakeRenderEl();
  const host = fx.doc.createElement("div");
  host.ownerDocument = fx.doc;
  const el = api.render(host, "created", "2026-10-07", {
    decorative: true,
    inheritColor: true,
  });
  assert.ok(el);
  assert.equal(host.childNodes.length, 1);
  assert.equal(el.getAttribute("aria-hidden"), "true");
  assert.equal(el.getAttribute("data-inherit-color"), "true");
  assert.equal(api.render(host, "due", "2026-10-09", {}), null);
  assert.equal(api.render(host, "created", "bogus", {}), null);
  assert.equal(api.render(null, "created", "2026-10-07", {}), null);
  assert.equal(api.render({}, "created", "2026-10-07", {}), null);
  const throwing = {
    appendChild() {
      throw new Error("nope");
    },
  };
  assert.equal(api.render(throwing, "created", "2026-10-07", {}), null);
  // A throwing clock degrades to the real-today fallback, never an
  // exception: the label grammar always has a today.
  const broken = pluginWithToday();
  broken.dateMarksToday = () => {
    throw new Error("nope");
  };
  const degraded = broken.dateMarksApi().model("created", "2026-10-07");
  assert.ok(degraded);
  assert.equal(degraded.date, "2026-10-07");
  assert.ok(broken.dateMarksApi().render(host, "created", "2026-10-07", {}));
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
      assert.equal(plugin.dateMarksEnabled, true);
      assert.equal(plugin.dateMarksDay, null);
      assert.ok(classes.has("bob-date-marks"));
      const toggle = (plugin.commands || []).find(
        (command) => command.id === "toggle-date-marks",
      );
      assert.ok(toggle);
      assert.equal(toggle.name, "Toggle task date marks");
      assert.ok(
        (plugin.editorExtensions || []).length >= 4,
        "tab keymap plus the fresh, priority, and date mark extensions",
      );
      assert.ok(capturedMarkClass);
      const posts = (plugin.postProcessors || []).filter(
        (entry) => entry.sortOrder === 50,
      );
      assert.ok(posts.length >= 3);
      assert.ok(plugin.api.dateMarks);
      assert.equal(plugin.api.dateMarks.version, 1);
      assert.equal(plugin.api.version, 3);
      assert.equal(plugin.toggleDateMarks(), false);
      assert.equal(classes.has("bob-date-marks"), false);
      assert.equal(plugin.toggleDateMarks(), true);
      assert.equal(classes.has("bob-date-marks"), true);
      assert.ok(
        TestNotice.messages.indexOf("Date marks off") !== -1,
        JSON.stringify(TestNotice.messages),
      );
      assert.ok(
        TestNotice.messages.indexOf("Date marks on") !== -1,
        JSON.stringify(TestNotice.messages),
      );
      assert.ok(
        triggers.indexOf(
          "obsidian-tasks-plugin:reload-open-search-results",
        ) !== -1,
      );
      // While off, the builders stay silent.
      plugin.dateMarksEnabled = false;
      assert.equal(
        plugin.buildDateMarkDecorations(
          makeView({ lines: ["- [ ] #task A [created:: 2026-10-07]"] }),
        ),
        StubDecoration.none,
      );
      const fx = fakeRenderEl();
      textPara(fx, "Buy milk [created:: 2026-10-07]");
      plugin.renderDateMarksIn(fx.root, { sourcePath: "a.md" });
      assert.equal(countMarks(fx.root), 0);
    } finally {
      plugin.onunload();
    }
    assert.equal(classes.has("bob-date-marks"), false);
  } finally {
    if (savedDocument === undefined) {
      delete global.document;
    } else {
      global.document = savedDocument;
    }
  }
});

test("styles.css contract: masks, tones, repair flag, resting", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "..", "plugins", "bob-ledger-tools", "styles.css"),
    "utf8",
  );
  const count = (needle) => css.split(needle).length - 1;
  // Each mask variable is defined exactly once.
  for (const name of [
    "--bob-date-glyph-created",
    "--bob-date-glyph-scheduled",
    "--bob-date-glyph-completion",
    "--bob-date-glyph-cancelled",
  ]) {
    assert.equal(count(name + ":"), 1, name);
  }
  // Each field has a glyph rule.
  for (const field of ["created", "scheduled", "completion", "cancelled"]) {
    assert.ok(
      css.indexOf('.bob-date-mark[data-field="' + field + '"]') !== -1,
      "plugin host: " + field,
    );
  }
  // Quiet, emphasis, and resting tones exist.
  assert.ok(
    css.indexOf('.bob-date-mark[data-field="scheduled"][data-when="past"]') !==
      -1,
  );
  assert.ok(
    css.indexOf('.bob-date-mark[data-field="scheduled"][data-when="today"]') !==
      -1,
  );
  assert.ok(
    css.indexOf('li.task-list-item[data-task="x"] .bob-date-mark') !== -1,
  );
  assert.ok(
    css.indexOf('li.task-list-item[data-task="X"] .bob-date-mark') !== -1,
  );
  assert.ok(
    css.indexOf('li.task-list-item[data-task="-"] .bob-date-mark') !== -1,
  );
  // The Live Preview repair flag names exactly the four keys.
  assert.ok(
    css.indexOf("body.bob-date-marks .markdown-source-view.is-live-preview") !==
      -1,
  );
  for (const field of ["created", "scheduled", "completion", "cancelled"]) {
    assert.equal(count('[data-dv-norm-key="' + field + '"]'), 1, field);
  }
  assert.equal(count('[data-dv-norm-key="due"]'), 0);
  assert.equal(count('[data-dv-norm-key="start"]'), 0);
  assert.ok(css.indexOf("prefers-reduced-motion") !== -1);
});
