const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const { ModalStub } = require("./modal-harness.cjs");

global.window = { setTimeout: (callback) => callback() };

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
    class TestModal extends ModalStub {}
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

test("picker-single stage-two footers carry the recommended-roll hints", () => {
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

  // The property-list footer is gone with the list; the card's own footer
  // names the keys that remain.
  assert.equal(helpers.getBulletPropertyStageOneHints, undefined);

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
    /priority → P3 \(low\) · decayed from P2/,
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

function countedContent() {
  const rollP2 = "🎲 P2 roll · in **17** (8–30) days";
  const rollP4 = "🎲 P4 roll · in **200** (91–365) days";
  const lines = [
    "- [ ] #task A [priority:: medium] [scheduled:: 2026-10-01]",
    "\t- 🗓️ **SCHEDULE LOG**",
    "- [ ] #task B [priority:: medium] [scheduled:: 2026-10-01]",
    "\t- 🗓️ **SCHEDULE LOG**",
    `\t\t- *2026-10-01* — ${rollP2}`,
    "- [ ] #task C [priority:: lowest] [scheduled:: 2026-10-01]",
    "\t- 🗓️ **SCHEDULE LOG**",
    `\t\t- *2026-10-01* — ${rollP4}`,
    "- [ ] #task D [scheduled:: 2026-10-01]",
    "- [x] #task E [priority:: medium] [scheduled:: 2026-10-01]",
  ];
  return lines.join("\n");
}

function countedTargets(content, lines) {
  const split = content.split("\n");
  return lines.map((line) => ({ line, rawLine: split[line] }));
}

test("picker-counted plans one recommendation per target with skips", () => {
  const property = decayProperty();
  const content = countedContent();
  const targets = countedTargets(content, [0, 2, 5, 8, 9]);
  const summary = helpers.planPriorityRollRecommendationsForTargets(
    content,
    targets,
    property,
    { baseDate: new Date(2026, 8, 30), random: () => 0 },
  );
  assert.deepEqual(summary.counts, { roll: 1, decay: 1, cancel: 1, unavailable: 0 });
  assert.equal(summary.actionableCount, 3);
  assert.equal(summary.skippedCount, 2);
  assert.equal(summary.hasRecommendation, true);
  assert.equal(summary.allRollSameLevel, false);
  const kinds = summary.entries.map((entry) =>
    entry.recommendation ? entry.recommendation.kind : null,
  );
  assert.deepEqual(kinds, ["roll", "decay", "cancel", null, null]);
  assert.deepEqual(
    summary.entries.map((entry) => entry.skipped),
    [null, null, null, "no-priority", "closed"],
  );
  assert.equal(summary.dateStart, "2026-10-08");
  assert.equal(summary.dateEnd, "2026-10-31");
  assert.equal(summary.unavailableReason, null);
  assert.equal(Object.isFrozen(summary), true);
  assert.equal(Object.isFrozen(summary.entries[0].recommendation), true);
});

test("picker-counted batch preview, footer and notice copy", () => {
  const property = decayProperty();
  const content = countedContent();
  const targets = countedTargets(content, [0, 2, 5, 8, 9]);
  const summary = helpers.planPriorityRollRecommendationsForTargets(
    content,
    targets,
    property,
    { baseDate: new Date(2026, 8, 30), random: () => 0 },
  );
  const preview = helpers.buildBatchPriorityRollPreviewModel(summary);
  assert.deepEqual(
    { icon: preview.icon, tone: preview.tone, kind: preview.kind },
    { icon: "ban", tone: "danger", kind: "cancel" },
  );
  assert.equal(preview.action, "3 tasks · 1 roll · 1 decay · 1 cancel");
  assert.equal(preview.dateText, "2026-10-08 → 2026-10-31");
  assert.equal(preview.meta, "2 skipped");
  assert.equal(preview.footerLabel, "Apply 3 recommendations");
  assert.equal(
    preview.ariaLabel,
    "Ctrl+Enter: 3 tasks · 1 roll · 1 decay · 1 cancel, 2026-10-08 → 2026-10-31, 2 skipped",
  );

  const rollsOnly = helpers.planPriorityRollRecommendationsForTargets(
    [
      "- [ ] #task A [priority:: medium] [scheduled:: 2026-10-01]",
      "- [ ] #task B [priority:: medium] [scheduled:: 2026-10-01]",
    ].join("\n"),
    countedTargets(
      [
        "- [ ] #task A [priority:: medium] [scheduled:: 2026-10-01]",
        "- [ ] #task B [priority:: medium] [scheduled:: 2026-10-01]",
      ].join("\n"),
      [0, 1],
    ),
    property,
    { baseDate: new Date(2026, 8, 30), random: () => 0 },
  );
  assert.equal(rollsOnly.allRollSameLevel, true);
  assert.equal(rollsOnly.sharedLevelLabel, "P2");
  const rollsPreview = helpers.buildBatchPriorityRollPreviewModel(rollsOnly);
  assert.equal(rollsPreview.footerLabel, "Roll 2 tasks");
  assert.equal(rollsPreview.kind, "roll");

  const notice = helpers.buildBatchPriorityRollNoticeModel(summary, {
    baseDate: new Date(2026, 8, 30),
    scheduledValues: ["2026-10-08", "2026-10-31"],
    outcome: { blockedTaskCount: 2, removedPomodoroLinkCount: 1 },
  });
  assert.equal(notice.pill, "Rolled 3 tasks");
  assert.equal(notice.iconName, "dices");
  assert.deepEqual(
    notice.chips.slice(0, 3),
    [
      { text: "1 rolled", tone: "info" },
      { text: "1 decayed", tone: "warn" },
      { text: "1 cancelled", tone: "warn" },
    ],
  );
  assert.match(notice.text, /Rolled 3 tasks/);
  assert.match(notice.text, /1 rolled/);
  assert.equal(Object.isFrozen(preview), true);
  assert.equal(Object.isFrozen(notice), true);
  assert.equal(helpers.buildBatchPriorityRollPreviewModel(null), null);
});

test("picker-counted composes cancel then set-priority into one postimage", () => {
  const property = decayProperty();
  const content = countedContent();
  const targets = countedTargets(content, [0, 2, 5]);
  const session = { valid: true, explicit: true, targets };
  const summary = helpers.planPriorityRollRecommendationsForTargets(
    content,
    targets,
    property,
    { baseDate: new Date(2026, 8, 30), random: () => 0 },
  );
  const byLine = new Map(
    summary.entries
      .filter((entry) => entry.recommendation)
      .map((entry) => [entry.line, entry.recommendation]),
  );
  const plan = helpers.planRecommendedRollBatch(content, session, byLine, {
    property,
    dateText: "2026-09-30",
    baseDate: new Date(2026, 8, 30),
  });
  assert.equal(plan.valid, true);
  assert.equal(plan.rolledCount, 1);
  assert.equal(plan.decayedCount, 1);
  assert.equal(plan.cancelledCount, 1);
  assert.match(
    plan.content,
    /\[priority:: medium\] \[scheduled:: 2026-10-08\]/,
  );
  assert.match(
    plan.content,
    /\[priority:: low\] \[scheduled:: 2026-10-31\]/,
  );
  assert.match(plan.content, /🎲 P2 roll · in \*\*8\*\* \(8–30\) days/);
  assert.match(plan.content, /🎲 P2 → P3 decay · in \*\*31\*\* \(31–90\) days/);
  assert.match(plan.content, /🍂 decayed past P4 after 1 roll/);
  assert.match(plan.content, /\[cancelled:: 2026-09-30\]/);
  assert.equal(plan.changed, true);
  assert.equal(Object.isFrozen(plan), true);
});

test("picker-counted refuses a recurring cancel as one batch", () => {
  const property = decayProperty();
  const rollP4 = "🎲 P4 roll · in **200** (91–365) days";
  const content = [
    "- [ ] #task A [priority:: medium] [scheduled:: 2026-10-01] 🔁",
    "- [ ] #task C [priority:: lowest] [scheduled:: 2026-10-01] 🔁",
    "\t- 🗓️ **SCHEDULE LOG**",
    `\t\t- *2026-10-01* — ${rollP4}`,
  ].join("\n");
  const targets = countedTargets(content, [0, 1]);
  const summary = helpers.planPriorityRollRecommendationsForTargets(
    content,
    targets,
    property,
    { baseDate: new Date(2026, 8, 30), random: () => 0 },
  );
  assert.ok(summary.unavailableReason);
  const preview = helpers.buildBatchPriorityRollPreviewModel(summary);
  assert.equal(preview.kind, "unavailable");
  assert.equal(preview.action, "Cannot apply");
  assert.equal(preview.footerLabel, "");
  const byLine = new Map(
    summary.entries
      .filter((entry) => entry.recommendation)
      .map((entry) => [entry.line, entry.recommendation]),
  );
  const plan = helpers.planRecommendedRollBatch(
    content,
    { valid: true, explicit: true, targets },
    byLine,
    {
      property,
      dateText: "2026-09-30",
      baseDate: new Date(2026, 8, 30),
    },
  );
  assert.equal(plan.valid, false);
  assert.equal(plan.recurring, true);
});

test("picker-counted stale lines refuse and new options stay byte-identical", () => {
  const property = decayProperty();
  const content = countedContent();
  const lines = content.split("\n");
  const staleTargets = [
    { line: 0, rawLine: "- [ ] #task changed" },
    { line: 2, rawLine: lines[2] },
  ];
  const stale = helpers.planPriorityRollRecommendationsForTargets(
    content,
    staleTargets,
    property,
    { baseDate: new Date(2026, 8, 30), random: () => 0 },
  );
  assert.equal(stale.entries[0].skipped, "changed");

  const single = [
    "- [ ] #task A [priority:: medium] [scheduled:: 2026-10-01]",
    "- [ ] #task B [priority:: medium] [scheduled:: 2026-10-01]",
  ].join("\n");
  const session = {
    valid: true,
    explicit: true,
    targets: countedTargets(single, [0, 1]),
  };
  const before = helpers.planCountedBulletPropertyBatch(
    single,
    session,
    "priority",
    null,
    {
      operation: "set-priority",
      priorityValue: "medium",
      scheduledPropertyName: "scheduled",
      scheduledValueByLine: new Map([
        [0, "2026-10-08"],
        [1, "2026-10-09"],
      ]),
      today: new Date(2026, 8, 30),
      scheduleLog: { automatic: true, reason: "🎲 P2 roll · test" },
    },
  );
  const after = helpers.planCountedBulletPropertyBatch(
    single,
    session,
    "priority",
    null,
    {
      operation: "set-priority",
      priorityValue: "medium",
      priorityValueByLine: new Map([
        [0, "medium"],
        [1, "medium"],
      ]),
      scheduledPropertyName: "scheduled",
      scheduledValueByLine: new Map([
        [0, "2026-10-08"],
        [1, "2026-10-09"],
      ]),
      today: new Date(2026, 8, 30),
      scheduleLog: { automatic: true, reason: "🎲 P2 roll · test" },
    },
  );
  assert.equal(before.valid, true);
  assert.equal(after.valid, true);
  assert.equal(after.content, before.content);

  const cancelContent = [
    "- [ ] #task A [priority:: medium]",
    "- [ ] #task B [priority:: medium]",
  ].join("\n");
  const cancelSession = {
    valid: true,
    explicit: true,
    targets: countedTargets(cancelContent, [0, 1]),
  };
  const cancelBefore = helpers.planTaskCancelBatch(
    cancelContent,
    cancelSession,
    { date: "2026-09-30", reason: "🍂 decayed past P4" },
  );
  const cancelAfter = helpers.planTaskCancelBatch(
    cancelContent,
    cancelSession,
    {
      date: "2026-09-30",
      reason: "🍂 decayed past P4",
      reasonByLine: new Map([
        [0, "🍂 decayed past P4"],
        [1, "🍂 decayed past P4"],
      ]),
    },
  );
  assert.equal(cancelBefore.valid, true);
  assert.equal(cancelAfter.content, cancelBefore.content);
});

// picker-links: Task Link session harness. Each resolved target keeps its own
// note content, so the batch reads every streak from its own note.

class LinkTestEditor {
  constructor(content) {
    this.content = content;
  }
  getValue() {
    return this.content;
  }
  getLine(line) {
    return this.content.split(/\r?\n/)[line] ?? null;
  }
}

class LinkTransactionEditor extends LinkTestEditor {
  constructor(content, cursor) {
    super(content);
    this.cursor = { ...cursor };
  }
  getCursor() {
    return { ...this.cursor };
  }
  setCursor(lineOrPosition, ch) {
    this.cursor = {
      ...(typeof lineOrPosition === "object"
        ? lineOrPosition
        : { line: lineOrPosition, ch }),
    };
  }
  getScrollInfo() {
    return { left: 0, top: 0 };
  }
  transaction(transaction) {
    const changes = [...(transaction.changes || [])].sort(
      (left, right) =>
        right.from.line - left.from.line || right.from.ch - left.from.ch,
    );
    const offset = (position) => {
      const lines = this.content.split(/\r?\n/);
      return (
        lines
          .slice(0, position.line)
          .reduce((sum, line) => sum + line.length + 1, 0) + position.ch
      );
    };
    for (const change of changes) {
      const start = offset(change.from);
      const end = offset(change.to || change.from);
      this.content =
        this.content.slice(0, start) + change.text + this.content.slice(end);
    }
    if (transaction.selection) {
      this.cursor = {
        ...(transaction.selection.to || transaction.selection.from),
      };
    }
  }
}

function createLinkRollHarness(harnessOptions = {}) {
  const notes = { ...(harnessOptions.notes || {}) };
  const linkPath = harnessOptions.linkPath || "Plan.md";
  const linkEditor = new LinkTransactionEditor(
    harnessOptions.linkContent ?? "- [[Tasks#^a1]]",
    harnessOptions.cursor || { line: 0, ch: 0 },
  );
  const openEditors = new Map([[linkPath, linkEditor]]);
  for (const [path, editor] of Object.entries(
    harnessOptions.openEditors || {},
  )) {
    openEditors.set(path, editor);
  }
  const files = new Map();
  for (const path of new Set([linkPath, ...Object.keys(notes)])) {
    files.set(path, {
      path,
      basename: path.split("/").pop(),
      extension: "md",
    });
  }
  const app = {
    vault: {
      getAbstractFileByPath: (path) => files.get(path) || null,
      cachedRead: async (file) => {
        if (!file || !(file.path in notes)) {
          throw new Error(`missing file: ${file && file.path}`);
        }
        return notes[file.path];
      },
      read: async (file) => notes[file.path],
      process: async (file, fn) => {
        const before = notes[file.path];
        const after = fn(before);
        notes[file.path] = after;
      },
      getMarkdownFiles: () => [...files.values()],
    },
    metadataCache: {
      getFirstLinkpathDest: (lookup) => {
        const text = String(lookup || "").replace(/\.md$/i, "");
        if (files.has(`${text}.md`)) {
          return files.get(`${text}.md`);
        }
        if (files.has(text)) {
          return files.get(text);
        }
        const base = text.split("/").pop().toLowerCase();
        const matches = [...files.values()].filter(
          (file) =>
            file.basename.toLowerCase() === base ||
            file.basename.toLowerCase() === `${base}.md`,
        );
        return matches.length === 1 ? matches[0] : null;
      },
    },
    workspace: {
      getLeavesOfType: (type) =>
        type === "markdown"
          ? [...openEditors.entries()].map(([path, editor]) => ({
              view: { file: files.get(path), editor },
            }))
          : [],
    },
  };
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = app;
  plugin.getActiveMarkdownView = () => ({
    editor: linkEditor,
    file: files.get(linkPath),
  });
  const config = harnessOptions.config || buildDecayConfig();
  const open = (options = {}) =>
    plugin.openLinkPicker(linkEditor, {
      config: typeof config === "function" ? config() : config,
      baseDate: new Date(2026, 8, 30),
      random: () => 0,
      ...options,
    });
  return { notes, files, linkEditor, openEditors, plugin, linkPath, config, open };
}

function linkResolvedTargets(notes, specs) {
  return specs.map(([path, line]) => {
    const content = notes[path];
    return {
      path,
      file: null,
      content,
      line,
      rawLine: content.split("\n")[line],
    };
  });
}

async function flushLinkRollWrites() {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
    if (notices.some((message) => /Rolled|no tasks were updated|Could not/.test(message))) {
      return;
    }
  }
}

test("picker-links aggregates one recommendation per note", () => {
  const property = decayProperty();
  const rollP2 = "🎲 P2 roll · in **17** (8–30) days";
  const rollP4 = "🎲 P4 roll · in **200** (91–365) days";
  const notes = {
    "Tasks.md": [
      "- [ ] #task A [priority:: medium] [scheduled:: 2026-10-01] ^a1",
      "\t- 🗓️ **SCHEDULE LOG**",
      "- [ ] #task B [priority:: medium] [scheduled:: 2026-10-01] ^b1",
      "\t- 🗓️ **SCHEDULE LOG**",
      `\t\t- *2026-10-01* — ${rollP2}`,
    ].join("\n"),
    "Other.md": [
      "- [ ] #task C [priority:: lowest] [scheduled:: 2026-10-01] ^c1",
      "\t- 🗓️ **SCHEDULE LOG**",
      `\t\t- *2026-10-01* — ${rollP4}`,
      "- [ ] #task D [scheduled:: 2026-10-01] ^d1",
    ].join("\n"),
  };
  const resolved = linkResolvedTargets(notes, [
    ["Tasks.md", 0],
    ["Tasks.md", 2],
    ["Other.md", 0],
    ["Other.md", 3],
  ]);
  const summary = helpers.planLinkRollBatchSummary(resolved, property, {
    baseDate: new Date(2026, 8, 30),
    random: () => 0,
  });
  assert.deepEqual(summary.counts, { roll: 1, decay: 1, cancel: 1, unavailable: 0 });
  assert.equal(summary.total, 4);
  assert.equal(summary.actionableCount, 3);
  assert.equal(summary.skippedCount, 1);
  assert.equal(summary.hasRecommendation, true);
  assert.equal(summary.allRollSameLevel, false);
  assert.deepEqual(
    summary.entries.map((entry) => entry.path),
    ["Tasks.md", "Tasks.md", "Other.md", "Other.md"],
  );
  assert.deepEqual(
    summary.entries.map((entry) =>
      entry.recommendation ? entry.recommendation.kind : entry.skipped,
    ),
    ["roll", "decay", "cancel", "no-priority"],
  );
  assert.equal(summary.dateStart, "2026-10-08");
  assert.equal(summary.dateEnd, "2026-10-31");
  assert.equal(summary.groups.length, 2);
  assert.equal(summary.groups[0].summary.actionableCount, 2);
  assert.equal(summary.groups[1].summary.actionableCount, 1);
  assert.equal(Object.isFrozen(summary), true);
  assert.equal(Object.isFrozen(summary.entries[0]), true);

  const batchPreview = helpers.buildBatchPriorityRollPreviewModel(summary);
  assert.equal(batchPreview.action, "3 tasks · 1 roll · 1 decay · 1 cancel");

  const single = helpers.planLinkRollBatchSummary(
    linkResolvedTargets(notes, [["Tasks.md", 0]]),
    property,
    { baseDate: new Date(2026, 8, 30), random: () => 0 },
  );
  assert.equal(single.total, 1);
  const singlePreview = helpers.buildLinkRollPreviewModel(
    single,
    new Date(2026, 8, 30),
  );
  assert.equal(singlePreview.action, "P2 roll");
  assert.equal(singlePreview.footerLabel, "Roll P2");
  assert.match(singlePreview.ariaLabel, /Ctrl\+Enter: P2 roll/);

  const multiPreview = helpers.buildLinkRollPreviewModel(
    summary,
    new Date(2026, 8, 30),
  );
  assert.equal(multiPreview.action, "3 tasks · 1 roll · 1 decay · 1 cancel");
  assert.equal(multiPreview.footerLabel, "Apply 3 recommendations");
  assert.equal(helpers.buildLinkRollPreviewModel(null), null);
  assert.equal(
    helpers.buildLinkRollPreviewModel(
      helpers.planLinkRollBatchSummary([], property, {}),
      new Date(2026, 8, 30),
    ),
    null,
  );
});

test("picker-links refuses a recurring cancel as one batch", () => {
  const property = decayProperty();
  const rollP4 = "🎲 P4 roll · in **200** (91–365) days";
  const notes = {
    "Tasks.md": [
      "- [ ] #task A [priority:: medium] [scheduled:: 2026-10-01] ^a1",
      "- [ ] #task C [priority:: lowest] [scheduled:: 2026-10-01] 🔁 ^c1",
      "\t- 🗓️ **SCHEDULE LOG**",
      `\t\t- *2026-10-01* — ${rollP4}`,
    ].join("\n"),
  };
  const summary = helpers.planLinkRollBatchSummary(
    linkResolvedTargets(notes, [
      ["Tasks.md", 0],
      ["Tasks.md", 1],
    ]),
    property,
    { baseDate: new Date(2026, 8, 30), random: () => 0 },
  );
  assert.ok(summary.unavailableReason);
  assert.equal(summary.hasRecommendation, false);
  const preview = helpers.buildLinkRollPreviewModel(
    summary,
    new Date(2026, 8, 30),
  );
  assert.equal(preview.kind, "unavailable");
  assert.equal(preview.action, "Cannot apply");
});

test("picker-links takes a single recommended roll with Ctrl+Enter", async () => {
  notices.length = 0;
  const taskEditor = new LinkTransactionEditor(
    "- [ ] #task Ship it [priority:: medium] [scheduled:: 2026-10-01] ^a1",
    { line: 0, ch: 0 },
  );
  const harness = createLinkRollHarness({
    linkContent: "- [[Tasks#^a1]]",
    notes: {
      "Tasks.md": "- [ ] #task Ship it [priority:: medium] [scheduled:: 2026-10-01] ^a1",
    },
    openEditors: { "Tasks.md": taskEditor },
  });
  assert.equal(await harness.open(), true);
  const picker = harness.plugin.activeBulletPropertyPicker;
  assert.ok(picker.isLinkSession());
  const preview = picker.taskCardModel.recommendation.preview;
  assert.equal(preview.action, "P2 roll");
  assert.equal(preview.footerLabel, "Roll P2");
  assert.match(preview.ariaLabel, /Ctrl\+Enter: P2 roll/);

  selectRollPropertyRow(picker, "scheduled");
  picker.handleKeydown({
    key: "Enter",
    ctrlKey: true,
    preventDefault() {},
    stopPropagation() {},
  });
  await flushLinkRollWrites();
  assert.match(
    taskEditor.content,
    /- \[\?\] #task Ship it \[priority:: medium\] \[scheduled:: 2026-10-08\].*\^a1/,
  );
  assert.match(
    taskEditor.content,
    /🎲 P2 roll · in \*\*8\*\* \(8–30\) days/,
  );
  assert.match(notices.at(-1), /Rolled 1 task/);
});

test("picker-links shows no pinned roll row in stage two", async () => {
  notices.length = 0;
  const harness = createLinkRollHarness({
    linkContent: "- [[Tasks#^a1]]",
    notes: {
      "Tasks.md": "- [ ] #task Ship it [priority:: medium] [scheduled:: 2026-10-01] ^a1",
    },
  });
  assert.equal(await harness.open(), true);
  const picker = harness.plugin.activeBulletPropertyPicker;
  await picker.openTaskCardAction("schedule");
  assert.equal(picker.stage, "value");
  assert.equal(picker.selectedPropertyItem.property.name, "scheduled");
  assert.equal(
    picker.items.some((item) => item && item.priorityRoll),
    false,
  );
  const footerLabels = picker.footerHints.map((hint) => hint.label);
  assert.ok(footerLabels.includes("Roll P2"));
});

test("picker-links decays and cancels a single Task Link", async () => {
  notices.length = 0;
  const rollP2 = "🎲 P2 roll · in **17** (8–30) days";
  const decayEditor = new LinkTransactionEditor(
    [
      "- [ ] #task Ship it [priority:: medium] [scheduled:: 2026-10-01] ^a1",
      "\t- 🗓️ **SCHEDULE LOG**",
      `\t\t- *2026-10-01* — ${rollP2}`,
    ].join("\n"),
    { line: 0, ch: 0 },
  );
  const decayHarness = createLinkRollHarness({
    linkContent: "- [[Tasks#^a1]]",
    notes: {
      "Tasks.md": [
        "- [ ] #task Ship it [priority:: medium] [scheduled:: 2026-10-01] ^a1",
        "\t- 🗓️ **SCHEDULE LOG**",
        `\t\t- *2026-10-01* — ${rollP2}`,
      ].join("\n"),
    },
    openEditors: { "Tasks.md": decayEditor },
  });
  assert.equal(await decayHarness.open(), true);
  const decayPicker = decayHarness.plugin.activeBulletPropertyPicker;
  assert.equal(decayPicker.taskCardModel.recommendation.preview.action, "P2 → P3");
  assert.equal(await decayPicker.applyLinkRecommendedRoll(), true);
  assert.match(
    decayEditor.content,
    /\[priority:: low\] \[scheduled:: 2026-10-31\]/,
  );
  assert.match(
    decayEditor.content,
    /🎲 P2 → P3 decay · in \*\*31\*\* \(31–90\) days/,
  );
  assert.match(notices.at(-1), /Rolled 1 task/);

  notices.length = 0;
  const rollP4 = "🎲 P4 roll · in **200** (91–365) days";
  const cancelHarness = createLinkRollHarness({
    linkContent: "- [[Tasks#^a1]]",
    notes: {
      "Tasks.md": [
        "- [ ] #task Ship it [priority:: lowest] [scheduled:: 2026-10-01] ^a1",
        "\t- 🗓️ **SCHEDULE LOG**",
        `\t\t- *2026-10-01* — ${rollP4}`,
      ].join("\n"),
    },
  });
  assert.equal(await cancelHarness.open(), true);
  const cancelPicker = cancelHarness.plugin.activeBulletPropertyPicker;
  assert.equal(cancelPicker.taskCardModel.recommendation.preview.action, "Cancel task");
  assert.equal(await cancelPicker.applyLinkRecommendedRoll(), true);
  assert.match(
    cancelHarness.notes["Tasks.md"],
    /- \[-\] #task Ship it.*\[cancelled:: 2026-09-30\]/,
  );
  assert.match(
    cancelHarness.notes["Tasks.md"],
    /🍂 decayed past P4 after 1 roll/,
  );
});

test("picker-links applies a mixed batch across two notes", async () => {
  notices.length = 0;
  const rollP2 = "🎲 P2 roll · in **17** (8–30) days";
  const rollP4 = "🎲 P4 roll · in **200** (91–365) days";
  const tasksEditor = new LinkTransactionEditor(
    [
      "- [ ] #task A [priority:: medium] [scheduled:: 2026-10-01] ^a1",
      "\t- 🗓️ **SCHEDULE LOG**",
      "- [ ] #task B [priority:: medium] [scheduled:: 2026-10-01] ^b1",
      "\t- 🗓️ **SCHEDULE LOG**",
      `\t\t- *2026-10-01* — ${rollP2}`,
    ].join("\n"),
    { line: 0, ch: 0 },
  );
  const harness = createLinkRollHarness({
    linkContent: ["- [[Tasks#^a1]]", "- [[Tasks#^b1]]", "- [[Other#^c1]]"].join("\n"),
    notes: {
      "Tasks.md": [
        "- [ ] #task A [priority:: medium] [scheduled:: 2026-10-01] ^a1",
        "\t- 🗓️ **SCHEDULE LOG**",
        "- [ ] #task B [priority:: medium] [scheduled:: 2026-10-01] ^b1",
        "\t- 🗓️ **SCHEDULE LOG**",
        `\t\t- *2026-10-01* — ${rollP2}`,
      ].join("\n"),
      "Other.md": [
        "- [ ] #task C [priority:: lowest] [scheduled:: 2026-10-01] ^c1",
        "\t- 🗓️ **SCHEDULE LOG**",
        `\t\t- *2026-10-01* — ${rollP4}`,
      ].join("\n"),
    },
    openEditors: { "Tasks.md": tasksEditor },
  });
  assert.equal(
    await harness.open({ countExplicit: true, additionalTaskCount: 2 }),
    true,
  );
  const picker = harness.plugin.activeBulletPropertyPicker;
  const preview = picker.taskCardModel.recommendation.preview;
  assert.equal(preview.action, "3 tasks · 1 roll · 1 decay · 1 cancel");
  assert.equal(preview.dateText, "2026-10-08 → 2026-10-31");
  assert.equal(preview.footerLabel, "Apply 3 recommendations");
  assert.equal(await picker.applyLinkRecommendedRoll(), true);
  assert.match(
    tasksEditor.content,
    /\[priority:: medium\] \[scheduled:: 2026-10-08\]/,
  );
  assert.match(
    tasksEditor.content,
    /\[priority:: low\] \[scheduled:: 2026-10-31\]/,
  );
  assert.match(
    harness.notes["Other.md"],
    /- \[-\] #task C.*\[cancelled:: 2026-09-30\]/,
  );
  assert.match(
    harness.notes["Other.md"],
    /🍂 decayed past P4 after 1 roll/,
  );
  assert.match(notices.at(-1), /Rolled 3 tasks/);
});

test("picker-links refuses the whole batch when a linked note changed", async () => {
  notices.length = 0;
  const taskEditor = new LinkTransactionEditor(
    "- [ ] #task Ship it [priority:: medium] [scheduled:: 2026-10-01] ^a1",
    { line: 0, ch: 0 },
  );
  const harness = createLinkRollHarness({
    linkContent: "- [[Tasks#^a1]]",
    notes: {
      "Tasks.md": "- [ ] #task Ship it [priority:: medium] [scheduled:: 2026-10-01] ^a1",
    },
    openEditors: { "Tasks.md": taskEditor },
  });
  assert.equal(await harness.open(), true);
  const picker = harness.plugin.activeBulletPropertyPicker;
  taskEditor.content =
    "- [ ] #task Ship it, edited elsewhere [priority:: medium] [scheduled:: 2026-10-01] ^a1";
  assert.equal(await picker.applyLinkRecommendedRoll(), false);
  assert.equal(
    taskEditor.content,
    "- [ ] #task Ship it, edited elsewhere [priority:: medium] [scheduled:: 2026-10-01] ^a1",
  );
  assert.match(notices.at(-1), /no tasks were updated/);
});

test("picker-links prunes today's open Pomodoro links", async () => {
  notices.length = 0;
  const dailyPath = "2026/20260930.md";
  const taskEditor = new LinkTransactionEditor(
    "- [ ] #task Ship it [priority:: medium] [scheduled:: 2026-10-01] ^a1",
    { line: 0, ch: 0 },
  );
  const harness = createLinkRollHarness({
    linkPath: "Plan.md",
    linkContent: "- [[Tasks#^a1]]",
    notes: {
      "Tasks.md": "- [ ] #task Ship it [priority:: medium] [scheduled:: 2026-10-01] ^a1",
      [dailyPath]: [
        "## Pomodoros",
        "",
        "- [ ] Current (0900-0930)",
        "  - [[Tasks#^a1]]",
        "  - keep me",
      ].join("\n"),
    },
    openEditors: { "Tasks.md": taskEditor },
  });
  assert.equal(await harness.open(), true);
  const picker = harness.plugin.activeBulletPropertyPicker;
  assert.equal(await picker.applyLinkRecommendedRoll(), true);
  assert.match(
    taskEditor.content,
    /- \[\?\] #task Ship it \[priority:: medium\] \[scheduled:: 2026-10-08\]/,
  );
  assert.equal(
    harness.notes[dailyPath],
    ["## Pomodoros", "", "- [ ] Current (0900-0930)", "  - keep me"].join("\n"),
  );
  assert.match(notices.at(-1), /removed 1 Pomodoro link/);
});

// picker-single / picker-counted end-to-end: drive BulletPropertyPickerModal
// through handleKeydown with an editor that records undo groups. The
// recommendation is previewed once at open (base date 2026-09-30,
// random () => 0), Ctrl+Enter writes it, and the write is async so tests
// flush timers before asserting.

class RollTestEditor {
  constructor(content) {
    this.content = content;
  }
  getValue() {
    return this.content;
  }
  getLine(line) {
    return this.content.split(/\r?\n/)[line] ?? null;
  }
  replaceRange(text, from, to = from) {
    const newline = this.content.includes("\r\n") ? "\r\n" : "\n";
    const lines = this.content.split(/\r?\n/);
    const offset = (position) =>
      lines
        .slice(0, position.line)
        .reduce((sum, line) => sum + line.length + newline.length, 0) +
      position.ch;
    const start = offset(from);
    const end = offset(to);
    this.content = this.content.slice(0, start) + text + this.content.slice(end);
  }
}

class RollTransactionEditor extends RollTestEditor {
  constructor(content, cursor) {
    super(content);
    this.cursor = { ...cursor };
    this.transactions = [];
    this.undoGroups = 0;
  }
  getCursor() {
    return { ...this.cursor };
  }
  getScrollInfo() {
    return { left: 0, top: 0 };
  }
  setCursor(lineOrPosition, ch) {
    this.cursor = {
      ...(typeof lineOrPosition === "object"
        ? lineOrPosition
        : { line: lineOrPosition, ch }),
    };
  }
  transaction(transaction) {
    this.transactions.push(JSON.parse(JSON.stringify(transaction)));
    if (transaction.changes && transaction.changes.length > 0) {
      this.undoGroups += 1;
    }
    const changes = [...(transaction.changes || [])].sort(
      (left, right) =>
        right.from.line - left.from.line || right.from.ch - left.from.ch,
    );
    for (const change of changes) {
      super.replaceRange(change.text, change.from, change.to || change.from);
    }
    if (transaction.selection) {
      this.cursor = {
        ...(transaction.selection.to || transaction.selection.from),
      };
    }
  }
}

function createRollPickerHarness(harnessOptions = {}) {
  const editor = new RollTransactionEditor(
    harnessOptions.content ?? "- [ ] #task A [priority:: medium] [scheduled:: 2026-10-01] ^a",
    harnessOptions.cursor || { line: 0, ch: 0 },
  );
  const file = harnessOptions.file || {
    path: "Tasks.md",
    basename: "Tasks",
    extension: "md",
  };
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = harnessOptions.app || {};
  plugin.getActiveMarkdownView = () => ({ editor, file });
  const config = harnessOptions.config || buildDecayConfig();
  const open = (options = {}) =>
    plugin.openBulletPropertyPicker(editor, {
      config,
      baseDate: new Date(2026, 8, 30),
      random: () => 0,
      ...options,
    });
  return { config, editor, file, open, plugin };
}

function rollCtrlEnter() {
  return { key: "Enter", ctrlKey: true, preventDefault() {}, stopPropagation() {} };
}

function rollPlainEnter() {
  return { key: "Enter", preventDefault() {}, stopPropagation() {} };
}

async function flushRollWrites(plugin, beforeNoticeCount) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
    if (notices.length !== beforeNoticeCount) {
      await new Promise((resolve) => {
        setTimeout(resolve, 5);
      });
      return;
    }
    if (!plugin.activeBulletPropertyPicker) {
      return;
    }
  }
}

