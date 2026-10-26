// Detached file-backed runs: spawn, tail, queue, guards, budgets, stop,
// receipts, retention, and reload adoption — all against the fake bob.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const { helpers, fixtureCatalog, makeRunner } = require("./command-mode-harness.cjs");

const FAKE_BOB = path.join(__dirname, "fixtures", "fake-bob.cjs");

function runnerWith(extraEnv = {}, overrides = {}) {
  const base = makeRunner(overrides);
  const stateHome = base.tmpState;
  base.runner.deps.env = {
    ...process.env,
    XDG_STATE_HOME: stateHome,
    PATH: "/usr/bin:/bin",
    ...extraEnv,
  };
  if (!Object.hasOwn(extraEnv, "NO_COLOR")) delete base.runner.deps.env.NO_COLOR;
  base.runner.deps.resolveBob = () => ({ path: FAKE_BOB, source: "candidate", tried: [FAKE_BOB] });
  return base;
}

function runPaths(base, runId) {
  return helpers.cmRunFilePaths(base.runner.runsDir(), runId, path);
}

function richCatalog() {
  const base = fixtureCatalog();
  return {
    ...base,
    entries: [
      ...base.entries,
      {
        id: "task-archive", path: ["task", "archive"], fixed: [], title: "Archive done tasks",
        about: "Archive", section: "daily", keywords: ["archive"],
        effect: "writes", network: false, presentation: "action",
        policy: "confirm", preview: null, confirm: "Archive every done task?",
        budget_secs: 60, args: [], exit_codes: [], adapter: null, hosts: [], invalidates: ["tasks"],
      },
      {
        id: "ref-rename", path: ["ref", "rename"], fixed: [], title: "Rename a reference",
        about: "Rename", section: "vault", keywords: ["rename"],
        effect: "syncs", network: false, presentation: "action",
        policy: "preview-first", preview: ["--dry-run"], confirm: null, budget_secs: 60,
        args: [
          { name: "REF", slot: "ref", required: true, repeat: false },
          { name: "NAME", slot: "text", required: true, repeat: false },
        ],
        exit_codes: [], adapter: null, hosts: [], invalidates: ["references"],
      },
      {
        id: "plan-budget", path: ["plan", "budget"], fixed: [], title: "Plan budget",
        about: "Budget", section: "daily", keywords: ["budget"],
        effect: "reads", network: false, presentation: "report",
        policy: "run", preview: null, confirm: null, budget_secs: 1,
        args: [], exit_codes: [], adapter: null, hosts: [], invalidates: [],
      },
      {
        id: "slow-write", path: ["slow", "write"], fixed: [], title: "Slow write",
        about: "Slow", section: "daily", keywords: ["slow"],
        effect: "writes", network: false, presentation: "action",
        policy: "run", preview: null, confirm: null, budget_secs: 1,
        args: [], exit_codes: [], adapter: null, hosts: [], invalidates: [],
      },
    ],
  };
}

test("completed read writes files, receipt, and an honest record", async () => {
  const base = runnerWith({ FAKE_BOB_STDOUT: "line one\nline two\n", FAKE_BOB_EXIT: "0" });
  const settled = await base.runner.run(["plan"]);
  assert.equal(settled.ok, true);
  assert.equal(settled.outcome, "completed");
  assert.equal(settled.exitCode, 0);
  const files = runPaths(base, settled.runId);
  const out = fs.readFileSync(files.out, "utf8");
  assert.equal(out, "line one\nline two\n");
  const receipt = helpers.cmReadReceipt(fs, files.receipt);
  assert.deepEqual(receipt.exit_code, 0);
  assert.equal(receipt.schema_version, 1);
  const record = JSON.parse(fs.readFileSync(files.json, "utf8"));
  assert.equal(record.schema, 1);
  assert.deepEqual(record.argv, [FAKE_BOB, "plan"]);
  assert.equal(record.entry_id, "plan");
  assert.equal(record.effect, "reads");
  assert.equal(record.presentation, "report");
  assert.equal(record.summary, "line two");
  assert.equal(record.exit_code, 0);
  assert.ok(record.duration_ms >= 0);
  assert.ok(Array.isArray(record.interleave) && record.interleave.length > 0);
  assert.equal(record.truncated, false);
  assert.equal(record.bob_path, FAKE_BOB);
  const dirStat = fs.statSync(base.runner.runsDir());
  assert.equal(dirStat.mode & 0o777, 0o700);
  assert.equal(fs.statSync(files.json).mode & 0o777, 0o600);
  assert.equal(fs.statSync(files.out).mode & 0o777, 0o600);
});

