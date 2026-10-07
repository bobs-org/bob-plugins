const test = require("node:test");
const assert = require("node:assert/strict");
const { helpers } = require("./block-id-prompt-harness.cjs");

function linkBase(overrides = {}) {
  return {
    blockId: "task1",
    targetPath: "Tasks.md",
    sourcePath: "Daily.md",
    resolveTarget: (reference) => (reference.oldId === "task1" ? "Tasks.md" : null),
    linkText: "[[Tasks#^task1]]",
    ...overrides,
  };
}

function existingChoice(entryLine, entryText, title) {
  return { kind: "existing", entryLine, entryText, title };
}

test("canonicalizePomodoroLinkName collapses whitespace, uppercases, and validates", () => {
  assert.deepEqual(helpers.canonicalizePomodoroLinkName("after tui fix"), {
    valid: true,
    name: "AFTER TUI FIX",
    error: null,
  });
  assert.deepEqual(helpers.canonicalizePomodoroLinkName("  deep   work\t"), {
    valid: true,
    name: "DEEP WORK",
    error: null,
  });
  assert.ok(helpers.canonicalizePomodoroLinkName("bugs+2").valid);
  assert.ok(helpers.isPomodoroLinkName("BUGS+2"));
  assert.ok(helpers.isPomodoroLinkName("WHAT'S NEXT (Q&A)"));
  assert.ok(helpers.isPomodoroLinkName("A+B, C/D.E-F"));
});

test("canonicalizePomodoroLinkName rejects leading symbols, letterless names, and non-ASCII", () => {
  for (const raw of ["+bugs", "123", "deep—work", "café", "", "   ", "(PLAN)", "-x"]) {
    const result = helpers.canonicalizePomodoroLinkName(raw);
    assert.equal(result.valid, false, raw);
    assert.equal(result.error, helpers.POMODORO_NAME_USAGE, raw);
  }
  assert.equal(helpers.isPomodoroLinkName("123"), false);
  assert.equal(helpers.isPomodoroLinkName("+BUGS"), false);
  assert.equal(helpers.isPomodoroLinkName(""), false);
});

test("pomodoroLinkSelectorSlug mirrors capture slugs", () => {
  assert.equal(helpers.pomodoroLinkSelectorSlug("AFTER TUI FIX"), "after-tui-fix");
  assert.equal(helpers.pomodoroLinkSelectorSlug("  Q&A  "), "q&a");
  assert.equal(helpers.pomodoroLinkSelectorSlug("WHAT'S NEXT"), "what's-next");
  assert.equal(helpers.pomodoroLinkSelectorSlug(""), "");
});

test("parsePomodoroEntryParts reads canonical and legacy entry lines", () => {
  assert.deepEqual(
    helpers.parsePomodoroEntryParts("- [ ] (**0920-0950** [t:: 25m]) — CAPTURE"),
    {
      name: "CAPTURE",
      label: null,
      range: { startMinutes: 560, endMinutes: 590, text: "09:20–09:50" },
    },
  );
  assert.deepEqual(helpers.parsePomodoroEntryParts("- [ ] Current (10:00-10:25)"), {
    name: null,
    label: "Current",
    range: { startMinutes: 600, endMinutes: 625, text: "10:00–10:25" },
  });
  assert.deepEqual(helpers.parsePomodoroEntryParts("- [ ] Later ()"), {
    name: null,
    label: "Later",
    range: null,
  });
  assert.deepEqual(helpers.parsePomodoroEntryParts("- [ ] () — DEEP WORK"), {
    name: "DEEP WORK",
    label: null,
    range: null,
  });
});

test("collectPomodoroLinkEntries skips fenced, nested, completed, and cancelled lookalikes", () => {
  const content = [
    "## Pomodoros",
    "- [ ] () — OPEN",
    "```",
    "- [ ] () — FENCED",
    "```",
    "  - [ ] #task nested, not a top-level entry (12:00-12:25)",
    "- [x] () — DONE",
    "- [-] () — DROPPED",
    "- [ ] () — SECOND OPEN",
  ].join("\n");
  const collected = helpers.collectPomodoroLinkEntries(content);
  assert.equal(collected.hasSection, true);
  assert.deepEqual(
    collected.entries.map((entry) => entry.title),
    ["OPEN", "DONE", "DROPPED", "SECOND OPEN"],
  );
  assert.deepEqual(
    collected.entries.map((entry) => entry.position),
    [1, 2, 3, 4],
  );
  assert.deepEqual(
    collected.entries.map((entry) => entry.open),
    [true, false, false, true],
  );
  assert.equal(collected.entries[2].status, "-");
});

