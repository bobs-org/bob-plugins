const test = require("node:test");
const assert = require("node:assert/strict");
const {
  Plugin,
  noticeMessages,
  resetNotices,
  lastNotice,
  localDate,
  WORK_LOG_DATE,
  createEditor,
  sourceForPomodoroLink,
  createTaskModeHarness,
  installMockInboxRoute,
  LINKED_DAILY,
} = require("./block-id-prompt-harness.cjs");

test("direct unlink without a daily note keeps the Next lane and reports it", async () => {
  resetNotices();
  const editor = createEditor("- [*] #task Ship it ^ship");
  const source = sourceForPomodoroLink(editor, "Tasks.md", 0);
  const plugin = new Plugin();
  plugin.resolveTaskFile = (path) => (path === "Tasks.md" ? { path: "Tasks.md" } : null);
  plugin.resolveTodayDailyFile = () => null;
  plugin.suppressEditorScans = () => {};

  const result = await plugin.applyPomodoroTaskUnlink(source);

  assert.equal(result, true);
  assert.equal(editor.getValue(), "- [*] #task Ship it ^ship");
  assert.equal(lastNotice(), "Unlinked · stays Next");
});

test("In Progress unlink with blank summary keeps the lane without a Work Log or daily-note lookup when no block ID exists", async () => {
  resetNotices();
  const editor = createEditor("- [/] #task Ship it");
  const source = sourceForPomodoroLink(editor, "Tasks.md", 0);
  const plugin = new Plugin();
  let dailyResolved = false;
  plugin.resolveTaskFile = (path) => (path === "Tasks.md" ? { path: "Tasks.md" } : null);
  plugin.resolveTodayDailyFile = () => {
    dailyResolved = true;
    return null;
  };
  plugin.suppressEditorScans = () => {};

  const result = await plugin.submitPomodoroWorkSummary(source, " \n\t ");

  assert.equal(result, true);
  assert.equal(dailyResolved, false);
  assert.equal(editor.getValue(), "- [/] #task Ship it");
  assert.equal(lastNotice(), "Unlinked · stays In Progress");
});

test("In Progress unlink with a summary keeps the lane and creates a Work Log", async () => {
  resetNotices();
  const editor = createEditor(["- [/] #task Ship it", "  - Keep detail"].join("\n"));
  const source = sourceForPomodoroLink(editor, "Tasks.md", 0);
  const plugin = new Plugin();
  plugin.resolveTaskFile = (path) => (path === "Tasks.md" ? { path: "Tasks.md" } : null);
  plugin.suppressEditorScans = () => {};
  plugin.now = () => localDate(2026, 8, 15);

  const result = await plugin.submitPomodoroWorkSummary(source, " Added\ncoverage ");

  assert.equal(result, true);
  assert.equal(
    editor.getValue(),
    [
      "- [/] #task Ship it",
      "  - Keep detail",
      "  - 🛠️ **WORK LOG**",
      "    - *2026-08-15* — Added coverage",
    ].join("\n"),
  );
  assert.equal(lastNotice(), "Unlinked · stays In Progress · Work Log updated");
});

test("In Progress unlink revalidates task text and block-ID uniqueness at confirmation", async () => {
  resetNotices();
  const changedEditor = createEditor("- [/] #task Ship it ^ship");
  const changedSource = sourceForPomodoroLink(changedEditor, "Tasks.md", 0);
  changedEditor.replaceRange(
    "- [/] #task Ship it NOW ^ship",
    { line: 0, ch: 0 },
    { line: 0, ch: changedEditor.getLine(0).length },
  );
  const changedPlugin = new Plugin();
  let dailyResolved = false;
  changedPlugin.resolveTodayDailyFile = () => {
    dailyResolved = true;
    return null;
  };

  assert.equal(await changedPlugin.submitPomodoroWorkSummary(changedSource, "Worked"), false);
  assert.equal(dailyResolved, false);
  assert.equal(lastNotice(), "Unlink blocked: selected task changed in Tasks.md");

  resetNotices();
  const duplicateEditor = createEditor("- [/] #task Ship it ^ship");
  const duplicateSource = sourceForPomodoroLink(duplicateEditor, "Tasks.md", 0);
  duplicateEditor.replaceRange(
    "\n- [ ] #task Other ^ship",
    { line: 0, ch: duplicateEditor.getLine(0).length },
  );
  const duplicatePlugin = new Plugin();

  assert.equal(await duplicatePlugin.submitPomodoroWorkSummary(duplicateSource, "Worked"), false);
  assert.equal(lastNotice(), "Block ID 'ship' is duplicated in this note");
});

