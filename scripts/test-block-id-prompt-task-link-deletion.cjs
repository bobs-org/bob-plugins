const test = require("node:test");
const assert = require("node:assert/strict");
const {
  helpers,
  noticeMessages,
  resetNotices,
  lastNotice,
  createTaskModeHarness,
  LINKED_DAILY,
  selectTaskLink,
  deleteTaskLink,
  createTaskLinkHarness,
  NEXT_TASK,
  DAILY_WITH_LINKS,
} = require("./block-id-prompt-harness.cjs");

// ---------------------------------------------------------------------------
// Ctrl+Shift+Enter on a selected Task Link: delete the link, keep the lane.
// ---------------------------------------------------------------------------

test("task-link selection: one link is selectable from any column, several are chosen by cursor", () => {
  const single = "- 🍅 ![[Tasks#^ship|Ship]] and more text";
  for (let ch = 0; ch <= single.length; ch += 1) {
    const selected = helpers.findSelectedTaskLinkOnLine(single, ch);
    assert.equal(selected.ambiguous, false);
    assert.equal(selected.link.oldId, "ship");
    assert.equal(selected.link.targetText, "Tasks");
    assert.equal(selected.link.embedded, true);
    assert.equal(selected.link.aliasSuffix, "|Ship");
  }

  const several = "- [[A#^a]] and ~~![[B#^b]]~~ then 🍅 [[#^c]]";
  const at = (needle, offset = 0) => several.indexOf(needle) + offset;
  assert.equal(helpers.findSelectedTaskLinkOnLine(several, at("[[A")).link.oldId, "a");
  assert.equal(helpers.findSelectedTaskLinkOnLine(several, at("~~![[B")).link.oldId, "b");
  assert.equal(helpers.findSelectedTaskLinkOnLine(several, at("![[B")).link.oldId, "b");
  assert.equal(helpers.findSelectedTaskLinkOnLine(several, at("B#^b")).link.oldId, "b");
  assert.equal(helpers.findSelectedTaskLinkOnLine(several, at("🍅")).link.oldId, "c");
  assert.equal(helpers.findSelectedTaskLinkOnLine(several, several.length).link.oldId, "c");

  const between = helpers.findSelectedTaskLinkOnLine(several, at(" and ", 2));
  assert.deepEqual(between, { link: null, ambiguous: true });

  const adjacent = "[[A#^a]][[B#^b]]";
  assert.equal(helpers.findSelectedTaskLinkOnLine(adjacent, "[[A#^a]]".length).link.oldId, "b");
});

test("task-link selection ignores picker/rename markers, plain links, and Markdown-style links", () => {
  const line = "- [[N#^a]] [[N#^b]]@ [[N^^]] [[N#^^c]] [[N]]^^ [[N#^d]]^ [[Note]] [x](N.md#^e)";
  const selected = helpers.findSelectedTaskLinkOnLine(line, line.length);
  assert.equal(selected.ambiguous, false);
  assert.equal(selected.link.oldId, "a");
  assert.deepEqual(
    helpers.collectTaskLinkCandidates(line).map((candidate) => candidate.oldId),
    ["a"],
  );

  assert.deepEqual(helpers.findSelectedTaskLinkOnLine("- [[Note]] and [x](N.md#^e)", 0), {
    link: null,
    ambiguous: false,
  });
});

test("dedicated Task Link bullet detection covers checkbox, marker, embed, strike, and move-only forms", () => {
  for (const line of [
    "- [[#^a]]",
    "\t- ![[N#^a]]",
    "  - 🍅 [[#^a]]",
    "- 🍅 🍅 [[#^a]]",
    "- [[#^a]]#",
    "- ~~[[#^a]]~~",
    "- 🍅 ~~[[#^a]]~~#",
    "- [ ] ![[N#^a]]",
    "1. [x] [[N#^a|alias]]",
  ]) {
    assert.equal(
      helpers.isDedicatedTaskLinkBullet(line, selectTaskLink(line)),
      true,
      line,
    );
  }

  for (const line of [
    "- see [[#^a]] here",
    "- [[#^a]] trailing text",
    "- 🍅 [[#^a]] and",
    "- ~~[[#^a]]",
    "- [[#^a]]~~",
    "- [[#^a]] ^blk",
    "[[#^a]]",
    "- other [[#^a]]#",
  ]) {
    assert.equal(
      helpers.isDedicatedTaskLinkBullet(line, selectTaskLink(line)),
      false,
      line,
    );
  }
});

