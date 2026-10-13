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

test("counted project scheduling writes the ^prj inline date and blocks tagged residents", () => {
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
  assert.equal(plan.cursorLine, 4);
  assert.doesNotMatch(plan.content, /^scheduled:/m);
  assert.match(plan.content, /\[\?\] #task Ship[^\r\n]*\[scheduled:: 2026-07-23\]/);
  assert.match(
    plan.content,
    /\[\?\] #task Follow up[^\r\n]*\[scheduled:: 2026-07-23\][^\r\n]*#prj_is_blocked/,
  );
  assert.equal(plan.blockedTaskCount, 2);
  assert.equal(plan.propagatedScheduleTaskCount, 2);
});

test("moving a project schedule earlier replaces only exact old-date copies", () => {
  const input = [
    "---",
    "type: [[project]]",
    "---",
    "- [?] #task Ship [scheduled:: 2026-07-30] ^prj",
    "- [?] #task Exact copy [scheduled:: 2026-07-30] #prj_is_blocked ^exact",
    "- [?] #task Later date [scheduled:: 2026-08-01] #prj_is_blocked ^later",
  ].join("\n");
  const plan = helpers.planProjectScheduledUpdate(
    input,
    3,
    "2026-07-25",
    new Date(2026, 6, 16),
  );
  assert.equal(plan.valid, true);
  assert.match(plan.content, /Ship \[scheduled:: 2026-07-25\] #hide \^prj/);
  assert.match(
    plan.content,
    /Exact copy \[scheduled:: 2026-07-25\] #prj_is_blocked \^exact/,
  );
  assert.match(
    plan.content,
    /Later date \[scheduled:: 2026-08-01\] #prj_is_blocked \^later/,
  );
});

test("future project schedules block every open resident and consume review status", () => {
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
  assert.equal(result.taskCount, 5);
  assert.equal(result.content.includes("\r\n"), true);
  assert.match(result.content, /\[\?\] #task Ship[^\r\n]*\[scheduled:: 2026-07-12\] \^prj/);
  assert.match(
    result.content,
    /\[\?\] #task Nested \[scheduled:: 2026-07-12\] #prj_is_blocked \^nested/,
  );
  assert.match(result.content, /Completed #hide\r\n/);
  assert.match(result.content, /Canceled #hidden\r\n/);
  assert.match(
    result.content,
    /\[\?\] #task Next \(scheduled:: 2026-07-13\) #prj_is_blocked/,
  );
  assert.match(
    result.content,
    /Duplicate \[scheduled:: 2026-07-09\] \(scheduled:: 2026-07-14\) #hide #prj_is_blocked/,
  );
  assert.match(result.content, /\[!\] #task Custom #hide\r\n/);
  assert.match(result.content, /```md\r\n- \[ \] fenced example\r\n```/);
  assert.match(result.content, /This mentions - \[ \] checkbox prose/);
  assert.equal(result.blockedTaskCount, 3);
  assert.deepEqual(result.ambiguousTaskLines, [8]);
});

test("due project dates recover residents through the gate and write unblocked markers", () => {
  const input = [
    "---",
    "type: [[project]]",
    "---",
    "- [?] #task Ship #hide [scheduled:: 2026-07-30] ^prj",
    "- [?] #task Work [scheduled:: 2026-07-30] #prj_is_blocked [fresh:: 2026-07-01] ^work",
  ].join("\n");
  const plan = helpers.planProjectScheduledUpdate(
    input,
    3,
    "2026-07-11",
    new Date(2026, 6, 11),
    {
      recoveryByLine: new Map([
        [3, { state: "ready", rank: " ", reason: null }],
        [4, { state: "ready", rank: " ", reason: null }],
      ]),
      markUnblockedLine: (line, options) => {
        const date = options.today instanceof Date
          ? `${options.today.getFullYear()}-${String(options.today.getMonth() + 1).padStart(2, "0")}-${String(options.today.getDate()).padStart(2, "0")}`
          : String(options.today);
        return line.replace(/(?= \^[A-Za-z0-9-]+\s*$)/, ` [unblocked:: ${date}]`);
      },
    },
  );
  assert.equal(plan.valid, true);
  assert.match(plan.content, /- \[ \] #task Ship #hide \[scheduled:: 2026-07-11\] \^prj/);
  assert.match(
    plan.content,
    /- \[ \] #task Work \[scheduled:: 2026-07-11\] \[fresh:: 2026-07-01\] \[unblocked:: 2026-07-11\] \^work/,
  );
  assert.doesNotMatch(plan.content, /#prj_is_blocked/);
  assert.equal(plan.recoveredReadyTaskCount, 2);
});

test("schedule deletion removes only exact project-date copies and recovers residents", () => {
  const input = [
    "---",
    "type: [[project]]",
    "---",
    "- [?] #task Ship #hide [scheduled:: 2026-07-16] [p:: 2] ^prj",
    "- [?] #task Work #prj_is_blocked [scheduled:: 2026-07-16] ^work",
    "- [?] #task Own later #prj_is_blocked (scheduled:: 2026-07-17) ^later",
    "- [x] #task Done [scheduled:: 2026-07-16] ^done",
  ].join("\r\n");
  const deleted = helpers.planProjectScheduledDelete(input, 3, {
    today: new Date(2026, 6, 15),
    recoveryByLine: new Map([
      [3, { state: "ready", rank: " ", reason: null }],
      [4, { state: "next", rank: "*", reason: null }],
      [5, { state: "blocked", rank: null, reason: "future own date" }],
    ]),
  });
  assert.equal(deleted.valid, true);
  assert.doesNotMatch(deleted.content, /^scheduled:/m);
  assert.doesNotMatch(deleted.content.split(/\r?\n/)[3], /\[scheduled::/);
  assert.match(deleted.content, /- \[ \] #task Ship #hide \[p:: 2\] \^prj/);
  assert.match(deleted.content, /- \[\*\] #task Work \^work/);
  assert.match(
    deleted.content,
    /- \[\?\] #task Own later \(scheduled:: 2026-07-17\) \^later/,
  );
  assert.match(deleted.content, /- \[x\] #task Done \[scheduled:: 2026-07-16\] \^done/);
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

test("a due project date with only closed Depends-On history strips the tag", () => {
  const input = [
    "---",
    "type: [[project]]",
    "---",
    "- [?] #task Ship #hide [scheduled:: 2026-07-30] ^prj",
    "  - ⛓️ **DEPENDS ON:** ~~[[job#^done]]~~",
    "- [?] #task Work [scheduled:: 2026-07-30] #prj_is_blocked [fresh:: 2026-07-01] ^work",
  ].join("\n");
  const plan = helpers.planProjectScheduledUpdate(
    input,
    3,
    "2026-07-11",
    new Date(2026, 6, 11),
    {
      recoveryByLine: new Map([
        [3, { state: "ready", rank: " ", reason: null }],
        [5, { state: "ready", rank: " ", reason: null }],
      ]),
      markUnblockedLine: (line, options) => {
        const date =
          options.today instanceof Date
            ? `${options.today.getFullYear()}-${String(options.today.getMonth() + 1).padStart(2, "0")}-${String(options.today.getDate()).padStart(2, "0")}`
            : String(options.today);
        return line.replace(
          /(?= \^[A-Za-z0-9-]+\s*$)/,
          ` [unblocked:: ${date}]`,
        );
      },
    },
  );
  assert.equal(plan.valid, true, plan.error);
  const out = plan.content.split("\n");
  assert.match(out[3], /^- \[ \] #task Ship/);
  assert.doesNotMatch(out[3], /#prj_is_blocked/);
  const resident = out.find((line) => line.includes("^work"));
  assert.match(resident, /^- \[ \] #task Work/);
  assert.doesNotMatch(resident, /#prj_is_blocked/);
  assert.match(resident, /\[unblocked:: 2026-07-11\]/);
});

test("Ctrl+D with only closed Depends-On history strips the tag", () => {
  const input = [
    "---",
    "type: [[project]]",
    "---",
    "- [?] #task Ship #hide [scheduled:: 2026-07-16] ^prj",
    "  - ⛓️ **DEPENDS ON:** ~~[[job#^done]]~~",
    "- [?] #task Work #prj_is_blocked [scheduled:: 2026-07-16] [fresh:: 2026-07-01] ^work",
  ].join("\n");
  const deleted = helpers.planProjectScheduledDelete(input, 3, {
    today: new Date(2026, 6, 15),
    recoveryByLine: new Map([
      [3, { state: "ready", rank: " ", reason: null }],
      [5, { state: "ready", rank: " ", reason: null }],
    ]),
    markUnblockedLine: (line) =>
      line.replace(/(?= \^[A-Za-z0-9-]+\s*$)/, " [unblocked:: 2026-07-15]"),
  });
  assert.equal(deleted.valid, true, deleted.error);
  const out = deleted.content.split("\n");
  assert.match(out[3], /^- \[ \] #task Ship/);
  const resident = out.find((line) => line.includes("^work"));
  assert.match(resident, /^- \[ \] #task Work/);
  assert.doesNotMatch(deleted.content, /#prj_is_blocked/);
  assert.match(resident, /\[unblocked:: 2026-07-15\]/);
});

test("Ctrl+D with an open Depends-On link remaining keeps the tag", () => {
  const input = [
    "---",
    "type: [[project]]",
    "---",
    "- [?] #task Ship #hide [scheduled:: 2026-07-16] ^prj",
    "  - ⛓️ **DEPENDS ON:** [[job#^linkedin]]",
    "- [?] #task Work #prj_is_blocked [scheduled:: 2026-07-16] [fresh:: 2026-07-01] ^work",
  ].join("\n");
  const deleted = helpers.planProjectScheduledDelete(input, 3, {
    today: new Date(2026, 6, 15),
    recoveryByLine: new Map([
      [3, { state: "blocked", rank: null, reason: "open dependency: job__linkedin" }],
      [5, { state: "blocked", rank: null, reason: "project_dependency: job.md#^linkedin" }],
    ]),
  });
  assert.equal(deleted.valid, true, deleted.error);
  const out = deleted.content.split("\n");
  assert.ok(out[3].startsWith("- [?]"), out[3]);
  const resident = out.find((line) => line.includes("^work"));
  assert.ok(resident.startsWith("- [?]"), resident);
  assert.ok(resident.includes("#prj_is_blocked"), resident);
});

test("counted ^prj schedule sessions write [unblocked::] when the writer is passed", () => {
  const input = [
    "---",
    "type: [[project]]",
    "---",
    "- [?] #task Ship #hide [scheduled:: 2099-01-01] ^prj",
    "- [?] #task Work #prj_is_blocked [scheduled:: 2099-01-01] [fresh:: 2026-07-01] ^work",
  ].join("\n");
  const session = helpers.discoverCountedObsidianTaskTargets(input, 3, 0);
  const calls = [];
  const plan = helpers.planCountedBulletPropertyBatch(
    input,
    session,
    "scheduled",
    "2026-10-12",
    {
      operation: "set",
      today: new Date(2026, 9, 12),
      recoveryByLine: new Map([
        [3, { state: "ready", rank: " " }],
        [4, { state: "ready", rank: " " }],
      ]),
      markUnblockedLine: (line, options) => {
        calls.push(options);
        return `${line} [unblocked:: 2026-10-12]`;
      },
    },
  );
  assert.equal(plan.valid, true, plan.error);
  assert.match(plan.content, /^- \[ \] #task Ship/m);
  assert.match(plan.content, /\^work[^\n]*\[unblocked:: 2026-10-12\]|\[unblocked:: 2026-10-12\][^\n]*\^work/);
  assert.doesNotMatch(plan.content, /#prj_is_blocked/);
  assert.ok(calls.length >= 1);
});

test("a due project date keeps the tag while ^prj holds Depends-On links", () => {
  const input = [
    "---",
    "type: [[project]]",
    "---",
    "- [?] #task Ship #hide [scheduled:: 2026-07-30] ^prj",
    "  - ⛓️ **DEPENDS ON:** [[job#^linkedin]]",
    "- [?] #task Work [scheduled:: 2026-07-30] #prj_is_blocked [fresh:: 2026-07-01] ^work",
  ].join("\n");
  const calls = [];
  const plan = helpers.planProjectScheduledUpdate(
    input,
    3,
    "2026-07-11",
    new Date(2026, 6, 11),
    {
      recoveryByLine: new Map([
        [3, { state: "blocked", rank: null, reason: "open dependency: job__linkedin" }],
        [5, { state: "blocked", rank: null, reason: "project_dependency: job.md#^linkedin" }],
      ]),
      markUnblockedLine: (line) => {
        calls.push(line);
        return line;
      },
    },
  );
  assert.equal(plan.valid, true, plan.error);
  const out = plan.content.split("\n");
  assert.match(out[3], /\[scheduled:: 2026-07-11\]/);
  assert.ok(out[3].startsWith("- [?]"), out[3]);
  const resident = out.find((line) => line.includes("^work"));
  assert.ok(resident.startsWith("- [?]"), resident);
  assert.ok(resident.includes("#prj_is_blocked"), resident);
  assert.equal(calls.length, 0);
});

test("a due project date strips the tag while a resident with its own reason stays Blocked", () => {
  const input = [
    "---",
    "type: [[project]]",
    "---",
    "- [?] #task Ship #hide [scheduled:: 2026-07-30] ^prj",
    "  - ⛓️ **DEPENDS ON:** ~~[[job#^done]]~~",
    "- [?] #task Work [scheduled:: 2026-07-30] #prj_is_blocked [fresh:: 2026-07-01] ^work",
    "  - ⛓️ **DEPENDS ON:** [[job#^open]]",
  ].join("\n");
  const plan = helpers.planProjectScheduledUpdate(
    input,
    3,
    "2026-07-11",
    new Date(2026, 6, 11),
    {
      // The ^prj recovers, but the resident's own Depends-On is still open,
      // so it has no recovery: the tag follows ^prj while it stays [?].
      recoveryByLine: new Map([
        [3, { state: "ready", rank: " ", reason: null }],
      ]),
    },
  );
  assert.equal(plan.valid, true, plan.error);
  const out = plan.content.split("\n");
  assert.match(out[3], /^- \[ \] #task Ship/);
  const resident = out.find((line) => line.includes("^work"));
  assert.ok(resident.startsWith("- [?]"), resident);
  assert.doesNotMatch(resident, /#prj_is_blocked/);
});

test("Ctrl+D strips the tag while a resident with its own reason stays Blocked", () => {
  const input = [
    "---",
    "type: [[project]]",
    "---",
    "- [?] #task Ship #hide [scheduled:: 2026-07-16] ^prj",
    "  - ⛓️ **DEPENDS ON:** ~~[[job#^done]]~~",
    "- [?] #task Work #prj_is_blocked [scheduled:: 2026-07-16] [fresh:: 2026-07-01] ^work",
    "  - ⛓️ **DEPENDS ON:** [[job#^open]]",
  ].join("\n");
  const deleted = helpers.planProjectScheduledDelete(input, 3, {
    today: new Date(2026, 6, 15),
    recoveryByLine: new Map([
      [3, { state: "ready", rank: " ", reason: null }],
    ]),
  });
  assert.equal(deleted.valid, true, deleted.error);
  const out = deleted.content.split("\n");
  assert.match(out[3], /^- \[ \] #task Ship/);
  const resident = out.find((line) => line.includes("^work"));
  assert.ok(resident.startsWith("- [?]"), resident);
  assert.doesNotMatch(resident, /#prj_is_blocked/);
});

test("counted scheduled deletes recover with [unblocked::] when the writer is passed", () => {
  const input = ["- [?] #task Ready [scheduled:: 2099-01-01] ^ready"].join("\n");
  const session = helpers.discoverCountedObsidianTaskTargets(input, 0, 0);
  const calls = [];
  const plan = helpers.planCountedBulletPropertyBatch(
    input,
    session,
    "scheduled",
    null,
    {
      operation: "delete",
      today: new Date(2026, 9, 12),
      recoveryByLine: new Map([[0, { state: "ready", rank: " " }]]),
      markUnblockedLine: (line, options) => {
        calls.push(options);
        return `${line} [unblocked:: 2026-10-12]`;
      },
    },
  );
  assert.equal(plan.valid, true, plan.error);
  assert.match(plan.content, /\[unblocked:: 2026-10-12\]/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].isDailyNote, false);
  assert.equal(calls[0].isToday, false);
});
