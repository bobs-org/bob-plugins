const test = require("node:test");
const assert = require("node:assert/strict");
const {
  Plugin,
  helpers,
  lastNotice,
  resetNotices,
  localDate,
  createEditor,
  sourceForTaskPicker,
} = require("./block-id-prompt-harness.cjs");

const TODAY = localDate(2026, 10, 30);

function sourceForWikilink(editor, lineNumber) {
  const line = editor.getLine(lineNumber);
  const token = helpers.findTaskWikilinkToken(line, line.indexOf("ship") + 2);
  assert.ok(token, "expected a (( token");
  return {
    kind: "task-wikilink",
    trigger: "((",
    editor,
    sourcePath: "Daily.md",
    line: lineNumber,
    startCh: token.replaceStart,
    endCh: token.replaceEnd,
    replaceStart: token.replaceStart,
    replaceEnd: token.replaceEnd,
    raw: line.slice(token.replaceStart, token.replaceEnd),
    query: token.query,
  };
}

function makePomodoroRuntime(dailyContent, files) {
  const editor = createEditor(dailyContent);
  const store = { ...files };
  const writes = [];
  const dailyFile = { path: "Daily.md" };
  const fileByPath = new Map([
    [dailyFile.path, dailyFile],
    ...Object.keys(store).map((path) => [path, { path }]),
  ]);
  const plugin = new Plugin();
  plugin.now = () => TODAY;
  plugin.suppressEditorScans = () => {};
  plugin.refreshTaskWikilinkNote = () => {};
  plugin.getFreshnessStampLine = () => (line, date) => {
    const id = line.match(/([ \t]+\^[A-Za-z0-9-]+)$/);
    return id
      ? `${line.slice(0, -id[0].length)} [fresh:: ${date}]${id[0]}`
      : `${line} [fresh:: ${date}]`;
  };
  plugin.getFreshnessDateText = () => "2026-10-30";
  plugin.planBudgetNoticeSuffix = () => " · plan T/3 · L/10";
  plugin.resolveTaskFile = (path) => fileByPath.get(path) || null;
  plugin.resolveReferenceDestination = (reference, sourcePath) => {
    const target = typeof reference === "string"
      ? reference.split("#")[0]
      : reference && reference.targetText;
    if (!target) {
      return fileByPath.get(sourcePath) || null;
    }
    return fileByPath.get(target.endsWith(".md") ? target : `${target}.md`) || null;
  };
  plugin.app = {
    workspace: { getLeavesOfType: () => [] },
    vault: {
      getAbstractFileByPath: (path) => fileByPath.get(path) || null,
      read: async (file) => file.path === "Daily.md" ? editor.getValue() : store[file.path] ?? null,
      modify: async (file, content) => {
        store[file.path] = content;
        writes.push({ path: file.path, content });
      },
    },
    metadataCache: {
      getFirstLinkpathDest: (path) => fileByPath.get(path.endsWith(".md") ? path : `${path}.md`) || null,
    },
    plugins: { plugins: {} },
  };
  const documents = () => [
    { path: "Daily.md", text: editor.getValue() },
    ...Object.entries(store).map(([path, text]) => ({ path, text })),
  ];
  plugin.taskWikilinkPomodoroDocuments = async () => ({
    documents: documents(),
    failures: [],
  });
  plugin.readTaskDependencyDocuments = async () => ({
    documents: documents(),
    fileByPath,
    failures: [],
  });
  plugin.applyTargetTaskPlan = async (file, source, plan, expectedContent) => {
    const current = file.path === "Daily.md" ? editor.getValue() : store[file.path];
    if (current !== expectedContent) {
      return false;
    }
    if (file.path === "Daily.md") {
      throw new Error("fixture did not expect a dependency write to the daily note");
    }
    store[file.path] = plan.content;
    writes.push({ path: file.path, content: plan.content });
    return true;
  };
  return { plugin, editor, store, writes, fileByPath };
}

function taskRow(path, content, blockId) {
  const row = helpers.parseNoteTaskRows(
    path,
    content,
    helpers.defaultTaskWikilinkSettings(),
  ).find((candidate) => candidate.blockId === blockId);
  assert.ok(row, `expected ^${blockId} in ${path}`);
  return row;
}

