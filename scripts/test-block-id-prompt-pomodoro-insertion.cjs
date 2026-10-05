const test = require("node:test");
const assert = require("node:assert/strict");
const {
  Plugin,
  helpers,
  resetNotices,
  localDate,
  createEditor,
  applyPlannedEdits,
  sourceForPomodoroLink,
} = require("./block-id-prompt-harness.cjs");

test("findDirectPomodoroLinkTask includes a #hide project task, unlike the task-picker's own listing", () => {
  const line = "- [ ] #task #hide Secret errand";
  const task = helpers.findDirectPomodoroLinkTask(line, 0);
  assert.ok(task);
  assert.equal(task.status, " ");
  assert.equal(helpers.collectTaskPickerItems(line).length, 0);
});

test("findDirectPomodoroLinkTask rejects closed/canceled tasks and non-task lines", () => {
  assert.equal(helpers.findDirectPomodoroLinkTask("- [x] #task Done already", 0), null);
  assert.equal(helpers.findDirectPomodoroLinkTask("- [-] #task Canceled", 0), null);
  assert.equal(helpers.findDirectPomodoroLinkTask("Just a paragraph.", 0), null);
  assert.equal(helpers.findDirectPomodoroLinkTask("- plain list item, not a task", 0), null);
  assert.equal(helpers.findDirectPomodoroLinkTask("- [ ] no task tag here", 0), null);
});

test("findDirectPomodoroLinkTask accepts every open status and carries the existing block ID", () => {
  for (const status of [" ", "/", "*", "?"]) {
    const task = helpers.findDirectPomodoroLinkTask(`- [${status}] #task Ship it ^ship`, 3);
    assert.ok(task);
    assert.equal(task.status, status);
    assert.equal(task.existingId, "ship");
    assert.equal(task.line, 3);
  }
});

test("todayDailyPath formats the default YYYY/YYYYMMDD layout under the configured folder", () => {
  const path = helpers.todayDailyPath(localDate(2026, 8, 5), {
    folder: "Daily",
    format: "YYYY/YYYYMMDD",
  });
  assert.equal(path, "Daily/2026/20260805.md");
});

test("todayDailyPath honors a custom Daily Notes format and an empty folder", () => {
  const path = helpers.todayDailyPath(localDate(2026, 3, 9), { folder: "", format: "YYYY-MM-DD" });
  assert.equal(path, "2026-03-09.md");
});

test("formatDailyDate resolves bracketed literal text alongside date tokens", () => {
  const text = helpers.formatDailyDate(localDate(2026, 1, 2), "[Day] YYYY-MM-DD");
  assert.equal(text, "Day 2026-01-02");
});

test("getDailyNotesOptions reads the daily-notes core plugin's configured options", () => {
  const app = {
    internalPlugins: {
      plugins: {
        "daily-notes": { instance: { options: { folder: "Daily", format: "YYYY/YYYYMMDD" } } },
      },
    },
  };
  assert.deepEqual(helpers.getDailyNotesOptions(app), { folder: "Daily", format: "YYYY/YYYYMMDD" });
  assert.deepEqual(helpers.getDailyNotesOptions({}), {});
});

test("computeFencedLineFlags marks opening and closing fence lines and everything between", () => {
  const lines = ["before", "```", "inside", "```", "after"];
  assert.deepEqual(helpers.computeFencedLineFlags(lines), [false, true, true, true, false]);
});

test("selectPomodoroInsertionTarget prefers the single open timed entry over a placeholder", () => {
  const lines = ["## Pomodoros", "- [ ] Next ()", "- [ ] Current (10:00-10:25)"];
  const section = { startLine: 1, endLine: 2 };
  const fenced = helpers.computeFencedLineFlags(lines);
  assert.deepEqual(helpers.selectPomodoroInsertionTarget(lines, section, fenced), {
    entryLine: 2,
  });
});

test("selectPomodoroInsertionTarget falls back to the first open placeholder when nothing is timed", () => {
  const lines = ["## Pomodoros", "- [x] Done (09:00-09:25)", "- [ ] Later ()", "- [ ] Even later ()"];
  const section = { startLine: 1, endLine: 3 };
  const fenced = helpers.computeFencedLineFlags(lines);
  assert.deepEqual(helpers.selectPomodoroInsertionTarget(lines, section, fenced), {
    entryLine: 2,
  });
});