test("Next task unlink removes current and future links and keeps the Next lane", async () => {
  resetNotices();
  const editor = createEditor("- [*] #task Ship it ^ship");
  const source = sourceForPomodoroLink(editor, "Tasks.md", 0);
  const dailyContent = [
    "## Pomodoros",
    "- [ ] Current (10:00-10:25)",
    "  - [[Tasks#^ship]]",
    "    - nested note",
    "- [ ] Later ()",
    "  - Work [[Tasks#^ship|Ship]] and [[Other#^ship]]",
    "- [x] Done (09:00-09:25)",
    "  - [[Tasks#^ship]]",
  ].join("\n");
  const plugin = new Plugin();
  plugin.resolveTodayDailyFile = () => ({ path: "Daily.md" });
  plugin.resolveTaskFile = (path) => (path === "Tasks.md" ? { path: "Tasks.md" } : null);
  let written = null;
  plugin.app = {
    vault: {
      read: async (file) => (file.path === "Daily.md" ? dailyContent : null),
      modify: async (file, content) => {
        assert.equal(editor.getValue(), "- [*] #task Ship it ^ship");
        written = { path: file.path, content };
      },
    },
  };
  plugin.resolveReferenceDestination = (reference) =>
    reference.targetText === "Tasks" ? { path: "Tasks.md" } : { path: "Other.md" };
  plugin.suppressEditorScans = () => {};

  const result = await plugin.applyPomodoroTaskUnlink(source);

  assert.equal(result, true);
  assert.equal(editor.getValue(), "- [*] #task Ship it ^ship");
  assert.deepEqual(written, {
    path: "Daily.md",
    content: [
      "## Pomodoros",
      "- [ ] Current (10:00-10:25)",
      "- [ ] Later ()",
      "  - Work  and [[Other#^ship]]",
      "- [x] Done (09:00-09:25)",
      "  - [[Tasks#^ship]]",
    ].join("\n"),
  });
  assert.equal(lastNotice(), "Unlinked · stays Next");
});

test("In Progress unlink removes cross-note Pomodoro links and logs work without changing the lane", async () => {
  resetNotices();
  const editor = createEditor("- [/] #task Ship it ^ship");
  const source = sourceForPomodoroLink(editor, "Tasks.md", 0);
  const dailyContent = [
    "## Pomodoros",
    "- [ ] Current (10:00-10:25)",
    "  - [[Tasks#^ship]]",
    "- [x] Done (09:00-09:25)",
    "  - [[Tasks#^ship]]",
  ].join("\n");
  const plugin = new Plugin();
  plugin.resolveTodayDailyFile = () => ({ path: "Daily.md" });
  plugin.resolveTaskFile = (path) => (path === "Tasks.md" ? { path: "Tasks.md" } : null);
  let written = null;
  plugin.app = {
    vault: {
      read: async (file) => (file.path === "Daily.md" ? dailyContent : null),
      modify: async (file, content) => {
        assert.equal(editor.getValue(), "- [/] #task Ship it ^ship");
        written = { path: file.path, content };
      },
    },
  };
  plugin.resolveReferenceDestination = (reference) =>
    reference.targetText === "Tasks" ? { path: "Tasks.md" } : null;
  plugin.suppressEditorScans = () => {};
  plugin.now = () => localDate(2026, 8, 15);

  const result = await plugin.submitPomodoroWorkSummary(source, "Finished cleanup");

  assert.equal(result, true);
  assert.deepEqual(written, {
    path: "Daily.md",
    content: [
      "## Pomodoros",
      "- [ ] Current (10:00-10:25)",
      "- [x] Done (09:00-09:25)",
      "  - [[Tasks#^ship]]",
    ].join("\n"),
  });
  assert.equal(
    editor.getValue(),
    [
      "- [/] #task Ship it ^ship",
      "\t- 🛠️ **WORK LOG**",
      "\t\t- *2026-08-15* — Finished cleanup",
    ].join("\n"),
  );
  assert.equal(lastNotice(), "Unlinked · stays In Progress · Work Log updated");
});

