const assert = require("node:assert/strict");
const test = require("node:test");
const {
  dependencyStageRank,
  collectVaultDependencyCandidates,
  indexDependencyStageNotes,
  collectDependencyStageEdges,
  findDependencyStageCycle,
  compareDependencyStageCanonical,
  planDependencyStageView,
  resolveDependencyStageEntry,
  dependencyStageRowKey,
  createLinkPickerPropertyItems,
  describeRemovedDependencyTarget,
  buildDependencyEditNotice,
  notices,
  NavigationHotkeysPlugin,
  TransactionEditor,
  stubPlugin,
  stubStageModal,
  stubRowEl,
  BulletPropertyPickerModal,
  validateBulletPropertyConfig,
} = require("./navigation-dependencies-stage-harness.cjs");

test("stage entry resolves the line itself and refuses prose", () => {
  const content = [
    "- [?] #task Dependent ^dependent",
    "  - ⛓️ **DEPENDS ON:** [[#^open-one]]",
    "- [ ] #task Open one ^open-one",
    "",
    "plain prose",
  ].join("\n");
  const onLine = resolveDependencyStageEntry(content, 1);
  assert.equal(onLine.ok, true);
  assert.equal(onLine.parentLine, 0);
  assert.equal(onLine.skipPropertyStep, true);
  assert.equal(onLine.lineKind, "depends-on");
  const blocksContent = [
    "- [ ] #task Owner ^owner",
    "  - 🧱 **BLOCKS:** [[#^dependent]]",
    "- [?] #task Dependent ^dependent",
  ].join("\n");
  const onBlocks = resolveDependencyStageEntry(blocksContent, 1);
  assert.equal(onBlocks.ok, true);
  assert.equal(onBlocks.parentLine, 0);
  assert.equal(onBlocks.lineKind, "blocks");
  const onTask = resolveDependencyStageEntry(content, 0);
  assert.equal(onTask.ok, true);
  assert.equal(onTask.skipPropertyStep, false);
  const onProse = resolveDependencyStageEntry(content, 4);
  assert.equal(onProse.ok, false);
});

test("Ctrl+Shift+P on a BLOCKS line opens the owner's Blocks stage directly", () => {
  const content = [
    "- [ ] #task Owner ^owner",
    "  - 🧱 **BLOCKS:** [[#^dependent]]",
    "- [?] #task Dependent ^dependent",
  ].join("\n");
  const { plugin } = stubPlugin({ "Tasks.md": content });
  const editor = new TransactionEditor(content, { line: 1, ch: 20 });
  plugin.getActiveMarkdownView = () => ({
    file: { path: "Tasks.md" },
    editor,
  });
  const calls = [];
  plugin.openBulletPropertyPicker = (receivedEditor, options) => {
    calls.push({ receivedEditor, options });
    return true;
  };

  assert.equal(plugin.openDependencyStageAtCursor(editor), true);
  assert.deepEqual(editor.getCursor(), { line: 0, ch: 0 });
  assert.deepEqual(calls, [
    { receivedEditor: editor, options: { reopenBlocksStage: true } },
  ]);
});

// Drives the real `set-bullet-property` hotkey path
// (`openBulletPropertyPicker(editor)` with no options): the first call runs
// the production redirect, nested calls are recorded.
function hotkeyPicker(content, line, hotkeyOptions) {
  const { plugin } = stubPlugin({ "Tasks.md": content });
  const editor = new TransactionEditor(content, { line, ch: 4 });
  plugin.getActiveMarkdownView = () => ({ file: { path: "Tasks.md" }, editor });
  const original = plugin.openBulletPropertyPicker.bind(plugin);
  const calls = [];
  plugin.openBulletPropertyPicker = (receivedEditor, options = {}) => {
    calls.push(options);
    return calls.length === 1 ? original(receivedEditor, options) : true;
  };
  const linkPicker = [];
  plugin.openLinkPicker = async (_editor, options) => {
    linkPicker.push(options);
    return true;
  };
  const opened = [];
  const originalOpen = BulletPropertyPickerModal.prototype.open;
  BulletPropertyPickerModal.prototype.open = function openStub() {
    opened.push(this);
  };
  try {
    const result = plugin.openBulletPropertyPicker(editor, hotkeyOptions);
    return { result, calls, editor, linkPicker, opened };
  } finally {
    BulletPropertyPickerModal.prototype.open = originalOpen;
  }
}

