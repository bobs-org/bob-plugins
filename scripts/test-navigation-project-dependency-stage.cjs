// Ctrl+Shift+P Depends on for `^prj` (nav-deps-stage, bob-cli-6u.13,
// `docs/task-dependencies.md` §13.10): the ordinary Depends-On writer also
// blocks, tags, and unlinks residents with commitment transfer; removal
// recovers them with `[unblocked::]`; same-note and cycle guards; api
// routes and notices.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  helpers,
  NavigationHotkeysPlugin,
  compatibleTasksSettings,
} = require("./navigation-hotkeys-harness.cjs");

const TODAY = new Date(2026, 9, 12, 12);

const {
  planDependencyEdit,
  applyDependencyPlanLines,
  applyDependencyEditTransaction,
  planDependencyStageView,
  collectDependencyStageEdgesFromSnapshots,
  createDependencySnapshotMap,
  indexDependencyStageNotesFromSnapshots,
  findDependencyStageCycle,
  dependencyStageRowKey,
  planDeferredPomodoroLinkCleanup,
  createScheduledRecoveryNoteIndex,
  formatProjectDependencyNotice,
  isProjectPrjDependencyParent,
  detectProjectPrjDependencyParent,
  blockProjectResidentLine,
  mapLineThroughStructural,
  projectDependentResidentKeys,
  parseProjectNoteFrontmatter,
  formatTaskMoveProjectCountsNotice,
  navNoteScopeFlags,
  navFreshnessMarkUnblockedLine,
  reconcileBlockedScheduledTaskLine,
} = helpers;

function openProjectNote(overrides = {}) {
  const {
    prjStatus = " ",
    dependsOn = null,
    field = "",
    residents = [
      "- [ ] #task Draft the pitch ^pitch",
      "- [*] #task Call the sponsor ^sponsor",
      "- [x] #task Old sketch ^old",
    ],
  } = overrides;
  const prj =
    `- [${prjStatus}] #task #prj Ship the project${field ? ` ${field}` : ""} ^prj`;
  const lines = [
    "---",
    'type: "[[project]]"',
    "status: wip",
    "---",
    "",
    prj,
  ];
  if (dependsOn) {
    lines.push(dependsOn);
  }
  lines.push(...residents);
  return lines.join("\n");
}

function blockedProjectNote(overrides = {}) {
  const {
    residents = [
      "- [?] #task Draft the pitch [fresh:: 2026-10-10] #prj_is_blocked ^pitch",
      "- [?] #task Call the sponsor [fresh:: 2026-10-10] #prj_is_blocked ^sponsor",
    ],
  } = overrides;
  return openProjectNote({
    prjStatus: "?",
    dependsOn: "  - ⛓️ **DEPENDS ON:** [[job#^linkedin]]",
    field: "[dependsOn:: job__linkedin] [fresh:: 2026-10-10]",
    residents,
  });
}

const OPEN_JOB = "- [ ] #task Fix LinkedIn now ^linkedin";
const CLOSED_JOB = "- [x] #task Fix LinkedIn now ^linkedin";

function recoveryRegistry() {
  return helpers.parseTasksStatusRegistry(compatibleTasksSettings());
}

// `[unblocked::]` stub with the freshness writer's shape: append the field
// for Ready recoveries so placement never hides the assertion.
function markUnblockedStub(calls) {
  return (line, _options) => {
    calls.push(String(line));
    return `${line} [unblocked:: 2026-10-12]`;
  };
}

test("recognition: a `^prj` parent in a project note carries its residents", () => {
  const content = openProjectNote();
  const info = isProjectPrjDependencyParent(content, "Project.md", 5);
  assert.ok(info);
  assert.equal(info.prjLine, 5);
  assert.deepEqual(
    info.residents.map((row) => row.blockId),
    ["pitch", "sponsor"],
  );
});

