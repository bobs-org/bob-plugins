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
  parent: "body", parent_kind: "area", owner: "body", root: "body",
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
function region(host, name) {
  return (host.querySelectorAll("[data-schema-region]") || [])
    .find((node) => node.getAttribute("data-schema-region") === name) || null;
}
function openCard(entryOverrides = {}) {
  const entry = album({
    schema_fingerprint: "sha256:shell",
    emoji: "🍽️", label: "Restaurant", noun: "restaurant", plural: "restaurants",
    records: 4, dated_notes: true, index_by: "status",
    fields: [{
      key: "status", label: "Status", kind: "choices", required: true, list: false, line: 12,
      choices: [
        { value: "to_try", label: "🔖 To try", count: 11 },
        { value: "skip", label: "Skip", count: 0 },
      ],
    }],
    ...entryOverrides,
  });
  const { app, plugin, state } = fixture(entry);
  plugin.apiAlbumUpdatePreview = async () => ({ ok: true, report: { ok: true, consequence: "preview", per_op: [] } });
  plugin.apiAlbumUpdateApply = async () => ({ ok: true, report: { ok: true, changed: false } });
  plugin.apiAlbumSubscribe = () => () => {};
  const model = helpers.albumHeaderModel(state.report, "eat.md", {
    sourcePath: "eat.md", metadataCache: app.metadataCache, vault: app.vault,
  });
  const modal = plugin.openAlbumSchemaCard(model, "eat.md").modal;
  return { app, plugin, state, model, modal, entry };
}

test("Schema Card shell paints stable regions, pills, and a hidden empty status rule", () => {
  const { model } = openCard();
  const card = helpers.albumSchemaCardBuildEl(model, { editable: true, selectedKey: "stats", handlers: {} }, makeDoc());
  const names = (card.querySelectorAll("[data-schema-region]") || [])
    .map((node) => node.getAttribute("data-schema-region"));
  assert.deepEqual(names.filter((name) => ["header", "lint", "body", "stage", "status", "hints"].includes(name)).slice(0, 6),
    ["header", "lint", "body", "stage", "status", "hints"]);
  assert.match(helpers.albumSchemaCardTrail(model), /Body/);
  assert.match(region(card, "header").textContent, /🍽️ Restaurant/);
  assert.match(region(card, "header").textContent, /4 restaurants/);
  assert.equal((region(card, "body").querySelectorAll("[data-target-key]") || [])
    .some((node) => node.getAttribute("data-target-key") === "stats"), false);
  const pills = card.querySelectorAll(".bob-album-schema-pill").map((node) => node.textContent);
  assert.ok(pills.includes("required"));
  assert.ok(pills.includes("groups index"));
  assert.equal(card.querySelectorAll(".bob-album-schema-count-pill").map((node) => node.textContent).join(","), "11,0");
  assert.ok(card.querySelectorAll(".bob-album-schema-count-pill").some((node) => node.classList.contains("is-zero")));
  assert.match(card.querySelector(".bob-album-schema-add-choice").textContent, /\+ choice/);
  assert.match(card.querySelector(".bob-album-schema-add-field").textContent, /\+ field/);
  assert.equal(region(card, "status").getAttribute("hidden"), "");
  assert.equal(card.textContent.includes("Preview this edit"), false);
  assert.match(region(card, "hints").textContent, /y YAML/);
  assert.ok(card.querySelector('[data-schema-action="more"]'));
  const hiddenUndo = (card.querySelectorAll("[data-schema-action]") || [])
    .find((node) => node.getAttribute("data-schema-action") === "undo");
  assert.ok(hiddenUndo, "Undo stays queryable inside the hidden All actions list");
});

