const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  helpers,
  compatibleTasksSettings,
} = require("./navigation-hotkeys-harness.cjs");

test("project schedule validation accepts only real YYYY-MM-DD dates", () => {
  assert.equal(helpers.validateProjectScheduledDate("2028-02-29").valid, true);
  assert.equal(helpers.validateProjectScheduledDate("2026-02-29").valid, false);
  assert.equal(helpers.validateProjectScheduledDate("2026-7-10").valid, false);
  assert.equal(helpers.validateProjectScheduledDate("").valid, false);
});

test("source task schedule is extracted without losing task metadata", () => {
  const parsed = helpers.parseProjectSourceTaskLine(
    "- [/] #task Ship it [scheduled:: 2026-07-16] [p::3] ^ship-it",
  );
  assert.deepEqual(
    {
      description: parsed.description,
      priority: parsed.priority,
      blockId: parsed.blockId,
      status: parsed.status,
      scheduled: parsed.scheduled,
      scheduleError: parsed.scheduleError,
    },
    {
      description: "Ship it",
      priority: "3",
      blockId: "ship-it",
      status: "/",
      scheduled: "2026-07-16",
      scheduleError: null,
    },
  );

  const extracted = helpers.extractProjectSourceSchedule(
    "Ship [scheduled:: 2026-07-16] [created:: 2026-07-01]",
  );
  assert.equal(extracted.scheduled, "2026-07-16");
  assert.equal(extracted.description, "Ship  [created:: 2026-07-01]");
});

test("source task schedule errors are focused and ambiguous fields fail", () => {
  const invalid = helpers.parseProjectSourceTaskLine(
    "- [ ] #task Ship [scheduled:: 2026-02-30]",
  );
  assert.match(invalid.scheduleError, /not a valid calendar date/);

  const ambiguous = helpers.parseProjectSourceTaskLine(
    "- [ ] #task Ship [scheduled:: 2026-07-16] [scheduled:: 2026-07-17]",
  );
  assert.match(ambiguous.scheduleError, /multiple/);
});

test("project creation frontmatter receives source scheduling atomically", () => {
  assert.deepEqual(
    helpers.applyProjectCreationFrontmatter(
      {},
      "[[Parent]]",
      "2026-07-16",
    ),
    {
      parent: "[[Parent]]",
      type: "[[project]]",
      status: "wip",
      scheduled: "2026-07-16",
    },
  );
  assert.deepEqual(
    helpers.applyProjectCreationFrontmatter({}, "[[Parent]]"),
    { parent: "[[Parent]]", type: "[[project]]", status: "wip" },
  );
});

test("future schedule labels use local date-only boundaries", () => {
  const now = new Date(2026, 6, 10, 23, 45);
  assert.equal(helpers.isFutureInlineScheduledValue("2026-07-09", now), false);
  assert.equal(helpers.isFutureInlineScheduledValue("2026-07-10", now), false);
  assert.equal(helpers.isFutureInlineScheduledValue("2026-07-11", now), true);
  assert.equal(helpers.isFutureInlineScheduledValue("2026-02-30", now), false);
  assert.deepEqual(
    helpers.getFutureProjectSchedule("2026-07-11", now),
    { scheduled: true, date: "2026-07-11", label: "Tomorrow" },
  );
  assert.equal(
    helpers.getFutureProjectSchedule("2026-07-16", now).label,
    "Jul 16",
  );
  assert.equal(
    helpers.getFutureProjectSchedule("2027-07-16", now).label,
    "Jul 16, 2027",
  );
  for (const value of ["2026-07-10", "2026-07-09", "2026-02-30"]) {
    assert.equal(helpers.getFutureProjectSchedule(value, now).scheduled, false);
  }
});

