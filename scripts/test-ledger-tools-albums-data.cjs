const assert = require("node:assert/strict");
const test = require("node:test");
const {
  LedgerToolsPlugin,
  makeFreshnessApp,
} = require("./ledger-tools-harness.cjs");

const {
  ALBUM_REPORT_SCHEMA_VERSION,
  ALBUM_LIST_TIMEOUT_MS,
  ALBUM_LIST_MAX_BUFFER,
  ALBUM_REVALIDATE_DEBOUNCE_MS,
  ALBUM_SYNC_DEBOUNCE_MS,
  albumListArgs,
  albumSyncArgs,
  albumDecodeListReport,
  albumDecodeSyncReport,
  albumTypeNames,
  albumNormalizeParent,
  albumNormalizeSummary,
  albumFrontmatterFingerprint,
  albumFingerprintNeedsSync,
  albumIsMember,
  albumRelevantPath,
  albumReportPath,
  albumLocalDate,
  albumErrorModel,
} = LedgerToolsPlugin.helpers;

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
    fields: [
      {
        key: "status",
        label: "Status",
        kind: "choices",
        required: true,
        list: false,
        choices: [
          { value: "to_try", label: "🔖 To try" },
          { value: "liked", label: "💚 Liked" },
        ],
      },
      {
        key: "location",
        label: "Location",
        kind: "text",
        required: true,
        list: false,
        choices: [],
      },
    ],
    group_field: "status",
    index_by: "location",
    index_facets: ["location"],
    records: 1,
    groups: [{ value: "to_try", label: "🔖 To try", count: 1, peek: ["One"] }],
    needs_status: 0,
    last_record: "2026-11-01",
    index: { state: "missing" },
    issues: [
      {
        code: "album_index_stale",
        severity: "warning",
        path: "eat.md",
        line: null,
        key_path: null,
        message: "the generated records index in eat.md is missing; run `bob albums sync`",
        suggestions: ["bob albums sync"],
      },
    ],
    ...overrides,
  };
}

function brokenAlbum(overrides = {}) {
  return {
    stem: "broken",
    path: "broken.md",
    title: "Broken",
    emoji: null,
    summary: "Broken.",
    noun: null,
    label: null,
    plural: null,
    parent: "body",
    parent_kind: "area",
    owner: "body",
    root: "body",
    breadcrumb: ["body", "Broken"],
    fields: [],
    group_field: null,
    index_by: null,
    index_facets: [],
    records: 1,
    groups: [],
    needs_status: 0,
    last_record: null,
    index: { state: "damaged" },
    issues: [
      {
        code: "album_index_damaged",
        severity: "error",
        path: "broken.md",
        line: null,
        key_path: null,
        message: "broken.md: album is invalid; the records index was left unchanged",
        suggestions: ["repair the album findings, then run `bob albums sync`"],
      },
      {
        code: "album_schema_invalid",
        severity: "error",
        path: "broken.md",
        line: 5,
        key_path: "record.noun",
        message: "noun is required",
        suggestions: [],
      },
    ],
    ...overrides,
  };
}

function albumReport(overrides = {}) {
  return {
    // Mirrors the real CLI: any error-severity issue makes ok false, while
    // the rows stay visible for repair.
    ok: false,
    schema_version: 1,
    albums: [brokenAlbum(), healthyAlbum()],
    catalogs: [{
      host: "body",
      path: "body.md",
      root: "body",
      state: "missing",
      albums: 2,
      issues: [{
        code: "album_catalog_stale",
        severity: "warning",
        path: "body.md",
        line: null,
        key_path: null,
        message: "the generated album catalog in body.md is missing; run `bob albums sync`",
        suggestions: [],
      }],
    }],
    counts: { albums: 2, records: 2, roots: 1, errors: 2, warnings: 2 },
    ...overrides,
  };
}

function decodedList(overrides = {}) {
  return albumDecodeListReport(JSON.stringify(albumReport(overrides)), "");
}

function syncReport(ok = true, overrides = {}) {
  return {
    schema_version: 1,
    ok,
    command: "sync",
    dry_run: false,
    changed: [],
    changes: [],
    albums: [healthyAlbum()],
    catalogs: [],
    counts: { albums: 1, records: 1, roots: 1, damaged: 0, errors: 0, warnings: 0 },
    findings: [],
    commit: null,
    sync: { pre: "skipped", post: "skipped" },
    warnings: [],
    ...overrides,
  };
}

class FakeTimers {
  constructor() {
    this.now = 0;
    this.nextId = 1;
    this.tasks = new Map();
  }

  setTimeout(callback, delay) {
    const id = this.nextId++;
    this.tasks.set(id, { id, callback, due: this.now + delay, interval: 0 });
    return id;
  }

  clearTimeout(id) {
    this.tasks.delete(id);
  }

  setInterval(callback, interval) {
    const id = this.nextId++;
    this.tasks.set(id, { id, callback, due: this.now + interval, interval });
    return id;
  }

