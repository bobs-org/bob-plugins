// Property editor selection, visible-row filtering, and batch deletion.
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
    key: "title", line: 3, end_line: 3, value: "A value", kind: "text", role: "loose",
    owner: "props", editor: null, reason: null, duplicate: false, opaque: false,
    ...overrides,
  };
}

function report(properties) {
  return {
    schema_version: 1, ok: true, path: "notes/properties.md", note_kind: "note",
    capabilities: ["props_v1"], fingerprint: "sha256:before",
    frontmatter: { state: "ok", start_line: 1, end_line: 20 }, properties,
  };
}

function modalFor(properties) {
  const modal = new H.PropertyEditorModal({}, { filePath: "notes/properties.md", report: report(properties) });
  modal.paintPropertyEditor = () => {};
  return modal;
}

test("visible groups keep grouped row order and search complete nested values", () => {
  const properties = [
    row({ key: "card-key", role: "card", line: 3, value: "hidden group" }),
    row({ key: "loose-first", line: 4, value: ["list", { nested: "long-value-match" }] }),
    row({ key: "loose-second", line: 5, value: { map: { child: "text" } } }),
    row({ key: "loose-second", line: 6, value: "duplicate occurrence" }),
  ];
  const groups = H.propertyEditorSelectionFilterGroups(properties);
  assert.deepEqual(groups.flatMap((group) => group.rows.map((entry) => entry.row.key)), [
    "loose-first", "loose-second", "loose-second", "card-key",
  ]);
  const match = H.propertyEditorSelectionFilterGroups(properties, "long-value-match");
  assert.deepEqual(match.flatMap((group) => group.rows.map((entry) => entry.id)), ["loose-first::4"]);
  assert.equal(H.propertyEditorSelectionFilterValueText({ a: [1, { b: "needle" }] }).includes("needle"), true);
  assert.deepEqual(H.propertyEditorSelectionFilterGroups(properties, "not here"), []);
  assert.deepEqual(groups[0].rows.slice(1).map((entry) => entry.id), ["loose-second::5", "loose-second::6"]);
});

test("selection keys distinguish Space, visual range, filter, and shifted arrows", () => {
  const browse = (key, extra = {}, context = {}) => H.propertyEditorKeyAction({ key, ...extra }, context);
  assert.equal(browse(" "), "toggle-mark");
  assert.equal(browse("Space", { code: "Space" }), "toggle-mark");
  assert.equal(browse("V", { shiftKey: true }), "visual-range");
  assert.equal(browse("/"), "filter");
  assert.equal(browse("ArrowDown", { shiftKey: true }), "range-down");
  assert.equal(browse("ArrowUp", { shiftKey: true }), "range-up");
  assert.equal(browse("ArrowDown", { shiftKey: true, ctrlKey: true }), null);
  assert.equal(browse("/", {}, { inInput: true }), null);
  assert.equal(browse(" ", {}, { inInput: true }), null);
});

test("visual range follows grouped visible order, reverses at its anchor, and keeps marks on exit", async () => {
  const modal = modalFor([
    row({ key: "card", role: "card", line: 3 }),
    row({ key: "loose-a", line: 4 }),
    row({ key: "loose-b", line: 5 }),
    row({ key: "type", role: "identity", line: 6 }),
  ]);
  const visible = H.propertyEditorSelectionFilterEntries(modal);
  assert.deepEqual(visible.map((entry) => entry.row.key), ["loose-a", "loose-b", "card", "type"]);
  modal.selectedId = visible[0].id;
  await modal.propertyEditorPerform("visual-range");
  await modal.propertyEditorPerform("down");
  await modal.propertyEditorPerform("down");
  assert.equal(modal.selectedId, visible[2].id);
  assert.deepEqual([...H.propertyEditorSelectionFilterMarkedIds(modal)], [visible[0].id, visible[1].id, visible[2].id]);
  await modal.propertyEditorPerform("up");
  assert.deepEqual([...H.propertyEditorSelectionFilterMarkedIds(modal)], [visible[0].id, visible[1].id]);
  await modal.propertyEditorPerform("visual-range");
  assert.equal(modal.propertyEditorRangeActive, false);
  assert.deepEqual([...H.propertyEditorSelectionFilterMarkedIds(modal)], [visible[0].id, visible[1].id]);
  await modal.propertyEditorPerform("up");
  assert.equal(modal.selectedId, visible[0].id, "ordinary navigation stays within visible rows at a boundary");
});