test("scheduled recovery selects current and newest earlier daily across gaps", () => {
  const files = [
    { path: "2025/20251231.md", content: "" },
    { path: "2026/20260103.md", content: "" },
    { path: "2026/20260108.md", content: "" },
    { path: "2026/20260109.md", content: "" },
    { path: "Other/20260109.md", content: "" },
  ];
  assert.deepEqual(
    helpers.scheduledRecoveryDailyPaths(
      files,
      new Date(2026, 0, 9, 23, 59),
    ),
    {
      current: "2026/20260109.md",
      previous: "2026/20260108.md",
    },
  );
  assert.deepEqual(
    helpers.scheduledRecoveryDailyPaths(
      files,
      new Date(2026, 0, 1, 0, 1),
    ),
    {
      current: null,
      previous: "2025/20251231.md",
    },
  );
});

test("scheduled recovery ranks Blocked tasks from both ledgers and transclusion graph", () => {
  const settings = helpers.parseTasksStatusRegistry(
    compatibleTasksSettings(),
  );
  const files = [
    {
      path: "2026/20260716.md",
      content: [
        "## Pomodoros",
        "",
        "- [ ] Current (0900-0930)",
        "  - [[Tasks#^direct|alias]]",
        "  - ![[Tasks#^root]]",
        "  - [[Tasks#^working]]",
        "  - ~~[[Tasks#^retired]]~~",
        "- [-] Canceled (1000-1030)",
        "  - [[Tasks#^canceled]]",
        "```md",
        "- [ ] Example (1100-1130)",
        "  - [[Tasks#^fenced]]",
        "```",
      ].join("\n"),
    },
    {
      path: "2026/20260710.md",
      content: [
        "## Pomodoros",
        "",
        "- [x] Completed (0800-0830)",
        "  - ![[Tasks#^previous]]",
      ].join("\n"),
    },
    {
      path: "Tasks.md",
      content: [
        "- [?] #task Ready without activity ^ready",
        "- [?] #task Direct current ^direct",
        "- [?] #task Direct previous ^previous",
        "- [?] #task Root ^root",
        "  - ![[#^working]]",
        "- [/] #task Working [dependsOn:: Tasks__graph] ^working",
        "  - ⛓️ **DEPENDS ON:** [[#^graph]]",
        "- [?] #task Graph-derived ^graph",
        "- [?] #task Retired ^retired",
        "- [?] #task Canceled ^canceled",
        "- [?] #task Fenced ^fenced",
        "- [ ] #task Open dependency [id:: open] ^open",
        "- [?] #task Still blocked [dependsOn:: open] ^blocked",
        "- [?] #task Missing dependency [dependsOn:: missing] ^missing",
        "- [?] #task No block ID",
        "- [ ] #task Ordinary previous ^ordinary",
        "- [?] #task Reading ^reader",
        "  - ![[ref/chat/example#^ref]]",
      ].join("\n"),
    },
  ];
  const index = helpers.buildScheduledRecoveryIndex(
    files,
    settings,
    new Date(2026, 6, 16, 12),
  );
  const decision = (line) =>
    helpers.getScheduledRecoveryMetadata(index, "Tasks.md", line);

  assert.equal(decision(0).state, "ready");
  assert.equal(decision(1).state, "next");
  assert.equal(decision(2).state, "next");
  assert.equal(decision(3).state, "next");
  assert.equal(decision(7).state, "in-progress");
  assert.equal(decision(8).state, "ready");
  assert.equal(decision(9).state, "ready");
  assert.equal(decision(10).state, "ready");
  assert.equal(decision(12).state, "blocked");
  assert.equal(decision(13).state, "ready");
  assert.equal(decision(14).state, "ready");
  // A `#^ref` reading embed is content, never an edge: it neither promotes
  // nor poisons the rank snapshot.
  assert.equal(decision(16).state, "ready");

  const session = helpers.discoverCountedObsidianTaskTargets(
    files[2].content,
    0,
    13,
  );
  const duePlan = helpers.planCountedBulletPropertyBatch(
    files[2].content,
    session,
    "scheduled",
    "2026-07-16",
    {
      operation: "set",
      today: new Date(2026, 6, 16, 23, 59),
      recoveryByLine: new Map(
        session.targets.map((target) => [
          target.line,
          decision(target.line),
        ]),
      ),
    },
  );
  const statuses = duePlan.content
    .split("\n")
    .filter((line) => helpers.isObsidianTaskLine(line))
    .map((line) => helpers.getObsidianTaskCheckboxStatus(line));
  assert.deepEqual(
    statuses.slice(0, 14),
    [" ", "*", "*", "*", "/", "/", " ", " ", " ", " ", "?", " ", " ", " "],
  );
  assert.equal(duePlan.recoveredReadyTaskCount, 6);
  assert.equal(duePlan.recoveredNextTaskCount, 3);
  assert.equal(duePlan.recoveredInProgressTaskCount, 1);
  assert.equal(duePlan.stillBlockedTaskCount, 1);
  assert.equal(statuses[13], " ");
  assert.equal(statuses.at(-1), "?");
});

