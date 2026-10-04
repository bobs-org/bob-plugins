const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

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
    result[match[1].trim()] = match[2].trim() || null;
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
        this.contentEl = { empty: () => {} };
        this.modalEl = { removeClass: () => {} };
      }
    }
    return {
      MarkdownView: EmptyClass,
      Modal: TestModal,
      Notice: EmptyClass,
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

const BASE_DATE = new Date(2026, 9, 3);

function buildConfig() {
  const config = helpers.validateBulletPropertyConfig({
    properties: [
      { name: "scheduled", values: "date" },
      {
        name: "priority",
        values: "priority",
        schedules: "scheduled",
        levels: [
          { label: "P1", value: "high", min_days: 2, max_days: 7 },
          { label: "P2", value: "medium", min_days: 8, max_days: 30 },
          { label: "P3", value: "low", min_days: 31, max_days: 90 },
          { label: "P4", value: "lowest", min_days: 91, max_days: 365 },
          { label: "P5", value: "later", min_days: 366, max_days: 400 },
        ],
      },
      { name: "dependsOn", values: "local_task_id" },
      { name: "effort", values: ["small", "large"] },
    ],
  });
  assert.ok(config);
  return config;
}

function sequence(values) {
  let index = 0;
  return () => values[index++ % values.length];
}

function target(path, line, rawLine, content = rawLine) {
  return { path, line, rawLine, content };
}

function makeModel(overrides = {}) {
  const content =
    overrides.content ||
    "- [ ] #task Ship report [priority:: medium] [scheduled:: 2026-10-12] [effort:: small] ^ship";
  const lineText = overrides.lineText || content.split(/\r?\n/)[0];
  return helpers.planTaskCard({
    config: buildConfig(),
    content,
    lineText,
    cursorLine: 0,
    filePath: "Tasks/Alpha.md",
    propertyContext: { isObsidianTask: true },
    baseDate: BASE_DATE,
    random: sequence([0.1, 0.35, 0.6, 0.8, 0.95, 0.2, 0.45, 0.7]),
    freshnessApi: {
      setRefreshLine() {},
      config() {
        return { interval: 7 };
      },
    },
    ...overrides,
  });
}

function key(model, value, modifiers = {}) {
  return helpers.resolveTaskCardKey(model, { key: value, ...modifiers });
}

test("card model builds stable rows, scope metadata, and an existing recommendation", () => {
  const model = makeModel();
  assert.equal(model.kind, "task-card");
  assert.equal(model.session.type, "single");
  assert.equal(model.session.targetCount, 1);
  assert.equal(model.selectedRowId, "schedule");
  assert.deepEqual(
    model.rows.map((row) => row.id),
    ["schedule", "depends-on", "review-every", "cancel", "lane"],
  );
  assert.ok(model.rows.find((row) => row.id === "schedule").enabled);
  assert.ok(model.rows.find((row) => row.id === "depends-on").enabled);
  assert.ok(model.rows.find((row) => row.id === "review-every").enabled);
  assert.ok(model.recommendation.available);
  assert.equal(model.recommendation.source.kind, "roll");
  assert.equal(model.recommendation.preview.dateValue, model.recommendation.source.date);
  const priority = buildConfig().properties.find((item) => item.values === "priority");
  const expectedRecommendation = helpers.planPriorityRollRecommendation({
    property: priority,
    content: "- [ ] #task Ship report [priority:: medium] [scheduled:: 2026-10-12] [effort:: small] ^ship",
    taskLine: 0,
    currentScheduled: "2026-10-12",
    baseDate: BASE_DATE,
    random: sequence([0.1]),
  });
  assert.equal(model.recommendation.source.date, expectedRecommendation.date);
  assert.equal(model.recommendation.source.reason, expectedRecommendation.reason);
  assert.deepEqual(model.moreProperties.map((item) => item.propertyName), ["effort"]);
  assert.equal(model.mixedMetadata.effort.valueState, "common");
  assert.equal(model.priorityStrip.levels.length, 5);
  assert.deepEqual(
    model.priorityStrip.levels.map((item) => item.key),
    ["1", "2", "3", "4", "5"],
  );
});

test("explicit preview builder matches writer rolls and deduplicates linked targets", () => {
  const config = buildConfig();
  const property = config.properties.find((item) => item.values === "priority");
  const alphaLine = "- [ ] #task Alpha [priority:: high] [scheduled:: 2026-10-12] ^alpha";
  const betaLine = "- [/] #task Beta [priority:: medium] ^beta";
  const targets = [
    target("Tasks/Alpha.md", 2, alphaLine, alphaLine),
    target("Tasks/Beta.md", 5, betaLine, betaLine),
    target("Tasks/Alpha.md", 9, alphaLine, alphaLine),
  ];
  const draws = [0, 0.35, 0.2, 0.8, 0.99, 0.1, 0.4, 0.7, 0.3, 0.6];
  const model = helpers.buildTaskCardPriorityPreviews({
    property,
    targets,
    baseDate: BASE_DATE,
    random: sequence(draws),
  });
  assert.equal(model.targetCount, 2);
  assert.equal(model.targets.length, 2);
  assert.equal(model.targets[0].id, "Tasks/Alpha.md#^alpha");
  assert.equal(model.levels[0].key, "1");
  assert.equal(model.levels[4].key, "5");
  assert.equal(model.targets[0].previews.length, 5);
  assert.equal(model.targets[1].previews.length, 5);
  assert.equal(model.targets[0].previews[0].offset, 2);
  assert.equal(model.targets[1].previews[0].offset, 4);

  const expectedRoll = helpers.rollPriorityScheduledDateWithOffset(
    property.levels[0],
    BASE_DATE,
    () => 0,
  );
  assert.equal(
    model.targets[0].previews[0].date,
    helpers.formatBulletPropertyDate(expectedRoll.date),
  );
  assert.match(model.targets[0].previews[0].reason, /^🎲 P1 · in \*\*2\*\*/);
  assert.match(model.targets[1].previews[0].reason, /^🎲 P2 → P1 · in \*\*4\*\*/);
  assert.match(model.targets[0].previews[1].reason, /^🎲 P1 → P2 ·/);
});

test("counted and linked card models report real target counts and mixed values", () => {
  const config = buildConfig();
  const content = [
    "- [/] #task A [priority:: high] [scheduled:: 2026-10-10] ^a",
    "- [*] #task B [priority:: medium] [scheduled:: 2026-10-11] ^b",
  ].join("\n");
  const taskSession = {
    valid: true,
    explicit: true,
    requestedCount: 2,
    actualCount: 2,
    targets: [
      { line: 0, rawLine: content.split("\n")[0] },
      { line: 1, rawLine: content.split("\n")[1] },
    ],
  };
  const countedDraws = [0.1, 0.3, 0.5, 0.7, 0.9, 0.2, 0.4, 0.6, 0.8, 0.99];
  const counted = helpers.planTaskCard({
    config,
    content,
    lineText: taskSession.targets[0].rawLine,
    cursorLine: 0,
    taskSession,
    baseDate: BASE_DATE,
    random: sequence(countedDraws),
  });
  assert.equal(counted.session.type, "counted");
  assert.equal(counted.session.targetCount, 2);
  assert.equal(counted.mixedMetadata.priority.valueState, "mixed");
  assert.deepEqual(counted.mixedMetadata.priority.currentValues, ["high", "medium"]);
  assert.equal(counted.priorityStrip.targetCount, 2);
  assert.ok(counted.recommendation && counted.recommendation.kind === "batch");
  const priority = config.properties.find((item) => item.values === "priority");
  const expectedCounted = helpers.planPriorityRollRecommendationsForTargets(
    content,
    taskSession.targets,
    priority,
    { baseDate: BASE_DATE, random: sequence(countedDraws) },
  );
  assert.deepEqual(counted.recommendation.source.counts, expectedCounted.counts);
  assert.deepEqual(
    counted.recommendation.source.entries.map((entry) =>
      entry.recommendation && [entry.recommendation.kind, entry.recommendation.date],
    ),
    expectedCounted.entries.map((entry) =>
      entry.recommendation && [entry.recommendation.kind, entry.recommendation.date],
    ),
  );

  const alpha = target(
    "Tasks/A.md",
    0,
    "- [ ] #task Alpha [priority:: high] ^alpha",
    "- [ ] #task Alpha [priority:: high] ^alpha",
  );
  const beta = target(
    "Tasks/B.md",
    4,
    "- [ ] #task Beta [priority:: medium] ^beta",
    "- [ ] #task Beta [priority:: medium] ^beta",
  );
  const linked = helpers.planTaskCard({
    config,
    content: "- [[A#^alpha]]\n- [[A#^alpha]]\n- [[B#^beta]]",
    lineText: "- [[A#^alpha]]",
    cursorLine: 0,
    linkSession: {
      kind: "task-link",
      requestedCount: 3,
      targets: [{ line: 0 }, { line: 1 }, { line: 2 }],
      resolved: [alpha, { ...alpha, line: 7 }, beta],
    },
    baseDate: BASE_DATE,
    random: sequence([0.1, 0.3, 0.5, 0.7, 0.9, 0.2, 0.4, 0.6, 0.8, 0.99]),
  });
  assert.equal(linked.session.type, "linked");
  assert.equal(linked.session.targetCount, 2);
  assert.equal(linked.session.linkCount, 3);
  assert.equal(linked.priorityStrip.targetCount, 2);
  assert.equal(linked.mixedMetadata.priority.targetCount, 2);
  assert.deepEqual(
    linked.priorityStrip.targets.map((item) => item.id),
    ["Tasks/A.md#^alpha", "Tasks/B.md#^beta"],
  );
  const linkedDraws = [0.1, 0.3, 0.5, 0.7, 0.9, 0.2, 0.4, 0.6, 0.8, 0.99];
  const expectedLinked = helpers.planLinkRollBatchSummary(
    [alpha, beta],
    config.properties.find((item) => item.values === "priority"),
    { baseDate: BASE_DATE, random: sequence(linkedDraws) },
  );
  assert.deepEqual(linked.recommendation.source.counts, expectedLinked.counts);
  assert.deepEqual(
    linked.recommendation.source.entries.map((entry) =>
      entry.recommendation && [entry.recommendation.kind, entry.recommendation.date],
    ),
    expectedLinked.entries.map((entry) =>
      entry.recommendation && [entry.recommendation.kind, entry.recommendation.date],
    ),
  );
});

test("priority, recommendation, navigation, action, deletion, and search keys resolve to typed intents", () => {
  const model = makeModel();
  for (const digit of ["1", "2", "3", "4"]) {
    const intent = key(model, digit);
    assert.equal(intent.type, "set-priority");
    assert.equal(intent.key, digit);
    assert.ok(intent.previews.length === 1);
  }
  assert.equal(key(model, "0").type, "clear-priority");
  assert.equal(key(model, "0").keepScheduled, true);
  for (const modifiers of [{ ctrlKey: true }, { metaKey: true }]) {
    const intent = key(model, "Enter", modifiers);
    assert.equal(intent.type, "apply-recommendation");
    assert.equal(intent.recommendation, model.recommendation.source);
  }
  assert.equal(key(model, "r", { ctrlKey: true }).type, "refresh-previews");
  assert.equal(key(model, "ArrowDown").direction, "next");
  assert.equal(key(model, "n", { ctrlKey: true }).direction, "next");
  assert.equal(key(model, "p", { ctrlKey: true }).direction, "previous");
  assert.equal(key(model, "Enter").action, "schedule");
  assert.equal(key(model, "b").action, "dependencies");
  assert.equal(key(model, "f").action, "refresh");
  assert.equal(key(model, "x").action, "cancel");
  assert.equal(key(model, "n", { altKey: true }).action, "toggle-lane");
  assert.equal(key(model, "d", { ctrlKey: true }).propertyName, "scheduled");
  assert.equal(key(model, "/"), null);
  assert.equal(key(model, "z"), null);
  assert.equal(key(model, "Escape").type, "close-card");
  assert.equal(key(model, "Backspace").type, "back");
  assert.equal(key(model, "q", { ctrlKey: true }), null);
  assert.equal(key(model, "ArrowUp", { ctrlKey: true, altKey: true }), null);
  assert.equal(key(model, "5").type, "set-priority");
  const fourLevelConfig = {
    properties: buildConfig().properties.map((property) =>
      property.values === "priority"
        ? { ...property, levels: property.levels.slice(0, 4) }
        : property,
    ),
  };
  const fourLevelModel = makeModel({ config: fourLevelConfig });
  const unconfigured = key(fourLevelModel, "5");
  assert.equal(unconfigured.type, "unavailable");
  assert.match(unconfigured.reason, /not configured/);
  assert.equal(key(fourLevelModel, "9").type, "unavailable");
});

test("Escape, bare q, and Ctrl+[ close the card; nothing else does", () => {
  const model = makeModel();
  const close = Object.freeze({ type: "close-card" });
  assert.deepEqual(key(model, "Escape"), close);
  assert.deepEqual(key(model, "q"), close);
  assert.deepEqual(key(model, "Q"), close);
  assert.deepEqual(key(model, "Q", { shiftKey: true }), close);
  assert.deepEqual(key(model, "[", { ctrlKey: true }), close);
  assert.deepEqual(key(model, "x", { ctrlKey: true, code: "BracketLeft" }), close);
  assert.deepEqual(key(model, "q", { repeat: true }), close);
  for (const modifiers of [
    { ctrlKey: true },
    { metaKey: true },
    { altKey: true },
    { ctrlKey: true, shiftKey: true },
  ]) {
    assert.equal(key(model, "q", modifiers), null);
    assert.equal(key(model, "Q", modifiers), null);
  }
  for (const modifiers of [
    {},
    { metaKey: true },
    { altKey: true },
    { ctrlKey: true, shiftKey: true },
    { ctrlKey: true, altKey: true },
    { ctrlKey: true, metaKey: true },
  ]) {
    assert.equal(key(model, "[", modifiers), null);
  }
  // Ctrl+] is the previous close chord; it is no longer ours.
  assert.equal(key(model, "]", { ctrlKey: true }), null);
  assert.equal(key(model, "x", { ctrlKey: true, code: "BracketRight" }), null);
});

test("close keys never fire during composition or inside a text field", () => {
  const model = makeModel();
  for (const event of [
    { key: "q", isComposing: true },
    { key: "q", keyCode: 229 },
    { key: "[", ctrlKey: true, isComposing: true },
    { key: "[", ctrlKey: true, inTextInput: true },
    { key: "[", ctrlKey: true, target: { tagName: "INPUT" } },
    { key: "Escape", keyCode: 229 },
    { key: "q", inTextInput: true },
    { key: "q", target: { tagName: "INPUT" } },
    { key: "q", target: { tagName: "textarea" } },
    { key: "q", target: { tagName: "SELECT" } },
    { key: "q", target: { tagName: "DIV", isContentEditable: true } },
    { key: "Q", shiftKey: true, target: { tagName: "INPUT" } },
  ]) {
    assert.equal(helpers.resolveTaskCardKey(model, event), null);
  }
  assert.equal(
    helpers.resolveTaskCardKey(makeModel(), { key: "q", target: { tagName: "DIV" } }).type,
    "close-card",
  );
});

test("unavailable actions, input composition, and repeats stay safe", () => {
  const noApi = makeModel({ freshnessApi: null });
  const refreshRow = noApi.rows.find((row) => row.id === "review-every");
  assert.equal(refreshRow.enabled, false);
  assert.match(refreshRow.unavailableReason, /Freshness API/);
  assert.equal(key(noApi, "f").type, "unavailable");
  assert.equal(key(noApi, "f").action, "refresh");

  const noPriority = helpers.planTaskCard({
    config: helpers.validateBulletPropertyConfig({
      properties: [{ name: "scheduled", values: "date" }],
    }),
    content: "- [ ] #task Plain ^plain",
    lineText: "- [ ] #task Plain ^plain",
    cursorLine: 0,
    baseDate: BASE_DATE,
  });
  assert.equal(key(noPriority, "2").type, "unavailable");
  assert.equal(key(noPriority, "0").type, "unavailable");

  const plainBullet = helpers.planTaskCard({
    config: buildConfig(),
    content: "- Plain bullet [scheduled:: 2026-10-12] [effort:: small]",
    lineText: "- Plain bullet [scheduled:: 2026-10-12] [effort:: small]",
    cursorLine: 0,
    baseDate: BASE_DATE,
  });
  assert.equal(plainBullet.rows.find((row) => row.id === "schedule").enabled, true);
  assert.equal(plainBullet.rows.find((row) => row.id === "depends-on").enabled, false);
  assert.equal(plainBullet.rows.find((row) => row.id === "lane").enabled, false);
  assert.equal(plainBullet.rows.find((row) => row.id === "cancel").enabled, false);
  assert.deepEqual(plainBullet.moreProperties.map((item) => item.propertyName), ["effort"]);
  assert.equal(key(plainBullet, "b").type, "unavailable");

  const unconfiguredValue = makeModel({
    content: "- [ ] #task Unknown [priority:: urgent] ^unknown",
    lineText: "- [ ] #task Unknown [priority:: urgent] ^unknown",
  });
  assert.equal(unconfiguredValue.recommendation, null);
  assert.equal(unconfiguredValue.mixedMetadata.priority.valueState, "common");
  assert.equal(unconfiguredValue.priorityStrip.targets[0].currentValue, "urgent");
  assert.equal(key(unconfiguredValue, "1").type, "set-priority");

  assert.equal(key(noApi, "2", { repeat: true }).type, "ignored");
  assert.equal(key(noApi, "Enter", { ctrlKey: true, repeat: true }).type, "ignored");
  assert.equal(key(noApi, "ArrowDown", { repeat: true }).type, "move-selection");
  assert.equal(key(noApi, "2", { isComposing: true }), null);
  assert.equal(key(noApi, "2", { keyCode: 229 }), null);
  assert.equal(key(noApi, "2", { inTextInput: true }), null);
  assert.equal(key(noApi, "2", { target: { tagName: "INPUT" } }), null);
});

test("key resolver table covers lane state, API availability, and modifier guards", () => {
  const ready = makeModel({
    content: "- [ ] #task Ready ^ready",
    lineText: "- [ ] #task Ready ^ready",
  });
  const next = makeModel({
    content: "- [*] #task Next ^next",
    lineText: "- [*] #task Next ^next",
  });
  const pending = makeModel({
    content: "- [/] #task Pending ^pending",
    lineText: "- [/] #task Pending ^pending",
  });
  const blocked = makeModel({
    content: "- [?] #task Blocked ^blocked",
    lineText: "- [?] #task Blocked ^blocked",
  });
  const noApi = makeModel({ freshnessApi: null });
  const cases = [
    ["ready lane commits", ready, "n", { altKey: true }, "open-action", "toggle-lane"],
    ["next lane releases", next, "n", { altKey: true }, "open-action", "toggle-lane"],
    ["pending lane releases", pending, "n", { altKey: true }, "open-action", "toggle-lane"],
    ["blocked lane stays derived", blocked, "n", { altKey: true }, "unavailable", "toggle-lane"],
    ["refresh requires the API", noApi, "f", {}, "unavailable", "refresh"],
    ["unrelated control modifier is ignored", ready, "b", { ctrlKey: true }, null, null],
    ["modified printable does not enter search", ready, "z", { metaKey: true }, null, null],
    ["double action is suppressed", ready, "2", { repeat: true }, "ignored", undefined],
    ["held navigation remains repeatable", ready, "n", { ctrlKey: true, repeat: true }, "move-selection", undefined],
  ];
  for (const [label, model, value, modifiers, type, action] of cases) {
    const intent = key(model, value, modifiers);
    assert.equal(intent && intent.type, type, label);
    if (action !== undefined) {
      assert.equal(intent && intent.action, action, label);
    }
  }
});

test("recurring cancellation and blocked lanes expose reasons instead of writes", () => {
  const recurring = makeModel({
    content: "- [ ] #task Repeat [repeat:: weekly] ^repeat",
    lineText: "- [ ] #task Repeat [repeat:: weekly] ^repeat",
  });
  const cancel = recurring.rows.find((row) => row.id === "cancel");
  assert.equal(cancel.enabled, false);
  assert.match(cancel.unavailableReason, /Recurring/);
  assert.equal(key(recurring, "x").type, "unavailable");

  const blocked = makeModel({
    content: "- [?] #task Waiting ^waiting",
    lineText: "- [?] #task Waiting ^waiting",
  });
  const lane = blocked.rows.find((row) => row.id === "lane");
  assert.equal(lane.enabled, false);
  assert.equal(lane.unavailableReason, "Blocked is derived");
  assert.equal(key(blocked, "n", { altKey: true }).type, "unavailable");
});
