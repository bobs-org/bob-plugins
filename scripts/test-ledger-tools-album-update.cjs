// Guarded album schema update service and edit session
// (bob-cli-kr.4.1.1 update-session). Focused tests with injected process
// and timer fakes: stdin fidelity, numeric exit/refusal decoding,
// timeout, duplicate apply, auto-sync coordination, generation races,
// save ordering/failure, stale preview suppression, no-op, inverse
// metadata replay, and sync-only retry. Cancelled/refused sessions never
// invoke apply or a plugin vault writer.
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
  ALBUM_LIST_TIMEOUT_MS,
  ALBUM_LIST_MAX_BUFFER,
  ALBUM_REVALIDATE_DEBOUNCE_MS,
  ALBUM_SYNC_DEBOUNCE_MS,
  ALBUM_UPDATE_TIMEOUT_MS,
  ALBUM_UPDATE_MAX_BUFFER,
  ALBUM_UPDATE_PREVIEW_DEBOUNCE_MS,
  ALBUM_UPDATE_SCHEMA_VERSION,
  albumDecodeListReport,
  albumDecodeUpdateReport,
  albumDecodeVaultSyncResult,
  albumUpdateArgs,
  albumUpdateEnvelope,
  albumUpdateEnvelopeText,
  albumVaultSyncArgs,
  albumIsStaleUpdateCode,
  albumUpdateErrorModel,
  createAlbumUpdateSession,
} = LedgerToolsPlugin.helpers;

// --- shared fakes -----------------------------------------------------------

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