test("same-note Next unlink merges the Work Log and all-open cleanup in the active editor", async () => {
  resetNotices();
  const editor = createEditor(
    [
      "- [*] #task Ship it ^ship",
      "## Pomodoros",
      "- [ ] Current (10:00-10:25)",
      "  - [[#^ship]]",
      "- [ ] Later ()",
      "  - Keep [[#^ship]] and notes",
      "- [x] Done (09:00-09:25)",
      "  - [[#^ship]]",
    ].join("\n"),
  );
  editor.setCursor({ line: 0, ch: 9 });
  const source = {
    ...sourceForPomodoroLink(editor, "Daily.md", 0),
    file: { path: "Daily.md" },
  };
  const plugin = new Plugin();
  plugin.resolveTodayDailyFile = () => ({ path: "Daily.md" });
  plugin.resolveReferenceDestination = (reference) =>
    reference.targetText === "" ? { path: "Daily.md" } : null;
  plugin.suppressEditorScans = () => {};

  const result = await plugin.applyPomodoroTaskUnlink(source);

  assert.equal(result, true);
  assert.equal(
    editor.getValue(),
    [
      "- [*] #task Ship it ^ship",
      "## Pomodoros",
      "- [ ] Current (10:00-10:25)",
      "- [ ] Later ()",
      "  - Keep  and notes",
      "- [x] Done (09:00-09:25)",
      "  - [[#^ship]]",
    ].join("\n"),
  );
  assert.deepEqual(editor.cursor, { line: 0, ch: 9 });
  assert.equal(lastNotice(), "Unlinked · stays Next");
});

test("same-note In Progress unlink merges cleanup and Work Log in the active editor", async () => {
  resetNotices();
  const editor = createEditor(
    [
      "- [/] #task Ship it ^ship",
      "## Pomodoros",
      "- [ ] Current (10:00-10:25)",
      "  - [[#^ship]]",
      "- [x] Done (09:00-09:25)",
      "  - [[#^ship]]",
    ].join("\n"),
  );
  editor.setCursor({ line: 0, ch: 9 });
  const source = {
    ...sourceForPomodoroLink(editor, "Daily.md", 0),
    file: { path: "Daily.md" },
  };
  const plugin = new Plugin();
  plugin.resolveTodayDailyFile = () => ({ path: "Daily.md" });
  plugin.resolveReferenceDestination = (reference) =>
    reference.targetText === "" ? { path: "Daily.md" } : null;
  plugin.suppressEditorScans = () => {};
  plugin.now = () => localDate(2026, 8, 15);

  const result = await plugin.submitPomodoroWorkSummary(source, "Paused after tests");

  assert.equal(result, true);
  assert.equal(
    editor.getValue(),
    [
      "- [/] #task Ship it ^ship",
      "\t- 🛠️ **WORK LOG**",
      "\t\t- *2026-08-15* — Paused after tests",
      "## Pomodoros",
      "- [ ] Current (10:00-10:25)",
      "- [x] Done (09:00-09:25)",
      "  - [[#^ship]]",
    ].join("\n"),
  );
  assert.deepEqual(editor.cursor, { line: 0, ch: 9 });
  assert.equal(lastNotice(), "Unlinked · stays In Progress · Work Log updated");
});

