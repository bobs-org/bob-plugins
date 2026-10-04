const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  helpers,
} = require("./navigation-hotkeys-harness.cjs");

test("Pomodoro-marked links are not managed dependency bullets", () => {
  assert.equal(
    helpers.parseDependencyNavigationBullet("  - 🍅 ![[Tasks#^dependency]]"),
    null,
  );
  assert.equal(
    helpers.parseDependencyNavigationBullet("  - 🍅 ~~[[Tasks#^dependency]]~~"),
    null,
  );
});

test("deleting inline scheduled metadata recovers Blocked targets by snapshot rank", () => {
  const input = [
    "- [?] #task Ready [scheduled:: 2099-01-01] ^ready",
    "- [?] #task Next [scheduled:: 2099-01-01] ^next",
    "- [?] #task Working [scheduled:: 2099-01-01] ^working",
    "- [?] #task Dependency [dependsOn:: open] [scheduled:: 2099-01-01] ^blocked",
  ].join("\r\n");
  const session = helpers.discoverCountedObsidianTaskTargets(input, 0, 3);
  const plan = helpers.planCountedBulletPropertyBatch(
    input,
    session,
    "scheduled",
    null,
    {
      operation: "delete",
      recoveryByLine: new Map([
        [0, { state: "ready", rank: " " }],
        [1, { state: "next", rank: "*" }],
        [2, { state: "in-progress", rank: "/" }],
        [3, { state: "blocked", rank: null }],
      ]),
    },
  );
  assert.equal(plan.valid, true);
  assert.deepEqual(
    plan.content
      .split(/\r?\n/)
      .map((line) => helpers.getObsidianTaskCheckboxStatus(line)),
    [" ", "*", "/", "?"],
  );
  assert.doesNotMatch(plan.content, /\[scheduled::/);
  assert.equal(plan.recoveredReadyTaskCount, 1);
  assert.equal(plan.recoveredNextTaskCount, 1);
  assert.equal(plan.recoveredInProgressTaskCount, 1);
  assert.equal(plan.stillBlockedTaskCount, 1);
});

test("counted future scheduling blocks only supported open inline task statuses", () => {
  const input = [
    "- [ ] #task Ready [scheduled:: 2026-07-17] ^ready",
    "- [*] #task Next [scheduled:: 2026-07-17] ^next",
    "- [/] #task Working [scheduled:: 2026-07-17] ^working",
    "- [?] #task Blocked [scheduled:: 2026-07-17] ^blocked",
    "- [x] #task Done ^done",
    "- [-] #task Canceled [scheduled:: 2026-07-15] ^canceled",
    "- [!] #task Unknown ^unknown",
    "- ordinary bullet [scheduled:: 2026-07-17]",
  ].join("\r\n");
  const session = helpers.discoverCountedObsidianTaskTargets(input, 0, 6);
  const future = helpers.planCountedBulletPropertyBatch(
    input,
    session,
    "scheduled",
    "2026-07-17",
    { operation: "set", today: new Date(2026, 6, 16, 23, 59) },
  );
  assert.equal(future.valid, true);
  assert.equal(future.changedTaskCount, 6);
  assert.equal(future.unchangedTaskCount, 1);
  assert.equal(future.blockedTaskCount, 3);
  assert.equal(
    (
      future.content
        .split(/\r?\n/)
        .slice(0, 7)
        .filter((line) => line.includes("[scheduled:: 2026-07-17]"))
    ).length,
    7,
  );
  assert.deepEqual(
    future.content
      .split(/\r?\n/)
      .slice(0, 7)
      .map((line) => helpers.getObsidianTaskCheckboxStatus(line)),
    ["?", "?", "?", "?", "x", "-", "!"],
  );
  assert.match(future.content, /ordinary bullet \[scheduled:: 2026-07-17\]/);

  const today = helpers.planCountedBulletPropertyBatch(
    input,
    session,
    "scheduled",
    "2026-07-16",
    { operation: "set", today: new Date(2026, 6, 16, 0, 1) },
  );
  assert.equal(today.blockedTaskCount, 0);
  assert.deepEqual(
    today.content
      .split(/\r?\n/)
      .slice(0, 7)
      .map((line) => helpers.getObsidianTaskCheckboxStatus(line)),
    [" ", "*", "/", "?", "x", "-", "!"],
  );
});

test("counted property planning rejects any stale source with no partial result", () => {
  const input = [
    "- [ ] #task One",
    "- [ ] #task Two",
    "- [ ] #task Three",
  ].join("\n");
  const session = helpers.discoverCountedObsidianTaskTargets(input, 0, 2);
  const changed = input.replace("#task Two", "#task Two changed");
  const plan = helpers.planCountedBulletPropertyBatch(
    changed,
    session,
    "scheduled",
    "2099-07-23",
  );
  assert.equal(plan.valid, false);
  assert.equal(plan.stale, true);
  assert.equal(plan.content, changed);
  assert.doesNotMatch(plan.content, /\[scheduled::/);
  assert.doesNotMatch(plan.content, /\[\?\]/);
});

test("counted scheduled planning composes project YAML with ordinary inline tasks", () => {
  const input = [
    "---",
    "type: [[project]]",
    "status: wip",
    "---",
    "- [ ] #task Ship [scheduled:: stale] [created:: 2026-07-01] ^prj",
    "supporting prose",
    "- [/] #task Follow up [created:: 2026-07-02] ^follow-up",
  ].join("\r\n");
  const session = helpers.discoverCountedObsidianTaskTargets(input, 4, 1);
  const plan = helpers.planCountedBulletPropertyBatch(
    input,
    session,
    "scheduled",
    "2026-07-23",
    { operation: "set", today: new Date(2026, 6, 16, 12) },
  );
  assert.equal(plan.valid, true);
  assert.equal(plan.cursorLine, 5);
  assert.equal((plan.content.match(/^scheduled:/gm) || []).length, 1);
  assert.match(plan.content, /^scheduled: 2026-07-23$/m);
  assert.doesNotMatch(plan.content, /Ship[^\r\n]*\[scheduled::/);
  assert.match(
    plan.content,
    /\[\?\] #task Follow up \[created:: 2026-07-02\] \[scheduled:: 2026-07-23\] \^follow-up/,
  );
  assert.match(plan.content, /Ship \[created:: 2026-07-01\] #hide \^prj/);
  assert.equal(plan.blockedTaskCount, 1);
  assert.equal(plan.propagatedScheduleTaskCount, 1);
  assert.equal(plan.removedHideTaskCount, 0);
  assert.equal(
    helpers.parseProjectTaskScheduledFields(
      plan.content.split(/\r?\n/).at(-1),
    ).length,
    1,
  );
});

test("project schedule update coordinates YAML, propagation, and Blocked status", () => {
  const input = [
    "---",
    "type: \"[[project]]\"",
    "status: wip",
    "---",
    "- [ ] #task Ship [scheduled:: 2026-07-12] [p:: 1] ^prj",
    "- [/] #task Work #hide #hide ^work",
  ].join("\n");
  const result = helpers.planProjectScheduledUpdate(
    input,
    4,
    "2026-07-16",
    new Date(2026, 6, 11, 23, 59),
  );
  assert.equal(result.valid, true);
  assert.equal(result.cursorLine, 5);
  assert.equal(
    result.content,
    [
      "---",
      "type: \"[[project]]\"",
      "status: wip",
      "scheduled: 2026-07-16",
      "---",
      "- [ ] #task Ship [p:: 1] #hide ^prj",
      "- [?] #task Work [scheduled:: 2026-07-16] ^work",
    ].join("\n"),
  );
  assert.equal(result.scheduledTaskCount, 1);
  assert.equal(result.removedHideTaskCount, 1);
  assert.equal(result.blockedTaskCount, 1);

  const deleted = helpers.planProjectScheduledDelete(result.content, 5, {
    today: new Date(2026, 6, 11),
    recoveryByLine: new Map([
      [6, { state: "in-progress", rank: "/", reason: null }],
    ]),
  });
  assert.equal(deleted.valid, true);
  assert.equal(deleted.cursorLine, 4);
  assert.doesNotMatch(deleted.content, /^scheduled:/m);
  assert.match(deleted.content, /Ship \[p:: 1\] #hide \^prj/);
  assert.match(deleted.content, /\[\/\] #task Work \^work/);
  assert.equal(deleted.removedScheduledTaskCount, 1);
  assert.equal(deleted.recoveredInProgressTaskCount, 1);
});

test("future project schedules propagate across real Markdown tasks", () => {
  const input = [
    "---",
    "type: [[project]]",
    "---",
    "- [ ] #task Ship [p:: 1] ^prj",
    "  - [/] #task Nested [scheduled:: 2026-07-10] ^nested",
    "1. [x] Completed #hide",
    "> - [-] Canceled #hidden",
    "- [*] #task Next (scheduled:: 2026-07-13) #hide #hide   ",
    "- [?] #task Duplicate [scheduled:: 2026-07-09] (scheduled:: 2026-07-14) #hide",
    "- [!] #task Custom #hide",
    "```md",
    "- [ ] fenced example",
    "```",
    "This mentions - [ ] checkbox prose",
  ].join("\r\n");
  const result = helpers.planProjectTaskSchedules(
    input,
    "2026-07-12",
    new Date(2026, 6, 11, 23, 59),
  );
  assert.equal(result.valid, true);
  assert.equal(result.taskCount, 7);
  assert.equal(result.content.includes("\r\n"), true);
  assert.match(result.content, /\[p:: 1\] #hide \^prj/);
  assert.match(
    result.content,
    /\[\?\] #task Nested \[scheduled:: 2026-07-12\] \^nested/,
  );
  assert.match(result.content, /Completed\r\n/);
  assert.match(result.content, /Canceled #hidden\r\n/);
  assert.match(
    result.content,
    /\[\?\] #task Next \(scheduled:: 2026-07-13\)\s+\r\n/,
  );
  assert.match(
    result.content,
    /Duplicate \[scheduled:: 2026-07-09\] \(scheduled:: 2026-07-14\) #hide/,
  );
  assert.match(result.content, /\[!\] #task Custom\r\n/);
  assert.match(result.content, /```md\r\n- \[ \] fenced example\r\n```/);
  assert.match(result.content, /This mentions - \[ \] checkbox prose/);
  assert.equal(result.scheduledTaskCount, 1);
  assert.equal(result.blockedTaskCount, 2);
  assert.equal(result.removedHideTaskCount, 3);
  assert.deepEqual(result.ambiguousTaskLines, [8]);
  assert.equal(
    helpers.planProjectTaskSchedules(
      result.content,
      "2026-07-12",
      new Date(2026, 6, 11),
    ).changed,
    false,
  );
});

test("today and past project schedules recover ordinary tasks and honor ^prj", () => {
  const multiple = [
    "---",
    "type: [[project]]",
    "---",
    "- [ ] #task Ship #hide #hide ^prj",
    "- [x] Done #hidden #hide",
    "- [-] Canceled #hide",
    "- [?] #task Ready #hide [scheduled:: 2026-07-10] ^ready",
    "- [?] #task Later #hide (scheduled:: 2026-07-12) ^later",
  ].join("\n");
  for (const date of ["2026-07-11", "2026-07-10"]) {
    const shown = helpers.planProjectTaskSchedules(
      multiple,
      date,
      new Date(2026, 6, 11, 0, 1),
      {
        recoveryByLine: new Map([
          [6, { state: "ready", rank: " ", reason: null }],
        ]),
      },
    );
    assert.match(shown.content, /Ship #hide #hide \^prj/);
    assert.match(shown.content, /Done #hidden$/m);
    assert.match(shown.content, /Canceled$/m);
    assert.equal(
      shown.content.includes(
        `[ ] #task Ready [scheduled:: ${date}] ^ready`,
      ),
      true,
    );
    assert.match(
      shown.content,
      /\[\?\] #task Later \(scheduled:: 2026-07-12\) \^later/,
    );
  }

  const sole = [
    "---",
    "type: [[project]]",
    "---",
    "- [ ] #task Ship #hide #hide ^prj",
  ].join("\n");
  const shownSole = helpers.planProjectTaskSchedules(
    sole,
    "2026-07-11",
    new Date(2026, 6, 11, 23, 59),
  );
  assert.match(shownSole.content, /Ship \^prj$/);
  assert.doesNotMatch(shownSole.content, /#hide/);
});

test("schedule deletion removes only exactly matching propagated fields", () => {
  const input = [
    "---",
    "type: [[project]]",
    "scheduled: '2026-07-16'",
    "---",
    "- [ ] #task Ship #hide [scheduled:: 2026-07-15] [p:: 2] [scheduled:: old] ^prj",
    "- [?] #task Work #hide [scheduled:: 2026-07-16] ^work",
    "- [?] #task Own later (scheduled:: 2026-07-17) ^later",
    "- [x] #task Done [scheduled:: 2026-07-16] ^done",
  ].join("\r\n");
  const deleted = helpers.planProjectScheduledDelete(input, 4, {
    today: new Date(2026, 6, 15),
    recoveryByLine: new Map([
      [5, { state: "next", rank: "*", reason: null }],
      [6, { state: "ready", rank: " ", reason: null }],
    ]),
  });
  assert.equal(deleted.valid, true);
  assert.equal(
    deleted.content,
    [
      "---",
      "type: [[project]]",
      "---",
      "- [ ] #task Ship #hide [p:: 2] ^prj",
      "- [*] #task Work #hide ^work",
      "- [?] #task Own later (scheduled:: 2026-07-17) ^later",
      "- [x] #task Done [scheduled:: 2026-07-16] ^done",
    ].join("\r\n"),
  );
  assert.equal(deleted.removedScheduledTaskCount, 1);
  assert.equal(deleted.recoveredNextTaskCount, 1);
});

test("dependency lines render one canonical Depends-On line per parent", () => {
  assert.equal(
    helpers.formatDependencyNavigationBullet(["a", "b"], "\t"),
    "\t- ⛓️ **DEPENDS ON:** [[#^a]] • [[#^b]]",
  );
  assert.equal(
    helpers.formatDependencyNavigationBullet(
      { blockId: "remote", note: "projects/Other" },
      "  ",
    ),
    "  - ⛓️ **DEPENDS ON:** [[projects/Other#^remote]]",
  );
  assert.deepEqual(
    helpers.parseDependencyTransclusionBulletDetails("  - ![[Other#^remote]]"),
    {
      indent: "  ",
      marker: "-",
      note: "Other",
      blockId: "remote",
      blockIds: ["remote"],
      transcluded: true,
      terminal: false,
    },
  );
  assert.deepEqual(
    helpers.parseDependencyTransclusionBulletDetails(
      "\t- ~~[[Other#^remote]]~~",
    ),
    {
      indent: "\t",
      marker: "-",
      note: "Other",
      blockId: "remote",
      blockIds: ["remote"],
      transcluded: false,
      terminal: true,
    },
  );
});

test("dependency IDs encode root and nested Markdown paths deterministically", () => {
  assert.equal(helpers.dependencyId("cash.md", "unemployment"), "cash__unemployment");
  assert.equal(
    helpers.dependencyId("projects\\Shared.md", "review"),
    "projects__Shared__review",
  );
  assert.equal(
    helpers.dependencyId("done/team/Archive.md", "ship"),
    "done__team__Archive__ship",
  );
  assert.throws(() => helpers.dependencyId("My Notes.md", "ship"), /unsupported/);
  assert.equal(helpers.tryDependencyId("My Notes.md", "ship"), null);
  assert.equal(
    helpers.resolveTargetTaskIdentity("- [ ] #task Ship ^ship", {
      filePath: "My Notes.md",
    }).reason,
    "unqualifiable-note-path",
  );
  assert.equal(
    helpers.applyPromptedBlockIdToTaskLine(
      "- [ ] #task Ship [id:: legacy]",
      "ship",
      "My Notes.md",
    ),
    null,
  );
});

test("prompted block IDs truthfully replace legacy id fields", () => {
  assert.equal(
    helpers.applyPromptedBlockIdToTaskLine(
      "- [ ] #task Ship [id:: legacy]",
      "ship",
      "Projects/Here.md",
    ),
    "- [ ] #task Ship [id:: Projects__Here__ship] ^ship",
  );
});

test("dependency navigation identity includes note path and folds legacy children", () => {
  const input = [
    "- [ ] #task Parent [dependsOn:: Here__x, Other__x] ^parent",
    "  - ![[#^x]]",
    "  - ![[Other#^x]]",
    "- [ ] #task Local [id:: Here__x] ^x",
  ].join("\n");
  const collection = helpers.collectDependencyNavigationBullets(input, 0);
  assert.deepEqual(
    collection.targets.map(({ note, blockId }) => `${note}#^${blockId}`),
    ["#^x", "Other#^x"],
  );
});

test("retired dependency bullets are excluded from single and counted toggles", () => {
  const retired = "  - ~~[[Other#^done]]~~";
  assert.deepEqual(helpers.findTransclusionToggleTargets(retired), []);
  assert.equal(helpers.toggleLineTransclusions(retired).changed, false);
  const counted = helpers.toggleLineRangeTransclusions(
    [retired, "  - [[Other#^open]]"],
    0,
    1,
  );
  assert.deepEqual(
    counted.changesByLine.map(({ line, nextLineText }) => [line, nextLineText]),
    [[1, "  - ![[Other#^open]]"]],
  );
});

test("dependsOn replacement accepts spaces around field name and separator", () => {
  const replacements = new Map([["old", "new"]]);
  assert.equal(
    helpers.rewriteDependsOnIdsInLine(
      "- [ ] #task Parent [ dependsOn :: old, keep]",
      replacements,
    ),
    "- [ ] #task Parent [ dependsOn :: new, keep]",
  );
});

test("task status helpers keep Blocked open but rankless", () => {
  assert.equal(
    helpers.getObsidianTaskCheckboxStatus("- [*] #task Next ^next"),
    "*",
  );
  assert.equal(
    helpers.getObsidianTaskCheckboxStatus("- [*] Plain checkbox ^plain"),
    null,
  );
  assert.deepEqual(
    [" ", "*", "/", "x", "-", "?"].map((status) =>
      helpers.getObsidianTaskStatusRank(status),
    ),
    [0, 1, 2, null, null, null],
  );
  assert.equal(helpers.isOpenObsidianTaskLine("- [?] #task Blocked"), true);
  assert.equal(helpers.getDependencyPromotionStatus("?"), " ");
  assert.equal(
    helpers.blockObsidianTaskCheckboxStatus("- [/] #task Parent ^parent"),
    "- [?] #task Parent ^parent",
  );
  for (const terminal of ["x", "-", "!"]) {
    const line = `- [${terminal}] #task Parent ^parent`;
    assert.equal(helpers.blockObsidianTaskCheckboxStatus(line), line);
  }
  assert.equal(
    helpers.promoteObsidianTaskCheckboxStatus(
      "  - [ ] #task Preserve metadata [p:: 2] ^task",
      "*",
    ),
    "  - [*] #task Preserve metadata [p:: 2] ^task",
  );
  assert.equal(
    helpers.promoteObsidianTaskCheckboxStatus("- [*] #task Next ^next", "/"),
    "- [/] #task Next ^next",
  );
  for (const line of [
    "- [/] #task Working ^working",
    "- [x] #task Done ^done",
    "- [-] #task Cancelled ^cancelled",
    "- [?] #task Custom ^custom",
    "- [ ] Plain checkbox ^plain",
  ]) {
    assert.equal(
      helpers.promoteObsidianTaskCheckboxStatus(line, "*"),
      line,
    );
  }
});
