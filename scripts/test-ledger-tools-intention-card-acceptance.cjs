// Intention card fixes found by the real-Obsidian acceptance runner: Live
// Preview inline anchoring, Reading section anchoring and render re-entry,
// stage focus and caret, one-line paste, stale refresh, malformed-frontmatter
// warnings, generation-only retries, path-scoped Undo, and the status line.
const assert = require("node:assert/strict");
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
    return { EditorView: { updateListener: { of: (listener) => ({ listener }) } }, keymap: { of: (value) => value } };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const H = LedgerToolsPlugin.helpers;
Module._load = originalLoad;

function installMixin(plugin, MixinClass) {
  for (const key of Object.getOwnPropertyNames(MixinClass.prototype)) {
    if (key !== "constructor") plugin[key] = MixinClass.prototype[key].bind(plugin);
  }
  return plugin;
}

function report(after, overrides = {}) {
  return {
    ok: true, schema_version: 1,
    subject: { id: "2026-11-19", kind: "day", label: "Thu Nov 19, 2026", path: "2026/20261119.md" },
    dry_run: true, fingerprint_before: "sha256:aaa", fingerprint_after: "sha256:aaa",
    before: after, after, changed: false, inverse_ops: [], warnings: [], ...overrides,
  };
}

function modalWith(plugin, fields = { intentions: ["One"], summary: "", summaryState: "", summaryDrafted: "", reflection: "" }) {
  return new H.IntentionCardModal({ document: null }, {
    plugin, subject: "2026-11-19", subjectPath: "2026/20261119.md", state: "open", fields, fingerprint: "", writable: true,
  });
}

// A focusable input or row with selection state, enough for focus helpers.
function fakeInput(doc, attrs, value = "") {
  return {
    value, selectionStart: value.length, selectionEnd: value.length,
    getAttribute: (name) => attrs[name] ?? null, hasAttribute: (name) => name in attrs,
    focus() { doc.activeElement = this; },
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
  };
}

test("Live Preview anchors the card at the end of the line before the first unrelated block", () => {
  const plugin = installMixin({ intentionCardToday: () => "2026-11-19" }, H.BobLedgerToolsIntentionCardMixin);
  plugin.intentionCardToday = () => "2026-11-19";
  const text = "---\nintentions:\n  - \"A\"\n---\n\n# 2026-11-19 Thu\n\n[[2026/20261118|prev]] · [[2026/2026-W47|W47]] · [[2026/20261120|next]]\n\n- [ ] task ^gtd\n";
  const subject = H.intentionCardSubjectForPath("2026/20261119.md", "2026-11-19");
  const anchor = plugin.intentionCardLiveAnchor(text, subject);
  const lines = text.split("\n");
  assert.equal(lines[anchor.lineIndex], "", "anchor is the blank line after the navigation line");
  assert.equal(anchor.lineIndex, anchor.placement.insertBeforeLine - 1);
  assert.equal(text.slice(anchor.offset, anchor.offset + 1), "\n");
  assert.ok(text.slice(anchor.offset).startsWith("\n- [ ] task"), "the next line is the ^gtd task");
});

test("Reading anchor walks section wrappers so the card follows the H1 and navigation sections", () => {
  const today = "2026-11-19";
  const subject = H.intentionCardSubjectForPath("2026/20261119.md", today);
  const link = (target, text) => ({ textContent: text, getAttribute: (name) => name === "data-href" ? target : null });
  const navLinks = [link("2026/20261118", "prev"), link("2026/2026-W47", "W47"), link("2026/20261120", "next")];
  const root = { contains: () => true };
  const navSection = { parentElement: root, textContent: "prev · W47 · next", querySelectorAll: () => navLinks };
  const gtdSection = { parentElement: root, textContent: "task", querySelectorAll: () => [] };
  const h1Section = { parentElement: root, nextElementSibling: navSection };
  navSection.nextElementSibling = gtdSection;
  gtdSection.nextElementSibling = null;
  const heading = { parentElement: h1Section, nextElementSibling: null, closest: () => null };
  root.querySelectorAll = (selector) => (selector === "h1" ? [heading] : []);
  assert.equal(H.intentionCardDomAnchor(root, subject, today), navSection);
});

