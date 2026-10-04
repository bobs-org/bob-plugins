const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  helpers,
} = require("./navigation-hotkeys-harness.cjs");

test("cancel log grammar recognizes the marker, FE0F, and emoji-less spellings", () => {
  assert.equal(helpers.CANCEL_LOG_EMOJI, "❌");
  assert.equal(helpers.CANCEL_LOG_LABEL, "CANCEL LOG");
  assert.equal(helpers.CANCEL_LOG_MARKER_TEXT, "❌ **CANCEL LOG**");
  assert.equal(helpers.MANAGED_TASK_LOG_KIND_CANCEL, "cancel");

  for (const line of [
    "\t- ❌ **CANCEL LOG**",
    "\t- ❌ **CANCEL LOG:**",
    "\t- **CANCEL LOG**",
    "\t- **CANCEL LOG:**",
  ]) {
    const parsed = helpers.parseManagedTaskLogParentBullet(line);
    assert.deepEqual(
      { indent: parsed.indent, marker: parsed.marker, kind: parsed.kind },
      { indent: "\t", marker: "-", kind: "cancel" },
      line,
    );
  }

  const feof = helpers.parseManagedTaskLogParentBullet(
    "\t- ❌️ **CANCEL LOG**",
  );
  assert.equal(feof && feof.kind, "cancel");

  const feofExplicit = helpers.parseManagedTaskLogParentBullet(
    "\t- ❌\uFE0F **CANCEL LOG**",
  );
  assert.equal(feofExplicit && feofExplicit.kind, "cancel");

  assert.equal(
    helpers.parseManagedTaskLogParentBullet("\t- 🗓️ **CANCEL LOG**"),
    null,
  );
  assert.equal(
    helpers.parseManagedTaskLogParentBullet("\t- 🛠️ **CANCEL LOG**"),
    null,
  );
  assert.equal(
    helpers.parseManagedTaskLogParentBullet("\t- ❌ **SCHEDULE LOG**"),
    null,
  );
  assert.equal(
    helpers.parseManagedTaskLogParentBullet("\t- ❌ **CANCEL LOG** trailing"),
    null,
  );

  assert.deepEqual(
    helpers.parseCancelLogParentBullet("\t- ❌ **CANCEL LOG**"),
    { indent: "\t", marker: "-", hasEmoji: true },
  );
  assert.equal(
    helpers.parseCancelLogParentBullet("\t- 🛠️ **WORK LOG**"),
    null,
  );
  assert.equal(
    helpers.parseScheduleLogParentBullet("\t- ❌ **CANCEL LOG**"),
    null,
  );
});

test("findCancelLogParent finds a direct child but ignores a grandchild", () => {
  const withMarker = [
    "- [ ] #task Parent ^parent",
    "  - freeform note",
    "  - ❌ **CANCEL LOG**",
    "    - *2026-09-30* — reason",
  ].join("\n");
  assert.deepEqual(helpers.findCancelLogParent(withMarker, 0), {
    line: 2,
    indent: "  ",
    marker: "-",
  });

  const nested = [
    "- [ ] #task Parent ^parent",
    "  - ![[#^dep]]",
    "    - ❌ **CANCEL LOG**",
    "      - *2026-09-30* — nested",
  ].join("\n");
  assert.equal(helpers.findCancelLogParent(nested, 0), null);
  assert.equal(
    helpers.findCancelLogParent("- [ ] #task Parent ^parent", 0),
    null,
  );
});

test("getCancelLogEntryIndent reuses an entry indent or falls back to marker plus tab", () => {
  const withEntries = [
    "- [ ] #task T ^t",
    "\t- ❌ **CANCEL LOG**",
    "\t\t- *2026-09-30* — a",
  ].join("\n");
  assert.equal(helpers.getCancelLogEntryIndent(withEntries, 1), "\t\t");

  const withoutEntries = ["- [ ] #task T ^t", "  - ❌ **CANCEL LOG**"].join(
    "\n",
  );
  assert.equal(helpers.getCancelLogEntryIndent(withoutEntries, 1), "  \t");
});

test("formatCancelLogEntryText renders the exact preview text", () => {
  assert.equal(
    helpers.formatCancelLogEntryText({ date: "2026-09-30", reason: "obsolete" }),
    "*2026-09-30* — obsolete",
  );
});

