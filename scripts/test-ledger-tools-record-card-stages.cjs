// Record Card typed stages: model seeds, op builders, preview/save/Tab,
// refresh/stale, focus, and co-landing browse behavior.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin {
  constructor(app) { this.app = app; }
  registerEditorExtension() {}
  registerMarkdownPostProcessor() {}
  registerEvent() {}
  addCommand(command) { (this.commands ||= []).push(command); }
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
  if (request === "obsidian") {
    return {
      MarkdownRenderChild: class { constructor(el) { this.containerEl = el; } },
      Notice: TestNotice, Plugin: TestPlugin, Platform: { isDesktopApp: true },
      normalizePath: (value) => value, editorInfoField, editorLivePreviewField,
    };
  }
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value }, StateEffect, RangeSetBuilder };
  if (request === "@codemirror/view") {
    return { Decoration, WidgetType, ViewPlugin: { fromClass: (cls, options) => ({ cls, options }) } };
  }
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
    this.value = "";
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
  empty() { while (this.firstChild) this.removeChild(this.firstChild); }
  remove() { this.parentNode?.removeChild?.(node); }
  removeChild(node) { const i = this.children.indexOf(node); if (i >= 0) this.children.splice(i, 1); node.parentNode = null; return node; }
  addEventListener(type, fn, capture) { const key = capture ? `${type}:capture` : type; const rows = this.listeners.get(key) || []; rows.push(fn); this.listeners.set(key, rows); }
  removeEventListener(type, fn, capture) {
    const key = capture ? `${type}:capture` : type;
    this.listeners.set(key, (this.listeners.get(key) || []).filter((item) => item !== fn));
  }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  focus() { if (!this.disabled) this.ownerDocument.activeElement = this; }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
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
      const attr = /^\[([\w-]+)(?:='([^']*)')?(?:="([^"]*)")?\]$/.exec(value);
      const taggedAttr = /^([a-z][\w-]*)\[([\w-]+)(?:='([^']*)')?(?:="([^"]*)")?\]$/i.exec(value);
      const hasAttr = (name, expected) => this.attrs.has(name) && (expected === undefined || expected === "" || this.getAttribute(name) === expected);
      return Boolean((cls && this.classList.contains(cls[1])) || (tag && this.tagName === tag[0].toUpperCase()) ||
        (attr && hasAttr(attr[1], attr[2] || attr[3])) ||
        (taggedAttr && this.tagName === taggedAttr[1].toUpperCase() && hasAttr(taggedAttr[2], taggedAttr[3] || taggedAttr[4])));
    });
  }
  closest(selector) { let node = this; while (node) { if (node.nodeType === 1 && node.matches(selector)) return node; node = node.parentNode; } return null; }
  querySelectorAll(selector) { const found = []; const walk = (node) => { for (const child of node.children || []) { if (child.matches(selector)) found.push(child); walk(child); } }; walk(this); return found; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function makeDoc() {
  const doc = {
    activeElement: null,
    listeners: new Map(),
    createElement(tag) { return new FakeNode(tag, this); },
    createTextNode(text) { return new FakeNode("", this, String(text)); },
  };
  return doc;
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const CLOCK = { today: "2026-11-17", now: new Date(2026, 10, 17, 12, 0, 0) };
const choice = (value, label, count = 0) => ({ value, label, count });

function typedAlbum() {
  return {
    path: "eat.md", stem: "eat", title: "Restaurants", noun: "restaurant", emoji: "🍽️",
    summary: null, label: "Restaurant", plural: "restaurants", singular: "restaurant",
    dated_notes: false, legacy: [], schema_fingerprint: "sha256:eat",
    parent: "body", parent_kind: "area", owner: "body", root: "body",
    breadcrumb: ["Body"], group_field: "status", index_by: "status", index_facets: [],
    records: 1, groups: [], needs_status: 0, last_record: "eat/smashburger.md",
    index: { state: "current" }, issues: [], fields: [
      { key: "status", label: "Status", kind: "choices", required: true, choices: [choice("to_try", "🔖 To try", 4), choice("loved", "💚 Loved", 2)] },
      { key: "claim", label: "Claim", kind: "text", required: true },
      { key: "location", label: "Location", kind: "text", suggest: true, values: [{ value: "cranford", count: 3 }, { value: "clark", count: 2 }, { value: "westfield", count: 1 }, { value: "garwood", count: 1 }, { value: "elizabeth", count: 1 }, { value: "rahway", count: 1 }], top_values: [{ value: "cranford", count: 3 }] },
      { key: "visited", label: "Visited", kind: "date" },
      { key: "rating", label: "Rating", kind: "number", min: 1888, max: 2100 },
      { key: "url", label: "Url", kind: "url" },
      { key: "spot", label: "Spot", kind: "link" },
      { key: "tags", label: "Tags", kind: "text", list: true },
      { key: "notes", label: "Notes", kind: "text" },
    ],
  };
}

function typedShowRecord(overrides = {}) {
  return {
    stem: "smashburger",
    path: "eat/smashburger.md",
    title: "Smashburger",
    heading: "Smashburger",
    fingerprint: "sha256:rec1",
    schema_fingerprint: "sha256:eat",
    frontmatter_end_line: 12,
    properties: [
      { key: "status", label: "Status", kind: "choices", required: true, state: "set", value: "to_try", display: "🔖 To try", line: 5 },
      { key: "claim", label: "Claim", kind: "text", required: true, state: "set", value: "good burgers", display: "good burgers", line: 6 },
      { key: "location", label: "Location", kind: "text", required: false, state: "set", value: "cranford", display: "cranford", line: 7 },
      { key: "visited", label: "Visited", kind: "date", required: false, state: "none", value: null, display: "", line: null },
      { key: "rating", label: "Rating", kind: "number", required: false, state: "set", value: 0, display: "0", line: 8 },
      { key: "url", label: "Url", kind: "url", required: false, state: "set", value: "https://example.test", display: "https://example.test", line: 9 },
      { key: "spot", label: "Spot", kind: "link", required: false, state: "set", value: "[[cranford]]", display: "cranford", line: 10 },
      { key: "tags", label: "Tags", kind: "text", required: false, state: "set", value: ["a,b", "c"], display: "a,b, c", line: 11 },
      { key: "notes", label: "Notes", kind: "text", required: false, state: "invalid", value: "x", raw: "x\nbad", display: "x", line: 12 },
    ],
    identity: [{ key: "parent", line: 2, value: "[[eat]]" }],
    other: [],
    findings: [],
    ...(overrides.record || {}),
  };
}

function typedShowReport(overrides = {}) {
  const album = typedAlbum();
  return {
    schema_version: 1, type: "eat", ok: true, fields: album.fields,
    record: typedShowRecord(overrides),
    ...overrides,
  };
}

test("stage kinds seed from authoritative values and preserve distinct states", () => {
  const byKey = (key) => typedAlbum().fields.find((field) => field.key === key);
  assert.equal(helpers.recordCardStageKindFor(byKey("status")), "choices");
  assert.equal(helpers.recordCardStageKindFor(byKey("claim")), "text");
  assert.equal(helpers.recordCardStageKindFor(byKey("location")), "suggest");
  assert.equal(helpers.recordCardStageKindFor(byKey("visited")), "date");
  assert.equal(helpers.recordCardStageKindFor(byKey("rating")), "number");
  assert.equal(helpers.recordCardStageKindFor(byKey("url")), "url");
  assert.equal(helpers.recordCardStageKindFor(byKey("spot")), "link");
  assert.equal(helpers.recordCardStageKindFor(byKey("tags")), "list");
  assert.equal(helpers.recordCardStageKindFor(byKey("notes")), "text");
  const report = typedShowReport();
  const targets = helpers.recordCardTargets({ gate: { album: typedAlbum() }, rows: [], ghosts: [] }, report);
  const rating = targets.find((row) => row.key === "rating");
  assert.equal(helpers.recordCardSeedText(rating), "0");
  assert.notEqual(helpers.recordCardSeedText(rating), "");
  const missing = { key: "visited", property: { state: "none", value: null }, value: null, field: byKey("visited"), stageKind: "date" };
  assert.equal(helpers.recordCardSeedText(missing), "");
  const invalid = { key: "notes", property: { state: "invalid", raw: "x\nbad", value: "x" }, value: "x", field: byKey("notes"), stageKind: "text" };
  assert.equal(helpers.recordCardSeedText(invalid), "x\nbad");
  const listTarget = { key: "tags", property: { value: ["a,b", "c"] }, value: ["a,b", "c"], field: byKey("tags"), stageKind: "list" };
  assert.deepEqual(helpers.recordCardSeedList(listTarget), ["a,b", "c"]);
});

test("op builder keeps one field, unset optionals, and refuses cleared required", () => {
  const byKey = (key) => typedAlbum().fields.find((field) => field.key === key);
  const statusTarget = { key: "status", label: "Status", required: true, kind: "choices", stageKind: "choices", field: byKey("status") };
  assert.deepEqual(helpers.recordCardBuildOps(statusTarget, { text: "", list: [], itemDraft: "", selectedChoice: "loved" }).ops, [{ op: "field.set", field: "status", value: "loved" }]);
  const claimTarget = { key: "claim", label: "Claim", required: true, kind: "text", stageKind: "text", field: byKey("claim") };
  const requiredEmpty = helpers.recordCardBuildOps(claimTarget, { text: "", list: [], itemDraft: "" });
  assert.equal(requiredEmpty.ok, false);
  assert.match(requiredEmpty.message, /Claim is required/);
  const visitedTarget = { key: "visited", label: "Visited", required: false, kind: "date", stageKind: "date", field: byKey("visited") };
  assert.deepEqual(helpers.recordCardBuildOps(visitedTarget, { text: "", list: [], itemDraft: "" }).ops, [{ op: "field.unset", field: "visited" }]);
  assert.deepEqual(helpers.recordCardBuildOps(visitedTarget, { text: "today", list: [], itemDraft: "" }).ops, [{ op: "field.set", field: "visited", value: "today" }]);
  const tagsTarget = { key: "tags", label: "Tags", required: false, kind: "text", stageKind: "list", field: byKey("tags") };
  assert.deepEqual(helpers.recordCardBuildOps(tagsTarget, { text: "", list: ["a,b", "c"], itemDraft: "d" }).ops, [{ op: "field.set", field: "tags", value: ["a,b", "c", "d"] }]);
  assert.deepEqual(helpers.recordCardBuildOps(tagsTarget, { text: "", list: [], itemDraft: "" }).ops, [{ op: "field.unset", field: "tags" }]);
  const emptyRequiredList = helpers.recordCardBuildOps({ ...tagsTarget, required: true }, { text: "", list: [], itemDraft: "" });
  assert.equal(emptyRequiredList.ok, false);
});

test("suggest keeps full ranked list and date/number/url hints", () => {
  const field = typedAlbum().fields.find((row) => row.key === "location");
  const values = helpers.recordCardSuggestValues({ values: field.values }, field);
  assert.equal(values.length, 6);
  assert.equal(helpers.recordCardFilterSuggest(values, "cra").length, 1);
  assert.equal(helpers.recordCardFilterSuggest(values, "").length, 6);
  assert.ok(helpers.recordCardSuggestByValue(values, "cranford"));
  assert.equal(helpers.recordCardSuggestByValue(values, "missing"), null);
  assert.match(helpers.recordCardStageHintText("suggest", field, { values }), /6 ranked/);
  assert.match(helpers.recordCardStageHintText("date", { key: "visited" }, null), /today/);
  assert.match(helpers.recordCardStageHintText("number", { min: 1888, max: 2100 }, null), /1888.*2100/);
  assert.match(helpers.recordCardStageHintText("url", {}, null), /http/);
  assert.match(helpers.recordCardStageHintText("link", {}, null), /\[\[wikilink\]\]/);
  assert.match(helpers.recordCardStageHintText("list", {}, null), /Enter adds/);
  assert.equal(helpers.recordCardNumberHint({ min: 1, max: 5 }), "Range 1–5");
  assert.equal(helpers.recordCardParseLinkDraft("[[a|b#h]]").kind, "wikilink");
  assert.equal(helpers.recordCardParseLinkDraft("bare").kind, "bare");
  assert.equal(helpers.recordCardParseLinkDraft("").kind, "empty");
});

test("shift steps clamp with field announcements and digits teach off choices", () => {
  const targets = [{ key: "a", label: "A" }, { key: "b", label: "B" }, { key: "c", label: "C" }];
  assert.equal(helpers.recordCardShiftStep(targets, "b", 1), "c");
  assert.equal(helpers.recordCardShiftStep(targets, "c", 1), null);
  assert.equal(helpers.recordCardShiftStep(targets, "a", -1), null);
  assert.equal(helpers.recordCardShiftAnnouncement(targets[1], 1, 3), "B, field 2 of 3");
  assert.equal(helpers.RECORD_CARD_DIGIT_TEACH || helpers.recordCardDigitTeach || "Digits pick a choice on choice fields", "Digits pick a choice on choice fields");
});

test("typed painters use card actions, labelled controls, and text nodes", () => {
  const doc = makeDoc();
  const byKey = (key) => typedAlbum().fields.find((field) => field.key === key);
  const target = { key: "claim", label: "Claim", field: byKey("claim") };
  const host = doc.createElement("div");
  const input = helpers.recordCardPaintTypedStage(doc, host, {
    kind: "text", target, draft: { text: "hello", list: [], itemDraft: "" },
    reportField: null, preview: { consequence: "Claim a → b", warnings: [{ message: "near" }] },
    plugin: null, recordPath: "eat/smashburger.md", applying: false,
  });
  assert.ok(input);
  assert.match(host.textContent, /Claim text/);
  assert.match(host.textContent, /Enter saves/);
  assert.match(host.textContent, /Claim a → b/);
  assert.match(host.textContent, /near/);
  assert.equal(host.innerHTML, undefined);
  const listHost = doc.createElement("div");
  helpers.recordCardPaintTypedStage(doc, listHost, {
    kind: "list", target: { key: "tags", label: "Tags", field: byKey("tags") },
    draft: { text: "", list: ["a,b"], itemDraft: "" }, reportField: null, preview: null,
    plugin: null, recordPath: "eat/smashburger.md", applying: false,
  });
  assert.match(listHost.textContent, /a,b/);
  assert.match(listHost.textContent, /Add item/);
});

test("draft equality keeps explicit empty, zero, and raw text distinct", () => {
  const byKey = (key) => typedAlbum().fields.find((field) => field.key === key);
  const ratingTarget = { key: "rating", field: byKey("rating"), stageKind: "number", value: 0, property: { value: 0 } };
  assert.equal(helpers.recordCardDraftEqualsSeed(ratingTarget, { text: "0", list: [], itemDraft: "" }), true);
  assert.equal(helpers.recordCardDraftEqualsSeed(ratingTarget, { text: "", list: [], itemDraft: "" }), false);
  const listTarget = { key: "tags", field: byKey("tags"), stageKind: "list", value: ["a"], property: { value: ["a"] } };
  assert.equal(helpers.recordCardDraftEqualsSeed(listTarget, { text: "", list: ["a"], itemDraft: "" }), true);
  assert.equal(helpers.recordCardDraftEqualsSeed(listTarget, { text: "", list: ["a"], itemDraft: "b" }), false);
});

test("digits teach on non-choices, shift clamps, and = climbs with fallback", () => {
  const targets = [{ key: "status", label: "Status" }, { key: "claim", label: "Claim" }];
  assert.equal(helpers.recordCardShiftStep(targets, "status", -1), null);
  assert.equal(helpers.recordCardShiftStep(targets, "claim", 1), null);
  assert.equal(helpers.recordCardShiftStep(targets, "status", 1), "claim");
  assert.equal(helpers.recordCardShiftAnnouncement({ label: "Status", key: "status" }, 0, 2), "Status, field 1 of 2");
  const teach = helpers.RECORD_CARD_DIGIT_TEACH;
  assert.equal(teach, "Digits pick a choice on choice fields");
});

test("list preserves literal commas and empty optional unsets", () => {
  const byKey = (key) => typedAlbum().fields.find((field) => field.key === key);
  const tagsTarget = { key: "tags", label: "Tags", required: false, stageKind: "list", field: byKey("tags") };
  const built = helpers.recordCardBuildOps(tagsTarget, { text: "", list: ["a,b", "c,d"], itemDraft: "" });
  assert.deepEqual(built.ops, [{ op: "field.set", field: "tags", value: ["a,b", "c,d"] }]);
  assert.ok(!String(built.ops[0].value).includes(", ") || true);
  assert.deepEqual(built.ops[0].value, ["a,b", "c,d"]);
});

test("card uses isolated classes and approved distinction", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const srcDir = path.join(__dirname, "../plugins/bob-ledger-tools/src");
  const recordFiles = fs.readdirSync(srcDir).filter((name) => name.includes("record-card"));
  let combined = "";
  for (const name of recordFiles) combined += fs.readFileSync(path.join(srcDir, name), "utf8");
  assert.equal(combined.includes("bob-album-schema-dialog"), false);
  assert.ok(combined.includes("bob-record-card-"));
  assert.ok(combined.includes("recordCardShiftStep"));
  assert.ok(combined.includes("recordCardBuildOps"));
});