test("Next unlink stops before any write when daily cleanup write is stale", async () => {
  resetNotices();
  const editor = createEditor("- [*] #task Ship it ^ship");
  const source = sourceForPomodoroLink(editor, "Tasks.md", 0);
  const plannedDaily = ["## Pomodoros", "- [ ] Current ()", "  - [[Tasks#^ship]]"].join("\n");
  const staleDaily = plannedDaily.replace("Current", "Current NOW");
  const plugin = new Plugin();
  plugin.resolveTodayDailyFile = () => ({ path: "Daily.md" });
  plugin.resolveTaskFile = (path) => (path === "Tasks.md" ? { path: "Tasks.md" } : null);
  let readCount = 0;
  let modifyCalled = false;
  plugin.app = {
    vault: {
      read: async () => {
        readCount += 1;
        return readCount === 1 ? plannedDaily : staleDaily;
      },
      modify: async () => {
        modifyCalled = true;
      },
    },
  };
  plugin.resolveReferenceDestination = () => ({ path: "Tasks.md" });
  plugin.suppressEditorScans = () => {};

  const result = await plugin.applyPomodoroTaskUnlink(source);

  assert.equal(result, false);
  assert.equal(modifyCalled, false);
  assert.equal(editor.getValue(), "- [*] #task Ship it ^ship");
  assert.equal(lastNotice(), "Unlink stopped: Daily.md changed before update");
});

test("Next unlink reports retryable partial failure when cleanup succeeds but the Work Log write is stale", async () => {
  resetNotices();
  const editor = createEditor("- [*] #task Ship it ^ship");
  const source = sourceForPomodoroLink(editor, "Tasks.md", 0);
  const dailyContent = ["## Pomodoros", "- [ ] Current ()", "  - [[Tasks#^ship]]"].join("\n");
  const plugin = new Plugin();
  plugin.resolveTodayDailyFile = () => ({ path: "Daily.md" });
  plugin.resolveTaskFile = (path) => (path === "Tasks.md" ? { path: "Tasks.md" } : null);
  let written = null;
  plugin.app = {
    vault: {
      read: async () => dailyContent,
      modify: async (file, content) => {
        written = { path: file.path, content };
        editor.replaceRange(
          "- [*] #task Ship it NOW ^ship",
          { line: 0, ch: 0 },
          { line: 0, ch: editor.getLine(0).length },
        );
      },
    },
  };
  plugin.resolveReferenceDestination = () => ({ path: "Tasks.md" });
  plugin.suppressEditorScans = () => {};

  const result = await plugin.applyPomodoroTaskUnlink(source, {
    workSummary: "Logged locally",
    workLogDate: WORK_LOG_DATE,
  });

  assert.equal(result, false);
  assert.deepEqual(written, {
    path: "Daily.md",
    content: ["## Pomodoros", "- [ ] Current ()", ""].join("\n"),
  });
  assert.equal(editor.getValue(), "- [*] #task Ship it NOW ^ship");
  assert.equal(lastNotice(), "Removed 1 open Pomodoro link, but task stays Next and work summary was not logged");
});

test("In Progress unlink reports retryable partial failure when cleanup succeeds but logging is stale", async () => {
  resetNotices();
  const editor = createEditor("- [/] #task Ship it ^ship");
  const source = sourceForPomodoroLink(editor, "Tasks.md", 0);
  const dailyContent = ["## Pomodoros", "- [ ] Current ()", "  - [[Tasks#^ship]]"].join("\n");
  const plugin = new Plugin();
  plugin.resolveTodayDailyFile = () => ({ path: "Daily.md" });
  plugin.resolveTaskFile = (path) => (path === "Tasks.md" ? { path: "Tasks.md" } : null);
  let written = null;
  plugin.app = {
    vault: {
      read: async () => dailyContent,
      modify: async (file, content) => {
        written = { path: file.path, content };
        editor.replaceRange(
          "- [/] #task Ship it NOW ^ship",
          { line: 0, ch: 0 },
          { line: 0, ch: editor.getLine(0).length },
        );
      },
    },
  };
  plugin.resolveReferenceDestination = () => ({ path: "Tasks.md" });
  plugin.suppressEditorScans = () => {};

  const result = await plugin.submitPomodoroWorkSummary(source, "Logged locally");

  assert.equal(result, false);
  assert.deepEqual(written, {
    path: "Daily.md",
    content: ["## Pomodoros", "- [ ] Current ()", ""].join("\n"),
  });
  assert.equal(editor.getValue(), "- [/] #task Ship it NOW ^ship");
  assert.equal(
    lastNotice(),
    "Removed 1 open Pomodoro link, but task stays In Progress and work summary was not logged",
  );
});

// --- Review-walk auto-advance (bip-link-today, block-id-prompt 1.22.0) ---

