// Property editor rename stage and source-order reorder.
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

function report(properties, fingerprint = "sha256:before") {
  return {
    schema_version: 1, ok: true, path: "notes/properties.md", note_kind: "note",
    capabilities: ["props_v1"], fingerprint,
    frontmatter: { state: "ok", start_line: 1, end_line: 20 }, properties,
  };
}

function modalFor(properties, extra = {}) {
  const modal = new H.PropertyEditorModal({}, {
    filePath: "notes/properties.md",
    report: report(properties),
    ...extra,
  });
  modal.paintPropertyEditor = () => {};
  return modal;
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
    state: { status: "browsing", draftOps: [], canApply: false, expect: options.expect || "sha256:before" },
    applied: [],
    appliedOps: [],
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
      this.appliedOps.push(ops);
      const properties = typeof options.propertiesAfter === "function"
        ? options.propertiesAfter(ops)
        : options.propertiesAfter || [];
      return {
        ok: true, changed: options.changed !== false,
        report: {
          ok: true, changed: options.changed !== false,
          fingerprint_before: options.fingerprintBefore || "sha256:before",
          fingerprint_after: options.fingerprintAfter || "sha256:after",
          inverse_ops: options.inverseOps || [{ op: "prop.rename", key: "new", to: "title" }],
          properties,
        },
      };
    },
    async applyOps(ops) {
      this.state.draftOps = ops.slice();
      if (typeof options.onApplyOps === "function") {
        const refusal = await options.onApplyOps(ops);
        if (refusal) return refusal;
      }
      return this.apply();
    },
    async undo() {
      this.undone += 1;
      return {
        ok: true, changed: true,
        report: {
          ok: true, changed: true, fingerprint_after: "sha256:before",
          properties: options.existing || [],
        },
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
  get textContent() {
    if (!this.children.length && this._text != null) return this._text;
    return this.children.map((child) => child.textContent || child._text || "").join("");
  }
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
  addEventListener(type, callback) {
    const list = this.listeners.get(type) || [];
    list.push(callback);
    this.listeners.set(type, list);
  }
  focus() { this.ownerDocument.activeElement = this; }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  scrollIntoView() { this.scrolled = true; }
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
}

function editorDocument(matchMediaMatches = false) {
  const doc = { activeElement: null };
  doc.defaultView = {
    matchMedia: (query) => ({ matches: matchMediaMatches && /prefers-reduced-motion:\s*reduce/.test(query) }),
  };
  doc.createElement = (tag) => new EditorElement(tag, doc);
  doc.createTextNode = (text) => ({ textContent: String(text), ownerDocument: doc });
  return doc;
}

function sourceRows() {
  return [
    row({ key: "created", line: 2, role: "identity", reason: "Identity keys cannot be changed here." }),
    row({ key: "alpha", line: 3 }),
    row({ key: "card-key", line: 4, role: "card", owner: "record", editor: "=" }),
    row({ key: "beta", line: 5 }),
  ];
}

test("r and Alt+J/K/arrows map to rename and source moves; inputs keep native typing", () => {
  const browse = (key, extra = {}, context = {}) => H.propertyEditorKeyAction({ key, ...extra }, context);
  assert.equal(browse("r"), "rename");
  assert.equal(browse("R"), "rename");
  assert.equal(browse("j", { altKey: true }), "move-down");
  assert.equal(browse("J", { altKey: true }), "move-down");
  assert.equal(browse("ArrowDown", { altKey: true }), "move-down");
  assert.equal(browse("k", { altKey: true }), "move-up");
  assert.equal(browse("ArrowUp", { altKey: true }), "move-up");
  assert.equal(browse("r", { ctrlKey: true }), "redo");
  assert.equal(browse("j"), "down");
  assert.equal(browse("r", {}, { inInput: true }), null);
  assert.equal(browse("j", { altKey: true }, { inInput: true }), null);
  assert.equal(browse("ArrowDown", { altKey: true }, { inInput: true }), null);
});

test("rename validator excludes the current key and accepts quoted Unicode and integer-like names", () => {
  const properties = [row({ key: "title" }), row({ key: "other", line: 4 })];
  assert.equal(H.propertyEditorValidateRenameKey("title", properties, "title").ok, true);
  assert.equal(H.propertyEditorValidateRenameKey("other", properties, "title").code, "prop_exists");
  assert.equal(H.propertyEditorValidateRenameKey("", properties, "title").ok, false);
  assert.equal(H.propertyEditorNormalizePropertyName("\"名前\""), "名前");
  const built = H.propertyEditorRenameStageBuild(
    { rename: true, key: "10" },
    { value: "\"2\"" },
    [row({ key: "10" })],
  );
  assert.equal(built.ok, true);
  assert.deepEqual(built.ops, [{ op: "prop.rename", key: "10", to: "2" }]);
  const same = H.propertyEditorRenameStageBuild(
    { rename: true, key: "title" },
    { value: "title" },
    properties,
  );
  assert.equal(same.changed, false);
  assert.deepEqual(same.ops, []);
});

test("source-order neighbors ignore grouped visible order and treat protected rows as position references", () => {
  const entries = sourceRows().map((item, index) => ({
    id: H.propertyEditorRowId(item, index), index, row: item,
  }));
  const visible = H.propertyEditorGroupRows(sourceRows()).flatMap((group) => group.rows);
  assert.deepEqual(visible.map((entry) => entry.row.key), ["alpha", "beta", "card-key", "created"]);
  const down = H.propertyEditorSourceMovePlan(entries, "alpha::3", "down");
  assert.equal(down.ok, true);
  assert.deepEqual(down.op, { op: "prop.move", key: "alpha", after: "card-key" });
  assert.notEqual(down.op.after, "beta");
  const up = H.propertyEditorSourceMovePlan(entries, "beta::5", "up");
  assert.deepEqual(up.op, { op: "prop.move", key: "beta", before: "card-key" });
  const locked = H.propertyEditorSourceMovePlan(entries, "created::2", "down");
  assert.equal(locked.ok, false);
  assert.equal(locked.code, "locked");
  const top = H.propertyEditorSourceMovePlan(entries, "created::2", "up");
  assert.equal(top.ok, false);
  const firstLooseUp = H.propertyEditorSourceMovePlan(entries, "alpha::3", "up");
  assert.equal(firstLooseUp.ok, true);
  assert.deepEqual(firstLooseUp.op, { op: "prop.move", key: "alpha", before: "created" });
  const last = H.propertyEditorSourceMovePlan(entries, "beta::5", "down");
  assert.equal(last.ok, false);
  assert.equal(last.noop, true);
});

test("rename remaps focus and one mark onto the new key without dropping other marks", () => {
  const oldRows = [
    { id: "alpha::3", row: row({ key: "alpha", line: 3 }) },
    { id: "beta::4", row: row({ key: "beta", line: 4 }) },
  ];
  const newRows = [
    { id: "gamma::3", row: row({ key: "gamma", line: 3 }) },
    { id: "beta::4", row: row({ key: "beta", line: 4 }) },
  ];
  const mapped = H.propertyEditorRenameRemapFocus(
    oldRows, newRows, "alpha", "gamma", "alpha::3", new Set(["alpha::3", "beta::4"]),
  );
  assert.equal(mapped.selectedId, "gamma::3");
  assert.deepEqual([...mapped.markedIds].sort(), ["beta::4", "gamma::3"]);
});

test("r opens a seeded rename stage; duplicate and protected destinations keep the draft", async () => {
  const properties = [
    row({ key: "title", line: 3 }),
    row({ key: "other", line: 4 }),
    row({ key: "type", line: 5, role: "identity", reason: "Identity keys cannot be changed here." }),
  ];
  const modal = modalFor(properties);
  modal.selectedId = "title::3";
  assert.equal(modal.propertyEditorStartRename(), true);
  assert.equal(modal.stage.rename, true);
  assert.equal(modal.stage.value, "title");
  assert.equal(H.propertyEditorCloseLadder({ stage: modal.stage }), "stage");

  modal.propertyEditorStageInputChanged(mockInput("rename", modal.stage.id, "other"));
  const duplicate = modal.propertyEditorBuildCurrentStage();
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.code, "prop_exists");
  assert.equal(modal.stage.value, "other");

  const session = fakeSession({
    onApply() {
      return {
        ok: false,
        report: { ok: false, error: { code: "prop_identity", message: "property \"type\" identifies this note" } },
      };
    },
  });
  modal.session = session;
  modal.editorEnsureSession = () => session;
  modal.propertyEditorStageInputChanged(mockInput("rename", modal.stage.id, "parent"));
  const built = modal.propertyEditorBuildCurrentStage();
  assert.equal(built.ok, true);
  assert.deepEqual(built.ops, [{ op: "prop.rename", key: "title", to: "parent" }]);
  session.state = { ...session.state, status: "preview-ready", canApply: true, draftOps: built.ops };
  await modal.propertyEditorSaveStage();
  assert.equal(modal.stage.value, "parent");
  assert.equal(modal.refusal.code, "prop_identity");
  assert.equal(session.applied.length, 0);

  modal.propertyEditorCancelStage({ quiet: true });
  modal.selectedId = "type::5";
  assert.equal(modal.propertyEditorStartRename(), false);
  assert.match(modal.refusal.message, /Identity|Cannot rename/i);
});

