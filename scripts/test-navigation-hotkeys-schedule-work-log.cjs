const test = require("node:test");
const assert = require("node:assert/strict");
const {
  notices,
  helpers,
  createBulletPropertyPickerHarness,
  choosePriorityLevel,
  runCardAction,
  confirmScheduleReasonStage,
} = require("./navigation-hotkeys-harness.cjs");

async function confirmSchedulingWorkLogStage(picker, summary = "") {
  assert.equal(picker.stage, "schedule-work-log");
  picker.inputEl = { value: summary };
  picker.visibleItems = picker.getFilteredItems();
  return await picker.openItemAtIndex(0);
}

function schedulingWorkLogConfig() {
  return helpers.validateBulletPropertyConfig({
    properties: [
      { name: "scheduled", values: "date" },
      {
        name: "priority",
        values: "priority",
        schedules: "scheduled",
        levels: [
          { label: "P1", value: "high", min_days: 2, max_days: 7 },
          { label: "P2", value: "medium", min_days: 8, max_days: 30 },
        ],
      },
    ],
  });
}

test("scheduling Work Log eligibility requires Pending or Next #task lines", () => {
  assert.equal(helpers.isSchedulingWorkLogRawLine("- [/] #task Pending ^a"), true);
  assert.equal(helpers.isSchedulingWorkLogRawLine("- [*] #task Next ^b"), true);
  assert.equal(helpers.isSchedulingWorkLogRawLine("- [ ] #task Ready ^c"), false);
  assert.equal(helpers.isSchedulingWorkLogRawLine("- [?] #task Blocked ^d"), false);
  assert.equal(helpers.isSchedulingWorkLogRawLine("- [x] #task Done ^e"), false);
  assert.equal(helpers.isSchedulingWorkLogRawLine("- [/] plain bullet ^f"), false);
  assert.equal(helpers.isSchedulingWorkLogRawLine("not a task"), false);
  assert.equal(
    helpers.collectSchedulingWorkLogEligibleOriginalLines([
      { line: 0, rawLine: "- [/] #task A ^a" },
      { line: 1, rawLine: "- [ ] #task B ^b" },
      { line: 2, rawLine: "- [*] #task C ^c" },
    ]).size,
    2,
  );
});

// Open the card's schedule row, pick one preset date, and land on the
// combined Reason / Work summary review. Nothing is written yet.
async function openSchedulingReview(harness, dateValue, openOptions = {}) {
  assert.equal(harness.open(openOptions), true);
  const picker = harness.plugin.activeBulletPropertyPicker;
  await picker.openTaskCardAction("schedule");
  assert.equal(picker.stage, "value");
  const dateItem = picker.visibleItems.find(
    (item) => item.kind === "value" && item.value === dateValue,
  );
  assert.ok(dateItem, `no ${dateValue} date item`);
  await picker.openItem(dateItem);
  assert.equal(picker.stage, "schedule-review");
  return picker;
}

function schedulingReviewHarness(content, extra = {}) {
  return createBulletPropertyPickerHarness({
    config: schedulingWorkLogConfig(),
    content,
    cursor: { line: 0, ch: 0 },
    baseDate: new Date(2026, 9, 2),
    ...extra,
  });
}

test("single Pending explicit date opens one review and writes both logs", async () => {
  notices.length = 0;
  const harness = schedulingReviewHarness("- [/] #task Pending work ^a");
  const picker = await openSchedulingReview(harness, "2026-10-05");
  assert.equal(harness.editor.content, "- [/] #task Pending work ^a");
  assert.ok(picker.scheduleReviewReasonEl, "Reason field");
  assert.ok(picker.scheduleReviewSummaryEl, "Work summary field");
  assert.equal(picker.pendingScheduleReview.needsWorkLog, true);
  assert.equal(picker.pendingScheduleReview.eligibleCount, 1);
  assert.equal(picker.stage === "schedule-work-log", false);
  await confirmScheduleReasonStage(picker, "replan", "Did the thing");
  assert.match(harness.editor.content, /\[scheduled:: 2026-10-05\]/);
  assert.match(harness.editor.content, /🗓️ \*\*SCHEDULE LOG\*\*/);
  assert.match(harness.editor.content, /\*2026-10-05\* — replan/);
  assert.match(harness.editor.content, /\*2026-10-02\* — Did the thing/);
  assert.match(harness.editor.content, /🛠️ \*\*WORK LOG\*\*/);
  assert.match(notices.at(-1), /1 Work Log/);
});

test("single Next blank and whitespace summaries schedule without a Work Log", async () => {
  for (const summary of ["", "   "]) {
    notices.length = 0;
    const harness = schedulingReviewHarness("- [*] #task Next work ^a");
    const picker = await openSchedulingReview(harness, "2026-10-05");
    assert.ok(picker.scheduleReviewSummaryEl);
    await confirmScheduleReasonStage(picker, "", summary);
    assert.match(harness.editor.content, /\[scheduled:: 2026-10-05\]/);
    assert.doesNotMatch(harness.editor.content, /🛠️ \*\*WORK LOG\*\*/);
    assert.doesNotMatch(notices.at(-1) || "", /Work Log/);
    assert.doesNotMatch(harness.editor.content, /🤷 no reason given/);
  }
});

