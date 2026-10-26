// Resolver, child env, vault base, and small utilities.
const test = require("node:test");
const assert = require("node:assert/strict");

const { helpers } = require("./command-mode-harness.cjs");

test("resolver prefers the explicit setting and expands home", () => {
  assert.deepEqual(helpers.cmResolveBobPath("~/bin/bob", { home: "/home/b" }), {
    path: "/home/b/bin/bob",
    source: "config",
    tried: [],
  });
  assert.deepEqual(helpers.cmResolveBobPath(" /opt/bob ", { home: "/home/b" }), {
    path: "/opt/bob",
    source: "config",
    tried: [],
  });
});

test("resolver consults ledger-tools before the candidates", () => {
  const resolution = helpers.cmResolveBobPath("", {
    home: "/home/b",
    ledgerBobPath: "/ledger/bob",
    existsSync: () => { throw new Error("must not stat"); },
  });
  assert.equal(resolution.path, "/ledger/bob");
  assert.equal(resolution.source, "ledger-tools");
});

test("resolver walks candidates, records every path tried, then PATH", () => {
  const seen = [];
  const resolution = helpers.cmResolveBobPath("", {
    home: "/home/b",
    existsSync: (candidate) => {
      seen.push(candidate);
      return candidate === "/home/b/.local/bin/bob";
    },
  });
  assert.equal(resolution.path, "/home/b/.local/bin/bob");
  assert.equal(resolution.source, "candidate");
  assert.deepEqual(resolution.tried, [
    "/home/b/.cargo/bin/bob",
    "/home/b/.local/bin/bob",
  ]);
  assert.deepEqual(seen, resolution.tried);

  const onPath = helpers.cmResolveBobPath("", { home: "/home/b", existsSync: () => false });
  assert.deepEqual(onPath, {
    path: "bob",
    source: "path",
    tried: [
      "/home/b/.cargo/bin/bob",
      "/home/b/.local/bin/bob",
      "/opt/homebrew/bin/bob",
      "/usr/local/bin/bob",
    ],
  });
});

test("child env points at the vault, honors features, and drops completion vars", () => {
  const env = helpers.cmBuildChildEnv({
    env: { PATH: "/usr/bin", HOME: "/home/b", BOB_NOW: "x", BOB_DAY_FILE: "y", BOB_COMPLETE_FOO: "z", XDG_RUNTIME_DIR: "/run/user/1" },
    vaultBase: "/vault",
    features: ["clicolor-force", "progress-env", "run-receipt"],
    receiptPath: "/state/r.rc",
    pagerWidthCols: 120,
    home: "/home/b",
  });
  assert.equal(env.BOB_DIR, "/vault");
  assert.equal(env.CLICOLOR_FORCE, "1");
  assert.equal(env.BOB_PROGRESS, "1");
  assert.equal(env.BOB_RUN_RECEIPT, "/state/r.rc");
  assert.equal(env.COLUMNS, "120");
  assert.ok(env.PATH.includes("/home/b/.cargo/bin"));
  assert.ok(env.PATH.endsWith("/usr/bin"));
  assert.equal(env.BOB_NOW, undefined);
  assert.equal(env.BOB_DAY_FILE, undefined);
  assert.equal(env.BOB_COMPLETE_FOO, undefined);
  assert.equal(env.XDG_RUNTIME_DIR, "/run/user/1");
});

test("inherited NO_COLOR wins; without the color feature NO_COLOR is set", () => {
  const withNoColor = helpers.cmBuildChildEnv({
    env: { NO_COLOR: "1" },
    vaultBase: "/vault",
    features: ["clicolor-force", "progress-env"],
    home: "/home/b",
  });
  assert.equal(withNoColor.CLICOLOR_FORCE, undefined);
  assert.equal(withNoColor.NO_COLOR, "1");

  const withoutFeature = helpers.cmBuildChildEnv({
    env: {},
    vaultBase: "/vault",
    features: [],
    home: "/home/b",
  });
  assert.equal(withoutFeature.NO_COLOR, "1");
  assert.equal(withoutFeature.CLICOLOR_FORCE, undefined);
  assert.equal(withoutFeature.BOB_RUN_RECEIPT, undefined);
});

test("vault base requires a local folder", () => {
  assert.equal(helpers.cmVaultBasePath({ vault: { adapter: { getBasePath: () => "/vault" } } }), "/vault");
  assert.equal(helpers.cmVaultBasePath({ vault: { adapter: { getBasePath: () => "" } } }), null);
  assert.equal(helpers.cmVaultBasePath({}), null);
});

test("ansi stripping, quoting, durations, and run ids", () => {
  assert.equal(helpers.cmStripAnsi("\u001b[1;31mhi\u001b[0m"), "hi");
  assert.equal(helpers.cmQuoteArg("plan"), "plan");
  assert.equal(helpers.cmQuoteArg("a b"), "'a b'");
  assert.equal(helpers.cmQuoteArg("$(evil)"), "'$(evil)'");
  assert.equal(helpers.cmQuoteArg("it's"), "'it'\\''s'");
  assert.equal(helpers.cmFormatArgv(["ref", "create", "a b"]), "ref create 'a b'");
  assert.equal(helpers.cmFormatDuration(500), "0:00");
  assert.equal(helpers.cmFormatClock(42000), "0:42");
  const id = helpers.cmRunId(Date.parse("2026-10-26T10:00:00Z"), () => 0);
  assert.match(id, /^\d{8}-\d{6}-[a-z2-9]{4}$/);
});
