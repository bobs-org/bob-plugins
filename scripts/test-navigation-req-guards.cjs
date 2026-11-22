// Requirement-line guards for nav task gestures (bob-cli-on.10.1.5):
// Alt+N / Alt+F / Ctrl+Alt+F / counted forms / Alt+P / Ctrl+Shift+M refuse
// with the contract copy and write nothing; Ctrl+Shift+P and the Task Card
// stage chords open the owner's card.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  notices,
  NavigationHotkeysPlugin,
  helpers,
  TransactionEditor,
  createBulletPropertyPickerHarness,
} = require("./navigation-hotkeys-harness.cjs");

const LANE = helpers.NAV_REQ_LANE_COPY;
const CARRIED = helpers.NAV_REQ_CARRIED_COPY;

const REQ_NOTE = [
  "- [ ] #task Owner task ^own",
  "  - [ ] Depth one",
  "    - [ ] Depth two",
  "      - [ ] Depth three",
  "  - [-] Dropped parent",
  "    - [ ] Excluded child",
  "  - [>] [[#^other|Carried stub]]",
  "  - NOTES",
  "    - [ ] Nested note checklist",
  "- [ ] #task Second task ^two",
  "- [ ] Plain checklist",
  "",
  "```",
  "- [ ] Fenced lookalike",
  "```",
].join("\n");

function makePlugin(editor, extras = {}) {
  const file = extras.file || {
    path: extras.filePath || "Area.md",
    basename: "Area",
    extension: "md",
  };
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    plugins: { plugins: extras.plugins || {} },
    vault: { getMarkdownFiles: () => [file] },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: extras.metadataCache || {},
    ...(extras.app || {}),
  };
  plugin.getActiveMarkdownView = () => ({ editor, file });
  if (typeof extras.isMarkdownFile === "function") {
    plugin.isMarkdownFile = extras.isMarkdownFile;
  }
  if (typeof extras.isAreaOrProjectNote === "function") {
    plugin.isAreaOrProjectNote = extras.isAreaOrProjectNote;
  }
  return { plugin, file };
}

function editorOn(line, content = REQ_NOTE) {
  return new TransactionEditor(content, { line, ch: 2 });
}

test("navReqInfoAtLine recognizes depth-1, depth-3, excluded, and carried reqs", () => {
  const depthOne = helpers.navReqInfoAtLine(REQ_NOTE, 1);
  assert.ok(depthOne);
  assert.equal(depthOne.depth, 1);
  assert.equal(depthOne.ownerIndex, 0);
  assert.equal(depthOne.text, "Depth one");

  const depthThree = helpers.navReqInfoAtLine(REQ_NOTE, 3);
  assert.ok(depthThree);
  assert.equal(depthThree.depth, 3);
  assert.equal(depthThree.ownerIndex, 0);

  const excluded = helpers.navReqInfoAtLine(REQ_NOTE, 5);
  assert.ok(excluded);
  assert.equal(excluded.state, "excluded");
  assert.equal(helpers.navReqRefuseCopy(excluded), LANE);

  const carried = helpers.navReqInfoAtLine(REQ_NOTE, 6);
  assert.ok(carried);
  assert.equal(helpers.navReqIsCarried(carried), true);
  assert.equal(helpers.navReqRefuseCopy(carried), CARRIED);

  assert.equal(helpers.navReqInfoAtLine(REQ_NOTE, 0), null);
  assert.equal(helpers.navReqInfoAtLine(REQ_NOTE, 8), null);
  assert.equal(helpers.navReqInfoAtLine(REQ_NOTE, 10), null);
  assert.equal(helpers.navReqInfoAtLine(REQ_NOTE, 13), null);
});

test("toggleTaskLane refuses req lines with the lane copy and writes nothing", async () => {
  notices.length = 0;
  const editor = editorOn(1);
  const { plugin } = makePlugin(editor);
  const before = editor.getValue();
  assert.equal(await plugin.toggleTaskLane(editor), false);
  assert.equal(editor.getValue(), before);
  assert.equal(notices.at(-1), LANE);
});