test("Pomodoro (( picker limits the pool to open tasks and shows commit consequences", () => {
  const rows = helpers.parseNoteTaskRows(
    "Tasks.md",
    [
      "- [ ] #task Ship it [scheduled:: 2026-11-04] ^ship",
      "  - 🗓️ **SCHEDULE LOG**",
      "- [*] #task Review it ^review",
      "- [x] #task Already done ^done",
    ].join("\n"),
    helpers.defaultTaskWikilinkSettings(),
  );
  const selectedKey = helpers.taskWikilinkRowKey(rows[0]);
  const plan = helpers.buildTaskWikilinkPickerPlan({
    rows,
    ownerPath: "Daily.md",
    source: { sourcePath: "Daily.md" },
    selectedKey,
    progress: { ready: true, scanned: 3, total: 3 },
    pomodoroContext: { title: "FIX", range: "09:20–09:50" },
    pomodoroDetail: {
      scheduledDate: "Nov 4",
      scheduleLogPresent: true,
      typeClause: "type becomes FIX",
    },
  });

  assert.equal(plan.header.iconText, "🍅");
  assert.equal(plan.header.title, "Link a task to this Pomodoro");
  assert.match(plan.header.subtitle, /FIX · 09:20–09:50 · Ready tasks become Next/);
  assert.equal(plan.search.countText, "2 open tasks");
  assert.ok(!plan.items.some((item) => item.kind === "row" && item.row.blockId === "done"));
  assert.match(plan.selected.action.text, /pulls it into today \(was scheduled Nov 4\)/);
  assert.match(plan.selected.action.text, /logs the schedule change/);
  assert.match(plan.selected.action.text, /type becomes FIX/);

  const guarded = helpers.buildTaskWikilinkPickerPlan({
    rows,
    ownerPath: "Daily.md",
    source: { sourcePath: "Daily.md" },
    selectedKey,
    progress: { ready: true, scanned: 3, total: 3 },
    pomodoroContext: { title: "FIX", range: "09:20–09:50" },
    pomodoroDetail: { guardText: "Blocked by its project Projects/Launch.md · move the ^prj Schedule" },
  });
  assert.equal(guarded.selected.disabled, true);
  assert.match(guarded.selected.action.text, /Blocked by its project/);

  const waiting = helpers.taskWikilinkActionLine(rows[0], {
    pomodoroMode: true,
    pomodoroDetail: { waitingOn: 2 },
  });
  assert.match(waiting.text, /raises 2 prerequisites to Next · it stays unlinked/);
});

