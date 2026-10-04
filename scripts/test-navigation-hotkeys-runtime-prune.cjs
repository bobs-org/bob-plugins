const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  notices,
  NavigationHotkeysPlugin,
  helpers,
  TransactionEditor,
  compatibleTasksSettings,
} = require("./navigation-hotkeys-harness.cjs");

test("planCountedBulletPropertyBatch reports futureScheduledTaskLines for a mixed priority-roll batch", () => {
  const today = new Date();
  const todayValue = helpers.formatBulletPropertyDate(today);
  const year = String(today.getFullYear() + 5).padStart(4, "0");
  const source = [
    "- [ ] #task Future one ^future-one",
    "- [ ] #task Today ^today",
    "- [ ] #task Future two ^future-two",
    "- [ ] #task No block id",
  ].join("\n");
  const session = helpers.discoverCountedObsidianTaskTargets(source, 0, 3);
  const scheduledValueByLine = new Map([
    [0, `${year}-01-01`],
    [1, todayValue],
    [2, `${year}-01-02`],
    [3, `${year}-01-03`],
  ]);
  const plan = helpers.planCountedBulletPropertyBatch(
    source,
    session,
    "p",
    null,
    {
      operation: "set-priority",
      priorityValue: "🔺",
      scheduledPropertyName: "scheduled",
      scheduledValueByLine,
      today,
    },
  );
  assert.equal(plan.valid, true);
  assert.deepEqual(plan.futureScheduledTaskLines.slice().sort(), [0, 2, 3]);
});

test("planProjectTaskSchedules and planProjectScheduledUpdate report futureScheduledTaskLines including the ^prj line", () => {
  const today = new Date();
  const year = String(today.getFullYear() + 5).padStart(4, "0");
  const content = [
    "---",
    "type: [[project]]",
    "---",
    "- [ ] #task Ship #hide ^prj",
    "- [ ] #task Follows ^follows",
  ].join("\n");
  const propagation = helpers.planProjectTaskSchedules(
    content,
    `${year}-01-01`,
    today,
  );
  assert.equal(propagation.valid, true);
  assert.equal(propagation.future, true);
  assert.deepEqual(propagation.futureScheduledTaskLines.slice().sort(), [3, 4]);

  const update = helpers.planProjectScheduledUpdate(
    content,
    3,
    `${year}-01-01`,
    today,
  );
  assert.equal(update.valid, true);
  assert.deepEqual(update.futureScheduledTaskLines.slice().sort(), [3, 4]);
});

function getTodayDailyFile() {
  const today = new Date();
  const year = String(today.getFullYear()).padStart(4, "0");
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return { path: `${year}/${year}${month}${day}.md`, extension: "md" };
}

test("runtime: a future scheduled write prunes the task's live link from today's open Pomodoro", async () => {
  notices.length = 0;
  const line = "- [ ] #task Ship it ^ship";
  const editor = new TransactionEditor(line, { line: 0, ch: 0 }, 500);
  const sourceFile = { path: "Tasks.md", extension: "md" };
  const today = new Date();
  const year = String(today.getFullYear()).padStart(4, "0");
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  const dailyPath = `${year}/${year}${month}${day}.md`;
  const dailyFile = { path: dailyPath, extension: "md" };
  const dailyContent = [
    "## Pomodoros",
    "",
    "- [ ] Current (0900-0930)",
    "  - [[Tasks#^ship]]",
  ].join("\n");
  const contents = new Map([
    [sourceFile.path, line],
    [dailyFile.path, dailyContent],
  ]);
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getLeavesOfType: () => [] },
    vault: {
      getMarkdownFiles: () => [sourceFile, dailyFile],
      cachedRead: async (file) => contents.get(file.path),
      process: async (file, transform) => {
        contents.set(file.path, transform(contents.get(file.path)));
      },
      adapter: { read: async () => JSON.stringify(compatibleTasksSettings()) },
    },
  };
  plugin.getActiveMarkdownView = () => ({ editor, file: sourceFile });

  const futureDate = `${Number(year) + 5}-01-01`;
  assert.equal(
    await plugin.setBulletPropertyValue(
      editor,
      { line: 0, ch: 0 },
      "scheduled",
      futureDate,
      { filePath: sourceFile.path, expectedLine: line },
    ),
    true,
  );
  assert.match(editor.content, /\[\?\]/);
  assert.equal(
    contents.get(dailyFile.path),
    ["## Pomodoros", "", "- [ ] Current (0900-0930)"].join("\n"),
  );
  assert.match(notices.at(-1), /removed 1 Pomodoro link/);
});