function installMockReviewWalk(plugin, calls) {
  const origin = { seq: 7 };
  const api = {
    version: 3,
    reviewWalk: {
      version: 1,
      capture(editor) {
        calls.push(["capture", editor]);
        return origin;
      },
      continue(passedOrigin, outcome) {
        calls.push(["continue", passedOrigin, outcome]);
        return Promise.resolve(
          Object.freeze({ ok: true, advanced: true, stopped: false }),
        );
      },
    },
  };
  plugin.app = plugin.app || {};
  plugin.app.plugins = { plugins: { "bob-navigation-hotkeys": { api } } };
  return { api, origin };
}

function reviewContinueCalls(calls) {
  return calls.filter((entry) => entry[0] === "continue");
}

test("review-walk: unlink settles with null and keeps its notice", async () => {
  const h = createTaskModeHarness({
    taskContent: "- [*] #task Ship it ^ship",
    dailyContent: LINKED_DAILY,
  });
  const calls = [];
  const { origin } = installMockReviewWalk(h.plugin, calls);

  await h.plugin.openPomodoroTaskLink(h.editor, h.view);

  assert.equal(lastNotice(), "Unlinked · stays Next");
  assert.deepEqual(reviewContinueCalls(calls), [["continue", origin, null]]);
});

// --- Inbox routing gate (link-toggle-gate, block-id-prompt 1.23.0) ---

function installUnlinkRoute(plugin, routeCalls, options = {}) {
  installMockInboxRoute(plugin, routeCalls, { inboxPaths: ["Tasks.md"], ...options });
}

function unlinkDaily() {
  return ["## Pomodoros", "- [ ] Current (10:00-10:25)", "  - [[Tasks#^ship]]"].join("\n");
}

function installUnlinkPlugin(routeCalls, routeOptions) {
  resetNotices();
  const editor = createEditor("- [*] #task Ship it ^ship");
  const source = sourceForPomodoroLink(editor, "Tasks.md", 0);
  const plugin = new Plugin();
  plugin.resolveTodayDailyFile = () => ({ path: "Daily.md" });
  plugin.resolveTaskFile = (path) => (path === "Tasks.md" ? { path: "Tasks.md" } : null);
  plugin.app = {
    vault: {
      read: async (file) => (file.path === "Daily.md" ? unlinkDaily() : null),
      modify: async () => {},
    },
  };
  plugin.resolveReferenceDestination = (reference) =>
    reference.targetText === "Tasks" ? { path: "Tasks.md" } : null;
  plugin.suppressEditorScans = () => {};
  installUnlinkRoute(plugin, routeCalls, routeOptions);
  return { plugin, editor, source };
}

test("inbox-route: unlink cancel writes nothing", async () => {
  const routeCalls = [];
  const { plugin, editor, source } = installUnlinkPlugin(routeCalls, {
    promptOutcome: { kind: "cancel" },
  });
  const before = editor.getValue();

  const result = await plugin.applyPomodoroTaskUnlink(source);

  assert.equal(result, false);
  assert.equal(editor.getValue(), before);
  assert.deepEqual(noticeMessages, []);
  assert.equal(
    routeCalls.filter((entry) => entry[0] === "prompt").length,
    1,
  );
  assert.deepEqual(
    routeCalls.filter((entry) => entry[0] === "commit"),
    [],
  );
});

test("inbox-route: unlink stay matches today and never commits", async () => {
  const routeCalls = [];
  const { plugin, source } = installUnlinkPlugin(routeCalls, {
    promptOutcome: { kind: "stay" },
  });

  const result = await plugin.applyPomodoroTaskUnlink(source);

  assert.equal(result, true);
  assert.equal(lastNotice(), "Unlinked · stays Next");
  const [promptCall] = routeCalls.filter((entry) => entry[0] === "prompt");
  assert.equal(promptCall[1].actionLabel, "unlink from today");
  assert.deepEqual(promptCall[1].reservedBlockIds, []);
  assert.deepEqual(
    routeCalls.filter((entry) => entry[0] === "commit"),
    [],
  );
});

