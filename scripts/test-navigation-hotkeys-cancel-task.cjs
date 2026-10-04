const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  notices,
  NavigationHotkeysPlugin,
  helpers,
  TestEditor,
  TransactionEditor,
  compatibleTasksSettings,
  createBulletPropertyPickerHarness,
  createFragmentNode,
  findFragmentNode,
  collectFragmentNodes,
  runCardAction,
  buildScheduleReasonConfig,
  createLinkPickerHarness,
} = require("./navigation-hotkeys-harness.cjs");

function cancelRowIndex(picker) {
  return picker.propertyItems.findIndex((item) => item.kind === "cancel-task");
}

// Complete the cancel reason-stage prompt through the same openItemAtIndex
// entry point production code uses. The test harness never calls onOpen(), so
// resultsEl stays unset and renderAll() never refreshes visibleItems; refresh
// it manually here the way renderResults() would.
async function confirmCancelReasonStage(picker, reasonText = "") {
  assert.equal(picker.stage, "cancel-reason");
  picker.inputEl = { value: reasonText };
  picker.visibleItems = picker.getFilteredItems();
  return await picker.openItemAtIndex(0);
}

function openCancelReasonStage(harnessOptions = {}, openOptions = {}) {
  const harness = createBulletPropertyPickerHarness({
    config: buildScheduleReasonConfig(),
    baseDate: new Date(2026, 7, 3),
    ...harnessOptions,
  });
  assert.equal(harness.open(openOptions), true);
  return harness;
}

test("getCancelTaskRowTitle names single, counted, and link sessions", () => {
  assert.equal(
    helpers.getCancelTaskRowTitle({ kind: "task", openCount: 1, count: 1 }),
    "Cancel task",
  );
  assert.equal(
    helpers.getCancelTaskRowTitle({ kind: "task", openCount: 3, count: 3 }),
    "Cancel 3 tasks",
  );
  assert.equal(
    helpers.getCancelTaskRowTitle({ kind: "link", openCount: 1, count: 1 }),
    "Cancel linked task",
  );
  assert.equal(
    helpers.getCancelTaskRowTitle({ kind: "link", openCount: 2, count: 2 }),
    "Cancel 2 linked tasks",
  );
});

test("getCancelReasonHints labels Enter per state and Esc as Keep open", () => {
  assert.deepEqual(helpers.getCancelReasonHints({ empty: true, count: 1 }), [
    { keys: ["↵"], label: "Cancel task" },
    { keys: ["esc"], label: "Keep open" },
  ]);
  assert.deepEqual(helpers.getCancelReasonHints({ empty: true, count: 3 }), [
    { keys: ["↵"], label: "Cancel tasks" },
    { keys: ["esc"], label: "Keep open" },
  ]);
  assert.deepEqual(
    helpers.getCancelReasonHints({ empty: true, fallback: true }),
    [
      { keys: ["↵"], label: "Cancel & log 🤷" },
      { keys: ["esc"], label: "Keep open" },
    ],
  );
  assert.deepEqual(helpers.getCancelReasonHints({ empty: false }), [
    { keys: ["↵"], label: "Cancel & log reason" },
    { keys: ["esc"], label: "Keep open" },
  ]);
});

test("the Cancel property item and the card's cancel row describe an open task", () => {
  const harness = openCancelReasonStage({
    content: "- [ ] #task Ship it [priority:: high] ^ship",
  });
  const picker = harness.plugin.activeBulletPropertyPicker;
  assert.ok(picker.propertyItems.length > 1);
  const index = cancelRowIndex(picker);
  assert.notEqual(index, -1);
  assert.equal(index, picker.propertyItems.length - 1);
  const item = picker.propertyItems[index];
  assert.equal(item.property.name, "cancel");
  assert.equal(item.title, "Cancel task");
  assert.equal(item.detail, "Ready → Cancelled · asks why");
  assert.equal(item.recurring, false);
  // The card owns the surface: its cancel row is enabled and no list opens.
  assert.equal(picker.stage, "task-card");
  const row = picker.taskCardModel.rows.find((entry) => entry.id === "cancel");
  assert.equal(row.enabled, true);
  assert.equal(picker.taskCardSelectedRowId, "schedule");
  picker.close();
  harness.plugin.activeBulletPropertyPicker = null;
});

