#!/usr/bin/env node
// Offline regression tests for the Obsidian startup smoke check.
//
// These tests never launch Obsidian. They exercise the acceptance logic in
// `scripts/obsidian-startup-smoke-lib.cjs` so the suite tests evidence
// instead of mirroring the orchestration.
"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const lib = require("./obsidian-startup-smoke-lib.cjs");

function passingObservation(overrides) {
  const base = {
    executable: "/snap/bin/obsidian",
    appVersion: "1.14.5",
    sourceSha: "0b02193",
    layoutReadyMs: 2600,
    layoutReadyTimeoutMs: lib.LAYOUT_READY_TIMEOUT_MS,
    hookInstalled: true,
    hookEarly: true,
    plugins: [
      { id: "bob-ledger-tools", loaded: true, version: "1.77.0" },
      { id: "bob-navigation-hotkeys", loaded: true, version: "2.56.4" },
    ],
    expectedPlugins: [
      { id: "bob-ledger-tools", version: "1.77.0" },
      { id: "bob-navigation-hotkeys", version: "2.56.4" },
    ],
    heapPeakBytes: 800 * 1024 * 1024,
    heapLimitBytes: lib.PEAK_HEAP_BYTES,
    heapSamples: [700 * 1024 * 1024, 800 * 1024 * 1024, 750 * 1024 * 1024],
    relation: {
      ready: true,
      nonMdKeys: 0,
      fixtureRelationIndexed: true,
      readsBeforeLayoutReady: 0,
      nonMdReads: 0,
      createReplayCount: 64,
    },
    editors: lib.EXPECTED_EDITOR_CASES.map((item) => ({
      file: item.file,
      mode: item.mode,
      opened: true,
      correctPath: true,
      correctMode: true,
      editorConnected: true,
      textMatches: true,
    })),
    runtime: { exceptions: [], rejections: [], pluginLoadErrors: [], consoleErrors: [] },
    crashes: { artifacts: [], events: [], processExits: [] },
    vaultPath: "/tmp/bob-obsidian-smoke-1/vault",
    fixturePath: "/tmp/bob-obsidian-smoke-1/vault",
    crashObservationMethod: "owned-profile scan for crash dumps plus CDP disconnect/process-exit evidence",
    deploy: null,
  };
  return { ...base, ...(overrides || {}) };
}

test("a complete passing observation passes", () => {
  const verdict = lib.evaluateSmoke(passingObservation());
  assert.equal(verdict.pass, true, `expected a pass, got: ${verdict.failures.join("; ")}`);
  assert.deepEqual(verdict.failures, []);
});

test("layout-ready timeout fails without relaxing the threshold", () => {
  const verdict = lib.evaluateSmoke(passingObservation({ layoutReadyMs: lib.LAYOUT_READY_TIMEOUT_MS + 1 }));
  assert.equal(verdict.pass, false);
  assert.ok(verdict.failures.some((failure) => failure.includes("layout-ready")), "timeout must name layout-ready");
});

test("absent instrumentation fails instead of passing on zero counters", () => {
  const verdict = lib.evaluateSmoke(
    passingObservation({ hookInstalled: false, relation: { ready: true, nonMdKeys: 0, fixtureRelationIndexed: true, readsBeforeLayoutReady: 0, nonMdReads: 0 } }),
  );
  assert.equal(verdict.pass, false);
  assert.ok(verdict.failures.some((failure) => failure.includes("instrumentation hook was not installed")));
});

test("late instrumentation fails", () => {
  const verdict = lib.evaluateSmoke(passingObservation({ hookEarly: false }));
  assert.equal(verdict.pass, false);
  assert.ok(verdict.failures.some((failure) => failure.includes("too late")));
});

test("empty-index pass is inadequate", () => {
  const verdict = lib.evaluateSmoke(
    passingObservation({ relation: { ready: true, nonMdKeys: 0, fixtureRelationIndexed: false, readsBeforeLayoutReady: 0, nonMdReads: 0 } }),
  );
  assert.equal(verdict.pass, false);
  assert.ok(verdict.failures.some((failure) => failure.includes("not indexed")));
});