test("collectPomodoroLinkEntries detects running, next-up, default, and ambiguity", () => {
  const timed = [
    "## Pomodoros",
    "- [ ] () — QUEUED",
    "- [ ] (09:00-09:25) — RUNNING",
    "- [ ] () — LATER",
  ].join("\n");
  const model = helpers.buildPomodoroLinkPickerModel(timed, {});
  assert.equal(model.ok, true);
  assert.equal(model.multipleRunning, false);
  assert.equal(model.defaultReason, "running");
  assert.equal(model.entries[model.defaultIndex].title, "RUNNING");
  assert.ok(model.entries[model.defaultIndex].running);
  assert.deepEqual(
    model.entries.filter((entry) => entry.nextUp).map((entry) => entry.title),
    ["QUEUED"],
  );

  const untimed = ["## Pomodoros", "- [ ] () — ALPHA", "- [ ] () — BETA"].join("\n");
  const fallback = helpers.buildPomodoroLinkPickerModel(untimed, {});
  assert.equal(fallback.defaultReason, "next");
  assert.equal(fallback.entries[fallback.defaultIndex].title, "ALPHA");

  const ambiguous = [
    "## Pomodoros",
    "- [ ] (09:00-09:25) — ONE",
    "- [ ] (10:00-10:25) — TWO",
  ].join("\n");
  const crowded = helpers.buildPomodoroLinkPickerModel(ambiguous, {});
  assert.equal(crowded.multipleRunning, true);
  assert.equal(crowded.defaultReason, "ambiguous");
  assert.equal(crowded.entries[crowded.defaultIndex].title, "ONE");
  assert.ok(crowded.entries.every((entry) => !entry.running && !entry.nextUp));
  assert.equal(crowded.creation.allowed, false);
  assert.equal(crowded.creation.blockedReason, "multiple-open-timed");

  const empty = ["## Pomodoros", "- [x] () — DONE"].join("\n");
  const none = helpers.buildPomodoroLinkPickerModel(empty, {});
  assert.equal(none.defaultIndex, -1);
  assert.equal(none.defaultReason, null);
  assert.deepEqual(none.entries, []);

  assert.deepEqual(helpers.buildPomodoroLinkPickerModel("# Notes\nhello", {}), {
    ok: false,
    error: "no-section",
  });
});

test("collectPomodoroLinkEntries counts links but excludes struck references", () => {
  const content = [
    "## Pomodoros",
    "- [ ] () — FOCUS",
    "\t- [[Tasks#^aaa]]",
    "\t- ~~[[Tasks#^bbb]]~~",
    "\t- [[Tasks#^ccc]] and [[Other#^ddd]]",
  ].join("\n");
  const collected = helpers.collectPomodoroLinkEntries(content);
  assert.equal(collected.entries.length, 1);
  assert.deepEqual(
    collected.entries[0].links.map((link) => link.blockId),
    ["aaa", "ccc", "ddd"],
  );
  assert.equal(collected.entries[0].linkCount, 3);
});

test("collectPomodoroLinkEntries falls back to range text and position titles", () => {
  const content = ["## Pomodoros", "- [ ] (09:00-09:25)", "- [ ] ()"].join("\n");
  const collected = helpers.collectPomodoroLinkEntries(content);
  assert.equal(collected.entries[0].title, "09:00–09:25");
  assert.equal(collected.entries[1].title, "Pomodoro #2");
});