test("Cancel row hides on closed tasks, plain bullets, and all-closed sessions", () => {
  for (const content of [
    "- [x] #task Done ^done",
    "- [-] #task Cancelled ^cancelled",
    "- just a bullet",
  ]) {
    const harness = openCancelReasonStage({ content });
    const picker = harness.plugin.activeBulletPropertyPicker;
    assert.equal(
      cancelRowIndex(picker),
      -1,
      content,
    );
    picker.close();
    harness.plugin.activeBulletPropertyPicker = null;
  }

  const counted = openCancelReasonStage(
    { content: "- [x] #task One ^one\n- [x] #task Two ^two" },
    { countExplicit: true, additionalTaskCount: 1 },
  );
  assert.equal(
    cancelRowIndex(counted.plugin.activeBulletPropertyPicker),
    -1,
  );
  counted.plugin.activeBulletPropertyPicker.close();
  counted.plugin.activeBulletPropertyPicker = null;
});

test("Cancel row reports skipped closed targets in a counted session", () => {
  const harness = openCancelReasonStage(
    {
      content:
        "- [ ] #task One ^one\n- [ ] #task Two ^two\n- [x] #task Done ^done",
    },
    { countExplicit: true, additionalTaskCount: 2 },
  );
  const picker = harness.plugin.activeBulletPropertyPicker;
  const index = cancelRowIndex(picker);
  assert.notEqual(index, -1);
  assert.equal(index, picker.propertyItems.length - 1);
  assert.equal(picker.propertyItems[index].title, "Cancel 2 tasks");
  assert.equal(
    picker.propertyItems[index].detail,
    "2 tasks → Cancelled · 1 already closed",
  );
  picker.close();
  harness.plugin.activeBulletPropertyPicker = null;
});

test("the card refuses the cancel row on a recurring task and stays on the card", async () => {
  notices.length = 0;
  const harness = openCancelReasonStage({
    content: "- [ ] #task Ship it 🔁 ^ship",
  });
  const picker = harness.plugin.activeBulletPropertyPicker;
  const index = cancelRowIndex(picker);
  assert.notEqual(index, -1);
  assert.equal(
    picker.propertyItems[index].detail,
    "recurring · use Obsidian Tasks",
  );
  const row = picker.taskCardModel.rows.find((entry) => entry.id === "cancel");
  assert.equal(row.enabled, false);
  const handled = await picker.dispatchTaskCardIntent(
    helpers.resolveTaskCardKey(picker.taskCardModel, { key: "x" }),
  );
  assert.equal(handled, false);
  assert.equal(picker.stage, "task-card");
  assert.ok(notices.length > 0);
  assert.equal(
    harness.editor.content,
    "- [ ] #task Ship it 🔁 ^ship",
  );
  picker.close();
  harness.plugin.activeBulletPropertyPicker = null;
});

test("cancel reason stage previews the typed, empty, fallback, and :: cases", () => {
  const config = buildScheduleReasonConfig();
  const lineText = "- [ ] #task Ship it [priority:: high] ^ship";
  const editor = new TestEditor(lineText);
  const picker = new helpers.BulletPropertyPickerModal(
    {},
    {},
    editor,
    { line: 0, ch: 0 },
    lineText,
    config,
    { filePath: "Tasks.md", baseDate: new Date(2026, 7, 3) },
  );
  picker.showCancelReasonStage({
    title: "Cancel task",
    cancelKind: "task",
    openCount: 1,
    fromStatus: "Next",
  });
  assert.equal(picker.stage, "cancel-reason");
  assert.equal(
    picker.getCancelReasonSubtitle(),
    "Next → Cancelled · Mon 2026-08-03 · nothing written yet",
  );

  picker.inputEl = { value: "Superseded by [[other]]" };
  const [typed] = picker.getFilteredItems();
  assert.equal(typed.kind, "cancel-reason-preview");
  assert.equal(typed.empty, false);
  assert.equal(typed.fallback, false);
  assert.equal(typed.reason, "Superseded by [[other]]");
  assert.equal(
    helpers.formatCancelLogEntryText({ date: "2026-08-03", reason: typed.reason }),
    "*2026-08-03* — Superseded by [[other]]",
  );

  picker.inputEl = { value: "" };
  const [empty] = picker.getFilteredItems();
  assert.equal(empty.empty, true);
  assert.equal(empty.fallback, false);

  picker.inputEl = { value: "blocked:: x" };
  const [warning] = picker.getFilteredItems();
  assert.equal(warning.empty, false);
  assert.equal(warning.hasInlineField, true);

  // A task that already keeps a log falls back on an empty reason.
  const loggedLines = [
    "- [ ] #task Ship it ^ship",
    "  - ❌ **CANCEL LOG**",
    "    - *2026-08-01* — first reason",
  ];
  const loggedEditor = new TestEditor(loggedLines.join("\n"));
  const loggedPicker = new helpers.BulletPropertyPickerModal(
    {},
    {},
    loggedEditor,
    { line: 0, ch: 0 },
    loggedLines[0],
    config,
    { filePath: "Tasks.md", baseDate: new Date(2026, 7, 3) },
  );
  loggedPicker.showCancelReasonStage({
    title: "Cancel task",
    cancelKind: "task",
    openCount: 1,
    fromStatus: "Ready",
  });
  loggedPicker.inputEl = { value: "" };
  const [fallback] = loggedPicker.getFilteredItems();
  assert.equal(fallback.empty, true);
  assert.equal(fallback.fallback, true);
});

