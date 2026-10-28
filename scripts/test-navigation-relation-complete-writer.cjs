const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const notices = [];
const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: class {},
      Modal: class {},
      Notice: class { constructor(message) { notices.push(String(message)); } },
      Plugin: class {},
      parseYaml: () => ({}),
    };
  }
  if (request === "@codemirror/view") return { EditorView: class {} };
  return originalLoad.call(this, request, parent, isMain);
};
const NavigationHotkeysPlugin = require("../plugins/bob-navigation-hotkeys/main.js");
const TaskStatusCyclerPlugin = require("../plugins/task-status-cycler/main.js");
const { helpers } = NavigationHotkeysPlugin;
Module._load = originalLoad;

const COMPLETE_LABELS = ["implemented by", "verified by"];
const CANCEL_LABELS = ["duplicate of", "superseded by"];
const TODAY = new Date(2026, 9, 29);

class TestEditor {
  constructor(content) {
    this.content = String(content || "");
    this.undoGroups = 0;
    this.history = [this.content];
  }
  getValue() { return this.content; }
  undo() {
    if (this.history.length > 1) {
      this.history.pop();
      this.content = this.history[this.history.length - 1];
    }
  }
  transaction(transaction) {
    const changes = [...(transaction.changes || [])].sort(
      (a, b) => b.from.line - a.from.line || b.from.ch - a.from.ch,
    );
    if (changes.length === 0) return;
    this.undoGroups += 1;
    this.history.push(this.content);
    const lines = this.content.split(/\r?\n/);
    for (const change of changes) {
      const offset = (position) => lines
        .slice(0, position.line)
        .reduce((sum, line) => sum + line.length + (this.content.includes("\r\n") ? 2 : 1), 0) + position.ch;
      const start = offset(change.from);
      const end = offset(change.to || change.from);
      this.content = this.content.slice(0, start) + change.text + this.content.slice(end);
    }
    this.history[this.history.length - 1] = this.content;
  }
}

function makeCyclerApi(options = {}) {
  const cycler = new TaskStatusCyclerPlugin();
  const finalizations = [];
  cycler.getCompletionDateString = () => "2026-10-29";
  const api = {
    version: options.version === undefined ? 3 : options.version,
    completeTaskLineText: options.completeTaskLineText ||
      cycler.completeTaskLineText.bind(cycler),
    finalizeClosedTasks: async (identities, context) => {
      finalizations.push({ identities, context });
      if (typeof options.finalize === "function") return options.finalize(identities, context);
      return {
        reopened: options.reopened || 0,
        retired: 0,
        recoveryFailures: [],
        retirementFailures: [],
        successors: null,
        successorNotice: options.successorNotice || null,
      };
    },
    recoverBlockedDependents: async (identities, context) => {
      if (typeof options.recover === "function") return options.recover(identities, context);
      return { reopened: 0, failures: [] };
    },
  };
  if (options.version < 3) {
    delete api.completeTaskLineText;
    delete api.finalizeClosedTasks;
  }
  return { api, finalizations, cycler };
}

function makePlugin(notes, options = {}) {
  const store = new Map(Object.entries(notes));
  const openEditors = new Map();
  const cycler = makeCyclerApi(options.cycler || {});
  const vault = {
    getMarkdownFiles: () => [...store.keys()].filter((path) => /\.md$/i.test(path)).map((path) => ({ path })),
    getAbstractFileByPath: (path) => store.has(path) ? { path } : null,
    cachedRead: async (file) => String(store.get(file.path) || ""),
    read: async (file) => String(store.get(file.path) || ""),
    process: async (file, transform) => store.set(file.path, String(transform(String(store.get(file.path) || "")))),
  };
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    vault,
    metadataCache: {
      getFirstLinkpathDest: (linkpath) => {
        const wanted = String(linkpath || "").replace(/\.md$/i, "");
        const exact = `${wanted}.md`;
        if (store.has(exact)) return { path: exact };
        const matches = [...store.keys()].filter((entry) =>
          /\.md$/i.test(entry) && entry.split("/").pop().replace(/\.md$/i, "").toLowerCase() === wanted.toLowerCase(),
        );
        return matches.length === 1 ? { path: matches[0] } : null;
      },
    },
    workspace: {
      getLeavesOfType: () => [...openEditors].map(([path, editor]) => ({ view: { file: { path }, editor } })),
      getActiveFile: () => null,
    },
    plugins: { plugins: { "task-status-cycler": { api: cycler.api } } },
  };
  return { plugin, store, openEditors, ...cycler };
}

