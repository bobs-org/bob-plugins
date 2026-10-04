const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  notices,
  NavigationHotkeysPlugin,
  helpers,
  TransactionEditor,
  createTaskMoveDestinationFocusHarness,
} = require("./navigation-hotkeys-harness.cjs");

function createTaskMoveVimHistoryHarness(options = {}) {
  const sourceFile = { path: "Source.md", basename: "Source", extension: "md" };
  const destFile = { path: "Dest.md", basename: "Dest", extension: "md" };
  const sourceContent =
    options.sourceContent || "- [ ] #task Move ^move\n- [ ] #task Stay ^stay";
  const destContent =
    options.destContent ||
    ["---", 'type: "[[area]]"', "---", "# Destination"].join("\n");
  const sourceCursor = options.sourceCursor || { line: 0, ch: 4 };
  const sourceEditor = new TransactionEditor(sourceContent, sourceCursor);
  const destEditor = new TransactionEditor(
    destContent,
    options.destCursor || { line: 0, ch: 0 },
  );
  const plugin = new NavigationHotkeysPlugin();
  let activeFile = sourceFile;
  let activeEditor = sourceEditor;
  const fileMap = new Map([
    [sourceFile.path, sourceFile],
    [destFile.path, destFile],
  ]);
  const editors = new Map([
    [sourceFile.path, sourceEditor],
    [destFile.path, destEditor],
  ]);
  const openCalls = [];
  plugin.app = {
    vault: {
      getMarkdownFiles: () => [sourceFile, destFile],
      getAbstractFileByPath: (p) => fileMap.get(p) || null,
      cachedRead: async (file) => editors.get(file.path).getValue(),
      process: async () => {
        throw new Error("open editors should handle writes");
      },
    },
    workspace: {
      getActiveFile: () => activeFile,
      getActiveViewOfType: () => ({ file: activeFile, editor: activeEditor }),
    },
  };
  plugin.getActiveMarkdownView = () => ({ file: activeFile, editor: activeEditor });
  plugin.getOpenMarkdownEditorForPath = (p) => editors.get(p) || null;
  plugin.findMarkdownLeafByPath = (p) =>
    fileMap.has(p) ? { view: { file: fileMap.get(p), editor: editors.get(p) } } : null;
  plugin.activateWorkspaceLeaf = async (leaf) => {
    if (!leaf || !leaf.view || !leaf.view.file) {
      return false;
    }
    activeFile = leaf.view.file;
    activeEditor = leaf.view.editor;
    return true;
  };
  plugin.openMarkdownFileWithLeafReuse =
    options.openMarkdownFileWithLeafReuse ||
    (async (file) => {
      openCalls.push(file.path);
      if (!fileMap.has(file.path)) {
        return false;
      }
      activeFile = fileMap.get(file.path);
      activeEditor = editors.get(file.path);
      return true;
    });
  plugin.focusWorkspaceLeaf = async () => true;
  plugin.filePositions = new Map();
  plugin.vimJumpHistory = helpers.createVimJumpHistory();
  plugin.vimJumpOperationToken = 0;
  plugin.vimJumpHistoryChain = Promise.resolve();
  plugin.vimJumpSuppressNativeMirror = false;
  plugin.vimJumpPendingDestinationDeferred = null;
  plugin.pendingTaskMoveJumpDeferred = null;
  plugin.pendingTaskMoveJumpCompletion = null;
  plugin.pendingTaskMoveJumpLandingId = null;
  plugin.taskMoveLandingSeq = 0;
  plugin.pendingOpenTaskJumpCenterDeferred = null;
  plugin.registerEvent = () => {};
  plugin.register = () => {};
  plugin.getFreshnessStampLine = () => null;
  plugin.getFreshnessDateText = () => null;
  return {
    plugin,
    sourceFile,
    destFile,
    sourceEditor,
    destEditor,
    sourceContent,
    destContent,
    openCalls,
    getActive: () => ({ activeFile, activeEditor }),
    setActive: (file, editor) => {
      activeFile = file;
      activeEditor = editor;
    },
  };
}