test("pomodoroRunProgress reports fractions, overtime, and midnight wrap", () => {
  const entry = { range: { startMinutes: 560, endMinutes: 590 } };
  const third = helpers.pomodoroRunProgress(entry, new Date(2026, 7, 15, 9, 30));
  assert.ok(Math.abs(third.fraction - 1 / 3) < 1e-9);
  assert.equal(third.minutesLeft, 20);

  const over = helpers.pomodoroRunProgress(entry, new Date(2026, 7, 15, 9, 55));
  assert.equal(over.fraction, 1);
  assert.equal(over.minutesLeft, -5);

  const early = helpers.pomodoroRunProgress(entry, new Date(2026, 7, 15, 8, 0));
  assert.equal(early.fraction, 0);
  assert.equal(early.minutesLeft, 110);

  const overnight = helpers.pomodoroRunProgress(
    { range: { startMinutes: 1430, endMinutes: 10 } },
    new Date(2026, 7, 15, 0, 5),
  );
  assert.ok(Math.abs(overnight.fraction - 0.75) < 1e-9);
  assert.equal(overnight.minutesLeft, 5);

  assert.equal(helpers.pomodoroRunProgress({ range: null }, new Date()), null);
});

test("buildPomodoroLinkPickerRows ranks exact slugs before prefix hits", () => {
  const content = ["## Pomodoros", "- [ ] () — MEMORY WORK", "- [ ] () — MEMORY"].join("\n");
  const model = helpers.buildPomodoroLinkPickerModel(content, {});
  const { rows, selectedIndex } = helpers.buildPomodoroLinkPickerRows(model, "memory");
  assert.deepEqual(
    rows.map((row) => row.entry.title),
    ["MEMORY", "MEMORY WORK"],
  );
  assert.equal(rows[0].match.tier, 0);
  assert.equal(rows[1].match.tier, 1);
  assert.equal(selectedIndex, 0);
  // An exact open name suppresses the create row.
  assert.ok(rows.every((row) => row.kind === "existing"));
});

test("buildPomodoroLinkPickerRows keeps the create row for prefix matches", () => {
  const content = ["## Pomodoros", "- [ ] () — MEMORY WORK", "- [ ] () — MEMORY"].join("\n");
  const model = helpers.buildPomodoroLinkPickerModel(content, {});
  const { rows, selectedIndex } = helpers.buildPomodoroLinkPickerRows(model, "mem");
  assert.equal(rows.length, 3);
  assert.equal(rows[2].kind, "new");
  assert.equal(rows[2].name, "MEM");
  assert.equal(rows[2].againOf, null);
  assert.equal(selectedIndex, 0);
});

test("buildPomodoroLinkPickerRows marks completed-only names as again", () => {
  const content = ["## Pomodoros", "- [x] () — TAXES", "- [ ] () — FOCUS"].join("\n");
  const model = helpers.buildPomodoroLinkPickerModel(content, {});
  const { rows } = helpers.buildPomodoroLinkPickerRows(model, "taxes");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "new");
  assert.equal(rows[0].name, "TAXES");
  assert.equal(rows[0].againOf, "TAXES");
});

test("buildPomodoroLinkPickerRows shows invalid and blocked rows with no selection", () => {
  const content = ["## Pomodoros", "- [ ] () — CAPTURE"].join("\n");
  const model = helpers.buildPomodoroLinkPickerModel(content, {});
  const invalid = helpers.buildPomodoroLinkPickerRows(model, "+bugs");
  assert.equal(invalid.rows.length, 1);
  assert.equal(invalid.rows[0].kind, "invalid");
  assert.equal(invalid.rows[0].selectable, false);
  assert.equal(invalid.rows[0].message, helpers.POMODORO_NAME_USAGE);
  assert.equal(invalid.selectedIndex, -1);

  // An invalid name with a position hit shows matches, never the invalid row.
  const partial = helpers.buildPomodoroLinkPickerRows(model, "#1!");
  assert.ok(partial.rows.length > 0);
  assert.ok(partial.rows.every((row) => row.kind === "existing"));

  const crowded = helpers.buildPomodoroLinkPickerModel(
    ["## Pomodoros", "- [ ] (09:00-09:25) — ONE", "- [ ] (10:00-10:25) — TWO"].join("\n"),
    {},
  );
  const blocked = helpers.buildPomodoroLinkPickerRows(crowded, "deep work");
  assert.equal(blocked.rows.length, 1);
  assert.equal(blocked.rows[0].kind, "blocked");
  assert.equal(blocked.rows[0].message, "Can't add a Pomodoro while 2 are running");
  assert.equal(blocked.selectedIndex, -1);
});

