// Generic outcome classification, adapter registry, api.commandMode v1,
// and the plugin lifecycle (settings, catalog refresh, Ctrl+P run commands).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  BobCommandModePlugin,
  helpers,
  TestPlugin,
  makeApp,
  makeRunner,
  takeNotices,
} = require("./command-mode-harness.cjs");

const FAKE_BOB = path.join(__dirname, "fixtures", "fake-bob.cjs");

function classify(input) {
  return helpers.cmClassifyRun(input);
}

test("classification order: stop, spawn, timeout, signal", () => {
  assert.deepEqual(classify({ stoppedByUser: true, exitCode: 0 }), { outcome: "stopped", summary: "Stopped" });
  const missing = classify({ spawnError: true, spawnNotFound: true, triedPaths: ["/a/bob"] });
  assert.equal(missing.outcome, "failed");
  assert.match(missing.summary, /bob not found.*\/a\/bob/);
  assert.match(classify({ spawnError: true, spawnNotFound: false, spawnMessage: "boom" }).summary, /boom/);
  assert.deepEqual(classify({ timedOut: true, budgetSecs: 60, exitCode: null }).summary, "Timed out after 60 s");
  assert.deepEqual(classify({ signal: "SIGKILL", exitCode: null }).summary, "Killed by signal SIGKILL");
});

test("lock phrase wins over exit codes and adapters", () => {
  helpers.cmRegisterOutcomeAdapter("ref-scan", () => ({ outcome: "completed", summary: "adapter" }));
  const attention = classify({
    exitCode: 0, stdoutText: "another Bob vault maintenance run is already active\n",
    adapterId: "ref-scan",
  });
  assert.equal(attention.outcome, "attention");
  assert.equal(attention.retry, true);
  const failed = classify({
    exitCode: 1, stderrText: "Another Bob Vault Maintenance Run Is Already Active\n",
    exitHints: [{ code: 1, outcome: "completed", meaning: "hint" }],
  });
  assert.equal(failed.outcome, "failed");
  assert.equal(failed.retry, true);
});

test("exit-code hints beat the generic rule; unknown ids are ignored", () => {
  const hinted = classify({
    exitCode: 3, stdoutText: "nothing", stderrText: "",
    exitHints: [{ code: 3, outcome: "attention", meaning: "Nothing to do" }],
    adapterId: "no-such-adapter",
  });
  assert.deepEqual(hinted, { outcome: "attention", summary: "Nothing to do" });
});

test("adapters adjust the result; failures stay honest", () => {
  helpers.cmRegisterOutcomeAdapter("test-adapter", ({ out }) => ({
    outcome: "attention", summary: "held: " + out, carry: ["--seed", "7"],
  }));
  const adjusted = classify({ exitCode: 0, stdoutText: "3 held\n", adapterId: "test-adapter" });
  assert.deepEqual(adjusted, { outcome: "attention", summary: "held: 3 held", carry: ["--seed", "7"] });

  helpers.cmRegisterOutcomeAdapter("test-throwing", () => { throw new Error("adapter boom"); });
  const fallback = classify({ exitCode: 0, stdoutText: "fine\n", adapterId: "test-throwing" });
  assert.deepEqual(fallback, { outcome: "completed", summary: "fine" });

  assert.deepEqual(classify({ exitCode: 0, stdoutText: "Started …\n\n" }), { outcome: "completed", summary: "Started …" });
  assert.deepEqual(classify({ exitCode: 0, stdoutText: "\n" }), { outcome: "completed", summary: "Done" });
  assert.deepEqual(classify({ exitCode: 1, stderrText: "error: bad input\nnoise\n" }), { outcome: "failed", summary: "error: bad input" });
  assert.deepEqual(classify({ exitCode: 1, stderrText: "plain failure\n" }), { outcome: "failed", summary: "plain failure" });
  assert.deepEqual(classify({ exitCode: 1, stdoutText: "last words\n" }), { outcome: "failed", summary: "last words" });
  assert.deepEqual(classify({ exitCode: 1, stdoutText: "\u001b[31merror: red\u001b[0m\n" }), { outcome: "failed", summary: "error: red" });
});