test("successful rename applies prop.rename, moves focus and its mark, and keeps other marks", async () => {
  const properties = [row({ key: "title", line: 3 }), row({ key: "other", line: 4 })];
  const session = fakeSession({
    propertiesAfter: () => [row({ key: "renamed", line: 3 }), row({ key: "other", line: 4 })],
    inverseOps: [{ op: "prop.rename", key: "renamed", to: "title" }],
  });
  const modal = modalFor(properties);
  modal.session = session;
  modal.editorEnsureSession = () => session;
  modal.selectedId = "title::3";
  modal.propertyEditorManualMarks = new Set(["title::3", "other::4"]);
  assert.equal(modal.propertyEditorStartRename(), true);
  modal.propertyEditorStageInputChanged(mockInput("rename", modal.stage.id, "renamed"));
  const built = modal.propertyEditorBuildCurrentStage();
  session.state = { ...session.state, status: "preview-ready", canApply: true, draftOps: built.ops };
  await modal.propertyEditorSaveStage();
  assert.deepEqual(session.applied[0], [{ op: "prop.rename", key: "title", to: "renamed" }]);
  assert.equal(modal.stage, null);
  assert.equal(modal.selectedId, "renamed::3");
  assert.equal(H.propertyEditorSelectionFilterMarkedIds(modal).has("renamed::3"), true);
  assert.equal(H.propertyEditorSelectionFilterMarkedIds(modal).has("other::4"), true);
  await modal.propertyEditorHistory("undo");
  assert.equal(session.undone, 1);
});

