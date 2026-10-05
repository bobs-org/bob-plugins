const test = require("node:test");
const assert = require("node:assert/strict");
const {
  Plugin,
  noticeMessages,
  resetNotices,
  lastNotice,
  localDate,
  createEditor,
  sourceForPomodoroLink,
  createTFile,
  createMarkdownView,
  createTaskModeHarness,
  LINKED_DAILY,
  UNLINKED_DAILY,
} = require("./block-id-prompt-harness.cjs");

test("Ctrl+Shift+Enter is registered as the link-task-to-pomodoro command", () => {
  const plugin = new Plugin();
  const commands = [];
  plugin.addCommand = (command) => commands.push(command);
  plugin.registerEditorExtension = () => {};
  plugin.register = () => {};

  plugin.onload();

  assert.ok(commands.find((entry) => entry.id === "rename-selected-block-id"));

  const command = commands.find((entry) => entry.id === "link-task-to-pomodoro");
  assert.ok(command);
  assert.equal(command.name, "Toggle task Pomodoro link");
  assert.deepEqual(command.hotkeys, [{ modifiers: ["Ctrl", "Shift"], key: "Enter" }]);
  assert.equal(typeof command.editorCallback, "function");

  let calledWith = null;
  plugin.openPomodoroTaskLink = (editor, view) => {
    calledWith = [editor, view];
  };
  const fakeEditor = {};
  const fakeView = {};
  command.editorCallback(fakeEditor, fakeView);
  assert.deepEqual(calledWith, [fakeEditor, fakeView]);
});

test("resolvePomodoroLinkTaskFromEditor requires a single cursor", () => {
  const plugin = new Plugin();
  const editor = createEditor("- [ ] #task Ship it");
  assert.deepEqual(plugin.resolvePomodoroLinkTaskFromEditor(editor), {
    error: "No active Markdown task selected",
  });

  editor.setCursor({ line: 0, ch: 5 });
  editor.listSelections = () => [
    { head: { line: 0, ch: 5 } },
    { head: { line: 0, ch: 6 } },
  ];
  assert.deepEqual(plugin.resolvePomodoroLinkTaskFromEditor(editor), {
    error: "No active Markdown task selected",
  });
});

test("resolvePomodoroLinkTaskFromEditor rejects a cursor inside a fenced code block", () => {
  const plugin = new Plugin();
  const editor = createEditor(["```", "- [ ] #task Fake", "```"].join("\n"));
  editor.setCursor({ line: 1, ch: 2 });
  assert.deepEqual(plugin.resolvePomodoroLinkTaskFromEditor(editor), {
    error: "Cannot link a task inside a code block",
  });
});

test("resolvePomodoroLinkTaskFromEditor rejects a non-task line and a closed task", () => {
  const plugin = new Plugin();
  const paragraph = createEditor("Just a paragraph.");
  paragraph.setCursor({ line: 0, ch: 0 });
  assert.deepEqual(plugin.resolvePomodoroLinkTaskFromEditor(paragraph), {
    error: "No open task under cursor",
  });

  const closed = createEditor("- [x] #task Already done");
  closed.setCursor({ line: 0, ch: 0 });
  assert.deepEqual(plugin.resolvePomodoroLinkTaskFromEditor(closed), {
    error: "No open task under cursor",
  });
});

test("resolvePomodoroLinkTaskFromEditor accepts a #hide project task directly under the cursor", () => {
  const plugin = new Plugin();
  const editor = createEditor("- [ ] #task #hide Secret errand");
  editor.setCursor({ line: 0, ch: 0 });
  const result = plugin.resolvePomodoroLinkTaskFromEditor(editor);
  assert.ok(result.task);
  assert.equal(result.task.displayText, "Secret errand");
});

