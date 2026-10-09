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
  installTasksCloseCommand,
} = require("./task-status-cycler-harness.cjs");

// Guard tests for the `cycler_wiring` pass (plan:202610/successor_links.md):
// the gated recover-and-link inside `finalizeClosedTasks`, the Pomodoro
// closing-entry hint, editor/vault write-through with preimage checks, and
// the single-notice reporting (nav card, walk toast, plain fallback).

const TODAY = "2026-10-09";
const DAILY_NOW = new Date("2026-10-09T12:00:00");
// Today's daily path under the default daily-notes settings (no
// daily-notes plugin configured in the harness app).
const DAILY_PATH = helpers.todayDailyPath({}, DAILY_NOW);

function makePlugin(harness, editor, path) {
  const plugin = new TaskStatusCyclerPlugin();
  plugin.getScheduleLogDateString = () => TODAY;
  plugin.getPomodoroWorkLogDateString = () => TODAY;
  plugin.scheduleCenterEditorLineInView = () => {};
  attachActiveMarkdownView(plugin, harness, editor, path);
  if (!harness.app.commands) {
    harness.app.commands = { commands: {}, executeCommandById: () => false };
  }
  return plugin;
}

function installNavStub(plugin, seen) {
  const previous = plugin.app.plugins && plugin.app.plugins.plugins
    ? plugin.app.plugins.plugins
    : {};
  plugin.app.plugins = {
    plugins: {
      ...previous,
      "bob-navigation-hotkeys": {
        api: {
          version: 3,
          notice: {
            version: 1,
            showUnblocked(model) {
              seen.push(model);
              return true;
            },
          },
        },
      },
    },
  };
}

function installTasksStub(plugin, tasks, state = "Warm") {
  const previous = plugin.app.plugins && plugin.app.plugins.plugins
    ? plugin.app.plugins.plugins
    : {};
  plugin.app.plugins = {
    plugins: {
      ...previous,
      "obsidian-tasks-plugin": {
        apiV1: { getTasks: () => tasks, getState: () => state },
      },
    },
  };
}

function countVaultReads(harness) {
  const counts = { cachedRead: [], read: [], process: [], modify: [] };
  const vault = harness.app.vault;
  for (const key of Object.keys(counts)) {
    const original = vault[key];
    if (typeof original !== "function") {
      continue;
    }
    vault[key] = async (...args) => {
      const file = args[0];
      counts[key].push(file && file.path ? file.path : "?");
      return original.apply(vault, args);
    };
  }
  return counts;
}

const FIX_LINE =
  "- [ ] #task Fix apollo machine! [id:: sase__fix-apollo] ^fix-apollo";
const FIX_DONE_LINE =
  "- [x] #task Fix apollo machine! [id:: sase__fix-apollo] ^fix-apollo";
const FIX_CLOSED_STAMPED_LINE =
  "- [x] #task Fix apollo machine! [id:: sase__fix-apollo]  [completion:: 2026-10-09] ^fix-apollo";
const DEPENDENT_LINE =
  "- [?] #task Re-launch all failed agents on apollo! [dependsOn:: sase__fix-apollo] ^relaunch-failed";
const DEPENDENT_NEXT_LINE =
  "- [*] #task Re-launch all failed agents on apollo! [dependsOn:: sase__fix-apollo] ^relaunch-failed";

function fixDay(linkLine = "\t- [[sase#^fix-apollo]]") {
  return ["# 2026-10-09", "", "## Pomodoros", "- [ ] () — FIX", linkLine].join(
    "\n",
  );
}

