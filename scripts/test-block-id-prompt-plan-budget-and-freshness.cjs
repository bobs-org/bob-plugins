const test = require("node:test");
const assert = require("node:assert/strict");
const {
  Plugin,
  helpers,
  noticeMessages,
  resetNotices,
  lastNotice,
  localDate,
  createEditor,
  selectTaskLink,
  createTaskLinkHarness,
  NEXT_TASK,
  DAILY_WITH_LINKS,
} = require("./block-id-prompt-harness.cjs");

function stubPlanBudgetApi(plugin, budget) {
  const seen = [];
  plugin.app.plugins = {
    plugins: {
      "bob-ledger-tools": {
        api: {
          planBudget: (options) => {
            seen.push(options && options.content);
            return budget;
          },
        },
      },
    },
  };
  return seen;
}

const PLAN_BUDGET_OK = {
  status: "ok",
  themes: { count: 1, cap: 3, over: false },
  links: { count: 2, cap: 10, over: false },
};

const PLAN_BUDGET_OVER = {
  status: "over",
  themes: { count: 4, cap: 3, over: true },
  links: { count: 11, cap: 10, over: true },
};

test("plan budget suffix: link Notice appends the meter computed on post-write daily content", async () => {
  const h = createTaskLinkHarness({
    files: {
      "Daily.md": "## Pomodoros\n- [ ] Current ()",
      "Tasks.md": "- [ ] #task Ship it ^ship",
    },
    activePath: "Tasks.md",
    cursor: { line: 0, ch: 4 },
  });
  h.plugin.resolveTaskFile = (path) => (path === "Tasks.md" ? { path: "Tasks.md" } : null);
  const seen = stubPlanBudgetApi(h.plugin, PLAN_BUDGET_OK);

  await h.plugin.openPomodoroTaskLink(h.editor, h.view);

  assert.deepEqual(noticeMessages, ["Linked to Current · Next · plan 1/3 · 2/10"]);
  assert.equal(seen.length, 2);
  assert.ok(
    !seen[0].includes("[[Tasks#^ship]]"),
    "picker meter runs on the pre-write daily content",
  );
  assert.ok(
    seen[1].includes("[[Tasks#^ship]]"),
    "budget runs on the post-write daily content",
  );
});

test("plan budget suffix: link Notice omits the meter when the ledger-tools API is missing", async () => {
  const h = createTaskLinkHarness({
    files: {
      "Daily.md": "## Pomodoros\n- [ ] Current ()",
      "Tasks.md": "- [ ] #task Ship it ^ship",
    },
    activePath: "Tasks.md",
    cursor: { line: 0, ch: 4 },
  });
  h.plugin.resolveTaskFile = (path) => (path === "Tasks.md" ? { path: "Tasks.md" } : null);

  await h.plugin.openPomodoroTaskLink(h.editor, h.view);

  assert.deepEqual(noticeMessages, ["Linked to Current · Next"]);
});

test("plan budget suffix: unlink Notice marks an over-cap plan with 🔴", async () => {
  const h = createTaskLinkHarness({
    files: {
      "Daily.md": "## Pomodoros\n- [ ] Current ()\n  - [[Tasks#^ship]]",
      "Tasks.md": NEXT_TASK,
    },
    activePath: "Tasks.md",
    cursor: { line: 0, ch: 4 },
  });
  h.plugin.resolveTaskFile = (path) => (path === "Tasks.md" ? { path: "Tasks.md" } : null);
  stubPlanBudgetApi(h.plugin, PLAN_BUDGET_OVER);

  await h.plugin.openPomodoroTaskLink(h.editor, h.view);

  assert.deepEqual(noticeMessages, [
    "Unlinked · stays Next · plan 4/3 · 11/10 🔴",
  ]);
});

test("plan budget suffix: Next task without a block ID prompts for one and omits the meter", async () => {
  const h = createTaskLinkHarness({
    files: {
      "Daily.md": "## Pomodoros\n- [ ] Current ()",
      "Tasks.md": "- [*] #task Ship it",
    },
    activePath: "Tasks.md",
    cursor: { line: 0, ch: 4 },
  });
  const seen = stubPlanBudgetApi(h.plugin, PLAN_BUDGET_OK);
  let prompted = false;
  h.plugin.openBlockIdPrompt = () => {
    prompted = true;
  };

  await h.plugin.openPomodoroTaskLink(h.editor, h.view);

  assert.equal(prompted, true);
  assert.deepEqual(noticeMessages, []);
  assert.equal(seen.length, 1);
  assert.ok(
    !seen[0].includes("[[Tasks#^"),
    "picker meter runs before any link is written",
  );
});

