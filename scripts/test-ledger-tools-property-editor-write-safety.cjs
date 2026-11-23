// Property editor write safety, Esc, and YAML escape (bob-cli-pf.4.1.7
// write-safety): cancel/close/undo during a pending write, session
// registration for generation and rename events, narrowed old-bob
// detection, Esc through the close ladder, and modal close on y/Ctrl+E.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestNotice {
  constructor(message) {
    TestNotice.messages.push(String(message));
  }
}
TestNotice.messages = [];

class TestPlugin {
  constructor(app) {
    this.app = app;
  }
}
class TestModal {
  constructor(app) {
    this.app = app;
  }
  open() {}
  close() {}
}

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: class {},
      Modal: TestModal,
      Notice: TestNotice,
      Plugin: TestPlugin,
      Platform: { isDesktopApp: true },
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

function showReport(rows, overrides = {}) {
  return {
    schema_version: 1,
    ok: true,
    path: "notes/groceries.md",
    note_kind: "note",
    capabilities: ["props_v1"],
    fingerprint: "sha256:aaa",
    frontmatter: { state: "ok", start_line: 1, end_line: 5 },
    properties: rows,
    ...overrides,
  };
}

function reportOf(overrides = {}) {
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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

class FakeTimers {
  constructor() {
    this.now = 0;
    this.nextId = 1;
    this.tasks = new Map();
  }

  setTimeout(callback, delay) {
    const id = this.nextId++;
    this.tasks.set(id, { id, callback, due: this.now + delay });
    return id;
  }

  clearTimeout(id) {
    this.tasks.delete(id);
  }

  tick(milliseconds) {
    const target = this.now + milliseconds;
    for (;;) {
      const next = [...this.tasks.values()]
        .filter((task) => task.due <= target)
        .sort((left, right) => left.due - right.due || left.id - right.id)[0];
      if (!next) break;
      this.now = next.due;
      this.tasks.delete(next.id);
      next.callback();
    }
    this.now = target;
  }
}

async function flushMicrotasks() {
  for (let i = 0; i < 24; i += 1) await Promise.resolve();
}

function updateReport(overrides = {}) {
  return {
    ok: true,
    schema_version: 1,
    path: "notes/groceries.md",
    dry_run: false,
    changed: true,
    fingerprint_before: "sha256:before",
    fingerprint_after: "sha256:after",
    inverse_ops: [{ op: "prop.set", key: "title", value: "Hello" }],
    changes: ["- title: Hello", "+ title: World"],
    properties: [wireRow({ value: "World" })],
    ...overrides,
  };
}

function makeSessionDeps(overrides = {}) {
  const timers = new FakeTimers();
  const calls = { preview: 0, apply: 0, show: 0, saves: [] };
  let previewImpl = async () => ({ ok: true, report: updateReport({ dry_run: true }) });
  let applyImpl = async () => ({ ok: true, report: updateReport() });
  const deps = {
    timers,
    history: H.createPropertyHistory({ limit: H.PROPERTY_HISTORY_LIMIT }),
    overlays: H.createPropertyOverlayStore({
      ttlMs: H.PROPERTY_OVERLAY_TTL_MS,
      setTimeout: (callback, delay) => setTimeout(callback, delay),
      clearTimeout: (id) => clearTimeout(id),
      now: () => Date.now(),
    }),
    getGeneration: () => 0,
    saveEditors: async (paths) => {
      calls.saves.push(paths.slice());
      return { ok: true };
    },
    spawnPreview: async () => {
      calls.preview += 1;
      return previewImpl();
    },
    spawnApply: async () => {
      calls.apply += 1;
      return applyImpl();
    },
    spawnShow: async () => {
      calls.show += 1;
      return { ok: true, report: reportOf() };
    },
    spawnVaultSync: async () => ({ ok: true }),
    calls,
    setApplyImpl: (fn) => { applyImpl = fn; },
    setPreviewImpl: (fn) => { previewImpl = fn; },
    ...overrides,
  };
  return deps;
}

function writeSafetySession(deps, init = {}) {
  return H.createPropertyUpdateSession({
    path: "notes/groceries.md",
    expect: "sha256:before",
    properties: [wireRow()],
    ...init,
  }, deps);
}

async function previewReadySession(deps, ops) {
  const session = writeSafetySession(deps);
  session.setDraft(ops || [{ op: "prop.set", key: "title", value: "World" }]);
  deps.timers.tick(H.PROPERTY_UPDATE_PREVIEW_DEBOUNCE_MS);
  await flushMicrotasks();
  assert.equal(session.getState().status, "preview-ready");
  return session;
}

test("setDraft during an in-flight write is ignored and the write still lands", async () => {
  const deps = makeSessionDeps();
  const flight = deferred();
  deps.setApplyImpl(() => flight.promise);
  const session = await previewReadySession(deps);
  const applying = session.apply();
  await flushMicrotasks();
  const before = session.getState();
  session.setDraft([]);
  const during = session.getState();
  assert.deepEqual(during.draftOps, before.draftOps, "cancel-style clear cannot invalidate the flight");
  flight.resolve({ ok: true, report: updateReport() });
  const result = await applying;
  assert.equal(result.ok, true);
  assert.equal(session.getState().history.undo, 1, "history records the completed write");
  session.close();
});

test("a second write while one is in flight is refused without touching history", async () => {
  const deps = makeSessionDeps();
  const flight = deferred();
  deps.setApplyImpl(() => flight.promise);
  const session = await previewReadySession(deps);
  const applying = session.apply();
  await flushMicrotasks();
  const refused = await session.applyOps([{ op: "prop.set", key: "title", value: "Other" }]);
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "write-busy");
  assert.equal(deps.calls.apply, 1, "the refused write never reaches bob");
  flight.resolve({ ok: true, report: updateReport() });
  assert.equal((await applying).ok, true);
  assert.equal(session.getState().history.undo, 1);
  session.close();
});

