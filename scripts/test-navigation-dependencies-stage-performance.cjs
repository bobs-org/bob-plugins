const assert = require("node:assert/strict");
const test = require("node:test");
const {
  helpers,
  collectVaultDependencyCandidates,
  indexDependencyStageNotes,
  resolveDependencyStageCurrent,
  collectDependencyStageEdges,
  planDependencyStageView,
  scanDependencyStageNoteTasks,
  createDependencyNoteSnapshot,
  createDependencySnapshotMap,
  collectVaultDependencyCandidatesFromSnapshots,
  indexDependencyStageNotesFromSnapshots,
  collectDependencyStageEdgesFromSnapshots,
  NavigationHotkeysPlugin,
  sleep,
  TransactionEditor,
  stubPlugin,
  stubStageModal,
} = require("./navigation-dependencies-stage-harness.cjs");

// ---------------------------------------------------------------------------
// dependson_picker_freeze: opening-path regression. One parsed snapshot per
// note is shared across candidate collection, indexing, edge construction,
// CURRENT resolution, and blocked badges; the sync build stays linear.
// ---------------------------------------------------------------------------

function freezeLargeContent(count, { crlf = false } = {}) {
  const lines = [
    "# Tasks",
    "",
    "Substantial non-task prose that increases line counts beyond task rows,",
    "mirroring real vault notes with paragraphs between tasks.",
    "",
  ];
  for (let i = 0; i < count; i += 1) {
    lines.push(`- [ ] #task Task ${i} ^t${i}`);
    if (i % 10 === 0) {
      lines.push(`  Continued prose for task ${i} without any dependency child.`);
    }
    if (i % 50 === 0) {
      lines.push("");
    }
  }
  const text = lines.join("\n");
  return crlf ? text.replace(/\n/g, "\r\n") : text;
}

function freezeBuildStage(content, parentLines = [2]) {
  const notes = [{ path: "Tasks.md", content }];
  const proto = NavigationHotkeysPlugin.prototype;
  const offline = {
    collectStageBufferNotes: () => new Map(),
    readStageTasksCache: () => ({ ready: false, tasks: [] }),
  };
  return proto.buildVaultDependencyStageFromNotes.call(offline, notes, {
    filePath: "Tasks.md",
    content,
    parentLines,
  });
}

test("stage opening builds 200/400/1000-task notes without cubic growth", () => {
  const timed = (count) => {
    const content = freezeLargeContent(count);
    const start = process.hrtime.bigint();
    const stage = freezeBuildStage(content);
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    return { stage, ms };
  };
  const small = timed(200);
  const medium = timed(400);
  const large = timed(1000);
  assert.equal(small.stage.candidates.length, 200);
  assert.equal(medium.stage.candidates.length, 400);
  assert.equal(large.stage.candidates.length, 1000);
  assert.ok(
    medium.ms < 250,
    `400-task sync build took ${medium.ms.toFixed(1)} ms (budget 250 ms)`,
  );
  assert.ok(
    large.ms < 1000,
    `1000-task sync build took ${large.ms.toFixed(1)} ms (budget 1000 ms)`,
  );
  assert.ok(
    medium.ms < Math.max(60, small.ms * 6),
    `400-task build ${medium.ms.toFixed(1)} ms grows too fast over 200-task ${small.ms.toFixed(1)} ms`,
  );
  assert.ok(
    large.ms < Math.max(120, medium.ms * 6),
    `1000-task build ${large.ms.toFixed(1)} ms grows too fast over 400-task ${medium.ms.toFixed(1)} ms`,
  );
});