test("resolvePomodoroLinkTaskFromEditor rejects a block ID duplicated elsewhere in the same note", () => {
  const plugin = new Plugin();
  const editor = createEditor(
    ["- [ ] #task Ship it ^dup", "- [ ] #task Also uses it ^dup"].join("\n"),
  );
  editor.setCursor({ line: 0, ch: 0 });
  assert.deepEqual(plugin.resolvePomodoroLinkTaskFromEditor(editor), {
    error: "Block ID 'dup' is duplicated in this note",
  });
});

test("task-mode toggle decides on link presence: linked In Progress prompts, unlinked links and stays In Progress", async () => {
  const linked = createTaskModeHarness({
    taskContent: "- [/] #task Ship it ^ship",
    dailyContent: LINKED_DAILY,
  });
  let openedSource = null;
  linked.plugin.openWorkSummaryPrompt = (source) => {
    openedSource = source;
  };

  await linked.plugin.openPomodoroTaskLink(linked.editor, linked.view);

  assert.ok(openedSource);
  assert.equal(openedSource.task.status, "/");
  assert.equal(openedSource.task.existingId, "ship");
  assert.equal(linked.editor.getValue(), "- [/] #task Ship it ^ship");
  assert.deepEqual(linked.writes, []);
  assert.equal(noticeMessages.length, 0);

  const unlinked = createTaskModeHarness({
    taskContent: "- [/] #task Ship it ^ship",
    dailyContent: UNLINKED_DAILY,
  });
  let prompted = false;
  unlinked.plugin.openWorkSummaryPrompt = () => {
    prompted = true;
  };

  await unlinked.plugin.openPomodoroTaskLink(unlinked.editor, unlinked.view);

  assert.equal(prompted, false);
  assert.equal(unlinked.editor.getValue(), "- [/] #task Ship it ^ship");
  assert.equal(unlinked.writes.length, 1);
  assert.ok(unlinked.writes[0].content.includes("[[Tasks#^ship]]"));
  assert.equal(lastNotice(), "Linked · stays In Progress");
});

test("task-mode toggle: linked Next unlinks and stays Next; unlinked Next links and stays Next", async () => {
  const linked = createTaskModeHarness({
    taskContent: "- [*] #task Ship it ^ship",
    dailyContent: LINKED_DAILY,
  });
  let prompted = false;
  linked.plugin.openWorkSummaryPrompt = () => {
    prompted = true;
  };

  await linked.plugin.openPomodoroTaskLink(linked.editor, linked.view);

  assert.equal(prompted, false);
  assert.equal(linked.editor.getValue(), "- [*] #task Ship it ^ship");
  assert.deepEqual(linked.writes, [{ path: "Daily.md", content: `${UNLINKED_DAILY}\n` }]);
  assert.equal(lastNotice(), "Unlinked · stays Next");

  const unlinked = createTaskModeHarness({
    taskContent: "- [*] #task Ship it ^ship",
    dailyContent: UNLINKED_DAILY,
  });

  await unlinked.plugin.openPomodoroTaskLink(unlinked.editor, unlinked.view);

  assert.equal(unlinked.editor.getValue(), "- [*] #task Ship it ^ship");
  assert.equal(unlinked.writes.length, 1);
  assert.ok(unlinked.writes[0].content.includes("[[Tasks#^ship]]"));
  assert.equal(lastNotice(), "Linked · stays Next");
});

test("task-mode toggle: linked only under a completed Pomodoro links again", async () => {
  const historyOnly = [
    "## Pomodoros",
    "- [ ] Current (10:00-10:25)",
    "- [x] Done (09:00-09:25)",
    "  - [[Tasks#^ship]]",
  ].join("\n");
  const h = createTaskModeHarness({
    taskContent: "- [*] #task Ship it ^ship",
    dailyContent: historyOnly,
  });

  await h.plugin.openPomodoroTaskLink(h.editor, h.view);

  assert.equal(h.editor.getValue(), "- [*] #task Ship it ^ship");
  assert.equal(h.writes.length, 1);
  assert.ok(h.writes[0].content.includes("- [ ] Current (10:00-10:25)\n  - [[Tasks#^ship]]"));
  assert.ok(h.writes[0].content.includes("- [x] Done (09:00-09:25)\n  - [[Tasks#^ship]]"));
  assert.equal(lastNotice(), "Linked · stays Next");
});

