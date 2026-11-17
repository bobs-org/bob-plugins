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
  insertBefore(node, before) {
    if (!node) return null;
    node.parentNode?.removeChild?.(node);
    node.parentNode = this;
    if (!before) { this.children.push(node); return node; }
    const i = this.children.indexOf(before);
    if (i < 0) this.children.push(node);
    else this.children.splice(i, 0, node);
    return node;
  }
  empty() { while (this.firstChild) this.removeChild(this.firstChild); }
  addEventListener(type, fn) { const rows = this.listeners.get(type) || []; rows.push(fn); this.listeners.set(type, rows); }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  focus() { if (!this.disabled) this.ownerDocument.activeElement = this; }
  setSelectionRange(start, end, direction = "none") { this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 10, height: 10, bottom: 10, right: 10 }; }
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
    schema_fingerprint: "sha256:place",
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
  plugin.apiAlbumUpdatePreview = async () => ({
    ok: true, report: { ok: true, changed: false, consequence: "ok", per_op: [], group_before: "x", group_after: "x", warnings: [] },
  });
  plugin.apiAlbumUpdateApply = async () => ({ ok: true, report: { ok: true, changed: false } });
  plugin.apiAlbumSubscribe = () => () => {};
  const model = helpers.albumHeaderModel(state.report, "eat.md", {
    sourcePath: "eat.md", metadataCache: app.metadataCache, vault: app.vault,
  });
  const modal = plugin.openAlbumSchemaCard(model, "eat.md").modal;
  return { app, plugin, state, model, modal };
}

test("ghost defaults land after the selected choice and stay out of the envelope", () => {
  const { modal } = openCard();
  modal.selectedKey = "choice:status:cooking";
  assert.equal(modal.schemaStage("choice-add", "choice:status:cooking"), true);
  const ghost = modal.schemaAddGhost;
  assert.ok(ghost, "opening choice-add seeds a ghost");
  assert.equal(ghost.scope, "choices:status");
  assert.equal(ghost.gap, 2, "default slot follows the selected choice");
  modal.schemaQueueStagePreview(false);
  const draft = modal.session.getState().draftOps;
  assert.equal(draft.length, 1, "one add op previews");
  assert.equal(draft[0].op, "choice.add");
  assert.equal(draft[0].position, 2, "the single add op carries the ghost gap");
  assert.equal(modal.schemaArrangeDirty(), false, "the ghost never enters the arrangement");
  assert.deepEqual(helpers.compileAlbumArrangement(modal.schemaArrangement), [],
    "a lone ghost compiles to an empty move envelope");
  const node = modal.contentEl.querySelector("[data-schema-ghost]");
  assert.ok(node, "a dashed ghost chip paints in the cloud");
  modal.close();
});

test("Alt+J inside the label input moves the ghost and inserts no macOS glyph", () => {
  const { modal } = openCard();
  modal.selectedKey = "choice:status:cooking";
  modal.schemaStage("choice-add", "choice:status:cooking");
  const input = modal.schemaInput("choiceLabel");
  assert.ok(input, "the label input is reachable");
  input.value = "Mint";
  let prevented = 0;
  modal.schemaOnKeyDown({
    key: "∆", code: "KeyJ", altKey: true, target: input,
    preventDefault() { prevented += 1; },
  });
  assert.equal(prevented, 1, "the macOS Option chord is swallowed");
  assert.equal(modal.schemaAddGhost.gap, 3, "Alt+J slides the ghost one slot later");
  assert.equal(modal.stageDraft.values.choiceLabel, "Mint", "typing state is untouched");
  const draft = modal.session.getState().draftOps;
  assert.equal(draft[0].position, 3, "the previewed add follows the ghost");
  modal.schemaOnKeyDown({
    key: "∆", code: "KeyJ", altKey: true, shiftKey: true, target: input,
    preventDefault() { prevented += 1; },
  });
  assert.equal(modal.schemaAddGhost.gap, 3, "the last slot clamps with no write");
  modal.schemaOnKeyDown({
    key: "˚", code: "KeyK", altKey: true, shiftKey: true, target: input,
    preventDefault() { prevented += 1; },
  });
  assert.equal(modal.schemaAddGhost.gap, 0, "Alt+Shift+K parks the ghost first");
  modal.close();
});