  clearInterval(id) {
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
      if (next.interval > 0) {
        next.due += next.interval;
      } else {
        this.tasks.delete(next.id);
      }
      next.callback();
    }
    this.now = target;
  }
}

function eventSource() {
  const handlers = new Map();
  return {
    on(event, callback) {
      const list = handlers.get(event) || [];
      list.push(callback);
      handlers.set(event, list);
      return { event, callback };
    },
    emit(event, ...args) {
      for (const callback of handlers.get(event) || []) callback(...args);
    },
  };
}

function makeAlbumPlugin(initial = []) {
  const app = makeFreshnessApp({ tasks: [] });
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
    files,
    timers: plugin.albumTimers,
    ready: () => ready && ready(),
    addFile: (path, frontmatter) => {
      const file = { path, extension: "md" };
      files.push(file);
      cache.set(path, { frontmatter });
      return file;
    },
    metadataChanged: (file, frontmatter) => {
      cache.set(file.path, { frontmatter });
      metadataEvents.emit("changed", file, { frontmatter });
    },
    vaultEvent: (name, file, oldPath) => vaultEvents.emit(name, file, oldPath),
    workspaceEvent: (name, ...args) => workspaceEvents.emit(name, ...args),
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
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

test("album list and sync use fixed JSON argv and the versioned report decoders", () => {
  assert.equal(ALBUM_REPORT_SCHEMA_VERSION, 1);
  assert.deepEqual(albumListArgs(), ["albums", "list", "-f", "json"]);
  assert.deepEqual(albumSyncArgs(), ["albums", "sync", "-f", "json"]);
  assert.equal(ALBUM_LIST_TIMEOUT_MS, 20000);
  assert.equal(ALBUM_LIST_MAX_BUFFER, 32 * 1024 * 1024);
  assert.equal(ALBUM_REVALIDATE_DEBOUNCE_MS, 300);
  assert.equal(ALBUM_SYNC_DEBOUNCE_MS, 3000);

  const valid = decodedList();
  assert.equal(valid.ok, true);
  assert.equal(valid.report.ok, false, "a valid report with damage stays visible with ok:false");
  assert.equal(valid.report.albumsByPath.get("eat.md").summary, "Places to eat.");
  assert.equal(valid.report.albumsByPath.get("broken.md").index.state, "damaged");
  assert.equal(valid.report.albumsByStem.get("eat").fields[0].choices[0].label, "🔖 To try");
  assert.equal(valid.report.albumsByStem.get("broken").noun, null);
  assert.equal(valid.report.albumsByStem.get("eat").last_record, "2026-11-01");
  assert.equal(valid.report.catalogsByHostPath.get("body.md").state, "missing");

  // Info-severity issues are valid album findings, not a shape error.
  const withInfo = decodedList({
    albums: [healthyAlbum({
      issues: [...healthyAlbum().issues, {
        code: "album_child_reparent",
        severity: "info",
        path: "eat.md",
        line: 2,
        key_path: "parent",
        message: "this child lives outside eat/",
        suggestions: ["eat/"],
      }],
    })],
  });
  assert.equal(withInfo.ok, true);

  // A broken album next to a healthy one keeps both rows and their counts.
  const errors = albumReport({ ok: false });
  const errorReport = albumDecodeListReport(JSON.stringify(errors), "");
  assert.equal(errorReport.ok, true, "a valid report with findings remains usable data");
  assert.equal(errorReport.report.albums.length, 2);

  assert.equal(albumDecodeListReport("not JSON", "first stderr").code, "bad-json");
  assert.equal(albumDecodeListReport("[]", "").code, "bad-shape");
  assert.equal(
    albumDecodeListReport(JSON.stringify({ ...albumReport(), schema_version: 2 }), "").code,
    "schema-mismatch",
  );
  assert.equal(
    albumDecodeListReport(JSON.stringify({ ...albumReport(), albums: [{ stem: "broken" }] }), "").code,
    "bad-shape",
  );
  // `index` is an object with a state field, never a bare string.
  assert.equal(
    albumDecodeListReport(JSON.stringify({ ...albumReport(), albums: [{ ...healthyAlbum(), index: "missing" }] }), "").code,
    "bad-shape",
  );

  const sync = albumDecodeSyncReport(JSON.stringify(syncReport()), "");
  assert.equal(sync.ok, true);
  assert.equal(sync.report.command, "sync");
  const refused = albumDecodeSyncReport(JSON.stringify(syncReport(false, {
    error: { code: "damaged", message: "Repair the markers first." },
  })), "");
  assert.equal(refused.ok, true, "a structured refusal is a valid sync response");
  assert.equal(refused.report.ok, false);
  assert.equal(albumDecodeSyncReport("unsupported command", "").code, "bad-json");
});

test("album field and album-entry report additions stay optional", () => {
  const older = decodedList();
  assert.equal(older.ok, true);
  const eat = older.report.albumsByStem.get("eat");
  assert.equal(eat.dated_notes, undefined);
  assert.equal(eat.fields[0].choices[0].count, undefined);

  const richer = decodedList({
    albums: [healthyAlbum({
      dated_notes: true,
      legacy: ["old_status"],
      schema_fingerprint: "sha256:abc",
      fields: [{
        key: "status",
        label: "Status",
        kind: "choices",
        required: true,
        list: false,
        suggest: false,
        line: 12,
        filled: 104,
        choices: [
          { value: "to_try", label: "🔖 To try", count: 11 },
          { value: "liked", label: "💚 Liked", count: 86 },
        ],
      }],
    })],
  });
  assert.equal(richer.ok, true);
  const row = richer.report.albumsByStem.get("eat");
  assert.equal(row.dated_notes, true);
  assert.deepEqual(row.legacy, ["old_status"]);
  assert.equal(row.fields[0].filled, 104);
  assert.equal(row.fields[0].choices[0].count, 11);
});

test("catalog-only damage stays visible when no album rows exist", () => {
  const body = {
    ok: false,
    schema_version: 1,
    albums: [],
    catalogs: [{
      host: "body",
      path: "body.md",
      root: null,
      state: "damaged",
      albums: 0,
      issues: [{
        code: "album_catalog_damaged",
        severity: "error",
        path: "body.md",
        line: 9,
        key_path: null,
        message: "the generated album catalog in body.md is damaged",
        suggestions: [],
      }],
    }],
    counts: { albums: 0, records: 0, roots: 0, errors: 1, warnings: 0 },
  };
  const decoded = albumDecodeListReport(JSON.stringify(body), "");
  assert.equal(decoded.ok, true);
  assert.equal(decoded.report.catalogsByHostPath.get("body.md").state, "damaged");
  assert.equal(decoded.report.ok, false);
});

test("type encodings normalize like Bob; schema and choice order is significant", () => {
  assert.deepEqual(albumTypeNames("[[album]]"), ["album"]);
  assert.deepEqual(albumTypeNames(["[[album]]"]), ["album"]);
  assert.deepEqual(albumTypeNames([["album"]]), ["album"]);
  assert.deepEqual(albumTypeNames('["[[album]]", "[[area]]"]'), ["album", "area"]);

  const old = albumFrontmatterFingerprint({
    type: ["[[album]]"],
    parent: "[[body.md|Body]]",
    summary: "  Places   to eat.\n and more. ",
    emoji: "🍽️",
    index_by: "location",
    index_facets: ["location"],
    record: {
      noun: "restaurant",
      fields: {
        status: { required: true, values: { to_try: "To try", liked: "Liked" } },
        location: { required: true },
      },
    },
  });
  assert.equal(old.isAlbum, true);
  assert.equal(old.isOwner, false);
  assert.equal(old.parent, "body");
  assert.equal(old.summary, "Places to eat. and more.");
  const equivalent = albumFrontmatterFingerprint({
    type: "[[album]]",
    parent: "[[body]]",
    summary: "Places to eat. and more.",
    emoji: "🍽️",
    index_by: "location",
    index_facets: "location",
    record: {
      noun: "restaurant",
      fields: {
        status: { required: true, values: { to_try: "To try", liked: "Liked" } },
        location: { required: true },
      },
    },
  });
  assert.equal(albumFingerprintNeedsSync(old, equivalent, "eat.md", new Set(["eat"])), false);

  // Choice order is schema meaning, not formatting.
  const reordered = albumFrontmatterFingerprint({
    type: "[[album]]",
    parent: "[[body]]",
    summary: "Places to eat. and more.",
    emoji: "🍽️",
    index_by: "location",
    index_facets: ["location"],
    record: {
      noun: "restaurant",
      fields: {
        status: { required: true, values: { liked: "Liked", to_try: "To try" } },
        location: { required: true },
      },
    },
  });
  assert.equal(albumFingerprintNeedsSync(old, reordered, "eat.md", new Set(["eat"])), true);

  const area = albumFrontmatterFingerprint({ type: "[[area]]" });
  assert.equal(area.isOwner, true);
  assert.equal(area.isAlbum, false);
  assert.equal(albumRelevantPath("ideas.md"), true);
  assert.equal(albumRelevantPath(".obsidian/plugins/x.md"), false);
  assert.equal(albumRelevantPath(".bob/state.md"), false);
  assert.equal(albumRelevantPath("attachment.pdf"), false);
  assert.equal(albumReportPath(".\\eat\\one.md"), "eat/one.md");
  assert.match(albumLocalDate(new Date(2026, 10, 9)), /^2026-11-09$/);
  assert.match(albumErrorModel({
    code: "bob-not-found",
    message: "Spawning bob needs the desktop app.",
  }).hint, /desktop Obsidian/);
  assert.match(albumErrorModel({ code: "bad-json" }).hint, /Update bob-cli/);
});

test("album subprocess uses bobSpawnJson with vault, timeout, and bounded output", async () => {
  const { plugin } = makeAlbumPlugin();
  try {
    const seen = {};
    const result = await plugin.albumSpawnList({
      execFile: (command, args, options, callback) => {
        seen.command = command;
        seen.args = args;
        seen.options = options;
        callback(null, JSON.stringify(albumReport()), "");
      },
      resolved: { path: "/fixture/bin/bob", source: "candidate" },
      vaultPath: "/fixture-vault",
    });
    assert.equal(result.ok, true);
    assert.equal(seen.command, "/fixture/bin/bob");
    assert.deepEqual(seen.args, albumListArgs());
    assert.equal(seen.options.env.BOB_DIR, "/fixture-vault");
    assert.equal(seen.options.env.NO_COLOR, "1");
    assert.equal(seen.options.timeout, ALBUM_LIST_TIMEOUT_MS);
    assert.equal(seen.options.maxBuffer, ALBUM_LIST_MAX_BUFFER);

    const missing = await plugin.albumSpawnList({
      execFile: (command, args, options, callback) => {
        const error = new Error("spawn ENOENT");
        error.code = "ENOENT";
        callback(error, "", "");
      },
      resolved: { path: "bob", source: "path" },
    });
    assert.equal(missing.code, "bob-not-found");
  } finally {
    plugin.teardownAlbumData();
  }
});

test("one vault-scoped list flight serves simultaneous subscribers", async () => {
  const { plugin } = makeAlbumPlugin();
  const flight = deferred();
  let spawns = 0;
  plugin.albumSpawnList = () => {
    spawns += 1;
    return flight.promise;
  };
  try {
    const first = plugin.apiAlbumReport({ wait: true });
    const second = plugin.apiAlbumReport({ wait: true });
    await flushMicrotasks();
    assert.equal(spawns, 1);
    flight.resolve(decodedList());
    const [left, right] = await Promise.all([first, second]);
    assert.equal(left.report.albumsByPath.get("eat.md").noun, "restaurant");
    assert.strictEqual(right.report, left.report);
    assert.equal(left.stale, false);
  } finally {
    plugin.teardownAlbumData();
  }
});

test("a change during list fetch coalesces into one later generation", async () => {
  const { plugin, timers } = makeAlbumPlugin();
  const firstFlight = deferred();
  let spawns = 0;
  plugin.albumSubscribers.add(() => {});
  plugin.albumSpawnList = () => {
    spawns += 1;
    if (spawns === 1) return firstFlight.promise;
    return Promise.resolve(decodedList());
  };
  try {
    const first = plugin.apiAlbumReport({ wait: true });
    await flushMicrotasks();
    plugin.apiAlbumInvalidate("note-change-one");
    plugin.apiAlbumInvalidate("note-change-two");
    assert.equal(plugin.albumQueuedGeneration, 2);
    firstFlight.resolve(decodedList());
    const firstState = await first;
    assert.equal(firstState.reportGeneration, 0);
    assert.equal(firstState.stale, true, "the old response does not satisfy newer demand");
    assert.equal(spawns, 1, "debounce prevents a parallel or premature second request");
    timers.tick(ALBUM_REVALIDATE_DEBOUNCE_MS);
    const latestPromise = plugin.apiAlbumReport({ wait: true });
    await flushMicrotasks();
    assert.equal(spawns, 2);
    const latest = await latestPromise;
    assert.equal(latest.reportGeneration, 2);
    assert.equal(latest.stale, false);
  } finally {
    plugin.teardownAlbumData();
  }
});

test("failed refresh keeps last good data stale and retries only on new demand", async () => {
  const { plugin } = makeAlbumPlugin();
  let spawns = 0;
  plugin.albumSpawnList = async () => {
    spawns += 1;
    if (spawns === 1 || spawns === 3) return decodedList();
    return { ok: false, code: "timeout", message: "list timed out" };
  };
  try {
    const first = await plugin.apiAlbumReport({ wait: true });
    assert.equal(first.stale, false);
    const failed = await plugin.apiAlbumReport({ force: true, wait: true });
    assert.strictEqual(failed.report, first.report);
    assert.equal(failed.stale, true);
    assert.equal(failed.error.code, "timeout");
    assert.equal(failed.unavailable, false);
    const retried = await plugin.apiAlbumReport({ force: true, wait: true });
    assert.equal(retried.stale, false);
    assert.equal(retried.error, null);
    assert.equal(spawns, 3, "a failure does not create a retry loop");
  } finally {
    plugin.teardownAlbumData();
  }
});

test("unload clears subscriptions and prevents a late list result from repainting", async () => {
  const { plugin } = makeAlbumPlugin();
  const flight = deferred();
  let notifications = 0;
  plugin.albumSpawnList = () => flight.promise;
  const unsubscribe = plugin.apiAlbumSubscribe(() => { notifications += 1; });
  await flushMicrotasks();
  const beforeUnload = notifications;
  unsubscribe();
  plugin.teardownAlbumData();
  flight.resolve(decodedList());
  await flushMicrotasks();
  assert.equal(notifications, beforeUnload);
  assert.equal(plugin.albumReport, null);
  assert.equal(plugin.albumSubscribers.size, 0);
  assert.equal(plugin.albumRolloverTimer, null);
});

function seedAlbumVault() {
  const albumFile = { path: "eat.md", extension: "md" };
  const recordFile = { path: "eat/one.md", extension: "md" };
  const ownerFile = { path: "body.md", extension: "md" };
  const otherFile = { path: "scratch.md", extension: "md" };
  const albumFrontmatter = {
    type: "[[album]]",
    parent: "[[body]]",
    summary: "Places to eat.",
    emoji: "🍽️",
    index_by: "location",
    index_facets: ["location"],
    record: { noun: "restaurant", fields: { status: { required: true } } },
  };
  const recordFrontmatter = {
    type: "[[restaurant]]",
    parent: "[[eat]]",
    title: "One",
    status: "to_try",
    location: "home",
    created: "2026-11-01",
  };
  const ownerFrontmatter = { type: "[[area]]" };
  const otherFrontmatter = { type: "[[note]]", summary: "Scratch." };
  const harness = makeAlbumPlugin([
    { path: albumFile.path, frontmatter: albumFrontmatter },
    { path: recordFile.path, frontmatter: recordFrontmatter },
    { path: ownerFile.path, frontmatter: ownerFrontmatter },
    { path: otherFile.path, frontmatter: otherFrontmatter },
  ]);
  return {
    ...harness,
    albumFile,
    recordFile,
    ownerFile,
    otherFile,
    albumFrontmatter,
    recordFrontmatter,
    ownerFrontmatter,
    otherFrontmatter,
  };
}

test("startup seeds frontmatter silently; only structural album edits debounce sync", () => {
  const { plugin, ready, timers, albumFile, albumFrontmatter, metadataChanged } = seedAlbumVault();
  try {
    ready();
    assert.equal(plugin.albumMetadataReady, true);
    assert.ok(plugin.albumKnownStems.has("eat"), "seeding learns album stems");
    assert.equal(plugin.albumSyncDebounceTimer, null, "startup baseline never starts a sync storm");
    metadataChanged(albumFile, { ...albumFrontmatter });
    assert.equal(plugin.albumSyncDebounceTimer, null, "unchanged metadata does not sync");
    metadataChanged(albumFile, { ...albumFrontmatter, summary: "A changed scope." });
    const timer = plugin.albumSyncDebounceTimer;
    assert.notEqual(timer, null, "album summary edits schedule sync");
    metadataChanged(albumFile, { ...albumFrontmatter, summary: "A changed scope.", index_by: "status" });
    assert.notEqual(plugin.albumSyncDebounceTimer, timer, "edits reset the trailing debounce");
    timers.tick(ALBUM_SYNC_DEBOUNCE_MS - 1);
    assert.equal(plugin.albumSyncFlight, null);
    assert.notEqual(plugin.albumSyncDebounceTimer, null);
  } finally {
    plugin.teardownAlbumData();
  }
});

test("record edits sync, body edits and unrelated notes do not", async () => {
  const {
    plugin, ready, timers, albumFile, recordFile, ownerFile, otherFile,
    albumFrontmatter, recordFrontmatter, ownerFrontmatter, otherFrontmatter,
    metadataChanged, vaultEvent, cache,
  } = seedAlbumVault();
  try {
    ready();
    plugin.albumSpawnList = async () => decodedList();
    plugin.albumSubscribers.add(() => {});
    const record = { path: recordFile.path, extension: "md" };
    metadataChanged(record, { ...recordFrontmatter, status: "liked" });
    assert.notEqual(plugin.albumSyncDebounceTimer, null, "record field edits schedule sync");
    plugin.albumClearTimeout(plugin.albumSyncDebounceTimer);
    plugin.albumSyncDebounceTimer = null;

    // Body-only edits invalidate the display data without running sync.
    const before = plugin.albumVaultGeneration;
    vaultEvent("modify", { path: recordFile.path, extension: "md" });
    metadataChanged(record, { ...recordFrontmatter, status: "liked" });
    assert.ok(plugin.albumVaultGeneration > before, "body changes invalidate report data");
    assert.equal(plugin.albumSyncDebounceTimer, null, "body-only edits do not run sync");
    assert.notEqual(plugin.albumRevalidateTimer, null, "mounted data revalidates after a body edit");
    timers.tick(ALBUM_REVALIDATE_DEBOUNCE_MS);
    plugin.albumClearTimeout(plugin.albumRevalidateTimer);
    plugin.albumRevalidateTimer = null;
    await flushMicrotasks();

    // Unrelated notes never schedule sync, even on frontmatter changes.
    metadataChanged({ path: otherFile.path, extension: "md" }, { ...otherFrontmatter, summary: "New scope." });
    assert.equal(plugin.albumSyncDebounceTimer, null, "unrelated notes do not sync");

    // An unrelated note becoming an album starts syncing.
    metadataChanged({ path: otherFile.path, extension: "md" }, { type: "[[album]]", parent: "[[body]]", summary: "New." });
    assert.notEqual(plugin.albumSyncDebounceTimer, null, "a new album identity syncs");
    plugin.albumClearTimeout(plugin.albumSyncDebounceTimer);
    plugin.albumSyncDebounceTimer = null;
    void albumFile;
    void ownerFile;
    void albumFrontmatter;
    void ownerFrontmatter;
    void cache;
  } finally {
    plugin.teardownAlbumData();
  }
});

test("owner ancestry and type changes invalidate and sync; other owner edits do not", () => {
  const { plugin, ready, ownerFile, ownerFrontmatter, metadataChanged } = seedAlbumVault();
  try {
    ready();
    metadataChanged({ path: ownerFile.path, extension: "md" }, { ...ownerFrontmatter, summary: "New name." });
    assert.equal(plugin.albumSyncDebounceTimer, null, "owner summary edits do not sync");
    metadataChanged({ path: ownerFile.path, extension: "md" }, { type: "[[project]]", parent: "[[body]]" });
    assert.notEqual(plugin.albumSyncDebounceTimer, null, "owner type changes sync");
  } finally {
    plugin.teardownAlbumData();
  }
});

test("deletion and rename schedule sync across membership boundaries", () => {
  const {
    plugin, ready, recordFile, recordFrontmatter, addFile, cache, vaultEvent, metadataChanged,
  } = seedAlbumVault();
  try {
    ready();
    assert.ok(plugin.albumKnownStems.has("eat"));
    const record = { path: recordFile.path, extension: "md" };

    vaultEvent("delete", record);
    assert.notEqual(plugin.albumSyncDebounceTimer, null, "record deletes schedule sync");
    plugin.albumClearTimeout(plugin.albumSyncDebounceTimer);
    plugin.albumSyncDebounceTimer = null;

    // A record renamed out of its album folder syncs from the old identity.
    const moved = addFile("loose.md", { ...recordFrontmatter });
    vaultEvent("create", moved);
    plugin.albumClearTimeout(plugin.albumSyncDebounceTimer);
    plugin.albumSyncDebounceTimer = null;
    cache.set("eat/two.md", { frontmatter: { ...recordFrontmatter } });
    vaultEvent("rename", { path: "eat/two.md", extension: "md" }, "loose.md");
    assert.notEqual(plugin.albumSyncDebounceTimer, null, "renames across membership boundaries sync");
    plugin.albumClearTimeout(plugin.albumSyncDebounceTimer);
    plugin.albumSyncDebounceTimer = null;
    void metadataChanged;
  } finally {
    plugin.teardownAlbumData();
  }
});

test("generated index writes do not restart a sync loop", async () => {
  const {
    plugin, ready, recordFile, recordFrontmatter, metadataChanged,
  } = seedAlbumVault();
  const syncFlight = deferred();
  let syncCalls = 0;
  let listCalls = 0;
  plugin.albumSpawnSync = () => {
    syncCalls += 1;
    return syncFlight.promise;
  };
  plugin.albumSpawnList = async () => {
    listCalls += 1;
    return decodedList();
  };
  try {
    ready();
    const manual = plugin.apiAlbumSync();
    await flushMicrotasks();
    assert.equal(plugin.albumSyncBusy, true);
    // The sync's own generated `> [!records]` body write carries the same
    // frontmatter, so it must not schedule another sync.
    metadataChanged({ path: recordFile.path, extension: "md" }, { ...recordFrontmatter });
    assert.equal(plugin.albumSyncDebounceTimer, null, "self-write events do not restart a sync loop");
    syncFlight.resolve({ ok: true, report: syncReport() });
    const result = await manual;
    assert.equal(result.ok, true);
    assert.equal(syncCalls, 1);
    assert.equal(listCalls, 1, "the catalog report refreshes after sync");
    assert.equal(plugin.albumSyncBusy, false);
  } finally {
    plugin.teardownAlbumData();
  }
});

test("a real frontmatter change during sync coalesces one trailing sync", async () => {
  const {
    plugin, ready, timers, recordFile, recordFrontmatter, metadataChanged,
  } = seedAlbumVault();
  const syncFlight = deferred();
  let syncCalls = 0;
  let listCalls = 0;
  plugin.albumSpawnSync = () => {
    syncCalls += 1;
    if (syncCalls === 1) return syncFlight.promise;
    return Promise.resolve({ ok: true, report: syncReport() });
  };
  plugin.albumSpawnList = async () => {
    listCalls += 1;
    return decodedList();
  };
  try {
    ready();
    const manual = plugin.apiAlbumSync();
    await flushMicrotasks();
    metadataChanged({ path: recordFile.path, extension: "md" }, { ...recordFrontmatter, status: "liked" });
    assert.equal(plugin.albumSyncTrailing, true, "the change is remembered, not discarded");
    assert.equal(plugin.albumSyncDebounceTimer, null, "no second flight starts mid-sync");
    syncFlight.resolve({ ok: true, report: syncReport() });
    await manual;
    await flushMicrotasks();
    assert.equal(syncCalls, 1);
    assert.notEqual(plugin.albumSyncDebounceTimer, null, "a trailing sync is scheduled after the flight");
    timers.tick(ALBUM_SYNC_DEBOUNCE_MS);
    await flushMicrotasks();
    await plugin.albumSyncFlight;
    assert.equal(syncCalls, 2, "exactly one trailing sync runs");
    assert.equal(listCalls, 2, "the trailing sync revalidates the report");
  } finally {
    plugin.teardownAlbumData();
  }
});

test("partial sync failure keeps its report and still revalidates the list", async () => {
  const { plugin, ready, timers, metadataChanged, recordFile, recordFrontmatter } = seedAlbumVault();
  const syncFlight = deferred();
  let syncCalls = 0;
  let listCalls = 0;
  plugin.albumSpawnSync = () => {
    syncCalls += 1;
    if (syncCalls === 1) return syncFlight.promise;
    return Promise.resolve({ ok: true, report: syncReport() });
  };
  plugin.albumSpawnList = async () => {
    listCalls += 1;
    return decodedList();
  };
  try {
    ready();
    const manual = plugin.apiAlbumSync();
    const automatic = plugin.apiAlbumSync({ automatic: true });
    assert.strictEqual(manual, automatic);
    await flushMicrotasks();
    assert.equal(plugin.albumSyncBusy, true);
    metadataChanged({ path: recordFile.path, extension: "md" }, { ...recordFrontmatter, status: "liked" });
    assert.equal(plugin.albumFrontmatterByPath.get(recordFile.path).contentKey,
      albumFrontmatterFingerprint({ ...recordFrontmatter, status: "liked" }).contentKey);
    assert.equal(plugin.albumSyncDebounceTimer, null, "metadata is remembered while a sync runs");
    syncFlight.resolve({ ok: true, report: syncReport(false, {
      error: { code: "damaged", message: "Catalog markers are damaged." },
    }) });
    const result = await manual;
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "damaged");
    assert.equal(listCalls, 1, "a partial sync failure still revalidates list data");
    assert.equal(result.refreshed.report.albumsByPath.get("eat.md").records, 1);
    assert.equal(plugin.albumSyncError.code, "damaged");
    assert.equal(plugin.albumSyncBusy, false);
    assert.equal(syncCalls, 1);
    // The mid-sync change was not in the failed sync's snapshot, so exactly
    // one trailing sync coalesces it; a repeat of the same frontmatter after
    // that is a self-write, not a new change.
    assert.notEqual(plugin.albumSyncDebounceTimer, null, "the mid-sync change coalesces a trailing sync");
    timers.tick(ALBUM_SYNC_DEBOUNCE_MS);
    await flushMicrotasks();
    await plugin.albumSyncFlight;
    assert.equal(syncCalls, 2);
    metadataChanged({ path: recordFile.path, extension: "md" }, { ...recordFrontmatter, status: "liked" });
    assert.equal(plugin.albumSyncDebounceTimer, null, "self-write events do not restart a sync loop");
    assert.equal(syncCalls, 2);
  } finally {
    plugin.teardownAlbumData();
  }
});

