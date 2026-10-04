const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  helpers,
  pomodoroFixtureLines,
} = require("./navigation-hotkeys-harness.cjs");

test("planPomodoroBulletMove appends one bullet last in an existing open Pomodoro, deleting the emptied source", () => {
  const content = pomodoroFixtureLines().join("\n");
  const discovery = helpers.discoverMovablePomodoroBulletTargets(content, 5, 0);
  const plan = helpers.planPomodoroBulletMove(content, {
    targets: discovery.targets,
    sourceEntryLine: discovery.entryLine,
    destination: { kind: "existing", entryLine: 11 },
  });
  assert.equal(plan.valid, true);
  assert.equal(plan.movedCount, 1);
  assert.equal(plan.skippedDuplicateCount, 0);
  assert.equal(plan.sourcePomodoroDeleted, true);
  assert.equal(plan.destinationEntryLine, 9);
  const afterLines = plan.after.split("\n");
  assert.equal(afterLines.includes("- [ ] (**0920-0950** [t:: 30m])"), false);
  assert.equal(afterLines[4], "- [ ] ()");
  assert.deepEqual(afterLines.slice(9, 11), [
    "- [ ] () — VERIFY",
    "\t- [[sase_better_config#^no-focus-xprompts]]",
  ]);
  assert.equal(afterLines[11], "\t- [[bob#^move-pomodoros]]");
  assert.equal(plan.firstMovedLine, 11);
});

test("planPomodoroBulletMove deletes the source when a counted move consumes every sibling, including a nested subtree", () => {
  const content = [
    "## Pomodoros",
    "- [ ] () — A",
    "\t- [[x#^one]]",
    "\t- [[x#^two]]",
    "\t\t- nested under two",
    "\t- [[x#^three]]",
    "- [ ] () — B",
    "\t- [[x#^existing]]",
  ].join("\n");
  const discovery = helpers.discoverMovablePomodoroBulletTargets(content, 2, 2);
  assert.deepEqual(discovery.targets.map((target) => target.line), [2, 3, 5]);
  const plan = helpers.planPomodoroBulletMove(content, {
    targets: discovery.targets,
    sourceEntryLine: discovery.entryLine,
    destination: { kind: "existing", entryLine: 6 },
  });
  assert.equal(plan.valid, true);
  assert.equal(plan.movedCount, 3);
  assert.equal(plan.sourcePomodoroDeleted, true);
  assert.equal(plan.after, [
    "## Pomodoros",
    "- [ ] () — B",
    "\t- [[x#^existing]]",
    "\t- [[x#^one]]",
    "\t- [[x#^two]]",
    "\t\t- nested under two",
    "\t- [[x#^three]]",
  ].join("\n"));
});

test("planPomodoroBulletMove preserves the source when only some siblings move out", () => {
  const content = [
    "## Pomodoros",
    "- [ ] () — A",
    "\t- [[x#^one]]",
    "\t- [[x#^two]]",
    "\t- [[x#^three]]",
    "- [ ] () — B",
    "\t- [[x#^existing]]",
  ].join("\n");
  const discovery = helpers.discoverMovablePomodoroBulletTargets(content, 2, 0);
  const plan = helpers.planPomodoroBulletMove(content, {
    targets: discovery.targets,
    sourceEntryLine: discovery.entryLine,
    destination: { kind: "existing", entryLine: 5 },
  });
  assert.equal(plan.valid, true);
  assert.equal(plan.sourcePomodoroDeleted, false);
  assert.equal(plan.after, [
    "## Pomodoros",
    "- [ ] () — A",
    "\t- [[x#^two]]",
    "\t- [[x#^three]]",
    "- [ ] () — B",
    "\t- [[x#^existing]]",
    "\t- [[x#^one]]",
  ].join("\n"));
});

test("planPomodoroBulletMove promotes a nested grandchild to the destination's child depth with its descendants", () => {
  const content = [
    "## Pomodoros",
    "- [ ] () — A",
    "\t- [[x#^parent]]",
    "\t\t- [[x#^grandchild]]",
    "\t\t\t- deep descendant",
    "\t- [[x#^sibling]]",
    "- [ ] () — B",
    "\t- [[x#^existing]]",
  ].join("\n");
  const discovery = helpers.discoverMovablePomodoroBulletTargets(content, 3, 0);
  assert.deepEqual(discovery.targets.map((target) => target.line), [3]);
  const plan = helpers.planPomodoroBulletMove(content, {
    targets: discovery.targets,
    sourceEntryLine: discovery.entryLine,
    destination: { kind: "existing", entryLine: 6 },
  });
  assert.equal(plan.valid, true);
  assert.equal(plan.sourcePomodoroDeleted, false);
  assert.equal(plan.after, [
    "## Pomodoros",
    "- [ ] () — A",
    "\t- [[x#^parent]]",
    "\t- [[x#^sibling]]",
    "- [ ] () — B",
    "\t- [[x#^existing]]",
    "\t- [[x#^grandchild]]",
    "\t\t- deep descendant",
  ].join("\n"));
});