test("close during an apply defers until the write settles, then records history", async () => {
  const deps = makeSessionDeps();
  const flight = deferred();
  deps.setApplyImpl(() => flight.promise);
  const session = await previewReadySession(deps);
  const applying = session.apply();
  await flushMicrotasks();
  session.close();
  flight.resolve({ ok: true, report: updateReport() });
  const result = await applying;
  assert.equal(result.ok, true, "the completed write is not reported as superseded");
  assert.equal(session.getState().history.undo, 1, "history lands even though the modal closed");
  assert.ok(deps.overlays.get("notes/groceries.md"), "the confirmed overlay still publishes");
  const after = await session.apply();
  assert.equal(after.code, "closed", "the session closes once the deferred write settles");
});

test("close during a failed apply surfaces the refusal without history", async () => {
  const deps = makeSessionDeps();
  const flight = deferred();
  deps.setApplyImpl(() => flight.promise);
  const session = await previewReadySession(deps);
  const applying = session.apply();
  await flushMicrotasks();
  session.close();
  flight.resolve({
    ok: true,
    report: {
      ok: false,
      schema_version: 1,
      path: "notes/groceries.md",
      dry_run: false,
      changed: false,
      error: { code: "prop_owned", message: "owned by a card", hint: "y opens YAML." },
    },
  });
  const result = await applying;
  assert.equal(result.ok, false);
  assert.equal(result.code, "prop_owned");
  assert.equal(session.getState().history.undo, 0);
  const after = await session.apply();
  assert.equal(after.code, "closed", "the session still closes after a failed write");
});