test("runtime: a due (non-future) scheduled write does not touch today's Pomodoro links", async () => {
  notices.length = 0;
  const line = "- [?] #task Ship it [scheduled:: 2000-01-01] ^ship";
  const editor = new TransactionEditor(line, { line: 0, ch: 0 }, 500);
  const sourceFile = { path: "Tasks.md", extension: "md" };
  const today = new Date();
  const year = String(today.getFullYear()).padStart(4, "0");
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  const dailyPath = `${year}/${year}${month}${day}.md`;
  const dailyFile = { path: dailyPath, extension: "md" };
  const dailyContent = [
    "## Pomodoros",
    "",
    "- [ ] Current (0900-0930)",
    "  - [[Tasks#^ship]]",
  ].join("\n");
  const contents = new Map([
    [sourceFile.path, line],
    [dailyFile.path, dailyContent],
  ]);
  const plugin = new NavigationHotkeysPlugin();
  let processCalled = false;
  plugin.app = {
    workspace: { getLeavesOfType: () => [] },
    vault: {
      getMarkdownFiles: () => [sourceFile, dailyFile],
      cachedRead: async (file) => contents.get(file.path),
      process: async () => {
        processCalled = true;
      },
      adapter: { read: async () => JSON.stringify(compatibleTasksSettings()) },
    },
  };
  plugin.getActiveMarkdownView = () => ({ editor, file: sourceFile });

  assert.equal(
    await plugin.setBulletPropertyValue(
      editor,
      { line: 0, ch: 0 },
      "scheduled",
      "2000-01-01",
      { filePath: sourceFile.path, expectedLine: line },
    ),
    true,
  );
  assert.equal(processCalled, false);
  assert.equal(contents.get(dailyFile.path), dailyContent);
  assert.doesNotMatch(notices.at(-1), /Pomodoro link/);
});

test("runtime: no daily note today still writes the schedule with no Pomodoro chip", async () => {
  notices.length = 0;
  const line = "- [ ] #task Ship it ^ship";
  const editor = new TransactionEditor(line, { line: 0, ch: 0 }, 500);
  const sourceFile = { path: "Tasks.md", extension: "md" };
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getLeavesOfType: () => [] },
    vault: {
      getMarkdownFiles: () => [sourceFile],
      cachedRead: async () => line,
      adapter: { read: async () => JSON.stringify(compatibleTasksSettings()) },
    },
  };
  plugin.getActiveMarkdownView = () => ({ editor, file: sourceFile });

  assert.equal(
    await plugin.setBulletPropertyValue(
      editor,
      { line: 0, ch: 0 },
      "scheduled",
      "2099-01-01",
      { filePath: sourceFile.path, expectedLine: line },
    ),
    true,
  );
  assert.match(editor.content, /\[scheduled:: 2099-01-01\]/);
  assert.doesNotMatch(notices.at(-1), /Pomodoro link/);
});