test("missing plugin and wrong plugin version fail", () => {
  const missing = lib.evaluateSmoke(
    passingObservation({ plugins: [{ id: "bob-ledger-tools", loaded: true, version: "1.77.0" }] }),
  );
  assert.equal(missing.pass, false);
  assert.ok(missing.failures.some((failure) => failure.includes("bob-navigation-hotkeys")));

  const wrongVersion = lib.evaluateSmoke(
    passingObservation({
      plugins: [
        { id: "bob-ledger-tools", loaded: true, version: "1.60.0" },
        { id: "bob-navigation-hotkeys", loaded: true, version: "2.56.4" },
      ],
    }),
  );
  assert.equal(wrongVersion.pass, false);
  assert.ok(wrongVersion.failures.some((failure) => failure.includes("1.60.0")));
});

test("early and non-Markdown ledger reads fail", () => {
  const early = lib.evaluateSmoke(
    passingObservation({ relation: { ready: true, nonMdKeys: 0, fixtureRelationIndexed: true, readsBeforeLayoutReady: 3, nonMdReads: 0 } }),
  );
  assert.equal(early.pass, false);
  assert.ok(early.failures.some((failure) => failure.includes("before layout-ready")));

  const nonMd = lib.evaluateSmoke(
    passingObservation({ relation: { ready: true, nonMdKeys: 0, fixtureRelationIndexed: true, readsBeforeLayoutReady: 0, nonMdReads: 2 } }),
  );
  assert.equal(nonMd.pass, false);
  assert.ok(nonMd.failures.some((failure) => failure.includes("non-Markdown reads")));

  const nonMdKeys = lib.evaluateSmoke(
    passingObservation({ relation: { ready: true, nonMdKeys: 1, fixtureRelationIndexed: true, readsBeforeLayoutReady: 0, nonMdReads: 0 } }),
  );
  assert.equal(nonMdKeys.pass, false);
  assert.ok(nonMdKeys.failures.some((failure) => failure.includes("non-Markdown keys")));
});

test("high, missing, and empty heap samples fail", () => {
  const high = lib.evaluateSmoke(passingObservation({ heapPeakBytes: lib.PEAK_HEAP_BYTES }));
  assert.equal(high.pass, false);
  assert.ok(high.failures.some((failure) => failure.includes("heap")));

  const missing = lib.evaluateSmoke(passingObservation({ heapPeakBytes: null, heapSamples: [null] }));
  assert.equal(missing.pass, false);
  assert.ok(missing.failures.some((failure) => failure.includes("non-finite") || failure.includes("missing")));

  const empty = lib.evaluateSmoke(passingObservation({ heapSamples: [] }));
  assert.equal(empty.pass, false);
  assert.ok(empty.failures.some((failure) => failure.includes("no JS heap samples")));
});

test("each editor case is required", () => {
  for (const expected of lib.EXPECTED_EDITOR_CASES) {
    const editors = passingObservation().editors.filter(
      (item) => !(item.file === expected.file && item.mode === expected.mode),
    );
    const verdict = lib.evaluateSmoke(passingObservation({ editors }));
    assert.equal(verdict.pass, false, `missing ${expected.file} ${expected.mode} must fail`);
    assert.ok(verdict.failures.some((failure) => failure.includes(expected.file) && failure.includes(expected.mode)));
  }
  assert.equal(lib.EXPECTED_EDITOR_CASES.length, 4, "the gate covers exactly four editor cases");
});