test("stage snapshots match standalone parsing across grammar vectors", () => {
  const vectors = [
    "- [ ] #task Plain ^plain\n",
    "- [ ] #task Plain CRLF ^plain\r\n- [ ] #task Second ^second\r\n",
    [
      "---",
      "title: test",
      "- [ ] #task Frontmatter fake ^fake",
      "---",
      "- [ ] #task Real ^real",
    ].join("\n"),
    ["```", "- [ ] #task Fenced ^fenced", "```", "- [ ] #task Real ^real"].join(
      "\n",
    ),
    [
      "- [?] #task Parent ^parent",
      "  - ⛓️ **DEPENDS ON:** [[#^child]]",
      "- [ ] #task Child ^child",
    ].join("\n"),
    [
      "- [?] #task Nested ^nested",
      "  - ⛓️ **DEPENDS ON:** [[#^deep]]",
      "- [ ] #task Deep ^deep",
      "    - nested grandchild prose",
    ].join("\n"),
    [
      "- [?] #task Legacy ^legacy [dependsOn:: Tasks__child]",
      "  - [[#^child]]",
      "- [ ] #task Child [id:: Tasks__child] ^child",
    ].join("\n"),
    [
      "- [?] #task Custom ^custom [dependsOn:: Tasks__mine]",
      "  - ⛓️ **DEPENDS ON:** [[other#^mine]]",
      "- [ ] #task Mine [id:: Tasks__mine] ^mine",
    ].join("\n"),
    [
      "- [?] #task Bad ^bad",
      "  - ⛓️ **DEPENDS ON:** not a link line",
      "- [ ] #task Other ^other",
    ].join("\n"),
    ["## Section One", "- [ ] #task In section ^in-section"].join("\n"),
  ];
  for (const content of vectors) {
    const snapshot = createDependencyNoteSnapshot(content);
    assert.deepEqual(
      [...snapshot.entries],
      [...scanDependencyStageNoteTasks(content)],
      `snapshot entries match standalone for: ${JSON.stringify(content.slice(0, 60))}`,
    );
    const notes = [{ path: "Tasks.md", content }];
    const snapshots = createDependencySnapshotMap(notes);
    assert.deepEqual(
      collectVaultDependencyCandidates(notes, {}),
      collectVaultDependencyCandidatesFromSnapshots(snapshots, {}),
      "candidate pools match",
    );
    const standaloneIndex = indexDependencyStageNotes(notes);
    const snapshotIndex = indexDependencyStageNotesFromSnapshots(snapshots);
    assert.equal(
      snapshotIndex.byKey.size,
      standaloneIndex.byKey.size,
      "index key counts match",
    );
    assert.deepEqual(
      [...snapshotIndex.byKey.keys()].sort(),
      [...standaloneIndex.byKey.keys()].sort(),
      "index keys match",
    );
    const standaloneEdges = collectDependencyStageEdges(notes, standaloneIndex);
    const snapshotEdges = collectDependencyStageEdgesFromSnapshots(
      snapshots,
      snapshotIndex,
    );
    assert.deepEqual(
      [...snapshotEdges].sort(),
      [...standaloneEdges].sort(),
      "edge graphs match",
    );
  }
  const first = "- [ ] #task One ^one\n";
  const second = "- [ ] #task Two ^two\n";
  assert.notDeepEqual(
    [...createDependencyNoteSnapshot(first).entries],
    [...createDependencyNoteSnapshot(second).entries],
    "changed content between builds never reuses a stale snapshot",
  );
});

test("stage Warm-empty cache is ready without a vault fallback", () => {
  const content = "- [ ] #task Owner ^owner\n- [ ] #task Buffer task ^buffer\n";
  const notes = [{ path: "Tasks.md", content }];
  const proto = NavigationHotkeysPlugin.prototype;
  const warmEmpty = {
    collectStageBufferNotes: () => new Map(),
    readStageTasksCache: () => ({ ready: true, tasks: [] }),
  };
  const stage = proto.buildVaultDependencyStageFromNotes.call(warmEmpty, notes, {
    filePath: "Tasks.md",
    content,
    parentLines: [0],
  });
  assert.equal(stage.cacheReady, true);
  assert.ok(
    stage.candidates.some((row) => row.blockId === "buffer"),
    "open-buffer tasks still participate when the Warm cache is empty",
  );
});

