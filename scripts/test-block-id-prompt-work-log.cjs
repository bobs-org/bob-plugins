const test = require("node:test");
const assert = require("node:assert/strict");
const {
  helpers,
  WORK_LOG_DATE,
} = require("./block-id-prompt-harness.cjs");

test("work summary normalization trims, collapses whitespace, preserves Markdown, and flags Dataview fields", () => {
  assert.equal(helpers.normalizeWorkSummary("  Added   guarded\ncleanup\tcoverage  "), "Added guarded cleanup coverage");
  assert.equal(helpers.normalizeWorkSummary(" \n\t "), "");
  assert.equal(
    helpers.normalizeWorkSummary("Kept [[Project|project]], `code`, and **bold**"),
    "Kept [[Project|project]], `code`, and **bold**",
  );
  assert.equal(
    helpers.formatWorkLogEntry("  Kept [[Project|project]], `code`, and **bold**  ", WORK_LOG_DATE),
    "*2026-08-15* — Kept [[Project|project]], `code`, and **bold**",
  );
  assert.equal(helpers.formatWorkLogEntry(" \n\t ", WORK_LOG_DATE), "");
  assert.equal(helpers.workSummaryContainsDataviewInlineField("progress:: shipped"), true);
  assert.deepEqual(helpers.workSummaryPromptState("  ", { date: WORK_LOG_DATE }), {
    summary: "",
    date: WORK_LOG_DATE,
    formattedEntry: "",
    isBlank: true,
    hasDataviewWarning: false,
    primaryButtonText: "Unlink",
  });
  assert.deepEqual(helpers.workSummaryPromptState("progress:: shipped", { date: WORK_LOG_DATE }), {
    summary: "progress:: shipped",
    date: WORK_LOG_DATE,
    formattedEntry: "*2026-08-15* — progress:: shipped",
    isBlank: false,
    hasDataviewWarning: true,
    primaryButtonText: "Unlink & log",
  });
});

test("work log date helpers use local calendar components", () => {
  class LocalLateNightDate extends Date {
    getFullYear() {
      return 2026;
    }

    getMonth() {
      return 7;
    }

    getDate() {
      return 15;
    }

    toISOString() {
      return "2026-08-16T03:30:00.000Z";
    }
  }

  const localParts = helpers.localTodayParts(new LocalLateNightDate());
  assert.deepEqual(localParts, WORK_LOG_DATE);
  assert.equal(helpers.formatWorkLogEntry("Added guarded cleanup", localParts), "*2026-08-15* — Added guarded cleanup");
});

test("planWorkLogInsertion creates tab-indented Work Log children for column-0 tasks without children", () => {
  const content = ["- [ ] #task Ship it ^ship", "- [ ] #task Sibling"].join("\n");
  const plan = helpers.planWorkLogInsertion(content, 0, "Added guarded cleanup", {
    date: WORK_LOG_DATE,
  });

  assert.equal(
    plan.content,
    [
      "- [ ] #task Ship it ^ship",
      "\t- 🛠️ **WORK LOG**",
      "\t\t- *2026-08-15* — Added guarded cleanup",
      "- [ ] #task Sibling",
    ].join("\n"),
  );
});

test("planWorkLogInsertion inherits an existing space-indented child prefix", () => {
  const content = [
    "- [ ] #task Ship it ^ship",
    "  - Keep this child",
    "- [ ] #task Sibling",
  ].join("\n");
  const plan = helpers.planWorkLogInsertion(content, 0, "Added guarded cleanup", {
    date: WORK_LOG_DATE,
  });

  assert.equal(plan.workLogEntryAdded, true);
  assert.deepEqual(plan.workLogDate, WORK_LOG_DATE);
  assert.equal(plan.workLogFormattedEntry, "*2026-08-15* — Added guarded cleanup");
  assert.equal(
    plan.content,
    [
      "- [ ] #task Ship it ^ship",
      "  - Keep this child",
      "  - 🛠️ **WORK LOG**",
      "    - *2026-08-15* — Added guarded cleanup",
      "- [ ] #task Sibling",
    ].join("\n"),
  );
  assert.doesNotMatch(plan.content, /  \t/);
});

test("planWorkLogInsertion inherits an existing tab-indented child prefix", () => {
  const content = [
    "- [ ] #task Ship it ^ship",
    "\t- Keep this child",
    "- [ ] #task Sibling",
  ].join("\n");
  const plan = helpers.planWorkLogInsertion(content, 0, "Added guarded cleanup", {
    date: WORK_LOG_DATE,
  });

  assert.equal(
    plan.content,
    [
      "- [ ] #task Ship it ^ship",
      "\t- Keep this child",
      "\t- 🛠️ **WORK LOG**",
      "\t\t- *2026-08-15* — Added guarded cleanup",
      "- [ ] #task Sibling",
    ].join("\n"),
  );
});