test("plan budget suffix: Task Link Notice appends the meter from post-write daily content", async () => {
  const h = createTaskLinkHarness({
    files: { "Daily.md": DAILY_WITH_LINKS, "Tasks.md": NEXT_TASK },
    activePath: "Daily.md",
    cursor: { line: 2, ch: 6 },
  });
  const seen = stubPlanBudgetApi(h.plugin, PLAN_BUDGET_OK);

  await h.plugin.openPomodoroTaskLink(h.editor, h.view);

  assert.deepEqual(noticeMessages, [
    "Task Link removed · stays Next · plan 1/3 · 2/10",
  ]);
  assert.equal(seen.length, 1);
  assert.ok(seen[0].includes("## Pomodoros"), "budget runs on daily content");
  assert.ok(!seen[0].includes("nested note"), "budget runs after the link deletion");
});

test("plan budget suffix: Task Link Notice omits the meter when no daily note takes part", async () => {
  const active = "# Notes\n- see [[Tasks#^ship]] now";
  const h = createTaskLinkHarness({
    files: { "Notes.md": active, "Tasks.md": NEXT_TASK },
    activePath: "Notes.md",
    cursor: { line: 1, ch: 3 },
    dailyPath: null,
  });
  const seen = stubPlanBudgetApi(h.plugin, PLAN_BUDGET_OK);

  await h.plugin.openPomodoroTaskLink(h.editor, h.view);

  assert.deepEqual(noticeMessages, ["Task Link removed · stays Next"]);
  assert.deepEqual(seen, []);
});

test("planTargetTaskUpdate stamps the rewritten line last via injected stamper", () => {
  const now = localDate(2026, 7, 16);
  const seen = [];
  const stamper = (line, dateText) => {
    seen.push([line, dateText]);
    return `${line} [fresh:: ${dateText}]`;
  };
  const plan = helpers.planTargetTaskUpdate("- [ ] #task Ship it ^ship", 0, {
    activationEligible: true,
    now,
    stampLine: stamper,
    freshDateText: "2026-07-16",
  });
  assert.ok(plan);
  assert.equal(plan.newStatus, "*");
  assert.equal(plan.content, "- [*] #task Ship it ^ship [fresh:: 2026-07-16]");
  assert.equal(plan.freshnessChanged, true);
  assert.equal(plan.hasChanges, true);
  assert.deepEqual(seen, [["- [*] #task Ship it ^ship", "2026-07-16"]]);
});

test("planTargetTaskUpdate without a stamper never stamps (identity default)", () => {
  const now = localDate(2026, 7, 16);
  const plan = helpers.planTargetTaskUpdate("- [ ] #task Ship it ^ship", 0, {
    activationEligible: true,
    now,
  });
  assert.equal(plan.content, "- [*] #task Ship it ^ship");
  assert.equal(plan.freshnessChanged, false);
});

test("planTargetTaskUpdate stamp-only input stays unchanged and never calls the stamper", () => {
  const now = localDate(2026, 7, 16);
  let calls = 0;
  const plan = helpers.planTargetTaskUpdate("- [*] #task Ship it ^ship", 0, {
    activationEligible: true,
    now,
    stampLine: () => {
      calls += 1;
      return "- [*] #task Ship it ^ship [fresh:: 2026-07-16]";
    },
    freshDateText: "2026-07-16",
  });
  assert.equal(plan.statusChanged, false);
  assert.equal(calls, 0);
  assert.equal(plan.freshnessChanged, false);
  assert.equal(plan.hasChanges, false);
  assert.equal(plan.content, "- [*] #task Ship it ^ship");
});