test("sync waits out a pre-write list and then fetches a post-sync report", async () => {
  const { plugin } = makeAlbumPlugin();
  const beforeWrite = deferred();
  let listCalls = 0;
  plugin.albumSpawnList = () => {
    listCalls += 1;
    if (listCalls === 1) {
      return beforeWrite.promise;
    }
    return Promise.resolve(decodedList({
      catalogs: [{
        host: "body",
        path: "body.md",
        root: "body",
        state: "current",
        albums: 2,
        issues: [],
      }],
    }));
  };
  plugin.albumSpawnSync = async () => ({ ok: true, report: syncReport() });
  try {
    const preWrite = plugin.apiAlbumReport({ wait: true });
    await flushMicrotasks();
    assert.equal(listCalls, 1);
    const sync = plugin.apiAlbumSync();
    await flushMicrotasks();
    assert.equal(plugin.albumSyncBusy, false, "the sync process can settle while its report refresh waits");
    beforeWrite.resolve(decodedList({
      catalogs: [{
        host: "body",
        path: "body.md",
        root: "body",
        state: "stale",
        albums: 2,
        issues: [],
      }],
    }));
    await preWrite;
    await flushMicrotasks();
    assert.equal(listCalls, 2, "the pre-write list does not satisfy post-sync revalidation");
    const result = await sync;
    assert.equal(result.ok, true);
    assert.equal(result.refreshed.report.catalogsByHostPath.get("body.md").state, "current");
  } finally {
    plugin.teardownAlbumData();
  }
});