test("recognition: ordinary tasks, non-projects, terminal, daily, and twin-`^prj` notes are not project edits", () => {
  const content = openProjectNote();
  assert.equal(isProjectPrjDependencyParent(content, "Project.md", 6), null);
  assert.equal(
    isProjectPrjDependencyParent(
      content.replace('type: "[[project]]"', 'type: "[[area]]"'),
      "Project.md",
      5,
    ),
    null,
  );
  assert.equal(
    isProjectPrjDependencyParent(
      content.replace("status: wip", "status: done"),
      "Project.md",
      5,
    ),
    null,
  );
  assert.equal(
    isProjectPrjDependencyParent(content, "2026/20261012.md", 5),
    null,
  );
  assert.equal(
    isProjectPrjDependencyParent(
      `${content}\n- [ ] #task #prj Second ^prj2`,
    ),
    null,
  );
  // The hand-edit mirror keeps today's field behavior: never a project edit.
  assert.equal(
    detectProjectPrjDependencyParent(
      { mirrorTouch: true },
      content,
      "Project.md",
      5,
    ),
    null,
  );
});

test("add: residents block with exactly one tag; closed and fenced lines are untouched (PDB1, PDT1, PDT6, PDT7)", () => {
  const content = openProjectNote({
    residents: [
      "- [ ] #task Draft the pitch ^pitch",
      "- [*] #task Call the sponsor ^sponsor",
      "- [x] #task Old sketch #prj_is_blocked ^old",
      "```md",
      "- [ ] #task Fenced example ^fenced",
      "```",
    ],
  });
  const plan = planDependencyEdit({
    content,
    parentLine: 5,
    parentPath: "Project.md",
    add: [{ path: "job.md", blockId: "linkedin" }],
    remove: [],
    files: { "Project.md": content, "job.md": OPEN_JOB },
  });
  assert.equal(plan.ok, true);
  const out = plan.nextContent.split("\n");
  assert.ok(out[5].startsWith("- [?]"));
  assert.ok(out[5].includes("[dependsOn:: job__linkedin]"));
  assert.ok(!out[5].includes("#prj_is_blocked"));
  assert.ok(
    plan.nextContent.includes("⛓️ **DEPENDS ON:** [[job#^linkedin]]"),
  );
  const pitch = out.find((line) => line.includes("^pitch"));
  assert.ok(pitch.startsWith("- [?]"));
  assert.equal(pitch.match(/#prj_is_blocked/g).length, 1);
  const sponsor = out.find((line) => line.includes("^sponsor"));
  assert.ok(sponsor.startsWith("- [?]"));
  assert.equal(sponsor.match(/#prj_is_blocked/g).length, 1);
  const old = out.find((line) => line.includes("^old"));
  assert.ok(old.startsWith("- [x]"));
  const fenced = out.find((line) => line.includes("^fenced"));
  assert.equal(fenced, "- [ ] #task Fenced example ^fenced");
  assert.equal(plan.summary.project.blocked, 2);
  // Closed lines carry no live links, so they contribute no targets.
  assert.deepEqual(
    plan.summary.project.pomodoroTargets,
    [
      { path: "Project.md", blockId: "prj" },
      { path: "Project.md", blockId: "pitch" },
      { path: "Project.md", blockId: "sponsor" },
    ],
  );
});

test("add: commitment transfers the strongest resident lane, never onto a `^prj` target (Design §5, ADJ-11)", () => {
  const content = openProjectNote();
  const plan = planDependencyEdit({
    content,
    parentLine: 5,
    parentPath: "Project.md",
    add: [{ path: "job.md", blockId: "linkedin" }],
    remove: [],
    files: { "Project.md": content, "job.md": OPEN_JOB },
  });
  assert.equal(plan.ok, true);
  // The sponsor's Next outranks the Ready `^prj`: the open prerequisite
  // rises to Next.
  assert.equal(plan.promotions.length, 1);
  assert.ok(plan.promotions[0].to.startsWith("- [*]"));

  const prjTarget = [
    "---",
    'type: "[[project]]"',
    "status: wip",
    "---",
    "",
    "- [?] #task #prj Other project ^prj",
    "  - ⛓️ **DEPENDS ON:** [[job#^linkedin]]",
  ].join("\n");
  const walker = planDependencyEdit({
    content: openProjectNote(),
    parentLine: 5,
    parentPath: "Project.md",
    add: [{ path: "other.md", blockId: "prj" }],
    remove: [],
    files: {
      "Project.md": openProjectNote(),
      "other.md": prjTarget,
      "job.md": OPEN_JOB,
    },
  });
  assert.equal(walker.ok, true);
  // The `^prj` target is never raised; the walk continues to its open
  // prerequisite instead.
  assert.ok(
    walker.promotions.every((promotion) => promotion.path !== "other.md"),
  );
  assert.ok(
    walker.promotions.some(
      (promotion) => promotion.path === "job.md" && promotion.to.startsWith("- [*]"),
    ),
  );
});

test("guards: a same-note add to `^prj` refuses, including mixed batches", () => {
  const content = openProjectNote();
  const refused = planDependencyEdit({
    content,
    parentLine: 5,
    parentPath: "Project.md",
    add: [
      { path: "job.md", blockId: "linkedin" },
      { path: "Project.md", blockId: "pitch" },
    ],
    remove: [],
    files: { "Project.md": content, "job.md": OPEN_JOB },
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, "project-internal-target");

  // Ordinary dependents keep today's same-note behavior.
  const ordinary = [
    "- [ ] #task First ^first",
    "- [ ] #task Second ^second",
  ].join("\n");
  const allowed = planDependencyEdit({
    content: ordinary,
    parentLine: 0,
    parentPath: "Tasks.md",
    add: [{ path: "Tasks.md", blockId: "second" }],
    remove: [],
    files: { "Tasks.md": ordinary },
  });
  assert.equal(allowed.ok, true);
});

test("guards: the stage disables same-note rows for `^prj` with `inside this project`", () => {
  const view = planDependencyStageView({
    current: [],
    candidates: [
      {
        path: "Project.md",
        blockId: "pitch",
        line: 6,
        status: " ",
        displayText: "Draft the pitch",
        text: "Draft the pitch",
      },
      {
        path: "job.md",
        blockId: "linkedin",
        line: 0,
        status: "*",
        displayText: "Fix LinkedIn now",
        text: "Fix LinkedIn now",
      },
    ],
    query: "",
    dependent: {
      path: "Project.md",
      line: 5,
      key: "Project.md\x00prj",
      isProjectPrj: true,
    },
    edges: new Map(),
    linkedKeys: new Set(),
  });
  const pitch = view.find((row) => row.blockId === "pitch");
  const linkedin = view.find((row) => row.blockId === "linkedin");
  assert.equal(pitch.disabled, true);
  assert.equal(pitch.disabledReason, "inside this project");
  assert.equal(linkedin.disabled, false);

  const plain = planDependencyStageView({
    current: [
      {
        path: "Project.md",
        blockId: "pitch",
        line: 6,
        status: " ",
        displayText: "Draft the pitch",
        text: "Draft the pitch",
      },
    ],
    candidates: [],
    query: "",
    dependent: { path: "Project.md", line: 5, key: "Project.md\x00prj" },
    edges: new Map(),
    linkedKeys: new Set(),
  });
  // CURRENT rows never disable: removals stay allowed.
  assert.equal(plain[0].disabled || false, false);
});

test("guards: cycle detection includes the implicit resident edges (§13.6)", () => {
  const project = [
    "---",
    'type: "[[project]]"',
    "status: wip",
    "---",
    "",
    "- [?] #task #prj Ship it [dependsOn:: job__linkedin] ^prj",
    "  - ⛓️ **DEPENDS ON:** [[job#^linkedin]]",
    "- [ ] #task Draft the pitch ^pitch",
  ].join("\n");
  const job = [
    "- [?] #task Fix LinkedIn now [dependsOn:: project__pitch] ^linkedin",
    "  - ⛓️ **DEPENDS ON:** [[Project#^pitch]]",
  ].join("\n");
  const snapshots = createDependencySnapshotMap([
    { path: "Project.md", content: project },
    { path: "job.md", content: job },
  ]);
  const index = indexDependencyStageNotesFromSnapshots(snapshots);
  const edges = collectDependencyStageEdgesFromSnapshots(snapshots, index);
  const resident = dependencyStageRowKey("Project.md", "pitch");
  const prerequisite = dependencyStageRowKey("job.md", "linkedin");
  // The resident inherits `^prj`'s link to the open prerequisite.
  assert.ok((edges.get(resident) || []).includes(prerequisite));
  // Linking the prerequisite back to the resident would close a cycle.
  assert.ok(findDependencyStageCycle(edges, prerequisite, resident));
});

test("removal: the last reason recovers everyone with `[unblocked::]` (PDT2, Design §4)", () => {
  const content = blockedProjectNote();
  const calls = [];
  const plan = planDependencyEdit({
    content,
    parentLine: 5,
    parentPath: "Project.md",
    add: [],
    remove: [{ path: "job.md", blockId: "linkedin" }],
    files: { "Project.md": content, "job.md": CLOSED_JOB },
    recovery: {
      registry: recoveryRegistry(),
      today: TODAY,
      vaultContents: null,
      markUnblockedLine: markUnblockedStub(calls),
    },
  });
  assert.equal(plan.ok, true);
  const out = plan.nextContent.split("\n");
  assert.ok(out[5].startsWith("- [ ]"));
  assert.ok(!out[5].includes("[dependsOn::"));
  assert.ok(!plan.nextContent.includes("DEPENDS ON"));
  for (const id of ["^pitch", "^sponsor"]) {
    const row = out.find((line) => line.includes(id));
    assert.ok(row.startsWith("- [ ]"), row);
    assert.ok(!row.includes("#prj_is_blocked"), row);
    assert.ok(row.includes("[unblocked:: 2026-10-12]"), row);
  }
  assert.equal(calls.length, 2);
  assert.equal(plan.summary.project.recovered, 2);
  assert.equal(plan.summary.project.ready, 2);
  assert.equal(
    plan.notice,
    '⛓ Project no longer waits on "Fix LinkedIn now" · 2 tasks Ready again',
  );
});

test("removal: a resident with its own reason stays `[?]` without the tag (PDB3)", () => {
  const content = blockedProjectNote({
    residents: [
      "- [?] #task Draft the pitch [fresh:: 2026-10-10] #prj_is_blocked ^pitch",
      "- [?] #task File taxes [scheduled:: 2099-01-01] [fresh:: 2026-10-10] #prj_is_blocked ^taxes",
    ],
  });
  const calls = [];
  const plan = planDependencyEdit({
    content,
    parentLine: 5,
    parentPath: "Project.md",
    add: [],
    remove: [{ path: "job.md", blockId: "linkedin" }],
    files: { "Project.md": content, "job.md": CLOSED_JOB },
    recovery: {
      registry: recoveryRegistry(),
      today: TODAY,
      vaultContents: null,
      markUnblockedLine: markUnblockedStub(calls),
    },
  });
  assert.equal(plan.ok, true);
  const pitch = plan.nextContent.split("\n").find((line) => line.includes("^pitch"));
  assert.ok(pitch.startsWith("- [ ]"), pitch);
  const taxes = plan.nextContent.split("\n").find((line) => line.includes("^taxes"));
  assert.ok(taxes.startsWith("- [?]"), taxes);
  assert.ok(!taxes.includes("#prj_is_blocked"), taxes);
  assert.equal(plan.summary.project.recovered, 1);
});

test("removal without a registry defers to reconcile: residents keep `[?]` and the tag", () => {
  const content = blockedProjectNote();
  const plan = planDependencyEdit({
    content,
    parentLine: 5,
    parentPath: "Project.md",
    add: [],
    remove: [{ path: "job.md", blockId: "linkedin" }],
    files: { "Project.md": content, "job.md": CLOSED_JOB },
  });
  assert.equal(plan.ok, true);
  const pitch = plan.nextContent.split("\n").find((line) => line.includes("^pitch"));
  assert.ok(pitch.startsWith("- [?]"), pitch);
  assert.ok(pitch.includes("#prj_is_blocked"), pitch);
});

test("writer: one gesture commits `^prj` and its residents in a single undo group", async () => {
  const content = openProjectNote();
  const plan = planDependencyEdit({
    content,
    parentLine: 5,
    parentPath: "Project.md",
    add: [{ path: "job.md", blockId: "linkedin" }],
    remove: [],
    files: { "Project.md": content, "job.md": OPEN_JOB },
  });
  assert.equal(plan.ok, true);
  const commits = [];
  const outcome = await applyDependencyEditTransaction(plan, {
    prepareTargetFile: async () => ({ ok: true }),
    commitDependentContent: (nextContent) => {
      commits.push(String(nextContent));
      return { ok: true };
    },
  });
  assert.equal(outcome.ok, true);
  assert.equal(commits.length, 1);
  assert.ok(commits[0].includes("#prj_is_blocked"));
  assert.ok(commits[0].includes("DEPENDS ON"));
});

test("writer: Pomodoro links of `^prj` and its residents are consumed with emptied entries", () => {
  const content = openProjectNote();
  const plan = planDependencyEdit({
    content,
    parentLine: 5,
    parentPath: "Project.md",
    add: [{ path: "job.md", blockId: "linkedin" }],
    remove: [],
    files: { "Project.md": content, "job.md": OPEN_JOB },
  });
  assert.equal(plan.ok, true);
  const noteIndex = createScheduledRecoveryNoteIndex([
    { path: "2026/20261012.md" },
    { path: "Project.md" },
    { path: "job.md" },
  ]);
  const daily = [
    "## Pomodoros",
    "",
    "- [ ] Current (0900-0930)",
    "  - [[Project#^prj]]",
    "  - [[Project#^pitch]] and notes",
    "- [ ] Solo (0930-1000)",
    "  - [[Project#^sponsor]]",
    "- [x] Done (0800-0830)",
    "  - [[Project#^pitch]]",
  ].join("\n");
  const cleanup = planDeferredPomodoroLinkCleanup(
    daily,
    plan.summary.project.pomodoroTargets,
    {
      dailyPath: "2026/20261012.md",
      noteIndex,
    },
  );
  assert.equal(cleanup.changed, true);
  assert.ok(!cleanup.content.includes("[[Project#^prj]]"));
  assert.ok(cleanup.content.includes("and notes"));
  // The emptied entry goes with the empty-Pomodoro rule; closed history
  // is byte-identical.
  assert.ok(!cleanup.content.includes("Solo (0930-1000)"));
  assert.ok(cleanup.content.includes("- [x] Done (0800-0830)"));
  assert.ok(cleanup.content.includes("[[Project#^pitch]]"));
  assert.ok(cleanup.removedLinkCount >= 3);
});

test("notices: the project strings name the task, the flips, and the Pomodoro cleanup", () => {
  assert.equal(
    formatProjectDependencyNotice({
      added: 1,
      removed: 0,
      blocked: 2,
      recovered: 0,
      firstAdded: "Fix LinkedIn now",
      pomodoroRemoved: 2,
      pomodoroPruneFailed: false,
    }),
    '⛓ Project waits on "Fix LinkedIn now" · 2 tasks Blocked · removed 2 Pomodoro links',
  );
  assert.equal(
    formatProjectDependencyNotice({
      added: 0,
      removed: 1,
      blocked: 0,
      recovered: 2,
      firstRemoved: "Fix LinkedIn now",
      pomodoroRemoved: 0,
      pomodoroPruneFailed: false,
    }),
    '⛓ Project no longer waits on "Fix LinkedIn now" · 2 tasks Ready again',
  );
  assert.equal(
    formatProjectDependencyNotice({
      added: 1,
      removed: 0,
      blocked: 1,
      recovered: 0,
      firstAdded: "Fix LinkedIn now",
      pomodoroRemoved: 0,
      pomodoroPruneFailed: true,
    }),
    '⛓ Project waits on "Fix LinkedIn now" · 1 task Blocked; Pomodoro links not removed',
  );
  assert.equal(
    formatProjectDependencyNotice({ added: 1, blocked: 0 }),
    null,
  );
});

test("mapLineThroughStructural mirrors the assembly across deletes, inserts, and replaces", () => {
  const lines = ["a", "b", "c", "d", "e", "f"];
  const structuralDelete = {
    replaceLine: null,
    insertAt: null,
    deleteLines: [1],
  };
  assert.equal(mapLineThroughStructural(0, structuralDelete), 0);
  assert.equal(mapLineThroughStructural(2, structuralDelete), 1);
  const appliedDelete = applyDependencyPlanLines(
    lines,
    0,
    "a",
    [],
    structuralDelete,
    null,
    "\n",
  );
  assert.deepEqual(appliedDelete.lines, ["a", "c", "d", "e", "f"]);

  const structuralInsert = {
    replaceLine: null,
    insertAt: 2,
    deleteLines: [],
  };
  assert.equal(mapLineThroughStructural(1, structuralInsert), 1);
  assert.equal(mapLineThroughStructural(2, structuralInsert), 3);

  const structuralBoth = {
    replaceLine: null,
    insertAt: 4,
    deleteLines: [1, 2],
  };
  // Deletes 1,2 shift 4 → 2; the insert lands at 2, so 4 → 3.
  assert.equal(mapLineThroughStructural(4, structuralBoth), 3);
  const appliedBoth = applyDependencyPlanLines(
    lines,
    0,
    "a",
    [],
    structuralBoth,
    "INSERT",
    "\n",
  );
  assert.deepEqual(appliedBoth.lines, ["a", "d", "INSERT", "e", "f"]);
  assert.equal(appliedBoth.lines[3], "e");

  const structuralReplace = {
    replaceLine: 2,
    insertAt: null,
    deleteLines: [],
  };
  assert.equal(mapLineThroughStructural(3, structuralReplace), 3);
});

test("api v3: removeDependencyByRef delegates removals to the single-transaction writer", async () => {
  const content = blockedProjectNote();
  const editor = { getValue: () => content };
  const calls = [];
  const plugin = Object.create(NavigationHotkeysPlugin.prototype);
  plugin.getActiveMarkdownView = () => ({
    file: { path: "Project.md" },
    editor,
  });
  plugin.dependencyLinkpathResolver = () => null;
  plugin.applyDependencyEdit = async (args) => {
    calls.push(args);
    return { ok: true, reason: null, notice: "⛓ done" };
  };
  const outcome = await plugin.removeDependencyByRef(
    { path: "Project.md", line: 6 },
    { path: "job.md", blockId: "linkedin" },
  );
  assert.equal(outcome.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].parentPath, "Project.md");
  assert.equal(calls[0].parentLine, 5);
  assert.deepEqual(calls[0].add, []);
  assert.deepEqual(calls[0].remove, [{ path: "job.md", blockId: "linkedin" }]);
});

test("api v3: openDependencyStageForRef opens the Depends on stage on the owning task", async () => {
  const content = openProjectNote();
  const opened = [];
  const editor = {
    getValue: () => content,
    setCursor: () => {},
  };
  const plugin = Object.create(NavigationHotkeysPlugin.prototype);
  plugin.getActiveMarkdownView = () => ({
    file: { path: "Project.md" },
    editor,
  });
  plugin.openBulletPropertyPicker = (targetEditor, options) => {
    opened.push(options);
    return true;
  };
  const outcome = await plugin.openDependencyStageForRef({
    path: "Project.md",
    line: 6,
  });
  assert.equal(outcome.ok, true);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].initialProperty, "dependsOn");
});

test("internal links stay on the line but leave the field (PDR7)", () => {
  const content = [
    "---",
    'type: "[[project]]"',
    "status: wip",
    "---",
    "",
    "- [ ] #task #prj Ship it ^prj",
    "  - ⛓️ **DEPENDS ON:** [[#^pitch]]",
    "- [ ] #task Draft the pitch ^pitch",
  ].join("\n");
  const plan = planDependencyEdit({
    content,
    parentLine: 5,
    parentPath: "Project.md",
    add: [{ path: "job.md", blockId: "linkedin" }],
    remove: [],
    files: { "Project.md": content, "job.md": OPEN_JOB },
  });
  assert.equal(plan.ok, true);
  assert.ok(plan.nextContent.includes("[[#^pitch]]"));
  assert.equal(plan.field, "job__linkedin");
  assert.equal(plan.summary.openRemaining, 1);
});

test("removal from an unblocked ^prj never recovers own-reason residents (§13.10)", () => {
  const content = [
    "---",
    'type: "[[project]]"',
    "status: wip",
    "---",
    "",
    "- [ ] #task #prj Ship it [dependsOn:: job__linkedin] [fresh:: 2026-10-10] ^prj",
    "  - ⛓️ **DEPENDS ON:** [[job#^linkedin]]",
    "- [?] #task Draft the pitch [dependsOn:: other__x] [fresh:: 2026-10-10] #prj_is_blocked ^pitch",
  ].join("\n");
  const calls = [];
  const plan = planDependencyEdit({
    content,
    parentLine: 5,
    parentPath: "Project.md",
    add: [],
    remove: [{ path: "job.md", blockId: "linkedin" }],
    files: { "Project.md": content, "job.md": CLOSED_JOB },
    recovery: {
      registry: recoveryRegistry(),
      today: TODAY,
      vaultContents: null,
      markUnblockedLine: markUnblockedStub(calls),
    },
  });
  assert.equal(plan.ok, true);
  const out = plan.nextContent.split("\n");
  assert.ok(out[5].startsWith("- [ ]"), out[5]);
  const resident = out.find((line) => line.includes("^pitch"));
  assert.ok(resident.startsWith("- [?]"), resident);
  assert.ok(resident.includes("#prj_is_blocked"), resident);
  assert.ok(!resident.includes("[unblocked::"), resident);
  assert.equal(calls.length, 0);
});

test("resident recovery touches only tagged residents (§13.10)", () => {
  const content = blockedProjectNote({
    residents: [
      "- [?] #task Draft the pitch [fresh:: 2026-10-10] #prj_is_blocked ^pitch",
      "- [?] #task Solo effort [fresh:: 2026-10-10] ^solo",
    ],
  });
  const calls = [];
  const plan = planDependencyEdit({
    content,
    parentLine: 5,
    parentPath: "Project.md",
    add: [],
    remove: [{ path: "job.md", blockId: "linkedin" }],
    files: { "Project.md": content, "job.md": CLOSED_JOB },
    recovery: {
      registry: recoveryRegistry(),
      today: TODAY,
      vaultContents: null,
      markUnblockedLine: markUnblockedStub(calls),
    },
  });
  assert.equal(plan.ok, true);
  const out = plan.nextContent.split("\n");
  const pitch = out.find((line) => line.includes("^pitch"));
  assert.ok(pitch.startsWith("- [ ]"), pitch);
  assert.ok(pitch.includes("[unblocked:: 2026-10-12]"), pitch);
  const solo = out.find((line) => line.includes("^solo"));
  assert.ok(solo.startsWith("- [?]"), solo);
  assert.ok(!solo.includes("[unblocked::"), solo);
  assert.equal(plan.summary.project.recovered, 1);
  assert.equal(plan.summary.project.ready, 1);
});

test("stage guard refuses a candidate that closes a cycle through a resident edge (§13.10)", () => {
  const prjKey = dependencyStageRowKey("Project.md", "prj");
  const residentKey = dependencyStageRowKey("Project.md", "pitch");
  const extKey = dependencyStageRowKey("job.md", "ext");
  const view = planDependencyStageView({
    current: [],
    candidates: [
      {
        path: "job.md",
        route: "job",
        note: "job",
        line: 0,
        rawLine: "- [ ] #task External ^ext",
        status: " ",
        displayText: "External",
        text: "External",
        blockId: "ext",
        existingBlockId: "ext",
        idField: null,
        existingIdField: null,
        section: null,
        open: true,
        blocked: false,
        hidden: false,
      },
    ],
    query: "External",
    dependent: {
      path: "Project.md",
      line: 5,
      key: prjKey,
      displayText: "Ship",
      text: "Ship",
      isProjectPrj: true,
      projectResidentKeys: [residentKey],
    },
    edges: new Map([[extKey, [residentKey]]]),
    linkedKeys: new Set(),
  });
  const row = view.find((entry) => entry.blockId === "ext");
  assert.ok(row, "candidate is listed");
  assert.equal(row.disabled, true);
  assert.equal(row.disabledReason, "would create a cycle");
});

test("projectDependentResidentKeys lists open residents with block ids", () => {
  const content = openProjectNote();
  assert.deepEqual(projectDependentResidentKeys(content, "Project.md", 5), [
    dependencyStageRowKey("Project.md", "pitch"),
    dependencyStageRowKey("Project.md", "sponsor"),
  ]);
  assert.deepEqual(projectDependentResidentKeys(content, "Project.md", 6), []);
});

test("navNoteScopeFlags marks daily notes; a missing writer stays null", () => {
  assert.equal(navNoteScopeFlags("Areas/Project.md").isDailyNote, false);
  assert.equal(navNoteScopeFlags("2026/20261012.md").isDailyNote, true);
  assert.equal(navNoteScopeFlags("2026/20261012.md").isToday, false);
  assert.equal(navFreshnessMarkUnblockedLine(null), null);
  assert.equal(navFreshnessMarkUnblockedLine({}), null);
  const seen = [];
  const writer = navFreshnessMarkUnblockedLine({
    markUnblockedLine: (line, options) => {
      seen.push(options);
      return `${line} [unblocked:: 2026-10-12]`;
    },
  });
  assert.equal(typeof writer, "function");
  assert.equal(
    writer("- [ ] #task A ^a", { today: TODAY, status: " " }),
    "- [ ] #task A ^a [unblocked:: 2026-10-12]",
  );
  assert.equal(seen.length, 1);
});

test("reconcileBlockedScheduledTaskLine forwards scope flags to the writer", () => {
  const seen = [];
  const outcome = reconcileBlockedScheduledTaskLine(
    "- [?] #task Draft the pitch [fresh:: 2026-10-10] ^pitch",
    { state: "ready", rank: " " },
    {
      today: TODAY,
      ownLine: false,
      markUnblockedLine: (line, options) => {
        seen.push(options);
        return line;
      },
      isDailyNote: true,
      isToday: false,
    },
  );
  assert.equal(outcome.outcome, "ready");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].isDailyNote, true);
  assert.equal(seen[0].isToday, false);
});

