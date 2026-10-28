// Relation cancel writer: applyRelationEdit folds Task Card Cancel into the
// source write (`docs/task-relations.md` §17 / bob-cli-dl.5).
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const notices = [];
const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    class EmptyClass {}
    return {
      MarkdownView: EmptyClass,
      Modal: class {
        constructor(app) {
          this.app = app;
        }
      },
      Notice: class {
        constructor(message) {
          notices.push(String(message));
        }
      },
      Plugin: EmptyClass,
      parseYaml: () => ({}),
    };
  }
  if (request === "@codemirror/view") return { EditorView: class {} };
  return originalLoad.call(this, request, parent, isMain);
};
const NavigationHotkeysPlugin = require("../plugins/bob-navigation-hotkeys/main.js");
const { helpers } = NavigationHotkeysPlugin;
Module._load = originalLoad;

const TODAY = new Date(2026, 9, 22);
const DAILY = "2026/20261022.md";
const CANCEL_LABELS = ["duplicate of", "superseded by"];

class TestEditor {
  constructor(content) {
    this.content = String(content || "");
    this.undoGroups = 0;
    this.history = [this.content];
    this.lastAnnotation = null;
  }
  getValue() {
    return this.content;
  }
  undo() {
    if (this.history.length > 1) {
      this.history.pop();
      this.content = this.history[this.history.length - 1];
    }
  }
  transaction(transaction) {
    this.lastAnnotation = transaction.annotation || null;
    const changes = [...(transaction.changes || [])].sort(
      (a, b) => b.from.line - a.from.line || b.from.ch - a.from.ch,
    );
    if (changes.length > 0) {
      this.undoGroups += 1;
      this.history.push(this.content);
    }
    const lines = this.content.split(/\r?\n/);
    for (const change of changes) {
      const offset = (position) =>
        lines
          .slice(0, position.line)
          .reduce(
            (sum, line) =>
              sum + line.length + (this.content.includes("\r\n") ? 2 : 1),
            0,
          ) + position.ch;
      const start = offset(change.from);
      const end = offset(change.to || change.from);
      this.content =
        this.content.slice(0, start) + change.text + this.content.slice(end);
    }
    if (changes.length > 0) this.history[this.history.length - 1] = this.content;
  }
}

function makePlugin(notes, options = {}) {
  const store = new Map(Object.entries(notes));
  const openEditors = new Map();
  const recoveryCalls = [];
  const vault = {
    getMarkdownFiles: () =>
      [...store.keys()]
        .filter((path) => /\.md$/i.test(path))
        .map((path) => ({ path })),
    getAbstractFileByPath: (path) => (store.has(path) ? { path } : null),
    cachedRead: async (file) => {
      if (options.unreadable && options.unreadable.has(file.path)) {
        throw new Error("unreadable");
      }
      return String(store.get(file.path) || "");
    },
    read: async (file) => vault.cachedRead(file),
    process: async (file, transform) => {
      store.set(file.path, String(transform(String(store.get(file.path) || ""))));
    },
  };
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    vault,
    metadataCache: {
      getFirstLinkpathDest: (linkpath) => {
        const wanted = String(linkpath || "").replace(/\.md$/i, "");
        const exact = `${wanted}.md`;
        if (store.has(exact)) return { path: exact };
        const matches = [...store.keys()].filter(
          (path) =>
            /\.md$/i.test(path) &&
            path.split("/").pop().replace(/\.md$/i, "").toLowerCase() ===
              wanted.toLowerCase(),
        );
        return matches.length === 1 ? { path: matches[0] } : null;
      },
    },
    workspace: {
      getLeavesOfType: () =>
        [...openEditors].map(([path, editor]) => ({
          view: { file: { path }, editor },
        })),
      getActiveFile: () => null,
    },
    plugins: {
      plugins: {
        "task-status-cycler": {
          api: {
            version: 1,
            recoverBlockedDependents: async (identities, context) => {
              recoveryCalls.push({ identities, context });
              if (typeof options.recover === "function") {
                return options.recover(identities, context, store);
              }
              return { reopened: options.reopened || 0, failures: [] };
            },
          },
        },
      },
    },
  };
  return { plugin, store, openEditors, recoveryCalls };
}

