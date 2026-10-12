// Project blocking from the `^prj` line (bob-cli-6u.11 / Design §2–3,
// `docs/task-dependencies.md` §13). Covers recognition, block state, the
// `#prj_is_blocked` / `[unblocked::]` writers, ADJ-11 walk-through, the
// recovery gate on residents, emptied-Pomodoro cleanup, and TICKLER copy.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  helpers,
  compatibleTasksSettings,
} = require("./navigation-hotkeys-harness.cjs");

const TODAY = new Date(2026, 9, 12, 12);

function projectNote(overrides = {}) {
  const {
    type = "[[project]]",
    status = "wip",
    yamlScheduled = null,
    prjStatus = "?",
    prjExtra = "",
    dependsOn = "  - ⛓️ **DEPENDS ON:** [[job#^linkedin]]",
    residents = ["- [ ] #task Draft the pitch #prj_is_blocked ^pitch"],
    extraBody = [],
  } = overrides;
  const frontmatter = ["---", `type: ${type}`, `status: ${status}`];
  if (yamlScheduled) {
    frontmatter.push(`scheduled: ${yamlScheduled}`);
  }
  frontmatter.push("---", "");
  const prj = `- [${prjStatus}] #task #prj Ship the project${prjExtra} ^prj`;
  const body = [prj];
  if (dependsOn) {
    body.push(dependsOn);
  }
  body.push(...residents, ...extraBody);
  return [...frontmatter, ...body].join("\n");
}

function recoveryRegistry() {
  return helpers.parseTasksStatusRegistry(compatibleTasksSettings());
}

test("collectProjectNoteTaskRows splits ^prj from open residents and skips closed, fenced, quoted, and frontmatter tasks", () => {
  const content = [
    "---",
    "type: [[project]]",
    "status: wip",
    "- [ ] #task Frontmatter decoy ^fm",
    "---",
    "- [?] #task #prj Ship ^prj",
    "  - ⛓️ **DEPENDS ON:** [[job#^linkedin]]",
    "- [ ] #task Open resident ^open",
    "- [x] #task Closed resident ^closed",
    "- [-] #task Cancelled resident ^cancelled",
    "> - [ ] #task Quoted resident ^quoted",
    "```md",
    "- [ ] #task Fenced resident ^fenced",
    "```",
    "- [ ] Ordinary bullet",
  ].join("\n");
  const rows = helpers.collectProjectNoteTaskRows(content);
  assert.equal(rows.prj.length, 1);
  assert.equal(rows.prj[0].status, "?");
  assert.equal(rows.prj[0].blockId, "prj");
  assert.deepEqual(
    rows.residents.map((row) => row.blockId),
    ["open"],
  );
});

test("getProjectBlockState recognizes a project from type/status and ignores YAML scheduled", () => {
  const content = projectNote({ yamlScheduled: "2099-01-01" });
  const state = helpers.getProjectBlockState(
    content,
    "Project.md",
    TODAY,
    () => false,
  );
  assert.equal(state.isProject, true);
  assert.deepEqual(state.reasons, []);
});

test("getProjectBlockState reports an open external prerequisite", () => {
  const content = projectNote();
  const state = helpers.getProjectBlockState(
    content,
    "Project.md",
    TODAY,
    (path, blockId) => path === "job.md" && blockId === "linkedin",
  );
  assert.equal(state.isProject, true);
  assert.equal(state.reasons.length, 1);
  assert.equal(state.reasons[0].kind, "project_dependency");
  assert.deepEqual(state.reasons[0].targetIds, ["job.md#^linkedin"]);
  assert.equal(state.openItems.length, 1);
});

test("getProjectBlockState reports a future inline [scheduled::] and ignores YAML scheduled", () => {
  const withInline = projectNote({
    prjExtra: " [scheduled:: 2099-01-01]",
    dependsOn: null,
  });
  const inlineState = helpers.getProjectBlockState(
    withInline,
    "Project.md",
    TODAY,
    () => false,
  );
  assert.equal(inlineState.isProject, true);
  assert.equal(inlineState.reasons.length, 1);
  assert.equal(inlineState.reasons[0].kind, "project_schedule");
  assert.equal(inlineState.reasons[0].scheduled, "2099-01-01");

  const yamlOnly = projectNote({
    yamlScheduled: "2099-01-01",
    dependsOn: null,
  });
  const yamlState = helpers.getProjectBlockState(
    yamlOnly,
    "Project.md",
    TODAY,
    () => false,
  );
  assert.deepEqual(yamlState.reasons, []);
});

