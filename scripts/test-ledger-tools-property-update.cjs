// Guarded props v1 client, session, per-path history, and overlays (bob-cli-pf.4.1.1).
// Fake spawns, timers, and workspace: protocol fixtures, recovery reports,
// revision/generation/save races, late close, lock/refusal, history bounds,
// framing round-trip, and overlay retirement. Rendering never spawns bob.
const assert = require("node:assert/strict");
const test = require("node:test");
const Module = require("node:module");

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

const {
  PROPERTY_UPDATE_SCHEMA_VERSION,
  PROPERTY_UPDATE_TIMEOUT_MS,
  PROPERTY_UPDATE_MAX_BUFFER,
  PROPERTY_UPDATE_PREVIEW_DEBOUNCE_MS,
  PROPERTY_HISTORY_LIMIT,
  PROPERTY_OVERLAY_TTL_MS,
  PROPERTY_CAPABILITY,
  propertyShowArgs,
  propertyUpdateArgs,
  propertyUpdateEnvelope,
  propertyUpdateEnvelopeText,
  propertyIsStaleUpdateCode,
  propertyHasCapability,
  propertyShowAllowsWrite,
  propertyDecodeShowReport,
  propertyDecodeUpdateReport,
  propertyIsUnsupportedOutput,
  propertyOverlayFromReport,
  propertyOverlayPaintFrontmatter,
  propertyOverlayMatchesCache,
  createPropertyHistory,
  createPropertyOverlayStore,
  createPropertyUpdateSession,
  ALBUM_LIST_TIMEOUT_MS,
  ALBUM_LIST_MAX_BUFFER,
  guardedUpdateReportChanged,
} = LedgerToolsPlugin.helpers;

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

