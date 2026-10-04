const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const {
  notices,
  helpers,
  createBulletPropertyPickerHarness,
  createPriorityPickerConfig,
  choosePriorityLevel,
  createFragmentNode,
  findFragmentNode,
  collectFragmentNodes,
  nodeHasClass,
} = require("./navigation-hotkeys-harness.cjs");

test("priority notice relative day helpers handle offsets ranges and icons", () => {
  assert.equal(
    helpers.getLocalDayOffset(new Date(2026, 7, 3, 23), new Date(2026, 7, 3)),
    0,
  );
  assert.equal(
    helpers.getLocalDayOffset(new Date(2026, 7, 3), new Date(2026, 7, 4)),
    1,
  );
  assert.equal(
    helpers.getLocalDayOffset(new Date(2026, 7, 3), new Date(2026, 8, 14)),
    42,
  );
  assert.equal(
    helpers.getLocalDayOffset(new Date(2026, 2, 7), new Date(2026, 2, 14)),
    7,
  );

  assert.equal(helpers.formatRelativeDayOffset(0), "today");
  assert.equal(helpers.formatRelativeDayOffset(1), "tomorrow");
  assert.equal(helpers.formatRelativeDayOffset(2), "in 2 days");
  assert.equal(helpers.formatRelativeDayOffset(42), "in 42 days");
  assert.equal(helpers.formatRelativeDayOffset(-1), "yesterday");
  assert.equal(helpers.formatRelativeDayOffset(-3), "3 days ago");

  assert.equal(helpers.formatRelativeDayRange(3, 3), "in 3 days");
  assert.equal(helpers.formatRelativeDayRange(2, 7), "in 2–7 days");
  assert.equal(helpers.formatRelativeDayRange(0, 7), "today to in 7 days");

  assert.equal(helpers.getPriorityLevelIconName(0), "signal-high");
  assert.equal(helpers.getPriorityLevelIconName(1), "signal-medium");
  assert.equal(helpers.getPriorityLevelIconName(2), "signal-low");
  assert.equal(helpers.getPriorityLevelIconName(3), "signal-zero");
  assert.equal(helpers.getPriorityLevelIconName(9), "signal-zero");
});