test("stage opening renders cross-note results with zero writes and cap", async () => {
  const ownerLines = ["- [ ] #task Owner ^owner"];
  for (let i = 0; i < 30; i += 1) {
    ownerLines.push(`- [ ] #task Sibling ${i} ^sibling-${i}`);
  }
  const owner = ownerLines.join("\n");
  const farLines = [];
  for (let i = 0; i < 70; i += 1) {
    farLines.push(`- [/] #task Far task ${i} ^far-${i}`);
  }
  const far = farLines.join("\n");
  const files = { "Tasks.md": owner, "Far.md": far };
  const { plugin, store } = stubPlugin(files);
  plugin.app.plugins = {
    plugins: { "obsidian-tasks-plugin": { getState: () => "Warm", getTasks: () => [] } },
  };
  const beforeStore = new Map(store);
  const editor = new TransactionEditor(owner, { line: 0, ch: 0 });
  plugin.getActiveMarkdownView = () => ({ editor, file: { path: "Tasks.md" } });
  plugin.collectStageBufferNotes = () =>
    new Map([
      ["Tasks.md", editor.getValue()],
      ["Far.md", far],
    ]);
  const modal = stubStageModal(plugin, editor, "Tasks.md", 0);
  modal.selectedPropertyItem = {
    property: { name: "dependsOn", values: "local_task_id" },
  };
  const undoBefore = editor.undoGroups;
  modal.showValueStage(modal.selectedPropertyItem);
  await sleep(25);
  assert.ok(modal.vaultStage, "the production builder opens a vault stage");
  assert.ok(modal.vaultStage.candidates.length > 60, "the pool exceeds the row cap");
  const view = planDependencyStageView({
    current: modal.vaultStage.current,
    candidates: modal.vaultStage.candidates,
    query: "Far task 69",
    dependent: modal.vaultStage.dependent,
    edges: modal.vaultStage.edges,
    linkedKeys: modal.vaultStage.linkedKeys,
    sourceValueSets: modal.vaultStage.sourceValueSets,
  });
  assert.ok(
    view.some((row) => row.blockId === "far-69"),
    "search reaches a cross-note candidate",
  );
  const capped = planDependencyStageView({
    current: modal.vaultStage.current,
    candidates: modal.vaultStage.candidates,
    query: "Far task",
    dependent: modal.vaultStage.dependent,
    edges: modal.vaultStage.edges,
    linkedKeys: modal.vaultStage.linkedKeys,
    sourceValueSets: modal.vaultStage.sourceValueSets,
  });
  assert.ok(capped.length <= 61, `row cap holds (got ${capped.length})`);
  modal.modalEl = { removeClass: () => {} };
  modal.contentEl = { empty: () => {} };
  plugin.activeBulletPropertyPicker = modal;
  modal.onClose();
  assert.equal(editor.content, owner, "opening and dismissing writes no bytes");
  assert.equal(editor.undoGroups, undoBefore, "no undo groups are created");
  assert.deepEqual([...store.entries()], [...beforeStore.entries()]);
});

test("stage CURRENT covers same-note, cross-note, blocked, and counted parents", () => {
  const content = [
    "- [?] #task First ^first",
    "  - ⛓️ **DEPENDS ON:** [[#^target]]",
    "- [?] #task Second ^second",
    "  - ⛓️ **DEPENDS ON:** [[other#^target]]",
    "- [ ] #task Target ^target",
  ].join("\n");
  const other = "- [ ] #task Target ^target\n";
  const notes = [
    { path: "Tasks.md", content },
    { path: "other.md", content: other },
  ];
  const snapshots = createDependencySnapshotMap(notes);
  const index = indexDependencyStageNotesFromSnapshots(snapshots);
  const ownerSnapshot = snapshots.get("Tasks.md");
  const same = resolveDependencyStageCurrent(content, 0, "Tasks.md", index, ownerSnapshot);
  assert.equal(same.ok, true);
  assert.equal(same.rows[0].path, "Tasks.md");
  const cross = resolveDependencyStageCurrent(content, 2, "Tasks.md", index, ownerSnapshot);
  assert.equal(cross.rows[0].path, "other.md");
  const proto = NavigationHotkeysPlugin.prototype;
  const offline = {
    collectStageBufferNotes: () => new Map(),
    readStageTasksCache: () => ({ ready: false, tasks: [] }),
  };
  const stage = proto.buildVaultDependencyStageFromNotes.call(offline, notes, {
    filePath: "Tasks.md",
    content,
    parentLines: [0, 2],
  });
  assert.deepEqual([...stage.parentLines].sort(), [0, 2]);
  assert.equal(stage.current.length, 2, "counted parents keep every CURRENT row");
  const single = proto.buildVaultDependencyStageFromNotes.call(offline, notes, {
    filePath: "Tasks.md",
    content,
    parentLines: [0],
  });
  const blocked = single.candidates.find((row) => row.blockId === "second");
  assert.ok(blocked && blocked.blocked, "blocked candidates stay flagged");
  assert.equal(blocked.openCount, 1);
});

