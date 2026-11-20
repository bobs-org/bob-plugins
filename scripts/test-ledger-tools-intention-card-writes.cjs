// Guarded intention writes through real sessions: reviewed stale retries keep
// the intended operation and target (never an old index on a changed list),
// save-blocked retries, Undo and normal applies share one busy window that
// competing keys, clicks, travel, and close cannot supersede, and one field
// reconciliation for reads, applies, refreshes, and Undo.
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  loadLedgerTools, deferred, flush, fakeVault, installBobSimulator, simulatorDigest,
} = require("./intention-card-test-helpers.cjs");

const LedgerToolsPlugin = loadLedgerTools();
const H = LedgerToolsPlugin.helpers;
const DAY = "2026/20261119.md";
const NEXT_DAY = "2026/20261120.md";
const SUBJECTS = { "2026-11-19": DAY, "2026-11-20": NEXT_DAY };

function setup(fields, options = {}) {
  const vault = fakeVault();
  vault.seed(DAY, fields);
  vault.seed(NEXT_DAY, { intentions: ["Tomorrow"] });
  const plugin = new LedgerToolsPlugin(vault.app);
  plugin.albumSetTimeout = () => 0;
  plugin.albumClearTimeout = () => {};
  plugin.intentionCardEditorToday = () => "2026-11-19";
  plugin.intentionCardNavigationToday = () => "2026-11-19";
  plugin.setupIntentionUpdate();
  plugin.setupIntentionCardEditor();
  const calls = installBobSimulator(plugin, vault, SUBJECTS, options);
  const read = plugin.intentionCardEditorReadFields(DAY);
  const modal = new H.IntentionCardModal(vault.app, {
    plugin, subject: "2026-11-19", subjectPath: DAY, state: "open", fields: read.ok ? read.fields : null,
  });
  plugin.intentionCardEditorModal = modal;
  return { vault, plugin, modal, calls };
}

const applies = (calls) => calls.filter((call) => !call.dryRun);
const key = (name, extra = {}) => ({ key: name, target: null, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra });

// Another pane edits the owned fields after the card read them.
function editElsewhere(vault, fields) {
  vault.write(DAY, fields);
}