test("filter opening preserves marks; query edits clear marks and hidden rows; empty results keep a target", () => {
  const modal = modalFor([
    row({ key: "a", line: 3, value: { nested: ["needle at depth"] } }),
    row({ key: "b", line: 4, value: "other" }),
  ]);
  const [first, second] = H.propertyEditorSelectionFilterEntries(modal);
  modal.propertyEditorManualMarks.add(second.id);
  H.propertyEditorSelectionFilterPerform(modal, "filter");
  assert.equal(modal.propertyEditorFilterInputFocused, true);
  assert.deepEqual([...H.propertyEditorSelectionFilterMarkedIds(modal)], [second.id]);
  H.propertyEditorSelectionFilterSetQuery(modal, "needle at depth");
  assert.equal(modal.selectedId, first.id);
  assert.equal(H.propertyEditorSelectionFilterMarkedIds(modal).size, 0);
  H.propertyEditorSelectionFilterSetQuery(modal, "no match");
  assert.deepEqual(H.propertyEditorSelectionFilterEntries(modal), []);
  assert.equal(modal.selectedId, "");
  let prevented = false;
  modal.propertyEditorOnKeyDown({
    key: "ArrowDown", target: { getAttribute: (name) => name === "data-property-filter-input" ? "true" : null },
    preventDefault() { prevented = true; },
  });
  assert.equal(prevented, true);
  assert.equal(modal.propertyEditorFilterInputFocused, false);
  assert.equal(modal.selectedId, "", "zero matches leave focus to the stable host target");
  modal.propertyEditorBackOut();
  assert.equal(modal.propertyEditorFilterQuery, "");
  assert.equal(modal.closed, false, "Esc clears the filter layer first");
  modal.propertyEditorBackOut();
  assert.equal(modal.closed, true);
});

test("an empty filter layer does not clear marks when Esc dismisses it", () => {
  const modal = modalFor([row({ key: "a", line: 3 }), row({ key: "b", line: 4 })]);
  const entry = H.propertyEditorSelectionFilterEntries(modal)[0];
  modal.propertyEditorManualMarks.add(entry.id);
  H.propertyEditorSelectionFilterPerform(modal, "filter");
  modal.propertyEditorBackOut();
  assert.equal(modal.filterOpen, false);
  assert.deepEqual([...H.propertyEditorSelectionFilterMarkedIds(modal)], [entry.id]);
});

test("Esc with a query repaints the cleared filter layer", () => {
  const modal = modalFor([row({ key: "a", line: 3 }), row({ key: "b", line: 4 })]);
  let paints = 0;
  modal.paintPropertyEditor = () => { paints += 1; };
  H.propertyEditorSelectionFilterPerform(modal, "filter");
  H.propertyEditorSelectionFilterSetQuery(modal, "zzz");
  paints = 0;
  modal.propertyEditorBackOut();
  assert.equal(modal.propertyEditorFilterQuery, "");
  assert.equal(modal.filterOpen, false);
  assert.equal(paints, 1, "clearing a query repaints the rows and hides the filter layer");
});