test("buildPomodoroLinkPickerRows matches times, positions, and block IDs", () => {
  const content = [
    "## Pomodoros",
    "- [ ] (09:20-09:50) — FOCUS",
    "\t- [[Tasks#^fix-flaky]]",
    "- [ ] () — ADMIN",
  ].join("\n");
  const model = helpers.buildPomodoroLinkPickerModel(content, {});

  const compact = helpers.buildPomodoroLinkPickerRows(model, "0920-0950");
  assert.equal(compact.rows[0].entry.title, "FOCUS");
  assert.equal(compact.rows[0].match.field, "time");

  const display = helpers.buildPomodoroLinkPickerRows(model, "09:20–09:50");
  assert.equal(display.rows[0].entry.title, "FOCUS");

  const block = helpers.buildPomodoroLinkPickerRows(model, "fix-flaky");
  assert.equal(block.rows[0].entry.title, "FOCUS");
  assert.equal(block.rows[0].match.field, "block");

  const position = helpers.buildPomodoroLinkPickerRows(model, "#2");
  assert.ok(position.rows.some((row) => row.kind === "existing" && row.entry.title === "ADMIN"));

  const empty = helpers.buildPomodoroLinkPickerRows(model, "");
  assert.deepEqual(
    empty.rows.map((row) => row.entry.title),
    ["FOCUS", "ADMIN"],
  );
  assert.equal(empty.selectedIndex, model.defaultIndex);
  assert.ok(empty.rows[model.defaultIndex].isDefault);
});

test("resolvePomodoroLinkCreateIntent prefers exact opens and refuses blocked creates", () => {
  const content = ["## Pomodoros", "- [ ] () — MEMORY WORK", "- [ ] () — MEMORY"].join("\n");
  const model = helpers.buildPomodoroLinkPickerModel(content, {});

  const exact = helpers.resolvePomodoroLinkCreateIntent(model, "memory");
  assert.equal(exact.kind, "existing");
  assert.equal(exact.entry.title, "MEMORY");

  const fresh = helpers.resolvePomodoroLinkCreateIntent(model, "mem");
  assert.deepEqual(fresh, { kind: "new", name: "MEM" });

  assert.deepEqual(helpers.resolvePomodoroLinkCreateIntent(model, "   "), {
    kind: "none",
    reason: "empty",
  });
  assert.deepEqual(helpers.resolvePomodoroLinkCreateIntent(model, "+bugs"), {
    kind: "none",
    reason: "invalid-name",
  });

  const crowded = helpers.buildPomodoroLinkPickerModel(
    ["## Pomodoros", "- [ ] (09:00-09:25) — ONE", "- [ ] (10:00-10:25) — TWO"].join("\n"),
    {},
  );
  assert.deepEqual(helpers.resolvePomodoroLinkCreateIntent(crowded, "deep work"), {
    kind: "none",
    reason: "multiple-open-timed",
  });
});

test("defaultPomodoroLinkChoice returns the default entry or null", () => {
  const content = ["## Pomodoros", "- [ ] () — ALPHA", "- [ ] () — BETA"].join("\n");
  const model = helpers.buildPomodoroLinkPickerModel(content, {});
  assert.deepEqual(helpers.defaultPomodoroLinkChoice(model), {
    kind: "existing",
    entryLine: 1,
    entryText: "- [ ] () — ALPHA",
    title: "ALPHA",
  });
  assert.equal(
    helpers.defaultPomodoroLinkChoice({ ok: false, error: "no-section" }),
    null,
  );
  assert.equal(
    helpers.defaultPomodoroLinkChoice({ ok: true, entries: [], defaultIndex: -1 }),
    null,
  );
});

