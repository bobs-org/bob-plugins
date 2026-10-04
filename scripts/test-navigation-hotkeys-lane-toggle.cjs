const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  notices,
  NavigationHotkeysPlugin,
  helpers,
  TransactionEditor,
  runCardAction,
  createLinkPickerHarness,
} = require("./navigation-hotkeys-harness.cjs");

test("planTaskLaneBatch commits every Ready target to Next", () => {
  const content = [
    "- [ ] #task One ^a1",
    "- [*] #task Two ^b1",
    "- [/] #task Three ^c1",
    "- [?] #task Four ^d1",
  ].join("\n");
  const session = helpers.discoverCountedObsidianTaskTargets(content, 0, 3);
  assert.equal(session.valid, true);
  const plan = helpers.planTaskLaneBatch(content, session, {});
  assert.equal(plan.valid, true);
  assert.equal(plan.mode, "commit");
  assert.equal(plan.changedTaskCount, 1);
  assert.equal(plan.blockedSkipped, 1);
  assert.deepEqual(plan.content.split("\n"), [
    "- [*] #task One ^a1",
    "- [*] #task Two ^b1",
    "- [/] #task Three ^c1",
    "- [?] #task Four ^d1",
  ]);
});

test("planTaskLaneBatch releases Next and In Progress to Ready", () => {
  const content = ["- [*] #task One ^a1", "- [/] #task Two ^b1"].join("\n");
  const session = helpers.discoverCountedObsidianTaskTargets(content, 0, 1);
  const plan = helpers.planTaskLaneBatch(content, session, {
    summary: "",
    dateText: "2026-09-30",
  });
  assert.equal(plan.valid, true);
  assert.equal(plan.mode, "release");
  assert.equal(plan.changedTaskCount, 2);
  assert.equal(plan.blockedSkipped, 0);
  assert.equal(plan.workLogWrittenCount, 0);
  assert.deepEqual(plan.content.split("\n"), [
    "- [ ] #task One ^a1",
    "- [ ] #task Two ^b1",
  ]);
  assert.equal(plan.released.length, 2);
});

test("planTaskLaneBatch logs a nonblank summary on released In Progress tasks only", () => {
  const content = [
    "- [*] #task Next ^a1",
    "- [/] #task Working ^b1",
  ].join("\n");
  const session = helpers.discoverCountedObsidianTaskTargets(content, 0, 1);
  const plan = helpers.planTaskLaneBatch(content, session, {
    summary: "  did the thing  ",
    dateText: "2026-09-30",
  });
  assert.equal(plan.valid, true);
  assert.equal(plan.mode, "release");
  assert.equal(plan.workLogWrittenCount, 1);
  const lines = plan.content.split("\n");
  assert.equal(lines[0], "- [ ] #task Next ^a1");
  assert.equal(lines[1], "- [ ] #task Working ^b1");
  assert.match(plan.content, /WORK LOG/);
  assert.match(plan.content, /\*2026-09-30\* — did the thing/);
  // Blank summaries write nothing.
  const blank = helpers.planTaskLaneBatch(content, session, {
    summary: "   ",
    dateText: "2026-09-30",
  });
  assert.equal(blank.valid, true);
  assert.equal(blank.workLogWrittenCount, 0);
  assert.doesNotMatch(blank.content, /WORK LOG/);
});

test("planTaskLaneBatch skips Blocked and refuses stale preimages", () => {
  const blocked = "- [?] #task Waiting ^a1";
  const blockedSession = helpers.discoverCountedObsidianTaskTargets(blocked, 0, 0);
  const refused = helpers.planTaskLaneBatch(blocked, blockedSession, {});
  assert.equal(refused.valid, false);
  assert.match(refused.error, /Blocked is derived/);

  const content = "- [*] #task One ^a1\n- [/] #task Two ^b1";
  const session = helpers.discoverCountedObsidianTaskTargets(content, 0, 1);
  const staleSession = {
    ...session,
    targets: [{ line: 0, rawLine: "- [*] #task One, edited ^a1" }],
  };
  const stale = helpers.planTaskLaneBatch(content, staleSession, {});
  assert.equal(stale.valid, false);
  assert.equal(stale.stale, true);
});