// The Task Card is the only surface: the schedule row is the card's
// `scheduled` action, and it is the row the card opens on.
function selectRollPropertyRow(picker, name) {
  assert.equal(name, "scheduled");
  assert.equal(picker.stage, "task-card");
  picker.selectTaskCardRow("schedule");
  assert.equal(picker.taskCardSelectedRowId, "schedule");
}

function rollCtrlR() {
  return { key: "r", ctrlKey: true, preventDefault() {}, stopPropagation() {} };
}

test("picker-single Ctrl+Enter rolls a P2 task in one undo group", async () => {
  notices.length = 0;
  const harness = createRollPickerHarness({
    content: "- [ ] #task A [priority:: medium] [scheduled:: 2026-10-01] ^a",
  });
  assert.equal(harness.open(), true);
  const picker = harness.plugin.activeBulletPropertyPicker;
  assert.equal(picker.priorityRollRecommendation.kind, "roll");
  selectRollPropertyRow(picker, "scheduled");
  const before = notices.length;
  picker.handleKeydown(rollCtrlEnter());
  await flushRollWrites(harness.plugin, before);
  assert.equal(harness.plugin.activeBulletPropertyPicker, null);
  assert.equal(harness.editor.undoGroups, 1);
  assert.equal(
    harness.editor.content,
    [
      "- [?] #task A [priority:: medium] [scheduled:: 2026-10-08] ^a",
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-10-01 → 2026-10-08* — 🎲 P2 roll · in **8** (8–30) days",
    ].join("\n"),
  );
});

