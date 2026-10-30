const assert = require("node:assert/strict");
const test = require("node:test");
const { pressKey } = require("./modal-harness.cjs");
const {
  notices,
  NavigationHotkeysPlugin,
  helpers,
  createBulletPropertyPickerHarness,
  createPriorityPickerConfig,
  createLinkPickerHarness,
  vimTransactionEditor,
} = require("./navigation-hotkeys-harness.cjs");

const BASE_DATE = new Date(2026, 8, 30);
const fixedRandom = () => 0;

function createTaskHarness(content, options = {}) {
  return createBulletPropertyPickerHarness({
    content,
    cursor: options.cursor || { line: 0, ch: 0 },
    file: options.file || { path: "Tasks.md", basename: "Tasks", extension: "md" },
    config: options.config || createPriorityPickerConfig(),
    baseDate: BASE_DATE,
    random: fixedRandom,
  });
}

function rollOptions(harness, options = {}) {
  return {
    config: harness.config,
    baseDate: BASE_DATE,
    random: fixedRandom,
    ...options,
  };
}

function ctrlEnterEvent() {
  return {
    key: "Enter",
    code: "Enter",
    ctrlKey: true,
    preventDefault() {},
    stopPropagation() {},
  };
}

function quickRollEvent(options = {}) {
  return {
    key: "π",
    code: "KeyP",
    altKey: true,
    repeat: false,
    preventDefault() {},
    stopPropagation() {},
    ...options,
  };
}

function descendants(element) {
  return (element.children || []).flatMap((child) => [child, ...descendants(child)]);
}

function flattenText(element) {
  return [element.textContent, ...descendants(element).map((child) => child.textContent)]
    .filter(Boolean)
    .join(" ");
}

async function waitUntil(predicate, message) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(message || "asynchronous picker action did not settle");
}

async function runTaskAction(content, mode, options = {}) {
  notices.length = 0;
  const harness = createTaskHarness(content, options);
  const actionOptions = rollOptions(harness, options.session || {});
  if (mode === "quick") {
    harness.plugin.rollByRecommendation(harness.editor, actionOptions);
  } else {
    harness.open(actionOptions);
    const picker = harness.plugin.activeBulletPropertyPicker;
    assert.ok(picker, "Task Card opened");
    await waitUntil(() => picker.taskCardModel && picker.stage === "task-card");
    picker.handleTaskCardKeydown(ctrlEnterEvent());
  }
  await waitUntil(
    () => !harness.plugin.activeBulletPropertyPicker,
    `${mode} recommendation did not close its Task Card`,
  );
  return { content: harness.editor.getValue(), notices: notices.slice() };
}

function createLinkHarness(options = {}) {
  return createLinkPickerHarness({
    linkContent: options.linkContent || "- [[Tasks#^a1]]",
    notes: options.notes || {
      "Tasks.md": "- [ ] #task Linked [priority:: medium] [scheduled:: 2026-10-01] ^a1",
    },
    config: options.config || createPriorityPickerConfig(),
  });
}

async function runLinkAction(mode, options = {}) {
  notices.length = 0;
  const harness = createLinkHarness(options);
  const actionOptions = {
    config: harness.config,
    baseDate: BASE_DATE,
    random: fixedRandom,
    ...(options.session || {}),
  };
  if (mode === "quick") {
    harness.plugin.rollByRecommendation(harness.linkEditor, actionOptions);
  } else {
    harness.plugin.openBulletPropertyPicker(harness.linkEditor, actionOptions);
    await waitUntil(() => {
      const picker = harness.plugin.activeBulletPropertyPicker;
      return picker && picker.linkResolving !== true && picker.taskCardModel;
    }, "Task Link targets did not resolve");
    harness.plugin.activeBulletPropertyPicker.handleTaskCardKeydown(ctrlEnterEvent());
  }
  await waitUntil(
    () => !harness.plugin.activeBulletPropertyPicker,
    `${mode} Task Link recommendation did not close its Task Card`,
  );
  return { notes: harness.notes, notices: notices.slice() };
}

