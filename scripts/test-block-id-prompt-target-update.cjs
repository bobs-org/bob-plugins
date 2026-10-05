const test = require("node:test");
const assert = require("node:assert/strict");
const {
  Plugin,
  helpers,
  resetNotices,
  lastNotice,
  localDate,
  createEditor,
  sourceForTaskPicker,
} = require("./block-id-prompt-harness.cjs");

// --- Future-scheduled Pomodoro activation -----------------------------------

test("calendar date parsing rejects malformed width and impossible dates", () => {
  assert.deepEqual(helpers.parseStrictCalendarDate("2026-07-17"), {
    year: 2026,
    month: 7,
    day: 17,
  });
  assert.deepEqual(helpers.parseStrictCalendarDate("2028-02-29"), {
    year: 2028,
    month: 2,
    day: 29,
  });
  assert.equal(helpers.parseStrictCalendarDate("2026-02-29"), null, "non-leap Feb 29");
  assert.equal(helpers.parseStrictCalendarDate("2026-02-30"), null, "impossible day");
  assert.equal(helpers.parseStrictCalendarDate("2026-13-01"), null, "impossible month");
  assert.equal(helpers.parseStrictCalendarDate("2026-00-10"), null, "zero month");
  assert.equal(helpers.parseStrictCalendarDate("2026-07-00"), null, "zero day");
  assert.equal(helpers.parseStrictCalendarDate("2026-7-20"), null, "single-digit month");
  assert.equal(helpers.parseStrictCalendarDate("2026-07-2"), null, "single-digit day");
  assert.equal(helpers.parseStrictCalendarDate("26-07-20"), null, "two-digit year");
  assert.equal(helpers.parseStrictCalendarDate(""), null);
  assert.equal(helpers.parseStrictCalendarDate(null), null);
});

test("future scheduled field detection respects the yesterday/today/tomorrow boundary", () => {
  const today = { year: 2026, month: 7, day: 16 };
  assert.equal(
    helpers.findSingleFutureScheduledField("- [ ] #task X [scheduled:: 2026-07-15]", today),
    null,
    "yesterday",
  );
  assert.equal(
    helpers.findSingleFutureScheduledField("- [ ] #task X [scheduled:: 2026-07-16]", today),
    null,
    "today",
  );
  const tomorrow = helpers.findSingleFutureScheduledField(
    "- [ ] #task X [scheduled:: 2026-07-17]",
    today,
  );
  assert.ok(tomorrow, "tomorrow");
  assert.deepEqual(tomorrow.date, { year: 2026, month: 7, day: 17 });

  assert.ok(
    helpers.findSingleFutureScheduledField("- [ ] #task X [scheduled:: 2028-02-29]", {
      year: 2028,
      month: 2,
      day: 27,
    }),
    "future leap day",
  );
  assert.equal(
    helpers.findSingleFutureScheduledField("- [ ] #task X [scheduled:: 2026-02-30]", today),
    null,
    "impossible date",
  );
  assert.equal(
    helpers.findSingleFutureScheduledField("- [ ] #task X [scheduled:: 2026-7-20]", today),
    null,
    "malformed width",
  );
});

test("scheduled field recognition covers bracket and paren forms in any position and on quoted/numbered lines", () => {
  assert.equal(
    helpers.findScheduledFieldMatches(
      "- [ ] #task X [scheduled:: 2026-07-17] [priority:: high]",
    )[0].value,
    "2026-07-17",
  );
  assert.equal(
    helpers.findScheduledFieldMatches(
      "- [ ] #task X [priority:: high] (scheduled:: 2026-07-18)",
    )[0].value,
    "2026-07-18",
  );
  assert.equal(
    helpers.findScheduledFieldMatches(
      "> - [?] #task Quoted [scheduled:: 2026-07-19] ^quoted",
    )[0].value,
    "2026-07-19",
  );
  assert.equal(
    helpers.findScheduledFieldMatches(
      "1. [?] #task Numbered [scheduled:: 2026-07-20] ^numbered",
    )[0].value,
    "2026-07-20",
  );
  assert.equal(
    helpers.findScheduledFieldMatches(
      "- [ ] #task X (scheduled::   2026-07-18  )",
    )[0].value,
    "2026-07-18",
    "surrounding whitespace is trimmed for validation",
  );
});