test("selection and session paints keep body and stage input nodes", async () => {
  const { modal, plugin } = openCard();
  const field = modal.contentEl.querySelector('[data-target-key="field:status"]');
  assert.ok(field);
  modal.schemaSelect("choice:status:to_try");
  assert.equal(modal.contentEl.querySelector('[data-target-key="field:status"]'), field,
    "select paint does not rebuild the field row");
  assert.equal(field.classList.contains("is-selected"), false);
  const choice = modal.contentEl.querySelector('[data-target-key="choice:status:to_try"]');
  assert.equal(choice.getAttribute("aria-current"), "true");

  modal.schemaStage("field", "field:status");
  const input = modal.schemaInput("fieldLabel");
  assert.ok(input);
  input.value = "Status v2";
  input.setSelectionRange(4, 4, "forward");
  input.dispatchEvent({ type: "input" });
  assert.equal(modal.schemaInput("fieldLabel"), input, "typing does not replace the stage input");
  modal.schemaAlbumState(plugin.albumReportState());
  assert.equal(modal.schemaInput("fieldLabel"), input, "report paint keeps the same input node");
  assert.equal(input.selectionStart, 4);
  modal.schemaComposing = true;
  modal.paintSchemaCard("stage");
  assert.equal(modal.schemaInput("fieldLabel"), input, "composition skips stage rebuild");
  modal.schemaComposing = false;
  await pause(350);
  assert.equal(modal.schemaInput("fieldLabel"), input, "preview session paint keeps the input");
  assert.equal(modal.session.getState().canApply, true);
  modal.close();
});

test("Enter latches a pending preview and applies when that revision succeeds", async () => {
  const { modal, plugin } = openCard();
  const previews = [];
  let applies = 0;
  plugin.apiAlbumUpdatePreview = async (_stem, text) => new Promise((resolve) => previews.push({ request: JSON.parse(text), resolve }));
  plugin.apiAlbumUpdateApply = async () => {
    applies += 1;
    return { ok: true, report: { ok: true, changed: false } };
  };
  modal.schemaStage("field", "field:status");
  const input = modal.schemaInput("fieldLabel");
  input.value = "Latched";
  input.dispatchEvent({ type: "input" });
  await pause(300);
  assert.equal(previews.length, 1);
  assert.equal(modal.session.getState().status, "preview-pending");
  input.dispatchEvent({ type: "keydown", key: "Enter", preventDefault() {} });
  await pause(0);
  assert.equal(applies, 0);
  assert.equal(modal.schemaEnterLatch?.revision, modal.session.getState().revision);
  assert.match(modal.contentEl.querySelector(".bob-album-schema-dialog")?.textContent || "",
    /Saving as soon as bob confirms/);
  previews[0].resolve({ ok: true, report: { ok: true, consequence: "label updated", per_op: [] } });
  await pause(20);
  assert.equal(applies, 1, "the latched Enter applies once the current preview succeeds");
  assert.equal(modal.schemaEnterLatch, null);
  modal.close();
});

test("a further edit clears the Enter latch before a stale preview can apply", async () => {
  const { modal, plugin } = openCard();
  const previews = [];
  let applies = 0;
  plugin.apiAlbumUpdatePreview = async (_stem, text) => new Promise((resolve) => previews.push({ request: JSON.parse(text), resolve }));
  plugin.apiAlbumUpdateApply = async () => { applies += 1; return { ok: true, report: { ok: true, changed: false } }; };
  modal.schemaStage("field", "field:status");
  const type = (value) => {
    const input = modal.schemaInput("fieldLabel");
    input.value = value;
    input.dispatchEvent({ type: "input" });
  };
  type("First");
  await pause(300);
  modal.schemaInput("fieldLabel").dispatchEvent({ type: "keydown", key: "Enter", preventDefault() {} });
  const latchedRevision = modal.schemaEnterLatch?.revision;
  type("Second");
  assert.equal(modal.schemaEnterLatch, null, "typing clears the latch");
  previews[0].resolve({ ok: true, report: { ok: true, consequence: "first", per_op: [] } });
  await pause(20);
  assert.equal(applies, 0, "the superseded preview does not apply");
  assert.notEqual(modal.session.getState().revision, latchedRevision);
  modal.close();
});

