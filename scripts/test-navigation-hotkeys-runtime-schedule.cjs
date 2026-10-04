const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  notices,
  NavigationHotkeysPlugin,
  helpers,
  TransactionEditor,
  compatibleTasksSettings,
  assertLineBoundedTransaction,
} = require("./navigation-hotkeys-harness.cjs");

test("bare future scheduled writes block only real supported open inline tasks", async () => {
  const cases = [
    ["- [ ] #task Ready [scheduled:: 2099-07-23] ^ready", "?"],
    ["- [*] #task Next ^next", "?"],
    ["- [/] #task Working ^working", "?"],
    ["- [?] #task Blocked ^blocked", "?"],
    ["- [x] #task Done ^done", "x"],
    ["- [-] #task Canceled ^canceled", "-"],
    ["- [!] #task Unknown ^unknown", "!"],
    ["- [ ] Plain checkbox", null],
    ["- ordinary bullet", null],
    ["- [ ] #task Project lifecycle ^prj", " "],
  ];
  for (const [line, expectedStatus] of cases) {
    notices.length = 0;
    const editor = new TransactionEditor(line, { line: 0, ch: 6 }, 333);
    const plugin = new NavigationHotkeysPlugin();
    assert.equal(
      await plugin.setBulletPropertyValue(
        editor,
        { line: 0, ch: 6 },
        "scheduled",
        "2099-07-23",
      ),
      true,
      line,
    );
    assert.match(editor.content, /\[scheduled:: 2099-07-23\]/, line);
    assert.equal(
      helpers.getObsidianTaskCheckboxStatus(editor.content),
      expectedStatus,
      line,
    );
    assert.equal(editor.getScrollInfo().top, 333);
    assert.deepEqual(editor.getCursor(), { line: 0, ch: 6 });
  }
});

test("single runtime transclusion toggle preserves viewport in one line transaction", async () => {
  const activeFile = { path: "Here.md", extension: "md" };
  const lines = Array.from({ length: 24 }, (_, index) => `context ${index}`);
  const activeLine = 8;
  lines[activeLine] = "- [[Target]] trailing";
  const editor = new TransactionEditor(lines.join("\n"), {
    line: activeLine,
    ch: 10,
  });
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => activeFile },
  };
  const originalScrollTop = editor.getScrollInfo().top;

  assert.equal(await plugin.toggleCurrentLineTransclusions(editor), true);

  assert.equal(editor.transactions.length, 1);
  assert.deepEqual(editor.transactionScrollTops, [originalScrollTop]);
  assert.equal(editor.getScrollInfo().top, originalScrollTop);
  assert.deepEqual(editor.setCursorCalls, []);
  assertLineBoundedTransaction(editor.transactions[0], lines, [activeLine]);
  assert.deepEqual(editor.transactions[0].selection, {
    from: { line: activeLine, ch: 11 },
    to: { line: activeLine, ch: 11 },
  });
  assert.equal(editor.getLine(activeLine), "- ![[Target]] trailing");
});