test("planTargetTaskUpdate stamps a Next task that gains a block ID", () => {
  const now = localDate(2026, 7, 16);
  const seen = [];
  const plan = helpers.planTargetTaskUpdate("- [*] #task Ship it", 0, {
    activationEligible: true,
    now,
    newBlockId: "ship",
    stampLine: (line, dateText) => {
      seen.push([line, dateText]);
      return `${line} [fresh:: ${dateText}]`;
    },
    freshDateText: "2026-07-16",
  });
  assert.equal(plan.blockIdAppended, true);
  assert.equal(plan.freshnessChanged, true);
  assert.equal(plan.hasChanges, true);
  assert.equal(plan.content, "- [*] #task Ship it ^ship [fresh:: 2026-07-16]");
  assert.deepEqual(seen, [["- [*] #task Ship it ^ship", "2026-07-16"]]);
});

test("planTargetTaskUpdate tolerates a throwing stamper", () => {
  const now = localDate(2026, 7, 16);
  const plan = helpers.planTargetTaskUpdate("- [ ] #task Ship it ^ship", 0, {
    activationEligible: true,
    now,
    stampLine: () => {
      throw new Error("ledger unavailable");
    },
    freshDateText: "2026-07-16",
  });
  assert.equal(plan.content, "- [*] #task Ship it ^ship");
  assert.equal(plan.freshnessChanged, false);
  assert.equal(plan.hasChanges, true);
});

// compat (bob-cli-3n.5): Depends-On line recogniser, contract DP vectors
// (docs/task-dependencies.md section 11.1). `line` is the candidate line on
// its own. Guarded lines refuse Ctrl+Shift+Enter through
// `isTaskDependencyLine` or `isMalformedTaskDependencyLine`: every
// `accept`/`empty` shape and every `malformed` vector (DP15, DP16, DP23,
// DP25, DP26, DP31), while every `not-a-line` vector (DP24, DP27, DP28,
// DP29) stays unguarded. DP18/DP19/DP20/DP21/DP30 share an accept line
// shape — parentage, fenced code, and Work Log ancestry are hooks
// projection concerns, so the shape stays guarded here: this guard is
// line-level and never sees nesting, so a grandchild (DP19) or a Work
// Log child (DP20) still counts as a managed line.
test("Depends-On line recogniser covers the contract DP vectors", () => {
  const guardedStrict = [
    ["DP1", "  - ⛓️ **DEPENDS ON:** [[#^hospital-swarm]]"],
    ["DP2", "  - ⛓️ **DEPENDS ON:** [[cash#^unemployment]]"],
    ["DP3", "  - ⛓️ **DEPENDS ON:** [[money/cash#^unemployment]]"],
    ["DP4", "  - ⛓️ **DEPENDS ON:** [[#^a]] • [[#^b]]"],
    ["DP5", "  - ⛓️ **DEPENDS ON:** [[#^a|b • c]]"],
    ["DP6", "  - ⛓️ **DEPENDS ON:** ~~[[#^a]]~~"],
    ["DP7", "  - ⛓️ **DEPENDS ON:** ![[#^a]]"],
    ["DP8", "  - 🔗 **DEPENDS ON:** [[#^a]]"],
    ["DP9", "  - **DEPENDS ON:** [[#^a]]"],
    ["DP10", "  - ⛓️ **DEPENDENCIES:** [[#^a]]"],
    ["DP11", "  - ⛓ **DEPENDS ON:** [[#^a]]"],
    ["DP12", "  - ⛓️ **DEPENDS ON:** [[#^a]] · [[#^b]]"],
    ["DP13", "  - ⛓️ **DEPENDS ON:** [[#^a]], [[#^b]]"],
    ["DP14", "  - ⛓️ **DEPENDS ON:** [[#^a]] [[#^b]]"],
    ["DP17", "  - ⛓️ **DEPENDS ON:**"],
    // DP18/DP19/DP20 share DP1's shape; the context makes them
    // not-a-line for projection, but the shape stays guarded here.
    ["DP18-shape", "  - ⛓️ **DEPENDS ON:** [[#^a]]"],
    ["DP19-shape", "  - ⛓️ **DEPENDS ON:** [[#^a]]"],
    ["DP20-shape", "  - ⛓️ **DEPENDS ON:** [[#^a]]"],
    ["DP21", "  - ⛓️ **DEPENDS ON:** [[#^a]]"],
    ["DP22", "  - ⛓️ **DEPENDS ON:** [[#^a|swarm]]"],
    // DP23/DP25/DP26 are malformed per the contract but keep the guarded
    // shape, so the boolean recogniser stays true for them.
    ["DP23", "  - ⛓️ **DEPENDS ON:** [[note]]"],
    ["DP25", "  - ⛓️ **DEPENDS ON:** [[note#Heading]]"],
    ["DP26", "  - ⛓️ **DEPENDS ON:** • ,"],
    // DP30 shares DP1's shape; its Work Log context is pinned by the
    // Rust discovery test and the hooks, not by this shape guard.
    ["DP30-shape", "  - ⛓️ **DEPENDS ON:** [[#^a]]"],
  ];
  for (const [id, line] of guardedStrict) {
    assert.equal(helpers.isTaskDependencyLine(line), true, id + ": " + line);
    assert.equal(helpers.isMalformedTaskDependencyLine(line), false, id + " not malformed: " + line);
  }
  // DP15/DP16/DP31 are malformed per the contract and guarded through
  // `isMalformedTaskDependencyLine`, which refuses Ctrl+Shift+Enter.
  // DP31 is the prose-only line: label plus prose with no link.
  const guardedMalformed = [
    ["DP15", "  - ⛓️ **DEPENDS ON:** [[#^a"],
    ["DP16", "  - ⛓️ **DEPENDS ON:** [[#^a]] needs review"],
    ["DP31", "  - ⛓️ **DEPENDS ON:** needs review"],
  ];
  for (const [id, line] of guardedMalformed) {
    assert.equal(helpers.isTaskDependencyLine(line), false, id + ": " + line);
    assert.equal(helpers.isMalformedTaskDependencyLine(line), true, id + " malformed: " + line);
  }
  const unguarded = [
    ["DP24", "  - 🔗️ **DEPENDS ON:** [[#^a]]"],
    ["DP27", "  - ⛓️ **depends on:** [[#^a]]"],
    ["DP28", "⛓️ **DEPENDS ON:** [[#^a]]"],
    ["DP29", "> - ⛓️ **DEPENDS ON:** [[#^a]]"],
    ["task", "- [?] #task Make appt ^rahway"],
    ["schedule-log", "  - 🗓️ **SCHEDULE LOG**"],
    ["transclusion", "  - ![[Tasks#^ship]]"],
    ["bullet", "  - plain bullet"],
  ];
  for (const [id, line] of unguarded) {
    assert.equal(helpers.isTaskDependencyLine(line), false, id + ": " + line);
    assert.equal(helpers.isMalformedTaskDependencyLine(line), false, id + " not malformed: " + line);
  }
});