test("inline Task Link deletion removes the token with its decoration and collapses whitespace", () => {
  const cases = [
    ["- see [[#^a]] here", "- see here"],
    ["- see ![[N#^a]] here", "- see here"],
    ["- see 🍅 [[#^a]] here", "- see here"],
    ["- see 🍅 🍅 ![[N#^a]] here", "- see here"],
    ["- ~~[[N#^a]]~~ tail", "- tail"],
    ["- lead ~~[[N#^a]]~~", "- lead"],
    ["- a[[#^a]]b", "- a b"],
    ["- text [[#^a]]", "- text"],
    ["- [[#^a]] text ^blk", "- text ^blk"],
  ];

  for (const [line, expected] of cases) {
    const plan = deleteTaskLink(line, 0);
    assert.equal(plan.kind, "token", line);
    assert.equal(plan.result, expected, line);
  }

  const multi = deleteTaskLink("keep\n- see [[#^a]] here\nlast", 1);
  assert.equal(multi.result, "keep\n- see here\nlast");
  assert.deepEqual(multi.reference, { start: 11, end: 18 });
});

test("dedicated Task Link bullet deletion removes the item with its subtree and stops at the Pomodoro", () => {
  const plain = deleteTaskLink("- [[#^a]]\n  - child\n\t- other child\n- next", 0);
  assert.equal(plain.kind, "subtree");
  assert.equal(plain.result, "- next");

  const pomodoro = [
    "## Pomodoros",
    "- [ ] Current (10:00-10:25)",
    "  - [[Tasks#^ship]]",
    "    - nested",
    "  - keep",
    "- [ ] Later ()",
    "  - [[Tasks#^ship]]",
  ].join("\n");
  const inPomodoro = deleteTaskLink(pomodoro, 2);
  assert.equal(
    inPomodoro.result,
    [
      "## Pomodoros",
      "- [ ] Current (10:00-10:25)",
      "  - keep",
      "- [ ] Later ()",
      "  - [[Tasks#^ship]]",
    ].join("\n"),
  );

  const lastLine = deleteTaskLink("- keep\n  - 🍅 ![[N#^a]]#", 1);
  assert.equal(lastLine.result, "- keep\n");

  const stale = selectTaskLink("- [[#^a]]");
  assert.equal(helpers.planTaskLinkDeletion("- changed [[#^a]]", 0, stale), null);
  assert.equal(helpers.planTaskLinkDeletion("- [[#^a]]", 3, stale), null);
});

test("mergeCoveringEdits keeps the covering edit and the earlier of identical edits", () => {
  const outer = { start: 0, end: 10, replacement: "" };
  const inner = { start: 2, end: 5, replacement: "" };
  const apart = { start: 12, end: 14, replacement: "" };
  assert.deepEqual(helpers.mergeCoveringEdits([inner, outer, apart]), [outer, apart]);
  assert.deepEqual(helpers.mergeCoveringEdits([outer, inner]), [outer]);

  const first = { start: 3, end: 6, replacement: " " };
  const twin = { start: 3, end: 6, replacement: "" };
  assert.deepEqual(helpers.mergeCoveringEdits([first, twin]), [first]);
  assert.deepEqual(helpers.mergeCoveringEdits([twin, first]), [twin]);
});

test("dependency transclusion detection needs an embedded sole-content child of a #task line", () => {
  const dependency = ["- [ ] #task Parent [dependsOn:: tasks__ship] ^parent", "\t- ![[Tasks#^ship]]"];
  assert.equal(
    helpers.isDependencyTransclusionLink(dependency, 1, selectTaskLink(dependency[1])),
    true,
  );

  const closedParent = ["- [x] #task Done", "  - ![[Tasks#^ship]]"];
  assert.equal(
    helpers.isDependencyTransclusionLink(closedParent, 1, selectTaskLink(closedParent[1])),
    true,
  );

  const pomodoro = ["- [ ] Current ()", "  - ![[Tasks#^ship]]"];
  assert.equal(
    helpers.isDependencyTransclusionLink(pomodoro, 1, selectTaskLink(pomodoro[1])),
    false,
  );

  const plain = ["- [ ] #task Parent", "\t- [[Tasks#^ship]]"];
  assert.equal(
    helpers.isDependencyTransclusionLink(plain, 1, selectTaskLink(plain[1])),
    false,
  );

  const decorated = ["- [ ] #task Parent", "\t- 🍅 ![[Tasks#^ship]]"];
  assert.equal(
    helpers.isDependencyTransclusionLink(decorated, 1, selectTaskLink(decorated[1])),
    false,
  );

  const sibling = ["- [ ] #task Parent", "\t- other", "\t- ![[Tasks#^ship]]"];
  assert.equal(
    helpers.isDependencyTransclusionLink(sibling, 2, selectTaskLink(sibling[2])),
    true,
  );

  const notChild = ["- [ ] #task Parent", "- ![[Tasks#^ship]]"];
  assert.equal(
    helpers.isDependencyTransclusionLink(notChild, 1, selectTaskLink(notChild[1])),
    false,
  );
});