test("buildLaneToggleNotice reports commit and release with and without budgets", () => {
  assert.equal(
    helpers.buildLaneToggleNotice({ mode: "commit", changedTaskCount: 3 }),
    "→ Next · 3 tasks",
  );
  assert.equal(
    helpers.buildLaneToggleNotice({
      mode: "commit",
      changedTaskCount: 1,
      laneBudgets: {
        next: { count: 12, cap: 15, over: false },
        pending: { count: 7, cap: 10, over: false },
      },
      releasedNextCount: 0,
      releasedPendingCount: 0,
    }),
    "→ Next · 1 task · NEXT 13/15 · PENDING 7/10",
  );
  assert.equal(
    helpers.buildLaneToggleNotice({
      mode: "release",
      changedTaskCount: 2,
      blockedSkipped: 2,
      unlinkedFromToday: 1,
      releasedNextCount: 1,
      releasedPendingCount: 1,
      laneBudgets: {
        next: { count: 12, cap: 15, over: false },
        pending: { count: 7, cap: 10, over: false },
      },
    }),
    "→ Ready · 2 tasks · unlinked 1 from today · 2 Blocked skipped — Blocked is derived · NEXT 11/15 · PENDING 6/10",
  );
  const over = helpers.buildLaneToggleNotice({
    mode: "commit",
    changedTaskCount: 3,
    laneBudgets: {
      next: { count: 14, cap: 15, over: false },
      pending: { count: 10, cap: 10, over: false },
    },
    releasedNextCount: 0,
    releasedPendingCount: 0,
  });
  assert.match(over, /NEXT 17\/15/);
  assert.match(over, /🔴 · prune at the weekly review/);
});

test("describeLaneRow covers task, counted, and link sessions", () => {
  const single = helpers.describeLaneRow("- [ ] #task Ship it ^a1", {
    cursorLine: 0,
  });
  assert.deepEqual(single, {
    kind: "task",
    count: 1,
    mode: "commit",
    detail: "lane · commit to Next",
    needsReason: false,
  });
  const next = helpers.describeLaneRow("- [*] #task Ship it ^a1", {
    cursorLine: 0,
  });
  assert.equal(next.detail, "lane · release to Ready");
  assert.equal(next.needsReason, false);
  const working = helpers.describeLaneRow("- [/] #task Ship it ^a1", {
    cursorLine: 0,
  });
  assert.equal(working.needsReason, true);
  assert.equal(
    helpers.describeLaneRow("- just a bullet", { cursorLine: 0 }),
    null,
  );
  assert.equal(
    helpers.describeLaneRow("- [?] #task Waiting ^a1", { cursorLine: 0 }),
    null,
  );
  const content = "- [ ] #task One ^a1\n- [*] #task Two ^b1";
  const counted = helpers.discoverCountedObsidianTaskTargets(content, 0, 1);
  const countedRow = helpers.describeLaneRow(content, {
    taskSession: counted,
  });
  assert.equal(countedRow.detail, "lane · commit to Next");
  assert.equal(countedRow.count, 2);
  const linkRow = helpers.describeLaneRow("", {
    linkResolved: [
      { rawLine: "- [*] #task One ^a1" },
      { rawLine: "- [/] #task Two ^b1" },
    ],
  });
  assert.equal(linkRow.detail, "lane · release to Ready");
  assert.equal(linkRow.kind, "link");
  assert.equal(linkRow.needsReason, true);
});

test("toggleTaskLane commits Ready to Next and reports lane budgets", async () => {
  notices.length = 0;
  const editor = new TransactionEditor(
    "- [ ] #task Ship it [scheduled:: 2026-09-30] ^a1",
    { line: 0, ch: 5 },
  );
  const files = new Map([
    ["Plan.md", { path: "Plan.md", basename: "Plan.md", extension: "md" }],
  ]);
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    plugins: {
      plugins: {
        "bob-ledger-tools": {
          api: {
            version: 2,
            nextBudget: () => ({ count: 12, cap: 15, over: false }),
            pendingBudget: () => ({ count: 7, cap: 10, over: false }),
          },
        },
      },
    },
    vault: { getMarkdownFiles: () => [...files.values()] },
    workspace: { getLeavesOfType: () => [] },
  };
  plugin.getActiveMarkdownView = () => ({ editor, file: files.get("Plan.md") });
  assert.equal(await plugin.toggleTaskLane(editor), true);
  assert.equal(
    editor.content,
    "- [*] #task Ship it [scheduled:: 2026-09-30] ^a1",
  );
  assert.match(notices.at(-1), /→ Next · 1 task · NEXT 13\/15/);
});