function eventSource() {
  const handlers = new Map();
  return {
    on(event, callback) {
      let list = handlers.get(event);
      if (!list) {
        list = [];
        handlers.set(event, list);
      }
      list.push(callback);
      return {};
    },
    emit(event, ...args) {
      for (const callback of handlers.get(event) || []) callback(...args);
    },
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

async function flushMicrotasks() {
  for (let i = 0; i < 24; i += 1) await Promise.resolve();
}

function showProperty(overrides = {}) {
  return {
    key: "count",
    line: 3,
    end_line: 3,
    value: 3,
    kind: "number",
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
    fingerprint: "sha256:before",
    frontmatter: { state: "ok", start_line: 1, end_line: 5 },
    properties: [showProperty()],
    ...overrides,
  };
}

function recoveryShowReport(overrides = {}) {
  return showReport({
    fingerprint: null,
    frontmatter: {
      state: "invalid",
      start_line: 1,
      end_line: 3,
      error: {
        code: "prop_invalid_yaml",
        message: "invalid YAML",
        hint: "Repair the frontmatter YAML before editing properties.",
        line: 2,
      },
    },
    properties: [showProperty({
      key: "name",
      line: 2,
      end_line: 2,
      value: null,
      kind: "opaque",
      opaque: true,
      diagnostic: "unclosed sequence",
    })],
    ...overrides,
  });
}

function updateReport(overrides = {}) {
  return {
    ok: true,
    schema_version: 1,
    path: "notes/groceries.md",
    dry_run: true,
    changed: true,
    fingerprint_before: "sha256:before",
    fingerprint_after: "sha256:after",
    inverse_ops: [{ op: "prop.set", key: "count", value: 3 }],
    changes: ["- count: 3", "+ count: 4"],
    properties: [showProperty({ value: 4 })],
    ...overrides,
  };
}

function updateErrorReport(error, overrides = {}) {
  return {
    ok: false,
    schema_version: 1,
    path: "notes/groceries.md",
    dry_run: false,
    changed: false,
    error: {
      code: "prop_owned",
      message: "status is owned by a card",
      hint: "Edit it with ==.",
      key: "status",
      ...error,
    },
    ...overrides,
  };
}

function draftOps() {
  return [{ op: "prop.set", key: "count", value: 4 }];
}

function framingRestoreOps() {
  return [{
    op: "prop.restore",
    key: "count",
    raw: null,
    framing: { expected: "---\n---\n", prior: "" },
  }];
}

function lockBusyOutcome() {
  return {
    ok: true,
    report: updateErrorReport({
      code: "lock_busy",
      message: "another Bob vault maintenance run is already active",
      hint: "retry",
      key: undefined,
    }),
  };
}

function makeSessionDeps(overrides = {}) {
  const timers = new FakeTimers();
  let generation = 0;
  const history = createPropertyHistory({ limit: PROPERTY_HISTORY_LIMIT });
  const overlays = createPropertyOverlayStore({
    ttlMs: PROPERTY_OVERLAY_TTL_MS,
    setTimeout: (callback, delay) => timers.setTimeout(callback, delay),
    clearTimeout: (id) => timers.clearTimeout(id),
    now: () => timers.now,
  });
  const calls = { preview: 0, apply: 0, show: 0, vaultSync: 0, saves: [] };
  let previewImpl = async () => ({ ok: true, report: updateReport() });
  let applyImpl = async () => ({
    ok: true,
    report: updateReport({ dry_run: false }),
    wrote: true,
    unknown: false,
  });
  let showImpl = async () => ({ ok: true, report: showReport() });
  const deps = {
    timers,
    history,
    overlays,
    getGeneration: () => generation,
    setGeneration: (next) => { generation = next; },
    bumpGeneration: () => { generation += 1; },
    saveEditors: async (paths) => {
      calls.saves.push(paths.slice());
      return { ok: true };
    },
    spawnPreview: async (identity, envelopeText) => {
      calls.preview += 1;
      calls.lastPreviewEnvelope = envelopeText;
      return previewImpl(identity, envelopeText);
    },
    spawnApply: async (identity, envelopeText, applyOptions) => {
      calls.apply += 1;
      calls.lastApplyEnvelope = envelopeText;
      calls.lastApplyOptions = applyOptions;
      return applyImpl(identity, envelopeText, applyOptions);
    },
    spawnShow: async () => {
      calls.show += 1;
      return showImpl();
    },
    spawnVaultSync: async () => {
      calls.vaultSync += 1;
      return { ok: true, report: { ok: true, output: "" } };
    },
    calls,
    setPreviewImpl: (fn) => { previewImpl = fn; },
    setApplyImpl: (fn) => { applyImpl = fn; },
    setShowImpl: (fn) => { showImpl = fn; },
    setSaveImpl: (fn) => { deps.saveEditors = fn; },
    ...overrides,
  };
  return deps;
}

function propertySession(deps, init = {}) {
  return createPropertyUpdateSession({
    path: "notes/groceries.md",
    expect: "sha256:before",
    properties: [showProperty()],
    ...init,
  }, deps);
}

async function previewReadySession(deps, ops = draftOps(), init = {}) {
  const session = propertySession(deps, init);
  session.setDraft(ops);
  deps.timers.tick(PROPERTY_UPDATE_PREVIEW_DEBOUNCE_MS);
  await flushMicrotasks();
  assert.equal(session.getState().status, "preview-ready");
  return session;
}

function makePropertyPlugin(initial = []) {
  const vaultEvents = eventSource();
  const metadataEvents = eventSource();
  const cache = new Map();
  const files = initial.map(({ path, frontmatter }) => {
    const file = { path, extension: "md" };
    cache.set(path, { frontmatter });
    return file;
  });
  const app = {
    vault: {
      adapter: { basePath: "/fixture-vault" },
      getMarkdownFiles: () => files,
      getAbstractFileByPath: (path) => files.find((file) => file.path === path) || { path },
      on: vaultEvents.on.bind(vaultEvents),
    },
    metadataCache: {
      on: metadataEvents.on.bind(metadataEvents),
      getFileCache: (file) => cache.get(file && file.path) || null,
    },
    workspace: {
      on: () => ({}),
      onLayoutReady: () => {},
      getLeavesOfType: () => [],
    },
  };
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.albumTimers = new FakeTimers();
  plugin.registerEvent = () => {};
  plugin.registerInterval = () => {};
  plugin.setupPropertyUpdate();
  return {
    plugin,
    app,
    cache,
    timers: plugin.albumTimers,
    vaultEvents,
    metadataChanged: (file, frontmatter) => {
      cache.set(file.path, { frontmatter });
      metadataEvents.emit("changed", file, { frontmatter });
    },
  };
}

test("props argv, envelope, capability helper, and timeout follow the writer contract", () => {
  assert.equal(PROPERTY_UPDATE_SCHEMA_VERSION, 1);
  assert.equal(PROPERTY_OVERLAY_TTL_MS, 5000);
  assert.equal(PROPERTY_HISTORY_LIMIT, 20);
  assert.equal(PROPERTY_UPDATE_PREVIEW_DEBOUNCE_MS, 250);
  assert.equal(PROPERTY_CAPABILITY, "props_v1");
  assert.equal(PROPERTY_UPDATE_TIMEOUT_MS, ALBUM_LIST_TIMEOUT_MS);
  assert.equal(PROPERTY_UPDATE_MAX_BUFFER, ALBUM_LIST_MAX_BUFFER);
  assert.deepEqual(propertyShowArgs("notes/groceries.md"), ["props", "show", "notes/groceries.md", "-f", "json"]);
  assert.deepEqual(
    propertyUpdateArgs("notes/groceries.md"),
    ["props", "update", "notes/groceries.md", "-f", "json", "-i", "-"],
  );
  assert.deepEqual(
    propertyUpdateArgs("eat/ninja", { dryRun: true }),
    ["props", "update", "eat/ninja", "-f", "json", "-i", "-", "-d"],
  );
  assert.deepEqual(propertyUpdateEnvelope("sha256:abc", draftOps()), {
    schema_version: 1,
    expect: "sha256:abc",
    ops: draftOps(),
  });
  assert.equal(
    propertyUpdateEnvelopeText("sha256:abc", []),
    '{"schema_version":1,"expect":"sha256:abc","ops":[]}',
  );
  assert.equal(propertyIsStaleUpdateCode("prop_stale"), true);
  assert.equal(propertyIsStaleUpdateCode("stale_record"), false);
  assert.equal(propertyHasCapability(showReport()), true);
  assert.equal(propertyHasCapability(showReport({ capabilities: [] })), false);
  assert.equal(propertyShowAllowsWrite(recoveryShowReport()), false);
  assert.equal(guardedUpdateReportChanged(updateReport()), true);
  assert.equal(guardedUpdateReportChanged(updateReport({ changed: false })), false);
});

test("show and update decoders keep the real CLI shape, recovery reports, and typed refusals", () => {
  const shown = propertyDecodeShowReport(JSON.stringify(showReport()), "", 0);
  assert.equal(shown.ok, true);
  assert.equal(shown.report.ok, true);
  assert.equal(shown.report.fingerprint, "sha256:before");
  assert.equal(shown.report.properties[0].value, 3);
  assert.equal(shown.report.note_kind, "note");

  const recovery = propertyDecodeShowReport(JSON.stringify(recoveryShowReport()), "", 0);
  assert.equal(recovery.ok, true);
  assert.equal(recovery.report.ok, true);
  assert.equal(recovery.report.fingerprint, null);
  assert.equal(recovery.report.frontmatter.state, "invalid");
  assert.equal(propertyShowAllowsWrite(recovery.report), false);

  const missing = propertyDecodeShowReport(JSON.stringify({
    ok: false,
    schema_version: 1,
    error: { code: "prop_missing", message: "note does not exist", hint: "create it first" },
  }), "", 2);
  assert.equal(missing.ok, true);
  assert.equal(missing.report.ok, false);
  assert.equal(missing.report.error.code, "prop_missing");

  const applied = propertyDecodeUpdateReport(JSON.stringify(updateReport({ dry_run: false })), "", 0);
  assert.equal(applied.ok, true);
  assert.equal(applied.report.changed, true);
  assert.deepEqual(applied.report.inverse_ops[0], { op: "prop.set", key: "count", value: 3 });

  const framed = propertyDecodeUpdateReport(JSON.stringify(updateReport({
    inverse_ops: framingRestoreOps(),
  })), "", 0);
  assert.deepEqual(framed.report.inverse_ops[0].framing, { expected: "---\n---\n", prior: "" });

  const refused = propertyDecodeUpdateReport(JSON.stringify(updateErrorReport({})), "", 2);
  assert.equal(refused.ok, true);
  assert.equal(refused.report.ok, false);
  assert.equal(refused.report.error.key, "status");

  const stale = propertyDecodeUpdateReport(JSON.stringify(updateErrorReport({
    code: "prop_stale",
    message: "frontmatter fingerprint does not match expect",
    hint: "Re-read the note and retry with a fresh fingerprint.",
    key: undefined,
  })), "", 1);
  assert.equal(stale.ok, true);
  assert.equal(stale.report.error.code, "prop_stale");

  assert.equal(propertyDecodeUpdateReport("not JSON", "boom").code, "bad-json");
  assert.equal(propertyDecodeShowReport(JSON.stringify({ schema_version: 1 }), "").code, "bad-shape");
  assert.equal(
    propertyDecodeUpdateReport(JSON.stringify(updateReport({ schema_version: 2 })), "").code,
    "schema-mismatch",
  );
});

test("unknown-subcommand output is capability unavailable; other exit 2 stays actionable", () => {
  assert.equal(
    propertyIsUnsupportedOutput("", "error: unrecognized subcommand 'props'", 2),
    true,
  );
  assert.equal(
    propertyIsUnsupportedOutput("", "bob: unknown subcommand: props", 2),
    true,
  );
  const old = propertyDecodeShowReport("", "error: unrecognized subcommand 'props'", 2);
  assert.equal(old.ok, false);
  assert.equal(old.code, "needs-bob");

  const usage = propertyDecodeShowReport(JSON.stringify({
    ok: false,
    schema_version: 1,
    error: { code: "prop_not_markdown", message: "note target must be a Markdown file", hint: "pick an .md" },
  }), "note target must be a Markdown file", 2);
  assert.equal(usage.ok, true);
  assert.equal(usage.report.error.code, "prop_not_markdown");

  const ioFail = propertyDecodeShowReport("not json", "could not read note", 1);
  assert.equal(ioFail.code, "bad-json");
  assert.equal(propertyIsUnsupportedOutput("", "could not read note", 1), false);
});

test("empty values stay distinct through overlay paint and matching", () => {
  const overlay = propertyOverlayFromReport(updateReport({
    properties: [
      showProperty({ key: "title", value: "" }),
      showProperty({ key: "tags", value: [], kind: "tags" }),
      showProperty({ key: "done", value: false, kind: "checkbox" }),
      showProperty({ key: "count", value: 0 }),
      showProperty({ key: "note", value: null, kind: "null" }),
    ],
  }), [
    showProperty({ key: "gone", value: "x" }),
    showProperty({ key: "title", value: "old" }),
  ]);
  assert.deepEqual(overlay.deletedKeys, ["gone"]);
  const painted = propertyOverlayPaintFrontmatter(
    { gone: "x", title: "old", extra: "keep" },
    overlay,
  );
  assert.equal(painted.title, "");
  assert.deepEqual(painted.tags, []);
  assert.equal(painted.done, false);
  assert.equal(painted.count, 0);
  assert.equal(painted.note, null);
  assert.equal(Object.prototype.hasOwnProperty.call(painted, "gone"), false);
  assert.equal(painted.extra, "keep");
  assert.equal(propertyOverlayMatchesCache(overlay, painted), true);
  const missingNull = { ...painted };
  delete missingNull.note;
  assert.equal(propertyOverlayMatchesCache(overlay, missingNull), false);
});

test("typed preview path still requires a current preview before apply", async () => {
  const deps = makeSessionDeps();
  const session = propertySession(deps);
  try {
    session.setDraft(draftOps());
    assert.equal(session.getState().status, "preview-pending");
    const denied = await session.apply();
    assert.equal(denied.code, "not-previewed");
    assert.equal(deps.calls.apply, 0);
    deps.timers.tick(PROPERTY_UPDATE_PREVIEW_DEBOUNCE_MS);
    await flushMicrotasks();
    assert.equal(session.getState().status, "preview-ready");
    const applied = await session.apply();
    assert.equal(applied.ok, true);
    assert.equal(applied.changed, true);
    assert.equal(deps.calls.apply, 1);
    assert.deepEqual(JSON.parse(deps.calls.lastApplyEnvelope).ops, draftOps());
    assert.deepEqual(deps.calls.saves[0], ["notes/groceries.md"]);
  } finally {
    session.close();
  }
});

test("direct apply skips the preview latch and still saves the target note", async () => {
  const deps = makeSessionDeps();
  const session = propertySession(deps);
  try {
    const applied = await session.applyOps(draftOps());
    assert.equal(applied.ok, true);
    assert.equal(applied.changed, true);
    assert.equal(deps.calls.preview, 0);
    assert.equal(deps.calls.apply, 1);
    assert.equal(JSON.parse(deps.calls.lastApplyEnvelope).expect, "sha256:before");
    assert.deepEqual(deps.calls.saves[0], ["notes/groceries.md"]);
    assert.equal(session.getState().expect, "sha256:after");
    assert.equal(session.getState().undoAvailable, true);
  } finally {
    session.close();
  }
});

test("edits and IME invalidation drop a pending Enter until a matching preview lands", async () => {
  const deps = makeSessionDeps();
  const session = await previewReadySession(deps);
  try {
    session.invalidateEnter();
    const denied = await session.apply();
    assert.equal(denied.code, "not-previewed");
    deps.timers.tick(PROPERTY_UPDATE_PREVIEW_DEBOUNCE_MS);
    await flushMicrotasks();
    assert.equal(session.getState().status, "preview-ready");
    const applied = await session.apply();
    assert.equal(applied.ok, true);
  } finally {
    session.close();
  }
});

test("generation change during preview refuses apply until a fresh preview", async () => {
  const deps = makeSessionDeps();
  const session = await previewReadySession(deps);
  try {
    deps.bumpGeneration();
    session.noteGenerationChanged();
    assert.equal(session.getState().status, "refused");
    const denied = await session.apply();
    assert.equal(denied.code, "not-previewed");
  } finally {
    session.close();
  }
});

test("stale apply keeps the draft, rereads, rebases, and requires a current preview", async () => {
  const deps = makeSessionDeps();
  const session = await previewReadySession(deps);
  try {
    deps.setApplyImpl(async () => ({
      ok: true,
      report: updateErrorReport({
        code: "prop_stale",
        message: "frontmatter fingerprint does not match expect",
        hint: "retry",
        key: undefined,
      }),
    }));
    deps.setShowImpl(async () => ({
      ok: true,
      report: showReport({ fingerprint: "sha256:elsewhere" }),
    }));
    const result = await session.apply();
    assert.equal(result.ok, false);
    assert.equal(result.code, "prop_stale");
    assert.equal(result.kind, "stale");
    assert.equal(session.getState().expect, "sha256:elsewhere");
    assert.deepEqual(session.getState().draftOps, draftOps());
    assert.equal(deps.calls.show, 1);
    assert.equal(session.getState().history.undo, 0);
    const denied = await session.apply();
    assert.equal(denied.code, "not-previewed");
  } finally {
    session.close();
  }
});

test("no-op, failed, and stale applies do not consume history", async () => {
  const deps = makeSessionDeps();
  const session = propertySession(deps);
  try {
    deps.setApplyImpl(async () => ({
      ok: true,
      report: updateReport({ dry_run: false, changed: false, inverse_ops: [], fingerprint_after: "sha256:before" }),
      wrote: false,
    }));
    const noop = await session.applyOps(draftOps());
    assert.equal(noop.changed, false);
    assert.equal(session.getState().history.undo, 0);

    deps.setApplyImpl(async () => ({
      ok: true,
      report: updateErrorReport({ code: "prop_owned", message: "owned", hint: "==" }),
    }));
    const failed = await session.applyOps(draftOps());
    assert.equal(failed.ok, false);
    assert.equal(session.getState().history.undo, 0);
  } finally {
    session.close();
  }
});

test("undo replays inverse ops including framing and redo restores the edit", async () => {
  const deps = makeSessionDeps();
  const session = propertySession(deps);
  try {
    deps.setApplyImpl(async () => ({
      ok: true,
      report: updateReport({
        dry_run: false,
        inverse_ops: framingRestoreOps(),
        fingerprint_after: "sha256:after",
      }),
      wrote: true,
    }));
    await session.applyOps(draftOps());
    assert.equal(session.getState().history.undo, 1);
    assert.deepEqual(deps.history.peekUndo("notes/groceries.md").inverseOps[0].framing, {
      expected: "---\n---\n",
      prior: "",
    });

    deps.setApplyImpl(async () => ({
      ok: true,
      report: updateReport({
        dry_run: false,
        fingerprint_before: "sha256:after",
        fingerprint_after: "sha256:before",
        inverse_ops: draftOps(),
        properties: [showProperty()],
      }),
      wrote: true,
    }));
    const undone = await session.undo();
    assert.equal(undone.ok, true);
    assert.equal(JSON.parse(deps.calls.lastApplyEnvelope).expect, "sha256:after");
    assert.deepEqual(JSON.parse(deps.calls.lastApplyEnvelope).ops, framingRestoreOps());
    assert.equal(session.getState().history.undo, 0);
    assert.equal(session.getState().history.redo, 1);

    deps.setApplyImpl(async () => ({
      ok: true,
      report: updateReport({ dry_run: false, inverse_ops: framingRestoreOps() }),
      wrote: true,
    }));
    const redone = await session.redo();
    assert.equal(redone.ok, true);
    assert.deepEqual(JSON.parse(deps.calls.lastApplyEnvelope).ops, draftOps());
    assert.equal(session.getState().history.undo, 1);
    assert.equal(session.getState().history.redo, 0);
  } finally {
    session.close();
  }
});

test("a new successful edit clears redo; history stays bounded and per-path", async () => {
  const history = createPropertyHistory({ limit: 20 });
  for (let index = 0; index < 25; index += 1) {
    history.pushEdit("notes/a.md", [{ op: "prop.set", key: "n", value: index }], `sha256:${index}`);
  }
  assert.equal(history.snapshot("notes/a.md").undo, 20);
  assert.equal(history.peekUndo("notes/a.md").expect, "sha256:24");
  history.pushEdit("notes/b.md", [{ op: "prop.set", key: "x", value: 1 }], "sha256:b");
  assert.equal(history.snapshot("notes/a.md").undo, 20);
  assert.equal(history.snapshot("notes/b.md").undo, 1);

  const first = history.popUndo("notes/a.md");
  history.completeUndo("notes/a.md", [{ op: "prop.set", key: "n", value: 99 }], "sha256:redo");
  assert.equal(history.snapshot("notes/a.md").redo, 1);
  history.pushEdit("notes/a.md", [{ op: "prop.set", key: "n", value: 100 }], "sha256:new");
  assert.equal(history.snapshot("notes/a.md").redo, 0);
  assert.equal(first.expect, "sha256:24");

  history.migrate("notes/a.md", "moved/a.md");
  assert.equal(history.snapshot("notes/a.md").undo, 0);
  assert.ok(history.snapshot("moved/a.md").undo > 0);
  history.release("moved/a.md");
  assert.equal(history.snapshot("moved/a.md").undo, 0);
});

test("stale undo restores the popped entry and never rewrites its expect", async () => {
  const deps = makeSessionDeps();
  const session = propertySession(deps);
  try {
    await session.applyOps(draftOps());
    const stored = deps.history.peekUndo("notes/groceries.md");
    assert.equal(stored.expect, "sha256:after");
    deps.setApplyImpl(async () => ({
      ok: true,
      report: updateErrorReport({
        code: "prop_stale",
        message: "stale",
        hint: "retry",
        key: undefined,
      }),
    }));
    deps.setShowImpl(async () => ({ ok: true, report: showReport({ fingerprint: "sha256:now" }) }));
    const result = await session.undo();
    assert.equal(result.ok, false);
    assert.equal(deps.history.peekUndo("notes/groceries.md").expect, "sha256:after");
    assert.equal(session.getState().expect, "sha256:now");
  } finally {
    session.close();
  }
});

test("save-failure refuses the apply and never reaches bob", async () => {
  const deps = makeSessionDeps();
  deps.setSaveImpl(async () => ({ ok: false, code: "save-failed", message: "pane dirty" }));
  const session = propertySession(deps);
  try {
    const result = await session.applyOps(draftOps());
    assert.equal(result.ok, false);
    assert.equal(result.kind, "save");
    assert.equal(deps.calls.apply, 0);
  } finally {
    session.close();
  }
});

test("body-only generation change during save re-previews and writes nothing", async () => {
  const deps = makeSessionDeps();
  const session = await previewReadySession(deps);
  try {
    deps.setSaveImpl(async (paths) => {
      deps.bumpGeneration();
      deps.calls.saves.push(paths.slice());
      return { ok: true };
    });
    const result = await session.apply();
    assert.equal(result.code, "save-invalidated");
    assert.equal(deps.calls.apply, 0);
  } finally {
    session.close();
  }
});

test("close during an apply defers until the write settles, then records it", async () => {
  const deps = makeSessionDeps();
  const flight = deferred();
  deps.setApplyImpl(() => flight.promise);
  const session = propertySession(deps);
  try {
    const pending = session.applyOps(draftOps());
    await flushMicrotasks();
    session.close();
    flight.resolve({
      ok: true,
      report: updateReport({ dry_run: false }),
      wrote: true,
      unknown: false,
    });
    const result = await pending;
    assert.equal(result.ok, true, "the completed write is not reported as superseded");
    assert.equal(session.getState().history.undo, 1, "history records the write that finished after close");
    assert.ok(deps.overlays.get("notes/groceries.md"), "the confirmed overlay still publishes");
    const after = await session.applyOps(draftOps());
    assert.equal(after.code, "closed", "the session closes once the deferred write settles");
    assert.equal(deps.calls.apply, 1, "the deferred close never retries the write");
  } finally {
    session.close();
  }
});

test("lock_busy waits then retries the identical envelope; stopWaiting cancels", async () => {
  const deps = makeSessionDeps();
  let applies = 0;
  deps.setApplyImpl(async () => {
    applies += 1;
    if (applies === 1) return lockBusyOutcome();
    return { ok: true, report: updateReport({ dry_run: false }), wrote: true, unknown: false };
  });
  const session = await previewReadySession(deps, draftOps(), { lockRetryMs: 50, lockWaitBudgetMs: 1000 });
  try {
    const applying = session.apply();
    await flushMicrotasks();
    assert.equal(session.getState().lockWait.attempts, 1);
    deps.timers.tick(50);
    await flushMicrotasks();
    const result = await applying;
    assert.equal(result.ok, true);
    assert.equal(applies, 2);
    assert.equal(deps.calls.saves.length, 1);
  } finally {
    session.close();
  }

  const waiting = makeSessionDeps();
  waiting.setApplyImpl(async () => lockBusyOutcome());
  const blocked = await previewReadySession(waiting, draftOps(), { lockRetryMs: 50, lockWaitBudgetMs: 1000 });
  try {
    const applying = blocked.apply();
    await flushMicrotasks();
    blocked.stopWaiting();
    const stopped = await applying;
    assert.equal(stopped.code, "lock-wait-stopped");
  } finally {
    blocked.close();
  }
});

test("unknown apply timeout never blind-retries", async () => {
  const deps = makeSessionDeps();
  const session = await previewReadySession(deps);
  try {
    deps.setApplyImpl(async () => ({ ok: false, code: "timeout", message: "timed out", unknown: true }));
    const result = await session.apply();
    assert.equal(result.ok, false);
    assert.equal(result.kind, "timeout-unknown");
    assert.match(result.hint, /Never blind-retry|never blind-retry/i);
    assert.equal(session.getState().history.undo, 0);
  } finally {
    session.close();
  }
});

test("recovery reports render and refuse writes", async () => {
  const deps = makeSessionDeps();
  const session = propertySession(deps, { expect: "", properties: recoveryShowReport().properties });
  try {
    const denied = await session.applyOps(draftOps());
    assert.equal(denied.code, "unwritable");
    assert.equal(deps.calls.apply, 0);
  } finally {
    session.close();
  }
});

test("stdin carries shell-looking values byte-identical", async () => {
  const { plugin } = makePropertyPlugin();
  try {
    const value = "$(rm -rf ~); echo `hi` && exit | 💚";
    const ops = [{ op: "prop.set", key: "title", value }];
    const envelopeText = propertyUpdateEnvelopeText("sha256:before", ops);
    const seen = {};
    const result = await plugin.apiPropertyUpdateApply("notes/groceries.md", envelopeText, {
      execFile: (command, args, options, callback) => {
        seen.command = command;
        seen.args = args;
        seen.stdinText = null;
        const stdin = {
          write: (text) => { seen.stdinText = String(text); },
          end: () => {},
          on: () => {},
        };
        callback(null, JSON.stringify(updateReport({ dry_run: false })), "");
        return { stdin };
      },
      resolved: { path: "/fixture/bin/bob", source: "candidate" },
      vaultPath: "/fixture-vault",
    });
    assert.equal(result.ok, true);
    assert.deepEqual(seen.args, ["props", "update", "notes/groceries.md", "-f", "json", "-i", "-"]);
    assert.equal(JSON.parse(seen.stdinText).ops[0].value, value);
    assert.equal(seen.args.join(" ").includes(value), false);
  } finally {
    plugin.teardownPropertyUpdate();
  }
});

test("capability gating refuses preview and apply after an old-bob show", async () => {
  const { plugin } = makePropertyPlugin();
  try {
    const shown = await plugin.apiPropertyShow("notes/groceries.md", {
      execFile: (_command, _args, _options, callback) => {
        callback({ code: 2 }, "", "error: unrecognized subcommand 'props'");
        return { stdin: { write() {}, end() {}, on() {} } };
      },
      resolved: { path: "/fixture/bin/bob", source: "candidate" },
      vaultPath: "/fixture-vault",
    });
    assert.equal(shown.code, "needs-bob");
    assert.equal(plugin.apiPropertyUpdateCapable(), false);
    const preview = await plugin.apiPropertyUpdatePreview(
      "notes/groceries.md",
      propertyUpdateEnvelopeText("sha256:x", draftOps()),
    );
    assert.equal(preview.code, "needs-bob");
    const apply = await plugin.apiPropertyUpdateApply(
      "notes/groceries.md",
      propertyUpdateEnvelopeText("sha256:x", draftOps()),
    );
    assert.equal(apply.code, "needs-bob");
  } finally {
    plugin.teardownPropertyUpdate();
  }
});

test("reopening preserves history; unload clears it; overlays expire or match", async () => {
  const { plugin, metadataChanged, timers } = makePropertyPlugin([
    { path: "notes/groceries.md", frontmatter: { count: 3 } },
  ]);
  try {
    const first = plugin.openPropertyUpdateSession({
      path: "notes/groceries.md",
      expect: "sha256:before",
      properties: [showProperty()],
      timers,
    });
    first.close();
    plugin.propertyHistory.pushEdit("notes/groceries.md", draftOps(), "sha256:after");
    const second = plugin.openPropertyUpdateSession({
      path: "notes/groceries.md",
      expect: "sha256:after",
      properties: [showProperty({ value: 4 })],
      timers,
    });
    assert.equal(second.getState().history.undo, 1);
    second.close();

    const overlay = propertyOverlayFromReport(updateReport({
      properties: [showProperty({ value: 4 })],
    }), [showProperty()]);
    plugin.propertyOverlays.push("notes/groceries.md", overlay);
    assert.equal(plugin.propertyOverlayFor("notes/groceries.md").properties[0].value, 4);
    metadataChanged({ path: "notes/groceries.md", extension: "md" }, { count: 3 });
    assert.ok(plugin.propertyOverlayFor("notes/groceries.md"), "lagging cache keeps the overlay");
    metadataChanged({ path: "notes/groceries.md", extension: "md" }, { count: 4 });
    assert.equal(plugin.propertyOverlayFor("notes/groceries.md"), null, "matching cache drops the overlay");

    plugin.propertyOverlays.push("notes/groceries.md", overlay);
    timers.tick(PROPERTY_OVERLAY_TTL_MS - 1);
    assert.ok(plugin.propertyOverlayFor("notes/groceries.md"));
    timers.tick(1);
    assert.equal(plugin.propertyOverlayFor("notes/groceries.md"), null, "overlay expires after 5s");

    plugin.propertyOverlays.push("notes/groceries.md", overlay);
    metadataChanged({ path: "notes/groceries.md", extension: "md" }, { count: 99 });
    assert.equal(plugin.propertyOverlayFor("notes/groceries.md"), null, "superseding cache drops the overlay");

    plugin.teardownPropertyUpdate();
    plugin.setupPropertyUpdate();
    assert.equal(plugin.propertyHistoryFor("notes/groceries.md").undo, 0);
  } finally {
    plugin.teardownPropertyUpdate();
  }
});

test("two notes isolate history, overlays, and apply envelopes", async () => {
  const depsA = makeSessionDeps();
  const depsB = makeSessionDeps();
  const a = propertySession(depsA, { path: "notes/a.md" });
  const b = propertySession(depsB, { path: "notes/b.md", expect: "sha256:b-before" });
  try {
    await a.applyOps(draftOps());
    await b.applyOps([{ op: "prop.set", key: "title", value: "B" }]);
    assert.equal(a.getState().history.undo, 1);
    assert.equal(b.getState().history.undo, 1);
    assert.equal(depsA.history.snapshot("notes/b.md").undo, 0);
    assert.equal(JSON.parse(depsA.calls.lastApplyEnvelope).ops[0].key, "count");
    assert.equal(JSON.parse(depsB.calls.lastApplyEnvelope).ops[0].key, "title");
    assert.ok(depsA.overlays.get("notes/a.md"));
    assert.equal(depsA.overlays.get("notes/b.md"), null);
  } finally {
    a.close();
    b.close();
  }
});
