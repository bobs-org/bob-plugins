const assert = require("node:assert/strict");
const test = require("node:test");
const {
  LedgerToolsPlugin,
  makeFreshnessApp,
} = require("./ledger-tools-harness.cjs");

const {
  NOTEBOOK_REPORT_SCHEMA_VERSION,
  NOTEBOOK_LIST_TIMEOUT_MS,
  NOTEBOOK_LIST_MAX_BUFFER,
  NOTEBOOK_REVALIDATE_DEBOUNCE_MS,
  NOTEBOOK_SYNC_DEBOUNCE_MS,
  notebookListArgs,
  notebookSyncArgs,
  notebookDecodeListReport,
  notebookDecodeSyncReport,
  notebookTypeNames,
  notebookFrontmatterFingerprint,
  notebookFingerprintNeedsSync,
  notebookRelevantPath,
  notebookLocalDate,
  notebookErrorModel,
} = LedgerToolsPlugin.helpers;

function notebookReport(overrides = {}) {
  const notebook = {
    stem: "git",
    path: "git.md",
    title: "Git",
    summary: "Commands and workflow.",
    parent: "dev_tools",
    parent_kind: "notebook",
    owner: "dev",
    root: "dev",
    breadcrumb: ["dev", "Developer tools", "Git"],
    children: [],
    notes: 2,
    sections: [{ title: "Config", notes: 1 }],
    last_note: "2026-11-08",
    issues: [],
  };
  return {
    ok: true,
    schema_version: 1,
    notebooks: [notebook],
    catalogs: [{
      host: "dev",
      path: "dev.md",
      root: "dev",
      state: "current",
      notebooks: 1,
      issues: [],
    }],
    counts: { notebooks: 1, roots: 1, errors: 0, warnings: 0 },
    ...overrides,
  };
}

function decodedList(overrides = {}) {
  return notebookDecodeListReport(JSON.stringify(notebookReport(overrides)), "");
}

