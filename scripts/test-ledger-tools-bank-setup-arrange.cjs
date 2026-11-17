const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin {
  constructor(app) { this.app = app; }
  addCommand(command) { (this.commands ||= []).push(command); }
  registerEditorExtension() {}
  registerMarkdownPostProcessor() {}
  registerEvent() {}
  registerInterval(handle) { return handle; }
  registerDomEvent() { return { unregister: () => {} }; }
}
class TestNotice { constructor(message) { TestNotice.messages.push(String(message)); } }
TestNotice.messages = [];

const editorInfoField = { info: true };
const editorLivePreviewField = { live: true };
const StateEffect = { define: () => ({ of(value) { return { effect: this, value }; }, is(other) { return this === other; } }) };
class WidgetType {}
class RangeSetBuilder { constructor() { this.rows = []; } add(from, to, deco) { this.rows.push({ from, to, deco }); } finish() { return this.rows; } }
const Decoration = { none: [], widget: (options) => ({ widget: options.widget, side: options.side }) };
const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownRenderChild: class { constructor(el) { this.containerEl = el; } },
    Notice: TestNotice, Plugin: TestPlugin, Platform: { isDesktopApp: true, isMacOS: false },
    MarkdownView: class MarkdownView {},
    normalizePath: (value) => value, parseYaml: (text) => JSON.parse(text),
    editorInfoField, editorLivePreviewField,
  };
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value }, StateEffect, RangeSetBuilder };
  if (request === "@codemirror/view") return {
    Decoration, WidgetType, ViewPlugin: { fromClass: (cls, options) => ({ cls, options }) }, EditorView: {},
  };
  if (request === "@codemirror/language") return {};
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const H = LedgerToolsPlugin.helpers;
Module._load = originalLoad;

