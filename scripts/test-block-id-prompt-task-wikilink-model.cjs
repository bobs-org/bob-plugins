// Task Wikilink Picker model parity test.
//
// Fixture: scripts/fixtures/task_wikilinks/vectors.json, a verbatim copy
// of bob-cli's tests/fixtures/task_wikilinks/vectors.json
// (sha256 c862c4b9ad2bfe238265b0e56275ab47621513476c83a69f96c5a0d903ec7090).
// The hash assertion below fails loudly on local edits: refresh the copy
// from bob-cli and update EXPECTED_FIXTURE_SHA together, never hand-edit
// the mirror.
//
// For every vector this runs the vault through the pure JS model
// (parse, basename index, previous-daily guard, rank, replacement) and
// asserts deep equality with the rows bob produces, so the Obsidian
// picker paints the same pool, order, link targets, and guards as
// `capture_task_wikilinks::candidates`.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const { helpers } = require("./block-id-prompt-harness.cjs");

const FIXTURE_PATH = join(
  __dirname,
  "fixtures",
  "task_wikilinks",
  "vectors.json",
);
const EXPECTED_FIXTURE_SHA =
  "c862c4b9ad2bfe238265b0e56275ab47621513476c83a69f96c5a0d903ec7090";

function fixtureSha() {
  return createHash("sha256").update(readFileSync(FIXTURE_PATH)).digest("hex");
}

function parseVectorNow(nowText) {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    nowText,
  );
  assert.ok(match, `vector now parses: ${nowText}`);
  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6] || 0),
  );
}

// The full JS-side pipeline for one vector: parse every note bob would
// scan, attach bob's locator and link target, then rank like bob.
function modelRowsForVector(vector) {
  const dataJson =
    vector.vault[".obsidian/plugins/obsidian-tasks-plugin/data.json"];
  const settings = dataJson
    ? helpers.taskWikilinkSettingsFromTasksJson(JSON.parse(dataJson))
    : helpers.defaultTaskWikilinkSettings();
  const notePaths = Object.keys(vector.vault).filter(
    helpers.isTaskWikilinkNotePath,
  );
  const index = helpers.buildBasenameIndex(notePaths);
  const previousDailyPath = helpers.previousDailyNotePath(
    notePaths,
    parseVectorNow(vector.now),
  );
  let rows = [];
  for (const notePath of notePaths) {
    for (const row of helpers.parseNoteTaskRows(
      notePath,
      vector.vault[notePath],
      settings,
    )) {
      rows.push({
        ...row,
        locator: index.locatorFor(notePath),
        linkTarget: index.linkTargetFor(notePath),
      });
    }
  }
  rows = helpers.orderForWikilinkPicker(rows, vector.query, vector.owner);
  return rows.map((row) => {
    const disabledReason = helpers.disabledReasonFor(row, {
      previousDailyPath,
    });
    return {
      note_path: row.notePath,
      line: row.line + 1,
      group: helpers.groupForWikilinkTask(row, vector.owner),
      hidden: row.hidden,
      block_id: row.blockId,
      locator: row.locator,
      link_target: row.linkTarget,
      replacement: helpers.replacementForWikilinkTask(row, disabledReason),
      disabled_reason: disabledReason,
      status_symbol: row.status,
      text: row.searchText,
    };
  });
}

test("task wikilink fixture mirrors bob-cli byte for byte", () => {
  assert.equal(fixtureSha(), EXPECTED_FIXTURE_SHA);
});

test("every vector ranks the same rows bob serves", () => {
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
  assert.equal(fixture.version, 1);
  assert.ok(fixture.vectors.length > 0);
  for (const vector of fixture.vectors) {
    assert.deepEqual(
      modelRowsForVector(vector),
      vector.rows,
      `vector ${vector.name}`,
    );
  }
});