test("planPomodoroBulletMove creates a new named Pomodoro at the deleted source's former position (middle entry)", () => {
  const content = pomodoroFixtureLines().join("\n");
  const discovery = helpers.discoverMovablePomodoroBulletTargets(content, 5, 0);
  const plan = helpers.planPomodoroBulletMove(content, {
    targets: discovery.targets,
    sourceEntryLine: discovery.entryLine,
    destination: { kind: "new", name: "focus session" },
  });
  assert.equal(plan.valid, true);
  assert.equal(plan.createdPomodoro, true);
  assert.equal(plan.createdPomodoroName, "FOCUS SESSION");
  assert.equal(plan.sourcePomodoroDeleted, true);
  const afterLines = plan.after.split("\n");
  assert.equal(afterLines.includes("- [ ] (**0920-0950** [t:: 30m])"), false);
  assert.equal(afterLines[4], "- [ ] () — FOCUS SESSION");
  assert.equal(afterLines[5], "\t- [[bob#^move-pomodoros]]");
  assert.equal(afterLines[6], "- [ ] ()");
  assert.equal(plan.destinationEntryLine, 4);
  assert.equal(plan.firstMovedLine, 5);
});

test("planPomodoroBulletMove creates a fresh same-name destination from the = row without merging same-name entries", () => {
  const content = [
    "## Pomodoros",
    "- [ ] () — FOCUS",
    "\t- one",
    "\t- two",
    "\t\t- nested under two",
    "- [ ] () — FOCUS",
    "\t- existing",
  ].join("\r\n");
  const discovery = helpers.discoverMovablePomodoroBulletTargets(content, 2, 1);
  const row = helpers.createPomodoroBulletMovePickerRows(
    discovery.context.entries,
    discovery.entryLine,
    "=",
  )[0];
  const plan = helpers.planPomodoroBulletMove(content, {
    targets: discovery.targets,
    sourceEntryLine: discovery.entryLine,
    destination: { kind: "new", name: row.name },
  });

  assert.equal(row.kind, "new");
  assert.equal(row.name, "FOCUS");
  assert.equal(plan.valid, true);
  assert.equal(plan.createdPomodoro, true);
  assert.equal(plan.createdPomodoroName, "FOCUS");
  assert.equal(plan.movedCount, 2);
  assert.equal(plan.sourcePomodoroDeleted, true);
  assert.equal(/[^\r]\n/.test(plan.after), false);
  assert.equal(plan.after, [
    "## Pomodoros",
    "- [ ] () — FOCUS",
    "\t- one",
    "\t- two",
    "\t\t- nested under two",
    "- [ ] () — FOCUS",
    "\t- existing",
  ].join("\r\n"));
});

test("planPomodoroBulletMove creates a new named Pomodoro at the deleted source's former position (only Pomodoro in section)", () => {
  const content = [
    "## Pomodoros",
    "- [ ] () — A",
    "\t- [[x#^one]]",
    "## Not Pomodoros",
  ].join("\n");
  const discovery = helpers.discoverMovablePomodoroBulletTargets(content, 2, 0);
  const plan = helpers.planPomodoroBulletMove(content, {
    targets: discovery.targets,
    sourceEntryLine: discovery.entryLine,
    destination: { kind: "new", name: "B" },
  });
  assert.equal(plan.valid, true);
  assert.equal(plan.sourcePomodoroDeleted, true);
  assert.equal(plan.after, [
    "## Pomodoros",
    "- [ ] () — B",
    "\t- [[x#^one]]",
    "## Not Pomodoros",
  ].join("\n"));
  assert.equal(plan.destinationEntryLine, 1);
  assert.equal(plan.firstMovedLine, 2);
});

test("planPomodoroBulletMove replaces a lone empty placeholder child and deletes the emptied source", () => {
  const content = [
    "## Pomodoros",
    "- [ ] () — BODY",
    "\t- ",
    "- [ ] ()",
    "\t- [[sase#^pager]]",
  ].join("\n");
  const discovery = helpers.discoverMovablePomodoroBulletTargets(content, 4, 0);
  const plan = helpers.planPomodoroBulletMove(content, {
    targets: discovery.targets,
    sourceEntryLine: discovery.entryLine,
    destination: { kind: "existing", entryLine: 1 },
  });
  assert.equal(plan.valid, true);
  assert.equal(plan.sourcePomodoroDeleted, true);
  assert.equal(plan.after, [
    "## Pomodoros",
    "- [ ] () — BODY",
    "\t- [[sase#^pager]]",
  ].join("\n"));
  assert.equal(plan.firstMovedLine, 2);
});

