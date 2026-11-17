// Guarded record value update service and session (bob-cli-ms.4).
// Fake spawns, timers, and workspace: decoders, direct-apply vs preview,
// stale rebase, Undo, save failure, echo suppression, overlay expiry,
// capability gating, and late responses after close.
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
  ALBUM_SYNC_DEBOUNCE_MS,
  RECORD_UPDATE_SCHEMA_VERSION,
  RECORD_UPDATE_TIMEOUT_MS,
  RECORD_UPDATE_MAX_BUFFER,
  RECORD_UPDATE_PREVIEW_DEBOUNCE_MS,
  RECORD_SHEET_OVERLAY_TTL_MS,
  recordShowArgs,
  recordUpdateArgs,
  recordUpdateEnvelope,
  recordUpdateEnvelopeText,
  recordIsStaleUpdateCode,
  recordDecodeShowReport,
  recordDecodeUpdateReport,
  recordOverlayFromReport,
  createRecordUpdateSession,
  createAlbumUpdateSession,
  createBankConfigUpdateSession,
  recordSheetMergeFrontmatter,
  albumDecodeListReport,
  albumUpdateEnvelopeText,
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
    schema_fingerprint: "sha256:schema",
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
    capabilities: ["record_values_v1"],
    albums: [healthyAlbum()],
    catalogs: [],
    counts: { albums: 1, records: 1, roots: 1, errors: 0, warnings: 0 },
    ...overrides,
  };
}

function decodedList(overrides = {}) {
  return albumDecodeListReport(JSON.stringify(albumReport(overrides)), "");
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
    getAbstractFileByPath: (path) => files.find((file) => file.path === path) || { path },
    on: vaultEvents.on.bind(vaultEvents),
  };
  app.metadataCache = {
    on: metadataEvents.on.bind(metadataEvents),
    getFileCache: (file) => cache.get(file && file.path) || null,
  };
  app.workspace = {
    on: workspaceEvents.on.bind(workspaceEvents),
    onLayoutReady: (callback) => { ready = callback; },
    getLeavesOfType: () => [],
  };
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.albumTimers = new FakeTimers();
  plugin.registerEvent = () => {};
  plugin.registerInterval = () => {};
  plugin.setupAlbumData();
  plugin.setupRecordUpdate();
  plugin.setupRecordSheet();
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

function showReport(overrides = {}) {
  const record = {
    stem: "ninja_sushi",
    path: "eat/ninja_sushi.md",
    title: "Ninja Sushi",
    heading: "Ninja Sushi",
    created: null,
    fingerprint: "sha256:record-before",
    schema_fingerprint: "sha256:schema",
    frontmatter_end_line: 8,
    group: { field: "status", value: "to_try", label: "🔖 To try" },
    properties: [{
      key: "status",
      label: "Status",
      kind: "choices",
      required: true,
      list: false,
      state: "set",
      value: "to_try",
      display: "🔖 To try",
      raw: "to_try",
      line: 5,
    }],
    identity: [{ key: "parent", line: 2, value: "[[eat]]" }],
    other: [],
    findings: [],
    ...(overrides.record || {}),
  };
  const { record: _ignored, ...rest } = overrides;
  return {
    schema_version: 1,
    type: "restaurant",
    label: "Restaurant",
    dir: "eat",
    emoji: "🍽️",
    dated_notes: false,
    count: 1,
    fields: [],
    record,
    ...rest,
  };
}

function updateReport(overrides = {}) {
  return {
    schema_version: 1,
    ok: true,
    command: "update",
    dry_run: true,
    type: "restaurant",
    stem: "ninja_sushi",
    path: "eat/ninja_sushi.md",
    changed: ["status"],
    properties: [{
      key: "status",
      label: "Status",
      state: "set",
      value: "liked",
      display: "💚 Liked",
      before: "to_try",
      before_display: "🔖 To try",
      source: "typed",
    }],
    changes: [{
      key: "status",
      label: "Status",
      before_display: "🔖 To try",
      after_display: "💚 Liked",
    }],
    fingerprint_before: "sha256:record-before",
    fingerprint_after: "sha256:record-after",
    inverse_ops: [{ op: "field.set", field: "status", value: "to_try" }],
    group_before: { field: "status", value: "to_try", label: "🔖 To try" },
    group_after: { field: "status", value: "liked", label: "💚 Liked" },
    consequence: "Status: 🔖 To try → 💚 Liked; moves to the 💚 Liked group",
    warnings: [],
    error: null,
    ...overrides,
  };
}

