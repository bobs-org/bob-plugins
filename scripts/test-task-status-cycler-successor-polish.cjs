const test = require("node:test");
const assert = require("node:assert/strict");
const {
  TaskStatusCyclerPlugin,
  MarkdownView,
  helpers,
  notices,
  createInMemoryObsidianApp,
  createTextEditor,
  attachActiveMarkdownView,
  flushAsyncActions,
} = require("./task-status-cycler-harness.cjs");

// Guard tests for the `cycler_polish` phase (plan:202610/successor_links.md):
// the in-memory reopen receipt (reopening a predecessor the same day takes
// back untouched successor links and restores their statuses) and the
// Alt+]/Alt+[ closes routed through `finalizeClosedTasks` (bead bob-cli-3k:
// Done closes link, Cancelled closes recover only).

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

const FIX_LINE =
  "- [ ] #task Fix apollo machine! [id:: sase__fix-apollo] ^fix-apollo";
const FIX_NEXT_LINE =
  "- [*] #task Fix apollo machine! [id:: sase__fix-apollo] ^fix-apollo";
const DEPENDENT_LINE =
  "- [?] #task Re-launch all failed agents on apollo! [dependsOn:: sase__fix-apollo] ^relaunch-failed";
const DEPENDENT_NEXT_LINE =
  "- [*] #task Re-launch all failed agents on apollo! [dependsOn:: sase__fix-apollo] ^relaunch-failed";

function fixDay(linkLine = "\t- [[sase#^fix-apollo]]") {
  return ["# 2026-10-09", "", "## Pomodoros", "- [ ] () — FIX", linkLine].join(
    "\n",
  );
}

async function settle(plugin) {
  // The cycle paths finalize without awaiting; drain the queued mutation
  // chain (and any follow-up microtasks) before asserting.
  for (let round = 0; round < 10; round += 1) {
    await flushAsyncActions();
  }
  try {
    await plugin.referenceMutationQueue;
  } catch (error) {
    // finalize results carry failures; the queue itself must stay usable.
  }
  for (let round = 0; round < 10; round += 1) {
    await flushAsyncActions();
  }
}

async function closePlannedPredecessor() {
  const day = fixDay();
  const harness = createInMemoryObsidianApp({
    "sase.md": [FIX_LINE, DEPENDENT_LINE].join("\n"),
    [DAILY_PATH]: day,
  });
  const editor = createTextEditor(day, { line: 4, ch: 5 });
  const plugin = makePlugin(harness, editor, DAILY_PATH);
  const seen = [];
  installNavStub(plugin, seen);

  const closed = await plugin.handleActiveTaskBlockLinkOpenDone(editor, {
    path: DAILY_PATH,
  });
  assert.equal(closed.changed, true);
  assert.equal(editor.getLine(5), "\t- [[sase#^relaunch-failed]]");
  assert.equal(
    harness.getSource("sase.md").split("\n")[1],
    DEPENDENT_NEXT_LINE,
  );
  assert.equal(seen.length, 1);
  return { harness, editor, plugin, seen };
}

function reopenAtStruckLink(editor) {
  editor.setCursor({ line: 4, ch: 5 });
  return editor;
}

test("reopen takes back the untouched successor link and restores status", async () => {
  notices.length = 0;
  const { harness, editor, plugin } = await closePlannedPredecessor();
  notices.length = 0;

  const reopened = await plugin.handleActiveTaskBlockLinkOpenDone(
    reopenAtStruckLink(editor),
    { path: DAILY_PATH },
  );
  assert.equal(reopened.changed, true);
  // The successor bullet is gone and the struck link is unstruck in place.
  assert.equal(editor.getLine(4), "\t- [[sase#^fix-apollo]]");
  assert.equal(editor.lineCount(), 5);
  // The dependent is Blocked again: the derived truth with P open.
  assert.equal(
    harness.getSource("sase.md").split("\n")[1],
    DEPENDENT_LINE,
  );
  assert.ok(
    notices.some((message) => message.startsWith("↩ Reopened")),
    JSON.stringify(notices),
  );
});

test("an edited successor bullet survives while its status still restores", async () => {
  notices.length = 0;
  const { harness, editor, plugin } = await closePlannedPredecessor();
  notices.length = 0;

  const bullet = editor.getLine(5);
  editor.replaceRange(" extra", { line: 5, ch: bullet.length });
  assert.equal(
    editor.getLine(5),
    "\t- [[sase#^relaunch-failed]] extra",
  );

  const reopened = await plugin.handleActiveTaskBlockLinkOpenDone(
    reopenAtStruckLink(editor),
    { path: DAILY_PATH },
  );
  assert.equal(reopened.changed, true);
  // Edited link: left alone, and no take-back notice for zero links.
  assert.equal(
    editor.getLine(5),
    "\t- [[sase#^relaunch-failed]] extra",
  );
  assert.ok(
    !notices.some((message) => message.startsWith("↩ Reopened")),
    JSON.stringify(notices),
  );
  // Untouched status line: still restored to the derived truth.
  assert.equal(
    harness.getSource("sase.md").split("\n")[1],
    DEPENDENT_LINE,
  );
});