function emojiApiFixture() {
  const rows = [
    { emoji: "🔖", name: "bookmark", alias: "bookmark", category: "Objects", keywords: ["mark", "saved"] },
    { emoji: "🔍", name: "magnifying glass tilted left", alias: "mag", category: "Objects", keywords: ["search"] },
    { emoji: "🚀", name: "rocket", alias: "rocket", category: "Travel & Places", keywords: ["space"] },
    { emoji: "👩🏽‍💻", name: "woman technologist medium skin tone", alias: "woman_technologist", category: "People & Body", keywords: ["computer"] },
    { emoji: "🇺🇳", name: "flag United Nations", alias: "flag_un", category: "Flags", keywords: ["flag"] },
    { emoji: "1️⃣", name: "keycap 1", alias: "one", category: "Symbols", keywords: ["keycap"] },
    { emoji: "🍕", name: "pizza", alias: "pizza", category: "Food & Drink", keywords: ["slice"] },
  ];
  const remembered = [];
  const calls = { browse: [], search: [], label: [] };
  const api = {
    version: 1,
    search(query, options = {}) {
      calls.search.push(String(query));
      const q = String(query || "").toLowerCase();
      return rows.filter((row) => `${row.name} ${row.alias} ${(row.keywords || []).join(" ")}`.toLowerCase().includes(q)).slice(0, options.limit || 30);
    },
    suggestForLabel(label) {
      calls.label.push(String(label || ""));
      return [rows[0], rows[1], rows[5]];
    },
    categories: () => ["Smileys & Emotion", "People & Body", "Animals & Nature", "Food & Drink", "Travel & Places", "Activities", "Objects", "Symbols", "Flags"],
    browse(category, options = {}) {
      calls.browse.push({ category, options });
      return rows.filter((row) => row.category === category);
    },
    recents: () => [rows[2]],
    remember(value) { remembered.push(value); return true; },
    info(glyph) { return rows.find((row) => row.emoji === glyph) || null; },
  };
  return { api, rows, remembered, calls };
}

test("Emoji Slot preserves graphemes and ports split_icon fixtures", () => {
  const fixtures = [
    ["✅ Done", { emoji: "✅", label: "Done" }],
    ["👩🏽‍💻 Dev", { emoji: "👩🏽‍💻", label: "Dev" }],
    ["🇺🇳 UN", { emoji: "🇺🇳", label: "UN" }],
    ["1️⃣ First", { emoji: "", label: "1️⃣ First" }],
    ["#️⃣ Tag", { emoji: "#️⃣", label: "Tag" }],
    ["🌱Seed", { emoji: "🌱", label: "Seed" }],
    ["★ Star", { emoji: "★", label: "Star" }],
    ["(x) Foo", { emoji: "(", label: "x) Foo" }],
    ["plain label", { emoji: "", label: "plain label" }],
    ["", { emoji: "", label: "" }],
  ];
  for (const [value, expected] of fixtures) assert.deepEqual(helpers.albumSchemaChoiceParts(value), expected, value);
  for (const glyph of ["👩🏽‍💻", "🇺🇳", "1️⃣", "#️⃣"]) {
    assert.deepEqual(helpers.albumEmojiSlotGraphemes(glyph), [glyph]);
    assert.equal(helpers.albumEmojiSlotIsEmojiGrapheme(glyph), true);
  }
  assert.equal(helpers.albumEmojiSlotIsDigitKeycap("1️⃣"), true);
  assert.equal(helpers.albumEmojiSlotIsEmojiGrapheme("rocket"), false);
});