test("Ctrl+Shift+P hotkey path on a BLOCKS line opens the owner's Blocks stage directly", () => {
  const content = [
    "- [ ] #task Owner ^owner",
    "  - 🧱 **BLOCKS:** [[#^dependent]]",
    "- [?] #task Dependent ^dependent",
  ].join("\n");
  const { calls, editor } = hotkeyPicker(content, 1);
  assert.deepEqual(editor.getCursor(), { line: 0, ch: 0 });
  assert.deepEqual(calls, [{}, { reopenBlocksStage: true }]);
});

test("Ctrl+Shift+Alt+B on a BLOCKS or Depends-On line opens the owner's Blocks stage", () => {
  const content = [
    "- [?] #task Owner ^owner",
    "  - ⛓️ **DEPENDS ON:** [[#^other]]",
    "  - 🧱 **BLOCKS:** [[#^dependent]]",
    "- [ ] #task Other ^other",
    "- [?] #task Dependent ^dependent",
  ].join("\n");
  for (const line of [1, 2]) {
    const { calls } = hotkeyPicker(content, line, { initialTaskCardRow: "blocks" });
    assert.equal(calls.length, 2, `line ${line}`);
    assert.equal(calls[1].reopenBlocksStage, true, `line ${line}`);
  }
});

test("Ctrl+Shift+P on a Depends-On line is unchanged forward behavior", () => {
  const content = [
    "- [?] #task Owner ^owner",
    "  - ⛓️ **DEPENDS ON:** [[#^other]]",
    "- [ ] #task Other ^other",
  ].join("\n");
  const { calls, editor } = hotkeyPicker(content, 1);
  assert.deepEqual(editor.getCursor(), { line: 0, ch: 0 });
  assert.deepEqual(calls, [{}, { initialProperty: "dependsOn" }]);
});

test("Ctrl+Shift+P on a plain child bullet and a nested Task Link are unchanged (3e359a6)", () => {
  const content = [
    "- [ ] #task Owner ^owner",
    "  - a plain note about the task",
    "  - [[Other#^other]]",
  ].join("\n");
  // The picker needs a property config; the redirect decision does not.
  const config = validateBulletPropertyConfig({
    properties: [{ name: "dependsOn", values: ["x"] }],
  });
  const plain = hotkeyPicker(content, 1, { config });
  assert.equal(plain.calls.length, 1, "no redirect to the owner");
  assert.deepEqual(plain.editor.getCursor(), { line: 1, ch: 4 });
  assert.equal(plain.opened.length, 1, "the picker opens on the bullet itself");
  const link = hotkeyPicker(content, 2);
  assert.equal(link.calls.length, 1, "no redirect to the owner");
  assert.deepEqual(link.editor.getCursor(), { line: 2, ch: 4 });
  assert.equal(link.linkPicker.length, 1, "a nested Task Link reaches the link picker");
  assert.equal(link.opened.length, 0);
  const counted = hotkeyPicker(content, 1, { config, initialTaskCardRow: "blocks" });
  assert.equal(counted.calls.length, 1, "Ctrl+Shift+Alt+B on a plain bullet is not redirected");
});

