const assert = require("node:assert/strict");
const test = require("node:test");
const { LedgerToolsPlugin } = require("./ledger-tools-harness.cjs");

const { logHistoryDecodeReport, logHistoryMergeOverlay, logHistoryNormalizeQuery } = LedgerToolsPlugin.helpers;

function logPhrase(text, key = logHistoryNormalizeQuery(text), recency_rank = 0, score = 2) {
  return { text, key, uses: 4, last_used: "2026-11-19 10:00", score, recency_rank, match: null };
}

function report(phrases = [logPhrase("athena agent")]) {
  return {
    schema_version: 1,
    ok: true,
    query: null,
    half_life_days: 7,
    logs: [{ kind: "work", label: "Work Log", emoji: "🛠️", recency_precision: "minute", phrases_total: phrases.length, truncated: false, excluded: {}, phrases }],
    warnings: [],
  };
}

function makePlugin() {
  const plugin = new LedgerToolsPlugin({}, {});
  plugin.api = Object.freeze({ version: 3, logs: plugin.logHistoryApi() });
  plugin.logHistoryIsDesktop = () => true;
  plugin.logHistoryBobPath = () => ({ path: "/test/bob", source: "config" });
  return plugin;
}

test("api.logs validates the schema and catalog shape", () => {
  const good = logHistoryDecodeReport(JSON.stringify(report()), "");
  assert.equal(good.ok, true);
  assert.equal(good.report.schema_version, 1);
  assert.equal(logHistoryDecodeReport("{", "bad json").code, "bad-json");
  assert.equal(logHistoryDecodeReport(JSON.stringify({ ...report(), schema_version: 2 }), "").code, "schema-mismatch");
  assert.equal(logHistoryDecodeReport(JSON.stringify({ ...report(), logs: [{}] }), "").code, "bad-shape");
});

test("api.logs fetch is single-flight and returns a stale snapshot while it revalidates", async () => {
  const plugin = makePlugin();
  let calls = 0;
  let release;
  plugin.logHistorySpawnFetch = () => {
    calls += 1;
    return new Promise((resolve) => { release = resolve; });
  };
  const first = plugin.api.logs.fetch({ force: true });
  const concurrent = plugin.api.logs.fetch({ force: true });
  assert.equal(calls, 1);
  release({ ok: true, report: report() });
  const [loaded, shared] = await Promise.all([first, concurrent]);
  assert.equal(loaded.status, "ok");
  assert.equal(shared.status, "ok");
  assert.equal(plugin.api.logs.snapshot().logs[0].phrases[0].text, "athena agent");

  let refresh;
  plugin.logHistorySpawnFetch = () => new Promise((resolve) => { refresh = resolve; });
  const stale = await plugin.api.logs.fetch();
  assert.equal(stale.status, "stale");
  assert.equal(stale.catalog.logs[0].phrases[0].key, "athena agent");
  await Promise.resolve();
  refresh({ ok: true, report: report([logPhrase("apollo research")]) });
  await plugin.logHistoryFlight;
  assert.equal(plugin.api.logs.snapshot().logs[0].phrases[0].key, "apollo research");
  plugin.teardownLogHistory();
});

test("api.logs snapshot merges a capped, idempotent session overlay without changing catalog counts", () => {
  const plugin = makePlugin();
  const catalog = report([logPhrase("athena agent", "athena agent", 0, 2.5)]);
  catalog.logs.push({ kind: "rotten", label: "Rotten Log", emoji: "🥀", recency_precision: "day", phrases_total: 0, truncated: false, excluded: {}, phrases: [] });
  plugin.logHistoryCache = { catalog, fetchedAt: 123 };
  assert.equal(plugin.api.logs.noteUsed("work", "ATHENA   agent"), true);
  assert.equal(plugin.api.logs.noteUsed("work", "A new phrase"), true);
  assert.equal(plugin.api.logs.noteUsed("unknown", "ignored"), false);
  const snapshot = plugin.api.logs.snapshot();
  const work = snapshot.logs[0];
  assert.equal(work.phrases_total, 1);
  assert.equal(work.phrases.length, 2);
  const existing = work.phrases.find((phrase) => phrase.key === "athena agent");
  const added = work.phrases.find((phrase) => phrase.key === "a new phrase");
  assert.equal(existing.score, 2.5);
  assert.equal(existing.uses, 4);
  assert.equal(added.uses, 1);
  assert.equal(added.score, 1);
  assert.equal(logHistoryMergeOverlay(plugin.logHistoryCache.catalog, plugin.logHistoryOverlay).logs[0].phrases.length, 2);
  for (let index = 0; index < 55; index += 1) plugin.api.logs.noteUsed("rotten", `keep ${index}`);
  const rotten = plugin.api.logs.snapshot().logs.find((log) => log.kind === "rotten");
  assert.equal(plugin.logHistoryOverlay.rotten.length, 50);
  assert.equal(rotten.phrases.length, 50);
  assert.equal(rotten.phrases_total, 0);
  plugin.teardownLogHistory();
});

test("api.logs reports mobile and remembers an unsupported bob path until reload", async () => {
  const plugin = makePlugin();
  plugin.logHistoryIsDesktop = () => false;
  assert.equal((await plugin.api.logs.fetch()).status, "unavailable");
  plugin.logHistoryIsDesktop = () => true;
  let calls = 0;
  plugin.logHistorySpawnFetch = async () => {
    calls += 1;
    return { ok: false, code: "bad-json", message: "bob logs returned output that is not JSON.", detail: "error: unrecognized subcommand 'logs'" };
  };
  assert.equal((await plugin.api.logs.fetch({ force: true })).status, "unsupported");
  assert.equal((await plugin.api.logs.fetch({ force: true })).status, "unsupported");
  assert.equal(calls, 1);
  plugin.teardownLogHistory();
});

