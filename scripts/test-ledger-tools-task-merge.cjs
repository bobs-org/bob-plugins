// Task-merge ledger API (plan:202611/task_move_merge_split.md nav-merge):
// `api.taskMerge` preview/apply over `bobSpawnJson`, desktop-only.
const assert = require("node:assert/strict");
const test = require("node:test");
const { helpers } = require("./ledger-tools-harness.cjs");

function okReport(overrides = {}) {
  return {
    schema_version: 1,
    ok: true,
    dry_run: true,
    merges: [],
    pull_in: { choice: "none", offer_count: 0, picked_count: 0 },
    warnings: [],
    repaired_files: [],
    applied_paths: [],
    deferred_paths: [],
    error: null,
    ...overrides,
  };
}

test("taskMergeDecodeReport accepts the bob task merge schema", () => {
  const decoded = helpers.taskMergeDecodeReport(JSON.stringify(okReport()), "");
  assert.equal(decoded.ok, true);
  assert.deepEqual(decoded.report.merges, []);
});

test("taskMergeDecodeReport surfaces bob errors, versions, and shapes", () => {
  const refused = helpers.taskMergeDecodeReport(
    JSON.stringify({ ...okReport(), ok: false, error: { code: "merge_source_closed", message: "closed" } }),
    "",
  );
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "merge_source_closed");
  assert.equal(refused.message, "closed");
  assert.equal(helpers.taskMergeDecodeReport("not json", "boom").code, "unsupported");
  assert.equal(
    helpers.taskMergeDecodeReport(JSON.stringify({ ...okReport(), schema_version: 2 }), "").code,
    "bad-version",
  );
  assert.equal(
    helpers.taskMergeDecodeReport(JSON.stringify({ ...okReport(), merges: null }), "").code,
    "bad-shape",
  );
});

test("taskMergeLocatorText builds note:block-id locators", () => {
  assert.equal(
    helpers.taskMergeLocatorText({ path: "db.md", blockId: "upgrade" }),
    "db:upgrade",
  );
  assert.equal(helpers.taskMergeLocatorText({ path: "db.md", blockId: "" }), "");
  assert.equal(helpers.taskMergeLocatorText({ path: "", blockId: "upgrade" }), "");
  assert.deepEqual(
    helpers.taskMergeLocatorList([
      { path: "inbox.md", blockId: "bench" },
      { path: "inbox.md", blockId: "bench" },
      { path: "work.md", blockId: "pgdump" },
    ]),
    ["inbox:bench", "work:pgdump"],
  );
});

function makePlugin(spawn) {
  const plugin = Object.create(helpers.BobLedgerToolsTaskMergeMixin.prototype);
  return Object.assign(plugin, {
    taskMergeSpawn: spawn,
    apiStatsBobPath: () => ({ path: "bob", source: "path" }),
    statsVaultBasePath: () => "/vault",
  });
}

test("apiTaskMergePreview plans with --dry-run and dedupes sources", async () => {
  const seen = [];
  const plugin = makePlugin(async (args) => {
    seen.push(args);
    return { ok: true, report: okReport() };
  });
  const result = await plugin.apiTaskMergePreview(
    [{ path: "inbox.md", blockId: "bench" }, { path: "work.md", blockId: "pgdump" }],
    { path: "db.md", blockId: "upgrade" },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(seen[0], [
    "task", "merge", "--dry-run", "-f", "json", "-i", "db:upgrade", "inbox:bench", "work:pgdump",
  ]);
});

test("apiTaskMergePreview refuses without sources or target", async () => {
  const plugin = makePlugin(async () => ({ ok: true, report: okReport() }));
  assert.equal(
    (await plugin.apiTaskMergePreview([], { path: "db.md", blockId: "upgrade" })).code,
    "missing",
  );
  assert.equal(
    (await plugin.apiTaskMergePreview([{ path: "inbox.md", blockId: "bench" }], {})).code,
    "missing",
  );
});

test("apiTaskMergeApply passes picks and skips -p when unpicked", async () => {
  const seen = [];
  const plugin = makePlugin(async (args) => {
    seen.push(args);
    return { ok: true, report: okReport() };
  });
  const into = { path: "db.md", blockId: "upgrade" };
  const sources = [{ path: "inbox.md", blockId: "bench" }];
  await plugin.apiTaskMergeApply(sources, into, [{ key: "a" }, { key: "b" }]);
  assert.ok(seen[0].includes("-p"));
  assert.ok(seen[0].includes("a,b"));
  assert.ok(!seen[0].includes("--dry-run"));
  assert.ok(seen[0].includes("-o"));
  await plugin.apiTaskMergeApply(sources, into, null);
  assert.ok(!seen[1].includes("-p"));
  await plugin.apiTaskMergeApply(sources, into, []);
  assert.ok(!seen[2].includes("-p"));
});

test("the taskMerge api shape carries version 1 with preview and apply", () => {
  const plugin = makePlugin(async () => ({ ok: true, report: okReport() }));
  const api = plugin.taskMergeApi();
  assert.equal(api.version, 1);
  assert.equal(typeof api.preview, "function");
  assert.equal(typeof api.apply, "function");
  assert.equal(helpers.TASK_MERGE_API_VERSION, 1);
  assert.equal(helpers.TASK_MERGE_MOBILE_MESSAGE, "⤵ merging needs the desktop app");
});
