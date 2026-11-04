// Task-split gesture coverage: cursor, nested-line, drawer-entry, counted,
// clamp, visual selection, crossing-owners refusal, managed-line notice, and
// single-transaction undo. The command route (`splitBulletsIntoTasks`) is thin
// Obsidian wiring over `describeTaskSplitGesture` + `planSplitBullets`, which
// is what this file pins.
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  helpers,
  NavigationHotkeysPlugin,
  TransactionEditor,
} = require("./navigation-hotkeys-harness.cjs");
const { pressKey } = require("./modal-harness.cjs");

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

test("task lines open an unmarked picker over all splittable notes", () => {
  const content = [
    "- [ ] #task Upgrade Postgres to 17 ^upgrade",
    "  - Ping Alice",
    "  - FUTURE WORK",
    "    - Try logical replication",
    "",
  ].join("\n");
  const described = helpers.describeTaskSplitGesture(content, {
    cursorLine: 0,
    countExplicit: true,
    additionalCount: 2,
  });
  assert.deepEqual(described.picker, { scope: "task" });
  const listed = helpers.listTaskSplitCandidates({ "db.md": content }, {
    ownerPath: "db.md",
    ownerLine: 1,
  });
  const rows = helpers.buildTaskSplitPickerRows(listed.candidates);
  assert.deepEqual(rows.map((row) => row.label), ["Ping Alice", "Try logical replication"]);
  assert.deepEqual(rows.map((row) => row.ordinal), [1, 2]);
});

test("drawer titles open a picker scoped to that drawer", () => {
  const content = [
    "- [ ] #task Upgrade Postgres to 17 ^upgrade",
    "  - Ping Alice",
    "  - FUTURE WORK",
    "    - Try logical replication",
    "    - Upgrade test fixture",
    "",
  ].join("\n");
  const described = helpers.describeTaskSplitGesture(content, { cursorLine: 2 });
  assert.deepEqual(described.picker, { scope: "drawer", title: "FUTURE WORK" });
  const listed = helpers.listTaskSplitCandidates({ "db.md": content }, {
    ownerPath: "db.md",
    ownerLine: 1,
  });
  const rows = helpers.buildTaskSplitPickerRows(listed.candidates, {
    drawerTitle: described.picker.title,
  });
  assert.deepEqual(rows.map((row) => row.label), [
    "Try logical replication",
    "Upgrade test fixture",
  ]);
});