test("planTargetTaskUpdate removes a future schedule and promotes Ready/Blocked to Next", () => {
  const now = localDate(2026, 7, 16);
  for (const status of ["?", " "]) {
    const content = `- [${status}] #task Ship it [scheduled:: 2026-07-20] ^ship`;
    const plan = helpers.planTargetTaskUpdate(content, 0, { activationEligible: true, now });
    assert.ok(plan, status);
    assert.equal(plan.removedFutureSchedule, true, status);
    assert.equal(plan.statusChanged, true, status);
    assert.equal(plan.newStatus, "*", status);
    assert.equal(plan.content, "- [*] #task Ship it ^ship", status);
  }
});

test("planTargetTaskUpdate unschedules a future task while preserving Next/In-Progress status", () => {
  const now = localDate(2026, 7, 16);
  for (const status of ["*", "/"]) {
    const content = `- [${status}] #task Ship it [scheduled:: 2026-07-20] ^ship`;
    const plan = helpers.planTargetTaskUpdate(content, 0, { activationEligible: true, now });
    assert.equal(plan.removedFutureSchedule, true, status);
    assert.equal(plan.statusChanged, false, status);
    assert.equal(plan.newStatus, status, status);
    assert.equal(plan.content, `- [${status}] #task Ship it ^ship`, status);
  }
});

test("planTargetTaskUpdate keeps the legacy unscheduled Ready promotion and Blocked non-promotion", () => {
  const now = localDate(2026, 7, 16);
  const ready = helpers.planTargetTaskUpdate("- [ ] #task Ship it ^ship", 0, {
    activationEligible: true,
    now,
  });
  assert.equal(ready.removedFutureSchedule, false);
  assert.equal(ready.newStatus, "*");
  assert.equal(ready.content, "- [*] #task Ship it ^ship");

  const blocked = helpers.planTargetTaskUpdate("- [?] #task Ship it ^ship", 0, {
    activationEligible: true,
    now,
  });
  assert.equal(blocked.hasChanges, false);
  assert.equal(blocked.newStatus, "?");
  assert.equal(blocked.content, "- [?] #task Ship it ^ship");
});

test("planTargetTaskUpdate leaves an already Next or In-Progress task alone when there is no future schedule", () => {
  const now = localDate(2026, 7, 16);
  for (const status of ["*", "/"]) {
    const content = `- [${status}] #task Ship it ^ship`;
    const plan = helpers.planTargetTaskUpdate(content, 0, { activationEligible: true, now });
    assert.equal(plan.hasChanges, false, status);
    assert.equal(plan.content, content, status);
  }
});

test("planTargetTaskUpdate leaves today and past schedules untouched", () => {
  const now = localDate(2026, 7, 16);
  const today = helpers.planTargetTaskUpdate(
    "- [ ] #task Ship it [scheduled:: 2026-07-16] ^ship",
    0,
    { activationEligible: true, now },
  );
  assert.equal(today.removedFutureSchedule, false);
  assert.equal(today.newStatus, "*");
  assert.equal(today.content, "- [*] #task Ship it [scheduled:: 2026-07-16] ^ship");

  const past = helpers.planTargetTaskUpdate(
    "- [?] #task Ship it [scheduled:: 2026-07-01] ^ship",
    0,
    { activationEligible: true, now },
  );
  assert.equal(past.removedFutureSchedule, false);
  assert.equal(past.hasChanges, false);
  assert.equal(past.content, "- [?] #task Ship it [scheduled:: 2026-07-01] ^ship");
});

test("planTargetTaskUpdate never touches status or schedule when the source is not activation-eligible", () => {
  const now = localDate(2026, 7, 16);
  for (const status of [" ", "?", "*", "/"]) {
    const content = `- [${status}] #task Ship it [scheduled:: 2026-07-20] ^ship`;
    const plan = helpers.planTargetTaskUpdate(content, 0, { activationEligible: false, now });
    assert.equal(plan.hasChanges, false, status);
    assert.equal(plan.content, content, status);
  }
});

