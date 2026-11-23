// Property editor validated YAML value stage (phase yaml-stage). Covers
// kind routing, the pure `prop.set_yaml` build, source seeding (maps,
// duplicates, opaque content, unsaved panes, cancellation), and the modal
// flow: Enter routing, the menu route, Mod+Enter save with the preview
// latch, Bob's verbatim refusals, stale retention, Esc cancellation, and
// undo/redo. Local validation stays minimal by design: malformed drafts
// and sibling/document injection pass through so Bob's dry-run refuses
// them verbatim.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin { constructor(app) { this.app = app; } }

// Key-set YAML subset parser: returns a null-prototype record of top-level
// keys so source cross-checks exercise the wiring without a YAML
// dependency. Seeded value fragments come from raw source bytes.
function stubParseYaml(yaml) {
  const record = Object.create(null);
  for (const line of String(yaml).split("\n")) {
    if (!line.trim() || /^[ \t]/.test(line) || /^\s*#/.test(line)) continue;
    const match = line.match(/^((?:"(?:[^"\\]|\\.)*")|(?:'(?:[^']|'')*')|[^:#]+?):(\s|$)/);
    if (!match) continue;
    let key = match[1].trim();
    if (key.startsWith('"')) key = JSON.parse(key);
    else if (key.startsWith("'")) key = key.slice(1, -1).replace(/''/g, "'");
    record[key] = 1;
  }
  return record;
}

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownView: class {}, Notice: class {}, Platform: { isDesktopApp: true },
    Plugin: TestPlugin, normalizePath: (value) => value, parseYaml: stubParseYaml,
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

const SOURCE = "---\ntitle: Groceries\ncount: 5\ntags:\n  - one\n  - two\nmeta:\n  nested: true\n  deep:\n    leaf: 1\nempty:\nnothing: null\n---\nBody text.\n";

function row(overrides = {}) {
  return {
    key: "title", line: 2, end_line: 2, value: "Groceries", kind: "text", role: "loose",
    owner: "props", editor: null, reason: null, duplicate: false, opaque: false,
    ...overrides,
  };
}

function report(properties, fingerprint = "sha256:before") {
  return {
    schema_version: 1, ok: true, path: "notes/groceries.md", note_kind: "note",
    capabilities: ["props_v1"], fingerprint,
    frontmatter: { state: "ok", start_line: 1, end_line: 13 }, properties,
  };
}

function sourceReport(valueByKey = {}) {
  const rows = [
    row({ key: "title", line: 2, value: "Groceries", kind: "text" }),
    row({ key: "count", line: 3, value: 5, kind: "number" }),
    row({ key: "tags", line: 4, value: ["one", "two"], kind: "list" }),
    row({ key: "meta", line: 7, value: { nested: true, deep: { leaf: 1 } }, kind: "map" }),
    row({ key: "empty", line: 11, value: null, kind: "null" }),
    row({ key: "nothing", line: 12, value: null, kind: "null" }),
  ];
  for (const entry of rows) {
    if (Object.prototype.hasOwnProperty.call(valueByKey, entry.key)) entry.value = valueByKey[entry.key];
  }
  return report(rows);
}

function pluginFor(source, testReport = null) {
  const app = {
    vault: {
      getAbstractFileByPath: () => ({}),
      read: async () => source,
    },
    workspace: { getLeavesOfType: () => [] },
  };
  return {
    app,
    apiPropertyShow: async () => ({ ok: true, report: testReport || sourceReport() }),
  };
}

function modalFor(source, properties = null, fingerprint) {
  const testReport = properties ? report(properties, fingerprint) : sourceReport();
  if (fingerprint) testReport.fingerprint = fingerprint;
  const plugin = pluginFor(source, testReport);
  const modal = new H.PropertyEditorModal(plugin.app, {
    filePath: "notes/groceries.md",
    report: testReport,
    plugin,
  });
  modal.paintPropertyEditor = () => {};
  return modal;
}

function fakeSession() {
  const session = {
    state: { status: "browsing", draftOps: [], canApply: false, expect: "sha256:before" },
    applied: [],
    undone: 0,
    redone: 0,
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
        report: { ok: true, changed: true, fingerprint_after: "sha256:after", properties: sourceReport().properties },
      };
    },
    async undo() {
      this.undone += 1;
      return { ok: true, report: { ok: true, fingerprint_after: "sha256:before", properties: sourceReport().properties } };
    },
    async redo() {
      this.redone += 1;
      return { ok: true, report: { ok: true, fingerprint_after: "sha256:after", properties: sourceReport().properties } };
    },
    close() {},
  };
  return session;
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

async function flush(steps = 30) {
  for (let index = 0; index < steps; index += 1) await Promise.resolve();
}

test("yaml routing takes loose maps and opaque rows, never typed or locked rows", () => {
  assert.equal(H.propertyEditorYamlStageKindForRow(row({ kind: "map", value: { a: 1 } })), "yaml");
  assert.equal(H.propertyEditorYamlStageKindForRow(row({ kind: "map", value: { a: 1 }, opaque: true })), "yaml");
  assert.equal(H.propertyEditorYamlStageKindForRow(row({ kind: "opaque", value: "x", opaque: true })), "yaml");
  assert.equal(H.propertyEditorYamlStageKindForRow(row({ kind: "mystery", value: "x" })), "yaml");
  for (const kind of ["text", "null", "number", "date", "datetime", "list", "tags", "aliases"]) {
    assert.equal(H.propertyEditorYamlStageKindForRow(row({ kind })), null, kind);
  }
  assert.equal(H.propertyEditorYamlStageKindForRow(row({ kind: "checkbox", value: true })), null);
  assert.equal(H.propertyEditorYamlStageKindForRow(row({ kind: "map", value: {}, role: "card" })), null);
  assert.equal(H.propertyEditorYamlStageKindForRow(row({ kind: "map", value: {}, role: "identity" })), null);
  assert.equal(H.propertyEditorYamlStageKindForRow(row({ kind: "map", value: {}, pending: true })), null);
  assert.equal(H.propertyEditorYamlStageAvailableForRow(row({ kind: "text", value: "x" })), true);
  assert.equal(H.propertyEditorYamlStageAvailableForRow(row({ kind: "checkbox", value: true })), true);
  assert.equal(H.propertyEditorYamlStageAvailableForRow(row({ kind: "map", value: {} })), true);
  assert.equal(H.propertyEditorYamlStageAvailableForRow(row({ role: "card" })), false);
  assert.equal(H.propertyEditorYamlStageAvailableForRow(row({ pending: true })), false);
});

test("yaml leaves y and Ctrl+E on the Source excursion", () => {
  const browse = (key, extra = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extra });
  assert.equal(H.propertyEditorKeyAction(browse("y")), "yaml");
  assert.equal(H.propertyEditorKeyAction(browse("e", { ctrlKey: true })), "yaml");
  assert.equal(H.propertyEditorKeyAction(browse("Enter")), "open");
});