test("planExplicitPomodoroLinkInsertion links under a chosen existing entry", () => {
  const daily = [
    "## Pomodoros",
    "- [ ] (09:00-09:25) — FIRST",
    "- [ ] () — SECOND",
  ].join("\n");
  const plan = helpers.planExplicitPomodoroLinkInsertion(daily, linkBase({
    target: existingChoice(2, "- [ ] () — SECOND", "SECOND"),
  }));
  assert.equal(plan.entryLine, 2);
  assert.deepEqual(plan.destination, {
    kind: "existing",
    entryLine: 2,
    title: "SECOND",
    name: "SECOND",
    matchedExisting: false,
  });
  assert.equal(plan.alreadyLinked, false);
  assert.equal(
    plan.content,
    ["## Pomodoros", "- [ ] (09:00-09:25) — FIRST", "- [ ] () — SECOND", "\t- [[Tasks#^task1]]"].join("\n"),
  );
});

test("planExplicitPomodoroLinkInsertion re-resolves a shifted line but refuses edits and closes", () => {
  const choice = existingChoice(1, "- [ ] (09:00-09:25) — FIRST", "FIRST");

  const shifted = [
    "## Pomodoros",
    "- [ ] () — PREFIX",
    "- [ ] (09:00-09:25) — FIRST",
  ].join("\n");
  const moved = helpers.planExplicitPomodoroLinkInsertion(shifted, linkBase({ target: choice }));
  assert.equal(moved.entryLine, 2);
  assert.equal(moved.destination.title, "FIRST");

  const edited = [
    "## Pomodoros",
    "- [ ] (09:00-09:25) — RENAMED",
    "- [ ] () — SECOND",
  ].join("\n");
  assert.deepEqual(
    helpers.planExplicitPomodoroLinkInsertion(edited, linkBase({ target: choice })),
    { error: "target-missing" },
  );

  const closed = [
    "## Pomodoros",
    "- [x] (09:00-09:25) — FIRST",
    "- [ ] () — SECOND",
  ].join("\n");
  const closedChoice = existingChoice(1, "- [x] (09:00-09:25) — FIRST", "FIRST");
  assert.deepEqual(
    helpers.planExplicitPomodoroLinkInsertion(closed, linkBase({ target: closedChoice })),
    { error: "target-closed" },
  );

  const duplicated = [
    "## Pomodoros",
    "- [ ] (09:00-09:25) — FIRST",
    "- [ ] (09:00-09:25) — FIRST",
  ].join("\n");
  const staleChoice = existingChoice(0, "- [ ] (09:00-09:25) — FIRST", "FIRST");
  assert.deepEqual(
    helpers.planExplicitPomodoroLinkInsertion(duplicated, linkBase({ target: staleChoice })),
    { error: "target-missing" },
  );
});

test("planExplicitPomodoroLinkInsertion is idempotent and cleans other opens", () => {
  const daily = [
    "## Pomodoros",
    "- [ ] (09:00-09:25) — FIRST",
    "\t- [[Tasks#^task1]]",
    "- [ ] () — SECOND",
    "\t- [[Tasks#^task1]]",
  ].join("\n");
  const plan = helpers.planExplicitPomodoroLinkInsertion(daily, linkBase({
    target: existingChoice(1, "- [ ] (09:00-09:25) — FIRST", "FIRST"),
  }));
  assert.equal(plan.alreadyLinked, true);
  assert.equal(plan.removedCount, 1);
  assert.equal(
    plan.content,
    ["## Pomodoros", "- [ ] (09:00-09:25) — FIRST", "\t- [[Tasks#^task1]]", "- [ ] () — SECOND", ""].join("\n"),
  );
});

test("planExplicitPomodoroLinkInsertion creates after the running entry", () => {
  const daily = [
    "## Pomodoros",
    "- [ ] (09:00-09:25) — CAPTURE",
    "  - existing child",
    "- [ ] () — LATER",
  ].join("\n");
  const plan = helpers.planExplicitPomodoroLinkInsertion(daily, linkBase({
    target: { kind: "new", name: "deep work" },
  }));
  assert.equal(plan.destination.kind, "created");
  assert.equal(plan.destination.name, "DEEP WORK");
  assert.equal(plan.destination.title, "DEEP WORK");
  assert.equal(plan.destination.matchedExisting, false);
  assert.equal(plan.entryLine, 3);
  assert.equal(
    plan.content,
    [
      "## Pomodoros",
      "- [ ] (09:00-09:25) — CAPTURE",
      "  - existing child",
      "- [ ] () — DEEP WORK",
      "  - [[Tasks#^task1]]",
      "- [ ] () — LATER",
    ].join("\n"),
  );
});