test("Task Link on a Next target: keeps Next, deletes the link subtree, cleans other open Pomodoro links", async () => {
  const h = createTaskLinkHarness({
    files: { "Daily.md": DAILY_WITH_LINKS, "Tasks.md": NEXT_TASK },
    activePath: "Daily.md",
    cursor: { line: 2, ch: 6 },
  });

  await h.plugin.openPomodoroTaskLink(h.editor, h.view);

  assert.deepEqual(h.writes, []);
  assert.equal(h.store["Tasks.md"], NEXT_TASK);
  assert.equal(
    h.editor.getValue(),
    [
      "## Pomodoros",
      "- [ ] Current (10:00-10:25)",
      "  - keep",
      "- [ ] Later ()",
      "- [x] Done (09:00-09:25)",
      "  - [[Tasks#^ship]]",
    ].join("\n"),
  );
  assert.deepEqual(h.editor.cursor, { line: 2, ch: 6 });
  assert.equal(h.plugin.promptOpen, false);
  assert.deepEqual(noticeMessages, ["Task Link removed · stays Next"]);
});

test("Task Link on a Next target works from an embedded aliased link outside any Pomodoro", async () => {
  const h = createTaskLinkHarness({
    files: {
      "Notes.md": "# Notes\n- see ![[Tasks#^ship|Ship]] now",
      "Tasks.md": NEXT_TASK,
      "Daily.md": "## Pomodoros\n- [ ] Current ()\n  - Working on [[Tasks#^ship]] soon",
    },
    activePath: "Notes.md",
    cursor: { line: 1, ch: 0 },
  });

  await h.plugin.openPomodoroTaskLink(h.editor, h.view);

  assert.equal(h.editor.getValue(), "# Notes\n- see now");
  assert.equal(h.store["Tasks.md"], NEXT_TASK);
  assert.deepEqual(h.writes, [
    { path: "Daily.md", content: "## Pomodoros\n- [ ] Current ()\n  - Working on  soon" },
  ]);
  assert.deepEqual(noticeMessages, ["Task Link removed · stays Next"]);
});

test("same-note Task Link: one merged editor write, overlapping edits deduped, cursor restored", async () => {
  const content = [
    NEXT_TASK.replace("^ship", "^ship"),
    "## Pomodoros",
    "- [ ] Current (10:00-10:25)",
    "  - [[#^ship]]",
    "    - nested",
    "- [ ] Later ()",
    "  - Keep [[#^ship]] and notes",
    "- [x] Done (09:00-09:25)",
    "  - [[#^ship]]",
  ].join("\n");
  const h = createTaskLinkHarness({
    files: { "Daily.md": content },
    activePath: "Daily.md",
    cursor: { line: 3, ch: 6 },
    targets: {},
  });

  await h.plugin.openPomodoroTaskLink(h.editor, h.view);

  assert.equal(
    h.editor.getValue(),
    [
      "- [*] #task Ship it ^ship",
      "## Pomodoros",
      "- [ ] Current (10:00-10:25)",
      "- [ ] Later ()",
      "  - Keep  and notes",
      "- [x] Done (09:00-09:25)",
      "  - [[#^ship]]",
    ].join("\n"),
  );
  assert.deepEqual(h.writes, []);
  assert.equal(h.replaceCalls.length, 2, "deduped subtree and one token edit, no status write");
  const starts = h.replaceCalls.map((call) => call.from.line * 1000 + call.from.ch);
  assert.deepEqual(starts, [...starts].sort((left, right) => right - left));
  assert.deepEqual(h.editor.cursor, { line: 3, ch: 6 });
  assert.deepEqual(noticeMessages, ["Task Link removed · stays Next"]);
});