class FakeNode {
  constructor(tag, doc, text = "") {
    this.tagName = tag ? tag.toUpperCase() : "#TEXT";
    this.nodeType = tag ? 1 : 3;
    this.ownerDocument = doc;
    this.parentNode = null;
    this.children = [];
    this.attrs = new Map();
    this.listeners = new Map();
    this._text = text;
    this.disabled = false;
    const self = this;
    this.classList = {
      add(name) { const xs = new Set((self.getAttribute("class") || "").split(/\s+/).filter(Boolean)); xs.add(name); self.setAttribute("class", [...xs].join(" ")); },
      remove(name) { const xs = (self.getAttribute("class") || "").split(/\s+/).filter((x) => x && x !== name); self.setAttribute("class", xs.join(" ")); },
      contains(name) { return (self.getAttribute("class") || "").split(/\s+/).includes(name); },
      toggle(name, force) {
        if (force === true) this.add(name);
        else if (force === false) this.remove(name);
        else if (this.contains(name)) this.remove(name);
        else this.add(name);
      },
    };
  }
  get className() { return this.getAttribute("class") || ""; }
  set className(value) { this.attrs.set("class", String(value)); }
  get textContent() { return this.nodeType === 3 ? this._text : this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { this._text = String(value); if (this.nodeType === 1) this.children = value ? [new FakeNode("", this.ownerDocument, this._text)] : []; }
  get firstChild() { return this.children[0] || null; }
  get childNodes() { return this.children; }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  removeAttribute(name) { this.attrs.delete(name); }
  appendChild(node) { node.parentNode?.removeChild?.(node); node.parentNode = this; this.children.push(node); return node; }
  removeChild(node) { const i = this.children.indexOf(node); if (i >= 0) this.children.splice(i, 1); node.parentNode = null; return node; }
  empty() { while (this.firstChild) this.removeChild(this.firstChild); }
  addEventListener(type, fn) { const rows = this.listeners.get(type) || []; rows.push(fn); this.listeners.set(type, rows); }
  removeEventListener(type, fn) {
    const rows = (this.listeners.get(type) || []).filter((entry) => entry !== fn);
    this.listeners.set(type, rows);
  }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  focus() { if (!this.disabled) this.ownerDocument.activeElement = this; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 10, height: 10 }; }
  matches(selector) {
    return String(selector).split(",").some((part) => {
      const value = part.trim();
      const cls = /^\.([\w-]+)$/.exec(value);
      const tag = /^[a-z][\w-]*$/i.exec(value);
      const attr = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(value);
      const taggedAttr = /^([a-z][\w-]*)\[([\w-]+)(?:="([^"]*)")?\]$/i.exec(value);
      const hasAttr = (name, expected) => this.attrs.has(name) && (expected === undefined || this.getAttribute(name) === expected);
      return Boolean((cls && this.classList.contains(cls[1])) || (tag && this.tagName === tag[0].toUpperCase()) ||
        (attr && hasAttr(attr[1], attr[2])) ||
        (taggedAttr && this.tagName === taggedAttr[1].toUpperCase() && hasAttr(taggedAttr[2], taggedAttr[3])));
    });
  }
  closest(selector) { let node = this; while (node) { if (node.nodeType === 1 && node.matches(selector)) return node; node = node.parentNode; } return null; }
  querySelectorAll(selector) { const found = []; const walk = (node) => { for (const child of node.children || []) { if (child.matches(selector)) found.push(child); walk(child); } }; walk(this); return found; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function makeDoc() {
  return {
    activeElement: null,
    createElement(tag) { return new FakeNode(tag, this); },
    createTextNode(text) { return new FakeNode("", this, String(text)); },
  };
}

function configCategory(overrides = {}) {
  return {
    key: "coffee", emoji: "☕", label: "Coffee", builtin: false, declared: true,
    hotkey: "c", hotkey_source: "explicit", group: "Everyday", hidden: false,
    line: 13, source_line: 13, rows: 5, rule_refs: 0, ...overrides,
  };
}

function configReport(overrides = {}) {
  return {
    schema_version: 1, ok: true, state: "valid", teaching_empty: false, partial: false,
    today: "2026-11-15", path: "bank.md", line: 6, fingerprint: "sha256:abc",
    accounts: [{ alias: "checking", label: "WF Checking", kind: "checking", default: true, start: "2026-11-11", rows: 11, status: "balanced" }],
    categories: [
      configCategory(),
      configCategory({ key: "groceries", emoji: "🛒", label: "Groceries", hotkey: "g", line: 14, source_line: 14, rows: 2 }),
      configCategory({ key: "income", emoji: "💵", label: "Income", builtin: true, declared: false, hotkey: "i", hotkey_source: "builtin_default", group: "Money moves", line: null, rows: 1 }),
      configCategory({ key: "kids", emoji: "🧸", label: "Kids", hotkey: null, hotkey_source: "none", hidden: true, line: 20, rows: 3 }),
    ],
    free_hotkeys: ["b", "j"],
    rules: [
      { index: 0, match: "VENMO", payee: "Venmo", cat: "groceries", link: null, line: 30, source_line: 30 },
      { index: 1, match: "ACME", payee: null, cat: "coffee", link: null, line: 31, source_line: 31 },
    ],
    stale_after: { days: 10, explicit: false, line: null },
    findings: [], issues: { errors: 0, warnings: 0 }, starter: null, ...overrides,
  };
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function openCard(report = configReport()) {
  const doc = makeDoc();
  const app = {
    document: doc,
    vault: { getAbstractFileByPath: () => null },
    metadataCache: { getFileCache: () => null, getFirstLinkpathDest: () => null },
    workspace: { getLeavesOfType: () => [] },
  };
  const plugin = new LedgerToolsPlugin(app);
  plugin.bankSetupCardActive = true;
  plugin.bankVaultGeneration = 1;
  plugin.apiBankRefresh = async () => ({ report, stale: false, error: null, generation: 1 });
  plugin.apiBankConfigUpdatePreview = async (envelopeText) => {
    const parsed = JSON.parse(envelopeText);
    const ops = parsed.ops || [];
    const groups = [];
    for (const row of report.categories) {
      if (row.hidden === true || !row.group || groups.includes(row.group)) continue;
      groups.push(row.group);
    }
    const sim = typeof H.simulateBankOps === "function"
      ? H.simulateBankOps({
        groups,
        categories: report.categories.filter((row) => row.hidden !== true).map((row) => ({ ...row })),
        rules: (report.rules || []).map((row) => ({ ...row })),
      }, ops)
      : null;
    const categories = (sim && sim.ok !== false && Array.isArray(sim.categories) ? sim.categories : report.categories)
      .filter((row) => row && row.hidden !== true)
      .map((row) => ({ key: row.key, group: row.group }));
    return {
      ok: true,
      report: {
        ok: true, dry_run: true, changed: true, consequence: `Preview ${ops[0]?.op || "move"}`,
        after_fingerprint: "sha256:abc", per_op: [], inverse_ops: [], warnings: [],
        categories, hotkeys: { shifted: plugin._shifted || [], free: ["b", "j"] },
        ops,
      },
    };
  };
  plugin.apiBankConfigUpdateApply = async (envelopeText) => {
    const parsed = JSON.parse(envelopeText);
    plugin.applyOps = parsed.ops;
    return {
      ok: true,
      report: {
        ok: true, dry_run: false, changed: true, after_fingerprint: "sha256:next",
        inverse_ops: [{ op: "category.move", key: "groceries", after: "coffee" }],
        categories: report.categories, per_op: [], warnings: [], sync: null,
      },
    };
  };
  plugin.apiBankConfigVaultSyncRetry = async () => ({ ok: true });
  const modal = new H.BankSetupCardModal(app, { plugin, report });
  modal.contentEl = doc.createElement("div");
  modal.modalEl = modal.contentEl;
  modal.open();
  return { app, plugin, modal, doc, report };
}

test("category, group, and rule multi-moves each compile one envelope without a confirm stage", () => {
  const { modal } = openCard();
  modal.selection = { type: "category", key: "groceries", group: "Everyday", id: "category:groceries" };
  modal.paint();
  assert.equal(modal.beginSelectedGesture("move", "back"), true);
  assert.equal(modal.stage, null, "moves no longer open a confirm stage");
  assert.equal(modal.bankArrangeDirty(), true);
  assert.deepEqual(modal.bankArrangement.projected("group:Everyday"), ["groceries", "coffee"]);
  const catDraft = modal.session.getState().draftOps;
  assert.ok(catDraft.length >= 1 && catDraft.every((op) => op.op === "category.move"));
  const body = modal.contentEl.textContent || "";
  assert.ok(body.indexOf("Groceries") < body.indexOf("Coffee"), "tiles repaint in projected order");
  assert.ok(modal.contentEl.querySelector(".bob-bank-setup-card-delta-badge"), "moved tiles carry a delta badge");
  modal.bankArrangeRevert();

  modal.selection = { type: "group", key: null, group: "Everyday", id: "group:Everyday" };
  modal.paint();
  modal.bankArrangeNudge(1);
  assert.deepEqual(modal.bankArrangement.projected("groups"), ["Money moves", "Everyday"]);
  const groupDraft = modal.session.getState().draftOps;
  assert.ok(groupDraft.length >= 1 && groupDraft.every((op) => op.op === "group.move"));
  modal.bankArrangeRevert();

  modal.setSection("rules");
  modal.selection = { type: "rule", key: null, group: null, alias: null, index: 0, id: "rule:0" };
  modal.paint();
  modal.bankArrangeNudge(1);
  assert.deepEqual(modal.bankArrangement.projected("rules"), ["rule:1", "rule:0"]);
  const ruleDraft = modal.session.getState().draftOps;
  assert.ok(ruleDraft.length >= 1 && ruleDraft.every((op) => op.op === "rule.move"));
  assert.equal(modal.bankArrangeIsLoud().loud, true, "rule moves are loud");
  modal.close();
});

test("quiet category saves on one Enter; rule moves confirm; dry-run mismatch blocks; G→H badges paint", async () => {
  const quiet = openCard();
  quiet.modal.selection = { type: "category", key: "groceries", group: "Everyday", id: "category:groceries" };
  quiet.modal.paint();
  quiet.modal.bankArrangeNudge(-1);
  await quiet.modal.session.previewNow();
  assert.equal(quiet.modal.bankArrangeIsLoud().loud, false);
  let applied = 0;
  quiet.plugin.apiBankConfigUpdateApply = async () => {
    applied += 1;
    return { ok: true, report: { ok: true, changed: true, inverse_ops: [{ op: "category.move", key: "coffee", after: "groceries" }], after_fingerprint: "sha256:next" } };
  };
  await quiet.modal.bankArrangeEnter();
  assert.equal(applied, 1, "quiet arrangements save on the first Enter");
  quiet.modal.close();

  const loud = openCard();
  loud.modal.setSection("rules");
  loud.modal.selection = { type: "rule", key: null, group: null, alias: null, index: 0, id: "rule:0" };
  loud.modal.paint();
  loud.modal.bankArrangeNudge(1);
  await loud.modal.session.previewNow();
  assert.equal(loud.modal.bankArrangeIsLoud().loud, true);
  let loudApplies = 0;
  loud.plugin.apiBankConfigUpdateApply = async () => {
    loudApplies += 1;
    return { ok: true, report: { ok: true, changed: true, inverse_ops: [], after_fingerprint: "sha256:next" } };
  };
  await loud.modal.bankArrangeEnter();
  assert.equal(loudApplies, 0, "loud rule arrangements need a second Enter");
  assert.equal(loud.modal.bankArrangeConfirm, true);
  await loud.modal.bankArrangeEnter();
  assert.equal(loudApplies, 1);
  loud.modal.close();

  const mismatch = openCard();
  mismatch.plugin.apiBankConfigUpdatePreview = async () => ({
    ok: true,
    report: {
      ok: true, dry_run: true, changed: true, consequence: "preview",
      categories: [{ key: "income" }, { key: "coffee" }, { key: "groceries" }],
      hotkeys: { shifted: [], free: [] }, warnings: [], per_op: [], inverse_ops: [],
    },
  });
  mismatch.modal.selection = { type: "category", key: "groceries", group: "Everyday", id: "category:groceries" };
  mismatch.modal.paint();
  mismatch.modal.bankArrangeNudge(-1);
  await mismatch.modal.session.previewNow();
  await mismatch.modal.bankArrangeEnter();
  assert.match(mismatch.modal.errorMessage, /bob disagrees with this order/);
  mismatch.modal.close();

  const shifts = openCard();
  shifts.plugin._shifted = [{ key: "groceries", from: "g", to: "h" }];
  shifts.modal.selection = { type: "category", key: "groceries", group: "Everyday", id: "category:groceries" };
  shifts.modal.paint();
  shifts.modal.bankArrangeNudge(-1);
  await shifts.modal.session.previewNow();
  shifts.modal.paint("session");
  assert.ok(shifts.modal.contentEl.querySelector(".bob-bank-setup-card-hotkey-shift"), "shifted tiles get a G→H badge");
  assert.match(shifts.modal.contentEl.textContent, /G→H/);
  assert.equal(shifts.modal.bankArrangeIsLoud().loud, true, "hotkey shifts are loud");
  shifts.modal.close();
});

test("Ctrl+Z ladders, region identity, Alt chords by code, and ⌥M never hijacks hotkey letters", async () => {
  const { modal, plugin } = openCard();
  modal.selection = { type: "category", key: "groceries", group: "Everyday", id: "category:groceries" };
  modal.paint();
  const panel = modal.bankCardEl().querySelector('[data-setup-region="panel"]');
  modal.bankArrangeNudge(-1);
  assert.equal(modal.bankCardEl().querySelector('[data-setup-region="panel"]'), panel, "region identity survives a body paint");
  modal.bankArrangeStepBackOrUndo();
  assert.equal(modal.bankArrangeDirty(), false);

  modal.bankArrangeNudge(-1);
  const escaped = { key: "Escape", preventDefault() {}, stopPropagation() {}, target: { closest: () => null } };
  await modal.onKeyDown(escaped);
  assert.equal(modal.bankArrangeDirty(), false, "esc reverts pending moves");

  modal.selection = { type: "category", key: "coffee", group: "Everyday", id: "category:coffee" };
  modal.paint();
  const before = modal.bankArrangement.projected("group:Everyday").slice();
  await modal.onKeyDown({ key: "∆", code: "KeyJ", altKey: true, preventDefault() {}, stopPropagation() {}, target: { closest: () => null } });
  const after = modal.bankArrangement.projected("group:Everyday");
  assert.notDeepEqual(after, before, "macOS Option+J by code nudges");

  modal.bankArrangeRevert();
  modal.selection = { type: "category", key: "coffee", group: "Everyday", id: "category:coffee" };
  modal.paint();
  const letter = { key: "g", preventDefault() { this.prevented = true; }, stopPropagation() {}, target: { closest: () => null } };
  await modal.onKeyDown(letter);
  assert.equal(modal.selection.key, "groceries", "plain letters still select by hotkey");
  assert.equal(modal.bankHintMode, null, "plain m/g never enter hint mode");

  modal.bankArrangeNudge(-1);
  await modal.onKeyDown({ key: "m", code: "KeyM", altKey: true, preventDefault() {}, stopPropagation() {}, target: { closest: () => null } });
  assert.ok(modal.bankHintMode && modal.bankHintMode.gaps.length > 0, "⌥M enters gap-hint mode");
  const first = modal.bankHintMode.labels[0];
  assert.equal(modal.bankArrangeHintKey(first), true);

  let resolveApply;
  plugin.apiBankConfigUpdatePreview = async () => ({
    ok: true, report: { ok: true, dry_run: true, changed: true, consequence: "ok", categories: [{ key: "groceries" }, { key: "coffee" }, { key: "income" }], hotkeys: { shifted: [] }, warnings: [], per_op: [], inverse_ops: [] },
  });
  plugin.apiBankConfigUpdateApply = () => new Promise((resolve) => { resolveApply = resolve; });
  modal.selection = { type: "category", key: "groceries", group: "Everyday", id: "category:groceries" };
  modal.bankArrangeNudge(-1);
  await modal.session.previewNow();
  const applying = modal.bankArrangeApply();
  await pause(10);
  modal.onClose();
  assert.equal(modal.bankClosedDuringSave, true);
  resolveApply({ ok: true, report: { ok: true, changed: true, inverse_ops: [{ op: "category.move", key: "coffee", after: "groceries" }], after_fingerprint: "sha256:next" } });
  await applying;
  const last = H.bankSetupLastUndo(plugin);
  assert.ok(last && last.inverseOps.length, "close-during-save records the plugin-level undo");
  assert.ok(TestNotice.messages.some((message) => /Bank setup saved/.test(message)));
});

test("category moves clamp at the group edge and Money is not auto-reordered on open", () => {
  const { modal } = openCard();
  assert.deepEqual(modal.bankArrangement.projected("groups"), ["Everyday", "Money moves"]);
  assert.equal(modal.bankArrangeDirty(), false, "opening does not dirty Money into first");
  modal.selection = { type: "category", key: "groceries", group: "Everyday", id: "category:groceries" };
  modal.paint();
  assert.equal(modal.bankArrangeNudge(1), false, "a last-in-group category cannot cross");
  assert.equal(modal.bankArrangeDirty(), false);
  const scopes = H.bankSetupCardArrangeScopes(modal.model);
  assert.ok(!Object.keys(scopes).includes("group:"), "HIDDEN is not a move scope");
  assert.ok(!scopes.groups.includes("HIDDEN"));
  modal.close();
});