test("planPomodoroBulletMove merges an exact-duplicate single line, keeps a near-match distinct, and deletes the emptied source", () => {
  const content = [
    "## Pomodoros",
    "- [ ] () — A",
    "\t- [[x#^one]]",
    "\t- 🍅 [[x#^one]]",
    "\t- ~~[[x#^one]]~~",
    "- [ ] () — B",
    "\t- [[x#^one]]",
  ].join("\n");
  const discovery = helpers.discoverMovablePomodoroBulletTargets(content, 2, 2);
  const plan = helpers.planPomodoroBulletMove(content, {
    targets: discovery.targets,
    sourceEntryLine: discovery.entryLine,
    destination: { kind: "existing", entryLine: 5 },
  });
  assert.equal(plan.valid, true);
  assert.equal(plan.movedCount, 2);
  assert.equal(plan.skippedDuplicateCount, 1);
  assert.equal(plan.sourcePomodoroDeleted, true);
  assert.equal(plan.after, [
    "## Pomodoros",
    "- [ ] () — B",
    "\t- [[x#^one]]",
    "\t- 🍅 [[x#^one]]",
    "\t- ~~[[x#^one]]~~",
  ].join("\n"));
});

test("planPomodoroBulletMove reports a stale target, an unresolved destination, and an invalid new name", () => {
  const content = pomodoroFixtureLines().join("\n");
  const discovery = helpers.discoverMovablePomodoroBulletTargets(content, 5, 0);

  const stale = helpers.planPomodoroBulletMove(content, {
    targets: [{ line: 5, rawLine: "stale text" }],
    sourceEntryLine: discovery.entryLine,
    destination: { kind: "existing", entryLine: 11 },
  });
  assert.equal(stale.valid, false);
  assert.match(stale.error, /changed before it could be moved/);
  assert.equal(stale.after, content);

  const sameEntry = helpers.planPomodoroBulletMove(content, {
    targets: discovery.targets,
    sourceEntryLine: discovery.entryLine,
    destination: { kind: "existing", entryLine: discovery.entryLine },
  });
  assert.equal(sameEntry.valid, false);

  const missingEntry = helpers.planPomodoroBulletMove(content, {
    targets: discovery.targets,
    sourceEntryLine: discovery.entryLine,
    destination: { kind: "existing", entryLine: 999 },
  });
  assert.equal(missingEntry.valid, false);

  const invalidName = helpers.planPomodoroBulletMove(content, {
    targets: discovery.targets,
    sourceEntryLine: discovery.entryLine,
    destination: { kind: "new", name: "   " },
  });
  assert.equal(invalidName.valid, false);
  assert.match(invalidName.error, /empty/);
});

test("planPomodoroBulletMove deletes the emptied source when the moved bullet merges away as a duplicate", () => {
  const content = [
    "## Pomodoros",
    "- [ ] () — A",
    "\t- [[x#^one]]",
    "- [ ] () — B",
    "\t- [[x#^one]]",
  ].join("\n");
  const discovery = helpers.discoverMovablePomodoroBulletTargets(content, 2, 0);
  const plan = helpers.planPomodoroBulletMove(content, {
    targets: discovery.targets,
    sourceEntryLine: discovery.entryLine,
    destination: { kind: "existing", entryLine: 3 },
  });
  assert.equal(plan.valid, true);
  assert.equal(plan.movedCount, 0);
  assert.equal(plan.skippedDuplicateCount, 1);
  assert.equal(plan.sourcePomodoroDeleted, true);
  const afterLines = plan.after.split("\n");
  assert.equal(plan.firstMovedLine, plan.destinationEntryLine);
  assert.equal(afterLines[plan.firstMovedLine], "- [ ] () — B");
  assert.equal(plan.after, [
    "## Pomodoros",
    "- [ ] () — B",
    "\t- [[x#^one]]",
  ].join("\n"));
});

test("planPomodoroBulletMove leaves a destination's lone placeholder intact and still deletes the emptied source", () => {
  const content = [
    "## Pomodoros",
    "- [ ] () — A",
    "\t- ",
    "- [ ] () — B",
    "\t- ",
  ].join("\n");
  const discovery = helpers.discoverMovablePomodoroBulletTargets(content, 2, 0);
  const plan = helpers.planPomodoroBulletMove(content, {
    targets: discovery.targets,
    sourceEntryLine: discovery.entryLine,
    destination: { kind: "existing", entryLine: 3 },
  });
  assert.equal(plan.valid, true);
  assert.equal(plan.movedCount, 0);
  assert.equal(plan.skippedDuplicateCount, 1);
  assert.equal(plan.sourcePomodoroDeleted, true);
  assert.equal(plan.after, [
    "## Pomodoros",
    "- [ ] () — B",
    "\t- ",
  ].join("\n"));
});

