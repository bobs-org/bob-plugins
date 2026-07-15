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
  assert.match(removed.content, /Child \[id:: projects__Here__child\] \^child/);

  const unrelated = helpers.planSameFileDependencyToggle(
    input.replace("[[#^child]]", "[[#^ref]]"),
    1,
    "  - ![[#^ref]]",
  );
  assert.equal(unrelated.qualified, false);
});

test("task status helpers rank and promote only supported real tasks", () => {
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
    "- [/] #task Parent [dependsOn:: Here__target] ^parent";
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
  assert.match(editor.content, /Parent \[dependsOn:: Other__target\] \^parent/);
  assert.match(targetContent, /- \[\/\] #task Target \[id:: Other__target\] \^target/);

  assert.equal(
    await plugin.applyDependencyAwareTransclusionChanges(editor, [
      { line: 1, nextLineText: "  - [[Other#^target]]" },
    ]),
    true,
  );
  assert.doesNotMatch(editor.content, /dependsOn/);
  assert.match(targetContent, /- \[\/\] #task Target \[id:: Other__target\] \^target/);
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
  assert.equal(targetContent, "- [ ] #task Target changed concurrently ^target");
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
  assert.match(editor.content, /Parent \[dependsOn:: Here__valid\]/);
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
  assert.match(editor.content, /Visible parent \[dependsOn:: Here__visible\]/);
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
  assert.match(editor.content, /Next parent \[dependsOn:: Here__shared\]/);
  assert.match(editor.content, /Working parent \[dependsOn:: Here__shared\]/);
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
