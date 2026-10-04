const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  notices,
  NavigationHotkeysPlugin,
  helpers,
  TransactionEditor,
  createBulletPropertyPickerHarness,
  createPriorityPickerConfig,
  openBulletPropertyValueStage,
  confirmScheduleReasonStage,
} = require("./navigation-hotkeys-harness.cjs");

test("a counted priority batch skips a task whose rolled date equals its current date", () => {
  const input = [
    "- [ ] #task Alpha [priority:: high] [scheduled:: 2026-08-20] ^alpha",
    "- [ ] #task Beta [priority:: high] [scheduled:: 2026-08-21] ^beta",
  ].join("\n");
  const session = helpers.discoverCountedObsidianTaskTargets(input, 0, 1);
  const level = { label: "P2", minDays: 8, maxDays: 30 };
  const reasonByLine = new Map([
    [
      0,
      helpers.formatPriorityRollScheduleReason({
        source: "priority",
        level,
        rolledDays: 17,
        fromLevelLabel: "P1",
      }),
    ],
    [
      1,
      helpers.formatPriorityRollScheduleReason({
        source: "priority",
        level,
        rolledDays: 22,
        fromLevelLabel: "P1",
      }),
    ],
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
        [1, "2026-08-25"],
      ]),
      today: new Date(2026, 7, 3),
      scheduleLog: { automatic: true, reasonByLine },
    },
  );

  assert.equal(plan.valid, true);
  assert.equal(plan.scheduleLoggedTaskCount, 1);
  assert.equal(
    plan.content,
    [
      "- [?] #task Alpha [priority:: medium] [scheduled:: 2026-08-20] ^alpha",
      "- [?] #task Beta [priority:: medium] [scheduled:: 2026-08-25] ^beta",
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-08-21 → 2026-08-25* — 🎲 P1 → P2 · in **22** (8–30) days",
    ].join("\n"),
  );
});

