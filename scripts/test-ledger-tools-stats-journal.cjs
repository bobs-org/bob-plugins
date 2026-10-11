const assert = require("node:assert/strict");
const test = require("node:test");
const os = require("node:os");
const {
  LedgerToolsPlugin,
  makeFreshnessApp,
  withMissingConfig,
} = require("./ledger-tools-harness.cjs");
const { statsReviewHost } = LedgerToolsPlugin.helpers;

// Copied from tests/fixtures/stats/review_answers.json `hosts`.
const HOST_VECTORS = [
  { raw: "Kellys-MBP", host: "kellys-mbp" },
  { raw: "apollo", host: "apollo" },
  { raw: "athena.tail297af1.ts.net", host: "athena" },
  { raw: "My Mac_2.local", host: "my-mac-2" },
  { raw: ".local", host: "host" },
  { raw: "", host: "host" },
];

function journalAdapter() {
  const directories = new Set();
  const files = new Map();
  const appends = [];
  return {
    appends,
    files,
    adapter: {
      async exists(path) {
        return directories.has(path) || files.has(path);
      },
      async mkdir(path) {
        directories.add(path);
      },
      async write(path, contents) {
        files.set(path, contents);
      },
      async append(path, contents) {
        assert.ok(files.has(path), "writer creates the monthly file first");
        appends.push({ path, contents });
        files.set(path, files.get(path) + contents);
      },
    },
  };
}

test("stats namespace v1 serializes versioned review answer JSONL", async () => {
  await withMissingConfig(async () => {
    const app = makeFreshnessApp({ tasks: [] });
    const journal = journalAdapter();
    app.vault.adapter = journal.adapter;
    const plugin = new LedgerToolsPlugin(app, {});
    plugin.onload();
    try {
      assert.equal(plugin.api.version, 3);
      assert.equal(plugin.api.stats.version, 2);
      assert.equal(typeof plugin.api.stats.host, "function");
      assert.equal(plugin.api.stats.host(), statsReviewHost(os.hostname()));
      const events = [
        { day: "2026-10-11", tier: "next", outcome: "keep", key: "a.md#^a" },
        { day: "2026-10-11", tier: "pre", outcome: "checklist", key: "b.md#^b" },
      ];
      const records = await Promise.all(events.map((event) => plugin.api.stats.append(event)));
      assert.equal(journal.appends.length, 2);
      assert.match(journal.appends[0].path, /^\.bob\/stats\/review\/2026-10\.[a-z0-9-]+\.jsonl$/);
      assert.equal(journal.appends[0].path, journal.appends[1].path);
      assert.equal(journal.appends[0].contents.endsWith("\n"), true);
      assert.deepEqual(
        journal.appends.map(({ contents }) => JSON.parse(contents)),
        records,
      );
      for (const record of records) {
        assert.equal(record.v, 1);
        assert.equal(record.kind, "review.answer");
        assert.equal(record.host.length > 0, true);
        assert.match(record.ts, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/);
        assert.equal(Number.isNaN(Date.parse(record.ts)), false);
        assert.equal(record.plugin, "bob-navigation-hotkeys@2.x");
      }
      assert.equal(
        journal.files.get(journal.appends[0].path).split("\n").filter(Boolean).length,
        2,
      );
    } finally {
      plugin.onunload();
    }
  });
});

test("stats journal rejects invalid calendar days and outcomes", async () => {
  await withMissingConfig(async () => {
    const app = makeFreshnessApp({ tasks: [] });
    app.vault.adapter = journalAdapter().adapter;
    const plugin = new LedgerToolsPlugin(app, {});
    plugin.onload();
    try {
      await assert.rejects(
        plugin.api.stats.append({ day: "2026-02-30", tier: "next", outcome: "keep", key: "a" }),
        /real calendar date/,
      );
      await assert.rejects(
        plugin.api.stats.append({ day: "2026-10-11", tier: "next", outcome: "move", key: "a" }),
        (error) =>
          error instanceof TypeError &&
          error.code === "invalid_review_event" &&
          /invalid tier, key, or outcome/.test(error.message),
      );
    } finally {
      plugin.onunload();
    }
  });
});

test("statsReviewHost lowercases, cuts at the first dot, and never throws", () => {
  for (const vector of HOST_VECTORS) {
    assert.equal(statsReviewHost(vector.raw), vector.host, vector.raw);
  }
});

test("stats journal plugin passthrough keeps a semver writer and falls back otherwise", async () => {
  await withMissingConfig(async () => {
    const app = makeFreshnessApp({ tasks: [] });
    const journal = journalAdapter();
    app.vault.adapter = journal.adapter;
    const plugin = new LedgerToolsPlugin(app, {});
    plugin.onload();
    try {
      const kept = await plugin.api.stats.append({
        day: "2026-10-11",
        tier: "next",
        outcome: "keep",
        key: "a.md#^a",
        plugin: "bob-navigation-hotkeys@2.19.0",
      });
      assert.equal(kept.plugin, "bob-navigation-hotkeys@2.19.0");
      const fallback = await plugin.api.stats.append({
        day: "2026-10-11",
        tier: "next",
        outcome: "keep",
        key: "a.md#^b",
        plugin: "bob-navigation-hotkeys@2.x",
      });
      assert.equal(fallback.plugin, "bob-navigation-hotkeys@2.x");
      const missing = await plugin.api.stats.append({
        day: "2026-10-11",
        tier: "next",
        outcome: "keep",
        key: "a.md#^c",
      });
      assert.equal(missing.plugin, "bob-navigation-hotkeys@2.x");
    } finally {
      plugin.onunload();
    }
  });
});