test("same-file runtime toggle changes only markers, never fields or statuses", async () => {
  const activeFile = { path: "Here.md", extension: "md" };
  const lines = Array.from({ length: 24 }, (_, index) => `context ${index}`);
  const parentLine = 3;
  const activeLine = 6;
  const targetLine = 15;
  lines[parentLine] = "- [/] #task Parent ^parent";
  lines[4] = "  - supporting detail";
  lines[5] = "  - another detail";
  lines[activeLine] = "  - [[#^target]]";
  lines[targetLine] = "- [ ] #task Target ^target";
  const editor = new TransactionEditor(lines.join("\n"), {
    line: activeLine,
    ch: 12,
  });
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => activeFile },
  };
  const originalScrollTop = editor.getScrollInfo().top;

  assert.equal(await plugin.toggleCurrentLineTransclusions(editor), true);

  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.undoGroups, 1);
  assertLineBoundedTransaction(editor.transactions[0], lines, [activeLine]);
  assert.deepEqual(editor.transactions[0].selection, {
    from: { line: activeLine, ch: 13 },
    to: { line: activeLine, ch: 13 },
  });
  assert.equal(editor.getLine(parentLine), "- [/] #task Parent ^parent");
  assert.equal(editor.getLine(activeLine), "  - ![[#^target]]");
  assert.equal(editor.getLine(targetLine), "- [ ] #task Target ^target");
  assert.equal(editor.getScrollInfo().top, originalScrollTop);

  const beforeRemovalLines = editor.content.split("\n");
  assert.equal(await plugin.toggleCurrentLineTransclusions(editor), true);

  assert.equal(editor.transactions.length, 2);
  assert.equal(editor.undoGroups, 2);
  assertLineBoundedTransaction(
    editor.transactions[1],
    beforeRemovalLines,
    [activeLine],
  );
  assert.deepEqual(editor.transactions[1].selection, {
    from: { line: activeLine, ch: 12 },
    to: { line: activeLine, ch: 12 },
  });
  assert.equal(editor.getLine(parentLine), "- [/] #task Parent ^parent");
  assert.equal(editor.getLine(activeLine), "  - [[#^target]]");
  assert.equal(editor.getLine(targetLine), "- [ ] #task Target ^target");
  assert.equal(editor.getScrollInfo().top, originalScrollTop);
});
test("pure toggle leaves a cursor moved during the toggle where it landed", async () => {
  const activeFile = { path: "Here.md", extension: "md" };
  const lines = [
    "- [/] #task Parent ^parent",
    "  - [[Other#^target]]",
    "after",
  ];
  const editor = new TransactionEditor(lines.join("\n"), {
    line: 1,
    ch: 12,
  });
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => activeFile },
  };
  const originalScrollTop = editor.getScrollInfo().top;

  const toggle = plugin.toggleCurrentLineTransclusions(editor);
  editor.setCursor({ line: 2, ch: 0 });

  assert.equal(await toggle, true);
  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.undoGroups, 1);
  assertLineBoundedTransaction(editor.transactions[0], lines, [1]);
  assert.deepEqual(editor.transactions[0].selection, {
    from: { line: 1, ch: 13 },
    to: { line: 1, ch: 13 },
  });
  assert.deepEqual(editor.getCursor(), { line: 2, ch: 0 });
  assert.equal(editor.getScrollInfo().top, originalScrollTop);
  assert.equal(editor.getLine(0), "- [/] #task Parent ^parent");
  assert.equal(editor.getLine(1), "  - ![[Other#^target]]");
});
test("counted runtime transclusion toggle preserves viewport and caret", async () => {
  const activeFile = { path: "Here.md", extension: "md" };
  const lines = Array.from({ length: 22 }, (_, index) => `context ${index}`);
  const activeLine = 7;
  lines[activeLine] = "- [[One]]";
  lines[activeLine + 2] = "- ![[Two]]";
  const cursor = { line: activeLine, ch: 7 };
  const editor = new TransactionEditor(lines.join("\n"), cursor, 720);
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => activeFile },
  };

  assert.equal(
    await plugin.toggleCountedLineTransclusions(editor, cursor, 2),
    true,
  );

  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.undoGroups, 1);
  assert.deepEqual(editor.transactionScrollTops, [720]);
  assert.equal(editor.getScrollInfo().top, 720);
  assertLineBoundedTransaction(
    editor.transactions[0],
    lines,
    [activeLine, activeLine + 2],
  );
  assert.deepEqual(editor.transactions[0].selection, {
    from: { line: activeLine, ch: 8 },
    to: { line: activeLine, ch: 8 },
  });
  assert.equal(editor.getLine(activeLine), "- ![[One]]");
  assert.equal(editor.getLine(activeLine + 2), "- [[Two]]");
});

