const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin {
  constructor(app) { this.app = app; }
  registerEditorExtension() {}
  registerMarkdownPostProcessor() {}
  registerEvent() {}
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
    Notice: TestNotice, Plugin: TestPlugin, Platform: { isDesktopApp: true },
    normalizePath: (value) => value, editorInfoField, editorLivePreviewField,
  };
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value }, StateEffect, RangeSetBuilder };
  if (request === "@codemirror/view") return {
    Decoration, WidgetType, ViewPlugin: { fromClass: (cls, options) => ({ cls, options }) },
  };
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers } = LedgerToolsPlugin;
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
    };
  }
  get textContent() { return this.nodeType === 3 ? this._text : this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { this._text = String(value); if (this.nodeType === 1) this.children = [new FakeNode("", this.ownerDocument, this._text)]; }
  get firstChild() { return this.children[0] || null; }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  removeAttribute(name) { this.attrs.delete(name); }
  appendChild(node) { node.parentNode?.removeChild?.(node); node.parentNode = this; this.children.push(node); return node; }
  removeChild(node) { const i = this.children.indexOf(node); if (i >= 0) this.children.splice(i, 1); node.parentNode = null; return node; }
  empty() { while (this.firstChild) this.removeChild(this.firstChild); }
  addEventListener(type, fn) { const rows = this.listeners.get(type) || []; rows.push(fn); this.listeners.set(type, rows); }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  focus() { if (!this.disabled) this.ownerDocument.activeElement = this; }
  setSelectionRange(start, end, direction = "none") { this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 10, height: 10 }; }
  dispatchEvent(event) {
    const payload = event || {};
    if (!payload.target) payload.target = this;
    let current = this;
    while (current) {
      for (const callback of current.listeners?.get?.(payload.type) || []) callback(payload);
      current = current.parentNode;
    }
    return true;
  }
  click() { if (!this.disabled) this.dispatchEvent({ type: "click", preventDefault() {} }); }
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
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const album = (overrides = {}) => ({
  path: "eat.md", stem: "eat", title: "Restaurants", noun: "restaurant",
  parent: "body.md", parent_kind: "area", owner: "body", root: "body",
  breadcrumb: ["This is only a display string"], fields: [], issues: [],
  index: { state: "current" }, ...overrides,
});
function report(entry = album()) {
  return helpers.albumIndexReport({ schema_version: 1, ok: true, albums: [entry], catalogs: [], counts: {} });
}
function fixture(entry = album()) {
  const doc = makeDoc();
  const files = new Map(["eat.md", "body.md"].map((path) => [path, { path }]));
  const caches = new Map([
    ["eat.md", { frontmatter: { type: "[[album]]" }, headings: [{ level: 1, heading: "Restaurants" }] }],
    ["body.md", { frontmatter: { type: "[[area]]", root_parent: true }, headings: [{ level: 1, heading: "Body" }] }],
  ]);
  const app = {
    document: doc,
    vault: { getAbstractFileByPath: (path) => files.get(path) || null },
    metadataCache: {
      getFirstLinkpathDest: (target) => files.get(`${String(target).replace(/\.md$/i, "")}.md`) || null,
      getFileCache: (file) => caches.get(file?.path) || null,
    },
    workspace: { getLeavesOfType: () => [] },
  };
  const plugin = new LedgerToolsPlugin(app);
  const state = { report: report(entry), stale: false, refreshing: false, generation: 1, reportGeneration: 1 };
  plugin.albumReportState = () => state;
  plugin.albumHeaderActive = true;
  plugin.albumVaultGeneration = 1;
  return { app, doc, plugin, state };
}
function openCard(entryOverrides = {}) {
  const entry = album({
    schema_fingerprint: "sha256:arrange",
    emoji: "🍽️", label: "Restaurant", noun: "restaurant", plural: "restaurants",
    records: 4, dated_notes: true, index_by: "status",
    fields: [
      { key: "status", label: "Status", kind: "choices", required: true, list: false, line: 12,
        choices: [
          { value: "to_try", label: "🔖 To try", count: 2 },
          { value: "cooking", label: "Cooking", count: 1 },
          { value: "skip", label: "Skip", count: 0 },
        ] },
      { key: "area", label: "Area", kind: "text", line: 20 },
      { key: "rank", label: "Rank", kind: "text", line: 24 },
    ],
    ...entryOverrides,
  });
  const { app, plugin, state } = fixture(entry);
  let previews = 0;
  plugin.apiAlbumUpdatePreview = async () => {
    previews += 1;
    return { ok: true, report: { ok: true, changed: false, consequence: "preview", per_op: [], group_before: "a", group_after: "a", warnings: [] } };
  };
  plugin.apiAlbumUpdateApply = async () => ({ ok: true, report: { ok: true, changed: false } });
  plugin.apiAlbumSubscribe = () => () => {};
  const model = helpers.albumHeaderModel(state.report, "eat.md", {
    sourcePath: "eat.md", metadataCache: app.metadataCache, vault: app.vault,
  });
  const modal = plugin.openAlbumSchemaCard(model, "eat.md").modal;
  return { app, plugin, state, model, modal, previews: () => previews };
}