test("an edited successor status line survives while its link is taken back", async () => {
  notices.length = 0;
  const { harness, editor, plugin } = await closePlannedPredecessor();
  notices.length = 0;

  const edited =
    "- [/] #task Re-launch all failed agents on apollo! [dependsOn:: sase__fix-apollo] ^relaunch-failed";
  const file = harness.app.vault.getAbstractFileByPath("sase.md");
  await harness.app.vault.modify(
    file,
    [harness.getSource("sase.md").split("\n")[0], edited].join("\n"),
  );

  const reopened = await plugin.handleActiveTaskBlockLinkOpenDone(
    reopenAtStruckLink(editor),
    { path: DAILY_PATH },
  );
  assert.equal(reopened.changed, true);
  // Untouched link: taken back with the receipt notice.
  assert.equal(editor.lineCount(), 5);
  assert.ok(
    notices.some((message) => message.startsWith("↩ Reopened")),
    JSON.stringify(notices),
  );
  // Edited status line: left alone.
  assert.equal(harness.getSource("sase.md").split("\n")[1], edited);
});

test("reopen on a different day leaves successor links alone", async () => {
  notices.length = 0;
  const { harness, editor, plugin } = await closePlannedPredecessor();
  notices.length = 0;
  plugin.getScheduleLogDateString = () => "2026-10-10";

  const reopened = await plugin.handleActiveTaskBlockLinkOpenDone(
    reopenAtStruckLink(editor),
    { path: DAILY_PATH },
  );
  assert.equal(reopened.changed, true);
  // The predecessor still reopens, but the stale receipt is dropped unused.
  assert.equal(editor.getLine(5), "\t- [[sase#^relaunch-failed]]");
  assert.equal(
    harness.getSource("sase.md").split("\n")[1],
    DEPENDENT_NEXT_LINE,
  );
  assert.ok(
    !notices.some((message) => message.startsWith("↩ Reopened")),
    JSON.stringify(notices),
  );
});

test("reopening a task closed without a pass shows no take-back", async () => {
  notices.length = 0;
  // No `[id::]`: the gate stops the pass, so no receipt is stored.
  const day = fixDay("\t- [[sase#^plain]]");
  const harness = createInMemoryObsidianApp({
    "sase.md": "- [ ] #task Plain chore ^plain",
    [DAILY_PATH]: day,
  });
  const editor = createTextEditor(day, { line: 4, ch: 5 });
  const plugin = makePlugin(harness, editor, DAILY_PATH);
  installNavStub(plugin, []);

  const closed = await plugin.handleActiveTaskBlockLinkOpenDone(editor, {
    path: DAILY_PATH,
  });
  assert.equal(closed.changed, true);
  notices.length = 0;

  const reopened = await plugin.handleActiveTaskBlockLinkOpenDone(
    reopenAtStruckLink(editor),
    { path: DAILY_PATH },
  );
  assert.equal(reopened.changed, true);
  assert.ok(
    !notices.some((message) => message.startsWith("↩ Reopened")),
    JSON.stringify(notices),
  );
});

test("Alt+] on a planned prerequisite links its successor", async () => {
  notices.length = 0;
  const day = fixDay();
  const source = [FIX_NEXT_LINE, DEPENDENT_LINE].join("\n");
  const harness = createInMemoryObsidianApp({
    "sase.md": source,
    [DAILY_PATH]: day,
  });
  const editor = createTextEditor(source, { line: 0, ch: 5 });
  const plugin = makePlugin(harness, editor, "sase.md");
  const seen = [];
  installNavStub(plugin, seen);
  const view = Object.assign(new MarkdownView(), {
    editor,
    file: { path: "sase.md" },
  });
  assert.equal(plugin.handleCycleCommand(false, editor, view, 1), true);
  await settle(plugin);

  assert.match(editor.getValue(), /^- \[x\] #task Fix apollo machine!/m);
  // The dependent's status edit goes through the open editor buffer (the
  // daily insertion, with no open daily editor, goes through the vault).
  assert.equal(editor.getValue().split("\n")[1], DEPENDENT_NEXT_LINE);
  assert.match(
    harness.getSource(DAILY_PATH),
    /\t- \[\[sase#\^relaunch-failed\]\]/,
  );
  assert.equal(seen.length, 1);
  assert.equal(seen[0].unblocked.length, 1);
  assert.ok(seen[0].unblocked[0].link);
});

test("Alt+[ into Cancelled recovers its dependents without linking", async () => {
  notices.length = 0;
  const day = fixDay();
  const source = [FIX_LINE, DEPENDENT_LINE].join("\n");
  const harness = createInMemoryObsidianApp({
    "sase.md": source,
    [DAILY_PATH]: day,
  });
  const editor = createTextEditor(source, { line: 0, ch: 5 });
  const plugin = makePlugin(harness, editor, "sase.md");
  const seen = [];
  installNavStub(plugin, seen);

  const view = Object.assign(new MarkdownView(), {
    editor,
    file: { path: "sase.md" },
  });
  // Ready `[ ]` steps backward into Cancelled `[-]`.
  assert.equal(plugin.handleCycleCommand(false, editor, view, -1), true);
  await settle(plugin);

  assert.match(editor.getValue(), /^- \[-\] #task Fix apollo machine!/m);
  // Recovered to the derived rank with no link and a `cancelled` row (the
  // recovery edit lands in the open editor buffer, as above).
  assert.equal(
    editor.getValue().split("\n")[1],
    "- [ ] #task Re-launch all failed agents on apollo! [dependsOn:: sase__fix-apollo] ^relaunch-failed",
  );
  assert.equal(harness.getSource(DAILY_PATH), day);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].unblocked.length, 1);
  assert.equal(seen[0].unblocked[0].link, null);
  assert.equal(seen[0].unblocked[0].not_linked, "cancelled");
});