test("frontmatter tasks never parse, unclosed fences stay open", () => {
  const settings = helpers.defaultTaskWikilinkSettings();
  const front = helpers.parseNoteTaskRows(
    "note.md",
    "---\n- [ ] #task Hidden in frontmatter ^front\n---\n- [ ] #task Real task ^real\n",
    settings,
  );
  assert.deepEqual(
    front.map((row) => row.searchText),
    ["Real task"],
  );
  const unclosedFront = helpers.parseNoteTaskRows(
    "note.md",
    "---\n- [ ] #task No closer means no frontmatter ^open\n",
    settings,
  );
  assert.deepEqual(
    unclosedFront.map((row) => row.searchText),
    ["No closer means no frontmatter"],
  );
  const fenced = helpers.parseNoteTaskRows(
    "note.md",
    "- [ ] #task Before ^before\n```\n- [ ] #task Fenced ^fenced\n```\n~~~\n- [ ] #task Tilde fence ^tilde\n~~~\n- [ ] #task After ^after\n",
    settings,
  );
  assert.deepEqual(
    fenced.map((row) => row.searchText),
    ["Before", "After"],
  );
  // A mismatched closer never closes: the backtick fence below swallows
  // the tilde run and everything after it, exactly like bob.
  const mismatched = helpers.parseNoteTaskRows(
    "note.md",
    "- [ ] #task Before ^before\n```\n- [ ] #task Fenced ^fenced\n~~~\n- [ ] #task After ^after\n",
    settings,
  );
  assert.deepEqual(
    mismatched.map((row) => row.searchText),
    ["Before"],
  );
  const unclosedFence = helpers.parseNoteTaskRows(
    "note.md",
    "- [ ] #task Before ^before\n```\n- [ ] #task Swallowed ^gone\n",
    settings,
  );
  assert.deepEqual(
    unclosedFence.map((row) => row.searchText),
    ["Before"],
  );
});

test("task grammar mirrors bob: dashes only, exact filter token", () => {
  const settings = helpers.defaultTaskWikilinkSettings();
  const rows = helpers.parseNoteTaskRows(
    "note.md",
    "> - [ ] #task Quoted ^a\n* - [ ] #task Star ^b\n1. - [ ] #task Numbered ^c\n- [x]No space ^d\n- [ ] Missing filter ^e\n- [ ] #task Real ^f\n",
    settings,
  );
  assert.deepEqual(
    rows.map((row) => row.searchText),
    ["Real"],
  );
});

test("trailing IDs need whitespace and clean bytes; every line counts", () => {
  const settings = helpers.defaultTaskWikilinkSettings();
  const rows = helpers.parseNoteTaskRows(
    "note.md",
    "- [ ] #task Glued^glued\n- [ ] #task Under barred ^under_bar\n- [ ] #task Clean ^clean\nplain ref ^clean\n",
    settings,
  );
  assert.equal(rows.length, 3);
  assert.equal(rows[0].blockId, null);
  assert.equal(rows[1].blockId, null);
  assert.equal(rows[2].blockId, "clean");
  assert.equal(rows[2].duplicateId, true);
});

test("hide and project-block tags are exact tokens", () => {
  const settings = helpers.defaultTaskWikilinkSettings();
  const rows = helpers.parseNoteTaskRows(
    "note.md",
    "- [ ] #task Tagged #hide ^a\n- [ ] #task Near miss #hidden ^b\n- [ ] #task Paren (#hide) ^c\n- [ ] #task Blocked #prj_is_blocked ^d\n",
    settings,
  );
  assert.deepEqual(
    rows.map((row) => [row.hidden, row.prjBlocked]),
    [
      [true, false],
      [false, false],
      [false, false],
      [false, true],
    ],
  );
});

test("search text drops filters, fields, and the block ID", () => {
  const settings = helpers.defaultTaskWikilinkSettings();
  const rows = helpers.parseNoteTaskRows(
    "note.md",
    "- [ ] #task #ref Read paper ^paper\n- [ ] #task #references Keep word ^keep\n- [ ] #ref #task Leading ref ^lead\n- [ ] #task Dated [scheduled:: 2026-09-30] work ^dated\n",
    settings,
  );
  assert.deepEqual(
    rows.map((row) => row.searchText),
    ["Read paper", "#references Keep word", "#ref Leading ref", "Dated work"],
  );
});

test("sections track headings and depth counts indentation", () => {
  const settings = helpers.defaultTaskWikilinkSettings();
  const rows = helpers.parseNoteTaskRows(
    "note.md",
    "## Work ##\n- [ ] #task Top ^top\n\t- [ ] #task Tabbed ^tab\n        - [ ] #task Deep ^deep\n### Sub\n- [ ] #task Under sub ^sub\n",
    settings,
  );
  assert.deepEqual(
    rows.map((row) => [row.section, row.depth]),
    [
      ["Work", 0],
      ["Work", 1],
      ["Work", 2],
      ["Sub", 0],
    ],
  );
  const literal = helpers.parseNoteTaskRows(
    "note.md",
    "## Keep##\n- [ ] #task Literal hashes ^a\n",
    settings,
  );
  assert.equal(literal[0].section, "Keep##");
});

