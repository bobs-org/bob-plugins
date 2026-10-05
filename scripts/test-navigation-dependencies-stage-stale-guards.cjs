const assert = require("node:assert/strict");
const test = require("node:test");
const {
  notices,
  TransactionEditor,
  stubPlugin,
  stubStageModal,
  stubReopen,
} = require("./navigation-dependencies-stage-harness.cjs");

// A stale counted vault target refuses with `changed — reopen` and reopens
// the stage fresh instead of reporting "Selected dependency changed".
test("stage counted vault add with a stale target refuses and reopens", async () => {
  const content = [
    "- [ ] #task First ^first",
    "- [ ] #task Target ^target",
  ].join("\n");
  const { plugin } = stubPlugin({ "Tasks.md": content });
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  const modal = stubStageModal(plugin, editor, "Tasks.md", 0);
  const reopened = stubReopen(plugin);
  modal.taskSession = {
    explicit: true,
    targets: [{ line: 0, rawLine: "- [ ] #task First ^first" }],
  };
  editor.content = [
    "- [ ] #task First ^first",
    "- [ ] #task Target edited ^target",
  ].join("\n");
  const before = notices.length;
  const applied = await modal.applyVaultCountedDependencyRef({
    path: "Tasks.md",
    line: 1,
    rawLine: "- [ ] #task Target ^target",
    displayText: "Target",
    blockId: "target",
  });
  assert.equal(applied, false);
  assert.match(notices[before], /changed — reopen/);
  assert.equal(reopened.length, 1);
  assert.doesNotMatch(editor.content, /DEPENDS ON/);
});

// A stale vault-commit write notifies exactly once: the real writer shows
// `changed — reopen`, so the stage only reopens fresh without a second
// notice. The editor is mutated between the stage snapshot and the real
// write, with no fake writer anywhere on the path.
test("stage vault commit with a stale write notifies once and reopens", async () => {
  const content = [
    "- [ ] #task Parent ^parent",
    "- [ ] #task Target ^target",
  ].join("\n");
  const { plugin } = stubPlugin({ "Tasks.md": content });
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  const modal = stubStageModal(plugin, editor, "Tasks.md", 0);
  const reopened = stubReopen(plugin);
  const before = notices.length;
  const pending = modal.commitVaultRefs(
    [{ path: "Tasks.md", blockId: "target" }],
    [],
    { stale: 0, other: 0 },
  );
  const mutated = [
    "- [ ] #task Parent ^parent",
    "- [ ] #task Target edited ^target",
  ].join("\n");
  editor.content = mutated;
  const applied = await pending;
  assert.equal(applied, false);
  const fresh = notices.slice(before);
  assert.equal(
    fresh.filter((notice) => /changed — reopen/.test(notice)).length,
    1,
    `exactly one reopen notice, got: ${JSON.stringify(fresh)}`,
  );
  assert.equal(reopened.length, 1);
  assert.equal(reopened[0].initialProperty, "dependsOn");
  assert.equal(editor.content, mutated);
});

// A stale single-remove write notifies exactly once through the same real
// path: the writer's notice is the only one, and the stage reopens fresh.
test("stage single remove with a stale write notifies once and reopens", async () => {
  const content = [
    "- [ ] #task Parent ^parent",
    "  - ⛓️ **DEPENDS ON:** [[#^target]]",
    "- [ ] #task Target ^target",
  ].join("\n");
  const { plugin } = stubPlugin({ "Tasks.md": content });
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  const modal = stubStageModal(plugin, editor, "Tasks.md", 0);
  const reopened = stubReopen(plugin);
  const before = notices.length;
  const pending = modal.removeSingleDependency({
    path: "Tasks.md",
    blockId: "target",
  });
  const mutated = [
    "- [ ] #task Parent ^parent",
    "  - ⛓️ **DEPENDS ON:** [[#^target]]",
    "- [ ] #task Target edited ^target",
  ].join("\n");
  editor.content = mutated;
  const applied = await pending;
  assert.equal(applied, false);
  const fresh = notices.slice(before);
  assert.equal(
    fresh.filter((notice) => /changed — reopen/.test(notice)).length,
    1,
    `exactly one reopen notice, got: ${JSON.stringify(fresh)}`,
  );
  assert.equal(reopened.length, 1);
  assert.equal(editor.content, mutated);
});

