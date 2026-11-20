// api.commandMode chip contract: frozen resolve metadata and vectors,
// per-activation onState delivery, the bounded catalog wait, catalog
// invalidation, signature lookup between sequence steps, stage outcomes, and
// no duplicate execution.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  BobCommandModePlugin,
  helpers,
  makeApp,
  makeRunner,
} = require("./command-mode-harness.cjs");

const FAKE_BOB = path.join(__dirname, "fixtures", "fake-bob.cjs");
const VECTORS = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "command-mode-resolve-vectors.json"), "utf8"));

function chipCatalog() {
  return JSON.parse(JSON.stringify(VECTORS.catalog));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

async function waitFor(predicate, label, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("timed out waiting for " + label);
}

// A real runner that spawns the fake bob; FAKE_BOB_LOG_FILE counts spawns.
function chipRunner(extraEnv = {}, overrides = {}) {
  const base = makeRunner({ catalog: chipCatalog(), ...overrides });
  base.logFile = path.join(base.tmpState, "fake-bob.log");
  base.runner.deps.env = {
    ...process.env,
    XDG_STATE_HOME: base.tmpState,
    PATH: "/usr/bin:/bin",
    FAKE_BOB_LOG_FILE: base.logFile,
    ...extraEnv,
  };
  delete base.runner.deps.env.NO_COLOR;
  base.runner.deps.resolveBob = () => ({ path: FAKE_BOB, source: "candidate", tried: [FAKE_BOB] });
  base.spawned = () => {
    if (!fs.existsSync(base.logFile)) return [];
    return fs.readFileSync(base.logFile, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line).argv.join(" "));
  };
  return base;
}

function sheetStub(runner, extra = {}) {
  return {
    runner: () => runner,
    runWithWaitingLine: (title, run) => run(),
    render() {},
    refocusInput() {},
    close() {},
    enterOutput(runId) { this.outputRunId = runId; },
    runReport: helpers.CommandModeSheetModal.prototype.runReport,
    ...extra,
  };
}

test("resolve vectors pin states, reasons, failing steps, argv, and step text", () => {
  for (const vector of VECTORS.vectors) {
    const catalog = Object.hasOwn(vector, "catalog") ? vector.catalog : chipCatalog();
    const resolved = helpers.cmResolveCommandText(catalog, vector.text, {
      host: vector.host || "athena",
      catalogStatus: vector.catalogStatus,
    });
    const label = JSON.stringify(vector.text);
    assert.equal(resolved.state, vector.state, label + " state");
    assert.equal(resolved.ok, vector.state === "ready", label + " ok");
    assert.ok(Object.isFrozen(resolved) && Object.isFrozen(resolved.steps), label + " frozen");
    if (vector.state !== "ready") {
      assert.equal(resolved.reason, vector.reason, label + " reason");
      assert.equal(resolved.step, vector.step || null, label + " step");
      assert.equal(resolved.signature, null, label + " signature");
      assert.deepEqual(resolved.steps, []);
      continue;
    }
    assert.equal(resolved.reason, null);
    assert.equal(resolved.step, null);
    assert.deepEqual(resolved.steps.map((step) => [...step.argv]), vector.argv, label + " argv");
    if (vector.texts) assert.deepEqual(resolved.steps.map((step) => step.text), vector.texts, label + " text");
    if (vector.entryIds) assert.deepEqual(resolved.steps.map((step) => step.entryId), vector.entryIds, label + " entry");
    assert.deepEqual(resolved.steps.map((step) => step.index), vector.argv.map((_, index) => index + 1));
  }
});