test("planPomodoroBulletMove moving a bullet out and back cannot restore a deleted source automatically", () => {
  // B starts with no children at all (not even a placeholder). Moving A's
  // only bullet into B deletes A entirely, since it owned no content once
  // the bullet left. Moving the bullet back out of B deletes B in turn: a
  // deleted Pomodoro cannot be restored by reusing its old line number, and
  // recreating it as a new destination does not reproduce the original
  // document.
  const content = [
    "## Pomodoros",
    "- [ ] () — A",
    "\t- [[x#^one]]",
    "- [ ] () — B",
  ].join("\n");
  const discovery = helpers.discoverMovablePomodoroBulletTargets(content, 2, 0);
  const out = helpers.planPomodoroBulletMove(content, {
    targets: discovery.targets,
    sourceEntryLine: discovery.entryLine,
    destination: { kind: "existing", entryLine: 3 },
  });
  assert.equal(out.valid, true);
  assert.equal(out.sourcePomodoroDeleted, true);
  assert.equal(out.after, [
    "## Pomodoros",
    "- [ ] () — B",
    "\t- [[x#^one]]",
  ].join("\n"));

  const backDiscovery = helpers.discoverMovablePomodoroBulletTargets(
    out.after,
    out.firstMovedLine,
    0,
  );
  assert.equal(backDiscovery.valid, true);

  // A's original line number now names B itself, not the deleted A: reusing
  // it collides with the bullet's own current source entry.
  const staleTarget = helpers.planPomodoroBulletMove(out.after, {
    targets: backDiscovery.targets,
    sourceEntryLine: backDiscovery.entryLine,
    destination: { kind: "existing", entryLine: discovery.entryLine },
  });
  assert.equal(staleTarget.valid, false);

  const back = helpers.planPomodoroBulletMove(out.after, {
    targets: backDiscovery.targets,
    sourceEntryLine: backDiscovery.entryLine,
    destination: { kind: "new", name: "A" },
  });
  assert.equal(back.valid, true);
  assert.equal(back.sourcePomodoroDeleted, true);
  assert.notEqual(back.after, content);
  assert.equal(back.after, [
    "## Pomodoros",
    "- [ ] () — A",
    "\t- [[x#^one]]",
  ].join("\n"));
});

test("planPomodoroBulletMove re-resolves an existing destination that sits before the deleted source", () => {
  const content = pomodoroFixtureLines().join("\n");
  const discovery = helpers.discoverMovablePomodoroBulletTargets(content, 10, 0);
  const plan = helpers.planPomodoroBulletMove(content, {
    targets: discovery.targets,
    sourceEntryLine: discovery.entryLine,
    destination: { kind: "existing", entryLine: 1 },
  });
  assert.equal(plan.valid, true);
  assert.equal(plan.sourcePomodoroDeleted, true);
  assert.equal(plan.destinationEntryLine, 1);
  const afterLines = plan.after.split("\n");
  assert.equal(afterLines.includes("- [ ] () — BODY"), false);
  assert.deepEqual(afterLines.slice(1, 5), [
    "- [x] (**0855-0920** [t:: 25m])",
    "\t- ~~[[#^gtd]]~~",
    "\t- 🍅 [[dev#^lower-athena-disk-use]]",
    "\t- [[body#^email-jenika]]",
  ]);
  assert.equal(plan.firstMovedLine, 4);
});

test("planPomodoroBulletMove deletes both open and closed source entries the same way", () => {
  for (const status of [" ", "x", "-"]) {
    const content = [
      "## Pomodoros",
      `- [${status}] () — SOURCE`,
      "\t- [[x#^one]]",
      "- [ ] () — B",
      "\t- [[x#^existing]]",
    ].join("\n");
    const discovery = helpers.discoverMovablePomodoroBulletTargets(content, 2, 0);
    const plan = helpers.planPomodoroBulletMove(content, {
      targets: discovery.targets,
      sourceEntryLine: discovery.entryLine,
      destination: { kind: "existing", entryLine: 3 },
    });
    assert.equal(plan.valid, true);
    assert.equal(plan.sourcePomodoroDeleted, true);
    assert.equal(plan.after, [
      "## Pomodoros",
      "- [ ] () — B",
      "\t- [[x#^existing]]",
      "\t- [[x#^one]]",
    ].join("\n"));
  }
});

