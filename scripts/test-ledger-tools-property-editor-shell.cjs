// Property editor shell: cache-first grouped rows, role routing, browse
// keys, close ladder, discrete checkbox/delete/history, and degraded states
// (bob-cli-pf.4.1.2 editor-shell). Pure-model plus modal-logic coverage;
// rendering itself must not spawn bob or write.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin {
  constructor(app) {
    this.app = app;
  }
}

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: class {},
      Notice: class {},
      Platform: { isDesktopApp: true },
      Plugin: TestPlugin,
      normalizePath: (value) => value,
      parseYaml: (text) => JSON.parse(text),
    };
  }
  if (request === "@codemirror/state") {
    return { Prec: { highest: (value) => value } };
  }
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
    key: "title",
    line: 3,
    end_line: 3,
    value: "Hello",
    kind: "text",
    style: { flow: false },
    role: "loose",
    owner: "props",
    editor: null,
    reason: null,
    duplicate: false,
    opaque: false,
    ...overrides,
  };
}

function showReport(overrides = {}) {
  return {
    schema_version: 1,
    ok: true,
    path: "notes/groceries.md",
    note_kind: "note",
    capabilities: ["props_v1"],
    fingerprint: "sha256:aaa",
    frontmatter: { state: "ok", start_line: 1, end_line: 5 },
    properties: [wireRow()],
    ...overrides,
  };
}

test("group rows keep source order and duplicate keys stay separate", () => {
  const rows = [
    wireRow({ key: "b", line: 3, role: "loose" }),
    wireRow({ key: "a", line: 4, role: "card", owner: "record", editor: "==" }),
    wireRow({ key: "b", line: 5, role: "loose" }),
    wireRow({ key: "type", line: 6, role: "identity", reason: "locked" }),
    wireRow({ key: "done_tasks", line: 7, role: "derived", owner: "ledger", reason: "derived" }),
  ];
  const groups = H.propertyEditorGroupRows(rows);
  assert.deepEqual(groups.map((g) => g.group), ["loose", "card", "identity", "managed"]);
  assert.deepEqual(groups[0].rows.map((r) => r.id), ["b::3", "b::5"]);
  assert.equal(groups[0].rows[0].row.line, 3);
  assert.equal(groups[0].rows[1].row.line, 5);
  assert.deepEqual(H.propertyEditorOrderedIds(rows), ["b::3", "a::4", "b::5", "type::6", "done_tasks::7"]);
});

test("empty values stay distinct in row text", () => {
  assert.equal(H.propertyEditorRowText(wireRow({ value: null })), "—");
  assert.equal(H.propertyEditorRowText(wireRow({ value: "" })), "empty");
  assert.equal(H.propertyEditorRowText(wireRow({ value: [] })), "empty list");
  assert.equal(H.propertyEditorRowText(wireRow({ value: true })), "✓");
  assert.equal(H.propertyEditorRowText(wireRow({ value: false })), "✗");
  assert.equal(H.propertyEditorRowText(wireRow({ value: 0 })), "0");
  assert.equal(H.propertyEditorRowText({ key: "x", value: undefined }), "—");
});

test("roles gate every action and unresolved never becomes loose", () => {
  assert.deepEqual(H.propertyEditorActionForRow(wireRow({ role: "loose", kind: "text", key: "t" })), { action: "edit", key: "t" });
  assert.deepEqual(H.propertyEditorActionForRow(wireRow({ role: "loose", kind: "checkbox", key: "done", value: false })), { action: "toggle", key: "done" });
  const hand = H.propertyEditorActionForRow(wireRow({ role: "card", key: "field", owner: "record", editor: "==" }));
  assert.equal(hand.action, "handoff");
  assert.equal(hand.editor, "==");
  const locked = H.propertyEditorActionForRow(wireRow({ role: "identity", key: "type", reason: "why" }));
  assert.equal(locked.action, "locked");
  assert.equal(locked.yamlEscape, true);
  const derived = H.propertyEditorActionForRow(wireRow({ role: "derived", key: "d", owner: "ledger", reason: "r" }));
  assert.equal(derived.action, "locked");
  const unresolved = H.propertyEditorActionForRow(wireRow({ key: "mystery", role: null }));
  assert.equal(unresolved.action, "locked");
  assert.equal(H.propertyEditorGroupForRow(wireRow({ role: null, key: "x" })), "managed");
  assert.equal(H.propertyEditorCanMutate(wireRow({ role: "loose", kind: "text" })), true);
  assert.equal(H.propertyEditorCanMutate(wireRow({ role: "identity" })), false);
  assert.equal(H.propertyEditorCanMutate(wireRow({ role: null })), false);
  assert.equal(H.propertyEditorCanMutate(wireRow({ role: "card", owner: "record" })), false);
});

