const test = require("node:test");
const assert = require("node:assert/strict");
const { helpers } = require("./block-id-prompt-harness.cjs");

test("explicit task IDs exclusively own dependency lookup", () => {
  const content = [
    "- [ ] #task Parent [dependsOn:: projects__Shared__review] ^parent",
    "- [ ] #task Target [id:: projects__Shared__review] ^review",
  ].join("\n");
  const state = helpers.collectTaskPickerItems(content)[0].dependency;
  assert.equal(state.isBlocked, true);
  assert.equal(state.unmetBlockers[0].id, "projects__Shared__review");

  const stale = content.replace(
    "projects__Shared__review] ^parent",
    "review] ^parent",
  );
  const staleState = helpers.collectTaskPickerItems(stale)[0].dependency;
  assert.deepEqual(staleState.unresolvedIds, ["review"]);
  assert.equal(staleState.isBlocked, false);
});

test("legacy tasks without an id field still fall back to their block ID", () => {
  const content = [
    "- [ ] #task Parent [dependsOn:: review] ^parent",
    "- [ ] #task Legacy target ^review",
  ].join("\n");
  assert.equal(helpers.collectTaskPickerItems(content)[0].dependency.isBlocked, true);
});

test("task picker includes Blocked tasks and excludes closed, hidden, and untagged lines", () => {
  const content = [
    "- [ ] #task Ready",
    "- [/] #task Active",
    "- [*] #task Next",
    "- [?] #task Blocked",
    "- [x] #task Done lowercase",
    "- [X] #task Done uppercase",
    "- [-] #task Canceled",
    "- [?] Missing project tag",
    "- [?] #task Hidden #hide",
  ].join("\n");

  const tasks = helpers.collectTaskPickerItems(content);

  assert.deepEqual(tasks.map((task) => task.status), [" ", "/", "*", "?"]);
  assert.deepEqual(tasks.map((task) => task.line), [0, 1, 2, 3]);
});

test("task blocked state unifies status and dependency reasons", () => {
  const noDependencies = {
    depIds: [],
    unmetBlockers: [],
    metCount: 0,
    unresolvedIds: [],
    isBlocked: false,
  };
  const unmetDependency = {
    depIds: ["blocked-target", "done-target", "missing-target"],
    unmetBlockers: [
      { id: "blocked-target", title: "Blocked target", line: 8, status: " " },
    ],
    metCount: 1,
    unresolvedIds: ["missing-target"],
    isBlocked: true,
  };

  assert.deepEqual(
    helpers.taskBlockedState({ status: "?", dependency: noDependencies }),
    {
      isBlocked: true,
      statusBlocked: true,
      dependencyBlocked: false,
      depCount: 0,
      metCount: 0,
      unmetCount: 0,
      unresolvedCount: 0,
      unmetBlockers: [],
    },
  );
  assert.deepEqual(
    helpers.taskBlockedState({ status: " ", dependency: unmetDependency }),
    {
      isBlocked: true,
      statusBlocked: false,
      dependencyBlocked: true,
      depCount: 3,
      metCount: 1,
      unmetCount: 1,
      unresolvedCount: 1,
      unmetBlockers: unmetDependency.unmetBlockers,
    },
  );
  assert.deepEqual(
    helpers.taskBlockedState({ status: "?", dependency: unmetDependency }),
    {
      isBlocked: true,
      statusBlocked: true,
      dependencyBlocked: true,
      depCount: 3,
      metCount: 1,
      unmetCount: 1,
      unresolvedCount: 1,
      unmetBlockers: unmetDependency.unmetBlockers,
    },
  );
  assert.deepEqual(
    helpers.taskBlockedState({ status: " ", dependency: noDependencies }),
    {
      isBlocked: false,
      statusBlocked: false,
      dependencyBlocked: false,
      depCount: 0,
      metCount: 0,
      unmetCount: 0,
      unresolvedCount: 0,
      unmetBlockers: [],
    },
  );
});

