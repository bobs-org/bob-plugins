const assert = require("node:assert/strict");
const test = require("node:test");
const { LedgerToolsPlugin, makeFreshnessApp } = require("./ledger-tools-harness.cjs");

const {
  AREAS_REPORT_SCHEMA_VERSION,
  AREAS_LIST_TIMEOUT_MS,
  AREAS_LIST_MAX_BUFFER,
  AREAS_REVALIDATE_DEBOUNCE_MS,
  areasListArgs,
  areasSyncArgs,
  areasDecodeListReport,
  areasDecodeSyncReport,
  areasIndexReport,
  areasRelevantPath,
  areasTypeNames,
} = LedgerToolsPlugin.helpers;

const rollup = { direct: 1, subtree: 2 };
function area(path, stem, overrides = {}) {
  return {
    path, stem, link: stem, title: stem, titled: false, summary: null,
    parent: "area.md", parent_raw: "[[area]]", depth: 1, top: stem,
    hue: "magenta", hue_source: "color", children: [],
    projects: rollup, today: { direct: 0, subtree: 0 }, issues: [],
    ...overrides,
  };
}

function catalog(path, kind, rows, state = "current", issues = []) {
  return { host: path.replace(/\.md$/i, ""), path, kind, state, rows, issues };
}

function listReport(overrides = {}) {
  const cash = area("cash.md", "cash", { children: ["bank.md"] });
  const bank = area("bank.md", "bank", { parent: "cash.md", depth: 2, top: "cash", hue: "blue", hue_source: "hash" });
  const orphan = area("orphan.md", "orphan", { parent: null, parent_raw: null, depth: null, top: null, issues: [{ path: "orphan.md", code: "area_parent_missing", severity: "error", line: 2, message: "missing parent" }] });
  return {
    schema_version: 1, ok: false, command: "list",
    root: { path: "area.md", stem: "area", state: "found" },
    areas: [cash, bank, orphan],
    catalogs: [
      catalog("area.md", "root", [{ path: "cash.md", link: "cash", depth: 0 }, { path: "bank.md", link: "bank", depth: 1 }], "stale", [{ path: "area.md", code: "area_catalog_stale", severity: "warning", line: null, message: "catalog missing" }]),
      catalog("cash.md", "area", [{ path: "bank.md", link: "bank", depth: 0 }]),
    ],
    findings: [{ path: "orphan.md", code: "area_parent_missing", severity: "error", line: 2, message: "missing parent" }],
    counts: { areas: 3, top_level: 1, hosts: 2, errors: 1, warnings: 1, catalogs: { current: 1, missing: 0, stale: 1, damaged: 0 } },
    ...overrides,
  };
}

