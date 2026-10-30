// Sub-project discovery, tag proxy, and the subtree planner (bob-cli-78.5,
// `docs/task-dependencies.md` §13.19 PDS6/PDS15, PDG8–PDG13).
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  helpers,
  compatibleTasksSettings,
} = require("./navigation-hotkeys-harness.cjs");

const TODAY = new Date(2026, 9, 12, 12);

const {
  projectParentTarget,
  projectParentFieldFromNoteText,
  resolveProjectParentPath,
  buildProjectChildrenMap,
  collectProjectDescendants,
  planProjectSubtreePass,
  getProjectBlockState,
  shouldRecoverProjectResidents,
  failProjectPrjInternalAdd,
  planDependencyEdit,
  planDependencyStageView,
  planProjectTaskSchedules,
  planProjectScheduledDelete,
  parseProjectLifecycleTaskBody,
  taskHasProjectBlockedTag,
  buildScheduledRecoveryIndex,
  getScheduledRecoveryMetadata,
} = helpers;

function projectNote(overrides = {}) {
  const {
    type = "[[project]]",
    status = "wip",
    parent = null,
    prjStatus = " ",
    prjExtra = "",
    dependsOn = null,
    residents = [],
  } = overrides;
  const frontmatter = ["---", `type: ${type}`, `status: ${status}`];
  if (parent) {
    frontmatter.push(`parent: ${parent}`);
  }
  frontmatter.push("---", "");
  const prj = `- [${prjStatus}] #task #prj Ship the project${prjExtra} ^prj`;
  const body = [prj];
  if (dependsOn) {
    body.push(dependsOn);
  }
  body.push(...residents);
  return [...frontmatter, ...body].join("\n");
}

function recoveryRegistry() {
  return helpers.parseTasksStatusRegistry(compatibleTasksSettings());
}

function markUnblocked(line) {
  return String(line).replace(/(?= \^[A-Za-z0-9-]+\s*$)/, " [unblocked:: 2026-10-12]");
}

function lookupNone() {
  return false;
}

function lookupJob(path, blockId) {
  return path === "job.md" && blockId === "linkedin";
}

function lookupChildOwn(path, blockId) {
  return path === "other.md" && blockId === "y";
}

function childNote(overrides = {}) {
  return projectNote({
    parent: '"[[N]]"',
    prjStatus: " ",
    residents: [
      "- [ ] #task Nested work ^nested",
      "- [ ] #task #ref Sponsor pitch ^sponsor",
    ],
    ...overrides,
  });
}

function grandchildNote(overrides = {}) {
  return projectNote({
    parent: '"[[K]]"',
    prjStatus: " ",
    residents: ["- [ ] #task Deep work ^deep"],
    ...overrides,
  });
}

function parentNote(overrides = {}) {
  return projectNote({
    prjStatus: " ",
    residents: ["- [ ] #task Parent resident ^pres"],
    ...overrides,
  });
}

test("PDS15: projectParentTarget keeps the path and drops alias and heading", () => {
  assert.equal(projectParentTarget('[[N]]'), "N");
  assert.equal(projectParentTarget('"[[N|Alias]]"'), "N");
  assert.equal(projectParentTarget("[[dir/N]]"), "dir/N");
  assert.equal(projectParentTarget("[[N#Heading]]"), "N");
  assert.equal(projectParentTarget("[[dir/N|Alias]]"), "dir/N");
  assert.equal(projectParentTarget("[[dir/N#Heading|Alias]]"), "dir/N");
});

test("PDS6: list-form, missing, and non-wikilink parents yield none", () => {
  assert.equal(projectParentTarget(["[[N]]"]), null);
  assert.equal(projectParentTarget(["[[A]]", "[[B]]"]), null);
  assert.equal(projectParentTarget(""), null);
  assert.equal(projectParentTarget(null), null);
  assert.equal(projectParentTarget("N"), null);
  assert.equal(projectParentTarget("[[ ]]"), null);
  assert.equal(
    projectParentFieldFromNoteText(
      ["---", "type: [[project]]", "parent:", '  - "[[N]]"', "---", ""].join("\n"),
    ) instanceof Array,
    true,
  );
  assert.equal(
    projectParentTarget(
      projectParentFieldFromNoteText(
        ["---", "type: [[project]]", "parent:", '  - "[[N]]"', "---", ""].join("\n"),
      ),
    ),
    null,
  );
});

