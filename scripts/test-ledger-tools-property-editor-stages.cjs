// Property Editor typed stages: wire-safe operations, date/time parsing,
// collection preservation, retained preview Enter, stale draft guards, and
// S16 prose completion wiring.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin { constructor(app) { this.app = app; } }
const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownView: class {}, Notice: class {}, Platform: { isDesktopApp: true },
    Plugin: TestPlugin, normalizePath: (value) => value, parseYaml: (text) => JSON.parse(text),
  };
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value } };
  if (request === "@codemirror/view") return {
    EditorView: { updateListener: { of: (listener) => ({ listener }) } }, keymap: { of: (value) => value },
  };
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
Module._load = originalLoad;
const H = LedgerToolsPlugin.helpers;

function row(overrides = {}) {
  return {
    key: "title", line: 3, end_line: 3, value: "old", kind: "text", role: "loose",
    owner: "props", editor: null, reason: null, duplicate: false, opaque: false,
    ...overrides,
  };
}

function report(properties = [row()], fingerprint = "before") {
  return {
    schema_version: 1, ok: true, path: "notes/groceries.md", note_kind: "note",
    capabilities: ["props_v1"], fingerprint,
    frontmatter: { state: "ok", start_line: 1, end_line: 5 }, properties,
  };
}

function mockInput(kind, id, value) {
  return {
    value,
    selectionStart: String(value).length,
    selectionEnd: String(value).length,
    getAttribute(name) {
      if (name === "data-property-stage-kind") return kind;
      if (name === "data-property-stage-id") return String(id);
      return null;
    },
  };
}

function fakeSession() {
  const session = {
    state: { status: "browsing", draftOps: [], canApply: false, expect: "before" },
    applied: [],
    setDraft(ops) {
      this.state = { ...this.state, status: ops.length ? "preview-pending" : "browsing", draftOps: ops.slice(), canApply: false, refusal: null };
      return this.state;
    },
    getState() { return this.state; },
    rebase(expect) { this.state = { ...this.state, expect, status: this.state.draftOps.length ? "draft" : "browsing", canApply: false }; return this.state; },
    async apply() {
      this.applied.push(this.state.draftOps.slice());
      return {
        ok: true, changed: true,
        report: { ok: true, changed: true, fingerprint_after: "after", properties: [row({ value: "new" })] },
      };
    },
    close() {},
  };
  return session;
}

function fakeDom() {
  class Element {
    constructor(tag, doc) {
      this.tagName = tag.toUpperCase();
      this.ownerDocument = doc;
      this.parentNode = null;
      this.children = [];
      this.attrs = new Map();
      this.value = "";
      this.disabled = false;
      this.selectionStart = 0;
      this.selectionEnd = 0;
      this._text = "";
    }
    setAttribute(name, value) { this.attrs.set(name, String(value)); }
    getAttribute(name) { return this.attrs.get(name) ?? null; }
    appendChild(node) {
      if (node.parentNode) node.parentNode.removeChild(node);
      node.parentNode = this;
      this.children.push(node);
      return node;
    }
    removeChild(node) {
      const index = this.children.indexOf(node);
      if (index >= 0) this.children.splice(index, 1);
      node.parentNode = null;
      return node;
    }
    get firstChild() { return this.children[0] || null; }
    set textContent(value) { this._text = String(value); }
    get textContent() { return this._text || this.children.map((child) => child.textContent).join(""); }
    focus() { this.ownerDocument.activeElement = this; }
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  }
  const doc = { activeElement: null, createElement(tag) { return new Element(tag, this); } };
  return { doc, Element };
}

test("stage selection uses only supported props kinds and loose rows", () => {
  for (const [kind, expected] of [["text", "text"], ["null", "text"], ["number", "number"], ["date", "date"], ["datetime", "datetime"], ["list", "list"], ["tags", "tags"], ["aliases", "aliases"]]) {
    assert.equal(H.propertyEditorStageKindForRow(row({ kind })), expected);
  }
  for (const kind of ["map", "opaque", "url", "link", "suggest", "checkbox", "mystery"]) {
    assert.equal(H.propertyEditorStageKindForRow(row({ kind })), null, kind);
  }
  assert.equal(H.propertyEditorStageKindForRow(row({ role: "identity" })), null);
  assert.equal(H.propertyEditorStageKindForRow(row({ pending: true })), null);
  assert.deepEqual([...H.PROPERTY_EDITOR_STAGE_WIRE_KINDS].sort(), ["aliases", "date", "datetime", "list", "number", "tags", "text"]);
});

test("text and number stages preserve empty strings, null, zero, and finite numbers", () => {
  const empty = H.propertyEditorStageBuild(row({ value: null, kind: "null" }), { kind: "text", wireKind: "text" }, { value: "" });
  assert.deepEqual(empty.ops, []);
  assert.equal(empty.changed, false, "an untouched null stage is a no-op; null stays null");
  assert.equal(H.propertyEditorStageBuild(row({ value: "" }), { kind: "text", wireKind: "text" }, { value: "" }).changed, false);
  const zero = H.propertyEditorStageBuild(row({ key: "count", value: 1, kind: "number" }), { kind: "number", wireKind: "number" }, { value: "0" });
  assert.deepEqual(zero.ops, [{ op: "prop.set", key: "count", value: 0, kind: "number" }]);
  for (const value of ["", "1,2", "Infinity", "NaN", "12px"]) {
    assert.equal(H.propertyEditorParseNumber(value).ok, false, value);
  }
  assert.equal(H.propertyEditorParseNumber("-1.25e2").value, -125);
});

