const test = require("node:test");
const assert = require("node:assert/strict");
const {
  helpers,
  pomodoroFixtureLines,
  countedPomodoroReorderLines,
  currentPomodoroSwapLines,
  currentPomodoroSwappedLines,
  countedCurrentPomodoroSwapLines,
} = require("./navigation-hotkeys-harness.cjs");

test("isMovablePomodoroEntryContext matches open current and future Pomodoro entries", () => {
  const content = pomodoroFixtureLines().join("\n");
  assert.equal(
    helpers.isMovablePomodoroEntryContext(
      helpers.findPomodoroEntryContext(content, 1),
    ),
    false,
  );
  assert.equal(
    helpers.isMovablePomodoroEntryContext(
      helpers.findPomodoroEntryContext(content, 4),
    ),
    true,
  );
  assert.equal(
    helpers.isMovablePomodoroEntryContext(
      helpers.findPomodoroEntryContext(content, 6),
    ),
    true,
  );
  assert.equal(helpers.isMovablePomodoroEntryContext(null), false);
});

test("planPomodoroEntryReorder swaps the current Pomodoro down with the next future placeholder", () => {
  const content = currentPomodoroSwapLines().join("\n");
  const plan = helpers.planPomodoroEntryReorder(content, {
    sourceEntryLine: 3,
    sourceRawLine: "- [ ] (**0920-0950** [t:: 30m]) — ALPHA",
    direction: 1,
  });

  assert.equal(plan.valid, true);
  assert.equal(plan.after, currentPomodoroSwappedLines().join("\n"));
  assert.equal(plan.movedEntryLine, 5);
  assert.equal(plan.entry.entryLine, 3);
  assert.equal(plan.neighborEntry.entryLine, 5);
});

test("planPomodoroEntryReorder promotes a future Pomodoro up into the current slot", () => {
  const content = currentPomodoroSwapLines().join("\n");
  const plan = helpers.planPomodoroEntryReorder(content, {
    sourceEntryLine: 5,
    sourceRawLine: "- [ ] () — BETA",
    direction: -1,
  });

  assert.equal(plan.valid, true);
  assert.equal(plan.after, currentPomodoroSwappedLines().join("\n"));
  assert.equal(plan.movedEntryLine, 3);
  assert.equal(plan.entry.entryLine, 5);
  assert.equal(plan.neighborEntry.entryLine, 3);
});

test("planPomodoroEntryReorder preserves exact range text, status prefixes, and subtree ownership across current swaps", () => {
  const content = [
    "# Daily",
    "## Pomodoros",
    "- [/] (**10:00-10:25** [t:: 25m]) — CUR",
    "\t- first",
    "\t\t- nested",
    "\t- second",
    "- [/] (  ) — HALF",
    "- [ ] () — EMPTY",
    "## Tasks",
    "- [ ] #task outside",
  ].join("\n");
  const down = helpers.planPomodoroEntryReorder(content, {
    sourceEntryLine: 2,
    sourceRawLine: "- [/] (**10:00-10:25** [t:: 25m]) — CUR",
    direction: 1,
    repeat: 2,
  });

  assert.equal(down.valid, true);
  assert.equal(
    down.after,
    [
      "# Daily",
      "## Pomodoros",
      "- [/] (**10:00-10:25** [t:: 25m]) — HALF",
      "- [ ] () — EMPTY",
      "- [/] (  ) — CUR",
      "\t- first",
      "\t\t- nested",
      "\t- second",
      "## Tasks",
      "- [ ] #task outside",
    ].join("\n"),
  );
  assert.equal(down.movedEntryLine, 4);

  const backUp = helpers.planPomodoroEntryReorder(down.after, {
    sourceEntryLine: down.movedEntryLine,
    sourceRawLine: "- [/] (  ) — CUR",
    direction: -1,
    repeat: 2,
  });
  assert.equal(backUp.valid, true);
  assert.equal(backUp.after, content);
});