function expectedCloseEffects(label, day = "2026-10-29", action = "added") {
  const policy = helpers.planRelationClosingSource({
    cancelLabels: [],
    completeLabels: COMPLETE_LABELS,
    trigger: "explicit",
    cyclerApiAvailable: true,
    source: {
      path: "Tasks.md",
      blockId: "source",
      line: 0,
      status: " ",
      isNew: false,
      isProject: false,
      isRecurring: false,
      itemModifiers: [],
      edges: [{ action, label, previousLabel: null, storedTargetLink: "[[#^target]]" }],
    },
  });
  return helpers.summarizeRelationCloseEffects(
    [policy.cancel],
    { sources: [policy.complete], completes: policy.complete.completes ? [policy.complete] : [] },
    day,
  );
}

function writerArgs(sources, add, extra = {}) {
  return {
    sources,
    add,
    remove: [],
    relabel: [],
    today: TODAY,
    linkedFromLinesEnabled: false,
    cancelLabels: CANCEL_LABELS,
    completeLabels: COMPLETE_LABELS,
    ...extra,
  };
}

test("same-note completion and LINKS write share one undo transaction; post-Done waits", async () => {
  const initial = "- [ ] #task Source ^source\n- [ ] #task Target ^target";
  const harness = makePlugin({ "Tasks.md": initial }, { cycler: { reopened: 2, successorNotice: "Next: Review" } });
  const editor = new TestEditor(initial);
  harness.openEditors.set("Tasks.md", editor);
  let resolveFinalize;
  harness.api.finalizeClosedTasks = async (identities, context) => {
    harness.finalizations.push({ identities, context });
    return new Promise((resolve) => { resolveFinalize = resolve; });
  };
  let settled = 0;
  const picker = {
    filePath: "Tasks.md",
    editor,
    reviewOrigin: { seq: 1 },
    close() { this.closed = true; },
    clearPendingBatch() {},
    async settleReviewOrigin(kind, outcome) {
      settled += 1;
      assert.equal(kind, "complete");
      assert.match(outcome.notice, /✓ done/);
    },
  };
  harness.plugin.activeBulletPropertyPicker = picker;
  const pending = harness.plugin.applyRelationEdit(writerArgs(
    [{ path: "Tasks.md", line: 0, blockId: "source" }],
    [{ path: "Tasks.md", blockId: "target", label: "implemented by" }],
    { linkedFromLinesEnabled: true },
  ));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(picker.closed, true);
  assert.equal(harness.finalizations.length, 1);
  assert.equal(harness.finalizations[0].context.successorNoticeTarget, "return");
  assert.equal(settled, 0);
  assert.equal(editor.undoGroups, 1);
  assert.match(editor.getValue(), /^- \[x\] #task Source .*\[completion:: 2026-10-29\] \^source/m);
  assert.match(editor.getValue(), /LINKS:\*\* implemented by \[\[#\^target\]\]/);
  assert.match(editor.getValue(), /LINKED FROM/);
  resolveFinalize({ reopened: 2, retired: 0, recoveryFailures: [], retirementFailures: [], successors: null, successorNotice: "Next: Review" });
  const outcome = await pending;
  assert.equal(settled, 1);
  assert.equal(outcome.noticeDisplayed, true);
  assert.equal(outcome.notice, null);
  assert.match(editor.getValue(), /completion:: 2026-10-29/);
  assert.equal(harness.finalizations[0].identities.length, 1);
  editor.undo();
  assert.equal(editor.getValue(), initial);
});

test("same-note completion follows an id-less source after a mirror shifts it", async () => {
  const initial = "- [ ] #task Target ^target\n- [ ] #task Bystander\n- [ ] #task Source";
  const harness = makePlugin({ "Tasks.md": initial });
  const outcome = await harness.plugin.applyRelationEdit(writerArgs(
    [{ path: "Tasks.md", line: 2, blockId: null }],
    [{ path: "Tasks.md", blockId: "target", label: "implemented by" }],
    { linkedFromLinesEnabled: true },
  ));
  assert.equal(outcome.ok, true);
  assert.match(harness.store.get("Tasks.md"), /^- \[ \] #task Bystander$/m);
  assert.match(harness.store.get("Tasks.md"), /^- \[x\] #task Source .*\[completion:: 2026-10-29\]/m);
});

test("all four open statuses complete with the real cycler line rewrite", async () => {
  for (const status of [" ", "*", "/", "?"]) {
    const source = `- [${status}] #task Source ^source\n- [ ] #task Target ^target`;
    const harness = makePlugin({ "Tasks.md": source });
    const outcome = await harness.plugin.applyRelationEdit(writerArgs(
      [{ path: "Tasks.md", line: 0, blockId: "source" }],
      [{ path: "Tasks.md", blockId: "target", label: "implemented by" }],
    ));
    assert.equal(outcome.ok, true, status);
    assert.match(harness.store.get("Tasks.md"), /^- \[x\] #task Source .*\[completion:: 2026-10-29\]/m, status);
    assert.equal(harness.finalizations.length, 1, status);
  }
});

test("^prj completion touches its line and leaves resident tasks open", async () => {
  const source = "- [ ] #task #prj Project ^prj\n  - [ ] #task Resident ^resident\n- [ ] #task Target ^target";
  const harness = makePlugin({ "Tasks.md": source });
  const outcome = await harness.plugin.applyRelationEdit(writerArgs(
    [{ path: "Tasks.md", line: 0, blockId: "prj" }],
    [{ path: "Tasks.md", blockId: "target", label: "verified by" }],
  ));
  assert.equal(outcome.ok, true);
  assert.match(harness.store.get("Tasks.md"), /^- \[x\] #task #prj Project .*\^prj/m);
  assert.match(harness.store.get("Tasks.md"), /^  - \[ \] #task Resident \^resident$/m);
});

test("closed sources retain their dates while the relation edit still commits", async () => {
  const source = "- [x] #task Already done [completion:: 2026-10-01] ^source\n- [ ] #task Target ^target";
  const harness = makePlugin({ "Tasks.md": source });
  const outcome = await harness.plugin.applyRelationEdit(writerArgs(
    [{ path: "Tasks.md", line: 0, blockId: "source" }],
    [{ path: "Tasks.md", blockId: "target", label: "implemented by" }],
  ));
  assert.equal(outcome.ok, true);
  assert.match(harness.store.get("Tasks.md"), /^- \[x\].*completion:: 2026-10-01/m);
  assert.equal(harness.finalizations.length, 0);
});

test("recurring sources and old cycler APIs refuse before any write", async () => {
  for (const [line, cycler, reason] of [
    ["- [ ] #task Repeat [repeat:: every week] ^source", {}, "relation_completes_recurring_task"],
    ["- [ ] #task Source ^source", { version: 2 }, "relation_complete_cycler_api_required"],
  ]) {
    const initial = `${line}\n- [ ] #task Target ^target`;
    const harness = makePlugin({ "Tasks.md": initial }, { cycler });
    const outcome = await harness.plugin.applyRelationEdit(writerArgs(
      [{ path: "Tasks.md", line: 0, blockId: "source" }],
      [{ path: "Tasks.md", blockId: "target", label: "implemented by" }],
    ));
    assert.equal(outcome.ok, false);
    assert.equal(outcome.reason, reason);
    assert.equal(harness.store.get("Tasks.md"), initial);
    assert.equal(harness.finalizations.length, 0);
  }
});

test("id-less cross-note source completes without a mirror or freshness side effects", async () => {
  const harness = makePlugin({
    "Tasks.md": "- [ ] #task Source\n",
    "Target.md": "- [ ] #task Target ^target",
  });
  const outcome = await harness.plugin.applyRelationEdit(writerArgs(
    [{ path: "Tasks.md", line: 0 }],
    [{ path: "Target.md", blockId: "target", label: "implemented by" }],
  ));
  assert.equal(outcome.ok, true);
  assert.match(harness.store.get("Tasks.md"), /^- \[x\] #task Source  \[completion:: 2026-10-29\]/m);
  assert.equal(harness.finalizations.length, 1);
  assert.equal(harness.finalizations[0].identities[0].path, "Tasks.md");
  assert.equal(harness.finalizations[0].identities[0].line, 0);
  assert.equal(harness.store.get("Target.md").includes("LINKED FROM"), false);
});

test("unchanged and spelling-only retries never complete", async () => {
  const initial = "- [ ] #task Source ^source\n  - 🪢 **LINKS:** Implemented  By [[#^target]]\n- [ ] #task Target ^target";
  const harness = makePlugin({ "Tasks.md": initial });
  const outcome = await harness.plugin.applyRelationEdit(writerArgs(
    [{ path: "Tasks.md", line: 0, blockId: "source" }],
    [{ path: "Tasks.md", blockId: "target", label: "Implemented By:" }],
  ));
  assert.equal(outcome.ok, true);
  assert.equal(outcome.completedIdentities.length, 0);
  assert.match(harness.store.get("Tasks.md"), /^- \[ \] #task Source/m);
  assert.equal(harness.finalizations.length, 0);
});

test("two complete edges deduplicate to one line rewrite and one post-Done identity", async () => {
  const initial = "- [ ] #task Source ^source\n- [ ] #task A ^a\n- [ ] #task B ^b";
  const harness = makePlugin({ "Tasks.md": initial });
  const outcome = await harness.plugin.applyRelationEdit(writerArgs(
    [{ path: "Tasks.md", line: 0, blockId: "source" }],
    [
      { path: "Tasks.md", blockId: "a", label: "implemented by" },
      { path: "Tasks.md", blockId: "b", label: "verified by" },
    ],
    { completeLabels: COMPLETE_LABELS },
  ));
  assert.equal(outcome.ok, true);
  assert.equal(outcome.completedIdentities.length, 1);
  assert.equal(harness.finalizations.length, 1);
  assert.equal((harness.store.get("Tasks.md").match(/completion::/g) || []).length, 1);
});

test("cancel and complete triggers on one source refuse the whole gesture", async () => {
  const initial = "- [ ] #task Source ^source\n- [ ] #task C ^cancel\n- [ ] #task D ^done";
  const harness = makePlugin({ "Tasks.md": initial });
  const outcome = await harness.plugin.applyRelationEdit(writerArgs(
    [{ path: "Tasks.md", line: 0, blockId: "source" }],
    [
      { path: "Tasks.md", blockId: "cancel", label: "duplicate of" },
      { path: "Tasks.md", blockId: "done", label: "implemented by" },
    ],
  ));
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, "relation_close_effects_conflict");
  assert.equal(harness.store.get("Tasks.md"), initial);
  assert.equal(harness.finalizations.length, 0);
});

test("changed close config, cycler API, and day make the commit stale without writes", async () => {
  for (const extra of [
    { completeLabels: ["verified by"] },
    { cycler: { version: 2 } },
    { today: new Date(2026, 9, 30) },
  ]) {
    const initial = "- [ ] #task Source ^source\n- [ ] #task Target ^target";
    const harness = makePlugin({ "Tasks.md": initial }, { cycler: extra.cycler });
    const outcome = await harness.plugin.applyRelationEdit(writerArgs(
      [{ path: "Tasks.md", line: 0, blockId: "source" }],
      [{ path: "Tasks.md", blockId: "target", label: "implemented by" }],
      {
        expectedCloseEffects: expectedCloseEffects("implemented by"),
        ...(extra.completeLabels ? { completeLabels: extra.completeLabels } : {}),
        ...(extra.today ? { today: extra.today } : {}),
      },
    ));
    assert.equal(outcome.ok, false);
    assert.equal(outcome.stale, true);
    assert.equal(harness.store.get("Tasks.md"), initial);
    assert.equal(harness.finalizations.length, 0);
  }
});

test("shared close preview derives exact pending edges for Links and Linked-from", () => {
  const notes = {
    "Tasks.md": "- [ ] #task Source ^source\n- [ ] #task Target ^target",
    "Cursor.md": "- [ ] #task Cursor ^cursor",
  };
  const harness = makePlugin(notes);
  const previewer = Object.create(helpers.BulletPropertyPickerRelationClosePreviewMixin.prototype);
  previewer.plugin = harness.plugin;
  previewer.filePath = "Tasks.md";
  previewer.vaultStage = { files: new Map(Object.entries(notes)) };
  previewer.relationCloseLabelsConfig = () => ({ cancel: CANCEL_LABELS, complete: COMPLETE_LABELS });
  previewer.relationCancelContentForRef = (ref) => String(harness.store.get(ref.path) || ref.rawLine || "");
  const links = previewer.relationClosePreviewForChanges({
    date: "2026-10-29",
    sources: [{ path: "Tasks.md", line: 0, blockId: "source" }],
    add: [{ path: "Tasks.md", blockId: "target", label: "implemented by" }],
  });
  assert.equal(links.ok, true);
  assert.equal(links.complete.completes.length, 1);
  assert.equal(links.expectedCloseEffects.sources[0].effect, "complete");
  const linkedFrom = previewer.relationClosePreviewForChanges({
    date: "2026-10-29",
    sources: [{ path: "Tasks.md", line: 0, blockId: "source" }],
    add: [{ path: "Cursor.md", blockId: "cursor", label: "implemented by" }],
    direction: "from",
  });
  assert.equal(linkedFrom.complete.completes.length, 1);
  assert.match(linkedFrom.expectedCloseEffects.sources[0].edges[0].link, /Cursor.*cursor/);
});

test("completed source closes the relation modal before awaiting post-Done and settles once", async () => {
  const initial = "- [ ] #task Remote ^source\n- [ ] #task Target ^target";
  const harness = makePlugin({ "Remote.md": initial });
  let release;
  harness.api.finalizeClosedTasks = async (identities, context) => {
    assert.equal(harness.plugin.activeBulletPropertyPicker.closed, true);
    harness.finalizations.push({ identities, context });
    return new Promise((resolve) => { release = resolve; });
  };
  let settledAs = null;
  const picker = {
    filePath: "Cursor.md",
    editor: null,
    reviewOrigin: { seq: 1 },
    close() { this.closed = true; },
    async settleReviewOrigin(kind, extra) {
      settledAs = kind;
      assert.match(extra.notice, /✓ done/);
    },
  };
  harness.plugin.activeBulletPropertyPicker = picker;
  const pending = harness.plugin.applyRelationEdit(writerArgs(
    [{ path: "Remote.md", line: 0, blockId: "source" }],
    [{ path: "Remote.md", blockId: "target", label: "implemented by" }],
  ));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settledAs, null);
  release({ reopened: 0, recoveryFailures: [], retirementFailures: [], successorNotice: null });
  const outcome = await pending;
  assert.equal(settledAs, "noop");
  assert.equal(outcome.noticeDisplayed, true);
  assert.equal(harness.finalizations.length, 1);
});