test("wrong mode, wrong path, and disconnected editors fail", () => {
  const wrongPath = passingObservation();
  wrongPath.editors[0] = { ...wrongPath.editors[0], correctPath: false };
  assert.equal(lib.evaluateSmoke(wrongPath).pass, false);

  const wrongMode = passingObservation();
  wrongMode.editors[1] = { ...wrongMode.editors[1], correctMode: false };
  const wrongModeVerdict = lib.evaluateSmoke(wrongMode);
  assert.equal(wrongModeVerdict.pass, false);
  assert.ok(wrongModeVerdict.failures.some((failure) => failure.includes("wrong mode")));

  const disconnected = passingObservation();
  disconnected.editors[2] = { ...disconnected.editors[2], editorConnected: false };
  assert.equal(lib.evaluateSmoke(disconnected).pass, false);

  const readingLeaf = passingObservation();
  readingLeaf.editors[3] = { ...readingLeaf.editors[3], readingView: true };
  const readingVerdict = lib.evaluateSmoke(readingLeaf);
  assert.equal(readingVerdict.pass, false);
  assert.ok(readingVerdict.failures.some((failure) => failure.includes("Reading-view")));

  const stale = passingObservation();
  stale.editors[0] = { ...stale.editors[0], staleEditor: true };
  assert.equal(lib.evaluateSmoke(stale).pass, false);
});

test("swallowed mount errors, async exceptions, and crashes fail", () => {
  const swallowed = passingObservation();
  swallowed.editors[0] = { ...swallowed.editors[0], swallowedMountError: "isEmpty" };
  const swallowedVerdict = lib.evaluateSmoke(swallowed);
  assert.equal(swallowedVerdict.pass, false);
  assert.ok(swallowedVerdict.failures.some((failure) => failure.includes("swallowed")));

  const asyncException = passingObservation({ runtime: { exceptions: ["Error: boom"], rejections: [], pluginLoadErrors: [], consoleErrors: [] } });
  assert.equal(lib.evaluateSmoke(asyncException).pass, false);

  const rejection = passingObservation({ runtime: { exceptions: [], rejections: ["rejected"], pluginLoadErrors: [], consoleErrors: [] } });
  assert.equal(lib.evaluateSmoke(rejection).pass, false);

  const consoleError = passingObservation({ runtime: { exceptions: [], rejections: [], pluginLoadErrors: [], consoleErrors: ["console.error: mount failed"] } });
  assert.equal(lib.evaluateSmoke(consoleError).pass, false);

  const crash = passingObservation({ crashes: { artifacts: ["Crashpad/dump.dmp"], events: [], processExits: [] } });
  const crashVerdict = lib.evaluateSmoke(crash);
  assert.equal(crashVerdict.pass, false);
  assert.ok(crashVerdict.failures.some((failure) => failure.includes("crash artifacts")));

  const crashEvent = passingObservation({ crashes: { artifacts: [], events: ["Target.crashed"], processExits: [] } });
  assert.equal(lib.evaluateSmoke(crashEvent).pass, false);

  const missingMethod = passingObservation({ crashObservationMethod: "" });
  const missingMethodVerdict = lib.evaluateSmoke(missingMethod);
  assert.equal(missingMethodVerdict.pass, false);
  assert.ok(missingMethodVerdict.failures.some((failure) => failure.includes("crash observation method")));
});

test("deploy rows fail on malformed, missing, and drifting rows despite ok:true", () => {
  const expected = [{ id: "alpha", version: "1.0.0" }];
  assert.equal(lib.checkDeployRows(null, expected).pass, false);
  assert.equal(lib.checkDeployRows({ plugins: "nope" }, expected).pass, false);

  const missing = lib.checkDeployRows({ ok: true, plugins: [] }, expected);
  assert.equal(missing.pass, false);
  assert.ok(missing.failures.some((failure) => failure.includes("missing plugin alpha")));

  const drift = lib.checkDeployRows({ ok: true, plugins: [{ id: "alpha", version: "1.0.0", sync: "drift" }] }, expected);
  assert.equal(drift.pass, false);
  assert.ok(drift.failures.some((failure) => failure.includes("drift")));

  const wrongVersion = lib.checkDeployRows({ ok: true, plugins: [{ id: "alpha", version: "0.9.0", sync: "synced" }] }, expected);
  assert.equal(wrongVersion.pass, false);

  const malformed = lib.checkDeployRows({ ok: true, plugins: [{ id: "alpha", sync: "synced" }] }, expected);
  assert.equal(malformed.pass, false);

  const passing = lib.checkDeployRows({ ok: true, plugins: [{ id: "alpha", version: "1.0.0", sync: "synced" }] }, expected);
  assert.equal(passing.pass, true, `expected deploy pass, got: ${passing.failures.join("; ")}`);
});

