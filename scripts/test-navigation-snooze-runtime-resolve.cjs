const assert = require("node:assert/strict");
const test = require("node:test");
const { helpers } = require("./navigation-hotkeys-harness.cjs");

const {
  resolveSnoozeCursorTarget,
  projectSnoozeWakeDestination,
  buildSnoozeCardFacts,
  interpretSnoozeWakeReport,
} = helpers;

const DAILY = "daily/2026-11-27.md";
const TASK = {
  path: "projects/job.md",
  route: "projects/job.md",
  block: "email-dan",
  blockId: "email-dan",
  target: "projects/job",
  status: "*",
  is_task: true,
  is_event: false,
  blocked: false,
};

function baseSnapshot(overrides = {}) {
  return {
    sourcePath: "projects/job.md",
    sourceContents: "- [*] #task Email Dan ^email-dan\n",
    cursorLine: 0,
    dailyPath: DAILY,
    explicitTargets: null,
    tasks: [{ ...TASK, line: 0 }],
    identities: [],
    ...overrides,
  };
}

test("definition context resolves an open task at the cursor", () => {
  const result = resolveSnoozeCursorTarget(baseSnapshot());
  assert.equal(result.ok, true);
  assert.equal(result.kind, "definition");
  assert.deepEqual(result.identity, { route: "projects/job.md", block: "email-dan" });
});

test("definition without a block id asks for naming, not a guess", () => {
  const result = resolveSnoozeCursorTarget(baseSnapshot({
    tasks: [{ ...TASK, line: 0, block: "", blockId: "" }],
  }));
  assert.equal(result.ok, false);
  assert.equal(result.refusal, "needs_naming");
});

test("definition refuses event, blocked, done, and cancelled tasks", () => {
  for (const [patch, refusal] of [
    [{ is_event: true }, "event_task"],
    [{ blocked: true }, "blocked"],
    [{ status: "?" }, "blocked"],
    [{ status: "x" }, "done"],
    [{ status: "-" }, "cancelled"],
    [{ is_task: false }, "not_task"],
  ]) {
    const result = resolveSnoozeCursorTarget(baseSnapshot({ tasks: [{ ...TASK, line: 0, ...patch }] }));
    assert.equal(result.ok, false, JSON.stringify(patch));
    assert.equal(result.refusal, refusal, JSON.stringify(patch));
  }
});

test("task card sessions need exactly one task", () => {
  assert.equal(resolveSnoozeCursorTarget(baseSnapshot({ explicitTargets: [] })).refusal, "missing_task");
  assert.equal(resolveSnoozeCursorTarget(baseSnapshot({ explicitTargets: [{ ...TASK }, { ...TASK }] })).refusal, "multi_task");
  const single = resolveSnoozeCursorTarget(baseSnapshot({ explicitTargets: [{ ...TASK }] }));
  assert.equal(single.ok, true);
  assert.equal(single.kind, "definition");
});