test("forward counted mixed row in BLOCKED keeps the waits-on badge (3e359a6 order)", () => {
  const { plugin } = stubPlugin({ "Tasks.md": "- [ ] #task Owner ^owner" });
  const editor = new TransactionEditor("- [ ] #task Owner ^owner", { line: 0, ch: 0 });
  const modal = stubStageModal(plugin, editor, "Tasks.md", 0);
  const render = (item) => {
    const rowEl = stubRowEl();
    BulletPropertyPickerModal.prototype.renderTaskValueItem.call(modal, item, rowEl, "");
    const texts = [];
    const walk = (el) => {
      if (el.text) texts.push(el.text);
      el.children.forEach(walk);
    };
    walk(rowEl);
    return texts.join(" | ");
  };
  const base = {
    kind: "local-task",
    path: "B.md",
    line: 0,
    blockId: "b",
    status: "?",
    displayText: "Blocked task",
    text: "Blocked task",
    stageSection: "blocked",
    blockedBadge: "🔒 waits on 2",
    waitsOn: 2,
    linkState: "mixed",
    linkedSourceCount: 1,
    sourceCount: 2,
    alreadyLinked: false,
  };
  assert.match(render(base), /🔒 waits on 2/);
  assert.doesNotMatch(render(base), /1\/2 depend/);
  assert.match(
    render({ ...base, stageSection: "results", blockedBadge: null, waitsOn: null }),
    /1\/2 depend/,
  );
  modal.blocksStage = true;
  assert.match(render(base), /1\/2 block/);
});

test("api.blocks opens the stage and removes only a listed dependent", async () => {
  const ownerContent = [
    "- [ ] #task Owner ^owner",
    "  - 🧱 **BLOCKS:** [[dependent#^dependent]]",
  ].join("\n");
  const dependentContent = [
    "- [?] #task Dependent ^dependent",
    "  - ⛓️ **DEPENDS ON:** [[owner#^owner]]",
  ].join("\n");
  const { plugin } = stubPlugin({
    "owner.md": ownerContent,
    "dependent.md": dependentContent,
  });
  const editor = new TransactionEditor(ownerContent, { line: 0, ch: 0 });
  plugin.getActiveMarkdownView = () => ({ file: { path: "owner.md" }, editor });
  const pickerCalls = [];
  plugin.openBulletPropertyPicker = (receivedEditor, options) => {
    pickerCalls.push({ receivedEditor, options });
    return true;
  };
  const writes = [];
  plugin.applyBlocksEdit = async (args) => {
    writes.push(args);
    return { ok: true, notice: "🧱 No longer blocks Dependent" };
  };
  const api = NavigationHotkeysPlugin.helpers.createDependencyNavApi(plugin);
  assert.deepEqual(await api.blocks.openStage({ path: "owner.md", line: 1 }), {
    ok: true,
  });
  assert.deepEqual(pickerCalls, [
    { receivedEditor: editor, options: { reopenBlocksStage: true } },
  ]);
  assert.deepEqual(
    await api.blocks.removeDependent(
      { path: "owner.md", line: 0 },
      { path: "dependent.md", blockId: "dependent" },
    ),
    { ok: true },
  );
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].sources, [
    { path: "owner.md", line: 0, blockId: "owner" },
  ]);
  assert.deepEqual(writes[0].remove, [
    { path: "dependent.md", line: 0, blockId: "dependent" },
  ]);

  const absent = await api.blocks.removeDependent(
    { path: "owner.md", line: 0 },
    { path: "dependent.md", blockId: "missing" },
  );
  assert.deepEqual(absent, { ok: false, reason: "not-a-dependent" });
  assert.equal(writes.length, 1);
});

test("api.blocks removeDependent on an owner with no ^id is not-a-dependent", async () => {
  const ownerContent = "- [ ] #task Owner without an id";
  const { plugin } = stubPlugin({
    "owner.md": ownerContent,
    "dependent.md": "- [?] #task Dependent ^dependent",
  });
  const editor = new TransactionEditor(ownerContent, { line: 0, ch: 0 });
  plugin.getActiveMarkdownView = () => ({ file: { path: "owner.md" }, editor });
  const writes = [];
  plugin.applyBlocksEdit = async (args) => {
    writes.push(args);
    return { ok: true, notice: null };
  };
  const api = NavigationHotkeysPlugin.helpers.createDependencyNavApi(plugin);
  assert.deepEqual(
    await api.blocks.removeDependent(
      { path: "owner.md", line: 0 },
      { path: "dependent.md", blockId: "dependent" },
    ),
    { ok: false, reason: "not-a-dependent" },
  );
  assert.equal(writes.length, 0);
});