test("PDS15: resolveProjectParentPath accepts alias, path, and heading forms", () => {
  const notes = ["N.md", "dir/N.md", "K.md"];
  assert.equal(resolveProjectParentPath("N", "K.md", notes), "N.md");
  assert.equal(resolveProjectParentPath("dir/N", "K.md", notes), "dir/N.md");
  assert.equal(
    resolveProjectParentPath("N", "child.md", ["Projects/N.md"]),
    "Projects/N.md",
  );
});

test("PDS6: self, unresolved, and ambiguous basenames yield no parent", () => {
  assert.equal(resolveProjectParentPath("K", "K.md", ["K.md", "N.md"]), null);
  assert.equal(resolveProjectParentPath("Missing", "K.md", ["K.md", "N.md"]), null);
  assert.equal(
    resolveProjectParentPath("home", "K.md", ["Areas/Home.md", "Projects/home.md"]),
    null,
  );
  assert.equal(
    resolveProjectParentPath("dir/Missing", "K.md", ["K.md", "N.md"]),
    null,
  );
});

test("buildProjectChildrenMap and descendants BFS skip cycles and cap depth", () => {
  const n = parentNote();
  const k = childNote();
  const g = grandchildNote();
  const files = [
    { path: "N.md", text: n },
    { path: "K.md", text: k },
    { path: "G.md", text: g },
  ];
  const children = buildProjectChildrenMap(files, (file) =>
    projectParentFieldFromNoteText(file.text),
  );
  assert.deepEqual(children.get("N.md"), ["K.md"]);
  assert.deepEqual(children.get("K.md"), ["G.md"]);
  assert.deepEqual(collectProjectDescendants("N.md", children), ["K.md", "G.md"]);

  const cycleA = projectNote({ parent: '"[[B]]"' });
  const cycleB = projectNote({ parent: '"[[A]]"' });
  const cycleMap = buildProjectChildrenMap(
    [
      { path: "A.md", text: cycleA },
      { path: "B.md", text: cycleB },
    ],
    (file) => projectParentFieldFromNoteText(file.text),
  );
  const cycleDescendants = collectProjectDescendants("A.md", cycleMap);
  assert.ok(cycleDescendants.includes("B.md"));
  assert.equal(cycleDescendants.includes("A.md"), false);

  const chain = [];
  for (let i = 0; i <= 18; i += 1) {
    const parent = i === 0 ? null : `"[[P${i - 1}]]"`;
    chain.push({
      path: `P${i}.md`,
      text: projectNote({ parent }),
    });
  }
  const deepMap = buildProjectChildrenMap(chain, (file) =>
    projectParentFieldFromNoteText(file.text),
  );
  const deep = collectProjectDescendants("P0.md", deepMap);
  assert.equal(deep.length, 16);
  assert.equal(deep[15], "P16.md");
  assert.equal(deep.includes("P17.md"), false);
});

test("buildProjectChildrenMap skips vault-sync conflict copies", () => {
  const files = [
    { path: "sase.md", text: parentNote() },
    {
      path: "child.md",
      text: projectNote({ parent: '"[[sase]]"' }),
    },
    {
      path: "_conflicts/child.kellys-mbp-2026-10-23T224729-0400.md",
      text: projectNote({ parent: '"[[sase]]"' }),
    },
  ];
  const children = buildProjectChildrenMap(files, (file) =>
    projectParentFieldFromNoteText(file.text),
  );
  assert.deepEqual(children.get("sase.md"), ["child.md"]);
  assert.equal(
    (children.get("sase.md") || []).some((path) => path.includes("_conflicts")),
    false,
  );
});

test("PDS6: area, terminal, daily, and self-parent notes are not children", () => {
  const files = [
    { path: "N.md", text: parentNote() },
    { path: "Area.md", text: projectNote({ type: "[[area]]", parent: '"[[N]]"' }) },
    { path: "Done.md", text: projectNote({ status: "done", parent: '"[[N]]"' }) },
    {
      path: "2026/20261012.md",
      text: projectNote({ parent: '"[[N]]"' }),
    },
    { path: "Self.md", text: projectNote({ parent: '"[[Self]]"' }) },
  ];
  const children = buildProjectChildrenMap(files, (file) =>
    projectParentFieldFromNoteText(file.text),
  );
  assert.equal(children.has("N.md"), false);
  assert.deepEqual(collectProjectDescendants("N.md", children), []);
  assert.deepEqual(collectProjectDescendants("Self.md", children), []);
});