test("two quick undos serialize: the second is refused and history stays exact", async () => {
  const deps = makeSessionDeps();
  const session = writeSafetySession(deps);
  await session.applyOps([{ op: "prop.set", key: "title", value: "World" }]);
  assert.equal(session.getState().history.undo, 1);
  const flight = deferred();
  deps.setApplyImpl(() => flight.promise);
  const appliesBeforeUndo = deps.calls.apply;
  const first = session.undo();
  await flushMicrotasks();
  const second = await session.undo();
  assert.equal(second.ok, false);
  assert.equal(second.code, "write-busy");
  assert.equal(deps.calls.apply, appliesBeforeUndo + 1, "only the first replay reaches bob");
  flight.resolve({ ok: true, report: updateReport() });
  assert.equal((await first).ok, true);
  assert.equal(session.getState().history.undo, 0);
  assert.equal(session.getState().history.redo, 1, "the entry is consumed exactly once");
  const again = await session.undo();
  assert.equal(again.code, "nothing-to-undo");
  session.close();
});

test("a generation change during a write waits for the outcome, then notifies", async () => {
  const changes = [];
  const deps = makeSessionDeps({ onChange: (snapshot) => { changes.push(snapshot.status); } });
  const flight = deferred();
  deps.setApplyImpl(() => flight.promise);
  const session = await previewReadySession(deps);
  const applying = session.apply();
  await flushMicrotasks();
  const before = changes.length;
  session.noteGenerationChanged();
  assert.equal(session.getState().status, "applying", "the flight is not clobbered mid-write");
  flight.resolve({ ok: true, report: updateReport() });
  assert.equal((await applying).ok, true);
  assert.ok(changes.length > before, "the deferred generation change notifies after settle");
  session.close();
});

test("an error envelope never marks bob as old; needs-bob still does", async () => {
  const seen = [];
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.app = { vault: {}, metadataCache: {}, workspace: {} };
  plugin.registerEvent = () => ({});
  plugin.setupPropertyUpdate();
  try {
    const missing = await plugin.apiPropertyShow("notes/gone.md", {
      execFile: (_command, _args, _options, callback) => {
        callback(null, JSON.stringify({
          ok: false,
          schema_version: 1,
          error: { code: "prop_missing", message: "note does not exist", hint: "create it first" },
        }), "");
        return { stdin: { write() {}, end() {}, on() {} } };
      },
      resolved: { path: "/fixture/bin/bob", source: "candidate" },
      vaultPath: "/fixture-vault",
    });
    seen.push(missing.ok);
    assert.equal(missing.ok, true);
    assert.equal(plugin.propertyCapability, null, "missing notes leave the capability alone");
    assert.equal(plugin.apiPropertyUpdateCapable(), false, "an unknown capability stays read-only");
    const preview = await plugin.apiPropertyUpdatePreview(
      "notes/gone.md",
      H.propertyUpdateEnvelopeText("sha256:x", [{ op: "prop.set", key: "t", value: 1 }]),
      {
        execFile: (_command, _args, _options, callback) => {
          callback(null, JSON.stringify({
            ok: false,
            schema_version: 1,
            dry_run: true,
            changed: false,
            error: { code: "prop_missing", message: "note does not exist", hint: "create it first" },
          }), "");
          return { stdin: { write() {}, end() {}, on() {} } };
        },
        resolved: { path: "/fixture/bin/bob", source: "candidate" },
        vaultPath: "/fixture-vault",
      },
    );
    assert.equal(preview.ok, true, "error envelopes stay actionable and read-only");
    assert.equal(preview.report.error.code, "prop_missing");
    assert.equal(plugin.propertyCapability, null, "a refused preview never clears the capability either");
    const old = await plugin.apiPropertyShow("notes/gone.md", {
      execFile: (_command, _args, _options, callback) => {
        callback({ code: 2 }, "", "error: unrecognized subcommand 'props'");
        return { stdin: { write() {}, end() {}, on() {} } };
      },
      resolved: { path: "/fixture/bin/bob", source: "candidate" },
      vaultPath: "/fixture-vault",
    });
    assert.equal(old.code, "needs-bob");
    assert.equal(plugin.propertyCapability, false, "only the typed old-bob outcome clears the capability");
    assert.deepEqual(seen, [true]);
  } finally {
    plugin.teardownPropertyUpdate();
  }
});

