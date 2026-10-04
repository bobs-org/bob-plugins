const test = require("node:test");
const assert = require("node:assert/strict");
const {
  helpers,
  TestEditor,
  createPriorityPickerConfig,
} = require("./navigation-hotkeys-harness.cjs");

test("priority bullet property config normalizes frozen levels and preserves existing shapes", () => {
  const config = helpers.validateBulletPropertyConfig({
    properties: [
      { name: "scheduled", values: "date" },
      { name: "dependsOn", values: "local_task_id" },
      { name: "status", values: ["next", 2, false] },
      {
        name: "priority",
        values: "priority",
        levels: [
          { label: " P1 ", value: " high ", min_days: 2, max_days: 7 },
          { label: "P2", value: "medium", min_days: 8, max_days: 30 },
        ],
      },
    ],
  });

  assert.ok(config);
  assert.deepEqual(config.properties.slice(0, 3), [
    { name: "scheduled", values: "date" },
    { name: "dependsOn", values: "local_task_id" },
    { name: "status", values: ["next", "2", "false"] },
  ]);
  const priority = config.properties[3];
  assert.deepEqual(
    {
      name: priority.name,
      values: priority.values,
      schedules: priority.schedules,
      levels: priority.levels,
      levelsByValue: priority.levelsByValue,
      decay: priority.decay,
    },
    {
      name: "priority",
      values: "priority",
      schedules: "scheduled",
      levels: [
        { label: "P1", value: "high", minDays: 2, maxDays: 7, rolls: null },
        { label: "P2", value: "medium", minDays: 8, maxDays: 30, rolls: null },
      ],
      levelsByValue: new Map([
        [
          "high",
          { label: "P1", value: "high", minDays: 2, maxDays: 7, rolls: null },
        ],
        [
          "medium",
          { label: "P2", value: "medium", minDays: 8, maxDays: 30, rolls: null },
        ],
      ]),
      decay: { enabled: true, rolls: 1 },
    },
  );
  assert.equal(priority.levelsByValue.get("high"), priority.levels[0]);
  assert.equal(Object.isFrozen(config), true);
  assert.equal(Object.isFrozen(config.properties), true);
  assert.equal(Object.isFrozen(config.properties[2]), true);
  assert.equal(Object.isFrozen(config.properties[2].values), true);
  assert.equal(Object.isFrozen(priority), true);
  assert.equal(Object.isFrozen(priority.levels), true);
  assert.equal(Object.isFrozen(priority.levels[0]), true);
  assert.equal(Object.isFrozen(priority.levelsByValue), true);
  assert.equal(Object.isFrozen(priority.decay), true);
});

