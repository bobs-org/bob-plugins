// Sequence engine: stamps, in-order driver, history, and plugin wiring.
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
  takeNotices,
  fixtureCatalog,
} = require("./command-mode-harness.cjs");

const FAKE_BOB = path.join(__dirname, "fixtures", "fake-bob.cjs");
const DEADLOCK_MS = 15000;

function sequenceCatalog() {
  const base = fixtureCatalog();
  return {
    ...base,
    entries: [
      ...base.entries,
      {
        id: "plan-budget", path: ["plan", "budget"], fixed: [], title: "Plan budget",
        about: "Show the plan budget", section: "daily", keywords: ["budget"],
        effect: "reads", network: false, presentation: "report",
        policy: "run", preview: null, confirm: null, budget_secs: 60,
        args: [], exit_codes: [], adapter: null, hosts: [], invalidates: [],
      },
      {
        id: "task-archive", path: ["task", "archive"], fixed: [], title: "Archive done tasks",
        about: "Archive done tasks", section: "daily", keywords: ["archive"],
        effect: "writes", network: false, presentation: "action",
        policy: "confirm", preview: null, confirm: "Archive every done task?",
        budget_secs: 60, args: [], exit_codes: [{ code: 3, outcome: "attention", meaning: "Nothing to archive" }],
        adapter: null, hosts: [], invalidates: ["tasks"],
      },
      {
        id: "ref-rename", path: ["ref", "rename"], fixed: [], title: "Rename a reference",
        about: "Rename a reference", section: "vault", keywords: ["rename"],
        effect: "syncs", network: false, presentation: "action",
        policy: "preview-first", preview: ["--dry-run"], confirm: null, budget_secs: 60,
        args: [
          { name: "REF", slot: "ref", required: true, repeat: false },
          { name: "NAME", slot: "text", required: true, repeat: false },
        ],
        exit_codes: [], adapter: null, hosts: [], invalidates: ["references"],
      },
      {
        id: "vault-sync", path: ["vault-sync", "run"], fixed: [], title: "Sync vault now",
        about: "Sync vault now", section: "vault", keywords: ["sync"],
        effect: "syncs", network: false, presentation: "action",
        policy: "run", preview: null, confirm: null, budget_secs: 180,
        args: [], exit_codes: [], adapter: null, hosts: [], invalidates: [],
      },
    ],
  };
}

function step(id, argv, title) {
  return { argv, entry_id: id, title };
}

function readLog(file) {
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, "utf8").trim();
  if (!text) return [];
  return text.split("\n").map((line) => JSON.parse(line));
}

async function waitUntil(predicate, label, timeoutMs = DEADLOCK_MS) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  assert.fail(label + " (timed out after " + timeoutMs + "ms)");
}

function runnerWith(extraEnv = {}, overrides = {}) {
  const catalog = overrides.catalog || sequenceCatalog();
  const base = makeRunner({ ...overrides, catalog });
  const logFile = extraEnv.FAKE_BOB_LOG_FILE || path.join(base.tmpState, "fake-bob.log");
  base.logFile = logFile;
  base.runner.deps.env = {
    ...process.env,
    XDG_STATE_HOME: base.tmpState,
    PATH: "/usr/bin:/bin",
    FAKE_BOB_SLEEP_MS: extraEnv.FAKE_BOB_SLEEP_MS || "25",
    FAKE_BOB_LOG_FILE: logFile,
    ...extraEnv,
  };
  if (!Object.hasOwn(extraEnv, "NO_COLOR")) delete base.runner.deps.env.NO_COLOR;
  base.runner.deps.resolveBob = () => ({ path: FAKE_BOB, source: "candidate", tried: [FAKE_BOB] });
  return base;
}

function pluginWithRunner(base) {
  const plugin = new BobCommandModePlugin(makeApp());
  plugin.settings = { osNotifications: false };
  plugin.commandModeStickyNotices = new Map();
  plugin.commandModeRunner = base.runner;
  plugin.commandModeCatalog = base.runner.catalog();
  base.runner.deps.notify = (run) => plugin.commandModeNotify(run);
  base.runner.deps.fireEvent = (name, payload) => plugin.commandModeFireEvent(name, payload);
  return plugin;
}