test("wrong-vault renderers are rejected", () => {
  assert.equal(lib.verifyVaultPath("/tmp/fixture/vault", "/tmp/fixture/vault"), true);
  assert.equal(lib.verifyVaultPath("/tmp/other/vault", "/tmp/fixture/vault"), false);
  assert.equal(lib.verifyVaultPath(null, "/tmp/fixture/vault"), false);
  const verdict = lib.evaluateSmoke(passingObservation({ vaultPath: "/tmp/other/vault" }));
  assert.equal(verdict.pass, false);
  assert.ok(verdict.failures.some((failure) => failure.includes("vault")));
});

test("bounded RPC failures reject instead of hanging", async () => {
  await assert.rejects(
    lib.withTimeout(new Promise(() => {}), 10, "fake-rpc"),
    /fake-rpc timed out after 10 ms/,
  );
  assert.equal(await lib.withTimeout(Promise.resolve("ok"), 100, "fake-rpc"), "ok");
  await assert.rejects(lib.withTimeout(Promise.reject(new Error("disconnect")), 100, "fake-rpc"), /disconnect/);
});

test("cleanup removes only run-owned temporary paths", () => {
  const owned = path.join(path.sep, "tmp", "bob-obsidian-smoke-owned");
  const outside = path.join(path.sep, "tmp", "bob-other");
  const plan = lib.planOwnedCleanup(
    [path.join(owned, "vault"), outside, path.join(owned, "..", "bob-obsidian-smoke-owned", "profile")],
    [owned],
  );
  assert.ok(plan.removable.every((item) => item.startsWith(path.resolve(owned) + path.sep) || item === path.resolve(owned)));
  assert.ok(plan.skipped.some((item) => item === path.resolve(outside)));
  assert.ok(!plan.removable.includes(path.resolve(outside)), "unowned paths must never be removed");
});

test("CLI options have short aliases and alphabetized help", () => {
  const parsed = lib.parseArgs(["-e", "/bin/obsidian", "-r", "/tmp/report.json", "-s", "-d", "/tmp/vault"]);
  assert.equal(parsed.executable, "/bin/obsidian");
  assert.equal(parsed.report, "/tmp/report.json");
  assert.equal(parsed.selfTest, true);
  assert.equal(parsed.deployedVault, "/tmp/vault");

  const long = lib.parseArgs(["--executable", "/bin/obsidian", "--report", "/tmp/r.json", "--self-test", "--deployed-vault", "/v"]);
  assert.equal(long.executable, "/bin/obsidian");
  assert.equal(long.selfTest, true);

  assert.throws(() => lib.parseArgs(["--nope"]), /Unknown argument/);
  const lines = lib.HELP_TEXT.split("\n").filter((line) => line.startsWith("  -"));
  assert.deepEqual(lines, [...lines].sort(), "help options must be alphabetized");
  assert.ok(lib.HELP_TEXT.includes("--self-test"));
  assert.ok(lib.HELP_TEXT.toLowerCase().includes("offline"));
});

test("Markdown filter matches the lifecycle rule", () => {
  assert.equal(lib.isMarkdownPath("notes/a.md"), true);
  assert.equal(lib.isMarkdownPath("notes/a.MD"), true);
  assert.equal(lib.isMarkdownPath({ path: "notes/a.md" }), true);
  assert.equal(lib.isMarkdownPath("assets/image.png"), false);
  assert.equal(lib.isMarkdownPath("assets/doc.pdf"), false);
  assert.equal(lib.isMarkdownPath(null), false);
});