test("priority notice model summarizes single counted and project writes", () => {
  const property = createPriorityPickerConfig().properties.find(
    (item) => item.name === "priority",
  );
  const level = property.levels[0];
  const baseDate = new Date(2026, 7, 3);

  const single = helpers.buildPriorityNoticeModel({
    property,
    level,
    levelIndex: 0,
    baseDate,
    scheduledValues: ["2026-08-06"],
    taskCount: 1,
    scope: "task",
    outcome: { blockedTaskCount: 1, scheduleLoggedTaskCount: 1 },
  });
  assert.deepEqual(
    {
      iconName: single.iconName,
      pill: single.pill,
      countPill: single.countPill,
      receipt: single.receipt,
      dateLabel: single.dateLabel,
      dateText: single.dateText,
      exactDateText: single.exactDateText,
      dateStartText: single.dateStartText,
      dateEndText: single.dateEndText,
      weekdayText: single.weekdayText,
      textDateText: single.textDateText,
      relativeText: single.relativeText,
      chips: single.chips,
      text: single.text,
    },
    {
      iconName: "signal-high",
      pill: "P1",
      countPill: "",
      receipt: "[priority:: high]",
      dateLabel: "scheduled",
      dateText: "2026-08-06 · Thu",
      exactDateText: "2026-08-06",
      dateStartText: "2026-08-06",
      dateEndText: "",
      weekdayText: "Thu",
      textDateText: "2026-08-06 · Thu",
      relativeText: "in 3 days",
      chips: [
        { text: "logged", tone: "info" },
        { text: "Blocked", tone: "warn" },
      ],
      text: "priority → P1 (high); scheduled → 2026-08-06 · Thu · in 3 days; logged reason; marked task Blocked",
    },
  );

  const counted = helpers.buildPriorityNoticeModel({
    property,
    level,
    levelIndex: 0,
    baseDate,
    scheduledValues: ["2026-08-10", "2026-08-05", "2026-08-08"],
    taskCount: 3,
    scope: "counted",
    outcome: {
      blockedTaskCount: 3,
      unchangedTaskCount: 1,
      session: { clamped: true, requestedCount: 5, actualCount: 3 },
      scheduleLoggedTaskCount: 3,
    },
  });
  assert.equal(counted.countPill, "3 tasks");
  assert.equal(counted.dateText, "2026-08-05 to 2026-08-10");
  assert.equal(counted.exactDateText, "2026-08-05 → 2026-08-10");
  assert.equal(counted.dateStartText, "2026-08-05");
  assert.equal(counted.dateEndText, "2026-08-10");
  assert.equal(counted.weekdayText, "");
  assert.equal(counted.textDateText, "2026-08-05 to 2026-08-10");
  assert.equal(counted.relativeText, "in 2–7 days");
  assert.deepEqual(counted.chips, [
    { text: "1 task unchanged", tone: "muted" },
    { text: "requested 5, found 3 at end of note", tone: "muted" },
    { text: "3 logged", tone: "info" },
    { text: "3 Blocked", tone: "warn" },
  ]);
  assert.equal(
    counted.text,
    "priority → P1 (high) on 3 tasks; scheduled → 2026-08-05 to 2026-08-10 · in 2–7 days; 1 task unchanged; requested 5, found 3 at end of note; logged reason on 3 tasks; marked 3 tasks Blocked",
  );

  const project = helpers.buildPriorityNoticeModel({
    property,
    level,
    levelIndex: 0,
    baseDate,
    scheduledValues: ["2026-08-05"],
    taskCount: 1,
    scope: "project",
    outcome: {
      scheduledTaskCount: 4,
      removedHideTaskCount: 2,
      blockedTaskCount: 4,
      recoveryCounts: { ready: 1 },
    },
  });
  assert.equal(project.dateLabel, "scheduled (project)");
  assert.equal(project.dateText, "2026-08-05 · Wed");
  assert.equal(project.exactDateText, "2026-08-05");
  assert.equal(project.dateStartText, "2026-08-05");
  assert.equal(project.dateEndText, "");
  assert.equal(project.weekdayText, "Wed");
  assert.equal(project.textDateText, "2026-08-05 · Wed");
  assert.equal(project.relativeText, "in 2 days");
  assert.deepEqual(project.chips, [
    { text: "scheduled 4 tasks", tone: "info" },
    { text: "removed #hide from 2 tasks", tone: "info" },
    { text: "4 Blocked", tone: "warn" },
    { text: "recovered 1 task Ready", tone: "ok" },
  ]);
  assert.equal(
    project.text,
    "priority → P1 (high); scheduled → 2026-08-05 · Wed · in 2 days; scheduled 4 tasks; removed #hide from 2 tasks; marked 4 tasks Blocked; recovered 1 task Ready",
  );

  const sameDayCounted = helpers.buildPriorityNoticeModel({
    property,
    level,
    baseDate,
    scheduledValues: ["2026-08-05", "2026-08-05"],
    taskCount: 2,
    scope: "counted",
  });
  assert.equal(sameDayCounted.dateText, "2026-08-05 · Wed");
  assert.equal(sameDayCounted.exactDateText, "2026-08-05");
  assert.equal(sameDayCounted.dateStartText, "2026-08-05");
  assert.equal(sameDayCounted.dateEndText, "");
  assert.equal(sameDayCounted.weekdayText, "Wed");
  assert.equal(sameDayCounted.relativeText, "in 2 days");

  const invalidDate = helpers.buildPriorityNoticeModel({
    property,
    level,
    baseDate,
    scheduledValues: ["not-a-date"],
    taskCount: 1,
    scope: "task",
  });
  assert.equal(invalidDate.dateText, "not-a-date");
  assert.equal(invalidDate.exactDateText, "not-a-date");
  assert.equal(invalidDate.dateStartText, "not-a-date");
  assert.equal(invalidDate.dateEndText, "");
  assert.equal(invalidDate.weekdayText, "");
  assert.equal(invalidDate.relativeText, "");
  assert.doesNotMatch(invalidDate.text, /NaN/);
});