test("cancel reason footer flips between plain, log, and fallback labels", () => {
  const config = buildScheduleReasonConfig();
  const lineText = "- [ ] #task Ship it ^ship";
  const editor = new TestEditor(lineText);
  const picker = new helpers.BulletPropertyPickerModal(
    {},
    {},
    editor,
    { line: 0, ch: 0 },
    lineText,
    config,
    { filePath: "Tasks.md", baseDate: new Date(2026, 7, 3) },
  );
  picker.showCancelReasonStage({
    title: "Cancel task",
    cancelKind: "task",
    openCount: 1,
    fromStatus: "Ready",
  });
  // renderResults() drives real DOM rendering through the base class; stub it
  // out here so only this subclass override's post-super.renderResults()
  // footer-hint logic (the thing under test) actually runs.
  const originalRenderResults =
    helpers.FilteredPickerModal.prototype.renderResults;
  helpers.FilteredPickerModal.prototype.renderResults = function stubbedRenderResults() {
    this.visibleItems = this.getFilteredItems();
  };
  try {
    picker.inputEl = { value: "" };
    picker.renderResults();
    assert.deepEqual(picker.footerHints, [
      { keys: ["↵"], label: "Cancel task" },
      { keys: ["esc"], label: "Keep open" },
    ]);
    picker.inputEl = { value: "obsolete" };
    picker.renderResults();
    assert.deepEqual(picker.footerHints, [
      { keys: ["↵"], label: "Cancel & log reason" },
      { keys: ["esc"], label: "Keep open" },
    ]);
  } finally {
    helpers.FilteredPickerModal.prototype.renderResults = originalRenderResults;
  }
});

test("Esc from the cancel reason stage writes nothing", async () => {
  notices.length = 0;
  const harness = openCancelReasonStage({
    content: "- [ ] #task Ship it ^ship",
  });
  const picker = harness.plugin.activeBulletPropertyPicker;
  await runCardAction(picker, "cancel");
  assert.equal(picker.stage, "cancel-reason");
  picker.close();
  harness.plugin.activeBulletPropertyPicker = null;
  assert.equal(harness.editor.content, "- [ ] #task Ship it ^ship");
  assert.equal(notices.length, 0);
});

test("single cancel writes [-], stamp, and first-child log in one transaction", async () => {
  notices.length = 0;
  const harness = openCancelReasonStage({
    content: "- [ ] #task Ship it [priority:: high] ^ship",
  });
  const picker = harness.plugin.activeBulletPropertyPicker;
  await runCardAction(picker, "cancel");
  await confirmCancelReasonStage(picker, "Superseded by [[other]]");
  assert.deepEqual(harness.editor.content.split("\n"), [
    "- [-] #task Ship it [priority:: high] [cancelled:: 2026-08-03] ^ship",
    "\t- ❌ **CANCEL LOG**",
    "\t\t- *2026-08-03* — Superseded by [[other]]",
  ]);
  assert.equal(harness.editor.transactions.length, 1);
  assert.equal(harness.editor.cursor.line, 0);
  assert.match(
    notices.at(-1),
    /Cancelled task · “Superseded by \[\[other\]\]”/,
  );
});

