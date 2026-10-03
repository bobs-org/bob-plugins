// Tests for the decay-planner phase (bob-cli-3v.4): the shared
// approved-decay action planner in bob-navigation-hotkeys. The planner composes
// the existing priority roll/decay helpers, refresh presets, and managed
// Schedule/Cancel Log insertion planners into one stable, previewed card model
// (no interaction, no writes). `docs/freshness.md` §2a and the epic plan's
// "Decision planner and card" section are authoritative.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const notices = [];

function parseTestYaml(text) {
  const result = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#") || /^\s/.test(line)) {
      continue;
    }
    const match = /^([^:]+):(.*)$/.exec(line);
    if (!match) {
      throw new Error("malformed yaml");
    }
    const key = match[1].trim();
    let value = match[2].trim().replace(/\s+#.*$/, "");
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value || null;
  }
  return result;
}

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    class EmptyClass {}
    class TestModal {
      constructor(app) {
        this.app = app;
        this.isOpen = false;
        this.modalEl = { removeClass: () => {} };
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
      parseYaml: parseTestYaml,
    };
  }
  if (request === "@codemirror/view") {
    return { EditorView: class EditorView {} };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const NavigationHotkeysPlugin = require("../plugins/bob-navigation-hotkeys/main.js");
const { helpers } = NavigationHotkeysPlugin;
Module._load = originalLoad;

const BASE_DATE = new Date(2026, 9, 8);
const ZERO_RANDOM = () => 0;

function buildDecayConfig(options = {}) {
  const levels = [
    { label: "P1", value: "high", min_days: 2, max_days: 7 },
    { label: "P2", value: "medium", min_days: 8, max_days: 30 },
    { label: "P3", value: "low", min_days: 31, max_days: 90 },
    { label: "P4", value: "lowest", min_days: 91, max_days: 365 },
  ];
  if (options.levelRolls) {
    for (const [label, rolls] of Object.entries(options.levelRolls)) {
      levels.find((level) => level.label === label).rolls = rolls;
    }
  }
  const entry = {
    name: "priority",
    values: "priority",
    schedules: "scheduled",
    levels: options.levels || levels,
  };
  if (Object.prototype.hasOwnProperty.call(options, "decay")) {
    entry.decay = options.decay;
  }
  return helpers.validateBulletPropertyConfig({
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

function planCard(overrides = {}) {
  return helpers.planFreshnessDecayCard({
    keeps: 3,
    intervalDays: 7,
    freshnessDecay: decayPolicy(),
    property: decayProperty(),
    baseDate: new Date(BASE_DATE.getTime()),
    random: ZERO_RANDOM,
    currentScheduled: "2026-10-01",
    ...overrides,
  });
}

test("P0 at interval 7 enters P2 with a previewed decay date and kept tail", () => {
  const card = planCard({ currentValue: "" });
  assert.equal(card.fromLabel, "P0");
  assert.equal(card.title, "Kept 3 reviews in a row");
  assert.ok(card.notNow.available);
  assert.equal(card.notNow.kind, "entry");
  assert.equal(card.notNow.levelLabel, "P2");
  // Zero random draws the window minimum: 8 days over 2026-10-08.
  assert.equal(card.notNow.offset, 8);
  assert.equal(card.notNow.date, "2026-10-16");
  assert.equal(
    card.notNow.reason,
    "🎲 P0 → P2 decay · in **8** (8–30) days · kept 3×",
  );
  assert.ok(card.notNow.scheduleLog);
  assert.equal(card.notNow.scheduleLog.to, "2026-10-16");
});

test("P0 at interval 30 enters P3", () => {
  const card = planCard({ currentValue: "", intervalDays: 30 });
  assert.ok(card.notNow.available);
  assert.equal(card.notNow.levelLabel, "P3");
  assert.equal(card.notNow.offset, 31);
  assert.equal(card.notNow.date, "2026-11-08");
  assert.equal(
    card.notNow.reason,
    "🎲 P0 → P3 decay · in **31** (31–90) days · kept 3×",
  );
});

test("fixed enter overrides the interval scan", () => {
  const card = planCard({
    currentValue: "",
    freshnessDecay: decayPolicy({ enter: "P1" }),
  });
  assert.ok(card.notNow.available);
  assert.equal(card.notNow.levelLabel, "P1");
  assert.equal(
    card.notNow.reason,
    "🎲 P0 → P1 decay · in **2** (2–7) days · kept 3×",
  );
});

test("unknown enter disables Not now without disabling Keep/Reword", () => {
  const card = planCard({
    currentValue: "",
    freshnessDecay: decayPolicy({ enter: "P9" }),
  });
  assert.equal(card.notNow.available, false);
  assert.match(card.notNow.unavailableReason, /unknown enter level/);
  assert.ok(card.keep.available);
  assert.ok(card.reword.available);
  assert.ok(card.drop.available);
});

test("P0 with no suitable level stays unavailable and never shortens the lease", () => {
  const card = planCard({ currentValue: "", intervalDays: 365 });
  assert.equal(card.notNow.available, false);
  assert.match(card.notNow.unavailableReason, /no level stays out longer/);
  // The planner must not secretly pick the last level or cancel.
  assert.doesNotMatch(card.notNow.unavailableReason, /P4/);
});

test("custom level order resolves entry in ladder order", () => {
  const property = decayProperty({
    levels: [
      { label: "P9", value: "nine", min_days: 50, max_days: 60 },
      { label: "P1", value: "high", min_days: 2, max_days: 7 },
      { label: "P2", value: "medium", min_days: 8, max_days: 30 },
    ],
  });
  const card = planCard({ property, currentValue: "" });
  assert.ok(card.notNow.available);
  // P9 comes first in ladder order and its minimum exceeds the 7-day interval.
  assert.equal(card.notNow.levelLabel, "P9");
});

test("unknown priority value disables Not now only", () => {
  const card = planCard({ currentValue: "bogus" });
  assert.equal(card.notNow.available, false);
  assert.match(card.notNow.unavailableReason, /unknown priority/);
  assert.ok(card.keep.available);
  assert.ok(card.reword.available);
  assert.equal(card.levels.length, 4);
});

test("prioritized P2 below its roll limit stays on the same level", () => {
  const card = planCard({ currentValue: "medium", streak: 0 });
  assert.ok(card.notNow.available);
  assert.equal(card.notNow.kind, "roll");
  assert.equal(card.notNow.levelLabel, "P2");
  assert.match(card.notNow.reason, /🎲 P2 roll · /);
  assert.match(card.notNow.reason, / · kept 3×$/);
});

test("P2 at its roll limit decays to P3", () => {
  const card = planCard({ currentValue: "medium", streak: 1 });
  assert.ok(card.notNow.available);
  assert.equal(card.notNow.kind, "decay");
  assert.equal(card.notNow.levelLabel, "P3");
  assert.match(card.notNow.reason, /🎲 P2 → P3 decay · /);
  assert.match(card.notNow.reason, / · kept 3×$/);
});

function contentWithLog(reasons) {
  const lines = [
    "- [ ] #task Rolled task [priority:: medium] [scheduled:: 2026-10-01]",
    "\t- 🗓️ **SCHEDULE LOG**",
  ];
  for (const reason of reasons) {
    lines.push(`\t\t- *2026-10-01* — ${reason}`);
  }
  return lines.join("\n");
}

test("P2 streak derives from the task Schedule Log", () => {
  const fresh = contentWithLog([]);
  const rolled = planCard({
    content: fresh,
    taskLine: 0,
    currentScheduled: "2026-10-01",
  });
  // No log and no explicit current value: the raw line carries P2, streak 0.
  assert.equal(rolled.notNow.kind, "roll");

  const streaked = contentWithLog(["🎲 P2 roll · in **17** (8–30) days"]);
  const decayed = planCard({
    content: streaked,
    taskLine: 0,
    currentScheduled: "2026-10-01",
  });
  assert.equal(decayed.notNow.kind, "decay");
  assert.equal(decayed.notNow.levelLabel, "P3");
});

test("configured decay:false keeps rolling past the limit", () => {
  const property = decayProperty({ decay: false });
  const card = planCard({
    property,
    currentValue: "medium",
    streak: 5,
  });
  assert.ok(card.notNow.available);
  assert.equal(card.notNow.kind, "roll");
  assert.equal(card.notNow.levelLabel, "P2");
});

test("per-level rolls:0 decays immediately", () => {
  const property = decayProperty({ levelRolls: { P2: 0 } });
  const card = planCard({
    property,
    currentValue: "medium",
    streak: 0,
  });
  assert.ok(card.notNow.available);
  assert.equal(card.notNow.kind, "decay");
});

test("terminal cancel substitutes a truthful same-level card roll", () => {
  const card = planCard({ currentValue: "lowest", streak: 9 });
  assert.ok(card.notNow.available);
  assert.equal(card.notNow.kind, "card-roll");
  assert.equal(card.notNow.substitutedFor, "cancel");
  assert.equal(card.notNow.terminalWouldCancel, true);
  assert.equal(card.notNow.levelLabel, "P4");
  // The substituted reason is a same-level roll with the kept tail: it must
  // not claim the terminal cancellation.
  assert.match(card.notNow.reason, /🎲 P4 roll · /);
  assert.match(card.notNow.reason, / · kept 3×$/);
  assert.doesNotMatch(card.notNow.reason, /decayed past/);
});

test("no future date in the window refuses Not now", () => {
  const property = decayProperty({
    levels: [{ label: "P0x", value: "zero", min_days: 0, max_days: 0 }],
  });
  const card = planCard({
    property,
    currentValue: "",
    intervalDays: 7,
    freshnessDecay: decayPolicy({ enter: "P0x" }),
  });
  assert.equal(card.notNow.available, false);
  assert.match(card.notNow.unavailableReason, /no future date/);
});

test("Less often steps 7/14/30 to the next preset with a decision reason", () => {
  for (const [before, after] of [[7, 14], [14, 30], [30, 90]]) {
    const card = planCard({ intervalDays: before });
    assert.ok(card.lessOften.available);
    assert.equal(card.lessOften.mode, "refresh");
    assert.equal(card.lessOften.beforeDays, before);
    assert.equal(card.lessOften.afterDays, after);
    assert.equal(
      card.lessOften.reason,
      `🎲 less often · every ${before} → ${after} days · kept 3×`,
    );
  }
});

test("Less often at 90+ opens the constrained custom picker; 365 is unavailable", () => {
  const picker = planCard({ intervalDays: 90 });
  assert.ok(picker.lessOften.available);
  assert.equal(picker.lessOften.mode, "picker");
  assert.equal(picker.lessOften.beforeDays, 90);
  assert.equal(picker.lessOften.minDays, 91);
  assert.equal(picker.lessOften.maxDays, 365);

  const top = planCard({ intervalDays: 365 });
  assert.equal(top.lessOften.available, false);
  assert.equal(top.lessOften.mode, "unavailable");
});

test("previewed dates are stable for one random draw", () => {
  const first = planCard({});
  const second = planCard({});
  assert.equal(first.notNow.date, second.notNow.date);
  assert.equal(first.notNow.reason, second.notNow.reason);
  assert.equal(first.levels[1].date, second.levels[1].date);
});

test("Keep saturates at 999 and Drop preserves keeps history", () => {
  const card = planCard({ keeps: 3 });
  assert.equal(card.keep.nextKeeps, 4);
  assert.equal(card.drop.reason, "🍂 dropped after 3 keeps");

  const saturated = planCard({ keeps: 999 });
  assert.equal(saturated.keep.nextKeeps, 999);
  assert.equal(saturated.drop.reason, "🍂 dropped after 999 keeps");

  const singular = planCard({ keeps: 1 });
  assert.equal(singular.title, "Kept 1 review in a row");
  assert.equal(singular.drop.reason, "🍂 dropped after 1 keep");
});

test("kept tails preserve roll classification; decisions break it deliberately", () => {
  const card = planCard({ currentValue: "medium", streak: 1 });
  const decayKind = helpers.classifyScheduleLogRollReason(card.notNow.reason);
  assert.equal(decayKind.kind, "decay");

  const rolled = planCard({ currentValue: "medium", streak: 0 });
  assert.equal(
    helpers.classifyScheduleLogRollReason(rolled.notNow.reason).kind,
    "roll",
  );

  assert.equal(
    helpers.classifyScheduleLogRollReason(card.lessOften.reason).kind,
    "other",
  );
  assert.equal(
    helpers.classifyScheduleLogRollReason(card.reword.reason).kind,
    "other",
  );
  assert.equal(
    card.reword.reason,
    "🎲 reword · kept 3×",
  );
  // The explicit decisions still plan Schedule Log entries without
  // fabricating a scheduled date change.
  const logged = planCard({
    content: "- [ ] #task Tidy inbox [priority:: medium]",
    taskLine: 0,
    currentScheduled: "2026-10-01",
  });
  assert.ok(logged.reword.scheduleLogPlan);
  assert.equal(logged.reword.scheduleLogPlan.valid, true);
  assert.ok(logged.lessOften.scheduleLogPlan);
  assert.equal(logged.lessOften.scheduleLogPlan.valid, true);
  assert.ok(logged.drop.cancelLogPlan);
  assert.equal(logged.drop.cancelLogPlan.valid, true);
});

test("invalid priority config offers no priority-changing action", () => {
  const card = planCard({ freshnessDecay: { enabled: true, keeps: 3, enter: null, invalid: true } });
  assert.equal(card.notNow.available, false);
  assert.match(card.notNow.unavailableReason, /invalid/);
  for (const pick of card.levels) {
    assert.equal(pick.available, false);
  }
  assert.ok(card.keep.available);
  assert.ok(card.reword.available);
  assert.ok(card.drop.available);
});

test("decay off disables Not now but keeps counting", () => {
  const card = planCard({ freshnessDecay: decayPolicy({ enabled: false }) });
  assert.equal(card.notNow.available, false);
  assert.match(card.notNow.unavailableReason, /decay is off/);
  assert.ok(card.keep.available);
  assert.equal(card.keep.nextKeeps, 4);
});

test("explicit level picks cover the ladder with previewed rolls", () => {
  const card = planCard({ currentValue: "" });
  assert.equal(card.levels.length, 4);
  const labels = card.levels.map((pick) => pick.label);
  assert.deepEqual(labels, ["P1", "P2", "P3", "P4"]);
  for (const pick of card.levels) {
    assert.ok(pick.available);
    assert.match(pick.reason, / · kept 3×$/);
  }
  assert.equal(card.levels[0].date, "2026-10-10");
});

test("card model is deeply frozen", () => {
  const card = planCard({});
  assert.ok(Object.isFrozen(card));
  assert.ok(Object.isFrozen(card.notNow));
  assert.ok(Object.isFrozen(card.lessOften));
  assert.ok(Object.isFrozen(card.levels));
});