test("scheduled recovery defers incompatible status settings and ambiguous identities", () => {
  const incompatible = helpers.parseTasksStatusRegistry({
    statusSettings: { coreStatuses: [], customStatuses: [] },
  });
  const files = [
    {
      path: "Tasks.md",
      content: [
        "- [?] #task Blocked ^duplicate",
        "- [?] #task Duplicate ^duplicate",
      ].join("\n"),
    },
  ];
  const unavailable = helpers.buildScheduledRecoveryIndex(
    files,
    incompatible,
    new Date(2026, 6, 16),
  );
  assert.equal(
    helpers.getScheduledRecoveryMetadata(unavailable, "Tasks.md", 0).state,
    "deferred",
  );

  const compatible = helpers.buildScheduledRecoveryIndex(
    files,
    helpers.parseTasksStatusRegistry(compatibleTasksSettings()),
    new Date(2026, 6, 16),
  );
  assert.equal(
    helpers.getScheduledRecoveryMetadata(compatible, "Tasks.md", 0).state,
    "deferred",
  );
});

test("scheduled recovery honors custom open and closed Tasks status types", () => {
  const settings = compatibleTasksSettings();
  settings.statusSettings.customStatuses.push(
    {
      symbol: "w",
      name: "Waiting",
      nextStatusSymbol: " ",
      availableAsCommand: true,
      type: "TODO",
    },
    {
      symbol: "d",
      name: "Custom done",
      nextStatusSymbol: " ",
      availableAsCommand: true,
      type: "DONE",
    },
  );
  const files = [
    {
      path: "Tasks.md",
      content: [
        "- [w] #task Custom open [id:: open] ^open",
        "- [d] #task Custom closed [id:: closed] ^closed",
        "- [?] #task Open parent [dependsOn:: open] ^open-parent",
        "- [?] #task Closed parent [dependsOn:: closed] ^closed-parent",
      ].join("\n"),
    },
  ];
  const index = helpers.buildScheduledRecoveryIndex(
    files,
    helpers.parseTasksStatusRegistry(settings),
    new Date(2026, 6, 16),
  );
  assert.equal(
    helpers.getScheduledRecoveryMetadata(index, "Tasks.md", 2).state,
    "blocked",
  );
  assert.equal(
    helpers.getScheduledRecoveryMetadata(index, "Tasks.md", 3).state,
    "ready",
  );
});

test("scheduled recovery honors the configured Tasks global filter", () => {
  const settings = compatibleTasksSettings();
  settings.globalFilter = "#todo";
  const files = [
    {
      path: "Tasks.md",
      content: [
        "- [?] #todo Configured task ^configured",
        "- [?] #task Not selected by Tasks ^other",
      ].join("\n"),
    },
  ];
  const index = helpers.buildScheduledRecoveryIndex(
    files,
    helpers.parseTasksStatusRegistry(settings),
    new Date(2026, 6, 16),
  );
  const configured = helpers.getScheduledRecoveryMetadata(
    index,
    "Tasks.md",
    0,
  );
  assert.equal(configured.state, "ready");
  assert.match(
    helpers.reconcileBlockedScheduledTaskLine(
      files[0].content.split("\n")[0],
      configured,
    ).line,
    /- \[ \] #todo/,
  );
  assert.equal(
    helpers.getScheduledRecoveryMetadata(index, "Tasks.md", 1).state,
    "deferred",
  );
});