test("stage canonical order ranks #hide last ahead of the lane", () => {
  const dependentPath = "body.md";
  const hiddenPending = {
    path: "cash.md",
    line: 1,
    status: "/",
    hidden: true,
  };
  const visibleReady = {
    path: "cash.md",
    line: 2,
    status: " ",
    hidden: false,
  };
  assert.ok(
    compareDependencyStageCanonical(hiddenPending, visibleReady, dependentPath) > 0,
    "a hidden In Progress task sorts after a visible Ready one",
  );
  assert.ok(
    compareDependencyStageCanonical(visibleReady, hiddenPending, dependentPath) < 0,
  );
});

test("stage empty query shows same-note plus In Progress and Next only", () => {
  const notes = [
    {
      path: "body.md",
      content: [
        "- [ ] #task Dependent ^dependent",
        "- [ ] #task Same note sibling ^sibling",
      ].join("\n"),
    },
    {
      path: "cash.md",
      content: [
        "- [ ] #task Ready elsewhere ^ready-else",
        "- [/] #task Pending elsewhere ^pending-else",
        "- [*] #task Next elsewhere ^next-else",
      ].join("\n"),
    },
  ];
  const index = indexDependencyStageNotes(notes);
  const edges = collectDependencyStageEdges(notes, index);
  const pool = collectVaultDependencyCandidates(notes, {
    dependentPath: "body.md",
    dependentLines: new Set([0]),
  });
  const view = planDependencyStageView({
    current: [],
    candidates: pool,
    query: "",
    dependent: { path: "body.md", line: 0, key: "body.md\x00dependent" },
    edges,
    linkedKeys: new Set(),
  });
  const ids = view
    .filter((row) => row.kind !== "stage-more")
    .map((row) => row.blockId);
  assert.ok(ids.includes("sibling"), "same-note tasks stay on empty query");
  assert.ok(ids.includes("pending-else"), "In Progress stays on empty query");
  assert.ok(ids.includes("next-else"), "Next stays on empty query");
  assert.ok(
    !ids.includes("ready-else"),
    "Ready tasks from other notes need typing",
  );
});

test("stage cap appends a type-to-search-more hint row", () => {
  const candidates = [];
  for (let i = 0; i < 70; i += 1) {
    candidates.push({
      path: "cash.md",
      route: "cash",
      note: "cash",
      line: i,
      rawLine: `- [/] #task Task ${i} ^task-${i}`,
      status: "/",
      displayText: `Task ${i}`,
      text: `Task ${i}`,
      blockId: `task-${i}`,
      existingBlockId: `task-${i}`,
      idField: null,
      existingIdField: null,
      section: null,
      open: true,
      blocked: false,
      hidden: false,
    });
  }
  const view = planDependencyStageView({
    current: [],
    candidates,
    query: "Task",
    dependent: { path: "body.md", line: 0, key: "body.md\x00dependent" },
    edges: new Map(),
    linkedKeys: new Set(),
    maxRows: 60,
  });
  const more = view.find((row) => row.kind === "stage-more");
  assert.ok(more, "truncation appends the hint row");
  assert.match(more.displayText, /type to search \d+ more/);
  assert.equal(more.disabled, true);
});