test("picker-single opens on scheduled so Ctrl+Enter rolls with no navigation", async () => {
  notices.length = 0;
  const harness = createRollPickerHarness({
    content: "- [ ] #task A [priority:: medium] [scheduled:: 2026-10-01] ^a",
  });
  assert.equal(harness.open(), true);
  const picker = harness.plugin.activeBulletPropertyPicker;
  assert.equal(picker.priorityRollRecommendation.kind, "roll");
  assert.equal(picker.stage, "task-card");
  assert.equal(picker.taskCardSelectedRowId, "schedule");
  assert.equal(picker.taskCardModel.recommendation.available, true);
  const before = notices.length;
  picker.handleKeydown(rollCtrlEnter());
  await flushRollWrites(harness.plugin, before);
  assert.equal(harness.plugin.activeBulletPropertyPicker, null);
  assert.equal(harness.editor.undoGroups, 1);
  assert.equal(
    harness.editor.content,
    [
      "- [?] #task A [priority:: medium] [scheduled:: 2026-10-08] ^a",
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-10-01 → 2026-10-08* — 🎲 P2 roll · in **8** (8–30) days",
    ].join("\n"),
  );
});

test("picker-single opens a ^prj task on scheduled for an immediate roll", async () => {
  notices.length = 0;
  const harness = createRollPickerHarness({
    content: [
      "---",
      "type: [[project]]",
      "scheduled: 2026-10-01",
      "---",
      "- [ ] #task Ship [priority:: medium] ^prj",
    ].join("\n"),
    cursor: { line: 4, ch: 0 },
  });
  assert.equal(harness.open(), true);
  const picker = harness.plugin.activeBulletPropertyPicker;
  assert.equal(picker.priorityRollRecommendation.kind, "roll");
  assert.equal(picker.stage, "task-card");
  assert.equal(picker.taskCardSelectedRowId, "schedule");
  assert.equal(picker.taskCardModel.recommendation.available, true);
  const before = notices.length;
  picker.handleKeydown(rollCtrlEnter());
  await flushRollWrites(harness.plugin, before);
  assert.equal(harness.plugin.activeBulletPropertyPicker, null);
  assert.equal(harness.editor.undoGroups, 1);
  assert.match(harness.editor.content, /scheduled: 2026-10-08/);
  assert.match(harness.editor.content, /🎲 P2 roll · in \*\*8\*\* \(8–30\) days/);
});

