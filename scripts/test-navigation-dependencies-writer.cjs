// Plugin-level tests for the nav-writer-fix phase (bob-cli-3n.12.4).
// `docs/task-dependencies.md` in bob-cli is authoritative (§§2-3, 5-6, 9).
// These tests exercise the real async plugin paths (async vault/editor
// stubs and the batch-modal executors), not only the pure helpers.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const notices = [];

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    class EmptyClass {}
    class TestNotice {
      constructor(message) {
        notices.push(String(message));
      }
    }
    return {
      MarkdownView: EmptyClass,
      Modal: class {},
      Notice: TestNotice,
      Plugin: EmptyClass,
      parseYaml: () => ({}),
    };
  }
  if (request === "@codemirror/view") {
    return { EditorView: class {} };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const NavigationHotkeysPlugin = require("../plugins/bob-navigation-hotkeys/main.js");
const { helpers } = NavigationHotkeysPlugin;
Module._load = originalLoad;

function compatibleTasksSettings() {
  return {
    globalFilter: "#task",
    statusSettings: {
      coreStatuses: [],
      customStatuses: [
        {
          symbol: "?",
          name: "Blocked",
          nextStatusSymbol: " ",
          availableAsCommand: true,
          type: "ON_HOLD",
        },
      ],
    },
  };
}

class TestEditor {
  constructor(content) {
    this.content = content;
  }
  getValue() {
    return this.content;
  }
  getLine(line) {
    return this.content.split(/\r?\n/)[line] ?? null;
  }
  getCursor() {
    return { line: 0, ch: 0 };
  }
  replaceRange(text, from, to = from) {
    const newline = this.content.includes("\r\n") ? "\r\n" : "\n";
    const lines = this.content.split(/\r?\n/);
    const offset = (position) =>
      lines
        .slice(0, position.line)
        .reduce((sum, line) => sum + line.length + newline.length, 0) +
      position.ch;
    const start = offset(from);
    const end = offset(to);
    this.content = this.content.slice(0, start) + text + this.content.slice(end);
  }
}

class TransactionEditor extends TestEditor {
  constructor(content, cursor) {
    super(content);
    this.cursor = { ...cursor };
    this.undoGroups = 0;
  }
  getCursor() {
    return { ...this.cursor };
  }
  getScrollInfo() {
    return { left: 0, top: 0 };
  }
  setCursor(lineOrPosition, ch) {
    this.cursor =
      typeof lineOrPosition === "object"
        ? { ...lineOrPosition }
        : { line: lineOrPosition, ch };
  }
  transaction(transaction) {
    if (transaction.changes && transaction.changes.length > 0) {
      this.undoGroups += 1;
    }
    const changes = [...(transaction.changes || [])].sort(
      (left, right) =>
        right.from.line - left.from.line || right.from.ch - left.from.ch,
    );
    for (const change of changes) {
      super.replaceRange(change.text, change.from, change.to || change.from);
    }
    if (transaction.selection) {
      this.cursor = {
        ...(transaction.selection.to || transaction.selection.from),
      };
    }
  }
}

// Async vault stub: `notes` maps vault-relative paths to contents.
// `mutateBeforeRead` hooks run inside `cachedRead` (after the plugin's
// awaits start, before they finish) to simulate concurrent edits.
function stubApp(notes, options = {}) {
  const store = new Map(Object.entries(notes));
  const settingsPath = ".obsidian/plugins/obsidian-tasks-plugin/data.json";
  const vault = {
    getMarkdownFiles: () =>
      [...store.keys()]
        .filter((path) => /\.md$/i.test(path))
        .map((path) => ({ path })),
    getAbstractFileByPath: (path) =>
      store.has(path) || path === settingsPath ? { path } : null,
    cachedRead: async (file) => {
      if (options.mutateBeforeRead) {
        await options.mutateBeforeRead(file);
      }
      const content = store.get(file.path);
      return content === undefined ? "" : String(content);
    },
    read: async (file) => {
      if (file.path === settingsPath) {
        return JSON.stringify(compatibleTasksSettings());
      }
      return vault.cachedRead(file);
    },
    process: async (file, fn) => {
      const current = store.get(file.path) || "";
      store.set(file.path, String(fn(current)));
    },
  };
  const metadataCache = {
    getFirstLinkpathDest: (linkpath, sourcePath) => {
      const wanted = String(linkpath || "");
      if (!wanted || wanted.includes("#")) {
        return null;
      }
      const direct = `${wanted}.md`;
      if (store.has(direct)) {
        return { path: direct };
      }
      const lowered = wanted.toLowerCase();
      const matches = [...store.keys()].filter(
        (path) =>
          /\.md$/i.test(path) &&
          path.split("/").pop().replace(/\.md$/i, "").toLowerCase() ===
            lowered,
      );
      if (matches.length === 1) {
        return { path: matches[0] };
      }
      return null;
    },
  };
  return {
    app: {
      vault,
      metadataCache,
      workspace: { getLeavesOfType: () => [] },
    },
    store,
  };
}

function stubPlugin(notes, options = {}) {
  const { app, store } = stubApp(notes, options);
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = app;
  return { plugin, store };
}

function stubModal(plugin, editor, filePath, cursorLine) {
  const content = String(editor.getValue() || "");
  const lines = content.split(/\r?\n/);
  const cursor = { line: cursorLine, ch: 0 };
  const config = helpers.validateBulletPropertyConfig({
    properties: [{ name: "dependsOn", values: ["x"] }],
  });
  const modal = new helpers.BulletPropertyPickerModal(
    {},
    plugin,
    editor,
    cursor,
    String(lines[cursorLine] || ""),
    config,
    { filePath },
  );
  modal.filePath = filePath;
  return modal;
}

// A cross-note add awaits preparation before committing: the preparation
// writes first, the dependent commits after, and the link uses the prepared
// id in a single dependent transaction.
test("cross-note add awaits preparation before the one commit", async () => {
  const parentNote = "- [ ] #task Parent ^parent";
  const targetNote = "- [ ] #task Target ^target";
  const { plugin, store } = stubPlugin({
    "Tasks.md": parentNote,
    "Other.md": targetNote,
  });
  const editor = new TransactionEditor(parentNote, { line: 0, ch: 0 });
  const events = [];
  const originalPrepare = plugin.prepareDependencyTargetNote.bind(plugin);
  plugin.prepareDependencyTargetNote = async (filePath, preparation) => {
    events.push(`prepare-start:${filePath}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const result = await originalPrepare(filePath, preparation);
    events.push(`prepare-done:${filePath}`);
    return result;
  };
  const outcome = await plugin.applyDependencyEdit({
    editor,
    parentPath: "Tasks.md",
    parentLine: 0,
    add: [{ path: "Other.md", blockId: "target" }],
    remove: [],
  });
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.deepEqual(events, ["prepare-start:Other.md", "prepare-done:Other.md"]);
  assert.equal(editor.undoGroups, 1);
  assert.match(editor.content, /\[\[Other#\^target\]\]/);
  assert.match(
    store.get("Other.md"),
    /\[id:: Other__target\] \^target/,
  );
});

// A failed cross-note preparation aborts before the commit: the dependent
// is untouched even though preparation is async.
test("a failed async preparation leaves the dependent untouched", async () => {
  const parentNote = "- [ ] #task Parent ^parent";
  const { plugin, store } = stubPlugin({
    "Tasks.md": parentNote,
    "Other.md": "- [ ] #task Target ^target",
  });
  const editor = new TransactionEditor(parentNote, { line: 0, ch: 0 });
  plugin.prepareDependencyTargetNote = async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { ok: false, reason: "target-changed" };
  };
  const outcome = await plugin.applyDependencyEdit({
    editor,
    parentPath: "Tasks.md",
    parentLine: 0,
    add: [{ path: "Other.md", blockId: "target" }],
    remove: [],
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, "target-changed");
  assert.equal(editor.content, parentNote);
  assert.equal(editor.undoGroups, 0);
  assert.equal(store.get("Other.md"), "- [ ] #task Target ^target");
});

// An existing link to an unloaded note never blocks other edits: adding a
// second prerequisite keeps the unloaded link verbatim with its field id,
// and removing it drops the link even when its note is gone.
test("links to unloaded notes tolerate add, remove, and deleted targets", async () => {
  const parentNote = [
    "- [?] #task P [dependsOn:: Other__x, Tasks__b] ^p",
    "  - ⛓️ **DEPENDS ON:** [[Other#^x]] • [[#^b]]",
    "- [ ] #task B [id:: Tasks__b] ^b",
  ].join("\n");
  const plan = helpers.planDependencyEdit({
    content: parentNote,
    parentLine: 0,
    parentPath: "Tasks.md",
    add: [{ path: "Tasks.md", blockId: "b" }],
    remove: [],
    files: { "Tasks.md": parentNote },
  });
  assert.equal(plan.ok, true, plan.reason);
  assert.match(plan.nextContent, /\[\[Other#\^x\]\]/);
  assert.match(plan.nextContent, /\[dependsOn:: Other__x, Tasks__b\]/);

  const removed = helpers.planDependencyEdit({
    content: parentNote,
    parentLine: 0,
    parentPath: "Tasks.md",
    add: [],
    remove: [{ path: "Other.md", blockId: "x" }],
    files: { "Tasks.md": parentNote },
  });
  assert.equal(removed.ok, true, removed.reason);
  assert.doesNotMatch(removed.nextContent, /Other#\^x/);
  assert.match(removed.nextContent, /\[dependsOn:: Tasks__b\]/);

  // Plugin level: the Other.md note is not in the vault at all, yet the
  // removal commits through the editor.
  const { plugin } = stubPlugin({ "Tasks.md": parentNote });
  const editor = new TransactionEditor(parentNote, { line: 0, ch: 0 });
  const outcome = await plugin.applyDependencyEdit({
    editor,
    parentPath: "Tasks.md",
    parentLine: 0,
    add: [],
    remove: [{ path: "Other.md", blockId: "x" }],
  });
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.doesNotMatch(editor.content, /Other#\^x/);
});

// Recovery resolves over the plugin's own vault snapshot (no injected
// `vaultContents`): a dependent linked from today's Pomodoro recovers to
// Next, not Ready — and to Ready when the daily note has no such link.
test("Pomodoro-linked dependents recover through the plugin vault read", async () => {
  const parentNote = [
    "- [?] #task P [dependsOn:: Tasks__a] ^p",
    "  - ⛓️ **DEPENDS ON:** [[#^a]]",
    "- [x] #task A [id:: Tasks__a] ^a",
  ].join("\n");
  const dailyNote = [
    "## Pomodoros",
    "- [ ] 10:00 Focus",
    "  - [[Tasks#^p]]",
  ].join("\n");
  // The daily note must be today's for the recovery index: derive its path
  // from the live date so this test is not pinned to one calendar day.
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const dailyPath = `${now.getFullYear()}/${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.md`;
  const { plugin } = stubPlugin({
    "Tasks.md": parentNote,
    [dailyPath]: dailyNote,
  });
  const editor = new TransactionEditor(parentNote, { line: 0, ch: 0 });
  const outcome = await plugin.applyDependencyEdit({
    editor,
    parentPath: "Tasks.md",
    parentLine: 0,
    add: [],
    remove: [{ path: "Tasks.md", blockId: "a" }],
  });
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.equal(editor.undoGroups, 1);
  assert.match(editor.content, /- \[\*\] #task P\b/m);
  assert.doesNotMatch(editor.content, /DEPENDS ON/);

  const { plugin: lonelyPlugin } = stubPlugin({ "Tasks.md": parentNote });
  const lonelyEditor = new TransactionEditor(parentNote, { line: 0, ch: 0 });
  const lonely = await lonelyPlugin.applyDependencyEdit({
    editor: lonelyEditor,
    parentPath: "Tasks.md",
    parentLine: 0,
    add: [],
    remove: [{ path: "Tasks.md", blockId: "a" }],
  });
  assert.equal(lonely.ok, true, JSON.stringify(lonely));
  assert.match(lonelyEditor.content, /- \[ \] #task P\b/m);
});

// The same-note marked-batch `+ id` stamps the confirmed id into a working
// copy first, so the planner resolves it and one gesture commits the target
// id and the link in a single undo group.
test("same-note batch +id stamps the target and links in one undo group", async () => {
  const content = [
    "- [ ] #task Parent ^parent",
    "- [ ] #task Target",
  ].join("\n");
  const { plugin } = stubPlugin({ "Tasks.md": content });
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  const modal = stubModal(plugin, editor, "Tasks.md", 0);
  const snapshot = {
    markKey: "Tasks.md#1",
    path: "Tasks.md",
    line: 1,
    rawLine: "- [ ] #task Target",
    displayText: "Target",
    existingIdField: null,
    blockId: null,
  };
  const batch = {
    propertyName: "dependsOn",
    cursorLineText: "- [ ] #task Parent ^parent",
    removals: [],
    readyAdditions: [],
    promptQueue: [snapshot],
    promptIndex: 1,
    confirmedById: new Map([[1, "newid"], ["Tasks.md#1", "newid"]]),
    reservedIds: new Set(["newid"]),
    hasVault: false,
  };
  const applied = await modal.executeDependencyBatch(batch);
  assert.equal(applied, true);
  assert.equal(editor.undoGroups, 1);
  assert.match(editor.content, /- \[ \] #task Target \[id:: Tasks__newid\] \^newid/);
  assert.match(
    editor.content,
    /⛓️ \*\*DEPENDS ON:\*\* \[\[#\^newid\]\]/,
  );
});

// `confirmBatchBlockId` records the confirmed id and runs the batch:
// the modal closes only when the executor succeeds.
test("confirmBatchBlockId collects the id and executes the batch", async () => {
  const content = [
    "- [ ] #task Parent ^parent",
    "- [ ] #task Target",
  ].join("\n");
  const { plugin } = stubPlugin({ "Tasks.md": content });
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  const modal = stubModal(plugin, editor, "Tasks.md", 0);
  modal.pendingBatch = {
    propertyName: "dependsOn",
    cursorLineText: "- [ ] #task Parent ^parent",
    removals: [],
    readyAdditions: [],
    promptQueue: [
      {
        markKey: "Tasks.md#1",
        path: "Tasks.md",
        line: 1,
        rawLine: "- [ ] #task Target",
        displayText: "Target",
        existingIdField: null,
        blockId: null,
      },
    ],
    promptIndex: 0,
    confirmedById: new Map(),
    reservedIds: new Set(),
    hasVault: false,
  };
  const applied = await modal.confirmBatchBlockId({ id: "newid", valid: true });
  assert.equal(applied, true);
  assert.equal(editor.undoGroups, 1);
  assert.match(editor.content, /\[\[#\^newid\]\]/);
  assert.match(editor.content, /\^newid/);
});

// `commitMarkedDependencies` with ready additions executes immediately with
// no prompts and no editor writes outside the one transaction.
test("commitMarkedDependencies executes ready additions at once", async () => {
  const content = [
    "- [ ] #task Parent ^parent",
    "- [ ] #task Target ^target",
  ].join("\n");
  const { plugin } = stubPlugin({ "Tasks.md": content });
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  const modal = stubModal(plugin, editor, "Tasks.md", 0);
  modal.selectedPropertyItem = { property: { name: "dependsOn" } };
  modal.lineText = "- [ ] #task Parent ^parent";
  const item = {
    markKey: "Tasks.md#1",
    path: "Tasks.md",
    line: 1,
    rawLine: "- [ ] #task Target ^target",
    displayText: "Target",
    existingIdField: null,
    blockId: "target",
    existingBlockId: "target",
    alreadyLinked: false,
    needsPromptForAdd: false,
  };
  modal.taskItemsByLine = new Map([[1, item]]);
  modal.markedLines = new Set([1]);
  const applied = await modal.commitMarkedDependencies();
  assert.equal(applied, true);
  assert.equal(editor.undoGroups, 1);
  assert.match(editor.content, /\[\[#\^target\]\]/);
});

// Counted vault adds walk bottom-up: linking two siblings from an earlier
// task links both, with each source keeping its own line.
test("counted vault add links two siblings bottom-up", async () => {
  const content = [
    "- [ ] #task First ^first",
    "- [ ] #task Second ^second",
    "- [ ] #task Target ^target",
  ].join("\n");
  const { plugin } = stubPlugin({ "Tasks.md": content });
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  const modal = stubModal(plugin, editor, "Tasks.md", 0);
  modal.taskSession = {
    valid: true,
    targets: [
      { line: 0, rawLine: "- [ ] #task First ^first" },
      { line: 1, rawLine: "- [ ] #task Second ^second" },
    ],
  };
  const applied = await modal.applyVaultCountedDependencyRef({
    path: "Tasks.md",
    line: 2,
    rawLine: "- [ ] #task Target ^target",
    displayText: "Target",
    existingIdField: null,
    blockId: "target",
  });
  assert.equal(applied, true);
  const lines = editor.content.split("\n");
  const firstDepends = lines.findIndex((line) => line.includes("^first"));
  const secondDepends = lines.findIndex((line) => line.includes("^second"));
  assert.notEqual(firstDepends, -1);
  assert.notEqual(secondDepends, -1);
  assert.match(lines[firstDepends], /\[dependsOn:: Tasks__target\]/);
  assert.match(lines[secondDepends], /\[dependsOn:: Tasks__target\]/);
  assert.match(editor.content, /\[\[#\^target\]\]/g);
});

// A counted CURRENT row carries no target line: removing a fully linked
// same-note prerequisite removes it from every source in one transaction.
test("counted CURRENT rows without a line remove from every source", async () => {
  const content = [
    "- [?] #task First [dependsOn:: Tasks__target] ^first",
    "  - ⛓️ **DEPENDS ON:** [[#^target]]",
    "- [?] #task Second [dependsOn:: Tasks__target] ^second",
    "  - ⛓️ **DEPENDS ON:** [[#^target]]",
    "- [x] #task Target [id:: Tasks__target] ^target",
  ].join("\n");
  const { plugin } = stubPlugin({ "Tasks.md": content });
  plugin.getActiveMarkdownView = () => ({
    editor: null,
    file: null,
  });
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  plugin.getActiveMarkdownView = () => ({
    editor,
    file: { path: "Tasks.md" },
  });
  const modal = stubModal(plugin, editor, "Tasks.md", 0);
  modal.taskSession = {
    valid: true,
    targets: [
      {
        line: 0,
        rawLine: "- [?] #task First [dependsOn:: Tasks__target] ^first",
      },
      {
        line: 2,
        rawLine: "- [?] #task Second [dependsOn:: Tasks__target] ^second",
      },
    ],
  };
  const removed = await modal.removeCountedDependency({
    stageSection: "current",
    alreadyLinked: true,
    path: "Tasks.md",
    blockId: "target",
    existingBlockId: "target",
    displayText: "Target",
    existingIdField: "Tasks__target",
  });
  assert.equal(removed, true);
  assert.equal(editor.undoGroups, 1);
  assert.doesNotMatch(editor.content, /DEPENDS ON/);
  assert.doesNotMatch(editor.content, /dependsOn/);
});

// The commit re-checks the editor preimage: an edit that lands between the
// writer's awaits and its commit refuses instead of misapplying.
test("a stale editor between await and commit refuses", async () => {
  const parentNote = "- [ ] #task Parent ^parent";
  const targetNote = "- [ ] #task Target ^target";
  const editor = new TransactionEditor(parentNote, { line: 0, ch: 0 });
  const { plugin } = stubPlugin(
    { "Tasks.md": parentNote, "Other.md": targetNote },
    {
      mutateBeforeRead: async () => {
        editor.content = `${parentNote}\n- [ ] #task Intruder ^intruder`;
      },
    },
  );
  const outcome = await plugin.applyDependencyEdit({
    editor,
    parentPath: "Tasks.md",
    parentLine: 0,
    add: [{ path: "Other.md", blockId: "target" }],
    remove: [],
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, "stale-editor");
  assert.match(editor.content, /\^intruder/);
  assert.doesNotMatch(editor.content, /DEPENDS ON/);
});

// `removeDependencyByRef` re-reads the dependent: removing a linked target
// works, while a target that is not on the line refuses with `not-on-line`
// instead of a silent ok.
test("removeDependencyByRef refuses targets that are not on the line", async () => {
  const parentNote = [
    "- [?] #task P [dependsOn:: Tasks__a] ^p",
    "  - ⛓️ **DEPENDS ON:** [[#^a]]",
    "- [x] #task A [id:: Tasks__a] ^a",
  ].join("\n");
  const { plugin } = stubPlugin({ "Tasks.md": parentNote });
  const editor = new TransactionEditor(parentNote, { line: 0, ch: 0 });
  plugin.getActiveMarkdownView = () => ({
    editor,
    file: { path: "Tasks.md" },
  });
  const missing = await plugin.removeDependencyByRef(
    { path: "Tasks.md", line: 1 },
    { path: "Tasks.md", blockId: "ghost" },
  );
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "not-on-line");
  assert.equal(editor.content, parentNote);
  assert.equal(editor.undoGroups, 0);

  const removed = await plugin.removeDependencyByRef(
    { path: "Tasks.md", line: 1 },
    { path: "Tasks.md", blockId: "a" },
  );
  assert.equal(removed.ok, true);
  assert.doesNotMatch(editor.content, /DEPENDS ON/);
});

// A kept link whose note is not loaded keeps its field id by line position:
// with `[[#^a]] • [[Other#^x]]` and Other.md unloaded, removing `a` writes
// the id of `x` next to the remaining link, never the id of `a`.
test("kept unloaded links resolve the field id by line position", async () => {
  const parentNote = [
    "- [?] #task P [dependsOn:: Tasks__a, Other__x] ^p",
    "  - ⛓️ **DEPENDS ON:** [[#^a]] • [[Other#^x]]",
    "- [ ] #task A [id:: Tasks__a] ^a",
  ].join("\n");
  const plan = helpers.planDependencyEdit({
    content: parentNote,
    parentLine: 0,
    parentPath: "Tasks.md",
    add: [],
    remove: [{ path: "Tasks.md", blockId: "a" }],
    files: { "Tasks.md": parentNote },
  });
  assert.equal(plan.ok, true, plan.reason);
  assert.match(plan.nextContent, /\[\[Other#\^x\]\]/);
  assert.match(plan.nextContent, /\[dependsOn:: Other__x\]/);
  assert.equal(plan.field, "Other__x");

  const mismatched = helpers.planDependencyEdit({
    content: parentNote.replace("Other__x]", "Other__x, Tasks__zzz]"),
    parentLine: 0,
    parentPath: "Tasks.md",
    add: [],
    remove: [{ path: "Tasks.md", blockId: "a" }],
    files: { "Tasks.md": parentNote },
  });
  assert.equal(mismatched.ok, false);
  assert.equal(mismatched.reason, "target-not-found");

  // Plugin level through the batch executor: `Other.md` is not in the
  // vault at all, yet removing `a` keeps `[[Other#^x]]` with its own field
  // id `Other__x` (never `a`'s id) in one undo group.
  const { plugin } = stubPlugin({ "Tasks.md": parentNote });
  const editor = new TransactionEditor(parentNote, { line: 0, ch: 0 });
  const modal = stubModal(plugin, editor, "Tasks.md", 0);
  const applied = await modal.executeDependencyBatch({
    propertyName: "dependsOn",
    cursorLineText: "- [?] #task P [dependsOn:: Tasks__a, Other__x] ^p",
    removals: [{ linkBlockId: "a", depValue: "Tasks__a", legacyDepValue: null }],
    readyAdditions: [],
    promptQueue: [],
    promptIndex: 0,
    confirmedById: new Map(),
    reservedIds: new Set(),
    hasVault: false,
  });
  assert.equal(applied, true);
  assert.equal(editor.undoGroups, 1);
  assert.match(editor.content, /\[\[Other#\^x\]\]/);
  assert.match(editor.content, /\[dependsOn:: Other__x\]/);
  assert.doesNotMatch(editor.content, /\[\[#\^a\]\]/);
});

// Same-note `pendingTargetLine` folds the target `^id`/`[id::]` write into
// the one dependent transaction, with and without an existing Depends-On
// line: the target always gains its id and the link lands in one undo group.
test("pendingTargetLine commits the same-note target id with the link", () => {
  for (const withExisting of [false, true]) {
    const parentLine = withExisting
      ? "- [?] #task P [dependsOn:: Tasks__a] ^p"
      : "- [ ] #task Parent ^parent";
    const dependsLine = withExisting
      ? "  - ⛓️ **DEPENDS ON:** [[#^a]]"
      : null;
    const targetBefore = "- [ ] #task Target";
    const targetAfter = "- [ ] #task Target [id:: Tasks__b] ^b";
    const content = [
      parentLine,
      ...(dependsLine ? [dependsLine] : []),
      "- [ ] #task A [id:: Tasks__a] ^a",
      targetBefore,
    ].join("\n");
    const { plugin } = stubPlugin({ "Tasks.md": content });
    const editor = new TransactionEditor(content, { line: 0, ch: 0 });
    const targetIndex = content.split("\n").indexOf(targetBefore);
    const depValue = helpers.dependencyTargetId(
      targetAfter,
      "Tasks.md",
      "b",
    );
    assert.ok(depValue);
    const linked = plugin.setLocalTaskDependency(
      editor,
      { line: 0, ch: 0 },
      "dependsOn",
      depValue,
      {
        linkBlockId: "b",
        filePath: "Tasks.md",
        showNotice: false,
        pendingTargetLine: {
          line: targetIndex,
          expected: targetBefore,
          text: targetAfter,
        },
      },
    );
    assert.equal(linked, true);
    assert.equal(editor.undoGroups, 1);
    assert.match(editor.content, /\[\[#\^b\]\]/);
    assert.match(editor.content, /\[id:: Tasks__b\] \^b/);
    if (withExisting) {
      assert.match(editor.content, /\[\[#\^a\]\]/);
    }
  }
});

// Counted vault writes commit once: two sources link in one undo group, and
// a source that fails to plan refuses before any write.
test("counted vault add commits every source in one transaction", async () => {
  const content = [
    "- [ ] #task First ^first",
    "- [ ] #task Second ^second",
    "- [ ] #task Target ^target",
  ].join("\n");
  const { plugin } = stubPlugin({ "Tasks.md": content });
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  const modal = stubModal(plugin, editor, "Tasks.md", 0);
  modal.taskSession = {
    valid: true,
    targets: [
      { line: 0, rawLine: "- [ ] #task First ^first" },
      { line: 1, rawLine: "- [ ] #task Second ^second" },
    ],
  };
  const applied = await modal.applyVaultCountedDependencyRef({
    path: "Tasks.md",
    line: 2,
    rawLine: "- [ ] #task Target ^target",
    displayText: "Target",
    existingIdField: null,
    blockId: "target",
  });
  assert.equal(applied, true);
  assert.equal(editor.undoGroups, 1);
  assert.match(editor.content, /\[dependsOn:: Tasks__target\]/g);

  const quoted = [
    "- [ ] #task First ^first",
    "> - [ ] #task Quoted ^quoted",
  ].join("\n");
  const { plugin: quotedPlugin } = stubPlugin({ "Tasks.md": quoted });
  const quotedEditor = new TransactionEditor(quoted, { line: 0, ch: 0 });
  const quotedModal = stubModal(quotedPlugin, quotedEditor, "Tasks.md", 0);
  quotedModal.taskSession = {
    valid: true,
    targets: [
      { line: 0, rawLine: "- [ ] #task First ^first" },
      { line: 1, rawLine: "> - [ ] #task Quoted ^quoted" },
    ],
  };
  const refused = await quotedModal.applyVaultCountedDependencyRef({
    path: "Tasks.md",
    line: 0,
    rawLine: "- [ ] #task First ^first",
    displayText: "First",
    existingIdField: null,
    blockId: "first",
  });
  assert.equal(refused, false);
  assert.equal(quotedEditor.content, quoted);
  assert.equal(quotedEditor.undoGroups, 0);
});

// A field-only clear snapshots the vault: a `[?]` task whose field is
// cleared with no link removed still recovers when a Pomodoro points at it.
test("field-only clears snapshot the vault and recover", async () => {
  const parentNote = "- [?] #task P [dependsOn:: Tasks__a] ^p";
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const dailyPath = `${now.getFullYear()}/${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.md`;
  const dailyNote = [
    "## Pomodoros",
    "- [ ] 10:00 Focus",
    "  - [[Tasks#^p]]",
  ].join("\n");
  const { plugin } = stubPlugin({
    "Tasks.md": parentNote,
    [dailyPath]: dailyNote,
  });
  const editor = new TransactionEditor(parentNote, { line: 0, ch: 0 });
  plugin.getActiveMarkdownView = () => ({
    editor,
    file: { path: "Tasks.md" },
  });
  const result = await plugin.deleteDependencyLineAndField(
    editor,
    { line: 0, ch: 0 },
    { filePath: "Tasks.md" },
  );
  assert.ok(result && result.deleted, JSON.stringify(result));
  assert.equal(editor.undoGroups, 1);
  assert.match(editor.content, /- \[\*\] #task P\b/m);
  assert.doesNotMatch(editor.content, /dependsOn/);
});

// Writer calls that cannot recover read zero extra notes: a same-note add
// with a non-Blocked parent never snapshots the vault.
test("adds without recovery read zero extra vault notes", async () => {
  const notes = {
    "Tasks.md": "- [ ] #task Parent ^parent\n- [ ] #task Target ^target",
    "Other.md": "- [ ] #task Other ^other",
    "Third.md": "- [ ] #task Third ^third",
  };
  const { plugin, store } = stubPlugin(notes);
  let reads = 0;
  const vault = plugin.app.vault;
  const originalCachedRead = vault.cachedRead;
  vault.cachedRead = async (file) => {
    reads += 1;
    return originalCachedRead(file);
  };
  const editor = new TransactionEditor(notes["Tasks.md"], { line: 0, ch: 0 });
  const outcome = await plugin.applyDependencyEdit({
    editor,
    parentPath: "Tasks.md",
    parentLine: 0,
    add: [{ path: "Tasks.md", blockId: "target" }],
    remove: [],
  });
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.equal(reads, 0);
  assert.equal(editor.undoGroups, 1);
  assert.match(editor.content, /\[\[#\^target\]\]/);
});

// The hand-edit clear path does its own vault read (no injected
// `vaultContents`): a Pomodoro-linked dependent recovers to Next, not
// Ready — while a non-Blocked parent reads zero extra notes.
test("hand-edit clear recovers Pomodoro-linked dependents to Next", async () => {
  const oldNote = [
    "- [?] #task P [dependsOn:: Tasks__a] ^p",
    "  - ⛓️ **DEPENDS ON:** [[#^a]]",
    "- [x] #task A [id:: Tasks__a] ^a",
  ].join("\n");
  const newNote = [
    "- [?] #task P [dependsOn:: Tasks__a] ^p",
    "- [x] #task A [id:: Tasks__a] ^a",
  ].join("\n");
  const dailyNote = [
    "## Pomodoros",
    "- [ ] 10:00 Focus",
    "  - [[Tasks#^p]]",
  ].join("\n");
  // The daily note must be today's for the recovery index: derive its path
  // from the live date so this test is not pinned to one calendar day.
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const dailyPath = `${now.getFullYear()}/${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.md`;
  const { plugin } = stubPlugin({
    "Tasks.md": newNote,
    [dailyPath]: dailyNote,
  });
  const editor = new TransactionEditor(newNote, { line: 0, ch: 0 });
  const plan = helpers.planDependencyHandEditMirror(
    oldNote,
    newNote,
    1,
    "  - ⛓️ **DEPENDS ON:** [[#^a]]",
  );
  assert.ok(plan);
  const outcome = await plugin.applyDependencyHandEditClear(editor, "Tasks.md", plan, {
    today: now,
  });
  assert.equal(outcome.mirrored, true);
  assert.match(editor.content, /- \[\*\] #task P\b/m);
});

test("hand-edit clear on a non-Blocked parent reads zero extra notes", async () => {
  const oldNote = [
    "- [ ] #task P [dependsOn:: Tasks__a] ^p",
    "  - ⛓️ **DEPENDS ON:** [[#^a]]",
    "- [x] #task A [id:: Tasks__a] ^a",
  ].join("\n");
  const newNote = [
    "- [ ] #task P [dependsOn:: Tasks__a] ^p",
    "- [x] #task A [id:: Tasks__a] ^a",
  ].join("\n");
  const { plugin } = stubPlugin({
    "Tasks.md": newNote,
    "Other.md": "- [ ] #task Other ^other",
  });
  let reads = 0;
  const vault = plugin.app.vault;
  const originalCachedRead = vault.cachedRead;
  vault.cachedRead = async (file) => {
    reads += 1;
    return originalCachedRead(file);
  };
  const editor = new TransactionEditor(newNote, { line: 0, ch: 0 });
  const plan = helpers.planDependencyHandEditMirror(
    oldNote,
    newNote,
    1,
    "  - ⛓️ **DEPENDS ON:** [[#^a]]",
  );
  assert.ok(plan);
  const outcome = await plugin.applyDependencyHandEditClear(editor, "Tasks.md", plan, {});
  assert.equal(outcome.mirrored, true);
  assert.equal(reads, 0);
  assert.doesNotMatch(editor.content, /dependsOn/);
});

// Duplicate basenames keep the full route through the writer: a subfolder
// target links with its explicit path. (This plugin-level test supersedes
// the pure `duplicate basenames keep the full route` helper test, which
// pinned the same ranking one level down.)
test("writer keeps the full route for duplicate basenames", async () => {
  const parentNote = "- [ ] #task Parent ^parent";
  const { plugin } = stubPlugin({
    "Tasks.md": parentNote,
    "cash.md": "- [ ] #task Cash ^a",
    "chat/cash.md": "- [ ] #task Cash ^a",
  });
  // No vault or resolver stubs: the plugin's own linkpath resolution and
  // vault file list run against the async vault stub below.
  const editor = new TransactionEditor(parentNote, { line: 0, ch: 0 });
  const outcome = await plugin.applyDependencyEdit({
    editor,
    parentPath: "Tasks.md",
    parentLine: 0,
    add: [{ path: "chat/cash.md", blockId: "a" }],
    remove: [],
  });
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.match(editor.content, /\[\[chat\/cash#\^a\]\]/);
});

// Adds never snapshot — even on a `[?]` parent that already carries a
// field — and a mirror touch on a non-Blocked parent reads nothing: both
// count zero `cachedRead` calls through the real async vault stub.
test("adds on Blocked parents and non-Blocked mirror touches read nothing", async () => {
  const countReads = (plugin) => {
    let reads = 0;
    const vault = plugin.app.vault;
    const originalCachedRead = vault.cachedRead;
    vault.cachedRead = async (file) => {
      reads += 1;
      return originalCachedRead(file);
    };
    return () => reads;
  };

  const blockedNote = [
    "- [?] #task P [dependsOn:: Tasks__a] ^p",
    "  - ⛓️ **DEPENDS ON:** [[#^a]]",
    "- [ ] #task A [id:: Tasks__a] ^a",
    "- [ ] #task B [id:: Tasks__b] ^b",
  ].join("\n");
  const { plugin } = stubPlugin({
    "Tasks.md": blockedNote,
    "Other.md": "- [ ] #task Other ^other",
  });
  const readCount = countReads(plugin);
  const editor = new TransactionEditor(blockedNote, { line: 0, ch: 0 });
  const added = await plugin.applyDependencyEdit({
    editor,
    parentPath: "Tasks.md",
    parentLine: 0,
    add: [{ path: "Tasks.md", blockId: "b" }],
    remove: [],
  });
  assert.equal(added.ok, true, JSON.stringify(added));
  assert.equal(readCount(), 0);
  assert.match(editor.content, /\[\[#\^b\]\]/);

  const plainNote = "- [ ] #task P ^p";
  const { plugin: mirrorPlugin } = stubPlugin({
    "Tasks.md": plainNote,
    "Other.md": "- [ ] #task Other ^other",
  });
  const mirrorReads = countReads(mirrorPlugin);
  const mirrorEditor = new TransactionEditor(plainNote, { line: 0, ch: 0 });
  const touched = await mirrorPlugin.applyDependencyEdit({
    editor: mirrorEditor,
    parentPath: "Tasks.md",
    parentLine: 0,
    add: [],
    remove: [],
    mirrorTouch: true,
  });
  assert.equal(touched.ok, true, JSON.stringify(touched));
  assert.equal(mirrorReads(), 0);
});

// A counted vault add loads the notes behind each source's existing links:
// a source with an unloaded cross-note link and a missing field still
// adds instead of refusing `target-not-found`.
test("counted vault add loads each source's existing links", async () => {
  const ownerNote = [
    "- [ ] #task First",
    "  - ⛓️ **DEPENDS ON:** [[Other#^x]]",
    "- [ ] #task Second ^second",
    "- [ ] #task Target ^target",
  ].join("\n");
  const { plugin } = stubPlugin({
    "Tasks.md": ownerNote,
    "Other.md": "- [ ] #task Ex ^x",
  });
  const editor = new TransactionEditor(ownerNote, { line: 0, ch: 0 });
  const modal = stubModal(plugin, editor, "Tasks.md", 0);
  modal.taskSession = {
    valid: true,
    targets: [
      { line: 0, rawLine: "- [ ] #task First" },
      { line: 2, rawLine: "- [ ] #task Second ^second" },
    ],
  };
  const applied = await modal.applyVaultCountedDependencyRef({
    path: "Tasks.md",
    line: 3,
    rawLine: "- [ ] #task Target ^target",
    displayText: "Target",
    existingIdField: null,
    blockId: "target",
  });
  assert.equal(applied, true);
  assert.equal(editor.undoGroups, 1);
  const lines = editor.content.split("\n");
  assert.match(lines[0], /\[dependsOn:: Other__x, Tasks__target\]/);
  assert.match(editor.content, /\[\[Other#\^x\]\]/);
  assert.match(editor.content, /\[\[#\^target\]\]/);
});

// Counted Ctrl+D on a blockquoted task refuses with the blockquote notice
// and writes nothing.
test("counted Ctrl+D on a blockquoted task refuses with the blockquote notice", async () => {
  const content = [
    "- [?] #task First [dependsOn:: Tasks__a] ^first",
    "  - ⛓️ **DEPENDS ON:** [[#^a]]",
    "> - [?] #task Quoted [dependsOn:: Tasks__a] ^quoted",
    "- [x] #task A [id:: Tasks__a] ^a",
  ].join("\n");
  const { plugin } = stubPlugin({ "Tasks.md": content });
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  plugin.getActiveMarkdownView = () => ({
    editor,
    file: { path: "Tasks.md" },
  });
  const session = {
    valid: true,
    targets: [
      { line: 0, rawLine: content.split("\n")[0] },
      { line: 2, rawLine: content.split("\n")[2] },
    ],
  };
  const before = notices.length;
  const result = await plugin.deleteCountedDependencyLinesAndFields(
    editor,
    { line: 0, ch: 0 },
    "Tasks.md",
    session,
  );
  assert.equal(result, null);
  assert.equal(editor.content, content);
  assert.equal(editor.undoGroups, 0);
  assert.ok(
    notices.slice(before).some((message) => message.includes("inside a blockquote")),
    JSON.stringify(notices.slice(before)),
  );
});

// Single Ctrl+D on a quoted task with no field refuses with the blockquote
// notice instead of reporting `dependsOn is not set on this bullet`.
test("single Ctrl+D on a quoted task without a field refuses as a blockquote", async () => {
  const content = [
    "> - [ ] #task Quoted ^quoted",
    "- [ ] #task Other ^other",
  ].join("\n");
  const { plugin } = stubPlugin({ "Tasks.md": content });
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  plugin.getActiveMarkdownView = () => ({
    editor,
    file: { path: "Tasks.md" },
  });
  const before = notices.length;
  const result = await plugin.deleteDependencyLineAndField(
    editor,
    { line: 0, ch: 0 },
    { filePath: "Tasks.md" },
  );
  assert.equal(result, null);
  assert.equal(editor.content, content);
  assert.equal(editor.undoGroups, 0);
  assert.ok(
    notices.slice(before).some((message) => message.includes("inside a blockquote")),
    JSON.stringify(notices.slice(before)),
  );
});

// `pendingTargetLine` through `confirmSingleBlockId`, with and without an
// existing Depends-On line: the target gains `^id`/`[id::]`, the dependent
// gains the link, everything lands in one undo group.
test("confirmSingleBlockId folds the target id into one transaction", async () => {
  for (const withExisting of [false, true]) {
    const content = [
      withExisting
        ? "- [?] #task P [dependsOn:: Tasks__a] ^p"
        : "- [ ] #task Parent ^parent",
      ...(withExisting ? ["  - ⛓️ **DEPENDS ON:** [[#^a]]"] : []),
      ...(withExisting ? ["- [ ] #task A [id:: Tasks__a] ^a"] : []),
      "- [ ] #task Target",
    ].join("\n");
    const { plugin } = stubPlugin({ "Tasks.md": content });
    const editor = new TransactionEditor(content, { line: 0, ch: 0 });
    const modal = stubModal(plugin, editor, "Tasks.md", 0);
    modal.selectedPropertyItem = { property: { name: "dependsOn" } };
    modal.lineText = content.split("\n")[0];
    const targetLine = content.split("\n").indexOf("- [ ] #task Target");
    modal.pendingTask = {
      line: targetLine,
      rawLine: "- [ ] #task Target",
    };
    const linked = modal.confirmSingleBlockId({ id: "b" });
    assert.equal(linked, true);
    assert.equal(editor.undoGroups, 1);
    assert.match(editor.content, /- \[ \] #task Target \[id:: Tasks__b\] \^b/);
    assert.match(editor.content, /\[\[#\^b\]\]/);
    if (withExisting) {
      assert.match(editor.content, /\[\[#\^a\]\]/);
    }
  }
});

// `pendingTargetLine` through `chooseTaskDependency`, with and without an
// existing Depends-On line: a target with a `^id` but no `[id::]` gains
// the field while the link lands in one undo group.
test("chooseTaskDependency folds a missing target id into one transaction", async () => {
  for (const withExisting of [false, true]) {
    const content = [
      withExisting
        ? "- [?] #task P [dependsOn:: Tasks__a] ^p"
        : "- [ ] #task Parent ^parent",
      ...(withExisting ? ["  - ⛓️ **DEPENDS ON:** [[#^a]]"] : []),
      ...(withExisting ? ["- [ ] #task A [id:: Tasks__a] ^a"] : []),
      "- [ ] #task Target ^target",
    ].join("\n");
    const { plugin } = stubPlugin({ "Tasks.md": content });
    const editor = new TransactionEditor(content, { line: 0, ch: 0 });
    const modal = stubModal(plugin, editor, "Tasks.md", 0);
    modal.selectedPropertyItem = { property: { name: "dependsOn" } };
    modal.lineText = content.split("\n")[0];
    const targetLine = content.split("\n").indexOf("- [ ] #task Target ^target");
    const linked = await modal.chooseTaskDependency({
      path: "Tasks.md",
      line: targetLine,
      rawLine: "- [ ] #task Target ^target",
      displayText: "Target",
      existingIdField: null,
      blockId: "target",
      alreadyLinked: false,
    });
    assert.equal(linked, true);
    assert.equal(editor.undoGroups, 1);
    assert.match(editor.content, /- \[ \] #task Target \[id:: Tasks__target\] \^target/);
    assert.match(editor.content, /\[\[#\^target\]\]/);
    if (withExisting) {
      assert.match(editor.content, /\[\[#\^a\]\]/);
    }
  }
});

// Counted remove commits once: every source clears in one undo group, and a
// source that fails to plan — even when it sorts after a healthy source in
// bottom-up order — refuses before any write. (A cross-note target, so the
// CURRENT-row shortcut cannot claim the gesture and the per-source planner
// loop runs.)
test("counted remove commits every source in one transaction", async () => {
  const otherNote = "- [x] #task Ex [id:: Other__x] ^x";
  const content = [
    "> - [?] #task Quoted [dependsOn:: Other__x] ^quoted",
    "  - ⛓️ **DEPENDS ON:** [[Other#^x]]",
    "- [?] #task First [dependsOn:: Other__x] ^first",
    "  - ⛓️ **DEPENDS ON:** [[Other#^x]]",
    "- [?] #task Second [dependsOn:: Other__x] ^second",
    "  - ⛓️ **DEPENDS ON:** [[Other#^x]]",
  ].join("\n");
  const { plugin } = stubPlugin({ "Tasks.md": content, "Other.md": otherNote });
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  const modal = stubModal(plugin, editor, "Tasks.md", 0);
  modal.taskSession = {
    valid: true,
    targets: [
      {
        line: 0,
        rawLine: "> - [?] #task Quoted [dependsOn:: Other__x] ^quoted",
      },
      {
        line: 2,
        rawLine: "- [?] #task First [dependsOn:: Other__x] ^first",
      },
      {
        line: 4,
        rawLine: "- [?] #task Second [dependsOn:: Other__x] ^second",
      },
    ],
  };
  const before = notices.length;
  // Bottom-up plans line 4, then line 2, and only then hits the quoted
  // line 0: the refusal must leave the healthy sources untouched.
  const refused = await modal.removeCountedDependency({
    stageSection: "results",
    alreadyLinked: false,
    path: "Other.md",
    blockId: "x",
    existingBlockId: "x",
    displayText: "Ex",
    existingIdField: "Other__x",
  });
  assert.equal(refused, false);
  assert.equal(editor.content, content);
  assert.equal(editor.undoGroups, 0);
  assert.ok(
    notices.slice(before).some((message) => message.includes("no tasks were updated")),
    JSON.stringify(notices.slice(before)),
  );

  const healthy = [
    "- [?] #task First [dependsOn:: Other__x] ^first",
    "  - ⛓️ **DEPENDS ON:** [[Other#^x]]",
    "- [?] #task Second [dependsOn:: Other__x] ^second",
    "  - ⛓️ **DEPENDS ON:** [[Other#^x]]",
  ].join("\n");
  const { plugin: healthyPlugin } = stubPlugin({ "Tasks.md": healthy, "Other.md": otherNote });
  const healthyEditor = new TransactionEditor(healthy, { line: 0, ch: 0 });
  const healthyModal = stubModal(healthyPlugin, healthyEditor, "Tasks.md", 0);
  healthyModal.taskSession = {
    valid: true,
    targets: [
      {
        line: 0,
        rawLine: "- [?] #task First [dependsOn:: Other__x] ^first",
      },
      {
        line: 2,
        rawLine: "- [?] #task Second [dependsOn:: Other__x] ^second",
      },
    ],
  };
  const removed = await healthyModal.removeCountedDependency({
    stageSection: "results",
    alreadyLinked: false,
    path: "Other.md",
    blockId: "x",
    existingBlockId: "x",
    displayText: "Ex",
    existingIdField: "Other__x",
  });
  assert.equal(removed, true);
  assert.equal(healthyEditor.undoGroups, 1);
  assert.doesNotMatch(healthyEditor.content, /DEPENDS ON/);
  assert.doesNotMatch(healthyEditor.content, /dependsOn/);
});
