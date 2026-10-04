// Combined scheduling reason + Work Log review (bob-cli-42.6).
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");
const { ElementStub, ModalStub, defer, pressKey: harnessPressKey } = require("./modal-harness.cjs");

global.window = { setTimeout: defer };

const openedModals = [];
const originalLoad = Module._load;
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

Module._load = function loadWithModalHarness(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: class {},
      Modal: class extends ModalStub {
        constructor(app) {
          super(app);
          openedModals.push(this);
        }
      },
      Notice: class {
        constructor(message) {
          this.message = String(message);
        }
      },
      Plugin: class {},
      parseYaml: parseTestYaml,
    };
  }
  if (request === "@codemirror/state") {
    return { Prec: { highest: (value) => value } };
  }
  if (request === "@codemirror/view") {
    return { EditorView: class {} };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const NavigationHotkeysPlugin = require("../plugins/bob-navigation-hotkeys/main.js");
const { helpers } = NavigationHotkeysPlugin;
Module._load = originalLoad;

const {
  BulletPropertyPickerModal,
  validateBulletPropertyConfig,
  formatBulletPropertyDate,
  schedulingWorkLogTargetIdentity,
  collectSchedulingWorkLogEligibleIdentities,
  schedulingWorkLogSnapshotChanged,
  planScheduleReview,
  getProjectNotePropertyContext,
} = helpers;

const BASE_DATE = new Date(2026, 9, 3);

function sequence(values) {
  let index = 0;
  return () => values[index++ % values.length];
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

function flattenText(element) {
  return [element.textContent, ...element.children.map(flattenText)]
    .filter(Boolean)
    .join(" ");
}

function descendants(element) {
  return element.children.flatMap((child) => [child, ...descendants(child)]);
}

function byClass(element, className) {
  return descendants(element).filter(
    (item) => item.classes && item.classes.includes(className),
  );
}

function buildConfig() {
  const config = validateBulletPropertyConfig({
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
  assert.ok(config);
  return config;
}

function freshnessApi() {
  return {
    setRefreshLine() {},
    config() {
      return { interval: 7 };
    },
  };
}

function makeEditor(content) {
  const lines = () => String(content || "").split(/\n/);
  return {
    getValue: () => content,
    getLine: (line) => {
      const all = lines();
      return line >= 0 && line < all.length ? all[line] : null;
    },
    setValue(next) {
      content = String(next);
    },
    replaceRange() {},
    transaction(transaction) {
      const changes = [...(transaction.changes || [])].sort(
        (left, right) =>
          right.from.line - left.from.line || right.from.ch - left.from.ch,
      );
      let nextLines = lines();
      for (const change of changes) {
        const fromLine = change.from.line;
        const toLine = (change.to || change.from).line;
        const fromCh = change.from.ch;
        const toCh = (change.to || change.from).ch;
        const start = nextLines[fromLine].slice(0, fromCh);
        const end = nextLines[toLine].slice(toCh);
        const inserted = String(change.text || "").split(/\n/);
        nextLines = [
          ...nextLines.slice(0, fromLine),
          start + inserted[0],
          ...inserted.slice(1, -1),
          inserted.length > 1
            ? inserted[inserted.length - 1] + end
            : start + inserted[0] + end,
          ...nextLines.slice(toLine + 1),
        ];
      }
      content = nextLines.join("\n");
    },
  };
}

function dispatchCardKey(modal, key, modifiers = {}) {
  harnessPressKey(modal, key, modifiers);
}

function typeQuery(modal, text) {
  modal.inputEl.value = text;
  if (modal.inputEl.listeners.input) {
    modal.inputEl.listeners.input();
  }
}

function pressKey(element, key, modifiers = {}) {
  const event = {
    key,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    target: element,
    ...modifiers,
    preventDefault() {},
    stopPropagation() {},
  };
  if (element.listeners && element.listeners.keydown) {
    element.listeners.keydown(event);
  }
  return event;
}

function openPropertyPicker(options = {}) {
  openedModals.length = 0;
  const content =
    options.content ||
    "- [ ] #task Write the onboarding guide [priority:: medium] [scheduled:: 2026-10-06] ^guide";
  const editor = options.editor || makeEditor(content);
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = options.app || {};
  plugin.getFreshnessApi = () =>
    Object.prototype.hasOwnProperty.call(options, "freshnessApi")
      ? options.freshnessApi
      : freshnessApi();
  const modal = new BulletPropertyPickerModal(
    plugin.app,
    plugin,
    editor,
    { line: options.cursorLine || 0, ch: 0 },
    content.split(/\n/)[options.cursorLine || 0],
    options.config || buildConfig(),
    {
      filePath: options.filePath || "Areas/Work_ship.md",
      propertyContext: { isObsidianTask: true },
      baseDate: options.baseDate || BASE_DATE,
      random: sequence([0.1, 0.35, 0.6, 0.8, 0.95, 0.2, 0.45, 0.7]),
      taskSession: options.taskSession || null,
      linkSession: options.linkSession || null,
      ...options.context,
    },
  );
  modal.open();
  return { modal, editor, plugin, content };
}

function openScheduleStage(options = {}) {
  const opened = openPropertyPicker(options);
  dispatchCardKey(opened.modal, "Enter");
  assert.equal(opened.modal.stage, "value");
  assert.equal(opened.modal.selectedPropertyItem.property.name, "scheduled");
  return opened;
}

async function chooseDate(modal, query = "3") {
  typeQuery(modal, query);
  pressKey(modal.inputEl, "Enter");
  await nextTurn();
  return modal;
}

async function confirmReview(modal, { reason, summary } = {}) {
  if (reason !== undefined && modal.scheduleReviewReasonEl) {
    modal.scheduleReviewReasonEl.value = reason;
    if (modal.scheduleReviewReasonEl.listeners.input) {
      modal.scheduleReviewReasonEl.listeners.input();
    }
  }
  if (summary !== undefined && modal.scheduleReviewSummaryEl) {
    modal.scheduleReviewSummaryEl.value = summary;
    if (modal.scheduleReviewSummaryEl.listeners.input) {
      modal.scheduleReviewSummaryEl.listeners.input();
    }
  }
  modal.visibleItems = modal.getFilteredItems();
  return await modal.confirmScheduleReview();
}

test("identity keys distinguish linked notes that share a line number", () => {
  const alpha = {
    path: "Tasks/Alpha.md",
    line: 0,
    rawLine: "- [/] #task Alpha ^alpha",
  };
  const beta = {
    path: "Tasks/Beta.md",
    line: 0,
    rawLine: "- [*] #task Beta ^beta",
  };
  const duplicateAlpha = {
    path: "Tasks/Alpha.md",
    line: 0,
    rawLine: "- [/] #task Alpha ^alpha",
  };
  assert.equal(
    schedulingWorkLogTargetIdentity(alpha),
    "Tasks/Alpha.md#^alpha",
  );
  assert.notEqual(
    schedulingWorkLogTargetIdentity(alpha),
    schedulingWorkLogTargetIdentity(beta),
  );
  const eligible = collectSchedulingWorkLogEligibleIdentities([
    alpha,
    beta,
    duplicateAlpha,
    { path: "Tasks/Ready.md", line: 0, rawLine: "- [ ] #task Ready ^ready" },
  ]);
  assert.equal(eligible.size, 2);
  assert.equal(
    schedulingWorkLogSnapshotChanged([alpha, beta], [alpha, beta]),
    false,
  );
  assert.equal(
    schedulingWorkLogSnapshotChanged(
      [alpha],
      [{ ...alpha, rawLine: "- [/] #task Changed ^alpha" }],
    ),
    true,
  );
});

test("planScheduleReview opens for a bare date and skips when reason is known without Work Log", () => {
  const ready = [{ line: 0, path: "Note.md", rawLine: "- [ ] #task Ready ^a" }];
  const pending = [
    { line: 0, path: "Note.md", rawLine: "- [/] #task Pending ^a" },
  ];
  const bare = planScheduleReview({
    dateItem: { value: "2026-10-06" },
    to: "2026-10-06",
    reason: "",
    reasonSupplied: false,
    targets: ready,
    baseDate: BASE_DATE,
  });
  assert.equal(bare.needsReview, true);
  assert.equal(bare.needsReason, true);
  assert.equal(bare.needsWorkLog, false);
  assert.equal(bare.focusField, "reason");

  const inlineReady = planScheduleReview({
    dateItem: { value: "2026-10-06" },
    to: "2026-10-06",
    reason: "waiting on API",
    reasonSupplied: true,
    targets: ready,
    baseDate: BASE_DATE,
  });
  assert.equal(inlineReady.needsReview, false);

  const inlinePending = planScheduleReview({
    dateItem: { value: "2026-10-06" },
    to: "2026-10-06",
    reason: "waiting on API",
    reasonSupplied: true,
    targets: pending,
    baseDate: BASE_DATE,
  });
  assert.equal(inlinePending.needsReview, true);
  assert.equal(inlinePending.needsWorkLog, true);
  assert.equal(inlinePending.focusField, "summary");
  assert.match(inlinePending.effects.join(" "), /Work Log/);
});

test("planScheduleReview counts unique tasks when Task Links repeat a target", () => {
  const duplicate = [
    { line: 0, path: "Note.md", rawLine: "- [/] #task Pending ^a" },
    { line: 4, path: "Note.md", rawLine: "- [/] #task Pending ^a" },
  ];
  const plan = planScheduleReview({
    dateItem: { value: "2026-10-06" },
    to: "2026-10-06",
    reason: "",
    reasonSupplied: false,
    targets: duplicate,
    baseDate: BASE_DATE,
  });
  assert.equal(plan.totalCount, 1);
  assert.equal(plan.eligibleCount, 1);
  assert.equal(plan.isBatch, false);
  assert.equal(plan.title, "Schedule task");

  const distinct = planScheduleReview({
    dateItem: { value: "2026-10-06" },
    to: "2026-10-06",
    reason: "",
    reasonSupplied: false,
    targets: [...duplicate, { line: 6, path: "Note.md", rawLine: "- [ ] #task Ready ^b" }],
    baseDate: BASE_DATE,
  });
  assert.equal(distinct.totalCount, 2);
  assert.equal(distinct.title, "Schedule 2 tasks");
});

test("bare date on Ready opens a reason-only review and writes nothing until Enter", async () => {
  const captured = [];
  const { modal, plugin } = openScheduleStage({
    content: "- [ ] #task Ready work ^ready",
  });
  plugin.setBulletPropertyValue = async (_editor, _cursor, name, value, options) => {
    captured.push({ value, scheduleLog: options.scheduleLog, work: options.schedulingWorkLog });
    return true;
  };
  await chooseDate(modal, "3");
  assert.equal(modal.stage, "schedule-review");
  assert.equal(modal.isOpen, true);
  assert.equal(captured.length, 0);
  assert.ok(modal.scheduleReviewReasonEl);
  assert.equal(modal.scheduleReviewSummaryEl, null);
  assert.match(flattenText(modal.searchEl), /Reason for this date/);
  assert.doesNotMatch(flattenText(modal.searchEl), /Work summary/);
  assert.match(modal.getScheduleReviewSubtitle(), /nothing written yet/);
  await confirmReview(modal, { reason: "" });
  await nextTurn();
  assert.equal(captured.length, 1);
  assert.equal(captured[0].value, "2026-10-06");
  assert.equal(captured[0].scheduleLog.reason, "");
  assert.equal(captured[0].work, null);
});

test("typed reason and blank reason on an existing Schedule Log keep per-target rules", async () => {
  const captured = [];
  const { modal, plugin } = openScheduleStage({
    content: [
      "- [/] #task Pending work ^pending",
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-10-01* — old",
    ].join("\n"),
  });
  plugin.setBulletPropertyValue = async (_editor, _cursor, name, value, options) => {
    captured.push({
      value,
      reason: options.scheduleLog && options.scheduleLog.reason,
      fallback: options.scheduleLog && options.scheduleLog.fallbackReason,
      summary: options.schedulingWorkLog && options.schedulingWorkLog.summary,
    });
    return true;
  };
  await chooseDate(modal, "3");
  assert.equal(modal.stage, "schedule-review");
  assert.ok(modal.scheduleReviewSummaryEl);
  await confirmReview(modal, { reason: "waiting on API", summary: "Did the thing" });
  await nextTurn();
  assert.equal(captured.length, 1);
  assert.equal(captured[0].reason, "waiting on API");
  assert.equal(captured[0].summary, "Did the thing");

  captured.length = 0;
  const second = openScheduleStage({
    content: [
      "- [/] #task Pending work ^pending",
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-10-01* — old",
    ].join("\n"),
  });
  second.plugin.setBulletPropertyValue = async (_editor, _cursor, name, value, options) => {
    captured.push({
      reason: options.scheduleLog && options.scheduleLog.reason,
      fallback: options.scheduleLog && options.scheduleLog.fallbackReason,
      summary: options.schedulingWorkLog && options.schedulingWorkLog.summary,
    });
    return true;
  };
  await chooseDate(second.modal, "3");
  await confirmReview(second.modal, { reason: "", summary: "" });
  await nextTurn();
  assert.equal(captured.length, 1);
  assert.equal(captured[0].reason, "");
  assert.equal(captured[0].fallback, "🤷 no reason given");
  assert.equal(captured[0].summary, null);
});

test("Ready vs Next vs Pending: only Next/Pending show Work summary", async () => {
  for (const [status, expectSummary] of [
    [" ", false],
    ["*", true],
    ["/", true],
    ["?", false],
  ]) {
    const { modal, plugin } = openScheduleStage({
      content: `- [${status}] #task Target ^t`,
    });
    plugin.setBulletPropertyValue = async () => true;
    await chooseDate(modal, "3");
    assert.equal(modal.stage, "schedule-review", status);
    assert.equal(Boolean(modal.scheduleReviewSummaryEl), expectSummary, status);
  }
});

test("inline reason on Ready dispatches immediately; on Next it still reviews Work summary", async () => {
  const readyCaptured = [];
  const ready = openScheduleStage({
    content: "- [ ] #task Ready work ^ready",
  });
  ready.plugin.setBulletPropertyValue = async (_e, _c, _n, value, options) => {
    readyCaptured.push({ value, reason: options.scheduleLog.reason });
    return true;
  };
  typeQuery(ready.modal, "3 waiting on API");
  pressKey(ready.modal.inputEl, "Enter");
  await nextTurn();
  assert.equal(readyCaptured.length, 1);
  assert.equal(readyCaptured[0].reason, "waiting on API");
  assert.equal(ready.modal.isOpen, false);

  const nextCaptured = [];
  const next = openScheduleStage({
    content: "- [*] #task Next work ^next",
  });
  next.plugin.setBulletPropertyValue = async (_e, _c, _n, value, options) => {
    nextCaptured.push({
      reason: options.scheduleLog.reason,
      summary: options.schedulingWorkLog && options.schedulingWorkLog.summary,
    });
    return true;
  };
  typeQuery(next.modal, "3 waiting on API");
  pressKey(next.modal.inputEl, "Enter");
  await nextTurn();
  assert.equal(next.modal.stage, "schedule-review");
  assert.equal(next.modal.scheduleReviewReasonEl.value, "waiting on API");
  assert.ok(next.modal.scheduleReviewSummaryEl);
  assert.equal(next.modal.scheduleReviewSummaryEl.focused, true);
  await confirmReview(next.modal, { summary: "" });
  await nextTurn();
  assert.equal(nextCaptured.length, 1);
  assert.equal(nextCaptured[0].reason, "waiting on API");
  assert.equal(nextCaptured[0].summary, null);
});

test("Tab moves from Reason to Work summary and Enter commits from either field", async () => {
  const captured = [];
  const { modal, plugin } = openScheduleStage({
    content: "- [/] #task Pending work ^pending",
  });
  plugin.setBulletPropertyValue = async (_e, _c, _n, value, options) => {
    captured.push({
      reason: options.scheduleLog.reason,
      summary: options.schedulingWorkLog && options.schedulingWorkLog.summary,
    });
    return true;
  };
  await chooseDate(modal, "3");
  assert.equal(modal.scheduleReviewReasonEl.focused, true);
  pressKey(modal.scheduleReviewReasonEl, "Tab");
  assert.equal(modal.scheduleReviewSummaryEl.focused, true);
  modal.scheduleReviewReasonEl.value = "replan";
  modal.scheduleReviewSummaryEl.value = "Wrapped the API";
  pressKey(modal.scheduleReviewSummaryEl, "Enter");
  await nextTurn();
  assert.equal(captured.length, 1);
  assert.equal(captured[0].reason, "replan");
  assert.equal(captured[0].summary, "Wrapped the API");
});

test("Back and Escape at both review fields write nothing", async () => {
  const captured = [];
  const first = openScheduleStage({
    content: "- [/] #task Pending work ^pending",
  });
  first.plugin.setBulletPropertyValue = async () => {
    captured.push("wrote");
    return true;
  };
  await chooseDate(first.modal, "3");
  first.modal.scheduleReviewReasonEl.value = "typed";
  pressKey(first.modal.scheduleReviewReasonEl, "Backspace");
  assert.equal(first.modal.stage, "schedule-review");
  const back = byClass(first.modal.contentEl, "bob-task-card-back")[0];
  assert.ok(back);
  back.listeners.click({ preventDefault() {} });
  assert.equal(first.modal.stage, "task-card");
  assert.equal(captured.length, 0);

  const second = openScheduleStage({
    content: "- [/] #task Pending work ^pending",
  });
  second.plugin.setBulletPropertyValue = async () => {
    captured.push("wrote");
    return true;
  };
  await chooseDate(second.modal, "3");
  pressKey(second.modal.scheduleReviewSummaryEl, "Escape");
  second.modal.dispatchKey({ key: "Escape" });
  assert.equal(second.modal.isOpen, false);
  assert.equal(captured.length, 0);
});

test("a target changed during review refuses with no write", async () => {
  const captured = [];
  const { modal, plugin, editor } = openScheduleStage({
    content: "- [/] #task Pending work ^pending",
  });
  plugin.setBulletPropertyValue = async () => {
    captured.push("wrote");
    return true;
  };
  await chooseDate(modal, "3");
  editor.setValue("- [/] #task Changed ^pending");
  const applied = await confirmReview(modal, { reason: "late", summary: "too late" });
  assert.equal(applied, false);
  assert.equal(captured.length, 0);
  assert.equal(modal.stage, "task-card");
});

test("counted mixed targets share one review and one adapter call", async () => {
  const captured = [];
  const content = [
    "- [/] #task Pending one ^a",
    "- [*] #task Next two ^b",
    "- [ ] #task Ready three ^c",
    "- [?] #task Blocked four ^d",
  ].join("\n");
  const { modal, plugin } = openScheduleStage({
    content,
    taskSession: {
      explicit: true,
      targets: [
        { line: 0, rawLine: "- [/] #task Pending one ^a" },
        { line: 1, rawLine: "- [*] #task Next two ^b" },
        { line: 2, rawLine: "- [ ] #task Ready three ^c" },
        { line: 3, rawLine: "- [?] #task Blocked four ^d" },
      ],
    },
  });
  plugin.setCountedBulletPropertyValue = async (
    _editor,
    _cursor,
    _path,
    _session,
    name,
    value,
    options,
  ) => {
    captured.push({
      name,
      value,
      reason: options.scheduleLog && options.scheduleLog.reason,
      summary: options.schedulingWorkLog && options.schedulingWorkLog.summary,
    });
    return true;
  };
  await chooseDate(modal, "3");
  assert.equal(modal.stage, "schedule-review");
  assert.match(modal.getScheduleReviewSubtitle(), /2 of 4/);
  await confirmReview(modal, { reason: "batch", summary: "Shared work" });
  await nextTurn();
  assert.equal(captured.length, 1);
  assert.equal(captured[0].value, "2026-10-06");
  assert.equal(captured[0].reason, "batch");
  assert.equal(captured[0].summary, "Shared work");
});

test("linked notes with equal line numbers both qualify", async () => {
  const { modal, plugin } = openScheduleStage({
    content: "- [[Tasks/Alpha#^alpha]]",
    filePath: "2026/20261003.md",
    linkSession: {
      kind: "task-link",
      requestedCount: 2,
      targets: [{ line: 0 }, { line: 0 }],
      resolved: [
        {
          path: "Tasks/Alpha.md",
          line: 0,
          rawLine: "- [/] #task Alpha ^alpha",
        },
        {
          path: "Tasks/Beta.md",
          line: 0,
          rawLine: "- [*] #task Beta ^beta",
        },
      ],
    },
  });
  plugin.applyLinkPickerPropertyValue = async () => true;
  await chooseDate(modal, "3");
  assert.equal(modal.stage, "schedule-review");
  assert.equal(modal.pendingScheduleReview.eligibleCount, 2);
  assert.equal(modal.pendingScheduleReview.totalCount, 2);
  assert.match(modal.getScheduleReviewSubtitle(), /2 of 2|2 tasks qualify/);
});

test("project lifecycle review names propagation and still writes once", async () => {
  const captured = [];
  const content = [
    "---",
    'type: "[[project]]"',
    "---",
    "- [ ] #task Ship it ^prj",
    "- [ ] #task Child one",
    "- [ ] #task Child two",
  ].join("\n");
  const context = getProjectNotePropertyContext(content, 3);
  assert.equal(context.valid, true);
  const { modal, plugin } = openScheduleStage({
    content,
    cursorLine: 3,
    context: {
      propertyContext: { ...context, isObsidianTask: true },
    },
  });
  plugin.setProjectNoteScheduledValue = async (
    _editor,
    _cursor,
    _path,
    _line,
    _from,
    value,
    options,
  ) => {
    captured.push({
      value,
      reason: options.scheduleLog && options.scheduleLog.reason,
      summary: options.schedulingWorkLog && options.schedulingWorkLog.summary,
    });
    return true;
  };
  await chooseDate(modal, "3");
  assert.equal(modal.stage, "schedule-review");
  assert.match(modal.getScheduleReviewSubtitle(), /propagates to project tasks/);
  assert.equal(modal.scheduleReviewSummaryEl, null);
  await confirmReview(modal, { reason: "ship next week" });
  await nextTurn();
  assert.equal(captured.length, 1);
  assert.equal(captured[0].value, "2026-10-06");
  assert.equal(captured[0].reason, "ship next week");
});

test("priority picks still skip the combined review and keep Work Log-only prompts", async () => {
  const { modal } = openPropertyPicker({
    content: "- [/] #task Pending work ^pending",
  });
  dispatchCardKey(modal, "2");
  await nextTurn();
  assert.notEqual(modal.stage, "schedule-review");
  assert.notEqual(modal.stage, "reason");
});

test("a typed date from the card's schedule row uses the combined review", async () => {
  const captured = [];
  const { modal, plugin } = openPropertyPicker({
    content: "- [ ] #task Ready work ^ready",
  });
  plugin.setBulletPropertyValue = async (_e, _c, _n, value, options) => {
    captured.push({ value, reason: options.scheduleLog.reason });
    return true;
  };
  dispatchCardKey(modal, "Enter");
  assert.equal(modal.stage, "value");
  typeQuery(modal, "3");
  pressKey(modal.inputEl, "Enter");
  await nextTurn();
  assert.equal(modal.stage, "schedule-review");
  assert.ok(modal.scheduleReviewReasonEl);
  assert.equal(modal.scheduleReviewSummaryEl, null);
  await confirmReview(modal, { reason: "from the card" });
  await nextTurn();
  assert.equal(captured.length, 1);
  assert.equal(captured[0].reason, "from the card");
});

test("scheduling a Pending task goes straight to the combined review, never serial prompts", async () => {
  const { modal } = openPropertyPicker({
    content: "- [/] #task Pending work ^pending",
  });
  dispatchCardKey(modal, "Enter");
  typeQuery(modal, "+3d");
  pressKey(modal.inputEl, "Enter");
  await nextTurn();
  assert.equal(modal.stage, "schedule-review");
  assert.ok(modal.scheduleReviewReasonEl);
  assert.ok(modal.scheduleReviewSummaryEl);
  assert.equal(typeof modal.showScheduleReasonStage, "undefined");
  assert.equal(typeof modal.confirmScheduleReason, "undefined");
});