test("planPomodoroEntryReorder preserves compact ranges, embedded metadata dashes, and placeholder whitespace", () => {
  const content = [
    "## Pomodoros",
    "- [ ] (0920-0950 [t:: 30m — extra]) — ALPHA",
    "- [ ] ( \t ) — BETA",
  ].join("\n");
  const down = helpers.planPomodoroEntryReorder(content, {
    sourceEntryLine: 1,
    sourceRawLine: "- [ ] (0920-0950 [t:: 30m — extra]) — ALPHA",
    direction: 1,
  });

  assert.equal(down.valid, true);
  assert.equal(
    down.after,
    [
      "## Pomodoros",
      "- [ ] (0920-0950 [t:: 30m — extra]) — BETA",
      "- [ ] ( \t ) — ALPHA",
    ].join("\n"),
  );

  const backUp = helpers.planPomodoroEntryReorder(down.after, {
    sourceEntryLine: 2,
    sourceRawLine: "- [ ] ( \t ) — ALPHA",
    direction: -1,
  });
  assert.equal(backUp.valid, true);
  assert.equal(backUp.after, content);
});

test("planPomodoroEntryReorder handles counted current swaps and their inverses", () => {
  const content = countedCurrentPomodoroSwapLines().join("\n");
  const down = helpers.planPomodoroEntryReorder(content, {
    sourceEntryLine: 1,
    sourceRawLine: "- [ ] (**0900-0930** [t:: 30m]) — A",
    direction: 1,
    repeat: 2,
  });
  assert.equal(down.valid, true);
  assert.equal(
    down.after,
    [
      "## Pomodoros",
      "- [ ] (**0900-0930** [t:: 30m]) — B",
      "- [ ] () — C",
      "- [ ] (  ) — A",
    ].join("\n"),
  );
  assert.equal(down.movedEntryLine, 3);

  const downInverse = helpers.planPomodoroEntryReorder(down.after, {
    sourceEntryLine: down.movedEntryLine,
    sourceRawLine: "- [ ] (  ) — A",
    direction: -1,
    repeat: 2,
  });
  assert.equal(downInverse.valid, true);
  assert.equal(downInverse.after, content);

  const up = helpers.planPomodoroEntryReorder(content, {
    sourceEntryLine: 3,
    sourceRawLine: "- [ ] () — C",
    direction: -1,
    repeat: 2,
  });
  assert.equal(up.valid, true);
  assert.equal(
    up.after,
    [
      "## Pomodoros",
      "- [ ] (**0900-0930** [t:: 30m]) — C",
      "- [ ] () — A",
      "- [ ] (  ) — B",
    ].join("\n"),
  );
  assert.equal(up.movedEntryLine, 1);

  const upInverse = helpers.planPomodoroEntryReorder(up.after, {
    sourceEntryLine: up.movedEntryLine,
    sourceRawLine: "- [ ] (**0900-0930** [t:: 30m]) — C",
    direction: 1,
    repeat: 2,
  });
  assert.equal(upInverse.valid, true);
  assert.equal(upInverse.after, content);
});

test("planPomodoroEntryReorder moves a named placeholder down, swapping with the next placeholder", () => {
  const content = pomodoroFixtureLines().join("\n");
  const beforeLines = content.split("\n");
  const plan = helpers.planPomodoroEntryReorder(content, {
    sourceEntryLine: 9,
    sourceRawLine: "- [ ] () — BODY",
    direction: 1,
  });

  assert.equal(plan.valid, true);
  const afterLines = plan.after.split("\n");
  assert.equal(afterLines.length, beforeLines.length);
  assert.equal(afterLines[9], "- [ ] () — VERIFY");
  assert.equal(
    afterLines[10],
    "\t- [[sase_better_config#^no-focus-xprompts]]",
  );
  assert.equal(afterLines[11], "- [ ] () — BODY");
  assert.equal(afterLines[12], "\t- [[body#^email-jenika]]");
  assert.equal(plan.movedEntryLine, 11);
  assert.equal(plan.entry.entryLine, 9);
  assert.equal(plan.neighborEntry.entryLine, 11);
  assert.equal(plan.direction, 1);
});

test("planPomodoroEntryReorder moves a placeholder up, swapping with the previous placeholder", () => {
  const content = pomodoroFixtureLines().join("\n");
  const plan = helpers.planPomodoroEntryReorder(content, {
    sourceEntryLine: 11,
    sourceRawLine: "- [ ] () — VERIFY",
    direction: -1,
  });

  assert.equal(plan.valid, true);
  const afterLines = plan.after.split("\n");
  assert.equal(afterLines[9], "- [ ] () — VERIFY");
  assert.equal(afterLines[11], "- [ ] () — BODY");
  assert.equal(plan.movedEntryLine, 9);
  assert.equal(plan.direction, -1);
});

