const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { LedgerToolsPlugin, makeFreshnessApp } = require("./ledger-tools-harness.cjs");

const {
  REF_LIBRARY_REPORT_REVALIDATE_DEBOUNCE_MS,
  REF_LIBRARY_REPORT_FRESH_MS,
  REF_LIBRARY_REPORT_OPEN_REFRESH_MS,
  REF_LIBRARY_REPORT_TIMEOUT_MS,
  REF_LIBRARY_REPORT_MAX_BUFFER,
  refLibraryReportArgs,
  refLibraryReportDecode,
} = LedgerToolsPlugin.helpers;

const FIXTURE_PATH = path.join(__dirname, "../plugins/bob-ledger-tools/scripts/fixtures/ref-library-report/list.json");
const FIXTURE_TEXT = fs.readFileSync(FIXTURE_PATH, "utf8");
const FIXTURE = JSON.parse(FIXTURE_TEXT);
const FAKE_BOB = path.join(__dirname, "fixtures/fake-bob.cjs");

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

  clearTimeout(id) { this.tasks.delete(id); }

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
      const ref = { event, callback };
      const list = handlers.get(event) || [];
      list.push(ref);
      handlers.set(event, list);
      return ref;
    },
    offref(ref) {
      const list = handlers.get(ref.event) || [];
      handlers.set(ref.event, list.filter((item) => item !== ref));
    },
    emit(event, ...args) {
      for (const ref of [...(handlers.get(event) || [])]) ref.callback(...args);
    },
    count(event) { return (handlers.get(event) || []).length; },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

async function flushMicrotasks() {
  for (let index = 0; index < 16; index += 1) await Promise.resolve();
}

function decoded(text = FIXTURE_TEXT) {
  return refLibraryReportDecode(text, "");
}

function makePlugin() {
  const app = makeFreshnessApp({ tasks: [] });
  const vault = eventSource();
  const metadata = eventSource();
  const workspace = eventSource();
  app.vault = { adapter: { basePath: "/fixture-vault" }, on: vault.on.bind(vault), offref: vault.offref.bind(vault) };
  app.metadataCache = { on: metadata.on.bind(metadata), offref: metadata.offref.bind(metadata) };
  app.workspace = { on: workspace.on.bind(workspace), offref: workspace.offref.bind(workspace) };
  const plugin = new LedgerToolsPlugin(app, {});
  const timers = new FakeTimers();
  plugin.refLibraryReportTimers = timers;
  plugin.refLibraryReportClock = () => timers.now;
  plugin.registerEvent = () => {};
  plugin.apiStatsBobPath = () => ({ path: FAKE_BOB, source: "test" });
  plugin.statsVaultBasePath = () => "/fixture-vault";
  return { plugin, app, timers, vault, metadata, workspace };
}

test("fixed full-library argv and versioned decoder cover every fixture row", () => {
  assert.deepEqual(refLibraryReportArgs(), ["ref", "list", "-A", "-R", "all", "-f", "json"]);
  assert.equal(REF_LIBRARY_REPORT_REVALIDATE_DEBOUNCE_MS, 1500);
  assert.equal(REF_LIBRARY_REPORT_FRESH_MS, 60_000);
  assert.equal(REF_LIBRARY_REPORT_OPEN_REFRESH_MS, 300_000);
  assert.equal(REF_LIBRARY_REPORT_TIMEOUT_MS, 20_000);
  assert.equal(REF_LIBRARY_REPORT_MAX_BUFFER, 32 * 1024 * 1024);

  const result = decoded();
  assert.equal(result.ok, true);
  const report = result.report;
  assert.equal(report.generated_at, FIXTURE.generated_at);
  assert.equal(report.coverage.ref_dir, "ref");
  assert.equal(report.rowsByPath.size, FIXTURE.refs.length);
  for (const fixtureRow of FIXTURE.refs) {
    const row = report.rowsByPath.get(fixtureRow.path);
    assert.ok(row, `decoded ${fixtureRow.path}`);
    assert.equal(row.path, fixtureRow.path);
    assert.equal(row.title, fixtureRow.title);
  }

  const finished = report.rowsByPath.get("ref/blogs/finished-blog.md");
  assert.equal(finished.task.path, "daily/2026-11-26.md");
  assert.equal(finished.annotation_count, 5);
  assert.equal(finished.identity.doi, "10.5555/example");
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.rowsByPath), true);
  assert.equal(Object.isFrozen(finished), true);
  assert.throws(() => report.rowsByPath.set("x", {}), /immutable/);

  const partial = report.rowsByPath.get("ref/chat/partial-report.md");
  assert.equal(partial.annotation_count, null, "missing counts stay absent, not zero");
  assert.equal(partial.blocked, null, "missing flags stay absent, not false");
  assert.equal(partial.blocked_by, null, "missing collections stay absent, not empty");
  assert.equal(partial.task, null);
  assert.equal(refLibraryReportDecode("not json", "bad output").code, "bad-json");
  assert.equal(refLibraryReportDecode("[]", "").code, "bad-shape");
  assert.equal(refLibraryReportDecode(JSON.stringify({ ...FIXTURE, schema_version: 2 }), "").code, "schema-mismatch");
  assert.equal(refLibraryReportDecode(JSON.stringify({ ...FIXTURE, refs: [{ title: "no path" }] }), "").code, "bad-shape");
});