test("Emoji Slot searches, browses, marks sibling duplicates, and Enter picks without saving the stage", () => {
  const { app, modal, plugin } = openCard();
  const fixture = emojiApiFixture();
  app.plugins = { plugins: { "bob-emoji": { api: fixture.api } } };
  let applies = 0;
  plugin.apiAlbumUpdateApply = async () => { applies += 1; return { ok: true, report: { ok: true, changed: false } }; };

  modal.schemaStage("choice-add", "add-choice:status");
  let well = modal.contentEl.querySelector("[data-emoji-well]");
  assert.ok(well, "the live bob-emoji v1 api builds a glyph well");
  well.click();
  let search = modal.contentEl.querySelector(".bob-emoji-slot-search");
  assert.equal(app.document.activeElement, search, "the panel search owns focus");
  assert.equal(modal.contentEl.querySelectorAll(".bob-emoji-slot-section-title")[0]?.textContent, "In your albums");
  assert.ok(modal.contentEl.querySelectorAll(".bob-emoji-slot-option").some((row) => row.querySelector(".bob-emoji-slot-duplicate-dot")),
    "an emoji used by a sibling has a duplicate dot");
  assert.equal(modal.contentEl.querySelectorAll("[data-emoji-category]").length, 9, "the empty query paints all category tabs");

  const food = modal.contentEl.querySelector('[data-emoji-category="Food & Drink"]');
  food.click();
  assert.ok(fixture.calls.browse.some((call) => call.category === "Food & Drink"));
  assert.ok(modal.contentEl.querySelectorAll("[data-emoji-option-index]").some((row) => row.textContent === "🍕pizza"));
  search = modal.contentEl.querySelector(".bob-emoji-slot-search");
  search.value = "rocket";
  search.dispatchEvent({ type: "input" });
  assert.equal(modal.contentEl.querySelectorAll("[data-emoji-option-index]").length, 1, "filter results repaint immediately");
  search.dispatchEvent({
    type: "keydown", key: "Enter",
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; },
  });
  assert.deepEqual(modal.stage, { kind: "choice-add", targetKey: "add-choice:status" }, "picker Enter stays inside the stage");
  assert.equal(modal.schemaStageRead("choiceEmoji"), "🚀");
  assert.ok(fixture.remembered.includes("🚀"), "picks are sent to bob-emoji recents");
  assert.match(modal.contentEl.querySelector(".bob-emoji-slot-preview").textContent, /🚀/);
  assert.equal(applies, 0, "picking never applies the schema stage");
  assert.equal(modal.contentEl.querySelector(".bob-emoji-slot-panel").getAttribute("hidden"), "");

  well = modal.contentEl.querySelector("[data-emoji-well]");
  well.click();
  const tabEvent = { type: "keydown", key: "Tab", preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
  modal.contentEl.querySelector(".bob-emoji-slot-search").dispatchEvent(tabEvent);
  assert.equal(tabEvent.defaultPrevented, undefined, "Tab closes without swallowing normal focus movement");
  assert.equal(modal.contentEl.querySelector(".bob-emoji-slot-panel").getAttribute("hidden"), "");
  modal.close();
});

test("Emoji Slot Escape closes the panel before the stage and direct pasted graphemes stay exact", () => {
  const { app, modal } = openCard();
  const fixture = emojiApiFixture();
  app.plugins = { plugins: { "bob-emoji": { api: fixture.api } } };
  modal.schemaStage("choice", "choice:status:to_try");
  modal.contentEl.querySelector("[data-emoji-well]").click();
  assert.equal(modal.schemaHandleEscape(), "stay");
  assert.ok(modal.stage, "the first Esc leaves the edit stage open");
  assert.equal(modal.contentEl.querySelector(".bob-emoji-slot-panel").getAttribute("hidden"), "");
  assert.equal(modal.schemaHandleEscape(), "stay");
  assert.equal(modal.stage, null, "the next Esc cancels the stage");

  modal.schemaStage("choice", "choice:status:to_try");
  for (const glyph of ["👩🏽‍💻", "🇺🇳", "1️⃣"]) {
    modal.contentEl.querySelector("[data-emoji-well]").click();
    const search = modal.contentEl.querySelector(".bob-emoji-slot-search");
    search.value = glyph;
    search.dispatchEvent({ type: "input" });
    assert.equal(modal.schemaStageRead("choiceEmoji"), glyph, `paste keeps ${glyph} byte-for-byte`);
  }
  assert.match(modal.contentEl.querySelector(".bob-emoji-slot-note").textContent,
    /leading digit keycap as label text/);
  modal.close();
});