test("two or more recognized scheduled fields are ambiguous and never touch the Schedule Log, even when a marker exists", () => {
  const now = localDate(2026, 7, 16);
  const content = [
    "- [?] #task Ship it [scheduled:: 2026-07-20] [scheduled:: 2026-07-25] ^ship",
    "  - 🗓️ **SCHEDULE LOG**",
  ].join("\n");
  const plan = helpers.planTargetTaskUpdate(content, 0, { activationEligible: true, now });
  assert.equal(plan.removedFutureSchedule, false);
  assert.equal(plan.logEntryAdded, false);
  assert.equal(plan.hasChanges, false);
  assert.equal(plan.content, content);
});

test("a malformed single scheduled field is never treated as future", () => {
  const now = localDate(2026, 7, 16);
  const content = "- [?] #task Ship it [scheduled:: 2026-02-30] ^ship";
  const plan = helpers.planTargetTaskUpdate(content, 0, { activationEligible: true, now });
  assert.equal(plan.removedFutureSchedule, false);
  assert.equal(plan.hasChanges, false);
  assert.equal(plan.content, content);
});

test("an ambiguous scheduled field does not block the legacy Ready promotion", () => {
  const now = localDate(2026, 7, 16);
  const content = "- [ ] #task Ship it [scheduled:: 2026-07-20] [scheduled:: 2026-07-25] ^ship";
  const plan = helpers.planTargetTaskUpdate(content, 0, { activationEligible: true, now });
  assert.equal(plan.removedFutureSchedule, false);
  assert.equal(plan.newStatus, "*");
  assert.match(plan.content, /\[scheduled:: 2026-07-20\] \[scheduled:: 2026-07-25\]/);
});

test("planTargetTaskUpdate activation works on quoted and numbered task lines and preserves unrelated fields", () => {
  const now = localDate(2026, 8, 15);
  const quoted = helpers.planTargetTaskUpdate(
    "> - [?] #task Quoted [priority:: high] [scheduled:: 2026-08-20] ^quoted",
    0,
    { activationEligible: true, now },
  );
  assert.equal(quoted.content, "> - [*] #task Quoted [priority:: high] ^quoted");

  const numbered = helpers.planTargetTaskUpdate(
    "1. [ ] #task Numbered [scheduled:: 2026-08-20] [dependsOn:: x] ^numbered",
    0,
    { activationEligible: true, now },
  );
  assert.equal(numbered.content, "1. [*] #task Numbered [dependsOn:: x] ^numbered");
});

test("Schedule Log marker recognition covers canonical, emoji-less, and legacy forms, and ignores nested grandchildren", () => {
  const canonical = [
    "- [?] #task Ship it ^ship",
    "  - 🗓️ **SCHEDULE LOG**",
    "    - _2026-08-01 → 2026-08-20_ — waiting on review",
  ];
  assert.deepEqual(helpers.findScheduleLogMarker(canonical, 0), {
    line: 1,
    indent: "  ",
    marker: "-",
  });

  assert.deepEqual(
    helpers.findScheduleLogMarker(["- [?] #task X ^x", "  - **SCHEDULE LOG**"], 0),
    { line: 1, indent: "  ", marker: "-" },
    "emoji-less form",
  );
  assert.deepEqual(
    helpers.findScheduleLogMarker(["- [?] #task X ^x", "  - **Schedule log:**"], 0),
    { line: 1, indent: "  ", marker: "-" },
    "legacy form",
  );

  const nested = [
    "- [?] #task X ^x",
    "  - Some other child",
    "    - 🗓️ **SCHEDULE LOG**",
  ];
  assert.equal(helpers.findScheduleLogMarker(nested, 0), null, "nested grandchild is ignored");
  assert.equal(helpers.findScheduleLogMarker(["- [?] #task X ^x"], 0), null, "no marker at all");
});

test("Schedule Log entry indentation reuses an existing entry or falls back to marker indent plus a tab", () => {
  const withEntry = [
    "- [?] #task X ^x",
    "  - 🗓️ **SCHEDULE LOG**",
    "    - _2026-08-01 → 2026-08-20_ — waiting on review",
  ];
  assert.equal(helpers.findScheduleLogEntryIndent(withEntry, 1), "    ");

  const withoutEntry = ["- [?] #task X ^x", "  - 🗓️ **SCHEDULE LOG**"];
  assert.equal(helpers.findScheduleLogEntryIndent(withoutEntry, 1), "  \t");
});

