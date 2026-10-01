// Per-note Ready cap views (ledger-views): live `renderCrowdedChip`,
// the `bob-ready-notes` ranked-bar block, and the `## Tasks` heading
// chip (Live Preview widget plus Reading view), with the theme-safe
// CSS, the bob-cli-3d anchor-class fix, and one consolidated
// live-refresh fan-out.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

class TestMarkdownView {}

class TestPlugin {
  constructor(app) {
    this.app = app;
  }

  addCommand() {}

  registerEditorExtension(extension) {
    this.editorExtensions = this.editorExtensions || [];
    this.editorExtensions.push(extension);
  }

  registerEvent(ref) {
    this.registeredEvents = this.registeredEvents || [];
    this.registeredEvents.push(ref);
  }

  registerMarkdownCodeBlockProcessor(language, handler) {
    this.codeBlocks = this.codeBlocks || {};
    this.codeBlocks[language] = handler;
  }

  registerMarkdownPostProcessor(handler) {
    this.postProcessors = this.postProcessors || [];
    this.postProcessors.push(handler);
  }

  registerInterval(handle) {
    this.intervals = this.intervals || [];
    this.intervals.push(handle);
    return handle;
  }
}

class TestNotice {}
TestNotice.messages = [];

// Test stubs gain `Decoration.widget` (the ledger-views heading chip
// needs it; no earlier suite stubbed it).
class StubWidgetType {
  eq(other) {
    return this === other;
  }
}

const widgetCalls = [];
const StubDecoration = {
  none: { none: true },
  widget: (args) => {
    widgetCalls.push(args);
    return { widget: args.widget, side: args.side };
  },
};

const effectObjects = [];
const StubStateEffect = {
  define: () => {
    const effect = {
      of: (value) => ({ effect, value }),
      is: (other) => other === effect,
    };
    effectObjects.push(effect);
    return effect;
  },
};

class StubRangeSetBuilder {
  constructor() {
    this.ranges = [];
  }

  add(from, to, decoration) {
    this.ranges.push([from, to, decoration]);
  }

  finish() {
    return this.ranges;
  }
}

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: TestMarkdownView,
      MarkdownRenderChild: class {},
      Notice: TestNotice,
      Platform: { isDesktopApp: true },
      Plugin: TestPlugin,
      normalizePath: (value) => value,
      parseYaml: (text) => JSON.parse(text),
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
      ViewPlugin: {
        fromClass: (cls, options) => ({ cls, options }),
      },
      Decoration: StubDecoration,
      WidgetType: StubWidgetType,
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers } = LedgerToolsPlugin;
Module._load = originalLoad;

const {
  noteReadyBarModel,
  noteReadyCrowdedChipModel,
  noteReadyFindTasksHeadingLine,
  noteReadyHeadingChipModel,
  noteReadyReadyNotesSummary,
  setReadyAnchorContent,
} = helpers;

assert.ok(
  StubDecoration &&
    typeof StubDecoration.widget === "function",
  "test stubs provide Decoration.widget",
);

// --- Stub DOM ------------------------------------------------------

function stubSpan(options = {}, parent = null) {
  const span = {
    tag: "span",
    cls: options.cls,
    text: options.text,
    title: options.title,
    href: options.href,
    attrs: { class: options.cls || "" },
    listeners: [],
    handlers: {},
    children: [],
    parentNode: parent,
    setAttribute: (name, value) => {
      span.attrs[name] = value;
    },
    hasAttribute: () => false,
    setText: (value) => {
      span.text = String(value);
    },
    addEventListener: (name, handler) => {
      span.listeners.push(name);
      span.handlers[name] = span.handlers[name] || [];
      span.handlers[name].push(handler);
    },
    remove: () => {
      if (parent && Array.isArray(parent.children)) {
        const at = parent.children.indexOf(span);
        if (at !== -1) {
          parent.children.splice(at, 1);
        }
      }
    },
  };
  return span;
}