test("planPomodoroEntryReorder round-trips unequal-size blocks: down then up restores the original content", () => {
  const content = pomodoroFixtureLines().join("\n");
  const down = helpers.planPomodoroEntryReorder(content, {
    sourceEntryLine: 6,
    sourceRawLine: "- [ ] ()",
    direction: 1,
  });
  assert.equal(down.valid, true);
  assert.equal(down.movedEntryLine, 8);
  assert.equal(down.after.split("\n").length, content.split("\n").length);

  const backUp = helpers.planPomodoroEntryReorder(down.after, {
    sourceEntryLine: down.movedEntryLine,
    sourceRawLine: "- [ ] ()",
    direction: -1,
  });
  assert.equal(backUp.valid, true);
  assert.equal(backUp.movedEntryLine, 6);
  assert.equal(backUp.after, content);
});

test("planPomodoroEntryReorder round-trips a future-up swap across the current open entry", () => {
  const content = pomodoroFixtureLines().join("\n");
  const plan = helpers.planPomodoroEntryReorder(content, {
    sourceEntryLine: 6,
    sourceRawLine: "- [ ] ()",
    direction: -1,
  });
  assert.equal(plan.valid, true);
  assert.equal(plan.movedEntryLine, 4);
  assert.equal(plan.after.split("\n")[4], "- [ ] (**0920-0950** [t:: 30m])");
  assert.equal(plan.after.split("\n")[7], "- [ ] ()");

  const backDown = helpers.planPomodoroEntryReorder(plan.after, {
    sourceEntryLine: plan.movedEntryLine,
    sourceRawLine: "- [ ] (**0920-0950** [t:: 30m])",
    direction: 1,
  });
  assert.equal(backDown.valid, true);
  assert.equal(backDown.after, content);
});

test("planPomodoroEntryReorder refuses moving up past a closed or cancelled entry", () => {
  const closedAbove = ["## Pomodoros", "- [x] (**0900-0930**)", "- [ ] ()"].join(
    "\n",
  );
  const closedPlan = helpers.planPomodoroEntryReorder(closedAbove, {
    sourceEntryLine: 2,
    sourceRawLine: "- [ ] ()",
    direction: -1,
  });
  assert.equal(closedPlan.valid, false);
  assert.match(closedPlan.error, /current\/history boundary/);
  assert.equal(closedPlan.after, closedAbove);

  const cancelledAbove = ["## Pomodoros", "- [-] ()", "- [ ] ()"].join("\n");
  const cancelledPlan = helpers.planPomodoroEntryReorder(cancelledAbove, {
    sourceEntryLine: 2,
    sourceRawLine: "- [ ] ()",
    direction: -1,
  });
  assert.equal(cancelledPlan.valid, false);
  assert.match(cancelledPlan.error, /current\/history boundary/);
  assert.equal(cancelledPlan.after, cancelledAbove);
});

test("planPomodoroEntryReorder refuses moving down past the last placeholder in the section", () => {
  const content = pomodoroFixtureLines().join("\n");
  const plan = helpers.planPomodoroEntryReorder(content, {
    sourceEntryLine: 11,
    sourceRawLine: "- [ ] () — VERIFY",
    direction: 1,
  });
  assert.equal(plan.valid, false);
  assert.match(plan.error, /available future Pomodoros/);
  assert.equal(plan.after, content);
});

test("planPomodoroEntryReorder refuses both directions for a lone placeholder", () => {
  const content = "## Pomodoros\n- [ ] ()";
  const down = helpers.planPomodoroEntryReorder(content, {
    sourceEntryLine: 1,
    sourceRawLine: "- [ ] ()",
    direction: 1,
  });
  assert.equal(down.valid, false);
  assert.match(down.error, /last planned Pomodoro/);

  const up = helpers.planPomodoroEntryReorder(content, {
    sourceEntryLine: 1,
    sourceRawLine: "- [ ] ()",
    direction: -1,
  });
  assert.equal(up.valid, false);
  assert.match(up.error, /first planned Pomodoro/);
});

test("planPomodoroEntryReorder keeps a blank separator between two placeholders after the swap", () => {
  const content = ["## Pomodoros", "- [ ] () — A", "", "- [ ] () — B"].join(
    "\n",
  );
  const plan = helpers.planPomodoroEntryReorder(content, {
    sourceEntryLine: 1,
    sourceRawLine: "- [ ] () — A",
    direction: 1,
  });
  assert.equal(plan.valid, true);
  assert.equal(
    plan.after,
    ["## Pomodoros", "- [ ] () — B", "", "- [ ] () — A"].join("\n"),
  );
  assert.equal(plan.movedEntryLine, 3);
});