test("the trailing three-second sync fires once after schema and member edits", async () => {
  const {
    plugin, ready, timers, albumFile, recordFile,
    albumFrontmatter, recordFrontmatter, metadataChanged,
  } = seedAlbumVault();
  let syncCalls = 0;
  let listCalls = 0;
  plugin.albumSpawnSync = async () => {
    syncCalls += 1;
    return { ok: true, report: syncReport() };
  };
  plugin.albumSpawnList = async () => {
    listCalls += 1;
    return decodedList();
  };
  try {
    ready();
    metadataChanged({ path: albumFile.path, extension: "md" }, { ...albumFrontmatter, summary: "Updated scope." });
    metadataChanged({ path: recordFile.path, extension: "md" }, { ...recordFrontmatter, status: "liked" });
    timers.tick(ALBUM_SYNC_DEBOUNCE_MS - 1);
    await flushMicrotasks();
    assert.equal(syncCalls, 0);
    timers.tick(1);
    await flushMicrotasks();
    await plugin.albumSyncFlight;
    assert.equal(syncCalls, 1);
    assert.equal(listCalls, 1, "the catalog report refreshes after sync");
    assert.equal(plugin.albumSyncBusy, false);
  } finally {
    plugin.teardownAlbumData();
  }
});

test("a view-show demand refreshes the shared report and local-day rollover notifies", async () => {
  const { plugin, timers, workspaceEvent } = makeAlbumPlugin();
  let listCalls = 0;
  let notifications = 0;
  plugin.albumSpawnList = async () => {
    listCalls += 1;
    return decodedList();
  };
  const unsubscribe = plugin.apiAlbumSubscribe(() => { notifications += 1; });
  try {
    await flushMicrotasks();
    assert.equal(listCalls, 1);
    workspaceEvent("file-open");
    timers.tick(ALBUM_REVALIDATE_DEBOUNCE_MS);
    await flushMicrotasks();
    assert.equal(listCalls, 2);
    const beforeRollover = notifications;
    const nextDay = new Date(2027, 0, 2);
    assert.notEqual(albumLocalDate(nextDay), plugin.albumLocalDay);
    assert.equal(plugin.albumRefreshRollover(nextDay), true);
    assert.ok(notifications > beforeRollover);
    assert.equal(plugin.albumReportGeneration, plugin.albumVaultGeneration);
  } finally {
    unsubscribe();
    plugin.teardownAlbumData();
  }
});