test("date and datetime stages resolve local tokens, preserve explicit offsets, and reject DST ambiguity", () => {
  const now = new Date("2026-03-08T12:00:00.000Z");
  const opts = { now, timeZone: "America/New_York" };
  assert.equal(H.propertyEditorDateValue("-3d", opts).value, "2026-03-05");
  assert.equal(H.propertyEditorDateValue("fri", { now: new Date("2026-11-17T17:00:00Z"), timeZone: "America/New_York" }).value, "2026-11-20");
  assert.equal(H.propertyEditorDateValue("2026-02-30", opts).ok, false);
  assert.equal(H.propertyEditorDateTimeValue("now", opts).value, "2026-03-08T08:00:00");
  assert.equal(H.propertyEditorDateTimeValue("9:41pm", opts).value, "2026-03-08T21:41:00");
  assert.equal(H.propertyEditorDateTimeValue("2026-11-01T01:30:00-04:00", opts).value, "2026-11-01T01:30:00-04:00");
  assert.equal(H.propertyEditorDateTimeValue("2026-03-08T02:30", opts).ok, false, "DST gap is rejected");
  assert.equal(H.propertyEditorDateTimeValue("2026-11-01T01:30", opts).ok, false, "DST overlap is rejected");
  assert.equal(H.propertyEditorDateTimeValue("2026-11-17", {
    ...opts, existingValue: "2026-11-16 09:41:00 -0500",
  }).value, "2026-11-17T09:41:00-0500", "day-only input keeps existing time and offset");
  for (const invalid of ["", "02/03/2026", "2026-02-30T08:00", "tomorrow-ish"]) {
    assert.equal(H.propertyEditorDateTimeValue(invalid, opts).ok, false, invalid);
  }
});

test("lists keep their shape and values; tags omit #; aliases stay ordered", () => {
  const stage = (kind) => ({ kind, wireKind: kind });
  assert.equal(H.propertyEditorStageBuild(row({ kind: "list", value: "one" }), stage("list"), { items: ["one"] }).ok, false);
  const list = H.propertyEditorStageBuild(row({ key: "items", kind: "list", value: [1, false] }), stage("list"), { items: [1, false], itemDraft: "three" });
  assert.deepEqual(list.ops, [{ op: "prop.set", key: "items", value: [1, false, "three"], kind: "list" }]);
  const empty = H.propertyEditorStageBuild(row({ key: "tags", kind: "tags", value: ["old"] }), stage("tags"), { items: [], itemDraft: "" });
  assert.deepEqual(empty.ops[0], { op: "prop.set", key: "tags", value: [], kind: "tags" }, "empty collection stays an empty collection");
  const tags = H.propertyEditorStageBuild(row({ key: "tags", kind: "tags", value: ["home"] }), stage("tags"), { items: ["home"], itemDraft: "##work" });
  assert.deepEqual(tags.ops[0].value, ["home", "work"]);
  const aliases = H.propertyEditorStageBuild(row({ key: "aliases", kind: "aliases", value: ["one", "two"] }), stage("aliases"), { items: ["one", "two"], itemDraft: "three" });
  assert.deepEqual(aliases.ops[0].value, ["one", "two", "three"]);
  assert.equal(H.propertyEditorNormalizeTag("###work"), "work");
});

test("suggestions read same-key vault values and vault tags in ranked order", () => {
  const files = [{ path: "a.md" }, { path: "b.md" }, { path: "c.md" }];
  const frontmatter = new Map([["a.md", { city: "Clark" }], ["b.md", { city: "Cranford" }], ["c.md", { city: "Clark" }]]);
  const app = {
    vault: { getMarkdownFiles: () => files },
    metadataCache: {
      getFileCache: (file) => ({ frontmatter: frontmatter.get(file.path) }),
      getTags: () => ({ "#work": 2, "#home": 8 }),
    },
  };
  assert.deepEqual(H.propertyEditorSuggestValues(app, "city", "a.md"), [{ value: "Clark", count: 1 }, { value: "Cranford", count: 1 }]);
  assert.deepEqual(H.propertyEditorTagSuggestions(app), [{ value: "home", count: 8 }, { value: "work", count: 2 }]);
});

