const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const notices = [];

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    class EmptyClass {}
    class TestNotice {
      constructor(message) {
        notices.push(String(message));
      }
    }
    return {
      MarkdownView: EmptyClass,
      Modal: EmptyClass,
      Notice: TestNotice,
      Plugin: EmptyClass,
      parseYaml: (text) => {
        throw new Error(`unexpected parseYaml in ${text}`);
      },
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
    levels,
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

// A task note whose Schedule Log holds the given newest-first reasons.
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

test("decay config defaults to enabled with one roll per level", () => {
  for (const decay of [undefined, true, {}]) {
    const entry = {
      name: "priority",
      values: "priority",
      schedules: "scheduled",
      levels: [{ label: "P1", value: "high", min_days: 2, max_days: 7 }],
    };
    if (decay !== undefined) {
      entry.decay = decay;
    }
    const config = helpers.validateBulletPropertyConfig({
      properties: [{ name: "scheduled", values: "date" }, entry],
    });
    assert.ok(config);
    assert.deepEqual(config.properties[1].decay, {
      enabled: true,
      rolls: 1,
    });
    assert.equal(
      helpers.normalizePriorityDecayConfig("priority", decay, {}).rolls,
      1,
    );
  }
  assert.equal(helpers.DEFAULT_PRIORITY_DECAY_ROLLS, 1);
});

test("decay:false disables decay and level rolls are accepted but ignored", () => {
  const property = decayProperty({ decay: false });
  assert.deepEqual(property.decay, { enabled: false, rolls: null });
  assert.equal(
    helpers.getPriorityLevelRollLimit(property, property.levels[1]),
    null,
  );
  const withLevelRolls = decayProperty({
    decay: false,
    levelRolls: { P2: 3 },
  });
  assert.equal(withLevelRolls.levels[1].rolls, 3);
  assert.equal(
    helpers.getPriorityLevelRollLimit(withLevelRolls, withLevelRolls.levels[1]),
    null,
  );
});

test("decay.rolls sets the limit and levels[].rolls overrides it", () => {
  const property = decayProperty({ decay: { rolls: 3 } });
  assert.deepEqual(property.decay, { enabled: true, rolls: 3 });
  assert.equal(
    helpers.getPriorityLevelRollLimit(property, property.levels[1]),
    3,
  );
  const overridden = decayProperty({
    decay: { rolls: 3 },
    levelRolls: { P2: 0 },
  });
  assert.equal(overridden.levels[1].rolls, 0);
  assert.equal(
    helpers.getPriorityLevelRollLimit(overridden, overridden.levels[1]),
    0,
  );
  assert.equal(
    helpers.getPriorityLevelRollLimit(overridden, overridden.levels[0]),
    3,
  );
  assert.equal(Object.isFrozen(property.decay), true);
  assert.equal(Object.isFrozen(property.levels[1]), true);
});

test("decay config rejects bad rolls, unknown keys and non-priority use", () => {
  const cases = [
    {
      name: "negative decay rolls",
      entry: { decay: { rolls: -1 } },
      message: /decay rolls must be a non-negative integer/,
    },
    {
      name: "fractional decay rolls",
      entry: { decay: { rolls: 1.5 } },
      message: /decay rolls must be a non-negative integer/,
    },
    {
      name: "string decay rolls",
      entry: { decay: { rolls: "3" } },
      message: /decay rolls must be a non-negative integer/,
    },
    {
      name: "unknown decay key names the key",
      entry: { decay: { roll: 3 } },
      message: /unknown key "roll"/,
    },
    {
      name: "negative level rolls",
      levels: [{ label: "P2", value: "medium", min_days: 8, max_days: 30, rolls: -1 }],
      message: /level #1 rolls must be a non-negative integer/,
    },
  ];
  for (const testCase of cases) {
    const messages = [];
    const levels = testCase.levels || [
      { label: "P2", value: "medium", min_days: 8, max_days: 30 },
    ];
    const entry = {
      name: "priority",
      values: "priority",
      schedules: "scheduled",
      levels,
      ...testCase.entry,
    };
    const result = helpers.validateBulletPropertyConfig(
      { properties: [{ name: "scheduled", values: "date" }, entry] },
      { showNotice: (message) => messages.push(message) },
    );
    assert.equal(result, null, testCase.name);
    assert.equal(messages.length, 1, testCase.name);
    assert.match(messages[0], testCase.message, testCase.name);
  }

  for (const extra of [{ decay: false }, { rolls: 2 }]) {
    const messages = [];
    const result = helpers.validateBulletPropertyConfig(
      { properties: [{ name: "note", values: ["plain"], ...extra }] },
      { showNotice: (message) => messages.push(message) },
    );
    assert.equal(result, null, JSON.stringify(extra));
    assert.equal(messages.length, 1, JSON.stringify(extra));
    assert.match(messages[0], /only valid when values is "priority"/);
  }
});

test("classifyScheduleLogRollReason sorts automatic heads from deliberate ones", () => {
  const kinds = (reasons) =>
    reasons.map((reason) => helpers.classifyScheduleLogRollReason(reason).kind);
  assert.deepEqual(
    kinds([
      "🎲 P2 roll · in **17** (8–30) days",
      "🎲 P2 roll · random in 8–30 days",
      "🎲 P2 roll",
    ]),
    ["roll", "roll", "roll"],
  );
  assert.deepEqual(
    kinds([
      "🎲 P2 randomize · in **9** (8–30) days",
      "🎲 P2 randomize from 2026-09-01 · in **9** (8–30) days",
    ]),
    ["randomize", "randomize"],
  );
  assert.equal(
    helpers.classifyScheduleLogRollReason("🎲 P2 → P3 decay · in **45** (31–90) days").kind,
    "decay",
  );
  assert.deepEqual(
    kinds([
      "🎲 P1 → P2 · in **9** (8–30) days",
      "🎲 P2 · in **12** (8–30) days",
      "🎲 P1 roll · in **5** (2–7) days",
      "waiting on the API review",
      "🤷 no reason given",
      "🔓 unblocked by hand",
      "not a log entry at all",
      "",
      null,
    ]),
    ["other", "other", "roll", "other", "other", "other", "other", "other", "other"],
  );
  // A same-level check happens in the streak reader: P1 rolls do not count at P2.
  assert.equal(
    helpers.classifyScheduleLogRollReason("🎲 P1 roll · in **5** (2–7) days").label,
    "P1",
  );
  const decay = helpers.classifyScheduleLogRollReason(
    "🎲 P2 → P3 decay · in **45** (31–90) days",
  );
  assert.deepEqual({ from: decay.from, to: decay.to }, { from: "P2", to: "P3" });
  assert.equal(Object.isFrozen(decay), true);
});

test("conformance vectors 1-10: streaks at P2 with the default limit", () => {
  const vectors = [
    { reasons: [], streak: 0 },
    { reasons: ["🎲 P1 → P2 · in **9** (8–30) days"], streak: 0 },
    {
      reasons: ["🎲 P2 roll · in **17** (8–30) days", "🎲 P1 → P2 · in **9** (8–30) days"],
      streak: 1,
    },
    {
      reasons: [
        "🎲 P2 randomize · in **9** (8–30) days",
        "🎲 P2 roll · in **17** (8–30) days",
      ],
      streak: 1,
    },
    {
      reasons: ["waiting on the API review", "🎲 P2 roll · in **17** (8–30) days"],
      streak: 0,
    },
    {
      reasons: ["🤷 no reason given", "🎲 P2 roll · in **17** (8–30) days"],
      streak: 0,
    },
    {
      reasons: [
        "🎲 P2 · in **12** (8–30) days",
        "🎲 P2 roll · in **17** (8–30) days",
      ],
      streak: 0,
    },
    { reasons: ["🎲 P1 roll · in **5** (2–7) days"], streak: 0 },
    { reasons: ["🎲 P2 roll · random in 8–30 days"], streak: 1 },
  ];
  for (const [index, vector] of vectors.entries()) {
    assert.equal(
      helpers.countPriorityRollStreak(vector.reasons, "P2"),
      vector.streak,
      `vector ${index + 1}`,
    );
    assert.equal(
      helpers.getPriorityRollStreak(contentWithLog(vector.reasons), 0, "P2"),
      vector.streak,
      `vector ${index + 1} from content`,
    );
  }

  const property = decayProperty();
  const kinds = vectors.map((vector) =>
    helpers.planPriorityRollRecommendation({
      property,
      currentValue: "medium",
      streak: helpers.countPriorityRollStreak(vector.reasons, "P2"),
      baseDate: new Date(2026, 8, 30),
      random: () => 0,
    }).kind,
  );
  assert.deepEqual(kinds, [
    "roll",
    "roll",
    "decay",
    "decay",
    "roll",
    "roll",
    "roll",
    "roll",
    "decay",
  ]);
  const first = helpers.planPriorityRollRecommendation({
    property,
    currentValue: "medium",
    streak: 0,
    baseDate: new Date(2026, 8, 30),
    random: () => 0,
  });
  assert.equal(first.step, 1);
  assert.equal(first.limit, 1);
  assert.equal(first.reason, "🎲 P2 roll · in **8** (8–30) days");
});

test("conformance vectors 11-15: custom limits, disabled decay and edges", () => {
  const property = decayProperty();
  // Vector 10: at P4 one roll recommends a cancel, unless recurring.
  assert.equal(helpers.countPriorityRollStreak(["🎲 P4 roll · in **200** (91–365) days"], "P4"), 1);
  const cancel = helpers.planPriorityRollRecommendation({
    property,
    currentValue: "lowest",
    streak: 1,
    baseDate: new Date(2026, 8, 30),
    random: () => 0,
  });
  assert.equal(cancel.kind, "cancel");
  assert.equal(cancel.reason, "🍂 decayed past P4 after 1 roll");
  const unavailable = helpers.planPriorityRollRecommendation({
    property,
    currentValue: "lowest",
    streak: 1,
    recurring: true,
    baseDate: new Date(2026, 8, 30),
    random: () => 0,
  });
  assert.equal(unavailable.kind, "unavailable");

  // Vector 11: decay.rolls 3 — two rolls recommend step 3/3, three decay.
  const generous = decayProperty({ decay: { rolls: 3 } });
  const two = ["🎲 P2 roll · in **9** (8–30) days", "🎲 P2 roll · in **10** (8–30) days"];
  assert.equal(helpers.countPriorityRollStreak(two, "P2"), 2);
  const third = helpers.planPriorityRollRecommendation({
    property: generous,
    currentValue: "medium",
    streak: 2,
    baseDate: new Date(2026, 8, 30),
    random: () => 0,
  });
  assert.equal(third.kind, "roll");
  assert.equal(third.step, 3);
  assert.equal(third.limit, 3);
  const fourth = helpers.planPriorityRollRecommendation({
    property: generous,
    currentValue: "medium",
    streak: 3,
    baseDate: new Date(2026, 8, 30),
    random: () => 0,
  });
  assert.equal(fourth.kind, "decay");
  assert.equal(fourth.toLevel.label, "P3");

  // Vector 12: decay disabled — five rolls still recommend a roll, with no step.
  const plain = decayProperty({ decay: false });
  const five = Array.from(
    { length: 5 },
    (_, index) => `🎲 P2 roll · in **${8 + index}** (8–30) days`,
  );
  assert.equal(helpers.countPriorityRollStreak(five, "P2"), 5);
  const stillRoll = helpers.planPriorityRollRecommendation({
    property: plain,
    currentValue: "medium",
    streak: 5,
    baseDate: new Date(2026, 8, 30),
    random: () => 0,
  });
  assert.equal(stillRoll.kind, "roll");
  assert.equal(stillRoll.step, null);
  assert.equal(stillRoll.limit, null);

  // Vector 13: P2 rolls 0 with no log decays immediately.
  const zero = decayProperty({ levelRolls: { P2: 0 } });
  const immediate = helpers.planPriorityRollRecommendation({
    property: zero,
    currentValue: "medium",
    streak: 0,
    baseDate: new Date(2026, 8, 30),
    random: () => 0,
  });
  assert.equal(immediate.kind, "decay");
  assert.equal(immediate.toLevel.label, "P3");

  // Vector 14: a decay entry stops the new level's streak.
  assert.equal(
    helpers.countPriorityRollStreak(["🎲 P2 → P3 decay · in **45** (31–90) days"], "P3"),
    0,
  );
  const fresh = helpers.planPriorityRollRecommendation({
    property,
    currentValue: "low",
    streak: 0,
    baseDate: new Date(2026, 8, 30),
    random: () => 0,
  });
  assert.equal(fresh.kind, "roll");
  assert.equal(fresh.level.label, "P3");

  // Vector 15: P4 rolls 0 with no log cancels immediately.
  const zeroLast = decayProperty({ levelRolls: { P4: 0 } });
  const lastCancel = helpers.planPriorityRollRecommendation({
    property: zeroLast,
    currentValue: "lowest",
    streak: 0,
    baseDate: new Date(2026, 8, 30),
    random: () => 0,
  });
  assert.equal(lastCancel.kind, "cancel");
  assert.equal(lastCancel.reason, "🍂 decayed past P4");
});

test("the streak reader follows log grammar: legacy labels, nesting and stops", () => {
  const roll = "🎲 P2 roll · in **17** (8–30) days";
  assert.equal(helpers.getPriorityRollStreak("- [ ] #task No log here", 0, "P2"), 0);
  assert.equal(helpers.getPriorityRollStreak("", 0, "P2"), 0);
  assert.equal(helpers.getPriorityRollStreak(contentWithLog([roll]), 0, ""), 0);

  // Legacy labels are accepted.
  const legacy = [
    "- [ ] #task Legacy log [priority:: medium]",
    "\t- 🗓️ **Schedule log**",
    `\t\t- *2026-10-01* — ${roll}`,
  ].join("\n");
  assert.equal(helpers.getPriorityRollStreak(legacy, 0, "P2"), 1);

  // A marker nested under a grandchild is ignored.
  const nested = [
    "- [ ] #task Outer [priority:: medium]",
    "\t- child bullet",
    `\t\t- 🗓️ **SCHEDULE LOG**`,
    `\t\t\t- *2026-10-01* — ${roll}`,
  ].join("\n");
  assert.equal(helpers.getPriorityRollStreak(nested, 0, "P2"), 0);

  // Bullets nested under an entry do not count and do not stop the streak.
  const withChild = [
    "- [ ] #task With child [priority:: medium]",
    "\t- 🗓️ **SCHEDULE LOG**",
    `\t\t- *2026-10-01* — ${roll}`,
    "\t\t\t- a nested note under the entry",
    `\t\t- *2026-09-29* — ${roll}`,
  ].join("\n");
  assert.equal(helpers.getPriorityRollStreak(withChild, 0, "P2"), 2);

  // An unparseable direct child stops the streak.
  const stopped = [
    "- [ ] #task Stopped [priority:: medium]",
    "\t- 🗓️ **SCHEDULE LOG**",
    "\t\t- just a plain bullet",
    `\t\t- *2026-09-29* — ${roll}`,
  ].join("\n");
  assert.equal(helpers.getPriorityRollStreak(stopped, 0, "P2"), 0);
});

test("rollPriorityRecommendationDate avoids the current date when the window has room", () => {
  const level = { label: "P2", minDays: 8, maxDays: 30 };
  const baseDate = new Date(2026, 8, 30);
  const fmt = (result) => ({
    date: helpers.formatBulletPropertyDate(result.date),
    offset: result.offset,
  });

  // Without an avoid value it behaves exactly like the plain roll.
  assert.deepEqual(
    fmt(helpers.rollPriorityRecommendationDate(level, baseDate, () => 0, "")),
    fmt(helpers.rollPriorityScheduledDateWithOffset(level, baseDate, () => 0)),
  );

  // The avoided offset is skipped: random 0 lands on 9 instead of 8.
  assert.deepEqual(fmt(helpers.rollPriorityRecommendationDate(level, baseDate, () => 0, "2026-10-08")), {
    date: "2026-10-09",
    offset: 9,
  });
  // Offsets below the avoided one are unchanged.
  assert.deepEqual(fmt(helpers.rollPriorityRecommendationDate(level, baseDate, () => 0, "2026-10-20")), {
    date: "2026-10-08",
    offset: 8,
  });
  // The top of the window stays reachable when the avoid sits below it.
  assert.deepEqual(
    fmt(helpers.rollPriorityRecommendationDate(level, baseDate, () => 0.999999, "2026-10-08")),
    { date: "2026-10-30", offset: 30 },
  );
  // An avoid date outside the window changes nothing.
  assert.deepEqual(
    fmt(helpers.rollPriorityRecommendationDate(level, baseDate, () => 0, "2026-11-05")),
    fmt(helpers.rollPriorityScheduledDateWithOffset(level, baseDate, () => 0)),
  );
  // A single-day window cannot avoid and behaves like the plain roll.
  const single = { label: "P1", minDays: 3, maxDays: 3 };
  assert.deepEqual(
    fmt(helpers.rollPriorityRecommendationDate(single, baseDate, () => 0.5, "2026-10-03")),
    fmt(helpers.rollPriorityScheduledDateWithOffset(single, baseDate, () => 0.5)),
  );
});

test("decay and cancel reason formatters use the exact ladder copy", () => {
  const fromLevel = { label: "P2", minDays: 8, maxDays: 30 };
  const toLevel = { label: "P3", minDays: 31, maxDays: 90 };
  assert.equal(
    helpers.formatPriorityDecayScheduleReason({
      fromLevel,
      toLevel,
      rolledDays: 45,
    }),
    "🎲 P2 → P3 decay · in **45** (31–90) days",
  );
  assert.equal(
    helpers.formatPriorityDecayScheduleReason({ fromLevel, rolledDays: 45 }),
    "",
  );
  assert.equal(
    helpers.formatPriorityDecayScheduleReason({ fromLevel, toLevel, rolledDays: 5 }),
    "",
  );

  assert.equal(
    helpers.formatPriorityDecayCancelReason({ level: { label: "P4" }, streak: 1 }),
    "🍂 decayed past P4 after 1 roll",
  );
  assert.equal(
    helpers.formatPriorityDecayCancelReason({ level: { label: "P4" }, streak: 3 }),
    "🍂 decayed past P4 after 3 rolls",
  );
  assert.equal(
    helpers.formatPriorityDecayCancelReason({ level: { label: "P4" }, streak: 0 }),
    "🍂 decayed past P4",
  );
  assert.equal(helpers.formatPriorityDecayCancelReason({ streak: 2 }), "");
});

test("the default ladder walks P2 roll, decay, P3 roll, decay, P4 roll, cancel", () => {
  const property = decayProperty();
  const baseDate = new Date(2026, 8, 30);
  const plan = (currentValue, streak) =>
    helpers.planPriorityRollRecommendation({
      property,
      currentValue,
      streak,
      baseDate,
      random: () => 0,
    });

  const roll = plan("medium", 0);
  assert.equal(roll.kind, "roll");
  assert.equal(roll.level.label, "P2");
  assert.equal(roll.offset, 8);
  assert.equal(roll.reason, "🎲 P2 roll · in **8** (8–30) days");
  assert.equal(Object.isFrozen(roll), true);

  const decay = plan("medium", 1);
  assert.equal(decay.kind, "decay");
  assert.equal(decay.fromLevel.label, "P2");
  assert.equal(decay.toLevel.label, "P3");
  assert.equal(decay.offset, 31);
  assert.equal(decay.reason, "🎲 P2 → P3 decay · in **31** (31–90) days");

  const next = plan("low", 0);
  assert.equal(next.kind, "roll");
  assert.equal(next.level.label, "P3");
  assert.equal(next.step, 1);

  const last = plan("lowest", 0);
  assert.equal(last.kind, "roll");
  const done = plan("lowest", 1);
  assert.equal(done.kind, "cancel");
  assert.equal(done.date, "");
});

test("the planner returns null without a configured priority", () => {
  const property = decayProperty();
  const baseDate = new Date(2026, 8, 30);
  assert.equal(
    helpers.planPriorityRollRecommendation({
      property,
      currentValue: "",
      streak: 0,
      baseDate,
      random: () => 0,
    }),
    null,
  );
  // Implicit P0 (no priority field) and unconfigured values have no ladder.
  assert.equal(
    helpers.planPriorityRollRecommendation({
      property,
      currentValue: "unknown-value",
      streak: 0,
      baseDate,
      random: () => 0,
    }),
    null,
  );
  assert.equal(
    helpers.planPriorityRollRecommendation({
      property: { name: "scheduled", values: "date" },
      currentValue: "2026-10-01",
      streak: 0,
      baseDate,
      random: () => 0,
    }),
    null,
  );
});

test("buildPriorityRollPreviewModel carries the row copy for every kind", () => {
  const baseDate = new Date(2026, 8, 30);
  const rollOn = helpers.buildPriorityRollPreviewModel(
    {
      kind: "roll",
      level: { label: "P2" },
      limit: 1,
      step: 1,
      date: "2026-10-17",
    },
    baseDate,
  );
  assert.deepEqual(
    { icon: rollOn.icon, tone: rollOn.tone, metaTone: rollOn.metaTone },
    { icon: "dices", tone: "accent", metaTone: "warn" },
  );
  assert.equal(rollOn.action, "P2 roll");
  assert.equal(rollOn.dateText, "2026-10-17 · Sat · in 17 days");
  assert.equal(rollOn.meta, "roll 1/1");
  assert.equal(rollOn.footerLabel, "Roll P2");
  assert.equal(
    rollOn.ariaLabel,
    "Ctrl+Enter: P2 roll to Sat 2026-10-17, in 17 days, roll 1 of 1",
  );

  const midRoll = helpers.buildPriorityRollPreviewModel(
    { kind: "roll", level: { label: "P2" }, limit: 3, step: 1, date: "2026-10-08" },
    baseDate,
  );
  assert.equal(midRoll.meta, "roll 1/3");
  assert.equal(midRoll.metaTone, "info");

  const rollOff = helpers.buildPriorityRollPreviewModel(
    { kind: "roll", level: { label: "P2" }, limit: null, step: null, date: "2026-10-08" },
    baseDate,
  );
  assert.equal(rollOff.meta, "");
  assert.equal(rollOff.footerLabel, "Roll P2");

  const decay = helpers.buildPriorityRollPreviewModel(
    {
      kind: "decay",
      fromLevel: { label: "P2" },
      toLevel: { label: "P3" },
      date: "2026-11-29",
    },
    baseDate,
  );
  assert.deepEqual(
    { icon: decay.icon, tone: decay.tone, meta: decay.meta },
    { icon: "trending-down", tone: "warn", meta: "decay" },
  );
  assert.equal(decay.action, "P2 → P3");
  assert.equal(decay.dateText, "2026-11-29 · Sun · in 60 days");
  assert.equal(decay.footerLabel, "Decay to P3");

  const cancel = helpers.buildPriorityRollPreviewModel(
    { kind: "cancel", level: { label: "P4" }, streak: 1 },
    baseDate,
  );
  assert.deepEqual(
    { icon: cancel.icon, tone: cancel.tone, action: cancel.action },
    { icon: "ban", tone: "danger", action: "Cancel task" },
  );
  assert.equal(cancel.dateText, "");
  assert.equal(cancel.meta, "decayed past P4");
  assert.equal(cancel.footerLabel, "Cancel task");

  const blocked = helpers.buildPriorityRollPreviewModel(
    { kind: "unavailable" },
    baseDate,
  );
  assert.deepEqual(
    { icon: blocked.icon, tone: blocked.tone, action: blocked.action },
    { icon: "circle-slash", tone: "muted", action: "Cannot cancel" },
  );
  assert.equal(blocked.meta, "recurring · use Obsidian Tasks");
  assert.equal(blocked.footerLabel, "");

  assert.equal(helpers.buildPriorityRollPreviewModel(null, baseDate), null);
  assert.equal(helpers.buildPriorityRollPreviewModel({ kind: "roll" }, baseDate), null);
  assert.equal(
    helpers.buildPriorityRollPreviewModel({ kind: "mystery" }, baseDate),
    null,
  );
  assert.equal(Object.isFrozen(rollOn), true);
});

test("picker-single recognizes the recommended-roll keypress", () => {
  assert.equal(
    helpers.isRecommendedRollKeydown({ key: "Enter", ctrlKey: true }),
    true,
  );
  assert.equal(
    helpers.isRecommendedRollKeydown({ key: "Enter", metaKey: true }),
    true,
  );
  assert.equal(helpers.isRecommendedRollKeydown({ key: "Enter" }), false);
  assert.equal(
    helpers.isRecommendedRollKeydown({
      key: "Enter",
      ctrlKey: true,
      shiftKey: true,
    }),
    false,
  );
  assert.equal(
    helpers.isRecommendedRollKeydown({
      key: "Enter",
      ctrlKey: true,
      altKey: true,
    }),
    false,
  );
  assert.equal(
    helpers.isRecommendedRollKeydown({ key: "r", ctrlKey: true }),
    false,
  );
  assert.equal(helpers.isRecommendedRollKeydown(null), false);
});

test("picker-single footers carry the recommended-roll hints", () => {
  const baseDate = new Date(2026, 8, 30);
  const property = decayProperty();
  const roll = helpers.planPriorityRollRecommendation({
    property,
    currentValue: "medium",
    streak: 0,
    currentScheduled: "2026-10-01",
    baseDate,
    random: () => 0,
  });
  const preview = helpers.buildPriorityRollPreviewModel(roll, baseDate);
  assert.equal(preview.footerLabel, "Roll P2");

  const stageOne = helpers.getBulletPropertyStageOneHints(preview);
  assert.deepEqual(
    stageOne.map((hint) => `${hint.keys.join("+")} ${hint.label}`),
    [
      "↑+↓ Navigate",
      "^N+^P Move",
      "↵ Choose",
      "^↵ Roll P2",
      "^R Re-roll",
      "^D Delete",
      "esc Dismiss",
    ],
  );

  const cancelPreview = helpers.buildPriorityRollPreviewModel(
    { kind: "cancel", level: { label: "P4" }, streak: 1 },
    baseDate,
  );
  const cancelHints = helpers.getBulletPropertyStageOneHints(cancelPreview);
  assert.deepEqual(
    cancelHints.map((hint) => `${hint.keys.join("+")} ${hint.label}`),
    [
      "↑+↓ Navigate",
      "^N+^P Move",
      "↵ Choose",
      "^↵ Cancel task",
      "^D Delete",
      "esc Dismiss",
    ],
  );

  assert.deepEqual(
    helpers.getBulletPropertyStageOneHints(null).map((hint) => hint.label),
    ["Navigate", "Move", "Choose", "Delete", "Dismiss"],
  );

  const stageTwo = helpers.getBulletPropertyStageTwoHints(true, preview);
  assert.deepEqual(
    stageTwo.map((hint) => `${hint.keys.join("+")} ${hint.label}`),
    [
      "↑+↓ Navigate",
      "^N+^P Move",
      "↵ Set",
      "^R Re-roll",
      "^↵ Roll P2",
      "esc Dismiss",
    ],
  );
  assert.deepEqual(
    helpers
      .getBulletPropertyStageTwoHints(true, null)
      .map((hint) => `${hint.keys.join("+")} ${hint.label}`),
    ["↑+↓ Navigate", "^N+^P Move", "↵ Set", "^R Re-roll", "esc Dismiss"],
  );
});

test("picker-single shares one roll between the preview and the pinned row", () => {
  const baseDate = new Date(2026, 8, 30);
  const property = decayProperty();
  const roll = helpers.planPriorityRollRecommendation({
    property,
    currentValue: "medium",
    streak: 0,
    currentScheduled: "2026-10-01",
    baseDate,
    random: () => 0,
  });
  assert.equal(roll.kind, "roll");
  assert.equal(roll.date, "2026-10-08");

  const shared = helpers.createPriorityRollDateItemFromRecommendation(
    roll,
    "2026-10-01",
  );
  const fresh = helpers.createPriorityRollDateItem(
    property.levels[1],
    baseDate,
    "2026-10-01",
    () => 0,
  );
  assert.deepEqual(shared, fresh);

  assert.equal(
    helpers.createPriorityRollDateItemFromRecommendation(
      { kind: "decay", fromLevel: { label: "P2" } },
      "",
    ),
    null,
  );
  assert.equal(
    helpers.createPriorityRollDateItemFromRecommendation(
      { kind: "roll", level: { label: "P2" }, date: "not-a-date" },
      "",
    ),
    null,
  );

  assert.equal(
    helpers.getPriorityRollFilterText(roll, baseDate),
    "roll P2 roll roll 1/1",
  );
  assert.equal(
    helpers.getPriorityRollCurrentLabel({
      kind: "decay",
      fromLevel: { label: "P2" },
      toLevel: { label: "P3" },
    }),
    "P2",
  );
  assert.equal(helpers.getPriorityRollCurrentLabel(roll), "P2");
  assert.equal(helpers.getPriorityRollCurrentLabel(null), "");
});

test("picker-single plans the next-roll hint for the notice chips", () => {
  const baseDate = new Date(2026, 8, 30);
  const property = decayProperty();
  const plan = (currentValue, streak, extra = {}) =>
    helpers.planPriorityRollRecommendation({
      property,
      currentValue,
      streak,
      currentScheduled: "2026-10-01",
      baseDate,
      random: () => 0,
      ...extra,
    });

  assert.deepEqual(
    helpers.planNextPriorityRollHint(property, plan("medium", 0)),
    { next: "decay", nextLabel: "P3" },
  );

  const roomy = decayProperty({ decay: { rolls: 3 } });
  const early = helpers.planPriorityRollRecommendation({
    property: roomy,
    currentValue: "medium",
    streak: 1,
    currentScheduled: "2026-10-01",
    baseDate,
    random: () => 0,
  });
  assert.equal(early.step, 2);
  assert.equal(helpers.planNextPriorityRollHint(roomy, early), null);

  assert.deepEqual(
    helpers.planNextPriorityRollHint(property, plan("lowest", 0)),
    { next: "cancel", nextLabel: "" },
  );

  const decay = plan("medium", 1);
  assert.equal(decay.kind, "decay");
  assert.equal(
    helpers.planNextPriorityRollHint(property, decay),
    null,
  );

  const instantDecay = decayProperty({ levelRolls: { P3: 0 } });
  const intoInstant = helpers.planPriorityRollRecommendation({
    property: instantDecay,
    currentValue: "medium",
    streak: 1,
    currentScheduled: "2026-10-01",
    baseDate,
    random: () => 0,
  });
  assert.equal(intoInstant.kind, "decay");
  assert.deepEqual(
    helpers.planNextPriorityRollHint(instantDecay, intoInstant),
    { next: "decay", nextLabel: "P4" },
  );

  const offProperty = decayProperty({ decay: false });
  const offRoll = helpers.planPriorityRollRecommendation({
    property: offProperty,
    currentValue: "medium",
    streak: 5,
    currentScheduled: "2026-10-01",
    baseDate,
    random: () => 0,
  });
  assert.equal(offRoll.limit, null);
  assert.equal(helpers.planNextPriorityRollHint(offProperty, offRoll), null);

  assert.equal(
    helpers.planNextPriorityRollHint(
      property,
      plan("lowest", 1, { recurring: true }),
    ),
    null,
  );
  assert.equal(helpers.planNextPriorityRollHint(property, null), null);
});

test("picker-single notice cards name the roll, decay and next press", () => {
  const baseDate = new Date(2026, 8, 30);
  const property = decayProperty();

  const rollNotice = helpers.buildPriorityNoticeModel({
    property,
    level: property.levels[1],
    levelIndex: 1,
    baseDate,
    scheduledValues: ["2026-10-08"],
    taskCount: 1,
    scope: "task",
    roll: {
      kind: "roll",
      fromLevel: "P2",
      step: 1,
      limit: 1,
      next: "decay",
      nextLabel: "P3",
    },
    outcome: { blockedTaskCount: 1, scheduleLoggedTaskCount: 1 },
  });
  assert.equal(rollNotice.pill, "P2 roll");
  assert.deepEqual(rollNotice.chips.slice(0, 2), [
    { text: "roll 1/1", tone: "info" },
    { text: "next ^↵ → P3", tone: "warn" },
  ]);
  assert.match(rollNotice.text, /scheduled → P2 roll/);
  assert.match(rollNotice.text, /roll 1\/1/);
  assert.match(rollNotice.text, /next \^↵ → P3/);

  const decayNotice = helpers.buildPriorityNoticeModel({
    property,
    level: property.levels[2],
    levelIndex: 2,
    baseDate,
    scheduledValues: ["2026-11-29"],
    taskCount: 1,
    scope: "task",
    roll: { kind: "decay", fromLevel: "P2", next: "cancel" },
    outcome: { blockedTaskCount: 1, scheduleLoggedTaskCount: 1 },
  });
  assert.equal(decayNotice.pill, "P2 → P3");
  assert.equal(decayNotice.iconName, "signal-low");
  assert.deepEqual(decayNotice.chips.slice(0, 2), [
    { text: "decayed from P2", tone: "warn" },
    { text: "next ^↵ cancels", tone: "warn" },
  ]);
  assert.match(
    decayNotice.text,
    /priority → P2 → P3 \(low\) · decayed from P2/,
  );

  const offNotice = helpers.buildPriorityNoticeModel({
    property: decayProperty({ decay: false }),
    level: property.levels[1],
    levelIndex: 1,
    baseDate,
    scheduledValues: ["2026-10-08"],
    taskCount: 1,
    scope: "task",
    roll: { kind: "roll", fromLevel: "P2", step: null, limit: null },
    outcome: { blockedTaskCount: 1 },
  });
  assert.equal(offNotice.pill, "P2 roll");
  assert.deepEqual(offNotice.chips, [{ text: "Blocked", tone: "warn" }]);

  const plain = helpers.buildPriorityNoticeModel({
    property,
    level: property.levels[1],
    levelIndex: 1,
    baseDate,
    scheduledValues: ["2026-10-08"],
    taskCount: 1,
    scope: "task",
    outcome: { blockedTaskCount: 1, scheduleLoggedTaskCount: 1 },
  });
  assert.equal(plain.pill, "P2");
  assert.deepEqual(plain.chips, [
    { text: "logged", tone: "info" },
    { text: "Blocked", tone: "warn" },
  ]);
});

test("picker-single decay payload and preview-target comparison", () => {
  const reason = "🎲 P2 → P3 decay · in **45** (31–90) days";
  assert.deepEqual(
    helpers.buildPriorityDecayScheduleLogPayload(
      "2026-10-08",
      "2026-11-29",
      reason,
    ),
    {
      from: "2026-10-08",
      to: "2026-11-29",
      reason,
      automatic: true,
    },
  );
  assert.equal(
    helpers.buildPriorityDecayScheduleLogPayload(
      "2026-11-29",
      "2026-11-29",
      reason,
    ),
    null,
  );
  assert.equal(
    helpers.buildPriorityDecayScheduleLogPayload("2026-10-08", "2026-11-29", ""),
    null,
  );

  const cached = {
    kind: "roll",
    level: { label: "P2" },
    taskLine: 4,
    date: "2026-10-08",
  };
  assert.equal(
    helpers.isSamePriorityRollTarget(cached, {
      kind: "roll",
      level: { label: "P2" },
      taskLine: 4,
      date: "2026-10-20",
    }),
    true,
  );
  assert.equal(
    helpers.isSamePriorityRollTarget(cached, {
      kind: "decay",
      fromLevel: { label: "P2" },
      toLevel: { label: "P3" },
      taskLine: 4,
    }),
    false,
  );
  assert.equal(
    helpers.isSamePriorityRollTarget(cached, {
      kind: "roll",
      level: { label: "P3" },
      taskLine: 4,
    }),
    false,
  );
  assert.equal(
    helpers.isSamePriorityRollTarget(cached, {
      kind: "roll",
      level: { label: "P2" },
      taskLine: 9,
    }),
    false,
  );
  assert.equal(
    helpers.isSamePriorityRollTarget(
      { kind: "unavailable", taskLine: 4 },
      { kind: "unavailable", taskLine: 4 },
    ),
    false,
  );
  assert.equal(helpers.isSamePriorityRollTarget(cached, null), false);
});