const THREE = [
  step("plan", ["plan"], "Today's plan"),
  step("ready", ["ready"], "Ready lanes"),
  step("plan-budget", ["plan", "budget"], "Plan budget"),
];

test("cmNewRecord copies a sanitized sequence stamp and omits the field otherwise", () => {
  const plain = helpers.cmNewRecord({ id: "a", argv: ["plan"] });
  assert.equal("sequence" in plain, false);
  const stamped = helpers.cmNewRecord({
    id: "b",
    argv: ["plan"],
    sequence: {
      id: 12,
      index: "2",
      total: "3",
      started_at: 7,
      steps: [{ argv: ["plan", 1], entryId: "plan", title: 9 }],
    },
  });
  assert.deepEqual(stamped.sequence, {
    id: "12",
    index: 2,
    total: 3,
    started_at: "7",
    steps: [{ argv: ["plan", "1"], entry_id: "plan", title: "9" }],
  });
});

test("step display, title, copy text, guards, continues, and focus run", () => {
  const catalog = sequenceCatalog();
  const steps = [
    step("vault-sync", ["vault-sync", "run"], "Sync vault now"),
    step("task-archive", ["task", "archive"], "Archive done tasks"),
    step("plan", ["plan"], "Today's plan"),
  ];
  assert.deepEqual(helpers.cmSequenceStepDisplay(steps[0], catalog), ["vault-sync", "run"]);
  assert.equal(helpers.cmSequenceStepTitle({ argv: ["plan"], entry_id: "plan", title: "Run typed bob command" }, catalog), "Today's plan");
  assert.equal(helpers.cmSequenceStepTitle({ argv: ["gone"], title: "Run typed bob command" }, catalog), "gone");
  assert.equal(
    helpers.cmSequenceCopyText(steps, catalog),
    "bob vault-sync run && bob task archive && bob plan",
  );
  assert.equal(helpers.cmSequenceContinues("completed"), true);
  assert.equal(helpers.cmSequenceContinues("attention"), true);
  assert.equal(helpers.cmSequenceContinues("failed"), false);
  assert.equal(helpers.cmSequenceContinues("stopped"), false);
  const guards = helpers.cmSequenceGuards(steps, catalog);
  assert.deepEqual(guards, [
    { index: 2, kind: "confirm", text: "Archive every done task?" },
  ]);
  const rename = helpers.cmSequenceGuards([step("ref-rename", ["ref", "rename", "a", "b"], "Rename")], catalog);
  assert.deepEqual(rename, [{ index: 1, kind: "preview-first", text: "applies without its preview" }]);

  const summary = {
    stoppedAt: 2,
    steps,
    results: [
      { index: 1, runId: "r1", outcome: "completed" },
      { index: 2, runId: "r2", outcome: "failed" },
      { index: 3, skipped: true },
    ],
  };
  assert.equal(helpers.cmSequenceFocusRunId(summary, catalog), "r2");
  const allOk = {
    stoppedAt: null,
    steps,
    results: [
      { index: 1, runId: "r1", outcome: "completed" },
      { index: 2, runId: "r2", outcome: "completed" },
      { index: 3, runId: "r3", outcome: "completed" },
    ],
  };
  assert.equal(helpers.cmSequenceFocusRunId(allOk, catalog), "r3");
});

