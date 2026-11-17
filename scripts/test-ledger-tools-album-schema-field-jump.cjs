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
// Zettel-like album: Status (choices), Claim (no choices, so the Claim to
// Section gap is visible), Section (choices).
const album = (overrides = {}) => ({
  path: "eat.md", stem: "eat", title: "Zettel", noun: "note",
  parent: "body.md", parent_kind: "area", owner: "body", root: "body",
  breadcrumb: ["This is only a display string"], fields: [], issues: [],
  index: { state: "current" }, ...overrides,
});
const zettelFields = () => [
  { key: "status", label: "Status", kind: "choices", required: true, list: false, line: 12,
    choices: [
      { value: "seed", label: "🌱 Seed", count: 0 },
      { value: "draft", label: "✍️ Draft", count: 4 },
      { value: "ready", label: "✅ Ready", count: 0 },
    ] },
  { key: "claim", label: "Claim", kind: "text", required: true, list: false, line: 20 },
  { key: "section", label: "Section", kind: "choices", required: false, list: false, line: 24,
    choices: [
      { value: "intro", label: "🪝 Intro", count: 0 },
      { value: "sase", label: "🧱 What is SASE?", count: 1 },
    ] },
];
function report(entry = album()) {
  return helpers.albumIndexReport({ schema_version: 1, ok: true, albums: [entry], catalogs: [], counts: {} });
}
function fixture(entry = album()) {
  const doc = makeDoc();
  const files = new Map(["eat.md", "body.md"].map((path) => [path, { path }]));
  const caches = new Map([
    ["eat.md", { frontmatter: { type: "[[album]]" }, headings: [{ level: 1, heading: "Zettel" }] }],
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
    schema_fingerprint: "sha256:field-jump",
    emoji: "🗂️", label: "Zettel", noun: "note", plural: "notes",
    records: 4, dated_notes: false, fields: zettelFields(), issues: [],
    ...entryOverrides,
  });
  const { app, plugin, state } = fixture(entry);
  plugin.apiAlbumUpdatePreview = async () => {
    return { ok: true, report: { ok: true, changed: false, consequence: "ok", per_op: [], group_before: "a", group_after: "a", warnings: [] } };
  };
  plugin.apiAlbumUpdateApply = async () => ({ ok: true, report: { ok: true, changed: false } });
  plugin.apiAlbumSubscribe = () => () => {};
  const model = helpers.albumHeaderModel(state.report, "eat.md", {
    sourcePath: "eat.md", metadataCache: app.metadataCache, vault: app.vault,
  });
  const modal = plugin.openAlbumSchemaCard(model, "eat.md").modal;
  return { app, plugin, state, model, modal };
}
function domOrder(modal) {
  return modal.contentEl.querySelectorAll("[data-target-key]")
    .map((node) => node.getAttribute("data-target-key"));
}
function targetKeys(modal) {
  return modal.schemaTargets().map((target) => target.key);
}
function press(modal, targetKey, event) {
  const node = modal.contentEl.querySelector(`[data-target-key="${targetKey}"]`);
  assert.ok(node, `target ${targetKey} exists`);
  node.dispatchEvent({ type: "keydown", preventDefault() {}, ...event });
  return node;
}
function announcer(modal) {
  return modal.contentEl.querySelector("[data-arrange-announcer]");
}
function announceText(modal) {
  return announcer(modal)?.textContent || "";
}

test("field jumps follow one painted order shared with the body painter", () => {
  const { modal } = openCard();
  assert.deepEqual(targetKeys(modal), [
    "stats",
    "field:status", "choice:status:seed", "choice:status:draft", "choice:status:ready", "add-choice:status",
    "field:claim",
    "field:section", "choice:section:intro", "choice:section:sase", "add-choice:section",
    "add-field",
  ]);
  assert.deepEqual(domOrder(modal), targetKeys(modal), "targets equal body+header DOM order");
  // j walks the order painted on screen.
  modal.schemaSelect("stats");
  const walked = [modal.selectedKey];
  for (let step = 0; step < targetKeys(modal).length - 1; step += 1) {
    press(modal, modal.selectedKey, { key: "j" });
    walked.push(modal.selectedKey);
  }
  assert.deepEqual(walked, targetKeys(modal));
  // Move Claim below Section: both the DOM and the targets follow the projection.
  modal.schemaSelect("field:claim");
  assert.equal(modal.schemaArrangeNudge(1, {}), true);
  assert.deepEqual(modal.schemaArrangement.projected("fields"), ["status", "section", "claim"]);
  assert.deepEqual(targetKeys(modal), [
    "stats",
    "field:status", "choice:status:seed", "choice:status:draft", "choice:status:ready", "add-choice:status",
    "field:section", "choice:section:intro", "choice:section:sase", "add-choice:section",
    "field:claim",
    "add-field",
  ]);
  assert.deepEqual(domOrder(modal), targetKeys(modal), "targets still equal DOM order while dirty");
  modal.close();
});