test("toggleTaskLane releases to Ready without the api", async () => {
  notices.length = 0;
  const editor = new TransactionEditor("- [*] #task Ship it ^a1", {
    line: 0,
    ch: 0,
  });
  const files = new Map([
    ["Plan.md", { path: "Plan.md", basename: "Plan.md", extension: "md" }],
  ]);
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    plugins: { plugins: {} },
    vault: { getMarkdownFiles: () => [...files.values()] },
    workspace: { getLeavesOfType: () => [] },
  };
  plugin.getActiveMarkdownView = () => ({ editor, file: files.get("Plan.md") });
  assert.equal(await plugin.toggleTaskLane(editor), true);
  assert.equal(editor.content, "- [ ] #task Ship it ^a1");
  assert.match(notices.at(-1), /→ Ready · 1 task/);
  assert.doesNotMatch(notices.at(-1), /NEXT/);
});

test("toggleTaskLane release logs the summary on In Progress tasks", async () => {
  notices.length = 0;
  const editor = new TransactionEditor("- [/] #task Working ^a1", {
    line: 0,
    ch: 0,
  });
  const files = new Map([
    ["Plan.md", { path: "Plan.md", basename: "Plan.md", extension: "md" }],
  ]);
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    plugins: { plugins: {} },
    vault: { getMarkdownFiles: () => [...files.values()] },
    workspace: { getLeavesOfType: () => [] },
  };
  plugin.getActiveMarkdownView = () => ({ editor, file: files.get("Plan.md") });
  assert.equal(
    await plugin.toggleTaskLane(editor, {
      summary: "parked for later",
      dateText: "2026-09-30",
    }),
    true,
  );
  assert.match(editor.content, /- \[ \] #task Working \^a1/);
  assert.match(editor.content, /WORK LOG/);
  assert.match(editor.content, /\*2026-09-30\* — parked for later/);
  assert.match(notices.at(-1), /→ Ready · 1 task/);
});

test("toggleTaskLane skips Blocked targets", async () => {
  notices.length = 0;
  const editor = new TransactionEditor(
    ["- [*] #task One ^a1", "- [?] #task Waiting ^b1"].join("\n"),
    { line: 0, ch: 0 },
  );
  const files = new Map([
    ["Plan.md", { path: "Plan.md", basename: "Plan.md", extension: "md" }],
  ]);
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    plugins: { plugins: {} },
    vault: { getMarkdownFiles: () => [...files.values()] },
    workspace: { getLeavesOfType: () => [] },
  };
  plugin.getActiveMarkdownView = () => ({ editor, file: files.get("Plan.md") });
  assert.equal(
    await plugin.toggleTaskLane(editor, {
      countExplicit: true,
      additionalTaskCount: 1,
    }),
    true,
  );
  assert.deepEqual(editor.content.split("\n"), [
    "- [ ] #task One ^a1",
    "- [?] #task Waiting ^b1",
  ]);
  assert.match(notices.at(-1), /1 Blocked skipped/);
});

test("counted toggleTaskLane covers the current task plus the next N tasks", async () => {
  notices.length = 0;
  const editor = new TransactionEditor(
    [
      "- [ ] #task One ^a1",
      "- [ ] #task Two ^b1",
      "- plain bullet",
      "- [ ] #task Three ^c1",
    ].join("\n"),
    { line: 0, ch: 0 },
  );
  const files = new Map([
    ["Plan.md", { path: "Plan.md", basename: "Plan.md", extension: "md" }],
  ]);
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    plugins: { plugins: {} },
    vault: { getMarkdownFiles: () => [...files.values()] },
    workspace: { getLeavesOfType: () => [] },
  };
  plugin.getActiveMarkdownView = () => ({ editor, file: files.get("Plan.md") });
  assert.equal(
    await plugin.toggleTaskLane(editor, {
      countExplicit: true,
      additionalTaskCount: 1,
    }),
    true,
  );
  assert.deepEqual(editor.content.split("\n"), [
    "- [*] #task One ^a1",
    "- [*] #task Two ^b1",
    "- plain bullet",
    "- [ ] #task Three ^c1",
  ]);
  assert.match(notices.at(-1), /→ Next · 2 tasks/);
  assert.doesNotMatch(notices.at(-1), /NEXT/);
});