test("history groups by id, newest record per index wins, and states include interrupted", () => {
  const steps = THREE.map((row) => helpers.cmSequenceStep(row));
  const stamp = (id, index, started) => ({
    id, index, total: 3, started_at: started, steps,
  });
  const rec = (id, index, started, extra = {}) => ({
    id: extra.runId || (id + "-" + index + "-" + started),
    started_at: started,
    finished_at: extra.finished_at || started,
    duration_ms: extra.duration_ms || 10,
    outcome: extra.outcome || "completed",
    summary: extra.summary || null,
    sequence: stamp(id, index, extra.seqStarted || "2026-10-30T12:00:00.000Z"),
  });
  const records = [
    rec("seq-a", 1, "2026-10-30T12:00:01.000Z"),
    rec("seq-a", 2, "2026-10-30T12:00:02.000Z", { outcome: "failed", summary: "old fail", runId: "old-2" }),
    rec("seq-a", 2, "2026-10-30T12:00:05.000Z", { outcome: "completed", summary: "resumed", runId: "new-2" }),
    rec("seq-a", 3, "2026-10-30T12:00:06.000Z", { finished_at: "2026-10-30T12:00:07.000Z" }),
    rec("seq-b", 1, "2026-10-30T12:01:00.000Z", { seqStarted: "2026-10-30T12:01:00.000Z" }),
  ];
  const grouped = helpers.cmSequenceHistory(records, { activeIds: [] });
  assert.equal(grouped.length, 2);
  const a = grouped.find((row) => row.id === "seq-a");
  assert.equal(a.state, "completed");
  assert.equal(a.records[1].id, "new-2");
  assert.equal(a.results[1].runId, "new-2");
  assert.equal(a.durationMs, Date.parse("2026-10-30T12:00:07.000Z") - Date.parse("2026-10-30T12:00:00.000Z"));
  const b = grouped.find((row) => row.id === "seq-b");
  assert.equal(b.state, "interrupted");
  const running = helpers.cmSequenceHistory(records, { activeIds: ["seq-b"] });
  assert.equal(running.find((row) => row.id === "seq-b").state, "running");
  const halted = helpers.cmSequenceHistory([
    rec("seq-c", 1, "2026-10-30T12:02:00.000Z", { seqStarted: "2026-10-30T12:02:00.000Z" }),
    rec("seq-c", 2, "2026-10-30T12:02:01.000Z", { outcome: "unknown", seqStarted: "2026-10-30T12:02:00.000Z" }),
  ], {});
  assert.equal(halted[0].state, "unknown");
  assert.equal(halted[0].stoppedAt, 2);
});

test("cmRunSequence runs reads in order, stamps every record, and survives throwing hooks", async () => {
  const logFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bob-seq-")), "log.jsonl");
  const base = runnerWith({ FAKE_BOB_LOG_FILE: logFile, FAKE_BOB_SLEEP_MS: "30" });
  try {
    let starts = 0;
    const summary = await helpers.cmRunSequence(base.runner, THREE, {
      onStepStart() { starts += 1; throw new Error("start boom"); },
      onStepFinish() { throw new Error("finish boom"); },
    });
    assert.equal(summary.outcome, "completed");
    assert.equal(summary.total, 3);
    assert.equal(summary.stoppedAt, null);
    assert.equal(starts, 3);
    assert.equal(summary.results.every((row) => row.outcome === "completed" && row.runId), true);
    const logs = readLog(logFile);
    assert.equal(logs.length, 3);
    for (let i = 1; i < logs.length; i += 1) {
      assert.ok(Date.parse(logs[i].start) >= Date.parse(logs[i - 1].end), JSON.stringify(logs));
    }
    const records = helpers.cmListRecords(base.runner.fs(), base.runner.runsDir());
    assert.equal(records.length, 3);
    for (let i = 0; i < records.length; i += 1) {
      const stamp = records[i].sequence;
      assert.ok(stamp && stamp.id.startsWith("seq-"));
      assert.equal(stamp.index, i + 1);
      assert.equal(stamp.total, 3);
      assert.equal(stamp.steps.length, 3);
      assert.deepEqual(stamp.steps.map((row) => row.entry_id), ["plan", "ready", "plan-budget"]);
    }
  } finally {
    base.runner.dispose();
  }
});

test("a failing step 2 halts the sequence and skips later steps", async () => {
  const logFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bob-seq-")), "log.jsonl");
  const base = runnerWith({
    FAKE_BOB_LOG_FILE: logFile,
    FAKE_BOB_EXIT_FOR: JSON.stringify({ ready: 1 }),
  });
  try {
    const summary = await helpers.cmRunSequence(base.runner, THREE, { id: "seq-halt" });
    assert.equal(summary.outcome, "failed");
    assert.equal(summary.stoppedAt, 2);
    assert.equal(summary.results[0].outcome, "completed");
    assert.equal(summary.results[1].outcome, "failed");
    assert.deepEqual(summary.results[2], { index: 3, skipped: true });
    const logs = readLog(logFile);
    assert.equal(logs.length, 2);
    assert.deepEqual(logs[1].argv, ["ready"]);
    const records = helpers.cmListRecords(base.runner.fs(), base.runner.runsDir());
    assert.equal(records.length, 2);
    assert.equal(records.every((row) => row.sequence && row.sequence.id === "seq-halt"), true);
  } finally {
    base.runner.dispose();
  }
});

