const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const notices = [];

const originalLoad = Module._load;
function parseTestYaml(text) {
  const result = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#") || /^\s/.test(line)) {
      continue;
    }
    const match = /^([^:]+):(.*)$/.exec(line);
    if (!match) {
      throw new Error("malformed yaml");
    }
    const key = match[1].trim();
    let value = match[2].trim().replace(/\s+#.*$/, "");
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value || null;
  }
  return result;
}

Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    class EmptyClass {}
    class TestNotice {
      constructor(message) {
        notices.push(String(message));
      }
    }
    return {
      MarkdownView: EmptyClass,
      Modal: EmptyClass,
      Notice: TestNotice,
      Plugin: EmptyClass,
      parseYaml: parseTestYaml,
    };
  }
  if (request === "@codemirror/view") {
    return { EditorView: class EditorView {} };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const NavigationHotkeysPlugin = require("../plugins/bob-navigation-hotkeys/main.js");
const { helpers } = NavigationHotkeysPlugin;
Module._load = originalLoad;

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

class TestEditor {
  constructor(content) {
    this.content = content;
  }
  getValue() {
    return this.content;
  }
  getLine(line) {
    return this.content.split(/\r?\n/)[line] ?? null;
  }
  replaceRange(text, from, to = from) {
    const offset = (position) => {
      const newline = this.content.includes("\r\n") ? "\r\n" : "\n";
      const lines = this.content.split(/\r?\n/);
      return (
        lines
          .slice(0, position.line)
          .reduce((sum, line) => sum + line.length + newline.length, 0) +
        position.ch
      );
    };
    const start = offset(from);
    const end = offset(to);
    this.content = this.content.slice(0, start) + text + this.content.slice(end);
  }
}

class TransactionEditor extends TestEditor {
  constructor(content, cursor, scrollTop = 640) {
    super(content);
    this.cursor = { ...cursor };
    this.scrollTop = scrollTop;
    this.transactions = [];
    this.transactionScrollTops = [];
    this.setCursorCalls = [];
    this.undoGroups = 0;
  }
  getCursor() {
    return { ...this.cursor };
  }
  getScrollInfo() {
    return { left: 0, top: this.scrollTop };
  }
  setCursor(lineOrPosition, ch) {
    const position =
      typeof lineOrPosition === "object"
        ? lineOrPosition
        : { line: lineOrPosition, ch };
    this.cursor = { ...position };
    this.setCursorCalls.push({ ...position });
  }
  transaction(transaction) {
    this.transactionScrollTops.push(this.scrollTop);
    this.transactions.push(JSON.parse(JSON.stringify(transaction)));
    if (transaction.changes && transaction.changes.length > 0) {
      this.undoGroups += 1;
    }
    const changes = [...(transaction.changes || [])].sort(
      (left, right) =>
        right.from.line - left.from.line || right.from.ch - left.from.ch,
    );
    for (const change of changes) {
      super.replaceRange(change.text, change.from, change.to || change.from);
    }
    if (transaction.selection) {
      this.cursor = {
        ...(transaction.selection.to || transaction.selection.from),
      };
    }
  }
}

class RecordingFallbackEditor extends TestEditor {
  constructor(content, cursor) {
    super(content);
    this.cursor = { ...cursor };
    this.events = [];
    this.replaceCalls = [];
    this.setCursorCalls = [];
  }
  getCursor() {
    return { ...this.cursor };
  }
  replaceRange(text, from, to = from) {
    this.events.push(`replace:${from.line}`);
    this.replaceCalls.push({
      text,
      from: { ...from },
      to: { ...to },
    });
    super.replaceRange(text, from, to);
  }
  setCursor(lineOrPosition, ch) {
    const position =
      typeof lineOrPosition === "object"
        ? lineOrPosition
        : { line: lineOrPosition, ch };
    this.events.push("cursor");
    this.cursor = { ...position };
    this.setCursorCalls.push({ ...position });
  }
}

function assertLineBoundedTransaction(transaction, originalLines, changedLines) {
  assert.deepEqual(
    transaction.changes.map((change) => change.from.line),
    changedLines,
  );
  for (const change of transaction.changes) {
    assert.deepEqual(change.from, { line: change.from.line, ch: 0 });
    assert.deepEqual(change.to, {
      line: change.from.line,
      ch: originalLines[change.from.line].length,
    });
    assert.doesNotMatch(change.text, /[\r\n]/);
  }
}

test("section-header navigation moves normally and cycles at boundaries", () => {
  const lines = [
    "---",
    "# Frontmatter pseudo-heading",
    "---",
    "# First",
    "Introduction",
    "```md",
    "## Fenced pseudo-heading",
    "```",
    "## Middle",
    "Details",
    "### Last",
  ];

  assert.deepEqual(helpers.getSectionHeaderLines(lines), [3, 8, 10]);
  assert.equal(helpers.getSectionHeaderJumpLine(lines, 4, 1), 8);
  assert.equal(helpers.getSectionHeaderJumpLine(lines, 9, -1), 8);

  assert.deepEqual(
    [3, 8, 10].map((line) =>
      helpers.getSectionHeaderJumpLine(lines, line, 1),
    ),
    [8, 10, 3],
  );
  assert.deepEqual(
    [10, 8, 3].map((line) =>
      helpers.getSectionHeaderJumpLine(lines, line, -1),
    ),
    [8, 3, 10],
  );
});

test("section-header navigation wraps from beyond document boundaries", () => {
  const lines = ["# First", "Body", "## Last"];

  assert.equal(helpers.getSectionHeaderJumpLine(lines, 99, 1), 0);
  assert.equal(helpers.getSectionHeaderJumpLine(lines, -1, -1), 2);
});

test("section-header navigation handles single-header and no-header notes", () => {
  const singleHeaderLines = [
    "---",
    "# Frontmatter pseudo-heading",
    "---",
    "```md",
    "## Fenced pseudo-heading",
    "```",
    "# Only header",
  ];

  for (const direction of [-1, 1]) {
    assert.equal(
      helpers.getSectionHeaderJumpLine(singleHeaderLines, 6, direction),
      6,
    );
  }

  const noHeaderLines = [
    "---",
    "# Frontmatter pseudo-heading",
    "---",
    "```md",
    "## Fenced pseudo-heading",
    "```",
    "Body",
  ];
  assert.deepEqual(helpers.getSectionHeaderLines(noHeaderLines), []);
  assert.equal(helpers.getSectionHeaderJumpLine(noHeaderLines, 0, 1), null);
  assert.equal(helpers.getSectionHeaderJumpLine(noHeaderLines, 6, -1), null);
});

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
  assert.equal(plan.content.includes("\r\n"), true);
  assert.match(
    plan.content,
    /Read SASE beads \[created:: 2026-07-01\] \[scheduled:: 2026-07-23\] \^read-sase-beads/,
  );
  assert.match(
    plan.content,
    /Fix just \[scheduled:: 2026-07-23\] \[created:: 2026-07-02\] \^fix-fix-just/,
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
  assert.doesNotMatch(deleted.content, /#task[^\r\n]*\[scheduled::/);
  assert.match(deleted.content, /ordinary bullet \[scheduled:: keep\]/);
  assert.match(deleted.content, /\[created:: 2026-07-01\].*\^read-sase-beads/);
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
    "p",
    "high",
  );
  assert.equal(plan.valid, false);
  assert.equal(plan.stale, true);
  assert.equal(plan.content, changed);
  assert.doesNotMatch(plan.content, /\[p::/);
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
    /Follow up \[created:: 2026-07-02\] #hide \[scheduled:: 2026-07-23\] \^follow-up/,
  );
  assert.match(plan.content, /Ship \[created:: 2026-07-01\] #hide \^prj/);
});

test("project schedule update coordinates YAML, inline cleanup, and visibility", () => {
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
      "- [/] #task Work #hide ^work",
    ].join("\n"),
  );

  const deleted = helpers.planProjectScheduledDelete(result.content, 5);
  assert.equal(deleted.valid, true);
  assert.equal(deleted.cursorLine, 4);
  assert.doesNotMatch(deleted.content, /^scheduled:/m);
  assert.match(deleted.content, /Ship \[p:: 1\] #hide \^prj/);
  assert.match(deleted.content, /Work #hide \^work/);
});

test("future schedule normalizes every real Markdown task to one #hide", () => {
  const input = [
    "---",
    "type: [[project]]",
    "---",
    "- [ ] #task Ship [p:: 1] ^prj",
    "  - [/] #task Nested ^nested",
    "1. [x] Completed #hide",
    "> - [-] Canceled #hidden",
    "- [*] #task Next #hide #hide   ",
    "```md",
    "- [ ] fenced example",
    "```",
    "This mentions - [ ] checkbox prose",
  ].join("\r\n");
  const result = helpers.planProjectScheduleVisibility(
    input,
    "2026-07-12",
    new Date(2026, 6, 11, 23, 59),
  );
  assert.equal(result.valid, true);
  assert.equal(result.taskCount, 5);
  assert.equal(result.content.includes("\r\n"), true);
  assert.match(result.content, /\[p:: 1\] #hide \^prj/);
  assert.match(result.content, /Nested #hide \^nested/);
  assert.match(result.content, /Completed #hide/);
  assert.match(result.content, /Canceled #hidden #hide/);
  assert.match(result.content, /Next #hide   \r\n/);
  assert.match(result.content, /```md\r\n- \[ \] fenced example\r\n```/);
  assert.match(result.content, /This mentions - \[ \] checkbox prose/);
  for (const task of helpers.getRealMarkdownTaskLines(result.content)) {
    assert.equal(
      helpers.getWholeTaskTagSpans(task.text, "#hide").length,
      1,
      task.text,
    );
  }
  assert.equal(
    helpers.planProjectScheduleVisibility(
      result.content,
      "2026-07-12",
      new Date(2026, 6, 11),
    ).changed,
    false,
  );
});

test("today and past schedules show ordinary tasks and honor the ^prj exception", () => {
  const multiple = [
    "---",
    "type: [[project]]",
    "---",
    "- [ ] #task Ship #hide #hide ^prj",
    "- [x] Done #hidden #hide",
    "- [-] Canceled #hide",
  ].join("\n");
  for (const date of ["2026-07-11", "2026-07-10"]) {
    const shown = helpers.planProjectScheduleVisibility(
      multiple,
      date,
      new Date(2026, 6, 11, 0, 1),
    );
    assert.match(shown.content, /Ship #hide #hide \^prj/);
    assert.match(shown.content, /Done #hidden$/m);
    assert.match(shown.content, /Canceled$/m);
  }

  const sole = [
    "---",
    "type: [[project]]",
    "---",
    "- [ ] #task Ship #hide #hide ^prj",
  ].join("\n");
  const shownSole = helpers.planProjectScheduleVisibility(
    sole,
    "2026-07-11",
    new Date(2026, 6, 11, 23, 59),
  );
  assert.match(shownSole.content, /Ship \^prj$/);
  assert.doesNotMatch(shownSole.content, /#hide/);
});

test("schedule deletion removes stale inline fields without changing visibility", () => {
  const input = [
    "---",
    "type: [[project]]",
    "scheduled: '2026-07-16'",
    "---",
    "- [ ] #task Ship #hide [scheduled:: 2026-07-15] [p:: 2] [scheduled:: old] ^prj",
    "- [ ] #task Work #hide",
  ].join("\r\n");
  const deleted = helpers.planProjectScheduledDelete(input, 4);
  assert.equal(deleted.valid, true);
  assert.equal(
    deleted.content,
    [
      "---",
      "type: [[project]]",
      "---",
      "- [ ] #task Ship #hide [p:: 2] ^prj",
      "- [ ] #task Work #hide",
    ].join("\r\n"),
  );
});

test("dependency bullets render one canonical transclusion per target", () => {
  assert.equal(
    helpers.formatDependencyNavigationBullet(["a", "b"], "\t"),
    "\t- ![[#^a]]\n\t- ![[#^b]]",
  );
  assert.equal(
    helpers.formatDependencyNavigationBullet(
      { blockId: "remote", note: "projects/Other" },
      "  ",
    ),
    "  - ![[projects/Other#^remote]]",
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

test("dependency navigation identity includes note path and accepts aliases", () => {
  const input = [
    "- [ ] #task Parent [dependsOn:: Here__x, Other__x] ^parent",
    "  - ![[#^x|local]]",
    "  - ![[Other#^x|remote]]",
    "- [ ] #task Local [id:: Here__x] ^x",
  ].join("\n");
  const collection = helpers.collectDependencyNavigationBullets(input, 0);
  assert.deepEqual(
    collection.targets.map(({ note, blockId }) => `${note}#^${blockId}`),
    ["#^x", "Other#^x"],
  );
  const plan = helpers.planDependencyNavigationBulletSync(input, 0, [
    { blockId: "x", note: "" },
    { blockId: "x", note: "Other" },
  ]);
  assert.equal(plan.operation, "rewrite");
  assert.deepEqual(plan.lineTexts, ["  - ![[#^x]]", "  - ![[Other#^x]]"]);

  const keepRemote = helpers.planDependencyNavigationBulletSync(input, 0, [
    { blockId: "x", note: "" },
    { blockId: "x", note: "Other" },
    "new",
  ]);
  assert.deepEqual(keepRemote.lineTexts, [
    "  - ![[#^x]]",
    "  - ![[Other#^x]]",
    "  - ![[#^new]]",
  ]);
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

test("dependency sync splits legacy bullets and protects unrelated transclusions", () => {
  const input = [
    "- [ ] #task Parent [dependsOn:: a, b] ^parent",
    "  - 🔗 **DEPENDS ON:** [[#^a]] • [[#^b]]",
    "  - ![[ref/chat/example#^ref]]",
    "- [ ] #task A [id:: a] ^a",
    "- [ ] #task B [id:: b] ^b",
  ].join("\n");
  const plan = helpers.planDependencyNavigationBulletSync(input, 0, ["a", "b"]);
  assert.equal(plan.operation, "rewrite");
  assert.deepEqual(plan.lineTexts, ["  - ![[#^a]]", "  - ![[#^b]]"]);

  const canonical = [
    "- [ ] #task Parent [dependsOn:: a, b] ^parent",
    "  - ![[#^a]]",
    "  - ![[#^b]]",
    "  - ![[ref/chat/example#^ref]]",
    "- [ ] #task A [id:: a] ^a",
    "- [ ] #task B [id:: b] ^b",
  ].join("\n");
  const collection = helpers.collectDependencyNavigationBullets(canonical, 0);
  assert.deepEqual(collection.blockIds, ["a", "b"]);
  assert.deepEqual(collection.lineIndices, [1, 2]);
  assert.equal(
    helpers.planDependencyNavigationBulletSync(canonical, 0, ["a", "b"]).changed,
    false,
  );
});

test("dependency sync inserts, removes, and preserves arbitrary child bullets", () => {
  const propertyOnly = [
    "- [ ] #task Parent [dependsOn:: a]",
    "  - Keep me",
    "- [ ] #task A [id:: a] ^a",
  ].join("\n");
  const insert = helpers.planDependencyNavigationBulletSync(propertyOnly, 0, ["a"]);
  assert.equal(insert.operation, "insert");
  assert.equal(insert.insertLine, 1);
  assert.equal(insert.lineText, "  - ![[#^a]]");

  const canonical = propertyOnly.replace(
    "  - Keep me",
    "  - ![[#^a]]\n  - Keep me",
  );
  const remove = helpers.planDependencyNavigationBulletSync(
    canonical.replace("[dependsOn:: a]", "[dependsOn:: ]"),
    0,
    [],
    { managedBlockIds: ["a"] },
  );
  assert.equal(remove.operation, "delete");
  assert.deepEqual(remove.deleteLines, [1]);

  const plain = propertyOnly.replace("- [ ] #task Parent", "- Plain parent");
  assert.equal(
    helpers.planDependencyNavigationBulletSync(plain, 0, ["a"]).operation,
    "guard",
  );

  const mixedIndent = [
    "- [ ] #task Parent [dependsOn:: a]",
    "  - 🔗 **DEPENDS ON:** [[#^a]]",
    "\t- arbitrary child",
    "- [ ] #task A [id:: a] ^a",
  ].join("\n");
  const mixedPlan = helpers.planDependencyNavigationBulletSync(
    mixedIndent,
    0,
    ["a"],
  );
  assert.equal(mixedPlan.operation, "rewrite");
  assert.equal(mixedPlan.replaceLine, 1);

  const nested = [
    "- [ ] #task Parent [dependsOn:: a]",
    "  - arbitrary child",
    "    - ![[#^a]]",
    "- [ ] #task A [id:: a] ^a",
  ].join("\n");
  const nestedCollection = helpers.collectDependencyNavigationBullets(nested, 0);
  assert.deepEqual(nestedCollection.blockIds, []);
  assert.equal(
    helpers.planDependencyNavigationBulletSync(nested, 0, ["a"]).operation,
    "insert",
  );
});

test("dependency sync preserves terminal struck dependencies and protects unrelated strikes", () => {
  const input = [
    "- [ ] #task Parent [dependsOn:: a, b] ^parent",
    "  - ~~[[#^a]]~~",
    "  - ~~[[#^ref]]~~",
    "- [x] #task A [id:: a] ^a",
    "- [ ] #task B [id:: b] ^b",
  ].join("\n");
  const collection = helpers.collectDependencyNavigationBullets(input, 0);
  assert.deepEqual(collection.blockIds, ["a"]);
  assert.deepEqual(collection.lineIndices, [1]);

  const plan = helpers.planDependencyNavigationBulletSync(input, 0, ["a", "b"]);
  assert.equal(plan.operation, "rewrite");
  assert.deepEqual(plan.lineTexts, ["  - ~~[[#^a]]~~", "  - ![[#^b]]"]);

  const canonical = [
    "- [ ] #task Parent [dependsOn:: a, b] ^parent",
    "  - ~~[[#^a]]~~",
    "  - ![[#^b]]",
    "  - ~~[[#^ref]]~~",
    "- [x] #task A [id:: a] ^a",
    "- [ ] #task B [id:: b] ^b",
  ].join("\n");
  assert.equal(
    helpers.planDependencyNavigationBulletSync(canonical, 0, ["a", "b"])
      .changed,
    false,
  );

  const remove = helpers.planDependencyNavigationBulletSync(
    canonical.replace("[dependsOn:: a, b]", "[dependsOn:: ]"),
    0,
    [],
    { managedBlockIds: ["a", "b"] },
  );
  assert.equal(remove.operation, "delete");
  assert.deepEqual(remove.deleteLines, [1, 2]);
});

test("same-file dependency toggle synchronizes dependsOn and target id", () => {
  const input = [
    "- [ ] #task Parent ^parent",
    "  - [[#^child]]",
    "- [ ] #task Child ^child",
  ].join("\n");
  const added = helpers.planSameFileDependencyToggle(
    input,
    1,
    "  - ![[#^child]]",
    "projects/Here.md",
  );
  assert.equal(added.qualified, true);
  assert.match(added.content, /- \[\?\] #task Parent/);
  assert.match(added.content, /Parent \[dependsOn:: projects__Here__child\] \^parent/);
  assert.match(added.content, /Child \[id:: projects__Here__child\] \^child/);

  const removed = helpers.planSameFileDependencyToggle(
    added.content,
    1,
    "  - [[#^child]]",
    "projects/Here.md",
  );
  assert.equal(removed.qualified, true);
  assert.doesNotMatch(removed.content, /dependsOn/);
  assert.match(removed.content, /- \[\?\] #task Parent/);
  assert.match(removed.content, /Child \[id:: projects__Here__child\] \^child/);

  const unrelated = helpers.planSameFileDependencyToggle(
    input.replace("[[#^child]]", "[[#^ref]]"),
    1,
    "  - ![[#^ref]]",
  );
  assert.equal(unrelated.qualified, false);
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

test("same-file dependency toggle promotes monotonically and unlinking is status-neutral", () => {
  for (const scenario of [
    { parent: "*", target: " ", expected: "*" },
    { parent: "/", target: " ", expected: "/" },
    { parent: "/", target: "*", expected: "/" },
    { parent: "*", target: "/", expected: "/" },
    { parent: " ", target: "*", expected: "*" },
    { parent: "/", target: "x", expected: "x" },
    { parent: "/", target: "-", expected: "-" },
    { parent: "/", target: "?", expected: "?" },
  ]) {
    const input = [
      `- [${scenario.parent}] #task Parent ^parent`,
      "  - [[#^child]]",
      `- [${scenario.target}] #task Child ^child`,
    ].join("\n");
    const added = helpers.planSameFileDependencyToggle(
      input,
      1,
      "  - ![[#^child]]",
      "Here.md",
    );
    assert.equal(added.qualified, true);
    assert.ok(
      added.content.includes(`- [${scenario.expected}] #task Child`),
      added.content,
    );
    const parentStatus = [" ", "*", "/", "?"].includes(scenario.target)
      ? "?"
      : scenario.parent;
    assert.ok(
      added.content.includes(`- [${parentStatus}] #task Parent`),
      added.content,
    );
  }

  const linked = [
    "- [/] #task Parent [dependsOn:: Here__child] ^parent",
    "  - ![[#^child]]",
    "- [/] #task Child [id:: Here__child] ^child",
  ].join("\n");
  const removed = helpers.planSameFileDependencyToggle(
    linked,
    1,
    "  - [[#^child]]",
    "Here.md",
  );
  assert.equal(removed.qualified, true);
  assert.match(removed.content, /- \[\/\] #task Child/);
  assert.doesNotMatch(removed.content, /dependsOn/);
});

test("same-file dependency blocking requires open target and open parent", () => {
  for (const scenario of [
    { parent: " ", target: "x", expectedParent: " " },
    { parent: "/", target: "-", expectedParent: "/" },
    { parent: "*", target: "!", expectedParent: "*" },
    { parent: " ", target: "?", expectedParent: "?" },
    { parent: "x", target: " ", expectedParent: "x" },
  ]) {
    const input = [
      `- [${scenario.parent}] #task Parent ^parent`,
      "  - [[#^child]]",
      `- [${scenario.target}] #task Child ^child`,
    ].join("\n");
    const added = helpers.planSameFileDependencyToggle(
      input,
      1,
      "  - ![[#^child]]",
      "Here.md",
    );
    assert.equal(added.qualified, true);
    assert.match(added.content, /dependsOn:: Here__child/);
    assert.ok(
      added.content.includes(`- [${scenario.expectedParent}] #task Parent`),
      added.content,
    );
  }
});

test("same-file dependency toggle skips hidden targets using whole-tag boundaries", () => {
  const hidden = [
    "- [ ] #task Parent ^parent",
    "  - [[#^child]]",
    "- [ ] #task Child (#hide), ^child",
  ].join("\n");
  const hiddenResult = helpers.planSameFileDependencyToggle(
    hidden,
    1,
    "  - ![[#^child]]",
    "projects/Here.md",
  );
  assert.equal(hiddenResult.qualified, false);
  assert.equal(hiddenResult.reason, "target-hidden");
  assert.match(hiddenResult.content, /  - !\[\[#\^child\]\]/);
  assert.doesNotMatch(hiddenResult.content, /dependsOn|\[id::/);

  const nearMatchResult = helpers.planSameFileDependencyToggle(
    hidden.replace("(#hide),", "#hidden"),
    1,
    "  - ![[#^child]]",
    "projects/Here.md",
  );
  assert.equal(nearMatchResult.qualified, true);
  assert.match(nearMatchResult.content, /\[dependsOn:: projects__Here__child\]/);
  assert.match(nearMatchResult.content, /\[id:: projects__Here__child\]/);
});

test("same-file dependency toggle can unlink a target that became hidden", () => {
  const input = [
    "- [ ] #task Parent [dependsOn:: projects__Here__child] ^parent",
    "  - ![[#^child]]",
    "- [ ] #task Child #hide [id:: projects__Here__child] ^child",
  ].join("\n");
  const removed = helpers.planSameFileDependencyToggle(
    input,
    1,
    "  - [[#^child]]",
    "projects/Here.md",
  );
  assert.equal(removed.qualified, true);
  assert.doesNotMatch(removed.content, /dependsOn/);
  assert.match(
    removed.content,
    /Child #hide \[id:: projects__Here__child\] \^child/,
  );
});

test("same-file dependency toggle preserves plain toggling for invalid parents and targets", () => {
  const pomodoro = [
    "- [ ] (**1535-1705** [t:: 90m])",
    "  - [[#^child]]",
    "- [ ] #task Child ^child",
  ].join("\n");
  const pomodoroResult = helpers.planSameFileDependencyToggle(
    pomodoro,
    1,
    "  - ![[#^child]]",
    "Here.md",
  );
  assert.equal(pomodoroResult.qualified, false);
  assert.match(pomodoroResult.content, /  - !\[\[#\^child\]\]/);
  assert.doesNotMatch(pomodoroResult.content, /dependsOn|\[id::/);

  const invalidTarget = [
    "- [ ] #task Parent",
    "  - [[#^child]]",
    "- [ ] Plain target ^child",
  ].join("\n");
  const invalidTargetResult = helpers.planSameFileDependencyToggle(
    invalidTarget,
    1,
    "  - ![[#^child]]",
    "Here.md",
  );
  assert.equal(invalidTargetResult.qualified, false);
  assert.match(invalidTargetResult.content, /  - !\[\[#\^child\]\]/);
  assert.doesNotMatch(invalidTargetResult.content, /dependsOn|\[id::/);
});

test("single runtime transclusion toggle preserves viewport in one line transaction", async () => {
  const activeFile = { path: "Here.md", extension: "md" };
  const lines = Array.from({ length: 24 }, (_, index) => `context ${index}`);
  const activeLine = 8;
  lines[activeLine] = "- [[Target]] trailing";
  const editor = new TransactionEditor(lines.join("\n"), {
    line: activeLine,
    ch: 10,
  });
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => activeFile },
  };
  const originalScrollTop = editor.getScrollInfo().top;

  assert.equal(await plugin.toggleCurrentLineTransclusions(editor), true);

  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.undoGroups, 1);
  assert.deepEqual(editor.transactionScrollTops, [originalScrollTop]);
  assert.equal(editor.getScrollInfo().top, originalScrollTop);
  assert.deepEqual(editor.setCursorCalls, []);
  assertLineBoundedTransaction(editor.transactions[0], lines, [activeLine]);
  assert.deepEqual(editor.transactions[0].selection, {
    from: { line: activeLine, ch: 11 },
    to: { line: activeLine, ch: 11 },
  });
  assert.equal(editor.getLine(activeLine), "- ![[Target]] trailing");
});

test("same-file runtime dependency add and removal use focused transactions", async () => {
  const activeFile = { path: "Here.md", extension: "md" };
  const lines = Array.from({ length: 24 }, (_, index) => `context ${index}`);
  const parentLine = 3;
  const activeLine = 6;
  const targetLine = 15;
  lines[parentLine] = "- [/] #task Parent ^parent";
  lines[4] = "  - supporting detail";
  lines[5] = "  - another detail";
  lines[activeLine] = "  - [[#^target]]";
  lines[targetLine] = "- [ ] #task Target ^target";
  const editor = new TransactionEditor(lines.join("\n"), {
    line: activeLine,
    ch: 12,
  });
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => activeFile },
  };
  const originalScrollTop = editor.getScrollInfo().top;

  assert.equal(await plugin.toggleCurrentLineTransclusions(editor), true);

  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.undoGroups, 1);
  assertLineBoundedTransaction(
    editor.transactions[0],
    lines,
    [parentLine, activeLine, targetLine],
  );
  assert.deepEqual(editor.transactions[0].selection, {
    from: { line: activeLine, ch: 13 },
    to: { line: activeLine, ch: 13 },
  });
  assert.match(editor.getLine(parentLine), /dependsOn:: Here__target/);
  assert.match(editor.getLine(parentLine), /- \[\?\] #task Parent/);
  assert.equal(editor.getLine(activeLine), "  - ![[#^target]]");
  assert.match(
    editor.getLine(targetLine),
    /- \[\/\] #task Target \[id:: Here__target\] \^target/,
  );
  assert.equal(editor.getScrollInfo().top, originalScrollTop);

  const beforeRemovalLines = editor.content.split("\n");
  assert.equal(await plugin.toggleCurrentLineTransclusions(editor), true);

  assert.equal(editor.transactions.length, 2);
  assert.equal(editor.undoGroups, 2);
  assertLineBoundedTransaction(
    editor.transactions[1],
    beforeRemovalLines,
    [parentLine, activeLine],
  );
  assert.deepEqual(editor.transactions[1].selection, {
    from: { line: activeLine, ch: 12 },
    to: { line: activeLine, ch: 12 },
  });
  assert.doesNotMatch(editor.getLine(parentLine), /dependsOn/);
  assert.match(editor.getLine(parentLine), /- \[\?\] #task Parent/);
  assert.equal(editor.getLine(activeLine), "  - [[#^target]]");
  assert.match(editor.getLine(targetLine), /id:: Here__target/);
  assert.equal(editor.getScrollInfo().top, originalScrollTop);
});

test("counted runtime transclusion toggle preserves viewport and caret", async () => {
  const activeFile = { path: "Here.md", extension: "md" };
  const lines = Array.from({ length: 22 }, (_, index) => `context ${index}`);
  const activeLine = 7;
  lines[activeLine] = "- [[One]]";
  lines[activeLine + 2] = "- ![[Two]]";
  const cursor = { line: activeLine, ch: 7 };
  const editor = new TransactionEditor(lines.join("\n"), cursor, 720);
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => activeFile },
  };

  assert.equal(
    await plugin.toggleCountedLineTransclusions(editor, cursor, 2),
    true,
  );

  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.undoGroups, 1);
  assert.deepEqual(editor.transactionScrollTops, [720]);
  assert.equal(editor.getScrollInfo().top, 720);
  assertLineBoundedTransaction(
    editor.transactions[0],
    lines,
    [activeLine, activeLine + 2],
  );
  assert.deepEqual(editor.transactions[0].selection, {
    from: { line: activeLine, ch: 8 },
    to: { line: activeLine, ch: 8 },
  });
  assert.equal(editor.getLine(activeLine), "- ![[One]]");
  assert.equal(editor.getLine(activeLine + 2), "- [[Two]]");
});

test("counted property runtime uses one transaction and preserves caret and viewport", () => {
  notices.length = 0;
  const lines = [
    "- [ ] #task One [created:: 2026-07-01] ^one",
    "prose",
    "- [/] #task Two [scheduled:: 2026-07-20] ^two",
    "- plain bullet",
    "> - [x] #task Three [scheduled:: 2026-07-23] ^three",
  ];
  const cursor = { line: 0, ch: 18 };
  const editor = new TransactionEditor(lines.join("\r\n"), cursor, 812);
  const session = helpers.discoverCountedObsidianTaskTargets(
    editor.content,
    0,
    2,
  );
  const file = { path: "sase.md", extension: "md" };
  const plugin = new NavigationHotkeysPlugin();
  plugin.getActiveMarkdownView = () => ({ editor, file });

  assert.equal(
    plugin.setCountedBulletPropertyValue(
      editor,
      cursor,
      file.path,
      session,
      "scheduled",
      "2026-07-23",
    ),
    true,
  );
  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.undoGroups, 1);
  assert.deepEqual(editor.transactionScrollTops, [812]);
  assert.equal(editor.getScrollInfo().top, 812);
  assertLineBoundedTransaction(editor.transactions[0], lines, [0, 2]);
  assert.deepEqual(editor.transactions[0].selection, {
    from: cursor,
    to: cursor,
  });
  assert.match(editor.getLine(0), /\[created:: 2026-07-01\].*\^one/);
  assert.match(editor.getLine(2), /\[scheduled:: 2026-07-23\].*\^two/);
  assert.match(notices.at(-1), /2 tasks.*1 task unchanged/);
});

test("counted property runtime aborts a stale batch without a transaction", () => {
  notices.length = 0;
  const editor = new TransactionEditor(
    "- [ ] #task One\n- [ ] #task Two",
    { line: 0, ch: 4 },
  );
  const session = helpers.discoverCountedObsidianTaskTargets(
    editor.content,
    0,
    1,
  );
  editor.content = editor.content.replace("Two", "Two changed");
  const file = { path: "Tasks.md", extension: "md" };
  const plugin = new NavigationHotkeysPlugin();
  plugin.getActiveMarkdownView = () => ({ editor, file });

  assert.equal(
    plugin.setCountedBulletPropertyValue(
      editor,
      { line: 0, ch: 4 },
      file.path,
      session,
      "p",
      "high",
    ),
    false,
  );
  assert.deepEqual(editor.transactions, []);
  assert.doesNotMatch(editor.content, /\[p::/);
  assert.match(notices.at(-1), /no tasks were updated/);
});

test("counted project scheduling is one structural transaction", () => {
  const input = [
    "---",
    "type: [[project]]",
    "---",
    "- [ ] #task Ship ^prj",
    "- [/] #task Follow up ^follow",
  ].join("\r\n");
  const cursor = { line: 3, ch: 12 };
  const editor = new TransactionEditor(input, cursor, 934);
  const session = helpers.discoverCountedObsidianTaskTargets(input, 3, 1);
  const file = { path: "projects/Ship.md", extension: "md" };
  const plugin = new NavigationHotkeysPlugin();
  plugin.getActiveMarkdownView = () => ({ editor, file });

  assert.equal(
    plugin.setCountedBulletPropertyValue(
      editor,
      cursor,
      file.path,
      session,
      "scheduled",
      "2026-07-23",
    ),
    true,
  );
  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.undoGroups, 1);
  assert.deepEqual(editor.transactionScrollTops, [934]);
  assert.equal(editor.transactions[0].changes.length, 1);
  assert.deepEqual(editor.transactions[0].changes[0].from, { line: 0, ch: 0 });
  assert.deepEqual(editor.transactions[0].selection, {
    from: { line: 4, ch: 12 },
    to: { line: 4, ch: 12 },
  });
  assert.equal(editor.content.includes("\r\n"), true);
  assert.match(editor.content, /^scheduled: 2026-07-23$/m);
  assert.doesNotMatch(editor.getLine(4), /\[scheduled::/);
  assert.match(editor.getLine(5), /\[scheduled:: 2026-07-23\]/);
});

test("counted dependencies converge mixed sources and maintain one link per parent", () => {
  const input = [
    "- [ ] #task One [dependsOn:: Tasks__target] ^one",
    "- [/] #task Two ^two",
    "> - [*] #task Three [dependsOn:: legacy-target] ^three",
    "- [ ] #task Target [id:: legacy-target] ^target",
  ].join("\n");
  const session = helpers.discoverCountedObsidianTaskTargets(input, 0, 2);
  const dependencyTask = helpers
    .getOpenLocalTasks(input)
    .find((task) => task.line === 3);
  const added = helpers.planCountedLocalTaskDependency(
    input,
    session,
    dependencyTask,
    "Tasks.md",
  );
  assert.equal(added.valid, true);
  assert.equal(added.operation, "add");
  assert.equal(added.targetCount, 3);
  assert.equal(
    (added.content.match(/\[dependsOn:: Tasks__target\]/g) || []).length,
    3,
  );
  assert.equal((added.content.match(/!\[\[#\^target\]\]/g) || []).length, 3);
  assert.match(added.content, /> \t- !\[\[#\^target\]\]/);
  assert.match(added.content, /Target \[id:: Tasks__target\] \^target/);
  assert.doesNotMatch(added.content, /legacy-target/);

  const removeSession = helpers.discoverCountedObsidianTaskTargets(
    added.content,
    0,
    2,
  );
  const updatedDependencyTask = helpers
    .getOpenLocalTasks(added.content)
    .find((task) => task.existingBlockId === "target");
  const removed = helpers.planCountedLocalTaskDependency(
    added.content,
    removeSession,
    updatedDependencyTask,
    "Tasks.md",
  );
  assert.equal(removed.valid, true);
  assert.equal(removed.operation, "remove");
  assert.doesNotMatch(removed.content, /dependsOn|!\[\[#\^target\]\]/);
  assert.match(removed.content, /Target \[id:: Tasks__target\] \^target/);
});

test("counted dependency candidates exclude every source and expose mixed state", () => {
  const input = [
    "- [ ] #task One [dependsOn:: Tasks__target] ^one",
    "- [/] #task Two ^two",
    "- [*] #task Three [dependsOn:: Tasks__target] ^three",
    "- [ ] #task Target ^target",
  ].join("\n");
  const items = helpers.createBulletPropertyLocalTaskItems(input, {
    excludeLines: new Set([0, 1, 2]),
    dependencyValueSets: [
      new Set(["Tasks__target"]),
      new Set(),
      new Set(["Tasks__target"]),
    ],
    filePath: "Tasks.md",
  });
  assert.deepEqual(items.map((item) => item.line), [3]);
  assert.equal(items[0].linkState, "mixed");
  assert.equal(items[0].linkedSourceCount, 2);
  assert.equal(items[0].sourceCount, 3);
});

test("counted dependency block-ID prompting is planned atomically", () => {
  const input = [
    "- [ ] #task One ^one",
    "- [/] #task Two ^two",
    "- [ ] #task Target",
  ].join("\r\n");
  const session = helpers.discoverCountedObsidianTaskTargets(input, 0, 1);
  const dependencyTask = helpers
    .getOpenLocalTasks(input)
    .find((task) => task.line === 2);
  const needsPrompt = helpers.planCountedLocalTaskDependency(
    input,
    session,
    dependencyTask,
    "Tasks.md",
  );
  assert.equal(needsPrompt.valid, false);
  assert.equal(needsPrompt.needsBlockIdPrompt, true);
  assert.equal(needsPrompt.content, input);

  const planned = helpers.planCountedLocalTaskDependency(
    input,
    session,
    dependencyTask,
    "Tasks.md",
    { confirmedBlockId: "target" },
  );
  assert.equal(planned.valid, true);
  assert.equal(planned.content.includes("\r\n"), true);
  assert.match(planned.content, /Target \[id:: Tasks__target\] \^target/);
  assert.equal(
    (planned.content.match(/\[dependsOn:: Tasks__target\]/g) || []).length,
    2,
  );
  assert.equal((planned.content.match(/!\[\[#\^target\]\]/g) || []).length, 2);

  const stale = input.replace("#task Two", "#task Two changed");
  const rejected = helpers.planCountedLocalTaskDependency(
    stale,
    session,
    dependencyTask,
    "Tasks.md",
    { confirmedBlockId: "target" },
  );
  assert.equal(rejected.valid, false);
  assert.equal(rejected.stale, true);
  assert.equal(rejected.content, stale);
  assert.doesNotMatch(rejected.content, /dependsOn|\[id::/);
});

test("counted dependency runtime applies target, parents, and navigation in one undo group", () => {
  const input = [
    "- [ ] #task One ^one",
    "- [/] #task Two ^two",
    "- [ ] #task Target ^target",
  ].join("\r\n");
  const cursor = { line: 0, ch: 8 };
  const editor = new TransactionEditor(input, cursor, 455);
  const session = helpers.discoverCountedObsidianTaskTargets(input, 0, 1);
  const dependencyTask = helpers
    .getOpenLocalTasks(input)
    .find((task) => task.existingBlockId === "target");
  const file = { path: "Tasks.md", extension: "md" };
  const plugin = new NavigationHotkeysPlugin();
  plugin.getActiveMarkdownView = () => ({ editor, file });

  assert.equal(
    plugin.applyCountedLocalTaskDependency(
      editor,
      cursor,
      file.path,
      session,
      dependencyTask,
    ),
    true,
  );
  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.undoGroups, 1);
  assert.deepEqual(editor.transactionScrollTops, [455]);
  assert.deepEqual(editor.transactions[0].selection, {
    from: cursor,
    to: cursor,
  });
  assert.equal(editor.content.includes("\r\n"), true);
  assert.equal(
    (editor.content.match(/\[dependsOn:: Tasks__target\]/g) || []).length,
    2,
  );
  assert.equal((editor.content.match(/!\[\[#\^target\]\]/g) || []).length, 2);
  assert.match(editor.content, /Target \[id:: Tasks__target\] \^target/);
});

test("async cross-file runtime toggle applies one focused source transaction", async () => {
  const activeFile = { path: "Here.md", extension: "md" };
  const targetFile = { path: "Other.md", extension: "md" };
  const lines = Array.from({ length: 22 }, (_, index) => `context ${index}`);
  const parentLine = 5;
  const activeLine = 7;
  lines[parentLine] = "- [/] #task Parent ^parent";
  lines[6] = "  - supporting detail";
  lines[activeLine] = "  - [[Other#^target]]";
  let targetContent = "- [ ] #task Target ^target";
  const editor = new TransactionEditor(lines.join("\n"), {
    line: activeLine,
    ch: 12,
  });
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => activeFile },
    metadataCache: { getFirstLinkpathDest: () => targetFile },
    vault: {
      cachedRead: async () => {
        await Promise.resolve();
        return targetContent;
      },
      getAbstractFileByPath: () => null,
      process: async (_file, transform) => {
        await Promise.resolve();
        targetContent = transform(targetContent);
      },
    },
  };

  assert.equal(await plugin.toggleCurrentLineTransclusions(editor), true);

  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.undoGroups, 1);
  assertLineBoundedTransaction(
    editor.transactions[0],
    lines,
    [parentLine, activeLine],
  );
  assert.deepEqual(editor.transactions[0].selection, {
    from: { line: activeLine, ch: 13 },
    to: { line: activeLine, ch: 13 },
  });
  assert.match(editor.getLine(parentLine), /dependsOn:: Other__target/);
  assert.match(editor.getLine(parentLine), /- \[\?\] #task Parent/);
  assert.match(
    targetContent,
    /- \[\/\] #task Target \[id:: Other__target\] \^target/,
  );
  assert.equal(editor.getScrollInfo().top, 640);
});

test("cross-file write failure still toggles only the source link", async () => {
  const activeFile = { path: "Here.md", extension: "md" };
  const targetFile = { path: "Other.md", extension: "md" };
  const lines = [
    "- [ ] #task Parent ^parent",
    "  - [[Other#^target]]",
    "context below",
  ];
  const editor = new TransactionEditor(lines.join("\n"), { line: 1, ch: 12 });
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => activeFile },
    metadataCache: { getFirstLinkpathDest: () => targetFile },
    vault: {
      cachedRead: async () => "- [ ] #task Target ^target",
      process: async () => {
        throw new Error("write failed");
      },
    },
  };

  assert.equal(await plugin.toggleCurrentLineTransclusions(editor), true);

  assert.equal(editor.transactions.length, 1);
  assertLineBoundedTransaction(editor.transactions[0], lines, [1]);
  assert.equal(editor.getLine(1), "  - ![[Other#^target]]");
  assert.doesNotMatch(editor.getLine(0), /dependsOn/);
  assert.doesNotMatch(editor.getLine(0), /- \[\?\]/);
});

test("line-local fallback applies bottom-up and preserves CRLF", async () => {
  const activeFile = { path: "Here.md", extension: "md" };
  const lines = Array.from({ length: 22 }, (_, index) => `context ${index}`);
  const parentLine = 3;
  const activeLine = 6;
  const targetLine = 15;
  lines[parentLine] = "- [/] #task Parent ^parent";
  lines[4] = "  - supporting detail";
  lines[5] = "  - another detail";
  lines[activeLine] = "  - [[#^target]]";
  lines[targetLine] = "- [ ] #task Target ^target";
  const editor = new RecordingFallbackEditor(lines.join("\r\n"), {
    line: activeLine,
    ch: 12,
  });
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => activeFile },
  };

  assert.equal(await plugin.toggleCurrentLineTransclusions(editor), true);

  assert.deepEqual(
    editor.replaceCalls.map((call) => call.from.line),
    [targetLine, activeLine, parentLine],
  );
  assert.equal(
    editor.replaceCalls.every((call) => call.from.line === call.to.line),
    true,
  );
  assert.deepEqual(editor.events, [
    `replace:${targetLine}`,
    `replace:${activeLine}`,
    `replace:${parentLine}`,
    "cursor",
  ]);
  assert.deepEqual(editor.setCursorCalls, [{ line: activeLine, ch: 13 }]);
  const expected = lines.slice();
  expected[parentLine] =
    "- [?] #task Parent [dependsOn:: Here__target] ^parent";
  expected[activeLine] = "  - ![[#^target]]";
  expected[targetLine] =
    "- [/] #task Target [id:: Here__target] ^target";
  assert.equal(editor.content, expected.join("\r\n"));
});

test("source line-count invariant rejects embedded newline changes", async () => {
  const activeFile = { path: "Here.md", extension: "md" };
  const editor = new TransactionEditor("before\n- [[Target]]\nafter", {
    line: 1,
    ch: 4,
  });
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => activeFile },
  };

  assert.equal(
    await plugin.applyDependencyAwareTransclusionChanges(editor, [
      { line: 1, nextLineText: "- ![[Target]]\nextra" },
    ]),
    false,
  );
  assert.equal(editor.content, "before\n- [[Target]]\nafter");
  assert.deepEqual(editor.transactions, []);
});

test("runtime dependency toggle atomically promotes a cross-file target", async () => {
  const activeFile = { path: "Here.md", extension: "md" };
  const targetFile = { path: "Other.md", extension: "md" };
  let targetContent = "- [ ] #task Target ^target";
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => activeFile },
    metadataCache: {
      getFirstLinkpathDest: (target) => (target === "Other" ? targetFile : null),
    },
    vault: {
      cachedRead: async () => targetContent,
      getAbstractFileByPath: (filePath) =>
        filePath === activeFile.path ? activeFile : null,
      process: async (_file, transform) => {
        targetContent = transform(targetContent);
      },
    },
  };
  const editor = new TestEditor(
    "- [/] #task Parent ^parent\n  - [[Other#^target]]",
  );
  assert.equal(
    await plugin.applyDependencyAwareTransclusionChanges(editor, [
      { line: 1, nextLineText: "  - ![[Other#^target]]" },
    ]),
    true,
  );
  assert.match(editor.content, /- \[\?\] #task Parent \[dependsOn:: Other__target\] \^parent/);
  assert.match(targetContent, /- \[\/\] #task Target \[id:: Other__target\] \^target/);

  assert.equal(
    await plugin.applyDependencyAwareTransclusionChanges(editor, [
      { line: 1, nextLineText: "  - [[Other#^target]]" },
    ]),
    true,
  );
  assert.doesNotMatch(editor.content, /dependsOn/);
  assert.match(editor.content, /- \[\?\] #task Parent \^parent/);
  assert.match(targetContent, /- \[\/\] #task Target \[id:: Other__target\] \^target/);
});

test("runtime cross-file terminal and unknown targets do not block parent", async () => {
  for (const targetStatus of ["x", "-", "!"]) {
    const activeFile = { path: "Here.md", extension: "md" };
    const targetFile = { path: "Other.md", extension: "md" };
    let targetContent = `- [${targetStatus}] #task Target ^target`;
    const plugin = new NavigationHotkeysPlugin();
    plugin.app = {
      workspace: { getActiveFile: () => activeFile },
      metadataCache: { getFirstLinkpathDest: () => targetFile },
      vault: {
        cachedRead: async () => targetContent,
        process: async (_file, transform) => {
          targetContent = transform(targetContent);
        },
      },
    };
    const editor = new TestEditor(
      "- [/] #task Parent ^parent\n  - [[Other#^target]]",
    );
    assert.equal(
      await plugin.applyDependencyAwareTransclusionChanges(editor, [
        { line: 1, nextLineText: "  - ![[Other#^target]]" },
      ]),
      true,
    );
    assert.match(editor.content, /- \[\/\] #task Parent \[dependsOn:: Other__target\]/);
    assert.doesNotMatch(editor.content, /- \[\?\] #task Parent/);
    assert.ok(
      targetContent.includes(
        `- [${targetStatus}] #task Target [id:: Other__target]`,
      ),
      targetContent,
    );
  }
});

test("runtime dependency toggle embeds hidden cross-file targets without writing them", async () => {
  const activeFile = { path: "Here.md", extension: "md" };
  const targetFile = { path: "Other.md", extension: "md" };
  const originalTargetContent = "- [ ] #task Target #hide ^target";
  let targetContent = originalTargetContent;
  let processCalls = 0;
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => activeFile },
    metadataCache: {
      getFirstLinkpathDest: (target) => (target === "Other" ? targetFile : null),
    },
    vault: {
      cachedRead: async () => targetContent,
      getAbstractFileByPath: () => null,
      process: async (_file, transform) => {
        processCalls += 1;
        targetContent = transform(targetContent);
      },
    },
  };
  const editor = new TestEditor(
    "- [ ] #task Parent ^parent\n  - [[Other#^target]]",
  );
  assert.equal(
    await plugin.applyDependencyAwareTransclusionChanges(editor, [
      { line: 1, nextLineText: "  - ![[Other#^target]]" },
    ]),
    true,
  );
  assert.match(editor.content, /  - !\[\[Other#\^target\]\]/);
  assert.doesNotMatch(editor.content, /dependsOn/);
  assert.equal(targetContent, originalTargetContent);
  assert.equal(processCalls, 0);
});

test("runtime dependency toggle can unlink a hidden cross-file target", async () => {
  const activeFile = { path: "Here.md", extension: "md" };
  const targetFile = { path: "Other.md", extension: "md" };
  const targetContent =
    "- [ ] #task Target #hide [id:: Other__target] ^target";
  let processCalls = 0;
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => activeFile },
    metadataCache: { getFirstLinkpathDest: () => targetFile },
    vault: {
      cachedRead: async () => targetContent,
      process: async () => {
        processCalls += 1;
      },
    },
  };
  const editor = new TestEditor(
    [
      "- [ ] #task Parent [dependsOn:: Other__target] ^parent",
      "  - ![[Other#^target]]",
    ].join("\n"),
  );
  assert.equal(
    await plugin.applyDependencyAwareTransclusionChanges(editor, [
      { line: 1, nextLineText: "  - [[Other#^target]]" },
    ]),
    true,
  );
  assert.match(editor.content, /  - \[\[Other#\^target\]\]/);
  assert.doesNotMatch(editor.content, /dependsOn/);
  assert.equal(processCalls, 0);
});

test("runtime dependency toggle leaves external files untouched for invalid endpoints", async () => {
  const activeFile = { path: "Here.md", extension: "md" };
  const targetFile = { path: "Other.md", extension: "md" };
  for (const scenario of [
    {
      source: "- [ ] (**1535-1705** [t:: 90m])\n  - [[Other#^target]]",
      target: "- [ ] #task Target ^target",
    },
    {
      source: "- [ ] #task Parent\n  - [[Other#^target]]",
      target: "- [ ] Plain target ^target",
    },
  ]) {
    let targetContent = scenario.target;
    let processCalls = 0;
    const plugin = new NavigationHotkeysPlugin();
    plugin.app = {
      workspace: { getActiveFile: () => activeFile },
      metadataCache: {
        getFirstLinkpathDest: (target) => (target === "Other" ? targetFile : null),
      },
      vault: {
        cachedRead: async () => targetContent,
        getAbstractFileByPath: () => null,
        process: async (_file, transform) => {
          processCalls += 1;
          targetContent = transform(targetContent);
        },
      },
    };
    const editor = new TestEditor(scenario.source);
    assert.equal(
      await plugin.applyDependencyAwareTransclusionChanges(editor, [
        { line: 1, nextLineText: "  - ![[Other#^target]]" },
      ]),
      true,
    );
    assert.match(editor.content, /!\[\[Other#\^target\]\]/);
    assert.doesNotMatch(editor.content, /dependsOn/);
    assert.equal(targetContent, scenario.target);
    assert.equal(processCalls, 0);
  }
});

test("runtime dependency toggle rechecks source before external writes", async () => {
  const activeFile = { path: "Here.md", extension: "md" };
  const targetFile = { path: "Other.md", extension: "md" };
  const editor = new TestEditor(
    "- [ ] #task Parent ^parent\n  - [[Other#^target]]",
  );
  let processCalls = 0;
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => activeFile },
    metadataCache: { getFirstLinkpathDest: () => targetFile },
    vault: {
      cachedRead: async () => {
        editor.content += "\nuser edit";
        return "- [ ] #task Target ^target";
      },
      process: async () => {
        processCalls += 1;
      },
    },
  };
  assert.equal(
    await plugin.applyDependencyAwareTransclusionChanges(editor, [
      { line: 1, nextLineText: "  - ![[Other#^target]]" },
    ]),
    false,
  );
  assert.equal(processCalls, 0);
});

test("runtime dependency toggle rejects a stale target snapshot without partial metadata", async () => {
  const activeFile = { path: "Here.md", extension: "md" };
  const targetFile = { path: "Other.md", extension: "md" };
  const cachedTarget = "- [ ] #task Target ^target";
  let targetContent = "- [ ] #task Target changed concurrently ^target";
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => activeFile },
    metadataCache: { getFirstLinkpathDest: () => targetFile },
    vault: {
      cachedRead: async () => cachedTarget,
      process: async (_file, transform) => {
        targetContent = transform(targetContent);
      },
    },
  };
  const editor = new TestEditor(
    "- [/] #task Parent ^parent\n  - [[Other#^target]]",
  );

  assert.equal(
    await plugin.applyDependencyAwareTransclusionChanges(editor, [
      { line: 1, nextLineText: "  - ![[Other#^target]]" },
    ]),
    true,
  );
  assert.match(editor.content, /  - !\[\[Other#\^target\]\]/);
  assert.doesNotMatch(editor.content, /dependsOn/);
  assert.doesNotMatch(editor.content, /- \[\?\] #task Parent/);
  assert.equal(targetContent, "- [ ] #task Target changed concurrently ^target");
});

test("counted dependency toggles block a parent when any linked target is open", async () => {
  const activeFile = { path: "Here.md", extension: "md" };
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => activeFile },
    vault: { getAbstractFileByPath: () => activeFile },
  };
  const editor = new TestEditor(
    [
      "- [/] #task Parent ^parent",
      "  - [[#^done]]",
      "  - [[#^open]]",
      "- [x] #task Done target ^done",
      "- [?] #task Blocked target ^open",
    ].join("\n"),
  );
  const toggle = helpers.toggleLineRangeTransclusions(
    editor.content.split("\n"),
    1,
    2,
  );
  assert.equal(
    await plugin.applyDependencyAwareTransclusionChanges(
      editor,
      toggle.changesByLine,
    ),
    true,
  );
  assert.match(
    editor.content,
    /- \[\?\] #task Parent \[dependsOn:: Here__done, Here__open\]/,
  );
  assert.match(editor.content, /- \[x\] #task Done target \[id:: Here__done\]/);
  assert.match(editor.content, /- \[\?\] #task Blocked target \[id:: Here__open\]/);
});

test("dependency propagation prefilters files and continues after failures", async () => {
  const contents = new Map([
    ["clean.md", "- [ ] #task Clean"],
    ["broken.md", "- [ ] #task Broken [dependsOn:: old]"],
    ["updated.md", "- [ ] #task Updated [dependsOn:: old]"],
  ]);
  const reads = [];
  const processes = [];
  const files = Array.from(contents.keys(), (filePath) => ({ path: filePath }));
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    vault: {
      getMarkdownFiles: () => files,
      cachedRead: async (file) => {
        reads.push(file.path);
        return contents.get(file.path);
      },
      process: async (file, transform) => {
        processes.push(file.path);
        if (file.path === "broken.md") throw new Error("write failed");
        contents.set(file.path, transform(contents.get(file.path)));
      },
    },
  };
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    assert.equal(
      await plugin.propagateDependencyIdReplacements(
        new Map([["old", "new"]]),
      ),
      false,
    );
  } finally {
    console.error = originalConsoleError;
  }
  assert.deepEqual(reads, ["clean.md", "broken.md", "updated.md"]);
  assert.deepEqual(processes, ["broken.md", "updated.md"]);
  assert.match(contents.get("updated.md"), /dependsOn:: new/);
});

test("counted runtime toggles every link but synchronizes only valid task pairs", async () => {
  const activeFile = { path: "Here.md", extension: "md" };
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => activeFile },
    vault: { getAbstractFileByPath: () => activeFile },
  };
  const editor = new TestEditor(
    [
      "- [ ] #task Parent",
      "  - [[#^valid]]",
      "- [ ] #task Valid target ^valid",
      "- [ ] (**1535-1705** [t:: 90m])",
      "  - [[#^plain]]",
      "- [ ] Plain target ^plain",
      "- [[loose]]",
    ].join("\n"),
  );
  const toggle = helpers.toggleLineRangeTransclusions(
    editor.content.split("\n"),
    0,
    6,
  );
  assert.equal(
    await plugin.applyDependencyAwareTransclusionChanges(
      editor,
      toggle.changesByLine,
    ),
    true,
  );
  assert.match(editor.content, /  - !\[\[#\^valid\]\]/);
  assert.match(editor.content, /  - !\[\[#\^plain\]\]/);
  assert.match(editor.content, /- !\[\[loose\]\]/);
  assert.match(editor.content, /- \[\?\] #task Parent \[dependsOn:: Here__valid\]/);
  assert.match(editor.content, /Valid target \[id:: Here__valid\] \^valid/);
  assert.doesNotMatch(editor.content, /Here__plain|Plain target \[id::/);
});

test("counted runtime dependency toggles handle hidden and visible targets independently", async () => {
  const activeFile = { path: "Here.md", extension: "md" };
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => activeFile },
    vault: { getAbstractFileByPath: () => activeFile },
  };
  const editor = new TestEditor(
    [
      "- [ ] #task Hidden parent",
      "  - [[#^hidden]]",
      "- [ ] #task Hidden target #hide ^hidden",
      "- [ ] #task Visible parent",
      "  - [[#^visible]]",
      "- [ ] #task Visible target ^visible",
    ].join("\n"),
  );
  const toggle = helpers.toggleLineRangeTransclusions(
    editor.content.split("\n"),
    0,
    5,
  );
  assert.equal(
    await plugin.applyDependencyAwareTransclusionChanges(
      editor,
      toggle.changesByLine,
    ),
    true,
  );
  assert.match(editor.content, /  - !\[\[#\^hidden\]\]/);
  assert.match(editor.content, /  - !\[\[#\^visible\]\]/);
  assert.doesNotMatch(editor.content, /Here__hidden/);
  assert.match(editor.content, /- \[\?\] #task Visible parent \[dependsOn:: Here__visible\]/);
  assert.match(editor.content, /- \[ \] #task Hidden parent/);
  assert.match(editor.content, /Visible target \[id:: Here__visible\] \^visible/);
});

test("counted dependency toggles retain the strongest rank for repeated targets", async () => {
  const activeFile = { path: "Here.md", extension: "md" };
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => activeFile },
    vault: { getAbstractFileByPath: () => activeFile },
  };
  const editor = new TestEditor(
    [
      "- [*] #task Next parent ^next-parent",
      "  - [[#^shared]]",
      "- [/] #task Working parent ^working-parent",
      "  - [[#^shared]]",
      "- [ ] #task Shared target ^shared",
      "- [/] #task Hidden parent ^hidden-parent",
      "  - [[#^hidden]]",
      "- [ ] #task Hidden target #hide ^hidden",
    ].join("\n"),
  );
  const toggle = helpers.toggleLineRangeTransclusions(
    editor.content.split("\n"),
    0,
    7,
  );

  assert.equal(
    await plugin.applyDependencyAwareTransclusionChanges(
      editor,
      toggle.changesByLine,
    ),
    true,
  );
  assert.match(editor.content, /- \[\?\] #task Next parent \[dependsOn:: Here__shared\]/);
  assert.match(editor.content, /- \[\?\] #task Working parent \[dependsOn:: Here__shared\]/);
  assert.match(
    editor.content,
    /- \[\/\] #task Shared target \[id:: Here__shared\] \^shared/,
  );
  assert.match(editor.content, /  - !\[\[#\^hidden\]\]/);
  assert.doesNotMatch(editor.content, /Here__hidden/);
  assert.match(editor.content, /- \[ \] #task Hidden target #hide \^hidden/);
});

test("counted transclusion toggle evaluates each line independently", () => {
  const result = helpers.toggleLineRangeTransclusions(
    ["- [[a]] and ![[b]]", "- ![[c]]"],
    0,
    1,
  );
  assert.deepEqual(
    result.changesByLine.map((change) => change.nextLineText),
    ["- ![[a]] and ![[b]]", "- [[c]]"],
  );
  assert.equal(
    helpers.toggleLineTransclusions("prefix [[a]] and [[b]]").line,
    "prefix ![[a]] and ![[b]]",
  );
});

test("migration transform rewrites only real tasks and reports skipped non-tasks", () => {
  const input = [
    "- [ ] #task Parent [dependsOn:: a, remote, missing]",
    "  - 🔗 **DEPENDENCIES:** [[#^a]] • [[#^remote]]",
    "- Plain parent [dependsOn:: a]",
    "\t- arbitrary child",
    "- [ ] #task A [id:: a] ^a",
  ].join("\n");
  const resolutions = new Map([
    ["a", { filePath: "Here.md", blockId: "a" }],
    ["remote", { filePath: "folder/Other.md", blockId: "actual" }],
  ]);
  const migrated = helpers.transformDependencyBulletsInContent(
    input,
    "Here.md",
    resolutions,
  );
  assert.equal(migrated.changed, true);
  assert.match(migrated.content, /  - !\[\[#\^a\]\]/);
  assert.match(migrated.content, /  - !\[\[Other#\^actual\]\]/);
  assert.match(
    migrated.content,
    /- Plain parent \[dependsOn:: a\]\n\t- arbitrary child/,
  );
  assert.equal(migrated.skippedNonTaskCount, 1);
  assert.deepEqual(migrated.skippedNonTasks, [
    { filePath: "Here.md", line: 3 },
  ]);
  assert.equal(migrated.unresolved.length, 1);
  assert.equal(migrated.unresolved[0].id, "missing");
  const second = helpers.transformDependencyBulletsInContent(
    migrated.content,
    "Here.md",
    resolutions,
  );
  assert.equal(second.changed, false);
});

test("migration warns and never rewrites ambiguous dependency IDs", (t) => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "bob-dependency-migration-"));
  t.after(() => fs.rmSync(vault, { recursive: true, force: true }));
  const parentPath = path.join(vault, "Parent.md");
  const originalParent = [
    "- [ ] #task Parent [dependsOn:: x] ^parent",
    "  - 🔗 **DEPENDENCIES:** [[#^x]]",
  ].join("\n");
  fs.writeFileSync(parentPath, originalParent);
  fs.writeFileSync(path.join(vault, "A.md"), "- [ ] #task A ^x\n");
  fs.writeFileSync(path.join(vault, "B.md"), "- [ ] #task B [id:: x] ^y\n");

  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, "migrate-dependency-bullets.mjs"), "--vault", vault, "--write"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /ambiguous dependency ID x:/);
  assert.equal(fs.readFileSync(parentPath, "utf8"), originalParent);
});

test("counted task moves discover movable tasks without wrapping or examples", () => {
  const lines = [
    "---",
    "example: - [ ] #task YAML",
    "---",
    "- [ ] #task Start ^start",
    "prose",
    "- [x] #task Done ^done",
    "- [ ] #task Lifecycle ^prj",
    "```md",
    "- [ ] #task Fenced ^fake",
    "```",
    "- [?] #task Custom ^custom",
  ];
  const content = lines.join("\n");
  const result = helpers.discoverMovableObsidianTaskTargets(content, 3, 3);
  assert.equal(result.valid, true);
  assert.equal(result.requestedCount, 4);
  assert.equal(result.actualCount, 3);
  assert.equal(result.clamped, true);
  assert.deepEqual(
    result.targets.map((target) => target.line),
    [3, 5, 10],
  );
  assert.match(
    helpers.discoverMovableObsidianTaskTargets(content, 6, 0).error,
    /lifecycle/,
  );
  assert.match(
    helpers.discoverMovableObsidianTaskTargets(content, 4, 0).error,
    /real #task/,
  );
});

test("task move ranges preserve quoted subtrees and collapse overlapping selections", () => {
  const content = [
    "Intro",
    "> - [ ] #task Parent ^parent",
    ">   Explanation",
    ">",
    ">   - [x] #task Child ^child",
    ">     - ![[#^dependency]]",
    "> - [ ] #task Sibling ^sibling",
    "Tail",
  ].join("\n");
  const discovery = helpers.discoverMovableObsidianTaskTargets(content, 1, 1);
  assert.deepEqual(
    discovery.targets.map((target) => target.line),
    [1, 4],
  );
  const ranges = helpers.buildTaskMoveRanges(content, discovery.targets);
  assert.equal(ranges.valid, true);
  assert.equal(ranges.ranges.length, 1);
  assert.deepEqual(ranges.ranges[0].selectedTargetLines, [1, 4]);
  assert.deepEqual(helpers.rebaseTaskMoveBlock(ranges.ranges[0]), [
    "- [ ] #task Parent ^parent",
    "  Explanation",
    "",
    "  - [x] #task Child ^child",
    "    - ![[#^dependency]]",
  ]);

  const childTarget = { line: 4, rawLine: content.split("\n")[4] };
  const childRange = helpers.buildTaskMoveRanges(content, [childTarget]);
  assert.deepEqual(helpers.rebaseTaskMoveBlock(childRange.ranges[0]), [
    "- [x] #task Child ^child",
    "  - ![[#^dependency]]",
  ]);
});

test("task move removal handles disjoint ranges, blank seams, and CRLF", () => {
  const content = [
    "Before",
    "",
    "- [ ] #task One",
    "  child",
    "",
    "- [/] #task Two",
    "",
    "After",
    "",
  ].join("\r\n");
  const discovery = helpers.discoverMovableObsidianTaskTargets(content, 2, 1);
  const ranges = helpers.buildTaskMoveRanges(content, discovery.targets);
  const removed = helpers.removeTaskMoveRanges(content, ranges.ranges);
  assert.equal(removed.valid, true);
  assert.equal(removed.content, "Before\r\n\r\nAfter\r\n");
  assert.equal(removed.nextLine, 2);
});

test("task move destinations include areas and only open projects", () => {
  const files = [
    { path: "z/Waiting.md", basename: "Waiting" },
    { path: "Source.md", basename: "Source" },
    { path: "a/Area.md", basename: "Area" },
    { path: "b/Wip.md", basename: "Wip" },
    { path: "c/Done.md", basename: "Done" },
    { path: "d/Unknown.md", basename: "Unknown" },
    { path: "_templates/new_project.md", basename: "new_project" },
  ];
  const info = new Map([
    ["z/Waiting.md", helpers.getChildNoteInfo({ type: "[[project]]", status: "waiting" })],
    ["Source.md", helpers.getChildNoteInfo({ type: "[[area]]" })],
    ["a/Area.md", helpers.getChildNoteInfo({ type: "[[area]]" })],
    ["b/Wip.md", helpers.getChildNoteInfo({ type: "[[project]]", status: "wip" })],
    ["c/Done.md", helpers.getChildNoteInfo({ type: "[[project]]", status: "done" })],
    ["d/Unknown.md", helpers.getChildNoteInfo({ type: "[[project]]", status: "mystery" })],
    ["_templates/new_project.md", helpers.getChildNoteInfo({ type: "[[area]]" })],
  ]);
  const destinations = helpers.collectTaskMoveDestinations(
    files,
    "Source.md",
    (file) => info.get(file.path),
  );
  assert.deepEqual(
    destinations.map((entry) => entry.file.path),
    ["a/Area.md", "b/Wip.md", "z/Waiting.md"],
  );
  assert.match(
    helpers.getChildNoteSearchText(
      destinations[0].file,
      destinations[0].noteInfo,
    ),
    /area/,
  );
  assert.match(
    helpers.getChildNoteSearchText(
      destinations[2].file,
      destinations[2].noteInfo,
    ),
    /waiting/,
  );
});

test("task move picker closes before commit while other pickers retain delayed close", async () => {
  const destinations = [
    { file: { path: "Area.md", basename: "Area" }, noteInfo: {} },
  ];
  const session = {
    discovery: { actualCount: 2, requestedCount: 2, clamped: false },
  };

  for (const commitResult of [true, false]) {
    const events = [];
    let settleCommit;
    const commit = new Promise((resolve) => {
      settleCommit = resolve;
    });
    const plugin = {
      commitTaskMoveSession: () => {
        events.push("commit");
        return commit;
      },
    };
    const picker = new helpers.TaskMoveDestinationPickerModal(
      {},
      plugin,
      destinations,
      session,
    );
    picker.close = () => events.push("close");

    const selection = picker.openItemAtIndex(0);
    assert.deepEqual(events, ["close", "commit"]);
    await picker.openItemAtIndex(0);
    assert.deepEqual(events, ["close", "commit"]);

    settleCommit(commitResult);
    await selection;
    assert.deepEqual(events, ["close", "commit"]);
  }

  for (const openResult of [true, false]) {
    const events = [];
    let settleOpen;
    const opening = new Promise((resolve) => {
      settleOpen = resolve;
    });
    const picker = new helpers.FilteredPickerModal({}, {
      items: ["item"],
      openItem: () => {
        events.push("open");
        return opening;
      },
    });
    picker.close = () => events.push("close");

    const selection = picker.openItemAtIndex(0);
    assert.deepEqual(events, ["open"]);
    settleOpen(openResult);
    await selection;
    assert.deepEqual(events, openResult ? ["open", "close"] : ["open"]);
  }
});

test("task move insertion preserves exact task and section spacing", () => {
  const moved = [
    [
      "- [x] #task Moved [p::3] ^moved",
      "  child",
      "",
      "  continuation",
    ],
    ["- [ ] #task Second ^second"],
  ];
  assert.deepEqual(helpers.flattenTaskMoveBlocks(moved), [
    "- [x] #task Moved [p::3] ^moved",
    "  child",
    "",
    "  continuation",
    "- [ ] #task Second ^second",
  ]);

  const existing = [
    "---",
    "type: \"[[project]]\"",
    "status: wip",
    "---",
    "## Tasks",
    "",
    "- [ ] #task Existing ^existing",
    "",
    "## Notes",
    "Keep",
  ].join("\n");
  const appended = helpers.insertTaskMoveBlocks(existing, moved, "project");
  assert.equal(appended.valid, true);
  assert.equal(appended.content, [
    "---",
    "type: \"[[project]]\"",
    "status: wip",
    "---",
    "## Tasks",
    "",
    "- [ ] #task Existing ^existing",
    "- [x] #task Moved [p::3] ^moved",
    "  child",
    "",
    "  continuation",
    "- [ ] #task Second ^second",
    "",
    "## Notes",
    "Keep",
  ].join("\n"));

  const project = [
    "---",
    "type: \"[[project]]\"",
    "status: wip",
    "---",
    "## Tasks",
    "",
    "- [ ] #task (REPLACE WITH TASK DESCRIPTION)",
    "",
    "## Notes",
    "Keep",
  ].join("\n");
  const inserted = helpers.insertTaskMoveBlocks(project, moved, "project");
  assert.equal(inserted.valid, true);
  assert.equal(inserted.content, [
    "---",
    "type: \"[[project]]\"",
    "status: wip",
    "---",
    "## Tasks",
    "",
    "- [x] #task Moved [p::3] ^moved",
    "  child",
    "",
    "  continuation",
    "- [ ] #task Second ^second",
    "",
    "## Notes",
    "Keep",
  ].join("\n"));

  const area = [
    "---",
    "type: \"[[area]]\"",
    "---",
    "# Area",
    "Body",
    "",
  ].join("\r\n");
  const created = helpers.insertTaskMoveBlocks(area, moved, "area");
  assert.equal(created.valid, true);
  assert.equal(created.content, [
    "---",
    "type: \"[[area]]\"",
    "---",
    "# Area",
    "Body",
    "",
    "## Tasks",
    "",
    "- [x] #task Moved [p::3] ^moved",
    "  child",
    "",
    "  continuation",
    "- [ ] #task Second ^second",
    "",
  ].join("\r\n"));

  const areaWithoutTerminalNewline = area.slice(0, -2);
  const createdWithoutTerminalNewline = helpers.insertTaskMoveBlocks(
    areaWithoutTerminalNewline,
    moved,
    "area",
  );
  assert.equal(createdWithoutTerminalNewline.valid, true);
  assert.equal(createdWithoutTerminalNewline.content.endsWith("\r\n"), false);
  assert.match(
    createdWithoutTerminalNewline.content,
    /Body\r\n\r\n## Tasks\r\n\r\n- \[x\]/,
  );

  const invalidProject = helpers.insertTaskMoveBlocks(project.replace("## Tasks", "## Work"), moved, "project");
  assert.equal(invalidProject.valid, false);
  assert.match(invalidProject.error, /no valid ## Tasks/);
});

test("task move planning migrates identities and links across every affected note", () => {
  const source = [
    "- [ ] #task One [id:: Source__one] [dependsOn:: Source__two] ^one",
    "  - ![[#^two|Two]]",
    "  - [[#^stay|Stay]]",
    "- [/] #task Two [id:: Source__two] ^two",
    "- [ ] #task Stay [dependsOn:: Source__one] ^stay",
    "  - [[#^one|Moved]]",
  ].join("\n");
  const destination = [
    "---",
    "type: \"[[project]]\"",
    "status: waiting",
    "---",
    "## Tasks",
    "",
    "- [ ] #task Existing [id:: Projects__Dest__existing] ^existing",
    "",
    "## Notes",
    "Keep",
  ].join("\n");
  const refs = [
    "- [ ] #task Ref [dependsOn:: Source__one]",
    "![[Source#^one|Embedded alias]]",
    "[Second](Source.md#^two)",
  ].join("\n");
  const discovery = helpers.discoverMovableObsidianTaskTargets(source, 0, 1);
  const plan = helpers.planTaskMoveAcrossFiles({
    sourcePath: "Source.md",
    destinationPath: "Projects/Dest.md",
    sourceContent: source,
    destinationContent: destination,
    otherContents: new Map([["Refs.md", refs]]),
    targets: discovery.targets,
  });
  assert.equal(plan.valid, true, plan.error);
  const nextSource = plan.changes.get("Source.md").after;
  assert.match(nextSource, /dependsOn:: Projects__Dest__one/);
  assert.match(nextSource, /\[\[Projects\/Dest#\^one\|Moved\]\]/);
  assert.doesNotMatch(nextSource, /#task One|#task Two/);

  const nextDestination = plan.changes.get("Projects/Dest.md").after;
  assert.equal(nextDestination, [
    "---",
    "type: \"[[project]]\"",
    "status: waiting",
    "---",
    "## Tasks",
    "",
    "- [ ] #task Existing [id:: Projects__Dest__existing] ^existing",
    "- [ ] #task One [id:: Projects__Dest__one] [dependsOn:: Projects__Dest__two] ^one",
    "  - ![[#^two|Two]]",
    "  - [[Source#^stay|Stay]]",
    "- [/] #task Two [id:: Projects__Dest__two] ^two",
    "",
    "## Notes",
    "Keep",
  ].join("\n"));

  const nextRefs = plan.changes.get("Refs.md").after;
  assert.match(nextRefs, /dependsOn:: Projects__Dest__one/);
  assert.match(nextRefs, /!\[\[Projects\/Dest#\^one\|Embedded alias\]\]/);
  assert.match(nextRefs, /\(Projects\/Dest\.md#\^two\)/);
});

test("task move planning rejects destination collisions and malformed identities", () => {
  const destination = [
    "---",
    "type: \"[[area]]\"",
    "---",
    "## Tasks",
    "- [ ] #task Existing ^same",
  ].join("\n");
  const collisionSource = "- [ ] #task Move ^same";
  let discovery = helpers.discoverMovableObsidianTaskTargets(collisionSource, 0, 0);
  let plan = helpers.planTaskMoveAcrossFiles({
    sourcePath: "Source.md",
    destinationPath: "Area.md",
    sourceContent: collisionSource,
    destinationContent: destination,
    targets: discovery.targets,
  });
  assert.equal(plan.valid, false);
  assert.match(plan.error, /already contains block ID/);

  const malformed = "- [ ] #task Move [id:: wrong] ^move";
  discovery = helpers.discoverMovableObsidianTaskTargets(malformed, 0, 0);
  plan = helpers.planTaskMoveAcrossFiles({
    sourcePath: "Source.md",
    destinationPath: "Area.md",
    sourceContent: malformed,
    destinationContent: destination.replace("^same", "^other"),
    targets: discovery.targets,
  });
  assert.equal(plan.valid, false);
  assert.match(plan.error, /ambiguous \[id::\]/);
});

test("physical task move chord consumes bare and counted Vim normal input once", () => {
  const makeEvent = (overrides = {}) => {
    const calls = { prevent: 0, stop: 0, immediate: 0 };
    return {
      key: "M",
      code: "KeyM",
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false,
      preventDefault: () => calls.prevent += 1,
      stopPropagation: () => calls.stop += 1,
      stopImmediatePropagation: () => calls.immediate += 1,
      calls,
      ...overrides,
    };
  };
  const inputState = {
    keyBuffer: [],
    repeat: null,
    getRepeat: () => null,
  };
  const cm = {
    state: { vim: { mode: "normal", inputState } },
    getCursor: () => ({ line: 0, ch: 0 }),
  };
  const editor = { cm: { cm } };
  const view = { editor };
  const plugin = new NavigationHotkeysPlugin();
  plugin.handledCountedTaskMoveEvents = new WeakSet();
  plugin.getFocusedMarkdownEditorView = () => view;
  const opens = [];
  plugin.openTaskMoveDestinationPicker = (_editor, _view, options) => {
    opens.push(options);
    return true;
  };

  const bare = makeEvent();
  assert.equal(plugin.handleCountedTaskMovePhysicalKeydown(bare), true);
  assert.deepEqual(opens[0], { countExplicit: false, additionalTaskCount: 0 });
  assert.deepEqual(bare.calls, { prevent: 1, stop: 1, immediate: 1 });
  assert.equal(plugin.handleCountedTaskMovePhysicalKeydown(bare), false);

  inputState.keyBuffer = ["2"];
  inputState.repeat = 2;
  inputState.getRepeat = () => 2;
  const counted = makeEvent();
  assert.equal(plugin.handleCountedTaskMovePhysicalKeydown(counted), true);
  assert.deepEqual(opens[1], { countExplicit: true, additionalTaskCount: 2 });
  assert.deepEqual(inputState.keyBuffer, []);
  assert.equal(inputState.repeat, null);

  for (const mode of ["insert", "visual", "visual-line", "replace"]) {
    cm.state.vim.mode = mode;
    const event = makeEvent();
    assert.equal(plugin.handleCountedTaskMovePhysicalKeydown(event), false);
    assert.equal(event.calls.prevent, 0);
  }
  cm.state.vim.mode = "normal";
  for (const overrides of [
    { ctrlKey: false },
    { shiftKey: false },
    { altKey: true },
    { metaKey: true },
    { code: "KeyN", key: "N" },
  ]) {
    const event = makeEvent(overrides);
    assert.equal(plugin.handleCountedTaskMovePhysicalKeydown(event), false);
    assert.equal(event.calls.prevent, 0);
  }
});

test("runtime task move writes destination before source and rolls back source failures", async () => {
  notices.length = 0;
  const sourceFile = { path: "Source.md", basename: "Source", extension: "md" };
  const destinationFile = { path: "Dest.md", basename: "Dest", extension: "md" };
  const sourceContent = "- [ ] #task Move ^move\n- [ ] #task Stay ^stay";
  const destinationContent = [
    "---",
    "type: \"[[area]]\"",
    "---",
    "# Destination",
  ].join("\n");
  class FailingSourceEditor extends TransactionEditor {
    transaction() {
      throw new Error("injected source failure");
    }
  }
  const sourceEditor = new FailingSourceEditor(sourceContent, { line: 0, ch: 4 });
  const contents = new Map([
    [sourceFile.path, sourceContent],
    [destinationFile.path, destinationContent],
  ]);
  const writeOrder = [];
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    vault: {
      getMarkdownFiles: () => [sourceFile, destinationFile],
      cachedRead: async (file) => contents.get(file.path),
      process: async (file, transform) => {
        writeOrder.push(file.path);
        contents.set(file.path, transform(contents.get(file.path)));
      },
    },
    workspace: {},
  };
  plugin.getActiveMarkdownView = () => ({ file: sourceFile, editor: sourceEditor });
  plugin.getOpenMarkdownEditorForPath = (path) =>
    path === sourceFile.path ? sourceEditor : null;
  const discovery = helpers.discoverMovableObsidianTaskTargets(sourceContent, 0, 0);
  const session = {
    sourceFile,
    sourcePath: sourceFile.path,
    sourceView: null,
    editor: sourceEditor,
    sourceContent,
    cursor: { line: 0, ch: 4 },
    scroll: null,
    discovery,
  };
  const result = await plugin.commitTaskMoveSession(session, {
    file: destinationFile,
  });
  assert.equal(result, false);
  assert.equal(sourceEditor.content, sourceContent);
  assert.equal(contents.get(destinationFile.path), destinationContent);
  assert.deepEqual(writeOrder, ["Dest.md", "Dest.md"]);
  assert.match(notices.at(-1), /rolled back.*source tasks were retained/);
});

test("runtime task move groups open-editor source and destination changes", async () => {
  notices.length = 0;
  const sourceFile = { path: "Source.md", basename: "Source", extension: "md" };
  const destinationFile = { path: "Dest.md", basename: "Dest", extension: "md" };
  const sourceContent = "- [ ] #task Move ^move\n- [ ] #task Stay ^stay";
  const destinationContent = [
    "---",
    "type: \"[[project]]\"",
    "status: wip",
    "---",
    "## Tasks",
    "",
    "- [ ] #task Existing ^existing",
  ].join("\n");
  const sourceEditor = new TransactionEditor(sourceContent, { line: 0, ch: 3 });
  const destinationEditor = new TransactionEditor(destinationContent, { line: 6, ch: 0 });
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    vault: {
      getMarkdownFiles: () => [sourceFile, destinationFile],
      cachedRead: async () => "",
      process: async () => {
        throw new Error("open editors should not use vault.process");
      },
    },
    workspace: {},
  };
  plugin.getActiveMarkdownView = () => ({ file: sourceFile, editor: sourceEditor });
  plugin.getOpenMarkdownEditorForPath = (path) =>
    path === sourceFile.path
      ? sourceEditor
      : path === destinationFile.path
        ? destinationEditor
        : null;
  const discovery = helpers.discoverMovableObsidianTaskTargets(sourceContent, 0, 0);
  const session = {
    sourceFile,
    sourcePath: sourceFile.path,
    editor: sourceEditor,
    sourceContent,
    cursor: { line: 0, ch: 3 },
    scroll: null,
    discovery,
  };
  const result = await plugin.commitTaskMoveSession(session, { file: destinationFile });
  assert.equal(result, true);
  assert.equal(sourceEditor.undoGroups, 1);
  assert.equal(destinationEditor.undoGroups, 1);
  assert.doesNotMatch(sourceEditor.content, /#task Move/);
  assert.match(destinationEditor.content, /#task Move \[id:: Dest__move\] \^move/);
  assert.deepEqual(sourceEditor.cursor, { line: 0, ch: 3 });
  assert.match(notices.at(-1), /Moved 1 task to Dest/);
});

test("runtime task move guards destination, auxiliary, and rollback failures", async () => {
  const sourceFile = { path: "Source.md", basename: "Source", extension: "md" };
  const destinationFile = { path: "Dest.md", basename: "Dest", extension: "md" };
  const refsFile = { path: "Refs.md", basename: "Refs", extension: "md" };
  const sourceContent = "- [ ] #task Move ^move\n- [ ] #task Stay ^stay";
  const destinationContent = [
    "---",
    "type: \"[[area]]\"",
    "---",
    "# Destination",
  ].join("\n");
  const refsContent = "![[Source#^move|Moved]]";

  const run = async (failure) => {
    notices.length = 0;
    const sourceEditor = new TransactionEditor(sourceContent, { line: 0, ch: 0 });
    const contents = new Map([
      [sourceFile.path, sourceContent],
      [destinationFile.path, destinationContent],
      [refsFile.path, refsContent],
    ]);
    const plugin = new NavigationHotkeysPlugin();
    plugin.app = {
      vault: {
        getMarkdownFiles: () => [sourceFile, destinationFile, refsFile],
        cachedRead: async (file) => contents.get(file.path),
        process: async (file, transform) => {
          const current = contents.get(file.path);
          if (failure === "destination" && file.path === destinationFile.path) {
            throw new Error("injected destination failure");
          }
          if (failure !== "destination" && file.path === refsFile.path) {
            throw new Error("injected auxiliary failure");
          }
          if (
            failure === "rollback" &&
            file.path === destinationFile.path &&
            current !== destinationContent
          ) {
            throw new Error("injected rollback failure");
          }
          contents.set(file.path, transform(current));
        },
      },
      workspace: {},
    };
    plugin.getActiveMarkdownView = () => ({ file: sourceFile, editor: sourceEditor });
    plugin.getOpenMarkdownEditorForPath = (path) =>
      path === sourceFile.path ? sourceEditor : null;
    const discovery = helpers.discoverMovableObsidianTaskTargets(sourceContent, 0, 0);
    const result = await plugin.commitTaskMoveSession(
      {
        sourceFile,
        sourcePath: sourceFile.path,
        editor: sourceEditor,
        sourceContent,
        cursor: { line: 0, ch: 0 },
        scroll: null,
        discovery,
      },
      { file: destinationFile },
    );
    return { result, contents, sourceEditor, notice: notices.at(-1) };
  };

  const destinationFailure = await run("destination");
  assert.equal(destinationFailure.result, false);
  assert.equal(destinationFailure.contents.get("Dest.md"), destinationContent);
  assert.equal(destinationFailure.sourceEditor.content, sourceContent);

  const auxiliaryFailure = await run("auxiliary");
  assert.equal(auxiliaryFailure.result, false);
  assert.equal(auxiliaryFailure.contents.get("Dest.md"), destinationContent);
  assert.equal(auxiliaryFailure.contents.get("Refs.md"), refsContent);
  assert.equal(auxiliaryFailure.sourceEditor.content, sourceContent);
  assert.match(auxiliaryFailure.notice, /rolled back/);

  const rollbackFailure = await run("rollback");
  assert.equal(rollbackFailure.result, false);
  assert.notEqual(rollbackFailure.contents.get("Dest.md"), destinationContent);
  assert.equal(rollbackFailure.sourceEditor.content, sourceContent);
  assert.match(rollbackFailure.notice, /recoverable duplicates.*Dest\.md/);
});

test("dash restore suppresses editor notice after deliberate navigation", async () => {
  notices.length = 0;
  let activeFile = { path: "dash.md" };
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => activeFile },
  };
  plugin.restoreActiveDashLocation = () => ({
    active: false,
    applied: false,
    needsQueryRetry: false,
  });
  plugin.restoreOrDeferDashLocation({ cursor: { line: 0, ch: 0 } }, 1);
  activeFile = { path: "Other.md" };
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(notices, []);
});

test("open-task dispatch timeout is registered for plugin cleanup", () => {
  const cleanups = [];
  const plugin = new NavigationHotkeysPlugin();
  plugin.register = (cleanup) => cleanups.push(cleanup);
  plugin.markOpenTaskJumpDispatch({}, 1);
  assert.equal(cleanups.length, 1);
  cleanups[0]();
});

test("physical counted property chord consumes only explicit normal-mode Vim counts", () => {
  const makeEvent = (overrides = {}) => {
    const calls = { prevent: 0, stop: 0, immediate: 0 };
    return {
      key: "P",
      code: "KeyP",
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false,
      preventDefault: () => {
        calls.prevent += 1;
      },
      stopPropagation: () => {
        calls.stop += 1;
      },
      stopImmediatePropagation: () => {
        calls.immediate += 1;
      },
      calls,
      ...overrides,
    };
  };
  const inputState = {
    keyBuffer: ["2"],
    repeat: 2,
    getRepeat: () => 2,
  };
  const cm = {
    state: { vim: { mode: "normal", inputState } },
    getCursor: () => ({ line: 0, ch: 0 }),
  };
  const editor = { cm: { cm } };
  const view = { editor };
  const plugin = new NavigationHotkeysPlugin();
  plugin.handledCountedBulletPropertyEvents = new WeakSet();
  plugin.getFocusedMarkdownEditorView = () => view;
  const opens = [];
  plugin.openBulletPropertyPicker = (_editor, options) => {
    opens.push(options);
    return true;
  };

  const counted = makeEvent();
  assert.equal(plugin.handleCountedBulletPropertyPhysicalKeydown(counted), true);
  assert.deepEqual(opens, [
    { countExplicit: true, additionalTaskCount: 2 },
  ]);
  assert.deepEqual(counted.calls, { prevent: 1, stop: 1, immediate: 1 });
  assert.deepEqual(inputState.keyBuffer, []);
  assert.equal(inputState.repeat, null);

  // The same physical event delivered to both window and document is ignored.
  assert.equal(plugin.handleCountedBulletPropertyPhysicalKeydown(counted), false);
  assert.equal(opens.length, 1);

  inputState.getRepeat = () => null;
  const bare = makeEvent();
  assert.equal(plugin.handleCountedBulletPropertyPhysicalKeydown(bare), false);
  assert.deepEqual(bare.calls, { prevent: 0, stop: 0, immediate: 0 });

  for (const mode of ["insert", "visual", "visual-line", "replace"]) {
    cm.state.vim.mode = mode;
    inputState.keyBuffer = ["3"];
    inputState.getRepeat = () => 3;
    const event = makeEvent();
    assert.equal(plugin.handleCountedBulletPropertyPhysicalKeydown(event), false);
    assert.equal(event.calls.prevent, 0);
  }

  cm.state.vim.mode = "normal";
  for (const overrides of [
    { ctrlKey: false },
    { shiftKey: false },
    { altKey: true },
    { metaKey: true },
    { key: "O", code: "KeyO" },
  ]) {
    const event = makeEvent(overrides);
    assert.equal(plugin.handleCountedBulletPropertyPhysicalKeydown(event), false);
    assert.equal(event.calls.prevent, 0);
  }

  delete cm.state.vim;
  const disabled = makeEvent();
  assert.equal(plugin.handleCountedBulletPropertyPhysicalKeydown(disabled), false);
  assert.equal(disabled.calls.prevent, 0);

  cm.state.vim = { mode: "normal", inputState };
  plugin.getFocusedMarkdownEditorView = () => null;
  const unfocused = makeEvent();
  assert.equal(plugin.handleCountedBulletPropertyPhysicalKeydown(unfocused), false);
  assert.equal(unfocused.calls.prevent, 0);
  assert.equal(opens.length, 1);
});

test("tab pin Vim action registers once and toggles only the active leaf once", (t) => {
  const originalWindow = global.window;
  t.after(() => {
    if (originalWindow === undefined) {
      delete global.window;
    } else {
      global.window = originalWindow;
    }
  });

  const actions = new Map();
  const mappings = [];
  global.window = {
    CodeMirrorAdapter: {
      Vim: {
        defineAction: (name, handler) => actions.set(name, handler),
        mapCommand: (...args) => mappings.push(args),
      },
    },
  };

  let firstToggleCount = 0;
  let secondToggleCount = 0;
  const firstLeaf = {
    togglePinned: () => {
      firstToggleCount += 1;
    },
  };
  const secondLeaf = {
    togglePinned: () => {
      secondToggleCount += 1;
    },
  };
  const workspace = { activeLeaf: firstLeaf };
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = { workspace };
  plugin.vimMappingsRegistered = false;

  assert.equal(plugin.registerVimMappings(), true);
  assert.equal(plugin.registerVimMappings(), true);
  assert.deepEqual(mappings, [
    [
      "\\s",
      "action",
      "bobNavigationToggleCurrentTabPin",
      {},
      { context: "normal" },
    ],
  ]);
  assert.equal(mappings.some(([key]) => key === "\\p"), false);

  actions.get("bobNavigationToggleCurrentTabPin")(null, { repeat: 5 });
  assert.equal(firstToggleCount, 1);
  assert.equal(secondToggleCount, 0);

  workspace.activeLeaf = secondLeaf;
  assert.equal(plugin.toggleCurrentTabPin(), true);
  assert.equal(firstToggleCount, 1);
  assert.equal(secondToggleCount, 1);
});

test("tab pin toggle fails safely without a supported active leaf", () => {
  const plugin = new NavigationHotkeysPlugin();

  for (const app of [
    undefined,
    {},
    { workspace: {} },
    { workspace: { activeLeaf: {} } },
    {
      workspace: {
        activeLeaf: {
          togglePinned: () => {
            throw new Error("not available");
          },
        },
      },
    },
  ]) {
    plugin.app = app;
    assert.equal(plugin.toggleCurrentTabPin(), false);
  }
});

test("tab pin Vim registration retries after adapter availability", (t) => {
  const originalWindow = global.window;
  t.after(() => {
    if (originalWindow === undefined) {
      delete global.window;
    } else {
      global.window = originalWindow;
    }
  });

  let activeLeafChangeHandler = null;
  const removedRefs = [];
  const registeredRefs = [];
  const workspace = {
    onLayoutReady: (callback) => callback(),
    on: (event, callback) => {
      assert.equal(event, "active-leaf-change");
      activeLeafChangeHandler = callback;
      return { event, callback };
    },
    offref: (ref) => removedRefs.push(ref),
  };
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = { workspace };
  plugin.vimMappingsRegistered = false;
  plugin.registerEvent = (ref) => registeredRefs.push(ref);
  global.window = {};

  assert.equal(plugin.registerVimMappingsWhenReady(), true);
  assert.equal(typeof activeLeafChangeHandler, "function");
  assert.equal(registeredRefs.length, 1);

  const mappings = [];
  global.window.CodeMirrorAdapter = {
    Vim: {
      defineAction: () => {},
      mapCommand: (...args) => mappings.push(args),
    },
  };
  activeLeafChangeHandler();

  assert.equal(plugin.registerVimMappings(), true);
  assert.equal(mappings.length, 1);
  assert.equal(removedRefs.length, 1);
});
