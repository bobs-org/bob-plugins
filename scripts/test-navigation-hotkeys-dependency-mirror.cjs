const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  notices,
  NavigationHotkeysPlugin,
  helpers,
  TransactionEditor,
  compatibleTasksSettings,
} = require("./navigation-hotkeys-harness.cjs");

test("mirror scheduler debounces at the contract interval", () => {
  assert.equal(helpers.DEPENDENCY_MIRROR_DEBOUNCE_MS, 400);
  const plugin = new NavigationHotkeysPlugin();
  assert.equal(typeof plugin.scheduleDependencyHandEditMirrorFromUpdate, "function");
  assert.equal(typeof plugin.enqueueDependencyHandEditMirror, "function");
  assert.equal(typeof plugin.fireDependencyHandEditMirror, "function");
});

test("mirror scheduler seeds the baseline from the update start state", () => {
  const oldContent = [
    "- [ ] #task P ^p",
    "  - ⛓️ **DEPENDS ON:** [[#^a]]",
    "- [ ] #task A ^a",
  ].join("\n");
  const midContent = [
    "- [ ] #task P ^p",
    "  - ⛓️ **DEPENDS ON:** [[#^a]]x",
    "- [ ] #task A ^a",
  ].join("\n");
  const editor = new TransactionEditor(midContent, { line: 1, ch: 30 });
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => ({ path: "Here.md" }) },
  };
  plugin.getActiveMarkdownView = () => ({
    editor,
    file: { path: "Here.md" },
  });
  // No cached content: the first edit after opening the note still seeds
  // its baseline from the CM6 start state instead of mirroring blind.
  const lineAt = (offset) => ({
    number: midContent.slice(0, Math.max(0, offset)).split("\n").length,
  });
  plugin.scheduleDependencyHandEditMirrorFromUpdate({
    docChanged: true,
    view: {},
    startState: { doc: { toString: () => oldContent } },
    changes: {
      iterChangedRanges: (callback) => callback(30, 30, 30, 31),
      mapPos: (position) => position,
    },
    state: { doc: { lineAt } },
  });
  const snapshot = plugin.pendingDependencyMirrorSnapshot;
  assert.equal(snapshot.oldContent, oldContent);
  assert.equal(snapshot.editedLine, 1);
  assert.ok(Number.isInteger(snapshot.ownerPos));
  assert.equal(
    snapshot.removedText,
    helpers.findRemovedLineText(oldContent, midContent),
  );
  clearTimeout(plugin.pendingDependencyMirror);
  plugin.pendingDependencyMirror = null;
  plugin.pendingDependencyMirrorSnapshot = null;
});

test("mirror scheduler keeps the first baseline and maps the owner across a burst", () => {
  const oldContent = [
    "- [ ] #task P ^p",
    "  - ⛓️ **DEPENDS ON:** [[#^a]]",
    "- [ ] #task A ^a",
  ].join("\n");
  const midContent = [
    "- [ ] #task P ^p",
    "  - ⛓️ **DEPENDS ON:** [[#^a]]x",
    "- [ ] #task A ^a",
  ].join("\n");
  // A second update inserts a header above: the owner anchor maps forward
  // instead of jumping to the latest edited line.
  const newerContent = ["# header", ...midContent.split("\n")].join("\n");
  const editor = new TransactionEditor(midContent, { line: 1, ch: 30 });
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => ({ path: "Here.md" }) },
  };
  plugin.getActiveMarkdownView = () => ({
    editor,
    file: { path: "Here.md" },
  });
  const lineAt = (text) => (offset) => ({
    number: text.slice(0, Math.max(0, offset)).split("\n").length,
  });
  plugin.scheduleDependencyHandEditMirrorFromUpdate({
    docChanged: true,
    view: {},
    startState: { doc: { toString: () => oldContent } },
    changes: {
      iterChangedRanges: (callback) => callback(30, 30, 30, 31),
      mapPos: (position) => position,
    },
    state: { doc: { lineAt: lineAt(midContent) } },
  });
  let snapshot = plugin.pendingDependencyMirrorSnapshot;
  assert.equal(snapshot.oldContent, oldContent);
  assert.equal(snapshot.editedLine, 1);
  const ownerPos = snapshot.ownerPos;
  editor.content = newerContent;
  plugin.scheduleDependencyHandEditMirrorFromUpdate({
    docChanged: true,
    view: {},
    startState: { doc: { toString: () => midContent } },
    changes: {
      iterChangedRanges: (callback) => callback(0, 0, 0, 9),
      mapPos: (position) => position + 9,
    },
    state: { doc: { lineAt: lineAt(newerContent) } },
  });
  snapshot = plugin.pendingDependencyMirrorSnapshot;
  // The burst baseline never resets, the removed text refreshes against the
  // latest content, the edited line tracks the latest change (the inserted
  // header), and the owner follows its baseline anchor down one line.
  assert.equal(snapshot.oldContent, oldContent);
  assert.equal(
    snapshot.removedText,
    helpers.findRemovedLineText(oldContent, newerContent),
  );
  assert.equal(snapshot.ownerPos, ownerPos + 9);
  assert.equal(snapshot.editedLine, 0);
  assert.equal(snapshot.ownerLine, 1);
  assert.equal(snapshot.baselineEditedLine, 1);
  clearTimeout(plugin.pendingDependencyMirror);
  plugin.pendingDependencyMirror = null;
  plugin.pendingDependencyMirrorSnapshot = null;
});

