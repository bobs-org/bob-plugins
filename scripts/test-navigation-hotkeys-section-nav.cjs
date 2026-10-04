const test = require("node:test");
const assert = require("node:assert/strict");
const {
  helpers,
} = require("./navigation-hotkeys-harness.cjs");

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

test("open-task navigation scan includes Ready In Progress and Next and excludes Blocked", () => {
  assert.equal(helpers.isActiveObsidianTaskNavigationLine("- [ ] #task Ready"), true);
  assert.equal(
    helpers.isActiveObsidianTaskNavigationLine("- [/] #task Working"),
    true,
  );
  assert.equal(helpers.isActiveObsidianTaskNavigationLine("- [*] #task Next"), true);
  assert.equal(
    helpers.isActiveObsidianTaskNavigationLine("- [?] #task Blocked"),
    false,
  );
  assert.equal(helpers.isActiveObsidianTaskNavigationLine("- [x] #task Done"), false);
  assert.equal(
    helpers.isActiveObsidianTaskNavigationLine("- [-] #task Cancelled"),
    false,
  );
  assert.equal(
    helpers.isActiveObsidianTaskNavigationLine("- [!] #task Unknown"),
    false,
  );
  assert.equal(
    helpers.isActiveObsidianTaskNavigationLine("- [ ] Untagged checkbox"),
    false,
  );
  assert.equal(helpers.isOpenObsidianTaskLine("- [?] #task Blocked"), true);

  const lines = [
    "---",
    "- [ ] #task Frontmatter",
    "---",
    "- [ ] #task Ready",
    "- [/] #task Working",
    "- [*] #task Next",
    "- [?] #task Blocked",
    "- [x] #task Done",
    "- [-] #task Cancelled",
    "- [!] #task Unknown",
    "- [ ] Untagged checkbox",
    "```md",
    "- [ ] #task Fenced",
    "```",
    "- [ ] #task After fence",
  ];
  assert.deepEqual(helpers.getOpenTaskNavigationLines(lines), [3, 4, 5, 14]);
});

test("open-task navigation keeps existing Pomodoro ledger targets", () => {
  const lines = [
    "## Pomodoros",
    "- [ ] Future ()",
    "- [/] Working (09:00-09:25)",
    "- [x] Done (0930-1000)",
    "- [X] Also done (10:00-10:25)",
    "- [-] Cancelled (1025-1050)",
    "- [*] On hold ()",
    "- [?] Blocked ()",
    "  - [ ] Indented child ()",
    "- [ ] Missing ledger shape",
    "## Tasks",
    "- [ ] #task After section",
    "- [?] #task Blocked after section",
  ];
  assert.deepEqual(helpers.getOpenTaskNavigationLines(lines), [1, 2, 3, 4, 11]);
});

test("next and previous jumps skip Blocked tasks and wrap to an allowed task", () => {
  const lines = [
    "- [ ] #task Ready",
    "- [?] #task Blocked mid",
    "- [/] #task Working",
    "- [?] #task Blocked last",
  ];
  assert.equal(helpers.getOpenObsidianTaskJumpLine(lines, 0, 1), 2);
  assert.equal(helpers.getOpenObsidianTaskJumpLine(lines, 2, 1), 0);
  assert.equal(helpers.getOpenObsidianTaskJumpLine(lines, 2, -1), 0);
  assert.equal(helpers.getOpenObsidianTaskJumpLine(lines, 0, -1), 2);
  assert.equal(helpers.getOpenObsidianTaskJumpLine(lines, 1, 1), 2);
  assert.equal(helpers.getOpenObsidianTaskJumpLine(lines, 1, -1), 0);
  assert.equal(helpers.getOpenObsidianTaskJumpLine(lines, 3, 1), 0);
  assert.equal(helpers.getOpenObsidianTaskJumpLine(lines, 3, -1), 2);
});