test("yaml build emits one prop.set_yaml op and tracks the seed", () => {
  const stage = { yaml: true, key: "meta", seedYaml: "nested: true", value: "nested: true" };
  const unchanged = H.propertyEditorYamlStageBuild(stage, { value: "nested: true" });
  assert.equal(unchanged.ok, true);
  assert.equal(unchanged.changed, false);
  assert.deepEqual(unchanged.ops, []);
  const changed = H.propertyEditorYamlStageBuild(stage, { value: "nested: false" });
  assert.equal(changed.ok, true);
  assert.equal(changed.changed, true);
  assert.equal(changed.kind, "yaml");
  assert.deepEqual(changed.ops, [{ op: "prop.set_yaml", key: "meta", yaml: "nested: false" }]);
  assert.deepEqual(H.propertyEditorYamlOp("meta", "a: 1"), { op: "prop.set_yaml", key: "meta", yaml: "a: 1" });
  assert.equal(H.propertyEditorYamlStageBuild(null, {}).ok, false);
  assert.equal(H.propertyEditorYamlStageBuild({ yaml: true, key: "" }, { value: "x" }).ok, false);
});

test("yaml build passes malformed and injection drafts through for Bob's verdict", () => {
  const stage = { yaml: true, key: "meta", seedYaml: "nested: true", value: "nested: true" };
  for (const yaml of ["{{bad: [", "a: 1\nb: 2", "---\nx: 1\n---", "key: |\n  kept\n"]) {
    const built = H.propertyEditorYamlStageBuild(stage, { value: yaml });
    assert.equal(built.ok, true, yaml);
    assert.equal(built.changed, true, yaml);
    assert.deepEqual(built.ops, [{ op: "prop.set_yaml", key: "meta", yaml }], yaml);
  }
});