test("toggleTaskLane refuses a carried stub with the carried copy", async () => {
  notices.length = 0;
  const editor = editorOn(6);
  const { plugin } = makePlugin(editor);
  const before = editor.getValue();
  assert.equal(await plugin.toggleTaskLane(editor), false);
  assert.equal(editor.getValue(), before);
  assert.equal(notices.at(-1), CARRIED);
});

test("counted toggleTaskLane on a req refuses the whole batch", async () => {
  notices.length = 0;
  const editor = editorOn(1);
  const { plugin } = makePlugin(editor);
  const before = editor.getValue();
  assert.equal(
    await plugin.toggleTaskLane(editor, {
      countExplicit: true,
      additionalTaskCount: 2,
    }),
    false,
  );
  assert.equal(editor.getValue(), before);
  assert.equal(notices.at(-1), LANE);
});

test("toggleTaskLane on a #task line still commits Ready to Next", async () => {
  notices.length = 0;
  const editor = new TransactionEditor("- [ ] #task Ship it ^a1", {
    line: 0,
    ch: 5,
  });
  const { plugin } = makePlugin(editor);
  assert.equal(await plugin.toggleTaskLane(editor), true);
  assert.equal(editor.getValue(), "- [*] #task Ship it ^a1");
  assert.match(notices.at(-1), /→ Next/);
});

test("toggleTaskLane on a dedicated Task Link still uses Task Link copy", async () => {
  notices.length = 0;
  const editor = new TransactionEditor("- [[Note#^a1]]", { line: 0, ch: 4 });
  const { plugin } = makePlugin(editor, {
    file: { path: "Daily.md", basename: "Daily", extension: "md" },
    metadataCache: { getFirstLinkpathDest: () => null },
  });
  const before = editor.getValue();
  assert.equal(await plugin.toggleTaskLane(editor), false);
  assert.equal(editor.getValue(), before);
  assert.notEqual(notices.at(-1), LANE);
  assert.notEqual(notices.at(-1), CARRIED);
});

test("refreshTaskFreshness refuses req lines before asking for the freshness api", async () => {
  notices.length = 0;
  const editor = editorOn(3);
  const { plugin } = makePlugin(editor);
  const before = editor.getValue();
  assert.equal(await plugin.refreshTaskFreshness(editor), false);
  assert.equal(editor.getValue(), before);
  assert.equal(notices.at(-1), LANE);
});

test("Ctrl+Alt+F and counted Alt+F refuse a req without writing", async () => {
  notices.length = 0;
  const editor = editorOn(1);
  const { plugin } = makePlugin(editor);
  const before = editor.getValue();
  assert.equal(await plugin.refreshTaskFreshness(editor, { advance: true }), false);
  assert.equal(await plugin.refreshTaskFreshness(editor, {
    countExplicit: true,
    additionalTaskCount: 1,
  }), false);
  assert.equal(editor.getValue(), before);
  assert.ok(notices.every((message) => message === LANE));
});

test("refreshTaskFreshness on a #task line still asks for the freshness api", async () => {
  notices.length = 0;
  const editor = new TransactionEditor("- [ ] #task Ship it ^a1", {
    line: 0,
    ch: 5,
  });
  const { plugin } = makePlugin(editor);
  assert.equal(await plugin.refreshTaskFreshness(editor), false);
  assert.match(notices.at(-1), /Bob Ledger Tools api v3 required/);
});

test("Alt+P refuses a req with the lane copy", () => {
  notices.length = 0;
  const editor = editorOn(1);
  const { plugin } = makePlugin(editor);
  const before = editor.getValue();
  assert.equal(plugin.rollByRecommendation(editor), false);
  assert.equal(editor.getValue(), before);
  assert.equal(notices.at(-1), LANE);
});

test("Ctrl+Shift+M refuses a req with the lane copy", () => {
  notices.length = 0;
  const editor = editorOn(1);
  const { plugin } = makePlugin(editor);
  const before = editor.getValue();
  assert.equal(plugin.openTaskMoveOrPomodoroBulletPicker(editor, {
    editor,
    file: { path: "Area.md", basename: "Area", extension: "md" },
  }), false);
  assert.equal(editor.getValue(), before);
  assert.equal(notices.at(-1), LANE);
});

