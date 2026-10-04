// Tests for the keep-streak ledger-marks phase (bob-cli-3v.2):
// `api.freshness.keepLine` (freshness namespace v5 counting; v6
// date-independent decide/config), keeps-aware placement/config/
// evaluation, and folded keep pips.
// `docs/freshness.md` §§2a/4/7/11-12 plus the machine-readable K/C/D/B
// vectors in `tests/fixtures/freshness_keeps/vectors.json` (bob-cli)
// are authoritative; the vectors below mirror that fixture's K
// placement, C config, D decide, and B immediate-availability cases
// verbatim, with D = `2026-10-08`. The increment and MK display cases
// have no fixture entry (Rust has no increment path), so they are
// pinned here.
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
  coerceFreshnessConfig,
  coerceFreshnessDecay,
  defaultFreshnessConfig,
  freshnessCounts,
  freshnessDecideFor,
  freshnessEvaluate,
  freshnessFirstValidKeeps,
  freshnessKeepLine,
  freshnessMarkConsensus,
  freshnessMarkDotCap,
  freshnessMarkKeepsLine,
  freshnessMarkModel,
  freshnessMarkResolution,
  freshnessMarkSource,
  freshnessMarkSourceInText,
  freshnessParseKeepsValue,
  freshnessQueue,
  freshnessSetRefreshLine,
  freshnessStampLine,
  freshnessTaskStatus,
  readFreshness,
} = helpers;

const D = "2026-10-08";
const ACTIVE_DAY = "2026-10-20";
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

// A Ready, visible, non-recurring task row in `a.md` unless noted.
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
    rawLine: "- [ ] #task T",
    noteRefreshRaw: undefined,
    ...overrides,
  };
}

