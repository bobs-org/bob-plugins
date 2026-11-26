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

test("footer hints: contextual chords only, never the ↵ tie, never no-ops", () => {
  const dependsPicker = { stage: "value", isLocalTaskStage: () => true, blocksStage: false, relationStage: false, visibleItems: [], selectedIndex: 0 };
  const untied = { kind: "local-task", tieInfo: null, disabled: false };
  const hints = helpers.tieChordHintsForItem(dependsPicker, untied);
  assert.ok(hints.length >= 3);
  assert.ok(!hints.some((hint) => hint.to === "owner-waits"));
  const alreadyWaiting = { kind: "local-task", tieInfo: { waitsOn: true }, disabled: false };
  assert.ok(!helpers.tieChordHintsForItem(dependsPicker, alreadyWaiting).some((hint) => hint.to === "owner-waits"));
  assert.deepEqual(helpers.tieChordHintsForItem(dependsPicker, { ...untied, disabled: true }), []);
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