test("picker-counted opens on scheduled for an immediate mixed batch", async () => {
  notices.length = 0;
  const harness = createRollPickerHarness({
    content: [
      "- [ ] #task A [priority:: medium] [scheduled:: 2026-10-01] ^a",
      "- [ ] #task B [priority:: medium] ^b",
      "- [ ] #task C [priority:: low] [scheduled:: 2026-10-01] ^c",
    ].join("\n"),
  });
  assert.equal(harness.open({ countExplicit: true, additionalTaskCount: 2 }), true);
  const picker = harness.plugin.activeBulletPropertyPicker;
  assert.equal(picker.isCountedSession(), true);
  assert.equal(picker.stage, "task-card");
  assert.equal(picker.taskCardSelectedRowId, "schedule");
  assert.equal(picker.taskCardModel.recommendation.available, true);
  const before = notices.length;
  picker.handleKeydown(rollCtrlEnter());
  await flushRollWrites(harness.plugin, before);
  assert.equal(harness.plugin.activeBulletPropertyPicker, null);
  assert.equal(harness.editor.undoGroups, 1);
  assert.match(
    harness.editor.content,
    /- \[\?\] #task A \[priority:: medium\] \[scheduled:: 2026-10-08\] \^a/,
  );
  assert.match(
    harness.editor.content,
    /- \[\?\] #task B \[priority:: medium\] \[scheduled:: 2026-10-08\] \^b/,
  );
  assert.match(
    harness.editor.content,
    /- \[\?\] #task C \[priority:: low\] \[scheduled:: 2026-10-31\] \^c/,
  );
  assert.match(harness.editor.content, /🎲 P2 roll · in \*\*8\*\* \(8–30\) days/);
  assert.match(harness.editor.content, /🎲 P3 roll · in \*\*31\*\* \(31–90\) days/);
});