test("link close links the unblocked successor into the slot and shows the nav card", async () => {
  notices.length = 0;
  const day = fixDay();
  const harness = createInMemoryObsidianApp({
    "sase.md": [FIX_LINE, DEPENDENT_LINE].join("\n"),
    [DAILY_PATH]: day,
  });
  const editor = createTextEditor(day, { line: 4, ch: 5 });
  const plugin = makePlugin(harness, editor, DAILY_PATH);
  const seen = [];
  installNavStub(plugin, seen);

  const result = await plugin.handleActiveTaskBlockLinkOpenDone(editor, {
    path: DAILY_PATH,
  });

  assert.equal(result.resolved, true);
  assert.equal(result.changed, true);
  // The strike still lands on the cursor link: the successor was inserted
  // below it, so line 4 is the struck link and line 5 is the new bullet.
  assert.match(editor.getLine(4), /~~\[\[sase#\^fix-apollo\]\]~~/);
  assert.equal(editor.getLine(5), "\t- [[sase#^relaunch-failed]]");
  assert.equal(
    harness.getSource("sase.md"),
    [FIX_CLOSED_STAMPED_LINE, DEPENDENT_NEXT_LINE].join("\n"),
  );
  assert.equal(seen.length, 1);
  const model = seen[0];
  assert.equal(model.unblocked.length, 1);
  assert.equal(model.unblocked[0].block_id, "relaunch-failed");
  assert.equal(model.unblocked[0].status_symbol, "*");
  assert.equal(model.unblocked[0].link.entry_name, "FIX");
  assert.equal(model.unblocked[0].link.entry_created, false);
  assert.equal(model.unblocked[0].not_linked, null);
  assert.deepEqual(model.unblocked[0].unblocked_by, [
    {
      note_path: "sase.md",
      block_id: "fix-apollo",
      text: "Fix apollo machine!",
    },
  ]);
  assert.equal(model.failure, null);
  assert.equal(notices.length, 0);
});

test("close with no [id::] performs zero vault reads and shows nothing", async () => {
  notices.length = 0;
  const source = "- [ ] #task Plain chore ^plain";
  const harness = createInMemoryObsidianApp({ "Note.md": source });
  const editor = createTextEditor(source, { line: 0, ch: 4 });
  const plugin = makePlugin(harness, editor, "Note.md");
  const counts = countVaultReads(harness);
  const seen = [];
  installNavStub(plugin, seen);

  const taskStatus = plugin.getActiveTaskStatus(editor);
  const wrote = await plugin.toggleActiveCheckboxOpenDoneAndPropagate(
    editor,
    { path: "Note.md" },
    taskStatus,
  );

  assert.equal(wrote, true);
  assert.equal(
    editor.getLine(0),
    "- [x] #task Plain chore  [completion:: 2026-10-09] ^plain",
  );
  assert.deepEqual(counts.cachedRead, []);
  assert.deepEqual(counts.read, []);
  assert.deepEqual(counts.process, []);
  assert.deepEqual(counts.modify, []);
  assert.equal(seen.length, 0);
  assert.equal(notices.length, 0);
});

test("Warm finalize reads no unrelated note bodies on the real close path", async () => {
  notices.length = 0;
  const day = ["# 2026-10-09", "", "## Pomodoros", "- [ ] () — FIX", "\t- [[p#^p]]"].join("\n");
  const harness = createInMemoryObsidianApp({
    "p.md": "- [x] #task Pred [id:: p] ^p",
    "a/d.md": "- [?] #task Dep [dependsOn:: p] [id:: d] ^d",
    "b/d.md": "# Notes\n\nProse about d things, no tasks here.\n",
    [DAILY_PATH]: day,
  });
  // Complete link metadata: the daily note links the predecessor; the
  // prose-only decoy links nothing, so retirement skips its body too.
  harness.app.metadataCache.resolvedLinks = {
    [DAILY_PATH]: { "p.md": 1 },
  };
  const editor = createTextEditor(day, { line: 4, ch: 5 });
  const plugin = makePlugin(harness, editor, DAILY_PATH);
  const seen = [];
  installNavStub(plugin, seen);
  installTasksStub(plugin, [
    {
      path: "p.md",
      lineNumber: 0,
      status: "x",
      originalMarkdown: "- [x] #task Pred [id:: p] ^p",
      description: "Pred",
      blockId: "p",
      id: "p",
      dependsOn: [],
    },
    {
      path: "a/d.md",
      lineNumber: 0,
      status: "?",
      originalMarkdown: "- [?] #task Dep [dependsOn:: p] [id:: d] ^d",
      description: "Dep",
      blockId: "d",
      id: "d",
      dependsOn: ["p"],
    },
  ]);
  const counts = countVaultReads(harness);

  // The entire gesture through the real `finalizeClosedTasks`: one gated
  // recover-and-link plan (no legacy full-scan recovery), linker-scoped
  // retirement, and exactly one notice.
  const result = await plugin.finalizeClosedTasks(
    [{ path: "p.md", blockId: "p" }],
    { editor, activePath: DAILY_PATH },
  );

  const model = result.successors;
  assert.ok(model);
  assert.equal(model.unblocked.length, 1);
  assert.equal(model.unblocked[0].status_symbol, "*");
  assert.ok(model.unblocked[0].link);
  assert.equal(model.unblocked[0].link.entry_name, "FIX");
  // The prose-only `b/d.md` sibling forces the long form, exactly like
  // Rust's walk-only catalog.
  assert.equal(model.unblocked[0].link.block_link, "[[a/d#^d]]");
  assert.equal(model.failure, null);
  // Recovery counts propagate from the same plan: one `?` changed.
  assert.equal(result.reopened, 1);
  assert.deepEqual(result.recoveryFailures, []);
  assert.deepEqual(result.retirementFailures, []);
  assert.equal(
    harness.getSource("a/d.md"),
    "- [*] #task Dep [dependsOn:: p] [id:: d] ^d",
  );
  assert.equal(editor.getLine(5), "\t- [[a/d#^d]]");
  // Related notes were read; the prose-only decoy and the open daily
  // buffer needed no body read at all.
  const allReads = [...counts.cachedRead, ...counts.read];
  assert.ok(!allReads.includes("b/d.md"));
  assert.ok(!allReads.includes(DAILY_PATH));
  assert.ok(allReads.includes("p.md"));
  assert.ok(allReads.includes("a/d.md"));
  // Exactly one notice for the whole gesture.
  assert.equal(seen.length, 1);
  assert.equal(notices.length, 0);
});

test("cold fallback still recovers and links without a Tasks cache", async () => {
  notices.length = 0;
  const day = fixDay();
  const harness = createInMemoryObsidianApp({
    "sase.md": [FIX_LINE, DEPENDENT_LINE].join("\n"),
    [DAILY_PATH]: day,
  });
  const editor = createTextEditor(day, { line: 4, ch: 5 });
  const plugin = makePlugin(harness, editor, DAILY_PATH);
  const seen = [];
  installNavStub(plugin, seen);

  const result = await plugin.handleActiveTaskBlockLinkOpenDone(editor, {
    path: DAILY_PATH,
  });

  assert.equal(result.changed, true);
  assert.equal(
    harness.getSource("sase.md"),
    [FIX_CLOSED_STAMPED_LINE, DEPENDENT_NEXT_LINE].join("\n"),
  );
  assert.equal(editor.getLine(5), "\t- [[sase#^relaunch-failed]]");
  assert.equal(seen.length, 1);
});

test("recovered-only close reports unblocked without linking", async () => {
  notices.length = 0;
  // The predecessor was never planned today, so the dependent recovers to
  // Ready with `not_planned_today` and no link is written.
  const day = ["# 2026-10-09", "", "## Pomodoros", "- [ ] () — FIX"].join("\n");
  const harness = createInMemoryObsidianApp({
    "sase.md": [FIX_LINE, DEPENDENT_LINE].join("\n"),
    [DAILY_PATH]: day,
  });
  const editor = createTextEditor(day, { line: 3, ch: 5 });
  const plugin = makePlugin(harness, editor, DAILY_PATH);
  const seen = [];
  installNavStub(plugin, seen);

  const result = await plugin.finalizeClosedTasks(
    [
      {
        path: "sase.md",
        blockId: "fix-apollo",
        taskId: "sase__fix-apollo",
        text: "Fix apollo machine!",
      },
    ],
    { editor, activePath: DAILY_PATH },
  );

  assert.ok(result.successors);
  assert.equal(result.successors.unblocked.length, 1);
  const row = result.successors.unblocked[0];
  assert.equal(row.status_symbol, " ");
  assert.equal(row.link, null);
  assert.equal(row.not_linked, "not_planned_today");
  assert.equal(
    harness.getSource("sase.md").split("\n")[1],
    "- [ ] #task Re-launch all failed agents on apollo! [dependsOn:: sase__fix-apollo] ^relaunch-failed",
  );
  assert.equal(editor.getValue(), day);
  assert.equal(seen.length, 1);
  assert.match(
    plugin.successorNoticeForModel(result.successors),
    /🔓 Unblocked/,
  );
  assert.equal(notices.length, 0);
});

test("walk landing composes a single toast and shows no card", async () => {
  notices.length = 0;
  // Drive the same walk branch `handleVimTaskToggleOpenDone` uses: the
  // toggle composes into the box and the walk settles with one outcome.
  const cursorEditor = createTextEditor(
    "- [ ] #task Walk task [id:: walk__task] ^walk-task",
    { line: 0, ch: 4 },
  );
  const walkHarness = createInMemoryObsidianApp({
    "walk.md": cursorEditor.getValue(),
    "sase.md": [
      FIX_LINE,
      "- [?] #task Walk dependent [dependsOn:: walk__task] ^walk-dependent",
    ].join("\n"),
    [DAILY_PATH]: fixDay("\t- [[walk#^walk-task]]"),
  });
  const walkPlugin = makePlugin(walkHarness, cursorEditor, "walk.md");
  const walkSeen = [];
  installNavStub(walkPlugin, walkSeen);
  const walkContinued = [];
  walkPlugin.app.plugins.plugins["bob-navigation-hotkeys"].api.reviewWalk = {
    version: 1,
    capture() {
      return { key: "row", seq: 1, epoch: 1 };
    },
    continue(originArg, outcome) {
      walkContinued.push({ origin: originArg, outcome });
      return Promise.resolve({ ok: true, advanced: true, stopped: false });
    },
  };
  const box = {};
  const status = walkPlugin.getActiveTaskStatus(cursorEditor);
  const wrote = await walkPlugin.toggleActiveCheckboxOpenDoneAndPropagate(
    cursorEditor,
    { path: "walk.md" },
    status,
    { successorNoticeTarget: "return", successorNoticeBox: box },
  );
  assert.equal(wrote, true);
  walkPlugin.continueReviewWalkSilently(
    walkPlugin.getReviewWalkApi(),
    { key: "row", seq: 1, epoch: 1 },
    wrote === true ? { kind: "complete", ...(box.text ? { notice: box.text } : {}) } : null,
  );
  await flushAsyncActions();

  assert.equal(walkContinued.length, 1);
  assert.equal(walkContinued[0].outcome.kind, "complete");
  assert.match(walkContinued[0].outcome.notice || "", /🔓/);
  assert.equal(walkSeen.length, 0);
  assert.equal(notices.length, 0);
});

test("nav absent falls back to a plain Notice", async () => {
  notices.length = 0;
  const day = fixDay();
  const harness = createInMemoryObsidianApp({
    "sase.md": [FIX_LINE, DEPENDENT_LINE].join("\n"),
    [DAILY_PATH]: day,
  });
  const editor = createTextEditor(day, { line: 4, ch: 5 });
  const plugin = makePlugin(harness, editor, DAILY_PATH);

  const result = await plugin.handleActiveTaskBlockLinkOpenDone(editor, {
    path: DAILY_PATH,
  });

  assert.equal(result.changed, true);
  assert.equal(editor.getLine(5), "\t- [[sase#^relaunch-failed]]");
  assert.equal(notices.length, 1);
  assert.match(notices[0], /🔓 Next in FIX/);
});

test("stale cache line yields a failed row and a warning notice", async () => {
  notices.length = 0;
  const day = fixDay();
  const liveDependent =
    "- [?] #task Re-launch all failed agents TODAY! [dependsOn:: sase__fix-apollo] ^relaunch-failed";
  const harness = createInMemoryObsidianApp({
    "sase.md": [FIX_DONE_LINE, liveDependent].join("\n"),
    [DAILY_PATH]: day,
  });
  const editor = createTextEditor(day, { line: 4, ch: 5 });
  const plugin = makePlugin(harness, editor, DAILY_PATH);
  const seen = [];
  installNavStub(plugin, seen);
  // Warm cache with a stale copy of the dependent line: the plan's
  // preimage (`before`) will not match the vault text at apply time.
  installTasksStub(plugin, [
    {
      path: "sase.md",
      lineNumber: 0,
      status: "x",
      originalMarkdown: FIX_DONE_LINE,
      description: "Fix apollo machine!",
      blockId: "fix-apollo",
      id: "sase__fix-apollo",
      dependsOn: [],
    },
    {
      path: "sase.md",
      lineNumber: 1,
      status: "?",
      originalMarkdown: DEPENDENT_LINE,
      description: "Re-launch all failed agents on apollo!",
      blockId: "relaunch-failed",
      id: null,
      dependsOn: ["sase__fix-apollo"],
    },
  ]);

  const result = await plugin.finalizeClosedTasks(
    [{ path: "sase.md", blockId: "fix-apollo", taskId: "sase__fix-apollo" }],
    { editor, activePath: DAILY_PATH },
  );

  assert.ok(result.successors);
  assert.equal(result.successors.unblocked.length, 1);
  const row = result.successors.unblocked[0];
  assert.equal(row.link, null);
  assert.equal(row.not_linked, "failed");
  assert.equal(result.successors.failure.count, 1);
  // No link was written for the failed row, and with the single gated
  // plan there is no legacy backstop rewrite either: the stale line is
  // left untouched and the failure is reported, exactly as the contract
  // promises.
  assert.equal(
    harness.getSource("sase.md").split("\n")[1],
    "- [?] #task Re-launch all failed agents TODAY! [dependsOn:: sase__fix-apollo] ^relaunch-failed",
  );
  assert.equal(seen.length, 1);
  assert.match(
    plugin.successorNoticeForModel(result.successors),
    /⚠ Closed/,
  );
});

test("Pomodoro-line close appends the successor to the created continuation", async () => {
  notices.length = 0;
  const day = [
    "# 2026-10-09",
    "",
    "## Pomodoros",
    "- [ ] () — FIX",
    "\t- ![[sase#^fix-apollo]]",
  ].join("\n");
  const harness = createInMemoryObsidianApp({
    "sase.md": [FIX_LINE, DEPENDENT_LINE].join("\n"),
    [DAILY_PATH]: day,
  });
  const editor = createTextEditor(day, { line: 3, ch: 4 });
  const plugin = makePlugin(harness, editor, DAILY_PATH);
  const seen = [];
  installNavStub(plugin, seen);

  const completed = await plugin.completeActivePomodoroTask(
    editor,
    { path: DAILY_PATH },
    { pomodoroLine: 3 },
  );

  assert.equal(completed, true);
  assert.equal(
    harness.getSource("sase.md"),
    [
      "- [x] #task Fix apollo machine! [id:: sase__fix-apollo]  [completion:: 2026-10-09] ^fix-apollo",
      DEPENDENT_NEXT_LINE,
    ].join("\n"),
  );
  const value = editor.getValue();
  assert.match(value, /^- \[x\] \(\) — FIX$/m);
  // The close created a continuation and the successor landed in it.
  assert.match(value, /^- \[ \] \(\) — FIX\n\t- \[\[sase#\^relaunch-failed\]\]/m);
  assert.equal(seen.length, 1);
  const row = seen[0].unblocked[0];
  assert.equal(row.link.entry_name, "FIX");
  assert.equal(row.link.entry_created, true);
  assert.equal(notices.length, 0);
});

test("completeTaskAtCursor returns the notice and shows nothing itself", async () => {
  notices.length = 0;
  const walkLine = "- [ ] #task Walk task [id:: walk__task] ^walk-task";
  const walkDependent =
    "- [?] #task Walk dependent [dependsOn:: walk__task] ^walk-dep";
  const day = fixDay("\t- [[walk#^walk-task]]");
  const harness = createInMemoryObsidianApp({
    "walk.md": [walkLine, walkDependent].join("\n"),
    [DAILY_PATH]: day,
  });
  const editor = createTextEditor([walkLine, walkDependent].join("\n"), {
    line: 0,
    ch: 4,
  });
  const plugin = makePlugin(harness, editor, "walk.md");
  const seen = [];
  installNavStub(plugin, seen);
  installTasksCloseCommand(plugin, editor);

  const result = await plugin.completeTaskAtCursor(editor);

  assert.equal(result.ok, true);
  assert.match(result.successorNotice || "", /🔓/);
  assert.equal(seen.length, 0);
  assert.equal(notices.length, 0);
});