function stubAnchor(options = {}) {
  const anchor = {
    tag: "a",
    cls: options.cls,
    text: options.text,
    title: options.title,
    href: options.href,
    attrs: { class: options.cls || "" },
    listeners: [],
    handlers: {},
    children: [],
    parentNode: null,
    isConnected: true,
    createEl: (tag, childOptions = {}) => {
      const span = stubSpan(childOptions, anchor);
      if (childOptions.cls) {
        span.attrs.class = childOptions.cls;
      }
      anchor.children.push(span);
      return span;
    },
    createSpan: (childOptions = {}) => {
      const span = stubSpan(childOptions, anchor);
      if (childOptions.cls) {
        span.attrs.class = childOptions.cls;
      }
      anchor.children.push(span);
      return span;
    },
    querySelector: (selector) => {
      const cls = String(selector).replace(/^\./, "");
      return (
        anchor.children.find((child) =>
          String(child.attrs.class || child.cls || "")
            .split(/\s+/)
            .includes(cls),
        ) || null
      );
    },
    setAttribute: (name, value) => {
      anchor.attrs[name] = value;
    },
    hasAttribute: () => false,
    setText: (value) => {
      anchor.text = String(value);
    },
    addEventListener: (name, handler) => {
      anchor.listeners.push(name);
      anchor.handlers[name] = anchor.handlers[name] || [];
      anchor.handlers[name].push(handler);
    },
    removeChild: (child) => {
      const at = anchor.children.indexOf(child);
      if (at !== -1) {
        anchor.children.splice(at, 1);
      }
    },
    remove: () => {
      if (anchor.parentNode && Array.isArray(anchor.parentNode.children)) {
        const at = anchor.parentNode.children.indexOf(anchor);
        if (at !== -1) {
          anchor.parentNode.children.splice(at, 1);
        }
      }
    },
  };
  return anchor;
}

function stubHost() {
  const el = {
    attrs: {},
    children: [],
    createEl: (tag, options = {}) => {
      const child = stubAnchor(options);
      child.parentNode = el;
      el.children.push(child);
      return child;
    },
    createDiv: (options = {}) => {
      const child = stubDiv(options);
      child.parentNode = el;
      el.children.push(child);
      return child;
    },
    setAttribute: () => {},
    contains: (node) => node && node.parentNode === el,
  };
  return el;
}

function stubDiv(options = {}) {
  const div = {
    tag: "div",
    cls: options.cls,
    text: options.text,
    attrs: { class: options.cls || "" },
    listeners: [],
    handlers: {},
    children: [],
    parentNode: null,
    isConnected: true,
    emptied: false,
    empty: () => {
      div.emptied = true;
      div.children = [];
    },
    createEl: (tag, childOptions = {}) => {
      const child = stubAnchor(childOptions);
      child.parentNode = div;
      div.children.push(child);
      return child;
    },
    createSpan: (childOptions = {}) => {
      const child = stubSpan(childOptions, div);
      child.parentNode = div;
      div.children.push(child);
      return child;
    },
    createDiv: (childOptions = {}) => {
      const child = stubDiv(childOptions);
      child.parentNode = div;
      div.children.push(child);
      return child;
    },
    setAttribute: (name, value) => {
      div.attrs[name] = value;
    },
    hasAttribute: () => false,
    addEventListener: (name, handler) => {
      div.listeners.push(name);
    },
    querySelectorAll: () => [],
  };
  return div;
}

function makeSnapshot(overrides = {}) {
  return {
    available: true,
    date: "2026-10-01",
    cap: { default: 5, source: "default", invalid: false },
    totals: {
      notes: 3,
      areas: 1,
      projects: 2,
      crowded: 1,
      full: 1,
      room: 1,
      empty: 0,
      exempt: 0,
      counted: 20,
      excess: 6,
      recurring: 0,
    },
    notes: [
      {
        path: "sase.md",
        name: "sase",
        kind: "project",
        status: null,
        parent: "dev",
        count: 11,
        cap: 5,
        cap_source: "default",
        state: "crowded",
        over_by: 6,
        make_up: { ready: 9, new: 1, rotten: 1 },
        recurring: 0,
      },
      {
        path: "bob.md",
        name: "bob",
        kind: "project",
        status: null,
        parent: "gtd",
        count: 5,
        cap: 5,
        cap_source: "default",
        state: "full",
        over_by: 0,
        make_up: { ready: 5, new: 0, rotten: 0 },
        recurring: 0,
      },
      {
        path: "dev.md",
        name: "dev",
        kind: "area",
        status: null,
        parent: null,
        count: 4,
        cap: 5,
        cap_source: "default",
        state: "room",
        over_by: 0,
        make_up: { ready: 4, new: 0, rotten: 0 },
        recurring: 0,
      },
    ],
    lints: [],
    ...overrides,
  };
}