test("child env carries vault, features, receipt, and tool paths", async () => {
  const base = runnerWith({ FAKE_BOB_ECHO: "1" });
  const settled = await base.runner.run(["plan"]);
  assert.equal(settled.ok, true);
  const files = runPaths(base, settled.runId);
  const echoed = JSON.parse(helpers.cmLastMeaningfulLine(fs.readFileSync(files.out, "utf8")));
  assert.deepEqual(echoed.argv, ["plan"]);
  assert.ok(echoed.env.BOB_DIR.length > 0);
  assert.equal(echoed.env.CLICOLOR_FORCE, "1");
  assert.equal(echoed.env.BOB_PROGRESS, "1");
  assert.ok(echoed.env.BOB_RUN_RECEIPT.endsWith(settled.runId + ".rc"));
  assert.equal(echoed.env.COLUMNS, "100");
  assert.ok(echoed.env.PATH.includes(".cargo/bin"));
  assert.equal(echoed.env.BOB_NOW, null);
});

test("literal args with spaces, quotes, and $() stay literal", async () => {
  const base = runnerWith({ FAKE_BOB_ECHO: "1" });
  const settled = await base.runner.run(["plan", "a b", "$(evil)", "it's", "--flag=x"]);
  assert.equal(settled.ok, true);
  const files = runPaths(base, settled.runId);
  const echoed = JSON.parse(helpers.cmLastMeaningfulLine(fs.readFileSync(files.out, "utf8")));
  assert.deepEqual(echoed.argv, ["plan", "a b", "$(evil)", "it's", "--flag=x"]);
});

test("split multi-byte characters survive and big output stays intact", async () => {
  const split = runnerWith({ FAKE_BOB_SPLIT_MBYTE: "1" });
  const done = await split.runner.run(["plan"]);
  const files = runPaths(split, done.runId);
  assert.equal(fs.readFileSync(files.out, "utf8"), "héllo\n");

  const big = runnerWith({ FAKE_BOB_BIG: "1" });
  const settled = await big.runner.run(["plan"]);
  assert.equal(settled.ok, true);
  const bigFiles = runPaths(big, settled.runId);
  const size = fs.statSync(bigFiles.out).size;
  assert.ok(size > 1024 * 1024, "expected >1MiB, got " + size);
  const record = JSON.parse(fs.readFileSync(bigFiles.json, "utf8"));
  assert.equal(record.truncated, false);
  const interleaved = record.interleave.reduce((total, pair) => total + pair[1], 0);
  assert.equal(interleaved, size);
});

test("in-memory text truncates past the cap while files keep everything", () => {
  const base = runnerWith({});
  const record = helpers.cmNewRecord({ id: helpers.cmRunId(Date.now(), () => 0.5), argv: ["plan"] });
  const runsDir = base.runner.runsDir();
  helpers.cmEnsureRunsDir(fs, runsDir);
  const outPath = path.join(runsDir, record.id + ".out");
  fs.writeFileSync(outPath, "y".repeat(5 * 1024 * 1024));
  const fd = fs.openSync(outPath, "r");
  const state = {
    spec: { record }, outFd: fd, errFd: -1,
    stdout: "", stderr: "", outOffset: 0, errOffset: 0,
    stdoutDecoder: base.runner.makeDecoder(), stderrDecoder: null, truncated: false,
  };
  base.runner.drainOneTail(state, "out", fs);
  fs.closeSync(fd);
  assert.equal(state.truncated, true);
  assert.equal(record.truncated, true);
  assert.equal(state.stdout.length, helpers.CM_MEM_CAP_BYTES);
});

test("a double run is one run: duplicates share the settlement", async () => {
  let spawns = 0;
  const base = runnerWith({ FAKE_BOB_SLEEP_MS: "300", FAKE_BOB_STDOUT: "slow\n" });
  const real = base.runner.childProcess();
  base.runner.deps.childProcess = {
    spawn: (...args) => {
      spawns += 1;
      return real.spawn(...args);
    },
  };
  const [first, second] = await Promise.all([
    base.runner.run(["plan"]),
    base.runner.run(["plan"]),
  ]);
  assert.equal(spawns, 1);
  assert.equal(first.runId, second.runId);
  assert.equal(second.duplicate, true);
  assert.equal(first.outcome, "completed");
});