test("getProjectBlockState scheduledValue override is the inline date, not frontmatter", () => {
  const content = projectNote({
    yamlScheduled: "2099-01-01",
    prjExtra: " [scheduled:: 2026-10-12]",
    dependsOn: null,
  });
  const overridden = helpers.getProjectBlockState(
    content,
    "Project.md",
    TODAY,
    () => false,
    { scheduledValue: "2099-12-25" },
  );
  assert.equal(overridden.reasons.length, 1);
  assert.equal(overridden.reasons[0].kind, "project_schedule");
  assert.equal(overridden.reasons[0].scheduled, "2099-12-25");

  const cleared = helpers.getProjectBlockState(
    content,
    "Project.md",
    TODAY,
    () => false,
    { scheduledValue: "" },
  );
  assert.deepEqual(cleared.reasons, []);
});

test("getProjectBlockState skips internal and archive Depends-On links", () => {
  const content = projectNote({
    dependsOn:
      "  - ⛓️ **DEPENDS ON:** [[#^pitch]] [[done/old#^archived]] [[job#^linkedin]]",
  });
  const state = helpers.getProjectBlockState(
    content,
    "Project.md",
    TODAY,
    (path, blockId, item) => {
      if (item.internal || item.archive) {
        assert.fail("lookupOpen must not be asked about skipped items");
      }
      return path === "job.md" && blockId === "linkedin";
    },
  );
  assert.equal(state.openItems.length, 1);
  assert.equal(state.openItems[0].path, "job.md");
  assert.equal(state.openItems[0].internal, false);
  assert.equal(state.openItems[0].archive, false);
});

test("getProjectBlockState is a no-op for terminal, daily, and non-project notes", () => {
  const lookup = () => true;
  const done = helpers.getProjectBlockState(
    projectNote({ status: "done" }),
    "Project.md",
    TODAY,
    lookup,
  );
  assert.equal(done.isProject, false);

  const canceled = helpers.getProjectBlockState(
    projectNote({ status: "canceled" }),
    "Project.md",
    TODAY,
    lookup,
  );
  assert.equal(canceled.isProject, false);

  const daily = helpers.getProjectBlockState(
    projectNote(),
    "2026/20261012.md",
    TODAY,
    lookup,
  );
  assert.equal(daily.isProject, false);

  const area = helpers.getProjectBlockState(
    projectNote({ type: "[[area]]" }),
    "Area.md",
    TODAY,
    lookup,
  );
  assert.equal(area.isProject, false);
});

test("projectLooksBlockedByPrjShortcut is the single [?] ^prj row", () => {
  assert.equal(
    helpers.projectLooksBlockedByPrjShortcut(projectNote({ prjStatus: "?" })),
    true,
  );
  assert.equal(
    helpers.projectLooksBlockedByPrjShortcut(projectNote({ prjStatus: " " })),
    false,
  );
  const two = [
    "---",
    "type: [[project]]",
    "status: wip",
    "---",
    "- [?] #task #prj One ^prj",
    "- [?] #task #prj Two ^prj",
  ].join("\n");
  assert.equal(helpers.projectLooksBlockedByPrjShortcut(two), false);
});

test("taskHasProjectBlockedTag is token-bounded and does not match #prj", () => {
  assert.equal(
    helpers.taskHasProjectBlockedTag("- [ ] #task Foo #prj_is_blocked ^a"),
    true,
  );
  assert.equal(
    helpers.taskHasProjectBlockedTag("- [ ] #task Foo #prj ^a"),
    false,
  );
  assert.equal(
    helpers.taskHasProjectBlockedTag("- [ ] #task Foo #prj_is_blocked_extra ^a"),
    false,
  );
  assert.equal(
    helpers.taskHasProjectBlockedTag("#prj_is_blocked at the start"),
    true,
  );
});

test("setProjectBlockedTag adds one tag before the trailing ^id, is a no-op at one, and strips", () => {
  const added = helpers.setProjectBlockedTag(
    "- [ ] #task Draft the pitch ^pitch",
    true,
  );
  assert.equal(added, "- [ ] #task Draft the pitch #prj_is_blocked ^pitch");
  assert.equal(helpers.setProjectBlockedTag(added, true), added);

  const duplicate = helpers.setProjectBlockedTag(
    "- [ ] #task Draft #prj_is_blocked #prj_is_blocked ^pitch",
    true,
  );
  assert.equal(
    duplicate,
    "- [ ] #task Draft #prj_is_blocked ^pitch",
  );

  const stripped = helpers.setProjectBlockedTag(added, false);
  assert.equal(stripped, "- [ ] #task Draft the pitch ^pitch");
  assert.equal(
    helpers.taskHasProjectBlockedTag(stripped),
    false,
  );
});

