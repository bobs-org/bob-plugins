// Property editor public entry points and props YAML excursion
// (bob-cli-pf.4.1.5 entrypoints-yaml): the `+` chord table, palette
// command, drawer hook and actions, public API targeting, species
// hand-offs, and the kind:"props" excursion with Done return.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestNotice {
  constructor(message) {
    TestNotice.messages.push(String(message));
  }
}
TestNotice.messages = [];

const editorInfoField = { info: true };
const editorLivePreviewField = { live: true };
const StateEffect = {
  define: () => {
    const type = { of(value) { return { type, value, is: (other) => other === type }; } };
    return type;
  },
};
const StateField = { define: (spec) => ({ stateField: true, spec }) };
class WidgetType {}
class RangeSetBuilder {
  constructor() { this.rows = []; }
  add(from, to, deco) { this.rows.push({ from, to, deco }); }
  finish() { return this.rows; }
}
const Decoration = {
  none: [],
  widget: (options) => ({ ...options, startSide: options.side }),
  replace: (options) => ({ ...options, startSide: 0, replace: true, spec: options, range(from, to) { return { from, to, value: this }; } }),
  set: (ranges) => ranges,
};
const EditorView = {
  decorations: { from: (field, get) => ({ facet: "decorations", field, get }) },
  editorAttributes: { of: (value) => value, from: (field, get) => ({ facet: "editorAttributes", field, get }) },
};
class TestModal {
  constructor(app) { this.app = app; }
  open() {}
  close() {}
}
class TestMarkdownView {}
class TestPluginSettingTab {}
class TestSetting {}