test("planCancelLogEntry inserts a first-child log with tabs or spaces", () => {
  const fresh = "- [ ] #task Ship ^ship";
  const created = helpers.planCancelLogEntry(fresh, 0, {
    date: "2026-09-30",
    reason: "superseded",
  });
  assert.equal(created.valid, true);
  assert.equal(created.createdParent, true);
  assert.equal(created.usedFallback, false);
  assert.equal(created.insertLine, 1);
  assert.deepEqual(created.lineTexts, [
    "\t- ❌ **CANCEL LOG**",
    "\t\t- *2026-09-30* — superseded",
  ]);

  const withChild = [
    "- [ ] #task Ship ^ship",
    "  - some existing note",
  ].join("\n");
  const afterChild = helpers.planCancelLogEntry(withChild, 0, {
    date: "2026-09-30",
    reason: "kickoff",
  });
  assert.equal(afterChild.createdParent, true);
  assert.equal(afterChild.insertLine, 1);
  assert.deepEqual(afterChild.lineTexts, [
    "  - ❌ **CANCEL LOG**",
    "  \t- *2026-09-30* — kickoff",
  ]);

  const quoted = "> - [ ] #task Quoted ^quoted";
  const inQuote = helpers.planCancelLogEntry(quoted, 0, {
    date: "2026-09-30",
    reason: "quoted context",
  });
  assert.deepEqual(inQuote.lineTexts, [
    "> \t- ❌ **CANCEL LOG**",
    "> \t\t- *2026-09-30* — quoted context",
  ]);

  assert.equal(
    helpers.planCancelLogEntry(fresh, 0, { date: "2026-09-30", reason: "" })
      .reason,
    "empty-reason",
  );
  assert.equal(
    helpers.planCancelLogEntry(fresh, 99, { date: "2026-09-30", reason: "y" })
      .reason,
    "task-out-of-range",
  );
  assert.equal(
    helpers.planCancelLogEntry("not a list item", 0, {
      date: "2026-09-30",
      reason: "y",
    }).reason,
    "not-list-item",
  );
  assert.equal(
    helpers.planCancelLogEntry(fresh, 0, { date: "", reason: "y" }).reason,
    "missing-date",
  );
});

test("planCancelLogEntry prepends under an existing log wherever it sits", () => {
  const existing = [
    "- [ ] #task Ship ^ship",
    "  - other note",
    "  * ❌ **CANCEL LOG**",
    "    * *2026-09-29* — old",
  ].join("\n");
  const prepended = helpers.planCancelLogEntry(existing, 0, {
    date: "2026-09-30",
    reason: "newer",
  });
  assert.equal(prepended.valid, true);
  assert.equal(prepended.createdParent, false);
  assert.equal(prepended.insertLine, 3);
  assert.deepEqual(prepended.lineTexts, [
    "    * *2026-09-30* — newer",
  ]);
});

test("planCancelLogEntry uses the fallback only when a marker exists", () => {
  const withMarker = [
    "- [ ] #task Ship ^ship",
    "  - ❌ **CANCEL LOG**",
    "    - *2026-09-29* — old",
  ].join("\n");
  const marked = helpers.planCancelLogEntry(withMarker, 0, {
    date: "2026-09-30",
    reason: "",
    fallbackReason: "🤷 no reason given",
  });
  assert.equal(marked.valid, true);
  assert.equal(marked.usedFallback, true);
  assert.deepEqual(marked.lineTexts, [
    "    - *2026-09-30* — 🤷 no reason given",
  ]);

  const withoutMarker = "- [ ] #task Ship ^ship";
  const unmarked = helpers.planCancelLogEntry(withoutMarker, 0, {
    date: "2026-09-30",
    reason: "",
    fallbackReason: "🤷 no reason given",
  });
  assert.equal(unmarked.valid, false);
  assert.equal(unmarked.reason, "no-cancel-log");

  const typed = helpers.planCancelLogEntry(withMarker, 0, {
    date: "2026-09-30",
    reason: "typed wins",
    fallbackReason: "🤷 no reason given",
  });
  assert.equal(typed.usedFallback, false);
  assert.deepEqual(typed.lineTexts, ["    - *2026-09-30* — typed wins"]);

  const inlineField = helpers.planCancelLogEntry(withoutMarker, 0, {
    date: "2026-09-30",
    reason: "blocked:: x",
  });
  assert.equal(inlineField.valid, true);
  assert.equal(
    helpers.normalizeScheduleReasonText("blocked:: x").hasInlineField,
    true,
  );
});