test("counted property runtime uses one transaction and preserves caret and viewport", async () => {
  notices.length = 0;
  const lines = [
    "- [ ] #task One [created:: 2026-07-01] ^one",
    "prose",
    "- [/] #task Two [scheduled:: 2026-07-20] ^two",
    "- plain bullet",
    "> - [x] #task Three [scheduled:: 2099-07-23] ^three",
  ];
  const cursor = { line: 0, ch: 18 };
  const editor = new TransactionEditor(lines.join("\r\n"), cursor, 812);
  const session = helpers.discoverCountedObsidianTaskTargets(
    editor.content,
    0,
    2,
  );
  const file = { path: "sase.md", extension: "md" };
  const plugin = new NavigationHotkeysPlugin();
  plugin.getActiveMarkdownView = () => ({ editor, file });

  assert.equal(
    await plugin.setCountedBulletPropertyValue(
      editor,
      cursor,
      file.path,
      session,
      "scheduled",
      "2099-07-23",
    ),
    true,
  );
  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.undoGroups, 1);
  assert.deepEqual(editor.transactionScrollTops, [812]);
  assert.equal(editor.getScrollInfo().top, 812);
  assertLineBoundedTransaction(editor.transactions[0], lines, [0, 2]);
  assert.deepEqual(editor.transactions[0].selection, {
    from: cursor,
    to: cursor,
  });
  assert.match(editor.getLine(0), /\[\?\].*\[created:: 2026-07-01\].*\^one/);
  assert.match(editor.getLine(2), /\[\?\].*\[scheduled:: 2099-07-23\].*\^two/);
  assert.match(notices.at(-1), /2 tasks.*1 task unchanged.*2 tasks Blocked/);
});

test("bare due schedule recovery is guarded and can change only task status", async () => {
  notices.length = 0;
  const line =
    "- [?] #task Due [scheduled:: 2000-01-01] [dependsOn:: missing] ^due";
  const editor = new TransactionEditor(line, { line: 0, ch: 18 }, 611);
  const file = { path: "Tasks.md", extension: "md" };
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getLeavesOfType: () => [] },
    vault: {
      getMarkdownFiles: () => [file],
      cachedRead: async () => line,
      adapter: {
        read: async () => JSON.stringify(compatibleTasksSettings()),
      },
    },
  };
  plugin.getActiveMarkdownView = () => ({ editor, file });

  assert.equal(
    await plugin.setBulletPropertyValue(
      editor,
      { line: 0, ch: 18 },
      "scheduled",
      "2000-01-01",
      { filePath: file.path, expectedLine: line },
    ),
    true,
  );
  assert.equal(editor.transactions.length, 0);
  assert.match(editor.content, /- \[ \] #task Due/);
  assert.match(editor.content, /\[scheduled:: 2000-01-01\]/);
  assert.equal(editor.getScrollInfo().top, 611);
  assert.match(notices.at(-1), /recovered 1 task Ready/);
});

test("counted due recovery applies Ready Next and In Progress in one transaction", async () => {
  notices.length = 0;
  const source = [
    "- [?] #task Ready [scheduled:: 2000-01-01] ^ready",
    "- [?] #task Next [scheduled:: 2000-01-01] ^next",
    "- [?] #task Root [scheduled:: 2000-01-01] [dependsOn:: Tasks__done-helper] ^root",
    "  - ⛓️ **DEPENDS ON:** [[#^done-helper]]",
    "- [/] #task Working [dependsOn:: Tasks__graph] ^working",
    "  - ⛓️ **DEPENDS ON:** [[#^graph]]",
    "- [?] #task Graph [scheduled:: 2000-01-01] [id:: Tasks__graph] ^graph",
    "- [x] #task Done helper [id:: Tasks__done-helper] ^done-helper",
  ].join("\r\n");
  const today = new Date();
  const year = String(today.getFullYear()).padStart(4, "0");
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  const dailyPath = `${year}/${year}${month}${day}.md`;
  const dailyContent = [
    "## Pomodoros",
    "",
    "- [ ] Current (0900-0930)",
    "  - [[Tasks#^next]]",
    "  - [[Tasks#^root]]",
    "  - [[Tasks#^working]]",
  ].join("\n");
  const editor = new TransactionEditor(source, { line: 0, ch: 12 }, 701);
  const sourceFile = { path: "Tasks.md", extension: "md" };
  const dailyFile = { path: dailyPath, extension: "md" };
  const contents = new Map([
    [sourceFile.path, source],
    [dailyFile.path, dailyContent],
  ]);
  const session = helpers.discoverCountedObsidianTaskTargets(source, 0, 4);
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getLeavesOfType: () => [] },
    vault: {
      getMarkdownFiles: () => [sourceFile, dailyFile],
      cachedRead: async (file) => contents.get(file.path),
      adapter: {
        read: async () => JSON.stringify(compatibleTasksSettings()),
      },
    },
  };
  plugin.getActiveMarkdownView = () => ({ editor, file: sourceFile });

  assert.equal(
    await plugin.setCountedBulletPropertyValue(
      editor,
      { line: 0, ch: 12 },
      sourceFile.path,
      session,
      "scheduled",
      "2000-01-01",
    ),
    true,
  );
  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.undoGroups, 1);
  assert.deepEqual(
    editor.content
      .split(/\r?\n/)
      .filter((line) => helpers.isObsidianTaskLine(line))
      .map((line) => helpers.getObsidianTaskCheckboxStatus(line)),
    [" ", "*", "*", "/", "/", "x"],
  );
  assert.match(
    notices.at(-1),
    /recovered 1 task Ready.*recovered 2 tasks Next.*recovered 1 task In Progress/,
  );
});