test("inbox-route: unlink move unlinks, then moves, with one composed toast and a route continue", async () => {
  resetNotices();
  const editor = createEditor("- [*] #task Ship it ^ship");
  const source = sourceForPomodoroLink(editor, "Tasks.md", 0);
  const plugin = new Plugin();
  plugin.resolveTodayDailyFile = () => ({ path: "Daily.md" });
  plugin.resolveTaskFile = (path) => (path === "Tasks.md" ? { path: "Tasks.md" } : null);
  plugin.app = {
    vault: {
      read: async (file) => (file.path === "Daily.md" ? unlinkDaily() : null),
      modify: async () => {},
    },
  };
  plugin.resolveReferenceDestination = (reference) =>
    reference.targetText === "Tasks" ? { path: "Tasks.md" } : null;
  plugin.suppressEditorScans = () => {};
  const walkCalls = [];
  const { origin } = installMockReviewWalk(plugin, walkCalls);
  const routeCalls = [];
  installUnlinkRoute(plugin, routeCalls, {
    promptOutcome: { kind: "move", path: "health.md", name: "health" },
    commitResult: {
      ok: true,
      name: "health",
      count: 1,
      notice: "",
      handledRefs: [{ path: "Tasks.md", line: 0, raw: "- [*] #task Ship it ^ship" }],
      reason: null,
    },
  });
  source.reviewOrigin = origin;

  const result = await plugin.applyPomodoroTaskUnlink(source);

  assert.equal(result, true);
  assert.equal(editor.getValue(), "- [*] #task Ship it ^ship");
  const [commitCall] = routeCalls.filter((entry) => entry[0] === "commit");
  assert.equal(commitCall[1].destinationPath, "health.md");
  assert.deepEqual(commitCall[1].expected, [
    { line: 0, raw: "- [*] #task Ship it ^ship", blockId: "ship" },
  ]);
  assert.deepEqual(
    walkCalls.filter((entry) => entry[0] === "continue"),
    [
      [
        "continue",
        origin,
        {
          kind: "route",
          notice: "Unlinked · stays Next · moved to health",
          handledRefs: [{ path: "Tasks.md", line: 0, raw: "- [*] #task Ship it ^ship" }],
        },
      ],
    ],
  );
  assert.deepEqual(noticeMessages, []);
});

test("inbox-route: In Progress unlink with a Work summary routes", async () => {
  resetNotices();
  const editor = createEditor("- [/] #task Ship it ^ship");
  const source = sourceForPomodoroLink(editor, "Tasks.md", 0);
  const plugin = new Plugin();
  plugin.resolveTodayDailyFile = () => ({ path: "Daily.md" });
  plugin.resolveTaskFile = (path) => (path === "Tasks.md" ? { path: "Tasks.md" } : null);
  plugin.app = {
    vault: {
      read: async (file) => (file.path === "Daily.md" ? unlinkDaily() : null),
      modify: async () => {},
    },
  };
  plugin.resolveReferenceDestination = (reference) =>
    reference.targetText === "Tasks" ? { path: "Tasks.md" } : null;
  plugin.suppressEditorScans = () => {};
  plugin.now = () => localDate(2026, 8, 15);
  const routeCalls = [];
  installUnlinkRoute(plugin, routeCalls, {
    promptOutcome: { kind: "move", path: "health.md", name: "health" },
    commitResult: {
      ok: true,
      name: "health",
      count: 1,
      notice: "",
      handledRefs: [],
      reason: null,
    },
  });

  const result = await plugin.submitPomodoroWorkSummary(source, "Finished cleanup");

  assert.equal(result, true);
  const [promptCall] = routeCalls.filter((entry) => entry[0] === "prompt");
  assert.equal(promptCall[1].actionLabel, "unlink from today");
  assert.equal(
    lastNotice(),
    "Unlinked · stays In Progress · Work Log updated · moved to health",
  );
});

test("inbox-route: unlink move failure gives the partial notice and stays", async () => {
  const routeCalls = [];
  const { plugin, source } = installUnlinkPlugin(routeCalls, {
    promptOutcome: { kind: "move", path: "health.md", name: "health" },
    commitResult: {
      ok: false,
      name: "",
      count: 0,
      notice: "Not moved: health is closed · still in Tasks",
      handledRefs: [],
      reason: "health is closed",
    },
  });

  const result = await plugin.applyPomodoroTaskUnlink(source);

  assert.equal(result, true);
  assert.deepEqual(noticeMessages, [
    "Unlinked · stays Next",
    "Not moved: health is closed · still in Tasks",
  ]);
});