test("header handles every wire note kind", () => {
  for (const [kind, label] of [["day", "Day"], ["week", "Week"], ["quarter", "Quarter"], ["year", "Year"], ["all_time", "All time"], ["record", "Record"], ["album", "Album"], ["bank", "Bank"], ["area", "Area"], ["project", "Project"], ["notebook", "Notebook"], ["reference", "Reference"], ["note", "Note"]]) {
    const model = H.propertyEditorHeaderModel({ noteKind: kind, path: "a.md", count: 2 });
    assert.equal(model.heading, `${label.toUpperCase()} · PROPERTIES`);
    assert.equal(model.sub, "a.md · 2 properties");
  }
  const one = H.propertyEditorHeaderModel({ noteKind: "day", path: "d.md", count: 1 });
  assert.equal(one.sub, "d.md · 1 property");
});

test("degraded states carry verbatim copy and write gates", () => {
  assert.equal(H.propertyEditorDegradedFor({ capability: false }).mode, "old-bob");
  assert.equal(H.propertyEditorDegradedFor({ capability: false }).hint, H.PROPERTY_EDITOR_OLD_BOB_HINT);
  assert.equal(H.propertyEditorDegradedFor({ capability: false }).writable, false);
  const recovery = H.propertyEditorDegradedFor({
    report: { ...showReport(), fingerprint: null, frontmatter: { state: "invalid", start_line: 1 }, properties: [] },
  });
  assert.equal(recovery.mode, "recovery");
  assert.equal(recovery.text, H.PROPERTY_EDITOR_RECOVERY_TEXT);
  assert.equal(H.propertyEditorDegradedFor({ report: showReport({ properties: [] }) }).mode, "empty");
  assert.equal(H.propertyEditorDegradedFor({ report: showReport({ properties: [] }) }).text, H.PROPERTY_EDITOR_EMPTY_TEXT);
  assert.equal(H.propertyEditorDegradedFor({ cacheRows: [] }).mode, "empty");
  assert.equal(H.propertyEditorDegradedFor({ cacheRows: [{ key: "a" }] }).mode, "cache");
  assert.equal(H.propertyEditorDegradedFor({ report: showReport() }).mode, "ready");
});

test("cache rows never authorize a mutation", () => {
  const rows = H.propertyEditorCacheRows({ title: "Hi", count: 3 });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].pending, true);
  assert.equal(H.propertyEditorActionForRow(rows[0]).action, "locked");
  assert.equal(H.propertyEditorDegradedFor({ cacheRows: rows }).writable, false);
});

test("browse keys map and typing stays native", () => {
  const browse = (key, extra = {}) => H.propertyEditorKeyAction({ key, ...extra }, { inInput: false });
  assert.equal(browse("j"), "down");
  assert.equal(browse("k"), "up");
  assert.equal(browse("ArrowDown"), "down");
  assert.equal(browse("ArrowUp"), "up");
  assert.equal(browse("g"), "top");
  assert.equal(browse("G"), "bottom");
  assert.equal(browse("Home"), "top");
  assert.equal(browse("End"), "bottom");
  assert.equal(browse("n", { ctrlKey: true }), "down");
  assert.equal(browse("p", { ctrlKey: true }), "up");
  assert.equal(browse("Enter"), "open");
  assert.equal(browse("l"), "open");
  assert.equal(browse("d", { ctrlKey: true }), "delete");
  assert.equal(browse("u"), "undo");
  assert.equal(browse("z", { ctrlKey: true }), "undo");
  assert.equal(browse("r", { ctrlKey: true }), "redo");
  assert.equal(browse("="), "equals");
  assert.equal(browse("y"), "yaml");
  assert.equal(browse("e", { ctrlKey: true }), "yaml");
  assert.equal(browse("Escape"), "close");
  assert.equal(browse("q"), "close");
  assert.equal(H.propertyEditorKeyAction({ key: "[" }, { inInput: false }), null);
  assert.equal(H.propertyEditorKeyAction({ key: "j" }, { inInput: true }), null);
  assert.equal(H.propertyEditorKeyAction({ key: "u" }, { inInput: true }), null);
  assert.equal(H.propertyEditorKeyAction({ key: "Enter" }, { inInput: true }), null);
});

test("close ladder parks menu, stage, and reserved filter before the modal", () => {
  assert.equal(H.propertyEditorCloseLadder({ menuOpen: true, stage: {}, filterOpen: true }), "menu");
  assert.equal(H.propertyEditorCloseLadder({ menuOpen: false, stage: {}, filterOpen: true }), "stage");
  assert.equal(H.propertyEditorCloseLadder({ menuOpen: false, stage: null, filterOpen: true }), "filter");
  assert.equal(H.propertyEditorCloseLadder({ menuOpen: false, stage: null, filterOpen: false }), "modal");
});