test("priority bullet property config rejects each invalid schema category once", () => {
  const validLevel = {
    label: "P1",
    value: "high",
    min_days: 2,
    max_days: 7,
  };
  const priorityEntry = (overrides = {}) => ({
    name: "priority",
    values: "priority",
    levels: [validLevel],
    ...overrides,
  });
  const withScheduled = (entry) => ({
    properties: [{ name: "scheduled", values: "date" }, entry],
  });
  const cases = [
    {
      name: "priority levels must be a non-empty list",
      config: withScheduled(priorityEntry({ levels: [] })),
      message: /levels must be a non-empty list/,
    },
    {
      name: "levels are forbidden for other value kinds",
      config: withScheduled({
        name: "priority",
        values: ["high"],
        levels: [validLevel],
      }),
      message: /only valid when values is "priority"/,
    },
    {
      name: "labels must be non-empty strings",
      config: withScheduled(
        priorityEntry({ levels: [{ ...validLevel, label: " " }] }),
      ),
      message: /level #1.*non-empty string label/,
    },
    {
      name: "labels must be unique",
      config: withScheduled(
        priorityEntry({
          levels: [validLevel, { ...validLevel, value: "medium" }],
        }),
      ),
      message: /level #2.*label.*duplicated/,
    },
    {
      name: "values must be scalars",
      config: withScheduled(
        priorityEntry({ levels: [{ ...validLevel, value: {} }] }),
      ),
      message: /level #1.*non-empty scalar value/,
    },
    {
      name: "values must be unique",
      config: withScheduled(
        priorityEntry({
          levels: [validLevel, { ...validLevel, label: "P2" }],
        }),
      ),
      message: /level #2.*value.*duplicated/,
    },
    {
      name: "values cannot contain inline-field delimiters",
      config: withScheduled(
        priorityEntry({ levels: [{ ...validLevel, value: "[high]" }] }),
      ),
      message: /level #1.*value cannot contain/,
    },
    {
      name: "values cannot contain newlines",
      config: withScheduled(
        priorityEntry({ levels: [{ ...validLevel, value: "high\n" }] }),
      ),
      message: /level #1.*value cannot contain/,
    },
    {
      name: "day bounds must be integers",
      config: withScheduled(
        priorityEntry({ levels: [{ ...validLevel, min_days: 2.5 }] }),
      ),
      message: /level #1.*min_days.*non-negative integer/,
    },
    {
      name: "day bounds cannot be negative",
      config: withScheduled(
        priorityEntry({ levels: [{ ...validLevel, max_days: -1 }] }),
      ),
      message: /level #1.*max_days.*non-negative integer/,
    },
    {
      name: "day ranges cannot be inverted",
      config: withScheduled(
        priorityEntry({
          levels: [{ ...validLevel, min_days: 8, max_days: 7 }],
        }),
      ),
      message: /level #1.*min_days cannot exceed max_days/,
    },
    {
      name: "schedules must target another date property",
      config: withScheduled(priorityEntry({ schedules: "dependsOn" })),
      message: /schedules must name another date property in the same config/,
    },
    {
      name: "duplicate property names remain invalid",
      config: {
        properties: [
          { name: "priority", values: ["high"] },
          { name: "priority", values: ["low"] },
        ],
      },
      message: /Duplicate bullet property name "priority"/,
    },
  ];

  for (const testCase of cases) {
    const messages = [];
    const result = helpers.validateBulletPropertyConfig(testCase.config, {
      showNotice: (message) => messages.push(message),
    });
    assert.equal(result, null, testCase.name);
    assert.equal(messages.length, 1, testCase.name);
    assert.match(messages[0], /"priority"/, testCase.name);
    assert.match(messages[0], testCase.message, testCase.name);
  }
});

test("property targets use project YAML only for scheduled on ^prj", () => {
  const config = {
    properties: [
      { name: "scheduled", values: "date" },
      { name: "dependsOn", values: "local_task_id" },
    ],
  };
  const project = [
    "---",
    "type: [[project]]",
    "scheduled: 2026-07-16",
    "---",
    "- [ ] #task Ship [scheduled:: 2026-07-15] [dependsOn:: prep] ^prj",
  ].join("\n");
  const context = helpers.getProjectNotePropertyContext(project, 4);
  assert.equal(context.valid, true);
  const items = helpers.createBulletPropertyItems(
    config,
    project.split("\n")[4],
    context,
  );
  assert.deepEqual(
    items.map((item) => [item.property.name, item.target.kind, item.currentValue]),
    [
      ["scheduled", "project-frontmatter", "2026-07-16"],
      ["dependsOn", "inline", "prep"],
    ],
  );

  const ordinaryLine = "- [ ] #task Follow up [scheduled:: 2026-07-15]";
  const ordinary = helpers.createBulletPropertyItems(config, ordinaryLine, {});
  assert.equal(ordinary[0].target.kind, "inline");
  assert.equal(ordinary[0].currentValue, "2026-07-15");

  const unscheduledProject = project.replace("scheduled: 2026-07-16\n", "");
  const unscheduledContext = helpers.getProjectNotePropertyContext(
    unscheduledProject,
    3,
  );
  assert.equal(unscheduledContext.valid, true);
  const unscheduledItems = helpers.createBulletPropertyItems(
    config,
    unscheduledProject.split("\n")[3],
    unscheduledContext,
  );
  const unscheduledItem = unscheduledItems.find(
    (item) => item.property.name === "scheduled",
  );
  assert.equal(unscheduledItem.target.kind, "project-frontmatter");
  assert.equal(unscheduledItem.defined, false);
  assert.equal(unscheduledItem.currentValue, "");

  const malformed = project.replace("2026-07-16", "2026-02-30");
  const malformedContext = helpers.getProjectNotePropertyContext(malformed, 4);
  assert.equal(malformedContext.valid, false);
  assert.match(malformedContext.error, /valid calendar date/);
});

