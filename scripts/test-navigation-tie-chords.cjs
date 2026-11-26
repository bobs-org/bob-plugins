// Tie chords and armed ↵ releases for the four Task Card relationship
// stages (bob-cli plan:202611/plain_link_dependency_ties.md, phase
// nav-tie-keys). `docs/task-dependencies.md` §§6.4, 15 and
// `docs/task-relations.md` LG rows are authoritative.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
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
const { TransactionEditor } = require("./navigation-hotkeys-harness.cjs");
Module._load = originalLoad;

const keyEvent = (overrides = {}) => ({
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  isComposing: false,
  keyCode: 0,
  repeat: false,
  key: "b",
  code: "KeyB",
  ...overrides,
});

test("strict modifiers: bare Ctrl only, Ctrl+Shift separate, Meta/Alt never match", () => {
  assert.equal(helpers.isCtrlKey(keyEvent({ ctrlKey: true, key: "n" }), "n"), true);
  assert.equal(helpers.isCtrlKey(keyEvent({ ctrlKey: true, shiftKey: true, key: "N" }), "n"), false);
  assert.equal(helpers.isCtrlShiftKey(keyEvent({ ctrlKey: true, shiftKey: true, key: "N" }), "n"), true);
  assert.equal(helpers.isCtrlShiftKey(keyEvent({ ctrlKey: true, key: "n" }), "n"), false);
  assert.equal(helpers.isCtrlKey(keyEvent({ ctrlKey: true, metaKey: true, key: "b" }), "b"), false);
  assert.equal(helpers.isCtrlShiftKey(keyEvent({ ctrlKey: true, shiftKey: true, metaKey: true, key: "B" }), "b"), false);
  assert.equal(helpers.isCtrlKey(keyEvent({ ctrlKey: true, altKey: true, key: "b" }), "b"), false);
});

test("chord routing: ⌃B/⌃⇧B/⌃L/⌃⇧L map, repeat and IME ignored, ⌘B untouched", () => {
  assert.equal(helpers.tieChordTarget(keyEvent({ ctrlKey: true, key: "b", code: "KeyB" })), "owner-waits");
  assert.equal(helpers.tieChordTarget(keyEvent({ ctrlKey: true, shiftKey: true, key: "B", code: "KeyB" })), "other-waits");
  assert.equal(helpers.tieChordTarget(keyEvent({ ctrlKey: true, key: "l", code: "KeyL" })), "plain-out");
  assert.equal(helpers.tieChordTarget(keyEvent({ ctrlKey: true, shiftKey: true, key: "L", code: "KeyL" })), "plain-in");
  assert.equal(helpers.tieChordTarget(keyEvent({ ctrlKey: true, key: "b", repeat: true })), null);
  assert.equal(helpers.tieChordTarget(keyEvent({ ctrlKey: true, key: "b", isComposing: true, keyCode: 229 })), null);
  assert.equal(helpers.tieChordTarget(keyEvent({ ctrlKey: true, metaKey: true, key: "b" })), null);
  assert.equal(helpers.tieChordTarget(keyEvent({ metaKey: true, key: "b", code: "KeyB" })), null);
  assert.equal(helpers.tieChordTarget(keyEvent({ key: "b" })), null);
  assert.equal(helpers.tieChordTarget(keyEvent({ ctrlKey: true, key: "n" })), null);
});

test("chord scope: list mode in the four stages only, never label or block-id", () => {
  const base = {
    stage: "value",
    blockIdMode: "single",
    isLocalTaskStage: () => true,
    blocksStage: false,
    relationStage: false,
  };
  assert.ok(helpers.tieShouldHandleChord(base, keyEvent({ ctrlKey: true, key: "b" })));
  assert.equal(helpers.tieShouldHandleChord({ ...base, stage: "relation-label" }, keyEvent({ ctrlKey: true, key: "b" })), null);
  assert.equal(helpers.tieShouldHandleChord({ ...base, blockIdMode: "multi" }, keyEvent({ ctrlKey: true, key: "b" })), null);
  assert.equal(helpers.tieShouldHandleChord({ ...base, stage: "task-card" }, keyEvent({ ctrlKey: true, key: "b" })), null);
  assert.equal(helpers.tieShouldHandleChord(base, keyEvent({ key: "b" })), null);
});