test("planTargetTaskUpdate prepends a newest-first Schedule Log entry when a marker already exists", () => {
  const now = localDate(2026, 8, 15);
  const content = [
    "- [?] #task Ship it [scheduled:: 2026-08-20] ^ship",
    "  - 🗓️ **SCHEDULE LOG**",
    "    - _2026-08-01 → 2026-08-20_ — waiting on review",
  ].join("\n");
  const plan = helpers.planTargetTaskUpdate(content, 0, { activationEligible: true, now });

  assert.equal(plan.removedFutureSchedule, true);
  assert.equal(plan.logEntryAdded, true);
  assert.equal(plan.logInsertLine, 2);
  assert.equal(
    plan.content,
    [
      "- [*] #task Ship it ^ship",
      "  - 🗓️ **SCHEDULE LOG**",
      "    - _2026-08-20 → 2026-08-15_ — 🍅 pulled into today's Pomodoro",
      "    - _2026-08-01 → 2026-08-20_ — waiting on review",
    ].join("\n"),
  );
});

test("planTargetTaskUpdate creates the first entry using marker indent plus a tab when the marker has none yet", () => {
  const now = localDate(2026, 8, 15);
  const content = [
    "- [ ] #task Ship it [scheduled:: 2026-08-20] ^ship",
    "  - 🗓️ **SCHEDULE LOG**",
  ].join("\n");
  const plan = helpers.planTargetTaskUpdate(content, 0, { activationEligible: true, now });

  assert.equal(
    plan.content,
    [
      "- [*] #task Ship it ^ship",
      "  - 🗓️ **SCHEDULE LOG**",
      "  \t- _2026-08-20 → 2026-08-15_ — 🍅 pulled into today's Pomodoro",
    ].join("\n"),
  );
});

test("planTargetTaskUpdate never creates a Schedule Log for a task that keeps none", () => {
  const now = localDate(2026, 8, 15);
  const plan = helpers.planTargetTaskUpdate(
    "- [?] #task Ship it [scheduled:: 2026-08-20] ^ship",
    0,
    { activationEligible: true, now },
  );
  assert.equal(plan.removedFutureSchedule, true);
  assert.equal(plan.logEntryAdded, false);
  assert.equal(plan.content, "- [*] #task Ship it ^ship");
});

test("planTargetTaskUpdate preserves CRLF line endings, inheriting the marker's line ending for the new entry", () => {
  const now = localDate(2026, 8, 15);
  const content = [
    "- [?] #task Ship it [scheduled:: 2026-08-20] ^ship",
    "  - 🗓️ **SCHEDULE LOG**",
    "    - _2026-08-01 → 2026-08-20_ — waiting on review",
  ].join("\r\n");
  const plan = helpers.planTargetTaskUpdate(content, 0, { activationEligible: true, now });

  assert.equal(
    plan.content,
    [
      "- [*] #task Ship it ^ship",
      "  - 🗓️ **SCHEDULE LOG**",
      "    - _2026-08-20 → 2026-08-15_ — 🍅 pulled into today's Pomodoro",
      "    - _2026-08-01 → 2026-08-20_ — waiting on review",
    ].join("\r\n"),
  );
});

test("planTargetTaskUpdate preserves a missing trailing newline when the log lands at end of file", () => {
  const now = localDate(2026, 8, 15);
  const content = [
    "- [?] #task Ship it [scheduled:: 2026-08-20] ^ship",
    "  - 🗓️ **SCHEDULE LOG**",
  ].join("\n");
  const plan = helpers.planTargetTaskUpdate(content, 0, { activationEligible: true, now });

  assert.equal(plan.content.endsWith("\n"), false);
  assert.equal(
    plan.content,
    [
      "- [*] #task Ship it ^ship",
      "  - 🗓️ **SCHEDULE LOG**",
      "  \t- _2026-08-20 → 2026-08-15_ — 🍅 pulled into today's Pomodoro",
    ].join("\n"),
  );
});

