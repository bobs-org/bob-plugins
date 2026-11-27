// Tie chords settle promoted prerequisite notes after dependency and BLOCKS
// follow-up writes. Synthetic area notes use the real ledger-tools API.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    class EmptyClass {}
    return {
      MarkdownRenderChild: EmptyClass,
      MarkdownRenderer: EmptyClass,
      MarkdownView: EmptyClass,
      Modal: EmptyClass,
      Notice: EmptyClass,
      Platform: { isDesktopApp: true },
      Plugin: EmptyClass,
      PluginSettingTab: EmptyClass,
      Setting: EmptyClass,
      Scope: EmptyClass,
      normalizePath: (value) => value,
      parseYaml: () => ({}),
      setIcon: undefined,
    };
  }
  if (request === "@codemirror/state") {
    return {
      Prec: { highest: (value) => value },
      StateEffect: { define: () => ({ of: (value) => value }) },
      StateField: { define: (spec) => Object.freeze({ ...spec }) },
      EditorState: {},
      Transaction: {},
    };
  }
  if (request === "@codemirror/view") {
    const emptyDecoration = { map: () => emptyDecoration };
    return {
      EditorView: class EditorView {},
      keymap: { of: (value) => value },
      Decoration: {
        none: emptyDecoration,
        line: (spec) => ({ range: (from) => ({ from, spec }) }),
        set: (ranges) => ({ ranges, map: () => ({ ranges }) }),
      },
    };
  }
  if (request === "@codemirror/commands") {
    return { undoDepth: (state) => state.undoGroups };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const {
  NavigationHotkeysPlugin,
  TransactionEditor,
  compatibleTasksSettings,
  helpers,
} = require("./navigation-hotkeys-harness.cjs");
Module._load = originalLoad;

const TODAY = "2026-11-25";
const TODAY_DATE = new Date(2026, 10, 25, 12);
const OWNER_PATH = "Areas/owner.md";
const PREREQ_PATH = "Areas/prerequisite.md";
const DAILY_PATH = "2026/20261125.md";

function areaNote(...blocks) {
  return ["---", "type: [[area]]", "---", "## Tasks", "", ...blocks, ""].join("\n");
}

function makeFixture({ noteContents, ownerPath = OWNER_PATH, ownerId = "owner", openPaths = [ownerPath] }) {
  const files = new Map();
  const editors = new Map();
  const fileObjects = new Map();
  const ledger = new LedgerToolsPlugin();
  const settle = ledger.taskSettleApi();
  for (const [path, content] of Object.entries(noteContents)) {
    const settled = settle.settleNote({ path, contents: content, today: TODAY });
    files.set(path, settled.contents);
    fileObjects.set(path, { path });
  }
  for (const path of openPaths) {
    const content = files.get(path);
    const ownerLine = content
      .split("\n")
      .findIndex((line) => line.includes(`^${ownerId}`));
    editors.set(
      path,
      new TransactionEditor(content, { line: ownerLine < 0 ? 0 : ownerLine, ch: 4 }),
    );
  }
  const leaves = [...editors].map(([path, editor]) => ({
    pinned: false,
    view: {
      editor,
      file: { path },
      getViewType: () => "markdown",
    },
  }));
  const settings = compatibleTasksSettings();
  const tasksSettings = {
    globalFilter: settings.globalFilter || "#task",
    statusSettings: settings.statusSettings,
  };
  const vault = {
    adapter: { read: async () => JSON.stringify(tasksSettings) },
    getMarkdownFiles: () => [...fileObjects.values()],
    getAbstractFileByPath: (path) => fileObjects.get(path) || null,
    cachedRead: async (file) => files.get(file.path) ?? null,
    read: async (file) => files.get(file.path) ?? null,
    process: async (file, callback) => {
      const current = files.get(file.path) || "";
      const next = callback(current);
      if (typeof next === "string") files.set(file.path, next);
      return next;
    },
  };
  const app = {
    plugins: {
      plugins: {
        "bob-ledger-tools": { api: { taskSettle: settle } },
        "obsidian-tasks-plugin": { settings: tasksSettings },
      },
    },
    internalPlugins: {
      plugins: {
        "daily-notes": { instance: { options: { folder: "2026", format: "YYYYMMDD" } } },
      },
    },
    workspace: {
      activeLeaf: leaves[0] || null,
      iterateAllLeaves(visit) {
        for (const leaf of leaves) visit(leaf);
      },
      getLeavesOfType(type) {
        return type === "markdown" ? leaves : [];
      },
      getActiveViewOfType() {
        return leaves[0] && leaves[0].view;
      },
      getActiveFile() {
        return leaves[0] && leaves[0].view.file;
      },
      on() {
        return { unload() {} };
      },
    },
    vault,
    metadataCache: {
      getFirstLinkpathDest(linkpath) {
        const bare = String(linkpath || "").split("#")[0];
        if (fileObjects.has(bare)) return fileObjects.get(bare);
        if (fileObjects.has(`${bare}.md`)) return fileObjects.get(`${bare}.md`);
        const basename = bare.split("/").at(-1).replace(/\.md$/i, "").toLowerCase();
        return [...fileObjects.values()].find((file) =>
          file.path.split("/").at(-1).replace(/\.md$/i, "").toLowerCase() === basename,
        ) || null;
      },
    },
  };
  ledger.app = app;
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = app;
  plugin.vimJumpHistory = helpers.createVimJumpHistory();
  plugin.readDependencyVaultFileList = () => [...fileObjects.keys()];
  plugin.getActiveMarkdownView = () => leaves[0] && leaves[0].view;
  return {
    app,
    plugin,
    settle,
    files,
    editors,
    ownerEditor: editors.get(ownerPath),
  };
}

function taskLine(content, blockId) {
  return String(content)
    .split("\n")
    .find((line) => line.includes("#task") && line.includes(`^${blockId}`)) || "";
}

function assertTaskStatus(content, blockId, status) {
  assert.equal(taskLine(content, blockId).slice(3, 4), status);
}

function assertAlreadySettled(fixture, path, content) {
  const settled = fixture.settle.settleNote({ path, contents: content, today: TODAY });
  assert.equal(settled.changed, false, `${path} should already have settled groups and badges`);
  assert.equal(settled.contents, content);
}

function refs(ownerPath, otherPath, ownerId = "owner", otherId = "prerequisite") {
  return [
    { path: ownerPath, blockId: ownerId },
    { path: otherPath, blockId: otherId },
  ];
}

async function tie(fixture, ownerRef, otherRef, to) {
  const expected = new Map();
  for (const path of new Set([ownerRef.path, otherRef.path])) {
    expected.set(path, fixture.files.get(path));
  }
  return fixture.plugin.applyTieChange(ownerRef, otherRef, to, {
    expected,
    today: TODAY_DATE,
  });
}

function blockedOwnerWithOpenPrerequisite({ scheduled = "", daily = "" } = {}) {
  const schedule = scheduled ? ` [scheduled:: ${scheduled}]` : "";
  const ownerBlock = [
    `- [?] #task Owner [dependsOn:: prerequisite-id]${schedule} ^owner`,
    "  - ⛓️ **DEPENDS ON:** [[#^prerequisite]]",
  ].join("\n");
  return {
    [OWNER_PATH]: areaNote(
      ownerBlock,
      "- [ ] #task Prerequisite [id:: prerequisite-id] ^prerequisite",
      "- [x] #task Archived decision ^finished",
    ),
    ...(daily ? { [DAILY_PATH]: daily } : {}),
  };
}

test("⌃L releases the last dependency in one note and settles the owner", async () => {
  const fixture = makeFixture({ noteContents: blockedOwnerWithOpenPrerequisite() });
  const result = await tie(fixture, ...refs(OWNER_PATH, OWNER_PATH), "plain-out");

  assert.equal(result.ok, true, JSON.stringify(result));
  const content = fixture.ownerEditor.getValue();
  assertTaskStatus(content, "owner", " ");
  assert.match(content, /🪢 \*\*LINKS:\*\* \[\[#\^prerequisite\]\]/);
  assert.match(content, /🪢 \*\*LINKED FROM:\*\* \[\[#\^owner\]\]/);
  assert.match(content, /⚪ 2 open/);
  assert.match(result.notice, /Ready again$/);
  assert.equal(fixture.ownerEditor.undoGroups, 1);
  assert.equal(
    fixture.ownerEditor.getCursor().line,
    content.split("\n").indexOf(taskLine(content, "owner")),
  );
  assertAlreadySettled(fixture, OWNER_PATH, content);
});

test("⌃L ignores a dangling dependency and an open twin under _conflicts", async () => {
  const fixture = makeFixture({
    noteContents: {
      ...blockedOwnerWithOpenPrerequisite(),
      "_conflicts/Tasks.md": areaNote(
        "- [ ] #task Open conflict twin [id:: prerequisite-id] ^twin",
        "- [?] #task Dangling conflict copy ^conflict\n  - ⛓️ **DEPENDS ON:** [[Missing#^unknown]]",
      ),
    },
  });
  const result = await tie(fixture, ...refs(OWNER_PATH, OWNER_PATH), "plain-out");

  assert.equal(result.ok, true, JSON.stringify(result));
  const content = fixture.ownerEditor.getValue();
  assertTaskStatus(content, "owner", " ");
  assert.match(result.notice, /Ready again$/);
  assert.equal(fixture.ownerEditor.undoGroups, 1);
  assertAlreadySettled(fixture, OWNER_PATH, content);
});

test("⌃L recovers an owner linked under today's open Pomodoro to Next", async () => {
  const daily = [
    "## Pomodoros",
    "- [ ] Current (0900-0930)",
    "  - [[Areas/owner#^owner]]",
  ].join("\n");
  const fixture = makeFixture({
    noteContents: blockedOwnerWithOpenPrerequisite({ daily }),
  });
  const result = await tie(fixture, ...refs(OWNER_PATH, OWNER_PATH), "plain-out");

  assert.equal(result.ok, true, JSON.stringify(result));
  const content = fixture.ownerEditor.getValue();
  assertTaskStatus(content, "owner", "*");
  assert.match(content, /### Next & In Progress[\s\S]*\^owner/);
  assertAlreadySettled(fixture, OWNER_PATH, content);
});

test("⌃L preserves a future schedule and reports Still blocked", async () => {
  const fixture = makeFixture({
    noteContents: blockedOwnerWithOpenPrerequisite({ scheduled: "2026-11-26" }),
  });
  const result = await tie(fixture, ...refs(OWNER_PATH, OWNER_PATH), "plain-out");

  assert.equal(result.ok, true, JSON.stringify(result));
  const content = fixture.ownerEditor.getValue();
  assertTaskStatus(content, "owner", "?");
  assert.match(result.notice, /Still blocked$/);
  assertAlreadySettled(fixture, OWNER_PATH, content);
});

test("⌃B absorbs the plain link and settles its owner in one note", async () => {
  const fixture = makeFixture({
    noteContents: {
      [OWNER_PATH]: areaNote(
        "- [ ] #task Owner ^owner\n  - 🪢 **LINKS:** [[#^prerequisite]]",
        "- [ ] #task Prerequisite [id:: prerequisite-id] ^prerequisite",
      ),
    },
  });
  const result = await tie(fixture, ...refs(OWNER_PATH, OWNER_PATH), "owner-waits");

  assert.equal(result.ok, true, JSON.stringify(result));
  const content = fixture.ownerEditor.getValue();
  assertTaskStatus(content, "owner", "?");
  assert.match(content, /### Blocked[\s\S]*\^owner/);
  assert.match(content, /⛓️ \*\*DEPENDS ON:\*\* \[\[#\^prerequisite\]\]/);
  assert.doesNotMatch(content, /\*\*LINKS:\*\*/);
  assert.match(content, /🔴 1 blocked/);
  assert.equal(fixture.ownerEditor.undoGroups, 1);
  assertAlreadySettled(fixture, OWNER_PATH, content);
});

test("⌃B settles a promoted prerequisite note after its BLOCKS follow-up", async () => {
  const fixture = makeFixture({
    noteContents: {
      [OWNER_PATH]: areaNote("- [*] #task Owner commits to this ^owner"),
      [PREREQ_PATH]: areaNote("- [ ] #task Prerequisite [id:: prerequisite-id] ^prerequisite"),
    },
  });
  const result = await tie(fixture, ...refs(OWNER_PATH, PREREQ_PATH), "owner-waits");

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(fixture.ownerEditor.undoGroups, 1);
  const ownerAfter = fixture.ownerEditor.getValue();
  const prerequisiteAfter = fixture.files.get(PREREQ_PATH);
  assert.match(ownerAfter, /### Blocked[\s\S]*\^owner/);
  assert.match(ownerAfter, /🔴 1 blocked/);
  assertTaskStatus(prerequisiteAfter, "prerequisite", "*");
  assert.match(prerequisiteAfter, /### Next & In Progress[\s\S]*\^prerequisite/);
  assert.match(prerequisiteAfter, /🧱 \*\*BLOCKS:\*\* \[\[(?:owner#)?\^owner\]\]/);
  assert.match(prerequisiteAfter, /🔵 1 next\/wip/);
  assertAlreadySettled(fixture, OWNER_PATH, ownerAfter);
  assertAlreadySettled(fixture, PREREQ_PATH, prerequisiteAfter);
});

test("⌃B settles a promoted prerequisite in its second open editor", async () => {
  const fixture = makeFixture({
    noteContents: {
      [OWNER_PATH]: areaNote("- [*] #task Owner commits to this ^owner"),
      [PREREQ_PATH]: areaNote("- [ ] #task Prerequisite [id:: prerequisite-id] ^prerequisite"),
    },
    openPaths: [OWNER_PATH, PREREQ_PATH],
  });
  const prerequisiteEditor = fixture.editors.get(PREREQ_PATH);
  const result = await tie(fixture, ...refs(OWNER_PATH, PREREQ_PATH), "owner-waits");

  assert.equal(result.ok, true, JSON.stringify(result));
  const prerequisiteAfter = prerequisiteEditor.getValue();
  assertTaskStatus(prerequisiteAfter, "prerequisite", "*");
  assert.match(prerequisiteAfter, /### Next & In Progress[\s\S]*\^prerequisite/);
  assert.match(prerequisiteAfter, /🧱 \*\*BLOCKS:\*\* \[\[(?:owner#)?\^owner\]\]/);
  assertAlreadySettled(fixture, PREREQ_PATH, prerequisiteAfter);
});

test("tie chords keep writing when ledger-tools taskSettle is unavailable", async () => {
  const fixture = makeFixture({
    noteContents: {
      [OWNER_PATH]: areaNote("- [*] #task Owner commits to this ^owner"),
      [PREREQ_PATH]: areaNote("- [ ] #task Prerequisite [id:: prerequisite-id] ^prerequisite"),
    },
  });
  delete fixture.app.plugins.plugins["bob-ledger-tools"];
  const result = await tie(fixture, ...refs(OWNER_PATH, PREREQ_PATH), "owner-waits");

  assert.equal(result.ok, true, JSON.stringify(result));
  assertTaskStatus(fixture.files.get(PREREQ_PATH), "prerequisite", "*");
  assert.match(fixture.ownerEditor.getValue(), /⛓️ \*\*DEPENDS ON:\*\*/);
});

test("⌃⇧B settles the promoted cross-note source after BLOCKS mirrors", async () => {
  const fixture = makeFixture({
    noteContents: {
      [OWNER_PATH]: areaNote("- [ ] #task Prerequisite [id:: prerequisite-id] ^owner"),
      [PREREQ_PATH]: areaNote("- [*] #task Dependent starts Next ^prerequisite"),
    },
  });
  const result = await tie(
    fixture,
    ...refs(OWNER_PATH, PREREQ_PATH, "owner", "prerequisite"),
    "other-waits",
  );

  assert.equal(result.ok, true, JSON.stringify(result));
  const sourceAfter = fixture.ownerEditor.getValue();
  assertTaskStatus(sourceAfter, "owner", "*");
  assert.match(sourceAfter, /### Next & In Progress[\s\S]*\^owner/);
  assertAlreadySettled(fixture, OWNER_PATH, sourceAfter);
  assertAlreadySettled(fixture, PREREQ_PATH, fixture.files.get(PREREQ_PATH));
});