test("yaml build keeps the null versus empty distinction", () => {
  const stage = { yaml: true, key: "empty", seedYaml: "null", value: "null" };
  assert.equal(H.propertyEditorYamlStageBuild(stage, { value: "null" }).changed, false);
  const cleared = H.propertyEditorYamlStageBuild(stage, { value: "" });
  assert.equal(cleared.changed, true);
  assert.deepEqual(cleared.ops, [{ op: "prop.set_yaml", key: "empty", yaml: "" }]);
});

test("yaml ordinal counts same-key rows in source order", () => {
  const rows = [
    row({ key: "dup", line: 2 }),
    row({ key: "other", line: 3 }),
    row({ key: "dup", line: 4 }),
  ];
  assert.equal(H.propertyEditorYamlOrdinal(rows, "dup::2", "dup"), 0);
  assert.equal(H.propertyEditorYamlOrdinal(rows, "dup::4", "dup"), 1);
  assert.equal(H.propertyEditorYamlOrdinal(rows, "other::3", "other"), 0);
});

test("yaml editor texts read only panes showing the note", () => {
  const app = {
    workspace: {
      getLeavesOfType: () => [
        { view: { file: { path: "notes/groceries.md" }, editor: { getValue: () => "one" } } },
        { view: { file: { path: "notes/other.md" }, editor: { getValue: () => "other" } } },
        { view: null },
      ],
    },
  };
  assert.deepEqual(H.propertyEditorYamlEditorTexts(app, "notes/groceries.md"), ["one"]);
  assert.deepEqual(H.propertyEditorYamlEditorTexts(app, "notes/missing.md"), []);
  assert.deepEqual(H.propertyEditorYamlEditorTexts(null, "notes/groceries.md"), []);
});

test("yaml seed keeps block maps, scalars, and nulls byte-exact", async () => {
  const seed = (key, ordinal = 0, source = SOURCE, testReport = null) => H.propertyEditorYamlStageSeedFor({
    key, ordinal, path: "notes/groceries.md",
    report: testReport || sourceReport(),
    readSource: async () => source,
    readReport: async () => testReport || sourceReport(),
    editorTexts: async () => [],
    parseYaml: stubParseYaml,
    isCancelled: () => false,
  });
  const meta = await seed("meta");
  assert.equal(meta.ok, true);
  assert.equal(meta.inspect, false);
  assert.equal(meta.diagnostic, null);
  assert.equal(meta.valueYaml, "\n  nested: true\n  deep:\n    leaf: 1");
  assert.equal((await seed("title")).valueYaml, "Groceries");
  assert.equal((await seed("tags")).valueYaml, "\n  - one\n  - two");
  assert.equal((await seed("empty")).valueYaml, "null");
  assert.equal((await seed("count")).valueYaml, "5");
});

test("yaml seed picks the selected duplicate occurrence", async () => {
  const source = "---\ndup: one\ndup: two\n---\n";
  const testReport = report([
    row({ key: "dup", line: 2, value: "one" }),
    row({ key: "dup", line: 3, value: "two" }),
  ]);
  const seed = (ordinal) => H.propertyEditorYamlStageSeedFor({
    key: "dup", ordinal, path: "notes/groceries.md", report: testReport,
    readSource: async () => source, readReport: async () => testReport,
    editorTexts: async () => [], parseYaml: stubParseYaml, isCancelled: () => false,
  });
  assert.equal((await seed(0)).valueYaml, "one");
  assert.equal((await seed(1)).valueYaml, "two");
  assert.equal((await seed(5)).code, "yaml-moved");
});

test("yaml seed marks anchored content opaque with a diagnostic", async () => {
  const source = "---\nsig: &anchor value\n---\n";
  const testReport = report([row({ key: "sig", line: 2, value: "value", kind: "map" })]);
  const seed = await H.propertyEditorYamlStageSeedFor({
    key: "sig", ordinal: 0, path: "notes/groceries.md", report: testReport,
    readSource: async () => source, readReport: async () => testReport,
    editorTexts: async () => [], parseYaml: stubParseYaml, isCancelled: () => false,
  });
  assert.equal(seed.ok, true);
  assert.equal(seed.inspect, true);
  assert.match(seed.diagnostic, /stay opaque/);
});