test("inbox-route: non-inbox unlink never prompts", async () => {
  const routeCalls = [];
  const { plugin, source } = installUnlinkPlugin(routeCalls, { inboxPaths: [] });

  const result = await plugin.applyPomodoroTaskUnlink(source);

  assert.equal(result, true);
  assert.equal(lastNotice(), "Unlinked · stays Next");
  assert.deepEqual(
    routeCalls.filter((entry) => entry[0] === "prompt"),
    [],
  );
});

test("review-walk: Work-summary unlink path retains origin until submit", async () => {
  const h = createTaskModeHarness({
    taskContent: "- [/] #task Ship it ^ship",
    dailyContent: LINKED_DAILY,
  });
  const calls = [];
  installMockReviewWalk(h.plugin, calls);
  let openedSource = null;
  h.plugin.openWorkSummaryPrompt = (source) => {
    openedSource = source;
    h.plugin.promptOpen = true;
  };

  await h.plugin.openPomodoroTaskLink(h.editor, h.view);

  assert.ok(openedSource);
  assert.ok(openedSource.reviewOrigin);
  assert.deepEqual(h.writes, []);
  assert.deepEqual(noticeMessages, []);
  assert.deepEqual(reviewContinueCalls(calls), []);
});

test("inbox-route: unlink source drift during route prompt refuses without writes", async () => {
  const routeCalls = [];
  const { plugin, editor, source } = installUnlinkPlugin(routeCalls, {
    taskContent: "- [ ] #task Ship it ^ship",
    prompt: (request) => {
      editor.replaceRange("- [ ] #task Replacement ^other\n", { line: 0, ch: 0 }, { line: 0, ch: 0 });
      return { kind: "move", path: "health.md", name: "health" };
    },
  });
  const result = await plugin.applyPomodoroTaskUnlink(source);
  assert.equal(result, false);
  assert.ok(String(editor.getValue() || "").includes("Ship it ^ship"));
  assert.ok(String(editor.getValue() || "").includes("- [ ] #task Replacement ^other"));
  assert.deepEqual(routeCalls.filter((e) => e[0] === "commit"), []);
});

test("inbox-route: Work-summary route cancel returns sentinel and settles null once", async () => {
  const h = createTaskModeHarness({
    taskContent: "- [/] #task Ship it ^ship",
    dailyContent: LINKED_DAILY,
    taskPath: "mac_inbox.md",
  });
  const calls = [];
  installMockReviewWalk(h.plugin, calls);
  const routeCalls = [];
  installMockInboxRoute(h.plugin, routeCalls, {
    inboxPaths: ["mac_inbox.md"],
    promptOutcome: { kind: "cancel" },
  });
  const source = sourceForPomodoroLink(h.editor, "mac_inbox.md", 0);
  const origin = { seq: 99 };
  source.reviewOrigin = origin;
  const before = h.editor.getValue();
  const result = await h.plugin.submitPomodoroWorkSummary(source, "Did work");
  assert.equal(result, "route-cancelled");
  assert.equal(h.editor.getValue(), before);
  const continues = calls.filter((e) => e[0] === "continue");
  assert.equal(continues.length, 1);
  assert.deepEqual(continues[0][2], null);
});

test("inbox-route: unlink no-op with move never commits", async () => {
  const routeCalls = [];
  const { plugin, source } = installUnlinkPlugin(routeCalls, {
    promptOutcome: { kind: "move", path: "health.md", name: "health" },
    commitResult: { ok: true, name: "health", count: 1, notice: "", handledRefs: [], reason: null },
  });
  const result = await plugin.finishPomodoroUnlinkWithInboxRoute(
    source,
    { hasChanges: false, removedCount: 0 },
    { hasChanges: false },
    "*",
    { kind: "move", path: "health.md", name: "health" },
  );
  assert.equal(result, true);
  assert.deepEqual(routeCalls.filter((e) => e[0] === "commit"), []);
});
