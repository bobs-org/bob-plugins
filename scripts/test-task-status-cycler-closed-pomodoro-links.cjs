const test = require("node:test");
const assert = require("node:assert/strict");
const {
  TaskStatusCyclerPlugin,
  helpers,
  notices,
  createInMemoryObsidianApp,
  createTextEditor,
  attachActiveMarkdownView,
  registerTaskToggleVimAction,
  flushAsyncActions,
} = require("./task-status-cycler-harness.cjs");

const CLOSED_POMODORO = "- [x] (**0920-0950** [t:: 30m]) — DEEP";
const OPEN_PLACEHOLDER = "- [ ] ()";
const WORK_LOG_CHILD = "\t\t- worked on it";

function closedDaily(linkLine, extraLines = []) {
  return [
    "## Pomodoros",
    CLOSED_POMODORO,
    linkLine,
    WORK_LOG_CHILD,
    ...extraLines,
    OPEN_PLACEHOLDER,
  ].join("\n");
}

function linkCh(lineText, needle = "[[") {
  const index = String(lineText).indexOf(needle);
  assert.ok(index >= 0, `expected ${needle} in ${lineText}`);
  return index + 2;
}

async function runClosedLinkToggle(options) {
  const daily = options.daily;
  const cursor = options.cursor;
  const files = { "Daily.md": daily, ...(options.files || {}) };
  const harness = createInMemoryObsidianApp(files);
  const editor = createTextEditor(daily, cursor);
  const plugin = new TaskStatusCyclerPlugin();
  plugin.getCompletionDateString = () => "2026-07-16";
  plugin.scheduleCenterEditorLineInView = () => {};
  if (typeof options.install === "function") {
    options.install(plugin, harness, editor);
  }
  attachActiveMarkdownView(plugin, harness, editor, options.path || "Daily.md");
  const action = registerTaskToggleVimAction(plugin);
  const beforeCursor = editor.getCursor();
  action({});
  await flushAsyncActions();
  await plugin.referenceMutationQueue;
  await flushAsyncActions();
  await plugin.referenceMutationQueue;
  assert.equal(editor.getCursor().line, beforeCursor.line);
  assert.equal(editor.getCursor().ch, beforeCursor.ch);
  return { harness, editor, plugin, action, beforeCursor };
}

function assertFrozenPomodoro(editor, label) {
  assert.equal(editor.getLine(1), CLOSED_POMODORO, label);
  assert.equal(editor.getLine(3), WORK_LOG_CHILD, `${label}: work-log child`);
  assert.equal(editor.getLine(editor.lineCount() - 1), OPEN_PLACEHOLDER, `${label}: placeholder`);
}

test("closed-entry Ctrl+Enter closes Ready/Next/In Progress targets and drops 🍅", async () => {
  for (const symbol of [" ", "*", "/"]) {
    for (const [linkLine, files, closedPattern] of [
      [
        "\t- 🍅 [[Tasks#^a|Alias]]",
        { "Tasks.md": `- [${symbol}] #task A ^a` },
        /^- \[x\] #task A .*\[completion:: 2026-07-16\] \^a/m,
      ],
      [
        "\t- 🍅 [[#^a|Alias]]",
        {},
        /^- \[x\] #task Same-file .*\[completion:: 2026-07-16\] \^a/m,
      ],
    ]) {
      const extra = files["Tasks.md"] ? [] : ["- [ ] #task Same-file ^a"];
      const daily = closedDaily(linkLine, extra);
      const { editor, harness } = await runClosedLinkToggle({
        daily,
        cursor: { line: 2, ch: linkCh(linkLine) },
        files,
      });
      const label = `[${symbol}] ${linkLine}`;
      assertFrozenPomodoro(editor, label);
      assert.equal(
        editor.getLine(2),
        linkLine.includes("Tasks")
          ? "\t- ~~[[Tasks#^a|Alias]]~~"
          : "\t- ~~[[#^a|Alias]]~~",
        label,
      );
      const source = files["Tasks.md"]
        ? harness.getSource("Tasks.md")
        : editor.getValue();
      assert.match(source, closedPattern, label);
    }
  }
});