test("task move records one Vim jump and round-trips without extra writes", async () => {
  notices.length = 0;
  const harness = createTaskMoveVimHistoryHarness();
  const { plugin, sourceFile, destFile, sourceEditor, destEditor, sourceContent } = harness;
  const discovery = helpers.discoverMovableObsidianTaskTargets(sourceContent, 0, 0);
  const session = {
    sourceFile,
    sourcePath: sourceFile.path,
    editor: sourceEditor,
    sourceContent,
    cursor: { line: 0, ch: 4 },
    scroll: null,
    discovery,
  };
  assert.equal(await plugin.commitTaskMoveSession(session, { file: destFile }), true);
  await plugin.vimJumpHistoryChain;
  assert.equal(helpers.getVimJumpHistoryLength(plugin.vimJumpHistory), 2);
  assert.deepEqual(plugin.vimJumpHistory.entries[0], { path: "Source.md", line: 0, ch: 4 });
  const destEntry = plugin.vimJumpHistory.entries[1];
  assert.equal(destEntry.path, "Dest.md");
  assert.equal(destEntry.ch, 0);
  assert.deepEqual(destEditor.getCursor(), { line: destEntry.line, ch: 0 });
  assert.doesNotMatch(sourceEditor.getValue(), /#task Move/);
  assert.match(destEditor.getValue(), /\^move/);
  const beforeSource = sourceEditor.getValue();
  const beforeDest = destEditor.getValue();
  const beforeTransactions = sourceEditor.transactions.length + destEditor.transactions.length;
  assert.equal(await plugin.traverseVimJumpHistory(-1, 1, destEditor), true);
  await plugin.vimJumpHistoryChain;
  assert.equal(plugin.getActiveMarkdownView().file.path, "Source.md");
  assert.deepEqual(plugin.getActiveMarkdownView().editor.getCursor(), {
    line: plugin.vimJumpHistory.entries[0].line,
    ch: plugin.vimJumpHistory.entries[0].ch,
  });
  assert.equal(await plugin.traverseVimJumpHistory(1, 1, sourceEditor), true);
  await plugin.vimJumpHistoryChain;
  assert.equal(plugin.getActiveMarkdownView().file.path, "Dest.md");
  assert.deepEqual(plugin.getActiveMarkdownView().editor.getCursor(), {
    line: destEntry.line,
    ch: destEntry.ch,
  });
  assert.equal(sourceEditor.getValue(), beforeSource);
  assert.equal(destEditor.getValue(), beforeDest);
  assert.equal(sourceEditor.transactions.length + destEditor.transactions.length, beforeTransactions);
});

test("counted task move records a single jump to the first moved task", async () => {
  notices.length = 0;
  const sourceContent = [
    "- [ ] #task One ^one",
    "- [ ] #task Two ^two",
    "- [ ] #task Three ^three",
  ].join("\n");
  const harness = createTaskMoveVimHistoryHarness({ sourceContent, sourceCursor: { line: 0, ch: 2 } });
  const { plugin, sourceFile, destFile, sourceEditor, destEditor } = harness;
  const discovery = helpers.discoverMovableObsidianTaskTargets(sourceContent, 0, 1);
  assert.equal(discovery.valid, true);
  assert.equal(discovery.actualCount, 2);
  const session = {
    sourceFile,
    sourcePath: sourceFile.path,
    editor: sourceEditor,
    sourceContent,
    cursor: { line: 0, ch: 2 },
    scroll: null,
    discovery,
  };
  assert.equal(await plugin.commitTaskMoveSession(session, { file: destFile }), true);
  await plugin.vimJumpHistoryChain;
  assert.equal(helpers.getVimJumpHistoryLength(plugin.vimJumpHistory), 2);
  assert.deepEqual(plugin.vimJumpHistory.entries[0].path, "Source.md");
  assert.equal(plugin.vimJumpHistory.entries[1].path, "Dest.md");
  assert.equal(plugin.vimJumpHistory.entries[1].ch, 0);
  assert.match(destEditor.getValue(), /\^one/);
  assert.match(destEditor.getValue(), /\^two/);
  assert.doesNotMatch(sourceEditor.getValue(), /\^one/);
});

test("deferred task landing re-anchors and records the resolved cursor once", async () => {
  notices.length = 0;
  const harness = createTaskMoveVimHistoryHarness();
  const { plugin, sourceFile, destFile, sourceEditor, destEditor, sourceContent } = harness;
  let releaseOpen = null;
  const openGate = new Promise((resolve) => {
    releaseOpen = resolve;
  });
  const realOpen = harness.plugin.openMarkdownFileWithLeafReuse;
  harness.plugin.openMarkdownFileWithLeafReuse = async (file) => {
    await openGate;
    return realOpen(file);
  };
  const discovery = helpers.discoverMovableObsidianTaskTargets(sourceContent, 0, 0);
  const session = {
    sourceFile,
    sourcePath: sourceFile.path,
    editor: sourceEditor,
    sourceContent,
    cursor: { line: 0, ch: 0 },
    scroll: null,
    discovery,
  };
  const commitPromise = plugin.commitTaskMoveSession(session, { file: destFile });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(helpers.getVimJumpHistoryLength(plugin.vimJumpHistory), 0);
  releaseOpen();
  assert.equal(await commitPromise, true);
  await plugin.vimJumpHistoryChain;
  assert.equal(helpers.getVimJumpHistoryLength(plugin.vimJumpHistory), 2);
  const destEntry = plugin.vimJumpHistory.entries[1];
  assert.equal(destEntry.path, "Dest.md");
  assert.deepEqual(destEditor.getCursor(), { line: destEntry.line, ch: 0 });
});

test("failed task move preserves seeded history including the forward branch", async () => {
  notices.length = 0;
  const harness = createTaskMoveVimHistoryHarness();
  const { plugin, sourceFile, destFile, sourceEditor, sourceContent } = harness;
  helpers.recordVimJumpTransition(plugin.vimJumpHistory, { path: "A.md", line: 0, ch: 0 }, { path: "B.md", line: 0, ch: 0 });
  helpers.recordVimJumpTransition(plugin.vimJumpHistory, { path: "B.md", line: 0, ch: 0 }, { path: "C.md", line: 0, ch: 0 });
  await plugin.traverseVimJumpHistory(-1, 1, sourceEditor);
  await plugin.vimJumpHistoryChain;
  const before = JSON.stringify(plugin.vimJumpHistory);
  const discovery = helpers.discoverMovableObsidianTaskTargets(sourceContent, 0, 0);
  harness.setActive({ path: "Other.md", basename: "Other", extension: "md" }, sourceEditor);
  assert.equal(await plugin.commitTaskMoveSession({
    sourceFile,
    sourcePath: sourceFile.path,
    editor: sourceEditor,
    sourceContent,
    cursor: { line: 0, ch: 0 },
    scroll: null,
    discovery,
  }, { file: destFile }), false);
  await plugin.vimJumpHistoryChain;
  assert.equal(JSON.stringify(plugin.vimJumpHistory), before);
});

test("post-commit open failure keeps the move committed with no jump", async () => {
  notices.length = 0;
  const harness = createTaskMoveVimHistoryHarness({
    openMarkdownFileWithLeafReuse: async () => false,
  });
  const { plugin, sourceFile, destFile, sourceEditor, destEditor, sourceContent } = harness;
  const discovery = helpers.discoverMovableObsidianTaskTargets(sourceContent, 0, 0);
  assert.equal(await plugin.commitTaskMoveSession({
    sourceFile,
    sourcePath: sourceFile.path,
    editor: sourceEditor,
    sourceContent,
    cursor: { line: 0, ch: 0 },
    scroll: null,
    discovery,
  }, { file: destFile }), true);
  await plugin.vimJumpHistoryChain;
  assert.equal(helpers.getVimJumpHistoryLength(plugin.vimJumpHistory), 0);
  assert.doesNotMatch(sourceEditor.getValue(), /#task Move/);
  assert.match(destEditor.getValue(), /\^move/);
  assert.match(notices.at(-1), /Moved 1 task/);
});

test("a newer move supersedes a pending landing without stale placement", async () => {
  notices.length = 0;
  const harness = createTaskMoveVimHistoryHarness({
    openMarkdownFileWithLeafReuse: async () => true,
  });
  const { plugin, destEditor } = harness;
  const origin = { path: "Source.md", line: 0, ch: 0 };
  const context = plugin.createVimJumpContextWithOrigin(origin);
  assert.ok(context);
  const destBefore = destEditor.getCursor();
  let settled = null;
  const completion = {
    resolve: (result) => {
      settled = result;
    },
    token: context.token,
  };
  assert.equal(plugin.jumpOrDeferTaskMoveDestination("Dest.md", { line: 7, text: "x", blockId: null }, 8, completion), false);
  assert.equal(helpers.getVimJumpHistoryLength(plugin.vimJumpHistory), 0);
  plugin.cancelPendingTaskMoveJump();
  await new Promise((resolve) => setTimeout(resolve, 10));
  await plugin.vimJumpHistoryChain;
  assert.ok(settled && settled.ok === false);
  assert.equal(helpers.getVimJumpHistoryLength(plugin.vimJumpHistory), 0);
  assert.deepEqual(destEditor.getCursor(), destBefore);
  assert.equal(plugin.pendingTaskMoveJumpDeferred, null);
  assert.equal(plugin.pendingTaskMoveJumpCompletion, null);
});

test("shared destination helper without a move context records no jump", async () => {
  const editor = new TransactionEditor(
    ["- [ ] #task Existing ^existing", "- [ ] #task Moved ^moved"].join("\n"),
    { line: 0, ch: 0 },
  );
  const destinationFile = { path: "Area.md", basename: "Area", extension: "md" };
  const { plugin } = createTaskMoveDestinationFocusHarness({
    getActiveMarkdownView: () => ({ file: destinationFile, editor }),
  });
  plugin.filePositions = new Map();
  plugin.vimJumpHistory = helpers.createVimJumpHistory();
  plugin.vimJumpOperationToken = 0;
  plugin.vimJumpHistoryChain = Promise.resolve();
  plugin.vimJumpSuppressNativeMirror = false;
  plugin.vimJumpPendingDestinationDeferred = null;
  plugin.pendingTaskMoveJumpDeferred = null;
  plugin.pendingTaskMoveJumpCompletion = null;
  plugin.pendingTaskMoveJumpLandingId = null;
  plugin.taskMoveLandingSeq = 0;
  plugin.pendingOpenTaskJumpCenterDeferred = null;
  const anchor = { line: 1, text: "- [ ] #task Moved ^moved", blockId: "moved" };
  assert.equal(await plugin.focusTaskMoveDestination(destinationFile, anchor), true);
  await plugin.vimJumpHistoryChain;
  assert.equal(helpers.getVimJumpHistoryLength(plugin.vimJumpHistory), 0);
});