test("resolve returns frozen step metadata and the sheet's sequence signature", () => {
  const api = helpers.cmCreateApi({ catalog: () => chipCatalog(), host: "athena", deps: {} });
  const text = 'bob ref create "notes/a && b.md" && bob ref rename old.md New && bob task archive && bob plan';
  const resolved = api.resolve(text);
  assert.equal(resolved.state, "ready");
  assert.equal(resolved.ok, true);
  assert.deepEqual(resolved.steps[0], {
    index: 1,
    text: 'bob ref create "notes/a && b.md"',
    argv: ["ref", "create", "notes/a && b.md"],
    entryId: "ref-create",
    entry_id: "ref-create",
    title: "Create reference",
    effect: "writes",
    policy: "run",
    presentation: "action",
    hasPreview: true,
    confirm: null,
  });
  assert.equal(resolved.steps[1].policy, "preview-first");
  assert.equal(resolved.steps[1].effect, "syncs");
  assert.equal(resolved.steps[2].policy, "confirm");
  assert.equal(resolved.steps[2].confirm, "Archive every done task?");
  assert.equal(resolved.steps[2].hasPreview, false);
  assert.equal(resolved.steps[3].presentation, "report");
  assert.equal(resolved.steps[3].effect, "reads");
  for (const step of resolved.steps) {
    assert.ok(Object.isFrozen(step));
    assert.ok(Object.isFrozen(step.argv));
  }
  assert.throws(() => { "use strict"; resolved.steps[0].argv.push("x"); }, TypeError);
  // Same signature the sheet computes for marked rows (path + user args, entry id).
  const sheetSteps = [
    { argv: ["ref", "create", "notes/a && b.md"], entry_id: "ref-create", title: "Create reference" },
    { argv: ["ref", "rename", "old.md", "New"], entry_id: "ref-rename" },
    { argv: ["task", "archive"], entry_id: "task-archive" },
    { argv: ["plan"], entry_id: "plan" },
  ];
  assert.equal(resolved.signature, helpers.cmSequenceSignature(sheetSteps));
  assert.equal(api.resolve("bob task-status-hooks").signature, api.resolve("bob task reconcile").signature);
  assert.equal(helpers.cmApiIsSignature(resolved.signature), true);
  assert.equal(helpers.cmApiIsSignature("bob plan"), false);
});

test("render-time resolve never starts or waits for a catalog load", () => {
  let loads = 0;
  const api = helpers.cmCreateApi({ catalog: () => null, deps: {} }, {
    catalogLoad: () => { loads += 1; return new Promise(() => {}); },
    catalogInfo: () => ({ status: "empty" }),
  });
  const resolved = api.resolve("bob plan");
  assert.equal(resolved.state, "loading");
  assert.equal(resolved.reason, helpers.CM_CATALOG_LOADING_REASON);
  assert.equal(loads, 0);
  assert.equal(api.catalogInfo().state, "loading");

  const missing = helpers.cmCreateApi({ catalog: () => null, deps: {} }, {
    catalogInfo: () => ({ status: "missing-bob", generation: 0 }),
  });
  assert.equal(missing.resolve("bob plan").state, "unavailable");
  assert.equal(missing.resolve("bob plan").reason, "Command Mode cannot find bob");
  assert.equal(missing.catalogInfo().state, "unavailable");
  assert.ok(Object.isFrozen(missing.catalogInfo()));
});

test("runText delivers guarded queued, running, finished callbacks for one run", async () => {
  const base = chipRunner({ FAKE_BOB_EXIT: "0" });
  const api = helpers.cmCreateApi(base.runner);
  const text = "bob ref create notes/a.md";
  const events = [];
  const result = await api.runText(text, {
    source: { path: "daily.md", line: 0 },
    onState: (event) => events.push(event),
  });
  assert.equal(result.ok, true);
  assert.equal(result.stage, "run");
  assert.equal(result.outcome, "completed");
  assert.equal(result.sequenceId, null);
  assert.ok(result.runId);
  assert.deepEqual(events.map((event) => event.state), ["queued", "running", "finished"]);
  for (const event of events) {
    assert.ok(Object.isFrozen(event));
    assert.equal(event.runId, result.runId);
    assert.equal(event.kind, "run");
    assert.equal(event.signature, api.resolve(text).signature);
    assert.equal(event.step, 1);
    assert.equal(event.total, 1);
    assert.equal(event.sequenceId, null);
  }
  assert.equal(events[2].outcome, "completed");
  assert.equal(events[2].exitCode, 0);
  assert.equal(events[2].reason, null);
  assert.equal(api.lastRun().trigger, "chip");
  assert.deepEqual(api.lastRun().source, { path: "daily.md", line: 0 });
  assert.deepEqual(base.spawned(), ["ref create notes/a.md"]);
});