test("local task properties are addable only on valid tasks but invalid metadata stays removable", () => {
  const config = {
    properties: [
      { name: "dependsOn", values: "local_task_id" },
      { name: "priority", values: ["high"] },
    ],
  };
  assert.deepEqual(
    helpers
      .createBulletPropertyItems(config, "- [ ] #task Parent", {})
      .map((item) => item.property.name),
    ["dependsOn", "priority"],
  );
  assert.deepEqual(
    helpers
      .createBulletPropertyItems(config, "- [ ] (**1535-1705** [t:: 90m])", {})
      .map((item) => item.property.name),
    ["priority"],
  );
  const historical = helpers.createBulletPropertyItems(
    config,
    "- [ ] Plain [dependsOn:: old]",
    {},
  );
  assert.equal(historical[0].property.name, "dependsOn");
  assert.equal(historical[0].defined, true);
  assert.equal(historical[0].dependencyEligible, false);
});

test("dependency parent write validation rejects stale, Pomodoro, and fenced parents", () => {
  const valid = new TestEditor("- [ ] #task Parent");
  assert.equal(
    helpers.validateDependencyParentForEditor(
      valid,
      { line: 0, ch: 0 },
      "- [ ] #task Parent",
    ).valid,
    true,
  );
  valid.content = "- [ ] #task Changed";
  assert.equal(
    helpers.validateDependencyParentForEditor(
      valid,
      { line: 0, ch: 0 },
      "- [ ] #task Parent",
    ).valid,
    false,
  );
  for (const content of [
    "- [ ] (**1535-1705** [t:: 90m])",
    "```md\n- [ ] #task Example\n```",
  ]) {
    const editor = new TestEditor(content);
    const line = content.startsWith("```") ? 1 : 0;
    assert.equal(
      helpers.validateDependencyParentForEditor(editor, { line, ch: 0 }).valid,
      false,
    );
  }
});

