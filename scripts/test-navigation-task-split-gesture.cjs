// Task-split gesture coverage: cursor, nested-line, drawer-entry, counted,
// clamp, visual selection, crossing-owners refusal, managed-line notice, and
// single-transaction undo. The command route (`splitBulletsIntoTasks`) is thin
// Obsidian wiring over `describeTaskSplitGesture` + `planSplitBullets`, which
// is what this file pins.
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  helpers,
  TransactionEditor,
} = require("./navigation-hotkeys-harness.cjs");

const SOURCE = [
  "- [ ] #task Upgrade Postgres to 17 [created:: 2026-10-20] ^upgrade",
  "  - Ping Alice about the cutover window",
  "  - Write the rollback runbook",
  "    - include pg_dump timing",
  "",
].join("\n");

const SETTINGS = {
  linked_from_mentions: true,
  linked_from_lines: true,
  inbox_route: "inbox.md",
};

function planFor(content, gesture) {
  const described = helpers.describeTaskSplitGesture(content, gesture);
  assert.equal(described.refuse, undefined, described.message);
  const plan = helpers.planSplitBullets(
    { "db.md": content },
    {
      ownerPath: "db.md",
      ownerLine: described.ownerLine + 1,
      selection: described.selection,
      today: "2026-11-03",
      settings: SETTINGS,
    },
  );
  assert.equal(plan.ok, true, plan.message);
  return { described, plan };
}

test("cursor on a note splits that bullet", () => {
  const { described, plan } = planFor(SOURCE, { cursorLine: 1 });
  assert.deepEqual(described.selection, { kind: "cursor", line: 2 });
  assert.equal(plan.tasks.length, 1);
  assert.equal(plan.tasks[0].block_id, "ping-alice-about");
  assert.equal(plan.cursor.line, 5);
});

test("cursor on a nested line splits its first-level note", () => {
  const { plan } = planFor(SOURCE, { cursorLine: 3 });
  assert.equal(plan.tasks.length, 1);
  assert.equal(plan.tasks[0].title, "Write the rollback runbook");
  assert.equal(plan.tasks[0].child_lines, 1);
});

test("cursor on a drawer entry stays inside its drawer", () => {
  const content = [
    "- [ ] #task Upgrade Postgres to 17 [created:: 2026-10-20] ^upgrade",
    "  - FUTURE WORK",
    "    - Try logical replication",
    "",
  ].join("\n");
  const { plan } = planFor(content, { cursorLine: 2 });
  assert.equal(plan.tasks.length, 1);
  assert.equal(plan.tasks[0].block_id, "try-logical");
  assert.match(plan.files["db.md"], /- \[\[#\^try-logical\|Try logical replication\]\]/);
});

test("counted split takes the bullet plus the next siblings", () => {
  const { described, plan } = planFor(SOURCE, {
    cursorLine: 1,
    countExplicit: true,
    additionalCount: 1,
  });
  assert.deepEqual(described.selection, {
    kind: "count",
    line: 2,
    count: 2,
  });
  assert.equal(plan.tasks.length, 2);
});

test("a clamped count splits what exists and says so", () => {
  const { plan } = planFor(SOURCE, {
    cursorLine: 1,
    countExplicit: true,
    additionalCount: 9,
  });
  assert.equal(plan.tasks.length, 2);
  assert.deepEqual(plan.clamped, { requested: 10, split: 2 });
  const notice = helpers.formatTaskSplitGestureNotice(plan);
  assert.match(notice, /clamped to 2 of 10/);
});

test("a visual selection splits every touched head line", () => {
  const { described, plan } = planFor(SOURCE, {
    cursorLine: 1,
    anchorLine: 1,
    headLine: 2,
  });
  assert.equal(described.selection.kind, "nth");
  assert.equal(plan.tasks.length, 2);
  assert.deepEqual(
    plan.tasks.map((task) => task.title),
    ["Ping Alice about the cutover window", "Write the rollback runbook"],
  );
});

test("a selection crossing owners is refused", () => {
  const content = [
    "- [ ] #task First ^first",
    "  - Alpha note",
    "- [ ] #task Second ^second",
    "  - Beta note",
    "",
  ].join("\n");
  const described = helpers.describeTaskSplitGesture(content, {
    cursorLine: 1,
    anchorLine: 1,
    headLine: 3,
  });
  assert.equal(described.refuse, "split_crosses_owners");
});

test("a managed line explains why nothing is written", () => {
  const content = [
    "- [ ] #task Upgrade Postgres to 17 [created:: 2026-10-20] ^upgrade",
    "  - ⛓️ **DEPENDS ON:** [[db#^other]]",
    "  - Ping Alice about the cutover window",
    "",
  ].join("\n");
  const described = helpers.describeTaskSplitGesture(content, {
    cursorLine: 1,
  });
  assert.equal(described.refuse, undefined);
  const plan = helpers.planSplitBullets(
    { "db.md": content },
    {
      ownerPath: "db.md",
      ownerLine: described.ownerLine + 1,
      selection: described.selection,
      today: "2026-11-03",
      settings: SETTINGS,
    },
  );
  assert.equal(plan.ok, false);
  assert.equal(plan.code, "split_managed_line");
});

test("a task line gets the already-a-task teaching notice", () => {
  const described = helpers.describeTaskSplitGesture(SOURCE, {
    cursorLine: 0,
  });
  assert.equal(described.refuse, undefined);
  const plan = helpers.planSplitBullets(
    { "db.md": SOURCE },
    {
      ownerPath: "db.md",
      ownerLine: described.ownerLine + 1,
      selection: described.selection,
      today: "2026-11-03",
      settings: SETTINGS,
    },
  );
  assert.equal(plan.ok, false);
  assert.equal(plan.code, "split_already_task");
});

test("a same-note split applies in one undoable transaction", () => {
  const { plan } = planFor(SOURCE, { cursorLine: 1 });
  const editor = new TransactionEditor(SOURCE, { line: 1, ch: 2 });
  const applied = helpers.applyEditorContentTransaction(
    editor,
    SOURCE,
    plan.files["db.md"],
    { line: plan.cursor.line - 1, ch: 0 },
  );
  assert.equal(applied, true);
  assert.equal(editor.content, plan.files["db.md"]);
  assert.equal(editor.undoGroups, 1);
  assert.deepEqual(editor.cursor, {
    line: plan.cursor.line - 1,
    ch: 0,
  });
});