test("ghost gap badges place by keystroke and Esc leaves hint mode with the stage open", () => {
  const { modal } = openCard();
  modal.selectedKey = "choice:status:cooking";
  modal.schemaStage("choice-add", "choice:status:cooking");
  assert.equal(modal.schemaGhostEnterHintMode(), true);
  assert.ok(modal.schemaHintMode?.ghost, "ghost gaps reuse the shared hint badge UI");
  const firstLabel = modal.schemaHintMode.labels[0];
  assert.equal(modal.schemaGhostHintKey(firstLabel), true);
  assert.equal(modal.schemaAddGhost.gap, 0);
  assert.equal(modal.schemaHintMode, null, "placing clears hint mode");
  assert.ok(modal.stage, "the add stage stays open with focus inside");
  modal.schemaGhostEnterHintMode();
  assert.equal(modal.schemaHandleEscape(), "stay");
  assert.equal(modal.schemaHintMode, null, "Esc leaves ghost hint mode");
  assert.ok(modal.stage, "Esc does not cancel the add stage from hint mode");
  modal.close();
});

test("field-add paints a ghost row whose moves set the field position", () => {
  const { modal } = openCard();
  modal.selectedKey = "field:area";
  assert.equal(modal.schemaStage("field-add", "field:area"), true);
  assert.equal(modal.schemaAddGhost.scope, "fields");
  assert.equal(modal.schemaAddGhost.gap, 2, "the ghost row follows the selected field");
  modal.schemaGhostToEdge("first");
  assert.equal(modal.schemaAddGhost.gap, 0);
  const draft = modal.session.getState().draftOps;
  assert.equal(draft[0].op, "field.add");
  assert.equal(draft[0].position, 0, "the single field.add carries the ghost gap");
  const node = modal.contentEl.querySelector("[data-schema-ghost]");
  assert.ok(node, "a dashed ghost row paints among the fields");
  modal.schemaCancelStage();
  assert.equal(modal.schemaAddGhost, null, "cancelling clears the ghost");
  modal.close();
});

test("grip handles paint while browsing and hide while a stage is open", () => {
  const { modal } = openCard();
  const grips = modal.contentEl.querySelectorAll(".bob-album-schema-grip");
  assert.ok(grips.length >= 5, `chips and rows carry grips, saw ${grips.length}`);
  for (const grip of grips) {
    assert.ok(grip.getAttribute("data-drag-scope"), "every grip names its scope");
    assert.notEqual(grip.getAttribute("data-drag-id"), null, "every grip names its item");
  }
  modal.schemaStage("choice-add", "choice:status:cooking");
  assert.equal(modal.contentEl.querySelectorAll(".bob-album-schema-grip").length, 0,
    "no grips compete with the ghost while a stage is open");
  modal.close();
});