test("Escape at the review writes nothing, with or without typed text", async () => {
  const content = "- [/] #task Pending work ^a";
  const harness = schedulingReviewHarness(content);
  const picker = await openSchedulingReview(harness, "2026-10-05");
  picker.close();
  assert.equal(harness.editor.content, content);

  const harness2 = schedulingReviewHarness(content);
  const picker2 = await openSchedulingReview(harness2, "2026-10-05");
  picker2.scheduleReviewReasonEl.value = "replan";
  picker2.scheduleReviewSummaryEl.value = "Did work";
  assert.equal(harness2.editor.content, content);
  picker2.close();
  assert.equal(harness2.editor.content, content);
  assert.equal(picker2.pendingScheduleReview, null);
});

test("Ready and Blocked explicit dates review the Reason with no Work summary field", async () => {
  for (const status of [" ", "?"]) {
    notices.length = 0;
    const harness = schedulingReviewHarness(`- [${status}] #task Task ^a`);
    const picker = await openSchedulingReview(harness, "2026-10-05");
    assert.ok(picker.scheduleReviewReasonEl);
    assert.equal(picker.scheduleReviewSummaryEl, null);
    assert.equal(picker.pendingScheduleReview.needsWorkLog, false);
    await confirmScheduleReasonStage(picker, "replan");
    assert.match(harness.editor.content, /\[scheduled:: 2026-10-05\]/);
    assert.doesNotMatch(harness.editor.content, /🛠️ \*\*WORK LOG\*\*/);
  }
});