test("parseProjectNoteFrontmatter ignores leftover scheduled keys", () => {
  const multiple = [
    "---",
    'type: "[[project]]"',
    "status: wip",
    "scheduled: 2026-10-01",
    "scheduled: 2026-11-01",
    "---",
    "",
    "- [ ] #task #prj Ship ^prj",
  ].join("\n");
  const parsedMultiple = parseProjectNoteFrontmatter(multiple, {});
  assert.equal(parsedMultiple.valid, true, parsedMultiple.error);
  const invalid = [
    "---",
    'type: "[[project]]"',
    "status: wip",
    "scheduled: soon",
    "---",
    "",
    "- [ ] #task #prj Ship ^prj",
  ].join("\n");
  const parsedInvalid = parseProjectNoteFrontmatter(invalid, {});
  assert.equal(parsedInvalid.valid, true, parsedInvalid.error);
});

test("formatTaskMoveProjectCountsNotice names blocked and recovered counts", () => {
  assert.equal(formatTaskMoveProjectCountsNotice(0, 0), "");
  assert.equal(formatTaskMoveProjectCountsNotice(2, 0), " · 2 Blocked");
  assert.equal(formatTaskMoveProjectCountsNotice(0, 1), " · 1 Ready again");
  assert.equal(
    formatTaskMoveProjectCountsNotice(2, 1),
    " · 2 Blocked · 1 Ready again",
  );
});