test("every field-add initial choice gets an Emoji Slot and missing or v0 apis use the plain input", () => {
  const live = openCard();
  const fixture = emojiApiFixture();
  live.app.plugins = { plugins: { "bob-emoji": { api: fixture.api } } };
  live.modal.schemaStage("field-add", "add-field");
  assert.equal(live.modal.contentEl.querySelectorAll("[data-emoji-well]").length, 1);
  live.modal.schemaStageAddInitialChoice();
  assert.equal(live.modal.contentEl.querySelectorAll("[data-emoji-well]").length, 2,
    "dynamically added initial-choice rows use the shared component too");
  live.modal.close();

  for (const api of [null, { version: 0, search() {} }]) {
    const fallback = openCard();
    if (api) fallback.app.plugins = { plugins: { "bob-emoji": { api } } };
    fallback.modal.schemaStage("choice", "choice:status:to_try");
    const input = fallback.modal.contentEl.querySelector(".bob-emoji-slot-fallback");
    assert.ok(input);
    assert.match(input.getAttribute("placeholder"), /Enable Bob Emoji/);
    input.value = "👩🏽‍💻";
    input.dispatchEvent({ type: "input" });
    assert.equal(fallback.modal.schemaStageRead("choiceEmoji"), "👩🏽‍💻");
    fallback.modal.close();
  }
});

test("Emoji Slot result assembly handles full catalogs under the filter paint budget", () => {
  const catalog = Array.from({ length: 2500 }, (_, index) => ({
    emoji: String.fromCodePoint(0x1F300 + index), name: index % 2 ? "rocket trail" : "planet", alias: `row_${index}`, category: "Objects",
  }));
  const api = {
    categories: () => ["Objects"],
    search: () => catalog,
    suggestForLabel: () => [],
    browse: () => catalog,
    recents: () => [],
  };
  const started = performance.now();
  const result = helpers.albumEmojiSlotResultModel(api, { query: "rocket" });
  const elapsed = performance.now() - started;
  assert.ok(result.rows.length <= helpers.ALBUM_EMOJI_SLOT_RESULT_LIMIT);
  assert.ok(elapsed < 50, `filter model should stay below 50 ms (took ${elapsed.toFixed(2)} ms)`);
  assert.equal(helpers.albumEmojiSlotMoveHighlight(0, "ArrowDown", 40, 8), 8);
});

test("lock wait paints the pending line and Esc stops without closing", () => {
  const { modal } = openCard();
  let stopped = 0;
  const waitingState = {
    status: "applying",
    busy: true,
    canApply: false,
    lockWait: { since: 0, elapsedMs: 42000, attempts: 3, stopping: false },
    lockNotice: null,
    preview: { ok: true, consequence: "add choice", per_op: [] },
    draftOps: [{ op: "choice.add" }],
    refusal: null,
  };
  const stoppedState = {
    status: "preview-ready",
    canApply: true,
    busy: false,
    lockWait: null,
    lockNotice: { message: "Stopped waiting for another Bob vault maintenance run.", hint: "Nothing was written. Press Enter to try again." },
    preview: { ok: true, consequence: "add choice", per_op: [] },
    draftOps: [{ op: "choice.add" }],
    refusal: null,
  };
  modal.session.getState = () => modal.sessionState;
  modal.session.stopWaiting = () => {
    stopped += 1;
    modal.sessionState = stoppedState;
    return modal.sessionState;
  };
  modal.sessionState = waitingState;
  modal.paintSchemaCard("session");
  const status = modal.contentEl.querySelector("[data-schema-region='status']")
    || modal.contentEl.querySelector(".bob-album-schema-status");
  assert.match(status.textContent, /Waiting for another Bob vault maintenance run… 42s/);
  assert.match(status.textContent, /Esc stops waiting/);
  assert.equal(status.classList.contains("is-previewing"), true);
  assert.equal(modal.schemaHandleEscape(), "stay");
  assert.equal(stopped, 1);
  assert.ok(modal.contentEl.querySelector(".bob-album-schema-dialog"), "the card stays open");
  modal.sessionState = {
    ...modal.sessionState,
    status: "preview-ready",
    canApply: true,
    busy: false,
    lockWait: null,
    lockNotice: { message: "Stopped waiting for another Bob vault maintenance run.", hint: "Nothing was written. Press Enter to try again." },
    preview: { ok: true, consequence: "add choice", per_op: [] },
    draftOps: [{ op: "choice.add" }],
  };
  modal.paintSchemaCard("session");
  const notice = modal.contentEl.querySelector(".bob-album-schema-status");
  assert.match(notice.textContent, /Stopped waiting/);
  assert.match(notice.textContent, /Nothing was written/);
  assert.equal(notice.textContent.includes("Preview again"), false);
  const hints = helpers.albumSchemaCardHintItems(modal.schemaModel, {
    editable: true, fresh: true, state: modal.sessionState,
  });
  assert.ok(hints.some((item) => item.action === "apply" && item.enabled !== false));
  const actions = helpers.albumSchemaCardAllActions(modal.schemaModel, {
    fresh: true, state: modal.sessionState,
  });
  assert.equal(actions.some((item) => item.action === "preview"), false);
  modal.close();
});