test("empty reason writes no log unless one already exists", async () => {
  notices.length = 0;
  const plain = openCancelReasonStage({
    content: "- [ ] #task Ship it ^ship",
  });
  await runCardAction(plain.plugin.activeBulletPropertyPicker, "cancel");
  await confirmCancelReasonStage(plain.plugin.activeBulletPropertyPicker, "");
  assert.equal(
    plain.editor.content,
    "- [-] #task Ship it [cancelled:: 2026-08-03] ^ship",
  );
  assert.doesNotMatch(plain.editor.content, /CANCEL LOG/);
  assert.match(notices.at(-1), /^Cancelled task$/);

  notices.length = 0;
  const logged = openCancelReasonStage({
    content: [
      "- [ ] #task Ship it ^ship",
      "  - ❌ **CANCEL LOG**",
      "    - *2026-08-01* — first reason",
    ].join("\n"),
  });
  await runCardAction(logged.plugin.activeBulletPropertyPicker, "cancel");
  await confirmCancelReasonStage(logged.plugin.activeBulletPropertyPicker, "");
  assert.deepEqual(logged.editor.content.split("\n"), [
    "- [-] #task Ship it [cancelled:: 2026-08-03] ^ship",
    "  - ❌ **CANCEL LOG**",
    "    - *2026-08-03* — 🤷 no reason given",
    "    - *2026-08-01* — first reason",
  ]);
  assert.match(notices.at(-1), /🤷 no reason given · logged/);
});

test("stale single preimage refuses with nothing written", async () => {
  notices.length = 0;
  const harness = openCancelReasonStage({
    content: "- [ ] #task Ship it ^ship",
  });
  const picker = harness.plugin.activeBulletPropertyPicker;
  await runCardAction(picker, "cancel");
  harness.editor.content = "- [ ] #task Ship it, edited ^ship";
  await confirmCancelReasonStage(picker, "too late");
  assert.match(
    notices.at(-1),
    /Current task changed while the picker was open; no tasks were updated/,
  );
  assert.equal(
    harness.editor.content,
    "- [ ] #task Ship it, edited ^ship",
  );
  // The modal stays open on the reason stage after a refused confirm.
  assert.equal(picker.stage, "cancel-reason");
  picker.close();
  harness.plugin.activeBulletPropertyPicker = null;
});

test("cancel writes [-] with no NOW chip", async () => {
  notices.length = 0;
  const harness = openCancelReasonStage({
    content: "- [*] #task Ship it ^ship",
  });
  const picker = harness.plugin.activeBulletPropertyPicker;
  await runCardAction(picker, "cancel");
  await confirmCancelReasonStage(picker, "obsolete");
  assert.match(harness.editor.content, /\[-]/);
  assert.match(notices.at(-1), /Cancelled task/);
  assert.doesNotMatch(notices.at(-1), /NOW/);
});

test("TSC recovery runs with cancelled identities; a missing API still succeeds", async () => {
  const calls = [];
  const withApi = openCancelReasonStage({
    content: "- [ ] #task Ship it [id:: Tasks/ship] ^ship",
    app: {
      plugins: {
        plugins: {
          "task-status-cycler": {
            api: {
              version: 1,
              recoverBlockedDependents: async (identities, context) => {
                calls.push({ identities, context });
                return { reopened: 1, failures: [] };
              },
            },
          },
        },
      },
    },
  });
  notices.length = 0;
  await runCardAction(withApi.plugin.activeBulletPropertyPicker, "cancel");
  await confirmCancelReasonStage(
    withApi.plugin.activeBulletPropertyPicker,
    "obsolete",
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].identities, [
    { path: "Tasks.md", blockId: "ship", taskId: "Tasks/ship" },
  ]);
  assert.match(notices.at(-1), /unblocked 1 dependent/);

  notices.length = 0;
  const withoutApi = openCancelReasonStage({
    content: "- [ ] #task Ship it ^ship",
  });
  await runCardAction(withoutApi.plugin.activeBulletPropertyPicker, "cancel");
  await confirmCancelReasonStage(
    withoutApi.plugin.activeBulletPropertyPicker,
    "obsolete",
  );
  assert.match(withoutApi.editor.content, /\[-]/);
  assert.doesNotMatch(notices.at(-1), /unblocked/);
});

test("a throwing TSC API is skipped silently with no chip", async () => {
  notices.length = 0;
  const harness = openCancelReasonStage({
    content: "- [ ] #task Ship it ^ship",
    app: {
      plugins: {
        plugins: {
          "task-status-cycler": {
            api: {
              version: 1,
              recoverBlockedDependents: async () => {
                throw new Error("queue busy");
              },
            },
          },
        },
      },
    },
  });
  await runCardAction(harness.plugin.activeBulletPropertyPicker, "cancel");
  await confirmCancelReasonStage(
    harness.plugin.activeBulletPropertyPicker,
    "obsolete",
  );
  assert.match(harness.editor.content, /\[-]/);
  assert.doesNotMatch(notices.at(-1), /unblocked/);
});