test("picker-links opens on scheduled for an immediate roll", async () => {
  notices.length = 0;
  const taskEditor = new LinkTransactionEditor(
    "- [ ] #task Ship it [priority:: medium] [scheduled:: 2026-10-01] ^a1",
    { line: 0, ch: 0 },
  );
  const harness = createLinkRollHarness({
    linkContent: "- [[Tasks#^a1]]",
    notes: {
      "Tasks.md": "- [ ] #task Ship it [priority:: medium] [scheduled:: 2026-10-01] ^a1",
    },
    openEditors: { "Tasks.md": taskEditor },
  });
  assert.equal(await harness.open(), true);
  const picker = harness.plugin.activeBulletPropertyPicker;
  assert.equal(picker.isLinkSession(), true);
  assert.equal(picker.stage, "task-card");
  assert.equal(picker.taskCardSelectedRowId, "schedule");
  assert.equal(picker.taskCardModel.recommendation.available, true);
  const before = notices.length;
  picker.handleKeydown(rollCtrlEnter());
  await flushRollWrites(harness.plugin, before);
  assert.equal(harness.plugin.activeBulletPropertyPicker, null);
  assert.match(
    taskEditor.content,
    /\[priority:: medium\] \[scheduled:: 2026-10-08\]/,
  );
  assert.match(taskEditor.content, /🎲 P2 roll · in \*\*8\*\* \(8–30\) days/);
});