test("painted targets put body issues before + field", () => {
  const model = {
    fields: [{ key: "status", label: "Status", kind: "text", choices: [] }],
    issues: [{ code: "lint", path: "eat.md", line: 3 }],
  };
  const keys = helpers.albumSchemaPaintedTargets(model, null).map((target) => target.key);
  assert.deepEqual(keys, ["stats", "field:status", keys[2], "add-field"]);
  assert.match(keys[2], /^issue:/);
  assert.deepEqual(
    helpers.albumSchemaTargets(model).map((target) => target.key),
    keys,
    "clean targets match the painted helper",
  );
});

test("field step helpers scan strictly to the next field row", () => {
  const model = {
    fields: [
      { key: "a", label: "A", kind: "choices", choices: [{ value: "x", label: "X" }] },
      { key: "b", label: "B", kind: "text", choices: [] },
    ],
    issues: [{ code: "lint", path: "eat.md", line: 3 }],
  };
  const targets = helpers.albumSchemaPaintedTargets(model, null);
  const issueKey = targets.find((target) => target.kind === "issue").key;
  assert.equal(helpers.albumSchemaFieldStepKey(targets, "stats", 1), "field:a");
  assert.equal(helpers.albumSchemaFieldStepKey(targets, "stats", -1), null);
  assert.equal(helpers.albumSchemaFieldStepKey(targets, "field:a", 1), "field:b");
  assert.equal(helpers.albumSchemaFieldStepKey(targets, "choice:a:x", 1), "field:b");
  assert.equal(helpers.albumSchemaFieldStepKey(targets, "add-choice:a", -1), "field:a");
  assert.equal(helpers.albumSchemaFieldStepKey(targets, "add-choice:a", 1), "field:b");
  assert.equal(helpers.albumSchemaFieldStepKey(targets, issueKey, -1), "field:b");
  assert.equal(helpers.albumSchemaFieldStepKey(targets, issueKey, 1), null);
  assert.equal(helpers.albumSchemaFieldStepKey(targets, "add-field", -1), "field:b");
  assert.equal(helpers.albumSchemaFieldStepKey(targets, "add-field", 1), null);
  assert.equal(helpers.albumSchemaFieldStepKey(targets, "nope", 1), null);
  assert.equal(helpers.albumSchemaFieldNumberKey(targets, 1), "field:a");
  assert.equal(helpers.albumSchemaFieldNumberKey(targets, 2), "field:b");
  assert.equal(helpers.albumSchemaFieldNumberKey(targets, 3), null);
});

test("Shift+J/K walk every row of the field-step table", () => {
  const { modal } = openCard();
  const shifted = { key: "J", shiftKey: true };
  const check = (from, key, want, message) => {
    modal.schemaSelect(from);
    press(modal, from, key);
    assert.equal(modal.selectedKey, want, message);
  };
  check("stats", { key: "J" }, "field:status", "Stats Shift+J lands on field 1");
  check("stats", { key: "K" }, "stats", "Stats Shift+K stays");
  assert.match(announceText(modal), /No previous field/);
  check("field:status", { key: "J" }, "field:claim", "field 1 Shift+J lands on field 2");
  check("field:claim", { key: "K" }, "field:status", "field 2 Shift+K lands on field 1");
  check("field:section", { key: "J" }, "field:section", "last field Shift+J stays");
  assert.match(announceText(modal), /No next field/);
  check("field:status", { key: "K" }, "field:status", "first field Shift+K stays");
  check("choice:section:sase", { key: "K" }, "field:section", "a chip Shift+K returns to its own field first");
  check("choice:status:seed", { key: "J" }, "field:claim", "a chip Shift+J lands on the next field");
  check("add-choice:status", { key: "K" }, "field:status", "+ choice Shift+K returns to its own field");
  check("add-choice:status", { key: "J" }, "field:claim", "+ choice Shift+J lands on the next field");
  check("add-choice:section", { key: "J" }, "add-choice:section", "+ choice of the last field Shift+J stays");
  check("add-field", { key: "K" }, "field:section", "+ field Shift+K lands on the last field");
  check("add-field", { key: "J" }, "add-field", "+ field Shift+J stays");
  // Caps Lock counts: bare "J" without shiftKey still steps.
  modal.schemaSelect("field:status");
  press(modal, "field:status", { key: "J" });
  assert.equal(modal.selectedKey, "field:claim");
  assert.match(announceText(modal), /Claim, field 2 of 3/);
  modal.close();
});