test("planTargetTaskUpdate preserves a trailing newline when one was already present", () => {
  const now = localDate(2026, 8, 15);
  const content =
    ["- [?] #task Ship it [scheduled:: 2026-08-20] ^ship", "  - 🗓️ **SCHEDULE LOG**"].join(
      "\n",
    ) + "\n";
  const plan = helpers.planTargetTaskUpdate(content, 0, { activationEligible: true, now });

  assert.equal(plan.content.endsWith("\n"), true);
});

test("planTargetTaskUpdate never mutates the exact whitespace of a scheduled field it does not remove", () => {
  const now = localDate(2026, 7, 16);
  const content = "- [?] #task Ship it (scheduled::   2026-07-01  ) ^ship";
  const plan = helpers.planTargetTaskUpdate(content, 0, { activationEligible: true, now });
  assert.equal(plan.content, content);
});

test("planTargetTaskUpdate keeps a new block ID as the final token after unschedule, status, and log changes", () => {
  const now = localDate(2026, 8, 15);
  const content = [
    "- [?] #task Ship it [scheduled:: 2026-08-20] [priority:: high]",
    "  - 🗓️ **SCHEDULE LOG**",
  ].join("\n");
  const plan = helpers.planTargetTaskUpdate(content, 0, {
    activationEligible: true,
    newBlockId: "ship",
    now,
  });

  assert.equal(plan.blockIdAppended, true);
  assert.equal(
    plan.content,
    [
      "- [*] #task Ship it [priority:: high] ^ship",
      "  - 🗓️ **SCHEDULE LOG**",
      "  \t- _2026-08-20 → 2026-08-15_ — 🍅 pulled into today's Pomodoro",
    ].join("\n"),
  );
});

test("planTargetTaskUpdate never duplicates an existing block ID on the existing-ID path", () => {
  const now = localDate(2026, 8, 15);
  const plan = helpers.planTargetTaskUpdate("- [ ] #task Ship it ^ship", 0, {
    activationEligible: true,
    now,
  });
  assert.equal(plan.blockIdAppended, false);
  assert.equal((plan.content.match(/\^ship/g) || []).length, 1);
});