test("same-name rename is a no-op and late preview edits do not apply a stale latch", async () => {
  const modal = modalFor([row()]);
  const session = fakeSession({ propertiesAfter: () => [row({ key: "next", line: 3 })] });
  modal.session = session;
  modal.editorEnsureSession = () => session;
  modal.propertyEditorStartRename();
  const same = modal.propertyEditorBuildCurrentStage();
  assert.equal(same.changed, false);
  await modal.propertyEditorSaveStage();
  assert.equal(session.applied.length, 0);
  assert.equal(modal.stage, null);

  modal.propertyEditorStartRename();
  modal.propertyEditorStageInputChanged(mockInput("rename", modal.stage.id, "next"));
  await modal.propertyEditorSaveStage();
  assert.ok(modal.pendingStageEnter);
  modal.propertyEditorStageInputChanged(mockInput("rename", modal.stage.id, "later"));
  assert.equal(modal.pendingStageEnter, null);
  session.state = { ...session.state, status: "preview-ready", canApply: true };
  modal.propertyEditorStageSyncPreview();
  assert.equal(session.applied.length, 0);
});

test("moves use source neighbors, skip held keys, and refuse filter, stage, and pending writes", async () => {
  const properties = sourceRows();
  const applied = [];
  const session = fakeSession({
    existing: properties,
    propertiesAfter: () => [
      row({ key: "created", line: 2, role: "identity" }),
      row({ key: "card-key", line: 3, role: "card" }),
      row({ key: "alpha", line: 4 }),
      row({ key: "beta", line: 5 }),
    ],
    inverseOps: [{ op: "prop.move", key: "alpha", before: "card-key" }],
    onApplyOps(ops) { applied.push(ops); return null; },
  });
  const modal = modalFor(properties);
  modal.session = session;
  modal.editorEnsureSession = () => session;
  modal.selectedId = "alpha::3";
  modal.propertyEditorManualMarks = new Set(["beta::5"]);
  assert.equal(await modal.propertyEditorMoveFocused("down"), true);
  assert.deepEqual(applied[0], [{ op: "prop.move", key: "alpha", after: "card-key" }]);
  assert.equal(H.propertyEditorSelectionFilterMarkedIds(modal).has("beta::5"), true);
  assert.match(modal.announce, /source position 3 of 4/);

  modal.propertyEditorFilterQuery = "alpha";
  const before = applied.length;
  assert.equal(await modal.propertyEditorMoveFocused("down"), false);
  assert.equal(applied.length, before);
  assert.match(modal.announce, /Clear the filter/);
  modal.propertyEditorFilterQuery = "";

  modal.stage = { id: 1, rename: true, key: "alpha" };
  assert.equal(await modal.propertyEditorMoveFocused("up"), false);
  modal.stage = null;

  modal.pendingApply = true;
  let refused = false;
  modal.propertyEditorRefuseWhileSaving = () => { refused = true; };
  assert.equal(await modal.propertyEditorMoveFocused("down"), false);
  assert.equal(refused, true);
  modal.pendingApply = false;

  assert.equal(await modal.propertyEditorMoveFocused("down", { repeat: true }), false);
  assert.equal(applied.length, before);
});