test("a successful multi-delete sends one source-ordered guarded batch and reconciles focus", async () => {
  const properties = [
    row({ key: "zeta", line: 3 }),
    row({ key: "type", role: "identity", line: 4, value: "note" }),
    row({ key: "alpha", line: 5 }),
  ];
  const modal = modalFor(properties);
  modal.propertyEditorManualMarks = new Set();
  const byKey = new Map(modal.editorOrderedRows().map((entry) => [entry.row.key, entry]));
  modal.propertyEditorManualMarks.add(byKey.get("alpha").id);
  modal.propertyEditorManualMarks.add(byKey.get("zeta").id);
  let calls = 0;
  let submitted;
  modal.editorEnsureSession = () => ({
    applyOps: async (ops) => {
      calls += 1;
      submitted = ops;
      return { ok: true, report: report([properties[1]]) };
    },
  });
  await H.propertyEditorSelectionFilterDelete(modal);
  assert.equal(calls, 1);
  assert.deepEqual(submitted, [
    { op: "prop.unset", key: "zeta" },
    { op: "prop.unset", key: "alpha" },
  ], "the session receives one batch in source order for one undo step");
  assert.deepEqual(modal.properties.map((property) => property.key), ["type"]);
  assert.equal(modal.selectedId, "type::4");
  assert.equal(H.propertyEditorSelectionFilterMarkedIds(modal).size, 0);
  assert.equal(modal.status.kind, "saved");
});

test("mixed protected selection refuses the whole batch and names every locked row", async () => {
  const properties = [
    row({ key: "loose", line: 3 }),
    row({ key: "type", role: "identity", line: 4, reason: "identity is fixed" }),
    row({ key: "derived", role: "derived", line: 5, reason: "written by Bob" }),
  ];
  const modal = modalFor(properties);
  modal.propertyEditorManualMarks = new Set();
  for (const entry of modal.editorOrderedRows()) modal.propertyEditorManualMarks.add(entry.id);
  let calls = 0;
  modal.editorEnsureSession = () => ({ applyOps: async () => { calls += 1; return { ok: true }; } });
  await H.propertyEditorSelectionFilterDelete(modal);
  assert.equal(calls, 0);
  assert.match(modal.refusal.message, /type/);
  assert.match(modal.refusal.message, /derived/);
  assert.match(modal.refusal.message, /Cannot delete selection/);
  assert.equal(modal.properties.length, 3);
});

test("refresh reconciliation follows a unique key across line changes and never guesses a duplicate", () => {
  const oldRows = [
    { id: "dup::3", row: row({ key: "dup", line: 3 }) },
    { id: "dup::4", row: row({ key: "dup", line: 4 }) },
    { id: "unique::5", row: row({ key: "unique", line: 5 }) },
  ];
  const newRows = [
    { id: "dup::7", row: row({ key: "dup", line: 7 }) },
    { id: "unique::9", row: row({ key: "unique", line: 9 }) },
  ];
  assert.deepEqual(
    [...H.propertyEditorSelectionFilterRemapIds(new Set(["dup::3", "unique::5"]), oldRows, newRows)],
    ["unique::9"],
  );
  assert.deepEqual([...H.propertyEditorSelectionFilterRemapIds(new Set(["dup::7"]), newRows, newRows)], ["dup::7"]);
});

test("selection, filtering, and paint options do not create a session or call writers", () => {
  let sessionCreates = 0;
  let paints = 0;
  const modal = modalFor([row({ key: "a", line: 3 }), row({ key: "b", line: 4 })]);
  modal.propertyPlugin = { propertyCapability: true };
  modal.editorEnsureSession = () => { sessionCreates += 1; return null; };
  modal.paintPropertyEditor = () => { paints += 1; modal.propertyEditorPaintOptions(); };
  H.propertyEditorSelectionFilterPerform(modal, "toggle-mark");
  H.propertyEditorSelectionFilterPerform(modal, "down");
  H.propertyEditorSelectionFilterPerform(modal, "filter");
  H.propertyEditorSelectionFilterSetQuery(modal, "b");
  modal.propertyEditorPaintOptions();
  assert.ok(paints > 0);
  assert.equal(sessionCreates, 0);
  assert.equal(modal.session, null);
});

