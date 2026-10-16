const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  notices,
  helpers,
  TransactionEditor,
  compatibleTasksSettings,
  openPropertyStage,
  confirmScheduleReasonStage,
  createLinkPickerEnergyConfig,
  createLinkPickerHarness,
} = require("./navigation-hotkeys-harness.cjs");

async function openLinkPickerValueStage(harness, propertyName, options = {}) {
  assert.equal(await harness.open(options), true);
  const picker = harness.plugin.activeBulletPropertyPicker;
  assert.ok(picker.isLinkSession());
  return await openPropertyStage(picker, propertyName);
}

test("parseLinkPickerTaskLink recognizes dedicated Task Link bullets", () => {
  assert.deepEqual(
    helpers.parseLinkPickerTaskLink("- [[Tasks#^a1]]"),
    { target: "Tasks", blockId: "a1", embedded: false, struck: false },
  );
  assert.deepEqual(
    helpers.parseLinkPickerTaskLink("  - ![[Tasks#^a1|Alias]]"),
    { target: "Tasks", blockId: "a1", embedded: true, struck: false },
  );
  assert.deepEqual(
    helpers.parseLinkPickerTaskLink("- 🍅 🍅 [[Tasks#^a1]] #"),
    { target: "Tasks", blockId: "a1", embedded: false, struck: false },
  );
  assert.deepEqual(
    helpers.parseLinkPickerTaskLink("- ~~[[Tasks#^a1]]~~"),
    { target: "Tasks", blockId: "a1", embedded: false, struck: true },
  );
  assert.deepEqual(
    helpers.parseLinkPickerTaskLink("- [ ] [[#^same]]"),
    { target: "", blockId: "same", embedded: false, struck: false },
  );
  assert.equal(
    helpers.parseLinkPickerTaskLink("- [[Tasks#^a1]] [[Tasks#^a2]]"),
    null,
  );
  assert.equal(
    helpers.parseLinkPickerTaskLink("- [[Tasks#^a1]] extra words"),
    null,
  );
  assert.equal(
    helpers.parseLinkPickerTaskLink("- [ ] #task Ship it [[Tasks#^a1]] ^me"),
    null,
  );
  assert.equal(helpers.parseLinkPickerTaskLink("plain text"), null);
  assert.equal(helpers.parseLinkPickerTaskLink("- ~~[[Tasks#^a1]]"), null);
});

test("discoverLinkPickerTargets covers counted siblings and clamps at the Pomodoro end", () => {
  const content = [
    "## Pomodoros",
    "- [ ] Current (0900-0930)",
    "  - [[Tasks#^a1]]",
    "  - just a note",
    "    - [[Tasks#^deep]]",
    "  - [[Tasks#^a2]]",
    "- [ ] Next (0930-1000)",
    "  - [[Tasks#^a3]]",
  ].join("\n");
  const bare = helpers.discoverLinkPickerTargets(content, 2, 0);
  assert.equal(bare.valid, true);
  assert.deepEqual(
    bare.targets.map((target) => target.line),
    [2],
  );
  assert.equal(bare.clamped, false);

  const counted = helpers.discoverLinkPickerTargets(content, 2, 5);
  assert.equal(counted.valid, true);
  assert.deepEqual(
    counted.targets.map((target) => target.line),
    [2, 5],
  );
  assert.equal(counted.actualCount, 2);
  assert.equal(counted.requestedCount, 6);
  assert.equal(counted.clamped, true);
});

test("discoverLinkPickerTargets leaves #task lines to the regular picker", () => {
  const content = [
    "- [ ] #task Ship it [[Tasks#^a1]] ^me",
    "- [[Tasks#^a1]]",
  ].join("\n");
  const onTask = helpers.discoverLinkPickerTargets(content, 0, 2);
  assert.equal(onTask.valid, false);
  assert.equal(onTask.notLink, true);
  const onPlain = helpers.discoverLinkPickerTargets(content, 0, 0);
  assert.equal(onPlain.notLink, true);
});