test("task-mode toggle: a task without a block ID is never linked and prompts for one", async () => {
  const h = createTaskModeHarness({
    taskContent: "- [*] #task Ship it",
    dailyContent: LINKED_DAILY,
  });
  let promptedWith = null;
  h.plugin.openBlockIdPrompt = (source) => {
    promptedWith = source;
  };
  let dailyRead = false;
  const originalRead = h.plugin.app.vault.read;
  h.plugin.app.vault.read = async (target) => {
    dailyRead = true;
    return originalRead(target);
  };

  await h.plugin.openPomodoroTaskLink(h.editor, h.view);

  assert.ok(promptedWith);
  assert.equal(promptedWith.task.status, "*");
  assert.equal(dailyRead, false);
  assert.equal(h.editor.getValue(), "- [*] #task Ship it");
  assert.deepEqual(h.writes, []);
  assert.equal(noticeMessages.length, 0);
});

test("existing-ID Pomodoro link runtime: cross-note guarded write, canonical link, forced Next, and success notice", async () => {
  resetNotices();
  const editor = createEditor("- [?] #task Ship it [scheduled:: 2026-08-20] ^ship");
  const source = sourceForPomodoroLink(editor, "Tasks.md", 0);
  const dailyContent = ["## Pomodoros", "- [ ] Current (10:00-10:25)"].join("\n");
  const plugin = new Plugin();
  plugin.now = () => localDate(2026, 8, 15);
  plugin.resolveTodayDailyFile = () => ({ path: "Daily.md" });
  plugin.resolveTaskFile = (path) => (path === "Tasks.md" ? { path: "Tasks.md" } : null);
  let written = null;
  plugin.app = {
    vault: {
      read: async (file) => (file.path === "Daily.md" ? dailyContent : null),
      modify: async (file, content) => {
        written = { path: file.path, content };
      },
    },
    metadataCache: {
      fileToLinktext: (file) => file.path.replace(/\.md$/, ""),
    },
  };
  plugin.resolveReferenceDestination = () => null;
  plugin.suppressEditorScans = () => {};

  const result = await plugin.completePomodoroTaskLink(source, "ship");

  assert.equal(result, true);
  assert.equal(editor.getValue(), "- [*] #task Ship it ^ship");
  assert.ok(written);
  assert.equal(written.path, "Daily.md");
  assert.equal(
    written.content,
    ["## Pomodoros", "- [ ] Current (10:00-10:25)", "\t- [[Tasks#^ship]]"].join("\n"),
  );
  assert.equal(lastNotice(), "Linked · Next · removed future schedule");
});

test("new-ID Pomodoro link runtime: cross-note guarded write, appended ID stays final, forced Next for a Ready task", async () => {
  resetNotices();
  const editor = createEditor("- [ ] #task Ship it [priority:: high]");
  const source = sourceForPomodoroLink(editor, "Tasks.md", 0);
  const dailyContent = ["## Pomodoros", "- [ ] Later ()"].join("\n");
  const plugin = new Plugin();
  plugin.now = () => localDate(2026, 8, 15);
  plugin.resolveTodayDailyFile = () => ({ path: "Daily.md" });
  plugin.resolveTaskFile = (path) => (path === "Tasks.md" ? { path: "Tasks.md" } : null);
  let written = null;
  plugin.app = {
    vault: {
      read: async (file) => (file.path === "Daily.md" ? dailyContent : null),
      modify: async (file, content) => {
        written = { path: file.path, content };
      },
    },
    metadataCache: {
      fileToLinktext: (file) => file.path.replace(/\.md$/, ""),
    },
  };
  plugin.resolveReferenceDestination = () => null;
  plugin.suppressEditorScans = () => {};

  const result = await plugin.submitPomodoroTaskLinkBlockId(source, "ship");

  assert.equal(result, true);
  assert.equal(editor.getValue(), "- [*] #task Ship it [priority:: high] ^ship");
  assert.ok(written);
  assert.equal(
    written.content,
    ["## Pomodoros", "- [ ] Later ()", "\t- [[Tasks#^ship]]"].join("\n"),
  );
  assert.equal(lastNotice(), "Linked · Next");
});

