const test = require("node:test");
const assert = require("node:assert/strict");
const {
  helpers,
  WORK_LOG_NOW,
  WORK_LOG_STAMP,
} = require("./block-id-prompt-harness.cjs");

test("work summary normalization trims, collapses whitespace, preserves Markdown, and flags Dataview fields", () => {
  assert.equal(helpers.normalizeWorkSummary("  Added   guarded\ncleanup\tcoverage  "), "Added guarded cleanup coverage");
  assert.equal(helpers.normalizeWorkSummary(" \n\t "), "");
  assert.equal(
    helpers.normalizeWorkSummary("Kept [[Project|project]], `code`, and **bold**"),
    "Kept [[Project|project]], `code`, and **bold**",
  );
  assert.equal(
    helpers.formatWorkLogEntry("  Kept [[Project|project]], `code`, and **bold**  ", WORK_LOG_STAMP),
    "*2026-08-15 14:32* — Kept [[Project|project]], `code`, and **bold**",
  );
  assert.equal(helpers.formatWorkLogEntry(" \n\t ", WORK_LOG_STAMP), "");
  assert.equal(helpers.workSummaryContainsDataviewInlineField("progress:: shipped"), true);
  assert.deepEqual(helpers.workSummaryPromptState("  ", { stamp: WORK_LOG_STAMP }), {
    summary: "",
    stamp: WORK_LOG_STAMP,
    formattedEntry: "",
    isBlank: true,
    hasDataviewWarning: false,
    primaryButtonText: "Unlink",
  });
  assert.deepEqual(helpers.workSummaryPromptState("progress:: shipped", { stamp: WORK_LOG_STAMP }), {
    summary: "progress:: shipped",
    stamp: WORK_LOG_STAMP,
    formattedEntry: "*2026-08-15 14:32* — progress:: shipped",
    isBlank: false,
    hasDataviewWarning: true,
    primaryButtonText: "Unlink & log",
  });
});

test("formatWorkLogStamp matches the shared conformance vectors", () => {
  const vectors = [
    [new Date(2026, 10, 1, 14, 32, 59), "2026-11-01 14:32"],
    [new Date(2026, 10, 1, 9, 5, 0), "2026-11-01 09:05"],
    [new Date(2026, 11, 31, 23, 59, 59), "2026-12-31 23:59"],
    [new Date(2027, 0, 1, 0, 0, 0), "2027-01-01 00:00"],
  ];
  for (const [instant, stamp] of vectors) {
    assert.equal(helpers.formatWorkLogStamp(instant), stamp);
  }
  assert.equal(
    helpers.formatWorkLogEntry("Finished the API review", "2026-11-01 14:32"),
    "*2026-11-01 14:32* — Finished the API review",
  );
});

test("work log stamps use local wall-clock components", () => {
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

    getHours() {
      return 21;
    }

    getMinutes() {
      return 5;
    }

    toISOString() {
      return "2026-08-16T03:05:00.000Z";
    }
  }

  const stamp = helpers.formatWorkLogStamp(new LocalLateNightDate());
  assert.equal(stamp, "2026-08-15 21:05");
  assert.equal(helpers.formatWorkLogEntry("Added guarded cleanup", stamp), "*2026-08-15 21:05* — Added guarded cleanup");
});

test("planWorkLogInsertion stamps the injected clock when no stamp is given", () => {
  const content = "- [/] #task Ship it ^ship";
  const plan = helpers.planWorkLogInsertion(content, 0, "Added coverage", { now: WORK_LOG_NOW });

  assert.equal(plan.workLogStamp, WORK_LOG_STAMP);
  assert.equal(plan.workLogFormattedEntry, "*2026-08-15 14:32* — Added coverage");
  assert.equal(
    plan.content,
    [content, "\t- 🛠️ **WORK LOG**", "\t\t- *2026-08-15 14:32* — Added coverage"].join("\n"),
  );
});

test("workSummaryPromptState previews the clock at render time", () => {
  const first = helpers.workSummaryPromptState("Added coverage", { now: new Date(2026, 7, 15, 23, 59, 30) });
  assert.equal(first.stamp, "2026-08-15 23:59");
  assert.equal(first.formattedEntry, "*2026-08-15 23:59* — Added coverage");

  const later = helpers.workSummaryPromptState("Added coverage", { now: new Date(2026, 7, 16, 0, 1, 5) });
  assert.equal(later.stamp, "2026-08-16 00:01");
  assert.equal(later.formattedEntry, "*2026-08-16 00:01* — Added coverage");
});