test("existing-ID activation runtime: cross-note guarded write, canonical link, and success notice", async () => {
  resetNotices();
  const editor = createEditor(
    ["## Pomodoros", "- [ ] Current ()", "  - [[Tasks]]^^"].join("\n"),
  );
  const source = sourceForTaskPicker(editor, "Daily.md", 2);
  const destinationContent = [
    "- [?] #task Ship it [scheduled:: 2026-08-20] ^ship",
    "  - 🗓️ **SCHEDULE LOG**",
    "    - _2026-08-01 → 2026-08-20_ — waiting on review",
  ].join("\n");
  const task = helpers.collectTaskPickerItems(destinationContent)[0];
  const plugin = new Plugin();
  plugin.now = () => localDate(2026, 8, 15);
  let written = null;
  plugin.readDestinationForValidation = async () => ({
    file: { path: "Tasks.md" },
    content: destinationContent,
  });
  plugin.app = {
    vault: {
      read: async (file) => (file.path === "Tasks.md" ? destinationContent : null),
      modify: async (file, content) => {
        written = { path: file.path, content };
      },
    },
  };
  plugin.resolveReferenceDestination = () => ({ path: "Tasks.md" });
  plugin.suppressEditorScans = () => {};

  const result = await plugin.completeTaskLinkWithExistingId(source, task);

  assert.deepEqual(result, { completed: true });
  assert.ok(written);
  assert.equal(written.path, "Tasks.md");
  assert.equal(
    written.content,
    [
      "- [*] #task Ship it ^ship",
      "  - 🗓️ **SCHEDULE LOG**",
      "    - _2026-08-20 → 2026-08-15_ — 🍅 pulled into today's Pomodoro",
      "    - _2026-08-01 → 2026-08-20_ — waiting on review",
    ].join("\n"),
  );
  assert.match(editor.getValue(), /\[\[Tasks#\^ship\]\]/);
  assert.equal(
    lastNotice(),
    "Linked task block · removed future schedule · set Next · logged schedule change",
  );
});

test("new-ID activation runtime: cross-note guarded write, appended ID stays final, and success notice", async () => {
  resetNotices();
  const editor = createEditor(
    ["## Pomodoros", "- [ ] Current ()", "  - [[Tasks]]^^"].join("\n"),
  );
  const source = sourceForTaskPicker(editor, "Daily.md", 2);
  const destinationContent = [
    "- [ ] #task Ship it [scheduled:: 2026-08-20] [priority:: high]",
    "  - 🗓️ **SCHEDULE LOG**",
  ].join("\n");
  const task = helpers.collectTaskPickerItems(destinationContent)[0];
  const plugin = new Plugin();
  plugin.now = () => localDate(2026, 8, 15);
  let written = null;
  plugin.readDestinationForValidation = async () => ({
    file: { path: "Tasks.md" },
    content: destinationContent,
  });
  plugin.app = {
    vault: {
      read: async (file) => (file.path === "Tasks.md" ? destinationContent : null),
      modify: async (file, content) => {
        written = { path: file.path, content };
      },
    },
  };
  plugin.resolveReferenceDestination = () => ({ path: "Tasks.md" });
  plugin.suppressEditorScans = () => {};

  const result = await plugin.submitLinkTaskBlockId(
    { ...source, kind: "link-task-complete", task },
    "ship",
  );

  assert.equal(result, true);
  assert.ok(written);
  assert.equal(
    written.content,
    [
      "- [*] #task Ship it [priority:: high] ^ship",
      "  - 🗓️ **SCHEDULE LOG**",
      "  \t- _2026-08-20 → 2026-08-15_ — 🍅 pulled into today's Pomodoro",
    ].join("\n"),
  );
  assert.match(editor.getValue(), /\[\[Tasks#\^ship\]\]/);
  assert.equal(
    lastNotice(),
    "Added block ID and linked task · removed future schedule · set Next · logged schedule change",
  );
});

test("activation runtime aborts without any write when the target preimage goes stale", async () => {
  resetNotices();
  const editor = createEditor(
    ["## Pomodoros", "- [ ] Current ()", "  - [[Tasks]]^^"].join("\n"),
  );
  const before = editor.getValue();
  const source = sourceForTaskPicker(editor, "Daily.md", 2);
  const plannedContent = [
    "- [?] #task Ship it [scheduled:: 2026-08-20] ^ship",
    "  - 🗓️ **SCHEDULE LOG**",
  ].join("\n");
  const staleContent = plannedContent.replace("Ship it", "Ship it NOW");
  const task = helpers.collectTaskPickerItems(plannedContent)[0];
  const plugin = new Plugin();
  plugin.now = () => localDate(2026, 8, 15);
  let modifyCalled = false;
  plugin.readDestinationForValidation = async () => ({
    file: { path: "Tasks.md" },
    content: plannedContent,
  });
  plugin.app = {
    vault: {
      read: async () => staleContent,
      modify: async () => {
        modifyCalled = true;
      },
    },
  };
  plugin.resolveReferenceDestination = () => ({ path: "Tasks.md" });
  plugin.suppressEditorScans = () => {};

  const result = await plugin.completeTaskLinkWithExistingId(source, task);

  assert.equal(result, null);
  assert.equal(modifyCalled, false);
  assert.equal(editor.getValue(), before);
  assert.equal(lastNotice(), "Task link stopped: Tasks.md changed before update");
});

test("same-note activation shifts the Pomodoro source line when the Schedule Log entry lands before it", async () => {
  resetNotices();
  const editor = createEditor(
    [
      "- [?] #task Ship it [scheduled:: 2026-08-20] ^ship",
      "  - 🗓️ **SCHEDULE LOG**",
      "    - _2026-08-01 → 2026-08-20_ — waiting on review",
      "## Pomodoros",
      "- [ ] Current ()",
      "  - [[^^]]",
      "- [ ] Later ()",
      "  - [[#^ship]]",
      "## Notes",
      "- keep this section",
    ].join("\n"),
  );
  const source = sourceForTaskPicker(editor, "Daily.md", 5);
  const task = helpers.collectTaskPickerItems(editor.getValue())[0];
  const plugin = new Plugin();
  plugin.now = () => localDate(2026, 8, 15);
  plugin.readDestinationForValidation = async () => ({
    file: { path: "Daily.md" },
    content: editor.getValue(),
  });
  plugin.resolveReferenceDestination = (reference) =>
    reference.targetText === "" ? { path: "Daily.md" } : null;
  plugin.suppressEditorScans = () => {};

  const result = await plugin.completeTaskLinkWithExistingId(source, task);

  assert.deepEqual(result, { completed: true });
  assert.equal(
    editor.getValue(),
    [
      "- [*] #task Ship it ^ship",
      "  - 🗓️ **SCHEDULE LOG**",
      "    - _2026-08-20 → 2026-08-15_ — 🍅 pulled into today's Pomodoro",
      "    - _2026-08-01 → 2026-08-20_ — waiting on review",
      "## Pomodoros",
      "- [ ] Current ()",
      "  - [[#^ship]]",
      "- [ ] Later ()",
      "## Notes",
      "- keep this section",
    ].join("\n"),
  );
  assert.deepEqual(editor.cursor, {
    line: 6,
    ch: source.startCh + "[[#^ship]]".length,
  });
});

test("same-note activation leaves the Pomodoro source line untouched when the Schedule Log entry lands after it", async () => {
  resetNotices();
  const editor = createEditor(
    [
      "## Pomodoros",
      "- [ ] Current ()",
      "  - [[^^]]",
      "- [?] #task Ship it [scheduled:: 2026-08-20] ^ship",
      "  - 🗓️ **SCHEDULE LOG**",
    ].join("\n"),
  );
  const source = sourceForTaskPicker(editor, "Daily.md", 2);
  const task = helpers.collectTaskPickerItems(editor.getValue())[0];
  const plugin = new Plugin();
  plugin.now = () => localDate(2026, 8, 15);
  plugin.readDestinationForValidation = async () => ({
    file: { path: "Daily.md" },
    content: editor.getValue(),
  });
  plugin.resolveReferenceDestination = (reference) =>
    reference.targetText === "" ? { path: "Daily.md" } : null;
  plugin.suppressEditorScans = () => {};

  const result = await plugin.completeTaskLinkWithExistingId(source, task);

  assert.deepEqual(result, { completed: true });
  assert.equal(
    editor.getValue(),
    [
      "## Pomodoros",
      "- [ ] Current ()",
      "  - [[#^ship]]",
      "- [*] #task Ship it ^ship",
      "  - 🗓️ **SCHEDULE LOG**",
      "  \t- _2026-08-20 → 2026-08-15_ — 🍅 pulled into today's Pomodoro",
    ].join("\n"),
  );
  assert.deepEqual(editor.cursor, {
    line: 2,
    ch: source.startCh + "[[#^ship]]".length,
  });
});

test("a source marker edited after a successful existing-ID target write reports an accurate partial notice", async () => {
  resetNotices();
  const editor = createEditor(
    ["## Pomodoros", "- [ ] Current ()", "  - [[Tasks]]^^"].join("\n"),
  );
  const source = sourceForTaskPicker(editor, "Daily.md", 2);
  const destinationContent = [
    "- [?] #task Ship it [scheduled:: 2026-08-20] ^ship",
    "  - 🗓️ **SCHEDULE LOG**",
  ].join("\n");
  const task = helpers.collectTaskPickerItems(destinationContent)[0];
  const plugin = new Plugin();
  plugin.now = () => localDate(2026, 8, 15);
  let written = null;
  plugin.readDestinationForValidation = async () => ({
    file: { path: "Tasks.md" },
    content: destinationContent,
  });
  plugin.app = {
    vault: {
      read: async () => destinationContent,
      modify: async (file, content) => {
        written = { path: file.path, content };
        // Simulate the user editing the source link away right as the target
        // write lands, before source-link completion runs.
        editor.replaceRange(
          "typed over",
          { line: source.line, ch: source.startCh },
          { line: source.line, ch: source.endCh },
        );
      },
    },
  };
  plugin.resolveReferenceDestination = () => ({ path: "Tasks.md" });
  plugin.suppressEditorScans = () => {};

  const result = await plugin.completeTaskLinkWithExistingId(source, task);

  assert.equal(result, null);
  assert.ok(written, "target note was still written");
  assert.match(editor.getValue(), /typed over/);
  assert.equal(
    lastNotice(),
    "Task unscheduled, set Next, logged, but the source link changed before completion",
  );
});

test("a source marker edited after a successful new-ID target write reports an accurate partial notice", async () => {
  resetNotices();
  const editor = createEditor(
    ["## Pomodoros", "- [ ] Current ()", "  - [[Tasks]]^^"].join("\n"),
  );
  const source = sourceForTaskPicker(editor, "Daily.md", 2);
  const destinationContent = "- [ ] #task Ship it [scheduled:: 2026-08-20]";
  const task = helpers.collectTaskPickerItems(destinationContent)[0];
  const plugin = new Plugin();
  plugin.now = () => localDate(2026, 8, 15);
  plugin.readDestinationForValidation = async () => ({
    file: { path: "Tasks.md" },
    content: destinationContent,
  });
  plugin.app = {
    vault: {
      read: async () => destinationContent,
      modify: async () => {
        editor.replaceRange(
          "typed over",
          { line: source.line, ch: source.startCh },
          { line: source.line, ch: source.endCh },
        );
      },
    },
  };
  plugin.resolveReferenceDestination = () => ({ path: "Tasks.md" });
  plugin.suppressEditorScans = () => {};

  const result = await plugin.submitLinkTaskBlockId(
    { ...source, kind: "link-task-complete", task },
    "ship",
  );

  assert.equal(result, true);
  assert.match(editor.getValue(), /typed over/);
  assert.equal(
    lastNotice(),
    "Task block ID added and unscheduled, set Next, but the source link changed before completion",
  );
});

// ---------------------------------------------------------------------------
// Ctrl+Shift+Enter direct Pomodoro link.
// ---------------------------------------------------------------------------

test("planTargetTaskUpdate forceNext raises Ready/Blocked to Next and never lowers Next or In Progress", () => {
  const now = localDate(2026, 8, 15);
  for (const status of [" ", "?"]) {
    const plan = helpers.planTargetTaskUpdate(`- [${status}] #task Do it`, 0, {
      forceNext: true,
      now,
    });
    assert.equal(plan.newStatus, "*");
    assert.equal(plan.statusChanged, true);
  }
  for (const status of ["*", "/"]) {
    const plan = helpers.planTargetTaskUpdate(`- [${status}] #task Do it`, 0, {
      forceNext: true,
      now,
    });
    assert.equal(plan.newStatus, status);
    assert.equal(plan.statusChanged, false);
    assert.equal(plan.hasChanges, false);
  }
});

test("planTargetTaskUpdate without forceNext leaves an In Progress task and an unscheduled Blocked task alone", () => {
  const now = localDate(2026, 8, 15);
  const inProgress = helpers.planTargetTaskUpdate("- [/] #task Do it", 0, {
    activationEligible: true,
    now,
  });
  assert.equal(inProgress.newStatus, "/");
  assert.equal(inProgress.statusChanged, false);

  const blockedNoSchedule = helpers.planTargetTaskUpdate("- [?] #task Do it", 0, {
    activationEligible: true,
    now,
  });
  assert.equal(blockedNoSchedule.newStatus, "?");
  assert.equal(blockedNoSchedule.statusChanged, false);
});

test("planTargetTaskUpdate forceNext still removes a uniquely future schedule and logs it against an existing Schedule Log", () => {
  const now = localDate(2026, 8, 15);
  const content = [
    "- [?] #task Ship it [scheduled:: 2026-08-20]",
    "  - 🗓️ **SCHEDULE LOG**",
  ].join("\n");
  const plan = helpers.planTargetTaskUpdate(content, 0, { forceNext: true, now });
  assert.equal(plan.removedFutureSchedule, true);
  assert.equal(plan.newStatus, "*");
  assert.equal(plan.logEntryAdded, true);
});

test("planTargetTaskUpdate forceNext never creates a Schedule Log for a task that keeps none", () => {
  const now = localDate(2026, 8, 15);
  const plan = helpers.planTargetTaskUpdate(
    "- [?] #task Ship it [scheduled:: 2026-08-20]",
    0,
    { forceNext: true, now },
  );
  assert.equal(plan.removedFutureSchedule, true);
  assert.equal(plan.newStatus, "*");
  assert.equal(plan.logEntryAdded, false);
  assert.equal(plan.content, "- [*] #task Ship it");
});