test("same-note Task Link deletion clamps the restored cursor to the shortened note", async () => {
  const content = [
    "- [*] #task Ship it ^ship",
    "## Pomodoros",
    "- [ ] Current ()",
    "  - [[#^ship]]",
    "    - nested",
  ].join("\n");
  const h = createTaskLinkHarness({
    files: { "Daily.md": content },
    activePath: "Daily.md",
    cursor: { line: 3, ch: 12 },
    targets: {},
  });

  await h.plugin.openPomodoroTaskLink(h.editor, h.view);

  assert.equal(
    h.editor.getValue(),
    ["- [*] #task Ship it ^ship", "## Pomodoros", "- [ ] Current ()", ""].join("\n"),
  );
  assert.deepEqual(h.editor.cursor, { line: 3, ch: 0 });
});

test("a cleanup subtree that covers a nested selected link wins and links are not double counted", async () => {
  const content = [
    "- [ ] #task Ship it ^ship",
    "## Pomodoros",
    "- [ ] Current ()",
    "  - [[#^ship]]",
    "    - also [[#^ship]] here",
    "- [ ] Later ()",
    "  - [[#^ship]]",
  ].join("\n");
  const h = createTaskLinkHarness({
    files: { "Daily.md": content },
    activePath: "Daily.md",
    cursor: { line: 4, ch: 12 },
    targets: {},
  });

  await h.plugin.openPomodoroTaskLink(h.editor, h.view);

  assert.equal(
    h.editor.getValue(),
    ["- [ ] #task Ship it ^ship", "## Pomodoros", "- [ ] Current ()", "- [ ] Later ()", ""].join("\n"),
  );
  // Three links matched; the lane never changes.
  assert.deepEqual(noticeMessages, ["Task Link removed · stays Ready"]);
});

test("Task Link on an In Progress target prompts, then keeps the lane with a Work Log entry on submit", async () => {
  const daily = ["## Pomodoros", "- [ ] Current ()", "  - [[Tasks#^ship]]", "  - keep"].join("\n");
  const h = createTaskLinkHarness({
    files: { "Daily.md": daily, "Tasks.md": "- [/] #task Ship it ^ship" },
    activePath: "Daily.md",
    cursor: { line: 2, ch: 5 },
  });
  let prompted = null;
  h.plugin.openWorkSummaryPrompt = (source) => {
    prompted = source;
  };

  await h.plugin.openPomodoroTaskLink(h.editor, h.view);

  assert.ok(prompted);
  assert.equal(prompted.kind, "task-link-open");
  assert.equal(prompted.task.displayText, "Ship it");
  assert.equal(prompted.contextPath, "Tasks.md");
  assert.equal(prompted.sourcePath, "Daily.md");
  assert.equal(h.plugin.promptOpen, false);
  assert.equal(h.editor.getValue(), daily);
  assert.deepEqual(h.writes, []);
  assert.deepEqual(noticeMessages, []);

  const accepted = await h.plugin.submitPomodoroWorkSummary(prompted, " Finished\ncleanup ");

  assert.equal(accepted, true);
  assert.deepEqual(h.writes, [
    {
      path: "Tasks.md",
      content: [
        "- [/] #task Ship it ^ship",
        "\t- 🛠️ **WORK LOG**",
        "\t\t- *2026-08-15* — Finished cleanup",
      ].join("\n"),
    },
  ]);
  assert.equal(h.editor.getValue(), ["## Pomodoros", "- [ ] Current ()", "  - keep"].join("\n"));
  assert.deepEqual(noticeMessages, ["Task Link removed · stays In Progress · Work Log updated"]);
});

test("Task Link on an In Progress target with a blank summary logs nothing", async () => {
  const daily = "## Pomodoros\n- [ ] Current ()\n  - [[Tasks#^ship]]";
  const h = createTaskLinkHarness({
    files: { "Daily.md": daily, "Tasks.md": "- [/] #task Ship it ^ship" },
    activePath: "Daily.md",
    cursor: { line: 2, ch: 0 },
  });
  let prompted = null;
  h.plugin.openWorkSummaryPrompt = (source) => {
    prompted = source;
  };
  await h.plugin.openPomodoroTaskLink(h.editor, h.view);

  assert.equal(await h.plugin.submitPomodoroWorkSummary(prompted, " \n\t "), true);

  assert.deepEqual(h.writes, []);
  assert.equal(h.store["Tasks.md"], "- [/] #task Ship it ^ship");
  assert.equal(h.editor.getValue(), "## Pomodoros\n- [ ] Current ()\n");
  assert.deepEqual(noticeMessages, ["Task Link removed · stays In Progress"]);
});