function makePlugin(snapshot) {
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.app = { workspace: {} };
  plugin.crowdedWidgets = new Set();
  plugin.readyNotesViews = new Set();
  plugin.noteReadyReadingWidgets = new Set();
  plugin.noteReadyEnsureSnapshot = () => snapshot;
  plugin.apiNoteReadyForNote = (path) => {
    const found = (snapshot.notes || []).find(
      (entry) => entry && entry.path === path,
    );
    return found || null;
  };
  return plugin;
}

// --- CROWDED chip model --------------------------------------------

test("crowded chip: over count is red with tooltip, aria, and names", () => {
  const model = noteReadyCrowdedChipModel(makeSnapshot());
  assert.equal(model.available, true);
  assert.equal(model.valueText, "1");
  assert.equal(model.over, true);
  assert.equal(model.placeholder, false);
  assert.match(model.tooltip, /1 note over their ready cap/);
  assert.match(model.tooltip, /sase 11\/5/);
  assert.match(model.tooltip, /Open Crowded Notes/);
  assert.equal(model.aria, model.tooltip);
});

test("crowded chip: calm zero and unavailable dash", () => {
  const zero = noteReadyCrowdedChipModel(
    makeSnapshot({
      totals: {
        notes: 2,
        areas: 1,
        projects: 1,
        crowded: 0,
        full: 1,
        room: 1,
        empty: 0,
        exempt: 0,
        counted: 9,
        excess: 0,
        recurring: 0,
      },
      notes: [],
    }),
  );
  assert.equal(zero.valueText, "0 ✓");
  assert.equal(zero.calm, true);
  assert.equal(zero.over, false);
  const missing = noteReadyCrowdedChipModel({ available: false });
  assert.equal(missing.valueText, "–");
  assert.equal(missing.placeholder, true);
});

test("crowded chip: names at most five notes", () => {
  const notes = Array.from({ length: 7 }, (_, index) => ({
    path: `n${index}.md`,
    name: `n${index}`,
    kind: "project",
    status: null,
    parent: null,
    count: 10 + index,
    cap: 5,
    cap_source: "default",
    state: "crowded",
    over_by: 5 + index,
    make_up: null,
    recurring: 0,
  }));
  const model = noteReadyCrowdedChipModel(
    makeSnapshot({
      totals: {
        notes: 7,
        areas: 0,
        projects: 7,
        crowded: 7,
        full: 0,
        room: 0,
        empty: 0,
        exempt: 0,
        counted: 100,
        excess: 50,
        recurring: 0,
      },
      notes,
    }),
  );
  assert.equal(model.valueText, "7");
  assert.match(model.tooltip, /…/);
  assert.doesNotMatch(model.tooltip, /n6 /);
});

// --- CROWDED chip render -------------------------------------------

test("crowded chip: classes, text, aria, and arrow", () => {
  const plugin = makePlugin(makeSnapshot());
  const host = stubHost();
  const anchor = plugin.renderCrowdedChip(host, { sourcePath: "dash.md" });
  assert.ok(anchor);
  assert.match(anchor.attrs.class, /bob-plan-chip/);
  assert.match(anchor.attrs.class, /bob-plan-crowded/);
  assert.match(anchor.attrs.class, /bob-plan-over/);
  assert.match(anchor.attrs["aria-label"], /sase 11\/5/);
  const texts = anchor.children.map((child) => child.text);
  assert.ok(texts.includes("CROWDED"));
  assert.ok(texts.includes("1"));
  assert.ok(texts.includes("↗"));
  const arrow = anchor.children.find(
    (child) => String(child.attrs.class).indexOf("bob-plan-crowded-arrow") !== -1,
  );
  assert.ok(arrow);
  assert.equal(arrow.attrs["aria-hidden"], "true");
  assert.ok(anchor.listeners.includes("click"));
  assert.ok(anchor.listeners.includes("keydown"));
  assert.ok(anchor.listeners.includes("mouseover"));
});