test("selectPomodoroInsertionTarget rejects more than one open timed entry", () => {
  const lines = ["## Pomodoros", "- [ ] A (10:00-10:25)", "- [ ] B (11:00-11:25)"];
  const section = { startLine: 1, endLine: 2 };
  const fenced = helpers.computeFencedLineFlags(lines);
  assert.deepEqual(helpers.selectPomodoroInsertionTarget(lines, section, fenced), {
    error: "multiple-open-timed",
  });
});

test("selectPomodoroInsertionTarget ignores fenced and nested entries and picks the remaining eligible one", () => {
  const lines = [
    "## Pomodoros",
    "```",
    "- [ ] Fake (10:00-10:25)",
    "```",
    "- [ ] Real ()",
    "  - [ ] #task nested, not a top-level entry (12:00-12:25)",
  ];
  const section = { startLine: 1, endLine: 5 };
  const fenced = helpers.computeFencedLineFlags(lines);
  assert.deepEqual(helpers.selectPomodoroInsertionTarget(lines, section, fenced), {
    entryLine: 4,
  });
});

test("findPomodoroChildIndentation reuses existing child indentation before falling back to a tab", () => {
  const withOwnChild = ["## Pomodoros", "- [ ] Current ()", "\t- existing child"];
  assert.equal(
    helpers.findPomodoroChildIndentation(withOwnChild, 1, 2, { startLine: 1, endLine: 2 }),
    "\t",
  );

  const withSectionChild = ["## Pomodoros", "- [ ] Current ()", "- [ ] Other ()", "\t- other's child"];
  assert.equal(
    helpers.findPomodoroChildIndentation(withSectionChild, 1, 1, { startLine: 1, endLine: 3 }),
    "\t",
  );

  const withNoChild = ["## Pomodoros", "- [ ] Current ()"];
  assert.equal(
    helpers.findPomodoroChildIndentation(withNoChild, 1, 1, { startLine: 1, endLine: 1 }),
    "\t",
  );
});

test("planPomodoroLinkInsertion inserts under the selected entry using an existing child's indentation", () => {
  const daily = [
    "## Pomodoros",
    "- [x] Done (09:00-09:25) old task",
    "- [ ] Current (10:00-10:25) something",
    "  - [[Other#^abc]]",
    "- [ ] Next ()",
  ].join("\n");
  const plan = helpers.planPomodoroLinkInsertion(daily, {
    blockId: "foobar",
    targetPath: "Tasks.md",
    sourcePath: "Daily.md",
    resolveTarget: (reference) =>
      reference.oldId === "abc" ? "Other.md" : reference.oldId === "foobar" ? "Tasks.md" : null,
    linkText: "[[Tasks#^foobar]]",
  });
  assert.equal(plan.entryLine, 2);
  assert.equal(plan.alreadyLinked, false);
  assert.equal(plan.removedCount, 0);
  assert.equal(
    plan.content,
    [
      "## Pomodoros",
      "- [x] Done (09:00-09:25) old task",
      "- [ ] Current (10:00-10:25) something",
      "  - [[Other#^abc]]",
      "  - [[Tasks#^foobar]]",
      "- [ ] Next ()",
    ].join("\n"),
  );
});

test("planPomodoroLinkInsertion is idempotent and prunes a matching link from a later open Pomodoro", () => {
  const daily = [
    "## Pomodoros",
    "- [ ] Current (10:00-10:25)",
    "  - [[Tasks#^foobar]]",
    "- [ ] Next ()",
    "  - [[Tasks#^foobar]]",
  ].join("\n");
  const plan = helpers.planPomodoroLinkInsertion(daily, {
    blockId: "foobar",
    targetPath: "Tasks.md",
    sourcePath: "Daily.md",
    resolveTarget: (reference) => (reference.oldId === "foobar" ? "Tasks.md" : null),
    linkText: "[[Tasks#^foobar]]",
  });
  assert.equal(plan.alreadyLinked, true);
  assert.equal(plan.removedCount, 1);
  assert.equal(
    plan.content,
    ["## Pomodoros", "- [ ] Current (10:00-10:25)", "  - [[Tasks#^foobar]]", "- [ ] Next ()", ""].join(
      "\n",
    ),
  );
});

test("planPomodoroLinkInsertion reports no-section, no-eligible-entry, and multiple-open-timed without any edits", () => {
  const base = {
    blockId: "foobar",
    targetPath: "Tasks.md",
    sourcePath: "Daily.md",
    resolveTarget: () => null,
    linkText: "[[Tasks#^foobar]]",
  };
  assert.deepEqual(helpers.planPomodoroLinkInsertion("# Notes\nhello", base), {
    error: "no-section",
  });
  assert.deepEqual(
    helpers.planPomodoroLinkInsertion(["## Pomodoros", "- [x] Done (10:00-10:25)"].join("\n"), base),
    { error: "no-eligible-entry" },
  );
  assert.deepEqual(
    helpers.planPomodoroLinkInsertion(
      ["## Pomodoros", "- [ ] A (10:00-10:25)", "- [ ] B (11:00-11:25)"].join("\n"),
      base,
    ),
    { error: "multiple-open-timed" },
  );
});

