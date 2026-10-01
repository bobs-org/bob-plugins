// Tests for the bob-ledger-tools freshness mark model (mark-core).
// `docs/freshness.md` §§11-12 in bob-cli is the authoritative
// definition; the M/N/C vectors below encode the "Mark conformance
// examples" (§12) verbatim, with today `2026-10-08` (Thursday) and
// config interval 7. Tooltip lines are joined with `\n` in code.
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
  freshnessMarkConsensus,
  freshnessMarkModel,
  freshnessMarkResolution,
  freshnessMarkSource,
  freshnessMarkSourceInText,
  freshnessShortDate,
  freshnessTaskStatus,
} = helpers;

const D = "2026-10-08";
const CFG = { interval: 7, intervalFromConfig: false, rottenDailyBudget: null };
const DEFAULT_INTERVAL = { days: 7, source: "default" };

// docs/freshness.md §12: a Ready, visible, non-recurring task in `a.md`
// unless noted.
function sRow(overrides = {}) {
  return {
    path: "a.md",
    line: 1,
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

// Full mark model for a task line: source detection, evaluator-backed
// resolution, and the line's own status symbol (the Live Preview rule).
function markModel(line, options = {}) {
  const { interval = DEFAULT_INTERVAL, ...rowOverrides } = options;
  const source = freshnessMarkSource(line, D);
  assert.ok(source !== null, "expected a mark source for: " + line);
  const row = sRow({ rawLine: line, ...rowOverrides });
  const resolution = freshnessMarkResolution(row, D, CFG);
  return freshnessMarkModel({
    source,
    today: D,
    interval,
    status: freshnessTaskStatus(line),
    resolution,
  });
}

function unresolvedModel(line, interval = DEFAULT_INTERVAL) {
  const source = freshnessMarkSource(line, D);
  assert.ok(source !== null, "expected a mark source for: " + line);
  return freshnessMarkModel({
    source,
    today: D,
    interval,
    status: freshnessTaskStatus(line),
    resolution: null,
  });
}

test("M1 today: check glyph, today label, full ring", () => {
  const line = "- [ ] #task Buy milk [fresh:: 2026-10-08] [created::2026-09-29]";
  const source = freshnessMarkSource(line, D);
  assert.equal(source.text, "[fresh:: 2026-10-08]");
  assert.equal(source.foldSpace, true);
  assert.equal(line[source.fieldStart], "[");
  assert.equal(line[source.fieldStart - 1], " ");
  assert.equal(line.slice(source.fieldStart, source.fieldEnd), source.text);
  const model = markModel(line);
  assert.equal(model.tone, "today");
  assert.equal(model.glyph, "check");
  assert.equal(model.label, "today");
  assert.equal(model.intervalLabel, null);
  assert.equal(model.remaining, 1);
  assert.equal(model.resolved, true);
  assert.equal(
    model.tooltip,
    "Confirmed today\nNext review Thu, Oct 15 · every 7 days",
  );
});

test("M2 aging: ring glyph, 3d label, draining lease", () => {
  const model = markModel("- [ ] #task T [fresh:: 2026-10-05]");
  assert.equal(model.ageDays, 3);
  assert.equal(model.label, "3d");
  assert.equal(model.remaining, 0.5714);
  assert.equal(model.tone, "aging");
  assert.equal(model.glyph, "ring");
  assert.equal(
    model.tooltip,
    "Confirmed Mon, Oct 5 · 3 days ago\nNext review Mon, Oct 12 · every 7 days",
  );
});

test("M3 boundary: ROTTEN due capsule with Alt+F hint", () => {
  const model = markModel("- [ ] #task T [fresh:: 2026-10-01]");
  assert.equal(model.tone, "due");
  assert.equal(model.glyph, "refresh");
  assert.equal(model.label, "7d");
  assert.equal(model.remaining, 0);
  assert.equal(
    model.tooltip,
    "Confirmed Thu, Oct 1 · 7 days ago\nDue for review since Thu, Oct 8 · every 7 days\nAlt+F to confirm",
  );
});

test("M4 yesterday uses the yesterday relative", () => {
  const model = markModel("- [ ] #task T [fresh:: 2026-10-07]");
  assert.equal(model.label, "1d");
  assert.equal(model.remaining, 0.8571);
  assert.equal(
    model.tooltip,
    "Confirmed Wed, Oct 7 · yesterday\nNext review Wed, Oct 14 · every 7 days",
  );
});

test("M5 folded refresh shows the /14d suffix", () => {
  const line =
    "- [ ] #task Rename queue input [fresh:: 2026-10-05] [refresh:: 14] [created::2026-09-10] [priority:: low]";
  const source = freshnessMarkSource(line, D);
  assert.equal(source.text, "[fresh:: 2026-10-05] [refresh:: 14]");
  assert.equal(source.refresh, 14);
  const model = markModel(line);
  assert.equal(model.label, "3d");
  assert.equal(model.intervalLabel, "/14d");
  assert.equal(model.remaining, 0.7857);
  assert.equal(
    model.tooltip,
    "Confirmed Mon, Oct 5 · 3 days ago\nNext review Mon, Oct 19 · every 14 days (this task)",
  );
});

test("M6 refresh today: today tone hides the interval suffix", () => {
  const model = markModel(
    "- [ ] #task T [fresh:: 2026-10-08] [refresh:: 14]",
  );
  assert.equal(model.tone, "today");
  assert.equal(model.label, "today");
  assert.equal(model.intervalLabel, null);
  assert.equal(
    model.tooltip,
    "Confirmed today\nNext review Thu, Oct 22 · every 14 days (this task)",
  );
});

test("M7 note interval stays tooltip-only", () => {
  const model = markModel("- [ ] #task T [fresh:: 2026-10-06]", {
    noteRefreshRaw: 3,
  });
  assert.equal(model.label, "2d");
  assert.equal(model.remaining, 0.3333);
  assert.equal(model.intervalLabel, null);
  assert.equal(model.intervalDays, 3);
  assert.equal(model.intervalSource, "note");
  assert.equal(
    model.tooltip,
    "Confirmed Tue, Oct 6 · 2 days ago\nNext review Fri, Oct 9 · every 3 days (this note)",
  );
});

test("M8 resurfaced: due tone on the scheduled return", () => {
  const model = markModel(
    "- [ ] #task Week habits [fresh:: 2026-10-05] [scheduled:: 2026-10-07]",
    { scheduled: "2026-10-07" },
  );
  assert.equal(model.tone, "due");
  assert.equal(model.glyph, "refresh");
  assert.equal(model.label, "3d");
  assert.equal(model.remaining, 0.5714);
  assert.equal(
    model.tooltip,
    "Confirmed Mon, Oct 5 · 3 days ago\nResurfaced Wed, Oct 7: scheduled after it was confirmed\nAlt+F to confirm",
  );
});

test("M9 resting Next and M10 Next stamped today", () => {
  const resting = markModel("- [*] #task Ship it [fresh:: 2026-09-20]", {
    laneVisible: false,
  });
  assert.equal(resting.tone, "resting");
  assert.equal(resting.glyph, "ring");
  assert.equal(resting.label, "18d");
  assert.equal(resting.remaining, 0);
  assert.equal(
    resting.tooltip,
    "Confirmed Sun, Sep 20 · 18 days ago\nNot in the review queue: Next",
  );
  const today = markModel("- [*] #task Ship it [fresh:: 2026-10-08]", {
    laneVisible: false,
  });
  assert.equal(today.tone, "today");
  assert.equal(
    today.tooltip,
    "Confirmed today\nNot in the review queue: Next",
  );
});

test("M11 closed: resting beats age 0", () => {
  const model = markModel(
    "- [x] #task Old [fresh:: 2026-10-08] [completion:: 2026-10-08]",
    { isTodo: false, laneVisible: false },
  );
  assert.equal(model.tone, "resting");
  assert.equal(model.glyph, "ring");
  assert.equal(model.label, "today");
  assert.equal(
    model.tooltip,
    "Confirmed today\nNot in the review queue: Done",
  );
});

test("M12 unresolved running and M13 unresolved lease over", () => {
  const running = unresolvedModel("- [ ] #task T [fresh:: 2026-10-05]");
  assert.equal(running.tone, "aging");
  assert.equal(running.resolved, false);
  assert.equal(
    running.tooltip,
    "Confirmed Mon, Oct 5 · 3 days ago\nNext review Mon, Oct 12 · every 7 days",
  );
  const over = unresolvedModel("- [ ] #task T [fresh:: 2026-09-20]");
  assert.equal(over.tone, "aging");
  assert.equal(over.label, "18d");
  assert.equal(over.remaining, 0);
  assert.equal(
    over.tooltip,
    "Confirmed Sun, Sep 20 · 18 days ago\nReview lease ended Sun, Sep 27 · every 7 days",
  );
});

test("M14 linked today rests with its reason", () => {
  const model = markModel("- [ ] #task T [fresh:: 2026-10-05]", {
    isToday: true,
  });
  assert.equal(model.tone, "resting");
  assert.equal(
    model.tooltip,
    "Confirmed Mon, Oct 5 · 3 days ago\nNot in the review queue: linked today",
  );
});

test("M15 other year shows the year and the 282d age", () => {
  const model = unresolvedModel("- [ ] #task T [fresh:: 2025-12-30]");
  assert.equal(model.label, "282d");
  assert.equal(
    model.tooltip,
    "Confirmed Tue, Dec 30, 2025 · 282 days ago\nReview lease ended Tue, Jan 6 · every 7 days",
  );
});

test("M16 quoted line keeps foldSpace", () => {
  const line = "> - [ ] #task Quoted [fresh:: 2026-10-05] [created::2026-09-01]";
  const source = freshnessMarkSource(line, D);
  assert.ok(source !== null);
  assert.equal(source.foldSpace, true);
});

test("M17 invalid refresh is not folded; M18 non-adjacent keeps no suffix", () => {
  const invalid = freshnessMarkSource(
    "- [ ] #task T [fresh:: 2026-10-05] [refresh:: 0]",
    D,
  );
  assert.equal(invalid.text, "[fresh:: 2026-10-05]");
  assert.equal(invalid.refresh, null);
  const invalidModel = markModel(
    "- [ ] #task T [fresh:: 2026-10-05] [refresh:: 0]",
  );
  assert.equal(invalidModel.intervalDays, 7);
  assert.equal(invalidModel.intervalSource, "default");
  assert.equal(invalidModel.intervalLabel, null);

  const skew = freshnessMarkSource(
    "- [ ] #task X [refresh:: 14] [fresh:: 2026-10-05]",
    D,
  );
  assert.equal(skew.text, "[fresh:: 2026-10-05]");
  const skewModel = markModel(
    "- [ ] #task X [refresh:: 14] [fresh:: 2026-10-05]",
  );
  assert.equal(skewModel.intervalDays, 14);
  assert.equal(skewModel.intervalSource, "task");
  assert.equal(skewModel.intervalLabel, null);
});

test("N1-N6 non-canonical lines get no mark", () => {
  assert.equal(
    freshnessMarkSource("- [ ] #task T [fresh:: 2026-13-01]", D),
    null,
    "N1 malformed",
  );
  assert.equal(
    freshnessMarkSource("- [ ] #task T [fresh:: 2026-10-09]", D),
    null,
    "N2 future",
  );
  assert.equal(
    freshnessMarkSource(
      "- [ ] #task A [fresh:: 2026-09-01] B [fresh:: 2026-09-20] [created::2026-09-01]",
      D,
    ),
    null,
    "N3 duplicate",
  );
  assert.equal(
    freshnessMarkSource(
      "- [ ] #task Buy milk [created::2026-09-29] [fresh:: 2026-10-01]",
      D,
    ),
    null,
    "N4 misplaced",
  );
  assert.equal(
    freshnessMarkSource("- [ ] #task Call mom (fresh:: 2026-10-05)", D),
    null,
    "N5 parenthesized",
  );
  assert.equal(
    freshnessMarkSource("- Buy milk [fresh:: 2026-10-05]", D),
    null,
    "N6 not a task",
  );
});

test("C1-C3 consensus is exact or unresolved", () => {
  const rottenA = sRow({ rawLine: "- [ ] #task A [fresh:: 2026-10-01]" });
  const rottenB = sRow({
    line: 2,
    rawLine: "- [ ] #task B [fresh:: 2026-10-01]",
  });
  const modelFor = (row) => {
    const source = freshnessMarkSource(row.rawLine, D);
    return freshnessMarkModel({
      source,
      today: D,
      interval: DEFAULT_INTERVAL,
      status: freshnessTaskStatus(row.rawLine),
      resolution: freshnessMarkResolution(row, D, CFG),
    });
  };
  const agreed = freshnessMarkConsensus([modelFor(rottenA), modelFor(rottenB)]);
  assert.ok(agreed !== null, "C1 agrees");
  assert.equal(agreed.tone, "due");

  const nextB = sRow({
    line: 2,
    laneVisible: false,
    rawLine: "- [*] #task B [fresh:: 2026-10-01]",
  });
  assert.equal(
    freshnessMarkConsensus([modelFor(rottenA), modelFor(nextB)]),
    null,
    "C2 disagrees",
  );
  assert.equal(freshnessMarkConsensus([]), null, "C3 empty");
});

test("freshnessMarkResolution treats evaluator new as unresolved", () => {
  assert.equal(
    freshnessMarkResolution(sRow({ rawLine: "- [ ] #task T" }), D, CFG),
    null,
  );
  assert.equal(freshnessMarkResolution(null, D, CFG), null);
});

test("freshnessMarkSourceInText covers rendered fragments", () => {
  const bare = freshnessMarkSourceInText("Buy milk [fresh:: 2026-10-05]", D);
  assert.ok(bare !== null);
  assert.equal(bare.text, "[fresh:: 2026-10-05]");
  assert.equal(bare.fieldStart, "Buy milk ".length);
  const folded = freshnessMarkSourceInText(
    "Rename [fresh:: 2026-10-05] [refresh:: 14] done",
    D,
  );
  assert.equal(folded.text, "[fresh:: 2026-10-05] [refresh:: 14]");
  assert.equal(folded.refresh, 14);
  assert.equal(freshnessMarkSourceInText("Call mom (fresh:: 2026-10-05)", D), null);
  assert.equal(freshnessMarkSourceInText("T [fresh:: 2026-10-09]", D), null);
  assert.equal(
    freshnessMarkSourceInText(
      "A [fresh:: 2026-09-01] B [fresh:: 2026-09-20]",
      D,
    ),
    null,
  );
});

test("tone order: closed, then due, then age 0, then out of scope", () => {
  const closedDue = markModel("- [x] #task Old [fresh:: 2026-09-20]", {
    isTodo: false,
    laneVisible: false,
  });
  assert.equal(closedDue.tone, "resting", "closed beats rotten age");
  const due = markModel("- [ ] #task T [fresh:: 2026-10-01]");
  assert.equal(due.tone, "due");
  const openToday = markModel("- [ ] #task T [fresh:: 2026-10-08]");
  assert.equal(openToday.tone, "today");
  const resting = markModel("- [?] #task Later [fresh:: 2026-10-05]", {
    laneVisible: false,
  });
  assert.equal(resting.tone, "resting");
  assert.ok(resting.tooltip.includes("Not in the review queue: Blocked"));
});

test("no tooltip ever contains a double colon", () => {
  const lines = [
    "- [ ] #task Buy milk [fresh:: 2026-10-08] [created::2026-09-29]",
    "- [ ] #task T [fresh:: 2026-10-05]",
    "- [ ] #task T [fresh:: 2026-10-01]",
    "- [ ] #task Rename queue input [fresh:: 2026-10-05] [refresh:: 14] [created::2026-09-10] [priority:: low]",
    "- [ ] #task Week habits [fresh:: 2026-10-05] [scheduled:: 2026-10-07]",
    "- [*] #task Ship it [fresh:: 2026-09-20]",
    "- [x] #task Old [fresh:: 2026-10-08] [completion:: 2026-10-08]",
  ];
  for (const line of lines) {
    assert.ok(!markModel(line).tooltip.includes("::"), line);
  }
  assert.ok(
    !unresolvedModel("- [ ] #task T [fresh:: 2026-09-20]").tooltip.includes("::"),
  );
});

test("freshnessShortDate pins English names and the year rule", () => {
  assert.equal(freshnessShortDate("2026-10-01", D), "Thu, Oct 1");
  assert.equal(freshnessShortDate("2026-10-08", D), "Thu, Oct 8");
  assert.equal(
    freshnessShortDate("2025-12-30", D),
    "Tue, Dec 30, 2025",
  );
  assert.equal(freshnessShortDate("2026-13-01", D), null);
  assert.equal(freshnessShortDate(null, D), null);
});

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

test("DOM builder structure, attributes, and ring geometry", () => {
  const doc = makeFakeDoc();
  const aging = markModel("- [ ] #task T [fresh:: 2026-10-05]");
  const el = buildFreshnessMarkElement(doc, aging, { foldSpace: true });
  assert.equal(el.tag, "span");
  assert.equal(el.attrs.class, "bob-fresh-mark");
  assert.equal(el.attrs["data-tone"], "aging");
  assert.equal(el.attrs["data-resolved"], "true");
  assert.equal(el.attrs["data-fold-space"], "true");
  assert.equal(el.attrs.role, "img");
  assert.equal(el.attrs["aria-label"], aging.tooltip);
  assert.equal(el.attrs["data-tooltip-position"], "top");
  const [svg, label] = el.children;
  assert.equal(svg.attrs.class, "bob-fresh-mark-glyph");
  assert.equal(svg.attrs.viewBox, "0 0 16 16");
  assert.equal(svg.attrs["aria-hidden"], "true");
  const [track, arc] = svg.children;
  assert.equal(track.attrs.class, "bob-fresh-mark-track");
  assert.equal(track.attrs.cx, "8");
  assert.equal(track.attrs.r, "6");
  assert.equal(arc.attrs.class, "bob-fresh-mark-arc");
  assert.equal(arc.attrs.pathLength, "100");
  assert.equal(arc.attrs["stroke-dasharray"], "57.14 100");
  assert.equal(arc.attrs.transform, "rotate(-90 8 8)");
  assert.equal(label.attrs.class, "bob-fresh-mark-label");
  assert.equal(label.children[0].text, "3d");
  assert.equal(el.children.length, 2, "no interval span without a suffix");

  const folded = markModel(
    "- [ ] #task Rename queue input [fresh:: 2026-10-05] [refresh:: 14] [created::2026-09-10] [priority:: low]",
  );
  const foldedEl = buildFreshnessMarkElement(doc, folded, {
    foldSpace: true,
  });
  assert.equal(foldedEl.children.length, 3);
  const suffix = foldedEl.children[2];
  assert.equal(suffix.attrs.class, "bob-fresh-mark-interval");
  assert.equal(suffix.children[0].text, "/14d");

  const rotten = markModel("- [ ] #task T [fresh:: 2026-10-01]");
  const rottenEl = buildFreshnessMarkElement(doc, rotten, { foldSpace: true });
  assert.equal(rottenEl.children[0].children.length, 2, "refresh paths");
  assert.equal(
    rottenEl.children[0].children[0].attrs.d,
    "M14 8a6 6 0 1 1-6-6c1.68 0 3.29.67 4.49 1.83L14 5.33",
  );
  assert.equal(rottenEl.children[0].children[1].attrs.d, "M14 2v3.33h-3.33");

  const empty = markModel("- [ ] #task T [fresh:: 2026-10-01]");
  assert.equal(empty.remaining, 0);
  const emptyEl = buildFreshnessMarkElement(doc, empty, { foldSpace: true });
  assert.equal(
    emptyEl.children[0].children.length,
    2,
    "refresh glyph keeps both paths at remaining 0",
  );

  const today = markModel(
    "- [ ] #task Buy milk [fresh:: 2026-10-08] [created::2026-09-29]",
  );
  const todayEl = buildFreshnessMarkElement(doc, today, { foldSpace: true });
  const [todayTrack, tick] = todayEl.children[0].children;
  assert.equal(todayTrack.attrs.opacity, "1");
  assert.equal(tick.attrs.d, "M5.4 8.2l1.8 1.8 3.4-3.6");

  const ringEmpty = unresolvedModel("- [ ] #task T [fresh:: 2026-09-20]");
  const ringEl = buildFreshnessMarkElement(doc, ringEmpty, {
    foldSpace: false,
  });
  assert.equal(ringEl.attrs["data-resolved"], "false");
  assert.equal(ringEl.attrs["data-fold-space"], "false");
  assert.equal(ringEl.children[0].children.length, 1, "no arc at 0");
});

test("every mark helper is synchronous and never throws on bad input", () => {
  assert.equal(freshnessMarkSource(null, D), null);
  assert.equal(freshnessMarkSourceInText(null, D), null);
  assert.equal(freshnessMarkModel(null), null);
  assert.equal(freshnessMarkModel({}), null);
  assert.equal(freshnessMarkConsensus(null), null);
  assert.equal(buildFreshnessMarkElement(null, null), null);
  assert.equal(
    buildFreshnessMarkElement(makeFakeDoc(), { tone: "loud" }),
    null,
  );
});
// __FRESHNESS_MARK_TEST_END__