test("planExplicitPomodoroLinkInsertion creates after completed, before first open, and at section top", () => {
  const afterCompleted = ["## Pomodoros", "- [x] (09:00-09:25) — DONE", "- [ ] () — LATER"].join("\n");
  const completed = helpers.planExplicitPomodoroLinkInsertion(afterCompleted, linkBase({
    target: { kind: "new", name: "taxes" },
  }));
  assert.equal(completed.destination.kind, "created");
  assert.equal(completed.entryLine, 2);
  assert.ok(completed.content.includes("- [ ] () — TAXES\n\t- [[Tasks#^task1]]\n- [ ] () — LATER"));

  const beforeFirstOpen = ["## Pomodoros", "- [ ] () — ALPHA", "- [ ] () — BETA"].join("\n");
  const firstOpen = helpers.planExplicitPomodoroLinkInsertion(beforeFirstOpen, linkBase({
    target: { kind: "new", name: "onboarding" },
  }));
  assert.equal(firstOpen.entryLine, 1);
  assert.ok(firstOpen.content.startsWith("## Pomodoros\n- [ ] () — ONBOARDING\n\t- [[Tasks#^task1]]\n- [ ] () — ALPHA"));

  const sectionTop = ["## Pomodoros", "- [-] () — DROPPED"].join("\n");
  const top = helpers.planExplicitPomodoroLinkInsertion(sectionTop, linkBase({
    target: { kind: "new", name: "fresh" },
  }));
  assert.equal(top.entryLine, 1);
  assert.equal(
    top.content,
    ["## Pomodoros", "- [ ] () — FRESH", "\t- [[Tasks#^task1]]", "- [-] () — DROPPED"].join("\n"),
  );
});

test("planExplicitPomodoroLinkInsertion links into a raced open name without duplicating", () => {
  const daily = ["## Pomodoros", "- [ ] () — DEEP WORK", "- [ ] () — LATER"].join("\n");
  const plan = helpers.planExplicitPomodoroLinkInsertion(daily, linkBase({
    target: { kind: "new", name: "deep work" },
  }));
  assert.equal(plan.destination.kind, "existing");
  assert.equal(plan.destination.matchedExisting, true);
  assert.equal(plan.entryLine, 1);
  assert.ok(plan.content.includes("- [ ] () — DEEP WORK\n\t- [[Tasks#^task1]]"));
});

test("planExplicitPomodoroLinkInsertion refuses crowded creates and bad targets", () => {
  const crowded = ["## Pomodoros", "- [ ] (09:00-09:25) — ONE", "- [ ] (10:00-10:25) — TWO"].join("\n");
  assert.deepEqual(
    helpers.planExplicitPomodoroLinkInsertion(crowded, linkBase({ target: { kind: "new", name: "fresh" } })),
    { error: "multiple-open-timed" },
  );
  const open = ["## Pomodoros", "- [ ] () — FOCUS"].join("\n");
  assert.deepEqual(
    helpers.planExplicitPomodoroLinkInsertion(open, linkBase({ target: { kind: "new", name: "+bad" } })),
    { error: "invalid-name" },
  );
  assert.deepEqual(
    helpers.planExplicitPomodoroLinkInsertion(open, linkBase({ target: null })),
    { error: "invalid-options" },
  );
  assert.deepEqual(
    helpers.planExplicitPomodoroLinkInsertion(open, {
      blockId: "",
      targetPath: "Tasks.md",
      resolveTarget: () => null,
      linkText: "[[Tasks#^task1]]",
      target: { kind: "new", name: "fresh" },
    }),
    { error: "invalid-options" },
  );
  assert.deepEqual(
    helpers.planExplicitPomodoroLinkInsertion("# Notes", linkBase({ target: { kind: "new", name: "fresh" } })),
    { error: "no-section" },
  );
});