test("isRecurringTaskLine and getTaskCancelStatusLabel cover the contract", () => {
  assert.equal(helpers.isRecurringTaskLine("- [ ] #task T [repeat:: weekly]"), true);
  assert.equal(helpers.isRecurringTaskLine("- [ ] #task T (repeat:: weekly)"), true);
  assert.equal(helpers.isRecurringTaskLine("- [ ] #task T 🔁"), true);
  assert.equal(helpers.isRecurringTaskLine("- [ ] #task T"), false);

  assert.equal(helpers.getTaskCancelStatusLabel(" "), "Ready");
  assert.equal(helpers.getTaskCancelStatusLabel("*"), "Next");
  assert.equal(helpers.getTaskCancelStatusLabel("/"), "In Progress");
  assert.equal(helpers.getTaskCancelStatusLabel("?"), "Blocked");
  assert.equal(helpers.getTaskCancelStatusLabel("x"), null);
  assert.equal(helpers.getTaskCancelStatusLabel("-"), null);
});

test("describeCancelTaskRow covers single, counted, link, recurring, and hidden", () => {
  const single = helpers.describeCancelTaskRow("- [*] #task Ship ^a1", {
    cursorLine: 0,
  });
  assert.deepEqual(single, {
    kind: "task",
    count: 1,
    openCount: 1,
    closedCount: 0,
    recurring: false,
    fromStatus: "Next",
    detail: "Next → Cancelled · asks why",
  });

  assert.equal(
    helpers.describeCancelTaskRow("- [x] #task Done ^a1", { cursorLine: 0 }),
    null,
  );
  assert.equal(
    helpers.describeCancelTaskRow("- just a bullet", { cursorLine: 0 }),
    null,
  );

  const recurringSingle = helpers.describeCancelTaskRow(
    "- [ ] #task T [repeat:: weekly]",
    { cursorLine: 0 },
  );
  assert.equal(recurringSingle.recurring, true);
  assert.equal(recurringSingle.detail, "recurring · use Obsidian Tasks");

  const content = "- [ ] #task One ^a1\n- [x] #task Done ^b1\n- [*] #task Two ^c1";
  const session = helpers.discoverCountedObsidianTaskTargets(content, 0, 2);
  const counted = helpers.describeCancelTaskRow(content, {
    taskSession: session,
  });
  assert.equal(counted.openCount, 2);
  assert.equal(counted.closedCount, 1);
  assert.equal(counted.detail, "2 tasks → Cancelled · 1 already closed");

  const allClosed = helpers.discoverCountedObsidianTaskTargets(
    "- [x] #task A ^a1\n- [x] #task B ^b1",
    0,
    1,
  );
  assert.equal(
    helpers.describeCancelTaskRow("- [x] #task A ^a1\n- [x] #task B ^b1", {
      taskSession: allClosed,
    }),
    null,
  );

  const linkSingle = helpers.describeCancelTaskRow("", {
    linkResolved: [
      { path: "Tasks.md", rawLine: "- [ ] #task Ship it ^a1" },
    ],
  });
  assert.equal(linkSingle.kind, "link");
  assert.match(linkSingle.detail, /↗ Tasks · Ship it → Cancelled/);

  const linkRecurring = helpers.describeCancelTaskRow("", {
    linkResolved: [{ rawLine: "- [ ] #task T 🔁" }],
  });
  assert.equal(linkRecurring.recurring, true);
});

