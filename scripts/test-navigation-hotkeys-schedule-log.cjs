const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  notices,
  NavigationHotkeysPlugin,
  helpers,
  TestEditor,
  TransactionEditor,
  createBulletPropertyPickerHarness,
  createPriorityPickerConfig,
  choosePriorityLevel,
} = require("./navigation-hotkeys-harness.cjs");

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