test("stage collections reuse one snapshot per parent", () => {
  const content = [
    "- [?] #task Parent ^parent",
    "  - ⛓️ **DEPENDS ON:** [[#^child]]",
    "- [ ] #task Child ^child",
  ].join("\n");
  const snapshot = createDependencyNoteSnapshot(content);
  const { collectDependencyNavigationBullets: collect } = helpers;
  const one = collect(snapshot.text, 0, [], snapshot);
  const two = collect(snapshot.text, 0, [], snapshot);
  assert.ok(one.targets.length === 1, "the parent links one target");
  assert.deepEqual(one, two, "repeated parents produce identical collections");
  assert.equal(
    snapshot.identities,
    null,
    "managed-only parents never build the legacy identity map",
  );
  const legacyContent = [
    "- [?] #task Legacy ^legacy [dependsOn:: Tasks__child]",
    "  - [[#^child]]",
    "- [ ] #task Child [id:: Tasks__child] ^child",
  ].join("\n");
  const legacySnapshot = createDependencyNoteSnapshot(legacyContent);
  const legacy = collect(legacySnapshot.text, 0, [], legacySnapshot);
  assert.ok(legacy.targets.length === 1, "the legacy parent links one target");
  assert.ok(legacySnapshot.identities instanceof Map);
  assert.equal(legacySnapshot.identities.get("child"), "Tasks__child");
  const again = collect(legacySnapshot.text, 0, [], legacySnapshot);
  assert.deepEqual(again, legacy, "the cached parent reuses its collection");
});

test("stage cold refresh yields, preserves state, and performs no search reads", async () => {
  const owner = "- [ ] #task Owner ^owner\n";
  const vaultFiles = { "Tasks.md": owner };
  for (let i = 0; i < 40; i += 1) {
    vaultFiles[`Note${i}.md`] = `- [ ] #task Vault task ${i} ^vault-${i}\n`;
  }
  const { plugin } = stubPlugin(vaultFiles);
  let reads = 0;
  const vault = plugin.app.vault;
  const originalRead = vault.cachedRead;
  vault.cachedRead = async (file) => {
    reads += 1;
    await sleep(2);
    return originalRead(file);
  };
  plugin.collectStageBufferNotes = () => new Map([["Tasks.md", owner]]);
  plugin.readStageTasksCache = () => ({ ready: false, tasks: [] });
  const editor = new TransactionEditor(owner, { line: 0, ch: 0 });
  const modal = stubStageModal(plugin, editor, "Tasks.md", 0);
  modal.selectedPropertyItem = {
    property: { name: "dependsOn", values: "local_task_id" },
  };
  modal.showValueStage(modal.selectedPropertyItem);
  await sleep(10);
  const opening = modal.vaultStage;
  assert.ok(opening && !opening.cacheReady, "cold open starts from buffers");
  modal.markedLines = new Set();
  const seedView = planDependencyStageView({
    current: opening.current,
    candidates: opening.candidates,
    query: "",
    dependent: opening.dependent,
    edges: opening.edges,
    linkedKeys: opening.linkedKeys,
    sourceValueSets: opening.sourceValueSets,
  });
  const seedRow = seedView.find((row) => !row.disabled && row.stageSection !== "current");
  if (seedRow) {
    const key = `${seedRow.path}#${seedRow.line}`;
    modal.taskItemsByLine.set(key, seedRow);
    modal.markedLines.add(key);
  }
  const markedBefore = new Set(modal.markedLines);
  modal.getQuery = () => "vault";
  let heartbeats = 0;
  const heartbeat = setInterval(() => {
    heartbeats += 1;
  }, 5);
  const readsBeforeRefresh = reads;
  await plugin.refreshVaultDependencyStage(modal, opening);
  clearInterval(heartbeat);
  assert.ok(heartbeats > 0, "the event loop beats during the many-note fallback scan");
  assert.ok(modal.vaultStage !== opening, "the vault scan refreshes the open stage");
  assert.deepEqual(
    [...modal.vaultStage.parentLines],
    [...opening.parentLines],
    "the complete parent set survives the refresh",
  );
  assert.deepEqual([...modal.markedLines], [...markedBefore], "valid marks survive");
  assert.equal(modal.getQuery(), "vault", "the query survives the refresh");
  const readsAfterRefresh = reads;
  planDependencyStageView({
    current: modal.vaultStage.current,
    candidates: modal.vaultStage.candidates,
    query: "vault task 3",
    dependent: modal.vaultStage.dependent,
    edges: modal.vaultStage.edges,
    linkedKeys: modal.vaultStage.linkedKeys,
    sourceValueSets: modal.vaultStage.sourceValueSets,
  });
  assert.equal(reads, readsAfterRefresh, "search performs no disk reads");
  assert.ok(readsAfterRefresh > readsBeforeRefresh, "the fallback actually scanned");
  modal.modalEl = { removeClass: () => {} };
  modal.contentEl = { empty: () => {} };
  plugin.activeBulletPropertyPicker = modal;
  modal.onClose();
});