test("stage kinds route Enter conversions to the planned tie", () => {
  const depends = { stage: "value", isLocalTaskStage: () => true, blocksStage: false, relationStage: false };
  const blocks = { stage: "value", isLocalTaskStage: () => true, blocksStage: true, relationStage: false };
  const links = { stage: "value", isLocalTaskStage: () => true, blocksStage: false, relationStage: true, relationStageDirection: "to" };
  const linkedFrom = { stage: "value", isLocalTaskStage: () => true, blocksStage: false, relationStage: true, relationStageDirection: "from" };
  assert.equal(helpers.tieChordStageKind(depends), "depends");
  assert.equal(helpers.tieChordStageKind(blocks), "blocks");
  assert.equal(helpers.tieChordStageKind(links), "links");
  assert.equal(helpers.tieChordStageKind(linkedFrom), "linked-from");
  assert.equal(helpers.tieEnterToForStage("depends"), "owner-waits");
  assert.equal(helpers.tieEnterToForStage("blocks"), "other-waits");
  assert.equal(helpers.tieEnterToForStage("links"), "plain-out");
  assert.equal(helpers.tieEnterToForStage("linked-from"), "plain-in");
});

const LINKS = "🪢 **LINKS:**";
const DEPS = "⛓️ **DEPENDS ON:**";
const taskLine = (status, text, blockId) => `- [${status}] ${text} #task ^${blockId}`;
const linksChild = (entries) => `\t- ${LINKS} ${entries}`;
const depsChild = (entries) => `\t- ${DEPS} ${entries}`;
const O = { path: "n.md", blockId: "aaa" };
const X = { path: "n.md", blockId: "bbb" };

function dispatchHarness(content, options = {}) {
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: {
      getLeavesOfType: () => [{ view: { file: { path: "n.md" }, editor } }],
    },
    plugins: { plugins: {} },
  };
  plugin.getActiveMarkdownView = () => ({ editor, file: { path: "n.md" } });
  plugin.readDependencyNoteContent = async (path) => path === "n.md" ? editor.getValue() : null;
  plugin.readDependencyVaultFileList = () => ["n.md"];
  plugin.dependencyLinkpathResolver = () => (note, from) => (!note ? from : `${note}.md`);
  plugin.readDependencyRecoveryVaultContents = async () => new Map([["n.md", editor.getValue()]]);
  plugin.prepareSubtreeForDependencyPlan = async () => null;
  plugin.readDeferredPomodoroSnapshot = async () => ({ ok: true, contents: new Map() });
  plugin.getFreshnessApi = () => null;
  const lines = content.split(/\r?\n/);
  const taskAt = (blockId) => lines.findIndex((line) =>
    /^\s*-\s*\[[^\]]\].*#task.*\s\^/.test(line) &&
    new RegExp(`\\^${blockId}\\s*$`).test(line),
  );
  const ownerLine = lines[taskAt("aaa")];
  const otherLine = lines[taskAt("bbb")];
  const owner = {
    path: "n.md", blockId: "aaa", line: taskAt("aaa"), rawLine: ownerLine,
    status: ownerLine.slice(3, 4), displayText: "Owner",
  };
  const other = {
    kind: "local-task", path: "n.md", blockId: "bbb", line: taskAt("bbb"),
    rawLine: otherLine, status: otherLine.slice(3, 4), displayText: "Other",
    disabled: options.disabled === true,
    disabledReason: options.disabledReason,
    tieInfo: options.tieInfo || null,
  };
  const modal = Object.create(helpers.BulletPropertyPickerModal.prototype);
  Object.assign(modal, {
    stage: "value",
    blockIdMode: "single",
    selectedPropertyItem: { property: { name: "dependsOn" } },
    filePath: "n.md",
    editor,
    cursor: { line: owner.line, ch: 0 },
    plugin,
    vaultStage: { dependent: owner, files: new Map([["n.md", content]]) },
    visibleItems: [other],
    selectedIndex: 0,
    blocksStage: options.stage === "blocks",
    relationStage: options.stage === "links" || options.stage === "linked-from",
    relationStageDirection: options.stage === "linked-from" ? "from" : "to",
    isLocalTaskStage: () => true,
    isCountedSession: () => false,
    getMarkedCount: () => 0,
    getEditorContent: () => editor.getValue(),
    reopenDependencyStageFresh: () => {},
    refuseDependencyStale: (message) => notices.push(String(message || "changed — reopen")),
  });
  return { editor, plugin, modal, owner, other };
}

async function waitForWrite(editor, priorGroups = 0) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (editor.undoGroups > priorGroups) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("the chord did not commit through the editor writer");
}