function refusalError(overrides = {}) {
  return {
    code: "record_invalid_value",
    message: "status is not a Status choice",
    hint: "did you mean `liked`?",
    field: "status",
    ...overrides,
  };
}

function draftOps() {
  return [{ op: "field.set", field: "status", value: "liked" }];
}

function makeSessionDeps(overrides = {}) {
  const timers = new FakeTimers();
  let generation = 0;
  const calls = { preview: 0, apply: 0, vaultSync: 0, saves: [] };
  let previewImpl = async () => ({ ok: true, report: updateReport() });
  let applyImpl = async () => ({
    ok: true,
    report: updateReport({ dry_run: false }),
    refreshed: null,
    wrote: true,
    unknown: false,
  });
  const deps = {
    timers,
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

function recordSession(deps, init = {}) {
  return createRecordUpdateSession({
    type: "restaurant",
    stem: "ninja_sushi",
    recordPath: "eat/ninja_sushi.md",
    albumPath: "eat.md",
    expect: "sha256:record-before",
    ...init,
  }, deps);
}

async function previewReadySession(deps, ops = draftOps(), init = {}) {
  const session = recordSession(deps, init);
  session.setDraft(ops);
  deps.timers.tick(RECORD_UPDATE_PREVIEW_DEBOUNCE_MS);
  await flushMicrotasks();
  assert.equal(session.getState().status, "preview-ready");
  return session;
}

test("record argv, envelope, capability helper, and timeout follow the writer contract", () => {
  assert.equal(RECORD_UPDATE_SCHEMA_VERSION, 1);
  assert.equal(RECORD_SHEET_OVERLAY_TTL_MS, 5000);
  assert.deepEqual(
    recordShowArgs("restaurant", "ninja_sushi"),
    ["records", "show", "restaurant", "ninja_sushi", "-f", "json"],
  );
  assert.deepEqual(
    recordUpdateArgs("restaurant", "ninja_sushi"),
    ["records", "update", "restaurant", "ninja_sushi", "-f", "json", "-i", "-"],
  );
  assert.deepEqual(
    recordUpdateArgs("eat", "ninja_sushi", { dryRun: true }),
    ["records", "update", "eat", "ninja_sushi", "-f", "json", "-i", "-", "-d"],
  );
  assert.equal(RECORD_UPDATE_TIMEOUT_MS, ALBUM_LIST_TIMEOUT_MS);
  assert.equal(RECORD_UPDATE_MAX_BUFFER, ALBUM_LIST_MAX_BUFFER);
  assert.equal(RECORD_UPDATE_PREVIEW_DEBOUNCE_MS, 250);
  assert.deepEqual(recordUpdateEnvelope("sha256:abc", draftOps()), {
    schema_version: 1,
    expect: "sha256:abc",
    ops: draftOps(),
  });
  assert.equal(
    recordUpdateEnvelopeText("sha256:abc", []),
    '{"schema_version":1,"expect":"sha256:abc","ops":[]}',
  );
  assert.equal(recordIsStaleUpdateCode("stale_record"), true);
  assert.equal(recordIsStaleUpdateCode("stale_schema"), false);
  assert.equal(guardedUpdateReportChanged(updateReport()), true);
  assert.equal(guardedUpdateReportChanged(updateReport({ changed: [] })), false);
  assert.equal(guardedUpdateReportChanged({ changed: true }), true);
});

test("show and update decoders keep typed refusals and reject wire errors", () => {
  const shown = recordDecodeShowReport(JSON.stringify(showReport()), "", 0);
  assert.equal(shown.ok, true);
  assert.equal(shown.report.ok, true);
  assert.equal(shown.report.record.fingerprint, "sha256:record-before");

  const missing = recordDecodeShowReport(JSON.stringify({
    schema_version: 1,
    error: { code: "record_outside_album", message: "outside eat" },
  }), "", 2);
  assert.equal(missing.ok, true);
  assert.equal(missing.report.ok, false);
  assert.equal(missing.report.error.code, "record_outside_album");

  const refused = recordDecodeUpdateReport(
    JSON.stringify(updateReport({
      ok: false,
      dry_run: false,
      changed: [],
      inverse_ops: [],
      changes: [],
      error: refusalError(),
    })),
    "",
    2,
  );
  assert.equal(refused.ok, true);
  assert.equal(refused.report.ok, false);
  assert.equal(refused.report.error.field, "status");

  const stale = recordDecodeUpdateReport(
    JSON.stringify(updateReport({
      ok: false,
      dry_run: false,
      changed: [],
      inverse_ops: [],
      changes: [],
      error: {
        code: "stale_record",
        message: "record changed on disk",
        hint: "re-read",
        field: null,
      },
      record: showReport().record,
    })),
    "",
    2,
  );
  assert.equal(stale.ok, true);
  assert.equal(stale.report.error.code, "stale_record");
  assert.equal(stale.report.record.fingerprint, "sha256:record-before");

  assert.equal(recordDecodeUpdateReport("not JSON", "boom").code, "bad-json");
  assert.equal(recordDecodeShowReport(JSON.stringify({ schema_version: 1 }), "").code, "bad-shape");
  assert.equal(
    recordDecodeUpdateReport(JSON.stringify(updateReport({ schema_version: 2 })), "").code,
    "schema-mismatch",
  );
  assert.equal(
    recordDecodeUpdateReport(JSON.stringify(updateReport({ changed: true })), "").code,
    "bad-shape",
  );
});

test("stdin carries shell-looking values byte-identical", async () => {
  const { plugin } = makeAlbumPlugin();
  plugin.albumReportState = () => ({ report: albumReport(), stale: false });
  try {
    const value = "$(rm -rf ~); echo `hi` && exit | 💚";
    const ops = [{ op: "field.set", field: "category", value }];
    const envelopeText = recordUpdateEnvelopeText("sha256:record-before", ops);
    const seen = {};
    const result = await plugin.recordSpawnUpdate("restaurant", "ninja_sushi", envelopeText, {
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
    assert.deepEqual(seen.args, ["records", "update", "restaurant", "ninja_sushi", "-f", "json", "-i", "-"]);
    assert.equal(JSON.parse(seen.stdinText).ops[0].value, value);
    assert.equal(seen.args.join(" ").includes(value), false);
  } finally {
    plugin.teardownRecordUpdate();
    plugin.teardownAlbumData();
  }
});

test("typed preview path still requires a current preview before apply", async () => {
  const deps = makeSessionDeps();
  const session = recordSession(deps);
  try {
    session.setDraft(draftOps());
    assert.equal(session.getState().status, "preview-pending");
    const denied = await session.apply();
    assert.equal(denied.code, "not-previewed");
    assert.equal(deps.calls.apply, 0);
    deps.timers.tick(RECORD_UPDATE_PREVIEW_DEBOUNCE_MS);
    await flushMicrotasks();
    assert.equal(session.getState().status, "preview-ready");
    const applied = await session.apply();
    assert.equal(applied.ok, true);
    assert.equal(applied.changed, true);
    assert.equal(deps.calls.apply, 1);
    assert.deepEqual(JSON.parse(deps.calls.lastApplyEnvelope).ops, draftOps());
    assert.deepEqual(deps.calls.saves[0], ["eat/ninja_sushi.md", "eat.md"]);
  } finally {
    session.close();
  }
});

test("direct apply skips the preview latch and still saves both panes", async () => {
  const deps = makeSessionDeps();
  const session = recordSession(deps);
  try {
    const applied = await session.applyOps(draftOps());
    assert.equal(applied.ok, true);
    assert.equal(applied.changed, true);
    assert.equal(deps.calls.preview, 0);
    assert.equal(deps.calls.apply, 1);
    assert.equal(JSON.parse(deps.calls.lastApplyEnvelope).expect, "sha256:record-before");
    assert.deepEqual(JSON.parse(deps.calls.lastApplyEnvelope).ops, draftOps());
    assert.deepEqual(deps.calls.saves[0], ["eat/ninja_sushi.md", "eat.md"]);
    assert.equal(session.getState().expect, "sha256:record-after");
    assert.equal(session.getState().undoAvailable, true);
  } finally {
    session.close();
  }
});

test("album and bank sessions refuse direct apply", async () => {
  const albumDeps = makeSessionDeps();
  const album = createAlbumUpdateSession({ stem: "eat", expect: "sha256:before" }, albumDeps);
  try {
    const denied = await album.applyOps([{ op: "choice.add", field: "status", label: "Regular", position: 0 }]);
    assert.equal(denied.code, "direct-apply-disabled");
    assert.equal(albumDeps.calls.apply, 0);
  } finally {
    album.close();
  }
  const bankDeps = makeSessionDeps();
  const bank = createBankConfigUpdateSession({ expect: "sha256:bank" }, bankDeps);
  try {
    const denied = await bank.applyOps([{ op: "category.add", key: "coffee" }]);
    assert.equal(denied.code, "direct-apply-disabled");
    assert.equal(bankDeps.calls.apply, 0);
  } finally {
    bank.close();
  }
});

test("stale apply rebases to the returned record fingerprint and keeps the draft", async () => {
  const deps = makeSessionDeps();
  const session = await previewReadySession(deps);
  try {
    deps.setApplyImpl(async () => ({
      ok: true,
      report: updateReport({
        ok: false,
        dry_run: false,
        changed: [],
        inverse_ops: [],
        changes: [],
        fingerprint_before: "sha256:elsewhere",
        fingerprint_after: "sha256:elsewhere",
        error: {
          code: "stale_record",
          message: "record changed on disk",
          hint: "retry",
          field: null,
        },
        record: { ...showReport().record, fingerprint: "sha256:elsewhere" },
      }),
      wrote: false,
      unknown: false,
    }));
    const result = await session.apply();
    assert.equal(result.ok, false);
    assert.equal(result.code, "stale_record");
    assert.equal(result.kind, "stale");
    assert.equal(session.getState().expect, "sha256:elsewhere");
    assert.deepEqual(session.getState().draftOps, draftOps());
    assert.equal(deps.calls.apply, 1);
  } finally {
    session.close();
  }
});

test("Undo replays inverse ops directly with fingerprint_after as expect", async () => {
  const deps = makeSessionDeps();
  const session = recordSession(deps);
  try {
    await session.applyOps(draftOps());
    assert.equal(session.getState().expect, "sha256:record-after");
    deps.setApplyImpl(async () => ({
      ok: true,
      report: updateReport({
        dry_run: false,
        changed: ["status"],
        fingerprint_before: "sha256:record-after",
        fingerprint_after: "sha256:record-before",
        inverse_ops: draftOps(),
        properties: [{
          key: "status",
          label: "Status",
          state: "set",
          value: "to_try",
          display: "🔖 To try",
          before: "liked",
          before_display: "💚 Liked",
          source: "typed",
        }],
      }),
      wrote: true,
      unknown: false,
    }));
    const undone = await session.undo();
    assert.equal(undone.ok, true);
    assert.equal(JSON.parse(deps.calls.lastApplyEnvelope).expect, "sha256:record-after");
    assert.deepEqual(
      JSON.parse(deps.calls.lastApplyEnvelope).ops,
      [{ op: "field.set", field: "status", value: "to_try" }],
    );
  } finally {
    session.close();
  }
});

test("save-failure refuses the apply and never reaches bob", async () => {
  const deps = makeSessionDeps();
  deps.setSaveImpl(async () => ({ ok: false, code: "save-failed", message: "pane dirty" }));
  const session = recordSession(deps);
  try {
    const result = await session.applyOps(draftOps());
    assert.equal(result.ok, false);
    assert.equal(result.kind, "save");
    assert.equal(deps.calls.apply, 0);
  } finally {
    session.close();
  }
});

test("late apply responses after close are ignored", async () => {
  const deps = makeSessionDeps();
  const flight = deferred();
  deps.setApplyImpl(() => flight.promise);
  const session = recordSession(deps);
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
    assert.equal(result.ok, false);
    assert.equal(result.code, "superseded");
    assert.equal(session.getState().status, "applying");
  } finally {
    session.close();
  }
});

test("capability gating refuses preview and apply when the report lacks record_values_v1", async () => {
  const { plugin } = makeAlbumPlugin();
  plugin.albumReportState = () => ({ report: albumReport({ capabilities: [] }), stale: false });
  try {
    const preview = await plugin.apiRecordUpdatePreview(
      "restaurant",
      "ninja_sushi",
      recordUpdateEnvelopeText("sha256:x", draftOps()),
    );
    assert.equal(preview.code, "needs-bob");
    const apply = await plugin.apiRecordUpdateApply(
      "restaurant",
      "ninja_sushi",
      recordUpdateEnvelopeText("sha256:x", draftOps()),
    );
    assert.equal(apply.code, "needs-bob");
  } finally {
    plugin.teardownRecordUpdate();
    plugin.teardownAlbumData();
  }
});

test("the writer's own echo schedules no sync and invalidates the album report", async () => {
  const albumFile = { path: "eat.md", extension: "md" };
  const recordFile = { path: "eat/ninja_sushi.md", extension: "md" };
  const albumFrontmatter = {
    type: "[[album]]",
    parent: "[[body]]",
    summary: "Places to eat.",
    record: { noun: "restaurant" },
  };
  const recordFrontmatter = {
    type: "[[record]]",
    parent: "[[eat]]",
    title: "Ninja Sushi",
    status: "to_try",
  };
  const { plugin, ready, metadataChanged } = makeAlbumPlugin([
    { path: albumFile.path, frontmatter: albumFrontmatter },
    { path: recordFile.path, frontmatter: recordFrontmatter },
    { path: "body.md", frontmatter: { type: "[[area]]" } },
  ]);
  let syncCalls = 0;
  let listCalls = 0;
  const reasons = [];
  const originalInvalidate = plugin.apiAlbumInvalidate.bind(plugin);
  plugin.apiAlbumInvalidate = (reason) => {
    reasons.push(String(reason || ""));
    return originalInvalidate(reason);
  };
  const updateFlight = deferred();
  plugin.recordSpawnUpdate = () => updateFlight.promise;
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
    assert.equal(plugin.apiRecordUpdateCapable(), true);
    const apply = plugin.apiRecordUpdateApply(
      "restaurant",
      "ninja_sushi",
      recordUpdateEnvelopeText("sha256:record-before", draftOps()),
      { ownPaths: ["eat/ninja_sushi.md", "eat.md"] },
    );
    await flushMicrotasks();
    metadataChanged(recordFile, { ...recordFrontmatter, status: "liked" });
    metadataChanged(albumFile, { ...albumFrontmatter, summary: "Places." });
    assert.equal(plugin.albumSyncDebounceTimer, null, "own echo never schedules a sync");
    updateFlight.resolve({
      ok: true,
      report: updateReport({ dry_run: false }),
      refreshed: null,
      wrote: true,
      unknown: false,
    });
    const result = await apply;
    assert.equal(result.ok, true);
    assert.equal(result.wrote, true);
    assert.ok(reasons.includes("record-update"));
    assert.equal(syncCalls, 0);
    assert.ok(listCalls >= 1);
  } finally {
    plugin.teardownRecordSheet();
    plugin.teardownRecordUpdate();
    plugin.teardownAlbumData();
  }
});

test("overlay merge paints applied values, unsets keys, and expires in 5s or when the cache matches", () => {
  assert.deepEqual(
    recordSheetMergeFrontmatter({ status: "to_try", url: "https://x.test" }, {
      properties: { status: "liked", url: null },
      unsetKeys: ["url"],
    }),
    { status: "liked" },
  );
  const overlay = recordOverlayFromReport(updateReport({
    changed: ["status", "url"],
    properties: [
      { key: "status", state: "set", value: "liked" },
      { key: "url", state: "none", value: null },
    ],
  }));
  assert.deepEqual(overlay.changedKeys, ["status", "url"]);
  assert.equal(overlay.properties.status, "liked");
  assert.equal(overlay.properties.url, null);

  const { plugin, cache, metadataChanged, timers } = makeAlbumPlugin([
    {
      path: "eat/ninja_sushi.md",
      frontmatter: { type: "[[record]]", parent: "[[eat]]", status: "to_try" },
    },
    { path: "eat.md", frontmatter: { type: "[[album]]" } },
  ]);
  try {
    plugin.recordSheetPushOverlay("eat/ninja_sushi.md", overlay);
    assert.equal(plugin.recordSheetOverlays.get("eat/ninja_sushi.md"), overlay);
    metadataChanged(
      { path: "eat/ninja_sushi.md", extension: "md" },
      { type: "[[record]]", parent: "[[eat]]", status: "to_try" },
    );
    assert.equal(plugin.recordSheetOverlays.has("eat/ninja_sushi.md"), true, "lagging cache keeps the overlay");
    cache.set("eat/ninja_sushi.md", {
      frontmatter: { type: "[[record]]", parent: "[[eat]]", status: "liked" },
    });
    metadataChanged(
      { path: "eat/ninja_sushi.md", extension: "md" },
      { type: "[[record]]", parent: "[[eat]]", status: "liked" },
    );
    assert.equal(plugin.recordSheetOverlays.has("eat/ninja_sushi.md"), false, "matching cache drops the overlay");

    plugin.recordSheetPushOverlay("eat/ninja_sushi.md", overlay);
    timers.tick(RECORD_SHEET_OVERLAY_TTL_MS - 1);
    assert.equal(plugin.recordSheetOverlays.has("eat/ninja_sushi.md"), true);
    timers.tick(1);
    assert.equal(plugin.recordSheetOverlays.has("eat/ninja_sushi.md"), false, "overlay expires after 5s");
  } finally {
    plugin.teardownRecordSheet();
    plugin.teardownRecordUpdate();
    plugin.teardownAlbumData();
  }
});

test("successful apply pushes the overlay and remembers Undo per record path", async () => {
  const { plugin } = makeAlbumPlugin([
    {
      path: "eat/ninja_sushi.md",
      frontmatter: { type: "[[record]]", parent: "[[eat]]", status: "to_try" },
    },
    { path: "eat.md", frontmatter: { type: "[[album]]" } },
  ]);
  const deps = makeSessionDeps({
    onApplied: undefined,
  });
  const wired = LedgerToolsPlugin.helpers.recordUpdateServiceDeps(plugin, {
    type: "restaurant",
    stem: "ninja_sushi",
    recordPath: "eat/ninja_sushi.md",
    albumPath: "eat.md",
    timers: deps.timers,
    saveEditors: deps.saveEditors,
  });
  wired.spawnPreview = deps.spawnPreview;
  wired.spawnApply = deps.spawnApply;
  const session = createRecordUpdateSession({
    type: "restaurant",
    stem: "ninja_sushi",
    recordPath: "eat/ninja_sushi.md",
    albumPath: "eat.md",
    expect: "sha256:record-before",
  }, wired);
  try {
    const applied = await session.applyOps(draftOps());
    assert.equal(applied.ok, true);
    const stored = plugin.recordUpdateLastUndo("eat/ninja_sushi.md");
    assert.deepEqual(stored.inverseOps, [{ op: "field.set", field: "status", value: "to_try" }]);
    assert.equal(stored.afterFingerprint, "sha256:record-after");
    const overlay = plugin.recordSheetOverlays.get("eat/ninja_sushi.md");
    assert.equal(overlay.properties.status, "liked");
    assert.deepEqual(overlay.changedKeys, ["status"]);
  } finally {
    session.close();
    plugin.teardownRecordSheet();
    plugin.teardownRecordUpdate();
    plugin.teardownAlbumData();
  }
});
