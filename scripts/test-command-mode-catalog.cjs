// Catalog cache: fingerprints, validation, refresh, lookup, argv assembly.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { helpers, fixtureCatalog } = require("./command-mode-harness.cjs");

const FAKE_BOB = path.join(__dirname, "fixtures", "fake-bob.cjs");

test("fingerprints compare path, mtime, and size", () => {
  const left = helpers.cmCatalogFingerprint({ mtimeMs: 10, size: 5 }, "/bin/bob");
  assert.deepEqual(left, { path: "/bin/bob", mtimeMs: 10, size: 5 });
  assert.equal(helpers.cmFingerprintsEqual(left, { ...left }), true);
  assert.equal(helpers.cmFingerprintsEqual(left, { ...left, size: 6 }), false);
  assert.equal(helpers.cmFingerprintsEqual(left, null), false);
  assert.equal(helpers.cmCatalogFingerprint(null, "/bin/bob"), null);
});

test("validation accepts the fixture and rejects malformed catalogs", () => {
  assert.equal(helpers.cmValidateCatalog(fixtureCatalog()).ok, true);
  assert.equal(helpers.cmValidateCatalog(null).ok, false);
  assert.equal(helpers.cmValidateCatalog({ ...fixtureCatalog(), schema_version: 2 }).ok, false);
  assert.equal(helpers.cmValidateCatalog({ ...fixtureCatalog(), entries: [{ id: "x" }] }).ok, false);
});

test("refresh fetches and validates through the real protocol", async () => {
  const { execFile } = require("node:child_process");
  const good = await helpers.cmRefreshCatalog(FAKE_BOB, { execFile });
  assert.equal(good.ok, true);
  assert.equal(good.catalog.bob_version, "0.3.1-test");
  assert.ok(good.catalog.entries.length >= 6);

  const missing = await helpers.cmRefreshCatalog("/nonexistent/bob-xyz", { execFile });
  assert.equal(missing.ok, false);

  const skew = await new Promise((resolve) => {
    execFile(FAKE_BOB, ["__catalog", "--protocol", "2"], (error, stdout) => {
      resolve({ error, stdout });
    });
  });
  assert.ok(skew.error);
  const doc = JSON.parse(skew.stdout);
  assert.equal(doc.code, "unsupported_protocol");
  assert.equal(helpers.cmClassifyCatalogFailure({ error: "unsupported_protocol" }), "protocol-skew");
  assert.equal(helpers.cmClassifyCatalogFailure({ error: "spawn ENOENT", binaryMissing: true }), "missing-bob");
  assert.equal(helpers.cmClassifyCatalogFailure({ error: "usage" }), "old-bob");
});

test("lookup resolves entries, aliases of entries, and excluded paths", () => {
  const catalog = fixtureCatalog();
  assert.equal(helpers.cmFindEntryForArgv(catalog, ["plan"]).id, "plan");
  assert.equal(helpers.cmFindEntryForArgv(catalog, ["ref", "create", "u"]).id, "ref-create");
  assert.equal(helpers.cmFindEntryForArgv(catalog, ["nope"]), null);
  assert.equal(helpers.cmEntryById(catalog, "ref-create").title, "Create reference");
  assert.equal(helpers.cmEntryById(catalog, "missing"), null);
  assert.equal(helpers.cmExcludedReason(catalog, ["capture", "hello"]), "Use the named capture rows");
  assert.equal(helpers.cmExcludedReason(catalog, ["plan"]), null);
});

test("argv assembly puts preview args before fixed args", () => {
  const catalog = fixtureCatalog();
  const entry = helpers.cmEntryById(catalog, "ref-create");
  assert.deepEqual(
    helpers.cmAssembleArgv({ ...entry, fixed: ["-f", "json"] }, ["u"], { preview: true }),
    ["ref", "create", "--dry-run", "-f", "json", "u"],
  );
  assert.deepEqual(helpers.cmAssembleArgv(entry, ["u"], {}), ["ref", "create", "u"]);
});

test("cmRecordArgs strips a leading bob binary and leaves queued argv", () => {
  assert.deepEqual(helpers.cmRecordArgs({ argv: ["bob", "task", "reconcile"] }), ["task", "reconcile"]);
  assert.deepEqual(
    helpers.cmRecordArgs({ argv: ["/Users/x/.cargo/bin/bob", "plan"] }),
    ["plan"],
  );
  assert.deepEqual(
    helpers.cmRecordArgs({ argv: ["/tmp/fake-bob.cjs", "plan"], bob_path: "/tmp/fake-bob.cjs" }),
    ["plan"],
  );
  assert.deepEqual(helpers.cmRecordArgs({ argv: ["vault-sync", "run"] }), ["vault-sync", "run"]);
  const named = { argv: ["/tmp/fake-bob.cjs", "plan"], bob_path: "/tmp/fake-bob.cjs" };
  assert.equal(helpers.cmPagerDisplayArgv(named), "bob plan");
});

test("cmReplayRun is the inverse of cmAssembleArgv", () => {
  const catalog = fixtureCatalog();
  const plan = helpers.cmEntryById(catalog, "plan");
  const create = helpers.cmEntryById(catalog, "ref-create");
  const withFixed = { ...create, fixed: ["-f", "json"] };
  const cases = [
    { entry: plan, record: { entry_id: "plan", preview: false, argv: ["bob", "plan"] } },
    {
      entry: create,
      record: {
        entry_id: "ref-create", preview: true,
        argv: ["/Users/x/.cargo/bin/bob", "ref", "create", "--dry-run", "https://x"],
      },
    },
    {
      entry: withFixed,
      catalog: { entries: [withFixed] },
      record: {
        entry_id: "ref-create", preview: true,
        argv: ["bob", "ref", "create", "--dry-run", "-f", "json", "https://x"],
      },
    },
  ];
  for (const item of cases) {
    const replay = helpers.cmReplayRun(item.record, item.catalog || catalog);
    assert.deepEqual(
      helpers.cmAssembleArgv(item.entry, replay.argv.slice(item.entry.path.length), { preview: replay.preview }),
      helpers.cmRecordArgs(item.record),
    );
    assert.equal(replay.entryId, item.entry.id);
    assert.equal(replay.preview, Boolean(item.record.preview));
  }
  const keepDryRun = helpers.cmReplayRun({
    entry_id: "ref-create", preview: false,
    argv: ["bob", "ref", "create", "--dry-run", "https://x"],
  }, catalog);
  assert.deepEqual(keepDryRun.argv, ["ref", "create", "--dry-run", "https://x"]);
  assert.equal(keepDryRun.preview, false);
  const unknown = helpers.cmReplayRun({
    entry_id: "missing", preview: true, argv: ["bob", "mystery"],
  }, catalog);
  assert.deepEqual(unknown, { argv: ["mystery"], preview: false, entryId: null });
});

test("palette entries need policy run and all-optional positionals", () => {
  const ids = helpers.cmCommandPaletteEntries(fixtureCatalog()).map((entry) => entry.id);
  assert.ok(ids.includes("plan"));
  assert.ok(!ids.includes("ref-create"));
  assert.ok(!ids.includes("task-archive"));
});
