// Property editor add-flow: positioned insertion, vault name/type/count
// completion, Shift+Enter literal names, and atomic create/undo (bob-cli-pf.4.1.4).
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

function report(properties, fingerprint = "before") {
  return {
    schema_version: 1, ok: true, path: "notes/plain.md", note_kind: "note",
    capabilities: ["props_v1"], fingerprint,
    frontmatter: { state: "ok", start_line: 1, end_line: properties.length ? 5 : 2 },
    properties,
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

function fakeSession(options = {}) {
  const session = {
    state: { status: "browsing", draftOps: [], canApply: false, expect: options.expect || "before" },
    applied: [],
    undone: 0,
    redone: 0,
    setDraft(ops) {
      this.state = {
        ...this.state,
        status: ops.length ? "preview-pending" : "browsing",
        draftOps: ops.slice(),
        canApply: false,
        refusal: null,
      };
      return this.state;
    },
    getState() { return this.state; },
    rebase(expect) {
      this.state = { ...this.state, expect, status: this.state.draftOps.length ? "draft" : "browsing", canApply: false };
      return this.state;
    },
    async apply() {
      const ops = this.state.draftOps.slice();
      if (typeof options.onApply === "function") {
        const refusal = options.onApply(ops);
        if (refusal) return refusal;
      }
      this.applied.push(ops);
      const created = ops[0] && ops[0].key
        ? row({ key: ops[0].key, value: ops[0].value, kind: ops[0].kind || "text", line: 8 })
        : row({ value: "new" });
      return {
        ok: true, changed: true,
        report: {
          ok: true, changed: true, fingerprint_after: "after",
          inverse_ops: options.inverseOps || [{ op: "prop.unset", key: created.key }],
          properties: [...(options.existing || []), created],
        },
      };
    },
    async applyOps(ops) {
      this.state.draftOps = ops.slice();
      return this.apply();
    },
    async undo() {
      this.undone += 1;
      return {
        ok: true, changed: true,
        report: { ok: true, changed: true, fingerprint_after: "before", properties: options.existing || [] },
      };
    },
    async redo() {
      this.redone += 1;
      return this.apply();
    },
    close() {},
  };
  return session;
}

function infosApp() {
  return {
    metadataCache: {
      getAllPropertyInfos() {
        return {
          tags: { name: "tags", type: "tags", count: 12 },
          cssclasses: { name: "cssclasses", type: "multitext", count: 4 },
          aliases: { name: "aliases", type: "aliases", count: 3 },
          url: { name: "url", type: "url", count: 2 },
          count: { name: "count", type: "number", count: 5 },
          done: { name: "done", type: "checkbox", count: 1 },
        };
      },
      getFileCache() { return { frontmatter: { stray: "nope" } }; },
    },
    vault: { getMarkdownFiles() { return [{ path: "other.md" }]; } },
  };
}

function cacheOnlyApp() {
  return {
    metadataCache: {
      getFileCache(file) {
        if (file.path === "a.md") return { frontmatter: { city: "Clark", extra: 1 } };
        if (file.path === "b.md") return { frontmatter: { city: "Cranford" } };
        return {};
      },
    },
    vault: { getMarkdownFiles() { return [{ path: "a.md" }, { path: "b.md" }]; } },
  };
}

test("o/O/Mod+; map to add placements and stay native inside inputs", () => {
  const browse = (key, extra = {}) => H.propertyEditorKeyAction({ key, ...extra }, { inInput: false });
  assert.equal(browse("o"), "add-below");
  assert.equal(browse("O"), "add-above");
  assert.equal(browse("o", { shiftKey: true }), "add-above");
  assert.equal(browse(";", { ctrlKey: true }), "add-end");
  assert.equal(browse(";", { metaKey: true }), "add-end");
  assert.equal(H.propertyEditorKeyAction({ key: "o" }, { inInput: true }), null);
  assert.equal(H.propertyEditorCloseLadder({ addName: {}, stage: null }), "stage");
});

test("insertion anchors are source keys, not group indexes, and empty notes have none", () => {
  const rows = [
    row({ key: "b", line: 3, role: "loose" }),
    row({ key: "type", line: 4, role: "identity" }),
    row({ key: "field", line: 5, role: "card", owner: "record" }),
  ];
  assert.deepEqual(H.propertyEditorAddPlacement("below", "type", rows), {
    where: "below", before: null, after: "type", anchorKey: "type",
  });
  assert.deepEqual(H.propertyEditorAddPlacement("above", "field", rows), {
    where: "above", before: "field", after: null, anchorKey: "field",
  });
  assert.deepEqual(H.propertyEditorAddPlacement("end", "b", rows), {
    where: "end", before: null, after: null, anchorKey: null,
  });
  assert.deepEqual(H.propertyEditorAddPlacement("below", "b", []), {
    where: "end", before: null, after: null, anchorKey: null,
  });
  assert.deepEqual(H.propertyEditorAddPositionFields({ after: "type" }), { after: "type" });
  assert.deepEqual(H.propertyEditorAddPositionFields({ before: "field" }), { before: "field" });
  assert.deepEqual(H.propertyEditorAddPositionFields({ where: "end" }), {});
});

test("name inventory uses types and counts, falls back without inventing types, and keeps order", () => {
  const infos = H.propertyEditorPropertyInfos(infosApp());
  assert.equal(infos.source, "infos");
  assert.deepEqual(infos.rows.map((row) => [row.name, row.type, row.count, row.wireKind]), [
    ["tags", "tags", 12, "tags"],
    ["count", "number", 5, "number"],
    ["cssclasses", "multitext", 4, "list"],
    ["aliases", "aliases", 3, "aliases"],
    ["url", "url", 2, "text"],
    ["done", "checkbox", 1, "checkbox"],
  ]);
  const filtered = H.propertyEditorFilterPropertyNames(infos.rows, "alias");
  assert.deepEqual(filtered.map((row) => row.name), ["aliases"]);
  assert.deepEqual(H.propertyEditorFilterPropertyNames(infos.rows, "css").map((row) => row.name), ["cssclasses"]);
  const cache = H.propertyEditorPropertyInfos(cacheOnlyApp());
  assert.equal(cache.source, "cache");
  assert.deepEqual(cache.rows.map((row) => [row.name, row.type, row.wireKind, row.authoritative, row.count]), [
    ["city", null, "text", false, 2],
    ["extra", null, "text", false, 1],
  ]);
});

test("Tab/Enter takes a completion type and Shift+Enter keeps a literal text key", () => {
  const catalog = H.propertyEditorPropertyInfos(infosApp()).rows;
  const fromTab = H.propertyEditorAcceptAddName("ta", catalog, { suggestionIndex: 0 });
  assert.equal(fromTab.name, "tags");
  assert.equal(fromTab.wireKind, "tags");
  assert.equal(fromTab.fromCompletion, true);
  const literal = H.propertyEditorAcceptAddName("tags", catalog, { literal: true });
  assert.equal(literal.name, "tags");
  assert.equal(literal.wireKind, "text");
  assert.equal(literal.fromCompletion, false);
  const unknown = H.propertyEditorAcceptAddName("brand-new", catalog, { suggestionIndex: 0 });
  assert.equal(unknown.name, "brand-new");
  assert.equal(unknown.wireKind, "text");
  const quoted = H.propertyEditorNormalizePropertyName("\"名前\"");
  assert.equal(quoted, "名前");
  assert.equal(H.propertyEditorValidateNewKey("123", []).ok, true);
  assert.equal(H.propertyEditorValidateNewKey("名前", []).ok, true);
  assert.equal(H.propertyEditorValidateNewKey("", []).ok, false);
  assert.equal(H.propertyEditorValidateNewKey("a\nb", []).code, "prop_bad_key");
  assert.equal(H.propertyEditorValidateNewKey("title", ["title"]).code, "prop_exists");
});

test("add ops carry before/after and checkbox/url kinds stay on supported wire types", () => {
  const tags = H.propertyEditorAddSyntheticRow("tags", "tags");
  const built = H.propertyEditorAddStageBuild({
    add: true, addRow: tags, addPlacement: { after: "title", anchorKey: "title" },
    key: "tags", kind: "tags", wireKind: "tags",
  }, { items: ["home"], itemDraft: "" }, { properties: [row()] });
  assert.equal(built.ok, true);
  assert.deepEqual(built.ops[0], { op: "prop.set", key: "tags", value: ["home"], kind: "tags", after: "title" });
  const box = H.propertyEditorAddStageBuild({
    add: true,
    addRow: H.propertyEditorAddSyntheticRow("done", "checkbox"),
    addPlacement: { where: "end", anchorKey: null },
    key: "done", kind: "checkbox", wireKind: "checkbox",
  }, { value: "true" }, { properties: [] });
  assert.deepEqual(box.ops[0], { op: "prop.set", key: "done", value: true, kind: "checkbox" });
  assert.equal(H.propertyEditorObsidianTypeToWire("url"), "text");
});

test("o below, O above, and Mod+; start name stages on the selected source key", () => {
  const properties = [
    row({ key: "title", line: 3 }),
    row({ key: "type", line: 4, role: "identity" }),
    row({ key: "field", line: 5, role: "card", owner: "record" }),
  ];
  const modal = new H.PropertyEditorModal(infosApp(), {
    filePath: "notes/plain.md", report: report(properties),
  });
  modal.propertyEditorSelect("type::4");
  assert.equal(modal.propertyEditorStartAdd("below"), true);
  assert.equal(modal.addName.placement.after, "type");
  assert.equal(modal.addName.source, "infos");
  assert.equal(modal.addName.catalog[0].name, "tags");
  modal.propertyEditorCancelAdd();
  modal.propertyEditorSelect("field::5");
  modal.propertyEditorStartAdd("above");
  assert.equal(modal.addName.placement.before, "field");
  modal.propertyEditorCancelAdd();
  modal.propertyEditorPerform("add-end");
  assert.equal(modal.addName.placement.where, "end");
  assert.equal(modal.addName.placement.anchorKey, null);
});

test("empty notes add at the end and mode=add opens the name stage", () => {
  const modal = new H.PropertyEditorModal(infosApp(), {
    filePath: "notes/empty.md",
    report: report([], "empty-mapping"),
    mode: "add",
  });
  modal.propertyEditorMaybeStartModeAdd();
  assert.equal(modal.addName.placement.where, "end");
  assert.equal(modal.addName.placement.anchorKey, null);
  const empty = new H.PropertyEditorModal({}, { filePath: "notes/empty.md", report: report([], "empty-mapping") });
  empty.propertyEditorStartAdd("below");
  assert.equal(empty.addName.placement.where, "end");
});

test("name cancellation and value cancellation write nothing", async () => {
  const session = fakeSession({ existing: [row()] });
  const modal = new H.PropertyEditorModal(infosApp(), { filePath: "notes/plain.md", report: report([row()]) });
  modal.session = session;
  modal.editorEnsureSession = () => session;
  modal.propertyEditorStartAdd("end");
  modal.propertyEditorSetAddName("topic");
  modal.propertyEditorCancelAdd();
  assert.equal(modal.addName, null);
  assert.equal(session.applied.length, 0);
  modal.propertyEditorStartAdd("end");
  modal.propertyEditorSetAddName("topic");
  assert.equal(modal.propertyEditorCommitAddName({ literal: true }), true);
  assert.equal(modal.stage.add, true);
  assert.equal(modal.stage.key, "topic");
  modal.propertyEditorCancelAdd();
  assert.equal(modal.stage, null);
  assert.equal(session.applied.length, 0);
});

test("Shift+Enter override and Tab completion open the matching value stage", () => {
  const modal = new H.PropertyEditorModal(infosApp(), { filePath: "notes/plain.md", report: report([row()]) });
  modal.propertyEditorStartAdd("below");
  modal.propertyEditorSetAddName("tags");
  modal.addName.suggestionIndex = 0;
  modal.propertyEditorCommitAddName();
  assert.equal(modal.stage.kind, "tags");
  assert.equal(modal.stage.addPlacement.after, "title");
  modal.propertyEditorCancelAdd();
  modal.propertyEditorStartAdd("end");
  modal.propertyEditorSetAddName("tags");
  modal.propertyEditorCommitAddName({ literal: true });
  assert.equal(modal.stage.kind, "text");
  assert.equal(modal.stage.key, "tags");
});

test("API absence still completes names as text without invented types", () => {
  const modal = new H.PropertyEditorModal(cacheOnlyApp(), { filePath: "notes/plain.md", report: report([row()]) });
  modal.propertyEditorStartAdd("end");
  assert.equal(modal.addName.source, "cache");
  assert.equal(modal.addName.catalog[0].authoritative, false);
  modal.propertyEditorSetAddName("city");
  modal.addName.suggestionIndex = 0;
  modal.propertyEditorCommitAddName();
  assert.equal(modal.stage.kind, "text");
  assert.equal(modal.stage.key, "city");
});

test("duplicate and missing-anchor races keep the draft and do not move the destination", async () => {
  const session = fakeSession({ existing: [row()] });
  const modal = new H.PropertyEditorModal(infosApp(), { filePath: "notes/plain.md", report: report([row()]) });
  modal.session = session;
  modal.editorEnsureSession = () => session;
  modal.propertyEditorStartAdd("below");
  modal.propertyEditorSetAddName("topic");
  assert.equal(modal.propertyEditorCommitAddName({ literal: true }), true);
  const placement = { ...modal.stage.addPlacement };
  modal.propertyEditorReconcile(report([row({ key: "other", line: 4 })]));
  assert.equal(modal.stage.key, "topic");
  assert.deepEqual(modal.stage.addPlacement, placement);
  assert.equal(modal.refusal.code, "prop_missing");
  const built = modal.propertyEditorBuildCurrentStage();
  assert.equal(built.ok, false);
  assert.equal(built.code, "prop_missing");
  modal.propertyEditorCancelAdd();
  modal.propertyEditorStartAdd("end");
  modal.propertyEditorSetAddName("fresh");
  modal.propertyEditorCommitAddName({ literal: true });
  modal.propertyEditorReconcile(report([row(), row({ key: "fresh", line: 6 })]));
  assert.equal(modal.stage.key, "fresh");
  assert.equal(modal.refusal.code, "prop_exists");
  assert.equal(modal.propertyEditorBuildCurrentStage().ok, false);
});

test("unsafe prospective names keep the draft and surface bob's refusal", async () => {
  const session = fakeSession({
    existing: [row()],
    onApply(ops) {
      if (ops[0] && ops[0].key === "type") {
        return {
          ok: false,
          report: { ok: false, error: { code: "prop_owned", message: "type is identity-owned.", hint: "y opens YAML." } },
        };
      }
      return null;
    },
  });
  const modal = new H.PropertyEditorModal(infosApp(), { filePath: "notes/plain.md", report: report([row()]) });
  modal.session = session;
  modal.editorEnsureSession = () => session;
  modal.propertyEditorStartAdd("end");
  modal.propertyEditorSetAddName("type");
  modal.propertyEditorCommitAddName({ literal: true });
  modal.propertyEditorStageInputChanged(mockInput("text", modal.stage.id, "project"));
  session.state = { ...session.state, status: "preview-ready", canApply: true };
  await modal.propertyEditorSaveStage();
  assert.equal(modal.stage.key, "type");
  assert.equal(modal.refusal.code, "prop_owned");
  assert.equal(session.applied.length, 0);
});

test("first-property create uses one prop.set and undo/redo round-trip", async () => {
  const session = fakeSession({
    expect: "empty-mapping",
    existing: [],
    inverseOps: [{ op: "prop.restore", key: "title", raw: null, framing: { expected: "---\n---\n", prior: "" } }],
  });
  const modal = new H.PropertyEditorModal(infosApp(), {
    filePath: "notes/empty.md",
    report: report([], "empty-mapping"),
  });
  modal.session = session;
  modal.editorEnsureSession = () => session;
  modal.propertyEditorStartAdd("end");
  modal.propertyEditorSetAddName("title");
  modal.propertyEditorCommitAddName({ literal: true });
  modal.propertyEditorStageInputChanged(mockInput("text", modal.stage.id, "Hello"));
  const built = modal.propertyEditorBuildCurrentStage();
  assert.deepEqual(built.ops[0], { op: "prop.set", key: "title", value: "Hello", kind: "text" });
  session.state = { ...session.state, status: "preview-ready", canApply: true, draftOps: built.ops };
  await modal.propertyEditorSaveStage();
  assert.equal(session.applied.length, 1);
  assert.equal(modal.stage, null);
  assert.equal(modal.selectedId, "title::8");
  await modal.propertyEditorHistory("undo");
  assert.equal(session.undone, 1);
  await modal.propertyEditorHistory("redo");
  assert.equal(session.redone, 1);
});

test("name stage painter lists type and count and retains the input", () => {
  class Element {
    constructor(tag, doc) {
      this.tagName = tag.toUpperCase();
      this.ownerDocument = doc;
      this.parentNode = null;
      this.children = [];
      this.attrs = new Map();
      this.value = "";
      this.disabled = false;
      this._text = "";
    }
    setAttribute(name, value) { this.attrs.set(name, String(value)); }
    getAttribute(name) { return this.attrs.get(name) ?? null; }
    appendChild(node) {
      node.parentNode = this;
      this.children.push(node);
      return node;
    }
    get firstChild() { return this.children[0] || null; }
    set textContent(value) { this._text = String(value); }
    get textContent() { return this._text || this.children.map((child) => child.textContent).join(""); }
  }
  const doc = { createElement(tag) { return new Element(tag, this); } };
  const host = doc.createElement("div");
  const painted = H.propertyEditorPaintNameStage(doc, host, {
    name: "ta",
    placement: { where: "below", after: "title", anchorKey: "title" },
    suggestions: [{ name: "tags", type: "tags", count: 12, authoritative: true }],
    selectedSuggestion: 0,
    previewText: "ready",
  }, {});
  assert.equal(painted.input.tagName, "INPUT");
  assert.equal(host.children[0].children.some((child) => child.textContent.includes("tags · tags · 12")), true);
});