test("reconcileBlockedScheduledTaskLine strips the tag and writes [unblocked::] on other-line Ready recoveries", () => {
  const line =
    "- [?] #task Draft the pitch #prj_is_blocked [scheduled:: 2026-10-01] ^pitch";
  const marked = [];
  const recovered = helpers.reconcileBlockedScheduledTaskLine(
    line,
    { state: "ready", rank: " ", reason: null },
    {
      ownLine: false,
      today: TODAY,
      markUnblockedLine: (nextLine, options) => {
        marked.push({ nextLine, options });
        return `${nextLine} [unblocked:: 2026-10-12]`;
      },
    },
  );
  assert.equal(recovered.changed, true);
  assert.equal(recovered.outcome, "ready");
  assert.match(recovered.line, /^- \[ \] /);
  assert.equal(helpers.taskHasProjectBlockedTag(recovered.line), false);
  assert.match(recovered.line, /\[unblocked:: 2026-10-12\]/);
  assert.equal(marked.length, 1);
  assert.equal(marked[0].options.status, " ");
});

test("reconcileBlockedScheduledTaskLine skips [unblocked::] on the gesture's own line and on Next/Pending", () => {
  const line = "- [?] #task Draft #prj_is_blocked ^pitch";
  const own = helpers.reconcileBlockedScheduledTaskLine(
    line,
    { state: "ready", rank: " ", reason: null },
  );
  assert.match(own.line, /^- \[ \] /);
  assert.doesNotMatch(own.line, /\[unblocked::/);
  assert.equal(helpers.taskHasProjectBlockedTag(own.line), false);

  const next = helpers.reconcileBlockedScheduledTaskLine(
    line,
    { state: "next", rank: "*", reason: null },
    {
      ownLine: false,
      markUnblockedLine: () => {
        assert.fail("Next recoveries must not stamp [unblocked::]");
      },
    },
  );
  assert.match(next.line, /^- \[\*\] /);
  assert.doesNotMatch(next.line, /\[unblocked::/);

  const pending = helpers.reconcileBlockedScheduledTaskLine(
    line,
    { state: "in-progress", rank: "/", reason: null },
    {
      ownLine: false,
      markUnblockedLine: () => {
        assert.fail("Pending recoveries must not stamp [unblocked::]");
      },
    },
  );
  assert.match(pending.line, /^- \[\/\] /);
  assert.doesNotMatch(pending.line, /\[unblocked::/);
});

test("reconcileBlockedScheduledTaskLine warns and skips the field when markUnblockedLine is missing", () => {
  const warnings = [];
  const original = console.warn;
  console.warn = (message) => {
    warnings.push(String(message));
  };
  try {
    const recovered = helpers.reconcileBlockedScheduledTaskLine(
      "- [?] #task Draft #prj_is_blocked ^pitch",
      { state: "ready", rank: " ", reason: null },
      { ownLine: false },
    );
    assert.match(recovered.line, /^- \[ \] /);
    assert.doesNotMatch(recovered.line, /\[unblocked::/);
    assert.match(
      warnings.join("\n"),
      /api\.freshness\.markUnblockedLine is unavailable; recovered without \[unblocked::\]/,
    );
  } finally {
    console.warn = original;
  }
});

test("ADJ-11 planDependencyEdit never raises a ^prj target and walks through to that project's deps", () => {
  const parent = [
    "- [*] #task Parent work ^parent",
  ].join("\n");
  const project = projectNote({
    prjStatus: "?",
    residents: ["- [ ] #task Draft the pitch ^pitch"],
  });
  const job = "- [ ] #task Apply on LinkedIn [id:: job__linkedin] ^linkedin";
  const plan = helpers.planDependencyEdit({
    content: parent,
    parentLine: 0,
    parentPath: "Parent.md",
    add: [{ path: "Project.md", blockId: "prj" }],
    remove: [],
    files: {
      "Parent.md": parent,
      "Project.md": project,
      "job.md": job,
    },
  });
  assert.equal(plan.ok, true, plan.reason);
  assert.match(plan.nextContent, /^- \[\?\] #task Parent work/);
  const prjPromotion = (plan.promotions || []).find(
    (entry) => entry.path === "Project.md" && / \^prj\s*$/.test(entry.from),
  );
  assert.equal(prjPromotion, undefined);
  const walked = (plan.promotions || []).find(
    (entry) => entry.path === "job.md",
  );
  assert.ok(walked, "should promote the walked-through job task");
  assert.match(walked.from, /^- \[ \] #task Apply on LinkedIn/);
  assert.match(walked.to, /^- \[\*\] #task Apply on LinkedIn/);
  const prjPrep = (plan.preparations || []).find(
    (entry) =>
      entry.path === "Project.md" &&
      typeof entry.from === "string" &&
      / \^prj\s*$/.test(entry.from) &&
      entry.text &&
      entry.text !== entry.from &&
      getStatus(entry.from) !== getStatus(entry.text),
  );
  assert.equal(prjPrep, undefined);

  function getStatus(text) {
    const match = /^- \[([^\]]+)\]/.exec(text);
    return match ? match[1] : null;
  }
});

test("recovery gate keeps a resident of a blocked project blocked after own deps close", () => {
  const project = projectNote({
    prjStatus: "?",
    residents: [
      "- [?] #task Draft the pitch #prj_is_blocked ^pitch",
    ],
  });
  const job = "- [ ] #task Apply on LinkedIn [id:: job__linkedin] ^linkedin";
  const index = helpers.buildScheduledRecoveryIndex(
    [
      { path: "Project.md", content: project },
      { path: "job.md", content: job },
    ],
    recoveryRegistry(),
    TODAY,
  );
  const prjLines = project.split("\n");
  const residentLine = prjLines.findIndex((line) => line.includes("^pitch"));
  const prjLine = prjLines.findIndex((line) => / \^prj\s*$/.test(line));
  const resident = helpers.getScheduledRecoveryMetadata(
    index,
    "Project.md",
    residentLine,
  );
  assert.equal(resident.state, "blocked");
  assert.match(resident.reason, /project_dependency: job\.md#\^linkedin/);
  const prj = helpers.getScheduledRecoveryMetadata(index, "Project.md", prjLine);
  assert.equal(prj.state, "blocked");
});

test("recovery gate blocks residents on a future inline project date with no deps", () => {
  const project = projectNote({
    prjStatus: "?",
    prjExtra: " [scheduled:: 2099-01-01]",
    dependsOn: null,
    residents: ["- [?] #task Draft the pitch #prj_is_blocked ^pitch"],
  });
  const index = helpers.buildScheduledRecoveryIndex(
    [{ path: "Project.md", content: project }],
    recoveryRegistry(),
    TODAY,
  );
  const residentLine = project
    .split("\n")
    .findIndex((line) => line.includes("^pitch"));
  const resident = helpers.getScheduledRecoveryMetadata(
    index,
    "Project.md",
    residentLine,
  );
  assert.equal(resident.state, "blocked");
  assert.match(resident.reason, /project_schedule: 2099-01-01/);
});

test("planDeferredPomodoroLinkCleanup removeEmptiedEntries deletes a last-child open entry", () => {
  const noteIndex = helpers.createScheduledRecoveryNoteIndex([
    { path: "2026/20260807.md" },
    { path: "Tasks.md" },
  ]);
  const targets = [{ path: "Tasks.md", blockId: "child" }];
  const content = [
    "## Pomodoros",
    "",
    "- [ ] Current (0900-0930)",
    "  - [[Tasks#^child]]",
    "- [ ] Keep (0930-1000)",
    "  - keep me",
  ].join("\n");
  const kept = helpers.planDeferredPomodoroLinkCleanup(content, targets, {
    dailyPath: "2026/20260807.md",
    noteIndex,
  });
  assert.equal(kept.changed, true);
  assert.equal(kept.removedEntryCount, 0);
  assert.match(kept.content, /- \[ \] Current \(0900-0930\)/);

  const emptied = helpers.planDeferredPomodoroLinkCleanup(content, targets, {
    dailyPath: "2026/20260807.md",
    noteIndex,
    removeEmptiedEntries: true,
  });
  assert.equal(emptied.changed, true);
  assert.equal(emptied.removedEntryCount, 1);
  assert.doesNotMatch(emptied.content, /Current \(0900-0930\)/);
  assert.match(emptied.content, /- \[ \] Keep \(0930-1000\)/);
});

test("TICKLER notice uses unblocked <date> when returnedBy is unblocked", () => {
  const entry = {
    tier: "tickler",
    tierRank: 1,
    tierTotal: 3,
    dueOn: "2026-10-07",
    returnedBy: "unblocked",
  };
  const notice = helpers.buildReviewJumpNotice(entry, 5, 10);
  assert.match(notice, /unblocked Oct 7/);
  assert.doesNotMatch(notice, /back since/);

  const scheduled = helpers.buildReviewJumpNotice(
    {
      tier: "tickler",
      tierRank: 1,
      tierTotal: 3,
      dueOn: "2026-10-07",
      returnedBy: "scheduled",
    },
    5,
    10,
  );
  assert.match(scheduled, /back since Oct 7/);
});
