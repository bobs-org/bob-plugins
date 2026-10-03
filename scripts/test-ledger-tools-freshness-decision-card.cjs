// Tests for the decision-card phase (bob-cli-3v.5) on the ledger side:
// the leaf signal, `data-decide`, the `Alt+F to decide` key hint, and
// the capability-gated "asks" promise. `docs/freshness.md` §§2a/11-12
// is authoritative: display decision affordances appear only when the
// compatible nav card is present, the rollout is active, decay is on,
// and resolution establishes a due Ready choice. Mixed-version sessions
// (no card) degrade to counting pips with truthful counting-only
// wording and never reset on explicit keep.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

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
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: TestMarkdownView,
      Notice: TestNotice,
      Platform: { isDesktopApp: true },
      Plugin: TestPlugin,
      normalizePath: (value) => value,
      parseYaml: (text) => JSON.parse(text),
    };
  }
  if (request === "@codemirror/state") {
    return { Prec: { highest: (value) => value } };
  }
  if (request === "@codemirror/view") {
    return {
      EditorView: { updateListener: { of: (listener) => ({ listener }) } },
      keymap: { of: (value) => value },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers } = LedgerToolsPlugin;
Module._load = originalLoad;

const {
  buildFreshnessMarkElement,
  FRESHNESS_DECAY_ACTIVE_FROM,
  freshnessDecayActive,
  freshnessDecayCardCapable,
  freshnessMarkModel,
  freshnessMarkResolution,
  freshnessMarkSource,
  freshnessTaskStatus,
} = helpers;

const ACTIVE_DAY = "2026-10-20";
const BEFORE_DAY = "2026-10-08";
const DECAY_DEFAULT = { enabled: true, keeps: 3, enter: null };
const CFG = {
  interval: 7,
  intervalFromConfig: false,
  pendingInterval: 1,
  nextInterval: 1,
  rottenDailyBudget: null,
  decay: { ...DECAY_DEFAULT },
};
const DEFAULT_INTERVAL = { days: 7, source: "default" };

// A Ready, visible, non-recurring rotten task row in `a.md`.
function sRow(overrides = {}) {
  return {
    path: "a.md",
    line: 1,
    statusSymbol: undefined,
    isTodo: true,
    recurring: false,
    laneVisible: true,
    isDailyNote: false,
    isToday: false,
    scheduled: null,
    created: null,
    rawLine: "- [ ] #task Rename queue input [fresh:: 2026-10-01] [keeps:: 3]",
    noteRefreshRaw: undefined,
    ...overrides,
  };
}

// Full mark model with an explicit card-capability switch.
function markModel(line, options = {}) {
  const {
    today = ACTIVE_DAY,
    config = CFG,
    interval = DEFAULT_INTERVAL,
    cardCapable = false,
    ...rowOverrides
  } = options;
  const source = freshnessMarkSource(line, today);
  assert.ok(source !== null, "expected a mark source for: " + line);
  const row = sRow({ rawLine: line, ...rowOverrides });
  const resolution = freshnessMarkResolution(row, today, config, {
    cardCapable,
  });
  return freshnessMarkModel({
    source,
    today,
    interval,
    status: freshnessTaskStatus(line),
    resolution,
  });
}

function makeFakeDoc() {
  function makeEl(tag, ns) {
    return {
      tag,
      ns: ns || null,
      attrs: {},
      children: [],
      setAttribute(key, value) {
        this.attrs[key] = String(value);
      },
      appendChild(child) {
        this.children.push(child);
        return child;
      },
    };
  }
  return {
    createElement: (tag) => makeEl(tag),
    createElementNS: (ns, tag) => makeEl(tag, ns),
    createTextNode: (text) => ({ text: String(text) }),
  };
}

const DUE_LINE =
  "- [ ] #task Rename queue input [fresh:: 2026-10-01] [keeps:: 3]";

// --- Capability detection ---

test("capability: nav card v1 is capable", () => {
  const app = {
    plugins: {
      plugins: {
        "bob-navigation-hotkeys": { api: { freshnessDecayCard: { version: 1 } } },
      },
    },
  };
  assert.equal(freshnessDecayCardCapable(app), true);
});

test("capability: absent nav, missing api, and old versions are not capable", () => {
  assert.equal(freshnessDecayCardCapable(null), false);
  assert.equal(freshnessDecayCardCapable({}), false);
  assert.equal(
    freshnessDecayCardCapable({ plugins: { plugins: {} } }),
    false,
  );
  assert.equal(
    freshnessDecayCardCapable({
      plugins: { plugins: { "bob-navigation-hotkeys": {} } },
    }),
    false,
  );
  assert.equal(
    freshnessDecayCardCapable({
      plugins: {
        plugins: { "bob-navigation-hotkeys": { api: { version: 1 } } },
      },
    }),
    false,
  );
  assert.equal(
    freshnessDecayCardCapable({
      plugins: {
        plugins: {
          "bob-navigation-hotkeys": { api: { freshnessDecayCard: { version: 0 } } },
        },
      },
    }),
    false,
  );
});

test("capability: a throwing app never throws", () => {
  const app = {
    get plugins() {
      throw new Error("boom");
    },
  };
  assert.equal(freshnessDecayCardCapable(app), false);
});

// --- Leaf signal ---

test("leaf: active capable due choice replaces refresh with a leaf", () => {
  const model = markModel(DUE_LINE, { cardCapable: true });
  assert.equal(model.decide, true);
  assert.equal(model.tone, "due");
  assert.equal(model.glyph, "leaf");
  assert.equal(model.dots, "•••");
  assert.equal(model.overflow, null);
  assert.ok(model.tooltip.includes("Alt+F to decide"));
  assert.ok(model.tooltip.includes("Kept 3 reviews in a row · Bob asks at 3"));
});

test("leaf: the same row without the card keeps refresh and counting words", () => {
  const model = markModel(DUE_LINE, { cardCapable: false });
  assert.equal(model.decide, true);
  assert.equal(model.glyph, "refresh");
  assert.ok(model.tooltip.includes("Alt+F to confirm"));
  assert.ok(model.tooltip.includes("Kept 3 reviews in a row"));
  assert.ok(!model.tooltip.includes("Bob asks at"));
});

test("leaf: pre-activation rows never leaf even when capable", () => {
  assert.equal(FRESHNESS_DECAY_ACTIVE_FROM, "2026-10-19");
  assert.equal(freshnessDecayActive(BEFORE_DAY), false);
  const model = markModel(DUE_LINE, { today: BEFORE_DAY, cardCapable: true });
  assert.equal(model.decide, false);
  assert.equal(model.glyph, "refresh");
  assert.ok(!model.tooltip.includes("Alt+F to decide"));
  assert.ok(!model.tooltip.includes("Bob asks at"));
});

test("leaf: decay-off rows never leaf even when capable", () => {
  const config = { ...CFG, decay: { enabled: false, keeps: 3, enter: null } };
  const model = markModel(DUE_LINE, { config, cardCapable: true });
  assert.equal(model.decide, false);
  assert.equal(model.glyph, "refresh");
  assert.ok(model.tooltip.includes("decay off"));
  assert.ok(!model.tooltip.includes("Alt+F to decide"));
});

test("leaf: below-threshold rows never leaf", () => {
  const line =
    "- [ ] #task Rename queue input [fresh:: 2026-10-01] [keeps:: 2]";
  const model = markModel(line, { cardCapable: true });
  assert.equal(model.decide, false);
  assert.equal(model.glyph, "refresh");
  assert.ok(model.tooltip.includes("Kept 2 reviews in a row · Bob asks at 3"));
});

test("leaf: threshold zero asks on every due re-confirmation when capable", () => {
  const config = { ...CFG, decay: { enabled: true, keeps: 0, enter: null } };
  const line = "- [ ] #task Rename queue input [fresh:: 2026-10-01]";
  const model = markModel(line, { config, cardCapable: true });
  assert.equal(model.decide, true);
  assert.equal(model.glyph, "leaf");
  assert.ok(model.tooltip.includes("Alt+F to decide"));
});

test("leaf: overflow renders capped dots with +N and the exact count in text", () => {
  const line =
    "- [ ] #task Rename queue input [fresh:: 2026-10-01] [keeps:: 5]";
  const model = markModel(line, { cardCapable: true });
  assert.equal(model.glyph, "leaf");
  assert.equal(model.dots, "•••");
  assert.equal(model.overflow, "+2");
});

test("leaf: out-of-scope and closed tasks show dots quietly, never a leaf", () => {
  const closed = markModel(
    "- [x] #task Old [fresh:: 2026-10-01] [keeps:: 3] [completion:: 2026-10-20]",
    { cardCapable: true },
  );
  assert.equal(closed.tone, "resting");
  assert.equal(closed.glyph, "ring");
  assert.equal(closed.dots, "•••");
  const hidden = markModel(DUE_LINE, {
    cardCapable: true,
    laneVisible: false,
  });
  assert.equal(hidden.tone, "resting");
  assert.equal(hidden.glyph, "ring");
  assert.equal(hidden.dots, "•••");
});

test("leaf: unresolved marks show dots quietly with counting-only wording", () => {
  const source = freshnessMarkSource(DUE_LINE, ACTIVE_DAY);
  const model = freshnessMarkModel({
    source,
    today: ACTIVE_DAY,
    interval: DEFAULT_INTERVAL,
    status: " ",
    resolution: null,
  });
  assert.equal(model.glyph, "ring");
  assert.equal(model.dots, "•••");
  assert.ok(model.tooltip.includes("Kept 3 reviews in a row"));
  assert.ok(!model.tooltip.includes("Bob asks at"));
  assert.ok(!model.tooltip.includes("Alt+F to decide"));
});

// --- Element: data-decide and leaf art ---

test("element: leaf marks carry data-decide true and a leaf path", () => {
  const doc = makeFakeDoc();
  const model = markModel(DUE_LINE, { cardCapable: true });
  const el = buildFreshnessMarkElement(doc, model, { foldSpace: true });
  assert.equal(el.attrs["data-decide"], "true");
  assert.equal(el.attrs["data-tone"], "due");
  const svg = el.children.find((child) => child.tag === "svg");
  assert.ok(svg, "expected an svg glyph");
  const paths = svg.children.filter((child) => child.tag === "path");
  assert.equal(paths.length, 2);
});

test("element: non-decision marks carry data-decide false", () => {
  const doc = makeFakeDoc();
  const model = markModel(DUE_LINE, { cardCapable: false });
  const el = buildFreshnessMarkElement(doc, model, { foldSpace: true });
  assert.equal(el.attrs["data-decide"], "false");
});