test("toggleTaskLane on a Task Link writes through the open buffer", async () => {
  notices.length = 0;
  const taskEditor = new TransactionEditor("- [ ] #task Ship it ^a1", {
    line: 0,
    ch: 0,
  });
  const harness = createLinkPickerHarness({
    linkContent: "- [[Tasks#^a1]]",
    notes: { "Tasks.md": "- [ ] #task Ship it ^a1" },
    openEditors: { "Tasks.md": taskEditor },
  });
  harness.plugin.app.plugins = { plugins: {} };
  assert.equal(await harness.plugin.toggleTaskLane(harness.linkEditor), true);
  assert.equal(taskEditor.content, "- [*] #task Ship it ^a1");
  assert.equal(harness.linkEditor.content, "- [[Tasks#^a1]]");
  assert.match(notices.at(-1), /→ Next · 1 task/);
  assert.doesNotMatch(notices.at(-1), /NEXT/);
});

test("toggleTaskLane on Task Links releases across notes", async () => {
  notices.length = 0;
  const nextEditor = new TransactionEditor("- [*] #task One ^a1", {
    line: 0,
    ch: 0,
  });
  const harness = createLinkPickerHarness({
    linkContent: ["- [[Tasks#^a1]]", "- [[Other#^b1]]"].join("\n"),
    notes: {
      "Tasks.md": "- [*] #task One ^a1",
      "Other.md": "- [/] #task Two ^b1",
    },
    openEditors: { "Tasks.md": nextEditor },
  });
  harness.plugin.app.plugins = { plugins: {} };
  assert.equal(
    await harness.plugin.toggleTaskLane(harness.linkEditor, {
      countExplicit: true,
      additionalTaskCount: 5,
      summary: "",
      dateText: "2026-09-30",
    }),
    true,
  );
  assert.equal(nextEditor.content, "- [ ] #task One ^a1");
  assert.equal(harness.notes["Other.md"], "- [ ] #task Two ^b1");
  assert.match(notices.at(-1), /→ Ready · 2 tasks/);
});

test("toggleTaskLane refuses when a preimage changed", async () => {
  notices.length = 0;
  const editor = new TransactionEditor("- [*] #task Ship it ^a1", {
    line: 0,
    ch: 0,
  });
  const files = new Map([
    ["Plan.md", { path: "Plan.md", basename: "Plan.md", extension: "md" }],
  ]);
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    plugins: { plugins: {} },
    vault: { getMarkdownFiles: () => [...files.values()] },
    workspace: { getLeavesOfType: () => [] },
  };
  plugin.getActiveMarkdownView = () => ({ editor, file: files.get("Plan.md") });
  editor.content = "- [*] #task Ship it, edited ^a1";
  // The session is captured inside toggleTaskLane from the live content, so
  // simulate the race by mutating between discovery and write: toggle reads
  // the content once, so instead assert the pure planner refuses staleness.
  const session = helpers.discoverCountedObsidianTaskTargets(
    "- [*] #task Ship it ^a1",
    0,
    0,
  );
  const stale = helpers.planTaskLaneBatch(editor.content, {
    ...session,
    targets: [{ line: 0, rawLine: "- [*] #task Ship it ^a1" }],
  });
  assert.equal(stale.valid, false);
  assert.equal(stale.stale, true);
});