test("mirror listener runs clear-field for a first-edit deletion with a following sibling", async () => {
  const oldContent = [
    "- [?] #task P [dependsOn:: Here__a] ^p",
    "  - ⛓️ **DEPENDS ON:** [[#^a]]",
    "- [?] #task S [dependsOn:: Here__b] ^s",
    "  - ⛓️ **DEPENDS ON:** [[#^b]]",
    "- [x] #task A [id:: Here__a] ^a",
    "- [x] #task B [id:: Here__b] ^b",
  ].join("\n");
  const newContent = [
    "- [?] #task P [dependsOn:: Here__a] ^p",
    "- [?] #task S [dependsOn:: Here__b] ^s",
    "  - ⛓️ **DEPENDS ON:** [[#^b]]",
    "- [x] #task A [id:: Here__a] ^a",
    "- [x] #task B [id:: Here__b] ^b",
  ].join("\n");
  // A vim `dd` of the Depends-On line: the cursor stays on the line that
  // slid up, so the queued pass re-arms until the cursor leaves.
  const editor = new TransactionEditor(newContent, { line: 1, ch: 0 });
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => ({ path: "Here.md" }) },
    vault: {
      adapter: { read: async () => JSON.stringify(compatibleTasksSettings()) },
    },
  };
  plugin.getActiveMarkdownView = () => ({
    editor,
    file: { path: "Here.md" },
  });
  const oldLines = oldContent.split("\n");
  const deleteFrom = oldLines.slice(0, 1).join("\n").length + 1;
  const deleteTo = deleteFrom + oldLines[1].length + 1;
  const lineAt = (offset) => ({
    number: newContent.slice(0, Math.max(0, offset)).split("\n").length,
  });
  plugin.scheduleDependencyHandEditMirrorFromUpdate({
    docChanged: true,
    view: {},
    startState: { doc: { toString: () => oldContent } },
    changes: {
      iterChangedRanges: (callback) =>
        callback(deleteFrom, deleteTo, deleteFrom, deleteFrom),
      mapPos: (position) =>
        position >= deleteTo ? position - (deleteTo - deleteFrom) : position,
    },
    state: { doc: { lineAt } },
  });
  const snapshot = plugin.pendingDependencyMirrorSnapshot;
  // Seeded from the start state with no cache: the deleted line is known
  // removed, so the plan clears P instead of touching S.
  assert.equal(snapshot.oldContent, oldContent);
  assert.match(snapshot.removedText, /DEPENDS ON/);
  clearTimeout(plugin.pendingDependencyMirror);
  plugin.pendingDependencyMirror = null;
  // Still on the edited line: the pass re-arms and writes nothing.
  await plugin.fireDependencyHandEditMirror(snapshot);
  assert.notEqual(plugin.pendingDependencyMirror, null);
  assert.equal(editor.getValue(), newContent);
  clearTimeout(plugin.pendingDependencyMirror);
  plugin.pendingDependencyMirror = null;
  // Once the cursor leaves the line, P's field clears and S is untouched.
  editor.setCursor({ line: 0, ch: 0 });
  await plugin.fireDependencyHandEditMirror(snapshot);
  assert.equal(plugin.pendingDependencyMirror, null);
  assert.equal(
    editor.getValue(),
    [
      "- [ ] #task P ^p",
      "- [?] #task S [dependsOn:: Here__b] ^s",
      "  - ⛓️ **DEPENDS ON:** [[#^b]]",
      "- [x] #task A [id:: Here__a] ^a",
      "- [x] #task B [id:: Here__b] ^b",
    ].join("\n"),
  );
});