// The `+ id` single guard refuses a changed target and reopens fresh.
test("stage vault single +id guard refuses a stale target", async () => {
  const owner = "- [ ] #task Parent ^parent";
  const target = "- [ ] #task Target";
  const { plugin, store } = stubPlugin({ "Tasks.md": owner, "Other.md": target });
  const editor = new TransactionEditor(owner, { line: 0, ch: 0 });
  const modal = stubStageModal(plugin, editor, "Tasks.md", 0);
  const reopened = stubReopen(plugin);
  modal.pendingVaultSingle = {
    snapshot: {
      path: "Other.md",
      line: 0,
      rawLine: target,
      displayText: "Target",
    },
    reservedIds: new Set(),
  };
  store.set("Other.md", "- [ ] #task Target edited");
  const before = notices.length;
  const applied = await modal.confirmVaultSingleBlockId({ id: "zz-fresh", valid: true });
  assert.equal(applied, false);
  assert.match(notices[before], /changed — reopen/);
  assert.equal(reopened.length, 1);
});

// The counted `+ id` guard refuses a changed target and reopens fresh.
test("stage vault counted +id guard refuses a stale target", async () => {
  const owner = "- [ ] #task First ^first";
  const target = "- [ ] #task Target";
  const { plugin, store } = stubPlugin({ "Tasks.md": owner, "Other.md": target });
  const editor = new TransactionEditor(owner, { line: 0, ch: 0 });
  const modal = stubStageModal(plugin, editor, "Tasks.md", 0);
  const reopened = stubReopen(plugin);
  modal.pendingVaultCounted = {
    snapshot: {
      path: "Other.md",
      line: 0,
      rawLine: target,
      displayText: "Target",
    },
    session: null,
    reservedIds: new Set(),
  };
  store.set("Other.md", "- [ ] #task Target edited");
  const before = notices.length;
  const applied = await modal.confirmVaultCountedBlockId({ id: "zz-fresh", valid: true });
  assert.equal(applied, false);
  assert.match(notices[before], /changed — reopen/);
  assert.equal(reopened.length, 1);
});

// The same-note `+ id` guard refuses a changed target and reopens fresh.
test("stage single +id guard refuses a stale target", async () => {
  const content = [
    "- [ ] #task Parent ^parent",
    "- [ ] #task Target",
  ].join("\n");
  const { plugin } = stubPlugin({ "Tasks.md": content });
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  const modal = stubStageModal(plugin, editor, "Tasks.md", 0);
  const reopened = stubReopen(plugin);
  modal.pendingTask = { line: 1, rawLine: "- [ ] #task Target" };
  editor.content = [
    "- [ ] #task Parent ^parent",
    "- [ ] #task Target edited",
  ].join("\n");
  const before = notices.length;
  const applied = await modal.confirmSingleBlockId({ id: "zz-fresh", valid: true });
  assert.equal(applied, false);
  assert.match(notices[before], /changed — reopen/);
  assert.equal(reopened.length, 1);
  assert.equal(editor.undoGroups, 0);
});

