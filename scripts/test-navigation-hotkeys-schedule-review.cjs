const test = require("node:test");
const assert = require("node:assert/strict");
const {
  notices,
  helpers,
  TestEditor,
  createBulletPropertyPickerHarness,
  createPriorityPickerConfig,
  choosePriorityLevel,
  openBulletPropertyValueStage,
  findPropertyItem,
  confirmScheduleReasonStage,
  buildScheduleReasonConfig,
} = require("./navigation-hotkeys-harness.cjs");

function openBareScheduleStage(lineText, config = buildScheduleReasonConfig()) {
  const editor = new TestEditor(lineText);
  const picker = new helpers.BulletPropertyPickerModal(
    {},
    {},
    editor,
    { line: 0, ch: 0 },
    lineText,
    config,
    { filePath: "Tasks.md" },
  );
  picker.showValueStage(findPropertyItem(picker, "scheduled"));
  assert.equal(picker.stage, "value");
  return { editor, picker };
}

test("choosing a scheduled date enters the combined review without writing anything", () => {
  const lineText = "- [ ] #task Ship the thing ^ship";
  const { editor, picker } = openBareScheduleStage(lineText);

  const dateItem = picker.items.find((item) => item.kind === "value");
  assert.ok(dateItem);
  const opened = picker.openItem(dateItem);
  assert.equal(opened, false);
  assert.equal(picker.stage, "schedule-review");
  assert.deepEqual(picker.pendingScheduleReason, {
    dateItem,
    from: "",
    to: dateItem.value,
  });
  assert.equal(editor.content, lineText);
  assert.equal(typeof picker.showScheduleReasonStage, "undefined");
});

test("choosing a priority level does not enter the schedule review", async () => {
  const harness = createBulletPropertyPickerHarness({
    config: createPriorityPickerConfig(),
    content: "- [ ] #task Ship the thing ^ship",
    baseDate: new Date(2026, 7, 3),
    random: () => 0,
  });
  const picker = await choosePriorityLevel(harness, "P1");

  assert.notEqual(picker.stage, "schedule-review");
  assert.equal(picker.pendingScheduleReason, null);
  assert.equal(
    harness.editor.content,
    [
      "- [?] #task Ship the thing [priority:: high] [scheduled:: 2026-08-05] ^ship",
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-08-05* — 🎲 P0 → P1 · in **2** (2–7) days",
    ].join("\n"),
  );
});

test("confirming an empty reason on a task with an existing schedule log appends an unexplained entry", async () => {
  const harness = createBulletPropertyPickerHarness({
    config: buildScheduleReasonConfig(),
    content: [
      "- [ ] #task Ship the thing [scheduled:: 2026-08-13] ^ship",
      "  - 🗓️ **SCHEDULE LOG**",
      "    - *2026-08-06 → 2026-08-13* — was out sick",
    ].join("\n"),
    baseDate: new Date(2026, 7, 3),
  });
  notices.length = 0;
  const picker = await openBulletPropertyValueStage(harness, "scheduled");
  const dateIndex = picker.visibleItems.findIndex(
    (item) => item.label === "In 2 days",
  );
  assert.notEqual(dateIndex, -1);
  const dateValue = picker.visibleItems[dateIndex].value;
  await picker.openItemAtIndex(dateIndex);
  assert.equal(picker.stage, "schedule-review");

  await confirmScheduleReasonStage(picker, "");

  assert.equal(
    harness.editor.content,
    [
      `- [ ] #task Ship the thing [scheduled:: ${dateValue}] ^ship`,
      "  - 🗓️ **SCHEDULE LOG**",
      `    - *2026-08-13 → ${dateValue}* — 🤷 no reason given`,
      "    - *2026-08-06 → 2026-08-13* — was out sick",
    ].join("\n"),
  );
  assert.match(notices.at(-1), /; logged without a reason/);
});

test("confirming an empty reason on a task with no schedule log writes only the date", async () => {
  const harness = createBulletPropertyPickerHarness({
    config: buildScheduleReasonConfig(),
    content: "- [ ] #task Ship the thing [scheduled:: 2026-08-13] ^ship",
    baseDate: new Date(2026, 7, 3),
  });
  notices.length = 0;
  const picker = await openBulletPropertyValueStage(harness, "scheduled");
  const dateIndex = picker.visibleItems.findIndex(
    (item) => item.label === "In 2 days",
  );
  assert.notEqual(dateIndex, -1);
  const dateValue = picker.visibleItems[dateIndex].value;
  await picker.openItemAtIndex(dateIndex);
  assert.equal(picker.stage, "schedule-review");

  await confirmScheduleReasonStage(picker, "");

  assert.equal(
    harness.editor.content,
    `- [ ] #task Ship the thing [scheduled:: ${dateValue}] ^ship`,
  );
  assert.doesNotMatch(harness.editor.content, /SCHEDULE LOG/);
  assert.doesNotMatch(notices.at(-1), /schedule log/);
});