function promptHarness({ ownerId = false, otherId = false, crossNote = false } = {}) {
  const ownerPath = "n.md";
  const otherPath = crossNote ? "Other.md" : ownerPath;
  const ownerLine = ownerId
    ? "- [ ] #task Owner [id:: n__aaa] ^aaa"
    : "- [ ] #task Owner";
  const otherLine = otherId
    ? `- [ ] #task Other [id:: ${crossNote ? "Other__bbb" : "n__bbb"}] ^bbb`
    : "- [ ] #task Other";
  const ownerContent = crossNote ? ownerLine : `${ownerLine}\n${otherLine}`;
  const otherContent = crossNote ? otherLine : ownerContent;
  const editor = new TransactionEditor(ownerContent, { line: 0, ch: 0 });
  const notes = new Map([[ownerPath, ownerContent], [otherPath, otherContent]]);
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: {
      getLeavesOfType: () => [{ view: { file: { path: ownerPath }, editor } }],
    },
    vault: {
      getAbstractFileByPath: (path) => notes.has(path) ? { path } : null,
      process: async (file, update) => {
        notes.set(file.path, String(update(notes.get(file.path)) || ""));
      },
    },
    plugins: { plugins: {} },
  };
  plugin.readDependencyNoteContent = async (path) =>
    path === ownerPath ? editor.getValue() : notes.get(path) ?? null;
  plugin.readDependencyVaultFileList = () => [...notes.keys()];
  plugin.dependencyLinkpathResolver = () => (note, from) =>
    !note ? from : `${note}.md`;
  plugin.readDependencyRecoveryVaultContents = async () => new Map(notes);
  plugin.prepareSubtreeForDependencyPlan = async () => null;
  plugin.readDeferredPomodoroSnapshot = async () => ({ ok: true, contents: new Map() });
  plugin.getFreshnessApi = () => null;
  const owner = {
    path: ownerPath,
    ...(ownerId ? { blockId: "aaa" } : {}),
    line: 0,
    rawLine: ownerLine,
    status: " ",
    displayText: "Owner",
  };
  const other = {
    kind: "local-task",
    path: otherPath,
    ...(otherId ? { blockId: "bbb" } : {}),
    line: crossNote ? 0 : 1,
    rawLine: otherLine,
    status: " ",
    displayText: "Other",
    disabled: false,
    tieInfo: null,
  };
  const stageFiles = new Map([[ownerPath, ownerContent], [otherPath, otherContent]]);
  const modal = Object.create(helpers.BulletPropertyPickerModal.prototype);
  Object.assign(modal, {
    stage: "value",
    blockIdMode: "single",
    selectedPropertyItem: { property: { name: "dependsOn" } },
    pendingTask: null,
    filePath: ownerPath,
    editor,
    cursor: { line: 0, ch: 0 },
    plugin,
    vaultStage: { dependent: owner, files: stageFiles },
    visibleItems: [other],
    selectedIndex: 0,
    blocksStage: false,
    relationStage: false,
    relationStageDirection: null,
    isLocalTaskStage: () => true,
    isCountedSession: () => false,
    getMarkedCount: () => 0,
    getEditorContent: () => editor.getValue(),
    readVaultStageFiles: async (paths) => {
      const out = new Map();
      for (const path of paths) {
        out.set(path, path === ownerPath ? editor.getValue() : notes.get(path));
      }
      return out;
    },
    showBlockIdStage(task, options) {
      this.stage = "blockid";
      this.blockIdMode = options.mode;
      this.pendingTask = task;
    },
    reopenDependencyStageFresh() {},
    refuseDependencyStale: (message) => notices.push(String(message || "changed — reopen")),
    close() {},
  });
  return { editor, notes, plugin, modal, owner, other, ownerContent, otherContent };
}

function plan(to, lines) {
  const notes = new Map([["n.md", lines.join("\n")]]);
  return helpers.planTieChange({
    owner: O,
    other: X,
    to,
    notes,
    resolve: { linkpath: (note, from) => (!note ? from : `${note}.md`), vaultFiles: ["n.md"] },
  });
}

function untied() {
  return [taskLine(" ", "Owner", "aaa"), taskLine(" ", "Other", "bbb")];
}

test("4 stages x chords: untied rows convert to the chord tie", () => {
  assert.equal(plan("owner-waits", untied()).kind, "change");
  assert.equal(plan("other-waits", untied()).kind, "change");
  assert.equal(plan("plain-out", untied()).kind, "change");
  assert.equal(plan("plain-in", untied()).kind, "change");
});