test("digits jump straight to field N as painted", () => {
  const { modal } = openCard();
  modal.schemaSelect("stats");
  press(modal, "stats", { key: "3" });
  assert.equal(modal.selectedKey, "field:section");
  assert.match(announceText(modal), /Section, field 3 of 3/);
  // A missing digit stays put and announces the lane size.
  press(modal, "field:section", { key: "7" });
  assert.equal(modal.selectedKey, "field:section");
  assert.equal(announceText(modal), "No field 7 · this album has 3 fields");
  // Digits follow projected order while dirty.
  modal.schemaSelect("field:claim");
  assert.equal(modal.schemaArrangeNudge(1, {}), true);
  modal.schemaSelect("stats");
  press(modal, "stats", { key: "2" });
  assert.equal(modal.selectedKey, "field:section");
  // 0 is inert and buffers nothing: the next Alt+K still nudges one slot.
  press(modal, "field:section", { key: "0" });
  assert.equal(modal.selectedKey, "field:section");
  assert.equal(modal.schemaArrangeNudge(-1, {}), true);
  modal.close();
});

test("3 then Alt+K nudges field 3 exactly one slot", () => {
  const { modal } = openCard();
  modal.schemaSelect("stats");
  press(modal, "stats", { key: "3" });
  assert.equal(modal.selectedKey, "field:section");
  assert.equal(modal.schemaArrangeCountBuffer, undefined, "no count buffer survives the digit");
  press(modal, "field:section", { key: "k", altKey: true });
  assert.deepEqual(modal.schemaArrangement.projected("fields"), ["status", "section", "claim"]);
  assert.equal(modal.session.getState().draftOps.length, 1);
  modal.close();
});

test("Shift+1 still stages required while shifted digits jump", () => {
  const { modal } = openCard();
  modal.schemaSelect("field:claim");
  press(modal, "field:claim", { key: "!" });
  assert.equal(modal.session.getState().draftOps.length, 1, "US Shift+1 (!) stages required");
  assert.deepEqual(modal.session.getState().draftOps[0], { op: "field.set", field: "claim", set: { required: false } });
  modal.schemaArrangeRevert();
  modal.schemaSelect("field:claim");
  press(modal, "field:claim", { key: "1", shiftKey: true });
  assert.equal(modal.selectedKey, "field:status", "AZERTY Shift+1 jumps to field 1");
  modal.close();
});

test("Alt and Ctrl jumps keep their arrange meanings", () => {
  const { modal } = openCard();
  modal.schemaSelect("field:status");
  press(modal, "field:status", { key: "J", code: "KeyJ", altKey: true });
  assert.equal(modal.session.getState().draftOps.length, 1, "Alt+J still nudges");
  assert.equal(modal.selectedKey, "field:status", "a nudge keeps the selection");
  assert.deepEqual(modal.schemaArrangement.projected("fields"), ["claim", "status", "section"]);
  modal.schemaArrangeRevert();
  modal.schemaSelect("field:status");
  press(modal, "field:status", { key: "J", code: "KeyJ", altKey: true, shiftKey: true });
  assert.deepEqual(modal.schemaArrangement.projected("fields"), ["claim", "section", "status"], "Alt+Shift+J still jumps to the edge");
  assert.equal(modal.selectedKey, "field:status");
  modal.schemaArrangeRevert();
  modal.schemaSelect("field:status");
  press(modal, "field:status", { key: "J", ctrlKey: true });
  assert.equal(modal.selectedKey, "field:status", "Ctrl+J does nothing");
  assert.equal(modal.schemaArrangeDirty(), false);
  modal.close();
});