test("note paths, locators, and archive targets", () => {
  assert.equal(helpers.isTaskWikilinkNotePath("note.md"), true);
  assert.equal(helpers.isTaskWikilinkNotePath("a/b.MD"), true);
  assert.equal(helpers.isTaskWikilinkNotePath(".root.md"), true);
  for (const excluded of [
    ".hidden/h.md",
    "_conflicts/c.md",
    "_generated/g.md",
    "_templates/t.md",
    ".bob/cache.md",
    ".obsidian/data.json",
    "note.txt",
    "noext",
  ]) {
    assert.equal(helpers.isTaskWikilinkNotePath(excluded), false, excluded);
  }
  const index = helpers.buildBasenameIndex(["dup.md", "a/dup.md", "note.md"]);
  assert.equal(index.locatorFor("dup.md"), "dup");
  assert.equal(index.linkTargetFor("dup.md"), "dup");
  assert.equal(index.locatorFor("a/dup.md"), "a/dup");
  assert.equal(index.linkTargetFor("a/dup.md"), "a/dup");
  assert.equal(index.locatorFor("note.md"), "note");
  const mixed = helpers.buildBasenameIndex(["Dup.md", "a/dup.md"]);
  assert.equal(mixed.locatorFor("Dup.md"), "Dup");
  assert.equal(mixed.locatorFor("a/dup.md"), "a/dup");
  // Archives keep the path in the link target only: the locator is
  // still the unique stem, exactly like bob.
  const archive = helpers.buildBasenameIndex(["done/old.md", "old.md"]);
  assert.equal(archive.locatorFor("done/old.md"), "done/old");
  assert.equal(archive.linkTargetFor("done/old.md"), "done/old");
  const archiveUnique = helpers.buildBasenameIndex(["done/old.md"]);
  assert.equal(archiveUnique.locatorFor("done/old.md"), "old");
  assert.equal(archiveUnique.linkTargetFor("done/old.md"), "done/old");
});

test("match tiers, AND terms, and empty queries", () => {
  const fields = (text) => [text];
  assert.equal(helpers.matchScoreWikilinkTasks(fields("Milk"), "milk"), 3);
  assert.equal(helpers.matchScoreWikilinkTasks(fields("Buy milk"), "milk"), 2);
  assert.equal(helpers.matchScoreWikilinkTasks(fields("Oatmilk"), "milk"), 1);
  assert.equal(helpers.matchScoreWikilinkTasks(fields("Badge"), "bdg"), 0);
  assert.equal(
    helpers.matchScoreWikilinkTasks(fields("Buy milk"), "buy bread"),
    null,
  );
  assert.equal(helpers.matchScoreWikilinkTasks(fields("Buy milk"), ""), 0);
  assert.equal(
    helpers.matchScoreWikilinkTasks(fields("Buy milk"), "buy milk"),
    5,
  );
});

test("previous daily is the latest daily before the anchor", () => {
  const paths = ["2026/20260928.md", "2026/20260929.md", "2026/20260930.md"];
  assert.equal(
    helpers.previousDailyNotePath(paths, new Date(2026, 8, 30, 9, 2)),
    "2026/20260929.md",
  );
  assert.equal(
    helpers.previousDailyNotePath(paths, new Date(2026, 8, 28, 9, 2)),
    null,
  );
  assert.equal(
    helpers.previousDailyNotePath(
      ["2026/20261345.md", "note.md", "2026/20260929.md"],
      new Date(2026, 8, 30),
    ),
    "2026/20260929.md",
  );
});

test("guards mirror bob, minus the read-only check", () => {
  const row = (overrides) => ({
    notePath: "note.md",
    blockId: "x",
    duplicateId: false,
    ...overrides,
  });
  assert.equal(
    helpers.disabledReasonFor(row({ duplicateId: true }), {}),
    "duplicate block ID ^x in note.md",
  );
  assert.equal(helpers.disabledReasonFor(row({}), {}), null);
  assert.equal(
    helpers.disabledReasonFor(row({ blockId: null }), {}),
    null,
  );
  assert.equal(
    helpers.disabledReasonFor(
      row({ notePath: "done/old.md", blockId: null }),
      {},
    ),
    "archived tasks can't get an id",
  );
  assert.equal(
    helpers.disabledReasonFor(
      row({ notePath: "2026/20260929.md", blockId: null }),
      { previousDailyPath: "2026/20260929.md" },
    ),
    "the previous daily note is read-only",
  );
  assert.equal(
    helpers.replacementForWikilinkTask(
      { blockId: "cafe", linkTarget: "cafe" },
      null,
    ),
    "[[cafe#^cafe]]",
  );
  assert.equal(
    helpers.replacementForWikilinkTask(
      { blockId: null, linkTarget: "note" },
      null,
    ),
    "",
  );
  assert.equal(
    helpers.replacementForWikilinkTask(
      { blockId: "x", linkTarget: "twin" },
      "duplicate block ID ^x in twin.md",
    ),
    "",
  );
});