test("canceling the In Progress Task Link prompt leaves everything untouched", async () => {
  const daily = "## Pomodoros\n- [ ] Current ()\n  - [[Tasks#^ship]]";
  const h = createTaskLinkHarness({
    files: { "Daily.md": daily, "Tasks.md": "- [/] #task Ship it ^ship" },
    activePath: "Daily.md",
    cursor: { line: 2, ch: 0 },
  });
  let prompted = null;
  h.plugin.openWorkSummaryPrompt = (source) => {
    prompted = source;
  };
  await h.plugin.openPomodoroTaskLink(h.editor, h.view);

  h.plugin.cancelWorkSummaryPrompt(prompted);

  assert.equal(h.editor.getValue(), daily);
  assert.deepEqual(h.writes, []);
  assert.deepEqual(noticeMessages, []);
});

test("canceling the In Progress unlink prompt in task mode leaves everything untouched", async () => {
  const h = createTaskModeHarness({
    taskContent: "- [/] #task Ship it ^ship",
    dailyContent: LINKED_DAILY,
  });
  let prompted = null;
  h.plugin.openWorkSummaryPrompt = (source) => {
    prompted = source;
  };
  await h.plugin.openPomodoroTaskLink(h.editor, h.view);
  assert.ok(prompted);

  h.plugin.cancelWorkSummaryPrompt(prompted);

  assert.equal(h.editor.getValue(), "- [/] #task Ship it ^ship");
  assert.deepEqual(h.writes, []);
  assert.deepEqual(noticeMessages, []);
});

test("In Progress Task Link submit revalidates the link line and the target task", async () => {
  const daily = "## Pomodoros\n- [ ] Current ()\n  - [[Tasks#^ship]]";
  const build = async () => {
    const h = createTaskLinkHarness({
      files: { "Daily.md": daily, "Tasks.md": "- [/] #task Ship it ^ship" },
      activePath: "Daily.md",
      cursor: { line: 2, ch: 0 },
    });
    let prompted = null;
    h.plugin.openWorkSummaryPrompt = (source) => {
      prompted = source;
    };
    await h.plugin.openPomodoroTaskLink(h.editor, h.view);
    return { h, prompted };
  };

  const linkChanged = await build();
  linkChanged.h.editor.replaceRange("  - [[Tasks#^ship]] edited", { line: 2, ch: 0 }, { line: 2, ch: 19 });
  assert.equal(await linkChanged.h.plugin.submitPomodoroWorkSummary(linkChanged.prompted, "x"), false);
  assert.deepEqual(linkChanged.h.writes, []);
  assert.equal(lastNotice(), "Task link blocked: selected link changed in Daily.md");

  const taskChanged = await build();
  taskChanged.h.store["Tasks.md"] = "- [/] #task Ship it NOW ^ship";
  assert.equal(await taskChanged.h.plugin.submitPomodoroWorkSummary(taskChanged.prompted, "x"), false);
  assert.deepEqual(taskChanged.h.writes, []);
  assert.equal(lastNotice(), "Task link stopped: linked task changed in Tasks.md");

  const statusChanged = await build();
  statusChanged.h.store["Tasks.md"] = "- [*] #task Ship it ^ship";
  assert.equal(await statusChanged.h.plugin.submitPomodoroWorkSummary(statusChanged.prompted, "x"), false);
  assert.deepEqual(statusChanged.h.writes, []);
  assert.equal(lastNotice(), "Task link stopped: linked task changed in Tasks.md");
  assert.equal(statusChanged.h.editor.getValue(), daily);
});

