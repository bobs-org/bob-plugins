const test = require("node:test");
const assert = require("node:assert/strict");
const {
  notices,
  NavigationHotkeysPlugin,
  helpers,
  TransactionEditor,
} = require("./navigation-hotkeys-harness.cjs");

function todayDailyPath() {
  const now = new Date();
  const year = String(now.getFullYear()).padStart(4, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}/${year}${month}${day}.md`;
}

function makeNoteIndex(paths) {
  const pathSet = new Set(paths);
  const basenames = new Map();
  for (const item of paths) {
    const base = String(item.split("/").pop() || "")
      .replace(/\.md$/i, "")
      .toLowerCase();
    if (!basenames.has(base)) {
      basenames.set(base, item);
    } else if (basenames.get(base) !== item) {
      basenames.set(base, null);
    }
  }
  return { paths: pathSet, basenames, duplicatePath: false };
}

function makeVaultApp(notes, openEditors) {
  const files = new Map();
  for (const path of Object.keys(notes)) {
    files.set(path, { path, basename: path.split("/").pop(), extension: "md" });
  }
  return {
    notes,
    files,
    vault: {
      getAbstractFileByPath: (path) => files.get(path) || null,
      getMarkdownFiles: () => [...files.values()],
      cachedRead: async (file) => {
        if (!file || !(file.path in notes)) {
          throw new Error(`missing file: ${file && file.path}`);
        }
        return notes[file.path];
      },
      read: async (file) => notes[file.path],
      process: async (file, fn) => {
        const before = notes[file.path];
        notes[file.path] = fn(before);
      },
    },
    metadataCache: {
      getFirstLinkpathDest: (lookup) => {
        const text = String(lookup || "").replace(/\.md$/i, "");
        if (files.has(text)) {
          return files.get(text);
        }
        if (files.has(`${text}.md`)) {
          return files.get(`${text}.md`);
        }
        const base = text.split("/").pop().toLowerCase();
        const matches = [...files.values()].filter(
          (file) =>
            file.basename.toLowerCase() === base ||
            file.basename.toLowerCase() === `${base}.md`,
        );
        return matches.length === 1 ? matches[0] : null;
      },
    },
    workspace: {
      getLeavesOfType: (type) =>
        type === "markdown"
          ? [...openEditors.entries()].map(([path, editor]) => ({
            view: { file: files.get(path), editor },
          }))
          : [],
    },
    plugins: { plugins: {} },
  };
}

test("snoozed cleanup: removes the row when the Pomodoros section is missing", () => {
  const daily = ["## Snoozed", "", "- **1530** [[Tasks#^abc]]", ""].join("\n");
  const plan = helpers.planDeferredPomodoroLinkCleanup(
    daily,
    [{ path: "Tasks.md", blockId: "abc" }],
    { dailyPath: todayDailyPath() },
  );
  assert.equal(plan.changed, true);
  assert.equal(plan.snoozedChanged, true);
  assert.equal(plan.removedLinkCount, 0);
  assert.equal(plan.removedBulletCount, 0);
  assert.deepEqual(plan.removedSnoozedIdentities, ["Tasks.md#^abc"]);
  assert.ok(!plan.content.includes("[[Tasks#^abc]]"));
  assert.ok(!plan.content.includes("## Snoozed"));
  assert.equal(plan.snoozedSectionRemoved, true);
});

test("snoozed cleanup: removes the row when every Pomodoro entry is closed", () => {
  const daily = [
    "## Pomodoros",
    "",
    "- [x] Done (0900-0930)",
    "  - [[Tasks#^abc]]",
    "",
    "## Snoozed",
    "",
    "- **1530** [[Tasks#^abc]]",
    "",
  ].join("\n");
  const plan = helpers.planDeferredPomodoroLinkCleanup(
    daily,
    [{ path: "Tasks.md", blockId: "abc" }],
    { dailyPath: todayDailyPath() },
  );
  assert.equal(plan.changed, true);
  assert.equal(plan.removedLinkCount, 0);
  assert.deepEqual(plan.removedSnoozedIdentities, ["Tasks.md#^abc"]);
  assert.ok(plan.content.includes("## Pomodoros"));
  // The closed entry's link is never a cleanup candidate; only the row goes.
  assert.ok(plan.content.includes("  - [[Tasks#^abc]]"));
  assert.ok(!plan.content.includes("## Snoozed"));
  assert.ok(!plan.content.includes("- **1530**"));
});

test("snoozed cleanup: removes the row when no ledger link matches", () => {
  const daily = [
    "## Pomodoros",
    "",
    "- [ ] Current (0900-0930)",
    "  - [[Other#^zzz]]",
    "",
    "## Snoozed",
    "",
    "- **1530** [[Tasks#^abc]]",
    "",
  ].join("\n");
  const plan = helpers.planDeferredPomodoroLinkCleanup(
    daily,
    [{ path: "Tasks.md", blockId: "abc" }],
    {
      dailyPath: todayDailyPath(),
      noteIndex: makeNoteIndex(["Tasks.md", "Other.md", todayDailyPath()]),
    },
  );
  assert.equal(plan.changed, true);
  assert.equal(plan.removedBulletCount, 0);
  assert.equal(plan.removedLinkCount, 0);
  assert.deepEqual(plan.removedSnoozedIdentities, ["Tasks.md#^abc"]);
  assert.ok(plan.content.includes("[[Other#^zzz]]"));
  assert.ok(!plan.content.includes("- **1530** [[Tasks#^abc]]"));
});

test("snoozed cleanup: composes Pomodoro and Snoozed edits in one apply", () => {
  const daily = [
    "## Pomodoros",
    "",
    "- [ ] Current (0900-0930)",
    "  - [[Tasks#^abc]]",
    "",
    "## Snoozed",
    "",
    "- **1530** [[Tasks#^abc]]",
    "  - remember the notes",
    "",
  ].join("\n");
  const plan = helpers.planDeferredPomodoroLinkCleanup(
    daily,
    [{ path: "Tasks.md", blockId: "abc" }],
    {
      dailyPath: todayDailyPath(),
      noteIndex: makeNoteIndex(["Tasks.md", todayDailyPath()]),
    },
  );
  assert.equal(plan.changed, true);
  assert.equal(plan.removedLinkCount, 1);
  assert.deepEqual(plan.removedSnoozedIdentities, ["Tasks.md#^abc"]);
  assert.equal(plan.removedSnoozedLineRanges.length, 1);
  assert.ok(!plan.content.includes("[[Tasks#^abc]]"));
  assert.ok(!plan.content.includes("remember the notes"));
  assert.ok(plan.content.includes("## Pomodoros"));
  // One empty Snoozed section leaves with the row.
  assert.ok(!plan.content.includes("## Snoozed"));
  assert.equal(plan.snoozedSectionRemoved, true);
  // Cursor math sees both passes in the original coordinates.
  const lines = daily.split("\n").length;
  assert.equal(
    helpers.deferredCleanupRemovedLinesBefore(plan, lines),
    plan.removedLineRanges.reduce(
      (total, range) => total + (range.endLineExclusive - range.startLine),
      0,
    ) +
      plan.removedSnoozedLineRanges.reduce(
        (total, range) => total + (range.endLineExclusive - range.startLine),
        0,
      ),
  );
});

test("snoozed cleanup: empty targets and unresolvable rows change nothing", () => {
  const daily = ["## Snoozed", "", "- **1530** [[Tasks#^abc]]", ""].join("\n");
  const empty = helpers.planDeferredPomodoroLinkCleanup(daily, [], {
    dailyPath: todayDailyPath(),
  });
  assert.equal(empty.changed, false);
  assert.equal(empty.snoozedChanged, false);
  assert.equal(empty.content, daily);

  const other = helpers.planDeferredPomodoroLinkCleanup(
    daily,
    [{ path: "Elsewhere.md", blockId: "zzz" }],
    { dailyPath: todayDailyPath() },
  );
  assert.equal(other.changed, false);
  assert.deepEqual(other.removedSnoozedIdentities, []);
  assert.equal(other.content, daily);
});

test("snoozed cleanup: ambiguous basenames keep the row", () => {
  const daily = ["## Snoozed", "", "- **1530** [[Tasks#^abc]]", ""].join("\n");
  // No vault path matches "Tasks" exactly and two notes share the basename,
  // so the row target cannot resolve and the row stays put.
  const index = makeNoteIndex(["A/Tasks.md", "B/Tasks.md", todayDailyPath()]);
  assert.equal(index.basenames.get("tasks"), null);
  const plan = helpers.planDeferredPomodoroLinkCleanup(
    daily,
    [{ path: "A/Tasks.md", blockId: "abc" }],
    { dailyPath: todayDailyPath(), noteIndex: index },
  );
  assert.equal(plan.changed, false);
  assert.equal(plan.content, daily);
});

test("snoozed cleanup: prose keeps the section, history and malformed rows stay", () => {
  const daily = [
    "## Snoozed",
    "",
    "still thinking about this",
    "",
    "- **1530** [[Tasks#^abc]]",
    "",
    "- **late** [[Tasks#^abc]]",
    "",
  ].join("\n");
  const plan = helpers.planDeferredPomodoroLinkCleanup(
    daily,
    [{ path: "Tasks.md", blockId: "abc" }],
    { dailyPath: todayDailyPath() },
  );
  assert.equal(plan.changed, true);
  assert.equal(plan.snoozedSectionRemoved, false);
  assert.ok(plan.content.includes("## Snoozed"));
  assert.ok(plan.content.includes("still thinking about this"));
  assert.ok(plan.content.includes("- **late** [[Tasks#^abc]]"));
  assert.ok(!plan.content.includes("- **1530** [[Tasks#^abc]]"));
});

test("snoozed cleanup: CRLF daily keeps CRLF and drops the subtree", () => {
  const daily = [
    "## Snoozed",
    "",
    "- **1530** [[Tasks#^abc]]",
    "  - child note",
    "  - another child",
    "",
  ].join("\r\n");
  const plan = helpers.planDeferredPomodoroLinkCleanup(
    daily,
    [{ path: "Tasks.md", blockId: "abc" }],
    { dailyPath: todayDailyPath() },
  );
  assert.equal(plan.changed, true);
  assert.ok(!plan.content.includes("child"));
  assert.ok(!plan.content.match(/(?<!\r)\n/));
});

test("snoozed lane discovery: matches rows and children, misses the rest", () => {
  const content = [
    "## Snoozed",
    "",
    "- **1530** [[Tasks#^abc]]",
    "  - child note",
    "",
    "- **late** [[Tasks#^abc]]",
    "",
    "## Other",
    "",
    "- **1530** [[Tasks#^abc]]",
    "",
  ].join("\n");
  const onRow = helpers.discoverSnoozedRowLaneTarget(content, 2);
  assert.ok(onRow);
  assert.equal(onRow.row.blockId, "abc");
  assert.equal(onRow.discovery.targets[0].link.target, "Tasks");
  const onChild = helpers.discoverSnoozedRowLaneTarget(content, 3);
  assert.ok(onChild);
  assert.equal(onChild.row.blockId, "abc");
  assert.equal(helpers.discoverSnoozedRowLaneTarget(content, 5), null);
  assert.equal(helpers.discoverSnoozedRowLaneTarget(content, 9), null);
  assert.equal(helpers.discoverSnoozedRowLaneTarget(content, 0), null);
});

test("Alt+N on a Snoozed row releases the separate-note task and prunes both links", async () => {
  notices.length = 0;
  const dailyPath = todayDailyPath();
  const taskContent = "- [*] #task Ship it ^abc";
  const dailyContent = [
    "## Pomodoros",
    "",
    "- [ ] Current (0900-0930)",
    "  - [[Tasks#^abc]]",
    "",
    "## Snoozed",
    "",
    "- **1530** [[Tasks#^abc]]",
    "  - remember the notes",
    "",
  ].join("\n");
  const notes = { "Tasks.md": taskContent, [dailyPath]: dailyContent };
  const dailyEditor = new TransactionEditor(dailyContent, { line: 7, ch: 3 });
  const app = makeVaultApp(notes, new Map([[dailyPath, dailyEditor]]));
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = app;
  plugin.getActiveMarkdownView = () => ({
    editor: dailyEditor,
    file: app.files.get(dailyPath),
  });

  assert.equal(await plugin.toggleTaskLane(dailyEditor), true);
  assert.equal(notes["Tasks.md"], "- [ ] #task Ship it ^abc");
  const after = String(dailyEditor.getValue());
  assert.ok(!after.includes("[[Tasks#^abc]]"));
  assert.ok(after.includes("## Pomodoros"));
  assert.ok(!after.includes("## Snoozed"));
});

test("Alt+N on a Snoozed row folds the release when the task lives in the daily note", async () => {
  notices.length = 0;
  const dailyPath = todayDailyPath();
  const dailyContent = [
    "- [*] #task Ship it ^abc",
    "",
    "## Pomodoros",
    "",
    "- [ ] Current (0900-0930)",
    "  - [[#^abc]]",
    "",
    "## Snoozed",
    "",
    "- **1530** [[#^abc]]",
    "",
  ].join("\n");
  const notes = { [dailyPath]: dailyContent };
  const dailyEditor = new TransactionEditor(dailyContent, { line: 9, ch: 3 });
  const app = makeVaultApp(notes, new Map([[dailyPath, dailyEditor]]));
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = app;
  plugin.getActiveMarkdownView = () => ({
    editor: dailyEditor,
    file: app.files.get(dailyPath),
  });

  assert.equal(await plugin.toggleTaskLane(dailyEditor), true);
  const after = String(dailyEditor.getValue());
  assert.ok(after.includes("- [ ] #task Ship it ^abc"));
  assert.ok(!after.includes("[[#^abc]]"));
  assert.ok(!after.includes("## Snoozed"));
});

test("decay Next → Ready composes the daily cleanup in one write", async () => {
  notices.length = 0;
  const dailyPath = todayDailyPath();
  const taskLine = "- [*] #task Ship it ^abc";
  const dailyContent = [
    taskLine,
    "",
    "## Pomodoros",
    "",
    "- [ ] Current (0900-0930)",
    "  - [[#^abc]]",
    "",
    "## Snoozed",
    "",
    "- **1530** [[#^abc]]",
    "",
  ].join("\n");
  const notes = { [dailyPath]: dailyContent };
  const dailyEditor = new TransactionEditor(dailyContent, { line: 0, ch: 0 });
  const app = makeVaultApp(notes, new Map([[dailyPath, dailyEditor]]));
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = app;
  plugin.getActiveMarkdownView = () => ({
    editor: dailyEditor,
    file: app.files.get(dailyPath),
  });
  const cardCtx = {
    cm: dailyEditor,
    filePath: dailyPath,
    line: 0,
    rawLine: taskLine,
    invokeCh: 0,
    dateText: "2026-11-26",
    rung: "Next",
    keeps: 0,
    advance: false,
    queueBefore: [],
    plan: { step: { available: true, kind: "lane", toLabel: "Ready" } },
  };
  const ok = await plugin.applyFreshnessDecayCardStep(cardCtx, {
    content: dailyContent,
    lineText: taskLine,
  });
  assert.equal(ok, true);
  const after = String(dailyEditor.getValue());
  assert.ok(after.includes("- [ ] #task Ship it ^abc"));
  assert.ok(!after.includes("[[#^abc]]"));
  assert.ok(!after.includes("## Snoozed"));
});

test("decay WIP → Next keeps the Snoozed row parked", async () => {
  notices.length = 0;
  const dailyPath = todayDailyPath();
  const taskLine = "- [/] #task Ship it ^abc";
  const dailyContent = [
    taskLine,
    "",
    "## Snoozed",
    "",
    "- **1530** [[#^abc]]",
    "",
  ].join("\n");
  const notes = { [dailyPath]: dailyContent };
  const dailyEditor = new TransactionEditor(dailyContent, { line: 0, ch: 0 });
  const app = makeVaultApp(notes, new Map([[dailyPath, dailyEditor]]));
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = app;
  plugin.getActiveMarkdownView = () => ({
    editor: dailyEditor,
    file: app.files.get(dailyPath),
  });
  const cardCtx = {
    cm: dailyEditor,
    filePath: dailyPath,
    line: 0,
    rawLine: taskLine,
    invokeCh: 0,
    dateText: "2026-11-26",
    rung: "WIP",
    keeps: 0,
    advance: false,
    queueBefore: [],
    plan: { step: { available: true, kind: "lane", toLabel: "Next" } },
  };
  const ok = await plugin.applyFreshnessDecayCardStep(cardCtx, {
    content: dailyContent,
    lineText: taskLine,
  });
  assert.equal(ok, true);
  const after = String(dailyEditor.getValue());
  assert.ok(after.includes("- [*] #task Ship it ^abc"));
  assert.ok(after.includes("- **1530** [[#^abc]]"));
});

test("Alt+N on a Snoozed row writes nothing when the task target is gone", async () => {
  notices.length = 0;
  const dailyPath = todayDailyPath();
  const dailyContent = [
    "## Snoozed",
    "",
    "- **1530** [[Tasks#^abc]]",
    "",
  ].join("\n");
  const notes = { [dailyPath]: dailyContent };
  const dailyEditor = new TransactionEditor(dailyContent, { line: 2, ch: 3 });
  const app = makeVaultApp(notes, new Map([[dailyPath, dailyEditor]]));
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = app;
  plugin.getActiveMarkdownView = () => ({
    editor: dailyEditor,
    file: app.files.get(dailyPath),
  });

  assert.equal(await plugin.toggleTaskLane(dailyEditor), false);
  assert.equal(String(dailyEditor.getValue()), dailyContent);
  assert.ok(notices.length > 0);
});