test("picker-single Ctrl+Enter decays a P2 task in one undo group", async () => {
  notices.length = 0;
  const harness = createRollPickerHarness({
    content: [
      "- [ ] #task B [priority:: medium] [scheduled:: 2026-10-01] ^b",
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-10-01* — 🎲 P2 roll · in **17** (8–30) days",
    ].join("\n"),
  });
  assert.equal(harness.open(), true);
  const picker = harness.plugin.activeBulletPropertyPicker;
  assert.equal(picker.priorityRollRecommendation.kind, "decay");
  selectRollPropertyRow(picker, "scheduled");
  const before = notices.length;
  picker.handleKeydown(rollCtrlEnter());
  await flushRollWrites(harness.plugin, before);
  assert.equal(harness.plugin.activeBulletPropertyPicker, null);
  assert.equal(harness.editor.undoGroups, 1);
  assert.equal(
    harness.editor.content,
    [
      "- [?] #task B [priority:: low] [scheduled:: 2026-10-31] ^b",
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-10-01 → 2026-10-31* — 🎲 P2 → P3 decay · in **31** (31–90) days",
      "\t\t- *2026-10-01* — 🎲 P2 roll · in **17** (8–30) days",
    ].join("\n"),
  );
  assert.match(notices.at(-1), /priority → P3 \(low\) · decayed from P2/);
});

test("picker-single Ctrl+Enter cancels a P4 task in one undo group", async () => {
  notices.length = 0;
  const harness = createRollPickerHarness({
    content: [
      "- [ ] #task C [priority:: lowest] [scheduled:: 2026-10-01] ^c",
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-10-01* — 🎲 P4 roll · in **200** (91–365) days",
    ].join("\n"),
  });
  assert.equal(harness.open(), true);
  const picker = harness.plugin.activeBulletPropertyPicker;
  assert.equal(picker.priorityRollRecommendation.kind, "cancel");
  selectRollPropertyRow(picker, "scheduled");
  const before = notices.length;
  picker.handleKeydown(rollCtrlEnter());
  await flushRollWrites(harness.plugin, before);
  assert.equal(harness.plugin.activeBulletPropertyPicker, null);
  assert.equal(harness.editor.undoGroups, 1);
  assert.equal(
    harness.editor.content,
    [
      "- [-] #task C [priority:: lowest] [scheduled:: 2026-10-01] [cancelled:: 2026-09-30] ^c",
      "\t- ❌ **CANCEL LOG**",
      "\t\t- *2026-09-30* — 🍂 decayed past P4 after 1 roll",
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-10-01* — 🎲 P4 roll · in **200** (91–365) days",
    ].join("\n"),
  );
});

test("picker-single Ctrl+Enter in stage two writes the recommended roll", async () => {
  notices.length = 0;
  const harness = createRollPickerHarness({
    content: "- [ ] #task A [priority:: medium] [scheduled:: 2026-10-01] ^a",
  });
  assert.equal(harness.open(), true);
  let picker = harness.plugin.activeBulletPropertyPicker;
  await picker.openTaskCardAction("schedule");
  picker = harness.plugin.activeBulletPropertyPicker;
  assert.equal(picker.stage, "value");
  const pinned = picker.items.find((item) => item && item.priorityRoll);
  assert.ok(pinned);
  assert.equal(pinned.value, picker.priorityRollRecommendation.date);
  assert.equal(pinned.value, "2026-10-08");
  const presetIndex = picker.visibleItems.findIndex(
    (item) => item && !item.priorityRoll,
  );
  assert.notEqual(presetIndex, -1);
  picker.selectedIndex = presetIndex;
  const before = notices.length;
  picker.handleKeydown(rollCtrlEnter());
  await flushRollWrites(harness.plugin, before);
  assert.equal(harness.plugin.activeBulletPropertyPicker, null);
  assert.equal(harness.editor.undoGroups, 1);
  assert.match(
    harness.editor.content,
    /\[scheduled:: 2026-10-08\]/,
  );
  assert.match(harness.editor.content, /🎲 P2 roll · in \*\*8\*\* \(8–30\) days/);
});

test("picker-single Enter opens the date stage; Ctrl+Enter takes the recommendation", async () => {
  const content = "- [ ] #task A [priority:: medium] [scheduled:: 2026-10-01] ^a";
  const harness = createRollPickerHarness({ content });
  assert.equal(harness.open(), true);
  const picker = harness.plugin.activeBulletPropertyPicker;
  selectRollPropertyRow(picker, "scheduled");
  picker.handleKeydown(rollPlainEnter());
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
  assert.equal(picker.stage, "value");
  assert.equal(picker.selectedPropertyItem.property.name, "scheduled");
  assert.equal(harness.plugin.activeBulletPropertyPicker, picker);
  assert.equal(harness.editor.content, content);
  assert.equal(harness.editor.undoGroups, 0);
});

test("picker-single P0 and closed tasks have no preview and Ctrl+Enter writes nothing", async () => {
  for (const content of [
    "- [ ] #task D [scheduled:: 2026-10-01] ^d",
    "- [x] #task E [priority:: medium] [scheduled:: 2026-10-01] ^e",
  ]) {
    notices.length = 0;
    const harness = createRollPickerHarness({ content });
    assert.equal(harness.open(), true);
    const picker = harness.plugin.activeBulletPropertyPicker;
    assert.equal(picker.priorityRollRecommendation, null);
    assert.equal(picker.taskCardModel.recommendation, null);
    selectRollPropertyRow(picker, "scheduled");
    picker.handleKeydown(rollCtrlEnter());
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    assert.equal(picker.stage, "task-card", content);
    assert.match(notices.at(-1), /No recommendation is available/, content);
    assert.equal(harness.plugin.activeBulletPropertyPicker, picker, content);
    assert.equal(harness.editor.content, content, content);
    assert.equal(harness.editor.undoGroups, 0, content);
  }
});

