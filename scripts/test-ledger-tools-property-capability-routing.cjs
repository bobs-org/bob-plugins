// Property capability routing: session-and-bob-path cache, actual-ownership
// query, Add file property command wrapper, and owned-scope focus routing
// (bob-cli-pf.6.1.2); coordinator acquisition and invalidation are covered
// by test-ledger-tools-property-card-frontmatter-ownership.cjs.
const assert = require("node:assert/strict");
const test = require("node:test");
const Module = require("node:module");

class TestPlugin {
  constructor(app) { this.app = app; }
  registerEditorExtension(extension) { (this.extensions ||= []).push(extension); }
  registerMarkdownPostProcessor(handler, order) { (this.postProcessors ||= []).push({ handler, order }); }
  registerEvent(ref) { (this.events ||= []).push(ref); return ref; }
}

const editorInfoField = { info: true };
const editorLivePreviewField = { live: true };
const Platform = { isDesktopApp: true };
const StateEffect = { define: () => { const type = { of(value) { return { type, value, is: (other) => other === type }; } }; return type; } };
const StateField = { define: (spec) => ({ stateField: true, spec }) };
class WidgetType {}
class RangeSetBuilder { constructor() { this.rows = []; } add(from, to, deco) { this.rows.push({ from, to, deco }); } finish() { return this.rows; } }
const Decoration = {
  none: [],
  widget: (options) => ({ ...options }),
  replace: (spec) => ({ spec, range(from, to) { return { from, to, value: this }; } }),
  set: (ranges) => ranges,
};
const EditorView = {
  decorations: { from: (field, get) => ({ facet: "decorations", field, get }) },
  editorAttributes: { of: (value) => value, from: (field, get) => ({ facet: "editorAttributes", field, get }) },
};
const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownRenderChild: class { constructor(el) { this.containerEl = el; } },
    Notice: class {}, Plugin: TestPlugin, Platform,
    normalizePath: (value) => value, editorInfoField, editorLivePreviewField,
  };
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value }, StateEffect, StateField, RangeSetBuilder };
  if (request === "@codemirror/view") return {
    Decoration, WidgetType, EditorView, ViewPlugin: { fromClass: (cls, options) => ({ cls, options }) },
  };
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers: H } = LedgerToolsPlugin;
Module._load = originalLoad;

async function flushMicrotasks() {
  for (let i = 0; i < 48; i += 1) await Promise.resolve();
}

// --- Fake DOM (mirrors the frontmatter-ownership fixture) ---

