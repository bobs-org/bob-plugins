const assert = require("node:assert/strict");
const test = require("node:test");
const {
  planDependencyStageView,
  dependencyStageRowKey,
  NavigationHotkeysPlugin,
  notices,
  sleep,
  TransactionEditor,
  stubPlugin,
  stubStageModal,
  stubReopen,
} = require("./navigation-dependencies-stage-harness.cjs");

// ---------------------------------------------------------------------------
// nav-mirror-stage-fixes: the hand-edit mirror resolves its owner in burst
// baseline coordinates and maps forward, so an insertion above the owner in
// the same burst never re-aims the lookup at the next sibling.
// ---------------------------------------------------------------------------

function mirrorOffsetOfLine(content, line) {
  const lines = String(content).split("\n");
  let offset = 0;
  for (let index = 0; index < Math.min(line, lines.length - 1); index += 1) {
    offset += lines[index].length + 1;
  }
  return offset;
}

function mirrorFakeDoc(content) {
  return {
    toString: () => String(content),
    lineAt: (offset) => {
      const text = String(content);
      const at = Math.max(0, Math.min(offset, text.length));
      return { number: text.slice(0, at).split("\n").length };
    },
  };
}

function mirrorDeletionUpdate(before, after, fromA, toA) {
  return {
    docChanged: true,
    view: null,
    state: { doc: mirrorFakeDoc(after) },
    startState: { doc: mirrorFakeDoc(before) },
    changes: {
      iterChangedRanges: (callback) => callback(fromA, toA, fromA, fromA),
      mapPos: (pos) => {
        if (pos <= fromA) {
          return pos;
        }
        if (pos >= toA) {
          return pos - (toA - fromA);
        }
        return fromA;
      },
    },
  };
}

function mirrorInsertionUpdate(before, after, at, insertedLength) {
  return {
    docChanged: true,
    view: null,
    state: { doc: mirrorFakeDoc(after) },
    startState: { doc: mirrorFakeDoc(before) },
    changes: {
      iterChangedRanges: (callback) => callback(at, at, at, at + insertedLength),
      mapPos: (pos) => (pos < at ? pos : pos + insertedLength),
    },
  };
}

function mirrorBurstNote() {
  return [
    "# Notes",
    "- [?] #task P [dependsOn:: Tasks__a] ^p",
    "  - ⛓️ **DEPENDS ON:** [[#^a]]",
    "- [ ] #task S [dependsOn:: Tasks__b] ^s",
    "  - ⛓️ **DEPENDS ON:** [[#^b]]",
    "- [x] #task A [id:: Tasks__a] ^a",
    "- [x] #task B [id:: Tasks__b] ^b",
  ].join("\n");
}

async function runMirrorBurst(initial, updates, finalContent) {
  const { plugin } = stubPlugin({ "Tasks.md": initial });
  const editor = new TransactionEditor(initial, { line: 0, ch: 0 });
  plugin.getActiveMarkdownView = () => ({
    editor,
    file: { path: "Tasks.md" },
  });
  for (const [content, update] of updates) {
    editor.content = content;
    plugin.scheduleDependencyHandEditMirrorFromUpdate(update);
  }
  editor.content = finalContent;
  await sleep(1000);
  if (plugin.pendingDependencyMirror) {
    clearTimeout(plugin.pendingDependencyMirror);
    plugin.pendingDependencyMirror = null;
  }
  plugin.pendingDependencyMirrorSnapshot = null;
  return { plugin, editor };
}

function taskLine(content, blockId) {
  return String(content)
    .split("\n")
    .find((line) => line.includes(`^${blockId}`));
}

