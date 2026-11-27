const assert = require("node:assert/strict");
const test = require("node:test");
const {
  NavigationHotkeysPlugin,
  helpers,
} = require("./navigation-hotkeys-harness.cjs");

const DAILY = "daily/2026-11-27.md";
const TASK_PATH = "projects/job.md";
const TASK_LINE = "- [ ] #task Email Dan ^email-dan\n";
const DAY_BASE = "## Pomodoros\n\n- [ ] () — WRITE\n";

function taskRecord(overrides = {}) {
  return {
    path: TASK_PATH,
    route: TASK_PATH,
    block: "email-dan",
    blockId: "email-dan",
    target: "projects/job",
    status: " ",
    is_task: true,
    is_event: false,
    blocked: false,
    contents: TASK_LINE,
    line: 1,
    link: "[[projects/job#^email-dan]]",
    ...overrides,
  };
}

function resolutionFor(task) {
  return {
    ok: true,
    kind: "definition",
    task,
    identity: { route: TASK_PATH, block: task.block || task.blockId },
    needsNaming: false,
    sourcePath: task.path,
  };
}

// Minimal BIP-shaped stub: promotes a Ready line, keeps everything else.
function stubPlanTargetTaskUpdate(content, line) {
  const lines = String(content).split("\n");
  lines[line] = String(lines[line] || "").replace("- [ ]", "- [*]");
  return { content: lines.join("\n") };
}

function memoryIo(files, openPaths = [], failOn = new Set()) {
  const calls = { writeOpen: [], writeClosed: [] };
  return {
    calls,
    files,
    read: async (path) => (files.has(path) ? files.get(path) : null),
    isOpen: (path) => openPaths.includes(path),
    writeOpen: async (path, before, after) => {
      calls.writeOpen.push(path);
      if (failOn.has(path)) throw new Error("open write failed: " + path);
      files.set(path, after);
      return after;
    },
    writeClosed: async (path, before, after) => {
      calls.writeClosed.push(path);
      if (failOn.has(path)) throw new Error("closed write failed: " + path);
      if (files.get(path) !== before) throw new Error("preimage changed: " + path);
      files.set(path, after);
      return after;
    },
  };
}

function runOptions(io, overrides = {}) {
  const today = new NavigationHotkeysPlugin().getFreshnessDateText();
  return {
    action: "add",
    when: "+30m",
    dailyPath: DAILY,
    dayText: today,
    clock: { date: today, now: "13:00", zone: "UTC", freshDateText: today },
    planTargetTaskUpdate: stubPlanTargetTaskUpdate,
    io,
    ...overrides,
  };
}

