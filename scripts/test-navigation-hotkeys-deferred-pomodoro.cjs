const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  helpers,
} = require("./navigation-hotkeys-harness.cjs");

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