test("crowded chip: refresh in place keeps the anchor, unload drops it", () => {
  const first = makeSnapshot();
  const plugin = makePlugin(first);
  const host = stubHost();
  const anchor = plugin.renderCrowdedChip(host, { sourcePath: "dash.md" });
  assert.equal(plugin.crowdedWidgets.size, 1);
  const calm = makeSnapshot({
    totals: {
      notes: 2,
      areas: 1,
      projects: 1,
      crowded: 0,
      full: 1,
      room: 1,
      empty: 0,
      exempt: 0,
      counted: 9,
      excess: 0,
      recurring: 0,
    },
    notes: [],
  });
  plugin.noteReadyEnsureSnapshot = () => calm;
  assert.equal(plugin.refreshCrowdedChips(new Date()), true);
  assert.match(anchor.attrs.class, /bob-plan-crowded/);
  assert.doesNotMatch(anchor.attrs.class, /bob-plan-over/);
  const value = anchor.children.find(
    (child) => String(child.attrs.class).indexOf("bob-plan-ready-value") !== -1,
  );
  assert.equal(value.text, "0 ✓");
  // Unload via component.register cleanup.
  const host2 = stubHost();
  let release = null;
  const component = {
    register: (fn) => {
      release = fn;
    },
  };
  plugin.renderCrowdedChip(host2, {
    sourcePath: "dash.md",
    component,
  });
  assert.equal(plugin.crowdedWidgets.size, 2);
  release();
  assert.equal(plugin.crowdedWidgets.size, 1);
});

// --- bob-cli-3d anchor-class fix ------------------------------------

test("anchor helper keeps READY, PENDING, NEXT, and CROWDED classes", () => {
  for (const kind of ["ready", "pending", "next", "crowded"]) {
    const host = stubHost();
    const anchor = host.createEl("a", { cls: `bob-plan-chip bob-plan-${kind}` });
    setReadyAnchorContent(
      anchor,
      { count: 3, cap: 5, over: false, tooltip: "t", aria: "a" },
      { kind, label: kind.toUpperCase() },
    );
    assert.match(
      anchor.attrs.class,
      new RegExp(`bob-plan-${kind}`),
      `expected bob-plan-${kind}`,
    );
    // Refresh again: the class survives repeated updates.
    setReadyAnchorContent(
      anchor,
      { count: 4, cap: 5, over: false, tooltip: "t", aria: "a" },
      { kind, label: kind.toUpperCase() },
    );
    assert.match(anchor.attrs.class, new RegExp(`bob-plan-${kind}`));
  }
});

// --- bob-ready-notes block ------------------------------------------

test("ready-notes summary: crowded, calm, and unavailable", () => {
  assert.equal(
    noteReadyReadyNotesSummary(makeSnapshot()),
    "CROWDED 1 · 6 over · 1 full · 3 notes",
  );
  assert.equal(
    noteReadyReadyNotesSummary(
      makeSnapshot({
        totals: {
          notes: 2,
          areas: 1,
          projects: 1,
          crowded: 0,
          full: 1,
          room: 1,
          empty: 0,
          exempt: 0,
          counted: 9,
          excess: 0,
          recurring: 0,
        },
        notes: [],
      }),
    ),
    "CROWDED 0 ✓ · every note has room",
  );
  assert.equal(noteReadyReadyNotesSummary({ available: false }), "CROWDED –");
});

test("ready-notes bar: cap tick and red overflow within 30 cells", () => {
  const bar = noteReadyBarModel(11, 5);
  assert.ok(bar.total <= 30);
  assert.equal(bar.capAt, 5);
  assert.equal(bar.overflow, 6);
  assert.equal(bar.over, true);
  const room = noteReadyBarModel(3, 5);
  assert.equal(room.over, false);
  assert.equal(room.overflow, 0);
  const huge = noteReadyBarModel(61, 5);
  assert.equal(huge.total, 30);
  assert.equal(huge.overflow, 56);
});