test("add commits cross-note plans through one write per note", async () => {
  const plugin = new NavigationHotkeysPlugin();
  const files = new Map([[DAILY, DAY_BASE], [TASK_PATH, TASK_LINE]]);
  const io = memoryIo(files);
  const outcome = await plugin.runSnoozeCommit(resolutionFor(taskRecord()), runOptions(io));
  assert.equal(outcome.ok, true);
  assert.deepEqual([...outcome.wrote].sort(), [DAILY, TASK_PATH].sort());
  assert.equal(io.calls.writeClosed.length, 2);
  assert.match(files.get(TASK_PATH), /- \[\*\]/);
  assert.match(files.get(DAILY), /- \*\*1330\*\* \[\[projects\/job#\^email-dan\]\]/);
});

test("same-note task and daily edits compose into one write", async () => {
  const plugin = new NavigationHotkeysPlugin();
  const task = taskRecord({ path: DAILY, route: DAILY, contents: DAY_BASE + "- [ ] #task Email Dan ^email-dan\n", line: 4 });
  const files = new Map([[DAILY, task.contents]]);
  const io = memoryIo(files, [DAILY]);
  const outcome = await plugin.runSnoozeCommit(
    { ...resolutionFor(task), sourcePath: DAILY },
    runOptions(io, { taskContents: task.contents }),
  );
  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.wrote, [DAILY]);
  assert.equal(io.calls.writeOpen.length, 1);
});

test("drop removes the active row without touching the task", async () => {
  const plugin = new NavigationHotkeysPlugin();
  const day = `${DAY_BASE}\n## Snoozed\n\n- **1330** [[projects/job#^email-dan]]\n`;
  const files = new Map([[DAILY, day]]);
  const io = memoryIo(files);
  const outcome = await plugin.runSnoozeCommit(
    resolutionFor(taskRecord({ status: "*" })),
    runOptions(io, { action: "drop", dailyContents: day }),
  );
  assert.equal(outcome.ok, true);
  assert.ok(!files.get(DAILY).includes("**1330**"));
});

test("stale preimages refuse before any write", async () => {
  const plugin = new NavigationHotkeysPlugin();
  const files = new Map([[DAILY, "changed under us\n"]]);
  const io = memoryIo(files);
  const outcome = await plugin.commitSnoozePlans(
    [{ path: DAILY, preimage: DAY_BASE, postimage: `${DAY_BASE}\n## Snoozed\n` }],
    io,
  );
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, "stale");
  assert.equal(io.calls.writeClosed.length, 0);
  assert.equal(files.get(DAILY), "changed under us\n");
});

test("default closed-note writer resolves the file and uses vault.process", async () => {
  const plugin = new NavigationHotkeysPlugin();
  const after = `${DAY_BASE}\n## Snoozed\n\n- **1330** [[projects/job#^email-dan]]\n`;
  const file = { path: DAILY };
  const files = new Map([[DAILY, DAY_BASE]]);
  const calls = [];
  plugin.app = {
    vault: {
      getAbstractFileByPath: (path) => path === DAILY ? file : null,
      async process(target, transform) {
        calls.push(target);
        files.set(target.path, transform(files.get(target.path)));
      },
    },
  };
  plugin.getOpenMarkdownEditorForPath = () => null;
  const outcome = await plugin.commitSnoozePlans(
    [{ path: DAILY, preimage: DAY_BASE, postimage: after }],
    { read: async (path) => files.get(path) ?? null, isOpen: () => false },
  );
  assert.equal(outcome.ok, true);
  assert.deepEqual(calls, [file]);
  assert.equal(files.get(DAILY), after);
});

test("confirmation across midnight refuses", async () => {
  const plugin = new NavigationHotkeysPlugin();
  const files = new Map([[DAILY, DAY_BASE], [TASK_PATH, TASK_LINE]]);
  const io = memoryIo(files);
  const outcome = await plugin.runSnoozeCommit(
    resolutionFor(taskRecord()),
    runOptions(io, { dayText: "2000-01-01" }),
  );
  assert.equal(outcome.ok, false);
  assert.equal(outcome.refusal, "day_changed");
  assert.equal(io.calls.writeClosed.length, 0);
});

test("repeat submits refuse while a run is in flight", async () => {
  const plugin = new NavigationHotkeysPlugin();
  plugin.snoozeRuntimeInFlight = true;
  try {
    const outcome = await plugin.runSnoozeCommit(resolutionFor(taskRecord()), runOptions(memoryIo(new Map())));
    assert.equal(outcome.ok, false);
    assert.equal(outcome.refusal, "busy");
  } finally {
    plugin.snoozeRuntimeInFlight = false;
  }
});

test("second-write failure rolls back only the intact first write", async () => {
  const plugin = new NavigationHotkeysPlugin();
  const files = new Map([[DAILY, DAY_BASE], [TASK_PATH, TASK_LINE]]);
  const io = memoryIo(files, [], new Set([DAILY]));
  // Force task-first write order by listing it first via a local plan list.
  const planned = helpers.snoozeMutationPlanner.plan({
    action: "add",
    when: "+30m",
    day: DAY_BASE,
    dailyPath: DAILY,
    task: { ...taskRecord(), contents: TASK_LINE },
    newBlockId: "",
    identities: [],
    clock: { date: "2026-11-25", now: "13:00", zone: "UTC", freshDateText: "2026-11-25" },
    nowInstant: new Date("2026-11-25T13:00:00Z"),
    freshDateText: "2026-11-25",
    stampLine: undefined,
    planTargetTaskUpdate: stubPlanTargetTaskUpdate,
  });
  assert.equal(planned.ok, true);
  const outcome = await plugin.commitSnoozePlans(planned.plans.slice().reverse(), io);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, "write");
  assert.equal(files.get(TASK_PATH), TASK_LINE);
});

test("rollback never overwrites a concurrent edit", async () => {
  const plugin = new NavigationHotkeysPlugin();
  const files = new Map([[DAILY, DAY_BASE], [TASK_PATH, TASK_LINE]]);
  const io = memoryIo(files);
  const planned = helpers.snoozeMutationPlanner.plan({
    action: "add",
    when: "+30m",
    day: DAY_BASE,
    dailyPath: DAILY,
    task: { ...taskRecord(), contents: TASK_LINE },
    newBlockId: "",
    identities: [],
    clock: { date: "2026-11-25", now: "13:00", zone: "UTC", freshDateText: "2026-11-25" },
    nowInstant: new Date("2026-11-25T13:00:00Z"),
    freshDateText: "2026-11-25",
    stampLine: undefined,
    planTargetTaskUpdate: stubPlanTargetTaskUpdate,
  });
  assert.equal(planned.ok, true);
  const ordered = planned.plans.slice().reverse();
  const failing = {
    ...io,
    writeClosed: async (path, before, after) => {
      if (path === ordered[1].path) {
        files.set(ordered[0].path, "concurrent user edit\n");
        throw new Error("closed write failed");
      }
      return io.writeClosed(path, before, after);
    },
  };
  const outcome = await plugin.commitSnoozePlans(ordered, failing);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, "partial-write");
  assert.equal(files.get(ordered[0].path), "concurrent user edit\n");
});