test("jumps are inert in stages, inputs, composition, applying, the read-only card, and hint mode", () => {
  const { modal } = openCard();
  // In a stage.
  assert.equal(modal.schemaStage("field", "field:status"), true);
  press(modal, "field:status", { key: "J" });
  assert.equal(modal.selectedKey, "field:status");
  // In an input: typing J never jumps.
  const input = modal.schemaInput("fieldLabel");
  assert.ok(input, "stage input exists");
  input.dispatchEvent({ type: "keydown", key: "J", preventDefault() {} });
  assert.equal(modal.selectedKey, "field:status");
  modal.schemaCancelStage();
  // IME composition.
  press(modal, "field:status", { key: "J", isComposing: true });
  assert.equal(modal.selectedKey, "field:status");
  press(modal, "field:status", { key: "J", keyCode: 229 });
  assert.equal(modal.selectedKey, "field:status");
  // While applying.
  const kept = modal.sessionState;
  modal.sessionState = { ...kept, status: "applying" };
  press(modal, "field:status", { key: "J" });
  assert.equal(modal.selectedKey, "field:status");
  modal.sessionState = kept;
  // The read-only card has no session.
  const session = modal.session;
  modal.session = null;
  press(modal, "field:status", { key: "J" });
  assert.equal(modal.selectedKey, "field:status");
  assert.equal(announcer(modal), null, "no announcement without a session");
  modal.session = session;
  // Hint mode owns the keyboard and survives a swallowed digit.
  modal.schemaSelect("field:status");
  assert.equal(modal.schemaArrangeEnterHintMode(), true);
  press(modal, "field:status", { key: "3" });
  assert.equal(modal.selectedKey, "field:status", "a swallowed digit never jumps");
  assert.ok(modal.schemaHintMode, "hint mode survives the swallowed digit");
  press(modal, "field:status", { key: "J" });
  assert.equal(modal.selectedKey, "field:status", "J never jumps in hint mode");
  assert.ok(modal.schemaHintMode, "hint mode survives a swallowed J");
  modal.schemaHandleEscape();
  assert.equal(modal.schemaHintMode, null);
  modal.close();
});

test("jumps never touch the session preview, apply, or the arrangement nudge", () => {
  const { modal, plugin } = openCard();
  let previews = 0;
  let applies = 0;
  plugin.apiAlbumUpdatePreview = async () => {
    previews += 1;
    return { ok: true, report: { ok: true, changed: false, consequence: "ok", per_op: [], group_before: "a", group_after: "a", warnings: [] } };
  };
  plugin.apiAlbumUpdateApply = async () => {
    applies += 1;
    return { ok: true, report: { ok: true, changed: false } };
  };
  modal.schemaEnsureArrangement();
  let nudges = 0;
  const origNudge = modal.schemaArrangement.nudge.bind(modal.schemaArrangement);
  modal.schemaArrangement.nudge = (...args) => { nudges += 1; return origNudge(...args); };
  modal.schemaSelect("stats");
  press(modal, "stats", { key: "J" });
  press(modal, "field:status", { key: "3" });
  press(modal, "field:section", { key: "J" });
  press(modal, "field:section", { key: "7" });
  press(modal, "field:section", { key: "K" });
  assert.equal(previews, 0, "no preview for any jump");
  assert.equal(applies, 0, "no apply for any jump");
  assert.equal(nudges, 0, "no arrangement nudge for any jump");
  assert.deepEqual(modal.session.getState().draftOps, [], "no draft ops for any jump");
  modal.close();
});

test("a held clamp key bumps once, then stays silent", () => {
  const { modal } = openCard();
  const row = modal.contentEl.querySelector('[data-target-key="field:section"]');
  const bumps = [];
  row.animate = (frames, options) => { bumps.push({ frames, options }); return {}; };
  modal.schemaSelect("field:section");
  press(modal, "field:section", { key: "J" });
  assert.equal(modal.selectedKey, "field:section");
  assert.equal(bumps.length, 1, "one vertical bump on the clamp");
  assert.deepEqual(bumps[0].frames, [
    { transform: "translateY(0)" },
    { transform: "translateY(3px)" },
    { transform: "translateY(0)" },
  ]);
  assert.equal(bumps[0].options.duration, 90);
  assert.match(announceText(modal), /No next field/);
  press(modal, "field:section", { key: "J", repeat: true });
  assert.equal(bumps.length, 1, "a held key clamps silently after the first bump");
  modal.close();
});