test("writers serialize FIFO while reads run in parallel", async () => {
  const catalog = richCatalog();
  const base = runnerWith({ FAKE_BOB_SLEEP_MS: "400" }, { catalog });
  const spawnTimes = [];
  const real = base.runner.childProcess();
  base.runner.deps.childProcess = {
    spawn: (...args) => {
      spawnTimes.push(Date.now());
      return real.spawn(...args);
    },
  };
  const start = Date.now();
  const [w1, w2] = await Promise.all([
    base.runner.run(["slow", "write"], { title: "w1" }),
    base.runner.run(["slow", "write", "again"], { title: "w2" }),
  ]);
  assert.equal(w1.outcome, "completed");
  assert.equal(w2.outcome, "completed");
  assert.equal(spawnTimes.length, 2);
  assert.ok(spawnTimes[1] - spawnTimes[0] >= 300, "writers ran in parallel");

  const reads = runnerWith({ FAKE_BOB_SLEEP_MS: "300" });
  const begun = Date.now();
  const [r1, r2] = await Promise.all([reads.runner.run(["plan"]), reads.runner.run(["ready"])]);
  assert.equal(r1.outcome, "completed");
  assert.equal(r2.outcome, "completed");
  assert.ok(Date.now() - begun < 590, "reads did not overlap");
  void start;
});

test("a failed save refuses the writer", async () => {
  const base = runnerWith({}, {
    saveAllMarkdown: () => Promise.resolve({ ok: false, path: "note.md" }),
  });
  const settled = await base.runner.run(["ref", "create", "u"]);
  assert.equal(settled.ok, false);
  assert.match(settled.reason, /Could not save `note\.md`; run refused/);
});

test("read budgets kill; writer budgets mark overdue; stop stops", async () => {
  const catalog = richCatalog();
  const timeout = runnerWith({ FAKE_BOB_SLEEP_MS: "5000" }, { catalog });
  const slow = await timeout.runner.run(["plan", "budget"]);
  assert.equal(slow.ok, false);
  assert.equal(slow.outcome, "failed");
  assert.match(slow.reason, /Timed out/);

  const overdue = runnerWith({ FAKE_BOB_SLEEP_MS: "1200" }, { catalog });
  const finished = await overdue.runner.run(["slow", "write"]);
  assert.equal(finished.ok, true);
  assert.equal(finished.outcome, "completed");
  const record = JSON.parse(fs.readFileSync(runPaths(overdue, finished.runId).json, "utf8"));
  assert.equal(record.overdue, true);

  const stoppable = runnerWith({ FAKE_BOB_SLEEP_MS: "10000" }, { catalog });
  const pending = stoppable.runner.run(["plan"]);
  await new Promise((resolve) => setTimeout(resolve, 150));
  const runId = stoppable.runner.lastRunId;
  assert.equal(stoppable.runner.stop(runId).ok, true);
  const stopped = await pending;
  assert.equal(stopped.outcome, "stopped");
  assert.equal(stoppable.runner.stop(runId).ok, false);
});

test("failures classify: non-zero, signals, lock, and missing bob", async () => {
  const failing = runnerWith({ FAKE_BOB_EXIT: "1", FAKE_BOB_STDERR: "error: boom\n" });
  const failed = await failing.runner.run(["plan"]);
  assert.equal(failed.outcome, "failed");
  assert.equal(failed.reason, "error: boom");

  const signaled = runnerWith({ FAKE_BOB_SIGNAL: "SIGTERM", FAKE_BOB_SLEEP_MS: "50" });
  const killed = await signaled.runner.run(["plan"]);
  assert.equal(killed.outcome, "failed");
  assert.match(killed.reason, /signal SIGTERM/);

  const locked = runnerWith({
    FAKE_BOB_EXIT: "0",
    FAKE_BOB_STDERR: "another Bob vault maintenance run is already active\n",
  });
  const attention = await locked.runner.run(["plan"]);
  assert.equal(attention.outcome, "attention");
  assert.match(attention.reason, /holds the lock/);

  const missing = makeRunner({});
  missing.runner.deps.resolveBob = () => ({ path: "/nonexistent/bob-xyz", source: "candidate", tried: ["/nonexistent/bob-xyz"] });
  const notFound = await missing.runner.run(["plan"]);
  assert.equal(notFound.outcome, "failed");
  assert.match(notFound.reason, /bob not found.*\/nonexistent\/bob-xyz/);
});