test("submitPomodoroTaskLinkBlockId rejects a newly duplicated ID discovered at submit time", async () => {
  resetNotices();
  const editor = createEditor(["- [ ] #task Ship it", "- [ ] #task Other ^dup"].join("\n"));
  const source = sourceForPomodoroLink(editor, "Tasks.md", 0);

  const plugin = new Plugin();
  const result = await plugin.submitPomodoroTaskLinkBlockId(source, "dup");

  assert.equal(result, false);
  assert.equal(lastNotice(), "Block ID 'dup' already exists in Tasks.md");
});

test("submitPomodoroTaskLinkBlockId aborts when the task text changed while the modal was open", async () => {
  resetNotices();
  const editor = createEditor("- [ ] #task Ship it");
  const source = sourceForPomodoroLink(editor, "Tasks.md", 0);
  editor.replaceRange(
    "- [ ] #task Ship it NOW",
    { line: 0, ch: 0 },
    { line: 0, ch: editor.getLine(0).length },
  );

  const plugin = new Plugin();
  const result = await plugin.submitPomodoroTaskLinkBlockId(source, "ship");

  assert.equal(result, false);
  assert.equal(lastNotice(), "Task link blocked: selected task changed in Tasks.md");
});

test("same-note Pomodoro link runtime: task and ledger edits merge into one transaction", async () => {
  resetNotices();
  const editor = createEditor(
    [
      "- [?] #task Ship it [scheduled:: 2026-08-20] ^ship",
      "  - 🗓️ **SCHEDULE LOG**",
      "## Pomodoros",
      "- [ ] Current (10:00-10:25)",
    ].join("\n"),
  );
  const source = sourceForPomodoroLink(editor, "Daily.md", 0);
  const plugin = new Plugin();
  plugin.now = () => localDate(2026, 8, 15);
  plugin.resolveTodayDailyFile = () => ({ path: "Daily.md" });
  plugin.resolveTaskFile = (path) => (path === "Daily.md" ? { path: "Daily.md" } : null);
  plugin.resolveReferenceDestination = (reference) =>
    reference.targetText === "" ? { path: "Daily.md" } : null;
  plugin.suppressEditorScans = () => {};

  const result = await plugin.completePomodoroTaskLink(source, "ship");

  assert.equal(result, true);
  assert.equal(
    editor.getValue(),
    [
      "- [*] #task Ship it ^ship",
      "  - 🗓️ **SCHEDULE LOG**",
      "  \t- _2026-08-20 → 2026-08-15_ — 🍅 pulled into today's Pomodoro",
      "## Pomodoros",
      "- [ ] Current (10:00-10:25)",
      "\t- [[#^ship]]",
    ].join("\n"),
  );
  assert.equal(
    lastNotice(),
    "Linked · Next · removed future schedule · logged schedule change",
  );
});