test("zero fields announce the empty lane on every jump key", () => {
  const { modal } = openCard({ fields: [] });
  assert.deepEqual(targetKeys(modal), ["stats", "add-field"]);
  const row = modal.contentEl.querySelector('[data-target-key="stats"]');
  const bumps = [];
  row.animate = (frames, options) => { bumps.push({ frames, options }); return {}; };
  press(modal, "stats", { key: "J" });
  assert.equal(modal.selectedKey, "stats");
  assert.equal(announceText(modal), "This album has no fields yet.");
  press(modal, "stats", { key: "K" });
  assert.equal(announceText(modal), "This album has no fields yet.");
  press(modal, "stats", { key: "5" });
  assert.equal(modal.selectedKey, "stats");
  assert.equal(announceText(modal), "This album has no fields yet.");
  assert.equal(bumps.length, 3, "each empty-lane key bumps");
  modal.close();
});

test("one field uses the singular lane noun", () => {
  const { modal } = openCard({ fields: [{ key: "only", label: "Only", kind: "text", line: 12 }] });
  modal.schemaSelect("field:only");
  press(modal, "field:only", { key: "9" });
  assert.equal(modal.selectedKey, "field:only");
  assert.equal(announceText(modal), "No field 9 · this album has 1 field");
  modal.close();
});

test("jumps reveal the group and leave the announcer visible to screen readers", () => {
  const { modal } = openCard();
  modal.schemaSelect("stats");
  const head = () => modal.contentEl.querySelector('[data-target-key="field:status"]');
  const seen = [];
  head().scrollIntoView = (options) => seen.push(["head", options]);
  press(modal, "stats", { key: "J" });
  assert.equal(modal.selectedKey, "field:status");
  assert.ok(seen.some(([part]) => part === "head"), "the heading row scrolls into view");
  const live = announcer(modal);
  assert.ok(live, "a live region announces the jump");
  assert.equal(live.getAttribute("hidden"), null, "the announcer carries no hidden attribute");
  assert.equal(live.getAttribute("aria-live"), "polite");
  modal.close();
});

test("a missing scroller never throws", () => {
  const { modal } = openCard();
  modal.schemaSelect("stats");
  press(modal, "stats", { key: "J" });
  assert.equal(modal.selectedKey, "field:status");
  modal.close();
});

test("reduced motion turns off every bump, including the nudge shake", () => {
  const { modal } = openCard();
  const realMatchMedia = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: true });
  try {
    const row = modal.contentEl.querySelector('[data-target-key="field:section"]');
    const bumps = [];
    row.animate = (frames, options) => { bumps.push({ frames, options }); return {}; };
    modal.schemaSelect("field:section");
    press(modal, "field:section", { key: "J" });
    assert.equal(bumps.length, 0, "no jump bump under reduced motion");
    assert.match(announceText(modal), /No next field/, "the announcement still lands");
    // The nudge clamp shake routes through the same shared helper, so it is
    // gated too: an edge nudge refuses while the helper stays quiet.
    modal.schemaSelect("field:status");
    assert.equal(helpers.schemaCardBump(row, 1, { axis: "x" }), false);
    assert.equal(bumps.length, 0, "no nudge shake under reduced motion");
    press(modal, "field:status", { key: "k", altKey: true });
    assert.equal(modal.schemaArrangeDirty(), false, "an edge nudge snaps back with no draft");
  } finally {
    if (realMatchMedia === undefined) delete globalThis.matchMedia;
    else globalThis.matchMedia = realMatchMedia;
  }
  // Without reduced motion the shared helper animates on both axes.
  const row = modal.contentEl.querySelector('[data-target-key="field:section"]');
  const bumps = [];
  row.animate = (frames, options) => { bumps.push({ frames, options }); return {}; };
  assert.equal(helpers.schemaCardBump(row, -1), true);
  assert.deepEqual(bumps[0].frames, [
    { transform: "translateY(0)" },
    { transform: "translateY(-3px)" },
    { transform: "translateY(0)" },
  ]);
  assert.equal(helpers.schemaCardBump(row, 1, { axis: "x" }), true);
  assert.match(bumps[1].frames[1].transform, /translateX\(3px\)/);
  assert.equal(helpers.schemaCardBump(null, 1), false, "a missing node never throws");
  modal.close();
});