test("stage BLOCKED rows carry waits-on counts and short guard reasons", () => {
  const notes = [
    {
      path: "has space.md",
      content: "- [/] #task Spaced out ^spaced\n",
    },
    {
      path: "b.md",
      content: [
        "- [/] #task Beta ^beta",
        "  - ⛓️ **DEPENDS ON:** [[a#^alpha]]",
      ].join("\n"),
    },
    {
      path: "a.md",
      content: "- [ ] #task Alpha ^alpha\n",
    },
  ];
  const index = indexDependencyStageNotes(notes);
  const edges = collectDependencyStageEdges(notes, index);
  const pool = collectVaultDependencyCandidates(notes, {
    dependentPath: "a.md",
    dependentLines: new Set([0]),
  });
  const view = planDependencyStageView({
    current: [],
    candidates: pool,
    query: "Beta",
    dependent: { path: "a.md", line: 0, key: dependencyStageRowKey("a.md", "alpha") },
    edges,
    linkedKeys: new Set(),
  });
  const beta = view.find((row) => row.blockId === "beta");
  assert.ok(beta, "Beta reaches the stage with a matching query");
  assert.equal(beta.disabled, true);
  assert.equal(beta.disabledReason, "would create a cycle");
  const spacedView = planDependencyStageView({
    current: [],
    candidates: pool,
    query: "Spaced",
    dependent: { path: "a.md", line: 0, key: dependencyStageRowKey("a.md", "alpha") },
    edges,
    linkedKeys: new Set(),
  });
  const spaced = spacedView.find((row) => row.blockId === "spaced");
  assert.equal(spaced.disabledReason, "path can't be an id");
});

test("stage removal notices name the task description, not the block id", () => {
  const content = [
    "- [?] #task P [dependsOn:: Tasks__a] ^p",
    "  - ⛓️ **DEPENDS ON:** [[#^a]]",
    "- [x] #task Read me [id:: Tasks__a] ^a",
  ].join("\n");
  const files = new Map([["Tasks.md", content]]);
  const named = describeRemovedDependencyTarget(
    { path: "Tasks.md", blockId: "a" },
    files,
  );
  assert.equal(named, "Read me");
  const notice = buildDependencyEditNotice(
    { added: 0, removed: 1, openRemaining: 0, blockedAfter: false, recoveredOutcome: "ready" },
    { added: [], removed: [named] },
  );
  assert.match(notice, /Read me/);
  assert.doesNotMatch(notice, /\^a/);
});

test("stage Task Link batches keep Depends on without refusal", () => {
  const config = {
    properties: [{ name: "dependsOn", values: "local_task_id" }],
  };
  const targets = [
    {
      path: "cash.md",
      content: "- [ ] #task One ^one\n",
      line: 0,
      rawLine: "- [ ] #task One ^one",
      blockId: "one",
      displayText: "One",
    },
    {
      path: "body.md",
      content: "- [ ] #task Two ^two\n",
      line: 0,
      rawLine: "- [ ] #task Two ^two",
      blockId: "two",
      displayText: "Two",
    },
  ];
  const batch = createLinkPickerPropertyItems(config, targets);
  assert.equal(batch.valid, true);
  assert.equal(batch.items.length, 1);
  assert.equal(batch.items[0].linkDependency, true);
  assert.match(batch.items[0].detailText, /2 linked tasks/);
});

test("stage batch cycle check runs on the post-batch graph", () => {
  const notes = [
    {
      path: "a.md",
      content: ["- [ ] #task Alpha ^alpha", "  - ⛓️ **DEPENDS ON:** [[b#^beta]]"].join("\n"),
    },
    {
      path: "b.md",
      content: ["- [ ] #task Beta ^beta", "  - ⛓️ **DEPENDS ON:** [[a#^alpha]]"].join("\n"),
    },
  ];
  const index = indexDependencyStageNotes(notes);
  const edges = collectDependencyStageEdges(notes, index);
  const alpha = dependencyStageRowKey("a.md", "alpha");
  const beta = dependencyStageRowKey("b.md", "beta");
  assert.deepEqual(findDependencyStageCycle(edges, alpha, beta), [beta, alpha]);
});