test("a move with identical semantic fingerprints still records one undo step", async () => {
  class FakeTimers {
    constructor() { this.now = 0; this.nextId = 1; this.tasks = new Map(); }
    setTimeout(callback, delay) {
      const id = this.nextId++;
      this.tasks.set(id, { id, callback, due: this.now + delay });
      return id;
    }
    clearTimeout(id) { this.tasks.delete(id); }
    tick(ms) {
      const target = this.now + ms;
      for (;;) {
        const next = [...this.tasks.values()].filter((task) => task.due <= target)
          .sort((left, right) => left.due - right.due || left.id - right.id)[0];
        if (!next) break;
        this.now = next.due;
        this.tasks.delete(next.id);
        next.callback();
      }
      this.now = target;
    }
  }
  async function flush() { for (let i = 0; i < 24; i += 1) await Promise.resolve(); }
  const timers = new FakeTimers();
  const history = H.createPropertyHistory({ limit: 20 });
  const properties = [row({ key: "a", line: 3 }), row({ key: "b", line: 4 })];
  const inverse = [{ op: "prop.move", key: "b", after: "a" }];
  const reportBody = {
    ok: true, schema_version: 1, path: "notes/properties.md", dry_run: false, changed: true,
    fingerprint_before: "sha256:same", fingerprint_after: "sha256:same",
    inverse_ops: inverse, changes: ["moved"], properties,
  };
  const session = H.createPropertyUpdateSession({
    path: "notes/properties.md", expect: "sha256:same", properties,
  }, {
    timers, history,
    getGeneration: () => 0,
    saveEditors: async () => ({ ok: true }),
    spawnPreview: async () => ({ ok: true, report: { ...reportBody, dry_run: true } }),
    spawnApply: async () => ({ ok: true, report: reportBody, wrote: true }),
    spawnShow: async () => ({ ok: true, report: report(properties, "sha256:same") }),
    spawnVaultSync: async () => ({ ok: true }),
  });
  const result = await session.applyOps([{ op: "prop.move", key: "b", before: "a" }]);
  await flush();
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(result.report.fingerprint_before, result.report.fingerprint_after);
  assert.equal(session.getState().history.undo, 1);
  session.close();
  timers.tick(0);
});