test("the card's own Markdown containers never become Reading mounts", () => {
  const plugin = installMixin({ intentionCardActive: true }, H.BobLedgerToolsIntentionCardMixin);
  plugin.intentionCardActive = true;
  plugin.intentionCardToday = () => "2026-11-19";
  const rendered = { closest: (selector) => (selector.includes(`[${H.INTENTION_CARD_RENDER_ATTR}]`) ? {} : null) };
  const section = { closest: () => null };
  assert.equal(plugin.intentionCardCanDisplay("2026/20261119.md", rendered), false);
  assert.equal(plugin.intentionCardCanDisplay("2026/20261119.md", section), true);
  const card = { bobIntentionRender: { unload() {} } };
  H.intentionCardDomRelease(card);
  assert.equal(card.bobIntentionRender, null);
  assert.ok(H.INTENTION_CARD_READING_RETRIES > 0);
});

test("an opened stage owns focus with the caret at the end; a repaint keeps the caret", () => {
  const doc = { activeElement: null };
  const input = fakeInput(doc, { "data-intention-input": "intention" }, "Ship it");
  const row = fakeInput(doc, { "data-intention-key": "intention:0" });
  const card = { querySelector: (selector) => (selector.includes("data-intention-input") ? input : row) };
  const modal = { stage: { kind: "intention" }, selectedKey: "intention:0", contentEl: { querySelector: () => card } };
  assert.equal(H.intentionCardEditorFocus(modal), true);
  assert.equal(doc.activeElement, input);
  assert.deepEqual([input.selectionStart, input.selectionEnd], [7, 7]);
  input.setSelectionRange(2, 4);
  const caret = H.intentionCardEditorCaptureCaret({ contentEl: { querySelector: () => input } }, doc);
  input.setSelectionRange(7, 7);
  H.intentionCardEditorFocus(modal, caret);
  assert.deepEqual([input.selectionStart, input.selectionEnd], [2, 4]);
  modal.stage = null;
  H.intentionCardEditorFocus(modal);
  assert.equal(doc.activeElement, row, "browse mode focuses the selected row, never an input");
});

test("pasted line breaks collapse to spaces in the intention input with a quiet note", () => {
  const doc = { activeElement: null };
  const input = fakeInput(doc, { "data-intention-input": "intention" }, "Read ");
  let prevented = false;
  let painted = 0;
  const modal = { stage: { kind: "intention" }, stageDraft: "Read ", stageNote: "", paintIntentionCard: () => { painted += 1; } };
  const event = { target: input, clipboardData: { getData: () => "one chapter\nslowly" }, preventDefault: () => { prevented = true; } };
  assert.equal(H.intentionCardEditorPaste(modal, event), true);
  assert.ok(prevented);
  assert.equal(input.value, "Read one chapter slowly");
  assert.equal(modal.stageDraft, "Read one chapter slowly");
  assert.equal(modal.stageNote, H.INTENTION_CARD_EDITOR_PASTE_NOTE);
  assert.equal(painted, 1);
  const plain = { target: input, clipboardData: { getData: () => "plain" }, preventDefault: () => assert.fail("plain paste stays native") };
  assert.equal(H.intentionCardEditorPaste(modal, plain), false);
  modal.stage = { kind: "reflection" };
  assert.equal(H.intentionCardEditorPaste(modal, event), false, "reflection pastes natively");
});

test("a stale refusal refreshes the fingerprint and list while keeping the exact draft", async () => {
  const plugin = {
    app: { workspace: { getLeavesOfType: () => [] } },
    calls: 0,
    async apiIntentionUpdatePreview(_subject, text) {
      plugin.calls += 1;
      if (plugin.calls === 1) return { ok: true, report: report({ intentions: ["One"] }) };
      if (JSON.parse(text).ops.length) return { ok: true, report: { ok: false, schema_version: 1, error: { code: "stale_note", message: "changed" } } };
      return { ok: true, report: report({ intentions: ["One (edited elsewhere)", "Two"], summary_state: "empty" }, { fingerprint_before: "sha256:fresh" }) };
    },
    async apiIntentionUpdateApply() { return { ok: false, code: "failed" }; },
    intentionUpdateLastUndo: () => null,
  };
  const modal = modalWith(plugin);
  await modal.intentionInitialRead();
  modal.intentionOpenStage("intention", "intention:0");
  modal.stageDraft = "Held draft";
  await modal.intentionSaveStage();
  assert.equal(modal.statusKind, "stale");
  assert.equal(modal.fingerprint, "sha256:fresh");
  assert.deepEqual(modal.fields.intentions, ["One (edited elsewhere)", "Two"]);
  assert.equal(modal.stageDraft, "Held draft");
  assert.equal(modal.stage.kind, "intention");
  assert.equal(modal.selectedKey, "intention:0");
  assert.match(modal.stageNote, /Intention 1 now reads “One \(edited elsewhere\)” — Enter replaces it with your draft/);
  modal.close();
});