test("modal keyboard dispatch commits all four desired ties through the writer", async () => {
  const cases = [
    { to: "owner-waits", stage: "depends", shiftKey: false, key: "b", wanted: /Owner.*DEPENDS ON|DEPENDS ON.*bbb/ },
    { to: "other-waits", stage: "blocks", shiftKey: true, key: "B", wanted: /Other.*DEPENDS ON|DEPENDS ON.*aaa/ },
    { to: "plain-out", stage: "links", shiftKey: false, key: "l", wanted: /LINKS.*bbb/ },
    { to: "plain-in", stage: "linked-from", shiftKey: true, key: "L", wanted: /Other[\s\S]*LINKS.*aaa/ },
  ];
  for (const entry of cases) {
    const h = dispatchHarness(untied().join("\n"), { stage: entry.stage });
    const event = keyEvent({
      ctrlKey: true,
      shiftKey: entry.shiftKey,
      key: entry.key,
      preventDefault() { this.prevented = true; },
      stopPropagation() { this.stopped = true; },
    });
    h.modal.handleKeydown(event);
    assert.equal(event.prevented, true, entry.to);
    assert.equal(event.stopped, true, entry.to);
    await waitForWrite(h.editor);
    assert.match(h.editor.getValue(), entry.wanted, entry.to);
    assert.equal(h.editor.undoGroups, 1, entry.to);
  }
});

test("disabled cycle rows expose and dispatch only a legal reversal chord", async () => {
  const dependsIn = [
    taskLine(" ", "Owner", "aaa"),
    taskLine("?", "Other", "bbb"),
    depsChild("[[#^aaa]]"),
  ].join("\n");
  const forward = dispatchHarness(dependsIn, {
    disabled: true,
    disabledReason: "would create a cycle",
    tieInfo: { waitedOnBy: true },
  });
  assert.ok(helpers.tieChordHintsForItem(forward.modal, forward.other).some((hint) => hint.keys.includes("⌃B")));
  const ctrlB = keyEvent({ ctrlKey: true, key: "b", preventDefault() {}, stopPropagation() {} });
  forward.modal.handleKeydown(ctrlB);
  await waitForWrite(forward.editor);
  assert.match(forward.editor.getValue(), /Owner[^\n]*\[dependsOn:: n__bbb\]/);
  assert.doesNotMatch(forward.editor.getValue(), /Other[^\n]*\[dependsOn:: n__aaa\]/);

  const reverseIn = [
    taskLine("?", "Owner", "aaa"),
    depsChild("[[#^bbb]]"),
    taskLine(" ", "Other", "bbb"),
  ].join("\n");
  const backward = dispatchHarness(reverseIn, {
    stage: "blocks",
    disabled: true,
    disabledReason: "would create a cycle",
    tieInfo: { waitsOn: true },
  });
  const backwardHints = helpers.tieChordHintsForItem(backward.modal, backward.other);
  assert.ok(backwardHints.some((hint) => hint.keys.includes("⌃⇧B")), JSON.stringify({ backwardHints, other: backward.other, owner: backward.owner }));
  backward.modal.handleKeydown(keyEvent({ ctrlKey: true, shiftKey: true, key: "B", preventDefault() {}, stopPropagation() {} }));
  await waitForWrite(backward.editor);
  assert.match(backward.editor.getValue(), /Other[^\n]*\[dependsOn:: n__aaa\]/);
  assert.doesNotMatch(backward.editor.getValue(), /Owner[^\n]*\[dependsOn:: n__bbb\]/);
});

test("third-task cycles, eligibility guards, and stale rows make no writes", () => {
  const thirdCycle = [
    taskLine(" ", "Owner", "aaa"),
    taskLine("?", "Other", "bbb"),
    depsChild("[[#^aaa]] [[#^ccc]]"),
    taskLine("?", "Third", "ccc"),
    depsChild("[[#^aaa]]"),
  ].join("\n");
  const cycle = dispatchHarness(thirdCycle, {
    disabled: true,
    disabledReason: "would create a cycle",
    tieInfo: { waitedOnBy: true },
  });
  assert.ok(!helpers.tieChordHintsForItem(cycle.modal, cycle.other).some((hint) => hint.keys.includes("⌃B")));
  cycle.modal.handleKeydown(keyEvent({ ctrlKey: true, key: "b", preventDefault() {}, stopPropagation() {} }));
  assert.equal(cycle.editor.undoGroups, 0);
  assert.equal(cycle.editor.getValue(), thirdCycle);

  const closed = dispatchHarness([
    taskLine(" ", "Owner", "aaa"),
    taskLine("x", "Other", "bbb"),
  ].join("\n"), {
    disabled: true,
    disabledReason: "closed task",
  });
  closed.modal.handleKeydown(keyEvent({ ctrlKey: true, key: "b", preventDefault() {}, stopPropagation() {} }));
  assert.equal(closed.editor.undoGroups, 0);

  const stale = dispatchHarness(untied().join("\n"));
  stale.editor.content += "\nconcurrent edit";
  assert.deepEqual(helpers.tieChordHintsForItem(stale.modal, stale.other), []);
  stale.modal.handleKeydown(keyEvent({ ctrlKey: true, key: "b", preventDefault() {}, stopPropagation() {} }));
  assert.equal(stale.editor.undoGroups, 0);
  assert.equal(stale.editor.getValue(), `${untied().join("\n")}\nconcurrent edit`);
});