test("planTaskCancelBatch cancels a single task with a first-child log", () => {
  const content = [
    "- [*] #task Add tab [priority:: high] [created:: 2026-08-14] ^agents-tab",
    "  - existing note",
  ].join("\n");
  const session = helpers.discoverCountedObsidianTaskTargets(content, 0, 0);
  const result = helpers.planTaskCancelBatch(content, session, {
    date: "2026-09-30",
    reason: "Superseded by [[other]]",
  });
  assert.equal(result.valid, true);
  assert.equal(result.cancelledCount, 1);
  assert.equal(result.skippedClosedCount, 0);
  assert.equal(result.loggedCount, 1);
  assert.equal(result.createdLogCount, 1);
  assert.equal(result.cancelled.length, 1);
  assert.equal(result.cancelled[0].blockId, "agents-tab");
  assert.equal(result.cancelled[0].fromStatus, "Next");
  const lines = result.content.split("\n");
  assert.match(lines[0], /- \[-]/);
  assert.match(lines[0], /\[cancelled:: 2026-09-30]/);
  assert.match(lines[0], /\^agents-tab$/);
  assert.equal(lines[1], "  - ❌ **CANCEL LOG**");
  assert.equal(lines[2], "  \t- *2026-09-30* — Superseded by [[other]]");
  assert.equal(lines[3], "  - existing note");
  assert.match(lines[0], /\[priority:: high]/);
  assert.match(lines[0], /\[created:: 2026-08-14]/);
  assert.equal(result.cursorLineShift(0), 0);
  assert.equal(result.cursorLineShift(1), 3);
});