test("the shared spawn helper invokes fake-bob with the fixed argv and standard limits", async () => {
  const { plugin } = makePlugin();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ref-library-report-"));
  const logPath = path.join(tempDir, "fake-bob.jsonl");
  const priorStdout = process.env.FAKE_BOB_STDOUT;
  const priorLog = process.env.FAKE_BOB_LOG_FILE;
  process.env.FAKE_BOB_STDOUT = JSON.stringify(FIXTURE);
  process.env.FAKE_BOB_LOG_FILE = logPath;
  try {
    const result = await plugin.refLibraryReportSpawn();
    assert.equal(result.ok, true);
    assert.equal(result.report.rowsByPath.size, FIXTURE.refs.length);
    const call = JSON.parse(fs.readFileSync(logPath, "utf8").trim());
    assert.deepEqual(call.argv, refLibraryReportArgs());
  } finally {
    if (priorStdout === undefined) delete process.env.FAKE_BOB_STDOUT;
    else process.env.FAKE_BOB_STDOUT = priorStdout;
    if (priorLog === undefined) delete process.env.FAKE_BOB_LOG_FILE;
    else process.env.FAKE_BOB_LOG_FILE = priorLog;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("subscriptions share one debounced snapshot and only mounted ref or residence changes refresh it", async () => {
  const { plugin, timers, vault, metadata, workspace } = makePlugin();
  let spawns = 0;
  plugin.refLibraryReportSpawn = async () => { spawns += 1; return decoded(); };
  assert.equal(metadata.count("changed"), 0);
  const states = [];
  const unsubscribe = plugin.apiRefLibrarySubscribe((state) => states.push(state), {
    path: "ref/blogs/finished-blog.md",
  });
  assert.equal(states.length, 1);
  assert.equal(states[0].snapshot, null);
  assert.equal(metadata.count("changed"), 1);
  assert.equal(vault.count("rename"), 1);
  assert.equal(vault.count("delete"), 1);
  assert.equal(workspace.count("file-open"), 1);
  timers.tick(REF_LIBRARY_REPORT_REVALIDATE_DEBOUNCE_MS - 1);
  await flushMicrotasks();
  assert.equal(spawns, 0);
  timers.tick(1);
  await flushMicrotasks();
  assert.equal(spawns, 1);
  assert.equal(plugin.refLibraryReportRow("./ref/blogs/finished-blog.md").title, "Agentic coding strains CI");

  metadata.emit("changed", { path: "unrelated/note.md" });
  vault.emit("rename", { path: "unrelated/new.md" }, "unrelated/old.md");
  workspace.emit("file-open", { path: "unrelated/note.md" });
  assert.equal(plugin.refLibraryReportRevalidateTimer, null, "unrelated events are ignored");

  metadata.emit("changed", { path: "daily/2026-11-26.md" });
  metadata.emit("changed", { path: "ref/blogs/finished-blog.md" });
  assert.notEqual(plugin.refLibraryReportRevalidateTimer, null, "mounted ref and residence events share one debounce");
  timers.tick(REF_LIBRARY_REPORT_REVALIDATE_DEBOUNCE_MS - 1);
  await flushMicrotasks();
  assert.equal(spawns, 1);
  timers.tick(1);
  await flushMicrotasks();
  assert.equal(spawns, 2);

  vault.emit("rename", { path: "ref/blogs/finished-blog-v2.md" }, "ref/blogs/finished-blog.md");
  assert.notEqual(plugin.refLibraryReportRevalidateTimer, null, "renaming a mounted ref refreshes the index");
  unsubscribe();
  assert.equal(plugin.refLibraryReportRevalidateTimer, null, "last unsubscribe clears pending work");
  assert.equal(metadata.count("changed"), 0, "last unsubscribe releases metadata listeners");
  assert.equal(vault.count("rename"), 0);
  assert.equal(vault.count("delete"), 0);
  assert.equal(workspace.count("file-open"), 0);
  metadata.emit("changed", { path: "ref/blogs/finished-blog.md" });
  assert.equal(plugin.refLibraryReportRevalidateTimer, null, "unmounted refs cannot trigger work");
});

test("a stale snapshot reaches a new subscriber before revalidation and survives refresh failure", async () => {
  const { plugin, timers, metadata } = makePlugin();
  let spawns = 0;
  plugin.refLibraryReportSpawn = async () => {
    spawns += 1;
    return spawns === 2 ? { ok: false, code: "timeout", message: "timed out" } : decoded();
  };
  const unsubscribe = plugin.apiRefLibrarySubscribe(() => {}, { path: "ref/blogs/finished-blog.md" });
  timers.tick(REF_LIBRARY_REPORT_REVALIDATE_DEBOUNCE_MS);
  await flushMicrotasks();
  const lastGoodRow = plugin.refLibraryReportRow("ref/blogs/finished-blog.md");
  timers.tick(REF_LIBRARY_REPORT_FRESH_MS + 1);
  const states = [];
  const unsubscribeSecond = plugin.apiRefLibrarySubscribe((state) => states.push(state), {
    path: "ref/papers/blocked-paper.md",
  });
  assert.equal(states[0].stale, true);
  assert.strictEqual(states[0].rowsByPath.get("ref/blogs/finished-blog.md"), lastGoodRow);
  assert.equal(spawns, 1, "stale delivery precedes debounced revalidation");
  timers.tick(REF_LIBRARY_REPORT_REVALIDATE_DEBOUNCE_MS);
  await flushMicrotasks();
  assert.equal(spawns, 2);
  assert.strictEqual(plugin.refLibraryReportRow("ref/blogs/finished-blog.md"), lastGoodRow);
  assert.equal(plugin.refLibraryReportState().stale, true);
  assert.equal(plugin.refLibraryReportState().error.code, "timeout");
  unsubscribeSecond();
  unsubscribe();
});

test("the in-flight report allows one trailing refresh after the quiet period", async () => {
  const { plugin, timers, metadata } = makePlugin();
  const first = deferred();
  let spawns = 0;
  plugin.refLibraryReportSpawn = () => {
    spawns += 1;
    return spawns === 1 ? first.promise : Promise.resolve(decoded());
  };
  const unsubscribe = plugin.apiRefLibrarySubscribe(() => {}, { path: "ref/blogs/finished-blog.md" });
  timers.tick(REF_LIBRARY_REPORT_REVALIDATE_DEBOUNCE_MS);
  await flushMicrotasks();
  assert.equal(spawns, 1);
  metadata.emit("changed", { path: "ref/blogs/finished-blog.md" });
  timers.tick(REF_LIBRARY_REPORT_REVALIDATE_DEBOUNCE_MS);
  assert.equal(plugin.refLibraryReportTrailingReady, true);
  first.resolve(decoded());
  await flushMicrotasks();
  assert.equal(spawns, 2, "the queued trailing run starts after the current process settles");
  await flushMicrotasks();
  unsubscribe();
});

test("opening a known ref refreshes only after five minutes and unload releases a late result", async () => {
  const { plugin, timers, workspace, metadata, vault } = makePlugin();
  let spawns = 0;
  const flight = deferred();
  plugin.refLibraryReportSpawn = () => {
    spawns += 1;
    return spawns === 1 ? Promise.resolve(decoded()) : flight.promise;
  };
  const notifications = [];
  const unsubscribe = plugin.apiRefLibrarySubscribe((state) => notifications.push(state), {
    path: "ref/blogs/finished-blog.md",
  });
  timers.tick(REF_LIBRARY_REPORT_REVALIDATE_DEBOUNCE_MS);
  await flushMicrotasks();
  workspace.emit("file-open", { path: "ref/papers/blocked-paper.md" });
  assert.equal(plugin.refLibraryReportRevalidateTimer, null, "a fresh snapshot does not refresh on open");
  timers.tick(REF_LIBRARY_REPORT_OPEN_REFRESH_MS + 1);
  workspace.emit("file-open", { path: "unrelated/note.md" });
  assert.equal(plugin.refLibraryReportRevalidateTimer, null, "unrelated opens do not refresh");
  workspace.emit("file-open", { path: "ref/papers/blocked-paper.md" });
  timers.tick(REF_LIBRARY_REPORT_REVALIDATE_DEBOUNCE_MS);
  await flushMicrotasks();
  assert.equal(spawns, 2);
  const countBeforeUnload = notifications.length;
  plugin.teardownRefLibraryReport();
  assert.equal(metadata.count("changed"), 0);
  assert.equal(vault.count("rename"), 0);
  assert.equal(workspace.count("file-open"), 0);
  flight.resolve(decoded());
  await flushMicrotasks();
  assert.equal(notifications.length, countBeforeUnload, "late work cannot repaint after unload");
  assert.equal(plugin.refLibraryReportSnapshot, null);
  unsubscribe();
});