test("modal reconciles without losing selection and closes cleanly", () => {
  const app = {};
  const first = showReport({ properties: [wireRow({ key: "a", line: 3 }), wireRow({ key: "b", line: 4 })] });
  const modal = new H.PropertyEditorModal(app, { filePath: "notes/groceries.md", report: first });
  assert.equal(modal.selectedId, "a::3");
  modal.propertyEditorSelect("b::4");
  assert.equal(modal.selectedId, "b::4");
  modal.propertyEditorReconcile(showReport({ properties: [wireRow({ key: "a", line: 3 }), wireRow({ key: "b", line: 4 })] }));
  assert.equal(modal.selectedId, "b::4");
  modal.propertyEditorReconcile(showReport({ properties: [wireRow({ key: "a", line: 3 })] }));
  assert.equal(modal.selectedId, "a::3");
  modal.menuOpen = true;
  modal.propertyEditorBackOut();
  assert.equal(modal.menuOpen, false);
  assert.equal(modal.closed, false);
  modal.stage = { kind: "text" };
  modal.propertyEditorBackOut();
  assert.equal(modal.stage, null);
  modal.filterOpen = true;
  modal.propertyEditorBackOut();
  assert.equal(modal.filterOpen, false);
  modal.onClose();
  assert.equal(modal.closed, true);
  assert.equal(modal.session, null);
});

for (const keys of [["first", "second"], ["duplicate", "duplicate"]]) {
  test(`browse focus follows the selected source row after repaint: ${keys.join(" / ")}`, () => {
    const rows = keys.map((key, index) => wireRow({ key, line: index + 3 }));
    const modal = new H.PropertyEditorModal({}, {
      filePath: "notes/groceries.md", report: showReport({ properties: rows }),
    });
    const doc = { activeElement: null };
    let buttons;
    const render = () => {
      buttons = rows.map((row) => ({
        id: `${row.key}::${row.line}`,
        getAttribute: (name) => name === "data-property-key" ? row.key : null,
        focus() { doc.activeElement = this; },
      }));
      // Removing the previously focused row returns focus to the document.
      doc.activeElement = null;
    };
    modal.contentEl = {
      querySelector(selector) {
        if (selector === '[aria-current="true"]') return buttons.find((button) => button.id === modal.selectedId);
        return buttons.find((button) => selector === `[data-property-key="${button.getAttribute("data-property-key")}"]`);
      },
      contains: (node) => buttons.includes(node),
    };
    modal.paintPropertyEditor = () => {
      const caret = modal.editorCaptureCaret(doc);
      render();
      modal.editorRestoreFocus(doc, caret);
    };
    render();
    buttons[0].focus();
    modal.propertyEditorMove(1);
    assert.equal(modal.selectedId, `${keys[1]}::4`);
    assert.equal(doc.activeElement, buttons[1], "native button keys must target the selected row");
    modal.paintPropertyEditor();
    assert.equal(doc.activeElement, buttons[1], "a later repaint must retain the same source occurrence");
  });
}

test("an empty editor focuses its browse host so the first add receives keyboard input", () => {
  const modal = new H.PropertyEditorModal({}, {
    filePath: "notes/plain.md", report: showReport({ properties: [] }),
  });
  const doc = { activeElement: { name: "previous note editor" } };
  const host = { focus() { doc.activeElement = this; } };
  modal.contentEl = {
    querySelector: (selector) => selector === ".bob-property-editor" ? host : null,
    contains: (node) => node === host,
  };
  modal.editorRestoreFocus(doc, null);
  assert.equal(doc.activeElement, host);
});

test("discrete ops build exact envelopes and history round-trips", () => {
  assert.deepEqual(H.propertyEditorToggleOp({ key: "done", value: false }), { op: "prop.set", key: "done", value: true });
  assert.deepEqual(H.propertyEditorToggleOp({ key: "done", value: true }), { op: "prop.set", key: "done", value: false });
  assert.deepEqual(H.propertyEditorUnsetOp({ key: "old" }), { op: "prop.unset", key: "old" });
  assert.equal(H.propertyEditorToggleOp({}), null);
  assert.equal(H.propertyEditorUnsetOp({}), null);
  assert.deepEqual(H.propertyEditorStatusSaved(), { kind: "saved", text: "✓ Saved · u undo" });
  assert.equal(H.propertyEditorStatusChecking().text, H.PROPERTY_EDITOR_CHECKING_TEXT);
  const refusal = H.propertyEditorStatusRefusal({ code: "prop_owned", message: "owned", hint: "==" });
  assert.equal(refusal.kind, "refusal");
  assert.equal(refusal.message, "owned");
});

test("locked rows refuse discrete actions without spawning", async () => {
  const app = {};
  const modal = new H.PropertyEditorModal(app, {
    filePath: "notes/groceries.md",
    report: showReport({ properties: [wireRow({ key: "type", line: 3, role: "identity", reason: "locked" })] }),
  });
  modal.editorEnsureSession = () => { throw new Error("must not spawn for locked rows"); };
  await modal.propertyEditorDelete(modal.editorSelected());
  assert.equal(modal.status.kind, "refusal");
});