test("policy and entry guards refuse with reasons", async () => {
  const base = runnerWith({}, { catalog: richCatalog() });
  const excluded = await base.runner.run(["capture", "hello"]);
  assert.equal(excluded.ok, false);
  assert.match(excluded.reason, /named capture rows/);

  const namedCatalog = fixtureCatalog();
  namedCatalog.entries = [...namedCatalog.entries, {
    id: "pomodoro-start", path: ["capture"], fixed: ["="], title: "Start next Pomodoro",
    about: "Start", section: "daily", keywords: ["pomodoro", "start"],
    effect: "writes", network: false, presentation: "action",
    policy: "run", preview: null, confirm: null, budget_secs: 60,
    args: [], exit_codes: [], adapter: null, hosts: [], invalidates: [],
  }];
  const named = runnerWith({ FAKE_BOB_EXIT: "0" }, { catalog: namedCatalog });
  const namedRow = await named.runner.run(["capture", "="], { entryId: "pomodoro-start", title: "Start next Pomodoro" });
  assert.equal(namedRow.ok, true, namedRow.reason || "named capture row refused");

  const confirm = await base.runner.run(["task", "archive"]);
  assert.equal(confirm.ok, false);
  assert.equal(confirm.reason, "Archive every done task?");

  const preview = await base.runner.run(["ref", "rename", "a", "b"]);
  assert.equal(preview.ok, false);
  assert.match(preview.reason, /preview/i);

  const applied = await base.runner.run(["ref", "rename", "a", "b"], { preview: true });
  assert.equal(applied.ok, true);
  const appliedRecord = JSON.parse(fs.readFileSync(runPaths(base, applied.runId).json, "utf8"));
  assert.deepEqual(appliedRecord.argv, [FAKE_BOB, "ref", "rename", "--dry-run", "a", "b"]);
  assert.equal(appliedRecord.preview, true);

  const noVault = runnerWith({}, { vaultBase: null });
  assert.match((await noVault.runner.run(["plan"])).reason, /local vault/);

  const win32 = runnerWith({}, { deps: { isWin32: true } });
  assert.match((await win32.runner.run(["plan"])).reason, /Linux and macOS/);
});

test("retention keeps the newest fifty and never an unfinished run", async () => {
  const base = runnerWith({});
  const runsDir = base.runner.runsDir();
  for (let index = 0; index < 60; index += 1) {
    const record = helpers.cmNewRecord({
      id: "20200101-000000-a" + String(index).padStart(3, "0").slice(-3),
      argv: ["plan"],
      startedAt: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
    });
    record.outcome = "completed";
    record.finished_at = record.started_at;
    helpers.cmWriteRecord(fs, runsDir, record);
  }
  const live = helpers.cmNewRecord({ id: "20200102-000000-live", argv: ["plan"] });
  helpers.cmWriteRecord(fs, runsDir, live);
  const settled = await base.runner.run(["plan"]);
  assert.equal(settled.ok, true);
  const records = helpers.cmListRecords(fs, runsDir);
  assert.equal(records.length, 50);
  assert.ok(records.some((record) => record.id === "20200102-000000-live"));
});

test("adoption finalizes from receipts and reports unknown without one", async () => {
  const first = runnerWith({});
  const runsDir = first.runner.runsDir();
  const done = helpers.cmNewRecord({ id: helpers.cmRunId(Date.now(), () => 0.1), argv: [FAKE_BOB, "plan"] });
  helpers.cmWriteRecord(fs, runsDir, done);
  fs.writeFileSync(path.join(runsDir, done.id + ".out"), "recovered\n");
  fs.writeFileSync(path.join(runsDir, done.id + ".rc"), JSON.stringify({ schema_version: 1, exit_code: 0, finished_at: new Date().toISOString() }));
  const adopted = first.runner.adoptUnfinished();
  assert.equal(adopted[0].outcome, "completed");
  assert.equal(first.notified.length, 0);
  const record = JSON.parse(fs.readFileSync(path.join(runsDir, done.id + ".json"), "utf8"));
  assert.equal(record.outcome, "completed");
  assert.equal(record.summary, "recovered");

  const second = runnerWith({});
  const lost = helpers.cmNewRecord({
    id: helpers.cmRunId(Date.now() - 10 * 60 * 1000, () => 0.2),
    argv: [FAKE_BOB, "plan"],
    startedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  });
  lost.effect = "reads";
  const secondDir = second.runner.runsDir();
  helpers.cmWriteRecord(fs, secondDir, lost);
  const late = second.runner.adoptUnfinished();
  assert.equal(late[0].outcome, "unknown");
  assert.equal(second.notified.length, 1);
  const lostRecord = JSON.parse(fs.readFileSync(path.join(secondDir, lost.id + ".json"), "utf8"));
  assert.equal(lostRecord.outcome, "unknown");
  assert.equal(lostRecord.summary, "Unknown — log preserved");
});