test("blocked-only notes and a sole current allowed task have no jump target", () => {
  const blockedOnly = ["- [?] #task One", "- [?] #task Two"];
  assert.deepEqual(helpers.getOpenTaskNavigationLines(blockedOnly), []);
  assert.equal(helpers.getOpenObsidianTaskJumpLine(blockedOnly, 0, 1), null);
  assert.equal(helpers.getOpenObsidianTaskJumpLine(blockedOnly, 1, -1), null);

  const singleAllowed = ["- [ ] #task Only"];
  assert.deepEqual(helpers.getOpenTaskNavigationLines(singleAllowed), [0]);
  assert.equal(helpers.getOpenObsidianTaskJumpLine(singleAllowed, 0, 1), null);
  assert.equal(helpers.getOpenObsidianTaskJumpLine(singleAllowed, 0, -1), null);
});

test("counted open-task jumps select the Nth eligible target and wrap modulo the list", () => {
  const lines = [
    "- [ ] #task A",
    "plain between",
    "- [/] #task B",
    "- [?] #task Blocked",
    "- [*] #task C",
    "- [ ] #task D",
  ];
  assert.deepEqual(helpers.getOpenTaskNavigationLines(lines), [0, 2, 4, 5]);

  assert.equal(helpers.getOpenObsidianTaskJumpLine(lines, 0, 1, 2), 4);
  assert.equal(helpers.getOpenObsidianTaskJumpLine(lines, 0, 1, 3), 5);
  assert.equal(helpers.getOpenObsidianTaskJumpLine(lines, 0, -1, 2), 4);
  assert.equal(helpers.getOpenObsidianTaskJumpLine(lines, 0, -1, 3), 2);

  assert.equal(helpers.getOpenObsidianTaskJumpLine(lines, 1, 1, 2), 4);
  assert.equal(helpers.getOpenObsidianTaskJumpLine(lines, 1, 1, 3), 5);
  assert.equal(helpers.getOpenObsidianTaskJumpLine(lines, 1, -1, 2), 5);
  assert.equal(helpers.getOpenObsidianTaskJumpLine(lines, 1, -1, 3), 4);

  assert.equal(helpers.getOpenObsidianTaskJumpLine(lines, 5, 1, 2), 2);
  assert.equal(helpers.getOpenObsidianTaskJumpLine(lines, 5, -1, 2), 2);
  assert.equal(helpers.getOpenObsidianTaskJumpLine(lines, 3, 1, 3), 0);
  assert.equal(helpers.getOpenObsidianTaskJumpLine(lines, 0, 1, 6), 4);
  assert.equal(helpers.getOpenObsidianTaskJumpLine(lines, 0, -1, 5), 5);
});

test("counted open-task jumps keep sole-target and invalid-repeat behavior", () => {
  const lines = [
    "- [ ] #task A",
    "plain between",
    "- [/] #task B",
    "- [?] #task Blocked",
    "- [*] #task C",
    "- [ ] #task D",
  ];
  assert.equal(helpers.getOpenObsidianTaskJumpLine(lines, 0, 1, 4), 0);
  assert.equal(helpers.getOpenObsidianTaskJumpLine(lines, 0, -1, 4), 0);

  const singleCurrent = ["- [ ] #task Only"];
  for (const repeat of [1, 2, 9, 100]) {
    assert.equal(helpers.getOpenObsidianTaskJumpLine(singleCurrent, 0, 1, repeat), null);
    assert.equal(helpers.getOpenObsidianTaskJumpLine(singleCurrent, 0, -1, repeat), null);
  }

  const singleAway = ["plain", "- [ ] #task Only"];
  for (const repeat of [1, 2, 7]) {
    assert.equal(helpers.getOpenObsidianTaskJumpLine(singleAway, 0, 1, repeat), 1);
    assert.equal(helpers.getOpenObsidianTaskJumpLine(singleAway, 0, -1, repeat), 1);
  }

  const omitted = helpers.getOpenObsidianTaskJumpLine(lines, 0, 1);
  for (const repeat of [0, -3, null, undefined, "nope", 1.8]) {
    assert.equal(helpers.getOpenObsidianTaskJumpLine(lines, 0, 1, repeat), omitted);
  }
});