test("planWorkLogInsertion prepends newest-first entries into existing marker spellings", () => {
  const canonical = [
    "- [ ] #task Ship it ^ship",
    "  * 🛠️ **WORK LOG**",
    "    * Yesterday's work",
  ].join("\n");
  assert.equal(
    helpers.planWorkLogInsertion(canonical, 0, "Today", { date: WORK_LOG_DATE }).content,
    [
      "- [ ] #task Ship it ^ship",
      "  * 🛠️ **WORK LOG**",
      "    * *2026-08-15* — Today",
      "    * Yesterday's work",
    ].join("\n"),
  );

  const legacy = [
    "- [ ] #task Ship it ^ship",
    "  + **Work log:**",
  ].join("\n");
  assert.equal(
    helpers.planWorkLogInsertion(legacy, 0, "Legacy marker", { date: WORK_LOG_DATE }).content,
    [
      "- [ ] #task Ship it ^ship",
      "  + **Work log:**",
      "    + *2026-08-15* — Legacy marker",
    ].join("\n"),
  );
  assert.doesNotMatch(helpers.planWorkLogInsertion(legacy, 0, "Legacy marker", { date: WORK_LOG_DATE }).content, /  \t/);

  const tabMarkerWithoutEntries = [
    "- [ ] #task Ship it ^ship",
    "\t- 🛠️ **WORK LOG**",
  ].join("\n");
  assert.equal(
    helpers.planWorkLogInsertion(tabMarkerWithoutEntries, 0, "First tab entry", { date: WORK_LOG_DATE }).content,
    [
      "- [ ] #task Ship it ^ship",
      "\t- 🛠️ **WORK LOG**",
      "\t\t- *2026-08-15* — First tab entry",
    ].join("\n"),
  );

  const emojiLess = [
    "- [ ] #task Ship it ^ship",
    "  - **WORK LOG**",
  ].join("\n");
  assert.ok(helpers.findWorkLogMarker(emojiLess.split("\n"), 0));
});

test("planWorkLogInsertion ignores nested child-task markers and preserves CRLF", () => {
  const nested = [
    "- [ ] #task Parent ^parent",
    "  - [ ] #task Child ^child",
    "    - **WORK LOG**",
    "      - Child work",
  ].join("\n");
  assert.equal(
    helpers.planWorkLogInsertion(nested, 0, "Parent work", { date: WORK_LOG_DATE }).content,
    [
      "- [ ] #task Parent ^parent",
      "  - [ ] #task Child ^child",
      "    - **WORK LOG**",
      "      - Child work",
      "  - 🛠️ **WORK LOG**",
      "    - *2026-08-15* — Parent work",
    ].join("\n"),
  );

  const crlf = ["- [ ] #task Ship ^ship", "  - 🛠️ **WORK LOG**", "    - Old"].join("\r\n");
  const plan = helpers.planWorkLogInsertion(crlf, 0, "New", { date: WORK_LOG_DATE });
  assert.doesNotMatch(plan.content, /(^|[^\r])\n/);
  assert.match(plan.content, /\*2026-08-15\* — New\r\n    - Old/);
});

test("planWorkLogInsertion treats blank summaries as no-op structural edits", () => {
  const content = ["- [ ] #task Ship it ^ship", "  - 🛠️ **WORK LOG**"].join("\n");
  const plan = helpers.planWorkLogInsertion(content, 0, " \n\t ");

  assert.equal(plan.workLogEntryAdded, false);
  assert.equal(plan.workLogDate, null);
  assert.equal(plan.workLogFormattedEntry, "");
  assert.equal(plan.hasChanges, false);
  assert.deepEqual(plan.edits, []);
  assert.equal(plan.content, content);
});

test("the Open-reset planner is removed: unlink plans only a Work Log insertion", () => {
  assert.equal(helpers.planTargetTaskOpenUpdate, undefined);

  const blank = helpers.planWorkLogInsertion("- [*] #task Ship it ^ship", 0, " \n\t ");
  assert.equal(blank.workLogEntryAdded, false);
  assert.deepEqual(blank.edits, []);
  assert.equal(blank.content, "- [*] #task Ship it ^ship");
});

test("unlink Work Log plan keeps the In Progress checkbox and appends one entry", () => {
  const content = ["- [/] #task Ship it ^ship", "  - Keep detail"].join("\n");
  const plan = helpers.planWorkLogInsertion(content, 0, "  Added\ncoverage  ", {
    date: WORK_LOG_DATE,
  });

  assert.equal(plan.workLogEntryAdded, true);
  assert.equal(
    plan.content,
    [
      "- [/] #task Ship it ^ship",
      "  - Keep detail",
      "  - 🛠️ **WORK LOG**",
      "    - *2026-08-15* — Added coverage",
    ].join("\n"),
  );
});