class FakeText {
  constructor(text, doc) { this.nodeType = 3; this.nodeValue = String(text); this.ownerDocument = doc; this.parentNode = null; }
  get textContent() { return this.nodeValue; }
  contains(node) { return node === this; }
}
class FakeNode {
  constructor(tag, doc) {
    this.tagName = String(tag).toUpperCase();
    this.nodeType = 1;
    this.ownerDocument = doc;
    this.parentNode = null;
    this.childNodes = [];
    this.attrs = new Map();
    this.listeners = new Map();
    this.inert = false;
    this.focused = false;
    const self = this;
    this.classList = {
      add(name) { const xs = new Set(self.className.split(/\s+/).filter(Boolean)); xs.add(name); self.setAttribute("class", [...xs].join(" ")); },
      remove(name) { self.setAttribute("class", self.className.split(/\s+/).filter((x) => x && x !== name).join(" ")); },
      contains(name) { return self.className.split(/\s+/).includes(name); },
    };
  }
  get className() { return this.getAttribute("class") || ""; }
  get children() { return this.childNodes.filter((node) => node.nodeType === 1); }
  get textContent() { return this.childNodes.map((node) => node.textContent).join(""); }
  setAttribute(name, value) {
    this.attrs.set(name, String(value));
    if (name === "inert") this.inert = true;
  }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  removeAttribute(name) {
    this.attrs.delete(name);
    if (name === "inert") this.inert = false;
  }
  appendChild(node) { node.parentNode?.removeChild?.(node); node.parentNode = this; this.childNodes.push(node); return node; }
  removeChild(node) { const i = this.childNodes.indexOf(node); if (i >= 0) this.childNodes.splice(i, 1); node.parentNode = null; return node; }
  contains(node) { return node === this || this.childNodes.some((child) => child.contains(node)); }
  matches(selector) {
    return String(selector).split(",").some((raw) => {
      const part = raw.trim();
      const tag = /^([a-z][a-z0-9-]*)/i.exec(part)?.[1];
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      const cls = part.match(/\.[\w-]+/g) || [];
      if (!tag && !cls.length) return false;
      return cls.every((name) => this.classList.contains(name.slice(1)));
    });
  }
  closest(selector) { let node = this; while (node) { if (node.nodeType === 1 && node.matches(selector)) return node; node = node.parentNode; } return null; }
  querySelectorAll(selector) {
    const found = [];
    const walk = (node) => { for (const child of node.children) { if (child.matches(selector)) found.push(child); walk(child); } };
    walk(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(type, fn) {
    const list = this.listeners.get(type) || [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  removeEventListener(type, fn) {
    const list = (this.listeners.get(type) || []).filter((item) => item !== fn);
    this.listeners.set(type, list);
  }
  dispatch(type, event) {
    for (const fn of this.listeners.get(type) || []) fn(event);
  }
  focus() { this.focused = true; }
}

function makeDoc() {
  const observers = [];
  const doc = {
    observers,
    createElement(tag) { return new FakeNode(tag, doc); },
    createTextNode(text) { return new FakeText(text, doc); },
    defaultView: {
      MutationObserver: class {
        constructor(callback) { this.callback = callback; observers.push(this); }
        observe(target, options) { this.target = target; this.options = options; this.connected = true; }
        disconnect() { this.connected = false; }
        trigger() { if (this.connected) this.callback([]); }
      },
    },
  };
  return doc;
}

function el(doc, tag, cls, ...kids) {
  const node = doc.createElement(tag);
  if (cls) node.setAttribute("class", cls);
  for (const kid of kids) node.appendChild(typeof kid === "string" ? doc.createTextNode(kid) : kid);
  return node;
}

function liveFixture(doc = makeDoc()) {
  const scope = el(doc, "div", "cm-editor");
  const scroller = el(doc, "div", "cm-scroller");
  const sizer = el(doc, "div", "cm-sizer");
  const title = el(doc, "div", "inline-title", "Note");
  const container = el(doc, "div", "metadata-container");
  const input = el(doc, "input", "metadata-input");
  const contentWrap = el(doc, "div", "cm-contentContainer");
  const content = el(doc, "div", "cm-content");
  container.appendChild(el(doc, "div", "metadata-property", input));
  contentWrap.appendChild(content);
  sizer.appendChild(title);
  sizer.appendChild(container);
  sizer.appendChild(contentWrap);
  scroller.appendChild(sizer);
  scope.appendChild(scroller);
  return { doc, scope, sizer, title, container, input, content };
}

function readingFixture(doc = makeDoc()) {
  const scope = el(doc, "div", "markdown-preview-view");
  const sizer = el(doc, "div", "markdown-preview-sizer");
  const header = el(doc, "div", "mod-header");
  const title = el(doc, "div", "inline-title", "Note");
  const container = el(doc, "div", "metadata-container");
  const input = el(doc, "input", "metadata-input");
  container.appendChild(el(doc, "div", "metadata-property", input));
  header.appendChild(title);
  header.appendChild(container);
  sizer.appendChild(header);
  scope.appendChild(sizer);
  return { doc, scope, sizer, header, title, container, input };
}

function fakeState({ path = "note.md", live = true, fields = new Map() } = {}) {
  return {
    field(field) {
      if (field === editorLivePreviewField) return live;
      if (field === editorInfoField) return { file: path === null ? null : { path } };
      return fields.has(field) ? fields.get(field) : undefined;
    },
  };
}

function tr(state, effects = []) {
  return { effects, state, startState: state };
}

function fakeEditorView({ live = true, path = "note.md" } = {}) {
  const fx = liveFixture();
  const field = H.propertyCardFrontmatterOwnershipExtension();
  const fields = new Map([[field, H.propertyCardFrontmatterFieldCreate()]]);
  const view = { dom: fx.scope, dispatched: [], live, path, focused: false, contentDOM: fx.content, fx };
  const stateFor = () => fakeState({ path: view.path, live: view.live, fields });
  view.state = stateFor();
  view.dispatch = (spec) => {
    view.dispatched.push(spec);
    const next = stateFor();
    fields.set(field, H.propertyCardFrontmatterFieldReduce(fields.get(field), tr(next, [].concat(spec.effects || []))));
    view.state = next;
    H.propertyCardFrontmatterSyncEditor(view);
  };
  view.owner = () => fields.get(field).owner;
  view.__setOwner = (owner) => fields.set(field, { owner });
  view.focus = () => { view.focused = true; fx.content.focused = true; };
  return view;
}

function deferQueue() {
  const jobs = [];
  const defer = (fn) => jobs.push(fn);
  defer.flush = () => { while (jobs.length) jobs.shift()(); };
  return defer;
}

// --- Fake Obsidian app ---

function makeCommands() {
  const table = {};
  return {
    table,
    commands: {
      commands: table,
      executeCommandById(id, ...args) {
        const command = table[id];
        if (!command) return false;
        if (typeof command.checkCallback === "function") return command.checkCallback(false, ...args);
        if (typeof command.callback === "function") return command.callback(...args);
        return false;
      },
    },
  };
}

function addNativeAddPropertyCommand(commands, behavior = {}) {
  const calls = [];
  const original = {
    id: H.PROPERTY_CAPABILITY_COMMAND_ID,
    name: "Add file property",
    checkCallback(checking, ...args) {
      calls.push({ checking, args, receiver: this });
      if (checking === true) return behavior.checkResult !== undefined ? behavior.checkResult : true;
      calls[calls.length - 1].ran = true;
      return behavior.runResult !== undefined ? behavior.runResult : true;
    },
  };
  if (behavior.callbackOnly === true) {
    delete original.checkCallback;
    original.callback = function (...args) {
      calls.push({ checking: false, args, receiver: this, ran: true });
      return behavior.runResult !== undefined ? behavior.runResult : true;
    };
  }
  commands.table[H.PROPERTY_CAPABILITY_COMMAND_ID] = original;
  return { original, calls };
}

function makeApp({ files = ["note.md"], activePath = null, withCommand = true } = {}) {
  const vaultFiles = files.map((path) => ({ path, extension: "md" }));
  const commands = makeCommands();
  let native = null;
  if (withCommand) native = addNativeAddPropertyCommand(commands);
  const doc = makeDoc();
  const workspaceEl = el(doc, "div", "workspace");
  const app = {
    vault: {
      adapter: { basePath: "/fixture-vault" },
      getMarkdownFiles: () => vaultFiles.slice(),
      getAbstractFileByPath: (path) => vaultFiles.find((file) => file.path === path) || null,
      on: () => ({}),
    },
    metadataCache: {
      on: () => ({}),
      getFileCache: () => null,
    },
    workspace: {
      on: () => ({}),
      onLayoutReady: () => {},
      getLeavesOfType: () => [],
      activeLeaf: null,
      workspaceEl,
    },
    commands: commands.commands,
    __commands: commands,
    __native: native,
  };
  if (activePath !== null) {
    const contentEl = el(doc, "div", "markdown-main");
    const containerEl = el(doc, "div", "markdown-container");
    contentEl.appendChild(containerEl);
    const view = { file: { path: activePath }, contentEl, containerEl, editor: null };
    app.workspace.activeLeaf = { view };
    app.__activeView = view;
  }
  return app;
}

function mountScopeInActiveView(app, scope) {
  const view = app.__activeView;
  const host = view.containerEl || view.contentEl;
  host.appendChild(scope);
  return view;
}

function makePlugin(app, { bobPath = "/fixture/bin/bob", setupRouting = true } = {}) {
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.registerEvent = () => {};
  plugin.registerInterval = () => {};
  plugin.apiStatsBobPath = () => ({ path: bobPath, source: "candidate" });
  let refreshes = 0;
  plugin.propertyEditorRefreshDrawers = () => { refreshes += 1; };
  plugin.__refreshes = () => refreshes;
  plugin.setupPropertyUpdate();
  if (setupRouting) {
    // The setup schedule must not spawn in unit tests: hold its spawn and
    // reset the probe state so each test schedules deterministically.
    const realSpawn = plugin.propertySpawnJson;
    plugin.propertySpawnJson = () => new Promise(() => {});
    plugin.setupPropertyCapabilityRouting();
    plugin.propertySpawnJson = realSpawn;
    plugin.propertyCapabilityFlight = null;
    plugin.propertyCapabilityContractFlight = null;
    plugin.propertyCapabilityByBobPath.clear();
    plugin.propertyCapabilityProbePending = "";
    plugin.propertyCapabilityContractProbePending = "";
  }
  return plugin;
}

// --- Report builders ---

function showProperty(overrides = {}) {
  return {
    key: "count", line: 3, end_line: 3, value: 3, kind: "number",
    style: { flow: false }, role: "loose", owner: "props", editor: null,
    reason: null, duplicate: false, opaque: false, ...overrides,
  };
}

function showReport(overrides = {}) {
  return {
    schema_version: 1, ok: true, path: "note.md", note_kind: "note",
    capabilities: ["props_v1"], fingerprint: "sha256:before",
    frontmatter: { state: "ok", start_line: 1, end_line: 5 },
    properties: [showProperty()], ...overrides,
  };
}

function spawnStub(handler) {
  const calls = [];
  const execFile = (command, args, options, callback) => {
    calls.push({ command, args });
    handler(callback);
    return { stdin: { write() {}, end() {}, on() {} }, on() {} };
  };
  return { calls, execFile };
}

const showJson = (report) => (callback) => callback(null, JSON.stringify(report), "");
const oldBob = (callback) => callback({ code: 2 }, "", "error: unknown subcommand 'props'");
const badJson = (callback) => callback(null, "not json", "");
const missingNoteJson = (callback) => callback(null, JSON.stringify({
  schema_version: 1, ok: false,
  error: { code: "prop_not_found", message: "Note is missing." },
}), "");

// --- Pure helpers ---

test("capability helpers: keys, read-only probe argv, and eligible notes", () => {
  assert.equal(H.PROPERTY_CAPABILITY_COMMAND_ID, "markdown:add-metadata-property");
  assert.equal(H.propertyCapabilityBobKey({ path: "/bin/bob", source: "candidate" }), "candidate:/bin/bob");
  assert.equal(H.propertyCapabilityBobKey(null), "path:bob");
  assert.deepEqual(
    H.propertyCapabilityProbeArgs("note.md"),
    ["props", "show", "note.md", "-f", "json"],
  );
  const app = makeApp({ files: ["a.md", "b.md"], activePath: "a.md" });
  assert.equal(H.propertyCapabilityEligibleNotePath(app, "b.md"), "b.md");
  assert.equal(H.propertyCapabilityEligibleNotePath(app, "ghost.md"), "a.md");
  assert.equal(H.propertyCapabilityEligibleNotePath(app, ""), "a.md");
  const empty = makeApp({ files: [] });
  assert.equal(H.propertyCapabilityEligibleNotePath(empty, ""), "", "waits without manufacturing a note");
  // Vault contents alone never satisfy the probe: no walk, no manufacture.
  let walks = 0;
  const idle = makeApp({ files: ["a.md", "b.md"] });
  const originalWalks = idle.vault.getMarkdownFiles;
  idle.vault.getMarkdownFiles = () => { walks += 1; return originalWalks(); };
  assert.equal(H.propertyCapabilityEligibleNotePath(idle, ""), "");
  assert.equal(walks, 0, "eligible-note resolution never walks the vault");
});

test("classification: confirmed, absent, and unconfirmed outcomes", () => {
  assert.deepEqual(
    H.propertyCapabilityClassifyProbe({ ok: true, report: showReport() }),
    { status: "confirmed" },
  );
  assert.deepEqual(
    H.propertyCapabilityClassifyProbe({ ok: false, code: "needs-bob" }),
    { status: "absent", reason: "needs-bob" },
  );
  assert.deepEqual(
    H.propertyCapabilityClassifyProbe({ ok: true, report: showReport({ capabilities: [] }) }),
    { status: "absent", reason: "missing-capability" },
  );
  assert.equal(
    H.propertyCapabilityClassifyProbe({ ok: true, report: { ...showReport(), ok: false, error: { code: "prop_bad", message: "bad" } } }).status,
    "unconfirmed",
  );
  assert.equal(H.propertyCapabilityClassifyProbe({ ok: false, code: "timeout" }).status, "unconfirmed");
  assert.equal(H.propertyCapabilityClassifyProbe({ ok: false, code: "bad-json" }).status, "unconfirmed");
  assert.equal(H.propertyCapabilityClassifyProbe(null).status, "unconfirmed");
});

// --- Capability cache lifecycle ---

test("no usable note waits without spawning; a later lifecycle event probes", async () => {
  const app = makeApp({ files: [] });
  const plugin = makePlugin(app);
  try {
    const stub = spawnStub(showJson(showReport()));
    const first = plugin.schedulePropertyCapabilityProbe("setup", { execFile: stub.execFile });
    assert.equal(first, "no-note");
    assert.equal(stub.calls.length, 0);
    assert.equal(plugin.__refreshes(), 0);
    assert.equal(plugin.propertyCapabilityState().status, "unknown");
    // The user opens a note; the next lifecycle event probes it.
    const doc = makeDoc();
    const contentEl = el(doc, "div", "markdown-main");
    const containerEl = el(doc, "div", "markdown-container");
    contentEl.appendChild(containerEl);
    app.workspace.activeLeaf = { view: { file: { path: "fresh.md" }, contentEl, containerEl } };
    app.vault.getAbstractFileByPath = (path) => (path === "fresh.md" ? { path, extension: "md" } : null);
    const second = plugin.schedulePropertyCapabilityProbe("file-open", { execFile: stub.execFile });
    assert.equal(second, "probing");
    await flushMicrotasks();
    assert.equal(plugin.propertyCapabilityState().status, "confirmed");
    assert.equal(stub.calls[0].args.slice(0, 2).join(" "), "props show");
  } finally {
    plugin.teardownPropertyCapabilityRouting();
    plugin.teardownPropertyUpdate();
  }
});

test("in-flight probes deduplicate and confirmed paths schedule card refreshes", async () => {
  const app = makeApp({ files: ["note.md"], activePath: "note.md" });
  const plugin = makePlugin(app);
  try {
    const stub = spawnStub(showJson(showReport()));
    assert.equal(plugin.schedulePropertyCapabilityProbe("setup", { execFile: stub.execFile }), "probing");
    assert.equal(plugin.schedulePropertyCapabilityProbe("active-leaf-change", { execFile: stub.execFile }), "in-flight");
    assert.equal(stub.calls.length, 1, "one spawn for concurrent schedules");
    await flushMicrotasks();
    assert.equal(plugin.propertyCapabilityState().status, "confirmed");
    assert.equal(plugin.propertyCapability, true, "editor display mirrors the controller");
    assert.equal(plugin.__refreshes(), 1, "confirmation schedules card refreshes");
    assert.equal(plugin.schedulePropertyCapabilityProbe("file-open", { execFile: stub.execFile }), "confirmed");
    assert.equal(stub.calls.length, 1, "confirmed paths never re-probe");
  } finally {
    plugin.teardownPropertyCapabilityRouting();
    plugin.teardownPropertyUpdate();
  }
});

test("path switch discards the stale pending result", async () => {
  let bobPath = "/fixture/bin/bob-a";
  const app = makeApp({ files: ["note.md"], activePath: "note.md" });
  const plugin = makePlugin(app, { bobPath });
  plugin.apiStatsBobPath = () => ({ path: bobPath, source: "candidate" });
  try {
    const stub = spawnStub(() => {});
    const pending = plugin.schedulePropertyCapabilityProbe("setup", { execFile: stub.execFile });
    assert.equal(pending, "probing");
    // Hold the spawn open, switch the configured binary, then settle.
    const flight = plugin.propertyCapabilityFlight;
    assert.ok(flight);
    bobPath = "/fixture/bin/bob-b";
    const settle = plugin.propertyCapabilitySettleProbe(flight.key, flight.generation, {
      ok: true, report: showReport(),
    });
    assert.equal(settle, "path-changed");
    assert.equal(plugin.propertyCapabilityState().status, "unknown");
    assert.equal(plugin.propertyCapability || null, null, "stale success never marks the new path");
  } finally {
    plugin.teardownPropertyCapabilityRouting();
    plugin.teardownPropertyUpdate();
  }
});

test("teardown orphans pending probes and clears the session cache", async () => {
  const app = makeApp({ files: ["note.md"], activePath: "note.md" });
  const plugin = makePlugin(app);
  try {
    const stub = spawnStub(showJson(showReport()));
    assert.equal(plugin.schedulePropertyCapabilityProbe("setup", { execFile: stub.execFile }), "probing");
    const flight = plugin.propertyCapabilityFlight;
    plugin.teardownPropertyCapabilityRouting();
    assert.equal(plugin.propertyCapabilitySettleProbe(flight.key, flight.generation, {
      ok: true, report: showReport(),
    }), "inactive");
    assert.equal(plugin.propertyCapabilityState().status, "unknown");
    assert.equal(plugin.schedulePropertyCapabilityProbe("setup", { execFile: stub.execFile }), "inactive");
  } finally {
    plugin.teardownPropertyUpdate();
  }
});

test("transient failures retry on later events up to a bound, then wait", async () => {
  const app = makeApp({ files: ["note.md"], activePath: "note.md" });
  const plugin = makePlugin(app);
  try {
    const stub = spawnStub(badJson);
    for (let attempt = 1; attempt <= H.PROPERTY_CAPABILITY_MAX_PROBE_ATTEMPTS; attempt += 1) {
      assert.equal(plugin.schedulePropertyCapabilityProbe(`event-${attempt}`, { execFile: stub.execFile }), "probing");
      await flushMicrotasks();
      assert.equal(plugin.propertyCapabilityState().status, "unconfirmed");
    }
    assert.equal(stub.calls.length, H.PROPERTY_CAPABILITY_MAX_PROBE_ATTEMPTS);
    assert.equal(plugin.schedulePropertyCapabilityProbe("another-event", { execFile: stub.execFile }), "exhausted");
    assert.equal(stub.calls.length, H.PROPERTY_CAPABILITY_MAX_PROBE_ATTEMPTS, "no repaint retry loop");
  } finally {
    plugin.teardownPropertyCapabilityRouting();
    plugin.teardownPropertyUpdate();
  }
});

test("unrelated per-note errors never revoke a confirmed path", async () => {
  const app = makeApp({ files: ["note.md"], activePath: "note.md" });
  const plugin = makePlugin(app);
  try {
    const stub = spawnStub(showJson(showReport()));
    assert.equal(plugin.schedulePropertyCapabilityProbe("setup", { execFile: stub.execFile }), "probing");
    await flushMicrotasks();
    assert.equal(plugin.propertyCapabilityState().status, "confirmed");
    // A missing note on the same binary stays unconfirmed in the log only.
    assert.equal(plugin.propertyCapabilityNoteShowOutcome({ ok: false, code: "prop_not_found" }), "unconfirmed");
    assert.equal(plugin.propertyCapabilityState().status, "confirmed");
    assert.equal(plugin.propertyCapability, true);
    // An old binary records absence and mirrors the single value.
    assert.equal(plugin.propertyCapabilityNoteShowOutcome({ ok: false, code: "needs-bob" }), "absent");
    assert.equal(plugin.propertyCapabilityState().status, "absent");
    assert.equal(plugin.propertyCapability, false);
  } finally {
    plugin.teardownPropertyCapabilityRouting();
    plugin.teardownPropertyUpdate();
  }
});

test("actual-ownership observes live editor entries, not stale paint", () => {
  const view = fakeEditorView({ path: "note.md" });
  const defer = deferQueue();
  const handle = H.propertyCardOwnFrontmatterInEditor(view, { path: "note.md", defer });
  defer.flush();
  assert.ok(handle);
  const owned = H.propertyCardFrontmatterActualOwnership(view.dom, { view, path: "note.md" });
  assert.equal(owned.owned, true);
  assert.equal(owned.mode, "live");
  assert.equal(owned.generation, handle.generation);
  assert.equal(H.propertyCardFrontmatterActualOwnership(view.dom, { view, path: "other.md" }).owned, false);
  view.__setOwner({ path: "note.md", generation: handle.generation + 999 });
  assert.equal(
    H.propertyCardFrontmatterActualOwnership(view.dom, { view, path: "note.md" }).owned,
    false,
    "a stale field generation never reads as owned",
  );
  handle();
  defer.flush();
});

test("actual-ownership rejects class-only scopes, embeds, and wrong views", () => {
  const bare = liveFixture();
  bare.scope.classList.add("bob-property-card-owns-frontmatter");
  assert.equal(
    H.propertyCardFrontmatterActualOwnership(bare.scope, { path: "note.md" }).owned,
    false,
    "a tag without a live entry is not ownership",
  );
  const doc = makeDoc();
  const embed = el(doc, "div", "markdown-embed");
  const inner = liveFixture(doc);
  embed.appendChild(inner.scope);
  assert.equal(H.propertyCardOwnFrontmatter(inner.scope, { path: "note.md" }), null);
  assert.equal(H.propertyCardFrontmatterActualOwnership(inner.scope, { path: "note.md" }).owned, false);
  const fx = readingFixture();
  const held = H.propertyCardOwnFrontmatterInReading(fx.scope, { path: "note.md" });
  assert.ok(held);
  assert.equal(H.propertyCardFrontmatterActualOwnership(fx.scope, { path: "note.md" }).owned, true);
  assert.equal(H.propertyCardFrontmatterActualOwnership(fx.scope, { path: "other.md" }).owned, false);
  assert.equal(H.propertyCardFrontmatterReleaseScope(fx.scope, null), true);
  assert.equal(H.propertyCardFrontmatterActualOwnership(fx.scope, { path: "note.md" }).owned, false);
  assert.equal(H.propertyCardFrontmatterReleaseScope(fx.scope, null), false);
  held();
});

test("plugin query keys ownership by view scope and current path", () => {
  const app = makeApp({ files: ["note.md"], activePath: "note.md" });
  const plugin = makePlugin(app);
  try {
    const view = fakeEditorView({ path: "note.md" });
    mountScopeInActiveView(app, view.dom);
    const defer = deferQueue();
    const handle = H.propertyCardOwnFrontmatterInEditor(view, { path: "note.md", defer });
    defer.flush();
    const derived = plugin.propertyCardActualOwnership({});
    assert.equal(derived.owned, true);
    assert.equal(derived.mode, "live");
    assert.equal(derived.path, "note.md");
    assert.equal(derived.generation, handle.generation);
    assert.equal(plugin.propertyCardActualOwnership({ view: app.__activeView, path: "other.md" }).owned, false);
    assert.equal(
      plugin.propertyCardActualOwnership({ view: { file: { path: "other.md" } }, path: "note.md" }).owned,
      false,
      "a view showing another note never matches",
    );
    // Sidebar views carry no owned scope even when the main note is owned.
    const sidebar = { contentEl: el(makeDoc(), "div", "sidebar"), containerEl: null };
    assert.equal(plugin.propertyCardActualOwnership({ view: sidebar }).owned, false);
    assert.equal(plugin.propertyCapabilityReleaseOwnedScope(derived.scope, derived.view), true);
    assert.equal(plugin.propertyCardActualOwnership({}).owned, false);
    handle();
    defer.flush();
  } finally {
    plugin.teardownPropertyCapabilityRouting();
    plugin.teardownPropertyUpdate();
  }
});

test("legacy single-value behavior without routing setup", async () => {
  const app = makeApp({ files: ["note.md"], activePath: "note.md" });
  const plugin = makePlugin(app, { setupRouting: false });
  try {
    const shown = await plugin.apiPropertyShow("note.md", {
      execFile: spawnStub(showJson(showReport({ capabilities: [] }))).execFile,
      resolved: { path: "/fixture/bin/bob", source: "candidate" },
      vaultPath: "/fixture-vault",
    });
    assert.equal(shown.ok, true);
    assert.equal(plugin.propertyCapability, false, "legacy shape still clears on missing capability");
    assert.equal(plugin.apiPropertyUpdateCapable(), false);
  } finally {
    plugin.teardownPropertyUpdate();
  }
});

// --- Command wrapper ---

function ownEditorScope(app, path = "note.md") {
  const view = fakeEditorView({ path });
  mountScopeInActiveView(app, view.dom);
  const defer = deferQueue();
  const handle = H.propertyCardOwnFrontmatterInEditor(view, { path, defer });
  defer.flush();
  assert.ok(handle, "fixture owns its scope");
  return { editorView: view, scope: view.dom, handle, defer };
}

test("untouched scopes delegate with receiver, arguments, and check semantics", () => {
  const app = makeApp({ files: ["note.md"] });
  const nativeCheck = app.__commands.table[H.PROPERTY_CAPABILITY_COMMAND_ID].checkCallback;
  const plugin = makePlugin(app);
  try {
    const table = app.__commands.table;
    const wrapped = table[H.PROPERTY_CAPABILITY_COMMAND_ID];
    assert.ok(wrapped);
    assert.equal(wrapped.checkCallback, plugin.propertyCapabilityCommandRoute.wrapper);
    assert.equal(plugin.propertyCapabilityCommandRoute.original.checkCallback, nativeCheck);
    assert.equal(plugin.propertyCapabilityRoutingReady(), true);
    const openerCalls = [];
    plugin.openPropertyEditor = async (options) => { openerCalls.push(options); return { ok: true }; };
    const receiver = { name: "hotkey-dispatcher" };
    assert.equal(wrapped.checkCallback.call(receiver, true), true);
    assert.equal(app.__native.calls.length, 1);
    assert.equal(app.__native.calls[0].receiver, receiver, "callback context is preserved");
    assert.equal(app.__native.calls[0].checking, true);
    assert.equal(wrapped.checkCallback.call(receiver, false, "extra-arg"), true);
    assert.equal(app.__native.calls.length, 2);
    assert.deepEqual(app.__native.calls[1].args, ["extra-arg"]);
    assert.ok(app.__native.calls[1].ran);
    assert.equal(openerCalls.length, 0, "the editor never opens on untouched scopes");
    // Palette and custom bindings travel the same registered route.
    assert.equal(app.__commands.commands.executeCommandById(H.PROPERTY_CAPABILITY_COMMAND_ID), true);
    assert.equal(app.__native.calls.length, 3);
  } finally {
    plugin.teardownPropertyCapabilityRouting();
    plugin.teardownPropertyUpdate();
  }
});

test("owned scopes open the editor in Add mode; checks never open it", async () => {
  const app = makeApp({ files: ["note.md"], activePath: "note.md" });
  const plugin = makePlugin(app);
  try {
    const owned = ownEditorScope(app);
    void owned;
    const openerCalls = [];
    plugin.openPropertyEditor = async (options) => { openerCalls.push(options); return { ok: true }; };
    const table = app.__commands.table;
    const receiver = { name: "palette" };
    assert.equal(table[H.PROPERTY_CAPABILITY_COMMAND_ID].checkCallback.call(receiver, true), true);
    assert.equal(openerCalls.length, 0, "command checks never open the editor");
    assert.equal(app.__native.calls.length, 0);
    assert.equal(table[H.PROPERTY_CAPABILITY_COMMAND_ID].checkCallback.call(receiver, false), true);
    await flushMicrotasks();
    assert.deepEqual(openerCalls, [{ filePath: "note.md", mode: "add" }]);
    assert.equal(app.__native.calls.length, 0, "native stays out of owned scopes");
  } finally {
    plugin.teardownPropertyCapabilityRouting();
    plugin.teardownPropertyUpdate();
  }
});

test("a failed opener releases the scope before the native fallback", async () => {
  const app = makeApp({ files: ["note.md"], activePath: "note.md" });
  const plugin = makePlugin(app);
  try {
    ownEditorScope(app);
    assert.equal(plugin.propertyCardActualOwnership({}).owned, true);
    plugin.openPropertyEditor = async () => ({ ok: false, reason: "busy" });
    const table = app.__commands.table;
    assert.equal(table[H.PROPERTY_CAPABILITY_COMMAND_ID].checkCallback.call({}, false), true);
    await flushMicrotasks();
    assert.equal(plugin.propertyCardActualOwnership({}).owned, false, "the scope is released first");
    assert.equal(app.__native.calls.length, 1, "native fallback runs after the release");
    assert.equal(app.__native.calls[0].checking, false);
  } finally {
    plugin.teardownPropertyCapabilityRouting();
    plugin.teardownPropertyUpdate();
  }
});

test("teardown restores only its own wrapper; missing commands stay not-ready", () => {
  const app = makeApp({ files: ["note.md"] });
  const nativeCheck = app.__commands.table[H.PROPERTY_CAPABILITY_COMMAND_ID].checkCallback;
  const plugin = makePlugin(app);
  try {
    const table = app.__commands.table;
    assert.equal(plugin.propertyCapabilityRoutingReady(), true);
    plugin.teardownPropertyCapabilityRouting();
    assert.equal(table[H.PROPERTY_CAPABILITY_COMMAND_ID].checkCallback, nativeCheck);
    assert.equal(plugin.propertyCapabilityRoutingReady(), false);
    assert.equal(table[H.PROPERTY_CAPABILITY_COMMAND_ID].checkCallback.call({}, true), true);
  } finally {
    plugin.teardownPropertyUpdate();
  }

  const bare = makeApp({ files: ["note.md"], withCommand: false });
  const lonely = makePlugin(bare);
  try {
    assert.equal(lonely.propertyCapabilityRoutingReady(), false, "no command means no ownership");
  } finally {
    lonely.teardownPropertyCapabilityRouting();
    lonely.teardownPropertyUpdate();
  }
});

test("a later foreign wrapper survives our teardown", () => {
  const app = makeApp({ files: ["note.md"] });
  const nativeCheck = app.__commands.table[H.PROPERTY_CAPABILITY_COMMAND_ID].checkCallback;
  const plugin = makePlugin(app);
  try {
    const table = app.__commands.table;
    const foreign = function (checking, ...args) {
      return nativeCheck.call(this, checking, ...args);
    };
    table[H.PROPERTY_CAPABILITY_COMMAND_ID].checkCallback = foreign;
    assert.equal(plugin.propertyCapabilityRoutingReady(), false, "superseded routing is not ready");
    assert.equal(plugin.propertyCapabilityRestoreCommandRoute(), false);
    assert.equal(table[H.PROPERTY_CAPABILITY_COMMAND_ID].checkCallback, foreign);
    plugin.teardownPropertyCapabilityRouting();
    assert.equal(table[H.PROPERTY_CAPABILITY_COMMAND_ID].checkCallback, foreign);
  } finally {
    plugin.teardownPropertyUpdate();
  }
});

// --- Focus-helper routing ---

test("owned views route summary focus to the editor with a loose summary key", async () => {
  const app = makeApp({ files: ["note.md"], activePath: "note.md" });
  const plugin = makePlugin(app);
  try {
    ownEditorScope(app);
    const openerCalls = [];
    plugin.openPropertyEditor = async (options) => { openerCalls.push(options); return { ok: true }; };
    const result = plugin.notebookFocusSummaryProperty(app.__activeView);
    assert.equal(result, true);
    await flushMicrotasks();
    assert.deepEqual(openerCalls, [{ filePath: "note.md", key: "summary" }]);
  } finally {
    plugin.teardownPropertyCapabilityRouting();
    plugin.teardownPropertyUpdate();
  }
});

test("a failed summary opener releases the scope before native fallback", async () => {
  const app = makeApp({ files: ["note.md"], activePath: "note.md" });
  const plugin = makePlugin(app);
  try {
    ownEditorScope(app);
    plugin.openPropertyEditor = async () => ({ ok: false, reason: "busy" });
    const nativeCalls = [];
    plugin.notebookFocusSummaryPropertyNative = (view, attempted) => {
      nativeCalls.push({ view, attempted });
      return false;
    };
    assert.equal(plugin.notebookFocusSummaryProperty(app.__activeView), true);
    await flushMicrotasks();
    assert.equal(plugin.propertyCardActualOwnership({}).owned, false);
    assert.equal(nativeCalls.length, 1);
    assert.equal(nativeCalls[0].attempted, true, "the fallback skips the command loop");
  } finally {
    plugin.teardownPropertyCapabilityRouting();
    plugin.teardownPropertyUpdate();
  }
});

// --- Typed settings contract evidence (props_contract_v1, bob-cli-pl.9.1.1) ---

function catalogReport(features = ["props_v1", "props_contract_v1", "props_ref_contract_v1"]) {
  return {
    schema_version: 1, ok: true, protocol: 1, bob_version: "0.0.0-test",
    features, sections: [], roots: [], aliases: [], entries: [], excluded: [],
  };
}

const catalogJson = (features) => (callback) => callback(null, JSON.stringify(catalogReport(features)), "");

function routedStub(catalogHandler, showHandler) {
  const calls = [];
  const execFile = (command, args, options, callback) => {
    calls.push({ command, args });
    ((args[0] === "__catalog" ? catalogHandler : showHandler) || (() => {}))(callback);
  };
  return { calls, execFile };
}

function typedShowReport() {
  return showReport({ note_kind: "area", capabilities: ["props_v1", "props_contract_v1"] });
}

function typedRefShowReport() {
  return showReport({ path: "ref/paper.md", note_kind: "reference", capabilities: ["props_v1", "props_ref_contract_v1"] });
}

test("contract helpers: catalog argv, decode, classify, and report evidence", () => {
  assert.deepEqual(H.propertyCapabilityCatalogArgs(), ["__catalog", "--protocol", "1"]);
  assert.equal(H.PROPERTY_CAPABILITY_CONTRACT, "props_contract_v1");

  const decoded = H.propertyDecodeCatalogReport(JSON.stringify(catalogReport()), "", 0);
  assert.equal(decoded.ok, true);
  assert.deepEqual(decoded.report.features, ["props_v1", "props_contract_v1", "props_ref_contract_v1"]);

  assert.equal(H.propertyDecodeCatalogReport("not json", "", 0).ok, false);
  assert.equal(H.propertyDecodeCatalogReport(JSON.stringify({ ok: true, protocol: 1 }), "", 0).ok, false);

  assert.deepEqual(H.propertyCapabilityClassifyCatalogOutcome(decoded), { status: "confirmed" });
  assert.deepEqual(
    H.propertyCapabilityClassifyCatalogOutcome({ ok: true, report: catalogReport(["props_v1"]) }),
    { status: "absent", reason: "missing-contract" },
  );
  assert.equal(H.propertyCapabilityClassifyCatalogOutcome({ ok: false, code: "spawn-failed" }).status, "unconfirmed");

  assert.equal(H.propertyCapabilityReportHasContract(typedShowReport()), true);
  assert.equal(H.propertyCapabilityReportHasContract(showReport()), false, "ordinary notes omit the contract");
  assert.equal(H.propertyCapabilityReportHasContract(null), false);
  assert.equal(H.propertyCapabilityReportHasContract({ capabilities: [] }), false);

  assert.equal(H.PROPERTY_CAPABILITY_REF_CONTRACT, "props_ref_contract_v1");
  assert.deepEqual(H.propertyCapabilityClassifyRefCatalogOutcome(decoded), { status: "confirmed" });
  assert.deepEqual(
    H.propertyCapabilityClassifyRefCatalogOutcome({ ok: true, report: catalogReport(["props_v1", "props_contract_v1"]) }),
    { status: "absent", reason: "missing-contract" },
    "a pre-reference binary absents only the reference slot",
  );
  assert.equal(H.propertyCapabilityClassifyRefCatalogOutcome({ ok: false, code: "spawn-failed" }).status, "unconfirmed");
  assert.equal(H.propertyCapabilityReportHasRefContract(typedRefShowReport()), true);
  assert.equal(H.propertyCapabilityReportHasRefContract(typedShowReport()), false, "area reports never establish the reference contract");
  assert.equal(H.propertyCapabilityReportHasRefContract(showReport()), false, "ordinary notes omit the reference contract");
  assert.equal(H.propertyCapabilityReportHasRefContract(null), false);
});

test("contract probe confirms, deduplicates in flight, and never needs a note", async () => {
  const app = makeApp({ files: [], activePath: null });
  const plugin = makePlugin(app);
  try {
    const stub = routedStub(catalogJson(), showJson(showReport()));
    assert.deepEqual(Object.keys(app.vault.getAbstractFileByPath("missing.md") || {}), []);
    assert.equal(plugin.schedulePropertyCapabilityProbe("setup", { execFile: stub.execFile }), "no-note");
    assert.equal(plugin.schedulePropertyCapabilityContractProbe("setup", { execFile: stub.execFile }), "probing");
    assert.equal(plugin.schedulePropertyCapabilityContractProbe("setup", { execFile: stub.execFile }), "in-flight");
    assert.equal(stub.calls.length, 1);
    assert.deepEqual(stub.calls[0].args, ["__catalog", "--protocol", "1"]);
    await flushMicrotasks();
    assert.equal(plugin.propertyCapabilityState().contract, "confirmed");
    assert.equal(plugin.propertyCapabilityState().refContract, "confirmed", "one catalog settles both slots");
    assert.equal(plugin.propertyCapabilityRefContractConfirmed(), true);
    assert.equal(plugin.propertyCapabilityState().status, "unknown", "the catalog never decides props_v1");
    assert.equal(plugin.__refreshes(), 1, "confirmation schedules card refreshes");
    assert.equal(plugin.schedulePropertyCapabilityContractProbe("file-open", { execFile: stub.execFile }), "confirmed");
    assert.equal(stub.calls.length, 1, "confirmed contracts never re-probe");
  } finally {
    plugin.teardownPropertyCapabilityRouting();
    plugin.teardownPropertyUpdate();
  }
});

test("contract absence records old binaries and a later catalog detects upgrades", async () => {
  const app = makeApp({ files: ["note.md"], activePath: "note.md" });
  const plugin = makePlugin(app);
  try {
    const oldStub = routedStub(catalogJson(["props_v1"]), showJson(showReport()));
    assert.equal(plugin.schedulePropertyCapabilityContractProbe("setup", { execFile: oldStub.execFile }), "probing");
    await flushMicrotasks();
    assert.equal(plugin.propertyCapabilityState().contract, "absent");
    assert.equal(plugin.propertyCapabilityState().refContract, "absent");
    assert.equal(plugin.propertyCapabilityRefContractConfirmed(), false);
    // Absence re-probes: an upgraded binary is detected on a later event.
    const newStub = routedStub(catalogJson(), showJson(showReport()));
    assert.equal(plugin.schedulePropertyCapabilityContractProbe("file-open", { execFile: newStub.execFile }), "probing");
    await flushMicrotasks();
    assert.equal(plugin.propertyCapabilityState().contract, "confirmed");
  } finally {
    plugin.teardownPropertyCapabilityRouting();
    plugin.teardownPropertyUpdate();
  }
});

test("a pre-reference binary confirms the generic slot while the reference slot keeps probing", async () => {
  const app = makeApp({ files: ["note.md"], activePath: "note.md" });
  const plugin = makePlugin(app);
  try {
    const stub = routedStub(catalogJson(["props_v1", "props_contract_v1"]), showJson(showReport()));
    assert.equal(plugin.schedulePropertyCapabilityContractProbe("setup", { execFile: stub.execFile }), "probing");
    await flushMicrotasks();
    assert.equal(plugin.propertyCapabilityState().contract, "confirmed");
    assert.equal(plugin.propertyCapabilityState().refContract, "absent");
    assert.equal(plugin.propertyCapabilityRefContractConfirmed(), false);
    // A confirmed generic slot alone never parks the schedule: the
    // reference slot still needs its own observation.
    assert.equal(plugin.schedulePropertyCapabilityContractProbe("file-open", { execFile: stub.execFile }), "probing");
    assert.equal(stub.calls.length, 2);
  } finally {
    plugin.teardownPropertyCapabilityRouting();
    plugin.teardownPropertyUpdate();
  }
});

test("contract probe failures retry to a bound; stale, switched, and torn-down probes discard", async () => {
  const app = makeApp({ files: ["note.md"], activePath: "note.md" });
  let bobPath = "/fixture/bin/bob";
  const plugin = makePlugin(app, { bobPath });
  plugin.apiStatsBobPath = () => ({ path: bobPath, source: "candidate" });
  try {
    const stub = routedStub(badJson, showJson(showReport()));
    for (let attempt = 1; attempt <= H.PROPERTY_CAPABILITY_MAX_PROBE_ATTEMPTS; attempt += 1) {
      assert.equal(plugin.schedulePropertyCapabilityContractProbe(`event-${attempt}`, { execFile: stub.execFile }), "probing");
      await flushMicrotasks();
      assert.equal(plugin.propertyCapabilityState().contract, "unconfirmed");
    }
    assert.equal(stub.calls.length, H.PROPERTY_CAPABILITY_MAX_PROBE_ATTEMPTS);
    assert.equal(plugin.schedulePropertyCapabilityContractProbe("another-event", { execFile: stub.execFile }), "exhausted");
    assert.equal(stub.calls.length, H.PROPERTY_CAPABILITY_MAX_PROBE_ATTEMPTS, "no repaint retry loop");

    assert.equal(plugin.propertyCapabilitySettleContractProbe("other:key", 999, { ok: false }), "stale");

    plugin.propertyCapabilityByBobPath.clear();
    const holdStub = routedStub(() => {}, showJson(showReport()));
    assert.equal(plugin.schedulePropertyCapabilityContractProbe("setup", { execFile: holdStub.execFile }), "probing");
    const flight = plugin.propertyCapabilityContractFlight;
    assert.ok(flight);
    bobPath = "/fixture/bin/bob-b";
    assert.equal(plugin.propertyCapabilitySettleContractProbe(flight.key, flight.generation, {
      ok: true, report: catalogReport(),
    }), "path-changed");
    assert.equal(plugin.propertyCapabilityState().contract, "unknown");

    plugin.teardownPropertyCapabilityRouting();
    assert.equal(plugin.propertyCapabilitySettleContractProbe(flight.key, flight.generation, {
      ok: true, report: catalogReport(),
    }), "inactive");
  } finally {
    plugin.teardownPropertyUpdate();
  }
});

test("typed-note shows confirm the contract; ordinary notes never downgrade it", () => {
  const app = makeApp({ files: ["note.md"], activePath: "note.md" });
  const plugin = makePlugin(app);
  try {
    assert.equal(plugin.propertyCapabilityState().contract, "unknown");
    assert.equal(plugin.propertyCapabilityNoteShowOutcome({ ok: true, report: typedShowReport() }), "confirmed");
    assert.equal(plugin.propertyCapabilityState().contract, "confirmed");
    assert.equal(plugin.propertyCapabilityState().status, "confirmed");
    assert.equal(plugin.propertyCapabilityState().refContract, "unknown", "area reports never establish the reference contract");
    assert.equal(plugin.propertyCapabilityRefContractConfirmed(), false);
    // A reference note's report confirms the reference slot without
    // touching the generic one.
    assert.equal(plugin.propertyCapabilityNoteShowOutcome({ ok: true, report: typedRefShowReport() }), "confirmed");
    assert.equal(plugin.propertyCapabilityState().refContract, "confirmed");
    assert.equal(plugin.propertyCapabilityRefContractConfirmed(), true);
    // An ordinary note's report omits the contract: it preserves the
    // confirmed contract instead of establishing absence.
    assert.equal(plugin.propertyCapabilityNoteShowOutcome({ ok: true, report: showReport() }), "confirmed");
    assert.equal(plugin.propertyCapabilityState().contract, "confirmed");
    assert.equal(plugin.propertyCapabilityState().refContract, "confirmed", "ordinary notes never revoke it");
    // needs-bob is binary-level evidence, so it records contract absence.
    assert.equal(plugin.propertyCapabilityNoteShowOutcome({ ok: false, code: "needs-bob" }), "absent");
    assert.equal(plugin.propertyCapabilityState().contract, "absent");
    assert.equal(plugin.propertyCapabilityState().refContract, "absent");
  } finally {
    plugin.teardownPropertyCapabilityRouting();
    plugin.teardownPropertyUpdate();
  }
});

test("the combined scheduler probes both capabilities from one lifecycle event", async () => {
  const app = makeApp({ files: ["note.md"], activePath: "note.md" });
  const plugin = makePlugin(app);
  try {
    const stub = routedStub(catalogJson(), showJson(showReport()));
    assert.deepEqual(plugin.schedulePropertyCapabilityProbes("setup", { execFile: stub.execFile }), {
      show: "probing", contract: "probing",
    });
    assert.equal(stub.calls.length, 2);
    await flushMicrotasks();
    assert.equal(plugin.propertyCapabilityState().status, "confirmed");
    assert.equal(plugin.propertyCapabilityState().contract, "confirmed");
  } finally {
    plugin.teardownPropertyCapabilityRouting();
    plugin.teardownPropertyUpdate();
  }
});

test("ordinary notes and the sidebar keep native focus behavior", () => {
  const app = makeApp({ files: ["note.md"], activePath: "note.md" });
  const plugin = makePlugin(app);
  try {
    const openerCalls = [];
    plugin.openPropertyEditor = async (options) => { openerCalls.push(options); return { ok: true }; };
    const nativeCalls = [];
    plugin.notebookFocusSummaryPropertyNative = (view, attempted) => {
      nativeCalls.push({ view, attempted });
      return "native-result";
    };
    assert.equal(plugin.notebookFocusSummaryProperty(app.__activeView, undefined), "native-result");
    assert.deepEqual(nativeCalls.map((call) => call.attempted), [undefined]);
    assert.equal(openerCalls.length, 0);
    // The sidebar keeps native behavior even while the main note is owned.
    ownEditorScope(app);
    const sidebarDoc = makeDoc();
    const sidebarView = { file: null, contentEl: el(sidebarDoc, "div", "sidebar"), containerEl: null };
    assert.equal(plugin.notebookFocusSummaryProperty(sidebarView), "native-result");
    assert.equal(nativeCalls.length, 2);
    assert.equal(openerCalls.length, 0);
    assert.equal(plugin.propertyCardActualOwnership({}).owned, true, "sidebar focus never disturbs ownership");
  } finally {
    plugin.teardownPropertyCapabilityRouting();
    plugin.teardownPropertyUpdate();
  }
});