test("review stage getFilteredItems always returns exactly one synthetic preview item", () => {
  const { picker } = openBareScheduleStage(
    "- [ ] #task Ship the thing [scheduled:: 2026-08-13] ^ship",
  );
  picker.openItem(picker.items.find((item) => item.kind === "value"));
  assert.equal(picker.stage, "schedule-review");

  const reasonEl = picker.scheduleReviewReasonEl;
  assert.ok(reasonEl, "the review paints its Reason field");
  reasonEl.value = "";
  const emptyItems = picker.getFilteredItems();
  assert.equal(emptyItems.length, 1);
  assert.equal(emptyItems[0].reasonEmpty, true);

  reasonEl.value = "waiting on the API review to land";
  const typedItems = picker.getFilteredItems();
  assert.equal(typedItems.length, 1);
  assert.equal(typedItems[0].reasonEmpty, false);
  assert.equal(typedItems[0].reason, "waiting on the API review to land");

  reasonEl.value = "blocked:: x";
  const warningItems = picker.getFilteredItems();
  assert.equal(warningItems.length, 1);
  assert.equal(warningItems[0].reasonHasInlineField, true);
});

test("the review preview row previews the entry it will write", () => {
  const markedLines = [
    "- [ ] #task Ship the thing [scheduled:: 2026-08-13] ^ship",
    "  - 🗓️ **SCHEDULE LOG**",
    "    - *2026-08-06 → 2026-08-13* — was out sick",
  ];
  const previewFor = (lines, value) => {
    const { picker } = openBareScheduleStage(lines.join("\n"));
    picker.openItem({ kind: "value", value, label: value, searchText: value });
    assert.equal(picker.stage, "schedule-review");
    picker.scheduleReviewReasonEl.value = "";
    return picker.getFilteredItems()[0];
  };

  const marked = previewFor(markedLines, "2026-08-20");
  assert.equal(marked.reasonEmpty, true);
  assert.equal(marked.reasonFallback, true);
  assert.equal(marked.parentExists, true);

  const unmarked = previewFor(
    ["- [ ] #task Ship the thing [scheduled:: 2026-08-13] ^ship"],
    "2026-08-20",
  );
  assert.equal(unmarked.reasonEmpty, true);
  assert.equal(unmarked.reasonFallback, false);
  assert.equal(unmarked.parentExists, false);

  // Marker exists but the picked date equals the current one: still no
  // fallback, since a generated entry never claims a change that did not
  // happen.
  const sameDate = previewFor(markedLines, "2026-08-13");
  assert.equal(sameDate.reasonEmpty, true);
  assert.equal(sameDate.reasonFallback, false);
});

test("the review footer flips between Skip optional logs and Apply schedule as the Reason changes", () => {
  const { picker } = openBareScheduleStage(
    "- [ ] #task Ship the thing ^ship",
  );
  picker.openItem({ kind: "value", value: "2026-08-20", label: "x", searchText: "x" });
  assert.equal(picker.stage, "schedule-review");
  const enterLabel = () =>
    picker.footerHints.find((hint) => hint.keys.includes("↵")).label;

  picker.scheduleReviewReasonEl.value = "";
  picker.renderResults();
  assert.equal(enterLabel(), "Skip optional logs");

  picker.scheduleReviewReasonEl.value = "waiting on the API review to land";
  picker.renderResults();
  assert.equal(enterLabel(), "Apply schedule");
});

test("closing the picker during the review clears pending schedule state and writes nothing", () => {
  const lineText = "- [ ] #task Ship the thing ^ship";
  const { editor, picker } = openBareScheduleStage(lineText);
  picker.openItem(picker.items.find((item) => item.kind === "value"));
  assert.equal(picker.stage, "schedule-review");
  assert.ok(picker.pendingScheduleReason);
  assert.ok(picker.pendingScheduleReview);

  picker.onClose();

  assert.equal(picker.pendingScheduleReason, null);
  assert.equal(picker.pendingScheduleReview, null);
  assert.equal(editor.content, lineText);
});