test("planPomodoroBulletMove deletes the first, a middle, and the last Pomodoro entry while preserving structure", () => {
  const firstEntry = [
    "## Pomodoros",
    "- [ ] () — A",
    "\t- [[x#^one]]",
    "- [ ] () — B",
    "\t- [[x#^existing]]",
  ].join("\n");
  const firstDiscovery = helpers.discoverMovablePomodoroBulletTargets(firstEntry, 2, 0);
  const firstPlan = helpers.planPomodoroBulletMove(firstEntry, {
    targets: firstDiscovery.targets,
    sourceEntryLine: firstDiscovery.entryLine,
    destination: { kind: "existing", entryLine: 3 },
  });
  assert.equal(firstPlan.valid, true);
  assert.equal(firstPlan.sourcePomodoroDeleted, true);
  assert.equal(firstPlan.after, [
    "## Pomodoros",
    "- [ ] () — B",
    "\t- [[x#^existing]]",
    "\t- [[x#^one]]",
  ].join("\n"));

  const lastEntry = [
    "## Pomodoros",
    "- [ ] () — A",
    "\t- [[x#^existing]]",
    "- [ ] () — B",
    "\t- [[x#^one]]",
    "## Not Pomodoros",
  ].join("\n");
  const lastDiscovery = helpers.discoverMovablePomodoroBulletTargets(lastEntry, 4, 0);
  const lastPlan = helpers.planPomodoroBulletMove(lastEntry, {
    targets: lastDiscovery.targets,
    sourceEntryLine: lastDiscovery.entryLine,
    destination: { kind: "existing", entryLine: 1 },
  });
  assert.equal(lastPlan.valid, true);
  assert.equal(lastPlan.sourcePomodoroDeleted, true);
  assert.equal(lastPlan.after, [
    "## Pomodoros",
    "- [ ] () — A",
    "\t- [[x#^existing]]",
    "\t- [[x#^one]]",
    "## Not Pomodoros",
  ].join("\n"));
});

test("planPomodoroBulletMove preserves trailing-newline state and CRLF line endings when deleting the source", () => {
  const lfLines = [
    "## Pomodoros",
    "- [ ] () — A",
    "\t- [[x#^existing]]",
    "- [ ] () — B",
    "\t- [[x#^one]]",
    "",
  ];
  const lfContent = lfLines.join("\n");
  const lfDiscovery = helpers.discoverMovablePomodoroBulletTargets(lfContent, 4, 0);
  const lfPlan = helpers.planPomodoroBulletMove(lfContent, {
    targets: lfDiscovery.targets,
    sourceEntryLine: lfDiscovery.entryLine,
    destination: { kind: "existing", entryLine: 1 },
  });
  assert.equal(lfPlan.valid, true);
  assert.equal(lfPlan.sourcePomodoroDeleted, true);
  assert.equal(lfPlan.after.endsWith("\n"), true);
  assert.equal(lfPlan.after, [
    "## Pomodoros",
    "- [ ] () — A",
    "\t- [[x#^existing]]",
    "\t- [[x#^one]]",
    "",
  ].join("\n"));

  const crlfContent = [
    "## Pomodoros",
    "- [ ] () — A",
    "\t- [[x#^existing]]",
    "- [ ] () — B",
    "\t- [[x#^one]]",
    "## Not Pomodoros",
  ].join("\r\n");
  const crlfDiscovery = helpers.discoverMovablePomodoroBulletTargets(crlfContent, 4, 0);
  const crlfPlan = helpers.planPomodoroBulletMove(crlfContent, {
    targets: crlfDiscovery.targets,
    sourceEntryLine: crlfDiscovery.entryLine,
    destination: { kind: "existing", entryLine: 1 },
  });
  assert.equal(crlfPlan.valid, true);
  assert.equal(crlfPlan.sourcePomodoroDeleted, true);
  assert.equal(/[^\r]\n/.test(crlfPlan.after), false);
  assert.equal(crlfPlan.after, [
    "## Pomodoros",
    "- [ ] () — A",
    "\t- [[x#^existing]]",
    "\t- [[x#^one]]",
    "## Not Pomodoros",
  ].join("\r\n"));
});

test("planPomodoroBulletMove scope 'entry' appends every bullet in source order after a later destination's last child, deleting the source", () => {
  const content = [
    "## Pomodoros",
    "- [ ] () — SRC",
    "\t- [[x#^one]]",
    "\t- [[x#^two]]",
    "- [ ] () — DEST",
    "\t- [[x#^existing]]",
  ].join("\n");
  const discovery = helpers.discoverPomodoroEntryMoveTargets(content, 1);
  const plan = helpers.planPomodoroBulletMove(content, {
    scope: "entry",
    targets: discovery.targets,
    sourceEntryLine: discovery.entryLine,
    sourceRawLine: discovery.rawEntryLine,
    destination: { kind: "existing", entryLine: 4 },
  });
  assert.equal(plan.valid, true);
  assert.equal(plan.sourcePomodoroDeleted, true);
  assert.equal(plan.createdPomodoro, false);
  assert.equal(plan.createdPomodoroName, null);
  assert.equal(plan.movedCount, 2);
  assert.equal(plan.after, [
    "## Pomodoros",
    "- [ ] () — DEST",
    "\t- [[x#^existing]]",
    "\t- [[x#^one]]",
    "\t- [[x#^two]]",
  ].join("\n"));
});

