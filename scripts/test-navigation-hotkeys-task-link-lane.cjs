const test = require("node:test");
const assert = require("node:assert/strict");
const {
  notices,
  NavigationHotkeysPlugin,
  helpers,
  TransactionEditor,
  createLinkPickerHarness,
} = require("./navigation-hotkeys-harness.cjs");

const DAILY_PATH = "2026/20261007.md";
const TICK = () => new Promise((resolve) => setImmediate(resolve));

function modalTexts(modal, cls) {
  const found = [];
  const visit = (el) => {
    if (el.classes && el.classes.includes(cls)) {
      found.push(el.textContent);
    }
    for (const child of el.children || []) {
      visit(child);
    }
  };
  visit(modal.contentEl);
  return found;
}

function dailyNote(...body) {
  return ["## Pomodoros", ...body].join("\n");
}

function laneHarness({ daily, tasks, cursor, notesExtra, appExtra }) {
  const harness = createLinkPickerHarness({
    notes: { "Tasks.md": tasks, ...(notesExtra || {}) },
    linkPath: DAILY_PATH,
    linkContent: daily,
    cursor: cursor || { line: 2, ch: 3 },
  });
  Object.assign(harness.plugin.app, appExtra || {});
  const view = {
    editor: harness.linkEditor,
    file: harness.files.get(DAILY_PATH),
  };
  return { ...harness, view };
}

function budgetsApi({ next, pending, progressMarks } = {}) {
  const captured = [];
  return {
    captured,
    api: {
      version: 2,
      nextBudget: () =>
        next || { count: 11, cap: 15, over: false },
      pendingBudget: () =>
        pending || { count: 8, cap: 10, over: false },
      progressMarks: {
        version: 1,
        expect: (entries) => {
          captured.push(...entries);
        },
        ...(progressMarks || {}),
      },
    },
  };
}

function withLedger(harness, ledger) {
  harness.plugin.app.plugins = {
    plugins: { "bob-ledger-tools": { api: ledger.api } },
  };
  return ledger;
}

// --- matcher (D4, L5, L10, L12, L13) -------------------------------------

test("isPomodoroTaskLinkLine matches dedicated links under any Pomodoro entry", () => {
  const { isPomodoroTaskLinkLine } = helpers;
  const content = dailyNote(
    "- [ ] (**0940-1010**)",
    "\t- [[Tasks#^a1]]",
    "\t- [[Tasks#^a2|Alias]]",
    "\t- [[Tasks#^a3]] #",
    "\t- ~~[[Tasks#^a4]]~~",
    "\t- ![[Tasks#^a5]]",
    "- [x] (**0900-0930**)",
    "\t- 🍅 [[Tasks#^a6]]",
    "## Other",
    "- [[Tasks#^a7]]",
  );
  for (const line of [2, 3, 4, 5, 6, 8]) {
    assert.equal(
      isPomodoroTaskLinkLine(content, line, DAILY_PATH),
      true,
      `line ${line} should match`,
    );
  }
  // Plain link outside Pomodoros never matches (L13).
  assert.equal(isPomodoroTaskLinkLine(content, 10, DAILY_PATH), false);
  // The Pomodoro entry line itself never matches (L13).
  assert.equal(isPomodoroTaskLinkLine(content, 0, DAILY_PATH), false);
  assert.equal(isPomodoroTaskLinkLine(content, 1, DAILY_PATH), false);
  assert.equal(isPomodoroTaskLinkLine(content, 7, DAILY_PATH), false);
});

test("isPomodoroTaskLinkLine refuses task lines, fences, and non-daily paths", () => {
  const { isPomodoroTaskLinkLine } = helpers;
  const content = dailyNote(
    "- [ ] (**0940-1010**)",
    "\t- [[Tasks#^a1]]",
    "\t- [ ] [[Tasks#^a2]]",
    "```",
    "- [[Tasks#^a3]]",
    "```",
  );
  assert.equal(isPomodoroTaskLinkLine(content, 2, DAILY_PATH), true);
  // A task line carrying a link is a task, not a Task Link (L13).
  assert.equal(isPomodoroTaskLinkLine(content, 3, DAILY_PATH), false);
  // Fenced links never match.
  assert.equal(isPomodoroTaskLinkLine(content, 5, DAILY_PATH), false);
  // Only daily-note-shaped paths match; the date itself is irrelevant.
  assert.equal(isPomodoroTaskLinkLine(content, 2, "Notes/Random.md"), false);
  assert.equal(
    isPomodoroTaskLinkLine(content, 2, "2026/20261006.md"),
    true,
  );
  // Out-of-range and empty inputs never throw.
  assert.equal(isPomodoroTaskLinkLine(content, 99, DAILY_PATH), false);
  assert.equal(isPomodoroTaskLinkLine("", 0, DAILY_PATH), false);
  assert.equal(isPomodoroTaskLinkLine(null, 0, null), false);
});