test("mirror fire re-arms while the cursor stays on the edited line", async () => {
  const content = [
    "- [ ] #task P ^p",
    "  - ⛓️ **DEPENDS ON:** [[#^a]]",
    "- [ ] #task A ^a",
  ].join("\n");
  const editor = new TransactionEditor(content, { line: 1, ch: 2 });
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => ({ path: "Here.md" }) },
  };
  const snapshot = {
    editor,
    parentPath: "Here.md",
    oldContent: content,
    editedLine: 1,
    removedText: "",
  };
  await plugin.fireDependencyHandEditMirror(snapshot);
  assert.notEqual(plugin.pendingDependencyMirror, null);
  assert.equal(editor.getValue(), content);
  clearTimeout(plugin.pendingDependencyMirror);
  plugin.pendingDependencyMirror = null;
  // Once the cursor leaves the line, the queued pass runs.
  editor.setCursor({ line: 2, ch: 0 });
  await plugin.fireDependencyHandEditMirror(snapshot);
  assert.equal(plugin.pendingDependencyMirror, null);
  assert.match(editor.getValue(), /- \[\?\] #task P \[dependsOn:: Here__a\] \^p$/m);
});

test("mirror scheduler reads changed ranges from the CM6 update", () => {
  const oldContent = [
    "- [ ] #task P ^p",
    "  - ⛓️ **DEPENDS ON:**",
    "- [ ] #task A ^a",
  ].join("\n");
  const newContent = [
    "- [ ] #task P ^p",
    "  - ⛓️ **DEPENDS ON:** [[#^a]]",
    "- [ ] #task A ^a",
  ].join("\n");
  const editor = new TransactionEditor(newContent, { line: 1, ch: 28 });
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = { workspace: {} };
  plugin.getActiveMarkdownView = () => ({
    editor,
    file: { path: "Here.md" },
  });
  plugin.dependencyMirrorByPath = new Map([["Here.md", oldContent]]);
  const update = {
    docChanged: true,
    view: {},
    changes: {
      iterChangedRanges: (callback) => callback(24, 24, 24, 30),
    },
    state: { doc: { lineAt: () => ({ number: 2 }) } },
  };
  plugin.scheduleDependencyHandEditMirrorFromUpdate(update);
  const snapshot = plugin.pendingDependencyMirrorSnapshot;
  assert.equal(snapshot.editedLine, 1);
  assert.equal(snapshot.oldContent, oldContent);
  clearTimeout(plugin.pendingDependencyMirror);
  plugin.pendingDependencyMirror = null;
  plugin.pendingDependencyMirrorSnapshot = null;
});

test("mirror scheduler skips IME composition", () => {
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = { workspace: {} };
  plugin.dependencyMirrorByPath = new Map();
  let rangesRead = 0;
  plugin.scheduleDependencyHandEditMirrorFromUpdate({
    docChanged: true,
    view: { composing: true },
    changes: {
      iterChangedRanges: () => {
        rangesRead += 1;
      },
    },
    state: {},
  });
  assert.equal(rangesRead, 0);
  assert.equal(plugin.pendingDependencyMirrorSnapshot || null, null);
  assert.equal(plugin.pendingDependencyMirror || null, null);
});