// A concurrent edit during a counted CURRENT remove refuses with
// `changed — reopen` and reopens the stage fresh (§6.4), writing nothing.
test("stage counted remove with a stale write refuses and reopens", async () => {
  const content = [
    "- [ ] #task First [dependsOn:: Tasks__target] ^first",
    "  - ⛓️ **DEPENDS ON:** [[#^target]]",
    "- [ ] #task Second ^second",
    "- [ ] #task Target ^target",
  ].join("\n");
  const { plugin } = stubPlugin({ "Tasks.md": content });
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  const modal = stubStageModal(plugin, editor, "Tasks.md", 0);
  modal.taskSession = {
    explicit: true,
    targets: [
      { line: 0, rawLine: "- [ ] #task First [dependsOn:: Tasks__target] ^first" },
      { line: 2, rawLine: "- [ ] #task Second ^second" },
    ],
  };
  const reopened = stubReopen(plugin);
  const before = notices.length;
  const pending = modal.removeCountedDependency({
    path: "Tasks.md",
    blockId: "target",
    displayText: "Target",
  });
  const mutated = content.replace(
    "- [ ] #task Target ^target",
    "- [ ] #task Target edited ^target",
  );
  editor.content = mutated;
  const applied = await pending;
  assert.equal(applied, false);
  const fresh = notices.slice(before);
  assert.equal(
    fresh.filter((notice) => /changed — reopen/.test(notice)).length,
    1,
    `exactly one reopen notice, got: ${JSON.stringify(fresh)}`,
  );
  assert.equal(reopened.length, 1);
  assert.equal(editor.content, mutated);
});

// The counted CURRENT remove notice counts only sources that changed: with
// one source already unlinked, removing the prerequisite reports one task.
test("stage counted remove counts only changed sources", async () => {
  const content = [
    "- [ ] #task First [dependsOn:: Tasks__target] ^first",
    "  - ⛓️ **DEPENDS ON:** [[#^target]]",
    "- [ ] #task Second ^second",
    "- [ ] #task Target ^target",
  ].join("\n");
  const { plugin } = stubPlugin({ "Tasks.md": content });
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  const modal = stubStageModal(plugin, editor, "Tasks.md", 0);
  modal.taskSession = {
    explicit: true,
    targets: [
      { line: 0, rawLine: "- [ ] #task First [dependsOn:: Tasks__target] ^first" },
      { line: 2, rawLine: "- [ ] #task Second ^second" },
    ],
  };
  const before = notices.length;
  const applied = await modal.removeCountedDependency({
    path: "Tasks.md",
    blockId: "target",
    displayText: "Target",
  });
  assert.equal(applied, true);
  assert.match(notices[before], /⛓ Removed from 1 task/);
  assert.doesNotMatch(editor.content, /DEPENDS ON/);
  assert.doesNotMatch(editor.content, /dependsOn/);
});