test("closed-entry round trip restores 🍅 and a missing marker is added on reopen", async () => {
  const marked = "\t- 🍅 [[Tasks#^a|Alias]]";
  const daily = closedDaily(marked);
  const { editor, harness, plugin, action } = await runClosedLinkToggle({
    daily,
    cursor: { line: 2, ch: linkCh(marked) },
    files: { "Tasks.md": "- [ ] #task A ^a" },
  });
  assert.equal(editor.getLine(2), "\t- ~~[[Tasks#^a|Alias]]~~");
  assert.match(harness.getSource("Tasks.md"), /^- \[x\] #task A/m);

  action({});
  await flushAsyncActions();
  await plugin.referenceMutationQueue;
  await flushAsyncActions();
  await plugin.referenceMutationQueue;

  assertFrozenPomodoro(editor, "reopen marked");
  assert.equal(editor.getLine(2), "\t- 🍅 [[Tasks#^a|Alias]]");
  assert.match(harness.getSource("Tasks.md"), /^- \[ \] #task A \^a/m);

  const struckDaily = closedDaily("\t- ~~[[Tasks#^a|Alias]]~~");
  const second = await runClosedLinkToggle({
    daily: struckDaily,
    cursor: { line: 2, ch: linkCh("\t- ~~[[Tasks#^a|Alias]]~~") },
    files: { "Tasks.md": "- [x] #task A [completion:: 2026-07-16] ^a" },
  });
  assert.equal(second.editor.getLine(2), "\t- 🍅 [[Tasks#^a|Alias]]");
  assert.match(second.harness.getSource("Tasks.md"), /^- \[ \] #task A \^a/m);

  const markedStruck = closedDaily("\t- 🍅 ~~[[Tasks#^a|Alias]]~~");
  const third = await runClosedLinkToggle({
    daily: markedStruck,
    cursor: { line: 2, ch: linkCh("\t- 🍅 ~~[[Tasks#^a|Alias]]~~") },
    files: { "Tasks.md": "- [x] #task A [completion:: 2026-07-16] ^a" },
  });
  assert.equal(third.editor.getLine(2), "\t- 🍅 [[Tasks#^a|Alias]]");
});

test("closed-entry mixed line strikes only the cursor link", async () => {
  const mixed = "\t- 🍅 [[Tasks#^a|A]] and 🍅 [[Tasks#^b|B]]";
  const daily = closedDaily(mixed);
  const { editor, harness, beforeCursor } = await runClosedLinkToggle({
    daily,
    cursor: { line: 2, ch: linkCh(mixed, "[[Tasks#^b") },
    files: {
      "Tasks.md": ["- [ ] #task A ^a", "- [ ] #task B ^b"].join("\n"),
    },
  });
  assertFrozenPomodoro(editor, "mixed");
  assert.equal(editor.getLine(2), "\t- 🍅 [[Tasks#^a|A]] and ~~[[Tasks#^b|B]]~~");
  assert.match(harness.getSource("Tasks.md"), /^- \[ \] #task A \^a/m);
  assert.match(harness.getSource("Tasks.md"), /^- \[x\] #task B/m);
  assert.equal(editor.getCursor().line, beforeCursor.line);
  assert.equal(editor.getCursor().ch, beforeCursor.ch);
});

test("closed-entry embedded close and reopen", async () => {
  const embedded = "\t- ![[Tasks#^root|Root]]";
  const tree = [
    "- [ ] #task Root ^root",
    "\t- ![[#^child]]",
    "- [ ] #task Child ^child",
  ].join("\n");
  const { editor, harness, plugin, action } = await runClosedLinkToggle({
    daily: closedDaily(embedded),
    cursor: { line: 2, ch: linkCh(embedded, "![[") },
    files: { "Tasks.md": tree },
  });
  assertFrozenPomodoro(editor, "embedded close");
  assert.equal(editor.getLine(2), "\t- ~~[[Tasks#^root|Root]]~~");
  assert.match(harness.getSource("Tasks.md"), /^- \[x\] #task Root/m);
  assert.match(harness.getSource("Tasks.md"), /^- \[x\] #task Child/m);

  action({});
  await flushAsyncActions();
  await plugin.referenceMutationQueue;
  await flushAsyncActions();
  await plugin.referenceMutationQueue;

  assertFrozenPomodoro(editor, "embedded reopen");
  assert.equal(editor.getLine(2), "\t- 🍅 [[Tasks#^root|Root]]");
  assert.match(harness.getSource("Tasks.md"), /^- \[ \] #task Root \^root/m);
});

test("closed-entry Cancelled notice and unresolved no-op leave the Pomodoro frozen", async () => {
  notices.length = 0;
  const cancelledLink = "\t- 🍅 [[Tasks#^a|Alias]]";
  const cancelled = await runClosedLinkToggle({
    daily: closedDaily(cancelledLink),
    cursor: { line: 2, ch: linkCh(cancelledLink) },
    files: { "Tasks.md": "- [-] #task A ^a" },
  });
  assertFrozenPomodoro(cancelled.editor, "cancelled");
  assert.equal(cancelled.editor.getLine(2), cancelledLink);
  assert.equal(cancelled.harness.getSource("Tasks.md"), "- [-] #task A ^a");
  assert.match(notices.at(-1), /Task is cancelled; reopen it with ⌥\] first/);

  const unresolvedLink = "\t- 🍅 [[Missing#^nope|Gone]]";
  const unresolved = await runClosedLinkToggle({
    daily: closedDaily(unresolvedLink),
    cursor: { line: 2, ch: linkCh(unresolvedLink) },
  });
  assertFrozenPomodoro(unresolved.editor, "unresolved");
  assert.equal(unresolved.editor.getLine(2), unresolvedLink);
  assert.equal(unresolved.editor.getLine(1), CLOSED_POMODORO);
});

test("stale_done_link retire writes 🍅 ~~[[X]]~~ without touching the task", async () => {
  const live = "\t- 🍅 [[Tasks#^a|Alias]]";
  const unmarked = "\t- [[Tasks#^a|Alias]]";
  const doneTask = "- [x] #task A [completion:: 2026-01-01] ^a";
  for (const linkLine of [live, unmarked]) {
    const finalizeCalls = [];
    const reopenReceipts = [];
    const { editor, harness, plugin, action } = await runClosedLinkToggle({
      daily: closedDaily(linkLine),
      cursor: { line: 2, ch: linkCh(linkLine) },
      files: { "Tasks.md": doneTask },
      install(nextPlugin) {
        const originalFinalize = nextPlugin.finalizeClosedTasks.bind(nextPlugin);
        nextPlugin.finalizeClosedTasks = async (...args) => {
          finalizeCalls.push(args);
          return originalFinalize(...args);
        };
        const originalReceipt = nextPlugin.consumeSuccessorReopenReceipt.bind(nextPlugin);
        nextPlugin.consumeSuccessorReopenReceipt = async (...args) => {
          reopenReceipts.push(args);
          return originalReceipt(...args);
        };
      },
    });
    const label = linkLine;
    assertFrozenPomodoro(editor, label);
    assert.equal(editor.getLine(2), "\t- 🍅 ~~[[Tasks#^a|Alias]]~~", label);
    assert.equal(harness.getSource("Tasks.md"), doneTask, label);
    assert.equal(finalizeCalls.length, 0, `${label}: no post-close pass`);
    assert.equal(reopenReceipts.length, 0, `${label}: no reopen receipt`);

    action({});
    await flushAsyncActions();
    await plugin.referenceMutationQueue;
    await flushAsyncActions();
    await plugin.referenceMutationQueue;
    assert.equal(editor.getLine(2), "\t- 🍅 [[Tasks#^a|Alias]]", `${label}: second press reopens`);
    assert.match(harness.getSource("Tasks.md"), /^- \[ \] #task A \^a/m, `${label}: second press`);
  }
});

test("embedded Done target under a closed entry still reopens", async () => {
  const embedded = "\t- ![[Tasks#^a|Alias]]";
  const { editor, harness } = await runClosedLinkToggle({
    daily: closedDaily(embedded),
    cursor: { line: 2, ch: linkCh(embedded, "![[") },
    files: { "Tasks.md": "- [x] #task A [completion:: 2026-01-01] ^a" },
  });
  assertFrozenPomodoro(editor, "embedded done");
  assert.equal(editor.getLine(2), embedded);
  assert.match(harness.getSource("Tasks.md"), /^- \[ \] #task A \^a/m);
});

test("done/ archived target reopens through bob task restore", async () => {
  const struck = "\t- 🍅 ~~[[done/work_done#^a|Alias]]~~";
  const restoreCalls = [];
  const { editor, plugin } = await runClosedLinkToggle({
    daily: closedDaily(struck),
    cursor: { line: 2, ch: linkCh(struck) },
    files: {
      "done/work_done.md": "- [x] #task Archived [completion:: 2026-01-01] ^a",
    },
    install(nextPlugin) {
      nextPlugin.spawnBobTaskRestore = async (archivePath, blockId) => {
        restoreCalls.push({ archivePath, blockId });
        return { ok: true, identity: { path: "work.md", blockId: "a" } };
      };
    },
  });
  assert.deepEqual(restoreCalls, [{ archivePath: "done/work_done.md", blockId: "a" }]);
  assertFrozenPomodoro(editor, "archive restore");
  assert.equal(editor.getLine(2), "\t- 🍅 [[done/work_done#^a|Alias]]");
  assert.equal(
    plugin.app.vault.getAbstractFileByPath("done/work_done.md") &&
      editor.getLine(2).includes("🍅"),
    true,
  );
});

test("cancelled [-] Pomodoro restores without adding 🍅; open entries stay bare", async () => {
  const cancelledDaily = [
    "## Pomodoros",
    "- [-] Cancelled session",
    "\t- ~~[[Tasks#^a|Alias]]~~",
  ].join("\n");
  const cancelled = await runClosedLinkToggle({
    daily: cancelledDaily,
    cursor: { line: 2, ch: linkCh("\t- ~~[[Tasks#^a|Alias]]~~") },
    files: { "Tasks.md": "- [x] #task A [completion:: 2026-07-16] ^a" },
  });
  assert.equal(cancelled.editor.getLine(1), "- [-] Cancelled session");
  assert.equal(cancelled.editor.getLine(2), "\t- [[Tasks#^a|Alias]]");

  const openDaily = [
    "## Pomodoros",
    "- [ ] (**0920-0950** [t:: 30m]) — DEEP",
    "\t- ~~[[Tasks#^a|Alias]]~~",
  ].join("\n");
  const opened = await runClosedLinkToggle({
    daily: openDaily,
    cursor: { line: 2, ch: linkCh("\t- ~~[[Tasks#^a|Alias]]~~") },
    files: { "Tasks.md": "- [x] #task A [completion:: 2026-07-16] ^a" },
  });
  assert.equal(opened.editor.getLine(1), "- [ ] (**0920-0950** [t:: 30m]) — DEEP");
  assert.equal(opened.editor.getLine(2), "\t- [[Tasks#^a|Alias]]");
});

test("checkbox children under a closed entry keep the local toggle", async () => {
  const daily = closedDaily("\t- [ ] Child");
  const { editor } = await runClosedLinkToggle({
    daily,
    cursor: { line: 2, ch: 4 },
  });
  assertFrozenPomodoro(editor, "checkbox child");
  assert.match(editor.getLine(2), /^-?\t- \[x\] Child/);
});

test("uppercase [X] closed entry follows the same Task Link contract", async () => {
  const daily = [
    "## Pomodoros",
    "- [X] (**0920-0950** [t:: 30m]) — DEEP",
    "\t- 🍅 [[Tasks#^a|Alias]]",
    WORK_LOG_CHILD,
    OPEN_PLACEHOLDER,
  ].join("\n");
  const { editor, harness } = await runClosedLinkToggle({
    daily,
    cursor: { line: 2, ch: linkCh("\t- 🍅 [[Tasks#^a|Alias]]") },
    files: { "Tasks.md": "- [ ] #task A ^a" },
  });
  assert.equal(editor.getLine(1), "- [X] (**0920-0950** [t:: 30m]) — DEEP");
  assert.equal(editor.getLine(2), "\t- ~~[[Tasks#^a|Alias]]~~");
  assert.match(harness.getSource("Tasks.md"), /^- \[x\] #task A/m);
});

test("restoreReopenedTaskReferencesInText adds 🍅 only under closed entries", () => {
  const source = [
    "## Pomodoros",
    "- [ ] Open",
    "\t- ~~[[Alpha#^review|Open]]~~",
    "- [-] Cancelled",
    "\t- ~~[[Alpha#^review|Cancelled]]~~",
    "- [x] Closed",
    "\t- ~~[[Alpha#^review|Closed]]~~",
    "- [X] ClosedX",
    "\t- 🍅 ~~[[Alpha#^review|ClosedX]]~~",
  ].join("\n");
  const result = helpers.restoreReopenedTaskReferencesInText(
    source,
    "Tasks.md",
    [{ path: "Projects/Alpha.md", blockId: "review" }],
    (pathPart) => (pathPart === "Alpha" ? "Projects/Alpha.md" : null),
  );
  assert.match(result.text, /\t- \[\[Alpha#\^review\|Open\]\]/);
  assert.match(result.text, /\t- \[\[Alpha#\^review\|Cancelled\]\]/);
  assert.match(result.text, /\t- 🍅 \[\[Alpha#\^review\|Closed\]\]/);
  assert.match(result.text, /\t- 🍅 \[\[Alpha#\^review\|ClosedX\]\]/);
  const second = helpers.restoreReopenedTaskReferencesInText(
    result.text,
    "Tasks.md",
    [{ path: "Projects/Alpha.md", blockId: "review" }],
    (pathPart) => (pathPart === "Alpha" ? "Projects/Alpha.md" : null),
  );
  assert.equal(second.changed, false);
});