test("isPomodoroTaskLinkLine refuses Depends-On lines and prose links", () => {
  const { isPomodoroTaskLinkLine } = helpers;
  const content = dailyNote(
    "- [ ] (**0940-1010**)",
    "\t- [[Tasks#^a1]]",
    "\t- ⛓️ **DEPENDS ON:** [[Tasks#^a2]]",
    "\t- read [[Tasks#^a3]] today",
  );
  assert.equal(isPomodoroTaskLinkLine(content, 2, DAILY_PATH), true);
  assert.equal(isPomodoroTaskLinkLine(content, 3, DAILY_PATH), false);
  assert.equal(isPomodoroTaskLinkLine(content, 4, DAILY_PATH), false);
});

// --- mode decision + refusals (D5, D6) ------------------------------------

test("decideTaskLinkLaneMode starts when any target is Next", () => {
  const { decideTaskLinkLaneMode } = helpers;
  assert.equal(decideTaskLinkLaneMode(["*", "/", "*"]), "start");
  assert.equal(decideTaskLinkLaneMode(["*"]), "start");
  assert.equal(decideTaskLinkLaneMode(["/", "/"]), "pause");
  assert.equal(decideTaskLinkLaneMode(["/"]), "pause");
  assert.equal(decideTaskLinkLaneMode([" ", "?"]), null);
  assert.equal(decideTaskLinkLaneMode(["x"]), null);
  assert.equal(decideTaskLinkLaneMode([]), null);
  assert.equal(decideTaskLinkLaneMode(null), null);
});

test("taskLinkLaneRefusalFor renders every D5 refusal", () => {
  const { taskLinkLaneRefusalFor } = helpers;
  assert.equal(taskLinkLaneRefusalFor("*"), null);
  assert.equal(taskLinkLaneRefusalFor("/"), null);
  assert.equal(
    taskLinkLaneRefusalFor(" "),
    "Task is Ready · Alt+N commits it to Next",
  );
  assert.equal(
    taskLinkLaneRefusalFor("?"),
    "Blocked is derived · clear its dependency or future schedule first",
  );
  assert.equal(
    taskLinkLaneRefusalFor("x"),
    "Task is done · Ctrl+Enter reopens it",
  );
  assert.equal(
    taskLinkLaneRefusalFor("-"),
    "Task is cancelled",
  );
});

// --- planner (L1-L3, L6-L9, L14 echoes at unit level) ---------------------

function laneSession(content, ...lines) {
  const split = content.split("\n");
  return {
    targets: lines.map((line) =>
      Object.freeze({ line, rawLine: split[line] }),
    ),
  };
}

test("planTaskLinkLaneBatch starts Next targets and leaves the rest alone", () => {
  const content = [
    "- [*] #task A ^a1",
    "- [/] #task B ^a2",
    "- [ ] #task C ^a3",
    "- [?] #task D ^a4",
    "- [x] #task E ^a5",
  ].join("\n");
  const plan = helpers.planTaskLinkLaneBatch(
    content,
    laneSession(content, 0, 1, 2, 3, 4),
    { mode: "start", summary: "", dateText: "2026-10-07" },
  );
  assert.equal(plan.valid, true);
  assert.equal(plan.mode, "start");
  assert.equal(plan.changedTaskCount, 1);
  assert.equal(plan.started.length, 1);
  assert.equal(plan.paused.length, 0);
  assert.equal(plan.readySkipped, 1);
  assert.equal(plan.blockedSkipped, 1);
  assert.equal(plan.closedSkipped, 1);
  assert.deepEqual(plan.content.split("\n"), [
    "- [/] #task A ^a1",
    "- [/] #task B ^a2",
    "- [ ] #task C ^a3",
    "- [?] #task D ^a4",
    "- [x] #task E ^a5",
  ]);
});