test("Alt+P matches Ctrl+Enter for roll, decay, project, and counted task writes", async () => {
  const scenarios = [
    {
      name: "roll",
      content:
        "- [ ] #task Roll [priority:: medium] [scheduled:: 2026-10-01] ^roll",
    },
    {
      name: "decay",
      content: [
        "- [ ] #task Decay [priority:: medium] [scheduled:: 2026-10-01] ^decay",
        "\t- 🗓️ **SCHEDULE LOG**",
        "\t\t- *2026-10-01* — 🎲 P2 roll · in **17** (8–30) days",
      ].join("\n"),
    },
    {
      name: "project-inline",
      content: [
        "---",
        "type: [[project]]",
        "scheduled: 2026-10-01",
        "---",
        "- [ ] #task Ship [priority:: medium] ^prj",
      ].join("\n"),
      cursor: { line: 4, ch: 0 },
    },
    {
      name: "counted batch",
      content: [
        "- [ ] #task First [priority:: medium] [scheduled:: 2026-10-01] ^first",
        "- [ ] #task Second [priority:: low] [scheduled:: 2026-10-02] ^second",
      ].join("\n"),
      session: { countExplicit: true, additionalTaskCount: 1 },
    },
  ];

  for (const scenario of scenarios) {
    const quick = await runTaskAction(scenario.content, "quick", scenario);
    const card = await runTaskAction(scenario.content, "card", scenario);
    assert.deepEqual(quick, card, scenario.name);
    assert.match(quick.content, /SCHEDULE LOG/);
  }
});

test("Task Card Ctrl+Enter and Alt+P roll preserve bracket and parenthesis theme fields", async () => {
  for (const field of ["[theme:: FIX]", "(theme:: FIX)"]) {
    const source = `- [ ] #task Roll ${field} [priority:: medium] [scheduled:: 2026-10-01] ^roll`;
    const card = await runTaskAction(source, "card");
    const quick = await runTaskAction(source, "quick");
    assert.ok(card.content.includes(field), `Task Card retains ${field}`);
    assert.ok(quick.content.includes(field), `Alt+P retains ${field}`);
  }
});

test("Alt+P matches Ctrl+Enter for a counted Task Link batch", async () => {
  const options = {
    linkContent: "- [[Tasks#^a1]]\n- [[Tasks#^b1]]",
    notes: {
      "Tasks.md": [
        "- [ ] #task First [priority:: medium] [scheduled:: 2026-10-01] ^a1",
        "- [ ] #task Second [priority:: low] [scheduled:: 2026-10-02] ^b1",
      ].join("\n"),
    },
    session: { countExplicit: true, additionalTaskCount: 1 },
  };
  const quick = await runLinkAction("quick", options);
  const card = await runLinkAction("card", options);
  assert.deepEqual(quick, card);
  assert.match(quick.notes["Tasks.md"], /SCHEDULE LOG/);
});

test("Task Link resolution keeps the outer modal hidden until its targets are ready", async () => {
  const harness = createLinkHarness();
  const originalResolve = harness.plugin.resolveLinkPickerTargets.bind(harness.plugin);
  let releaseResolution;
  harness.plugin.resolveLinkPickerTargets = async (...args) => {
    await new Promise((resolve) => { releaseResolution = resolve; });
    return originalResolve(...args);
  };
  harness.plugin.rollByRecommendation(
    harness.linkEditor,
    rollOptions(harness),
  );
  const picker = harness.plugin.activeBulletPropertyPicker;
  assert.ok(picker);
  assert.equal(picker.linkResolving, true);
  assert.ok(picker.containerEl.classes.includes("bob-task-card-quick-pending"));
  assert.ok(picker.containerEl.children.includes(picker.backdropEl));
  await waitUntil(() => typeof releaseResolution === "function");
  releaseResolution();
  await waitUntil(() => !harness.plugin.activeBulletPropertyPicker);
});