test("counted property targets mean current plus N real tasks without wrapping", () => {
  const content = [
    "---",
    "example: - [ ] #task YAML",
    "---",
    "- [ ] #task Read SASE beads ^read-sase-beads",
    "\t- ![[#^transcluded-child]]",
    "prose between tasks",
    "- ordinary bullet",
    "- [ ] (**0900-0930** [t:: 30m])",
    "  - [/] #task Fix just ^fix-fix-just",
    "```md",
    "- [*] #task Fenced example",
    "```",
    "> - [x] #task Fix GitHub actions ^fix-gh-act-and-pub",
    "1. [-] #task Canceled custom status",
    "- [?] #task Arbitrary custom status",
  ].join("\r\n");

  const firstThree = helpers.discoverCountedObsidianTaskTargets(content, 3, 2);
  assert.equal(firstThree.valid, true);
  assert.equal(firstThree.requestedCount, 3);
  assert.equal(firstThree.actualCount, 3);
  assert.equal(firstThree.clamped, false);
  assert.deepEqual(
    firstThree.targets.map((target) => target.line),
    [3, 8, 12],
  );
  assert.deepEqual(
    firstThree.targets.map((target) => target.rawLine.match(/\^([\w-]+)/)?.[1]),
    ["read-sase-beads", "fix-fix-just", "fix-gh-act-and-pub"],
  );

  const allStatuses = helpers.discoverCountedObsidianTaskTargets(content, 3, 9);
  assert.deepEqual(
    allStatuses.targets.map((target) =>
      helpers.getObsidianTaskCheckboxStatus(target.rawLine),
    ),
    [" ", "/", "x", "-", "?"],
  );
  assert.equal(allStatuses.actualCount, 5);
  assert.equal(allStatuses.requestedCount, 10);
  assert.equal(allStatuses.clamped, true);
  assert.equal(allStatuses.targets.some((target) => target.line < 3), false);

  const invalid = helpers.discoverCountedObsidianTaskTargets(content, 6, 2);
  assert.equal(invalid.valid, false);
  assert.match(invalid.error, /start on a #task checkbox/);
});

test("counted property metadata distinguishes absent, common, and mixed values", () => {
  const content = [
    "- [ ] #task One [p:: high] [scheduled:: 2026-07-23]",
    "- [/] #task Two [p:: high]",
    "- [x] #task Three [p:: high] [scheduled:: 2026-07-24]",
  ].join("\n");
  const session = helpers.discoverCountedObsidianTaskTargets(content, 0, 2);
  const aggregate = helpers.createCountedBulletPropertyItems(
    {
      properties: [
        { name: "p", values: ["high", "low"] },
        { name: "scheduled", values: "date" },
        { name: "created", values: "date" },
      ],
    },
    content,
    session,
  );
  assert.equal(aggregate.valid, true);
  const byName = new Map(
    aggregate.items.map((item) => [item.property.name, item]),
  );
  assert.equal(byName.get("p").valueState, "common");
  assert.equal(byName.get("p").currentValue, "high");
  assert.equal(byName.get("scheduled").valueState, "mixed");
  assert.equal(byName.get("scheduled").defined, true);
  assert.equal(byName.get("scheduled").currentValue, "");
  assert.equal(byName.get("created").valueState, "absent");
  assert.equal(byName.get("created").defined, false);
});

test("counted priority metadata reports labels for common and mixed values", () => {
  const config = createPriorityPickerConfig();
  const commonContent = [
    "- [ ] #task One [priority:: high] ^one",
    "- [ ] #task Two [priority:: high] ^two",
  ].join("\n");
  const commonSession = helpers.discoverCountedObsidianTaskTargets(
    commonContent,
    0,
    1,
  );
  const common = helpers.createCountedBulletPropertyItems(
    config,
    commonContent,
    commonSession,
  );
  const commonPriority = common.items.find(
    (item) => item.property.name === "priority",
  );
  assert.equal(commonPriority.valueState, "common");
  assert.equal(commonPriority.currentValue, "high");
  assert.equal(commonPriority.currentLabel, "P1");

  const mixedContent = commonContent.replace(
    "Two [priority:: high]",
    "Two [priority:: low]",
  );
  const mixedSession = helpers.discoverCountedObsidianTaskTargets(
    mixedContent,
    0,
    1,
  );
  const mixed = helpers.createCountedBulletPropertyItems(
    config,
    mixedContent,
    mixedSession,
  );
  const mixedPriority = mixed.items.find(
    (item) => item.property.name === "priority",
  );
  assert.equal(mixedPriority.valueState, "mixed");
  assert.deepEqual(mixedPriority.currentLabels, ["P1", "P3"]);
});

test("counted scheduled planning updates the motivating three tasks atomically", () => {
  const input = [
    "- [ ] #task Read SASE beads [created:: 2026-07-01] ^read-sase-beads",
    "\t- ![[#^transcluded-child]]",
    "intervening prose",
    "- [/] #task Fix just [scheduled:: 2026-07-20] [created:: 2026-07-02] ^fix-fix-just",
    "- ordinary bullet [scheduled:: keep]",
    "> - [x] #task Fix GitHub actions [scheduled:: 2026-07-23] ^fix-gh-act-and-pub",
  ].join("\r\n");
  const session = helpers.discoverCountedObsidianTaskTargets(input, 0, 2);
  const plan = helpers.planCountedBulletPropertyBatch(
    input,
    session,
    "scheduled",
    "2026-07-23",
    { operation: "set", today: new Date(2026, 6, 16, 12) },
  );
  assert.equal(plan.valid, true);
  assert.equal(plan.changedTaskCount, 2);
  assert.equal(plan.unchangedTaskCount, 1);
  assert.equal(plan.blockedTaskCount, 2);
  assert.equal(plan.content.includes("\r\n"), true);
  assert.match(
    plan.content,
    /\[\?\] #task Read SASE beads \[created:: 2026-07-01\] \[scheduled:: 2026-07-23\] \^read-sase-beads/,
  );
  assert.match(
    plan.content,
    /\[\?\] #task Fix just \[scheduled:: 2026-07-23\] \[created:: 2026-07-02\] \^fix-fix-just/,
  );
  assert.match(plan.content, /\t- !\[\[#\^transcluded-child\]\]/);
  assert.match(plan.content, /ordinary bullet \[scheduled:: keep\]/);
  assert.equal(
    (plan.content.match(/\[scheduled:: 2026-07-23\]/g) || []).length,
    3,
  );

  const deleteSession = helpers.discoverCountedObsidianTaskTargets(
    plan.content,
    0,
    2,
  );
  const deleted = helpers.planCountedBulletPropertyBatch(
    plan.content,
    deleteSession,
    "scheduled",
    null,
    { operation: "delete" },
  );
  assert.equal(deleted.valid, true);
  assert.equal(deleted.changedTaskCount, 3);
  assert.equal(deleted.blockedTaskCount, 0);
  assert.doesNotMatch(deleted.content, /#task[^\r\n]*\[scheduled::/);
  assert.match(deleted.content, /- \[\?\] #task Read SASE beads/);
  assert.match(deleted.content, /- \[\?\] #task Fix just/);
  assert.match(deleted.content, /ordinary bullet \[scheduled:: keep\]/);
  assert.match(deleted.content, /\[created:: 2026-07-01\].*\^read-sase-beads/);
});