test("PDG8: planner blocks child and grandchild ^prj and residents", () => {
  const k = childNote();
  const g = grandchildNote();
  const pass = planProjectSubtreePass({
    rootPath: "N.md",
    rootText: parentNote(),
    rootBlockedAfter: true,
    descendants: [
      { path: "K.md", text: k },
      { path: "G.md", text: g },
    ],
    lookupOpen: lookupNone,
    today: TODAY,
  });
  assert.equal(pass.blocked, 2);
  assert.equal(pass.recovered, 0);
  const kAfter = pass.notes.find((note) => note.path === "K.md").after;
  const gAfter = pass.notes.find((note) => note.path === "G.md").after;
  assert.match(kAfter, /\[\?\] #task #prj Ship the project #prj_is_blocked \^prj/);
  assert.match(kAfter, /\[\?\] #task Nested work #prj_is_blocked \^nested/);
  assert.match(kAfter, /\[\?\] #task #ref Sponsor pitch #prj_is_blocked \^sponsor/);
  assert.match(gAfter, /\[\?\] #task #prj Ship the project #prj_is_blocked \^prj/);
  assert.match(gAfter, /\[\?\] #task Deep work #prj_is_blocked \^deep/);
  assert.ok(pass.pomodoroTargets.some((target) => target.path === "K.md" && target.blockId === "prj"));
  assert.ok(pass.pomodoroTargets.some((target) => target.path === "K.md" && target.blockId === "nested"));
  assert.ok(pass.laneStatuses.includes(" "));
});

test("PDG9: planner recovers tagged descendants with [unblocked::]", () => {
  const k = childNote({
    prjStatus: "?",
    prjExtra: " #prj_is_blocked",
    residents: [
      "- [?] #task Nested work #prj_is_blocked ^nested",
      "- [?] #task #ref Sponsor pitch #prj_is_blocked ^sponsor",
    ],
  });
  const g = grandchildNote({
    prjStatus: "?",
    prjExtra: " #prj_is_blocked",
    residents: ["- [?] #task Deep work #prj_is_blocked ^deep"],
  });
  const pass = planProjectSubtreePass({
    rootPath: "N.md",
    rootText: parentNote(),
    rootBlockedAfter: false,
    descendants: [
      { path: "K.md", text: k },
      { path: "G.md", text: g },
    ],
    lookupOpen: lookupNone,
    today: TODAY,
    markUnblockedLine: markUnblocked,
  });
  assert.equal(pass.blocked, 0);
  assert.equal(pass.recovered, 2);
  const kAfter = pass.notes.find((note) => note.path === "K.md").after;
  const gAfter = pass.notes.find((note) => note.path === "G.md").after;
  assert.match(kAfter, /\[ \] #task #prj Ship the project \[unblocked:: 2026-10-12\] \^prj/);
  assert.equal(taskHasProjectBlockedTag(kAfter.split("\n").find((line) => / \^prj\s*$/.test(line))), false);
  assert.match(kAfter, /\[ \] #task Nested work \[unblocked:: 2026-10-12\] \^nested/);
  assert.match(gAfter, /\[ \] #task Deep work \[unblocked:: 2026-10-12\] \^deep/);
});

test("PDG10: child with its own open target keeps residents tagged; grandchild stays inherited", () => {
  const k = childNote({
    prjStatus: "?",
    prjExtra: " #prj_is_blocked",
    dependsOn: "  - ⛓️ **DEPENDS ON:** [[other#^y]]",
    residents: [
      "- [?] #task Nested work #prj_is_blocked ^nested",
      "- [?] #task #ref Sponsor pitch #prj_is_blocked ^sponsor",
    ],
  });
  const g = grandchildNote({
    prjStatus: "?",
    prjExtra: " #prj_is_blocked",
    residents: ["- [?] #task Deep work #prj_is_blocked ^deep"],
  });
  const pass = planProjectSubtreePass({
    rootPath: "N.md",
    rootText: parentNote(),
    rootBlockedAfter: false,
    descendants: [
      { path: "K.md", text: k },
      { path: "G.md", text: g },
    ],
    lookupOpen: lookupChildOwn,
    today: TODAY,
    markUnblockedLine: markUnblocked,
  });
  assert.equal(pass.recovered, 0);
  assert.equal(pass.blocked, 1);
  const kAfter = pass.notes.find((note) => note.path === "K.md").after;
  const kPrj = kAfter.split("\n").find((line) => / \^prj\s*$/.test(line));
  assert.match(kPrj, /^- \[\?\] /);
  assert.equal(taskHasProjectBlockedTag(kPrj), false);
  assert.match(kAfter, /\[\?\] #task Nested work #prj_is_blocked \^nested/);
  assert.equal(pass.notes.some((note) => note.path === "G.md"), false);
});

test("PDG11: a tagged root re-asserts descendant tags and recovers nothing", () => {
  const k = childNote({
    prjStatus: "?",
    prjExtra: " #prj_is_blocked",
    residents: ["- [?] #task Nested work #prj_is_blocked ^nested"],
  });
  const g = grandchildNote({
    prjStatus: "?",
    prjExtra: " #prj_is_blocked",
    residents: ["- [?] #task Deep work #prj_is_blocked ^deep"],
  });
  const pass = planProjectSubtreePass({
    rootPath: "N.md",
    rootText: parentNote({ prjStatus: "?", prjExtra: " #prj_is_blocked" }),
    rootBlockedAfter: true,
    descendants: [
      { path: "K.md", text: k },
      { path: "G.md", text: g },
    ],
    lookupOpen: lookupNone,
    today: TODAY,
    markUnblockedLine: () => {
      assert.fail("PDG11 must not recover");
    },
  });
  assert.equal(pass.recovered, 0);
  assert.equal(pass.blocked, 2);
  assert.equal(pass.notes.length, 0);
});

test("tag proxy: getProjectBlockState reports project_parent when ^prj is tagged", () => {
  const content = projectNote({
    parent: '"[[N]]"',
    prjStatus: "?",
    prjExtra: " #prj_is_blocked",
    dependsOn: null,
  });
  const state = getProjectBlockState(content, "K.md", TODAY, lookupNone);
  assert.equal(state.isProject, true);
  assert.equal(state.reasons.length, 1);
  assert.equal(state.reasons[0].kind, "project_parent");
  assert.equal(state.reasons[0].projectPath, "N");
});

test("tag proxy: applyProjectRecoveryEdges blocks residents of a tagged ^prj", () => {
  const project = projectNote({
    parent: '"[[N]]"',
    prjStatus: "?",
    prjExtra: " #prj_is_blocked",
    dependsOn: null,
    residents: ["- [?] #task Draft the pitch #prj_is_blocked ^pitch"],
  });
  const index = buildScheduledRecoveryIndex(
    [{ path: "K.md", content: project }],
    recoveryRegistry(),
    TODAY,
  );
  const residentLine = project.split("\n").findIndex((line) => line.includes("^pitch"));
  const resident = getScheduledRecoveryMetadata(index, "K.md", residentLine);
  assert.equal(resident.state, "blocked");
  assert.match(resident.reason, /project_parent/);
});

test("tag proxy: shouldRecoverProjectResidents is false for a tagged ^prj", () => {
  const projectPrj = { path: "K.md", prjLine: 4, residents: [] };
  const recovery = { registry: recoveryRegistry() };
  assert.equal(
    shouldRecoverProjectResidents(
      projectPrj,
      recovery,
      1,
      false,
      0,
      "- [?] #task Ship #prj_is_blocked ^prj",
      TODAY,
    ),
    false,
  );
  assert.equal(
    shouldRecoverProjectResidents(
      projectPrj,
      recovery,
      1,
      false,
      0,
      "- [?] #task Ship ^prj",
      TODAY,
    ),
    true,
  );
});

test("tag proxy: Schedule keeps a tagged ^prj blocked and does not recover residents", () => {
  const input = [
    "---",
    "type: [[project]]",
    "---",
    "- [?] #task Ship #prj_is_blocked [scheduled:: 2026-07-30] ^prj",
    "- [?] #task Work [scheduled:: 2026-07-30] #prj_is_blocked ^work",
  ].join("\n");
  const due = planProjectTaskSchedules(input, "2026-07-11", new Date(2026, 6, 11), {
    recoveryByLine: new Map([
      [3, { state: "ready", rank: " ", reason: null }],
      [4, { state: "ready", rank: " ", reason: null }],
    ]),
    markUnblockedLine: markUnblocked,
  });
  assert.equal(due.valid, true);
  assert.match(due.content, /- \[\?\] #task Ship #prj_is_blocked \[scheduled:: 2026-07-11\] \^prj/);
  assert.match(due.content, /- \[\?\] #task Work \[scheduled:: 2026-07-11\] #prj_is_blocked \^work/);
  assert.doesNotMatch(due.content, /\[unblocked::/);

  const deleted = planProjectScheduledDelete(input, 3, {
    today: new Date(2026, 6, 11),
    recoveryByLine: new Map([
      [3, { state: "ready", rank: " ", reason: null }],
      [4, { state: "ready", rank: " ", reason: null }],
    ]),
    markUnblockedLine: markUnblocked,
  });
  assert.equal(deleted.valid, true);
  assert.match(deleted.content, /- \[\?\] #task Ship #prj_is_blocked \^prj/);
  assert.match(deleted.content, /- \[\?\] #task Work #prj_is_blocked \^work/);
});

test("PDG13: failProjectPrjInternalAdd refuses descendant targets", () => {
  const projectPrj = { path: "N.md" };
  assert.equal(
    failProjectPrjInternalAdd(
      projectPrj,
      [{ path: "K.md", blockId: "nested" }],
      "N.md",
      ["K.md", "G.md"],
    ),
    "project-descendant-target",
  );
  assert.equal(
    failProjectPrjInternalAdd(
      projectPrj,
      [{ path: "N.md", blockId: "pres" }],
      "N.md",
      ["K.md"],
    ),
    "project-internal-target",
  );
  assert.equal(
    failProjectPrjInternalAdd(
      projectPrj,
      [{ path: "job.md", blockId: "linkedin" }],
      "N.md",
      ["K.md"],
    ),
    null,
  );
});

test("PDG13: planDependencyEdit refuses a descendant add from the files map", () => {
  const n = parentNote();
  const k = childNote();
  const refused = planDependencyEdit({
    content: n,
    parentLine: 5,
    parentPath: "N.md",
    add: [{ path: "K.md", blockId: "nested" }],
    remove: [],
    files: { "N.md": n, "K.md": k },
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, "project-descendant-target");
});

test("PDG13: the stage disables descendant rows", () => {
  const view = planDependencyStageView({
    current: [],
    candidates: [
      {
        path: "K.md",
        blockId: "nested",
        line: 5,
        status: "*",
        displayText: "Nested work",
        text: "Nested work",
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
      path: "N.md",
      line: 4,
      key: "N.md\x00prj",
      isProjectPrj: true,
      projectDescendantPaths: ["K.md", "G.md"],
    },
    edges: new Map(),
    linkedKeys: new Set(),
  });
  const nested = view.find((row) => row.blockId === "nested");
  const linkedin = view.find((row) => row.blockId === "linkedin");
  assert.equal(nested.disabled, true);
  assert.equal(nested.disabledReason, "inside a sub-project of this project");
  assert.equal(linkedin.disabled, false);
});

test("reversal: parseProjectLifecycleTaskBody strips #prj_is_blocked", () => {
  const parsed = parseProjectLifecycleTaskBody(
    "- [?] #task #prj Keep going #prj_is_blocked #hide ^prj",
  );
  assert.equal(parsed.status, "?");
  assert.equal(taskHasProjectBlockedTag(`#task ${parsed.description}`), false);
  assert.doesNotMatch(parsed.description, /prj_is_blocked/);
});

test("tag proxy: removing the last own dep of a tagged ^prj recovers nobody", () => {
  const content = projectNote({
    parent: '"[[N]]"',
    prjStatus: "?",
    prjExtra: " #prj_is_blocked",
    dependsOn: "  - ⛓️ **DEPENDS ON:** [[job#^linkedin]]",
    residents: ["- [?] #task Draft the pitch #prj_is_blocked ^pitch"],
  });
  const job = "- [x] #task Apply on LinkedIn [id:: job__linkedin] ^linkedin";
  const plan = planDependencyEdit({
    content,
    parentLine: content.split("\n").findIndex((line) => / \^prj\s*$/.test(line)),
    parentPath: "K.md",
    add: [],
    remove: [{ path: "job.md", blockId: "linkedin" }],
    files: { "K.md": content, "job.md": job },
    recovery: {
      registry: recoveryRegistry(),
      today: TODAY,
      markUnblockedLine: markUnblocked,
    },
  });
  assert.equal(plan.ok, true, plan.reason);
  const prj = plan.nextContent.split("\n").find((line) => / \^prj\s*$/.test(line));
  assert.match(prj, /^- \[\?\] /);
  assert.equal(taskHasProjectBlockedTag(prj), true);
  const pitch = plan.nextContent.split("\n").find((line) => line.includes("^pitch"));
  assert.match(pitch, /^- \[\?\] /);
  assert.equal(taskHasProjectBlockedTag(pitch), true);
  assert.doesNotMatch(plan.nextContent, /\[unblocked::/);
});