test("Task Link on an Open target keeps it Ready, and on a Blocked target keeps it Blocked", async () => {
  const active = "# Notes\n- see [[Tasks#^ship]] now";
  const daily = "## Pomodoros\n- [ ] Current ()\n  - [[Tasks#^ship]]\n- [ ] Later ()";

  const open = createTaskLinkHarness({
    files: { "Notes.md": active, "Tasks.md": "- [ ] #task Ship it ^ship", "Daily.md": daily },
    activePath: "Notes.md",
    cursor: { line: 1, ch: 3 },
  });
  await open.plugin.openPomodoroTaskLink(open.editor, open.view);
  assert.equal(open.editor.getValue(), "# Notes\n- see now");
  assert.deepEqual(open.writes, [
    { path: "Daily.md", content: "## Pomodoros\n- [ ] Current ()\n- [ ] Later ()" },
  ]);
  assert.equal(open.store["Tasks.md"], "- [ ] #task Ship it ^ship");
  assert.deepEqual(noticeMessages, ["Task Link removed · stays Ready"]);

  const blocked = createTaskLinkHarness({
    files: {
      "Notes.md": active,
      "Tasks.md": "- [?] #task Ship it [dependsOn:: x] ^ship",
      "Daily.md": "## Pomodoros\n- [ ] Current ()",
    },
    activePath: "Notes.md",
    cursor: { line: 1, ch: 3 },
  });
  await blocked.plugin.openPomodoroTaskLink(blocked.editor, blocked.view);
  assert.equal(blocked.editor.getValue(), "# Notes\n- see now");
  assert.deepEqual(blocked.writes, []);
  assert.equal(blocked.store["Tasks.md"], "- [?] #task Ship it [dependsOn:: x] ^ship");
  assert.deepEqual(noticeMessages, ["Task Link removed · stays Blocked"]);
});

test("Task Link on a Done or Cancelled target is refused without edits", async () => {
  for (const status of ["x", "X", "-"]) {
    const active = "# Notes\n- see [[Tasks#^ship]] now";
    const h = createTaskLinkHarness({
      files: { "Notes.md": active, "Tasks.md": `- [${status}] #task Ship it ^ship`, "Daily.md": "## Pomodoros" },
      activePath: "Notes.md",
      cursor: { line: 1, ch: 3 },
    });

    await h.plugin.openPomodoroTaskLink(h.editor, h.view);

    assert.equal(h.editor.getValue(), active);
    assert.deepEqual(h.writes, []);
    assert.deepEqual(noticeMessages, ["Task link target is closed; use Ctrl+Enter to reopen it"]);
    assert.equal(h.plugin.promptOpen, false);
  }
});

test("Task Link with an unresolvable, missing, duplicated, or non-task target is refused without edits", async () => {
  const active = "# Notes\n- see [[Tasks#^ship]] now";
  const cases = [
    [{ targets: {}, tasks: NEXT_TASK }, "Task link target could not be found"],
    [{ tasks: "- [*] #task Ship it" }, "Task link target ^ship is missing or duplicated in Tasks.md"],
    [
      { tasks: `${NEXT_TASK}\n- [ ] #task Other ^ship` },
      "Task link target ^ship is missing or duplicated in Tasks.md",
    ],
    [{ tasks: "A paragraph ^ship" }, "Task link does not point to a task"],
    [{ tasks: "- [ ] not a project task ^ship" }, "Task link does not point to a task"],
    [{ tasks: "- [>] #task Deferred ^ship" }, "Task link does not point to a task"],
    [{ tasks: "- [*] #task Ship it ^ship" , active: "# Notes\n- see [[Tasks#^gone]] now" }, "Task link target ^gone is missing or duplicated in Tasks.md"],
  ];

  for (const [{ targets, tasks, active: activeOverride }, expected] of cases) {
    const h = createTaskLinkHarness({
      files: { "Notes.md": activeOverride || active, "Tasks.md": tasks, "Daily.md": "## Pomodoros" },
      activePath: "Notes.md",
      cursor: { line: 1, ch: 3 },
      ...(targets ? { targets } : {}),
    });

    await h.plugin.openPomodoroTaskLink(h.editor, h.view);

    assert.equal(h.editor.getValue(), activeOverride || active);
    assert.deepEqual(h.writes, []);
    assert.deepEqual(noticeMessages, [expected]);
  }
});