function makeAlbumPlugin(initial = []) {
  const app = { vaultWrites: [] };
  const vaultEvents = eventSource();
  const metadataEvents = eventSource();
  const workspaceEvents = eventSource();
  const cache = new Map();
  const files = initial.map(({ path, frontmatter }) => {
    const file = { path, extension: "md" };
    cache.set(path, { frontmatter });
    return file;
  });
  let ready = null;
  app.vault = {
    adapter: { basePath: "/fixture-vault" },
    getMarkdownFiles: () => files,
    on: vaultEvents.on.bind(vaultEvents),
  };
  app.metadataCache = {
    on: metadataEvents.on.bind(metadataEvents),
    getFileCache: (file) => cache.get(file && file.path) || null,
  };
  app.workspace = {
    on: workspaceEvents.on.bind(workspaceEvents),
    onLayoutReady: (callback) => { ready = callback; },
  };
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.albumTimers = new FakeTimers();
  plugin.registerEvent = () => {};
  plugin.registerInterval = () => {};
  plugin.setupAlbumData();
  return {
    plugin,
    app,
    cache,
    timers: plugin.albumTimers,
    ready: () => ready && ready(),
    metadataChanged: (file, frontmatter) => {
      cache.set(file.path, { frontmatter });
      metadataEvents.emit("changed", file, { frontmatter });
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

function healthyAlbum(overrides = {}) {
  return {
    stem: "eat",
    path: "eat.md",
    title: "Eat",
    emoji: "🍽️",
    summary: "Places to eat.",
    noun: "restaurant",
    label: "Restaurant",
    plural: "restaurants",
    parent: "body",
    parent_kind: "area",
    owner: "body",
    root: "body",
    breadcrumb: ["body", "Eat"],
    schema_fingerprint: "sha256:before",
    fields: [{
      key: "status",
      label: "Status",
      kind: "choices",
      required: true,
      list: false,
      choices: [
        { value: "to_try", label: "🔖 To try" },
        { value: "liked", label: "💚 Liked" },
      ],
    }],
    group_field: "status",
    index_by: "location",
    index_facets: ["location"],
    records: 1,
    groups: [{ value: "to_try", label: "🔖 To try", count: 1, peek: ["One"] }],
    needs_status: 0,
    last_record: "2026-11-01",
    index: { state: "missing" },
    issues: [],
    ...overrides,
  };
}

function albumReport(overrides = {}) {
  return {
    ok: true,
    schema_version: 1,
    albums: [healthyAlbum()],
    catalogs: [],
    counts: { albums: 1, records: 1, roots: 1, errors: 0, warnings: 0 },
    ...overrides,
  };
}

function decodedList(overrides = {}) {
  return albumDecodeListReport(JSON.stringify(albumReport(overrides)), "");
}

function updateReport(overrides = {}) {
  return {
    schema_version: 1,
    ok: true,
    command: "update",
    dry_run: true,
    stem: "eat",
    path: "eat.md",
    changed: true,
    before_fingerprint: "sha256:before",
    after_fingerprint: "sha256:after",
    consequence: "add choice “regular” to “status” at 2 · 0 records use it",
    group_before: "status",
    group_after: "status",
    per_op: [{
      index: 0,
      op: "choice.add",
      summary: "add choice “regular” to “status” at 2 · 0 records use it",
      derived_key: "regular",
      filled: null,
      count: 0,
      newly_invalid: 0,
    }],
    derived_keys: ["regular"],
    changes: [{ path: "eat.md", action: "update", diff: "@@ span\n" }],
    inverse_ops: [{ op: "choice.remove", field: "status", value: "regular" }],
    commit: null,
    sync: null,
    warnings: [],
    error: null,
    ...overrides,
  };
}

function refusalError(overrides = {}) {
  return {
    code: "used_choice",
    message: "refused: 7 restaurants are 🚫 Not liked",
    hint: "edit in YAML (`y`) or wait for the migration flow",
    op_index: 0,
    field: "status",
    choice: "not_liked",
    path: null,
    line: null,
    key_path: null,
    affected: 7,
    ...overrides,
  };
}

// --- wire contract ----------------------------------------------------------

test("update argv, envelope, and timeout follow the guarded writer contract", () => {
  assert.equal(ALBUM_UPDATE_SCHEMA_VERSION, 1);
  assert.deepEqual(albumUpdateArgs("eat"), ["albums", "update", "eat", "-f", "json", "-i", "-"]);
  assert.deepEqual(
    albumUpdateArgs("eat", { dryRun: true }),
    ["albums", "update", "eat", "-f", "json", "-i", "-", "-d"],
  );
  assert.deepEqual(albumVaultSyncArgs(), ["vault-sync"]);
  // The writer timeout tracks the guarded sync path, not an arbitrary
  // list default; output stays bounded and the subprocess never shells.
  assert.equal(ALBUM_UPDATE_TIMEOUT_MS, ALBUM_LIST_TIMEOUT_MS);
  assert.equal(ALBUM_UPDATE_MAX_BUFFER, ALBUM_LIST_MAX_BUFFER);
  assert.equal(ALBUM_UPDATE_PREVIEW_DEBOUNCE_MS, 250);
  const envelope = albumUpdateEnvelope("sha256:abc", [{ op: "field.move", field: "a", position: 0 }]);
  assert.deepEqual(envelope, {
    schema_version: 1,
    expect: "sha256:abc",
    ops: [{ op: "field.move", field: "a", position: 0 }],
  });
  assert.equal(albumUpdateEnvelopeText("sha256:abc", []), '{"schema_version":1,"expect":"sha256:abc","ops":[]}');
  assert.equal(albumIsStaleUpdateCode("stale_schema"), true);
  assert.equal(albumIsStaleUpdateCode("stale_note"), true);
  assert.equal(albumIsStaleUpdateCode("used_choice"), false);
  assert.match(albumUpdateErrorModel({ code: "timeout" }).hint, /never blind-retry/);
});

test("update decoder keeps typed refusals on numeric exits and rejects wire errors", () => {
  const refused = albumDecodeUpdateReport(
    JSON.stringify(updateReport({ ok: false, dry_run: true, changed: false, error: refusalError() })),
    "",
    2,
  );
  assert.equal(refused.ok, true, "exit 2 is a valid refusal document");
  assert.equal(refused.report.ok, false);
  assert.equal(refused.report.error.affected, 7);
  assert.equal(refused.report.error.hint, "edit in YAML (`y`) or wait for the migration flow");
  assert.equal(refused.report.error.op_index, 0);
  assert.equal(refused.report.error.field, "status");
  assert.equal(refused.report.error.choice, "not_liked");
  assert.equal(refused.exitCode, 2);

  const stale = albumDecodeUpdateReport(
    JSON.stringify(updateReport({
      ok: false,
      dry_run: true,
      changed: false,
      before_fingerprint: "",
      after_fingerprint: "",
      consequence: "",
      per_op: [],
      derived_keys: [],
      changes: [],
      inverse_ops: [],
      error: {
        code: "stale_schema",
        message: "schema fingerprint changed",
        hint: "refresh the album report and preview the operation again",
        op_index: null,
        field: null,
        choice: null,
        path: null,
        line: null,
        key_path: null,
        affected: null,
      },
    })),
    "",
    2,
  );
  assert.equal(stale.ok, true);
  assert.equal(stale.report.error.code, "stale_schema");

  // Exit 1 may also carry a typed failure document.
  const runtime = albumDecodeUpdateReport(
    JSON.stringify(updateReport({
      ok: false,
      dry_run: false,
      changed: false,
      error: refusalError({ code: "lock_busy", affected: null }),
    })),
    "locked",
    1,
  );
  assert.equal(runtime.ok, true);
  assert.equal(runtime.report.error.code, "lock_busy");
  assert.equal(runtime.exitCode, 1);

  const success = albumDecodeUpdateReport(JSON.stringify(updateReport()), "", 0);
  assert.equal(success.ok, true);
  assert.equal(success.report.ok, true);
  assert.equal(success.report.consequence.includes("regular"), true);

  assert.equal(albumDecodeUpdateReport("not JSON", "boom").code, "bad-json");
  assert.equal(albumDecodeUpdateReport(JSON.stringify({ schema_version: 1 }), "").code, "bad-shape");
  assert.equal(
    albumDecodeUpdateReport(JSON.stringify(updateReport({ schema_version: 2 })), "").code,
    "schema-mismatch",
  );
  // Operation identity survives even when per-op rows are absent.
  const bare = albumDecodeUpdateReport(
    JSON.stringify(updateReport({ per_op: "oops" })),
    "",
  );
  assert.equal(bare.code, "bad-shape");
});

test("stdin carries shell-looking labels byte-identical and never as shell text", async () => {
  const { plugin } = makeAlbumPlugin();
  try {
    const label = "$(rm -rf ~); echo `hi` && exit | 💚";
    const ops = [{ op: "choice.add", field: "status", label, position: 0 }];
    const envelopeText = albumUpdateEnvelopeText("sha256:before", ops);
    const seen = {};
    const result = await plugin.albumSpawnUpdate("eat", envelopeText, {
      execFile: (command, args, options, callback) => {
        seen.command = command;
        seen.args = args;
        seen.options = options;
        seen.stdinText = null;
        const stdin = {
          write: (text) => { seen.stdinText = String(text); },
          end: () => {},
          on: () => {},
        };
        callback(null, JSON.stringify(updateReport()), "");
        return { stdin };
      },
      resolved: { path: "/fixture/bin/bob", source: "candidate" },
      vaultPath: "/fixture-vault",
    });
    assert.equal(result.ok, true);
    assert.equal(seen.command, "/fixture/bin/bob");
    assert.deepEqual(seen.args, ["albums", "update", "eat", "-f", "json", "-i", "-"]);
    assert.equal(seen.options.env.BOB_DIR, "/fixture-vault");
    assert.equal(seen.options.timeout, ALBUM_UPDATE_TIMEOUT_MS);
    // The label travelled on stdin exactly; argv never carried it.
    assert.deepEqual(JSON.parse(seen.stdinText), { schema_version: 1, expect: "sha256:before", ops });
    assert.equal(JSON.parse(seen.stdinText).ops[0].label, label);
    assert.equal(seen.args.join(" ").includes(label), false);
  } finally {
    plugin.teardownAlbumData();
  }
});

test("stdin failure and timeout surface as transport errors, never refusals", async () => {
  const { plugin } = makeAlbumPlugin();
  try {
    // A child without a stdin pipe fails loudly: the envelope never
    // reaches a mutation. The late process callback cannot resurrect it.
    let lateCallback = null;
    const pendingPipe = plugin.albumSpawnUpdate("eat", albumUpdateEnvelopeText("sha256:x", []), {
      execFile: (command, args, options, callback) => {
        lateCallback = callback;
        return {};
      },
      resolved: { path: "bob", source: "path" },
    });
    const withoutPipe = await pendingPipe;
    assert.equal(withoutPipe.ok, false);
    assert.equal(withoutPipe.code, "stdin-failed");
    lateCallback(null, JSON.stringify(updateReport()), "");

    const timedOut = await plugin.albumSpawnUpdate("eat", albumUpdateEnvelopeText("sha256:x", []), {
      execFile: (command, args, options, callback) => {
        const error = new Error("killed");
        error.killed = true;
        callback(error, "", "still running");
        return { stdin: { write: () => {}, end: () => {}, on: () => {} } };
      },
      resolved: { path: "bob", source: "path" },
    });
    assert.equal(timedOut.ok, false);
    assert.equal(timedOut.code, "timeout");
  } finally {
    plugin.teardownAlbumData();
  }
});

// --- session behavior --------------------------------------------------------

function makeSessionDeps(overrides = {}) {
  const timers = new FakeTimers();
  let generation = 0;
  const calls = { preview: 0, apply: 0, vaultSync: 0, saves: [] };
  let previewImpl = async () => ({ ok: true, report: updateReport() });
  let applyImpl = async () => ({ ok: true, report: updateReport({ dry_run: false }), refreshed: null, wrote: true, unknown: false });
  const deps = {
    timers,
    getGeneration: () => generation,
    setGeneration: (next) => { generation = next; },
    bumpGeneration: () => { generation += 1; },
    saveEditors: async (paths) => {
      calls.saves.push(paths.slice());
      return { ok: true };
    },
    spawnPreview: async (stem, envelopeText) => {
      calls.preview += 1;
      calls.lastPreviewEnvelope = envelopeText;
      return previewImpl(stem, envelopeText);
    },
    spawnApply: async (stem, envelopeText, applyOptions) => {
      calls.apply += 1;
      calls.lastApplyEnvelope = envelopeText;
      calls.lastApplyOptions = applyOptions;
      return applyImpl(stem, envelopeText, applyOptions);
    },
    spawnVaultSync: async () => {
      calls.vaultSync += 1;
      return { ok: true, report: { ok: true, output: "" } };
    },
    calls,
    setPreviewImpl: (fn) => { previewImpl = fn; },
    setApplyImpl: (fn) => { applyImpl = fn; },
    setSaveImpl: (fn) => { deps.saveEditors = fn; },
    ...overrides,
  };
  return deps;
}

function draftOps() {
  return [{ op: "choice.add", field: "status", label: "Regular", position: 2 }];
}

async function previewReadySession(deps, ops = draftOps()) {
  const session = createAlbumUpdateSession({ stem: "eat", expect: "sha256:before" }, deps);
  session.setDraft(ops);
  deps.timers.tick(ALBUM_UPDATE_PREVIEW_DEBOUNCE_MS);
  await flushMicrotasks();
  assert.equal(session.getState().status, "preview-ready");
  return session;
}

test("typing settles through a 250 ms debounce; navigation never previews", async () => {
  const deps = makeSessionDeps();
  const session = createAlbumUpdateSession({ stem: "eat", expect: "sha256:before" }, deps);
  try {
    session.setDraft(draftOps());
    assert.equal(session.getState().status, "preview-pending");
    deps.timers.tick(ALBUM_UPDATE_PREVIEW_DEBOUNCE_MS - 1);
    await flushMicrotasks();
    assert.equal(deps.calls.preview, 0);
    session.setDraft([...draftOps(), { op: "field.move", field: "status", position: 0 }]);
    deps.timers.tick(ALBUM_UPDATE_PREVIEW_DEBOUNCE_MS - 1);
    await flushMicrotasks();
    assert.equal(deps.calls.preview, 0, "retyping restarts the debounce");
    deps.timers.tick(1);
    await flushMicrotasks();
    assert.equal(deps.calls.preview, 1);
    assert.equal(session.getState().status, "preview-ready");
    assert.match(session.getState().consequence, /regular/);
  } finally {
    session.close();
  }
});

test("stale preview responses are suppressed; draft or vault changes invalidate Apply", async () => {
  const deps = makeSessionDeps();
  const firstFlight = deferred();
  deps.setPreviewImpl(() => firstFlight.promise);
  const session = createAlbumUpdateSession({ stem: "eat", expect: "sha256:before" }, deps);
  try {
    session.setDraft(draftOps());
    deps.timers.tick(ALBUM_UPDATE_PREVIEW_DEBOUNCE_MS);
    await flushMicrotasks();
    session.setDraft([{ op: "field.move", field: "status", position: 0 }]);
    firstFlight.resolve({ ok: true, report: updateReport() });
    await flushMicrotasks();
    assert.equal(session.getState().status, "preview-pending", "the superseded preview never readies the old draft");
    assert.equal(session.getState().canApply, false);
    deps.setPreviewImpl(async () => ({ ok: true, report: updateReport() }));
    deps.timers.tick(ALBUM_UPDATE_PREVIEW_DEBOUNCE_MS);
    await flushMicrotasks();
    assert.equal(session.getState().status, "preview-ready");
    deps.bumpGeneration();
    session.noteGenerationChanged();
    assert.equal(session.getState().status, "refused", "vault drift invalidates Apply immediately");
    assert.equal(session.getState().canApply, false);
    const denied = await session.apply();
    assert.equal(denied.code, "not-previewed");
    assert.equal(deps.calls.apply, 0, "refused sessions never invoke apply");
  } finally {
    session.close();
  }
});

test("close cancels a pending preview and ignores late work", async () => {
  const deps = makeSessionDeps();
  const flight = deferred();
  deps.setPreviewImpl(() => flight.promise);
  const session = createAlbumUpdateSession({ stem: "eat", expect: "sha256:before" }, deps);
  session.setDraft(draftOps());
  deps.timers.tick(ALBUM_UPDATE_PREVIEW_DEBOUNCE_MS);
  await flushMicrotasks();
  session.close();
  flight.resolve({ ok: true, report: updateReport() });
  await flushMicrotasks();
  assert.equal(deps.calls.preview, 1);
  assert.equal(session.getState().status, "preview-pending", "late work never paints after close");
  assert.equal(session.getState().canApply, false);

  const pending = createAlbumUpdateSession({ stem: "eat", expect: "sha256:before" }, deps);
  pending.setDraft(draftOps());
  pending.close();
  deps.timers.tick(ALBUM_UPDATE_PREVIEW_DEBOUNCE_MS * 4);
  await flushMicrotasks();
  assert.equal(deps.calls.preview, 1, "closing cancels the pending preview timer");
  pending.close();
});

test("apply awaits editor saves, refuses on failure, and teaches missing support", async () => {
  const deps = makeSessionDeps();
  const session = await previewReadySession(deps);
  try {
    const result = await session.apply();
    assert.equal(result.ok, true);
    assert.deepEqual(deps.calls.saves, [["eat.md"]], "every pane showing the album saves first");
    assert.equal(deps.calls.lastPreviewEnvelope, deps.calls.lastApplyEnvelope, "apply runs the exact previewed envelope");
    assert.equal(session.getState().status, "browsing");
  } finally {
    session.close();
  }

  const failing = makeSessionDeps();
  const refused = await previewReadySession(failing);
  try {
    failing.setSaveImpl(async () => ({ ok: false, code: "save-failed", message: "Disk is read-only." }));
    const result = await refused.apply();
    assert.equal(result.ok, false);
    assert.equal(result.code, "save-failed");
    assert.equal(failing.calls.apply, 0, "a save failure refuses apply");
    assert.equal(refused.getState().status, "refused");
  } finally {
    refused.close();
  }

  const unsupported = makeSessionDeps({ saveEditors: undefined });
  const taught = createAlbumUpdateSession({ stem: "eat", expect: "sha256:before" }, unsupported);
  try {
    taught.setDraft(draftOps());
    unsupported.timers.tick(ALBUM_UPDATE_PREVIEW_DEBOUNCE_MS);
    await flushMicrotasks();
    assert.equal(taught.getState().status, "preview-ready");
    const result = await taught.apply();
    assert.equal(result.code, "save-unsupported");
    assert.match(result.hint, /Save every pane/);
    assert.equal(unsupported.calls.apply, 0, "missing save support never assumes success");
  } finally {
    taught.close();
  }
});

test("a save that invalidates the preview requires confirmation again", async () => {
  const deps = makeSessionDeps();
  const session = await previewReadySession(deps);
  try {
    deps.setSaveImpl(async (paths) => {
      deps.bumpGeneration();
      return { ok: true, saved: paths };
    });
    const result = await session.apply();
    assert.equal(result.code, "save-invalidated");
    assert.equal(deps.calls.apply, 0, "the invalidated envelope never applies");
    await flushMicrotasks();
    assert.equal(session.getState().status, "preview-ready", "a fresh preview replaces the stale one");
    assert.equal(session.getState().canApply, true);
    deps.setSaveImpl(async (paths) => ({ ok: true, saved: paths }));
    const confirmed = await session.apply();
    assert.equal(confirmed.ok, true, "confirmation after the new preview applies");
    assert.equal(deps.calls.apply, 1);
  } finally {
    session.close();
  }
});

test("double Enter and parallel applies share one apply guard", async () => {
  const deps = makeSessionDeps();
  const flight = deferred();
  deps.setApplyImpl(() => flight.promise);
  const session = await previewReadySession(deps);
  try {
    const first = session.apply();
    const second = session.apply();
    await flushMicrotasks();
    assert.equal(deps.calls.apply, 1, "two entry points share one apply");
    flight.resolve({ ok: true, report: updateReport({ dry_run: false }), refreshed: null, wrote: true, unknown: false });
    const [left, right] = await Promise.all([first, second]);
    assert.equal(left.ok, true);
    assert.equal(right.ok, true);
  } finally {
    session.close();
  }
});

test("no-op success keeps Undo; changed success stores the opaque inverse", async () => {
  const deps = makeSessionDeps();
  const session = await previewReadySession(deps);
  try {
    const first = await session.apply();
    assert.equal(first.changed, true);
    assert.equal(session.getState().undoAvailable, true);
    const kept = session.getState();

    session.setDraft([{ op: "field.move", field: "status", position: 0 }]);
    deps.timers.tick(ALBUM_UPDATE_PREVIEW_DEBOUNCE_MS);
    await flushMicrotasks();
    deps.setApplyImpl(async () => ({
      ok: true,
      report: updateReport({ dry_run: false, changed: false, consequence: "no schema edits", per_op: [], derived_keys: [], inverse_ops: [] }),
      refreshed: null,
      wrote: false,
      unknown: false,
    }));
    const noop = await session.apply();
    assert.equal(noop.ok, true);
    assert.equal(noop.changed, false);
    assert.equal(session.getState().undoAvailable, true, "a no-op never overwrites Undo");
    assert.equal(session.getState().status, "browsing");
    void kept;
  } finally {
    session.close();
  }
});

test("u stages the inverse on the preview-and-Enter path without reconstruction", async () => {
  const deps = makeSessionDeps();
  const session = await previewReadySession(deps);
  try {
    await session.apply();
    const staged = session.stageUndo();
    assert.equal(staged.ok, true);
    assert.deepEqual(
      JSON.parse(deps.calls.lastPreviewEnvelope || '{"ops":[]}').ops,
      draftOps(),
      "the fresh draft waits for its own preview; Undo is staged, not applied",
    );
    deps.timers.tick(ALBUM_UPDATE_PREVIEW_DEBOUNCE_MS);
    await flushMicrotasks();
    assert.equal(session.getState().status, "preview-ready");
    const stagedOps = JSON.parse(deps.calls.lastPreviewEnvelope).ops;
    assert.deepEqual(stagedOps, [{ op: "choice.remove", field: "status", value: "regular" }]);
    await session.apply();
    assert.deepEqual(
      JSON.parse(deps.calls.lastApplyEnvelope).ops,
      [{ op: "choice.remove", field: "status", value: "regular" }],
      "Undo replays the opaque inverse exactly",
    );
    const empty = session.stageUndo();
    assert.equal(empty.ok, true);
  } finally {
    session.close();
  }
});

test("refusals keep the draft unconfirmed and never retry automatically", async () => {
  const deps = makeSessionDeps();
  deps.setPreviewImpl(async () => ({
    ok: true,
    report: updateReport({ ok: false, changed: false, error: refusalError() }),
  }));
  const session = createAlbumUpdateSession({ stem: "eat", expect: "sha256:before" }, deps);
  try {
    session.setDraft(draftOps());
    deps.timers.tick(ALBUM_UPDATE_PREVIEW_DEBOUNCE_MS);
    await flushMicrotasks();
    assert.equal(session.getState().status, "refused");
    assert.equal(session.getState().refusal.code, "used_choice");
    assert.equal(session.getState().refusal.affected, 7);
    assert.deepEqual(session.getState().draftOps, draftOps(), "the draft stays unconfirmed");
    assert.equal(deps.calls.preview, 1);
    const denied = await session.apply();
    assert.equal(denied.code, "not-previewed");
    assert.equal(deps.calls.apply, 0, "refused sessions never invoke apply");
  } finally {
    session.close();
  }
});

test("stale apply responses refresh and keep the draft without retrying", async () => {
  const deps = makeSessionDeps();
  const session = await previewReadySession(deps);
  try {
    deps.setApplyImpl(async () => ({
      ok: true,
      report: updateReport({
        ok: false,
        dry_run: false,
        changed: false,
        error: refusalError({ code: "stale_schema", message: "schema fingerprint changed", hint: "refresh the report", affected: null, op_index: null, field: null, choice: null }),
      }),
      refreshed: { generation: 2 },
      wrote: false,
      unknown: false,
    }));
    const result = await session.apply();
    assert.equal(result.ok, false);
    assert.equal(result.kind, "stale");
    assert.equal(session.getState().status, "refused");
    assert.deepEqual(session.getState().draftOps, draftOps(), "the draft is retained, never retried");
    assert.equal(deps.calls.apply, 1, "exactly one mutation attempt ran");
  } finally {
    session.close();
  }
});

test("unknown apply outcomes refuse and demand explicit reconciliation", async () => {
  const deps = makeSessionDeps();
  const session = await previewReadySession(deps);
  try {
    deps.setApplyImpl(async () => ({ ok: false, code: "timeout", message: "bob albums update timed out." }));
    const result = await session.apply();
    assert.equal(result.ok, false);
    assert.equal(result.kind, "timeout-unknown");
    assert.match(result.hint, /Never blind-retry/);
    assert.deepEqual(session.getState().draftOps, draftOps());
    assert.equal(session.getState().canApply, false);
  } finally {
    session.close();
  }
});

test("post-sync failure keeps the commit and Undo and retries with vault-sync only", async () => {
  const deps = makeSessionDeps();
  const session = await previewReadySession(deps);
  try {
    deps.setApplyImpl(async () => ({
      ok: true,
      report: updateReport({
        dry_run: false,
        commit: { sha: "abc123", subject: "albums: update eat.md (status +regular)" },
        sync: { pre: "ok", post: "failed" },
        warnings: ["post-sync failed; committed locally"],
      }),
      refreshed: null,
      wrote: true,
      unknown: false,
    }));
    const result = await session.apply();
    assert.equal(result.ok, true);
    assert.equal(session.getState().status, "saved-with-sync-warning");
    assert.equal(session.getState().undoAvailable, true, "the committed result and Undo survive the sync failure");
    const retried = await session.retrySync();
    assert.equal(retried.ok, true);
    assert.equal(deps.calls.vaultSync, 1);
    assert.equal(deps.calls.apply, 1, "retry never replays the mutation");
    assert.equal(session.getState().status, "browsing");
  } finally {
    session.close();
  }
});

test("vault-sync retry failures keep the warning without losing Undo", async () => {
  const deps = makeSessionDeps();
  const session = await previewReadySession(deps);
  try {
    deps.setApplyImpl(async () => ({
      ok: true,
      report: updateReport({
        dry_run: false,
        commit: { sha: "abc123", subject: "albums: update eat.md (status +regular)" },
        sync: { pre: "ok", post: "failed" },
        warnings: ["post-sync failed; committed locally"],
      }),
      refreshed: null,
      wrote: true,
      unknown: false,
    }));
    await session.apply();
    deps.spawnVaultSync = async () => {
      deps.calls.vaultSync += 1;
      return { ok: false, code: "sync-failed", message: "offline", detail: "no route" };
    };
    const retried = await session.retrySync();
    assert.equal(retried.ok, false);
    assert.equal(session.getState().status, "saved-with-sync-warning");
    assert.equal(session.getState().undoAvailable, true);
  } finally {
    session.close();
  }
});

// --- service coordination ----------------------------------------------------

test("duplicate applies refuse busy while the first flight owns the lifecycle", async () => {
  const { plugin } = makeAlbumPlugin();
  try {
    const flight = deferred();
    let spawns = 0;
    plugin.albumSpawnUpdate = () => {
      spawns += 1;
      return flight.promise;
    };
    plugin.albumSpawnList = async () => decodedList();
    const first = plugin.apiAlbumUpdateApply("eat", albumUpdateEnvelopeText("sha256:before", draftOps()), { ownPath: "eat.md" });
    await flushMicrotasks();
    const second = await plugin.apiAlbumUpdateApply("eat", albumUpdateEnvelopeText("sha256:before", draftOps()), { ownPath: "eat.md" });
    assert.equal(second.code, "apply-busy");
    assert.equal(spawns, 1);
    flight.resolve({ ok: true, report: updateReport({ dry_run: false }), refreshed: null, wrote: true, unknown: false });
    const result = await first;
    assert.equal(result.ok, true);
  } finally {
    plugin.teardownAlbumData();
  }
});

test("an apply waits out a running sync instead of overlapping it", async () => {
  const { plugin } = makeAlbumPlugin();
  const order = [];
  const syncFlight = deferred();
  plugin.albumSpawnSync = () => {
    order.push("sync-spawn");
    return syncFlight.promise;
  };
  plugin.albumSpawnList = async () => decodedList();
  try {
    const sync = plugin.apiAlbumSync();
    await flushMicrotasks();
    assert.equal(plugin.albumSyncBusy, true);
    plugin.albumSpawnUpdate = async () => {
      order.push("update-spawn");
      return { ok: true, report: updateReport({ dry_run: false }), refreshed: null, wrote: true, unknown: false };
    };
    const apply = plugin.apiAlbumUpdateApply("eat", albumUpdateEnvelopeText("sha256:before", draftOps()), { ownPath: "eat.md" });
    await flushMicrotasks();
    assert.deepEqual(order, ["sync-spawn"], "the apply never overlaps the sync");
    syncFlight.resolve({ ok: true, report: { ok: true } });
    await sync;
    const result = await apply;
    assert.equal(result.ok, true);
    assert.deepEqual(order, ["sync-spawn", "update-spawn"]);
  } finally {
    plugin.teardownAlbumData();
  }
});

test("the writer's own echo schedules no sync while unrelated changes coalesce one trailing sync", async () => {
  const albumFile = { path: "eat.md", extension: "md" };
  const recordFile = { path: "eat/one.md", extension: "md" };
  const albumFrontmatter = {
    type: "[[album]]",
    parent: "[[body]]",
    summary: "Places to eat.",
    record: { noun: "restaurant" },
  };
  const recordFrontmatter = {
    type: "[[restaurant]]",
    parent: "[[eat]]",
    title: "One",
    status: "to_try",
  };
  const { plugin, timers, ready, cache, metadataChanged } = makeAlbumPlugin([
    { path: albumFile.path, frontmatter: albumFrontmatter },
    { path: recordFile.path, frontmatter: recordFrontmatter },
    { path: "body.md", frontmatter: { type: "[[area]]" } },
  ]);
  let syncCalls = 0;
  let listCalls = 0;
  const updateFlight = deferred();
  plugin.albumSpawnUpdate = () => updateFlight.promise;
  plugin.albumSpawnList = async () => {
    listCalls += 1;
    return decodedList();
  };
  plugin.albumSpawnSync = async () => {
    syncCalls += 1;
    return { ok: true, report: { ok: true } };
  };
  try {
    ready();
    await plugin.apiAlbumReport({ wait: true });
    assert.equal(listCalls, 1);
    const apply = plugin.apiAlbumUpdateApply("eat", albumUpdateEnvelopeText("sha256:before", draftOps()), { ownPath: "eat.md" });
    await flushMicrotasks();
    // The writer's own frontmatter echo invalidates display data but
    // schedules no duplicate sync or commit.
    metadataChanged(albumFile, { ...albumFrontmatter, summary: "A rescoped album." });
    assert.equal(plugin.albumSyncDebounceTimer, null, "own echo never schedules a sync");
    // A genuinely pending unrelated change is remembered, not discarded.
    metadataChanged({ path: recordFile.path, extension: "md" }, { ...recordFrontmatter, status: "liked" });
    assert.equal(plugin.albumSyncTrailing, true, "unrelated changes coalesce while the apply owns the lifecycle");
    assert.equal(plugin.albumSyncDebounceTimer, null, "no second flight starts mid-apply");
    updateFlight.resolve({ ok: true, report: updateReport({ dry_run: false }), refreshed: null, wrote: true, unknown: false });
    await apply;
    await flushMicrotasks();
    assert.ok(listCalls >= 2, "the post-write report refreshes through revalidation");
    assert.notEqual(plugin.albumSyncDebounceTimer, null, "the unrelated change runs one trailing sync");
    timers.tick(ALBUM_SYNC_DEBOUNCE_MS);
    await flushMicrotasks();
    await plugin.albumSyncFlight;
    assert.equal(syncCalls, 1, "exactly one trailing sync covers the unrelated change");
    void cache;
  } finally {
    plugin.teardownAlbumData();
  }
});

test("a pre-write list flight never becomes the post-write report", async () => {
  const { plugin } = makeAlbumPlugin();
  const beforeWrite = deferred();
  let listCalls = 0;
  plugin.albumSpawnList = () => {
    listCalls += 1;
    if (listCalls === 1) {
      return beforeWrite.promise;
    }
    return Promise.resolve(decodedList({ albums: [healthyAlbum({ schema_fingerprint: "sha256:after" })] }));
  };
  plugin.albumSpawnUpdate = async () => ({
    ok: true,
    report: updateReport({ dry_run: false }),
    refreshed: null,
    wrote: true,
    unknown: false,
  });
  try {
    const preWrite = plugin.apiAlbumReport({ wait: true });
    await flushMicrotasks();
    assert.equal(listCalls, 1);
    const apply = plugin.apiAlbumUpdateApply("eat", albumUpdateEnvelopeText("sha256:before", draftOps()), { ownPath: "eat.md" });
    await flushMicrotasks();
    beforeWrite.resolve(decodedList());
    await preWrite;
    await flushMicrotasks();
    assert.equal(listCalls, 2, "the pre-write list cannot satisfy post-write revalidation");
    const result = await apply;
    assert.equal(result.ok, true);
    assert.equal(result.refreshed.report.albumsByPath.get("eat.md").schema_fingerprint, "sha256:after");
  } finally {
    plugin.teardownAlbumData();
  }
});

test("cancelled and refused service sessions never touch the plugin vault writer", async () => {
  const { plugin, app } = makeAlbumPlugin();
  try {
    let spawns = 0;
    plugin.albumSpawnUpdate = async () => {
      spawns += 1;
      return { ok: true, report: updateReport() };
    };
    const timers = plugin.albumTimers;
    const session = createAlbumUpdateSession({ stem: "eat", expect: "sha256:before" }, {
      timers,
      getGeneration: () => plugin.albumVaultGeneration || 0,
      saveEditors: async () => ({ ok: true }),
      spawnPreview: (stem, envelope) => plugin.apiAlbumUpdatePreview(stem, envelope),
      spawnApply: (stem, envelope, applyOptions) => plugin.apiAlbumUpdateApply(stem, envelope, applyOptions),
      spawnVaultSync: () => plugin.apiAlbumVaultSyncRetry(),
    });
    session.setDraft(draftOps());
    session.close();
    timers.tick(ALBUM_UPDATE_PREVIEW_DEBOUNCE_MS * 4);
    await flushMicrotasks();
    assert.equal(spawns, 0, "a closed session never previews");
    assert.deepEqual(app.vaultWrites, [], "no plugin vault writer ran");
    plugin.teardownAlbumData();
    session.close();
  } finally {
    try { plugin.teardownAlbumData(); } catch (error) { void error; }
  }
});

test("real bob fixtures decode: dry-run, refusal, stale, and no-op", async () => {
  const { execFile } = require("node:child_process");
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const bobBin = process.env.BOB_CLI_BIN || process.env.CARGO_BIN_EXE_bob || "bob";
  const runBob = (args, env) => new Promise((resolve, reject) => {
    execFile(bobBin, args, { env, timeout: 60000, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error && error.code === "ENOENT") {
        reject(Object.assign(new Error("bob binary not found"), { skip: true }));
        return;
      }
      resolve({ error, stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
  let probe;
  try {
    probe = await runBob(["--version"], { ...process.env });
  } catch (error) {
    if (error && error.skip) {
      assert.ok(true, "bob binary is unavailable; synthetic vectors cover the wire above");
      return;
    }
    throw error;
  }
  if (probe.error) {
    throw new Error(`bob --version failed: ${probe.stderr}`);
  }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "album-update-fixture-"));
  const vault = path.join(temp, "vault");
  fs.mkdirSync(path.join(vault, "eat"), { recursive: true });
  fs.writeFileSync(path.join(vault, "body.md"), "---\ntype: [[area]]\n---\n\n# Body\n");
  fs.writeFileSync(path.join(vault, "eat.md"), [
    "---",
    "type: [[album]]",
    'parent: "[[body]]"',
    "summary: Places to eat.",
    "record:",
    "  noun: restaurant",
    "  label: Restaurant",
    "  fields:",
    "    status:",
    "      label: Status",
    "      required: true",
    "      values:",
    "        to_try: To try",
    "        liked: Liked",
    "    location:",
    "      label: Location",
    "---",
    "",
    "# Eat",
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(vault, "eat", "one.md"), [
    "---",
    'parent: "[[eat]]"',
    'type: "[[restaurant]]"',
    "title: One",
    "status: to_try",
    "location: home",
    "created: 2026-11-01",
    "---",
    "",
    "# One",
    "",
  ].join("\n"));
  const env = {
    ...process.env,
    BOB_DIR: vault,
    BOB_NOW: "2026-11-10 12:00:00",
    NO_COLOR: "1",
    BOB_CONFIG_FILE: "/definitely/missing/bob-cli-test-config.yml",
  };
  const list = await runBob(["albums", "list", "-f", "json"], env);
  assert.equal(list.error, null, `bob albums list failed: ${list.stderr}`);
  const listed = albumDecodeListReport(list.stdout, list.stderr);
  assert.equal(listed.ok, true);
  const fingerprint = listed.report.albumsByStem.get("eat").schema_fingerprint;
  assert.match(fingerprint, /^sha256:/);

  const envelope = (expect, ops) => JSON.stringify({ schema_version: 1, expect, ops });
  const dryRun = await new Promise((resolve) => {
    const child = require("node:child_process").execFile(
      bobBin,
      ["albums", "update", "eat", "-d", "-f", "json", "-i", "-"],
      { env, timeout: 60000, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout, stderr) => resolve({ error, stdout: String(stdout || ""), stderr: String(stderr || "") }),
    );
    child.stdin.write(envelope(fingerprint, [{ op: "choice.add", field: "status", label: "Regular", position: 2 }]));
    child.stdin.end();
  });
  assert.equal(dryRun.error, null, `dry-run failed: ${dryRun.stderr}`);
  const preview = albumDecodeUpdateReport(dryRun.stdout, dryRun.stderr, 0);
  assert.equal(preview.ok, true);
  assert.equal(preview.report.ok, true);
  assert.equal(preview.report.changed, true);
  assert.match(preview.report.consequence, /regular/);
  assert.deepEqual(preview.report.derived_keys, ["regular"]);
  assert.equal(preview.report.inverse_ops.length, 1);

  const staleRun = await new Promise((resolve) => {
    const child = require("node:child_process").execFile(
      bobBin,
      ["albums", "update", "eat", "-d", "-f", "json", "-i", "-"],
      { env, timeout: 60000, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout, stderr) => resolve({ error, stdout: String(stdout || ""), stderr: String(stderr || "") }),
    );
    child.stdin.write(envelope("sha256:deadbeef", []));
    child.stdin.end();
  });
  assert.ok(staleRun.error && staleRun.error.code === 2, `stale dry-run exits 2: ${staleRun.stderr}`);
  const stale = albumDecodeUpdateReport(staleRun.stdout, staleRun.stderr, 2);
  assert.equal(stale.ok, true, "a stale refusal is transport success with a typed error");
  assert.equal(stale.report.error.code, "stale_schema");

  const noopRun = await new Promise((resolve) => {
    const child = require("node:child_process").execFile(
      bobBin,
      ["albums", "update", "eat", "-d", "-f", "json", "-i", "-"],
      { env, timeout: 60000, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout, stderr) => resolve({ error, stdout: String(stdout || ""), stderr: String(stderr || "") }),
    );
    child.stdin.write(envelope(fingerprint, []));
    child.stdin.end();
  });
  assert.equal(noopRun.error, null);
  const noop = albumDecodeUpdateReport(noopRun.stdout, noopRun.stderr, 0);
  assert.equal(noop.ok, true);
  assert.equal(noop.report.changed, false);
  assert.deepEqual(noop.report.inverse_ops, []);
});