test("stage cold refresh abandons after dismissal or replacement", async () => {
  const owner = "- [ ] #task Owner ^owner\n";
  const vaultFiles = { "Tasks.md": owner };
  for (let i = 0; i < 30; i += 1) {
    vaultFiles[`Slow${i}.md`] = `- [ ] #task Slow ${i} ^slow-${i}\n`;
  }
  const makeHarness = () => {
    const harn = stubPlugin(vaultFiles);
    harn.plugin.collectStageBufferNotes = () => new Map([["Tasks.md", owner]]);
    harn.plugin.readStageTasksCache = () => ({ ready: false, tasks: [] });
    const ed = new TransactionEditor(owner, { line: 0, ch: 0 });
    const mo = stubStageModal(harn.plugin, ed, "Tasks.md", 0);
    mo.selectedPropertyItem = {
      property: { name: "dependsOn", values: "local_task_id" },
    };
    mo.showValueStage(mo.selectedPropertyItem);
    return { harn, ed, mo };
  };
  {
    const { harn, mo } = makeHarness();
    await sleep(10);
    const opening = mo.vaultStage;
    const vault = harn.plugin.app.vault;
    const originalRead = vault.cachedRead;
    vault.cachedRead = async (file) => {
      await sleep(15);
      return originalRead(file);
    };
    const pending = harn.plugin.refreshVaultDependencyStage(mo, opening);
    await sleep(10);
    mo.modalEl = { removeClass: () => {} };
    mo.contentEl = { empty: () => {} };
    harn.plugin.activeBulletPropertyPicker = mo;
    mo.onClose();
    await pending;
    assert.equal(mo.vaultStage, opening, "dismissal never paints a newer pool");
  }
  {
    const { harn, mo } = makeHarness();
    await sleep(10);
    const opening = mo.vaultStage;
    const vault = harn.plugin.app.vault;
    const originalRead = vault.cachedRead;
    vault.cachedRead = async (file) => {
      await sleep(15);
      return originalRead(file);
    };
    const first = harn.plugin.refreshVaultDependencyStage(mo, opening);
    await sleep(10);
    mo.showValueStage(mo.selectedPropertyItem);
    const replaced = mo.vaultStage;
    assert.notEqual(replaced, opening, "reopening replaces the stage");
    await first;
    assert.equal(mo.vaultStage, replaced, "the obsolete scan never paints");
    mo.modalEl = { removeClass: () => {} };
    mo.contentEl = { empty: () => {} };
    harn.plugin.activeBulletPropertyPicker = mo;
    mo.onClose();
  }
});

test("stage 400-task opening finishes in a child process before the parent timeout", () => {
  const { spawnSync } = require("node:child_process");
  const script = [
    "const Module=require('node:module');",
    "const o=Module._load;",
    "Module._load=function(r,p,i){if(r==='obsidian')return{MarkdownView:class{},Modal:class{},Notice:class{},Plugin:class{},parseYaml:()=>({})};if(r===\"@codemirror/view\")return{EditorView:class{}};return o.call(this,r,p,i);};",
    "const P=require('./plugins/bob-navigation-hotkeys/main.js');",
    "const lines=['# Tasks',''];",
    "for(let i=0;i<400;i++){lines.push(`- [ ] #task Task ${i} ^t${i}`);}",
    "const content=lines.join('\\n');",
    "const s=P.helpers.createDependencyNoteSnapshot(content);",
    "if(s.entries.length<400)process.exit(2);",
    "const m=new Map([['Tasks.md',s]]);",
    "const c=P.helpers.collectVaultDependencyCandidatesFromSnapshots(m,{});",
    "if(c.length!==400)process.exit(3);",
  ].join("\n");
  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: process.cwd(),
    timeout: 15000,
  });
  assert.equal(result.error, undefined, `child spawn failed: ${result.error}`);
  assert.equal(result.status, 0, `child exit ${result.status}: ${result.stderr}`);
});