test("planTaskLinkLaneBatch pauses with one shared Work Log entry", () => {
  const content = [
    "- [/] #task A ^a1",
    "- [*] #task B ^a2",
    "- [/] #task C ^a3",
  ].join("\n");
  const plan = helpers.planTaskLinkLaneBatch(
    content,
    laneSession(content, 0, 1, 2),
    { mode: "pause", summary: "Finished the API review", dateText: "2026-10-07" },
  );
  assert.equal(plan.valid, true);
  assert.equal(plan.mode, "pause");
  assert.equal(plan.changedTaskCount, 2);
  assert.equal(plan.paused.length, 2);
  assert.equal(plan.workLogWrittenCount, 2);
  const taskLines = plan.content
    .split("\n")
    .filter((line) => /#task/.test(line));
  assert.deepEqual(taskLines, [
    "- [*] #task A ^a1",
    "- [*] #task B ^a2",
    "- [*] #task C ^a3",
  ]);
  assert.equal(
    plan.content.split("*2026-10-07* — Finished the API review").length - 1,
    2,
  );
  // A blank summary pauses without logging.
  const blank = helpers.planTaskLinkLaneBatch(
    content,
    laneSession(content, 0, 2),
    { mode: "pause", summary: "   ", dateText: "2026-10-07" },
  );
  assert.equal(blank.valid, true);
  assert.equal(blank.workLogWrittenCount, 0);
  assert.doesNotMatch(blank.content, /WORK LOG/);
});

test("planTaskLinkLaneBatch applies the freshness stamp last", () => {
  const content = "- [*] #task A ^a1";
  const seen = [];
  const plan = helpers.planTaskLinkLaneBatch(
    content,
    laneSession(content, 0),
    {
      mode: "start",
      summary: "",
      dateText: "2026-10-07",
      stampLine: (line, date) => {
        seen.push(date);
        return `${line} [fresh:: ${date}]`;
      },
      freshDateText: "today",
    },
  );
  assert.equal(plan.valid, true);
  assert.equal(plan.content, "- [/] #task A ^a1 [fresh:: today]");
  assert.deepEqual(seen, ["today"]);
});

test("planTaskLinkLaneBatch dedupes lines and refuses stale preimages", () => {
  const content = "- [*] #task A ^a1";
  const dupe = helpers.planTaskLinkLaneBatch(
    content,
    {
      targets: [
        Object.freeze({ line: 0, rawLine: content }),
        Object.freeze({ line: 0, rawLine: content }),
      ],
    },
    { mode: "start", summary: "", dateText: "2026-10-07" },
  );
  assert.equal(dupe.valid, true);
  assert.equal(dupe.moved.length, 1);
  const stale = helpers.planTaskLinkLaneBatch(
    "- [*] #task A ^a1",
    laneSession("- [/] #task A ^a1", 0),
    { mode: "start", summary: "", dateText: "2026-10-07" },
  );
  assert.equal(stale.valid, false);
  assert.equal(stale.stale, true);
  const noMode = helpers.planTaskLinkLaneBatch(
    content,
    laneSession(content, 0),
    { summary: "", dateText: "2026-10-07" },
  );
  assert.equal(noMode.valid, false);
});

// --- notices (L1-L3, L7-L8 shapes) -----------------------------------------

test("buildTaskLinkLaneNotice renders start, pause, logs, skips, and budgets", () => {
  const { buildTaskLinkLaneNotice } = helpers;
  const budgets = {
    next: { count: 11, cap: 15, over: false },
    pending: { count: 8, cap: 10, over: false },
  };
  assert.equal(
    buildTaskLinkLaneNotice({
      mode: "start",
      tasks: ["Fix the parser crash"],
      changedTaskCount: 1,
      workLogWrittenCount: 0,
      readySkipped: 0,
      blockedSkipped: 0,
      closedSkipped: 0,
      laneBudgets: budgets,
    }),
    "◐ In Progress · Fix the parser crash · PENDING 9/10 · NEXT 10/15",
  );
  assert.equal(
    buildTaskLinkLaneNotice({
      mode: "pause",
      tasks: ["Fix the parser crash"],
      changedTaskCount: 1,
      workLogWrittenCount: 1,
      readySkipped: 0,
      blockedSkipped: 0,
      closedSkipped: 0,
      laneBudgets: budgets,
    }),
    "→ Next · Fix the parser crash · logged · PENDING 7/10 · NEXT 12/15",
  );
  const batch = buildTaskLinkLaneNotice({
    mode: "pause",
    tasks: ["A", "B"],
    changedTaskCount: 2,
    workLogWrittenCount: 2,
    readySkipped: 1,
    blockedSkipped: 1,
    closedSkipped: 1,
    laneBudgets: null,
  });
  assert.match(batch, /^→ Next · 2 tasks · logged 2/);
  assert.match(batch, /1 Ready skipped/);
  assert.match(batch, /1 Blocked skipped — Blocked is derived/);
  assert.match(batch, /1 already closed/);
  const over = buildTaskLinkLaneNotice({
    mode: "start",
    tasks: ["A"],
    changedTaskCount: 1,
    workLogWrittenCount: 0,
    readySkipped: 0,
    blockedSkipped: 0,
    closedSkipped: 0,
    laneBudgets: {
      next: { count: 15, cap: 15, over: false },
      pending: { count: 10, cap: 10, over: true },
    },
  });
  assert.match(over, /PENDING 11\/10/);
  assert.match(over, /🔴 · prune at the weekly review/);
  const long = buildTaskLinkLaneNotice({
    mode: "start",
    tasks: [`${"x".repeat(70)}`],
    changedTaskCount: 1,
    workLogWrittenCount: 0,
    readySkipped: 0,
    blockedSkipped: 0,
    closedSkipped: 0,
    laneBudgets: null,
  });
  assert.match(long, /…$/);
});

// --- prompt state + modal (L2-L4, D8) --------------------------------------

test("taskLinkLanePromptState drives the Move to Next prompt", () => {
  const { taskLinkLanePromptState } = helpers;
  const blank = taskLinkLanePromptState("   ", { date: "2026-10-07" });
  assert.equal(blank.isBlank, true);
  assert.equal(blank.primaryButtonText, "Move to Next");
  assert.equal(blank.formattedEntry, "");
  assert.equal(blank.hasDataviewWarning, false);
  assert.equal(blank.summary, "");
  assert.equal(blank.date, "2026-10-07");
  const filled = taskLinkLanePromptState("Finished the API review", {
    date: "2026-10-07",
  });
  assert.equal(filled.isBlank, false);
  assert.equal(filled.primaryButtonText, "Log & move to Next");
  assert.equal(filled.formattedEntry, "*2026-10-07* — Finished the API review");
  assert.equal(filled.hasDataviewWarning, false);
  const warned = taskLinkLanePromptState("a :: b", { date: "2026-10-07" });
  assert.equal(warned.hasDataviewWarning, true);
});

test("TaskLinkLanePromptModal submits, previews live, and cancels silently", () => {
  const seen = [];
  const modal = new helpers.TaskLinkLanePromptModal(
    {},
    {
      tasks: [{ displayText: "Fix the parser crash", path: "Tasks.md" }],
      dateText: "2026-10-07",
      onDone: (result) => seen.push(result),
    },
  );
  modal.open();
  assert.deepEqual(modalTexts(modal, "bob-tll-title"), ["Move to Next"]);
  assert.deepEqual(modalTexts(modal, "bob-tll-subtitle"), [
    "Optional: what did you get done? Saved to the Work Log.",
  ]);
  assert.deepEqual(modalTexts(modal, "bob-tll-context-task"), [
    "Fix the parser crash",
  ]);
  assert.deepEqual(modalTexts(modal, "bob-tll-context-source"), ["Tasks.md"]);
  assert.deepEqual(modalTexts(modal, "bob-tll-label"), [
    "Work summary (optional)",
  ]);
  assert.equal(modal.inputEl.getAttribute("placeholder"), "What did you get done?");
  assert.equal(modal.primaryButton.textContent, "Move to Next");
  modal.inputEl.value = "Finished the API review";
  modal.updatePreview();
  assert.equal(modal.primaryButton.textContent, "Log & move to Next");
  assert.equal(
    modal.previewEl.getAttribute("aria-label"),
    "*2026-10-07* — Finished the API review",
  );
  modal.inputEl.value = "a :: b";
  modal.updatePreview();
  assert.equal(modal.warningEl.classList.contains("is-hidden"), false);
  // Enter submits unless an IME composition is active.
  modal.inputEl.value = "done bit";
  modal.inputEl.listeners.keydown({
    key: "Enter",
    isComposing: true,
    preventDefault() {},
    stopPropagation() {},
  });
  assert.equal(seen.length, 0);
  modal.inputEl.listeners.keydown({
    key: "Enter",
    isComposing: false,
    preventDefault() {},
    stopPropagation() {},
  });
  assert.deepEqual(seen, [{ summary: "done bit" }]);
  // A fresh modal cancelled by close reports null once.
  const cancelled = [];
  const second = new helpers.TaskLinkLanePromptModal(
    {},
    {
      tasks: [{ displayText: "A", path: "T.md" }],
      dateText: "2026-10-07",
      onDone: (result) => cancelled.push(result),
    },
  );
  second.open();
  second.close();
  assert.deepEqual(cancelled, [null]);
});

test("TaskLinkLanePromptModal renders the batch context card", () => {
  const seen = [];
  const modal = new helpers.TaskLinkLanePromptModal(
    {},
    {
      tasks: [
        { displayText: "A", path: "T.md" },
        { displayText: "B", path: "T.md" },
        { displayText: "C", path: "T.md" },
        { displayText: "D", path: "T.md" },
      ],
      dateText: "2026-10-07",
      onDone: (result) => seen.push(result),
    },
  );
  modal.open();
  assert.deepEqual(modalTexts(modal, "bob-tll-context-task"), ["4 tasks"]);
  const sources = modalTexts(modal, "bob-tll-context-source");
  assert.deepEqual(sources, [
    "A",
    "B",
    "C",
    "+1 more",
    "The same entry is logged on each task.",
  ]);
  modal.close();
  assert.deepEqual(seen, [null]);
});

// --- resolver option --------------------------------------------------------

test("findUniqueLinkPickerTargetLine allowClosed resolves closed tasks", () => {
  const { findUniqueLinkPickerTargetLine } = helpers;
  const content = [
    "- [*] #task Open ^a1",
    "- [x] #task Done ^a2",
    "- [-] #task Gone ^a3",
  ].join("\n");
  const closed = findUniqueLinkPickerTargetLine(content, "a2");
  assert.equal(closed.valid, false);
  assert.equal(closed.error, "closed");
  const allowed = findUniqueLinkPickerTargetLine(content, "a2", {
    allowClosed: true,
  });
  assert.equal(allowed.valid, true);
  assert.equal(allowed.line, 1);
  // Missing, duplicated, and non-task targets still fail with the option on.
  assert.equal(
    findUniqueLinkPickerTargetLine(content, "nope", { allowClosed: true })
      .valid,
    false,
  );
  const dupe = findUniqueLinkPickerTargetLine(
    `${content}\n- [x] #task Again ^a2`,
    "a2",
    { allowClosed: true },
  );
  assert.equal(dupe.valid, false);
  assert.equal(dupe.error, "duplicated");
  assert.equal(
    findUniqueLinkPickerTargetLine("- plain ^a9", "a9", { allowClosed: true })
      .valid,
    false,
  );
});

// --- orchestration (L1-L4, L6-L11, L14-L15) ----------------------------------

test("L1: toggle starts a Next link, stamps, hints, and notices", async () => {
  notices.length = 0;
  const harness = laneHarness({
    daily: dailyNote(
      "- [ ] (**0940-1010**)",
      "\t- [[Tasks#^a1]]",
    ),
    tasks: "- [*] #task Fix the parser crash ^a1",
    cursor: { line: 2, ch: 3 },
  });
  const ledger = withLedger(harness, budgetsApi());
  harness.plugin.app.plugins.plugins["bob-ledger-tools"].api.freshness = {
    stampLine: (line, date) => `${line} [fresh:: ${date}]`,
  };
  // freshness v3 is required for the stamper; budgets read from v2.
  harness.plugin.app.plugins.plugins["bob-ledger-tools"].api.version = 3;
  const result = await harness.plugin.toggleTaskLinkLane({
    editor: harness.linkEditor,
    view: harness.view,
  });
  assert.deepEqual(result, { ok: true, mode: "start", changed: 1 });
  assert.match(harness.notes["Tasks.md"], /^- \[\/\] #task Fix the parser crash \^a1 \[fresh:: /);
  assert.equal(harness.plugin.taskLinkLanePrompt ?? null, null);
  assert.deepEqual(ledger.captured, [
    { path: "Tasks.md", blockId: "a1", status: "/" },
  ]);
  assert.match(
    notices.at(-1),
    /◐ In Progress · Fix the parser crash · PENDING 9\/10 · NEXT 10\/15/,
  );
});

test("L2/L3: toggle pauses through the prompt, logging one shared entry", async () => {
  notices.length = 0;
  const harness = laneHarness({
    daily: dailyNote(
      "- [ ] (**0940-1010**)",
      "\t- [[Tasks#^a1]]",
    ),
    tasks: "- [/] #task Fix the parser crash ^a1",
    cursor: { line: 2, ch: 3 },
  });
  withLedger(harness, budgetsApi());
  const pending = harness.plugin.toggleTaskLinkLane({
    editor: harness.linkEditor,
    view: harness.view,
  });
  await TICK();
  await TICK();
  const modal = harness.plugin.taskLinkLanePrompt;
  assert.ok(modal);
  modal.inputEl.value = "Finished the API review";
  modal.submit();
  const result = await pending;
  assert.deepEqual(result, { ok: true, mode: "pause", changed: 1 });
  assert.match(harness.notes["Tasks.md"], /^- \[\*\] #task Fix the parser crash \^a1/);
  assert.match(harness.notes["Tasks.md"], /WORK LOG/);
  assert.match(harness.notes["Tasks.md"], /— Finished the API review/);
  assert.match(notices.at(-1), /→ Next · Fix the parser crash · logged/);
});

test("L4: cancelling the prompt writes nothing and shows no Notice", async () => {
  notices.length = 0;
  const before = "- [/] #task Fix the parser crash ^a1";
  const harness = laneHarness({
    daily: dailyNote(
      "- [ ] (**0940-1010**)",
      "\t- [[Tasks#^a1]]",
    ),
    tasks: before,
    cursor: { line: 2, ch: 3 },
  });
  const pending = harness.plugin.toggleTaskLinkLane({
    editor: harness.linkEditor,
    view: harness.view,
  });
  await TICK();
  await TICK();
  assert.ok(harness.plugin.taskLinkLanePrompt);
  harness.plugin.taskLinkLanePrompt.close();
  const result = await pending;
  assert.deepEqual(result, { ok: false, reason: "cancelled" });
  assert.equal(harness.notes["Tasks.md"], before);
  assert.equal(notices.length, 0);
});

test("L5: both directions run the same toggle twice for a round trip", async () => {
  notices.length = 0;
  const harness = laneHarness({
    daily: dailyNote(
      "- [ ] (**0940-1010**)",
      "\t- [[Tasks#^a1]]",
    ),
    tasks: "- [*] #task Fix ^a1",
    cursor: { line: 2, ch: 3 },
  });
  const first = await harness.plugin.toggleTaskLinkLane({
    editor: harness.linkEditor,
    view: harness.view,
  });
  assert.deepEqual(first, { ok: true, mode: "start", changed: 1 });
  // Alt+[ and Alt+] share this one path: the second press pauses back.
  const pending = harness.plugin.toggleTaskLinkLane({
    editor: harness.linkEditor,
    view: harness.view,
  });
  await TICK();
  await TICK();
  harness.plugin.taskLinkLanePrompt.inputEl.value = "";
  harness.plugin.taskLinkLanePrompt.submit();
  const second = await pending;
  assert.deepEqual(second, { ok: true, mode: "pause", changed: 1 });
  assert.match(harness.notes["Tasks.md"], /^- \[\*\] #task Fix \^a1/);
});

test("L6: Ready, Blocked, done, and cancelled targets are refused", async () => {
  const cases = [
    ["- [ ] #task Ready ^a1", "Task is Ready · Alt+N commits it to Next"],
    [
      "- [?] #task Waiting ^a1",
      "Blocked is derived · clear its dependency or future schedule first",
    ],
    ["- [x] #task Done ^a1", "Task is done · Ctrl+Enter reopens it"],
    ["- [-] #task Gone ^a1", "Task is cancelled"],
  ];
  for (const [taskLine, expected] of cases) {
    notices.length = 0;
    const harness = laneHarness({
      daily: dailyNote(
        "- [ ] (**0940-1010**)",
        "\t- [[Tasks#^a1]]",
      ),
      tasks: taskLine,
      cursor: { line: 2, ch: 3 },
    });
    const result = await harness.plugin.toggleTaskLinkLane({
      editor: harness.linkEditor,
      view: harness.view,
    });
    assert.deepEqual(result, { ok: false, reason: "refused" });
    assert.equal(notices.at(-1), expected);
    assert.equal(harness.notes["Tasks.md"], taskLine);
  }
  // A struck link to a done task reports the done refusal.
  notices.length = 0;
  const struck = laneHarness({
    daily: dailyNote(
      "- [ ] (**0940-1010**)",
      "\t- ~~[[Tasks#^a1]]~~",
    ),
    tasks: "- [x] #task Done ^a1",
    cursor: { line: 2, ch: 3 },
  });
  const struckResult = await struck.plugin.toggleTaskLinkLane({
    editor: struck.linkEditor,
    view: struck.view,
  });
  assert.deepEqual(struckResult, { ok: false, reason: "refused" });
  assert.equal(notices.at(-1), "Task is done · Ctrl+Enter reopens it");
});

test("L6: missing targets keep the existing resolver error", async () => {
  notices.length = 0;
  const harness = laneHarness({
    daily: dailyNote(
      "- [ ] (**0940-1010**)",
      "\t- [[Tasks#^missing]]",
    ),
    tasks: "- [*] #task Fix ^a1",
    cursor: { line: 2, ch: 3 },
  });
  const result = await harness.plugin.toggleTaskLinkLane({
    editor: harness.linkEditor,
    view: harness.view,
  });
  assert.deepEqual(result, { ok: false, reason: "refused" });
  assert.match(notices.at(-1), /missing or duplicated/);
});

test("L7: a counted start flips every Next sibling and leaves In Progress alone", async () => {
  notices.length = 0;
  const harness = laneHarness({
    daily: dailyNote(
      "- [ ] (**0940-1010**)",
      "\t- [[Tasks#^a1]]",
      "\t- [[Tasks#^a2]]",
      "\t- [[Tasks#^a3]]",
    ),
    tasks: [
      "- [*] #task A ^a1",
      "- [/] #task B ^a2",
      "- [*] #task C ^a3",
    ].join("\n"),
    cursor: { line: 2, ch: 3 },
  });
  const result = await harness.plugin.toggleTaskLinkLane({
    editor: harness.linkEditor,
    view: harness.view,
    countExplicit: true,
    additionalTaskCount: 2,
  });
  assert.deepEqual(result, { ok: true, mode: "start", changed: 2 });
  assert.deepEqual(harness.notes["Tasks.md"].split("\n"), [
    "- [/] #task A ^a1",
    "- [/] #task B ^a2",
    "- [/] #task C ^a3",
  ]);
  assert.equal(harness.plugin.taskLinkLanePrompt ?? null, null);
  assert.match(notices.at(-1), /◐ In Progress · 2 tasks/);
});

test("L8: a counted pause prompts once and skips Blocked with a count", async () => {
  notices.length = 0;
  const harness = laneHarness({
    daily: dailyNote(
      "- [ ] (**0940-1010**)",
      "\t- [[Tasks#^a1]]",
      "\t- [[Tasks#^a2]]",
      "\t- [[Tasks#^a3]]",
    ),
    tasks: [
      "- [/] #task A ^a1",
      "- [/] #task B ^a2",
      "- [?] #task C ^a3",
    ].join("\n"),
    cursor: { line: 2, ch: 3 },
  });
  const pending = harness.plugin.toggleTaskLinkLane({
    editor: harness.linkEditor,
    view: harness.view,
    countExplicit: true,
    additionalTaskCount: 2,
  });
  await TICK();
  await TICK();
  const modal = harness.plugin.taskLinkLanePrompt;
  assert.ok(modal);
  modal.inputEl.value = "Paused both";
  modal.submit();
  const result = await pending;
  assert.deepEqual(result, { ok: true, mode: "pause", changed: 2 });
  assert.match(harness.notes["Tasks.md"], /WORK LOG/);
  assert.equal(
    harness.notes["Tasks.md"].split("— Paused both").length - 1,
    2,
  );
  assert.match(
    notices.at(-1),
    /→ Next · 2 tasks · logged 2 · 1 Blocked skipped — Blocked is derived/,
  );
});

test("L9: an over-long count clamps at the entry end without error", async () => {
  notices.length = 0;
  const harness = laneHarness({
    daily: dailyNote(
      "- [ ] (**0940-1010**)",
      "\t- [[Tasks#^a1]]",
      "\t- [[Tasks#^a2]]",
      "- [ ] (**1010-1040**)",
      "\t- [[Tasks#^a3]]",
    ),
    tasks: [
      "- [*] #task A ^a1",
      "- [*] #task B ^a2",
      "- [*] #task C ^a3",
    ].join("\n"),
    cursor: { line: 2, ch: 3 },
  });
  const result = await harness.plugin.toggleTaskLinkLane({
    editor: harness.linkEditor,
    view: harness.view,
    countExplicit: true,
    additionalTaskCount: 5,
  });
  assert.deepEqual(result, { ok: true, mode: "start", changed: 2 });
  assert.match(harness.notes["Tasks.md"], /^- \[\/\] #task A \^a1$/m);
  assert.match(harness.notes["Tasks.md"], /^- \[\/\] #task B \^a2$/m);
  assert.match(harness.notes["Tasks.md"], /^- \[\*\] #task C \^a3$/m);
});

test("L10: a closed-entry history line toggles the task and keeps the line", async () => {
  notices.length = 0;
  const daily = dailyNote(
    "- [x] (**0900-0930**)",
    "\t- 🍅 [[Tasks#^a1]]",
  );
  const harness = laneHarness({
    daily,
    tasks: "- [*] #task Fix ^a1",
    cursor: { line: 2, ch: 5 },
  });
  const result = await harness.plugin.toggleTaskLinkLane({
    editor: harness.linkEditor,
    view: harness.view,
  });
  assert.deepEqual(result, { ok: true, mode: "start", changed: 1 });
  assert.equal(harness.linkEditor.content, daily);
  assert.match(harness.notes["Tasks.md"], /^- \[\/\] #task Fix \^a1/);
});

test("L11: a target edited while the prompt is open refuses stale", async () => {
  notices.length = 0;
  const harness = laneHarness({
    daily: dailyNote(
      "- [ ] (**0940-1010**)",
      "\t- [[Tasks#^a1]]",
    ),
    tasks: "- [/] #task Fix ^a1",
    cursor: { line: 2, ch: 3 },
  });
  const pending = harness.plugin.toggleTaskLinkLane({
    editor: harness.linkEditor,
    view: harness.view,
  });
  await TICK();
  await TICK();
  assert.ok(harness.plugin.taskLinkLanePrompt);
  harness.notes["Tasks.md"] = "- [/] #task Fix, edited ^a1";
  harness.plugin.taskLinkLanePrompt.inputEl.value = "";
  harness.plugin.taskLinkLanePrompt.submit();
  const result = await pending;
  assert.deepEqual(result, { ok: false, reason: "stale" });
  assert.equal(notices.at(-1), "A linked note changed; no tasks were updated");
  assert.equal(harness.notes["Tasks.md"], "- [/] #task Fix, edited ^a1");
});

test("L12: an embedded Pomodoro link takes the two-state toggle", async () => {
  notices.length = 0;
  const harness = laneHarness({
    daily: dailyNote(
      "- [ ] (**0940-1010**)",
      "\t- ![[Tasks#^a1]]",
    ),
    tasks: "- [*] #task Fix ^a1",
    cursor: { line: 2, ch: 3 },
  });
  const result = await harness.plugin.toggleTaskLinkLane({
    editor: harness.linkEditor,
    view: harness.view,
  });
  assert.deepEqual(result, { ok: true, mode: "start", changed: 1 });
  assert.match(harness.notes["Tasks.md"], /^- \[\/\] #task Fix \^a1/);
});

test("L14: the same task linked twice in a batch is written once", async () => {
  notices.length = 0;
  const harness = laneHarness({
    daily: dailyNote(
      "- [ ] (**0940-1010**)",
      "\t- [[Tasks#^a1]]",
      "\t- [[Tasks#^a1]]",
    ),
    tasks: "- [/] #task Fix ^a1",
    cursor: { line: 2, ch: 3 },
  });
  const pending = harness.plugin.toggleTaskLinkLane({
    editor: harness.linkEditor,
    view: harness.view,
    countExplicit: true,
    additionalTaskCount: 1,
  });
  await TICK();
  await TICK();
  harness.plugin.taskLinkLanePrompt.inputEl.value = "Once";
  harness.plugin.taskLinkLanePrompt.submit();
  const result = await pending;
  assert.deepEqual(result, { ok: true, mode: "pause", changed: 1 });
  assert.equal(
    harness.notes["Tasks.md"].split("— Once").length - 1,
    1,
  );
});

test("L15: a second toggle while one is in flight is swallowed as busy", async () => {
  notices.length = 0;
  const harness = laneHarness({
    daily: dailyNote(
      "- [ ] (**0940-1010**)",
      "\t- [[Tasks#^a1]]",
    ),
    tasks: "- [/] #task Fix ^a1",
    cursor: { line: 2, ch: 3 },
  });
  const first = harness.plugin.toggleTaskLinkLane({
    editor: harness.linkEditor,
    view: harness.view,
  });
  await TICK();
  await TICK();
  assert.ok(harness.plugin.taskLinkLanePrompt);
  const countBefore = notices.length;
  const second = await harness.plugin.toggleTaskLinkLane({
    editor: harness.linkEditor,
    view: harness.view,
  });
  assert.deepEqual(second, { ok: false, reason: "busy" });
  assert.equal(notices.length, countBefore);
  harness.plugin.taskLinkLanePrompt.close();
  assert.deepEqual(await first, { ok: false, reason: "cancelled" });
  assert.equal(harness.notes["Tasks.md"], "- [/] #task Fix ^a1");
});

test("toggle on a non-link line refuses without writing", async () => {
  notices.length = 0;
  const editor = new TransactionEditor("- [ ] #task Plain ^a1", {
    line: 0,
    ch: 0,
  });
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    plugins: { plugins: {} },
    vault: { getMarkdownFiles: () => [] },
    workspace: { getLeavesOfType: () => [] },
  };
  const file = { path: DAILY_PATH, basename: "20261007", extension: "md" };
  plugin.getActiveMarkdownView = () => ({ editor, file });
  const result = await plugin.toggleTaskLinkLane({
    editor,
    view: { editor, file },
  });
  assert.deepEqual(result, { ok: false, reason: "refused" });
  assert.equal(notices.at(-1), "Cursor is not on a Task Link");
});

// --- api surface (§3) ---------------------------------------------------------

test("api.taskLinkLane is a frozen v1 namespace that never throws", async () => {
  notices.length = 0;
  const harness = laneHarness({
    daily: dailyNote(
      "- [ ] (**0940-1010**)",
      "\t- [[Tasks#^a1]]",
    ),
    tasks: "- [*] #task Fix ^a1",
    cursor: { line: 2, ch: 3 },
  });
  const api = helpers.createDependencyNavApi(harness.plugin).taskLinkLane;
  assert.equal(api.version, 1);
  assert.ok(Object.isFrozen(api));
  assert.equal(
    api.matches({
      content: harness.linkEditor.content,
      line: 2,
      path: DAILY_PATH,
    }),
    true,
  );
  assert.equal(
    api.matches({ content: harness.linkEditor.content, line: 1, path: DAILY_PATH }),
    false,
  );
  assert.equal(api.matches(null), false);
  assert.equal(api.matches({}), false);
  const toggled = await api.toggle({
    editor: harness.linkEditor,
    view: harness.view,
  });
  assert.deepEqual(toggled, { ok: true, mode: "start", changed: 1 });
  // toggle settles instead of rejecting, even with no editor.
  const failed = await api.toggle({ editor: null, view: null });
  assert.equal(failed.ok, false);
  // Without a plugin the namespace reports unavailable.
  const naked = helpers.createTaskLinkLaneApi(null);
  assert.deepEqual(await naked.toggle({}), { ok: false, reason: "unavailable" });
  assert.equal(naked.matches({ content: "x", line: 0, path: DAILY_PATH }), false);
});

test("the progressMarks hint is a no-op without the ledger-tools api", async () => {
  notices.length = 0;
  const harness = laneHarness({
    daily: dailyNote(
      "- [ ] (**0940-1010**)",
      "\t- [[Tasks#^a1]]",
    ),
    tasks: "- [*] #task Fix ^a1",
    cursor: { line: 2, ch: 3 },
  });
  harness.plugin.app.plugins = { plugins: {} };
  const result = await harness.plugin.toggleTaskLinkLane({
    editor: harness.linkEditor,
    view: harness.view,
  });
  assert.deepEqual(result, { ok: true, mode: "start", changed: 1 });
  assert.match(notices.at(-1), /◐ In Progress · Fix/);
  assert.doesNotMatch(notices.at(-1), /PENDING/);
});
