const test = require("node:test");
const assert = require("node:assert/strict");
const {
  Plugin,
  resetNotices,
  lastNotice,
  localDate,
  WORK_LOG_DATE,
  createEditor,
  sourceForPomodoroLink,
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