test("planPomodoroEntryReorder accepts the current timed entry but refuses closed or cancelled sources", () => {
  const content = pomodoroFixtureLines().join("\n");
  const timespanPlan = helpers.planPomodoroEntryReorder(content, {
    sourceEntryLine: 4,
    direction: 1,
  });
  assert.equal(timespanPlan.valid, true);
  assert.equal(timespanPlan.movedEntryLine, 7);

  const closedPlan = helpers.planPomodoroEntryReorder(
    "## Pomodoros\n- [x] (**0900-0930**)",
    { sourceEntryLine: 1, direction: 1 },
  );
  assert.equal(closedPlan.valid, false);
  assert.equal(
    closedPlan.error,
    "Only open current or future Pomodoros can be moved",
  );

  const cancelledPlan = helpers.planPomodoroEntryReorder(
    "## Pomodoros\n- [-] ()",
    { sourceEntryLine: 1, direction: 1 },
  );
  assert.equal(cancelledPlan.valid, false);
  assert.equal(
    cancelledPlan.error,
    "Only open current or future Pomodoros can be moved",
  );
});

test("planPomodoroEntryReorder refuses illegal current/future spans atomically", () => {
  const cases = [
    {
      name: "current up",
      content: currentPomodoroSwapLines().join("\n"),
      options: {
        sourceEntryLine: 3,
        sourceRawLine: "- [ ] (**0920-0950** [t:: 30m]) — ALPHA",
        direction: -1,
      },
      error: /current\/history boundary/,
    },
    {
      name: "lone current down",
      content: "## Pomodoros\n- [ ] (**0900-0930**) — SOLO",
      options: {
        sourceEntryLine: 1,
        sourceRawLine: "- [ ] (**0900-0930**) — SOLO",
        direction: 1,
      },
      error: /available future Pomodoros/,
    },
    {
      name: "insufficient future entries",
      content: currentPomodoroSwapLines().join("\n"),
      options: {
        sourceEntryLine: 3,
        sourceRawLine: "- [ ] (**0920-0950** [t:: 30m]) — ALPHA",
        direction: 1,
        repeat: 2,
      },
      error: /available future Pomodoros/,
    },
    {
      name: "placeholder above current moving down",
      content: [
        "## Pomodoros",
        "- [ ] () — FUTURE ABOVE",
        "- [ ] (**0900-0930**) — CURRENT",
      ].join("\n"),
      options: {
        sourceEntryLine: 1,
        sourceRawLine: "- [ ] () — FUTURE ABOVE",
        direction: 1,
      },
      error: /current\/history boundary/,
    },
    {
      name: "interior timed entry",
      content: [
        "## Pomodoros",
        "- [ ] () — A",
        "- [ ] (**0900-0930**) — CURRENT",
        "- [ ] () — C",
      ].join("\n"),
      options: {
        sourceEntryLine: 1,
        sourceRawLine: "- [ ] () — A",
        direction: 1,
        repeat: 2,
      },
      error: /current\/history boundary/,
    },
    {
      name: "multiple timed entries",
      content: [
        "## Pomodoros",
        "- [ ] (**0900-0930**) — A",
        "- [ ] (**0930-1000**) — B",
        "- [ ] () — C",
      ].join("\n"),
      options: {
        sourceEntryLine: 1,
        sourceRawLine: "- [ ] (**0900-0930**) — A",
        direction: 1,
        repeat: 2,
      },
      error: /current\/history boundary/,
    },
    {
      name: "counted move that could swap once but not twice",
      content: [
        "## Pomodoros",
        "- [ ] (**0900-0930**) — A",
        "- [ ] () — B",
        "- [ ] (**0930-1000**) — C",
      ].join("\n"),
      options: {
        sourceEntryLine: 1,
        sourceRawLine: "- [ ] (**0900-0930**) — A",
        direction: 1,
        repeat: 2,
      },
      error: /current\/history boundary/,
    },
    {
      name: "closed crossed entry",
      content: [
        "## Pomodoros",
        "- [ ] (**0900-0930**) — CURRENT",
        "- [x] (**0930-1000**) — DONE",
        "- [ ] () — NEXT",
      ].join("\n"),
      options: {
        sourceEntryLine: 1,
        sourceRawLine: "- [ ] (**0900-0930**) — CURRENT",
        direction: 1,
        repeat: 2,
      },
      error: /current\/history boundary/,
    },
    {
      name: "cancelled crossed entry",
      content: [
        "## Pomodoros",
        "- [ ] (**0900-0930**) — CURRENT",
        "- [-] () — CANCELLED",
        "- [ ] () — NEXT",
      ].join("\n"),
      options: {
        sourceEntryLine: 1,
        sourceRawLine: "- [ ] (**0900-0930**) — CURRENT",
        direction: 1,
        repeat: 2,
      },
      error: /current\/history boundary/,
    },
  ];

  for (const item of cases) {
    const plan = helpers.planPomodoroEntryReorder(item.content, item.options);
    assert.equal(plan.valid, false, item.name);
    assert.equal(plan.after, item.content, item.name);
    assert.equal(plan.movedEntryLine, null, item.name);
    assert.match(plan.error, item.error, item.name);
  }
});

