// Intention card editor DOM: the summary shown read-only above Reflection,
// the auto-growing reflection textarea (entry, input, paste, repaint) with a
// stable caret, Enter/Shift+Enter/Ctrl+Enter, and the shared arrange
// animation for Alt+J/K with stable row identities, kept selection, reduced
// motion, and no animation for a refused write.
const assert = require("node:assert/strict");
const test = require("node:test");
const { loadLedgerTools, flush, fakeVault, installBobSimulator, simulatorDigest } = require("./intention-card-test-helpers.cjs");

const LedgerToolsPlugin = loadLedgerTools();
const H = LedgerToolsPlugin.helpers;
const DAY = "2026/20261119.md";

function setup(fields, options = {}) {
  const vault = fakeVault();
  vault.seed(DAY, fields);
  const plugin = new LedgerToolsPlugin(vault.app);
  plugin.albumSetTimeout = () => 0;
  plugin.albumClearTimeout = () => {};
  plugin.intentionCardEditorToday = () => "2026-11-19";
  plugin.setupIntentionUpdate();
  plugin.setupIntentionCardEditor();
  const calls = installBobSimulator(plugin, vault, { "2026-11-19": DAY }, options);
  const read = plugin.intentionCardEditorReadFields(DAY);
  const modal = new H.IntentionCardModal(vault.app, {
    plugin, subject: "2026-11-19", subjectPath: DAY, state: "open", fields: read.ok ? read.fields : null,
  });
  modal.open();
  return { vault, plugin, modal, calls, doc: vault.app.document };
}

const card = (modal) => modal.contentEl.querySelector(".bob-intention-card-editor");
const stageEl = (modal) => card(modal).querySelector(".bob-intention-editor-stage");
const input = (modal) => card(modal).querySelector("[data-intention-input]");
const rows = (modal) => card(modal).querySelectorAll(".bob-intention-row");
const key = (name, target, extra = {}) => ({ key: name, target, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra });

test("Reflection shows the current summary read-only above an auto-growing textarea", async () => {
  const summary = "Shipped the card; the rest waits.";
  const { modal, doc } = setup({ intentions: ["One"], summary, summary_digest: simulatorDigest(summary), summary_drafted: "2026-11-18" });
  await flush();
  modal.intentionOnKeyDown(key("r", null));
  const stage = stageEl(modal);
  assert.equal(stage.getAttribute("data-intention-stage"), "reflection");
  const order = stage.children.map((node) => node.className);
  const context = stage.querySelector("[data-intention-context]");
  assert.ok(context, "the summary context renders for Reflection");
  assert.ok(order.indexOf(context.className) < order.indexOf("bob-intention-stage-input is-reflection"), "context sits above the textarea");
  assert.match(context.textContent, /Summary · ✦ agent · Nov 18/);
  assert.match(context.textContent, /Shipped the card/);
  assert.equal(input(modal).tagName, "TEXTAREA");
  assert.equal(doc.activeElement, input(modal), "the stage owns focus");

  // Entry: the empty textarea gets its floor height.
  assert.equal(input(modal).style.height, "64px");
  // Input: grows with content; the caret is not moved.
  const area = input(modal);
  area.value = "Line one\nLine two\nLine three\nLine four";
  area.setSelectionRange(5, 5);
  card(modal).listeners.get("input")[0]({ target: area });
  assert.equal(area.style.height, `${4 * 20 + 8 + 2}px`);
  assert.deepEqual([area.selectionStart, area.selectionEnd], [5, 5]);
  assert.equal(modal.stageDraft, area.value);
  // Paste in Reflection stays native; the input event that follows grows it.
  const paste = { target: area, clipboardData: { getData: () => "pasted\nmore" }, preventDefault: () => assert.fail("reflection paste is native") };
  assert.equal(H.intentionCardEditorPaste(modal, paste), false);
  area.value += "\npasted\nmore";
  card(modal).listeners.get("input")[0]({ target: area });
  assert.equal(area.style.height, `${6 * 20 + 8 + 2}px`);
  // Repaint: the rebuilt textarea keeps the draft, height, and caret.
  area.setSelectionRange(9, 12);
  modal.paintIntentionCard();
  assert.notEqual(input(modal), area, "repaint rebuilt the textarea");
  assert.equal(input(modal).value, area.value);
  assert.equal(input(modal).style.height, `${6 * 20 + 8 + 2}px`);
  assert.deepEqual([input(modal).selectionStart, input(modal).selectionEnd], [9, 12]);

  // Shift+Enter is a newline; Enter saves; the summary still says the same.
  modal.intentionOnKeyDown(key("Enter", input(modal), { shiftKey: true }));
  assert.ok(modal.stage, "Shift+Enter keeps the stage open");
  modal.intentionOnKeyDown(key("Enter", input(modal)));
  await flush();
  assert.equal(modal.stage, null);
  assert.match(modal.fields.reflection, /Line four/);
  modal.close();
});