test("precedence: any #task line keeps the task-line behavior; other lines fall to task-link mode or the notice", async () => {
  const openTask = "- [ ] #task Ship [[Tasks#^other]] ^ship";
  const open = createTaskLinkHarness({
    files: { "Notes.md": openTask, "Daily.md": "## Pomodoros\n- [ ] Current ()" },
    activePath: "Notes.md",
    cursor: { line: 0, ch: 20 },
  });
  let completedWith = null;
  let linkModeStarted = false;
  open.plugin.completePomodoroTaskLink = async (source, id) => {
    completedWith = id;
  };
  open.plugin.startTaskLinkOpen = async () => {
    linkModeStarted = true;
  };
  await open.plugin.openPomodoroTaskLink(open.editor, open.view);
  assert.equal(completedWith, "ship");
  assert.equal(linkModeStarted, false);

  const closedContent = "- [x] #task Done [[Tasks#^other]] ^done";
  const closed = createTaskLinkHarness({
    files: { "Notes.md": closedContent, "Tasks.md": NEXT_TASK.replace("ship", "other"), "Daily.md": "## Pomodoros" },
    activePath: "Notes.md",
    cursor: { line: 0, ch: 20 },
  });
  await closed.plugin.openPomodoroTaskLink(closed.editor, closed.view);
  assert.deepEqual(noticeMessages, ["No open task under cursor"]);
  assert.equal(closed.editor.getValue(), closedContent);
  assert.deepEqual(closed.writes, []);

  const hidden = createTaskLinkHarness({
    files: { "Notes.md": "- [*] #task #hide Quiet [[Tasks#^other]] ^quiet" },
    activePath: "Notes.md",
    cursor: { line: 0, ch: 30 },
  });
  hidden.plugin.startTaskLinkOpen = async () => {
    linkModeStarted = true;
  };
  hidden.plugin.applyPomodoroTaskUnlink = async () => true;
  await hidden.plugin.openPomodoroTaskLink(hidden.editor, hidden.view);
  assert.equal(linkModeStarted, false);

  const paragraph = createTaskLinkHarness({
    files: { "Notes.md": "Just a paragraph with [[Note]] and [x](N.md#^e)" },
    activePath: "Notes.md",
    cursor: { line: 0, ch: 3 },
  });
  await paragraph.plugin.openPomodoroTaskLink(paragraph.editor, paragraph.view);
  assert.deepEqual(noticeMessages, ["No open task under cursor"]);
});

test("Task Link mode keeps the single-cursor and code-fence notices and reports ambiguity", async () => {
  const multi = createTaskLinkHarness({
    files: { "Notes.md": "- see [[Tasks#^ship]]" },
    activePath: "Notes.md",
    cursor: { line: 0, ch: 3 },
  });
  multi.editor.listSelections = () => [
    { anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 0 } },
    { anchor: { line: 0, ch: 2 }, head: { line: 0, ch: 2 } },
  ];
  await multi.plugin.openPomodoroTaskLink(multi.editor, multi.view);
  assert.deepEqual(noticeMessages, ["No active Markdown task selected"]);

  const fenced = createTaskLinkHarness({
    files: { "Notes.md": "```md\n- see [[Tasks#^ship]]\n```" },
    activePath: "Notes.md",
    cursor: { line: 1, ch: 3 },
  });
  await fenced.plugin.openPomodoroTaskLink(fenced.editor, fenced.view);
  assert.deepEqual(noticeMessages, ["Cannot link a task inside a code block"]);
  assert.equal(fenced.editor.getValue(), "```md\n- see [[Tasks#^ship]]\n```");

  const line = "- [[Tasks#^a]] and [[Tasks#^b]]";
  const ambiguous = createTaskLinkHarness({
    files: { "Notes.md": line, "Tasks.md": NEXT_TASK, "Daily.md": "## Pomodoros" },
    activePath: "Notes.md",
    cursor: { line: 0, ch: 16 },
  });
  await ambiguous.plugin.openPomodoroTaskLink(ambiguous.editor, ambiguous.view);
  assert.deepEqual(noticeMessages, ["Multiple task links on this line; place the cursor on one"]);
  assert.equal(ambiguous.editor.getValue(), line);
  assert.deepEqual(ambiguous.writes, []);
});

test("Task Link that is a sub-task dependency transclusion is refused without edits", async () => {
  const content = ["- [ ] #task Parent [dependsOn:: tasks__ship] ^parent", "\t- ![[Tasks#^ship]]"].join("\n");
  const h = createTaskLinkHarness({
    files: { "Notes.md": content, "Tasks.md": NEXT_TASK, "Daily.md": "## Pomodoros" },
    activePath: "Notes.md",
    cursor: { line: 1, ch: 4 },
  });

  await h.plugin.openPomodoroTaskLink(h.editor, h.view);

  assert.deepEqual(noticeMessages, ["Task link is a sub-task dependency; edit dependencies instead"]);
  assert.equal(h.editor.getValue(), content);
  assert.deepEqual(h.writes, []);
  assert.equal(h.plugin.promptOpen, false);
});