test("drag gap math tracks pointer position in both orientations", () => {
  const order = ["a", "b", "c"];
  const vertical = new Map([
    ["a", { top: 0, bottom: 10, left: 0, right: 10 }],
    ["b", { top: 20, bottom: 30, left: 0, right: 10 }],
    ["c", { top: 40, bottom: 50, left: 0, right: 10 }],
  ]);
  assert.equal(helpers.schemaDragGapFromPoint(order, "b", vertical, { y: -5 }, "vertical"), 0);
  assert.equal(helpers.schemaDragGapFromPoint(order, "b", vertical, { y: 5 }, "vertical"), 1);
  assert.equal(helpers.schemaDragGapFromPoint(order, "b", vertical, { y: 26 }, "vertical"), 2);
  assert.equal(helpers.schemaDragGapFromPoint(order, "b", vertical, { y: 500 }, "vertical"), 3);
  const horizontal = new Map([
    ["a", { top: 0, bottom: 10, left: 0, right: 10 }],
    ["b", { top: 0, bottom: 10, left: 20, right: 30 }],
  ]);
  assert.equal(helpers.schemaDragGapFromPoint(["a", "b"], "a", horizontal, { x: 1 }, "horizontal"), 0);
  assert.equal(helpers.schemaDragGapFromPoint(["a", "b"], "a", horizontal, { x: 26 }, "horizontal"), 2);
  assert.equal(helpers.schemaDragGapFromPoint(order, "b", vertical, {}, "vertical"), null,
    "a missing pointer keeps the previous caret");
});

test("drag sessions drop through the same placeAtGap path as the keyboard", () => {
  const { modal } = openCard();
  assert.equal(modal.schemaDragBegin("choices:status", "skip",
    { preventDefault() {}, pointerId: 7, target: { closest: () => null } }), true);
  assert.ok(modal.schemaDragActive(), "a drag session is live");
  modal.schemaDragUpdate(0, -100, "choices:status");
  assert.equal(modal.schemaDrag.session.gap, 0, "the caret tracks the pointer");
  assert.equal(modal.schemaDragFinish(false), true);
  assert.equal(modal.schemaDragActive(), false, "the session ends on drop");
  assert.deepEqual(modal.schemaArrangement.projected("choices:status"), ["skip", "to_try", "cooking"]);
  const draft = modal.session.getState().draftOps;
  assert.ok(draft.length >= 1 && draft.every((op) => op.op === "choice.move"),
    "a drop stages the same move envelope as Alt+K");
  assert.ok(modal.contentEl.querySelector("[data-drag-caret]") === null, "the caret clears on drop");
  modal.close();
});

test("out-of-scope drops and Esc cancel without touching the arrangement", () => {
  const { modal } = openCard();
  modal.schemaDragBegin("choices:status", "skip",
    { preventDefault() {}, pointerId: 7, target: { closest: () => null } });
  modal.schemaDragUpdate(0, 0, "fields");
  assert.equal(modal.schemaDrag.session.valid, false, "a foreign scope is not a valid target");
  modal.schemaDragFinish(false);
  assert.equal(modal.schemaArrangeDirty(), false, "an out-of-scope drop snaps back unwritten");
  assert.equal(modal.session.getState().draftOps.length, 0);

  modal.schemaDragBegin("choices:status", "skip",
    { preventDefault() {}, pointerId: 8, target: { closest: () => null } });
  modal.schemaDragUpdate(0, -100, "choices:status");
  assert.equal(modal.schemaHandleEscape(), "stay", "Esc cancels a live drag");
  assert.equal(modal.schemaDragActive(), false);
  assert.equal(modal.schemaArrangeDirty(), false, "cancelling writes nothing");
  modal.close();
});

test("autoscroll steps only inside the edge zone of a scrollable card", () => {
  const scroller = {
    scrollTop: 50, scrollHeight: 400, clientHeight: 100,
    getBoundingClientRect: () => ({ top: 0, bottom: 100, height: 100 }),
  };
  assert.equal(helpers.schemaDragAutoscrollStep(scroller, 10), true);
  assert.equal(scroller.scrollTop, 38, "the top edge scrolls up");
  assert.equal(helpers.schemaDragAutoscrollStep(scroller, 50), false, "the middle never scrolls");
  assert.equal(helpers.schemaDragAutoscrollStep(scroller, 95), true);
  assert.ok(scroller.scrollTop > 38, "the bottom edge scrolls down");
  assert.equal(helpers.schemaDragAutoscrollStep({ scrollTop: 0, scrollHeight: 100, clientHeight: 100 }, 5), false,
    "a card with no overflow never scrolls");
});
