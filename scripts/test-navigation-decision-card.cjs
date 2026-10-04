// Tests for the decision-card phase (bob-cli-3v.5) on the nav side: the
// date-free availability guard, the trigger/skip partition, the card
// rows, the modal interaction (Esc writes nothing, repeats/bubbles/
// double-callbacks cannot approve twice), and the capability lifecycle.
// `docs/freshness.md` §2a and the epic plan's "Decision planner and
// card" section are authoritative.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const notices = [];

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    class EmptyClass {}
    class TestModal {
      constructor(app) {
        this.app = app;
        this.isOpen = false;
        this.modalEl = { addClass: () => {} };
        this.contentEl = { empty: () => {} };
      }
      open() {
        this.isOpen = true;
        return this;
      }
      close() {
        if (!this.isOpen) {
          return this;
        }
        this.isOpen = false;
        if (typeof this.onClose === "function") {
          this.onClose();
        }
        return this;
      }
    }
    class TestNotice {
      constructor(message) {
        notices.push(String(message));
      }
    }
    return {
      MarkdownView: EmptyClass,
      Modal: TestModal,
      Notice: TestNotice,
      Plugin: EmptyClass,
      parseYaml: (text) => JSON.parse(text),
    };
  }
  if (request === "@codemirror/state") {
    return { Prec: { highest: (value) => value } };
  }
  if (request === "@codemirror/view") {
    return { EditorView: class EditorView {} };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const NavigationHotkeysPlugin = require("../plugins/bob-navigation-hotkeys/main.js");
const { helpers } = NavigationHotkeysPlugin;
Module._load = originalLoad;

const {
  buildFreshnessDecayCardRows,
  createDependencyNavApi,
  findFreshnessDecayPriorityProperty,
  formatFreshnessDecayCapturedAge,
  formatFreshStampSkippedNotice,
  formatFreshStampSkipTail,
  freshnessDecayCardActive,
  freshnessDecayRewordCursorCh,
  FreshnessDecayCardModal,
  FRESHNESS_DECAY_CARD_VERSION,
  isFreshnessDecayDecisionEntry,
  partitionFreshStampDecisionSkips,
  planFreshnessDecayCard,
  validateBulletPropertyConfig,
} = helpers;

// --- Availability guard ---

test("availability: decay on (or absent) may ask; decay off never asks", () => {
  assert.equal(freshnessDecayCardActive({ enabled: true }), true);
  assert.equal(freshnessDecayCardActive({ enabled: false }), false);
  assert.equal(freshnessDecayCardActive(null), true);
  assert.equal(freshnessDecayCardActive(undefined), true);
  assert.equal(freshnessDecayCardActive({}), true);
});

// --- Trigger entries ---

test("trigger: only an explicit decide row decides", () => {
  assert.equal(isFreshnessDecayDecisionEntry({ decide: true }), true);
  assert.equal(isFreshnessDecayDecisionEntry({ decide: false }), false);
  assert.equal(isFreshnessDecayDecisionEntry({}), false);
  assert.equal(isFreshnessDecayDecisionEntry(null), false);
  assert.equal(isFreshnessDecayDecisionEntry({ decide: 1 }), false);
});

// --- Skip partition ---

function resolvedTarget(target, match) {
  return { target, match };
}

function okMatch(entry) {
  return { ok: true, entry, reason: "ok" };
}

test("partition: exact at-limit rows skip, everything else stamps", () => {
  const stampTarget = { line: 0, path: "a.md", raw: "x", counted: false };
  const skipTarget = { line: 1, path: "a.md", raw: "y", counted: true };
  const belowTarget = { line: 2, path: "a.md", raw: "z", counted: true };
  const part = partitionFreshStampDecisionSkips([
    resolvedTarget(skipTarget, okMatch({ decide: true })),
    resolvedTarget(stampTarget, { ok: false, entry: null, reason: "tier" }),
    resolvedTarget(belowTarget, okMatch({ decide: false })),
  ]);
  assert.deepEqual(part.skipped, [skipTarget]);
  assert.deepEqual(part.stamp, [stampTarget, belowTarget]);
});

test("partition: empty and malformed input stamps nothing and skips nothing", () => {
  assert.deepEqual(partitionFreshStampDecisionSkips([]), {
    stamp: [],
    skipped: [],
  });
  assert.deepEqual(partitionFreshStampDecisionSkips(null), {
    stamp: [],
    skipped: [],
  });
});

test("partition: enabled false stamps decision rows (older namespace fallback)", () => {
  const skipTarget = { line: 1, path: "a.md", raw: "y", counted: true };
  const stampTarget = { line: 0, path: "a.md", raw: "x", counted: false };
  const part = partitionFreshStampDecisionSkips(
    [
      resolvedTarget(skipTarget, okMatch({ decide: true })),
      resolvedTarget(stampTarget, { ok: false, entry: null, reason: "tier" }),
    ],
    { enabled: false },
  );
  assert.deepEqual(part.skipped, []);
  assert.deepEqual(part.stamp, [skipTarget, stampTarget]);
});

test("skip wording: singular, plural, and all-skipped notices", () => {
  assert.equal(formatFreshStampSkipTail(0), "");
  assert.equal(formatFreshStampSkipTail(1), " · 1 needs a decision");
  assert.equal(formatFreshStampSkipTail(3), " · 3 need a decision");
  assert.equal(
    formatFreshStampSkippedNotice(1),
    "1 task needs a decision · the review walk reaches it later",
  );
  assert.equal(
    formatFreshStampSkippedNotice(2),
    "2 tasks need a decision · the review walk reaches it later",
  );
});

// --- Reword cursor ---

test("reword cursor: lands at the end of the task body before metadata", () => {
  const line =
    "- [ ] #task Rename queue input [fresh:: 2026-10-20] [created:: 2026-09-12] ^rq";
  assert.equal(
    freshnessDecayRewordCursorCh(line),
    line.indexOf(" [fresh::"),
  );
  const tagged = "- [ ] #task Buy milk #errand";
  assert.equal(freshnessDecayRewordCursorCh(tagged), tagged.indexOf(" #errand"));
  const plain = "- [ ] #task Buy milk";
  assert.equal(freshnessDecayRewordCursorCh(plain), plain.length);
});

// --- Captured age ---

test("captured age: optional context ages, null when created is missing", () => {
  assert.equal(
    formatFreshnessDecayCapturedAge("2026-09-12", "2026-10-24"),
    "captured 6 weeks ago",
  );
  assert.equal(
    formatFreshnessDecayCapturedAge("2026-10-24", "2026-10-24"),
    "captured today",
  );
  assert.equal(
    formatFreshnessDecayCapturedAge("2026-10-23", "2026-10-24"),
    "captured yesterday",
  );
  assert.equal(formatFreshnessDecayCapturedAge("", "2026-10-24"), null);
  assert.equal(formatFreshnessDecayCapturedAge("soon", "2026-10-24"), null);
});

// --- Card rows ---

function buildDecayConfig(options = {}) {
  const levels = [
    { label: "P1", value: "high", min_days: 2, max_days: 7 },
    { label: "P2", value: "medium", min_days: 8, max_days: 30 },
    { label: "P3", value: "low", min_days: 31, max_days: 90 },
    { label: "P4", value: "lowest", min_days: 91, max_days: 365 },
  ];
  const entry = {
    name: "priority",
    values: "priority",
    schedules: "scheduled",
    levels: options.levels || levels,
  };
  if (Object.prototype.hasOwnProperty.call(options, "decay")) {
    entry.decay = options.decay;
  }
  return validateBulletPropertyConfig({
    properties: [{ name: "scheduled", values: "date" }, entry],
  });
}

function decayProperty(options = {}) {
  const config = buildDecayConfig(options);
  assert.ok(config);
  return config.properties.find((item) => item.name === "priority");
}

function decayPolicy(overrides = {}) {
  return { enabled: true, keeps: 3, enter: null, ...overrides };
}

test("rows: P0 entry shows the recommended Not now with a clean window", () => {
  const card = planFreshnessDecayCard({
    keeps: 3,
    intervalDays: 7,
    freshnessDecay: decayPolicy(),
    property: decayProperty(),
    baseDate: new Date(2026, 9, 20),
    random: () => 0,
    currentScheduled: "2026-10-01",
  });
  const rows = buildFreshnessDecayCardRows(card);
  const notNow = rows.find((row) => row.action === "notNow");
  assert.equal(notNow.key, "Enter");
  assert.equal(notNow.available, true);
  assert.equal(notNow.recommended, true);
  assert.ok(notNow.detail.startsWith("P0 → P2 · back in 8 days (8–30)"));
  assert.ok(!notNow.detail.includes("**"));
  assert.ok(!notNow.detail.includes("**"));
  const keep = rows.find((row) => row.action === "keep");
  assert.equal(keep.detail, "still right · asks again next review");
  const drop = rows.find((row) => row.action === "drop");
  assert.equal(drop.detail, "cancel · dropped after 3 keeps");
  const reword = rows.find((row) => row.action === "reword");
  assert.equal(reword.detail, "edit the task · start the count over");
  const lessOften = rows.find((row) => row.action === "lessOften");
  assert.equal(lessOften.detail, "review every 14 days instead of 7");
  const picks = rows.filter((row) => row.action.startsWith("level:"));
  assert.equal(picks.length, 4);
  assert.deepEqual(
    picks.map((row) => row.key),
    ["1", "2", "3", "4"],
  );
});

test("rows: invalid priority config disables Not now and levels, keeps safe rows", () => {
  const card = planFreshnessDecayCard({
    keeps: 3,
    intervalDays: 7,
    freshnessDecay: { ...decayPolicy(), invalid: true },
    property: decayProperty(),
    baseDate: new Date(2026, 9, 20),
    random: () => 0,
    currentScheduled: "2026-10-01",
  });
  const rows = buildFreshnessDecayCardRows(card);
  const notNow = rows.find((row) => row.action === "notNow");
  assert.equal(notNow.available, false);
  assert.ok(notNow.detail.includes("priority config is invalid"));
  for (const row of rows.filter((item) => item.action.startsWith("level:"))) {
    assert.equal(row.available, false);
  }
  for (const action of ["lessOften", "reword", "drop", "keep"]) {
    assert.equal(
      rows.find((row) => row.action === action).available,
      true,
      action,
    );
  }
});

test("rows: picker-mode Less often and 365-day cap", () => {
  const pickerCard = planFreshnessDecayCard({
    keeps: 3,
    intervalDays: 90,
    freshnessDecay: decayPolicy(),
    property: decayProperty(),
    baseDate: new Date(2026, 9, 20),
    random: () => 0,
    currentScheduled: "2026-10-01",
  });
  const pickerRow = buildFreshnessDecayCardRows(pickerCard).find(
    (row) => row.action === "lessOften",
  );
  assert.equal(pickerRow.available, true);
  assert.ok(pickerRow.detail.includes("choose every"));
  const cappedCard = planFreshnessDecayCard({
    keeps: 3,
    intervalDays: 365,
    freshnessDecay: decayPolicy(),
    property: decayProperty(),
    baseDate: new Date(2026, 9, 20),
    random: () => 0,
    currentScheduled: "2026-10-01",
  });
  const cappedRow = buildFreshnessDecayCardRows(cappedCard).find(
    (row) => row.action === "lessOften",
  );
  assert.equal(cappedRow.available, false);
  assert.ok(cappedRow.detail.includes("365"));
});

test("rows: terminal ladder keeps Enter available and never cancels", () => {
  const card = planFreshnessDecayCard({
    keeps: 3,
    intervalDays: 7,
    freshnessDecay: decayPolicy(),
    property: decayProperty(),
    baseDate: new Date(2026, 9, 20),
    random: () => 0,
    currentScheduled: "2026-10-01",
    currentValue: "lowest",
    streak: 9,
  });
  assert.equal(card.notNow.kind, "card-roll");
  const rows = buildFreshnessDecayCardRows(card);
  const notNow = rows.find((row) => row.action === "notNow");
  assert.equal(notNow.available, true);
  assert.ok(notNow.detail.includes("P4"));
});

// --- Modal interaction ---

function testRows() {
  return [
    { key: "Enter", action: "notNow", label: "Not now", detail: "P0 → P2", available: true, unavailableReason: null, recommended: true },
    { key: "L", action: "lessOften", label: "Less often", detail: "longer", available: true, unavailableReason: null, recommended: false },
    { key: "E", action: "reword", label: "Reword", detail: "edit", available: true, unavailableReason: null, recommended: false },
    { key: "D", action: "drop", label: "Drop", detail: "cancel", available: true, unavailableReason: null, recommended: false },
    { key: "Alt+F", action: "keep", label: "Keep", detail: "still right", available: true, unavailableReason: null, recommended: false },
  ];
}

function openTestCard(overrides = {}) {
  const chosen = [];
  let dismissed = 0;
  const modal = new FreshnessDecayCardModal(null, {
    title: "Kept 3 reviews in a row",
    subtitle: "Rename queue input · a.md",
    rows: overrides.rows || testRows(),
    onChoose: (action) => chosen.push(action),
    onDismiss: () => {
      dismissed += 1;
    },
  });
  modal.open();
  return { modal, chosen, dismissed: () => dismissed };
}

function fakeKey(overrides = {}) {
  return {
    key: "",
    code: "",
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    preventDefault: () => {},
    stopPropagation: () => {},
    ...overrides,
  };
}

test("modal: Enter approves once; later keys cannot approve again", () => {
  const { modal, chosen } = openTestCard();
  modal.handleKey(fakeKey({ key: "Enter" }));
  assert.deepEqual(chosen, ["notNow"]);
  assert.equal(modal.settled, true);
  modal.handleKey(fakeKey({ key: "Enter" }));
  modal.handleKey(fakeKey({ key: "d" }));
  assert.deepEqual(chosen, ["notNow"]);
});

test("modal: letter keys, Alt+F, Ctrl+Alt+F, and 1-4 activate the same actions as click", () => {
  for (const [keyEvent, action] of [
    [fakeKey({ key: "l" }), "lessOften"],
    [fakeKey({ key: "E" }), "reword"],
    [fakeKey({ key: "d" }), "drop"],
    [fakeKey({ key: "x" }), "drop"],
    [fakeKey({ key: "f", code: "KeyF", altKey: true }), "keep"],
    [fakeKey({ key: "f", code: "KeyF", altKey: true, ctrlKey: true }), "keep"],
  ]) {
    const opened = openTestCard();
    opened.modal.handleKey(keyEvent);
    assert.deepEqual(opened.chosen, [action]);
  }
  const levels = openTestCard({
    rows: [
      ...testRows(),
      { key: "1", action: "level:0", label: "P1", detail: "back", available: true, unavailableReason: null, recommended: false },
    ],
  });
  levels.modal.handleKey(fakeKey({ key: "1" }));
  assert.deepEqual(levels.chosen, ["level:0"]);
  const beyond = openTestCard();
  beyond.modal.handleKey(fakeKey({ key: "5" }));
  assert.deepEqual(beyond.chosen, []);
  assert.equal(beyond.modal.settled, false);
});

test("modal: key repeat and modified keys never approve", () => {
  const repeated = openTestCard();
  repeated.modal.handleKey(fakeKey({ key: "Enter", repeat: true }));
  repeated.modal.handleKey(
    fakeKey({ key: "f", code: "KeyF", altKey: true, repeat: true }),
  );
  repeated.modal.handleKey(
    fakeKey({
      key: "f",
      code: "KeyF",
      altKey: true,
      ctrlKey: true,
      repeat: true,
    }),
  );
  repeated.modal.handleKey(fakeKey({ key: "l", repeat: true }));
  repeated.modal.handleKey(fakeKey({ key: "l", ctrlKey: true }));
  // Retired Alt+Shift+F and extra-modifier F chords stay unconsumed.
  repeated.modal.handleKey(
    fakeKey({ key: "F", code: "KeyF", altKey: true, shiftKey: true }),
  );
  repeated.modal.handleKey(
    fakeKey({
      key: "F",
      code: "KeyF",
      altKey: true,
      ctrlKey: true,
      shiftKey: true,
    }),
  );
  repeated.modal.handleKey(
    fakeKey({ key: "f", code: "KeyF", altKey: true, metaKey: true }),
  );
  assert.deepEqual(repeated.chosen, []);
  assert.equal(repeated.modal.settled, false);
  assert.equal(repeated.modal.isOpen, true);
});

test("modal: Esc changes nothing — dismiss without a choice", () => {
  const { modal, chosen, dismissed } = openTestCard();
  modal.handleKey(fakeKey({ key: "Escape" }));
  assert.deepEqual(chosen, []);
  assert.equal(dismissed(), 1);
  assert.equal(modal.isOpen, false);
});

test("modal: unavailable actions cannot be chosen", () => {
  const rows = testRows().map((row) =>
    row.action === "notNow"
      ? { ...row, available: false, unavailableReason: "no future date" }
      : row,
  );
  const { modal, chosen } = openTestCard({ rows });
  modal.choose("notNow");
  assert.deepEqual(chosen, []);
  assert.equal(modal.settled, false);
  modal.choose("keep");
  assert.deepEqual(chosen, ["keep"]);
});

test("modal: a double callback applies once", () => {
  const { modal, chosen } = openTestCard();
  modal.choose("drop");
  modal.choose("drop");
  assert.deepEqual(chosen, ["drop"]);
});

// --- Capability lifecycle ---

test("capability: the nav api exposes the card while loaded", () => {
  const api = createDependencyNavApi({});
  assert.equal(api.version, 1);
  assert.equal(api.freshnessDecayCard.version, FRESHNESS_DECAY_CARD_VERSION);
  assert.ok(FRESHNESS_DECAY_CARD_VERSION >= 2);
});

test("capability: unload drops the card so marks stop promising it", () => {
  const api = createDependencyNavApi(null);
  assert.equal(api.version, 1);
  assert.equal(api.freshnessDecayCard, undefined);
});

test("ladder lookup: the first priority property wins, null without one", () => {
  const config = buildDecayConfig();
  const property = findFreshnessDecayPriorityProperty(config);
  assert.equal(property.name, "priority");
  assert.equal(findFreshnessDecayPriorityProperty(null), null);
  assert.equal(findFreshnessDecayPriorityProperty({ properties: [] }), null);
});