test("planPomodoroBulletMove scope 'entry' re-resolves an earlier destination after the source is removed", () => {
  const content = [
    "## Pomodoros",
    "- [ ] () — DEST",
    "\t- [[x#^existing]]",
    "- [ ] () — SRC",
    "\t- [[x#^one]]",
    "\t- [[x#^two]]",
  ].join("\n");
  const discovery = helpers.discoverPomodoroEntryMoveTargets(content, 3);
  const plan = helpers.planPomodoroBulletMove(content, {
    scope: "entry",
    targets: discovery.targets,
    sourceEntryLine: discovery.entryLine,
    sourceRawLine: discovery.rawEntryLine,
    destination: { kind: "existing", entryLine: 1 },
  });
  assert.equal(plan.valid, true);
  assert.equal(plan.sourcePomodoroDeleted, true);
  assert.equal(plan.destinationEntryLine, 1);
  assert.equal(plan.after, [
    "## Pomodoros",
    "- [ ] () — DEST",
    "\t- [[x#^existing]]",
    "\t- [[x#^one]]",
    "\t- [[x#^two]]",
  ].join("\n"));
});

test("planPomodoroBulletMove scope 'entry' carries a bullet's descendants and rebases them onto the destination's child indent", () => {
  const content = pomodoroFixtureLines().join("\n");
  const discovery = helpers.discoverPomodoroEntryMoveTargets(content, 6);
  const plan = helpers.planPomodoroBulletMove(content, {
    scope: "entry",
    targets: discovery.targets,
    sourceEntryLine: discovery.entryLine,
    sourceRawLine: discovery.rawEntryLine,
    destination: { kind: "existing", entryLine: 11 },
  });
  assert.equal(plan.valid, true);
  assert.equal(plan.sourcePomodoroDeleted, true);
  const afterLines = plan.after.split("\n");
  const destStart = afterLines.indexOf("- [ ] () — VERIFY");
  assert.equal(afterLines[destStart + 1], "\t- [[sase_better_config#^no-focus-xprompts]]");
  assert.equal(afterLines[destStart + 2], "\t- [[sase#^pager]]");
  assert.equal(afterLines[destStart + 3], "\t\t- [[sase-tj#^nested]]");
});

test("planPomodoroBulletMove scope 'entry' merges an exact duplicate and keeps a near-match distinct", () => {
  const content = [
    "## Pomodoros",
    "- [ ] () — SRC",
    "\t- [[x#^one]]",
    "\t- [[x#^one]] extra",
    "- [ ] () — DEST",
    "\t- [[x#^one]]",
  ].join("\n");
  const discovery = helpers.discoverPomodoroEntryMoveTargets(content, 1);
  const plan = helpers.planPomodoroBulletMove(content, {
    scope: "entry",
    targets: discovery.targets,
    sourceEntryLine: discovery.entryLine,
    sourceRawLine: discovery.rawEntryLine,
    destination: { kind: "existing", entryLine: 4 },
  });
  assert.equal(plan.valid, true);
  assert.equal(plan.sourcePomodoroDeleted, true);
  assert.equal(plan.movedCount, 1);
  assert.equal(plan.skippedDuplicateCount, 1);
  assert.equal(plan.after, [
    "## Pomodoros",
    "- [ ] () — DEST",
    "\t- [[x#^one]]",
    "\t- [[x#^one]] extra",
  ].join("\n"));
});

test("planPomodoroBulletMove scope 'entry' replaces a destination's lone empty placeholder when something is inserted", () => {
  const content = [
    "## Pomodoros",
    "- [ ] () — SRC",
    "\t- [[x#^one]]",
    "- [ ] () — DEST",
    "\t- ",
  ].join("\n");
  const discovery = helpers.discoverPomodoroEntryMoveTargets(content, 1);
  const plan = helpers.planPomodoroBulletMove(content, {
    scope: "entry",
    targets: discovery.targets,
    sourceEntryLine: discovery.entryLine,
    sourceRawLine: discovery.rawEntryLine,
    destination: { kind: "existing", entryLine: 3 },
  });
  assert.equal(plan.valid, true);
  assert.equal(plan.after, [
    "## Pomodoros",
    "- [ ] () — DEST",
    "\t- [[x#^one]]",
  ].join("\n"));
});