test("yaml seed marks opaque rows for inspection even with plain bytes", async () => {
  const seed = await H.propertyEditorYamlStageSeedFor({
    key: "meta", ordinal: 0, path: "notes/groceries.md", report: sourceReport(), opaque: true,
    readSource: async () => SOURCE, readReport: async () => sourceReport(),
    editorTexts: async () => [], parseYaml: stubParseYaml, isCancelled: () => false,
  });
  assert.equal(seed.ok, true);
  assert.equal(seed.inspect, true);
  assert.match(seed.diagnostic, /prop_opaque/);
});

test("yaml seed prefers a differing editor snapshot and refuses to guess", async () => {
  const edited = SOURCE.replace("nested: true", "nested: false");
  const editedReport = sourceReport();
  const seed = await H.propertyEditorYamlStageSeedFor({
    key: "meta", ordinal: 0, path: "notes/groceries.md", report: sourceReport(),
    readSource: async () => SOURCE, readReport: async () => editedReport,
    editorTexts: async () => [edited], parseYaml: stubParseYaml, isCancelled: () => false,
  });
  assert.equal(seed.ok, true);
  assert.match(seed.valueYaml, /nested: false/);
  const removed = "---\ntitle: Groceries\n---\n";
  const refused = await H.propertyEditorYamlStageSeedFor({
    key: "title", ordinal: 0, path: "notes/groceries.md", report: sourceReport(),
    readSource: async () => SOURCE, readReport: async () => sourceReport(),
    editorTexts: async () => [removed], parseYaml: stubParseYaml, isCancelled: () => false,
  });
  assert.equal(refused.ok, false);
  assert.match(refused.message, /Unsaved edits are open/);
});

test("yaml seed honors cancellation and missing input", async () => {
  const base = {
    key: "meta", ordinal: 0, path: "notes/groceries.md", report: sourceReport(),
    readSource: async () => SOURCE, readReport: async () => sourceReport(),
    editorTexts: async () => [], parseYaml: stubParseYaml,
  };
  assert.equal((await H.propertyEditorYamlStageSeedFor({ ...base, isCancelled: () => true })).code, "cancelled");
  assert.equal((await H.propertyEditorYamlStageSeedFor({ ...base, key: "" })).code, "missing-key");
  assert.equal((await H.propertyEditorYamlStageSeedFor({ ...base, parseYaml: null })).code, "yaml-parser-unavailable");
});