test("runtime: daily note preimage changed under the snapshot keeps the schedule and reports not removed", async () => {
  notices.length = 0;
  const line = "- [ ] #task Ship it ^ship";
  const editor = new TransactionEditor(line, { line: 0, ch: 0 }, 500);
  const sourceFile = { path: "Tasks.md", extension: "md" };
  const dailyFile = getTodayDailyFile();
  const dailyContent = [
    "## Pomodoros",
    "",
    "- [ ] Current (0900-0930)",
    "  - [[Tasks#^ship]]",
  ].join("\n");
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getLeavesOfType: () => [] },
    vault: {
      getMarkdownFiles: () => [sourceFile, dailyFile],
      cachedRead: async (file) =>
        file.path === sourceFile.path ? line : `${dailyContent}\nchanged underfoot`,
      process: async () => {
        throw new Error("preimage check should reject before process runs");
      },
      adapter: { read: async () => JSON.stringify(compatibleTasksSettings()) },
    },
  };
  plugin.getActiveMarkdownView = () => ({ editor, file: sourceFile });
  const originalScheduledRecoveryDailyPaths = helpers.scheduledRecoveryDailyPaths;

  assert.equal(
    await plugin.setBulletPropertyValue(
      editor,
      { line: 0, ch: 0 },
      "scheduled",
      "2099-01-01",
      { filePath: sourceFile.path, expectedLine: line },
    ),
    true,
  );
  assert.match(editor.content, /\[scheduled:: 2099-01-01\]/);
  assert.match(notices.at(-1), /Pomodoro links not removed/);
});

test("runtime: vault.process throwing during the daily-note write is reported without throwing", async () => {
  notices.length = 0;
  const line = "- [ ] #task Ship it ^ship";
  const editor = new TransactionEditor(line, { line: 0, ch: 0 }, 500);
  const sourceFile = { path: "Tasks.md", extension: "md" };
  const dailyFile = getTodayDailyFile();
  const dailyContent = [
    "## Pomodoros",
    "",
    "- [ ] Current (0900-0930)",
    "  - [[Tasks#^ship]]",
  ].join("\n");
  const contents = new Map([
    [sourceFile.path, line],
    [dailyFile.path, dailyContent],
  ]);
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getLeavesOfType: () => [] },
    vault: {
      getMarkdownFiles: () => [sourceFile, dailyFile],
      cachedRead: async (file) => contents.get(file.path),
      process: async () => {
        throw new Error("injected vault.process failure");
      },
      adapter: { read: async () => JSON.stringify(compatibleTasksSettings()) },
    },
  };
  plugin.getActiveMarkdownView = () => ({ editor, file: sourceFile });

  assert.equal(
    await plugin.setBulletPropertyValue(
      editor,
      { line: 0, ch: 0 },
      "scheduled",
      "2099-01-01",
      { filePath: sourceFile.path, expectedLine: line },
    ),
    true,
  );
  assert.match(editor.content, /\[scheduled:: 2099-01-01\]/);
  assert.equal(contents.get(dailyFile.path), dailyContent);
  assert.match(notices.at(-1), /Pomodoro links not removed/);
});

test("runtime: the daily note open in another editor is written through that editor in its own transaction", async () => {
  notices.length = 0;
  const line = "- [ ] #task Ship it ^ship";
  const editor = new TransactionEditor(line, { line: 0, ch: 0 }, 500);
  const sourceFile = { path: "Tasks.md", extension: "md" };
  const dailyFile = getTodayDailyFile();
  const dailyContent = [
    "## Pomodoros",
    "",
    "- [ ] Current (0900-0930)",
    "  - [[Tasks#^ship]]",
  ].join("\n");
  const dailyEditor = new TransactionEditor(dailyContent, { line: 3, ch: 0 }, 900);
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getLeavesOfType: () => [] },
    vault: {
      getMarkdownFiles: () => [sourceFile, dailyFile],
      cachedRead: async () => {
        throw new Error("open editors should not use vault.cachedRead");
      },
      process: async () => {
        throw new Error("open editors should not use vault.process");
      },
      adapter: { read: async () => JSON.stringify(compatibleTasksSettings()) },
    },
  };
  plugin.getActiveMarkdownView = () => ({ editor, file: sourceFile });
  plugin.getOpenMarkdownEditorForPath = (path) =>
    path === sourceFile.path
      ? editor
      : path === dailyFile.path
        ? dailyEditor
        : null;

  assert.equal(
    await plugin.setBulletPropertyValue(
      editor,
      { line: 0, ch: 0 },
      "scheduled",
      "2099-01-01",
      { filePath: sourceFile.path, expectedLine: line },
    ),
    true,
  );
  assert.equal(dailyEditor.transactions.length, 1);
  assert.equal(dailyEditor.undoGroups, 1);
  assert.equal(
    dailyEditor.content,
    ["## Pomodoros", "", "- [ ] Current (0900-0930)"].join("\n"),
  );
  assert.match(notices.at(-1), /removed 1 Pomodoro link/);
});