test("ready-notes block: model and render with grid, pills, and footer", () => {
  const plugin = makePlugin(makeSnapshot());
  const el = stubDiv({});
  plugin.renderReadyNotesBlock(el, { sourcePath: "crowded.md" });
  assert.equal(plugin.readyNotesViews.size, 1);
  assert.equal(el.emptied, true);
  const container = el.children[0];
  assert.match(container.attrs.class, /bob-ready-notes/);
  const summary = container.children.find(
    (child) => String(child.attrs.class).indexOf("bob-ready-notes-summary") !== -1,
  );
  assert.match(summary.text, /CROWDED 1/);
  const rows = container.children.filter(
    (child) => String(child.attrs.class).indexOf("bob-ready-notes-row") !== -1,
  );
  // CROWDED + FULL rows render as a CSS grid.
  assert.equal(rows.length, 2);
  const overRow = rows.find(
    (row) => String(row.attrs.class).indexOf("is-over") !== -1,
  );
  assert.ok(overRow);
  const pill = overRow.children.find(
    (child) => String(child.attrs.class).indexOf("bob-ready-over-pill") !== -1,
  );
  assert.equal(pill.text, "+6");
  const roomWrap = container.children.find(
    (child) => String(child.attrs.class).indexOf("bob-ready-notes-room") !== -1,
  );
  assert.ok(roomWrap);
  const footer = container.children.find(
    (child) => String(child.attrs.class).indexOf("bob-ready-notes-footer") !== -1,
  );
  assert.match(footer.text, /splitting.*sequencing.*deferring.*dropping/);
});

test("ready-notes block: unavailable renders a dash line", () => {
  const plugin = makePlugin({ available: false });
  const el = stubDiv({});
  plugin.renderReadyNotesBlock(el, { sourcePath: "crowded.md" });
  const container = el.children[0];
  const summary = container.children.find(
    (child) => String(child.attrs.class).indexOf("bob-ready-notes-summary") !== -1,
  );
  assert.equal(summary.text, "CROWDED –");
});

// --- Tasks heading chip ----------------------------------------------

test("heading matcher: fences, level, case, and first-only", () => {
  assert.equal(noteReadyFindTasksHeadingLine("# Title\n## Tasks\n- [ ] a"), 1);
  assert.equal(noteReadyFindTasksHeadingLine("## tasks"), 0);
  assert.equal(noteReadyFindTasksHeadingLine("   ## Tasks extra"), 0);
  assert.equal(noteReadyFindTasksHeadingLine("### Tasks"), -1);
  assert.equal(
    noteReadyFindTasksHeadingLine("```\n## Tasks\n```\n## Tasks"),
    3,
  );
  assert.equal(
    noteReadyFindTasksHeadingLine("## Tasks\n## Tasks second"),
    0,
  );
  assert.equal(noteReadyFindTasksHeadingLine("# No headings here"), -1);
});

test("heading chip copy: room, full, crowded, exempt, unavailable", () => {
  const room = noteReadyHeadingChipModel(makeSnapshot().notes[2]);
  assert.equal(room.text, "ready 4/5");
  assert.match(room.tooltip, /4 ready-lane tasks = 4 ready \+ 0 new \+ 0 rotten/);
  assert.match(room.tooltip, /cap 5 \(default\)/);
  assert.match(room.tooltip, /split, sequence, defer, or drop/);
  const full = noteReadyHeadingChipModel(makeSnapshot().notes[1]);
  assert.equal(full.text, "ready 5/5 · full");
  const crowded = noteReadyHeadingChipModel(makeSnapshot().notes[0]);
  assert.equal(crowded.text, "ready 11/5 · +6");
  assert.equal(crowded.over, true);
  assert.match(crowded.tooltip, /6 over/);
  const exempt = noteReadyHeadingChipModel({
    path: "inbox.md",
    name: "inbox",
    kind: "area",
    status: null,
    parent: null,
    count: 65,
    cap: null,
    cap_source: "default",
    state: "exempt",
    over_by: 0,
    make_up: null,
    recurring: 0,
  });
  assert.equal(exempt.text, "ready 65 · no cap");
  const missing = noteReadyHeadingChipModel(null);
  assert.equal(missing.text, "ready –");
  assert.equal(missing.placeholder, true);
});

