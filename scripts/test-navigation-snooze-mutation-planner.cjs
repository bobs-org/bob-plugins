const assert = require("node:assert/strict");
const test = require("node:test");
const { helpers: navigation } = require("./navigation-hotkeys-harness.cjs");
const { helpers: blockIdPrompt } = require("./block-id-prompt-harness.cjs");

const planner = navigation.snoozeMutationPlanner;
const date = "2026-11-25";
const nowInstant = new Date(`${date}T13:00:00Z`);
const stampLine = (line, day) => line.includes("#task") && !line.includes("[fresh::")
  ? line.replace(/([ \t]+\^[A-Za-z0-9-]+[ \t]*)$/, ` [fresh:: ${day}]$1`).replace(/#task(?=\s|$)/, "#task")
  : line;
const api = blockIdPrompt.createSnoozePlanningApi({});
const planTargetTaskUpdate = (content, line, options) => api.planTargetTaskUpdate(content, line, {
  ...options,
  now: nowInstant,
  freshDateText: date,
  stampLine,
});

function baseInput(overrides = {}) {
  const task = {
    path: "Projects/job.md",
    contents: "- [*] #task Email Dan ^email-dan\n",
    line: 1,
    route: "Projects/job.md",
    block: "email-dan",
    target: "Projects/job",
    status: "*",
    is_task: true,
    is_event: false,
    blocked: false,
    type_key: "write",
    type_name: "WRITE",
    link: "[[Projects/job#^email-dan]]",
  };
  return {
    action: "add",
    day: "## Pomodoros\n\n- [ ] () — WRITE\n",
    when: "1530",
    dailyPath: "2026/20261125.md",
    task,
    clock: { date, now: "13:00", zone: "UTC", nowInstant, freshDateText: date },
    nowInstant,
    freshDateText: date,
    stampLine,
    planTargetTaskUpdate,
    ...overrides,
    task: { ...task, ...(overrides.task || {}) },
  };
}

test("ambiguous task-link aliases are never removed by basename guessing", () => {
  const input = baseInput({
    day: "## Pomodoros\n\n- [ ] () — WRITE\n\t- [[job#^email-dan]]\n",
    identities: [
      { target: "job", block: "email-dan", route: "Projects/job.md" },
      { target: "job", block: "email-dan", route: "Archive/job.md" },
    ],
  });
  const result = planner.plan(input);
  assert.equal(result.ok, true);
  const postimage = result.plans[0].postimage;
  assert.match(postimage, /\[\[job#\^email-dan\]\]/, "ambiguous ledger link remains in place");
  assert.match(postimage, /## Snoozed\n\n- \*\*1530\*\* \[\[Projects\/job#\^email-dan\]\]/);
});

test("drop refuses to match an ambiguous alias", () => {
  const input = baseInput({
    action: "drop",
    day: "## Pomodoros\n\n## Snoozed\n\n- **1530** [[job#^email-dan]]\n",
    identities: [
      { target: "job", block: "email-dan", route: "Projects/job.md" },
      { target: "job", block: "email-dan", route: "Archive/job.md" },
    ],
  });
  const result = planner.plan(input);
  assert.equal(result.refusal, "not_snoozed");
  assert.equal(result.plans.length, 0);
});

test("local links resolve only when the task note is today's daily note", () => {
  const input = baseInput({
    dailyPath: "2026/20261125.md",
    task: { target: "", link: "[[Projects/job#^email-dan]]" },
    day: "## Pomodoros\n\n- [ ] () — WRITE\n\t- [[#^email-dan]]\n",
  });
  const result = planner.plan(input);
  assert.equal(result.ok, true);
  assert.match(result.plans[0].postimage, /- \[ \] \(\) — WRITE\n\t- \[\[#\^email-dan\]\]/);
  assert.match(result.plans[0].postimage, /- \*\*1530\*\* \[\[Projects\/job#\^email-dan\]\]/);
});

test("CRLF notes retain their line endings while adding and dropping a row", () => {
  const input = baseInput({
    day: "## Pomodoros\r\n\r\n- [ ] () — WRITE\r\n",
  });
  const added = planner.plan(input);
  assert.equal(added.ok, true);
  assert.ok(added.plans[0].postimage.includes("\r\n## Snoozed\r\n\r\n- **1530**"));
  assert.equal(added.plans[0].postimage.includes("\n") && !added.plans[0].postimage.includes("\r\n"), false);
  const dropped = planner.plan({ ...input, action: "drop", day: added.plans[0].postimage });
  assert.equal(dropped.ok, true);
  assert.ok(dropped.plans[0].postimage.includes("\r\n"));
  assert.doesNotMatch(dropped.plans[0].postimage, /## Snoozed/);
});

test("new section ignores fenced headings and stays before the following H2", () => {
  const input = baseInput({
    day: "---\n## Pomodoros\n---\n\n```md\n## Pomodoros\n```\n\n## Pomodoros\n\n- [ ] () — WRITE\n\n## Notes\n\nKeep this paragraph.\n",
  });
  const result = planner.plan(input);
  assert.equal(result.ok, true);
  assert.match(result.plans[0].postimage, /## Pomodoros\n\n- \[ \] \(\) — WRITE\n\n## Snoozed\n\n- \*\*1530\*\*/);
  assert.match(result.plans[0].postimage, /- \*\*1530\*\*[^\n]*\n\n## Notes\n\nKeep this paragraph\./);
  assert.equal((result.plans[0].postimage.match(/^## Snoozed$/gm) || []).length, 1);
});

test("a supplied note ID is composed with the Ready promotion plan", () => {
  const input = baseInput({
    newBlockId: "email-dan-new",
    task: {
      path: "Projects/job.md",
      contents: "- [ ] #task Email Dan\n",
      line: 1,
      route: "Projects/job.md",
      block: "",
      target: "Projects/job",
      status: " ",
      is_task: true,
      is_event: false,
      blocked: false,
      link: "",
    },
  });
  const result = planner.plan(input);
  assert.equal(result.ok, true);
  assert.match(result.plans.find((plan) => plan.path === "Projects/job.md").postimage, /\[\*\].*\^email-dan-new/);
  assert.match(result.plans[0].postimage, /- \*\*1530\*\* \[\[Projects\/job#\^email-dan-new\]\]/);
});

test("duplicate live links retain the second link's authored notes", () => {
  const input = baseInput({
    day: "## Pomodoros\n\n- [ ] () — WRITE\n\t- [[Projects/job#^email-dan]]\n\t\t- First note.\n\t- [[Projects/job#^email-dan]]\n\t\t- Second note.\n",
  });
  const result = planner.plan(input);
  assert.equal(result.ok, true);
  assert.match(result.plans[0].postimage, /\t- Email Dan\n\t\t- Second note\./);
  assert.match(result.plans[0].postimage, /- \*\*1530\*\* \[\[Projects\/job#\^email-dan\]\]\n\t- First note\./);
});

test("re-snoozing a woken task replaces its struck wake-history receipt", () => {
  const wakeHistory = "- ~~**1300** [[Projects/job#^email-dan]]~~ · woke 12:55";
  const historyNote = "  - do not carry this history note";
  const input = baseInput({
    day: [
      "## Pomodoros",
      "",
      "- [ ] () — WRITE",
      "  - [[Projects/job#^email-dan]] ⏰ woke 12:55",
      "",
      "## Snoozed",
      "",
      wakeHistory,
      historyNote,
      "",
    ].join("\n"),
    task: { status: "*", line: 1 },
    when: "1530",
  });
  const result = planner.plan(input);
  assert.equal(result.ok, true);
  assert.equal(result.plans[0].postimage.includes(wakeHistory), false);
  assert.equal(result.plans[0].postimage.includes("do not carry this history note"), false);
  assert.match(result.plans[0].postimage, /- \*\*1530\*\* \[\[Projects\/job#\^email-dan\]\]/);
});

test("retiming an active row keeps struck history for the same identity", () => {
  const wakeHistory = "- ~~**1300** [[Projects/job#^email-dan]]~~ · woke 12:55";
  const input = baseInput({
    day: [
      "## Pomodoros",
      "",
      "- [ ] () — WRITE",
      "",
      "## Snoozed",
      "",
      wakeHistory,
      "- **1400** [[Projects/job#^email-dan]]",
      "  - keep this active note",
      "",
    ].join("\n"),
    task: { status: "*", line: 1 },
    when: "1530",
  });
  const result = planner.plan(input);
  assert.equal(result.ok, true);
  assert.ok(result.plans[0].postimage.includes(wakeHistory));
  assert.match(result.plans[0].postimage, /- \*\*1530\*\* \[\[Projects\/job#\^email-dan\]\]\n  - keep this active note/);
  assert.doesNotMatch(result.plans[0].postimage, /- \*\*1400\*\* \[\[Projects\/job#\^email-dan\]\]/);
});

test("effective blocking is refused before the BIP target planner is called", () => {
  let calls = 0;
  const input = baseInput({
    task: { status: " ", blocked: true },
    planTargetTaskUpdate() { calls += 1; throw new Error("must not plan a blocked task"); },
  });
  const result = planner.plan(input);
  assert.equal(result.refusal, "blocked");
  assert.equal(calls, 0);
});

test("Next and In Progress snapshots never invoke the promotion planner", () => {
  for (const status of ["*", "/"]) {
    let calls = 0;
    const result = planner.plan(baseInput({
      task: { status },
      planTargetTaskUpdate() { calls += 1; throw new Error("lane must stay byte-identical"); },
    }));
    assert.equal(result.ok, true);
    assert.equal(calls, 0);
    assert.equal(result.task_unchanged, true);
  }
});