test("counted cancel skips closed targets and reports them", async () => {
  notices.length = 0;
  const harness = openCancelReasonStage(
    {
      content:
        "- [ ] #task One ^one\n- [ ] #task Two ^two\n- [x] #task Done ^done",
    },
    { countExplicit: true, additionalTaskCount: 2 },
  );
  const picker = harness.plugin.activeBulletPropertyPicker;
  await runCardAction(picker, "cancel");
  assert.equal(picker.getCancelReasonSubtitle(), "2 tasks → Cancelled · Mon 2026-08-03 · nothing written yet");
  await confirmCancelReasonStage(picker, "obsolete");
  assert.deepEqual(harness.editor.content.split("\n"), [
    "- [-] #task One [cancelled:: 2026-08-03] ^one",
    "\t- ❌ **CANCEL LOG**",
    "\t\t- *2026-08-03* — obsolete",
    "- [-] #task Two [cancelled:: 2026-08-03] ^two",
    "\t- ❌ **CANCEL LOG**",
    "\t\t- *2026-08-03* — obsolete",
    "- [x] #task Done ^done",
  ]);
  assert.match(notices.at(-1), /Cancelled 2 tasks · “obsolete”/);
  assert.match(notices.at(-1), /skipped 1 closed/);
});

test("same-file cancel folds today's Pomodoro prune into one transaction", async () => {
  notices.length = 0;
  const today = new Date();
  const year = String(today.getFullYear()).padStart(4, "0");
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  const dateText = `${year}-${month}-${day}`;
  const dailyPath = `${year}/${year}${month}${day}.md`;
  const content = [
    "## Pomodoros",
    "",
    "- [ ] Current (0900-0930)",
    "  - [[#^ship]]",
    "- [ ] #task Ship it ^ship",
  ].join("\n");
  const editor = new TransactionEditor(content, { line: 4, ch: 0 });
  const dailyFile = { path: dailyPath, basename: dailyPath, extension: "md" };
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    plugins: { plugins: {} },
    workspace: { getLeavesOfType: () => [] },
    vault: {
      getMarkdownFiles: () => [dailyFile],
      cachedRead: async () => content,
      adapter: { read: async () => JSON.stringify(compatibleTasksSettings()) },
    },
  };
  plugin.getActiveMarkdownView = () => ({ editor, file: dailyFile });
  assert.equal(
    plugin.openBulletPropertyPicker(editor, {
      config: buildScheduleReasonConfig(),
      baseDate: today,
    }),
    true,
  );
  const picker = plugin.activeBulletPropertyPicker;
  await runCardAction(picker, "cancel");
  picker.inputEl = { value: "done" };
  picker.visibleItems = picker.getFilteredItems();
  await picker.openItemAtIndex(0);
  assert.deepEqual(editor.content.split("\n"), [
    "## Pomodoros",
    "",
    "- [ ] Current (0900-0930)",
    `- [-] #task Ship it [cancelled:: ${dateText}] ^ship`,
    "\t- ❌ **CANCEL LOG**",
    `\t\t- *${dateText}* — done`,
  ]);
  assert.equal(editor.transactions.length, 1);
  assert.match(notices.at(-1), /removed 1 Pomodoro link/);
  plugin.activeBulletPropertyPicker = null;
});