test("createProjectNoteFromTask refuses a req with the lane copy", async () => {
  notices.length = 0;
  const editor = editorOn(1);
  const { plugin } = makePlugin(editor);
  plugin.isMarkdownFile = () => true;
  plugin.isAreaOrProjectNote = () => true;
  const before = editor.getValue();
  assert.equal(
    await plugin.createProjectNoteFromTask(editor, {
      editor,
      file: { path: "area/Area.md", basename: "Area", extension: "md" },
    }),
    false,
  );
  assert.equal(editor.getValue(), before);
  assert.equal(notices.at(-1), LANE);
});

test("plain checklists, NOTES children, and fenced lookalikes keep today's copy", async () => {
  for (const line of [8, 10, 13]) {
    notices.length = 0;
    const editor = editorOn(line);
    const { plugin } = makePlugin(editor);
    const before = editor.getValue();
    assert.equal(await plugin.toggleTaskLane(editor), false);
    assert.equal(editor.getValue(), before);
    assert.notEqual(notices.at(-1), LANE);
    assert.notEqual(notices.at(-1), CARRIED);
  }
});

function assertOwnerCard(line, expectedOwner) {
  notices.length = 0;
  const harness = createBulletPropertyPickerHarness({
    content: REQ_NOTE,
    cursor: { line, ch: 2 },
    file: { path: "Area.md", basename: "Area", extension: "md" },
  });
  const before = harness.editor.getValue();
  assert.equal(harness.open(), true);
  assert.equal(harness.editor.getValue(), before);
  assert.equal(harness.editor.getCursor().line, expectedOwner);
  const modal = harness.plugin.activeBulletPropertyPicker;
  assert.ok(modal);
  assert.equal(modal.cursor.line, expectedOwner);
  assert.equal(modal.filePath, "Area.md");
}

test("Ctrl+Shift+P on a depth-1 req opens the owner's Task Card", () => {
  assertOwnerCard(1, 0);
});

test("Ctrl+Shift+P on a depth-3 req opens the owner's Task Card", () => {
  assertOwnerCard(3, 0);
});

test("Ctrl+Shift+P on an excluded req opens the owner's Task Card", () => {
  assertOwnerCard(5, 0);
});

test("Ctrl+Shift+P on a carried stub opens the owner's Task Card", () => {
  assertOwnerCard(6, 0);
});

test("Task Card stage shortcuts on a req open the owner's card", () => {
  notices.length = 0;
  const config = helpers.validateBulletPropertyConfig({
    properties: [
      { name: "scheduled", values: "date" },
      { name: "dependsOn", values: "local_task_id" },
    ],
  });
  const harness = createBulletPropertyPickerHarness({
    content: REQ_NOTE,
    cursor: { line: 1, ch: 2 },
    file: { path: "Area.md", basename: "Area", extension: "md" },
    config,
  });
  const before = harness.editor.getValue();
  const reopenFromReq = (options) => {
    harness.editor.setCursor(1, 2);
    assert.equal(harness.open(options), true);
    assert.equal(harness.editor.getCursor().line, 0);
    const modal = harness.plugin.activeBulletPropertyPicker;
    assert.ok(modal);
    assert.equal(modal.cursor.line, 0);
    modal.close();
  };
  reopenFromReq({ initialTaskCardRow: "depends-on" });
  reopenFromReq({ initialTaskCardRow: "blocks" });
  // 427's Ctrl+Shift+L / Ctrl+Shift+Alt+L chords call openBulletPropertyPicker
  // with these row ids, so the 550 req-owner hook covers them the same way.
  reopenFromReq({ initialTaskCardRow: "links-to" });
  reopenFromReq({ initialTaskCardRow: "linked-from" });
  assert.equal(harness.editor.getValue(), before);
});

test("Ctrl+Shift+P on a #task line still opens that task's card", () => {
  const harness = createBulletPropertyPickerHarness({
    content: REQ_NOTE,
    cursor: { line: 0, ch: 2 },
    file: { path: "Area.md", basename: "Area", extension: "md" },
  });
  assert.equal(harness.open(), true);
  assert.equal(harness.editor.getCursor().line, 0);
  assert.equal(harness.plugin.activeBulletPropertyPicker.cursor.line, 0);
});