// A counted local add on `[?]` sources never recovers, so it reads zero
// extra notes through the real async vault stub.
test("counted local add on [?] sources reads zero extra notes", async () => {
  const content = [
    "- [?] #task First ^first",
    "- [?] #task Second ^second",
    "- [ ] #task Target ^target",
  ].join("\n");
  const { plugin } = stubPlugin({
    "Tasks.md": content,
    "Other.md": "- [ ] #task Other ^other",
  });
  let reads = 0;
  const vault = plugin.app.vault;
  const originalCachedRead = vault.cachedRead;
  vault.cachedRead = async (file) => {
    reads += 1;
    return originalCachedRead(file);
  };
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  plugin.getActiveMarkdownView = () => ({
    editor,
    file: { path: "Tasks.md" },
  });
  const modal = stubStageModal(plugin, editor, "Tasks.md", 0);
  modal.taskSession = {
    explicit: true,
    targets: [
      { line: 0, rawLine: "- [?] #task First ^first" },
      { line: 1, rawLine: "- [?] #task Second ^second" },
    ],
  };
  const applied = await modal.chooseCountedTaskDependency({
    path: "Tasks.md",
    line: 2,
    rawLine: "- [ ] #task Target ^target",
    displayText: "Target",
  });
  assert.equal(applied, true);
  assert.equal(reads, 0, `counted add read ${reads} extra notes`);
  const links = editor.content.match(/⛓️ \*\*DEPENDS ON:\*\* \[\[#\^target\]\]/g) || [];
  assert.equal(links.length, 2, `both sources link the target:\n${editor.content}`);
});

// A counted local toggle-off on a Pomodoro-linked `[?]` source still reads
// the vault snapshot and recovers the source to `[*]`.
test("counted local toggle-off on a Pomodoro-linked [?] source recovers", async () => {
  const content = [
    "- [?] #task First [dependsOn:: Tasks__target] ^first",
    "  - ⛓️ **DEPENDS ON:** [[#^target]]",
    "- [x] #task Target [id:: Tasks__target] ^target",
  ].join("\n");
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const dailyPath = `${now.getFullYear()}/${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.md`;
  const dailyNote = [
    "## Pomodoros",
    "- [ ] 10:00 Focus",
    "  - [[Tasks#^first]]",
  ].join("\n");
  const { plugin } = stubPlugin({ "Tasks.md": content, [dailyPath]: dailyNote });
  let reads = 0;
  const vault = plugin.app.vault;
  const originalCachedRead = vault.cachedRead;
  vault.cachedRead = async (file) => {
    reads += 1;
    return originalCachedRead(file);
  };
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  plugin.getActiveMarkdownView = () => ({
    editor,
    file: { path: "Tasks.md" },
  });
  const modal = stubStageModal(plugin, editor, "Tasks.md", 0);
  modal.taskSession = {
    explicit: true,
    targets: [
      { line: 0, rawLine: "- [?] #task First [dependsOn:: Tasks__target] ^first" },
    ],
  };
  const applied = await modal.chooseCountedTaskDependency({
    path: "Tasks.md",
    line: 2,
    rawLine: "- [x] #task Target [id:: Tasks__target] ^target",
    displayText: "Target",
  });
  assert.equal(applied, true);
  assert.ok(reads > 0, `toggle-off read ${reads} extra notes`);
  assert.doesNotMatch(editor.content, /DEPENDS ON/);
  assert.match(editor.content, /- \[\*\] #task First\b/m);
});

// The vault counted-add notice counts only sources that changed: with one
// source already carrying the link, adding reports one task.
test("stage counted vault add counts only changed sources", async () => {
  const content = [
    "- [ ] #task First ^first",
    "- [?] #task Second [dependsOn:: Tasks__target] ^second",
    "  - ⛓️ **DEPENDS ON:** [[#^target]]",
    "- [ ] #task Target [id:: Tasks__target] ^target",
  ].join("\n");
  const { plugin } = stubPlugin({ "Tasks.md": content });
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  const modal = stubStageModal(plugin, editor, "Tasks.md", 0);
  modal.taskSession = {
    explicit: true,
    targets: [
      { line: 0, rawLine: "- [ ] #task First ^first" },
      { line: 1, rawLine: "- [?] #task Second [dependsOn:: Tasks__target] ^second" },
    ],
  };
  const before = notices.length;
  const applied = await modal.applyVaultCountedDependencyRef({
    path: "Tasks.md",
    line: 3,
    rawLine: "- [ ] #task Target [id:: Tasks__target] ^target",
    displayText: "Target",
    existingIdField: "Tasks__target",
    blockId: "target",
  });
  assert.equal(applied, true);
  assert.match(notices[before], /⛓ Linked 1 task/);
});

// The vault counted-remove notice counts only sources that changed: with
// one source already unlinked, removing reports one task.
test("stage counted vault remove counts only changed sources", async () => {
  const content = [
    "- [ ] #task First [dependsOn:: Tasks__target] ^first",
    "  - ⛓️ **DEPENDS ON:** [[#^target]]",
    "- [ ] #task Second ^second",
    "- [ ] #task Target ^target",
  ].join("\n");
  const { plugin } = stubPlugin({ "Tasks.md": content });
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  const modal = stubStageModal(plugin, editor, "Tasks.md", 0);
  modal.taskSession = {
    explicit: true,
    targets: [
      { line: 0, rawLine: "- [ ] #task First [dependsOn:: Tasks__target] ^first" },
      { line: 2, rawLine: "- [ ] #task Second ^second" },
    ],
  };
  const before = notices.length;
  const applied = await modal.applyVaultCountedDependencyRef({
    path: "Tasks.md",
    line: 3,
    rawLine: "- [ ] #task Target ^target",
    displayText: "Target",
    blockId: "target",
    remove: true,
  });
  assert.equal(applied, true);
  assert.match(notices[before], /⛓ Removed from 1 task/);
});