test("paint exposes rename and move actions, a 120ms slide, and reduced-motion skip", async () => {
  const properties = [row({ key: "alpha", line: 3 }), row({ key: "beta", line: 4 })];
  const doc = editorDocument(false);
  const modal = new H.PropertyEditorModal({ document: doc }, {
    filePath: "notes/properties.md", report: report(properties),
  });
  modal.contentEl = new EditorElement("div", doc);
  const session = fakeSession({
    propertiesAfter: () => [row({ key: "beta", line: 3 }), row({ key: "alpha", line: 4 })],
    inverseOps: [{ op: "prop.move", key: "alpha", before: "beta" }],
  });
  modal.session = session;
  modal.editorEnsureSession = () => session;
  modal.selectedId = "alpha::3";
  const timers = [];
  modal.propertyEditorSetTimeout = (callback, delay) => {
    timers.push({ callback, delay });
    return timers.length;
  };
  modal.propertyEditorClearTimeout = () => {};
  await modal.propertyEditorMoveFocused("down");
  assert.equal(timers[0].delay, H.PROPERTY_EDITOR_REORDER_SLIDE_MS);
  let host = modal.contentEl.querySelector(".bob-property-editor");
  const sliding = host.querySelectorAll(".is-sliding-down");
  assert.ok(sliding.length >= 1, "successful moves add the 120 ms slide class");

  modal.menuOpen = true;
  modal.paintPropertyEditor();
  host = modal.contentEl.querySelector(".bob-property-editor");
  assert.ok(host.querySelector("[data-property-command='rename']"));
  assert.ok(host.querySelector("[data-property-command='move-down']"));
  assert.ok(host.querySelector("[data-property-command='move-up']"));
  assert.match(host.querySelector(".bob-property-editor-hints").textContent, /r rename/);

  H.propertyEditorSelectionFilterSetQuery(modal, "alpha");
  modal.menuOpen = true;
  modal.paintPropertyEditor();
  host = modal.contentEl.querySelector(".bob-property-editor");
  const reorder = host.querySelector("[data-property-command='reorder']");
  assert.equal(reorder.disabled, true);
  assert.equal(host.querySelector("[data-property-command='move-down']"), null);

  const closed = new H.PropertyEditorModal({ document: doc }, {
    filePath: "notes/properties.md", report: report(properties),
  });
  closed.contentEl = new EditorElement("div", doc);
  closed.session = fakeSession({
    propertiesAfter: () => [row({ key: "beta", line: 3 }), row({ key: "alpha", line: 4 })],
  });
  closed.editorEnsureSession = () => closed.session;
  closed.selectedId = "alpha::3";
  closed.propertyEditorReducedMotionOverride = true;
  const reducedTimers = [];
  closed.propertyEditorSetTimeout = (callback, delay) => { reducedTimers.push(delay); return 1; };
  await closed.propertyEditorMoveFocused("down");
  assert.equal(reducedTimers.length, 0);
  assert.equal(closed.propertyEditorSlide, null);

  modal.onClose();
  assert.equal(modal.closed, true);
  timers[0].callback();
});

test("rename and reorder paint do not spawn a writer until an explicit apply", () => {
  let creates = 0;
  const modal = modalFor(sourceRows());
  modal.editorEnsureSession = () => { creates += 1; return null; };
  modal.selectedId = "alpha::3";
  modal.propertyEditorStartRename();
  modal.propertyEditorBuildCurrentStage();
  modal.menuOpen = true;
  const plan = H.propertyEditorSourceMovePlan(modal.editorOrderedRows(), modal.selectedId, "down");
  assert.equal(plan.ok, true);
  assert.equal(creates, 0);
});
