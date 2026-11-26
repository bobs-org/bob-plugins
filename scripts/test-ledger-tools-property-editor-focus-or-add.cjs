// Focus-or-add (bob-cli-qm kit T2): openPropertyEditor({ filePath, key })
// selects the key's row when present, else opens Add with the key prefilled
// and the value focused. Summary-named keys travel the settings-degraded
// branch on notes without a settings contract; other loose keys travel the
// modal consume. Degraded reports keep the safe first row, the setting path
// is unchanged, and the Esc/q/Ctrl+[ ladder still closes.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin {
  constructor(app) { this.app = app; }
}

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: class {},
      Modal: class { constructor(app) { this.app = app; } open() {} close() {} },
      Notice: class {},
      Platform: { isDesktopApp: true },
      Plugin: TestPlugin,
      normalizePath: (value) => value,
      parseYaml: (text) => JSON.parse(text),
    };
  }
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value } };
  if (request === "@codemirror/view") {
    return {
      EditorView: { updateListener: { of: (listener) => ({ listener }) } },
      keymap: { of: (value) => value },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
Module._load = originalLoad;
const H = LedgerToolsPlugin.helpers;

function wireRow(overrides = {}) {
  return {
    key: "title", line: 3, end_line: 3, value: "Hello", kind: "text",
    style: { flow: false }, role: "loose", owner: "props", editor: null,
    reason: null, duplicate: false, opaque: false, ...overrides,
  };
}

function showReport(overrides = {}) {
  return {
    schema_version: 1, ok: true, path: "notes/notebook.md", note_kind: "notebook",
    capabilities: ["props_v1"], fingerprint: "sha256:aaa",
    frontmatter: { state: "ok", start_line: 1, end_line: 5 },
    properties: [wireRow()], ...overrides,
  };
}

function modalFor(report, options = {}) {
  const modal = new H.PropertyEditorModal({}, { filePath: report.path, report, ...options });
  modal.paintPropertyEditor = () => {};
  return modal;
}

test("a present loose key selects its row", () => {
  const report = showReport({ properties: [wireRow({ key: "title", line: 3, value: "Hello" })] });
  const modal = modalFor(report, { key: "title" });
  modal.propertyEditorReconcile(report);
  assert.equal(modal.selectedId, H.propertyEditorRowId(report.properties[0], 0));
  assert.ok(!modal.stage, "no Add stage opens when the key exists");
  assert.ok(!modal.addName);
});

test("a missing loose key opens Add prefilled with the value focused", () => {
  const report = showReport({ properties: [wireRow({ key: "parent", line: 3, value: "[[Owner]]" })] });
  const modal = modalFor(report, { key: "title" });
  modal.propertyEditorReconcile(report);
  assert.ok(modal.stage && modal.stage.add === true, "Add commits straight to the value stage");
  assert.equal(modal.stage.key, "title");
  assert.equal(modal.propertyEditorFocusOrAddDone, true);
  // A later report never yanks the open draft.
  const selectedBefore = modal.selectedId;
  modal.propertyEditorReconcile(report);
  assert.ok(modal.stage && modal.stage.add === true, "the draft survives reconcile");
  assert.equal(modal.selectedId, selectedBefore);
});

test("a missing summary on a notebook opens Add through the catalog path", () => {
  // The catalog calls openPropertyEditor({ filePath, key: "summary" }); the
  // entrypoint maps the key onto the summary setting, and the degraded
  // branch (no settings contract on notebooks) focuses-or-adds.
  const report = showReport({ properties: [wireRow({ key: "parent", line: 3, value: "[[Owner]]" })] });
  const modal = modalFor(report, { setting: "summary" });
  assert.equal(modal.requestedSetting, "summary");
  modal.propertyEditorReconcile(report);
  assert.ok(modal.stage && modal.stage.add === true, "Add commits straight to the value stage");
  assert.equal(modal.stage.key, "summary");
});

test("a present summary on a notebook selects its row", () => {
  const report = showReport({ properties: [wireRow({ key: "summary", line: 3, value: "Scope" })] });
  const modal = modalFor(report, { setting: "summary" });
  modal.propertyEditorReconcile(report);
  assert.equal(modal.selectedId, H.propertyEditorRowId(report.properties[0], 0));
  assert.ok(!modal.stage);
  assert.ok(!modal.addName);
});

test("a duplicate key selects its first row", () => {
  const report = showReport({
    properties: [
      wireRow({ key: "title", line: 3, value: "First" }),
      wireRow({ key: "title", line: 4, value: "Second", duplicate: true }),
    ],
  });
  const modal = modalFor(report, { key: "title" });
  modal.propertyEditorReconcile(report);
  assert.equal(modal.selectedId, H.propertyEditorRowId(report.properties[0], 0));
  assert.ok(!modal.stage);
});

test("a degraded report keeps the safe first row", () => {
  const broken = showReport({
    properties: [wireRow({ key: "parent", line: 3 })],
    frontmatter: { state: "invalid", start_line: 1, end_line: 5 },
  });
  for (const options of [{ key: "title" }, { setting: "summary" }]) {
    const modal = modalFor(broken, options);
    const before = modal.selectedId;
    modal.propertyEditorReconcile(broken);
    assert.ok(!modal.stage, "invalid frontmatter never opens Add");
    assert.ok(!modal.addName);
    assert.equal(modal.selectedId, before, "the safe first row survives");
  }
});

test("an old-bob report keeps the safe first row", () => {
  const old = showReport({
    properties: [wireRow({ key: "parent", line: 3 })],
    capabilities: [],
    fingerprint: "",
    cacheRows: [],
  });
  const modal = modalFor(old, { key: "title" });
  const before = modal.selectedId;
  modal.propertyEditorReconcile(old);
  assert.ok(!modal.stage, "an unwritable report never opens Add");
  assert.equal(modal.selectedId, before);
});

test("the Esc/q/Ctrl+[ ladder still closes from focus-or-add", () => {
  assert.equal(H.propertyEditorKeyAction({ key: "Escape" }, { inInput: false }), "close");
  assert.equal(H.propertyEditorKeyAction({ key: "q" }, { inInput: false }), "close");
  assert.equal(
    H.propertyEditorKeyAction({ key: "[", ctrlKey: true, code: "BracketLeft" }, { inInput: false }),
    "close",
  );
  const report = showReport({ properties: [wireRow({ key: "parent", line: 3 })] });
  const modal = modalFor(report, { key: "title" });
  modal.propertyEditorReconcile(report);
  assert.equal(
    H.propertyEditorCloseLadder({ menuOpen: false, stage: modal.stage, filterOpen: false }),
    "stage",
    "the first rung parks the open value stage, not the modal",
  );
});

test("an explicit add mode prefills the requested key", () => {
  const report = showReport({ properties: [wireRow({ key: "parent", line: 3 })] });
  const modal = modalFor(report, { key: "title", mode: "add" });
  modal.propertyEditorReconcile(report);
  assert.ok(modal.addName, "explicit Add opens the name row");
  assert.equal(modal.addName.name, "title", "the requested key is prefilled");
});

test("the setting path on area notes never touches Add", () => {
  const report = showReport({
    note_kind: "area",
    capabilities: ["props_v1", "props_contract_v1"],
    properties: [wireRow({ key: "theme", line: 3 })],
    contract: undefined,
  });
  const modal = modalFor(report, { setting: "summary" });
  modal.propertyEditorReconcile(report);
  assert.ok(!modal.stage);
  assert.ok(!modal.addName);
});