test("Task Link partial failure after the daily write is retryable", async () => {
  const h = createTaskLinkHarness({
    files: {
      "Notes.md": "# Notes\n- see [[Tasks#^ship]] now",
      "Daily.md": DAILY_WITH_LINKS,
      "Tasks.md": NEXT_TASK,
    },
    activePath: "Notes.md",
    cursor: { line: 1, ch: 3 },
  });
  h.state.modifyHook = () => {
    h.editor.replaceRange("\nextra line", { line: 1, ch: 999 });
  };

  await h.plugin.openPomodoroTaskLink(h.editor, h.view);

  assert.deepEqual(noticeMessages, [
    "Task link removal incomplete, but Notes.md could not be updated; press Ctrl+Shift+Enter on the link again",
  ]);
  assert.equal(h.store["Tasks.md"], NEXT_TASK);
  assert.equal(h.editor.getValue(), "# Notes\n- see [[Tasks#^ship]] now\nextra line");

  h.state.modifyHook = null;
  h.editor.setCursor({ line: 1, ch: 3 });
  resetNotices();
  await h.plugin.openPomodoroTaskLink(h.editor, h.view);

  assert.deepEqual(noticeMessages, ["Task Link removed · stays Next"]);
  assert.equal(h.editor.getValue(), "# Notes\n- see now\nextra line");
});

test("Task Link stops before any write when the target note changes after planning", async () => {
  const h = createTaskLinkHarness({
    files: { "Daily.md": DAILY_WITH_LINKS, "Tasks.md": NEXT_TASK },
    activePath: "Daily.md",
    cursor: { line: 2, ch: 6 },
  });
  h.state.dailyHook = () => {
    h.store["Tasks.md"] = "- [*] #task Ship it NOW ^ship";
  };

  await h.plugin.openPomodoroTaskLink(h.editor, h.view);

  assert.deepEqual(h.writes, []);
  assert.equal(h.editor.getValue(), DAILY_WITH_LINKS);
  assert.deepEqual(noticeMessages, ["Task link stopped: linked task changed in Tasks.md"]);
  assert.equal(h.plugin.promptOpen, false);
});

test("Task Link with a missing daily note skips cleanup, and an unreadable daily note blocks", async () => {
  const active = "# Notes\n- see [[Tasks#^ship]] now";
  const missing = createTaskLinkHarness({
    files: { "Notes.md": active, "Tasks.md": NEXT_TASK },
    activePath: "Notes.md",
    cursor: { line: 1, ch: 3 },
    dailyPath: null,
  });
  await missing.plugin.openPomodoroTaskLink(missing.editor, missing.view);
  assert.equal(missing.editor.getValue(), "# Notes\n- see now");
  assert.equal(missing.store["Tasks.md"], NEXT_TASK);
  assert.deepEqual(missing.writes, []);
  assert.deepEqual(noticeMessages, ["Task Link removed · stays Next"]);

  const unreadable = createTaskLinkHarness({
    files: { "Notes.md": active, "Tasks.md": NEXT_TASK },
    activePath: "Notes.md",
    cursor: { line: 1, ch: 3 },
  });
  await unreadable.plugin.openPomodoroTaskLink(unreadable.editor, unreadable.view);
  assert.equal(unreadable.editor.getValue(), active);
  assert.deepEqual(unreadable.writes, []);
  assert.deepEqual(noticeMessages, ["Task link blocked: Daily.md could not be read"]);
});

test("Task Link subtree deletion removes a nested target task without any status write", async () => {
  const content = ["- [[#^ship]]", "  - [*] #task Ship it ^ship"].join("\n");
  const h = createTaskLinkHarness({
    files: { "Daily.md": content },
    activePath: "Daily.md",
    cursor: { line: 0, ch: 3 },
    targets: {},
  });

  await h.plugin.openPomodoroTaskLink(h.editor, h.view);

  assert.deepEqual(noticeMessages, ["Task Link removed · stays Next"]);
  assert.equal(h.editor.getValue(), "");
  assert.deepEqual(h.writes, []);
});