function syncReport(ok = true, overrides = {}) {
  return {
    schema_version: 1,
    ok,
    command: "sync",
    dry_run: false,
    changed: [],
    changes: [],
    catalogs: [],
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

function makeNotebookPlugin(initial = []) {
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
  plugin.notebookTimers = new FakeTimers();
  plugin.registerEvent = () => {};
  plugin.registerInterval = () => {};
  plugin.setupNotebookData();
  return {
    plugin,
    app,
    cache,
    files,
    timers: plugin.notebookTimers,
    ready: () => ready && ready(),
    metadataChanged: (file, frontmatter) => metadataEvents.emit("changed", file, { frontmatter }),
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

test("notebook list and sync use fixed JSON argv and the versioned report decoders", () => {
  assert.equal(NOTEBOOK_REPORT_SCHEMA_VERSION, 1);
  assert.deepEqual(notebookListArgs(), ["notebooks", "list", "-f", "json"]);
  assert.deepEqual(notebookSyncArgs(), ["notebooks", "sync", "-f", "json"]);
  assert.equal(NOTEBOOK_LIST_TIMEOUT_MS, 20000);
  assert.equal(NOTEBOOK_LIST_MAX_BUFFER, 32 * 1024 * 1024);
  assert.equal(NOTEBOOK_REVALIDATE_DEBOUNCE_MS, 300);
  assert.equal(NOTEBOOK_SYNC_DEBOUNCE_MS, 3000);

  const valid = decodedList();
  assert.equal(valid.ok, true);
  assert.equal(valid.report.notebooksByPath.get("git.md").summary, "Commands and workflow.");
  assert.equal(valid.report.notebooksByStem.get("git").sections[0].title, "Config");
  assert.equal(valid.report.catalogsByHostPath.get("dev.md").state, "current");

  const errors = notebookReport({
    ok: false,
    notebooks: [{ ...notebookReport().notebooks[0], issues: [{ code: "bad-parent", severity: "error", line: 2, message: "Broken parent" }] }],
    counts: { notebooks: 1, roots: 0, errors: 1, warnings: 0 },
  });
  const errorReport = notebookDecodeListReport(JSON.stringify(errors), "");
  assert.equal(errorReport.ok, true, "a valid report with findings remains usable data");
  assert.equal(errorReport.report.ok, false);
  assert.equal(errorReport.report.notebooks[0].issues[0].message, "Broken parent");
  assert.equal(notebookDecodeListReport("not JSON", "first stderr").code, "bad-json");
  assert.equal(notebookDecodeListReport("[]", "").code, "bad-shape");
  assert.equal(
    notebookDecodeListReport(JSON.stringify({ ...notebookReport(), schema_version: 2 }), "").code,
    "schema-mismatch",
  );
  assert.equal(
    notebookDecodeListReport(JSON.stringify({ ...notebookReport(), notebooks: [{ stem: "broken" }] }), "").code,
    "bad-shape",
  );

  const sync = notebookDecodeSyncReport(JSON.stringify(syncReport()), "");
  assert.equal(sync.ok, true);
  assert.equal(sync.report.command, "sync");
  const refused = notebookDecodeSyncReport(JSON.stringify(syncReport(false, {
    error: { code: "damaged", message: "Repair the markers first." },
  })), "");
  assert.equal(refused.ok, true, "a structured refusal is a valid sync response");
  assert.equal(refused.report.ok, false);
  assert.equal(notebookDecodeSyncReport("unsupported command", "").code, "bad-json");
});

test("type encodings normalize like Bob and only notebook frontmatter changes sync", () => {
  assert.deepEqual(notebookTypeNames("[[notebook]]"), ["notebook"]);
  assert.deepEqual(notebookTypeNames(["[[notebook]]"]), ["notebook"]);
  assert.deepEqual(notebookTypeNames([["notebook"]]), ["notebook"]);
  assert.deepEqual(notebookTypeNames('["[[notebook]]", "[[area]]"]'), ["notebook", "area"]);
  assert.deepEqual(notebookTypeNames(["[[area]]", "[[notebook]]"]), ["area", "notebook"]);

  const old = notebookFrontmatterFingerprint({
    type: ["[[notebook]]"],
    parent: "[[dev_tools.md|Developer tools]]",
    summary: "  Git   commands\n and workflow. ",
  });
  const equivalent = notebookFrontmatterFingerprint({
    type: "[[notebook]]",
    parent: "[[dev_tools]]",
    summary: "Git commands and workflow.",
  });
  assert.equal(notebookFingerprintNeedsSync(old, equivalent), false);
  assert.equal(notebookFingerprintNeedsSync(old, notebookFrontmatterFingerprint({
    type: "[[notebook]]", parent: "[[linux]]", summary: "Git commands and workflow.",
  })), true, "parent edits sync");
  assert.equal(notebookFingerprintNeedsSync(old, notebookFrontmatterFingerprint({
    type: "[[notebook]]", parent: "[[dev_tools]]", summary: "A different scope.",
  })), true, "summary edits sync");
  assert.equal(notebookFingerprintNeedsSync(old, notebookFrontmatterFingerprint({
    type: ["[[notebook]]", "[[article]]"], parent: "[[dev_tools]]", summary: "Git commands and workflow.",
  })), true, "type edits while still a notebook sync");
  assert.equal(notebookFingerprintNeedsSync(
    notebookFrontmatterFingerprint({ type: "[[area]]" }),
    notebookFrontmatterFingerprint({ type: "[[notebook]]" }),
  ), true, "any note changing to notebook syncs");
  assert.equal(notebookFingerprintNeedsSync(
    notebookFrontmatterFingerprint({ type: "[[notebook]]" }),
    notebookFrontmatterFingerprint({ type: "[[article]]" }),
  ), true, "notebook changing to another type syncs");
  assert.equal(notebookFingerprintNeedsSync(
    notebookFrontmatterFingerprint({ type: "[[article]]" }),
    notebookFrontmatterFingerprint({ type: "[[area]]" }),
  ), false, "unrelated type changes do not sync");
  assert.equal(notebookRelevantPath("ideas.md"), true);
  assert.equal(notebookRelevantPath(".obsidian/plugins/x.md"), false);
  assert.equal(notebookRelevantPath(".bob/state.md"), false);
  assert.equal(notebookRelevantPath("attachment.pdf"), false);
  assert.match(notebookLocalDate(new Date(2026, 10, 9)), /^2026-11-09$/);
  assert.match(notebookErrorModel({
    code: "bob-not-found",
    message: "Spawning bob needs the desktop app.",
  }).hint, /desktop Obsidian/);
  assert.match(notebookErrorModel({ code: "bad-json" }).hint, /Update bob-cli/);
});

test("notebook subprocess uses bobSpawnJson with vault, timeout, and bounded output", async () => {
  const { plugin } = makeNotebookPlugin();
  try {
    const seen = {};
    const result = await plugin.notebookSpawnList({
      execFile: (command, args, options, callback) => {
        seen.command = command;
        seen.args = args;
        seen.options = options;
        callback(null, JSON.stringify(notebookReport()), "");
      },
      resolved: { path: "/fixture/bin/bob", source: "candidate" },
      vaultPath: "/fixture-vault",
    });
    assert.equal(result.ok, true);
    assert.equal(seen.command, "/fixture/bin/bob");
    assert.deepEqual(seen.args, notebookListArgs());
    assert.equal(seen.options.env.BOB_DIR, "/fixture-vault");
    assert.equal(seen.options.env.NO_COLOR, "1");
    assert.equal(seen.options.timeout, NOTEBOOK_LIST_TIMEOUT_MS);
    assert.equal(seen.options.maxBuffer, NOTEBOOK_LIST_MAX_BUFFER);

    const missing = await plugin.notebookSpawnList({
      execFile: (command, args, options, callback) => {
        const error = new Error("spawn ENOENT");
        error.code = "ENOENT";
        callback(error, "", "");
      },
      resolved: { path: "bob", source: "path" },
    });
    assert.equal(missing.code, "bob-not-found");
  } finally {
    plugin.teardownNotebookData();
  }
});

test("one vault-scoped list flight serves simultaneous subscribers", async () => {
  const { plugin } = makeNotebookPlugin();
  const flight = deferred();
  let spawns = 0;
  plugin.notebookSpawnList = () => {
    spawns += 1;
    return flight.promise;
  };
  try {
    const first = plugin.apiNotebookReport({ wait: true });
    const second = plugin.apiNotebookReport({ wait: true });
    await flushMicrotasks();
    assert.equal(spawns, 1);
    flight.resolve(decodedList());
    const [left, right] = await Promise.all([first, second]);
    assert.equal(left.report.notebooks[0].path, "git.md");
    assert.strictEqual(right.report, left.report);
    assert.equal(left.stale, false);
  } finally {
    plugin.teardownNotebookData();
  }
});

test("a change during list fetch coalesces into one later generation", async () => {
  const { plugin, timers } = makeNotebookPlugin();
  const firstFlight = deferred();
  let spawns = 0;
  plugin.notebookSubscribers.add(() => {});
  plugin.notebookSpawnList = () => {
    spawns += 1;
    if (spawns === 1) return firstFlight.promise;
    return Promise.resolve(decodedList());
  };
  try {
    const first = plugin.apiNotebookReport({ wait: true });
    await flushMicrotasks();
    plugin.apiNotebookInvalidate("note-change-one");
    plugin.apiNotebookInvalidate("note-change-two");
    assert.equal(plugin.notebookQueuedGeneration, 2);
    firstFlight.resolve(decodedList());
    const firstState = await first;
    assert.equal(firstState.reportGeneration, 0);
    assert.equal(firstState.stale, true, "the old response does not satisfy newer demand");
    assert.equal(spawns, 1, "debounce prevents a parallel or premature second request");
    timers.tick(NOTEBOOK_REVALIDATE_DEBOUNCE_MS);
    const latestPromise = plugin.apiNotebookReport({ wait: true });
    await flushMicrotasks();
    assert.equal(spawns, 2);
    const latest = await latestPromise;
    assert.equal(latest.reportGeneration, 2);
    assert.equal(latest.stale, false);
  } finally {
    plugin.teardownNotebookData();
  }
});

test("failed refresh keeps last good data stale and retries only on new demand", async () => {
  const { plugin } = makeNotebookPlugin();
  let spawns = 0;
  plugin.notebookSpawnList = async () => {
    spawns += 1;
    if (spawns === 1 || spawns === 3) return decodedList();
    return { ok: false, code: "timeout", message: "list timed out" };
  };
  try {
    const first = await plugin.apiNotebookReport({ wait: true });
    assert.equal(first.stale, false);
    const failed = await plugin.apiNotebookReport({ force: true, wait: true });
    assert.strictEqual(failed.report, first.report);
    assert.equal(failed.stale, true);
    assert.equal(failed.error.code, "timeout");
    assert.equal(failed.unavailable, false);
    const retried = await plugin.apiNotebookReport({ force: true, wait: true });
    assert.equal(retried.stale, false);
    assert.equal(retried.error, null);
    assert.equal(spawns, 3, "a failure does not create a retry loop");
  } finally {
    plugin.teardownNotebookData();
  }
});

test("unload clears subscriptions and prevents a late list result from repainting", async () => {
  const { plugin } = makeNotebookPlugin();
  const flight = deferred();
  let notifications = 0;
  plugin.notebookSpawnList = () => flight.promise;
  const unsubscribe = plugin.apiNotebookSubscribe(() => { notifications += 1; });
  await flushMicrotasks();
  const beforeUnload = notifications;
  unsubscribe();
  plugin.teardownNotebookData();
  flight.resolve(decodedList());
  await flushMicrotasks();
  assert.equal(notifications, beforeUnload);
  assert.equal(plugin.notebookReport, null);
  assert.equal(plugin.notebookSubscribers.size, 0);
  assert.equal(plugin.notebookRolloverTimer, null);
});

test("startup seeds frontmatter silently; only structural notebook edits debounce sync", async () => {
  const original = { type: "[[notebook]]", parent: "[[dev]]", summary: "Git commands." };
  const file = { path: "git.md", extension: "md" };
  const { plugin, ready, timers, metadataChanged } = makeNotebookPlugin([
    { path: file.path, frontmatter: original },
  ]);
  try {
    ready();
    assert.equal(plugin.notebookMetadataReady, true);
    assert.equal(plugin.notebookSyncDebounceTimer, null, "startup baseline never starts a sync storm");
    metadataChanged(file, { ...original });
    assert.equal(plugin.notebookSyncDebounceTimer, null, "unchanged metadata does not sync");
    metadataChanged(file, { ...original, summary: "A changed scope." });
    const timer = plugin.notebookSyncDebounceTimer;
    metadataChanged(file, { ...original, parent: "[[linux]]", summary: "A changed scope." });
    assert.notEqual(plugin.notebookSyncDebounceTimer, timer, "edits reset the trailing debounce");
    timers.tick(NOTEBOOK_SYNC_DEBOUNCE_MS - 1);
    assert.equal(plugin.notebookSyncFlight, null);
    assert.notEqual(plugin.notebookSyncDebounceTimer, null);
  } finally {
    plugin.teardownNotebookData();
  }
});

test("headless setup does not keep the process alive with a browser rollover timer", () => {
  const plugin = new LedgerToolsPlugin(makeFreshnessApp({ tasks: [] }), {});
  plugin.setupNotebookData();
  try {
    assert.equal(plugin.notebookRolloverTimer, null);
  } finally {
    plugin.teardownNotebookData();
  }
});

test("body edits invalidate display data without scheduling catalog sync", () => {
  const original = { type: "[[notebook]]", parent: "[[dev]]", summary: "Git commands." };
  const file = { path: "git.md", extension: "md" };
  const { plugin, ready, timers, metadataChanged, vaultEvent } = makeNotebookPlugin([
    { path: file.path, frontmatter: original },
  ]);
  try {
    ready();
    plugin.notebookSubscribers.add(() => {});
    const before = plugin.notebookVaultGeneration;
    vaultEvent("modify", file);
    metadataChanged(file, original);
    assert.ok(plugin.notebookVaultGeneration > before, "body changes invalidate report data");
    assert.equal(plugin.notebookSyncDebounceTimer, null, "body-only edits do not run catalog sync");
    assert.notEqual(plugin.notebookRevalidateTimer, null, "mounted data revalidates after a body edit");
    timers.tick(NOTEBOOK_REVALIDATE_DEBOUNCE_MS);
    assert.notEqual(plugin.notebookListFlight, null);
  } finally {
    plugin.teardownNotebookData();
  }
});

test("frontmatter notebook type transitions sync in both directions", () => {
  const file = { path: "note.md", extension: "md" };
  for (const [from, to] of [
    [{ type: "[[article]]" }, { type: "[[notebook]]" }],
    [{ type: "[[notebook]]" }, { type: "[[article]]" }],
  ]) {
    const { plugin, ready, metadataChanged } = makeNotebookPlugin([
      { path: file.path, frontmatter: from },
    ]);
    try {
      ready();
      metadataChanged(file, to);
      assert.notEqual(plugin.notebookSyncDebounceTimer, null);
    } finally {
      plugin.teardownNotebookData();
    }
  }
});

test("automatic and manual sync share one flight and revalidate after a partial failure", async () => {
  const file = { path: "git.md", extension: "md" };
  const original = { type: "[[notebook]]", parent: "[[dev]]", summary: "Git commands." };
  const { plugin, ready, metadataChanged } = makeNotebookPlugin([
    { path: file.path, frontmatter: original },
  ]);
  const syncFlight = deferred();
  let syncCalls = 0;
  let listCalls = 0;
  plugin.notebookSpawnSync = () => {
    syncCalls += 1;
    return syncFlight.promise;
  };
  plugin.notebookSpawnList = async () => {
    listCalls += 1;
    return decodedList();
  };
  try {
    ready();
    const manual = plugin.apiNotebookSync();
    const automatic = plugin.apiNotebookSync({ automatic: true });
    assert.strictEqual(manual, automatic);
    await flushMicrotasks();
    assert.equal(plugin.notebookSyncBusy, true);
    metadataChanged(file, { ...original, summary: "Changed during sync." });
    assert.equal(plugin.notebookFrontmatterByPath.get(file.path).summary, "Changed during sync.");
    assert.equal(plugin.notebookSyncDebounceTimer, null, "metadata is remembered while a sync runs");
    syncFlight.resolve({ ok: true, report: syncReport(false, {
      error: { code: "damaged", message: "Catalog markers are damaged." },
    }) });
    const result = await manual;
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "damaged");
    assert.equal(listCalls, 1, "a partial sync failure still revalidates list data");
    assert.equal(result.refreshed.report.notebooksByPath.get("git.md").notes, 2);
    assert.equal(plugin.notebookSyncError.code, "damaged");
    assert.equal(plugin.notebookSyncBusy, false);
    metadataChanged(file, { ...original, summary: "Changed during sync." });
    assert.equal(plugin.notebookSyncDebounceTimer, null, "self-write events do not restart a sync loop");
    assert.equal(syncCalls, 1);
  } finally {
    plugin.teardownNotebookData();
  }
});

test("sync waits out a pre-write list and then fetches a post-sync catalog report", async () => {
  const { plugin } = makeNotebookPlugin();
  const beforeWrite = deferred();
  let listCalls = 0;
  plugin.notebookSpawnList = () => {
    listCalls += 1;
    if (listCalls === 1) {
      return beforeWrite.promise;
    }
    return Promise.resolve(decodedList({
      catalogs: [{
        host: "dev",
        path: "dev.md",
        root: "dev",
        state: "current",
        notebooks: 1,
        issues: [],
      }],
    }));
  };
  plugin.notebookSpawnSync = async () => ({ ok: true, report: syncReport() });
  try {
    const preWrite = plugin.apiNotebookReport({ wait: true });
    await flushMicrotasks();
    assert.equal(listCalls, 1);
    const sync = plugin.apiNotebookSync();
    await flushMicrotasks();
    assert.equal(plugin.notebookSyncBusy, false, "the sync process can settle while its report refresh waits");
    beforeWrite.resolve(decodedList({
      catalogs: [{
        host: "dev",
        path: "dev.md",
        root: "dev",
        state: "stale",
        notebooks: 1,
        issues: [],
      }],
    }));
    await preWrite;
    await flushMicrotasks();
    assert.equal(listCalls, 2, "the pre-write list does not satisfy post-sync revalidation");
    const result = await sync;
    assert.equal(result.ok, true);
    assert.equal(result.refreshed.report.catalogsByHostPath.get("dev.md").state, "current");
  } finally {
    plugin.teardownNotebookData();
  }
});

test("the trailing three-second sync fires once after parent and summary edits", async () => {
  const file = { path: "git.md", extension: "md" };
  const original = { type: "[[notebook]]", parent: "[[dev]]", summary: "Git commands." };
  const { plugin, ready, timers, metadataChanged } = makeNotebookPlugin([
    { path: file.path, frontmatter: original },
  ]);
  let syncCalls = 0;
  let listCalls = 0;
  plugin.notebookSpawnSync = async () => {
    syncCalls += 1;
    return { ok: true, report: syncReport() };
  };
  plugin.notebookSpawnList = async () => {
    listCalls += 1;
    return decodedList();
  };
  try {
    ready();
    metadataChanged(file, { ...original, summary: "Updated scope." });
    metadataChanged(file, { ...original, summary: "Updated scope.", parent: "[[linux]]" });
    timers.tick(NOTEBOOK_SYNC_DEBOUNCE_MS - 1);
    await flushMicrotasks();
    assert.equal(syncCalls, 0);
    timers.tick(1);
    await flushMicrotasks();
    await plugin.notebookSyncFlight;
    assert.equal(syncCalls, 1);
    assert.equal(listCalls, 1, "the catalog report refreshes after sync");
    assert.equal(plugin.notebookSyncBusy, false);
  } finally {
    plugin.teardownNotebookData();
  }
});

test("a view-show demand refreshes the shared report and local-day rollover notifies", async () => {
  const { plugin, timers, workspaceEvent } = makeNotebookPlugin();
  let listCalls = 0;
  let notifications = 0;
  plugin.notebookSpawnList = async () => {
    listCalls += 1;
    return decodedList();
  };
  const unsubscribe = plugin.apiNotebookSubscribe(() => { notifications += 1; });
  try {
    await flushMicrotasks();
    assert.equal(listCalls, 1);
    workspaceEvent("file-open");
    timers.tick(NOTEBOOK_REVALIDATE_DEBOUNCE_MS);
    await flushMicrotasks();
    assert.equal(listCalls, 2);
    const beforeRollover = notifications;
    const nextDay = new Date(2027, 0, 2);
    assert.notEqual(notebookLocalDate(nextDay), plugin.notebookLocalDay);
    assert.equal(plugin.notebookRefreshRollover(nextDay), true);
    assert.ok(notifications > beforeRollover);
    assert.equal(plugin.notebookReportGeneration, plugin.notebookVaultGeneration);
  } finally {
    unsubscribe();
    plugin.teardownNotebookData();
  }
});