test("api.commandMode settles, never rejects, and fires the workspace event", async () => {
  const base = makeRunner({});
  base.runner.deps.env = { ...process.env, XDG_STATE_HOME: base.tmpState, PATH: "/usr/bin:/bin" };
  base.runner.deps.resolveBob = () => ({ path: FAKE_BOB, source: "candidate", tried: [FAKE_BOB] });
  const api = helpers.cmCreateApi(base.runner);
  assert.equal(api.version, 1);
  assert.ok(Object.isFrozen(api));

  const seen = [];
  const off = api.onRunFinished((payload) => seen.push(payload));
  assert.equal(typeof off, "function");
  assert.equal(typeof api.onRunFinished(null), "function");

  const settled = await api.run(["plan"], { title: "Plan" });
  assert.equal(settled.ok, true);
  assert.equal(settled.outcome, "completed");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].outcome, "completed");
  assert.equal(seen[0].entryId, "plan");
  assert.equal(seen[0].effect, "reads");
  assert.deepEqual(seen[0].invalidates, []);
  off();

  const catalog = api.catalog();
  assert.equal(catalog.bob_version, "0.3.1-test");
  const last = api.lastRun();
  assert.equal(last.runId, settled.runId);
  assert.equal(last.outcome, "completed");

  const broken = helpers.cmCreateApi({ run: () => Promise.reject(new Error("nope")), catalog: () => null, newestRecord: () => null, deps: {} });
  const refused = await broken.run(["x"]);
  assert.equal(refused.ok, false);

  const noOutput = await api.openOutput("missing-id");
  assert.equal(noOutput.ok, false);
});

test("plugin onload registers run-* commands and exposes the frozen api", async () => {
  takeNotices();
  const app = makeApp();
  app.vault.adapter.getBasePath = () => os.tmpdir();
  const plugin = new BobCommandModePlugin(app);
  assert.ok(plugin instanceof TestPlugin);
  const { fixtureCatalog: catalogFixture } = require("./command-mode-harness.cjs");
  const stat = fs.statSync(FAKE_BOB);
  plugin.stored = {
    settings: { bobPath: FAKE_BOB },
    catalogCache: {
      fingerprint: { path: FAKE_BOB, mtimeMs: stat.mtimeMs, size: stat.size },
      catalog: catalogFixture(),
    },
  };
  await plugin.onload();
  assert.equal(plugin.commandModeState, "ready");
  assert.equal((await plugin.commandModeRefreshCatalog("force")).state, "ready");
  assert.ok(plugin.api);
  assert.equal(plugin.api.version, 1);
  assert.equal(plugin.api.commandMode.version, 1);
  assert.ok(Object.isFrozen(plugin.api.commandMode));
  const ids = [...plugin.commands.keys()];
  assert.ok(ids.includes("run-plan"), "expected run-plan in " + ids.join(","));
  assert.ok(ids.includes("run-ready"));
  assert.ok(!ids.includes("run-ref-create"), "required-arg entries get no command");
  assert.ok(!ids.includes("open"), "the sheet phase owns open");
  const spec = plugin.commands.get("run-plan");
  assert.equal(spec.name, "Bob: Today's plan");
  assert.equal(typeof spec.callback, "function");
  assert.equal(plugin.commandModeState, "ready");
  assert.ok(plugin.api.commandMode.catalog().entries.length >= 6);
  assert.equal(plugin.settingTabs.length, 1);
  plugin.onunload();
  assert.equal(plugin.commandModeRunner, null);
});

test("plugin reports missing-bob when the binary is absent", async () => {
  const app = makeApp();
  app.vault.adapter.getBasePath = () => os.tmpdir();
  const plugin = new BobCommandModePlugin(app);
  plugin.stored = { settings: { bobPath: "/nonexistent/bob-xyz" }, catalogCache: {} };
  await plugin.onload();
  assert.equal(plugin.commandModeState, "missing-bob");
  assert.deepEqual(plugin.commandModeMissingBob.tried, []);
  plugin.onunload();
});

test("runner notifies with a plain summary after each finish", async () => {
  takeNotices();
  const base = makeRunner({});
  base.runner.deps.env = { ...process.env, XDG_STATE_HOME: base.tmpState, PATH: "/usr/bin:/bin" };
  base.runner.deps.resolveBob = () => ({ path: FAKE_BOB, source: "candidate", tried: [FAKE_BOB] });
  const plugin = new BobCommandModePlugin(makeApp());
  plugin.commandModeRunner = base.runner;
  plugin.commandModeNotify({ ok: true, outcome: "completed", reason: undefined });
  plugin.commandModeNotify({ ok: false, outcome: "failed", reason: "error: bad input" });
  const notes = takeNotices();
  assert.ok(notes.includes("error: bad input"));
});