test("^^ under an open Pomodoro raises blocked prerequisites, leaves the task unlinked, and reverts the marker", async () => {
  resetNotices();
  const daily = [
    "## Pomodoros",
    "- [ ] Current (09:20-09:50)",
    "  - [[Tasks#^^]]",
  ].join("\n");
  const tasks = [
    "- [?] #task Apply for the role [dependsOn:: jobs__review] ^apply",
    "- [ ] #task Review the application [id:: jobs__review] ^review",
  ].join("\n");
  const h = makePomodoroRuntime(daily, { "Tasks.md": tasks });
  const source = sourceForTaskPicker(h.editor, "Daily.md", 2);
  source.trigger = "^^";
  const task = { ...taskRow("Tasks.md", tasks, "apply"), existingId: "apply" };

  const result = await h.plugin.selectTaskLinkTask(source, task);

  assert.deepEqual(result, { completed: true });
  assert.match(h.store["Tasks.md"], /^- \[\?\] #task Apply/m);
  assert.match(h.store["Tasks.md"], /^- \[\*\] #task Review/m);
  assert.match(h.editor.getValue(), /\[\[Tasks#\^\]\]/);
  assert.doesNotMatch(h.editor.getValue(), /\[\[Tasks#\^apply\]\]/);
  assert.match(lastNotice(), /raised 1 prerequisite to Next/);
  assert.match(lastNotice(), /no Pomodoro link created/);
});

test("^^ refuses a project-blocked task without consuming its prerequisites", async () => {
  resetNotices();
  const daily = [
    "## Pomodoros",
    "- [ ] Current (09:20-09:50)",
    "  - [[Tasks#^^]]",
  ].join("\n");
  const tasks = [
    "- [?] #task #prj_is_blocked Launch [dependsOn:: jobs__review] ^launch",
    "- [ ] #task Review the application [id:: jobs__review] ^review",
  ].join("\n");
  const h = makePomodoroRuntime(daily, { "Tasks.md": tasks });
  const source = sourceForTaskPicker(h.editor, "Daily.md", 2);
  source.trigger = "^^";
  const task = { ...taskRow("Tasks.md", tasks, "launch"), existingId: "launch" };

  const result = await h.plugin.selectTaskLinkTask(source, task);

  assert.equal(result, null);
  assert.equal(h.store["Tasks.md"], tasks);
  assert.match(h.editor.getValue(), /\[\[Tasks#\^\^\]\]/);
  assert.match(lastNotice(), /Project blocked/);
  assert.match(lastNotice(), /no Pomodoro link was created/);
});

test("^^ refuses a closed target under an open Pomodoro", async () => {
  resetNotices();
  const daily = [
    "## Pomodoros",
    "- [ ] Current (09:20-09:50)",
    "  - [[Tasks#^^]]",
  ].join("\n");
  const tasks = "- [x] #task Already done ^done";
  const h = makePomodoroRuntime(daily, { "Tasks.md": tasks });
  const source = sourceForTaskPicker(h.editor, "Daily.md", 2);
  source.trigger = "^^";
  const task = { ...taskRow("Tasks.md", tasks, "done"), existingId: "done" };

  const result = await h.plugin.selectTaskLinkTask(source, task);

  assert.equal(result, null);
  assert.equal(h.store["Tasks.md"], tasks);
  assert.match(h.editor.getValue(), /\[\[Tasks#\^\^\]\]/);
  assert.match(lastNotice(), /Closed tasks can't join a Pomodoro/);
});

test("ID-less (( selection names the task and completes through the shared Pomodoro commit", async () => {
  resetNotices();
  const daily = [
    "## Pomodoros",
    "- [ ] Current (09:20-09:50)",
    "  - ((ship))",
  ].join("\n");
  const tasks = [
    "- [ ] #task Ship it [scheduled:: 2026-11-04]",
    "  - 🗓️ **SCHEDULE LOG**",
  ].join("\n");
  const h = makePomodoroRuntime(daily, { "Tasks.md": tasks });
  const source = sourceForWikilink(h.editor, 2);
  const row = helpers.parseNoteTaskRows(
    "Tasks.md",
    tasks,
    helpers.defaultTaskWikilinkSettings(),
  )[0];

  const selected = await h.plugin.selectTaskLinkTask(source, row);
  assert.ok(selected.promptSource);
  assert.equal(selected.promptSource.pomodoroTarget.kind, "existing");
  const completed = await h.plugin.submitLinkTaskBlockId(selected.promptSource, "ship-it");

  assert.deepEqual(completed, { ok: true, completed: true });
  assert.match(h.store["Tasks.md"], /^- \[\*\] #task Ship it \[fresh:: 2026-10-30\] \^ship-it/m);
  assert.match(h.editor.getValue(), /\[\[Tasks#\^ship-it\]\]/);
  assert.match(lastNotice(), /removed future schedule/);
});

test("Pomodoro commit retypes, raises Ready, pulls a future schedule forward, logs it, and includes notices", async () => {
  resetNotices();
  const daily = [
    "## Pomodoros",
    "- [ ] Current (09:20-09:50)",
    "  - ((ship))",
  ].join("\n");
  const tasks = [
    "- [ ] #task Ship it [scheduled:: 2026-11-04] ^ship",
    "  - 🗓️ **SCHEDULE LOG**",
    "    - *2026-10-01* → *2026-10-05* · Pomodoro",
  ].join("\n");
  const h = makePomodoroRuntime(daily, { "Tasks.md": tasks });
  const suggestion = {
    theme: { key: "fix", name: "FIX", known: true, hue: "blue", hue_source: "hash" },
    source: "note",
    label: "from Tasks",
    from: { path: "Tasks.md", stem: "Tasks", kind: "area", chain: ["Tasks.md"], hue: "blue" },
  };
  h.plugin.app.plugins.plugins["bob-ledger-tools"] = {
    api: {
      themes: {
        version: 1,
        suggestFor: () => suggestion,
        planRetype: () => ({ kind: "set", name: "FIX", key: "fix" }),
        setTaskTheme: (line, name) => {
          const id = line.match(/([ \t]+\^[A-Za-z0-9-]+)$/);
          return id
            ? `${line.slice(0, -id[0].length)} [type:: ${name}]${id[0]}`
            : `${line} [type:: ${name}]`;
        },
        clearTaskTheme: (line) => line,
      },
    },
  };
  const source = sourceForWikilink(h.editor, 2);
  const row = taskRow("Tasks.md", tasks, "ship");

  const result = await h.plugin.taskWikilinkPomodoroCommit(source, row, { id: "ship" });

  assert.deepEqual(result, { ok: true, completed: true });
  assert.match(h.store["Tasks.md"], /^- \[\*\] #task Ship it \[type:: FIX\] \[fresh:: 2026-10-30\] \^ship/m);
  assert.doesNotMatch(h.store["Tasks.md"], /scheduled::/);
  assert.match(h.store["Tasks.md"], /_2026-11-04 → 2026-10-30_ — 🍅 pulled into today's Pomodoro/);
  assert.match(h.editor.getValue(), /\[\[Tasks#\^ship\]\]/);
  assert.match(lastNotice(), /type FIX/);
  assert.match(lastNotice(), /removed future schedule/);
  assert.match(lastNotice(), /set Next/);
  assert.match(lastNotice(), /logged schedule change/);
  assert.match(lastNotice(), /plan T\/3 · L\/10/);
});