test("link session cancels the target and removes the invoking link bullet", async () => {
  notices.length = 0;
  const today = new Date();
  const year = String(today.getFullYear()).padStart(4, "0");
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  const dateText = `${year}-${month}-${day}`;
  const dailyPath = `${year}/${year}${month}${day}.md`;
  const linkContent = [
    "## Pomodoros",
    "",
    "- [ ] Current (0900-0930)",
    "  - [[Tasks#^a1]]",
  ].join("\n");
  const taskEditor = new TransactionEditor("- [ ] #task Ship it ^a1", {
    line: 0,
    ch: 0,
  });
  const harness = createLinkPickerHarness({
    linkPath: dailyPath,
    linkContent,
    cursor: { line: 3, ch: 0 },
    notes: { "Tasks.md": "- [ ] #task Ship it ^a1" },
    openEditors: { "Tasks.md": taskEditor },
  });
  assert.equal(
    await harness.plugin.openLinkPicker(harness.linkEditor, {
      config: harness.config,
      baseDate: today,
      random: () => 0,
    }),
    true,
  );
  const picker = harness.plugin.activeBulletPropertyPicker;
  assert.equal(picker.isLinkSession(), true);
  const index = cancelRowIndex(picker);
  assert.notEqual(index, -1);
  assert.equal(picker.propertyItems[index].title, "Cancel linked task");
  await runCardAction(picker, "cancel");
  assert.equal(picker.stage, "cancel-reason");
  picker.inputEl = { value: "superseded" };
  picker.visibleItems = picker.getFilteredItems();
  await picker.openItemAtIndex(0);
  assert.deepEqual(taskEditor.content.split("\n"), [
    `- [-] #task Ship it [cancelled:: ${dateText}] ^a1`,
    "\t- ❌ **CANCEL LOG**",
    `\t\t- *${dateText}* — superseded`,
  ]);
  assert.deepEqual(harness.linkEditor.content.split("\n"), [
    "## Pomodoros",
    "",
    "- [ ] Current (0900-0930)",
  ]);
  assert.match(
    notices.at(-1),
    /Cancelled task via Task Link · “superseded” · removed 1 Pomodoro link/,
  );
});

test("buildCancelNoticeModel text covers every chip", () => {
  const model = helpers.buildCancelNoticeModel({
    count: 3,
    viaLinks: true,
    date: "2026-09-30",
    reason: "Superseded by X",
    removedPomodoroLinkCount: 2,
    reopenedDependents: 1,
    recoveryRan: true,
    planChip: "plan 3/5 · 7/10",
    skippedClosedCount: 1,
  });
  assert.equal(model.level, "Cancelled");
  assert.equal(model.countPill, "3 tasks via Task Links");
  assert.equal(model.receipt, "[cancelled:: 2026-09-30]");
  assert.equal(model.reasonBody, "❌ Superseded by X");
  assert.equal(model.reasonMuted, false);
  assert.equal(
    model.text,
    "Cancelled 3 tasks via Task Links · “Superseded by X” · removed 2 Pomodoro links · unblocked 1 dependent · plan 3/5 · 7/10 · skipped 1 closed",
  );
  assert.deepEqual(
    model.chips.map((chip) => chip.tone),
    ["info", "ok", "info", "muted"],
  );

  const single = helpers.buildCancelNoticeModel({
    count: 1,
    date: "2026-09-30",
    pomodoroPruneFailed: true,
  });
  assert.equal(single.countPill, "");
  assert.equal(single.reasonBody, "No reason recorded");
  assert.equal(single.reasonMuted, true);
  assert.equal(
    single.text,
    "Cancelled task · Pomodoro links not removed",
  );

  const fallback = helpers.buildCancelNoticeModel({
    count: 1,
    date: "2026-09-30",
    fallbackUsed: true,
  });
  assert.equal(fallback.reasonBody, "🤷 no reason given · logged");
  assert.match(fallback.text, /🤷 no reason given · logged/);

  const silent = helpers.buildCancelNoticeModel({
    count: 2,
    date: "2026-09-30",
    reason: "x",
    reopenedDependents: 2,
    recoveryRan: false,
  });
  assert.doesNotMatch(silent.text, /unblocked/);
});

test("renderCancelNoticeFragment builds the is-cancel card", () => {
  const model = helpers.buildCancelNoticeModel({
    count: 2,
    viaLinks: true,
    date: "2026-09-30",
    reason: "obsolete",
    removedPomodoroLinkCount: 1,
  });
  const root = createFragmentNode("fragment");
  const card = helpers.renderCancelNoticeFragment(model, root);
  assert.ok(
    card.classes.includes("bob-nh-notice") && card.classes.includes("is-cancel"),
  );
  assert.equal(card.attrs["aria-label"], model.text);
  const reason = findFragmentNode(
    card,
    (node) =>
      node.classes && node.classes.includes("bob-nh-notice-reason-text"),
  );
  assert.ok(reason);
  assert.match(reason.text, /❌ obsolete/);
  const chips = collectFragmentNodes(
    card,
    (node) => node.classes && node.classes.includes("bob-nh-notice-chip"),
  );
  assert.equal(chips.length, 1);
  assert.match(chips[0].text, /removed 1 Pomodoro link/);
});