const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownRenderChild: class { constructor(el) { this.containerEl = el; } },
      MarkdownView: TestMarkdownView,
      Modal: TestModal,
      Notice: TestNotice,
      Plugin: class {},
      PluginSettingTab: TestPluginSettingTab,
      Setting: TestSetting,
      Platform: { isDesktopApp: true },
      normalizePath: (value) => value,
      editorInfoField,
      editorLivePreviewField,
      parseYaml: () => ({}),
    };
  }
  if (request === "@codemirror/state") {
    return { Prec: { highest: (value) => value }, StateEffect, StateField, RangeSetBuilder };
  }
  if (request === "@codemirror/view") {
    return { Decoration, WidgetType, ViewPlugin: { fromClass: (cls, options) => ({ cls, options }) }, EditorView };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
Module._load = originalLoad;
const H = LedgerToolsPlugin.helpers;

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
  }
  get textContent() {
    return this.nodeType === 3 ? this._text : this.children.map((child) => child.textContent).join("");
  }
  set textContent(value) {
    this._text = String(value);
    if (this.nodeType === 1) this.children = [];
  }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  hasAttribute(name) { return this.attrs.has(name); }
  removeAttribute(name) { this.attrs.delete(name); }
  appendChild(node) {
    if (node.parentNode && typeof node.parentNode.removeChild === "function") node.parentNode.removeChild(node);
    node.parentNode = this;
    this.children.push(node);
    return node;
  }
  removeChild(node) {
    const i = this.children.indexOf(node);
    if (i >= 0) this.children.splice(i, 1);
    node.parentNode = null;
    return node;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  addEventListener(type, fn) {
    const rows = this.listeners.get(type) || [];
    rows.push(fn);
    this.listeners.set(type, rows);
  }
  dispatchEvent(event) {
    const payload = event || {};
    if (!payload.target) payload.target = this;
    if (typeof payload.preventDefault !== "function") payload.preventDefault = () => {};
    for (const callback of this.listeners.get(payload.type) || []) callback(payload);
    return true;
  }
  click() { this.dispatchEvent({ type: "click" }); }
  keydown(key, extra = {}) { this.dispatchEvent({ type: "keydown", key, ...extra }); }
  matches(selector) {
    return String(selector).split(",").some((part) => {
      const value = part.trim();
      const cls = /^\.([\w-]+)$/.exec(value);
      const tag = /^[a-z][\w-]*$/i.exec(value);
      const attr = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(value);
      const taggedAttr = /^([a-z][\w-]*)\[([\w-]+)(?:="([^"]*)")?\]$/i.exec(value);
      const hasAttr = (name, expected) => this.attrs.has(name) && (expected === undefined || this.getAttribute(name) === expected);
      return Boolean(
        (cls && (this.getAttribute("class") || "").split(/\s+/).includes(cls[1]))
        || (tag && this.tagName === tag[0].toUpperCase())
        || (attr && hasAttr(attr[1], attr[2]))
        || (taggedAttr && this.tagName === taggedAttr[1].toUpperCase() && hasAttr(taggedAttr[2], taggedAttr[3])),
      );
    });
  }
  closest(selector) {
    let node = this;
    while (node) {
      if (node.nodeType === 1 && node.matches(selector)) return node;
      node = node.parentNode;
    }
    return null;
  }
  querySelectorAll(selector) {
    const found = [];
    const walk = (node) => {
      for (const child of node.children || []) {
        if (child.matches(selector)) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function makeDoc() {
  const doc = {
    createElement(tag) { return new FakeNode(tag, doc); },
    createTextNode(text) { return new FakeNode("", doc, String(text)); },
  };
  return doc;
}

function makeLeaf(path, source = "---\ntitle: x\n---\nbody\n") {
  const editor = {
    cursors: [],
    setCursor(pos) { this.cursors.push(pos); },
    scrollIntoView() {},
    focus() {},
  };
  const view = {
    file: { path },
    containerEl: null,
    editor,
    viewState: { type: "markdown", state: { mode: "preview", source: false, file: path } },
    async setViewState(next) { this.viewState = next; },
    getState() { return { ...(this.viewState.state || {}), file: path }; },
    async setState(next) { this.viewState = { type: "markdown", state: { ...next, file: path } }; },
    async openFile(file, options) { this.file = file; this.openOptions = options; },
  };
  const leaf = {
    view,
    workspaceState: { type: "markdown", state: { mode: "preview", source: false, file: path } },
    async getViewState() { return this.workspaceState; },
    async setViewState(next) { this.workspaceState = next; },
    async openFile(file, options) { this.view.file = file; this.openOptions = options; },
    source,
  };
  return leaf;
}

function makeApp({ files = ["notes/groceries.md"], activePath = "notes/groceries.md", frontmatter = { title: "x" } } = {}) {
  const vaultFiles = new Map(files.map((path) => [path, "---\ntitle: x\ncount: 1\n---\nbody\n"]));
  const leaf = activePath ? makeLeaf(activePath) : null;
  return {
    vault: {
      getAbstractFileByPath: (path) => (vaultFiles.has(path) ? { path } : null),
      read: async (file) => vaultFiles.get(file && file.path) ?? null,
    },
    metadataCache: {
      getFileCache: (file) => (file && vaultFiles.has(file.path) ? { frontmatter } : null),
    },
    workspace: {
      activeLeaf: leaf,
      leaves: leaf ? [leaf] : [],
      getLeavesOfType: () => (leaf ? [leaf] : []),
      getMostRecentLeaf: () => leaf,
      getActiveViewOfType: () => (leaf ? leaf.view : null),
      setActiveLeaf: () => {},
      openLinkText: async () => {},
    },
  };
}

function makeEntrypoints(app) {
  const inst = Object.create(LedgerToolsPlugin.prototype);
  inst.app = app;
  inst.commands = [];
  inst.addCommand = (spec) => { inst.commands.push(spec); return spec; };
  inst.apiPropertyShow = async () => ({ ok: false, code: "unavailable", message: "offline" });
  return inst;
}

function showReport(rows) {
  return {
    schema_version: 1,
    ok: true,
    path: "notes/groceries.md",
    note_kind: "note",
    capabilities: ["props_v1"],
    fingerprint: "sha256:aaa",
    frontmatter: { state: "ok", start_line: 1, end_line: 4 },
    properties: rows,
  };
}

function wireRow(overrides = {}) {
  return {
    key: "title",
    line: 2,
    end_line: 2,
    value: "Hello",
    kind: "text",
    style: {},
    role: "loose",
    owner: "props",
    editor: null,
    reason: null,
    duplicate: false,
    opaque: false,
    ...overrides,
  };
}

test("entry paths accept Markdown and resolve explicit over active", () => {
  assert.equal(H.propertyEditorEntryIsMarkdownPath("notes/groceries.md"), true);
  assert.equal(H.propertyEditorEntryIsMarkdownPath("notes/GROCERIES.MD"), true);
  assert.equal(H.propertyEditorEntryIsMarkdownPath("notes/groceries.txt"), false);
  assert.equal(H.propertyEditorEntryIsMarkdownPath(""), false);
  assert.equal(H.propertyEditorEntryIsMarkdownPath(null), false);
  const app = makeApp({ activePath: "notes/active.md", files: ["notes/active.md", "notes/other.md"] });
  const inst = makeEntrypoints(app);
  assert.deepEqual(H.propertyEditorEntryResolvePath(inst, { filePath: "notes/other.md" }), { ok: true, path: "notes/other.md" });
  assert.deepEqual(H.propertyEditorEntryResolvePath(inst, {}), { ok: true, path: "notes/active.md" });
  const empty = makeEntrypoints(makeApp({ files: [], activePath: "" }));
  empty.app.workspace.activeLeaf = null;
  assert.deepEqual(H.propertyEditorEntryResolvePath(empty, {}), { ok: false, reason: "missing-path" });
});

test("species hand-off maps owners and refuses unknown editors", () => {
  assert.equal(H.propertyEditorHandoffSpecies({ owner: "record", editor: "==" }), "record");
  assert.equal(H.propertyEditorHandoffSpecies({ owner: "intentions", editor: "==" }), "intentions");
  assert.equal(H.propertyEditorHandoffSpecies({ owner: "album", editor: "==" }), "album");
  assert.equal(H.propertyEditorHandoffSpecies({ owner: "bank", editor: "==" }), "bank");
  assert.equal(H.propertyEditorHandoffSpecies({ owner: "props", editor: null }), null);
  assert.equal(H.propertyEditorHandoffSpecies({ owner: "", editor: "==" }), null);
  assert.equal(H.propertyEditorHandoffSpecies({}), null);
});

test("recovery line prefers the earliest row, then frontmatter, then line one", () => {
  assert.equal(H.propertyEditorYamlIssueLine(showReport([wireRow({ key: "b", line: 4 }), wireRow({ key: "a", line: 3 })])), 3);
  assert.equal(H.propertyEditorYamlIssueLine({ frontmatter: { start_line: 7 } }), 7);
  assert.equal(H.propertyEditorYamlIssueLine({}), 1);
  assert.equal(H.propertyEditorYamlIssueLine(null), 1);
});

const actingVim = Object.freeze({
  readable: true,
  insertMode: false,
  visualMode: false,
  replaceMode: false,
  operator: "indentAuto",
  keyBufferEmpty: true,
  countPending: false,
  registerPending: false,
});

function plusGateInput(overrides = {}) {
  return {
    key: "+",
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: true,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
    inEditor: true,
    livePreview: true,
    vim: actingVim,
    canHandleKey: true,
    arm: { key: "+", canAct: () => true, run: () => {} },
    context: {},
    ...overrides,
  };
}

test("the + chord acts on clean pending equals, shifted included, and every guard refuses", () => {
  assert.equal(H.propertyCardSecondKeyGate(plusGateInput()).act, true);
  assert.equal(H.propertyCardSecondKeyGate(plusGateInput({ shiftKey: false })).act, true);
  for (const [name, override] of [
    ["modified", { ctrlKey: true }],
    ["repeat", { repeat: true }],
    ["composing", { isComposing: true }],
    ["outside-editor", { inEditor: false }],
    ["not-live-preview", { livePreview: false }],
    ["no-vim", { vim: { ...actingVim, readable: false } }],
    ["insert", { vim: { ...actingVim, insertMode: true } }],
    ["counted", { vim: { ...actingVim, countPending: true } }],
    ["register", { vim: { ...actingVim, registerPending: true } }],
    ["operator", { vim: { ...actingVim, operator: "delete" } }],
    ["unregistered-arm", { arm: null }],
    ["arm-refuses", { arm: { key: "+", canAct: () => false, run: () => {} } }],
  ]) {
    assert.equal(H.propertyCardSecondKeyGate(plusGateInput(override)).act, false, name);
  }
});

test("setup registers the palette command, the + arm, and the drawer hook", () => {
  const inst = makeEntrypoints(makeApp());
  try {
    inst.setupPropertyEditorEntrypoints();
    const command = inst.commands.find((item) => item.id === "edit-note-properties");
    assert.ok(command, "palette command registered");
    assert.equal(command.name, "Edit note properties");
    const arm = inst.propertyCardSecondKeyArmRegistry().get("+");
    assert.ok(arm, "+ arm registered");
    assert.equal(arm.canAct({ path: "notes/groceries.md" }), true);
    assert.equal(arm.canAct({ path: "notes/groceries.txt" }), false);
    assert.equal(arm.canAct({}), false);
    const handlers = H.propertyCardFootAdapterHandlers(inst, "notes/groceries.md", {});
    assert.equal(typeof handlers.onOpenEditor, "function");
    assert.equal(typeof handlers.onAddProperty, "function");
    assert.equal(typeof handlers.onEditAll, "function");
  } finally {
    inst.teardownPropertyEditorEntrypoints();
  }
  const cleared = H.propertyCardFootAdapterHandlers(inst, "notes/groceries.md", {});
  assert.equal(cleared.onOpenEditor, null);
  assert.equal(cleared.onAddProperty, null);
  assert.equal(cleared.onEditAll, null);
});

test("drawer opener actions route through the editor hook with add/browse modes", async () => {
  const inst = makeEntrypoints(makeApp());
  try {
    inst.setupPropertyEditorEntrypoints();
    const hookCalls = [];
    H.propertyCardFootSetEditorHook((path, options = {}) => { hookCalls.push({ path, options }); });
    const handlers = H.propertyCardFootAdapterHandlers(inst, "notes/groceries.md", {});
    handlers.onOpenEditor("title");
    handlers.onAddProperty();
    handlers.onEditAll();
    assert.deepEqual(hookCalls, [
      { path: "notes/groceries.md", options: { key: "title", mode: undefined } },
      { path: "notes/groceries.md", options: { key: undefined, mode: "add" } },
      { path: "notes/groceries.md", options: { key: undefined, mode: "browse" } },
    ]);
  } finally {
    inst.teardownPropertyEditorEntrypoints();
  }
});

test("record sheet drawer exposes the same hook-gated opener actions", () => {
  const inst = makeEntrypoints(makeApp());
  try {
    inst.setupPropertyEditorEntrypoints();
    const handlers = inst.recordSheetFootHandlers("records/r.md");
    assert.equal(typeof handlers.onOpenEditor, "function");
    assert.equal(typeof handlers.onAddProperty, "function");
    assert.equal(typeof handlers.onEditAll, "function");
  } finally {
    inst.teardownPropertyEditorEntrypoints();
  }
  const cleared = makeEntrypoints(makeApp()).recordSheetFootHandlers("records/r.md");
  assert.equal(cleared.onOpenEditor, null);
  assert.equal(cleared.onAddProperty, null);
  assert.equal(cleared.onEditAll, null);
});

test("drawer body shows Add and Edit-all actions only while the hook is registered", () => {
  const doc = makeDoc();
  const inventory = {
    state: "ok",
    groups: [{ id: "loose", rows: [{ key: "title", value: "Hello", valueState: "text", line: 2 }] }],
    count: 1,
  };
  const withHook = H.propertyCardFootBuildEl(doc, {
    path: "notes/groceries.md",
    disclosureId: "foot-1",
    open: true,
    inventory,
    stamp: null,
    handlers: { onToggle: () => {}, onOpenEditor: () => {}, onAddProperty: () => {}, onEditAll: () => {} },
  });
  assert.ok(withHook && withHook.element, "foot builds");
  const actions = withHook.element.querySelectorAll('[data-property-foot-action]');
  assert.deepEqual(actions.map((node) => node.getAttribute("data-property-foot-action")), ["add", "edit-all"]);
  assert.equal(actions[0].textContent, "＋ Add property");
  assert.equal(actions[1].textContent, "✎ Edit all =+");
  const keyButtons = withHook.element.querySelectorAll(".bob-property-card-foot-key-button");
  assert.equal(keyButtons.length, 1, "key label becomes a button while the hook is registered");

  const plain = H.propertyCardFootBuildEl(makeDoc(), {
    path: "notes/groceries.md",
    disclosureId: "foot-2",
    open: true,
    inventory,
    stamp: null,
    handlers: { onToggle: () => {} },
  });
  assert.equal(plain.element.querySelectorAll('[data-property-foot-action]').length, 0);
  assert.equal(plain.element.querySelectorAll(".bob-property-card-foot-key-button").length, 0);
});

test("drawer key buttons open the editor while value links keep navigating", () => {
  const doc = makeDoc();
  const inventory = {
    state: "ok",
    groups: [{ id: "loose", rows: [{ key: "link", value: "[[Target]]", valueState: "text", line: 2 }] }],
    count: 1,
  };
  const opened = [];
  const navigated = [];
  const built = H.propertyCardFootBuildEl(doc, {
    path: "notes/groceries.md",
    disclosureId: "foot-3",
    open: true,
    inventory,
    stamp: null,
    handlers: {
      onToggle: () => {},
      onOpenEditor: (key) => { opened.push(key); },
      onAddProperty: () => {},
      onEditAll: () => {},
      openPath: (target) => { navigated.push(target); },
    },
  });
  const keyButton = built.element.querySelector(".bob-property-card-foot-key-button");
  assert.ok(keyButton, "key button rendered");
  keyButton.click();
  assert.deepEqual(opened, ["link"]);
  keyButton.keydown("Enter");
  assert.deepEqual(opened, ["link", "link"]);
  const link = built.element.querySelector('a[data-href="[[Target]]"]') || built.element.querySelector("a");
  assert.ok(link, "value link rendered");
  link.click();
  assert.ok(navigated.length >= 1, "value link navigates instead of editing");
  assert.deepEqual(opened, ["link", "link"], "navigation never opens the editor");
});

test("openPropertyEditor refuses unusable targets with useful reasons", async () => {
  const unloaded = makeEntrypoints(makeApp());
  unloaded.propertyEditorEntrypointsActive = false;
  assert.deepEqual((await unloaded.openPropertyEditor({})).reason, "unloaded");

  const noActive = makeEntrypoints(makeApp({ files: [], activePath: "" }));
  noActive.app.workspace.activeLeaf = null;
  assert.deepEqual((await noActive.openPropertyEditor({})).reason, "missing-path");

  const text = makeEntrypoints(makeApp({ files: ["notes/a.txt"], activePath: "notes/a.txt" }));
  assert.deepEqual((await text.openPropertyEditor({})).reason, "non-markdown");

  const gone = makeEntrypoints(makeApp({ files: ["notes/kept.md"], activePath: "notes/kept.md" }));
  assert.deepEqual((await gone.openPropertyEditor({ filePath: "notes/missing.md" })).reason, "missing-note");
});

test("openPropertyEditor opens the shared modal and resolves the active note", async () => {
  const inst = makeEntrypoints(makeApp());
  try {
    inst.setupPropertyEditorEntrypoints();
    const first = await inst.openPropertyEditor({});
    assert.equal(first.ok, true);
    assert.equal(first.modal.filePath, "notes/groceries.md");
    assert.equal(first.modal.mode, "browse");
    assert.equal(inst.propertyEditorModal, first.modal);
    const explicit = await inst.openPropertyEditor({ filePath: "notes/groceries.md", key: "title", mode: "add" });
    assert.equal(explicit.ok, true);
    assert.equal(explicit.modal.mode, "add");
    assert.equal(explicit.modal.filePath, "notes/groceries.md");
    const busy = inst.propertyEditorModal;
    busy.pendingApply = true;
    const refused = await inst.openPropertyEditor({});
    assert.deepEqual(refused, { ok: false, reason: "busy" });
    busy.pendingApply = false;
  } finally {
    inst.teardownPropertyEditorEntrypoints();
  }
  assert.equal(inst.propertyEditorModal, null, "teardown closes the modal");
});

function fakeHandoffModal(filePath = "notes/groceries.md") {
  return {
    filePath,
    closed: false,
    closes: 0,
    painted: 0,
    refusal: null,
    status: null,
    close() { this.closed = true; this.closes += 1; },
    paintPropertyEditor() { this.painted += 1; },
  };
}

test("species hand-offs close the modal and pass the field", async () => {
  const inst = makeEntrypoints(makeApp());
  const calls = [];
  inst.openRecordCard = async (options) => { calls.push(["record", options]); return { ok: true }; };
  inst.openIntentionCard = async (options) => { calls.push(["intentions", options]); return { ok: true }; };
  inst.openAlbumSchemaEntry = async (options) => { calls.push(["album", options]); return { ok: true }; };
  inst.openBankSetupCard = async (options) => { calls.push(["bank", options]); return { ok: true }; };
  const modal = fakeHandoffModal();
  inst.propertyEditorModal = modal;
  await inst.propertyEditorHandoff({ modal, key: "field", owner: "record", editor: "==" });
  await inst.propertyEditorHandoff({ modal: fakeHandoffModal(), key: "summary", owner: "intentions", editor: "==" });
  await inst.propertyEditorHandoff({ modal: fakeHandoffModal(), key: "record", owner: "album", editor: "==" });
  await inst.propertyEditorHandoff({ modal: fakeHandoffModal(), key: "bank", owner: "bank", editor: "==" });
  assert.deepEqual(calls, [
    ["record", { filePath: "notes/groceries.md", field: "field" }],
    ["intentions", { filePath: "notes/groceries.md", field: "summary" }],
    ["album", { filePath: "notes/groceries.md", field: "record" }],
    ["bank", {}],
  ]);
  assert.equal(modal.closed, true, "hand-off closes the property modal");
});

test("ordinary notes keep the modal open with a missing-route explanation", async () => {
  const inst = makeEntrypoints(makeApp());
  const modal = fakeHandoffModal();
  const outcome = await inst.propertyEditorHandoff({ modal, key: "title", owner: "props", editor: null });
  assert.deepEqual(outcome, { ok: false, reason: "no-route" });
  assert.equal(modal.closed, false, "the modal stays open without a species editor");
  assert.equal(modal.refusal.code, "no-route");
  assert.match(modal.refusal.hint, /YAML/);
  assert.equal(modal.painted, 1);
});

test("browse equals hands card rows to the species editor and keeps drafts", async () => {
  const handed = [];
  const plugin = { onCardHandoff: undefined, onYamlEscape: undefined };
  const modal = new H.PropertyEditorModal({}, {
    plugin,
    filePath: "notes/groceries.md",
    report: showReport([wireRow({ key: "field", role: "card", owner: "record", editor: "==", line: 2 })]),
  });
  modal.onCardHandoff = (info) => { handed.push(info); };
  await modal.propertyEditorPerform("equals");
  assert.equal(handed.length, 1);
  assert.equal(handed[0].owner, "record");

  handed.length = 0;
  modal.stage = { id: "draft" };
  modal.announce = "";
  await modal.propertyEditorPerform("equals");
  assert.equal(handed.length, 0, "an open draft never routes");
  assert.match(modal.announce, /drafting/);

  modal.stage = null;
  modal.addName = { name: "n" };
  await modal.propertyEditorPerform("equals");
  assert.equal(handed.length, 0, "an open add draft never routes");
});

test("props excursion begins with the note path and stays leaf-pinned", () => {
  const inst = makeEntrypoints(makeApp());
  const leaf = makeLeaf("notes/groceries.md");
  inst.app.workspace.leaves = [leaf];
  inst.app.workspace.activeLeaf = leaf;
  const record = inst.albumYamlExcursionBegin(leaf, {
    kind: "props",
    notePath: "notes/groceries.md",
    viewState: { type: "markdown", state: {} },
    selectedKey: "title",
    reopenCard: true,
  });
  assert.ok(record, "excursion begins");
  assert.equal(record.kind, "props");
  assert.equal(H.albumYamlExcursionOwnPath(record), "notes/groceries.md");
  assert.equal(inst.albumYamlExcursionStillCurrent(leaf, record), true);
  leaf.view.file = { path: "notes/other.md" };
  assert.equal(inst.albumYamlExcursionStillCurrent(leaf, record), false, "leaf switches never follow");
  assert.equal(inst.albumYamlExcursionForLeaf(leaf), record, "the record stays until cleared");
});

test("y excursion jumps to the reported key line and installs Done state", async () => {
  const inst = makeEntrypoints(makeApp());
  const leaf = inst.app.workspace.activeLeaf;
  inst.apiPropertyShow = async () => ({
    ok: true,
    report: showReport([wireRow({ key: "title", line: 2 }), wireRow({ key: "count", line: 5, value: 1, kind: "number" })]),
  });
  const outcome = await inst.propertyEditorStartYamlExcursion({ filePath: "notes/groceries.md", key: "count" });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.line, 5, "the reported source line wins over the text scan");
  const record = inst.albumYamlExcursionForLeaf(leaf);
  assert.ok(record, "excursion record installed");
  assert.equal(record.kind, "props");
  assert.equal(record.selectedKey, "count");
  assert.deepEqual(leaf.openOptions, { state: { mode: "source", source: true } });
  assert.equal(leaf.view.file.path, "notes/groceries.md");
});

test("YAML recovery uses the parser line even when a cached key is selected", async () => {
  for (const [state, line] of [["invalid", 4], ["unclosed", 1]]) {
    const inst = makeEntrypoints(makeApp());
    const report = showReport([wireRow({ key: "title", line: 2 })]);
    report.frontmatter = { state, start_line: 1, error: { message: "damaged YAML", line } };
    inst.apiPropertyShow = async () => ({ ok: true, report });
    const outcome = await inst.propertyEditorYamlEscape({ filePath: report.path, key: "title" });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.line, line, state);
  }
});

test("YAML escape retains the selected duplicate occurrence through modal close", async () => {
  const inst = makeEntrypoints(makeApp());
  const report = showReport([
    wireRow({ key: "title", line: 2, duplicate: true }),
    wireRow({ key: "title", line: 3, duplicate: true }),
  ]);
  report.frontmatter = { state: "invalid", start_line: 1, error: { code: "prop_duplicate_key", line: 2 } };
  inst.apiPropertyShow = async () => ({ ok: true, report });
  let excursion;
  const modal = new H.PropertyEditorModal(inst.app, {
    plugin: inst, filePath: report.path, report,
    onYamlEscape: (info) => { excursion = inst.propertyEditorYamlEscape(info); },
  });
  modal.selectedId = "title::3";
  modal.close = () => { modal.closed = true; inst.propertyEditorModal = null; };
  inst.propertyEditorModal = modal;
  await modal.propertyEditorPerform("yaml");
  const outcome = await excursion;
  assert.equal(modal.closed, true);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.line, 3, "the second occurrence must not collapse to the first key");
});

test("Done refuses stale excursions and failed saves without reopening", async () => {
  const inst = makeEntrypoints(makeApp());
  const leaf = makeLeaf("notes/groceries.md");
  const record = inst.albumYamlExcursionBegin(leaf, { kind: "props", notePath: "notes/groceries.md", selectedKey: "title" });
  let opened = 0;
  inst.openPropertyEditor = async () => { opened += 1; return { ok: true }; };
  inst.albumYamlSaveExcursionEditors = async () => ({ ok: false, code: "save-failed", message: "nope" });
  const failed = await inst.propertyEditorYamlDoneAttempt(leaf, record);
  assert.deepEqual(failed, { ok: false, reason: "save-failed" });
  assert.equal(opened, 0);

  inst.albumYamlSaveExcursionEditors = async () => ({ ok: true });
  const other = makeLeaf("notes/other.md");
  const stale = await inst.propertyEditorYamlDoneAttempt(other, record);
  assert.deepEqual(stale, { ok: false, reason: "stale-excursion" });
  assert.equal(opened, 0);
});

test("Done saves, restores the leaf mode, and reopens the surviving key", async () => {
  const inst = makeEntrypoints(makeApp());
  const leaf = makeLeaf("notes/groceries.md");
  leaf.workspaceState = { type: "markdown", state: { mode: "preview", source: false, file: "notes/groceries.md" } };
  const record = inst.albumYamlExcursionBegin(leaf, {
    kind: "props",
    notePath: "notes/groceries.md",
    viewState: leaf.workspaceState,
    selectedKey: "gone",
    reopenCard: true,
  });
  const saved = [];
  inst.albumYamlSaveExcursionEditors = async (paths) => { saved.push(paths); return { ok: true }; };
  inst.apiPropertyShow = async () => ({
    ok: true,
    report: showReport([wireRow({ key: "title", line: 2 }), wireRow({ key: "count", line: 3, value: 1, kind: "number" })]),
  });
  const reopened = [];
  inst.openPropertyEditor = async (options) => { reopened.push(options); return { ok: true, modal: {} }; };
  const outcome = await inst.propertyEditorYamlDoneAttempt(leaf, record);
  assert.deepEqual(outcome, { ok: true, reopened: true });
  assert.deepEqual(saved, [["notes/groceries.md"]], "every target pane saves before Done restores");
  assert.equal(leaf.workspaceState.state.mode, "preview", "the leaf mode is restored");
  assert.deepEqual(reopened, [{ filePath: "notes/groceries.md", key: "title" }], "nearest surviving row reopens");
  assert.equal(inst.albumYamlExcursionForLeaf(leaf), null, "the excursion clears after Done");
});

test("Done reopens recovery mode when the YAML stays damaged", async () => {
  const inst = makeEntrypoints(makeApp());
  const leaf = makeLeaf("notes/groceries.md");
  const record = inst.albumYamlExcursionBegin(leaf, {
    kind: "props",
    notePath: "notes/groceries.md",
    viewState: leaf.workspaceState,
    selectedKey: "title",
    reopenCard: true,
  });
  inst.albumYamlSaveExcursionEditors = async () => ({ ok: true });
  inst.apiPropertyShow = async () => ({ ok: false, code: "failed", message: "no report" });
  const reopened = [];
  inst.openPropertyEditor = async (options) => { reopened.push(options); return { ok: true, modal: {} }; };
  const outcome = await inst.propertyEditorYamlDoneAttempt(leaf, record);
  assert.deepEqual(outcome, { ok: true, reopened: true });
  assert.deepEqual(reopened, [{ filePath: "notes/groceries.md", key: "title" }], "the kept key reopens in recovery");
});