test("scheduled recovery aborts after an asynchronous source change", async () => {
  notices.length = 0;
  const source =
    "- [?] #task Due [scheduled:: 2000-01-01] ^due";
  const editor = new TransactionEditor(source, { line: 0, ch: 8 });
  const sourceFile = { path: "Tasks.md", extension: "md" };
  const otherFile = { path: "Other.md", extension: "md" };
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getLeavesOfType: () => [] },
    vault: {
      getMarkdownFiles: () => [sourceFile, otherFile],
      cachedRead: async () => {
        editor.content += "\nuser edit";
        return "- [ ] #task Other ^other";
      },
      adapter: {
        read: async () => JSON.stringify(compatibleTasksSettings()),
      },
    },
  };
  plugin.getActiveMarkdownView = () => ({ editor, file: sourceFile });

  assert.equal(
    await plugin.setBulletPropertyValue(
      editor,
      { line: 0, ch: 8 },
      "scheduled",
      "2000-01-01",
      { filePath: sourceFile.path, expectedLine: source },
    ),
    false,
  );
  assert.deepEqual(editor.transactions, []);
  assert.match(editor.content, /user edit/);
  assert.match(notices.at(-1), /changed/);
});

test("counted property runtime aborts a stale batch without a transaction", async () => {
  notices.length = 0;
  const editor = new TransactionEditor(
    "- [ ] #task One\n- [ ] #task Two",
    { line: 0, ch: 4 },
  );
  const session = helpers.discoverCountedObsidianTaskTargets(
    editor.content,
    0,
    1,
  );
  editor.content = editor.content.replace("Two", "Two changed");
  const file = { path: "Tasks.md", extension: "md" };
  const plugin = new NavigationHotkeysPlugin();
  plugin.getActiveMarkdownView = () => ({ editor, file });

  assert.equal(
    await plugin.setCountedBulletPropertyValue(
      editor,
      { line: 0, ch: 4 },
      file.path,
      session,
      "p",
      "high",
    ),
    false,
  );
  assert.deepEqual(editor.transactions, []);
  assert.doesNotMatch(editor.content, /\[p::/);
  assert.match(notices.at(-1), /no tasks were updated/);
});

test("counted project scheduling is one structural transaction", async () => {
  const input = [
    "---",
    "type: [[project]]",
    "---",
    "- [ ] #task Ship ^prj",
    "- [/] #task Follow up ^follow",
  ].join("\r\n");
  const cursor = { line: 3, ch: 12 };
  const editor = new TransactionEditor(input, cursor, 934);
  const session = helpers.discoverCountedObsidianTaskTargets(input, 3, 1);
  const file = { path: "projects/Ship.md", extension: "md" };
  const plugin = new NavigationHotkeysPlugin();
  plugin.getActiveMarkdownView = () => ({ editor, file });

  assert.equal(
    await plugin.setCountedBulletPropertyValue(
      editor,
      cursor,
      file.path,
      session,
      "scheduled",
      "2026-07-23",
    ),
    true,
  );
  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.undoGroups, 1);
  assert.deepEqual(editor.transactionScrollTops, [934]);
  assert.equal(editor.transactions[0].changes.length, 1);
  assert.deepEqual(editor.transactions[0].changes[0].from, { line: 0, ch: 0 });
  assert.deepEqual(editor.transactions[0].selection, {
    from: { line: 4, ch: 12 },
    to: { line: 4, ch: 12 },
  });
  assert.equal(editor.content.includes("\r\n"), true);
  assert.match(editor.content, /^scheduled: 2026-07-23$/m);
  assert.doesNotMatch(editor.getLine(4), /\[scheduled::/);
  assert.match(editor.getLine(5), /\[scheduled:: 2026-07-23\]/);
});

test("single project scheduling recovers due tasks in one guarded transaction", async () => {
  notices.length = 0;
  const input = [
    "---",
    "type: [[project]]",
    "scheduled: 2099-01-01",
    "---",
    "- [ ] #task Ship #hide ^prj",
    "- [?] #task Ready [scheduled:: 2000-01-01] ^ready",
  ].join("\r\n");
  const cursor = { line: 4, ch: 12 };
  const editor = new TransactionEditor(input, cursor, 733);
  const file = { path: "projects/Ship.md", extension: "md" };
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getLeavesOfType: () => [] },
    vault: {
      getMarkdownFiles: () => [file],
      cachedRead: async () => input,
      adapter: {
        read: async () => JSON.stringify(compatibleTasksSettings()),
      },
    },
  };
  plugin.getActiveMarkdownView = () => ({ editor, file });

  assert.equal(
    await plugin.setProjectNoteScheduledValue(
      editor,
      cursor,
      file.path,
      input.split(/\r?\n/)[4],
      "2099-01-01",
      "2000-01-01",
    ),
    true,
  );
  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.undoGroups, 1);
  assert.deepEqual(editor.transactionScrollTops, [733]);
  assert.equal(editor.getScrollInfo().top, 733);
  assert.match(editor.content, /^scheduled: 2000-01-01$/m);
  assert.match(
    editor.content,
    /- \[ \] #task Ready \[scheduled:: 2000-01-01\] \^ready/,
  );
  assert.match(notices.at(-1), /recovered 1 task Ready/);
});