test("heading chip key is stable for equal models", () => {
  const entry = makeSnapshot().notes[0];
  const first = noteReadyHeadingChipModel(entry);
  const second = noteReadyHeadingChipModel({ ...entry });
  assert.equal(first.key, second.key);
  const other = noteReadyHeadingChipModel(makeSnapshot().notes[1]);
  assert.notEqual(first.key, other.key);
});

test("reading view: appends the chip to the matching h2 only", () => {
  const plugin = makePlugin(makeSnapshot());
  const chipHolder = [];
  const h2 = (text) => ({
    tagName: "H2",
    textContent: text,
    children: [],
    createEl: (tag, options = {}) => {
      const child = stubAnchor(options);
      child.parentNode = h2node;
      h2node.children.push(child);
      chipHolder.push(child);
      return child;
    },
  });
  const h2node = h2("Tasks");
  const other = h2("Pomodoros");
  const el = {
    querySelectorAll: (selector) => (selector === "h2" ? [other, h2node] : []),
  };
  const added = [];
  const ctx = {
    sourcePath: "sase.md",
    addChild: (child) => added.push(child),
  };
  plugin.renderNoteReadyHeadingInReading(el, ctx);
  assert.equal(chipHolder.length, 1);
  assert.match(chipHolder[0].attrs.class, /bob-note-ready-heading/);
  assert.equal(plugin.noteReadyReadingWidgets.size, 1);
  // Second render does not double the chip.
  h2node.querySelector = () => chipHolder[0];
  plugin.renderNoteReadyHeadingInReading(el, ctx);
  assert.equal(chipHolder.length, 1);
});

test("reading view: no chip for ineligible notes", () => {
  const plugin = makePlugin(makeSnapshot());
  const el = {
    querySelectorAll: () => [
      { tagName: "H2", textContent: "Tasks", children: [] },
    ],
  };
  const ctx = { sourcePath: "dash.md", addChild: () => {} };
  plugin.renderNoteReadyHeadingInReading(el, ctx);
  assert.equal(plugin.noteReadyReadingWidgets.size, 0);
});

// --- Fan-out ----------------------------------------------------------

test("one live-refresh fan-out reaches every family", () => {
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  const reached = [];
  for (const name of [
    "scheduleReadyRefresh",
    "scheduleDashboardLaneRefresh",
    "scheduleFreshnessStatusBar",
    "scheduleFreshnessMarksRefresh",
    "scheduleReviewChipsRefresh",
    "scheduleCrowdedRefresh",
    "scheduleReadyNotesRefresh",
    "scheduleNoteReadyHeadingsRefresh",
  ]) {
    plugin[name] = () => {
      reached.push(name);
    };
  }
  plugin.scheduleLiveWidgetRefresh();
  assert.deepEqual(reached, [
    "scheduleReadyRefresh",
    "scheduleDashboardLaneRefresh",
    "scheduleFreshnessStatusBar",
    "scheduleFreshnessMarksRefresh",
    "scheduleReviewChipsRefresh",
    "scheduleCrowdedRefresh",
    "scheduleReadyNotesRefresh",
    "scheduleNoteReadyHeadingsRefresh",
  ]);
});

// --- CSS ---------------------------------------------------------------

test("ledger-tools CSS is theme-safe for the new views", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "..", "plugins", "bob-ledger-tools", "styles.css"),
    "utf8",
  );
  for (const selector of [
    ".bob-plan-crowded",
    ".bob-ready-notes",
    ".bob-ready-bar",
    ".bob-ready-cell",
    ".bob-ready-over-pill",
    ".bob-note-ready-heading",
  ]) {
    assert.ok(css.includes(selector), `expected ${selector}`);
  }
  assert.ok(css.includes("tabular-nums"));
  assert.ok(css.includes("prefers-reduced-motion"));
  const added = css.slice(css.indexOf("Per-note Ready cap views"));
  assert.doesNotMatch(added, /#[0-9a-fA-F]{3,8}/);
});