function pomodoroLinkBase(overrides = {}) {
  return {
    blockId: "foobar",
    targetPath: "Tasks.md",
    sourcePath: "Daily.md",
    resolveTarget: (reference) => {
      if (reference.oldId === "foobar" || reference.oldId === "second") {
        return "Tasks.md";
      }
      return reference.oldId === "abc" ? "Other.md" : null;
    },
    linkText: "[[Tasks#^foobar]]",
    ...overrides,
  };
}

test("planPomodoroLinkInsertion inserts before trailing separators, preserving LF endings", () => {
  const head = ["## Pomodoros", "- [ ] Current (10:00-10:25)", "  - [[Other#^abc]]"];
  const cases = [
    [head.join("\n"), [...head, "  - [[Tasks#^foobar]]"].join("\n")],
    [`${head.join("\n")}\n`, [...head, "  - [[Tasks#^foobar]]", ""].join("\n")],
    [`${head.join("\n")}\n\n`, [...head, "  - [[Tasks#^foobar]]", "", ""].join("\n")],
    [
      [...head, "   ", "\t"].join("\n"),
      [...head, "  - [[Tasks#^foobar]]", "   ", "\t"].join("\n"),
    ],
  ];

  for (const [input, expected] of cases) {
    const plan = helpers.planPomodoroLinkInsertion(input, pomodoroLinkBase());
    assert.equal(plan.alreadyLinked, false);
    assert.equal(plan.removedCount, 0);
    assert.equal(plan.content, expected, JSON.stringify(input));
  }
});

test("planPomodoroLinkInsertion inserts before trailing separators, preserving CRLF endings", () => {
  const head = ["## Pomodoros", "- [ ] Current (10:00-10:25)", "  - [[Other#^abc]]"];
  const cases = [
    [head.join("\r\n"), [...head, "  - [[Tasks#^foobar]]"].join("\r\n")],
    [`${head.join("\r\n")}\r\n`, [...head, "  - [[Tasks#^foobar]]", ""].join("\r\n")],
    [`${head.join("\r\n")}\r\n\r\n`, [...head, "  - [[Tasks#^foobar]]", "", ""].join("\r\n")],
  ];

  for (const [input, expected] of cases) {
    const plan = helpers.planPomodoroLinkInsertion(input, pomodoroLinkBase());
    assert.equal(plan.content, expected, JSON.stringify(input));
    assert.doesNotMatch(plan.content, /(^|[^\r])\n/);
  }
});

test("planPomodoroLinkInsertion covers empty destinations, indentation, and nested subtrees", () => {
  const empty = helpers.planPomodoroLinkInsertion(
    ["## Pomodoros", "- [ ] Current (10:00-10:25)"].join("\n") + "\n",
    pomodoroLinkBase(),
  );
  assert.equal(
    empty.content,
    ["## Pomodoros", "- [ ] Current (10:00-10:25)", "\t- [[Tasks#^foobar]]", ""].join("\n"),
  );

  const tabbed = helpers.planPomodoroLinkInsertion(
    ["## Pomodoros", "- [ ] Current (10:00-10:25)", "\t- [[Other#^abc]]"].join("\n") + "\n",
    pomodoroLinkBase(),
  );
  assert.equal(
    tabbed.content,
    ["## Pomodoros", "- [ ] Current (10:00-10:25)", "\t- [[Other#^abc]]", "\t- [[Tasks#^foobar]]", ""].join("\n"),
  );

  const nested = helpers.planPomodoroLinkInsertion(
    [
      "## Pomodoros",
      "- [ ] Current (10:00-10:25)",
      "  - [[Other#^abc]]",
      "    - nested note",
      "",
      "  - second child",
    ].join("\n") + "\n",
    pomodoroLinkBase(),
  );
  assert.equal(
    nested.content,
    [
      "## Pomodoros",
      "- [ ] Current (10:00-10:25)",
      "  - [[Other#^abc]]",
      "    - nested note",
      "",
      "  - second child",
      "  - [[Tasks#^foobar]]",
      "",
    ].join("\n"),
  );

  const screenshot = helpers.planPomodoroLinkInsertion(
    [
      "## Pomodoros",
      "- [ ] (10:40-10:50) GTD",
      "  - [[#^gtd]]",
      "",
      "  - [[bob#^fresh-refs]]",
    ].join("\n") + "\n",
    pomodoroLinkBase(),
  );
  assert.equal(
    screenshot.content,
    [
      "## Pomodoros",
      "- [ ] (10:40-10:50) GTD",
      "  - [[#^gtd]]",
      "",
      "  - [[bob#^fresh-refs]]",
      "  - [[Tasks#^foobar]]",
      "",
    ].join("\n"),
  );
});