test("planPomodoroEntryReorder rejects a stale source line", () => {
  const content = pomodoroFixtureLines().join("\n");
  const plan = helpers.planPomodoroEntryReorder(content, {
    sourceEntryLine: 6,
    sourceRawLine: "- [ ] () — WRONG",
    direction: 1,
  });
  assert.equal(plan.valid, false);
  assert.match(plan.error, /changed before it could be moved/);
});

test("planPomodoroEntryReorder round-trips CRLF content", () => {
  const lfContent = pomodoroFixtureLines().join("\n");
  const crlfContent = pomodoroFixtureLines().join("\r\n");
  const lfPlan = helpers.planPomodoroEntryReorder(lfContent, {
    sourceEntryLine: 9,
    sourceRawLine: "- [ ] () — BODY",
    direction: 1,
  });
  const crlfPlan = helpers.planPomodoroEntryReorder(crlfContent, {
    sourceEntryLine: 9,
    sourceRawLine: "- [ ] () — BODY",
    direction: 1,
  });

  assert.equal(crlfPlan.valid, true);
  assert.equal(crlfPlan.after, lfPlan.after.split("\n").join("\r\n"));
  assert.equal(crlfPlan.movedEntryLine, lfPlan.movedEntryLine);
});

test("planPomodoroEntryReorder leaves content outside the two swapped blocks untouched", () => {
  const content = pomodoroFixtureLines().join("\n");
  const beforeLines = content.split("\n");
  const plan = helpers.planPomodoroEntryReorder(content, {
    sourceEntryLine: 6,
    sourceRawLine: "- [ ] ()",
    direction: 1,
  });
  assert.equal(plan.valid, true);
  const afterLines = plan.after.split("\n");
  for (let i = 0; i <= 5; i += 1) {
    assert.equal(afterLines[i], beforeLines[i]);
  }
  assert.equal(afterLines[13], "## Not Pomodoros");
  assert.equal(afterLines[13], beforeLines[13]);
});

test("planPomodoroEntryReorder moves a named placeholder down three positions with its subtree", () => {
  const beforeLines = countedPomodoroReorderLines();
  const content = beforeLines.join("\n");
  const plan = helpers.planPomodoroEntryReorder(content, {
    sourceEntryLine: 5,
    sourceRawLine: "- [ ] () — BODY",
    direction: 1,
    repeat: 3,
  });

  assert.equal(plan.valid, true);
  assert.equal(plan.repeat, 3);
  assert.equal(plan.direction, 1);
  assert.equal(plan.entry.entryLine, 5);
  assert.equal(plan.neighborEntry.entryLine, 14);
  assert.equal(plan.movedEntryLine, 14);
  assert.equal(plan.after.split("\n").length, beforeLines.length);

  const afterLines = plan.after.split("\n");
  assert.equal(afterLines[5], "- [ ] () — NEXT");
  assert.equal(afterLines[6], "\t- [[next#^only]]");
  assert.equal(afterLines[7], "");
  assert.equal(afterLines[8], "- [ ] () — THEN");
  assert.equal(afterLines[9], "stray prose between NEXT and THEN");
  assert.equal(afterLines[10], "- [ ] () — LAST");
  assert.equal(afterLines[11], "\t- [[last#^a]]");
  assert.equal(afterLines[12], "\t- [[last#^b]]");
  assert.equal(afterLines[13], "\t- [[last#^c]]");
  assert.equal(afterLines[14], "- [ ] () — BODY");
  assert.equal(afterLines[15], "\t- [[body#^one]]");
  assert.equal(afterLines[16], "\t- [[body#^two]]");
  assert.equal(afterLines[17], "\t\t- nested under two");
  assert.equal(afterLines[0], "# Daily");
  assert.equal(afterLines[1], "Intro prose stays put");
  assert.equal(afterLines[3], "- [x] (**0800-0830** [t:: 30m])");
  assert.equal(afterLines[18], "## Tasks");
  assert.equal(afterLines[21], "- [ ] () — OTHER SECTION");
});