test("planExplicitPomodoroLinkInsertion preserves CRLF and a missing final newline", () => {
  const crlf = ["## Pomodoros", "- [ ] () — FOCUS", "- [ ] () — LATER"].join("\r\n");
  const planned = helpers.planExplicitPomodoroLinkInsertion(crlf, linkBase({
    target: { kind: "new", name: "fresh" },
  }));
  assert.equal(planned.destination.kind, "created");
  assert.ok(planned.content.includes("- [ ] () — FRESH\r\n\t- [[Tasks#^task1]]\r\n- [ ] () — FOCUS"));

  const noTrailing = ["## Pomodoros", "- [x] () — DONE"].join("\n");
  const appended = helpers.planExplicitPomodoroLinkInsertion(noTrailing, linkBase({
    target: { kind: "new", name: "fresh" },
  }));
  assert.equal(
    appended.content,
    ["## Pomodoros", "- [x] () — DONE", "- [ ] () — FRESH", "\t- [[Tasks#^task1]]"].join("\n"),
  );
});

test("buildPomodoroLinkPickerRows suppresses creates for mixed-case exact names", () => {
  const content = ["## Pomodoros", "- [ ] () — Deep Work"].join("\n");
  const model = helpers.buildPomodoroLinkPickerModel(content, {});
  const { rows } = helpers.buildPomodoroLinkPickerRows(model, "deep work");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "existing");
  assert.equal(rows[0].entry.title, "Deep Work");
  const intent = helpers.resolvePomodoroLinkCreateIntent(model, "deep work");
  assert.equal(intent.kind, "existing");
  assert.equal(intent.entry.title, "Deep Work");
});

test("buildPomodoroLinkPickerRows keeps againOf for completed mixed-case names", () => {
  const content = ["## Pomodoros", "- [x] () — Taxes", "- [ ] () — FOCUS"].join("\n");
  const model = helpers.buildPomodoroLinkPickerModel(content, {});
  const { rows } = helpers.buildPomodoroLinkPickerRows(model, "taxes");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "new");
  assert.equal(rows[0].name, "TAXES");
  assert.equal(rows[0].againOf, "Taxes");
});

test("planExplicitPomodoroLinkInsertion matches mixed-case raced open names", () => {
  const daily = ["## Pomodoros", "- [ ] () — Deep Work", "- [ ] () — LATER"].join("\n");
  const plan = helpers.planExplicitPomodoroLinkInsertion(daily, linkBase({
    target: { kind: "new", name: "DEEP WORK" },
  }));
  assert.equal(plan.destination.matchedExisting, true);
  assert.equal(plan.destination.kind, "existing");
  assert.equal(plan.entryLine, 1);
  assert.ok(!plan.content.includes("— DEEP WORK"));
  assert.ok(plan.content.includes("- [ ] () — Deep Work\n\t- [[Tasks#^task1]]"));
});

test("buildPomodoroLinkPickerRows bounds #N position matches", () => {
  const names = ["P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08", "P09", "P10"];
  const content = ["## Pomodoros", ...names.map((name) => `- [ ] () — ${name}`)].join("\n");
  const model = helpers.buildPomodoroLinkPickerModel(content, {});

  const ten = helpers.buildPomodoroLinkPickerRows(model, "#10");
  assert.ok(ten.rows.some((row) => row.kind === "existing" && row.entry.position === 10));
  assert.ok(!ten.rows.some((row) => row.kind === "existing" && row.entry.position === 1));

  const one = helpers.buildPomodoroLinkPickerRows(model, "#1!");
  assert.ok(one.rows.some((row) => row.kind === "existing" && row.entry.position === 1));

  const two = helpers.buildPomodoroLinkPickerRows(model, "#2");
  assert.ok(two.rows.some((row) => row.kind === "existing" && row.entry.position === 2));
});

test("planPomodoroLinkInsertion without a target keeps today's behavior and shape", () => {
  const daily = ["## Pomodoros", "- [ ] (10:00-10:25) — Current", "- [ ] () — Next"].join("\n");
  const plan = helpers.planPomodoroLinkInsertion(daily, linkBase());
  assert.equal(plan.entryLine, 1);
  assert.ok(!("destination" in plan));
  assert.ok(plan.content.includes("\t- [[Tasks#^task1]]"));
});