test("a throwing or rejecting onState never affects the run", async () => {
  const base = chipRunner({ FAKE_BOB_EXIT: "0" });
  const api = helpers.cmCreateApi(base.runner);
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    let calls = 0;
    const thrown = await api.runText("bob ref create notes/b.md", {
      onState: () => { calls += 1; throw new Error("boom"); },
    });
    assert.equal(thrown.ok, true);
    assert.equal(calls, 3);
    const rejected = await api.runText("bob ref create notes/c.md", {
      onState: () => Promise.reject(new Error("async boom")),
    });
    assert.equal(rejected.ok, true);
    await tick();
    await tick();
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("a failed run carries its outcome, exit code, and first error for failed ink", async () => {
  const base = chipRunner({
    FAKE_BOB_EXIT_FOR: JSON.stringify({ "ref create notes/bad.md": 1 }),
    FAKE_BOB_STDERR: "error: broke\n",
  });
  const api = helpers.cmCreateApi(base.runner);
  const events = [];
  const result = await api.runText("bob ref create notes/bad.md", { onState: (event) => events.push(event) });
  assert.equal(result.ok, false);
  assert.equal(result.stage, "run");
  assert.equal(result.outcome, "failed");
  const finished = events.at(-1);
  assert.equal(finished.state, "finished");
  assert.equal(finished.outcome, "failed");
  assert.equal(finished.exitCode, 1);
  assert.equal(finished.reason, "error: broke");
  assert.equal(finished.runId, result.runId);
});

test("a multi-step chip reports each step and one distinct sequence finish", async () => {
  const base = chipRunner({ FAKE_BOB_EXIT_FOR: JSON.stringify({ "task reconcile": 3 }) });
  const api = helpers.cmCreateApi(base.runner);
  const events = [];
  const text = "bob ref create s1.md && bob task reconcile && bob ref create s3.md";
  const result = await api.runText(text, { source: { path: "walk.md", line: 4 }, onState: (event) => events.push(event) });
  assert.equal(result.stage, "sequence");
  assert.equal(result.outcome, "attention", "attention continues to the next step");
  assert.equal(result.ok, true);
  assert.ok(result.sequenceId.startsWith("seq-"));
  assert.deepEqual(events.map((event) => event.state + ":" + event.step), [
    "queued:1", "running:1", "step:1",
    "queued:2", "running:2", "step:2",
    "queued:3", "running:3", "step:3",
    "finished:3",
  ]);
  assert.deepEqual(events.filter((event) => event.state === "step").map((event) => event.outcome), [
    "completed", "attention", "completed",
  ]);
  for (const event of events) {
    assert.equal(event.kind, "sequence");
    assert.equal(event.sequenceId, result.sequenceId);
    assert.equal(event.total, 3);
    assert.equal(event.signature, api.resolve(text).signature);
  }
  const stepRuns = events.filter((event) => event.state === "step").map((event) => event.runId);
  assert.equal(new Set(stepRuns).size, 3);
  assert.equal(events.filter((event) => event.state === "finished").length, 1);
  assert.equal(events.at(-1).outcome, "attention");
  assert.deepEqual(base.spawned(), ["ref create s1.md", "task reconcile", "ref create s3.md"]);
  const last = api.lastRun();
  assert.equal(last.trigger, "chip");
  assert.deepEqual(last.source, { path: "walk.md", line: 4 });
});

test("a failure at step two stops step three and names the failing run", async () => {
  const base = chipRunner({ FAKE_BOB_EXIT_FOR: JSON.stringify({ "ref create f2.md": 1 }), FAKE_BOB_STDERR: "error: step two\n" });
  const api = helpers.cmCreateApi(base.runner);
  const events = [];
  const result = await api.runText("bob ref create f1.md && bob ref create f2.md && bob ref create f3.md", {
    onState: (event) => events.push(event),
  });
  assert.equal(result.ok, false);
  assert.equal(result.outcome, "failed");
  assert.equal(result.stoppedAt, 2);
  assert.equal(result.reason, "error: step two");
  const steps = events.filter((event) => event.state === "step");
  assert.deepEqual(steps.map((event) => event.outcome), ["completed", "failed"]);
  assert.equal(result.runId, steps[1].runId, "the failing step's run is the focus");
  const finished = events.at(-1);
  assert.equal(finished.state, "finished");
  assert.equal(finished.step, 2);
  assert.equal(finished.stoppedAt, 2);
  assert.equal(finished.reason, "error: step two");
  assert.deepEqual(base.spawned(), ["ref create f1.md", "ref create f2.md"]);
});

test("concurrent activations of one writer spawn bob once", async () => {
  const save = deferred();
  const base = chipRunner({ FAKE_BOB_EXIT: "0" }, { saveAllMarkdown: () => save.promise });
  const api = helpers.cmCreateApi(base.runner);
  const first = [];
  const second = [];
  const a = api.runText("bob ref create notes/once.md", { onState: (event) => first.push(event) });
  const b = api.runText("bob ref create notes/once.md", { onState: (event) => second.push(event) });
  await tick();
  save.resolve({ ok: true });
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(ra.ok, true);
  assert.equal(rb.ok, true);
  assert.equal(rb.duplicate, true);
  assert.equal(rb.runId, ra.runId);
  assert.deepEqual(base.spawned(), ["ref create notes/once.md"]);
  assert.equal(base.fired.filter((item) => item.name === helpers.CM_RUN_STARTED_EVENT).length, 1);
  assert.deepEqual(first.map((event) => event.state), ["queued", "running", "finished"]);
  assert.ok(second.length >= 1);
  assert.equal(second.at(-1).state, "finished");
  assert.equal(second.at(-1).runId, ra.runId);
  assert.ok(second.slice(0, -1).every((event) => event.state === "running" && event.runId === ra.runId));
});

test("a repeated activation opens live output instead of running again", async () => {
  const catalog = chipCatalog();
  const record = {
    id: "live-1", argv: ["/usr/bin/bob", "ref", "create", "notes/a.md"], entry_id: "ref-create",
    outcome: "queued", trigger: "chip", source: { path: "daily.md", line: 3 },
  };
  let runs = 0;
  const opened = [];
  const runner = {
    catalog: () => catalog, activeRecords: () => [record], deps: {},
    run: async () => { runs += 1; return { ok: true, runId: "unexpected" }; },
  };
  const api = helpers.cmCreateApi(runner, { openOutput: (runId) => { opened.push(runId); return { ok: true }; } });
  const events = [];
  const result = await api.runText("bob ref create notes/a.md", { onState: (event) => events.push(event) });
  assert.equal(result.ok, true);
  assert.equal(result.stage, "output");
  assert.equal(result.duplicate, true);
  assert.equal(result.active, true);
  assert.equal(result.kind, "run");
  assert.equal(result.state, "queued");
  assert.equal(result.runId, "live-1");
  assert.deepEqual(opened, ["live-1"]);
  assert.equal(runs, 0);
  assert.deepEqual(events, []);

  const signature = api.resolve("bob ref create notes/a.md").signature;
  const view = api.activeRun(signature);
  assert.ok(Object.isFrozen(view));
  assert.ok(Object.isFrozen(view.argv));
  assert.equal(view.kind, "run");
  assert.equal(view.state, "queued");
  assert.equal(view.runId, "live-1");
  assert.equal(view.sequenceId, null);
  assert.equal(view.step, 1);
  assert.equal(view.total, 1);
  assert.equal(api.activeRun(api.resolve("bob ref create notes/other.md").signature), null);
  // A dry-run preview of the same command is not that command running.
  record.preview = true;
  assert.equal(api.activeRun(signature), null);
});

test("activeRun(signature) finds a sequence between steps and a repeat opens its output", async () => {
  const catalog = chipCatalog();
  const records = [];
  const gates = [
    { before: null, finish: deferred() },
    { before: deferred(), finish: deferred() },
  ];
  const called = [deferred(), deferred()];
  let calls = 0;
  const runner = {
    host: "athena",
    deps: { random: () => 0.25, nowMs: () => Date.now() },
    catalog: () => catalog,
    activeRecords: () => records.filter((record) => record.outcome === "queued" || record.outcome === "running"),
    run(argv, opts) {
      const index = calls;
      calls += 1;
      const gate = gates[index];
      called[index].resolve();
      return (async () => {
        if (gate.before) await gate.before.promise;
        const record = {
          id: "run-" + (index + 1), argv: ["bob", ...argv], entry_id: opts.entryId, outcome: "queued",
          trigger: opts.trigger, source: opts.source, sequence: opts.sequence,
        };
        records.push(record);
        if (opts.onState) opts.onState({ state: "queued", runId: record.id, sequence: opts.sequence });
        record.outcome = "running";
        if (opts.onState) opts.onState({ state: "running", runId: record.id, sequence: opts.sequence });
        const outcome = await gate.finish.promise;
        record.outcome = outcome;
        return { ok: outcome === "completed", runId: record.id, outcome, exitCode: outcome === "completed" ? 0 : 1 };
      })();
    },
  };
  const plugin = new BobCommandModePlugin(makeApp());
  plugin.commandModeRunner = runner;
  const opened = [];
  const api = helpers.cmCreateApi(runner, {
    runSequence: (steps, opts) => plugin.commandModeRunSequence(steps, opts),
    activeSequences: () => plugin.commandModeSequenceSnapshots(),
    openOutput: (runId) => { opened.push(runId); return { ok: true }; },
  });
  const text = "bob ref create a.md && bob ref create b.md";
  const signature = api.resolve(text).signature;
  const events = [];
  const pending = api.runText(text, { onState: (event) => events.push(event) });

  await called[0].promise;
  await tick();
  const during = api.activeRun(signature);
  assert.equal(during.kind, "sequence");
  assert.equal(during.state, "running");
  assert.equal(during.runId, "run-1");
  assert.equal(during.step, 1);
  assert.equal(during.total, 2);
  const sequenceId = during.sequenceId;
  assert.ok(sequenceId);

  gates[0].finish.resolve("completed");
  await called[1].promise;
  await tick();
  // Step two has not queued yet: no live record matches, the sequence does.
  assert.equal(api.activeRuns().length, 0);
  const between = api.activeRun(signature);
  assert.equal(between.kind, "sequence");
  assert.equal(between.state, "running");
  assert.equal(between.sequenceId, sequenceId);
  assert.equal(between.step, 2);
  assert.equal(between.runId, "run-1", "between steps the last finished step's output opens");
  assert.equal(api.activeRun(text).sequenceId, sequenceId, "the text form finds it too");
  const repeat = await api.runText(text, {});
  assert.equal(repeat.stage, "output");
  assert.equal(repeat.duplicate, true);
  assert.deepEqual(opened, ["run-1"]);
  assert.equal(calls, 2, "the repeat never starts a run");

  gates[1].before.resolve();
  gates[1].finish.resolve("completed");
  const result = await pending;
  assert.equal(result.outcome, "completed");
  assert.equal(result.sequenceId, sequenceId);
  assert.equal(api.activeRun(signature), null);
  assert.deepEqual(events.map((event) => event.state + ":" + event.step), [
    "queued:1", "running:1", "step:1", "queued:2", "running:2", "step:2", "finished:2",
  ]);
});

test("runText waits only for an in-flight catalog load, bounded, then refuses", async () => {
  let catalog = null;
  const runs = [];
  const runner = {
    deps: {},
    catalog: () => catalog,
    activeRecords: () => [],
    run: async (argv, opts) => { runs.push({ argv, opts }); return { ok: true, runId: "r1", outcome: "completed", exitCode: 0 }; },
  };
  let loads = 0;
  const flight = deferred();
  const api = helpers.cmCreateApi(runner, { catalogLoad: () => { loads += 1; return flight.promise; } });
  const pending = api.runText("bob ref create a.md", { source: { path: "a.md", line: 1 } });
  await tick();
  assert.equal(runs.length, 0);
  catalog = chipCatalog();
  flight.resolve({ ok: true });
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.stage, "run");
  assert.equal(runs.length, 1);
  assert.equal(runs[0].opts.trigger, "chip");
  assert.equal(runs[0].opts.skipGuards, true);
  assert.equal(loads, 1);
  assert.equal(helpers.CM_API_CATALOG_WAIT_MS, 5000);

  catalog = null;
  const stalled = helpers.cmCreateApi(runner, { catalogLoad: () => new Promise(() => {}), catalogWaitMs: 30 });
  const started = Date.now();
  const timedOut = await stalled.runText("bob ref create a.md", { onState: () => assert.fail("no state on refusal") });
  assert.ok(Date.now() - started >= 25, "waited for the in-flight load");
  assert.equal(timedOut.ok, false);
  assert.equal(timedOut.outcome, "refused");
  assert.equal(timedOut.stage, "refused");
  assert.equal(timedOut.state, "loading");
  assert.equal(timedOut.reason, helpers.CM_CATALOG_LOADING_REASON);

  const idle = helpers.cmCreateApi(runner, { catalogLoad: () => null, catalogWaitMs: 5000 });
  const quick = Date.now();
  const noFlight = await idle.runText("bob ref create a.md");
  assert.ok(Date.now() - quick < 1000, "no flight means no wait");
  assert.equal(noFlight.state, "loading");
  assert.equal(runs.length, 1, "refusals never run");
});

test("refusals, confirm floors, and option whitelisting never run", async () => {
  const catalog = chipCatalog();
  let runs = 0;
  const runner = {
    catalog: () => catalog, activeRecords: () => [], deps: {}, host: "athena",
    run: async () => { runs += 1; return { ok: true, runId: "unexpected" }; },
  };
  const sheet = { catalog, render() {}, refocusInput() {}, close() {} };
  const api = helpers.cmCreateApi(runner, { openSheet: () => ({ ok: true }), getSheet: () => sheet });
  const events = [];
  const onState = (event) => events.push(event);

  const invalid = await api.runText("bob plan | less", { onState });
  assert.deepEqual(
    { ok: invalid.ok, outcome: invalid.outcome, stage: invalid.stage, state: invalid.state, step: invalid.step },
    { ok: false, outcome: "refused", stage: "refused", state: "invalid", step: 1 },
  );
  const unavailable = await api.runText("bob mac-only", { onState });
  assert.equal(unavailable.state, "unavailable");
  assert.match(unavailable.reason, /runs only on mac/);

  const confirm = await api.runText("bob task archive", {
    onState, trigger: "sheet", skipGuards: true, confirmed: true, entryId: "plan", policy: "run",
  });
  assert.equal(confirm.ok, true);
  assert.equal(confirm.stage, "confirm");
  assert.equal(confirm.outcome, "opened");
  assert.equal(confirm.runId, null);
  assert.equal(sheet.confirmSequence.trigger, "chip");

  const review = await api.runText("bob ref create a.md && bob task archive", { onState });
  assert.equal(review.stage, "review");
  assert.equal(review.outcome, "opened");
  assert.deepEqual(review.guards.map((guard) => guard.kind), ["confirm"]);
  assert.equal(runs, 0);
  assert.deepEqual(events, [], "cards and refusals never claim a running state");
});

test("report, preview-first, and openText stages settle honestly", async () => {
  const base = chipRunner({ FAKE_BOB_EXIT: "0" });
  const previews = [];
  const sheet = sheetStub(base.runner, {
    async runPreview(row, argv, opts) {
      previews.push({ row, argv, opts });
      return { ok: true, runId: "preview-1", outcome: "completed", exitCode: 0 };
    },
  });
  const api = helpers.cmCreateApi(base.runner, { openSheet: () => ({ ok: true }), getSheet: () => sheet });

  const reportEvents = [];
  const report = await api.runText("bob plan", { source: { path: "dash.md", line: 2 }, onState: (event) => reportEvents.push(event) });
  assert.equal(report.stage, "output");
  assert.equal(report.outcome, "completed");
  assert.equal(sheet.outputRunId, report.runId);
  assert.deepEqual(reportEvents.map((event) => event.state), ["queued", "running", "finished"]);
  assert.equal(api.lastRun().trigger, "chip");
  assert.deepEqual(api.lastRun().source, { path: "dash.md", line: 2 });

  const runNow = await api.runText("bob ref rename old.md New", {});
  assert.equal(runNow.stage, "run", "run-now skips preview-first");
  assert.equal(runNow.outcome, "completed");
  assert.equal(base.spawned().at(-1), "ref rename old.md New");

  const previewEvents = [];
  const opened = await api.openText("bob ref rename old.md New", { onState: (event) => previewEvents.push(event) });
  assert.equal(opened.stage, "preview");
  assert.equal(opened.runId, "preview-1");
  assert.equal(previews.length, 1);
  assert.equal(previews[0].opts.trigger, "chip");
  assert.deepEqual(previewEvents, [], "a dry-run preview is not the command running");

  const openReportEvents = [];
  const openReport = await api.openText("bob plan", { onState: (event) => openReportEvents.push(event) });
  assert.equal(openReport.stage, "output");
  assert.deepEqual(openReportEvents.map((event) => event.state), ["queued", "running", "finished"]);
});

test("onCatalogChanged fires on the first usable catalog and on a new fingerprint with identical JSON", async () => {
  const stat = fs.statSync(FAKE_BOB);
  const liveFingerprint = { path: FAKE_BOB, mtimeMs: stat.mtimeMs, size: stat.size };
  const liveKey = helpers.cmCatalogFingerprintKey(liveFingerprint);
  const load = async (stored) => {
    const app = makeApp();
    app.vault.adapter.getBasePath = () => os.tmpdir();
    const events = [];
    app.workspace.on(helpers.CM_CATALOG_CHANGED_EVENT, (payload) => events.push(payload));
    const plugin = new BobCommandModePlugin(app);
    plugin.stored = stored;
    await plugin.onload();
    return { plugin, events };
  };

  const fresh = await load({ settings: { bobPath: FAKE_BOB }, catalogCache: {} });
  assert.equal(fresh.plugin.api.commandMode.resolve("bob plan").state, "loading");
  assert.equal(fresh.plugin.api.commandMode.catalogInfo().loading, true);
  await fresh.plugin.commandModeCatalogFlight;
  assert.equal(fresh.plugin.commandModeCatalogFlight, null);
  assert.equal(fresh.events.length, 1);
  assert.equal(fresh.events[0].generation, 1);
  assert.equal(fresh.events[0].fingerprint, liveKey);
  assert.equal(fresh.events[0].token, "1:" + liveKey);
  assert.equal(fresh.events[0].reason, "load");
  assert.deepEqual(fresh.plugin.api.commandMode.catalogInfo(), {
    state: "ready", status: "ready", ready: true, loading: false,
    fingerprint: liveKey, generation: 1, token: "1:" + liveKey,
  });
  const served = fresh.plugin.commandModeCatalog;
  fresh.plugin.onunload();

  // Identical catalog JSON under a stale fingerprint (a rebuilt binary).
  const rebuilt = await load({
    settings: { bobPath: FAKE_BOB },
    catalogCache: { fingerprint: { path: FAKE_BOB, mtimeMs: 1, size: 1 }, catalog: served },
  });
  const api = rebuilt.plugin.api.commandMode;
  assert.equal(api.resolve("bob plan").state, "ready", "a cached catalog is usable before any event");
  assert.equal(api.catalogInfo().generation, 1);
  const unsubscribed = [];
  const off = api.onCatalogChanged((payload) => unsubscribed.push(payload));
  off();
  await rebuilt.plugin.commandModeCatalogFlight;
  assert.equal(JSON.stringify(rebuilt.plugin.commandModeCatalog), JSON.stringify(served));
  assert.equal(rebuilt.events.length, 1);
  assert.equal(rebuilt.events[0].generation, 2);
  assert.equal(rebuilt.events[0].fingerprint, liveKey);
  assert.notEqual(rebuilt.events[0].token, "1:" + helpers.cmCatalogFingerprintKey({ path: FAKE_BOB, mtimeMs: 1, size: 1 }));
  assert.deepEqual(unsubscribed, []);
  await rebuilt.plugin.commandModeRefreshCatalog("force");
  assert.equal(rebuilt.events.length, 1, "same binary and same JSON stay quiet");
  rebuilt.plugin.onunload();

  // A cached catalog whose binary is unchanged is announced once.
  const cached = await load({
    settings: { bobPath: FAKE_BOB },
    catalogCache: { fingerprint: liveFingerprint, catalog: served },
  });
  await cached.plugin.commandModeCatalogFlight;
  assert.equal(cached.events.length, 1);
  assert.equal(cached.events[0].generation, 1);
  await cached.plugin.commandModeRefreshCatalog("load");
  assert.equal(cached.events.length, 1);
  cached.plugin.onunload();
});

test("chip provenance keeps only vault-relative paths and non-negative lines", () => {
  assert.deepEqual(helpers.cmCopyRunSource({ path: "Daily/2026-11-20.md", line: 0 }), { path: "Daily/2026-11-20.md", line: 0 });
  assert.deepEqual(helpers.cmCopyRunSource({ path: "a.md", line: -1 }), { path: "a.md" });
  assert.deepEqual(helpers.cmCopyRunSource({ path: "a.md", line: 2.5 }), { path: "a.md" });
  assert.deepEqual(helpers.cmCopyRunSource({ path: "a.md", line: "3" }), { path: "a.md" });
  assert.equal(helpers.cmCopyRunSource({ path: "/etc/passwd", line: 1 }), null);
  assert.equal(helpers.cmCopyRunSource({ path: "C:\\notes\\a.md" }), null);
  assert.equal(helpers.cmCopyRunSource({ path: "ref/../a.md" }), null);
  assert.equal(helpers.cmCopyRunSource({ path: "x".repeat(513) }), null);
  assert.deepEqual(helpers.cmCopyRunSource({ path: "x".repeat(512) }), { path: "x".repeat(512) });
  assert.equal(helpers.cmCopyRunSource({ line: 3 }), null);
});
