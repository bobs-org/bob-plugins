// `api.taskSplit` v1: `carryReq` plans one requirement carry, persists
// every postimage destination-first, and refuses stale/missing targets.
// The pure planner (`taskSplitPlanCarryReq`), the SHA-256 twin, and the
// guarded persistence are pinned here; the command route owns its own
// notice/navigation tests through `splitRequirementCarry` below.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const {
  helpers,
  NavigationHotkeysPlugin,
  TransactionEditor,
  notices,
} = require("./navigation-hotkeys-harness.cjs");

const SETTINGS = {
  linked_from_mentions: true,
  linked_from_lines: true,
  inbox_route: "inbox.md",
};
const TODAY = "2026-11-03";

function rustTrimEnd(line) {
  return String(line || "").replace(
    /[\t\n\v\f\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+$/,
    "",
  );
}

function digest(line) {
  return crypto
    .createHash("sha256")
    .update(rustTrimEnd(line), "utf8")
    .digest("hex")
    .slice(0, 8);
}

const SOURCE = [
  "- [ ] #task Ship the exporter [created:: 2026-10-20] ^export",
  "  - [ ] Handles supported inputs",
  "    - Fixture: inputs.zip",
  "  - [ ] Docs cover every flag",
  "",
].join("\n");

function fakeVault(files, hooks = {}) {
  return {
    getAbstractFileByPath: (filePath) => files.get(filePath) || null,
    cachedRead: async (file) => file.content,
    process: async (file, transform) => {
      if (hooks.failPaths && hooks.failPaths.has(file.path)) {
        throw new Error(`injected write failure: ${file.path}`);
      }
      file.content = transform(file.content);
    },
    create: async (filePath, content) => {
      if (hooks.failCreate && hooks.failCreate.has(filePath)) {
        throw new Error(`injected create failure: ${filePath}`);
      }
      const file = { path: filePath, content };
      files.set(filePath, file);
      return file;
    },
    delete: async (file) => {
      files.delete(file.path);
    },
  };
}

function carryPlugin(entries, hooks = {}) {
  const files = new Map(
    Object.entries(entries).map(([filePath, content]) => [
      filePath,
      { path: filePath, content },
    ]),
  );
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = { vault: fakeVault(files, hooks) };
  plugin.isMarkdownFile = (file) =>
    Boolean(file && typeof file.path === "string" && file.path.endsWith(".md"));
  const editors = new Map();
  plugin.getOpenMarkdownEditorForPath = (filePath) =>
    editors.get(filePath) || null;
  plugin.ensureVimJumpHistory = () => {};
  plugin.vimJumpHistory = helpers.createVimJumpHistory();
  let activeView = null;
  plugin.getActiveMarkdownView = () => activeView;
  plugin.setActiveView = (view) => {
    activeView = view;
  };
  plugin.openMarkdownFileWithLeafReuse = async (file) => {
    if (hooks.failOpen) {
      return false;
    }
    activeView = { file, editor: hooks.destinationEditor || null };
    return true;
  };
  const undoNotices = [];
  plugin.showGuardedUndoNotice = (...args) => {
    undoNotices.push(args);
  };
  return { plugin, files, editors, undoNotices };
}

function openSource(harness, filePath, content, cursor) {
  const editor = new TransactionEditor(content, cursor);
  harness.editors.set(filePath, editor);
  harness.plugin.setActiveView({
    file: harness.files.get(filePath),
    editor,
  });
  return editor;
}

test("the SHA-256 twin matches node crypto, including unicode", () => {
  const cases = [
    "",
    "hello",
    "  - [ ] Handles supported inputs  ",
    "- [>] [[#^export-docs|Docs cover every flag]]",
    "🪢 **LINKED FROM:** [[#^export]] (💬 mentions)",
    "— restore it first",
    "◯ title",
    "café \u0085",
    "x".repeat(200),
    "Fixture: windows.csv   \t",
  ];
  for (const entry of cases) {
    assert.equal(
      helpers.taskSplitSha256Hex(entry),
      crypto.createHash("sha256").update(entry, "utf8").digest("hex"),
      JSON.stringify(entry),
    );
    assert.equal(helpers.taskSplitLineDigest(entry), digest(entry));
  }
});

test("taskSplitPlanCarryReq carries a same-note requirement", () => {
  const planned = helpers.taskSplitPlanCarryReq(
    { "db.md": SOURCE },
    { notePath: "db.md", line: 2, today: TODAY, settings: SETTINGS },
  );
  assert.equal(planned.ok, true, planned.message);
  assert.deepEqual(planned.task, {
    path: "db.md",
    line: 4,
    blockId: "handles-supported",
    text: "Handles supported inputs",
  });
  assert.deepEqual(planned.moveMap, {
    sourcePath: "db.md",
    destinationPath: "db.md",
    moves: [{ from: 3, to: 6 }],
  });
  assert.equal(
    planned.plan.files["db.md"],
    "- [ ] #task Ship the exporter [created:: 2026-10-20] ^export\n" +
      "  - [>] [[#^handles-supported|Handles supported inputs]]\n" +
      "  - [ ] Docs cover every flag\n" +
      "- [ ] #task Handles supported inputs [created:: 2026-11-03] ^handles-supported\n" +
      "  - 🪢 **LINKED FROM:** [[#^export]] (💬 mentions)\n" +
      "  - Fixture: inputs.zip\n",
  );
  assert.equal(planned.plan.notice.includes("1 requirement"), true);
});

test("taskSplitPlanCarryReq refuses a stale expectedLine", () => {
  const lines = SOURCE.split("\n");
  const stale = helpers.taskSplitPlanCarryReq(
    { "db.md": SOURCE },
    { notePath: "db.md", line: 2, expectedLine: "deadbeef", today: TODAY, settings: SETTINGS },
  );
  assert.equal(stale.ok, false);
  assert.equal(stale.code, "split_stale_ref");
  const fresh = helpers.taskSplitPlanCarryReq(
    { "db.md": SOURCE },
    { notePath: "db.md", line: 2, expectedLine: digest(lines[1]), today: TODAY, settings: SETTINGS },
  );
  assert.equal(fresh.ok, true, fresh.message);
});

test("taskSplitPlanCarryReq refuses lines that are not requirements", () => {
  const taskLine = helpers.taskSplitPlanCarryReq(
    { "db.md": SOURCE },
    { notePath: "db.md", line: 1, today: TODAY, settings: SETTINGS },
  );
  assert.equal(taskLine.ok, false);
  assert.equal(taskLine.code, "not_a_req");
  assert.equal(taskLine.message, "This line is not a requirement");
  const noteLine = helpers.taskSplitPlanCarryReq(
    { "db.md": SOURCE },
    { notePath: "db.md", line: 3, today: TODAY, settings: SETTINGS },
  );
  assert.equal(noteLine.ok, false);
  assert.equal(noteLine.code, "not_a_req");
  const beyond = helpers.taskSplitPlanCarryReq(
    { "db.md": SOURCE },
    { notePath: "db.md", line: 99, today: TODAY, settings: SETTINGS },
  );
  assert.equal(beyond.ok, false);
  assert.equal(beyond.code, "split_stale_ref");
  const missing = helpers.taskSplitPlanCarryReq(
    { "db.md": SOURCE },
    { notePath: "gone.md", line: 1, today: TODAY, settings: SETTINGS },
  );
  assert.equal(missing.ok, false);
  assert.equal(missing.code, "split_owner_missing");
});

test("taskSplitPlanCarryReq refuses dropped, carried, and excluded rows", () => {
  const dropped = [
    "- [ ] #task Ship the exporter [created:: 2026-10-20] ^export",
    "  - [-] Benchmarks within 5% of v1",
    "    - ❌ **CANCEL LOG**",
    "      - *2026-11-01* — v1 is gone",
    "",
  ].join("\n");
  const refusedDrop = helpers.taskSplitPlanCarryReq(
    { "db.md": dropped },
    { notePath: "db.md", line: 2, today: TODAY, settings: SETTINGS },
  );
  assert.equal(refusedDrop.ok, false);
  assert.equal(refusedDrop.code, "split_not_splittable");
  assert.equal(refusedDrop.message, "Dropped — restore it first");
  const carried = [
    "- [ ] #task Ship the exporter [created:: 2026-10-20] ^export",
    "  - [>] [[#^export-docs|Docs cover every flag]]",
    "- [ ] #task Docs cover every flag [created:: 2026-11-01] ^export-docs",
    "",
  ].join("\n");
  const refusedCarry = helpers.taskSplitPlanCarryReq(
    { "db.md": carried },
    { notePath: "db.md", line: 2, today: TODAY, settings: SETTINGS },
  );
  assert.equal(refusedCarry.ok, false);
  assert.equal(refusedCarry.code, "split_not_splittable");
  assert.equal(refusedCarry.message, "Carried — open the linked task");
  const excluded = [
    "- [ ] #task Ship the exporter [created:: 2026-10-20] ^export",
    "  - [-] Handles supported inputs",
    "    - [ ] Handles Windows files",
    "",
  ].join("\n");
  const refusedExcluded = helpers.taskSplitPlanCarryReq(
    { "db.md": excluded },
    { notePath: "db.md", line: 3, today: TODAY, settings: SETTINGS },
  );
  assert.equal(refusedExcluded.ok, false);
  assert.equal(refusedExcluded.code, "split_req_excluded");
});

test("taskSplitPlanCarryReq guards the owner preimage", () => {
  const lines = SOURCE.split("\n");
  const ownerBlock = `${lines[0]}\n${lines[1]}\n${lines[2]}\n${lines[3]}\n`;
  const guarded = helpers.taskSplitPlanCarryReq(
    { "db.md": SOURCE },
    {
      notePath: "db.md",
      line: 2,
      expectedOwnerPreimage: ownerBlock,
      today: TODAY,
      settings: SETTINGS,
    },
  );
  assert.equal(guarded.ok, true, guarded.message);
  const drifted = helpers.taskSplitPlanCarryReq(
    { "db.md": SOURCE },
    {
      notePath: "db.md",
      line: 2,
      expectedOwnerPreimage: `${ownerBlock}  - human edit\n`,
      today: TODAY,
      settings: SETTINGS,
    },
  );
  assert.equal(drifted.ok, false);
  assert.equal(drifted.code, "split_stale_ref");
});

test("taskSplitPlanCarryReq carries a daily-note requirement into its root note", () => {
  const source = [
    "- [ ] #task Deploy the release [created:: 2026-11-03] ^deploy [root:: projects/launch]",
    "  - [ ] Backups are current",
    "    - [ ] Restore drill passes",
    "    - Check the S3 bucket",
    "",
  ].join("\n");
  const destination = [
    "# Launch",
    "",
    "## Tasks",
    "- [ ] #task Existing work [created:: 2026-10-20] ^existing",
    "",
  ].join("\n");
  const planned = helpers.taskSplitPlanCarryReq(
    { "2026/20261103.md": source, "projects/launch.md": destination },
    {
      notePath: "2026/20261103.md",
      line: 2,
      today: TODAY,
      settings: SETTINGS,
    },
  );
  assert.equal(planned.ok, true, planned.message);
  assert.equal(planned.task.path, "projects/launch.md");
  assert.equal(planned.moveMap.destinationPath, "projects/launch.md");
  assert.equal(planned.moveMap.sourcePath, "2026/20261103.md");
  assert.ok(
    planned.plan.files["projects/launch.md"].includes(
      "- [ ] #task Backups are current [created:: 2026-11-03] ^backups-are-current",
    ),
  );
  assert.ok(
    planned.plan.files["2026/20261103.md"].includes(
      "- [>] [[projects/launch#^backups-are-current|Backups are current]]",
    ),
  );
});

test("reqkey selection carries through planSplitBullets", () => {
  const key = `owner${helpers.taskSplitReqRowSuffix([2], "Docs cover every flag")}`;
  const plan = helpers.planSplitBullets(
    { "db.md": SOURCE },
    {
      ownerPath: "db.md",
      ownerLine: 1,
      selection: { kind: "reqkey", key },
      today: TODAY,
      settings: SETTINGS,
    },
    {},
  );
  assert.equal(plan.ok, true, plan.message);
  assert.equal(plan.tasks.length, 1);
  assert.equal(plan.tasks[0].block_id, "docs-cover-every");
  assert.equal(plan.tasks[0].req_depth, 1);
  const stale = helpers.planSplitBullets(
    { "db.md": SOURCE },
    {
      ownerPath: "db.md",
      ownerLine: 1,
      selection: { kind: "reqkey", key: "owner/req/9.9~deadbeef" },
      today: TODAY,
      settings: SETTINGS,
    },
    {},
  );
  assert.equal(stale.ok, false);
  assert.equal(stale.code, "split_stale_ref");
});

test("createTaskSplitApi answers unavailable without a plugin", async () => {
  const api = helpers.createTaskSplitApi(null);
  assert.equal(api.version, 1);
  const result = await api.carryReq({ notePath: "db.md", line: 2 });
  assert.equal(result.ok, false);
  assert.equal(result.code, "split_unavailable");
});

test("taskSplitCarryReq persists a same-note carry and returns restores", async () => {
  const harness = carryPlugin({ "db.md": SOURCE });
  const editor = openSource(harness, "db.md", SOURCE, { line: 1, ch: 2 });
  const lines = SOURCE.split("\n");
  const result = await harness.plugin.taskSplitCarryReq({
    notePath: "db.md",
    line: 2,
    expectedLine: digest(lines[1]),
  });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.task.path, "db.md");
  assert.equal(result.task.blockId, "handles-supported");
  assert.equal(result.task.text, "Handles supported inputs");
  assert.equal(result.cursor.path, "db.md");
  assert.equal(result.cursor.line, result.task.line);
  assert.deepEqual(result.moveMap.moves, [{ from: 3, to: 6 }]);
  assert.equal(result.restores.length, 1);
  assert.deepEqual(result.restores[0], {
    path: "db.md",
    before: SOURCE,
    after: editor.content,
    created: false,
  });
  assert.ok(editor.content.includes("- [>] [[#^handles-supported|"));
});