test("priority notice renderer builds an accessible fragment", () => {
  const property = createPriorityPickerConfig().properties.find(
    (item) => item.name === "priority",
  );
  const model = helpers.buildPriorityNoticeModel({
    property,
    level: property.levels[0],
    levelIndex: 0,
    baseDate: new Date(2026, 7, 3),
    scheduledValues: ["2026-08-06"],
    taskCount: 1,
    scope: "task",
    outcome: { blockedTaskCount: 1 },
  });
  const root = createFragmentNode();

  helpers.renderPriorityNoticeFragment(model, root);

  const card = findFragmentNode(root, nodeHasClass("bob-nh-notice"));
  assert.ok(card);
  assert.ok(card.classes.includes("is-level-0"));
  assert.equal(card.attrs["aria-label"], model.text);
  assert.equal(
    findFragmentNode(root, nodeHasClass("bob-nh-notice-relative")).text,
    "in 3 days",
  );
  assert.equal(
    findFragmentNode(root, nodeHasClass("bob-nh-notice-date-label")).text,
    "scheduled",
  );
  assert.equal(
    findFragmentNode(root, nodeHasClass("bob-nh-notice-date-iso")).text,
    "2026-08-06",
  );
  assert.equal(
    findFragmentNode(root, nodeHasClass("bob-nh-notice-date-weekday")).text,
    "Thu",
  );
  assert.match(card.attrs["aria-label"], /2026-08-06/);
  assert.equal(
    findFragmentNode(root, nodeHasClass("bob-nh-notice-chip")).text,
    "Blocked",
  );

  const rangeRoot = createFragmentNode();
  helpers.renderPriorityNoticeFragment(
    helpers.buildPriorityNoticeModel({
      property,
      level: property.levels[0],
      levelIndex: 0,
      baseDate: new Date(2026, 7, 3),
      scheduledValues: ["2026-08-10", "2026-08-05", "2026-08-08"],
      taskCount: 3,
      scope: "counted",
    }),
    rangeRoot,
  );
  assert.deepEqual(
    collectFragmentNodes(
      rangeRoot,
      nodeHasClass("bob-nh-notice-date-iso"),
    ).map((node) => node.text),
    ["2026-08-05", "2026-08-10"],
  );
  const rangeArrow = findFragmentNode(
    rangeRoot,
    nodeHasClass("bob-nh-notice-date-arrow"),
  );
  assert.equal(rangeArrow.text, "→");
  assert.equal(rangeArrow.attrs["aria-hidden"], "true");
  const rangeCard = findFragmentNode(rangeRoot, nodeHasClass("bob-nh-notice"));
  assert.match(rangeCard.attrs["aria-label"], /2026-08-05/);
  assert.match(rangeCard.attrs["aria-label"], /2026-08-10/);

  const noChipRoot = createFragmentNode();
  helpers.renderPriorityNoticeFragment(
    helpers.buildPriorityNoticeModel({
      property,
      level: property.levels[1],
      levelIndex: 1,
      baseDate: new Date(2026, 7, 3),
      scheduledValues: ["2026-08-05"],
      taskCount: 1,
      scope: "project",
    }),
    noChipRoot,
  );
  assert.equal(
    findFragmentNode(noChipRoot, nodeHasClass("bob-nh-notice-date-label")).text,
    "scheduled (project)",
  );
  assert.equal(
    findFragmentNode(noChipRoot, nodeHasClass("bob-nh-notice-chips")),
    null,
  );

  const fourthModel = helpers.buildPriorityNoticeModel({
    property,
    level: property.levels[3],
    levelIndex: 3,
    baseDate: new Date(2026, 7, 3),
    scheduledValues: ["2026-11-02"],
    taskCount: 1,
    scope: "task",
  });
  assert.equal(fourthModel.iconName, "signal-zero");
  const fourthRoot = createFragmentNode();
  helpers.renderPriorityNoticeFragment(fourthModel, fourthRoot);
  const fourthCard = findFragmentNode(
    fourthRoot,
    nodeHasClass("bob-nh-notice"),
  );
  assert.ok(fourthCard.classes.includes("is-level-3"));

  const invalidRoot = createFragmentNode();
  const longInvalidReceipt =
    "not-a-date-with-a-very-long-raw-receipt-value-2026-08-what";
  const invalidModel = helpers.buildPriorityNoticeModel({
    property,
    level: property.levels[2],
    levelIndex: 2,
    baseDate: new Date(2026, 7, 3),
    scheduledValues: [longInvalidReceipt],
    taskCount: 1,
    scope: "task",
  });
  helpers.renderPriorityNoticeFragment(invalidModel, invalidRoot);
  assert.equal(
    findFragmentNode(invalidRoot, nodeHasClass("bob-nh-notice-date-iso")).text,
    longInvalidReceipt,
  );
  assert.equal(
    findFragmentNode(invalidRoot, nodeHasClass("bob-nh-notice-relative")),
    null,
  );
  const invalidCard = findFragmentNode(
    invalidRoot,
    nodeHasClass("bob-nh-notice"),
  );
  assert.match(invalidCard.attrs["aria-label"], /not-a-date-with-a-very-long/);
  assert.doesNotMatch(invalidCard.attrs["aria-label"], /NaN/);
});