test("task picker partition sinks blocked tasks while preserving group order", () => {
  const dependencyBlocked = {
    depIds: ["target"],
    unmetBlockers: [
      { id: "target", title: "Target", line: 10, status: " " },
    ],
    metCount: 0,
    unresolvedIds: [],
    isBlocked: true,
  };
  const tasks = [
    { line: 0, status: " " },
    { line: 1, status: "?" },
    { line: 2, status: " ", dependency: dependencyBlocked },
    { line: 3, status: "/" },
    { line: 4, status: "?", dependency: dependencyBlocked },
  ];

  const groups = helpers.partitionTaskPickerItems(tasks);

  assert.deepEqual(groups.unblocked.map((task) => task.line), [0, 3]);
  assert.deepEqual(groups.blocked.map((task) => task.line), [1, 2, 4]);
});

test("blocked chip labels show useful unmet dependency counts", () => {
  assert.equal(
    helpers.blockedChipLabel({
      dependencyBlocked: true,
      depCount: 1,
      unmetCount: 1,
    }),
    "Blocked",
  );
  assert.equal(
    helpers.blockedChipLabel({
      dependencyBlocked: true,
      depCount: 3,
      unmetCount: 2,
    }),
    "Blocked · 2",
  );
  assert.equal(
    helpers.blockedChipLabel({
      dependencyBlocked: false,
      depCount: 0,
      unmetCount: 0,
    }),
    "Blocked",
  );
});

test("blocked tooltips explain dependency and status-only reasons", () => {
  const dependencyBlocked = helpers.taskBlockedState({
    status: " ",
    dependency: {
      depIds: ["a", "b", "c", "d", "missing-a", "missing-b"],
      unmetBlockers: [
        { id: "a", title: "Alpha" },
        { id: "b", title: "Beta" },
        { id: "c", title: "Gamma" },
        { id: "d", title: "Delta" },
      ],
      metCount: 0,
      unresolvedIds: ["missing-a", "missing-b"],
      isBlocked: true,
    },
  });
  assert.equal(
    helpers.buildBlockedTooltip(dependencyBlocked),
    "Blocked by: Alpha, Beta, Gamma, +1 more; 2 unresolved",
  );

  assert.equal(
    helpers.buildBlockedTooltip(
      helpers.taskBlockedState({ status: "?" }),
    ),
    "Marked Blocked in the note; no dependencies listed",
  );

  const unresolved = helpers.taskBlockedState({
    status: "?",
    dependency: {
      depIds: ["missing-a", "missing-b"],
      unmetBlockers: [],
      metCount: 0,
      unresolvedIds: ["missing-a", "missing-b"],
      isBlocked: false,
    },
  });
  assert.equal(
    helpers.buildBlockedTooltip(unresolved),
    "Marked Blocked in the note; 2 unresolved dependency references",
  );

  const allDone = helpers.taskBlockedState({
    status: "?",
    dependency: {
      depIds: ["done-a", "done-b"],
      unmetBlockers: [],
      metCount: 2,
      unresolvedIds: [],
      isBlocked: false,
    },
  });
  assert.equal(
    helpers.buildBlockedTooltip(allDone),
    "Marked Blocked in the note; all 2 dependencies are done",
  );
});

test("task status classes cover every open task status", () => {
  assert.equal(helpers.taskStatusClass(" "), "todo");
  assert.equal(helpers.taskStatusClass("/"), "active");
  assert.equal(helpers.taskStatusClass("*"), "next");
  assert.equal(helpers.taskStatusClass("?"), "blocked");
});

test("Blocked tasks remain unmet dependency targets", () => {
  const content = [
    "- [ ] #task Parent [dependsOn:: target] ^parent",
    "- [?] #task Target ^target",
  ].join("\n");
  const parent = helpers.collectTaskPickerItems(content)[0];

  assert.equal(parent.dependency.isBlocked, true);
  assert.equal(parent.dependency.unmetBlockers.length, 1);
  assert.equal(parent.dependency.unmetBlockers[0].status, "?");
});

test("blocked task count covers both reasons without double-counting", () => {
  const dependencyBlocked = {
    depIds: ["target"],
    unmetBlockers: [{ id: "target", title: "Target" }],
    metCount: 0,
    unresolvedIds: [],
    isBlocked: true,
  };
  const tasks = [
    { status: "?" },
    { status: " ", dependency: dependencyBlocked },
    { status: "?", dependency: dependencyBlocked },
    { status: " " },
  ];

  assert.equal(helpers.countBlockedTasks(tasks), 3);
});