test("counted priority runtime aborts a stale session without rolling writes", async () => {
  notices.length = 0;
  const editor = new TransactionEditor(
    "- [ ] #task One\n- [ ] #task Two",
    { line: 0, ch: 4 },
  );
  const session = helpers.discoverCountedObsidianTaskTargets(
    editor.content,
    0,
    1,
  );
  editor.content = editor.content.replace("Two", "Two changed");
  const file = { path: "Tasks.md", extension: "md" };
  const plugin = new NavigationHotkeysPlugin();
  plugin.getActiveMarkdownView = () => ({ editor, file });
  const property = createPriorityPickerConfig().properties.find(
    (item) => item.name === "priority",
  );

  assert.equal(
    await plugin.setCountedBulletPriorityValue(
      editor,
      { line: 0, ch: 4 },
      file.path,
      session,
      property,
      property.levels[0],
      { baseDate: new Date(2026, 7, 3), random: () => 0 },
    ),
    false,
  );
  assert.deepEqual(editor.transactions, []);
  assert.doesNotMatch(editor.content, /\[priority::|\[scheduled::/);
  assert.match(notices.at(-1), /no tasks were updated/);
});

test("scheduled picker pins a priority roll only for configured current priorities", async () => {
  const config = createPriorityPickerConfig();
  const baseDate = new Date(2026, 7, 3);
  const prioritized = createBulletPropertyPickerHarness({
    config,
    content: "- [ ] #task One [priority:: high] ^one",
    baseDate,
    random: () => 0,
  });
  const picker = await openBulletPropertyValueStage(
    prioritized,
    "scheduled",
  );

  assert.equal(picker.items.length, 11);
  assert.deepEqual(
    {
      label: picker.items[0].label,
      value: picker.items[0].value,
      detail: picker.items[0].detail,
      priorityRoll: picker.items[0].priorityRoll,
      level: picker.items[0].level.label,
      rolledDays: picker.items[0].rolledDays,
      searchText: picker.items[0].searchText,
    },
    {
      label: "P1 roll",
      value: "2026-08-05",
      detail: "2026-08-05 · Wed · random in 2–7 days",
      priorityRoll: true,
      level: "P1",
      rolledDays: 2,
      searchText: "P1 roll 2026-08-05 Wed random priority",
    },
  );
  assert.equal(
    picker.footerHints.some((hint) => hint.keys.includes("^R")),
    true,
  );

  for (const content of [
    "- [ ] #task One ^one",
    "- [ ] #task One [priority:: highest] ^one",
  ]) {
    const withoutSuggestion = createBulletPropertyPickerHarness({
      config,
      content,
      baseDate,
      random: () => 0,
    });
    const plainPicker = await openBulletPropertyValueStage(
      withoutSuggestion,
      "scheduled",
    );
    assert.equal(plainPicker.items.length, 10);
    assert.equal(plainPicker.items.some((item) => item.priorityRoll), false);
    assert.equal(
      plainPicker.footerHints.some((hint) => hint.keys.includes("^R")),
      false,
    );
  }
});

test("Ctrl+R replaces only the pinned priority roll and keeps it selected", async () => {
  // Opening the card and the stage draw the first roll (0); Ctrl+R draws 1.
  let rerolling = false;
  const harness = createBulletPropertyPickerHarness({
    config: createPriorityPickerConfig(),
    content: "- [ ] #task One [priority:: high] ^one",
    baseDate: new Date(2026, 7, 3),
    random: () => (rerolling ? 1 : 0),
  });
  const picker = await openBulletPropertyValueStage(harness, "scheduled");
  const unchangedItems = picker.items.slice(1);
  assert.equal(picker.items[0].value, "2026-08-05");
  let prevented = false;
  let stopped = false;

  rerolling = true;
  picker.handleKeydown({
    key: "r",
    ctrlKey: true,
    altKey: false,
    metaKey: false,
    preventDefault: () => {
      prevented = true;
    },
    stopPropagation: () => {
      stopped = true;
    },
  });

  assert.equal(picker.items[0].value, "2026-08-10");
  assert.equal(picker.items[0].rolledDays, 7);
  assert.deepEqual(picker.items.slice(1), unchangedItems);
  assert.equal(picker.selectedIndex, 0);
  assert.equal(picker.visibleItems[0], picker.items[0]);
  assert.equal(prevented, true);
  assert.equal(stopped, true);

  await picker.openItemAtIndex(0);
  const status = helpers.getObsidianTaskCheckboxStatus(
    harness.editor.content.split("\n")[0],
  );
  assert.equal(
    harness.editor.content,
    [
      `- [${status}] #task One [priority:: high] [scheduled:: 2026-08-10] ^one`,
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-08-10* — 🎲 P1 roll · in **7** (2–7) days",
    ].join("\n"),
  );
});

test("choosing a priority roll writes immediately with a deterministic reason instead of prompting", async () => {
  const makeHarness = () =>
    createBulletPropertyPickerHarness({
      config: createPriorityPickerConfig(),
      content: "- [ ] #task One [priority:: high] ^one",
      baseDate: new Date(2026, 7, 3),
      random: () => 0,
    });

  const rolled = makeHarness();
  const picker = await openBulletPropertyValueStage(rolled, "scheduled");
  assert.equal(picker.visibleItems[0].priorityRoll, true);
  await picker.openItemAtIndex(0);
  assert.notEqual(picker.stage, "schedule-review");
  const rolledStatus = helpers.getObsidianTaskCheckboxStatus(
    rolled.editor.content.split("\n")[0],
  );
  assert.equal(
    rolled.editor.content,
    [
      `- [${rolledStatus}] #task One [priority:: high] [scheduled:: 2026-08-05] ^one`,
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-08-05* — 🎲 P1 roll · in **2** (2–7) days",
    ].join("\n"),
  );

  // A non-roll row still enters the combined review, and confirming it empty
  // writes the date with no log. This task has no 🗓️ **SCHEDULE LOG** marker,
  // so this also doubles as the regression guard for the escape hatch: an
  // empty reason never creates a log on a task that didn't already have one.
  const preset = makeHarness();
  const presetPicker = await openBulletPropertyValueStage(preset, "scheduled");
  const presetIndex = presetPicker.visibleItems.findIndex(
    (item) => item.label === "In 2 days",
  );
  assert.notEqual(presetIndex, -1);
  await presetPicker.openItemAtIndex(presetIndex);
  assert.equal(presetPicker.stage, "schedule-review");
  await confirmScheduleReasonStage(presetPicker);
  assert.equal(
    preset.editor.content,
    `- [${rolledStatus}] #task One [priority:: high] [scheduled:: 2026-08-05] ^one`,
  );
});

test("counted scheduled picker requires one shared configured priority", async () => {
  const config = createPriorityPickerConfig();
  const baseDate = new Date(2026, 7, 3);
  const mixed = createBulletPropertyPickerHarness({
    config,
    content: [
      "- [ ] #task One [priority:: high] ^one",
      "- [ ] #task Two [priority:: medium] ^two",
    ].join("\n"),
    baseDate,
    random: () => 0,
  });
  const mixedPicker = await openBulletPropertyValueStage(mixed, "scheduled", {
    countExplicit: true,
    additionalTaskCount: 1,
  });
  assert.equal(mixedPicker.items.length, 10);
  assert.equal(mixedPicker.items.some((item) => item.priorityRoll), false);

  const common = createBulletPropertyPickerHarness({
    config,
    content: [
      "- [ ] #task One [priority:: high] ^one",
      "- [ ] #task Two [priority:: high] ^two",
    ].join("\n"),
    baseDate,
    random: () => 0,
  });
  const commonPicker = await openBulletPropertyValueStage(common, "scheduled", {
    countExplicit: true,
    additionalTaskCount: 1,
  });
  // picker-counted: when every target is a same-level roll the batch
  // recommendation replaces the shared-date pinned row (per-target dates would
  // duplicate it), so there is no pinned row but the batch preview remains.
  assert.equal(commonPicker.items.length, 10);
  assert.equal(commonPicker.items.some((item) => item.priorityRoll), false);
  const batchPreview =
    commonPicker.getRollPreviewForDateProperty("scheduled");
  assert.ok(batchPreview);
  assert.equal(batchPreview.footerLabel, "Roll 2 tasks");
});