test("add never spawns a subprocess", async () => {
  const plugin = new NavigationHotkeysPlugin();
  const files = new Map([[DAILY, DAY_BASE], [TASK_PATH, TASK_LINE]]);
  const io = memoryIo(files);
  const outcome = await plugin.runSnoozeCommit(
    resolutionFor(taskRecord()),
    runOptions(io, { spawn: async () => { throw new Error("must not spawn on add"); } }),
  );
  assert.equal(outcome.ok, true);
});

function wakeResolution() {
  return {
    ok: true,
    kind: "snoozed-row",
    task: null,
    identity: { route: "projects/job.md", block: "email-dan" },
    needsNaming: false,
    sourcePath: DAILY,
    row: { hhmm: "1530", minutes: 930, target: "projects/job", blockId: "email-dan" },
  };
}

function wokeReport(notified) {
  return {
    ok: true,
    report: {
      schema_version: 1,
      date: "2026-11-27",
      now: "2026-11-27T15:30:00Z",
      status: "woke",
      daily_file: "daily/2026-11-27.md",
      notified,
      wake_id: null,
      woken: [{
        title: "Email Dan", route: "projects/job.md", block_id: "email-dan",
        target: "1530", woke_at: "15:30",
        destination: { line: 4, name: "WRITE", created: false }, over_cap: false,
      }],
      dropped: [],
      ignored: [],
      pending: [],
      next_wake_at: null,
      plan: { count: 1, cap: 10, over: false },
    },
  };
}

test("wake now passes argv and notifies once for unannounced wokes", async () => {
  const plugin = new NavigationHotkeysPlugin();
  let refreshed = false;
  plugin.onSnoozeRuntimeCommitted = async () => { refreshed = true; };
  const seen = { argv: null, notices: [] };
  const outcome = await plugin.wakeSnoozeNow(wakeResolution(), {
    notes: [DAILY],
    saveNotes: async () => ({ ok: true }),
    spawn: async (argv) => {
      seen.argv = argv;
      return { spawned: true, result: wokeReport("none") };
    },
    notify: (text) => { seen.notices.push(text); },
  });
  assert.equal(outcome.ok, true);
  assert.deepEqual(seen.argv, ["snooze", "wake", "[[projects/job.md#^email-dan]]", "-q", "-f", "json"]);
  assert.equal(seen.notices.length, 1);
  assert.match(seen.notices[0], /Ready now/);
  assert.equal(refreshed, true);
});

test("wake now stays silent when the vault already announced", async () => {
  const plugin = new NavigationHotkeysPlugin();
  const seen = { notices: 0 };
  const outcome = await plugin.wakeSnoozeNow(wakeResolution(), {
    notes: [DAILY],
    saveNotes: async () => ({ ok: true }),
    spawn: async () => ({ spawned: true, result: wokeReport("desktop") }),
    notify: () => { seen.notices += 1; },
  });
  assert.equal(outcome.ok, true);
  assert.equal(seen.notices, 0);
});

test("wake now refuses dirty notes, timeouts, and old bob without writing", async () => {
  const plugin = new NavigationHotkeysPlugin();
  let spawned = 0;
  const dirty = await plugin.wakeSnoozeNow(wakeResolution(), {
    saveNotes: async () => ({ ok: false, unverifiable: true }),
    spawn: async () => { spawned += 1; return { spawned: true, result: wokeReport("none") }; },
  });
  assert.equal(dirty.ok, false);
  assert.equal(dirty.refusal, "dirty");
  assert.equal(spawned, 0);
  const timedOut = await plugin.wakeSnoozeNow(wakeResolution(), {
    saveNotes: async () => ({ ok: true }),
    spawn: async () => ({ spawned: true, result: { ok: false, timeout: true } }),
  });
  assert.equal(timedOut.refusal, "timeout");
  const old = await plugin.wakeSnoozeNow(wakeResolution(), {
    saveNotes: async () => ({ ok: true }),
    spawn: async () => ({ spawned: true, result: { ok: false, message: "unknown subcommand 'snooze'" } }),
  });
  assert.equal(old.refusal, "unsupported");
  const nothing = await plugin.wakeSnoozeNow(wakeResolution(), {
    saveNotes: async () => ({ ok: true }),
    spawn: async () => ({ spawned: true, result: { ok: true, report: { status: "nothing_due" } } }),
  });
  assert.equal(nothing.ok, false);
  assert.equal(nothing.refusal, "nothing_due");
});