test("Alt+P hides immediate rolls and reveals the optional Next Work summary", async () => {
  notices.length = 0;
  const ready = createTaskHarness(
    "- [ ] #task Roll [priority:: medium] [scheduled:: 2026-10-01] ^roll",
  );
  let releaseWrite;
  ready.plugin.setBulletPropertyValue = () =>
    new Promise((resolve) => {
      releaseWrite = resolve;
    });
  ready.plugin.rollByRecommendation(ready.editor, rollOptions(ready));
  const pendingPicker = ready.plugin.activeBulletPropertyPicker;
  assert.ok(pendingPicker.containerEl.classes.includes("bob-task-card-quick-pending"));
  await waitUntil(() => typeof releaseWrite === "function");
  assert.ok(pendingPicker.containerEl.classes.includes("bob-task-card-quick-pending"));
  assert.ok(pendingPicker.containerEl.children.includes(pendingPicker.backdropEl));
  releaseWrite(true);
  await waitUntil(() => !ready.plugin.activeBulletPropertyPicker);

  const next = createTaskHarness(
    "- [*] #task Next [priority:: medium] [scheduled:: 2026-10-01] ^next",
  );
  let writes = 0;
  next.plugin.setBulletPropertyValue = async () => {
    writes += 1;
    return true;
  };
  next.plugin.rollByRecommendation(next.editor, rollOptions(next));
  const picker = next.plugin.activeBulletPropertyPicker;
  assert.ok(picker);
  await waitUntil(
    () =>
      picker.stage === "schedule-work-log" &&
      picker.taskCardDispatching === false &&
      picker.opening === false,
  );
  assert.equal(picker.containerEl.classes.includes("bob-task-card-quick-pending"), false);
  assert.equal(writes, 0);
  picker.handleKeydown(quickRollEvent());
  await waitUntil(() => !next.plugin.activeBulletPropertyPicker);
  assert.equal(writes, 1, "the second Alt+P submits the blank summary");
});

test("a cancel recommendation waits for the visible card and the second Alt+P cancels", async () => {
  notices.length = 0;
  const content = [
    "- [ ] #task Cancel [priority:: lowest] [scheduled:: 2026-10-01] ^cancel",
    "\t- 🗓️ **SCHEDULE LOG**",
    "\t\t- *2026-10-01* — 🎲 P4 roll · in **200** (91–365) days",
  ].join("\n");
  const harness = createTaskHarness(content);
  let writes = 0;
  harness.plugin.applyTaskCancelFromPicker = async () => {
    writes += 1;
    return true;
  };
  harness.plugin.rollByRecommendation(harness.editor, rollOptions(harness));
  const picker = harness.plugin.activeBulletPropertyPicker;
  assert.ok(picker);
  assert.equal(picker.taskCardModel.recommendation.effects.cancel, 1);
  assert.equal(picker.containerEl.classes.includes("bob-task-card-quick-pending"), false);
  assert.equal(writes, 0);
  assert.deepEqual(notices, [
    "Decayed past P4 — Alt+P again cancels it, Esc keeps it",
  ]);
  picker.handleTaskCardKeydown(quickRollEvent());
  await waitUntil(() => !harness.plugin.activeBulletPropertyPicker);
  assert.equal(writes, 1);

  const batchContent = [
    "- [ ] #task Roll [priority:: medium] [scheduled:: 2026-10-01] ^roll",
    "- [ ] #task Cancel [priority:: lowest] [scheduled:: 2026-10-01] ^cancel",
    "  - 🗓️ **SCHEDULE LOG**",
    "    - *2026-10-01* — 🎲 P4 roll · in **200** (91–365) days",
  ].join("\n");
  const batch = createTaskHarness(batchContent);
  let batchWrites = 0;
  batch.plugin.setBulletPropertyValue = async () => {
    batchWrites += 1;
    return true;
  };
  batch.plugin.setBulletPriorityValue = batch.plugin.setBulletPropertyValue;
  batch.plugin.applyTaskCancelFromPicker = async () => {
    batchWrites += 1;
    return true;
  };
  batch.plugin.rollByRecommendation(
    batch.editor,
    rollOptions(batch, { countExplicit: true, additionalTaskCount: 1 }),
  );
  const batchPicker = batch.plugin.activeBulletPropertyPicker;
  assert.ok(batchPicker);
  assert.equal(batchPicker.taskCardModel.recommendation.effects.cancel, 1);
  assert.equal(
    batchPicker.containerEl.classes.includes("bob-task-card-quick-pending"),
    false,
  );
  assert.equal(batchWrites, 0, "a cancel target holds the entire batch for confirmation");
  assert.equal(batch.editor.getValue(), batchContent);
  assert.match(notices.at(-1), /One task in this batch decayed past P4/);
  batchPicker.close();

  const escaped = createTaskHarness(content);
  let escapeWrites = 0;
  escaped.plugin.applyTaskCancelFromPicker = async () => {
    escapeWrites += 1;
    return true;
  };
  escaped.plugin.rollByRecommendation(escaped.editor, rollOptions(escaped));
  const escapedPicker = escaped.plugin.activeBulletPropertyPicker;
  pressKey(escapedPicker, "Escape");
  assert.equal(escapeWrites, 0);
  assert.equal(escaped.plugin.activeBulletPropertyPicker, null);
});