// Deleting P's Depends-On line and then inserting a line under the heading
// in the same burst clears P's field: the owner stays P in baseline
// coordinates instead of sliding to the next sibling S.
test("stage mirror burst keeps the baseline owner across an insertion above", async () => {
  const initial = mirrorBurstNote();
  const initialLines = initial.split("\n");
  // Update 1: delete P's Depends-On line (line 2) wholesale.
  const deleteFrom = mirrorOffsetOfLine(initial, 2);
  const deleteTo = mirrorOffsetOfLine(initial, 3);
  const mid = [...initialLines.slice(0, 2), ...initialLines.slice(3)].join("\n");
  // Update 2: insert a bullet under the heading (line 1 of the mid content).
  const inserted = "- new bullet\n";
  const insertAt = mirrorOffsetOfLine(mid, 1);
  const finalContent = `${mid.split("\n").slice(0, 1).join("\n")}\n${inserted}${mid.split("\n").slice(1).join("\n")}`;
  const { editor } = await runMirrorBurst(
    initial,
    [
      [mid, mirrorDeletionUpdate(initial, mid, deleteFrom, deleteTo)],
      [finalContent, mirrorInsertionUpdate(mid, finalContent, insertAt, inserted.length)],
    ],
    finalContent,
  );
  assert.match(editor.content, /- new bullet/);
  const parent = taskLine(editor.content, "p");
  assert.ok(parent, "P survives the burst");
  assert.doesNotMatch(parent, /dependsOn/, `P's field is cleared:\n${editor.content}`);
  assert.match(editor.content, /- \[ \] #task P \^p$/m);
  assert.match(editor.content, /⛓️ \*\*DEPENDS ON:\*\* \[\[#\^b\]\]/, "S keeps its line");
});

// Selecting the Depends-On line text (not a vim `dd`) and deleting it,
// then inserting above in the same burst, still clears P's field.
test("stage mirror burst clears on a text-only line deletion", async () => {
  const initial = mirrorBurstNote();
  const initialLines = initial.split("\n");
  // Update 1: delete only the line text, leaving an empty line behind.
  const deleteFrom = mirrorOffsetOfLine(initial, 2);
  const deleteTo = deleteFrom + initialLines[2].length;
  const midLines = initialLines.slice();
  midLines[2] = "";
  const mid = midLines.join("\n");
  // Update 2: insert a bullet under the heading.
  const inserted = "- new bullet\n";
  const insertAt = mirrorOffsetOfLine(mid, 1);
  const finalContent = `${mid.split("\n").slice(0, 1).join("\n")}\n${inserted}${mid.split("\n").slice(1).join("\n")}`;
  const { editor } = await runMirrorBurst(
    initial,
    [
      [mid, mirrorDeletionUpdate(initial, mid, deleteFrom, deleteTo)],
      [finalContent, mirrorInsertionUpdate(mid, finalContent, insertAt, inserted.length)],
    ],
    finalContent,
  );
  const parent = taskLine(editor.content, "p");
  assert.ok(parent, "P survives the burst");
  assert.doesNotMatch(parent, /dependsOn/, `P's field is cleared:\n${editor.content}`);
  assert.match(editor.content, /⛓️ \*\*DEPENDS ON:\*\* \[\[#\^b\]\]/, "S keeps its line");
});

// A lone vim `dd` of P's Depends-On line clears P's field (kept behaviour).
test("stage mirror vim dd clears the deleted line's owner", async () => {
  const initial = mirrorBurstNote();
  const initialLines = initial.split("\n");
  const deleteFrom = mirrorOffsetOfLine(initial, 2);
  const deleteTo = mirrorOffsetOfLine(initial, 3);
  const mid = [...initialLines.slice(0, 2), ...initialLines.slice(3)].join("\n");
  const { editor } = await runMirrorBurst(
    initial,
    [[mid, mirrorDeletionUpdate(initial, mid, deleteFrom, deleteTo)]],
    mid,
  );
  const parent = taskLine(editor.content, "p");
  assert.ok(parent, "P survives the deletion");
  assert.doesNotMatch(parent, /dependsOn/, `P's field is cleared:\n${editor.content}`);
  assert.match(editor.content, /⛓️ \*\*DEPENDS ON:\*\* \[\[#\^b\]\]/, "S keeps its line");
});

// ---------------------------------------------------------------------------
// nav-mirror-stage-fixes: BLOCKED badges never show `waits on 0`.
// ---------------------------------------------------------------------------

function blockedStageView(content, query, dependentLine = 0) {
  const notes = [{ path: "Tasks.md", content }];
  const plugin = new NavigationHotkeysPlugin();
  plugin.collectStageBufferNotes = () => [];
  plugin.readStageTasksCache = () => ({ ready: false, tasks: [] });
  const stage = plugin.buildVaultDependencyStageFromNotes(notes, {
    filePath: "Tasks.md",
    content,
    parentLines: [dependentLine],
  });
  return planDependencyStageView({
    current: [],
    candidates: stage.candidates,
    query,
    dependent: {
      path: "Tasks.md",
      line: dependentLine,
      key: dependencyStageRowKey("Tasks.md", "owner"),
    },
    edges: stage.edges,
    linkedKeys: new Set(),
  });
}

// A Blocked task with no `^blockId` counts its open prerequisite from its
// own Depends-On line: one open target reads `waits on 1`, never `waits on 0`.
test("stage badge counts open prerequisites without a block id", () => {
  const content = [
    "- [ ] #task Owner ^owner",
    "- [?] #task Noid blocked [id:: noid-id]",
    "  - ⛓️ **DEPENDS ON:** [[#^alpha]]",
    "- [ ] #task Alpha ^alpha",
  ].join("\n");
  const view = blockedStageView(content, "Noid");
  const row = view.find((entry) => entry.displayText === "Noid blocked");
  assert.ok(row, "the block-id-less task reaches the stage");
  assert.equal(row.stageSection, "blocked");
  assert.equal(row.waitsOn, 1);
  assert.equal(row.blockedBadge, "🔒 waits on 1");
});

// A Blocked task with no open prerequisite but a future `scheduled` date
// reads `🔒 scheduled YYYY-MM-DD`.
test("stage badge names the future scheduled date with no open prerequisite", () => {
  const content = [
    "- [ ] #task Owner ^owner",
    "- [?] #task Sched [scheduled:: 2999-01-01] ^sched",
  ].join("\n");
  const view = blockedStageView(content, "Sched");
  const row = view.find((entry) => entry.blockId === "sched");
  assert.ok(row, "the scheduled task reaches the stage");
  assert.equal(row.stageSection, "blocked");
  assert.equal(row.waitsOn, null);
  assert.equal(row.blockedBadge, "🔒 scheduled 2999-01-01");
});

// A Blocked task with no open prerequisite and no future schedule reads
// `🔒 blocked`.
test("stage badge reads blocked with nothing waiting and no schedule", () => {
  const content = [
    "- [ ] #task Owner ^owner",
    "- [?] #task Stuck ^stuck",
  ].join("\n");
  const view = blockedStageView(content, "Stuck");
  const row = view.find((entry) => entry.blockId === "stuck");
  assert.ok(row, "the stuck task reaches the stage");
  assert.equal(row.stageSection, "blocked");
  assert.equal(row.waitsOn, null);
  assert.equal(row.blockedBadge, "🔒 blocked");
});

// ---------------------------------------------------------------------------
// nav-mirror-stage-fixes: every stale path refuses with `changed — reopen`
// and reopens the stage fresh, writing nothing.
// ---------------------------------------------------------------------------


// A stale cross-note batch row refuses the whole batch before any write and
// reopens the stage fresh: no partial commit, no skip count.
test("stage vault batch with a stale row refuses and reopens", async () => {
  const owner = "- [ ] #task Parent ^parent";
  const target = "- [ ] #task Target ^target";
  const { plugin, store } = stubPlugin({ "Tasks.md": owner, "Other.md": target });
  const editor = new TransactionEditor(owner, { line: 0, ch: 0 });
  const modal = stubStageModal(plugin, editor, "Tasks.md", 0);
  modal.vaultStage = { files: new Map() };
  const reopened = stubReopen(plugin);
  store.set("Other.md", "- [ ] #task Target edited ^target");
  const batch = {
    propertyName: "dependsOn",
    cursorLineText: owner,
    removals: [],
    readyAdditions: [
      {
        markKey: "Other.md#0",
        path: "Other.md",
        line: 0,
        rawLine: target,
        displayText: "Target",
        existingIdField: null,
        blockId: "target",
      },
    ],
    promptQueue: [],
    promptIndex: 0,
    confirmedById: new Map(),
    reservedIds: new Set(),
    hasVault: true,
  };
  const before = notices.length;
  const applied = await modal.executeVaultDependencyBatch(batch);
  assert.equal(applied, false);
  assert.match(notices[before], /changed — reopen/);
  assert.equal(reopened.length, 1);
  assert.equal(reopened[0].initialProperty, "dependsOn");
  assert.equal(editor.content, owner);
  assert.equal(editor.undoGroups, 0);
  assert.equal(store.get("Other.md"), "- [ ] #task Target edited ^target");
});