test("runtime: re-running the same deferral gesture is idempotent", async () => {
  notices.length = 0;
  const line = "- [?] #task Ship it [scheduled:: 2099-01-01] ^ship";
  const editor = new TransactionEditor(line, { line: 0, ch: 0 }, 500);
  const sourceFile = { path: "Tasks.md", extension: "md" };
  const dailyFile = getTodayDailyFile();
  const dailyContent = ["## Pomodoros", "", "- [ ] Current (0900-0930)"].join("\n");
  const contents = new Map([
    [sourceFile.path, line],
    [dailyFile.path, dailyContent],
  ]);
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getLeavesOfType: () => [] },
    vault: {
      getMarkdownFiles: () => [sourceFile, dailyFile],
      cachedRead: async (file) => contents.get(file.path),
      process: async (file, transform) => {
        contents.set(file.path, transform(contents.get(file.path)));
      },
      adapter: { read: async () => JSON.stringify(compatibleTasksSettings()) },
    },
  };
  plugin.getActiveMarkdownView = () => ({ editor, file: sourceFile });

  assert.equal(
    await plugin.setBulletPropertyValue(
      editor,
      { line: 0, ch: 0 },
      "scheduled",
      "2099-01-01",
      { filePath: sourceFile.path, expectedLine: line },
    ),
    true,
  );
  assert.equal(contents.get(dailyFile.path), dailyContent);
  assert.doesNotMatch(notices.at(-1), /Pomodoro link/);
});

test("runtime: a counted scheduled batch prunes exactly the targets that land on a future date", async () => {
  notices.length = 0;
  const today = new Date();
  const year = String(today.getFullYear() + 5).padStart(4, "0");
  const source = [
    "- [ ] #task One ^one",
    "- [ ] #task Two ^two",
    "- [ ] #task Three ^three",
  ].join("\n");
  const editor = new TransactionEditor(source, { line: 0, ch: 0 }, 500);
  const sourceFile = { path: "Tasks.md", extension: "md" };
  const dailyFile = getTodayDailyFile();
  const dailyContent = [
    "## Pomodoros",
    "",
    "- [ ] Current (0900-0930)",
    "  - [[Tasks#^one]]",
    "  - [[Tasks#^two]]",
    "  - [[Tasks#^three]]",
  ].join("\n");
  const contents = new Map([
    [sourceFile.path, source],
    [dailyFile.path, dailyContent],
  ]);
  const session = helpers.discoverCountedObsidianTaskTargets(source, 0, 1);
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getLeavesOfType: () => [] },
    vault: {
      getMarkdownFiles: () => [sourceFile, dailyFile],
      cachedRead: async (file) => contents.get(file.path),
      process: async (file, transform) => {
        contents.set(file.path, transform(contents.get(file.path)));
      },
      adapter: { read: async () => JSON.stringify(compatibleTasksSettings()) },
    },
  };
  plugin.getActiveMarkdownView = () => ({ editor, file: sourceFile });

  assert.equal(
    await plugin.setCountedBulletPropertyValue(
      editor,
      { line: 0, ch: 0 },
      sourceFile.path,
      session,
      "scheduled",
      `${year}-01-01`,
    ),
    true,
  );
  assert.equal(
    contents.get(dailyFile.path),
    ["## Pomodoros", "", "- [ ] Current (0900-0930)", "  - [[Tasks#^three]]"].join(
      "\n",
    ),
  );
  assert.match(notices.at(-1), /removed 2 Pomodoro links/);
});