test("planWorkLogInsertion creates tab-indented Work Log children for column-0 tasks without children", () => {
  const content = ["- [ ] #task Ship it ^ship", "- [ ] #task Sibling"].join("\n");
  const plan = helpers.planWorkLogInsertion(content, 0, "Added guarded cleanup", {
    stamp: WORK_LOG_STAMP,
  });

  assert.equal(
    plan.content,
    [
      "- [ ] #task Ship it ^ship",
      "\t- 🛠️ **WORK LOG**",
      "\t\t- *2026-08-15 14:32* — Added guarded cleanup",
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
    stamp: WORK_LOG_STAMP,
  });

  assert.equal(plan.workLogEntryAdded, true);
  assert.equal(plan.workLogStamp, WORK_LOG_STAMP);
  assert.equal(plan.workLogFormattedEntry, "*2026-08-15 14:32* — Added guarded cleanup");
  assert.equal(
    plan.content,
    [
      "- [ ] #task Ship it ^ship",
      "  - Keep this child",
      "  - 🛠️ **WORK LOG**",
      "    - *2026-08-15 14:32* — Added guarded cleanup",
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
    stamp: WORK_LOG_STAMP,
  });

  assert.equal(
    plan.content,
    [
      "- [ ] #task Ship it ^ship",
      "\t- Keep this child",
      "\t- 🛠️ **WORK LOG**",
      "\t\t- *2026-08-15 14:32* — Added guarded cleanup",
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
    helpers.planWorkLogInsertion(canonical, 0, "Today", { stamp: WORK_LOG_STAMP }).content,
    [
      "- [ ] #task Ship it ^ship",
      "  * 🛠️ **WORK LOG**",
      "    * *2026-08-15 14:32* — Today",
      "    * Yesterday's work",
    ].join("\n"),
  );

  const legacy = [
    "- [ ] #task Ship it ^ship",
    "  + **Work log:**",
  ].join("\n");
  assert.equal(
    helpers.planWorkLogInsertion(legacy, 0, "Legacy marker", { stamp: WORK_LOG_STAMP }).content,
    [
      "- [ ] #task Ship it ^ship",
      "  + **Work log:**",
      "    + *2026-08-15 14:32* — Legacy marker",
    ].join("\n"),
  );
  assert.doesNotMatch(helpers.planWorkLogInsertion(legacy, 0, "Legacy marker", { stamp: WORK_LOG_STAMP }).content, /  \t/);

  const tabMarkerWithoutEntries = [
    "- [ ] #task Ship it ^ship",
    "\t- 🛠️ **WORK LOG**",
  ].join("\n");
  assert.equal(
    helpers.planWorkLogInsertion(tabMarkerWithoutEntries, 0, "First tab entry", { stamp: WORK_LOG_STAMP }).content,
    [
      "- [ ] #task Ship it ^ship",
      "\t- 🛠️ **WORK LOG**",
      "\t\t- *2026-08-15 14:32* — First tab entry",
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
    helpers.planWorkLogInsertion(nested, 0, "Parent work", { stamp: WORK_LOG_STAMP }).content,
    [
      "- [ ] #task Parent ^parent",
      "  - [ ] #task Child ^child",
      "    - **WORK LOG**",
      "      - Child work",
      "  - 🛠️ **WORK LOG**",
      "    - *2026-08-15 14:32* — Parent work",
    ].join("\n"),
  );

  const crlf = ["- [ ] #task Ship ^ship", "  - 🛠️ **WORK LOG**", "    - Old"].join("\r\n");
  const plan = helpers.planWorkLogInsertion(crlf, 0, "New", { stamp: WORK_LOG_STAMP });
  assert.doesNotMatch(plan.content, /(^|[^\r])\n/);
  assert.match(plan.content, /\*2026-08-15 14:32\* — New\r\n    - Old/);
});

test("planWorkLogInsertion treats blank summaries as no-op structural edits", () => {
  const content = ["- [ ] #task Ship it ^ship", "  - 🛠️ **WORK LOG**"].join("\n");
  const plan = helpers.planWorkLogInsertion(content, 0, " \n\t ");

  assert.equal(plan.workLogEntryAdded, false);
  assert.equal(plan.workLogStamp, null);
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
    stamp: WORK_LOG_STAMP,
  });

  assert.equal(plan.workLogEntryAdded, true);
  assert.equal(
    plan.content,
    [
      "- [/] #task Ship it ^ship",
      "  - Keep detail",
      "  - 🛠️ **WORK LOG**",
      "    - *2026-08-15 14:32* — Added coverage",
    ].join("\n"),
  );
});