test("findUniqueLinkPickerTargetLine vets missing, duplicated, non-task, and closed targets", () => {
  assert.deepEqual(
    helpers.findUniqueLinkPickerTargetLine(
      "- [ ] #task Ship it ^a1",
      "a1",
    ),
    { valid: true, error: null, line: 0, rawLine: "- [ ] #task Ship it ^a1" },
  );
  assert.equal(
    helpers.findUniqueLinkPickerTargetLine("- [ ] #task Ship it ^a1", "nope")
      .error,
    "missing",
  );
  assert.equal(
    helpers.findUniqueLinkPickerTargetLine(
      "- [ ] #task One ^dup\n- [ ] #task Two ^dup",
      "dup",
    ).error,
    "duplicated",
  );
  assert.equal(
    helpers.findUniqueLinkPickerTargetLine("- just a bullet ^plain", "plain")
      .error,
    "not-task",
  );
  assert.equal(
    helpers.findUniqueLinkPickerTargetLine(
      "- [x] #task Done it ^done",
      "done",
    ).error,
    "closed",
  );
});

test("createLinkPickerPropertyItems shows dependsOn and aggregates common and mixed values", () => {
  const config = createLinkPickerEnergyConfig();
  const aggregate = helpers.createLinkPickerPropertyItems(config, [
    {
      content: "- [ ] #task One [energy:: high] ^a1",
      line: 0,
      rawLine: "- [ ] #task One [energy:: high] ^a1",
    },
    {
      content: "- [ ] #task Two ^b1",
      line: 0,
      rawLine: "- [ ] #task Two ^b1",
    },
  ]);
  assert.equal(aggregate.valid, true);
  const dependsOn = aggregate.items.find(
    (item) => item.property.name === "dependsOn",
  );
  assert.ok(dependsOn, "Task Link batches show Depends on");
  assert.equal(dependsOn.linkDependency, true);
  const energy = aggregate.items.find(
    (item) => item.property.name === "energy",
  );
  assert.equal(energy.valueState, "mixed");
  const scheduled = aggregate.items.find(
    (item) => item.property.name === "scheduled",
  );
  assert.equal(scheduled.valueState, "absent");
});

test("getLinkPickerSessionSubtitle formats single, batch, and clamped subtitles", () => {
  assert.equal(
    helpers.getLinkPickerSessionSubtitle({
      actualCount: 1,
      targets: [{ line: 0 }],
      resolved: [{ path: "Tasks.md", rawLine: "- [ ] #task Ship it ^a1" }],
    }),
    "↗ Tasks · Ship it",
  );
  assert.equal(
    helpers.getLinkPickerSessionSubtitle({
      actualCount: 3,
      requestedCount: 3,
      clamped: false,
      targets: [{}, {}, {}],
    }),
    "3 links",
  );
  assert.equal(
    helpers.getLinkPickerSessionSubtitle({
      actualCount: 2,
      requestedCount: 6,
      clamped: true,
      targets: [{}, {}],
    }),
    "2 links of 6 requested · end of Pomodoro",
  );
});

test("bare link mode edits the task behind a Task Link through the open buffer", async () => {
  notices.length = 0;
  const taskEditor = new TransactionEditor("- [ ] #task Ship it ^a1", {
    line: 0,
    ch: 0,
  });
  const harness = createLinkPickerHarness({
    linkContent: "- [[Tasks#^a1]]",
    notes: { "Tasks.md": "- [ ] #task Ship it ^a1" },
    openEditors: { "Tasks.md": taskEditor },
  });
  const picker = await openLinkPickerValueStage(harness, "energy");
  assert.equal(
    picker.getTaskSessionSubtitle(),
    "↗ Tasks · Ship it",
  );
  const valueIndex = picker.visibleItems.findIndex(
    (item) => item.value === "high",
  );
  assert.notEqual(valueIndex, -1);
  await picker.openItemAtIndex(valueIndex);
  assert.equal(
    taskEditor.content,
    "- [ ] #task Ship it [energy:: high] ^a1",
  );
  assert.equal(harness.linkEditor.content, "- [[Tasks#^a1]]");
  assert.match(notices.at(-1), /energy → high · 1 task via Task Link/);
});

test("counted link mode writes across notes through both the open buffer and the vault", async () => {
  notices.length = 0;
  const taskEditor = new TransactionEditor("- [ ] #task Ship it ^a1", {
    line: 0,
    ch: 0,
  });
  const harness = createLinkPickerHarness({
    linkContent: [
      "- [[Tasks#^a1]]",
      "- just a note",
      "  - [[Tasks#^deep]]",
      "- [[Other#^b1]]",
    ].join("\n"),
    notes: {
      "Tasks.md": "- [ ] #task Ship it ^a1",
      "Other.md": "- [ ] #task Other thing ^b1",
    },
    openEditors: { "Tasks.md": taskEditor },
  });
  const picker = await openLinkPickerValueStage(harness, "energy", {
    countExplicit: true,
    additionalTaskCount: 5,
  });
  assert.equal(
    picker.getTaskSessionSubtitle(),
    "2 links of 6 requested · end of Pomodoro",
  );
  const valueIndex = picker.visibleItems.findIndex(
    (item) => item.value === "low",
  );
  assert.notEqual(valueIndex, -1);
  await picker.openItemAtIndex(valueIndex);
  assert.equal(
    taskEditor.content,
    "- [ ] #task Ship it [energy:: low] ^a1",
  );
  assert.equal(
    harness.notes["Other.md"],
    "- [ ] #task Other thing [energy:: low] ^b1",
  );
  assert.match(notices.at(-1), /energy → low · 2 tasks via Task Links/);
});