class FakeTimers {
  constructor() { this.now = 0; this.next = 0; this.jobs = new Map(); this.intervals = new Map(); }
  setTimeout(callback, delay) { const id = ++this.next; this.jobs.set(id, { callback, at: this.now + delay }); return id; }
  clearTimeout(id) { this.jobs.delete(id); }
  setInterval(callback, delay) { const id = ++this.next; this.intervals.set(id, { callback, delay }); return id; }
  clearInterval(id) { this.intervals.delete(id); }
  async tick(ms) {
    const target = this.now + ms;
    while (true) {
      const due = [...this.jobs.entries()].filter(([, job]) => job.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      const [id, job] = due;
      this.jobs.delete(id);
      this.now = job.at;
      job.callback();
      await flush();
    }
    this.now = target;
  }
}

async function flush() { for (let i = 0; i < 14; i += 1) await Promise.resolve(); }

function makeAreasPlugin() {
  const app = makeFreshnessApp({ tasks: [] });
  const file = { path: "cash.md", extension: "md" };
  const cache = new Map([[file.path, { frontmatter: { type: "[[area]]" }, text: "# Cash" }]]);
  app.vault = { getMarkdownFiles: () => [file], on: () => ({}) };
  app.metadataCache = { getFileCache: (value) => cache.get(value?.path) || null, on: () => ({}) };
  app.workspace = { on: () => ({}), onLayoutReady: (callback) => { app.layoutReady = callback; } };
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.areasTimers = new FakeTimers();
  plugin.registerEvent = () => {};
  plugin.registerInterval = () => {};
  plugin.setupAreasData();
  let listCalls = 0;
  let syncCalls = 0;
  plugin.areasSpawnList = async () => { listCalls += 1; return { ok: true, report: areasIndexReport(listReport()) }; };
  plugin.areasSpawnSync = async () => {
    syncCalls += 1;
    return { ok: true, report: { schema_version: 1, ok: true, command: "sync", dry_run: false, changed: ["area.md"], changes: [{ path: "area.md" }], catalogs: listReport().catalogs, findings: [], warnings: [] } };
  };
  return { plugin, file, cache, timers: plugin.areasTimers, counts: () => ({ listCalls, syncCalls }) };
}

test("Areas list and sync use JSON argv and strict schema-1 report decoders", () => {
  assert.equal(AREAS_REPORT_SCHEMA_VERSION, 1);
  assert.equal(AREAS_LIST_TIMEOUT_MS, 20000);
  assert.equal(AREAS_LIST_MAX_BUFFER, 32 * 1024 * 1024);
  assert.equal(AREAS_REVALIDATE_DEBOUNCE_MS, 300);
  assert.deepEqual(areasListArgs(), ["areas", "list", "-f", "json"]);
  assert.deepEqual(areasSyncArgs(), ["areas", "sync", "-f", "json"]);

  const decoded = areasDecodeListReport(JSON.stringify(listReport()));
  assert.equal(decoded.ok, true);
  assert.equal(decoded.report.areasByPath.get("bank.md").hue, "blue");
  assert.equal(decoded.report.catalogsByHostPath.get("area.md").rows.length, 2);
  assert.equal(areasDecodeListReport("no json").code, "bad-json");
  assert.equal(areasDecodeListReport(JSON.stringify({ ...listReport(), schema_version: 2 })).code, "schema-mismatch");
  assert.equal(areasDecodeListReport(JSON.stringify({ ...listReport(), command: "check" })).code, "bad-shape");
  assert.equal(areasDecodeListReport(JSON.stringify({ ...listReport(), areas: [{ ...area("x.md", "x"), today: { direct: -1, subtree: 0 } }] })).code, "bad-shape");

  const sync = { schema_version: 1, ok: true, command: "sync", dry_run: false, changed: [], changes: [], catalogs: listReport().catalogs, findings: [], warnings: [] };
  assert.equal(areasDecodeSyncReport(JSON.stringify(sync)).ok, true);
  assert.equal(areasDecodeSyncReport(JSON.stringify({ ...sync, schema_version: 3 })).code, "schema-mismatch");
  assert.equal(areasDecodeSyncReport(JSON.stringify({ ...sync, dry_run: "false" })).code, "bad-shape");
});

test("relevance is limited to area, project, root, and today's note", () => {
  assert.deepEqual(areasTypeNames(["[[area]]", "project.md"]), ["area", "project"]);
  const opts = { rootPath: "special/area-root.md", dailyPath: "daily/2026-11-15.md" };
  assert.equal(areasRelevantPath("cash.md", { ...opts, frontmatter: { type: "[[area]]" } }), true);
  assert.equal(areasRelevantPath("sase.md", { ...opts, frontmatter: { type: "project" } }), true);
  assert.equal(areasRelevantPath("special/area-root.md", opts), true);
  assert.equal(areasRelevantPath("area.md", opts), true, "the bare [[area]] candidate stays relevant before a report resolves its path");
  assert.equal(areasRelevantPath("daily/2026-11-15.md", opts), true);
  assert.equal(areasRelevantPath("plain.md", opts), false);
  assert.equal(areasRelevantPath("done/old-area.md", { ...opts, frontmatter: { type: "area" } }), false);
  assert.equal(areasRelevantPath(".bob/areas.json", opts), false);
});

test("report refreshes are debounced, stale rows survive a failed refresh, and sync is explicit", async () => {
  const { plugin, file, timers, counts } = makeAreasPlugin();
  plugin.areasSeedRelevantPaths([file]);
  const unsubscribe = plugin.apiAreasSubscribe(() => {});
  const first = plugin.apiAreasReport({ wait: true });
  const initial = await first;
  assert.equal(initial.report.areasByPath.has("cash.md"), true);
  assert.deepEqual(counts(), { listCalls: 1, syncCalls: 0 });

  plugin.areasHandleMetadataChanged(file, { frontmatter: { type: "[[area]]" } });
  plugin.areasHandleMetadataChanged(file, { frontmatter: { type: "[[area]]" } });
  assert.equal(plugin.areasReportState().stale, true);
  assert.equal(timers.jobs.size, 1);
  await timers.tick(AREAS_REVALIDATE_DEBOUNCE_MS);
  await flush();
  assert.equal(counts().listCalls, 2);
  assert.equal(counts().syncCalls, 0, "vault changes never run areas sync");

  const lastGood = plugin.areasReport;
  plugin.areasSpawnList = async () => ({ ok: false, code: "bob-not-found", message: "bob missing" });
  const failed = await plugin.apiAreasReport({ force: true, wait: true });
  assert.equal(failed.report, lastGood);
  assert.equal(failed.stale, true);
  assert.equal(failed.error.code, "bob-not-found");

  const sync = await plugin.apiAreasSync();
  assert.equal(sync.ok, true);
  assert.equal(counts().syncCalls, 1);
  unsubscribe();
  plugin.teardownAreasData();
});
