// Ctrl+Shift+P Depends-On adds consume the newly Blocked dependent's live
// Task Links in today's open Pomodoros (plan:202610/depends_on_consumes_today_links).
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  notices,
  NavigationHotkeysPlugin,
  TransactionEditor,
  compatibleTasksSettings,
  helpers,
} = require("./navigation-hotkeys-harness.cjs");

const PINNED = new Date(2026, 9, 14, 12);
const {
  planDependencyEdit,
  planCountedLocalTaskDependency,
  dependencyPlanPomodoroTargets,
  collectDependencyPlanPomodoroTargets,
  dependencyPomodoroNoticeSuffix,
  discoverCountedObsidianTaskTargets,
  getOpenLocalTasks,
  BulletPropertyPickerModal,
  validateBulletPropertyConfig,
} = helpers;

function dailyPath(date = PINNED) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}/${year}${month}${day}.md`;
}

function liveDailyPath() {
  return dailyPath(new Date());
}

function pomodoroDaily(rows) {
  return ["## Pomodoros", "", ...rows].join("\n");
}

function resetNotices() {
  notices.length = 0;
}

async function waitUntil(predicate, label, timeoutMs = 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(label || "timed out");
}

function createHarness(notes, options = {}) {
  const contents = new Map(Object.entries(notes));
  const files = [...contents.keys()]
    .filter((path) => /\.md$/i.test(path))
    .map((path) => ({ path, extension: "md" }));
  const openEditors = new Map(options.openEditors || []);
  const cachedReads = [];
  const processWrites = [];
  const settingsPath = ".obsidian/plugins/obsidian-tasks-plugin/data.json";
  const getContent = (path) => {
    const editor = openEditors.get(path);
    return editor ? editor.getValue() : contents.get(path);
  };
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: {
      getActiveFile: () => options.activeFile || null,
      getActiveViewOfType: () => null,
      getLeavesOfType: (type) =>
        type === "markdown"
          ? [...openEditors.entries()].map(([path, editor]) => ({
              view: { file: { path, extension: "md" }, editor },
            }))
          : [],
    },
    vault: {
      adapter: {
        read: async () => JSON.stringify(compatibleTasksSettings()),
      },
      getMarkdownFiles: () => files,
      getAbstractFileByPath: (path) =>
        contents.has(path) || path === settingsPath ? { path } : null,
      cachedRead: async (file) => {
        cachedReads.push(file.path);
        return getContent(file.path) === undefined
          ? ""
          : String(getContent(file.path));
      },
      read: async (file) => {
        if (file.path === settingsPath) {
          return JSON.stringify(compatibleTasksSettings());
        }
        return getContent(file.path) === undefined
          ? ""
          : String(getContent(file.path));
      },
      process: async (file, transform) => {
        processWrites.push(file.path);
        if (typeof options.mutateBeforeProcess === "function") {
          options.mutateBeforeProcess(file, contents);
        }
        const current = getContent(file.path) || "";
        const after = transform(current);
        contents.set(file.path, after);
        const editor = openEditors.get(file.path);
        if (editor) {
          editor.content = after;
        }
        return after;
      },
    },
    metadataCache: {
      getFirstLinkpathDest: (linkpath) => {
        const wanted = String(linkpath || "").split(/[|#]/, 1)[0].replace(/\.md$/i, "");
        if (!wanted) {
          return null;
        }
        const direct = `${wanted}.md`;
        if (contents.has(direct)) {
          return { path: direct };
        }
        const lowered = wanted.toLowerCase();
        const matches = [...contents.keys()].filter(
          (path) =>
            /\.md$/i.test(path) &&
            path.split("/").pop().replace(/\.md$/i, "").toLowerCase() === lowered,
        );
        return matches.length === 1 ? { path: matches[0] } : null;
      },
    },
  };
  plugin.getFreshnessStampLine = () => null;
  plugin.getFreshnessApi = () => ({
    markUnblockedLine(line) {
      return String(line);
    },
  });
  plugin.getActiveMarkdownView = () => {
    if (options.activeView) {
      return options.activeView;
    }
    const file = options.activeFile;
    if (file && openEditors.has(file.path)) {
      return { editor: openEditors.get(file.path), file };
    }
    return null;
  };
  return { plugin, contents, cachedReads, processWrites, openEditors, files };
}

function stubModal(plugin, editor, filePath, cursorLine) {
  const content = String(editor.getValue() || "");
  const lines = content.split(/\r?\n/);
  const cursor = { line: cursorLine, ch: 0 };
  const config = validateBulletPropertyConfig({
    properties: [{ name: "dependsOn", values: ["x"] }],
  });
  const modal = new BulletPropertyPickerModal(
    {},
    plugin,
    editor,
    cursor,
    String(lines[cursorLine] || ""),
    config,
    { filePath },
  );
  modal.filePath = filePath;
  return modal;
}

function ordinaryNote() {
  return ["- [ ] #task Parent ^parent", "- [ ] #task Target ^target"].join("\n");
}

function planOrdinary(overrides = {}) {
  const content = overrides.content || ordinaryNote();
  return planDependencyEdit({
    content,
    parentLine: overrides.parentLine === undefined ? 0 : overrides.parentLine,
    parentPath: overrides.parentPath || "Tasks.md",
    add: overrides.add || [{ path: "Tasks.md", blockId: "target" }],
    remove: overrides.remove || [],
    files: overrides.files || { "Tasks.md": content },
    mirrorTouch: overrides.mirrorTouch === true,
  });
}

test("planner: an ordinary dependent with a block id plus an open add yields one target", () => {
  const plan = planOrdinary();
  assert.equal(plan.ok, true, plan.reason);
  assert.deepEqual(plan.summary.pomodoroTargets, [
    { path: "Tasks.md", blockId: "parent" },
  ]);
});

test("planner: adding only a closed target yields none", () => {
  const content = [
    "- [ ] #task Parent ^parent",
    "- [x] #task Target ^target",
  ].join("\n");
  const plan = planOrdinary({ content, files: { "Tasks.md": content } });
  assert.equal(plan.ok, true, plan.reason);
  assert.deepEqual(plan.summary.pomodoroTargets, []);
});

test("planner: no block id yields none", () => {
  const content = ["- [ ] #task Parent", "- [ ] #task Target ^target"].join("\n");
  const plan = planOrdinary({ content, files: { "Tasks.md": content } });
  assert.equal(plan.ok, true, plan.reason);
  assert.deepEqual(plan.summary.pomodoroTargets, []);
});

test("planner: a dependent already [?] with an open add yields a target", () => {
  const content = [
    "- [?] #task Parent [dependsOn:: Tasks__a] ^parent",
    "  - ⛓️ **DEPENDS ON:** [[#^a]]",
    "- [ ] #task A [id:: Tasks__a] ^a",
    "- [ ] #task Target ^target",
  ].join("\n");
  const plan = planOrdinary({ content, files: { "Tasks.md": content } });
  assert.equal(plan.ok, true, plan.reason);
  assert.deepEqual(plan.summary.pomodoroTargets, [
    { path: "Tasks.md", blockId: "parent" },
  ]);
});

test("planner: a removal yields none", () => {
  const content = [
    "- [?] #task Parent [dependsOn:: Tasks__target] ^parent",
    "  - ⛓️ **DEPENDS ON:** [[#^target]]",
    "- [ ] #task Target [id:: Tasks__target] ^target",
  ].join("\n");
  const plan = planOrdinary({
    content,
    files: { "Tasks.md": content },
    add: [],
    remove: [{ path: "Tasks.md", blockId: "target" }],
  });
  assert.equal(plan.ok, true, plan.reason);
  assert.deepEqual(plan.summary.pomodoroTargets, []);
});

test("planner: mirrorTouch emits no ordinary consumption target", () => {
  const plan = planOrdinary({ mirrorTouch: true });
  assert.equal(plan.ok, true, plan.reason);
  assert.deepEqual(plan.summary.pomodoroTargets, []);
});

test("planner: ^prj keeps project targets and a deduplicated union", () => {
  const content = [
    "---",
    'type: "[[project]]"',
    "status: wip",
    "---",
    "",
    "- [ ] #task #prj Ship the project ^prj",
    "- [ ] #task Draft the pitch ^pitch",
  ].join("\n");
  const plan = planDependencyEdit({
    content,
    parentLine: 5,
    parentPath: "Project.md",
    add: [{ path: "job.md", blockId: "linkedin" }],
    remove: [],
    files: {
      "Project.md": content,
      "job.md": "- [ ] #task Fix LinkedIn now ^linkedin",
    },
  });
  assert.equal(plan.ok, true, plan.reason);
  assert.deepEqual(plan.summary.pomodoroTargets, []);
  const projectTargets = plan.summary.project.pomodoroTargets;
  assert.ok(projectTargets.some((target) => target.blockId === "prj"));
  assert.ok(projectTargets.some((target) => target.blockId === "pitch"));
  assert.deepEqual(dependencyPlanPomodoroTargets(plan), projectTargets);
  assert.deepEqual(collectDependencyPlanPomodoroTargets([plan]), projectTargets);
});

test("suffix helper names the removed count and the failed follow-up", () => {
  assert.equal(
    dependencyPomodoroNoticeSuffix(1, false),
    " · removed 1 Pomodoro link",
  );
  assert.equal(
    dependencyPomodoroNoticeSuffix(2, false),
    " · removed 2 Pomodoro links",
  );
  assert.equal(
    dependencyPomodoroNoticeSuffix(0, true),
    "; Pomodoro links not removed",
  );
  assert.equal(dependencyPomodoroNoticeSuffix(0, false), "");
});

test("applyDependencyEdit cross-file consumes live links and emptied entries", async () => {
  resetNotices();
  const parentNote = ordinaryNote();
  const datePath = dailyPath();
  const daily = pomodoroDaily([
    "- [ ] Current (0900-0930)",
    "  - [[Tasks#^parent]]",
    "    - notes",
    "  - leftover",
    "- [ ] Solo (0930-1000)",
    "  - [[Tasks#^parent]]",
    "- [x] Done (0800-0830)",
    "  - [[Tasks#^parent]]",
    "- [ ] Prose (1000-1030)",
    "  - see [[Tasks#^parent]] later",
    "- [ ] Struck (1030-1100)",
    "  - ~~[[Tasks#^parent]]~~",
  ]);
  const harness = createHarness({
    "Tasks.md": parentNote,
    [datePath]: daily,
  });
  const editor = new TransactionEditor(parentNote, { line: 0, ch: 0 });
  const outcome = await harness.plugin.applyDependencyEdit({
    editor,
    parentPath: "Tasks.md",
    parentLine: 0,
    add: [{ path: "Tasks.md", blockId: "target" }],
    remove: [],
    today: PINNED,
  });
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.match(editor.content, /- \[\?\] #task Parent/);
  const nextDaily = harness.contents.get(datePath);
  assert.ok(!nextDaily.includes("    - notes"), nextDaily);
  assert.ok(nextDaily.includes("leftover"), nextDaily);
  assert.ok(!nextDaily.includes("Solo (0930-1000)"), nextDaily);
  assert.match(nextDaily, /see .*later/);
  assert.ok(nextDaily.includes("- [x] Done (0800-0830)"), nextDaily);
  assert.ok(nextDaily.includes("~~[[Tasks#^parent]]~~"), nextDaily);
  assert.match(outcome.notice, /· removed \d+ Pomodoro link/);
});

test("applyDependencyEdit removes one live link and reports it", async () => {
  resetNotices();
  const parentNote = ordinaryNote();
  const datePath = dailyPath();
  const daily = pomodoroDaily([
    "- [ ] Current (0900-0930)",
    "  - [[Tasks#^parent]]",
  ]);
  const dailyEditor = new TransactionEditor(daily, { line: 0, ch: 0 });
  const harness = createHarness(
    { "Tasks.md": parentNote, [datePath]: daily },
    { openEditors: [[datePath, dailyEditor]] },
  );
  const editor = new TransactionEditor(parentNote, { line: 0, ch: 0 });
  const outcome = await harness.plugin.applyDependencyEdit({
    editor,
    parentPath: "Tasks.md",
    parentLine: 0,
    add: [{ path: "Tasks.md", blockId: "target" }],
    remove: [],
    today: PINNED,
  });
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.ok(!dailyEditor.content.includes("[[Tasks#^parent]]"));
  assert.ok(!dailyEditor.content.includes("Current (0900-0930)"));
  assert.match(outcome.notice, /· removed 1 Pomodoro link/);
});

test("applyDependencyEdit keeps the dependent write when the daily preimage changes", async () => {
  const parentNote = ordinaryNote();
  const datePath = dailyPath();
  const daily = pomodoroDaily([
    "- [ ] Current (0900-0930)",
    "  - [[Tasks#^parent]]",
  ]);
  const harness = createHarness(
    { "Tasks.md": parentNote, [datePath]: daily },
    {
      mutateBeforeProcess(file, contents) {
        if (file.path === datePath) {
          contents.set(datePath, `${contents.get(datePath)}\n<!-- concurrent -->`);
        }
      },
    },
  );
  const editor = new TransactionEditor(parentNote, { line: 0, ch: 0 });
  const outcome = await harness.plugin.applyDependencyEdit({
    editor,
    parentPath: "Tasks.md",
    parentLine: 0,
    add: [{ path: "Tasks.md", blockId: "target" }],
    remove: [],
    today: PINNED,
  });
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.match(editor.content, /- \[\?\] #task Parent/);
  assert.match(outcome.notice, /; Pomodoro links not removed/);
  assert.match(harness.contents.get(datePath), /\[\[Tasks#\^parent\]\]/);
  assert.match(harness.contents.get(datePath), /<!-- concurrent -->/);
});

test("same-file fold lands the dependency and the cleanup in one undo group", async () => {
  const datePath = dailyPath();
  const content = [
    "- [ ] #task Parent ^parent",
    "- [ ] #task Target ^target",
    "",
    "## Pomodoros",
    "",
    "- [ ] Current (0900-0930)",
    "  - [[#^parent]]",
  ].join("\n");
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  const harness = createHarness(
    { [datePath]: content },
    { activeFile: { path: datePath }, openEditors: [[datePath, editor]] },
  );
  const outcome = await harness.plugin.applyDependencyEdit({
    editor,
    parentPath: datePath,
    parentLine: 0,
    add: [{ path: datePath, blockId: "target" }],
    remove: [],
    today: PINNED,
  });
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.equal(editor.undoGroups, 1);
  assert.match(editor.content, /- \[\?\] #task Parent/);
  assert.ok(!editor.content.includes("Current (0900-0930)"));
  assert.match(outcome.notice, /· removed 1 Pomodoro link/);
});

test("setLocalTaskDependencyLink stays synchronous and folds same-file cleanup", () => {
  resetNotices();
  const datePath = liveDailyPath();
  const content = [
    "- [ ] #task Parent ^parent",
    "- [ ] #task Target ^target",
    "",
    "## Pomodoros",
    "",
    "- [ ] Current (0900-0930)",
    "  - [[#^parent]]",
  ].join("\n");
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  const harness = createHarness(
    { [datePath]: content },
    { activeFile: { path: datePath }, openEditors: [[datePath, editor]] },
  );
  const result = harness.plugin.setLocalTaskDependencyLink(
    editor,
    { line: 0, ch: 0 },
    "target",
    { filePath: datePath, linkBlockId: "target" },
  );
  assert.equal(result, true);
  assert.equal(editor.undoGroups, 1);
  assert.match(editor.content, /- \[\?\] #task Parent/);
  assert.ok(!editor.content.includes("Current (0900-0930)"));
  assert.match(notices.join("\n"), /· removed 1 Pomodoro link/);
});

test("setLocalTaskDependencyLink cross-file continuation removes the live link", async () => {
  resetNotices();
  const datePath = liveDailyPath();
  const parentNote = ordinaryNote();
  const daily = pomodoroDaily([
    "- [ ] Current (0900-0930)",
    "  - [[Tasks#^parent]]",
  ]);
  const editor = new TransactionEditor(parentNote, { line: 0, ch: 0 });
  const harness = createHarness(
    { "Tasks.md": parentNote, [datePath]: daily },
    { activeFile: { path: "Tasks.md" } },
  );
  harness.plugin.getActiveMarkdownView = () => ({
    editor,
    file: { path: "Tasks.md" },
  });
  const result = harness.plugin.setLocalTaskDependencyLink(
    editor,
    { line: 0, ch: 0 },
    "target",
    { filePath: "Tasks.md", linkBlockId: "target" },
  );
  assert.equal(result, true);
  assert.match(editor.content, /- \[\?\] #task Parent/);
  await waitUntil(
    () => !String(harness.contents.get(datePath) || "").includes("[[Tasks#^parent]]"),
    "cross-file setLocal did not consume the live link",
  );
  assert.match(notices.join("\n"), /· removed 1 Pomodoro link/);
});

test("same-note marked batch consumes every newly Blocked source", async () => {
  resetNotices();
  const datePath = liveDailyPath();
  const content = ordinaryNote();
  const daily = pomodoroDaily([
    "- [ ] Current (0900-0930)",
    "  - [[Tasks#^parent]]",
  ]);
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  const harness = createHarness({ "Tasks.md": content, [datePath]: daily });
  const modal = stubModal(harness.plugin, editor, "Tasks.md", 0);
  const applied = await modal.executeDependencyBatch({
    propertyName: "dependsOn",
    cursorLineText: "- [ ] #task Parent ^parent",
    removals: [],
    readyAdditions: [
      {
        markKey: "Tasks.md#1",
        path: "Tasks.md",
        line: 1,
        rawLine: "- [ ] #task Target ^target",
        displayText: "Target",
        existingIdField: null,
        blockId: "target",
      },
    ],
    promptQueue: [],
    promptIndex: 0,
    confirmedById: new Map(),
    reservedIds: new Set(),
    hasVault: false,
  });
  assert.equal(applied, true);
  assert.match(editor.content, /- \[\?\] #task Parent/);
  await waitUntil(
    () => !String(harness.contents.get(datePath) || "").includes("[[Tasks#^parent]]"),
    "marked batch did not consume the live link",
  );
  assert.match(notices.join("\n"), /· removed 1 Pomodoro link/);
});

test("counted same-note writer consumes every newly Blocked source", async () => {
  resetNotices();
  const datePath = liveDailyPath();
  const content = [
    "- [ ] #task One ^one",
    "- [ ] #task Two ^two",
    "- [ ] #task Target ^target",
  ].join("\n");
  const daily = pomodoroDaily([
    "- [ ] Current (0900-0930)",
    "  - [[Tasks#^one]]",
    "- [ ] Next (0930-1000)",
    "  - [[Tasks#^two]]",
  ]);
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  const file = { path: "Tasks.md", extension: "md" };
  const harness = createHarness(
    { "Tasks.md": content, [datePath]: daily },
    { activeFile: file },
  );
  harness.plugin.getActiveMarkdownView = () => ({ editor, file });
  const session = discoverCountedObsidianTaskTargets(content, 0, 1);
  const dependencyTask = getOpenLocalTasks(content).find(
    (task) => task.existingBlockId === "target",
  );
  const planned = planCountedLocalTaskDependency(
    content,
    session,
    dependencyTask,
    "Tasks.md",
  );
  assert.equal(planned.valid, true, planned.error);
  assert.equal(planned.pomodoroTargets.length, 2);
  assert.equal(
    await harness.plugin.applyCountedLocalTaskDependency(
      editor,
      { line: 0, ch: 0 },
      file.path,
      session,
      dependencyTask,
    ),
    true,
  );
  assert.match(editor.content, /- \[\?\] #task One/);
  assert.match(editor.content, /- \[\?\] #task Two/);
  await waitUntil(
    () => {
      const nextDaily = String(harness.contents.get(datePath) || "");
      return (
        !nextDaily.includes("[[Tasks#^one]]") &&
        !nextDaily.includes("[[Tasks#^two]]")
      );
    },
    "counted same-note writer did not consume live links",
  );
  assert.match(notices.join("\n"), /removed 2 Pomodoro links/);
});

test("counted vault writer consumes every newly Blocked source", async () => {
  resetNotices();
  const datePath = liveDailyPath();
  const content = [
    "- [ ] #task First ^first",
    "- [ ] #task Second ^second",
    "- [ ] #task Target ^target",
  ].join("\n");
  const daily = pomodoroDaily([
    "- [ ] Current (0900-0930)",
    "  - [[Tasks#^first]]",
    "- [ ] Next (0930-1000)",
    "  - [[Tasks#^second]]",
  ]);
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  const harness = createHarness({ "Tasks.md": content, [datePath]: daily });
  const modal = stubModal(harness.plugin, editor, "Tasks.md", 0);
  modal.taskSession = {
    valid: true,
    targets: [
      { line: 0, rawLine: "- [ ] #task First ^first" },
      { line: 1, rawLine: "- [ ] #task Second ^second" },
    ],
  };
  const applied = await modal.applyVaultCountedDependencyRef({
    path: "Tasks.md",
    line: 2,
    rawLine: "- [ ] #task Target ^target",
    displayText: "Target",
    existingIdField: null,
    blockId: "target",
  });
  assert.equal(applied, true);
  await waitUntil(
    () => {
      const nextDaily = String(harness.contents.get(datePath) || "");
      return (
        !nextDaily.includes("[[Tasks#^first]]") &&
        !nextDaily.includes("[[Tasks#^second]]")
      );
    },
    "counted vault writer did not consume live links",
  );
  assert.match(notices.join("\n"), /removed 2 Pomodoro links/);
});

test("counted ^prj source consumes its project targets", async () => {
  resetNotices();
  const datePath = liveDailyPath();
  const content = [
    "---",
    'type: "[[project]]"',
    "status: wip",
    "---",
    "",
    "- [ ] #task #prj Ship the project ^prj",
    "- [ ] #task Draft the pitch ^pitch",
  ].join("\n");
  const targetNote = "- [ ] #task Setup ^setup";
  const daily = pomodoroDaily([
    "- [ ] Current (0900-0930)",
    "  - [[Project#^prj]]",
    "- [ ] Next (0930-1000)",
    "  - [[Project#^pitch]]",
  ]);
  const editor = new TransactionEditor(content, { line: 5, ch: 0 });
  const harness = createHarness({
    "Project.md": content,
    "Target.md": targetNote,
    [datePath]: daily,
  });
  const modal = stubModal(harness.plugin, editor, "Project.md", 5);
  modal.taskSession = {
    valid: true,
    targets: [{ line: 5, rawLine: "- [ ] #task #prj Ship the project ^prj" }],
  };
  const applied = await modal.applyVaultCountedDependencyRef({
    path: "Target.md",
    line: 0,
    rawLine: targetNote,
    displayText: "Setup",
    existingIdField: null,
    blockId: "setup",
  });
  assert.equal(applied, true);
  await waitUntil(
    () => {
      const nextDaily = String(harness.contents.get(datePath) || "");
      return (
        !nextDaily.includes("[[Project#^prj]]") &&
        !nextDaily.includes("[[Project#^pitch]]")
      );
    },
    "counted ^prj writer did not consume project targets",
  );
});

test("a dependent without a block id does zero cachedReads even when today's daily exists", async () => {
  const content = ["- [ ] #task Parent", "- [ ] #task Target ^target"].join("\n");
  const datePath = dailyPath();
  const harness = createHarness({
    "Tasks.md": content,
    [datePath]: pomodoroDaily(["- [ ] Current (0900-0930)", "  - leftover"]),
  });
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  const outcome = await harness.plugin.applyDependencyEdit({
    editor,
    parentPath: "Tasks.md",
    parentLine: 0,
    add: [{ path: "Tasks.md", blockId: "target" }],
    remove: [],
    today: PINNED,
  });
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.equal(harness.cachedReads.length, 0);
});