test("chords across tie states: plain both ways absorbs, dependencies reverse or noop", () => {
  const plainOut = [taskLine(" ", "Owner", "aaa"), linksChild("[[#^bbb]]"), taskLine(" ", "Other", "bbb")];
  assert.equal(plan("owner-waits", plainOut).tieBefore, "plain_out");
  const plainBoth = [taskLine(" ", "Owner", "aaa"), linksChild("[[#^bbb]]"), taskLine(" ", "Other", "bbb"), linksChild("[[#^aaa]]")];
  assert.equal(plan("owner-waits", plainBoth).kind, "change");
  assert.equal(plan("plain-out", plainBoth).kind, "noop");
  const dependsOut = [taskLine("?", "Owner", "aaa"), depsChild("[[#^bbb]]"), taskLine(" ", "Other", "bbb")];
  assert.equal(plan("owner-waits", dependsOut).kind, "noop");
  assert.equal(plan("other-waits", dependsOut).kind, "change");
  const dependsIn = [taskLine(" ", "Owner", "aaa"), taskLine(" ", "Other", "bbb"), depsChild("[[#^aaa]]")];
  assert.equal(plan("owner-waits", dependsIn).kind, "change");
  assert.equal(plan("other-waits", dependsIn).kind, "noop");
  const labelled = [taskLine(" ", "Owner", "aaa"), `\t- ${LINKS} follow-up of [[#^bbb]]`, taskLine(" ", "Other", "bbb")];
  const labelledOut = plan("owner-waits", labelled);
  assert.equal(labelledOut.kind, "change");
  assert.equal(labelledOut.tieAfter, "depends_out");
});

test("no-op notices leave the pair untouched", () => {
  const dependsOut = [taskLine("?", "Owner", "aaa"), depsChild("[[#^bbb]]"), taskLine(" ", "Other", "bbb")];
  const noop = plan("owner-waits", dependsOut);
  assert.equal(noop.kind, "noop");
  assert.equal(noop.notice, "Already waits on it");
  const reversePlain = [taskLine(" ", "Owner", "aaa"), taskLine(" ", "Other", "bbb"), linksChild("[[#^aaa]]")];
  assert.equal(plan("plain-out", reversePlain).kind, "noop");
});

test("guards refuse with the pair intact: cycle, closed, archived, event task", () => {
  const closedPrereq = [taskLine(" ", "Owner", "aaa"), taskLine("-", "Other", "bbb")];
  assert.equal(plan("owner-waits", closedPrereq).kind, "refuse");
  const donePrereq = [taskLine(" ", "Owner", "aaa"), taskLine("x", "Other", "bbb")];
  const doneOut = plan("owner-waits", donePrereq);
  assert.equal(doneOut.kind, "change");
  const cycleLines = [
    taskLine(" ", "Aye", "aaa"),
    taskLine("?", "Bee", "bbb"),
    depsChild("[[#^ccc]]"),
    taskLine("?", "Cee", "ccc"),
    depsChild("[[#^aaa]]"),
  ];
  const cycle = plan("owner-waits", cycleLines);
  assert.equal(cycle.kind, "refuse");
  assert.match(String(cycle.notice), /cycle/);
});

test("batch and counted refusals name the row and keep the link", () => {
  const picker = (overrides = {}) => ({
    isCountedSession: () => false,
    getMarkedCount: () => 0,
    ...overrides,
  });
  assert.match(helpers.tieChordRefusal({ ...picker(), isCountedSession: () => true }, { tieConvert: true }, "owner-waits"), /needs a single task/);
  assert.match(helpers.tieChordRefusal({ ...picker(), getMarkedCount: () => 2 }, { tieConvert: false }, "owner-waits"), /clear marks first/);
  const converting = { tieConvert: true, displayText: "Other" };
  assert.match(
    helpers.tieChordRefusal({ ...picker(), getMarkedCount: () => 2 }, converting, "owner-waits"),
    /unmark "Other" or use/,
  );
});