test("headless setup does not keep the process alive with a browser rollover timer", () => {
  const plugin = new LedgerToolsPlugin(makeFreshnessApp({ tasks: [] }), {});
  plugin.setupAlbumData();
  try {
    assert.equal(plugin.albumRolloverTimer, null);
  } finally {
    plugin.teardownAlbumData();
  }
});

test("real bob fixtures decode: healthy and broken albums in one vault", async () => {
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
      assert.ok(true, "bob binary is unavailable; fixture decoding is covered by synthetic vectors above");
      return;
    }
    throw error;
  }
  if (probe.error) {
    throw new Error(`bob --version failed: ${probe.stderr}`);
  }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "album-data-fixture-"));
  const vault = path.join(temp, "vault");
  fs.mkdirSync(path.join(vault, "eat"), { recursive: true });
  fs.mkdirSync(path.join(vault, "broken"), { recursive: true });
  fs.writeFileSync(path.join(vault, "body.md"), "---\ntype: [[area]]\n---\n\n# Body\n");
  fs.writeFileSync(path.join(vault, "eat.md"), [
    "---",
    "type: [[album]]",
    'parent: "[[body]]"',
    "summary: Places to eat.",
    "emoji: 🍽️",
    "index_by: location",
    "record:",
    "  noun: restaurant",
    "  fields:",
    "    status:",
    "      required: true",
    "      values: {to_try: 🔖 To try, liked: 💚 Liked}",
    "    location: {required: true, suggest: true}",
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
  fs.writeFileSync(path.join(vault, "broken.md"), [
    "---",
    "type: [[album]]",
    'parent: "[[body]]"',
    "summary: Broken.",
    "record:",
    "  fields: {}",
    "---",
    "",
    "# Broken",
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
  const decoded = albumDecodeListReport(list.stdout, list.stderr);
  assert.equal(decoded.ok, true, `fixture list did not decode: ${decoded.code} ${decoded.message}`);
  assert.equal(decoded.report.albums.length, 2, "broken and healthy albums stay visible together");
  const healthy = decoded.report.albumsByStem.get("eat");
  assert.equal(healthy.index.state, "missing");
  assert.equal(healthy.fields[0].key, "status");
  assert.equal(healthy.groups[0].peek[0], "One");
  assert.equal(healthy.last_record, "2026-11-01");
  const broken = decoded.report.albumsByStem.get("broken");
  assert.equal(broken.index.state, "damaged");
  assert.ok(broken.issues.length > 0);
  assert.ok(decoded.report.counts.errors > 0);

  const dry = await runBob(["albums", "sync", "-d", "-f", "json"], env);
  assert.ok(!dry.error || dry.error.code === 1, `bob albums sync -d failed to run: ${dry.stderr}`);
  const dryDecoded = albumDecodeSyncReport(dry.stdout, dry.stderr);
  assert.equal(dryDecoded.ok, true, `fixture sync did not decode: ${dryDecoded.code} ${dryDecoded.message}`);
  assert.equal(dryDecoded.report.command, "sync");
  assert.ok(dryDecoded.report.changed.includes("eat.md"), "dry run names the album index write");
});