test("taskSplitCarryReq persists a daily-note carry destination-first", async () => {
  const source = [
    "- [ ] #task Deploy the release [created:: 2026-11-03] ^deploy [root:: projects/launch]",
    "  - [ ] Backups are current",
    "    - Check the S3 bucket",
    "",
  ].join("\n");
  const destination = [
    "# Launch",
    "",
    "## Tasks",
    "- [ ] #task Existing work [created:: 2026-10-20] ^existing",
    "",
  ].join("\n");
  const harness = carryPlugin({
    "2026/20261103.md": source,
    "projects/launch.md": destination,
  });
  openSource(harness, "2026/20261103.md", source, { line: 1, ch: 2 });
  const lines = source.split("\n");
  const result = await harness.plugin.taskSplitCarryReq({
    notePath: "2026/20261103.md",
    line: 2,
    expectedLine: digest(lines[1]),
  });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.task.path, "projects/launch.md");
  assert.equal(result.restores.length, 2);
  assert.deepEqual(
    result.restores.map((restore) => restore.path).sort(),
    ["2026/20261103.md", "projects/launch.md"],
  );
  const created = result.restores.find(
    (restore) => restore.path === "projects/launch.md",
  );
  assert.equal(created.before, destination);
  assert.equal(created.created, false);
  assert.ok(
    harness.files.get("projects/launch.md").content.includes("^backups-are-current"),
  );
});