test("planPomodoroBulletMove scope 'entry' leaves a destination's lone placeholder intact when a forced target merges away", () => {
  // A source bullet shaped like an empty placeholder would normally be
  // classified as droppable by discovery rather than selected as a target;
  // this directly forces it into `targets` to exercise the shared
  // insertion path's "everything merged away" branch, which is reused
  // verbatim from the sub-bullet move.
  const content = [
    "## Pomodoros",
    "- [ ] () — SRC",
    "\t- ",
    "- [ ] () — DEST",
    "\t- ",
  ].join("\n");
  const plan = helpers.planPomodoroBulletMove(content, {
    scope: "entry",
    targets: [{ line: 2, rawLine: "\t- " }],
    sourceEntryLine: 1,
    sourceRawLine: "- [ ] () — SRC",
    destination: { kind: "existing", entryLine: 3 },
  });
  assert.equal(plan.valid, true);
  assert.equal(plan.sourcePomodoroDeleted, true);
  assert.equal(plan.movedCount, 0);
  assert.equal(plan.skippedDuplicateCount, 1);
  assert.equal(plan.after, [
    "## Pomodoros",
    "- [ ] () — DEST",
    "\t- ",
  ].join("\n"));
});

test("planPomodoroBulletMove scope 'entry' plans a pure deletion for a childless entry and a placeholder-only entry", () => {
  for (const sourceLines of [[], ["\t- "]]) {
    const content = [
      "## Pomodoros",
      "- [ ] () — SRC",
      ...sourceLines,
      "- [ ] () — DEST",
      "\t- [[x#^existing]]",
    ].join("\n");
    const destEntryLine = 2 + sourceLines.length;
    const discovery = helpers.discoverPomodoroEntryMoveTargets(content, 1);
    assert.deepEqual(discovery.targets, []);
    const plan = helpers.planPomodoroBulletMove(content, {
      scope: "entry",
      targets: discovery.targets,
      sourceEntryLine: discovery.entryLine,
      sourceRawLine: discovery.rawEntryLine,
      destination: { kind: "existing", entryLine: destEntryLine },
    });
    assert.equal(plan.valid, true);
    assert.equal(plan.movedCount, 0);
    assert.equal(plan.sourcePomodoroDeleted, true);
    assert.equal(plan.after, [
      "## Pomodoros",
      "- [ ] () — DEST",
      "\t- [[x#^existing]]",
    ].join("\n"));
    assert.equal(plan.firstMovedLine, plan.destinationEntryLine);
  }
});

test("planPomodoroBulletMove scope 'entry' rejects an unmoved non-blank line with the no-silent-loss guard", () => {
  const content = [
    "## Pomodoros",
    "- [ ] () — SRC",
    "\tStray note with no bullet marker",
    "- [ ] () — DEST",
  ].join("\n");
  const discovery = helpers.discoverPomodoroEntryMoveTargets(content, 1);
  assert.deepEqual(discovery.targets, []);
  const plan = helpers.planPomodoroBulletMove(content, {
    scope: "entry",
    targets: discovery.targets,
    sourceEntryLine: discovery.entryLine,
    sourceRawLine: discovery.rawEntryLine,
    destination: { kind: "existing", entryLine: 3 },
  });
  assert.equal(plan.valid, false);
  assert.match(plan.error, /content that cannot be moved/);
  assert.equal(plan.after, content);
});

test("planPomodoroBulletMove scope 'entry' rejects stale source/target lines, a same-entry destination, an unresolvable destination, and a 'new' destination", () => {
  const content = pomodoroFixtureLines().join("\n");
  const discovery = helpers.discoverPomodoroEntryMoveTargets(content, 6);

  const staleSource = helpers.planPomodoroBulletMove(content, {
    scope: "entry",
    targets: discovery.targets,
    sourceEntryLine: discovery.entryLine,
    sourceRawLine: "- [ ] () — CHANGED",
    destination: { kind: "existing", entryLine: 11 },
  });
  assert.equal(staleSource.valid, false);
  assert.match(staleSource.error, /changed before it could be moved/);

  const staleTarget = helpers.planPomodoroBulletMove(content, {
    scope: "entry",
    targets: [{ line: 7, rawLine: "stale text" }],
    sourceEntryLine: discovery.entryLine,
    sourceRawLine: discovery.rawEntryLine,
    destination: { kind: "existing", entryLine: 11 },
  });
  assert.equal(staleTarget.valid, false);
  assert.match(staleTarget.error, /changed before it could be moved/);

  const sameEntry = helpers.planPomodoroBulletMove(content, {
    scope: "entry",
    targets: discovery.targets,
    sourceEntryLine: discovery.entryLine,
    sourceRawLine: discovery.rawEntryLine,
    destination: { kind: "existing", entryLine: discovery.entryLine },
  });
  assert.equal(sameEntry.valid, false);
  assert.match(sameEntry.error, /Choose a different Pomodoro/);

  const missingEntry = helpers.planPomodoroBulletMove(content, {
    scope: "entry",
    targets: discovery.targets,
    sourceEntryLine: discovery.entryLine,
    sourceRawLine: discovery.rawEntryLine,
    destination: { kind: "existing", entryLine: 999 },
  });
  assert.equal(missingEntry.valid, false);
  assert.match(missingEntry.error, /could not be found/);

  const newDestination = helpers.planPomodoroBulletMove(content, {
    scope: "entry",
    targets: discovery.targets,
    sourceEntryLine: discovery.entryLine,
    sourceRawLine: discovery.rawEntryLine,
    destination: { kind: "new", name: "SOMETHING" },
  });
  assert.equal(newDestination.valid, false);
  assert.match(newDestination.error, /Choose a Pomodoro destination/);
});