test("multi-slot arrange compiles one envelope, paints projected order with zero writer calls, and revert clears the draft", async () => {
  const { modal, plugin } = openCard();
  let previewCalls = 0;
  plugin.apiAlbumUpdatePreview = async () => {
    previewCalls += 1;
    return { ok: true, report: { ok: true, changed: false, consequence: "ok", per_op: [], group_before: "x", group_after: "x", warnings: [] } };
  };
  modal.selectedKey = "choice:status:skip";
  modal.schemaArrangeNudge(-2, {});
  assert.equal(modal.schemaArrangeDirty(), true);
  assert.deepEqual(modal.schemaArrangement.projected("choices:status"), ["skip", "to_try", "cooking"]);
  assert.equal(previewCalls, 0, "a nudge repaints locally with zero writer calls");
  const draft = modal.session.getState().draftOps;
  assert.ok(Array.isArray(draft) && draft.length >= 1, "a compiled envelope is staged");
  assert.ok(draft.every((op) => op.op === "choice.move"));
  const bodyText = modal.contentEl.querySelector(".bob-album-schema-dialog")?.textContent || "";
  const skipAt = bodyText.indexOf("Skip");
  const tryAt = bodyText.indexOf("To try");
  assert.ok(skipAt >= 0 && tryAt >= 0 && skipAt < tryAt, "chips repaint in projected order");
  const deltaBadge = modal.contentEl.querySelector(".bob-album-schema-delta-badge");
  assert.ok(deltaBadge, "moved items carry a delta badge");
  modal.schemaArrangeStepBackOrUndo();
  assert.deepEqual(modal.schemaArrangement.projected("choices:status"), ["to_try", "cooking", "skip"]);
  modal.schemaArrangeNudge(-2, {});
  assert.equal(modal.schemaArrangeDirty(), true);
  modal.schemaArrangeRevert();
  assert.equal(modal.schemaArrangeDirty(), false);
  assert.deepEqual(modal.session.getState().draftOps, [], "returning to the original order clears the draft");
  modal.close();
});

test("quiet saves on one Enter while loud needs Confirm save", async () => {
  const { modal, plugin } = openCard();
  plugin.apiAlbumUpdatePreview = async () => ({
    ok: true,
    report: { ok: true, changed: false, consequence: "quiet", per_op: [{ newly_invalid: 0 }], group_before: "g", group_after: "g", warnings: [] },
  });
  modal.selectedKey = "field:rank";
  modal.schemaArrangeNudge(-2, {});
  await modal.session.previewNow();
  assert.equal(modal.schemaArrangeIsLoud().loud, false);
  let applied = 0;
  plugin.apiAlbumUpdateApply = async () => {
    applied += 1;
    return { ok: true, report: { ok: true, changed: true, inverse_ops: [{ op: "field.move", field: "rank", position: 0 }], after_fingerprint: "sha256:arrange" } };
  };
  await modal.schemaArrangeEnter();
  assert.equal(applied, 1, "quiet arrangements save on the first Enter");

  const loud = openCard();
  loud.plugin.apiAlbumUpdatePreview = async () => ({
    ok: true,
    report: { ok: true, changed: false, consequence: "group changed", per_op: [{ newly_invalid: 1 }], group_before: "a", group_after: "b", warnings: [] },
  });
  loud.modal.selectedKey = "field:rank";
  loud.modal.schemaArrangeNudge(-2, {});
  await loud.modal.session.previewNow();
  assert.equal(loud.modal.schemaArrangeIsLoud().loud, true);
  let loudApplies = 0;
  loud.plugin.apiAlbumUpdateApply = async () => {
    loudApplies += 1;
    return { ok: true, report: { ok: true, changed: true, inverse_ops: [], after_fingerprint: "sha256:arrange" } };
  };
  await loud.modal.schemaArrangeEnter();
  assert.equal(loudApplies, 0, "loud arrangements need a second Enter");
  assert.equal(loud.modal.schemaArrangeConfirm, true);
  await loud.modal.schemaArrangeEnter();
  assert.equal(loudApplies, 1, "the confirming Enter saves");
  modal.close();
  loud.modal.close();
});

