// Intention card editor: periods update service decoding, key dispatch,
// stage semantics, reorder math, stale/refusal retention, superseded
// replies, overlay settlement, old-bob degradation, and a real-bob
// scratch-fixture round trip (preview/apply/Undo, body-edit survival).
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin {
  constructor(app) { this.app = app; }
}

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: class {}, Notice: class {}, Platform: { isDesktopApp: true },
      Plugin: TestPlugin, normalizePath: (value) => value,
      parseYaml: (text) => JSON.parse(text),
    };
  }
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value } };
  if (request === "@codemirror/view") {
    return {
      EditorView: { updateListener: { of: (listener) => ({ listener }) } },
      keymap: { of: (value) => value },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const H = LedgerToolsPlugin.helpers;
Module._load = originalLoad;

function updateReport(overrides = {}) {
  return {
    ok: true, schema_version: 1,
    subject: { id: "2026-11-19", kind: "day", label: "Thu Nov 19, 2026", path: "2026/20261119.md" },
    dry_run: true, fingerprint_before: "sha256:aaa", fingerprint_after: "sha256:bbb",
    before: { intentions: [] }, after: { intentions: ["Ship it"] },
    changed: true, inverse_ops: [], warnings: [],
    ...overrides,
  };
}

test("periods update uses -n and the envelope omits an empty expect", () => {
  assert.deepEqual(H.intentionUpdateArgs("2026-11-19", { dryRun: true }).slice(-1), ["-n"]);
  assert.ok(!H.intentionUpdateArgs("2026-11-19").includes("-n"));
  assert.ok(!H.intentionUpdateArgs("2026-11-19", { dryRun: true }).includes("-d"));
  assert.deepEqual(JSON.parse(H.intentionUpdateEnvelopeText("", [])), { schema_version: 1, ops: [] });
  const guarded = JSON.parse(H.intentionUpdateEnvelopeText("sha256:aaa", [{ op: "reflection.unset" }]));
  assert.equal(guarded.expect, "sha256:aaa");
  assert.equal(H.intentionIsStaleUpdateCode("stale_note"), true);
  assert.equal(H.intentionIsStaleUpdateCode("stale_record"), false);
});

test("periods update decoding separates refusals from transport failures", () => {
  const good = H.intentionDecodeUpdateReport(JSON.stringify(updateReport()), "", 0);
  assert.equal(good.ok, true);
  assert.equal(good.report.fingerprint_before, "sha256:aaa");

  const refused = H.intentionDecodeUpdateReport(JSON.stringify({
    ok: false, schema_version: 1,
    error: { code: "stale_note", message: "changed", hint: "retry" },
  }), "", 1);
  assert.equal(refused.ok, true);
  assert.equal(refused.report.ok, false);

  const oldBob = H.intentionDecodeUpdateReport("error: unknown subcommand `update` for `bob periods`", "", 2);
  assert.equal(oldBob.ok, false);
  assert.equal(oldBob.code, "needs-update");
  assert.equal(H.intentionUpdateErrorModel(oldBob).hint, "Update bob to edit intentions.");

  // A real validation failure also exits 2 but carries a typed JSON body.
  const invalid = H.intentionDecodeUpdateReport(JSON.stringify({
    ok: false, schema_version: 1,
    error: { code: "invalid_op", message: "bad index", op_index: 0 },
  }), "usage error", 2);
  assert.equal(invalid.ok, true);
  assert.equal(invalid.report.error.code, "invalid_op");

  const badJson = H.intentionDecodeUpdateReport("not json", "boom", 1);
  assert.equal(badJson.ok, false);
  assert.equal(badJson.code, "bad-json");

  const mismatch = H.intentionDecodeUpdateReport(JSON.stringify({ ...updateReport(), schema_version: 999 }), "", 0);
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.code, "schema-mismatch");

  // Inverse ops stay opaque: a stamped-summary Undo round-trips its restore.
  const restore = {
    op: "summary.restore", present: true, value: "Drafted",
    digest: "sha256:abc", drafted: "2026-11-19",
  };
  const withRestore = H.intentionDecodeUpdateReport(
    JSON.stringify(updateReport({ inverse_ops: [restore], dry_run: false })), "", 0);
  assert.deepEqual(withRestore.report.inverse_ops, [restore]);
  const overlay = H.intentionOverlayFromReport(withRestore.report);
  assert.deepEqual(overlay.fields, { intentions: ["Ship it"] });
  assert.equal(overlay.fingerprint, "sha256:bbb");
});

test("browse key dispatch follows the approved field-key table", () => {
  const browse = (key, extra = {}) => H.intentionCardEditorKeyAction({ key, ...extra }, { inInput: false, stage: null });
  assert.equal(browse("j"), "move-next");
  assert.equal(browse("ArrowDown"), "move-next");
  assert.equal(browse("Tab"), "move-next");
  assert.equal(browse("k"), "move-prev");
  assert.equal(browse("ArrowUp"), "move-prev");
  assert.equal(browse("Tab", { shiftKey: true }), "move-prev");
  assert.equal(browse("1"), "select-digit:1");
  assert.equal(browse("9"), "select-digit:9");
  assert.equal(browse("Enter"), "edit-selected");
  assert.equal(browse("i"), "edit-first-or-add");
  assert.equal(browse("o"), "insert-below");
  assert.equal(browse("O"), "insert-above");
  assert.equal(browse("r"), "open-reflection");
  assert.equal(browse("s"), "select-summary");
  assert.equal(browse("j", { altKey: true }), "reorder-down");
  assert.equal(browse("K", { altKey: true }), "reorder-up");
  assert.equal(browse("d", { ctrlKey: true }), "remove");
  assert.equal(browse("u"), "undo");
  assert.equal(H.intentionCardEditorKeyAction({ key: "Enter" }, { inInput: false, stage: { kind: "intention" } }), "save-stage");
  assert.equal(H.intentionCardEditorKeyAction({ key: "Escape" }, { inInput: true, stage: { kind: "reflection" } }), "cancel-stage");
  assert.equal(H.intentionCardEditorKeyAction({ key: "Enter", shiftKey: true }, { inInput: true, stage: { kind: "reflection" } }), null);
  assert.equal(H.intentionCardEditorKeyAction({ key: "Enter", ctrlKey: true }, { inInput: true, stage: { kind: "reflection" } }), "save-and-close");
  assert.equal(H.intentionCardEditorKeyAction({ key: "Enter" }, { inInput: true, stage: { kind: "reflection" } }), "save-stage");
  assert.equal(H.intentionCardEditorEscLadder({ stage: { kind: "intention" } }), "cancel-stage");
  assert.equal(H.intentionCardEditorEscLadder({ stage: null }), "close");
  assert.equal(H.intentionCardEditorEscLadder({ stage: null, pendingApply: true }), "ignore");
});

test("opening selection lands on first intention, Add, or Reflection", () => {
  const fields = { intentions: ["One", "Two"], summary: "", reflection: "" };
  const targets = H.intentionCardEditorTargets(fields);
  assert.equal(H.intentionCardEditorOpeningSelection(targets, "open"), "intention:0");
  assert.equal(H.intentionCardEditorOpeningSelection(targets, "closed"), "reflection");
  const empty = H.intentionCardEditorTargets({ intentions: [], summary: "", reflection: "" });
  assert.equal(H.intentionCardEditorOpeningSelection(empty, "open"), "add");
  assert.equal(H.intentionCardEditorOpeningSelection(targets, "open", "summary"), "summary");
  assert.equal(H.intentionCardEditorNavigate(targets, "intention:0", 1), "intention:1");
  assert.equal(H.intentionCardEditorNavigate(targets, "summary", 1), "intention:0");
  assert.equal(H.intentionCardEditorNavigate(targets, "intention:0", -1), "summary");
});

test("stage semantics: one-line paste collapse, summary unset, soft cap", () => {
  assert.deepEqual(H.intentionCardNormalizeIntentionLine("a\nb\rc"), { value: "a b c", collapsed: true });
  assert.deepEqual(H.intentionCardNormalizeIntentionLine("plain"), { value: "plain", collapsed: false });
  assert.deepEqual(H.intentionOpsSummary("  "), [{ op: "summary.unset" }]);
  assert.deepEqual(H.intentionOpsReflection(""), [{ op: "reflection.unset" }]);
  assert.deepEqual(H.intentionOpsInsert(0, "x"), [{ op: "intentions.insert", index: 0, value: "x" }]);
  assert.deepEqual(H.intentionOpsReplace(2, "y"), [{ op: "intentions.replace", index: 2, value: "y" }]);
  assert.deepEqual(H.intentionOpsMove(0, 1), [{ op: "intentions.move", from: 0, to: 1 }]);
  assert.deepEqual(H.intentionOpsRemove(1), [{ op: "intentions.remove", index: 1 }]);
  assert.equal(H.intentionCardEditorSoftCapHint(3), "");
  assert.equal(H.intentionCardEditorSoftCapHint(4), "Three is plenty — what can go?");
  assert.deepEqual(H.intentionCardReorderedList(["a", "b", "c"], 0, 2), ["b", "c", "a"]);
  assert.deepEqual(H.intentionCardReorderedList(["a", "b", "c"], 5, 0), ["a", "b", "c"]);
  assert.equal(H.intentionCardEditorStageFor({ kind: "add" }), "intention");
});

function installMixin(plugin, MixinClass) {
  for (const key of Object.getOwnPropertyNames(MixinClass.prototype)) {
    if (key === "constructor") continue;
    plugin[key] = MixinClass.prototype[key].bind(plugin);
  }
  return plugin;
}

function fakePlugin(reports) {
  const plugin = {
    app: { workspace: { getLeavesOfType: () => [] } },
    albumVaultGeneration: 0,
    undos: new Map(),
    overlays: new Map(),
    calls: [],
    async apiIntentionUpdatePreview(subject, envelopeText) {
      plugin.calls.push({ preview: true, envelopeText });
      const next = reports.preview.shift();
      if (typeof next === "function") return next(subject, envelopeText);
      return next;
    },
    async apiIntentionUpdateApply(subject, envelopeText) {
      plugin.calls.push({ apply: true, envelopeText });
      const next = reports.apply.shift();
      if (typeof next === "function") return next(subject, envelopeText);
      return next;
    },
    intentionUpdateRememberUndo(path, inverseOps, afterFingerprint) {
      plugin.undos.set(path, { inverseOps, afterFingerprint });
    },
    intentionUpdateLastUndo(path) { return plugin.undos.get(path) || null; },
    intentionCardPushOverlay(path, overlay) {
      if (overlay) plugin.overlays.set(path, overlay);
      else plugin.overlays.delete(path);
      return overlay;
    },
  };
  return plugin;
}

function readReport(after, fingerprint = "sha256:aaa") {
  return { ok: true, report: updateReport({ after, fingerprint_before: fingerprint, inverse_ops: [] }) };
}

test("modal preview/apply round trip retains drafts on stale refusal", async () => {
  const plugin = fakePlugin({
    preview: [
      readReport({ intentions: ["One"] }),
      { ok: true, report: { ok: false, schema_version: 1, error: { code: "stale_note", message: "changed", hint: "retry" } } },
      readReport({ intentions: ["One"] }, "sha256:fresh"),
    ],
    apply: [],
  });
  const modal = new H.IntentionCardModal({ document: null }, {
    plugin, subject: "2026-11-19", subjectPath: "2026/20261119.md", state: "open",
    fields: { intentions: ["One"], summary: "", summaryState: "", summaryDrafted: "", reflection: "" },
    fingerprint: "", writable: true,
  });
  await modal.intentionInitialRead();
  assert.equal(modal.fields.intentions[0], "One");
  assert.equal(modal.fingerprint, "sha256:aaa");

  modal.intentionOpenStage("intention", "intention:0");
  modal.stageDraft = "One edited";
  const stale = await modal.intentionSaveStage();
  assert.equal(stale.ok, false);
  assert.equal(modal.statusKind, "stale");
  assert.equal(modal.selectedKey, "intention:0");
  assert.equal(modal.stageDraft, "One edited");
  assert.equal(modal.stage.index, 0, "the stage stays on its target with the exact draft");
  assert.equal(modal.fingerprint, "sha256:fresh");
  assert.match(modal.stageNote, /Enter saves your draft as Intention 1/);
  modal.close();
});

test("superseded async replies after close never land", async () => {
  let release = null;
  const plugin = fakePlugin({
    preview: [new Promise((resolve) => { release = () => resolve(readReport({ intentions: ["Late"] })); })],
    apply: [],
  });
  const modal = new H.IntentionCardModal({ document: null }, {
    plugin, subject: "2026-11-19", subjectPath: "2026/20261119.md", state: "open",
    fields: { intentions: ["Early"], summary: "", summaryState: "", summaryDrafted: "", reflection: "" },
    fingerprint: "", writable: true,
  });
  const flight = modal.intentionInitialRead();
  modal.close();
  release();
  await flight;
  assert.equal(modal.fields.intentions[0], "Early");
  assert.equal(modal.closed, true);
});

test("old-bob degradation keeps the card readable with native recovery", async () => {
  const plugin = fakePlugin({
    preview: [{ ok: false, code: "needs-update", message: "no update", hint: "Update bob to edit intentions." }],
    apply: [],
  });
  const modal = new H.IntentionCardModal({ document: null }, {
    plugin, subject: "2026-11-19", subjectPath: "2026/20261119.md", state: "open",
    fields: { intentions: ["One"], summary: "", summaryState: "", summaryDrafted: "", reflection: "" },
    fingerprint: "", writable: true,
  });
  await modal.intentionInitialRead();
  assert.equal(modal.statusKind, "needs-update");
  assert.equal(modal.writable, false);
  assert.match(modal.refusalMessage, /Update bob/);
  modal.close();
});

test("overlay settles on matching metadata and expires on a bound", () => {
  const timers = new Map();
  let next = 1;
  const plugin = installMixin(new TestPlugin({}), H.BobLedgerToolsIntentionCardEditorMixin);
  plugin.albumSetTimeout = (fn, ms) => { const id = next++; timers.set(id, { fn, ms }); return id; };
  plugin.albumClearTimeout = (id) => { timers.delete(id); };
  plugin.intentionCardOverlays = new Map();
  plugin.intentionCardOverlayTimersMap = new Map();
  const overlay = { fields: { intentions: ["Ship it"] }, fingerprint: "sha256:bbb", changed: true };
  plugin.intentionCardPushOverlay("2026/20261119.md", overlay, { ttlMs: 50 });
  assert.equal(plugin.intentionCardOverlays.get("2026/20261119.md"), overlay);
  assert.equal(plugin.intentionCardSettleOverlay("2026/20261119.md", { intentions: ["Ship it"] }), "settled");
  assert.equal(plugin.intentionCardOverlays.has("2026/20261119.md"), false);

  plugin.intentionCardPushOverlay("2026/20261119.md", { ...overlay, priors: [H.intentionOverlayComparable({ intentions: ["Before"] })] }, { ttlMs: 50 });
  assert.equal(plugin.intentionCardSettleOverlay("2026/20261119.md", { intentions: ["Before"] }), "pending");
  assert.equal(plugin.intentionCardOverlays.has("2026/20261119.md"), true, "still-prior metadata keeps the overlay");
  assert.equal(plugin.intentionCardSettleOverlay("2026/20261119.md", { intentions: ["Other"] }), "discarded");
  assert.equal(plugin.intentionCardOverlays.has("2026/20261119.md"), false);

  plugin.intentionCardPushOverlay("2026/20261119.md", overlay, { ttlMs: 50 });
  assert.equal(timers.size, 1);
  for (const task of timers.values()) task.fn();
  assert.equal(plugin.intentionCardOverlays.has("2026/20261119.md"), false);
});

test("registry matches canonical subjects and refuses non-intention notes", () => {
  const plugin = installMixin(new TestPlugin({}), H.BobLedgerToolsIntentionCardEditorMixin);
  plugin.intentionCardEditorToday = () => "2026-11-19";
  assert.equal(plugin.intentionCardEditorMatch({ path: "2026/20261119.md" }), true);
  assert.equal(plugin.intentionCardEditorMatch({ path: "2026/2026-W46.md" }), true);
  assert.equal(plugin.intentionCardEditorMatch({ path: "all_time.md" }), false);
  assert.equal(plugin.intentionCardEditorMatch({ path: "notes/random.md" }), false);
  assert.equal(plugin.intentionCardEditorMatch({ path: "" }), false);
});

// Real-bob checks run only against an explicit current binary (the shared
// convention for real-writer tests): auto-discovered `target/debug/bob`
// builds can predate `periods update` and fail instead of skipping.
function resolveBobBin() {
  return process.env.BOB_BIN && fs.existsSync(process.env.BOB_BIN) ? process.env.BOB_BIN : "";
}

const BOB_BIN = resolveBobBin();

test("real writer round trip: preview, apply, Undo, body survival", { skip: !BOB_BIN && "no bob binary (set BOB_BIN)" }, () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "bob-intentions-"));
  const notePath = path.join(vault, "2026", "20261119.md");
  fs.mkdirSync(path.dirname(notePath), { recursive: true });
  const body = "# Thu Nov 19, 2026\n\nUnrelated body stays put.\n";
  fs.writeFileSync(notePath, `---\nintentions:\n  - "Ship it"\n---\n\n${body}`);
  const run = (args, stdin) => spawnSync(BOB_BIN, args, {
    input: stdin, encoding: "utf8", env: { ...process.env, BOB_DIR: vault },
  });

  const read = run(["periods", "update", "2026-11-19", "-i", "-", "-f", "json", "-n"], JSON.stringify({ schema_version: 1, ops: [] }));
  assert.equal(read.status, 0, read.stderr);
  const preview = JSON.parse(read.stdout);
  assert.equal(preview.ok, true);
  assert.match(preview.fingerprint_before, /^sha256:/);
  const expect = preview.fingerprint_before;

  const apply = run(["periods", "update", "2026-11-19", "-i", "-", "-f", "json"],
    JSON.stringify({ schema_version: 1, expect, ops: [{ op: "intentions.insert", index: 1, value: "Second [[2026/2026-W46]]" }] }));
  assert.equal(apply.status, 0, apply.stderr);
  const applied = JSON.parse(apply.stdout);
  assert.equal(applied.ok, true);
  assert.equal(applied.changed, true);
  assert.ok(Array.isArray(applied.inverse_ops) && applied.inverse_ops.length > 0);
  const bytes = fs.readFileSync(notePath, "utf8");
  assert.match(bytes, /Unrelated body stays put/);
  assert.match(bytes, /Second/);

  // Body-only edits survive a guarded field write: append body, then apply
  // another field op against the fresh fingerprint and confirm both persist.
  fs.writeFileSync(notePath, bytes + "\nMore body.\n");
  const reread = run(["periods", "update", "2026-11-19", "-i", "-", "-f", "json", "-n"], JSON.stringify({ schema_version: 1, ops: [] }));
  const fresh = JSON.parse(reread.stdout);
  const apply2 = run(["periods", "update", "2026-11-19", "-i", "-", "-f", "json"],
    JSON.stringify({ schema_version: 1, expect: fresh.fingerprint_before, ops: [{ op: "reflection.set", value: "Tired." }] }));
  assert.equal(apply2.status, 0, apply2.stderr);
  const bytes2 = fs.readFileSync(notePath, "utf8");
  assert.match(bytes2, /More body/);
  assert.match(bytes2, /Tired/);

  // Undo restores the earlier state through the opaque inverse ops.
  const undo = run(["periods", "update", "2026-11-19", "-i", "-", "-f", "json"],
    JSON.stringify({ schema_version: 1, expect: JSON.parse(apply2.stdout).fingerprint_after, ops: JSON.parse(apply2.stdout).inverse_ops }));
  assert.equal(undo.status, 0, undo.stderr);
  assert.match(fs.readFileSync(notePath, "utf8"), /More body/);

  // all_time owns no intention fields.
  const refused = run(["periods", "update", "all_time", "-i", "-", "-f", "json", "-n"], JSON.stringify({ schema_version: 1, ops: [] }));
  assert.notEqual(refused.status, 0);

  fs.rmSync(vault, { recursive: true, force: true });
});