function dailyNote(extra = "") {
  const lines = ["## Pomodoros", "", "- [ ] Current (0900-0930)"];
  if (extra) lines.push(extra);
  lines.push("  - keep me");
  return lines.join("\n");
}

test("same-note cancel is one transaction and undo restores LINKS/status/log", async () => {
  const source = [
    "- [ ] #task Source ^source",
    "  - ❌ **CANCEL LOG**",
    "    - *2026-10-01* — earlier",
    "- [ ] #task Target ^target",
  ].join("\n");
  const harness = makePlugin({ "Tasks.md": source });
  const editor = new TestEditor(source);
  harness.openEditors.set("Tasks.md", editor);
  const outcome = await harness.plugin.applyRelationEdit({
    sources: [{ path: "Tasks.md", line: 0, blockId: "source" }],
    add: [{ path: "Tasks.md", blockId: "target", label: "duplicate of" }],
    cancelLabels: CANCEL_LABELS,
    cancelDate: "2026-10-22",
    today: TODAY,
    linkedFromLinesEnabled: true,
  });
  assert.equal(outcome.ok, true);
  assert.equal(editor.undoGroups, 1);
  assert.match(editor.getValue(), /^- \[-] #task Source .*\[cancelled:: 2026-10-22]/m);
  assert.match(editor.getValue(), /🪢 \*\*LINKS:\*\* duplicate of \[\[#\^target\]\]/);
  assert.match(editor.getValue(), /\*2026-10-22\* — 🪢 duplicate of \[\[#\^target\]\]/);
  assert.match(outcome.notice, /⊘ cancelled/);
  editor.undo();
  assert.equal(editor.getValue(), source);
});

test("cross-note sources cancel the source and follow up the target", async () => {
  const harness = makePlugin({
    "Tasks.md": "- [ ] #task Source ^source",
    "Other.md": "- [ ] #task Target ^target",
  });
  const editor = new TestEditor("- [ ] #task Source ^source");
  harness.openEditors.set("Tasks.md", editor);
  const outcome = await harness.plugin.applyRelationEdit({
    sources: [{ path: "Tasks.md", line: 0, blockId: "source" }],
    add: [{ path: "Other.md", blockId: "target", label: "duplicate of" }],
    cancelLabels: CANCEL_LABELS,
    cancelDate: "2026-10-22",
    today: TODAY,
    linkedFromLinesEnabled: true,
  });
  assert.equal(outcome.ok, true);
  assert.match(editor.getValue(), /^- \[-] #task Source/m);
  assert.match(harness.store.get("Other.md"), /LINKED FROM/);
});

test("all open statuses cancel; closed statuses keep their date", async () => {
  for (const [status, open] of [
    [" ", true],
    ["/", true],
    ["*", true],
    ["?", true],
    ["x", false],
    ["-", false],
  ]) {
    const closedDate = "[cancelled:: 2026-10-01] ";
    const source = `- [${status}] #task Source ${open ? "" : closedDate}^source\n- [ ] #task Target ^target`;
    const harness = makePlugin({ "Tasks.md": source });
    const outcome = await harness.plugin.applyRelationEdit({
      sources: [{ path: "Tasks.md", line: 0, blockId: "source" }],
      add: [{ path: "Tasks.md", blockId: "target", label: "duplicate of" }],
      cancelLabels: CANCEL_LABELS,
      cancelDate: "2026-10-22",
      today: TODAY,
      linkedFromLinesEnabled: false,
    });
    assert.equal(outcome.ok, true, status);
    if (open) {
      assert.match(harness.store.get("Tasks.md"), /^- \[-] #task Source .*\[cancelled:: 2026-10-22]/m);
    } else {
      assert.match(harness.store.get("Tasks.md"), new RegExp(`^- \\[${status}\\] #task Source`));
      if (status === "-") {
        assert.match(harness.store.get("Tasks.md"), /\[cancelled:: 2026-10-01]/);
      }
    }
  }
});

test("recurring refusal writes nothing in a multi-source batch", async () => {
  const source = [
    "- [ ] #task Recurring 🔁 ^recurring",
    "- [ ] #task Open ^open",
    "- [ ] #task Target ^target",
  ].join("\n");
  const harness = makePlugin({ "Tasks.md": source });
  const editor = new TestEditor(source);
  harness.openEditors.set("Tasks.md", editor);
  const outcome = await harness.plugin.applyRelationEdit({
    sources: [
      { path: "Tasks.md", line: 0, blockId: "recurring" },
      { path: "Tasks.md", line: 1, blockId: "open" },
    ],
    add: [{ path: "Tasks.md", blockId: "target", label: "duplicate of" }],
    cancelLabels: CANCEL_LABELS,
    cancelDate: "2026-10-22",
    today: TODAY,
    linkedFromLinesEnabled: false,
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, "relation_cancels_recurring_task");
  assert.equal(editor.getValue(), source);
});

test("relabel into a cancel key cancels; same-key retry does not", async () => {
  const source = [
    "- [ ] #task Source ^source",
    "  - 🪢 **LINKS:** see [[#^target]]",
    "- [ ] #task Target ^target",
  ].join("\n");
  const harness = makePlugin({ "Tasks.md": source });
  const relabel = await harness.plugin.applyRelationEdit({
    sources: [{ path: "Tasks.md", line: 0, blockId: "source" }],
    relabel: [{ path: "Tasks.md", blockId: "target", label: "duplicate of" }],
    cancelLabels: CANCEL_LABELS,
    cancelDate: "2026-10-22",
    today: TODAY,
    linkedFromLinesEnabled: false,
  });
  assert.equal(relabel.ok, true);
  assert.match(harness.store.get("Tasks.md"), /^- \[-] #task Source/m);
  assert.match(relabel.notice, /⊘ cancelled/);

  const sameKey = await harness.plugin.applyRelationEdit({
    sources: [{ path: "Tasks.md", line: 0, blockId: "source" }],
    relabel: [{ path: "Tasks.md", blockId: "target", label: "Duplicate  Of:" }],
    cancelLabels: CANCEL_LABELS,
    cancelDate: "2026-10-22",
    today: TODAY,
    linkedFromLinesEnabled: false,
  });
  assert.equal(sameKey.ok, true);
  assert.doesNotMatch(sameKey.notice || "", /⊘ cancelled/);
});

test("two cancel edges produce one fallback log entry", async () => {
  const source = [
    "- [ ] #task Source ^source",
    "  - ❌ **CANCEL LOG**",
    "    - *2026-10-01* — earlier",
    "- [ ] #task Alpha ^alpha",
    "- [ ] #task Beta ^beta",
  ].join("\n");
  const harness = makePlugin({ "Tasks.md": source });
  const outcome = await harness.plugin.applyRelationEdit({
    sources: [{ path: "Tasks.md", line: 0, blockId: "source" }],
    add: [
      { path: "Tasks.md", blockId: "alpha", label: "duplicate of" },
      { path: "Tasks.md", blockId: "beta", label: "superseded by" },
    ],
    cancelLabels: CANCEL_LABELS,
    cancelDate: "2026-10-22",
    today: TODAY,
    linkedFromLinesEnabled: false,
  });
  assert.equal(outcome.ok, true);
  const text = harness.store.get("Tasks.md");
  const fallback = text.match(/^\s+- \*2026-10-22\* — (.+)$/m);
  assert.ok(fallback);
  assert.match(fallback[1], /duplicate of/);
  assert.match(fallback[1], /superseded by/);
  assert.match(fallback[1], / · /);
  assert.equal((text.match(/\*2026-10-22\*/g) || []).length, 1);
});

test("hidden and one-off cancel labels still match configured keys", async () => {
  const source = "- [ ] #task Source ^source\n- [ ] #task Target ^target";
  const harness = makePlugin({ "Tasks.md": source });
  const outcome = await harness.plugin.applyRelationEdit({
    sources: [{ path: "Tasks.md", line: 0, blockId: "source" }],
    add: [{ path: "Tasks.md", blockId: "target", label: "Duplicate Of" }],
    cancelLabels: CANCEL_LABELS,
    cancelDate: "2026-10-22",
    today: TODAY,
    linkedFromLinesEnabled: false,
  });
  assert.equal(outcome.ok, true);
  assert.match(harness.store.get("Tasks.md"), /^- \[-] #task Source/m);
});

test("no-id sources and linked_from_lines false still cancel", async () => {
  const source = "- [ ] #task Source\n- [ ] #task Target ^target";
  const harness = makePlugin({ "Tasks.md": source });
  const outcome = await harness.plugin.applyRelationEdit({
    sources: [{ path: "Tasks.md", line: 0 }],
    add: [{ path: "Tasks.md", blockId: "target", label: "duplicate of" }],
    cancelLabels: CANCEL_LABELS,
    cancelDate: "2026-10-22",
    today: TODAY,
    linkedFromLinesEnabled: false,
  });
  assert.equal(outcome.ok, true);
  assert.match(harness.store.get("Tasks.md"), /^- \[-] #task Source/m);
  assert.doesNotMatch(harness.store.get("Tasks.md"), /LINKED FROM/);
});

test("unlink and empty policy never cancel", async () => {
  const source = [
    "- [ ] #task Source ^source",
    "  - 🪢 **LINKS:** duplicate of [[#^target]]",
    "- [ ] #task Target ^target",
  ].join("\n");
  const harness = makePlugin({ "Tasks.md": source });
  const unlinked = await harness.plugin.applyRelationEdit({
    sources: [{ path: "Tasks.md", line: 0, blockId: "source" }],
    remove: [{ path: "Tasks.md", blockId: "target" }],
    cancelLabels: CANCEL_LABELS,
    cancelDate: "2026-10-22",
    today: TODAY,
    linkedFromLinesEnabled: false,
  });
  assert.equal(unlinked.ok, true);
  assert.match(harness.store.get("Tasks.md"), /^- \[ \] #task Source/m);
  assert.doesNotMatch(unlinked.notice || "", /⊘ cancelled/);

  const empty = await harness.plugin.applyRelationEdit({
    sources: [{ path: "Tasks.md", line: 0, blockId: "source" }],
    add: [{ path: "Tasks.md", blockId: "target", label: "duplicate of" }],
    cancelLabels: [],
    cancelDate: "2026-10-22",
    today: TODAY,
    linkedFromLinesEnabled: false,
  });
  assert.equal(empty.ok, true);
  assert.match(harness.store.get("Tasks.md"), /^- \[ \] #task Source/m);
});

test("hand-edit mirror never calls the cancel planner", async () => {
  const before = "- [ ] #task Source ^source\n- [ ] #task Target ^target";
  const after = [
    "- [ ] #task Source ^source",
    "  - 🪢 **LINKS:** duplicate of [[#^target]]",
    "- [ ] #task Target ^target",
  ].join("\n");
  const harness = makePlugin({ "Tasks.md": after });
  const editor = new TestEditor(after);
  harness.openEditors.set("Tasks.md", editor);
  const mirrored = await harness.plugin.mirrorRelationHandEdit(
    editor,
    "Tasks.md",
    before,
    0,
    0,
  );
  assert.equal(mirrored.mirrored, true);
  assert.match(editor.getValue(), /^- \[ \] #task Source/m);
});

test("source on today's daily folds prune into the same write", async () => {
  const source = [
    "## Pomodoros",
    "",
    "- [ ] Current (0900-0930)",
    "  - [[#^source]]",
    "- [ ] #task Source ^source",
    "- [ ] #task Target ^target",
  ].join("\n");
  const harness = makePlugin({
    [DAILY]: source,
    "Tasks.md": "- [ ] #task Other ^other",
  });
  const editor = new TestEditor(source);
  harness.openEditors.set(DAILY, editor);
  const outcome = await harness.plugin.applyRelationEdit({
    sources: [{ path: DAILY, line: 4, blockId: "source" }],
    add: [{ path: DAILY, blockId: "target", label: "duplicate of" }],
    cancelLabels: CANCEL_LABELS,
    cancelDate: "2026-10-22",
    today: TODAY,
    linkedFromLinesEnabled: false,
  });
  assert.equal(outcome.ok, true);
  assert.equal(editor.undoGroups, 1);
  assert.doesNotMatch(editor.getValue(), /\[\[#\^source\]\]/);
  assert.match(outcome.notice, /removed 1 Pomodoro link/);
});

test("absent daily is zero cleanup; unreadable daily refuses before writes", async () => {
  const source = "- [ ] #task Source ^source\n- [ ] #task Target ^target";
  const absent = makePlugin({ "Tasks.md": source });
  const ok = await absent.plugin.applyRelationEdit({
    sources: [{ path: "Tasks.md", line: 0, blockId: "source" }],
    add: [{ path: "Tasks.md", blockId: "target", label: "duplicate of" }],
    cancelLabels: CANCEL_LABELS,
    cancelDate: "2026-10-22",
    today: TODAY,
    linkedFromLinesEnabled: false,
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.pomodoroLinksRemoved, 0);

  const unreadable = makePlugin(
    {
      "Tasks.md": source,
      [DAILY]: dailyNote("  - [[Tasks#^source]]"),
    },
    { unreadable: new Set([DAILY]) },
  );
  const refused = await unreadable.plugin.applyRelationEdit({
    sources: [{ path: "Tasks.md", line: 0, blockId: "source" }],
    add: [{ path: "Tasks.md", blockId: "target", label: "duplicate of" }],
    cancelLabels: CANCEL_LABELS,
    cancelDate: "2026-10-22",
    today: TODAY,
    linkedFromLinesEnabled: false,
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, "unreadable-daily");
  assert.match(unreadable.store.get("Tasks.md"), /^- \[ \] #task Source/m);
});

test("recovery receives cancelled identities and never offers successors", async () => {
  const source = "- [ ] #task Source [id:: Tasks/source] ^source\n- [ ] #task Target ^target";
  const harness = makePlugin(
    { "Tasks.md": source },
    { reopened: 1 },
  );
  const outcome = await harness.plugin.applyRelationEdit({
    sources: [{ path: "Tasks.md", line: 0, blockId: "source" }],
    add: [{ path: "Tasks.md", blockId: "target", label: "duplicate of" }],
    cancelLabels: CANCEL_LABELS,
    cancelDate: "2026-10-22",
    today: TODAY,
    linkedFromLinesEnabled: false,
  });
  assert.equal(outcome.ok, true);
  assert.equal(harness.recoveryCalls.length, 1);
  assert.equal(harness.recoveryCalls[0].identities[0].path, "Tasks.md");
  assert.equal(harness.recoveryCalls[0].identities[0].blockId, "source");
  assert.match(outcome.notice, /unblocked 1/);
  assert.equal(typeof harness.plugin.app.plugins.plugins["task-status-cycler"].api.offerSuccessors, "undefined");
});

test("stale expected effects and midnight/config replans write nothing", async () => {
  const source = "- [ ] #task Source ^source\n- [ ] #task Target ^target";
  const harness = makePlugin({ "Tasks.md": source });
  const live = await harness.plugin.applyRelationEdit({
    sources: [{ path: "Tasks.md", line: 0, blockId: "source" }],
    add: [{ path: "Tasks.md", blockId: "target", label: "duplicate of" }],
    cancelLabels: CANCEL_LABELS,
    cancelDate: "2026-10-22",
    today: TODAY,
    linkedFromLinesEnabled: false,
    expectedCancelEffects: { day: "2026-10-21", sources: [] },
  });
  assert.equal(live.ok, false);
  assert.equal(live.stale, true);
  assert.ok(live.cancelEffects);
  assert.match(harness.store.get("Tasks.md"), /^- \[ \] #task Source/m);

  const second = await harness.plugin.applyRelationEdit({
    sources: [{ path: "Tasks.md", line: 0, blockId: "source" }],
    add: [{ path: "Tasks.md", blockId: "target", label: "duplicate of" }],
    cancelLabels: CANCEL_LABELS,
    cancelDate: "2026-10-22",
    today: TODAY,
    linkedFromLinesEnabled: false,
    expectedCancelEffects: live.cancelEffects,
  });
  assert.equal(second.ok, true);
  assert.match(harness.store.get("Tasks.md"), /^- \[-] #task Source/m);
});

test("Linked-from sources cancel; applyRelationCancelStaleToPicker keeps the stage open", async () => {
  const source = "- [ ] #task Incoming ^incoming";
  const target = "- [ ] #task Here ^here";
  const harness = makePlugin({ "In.md": source, "Here.md": target });
  const outcome = await harness.plugin.applyRelationEdit({
    sources: [{ path: "In.md", line: 0, blockId: "incoming" }],
    add: [{ path: "Here.md", blockId: "here", label: "duplicate of" }],
    direction: "from",
    cancelLabels: CANCEL_LABELS,
    cancelDate: "2026-10-22",
    today: TODAY,
    linkedFromLinesEnabled: false,
  });
  assert.equal(outcome.ok, true);
  assert.match(harness.store.get("In.md"), /^- \[-] #task Incoming/m);
  assert.match(outcome.notice, /⊘ cancelled/);

  const picker = {
    relationCancelExpected: { day: "old" },
    relationCancelConfirmNonce: 1,
    refreshed: false,
    refreshRelationConsequenceStrip() {
      this.refreshed = true;
    },
  };
  assert.equal(
    helpers.applyRelationCancelStaleToPicker(picker, {
      stale: true,
      cancelEffects: { day: "2026-10-22", sources: [] },
    }),
    true,
  );
  assert.deepEqual(picker.relationCancelExpected, { day: "2026-10-22", sources: [] });
  assert.equal(picker.relationCancelConfirmNonce, null);
  assert.equal(picker.refreshed, true);
});

test("multiple sources in one note relocate after a log insert", async () => {
  const source = [
    "- [ ] #task First ^first",
    "  - ❌ **CANCEL LOG**",
    "    - *2026-10-01* — earlier",
    "- [ ] #task Second ^second",
    "- [ ] #task Target ^target",
  ].join("\n");
  const harness = makePlugin({ "Tasks.md": source });
  const outcome = await harness.plugin.applyRelationEdit({
    sources: [
      { path: "Tasks.md", line: 0, blockId: "first" },
      { path: "Tasks.md", line: 3, blockId: "second" },
    ],
    add: [{ path: "Tasks.md", blockId: "target", label: "duplicate of" }],
    cancelLabels: CANCEL_LABELS,
    cancelDate: "2026-10-22",
    today: TODAY,
    linkedFromLinesEnabled: false,
  });
  assert.equal(outcome.ok, true);
  const text = harness.store.get("Tasks.md");
  assert.match(text, /^- \[-] #task First/m);
  assert.match(text, /^- \[-] #task Second/m);
});

test("failed prune reports the chip and never claims a count", async () => {
  const source = "- [ ] #task Source ^source\n- [ ] #task Target ^target";
  const harness = makePlugin({
    "Tasks.md": source,
    [DAILY]: dailyNote("  - [[Tasks#^source]]"),
  });
  harness.plugin.writeDeferredPomodoroCleanup = async () => false;
  const outcome = await harness.plugin.applyRelationEdit({
    sources: [{ path: "Tasks.md", line: 0, blockId: "source" }],
    add: [{ path: "Tasks.md", blockId: "target", label: "duplicate of" }],
    cancelLabels: CANCEL_LABELS,
    cancelDate: "2026-10-22",
    today: TODAY,
    linkedFromLinesEnabled: false,
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.pruneFailed, true);
  assert.equal(outcome.pomodoroLinksRemoved, 0);
  assert.match(outcome.notice, /Pomodoro links not removed/);
  assert.doesNotMatch(outcome.notice, /removed \d+ Pomodoro/);
});

test("cycler recovers ordinary dependents, keeps extra-prereq blocked, and reopens project residents", async () => {
  const {
    TaskStatusCyclerPlugin,
    createInMemoryObsidianApp,
    createTextEditor,
    attachActiveMarkdownView,
  } = require("./task-status-cycler-harness.cjs");

  const ordinary = [
    "- [?] #task Blocked [dependsOn:: source] ^blocked",
    "- [-] #task Source [id:: source] ^source",
  ].join("\n");
  const ordinaryApp = createInMemoryObsidianApp({ "Tasks.md": ordinary });
  const ordinaryEditor = createTextEditor(ordinary, { line: 1, ch: 4 });
  const ordinaryPlugin = new TaskStatusCyclerPlugin();
  attachActiveMarkdownView(ordinaryPlugin, ordinaryApp, ordinaryEditor, "Tasks.md");
  const ordinaryResult = await ordinaryPlugin.recoverBlockedDependentsNow(
    [{ path: "Tasks.md", blockId: "source", taskId: "source" }],
    { editor: ordinaryEditor, activePath: "Tasks.md" },
  );
  assert.ok(ordinaryResult.reopened >= 1);
  assert.match(ordinaryEditor.getValue(), /^- \[ \] #task Blocked/m);

  const extra = [
    "- [?] #task Still blocked [dependsOn:: source, other] ^blocked",
    "- [-] #task Source [id:: source] ^source",
    "- [ ] #task Other [id:: other] ^other",
  ].join("\n");
  const extraApp = createInMemoryObsidianApp({ "Tasks.md": extra });
  const extraEditor = createTextEditor(extra, { line: 1, ch: 4 });
  const extraPlugin = new TaskStatusCyclerPlugin();
  attachActiveMarkdownView(extraPlugin, extraApp, extraEditor, "Tasks.md");
  await extraPlugin.recoverBlockedDependentsNow(
    [{ path: "Tasks.md", blockId: "source", taskId: "source" }],
    { editor: extraEditor, activePath: "Tasks.md" },
  );
  assert.match(extraEditor.getValue(), /^- \[\?\] #task Still blocked/m);

  const project = [
    "---",
    'type: "[[project]]"',
    "status: wip",
    "---",
    "- [?] #task #prj Ship [dependsOn:: closed__root] ^prj",
    "- [?] #task Resident #prj_is_blocked ^resident",
  ].join("\n");
  const projectApp = createInMemoryObsidianApp({
    "projects/ship.md": project,
    "closed.md": "- [x] #task Closed [id:: closed__root] ^root",
  });
  const projectEditor = createTextEditor(project, { line: 4, ch: 4 });
  const projectPlugin = new TaskStatusCyclerPlugin();
  attachActiveMarkdownView(
    projectPlugin,
    projectApp,
    projectEditor,
    "projects/ship.md",
  );
  const projectResult = await projectPlugin.recoverBlockedDependentsNow(
    [{ path: "closed.md", blockId: "root", taskId: "closed__root" }],
    { editor: projectEditor, activePath: "projects/ship.md" },
  );
  assert.ok(projectResult.reopened >= 1);
  assert.match(projectEditor.getValue(), /^- \[ \] #task Resident/m);
});

test("writer never settles the walk; a cancelled source still emits the composed notice", async () => {
  const source = "- [ ] #task Source ^source\n- [ ] #task Target ^target";
  const harness = makePlugin({ "Tasks.md": source });
  let settled = 0;
  harness.plugin.settleReviewOrigin = () => {
    settled += 1;
  };
  harness.plugin.continueReviewWalkAfter = async () => {
    settled += 1;
  };
  const outcome = await harness.plugin.applyRelationEdit({
    sources: [{ path: "Tasks.md", line: 0, blockId: "source" }],
    add: [{ path: "Tasks.md", blockId: "target", label: "duplicate of" }],
    cancelLabels: CANCEL_LABELS,
    cancelDate: "2026-10-22",
    today: TODAY,
    linkedFromLinesEnabled: false,
  });
  assert.equal(outcome.ok, true);
  assert.match(outcome.notice, /⊘ cancelled/);
  assert.equal(settled, 0);
});