// Full mark model for a task line on `today` under `config`: source
// detection, evaluator-backed resolution, and the line's own status
// symbol (the Live Preview rule).
function markModel(line, options = {}) {
  const {
    today = D,
    config = CFG,
    interval = DEFAULT_INTERVAL,
    ...rowOverrides
  } = options;
  const source = freshnessMarkSource(line, today);
  assert.ok(source !== null, "expected a mark source for: " + line);
  const row = sRow({ rawLine: line, ...rowOverrides });
  const resolution = freshnessMarkResolution(row, today, config);
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

function childTexts(el) {
  return el.children.map((child) =>
    typeof child.text === "string"
      ? child.text
      : child.children.map((grand) => grand.text || "").join(""),
  );
}

// --- K placement vectors (mirror the fixture's read cases) ---

test("K1 absent: no keeps means 0 with no lints", () => {
  const read = readFreshness("- [ ] #task Buy milk [fresh:: 2026-10-01]", D);
  assert.equal(read.keeps, 0);
  assert.deepEqual(read.lints, []);
});

test("K8 misplaced: keeps inside the Tasks suffix reads with a lint", () => {
  const read = readFreshness(
    "- [ ] #task Buy milk [created:: 2026-09-29] [keeps:: 2]",
    D,
  );
  assert.equal(read.keeps, 2);
  assert.ok(read.lints.includes("fresh_misplaced"));
});

test("K9 duplicates and invalid values: first valid wins, else 0", () => {
  const dup = readFreshness("- [ ] #task A [keeps:: 2] B [keeps:: 5]", D);
  assert.equal(dup.keeps, 2);
  assert.ok(dup.lints.includes("keeps_duplicate"));
  for (const [name, line] of [
    ["zero", "- [ ] #task A [keeps:: 0]"],
    ["negative", "- [ ] #task A [keeps:: -1]"],
    ["fractional", "- [ ] #task A [keeps:: 2.5]"],
    ["above-range", "- [ ] #task A [keeps:: 1000]"],
    ["malformed", "- [ ] #task A [keeps:: soon]"],
  ]) {
    const read = readFreshness(line, D);
    assert.equal(read.keeps, 0, name);
    assert.ok(read.lints.includes("keeps_invalid"), name);
  }
  const mixed = readFreshness("- [ ] #task A [keeps:: soon] [keeps:: 3]", D);
  assert.equal(mixed.keeps, 3);
  assert.ok(mixed.lints.includes("keeps_invalid"));
  assert.ok(mixed.lints.includes("keeps_duplicate"));
});

test("K10 ceiling and NEW: 999 reads, never-confirmed reads 0", () => {
  const ceiling = readFreshness(
    "- [ ] #task A [fresh:: 2026-10-01] [keeps:: 999]",
    D,
  );
  assert.equal(ceiling.keeps, 999);
  assert.deepEqual(
    ceiling.lints.filter((lint) => lint.startsWith("keeps")),
    [],
  );
  const fresh = readFreshness(
    "- [ ] #task New capture [created:: 2026-09-30]",
    D,
  );
  assert.equal(fresh.keeps, 0);
});

test("K13 exact keys: near-miss keys are not keeps; parens read", () => {
  const near = readFreshness(
    "- [ ] #task A [keep:: 2] [Keep:: 2] [keepsx:: 2]",
    D,
  );
  assert.equal(near.keeps, 0);
  assert.deepEqual(
    near.lints.filter((lint) => lint.startsWith("keeps")),
    [],
  );
  const paren = readFreshness("- [ ] #task Call mom (keeps:: 2)", D);
  assert.equal(paren.keeps, 2);
  assert.deepEqual(
    paren.lints.filter((lint) => lint.startsWith("keeps")),
    [],
  );
});

test("keeps value parser accepts only decimal 1-999", () => {
  assert.equal(freshnessParseKeepsValue("2"), 2);
  assert.equal(freshnessParseKeepsValue(" 999 "), 999);
  for (const bad of ["", "0", "-1", "1000", "2.5", "soon", "0x2", "  "]) {
    assert.equal(freshnessParseKeepsValue(bad), null, JSON.stringify(bad));
  }
  assert.equal(
    freshnessFirstValidKeeps("- [ ] #task A [keeps:: soon] [keeps:: 3]"),
    3,
  );
  assert.equal(freshnessFirstValidKeeps("- [ ] #task A"), null);
});

// --- K placement vectors (mirror the fixture's write cases) ---

test("K2 first valid canonical: uncounted keep preserves and repairs", () => {
  const kept = freshnessKeepLine(
    "- [ ] #task Rename queue input [fresh:: 2026-10-01] [keeps:: 2]",
    D,
    { counted: false },
  );
  assert.equal(
    kept.line,
    "- [ ] #task Rename queue input [fresh:: 2026-10-08] [keeps:: 2]",
  );
  assert.equal(kept.changed, true);
  assert.equal(kept.refused, null);
});

test("K3 refresh/keeps order canonicalizes to fresh, refresh, keeps", () => {
  const kept = freshnessKeepLine(
    "- [ ] #task Rename queue input [keeps:: 2] [refresh:: 14] [fresh:: 2026-10-01] [created:: 2026-09-10] [priority:: low]",
    D,
    { counted: false },
  );
  assert.equal(
    kept.line,
    "- [ ] #task Rename queue input [fresh:: 2026-10-08] [refresh:: 14] [keeps:: 2] [created:: 2026-09-10] [priority:: low]",
  );
  assert.equal(kept.changed, true);
});

test("K4 same-day preserve noop: canonical kept line is byte-identical", () => {
  const kept = freshnessKeepLine(
    "- [ ] #task Buy milk [fresh:: 2026-10-08] [keeps:: 2]",
    D,
    { counted: false },
  );
  assert.equal(kept.line, "- [ ] #task Buy milk [fresh:: 2026-10-08] [keeps:: 2]");
  assert.equal(kept.changed, false);
});

test("K5 generic stamp clears, even same-day", () => {
  const stamped = freshnessStampLine(
    "- [ ] #task Buy milk [fresh:: 2026-10-08] [keeps:: 2]",
    D,
  );
  assert.equal(stamped.line, "- [ ] #task Buy milk [fresh:: 2026-10-08]");
  assert.equal(stamped.changed, true);
});

test("K6 set-refresh clears keeps", () => {
  const edited = freshnessSetRefreshLine(
    "- [ ] #task Buy milk [fresh:: 2026-10-01] [refresh:: 14] [keeps:: 2]",
    30,
    D,
  );
  assert.equal(
    edited.line,
    "- [ ] #task Buy milk [fresh:: 2026-10-08] [refresh:: 30]",
  );
  assert.equal(edited.changed, true);
});

test("K7 stale stamp clears keeps", () => {
  const stamped = freshnessStampLine(
    "- [ ] #task Buy milk [fresh:: 2026-10-01] [keeps:: 1] [created:: 2026-09-29]",
    D,
  );
  assert.equal(
    stamped.line,
    "- [ ] #task Buy milk [fresh:: 2026-10-08] [created:: 2026-09-29]",
  );
  assert.equal(stamped.changed, true);
});

test("K8b misplaced keeps repaired to canonical order by a keep", () => {
  const kept = freshnessKeepLine(
    "- [ ] #task Buy milk [created:: 2026-09-29] [keeps:: 2]",
    D,
    { counted: false },
  );
  assert.equal(
    kept.line,
    "- [ ] #task Buy milk [fresh:: 2026-10-08] [keeps:: 2] [created:: 2026-09-29]",
  );
  assert.equal(kept.changed, true);
});

test("K11 refusals preserve: closed and recurring lines never write", () => {
  for (const line of [
    "- [x] #task Old [keeps:: 2] [completion:: 2026-10-01]",
    "- [ ] #task Water plants [repeat:: every week] [keeps:: 2]",
  ]) {
    for (const run of [
      freshnessStampLine(line, D),
      freshnessKeepLine(line, D, { counted: true }),
      freshnessKeepLine(line, D, { counted: false }),
    ]) {
      assert.equal(run.line, line);
      assert.equal(run.changed, false);
      assert.ok(run.refused === "closed" || run.refused === "recurring");
    }
  }
  const plain = freshnessKeepLine("Buy milk [fresh:: 2026-10-01]", D, {
    counted: true,
  });
  assert.equal(plain.refused, "not_task");
  assert.equal(plain.changed, false);
});

// --- keepLine increment matrix (no fixture entry: JS-only) ---

test("counted keep increments a stale streak once in the same write", () => {
  const kept = freshnessKeepLine(
    "- [ ] #task A [fresh:: 2026-10-01] [keeps:: 2]",
    D,
    { counted: true },
  );
  assert.equal(kept.line, "- [ ] #task A [fresh:: 2026-10-08] [keeps:: 3]");
  assert.equal(kept.changed, true);
});

test("first counted keep on a streakless due task writes keeps 1", () => {
  const kept = freshnessKeepLine("- [ ] #task A [fresh:: 2026-10-01]", D, {
    counted: true,
  });
  assert.equal(kept.line, "- [ ] #task A [fresh:: 2026-10-08] [keeps:: 1]");
});

test("counted keep saturates at 999 and never wraps", () => {
  const kept = freshnessKeepLine(
    "- [ ] #task A [fresh:: 2026-10-01] [keeps:: 999]",
    D,
    { counted: true },
  );
  assert.equal(kept.line, "- [ ] #task A [fresh:: 2026-10-08] [keeps:: 999]");
});

test("counted keep needs a valid prior fresh before today", () => {
  // NEW (no fresh): stamps, never counts.
  const fresh = freshnessKeepLine("- [ ] #task A [created:: 2026-09-30]", D, {
    counted: true,
  });
  assert.equal(fresh.line, "- [ ] #task A [fresh:: 2026-10-08] [created:: 2026-09-30]");
  // Same-day repeat: preserves the streak byte-identically.
  const sameDay = freshnessKeepLine(
    "- [ ] #task A [fresh:: 2026-10-08] [keeps:: 2]",
    D,
    { counted: true },
  );
  assert.equal(sameDay.line, "- [ ] #task A [fresh:: 2026-10-08] [keeps:: 2]");
  assert.equal(sameDay.changed, false);
  // Future fresh is not evidence: stamps and preserves.
  const future = freshnessKeepLine(
    "- [ ] #task A [fresh:: 2026-10-09] [keeps:: 2]",
    D,
    { counted: true },
  );
  assert.equal(future.line, "- [ ] #task A [fresh:: 2026-10-08] [keeps:: 2]");
});

test("counted keep repairs malformed and duplicate placement", () => {
  const malformed = freshnessKeepLine(
    "- [ ] #task A [fresh:: 2026-10-01] [keeps:: soon]",
    D,
    { counted: true },
  );
  assert.equal(malformed.line, "- [ ] #task A [fresh:: 2026-10-08] [keeps:: 1]");
  const dup = freshnessKeepLine(
    "- [ ] #task A [fresh:: 2026-10-01] [keeps:: 2] [keeps:: 5]",
    D,
    { counted: true },
  );
  assert.equal(dup.line, "- [ ] #task A [fresh:: 2026-10-08] [keeps:: 3]");
});

test("uncounted keep preserves the valid value while canonicalizing", () => {
  const kept = freshnessKeepLine(
    "- [ ] #task A [keeps:: 2] [fresh:: 2026-10-01]",
    D,
    { counted: false },
  );
  assert.equal(kept.line, "- [ ] #task A [fresh:: 2026-10-08] [keeps:: 2]");
  const missing = freshnessKeepLine("- [ ] #task A", D);
  assert.equal(missing.line, "- [ ] #task A [fresh:: 2026-10-08]");
});

// --- C config vectors (mirror the fixture's decay cases) ---

test("decay normalization: absent, null, true, and {} enable with 3", () => {
  assert.deepEqual(defaultFreshnessConfig().decay, { ...DECAY_DEFAULT });
  for (const block of [undefined, null, true, {}]) {
    const coerced = coerceFreshnessDecay(block);
    assert.equal(coerced.invalid, false, JSON.stringify(block));
    assert.deepEqual(coerced.decay, { ...DECAY_DEFAULT });
  }
  assert.deepEqual(coerceFreshnessConfig(undefined).config.decay, {
    ...DECAY_DEFAULT,
  });
  assert.deepEqual(coerceFreshnessConfig({ decay: true }).config.decay, {
    ...DECAY_DEFAULT,
  });
  assert.deepEqual(coerceFreshnessConfig({ decay: {} }).config.decay, {
    ...DECAY_DEFAULT,
  });
});

test("decay false counts and displays but never asks", () => {
  const coerced = coerceFreshnessConfig({ decay: false });
  assert.equal(coerced.invalid, false);
  assert.deepEqual(coerced.config.decay, {
    enabled: false,
    keeps: 3,
    enter: null,
  });
});

test("decay keeps 0 and fixed entry normalize", () => {
  const zero = coerceFreshnessConfig({ decay: { keeps: 0 } });
  assert.equal(zero.invalid, false);
  assert.deepEqual(zero.config.decay, { enabled: true, keeps: 0, enter: null });
  const fixed = coerceFreshnessConfig({ decay: { keeps: 2, enter: "P1" } });
  assert.equal(fixed.invalid, false);
  assert.deepEqual(fixed.config.decay, {
    enabled: true,
    keeps: 2,
    enter: "P1",
  });
});

test("invalid decay shapes fail the freshness config contract", () => {
  for (const block of [
    { decay: { keeps: -1 } },
    { decay: { keeps: 2.5 } },
    { decay: { keeps: 1000 } },
    { decay: "soon" },
    { decay: { enter: "" } },
    { decay: { enter: 2 } },
  ]) {
    const coerced = coerceFreshnessConfig(block);
    assert.equal(coerced.invalid, true, JSON.stringify(block));
    assert.deepEqual(coerced.config.decay, { ...DECAY_DEFAULT });
  }
});

// --- B immediate-availability vectors: at-limit Ready due rows decide ---

test("B: at-limit Ready due rows decide on every local day", () => {
  const row = { lane: "ready", tier: "rotten", keeps: 3 };
  for (const day of [
    "2026-10-04",
    "2026-10-08",
    "2026-10-18",
    "2026-10-19",
    "2026-10-20",
  ]) {
    assert.equal(
      freshnessDecideFor(row.lane, row.tier, row.keeps, {
        decay: { ...DECAY_DEFAULT },
      }),
      true,
      day,
    );
    const evaluated = freshnessEvaluate(
      sRow({
        rawLine: "- [ ] #task A [fresh:: 2026-09-20] [keeps:: 3]",
      }),
      day,
      CFG,
    );
    assert.equal(evaluated.tier, "rotten", day);
    assert.equal(evaluated.decide, true, day);
  }
});

// --- D decide vectors (mirror the fixture's decide cases) ---

function decideRow({ lane = "ready", tier = "rotten", keeps = 3 } = {}) {
  return { lane, tier, keeps };
}

test("D1 early date: an at-limit Ready due row decides", () => {
  const row = decideRow();
  assert.equal(
    freshnessDecideFor(row.lane, row.tier, row.keeps, {
      decay: { ...DECAY_DEFAULT },
    }),
    true,
  );
});

test("D2 at limit decides; D3 below limit stamps without a card", () => {
  const atLimit = decideRow({ keeps: 3 });
  const below = decideRow({ keeps: 2 });
  for (const [row, expected] of [
    [atLimit, true],
    [below, false],
  ]) {
    assert.equal(
      freshnessDecideFor(row.lane, row.tier, row.keeps, {
        decay: { ...DECAY_DEFAULT },
      }),
      expected,
    );
  }
});

test("D4 returned counts as due; D5 NEW never decides", () => {
  assert.equal(
    freshnessDecideFor("ready", "returned", 5, {
      decay: { ...DECAY_DEFAULT },
    }),
    true,
  );
  assert.equal(
    freshnessDecideFor("ready", "new", 0, {
      decay: { enabled: true, keeps: 0, enter: null },
    }),
    false,
  );
});

test("D6 zero limit asks on every due Ready re-confirmation", () => {
  assert.equal(
    freshnessDecideFor("ready", "rotten", 0, {
      decay: { enabled: true, keeps: 0, enter: null },
    }),
    true,
  );
});

test("D7 off never asks; D8 lane rows never decide", () => {
  assert.equal(
    freshnessDecideFor("ready", "rotten", 9, {
      decay: { enabled: false, keeps: 3, enter: null },
    }),
    false,
  );
  assert.equal(
    freshnessDecideFor("next", "next", 9, {
      decay: { ...DECAY_DEFAULT },
    }),
    false,
  );
});

test("evaluator, queue, and counts carry keeps and decide", () => {
  const line = "- [ ] #task A [fresh:: 2026-10-01] [keeps:: 2]";
  const row = sRow({ rawLine: line });
  const before = freshnessEvaluate(row, D, CFG);
  assert.equal(before.keeps, 2);
  assert.equal(before.decide, false);
  assert.equal(before.state, "rotten");
  assert.equal(before.tier, "rotten");
  const afterRow = sRow({ rawLine: line });
  const after = freshnessEvaluate(afterRow, ACTIVE_DAY, CFG);
  assert.equal(after.keeps, 2);
  assert.equal(after.decide, false);
  const atLimit = sRow({
    rawLine: "- [ ] #task A [fresh:: 2026-10-01] [keeps:: 3]",
  });
  const decided = freshnessEvaluate(atLimit, ACTIVE_DAY, CFG);
  assert.equal(decided.keeps, 3);
  assert.equal(decided.decide, true);

  const queue = freshnessQueue(
    [sRow({ rawLine: line }), sRow({ rawLine: atLimit.rawLine })],
    ACTIVE_DAY,
    CFG,
  );
  assert.equal(queue.length, 2);
  for (const entry of queue) {
    assert.ok(Number.isInteger(entry.keeps));
    assert.equal(typeof entry.decide, "boolean");
  }
  assert.deepEqual(
    queue.map((entry) => entry.keeps).sort(),
    [2, 3],
  );
  assert.equal(
    queue.find((entry) => entry.keeps === 3).decide,
    true,
  );
  const counts = freshnessCounts(
    [sRow({ rawLine: line }), sRow({ rawLine: atLimit.rawLine })],
    ACTIVE_DAY,
    CFG,
  );
  assert.equal(counts.decide, 1);
  assert.equal(counts.rotten, 2);
  const early = freshnessCounts(
    [sRow({ rawLine: line }), sRow({ rawLine: atLimit.rawLine })],
    D,
    CFG,
  );
  assert.equal(early.decide, 1);
});

// --- MK display vectors: folded pips with truthful annotations ---

test("no keeps: the existing mark is unchanged", () => {
  const line = "- [ ] #task T [fresh:: 2026-10-05]";
  const source = freshnessMarkSource(line, D);
  assert.equal(source.text, "[fresh:: 2026-10-05]");
  assert.equal(source.keeps, null);
  const model = markModel(line);
  assert.equal(model.keeps, 0);
  assert.equal(model.decide, false);
  assert.equal(model.dots, null);
  assert.equal(model.overflow, null);
  assert.equal(
    model.tooltip,
    "Confirmed Mon, Oct 5 · 3 days ago\nNext review Mon, Oct 12 · every 7 days",
  );
});

test("aging with two keeps: faint pips plus a counting-only line", () => {
  const line = "- [ ] #task T [fresh:: 2026-10-05] [keeps:: 2]";
  const source = freshnessMarkSource(line, D);
  assert.equal(source.text, "[fresh:: 2026-10-05] [keeps:: 2]");
  assert.equal(source.keeps, 2);
  assert.equal(source.foldSpace, true);
  assert.equal(line.slice(source.fieldStart, source.fieldEnd), source.text);
  const model = markModel(line);
  assert.equal(model.tone, "aging");
  assert.equal(model.label, "3d");
  assert.equal(model.keeps, 2);
  assert.equal(model.decide, false);
  assert.equal(model.dots, "••");
  assert.equal(model.overflow, null);
  assert.equal(
    model.tooltip,
    "Confirmed Mon, Oct 5 · 3 days ago\nNext review Mon, Oct 12 · every 7 days\nKept 2 reviews in a row",
  );
});

test("confirmed today with two keeps: check glyph, faint dots", () => {
  const model = markModel("- [ ] #task T [fresh:: 2026-10-08] [keeps:: 2]");
  assert.equal(model.tone, "today");
  assert.equal(model.glyph, "check");
  assert.equal(model.label, "today");
  assert.equal(model.dots, "••");
  assert.equal(
    model.tooltip,
    "Confirmed today\nNext review Thu, Oct 15 · every 7 days\nKept 2 reviews in a row",
  );
});

test("due below threshold: orange capsule keeps its glyph, adds dots", () => {
  const model = markModel("- [ ] #task T [fresh:: 2026-10-01] [keeps:: 2]");
  assert.equal(model.tone, "due");
  assert.equal(model.glyph, "refresh");
  assert.equal(model.dots, "••");
  assert.ok(model.tooltip.includes("Kept 2 reviews in a row"));
  assert.ok(model.tooltip.endsWith("Alt+F to confirm"));
});

test("resting marks show historical dots quietly and never decide", () => {
  const model = markModel("- [x] #task Old [fresh:: 2026-10-08] [keeps:: 2]", {
    isTodo: false,
  });
  assert.equal(model.tone, "resting");
  assert.equal(model.glyph, "ring");
  assert.equal(model.dots, "••");
  assert.equal(model.decide, false);
});

test("active decision due: data stays truthful, leaf stays gated", () => {
  const line = "- [ ] #task T [fresh:: 2026-10-01] [keeps:: 3]";
  const model = markModel(line, { today: ACTIVE_DAY });
  assert.equal(model.tone, "due");
  assert.equal(model.keeps, 3);
  assert.equal(model.decide, true);
  // No card capability here (mixed-version shape): the capsule keeps the
  // refresh glyph, the existing key hint, and counting-only wording — never
  // a promise the installed nav cannot keep. The decision-card phase owns
  // the capable variants (leaf, `Alt+F to decide`, "asks" wording).
  assert.equal(model.glyph, "refresh");
  assert.ok(model.tooltip.includes("Kept 3 reviews in a row"));
  assert.ok(!model.tooltip.includes("Bob asks at"));
  assert.ok(model.tooltip.endsWith("Alt+F to confirm"));
});

test("dot caps follow the threshold with +N overflow", () => {
  assert.equal(freshnessMarkDotCap(1), 1);
  assert.equal(freshnessMarkDotCap(2), 2);
  assert.equal(freshnessMarkDotCap(0), 3);
  assert.equal(freshnessMarkDotCap(3), 3);
  assert.equal(freshnessMarkDotCap(999), 3);
  const one = markModel("- [ ] #task T [fresh:: 2026-10-05] [keeps:: 2]", {
    config: { ...CFG, decay: { enabled: true, keeps: 1, enter: null } },
  });
  assert.equal(one.dots, "•");
  assert.equal(one.overflow, "+1");
  const two = markModel("- [ ] #task T [fresh:: 2026-10-05] [keeps:: 2]", {
    config: { ...CFG, decay: { enabled: true, keeps: 2, enter: null } },
  });
  assert.equal(two.dots, "••");
  assert.equal(two.overflow, null);
  const over = markModel("- [ ] #task T [fresh:: 2026-10-01] [keeps:: 4]");
  assert.equal(over.dots, "•••");
  assert.equal(over.overflow, "+1");
  assert.ok(over.tooltip.includes("Kept 4 reviews in a row"));
});

test("keeps tooltip wording: singulars, zero threshold, off state", () => {
  assert.equal(
    freshnessMarkKeepsLine(1, { active: true, enabled: true, limit: 3 }),
    "Kept 1 review in a row · Bob asks at 3",
  );
  assert.equal(
    freshnessMarkKeepsLine(2, { active: true, enabled: true, limit: 0 }),
    "Kept 2 reviews in a row · Bob asks every review",
  );
  assert.equal(
    freshnessMarkKeepsLine(2, { active: true, enabled: false, limit: 3 }),
    "Kept 2 reviews in a row · decay off",
  );
  assert.equal(
    freshnessMarkKeepsLine(2, { active: false, enabled: true, limit: 3 }),
    "Kept 2 reviews in a row",
  );
  assert.equal(freshnessMarkKeepsLine(0, { active: true }), null);
  assert.equal(freshnessMarkKeepsLine(null, { active: true }), null);
});

test("noncanonical keeps never fold but keep their repair pill", () => {
  // Duplicate: no fold, the mark covers fresh only.
  const dup = freshnessMarkSource(
    "- [ ] #task A [fresh:: 2026-10-05] [keeps:: 2] [keeps:: 5]",
    D,
  );
  assert.equal(dup.text, "[fresh:: 2026-10-05]");
  assert.equal(dup.keeps, null);
  // Paren-wrapped: no fold.
  const paren = freshnessMarkSource(
    "- [ ] #task Call mom [fresh:: 2026-10-05] (keeps:: 2)",
    D,
  );
  assert.equal(paren.text, "[fresh:: 2026-10-05]");
  assert.equal(paren.keeps, null);
  // Invalid value: no fold.
  const invalid = freshnessMarkSource(
    "- [ ] #task A [fresh:: 2026-10-05] [keeps:: soon]",
    D,
  );
  assert.equal(invalid.text, "[fresh:: 2026-10-05]");
  assert.equal(invalid.keeps, null);
  // Nonadjacent: the keeps field stays a pill.
  const split = freshnessMarkSource(
    "- [ ] #task X [keeps:: 2] [fresh:: 2026-10-05]",
    D,
  );
  assert.equal(split.text, "[fresh:: 2026-10-05]");
  assert.equal(split.keeps, null);
  // Misplaced (inside the Tasks suffix): no mark at all, like fresh.
  assert.equal(
    freshnessMarkSource(
      "- [ ] #task Buy milk [created:: 2026-09-29] [fresh:: 2026-10-01] [keeps:: 2]",
      D,
    ),
    null,
  );
  // Refresh plus keeps fold as one span: fresh, refresh, keeps.
  const both = freshnessMarkSource(
    "- [ ] #task T [fresh:: 2026-10-05] [refresh:: 14] [keeps:: 2]",
    D,
  );
  assert.equal(both.text, "[fresh:: 2026-10-05] [refresh:: 14] [keeps:: 2]");
  assert.equal(both.refresh, 14);
  assert.equal(both.keeps, 2);
});

test("quoted lines fold; rendered fragments fold without task checks", () => {
  const quoted = freshnessMarkSource(
    "> - [ ] #task Quoted [fresh:: 2026-10-05] [keeps:: 2]",
    D,
  );
  assert.ok(quoted !== null);
  assert.equal(quoted.text, "[fresh:: 2026-10-05] [keeps:: 2]");
  assert.equal(quoted.foldSpace, true);
  const rendered = freshnessMarkSourceInText(
    "Buy milk [fresh:: 2026-10-05] [keeps:: 2]",
    D,
  );
  assert.ok(rendered !== null);
  assert.equal(rendered.text, "[fresh:: 2026-10-05] [keeps:: 2]");
  assert.equal(rendered.keeps, 2);
});

test("unresolved marks show the line's own pips quietly and never decide", () => {
  const line = "- [ ] #task T [fresh:: 2026-10-05] [keeps:: 2]";
  const source = freshnessMarkSource(line, D);
  const model = freshnessMarkModel({
    source,
    today: D,
    interval: DEFAULT_INTERVAL,
    status: freshnessTaskStatus(line),
    resolution: null,
  });
  assert.equal(model.resolved, false);
  assert.equal(model.dots, "••");
  assert.equal(model.decide, false);
  assert.ok(model.tooltip.includes("Kept 2 reviews in a row"));
  assert.ok(!model.tooltip.includes("Bob asks"));
});

test("consensus sees count and decision eligibility: ambiguity stays neutral", () => {
  const line = "- [ ] #task T [fresh:: 2026-10-01] [keeps:: 3]";
  const first = markModel(line, { today: ACTIVE_DAY });
  const second = markModel(line, { today: ACTIVE_DAY });
  assert.deepEqual(first, second);
  assert.equal(freshnessMarkConsensus([first, second]), first);
  const quieter = markModel("- [ ] #task T [fresh:: 2026-10-01] [keeps:: 2]", {
    today: ACTIVE_DAY,
  });
  assert.equal(freshnessMarkConsensus([first, quieter]), null);
  assert.equal(freshnessMarkConsensus([]), null);
});

test("pips render as one aria-hidden span with the count in the label", () => {
  const model = markModel("- [ ] #task T [fresh:: 2026-10-05] [keeps:: 2]");
  const el = buildFreshnessMarkElement(makeFakeDoc(), model, {
    foldSpace: true,
  });
  const dots = el.children.find(
    (child) => child.attrs && child.attrs.class === "bob-fresh-mark-dots",
  );
  assert.ok(dots, "expected a dots span");
  assert.equal(dots.attrs["aria-hidden"], "true");
  assert.equal(childTexts(dots).join(""), "••");
  assert.ok(el.attrs["aria-label"].includes("Kept 2 reviews in a row"));
  const over = markModel("- [ ] #task T [fresh:: 2026-10-01] [keeps:: 4]");
  const overEl = buildFreshnessMarkElement(makeFakeDoc(), over, {
    foldSpace: true,
  });
  const overDots = overEl.children.find(
    (child) => child.attrs && child.attrs.class === "bob-fresh-mark-dots",
  );
  assert.equal(childTexts(overDots).join(""), "•••+1");
  assert.ok(overEl.attrs["aria-label"].includes("Kept 4 reviews in a row"));
  // Repeated rendering is byte-stable: unchanged marks never flicker.
  const again = buildFreshnessMarkElement(makeFakeDoc(), model, {
    foldSpace: true,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(again)), JSON.parse(JSON.stringify(el)));
  // No streak, no dots span.
  const plain = markModel("- [ ] #task T [fresh:: 2026-10-05]");
  const plainEl = buildFreshnessMarkElement(makeFakeDoc(), plain, {
    foldSpace: true,
  });
  assert.ok(
    !plainEl.children.some(
      (child) => child.attrs && child.attrs.class === "bob-fresh-mark-dots",
    ),
  );
});