test("Alt+P assigns P1 on a task with no priority", async () => {
  notices.length = 0;
  const harness = createTaskHarness(
    "- [ ] #task No priority [scheduled:: 2026-10-01] ^none",
  );
  harness.plugin.rollByRecommendation(harness.editor, rollOptions(harness));
  await waitUntil(() => !harness.plugin.activeBulletPropertyPicker);
  const written = harness.editor.getValue();
  assert.match(written, /\[priority:: high\]/);
  assert.match(written, /\[scheduled:: 2026-10-0[2-7]\]/);
  assert.match(written, /🎲 P0 → P1 · in \*\*[2-7]\*\* \(2–7\) days/);
  assert.match(written, /SCHEDULE LOG/);
  assert.ok(
    notices.some((message) => message.includes("priority → P1 (high)")),
    `expected plain priority notice, got ${JSON.stringify(notices)}`,
  );
  assert.ok(
    !notices.includes("No priority to roll — pick a level (1–4)"),
    "assign must not show the no-priority notice",
  );
});

test("Alt+P assign matches Ctrl+Enter on the visible card", async () => {
  const content = "- [ ] #task No priority [scheduled:: 2026-10-01] ^none";
  const quick = await runTaskAction(content, "quick");
  const card = await runTaskAction(content, "card");
  assert.deepEqual(quick, card);
  assert.match(quick.content, /\[priority:: high\]/);
  assert.match(quick.content, /🎲 P0 → P1/);
});

test("Alt+P assign routes through inbox and Next work summary", async () => {
  // Assign reuses the same Work summary machinery as roll/decay: the
  // dedicated Next/Pending summary flow is pinned by the existing
  // "Alt+P hides immediate rolls" test. Here we prove the assign write
  // itself plus inbox routing.
  const next = createTaskHarness(
    "- [ ] #task Next no priority [scheduled:: 2026-10-01] ^next",
  );
  next.plugin.rollByRecommendation(next.editor, rollOptions(next));
  await waitUntil(() => !next.plugin.activeBulletPropertyPicker);
  assert.match(next.editor.getValue(), /\[priority:: high\]/);
  assert.match(next.editor.getValue(), /🎲 P0 → P1/);

  notices.length = 0;
  const inbox = createTaskHarness(
    "- [ ] #task Inbox no priority [scheduled:: 2026-10-01] ^inbox",
    { file: { path: "inbox.md", basename: "inbox", extension: "md" } },
  );
  const order = [];
  inbox.plugin.computeInboxRouteContext = () => ({ sourcePath: "inbox.md" });
  inbox.plugin.promptInboxRoute = async ({ suspend }) => {
    order.push("route");
    suspend.hide();
    suspend.restore();
    return { kind: "stay" };
  };
  const originalWrite = inbox.plugin.setBulletPriorityValue.bind(inbox.plugin);
  inbox.plugin.setBulletPriorityValue = async (...args) => {
    order.push("write");
    return await originalWrite(...args);
  };
  inbox.plugin.rollByRecommendation(inbox.editor, rollOptions(inbox));
  await waitUntil(() => !inbox.plugin.activeBulletPropertyPicker);
  assert.deepEqual(order, ["route", "write"]);
  assert.match(inbox.editor.getValue(), /\[priority:: high\]/);
});