test("planPomodoroEntryReorder moves a placeholder up three positions and round-trips", () => {
  const content = countedPomodoroReorderLines().join("\n");
  const down = helpers.planPomodoroEntryReorder(content, {
    sourceEntryLine: 5,
    sourceRawLine: "- [ ] () — BODY",
    direction: 1,
    repeat: 3,
  });
  assert.equal(down.valid, true);

  const up = helpers.planPomodoroEntryReorder(content, {
    sourceEntryLine: 14,
    sourceRawLine: "- [ ] () — LAST",
    direction: -1,
    repeat: 3,
  });
  assert.equal(up.valid, true);
  assert.equal(up.repeat, 3);
  assert.equal(up.direction, -1);
  assert.equal(up.movedEntryLine, 5);
  assert.equal(up.neighborEntry.entryLine, 5);
  assert.equal(up.after.split("\n")[5], "- [ ] () — LAST");
  assert.equal(up.after.split("\n")[10], "- [ ] () — BODY");

  const backUp = helpers.planPomodoroEntryReorder(down.after, {
    sourceEntryLine: down.movedEntryLine,
    sourceRawLine: "- [ ] () — BODY",
    direction: -1,
    repeat: 3,
  });
  assert.equal(backUp.valid, true);
  assert.equal(backUp.after, content);
});

test("planPomodoroEntryReorder keeps unequal gaps in their slots during a counted rotate", () => {
  const content = countedPomodoroReorderLines().join("\n");
  const plan = helpers.planPomodoroEntryReorder(content, {
    sourceEntryLine: 5,
    sourceRawLine: "- [ ] () — BODY",
    direction: 1,
    repeat: 3,
  });
  const afterLines = plan.after.split("\n");
  assert.equal(afterLines[7], "");
  assert.equal(afterLines[9], "stray prose between NEXT and THEN");
  assert.equal(afterLines[13], "\t- [[last#^c]]");
  assert.equal(afterLines[14], "- [ ] () — BODY");
});

test("planPomodoroEntryReorder refuses a counted move atomically at the planned-run boundary", () => {
  const content = countedPomodoroReorderLines().join("\n");
  const offEnd = helpers.planPomodoroEntryReorder(content, {
    sourceEntryLine: 5,
    sourceRawLine: "- [ ] () — BODY",
    direction: 1,
    repeat: 4,
  });
  assert.equal(offEnd.valid, false);
  assert.equal(offEnd.after, content);
  assert.equal(offEnd.movedEntryLine, null);
  assert.equal(offEnd.repeat, 4);
  assert.equal(
    offEnd.error,
    "BODY cannot move down 4 positions without crossing the last planned Pomodoro",
  );

  const offStart = helpers.planPomodoroEntryReorder(content, {
    sourceEntryLine: 14,
    sourceRawLine: "- [ ] () — LAST",
    direction: -1,
    repeat: 4,
  });
  assert.equal(offStart.valid, false);
  assert.equal(offStart.after, content);
  assert.equal(offStart.movedEntryLine, null);
  assert.equal(
    offStart.error,
    "LAST cannot move up 4 positions across the current/history boundary",
  );

  const blockedLines = countedPomodoroReorderLines().slice();
  blockedLines[13] = "- [ ] (**0920-0950** [t:: 30m])";
  const blockedContent = blockedLines.join("\n");
  const blocked = helpers.planPomodoroEntryReorder(blockedContent, {
    sourceEntryLine: 5,
    sourceRawLine: "- [ ] () — BODY",
    direction: 1,
    repeat: 3,
  });
  assert.equal(blocked.valid, false);
  assert.equal(blocked.after, blockedContent);
  assert.equal(blocked.movedEntryLine, null);
  assert.equal(
    blocked.error,
    "BODY cannot move down 3 positions across the current/history boundary",
  );

  const closedLines = countedPomodoroReorderLines().slice();
  closedLines[13] = "- [x] (**0920-0950** [t:: 30m])";
  const closedContent = closedLines.join("\n");
  const closed = helpers.planPomodoroEntryReorder(closedContent, {
    sourceEntryLine: 5,
    sourceRawLine: "- [ ] () — BODY",
    direction: 1,
    repeat: 3,
  });
  assert.equal(closed.valid, false);
  assert.equal(closed.after, closedContent);
  assert.equal(
    closed.error,
    "BODY cannot move down 3 positions across the current/history boundary",
  );

  const cancelledLines = countedPomodoroReorderLines().slice();
  cancelledLines[13] = "- [-] () — THEN";
  const cancelledContent = cancelledLines.join("\n");
  const cancelled = helpers.planPomodoroEntryReorder(cancelledContent, {
    sourceEntryLine: 5,
    sourceRawLine: "- [ ] () — BODY",
    direction: 1,
    repeat: 3,
  });
  assert.equal(cancelled.valid, false);
  assert.equal(cancelled.after, cancelledContent);
  assert.equal(
    cancelled.error,
    "BODY cannot move down 3 positions across the current/history boundary",
  );
});