test("planPomodoroLinkInsertion inserts before the separator preceding later content", () => {
  const head = ["## Pomodoros", "- [ ] Current (10:00-10:25)", "  - [[Other#^abc]]"];
  const cases = [
    [
      [...head, "", "- [ ] Next ()"].join("\n") + "\n",
      [...head, "  - [[Tasks#^foobar]]", "", "- [ ] Next ()", ""].join("\n"),
    ],
    [
      [...head, "", "## Notes", "hello"].join("\n"),
      [...head, "  - [[Tasks#^foobar]]", "", "## Notes", "hello"].join("\n"),
    ],
    [
      [...head, "", "Just prose"].join("\n"),
      [...head, "  - [[Tasks#^foobar]]", "", "Just prose"].join("\n"),
    ],
  ];

  for (const [input, expected] of cases) {
    const plan = helpers.planPomodoroLinkInsertion(input, pomodoroLinkBase());
    assert.equal(plan.content, expected, JSON.stringify(input));
  }
});

test("planPomodoroLinkInsertion repeats as a no-op and keeps two distinct links adjacent", () => {
  const first = helpers.planPomodoroLinkInsertion(
    ["## Pomodoros", "- [ ] Current (10:00-10:25)", "  - [[Other#^abc]]"].join("\n") + "\n",
    pomodoroLinkBase(),
  );
  const repeat = helpers.planPomodoroLinkInsertion(first.content, pomodoroLinkBase());
  assert.equal(repeat.alreadyLinked, true);
  assert.deepEqual(repeat.edits, []);
  assert.equal(repeat.content, first.content);

  const second = helpers.planPomodoroLinkInsertion(
    first.content,
    pomodoroLinkBase({ blockId: "second", linkText: "[[Tasks#^second]]" }),
  );
  assert.equal(
    second.content,
    [
      "## Pomodoros",
      "- [ ] Current (10:00-10:25)",
      "  - [[Other#^abc]]",
      "  - [[Tasks#^foobar]]",
      "  - [[Tasks#^second]]",
      "",
    ].join("\n"),
  );
});

test("planPomodoroLinkInsertion before separators composes with future cleanup, preserving history", () => {
  const input =
    [
      "## Pomodoros",
      "- [ ] Current (10:00-10:25)",
      "  - [[Other#^abc]]",
      "",
      "- [ ] Later ()",
      "  - [[Tasks#^foobar]]",
      "- [x] Done (09:00-09:25)",
      "  - [[Tasks#^foobar]]",
    ].join("\n") + "\n";
  const plan = helpers.planPomodoroLinkInsertion(input, pomodoroLinkBase());
  assert.equal(plan.removedCount, 1);
  assert.equal(
    plan.content,
    [
      "## Pomodoros",
      "- [ ] Current (10:00-10:25)",
      "  - [[Other#^abc]]",
      "  - [[Tasks#^foobar]]",
      "",
      "- [ ] Later ()",
      "- [x] Done (09:00-09:25)",
      "  - [[Tasks#^foobar]]",
      "",
    ].join("\n"),
  );
});

test("existing-ID Pomodoro link runtime keeps terminal-newline separators adjacent (cross-note)", async () => {
  resetNotices();
  const editor = createEditor("- [?] #task Ship it [scheduled:: 2026-08-20] ^ship");
  const source = sourceForPomodoroLink(editor, "Tasks.md", 0);
  const dailyContent = ["## Pomodoros", "- [ ] Current (10:00-10:25)", "  - [[Other#^other]]"].join("\n") + "\n";
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
  assert.equal(
    written.content,
    ["## Pomodoros", "- [ ] Current (10:00-10:25)", "  - [[Other#^other]]", "  - [[Tasks#^ship]]", ""].join("\n"),
  );
});

test("same-note Pomodoro link runtime composes the task update with adjacent insertion", async () => {
  resetNotices();
  const editor = createEditor(
    [
      "- [?] #task Ship it [scheduled:: 2026-08-20] ^ship",
      "  - 🗓️ **SCHEDULE LOG**",
      "## Pomodoros",
      "- [ ] Current (10:00-10:25)",
      "  - [[Other#^other]]",
      "",
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
      "  - [[Other#^other]]",
      "  - [[#^ship]]",
      "",
    ].join("\n"),
  );
});