test("malformed frontmatter warnings refuse editing; the soft cap stays advisory", async () => {
  const warning = { code: "frontmatter_invalid", message: "invalid frontmatter YAML" };
  assert.equal(H.intentionCardEditorBlockingWarning(report({}, { warnings: [warning] })), warning);
  assert.equal(H.intentionCardEditorBlockingWarning(report({}, { warnings: [{ code: "intentions_type", message: "x" }] })).code, "intentions_type");
  assert.equal(H.intentionCardEditorBlockingWarning(report({}, { warnings: [{ code: "intentions_over_soft_cap", message: "x" }] })), null);
  const plugin = {
    async apiIntentionUpdatePreview() { return { ok: true, report: report({ intentions: [] }, { warnings: [warning] }) }; },
    intentionUpdateLastUndo: () => null,
  };
  const modal = modalWith(plugin);
  await modal.intentionInitialRead();
  assert.equal(modal.malformed, true);
  assert.equal(modal.writable, false);
  assert.equal(modal.statusKind, "refusal");
  assert.match(modal.refusalMessage, /invalid frontmatter/);
  assert.equal(modal.intentionOpenStage("intention", "intention:0"), false, "no stage opens on a refused subject");
  modal.close();
});

test("generation-only refusals re-preview and apply; stale_note never retries", async () => {
  assert.equal(H.intentionCardEditorGenerationOnly({ ok: false, code: "save-invalidated" }), true);
  assert.equal(H.intentionCardEditorGenerationOnly({ ok: false, code: "stale_generation", kind: "stale" }), true);
  assert.equal(H.intentionCardEditorGenerationOnly({ ok: false, code: "stale_note" }), false);
  const ok = { ok: true, report: { ok: true } };
  const calls = [];
  const session = {
    previewNow: async () => { calls.push("preview"); return ok; },
    apply: async () => { calls.push("apply"); return calls.filter((c) => c === "apply").length === 1 ? { ok: false, code: "save-invalidated" } : { ok: true, changed: true }; },
  };
  const result = await H.intentionCardEditorPreviewApply(session, () => true);
  assert.deepEqual(calls, ["preview", "apply", "preview", "apply"]);
  assert.equal(result.applied.ok, true);
  const stale = { previewNow: async () => ({ ok: false, code: "stale_note" }), apply: async () => assert.fail("no apply after a refused preview") };
  assert.equal((await H.intentionCardEditorPreviewApply(stale, () => true)).applied, undefined);
  assert.deepEqual(await H.intentionCardEditorPreviewApply(session, () => false), { superseded: true });
});

test("a reopened editor seeds Undo from the path-scoped record", () => {
  const record = { inverseOps: [{ op: "summary.restore" }], afterFingerprint: "sha256:after" };
  const modal = modalWith({ intentionUpdateLastUndo: (path) => (path === "2026/20261119.md" ? record : null) });
  const session = modal.ensureIntentionSession();
  assert.equal(session.stageUndo().ok, true);
  assert.deepEqual(session.getState().draftOps, [{ op: "summary.restore" }]);
  modal.close();
});

test("missing and needs-update subjects open no stage; the status line never shows a raw state", () => {
  const modal = modalWith({ intentionUpdateLastUndo: () => null });
  modal.writable = false;
  assert.equal(modal.intentionOpenStage("reflection", "reflection"), false);
  modal.intentionHandleAction("insert-below");
  assert.equal(modal.stage, null);
  assert.match(H.intentionCardEditorStatusFallback({ statusKind: "browsing", writable: true }), /Enter edit/);
  assert.match(H.intentionCardEditorStatusFallback({ statusKind: "missing", writable: false }), /Read-only/);
  assert.equal(H.intentionCardEditorStatusFallback({ statusKind: "reading" }), "Reading intentions…");
  assert.equal(H.intentionCardEditorStatusFallback({ statusKind: "browsing", writable: true, stage: { kind: "intention" } }), "");
  modal.close();
});