test("runtime: a ^prj project schedule prunes the propagated tasks and the ^prj link itself", async () => {
  notices.length = 0;
  const today = new Date();
  const year = String(today.getFullYear() + 5).padStart(4, "0");
  const input = [
    "---",
    "type: [[project]]",
    "scheduled: 2000-01-01",
    "---",
    "- [ ] #task Ship #hide ^prj",
    "- [ ] #task Follows ^follows",
  ].join("\n");
  const cursor = { line: 4, ch: 0 };
  const editor = new TransactionEditor(input, cursor, 700);
  const sourceFile = { path: "projects/Ship.md", extension: "md" };
  const dailyFile = getTodayDailyFile();
  const dailyContent = [
    "## Pomodoros",
    "",
    "- [ ] Current (0900-0930)",
    "  - [[projects/Ship#^prj]]",
    "  - [[projects/Ship#^follows]]",
  ].join("\n");
  const contents = new Map([
    [sourceFile.path, input],
    [dailyFile.path, dailyContent],
  ]);
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getLeavesOfType: () => [] },
    vault: {
      getMarkdownFiles: () => [sourceFile, dailyFile],
      cachedRead: async (file) => contents.get(file.path),
      process: async (file, transform) => {
        contents.set(file.path, transform(contents.get(file.path)));
      },
      adapter: { read: async () => JSON.stringify(compatibleTasksSettings()) },
    },
  };
  plugin.getActiveMarkdownView = () => ({ editor, file: sourceFile });

  assert.equal(
    await plugin.setProjectNoteScheduledValue(
      editor,
      cursor,
      sourceFile.path,
      input.split(/\r?\n/)[4],
      "2000-01-01",
      `${year}-01-01`,
    ),
    true,
  );
  assert.equal(
    contents.get(dailyFile.path),
    ["## Pomodoros", "", "- [ ] Current (0900-0930)"].join("\n"),
  );
  assert.match(notices.at(-1), /removed 2 Pomodoro links/);
});

test("runtime: the source note being today's daily note folds the prune into a single editor transaction", async () => {
  notices.length = 0;
  const content = [
    "## Pomodoros",
    "",
    "- [ ] Current (0900-0930)",
    "  - [[#^linked]]",
    "",
    "## Tasks",
    "",
    "- [ ] #task Linked elsewhere ^linked",
  ].join("\n");
  const cursor = { line: 7, ch: 0 };
  const editor = new TransactionEditor(content, cursor, 500);
  const dailyFile = getTodayDailyFile();
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getLeavesOfType: () => [] },
    vault: {
      getMarkdownFiles: () => [dailyFile],
      cachedRead: async () => content,
      adapter: { read: async () => JSON.stringify(compatibleTasksSettings()) },
    },
  };
  plugin.getActiveMarkdownView = () => ({ editor, file: dailyFile });

  assert.equal(
    await plugin.setBulletPropertyValue(
      editor,
      cursor,
      "scheduled",
      "2099-01-01",
      {
        filePath: dailyFile.path,
        expectedLine: content.split(/\r?\n/)[7],
      },
    ),
    true,
  );
  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.undoGroups, 1);
  assert.equal(
    editor.content,
    [
      "## Pomodoros",
      "",
      "- [ ] Current (0900-0930)",
      "",
      "## Tasks",
      "",
      "- [?] #task Linked elsewhere [scheduled:: 2099-01-01] ^linked",
    ].join("\n"),
  );
  assert.match(notices.at(-1), /removed 1 Pomodoro link/);
});