test("cancel, close, and selection changes refuse visibly while a save runs", async () => {
  const flight = deferred();
  const session = {
    state: { status: "applying", draftOps: [{ op: "prop.set", key: "title", value: "World" }], canApply: false, expect: "before" },
    sets: 0,
    setDraft() { this.sets += 1; return this.state; },
    getState() { return this.state; },
    async apply() { return flight.promise; },
    close() {},
  };
  const modal = new H.PropertyEditorModal({}, {
    filePath: "notes/groceries.md",
    report: reportOf({ properties: [wireRow(), wireRow({ key: "other", line: 4 })] }),
  });
  modal.session = session;
  modal.editorEnsureSession = () => session;
  modal.stage = { id: 1, rowId: "title::3", key: "title", kind: "text", revision: 1, value: "World", items: [], itemDraft: "" };
  modal.pendingApply = true;
  assert.equal(modal.propertyEditorCancelStage(), false);
  assert.ok(modal.stage, "the stage survives a refused cancel");
  assert.match(modal.announce, /Saving/);
  assert.equal(session.sets, 0, "no draft clear reaches the session mid-write");
  modal.propertyEditorSelect("other::4");
  assert.equal(modal.selectedId, "title::3", "selection never moves mid-write");
  assert.match(modal.announce, /Saving/);
  modal.propertyEditorBackOut();
  assert.equal(modal.closed, false, "close waits for the write");
  assert.match(modal.announce, /Saving/);
  flight.resolve({ ok: true, changed: true, report: updateReport() });
});

test("a rejected apply always clears pendingApply so the modal stays usable", async () => {
  const session = {
    state: { status: "applying", draftOps: [], canApply: false, expect: "before" },
    setDraft(ops) {
      this.state = { ...this.state, draftOps: ops.slice() };
      return this.state;
    },
    getState() { return this.state; },
    async apply() { throw new Error("spawn exploded"); },
    close() {},
  };
  const modal = new H.PropertyEditorModal({}, {
    filePath: "notes/groceries.md",
    report: reportOf(),
  });
  modal.session = session;
  modal.editorEnsureSession = () => session;
  modal.stage = { id: 1, rowId: "title::3", key: "title", kind: "text", revision: 1, value: "World", items: [], itemDraft: "" };
  const built = { ok: true, value: "World", kind: "text", ops: [{ op: "prop.set", key: "title", value: "World", kind: "text" }] };
  const result = await modal.propertyEditorApplyStage(built);
  assert.equal(result.code, "failed");
  assert.equal(modal.pendingApply, false, "pendingApply clears even when the spawn throws");
  assert.ok(modal.stage, "the draft survives an uncertain outcome without a retry");
});

test("onEscapeKey peels the close ladder instead of closing outright", () => {
  const modal = new H.PropertyEditorModal({}, {
    filePath: "notes/groceries.md",
    report: reportOf(),
  });
  modal.paintPropertyEditor = () => {};
  modal.menuOpen = true;
  assert.equal(modal.onEscapeKey({}), false);
  assert.equal(modal.menuOpen, false);
  assert.equal(modal.closed, false);
  modal.stage = { kind: "text" };
  modal.onEscapeKey({});
  assert.equal(modal.stage, null);
  assert.equal(modal.closed, false);
  modal.filterOpen = true;
  modal.onEscapeKey({});
  assert.equal(modal.filterOpen, false);
  assert.equal(modal.closed, false);
});

test("the yaml action closes the modal first and keeps the key for Done", async () => {
  const seen = [];
  const modal = new H.PropertyEditorModal({}, {
    filePath: "notes/groceries.md",
    report: reportOf(),
  });
  modal.onYamlEscape = (info) => { seen.push(info); };
  modal.close = () => { modal.closed = true; };
  await modal.propertyEditorPerform("yaml");
  assert.equal(modal.closed, true, "the modal closes before the Source view opens");
  assert.deepEqual(seen, [{ path: "notes/groceries.md", filePath: "notes/groceries.md", key: "title" }]);
});