test("priority notice stylesheet scopes Obsidian notice overrides and uses theme tokens", () => {
  const stylesPath = path.join(
    __dirname,
    "../plugins/bob-navigation-hotkeys/styles.css",
  );
  const styles = fs.readFileSync(stylesPath, "utf8");
  const noticeClassPattern = /(^|[^\w-])\.notice(?![\w-])/;
  const unscopedNoticeSelectors = [...styles.matchAll(/([^{}]+)\{/g)]
    .map((match) => match[1].trim())
    .filter((selector) => noticeClassPattern.test(selector))
    .filter((selector) => !selector.includes(".bob-nh-notice"));

  assert.deepEqual(unscopedNoticeSelectors, []);

  const marker = "/* --- Priority notice";
  const priorityNoticeStart = styles.indexOf(marker);
  assert.notEqual(priorityNoticeStart, -1);
  const priorityNoticeStyles = styles.slice(priorityNoticeStart);

  assert.doesNotMatch(priorityNoticeStyles, /#[0-9a-f]{6}\b/i);
  assert.doesNotMatch(priorityNoticeStyles, /\brgb\(/i);
  assert.doesNotMatch(priorityNoticeStyles, /\bhsl\(/i);
});

test("priority notice falls back to one plain notice without a DOM", () => {
  notices.length = 0;
  const property = createPriorityPickerConfig().properties.find(
    (item) => item.name === "priority",
  );
  const model = helpers.buildPriorityNoticeModel({
    property,
    level: property.levels[0],
    baseDate: new Date(2026, 7, 3),
    scheduledValues: ["2026-08-06"],
    taskCount: 1,
    scope: "task",
  });

  helpers.showPriorityNotice(model);

  assert.deepEqual(notices, [model.text]);
});

test("priority notice falls back to plain text when fragment rendering fails", () => {
  notices.length = 0;
  const property = createPriorityPickerConfig().properties.find(
    (item) => item.name === "priority",
  );
  const model = helpers.buildPriorityNoticeModel({
    property,
    level: property.levels[0],
    baseDate: new Date(2026, 7, 3),
    scheduledValues: ["2026-08-06"],
    taskCount: 1,
    scope: "task",
  });
  const previousDocument = global.document;
  global.document = {
    createDocumentFragment: () => ({
      createDiv: () => {
        throw new Error("render failed");
      },
    }),
  };
  try {
    helpers.showPriorityNotice(model);
  } finally {
    if (previousDocument === undefined) {
      delete global.document;
    } else {
      global.document = previousDocument;
    }
  }

  assert.deepEqual(notices, [model.text]);
});

test("priority scheduling rolls inclusively and clamps a random value of one", () => {
  const level = { minDays: 2, maxDays: 7 };
  const baseDate = new Date(2026, 7, 3, 16, 45);
  const roll = (random) => {
    const result = helpers.rollPriorityScheduledDateWithOffset(
      level,
      baseDate,
      random,
    );
    return {
      date: helpers.formatBulletPropertyDate(result.date),
      offset: result.offset,
    };
  };

  assert.deepEqual(roll(() => 0), { date: "2026-08-05", offset: 2 });
  assert.deepEqual(roll(() => 0.5), { date: "2026-08-08", offset: 5 });
  assert.deepEqual(roll(() => 0.999999), { date: "2026-08-10", offset: 7 });
  assert.deepEqual(roll(() => 1), { date: "2026-08-10", offset: 7 });

  let calls = 0;
  assert.deepEqual(
    roll(() => {
      calls += 1;
      return 0.5;
    }),
    { date: "2026-08-08", offset: 5 },
  );
  assert.equal(calls, 1);
  assert.equal(
    helpers.formatBulletPropertyDate(
      helpers.rollPriorityScheduledDate(level, baseDate, () => 0),
    ),
    "2026-08-05",
  );

  const wideLevel = createPriorityPickerConfig().properties
    .find((item) => item.name === "priority")
    .levels[3];
  const wideRoll = (random) => {
    const result = helpers.rollPriorityScheduledDateWithOffset(
      wideLevel,
      new Date(2026, 7, 3),
      random,
    );
    return {
      date: helpers.formatBulletPropertyDate(result.date),
      offset: result.offset,
    };
  };
  assert.deepEqual(wideRoll(() => 0), { date: "2026-11-02", offset: 91 });
  assert.deepEqual(wideRoll(() => 0.999999), {
    date: "2027-08-03",
    offset: 365,
  });
});

test("priority value rows preserve config order and expose labels ranges and current state", () => {
  const config = createPriorityPickerConfig();
  const property = config.properties.find((item) => item.name === "priority");
  const items = helpers.createBulletPropertyValueItems(
    { property, currentValue: "medium" },
    new Date(2026, 7, 3),
  );

  assert.deepEqual(
    items.map((item) => ({
      label: item.label,
      value: item.value,
      detail: item.detail,
      searchText: item.searchText,
      current: item.current,
      priorityLevel: item.priorityLevel,
    })),
    [
      {
        label: "P1",
        value: "high",
        detail: "high · in 2–7 days",
        searchText: "P1 high 2–7 days",
        current: false,
        priorityLevel: property.levels[0],
      },
      {
        label: "P2",
        value: "medium",
        detail: "medium · in 8–30 days",
        searchText: "P2 medium 8–30 days",
        current: true,
        priorityLevel: property.levels[1],
      },
      {
        label: "P3",
        value: "low",
        detail: "low · in 31–90 days",
        searchText: "P3 low 31–90 days",
        current: false,
        priorityLevel: property.levels[2],
      },
      {
        label: "P4",
        value: "lowest",
        detail: "lowest · in 91–365 days",
        searchText: "P4 lowest 91–365 days",
        current: false,
        priorityLevel: property.levels[3],
      },
    ],
  );

  const propertyItems = helpers.createBulletPropertyItems(
    config,
    "- [ ] #task One [priority:: medium] ^one",
  );
  assert.equal(
    propertyItems.find((item) => item.property.name === "priority").currentLabel,
    "P2",
  );
});

test("priority picker writes priority then rolled schedule in one guarded edit", async () => {
  notices.length = 0;
  const harness = createBulletPropertyPickerHarness({
    config: createPriorityPickerConfig(),
    content: "- [ ] #task One ^one",
    baseDate: new Date(2026, 7, 3),
    random: () => 0,
  });

  await choosePriorityLevel(harness, "P1");

  assert.match(
    harness.editor.content,
    /- \[\?\] #task One \[priority:: high\] \[scheduled:: 2026-08-05\] \^one/,
  );
  assert.deepEqual(notices, [
    "priority → P1 (high); scheduled → 2026-08-05 · Wed · in 2 days; logged reason; marked task Blocked",
  ]);
});

test("priority picker writes lowest priority with a wide rolled schedule", async () => {
  notices.length = 0;
  const harness = createBulletPropertyPickerHarness({
    config: createPriorityPickerConfig(),
    content: "- [ ] #task One ^one",
    baseDate: new Date(2026, 7, 3),
    random: () => 0,
  });

  await choosePriorityLevel(harness, "P4");

  assert.equal(
    harness.editor.content,
    [
      "- [?] #task One [priority:: lowest] [scheduled:: 2026-11-02] ^one",
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-11-02* — 🎲 P0 → P4 · in **91** (91–365) days",
    ].join("\n"),
  );
  assert.deepEqual(notices, [
    "priority → P4 (lowest); scheduled → 2026-11-02 · Mon · in 91 days; logged reason; marked task Blocked",
  ]);
});

test("priority picker replaces both existing values without duplicating fields", async () => {
  notices.length = 0;
  const harness = createBulletPropertyPickerHarness({
    config: createPriorityPickerConfig(),
    content:
      "- [ ] #task One [priority:: medium] [scheduled:: 2026-09-01] ^one",
    baseDate: new Date(2026, 7, 3),
    random: () => 0.5,
  });

  await choosePriorityLevel(harness, "P1");

  assert.equal((harness.editor.content.match(/\[priority::/g) || []).length, 1);
  assert.equal((harness.editor.content.match(/\[scheduled::/g) || []).length, 1);
  // The rolled date must stay to the right of the priority: Tasks-format
  // parsers read trailing inline fields right to left and stop at the first
  // unrecognized one, so a level value outside Tasks' own priority names would
  // otherwise hide the date from every query.
  assert.equal(
    harness.editor.content,
    [
      "- [?] #task One [priority:: high] [scheduled:: 2026-08-08] ^one",
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-09-01 → 2026-08-08* — 🎲 P2 → P1 · in **5** (2–7) days",
    ].join("\n"),
  );
});

test("counted priority writes keep the rolled date right of the priority", async () => {
  notices.length = 0;
  const harness = createBulletPropertyPickerHarness({
    config: createPriorityPickerConfig(),
    content: "- [ ] #task One [scheduled:: 2026-09-01] [id:: one] ^one",
    baseDate: new Date(2026, 7, 3),
    random: () => 0.5,
  });

  await choosePriorityLevel(harness, "P1", { countExplicit: true });

  assert.equal(
    harness.editor.content,
    [
      "- [?] #task One [id:: one] [priority:: high] [scheduled:: 2026-08-08] ^one",
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-09-01 → 2026-08-08* — 🎲 P0 → P1 · in **5** (2–7) days",
    ].join("\n"),
  );
});

test("priority picker writes project priority inline and schedule to frontmatter atomically", async () => {
  notices.length = 0;
  const content = [
    "---",
    "type: [[project]]",
    "---",
    "- [ ] #task Ship ^prj",
  ].join("\n");
  const harness = createBulletPropertyPickerHarness({
    config: createPriorityPickerConfig(),
    content,
    cursor: { line: 3, ch: 12 },
    file: {
      path: "projects/Ship.md",
      basename: "Ship",
      extension: "md",
    },
    baseDate: new Date(2026, 7, 3),
    random: () => 0,
  });

  await choosePriorityLevel(harness, "P1");

  assert.equal(harness.editor.transactions.length, 1);
  assert.match(harness.editor.content, /^scheduled: 2026-08-05$/m);
  assert.match(harness.editor.content, /#task Ship.*\[priority:: high\] \^prj/);
  assert.doesNotMatch(harness.editor.content, /#task Ship.*\[scheduled::/);
  assert.equal(notices.length, 1);
  assert.match(
    notices[0],
    /^priority → P1 \(high\); scheduled → 2026-08-05 · Wed · in 2 days/,
  );
});

test("counted priority picker rolls an independent schedule for every task", async () => {
  notices.length = 0;
  const rolls = [0, 0.5, 0.999999];
  const harness = createBulletPropertyPickerHarness({
    config: createPriorityPickerConfig(),
    baseDate: new Date(2026, 7, 3),
    random: () => rolls.shift(),
  });

  await choosePriorityLevel(harness, "P1", {
    countExplicit: true,
    additionalTaskCount: 2,
  });

  assert.equal(harness.editor.transactions.length, 1);
  const lines = harness.editor.content.split("\n");
  const taskLines = lines.filter((line) => line.includes("#task"));
  assert.deepEqual(
    taskLines.map((line) => ({
      status: helpers.getObsidianTaskCheckboxStatus(line),
      priority: helpers.findBulletPropertyField(line, "priority").value,
      scheduled: helpers.findBulletPropertyField(line, "scheduled").value,
    })),
    [
      { status: "?", priority: "high", scheduled: "2026-08-05" },
      { status: "?", priority: "high", scheduled: "2026-08-08" },
      { status: "?", priority: "high", scheduled: "2026-08-10" },
    ],
  );
  assert.deepEqual(
    lines.filter((line) => line.includes("🎲")),
    [
      "\t\t- *2026-08-05* — 🎲 P0 → P1 · in **2** (2–7) days",
      "\t\t- *2026-08-08* — 🎲 P0 → P1 · in **5** (2–7) days",
      "\t\t- *2026-08-10* — 🎲 P0 → P1 · in **7** (2–7) days",
    ],
  );
  assert.deepEqual(notices, [
    "priority → P1 (high) on 3 tasks; scheduled → 2026-08-05 to 2026-08-10 · in 2–7 days; logged reason on 3 tasks; marked 3 tasks Blocked",
  ]);
});

test("counted priority planning keeps project schedules in frontmatter", () => {
  const input = [
    "---",
    "type: [[project]]",
    "---",
    "- [ ] #task Ship ^prj",
    "- [/] #task Follow up ^follow",
  ].join("\r\n");
  const session = helpers.discoverCountedObsidianTaskTargets(input, 3, 1);
  const plan = helpers.planCountedBulletPropertyBatch(
    input,
    session,
    "priority",
    null,
    {
      operation: "set-priority",
      priorityValue: "high",
      scheduledPropertyName: "scheduled",
      scheduledValueByLine: new Map([
        [3, "2026-08-05"],
        [4, "2026-08-08"],
      ]),
      today: new Date(2026, 7, 3),
    },
  );

  assert.equal(plan.valid, true);
  assert.match(plan.content, /^scheduled: 2026-08-05$/m);
  assert.match(plan.content, /#task Ship.*\[priority:: high\].*\^prj/);
  assert.doesNotMatch(plan.content, /#task Ship.*\[scheduled::/);
  assert.match(
    plan.content,
    /#task Follow up.*\[priority:: high\] \[scheduled:: 2026-08-08\].*\^follow/,
  );
  assert.equal(plan.scheduleLoggedTaskCount, 0);
});

test("counted priority planning evaluates Blocked recovery per rolled date", () => {
  const input = [
    "- [?] #task Due [scheduled:: 2099-01-01] ^due",
    "- [ ] #task Future ^future",
  ].join("\n");
  const session = helpers.discoverCountedObsidianTaskTargets(input, 0, 1);
  const plan = helpers.planCountedBulletPropertyBatch(
    input,
    session,
    "priority",
    null,
    {
      operation: "set-priority",
      priorityValue: "high",
      scheduledPropertyName: "scheduled",
      scheduledValueByLine: new Map([
        [0, "2026-08-03"],
        [1, "2026-08-04"],
      ]),
      today: new Date(2026, 7, 3),
      recoveryByLine: new Map([[0, { state: "ready", rank: " " }]]),
    },
  );

  assert.equal(plan.valid, true);
  assert.deepEqual(
    plan.content
      .split("\n")
      .map((line) => helpers.getObsidianTaskCheckboxStatus(line)),
    [" ", "?"],
  );
  assert.equal(plan.recoveredReadyTaskCount, 1);
  assert.equal(plan.blockedTaskCount, 1);
  assert.equal(plan.scheduleLoggedTaskCount, 0);
});

test("a counted priority batch writes one entry per task using each task's own previous level", () => {
  const input = [
    "- [ ] #task Alpha [priority:: high] [scheduled:: 2026-08-05] ^alpha",
    "- [ ] #task Beta [priority:: low] [scheduled:: 2026-08-10] ^beta",
    "- [ ] #task Gamma ^gamma",
  ].join("\n");
  const session = helpers.discoverCountedObsidianTaskTargets(input, 0, 2);
  const reasonByLine = new Map([
    [0, helpers.formatPriorityRollScheduleReason({
      source: "priority",
      level: { label: "P2", minDays: 8, maxDays: 30 },
      rolledDays: 17,
      fromLevelLabel: "P1",
    })],
    [1, helpers.formatPriorityRollScheduleReason({
      source: "priority",
      level: { label: "P2", minDays: 8, maxDays: 30 },
      rolledDays: 18,
      fromLevelLabel: "P3",
    })],
    [2, helpers.formatPriorityRollScheduleReason({
      source: "priority",
      level: { label: "P2", minDays: 8, maxDays: 30 },
      rolledDays: 19,
      fromLevelLabel: "P0",
    })],
  ]);
  const plan = helpers.planCountedBulletPropertyBatch(
    input,
    session,
    "priority",
    null,
    {
      operation: "set-priority",
      priorityValue: "medium",
      scheduledPropertyName: "scheduled",
      scheduledValueByLine: new Map([
        [0, "2026-08-20"],
        [1, "2026-08-21"],
        [2, "2026-08-22"],
      ]),
      today: new Date(2026, 7, 3),
      scheduleLog: { automatic: true, reasonByLine },
    },
  );

  assert.equal(plan.valid, true);
  assert.equal(plan.cursorLine, 0);
  assert.equal(plan.scheduleLoggedTaskCount, 3);
  // A priority roll's generated reason is never empty, so no target can ever
  // take the fallback branch.
  assert.equal(plan.scheduleLogFallbackTaskCount, 0);
  assert.equal(
    plan.content,
    [
      "- [?] #task Alpha [priority:: medium] [scheduled:: 2026-08-20] ^alpha",
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-08-05 → 2026-08-20* — 🎲 P1 → P2 · in **17** (8–30) days",
      "- [?] #task Beta [priority:: medium] [scheduled:: 2026-08-21] ^beta",
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-08-10 → 2026-08-21* — 🎲 P3 → P2 · in **18** (8–30) days",
      "- [?] #task Gamma [priority:: medium] [scheduled:: 2026-08-22] ^gamma",
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-08-22* — 🎲 P0 → P2 · in **19** (8–30) days",
    ].join("\n"),
  );
});