class EditorElement {
  constructor(tag, doc) {
    this.tagName = String(tag).toUpperCase();
    this.ownerDocument = doc;
    this.parentNode = null;
    this.children = [];
    this.attrs = new Map();
    this.listeners = new Map();
    this.className = "";
    this.value = "";
    this.disabled = false;
    this.selectionStart = 0;
    this.selectionEnd = 0;
    this._text = "";
    this.classList = {
      add: (name) => {
        const names = new Set(this.className.split(/\s+/).filter(Boolean));
        names.add(name);
        this.className = [...names].join(" ");
        this.attrs.set("class", this.className);
      },
    };
  }
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  get lastElementChild() { return this.lastChild; }
  get textContent() { return this._text || this.children.map((child) => child.textContent || "").join(""); }
  set textContent(value) { this.children = []; this._text = String(value); }
  setAttribute(name, value) {
    this.attrs.set(name, String(value));
    if (name === "class") this.className = String(value);
  }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  empty() { for (const child of [...this.children]) this.removeChild(child); }
  addEventListener(type, callback) {
    const list = this.listeners.get(type) || [];
    list.push(callback);
    this.listeners.set(type, list);
  }
  focus() { this.ownerDocument.activeElement = this; }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  matches(selector) {
    const text = String(selector).trim();
    const cls = /^\.([\w-]+)$/.exec(text);
    if (cls) return this.className.split(/\s+/).includes(cls[1]);
    const attr = /^\[([\w-]+)(?:=['"]([^'"]*)['"])?\]$/.exec(text);
    if (attr) return this.attrs.has(attr[1])
      && (attr[2] === undefined || this.getAttribute(attr[1]) === attr[2]);
    return this.tagName === text.toUpperCase();
  }
  closest(selector) {
    let node = this;
    while (node) {
      if (node.matches?.(selector)) return node;
      node = node.parentNode;
    }
    return null;
  }
  querySelectorAll(selector) {
    const found = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (child.matches(selector)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function editorDocument() {
  const doc = { activeElement: null };
  doc.createElement = (tag) => new EditorElement(tag, doc);
  return doc;
}

function yamlModal(source, properties = null) {
  const testReport = properties ? report(properties) : sourceReport();
  const plugin = pluginFor(source, testReport);
  const modal = new H.PropertyEditorModal(plugin.app, {
    filePath: "notes/groceries.md",
    report: testReport,
    plugin,
  });
  const session = fakeSession();
  modal.session = session;
  modal.editorEnsureSession = () => session;
  return { modal, session };
}

test("Enter opens the yaml stage for loose maps and keeps typed stages", async () => {
  const { modal } = yamlModal(SOURCE);
  const mapEntry = modal.editorOrderedRows().find((entry) => entry.row.key === "meta");
  assert.equal(modal.propertyEditorOpenStage(mapEntry), true);
  await flush();
  assert.ok(modal.stage);
  assert.equal(modal.stage.yaml, true);
  assert.equal(modal.stage.key, "meta");
  assert.equal(modal.stage.value, "\n  nested: true\n  deep:\n    leaf: 1");

  const { modal: typed } = yamlModal(SOURCE);
  const textEntry = typed.editorOrderedRows().find((entry) => entry.row.key === "title");
  assert.equal(typed.propertyEditorOpenStage(textEntry), true);
  assert.equal(typed.stage.kind, "text");
});

test("the menu route edits another loose value as yaml and refuses locked rows", async () => {
  const { modal } = yamlModal(SOURCE);
  const opened = await modal.propertyEditorPerform("edit-yaml");
  assert.equal(opened, true);
  assert.ok(modal.stage);
  assert.equal(modal.stage.yaml, true);
  assert.equal(modal.stage.key, "title");
  assert.equal(modal.stage.value, "Groceries");

  const locked = yamlModal(SOURCE, [
    row({ key: "type", line: 2, value: "note", kind: "text", role: "identity", reason: "Note identity." }),
  ]);
  locked.modal.selectedId = "type::2";
  assert.equal(await locked.modal.propertyEditorPerform("edit-yaml"), false);
  assert.equal(locked.modal.stage, null);
  assert.match(locked.modal.refusal.message, /Note identity/);
  assert.equal(locked.modal.refusal.hint, "y opens YAML.");
});

test("Mod+Enter saves the yaml draft as one set_yaml batch with the preview latch", async () => {
  const { modal, session } = yamlModal(SOURCE);
  const mapEntry = modal.editorOrderedRows().find((entry) => entry.row.key === "meta");
  await modal.propertyEditorStartYamlStage(mapEntry);
  assert.ok(modal.stage);
  modal.propertyEditorStageInputChanged(mockInput("yaml", modal.stage.id, "\n  nested: false\n  deep:\n    leaf: 1"));
  await modal.propertyEditorSaveStage();
  assert.ok(modal.pendingStageEnter);
  session.state = { ...session.state, status: "preview-ready", canApply: true };
  modal.propertyEditorStageSyncPreview();
  await flush();
  assert.equal(session.applied.length, 1);
  assert.deepEqual(session.applied[0], [
    { op: "prop.set_yaml", key: "meta", yaml: "\n  nested: false\n  deep:\n    leaf: 1" },
  ]);
  assert.equal(modal.stage, null);
  assert.equal(modal.status.kind, "saved");
});

test("an edit after Enter invalidates the pending yaml preview", async () => {
  const { modal, session } = yamlModal(SOURCE);
  await modal.propertyEditorStartYamlStage();
  modal.propertyEditorStageInputChanged(mockInput("yaml", modal.stage.id, "\n  nested: false"));
  await modal.propertyEditorSaveStage();
  assert.ok(modal.pendingStageEnter);
  modal.propertyEditorStageInputChanged(mockInput("yaml", modal.stage.id, "\n  nested: 0"));
  assert.equal(modal.pendingStageEnter, null);
  session.state = { ...session.state, status: "preview-ready", canApply: true };
  modal.propertyEditorStageSyncPreview();
  assert.equal(session.applied.length, 0);
});

test("Bob's yaml refusal shows verbatim and keeps the draft", async () => {
  const { modal, session } = yamlModal(SOURCE);
  await modal.propertyEditorStartYamlStage();
  modal.propertyEditorStageInputChanged(mockInput("yaml", modal.stage.id, "{{bad: ["));
  await modal.propertyEditorSaveStage();
  session.state = {
    ...session.state,
    status: "refused",
    canApply: false,
    refusal: { code: "prop_bad_value", message: "That YAML does not parse.", hint: "Fix the mapping and preview again." },
  };
  modal.propertyEditorStageSyncPreview();
  assert.equal(modal.refusal.message, "That YAML does not parse.");
  assert.equal(modal.refusal.hint, "Fix the mapping and preview again.");
  assert.ok(modal.stage);
  assert.equal(modal.stage.value, "{{bad: [");
  assert.equal(modal.propertyEditorBuildCurrentStage().ops[0].yaml, "{{bad: [");
});

test("an opaque save surfaces prop_opaque with the draft retained", async () => {
  const source = "---\nsig: &anchor value\n---\n";
  const properties = [row({ key: "sig", line: 2, value: "value", kind: "map", opaque: true })];
  const { modal, session } = yamlModal(source, properties);
  await modal.propertyEditorStartYamlStage();
  assert.ok(modal.stage);
  assert.equal(modal.stage.inspect, true);
  assert.match(modal.stage.diagnostic, /stay opaque/);
  modal.propertyEditorStageInputChanged(mockInput("yaml", modal.stage.id, "&anchor edited"));
  await modal.propertyEditorSaveStage();
  session.state = {
    ...session.state,
    status: "refused",
    canApply: false,
    refusal: { code: "prop_opaque", message: "Anchors stay opaque.", hint: "y opens YAML." },
  };
  modal.propertyEditorStageSyncPreview();
  assert.equal(modal.refusal.message, "Anchors stay opaque.");
  assert.equal(modal.stage.value, "&anchor edited");
});

test("stale reports keep the yaml draft but require a new preview", async () => {
  const { modal } = yamlModal(SOURCE);
  await modal.propertyEditorStartYamlStage();
  modal.propertyEditorStageInputChanged(mockInput("yaml", modal.stage.id, "\n  nested: false"));
  await modal.propertyEditorSaveStage();
  const id = modal.stage.id;
  modal.propertyEditorReconcile({ ...sourceReport(), fingerprint: "sha256:changed" });
  assert.equal(modal.stage.id, id);
  assert.equal(modal.stageNeedsPreview, true);
  assert.equal(modal.pendingStageEnter, null);
  assert.equal(modal.propertyEditorBuildCurrentStage().ops[0].yaml, "\n  nested: false");
});

test("Esc cancels the yaml stage without closing the modal", async () => {
  const { modal } = yamlModal(SOURCE);
  await modal.propertyEditorStartYamlStage();
  assert.ok(modal.stage);
  const input = new EditorElement("textarea", editorDocument());
  input.setAttribute("data-property-stage-input", `property-stage-${modal.stage.id}`);
  input.setAttribute("data-property-stage-id", String(modal.stage.id));
  input.setAttribute("data-property-stage-kind", "yaml");
  modal.contentEl = { querySelector: () => input };
  let prevented = false;
  modal.propertyEditorOnKeyDown({
    key: "Escape", target: input,
    preventDefault: () => { prevented = true; },
    stopPropagation: () => {},
  });
  assert.equal(prevented, true);
  assert.equal(modal.stage, null);
  assert.equal(modal.closed, false);
});

test("plain Enter inserts a newline while Mod+Enter saves", async () => {
  const { modal, session } = yamlModal(SOURCE);
  await modal.propertyEditorStartYamlStage();
  const input = new EditorElement("textarea", editorDocument());
  input.setAttribute("data-property-stage-input", `property-stage-${modal.stage.id}`);
  input.setAttribute("data-property-stage-id", String(modal.stage.id));
  input.setAttribute("data-property-stage-kind", "yaml");
  const before = modal.stage.value;
  let prevented = false;
  modal.propertyEditorOnKeyDown({
    key: "Enter", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, target: input,
    preventDefault: () => { prevented = true; },
    stopPropagation: () => {},
  });
  assert.equal(prevented, false);
  assert.equal(session.applied.length, 0);
  assert.equal(modal.stage.value, before);
  modal.propertyEditorStageInputChanged(mockInput("yaml", modal.stage.id, `${before}\n  extra: 1`));
  await modal.propertyEditorSaveStage();
  modal.propertyEditorOnKeyDown({
    key: "Enter", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, target: input,
    preventDefault: () => { prevented = true; },
    stopPropagation: () => {},
  });
  assert.equal(prevented, true);
});

test("undo and redo cover the yaml batch", async () => {
  const { modal, session } = yamlModal(SOURCE);
  await modal.propertyEditorStartYamlStage();
  modal.propertyEditorStageInputChanged(mockInput("yaml", modal.stage.id, "\n  nested: false"));
  await modal.propertyEditorSaveStage();
  session.state = { ...session.state, status: "preview-ready", canApply: true };
  modal.propertyEditorStageSyncPreview();
  await flush();
  assert.equal(session.applied.length, 1);
  await modal.propertyEditorHistory("undo");
  assert.equal(session.undone, 1);
  assert.equal(modal.status.kind, "saved");
  await modal.propertyEditorHistory("redo");
  assert.equal(session.redone, 1);
});

test("yaml paint uses a multiline textarea with a diagnostic and key hints", () => {
  const doc = editorDocument();
  const { modal } = yamlModal(SOURCE);
  const host = new EditorElement("div", doc);
  const view = {
    stageId: 9, key: "meta", row: row({ kind: "map" }), kind: "yaml", label: "YAML",
    value: "\n  nested: true", items: [], itemDraft: "", collection: false,
    suggestions: [], previewText: "Edit YAML · Mod+Enter previews and saves",
    disabled: false, composing: false, prose: false, keptInput: null, keptBand: null,
    yaml: true, seedYaml: "\n  nested: true", inspectOnly: false, diagnostic: null,
  };
  const painted = H.propertyEditorPaintStage(doc, host, view, modal);
  assert.equal(painted.input.tagName, "TEXTAREA");
  assert.equal(painted.input.getAttribute("data-property-stage-kind"), "yaml");
  assert.equal(painted.input.value, "\n  nested: true");
  assert.match(host.textContent, /Mod\+Enter saves/);
  assert.match(host.textContent, /Enter adds a line/);

  const opaqueHost = new EditorElement("div", doc);
  H.propertyEditorPaintStage(doc, opaqueHost, {
    ...view, inspectOnly: true, diagnostic: "This value stays opaque — Bob refuses the write (prop_opaque); y opens YAML.",
  }, modal);
  assert.match(opaqueHost.textContent, /prop_opaque/);
});

test("the All actions menu offers yaml editing and names it in the hints", () => {
  const doc = editorDocument();
  const { modal } = yamlModal(SOURCE);
  modal.contentEl = new EditorElement("div", doc);
  modal.menuOpen = true;
  delete modal.paintPropertyEditor;
  modal.paintPropertyEditor();
  let host = modal.contentEl.querySelector(".bob-property-editor");
  let button = host.querySelector("[data-property-command='edit-yaml']");
  assert.ok(button);
  assert.equal(button.disabled, false);
  assert.match(host.textContent, /Enter opens maps as YAML/);

  const locked = yamlModal(SOURCE, [
    row({ key: "type", line: 2, value: "note", kind: "text", role: "identity", reason: "Note identity." }),
  ]);
  locked.modal.contentEl = new EditorElement("div", doc);
  locked.modal.menuOpen = true;
  delete locked.modal.paintPropertyEditor;
  locked.modal.selectedId = "type::2";
  locked.modal.paintPropertyEditor();
  host = locked.modal.contentEl.querySelector(".bob-property-editor");
  button = host.querySelector("[data-property-command='edit-yaml']");
  assert.ok(button);
  assert.equal(button.disabled, true);
});