test("a stale remove keeps the remove, retargets it by text, and retries only on Enter", async () => {
  let edits = 0;
  const { vault, modal, calls } = setup({ intentions: ["A", "B"] }, {
    beforePreview: (_subject, text) => {
      if (JSON.parse(text).ops.length && edits++ === 0) editElsewhere(vault, { intentions: ["X", "A", "B"] });
    },
  });
  await modal.intentionInitialRead();
  modal.intentionSelect("intention:0");
  await modal.intentionRemove();
  assert.equal(modal.statusKind, "stale");
  assert.deepEqual(modal.fields.intentions, ["X", "A", "B"], "the refreshed list is shown");
  assert.equal(modal.retained.intent.kind, "remove", "the intended operation survives the refusal");
  assert.equal(modal.selectedKey, "intention:1", "the target is selected against refreshed fields");
  assert.match(modal.refusalHint, /Enter removes “A” \(#2\)/);
  assert.equal(applies(calls).length, 0, "nothing was applied");

  modal.intentionOnKeyDown(key("Enter"));
  await flush();
  const sent = applies(calls).at(-1).envelope;
  assert.deepEqual(sent.ops, [{ op: "intentions.remove", index: 1 }], "never a replace, never the old index");
  assert.deepEqual(vault.fields.get(DAY).intentions, ["X", "B"]);
  assert.equal(modal.retained, null);
});

test("a stale reorder rebases the move onto the refreshed list", async () => {
  let edits = 0;
  const { vault, modal, calls } = setup({ intentions: ["A", "B", "C"] }, {
    beforePreview: (_subject, text) => {
      if (JSON.parse(text).ops.length && edits++ === 0) editElsewhere(vault, { intentions: ["Z", "A", "B", "C"] });
    },
  });
  await modal.intentionInitialRead();
  modal.intentionSelect("intention:0");
  modal.intentionOnKeyDown(key("j", { altKey: true }));
  await flush();
  assert.equal(modal.retained.intent.kind, "move");
  assert.match(modal.refusalHint, /Enter moves “A” from #2 to #3/);
  modal.intentionOnKeyDown(key("Enter"));
  await flush();
  assert.deepEqual(applies(calls).at(-1).envelope.ops, [{ op: "intentions.move", from: 1, to: 2 }]);
  assert.deepEqual(vault.fields.get(DAY).intentions, ["Z", "B", "A", "C"]);
  assert.equal(modal.selectedKey, "intention:2", "selection follows the moved row");
});

test("a retained target that disappeared is refused, not guessed", async () => {
  let edits = 0;
  const { vault, modal, calls } = setup({ intentions: ["A", "B"] }, {
    beforePreview: (_subject, text) => {
      if (JSON.parse(text).ops.length && edits++ === 0) editElsewhere(vault, { intentions: ["B"] });
    },
  });
  await modal.intentionInitialRead();
  modal.intentionSelect("intention:0");
  await modal.intentionRemove();
  assert.equal(modal.retained, null);
  assert.match(modal.refusalHint, /“A” is no longer in the list — nothing to remove/);
  modal.intentionOnKeyDown(key("Enter"));
  await flush();
  assert.equal(applies(calls).length, 0, "Enter never runs a hidden or guessed write");
  modal.close();
});

test("a stage draft rebases across an insertion and a deletion between preview and retry", async () => {
  const states = [{ intentions: ["B"] }, { intentions: ["N", "B"] }];
  let previews = 0;
  const { vault, modal, calls } = setup({ intentions: ["A", "B"] }, {
    beforePreview: (_subject, text) => {
      if (!JSON.parse(text).ops.length) return;
      const next = states[previews++];
      if (next) editElsewhere(vault, next);
    },
  });
  await modal.intentionInitialRead();
  modal.intentionOpenStage("intention", "intention:1");
  modal.stageDraft = "B, but better";
  await modal.intentionSaveStage();
  assert.equal(modal.statusKind, "stale");
  assert.equal(modal.stage.index, 0, "A was deleted elsewhere: B is now #1");
  assert.equal(modal.stageDraft, "B, but better", "the exact draft is kept");
  assert.match(modal.stageNote, /over “B” \(now #1\)/);

  await modal.intentionSaveStage();
  assert.equal(modal.statusKind, "stale", "an insertion before the retry refuses again");
  assert.equal(modal.stage.index, 1);
  assert.match(modal.stageNote, /now #2/);

  await modal.intentionSaveStage();
  assert.deepEqual(applies(calls).at(-1).envelope.ops, [{ op: "intentions.replace", index: 1, value: "B, but better" }]);
  assert.deepEqual(vault.fields.get(DAY).intentions, ["N", "B, but better"]);
  assert.equal(modal.stage, null);
});

test("a save-blocked remove waits for an explicit retry once panes save", async () => {
  const { vault, modal, calls } = setup({ intentions: ["A", "B"] });
  await modal.intentionInitialRead();
  const view = { file: { path: DAY } };
  vault.app.workspace.leaves = [{ view }];
  modal.intentionSelect("intention:1");
  await modal.intentionRemove();
  assert.equal(modal.statusKind, "save-blocked");
  assert.equal(modal.retained.intent.kind, "remove");
  assert.match(modal.refusalHint, /Save every pane showing the note, then enter removes “B” \(#2\)/);
  assert.equal(calls.length, 1, "no preview ran while the pane could not save");
  view.save = async () => {};
  modal.intentionOnKeyDown(key("Enter"));
  await flush();
  assert.deepEqual(applies(calls).at(-1).envelope.ops, [{ op: "intentions.remove", index: 1 }]);
  assert.deepEqual(vault.fields.get(DAY).intentions, ["A"]);
});

test("canceling or discarding leaves no hidden retained write for a later Enter", async () => {
  let edits = 0;
  const { vault, modal, calls } = setup({ intentions: ["A", "B"] }, {
    beforePreview: (_subject, text) => {
      if (JSON.parse(text).ops.length && edits++ < 2) editElsewhere(vault, { intentions: ["X", ...vault.fields.get(DAY).intentions] });
    },
  });
  await modal.intentionInitialRead();
  modal.intentionSelect("intention:0");
  await modal.intentionRemove();
  assert.ok(modal.retained);
  modal.intentionOnKeyDown(key("q"));
  assert.equal(modal.retained, null, "q backs out one layer: the retained retry");
  assert.equal(modal.closed, false);
  assert.equal(modal.statusKind, "browsing");
  modal.intentionOnKeyDown(key("Enter"));
  assert.ok(modal.stage, "Enter edits the selected row instead of running the discarded write");
  modal.intentionOnKeyDown(key("Escape"));
  assert.equal(modal.stage, null);

  modal.intentionOpenStage("intention", "intention:0");
  modal.stageDraft = "Edited";
  await modal.intentionSaveStage();
  assert.equal(modal.statusKind, "stale");
  modal.intentionOnKeyDown(key("Escape"));
  assert.equal(modal.stage, null);
  assert.equal(modal.retained, null);
  assert.equal(modal.statusKind, "browsing", "no stale status describes a discarded draft");
  const before = applies(calls).length;
  modal.intentionOnKeyDown(key("Enter"));
  modal.intentionOnKeyDown(key("Escape"));
  await flush();
  assert.equal(applies(calls).length, before);
});

test("a deferred Undo holds the busy window against competing keys, clicks, travel, and close", async () => {
  const gate = deferred();
  let hold = false;
  const { vault, plugin, modal, calls } = setup({ intentions: ["A", "B"] }, {
    beforeApply: async () => { if (hold) await gate.promise; },
  });
  await modal.intentionInitialRead();
  modal.intentionOpenStage("intention", "intention:0");
  modal.stageDraft = "A2";
  await modal.intentionSaveStage();
  assert.deepEqual(vault.fields.get(DAY).intentions, ["A2", "B"]);

  hold = true;
  const undo = modal.intentionUndo();
  await flush();
  assert.equal(modal.pendingApply, true, "Undo enters the same busy state as other writes");
  const appliedBefore = applies(calls).length;
  for (const event of [key("u"), key("d", { ctrlKey: true }), key("j", { altKey: true }), key("]"), key("="), key("["), key("y"), key("Enter"), key("i"), key("Escape"), key("q"), key("[", { ctrlKey: true })]) {
    modal.intentionOnKeyDown(event);
  }
  modal.intentionHandleAction("remove");
  modal.intentionHandleAction("navigate-next");
  modal.intentionOnClick({ target: { closest: () => ({ getAttribute: (name) => (name === "data-intention-key" ? "intention:1" : null) }) }, preventDefault() {} });
  modal.intentionOnClick({ target: { closest: () => ({ getAttribute: (name) => (name === "data-intention-action" ? "save-stage" : null) }) }, preventDefault() {} });
  modal.close();
  const reopened = await plugin.openIntentionCard({ filePath: NEXT_DAY });
  assert.equal(reopened.reason, "busy", "a new open never supersedes the in-flight write");
  assert.equal(modal.closed, false, "a pointer close waits for the write");
  assert.equal(modal.closeRequested, true);
  assert.equal(modal.subjectPath, DAY, "travel is pinned until the write settles");
  assert.equal(modal.stage, null);
  assert.equal(applies(calls).length, appliedBefore, "no second mutation started");

  gate.resolve();
  const result = await undo;
  assert.equal(result.ok, true);
  assert.equal(modal.pendingApply, false);
  assert.deepEqual(vault.fields.get(DAY).intentions, ["A", "B"]);
  assert.equal(applies(calls).length, appliedBefore + 1);
  assert.equal(modal.closed, true, "the deferred close runs once the write settles");
});

test("a deferred normal apply pins its target and recovers from transport failure", async () => {
  const gate = deferred();
  let mode = "hold";
  const { vault, plugin, modal, calls } = setup({ intentions: ["A"] }, {
    beforeApply: async () => {
      if (mode === "hold") await gate.promise;
      if (mode === "fail") return { ok: false, code: "stdin-failed", message: "The envelope never reached bob." };
      if (mode === "throw") throw new Error("spawn exploded");
      return null;
    },
  });
  await modal.intentionInitialRead();
  modal.intentionOpenStage("intention", "intention:0");
  modal.stageDraft = "A1";
  const save = modal.intentionSaveStage();
  await flush();
  assert.equal(modal.pendingApply, true);
  modal.intentionOnKeyDown(key("]"));
  modal.intentionNavigateSibling(1);
  modal.intentionOnKeyDown(key("Escape"));
  assert.equal(modal.subjectPath, DAY);
  assert.ok(modal.stage, "Esc cannot cancel the stage under an in-flight apply");
  gate.resolve();
  await save;
  assert.deepEqual(vault.fields.get(DAY).intentions, ["A1"]);
  assert.ok(plugin.intentionCardOverlayFor(DAY), "the overlay is pinned to the subject the write started on");
  assert.equal(plugin.intentionCardOverlayFor(NEXT_DAY), null);

  mode = "fail";
  modal.intentionOpenStage("intention", "intention:0");
  modal.stageDraft = "A2";
  await modal.intentionSaveStage();
  assert.equal(modal.pendingApply, false);
  assert.equal(modal.statusKind, "refusal");
  assert.equal(modal.stageDraft, "A2", "the draft survives a transport failure");
  mode = "throw";
  await modal.intentionSaveStage();
  assert.equal(modal.pendingApply, false, "finally clears the busy flag even when the spawn throws");
  mode = "ok";
  await modal.intentionSaveStage();
  assert.deepEqual(vault.fields.get(DAY).intentions, ["A2"]);

  mode = "fail";
  await modal.intentionUndo();
  assert.equal(modal.pendingApply, false);
  assert.equal(modal.statusKind, "refusal");
  mode = "ok";
  await modal.intentionUndo();
  assert.deepEqual(vault.fields.get(DAY).intentions, ["A1"], "Undo recovers once the transport works");
  assert.ok(calls.length > 0);
});

test("reads and writes reconcile from the report: unset text clears, provenance follows summary_state", async () => {
  const drafted = "Agent words.";
  const { vault, modal } = setup({
    intentions: ["One"], summary: drafted, summary_digest: simulatorDigest(drafted), summary_drafted: "2026-11-18", reflection: "Kept.",
  });
  modal.fields = { ...modal.fields, summary: "Cached stale summary", reflection: "Cached stale reflection" };
  vault.write(DAY, { intentions: ["One"] });
  await modal.intentionInitialRead();
  assert.equal(modal.fields.summary, "", "a null summary clears cached modal text");
  assert.equal(modal.fields.reflection, "", "a null reflection clears cached modal text");
  assert.equal(modal.fields.summaryState, "empty");

  vault.write(DAY, { intentions: ["One"], summary: drafted, summary_digest: simulatorDigest(drafted), summary_drafted: "2026-11-18" });
  vault.index(DAY);
  await H.intentionCardEditorReadFresh(modal, modal.readSeq);
  assert.equal(modal.fields.summaryState, "agent", "drafted maps to the card's agent state");
  assert.equal(modal.fields.summaryDrafted, "2026-11-18", "the date comes from matching metadata");

  modal.intentionOpenStage("summary", "summary");
  assert.equal(modal.stageNote, H.INTENTION_CARD_EDITOR_SUMMARY_EXPLAINER);
  modal.stageDraft = "";
  await modal.intentionSaveStage();
  assert.deepEqual(vault.fields.get(DAY).summary, undefined, "clearing the summary unsets it");
  assert.equal(modal.fields.summaryState, "empty");
  await modal.intentionUndo();
  assert.equal(modal.fields.summary, drafted);
  assert.equal(modal.fields.summaryState, "agent");
  assert.equal(modal.fields.summaryDrafted, "2026-11-18", "restored stamps appear without a reopen");
});

test("later metadata refreshes the drafted date in an open modal", async () => {
  const drafted = "Agent words.";
  const { vault, plugin, modal } = setup({ intentions: ["One"] });
  vault.write(DAY, { intentions: ["One"], summary: drafted, summary_digest: simulatorDigest(drafted), summary_drafted: "2026-11-19" });
  await modal.intentionInitialRead();
  assert.equal(modal.fields.summaryState, "agent");
  assert.equal(modal.fields.summaryDrafted, "", "metadata has not caught up, so no date is invented");
  vault.index(DAY);
  plugin.intentionCardActive = true;
  plugin.intentionCardHost = () => ({ scheduleRefresh() {} });
  plugin.intentionCardToday = () => "2026-11-19";
  plugin.intentionCardOnMetadata({ path: DAY });
  assert.equal(modal.fields.summaryDrafted, "2026-11-19");
});

test("the empty-value contract: clear removes or unsets; a blank Add writes nothing", async () => {
  const { vault, modal, calls } = setup({ intentions: ["A", "B"], reflection: "Thoughts." });
  await modal.intentionInitialRead();
  modal.intentionOpenStage("intention", "intention:0");
  modal.stageDraft = "   ";
  await modal.intentionSaveStage();
  assert.deepEqual(applies(calls).at(-1).envelope.ops, [{ op: "intentions.remove", index: 0 }]);
  assert.deepEqual(vault.fields.get(DAY).intentions, ["B"]);

  modal.intentionHandleAction("insert-below");
  modal.stageDraft = "  ";
  const before = calls.length;
  await modal.intentionSaveStage();
  assert.equal(calls.length, before, "a blank Add never reaches bob");
  assert.equal(modal.stageNote, "An intention needs one line of text.");
  modal.intentionCancelStage();

  modal.intentionOpenStage("reflection", "reflection");
  modal.stageDraft = "";
  await modal.intentionSaveStage();
  assert.deepEqual(applies(calls).at(-1).envelope.ops, [{ op: "reflection.unset" }]);
});

test("validation refusals stay distinct from an old bob, and both keep the draft", async () => {
  let mode = "invalid";
  const { modal } = setup({ intentions: ["A"] }, {
    beforeApply: async () => (mode === "invalid"
      ? { ok: true, report: { ok: false, schema_version: 1, error: { code: "multiline_summary", message: "summary must be a single paragraph", hint: "Join the lines." } } }
      : { ok: false, code: "needs-update", message: "This bob does not support `bob periods update`." }),
  });
  await modal.intentionInitialRead();
  modal.intentionOpenStage("summary", "summary");
  modal.stageDraft = "Draft summary";
  await modal.intentionSaveStage();
  assert.equal(modal.statusKind, "refusal");
  assert.equal(modal.writable, true);
  assert.match(modal.refusalMessage, /single paragraph/);
  assert.equal(modal.stageDraft, "Draft summary");
  mode = "old";
  await modal.intentionSaveStage();
  assert.equal(modal.statusKind, "needs-update");
  assert.equal(modal.refusalMessage, "Update bob to edit intentions");
  assert.equal(modal.stageDraft, "Draft summary");
});

test("rebase planning is pure and explicit", () => {
  const fields = { intentions: ["A", "B", "A"] };
  assert.equal(H.intentionCardEditorRebaseIntent({ kind: "remove", index: 5, original: "A" }, fields).reason, "target-ambiguous");
  assert.deepEqual(H.intentionCardEditorRebaseIntent({ kind: "remove", index: 2, original: "A" }, fields).ops, [{ op: "intentions.remove", index: 2 }]);
  const gone = H.intentionCardEditorRebaseIntent({ kind: "replace", index: 7, original: "Q", value: "R" }, fields);
  assert.equal(gone.intent.kind, "insert");
  assert.match(gone.note, /adds your draft as Intention 4/);
  assert.deepEqual(H.intentionCardEditorRebaseIntent({ kind: "insert", index: 1, after: "B", before: null, value: "N" }, fields).ops,
    [{ op: "intentions.insert", index: 2, value: "N" }]);
  assert.deepEqual(H.intentionCardEditorRebaseIntent({ kind: "move", from: 0, delta: -1, original: "B" }, fields).ops,
    [{ op: "intentions.move", from: 1, to: 0 }], "a moved target is found by text");
  assert.equal(H.intentionCardEditorRebaseIntent({ kind: "move", from: 1, delta: 2, original: "B" }, fields).reason, "move-out-of-range");
  assert.equal(H.intentionCardEditorIntentFromStage({ kind: "intention", field: "add", index: 0 }, " ", fields), null);
  assert.deepEqual(H.intentionCardEditorIntentFromStage({ kind: "intention", field: "intention:1", index: 1, original: "B" }, "", fields),
    { kind: "remove", index: 1, original: "B" });
  assert.equal(H.intentionCardEditorEscLadder({ retained: { intent: {} } }), "discard-retry");
});

// Real writer: the production periods service spawns an explicit current bob
// (BOB_BIN) against a scratch vault. Mock-only tests cannot prove writer
// compatibility for reviewed retries, stamped Undo, or body preservation.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const REAL_BOB = process.env.BOB_BIN && fs.existsSync(process.env.BOB_BIN) ? process.env.BOB_BIN : "";

test("real bob: modal writes, reviewed stale retry, stamped Undo, and body-only edits", { skip: !REAL_BOB && "no bob binary (set BOB_BIN)" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bob-intention-landing-"));
  const note = path.join(dir, "2026", "20261119.md");
  fs.mkdirSync(path.dirname(note), { recursive: true });
  const drafted = "Agent drafted the day.";
  const digest = simulatorDigest(drafted);
  const body = "# Thu Nov 19, 2026\n\nUnrelated body stays put.\n";
  fs.writeFileSync(note, `---\nintentions:\n  - Ship it\n  - Read\nsummary: ${drafted}\nsummary_digest: ${digest}\nsummary_drafted: 2026-11-18\nother: kept\n---\n\n${body}`);
  const file = { path: DAY };
  const metadata = { intentions: ["Ship it", "Read"], summary: drafted, summary_digest: digest, summary_drafted: "2026-11-18", other: "kept" };
  const app = {
    vault: { getAbstractFileByPath: (p) => (p === DAY ? file : null) },
    metadataCache: { getFileCache: () => ({ frontmatter: metadata }) },
    workspace: { getLeavesOfType: () => [] },
  };
  const plugin = new LedgerToolsPlugin(app);
  plugin.albumSetTimeout = () => 0;
  plugin.albumClearTimeout = () => {};
  plugin.apiStatsBobPath = () => ({ path: REAL_BOB, source: "test" });
  plugin.statsVaultBasePath = () => dir;
  plugin.setupIntentionUpdate();
  plugin.setupIntentionCardEditor();
  const read = plugin.intentionCardEditorReadFields(DAY);
  const modal = new H.IntentionCardModal(app, { plugin, subject: "2026-11-19", subjectPath: DAY, state: "open", fields: read.fields });
  await modal.intentionInitialRead();
  assert.equal(modal.statusKind, "browsing", modal.refusalMessage);
  assert.equal(modal.fields.summaryState, "agent");
  const bytes = () => fs.readFileSync(note, "utf8");

  // Replace through a stage.
  modal.intentionOpenStage("intention", "intention:0");
  modal.stageDraft = "Ship the card";
  const replaced = await modal.intentionSaveStage();
  assert.equal(replaced.ok, true, JSON.stringify(replaced));
  assert.match(bytes(), /Ship the card/);
  assert.match(bytes(), /Unrelated body stays put/);
  assert.match(bytes(), /other: kept/);

  // Another pane inserts an intention: the remove of "Read" refuses stale,
  // then retries against the refreshed list by text, only on Enter.
  const inserted = bytes().replace(/^intentions:\n([ \t]*)- /m, "intentions:\n$1- Elsewhere first\n$1- ");
  assert.notEqual(inserted, bytes(), "the external insert matched the written list");
  fs.writeFileSync(note, inserted);
  modal.intentionSelect("intention:1");
  await modal.intentionRemove();
  assert.equal(modal.statusKind, "stale", modal.refusalMessage);
  assert.deepEqual(modal.fields.intentions, ["Elsewhere first", "Ship the card", "Read"]);
  assert.match(modal.refusalHint, /Enter removes “Read” \(#3\)/);
  assert.match(bytes(), /- Read/, "nothing was applied before the reviewed retry");
  modal.intentionOnKeyDown({ key: "Enter", target: null, preventDefault() {} });
  assert.equal(modal.pendingApply, true, "Enter started the reviewed retry");
  while (modal.pendingApply) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.doesNotMatch(bytes(), /- Read\b/);
  assert.match(bytes(), /Elsewhere first/);

  // A body-only edit elsewhere is not a field conflict.
  fs.writeFileSync(note, `${bytes()}\nMore body from another pane.\n`);
  modal.intentionOpenStage("reflection", "reflection");
  modal.stageDraft = "Tired, but the card works.";
  const reflected = await modal.intentionSaveStage();
  assert.equal(reflected.ok, true, JSON.stringify(reflected));
  assert.match(bytes(), /More body from another pane/);
  assert.match(bytes(), /Tired, but the card works/);

  // A summary edit drops both stamps; Undo restores them and the modal shows
  // the restored provenance and date without a reopen.
  modal.intentionOpenStage("summary", "summary");
  modal.stageDraft = "My own words.";
  await modal.intentionSaveStage();
  assert.doesNotMatch(bytes(), /summary_digest/);
  assert.equal(modal.fields.summaryState, "edited");
  const undone = await modal.intentionUndo();
  assert.equal(undone.ok, true, JSON.stringify(undone));
  assert.match(bytes(), new RegExp(`summary_digest: ['"]?${digest}`));
  assert.match(bytes(), /summary_drafted: ['"]?2026-11-18/);
  assert.equal(modal.fields.summary, drafted);
  assert.equal(modal.fields.summaryState, "agent");
  assert.equal(modal.fields.summaryDrafted, "2026-11-18");
  assert.match(bytes(), /More body from another pane/);
  modal.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