test("chord refusals name the pressed chord", () => {
  const picker = (overrides = {}) => ({
    isCountedSession: () => false,
    getMarkedCount: () => 0,
    ...overrides,
  });
  assert.match(helpers.tieChordRefusal({ ...picker(), isCountedSession: () => true }, {}, "owner-waits"), /⌃B/);
  assert.match(helpers.tieChordRefusal({ ...picker(), isCountedSession: () => true }, {}, "other-waits"), /⌃⇧B/);
  assert.match(helpers.tieChordRefusal({ ...picker(), isCountedSession: () => true }, {}, "plain-out"), /⌃L/);
  assert.match(helpers.tieChordRefusal({ ...picker(), isCountedSession: () => true }, {}, "plain-in"), /⌃⇧L/);
  assert.match(helpers.tieChordRefusal({ ...picker(), getMarkedCount: () => 1 }, {}, "other-waits"), /⌃⇧B/);
  assert.match(helpers.tieChordRefusal({ ...picker(), getMarkedCount: () => 1 }, {}, "plain-out"), /⌃L/);
  assert.equal(helpers.tieChordKeyName("owner-waits"), "⌃B");
  assert.equal(helpers.tieChordKeyName("other-waits"), "⌃⇧B");
  assert.equal(helpers.tieChordKeyName("plain-out"), "⌃L");
  assert.equal(helpers.tieChordKeyName("plain-in"), "⌃⇧L");
});