class EditorElement {
  constructor(tag, ownerDocument) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.children = [];
    this.attrs = new Map();
    this.listeners = new Map();
    this.className = "";
    this.value = "";
    this.disabled = false;
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
  get textContent() { return this.children.map((child) => child.textContent || "").join(""); }
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
  insertBefore(child, before) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    const index = before ? this.children.indexOf(before) : -1;
    if (index < 0) this.children.push(child);
    else this.children.splice(index, 0, child);
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
  dispatch(type, event = {}) {
    const payload = { ...event, type, target: event.target || this, preventDefault: event.preventDefault || (() => {}) };
    for (const callback of this.listeners.get(type) || []) callback(payload);
    return payload;
  }
  focus() { this.ownerDocument.activeElement = this; }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  matches(selector) {
    const text = String(selector).trim();
    const notDisabled = text.includes(":not([disabled])");
    const simple = text.replace(":not([disabled])", "");
    if (notDisabled && (this.disabled || this.attrs.has("disabled"))) return false;
    const cls = /^\.([\w-]+)$/.exec(simple);
    if (cls) return this.className.split(/\s+/).includes(cls[1]);
    const taggedAttr = /^([a-z][\w-]*)\[([\w-]+)(?:=['"]([^'"]*)['"])?\]$/i.exec(simple);
    if (taggedAttr) return this.tagName === taggedAttr[1].toUpperCase()
      && this.attrs.has(taggedAttr[2])
      && (taggedAttr[3] === undefined || this.getAttribute(taggedAttr[2]) === taggedAttr[3]);
    const attr = /^\[([\w-]+)(?:=['"]([^'"]*)['"])?\]$/.exec(simple);
    if (attr) return this.attrs.has(attr[1])
      && (attr[2] === undefined || this.getAttribute(attr[1]) === attr[2]);
    return this.tagName === simple.toUpperCase();
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
  contains(target) {
    if (this === target) return true;
    return this.children.some((child) => child.contains(target));
  }
}

function editorDocument() {
  const doc = { activeElement: null };
  doc.createElement = (tag) => new EditorElement(tag, doc);
  doc.createTextNode = (text) => ({ textContent: String(text), ownerDocument: doc });
  return doc;
}

test("paint shows accessible mark gutters, filter controls, and a disabled filtered reorder action", () => {
  const doc = editorDocument();
  const modal = new H.PropertyEditorModal({ document: doc }, {
    filePath: "notes/properties.md",
    report: report([
      row({ key: "first", line: 3, value: "needle" }),
      row({ key: "second", line: 4, value: "other" }),
    ]),
  });
  modal.contentEl = new EditorElement("div", doc);
  modal.paintPropertyEditor();
  let host = modal.contentEl.querySelector(".bob-property-editor");
  const gutters = host.querySelectorAll("[data-property-mark-gutter='true']");
  assert.equal(gutters.length, 2);
  assert.equal(gutters[0].getAttribute("role"), "img");
  assert.match(gutters[0].getAttribute("aria-label"), /Not marked: first/);

  modal.propertyEditorPerform("filter");
  host = modal.contentEl.querySelector(".bob-property-editor");
  let input = host.querySelector("[data-property-filter-input='true']");
  assert.equal(input.getAttribute("aria-label"), "Filter properties by key and value");
  assert.equal(doc.activeElement, input);
  input.value = "needle";
  input.selectionStart = 6;
  input.selectionEnd = 6;
  input.dispatch("input");
  host = modal.contentEl.querySelector(".bob-property-editor");
  input = host.querySelector("[data-property-filter-input='true']");
  assert.equal(input.value, "needle");
  assert.equal(doc.activeElement, input);
  assert.equal(host.querySelectorAll("[data-property-row]").length, 1);

  modal.menuOpen = true;
  modal.paintPropertyEditor();
  host = modal.contentEl.querySelector(".bob-property-editor");
  const reorder = host.querySelector("[data-property-command='reorder']");
  assert.ok(reorder);
  assert.equal(reorder.disabled, true);
  assert.match(reorder.getAttribute("title"), /Clear the filter/);
  assert.equal(doc.activeElement.getAttribute("role"), "menuitem");
});