test("planPomodoroEntryReorder repeat 1 matches the uncounted plan and normalizes invalid counts", () => {
  const content = pomodoroFixtureLines().join("\n");
  const uncounted = helpers.planPomodoroEntryReorder(content, {
    sourceEntryLine: 9,
    sourceRawLine: "- [ ] () — BODY",
    direction: 1,
  });
  const explicitOne = helpers.planPomodoroEntryReorder(content, {
    sourceEntryLine: 9,
    sourceRawLine: "- [ ] () — BODY",
    direction: 1,
    repeat: 1,
  });
  assert.equal(uncounted.valid, true);
  assert.equal(uncounted.repeat, 1);
  assert.equal(explicitOne.after, uncounted.after);
  assert.equal(explicitOne.movedEntryLine, uncounted.movedEntryLine);
  assert.equal(explicitOne.neighborEntry.entryLine, uncounted.neighborEntry.entryLine);
  assert.equal(explicitOne.repeat, 1);

  for (const repeat of [0, -4, null, "nope", 1.2]) {
    const plan = helpers.planPomodoroEntryReorder(content, {
      sourceEntryLine: 9,
      sourceRawLine: "- [ ] () — BODY",
      direction: 1,
      repeat,
    });
    assert.equal(plan.after, uncounted.after);
    assert.equal(plan.repeat, 1);
    assert.equal(plan.movedEntryLine, uncounted.movedEntryLine);
  }

  const last = helpers.planPomodoroEntryReorder(content, {
    sourceEntryLine: 11,
    sourceRawLine: "- [ ] () — VERIFY",
    direction: 1,
    repeat: 1,
  });
  assert.equal(last.valid, false);
  assert.match(last.error, /available future Pomodoros/);
  assert.doesNotMatch(last.error, /positions/);
});

test("planPomodoroEntryReorder counted plans preserve CRLF, line count, and outside bytes", () => {
  const lfLines = countedPomodoroReorderLines();
  const lfContent = lfLines.join("\n");
  const crlfContent = lfLines.join("\r\n");
  const lfPlan = helpers.planPomodoroEntryReorder(lfContent, {
    sourceEntryLine: 5,
    sourceRawLine: "- [ ] () — BODY",
    direction: 1,
    repeat: 3,
  });
  const crlfPlan = helpers.planPomodoroEntryReorder(crlfContent, {
    sourceEntryLine: 5,
    sourceRawLine: "- [ ] () — BODY",
    direction: 1,
    repeat: 3,
  });

  assert.equal(crlfPlan.valid, true);
  assert.equal(crlfPlan.after, lfPlan.after.split("\n").join("\r\n"));
  assert.equal(crlfPlan.movedEntryLine, lfPlan.movedEntryLine);
  assert.equal(lfPlan.after.split("\n").length, lfLines.length);

  const afterLines = lfPlan.after.split("\n");
  for (let index = 0; index <= 4; index += 1) {
    assert.equal(afterLines[index], lfLines[index]);
  }
  for (let index = 18; index < lfLines.length; index += 1) {
    assert.equal(afterLines[index], lfLines[index]);
  }
});