test("live link resolves with its source pomodoro", () => {
  const daily = "## Pomodoros\n\n- [ ] () — WRITE\n\t- [[projects/job#^email-dan]]\n";
  const result = resolveSnoozeCursorTarget(baseSnapshot({
    sourcePath: DAILY,
    sourceContents: daily,
    cursorLine: 3,
    dailyPath: DAILY,
    tasks: [],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.kind, "live-link");
  assert.deepEqual(result.identity, { route: "projects/job", block: "email-dan" });
  assert.equal(result.sourcePomodoro, "WRITE");
});

test("empty-target link resolves to the source note without an alias map", () => {
  const daily = "## Pomodoros\n\n- [ ] () — WRITE\n\t- [[#^same-note]]\n";
  const result = resolveSnoozeCursorTarget(baseSnapshot({
    sourcePath: DAILY,
    sourceContents: daily,
    cursorLine: 3,
    dailyPath: DAILY,
    tasks: [],
    identities: [],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.kind, "live-link");
  assert.deepEqual(result.identity, { route: DAILY, block: "same-note" });
});

test("woken link keeps its wake time", () => {
  const daily = "## Pomodoros\n\n- [ ] () — WRITE\n\t- [[projects/job#^email-dan]] ⏰ woke 15:30\n";
  const result = resolveSnoozeCursorTarget(baseSnapshot({
    sourcePath: DAILY,
    sourceContents: daily,
    cursorLine: 3,
    dailyPath: DAILY,
    tasks: [],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.kind, "woken-link");
  assert.equal(result.wakeTime, "15:30");
});

test("struck history link identifies without eligibility", () => {
  const contents = "## Log\n\n- ~~[[projects/job#^email-dan]]~~\n";
  const result = resolveSnoozeCursorTarget(baseSnapshot({
    sourcePath: "projects/log.md",
    sourceContents: contents,
    cursorLine: 2,
    tasks: [],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.kind, "history-link");
  assert.equal(result.historical, true);
});

test("cursor on an active snoozed row resolves the row", () => {
  const daily = "## Pomodoros\n\n- [ ] () — WRITE\n\n## Snoozed\n\n- **1530** [[projects/job#^email-dan]]\n";
  const result = resolveSnoozeCursorTarget(baseSnapshot({
    sourcePath: DAILY,
    sourceContents: daily,
    cursorLine: 6,
    dailyPath: DAILY,
    tasks: [],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.kind, "snoozed-row");
  assert.equal(result.row.hhmm, "1530");
});

test("ambiguous aliases refuse instead of guessing", () => {
  const daily = "## Pomodoros\n\n- [ ] () — WRITE\n\t- [[job#^email-dan]]\n";
  const identities = [
    { target: "job", block: "email-dan", route: "projects/job.md" },
    { target: "job", block: "email-dan", route: "archive/job.md" },
  ];
  const result = resolveSnoozeCursorTarget(baseSnapshot({
    sourcePath: DAILY,
    sourceContents: daily,
    cursorLine: 3,
    dailyPath: DAILY,
    tasks: [],
    identities,
  }));
  assert.equal(result.ok, false);
  assert.equal(result.refusal, "ambiguous_target");
});

test("prose mentions and fences refuse", () => {
  const prose = "- [ ] () — WRITE\n\t- see [[projects/job#^email-dan]] for context\n";
  assert.equal(resolveSnoozeCursorTarget(baseSnapshot({
    sourcePath: DAILY, sourceContents: prose, cursorLine: 1, dailyPath: DAILY, tasks: [],
  })).refusal, "prose_mention");
  const fenced = "```\n- [*] #task Email Dan ^email-dan\n```\n";
  assert.equal(resolveSnoozeCursorTarget(baseSnapshot({
    sourceContents: fenced, cursorLine: 1, tasks: [{ ...TASK, line: 1 }],
  })).refusal, "fenced");
});

test("wake destination prefers untimed exact, then containing, then a placeholder", () => {
  const running = { name: "WRITE", open: true, running: true };
  const untimedExact = { name: "WRITE", open: true, running: false };
  const containing = { name: "DEEP+WRITE", open: true, running: false };
  assert.deepEqual(
    projectSnoozeWakeDestination({ entries: [running, untimedExact], typeKey: "write", typeName: "WRITE" }),
    { kind: "entry", name: "WRITE", created: false },
  );
  assert.deepEqual(
    projectSnoozeWakeDestination({ entries: [running, containing], typeKey: "write", typeName: "WRITE" }).name,
    "DEEP+WRITE",
  );
  assert.deepEqual(
    projectSnoozeWakeDestination({ entries: [running], typeKey: "write", typeName: "WRITE" }),
    { kind: "create", name: "WRITE", created: true },
  );
});

test("wake destination without a type uses the first untimed entry or a bare fallback", () => {
  assert.deepEqual(
    projectSnoozeWakeDestination({ entries: [{ name: "A", open: true, running: true }, { name: "B", open: false, running: false }, { name: "C", open: true, running: false }] }),
    { kind: "entry", name: "C", created: false },
  );
  assert.deepEqual(
    projectSnoozeWakeDestination({ entries: [] }),
    { kind: "create", name: null, created: true },
  );
});

test("card facts mark missing providers unavailable without inventing data", () => {
  const facts = buildSnoozeCardFacts({ wantCounts: true, wantTask: true, wantRow: true });
  assert.ok(facts.unavailable.includes("plan-budget"));
  assert.ok(facts.unavailable.includes("task"));
  assert.ok(facts.unavailable.includes("zone"));
  assert.equal(facts.counts, null);
  assert.deepEqual(
    buildSnoozeCardFacts({ onClock: { count: 13, cap: 10 } }).counts,
    { count: 13, cap: 10, over: true },
  );
});

test("wake report policy notifies only for unannounced wokes", () => {
  const woke = (notified) => ({
    ok: true,
    report: {
      schema_version: 1, date: "2026-11-27", now: "2026-11-27T15:30:00Z",
      status: "woke", daily_file: "d.md", notified, wake_id: null,
      woken: [{ title: "Email Dan", route: "r", block_id: "b", target: "1530", woke_at: "15:30", destination: { line: 4, name: "WRITE", created: false }, over_cap: false }],
      dropped: [], ignored: [], pending: [], next_wake_at: null,
      plan: { count: 1, cap: 10, over: false },
    },
  });
  const announced = interpretSnoozeWakeReport({ decoded: woke("none") });
  assert.equal(announced.outcome, "woke");
  assert.equal(announced.notice, true);
  assert.equal(announced.refresh, true);
  assert.match(announced.noticeText, /Ready now/);
  const already = interpretSnoozeWakeReport({ decoded: woke("desktop") });
  assert.equal(already.notice, false);
  assert.equal(already.refresh, true);
  for (const status of ["nothing_due", "skipped"]) {
    const quiet = interpretSnoozeWakeReport({ decoded: { ok: true, report: { status } } });
    assert.equal(quiet.notice, false);
    assert.equal(quiet.refresh, false);
  }
  assert.equal(interpretSnoozeWakeReport({ decoded: { ok: true, report: { status: "deferred" } } }).outcome, "deferred");
  assert.equal(interpretSnoozeWakeReport({ decoded: { ok: false, code: "bad-json" } }).outcome, "invalid");
  assert.equal(interpretSnoozeWakeReport({ timeout: true }).outcome, "timeout");
  assert.equal(interpretSnoozeWakeReport({ unsupported: true }).outcome, "unsupported");
  assert.equal(interpretSnoozeWakeReport({ unavailable: true }).outcome, "unavailable");
});