test("picker-single recurring P4 past the limit refuses and keeps the picker open", async () => {
  notices.length = 0;
  const content = [
    "- [ ] #task C [priority:: lowest] [scheduled:: 2026-10-01] 🔁 ^c",
    "\t- 🗓️ **SCHEDULE LOG**",
    "\t\t- *2026-10-01* — 🎲 P4 roll · in **200** (91–365) days",
  ].join("\n");
  const harness = createRollPickerHarness({ content });
  assert.equal(harness.open(), true);
  const picker = harness.plugin.activeBulletPropertyPicker;
  assert.equal(picker.priorityRollRecommendation.kind, "unavailable");
  selectRollPropertyRow(picker, "scheduled");
  const before = notices.length;
  picker.handleKeydown(rollCtrlEnter());
  await flushRollWrites(harness.plugin, before);
  assert.match(notices.at(-1), /Recurring tasks are cancelled/);
  assert.equal(harness.editor.content, content);
  assert.equal(harness.plugin.activeBulletPropertyPicker, picker);
  assert.equal(harness.editor.undoGroups, 0);
});

test("picker-single stale tasks refuse and re-render the decay preview", async () => {
  notices.length = 0;
  const harness = createRollPickerHarness({
    content: "- [ ] #task A [priority:: medium] [scheduled:: 2026-10-01] ^a",
  });
  assert.equal(harness.open(), true);
  const picker = harness.plugin.activeBulletPropertyPicker;
  assert.equal(picker.priorityRollRecommendation.kind, "roll");
  harness.editor.content = [
    "- [ ] #task A [priority:: medium] [scheduled:: 2026-10-01] ^a",
    "\t- 🗓️ **SCHEDULE LOG**",
    "\t\t- *2026-10-01* — 🎲 P2 roll · in **17** (8–30) days",
  ].join("\n");
  selectRollPropertyRow(picker, "scheduled");
  const before = notices.length;
  picker.handleKeydown(rollCtrlEnter());
  await flushRollWrites(harness.plugin, before);
  assert.match(notices.at(-1), /Task changed while the picker was open; nothing was written/);
  assert.equal(
    harness.editor.content,
    [
      "- [ ] #task A [priority:: medium] [scheduled:: 2026-10-01] ^a",
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-10-01* — 🎲 P2 roll · in **17** (8–30) days",
    ].join("\n"),
  );
  assert.equal(harness.plugin.activeBulletPropertyPicker, picker);
  assert.equal(picker.stage, "task-card");
  assert.equal(picker.priorityRollRecommendation.kind, "decay");
  assert.equal(picker.taskCardModel.recommendation.source.kind, "decay");
});

test("picker-single Ctrl+R on the card re-rolls the recommendation date", async () => {
  const values = [0, 0.5];
  let index = 0;
  const harness = createRollPickerHarness({
    content: "- [ ] #task A [priority:: medium] [scheduled:: 2026-10-01] ^a",
  });
  assert.equal(
    harness.open({ random: () => values[index++ % values.length] }),
    true,
  );
  const picker = harness.plugin.activeBulletPropertyPicker;
  assert.equal(picker.priorityRollRecommendation.date, "2026-10-08");
  selectRollPropertyRow(picker, "scheduled");
  picker.handleKeydown(rollCtrlR());
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
  assert.equal(picker.priorityRollRecommendation.date, "2026-10-19");
  assert.equal(picker.taskCardModel.recommendation.source.date, "2026-10-19");
});

test("picker-single Ctrl+R in stage two keeps the pinned row and recommendation together", async () => {
  const values = [0, 0.5];
  let index = 0;
  const harness = createRollPickerHarness({
    content: "- [ ] #task A [priority:: medium] [scheduled:: 2026-10-01] ^a",
  });
  assert.equal(
    harness.open({ random: () => values[index++ % values.length] }),
    true,
  );
  let picker = harness.plugin.activeBulletPropertyPicker;
  await picker.openTaskCardAction("schedule");
  picker = harness.plugin.activeBulletPropertyPicker;
  assert.equal(picker.priorityRollRecommendation.date, "2026-10-08");
  assert.equal(
    picker.items.find((item) => item && item.priorityRoll).value,
    "2026-10-08",
  );
  picker.handleKeydown({
    key: "r",
    ctrlKey: true,
    preventDefault() {},
    stopPropagation() {},
  });
  assert.equal(picker.priorityRollRecommendation.date, "2026-10-19");
  assert.equal(
    picker.items.find((item) => item && item.priorityRoll).value,
    "2026-10-19",
  );
});

test("picker-single Ctrl+Enter rolls a ^prj task through frontmatter in one undo group", async () => {
  notices.length = 0;
  const harness = createRollPickerHarness({
    content: [
      "---",
      "type: [[project]]",
      "scheduled: 2026-10-01",
      "---",
      "- [ ] #task Ship [priority:: medium] ^prj",
    ].join("\n"),
    cursor: { line: 4, ch: 0 },
  });
  assert.equal(harness.open(), true);
  const picker = harness.plugin.activeBulletPropertyPicker;
  assert.equal(picker.priorityRollRecommendation.kind, "roll");
  selectRollPropertyRow(picker, "scheduled");
  const before = notices.length;
  picker.handleKeydown(rollCtrlEnter());
  await flushRollWrites(harness.plugin, before);
  assert.equal(harness.plugin.activeBulletPropertyPicker, null);
  assert.equal(harness.editor.undoGroups, 1);
  assert.match(harness.editor.content, /scheduled: 2026-10-08/);
  assert.match(harness.editor.content, /🎲 P2 roll · in \*\*8\*\* \(8–30\) days/);
});

test("picker-single Ctrl+Enter decays a ^prj task through frontmatter in one undo group", async () => {
  notices.length = 0;
  const harness = createRollPickerHarness({
    content: [
      "---",
      "type: [[project]]",
      "scheduled: 2026-10-01",
      "---",
      "- [ ] #task Ship [priority:: medium] ^prj",
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-10-01* — 🎲 P2 roll · in **17** (8–30) days",
    ].join("\n"),
    cursor: { line: 4, ch: 0 },
  });
  assert.equal(harness.open(), true);
  const picker = harness.plugin.activeBulletPropertyPicker;
  assert.equal(picker.priorityRollRecommendation.kind, "decay");
  selectRollPropertyRow(picker, "scheduled");
  const before = notices.length;
  picker.handleKeydown(rollCtrlEnter());
  await flushRollWrites(harness.plugin, before);
  assert.equal(harness.plugin.activeBulletPropertyPicker, null);
  assert.equal(harness.editor.undoGroups, 1);
  assert.match(harness.editor.content, /scheduled: 2026-10-31/);
  assert.match(harness.editor.content, /\[priority:: low\]/);
  assert.match(harness.editor.content, /🎲 P2 → P3 decay · in \*\*31\*\* \(31–90\) days/);
});

test("picker-counted Ctrl+Enter applies a mixed roll/decay/cancel batch in one undo group", async () => {
  notices.length = 0;
  const rollP2 = "🎲 P2 roll · in **17** (8–30) days";
  const rollP4 = "🎲 P4 roll · in **200** (91–365) days";
  const harness = createRollPickerHarness({
    content: [
      "- [ ] #task A [priority:: medium] [scheduled:: 2026-10-01] ^a",
      "- [ ] #task B [priority:: medium] [scheduled:: 2026-10-01] ^b",
      "\t- 🗓️ **SCHEDULE LOG**",
      `\t\t- *2026-10-01* — ${rollP2}`,
      "- [ ] #task C [priority:: lowest] [scheduled:: 2026-10-01] ^c",
      "\t- 🗓️ **SCHEDULE LOG**",
      `\t\t- *2026-10-01* — ${rollP4}`,
      "- [x] #task D [priority:: medium] [scheduled:: 2026-10-01] ^d",
    ].join("\n"),
  });
  assert.equal(harness.open({ countExplicit: true, additionalTaskCount: 3 }), true);
  const picker = harness.plugin.activeBulletPropertyPicker;
  assert.equal(picker.isCountedSession(), true);
  assert.deepEqual(picker.countedRollBatch.counts, { roll: 1, decay: 1, cancel: 1, unavailable: 0 });
  selectRollPropertyRow(picker, "scheduled");
  const before = notices.length;
  picker.handleKeydown(rollCtrlEnter());
  await flushRollWrites(harness.plugin, before);
  assert.equal(harness.plugin.activeBulletPropertyPicker, null);
  assert.equal(harness.editor.undoGroups, 1);
  assert.equal(
    harness.editor.content,
    [
      "- [?] #task A [priority:: medium] [scheduled:: 2026-10-08] ^a",
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-10-01 → 2026-10-08* — 🎲 P2 roll · in **8** (8–30) days",
      "- [?] #task B [priority:: low] [scheduled:: 2026-10-31] ^b",
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-10-01 → 2026-10-31* — 🎲 P2 → P3 decay · in **31** (31–90) days",
      `\t\t- *2026-10-01* — ${rollP2}`,
      "- [-] #task C [priority:: lowest] [scheduled:: 2026-10-01] [cancelled:: 2026-09-30] ^c",
      "\t- ❌ **CANCEL LOG**",
      "\t\t- *2026-09-30* — 🍂 decayed past P4 after 1 roll",
      "\t- 🗓️ **SCHEDULE LOG**",
      `\t\t- *2026-10-01* — ${rollP4}`,
      "- [x] #task D [priority:: medium] [scheduled:: 2026-10-01] ^d",
    ].join("\n"),
  );
  assert.match(notices.at(-1), /Rolled 3 tasks/);
  assert.match(notices.at(-1), /1 rolled/);
  assert.match(notices.at(-1), /1 decayed/);
  assert.match(notices.at(-1), /1 cancelled/);
  assert.match(notices.at(-1), /1 task skipped/);
});