test("attention continues the sequence", async () => {
  const base = runnerWith({
    FAKE_BOB_EXIT_FOR: JSON.stringify({ "task archive": 3 }),
  });
  try {
    const steps = [
      step("plan", ["plan"], "Today's plan"),
      step("task-archive", ["task", "archive"], "Archive done tasks"),
      step("ready", ["ready"], "Ready lanes"),
    ];
    const summary = await helpers.cmRunSequence(base.runner, steps);
    assert.equal(summary.outcome, "attention");
    assert.equal(summary.stoppedAt, null);
    assert.equal(summary.results[1].outcome, "attention");
    assert.equal(summary.results[2].outcome, "completed");
  } finally {
    base.runner.dispose();
  }
});

test("an early saveAllMarkdown refusal halts with its reason", async () => {
  const base = runnerWith({}, {
    saveAllMarkdown: () => Promise.resolve({ ok: false, path: "Daily/today.md" }),
  });
  try {
    const steps = [
      step("plan", ["plan"], "Today's plan"),
      step("task-archive", ["task", "archive"], "Archive done tasks"),
      step("ready", ["ready"], "Ready lanes"),
    ];
    const summary = await helpers.cmRunSequence(base.runner, steps);
    assert.equal(summary.outcome, "failed");
    assert.equal(summary.stoppedAt, 2);
    assert.equal(summary.results[1].runId, null);
    assert.match(String(summary.results[1].reason), /Could not save/);
    assert.deepEqual(summary.results[2], { index: 3, skipped: true });
    const records = helpers.cmListRecords(base.runner.fs(), base.runner.runsDir());
    assert.equal(records.length, 1);
    assert.equal(records[0].entry_id, "plan");
  } finally {
    base.runner.dispose();
  }
});

test("a stale entry_id falls back to argv", async () => {
  const base = runnerWith();
  try {
    const summary = await helpers.cmRunSequence(base.runner, [
      { argv: ["plan"], entry_id: "missing-entry", title: "Today's plan" },
    ]);
    assert.equal(summary.outcome, "completed");
    assert.ok(summary.results[0].runId);
    const record = helpers.cmPagerFindRecord(base.runner, summary.results[0].runId);
    assert.equal(record.entry_id, "plan");
    assert.equal(record.sequence.steps[0].entry_id, "missing-entry");
  } finally {
    base.runner.dispose();
  }
});

test("resume reuses the id and history folds into one group", async () => {
  const base = runnerWith({
    FAKE_BOB_EXIT_FOR: JSON.stringify({ ready: 1 }),
  });
  try {
    const first = await helpers.cmRunSequence(base.runner, THREE, { id: "seq-resume" });
    assert.equal(first.outcome, "failed");
    assert.equal(first.stoppedAt, 2);
    delete base.runner.deps.env.FAKE_BOB_EXIT_FOR;
    const second = await helpers.cmRunSequence(base.runner, THREE, {
      id: "seq-resume",
      startIndex: 1,
      priorResults: first.results,
    });
    assert.equal(second.id, "seq-resume");
    assert.equal(second.outcome, "completed");
    assert.equal(second.results[0].runId, first.results[0].runId);
    assert.ok(second.results[1].runId);
    assert.notEqual(second.results[1].runId, first.results[1].runId);
    const groups = helpers.cmSequenceHistory(
      helpers.cmListRecords(base.runner.fs(), base.runner.runsDir()),
      {},
    );
    assert.equal(groups.length, 1);
    assert.equal(groups[0].id, "seq-resume");
    assert.equal(groups[0].state, "completed");
    assert.equal(groups[0].results[1].runId, second.results[1].runId);
  } finally {
    base.runner.dispose();
  }
});