test("stage ranker filters 1,000 synthetic tasks under 16 ms per keystroke", () => {
  const pool = [];
  for (let i = 0; i < 1000; i += 1) {
    pool.push({
      text: `Synthetic task number ${i} with searchable words`,
      route: i % 2 === 0 ? "cash" : "body",
      blockId: `synthetic-${i}`,
      section: null,
    });
  }
  // Warm up JIT compilation before timing: a single cold call absorbs
  // compilation plus any parallel-test CPU contention, which flaked the old
  // one-shot assertion under `npm test` (bob-cli-3w). Time several warmed
  // runs and assert on the minimum, so transient scheduling noise cannot
  // fail the gate while a real ranker slowdown still pushes every sample
  // over budget.
  for (let i = 0; i < 3; i += 1) {
    dependencyStageRank(pool, "synthetic cash");
  }
  const samples = [];
  let ranked = [];
  for (let i = 0; i < 7; i += 1) {
    const start = process.hrtime.bigint();
    ranked = dependencyStageRank(pool, "synthetic cash");
    samples.push(Number(process.hrtime.bigint() - start) / 1e6);
  }
  const elapsedMs = Math.min(...samples);
  assert.ok(ranked.length > 0, "synthetic pool matches");
  assert.ok(
    elapsedMs < 16,
    `filtering 1,000 tasks took ${elapsedMs.toFixed(2)} ms` +
      ` (best of ${samples.length}: ${samples.map((sample) => sample.toFixed(2)).join(", ")} ms; budget 16 ms)`,
  );
});

// A stale single add refuses with `changed — reopen` and reopens the stage
// fresh instead of writing against the changed line.
test("stage stale single add refuses and reopens", async () => {
  const content = [
    "- [ ] #task Parent ^parent",
    "- [ ] #task Target ^target",
  ].join("\n");
  const { plugin } = stubPlugin({ "Tasks.md": content });
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  const modal = stubStageModal(plugin, editor, "Tasks.md", 0);
  const reopened = [];
  plugin.openBulletPropertyPicker = async (reopenEditor, options) => {
    reopened.push(options);
    return true;
  };
  const item = {
    path: "Tasks.md",
    line: 1,
    rawLine: "- [ ] #task Target ^target",
    displayText: "Target",
    stageSection: "results",
    disabled: false,
    alreadyLinked: false,
    needsBlockIdPrompt: false,
  };
  editor.content = [
    "- [ ] #task Parent ^parent",
    "- [ ] #task Target edited ^target",
  ].join("\n");
  const before = notices.length;
  const applied = await modal.chooseTaskDependency(item);
  assert.equal(applied, false);
  assert.match(notices[before], /changed — reopen/);
  assert.equal(reopened.length, 1);
  assert.equal(reopened[0].initialProperty, "dependsOn");
  assert.doesNotMatch(editor.content, /DEPENDS ON/);
});

test("Task Link Depends on focuses a linked note open in a background tab", async () => {
  const { plugin } = stubPlugin({
    "daily.md": "- [[job#^job-task]]\n",
    "job.md": "heading\n- [ ] #task Job task ^job-task",
  });
  const dailyEditor = new TransactionEditor("- [[job#^job-task]]\n", {
    line: 0,
    ch: 0,
  });
  const jobEditor = new TransactionEditor(
    "heading\n- [ ] #task Job task ^job-task",
    { line: 0, ch: 0 },
  );
  let activeView = { file: { path: "daily.md" }, editor: dailyEditor };
  plugin.getActiveMarkdownView = () => activeView;
  plugin.getOpenMarkdownEditorForPath = (path) =>
    path === "job.md" ? jobEditor : null;
  const opened = [];
  plugin.openMarkdownFileWithLeafReuse = async (file, failureNotice) => {
    opened.push({ file, failureNotice });
    activeView = { file, editor: jobEditor };
    return true;
  };
  const pickerCalls = [];
  plugin.openBulletPropertyPicker = async (editor, options) => {
    pickerCalls.push({
      editor,
      options,
      activeEditorMatches: plugin.getActiveMarkdownView().editor === editor,
    });
    return true;
  };

  const before = notices.length;
  await plugin.openLinkedDependencyStage({ path: "job.md", line: 1 });

  assert.equal(opened.length, 1);
  assert.equal(opened[0].file.path, "job.md");
  assert.equal(opened[0].failureNotice, "Could not open job.md");
  assert.equal(pickerCalls.length, 1);
  assert.equal(pickerCalls[0].editor, jobEditor);
  assert.deepEqual(pickerCalls[0].options, { initialProperty: "dependsOn" });
  assert.equal(pickerCalls[0].activeEditorMatches, true);
  assert.deepEqual(jobEditor.getCursor(), { line: 1, ch: 0 });
  assert.ok(
    !notices.slice(before).includes("No active markdown note"),
    "the stage should not hit the active-view guard",
  );
});