test("mirror scheduler skips open modals", () => {
  const realDocument = global.document;
  global.document = {
    querySelector: (selector) => (selector === ".modal-container" ? {} : null),
  };
  try {
    const plugin = new NavigationHotkeysPlugin();
    plugin.app = { workspace: {} };
    plugin.dependencyMirrorByPath = new Map();
    plugin.scheduleDependencyHandEditMirrorFromUpdate({
      docChanged: true,
      view: {},
      changes: {
        iterChangedRanges: () => {
          throw new Error("ranges must not be read while a modal is open");
        },
      },
      state: {},
    });
    assert.equal(plugin.pendingDependencyMirrorSnapshot || null, null);
    assert.equal(plugin.pendingDependencyMirror || null, null);
  } finally {
    if (realDocument === undefined) {
      delete global.document;
    } else {
      global.document = realDocument;
    }
  }
});

test("counted Ctrl+D clears every targeted task in one transaction with one notice", async () => {
  const lines = [
    "- [?] #task P [dependsOn:: Here__a] ^p",
    "  - ⛓️ **DEPENDS ON:** [[#^a]]",
    "- [?] #task Q [dependsOn:: Here__a] ^q",
    "  - ⛓️ **DEPENDS ON:** [[#^a]]",
    "- [x] #task A [id:: Here__a] ^a",
  ];
  const editor = new TransactionEditor(lines.join("\n"), { line: 0, ch: 2 });
  const session = helpers.discoverCountedObsidianTaskTargets(
    editor.content,
    0,
    1,
  );
  assert.deepEqual(
    session.targets.map((target) => target.line),
    [0, 2],
  );
  const file = { path: "Here.md", extension: "md" };
  const plugin = new NavigationHotkeysPlugin();
  plugin.getActiveMarkdownView = () => ({ editor, file });
  plugin.app = {
    workspace: { getActiveFile: () => file },
    vault: {
      adapter: { read: async () => JSON.stringify(compatibleTasksSettings()) },
    },
  };
  const before = notices.length;
  const result = await plugin.deleteCountedBulletPropertyValue(
    editor,
    { line: 0, ch: 2 },
    file.path,
    session,
    "dependsOn",
  );
  assert.equal(result.deleted, true);
  assert.match(editor.getValue(), /- \[ \] #task P \^p$/m);
  assert.match(editor.getValue(), /- \[ \] #task Q \^q$/m);
  assert.doesNotMatch(editor.getValue(), /DEPENDS ON|dependsOn/);
  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.undoGroups, 1);
  assert.equal(notices.length - before, 1);
  assert.match(notices.at(-1), /Cleared dependencies from 2 tasks/);
});

test("counted N! refuses Depends-On lines with the Ctrl+Shift+P notice", async () => {
  const editor = new TransactionEditor(
    [
      "- [ ] #task P ^p",
      "  - ⛓️ **DEPENDS ON:** [[#^a]]",
      "- [[One]]",
    ].join("\n"),
    { line: 1, ch: 0 },
  );
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => ({ path: "Here.md" }) },
  };
  notices.length = 0;
  const result = await plugin.toggleCountedLineTransclusions(
    editor,
    { line: 1, ch: 0 },
    1,
  );
  assert.equal(result, true);
  // The Depends-On line is untouched while the neighbouring link toggles.
  assert.equal(
    editor.getLine(1),
    "  - ⛓️ **DEPENDS ON:** [[#^a]]",
  );
  assert.equal(editor.getLine(2), "- ![[One]]");
  assert.match(notices.at(-1), /Dependencies use plain links/);
});

test("counted N! on only a Depends-On line refuses without writing", async () => {
  const content = [
    "- [ ] #task P ^p",
    "  - ⛓️ **DEPENDS ON:** [[#^a]]",
  ].join("\n");
  const editor = new TransactionEditor(content, { line: 1, ch: 0 });
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => ({ path: "Here.md" }) },
  };
  notices.length = 0;
  const result = await plugin.toggleCountedLineTransclusions(
    editor,
    { line: 1, ch: 0 },
    0,
  );
  assert.equal(result, false);
  assert.equal(editor.getValue(), content);
  assert.equal(editor.transactions.length, 0);
  assert.match(notices.at(-1), /Dependencies use plain links/);
});