test("picker metadata exposes future schedules to badges, search, and summary", () => {
  const now = new Date(2026, 6, 10, 12);
  const future = helpers.getChildNoteInfo(
    { type: "[[project]]", status: "wip", scheduled: "2026-07-11" },
    now,
  );
  const due = helpers.getChildNoteInfo(
    { type: "[[project]]", status: "done", scheduled: "2026-07-10" },
    now,
  );
  assert.equal(future.scheduled, true);
  assert.equal(due.scheduled, false);

  const file = { path: "Projects/Future.md", basename: "Future" };
  const search = helpers.getChildNoteSearchText(file, future);
  assert.match(search, /scheduled/);
  assert.match(search, /2026-07-11/);
  assert.match(search, /tomorrow/);

  const summary = helpers.getChildNoteSummary(
    [file, { path: "Projects/Due.md", basename: "Due" }],
    new Map([
      [file.path, future],
      ["Projects/Due.md", due],
    ]),
  );
  assert.ok(summary.includes("1 future-scheduled"));
});

test("project lifecycle task classification requires unfenced #task with trailing ^prj", () => {
  for (const line of [
    "- [ ] #task Legacy project ^prj",
    "- [/] #task #prj Current project #hide ^prj",
    "> 1. [x] #task Quoted ordered project ^prj",
  ]) {
    assert.equal(helpers.isProjectLifecycleTaskLine(line), true, line);
  }
  for (const line of [
    "- [ ] Ordinary task ^prj",
    "- Project-shaped prose #task ^prj",
    "- [ ] #task Non-trailing ^prj notes",
    "- [ ] #task Other anchor ^project",
    "- [ ] #taskish Wrong tag ^prj",
  ]) {
    assert.equal(helpers.isProjectLifecycleTaskLine(line), false, line);
  }

  const content = [
    "---",
    "type: \"[[project]]\"",
    "- [ ] #task YAML example ^prj",
    "---",
    "```md",
    "- [ ] #task Fenced example ^prj",
    "```",
    "- [ ] #task Real project ^prj",
  ].join("\n");
  assert.equal(helpers.isProjectLifecycleTaskAtLine(content, 2), false);
  assert.equal(helpers.isProjectLifecycleTaskAtLine(content, 5), false);
  assert.equal(helpers.isProjectLifecycleTaskAtLine(content, 7), true);
});

test("valid Obsidian tasks require a standalone #task checkbox in real note content", () => {
  for (const line of [
    "- [ ] #task Open",
    "1. [x] Done #task",
    "> - [/] #task Active",
    "- [?] Custom #task.",
  ]) {
    assert.equal(helpers.isObsidianTaskLine(line), true, line);
  }
  for (const line of [
    "- [ ] (**1535-1705** [t:: 90m])",
    "- [ ] Plain checkbox",
    "- [ ] #taskish Wrong tag",
    "- Plain #task bullet",
  ]) {
    assert.equal(helpers.isObsidianTaskLine(line), false, line);
  }

  const content = [
    "---",
    "example: - [ ] #task YAML",
    "---",
    "```md",
    "- [ ] #task Fenced",
    "```",
    "- [x] #task Real",
  ].join("\n");
  assert.equal(helpers.isObsidianTaskAtLine(content, 1), false);
  assert.equal(helpers.isObsidianTaskAtLine(content, 4), false);
  assert.equal(helpers.isObsidianTaskAtLine(content, 6), true);
});