test("planPomodoroBulletMove scope 'entry' deletes the first, a middle, and the last entry, preserving structure across LF/CRLF and trailing-newline state", () => {
  const buildContent = (eol, trailingNewline) => {
    const lines = [
      "## Pomodoros",
      "- [ ] () — A",
      "\t- [[x#^a]]",
      "- [ ] () — B",
      "\t- [[x#^b]]",
      "- [ ] () — C",
      "\t- [[x#^c]]",
      "## Not Pomodoros",
    ];
    return lines.join(eol) + (trailingNewline ? eol : "");
  };

  for (const eol of ["\n", "\r\n"]) {
    for (const trailingNewline of [false, true]) {
      const content = buildContent(eol, trailingNewline);

      const firstDiscovery = helpers.discoverPomodoroEntryMoveTargets(content, 1);
      const firstPlan = helpers.planPomodoroBulletMove(content, {
        scope: "entry",
        targets: firstDiscovery.targets,
        sourceEntryLine: firstDiscovery.entryLine,
        sourceRawLine: firstDiscovery.rawEntryLine,
        destination: { kind: "existing", entryLine: 3 },
      });
      assert.equal(firstPlan.valid, true);
      assert.equal(firstPlan.sourcePomodoroDeleted, true);
      assert.equal(
        firstPlan.after,
        [
          "## Pomodoros",
          "- [ ] () — B",
          "\t- [[x#^b]]",
          "\t- [[x#^a]]",
          "- [ ] () — C",
          "\t- [[x#^c]]",
          "## Not Pomodoros",
        ].join(eol) + (trailingNewline ? eol : ""),
      );

      const middleDiscovery = helpers.discoverPomodoroEntryMoveTargets(content, 3);
      const middlePlan = helpers.planPomodoroBulletMove(content, {
        scope: "entry",
        targets: middleDiscovery.targets,
        sourceEntryLine: middleDiscovery.entryLine,
        sourceRawLine: middleDiscovery.rawEntryLine,
        destination: { kind: "existing", entryLine: 5 },
      });
      assert.equal(middlePlan.valid, true);
      assert.equal(middlePlan.sourcePomodoroDeleted, true);
      assert.equal(
        middlePlan.after,
        [
          "## Pomodoros",
          "- [ ] () — A",
          "\t- [[x#^a]]",
          "- [ ] () — C",
          "\t- [[x#^c]]",
          "\t- [[x#^b]]",
          "## Not Pomodoros",
        ].join(eol) + (trailingNewline ? eol : ""),
      );

      const lastDiscovery = helpers.discoverPomodoroEntryMoveTargets(content, 5);
      const lastPlan = helpers.planPomodoroBulletMove(content, {
        scope: "entry",
        targets: lastDiscovery.targets,
        sourceEntryLine: lastDiscovery.entryLine,
        sourceRawLine: lastDiscovery.rawEntryLine,
        destination: { kind: "existing", entryLine: 1 },
      });
      assert.equal(lastPlan.valid, true);
      assert.equal(lastPlan.sourcePomodoroDeleted, true);
      assert.equal(
        lastPlan.after,
        [
          "## Pomodoros",
          "- [ ] () — A",
          "\t- [[x#^a]]",
          "\t- [[x#^c]]",
          "- [ ] () — B",
          "\t- [[x#^b]]",
          "## Not Pomodoros",
        ].join(eol) + (trailingNewline ? eol : ""),
      );
    }
  }
});

test("planPomodoroBulletMove scope 'entry' deletes closed and cancelled source entries the same way as open ones", () => {
  for (const status of [" ", "x", "-"]) {
    const content = [
      "## Pomodoros",
      `- [${status}] () — SOURCE`,
      "\t- [[x#^one]]",
      "- [ ] () — DEST",
      "\t- [[x#^existing]]",
    ].join("\n");
    const discovery = helpers.discoverPomodoroEntryMoveTargets(content, 1);
    const plan = helpers.planPomodoroBulletMove(content, {
      scope: "entry",
      targets: discovery.targets,
      sourceEntryLine: discovery.entryLine,
      sourceRawLine: discovery.rawEntryLine,
      destination: { kind: "existing", entryLine: 3 },
    });
    assert.equal(plan.valid, true);
    assert.equal(plan.sourcePomodoroDeleted, true);
    assert.equal(plan.after, [
      "## Pomodoros",
      "- [ ] () — DEST",
      "\t- [[x#^existing]]",
      "\t- [[x#^one]]",
    ].join("\n"));
  }
});