test("cancelled() stops before the next step", async () => {
  const logFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bob-seq-")), "log.jsonl");
  const base = runnerWith({ FAKE_BOB_LOG_FILE: logFile });
  try {
    let finished = 0;
    const summary = await helpers.cmRunSequence(base.runner, THREE, {
      onStepFinish() { finished += 1; },
      cancelled() { return finished >= 1; },
    });
    assert.equal(summary.outcome, "interrupted");
    assert.equal(summary.stoppedAt, null);
    assert.equal(summary.results[0].outcome, "completed");
    assert.deepEqual(summary.results[1], { index: 2, skipped: true });
    assert.equal(readLog(logFile).length, 1);
  } finally {
    base.runner.dispose();
  }
});

test("plugin suppresses per-step toasts and skips chip settle for an active sequence", async () => {
  takeNotices();
  const base = runnerWith();
  const plugin = pluginWithRunner(base);
  try {
    const chipState = plugin.commandModeChipState();
    const originalSettle = plugin.commandModeRecordChipSettle.bind(plugin);
    plugin.commandModeRecordChipSettle = function trackSettle(payload) {
      if (payload && payload.runId) chipState.shown.add(String(payload.runId));
      return originalSettle(payload);
    };
    const summary = await plugin.commandModeRunSequence(THREE.slice(0, 2));
    assert.equal(summary.outcome, "completed");
    const notes = takeNotices();
    assert.equal(notes.length, 1, JSON.stringify(notes));
    assert.match(notes[0], /bob sequence · 2\/2 completed/);
    assert.equal(chipState.settle, null);
  } finally {
    base.runner.dispose();
  }
});

test("duplicate signatures are refused and rerun-last replays a stamped newest record", async () => {
  takeNotices();
  const gate = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bob-seq-")), "gate");
  const base = runnerWith({ FAKE_BOB_GATE_FILE: gate, FAKE_BOB_GATE_TIMEOUT_MS: "8000" });
  const plugin = pluginWithRunner(base);
  try {
    const first = plugin.commandModeRunSequence(THREE.slice(0, 2), { id: "seq-dup" });
    await waitUntil(() => plugin.commandModeSequenceIsActive(helpers.cmSequenceSignature(THREE.slice(0, 2))), "sequence became active");
    const second = await plugin.commandModeRunSequence(THREE.slice(0, 2));
    assert.equal(second.ok, false);
    assert.equal(second.reason, "already running");
    assert.ok(takeNotices().some((note) => /already running/i.test(note)));
    fs.writeFileSync(gate, "1\n");
    const summary = await first;
    assert.equal(summary.outcome, "completed");

    const reruns = [];
    const originalRun = plugin.commandModeRunSequence.bind(plugin);
    plugin.commandModeRunSequence = (steps, opts) => {
      reruns.push({ steps, opts });
      return originalRun(steps, opts);
    };
    const replayed = await plugin.commandModeRerunLast();
    assert.equal(reruns.length, 1);
    assert.deepEqual(reruns[0].steps.map((row) => row.entry_id), ["plan", "ready"]);
    assert.equal(replayed.outcome, "completed");
    assert.notEqual(replayed.id, summary.id);
  } finally {
    try { fs.writeFileSync(gate, "1\n"); } catch (error) { /* Best effort. */ }
    base.runner.dispose();
  }
});

test("rerun-last command callback points at commandModeRerunLast", async () => {
  const app = makeApp();
  app.vault.adapter.getBasePath = () => os.tmpdir();
  const plugin = new BobCommandModePlugin(app);
  plugin.stored = { settings: { bobPath: FAKE_BOB }, catalogCache: { catalog: sequenceCatalog() } };
  await plugin.onload();
  try {
    const spec = plugin.commands.get("rerun-last");
    assert.ok(spec && typeof spec.callback === "function");
    let called = 0;
    plugin.commandModeRerunLast = () => { called += 1; return { ok: true }; };
    spec.callback();
    assert.equal(called, 1);
  } finally {
    plugin.onunload();
  }
});