test("dedicated-link helpers reject Depends-On lines", () => {
  const line = "  - ⛓️ **DEPENDS ON:** [[#^a]] • [[Tasks#^b]]";
  const link = selectTaskLink(line, line.indexOf("[[#^a]]") + 2);
  assert.equal(helpers.isDedicatedTaskLinkBullet(line, link), false);
  assert.equal(
    helpers.isSoleContentLinkBullet(line, link.startCh, link.endCh),
    false,
  );
  const tokenStart = line.indexOf("[[#^a]]");
  assert.equal(
    helpers.isDedicatedLinkBullet(
      [line],
      { line: 0 },
      { start: tokenStart, end: tokenStart + "[[#^a]]".length },
    ),
    false,
  );
});

test("Ctrl+Shift+Enter on a Depends-On link is refused without deleting anything", async () => {
  resetNotices();
  const depLine = "  - ⛓️ **DEPENDS ON:** [[#^a]] • [[#^b]]";
  const content = ["- [?] #task Dependent ^dep", depLine].join("\n");
  const editor = createEditor(content);
  editor.setCursor({ line: 1, ch: depLine.indexOf("[[#^a]]") + 2 });
  const plugin = new Plugin();
  await plugin.startTaskLinkOpen(editor, { path: "Tasks.md" });
  assert.equal(editor.getValue(), content);
  assert.equal(lastNotice(), "⛓ Dependency link — edit it with Ctrl+Shift+P");
});

