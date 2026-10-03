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

// A subfolder target with a duplicate basename keeps its full route: link
// form ranks against the vault file list and paths resolve through the
// linkpath resolver.
test("duplicate basenames keep the full route", () => {
  const link = helpers.canonicalDependencyLink(
    { path: "chat/cash.md", blockId: "a" },
    "Tasks.md",
    ["Tasks.md", "cash.md", "chat/cash.md"],
  );
  assert.equal(link.text, "[[chat/cash#^a]]");
  const resolved = helpers.dependencyPathForLinkNote("cash", "Tasks.md", () => "chat/cash.md");
  assert.equal(resolved, "chat/cash.md");
  const fallback = helpers.dependencyPathForLinkNote("cash", "Tasks.md", null);
  assert.equal(fallback, "cash.md");
});

// Recovery resolves over the vault snapshot: a dependent linked from
// today's Pomodoro recovers to Next, not Ready.
test("Pomodoro-linked dependents recover to Next from the daily note", () => {
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
  const today = new Date(2026, 9, 3);
  const dailyPath = "2026/20261003.md";
  const registry = helpers.parseTasksStatusRegistry(compatibleTasksSettings());
  assert.equal(registry.safe, true);
  const withDaily = helpers.planDependencyEdit({
    content: parentNote,
    parentLine: 0,
    parentPath: "Tasks.md",
    add: [],
    remove: [{ path: "Tasks.md", blockId: "a" }],
    files: { "Tasks.md": parentNote },
    recovery: {
      registry,
      today,
      vaultContents: { "Tasks.md": parentNote, [dailyPath]: dailyNote },
    },
  });
  assert.equal(withDaily.ok, true, withDaily.reason);
  assert.match(withDaily.nextContent, /- \[\*\] #task P \^p$/m);

  const withoutDaily = helpers.planDependencyEdit({
    content: parentNote,
    parentLine: 0,
    parentPath: "Tasks.md",
    add: [],
    remove: [{ path: "Tasks.md", blockId: "a" }],
    files: { "Tasks.md": parentNote },
    recovery: { registry, today },
  });
  assert.equal(withoutDaily.ok, true, withoutDaily.reason);
  assert.match(withoutDaily.nextContent, /- \[ \] #task P \^p$/m);
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