test("Alt+P on an unusable P1 level reveals the card without writing", () => {
  notices.length = 0;
  const good = createPriorityPickerConfig();
  const goodPriority = good.properties.find((item) => item.name === "priority");
  const badConfig = {
    properties: [
      { name: "scheduled", values: "date" },
      {
        name: goodPriority.name,
        values: "priority",
        schedules: goodPriority.schedules,
        levels: [{ label: "P1", value: "high" }],
        levelsByValue: new Map([["high", { label: "P1", value: "high" }]]),
        decay: goodPriority.decay,
      },
    ],
  };
  const harness = createTaskHarness(
    "- [ ] #task No priority [scheduled:: 2026-10-01] ^none",
    { config: badConfig },
  );
  let writes = 0;
  harness.plugin.setBulletPriorityValue = async () => {
    writes += 1;
    return true;
  };
  harness.plugin.rollByRecommendation(harness.editor, rollOptions(harness, { config: badConfig }));
  const picker = harness.plugin.activeBulletPropertyPicker;
  assert.ok(picker);
  assert.equal(picker.containerEl.classes.includes("bob-task-card-quick-pending"), false);
  assert.equal(writes, 0);
  assert.ok(notices.includes("No priority to roll — pick a level (1–4)"));
  picker.close();
});

test("unavailable recurring tasks reveal the card without writing", () => {
  notices.length = 0;
  const recurring = createTaskHarness([
    "- [ ] #task Recurring [priority:: lowest] [scheduled:: 2026-10-01] 🔁 ^recurring",
    "\t- 🗓️ **SCHEDULE LOG**",
    "\t\t- *2026-10-01* — 🎲 P4 roll · in **200** (91–365) days",
  ].join("\n"));
  recurring.plugin.rollByRecommendation(
    recurring.editor,
    rollOptions(recurring),
  );
  const recurringPicker = recurring.plugin.activeBulletPropertyPicker;
  assert.ok(recurringPicker);
  assert.equal(recurringPicker.taskCardModel.recommendation.available, false);
  assert.equal(
    recurringPicker.containerEl.classes.includes("bob-task-card-quick-pending"),
    false,
  );
  assert.ok(notices.length > 0);
  recurringPicker.close();
});

test("a landed review row advances once after Alt+P assigns P1", async () => {
  const harness = createTaskHarness(
    "- [ ] #task Landed no priority [scheduled:: 2026-10-01] ^landed",
  );
  const advances = [];
  harness.plugin.captureReviewGesture = () => ({ landing: true });
  harness.plugin.continueReviewWalkAfter = (origin, outcome) => {
    advances.push({ origin, outcome });
  };
  harness.plugin.rollByRecommendation(harness.editor, rollOptions(harness));
  await waitUntil(() => !harness.plugin.activeBulletPropertyPicker);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(advances.length, 1);
  assert.equal(advances[0].origin.landing, true);
  assert.equal(advances[0].outcome.kind, "card");
  assert.match(harness.editor.getValue(), /\[priority:: high\]/);
});