test("linking an already-linked Ready task raises it to Next without duplicating the link", async () => {
  resetNotices();
  const editor = createEditor("- [ ] #task Ship it ^ship");
  const source = sourceForPomodoroLink(editor, "Tasks.md", 0);
  const dailyContent = ["## Pomodoros", "- [ ] Current (10:00-10:25)", "  - [[Tasks#^ship]]"].join(
    "\n",
  );
  const plugin = new Plugin();
  plugin.now = () => localDate(2026, 8, 15);
  plugin.resolveTodayDailyFile = () => ({ path: "Daily.md" });
  plugin.resolveTaskFile = (path) => (path === "Tasks.md" ? { path: "Tasks.md" } : null);
  let modifyCalled = false;
  plugin.app = {
    vault: {
      read: async (file) => (file.path === "Daily.md" ? dailyContent : null),
      modify: async () => {
        modifyCalled = true;
      },
    },
    metadataCache: {
      fileToLinktext: (file) => file.path.replace(/\.md$/, ""),
    },
  };
  plugin.resolveReferenceDestination = (reference) =>
    reference.targetText === "Tasks" ? { path: "Tasks.md" } : null;
  plugin.suppressEditorScans = () => {};

  const result = await plugin.completePomodoroTaskLink(source, "ship");

  assert.equal(result, true);
  assert.equal(modifyCalled, false);
  assert.equal(editor.getValue(), "- [*] #task Ship it ^ship");
  assert.equal(lastNotice(), "Linked · Next");
});

test("Next task without a block ID prompts for one instead of toggling", async () => {
  resetNotices();
  const editor = createEditor("- [*] #task Ship it [scheduled:: 2026-08-20]");
  editor.setCursor({ line: 0, ch: 4 });
  const file = createTFile("Tasks.md");
  const view = createMarkdownView(file);
  const plugin = new Plugin();
  let prompted = false;
  let dailyResolved = false;
  plugin.app = {
    workspace: {
      getActiveViewOfType: () => view,
      getActiveFile: () => file,
    },
  };
  plugin.openBlockIdPrompt = () => {
    prompted = true;
  };
  plugin.resolveTodayDailyFile = () => {
    dailyResolved = true;
    return null;
  };
  plugin.suppressEditorScans = () => {};

  await plugin.openPomodoroTaskLink(editor, view);

  assert.equal(prompted, true);
  assert.equal(dailyResolved, false);
  assert.notEqual(plugin.promptOpen, true);
  assert.equal(editor.getValue(), "- [*] #task Ship it [scheduled:: 2026-08-20]");
  assert.deepEqual(editor.cursor, { line: 0, ch: 4 });
  assert.equal(noticeMessages.length, 0);
});

test("Pomodoro link stops before any mutation when today's daily note is missing", async () => {
  resetNotices();
  const editor = createEditor("- [ ] #task Ship it ^ship");
  const before = editor.getValue();
  const source = sourceForPomodoroLink(editor, "Tasks.md", 0);
  const plugin = new Plugin();
  plugin.resolveTodayDailyFile = () => null;

  const result = await plugin.completePomodoroTaskLink(source, "ship");

  assert.equal(result, false);
  assert.equal(editor.getValue(), before);
  assert.equal(lastNotice(), "Task link blocked: today's daily note could not be found");
});

test("Pomodoro link stops before any task mutation when the daily note has no Pomodoros section", async () => {
  resetNotices();
  const editor = createEditor("- [ ] #task Ship it ^ship");
  const before = editor.getValue();
  const source = sourceForPomodoroLink(editor, "Tasks.md", 0);
  const plugin = new Plugin();
  plugin.resolveTodayDailyFile = () => ({ path: "Daily.md" });
  plugin.resolveTaskFile = (path) => (path === "Tasks.md" ? { path: "Tasks.md" } : null);
  let modifyCalled = false;
  plugin.app = {
    vault: {
      read: async () => "# Notes\nNothing here",
      modify: async () => {
        modifyCalled = true;
      },
    },
  };

  const result = await plugin.completePomodoroTaskLink(source, "ship");

  assert.equal(result, false);
  assert.equal(modifyCalled, false);
  assert.equal(editor.getValue(), before);
  assert.equal(lastNotice(), "Task link blocked: Daily.md has no Pomodoros section");
});