test("picker-counted Ctrl+Enter refuses when a target line changed", async () => {
  notices.length = 0;
  const harness = createRollPickerHarness({
    content: [
      "- [ ] #task A [priority:: medium] [scheduled:: 2026-10-01] ^a",
      "- [ ] #task B [priority:: medium] [scheduled:: 2026-10-01] ^b",
    ].join("\n"),
  });
  assert.equal(harness.open({ countExplicit: true, additionalTaskCount: 1 }), true);
  const picker = harness.plugin.activeBulletPropertyPicker;
  const edited = [
    "- [ ] #task A edited elsewhere [priority:: medium] [scheduled:: 2026-10-01] ^a",
    "- [ ] #task B [priority:: medium] [scheduled:: 2026-10-01] ^b",
  ].join("\n");
  harness.editor.content = edited;
  selectRollPropertyRow(picker, "scheduled");
  const before = notices.length;
  picker.handleKeydown(rollCtrlEnter());
  await flushRollWrites(harness.plugin, before);
  assert.match(notices.at(-1), /changed while the picker was open/);
  assert.equal(harness.editor.content, edited);
  assert.equal(harness.plugin.activeBulletPropertyPicker, picker);
  assert.equal(harness.editor.undoGroups, 0);
});

test("picker-counted Ctrl+Enter refuses a recurring cancel batch", async () => {
  notices.length = 0;
  const rollP4 = "🎲 P4 roll · in **200** (91–365) days";
  const content = [
    "- [ ] #task A [priority:: medium] [scheduled:: 2026-10-01] ^a",
    "- [ ] #task C [priority:: lowest] [scheduled:: 2026-10-01] 🔁 ^c",
    "\t- 🗓️ **SCHEDULE LOG**",
    `\t\t- *2026-10-01* — ${rollP4}`,
  ].join("\n");
  const harness = createRollPickerHarness({ content });
  assert.equal(harness.open({ countExplicit: true, additionalTaskCount: 1 }), true);
  const picker = harness.plugin.activeBulletPropertyPicker;
  assert.ok(picker.countedRollBatch.unavailableReason);
  selectRollPropertyRow(picker, "scheduled");
  const before = notices.length;
  picker.handleKeydown(rollCtrlEnter());
  await flushRollWrites(harness.plugin, before);
  assert.match(notices.at(-1), /Recurring tasks are cancelled/);
  assert.equal(harness.editor.content, content);
  assert.equal(harness.plugin.activeBulletPropertyPicker, picker);
  assert.equal(harness.editor.undoGroups, 0);
});

async function confirmSchedulingWorkLogStage(picker, summary = "") {
  assert.equal(picker.stage, "schedule-work-log");
  picker.inputEl = { value: summary };
  picker.visibleItems = picker.getFilteredItems();
  return await picker.openItemAtIndex(0);
}

test("recommended roll on Pending offers a Work Log with the frozen date", async () => {
  notices.length = 0;
  const content = "- [/] #task A [priority:: medium] [scheduled:: 2026-09-01] ^a";
  const harness = createRollPickerHarness({ content });
  assert.equal(harness.open(), true);
  const picker = harness.plugin.activeBulletPropertyPicker;
  assert.ok(picker.priorityRollRecommendation);
  assert.equal(picker.priorityRollRecommendation.kind, "roll");
  const frozenDate = picker.priorityRollRecommendation.date;
  const before = notices.length;
  picker.handleKeydown(rollCtrlEnter());
  await flushRollWrites(harness.plugin, before);
  assert.equal(picker.stage, "schedule-work-log");
  assert.equal(harness.editor.content, content);
  assert.match(picker.getSchedulingWorkLogSubtitle(), new RegExp(frozenDate));
  await confirmSchedulingWorkLogStage(picker, "Rolled work");
  assert.ok(harness.editor.content.includes(`[scheduled:: ${frozenDate}]`));
  assert.match(harness.editor.content, /\*2026-09-30\* — Rolled work/);
  assert.match(harness.editor.content, /🛠️ \*\*WORK LOG\*\*/);
});

test("recommended roll blank summary skips the Work Log without a fallback", async () => {
  notices.length = 0;
  const content = "- [*] #task A [priority:: medium] [scheduled:: 2026-09-01] ^a";
  const harness = createRollPickerHarness({ content });
  assert.equal(harness.open(), true);
  const picker = harness.plugin.activeBulletPropertyPicker;
  const before = notices.length;
  picker.handleKeydown(rollCtrlEnter());
  await flushRollWrites(harness.plugin, before);
  assert.equal(picker.stage, "schedule-work-log");
  await confirmSchedulingWorkLogStage(picker, "   ");
  assert.doesNotMatch(harness.editor.content, /🛠️ \*\*WORK LOG\*\*/);
  assert.doesNotMatch(harness.editor.content, /🤷 no reason given/);
});

test("Ctrl+Enter in the Work Log stage confirms instead of re-rolling", async () => {
  notices.length = 0;
  const content = "- [/] #task A [priority:: medium] [scheduled:: 2026-09-01] ^a";
  const harness = createRollPickerHarness({ content });
  assert.equal(harness.open(), true);
  const picker = harness.plugin.activeBulletPropertyPicker;
  const before = notices.length;
  picker.handleKeydown(rollCtrlEnter());
  await flushRollWrites(harness.plugin, before);
  assert.equal(picker.stage, "schedule-work-log");
  picker.inputEl = { value: "Via ctrl enter" };
  picker.visibleItems = picker.getFilteredItems();
  picker.handleKeydown(rollCtrlEnter());
  await flushRollWrites(harness.plugin, notices.length);
  assert.match(harness.editor.content, /Via ctrl enter/);
});

test("counted recommended mixed batch logs only eligible roll and decay targets", async () => {
  notices.length = 0;
  const content = [
    "- [/] #task A [priority:: medium] [scheduled:: 2026-09-01] ^a",
    "- [*] #task B [priority:: medium] [scheduled:: 2026-09-01] ^b",
    "- [ ] #task C [priority:: medium] [scheduled:: 2026-09-01] ^c",
  ].join("\n");
  const harness = createRollPickerHarness({ content });
  assert.equal(harness.open({ countExplicit: true, additionalTaskCount: 2 }), true);
  const picker = harness.plugin.activeBulletPropertyPicker;
  assert.ok(picker.countedRollBatch);
  selectRollPropertyRow(picker, "scheduled");
  const before = notices.length;
  picker.handleKeydown(rollCtrlEnter());
  await flushRollWrites(harness.plugin, before);
  assert.equal(picker.stage, "schedule-work-log");
  await confirmSchedulingWorkLogStage(picker, "Batch work");
  const after = harness.editor.content;
  assert.equal((after.match(/Batch work/g) || []).length, 2);
  assert.doesNotMatch(after.split("- [ ] #task C")[1] || "", /Batch work/);
});