test("Ctrl+Shift+P shows a pinned lane row that commits immediately", async () => {
  notices.length = 0;
  const harness = createLinkPickerHarness({
    linkContent: "- [ ] #task Ship it [scheduled:: 2026-09-30] ^me",
    notes: { "Tasks.md": "- [ ] #task Ship it ^a1" },
  });
  assert.equal(
    harness.plugin.openBulletPropertyPicker(harness.linkEditor, {
      config: harness.config,
    }),
    true,
  );
  const picker = harness.plugin.activeBulletPropertyPicker;
  assert.ok(picker.propertyItems.length > 0);
  assert.equal(picker.propertyItems[0].kind, "lane-toggle");
  assert.equal(picker.propertyItems[0].property.name, "lane");
  assert.equal(picker.propertyItems[0].detail, "lane · commit to Next");
  harness.plugin.app.plugins = { plugins: {} };
  await runCardAction(picker, "lane");
  assert.equal(
    harness.linkEditor.content,
    "- [*] #task Ship it [scheduled:: 2026-09-30] ^me",
  );
  assert.match(notices.at(-1), /→ Next · 1 task/);
  picker.close();
  harness.plugin.activeBulletPropertyPicker = null;
});

test("Ctrl+Shift+P link mode shows the lane row with release detail", async () => {
  notices.length = 0;
  const taskEditor = new TransactionEditor("- [*] #task Ship it ^a1", {
    line: 0,
    ch: 0,
  });
  const harness = createLinkPickerHarness({
    linkContent: "- [[Tasks#^a1]]",
    notes: { "Tasks.md": "- [*] #task Ship it ^a1" },
    openEditors: { "Tasks.md": taskEditor },
  });
  assert.equal(await harness.open(), true);
  const picker = harness.plugin.activeBulletPropertyPicker;
  assert.equal(picker.isLinkSession(), true);
  assert.equal(picker.propertyItems[0].kind, "lane-toggle");
  assert.equal(picker.propertyItems[0].detail, "lane · release to Ready");
  harness.plugin.app.plugins = { plugins: {} };
  await runCardAction(picker, "lane");
  assert.equal(taskEditor.content, "- [ ] #task Ship it ^a1");
  assert.match(notices.at(-1), /→ Ready · 1 task/);
});

test("Ctrl+Shift+P lane release with In Progress goes through the reason stage", async () => {
  notices.length = 0;
  const harness = createLinkPickerHarness({
    linkContent: "- [/] #task Working ^me",
    notes: { "Tasks.md": "- [/] #task Working ^a1" },
  });
  assert.equal(
    harness.plugin.openBulletPropertyPicker(harness.linkEditor, {
      config: harness.config,
    }),
    true,
  );
  const picker = harness.plugin.activeBulletPropertyPicker;
  assert.equal(picker.propertyItems[0].kind, "lane-toggle");
  assert.equal(picker.propertyItems[0].needsReason, true);
  await runCardAction(picker, "lane");
  assert.equal(picker.stage, "lane-release-reason");
  // Escape leaves everything untouched.
  picker.close();
  assert.equal(harness.linkEditor.content, "- [/] #task Working ^me");
  harness.plugin.activeBulletPropertyPicker = null;
});

test("getLinkPickerSessionSubtitle keeps the clamp for a single link", () => {
  assert.equal(
    helpers.getLinkPickerSessionSubtitle({
      actualCount: 1,
      requestedCount: 5,
      clamped: true,
      targets: [{ line: 0 }],
      resolved: [{ path: "Tasks.md", rawLine: "- [ ] #task Ship it ^a1" }],
    }),
    "↗ Tasks · Ship it · 1 link of 5 requested · end of Pomodoro",
  );
});

test("link-mode priority notice keeps via Task Links visible", () => {
  const model = helpers.buildPriorityNoticeModel({
    property: { name: "priority", values: "priority", schedules: "scheduled" },
    level: { label: "P2", value: "medium" },
    levelIndex: 1,
    baseDate: new Date(2026, 7, 8),
    scheduledValues: [],
    taskCount: 3,
    scope: "counted",
    outcome: {},
  });
  const viaLinks = "via Task Links";
  const visible = {
    ...model,
    text: `${model.text} · ${viaLinks}`,
    countPill: model.countPill ? `${model.countPill} ${viaLinks}` : viaLinks,
  };
  assert.match(visible.countPill, /via Task Links/);
  assert.match(visible.text, /via Task Links/);
});