test("browse equals opens the owning card editor and explains ordinary notes", async () => {
  const handed = [];
  const modal = new H.PropertyEditorModal({}, {
    filePath: "records/r.md",
    report: reportOf({ properties: [wireRow()], note_kind: "record" }),
  });
  modal.onCardHandoff = (info) => { handed.push(info); };
  modal.noteKind = "record";
  await modal.propertyEditorPerform("equals");
  assert.equal(handed.length, 1);
  assert.equal(handed[0].owner, "record");

  const plain = new H.PropertyEditorModal({}, {
    filePath: "notes/groceries.md",
    report: reportOf(),
  });
  plain.paintPropertyEditor = () => {};
  await plain.propertyEditorPerform("equals");
  assert.match(plain.announce, /no card editor/);
  assert.ok(!/later phase/i.test(plain.announce), "phase-era copy is gone");
});

test("a stale lock wait paints its state and Esc stops the wait", async () => {
  const stops = [];
  const session = {
    state: {
      status: "applying",
      draftOps: [{ op: "prop.set", key: "title", value: "World" }],
      canApply: false,
      expect: "before",
      lockWait: { since: 0, elapsedMs: 3000, attempts: 2, stopping: false },
    },
    setDraft(ops) {
      this.state = { ...this.state, draftOps: ops.slice() };
      return this.state;
    },
    getState() { return this.state; },
    async apply() { return { ok: false, code: "lock-wait-stopped", message: "stopped" }; },
    stopWaiting() { stops.push(true); },
    close() {},
  };
  const modal = new H.PropertyEditorModal({}, {
    filePath: "notes/groceries.md",
    report: reportOf(),
  });
  modal.session = session;
  modal.editorEnsureSession = () => session;
  modal.pendingApply = true;
  modal.propertyEditorSyncLockWait();
  assert.match(modal.status.text, /Esc stops waiting/);
  modal.propertyEditorBackOut();
  assert.deepEqual(stops, [true], "Esc stops the wait instead of backing out");
  assert.equal(modal.closed, false);
});

function makeWriteSafetyPlugin() {
  const handlers = new Map();
  const on = (event, callback) => {
    const rows = handlers.get(event) || [];
    rows.push(callback);
    handlers.set(event, rows);
    return {};
  };
  const app = {
    vault: {
      adapter: { basePath: "/fixture-vault" },
      getMarkdownFiles: () => [{ path: "notes/a.md", extension: "md" }],
      getAbstractFileByPath: (path) => ({ path }),
      on,
    },
    metadataCache: { on, getFileCache: () => null },
    workspace: { on: () => ({}), getLeavesOfType: () => [] },
  };
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.app = app;
  plugin.albumTimers = new FakeTimers();
  plugin.registerEvent = () => ({});
  plugin.registerInterval = () => {};
  plugin.setupPropertyUpdate();
  return {
    plugin,
    emitVault: (event, ...args) => { for (const callback of handlers.get(event) || []) callback(...args); },
  };
}

test("modal sessions register on ensure and unregister on close", () => {
  const { plugin } = makeWriteSafetyPlugin();
  const modal = new H.PropertyEditorModal({ document: undefined }, {
    filePath: "notes/a.md",
    report: reportOf({ path: "notes/a.md" }),
  });
  modal.propertyPlugin = plugin;
  const session = modal.editorEnsureSession();
  assert.ok(session, "a session is created");
  assert.strictEqual(plugin.propertySessions.get("notes/a.md"), session, "the session registers for generation events");
  modal.onClose();
  assert.equal(plugin.propertySessions.get("notes/a.md"), undefined, "close unregisters the session");
});