test("new-ID Pomodoro link runtime keeps terminal-newline separators adjacent", async () => {
  resetNotices();
  const editor = createEditor("- [ ] #task Ship it [priority:: high]");
  const source = sourceForPomodoroLink(editor, "Tasks.md", 0);
  const dailyContent = ["## Pomodoros", "- [ ] Later ()", "  - [[Other#^other]]"].join("\n") + "\n";
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
  assert.equal(
    written.content,
    ["## Pomodoros", "- [ ] Later ()", "  - [[Other#^other]]", "  - [[Tasks#^ship]]", ""].join("\n"),
  );
});

test("planFuturePomodoroLinkCleanup accepts a direct ownerLine/section context, bypassing findPomodoroSourceContext", () => {
  const content = [
    "## Pomodoros",
    "- [ ] Current (10:00-10:25)",
    "- [ ] Later ()",
    "  - [[Tasks#^ship]]",
  ].join("\n");
  const result = helpers.planFuturePomodoroLinkCleanup(content, {
    ownerLine: 1,
    section: { startLine: 1, endLine: 3 },
    sourcePath: "Daily.md",
    targetPath: "Tasks.md",
    targetBlockId: "ship",
    resolveTarget: (reference) => (reference.oldId === "ship" ? "Tasks.md" : null),
  });
  assert.equal(result.removedCount, 1);
});

test("all-open cleanup removes current and future links while preserving history and unresolved links", () => {
  const content = [
    "## Pomodoros",
    "- [x] Earlier done (09:00-09:25)",
    "  - [[#^ship]]",
    "- [ ] Current (10:00-10:25)",
    "  - [[#^ship]]",
    "    - remove this child too",
    "- [/] Running ()",
    "  - Keep ![[Alias#^ship|Ship]] and [[Other#^ship]] and [[Missing#^ship]]",
    "  ```md",
    "  - [[#^ship]]",
    "  ```",
    "- [ ] Later ()",
    "  - [[../daily/Daily#^ship]]",
    "- [-] Canceled ()",
    "  - [[#^ship]]",
    "## Notes",
    "- [[#^ship]]",
  ].join("\n");
  const paths = new Map([
    ["", "daily/Daily.md"],
    ["Alias", "daily/Daily.md"],
    ["../daily/Daily", "daily/Daily.md"],
    ["Other", "projects/Other.md"],
  ]);

  const plan = helpers.planAllOpenPomodoroLinkCleanup(content, {
    sourcePath: "daily/Daily.md",
    targetPath: "daily/Daily.md",
    targetBlockId: "ship",
    resolveTarget: (reference) => paths.get(reference.targetText) || null,
  });
  const result = applyPlannedEdits(content, plan.edits);

  assert.equal(plan.removedCount, 3);
  assert.equal(plan.hasChanges, true);
  assert.doesNotMatch(result, /remove this child too/);
  assert.match(result, /Keep  and \[\[Other#\^ship\]\] and \[\[Missing#\^ship\]\]/);
  assert.match(result, /```md\n  - \[\[#\^ship\]\]\n  ```/);
  assert.match(result, /\[x\] Earlier done[\s\S]*\[\[#\^ship\]\]/);
  assert.match(result, /\[-\] Canceled[\s\S]*\[\[#\^ship\]\]/);
  assert.match(result, /## Notes\n- \[\[#\^ship\]\]/);
  assert.doesNotMatch(result, /Alias#\^ship/);
  assert.doesNotMatch(result, /\.\.\/daily\/Daily#\^ship/);
});

test("all-open cleanup treats missing section, no open entries, and no matches as no-op successes", () => {
  const base = {
    sourcePath: "Daily.md",
    targetPath: "Tasks.md",
    targetBlockId: "ship",
    resolveTarget: () => "Tasks.md",
  };

  for (const content of [
    "# Notes\n- [[Tasks#^ship]]",
    ["## Pomodoros", "- [x] Done (09:00-09:25)", "  - [[Tasks#^ship]]"].join("\n"),
    ["## Pomodoros", "- [ ] Current ()", "  - [[Tasks#^other]]"].join("\n"),
  ]) {
    const plan = helpers.planAllOpenPomodoroLinkCleanup(content, base);
    assert.equal(plan.removedCount, 0);
    assert.equal(plan.hasChanges, false);
    assert.deepEqual(plan.edits, []);
    assert.equal(plan.content, content);
  }
});