test("future scheduling on Pending marks Blocked but still writes the Work Log", async () => {
  notices.length = 0;
  const harness = schedulingReviewHarness("- [/] #task Pending work ^a");
  const picker = await openSchedulingReview(harness, "2026-11-02");
  await confirmScheduleReasonStage(picker, "later", "Did prep");
  assert.match(harness.editor.content, /- \[\?\] #task Pending work/);
  assert.match(harness.editor.content, /\*2026-10-02\* — Did prep/);
});

test("today date on Pending still offers the Work Log", async () => {
  const harness = schedulingReviewHarness("- [/] #task Pending work ^a");
  const picker = await openSchedulingReview(harness, "2026-10-02");
  assert.ok(picker.scheduleReviewSummaryEl);
  await confirmScheduleReasonStage(picker, "", "Worked today");
  assert.match(harness.editor.content, /\*2026-10-02\* — Worked today/);
});

test("priority pick on Pending freezes its roll and offers the Work Log", async () => {
  notices.length = 0;
  const harness = schedulingReviewHarness("- [/] #task Pending work ^a", {
    random: () => 0,
  });
  const picker = await choosePriorityLevel(harness, "P1");
  assert.equal(picker.stage, "schedule-work-log");
  assert.equal(harness.editor.content, "- [/] #task Pending work ^a");
  const frozen = String(picker.pendingScheduleWorkLog.scheduleSummary || "");
  assert.match(frozen, /scheduled → 2026-10-0[4-9]/);
  await confirmSchedulingWorkLogStage(picker, "Priority work");
  const expectedDate = frozen.match(/(\d{4}-\d{2}-\d{2})/)[1];
  assert.ok(harness.editor.content.includes(`[scheduled:: ${expectedDate}]`));
  assert.match(harness.editor.content, /\*2026-10-02\* — Priority work/);
  assert.match(harness.editor.content, /🎲 P0 → P1/);
});

test("counted mixed statuses share one summary only on Pending and Next", async () => {
  notices.length = 0;
  const content = [
    "- [/] #task Pending one ^a",
    "- [*] #task Next two ^b",
    "- [ ] #task Ready three ^c",
    "- [?] #task Blocked four ^d",
  ].join("\n");
  const harness = schedulingReviewHarness(content);
  const picker = await openSchedulingReview(harness, "2026-10-02", {
    countExplicit: true,
    additionalTaskCount: 3,
  });
  assert.ok(picker.scheduleReviewSummaryEl);
  assert.equal(picker.pendingScheduleReview.eligibleCount, 2);
  const beforeUndo = harness.editor.undoGroups;
  await confirmScheduleReasonStage(picker, "batch", "Shared work");
  assert.equal(harness.editor.undoGroups, beforeUndo + 1);
  const after = harness.editor.content;
  assert.equal((after.match(/\*2026-10-02\* — Shared work/g) || []).length, 2);
  assert.ok(after.includes("- [/] #task Pending one"));
  assert.ok(after.includes("- [*] #task Next two"));
  assert.doesNotMatch(after, /Ready three[^]*🛠️ \*\*WORK LOG\*\*/);
});

test("counted planner composes Schedule and Work Logs bottom-up above later targets", () => {
  const content = [
    "- [/] #task First ^a",
    "  - note child",
    "- [*] #task Second ^b",
  ].join("\n");
  const session = Object.freeze({
    valid: true,
    error: null,
    explicit: true,
    targets: Object.freeze([
      { line: 0, rawLine: "- [/] #task First ^a" },
      { line: 2, rawLine: "- [*] #task Second ^b" },
    ]),
  });
  const plan = helpers.planCountedBulletPropertyBatch(
    content,
    session,
    "scheduled",
    "2026-10-05",
    {
      operation: "set",
      today: new Date(2026, 9, 2),
      scheduleLog: { reason: "batch" },
      schedulingWorkLog: { summary: "Did work", dateText: "2026-10-02" },
    },
  );
  assert.equal(plan.valid, true);
  assert.equal(plan.schedulingWorkLogWrittenCount, 2);
  assert.equal(plan.schedulingWorkLogEligibleCount, 2);
  const lines = String(plan.content).split("\n");
  const firstTask = lines.findIndex((line) => line.includes("First"));
  const secondTask = lines.findIndex((line) => line.includes("Second"));
  assert.ok(firstTask < secondTask);
  assert.equal(
    String(plan.content).match(/\*2026-10-02\* — Did work/g).length,
    2,
  );
  assert.ok(String(plan.content).includes("🗓️ **SCHEDULE LOG**"));
  assert.ok(String(plan.content).includes("🛠️ **WORK LOG**"));
});

test("counted planner writes a Work Log even when the date is unchanged", () => {
  const line = "- [/] #task Pending [scheduled:: 2026-10-05] ^a";
  const session = Object.freeze({
    valid: true,
    error: null,
    explicit: true,
    targets: Object.freeze([{ line: 0, rawLine: line }]),
  });
  const plan = helpers.planCountedBulletPropertyBatch(line, session, "scheduled", "2026-10-05", {
    operation: "set",
    today: new Date(2026, 9, 2),
    schedulingWorkLog: { summary: "Still worked", dateText: "2026-10-02" },
  });
  assert.equal(plan.valid, true);
  assert.equal(plan.changed, true);
  assert.equal(plan.schedulingWorkLogWrittenCount, 1);
  assert.match(plan.content, /\*2026-10-02\* — Still worked/);
});

test("scheduling Work Log ownership keeps nested logs and CRLF endings", () => {
  const content = "- [/] #task Parent ^a\r\n\t- child task\r\n\t- 🛠️ **WORK LOG**\r\n\t\t- *2026-10-01* — Old work\r\n- [*] #task Sibling ^b";
  const session = Object.freeze({
    valid: true,
    error: null,
    explicit: true,
    targets: Object.freeze([
      { line: 0, rawLine: "- [/] #task Parent ^a" },
      { line: 4, rawLine: "- [*] #task Sibling ^b" },
    ]),
  });
  const plan = helpers.planCountedBulletPropertyBatch(content, session, "scheduled", "2026-10-05", {
    operation: "set",
    today: new Date(2026, 9, 2),
    schedulingWorkLog: { summary: "New **markdown** work", dateText: "2026-10-02" },
  });
  assert.equal(plan.valid, true);
  assert.equal(plan.schedulingWorkLogWrittenCount, 2);
  assert.ok(plan.content.includes("\r\n"));
  assert.match(plan.content, /\*2026-10-02\* — New \*\*markdown\*\* work/);
  assert.match(plan.content, /\*2026-10-01\* — Old work/);
});

test("scheduling Work Log warns on :: and preserves Markdown", async () => {
  const harness = schedulingReviewHarness("- [/] #task Pending ^a");
  const picker = await openSchedulingReview(harness, "2026-10-05");
  picker.scheduleReviewReasonEl.value = "r";
  picker.scheduleReviewSummaryEl.value = "did :: field";
  const preview = picker.getFilteredItems()[0];
  assert.equal(preview.summaryHasInlineField, true);
  await confirmScheduleReasonStage(picker, "r", "did :: field");
  assert.match(harness.editor.content, /did :: field/);
});

test("stale task while reviewing refuses with no scheduling or log writes", async () => {
  notices.length = 0;
  const harness = schedulingReviewHarness("- [/] #task Pending ^a");
  const picker = await openSchedulingReview(harness, "2026-10-05");
  harness.editor.content = "- [/] #task Changed ^a";
  await confirmScheduleReasonStage(picker, "replan", "Late work");
  assert.equal(harness.editor.content, "- [/] #task Changed ^a");
  assert.doesNotMatch(harness.editor.content, /SCHEDULE LOG/);
  assert.doesNotMatch(harness.editor.content, /WORK LOG/);
  assert.match(notices.at(-1), /changed|stale|no tasks were updated/i);
  assert.equal(picker.stage, "task-card");
  assert.equal(picker.isOpen, true);
});

test("scheduling prompts never leak into lane or cancel stages", async () => {
  const harness = schedulingReviewHarness("- [/] #task Pending ^a");
  assert.equal(harness.open(), true);
  const picker = harness.plugin.activeBulletPropertyPicker;
  await runCardAction(picker, "lane");
  assert.equal(picker.stage, "lane-release-reason");
  picker.returnToTaskCard();
  await runCardAction(picker, "cancel");
  assert.equal(picker.stage, "cancel-reason");
  assert.equal(harness.editor.content, "- [/] #task Pending ^a");
});