test("a vault modify notifies only the session for that path", async () => {
  const { plugin, emitVault } = makeWriteSafetyPlugin();
  const seen = [];
  const deps = makeSessionDeps({ onChange: (snapshot) => { seen.push(snapshot.status); } });
  deps.getGeneration = () => plugin.propertyVaultGeneration || 0;
  const session = H.createPropertyUpdateSession({
    path: "notes/a.md",
    expect: "sha256:before",
    properties: [wireRow()],
  }, deps);
  plugin.propertySessions.set("notes/a.md", session);
  session.setDraft([{ op: "prop.set", key: "title", value: "World" }]);
  deps.timers.tick(H.PROPERTY_UPDATE_PREVIEW_DEBOUNCE_MS);
  await flushMicrotasks();
  assert.equal(session.getState().status, "preview-ready");
  emitVault("modify", { path: "notes/unrelated.md" });
  assert.equal(session.getState().status, "preview-ready", "unrelated vault traffic never disturbs the preview");
  assert.equal(plugin.propertyVaultGeneration || 0, 0, "no session path means no bump");
  emitVault("modify", { path: "notes/a.md" });
  assert.equal(session.getState().status, "refused", "the target path revalidates through its session");
  assert.ok(seen.length > 0, "the generation change notifies so the modal repaints");
  session.close();
});

test("rename and delete close the open modal and clear dead Done buttons", () => {
  TestNotice.messages = [];
  const { plugin, emitVault } = makeWriteSafetyPlugin();
  const modal = {
    filePath: "notes/a.md",
    closed: false,
    closes: 0,
    close() { this.closed = true; this.closes += 1; },
  };
  plugin.propertyEditorModal = modal;
  const leaf = {
    view: { file: { path: "notes/b.md" }, containerEl: null },
    restored: [],
    async setViewState(next) { this.restored.push(next); },
  };
  plugin.albumYamlExcursions = new Map();
  plugin.albumYamlExcursions.set(leaf, {
    kind: "props",
    notePath: "notes/a.md",
    viewState: { type: "markdown", state: { mode: "preview", source: false } },
    selectedKey: "title",
    doneEl: { removed: 0, remove() { this.removed += 1; } },
    container: null,
    restoring: false,
  });
  emitVault("rename", { path: "notes/b.md" }, "notes/a.md");
  assert.equal(modal.closes, 1, "rename closes the open modal instead of stranding it");
  assert.ok(TestNotice.messages.some((message) => /renamed/i.test(message)), "rename says so");
  assert.equal(plugin.albumYamlExcursions.size, 0, "the dead Done button is removed");
  assert.equal(leaf.restored.length, 1, "the leaf mode restores where possible");
  assert.equal(leaf.restored[0].state.file, "notes/b.md", "restore follows the renamed file");

  const gone = {
    filePath: "notes/c.md",
    closed: false,
    closes: 0,
    close() { this.closed = true; this.closes += 1; },
  };
  plugin.propertyEditorModal = gone;
  emitVault("delete", { path: "notes/c.md" });
  assert.equal(gone.closes, 1, "delete closes the open modal with a notice");
  assert.ok(TestNotice.messages.some((message) => /deleted/i.test(message)), "delete says so");
});

test("leaf choice prefers the origin leaf, then the active leaf, then any leaf", () => {
  const showAs = (leaf, path) => { leaf.view.file = { path }; };
  const origin = { view: { file: { path: "notes/a.md" } } };
  const active = { view: { file: { path: "notes/a.md" } } };
  const other = { view: { file: { path: "notes/a.md" } } };
  const plugin = {
    app: { workspace: { activeLeaf: active, getLeavesOfType: () => [other, active, origin] } },
    propertyEditorOriginLeaf: origin,
  };
  assert.strictEqual(H.propertyEditorEntryLeafFor(plugin, "notes/a.md"), origin);
  showAs(origin, "notes/moved.md");
  assert.strictEqual(H.propertyEditorEntryLeafFor(plugin, "notes/a.md"), active, "a moved origin yields to the active leaf");
  showAs(active, "notes/moved.md");
  assert.strictEqual(H.propertyEditorEntryLeafFor(plugin, "notes/a.md"), other);
});