test("malformed Depends-On lines refuse Ctrl+Shift+Enter instead of deleting the link token", () => {
  // Contract R10: the marker and bold label shape are present but the
  // remainder is not clean, so `isTaskDependencyLine` stays false and the
  // old guard missed these. (DP25/DP26 shapes stay guard-true through
  // `isTaskDependencyLine` instead.)
  for (const line of [
    "  - ⛓️ **DEPENDS ON:** [[#^a",
    "  - ⛓️ **DEPENDS ON:** [[#^a]] needs review",
    "  - ⛓️ **DEPENDS ON:** [[#^a]] [[oops",
  ]) {
    assert.equal(helpers.isMalformedTaskDependencyLine(line), true, line);
  }
  for (const line of [
    "  - ⛓️ **DEPENDS ON:** [[#^a]]",
    "  - ⛓️ **DEPENDS ON:**",
    "  - ⛓️ **DEPENDS ON:** [[note]]",
    "  - ⛓️ **DEPENDS ON:** • ,",
    "  - [ ] #task plain [[#^a]]",
    "  - plain bullet",
  ]) {
    assert.equal(helpers.isMalformedTaskDependencyLine(line), false, line);
  }
});

test("Ctrl+Shift+Enter on a not-a-line Depends-On shape skips the dependency refusal", async () => {
  resetNotices();
  // DP24 (link emoji with VS16) is not-a-line: unguarded, so the flow
  // passes the dependency guard and reaches normal link resolution.
  const depLine = "  - 🔗️ **DEPENDS ON:** [[#^a]]";
  const content = ["- [?] #task Dependent ^dep", depLine].join("\n");
  const editor = createEditor(content);
  editor.setCursor({ line: 1, ch: depLine.indexOf("[[#^a]]") + 2 });
  const plugin = new Plugin();
  let resolved = 0;
  plugin.resolveTaskLinkTarget = async () => {
    resolved += 1;
    return { error: "stop" };
  };
  await plugin.startTaskLinkOpen(editor, { path: "Tasks.md" });
  assert.equal(resolved, 1);
  assert.notEqual(lastNotice(), "⛓ Dependency link — edit it with Ctrl+Shift+P");
});

test("Ctrl+Shift+Enter on a malformed Depends-On line is refused without deleting anything", async () => {
  resetNotices();
  const depLine = "  - ⛓️ **DEPENDS ON:** [[#^a]] needs review";
  const content = ["- [?] #task Dependent ^dep", depLine].join("\n");
  const editor = createEditor(content);
  editor.setCursor({ line: 1, ch: depLine.indexOf("[[#^a]]") + 2 });
  const plugin = new Plugin();
  await plugin.startTaskLinkOpen(editor, { path: "Tasks.md" });
  assert.equal(editor.getValue(), content);
  assert.equal(lastNotice(), "⛓ Dependency link — edit it with Ctrl+Shift+P");
});

test("readPlanBudgetMeter keeps per-cap over flags independent", () => {
  const plugin = new Plugin();
  plugin.app = {};
  stubPlanBudgetApi(plugin, {
    status: "over",
    themes: { count: 2, cap: 3, over: false },
    links: { count: 11, cap: 10, over: true },
  });
  const meter = plugin.readPlanBudgetMeter("## Pomodoros\n- [ ] () — FOCUS");
  assert.equal(meter.themes.over, false);
  assert.equal(meter.links.over, true);
  assert.equal(meter.over, true);
  assert.deepEqual([meter.themes.count, meter.themes.cap], [2, 3]);
  assert.deepEqual([meter.links.count, meter.links.cap], [11, 10]);
});

test("readPlanBudgetMeter keeps per-cap over flags independent (mirror)", () => {
  const plugin = new Plugin();
  plugin.app = {};
  stubPlanBudgetApi(plugin, {
    status: "over",
    themes: { count: 4, cap: 3, over: true },
    links: { count: 2, cap: 10, over: false },
  });
  const meter = plugin.readPlanBudgetMeter("## Pomodoros\n- [ ] () — FOCUS");
  assert.equal(meter.themes.over, true);
  assert.equal(meter.links.over, false);
  assert.equal(meter.over, true);
});

test("block-id-prompt freshness accessors degrade without ledger-tools", () => {
  const plugin = new Plugin();
  plugin.app = {};
  assert.equal(plugin.getFreshnessStampLine(), undefined);
  const stampLine = () => {};
  plugin.app = {
    plugins: {
      plugins: { "bob-ledger-tools": { api: { version: 3, freshness: { stampLine } } } },
    },
  };
  assert.equal(typeof plugin.getFreshnessStampLine(), "function");
  assert.match(plugin.getFreshnessDateText(), /^\d{4}-\d{2}-\d{2}$/);
});