test("Emoji Slot hint teaches the gesture and follows open, pick, and clear", () => {
  const { app, modal } = openCard();
  const fixture = emojiApiFixture();
  app.plugins = { plugins: { "bob-emoji": { api: fixture.api } } };
  const hintVisible = (root) => {
    const hint = root.querySelector(".bob-emoji-slot-hint");
    return Boolean(hint) && hint.getAttribute("hidden") === null;
  };

  modal.schemaStage("choice-add", "add-choice:status");
  let well = modal.contentEl.querySelector("[data-emoji-well]");
  assert.ok(well, "choice-add builds a glyph well");
  assert.equal(well.getAttribute("title"), "Choose an emoji: click, or Tab here and type to search");
  assert.ok(hintVisible(modal.contentEl), "an empty, enabled, closed slot shows its hint");
  assert.match(modal.contentEl.querySelector(".bob-emoji-slot-hint").textContent, /Tab/);

  well.click();
  assert.equal(hintVisible(modal.contentEl), false, "the hint hides while the panel is open");

  const search = modal.contentEl.querySelector(".bob-emoji-slot-search");
  search.value = "rocket";
  search.dispatchEvent({ type: "input" });
  search.dispatchEvent({
    type: "keydown", key: "Enter",
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() {},
  });
  assert.equal(modal.schemaStageRead("choiceEmoji"), "🚀");
  assert.equal(hintVisible(modal.contentEl), false, "the hint stays hidden after a pick");

  well = modal.contentEl.querySelector("[data-emoji-well]");
  well.click();
  assert.equal(hintVisible(modal.contentEl), false, "a filled slot keeps the hint hidden while open");
  const reopened = modal.contentEl.querySelector(".bob-emoji-slot-search");
  reopened.value = "";
  reopened.dispatchEvent({
    type: "keydown", key: "Backspace",
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() {},
  });
  assert.equal(modal.schemaStageRead("choiceEmoji"), "");
  assert.ok(hintVisible(modal.contentEl), "Backspace clearing the glyph brings the hint back");
  modal.close();

  const filled = openCard();
  filled.app.plugins = { plugins: { "bob-emoji": { api: emojiApiFixture().api } } };
  filled.modal.schemaStage("choice", "choice:status:to_try");
  const filledWell = filled.modal.contentEl.querySelector("[data-emoji-well]");
  assert.ok(filledWell, "the choice edit stage builds a glyph well");
  assert.equal(filledWell.getAttribute("title"), "Choose an emoji: click, or Tab here and type to search");
  assert.equal(hintVisible(filled.modal.contentEl), false, "a pre-filled glyph hides the hint");
  filled.modal.close();
});

test("every field-add initial choice shows the hint until its glyph is set", () => {
  const live = openCard();
  live.app.plugins = { plugins: { "bob-emoji": { api: emojiApiFixture().api } } };
  live.modal.schemaStage("field-add", "add-field");
  const hints = () => live.modal.contentEl.querySelectorAll(".bob-emoji-slot-hint")
    .filter((node) => node.getAttribute("hidden") === null);
  assert.equal(hints().length, 1, "the first initial choice shows its hint");
  live.modal.schemaStageAddInitialChoice();
  assert.equal(hints().length, 2, "a dynamically added initial choice shows its hint too");
  live.modal.close();
});