test("marked Depends-on and Blocks batches absorb instead of refusing", () => {
  const srcDir = path.join(__dirname, "..", "plugins", "bob-navigation-hotkeys", "src");
  const depends = fs.readFileSync(path.join(srcDir, "410-picker-filter-and-render.js"), "utf8");
  assert.match(depends, /batchAbsorbs/);
  assert.match(depends, /Marked and counted Depends-on/);
  const blocks = fs.readFileSync(path.join(srcDir, "425-picker-blocks-stage.js"), "utf8");
  assert.match(blocks, /batchAbsorbs/);
  assert.match(blocks, /Marked and counted Blocks/);
  const relation = fs.readFileSync(path.join(srcDir, "426-picker-relation-stage.js"), "utf8");
  assert.match(relation, /can't replace a dependency in a batch/);
});

test("ID-less rows and owners prompt through the block-ID flow", () => {
  const idLessRow = { path: "n.md", line: 1, rawLine: "- [ ] Other #task", displayText: "Other" };
  const picker = { filePath: "n.md", vaultStage: null, cursor: { line: 0 }, getEditorContent: () => "- [ ] Owner #task ^aaa" };
  const missing = helpers.tieMissingIdRequest(picker, idLessRow);
  assert.ok(missing && missing.missingSide === "other");
  assert.equal(missing.missing.path, "n.md");
  const bothMissing = helpers.tieMissingIdRequest(
    { filePath: "n.md", vaultStage: { dependent: { path: "n.md", line: 0 }, files: new Map([["n.md", "- [ ] Owner #task\n- [ ] Other #task"]]) } },
    idLessRow,
  );
  assert.deepEqual(bothMissing.requests.map((request) => request.side), ["owner", "other"]);
  const srcDir = path.join(__dirname, "..", "plugins", "bob-navigation-hotkeys", "src");
  const localTask = fs.readFileSync(path.join(srcDir, "400-picker-local-task.js"), "utf8");
  assert.match(localTask, /"tie-change"/);
  const vaultBatch = fs.readFileSync(path.join(srcDir, "430-picker-vault-batch.js"), "utf8");
  assert.match(vaultBatch, /confirmTieChangeBlockId/);
  assert.match(vaultBatch, /pendingTieChange/);
});

test("both missing IDs are confirmed before a single same-note transaction", async () => {
  const h = promptHarness();
  h.modal.handleKeydown(keyEvent({ ctrlKey: true, key: "b", preventDefault() {}, stopPropagation() {} }));
  assert.equal(h.modal.blockIdMode, "tie-change");
  assert.equal(h.modal.pendingTieChange.requests.length, 2);
  const original = h.editor.getValue();
  assert.equal(await h.modal.confirmBlockId({ id: "owner", valid: true }), false);
  assert.equal(h.modal.pendingTieChange.promptIndex, 1);
  assert.equal(h.editor.getValue(), original);
  assert.equal(h.editor.undoGroups, 0);

  // The reservation from the first prompt prevents reusing the same id.
  assert.equal(await h.modal.confirmBlockId({ id: "owner", valid: true }), false);
  assert.equal(h.editor.getValue(), original);
  assert.equal(h.modal.pendingTieChange.promptIndex, 1);
  assert.equal(await h.modal.confirmBlockId({ id: "other", valid: true }), true);
  assert.match(h.editor.getValue(), /Owner \[id:: n__owner\][^\n]*\^owner/);
  assert.match(h.editor.getValue(), /Other \[id:: n__other\] \^other/);
  assert.match(h.editor.getValue(), /DEPENDS ON:.*\[\[#\^other\]\]/);
  assert.equal(h.editor.undoGroups, 1);
});

test("owner-only and target-only prompts commit, including a cross-note target prep", async () => {
  const ownerOnly = promptHarness({ otherId: true });
  ownerOnly.modal.handleKeydown(keyEvent({ ctrlKey: true, key: "b", preventDefault() {}, stopPropagation() {} }));
  assert.equal(ownerOnly.modal.pendingTieChange.requests.length, 1);
  assert.equal(ownerOnly.modal.pendingTieChange.missingSide, "owner");
  assert.equal(await ownerOnly.modal.confirmBlockId({ id: "owner", valid: true }), true);
  assert.equal(ownerOnly.editor.undoGroups, 1);
  assert.match(ownerOnly.editor.getValue(), /Owner \[id:: n__owner\][^\n]*\^owner/);

  const targetOnly = promptHarness({ ownerId: true, crossNote: true });
  targetOnly.modal.handleKeydown(keyEvent({ ctrlKey: true, key: "b", preventDefault() {}, stopPropagation() {} }));
  assert.equal(targetOnly.modal.pendingTieChange.requests.length, 1);
  assert.equal(targetOnly.modal.pendingTieChange.missingSide, "other");
  assert.equal(await targetOnly.modal.confirmBlockId({ id: "other", valid: true }), true);
  assert.equal(targetOnly.editor.undoGroups, 1);
  assert.match(targetOnly.notes.get("Other.md"), /Other \[id:: Other__other\] \^other/);
  assert.match(targetOnly.editor.getValue(), /DEPENDS ON:.*\[\[Other#\^other\]\]/);
});

test("Escape at either ID prompt and stale notes leave preparations unwritten", async () => {
  const cancelFirst = promptHarness();
  cancelFirst.modal.handleKeydown(keyEvent({ ctrlKey: true, key: "b", preventDefault() {}, stopPropagation() {} }));
  const beforeFirst = cancelFirst.editor.getValue();
  cancelFirst.modal.handleKeydown(keyEvent({ key: "Escape", preventDefault() {}, stopPropagation() {} }));
  assert.equal(cancelFirst.editor.getValue(), beforeFirst);
  assert.equal(cancelFirst.editor.undoGroups, 0);
  assert.equal(cancelFirst.modal.pendingTieChange, null);

  const cancelSecond = promptHarness();
  cancelSecond.modal.handleKeydown(keyEvent({ ctrlKey: true, key: "b", preventDefault() {}, stopPropagation() {} }));
  const beforeSecond = cancelSecond.editor.getValue();
  await cancelSecond.modal.confirmBlockId({ id: "owner", valid: true });
  cancelSecond.modal.handleKeydown(keyEvent({ key: "Escape", preventDefault() {}, stopPropagation() {} }));
  assert.equal(cancelSecond.editor.getValue(), beforeSecond);
  assert.equal(cancelSecond.editor.undoGroups, 0);
  assert.equal(cancelSecond.modal.pendingTieChange, null);

  const stale = promptHarness();
  stale.modal.handleKeydown(keyEvent({ ctrlKey: true, key: "b", preventDefault() {}, stopPropagation() {} }));
  await stale.modal.confirmBlockId({ id: "owner", valid: true });
  stale.editor.content += "\nconcurrent edit";
  await stale.modal.confirmBlockId({ id: "other", valid: true });
  assert.equal(stale.editor.undoGroups, 0);
  assert.match(stale.editor.getValue(), /concurrent edit/);
  assert.ok(notices.some((notice) => /changed — reopen/.test(notice)));
});

test("marked and counted chords refuse before opening an ID prompt", () => {
  for (const refusal of [
    { getMarkedCount: () => 1 },
    { isCountedSession: () => true },
  ]) {
    const h = promptHarness();
    Object.assign(h.modal, refusal);
    h.modal.handleKeydown(keyEvent({ ctrlKey: true, key: "b", preventDefault() {}, stopPropagation() {} }));
    assert.equal(h.modal.pendingTieChange || null, null);
    assert.equal(h.modal.blockIdMode, "single");
    assert.equal(h.editor.undoGroups, 0);
  }
});

test("armed release: first ↵ arms, moving/disarming clears, second ↵ commits", () => {
  const owner = { path: "n.md", blockId: "aaa" };
  const other = { path: "n.md", blockId: "bbb" };
  const to = "plain-out";
  const key = helpers.tieArmedKey(owner, other, to);
  const picker = { tieArmedRelease: Object.freeze({ key, owner, other, to, display: "Other" }) };
  assert.equal(helpers.tieIsArmedFor(picker, owner, other, to), true);
  assert.equal(helpers.tieIsArmedFor(picker, owner, other, "plain-in"), false);
  helpers.tieDisarm(picker);
  assert.equal(helpers.tieGetArmed(picker), null);
  assert.equal(helpers.tieReleaseArmCopy({ displayText: "Other" }).includes("↵ again"), true);
});

test("Enter routing: Depends/Blocks convert, Links arm", () => {
  const dependsPicker = { stage: "value", isLocalTaskStage: () => true, blocksStage: false, relationStage: false };
  const linksPicker = { stage: "value", isLocalTaskStage: () => true, blocksStage: false, relationStage: true, relationStageDirection: "to" };
  const converting = { kind: "local-task", tieConvert: true, stageSection: "results", disabled: false };
  assert.deepEqual(helpers.tieEnterForRow(dependsPicker, converting), { action: "convert-dependency", to: "owner-waits" });
  assert.deepEqual(helpers.tieEnterForRow(linksPicker, converting), { action: "arm-release", to: "plain-out" });
  assert.equal(helpers.tieEnterForRow(dependsPicker, { kind: "local-task" }), null);
});

test("label stage: plain row disabled while a dependency ties the pair", () => {
  assert.equal(helpers.tieLabelPlainGuardReason({ tieInfo: null }), null);
  assert.equal(
    helpers.tieLabelPlainGuardReason({ tieInfo: { waitsOn: true } }),
    "A dependency ties them · ⌃L makes it a plain link",
  );
  assert.equal(
    helpers.tieLabelGuardForPicker({ relationLabelTargets: [{ tieInfo: { waitedOnBy: true } }] }),
    "A dependency ties them · ⌃L makes it a plain link",
  );
  assert.equal(helpers.tieLabelGuardForPicker({ relationLabelTargets: [{ tieInfo: null }] }), null);
});

test("footer hints: stage-backed plans show only valid contextual chords", () => {
  const ownerLine = taskLine(" ", "Owner", "aaa");
  const otherLine = taskLine(" ", "Other", "bbb");
  const content = [ownerLine, otherLine].join("\n");
  const owner = { path: "n.md", line: 0, blockId: "aaa", rawLine: ownerLine, displayText: "Owner", status: " " };
  const other = { path: "n.md", line: 1, blockId: "bbb", rawLine: otherLine, displayText: "Other", status: " " };
  const stage = { dependent: owner, files: new Map([["n.md", content]]) };
  const plugin = {
    dependencyLinkpathResolver: () => (note, from) => (!note ? from : `${note}.md`),
    readDependencyVaultFileList: () => ["n.md"],
  };
  const dependsPicker = {
    stage: "value",
    filePath: "n.md",
    plugin,
    vaultStage: stage,
    cursor: { line: 0 },
    getEditorContent: () => content,
    isLocalTaskStage: () => true,
    blocksStage: false,
    relationStage: false,
    visibleItems: [],
    selectedIndex: 0,
  };
  const row = { ...other, kind: "local-task", tieInfo: null, disabled: false };
  const hints = helpers.tieChordHintsForItem(dependsPicker, row);
  assert.deepEqual(hints.map((hint) => hint.keys[0]), ["⌃⇧B", "⌃L", "⌃⇧L"]);

  const relationPicker = { ...dependsPicker, relationStage: true, relationStageDirection: "to" };
  const alreadyWaiting = { ...row, tieInfo: { waitsOn: true } };
  assert.ok(!helpers.tieChordHintsForItem(relationPicker, alreadyWaiting)
    .some((hint) => hint.keys.includes("⌃B")));
  assert.deepEqual(helpers.tieChordHintsForItem(dependsPicker, { ...row, stale: true }), []);
});

test("stage-flag leak: entering a stage resets the other stage flags and disarms", () => {
  const srcDir = path.join(__dirname, "..", "plugins", "bob-navigation-hotkeys", "src");
  const localTask = fs.readFileSync(path.join(srcDir, "400-picker-local-task.js"), "utf8");
  assert.match(localTask, /this\.blocksStage = false;\s*\n\s*this\.relationStage = false;/);
  const blocks = fs.readFileSync(path.join(srcDir, "425-picker-blocks-stage.js"), "utf8");
  assert.match(blocks, /this\.blocksStage = true;\s*\n\s*this\.relationStage = false;/);
  const relation = fs.readFileSync(path.join(srcDir, "426-picker-relation-stage.js"), "utf8");
  assert.match(relation, /this\.blocksStage = false;\s*\n\s*this\.relationStage = true;/);
});