test("section bullets promote into the same note's Tasks intake", () => {
  const content = [
    "## Future Work",
    "- Try logical replication",
    "",
  ].join("\n");
  const described = helpers.describeTaskSplitGesture(content, { cursorLine: 1 });
  assert.equal(described.ownerKind, "section");
  assert.deepEqual(described.selection, { kind: "cursor", line: 2 });
  const plan = helpers.planSplitBullets({ "dev.md": content }, {
    ownerPath: "dev.md",
    ownerLine: described.ownerLine + 1,
    selection: described.selection,
    today: "2026-11-03",
    settings: SETTINGS,
  });
  assert.equal(plan.ok, true, plan.message);
  assert.equal(plan.placement.kind, "tasks_section");
  assert.match(plan.files["dev.md"], /## Tasks\n- \[ \] #task Try logical replication/);
  assert.match(plan.files["dev.md"], /- \[\[#\^try-logical\|Try logical replication\]\]/);
});

test("Tab marks candidates and Enter splits marks or the highlighted row", () => {
  const rows = [
    { key: "2", ordinal: 1, line: 2, label: "Alpha", selectable: true },
    { key: "3", ordinal: 2, line: 3, label: "Beta", selectable: true },
  ];
  let picked = undefined;
  const modal = new helpers.TaskSplitPickerModal({}, {
    rows,
    onSettle: (result) => { picked = result; },
  });
  modal.open();
  pressKey(modal, "Tab");
  pressKey(modal, "Tab");
  pressKey(modal, "Enter");
  assert.deepEqual(picked, { kind: "nth", picks: [1, 2] });

  picked = undefined;
  const highlighted = new helpers.TaskSplitPickerModal({}, {
    rows,
    onSettle: (result) => { picked = result; },
  });
  highlighted.open();
  pressKey(highlighted, "ArrowDown");
  pressKey(highlighted, "Enter");
  assert.deepEqual(picked, { kind: "nth", picks: [2] });
});

test("guarded Undo restores all postimages or refuses before writing", async () => {
  const files = new Map([
    ["daily/2026-11-03.md", { path: "daily/2026-11-03.md", content: "source-after" }],
    ["work.md", { path: "work.md", content: "destination-after" }],
  ]);
  const vault = {
    getAbstractFileByPath: (path) => files.get(path) || null,
    cachedRead: async (file) => file.content,
    process: async (file, transform) => { file.content = transform(file.content); },
    delete: async (file) => { files.delete(file.path); },
    create: async (path, content) => {
      const file = { path, content };
      files.set(path, file);
      return file;
    },
  };
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = { vault };
  plugin.getOpenMarkdownEditorForPath = () => null;
  const restores = [
    { path: "work.md", file: files.get("work.md"), before: "", after: "destination-after", created: true },
    { path: "daily/2026-11-03.md", file: files.get("daily/2026-11-03.md"), before: "source-before", after: "source-after" },
  ];
  files.get("daily/2026-11-03.md").content = "human edit";
  const refused = await plugin.restoreGuardedUndoChanges(restores, {
    failureLabel: "Could not undo split",
  });
  assert.equal(refused, false);
  assert.equal(files.get("work.md").content, "destination-after");

  files.get("daily/2026-11-03.md").content = "source-after";
  const undone = await plugin.restoreGuardedUndoChanges(restores, {
    successMessage: "Undid split",
    failureLabel: "Could not undo split",
  });
  assert.equal(undone, true);
  assert.equal(files.get("daily/2026-11-03.md").content, "source-before");
  assert.equal(files.has("work.md"), false);
});

function crossNoteSplitFixture() {
  const sourcePath = "2026/20261103.md";
  const destinationPath = "projects/launch.md";
  const sourceContent = [
    "- [ ] #task Deploy the release [created:: 2026-11-03] ^deploy [root:: projects/launch]",
    "  - Confirm backups are current",
    "",
  ].join("\n");
  const destinationContent = [
    "# Launch",
    "",
    "## Tasks",
    "- [ ] #task Existing work [created:: 2026-10-20] ^existing",
    "",
  ].join("\n");
  const plannedFiles = {
    [sourcePath]: sourceContent,
    [destinationPath]: destinationContent,
  };
  const plan = helpers.planSplitBullets(plannedFiles, {
    ownerPath: sourcePath,
    ownerLine: 1,
    selection: { kind: "cursor", line: 2 },
    today: "2026-11-03",
    settings: SETTINGS,
  });
  assert.equal(plan.ok, true, plan.message);
  const sourceFile = { path: sourcePath, content: sourceContent };
  const destinationFile = { path: destinationPath, content: destinationContent };
  const files = new Map([
    [sourcePath, sourceFile],
    [destinationPath, destinationFile],
  ]);
  const vault = {
    getAbstractFileByPath: (path) => files.get(path) || null,
    cachedRead: async (file) => file.content,
    process: async (file, transform) => {
      file.content = transform(file.content);
    },
    create: async (path, content) => {
      const file = { path, content };
      files.set(path, file);
      return file;
    },
    delete: async (file) => { files.delete(file.path); },
  };
  const editor = new TransactionEditor(sourceContent, { line: 1, ch: 2 });
  const sourceView = { file: sourceFile, editor };
  const destinationEditor = {
    cursor: null,
    setCursor(line, ch) { this.cursor = { line, ch }; },
  };
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = { vault };
  plugin.isMarkdownFile = (file) => Boolean(file && file.path.endsWith(".md"));
  plugin.getOpenMarkdownEditorForPath = (path) =>
    path === sourcePath ? editor : null;
  plugin.ensureVimJumpHistory = () => {};
  plugin.vimJumpHistory = helpers.createVimJumpHistory();
  let activeView = sourceView;
  plugin.getActiveMarkdownView = () => activeView;
  plugin.openMarkdownFileWithLeafReuse = async (file) => {
    activeView = { file, editor: destinationEditor };
    return true;
  };
  let undoNotice = null;
  plugin.showGuardedUndoNotice = (...args) => { undoNotice = args; };
  return {
    sourcePath,
    destinationPath,
    sourceContent,
    destinationContent,
    plannedFiles,
    plan,
    sourceFile,
    destinationFile,
    editor,
    destinationEditor,
    plugin,
    undoNotice: () => undoNotice,
  };
}

test("daily-note split writes destination first, guards both notes, and lands on the new task", async () => {
  const fixture = crossNoteSplitFixture();
  const result = await fixture.plugin.applyTaskSplitCrossNote(
    fixture.editor,
    fixture.sourceFile,
    fixture.sourceContent,
    { line: 1, ch: 2 },
    fixture.plan,
    fixture.plannedFiles,
  );
  assert.equal(result, true);
  assert.equal(
    fixture.destinationFile.content,
    fixture.plan.files[fixture.destinationPath],
  );
  assert.equal(
    fixture.editor.content,
    fixture.plan.files[fixture.sourcePath],
  );
  assert.deepEqual(fixture.destinationEditor.cursor, {
    line: fixture.plan.cursor.line - 1,
    ch: 0,
  });
  assert.equal(fixture.undoNotice()[2].actionLabel, "Undo split");
});

test("daily-note split rolls back the destination when the source went stale", async () => {
  const fixture = crossNoteSplitFixture();
  fixture.editor.content = "a human edit landed while planning";
  const result = await fixture.plugin.applyTaskSplitCrossNote(
    fixture.editor,
    fixture.sourceFile,
    fixture.sourceContent,
    { line: 1, ch: 2 },
    fixture.plan,
    fixture.plannedFiles,
  );
  assert.equal(result, false);
  assert.equal(fixture.destinationFile.content, fixture.destinationContent);
  assert.equal(fixture.editor.content, "a human edit landed while planning");
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