test("single project schedule deletion removes propagated fields and recovers", async () => {
  notices.length = 0;
  const input = [
    "---",
    "type: [[project]]",
    "scheduled: 2099-01-01",
    "---",
    "- [ ] #task Ship #hide ^prj",
    "- [?] #task Ready [scheduled:: 2099-01-01] ^ready",
    "- [?] #task Own later [scheduled:: 2099-01-02] ^later",
  ].join("\n");
  const cursor = { line: 4, ch: 12 };
  const editor = new TransactionEditor(input, cursor, 744);
  const file = { path: "projects/Ship.md", extension: "md" };
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getLeavesOfType: () => [] },
    vault: {
      getMarkdownFiles: () => [file],
      cachedRead: async () => input,
      adapter: {
        read: async () => JSON.stringify(compatibleTasksSettings()),
      },
    },
  };
  plugin.getActiveMarkdownView = () => ({ editor, file });

  const result = await plugin.deleteProjectNoteScheduledValue(
    editor,
    cursor,
    file.path,
    input.split("\n")[4],
    "2099-01-01",
  );
  assert.equal(result.deleted, true);
  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.undoGroups, 1);
  assert.deepEqual(editor.transactionScrollTops, [744]);
  assert.doesNotMatch(editor.content, /^scheduled:/m);
  assert.match(editor.content, /- \[ \] #task Ready \^ready/);
  assert.match(
    editor.content,
    /- \[\?\] #task Own later \[scheduled:: 2099-01-02\] \^later/,
  );
  assert.match(
    notices.at(-1),
    /removed propagated schedule from 1 task.*recovered 1 task Ready/,
  );
});