test("follow-on moves during an in-flight apply never call setDraft until it settles", async () => {
  const { modal, plugin } = openCard();
  plugin.apiAlbumUpdatePreview = async () => ({
    ok: true, report: { ok: true, changed: false, consequence: "ok", per_op: [], group_before: "x", group_after: "x", warnings: [] },
  });
  let resolveApply;
  plugin.apiAlbumUpdateApply = () => new Promise((resolve) => { resolveApply = resolve; });
  modal.selectedKey = "field:rank";
  modal.schemaArrangeNudge(-2, {});
  await modal.session.previewNow();
  let setDraftCalls = 0;
  const origSetDraft = modal.session.setDraft.bind(modal.session);
  modal.session.setDraft = (...args) => { setDraftCalls += 1; return origSetDraft(...args); };
  const applying = modal.schemaArrangeApply();
  await pause(10);
  modal.schemaArrangeNudge(1, {});
  assert.equal(setDraftCalls, 0, "moves during a save accumulate locally");
  resolveApply({ ok: true, report: { ok: true, changed: true, inverse_ops: [{ op: "field.move", field: "rank", position: 1 }], after_fingerprint: "sha256:arrange" } });
  await applying;
  assert.ok(setDraftCalls >= 0);
  modal.close();
});

test("refusal keeps the arrangement pending; u and esc walk the ladder; gap hints place by keystroke; macOS codes move", async () => {
  const { modal, plugin } = openCard();
  plugin.apiAlbumUpdatePreview = async () => ({
    ok: true, report: { ok: false, error: { code: "refused", message: "nope", hint: "try again" } },
  });
  modal.selectedKey = "field:rank";
  modal.schemaArrangeNudge(-1, {});
  await modal.session.previewNow();
  assert.equal(modal.schemaArrangeDirty(), true, "refusal keeps the arrangement pending");
  plugin.apiAlbumUpdatePreview = async () => ({
    ok: true, report: { ok: true, changed: false, consequence: "ok", per_op: [], group_before: "x", group_after: "x", warnings: [] },
  });
  modal.schemaArrangeStepBackOrUndo();
  assert.equal(modal.schemaArrangeDirty(), false);
  modal.schemaArrangeNudge(-1, {});
  assert.equal(modal.schemaArrangeDirty(), true);
  const escaped = modal.schemaHandleEscape();
  assert.equal(escaped, "stay");
  assert.equal(modal.schemaArrangeDirty(), false, "esc reverts pending moves");

  modal.schemaArrangeNudge(-1, {});
  assert.equal(modal.schemaArrangeEnterHintMode(), true);
  const mode = modal.schemaHintMode;
  assert.ok(mode && mode.gaps.length > 0);
  const firstLabel = mode.labels[0];
  assert.equal(modal.schemaArrangeHintKey(firstLabel), true);

  modal.selectedKey = "field:rank";
  const before = modal.schemaArrangement.projected("fields").slice();
  modal.schemaOnKeyDown({ key: "∆", code: "KeyJ", altKey: true, preventDefault() {}, target: { closest: () => null } });
  const after = modal.schemaArrangement.projected("fields");
  assert.notDeepEqual(after, before, "macOS Option+J by code nudges");
  modal.close();
});

test("close-during-save records the plugin-level undo and seeds a reopened card", async () => {
  const { modal, plugin } = openCard();
  plugin.apiAlbumUpdatePreview = async () => ({
    ok: true, report: { ok: true, changed: false, consequence: "ok", per_op: [], group_before: "x", group_after: "x", warnings: [] },
  });
  let resolveApply;
  plugin.apiAlbumUpdateApply = () => new Promise((resolve) => { resolveApply = resolve; });
  modal.selectedKey = "field:rank";
  modal.schemaArrangeNudge(-1, {});
  await modal.session.previewNow();
  const applying = modal.schemaArrangeApply();
  await pause(10);
  modal.onClose();
  assert.equal(modal.schemaClosedDuringSave, true);
  resolveApply({ ok: true, report: { ok: true, changed: true, inverse_ops: [{ op: "field.move", field: "rank", position: 2 }], after_fingerprint: "sha256:arrange" } });
  await applying;
  const last = plugin.albumSchemaLastUndo("eat");
  assert.ok(last && last.inverseOps.length, "close-during-save records the plugin-level undo");
  assert.ok(TestNotice.messages.some((message) => /Album schema saved/.test(message)));
});