test("taskSplitCarryReq refuses a stale line without writing", async () => {
  const harness = carryPlugin({ "db.md": SOURCE });
  openSource(harness, "db.md", SOURCE, { line: 1, ch: 2 });
  const result = await harness.plugin.taskSplitCarryReq({
    notePath: "db.md",
    line: 2,
    expectedLine: "deadbeef",
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "split_stale_ref");
  assert.equal(harness.editors.get("db.md").content, SOURCE);
});

test("persistTaskSplitPostimages rolls back the destination when the source fails", async () => {
  const source = [
    "- [ ] #task Deploy the release [created:: 2026-11-03] ^deploy [root:: projects/launch]",
    "  - [ ] Backups are current",
    "",
  ].join("\n");
  const destination = [
    "# Launch",
    "",
    "## Tasks",
    "- [ ] #task Existing work [created:: 2026-10-20] ^existing",
    "",
  ].join("\n");
  const files = {
    "2026/20261103.md": source,
    "projects/launch.md": destination,
  };
  const plan = helpers.planSplitBullets(files, {
    ownerPath: "2026/20261103.md",
    ownerLine: 1,
    selection: { kind: "cursor", line: 2 },
    today: TODAY,
    settings: SETTINGS,
  });
  assert.equal(plan.ok, true, plan.message);
  const harness = carryPlugin(files, {
    failPaths: new Set(["2026/20261103.md"]),
  });
  const persisted = await harness.plugin.persistTaskSplitPostimages(plan, {
    sourcePath: "2026/20261103.md",
    sourceEditor: null,
    before: files,
  });
  assert.equal(persisted.ok, false);
  assert.equal(persisted.code, "split_write_failed");
  assert.equal(
    harness.files.get("projects/launch.md").content,
    destination,
  );
  assert.equal(harness.files.get("2026/20261103.md").content, source);
});

test("persistTaskSplitPostimages removes a created destination when the source fails", async () => {
  const source = [
    "- [ ] #task Deploy the release [created:: 2026-11-03] ^deploy [root:: projects/launch]",
    "  - [ ] Backups are current",
    "",
  ].join("\n");
  const files = { "2026/20261103.md": source };
  const plan = helpers.planSplitBullets(files, {
    ownerPath: "2026/20261103.md",
    ownerLine: 1,
    selection: { kind: "cursor", line: 2 },
    today: TODAY,
    settings: SETTINGS,
  });
  assert.equal(plan.ok, true, plan.message);
  assert.ok(plan.files["projects/launch.md"].includes("^backups-are-current"));
  const harness = carryPlugin(files, {
    failPaths: new Set(["2026/20261103.md"]),
  });
  const persisted = await harness.plugin.persistTaskSplitPostimages(plan, {
    sourcePath: "2026/20261103.md",
    sourceEditor: null,
    before: files,
  });
  assert.equal(persisted.ok, false);
  assert.equal(persisted.code, "split_write_failed");
  assert.equal(harness.files.has("projects/launch.md"), false);
  assert.equal(harness.files.get("2026/20261103.md").content, source);
});

test("splitRequirementCarry lands on the new task with one jump", async () => {
  const harness = carryPlugin({ "db.md": SOURCE });
  const editor = openSource(harness, "db.md", SOURCE, { line: 1, ch: 2 });
  const before = notices.length;
  const result = await harness.plugin.splitRequirementCarry(
    editor,
    { path: "db.md" },
    SOURCE,
    { line: 1, ch: 2 },
  );
  assert.equal(result, true);
  assert.ok(editor.content.includes("- [>] [[#^handles-supported|"));
  assert.deepEqual(editor.cursor, { line: 3, ch: 0 });
  assert.equal(harness.plugin.vimJumpHistory.entries.length, 2);
  assert.deepEqual(harness.plugin.vimJumpHistory.entries[1], {
    path: "db.md",
    line: 3,
    ch: 0,
  });
  assert.match(notices[notices.length - 1], /Split 1 requirement/);
  assert.ok(notices.length > before);
});

test("splitRequirementCarry opens a cross-note carry with one guarded Undo", async () => {
  const source = [
    "- [ ] #task Deploy the release [created:: 2026-11-03] ^deploy [root:: projects/launch]",
    "  - [ ] Backups are current",
    "",
  ].join("\n");
  const destination = [
    "# Launch",
    "",
    "## Tasks",
    "- [ ] #task Existing work [created:: 2026-10-20] ^existing",
    "",
  ].join("\n");
  const harness = carryPlugin({
    "2026/20261103.md": source,
    "projects/launch.md": destination,
  });
  const editor = openSource(harness, "2026/20261103.md", source, { line: 1, ch: 2 });
  const destinationEditor = {
    cursor: null,
    setCursor(line, ch) {
      this.cursor = { line, ch };
    },
  };
  harness.plugin.openMarkdownFileWithLeafReuse = async (file) => {
    harness.plugin.setActiveView({ file, editor: destinationEditor });
    return true;
  };
  harness.plugin.getActiveMarkdownView = () => ({
    file: harness.files.get("projects/launch.md"),
    editor: destinationEditor,
  });
  const result = await harness.plugin.splitRequirementCarry(
    editor,
    { path: "2026/20261103.md" },
    source,
    { line: 1, ch: 2 },
  );
  assert.equal(result, true);
  assert.equal(harness.undoNotices.length, 1);
  assert.equal(harness.undoNotices[0][2].actionLabel, "Undo split");
  assert.equal(harness.undoNotices[0][1].length, 2);
  assert.deepEqual(destinationEditor.cursor, { line: 4, ch: 0 });
  assert.equal(harness.plugin.vimJumpHistory.entries.length, 2);
  assert.deepEqual(harness.plugin.vimJumpHistory.entries[1], {
    path: "projects/launch.md",
    line: 4,
    ch: 0,
  });
});