test("planTaskCancelBatch upserts cancelled before the block id and preserves fields", () => {
  const content =
    "- [ ] #task T [scheduled:: 2026-09-30] [dependsOn:: a1] #hide [created:: 2026-08-01] [cancelled:: 2026-09-29] ^t1";
  const session = helpers.discoverCountedObsidianTaskTargets(content, 0, 0);
  const result = helpers.planTaskCancelBatch(content, session, {
    date: "2026-09-30",
    reason: "done",
  });
  assert.equal(result.valid, true);
  const line = result.content.split("\n")[0];
  assert.match(line, /\[cancelled:: 2026-09-30]/);
  assert.doesNotMatch(line, /2026-09-29/);
  assert.match(line, /\[cancelled:: 2026-09-30] \^t1$/);
  assert.match(line, /\[scheduled:: 2026-09-30]/);
  assert.match(line, /\[dependsOn:: a1]/);
  assert.match(line, /#hide/);
  assert.doesNotMatch(line, /#now/);
  assert.equal(result.cancelled[0].taskId, "t1");
});

test("planTaskCancelBatch records id-field task identities", () => {
  const content = "- [ ] #task T [id:: my-id] ^blk";
  const session = helpers.discoverCountedObsidianTaskTargets(content, 0, 0);
  const result = helpers.planTaskCancelBatch(content, session, {
    date: "2026-09-30",
    reason: "r",
  });
  assert.equal(result.cancelled[0].blockId, "blk");
  assert.equal(result.cancelled[0].taskId, "my-id");
});

test("planTaskCancelBatch skips closed targets and stays bottom-up", () => {
  const content = [
    "- [ ] #task One ^a1",
    "- [x] #task Done ^b1",
    "- [*] #task Two ^c1",
  ].join("\n");
  const session = helpers.discoverCountedObsidianTaskTargets(content, 0, 2);
  const result = helpers.planTaskCancelBatch(content, session, {
    date: "2026-09-30",
    reason: "batch",
  });
  assert.equal(result.valid, true);
  assert.equal(result.cancelledCount, 2);
  assert.equal(result.skippedClosedCount, 1);
  assert.equal(result.loggedCount, 2);
  const lines = result.content.split("\n");
  assert.match(lines[0], /- \[-].*\[cancelled:: 2026-09-30].*\^a1/);
  assert.match(lines[1], /- ❌ \*\*CANCEL LOG\*\*/);
  assert.match(lines[3], /- \[x\] #task Done/);
  assert.match(lines[4], /- \[-].*\[cancelled:: 2026-09-30].*\^c1/);
});

test("planTaskCancelBatch refuses recurring targets in all three syntaxes", () => {
  for (const recurring of [
    "- [ ] #task A [repeat:: weekly] ^a1",
    "- [ ] #task B (repeat:: weekly) ^b1",
    "- [ ] #task C 🔁 ^c1",
  ]) {
    const content = [recurring, "- [ ] #task Other ^d1"].join("\n");
    const session = helpers.discoverCountedObsidianTaskTargets(content, 0, 1);
    const result = helpers.planTaskCancelBatch(content, session, {
      date: "2026-09-30",
      reason: "r",
    });
    assert.equal(result.valid, false);
    assert.equal(result.recurring, true);
    assert.match(result.error, /Recurring tasks are cancelled/);
    assert.equal(result.content, content);
  }
});

test("planTaskCancelBatch handles empty reasons and stale preimages", () => {
  const fresh = "- [ ] #task T ^t1";
  const freshSession = helpers.discoverCountedObsidianTaskTargets(fresh, 0, 0);
  const noLog = helpers.planTaskCancelBatch(fresh, freshSession, {
    date: "2026-09-30",
    reason: "",
  });
  assert.equal(noLog.valid, true);
  assert.equal(noLog.loggedCount, 0);
  assert.match(noLog.content.split("\n")[0], /- \[-]/);

  const withMarker = [
    "- [ ] #task T ^t1",
    "  - ❌ **CANCEL LOG**",
    "    - *2026-09-29* — old",
  ].join("\n");
  const markerSession = helpers.discoverCountedObsidianTaskTargets(
    withMarker,
    0,
    0,
  );
  const fallback = helpers.planTaskCancelBatch(withMarker, markerSession, {
    date: "2026-09-30",
    reason: "",
    fallbackReason: "🤷 no reason given",
  });
  assert.equal(fallback.valid, true);
  assert.equal(fallback.fallbackLoggedCount, 1);
  assert.match(fallback.content, /🤷 no reason given/);

  const staleSession = { valid: true, targets: [{ line: 0, rawLine: "stale" }] };
  const stale = helpers.planTaskCancelBatch(fresh, staleSession, {
    date: "2026-09-30",
    reason: "r",
  });
  assert.equal(stale.valid, false);
  assert.match(stale.error, /changed while the picker was open/);
});

test("planTaskCancelBatch preserves CRLF line endings", () => {
  const content = "- [ ] #task One ^a1\r\n- [ ] #task Two ^b1";
  const session = helpers.discoverCountedObsidianTaskTargets(content, 0, 1);
  const result = helpers.planTaskCancelBatch(content, session, {
    date: "2026-09-30",
    reason: "r",
  });
  assert.equal(result.valid, true);
  assert.match(result.content, /\r\n/);
  assert.doesNotMatch(result.content, /[^\r]\n[^\r]/);
});

test("cancel project conversion carries the log and reports it", () => {
  const seed = helpers.buildProjectSeedFromChildBullets(
    ["  - ❌ **CANCEL LOG**", "    - *2026-09-30* — obsolete"],
    "2026-08-12",
  );
  assert.deepEqual(seed.managedLogLines, [
    "\t- ❌ **CANCEL LOG**",
    "\t  - *2026-09-30* — obsolete",
  ]);
  assert.deepEqual(seed.taskLines, []);

  assert.equal(
    helpers.getProjectFromTaskNoticeText("Ship it", "Area", "P", 0, 0, [
      "cancel",
    ]),
    'Created project P from task "Ship it" (task removed from Area; cancel log moved)',
  );
  assert.equal(
    helpers.getProjectFromTaskNoticeText("Ship it", "Area", "P", 0, 0, [
      "work",
      "schedule",
      "cancel",
    ]),
    'Created project P from task "Ship it" (task removed from Area; schedule log moved; work log moved; cancel log moved)',
  );

  const reversal = helpers.buildTaskBlockFromProjectNote(
    [
      "---",
      'parent: "[[Area]]"',
      'type: "[[project]]"',
      "status: wip",
      "created: 2026-08-01T09:12:00-04:00",
      "---",
      "- [ ] #task #prj Ship ^prj",
      "\t- ❌ **CANCEL LOG**",
      "\t  - *2026-09-30* — obsolete",
      "## Tasks",
      "- [ ] #task Sub ^sub",
    ].join("\n"),
    { noteBasename: "P", parentBasename: "Area" },
  );
  assert.equal(reversal.valid, true);
  assert.ok(reversal.lines.some((line) => line.includes("❌ **CANCEL LOG**")));
});

// cancel-picker: pinned Cancel row, reason stage, guarded writes, notice.
// ---------------------------------------------------------------------------