test("inbox routing is shown before the write and a managed line redirects to its owner", async () => {
  const inbox = createTaskHarness(
    "- [ ] #task Inbox [priority:: medium] [scheduled:: 2026-10-01] ^inbox",
    { file: { path: "inbox.md", basename: "inbox", extension: "md" } },
  );
  const order = [];
  inbox.plugin.computeInboxRouteContext = () => ({ sourcePath: "inbox.md" });
  inbox.plugin.promptInboxRoute = async ({ suspend }) => {
    order.push("route");
    suspend.hide();
    suspend.restore();
    return { kind: "stay" };
  };
  inbox.plugin.setBulletPropertyValue = async () => {
    order.push("write");
    return true;
  };
  inbox.plugin.setBulletPriorityValue = inbox.plugin.setBulletPropertyValue;
  inbox.plugin.rollByRecommendation(inbox.editor, rollOptions(inbox));
  await waitUntil(() => !inbox.plugin.activeBulletPropertyPicker);
  assert.deepEqual(order, ["route", "write"]);

  const backedOut = createTaskHarness(
    "- [ ] #task Inbox [priority:: medium] [scheduled:: 2026-10-01] ^inbox",
    { file: { path: "inbox.md", basename: "inbox", extension: "md" } },
  );
  let prompted = false;
  let backedOutWrites = 0;
  backedOut.plugin.computeInboxRouteContext = () => ({ sourcePath: "inbox.md" });
  backedOut.plugin.promptInboxRoute = async ({ suspend }) => {
    prompted = true;
    suspend.hide();
    suspend.restore();
    return { kind: "cancel" };
  };
  backedOut.plugin.setBulletPropertyValue = async () => {
    backedOutWrites += 1;
    return true;
  };
  backedOut.plugin.setBulletPriorityValue = backedOut.plugin.setBulletPropertyValue;
  backedOut.plugin.rollByRecommendation(
    backedOut.editor,
    rollOptions(backedOut),
  );
  const backedOutPicker = backedOut.plugin.activeBulletPropertyPicker;
  assert.ok(backedOutPicker);
  await waitUntil(
    () => prompted && backedOutPicker.inboxRouteCommitInFlight === false,
  );
  assert.equal(backedOutWrites, 0);
  assert.equal(backedOutPicker.pickerOpen, true);
  assert.equal(
    backedOutPicker.containerEl.classes.includes("bob-task-card-quick-pending"),
    false,
  );
  assert.equal(
    backedOutPicker.modalEl.classes.includes("bob-task-card-suspended"),
    false,
  );
  backedOutPicker.close();

  const managedContent = [
    "- [ ] #task Owner [priority:: lowest] [scheduled:: 2026-10-01] ^owner",
    "  - ⛓️ **DEPENDS ON:** [[#^other]]",
    "  - 🗓️ **SCHEDULE LOG**",
    "    - *2026-10-01* — 🎲 P4 roll · in **200** (91–365) days",
    "- [ ] #task Other ^other",
  ].join("\n");
  const managed = createTaskHarness(managedContent, { cursor: { line: 1, ch: 0 } });
  managed.plugin.rollByRecommendation(managed.editor, rollOptions(managed));
  const picker = managed.plugin.activeBulletPropertyPicker;
  assert.ok(picker);
  assert.equal(picker.cursor.line, 0);
  assert.equal(picker.taskCardModel.recommendation.effects.cancel, 1);
  assert.equal(managed.editor.getValue(), managedContent);
  picker.close();
});

test("a landed review row advances once after Alt+P writes", async () => {
  const harness = createTaskHarness(
    "- [ ] #task Landed [priority:: medium] [scheduled:: 2026-10-01] ^landed",
  );
  const advances = [];
  harness.plugin.captureReviewGesture = () => ({ landing: true });
  harness.plugin.continueReviewWalkAfter = (origin, outcome) => {
    advances.push({ origin, outcome });
  };
  harness.plugin.rollByRecommendation(harness.editor, rollOptions(harness));
  await waitUntil(() => !harness.plugin.activeBulletPropertyPicker);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(advances.length, 1);
  assert.equal(advances[0].origin.landing, true);
  assert.equal(advances[0].outcome.kind, "card");
});

test("the card alias uses the physical Alt+P code and ignores repeats", () => {
  const harness = createTaskHarness(
    "- [ ] #task Key [priority:: medium] [scheduled:: 2026-10-01] ^key",
  );
  harness.open(rollOptions(harness));
  const picker = harness.plugin.activeBulletPropertyPicker;
  const intent = helpers.resolveTaskCardKey(
    picker.taskCardModel,
    quickRollEvent(),
  );
  assert.equal(intent.type, "apply-recommendation");
  const repeated = helpers.resolveTaskCardKey(
    picker.taskCardModel,
    quickRollEvent({ repeat: true }),
  );
  assert.deepEqual(repeated, {
    type: "ignored",
    reason: "repeated-action-key",
  });
  assert.match(flattenText(picker.contentEl), /Alt\+P/);
  const alias = descendants(picker.contentEl)
    .find((child) => child.classes.includes("is-alias"));
  assert.ok(alias);
  assert.equal(alias.textContent, "Alt+P");
  picker.close();
});