test("Pomodoro link stops before any task mutation when the daily note has multiple open timed Pomodoros", async () => {
  resetNotices();
  const editor = createEditor("- [ ] #task Ship it ^ship");
  const before = editor.getValue();
  const source = sourceForPomodoroLink(editor, "Tasks.md", 0);
  const plugin = new Plugin();
  plugin.resolveTodayDailyFile = () => ({ path: "Daily.md" });
  plugin.resolveTaskFile = (path) => (path === "Tasks.md" ? { path: "Tasks.md" } : null);
  let modifyCalled = false;
  plugin.app = {
    vault: {
      read: async () =>
        ["## Pomodoros", "- [ ] A (10:00-10:25)", "- [ ] B (11:00-11:25)"].join("\n"),
      modify: async () => {
        modifyCalled = true;
      },
    },
  };

  const result = await plugin.completePomodoroTaskLink(source, "ship");

  assert.equal(result, false);
  assert.equal(modifyCalled, false);
  assert.equal(editor.getValue(), before);
  assert.equal(
    lastNotice(),
    "Task link blocked: Daily.md has multiple open timed Pomodoros",
  );
});

test("Pomodoro link aborts without any write when the task line changed since it was selected", async () => {
  resetNotices();
  const editor = createEditor("- [ ] #task Ship it ^ship");
  const source = sourceForPomodoroLink(editor, "Tasks.md", 0);
  editor.replaceRange(
    "- [ ] #task Ship it NOW ^ship",
    { line: 0, ch: 0 },
    { line: 0, ch: editor.getLine(0).length },
  );
  const plugin = new Plugin();
  let dailyResolved = false;
  plugin.resolveTodayDailyFile = () => {
    dailyResolved = true;
    return { path: "Daily.md" };
  };

  const result = await plugin.completePomodoroTaskLink(source, "ship");

  assert.equal(result, false);
  assert.equal(dailyResolved, false);
  assert.equal(lastNotice(), "Task link blocked: selected task changed in Tasks.md");
});

test("Pomodoro link reports the exact partial result when the daily note write fails after the task write succeeds", async () => {
  resetNotices();
  const editor = createEditor("- [?] #task Ship it [scheduled:: 2026-08-20] ^ship");
  const source = sourceForPomodoroLink(editor, "Tasks.md", 0);
  const plannedDaily = ["## Pomodoros", "- [ ] Current (10:00-10:25)"].join("\n");
  const staleDaily = plannedDaily.replace("Current", "Current NOW");
  const plugin = new Plugin();
  plugin.now = () => localDate(2026, 8, 15);
  plugin.resolveTodayDailyFile = () => ({ path: "Daily.md" });
  plugin.resolveTaskFile = (path) => (path === "Tasks.md" ? { path: "Tasks.md" } : null);
  let readCount = 0;
  plugin.app = {
    vault: {
      read: async (file) => {
        if (file.path !== "Daily.md") {
          return null;
        }
        readCount += 1;
        return readCount === 1 ? plannedDaily : staleDaily;
      },
      modify: async () => {
        throw new Error("should not be called");
      },
    },
    metadataCache: {
      fileToLinktext: (file) => file.path.replace(/\.md$/, ""),
    },
  };
  plugin.resolveReferenceDestination = () => null;
  plugin.suppressEditorScans = () => {};

  const result = await plugin.completePomodoroTaskLink(source, "ship");

  assert.equal(result, false);
  assert.equal(editor.getValue(), "- [*] #task Ship it ^ship");
  assert.equal(lastNotice(), "Task unscheduled, set Next, but Daily.md could not be updated");
});

test("canceling the Pomodoro block-ID modal leaves the note untouched", () => {
  resetNotices();
  const editor = createEditor("- [ ] #task Ship it");
  const source = {
    kind: "link-task-pomodoro",
    editor,
    sourcePath: "Tasks.md",
    line: 0,
    task: { line: 0, rawLine: "- [ ] #task Ship it" },
  };
  const plugin = new Plugin();
  const before = editor.getValue();

  plugin.cancelBlockIdPrompt(source);

  assert.equal(editor.getValue(), before);
});