test("Task Link Blocks focuses the linked note and opens Blocks directly", async () => {
  const { plugin } = stubPlugin({
    "daily.md": "- [[job#^job-task]]\n",
    "job.md": "heading\n- [ ] #task Job task [id:: job-task] ^job-task",
  });
  const dailyEditor = new TransactionEditor("- [[job#^job-task]]\n", {
    line: 0,
    ch: 0,
  });
  const jobEditor = new TransactionEditor(
    "heading\n- [ ] #task Job task [id:: job-task] ^job-task",
    { line: 0, ch: 0 },
  );
  let activeView = { file: { path: "daily.md" }, editor: dailyEditor };
  plugin.getActiveMarkdownView = () => activeView;
  plugin.getOpenMarkdownEditorForPath = (path) =>
    path === "job.md" ? jobEditor : null;
  plugin.openMarkdownFileWithLeafReuse = async (_file) => {
    activeView = { file: { path: "job.md" }, editor: jobEditor };
    return true;
  };
  const pickerCalls = [];
  plugin.openBulletPropertyPicker = async (editor, options) => {
    pickerCalls.push({ editor, options });
    return true;
  };

  const result = await plugin.openLinkedBlocksStage({ path: "job.md", line: 1 });
  assert.equal(result, true);
  assert.equal(jobEditor.getCursor().line, 1);
  assert.deepEqual(pickerCalls, [
    { editor: jobEditor, options: { reopenBlocksStage: true } },
  ]);
});

test("Task Link Depends on refuses clearly when the linked note cannot be focused", async (t) => {
  await t.test("focus reports success but the active view stays elsewhere", async () => {
    const { plugin } = stubPlugin({
      "daily.md": "- [[job#^job-task]]\n",
      "job.md": "- [ ] #task Job task ^job-task",
    });
    const dailyEditor = new TransactionEditor("- [[job#^job-task]]\n", {
      line: 0,
      ch: 0,
    });
    plugin.getActiveMarkdownView = () => ({
      file: { path: "daily.md" },
      editor: dailyEditor,
    });
    plugin.openMarkdownFileWithLeafReuse = async () => true;
    let pickerCalled = false;
    plugin.openBulletPropertyPicker = async () => {
      pickerCalled = true;
      return true;
    };

    const before = notices.length;
    const result = await plugin.openLinkedDependencyStage({
      path: "job.md",
      line: 0,
    });

    assert.equal(result, false);
    assert.equal(pickerCalled, false);
    assert.deepEqual(notices.slice(before), ["Could not open job.md"]);
  });

  await t.test("focus reports failure", async () => {
    const { plugin } = stubPlugin({
      "daily.md": "- [[job#^job-task]]\n",
      "job.md": "- [ ] #task Job task ^job-task",
    });
    plugin.openMarkdownFileWithLeafReuse = async () => false;
    let pickerCalled = false;
    plugin.openBulletPropertyPicker = async () => {
      pickerCalled = true;
      return true;
    };

    const result = await plugin.openLinkedDependencyStage({
      path: "job.md",
      line: 0,
    });

    assert.equal(result, false);
    assert.equal(pickerCalled, false);
  });
});