test("Task Link scheduled delete recovers a Blocked task through the wired freshness API", async () => {
  notices.length = 0;
  const taskEditor = new TransactionEditor(
    "- [?] #task Ship it [scheduled:: 2000-01-01] ^a1",
    { line: 0, ch: 0 },
  );
  const harness = createLinkPickerHarness({
    linkContent: "- [[Tasks#^a1]]",
    notes: { "Tasks.md": "- [?] #task Ship it [scheduled:: 2000-01-01] ^a1" },
    openEditors: { "Tasks.md": taskEditor },
  });
  harness.plugin.app.vault.adapter = {
    read: async () => JSON.stringify(compatibleTasksSettings()),
  };
  // The writer under test; removing the markUnblockedLine wiring in the Task
  // Link batch paths must fail this test.
  harness.plugin.getFreshnessApi = () => ({
    markUnblockedLine(line, options) {
      const today =
        options.today instanceof Date
          ? `${options.today.getFullYear()}-${String(options.today.getMonth() + 1).padStart(2, "0")}-${String(options.today.getDate()).padStart(2, "0")}`
          : String(options.today || "2026-10-12");
      return line.replace(
        /(?= \^[A-Za-z0-9-]+\s*$)/,
        ` [unblocked:: ${today}]`,
      );
    },
  });
  assert.equal(await harness.open(), true);
  const picker = harness.plugin.activeBulletPropertyPicker;
  assert.ok(picker.isLinkSession());
  const result = await harness.plugin.deleteLinkPickerPropertyValue(picker, {
    property: { name: "scheduled" },
  });
  assert.deepEqual(result, { deleted: true });
  assert.match(
    taskEditor.content,
    /- \[ \] #task Ship it \[unblocked:: \d{4}-\d{2}-\d{2}\] \^a1/,
  );
  assert.doesNotMatch(taskEditor.content, /\[scheduled::/);
});

test("link mode refuses the whole operation when a linked note changed", async () => {
  notices.length = 0;
  const taskEditor = new TransactionEditor("- [ ] #task Ship it ^a1", {
    line: 0,
    ch: 0,
  });
  const harness = createLinkPickerHarness({
    linkContent: "- [[Tasks#^a1]]",
    notes: { "Tasks.md": "- [ ] #task Ship it ^a1" },
    openEditors: { "Tasks.md": taskEditor },
  });
  const picker = await openLinkPickerValueStage(harness, "energy");
  taskEditor.content = "- [ ] #task Ship it, edited elsewhere ^a1";
  const valueIndex = picker.visibleItems.findIndex(
    (item) => item.value === "high",
  );
  await picker.openItemAtIndex(valueIndex);
  assert.equal(
    taskEditor.content,
    "- [ ] #task Ship it, edited elsewhere ^a1",
  );
  assert.match(notices.at(-1), /no tasks were updated/);
});

test("link mode reports a closed target and changes nothing", async () => {
  notices.length = 0;
  const harness = createLinkPickerHarness({
    linkContent: "- [[Tasks#^done]]",
    notes: { "Tasks.md": "- [x] #task Done it ^done" },
  });
  assert.equal(await harness.open(), false);
  assert.ok(!harness.plugin.activeBulletPropertyPicker);
  assert.match(notices.at(-1), /not an open task/);
  assert.equal(harness.notes["Tasks.md"], "- [x] #task Done it ^done");
});

test("link mode defers to a future date, blocks the task, and prunes today", async () => {
  notices.length = 0;
  const taskEditor = new TransactionEditor("- [ ] #task Ship it ^a1", {
    line: 0,
    ch: 0,
  });
  const dailyPath = "2026/20260803.md";
  const harness = createLinkPickerHarness({
    linkPath: "Plan.md",
    linkContent: [
      "## Pomodoros",
      "- [ ] Current (0900-0930)",
      "  - [[Tasks#^a1]]",
    ].join("\n"),
    cursor: { line: 2, ch: 5 },
    notes: {
      "Tasks.md": "- [ ] #task Ship it ^a1",
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
  const picker = await openLinkPickerValueStage(harness, "scheduled");
  const dateIndex = picker.visibleItems.findIndex(
    (item) => item.label === "In 2 days",
  );
  assert.notEqual(dateIndex, -1);
  await picker.openItemAtIndex(dateIndex);
  assert.equal(picker.stage, "schedule-review");
  await confirmScheduleReasonStage(picker, "defer it");
  assert.match(
    taskEditor.content,
    /- \[\?\] #task Ship it \[scheduled:: 2026-08-05\].*\^a1/,
  );
  assert.match(taskEditor.content, /SCHEDULE LOG/);
  assert.equal(
    harness.notes[dailyPath],
    ["## Pomodoros", "", "- [ ] Current (0900-0930)", "  - keep me"].join(
      "\n",
    ),
  );
  assert.match(notices.at(-1), /via Task Link/);
  assert.match(notices.at(-1), /removed 1 Pomodoro link/);
});

test("bare Ctrl+Shift+P on a #task line keeps the existing task behavior", () => {
  const harness = createLinkPickerHarness({
    linkContent: "- [ ] #task Ship it [[Tasks#^a1]] ^me",
    notes: { "Tasks.md": "- [ ] #task Ship it ^a1" },
  });
  assert.equal(
    harness.plugin.openBulletPropertyPicker(harness.linkEditor, {
      config: harness.config,
    }),
    true,
  );
  const picker = harness.plugin.activeBulletPropertyPicker;
  assert.equal(picker.isLinkSession(), false);
  assert.ok(
    picker.propertyItems.some((item) => item.property.name === "energy"),
  );
  picker.close();
  harness.plugin.activeBulletPropertyPicker = null;
});

// task-lane: Commit Ready to Next, or release Next/In Progress to Ready.
// ---------------------------------------------------------------------------


for (const sameFile of [false, true]) {
  test(`Task Link scheduled write deletes its entry (${sameFile ? "folded" : "separate"})`, async () => {
    const harness = createLinkPickerHarness({
      linkPath: "2026/20260803.md",
      linkContent: ["## Pomodoros", "- [ ] ()",
        `  - [[${sameFile ? "" : "Tasks"}#^a1]]`, "## Tasks",
        ...(sameFile ? ["- [ ] #task Ship it ^a1"] : [])].join("\n"),
      cursor: { line: 2, ch: 0 },
      notes: sameFile ? {} : { "Tasks.md": "- [ ] #task Ship it ^a1" },
    });
    const picker = await openLinkPickerValueStage(harness, "scheduled");
    const index = picker.visibleItems.findIndex((item) => item.label === "In 2 days");
    assert.notEqual(index, -1);
    await picker.openItemAtIndex(index);
    await confirmScheduleReasonStage(picker, "defer it");
    assert.equal(harness.linkEditor.content.split("\n").slice(0, 2).join("\n"), "## Pomodoros\n## Tasks");
    assert.doesNotMatch(harness.linkEditor.content, /\(\)|\[\[#\^a1\]\]/);
    assert.equal(harness.linkEditor.undoGroups, 1);
    assert.deepEqual(harness.linkEditor.cursor, { line: 1, ch: 0 });
    assert.match(sameFile ? harness.linkEditor.content : harness.notes["Tasks.md"], /scheduled:: 2026-08-05/);
  });
}

test("folded Task Link scheduling maps the cursor past logs inserted before the emptied entry", async () => {
  const harness = createLinkPickerHarness({
    linkPath: "2026/20260803.md",
    linkContent: ["## Tasks", "- [ ] #task Ship it ^a1", "",
      "## Pomodoros", "- [ ] ()", "  - [[#^a1]]", "## After"].join("\n"),
    cursor: { line: 5, ch: 0 },
  });
  const picker = await openLinkPickerValueStage(harness, "scheduled");
  await picker.openItemAtIndex(picker.visibleItems.findIndex((item) => item.label === "In 2 days"));
  await confirmScheduleReasonStage(picker, "defer it");
  assert.match(harness.linkEditor.content, /SCHEDULE LOG/);
  assert.doesNotMatch(harness.linkEditor.content, /\(\)|\[\[#\^a1\]\]/);
  assert.equal(harness.linkEditor.getLine(harness.linkEditor.cursor.line), "## After");
  assert.equal(harness.linkEditor.undoGroups, 1);
});