test("stage painter retains the focused input, caret, and prose band across preview paints", () => {
  const { doc } = fakeDom();
  const firstHost = doc.createElement("div");
  const modal = { propertyEditorStageAddItem() {} };
  const options = {
    stageId: 7, key: "title", kind: "text", label: "Text", value: "hello",
    items: [], collection: false, suggestions: [], disabled: false,
    composing: false, prose: true, previewText: "Checking value…",
  };
  const first = H.propertyEditorPaintStage(doc, firstHost, options, modal);
  assert.equal(first.input.tagName, "TEXTAREA");
  assert.ok(first.band);
  first.input.focus();
  first.input.setSelectionRange(2, 4);
  const secondHost = doc.createElement("div");
  const second = H.propertyEditorPaintStage(doc, secondHost, {
    ...options, value: "hello!", composing: true,
    keptInput: first.input, keptBand: first.band,
  }, modal);
  assert.strictEqual(second.input, first.input);
  assert.strictEqual(second.band, first.band);
  assert.equal(second.input.value, "hello", "composition text is not overwritten by a stale draft");
  assert.deepEqual([second.input.selectionStart, second.input.selectionEnd], [2, 4]);
});

test("Enter latches to the exact preview and an edit invalidates the latch", async () => {
  const modal = new H.PropertyEditorModal({}, { filePath: "notes/groceries.md", report: report() });
  const session = fakeSession();
  modal.session = session;
  modal.editorEnsureSession = () => session;
  assert.equal(modal.propertyEditorOpenStage(modal.editorSelected()), true);
  const input = mockInput("text", modal.stage.id, "new");
  modal.propertyEditorStageInputChanged(input);
  await modal.propertyEditorSaveStage();
  assert.ok(modal.pendingStageEnter);
  session.state = { ...session.state, status: "preview-ready", canApply: true };
  modal.propertyEditorStageSyncPreview();
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  assert.equal(session.applied.length, 1);
  assert.deepEqual(session.applied[0], [{ op: "prop.set", key: "title", value: "new", kind: "text" }]);
  assert.equal(modal.stage, null);
  assert.equal(modal.status.kind, "saved");

  const second = new H.PropertyEditorModal({}, { filePath: "notes/groceries.md", report: report() });
  const secondSession = fakeSession();
  second.session = secondSession;
  second.editorEnsureSession = () => secondSession;
  second.propertyEditorOpenStage(second.editorSelected());
  second.propertyEditorStageInputChanged(mockInput("text", second.stage.id, "draft"));
  await second.propertyEditorSaveStage();
  assert.ok(second.pendingStageEnter);
  second.propertyEditorStageInputChanged(mockInput("text", second.stage.id, "changed"));
  assert.equal(second.pendingStageEnter, null);
  secondSession.state = { ...secondSession.state, status: "preview-ready", canApply: true };
  second.propertyEditorStageSyncPreview();
  assert.equal(secondSession.applied.length, 0);
});

test("selection and stale reports keep drafts but invalidate pending Enter", async () => {
  const modal = new H.PropertyEditorModal({}, { filePath: "notes/groceries.md", report: report([row(), row({ key: "other", line: 4 })]) });
  const session = fakeSession();
  modal.session = session;
  modal.editorEnsureSession = () => session;
  modal.propertyEditorOpenStage(modal.editorSelected());
  modal.propertyEditorStageInputChanged(mockInput("text", modal.stage.id, "draft"));
  await modal.propertyEditorSaveStage();
  const id = modal.stage.id;
  modal.propertyEditorReconcile(report([row({ line: 6 }), row({ key: "other", line: 7 })], "changed"));
  assert.equal(modal.stage.id, id);
  assert.equal(modal.stageNeedsPreview, true);
  assert.equal(modal.pendingStageEnter, null);
  assert.equal(modal.propertyEditorBuildCurrentStage().ops[0].value, "draft");
  modal.propertyEditorSelect("other::7");
  assert.equal(modal.stage, null);
  assert.equal(modal.pendingStageEnter, null);
});

test("S16 uses the shared proseField API with the note as source and no task subjects", () => {
  let attachOptions = null;
  let detached = false;
  const app = { plugins: { plugins: { "bob-navigation-hotkeys": { api: { proseField: {
    version: 1,
    attach(options) {
      attachOptions = options;
      return { handleKeydown: () => false, backOut: () => true, detach: () => { detached = true; }, rebind() {}, isLinkOpen: () => false };
    },
  } } } } } };
  const input = { getAttribute: (name) => name === "data-property-stage-id" ? "1" : "property-stage-1" };
  const band = {};
  const panel = { querySelector: (selector) => selector.includes("input") ? input : band };
  const modal = new H.PropertyEditorModal(app, { filePath: "notes/groceries.md", report: report() });
  modal.stage = { id: 1, rowId: "title::3", key: "title", kind: "text", wireKind: "text", value: "old", items: [], itemDraft: "" };
  modal.contentEl = { querySelector: () => panel };
  modal.propertyEditorSyncProseField();
  assert.equal(attachOptions.sourcePath(), "notes/groceries.md");
  assert.equal(attachOptions.mode, "inline");
  assert.equal(attachOptions.links, true);
  assert.equal(attachOptions.tasks, true);
  assert.equal("subjects" in attachOptions, false);
  assert.equal(modal.propertyEditorProseBackOut({}), true);
  modal.propertyEditorDetachProseField();
  assert.equal(detached, true);
});