test("an empty summary shows a quiet placeholder above Reflection; Ctrl+Enter saves and closes", async () => {
  const { modal } = setup({ intentions: ["One"] });
  await flush();
  modal.intentionHandleAction("open-reflection");
  const context = stageEl(modal).querySelector("[data-intention-context]");
  assert.match(context.textContent, /No summary yet\./);
  input(modal).value = "Short.";
  card(modal).listeners.get("input")[0]({ target: input(modal) });
  modal.intentionOnKeyDown(key("Enter", input(modal), { ctrlKey: true }));
  await flush();
  assert.equal(modal.closed, true);
});

test("Alt+J plays the shared arrange animation on stable rows and keeps the selection", async () => {
  const frames = [];
  const savedRaf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (callback) => { frames.push(callback); return frames.length; };
  try {
    const { modal, vault } = setup({ intentions: ["Alpha", "Beta", "Gamma"] });
    await flush();
    const before = rows(modal).map((row) => row.getAttribute("data-arrange-id"));
    assert.deepEqual(before.slice(0, 3), ["intention:1:Alpha", "intention:1:Beta", "intention:1:Gamma"]);
    modal.intentionOnKeyDown(key("j", null, { altKey: true }));
    await flush();
    assert.deepEqual(vault.fields.get(DAY).intentions, ["Beta", "Alpha", "Gamma"]);
    const after = rows(modal);
    assert.deepEqual(after.slice(0, 3).map((row) => row.getAttribute("data-arrange-id")), ["intention:1:Beta", "intention:1:Alpha", "intention:1:Gamma"]);
    assert.equal(modal.selectedKey, "intention:1", "selection follows Alpha");
    assert.equal(after[1].getAttribute("aria-current"), "true");
    assert.ok(modal.lastArrangePlan && Object.keys(modal.lastArrangePlan).length >= 2, "both swapped rows animate");
    assert.match(after[1].style.transform, /translate\(0px, -30px\)/, "Alpha starts from its old slot");
    assert.match(after[0].style.transform, /translate\(0px, 30px\)/, "Beta starts from its old slot");
    assert.equal(after[2].style.transform || "", "", "unmoved rows stay put");
  } finally {
    globalThis.requestAnimationFrame = savedRaf;
  }
});

test("reduced motion skips the animation; a refused move never animates as success", async () => {
  const savedMatch = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: true });
  try {
    const { modal } = setup({ intentions: ["Alpha", "Beta"] });
    await flush();
    modal.intentionOnKeyDown(key("j", null, { altKey: true }));
    await flush();
    assert.deepEqual(modal.fields.intentions, ["Beta", "Alpha"]);
    assert.deepEqual(modal.lastArrangePlan, {});
    assert.ok(rows(modal).every((row) => !row.style.transform));
  } finally {
    globalThis.matchMedia = savedMatch;
  }
  const { modal, vault } = setup({ intentions: ["Alpha", "Beta"] }, {
    beforeApply: async () => ({ ok: true, report: { ok: false, schema_version: 1, error: { code: "lock_busy_budget", message: "vault maintenance held the lock", hint: "" } } }),
  });
  await flush();
  modal.intentionOnKeyDown(key("j", null, { altKey: true }));
  await flush();
  assert.deepEqual(vault.fields.get(DAY).intentions, ["Alpha", "Beta"]);
  assert.equal(modal.lastArrangePlan, undefined, "no arrange plan ran");
  assert.ok(rows(modal).every((row) => !row.style.transform));
  assert.equal(modal.statusKind, "refusal");
  assert.equal(modal.selectedKey, "intention:0", "a refused move keeps the selection where it was");
});

test("the summary row shows its provenance in words", async () => {
  const summary = "Agent text.";
  const { modal } = setup({ intentions: ["One"], summary, summary_digest: simulatorDigest(summary), summary_drafted: "2026-11-18" });
  await flush();
  const row = card(modal).querySelector('[data-intention-key="summary"]');
  assert.match(row.textContent, /Summary ✦ agent · Nov 18 — Agent text\./);
  assert.equal(H.intentionCardEditorProvenance("edited", ""), "✎ edited");
});
