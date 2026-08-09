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
    class TestModal {
      constructor(app) {
        this.app = app;
        this.isOpen = false;
        this.modalEl = { removeClass: () => {} };
        this.contentEl = { empty: () => {} };
      }
      open() {
        this.isOpen = true;
        return this;
      }
      close() {
        if (!this.isOpen) {
          return this;
        }
        this.isOpen = false;
        if (typeof this.onClose === "function") {
          this.onClose();
        }
        return this;
      }
    }
    class TestNotice {
      constructor(message) {
        notices.push(String(message));
      }
    }
    return {
      MarkdownView: EmptyClass,
      Modal: TestModal,
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

function compatibleTasksSettings() {
  return {
    globalFilter: "#task",
    statusSettings: {
      coreStatuses: [],
      customStatuses: [
        {
          symbol: "?",
          name: "Blocked",
          nextStatusSymbol: " ",
          availableAsCommand: true,
          type: "ON_HOLD",
        },
      ],
    },
  };
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
        "- [/] #task Working ^working",
        "  - ![[#^graph]]",
        "- [?] #task Graph-derived ^graph",
        "- [?] #task Retired ^retired",
        "- [?] #task Canceled ^canceled",
        "- [?] #task Fenced ^fenced",
        "- [ ] #task Open dependency [id:: open] ^open",
        "- [?] #task Still blocked [dependsOn:: open] ^blocked",
        "- [?] #task Missing dependency [dependsOn:: missing] ^missing",
        "- [?] #task No block ID",
        "- [ ] #task Ordinary previous ^ordinary",
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
  assert.equal(statuses.at(-1), " ");
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
    },
    {
      name: "priority",
      values: "priority",
      schedules: "scheduled",
      levels: [
        { label: "P1", value: "high", minDays: 2, maxDays: 7 },
        { label: "P2", value: "medium", minDays: 8, maxDays: 30 },
      ],
      levelsByValue: new Map([
        ["high", { label: "P1", value: "high", minDays: 2, maxDays: 7 }],
        ["medium", { label: "P2", value: "medium", minDays: 8, maxDays: 30 }],
      ]),
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

test("bare future scheduled writes block only real supported open inline tasks", async () => {
  const cases = [
    ["- [ ] #task Ready [scheduled:: 2099-07-23] ^ready", "?"],
    ["- [*] #task Next ^next", "?"],
    ["- [/] #task Working ^working", "?"],
    ["- [?] #task Blocked ^blocked", "?"],
    ["- [x] #task Done ^done", "x"],
    ["- [-] #task Canceled ^canceled", "-"],
    ["- [!] #task Unknown ^unknown", "!"],
    ["- [ ] Plain checkbox", null],
    ["- ordinary bullet", null],
    ["- [ ] #task Project lifecycle ^prj", " "],
  ];
  for (const [line, expectedStatus] of cases) {
    notices.length = 0;
    const editor = new TransactionEditor(line, { line: 0, ch: 6 }, 333);
    const plugin = new NavigationHotkeysPlugin();
    assert.equal(
      await plugin.setBulletPropertyValue(
        editor,
        { line: 0, ch: 6 },
        "scheduled",
        "2099-07-23",
      ),
      true,
      line,
    );
    assert.match(editor.content, /\[scheduled:: 2099-07-23\]/, line);
    assert.equal(
      helpers.getObsidianTaskCheckboxStatus(editor.content),
      expectedStatus,
      line,
    );
    assert.equal(editor.getScrollInfo().top, 333);
    assert.deepEqual(editor.getCursor(), { line: 0, ch: 6 });
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

test("counted property runtime uses one transaction and preserves caret and viewport", async () => {
  notices.length = 0;
  const lines = [
    "- [ ] #task One [created:: 2026-07-01] ^one",
    "prose",
    "- [/] #task Two [scheduled:: 2026-07-20] ^two",
    "- plain bullet",
    "> - [x] #task Three [scheduled:: 2099-07-23] ^three",
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
    await plugin.setCountedBulletPropertyValue(
      editor,
      cursor,
      file.path,
      session,
      "scheduled",
      "2099-07-23",
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
  assert.match(editor.getLine(0), /\[\?\].*\[created:: 2026-07-01\].*\^one/);
  assert.match(editor.getLine(2), /\[\?\].*\[scheduled:: 2099-07-23\].*\^two/);
  assert.match(notices.at(-1), /2 tasks.*1 task unchanged.*2 tasks Blocked/);
});

test("bare due schedule recovery is guarded and can change only task status", async () => {
  notices.length = 0;
  const line =
    "- [?] #task Due [scheduled:: 2000-01-01] [dependsOn:: missing] ^due";
  const editor = new TransactionEditor(line, { line: 0, ch: 18 }, 611);
  const file = { path: "Tasks.md", extension: "md" };
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getLeavesOfType: () => [] },
    vault: {
      getMarkdownFiles: () => [file],
      cachedRead: async () => line,
      adapter: {
        read: async () => JSON.stringify(compatibleTasksSettings()),
      },
    },
  };
  plugin.getActiveMarkdownView = () => ({ editor, file });

  assert.equal(
    await plugin.setBulletPropertyValue(
      editor,
      { line: 0, ch: 18 },
      "scheduled",
      "2000-01-01",
      { filePath: file.path, expectedLine: line },
    ),
    true,
  );
  assert.equal(editor.transactions.length, 0);
  assert.match(editor.content, /- \[ \] #task Due/);
  assert.match(editor.content, /\[scheduled:: 2000-01-01\]/);
  assert.equal(editor.getScrollInfo().top, 611);
  assert.match(notices.at(-1), /recovered 1 task Ready/);
});

test("counted due recovery applies Ready Next and In Progress in one transaction", async () => {
  notices.length = 0;
  const source = [
    "- [?] #task Ready [scheduled:: 2000-01-01] ^ready",
    "- [?] #task Next [scheduled:: 2000-01-01] ^next",
    "- [?] #task Root [scheduled:: 2000-01-01] ^root",
    "  - ![[#^working]]",
    "- [/] #task Working ^working",
    "  - ![[#^graph]]",
    "- [?] #task Graph [scheduled:: 2000-01-01] ^graph",
  ].join("\r\n");
  const today = new Date();
  const year = String(today.getFullYear()).padStart(4, "0");
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  const dailyPath = `${year}/${year}${month}${day}.md`;
  const dailyContent = [
    "## Pomodoros",
    "",
    "- [ ] Current (0900-0930)",
    "  - [[Tasks#^next]]",
    "  - [[Tasks#^root]]",
  ].join("\n");
  const editor = new TransactionEditor(source, { line: 0, ch: 12 }, 701);
  const sourceFile = { path: "Tasks.md", extension: "md" };
  const dailyFile = { path: dailyPath, extension: "md" };
  const contents = new Map([
    [sourceFile.path, source],
    [dailyFile.path, dailyContent],
  ]);
  const session = helpers.discoverCountedObsidianTaskTargets(source, 0, 4);
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getLeavesOfType: () => [] },
    vault: {
      getMarkdownFiles: () => [sourceFile, dailyFile],
      cachedRead: async (file) => contents.get(file.path),
      adapter: {
        read: async () => JSON.stringify(compatibleTasksSettings()),
      },
    },
  };
  plugin.getActiveMarkdownView = () => ({ editor, file: sourceFile });

  assert.equal(
    await plugin.setCountedBulletPropertyValue(
      editor,
      { line: 0, ch: 12 },
      sourceFile.path,
      session,
      "scheduled",
      "2000-01-01",
    ),
    true,
  );
  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.undoGroups, 1);
  assert.deepEqual(
    editor.content
      .split(/\r?\n/)
      .filter((line) => helpers.isObsidianTaskLine(line))
      .map((line) => helpers.getObsidianTaskCheckboxStatus(line)),
    [" ", "*", "*", "/", "/"],
  );
  assert.match(
    notices.at(-1),
    /recovered 1 task Ready.*recovered 2 tasks Next.*recovered 1 task In Progress/,
  );
});

test("scheduled recovery aborts after an asynchronous source change", async () => {
  notices.length = 0;
  const source =
    "- [?] #task Due [scheduled:: 2000-01-01] ^due";
  const editor = new TransactionEditor(source, { line: 0, ch: 8 });
  const sourceFile = { path: "Tasks.md", extension: "md" };
  const otherFile = { path: "Other.md", extension: "md" };
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getLeavesOfType: () => [] },
    vault: {
      getMarkdownFiles: () => [sourceFile, otherFile],
      cachedRead: async () => {
        editor.content += "\nuser edit";
        return "- [ ] #task Other ^other";
      },
      adapter: {
        read: async () => JSON.stringify(compatibleTasksSettings()),
      },
    },
  };
  plugin.getActiveMarkdownView = () => ({ editor, file: sourceFile });

  assert.equal(
    await plugin.setBulletPropertyValue(
      editor,
      { line: 0, ch: 8 },
      "scheduled",
      "2000-01-01",
      { filePath: sourceFile.path, expectedLine: source },
    ),
    false,
  );
  assert.deepEqual(editor.transactions, []);
  assert.match(editor.content, /user edit/);
  assert.match(notices.at(-1), /changed/);
});

test("counted property runtime aborts a stale batch without a transaction", async () => {
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
    await plugin.setCountedBulletPropertyValue(
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

test("counted project scheduling is one structural transaction", async () => {
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
    await plugin.setCountedBulletPropertyValue(
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

test("single project scheduling recovers due tasks in one guarded transaction", async () => {
  notices.length = 0;
  const input = [
    "---",
    "type: [[project]]",
    "scheduled: 2099-01-01",
    "---",
    "- [ ] #task Ship #hide ^prj",
    "- [?] #task Ready [scheduled:: 2000-01-01] ^ready",
  ].join("\r\n");
  const cursor = { line: 4, ch: 12 };
  const editor = new TransactionEditor(input, cursor, 733);
  const file = { path: "projects/Ship.md", extension: "md" };
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getLeavesOfType: () => [] },
    vault: {
      getMarkdownFiles: () => [file],
      cachedRead: async () => input,
      adapter: {
        read: async () => JSON.stringify(compatibleTasksSettings()),
      },
    },
  };
  plugin.getActiveMarkdownView = () => ({ editor, file });

  assert.equal(
    await plugin.setProjectNoteScheduledValue(
      editor,
      cursor,
      file.path,
      input.split(/\r?\n/)[4],
      "2099-01-01",
      "2000-01-01",
    ),
    true,
  );
  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.undoGroups, 1);
  assert.deepEqual(editor.transactionScrollTops, [733]);
  assert.equal(editor.getScrollInfo().top, 733);
  assert.match(editor.content, /^scheduled: 2000-01-01$/m);
  assert.match(
    editor.content,
    /- \[ \] #task Ready \[scheduled:: 2000-01-01\] \^ready/,
  );
  assert.match(notices.at(-1), /recovered 1 task Ready/);
});

test("single project schedule deletion removes propagated fields and recovers", async () => {
  notices.length = 0;
  const input = [
    "---",
    "type: [[project]]",
    "scheduled: 2099-01-01",
    "---",
    "- [ ] #task Ship #hide ^prj",
    "- [?] #task Ready [scheduled:: 2099-01-01] ^ready",
    "- [?] #task Own later [scheduled:: 2099-01-02] ^later",
  ].join("\n");
  const cursor = { line: 4, ch: 12 };
  const editor = new TransactionEditor(input, cursor, 744);
  const file = { path: "projects/Ship.md", extension: "md" };
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getLeavesOfType: () => [] },
    vault: {
      getMarkdownFiles: () => [file],
      cachedRead: async () => input,
      adapter: {
        read: async () => JSON.stringify(compatibleTasksSettings()),
      },
    },
  };
  plugin.getActiveMarkdownView = () => ({ editor, file });

  const result = await plugin.deleteProjectNoteScheduledValue(
    editor,
    cursor,
    file.path,
    input.split("\n")[4],
    "2099-01-01",
  );
  assert.equal(result.deleted, true);
  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.undoGroups, 1);
  assert.deepEqual(editor.transactionScrollTops, [744]);
  assert.doesNotMatch(editor.content, /^scheduled:/m);
  assert.match(editor.content, /- \[ \] #task Ready \^ready/);
  assert.match(
    editor.content,
    /- \[\?\] #task Own later \[scheduled:: 2099-01-02\] \^later/,
  );
  assert.match(
    notices.at(-1),
    /removed propagated schedule from 1 task.*recovered 1 task Ready/,
  );
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

function createTaskMovePickerHarness() {
  const sourceFile = {
    path: "Source.md",
    basename: "Source",
    extension: "md",
  };
  const destinationFile = {
    path: "Area.md",
    basename: "Area",
    extension: "md",
  };
  const editor = new TransactionEditor(
    [
      "- [ ] #task One ^one",
      "- [ ] #task Two ^two",
      "- [ ] #task Three ^three",
    ].join("\n"),
    { line: 0, ch: 0 },
  );
  const view = { editor, file: sourceFile };
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    metadataCache: {
      getFileCache: (file) =>
        file.path === destinationFile.path
          ? { frontmatter: { type: "[[area]]" } }
          : null,
    },
    vault: {
      getMarkdownFiles: () => [sourceFile, destinationFile],
    },
  };
  plugin.commitTaskMoveSession = async () => true;
  return { editor, plugin, view };
}

function createTaskMoveDestinationFocusHarness(options = {}) {
  const plugin = new NavigationHotkeysPlugin();
  const captureCalls = [];
  plugin.captureActiveFilePosition = () => {
    captureCalls.push(true);
    return true;
  };
  const openCalls = [];
  plugin.openMarkdownFileWithLeafReuse = async (file, failureNotice) => {
    openCalls.push({ file, failureNotice });
    return options.openResult === undefined ? true : options.openResult;
  };
  plugin.getActiveMarkdownView =
    options.getActiveMarkdownView || (() => null);
  return { plugin, captureCalls, openCalls };
}

function createBulletPropertyPickerHarness(harnessOptions = {}) {
  const editor = new TransactionEditor(
    harnessOptions.content ||
      [
        "- [ ] #task One ^one",
        "- [ ] #task Two ^two",
        "- [ ] #task Three ^three",
      ].join("\n"),
    harnessOptions.cursor || { line: 0, ch: 0 },
  );
  const file = harnessOptions.file || {
    path: "Tasks.md",
    basename: "Tasks",
    extension: "md",
  };
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = harnessOptions.app || {};
  plugin.getActiveMarkdownView = () => ({ editor, file });
  const config =
    harnessOptions.config ||
    helpers.validateBulletPropertyConfig({
      properties: [{ name: "p", values: ["high"] }],
    });
  const open = (options = {}) =>
    plugin.openBulletPropertyPicker(editor, {
      config,
      random: options.random || harnessOptions.random,
      baseDate: options.baseDate || harnessOptions.baseDate,
      ...options,
    });
  return { config, editor, file, open, plugin };
}

function createPriorityPickerConfig() {
  return helpers.validateBulletPropertyConfig({
    properties: [
      { name: "scheduled", values: "date" },
      {
        name: "priority",
        values: "priority",
        schedules: "scheduled",
        levels: [
          { label: "P1", value: "high", min_days: 2, max_days: 7 },
          { label: "P2", value: "medium", min_days: 8, max_days: 30 },
          { label: "P3", value: "low", min_days: 31, max_days: 90 },
          { label: "P4", value: "lowest", min_days: 91, max_days: 365 },
        ],
      },
    ],
  });
}

async function choosePriorityLevel(harness, label) {
  assert.equal(harness.open(), true);
  const picker = harness.plugin.activeBulletPropertyPicker;
  const propertyIndex = picker.visibleItems.findIndex(
    (item) => item.property.name === "priority",
  );
  assert.notEqual(propertyIndex, -1);
  await picker.openItemAtIndex(propertyIndex);
  const levelIndex = picker.visibleItems.findIndex(
    (item) => item.label === label,
  );
  assert.notEqual(levelIndex, -1);
  await picker.openItemAtIndex(levelIndex);
  return picker;
}

function createFragmentNode(tag = "fragment", spec = {}) {
  const node = {
    tag,
    attrs: {},
    classes: [],
    children: [],
    text: "",
    classList: {
      add: (...classes) => {
        for (const cls of classes.flatMap((item) =>
          String(item || "").split(/\s+/),
        )) {
          if (cls && !node.classes.includes(cls)) {
            node.classes.push(cls);
          }
        }
      },
    },
    createDiv(childSpec = {}) {
      return createFragmentChild(node, "div", childSpec);
    },
    createSpan(childSpec = {}) {
      return createFragmentChild(node, "span", childSpec);
    },
    appendText(text) {
      const child = createFragmentNode("text");
      child.text = String(text);
      node.children.push(child);
      node.text += child.text;
    },
    setText(text) {
      node.children = [];
      node.text = "";
      node.appendText(text);
    },
    setAttr(name, value) {
      node.attrs[name] = String(value);
    },
  };
  applyFragmentSpec(node, spec);
  return node;
}

function createFragmentChild(parent, tag, spec) {
  const child = createFragmentNode(tag, spec);
  parent.children.push(child);
  return child;
}

function applyFragmentSpec(node, spec) {
  if (typeof spec === "string") {
    node.classList.add(spec);
    return;
  }
  if (!spec || typeof spec !== "object") {
    return;
  }
  if (spec.cls) {
    node.classList.add(spec.cls);
  }
  if (spec.attr) {
    for (const [name, value] of Object.entries(spec.attr)) {
      node.setAttr(name, value);
    }
  }
  if (spec.text !== undefined) {
    node.setText(spec.text);
  }
}

function findFragmentNode(node, predicate) {
  if (predicate(node)) {
    return node;
  }
  for (const child of node.children || []) {
    const match = findFragmentNode(child, predicate);
    if (match) {
      return match;
    }
  }
  return null;
}

function collectFragmentNodes(node, predicate, matches = []) {
  if (predicate(node)) {
    matches.push(node);
  }
  for (const child of node.children || []) {
    collectFragmentNodes(child, predicate, matches);
  }
  return matches;
}

function nodeHasClass(className) {
  return (node) => node.classes && node.classes.includes(className);
}

async function openBulletPropertyValueStage(harness, propertyName, options = {}) {
  assert.equal(harness.open(options), true);
  const picker = harness.plugin.activeBulletPropertyPicker;
  const propertyIndex = picker.visibleItems.findIndex(
    (item) => item.property.name === propertyName,
  );
  assert.notEqual(propertyIndex, -1);
  await picker.openItemAtIndex(propertyIndex);
  return picker;
}

// Complete the reason-stage prompt through the same openItemAtIndex entry
// point production code uses. The test harness never calls onOpen(), so
// resultsEl stays unset and renderAll() never refreshes visibleItems; refresh
// it manually here the way renderResults() would.
async function confirmScheduleReasonStage(picker, reasonText = "") {
  assert.equal(picker.stage, "reason");
  picker.inputEl = { value: reasonText };
  picker.visibleItems = picker.getFilteredItems();
  return await picker.openItemAtIndex(0);
}

test("priority notice relative day helpers handle offsets ranges and icons", () => {
  assert.equal(
    helpers.getLocalDayOffset(new Date(2026, 7, 3, 23), new Date(2026, 7, 3)),
    0,
  );
  assert.equal(
    helpers.getLocalDayOffset(new Date(2026, 7, 3), new Date(2026, 7, 4)),
    1,
  );
  assert.equal(
    helpers.getLocalDayOffset(new Date(2026, 7, 3), new Date(2026, 8, 14)),
    42,
  );
  assert.equal(
    helpers.getLocalDayOffset(new Date(2026, 2, 7), new Date(2026, 2, 14)),
    7,
  );

  assert.equal(helpers.formatRelativeDayOffset(0), "today");
  assert.equal(helpers.formatRelativeDayOffset(1), "tomorrow");
  assert.equal(helpers.formatRelativeDayOffset(2), "in 2 days");
  assert.equal(helpers.formatRelativeDayOffset(42), "in 42 days");
  assert.equal(helpers.formatRelativeDayOffset(-1), "yesterday");
  assert.equal(helpers.formatRelativeDayOffset(-3), "3 days ago");

  assert.equal(helpers.formatRelativeDayRange(3, 3), "in 3 days");
  assert.equal(helpers.formatRelativeDayRange(2, 7), "in 2–7 days");
  assert.equal(helpers.formatRelativeDayRange(0, 7), "today to in 7 days");

  assert.equal(helpers.getPriorityLevelIconName(0), "signal-high");
  assert.equal(helpers.getPriorityLevelIconName(1), "signal-medium");
  assert.equal(helpers.getPriorityLevelIconName(2), "signal-low");
  assert.equal(helpers.getPriorityLevelIconName(3), "signal-zero");
  assert.equal(helpers.getPriorityLevelIconName(9), "signal-zero");
});

test("priority notice model summarizes single counted and project writes", () => {
  const property = createPriorityPickerConfig().properties.find(
    (item) => item.name === "priority",
  );
  const level = property.levels[0];
  const baseDate = new Date(2026, 7, 3);

  const single = helpers.buildPriorityNoticeModel({
    property,
    level,
    levelIndex: 0,
    baseDate,
    scheduledValues: ["2026-08-06"],
    taskCount: 1,
    scope: "task",
    outcome: { blockedTaskCount: 1, scheduleLoggedTaskCount: 1 },
  });
  assert.deepEqual(
    {
      iconName: single.iconName,
      pill: single.pill,
      countPill: single.countPill,
      receipt: single.receipt,
      dateLabel: single.dateLabel,
      dateText: single.dateText,
      exactDateText: single.exactDateText,
      dateStartText: single.dateStartText,
      dateEndText: single.dateEndText,
      weekdayText: single.weekdayText,
      textDateText: single.textDateText,
      relativeText: single.relativeText,
      chips: single.chips,
      text: single.text,
    },
    {
      iconName: "signal-high",
      pill: "P1",
      countPill: "",
      receipt: "[priority:: high]",
      dateLabel: "scheduled",
      dateText: "2026-08-06 · Thu",
      exactDateText: "2026-08-06",
      dateStartText: "2026-08-06",
      dateEndText: "",
      weekdayText: "Thu",
      textDateText: "2026-08-06 · Thu",
      relativeText: "in 3 days",
      chips: [
        { text: "logged", tone: "info" },
        { text: "Blocked", tone: "warn" },
      ],
      text: "priority → P1 (high); scheduled → 2026-08-06 · Thu · in 3 days; logged reason; marked task Blocked",
    },
  );

  const counted = helpers.buildPriorityNoticeModel({
    property,
    level,
    levelIndex: 0,
    baseDate,
    scheduledValues: ["2026-08-10", "2026-08-05", "2026-08-08"],
    taskCount: 3,
    scope: "counted",
    outcome: {
      blockedTaskCount: 3,
      unchangedTaskCount: 1,
      session: { clamped: true, requestedCount: 5, actualCount: 3 },
      scheduleLoggedTaskCount: 3,
    },
  });
  assert.equal(counted.countPill, "3 tasks");
  assert.equal(counted.dateText, "2026-08-05 to 2026-08-10");
  assert.equal(counted.exactDateText, "2026-08-05 → 2026-08-10");
  assert.equal(counted.dateStartText, "2026-08-05");
  assert.equal(counted.dateEndText, "2026-08-10");
  assert.equal(counted.weekdayText, "");
  assert.equal(counted.textDateText, "2026-08-05 to 2026-08-10");
  assert.equal(counted.relativeText, "in 2–7 days");
  assert.deepEqual(counted.chips, [
    { text: "1 task unchanged", tone: "muted" },
    { text: "requested 5, found 3 at end of note", tone: "muted" },
    { text: "3 logged", tone: "info" },
    { text: "3 Blocked", tone: "warn" },
  ]);
  assert.equal(
    counted.text,
    "priority → P1 (high) on 3 tasks; scheduled → 2026-08-05 to 2026-08-10 · in 2–7 days; 1 task unchanged; requested 5, found 3 at end of note; logged reason on 3 tasks; marked 3 tasks Blocked",
  );

  const project = helpers.buildPriorityNoticeModel({
    property,
    level,
    levelIndex: 0,
    baseDate,
    scheduledValues: ["2026-08-05"],
    taskCount: 1,
    scope: "project",
    outcome: {
      scheduledTaskCount: 4,
      removedHideTaskCount: 2,
      blockedTaskCount: 4,
      recoveryCounts: { ready: 1 },
    },
  });
  assert.equal(project.dateLabel, "scheduled (project)");
  assert.equal(project.dateText, "2026-08-05 · Wed");
  assert.equal(project.exactDateText, "2026-08-05");
  assert.equal(project.dateStartText, "2026-08-05");
  assert.equal(project.dateEndText, "");
  assert.equal(project.weekdayText, "Wed");
  assert.equal(project.textDateText, "2026-08-05 · Wed");
  assert.equal(project.relativeText, "in 2 days");
  assert.deepEqual(project.chips, [
    { text: "scheduled 4 tasks", tone: "info" },
    { text: "removed #hide from 2 tasks", tone: "info" },
    { text: "4 Blocked", tone: "warn" },
    { text: "recovered 1 task Ready", tone: "ok" },
  ]);
  assert.equal(
    project.text,
    "priority → P1 (high); scheduled → 2026-08-05 · Wed · in 2 days; scheduled 4 tasks; removed #hide from 2 tasks; marked 4 tasks Blocked; recovered 1 task Ready",
  );

  const sameDayCounted = helpers.buildPriorityNoticeModel({
    property,
    level,
    baseDate,
    scheduledValues: ["2026-08-05", "2026-08-05"],
    taskCount: 2,
    scope: "counted",
  });
  assert.equal(sameDayCounted.dateText, "2026-08-05 · Wed");
  assert.equal(sameDayCounted.exactDateText, "2026-08-05");
  assert.equal(sameDayCounted.dateStartText, "2026-08-05");
  assert.equal(sameDayCounted.dateEndText, "");
  assert.equal(sameDayCounted.weekdayText, "Wed");
  assert.equal(sameDayCounted.relativeText, "in 2 days");

  const invalidDate = helpers.buildPriorityNoticeModel({
    property,
    level,
    baseDate,
    scheduledValues: ["not-a-date"],
    taskCount: 1,
    scope: "task",
  });
  assert.equal(invalidDate.dateText, "not-a-date");
  assert.equal(invalidDate.exactDateText, "not-a-date");
  assert.equal(invalidDate.dateStartText, "not-a-date");
  assert.equal(invalidDate.dateEndText, "");
  assert.equal(invalidDate.weekdayText, "");
  assert.equal(invalidDate.relativeText, "");
  assert.doesNotMatch(invalidDate.text, /NaN/);
});

test("priority notice renderer builds an accessible fragment", () => {
  const property = createPriorityPickerConfig().properties.find(
    (item) => item.name === "priority",
  );
  const model = helpers.buildPriorityNoticeModel({
    property,
    level: property.levels[0],
    levelIndex: 0,
    baseDate: new Date(2026, 7, 3),
    scheduledValues: ["2026-08-06"],
    taskCount: 1,
    scope: "task",
    outcome: { blockedTaskCount: 1 },
  });
  const root = createFragmentNode();

  helpers.renderPriorityNoticeFragment(model, root);

  const card = findFragmentNode(root, nodeHasClass("bob-nh-notice"));
  assert.ok(card);
  assert.ok(card.classes.includes("is-level-0"));
  assert.equal(card.attrs["aria-label"], model.text);
  assert.equal(
    findFragmentNode(root, nodeHasClass("bob-nh-notice-relative")).text,
    "in 3 days",
  );
  assert.equal(
    findFragmentNode(root, nodeHasClass("bob-nh-notice-date-label")).text,
    "scheduled",
  );
  assert.equal(
    findFragmentNode(root, nodeHasClass("bob-nh-notice-date-iso")).text,
    "2026-08-06",
  );
  assert.equal(
    findFragmentNode(root, nodeHasClass("bob-nh-notice-date-weekday")).text,
    "Thu",
  );
  assert.match(card.attrs["aria-label"], /2026-08-06/);
  assert.equal(
    findFragmentNode(root, nodeHasClass("bob-nh-notice-chip")).text,
    "Blocked",
  );

  const rangeRoot = createFragmentNode();
  helpers.renderPriorityNoticeFragment(
    helpers.buildPriorityNoticeModel({
      property,
      level: property.levels[0],
      levelIndex: 0,
      baseDate: new Date(2026, 7, 3),
      scheduledValues: ["2026-08-10", "2026-08-05", "2026-08-08"],
      taskCount: 3,
      scope: "counted",
    }),
    rangeRoot,
  );
  assert.deepEqual(
    collectFragmentNodes(
      rangeRoot,
      nodeHasClass("bob-nh-notice-date-iso"),
    ).map((node) => node.text),
    ["2026-08-05", "2026-08-10"],
  );
  const rangeArrow = findFragmentNode(
    rangeRoot,
    nodeHasClass("bob-nh-notice-date-arrow"),
  );
  assert.equal(rangeArrow.text, "→");
  assert.equal(rangeArrow.attrs["aria-hidden"], "true");
  const rangeCard = findFragmentNode(rangeRoot, nodeHasClass("bob-nh-notice"));
  assert.match(rangeCard.attrs["aria-label"], /2026-08-05/);
  assert.match(rangeCard.attrs["aria-label"], /2026-08-10/);

  const noChipRoot = createFragmentNode();
  helpers.renderPriorityNoticeFragment(
    helpers.buildPriorityNoticeModel({
      property,
      level: property.levels[1],
      levelIndex: 1,
      baseDate: new Date(2026, 7, 3),
      scheduledValues: ["2026-08-05"],
      taskCount: 1,
      scope: "project",
    }),
    noChipRoot,
  );
  assert.equal(
    findFragmentNode(noChipRoot, nodeHasClass("bob-nh-notice-date-label")).text,
    "scheduled (project)",
  );
  assert.equal(
    findFragmentNode(noChipRoot, nodeHasClass("bob-nh-notice-chips")),
    null,
  );

  const fourthModel = helpers.buildPriorityNoticeModel({
    property,
    level: property.levels[3],
    levelIndex: 3,
    baseDate: new Date(2026, 7, 3),
    scheduledValues: ["2026-11-02"],
    taskCount: 1,
    scope: "task",
  });
  assert.equal(fourthModel.iconName, "signal-zero");
  const fourthRoot = createFragmentNode();
  helpers.renderPriorityNoticeFragment(fourthModel, fourthRoot);
  const fourthCard = findFragmentNode(
    fourthRoot,
    nodeHasClass("bob-nh-notice"),
  );
  assert.ok(fourthCard.classes.includes("is-level-3"));

  const invalidRoot = createFragmentNode();
  const longInvalidReceipt =
    "not-a-date-with-a-very-long-raw-receipt-value-2026-08-what";
  const invalidModel = helpers.buildPriorityNoticeModel({
    property,
    level: property.levels[2],
    levelIndex: 2,
    baseDate: new Date(2026, 7, 3),
    scheduledValues: [longInvalidReceipt],
    taskCount: 1,
    scope: "task",
  });
  helpers.renderPriorityNoticeFragment(invalidModel, invalidRoot);
  assert.equal(
    findFragmentNode(invalidRoot, nodeHasClass("bob-nh-notice-date-iso")).text,
    longInvalidReceipt,
  );
  assert.equal(
    findFragmentNode(invalidRoot, nodeHasClass("bob-nh-notice-relative")),
    null,
  );
  const invalidCard = findFragmentNode(
    invalidRoot,
    nodeHasClass("bob-nh-notice"),
  );
  assert.match(invalidCard.attrs["aria-label"], /not-a-date-with-a-very-long/);
  assert.doesNotMatch(invalidCard.attrs["aria-label"], /NaN/);
});

test("priority notice stylesheet scopes Obsidian notice overrides and uses theme tokens", () => {
  const stylesPath = path.join(
    __dirname,
    "../plugins/bob-navigation-hotkeys/styles.css",
  );
  const styles = fs.readFileSync(stylesPath, "utf8");
  const noticeClassPattern = /(^|[^\w-])\.notice(?![\w-])/;
  const unscopedNoticeSelectors = [...styles.matchAll(/([^{}]+)\{/g)]
    .map((match) => match[1].trim())
    .filter((selector) => noticeClassPattern.test(selector))
    .filter((selector) => !selector.includes(".bob-nh-notice"));

  assert.deepEqual(unscopedNoticeSelectors, []);

  const marker = "/* --- Priority notice";
  const priorityNoticeStart = styles.indexOf(marker);
  assert.notEqual(priorityNoticeStart, -1);
  const priorityNoticeStyles = styles.slice(priorityNoticeStart);

  assert.doesNotMatch(priorityNoticeStyles, /#[0-9a-f]{6}\b/i);
  assert.doesNotMatch(priorityNoticeStyles, /\brgb\(/i);
  assert.doesNotMatch(priorityNoticeStyles, /\bhsl\(/i);
});

test("priority notice falls back to one plain notice without a DOM", () => {
  notices.length = 0;
  const property = createPriorityPickerConfig().properties.find(
    (item) => item.name === "priority",
  );
  const model = helpers.buildPriorityNoticeModel({
    property,
    level: property.levels[0],
    baseDate: new Date(2026, 7, 3),
    scheduledValues: ["2026-08-06"],
    taskCount: 1,
    scope: "task",
  });

  helpers.showPriorityNotice(model);

  assert.deepEqual(notices, [model.text]);
});

test("priority notice falls back to plain text when fragment rendering fails", () => {
  notices.length = 0;
  const property = createPriorityPickerConfig().properties.find(
    (item) => item.name === "priority",
  );
  const model = helpers.buildPriorityNoticeModel({
    property,
    level: property.levels[0],
    baseDate: new Date(2026, 7, 3),
    scheduledValues: ["2026-08-06"],
    taskCount: 1,
    scope: "task",
  });
  const previousDocument = global.document;
  global.document = {
    createDocumentFragment: () => ({
      createDiv: () => {
        throw new Error("render failed");
      },
    }),
  };
  try {
    helpers.showPriorityNotice(model);
  } finally {
    if (previousDocument === undefined) {
      delete global.document;
    } else {
      global.document = previousDocument;
    }
  }

  assert.deepEqual(notices, [model.text]);
});

test("priority scheduling rolls inclusively and clamps a random value of one", () => {
  const level = { minDays: 2, maxDays: 7 };
  const baseDate = new Date(2026, 7, 3, 16, 45);
  const roll = (random) => {
    const result = helpers.rollPriorityScheduledDateWithOffset(
      level,
      baseDate,
      random,
    );
    return {
      date: helpers.formatBulletPropertyDate(result.date),
      offset: result.offset,
    };
  };

  assert.deepEqual(roll(() => 0), { date: "2026-08-05", offset: 2 });
  assert.deepEqual(roll(() => 0.5), { date: "2026-08-08", offset: 5 });
  assert.deepEqual(roll(() => 0.999999), { date: "2026-08-10", offset: 7 });
  assert.deepEqual(roll(() => 1), { date: "2026-08-10", offset: 7 });

  let calls = 0;
  assert.deepEqual(
    roll(() => {
      calls += 1;
      return 0.5;
    }),
    { date: "2026-08-08", offset: 5 },
  );
  assert.equal(calls, 1);
  assert.equal(
    helpers.formatBulletPropertyDate(
      helpers.rollPriorityScheduledDate(level, baseDate, () => 0),
    ),
    "2026-08-05",
  );

  const wideLevel = createPriorityPickerConfig().properties
    .find((item) => item.name === "priority")
    .levels[3];
  const wideRoll = (random) => {
    const result = helpers.rollPriorityScheduledDateWithOffset(
      wideLevel,
      new Date(2026, 7, 3),
      random,
    );
    return {
      date: helpers.formatBulletPropertyDate(result.date),
      offset: result.offset,
    };
  };
  assert.deepEqual(wideRoll(() => 0), { date: "2026-11-02", offset: 91 });
  assert.deepEqual(wideRoll(() => 0.999999), {
    date: "2027-08-03",
    offset: 365,
  });
});

test("priority value rows preserve config order and expose labels ranges and current state", () => {
  const config = createPriorityPickerConfig();
  const property = config.properties.find((item) => item.name === "priority");
  const items = helpers.createBulletPropertyValueItems(
    { property, currentValue: "medium" },
    new Date(2026, 7, 3),
  );

  assert.deepEqual(
    items.map((item) => ({
      label: item.label,
      value: item.value,
      detail: item.detail,
      searchText: item.searchText,
      current: item.current,
      priorityLevel: item.priorityLevel,
    })),
    [
      {
        label: "P1",
        value: "high",
        detail: "high · in 2–7 days",
        searchText: "P1 high 2–7 days",
        current: false,
        priorityLevel: property.levels[0],
      },
      {
        label: "P2",
        value: "medium",
        detail: "medium · in 8–30 days",
        searchText: "P2 medium 8–30 days",
        current: true,
        priorityLevel: property.levels[1],
      },
      {
        label: "P3",
        value: "low",
        detail: "low · in 31–90 days",
        searchText: "P3 low 31–90 days",
        current: false,
        priorityLevel: property.levels[2],
      },
      {
        label: "P4",
        value: "lowest",
        detail: "lowest · in 91–365 days",
        searchText: "P4 lowest 91–365 days",
        current: false,
        priorityLevel: property.levels[3],
      },
    ],
  );

  const propertyItems = helpers.createBulletPropertyItems(
    config,
    "- [ ] #task One [priority:: medium] ^one",
  );
  assert.equal(
    propertyItems.find((item) => item.property.name === "priority").currentLabel,
    "P2",
  );
});

test("priority picker writes priority then rolled schedule in one guarded edit", async () => {
  notices.length = 0;
  const harness = createBulletPropertyPickerHarness({
    config: createPriorityPickerConfig(),
    content: "- [ ] #task One ^one",
    baseDate: new Date(2026, 7, 3),
    random: () => 0,
  });

  const picker = await choosePriorityLevel(harness, "P1");

  assert.equal(picker.headerIcon, "signal-high");
  assert.equal(picker.placeholder, "Filter priorities");
  assert.equal(picker.resultsLabel, "priority levels");
  assert.match(
    harness.editor.content,
    /- \[\?\] #task One \[priority:: high\] \[scheduled:: 2026-08-05\] \^one/,
  );
  assert.deepEqual(notices, [
    "priority → P1 (high); scheduled → 2026-08-05 · Wed · in 2 days; logged reason; marked task Blocked",
  ]);
});

test("priority picker writes lowest priority with a wide rolled schedule", async () => {
  notices.length = 0;
  const harness = createBulletPropertyPickerHarness({
    config: createPriorityPickerConfig(),
    content: "- [ ] #task One ^one",
    baseDate: new Date(2026, 7, 3),
    random: () => 0,
  });

  await choosePriorityLevel(harness, "P4");

  assert.equal(
    harness.editor.content,
    [
      "- [?] #task One [priority:: lowest] [scheduled:: 2026-11-02] ^one",
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-11-02* — 🎲 P0 → P4 · in **91** (91–365) days",
    ].join("\n"),
  );
  assert.deepEqual(notices, [
    "priority → P4 (lowest); scheduled → 2026-11-02 · Mon · in 91 days; logged reason; marked task Blocked",
  ]);
});

test("priority picker replaces both existing values without duplicating fields", async () => {
  notices.length = 0;
  const harness = createBulletPropertyPickerHarness({
    config: createPriorityPickerConfig(),
    content:
      "- [ ] #task One [priority:: medium] [scheduled:: 2026-09-01] ^one",
    baseDate: new Date(2026, 7, 3),
    random: () => 0.5,
  });

  await choosePriorityLevel(harness, "P1");

  assert.equal((harness.editor.content.match(/\[priority::/g) || []).length, 1);
  assert.equal((harness.editor.content.match(/\[scheduled::/g) || []).length, 1);
  // The rolled date must stay to the right of the priority: Tasks-format
  // parsers read trailing inline fields right to left and stop at the first
  // unrecognized one, so a level value outside Tasks' own priority names would
  // otherwise hide the date from every query.
  assert.equal(
    harness.editor.content,
    [
      "- [?] #task One [priority:: high] [scheduled:: 2026-08-08] ^one",
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-09-01 → 2026-08-08* — 🎲 P2 → P1 · in **5** (2–7) days",
    ].join("\n"),
  );
});

test("counted priority writes keep the rolled date right of the priority", async () => {
  notices.length = 0;
  const harness = createBulletPropertyPickerHarness({
    config: createPriorityPickerConfig(),
    content: "- [ ] #task One [scheduled:: 2026-09-01] [id:: one] ^one",
    baseDate: new Date(2026, 7, 3),
    random: () => 0.5,
  });

  assert.equal(harness.open({ countExplicit: true }), true);
  const picker = harness.plugin.activeBulletPropertyPicker;
  await picker.openItemAtIndex(
    picker.visibleItems.findIndex((item) => item.property.name === "priority"),
  );
  await picker.openItemAtIndex(
    picker.visibleItems.findIndex((item) => item.label === "P1"),
  );

  assert.equal(
    harness.editor.content,
    [
      "- [?] #task One [id:: one] [priority:: high] [scheduled:: 2026-08-08] ^one",
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-09-01 → 2026-08-08* — 🎲 P0 → P1 · in **5** (2–7) days",
    ].join("\n"),
  );
});

test("priority picker writes project priority inline and schedule to frontmatter atomically", async () => {
  notices.length = 0;
  const content = [
    "---",
    "type: [[project]]",
    "---",
    "- [ ] #task Ship ^prj",
  ].join("\n");
  const harness = createBulletPropertyPickerHarness({
    config: createPriorityPickerConfig(),
    content,
    cursor: { line: 3, ch: 12 },
    file: {
      path: "projects/Ship.md",
      basename: "Ship",
      extension: "md",
    },
    baseDate: new Date(2026, 7, 3),
    random: () => 0,
  });

  await choosePriorityLevel(harness, "P1");

  assert.equal(harness.editor.transactions.length, 1);
  assert.match(harness.editor.content, /^scheduled: 2026-08-05$/m);
  assert.match(harness.editor.content, /#task Ship.*\[priority:: high\] \^prj/);
  assert.doesNotMatch(harness.editor.content, /#task Ship.*\[scheduled::/);
  assert.equal(notices.length, 1);
  assert.match(
    notices[0],
    /^priority → P1 \(high\); scheduled → 2026-08-05 · Wed · in 2 days/,
  );
});

test("counted priority picker rolls an independent schedule for every task", async () => {
  notices.length = 0;
  const rolls = [0, 0.5, 0.999999];
  const harness = createBulletPropertyPickerHarness({
    config: createPriorityPickerConfig(),
    baseDate: new Date(2026, 7, 3),
    random: () => rolls.shift(),
  });

  assert.equal(
    harness.open({ countExplicit: true, additionalTaskCount: 2 }),
    true,
  );
  const picker = harness.plugin.activeBulletPropertyPicker;
  const propertyIndex = picker.visibleItems.findIndex(
    (item) => item.property.name === "priority",
  );
  await picker.openItemAtIndex(propertyIndex);
  const levelIndex = picker.visibleItems.findIndex(
    (item) => item.label === "P1",
  );
  await picker.openItemAtIndex(levelIndex);

  assert.equal(harness.editor.transactions.length, 1);
  const lines = harness.editor.content.split("\n");
  const taskLines = lines.filter((line) => line.includes("#task"));
  assert.deepEqual(
    taskLines.map((line) => ({
      status: helpers.getObsidianTaskCheckboxStatus(line),
      priority: helpers.findBulletPropertyField(line, "priority").value,
      scheduled: helpers.findBulletPropertyField(line, "scheduled").value,
    })),
    [
      { status: "?", priority: "high", scheduled: "2026-08-05" },
      { status: "?", priority: "high", scheduled: "2026-08-08" },
      { status: "?", priority: "high", scheduled: "2026-08-10" },
    ],
  );
  assert.deepEqual(
    lines.filter((line) => line.includes("🎲")),
    [
      "\t\t- *2026-08-05* — 🎲 P0 → P1 · in **2** (2–7) days",
      "\t\t- *2026-08-08* — 🎲 P0 → P1 · in **5** (2–7) days",
      "\t\t- *2026-08-10* — 🎲 P0 → P1 · in **7** (2–7) days",
    ],
  );
  assert.deepEqual(notices, [
    "priority → P1 (high) on 3 tasks; scheduled → 2026-08-05 to 2026-08-10 · in 2–7 days; logged reason on 3 tasks; marked 3 tasks Blocked",
  ]);
});

test("counted priority planning keeps project schedules in frontmatter", () => {
  const input = [
    "---",
    "type: [[project]]",
    "---",
    "- [ ] #task Ship ^prj",
    "- [/] #task Follow up ^follow",
  ].join("\r\n");
  const session = helpers.discoverCountedObsidianTaskTargets(input, 3, 1);
  const plan = helpers.planCountedBulletPropertyBatch(
    input,
    session,
    "priority",
    null,
    {
      operation: "set-priority",
      priorityValue: "high",
      scheduledPropertyName: "scheduled",
      scheduledValueByLine: new Map([
        [3, "2026-08-05"],
        [4, "2026-08-08"],
      ]),
      today: new Date(2026, 7, 3),
    },
  );

  assert.equal(plan.valid, true);
  assert.match(plan.content, /^scheduled: 2026-08-05$/m);
  assert.match(plan.content, /#task Ship.*\[priority:: high\].*\^prj/);
  assert.doesNotMatch(plan.content, /#task Ship.*\[scheduled::/);
  assert.match(
    plan.content,
    /#task Follow up.*\[priority:: high\] \[scheduled:: 2026-08-08\].*\^follow/,
  );
  assert.equal(plan.scheduleLoggedTaskCount, 0);
});

test("counted priority planning evaluates Blocked recovery per rolled date", () => {
  const input = [
    "- [?] #task Due [scheduled:: 2099-01-01] ^due",
    "- [ ] #task Future ^future",
  ].join("\n");
  const session = helpers.discoverCountedObsidianTaskTargets(input, 0, 1);
  const plan = helpers.planCountedBulletPropertyBatch(
    input,
    session,
    "priority",
    null,
    {
      operation: "set-priority",
      priorityValue: "high",
      scheduledPropertyName: "scheduled",
      scheduledValueByLine: new Map([
        [0, "2026-08-03"],
        [1, "2026-08-04"],
      ]),
      today: new Date(2026, 7, 3),
      recoveryByLine: new Map([[0, { state: "ready", rank: " " }]]),
    },
  );

  assert.equal(plan.valid, true);
  assert.deepEqual(
    plan.content
      .split("\n")
      .map((line) => helpers.getObsidianTaskCheckboxStatus(line)),
    [" ", "?"],
  );
  assert.equal(plan.recoveredReadyTaskCount, 1);
  assert.equal(plan.blockedTaskCount, 1);
  assert.equal(plan.scheduleLoggedTaskCount, 0);
});

test("a counted priority batch writes one entry per task using each task's own previous level", () => {
  const input = [
    "- [ ] #task Alpha [priority:: high] [scheduled:: 2026-08-05] ^alpha",
    "- [ ] #task Beta [priority:: low] [scheduled:: 2026-08-10] ^beta",
    "- [ ] #task Gamma ^gamma",
  ].join("\n");
  const session = helpers.discoverCountedObsidianTaskTargets(input, 0, 2);
  const reasonByLine = new Map([
    [0, helpers.formatPriorityRollScheduleReason({
      source: "priority",
      level: { label: "P2", minDays: 8, maxDays: 30 },
      rolledDays: 17,
      fromLevelLabel: "P1",
    })],
    [1, helpers.formatPriorityRollScheduleReason({
      source: "priority",
      level: { label: "P2", minDays: 8, maxDays: 30 },
      rolledDays: 18,
      fromLevelLabel: "P3",
    })],
    [2, helpers.formatPriorityRollScheduleReason({
      source: "priority",
      level: { label: "P2", minDays: 8, maxDays: 30 },
      rolledDays: 19,
      fromLevelLabel: "P0",
    })],
  ]);
  const plan = helpers.planCountedBulletPropertyBatch(
    input,
    session,
    "priority",
    null,
    {
      operation: "set-priority",
      priorityValue: "medium",
      scheduledPropertyName: "scheduled",
      scheduledValueByLine: new Map([
        [0, "2026-08-20"],
        [1, "2026-08-21"],
        [2, "2026-08-22"],
      ]),
      today: new Date(2026, 7, 3),
      scheduleLog: { automatic: true, reasonByLine },
    },
  );

  assert.equal(plan.valid, true);
  assert.equal(plan.cursorLine, 0);
  assert.equal(plan.scheduleLoggedTaskCount, 3);
  // A priority roll's generated reason is never empty, so no target can ever
  // take the fallback branch.
  assert.equal(plan.scheduleLogFallbackTaskCount, 0);
  assert.equal(
    plan.content,
    [
      "- [?] #task Alpha [priority:: medium] [scheduled:: 2026-08-20] ^alpha",
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-08-05 → 2026-08-20* — 🎲 P1 → P2 · in **17** (8–30) days",
      "- [?] #task Beta [priority:: medium] [scheduled:: 2026-08-21] ^beta",
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-08-10 → 2026-08-21* — 🎲 P3 → P2 · in **18** (8–30) days",
      "- [?] #task Gamma [priority:: medium] [scheduled:: 2026-08-22] ^gamma",
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-08-22* — 🎲 P0 → P2 · in **19** (8–30) days",
    ].join("\n"),
  );
});

test("a counted priority batch skips a task whose rolled date equals its current date", () => {
  const input = [
    "- [ ] #task Alpha [priority:: high] [scheduled:: 2026-08-20] ^alpha",
    "- [ ] #task Beta [priority:: high] [scheduled:: 2026-08-21] ^beta",
  ].join("\n");
  const session = helpers.discoverCountedObsidianTaskTargets(input, 0, 1);
  const level = { label: "P2", minDays: 8, maxDays: 30 };
  const reasonByLine = new Map([
    [
      0,
      helpers.formatPriorityRollScheduleReason({
        source: "priority",
        level,
        rolledDays: 17,
        fromLevelLabel: "P1",
      }),
    ],
    [
      1,
      helpers.formatPriorityRollScheduleReason({
        source: "priority",
        level,
        rolledDays: 22,
        fromLevelLabel: "P1",
      }),
    ],
  ]);
  const plan = helpers.planCountedBulletPropertyBatch(
    input,
    session,
    "priority",
    null,
    {
      operation: "set-priority",
      priorityValue: "medium",
      scheduledPropertyName: "scheduled",
      scheduledValueByLine: new Map([
        [0, "2026-08-20"],
        [1, "2026-08-25"],
      ]),
      today: new Date(2026, 7, 3),
      scheduleLog: { automatic: true, reasonByLine },
    },
  );

  assert.equal(plan.valid, true);
  assert.equal(plan.scheduleLoggedTaskCount, 1);
  assert.equal(
    plan.content,
    [
      "- [?] #task Alpha [priority:: medium] [scheduled:: 2026-08-20] ^alpha",
      "- [?] #task Beta [priority:: medium] [scheduled:: 2026-08-25] ^beta",
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-08-21 → 2026-08-25* — 🎲 P1 → P2 · in **22** (8–30) days",
    ].join("\n"),
  );
});

test("counted priority runtime aborts a stale session without rolling writes", async () => {
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
  const property = createPriorityPickerConfig().properties.find(
    (item) => item.name === "priority",
  );

  assert.equal(
    await plugin.setCountedBulletPriorityValue(
      editor,
      { line: 0, ch: 4 },
      file.path,
      session,
      property,
      property.levels[0],
      { baseDate: new Date(2026, 7, 3), random: () => 0 },
    ),
    false,
  );
  assert.deepEqual(editor.transactions, []);
  assert.doesNotMatch(editor.content, /\[priority::|\[scheduled::/);
  assert.match(notices.at(-1), /no tasks were updated/);
});

test("scheduled picker pins a priority roll only for configured current priorities", async () => {
  const config = createPriorityPickerConfig();
  const baseDate = new Date(2026, 7, 3);
  const prioritized = createBulletPropertyPickerHarness({
    config,
    content: "- [ ] #task One [priority:: high] ^one",
    baseDate,
    random: () => 0,
  });
  const picker = await openBulletPropertyValueStage(
    prioritized,
    "scheduled",
  );

  assert.equal(picker.items.length, 11);
  assert.deepEqual(
    {
      label: picker.items[0].label,
      value: picker.items[0].value,
      detail: picker.items[0].detail,
      priorityRoll: picker.items[0].priorityRoll,
      level: picker.items[0].level.label,
      rolledDays: picker.items[0].rolledDays,
      searchText: picker.items[0].searchText,
    },
    {
      label: "P1 roll",
      value: "2026-08-05",
      detail: "2026-08-05 · Wed · random in 2–7 days",
      priorityRoll: true,
      level: "P1",
      rolledDays: 2,
      searchText: "P1 roll 2026-08-05 Wed random priority",
    },
  );
  assert.equal(
    picker.footerHints.some((hint) => hint.keys.includes("^R")),
    true,
  );

  for (const content of [
    "- [ ] #task One ^one",
    "- [ ] #task One [priority:: highest] ^one",
  ]) {
    const withoutSuggestion = createBulletPropertyPickerHarness({
      config,
      content,
      baseDate,
      random: () => 0,
    });
    const plainPicker = await openBulletPropertyValueStage(
      withoutSuggestion,
      "scheduled",
    );
    assert.equal(plainPicker.items.length, 10);
    assert.equal(plainPicker.items.some((item) => item.priorityRoll), false);
    assert.equal(
      plainPicker.footerHints.some((hint) => hint.keys.includes("^R")),
      false,
    );
  }
});

test("Ctrl+R replaces only the pinned priority roll and keeps it selected", async () => {
  const rolls = [0, 1];
  const harness = createBulletPropertyPickerHarness({
    config: createPriorityPickerConfig(),
    content: "- [ ] #task One [priority:: high] ^one",
    baseDate: new Date(2026, 7, 3),
    random: () => rolls.shift(),
  });
  const picker = await openBulletPropertyValueStage(harness, "scheduled");
  const unchangedItems = picker.items.slice(1);
  let prevented = false;
  let stopped = false;

  picker.handleKeydown({
    key: "r",
    ctrlKey: true,
    altKey: false,
    metaKey: false,
    preventDefault: () => {
      prevented = true;
    },
    stopPropagation: () => {
      stopped = true;
    },
  });

  assert.equal(picker.items[0].value, "2026-08-10");
  assert.equal(picker.items[0].rolledDays, 7);
  assert.deepEqual(picker.items.slice(1), unchangedItems);
  assert.equal(picker.selectedIndex, 0);
  assert.equal(picker.visibleItems[0], picker.items[0]);
  assert.equal(prevented, true);
  assert.equal(stopped, true);

  await picker.openItemAtIndex(0);
  const status = helpers.getObsidianTaskCheckboxStatus(
    harness.editor.content.split("\n")[0],
  );
  assert.equal(
    harness.editor.content,
    [
      `- [${status}] #task One [priority:: high] [scheduled:: 2026-08-10] ^one`,
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-08-10* — 🎲 P1 roll · in **7** (2–7) days",
    ].join("\n"),
  );
});

test("choosing a priority roll writes immediately with a deterministic reason instead of prompting", async () => {
  const makeHarness = () =>
    createBulletPropertyPickerHarness({
      config: createPriorityPickerConfig(),
      content: "- [ ] #task One [priority:: high] ^one",
      baseDate: new Date(2026, 7, 3),
      random: () => 0,
    });

  const rolled = makeHarness();
  const picker = await openBulletPropertyValueStage(rolled, "scheduled");
  assert.equal(picker.visibleItems[0].priorityRoll, true);
  await picker.openItemAtIndex(0);
  assert.notEqual(picker.stage, "reason");
  const rolledStatus = helpers.getObsidianTaskCheckboxStatus(
    rolled.editor.content.split("\n")[0],
  );
  assert.equal(
    rolled.editor.content,
    [
      `- [${rolledStatus}] #task One [priority:: high] [scheduled:: 2026-08-05] ^one`,
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-08-05* — 🎲 P1 roll · in **2** (2–7) days",
    ].join("\n"),
  );

  // A non-roll row still enters the reason stage, and confirming it empty
  // writes the date with no log. This task has no 🗓️ **SCHEDULE LOG** marker,
  // so this also doubles as the regression guard for the escape hatch: an
  // empty reason never creates a log on a task that didn't already have one.
  const preset = makeHarness();
  const presetPicker = await openBulletPropertyValueStage(preset, "scheduled");
  const presetIndex = presetPicker.visibleItems.findIndex(
    (item) => item.label === "In 2 days",
  );
  assert.notEqual(presetIndex, -1);
  await presetPicker.openItemAtIndex(presetIndex);
  assert.equal(presetPicker.stage, "reason");
  await confirmScheduleReasonStage(presetPicker);
  assert.equal(
    preset.editor.content,
    `- [${rolledStatus}] #task One [priority:: high] [scheduled:: 2026-08-05] ^one`,
  );
});

test("counted scheduled picker requires one shared configured priority", async () => {
  const config = createPriorityPickerConfig();
  const baseDate = new Date(2026, 7, 3);
  const mixed = createBulletPropertyPickerHarness({
    config,
    content: [
      "- [ ] #task One [priority:: high] ^one",
      "- [ ] #task Two [priority:: medium] ^two",
    ].join("\n"),
    baseDate,
    random: () => 0,
  });
  const mixedPicker = await openBulletPropertyValueStage(mixed, "scheduled", {
    countExplicit: true,
    additionalTaskCount: 1,
  });
  assert.equal(mixedPicker.items.length, 10);
  assert.equal(mixedPicker.items.some((item) => item.priorityRoll), false);

  const common = createBulletPropertyPickerHarness({
    config,
    content: [
      "- [ ] #task One [priority:: high] ^one",
      "- [ ] #task Two [priority:: high] ^two",
    ].join("\n"),
    baseDate,
    random: () => 0,
  });
  const commonPicker = await openBulletPropertyValueStage(common, "scheduled", {
    countExplicit: true,
    additionalTaskCount: 1,
  });
  assert.equal(commonPicker.items.length, 11);
  assert.equal(commonPicker.items[0].priorityRoll, true);
  assert.equal(commonPicker.items[0].level.label, "P1");
});

test("bullet property picker reconciles duplicate bare and counted opens", () => {
  {
    const { open, plugin } = createBulletPropertyPickerHarness();
    assert.equal(open(), true);
    const barePicker = plugin.activeBulletPropertyPicker;
    assert.equal(barePicker.isOpen, true);
    assert.equal(barePicker.taskSession, null);

    assert.equal(
      open({ countExplicit: true, additionalTaskCount: 1 }),
      true,
    );
    const countedPicker = plugin.activeBulletPropertyPicker;
    assert.notEqual(countedPicker, barePicker);
    assert.equal(barePicker.isOpen, false);
    assert.equal(countedPicker.isOpen, true);
    assert.equal(countedPicker.taskSession.explicit, true);
    assert.equal(countedPicker.taskSession.actualCount, 2);
  }

  {
    const { open, plugin } = createBulletPropertyPickerHarness();
    assert.equal(open(), true);
    const firstPicker = plugin.activeBulletPropertyPicker;
    assert.equal(open(), true);
    assert.equal(plugin.activeBulletPropertyPicker, firstPicker);
    assert.equal(firstPicker.isOpen, true);
  }

  {
    const { open, plugin } = createBulletPropertyPickerHarness();
    assert.equal(
      open({ countExplicit: true, additionalTaskCount: 1 }),
      true,
    );
    const countedPicker = plugin.activeBulletPropertyPicker;
    assert.equal(open(), true);
    assert.equal(plugin.activeBulletPropertyPicker, countedPicker);
    assert.equal(countedPicker.isOpen, true);
    assert.equal(countedPicker.taskSession.explicit, true);
  }
});

test("bullet property picker close lifecycle clears tracking for fresh sessions", async () => {
  const { editor, open, plugin } = createBulletPropertyPickerHarness();
  assert.equal(open({ countExplicit: true, additionalTaskCount: 0 }), true);
  const firstPicker = plugin.activeBulletPropertyPicker;
  const firstSession = firstPicker.taskSession;

  // Obsidian's Escape handling closes the modal through this lifecycle.
  firstPicker.close();
  assert.equal(plugin.activeBulletPropertyPicker, null);

  editor.cursor = { line: 1, ch: 0 };
  assert.equal(open({ countExplicit: true, additionalTaskCount: 0 }), true);
  const secondPicker = plugin.activeBulletPropertyPicker;
  assert.notEqual(secondPicker.taskSession, firstSession);
  assert.deepEqual(
    secondPicker.taskSession.targets.map((target) => target.line),
    [1],
  );

  await secondPicker.openItemAtIndex(0);
  assert.equal(plugin.activeBulletPropertyPicker, secondPicker);
  await secondPicker.openItemAtIndex(0);
  assert.equal(plugin.activeBulletPropertyPicker, null);
  assert.match(editor.getLine(1), /\[p:: high\]/);

  editor.cursor = { line: 2, ch: 0 };
  assert.equal(open({ countExplicit: true, additionalTaskCount: 0 }), true);
  const thirdPicker = plugin.activeBulletPropertyPicker;
  assert.notEqual(thirdPicker.taskSession, secondPicker.taskSession);
  assert.deepEqual(
    thirdPicker.taskSession.targets.map((target) => target.line),
    [2],
  );
  assert.equal(thirdPicker.isOpen, true);
});

test("task move picker reconciles duplicate bare and counted opens", () => {
  {
    const { editor, plugin, view } = createTaskMovePickerHarness();
    assert.equal(plugin.openTaskMoveDestinationPicker(editor, view), true);
    const barePicker = plugin.activeTaskMoveDestinationPicker;
    assert.equal(barePicker.isOpen, true);
    assert.equal(barePicker.session.countExplicit, false);

    assert.equal(
      plugin.openTaskMoveDestinationPicker(editor, view, {
        countExplicit: true,
        additionalTaskCount: 1,
      }),
      true,
    );
    const countedPicker = plugin.activeTaskMoveDestinationPicker;
    assert.notEqual(countedPicker, barePicker);
    assert.equal(barePicker.isOpen, false);
    assert.equal(countedPicker.isOpen, true);
    assert.equal(countedPicker.session.countExplicit, true);
    assert.equal(countedPicker.session.discovery.actualCount, 2);
  }

  {
    const { editor, plugin, view } = createTaskMovePickerHarness();
    assert.equal(plugin.openTaskMoveDestinationPicker(editor, view), true);
    const firstPicker = plugin.activeTaskMoveDestinationPicker;
    assert.equal(plugin.openTaskMoveDestinationPicker(editor, view), true);
    assert.equal(plugin.activeTaskMoveDestinationPicker, firstPicker);
    assert.equal(firstPicker.isOpen, true);
  }

  {
    const { editor, plugin, view } = createTaskMovePickerHarness();
    assert.equal(
      plugin.openTaskMoveDestinationPicker(editor, view, {
        countExplicit: true,
        additionalTaskCount: 1,
      }),
      true,
    );
    const countedPicker = plugin.activeTaskMoveDestinationPicker;
    assert.equal(plugin.openTaskMoveDestinationPicker(editor, view), true);
    assert.equal(plugin.activeTaskMoveDestinationPicker, countedPicker);
    assert.equal(countedPicker.isOpen, true);
    assert.equal(countedPicker.session.countExplicit, true);
  }
});

test("task move picker close lifecycle clears tracking for fresh sessions", async () => {
  const { editor, plugin, view } = createTaskMovePickerHarness();
  assert.equal(plugin.openTaskMoveDestinationPicker(editor, view), true);
  const firstPicker = plugin.activeTaskMoveDestinationPicker;

  firstPicker.close();
  assert.equal(plugin.activeTaskMoveDestinationPicker, null);

  editor.cursor = { line: 1, ch: 0 };
  assert.equal(plugin.openTaskMoveDestinationPicker(editor, view), true);
  const secondPicker = plugin.activeTaskMoveDestinationPicker;
  assert.notEqual(secondPicker.session, firstPicker.session);
  assert.deepEqual(secondPicker.session.cursor, { line: 1, ch: 0 });

  const selection = secondPicker.openItemAtIndex(0);
  assert.equal(plugin.activeTaskMoveDestinationPicker, null);
  await selection;

  editor.cursor = { line: 2, ch: 0 };
  assert.equal(plugin.openTaskMoveDestinationPicker(editor, view), true);
  const thirdPicker = plugin.activeTaskMoveDestinationPicker;
  assert.notEqual(thirdPicker.session, secondPicker.session);
  assert.deepEqual(thirdPicker.session.cursor, { line: 2, ch: 0 });
  assert.equal(thirdPicker.isOpen, true);
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
  assert.equal(
    appended.content.split(/\r?\n/)[appended.insertedLine],
    moved[0][0],
  );

  const existingCRLF = existing.replace(/\n/g, "\r\n");
  const appendedCRLF = helpers.insertTaskMoveBlocks(existingCRLF, moved, "project");
  assert.equal(appendedCRLF.valid, true);
  assert.equal(
    appendedCRLF.content.split(/\r?\n/)[appendedCRLF.insertedLine],
    moved[0][0],
  );

  const emptySection = ["## Tasks", "## Notes", "Keep"].join("\n");
  const insertedIntoEmptySection = helpers.insertTaskMoveBlocks(
    emptySection,
    moved,
    "project",
  );
  assert.equal(insertedIntoEmptySection.valid, true);
  assert.equal(insertedIntoEmptySection.content, [
    "## Tasks",
    "",
    "- [x] #task Moved [p::3] ^moved",
    "  child",
    "",
    "  continuation",
    "- [ ] #task Second ^second",
    "## Notes",
    "Keep",
  ].join("\n"));
  assert.equal(
    insertedIntoEmptySection.content.split(/\r?\n/)[
      insertedIntoEmptySection.insertedLine
    ],
    moved[0][0],
  );

  const trailingBlankBeforeLaterHeader = [
    "## Tasks",
    "",
    "- [ ] #task Existing ^existing",
    "",
    "",
    "## Notes",
    "Keep",
  ].join("\n");
  const insertedBeforeTrailingBlanks = helpers.insertTaskMoveBlocks(
    trailingBlankBeforeLaterHeader,
    moved,
    "project",
  );
  assert.equal(insertedBeforeTrailingBlanks.valid, true);
  assert.equal(insertedBeforeTrailingBlanks.content, [
    "## Tasks",
    "",
    "- [ ] #task Existing ^existing",
    "- [x] #task Moved [p::3] ^moved",
    "  child",
    "",
    "  continuation",
    "- [ ] #task Second ^second",
    "",
    "",
    "## Notes",
    "Keep",
  ].join("\n"));
  assert.equal(
    insertedBeforeTrailingBlanks.content.split(/\r?\n/)[
      insertedBeforeTrailingBlanks.insertedLine
    ],
    moved[0][0],
  );

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
  assert.equal(
    inserted.content.split(/\r?\n/)[inserted.insertedLine],
    moved[0][0],
  );

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
  assert.equal(
    created.content.split(/\r?\n/)[created.insertedLine],
    moved[0][0],
  );

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
  assert.equal(
    createdWithoutTerminalNewline.content.split(/\r?\n/)[
      createdWithoutTerminalNewline.insertedLine
    ],
    moved[0][0],
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

  assert.equal(
    nextDestination.split("\n")[plan.destinationLine],
    plan.destinationAnchorText,
  );
  assert.equal(
    plan.destinationAnchorText,
    "- [ ] #task One [id:: Projects__Dest__one] [dependsOn:: Projects__Dest__two] ^one",
  );
  assert.equal(plan.destinationBlockId, "one");
});

test("task move planning exposes a destination anchor for area destinations and counted moves", () => {
  const countedSource = [
    "- [ ] #task First",
    "- [ ] #task Second ^second",
    "- [ ] #task Third ^third",
    "- [ ] #task Stay",
  ].join("\n");
  const areaDestination = [
    "---",
    "type: \"[[area]]\"",
    "---",
    "# Area",
    "Body",
  ].join("\n");
  const discovery = helpers.discoverMovableObsidianTaskTargets(countedSource, 0, 2);
  assert.equal(discovery.actualCount, 3);
  const plan = helpers.planTaskMoveAcrossFiles({
    sourcePath: "Source.md",
    destinationPath: "Area.md",
    sourceContent: countedSource,
    destinationContent: areaDestination,
    targets: discovery.targets,
  });
  assert.equal(plan.valid, true, plan.error);
  const nextDestination = plan.changes.get("Area.md").after;
  assert.equal(
    nextDestination.split("\n")[plan.destinationLine],
    plan.destinationAnchorText,
  );
  assert.equal(plan.destinationAnchorText, "- [ ] #task First");
  assert.equal(plan.destinationBlockId, null);
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

test("resolveTaskMoveDestinationLine resolves via planned, block-id, text, and clamped fallbacks", () => {
  const content = [
    "## Tasks",
    "",
    "- [ ] #task Existing ^existing",
    "- [ ] #task Moved ^moved",
  ].join("\n");
  const anchor = { line: 3, text: "- [ ] #task Moved ^moved", blockId: "moved" };
  assert.deepEqual(helpers.resolveTaskMoveDestinationLine(content, anchor), {
    line: 3,
    source: "planned",
  });

  const shiftedByFrontmatter = [
    "---",
    "task_count: 1",
    "---",
    "## Tasks",
    "",
    "- [ ] #task Existing ^existing",
    "- [ ] #task Moved ^moved",
  ].join("\n");
  assert.deepEqual(
    helpers.resolveTaskMoveDestinationLine(shiftedByFrontmatter, anchor),
    { line: 6, source: "block-id" },
  );
  assert.deepEqual(
    helpers.resolveTaskMoveDestinationLine(shiftedByFrontmatter, {
      line: 3,
      text: "- [ ] #task Moved ^moved",
      blockId: null,
    }),
    { line: 6, source: "text" },
  );

  const anchorText = "- [ ] #task Fenced ^fenced";
  const fencedOnly = [
    "## Tasks",
    "",
    "```",
    anchorText,
    "```",
    "- [ ] #task Real ^real",
  ].join("\n");
  assert.deepEqual(
    helpers.resolveTaskMoveDestinationLine(fencedOnly, {
      line: 1,
      text: anchorText,
      blockId: null,
    }),
    { line: 1, source: "clamped" },
  );

  const frontmatterAnchorText = "type: \"[[project]]\"";
  const frontmatterOnly = [
    "---",
    frontmatterAnchorText,
    "---",
    "## Tasks",
    "- [ ] #task Real ^real",
  ].join("\n");
  assert.deepEqual(
    helpers.resolveTaskMoveDestinationLine(frontmatterOnly, {
      line: 3,
      text: frontmatterAnchorText,
      blockId: null,
    }),
    { line: 3, source: "clamped" },
  );

  const shrunken = "- [ ] #task Only ^only";
  assert.deepEqual(
    helpers.resolveTaskMoveDestinationLine(shrunken, {
      line: 5,
      text: "- [ ] #task Missing ^missing",
      blockId: null,
    }),
    { line: 0, source: "clamped" },
  );

  assert.deepEqual(
    helpers.resolveTaskMoveDestinationLine("", {
      line: 3,
      text: "x",
      blockId: null,
    }),
    { line: 0, source: "clamped" },
  );
});

test("focusTaskMoveDestination opens the destination file and anchors the cursor", async () => {
  const editor = new TransactionEditor(
    ["- [ ] #task Existing ^existing", "- [ ] #task Moved ^moved"].join("\n"),
    { line: 0, ch: 0 },
  );
  const destinationFile = { path: "Area.md", basename: "Area", extension: "md" };
  const { plugin, captureCalls, openCalls } = createTaskMoveDestinationFocusHarness({
    getActiveMarkdownView: () => ({ file: destinationFile, editor }),
  });
  const anchor = { line: 1, text: "- [ ] #task Moved ^moved", blockId: "moved" };

  const result = await plugin.focusTaskMoveDestination(destinationFile, anchor);

  assert.equal(result, true);
  assert.equal(captureCalls.length, 1);
  assert.equal(openCalls.length, 1);
  assert.equal(openCalls[0].file, destinationFile);
  assert.deepEqual(editor.getCursor(), { line: 1, ch: 0 });
});

test("focusTaskMoveDestination returns false without moving the cursor when the open fails", async () => {
  const editor = new TransactionEditor(
    ["- [ ] #task Existing ^existing"].join("\n"),
    { line: 0, ch: 0 },
  );
  const destinationFile = { path: "Area.md", basename: "Area", extension: "md" };
  const { plugin, openCalls } = createTaskMoveDestinationFocusHarness({
    openResult: false,
    getActiveMarkdownView: () => ({ file: destinationFile, editor }),
  });
  const anchor = {
    line: 0,
    text: "- [ ] #task Existing ^existing",
    blockId: "existing",
  };

  const result = await plugin.focusTaskMoveDestination(destinationFile, anchor);

  assert.equal(result, false);
  assert.equal(openCalls.length, 1);
  assert.deepEqual(editor.getCursor(), { line: 0, ch: 0 });
  assert.equal(editor.setCursorCalls.length, 0);
});

test("focusTaskMoveDestination re-anchors by block ID when the destination content drifted", async () => {
  const editor = new TransactionEditor(
    [
      "---",
      "task_count: 1",
      "---",
      "## Tasks",
      "",
      "- [ ] #task Existing ^existing",
      "- [ ] #task Moved ^moved",
    ].join("\n"),
    { line: 0, ch: 0 },
  );
  const destinationFile = { path: "Area.md", basename: "Area", extension: "md" };
  const { plugin } = createTaskMoveDestinationFocusHarness({
    getActiveMarkdownView: () => ({ file: destinationFile, editor }),
  });
  // Planned index (3) pointed at the moved task before bob-project-tasks inserted
  // frontmatter lines after the write; block-ID re-anchoring must still find it.
  const anchor = { line: 3, text: "- [ ] #task Moved ^moved", blockId: "moved" };

  const result = await plugin.focusTaskMoveDestination(destinationFile, anchor);

  assert.equal(result, true);
  assert.deepEqual(editor.getCursor(), { line: 6, ch: 0 });
});

test("physical task move chord declines auto-repeat and consumes Vim normal input once", () => {
  const makeEvent = (overrides = {}) => {
    const calls = { prevent: 0, stop: 0, immediate: 0 };
    return {
      key: "M",
      code: "KeyM",
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false,
      repeat: false,
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
  let focusedViewReads = 0;
  plugin.getFocusedMarkdownEditorView = () => {
    focusedViewReads += 1;
    return view;
  };
  const opens = [];
  plugin.openTaskMoveDestinationPicker = (_editor, _view, options) => {
    opens.push(options);
    return true;
  };

  const repeated = makeEvent({ repeat: true });
  assert.equal(plugin.handleCountedTaskMovePhysicalKeydown(repeated), false);
  assert.deepEqual(repeated.calls, { prevent: 0, stop: 0, immediate: 0 });
  assert.equal(focusedViewReads, 0);
  assert.deepEqual(opens, []);

  const bare = makeEvent();
  assert.equal(plugin.handleCountedTaskMovePhysicalKeydown(bare), true);
  assert.equal(focusedViewReads, 1);
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
  plugin.filePositions = new Map();
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

  const repeated = makeEvent({ repeat: true });
  assert.equal(plugin.handleCountedBulletPropertyPhysicalKeydown(repeated), false);
  assert.deepEqual(repeated.calls, { prevent: 0, stop: 0, immediate: 0 });
  assert.deepEqual(opens, []);
  assert.deepEqual(inputState.keyBuffer, ["2"]);
  assert.equal(inputState.repeat, 2);

  const counted = makeEvent({ repeat: false });
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

function makeSiblingTabsFixture(specs, activeId) {
  const parent = { children: [] };
  const detachCalls = [];
  const focusCalls = [];

  const leaves = specs.map((spec, index) => {
    const leaf = {
      id: spec.id || `leaf-${index}`,
      parent,
      detach: async () => {
        detachCalls.push(leaf.id);
        const position = parent.children.indexOf(leaf);
        if (position !== -1) {
          parent.children.splice(position, 1);
        }
      },
    };

    if ("pinned" in spec) {
      leaf.pinned = spec.pinned;
    }
    if (spec.viewStateThrows) {
      leaf.getViewState = () => {
        throw new Error("view state unavailable");
      };
    } else if ("viewState" in spec) {
      leaf.getViewState = () => spec.viewState;
    }

    return leaf;
  });

  parent.children = leaves.slice();
  const leafById = Object.fromEntries(leaves.map((leaf) => [leaf.id, leaf]));
  const activeLeaf = leafById[activeId];
  assert.ok(activeLeaf, `missing active leaf fixture ${activeId}`);

  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: {
      activeLeaf,
      setActiveLeaf: (leaf, options) => {
        focusCalls.push({ id: leaf.id, options });
      },
    },
  };

  return { plugin, parent, detachCalls, focusCalls };
}

function siblingTabIds(parent) {
  return parent.children.map((leaf) => leaf.id);
}

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

test("close tabs left preserves pinned sibling tabs and refocuses active tab", async () => {
  const { plugin, parent, detachCalls, focusCalls } = makeSiblingTabsFixture(
    [
      { id: "left-unpinned-a" },
      { id: "left-pinned", pinned: true },
      { id: "left-unpinned-b" },
      { id: "active" },
      { id: "right-untouched" },
    ],
    "active",
  );

  assert.equal(await plugin.closeSiblingTabs("left"), true);
  assert.deepEqual(detachCalls, ["left-unpinned-a", "left-unpinned-b"]);
  assert.deepEqual(siblingTabIds(parent), [
    "left-pinned",
    "active",
    "right-untouched",
  ]);
  assert.deepEqual(focusCalls, [
    { id: "active", options: { focus: true } },
  ]);
});

test("close tabs right preserves pinned siblings and ignores the left side", async () => {
  const { plugin, parent, detachCalls } = makeSiblingTabsFixture(
    [
      { id: "left-untouched" },
      { id: "active" },
      { id: "right-pinned", pinned: true },
      { id: "right-unpinned-a" },
      { id: "right-unpinned-b" },
    ],
    "active",
  );

  assert.equal(await plugin.closeSiblingTabs("right"), true);
  assert.deepEqual(detachCalls, ["right-unpinned-a", "right-unpinned-b"]);
  assert.deepEqual(siblingTabIds(parent), [
    "left-untouched",
    "active",
    "right-pinned",
  ]);
});

test("close other tabs preserves pinned siblings on both sides", async () => {
  const { plugin, parent, detachCalls } = makeSiblingTabsFixture(
    [
      { id: "left-pinned", pinned: true },
      { id: "left-unpinned" },
      { id: "active" },
      { id: "right-pinned", pinned: true },
      { id: "right-unpinned" },
    ],
    "active",
  );

  assert.equal(await plugin.closeSiblingTabs("others"), true);
  assert.deepEqual(detachCalls, ["left-unpinned", "right-unpinned"]);
  assert.deepEqual(siblingTabIds(parent), [
    "left-pinned",
    "active",
    "right-pinned",
  ]);
});

test("close sibling tabs is a silent no-op when the scoped range is all pinned", async () => {
  const { plugin, parent, detachCalls, focusCalls } = makeSiblingTabsFixture(
    [
      { id: "left-pinned-a", pinned: true },
      { id: "left-pinned-b", viewState: { pinned: true } },
      { id: "active" },
      { id: "right-untouched" },
    ],
    "active",
  );

  assert.equal(await plugin.closeSiblingTabs("left"), false);
  assert.deepEqual(detachCalls, []);
  assert.deepEqual(siblingTabIds(parent), [
    "left-pinned-a",
    "left-pinned-b",
    "active",
    "right-untouched",
  ]);
  assert.deepEqual(focusCalls, []);
});

test("close sibling tabs honors every pinned leaf representation", async () => {
  const { plugin, parent, detachCalls } = makeSiblingTabsFixture(
    [
      { id: "leaf-property-pinned", pinned: true },
      { id: "view-state-pinned", viewState: { pinned: true } },
      { id: "nested-state-pinned", viewState: { state: { pinned: true } } },
      { id: "active" },
      { id: "unpinned" },
    ],
    "active",
  );

  assert.equal(await plugin.closeSiblingTabs("others"), true);
  assert.deepEqual(detachCalls, ["unpinned"]);
  assert.deepEqual(siblingTabIds(parent), [
    "leaf-property-pinned",
    "view-state-pinned",
    "nested-state-pinned",
    "active",
  ]);
});

test("close sibling tabs treats throwing view state as unpinned", async () => {
  const { plugin, parent, detachCalls } = makeSiblingTabsFixture(
    [
      { id: "active" },
      { id: "throwing-view-state", viewStateThrows: true },
      { id: "right-pinned", pinned: true },
    ],
    "active",
  );

  assert.equal(await plugin.closeSiblingTabs("right"), true);
  assert.deepEqual(detachCalls, ["throwing-view-state"]);
  assert.deepEqual(siblingTabIds(parent), ["active", "right-pinned"]);
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

test("formatPriorityRollScheduleReason covers all four shapes", () => {
  const level = { label: "P2", minDays: 8, maxDays: 30 };
  const priorityTransitionReason = helpers.formatPriorityRollScheduleReason({
    source: "priority",
    level,
    rolledDays: 30,
    fromLevelLabel: "P1",
  });
  assert.doesNotMatch(priorityTransitionReason, /\b(?:priority|random)\b/);
  assert.equal(
    priorityTransitionReason,
    "🎲 P1 → P2 · in **30** (8–30) days",
  );
  assert.equal(
    helpers.formatPriorityRollScheduleReason({
      source: "priority",
      level,
      rolledDays: 8,
      fromLevelLabel: "P0",
    }),
    "🎲 P0 → P2 · in **8** (8–30) days",
  );
  assert.equal(
    helpers.formatPriorityRollScheduleReason({
      source: "priority",
      level,
      rolledDays: 17,
      fromLevelLabel: "P2",
    }),
    "🎲 P2 · in **17** (8–30) days",
  );
  assert.equal(
    helpers.formatPriorityRollScheduleReason({
      source: "scheduled",
      level,
      rolledDays: 20,
    }),
    "🎲 P2 roll · in **20** (8–30) days",
  );
  assert.equal(
    helpers.formatPriorityRollScheduleReason({
      source: "priority",
      rolledDays: 20,
    }),
    "",
  );
  assert.equal(
    helpers.formatPriorityRollScheduleReason({ source: "priority", level }),
    "",
  );
  assert.equal(
    helpers.formatPriorityRollScheduleReason({
      source: "priority",
      level,
      rolledDays: 7,
    }),
    "",
  );
  assert.equal(
    helpers.formatPriorityRollScheduleReason({
      source: "priority",
      level,
      rolledDays: 31,
    }),
    "",
  );
  assert.equal(
    helpers.formatPriorityRollScheduleReason({
      source: "priority",
      level,
      rolledDays: 12.5,
    }),
    "",
  );
});

test("the priority-roll picker row keeps range detail and stores the exact roll", () => {
  const level = { label: "P2", minDays: 8, maxDays: 30 };
  const rollItem = helpers.createPriorityRollDateItem(
    level,
    new Date(2026, 7, 3),
    "",
    () => 0,
  );
  assert.match(
    rollItem.detail,
    new RegExp(`${helpers.formatPriorityRollWindowText(level)}$`),
  );
  assert.match(rollItem.detail, /\brandom in\b/);
  assert.equal(rollItem.rolledDays, 8);
  assert.equal(
    helpers.formatPriorityRollScheduleReason({
      source: "scheduled",
      level,
      rolledDays: rollItem.rolledDays,
    }),
    "🎲 P2 roll · in **8** (8–30) days",
  );
});

test("buildPriorityRollScheduleLog returns null when the roll does not move the date", () => {
  const level = { label: "P2", minDays: 8, maxDays: 30 };
  assert.equal(
    helpers.buildPriorityRollScheduleLog({
      source: "priority",
      level,
      rolledDays: 30,
      fromLevelLabel: "P1",
      from: "2026-09-02",
      to: "2026-09-02",
    }),
    null,
  );
  assert.deepEqual(
    helpers.buildPriorityRollScheduleLog({
      source: "priority",
      level,
      rolledDays: 30,
      fromLevelLabel: "P1",
      from: "2026-08-13",
      to: "2026-09-02",
    }),
    {
      from: "2026-08-13",
      to: "2026-09-02",
      reason: "🎲 P1 → P2 · in **30** (8–30) days",
      automatic: true,
    },
  );
  assert.equal(
    helpers.buildPriorityRollScheduleLog({
      source: "priority",
      level,
      rolledDays: 30,
      fromLevelLabel: "P1",
      from: "2026-08-13",
      to: "",
    }),
    null,
  );
});

test("getPriorityRollFromLevelLabel resolves configured, absent, and unconfigured values", () => {
  const property = createPriorityPickerConfig().properties.find(
    (item) => item.name === "priority",
  );
  assert.equal(helpers.getPriorityRollFromLevelLabel(property, "medium"), "P2");
  assert.equal(helpers.getPriorityRollFromLevelLabel(property, ""), "P0");
  assert.equal(
    helpers.getPriorityRollFromLevelLabel(property, "highest"),
    "highest",
  );
});

test("a priority roll onto the current date writes the date but no log", async () => {
  notices.length = 0;
  const harness = createBulletPropertyPickerHarness({
    config: createPriorityPickerConfig(),
    content: "- [ ] #task One [priority:: high] [scheduled:: 2026-08-05] ^one",
    baseDate: new Date(2026, 7, 3),
    random: () => 0,
  });

  await choosePriorityLevel(harness, "P1");

  assert.equal(
    harness.editor.content,
    "- [?] #task One [priority:: high] [scheduled:: 2026-08-05] ^one",
  );
  assert.doesNotMatch(harness.editor.content, /SCHEDULE LOG/);
  assert.deepEqual(notices, [
    "priority → P1 (high); scheduled → 2026-08-05 · Wed · in 2 days; marked task Blocked",
  ]);
});

test("a typed reason on an unchanged date is still written", async () => {
  notices.length = 0;
  const lineText = "- [ ] #task Ship the thing [scheduled:: 2026-08-13] ^ship";
  const editor = new TestEditor(lineText);
  const file = { path: "Tasks.md", extension: "md" };
  const plugin = new NavigationHotkeysPlugin();
  plugin.getActiveMarkdownView = () => ({ editor, file });

  const wrote = await plugin.setBulletPropertyValue(
    editor,
    { line: 0, ch: 10 },
    "scheduled",
    "2026-08-13",
    {
      filePath: file.path,
      expectedLine: lineText,
      today: new Date(2026, 7, 1),
      scheduleLog: {
        from: "2026-08-13",
        to: "2026-08-13",
        reason: "still the right call",
      },
    },
  );
  assert.equal(wrote, true);
  assert.equal(
    editor.content,
    [
      "- [?] #task Ship the thing [scheduled:: 2026-08-13] ^ship",
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-08-13 → 2026-08-13* — still the right call",
    ].join("\n"),
  );
});

test("schedule log bullet formatting and parsing round-trip with and without a previous value", () => {
  const parentTab = helpers.formatScheduleLogParentBullet("\t", "-");
  assert.equal(parentTab, "\t- 🗓️ **SCHEDULE LOG**");
  assert.deepEqual(helpers.parseScheduleLogParentBullet(parentTab), {
    indent: "\t",
    marker: "-",
    hasEmoji: true,
  });

  const parentTwoSpace = helpers.formatScheduleLogParentBullet("  ", "*");
  assert.equal(parentTwoSpace, "  * 🗓️ **SCHEDULE LOG**");
  assert.deepEqual(helpers.parseScheduleLogParentBullet(parentTwoSpace), {
    indent: "  ",
    marker: "*",
    hasEmoji: true,
  });

  // The legacy "Schedule log:" spelling is still recognized (and never
  // silently rewritten to the new spelling), with or without the emoji.
  assert.deepEqual(
    helpers.parseScheduleLogParentBullet("\t- 🗓️ **Schedule log:**"),
    { indent: "\t", marker: "-", hasEmoji: true },
  );
  assert.deepEqual(
    helpers.parseScheduleLogParentBullet("  + **Schedule log:**"),
    { indent: "  ", marker: "+", hasEmoji: false },
  );
  assert.equal(
    helpers.parseScheduleLogParentBullet("  - **SCHEDULE LOG** trailing"),
    null,
  );
  assert.equal(helpers.parseScheduleLogParentBullet("plain text"), null);

  const entryWithFrom = helpers.formatScheduleLogEntryBullet("\t\t", "-", {
    from: "2026-08-13",
    to: "2026-08-20",
    reason: "waiting on the API review to land",
  });
  assert.equal(
    entryWithFrom,
    "\t\t- *2026-08-13 → 2026-08-20* — waiting on the API review to land",
  );
  assert.deepEqual(helpers.parseScheduleLogEntryBullet(entryWithFrom), {
    indent: "\t\t",
    marker: "-",
    from: "2026-08-13",
    to: "2026-08-20",
    reason: "waiting on the API review to land",
  });

  const entryWithMarkdownReason = helpers.formatScheduleLogEntryBullet("\t\t", "-", {
    from: "2026-08-13",
    to: "2026-09-02",
    reason: "🎲 P1 → P2 · in **30** (8–30) days",
  });
  assert.deepEqual(helpers.parseScheduleLogEntryBullet(entryWithMarkdownReason), {
    indent: "\t\t",
    marker: "-",
    from: "2026-08-13",
    to: "2026-09-02",
    reason: "🎲 P1 → P2 · in **30** (8–30) days",
  });

  const entryWithoutFrom = helpers.formatScheduleLogEntryBullet("  ", "+", {
    from: "",
    to: "2026-08-20",
    reason: "was out sick",
  });
  assert.equal(entryWithoutFrom, "  + *2026-08-20* — was out sick");
  assert.deepEqual(helpers.parseScheduleLogEntryBullet(entryWithoutFrom), {
    indent: "  ",
    marker: "+",
    from: "",
    to: "2026-08-20",
    reason: "was out sick",
  });

  // Legacy double-star entry emphasis still parses so nothing reading the
  // log breaks mid-migration.
  assert.deepEqual(
    helpers.parseScheduleLogEntryBullet(
      "\t\t- **2026-08-13 → 2026-08-20** — legacy bold",
    ),
    {
      indent: "\t\t",
      marker: "-",
      from: "2026-08-13",
      to: "2026-08-20",
      reason: "legacy bold",
    },
  );
});

test("formatScheduleLogEntryText renders entry text without indent or marker", () => {
  assert.equal(
    helpers.formatScheduleLogEntryText({
      from: "2026-08-13",
      to: "2026-08-20",
      reason: "waiting on the API review to land",
    }),
    "*2026-08-13 → 2026-08-20* — waiting on the API review to land",
  );
  assert.equal(
    helpers.formatScheduleLogEntryText({
      from: "",
      to: "2026-08-20",
      reason: "was out sick",
    }),
    "*2026-08-20* — was out sick",
  );
});

test("schedule reason text normalization trims, collapses whitespace, and flags inline fields", () => {
  assert.deepEqual(helpers.normalizeScheduleReasonText(""), {
    reason: "",
    empty: true,
    hasInlineField: false,
  });
  assert.deepEqual(helpers.normalizeScheduleReasonText("   "), {
    reason: "",
    empty: true,
    hasInlineField: false,
  });
  assert.deepEqual(
    helpers.normalizeScheduleReasonText("  waiting on \n\n the   API \treview  "),
    { reason: "waiting on the API review", empty: false, hasInlineField: false },
  );
  assert.deepEqual(helpers.normalizeScheduleReasonText("blocked:: x"), {
    reason: "blocked:: x",
    empty: false,
    hasInlineField: true,
  });
  assert.deepEqual(
    helpers.normalizeScheduleReasonText("blocked by [[sase_gate]]"),
    { reason: "blocked by [[sase_gate]]", empty: false, hasInlineField: false },
  );
});

test("findScheduleLogParent finds a direct-child marker but ignores a nested grandchild's", () => {
  const withMarker = [
    "- [ ] #task Parent ^parent",
    "  - freeform note",
    "  - 🗓️ **SCHEDULE LOG**",
    "    - *2026-07-01* — reason",
    "  - ![[#^dep]]",
  ].join("\n");
  assert.deepEqual(helpers.findScheduleLogParent(withMarker, 0), {
    line: 2,
    indent: "  ",
    marker: "-",
  });

  const nested = [
    "- [ ] #task Parent ^parent",
    "  - ![[#^dep]]",
    "    - 🗓️ **SCHEDULE LOG**",
    "      - *2026-07-01* — nested, not parent's",
  ].join("\n");
  assert.equal(helpers.findScheduleLogParent(nested, 0), null);

  const absent = ["- [ ] #task Parent ^parent", "  - no log here"].join("\n");
  assert.equal(helpers.findScheduleLogParent(absent, 0), null);
});

test("getScheduleLogEntryIndent reuses an existing entry indent or falls back to marker indent plus a tab", () => {
  const withEntries = [
    "- [ ] #task T ^t",
    "\t- 🗓️ **SCHEDULE LOG**",
    "\t\t- *2026-07-01* — a",
  ].join("\n");
  assert.equal(helpers.getScheduleLogEntryIndent(withEntries, 1), "\t\t");

  const withoutEntries = ["- [ ] #task T ^t", "  - 🗓️ **SCHEDULE LOG**"].join(
    "\n",
  );
  assert.equal(helpers.getScheduleLogEntryIndent(withoutEntries, 1), "  \t");
});

test("planScheduleLogEntry creates, prepends, guards, and preserves blockquote context", () => {
  const fresh = "- [ ] #task Ship the thing [scheduled:: 2026-08-20] ^ship";
  const created = helpers.planScheduleLogEntry(fresh, 0, {
    from: "2026-08-13",
    to: "2026-08-20",
    reason: "waiting on the API review to land",
  });
  assert.equal(created.valid, true);
  assert.equal(created.changed, true);
  assert.equal(created.createdParent, true);
  assert.equal(created.insertLine, 1);
  assert.deepEqual(created.lineTexts, [
    "\t- 🗓️ **SCHEDULE LOG**",
    "\t\t- *2026-08-13 → 2026-08-20* — waiting on the API review to land",
  ]);

  // Regression guard: the entry must always be one indent unit deeper than
  // the marker it belongs to, never a sibling of it.
  const [markerLine, entryLine] = created.lineTexts;
  assert.equal(
    helpers.getBulletIndent(entryLine),
    `${helpers.getBulletIndent(markerLine)}\t`,
  );

  // A new marker is inserted as the last direct child, after any existing
  // children, reusing an existing sibling's indentation; the entry nests one
  // Tab deeper than that adopted indentation, giving the mixed "  \t" shape.
  const withOtherChild = [
    "- [ ] #task Ship [scheduled:: 2026-08-20] ^ship",
    "  - some existing note",
  ].join("\n");
  const createdAfterNote = helpers.planScheduleLogEntry(withOtherChild, 0, {
    to: "2026-08-20",
    reason: "kickoff",
  });
  assert.equal(createdAfterNote.insertLine, 2);
  assert.deepEqual(createdAfterNote.lineTexts, [
    "  - 🗓️ **SCHEDULE LOG**",
    "  \t- *2026-08-20* — kickoff",
  ]);

  // Prepends a new entry above an existing one (newest first), reusing the
  // marker's own list-marker character and indentation.
  const existing = [
    "- [ ] #task Ship [scheduled:: 2026-08-20] ^ship",
    "  * 🗓️ **SCHEDULE LOG**",
    "    * *2026-08-06 → 2026-08-13* — was out sick",
  ].join("\n");
  const prepended = helpers.planScheduleLogEntry(existing, 0, {
    from: "2026-08-13",
    to: "2026-08-20",
    reason: "back from sick leave",
  });
  assert.equal(prepended.valid, true);
  assert.equal(prepended.createdParent, false);
  assert.equal(prepended.insertLine, 2);
  assert.deepEqual(prepended.lineTexts, [
    "    * *2026-08-13 → 2026-08-20* — back from sick leave",
  ]);

  // Guards never throw.
  assert.equal(
    helpers.planScheduleLogEntry(fresh, 0, { to: "x", reason: "" }).valid,
    false,
  );
  assert.equal(
    helpers.planScheduleLogEntry(fresh, 0, { to: "x", reason: "" }).reason,
    "empty-reason",
  );
  assert.equal(
    helpers.planScheduleLogEntry(fresh, 0, { to: "x", reason: "   " }).reason,
    "empty-reason",
  );
  assert.equal(
    helpers.planScheduleLogEntry(fresh, 99, { to: "x", reason: "y" }).reason,
    "task-out-of-range",
  );
  assert.equal(
    helpers.planScheduleLogEntry(fresh, -1, { to: "x", reason: "y" }).reason,
    "task-out-of-range",
  );
  assert.equal(
    helpers.planScheduleLogEntry("not a list item", 0, {
      to: "x",
      reason: "y",
    }).reason,
    "not-list-item",
  );

  // Last line of file, no trailing newline: still inserts past the end.
  const lastLine = "- [ ] #task Only ^only";
  const atEnd = helpers.planScheduleLogEntry(lastLine, 0, {
    to: "2026-08-20",
    reason: "first pass",
  });
  assert.equal(atEnd.insertLine, 1);
  assert.equal(atEnd.createdParent, true);

  // A blockquoted task keeps its log inside the same quote context.
  const quoted = "> - [ ] #task Quoted [scheduled:: 2026-08-20] ^quoted";
  const inQuote = helpers.planScheduleLogEntry(quoted, 0, {
    to: "2026-08-20",
    reason: "quoted context",
  });
  assert.deepEqual(inQuote.lineTexts, [
    "> \t- 🗓️ **SCHEDULE LOG**",
    "> \t\t- *2026-08-20* — quoted context",
  ]);
});

test("planScheduleLogEntry extends a legacy on-disk log whose one existing entry is a sibling of the marker", () => {
  // This is the transitional shape sitting in the vault today: the marker
  // uses the legacy spelling and its one entry is a sibling, not a child,
  // because it was written before this nesting fix. The legacy marker is
  // found and reused in place; because it has no children yet,
  // getScheduleLogEntryIndent falls back to marker indent + one Tab, so the
  // new entry is correctly nested even though the old sibling entry below it
  // is not. That mixed shape is expected and is why the vault note itself is
  // migrated by hand rather than auto-migrated by the plugin.
  const legacy = [
    "- [ ] #task Ship [scheduled:: 2026-09-06] ^ship",
    "\t- 🗓️ **Schedule log:**",
    "\t- **2026-08-09 → 2026-09-06** — Because I like it.",
  ].join("\n");
  const next = helpers.planScheduleLogEntry(legacy, 0, {
    from: "2026-09-06",
    to: "2026-09-20",
    reason: "slipped again",
  });
  assert.equal(next.createdParent, false);
  assert.equal(next.insertLine, 2);
  assert.deepEqual(next.lineTexts, [
    "\t\t- *2026-09-06 → 2026-09-20* — slipped again",
  ]);
});

test("planScheduleLogEntry uses the fallback only when a marker exists", () => {
  const withMarker = [
    "- [ ] #task Ship the thing [scheduled:: 2026-08-20] ^ship",
    "  - 🗓️ **SCHEDULE LOG**",
    "    - *2026-08-13 → 2026-08-20* — waiting on the API review to land",
  ].join("\n");
  const marked = helpers.planScheduleLogEntry(withMarker, 0, {
    from: "2026-08-13",
    to: "2026-08-20",
    reason: "",
    fallbackReason: "🤷 no reason given",
  });
  assert.equal(marked.valid, true);
  assert.equal(marked.usedFallback, true);
  assert.equal(marked.createdParent, false);
  assert.deepEqual(marked.lineTexts, [
    "    - *2026-08-13 → 2026-08-20* — 🤷 no reason given",
  ]);

  const withoutMarker = "- [ ] #task Ship the thing [scheduled:: 2026-08-20] ^ship";
  const unmarked = helpers.planScheduleLogEntry(withoutMarker, 0, {
    from: "2026-08-13",
    to: "2026-08-20",
    reason: "",
    fallbackReason: "🤷 no reason given",
  });
  assert.equal(unmarked.valid, false);
  assert.equal(unmarked.reason, "no-schedule-log");
  assert.equal(unmarked.usedFallback, false);
});

test("a typed reason wins over the fallback", () => {
  const withMarker = [
    "- [ ] #task Ship the thing [scheduled:: 2026-08-20] ^ship",
    "  - 🗓️ **SCHEDULE LOG**",
    "    - *2026-08-13 → 2026-08-20* — waiting on the API review to land",
  ].join("\n");
  const plan = helpers.planScheduleLogEntry(withMarker, 0, {
    from: "2026-08-13",
    to: "2026-08-20",
    reason: "back from sick leave",
    fallbackReason: "🤷 no reason given",
  });
  assert.equal(plan.valid, true);
  assert.equal(plan.usedFallback, false);
  assert.deepEqual(plan.lineTexts, [
    "    - *2026-08-13 → 2026-08-20* — back from sick leave",
  ]);
});

// Paired with "a typed reason on an unchanged date is still written": together
// they are the whole automatic-vs-human rule.
test("the fallback is suppressed on an unchanged date", () => {
  const withMarker = [
    "- [ ] #task Ship the thing [scheduled:: 2026-08-20] ^ship",
    "  - 🗓️ **SCHEDULE LOG**",
    "    - *2026-08-13 → 2026-08-20* — waiting on the API review to land",
  ].join("\n");
  const plan = helpers.planScheduleLogEntry(withMarker, 0, {
    from: "2026-08-20",
    to: "2026-08-20",
    reason: "",
    fallbackReason: "🤷 no reason given",
  });
  assert.equal(plan.valid, false);
  assert.equal(plan.reason, "unchanged-date");
});

test("no reason and no fallback still guards empty-reason", () => {
  const fresh = "- [ ] #task Ship the thing [scheduled:: 2026-08-20] ^ship";
  const plan = helpers.planScheduleLogEntry(fresh, 0, {
    from: "2026-08-13",
    to: "2026-08-20",
    reason: "",
    fallbackReason: "",
  });
  assert.equal(plan.valid, false);
  assert.equal(plan.reason, "empty-reason");
  assert.equal(plan.usedFallback, false);
});

test("getScheduleLogWriteOutcome maps plan outcomes for writers", () => {
  const createdPlan = { valid: true, createdParent: true, usedFallback: false };
  const addedPlan = { valid: true, createdParent: false, usedFallback: false };
  const fallbackPlan = { valid: true, createdParent: false, usedFallback: true };
  assert.equal(helpers.getScheduleLogWriteOutcome(createdPlan, true), "created");
  assert.equal(helpers.getScheduleLogWriteOutcome(addedPlan, true), "added");
  assert.equal(helpers.getScheduleLogWriteOutcome(fallbackPlan, true), "added-fallback");

  for (const reason of ["empty-reason", "no-schedule-log", "unchanged-date"]) {
    assert.equal(
      helpers.getScheduleLogWriteOutcome({ valid: false, reason }, false),
      null,
    );
  }

  assert.equal(
    helpers.getScheduleLogWriteOutcome({ valid: false, reason: "not-list-item" }, false),
    "guard-failed",
  );
  assert.equal(helpers.getScheduleLogWriteOutcome(addedPlan, false), "guard-failed");
  assert.equal(helpers.getScheduleLogWriteOutcome(null, true), null);
});

test("hasScheduleLogReasonInput detects a typed reason or a fallback-only payload", () => {
  assert.equal(helpers.hasScheduleLogReasonInput(null), false);
  assert.equal(helpers.hasScheduleLogReasonInput({}), false);
  assert.equal(helpers.hasScheduleLogReasonInput({ reason: "  " }), false);
  assert.equal(helpers.hasScheduleLogReasonInput({ reason: "kickoff" }), true);
  assert.equal(
    helpers.hasScheduleLogReasonInput({ reason: "", fallbackReason: "🤷 no reason given" }),
    true,
  );
});

test("counted scheduled reason logs one entry per changed task, prepends above an existing log, and skips unchanged tasks", () => {
  const input = [
    "- [ ] #task Alpha [scheduled:: 2026-07-01] ^alpha",
    "  - 🗓️ **SCHEDULE LOG**",
    "    - *2026-06-20 → 2026-07-01* — first push",
    "- [ ] #task Beta [scheduled:: 2026-07-10] ^beta",
    "- [ ] #task Gamma [scheduled:: 2026-07-05] ^gamma",
  ].join("\n");
  const session = helpers.discoverCountedObsidianTaskTargets(input, 0, 2);
  const plan = helpers.planCountedBulletPropertyBatch(
    input,
    session,
    "scheduled",
    "2026-07-10",
    {
      operation: "set",
      today: new Date(2026, 7, 1),
      scheduleLog: { reason: "sprint replan" },
    },
  );
  assert.equal(plan.valid, true);
  assert.equal(plan.changedTaskCount, 2);
  assert.equal(plan.unchangedTaskCount, 1);
  assert.equal(plan.scheduleLoggedTaskCount, 2);
  assert.equal(plan.scheduleLogCreatedParentCount, 1);
  assert.equal(plan.cursorLine, 0);
  assert.equal(
    plan.content,
    [
      "- [ ] #task Alpha [scheduled:: 2026-07-10] ^alpha",
      "  - 🗓️ **SCHEDULE LOG**",
      "    - *2026-07-01 → 2026-07-10* — sprint replan",
      "    - *2026-06-20 → 2026-07-01* — first push",
      "- [ ] #task Beta [scheduled:: 2026-07-10] ^beta",
      "- [ ] #task Gamma [scheduled:: 2026-07-10] ^gamma",
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-07-05 → 2026-07-10* — sprint replan",
    ].join("\n"),
  );
});

test("empty reason through the counted planner writes no schedule log entries", () => {
  const input = [
    "- [ ] #task Alpha [scheduled:: 2026-07-01] ^alpha",
    "- [ ] #task Beta [scheduled:: 2026-07-05] ^beta",
  ].join("\n");
  const session = helpers.discoverCountedObsidianTaskTargets(input, 0, 1);
  const withoutScheduleLog = helpers.planCountedBulletPropertyBatch(
    input,
    session,
    "scheduled",
    "2026-07-10",
    { operation: "set", today: new Date(2026, 7, 1) },
  );
  const withEmptyReason = helpers.planCountedBulletPropertyBatch(
    input,
    session,
    "scheduled",
    "2026-07-10",
    {
      operation: "set",
      today: new Date(2026, 7, 1),
      scheduleLog: { reason: "   " },
    },
  );
  assert.equal(withEmptyReason.content, withoutScheduleLog.content);
  assert.equal(withEmptyReason.scheduleLoggedTaskCount, 0);
  assert.equal(withEmptyReason.scheduleLogCreatedParentCount, 0);

  // Neither fixture task has a marker, so a fallback alone still creates
  // nothing: the fallback only ever fires on a task that already keeps a log.
  const withFallbackOnly = helpers.planCountedBulletPropertyBatch(
    input,
    session,
    "scheduled",
    "2026-07-10",
    {
      operation: "set",
      today: new Date(2026, 7, 1),
      scheduleLog: { reason: "   ", fallbackReason: "🤷 no reason given" },
    },
  );
  assert.equal(withFallbackOnly.content, withoutScheduleLog.content);
  assert.equal(withFallbackOnly.scheduleLoggedTaskCount, 0);
  assert.equal(withFallbackOnly.scheduleLogCreatedParentCount, 0);
  assert.equal(withFallbackOnly.scheduleLogFallbackTaskCount, 0);
});

test("a counted scheduled session logs only the tasks that already keep a log", () => {
  const input = [
    "- [ ] #task Alpha [scheduled:: 2026-07-01] ^alpha",
    "  - 🗓️ **SCHEDULE LOG**",
    "    - *2026-06-20 → 2026-07-01* — first push",
    "- [ ] #task Beta [scheduled:: 2026-07-05] ^beta",
    "- [ ] #task Gamma [scheduled:: 2026-07-20] ^gamma",
  ].join("\n");
  const session = helpers.discoverCountedObsidianTaskTargets(input, 0, 2);
  const plan = helpers.planCountedBulletPropertyBatch(
    input,
    session,
    "scheduled",
    "2026-07-20",
    {
      operation: "set",
      today: new Date(2026, 7, 1),
      scheduleLog: { reason: "   ", fallbackReason: "🤷 no reason given" },
    },
  );
  assert.equal(plan.valid, true);
  assert.equal(plan.scheduleLoggedTaskCount, 1);
  assert.equal(plan.scheduleLogFallbackTaskCount, 1);
  assert.equal(plan.scheduleLogCreatedParentCount, 0);
  assert.equal(plan.cursorLine, 0);
  assert.equal(
    plan.content,
    [
      "- [ ] #task Alpha [scheduled:: 2026-07-20] ^alpha",
      "  - 🗓️ **SCHEDULE LOG**",
      "    - *2026-07-01 → 2026-07-20* — 🤷 no reason given",
      "    - *2026-06-20 → 2026-07-01* — first push",
      "- [ ] #task Beta [scheduled:: 2026-07-20] ^beta",
      "- [ ] #task Gamma [scheduled:: 2026-07-20] ^gamma",
    ].join("\n"),
  );
});

test("the counted notice wording distinguishes a fallback batch from a typed-reason batch", async () => {
  const input = [
    "- [ ] #task Alpha [scheduled:: 2026-07-01] ^alpha",
    "  - 🗓️ **SCHEDULE LOG**",
    "    - *2026-06-20 → 2026-07-01* — first push",
    "- [ ] #task Beta [scheduled:: 2026-07-05] ^beta",
    "- [ ] #task Gamma [scheduled:: 2026-07-20] ^gamma",
  ].join("\n");
  const cursor = { line: 0, ch: 4 };
  const file = { path: "Tasks.md", extension: "md" };

  notices.length = 0;
  const fallbackSession = helpers.discoverCountedObsidianTaskTargets(input, 0, 2);
  const fallbackEditor = new TransactionEditor(input, cursor);
  const fallbackPlugin = new NavigationHotkeysPlugin();
  fallbackPlugin.getActiveMarkdownView = () => ({ editor: fallbackEditor, file });
  assert.equal(
    await fallbackPlugin.setCountedBulletPropertyValue(
      fallbackEditor,
      cursor,
      file.path,
      fallbackSession,
      "scheduled",
      "2026-07-20",
      { scheduleLog: { reason: "   ", fallbackReason: "🤷 no reason given" } },
    ),
    true,
  );
  assert.match(notices.at(-1), /; logged without a reason on 1 task$/);

  notices.length = 0;
  const typedSession = helpers.discoverCountedObsidianTaskTargets(input, 0, 2);
  const typedEditor = new TransactionEditor(input, cursor);
  const typedPlugin = new NavigationHotkeysPlugin();
  typedPlugin.getActiveMarkdownView = () => ({ editor: typedEditor, file });
  assert.equal(
    await typedPlugin.setCountedBulletPropertyValue(
      typedEditor,
      cursor,
      file.path,
      typedSession,
      "scheduled",
      "2026-07-20",
      { scheduleLog: { reason: "sprint replan" } },
    ),
    true,
  );
  assert.match(notices.at(-1), /; logged reason on 2 tasks$/);
});

test("setBulletPropertyValue writes an inline scheduled date plus a schedule log entry", async () => {
  notices.length = 0;
  const lines = [
    "- [ ] #task Ship the thing [scheduled:: 2026-08-13] ^ship",
    "  - some existing note",
  ];
  const editor = new TestEditor(lines.join("\n"));
  const file = { path: "Tasks.md", extension: "md" };
  const plugin = new NavigationHotkeysPlugin();
  plugin.getActiveMarkdownView = () => ({ editor, file });

  const wrote = await plugin.setBulletPropertyValue(
    editor,
    { line: 0, ch: 10 },
    "scheduled",
    "2026-08-20",
    {
      filePath: file.path,
      expectedLine: lines[0],
      today: new Date(2026, 7, 1),
      scheduleLog: {
        from: "2026-08-13",
        to: "2026-08-20",
        reason: "waiting on the API review to land",
      },
    },
  );
  assert.equal(wrote, true);
  assert.equal(
    editor.content,
    [
      "- [?] #task Ship the thing [scheduled:: 2026-08-20] ^ship",
      "  - some existing note",
      "  - 🗓️ **SCHEDULE LOG**",
      "  \t- *2026-08-13 → 2026-08-20* — waiting on the API review to land",
    ].join("\n"),
  );
  assert.match(notices.at(-1), /; created schedule log/);
});

test("setProjectNoteScheduledValue writes a schedule log entry under the ^prj task", async () => {
  notices.length = 0;
  const input = [
    "---",
    "type: [[project]]",
    "scheduled: 2026-08-13",
    "---",
    "- [ ] #task Ship ^prj",
  ].join("\n");
  const cursor = { line: 4, ch: 12 };
  const editor = new TransactionEditor(input, cursor, 700);
  const file = { path: "projects/Ship.md", extension: "md" };
  const plugin = new NavigationHotkeysPlugin();
  plugin.getActiveMarkdownView = () => ({ editor, file });

  const wrote = await plugin.setProjectNoteScheduledValue(
    editor,
    cursor,
    file.path,
    input.split(/\r?\n/)[4],
    "2026-08-13",
    "2026-08-20",
    {
      today: new Date(2026, 7, 1),
      scheduleLog: {
        from: "2026-08-13",
        to: "2026-08-20",
        reason: "waiting on the API review to land",
      },
    },
  );
  assert.equal(wrote, true);
  assert.match(editor.content, /^scheduled: 2026-08-20$/m);
  assert.match(
    editor.content,
    /- \[ \] #task Ship #hide \^prj\n\t- 🗓️ \*\*SCHEDULE LOG\*\*\n\t\t- \*2026-08-13 → 2026-08-20\* — waiting on the API review to land/,
  );
  assert.match(notices.at(-1), /logged reason/);
});

function buildScheduleReasonConfig() {
  return helpers.validateBulletPropertyConfig({
    properties: [
      { name: "scheduled", values: "date" },
      {
        name: "priority",
        values: "priority",
        levels: [{ label: "P1", value: "high", min_days: 1, max_days: 3 }],
      },
    ],
  });
}

test("choosing a scheduled date enters the reason stage without writing anything", () => {
  const config = buildScheduleReasonConfig();
  const lineText = "- [ ] #task Ship the thing ^ship";
  const editor = new TestEditor(lineText);
  const cursor = { line: 0, ch: 0 };
  const picker = new helpers.BulletPropertyPickerModal(
    {},
    {},
    editor,
    cursor,
    lineText,
    config,
    { filePath: "Tasks.md" },
  );

  const scheduledItem = picker.items.find(
    (item) => item.property.name === "scheduled",
  );
  assert.ok(scheduledItem);
  picker.showValueStage(scheduledItem);
  assert.equal(picker.stage, "value");

  const dateItem = picker.items.find((item) => item.kind === "value");
  assert.ok(dateItem);
  const opened = picker.openItem(dateItem);
  assert.equal(opened, false);
  assert.equal(picker.stage, "reason");
  assert.deepEqual(picker.pendingScheduleReason, {
    dateItem,
    from: "",
    to: dateItem.value,
  });
  assert.equal(editor.content, lineText);
});

test("choosing a priority level does not enter the reason stage", async () => {
  const harness = createBulletPropertyPickerHarness({
    config: createPriorityPickerConfig(),
    content: "- [ ] #task Ship the thing ^ship",
    baseDate: new Date(2026, 7, 3),
    random: () => 0,
  });
  assert.equal(harness.open(), true);
  const picker = harness.plugin.activeBulletPropertyPicker;

  const priorityItem = picker.items.find(
    (item) => item.property.name === "priority",
  );
  assert.ok(priorityItem);
  picker.showValueStage(priorityItem);

  const levelItem = picker.items.find(
    (item) => item.priorityLevel && item.label === "P1",
  );
  assert.ok(levelItem);
  await picker.openItem(levelItem);

  assert.equal(picker.stage, "value");
  assert.equal(picker.pendingScheduleReason, null);
  assert.equal(
    harness.editor.content,
    [
      "- [?] #task Ship the thing [priority:: high] [scheduled:: 2026-08-05] ^ship",
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-08-05* — 🎲 P0 → P1 · in **2** (2–7) days",
    ].join("\n"),
  );
});

test("confirming an empty reason on a task with an existing schedule log appends an unexplained entry", async () => {
  const harness = createBulletPropertyPickerHarness({
    config: buildScheduleReasonConfig(),
    content: [
      "- [ ] #task Ship the thing [scheduled:: 2026-08-13] ^ship",
      "  - 🗓️ **SCHEDULE LOG**",
      "    - *2026-08-06 → 2026-08-13* — was out sick",
    ].join("\n"),
    baseDate: new Date(2026, 7, 3),
  });
  notices.length = 0;
  const picker = await openBulletPropertyValueStage(harness, "scheduled");
  const dateIndex = picker.visibleItems.findIndex(
    (item) => item.label === "In 2 days",
  );
  assert.notEqual(dateIndex, -1);
  const dateValue = picker.visibleItems[dateIndex].value;
  await picker.openItemAtIndex(dateIndex);
  assert.equal(picker.stage, "reason");

  await confirmScheduleReasonStage(picker, "");

  assert.equal(
    harness.editor.content,
    [
      `- [ ] #task Ship the thing [scheduled:: ${dateValue}] ^ship`,
      "  - 🗓️ **SCHEDULE LOG**",
      `    - *2026-08-13 → ${dateValue}* — 🤷 no reason given`,
      "    - *2026-08-06 → 2026-08-13* — was out sick",
    ].join("\n"),
  );
  assert.match(notices.at(-1), /; logged without a reason/);
});

test("confirming an empty reason on a task with no schedule log writes only the date", async () => {
  const harness = createBulletPropertyPickerHarness({
    config: buildScheduleReasonConfig(),
    content: "- [ ] #task Ship the thing [scheduled:: 2026-08-13] ^ship",
    baseDate: new Date(2026, 7, 3),
  });
  notices.length = 0;
  const picker = await openBulletPropertyValueStage(harness, "scheduled");
  const dateIndex = picker.visibleItems.findIndex(
    (item) => item.label === "In 2 days",
  );
  assert.notEqual(dateIndex, -1);
  const dateValue = picker.visibleItems[dateIndex].value;
  await picker.openItemAtIndex(dateIndex);
  assert.equal(picker.stage, "reason");

  await confirmScheduleReasonStage(picker, "");

  assert.equal(
    harness.editor.content,
    `- [ ] #task Ship the thing [scheduled:: ${dateValue}] ^ship`,
  );
  assert.doesNotMatch(harness.editor.content, /SCHEDULE LOG/);
  assert.doesNotMatch(notices.at(-1), /schedule log/);
});

test("reason stage getFilteredItems always returns exactly one synthetic item", () => {
  const config = buildScheduleReasonConfig();
  const lineText = "- [ ] #task Ship the thing [scheduled:: 2026-08-13] ^ship";
  const editor = new TestEditor(lineText);
  const cursor = { line: 0, ch: 0 };
  const picker = new helpers.BulletPropertyPickerModal(
    {},
    {},
    editor,
    cursor,
    lineText,
    config,
    { filePath: "Tasks.md" },
  );
  const scheduledItem = picker.items.find(
    (item) => item.property.name === "scheduled",
  );
  picker.showValueStage(scheduledItem);
  const dateItem = picker.items.find((item) => item.kind === "value");
  picker.openItem(dateItem);
  assert.equal(picker.stage, "reason");

  picker.inputEl = { value: "" };
  const emptyItems = picker.getFilteredItems();
  assert.equal(emptyItems.length, 1);
  assert.equal(emptyItems[0].empty, true);

  picker.inputEl = { value: "waiting on the API review to land" };
  const typedItems = picker.getFilteredItems();
  assert.equal(typedItems.length, 1);
  assert.equal(typedItems[0].empty, false);
  assert.equal(typedItems[0].reason, "waiting on the API review to land");

  picker.inputEl = { value: "blocked:: x" };
  const warningItems = picker.getFilteredItems();
  assert.equal(warningItems.length, 1);
  assert.equal(warningItems[0].hasInlineField, true);
});

test("the preview row previews the entry it will write", () => {
  const config = buildScheduleReasonConfig();

  const markedLines = [
    "- [ ] #task Ship the thing [scheduled:: 2026-08-13] ^ship",
    "  - 🗓️ **SCHEDULE LOG**",
    "    - *2026-08-06 → 2026-08-13* — was out sick",
  ];
  const markedEditor = new TestEditor(markedLines.join("\n"));
  const markedPicker = new helpers.BulletPropertyPickerModal(
    {},
    {},
    markedEditor,
    { line: 0, ch: 0 },
    markedLines[0],
    config,
    { filePath: "Tasks.md" },
  );
  const markedScheduledItem = markedPicker.items.find(
    (item) => item.property.name === "scheduled",
  );
  markedPicker.showValueStage(markedScheduledItem);
  markedPicker.showScheduleReasonStage({ value: "2026-08-20" });
  markedPicker.inputEl = { value: "" };
  const markedItem = markedPicker.getFilteredItems()[0];
  assert.equal(markedItem.empty, true);
  assert.equal(markedItem.fallback, true);
  assert.equal(markedItem.parentExists, true);

  const unmarkedLines = ["- [ ] #task Ship the thing [scheduled:: 2026-08-13] ^ship"];
  const unmarkedEditor = new TestEditor(unmarkedLines.join("\n"));
  const unmarkedPicker = new helpers.BulletPropertyPickerModal(
    {},
    {},
    unmarkedEditor,
    { line: 0, ch: 0 },
    unmarkedLines[0],
    config,
    { filePath: "Tasks.md" },
  );
  const unmarkedScheduledItem = unmarkedPicker.items.find(
    (item) => item.property.name === "scheduled",
  );
  unmarkedPicker.showValueStage(unmarkedScheduledItem);
  unmarkedPicker.showScheduleReasonStage({ value: "2026-08-20" });
  unmarkedPicker.inputEl = { value: "" };
  const unmarkedItem = unmarkedPicker.getFilteredItems()[0];
  assert.equal(unmarkedItem.empty, true);
  assert.equal(unmarkedItem.fallback, false);
  assert.equal(unmarkedItem.parentExists, false);

  // Marker exists but the picked date equals the current one: still no
  // fallback, since a generated entry never claims a change that did not
  // happen.
  const sameDatePicker = new helpers.BulletPropertyPickerModal(
    {},
    {},
    markedEditor,
    { line: 0, ch: 0 },
    markedLines[0],
    config,
    { filePath: "Tasks.md" },
  );
  const sameDateScheduledItem = sameDatePicker.items.find(
    (item) => item.property.name === "scheduled",
  );
  sameDatePicker.showValueStage(sameDateScheduledItem);
  sameDatePicker.showScheduleReasonStage({ value: "2026-08-13" });
  sameDatePicker.inputEl = { value: "" };
  const sameDateItem = sameDatePicker.getFilteredItems()[0];
  assert.equal(sameDateItem.empty, true);
  assert.equal(sameDateItem.fallback, false);
});

test("the reason-stage footer hint flips between Skip reason and Log reason as the user types", () => {
  const config = buildScheduleReasonConfig();
  const lineText = "- [ ] #task Ship the thing ^ship";
  const editor = new TestEditor(lineText);
  const cursor = { line: 0, ch: 0 };
  const picker = new helpers.BulletPropertyPickerModal(
    {},
    {},
    editor,
    cursor,
    lineText,
    config,
    { filePath: "Tasks.md" },
  );
  const scheduledItem = picker.items.find(
    (item) => item.property.name === "scheduled",
  );
  picker.showValueStage(scheduledItem);
  const dateItem = picker.items.find((item) => item.kind === "value");
  picker.openItem(dateItem);
  assert.equal(picker.stage, "reason");

  // renderResults() drives real DOM rendering through the base class; stub it
  // out here so only this subclass override's post-super.renderResults()
  // footer-hint logic (the thing under test) actually runs.
  const originalRenderResults = helpers.FilteredPickerModal.prototype.renderResults;
  helpers.FilteredPickerModal.prototype.renderResults = function stubbedRenderResults() {
    this.visibleItems = this.getFilteredItems();
  };
  try {
    picker.inputEl = { value: "" };
    picker.renderResults();
    assert.match(
      picker.footerHints.find((hint) => hint.keys.includes("↵")).label,
      /^Skip reason$/,
    );

    picker.inputEl = { value: "waiting on the API review to land" };
    picker.renderResults();
    assert.match(
      picker.footerHints.find((hint) => hint.keys.includes("↵")).label,
      /^Log reason$/,
    );
  } finally {
    helpers.FilteredPickerModal.prototype.renderResults = originalRenderResults;
  }

  // A task that already keeps a log still gets "Log without a reason" instead
  // of "Skip reason", since ↵ on an empty input still writes something.
  const markedLines = [
    "- [ ] #task Ship the thing ^ship",
    "  - 🗓️ **SCHEDULE LOG**",
    "    - *2026-08-06* — was out sick",
  ];
  const markedEditor = new TestEditor(markedLines.join("\n"));
  const markedPicker = new helpers.BulletPropertyPickerModal(
    {},
    {},
    markedEditor,
    { line: 0, ch: 0 },
    markedLines[0],
    config,
    { filePath: "Tasks.md" },
  );
  const markedScheduledItem = markedPicker.items.find(
    (item) => item.property.name === "scheduled",
  );
  markedPicker.showValueStage(markedScheduledItem);
  const markedDateItem = markedPicker.items.find((item) => item.kind === "value");
  markedPicker.openItem(markedDateItem);
  assert.equal(markedPicker.stage, "reason");
  helpers.FilteredPickerModal.prototype.renderResults = function stubbedRenderResults() {
    this.visibleItems = this.getFilteredItems();
  };
  try {
    markedPicker.inputEl = { value: "" };
    markedPicker.renderResults();
    assert.match(
      markedPicker.footerHints.find((hint) => hint.keys.includes("↵")).label,
      /^Log without a reason$/,
    );

    markedPicker.inputEl = { value: "waiting on the API review to land" };
    markedPicker.renderResults();
    assert.match(
      markedPicker.footerHints.find((hint) => hint.keys.includes("↵")).label,
      /^Log reason$/,
    );
  } finally {
    helpers.FilteredPickerModal.prototype.renderResults = originalRenderResults;
  }
});

test("closing the picker during the reason stage clears pendingScheduleReason and writes nothing", () => {
  const config = buildScheduleReasonConfig();
  const lineText = "- [ ] #task Ship the thing ^ship";
  const editor = new TestEditor(lineText);
  const cursor = { line: 0, ch: 0 };
  const picker = new helpers.BulletPropertyPickerModal(
    {},
    {},
    editor,
    cursor,
    lineText,
    config,
    { filePath: "Tasks.md" },
  );
  const scheduledItem = picker.items.find(
    (item) => item.property.name === "scheduled",
  );
  picker.showValueStage(scheduledItem);
  const dateItem = picker.items.find((item) => item.kind === "value");
  picker.openItem(dateItem);
  assert.equal(picker.stage, "reason");
  assert.ok(picker.pendingScheduleReason);

  picker.onClose();

  assert.equal(picker.pendingScheduleReason, null);
  assert.equal(editor.content, lineText);
});

function buildDeferredPomodoroNoteIndex(paths) {
  return helpers.createScheduledRecoveryNoteIndex(
    paths.map((path) => ({ path })),
  );
}

test("isOpenPomodoroLedgerEntryLine recognizes every open status and rejects closed/indented/non-checkbox lines", () => {
  assert.equal(helpers.isOpenPomodoroLedgerEntryLine("- [ ] Future work"), true);
  assert.equal(helpers.isOpenPomodoroLedgerEntryLine("- [/] Working (0900-0930)"), true);
  assert.equal(helpers.isOpenPomodoroLedgerEntryLine("- [*] On hold"), true);
  assert.equal(helpers.isOpenPomodoroLedgerEntryLine("- [?] Blocked"), true);
  assert.equal(helpers.isOpenPomodoroLedgerEntryLine("- [x] Done (0900-0930)"), false);
  assert.equal(helpers.isOpenPomodoroLedgerEntryLine("- [X] Done"), false);
  assert.equal(helpers.isOpenPomodoroLedgerEntryLine("- [-] Cancelled"), false);
  assert.equal(helpers.isOpenPomodoroLedgerEntryLine("  - [ ] Indented child"), false);
  assert.equal(helpers.isOpenPomodoroLedgerEntryLine("Not a checkbox"), false);
});

test("findPomodorosSectionRange excludes frontmatter and fenced headings and stops at the next heading", () => {
  const content = [
    "---",
    "## Pomodoros",
    "---",
    "## Pomodoros",
    "- [ ] Entry",
    "```md",
    "## Pomodoros",
    "```",
    "  - [[Tasks#^x]]",
    "## Tasks",
    "- [ ] #task Other",
  ].join("\n");
  assert.deepEqual(helpers.findPomodorosSectionRange(content), {
    startLine: 3,
    endLine: 8,
  });
  assert.equal(helpers.findPomodorosSectionRange("# Just a note\nBody"), null);
});

test("collectPomodoroBlockLinkOccurrences captures embeds, aliases, same-note links, struck spans, and marker runs", () => {
  const plain = helpers.collectPomodoroBlockLinkOccurrences("  - [[Tasks#^x]]");
  assert.equal(plain.length, 1);
  assert.equal(plain[0].target, "Tasks");
  assert.equal(plain[0].blockId, "x");
  assert.equal(plain[0].embedded, false);
  assert.equal(plain[0].struck, false);
  assert.equal(plain[0].markerStart, null);

  assert.equal(
    helpers.collectPomodoroBlockLinkOccurrences("  - ![[Tasks#^x]]")[0].embedded,
    true,
  );
  assert.equal(
    helpers.collectPomodoroBlockLinkOccurrences("  - [[Tasks#^x|alias]]")[0]
      .blockId,
    "x",
  );
  assert.equal(
    helpers.collectPomodoroBlockLinkOccurrences("  - [[#^x]]")[0].target,
    "",
  );
  assert.equal(
    helpers.collectPomodoroBlockLinkOccurrences("  - ~~[[Tasks#^x]]~~")[0]
      .struck,
    true,
  );

  const marked = helpers.collectPomodoroBlockLinkOccurrences("  - 🍅 [[Tasks#^x]]");
  assert.equal(marked.length, 1);
  assert.equal(marked[0].markerStart, "  - ".length);

  const doubleMarked = helpers.collectPomodoroBlockLinkOccurrences(
    "  - 🍅 🍅 [[Tasks#^x]]",
  );
  assert.equal(doubleMarked.length, 1);
  assert.equal(doubleMarked[0].markerStart, "  - ".length);

  const mixed = helpers.collectPomodoroBlockLinkOccurrences(
    "Review [[a#^x]] and [[b#^y]]",
  );
  assert.equal(mixed.length, 2);
  assert.equal(mixed[0].target, "a");
  assert.equal(mixed[1].target, "b");
});

test("planDeferredPomodoroLinkCleanup is a clean no-op with no section, no open entries, or every entry closed", () => {
  const noteIndex = buildDeferredPomodoroNoteIndex([
    "2026/20260807.md",
    "Tasks.md",
  ]);
  const options = { dailyPath: "2026/20260807.md", noteIndex };
  const targets = [{ path: "Tasks.md", blockId: "x" }];

  const noSection = helpers.planDeferredPomodoroLinkCleanup(
    "# Daily\n- [ ] Something",
    targets,
    options,
  );
  assert.equal(noSection.changed, false);
  assert.equal(noSection.removedLinkCount, 0);

  const emptySection = helpers.planDeferredPomodoroLinkCleanup(
    "## Pomodoros\n",
    targets,
    options,
  );
  assert.equal(emptySection.changed, false);

  const everyClosed = [
    "## Pomodoros",
    "- [x] Done (0900-0930)",
    "  - [[Tasks#^x]]",
    "- [-] Cancelled",
    "  - [[Tasks#^x]]",
  ].join("\n");
  const closedResult = helpers.planDeferredPomodoroLinkCleanup(
    everyClosed,
    targets,
    options,
  );
  assert.equal(closedResult.changed, false);
  assert.equal(closedResult.removedLinkCount, 0);

  const noTargets = helpers.planDeferredPomodoroLinkCleanup(
    everyClosed,
    [],
    options,
  );
  assert.equal(noTargets.changed, false);
});

test("planDeferredPomodoroLinkCleanup leaves entry lines, bullets outside the section, and struck links untouched", () => {
  const noteIndex = buildDeferredPomodoroNoteIndex([
    "2026/20260807.md",
    "Tasks.md",
  ]);
  const targets = [{ path: "Tasks.md", blockId: "x" }];
  const content = [
    "- [[Tasks#^x]]",
    "## Pomodoros",
    "- [ ] Current [[Tasks#^x]] (0900-0930)",
    "  - ~~[[Tasks#^x]]~~",
  ].join("\n");
  const result = helpers.planDeferredPomodoroLinkCleanup(content, targets, {
    dailyPath: "2026/20260807.md",
    noteIndex,
  });
  assert.equal(result.changed, false);
  assert.equal(result.removedLinkCount, 0);
});

test("planDeferredPomodoroLinkCleanup removes a dedicated link bullet and its nested children", () => {
  const noteIndex = buildDeferredPomodoroNoteIndex([
    "2026/20260807.md",
    "Tasks.md",
  ]);
  const targets = [{ path: "Tasks.md", blockId: "child" }];
  const content = [
    "## Pomodoros",
    "",
    "- [ ] Current (0900-0930)",
    "  - [[Tasks#^child]]",
    "    - nested detail",
    "    - [[Tasks#^grandchild-not-a-target]]",
    "  - keep me",
    "- [x] Done (0930-1000)",
  ].join("\n");
  const result = helpers.planDeferredPomodoroLinkCleanup(content, targets, {
    dailyPath: "2026/20260807.md",
    noteIndex,
  });
  assert.equal(result.changed, true);
  assert.equal(result.removedBulletCount, 1);
  assert.equal(result.removedLinkCount, 1);
  assert.deepEqual(result.removedTargets, [{ path: "Tasks.md", blockId: "child" }]);
  assert.equal(
    result.content,
    [
      "## Pomodoros",
      "",
      "- [ ] Current (0900-0930)",
      "  - keep me",
      "- [x] Done (0930-1000)",
    ].join("\n"),
  );
});

test("planDeferredPomodoroLinkCleanup removes an embed and resolves same-note and explicit-path-vs-basename links", () => {
  const noteIndex = buildDeferredPomodoroNoteIndex([
    "2026/20260807.md",
    "Areas/Notes.md",
  ]);
  const targets = [
    { path: "2026/20260807.md", blockId: "here" },
    { path: "Areas/Notes.md", blockId: "shared" },
    { path: "Areas/Notes.md", blockId: "embedded" },
  ];
  const content = [
    "## Pomodoros",
    "",
    "- [ ] Current (0900-0930)",
    "  - [[#^here]]",
    "  - [[Areas/Notes#^shared]]",
    "  - [[Notes#^shared]]",
    "  - ![[Notes#^embedded]]",
  ].join("\n");
  const result = helpers.planDeferredPomodoroLinkCleanup(content, targets, {
    dailyPath: "2026/20260807.md",
    noteIndex,
  });
  assert.equal(result.removedBulletCount, 4);
  assert.equal(result.removedLinkCount, 4);
  assert.equal(result.unresolvedCount, 0);
  assert.equal(
    result.content,
    ["## Pomodoros", "", "- [ ] Current (0900-0930)"].join("\n"),
  );
});

test("planDeferredPomodoroLinkCleanup skips an ambiguous basename as unresolved and never guesses", () => {
  // No root-level "Tasks.md" exists, so the bare `[[Tasks#^amb]]` link cannot
  // resolve via an exact-path match and falls to the (colliding) basename map.
  const noteIndex = buildDeferredPomodoroNoteIndex([
    "2026/20260807.md",
    "Areas/Tasks.md",
    "Projects/Tasks.md",
  ]);
  const targets = [{ path: "Areas/Tasks.md", blockId: "amb" }];
  const content = [
    "## Pomodoros",
    "",
    "- [ ] Current (0900-0930)",
    "  - [[Tasks#^amb]]",
  ].join("\n");
  const result = helpers.planDeferredPomodoroLinkCleanup(content, targets, {
    dailyPath: "2026/20260807.md",
    noteIndex,
  });
  assert.equal(result.changed, false);
  assert.equal(result.removedLinkCount, 0);
  assert.equal(result.unresolvedCount, 1);
});

test("planDeferredPomodoroLinkCleanup removes only the matched token on a mixed-content bullet and normalizes spacing", () => {
  const noteIndex = buildDeferredPomodoroNoteIndex([
    "2026/20260807.md",
    "Tasks.md",
  ]);
  const targets = [{ path: "Tasks.md", blockId: "mixed" }];
  const content = [
    "## Pomodoros",
    "",
    "- [ ] Current (0900-0930)",
    "  - Review [[Tasks#^mixed]] before lunch",
  ].join("\n");
  const result = helpers.planDeferredPomodoroLinkCleanup(content, targets, {
    dailyPath: "2026/20260807.md",
    noteIndex,
  });
  assert.equal(result.removedBulletCount, 0);
  assert.equal(result.removedLinkCount, 1);
  assert.equal(
    result.content,
    [
      "## Pomodoros",
      "",
      "- [ ] Current (0900-0930)",
      "  - Review before lunch",
    ].join("\n"),
  );
});

test("planDeferredPomodoroLinkCleanup treats two matched links on one bullet as a single dedicated subtree deletion", () => {
  const noteIndex = buildDeferredPomodoroNoteIndex([
    "2026/20260807.md",
    "Tasks.md",
  ]);
  const targets = [
    { path: "Tasks.md", blockId: "two-a" },
    { path: "Tasks.md", blockId: "two-b" },
  ];
  const content = [
    "## Pomodoros",
    "",
    "- [ ] Current (0900-0930)",
    "  - [[Tasks#^two-a]] [[Tasks#^two-b]]",
  ].join("\n");
  const result = helpers.planDeferredPomodoroLinkCleanup(content, targets, {
    dailyPath: "2026/20260807.md",
    noteIndex,
  });
  assert.equal(result.removedBulletCount, 1);
  assert.equal(result.removedLinkCount, 2);
  assert.equal(
    result.content,
    ["## Pomodoros", "", "- [ ] Current (0900-0930)"].join("\n"),
  );
});

test("planDeferredPomodoroLinkCleanup consumes a stray Pomodoro marker with its link and skips fenced code", () => {
  const noteIndex = buildDeferredPomodoroNoteIndex([
    "2026/20260807.md",
    "Tasks.md",
  ]);
  const targets = [
    { path: "Tasks.md", blockId: "marked" },
    { path: "Tasks.md", blockId: "fenced" },
  ];
  const content = [
    "## Pomodoros",
    "",
    "- [ ] Current (0900-0930)",
    "  - 🍅 [[Tasks#^marked]]",
    "  - See also:",
    "  ```md",
    "  - [[Tasks#^fenced]]",
    "  ```",
  ].join("\n");
  const result = helpers.planDeferredPomodoroLinkCleanup(content, targets, {
    dailyPath: "2026/20260807.md",
    noteIndex,
  });
  assert.equal(result.removedBulletCount, 1);
  assert.equal(result.removedLinkCount, 1);
  assert.equal(
    result.content,
    [
      "## Pomodoros",
      "",
      "- [ ] Current (0900-0930)",
      "  - See also:",
      "  ```md",
      "  - [[Tasks#^fenced]]",
      "  ```",
    ].join("\n"),
  );
});

test("planDeferredPomodoroLinkCleanup preserves CRLF line endings", () => {
  const noteIndex = buildDeferredPomodoroNoteIndex([
    "2026/20260807.md",
    "Tasks.md",
  ]);
  const targets = [{ path: "Tasks.md", blockId: "x" }];
  const content = [
    "## Pomodoros",
    "",
    "- [ ] Current (0900-0930)",
    "  - [[Tasks#^x]]",
    "- [x] Done (0930-1000)",
  ].join("\r\n");
  const result = helpers.planDeferredPomodoroLinkCleanup(content, targets, {
    dailyPath: "2026/20260807.md",
    noteIndex,
  });
  assert.equal(result.content.includes("\r\n"), true);
  assert.equal(
    result.content,
    ["## Pomodoros", "", "- [ ] Current (0900-0930)", "- [x] Done (0930-1000)"].join(
      "\r\n",
    ),
  );
});

test("deferredPomodoroTargetsFromLines resolves block IDs and skips lines with none", () => {
  const lines = [
    "- [ ] #task With ID ^has-id",
    "- [ ] #task Without ID",
  ];
  assert.deepEqual(
    helpers.deferredPomodoroTargetsFromLines("Tasks.md", lines, [0, 1]),
    [{ path: "Tasks.md", blockId: "has-id" }],
  );
  assert.deepEqual(
    helpers.deferredPomodoroTargetsFromLines("Tasks.md", lines, []),
    [],
  );
});

test("planCountedBulletPropertyBatch reports futureScheduledTaskLines for a mixed priority-roll batch", () => {
  const today = new Date();
  const todayValue = helpers.formatBulletPropertyDate(today);
  const year = String(today.getFullYear() + 5).padStart(4, "0");
  const source = [
    "- [ ] #task Future one ^future-one",
    "- [ ] #task Today ^today",
    "- [ ] #task Future two ^future-two",
    "- [ ] #task No block id",
  ].join("\n");
  const session = helpers.discoverCountedObsidianTaskTargets(source, 0, 3);
  const scheduledValueByLine = new Map([
    [0, `${year}-01-01`],
    [1, todayValue],
    [2, `${year}-01-02`],
    [3, `${year}-01-03`],
  ]);
  const plan = helpers.planCountedBulletPropertyBatch(
    source,
    session,
    "p",
    null,
    {
      operation: "set-priority",
      priorityValue: "🔺",
      scheduledPropertyName: "scheduled",
      scheduledValueByLine,
      today,
    },
  );
  assert.equal(plan.valid, true);
  assert.deepEqual(plan.futureScheduledTaskLines.slice().sort(), [0, 2, 3]);
});

test("planProjectTaskSchedules and planProjectScheduledUpdate report futureScheduledTaskLines including the ^prj line", () => {
  const today = new Date();
  const year = String(today.getFullYear() + 5).padStart(4, "0");
  const content = [
    "---",
    "type: [[project]]",
    "---",
    "- [ ] #task Ship #hide ^prj",
    "- [ ] #task Follows ^follows",
  ].join("\n");
  const propagation = helpers.planProjectTaskSchedules(
    content,
    `${year}-01-01`,
    today,
  );
  assert.equal(propagation.valid, true);
  assert.equal(propagation.future, true);
  assert.deepEqual(propagation.futureScheduledTaskLines.slice().sort(), [3, 4]);

  const update = helpers.planProjectScheduledUpdate(
    content,
    3,
    `${year}-01-01`,
    today,
  );
  assert.equal(update.valid, true);
  assert.deepEqual(update.futureScheduledTaskLines.slice().sort(), [3, 4]);
});

function getTodayDailyFile() {
  const today = new Date();
  const year = String(today.getFullYear()).padStart(4, "0");
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return { path: `${year}/${year}${month}${day}.md`, extension: "md" };
}

test("runtime: a future scheduled write prunes the task's live link from today's open Pomodoro", async () => {
  notices.length = 0;
  const line = "- [ ] #task Ship it ^ship";
  const editor = new TransactionEditor(line, { line: 0, ch: 0 }, 500);
  const sourceFile = { path: "Tasks.md", extension: "md" };
  const today = new Date();
  const year = String(today.getFullYear()).padStart(4, "0");
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  const dailyPath = `${year}/${year}${month}${day}.md`;
  const dailyFile = { path: dailyPath, extension: "md" };
  const dailyContent = [
    "## Pomodoros",
    "",
    "- [ ] Current (0900-0930)",
    "  - [[Tasks#^ship]]",
  ].join("\n");
  const contents = new Map([
    [sourceFile.path, line],
    [dailyFile.path, dailyContent],
  ]);
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getLeavesOfType: () => [] },
    vault: {
      getMarkdownFiles: () => [sourceFile, dailyFile],
      cachedRead: async (file) => contents.get(file.path),
      process: async (file, transform) => {
        contents.set(file.path, transform(contents.get(file.path)));
      },
      adapter: { read: async () => JSON.stringify(compatibleTasksSettings()) },
    },
  };
  plugin.getActiveMarkdownView = () => ({ editor, file: sourceFile });

  const futureDate = `${Number(year) + 5}-01-01`;
  assert.equal(
    await plugin.setBulletPropertyValue(
      editor,
      { line: 0, ch: 0 },
      "scheduled",
      futureDate,
      { filePath: sourceFile.path, expectedLine: line },
    ),
    true,
  );
  assert.match(editor.content, /\[\?\]/);
  assert.equal(
    contents.get(dailyFile.path),
    ["## Pomodoros", "", "- [ ] Current (0900-0930)"].join("\n"),
  );
  assert.match(notices.at(-1), /removed 1 Pomodoro link/);
});

test("runtime: a due (non-future) scheduled write does not touch today's Pomodoro links", async () => {
  notices.length = 0;
  const line = "- [?] #task Ship it [scheduled:: 2000-01-01] ^ship";
  const editor = new TransactionEditor(line, { line: 0, ch: 0 }, 500);
  const sourceFile = { path: "Tasks.md", extension: "md" };
  const today = new Date();
  const year = String(today.getFullYear()).padStart(4, "0");
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  const dailyPath = `${year}/${year}${month}${day}.md`;
  const dailyFile = { path: dailyPath, extension: "md" };
  const dailyContent = [
    "## Pomodoros",
    "",
    "- [ ] Current (0900-0930)",
    "  - [[Tasks#^ship]]",
  ].join("\n");
  const contents = new Map([
    [sourceFile.path, line],
    [dailyFile.path, dailyContent],
  ]);
  const plugin = new NavigationHotkeysPlugin();
  let processCalled = false;
  plugin.app = {
    workspace: { getLeavesOfType: () => [] },
    vault: {
      getMarkdownFiles: () => [sourceFile, dailyFile],
      cachedRead: async (file) => contents.get(file.path),
      process: async () => {
        processCalled = true;
      },
      adapter: { read: async () => JSON.stringify(compatibleTasksSettings()) },
    },
  };
  plugin.getActiveMarkdownView = () => ({ editor, file: sourceFile });

  assert.equal(
    await plugin.setBulletPropertyValue(
      editor,
      { line: 0, ch: 0 },
      "scheduled",
      "2000-01-01",
      { filePath: sourceFile.path, expectedLine: line },
    ),
    true,
  );
  assert.equal(processCalled, false);
  assert.equal(contents.get(dailyFile.path), dailyContent);
  assert.doesNotMatch(notices.at(-1), /Pomodoro link/);
});

test("runtime: no daily note today still writes the schedule with no Pomodoro chip", async () => {
  notices.length = 0;
  const line = "- [ ] #task Ship it ^ship";
  const editor = new TransactionEditor(line, { line: 0, ch: 0 }, 500);
  const sourceFile = { path: "Tasks.md", extension: "md" };
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getLeavesOfType: () => [] },
    vault: {
      getMarkdownFiles: () => [sourceFile],
      cachedRead: async () => line,
      adapter: { read: async () => JSON.stringify(compatibleTasksSettings()) },
    },
  };
  plugin.getActiveMarkdownView = () => ({ editor, file: sourceFile });

  assert.equal(
    await plugin.setBulletPropertyValue(
      editor,
      { line: 0, ch: 0 },
      "scheduled",
      "2099-01-01",
      { filePath: sourceFile.path, expectedLine: line },
    ),
    true,
  );
  assert.match(editor.content, /\[scheduled:: 2099-01-01\]/);
  assert.doesNotMatch(notices.at(-1), /Pomodoro link/);
});

test("runtime: daily note preimage changed under the snapshot keeps the schedule and reports not removed", async () => {
  notices.length = 0;
  const line = "- [ ] #task Ship it ^ship";
  const editor = new TransactionEditor(line, { line: 0, ch: 0 }, 500);
  const sourceFile = { path: "Tasks.md", extension: "md" };
  const dailyFile = getTodayDailyFile();
  const dailyContent = [
    "## Pomodoros",
    "",
    "- [ ] Current (0900-0930)",
    "  - [[Tasks#^ship]]",
  ].join("\n");
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getLeavesOfType: () => [] },
    vault: {
      getMarkdownFiles: () => [sourceFile, dailyFile],
      cachedRead: async (file) =>
        file.path === sourceFile.path ? line : `${dailyContent}\nchanged underfoot`,
      process: async () => {
        throw new Error("preimage check should reject before process runs");
      },
      adapter: { read: async () => JSON.stringify(compatibleTasksSettings()) },
    },
  };
  plugin.getActiveMarkdownView = () => ({ editor, file: sourceFile });
  const originalScheduledRecoveryDailyPaths = helpers.scheduledRecoveryDailyPaths;

  assert.equal(
    await plugin.setBulletPropertyValue(
      editor,
      { line: 0, ch: 0 },
      "scheduled",
      "2099-01-01",
      { filePath: sourceFile.path, expectedLine: line },
    ),
    true,
  );
  assert.match(editor.content, /\[scheduled:: 2099-01-01\]/);
  assert.match(notices.at(-1), /Pomodoro links not removed/);
});

test("runtime: vault.process throwing during the daily-note write is reported without throwing", async () => {
  notices.length = 0;
  const line = "- [ ] #task Ship it ^ship";
  const editor = new TransactionEditor(line, { line: 0, ch: 0 }, 500);
  const sourceFile = { path: "Tasks.md", extension: "md" };
  const dailyFile = getTodayDailyFile();
  const dailyContent = [
    "## Pomodoros",
    "",
    "- [ ] Current (0900-0930)",
    "  - [[Tasks#^ship]]",
  ].join("\n");
  const contents = new Map([
    [sourceFile.path, line],
    [dailyFile.path, dailyContent],
  ]);
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getLeavesOfType: () => [] },
    vault: {
      getMarkdownFiles: () => [sourceFile, dailyFile],
      cachedRead: async (file) => contents.get(file.path),
      process: async () => {
        throw new Error("injected vault.process failure");
      },
      adapter: { read: async () => JSON.stringify(compatibleTasksSettings()) },
    },
  };
  plugin.getActiveMarkdownView = () => ({ editor, file: sourceFile });

  assert.equal(
    await plugin.setBulletPropertyValue(
      editor,
      { line: 0, ch: 0 },
      "scheduled",
      "2099-01-01",
      { filePath: sourceFile.path, expectedLine: line },
    ),
    true,
  );
  assert.match(editor.content, /\[scheduled:: 2099-01-01\]/);
  assert.equal(contents.get(dailyFile.path), dailyContent);
  assert.match(notices.at(-1), /Pomodoro links not removed/);
});

test("runtime: the daily note open in another editor is written through that editor in its own transaction", async () => {
  notices.length = 0;
  const line = "- [ ] #task Ship it ^ship";
  const editor = new TransactionEditor(line, { line: 0, ch: 0 }, 500);
  const sourceFile = { path: "Tasks.md", extension: "md" };
  const dailyFile = getTodayDailyFile();
  const dailyContent = [
    "## Pomodoros",
    "",
    "- [ ] Current (0900-0930)",
    "  - [[Tasks#^ship]]",
  ].join("\n");
  const dailyEditor = new TransactionEditor(dailyContent, { line: 3, ch: 0 }, 900);
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getLeavesOfType: () => [] },
    vault: {
      getMarkdownFiles: () => [sourceFile, dailyFile],
      cachedRead: async () => {
        throw new Error("open editors should not use vault.cachedRead");
      },
      process: async () => {
        throw new Error("open editors should not use vault.process");
      },
      adapter: { read: async () => JSON.stringify(compatibleTasksSettings()) },
    },
  };
  plugin.getActiveMarkdownView = () => ({ editor, file: sourceFile });
  plugin.getOpenMarkdownEditorForPath = (path) =>
    path === sourceFile.path
      ? editor
      : path === dailyFile.path
        ? dailyEditor
        : null;

  assert.equal(
    await plugin.setBulletPropertyValue(
      editor,
      { line: 0, ch: 0 },
      "scheduled",
      "2099-01-01",
      { filePath: sourceFile.path, expectedLine: line },
    ),
    true,
  );
  assert.equal(dailyEditor.transactions.length, 1);
  assert.equal(dailyEditor.undoGroups, 1);
  assert.equal(
    dailyEditor.content,
    ["## Pomodoros", "", "- [ ] Current (0900-0930)"].join("\n"),
  );
  assert.match(notices.at(-1), /removed 1 Pomodoro link/);
});

test("runtime: re-running the same deferral gesture is idempotent", async () => {
  notices.length = 0;
  const line = "- [?] #task Ship it [scheduled:: 2099-01-01] ^ship";
  const editor = new TransactionEditor(line, { line: 0, ch: 0 }, 500);
  const sourceFile = { path: "Tasks.md", extension: "md" };
  const dailyFile = getTodayDailyFile();
  const dailyContent = ["## Pomodoros", "", "- [ ] Current (0900-0930)"].join("\n");
  const contents = new Map([
    [sourceFile.path, line],
    [dailyFile.path, dailyContent],
  ]);
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getLeavesOfType: () => [] },
    vault: {
      getMarkdownFiles: () => [sourceFile, dailyFile],
      cachedRead: async (file) => contents.get(file.path),
      process: async (file, transform) => {
        contents.set(file.path, transform(contents.get(file.path)));
      },
      adapter: { read: async () => JSON.stringify(compatibleTasksSettings()) },
    },
  };
  plugin.getActiveMarkdownView = () => ({ editor, file: sourceFile });

  assert.equal(
    await plugin.setBulletPropertyValue(
      editor,
      { line: 0, ch: 0 },
      "scheduled",
      "2099-01-01",
      { filePath: sourceFile.path, expectedLine: line },
    ),
    true,
  );
  assert.equal(contents.get(dailyFile.path), dailyContent);
  assert.doesNotMatch(notices.at(-1), /Pomodoro link/);
});

test("runtime: a counted scheduled batch prunes exactly the targets that land on a future date", async () => {
  notices.length = 0;
  const today = new Date();
  const year = String(today.getFullYear() + 5).padStart(4, "0");
  const source = [
    "- [ ] #task One ^one",
    "- [ ] #task Two ^two",
    "- [ ] #task Three ^three",
  ].join("\n");
  const editor = new TransactionEditor(source, { line: 0, ch: 0 }, 500);
  const sourceFile = { path: "Tasks.md", extension: "md" };
  const dailyFile = getTodayDailyFile();
  const dailyContent = [
    "## Pomodoros",
    "",
    "- [ ] Current (0900-0930)",
    "  - [[Tasks#^one]]",
    "  - [[Tasks#^two]]",
    "  - [[Tasks#^three]]",
  ].join("\n");
  const contents = new Map([
    [sourceFile.path, source],
    [dailyFile.path, dailyContent],
  ]);
  const session = helpers.discoverCountedObsidianTaskTargets(source, 0, 1);
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getLeavesOfType: () => [] },
    vault: {
      getMarkdownFiles: () => [sourceFile, dailyFile],
      cachedRead: async (file) => contents.get(file.path),
      process: async (file, transform) => {
        contents.set(file.path, transform(contents.get(file.path)));
      },
      adapter: { read: async () => JSON.stringify(compatibleTasksSettings()) },
    },
  };
  plugin.getActiveMarkdownView = () => ({ editor, file: sourceFile });

  assert.equal(
    await plugin.setCountedBulletPropertyValue(
      editor,
      { line: 0, ch: 0 },
      sourceFile.path,
      session,
      "scheduled",
      `${year}-01-01`,
    ),
    true,
  );
  assert.equal(
    contents.get(dailyFile.path),
    ["## Pomodoros", "", "- [ ] Current (0900-0930)", "  - [[Tasks#^three]]"].join(
      "\n",
    ),
  );
  assert.match(notices.at(-1), /removed 2 Pomodoro links/);
});

test("runtime: a ^prj project schedule prunes the propagated tasks and the ^prj link itself", async () => {
  notices.length = 0;
  const today = new Date();
  const year = String(today.getFullYear() + 5).padStart(4, "0");
  const input = [
    "---",
    "type: [[project]]",
    "scheduled: 2000-01-01",
    "---",
    "- [ ] #task Ship #hide ^prj",
    "- [ ] #task Follows ^follows",
  ].join("\n");
  const cursor = { line: 4, ch: 0 };
  const editor = new TransactionEditor(input, cursor, 700);
  const sourceFile = { path: "projects/Ship.md", extension: "md" };
  const dailyFile = getTodayDailyFile();
  const dailyContent = [
    "## Pomodoros",
    "",
    "- [ ] Current (0900-0930)",
    "  - [[projects/Ship#^prj]]",
    "  - [[projects/Ship#^follows]]",
  ].join("\n");
  const contents = new Map([
    [sourceFile.path, input],
    [dailyFile.path, dailyContent],
  ]);
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getLeavesOfType: () => [] },
    vault: {
      getMarkdownFiles: () => [sourceFile, dailyFile],
      cachedRead: async (file) => contents.get(file.path),
      process: async (file, transform) => {
        contents.set(file.path, transform(contents.get(file.path)));
      },
      adapter: { read: async () => JSON.stringify(compatibleTasksSettings()) },
    },
  };
  plugin.getActiveMarkdownView = () => ({ editor, file: sourceFile });

  assert.equal(
    await plugin.setProjectNoteScheduledValue(
      editor,
      cursor,
      sourceFile.path,
      input.split(/\r?\n/)[4],
      "2000-01-01",
      `${year}-01-01`,
    ),
    true,
  );
  assert.equal(
    contents.get(dailyFile.path),
    ["## Pomodoros", "", "- [ ] Current (0900-0930)"].join("\n"),
  );
  assert.match(notices.at(-1), /removed 2 Pomodoro links/);
});

test("runtime: the source note being today's daily note folds the prune into a single editor transaction", async () => {
  notices.length = 0;
  const content = [
    "## Pomodoros",
    "",
    "- [ ] Current (0900-0930)",
    "  - [[#^linked]]",
    "",
    "## Tasks",
    "",
    "- [ ] #task Linked elsewhere ^linked",
  ].join("\n");
  const cursor = { line: 7, ch: 0 };
  const editor = new TransactionEditor(content, cursor, 500);
  const dailyFile = getTodayDailyFile();
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getLeavesOfType: () => [] },
    vault: {
      getMarkdownFiles: () => [dailyFile],
      cachedRead: async () => content,
      adapter: { read: async () => JSON.stringify(compatibleTasksSettings()) },
    },
  };
  plugin.getActiveMarkdownView = () => ({ editor, file: dailyFile });

  assert.equal(
    await plugin.setBulletPropertyValue(
      editor,
      cursor,
      "scheduled",
      "2099-01-01",
      {
        filePath: dailyFile.path,
        expectedLine: content.split(/\r?\n/)[7],
      },
    ),
    true,
  );
  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.undoGroups, 1);
  assert.equal(
    editor.content,
    [
      "## Pomodoros",
      "",
      "- [ ] Current (0900-0930)",
      "",
      "## Tasks",
      "",
      "- [?] #task Linked elsewhere [scheduled:: 2099-01-01] ^linked",
    ].join("\n"),
  );
  assert.match(notices.at(-1), /removed 1 Pomodoro link/);
});