test("a throwing one-shot dispatch always reveals the still-open card", async () => {
  const harness = createTaskHarness(
    "- [ ] #task Throws [priority:: medium] [scheduled:: 2026-10-01] ^throws",
  );
  const prototype = helpers.BulletPropertyPickerModal.prototype;
  const original = prototype.dispatchTaskCardIntent;
  prototype.dispatchTaskCardIntent = () => {
    throw new Error("test write failure");
  };
  try {
    harness.plugin.rollByRecommendation(harness.editor, rollOptions(harness));
    const picker = harness.plugin.activeBulletPropertyPicker;
    await waitUntil(
      () => !picker.containerEl.classes.includes("bob-task-card-quick-pending"),
      "quick card remained hidden after a dispatch exception",
    );
    assert.equal(picker.pickerOpen, true);
  } finally {
    prototype.dispatchTaskCardIntent = original;
    harness.plugin.activeBulletPropertyPicker?.close();
  }
});

test("the registered command owns Alt+P and a Vim count is consumed once", () => {
  const plugin = new NavigationHotkeysPlugin();
  const commands = [];
  plugin.app = {
    workspace: {
      getActiveFile: () => null,
      on: () => ({}),
      onLayoutReady: () => {},
    },
  };
  plugin.addCommand = (command) => commands.push(command);
  plugin.register = () => {};
  plugin.registerEvent = () => {};
  plugin.registerVimMappingsWhenReady = () => {};
  plugin.registerOpenTaskJumpInputListeners = () => {};
  plugin.registerCountedTransclusionToggleInputListeners = () => {};
  plugin.registerCountedBulletPropertyInputListeners = () => {};
  plugin.registerCountedTaskMoveInputListeners = () => {};
  plugin.registerClearSearchHighlightInputListeners = () => {};
  plugin.onload();
  const command = commands.find((item) => item.id === "roll-by-recommendation");
  assert.ok(command);
  assert.deepEqual(command.hotkeys, [{ modifiers: ["Alt"], key: "P" }]);

  const editor = vimTransactionEditor(
    "- [ ] #task Counted [priority:: medium] [scheduled:: 2026-10-01] ^count",
    { line: 0, ch: 0 },
    { inputState: { keyBuffer: ["3"], repeat: 3, getRepeat: () => 3 } },
  );
  const view = { editor };
  plugin.getActiveMarkdownView = () => view;
  const routed = [];
  plugin.openBulletPropertyPicker = (receivedEditor, options) => {
    routed.push({ receivedEditor, options });
    return true;
  };
  plugin.activeBulletPropertyPicker = {
    pickerOpen: true,
    containerEl: { isConnected: false },
  };
  command.editorCallback(editor);
  assert.equal(editor.vimInputState.keyBuffer.length, 0);
  assert.equal(editor.vimInputState.reason, "quick-roll-recommendation");
  assert.equal(routed.length, 1);
  assert.equal(routed[0].options.countExplicit, true);
  assert.equal(routed[0].options.additionalTaskCount, 3);
  assert.equal(
    routed[0].options.initialTaskCardIntent,
    "apply-recommendation",
  );

  routed.length = 0;
  plugin.activeBulletPropertyPicker = { pickerOpen: false };
  command.editorCallback(editor);
  assert.equal(routed.length, 1, "an unopened stale picker is discarded");
  routed.length = 0;
  plugin.activeBulletPropertyPicker = {
    pickerOpen: true,
    containerEl: { isConnected: true },
  };
  command.editorCallback(editor);
  assert.equal(routed.length, 0, "a live picker consumes the command alias exactly once");
});

test("quick-roll visibility CSS disables the modal entrance animation", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const css = fs.readFileSync(
    path.join(__dirname, "../plugins/bob-navigation-hotkeys/styles.css"),
    "utf8",
  );
  assert.match(css, /bob-task-card-quick-pending[\s\S]*?visibility:\s*hidden/);
  assert.match(css, /bob-task-card-quick-pending[\s\S]*?animation:\s*none/);
  assert.match(css, /\.bob-key-card-key\.is-alias[\s\S]*?opacity:/);
});
