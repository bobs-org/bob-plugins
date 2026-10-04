const test = require("node:test");
const assert = require("node:assert/strict");
const {
  notices,
  helpers,
  createPomodoroMovePickerHarness,
  pomodoroFixtureLines,
} = require("./navigation-hotkeys-harness.cjs");

test("peelPomodoroMergedName removes every matching canonical plus component", () => {
  const cases = [
    ["BUILD + REVIEW", "review", "BUILD", "REVIEW"],
    ["BUILD + REVIEW", "build", "REVIEW", "BUILD"],
    [" build   +   review + email ", "email", "BUILD + REVIEW", "EMAIL"],
    ["BUILD + REVIEW + EMAIL", "review", "BUILD + EMAIL", "REVIEW"],
    ["C++ + review", "review", "C++", "REVIEW"],
    ["C++ + review", "c++", "REVIEW", "C++"],
    ["BUILD + REVIEW + BUILD", "build", "REVIEW", "BUILD"],
    ["NAME + NAME", "name", "", "NAME"],
    ["FOCUS", "focus", "", "FOCUS"],
    ["BUILD + REVIEW", "BUILD + REVIEW", "", "BUILD + REVIEW"],
    ["ALPHA + ALPHA", "alpha", "", "ALPHA"],
  ];
  for (const [raw, requested, remainingName, splitName] of cases) {
    const result = helpers.peelPomodoroMergedName(raw, requested);
    assert.equal(result.valid, true, `${raw} / ${requested}`);
    assert.equal(result.remainingName, remainingName, `${raw} / ${requested}`);
    assert.equal(result.splitName, splitName, `${raw} / ${requested}`);
  }

  const missing = helpers.peelPomodoroMergedName("C++ + REVIEW", "email");
  assert.equal(missing.valid, false);
  assert.match(missing.error, /EMAIL is not part of this Pomodoro's name/);

  for (const raw of ["C++", "A+B", "SINGLE"]) {
    const result = helpers.peelPomodoroMergedName(raw, "review");
    assert.equal(result.valid, false, raw);
    assert.match(result.error, /REVIEW is not part of this Pomodoro's name/, raw);
  }

  const emptySource = helpers.peelPomodoroMergedName("", "review");
  assert.equal(emptySource.valid, false);
  assert.match(emptySource.error, /cannot be empty/);

  const emptyRequested = helpers.peelPomodoroMergedName("FOCUS", "");
  assert.equal(emptyRequested.valid, false);
  assert.match(emptyRequested.error, /Split name cannot be empty/);

  const overLength = helpers.peelPomodoroMergedName(
    "FOCUS",
    "X".repeat(helpers.POMODORO_NAME_MAX_LENGTH + 1),
  );
  assert.equal(overLength.valid, false);
  assert.match(overLength.error, /exceed/);
});

test("planPomodoroBulletSplit peels selected bullets into a new placeholder and preserves the source", () => {
  const content = [
    "## Pomodoros",
    "- [ ] (**0920-0950** [t:: 30m]) — BUILD + REVIEW + EMAIL",
    "\t- build work",
    "\t- review work",
    "\t- email one",
    "\t\t- follow-up",
    "\t- email two",
  ].join("\n");
  const discovery = helpers.discoverMovablePomodoroBulletTargets(content, 4, 1);
  const plan = helpers.planPomodoroBulletSplit(content, {
    targets: discovery.targets,
    sourceEntryLine: discovery.entryLine,
    sourceRawLine: "- [ ] (**0920-0950** [t:: 30m]) — BUILD + REVIEW + EMAIL",
    splitName: "email",
  });
  assert.equal(plan.valid, true);
  assert.equal(plan.sourcePomodoroPreserved, true);
  assert.equal(plan.remainingName, "BUILD + REVIEW");
  assert.equal(plan.splitName, "EMAIL");
  assert.equal(plan.movedCount, 2);
  assert.equal(plan.firstMovedLine, 5);
  assert.equal(plan.after, [
    "## Pomodoros",
    "- [ ] (**0920-0950** [t:: 30m]) — BUILD + REVIEW",
    "\t- build work",
    "\t- review work",
    "- [ ] () — EMAIL",
    "\t- email one",
    "\t\t- follow-up",
    "\t- email two",
  ].join("\n"));

  const reviewDiscovery = helpers.discoverMovablePomodoroBulletTargets(
    plan.after,
    3,
    0,
  );
  const reviewPlan = helpers.planPomodoroBulletSplit(plan.after, {
    targets: reviewDiscovery.targets,
    sourceEntryLine: reviewDiscovery.entryLine,
    splitName: "review",
  });
  assert.equal(reviewPlan.valid, true);
  assert.equal(reviewPlan.remainingName, "BUILD");
  assert.equal(reviewPlan.splitName, "REVIEW");
  assert.equal(reviewPlan.after, [
    "## Pomodoros",
    "- [ ] (**0920-0950** [t:: 30m]) — BUILD",
    "\t- build work",
    "- [ ] () — REVIEW",
    "\t- review work",
    "- [ ] () — EMAIL",
    "\t- email one",
    "\t\t- follow-up",
    "\t- email two",
  ].join("\n"));
});

test("planPomodoroBulletSplit trusts non-trailing selections, keeps duplicates, and rebases nested siblings", () => {
  const content = [
    "## Pomodoros",
    "- [ ] () — C++ + REVIEW",
    "\t- keep before",
    "\t- duplicate",
    "\t- move middle",
    "\t\t- detail",
    "\t- duplicate",
    "\t- keep after",
  ].join("\n");
  const discovery = helpers.discoverMovablePomodoroBulletTargets(content, 4, 1);
  const plan = helpers.planPomodoroBulletSplit(content, {
    targets: discovery.targets,
    sourceEntryLine: discovery.entryLine,
    splitName: "review",
  });
  assert.equal(plan.valid, true);
  assert.equal(plan.remainingName, "C++");
  assert.equal(plan.splitName, "REVIEW");
  assert.equal(plan.movedCount, 2);
  assert.equal(plan.after, [
    "## Pomodoros",
    "- [ ] () — C++",
    "\t- keep before",
    "\t- duplicate",
    "\t- keep after",
    "- [ ] () — REVIEW",
    "\t- move middle",
    "\t\t- detail",
    "\t- duplicate",
  ].join("\n"));

  const nestedSource = [
    "## Pomodoros",
    "- [ ] () — BUILD + DETAIL",
    "\t- parent",
    "\t\t- nested detail",
  ].join("\n");
  const nestedDiscovery = helpers.discoverMovablePomodoroBulletTargets(
    nestedSource,
    3,
    0,
  );
  const nestedPlan = helpers.planPomodoroBulletSplit(nestedSource, {
    targets: nestedDiscovery.targets,
    sourceEntryLine: nestedDiscovery.entryLine,
    splitName: "detail",
  });
  assert.equal(nestedPlan.valid, true);
  assert.equal(
    nestedPlan.after,
    [
      "## Pomodoros",
      "- [ ] () — BUILD",
      "\t- parent",
      "- [ ] () — DETAIL",
      "\t- nested detail",
    ].join("\n"),
  );
});

test("planPomodoroBulletSplit preserves closed source status, CRLF, trailing newline, and empty source entries", () => {
  for (const status of ["x", "-"]) {
    const content = [
      "## Pomodoros",
      `- [${status}] () — BUILD + REVIEW`,
      "\t- only review",
      "",
    ].join("\r\n");
    const discovery = helpers.discoverMovablePomodoroBulletTargets(content, 2, 0);
    const plan = helpers.planPomodoroBulletSplit(content, {
      targets: discovery.targets,
      sourceEntryLine: discovery.entryLine,
      splitName: "review",
    });
    assert.equal(plan.valid, true, status);
    assert.equal(/[^\r]\n/.test(plan.after), false, status);
    assert.equal(plan.after.endsWith("\r\n"), true, status);
    assert.equal(plan.after, [
      "## Pomodoros",
      `- [${status}] () — BUILD`,
      "- [ ] () — REVIEW",
      "\t- only review",
      "",
    ].join("\r\n"), status);
  }
});

test("planPomodoroBulletSplit refuses invalid, stale, unsupported, and missing-component sources without mutation", () => {
  const cases = [
    {
      label: "missing component on C++",
      content: "## Pomodoros\n- [ ] () — C++\n\t- work",
      cursorLine: 2,
      options: { splitName: "review" },
      pattern: /REVIEW is not part of this Pomodoro's name/,
    },
    {
      label: "adjacent plus",
      content: "## Pomodoros\n- [ ] () — A+B\n\t- work",
      cursorLine: 2,
      options: { splitName: "review" },
      pattern: /REVIEW is not part of this Pomodoro's name/,
    },
    {
      label: "unnamed source",
      content: "## Pomodoros\n- [ ] ()\n\t- work",
      cursorLine: 2,
      options: { splitName: "review" },
      pattern: /cannot be empty/,
    },
    {
      label: "empty requested name",
      content: "## Pomodoros\n- [ ] () — FOCUS\n\t- work",
      cursorLine: 2,
      options: { splitName: "" },
      pattern: /Split name cannot be empty/,
    },
    {
      label: "unsupported tail",
      content: "## Pomodoros\n- [ ] () trailing\n\t- work",
      cursorLine: 2,
      options: { splitName: "review" },
      pattern: /unsupported trailing content/,
    },
    {
      label: "stale source",
      content: "## Pomodoros\n- [ ] () — A + B\n\t- work",
      cursorLine: 2,
      options: { sourceRawLine: "- [ ] () — OLD + B", splitName: "b" },
      pattern: /changed before it could be split/,
    },
    {
      label: "stale target",
      content: "## Pomodoros\n- [ ] () — A + B\n\t- work",
      cursorLine: 2,
      options: { targets: [{ line: 2, rawLine: "\t- stale" }], splitName: "b" },
      pattern: /selected bullet changed/,
    },
  ];

  for (const item of cases) {
    const discovery = helpers.discoverMovablePomodoroBulletTargets(
      item.content,
      item.cursorLine,
      0,
    );
    const plan = helpers.planPomodoroBulletSplit(item.content, {
      targets: item.options.targets || discovery.targets,
      sourceEntryLine: discovery.entryLine,
      sourceRawLine:
        item.options.sourceRawLine === undefined
          ? discovery.context
            ? item.content.split("\n")[discovery.entryLine]
            : undefined
          : item.options.sourceRawLine,
      splitName: item.options.splitName,
    });
    assert.equal(plan.valid, false, item.label);
    assert.match(plan.error, item.pattern, item.label);
    assert.equal(plan.after, item.content, item.label);
  }
});

test("planPomodoroBulletSplit peels first, middle, and last components and unnames a whole-name peel", () => {
  const content = [
    "## Pomodoros",
    "- [ ] (**0920-0950** [t:: 30m]) — BUILD + REVIEW + EMAIL",
    "\t- build work",
    "\t- review work",
    "\t- email work",
    "- [ ] () — NEXT",
    "\t- later",
  ].join("\n");

  const firstDiscovery = helpers.discoverMovablePomodoroBulletTargets(
    content,
    2,
    0,
  );
  const firstPlan = helpers.planPomodoroBulletSplit(content, {
    targets: firstDiscovery.targets,
    sourceEntryLine: firstDiscovery.entryLine,
    splitName: "build",
  });
  assert.equal(firstPlan.valid, true);
  assert.equal(firstPlan.remainingName, "REVIEW + EMAIL");
  assert.equal(firstPlan.after, [
    "## Pomodoros",
    "- [ ] (**0920-0950** [t:: 30m]) — REVIEW + EMAIL",
    "\t- review work",
    "\t- email work",
    "- [ ] () — BUILD",
    "\t- build work",
    "- [ ] () — NEXT",
    "\t- later",
  ].join("\n"));

  const middleDiscovery = helpers.discoverMovablePomodoroBulletTargets(
    content,
    3,
    0,
  );
  const middlePlan = helpers.planPomodoroBulletSplit(content, {
    targets: middleDiscovery.targets,
    sourceEntryLine: middleDiscovery.entryLine,
    splitName: "review",
  });
  assert.equal(middlePlan.valid, true);
  assert.equal(middlePlan.remainingName, "BUILD + EMAIL");
  assert.equal(middlePlan.after, [
    "## Pomodoros",
    "- [ ] (**0920-0950** [t:: 30m]) — BUILD + EMAIL",
    "\t- build work",
    "\t- email work",
    "- [ ] () — REVIEW",
    "\t- review work",
    "- [ ] () — NEXT",
    "\t- later",
  ].join("\n"));

  const lastDiscovery = helpers.discoverMovablePomodoroBulletTargets(
    content,
    4,
    0,
  );
  const lastPlan = helpers.planPomodoroBulletSplit(content, {
    targets: lastDiscovery.targets,
    sourceEntryLine: lastDiscovery.entryLine,
    splitName: "email",
  });
  assert.equal(lastPlan.valid, true);
  assert.equal(lastPlan.remainingName, "BUILD + REVIEW");
  assert.equal(lastPlan.after, [
    "## Pomodoros",
    "- [ ] (**0920-0950** [t:: 30m]) — BUILD + REVIEW",
    "\t- build work",
    "\t- review work",
    "- [ ] () — EMAIL",
    "\t- email work",
    "- [ ] () — NEXT",
    "\t- later",
  ].join("\n"));

  const wholeContent = [
    "## Pomodoros",
    "- [ ] (**0920-0950** [t:: 30m]) — FOCUS",
    "\t- keep",
    "\t- move",
  ].join("\n");
  const wholeDiscovery = helpers.discoverMovablePomodoroBulletTargets(
    wholeContent,
    3,
    0,
  );
  const wholePlan = helpers.planPomodoroBulletSplit(wholeContent, {
    targets: wholeDiscovery.targets,
    sourceEntryLine: wholeDiscovery.entryLine,
    splitName: "focus",
  });
  assert.equal(wholePlan.valid, true);
  assert.equal(wholePlan.remainingName, "");
  assert.equal(wholePlan.splitName, "FOCUS");
  assert.equal(wholePlan.sourcePomodoroPreserved, true);
  assert.equal(wholePlan.after, [
    "## Pomodoros",
    "- [ ] (**0920-0950** [t:: 30m])",
    "\t- keep",
    "- [ ] () — FOCUS",
    "\t- move",
  ].join("\n"));

  const duplicateContent = [
    "## Pomodoros",
    "- [ ] () — NAME + NAME",
    "\t- one",
    "\t- two",
  ].join("\n");
  const duplicateDiscovery = helpers.discoverMovablePomodoroBulletTargets(
    duplicateContent,
    2,
    1,
  );
  const duplicatePlan = helpers.planPomodoroBulletSplit(duplicateContent, {
    targets: duplicateDiscovery.targets,
    sourceEntryLine: duplicateDiscovery.entryLine,
    splitName: "name",
  });
  assert.equal(duplicatePlan.valid, true);
  assert.equal(duplicatePlan.remainingName, "");
  assert.equal(duplicatePlan.after, [
    "## Pomodoros",
    "- [ ] ()",
    "- [ ] () — NAME",
    "\t- one",
    "\t- two",
  ].join("\n"));
});

test("planPomodoroBulletSplit peels C++ components, clamps counted selections, and preserves mixed indent", () => {
  const plusContent = [
    "## Pomodoros",
    "- [ ] () — C++ + REVIEW",
    "\t- keep c++",
    "\t- review work",
  ].join("\n");
  const plusDiscovery = helpers.discoverMovablePomodoroBulletTargets(
    plusContent,
    3,
    0,
  );
  const peelReview = helpers.planPomodoroBulletSplit(plusContent, {
    targets: plusDiscovery.targets,
    sourceEntryLine: plusDiscovery.entryLine,
    splitName: "review",
  });
  assert.equal(peelReview.valid, true);
  assert.equal(peelReview.after, [
    "## Pomodoros",
    "- [ ] () — C++",
    "\t- keep c++",
    "- [ ] () — REVIEW",
    "\t- review work",
  ].join("\n"));

  const peelCpp = helpers.planPomodoroBulletSplit(plusContent, {
    targets: helpers.discoverMovablePomodoroBulletTargets(plusContent, 2, 0)
      .targets,
    sourceEntryLine: plusDiscovery.entryLine,
    splitName: "c++",
  });
  assert.equal(peelCpp.valid, true);
  assert.equal(peelCpp.after, [
    "## Pomodoros",
    "- [ ] () — REVIEW",
    "\t- review work",
    "- [ ] () — C++",
    "\t- keep c++",
  ].join("\n"));

  const refuseEmail = helpers.planPomodoroBulletSplit(plusContent, {
    targets: plusDiscovery.targets,
    sourceEntryLine: plusDiscovery.entryLine,
    splitName: "email",
  });
  assert.equal(refuseEmail.valid, false);
  assert.equal(refuseEmail.after, plusContent);

  const clampContent = [
    "## Pomodoros",
    "- [ ] () — BUILD + EMAIL",
    "\t- build work",
    "\t- email one",
    "\t- email two",
  ].join("\n");
  const clampDiscovery = helpers.discoverMovablePomodoroBulletTargets(
    clampContent,
    3,
    9,
  );
  assert.equal(clampDiscovery.clamped, true);
  assert.equal(clampDiscovery.actualCount, 2);
  const clampPlan = helpers.planPomodoroBulletSplit(clampContent, {
    targets: clampDiscovery.targets,
    sourceEntryLine: clampDiscovery.entryLine,
    splitName: "email",
  });
  assert.equal(clampPlan.valid, true);
  assert.equal(clampPlan.movedCount, 2);
  assert.equal(clampPlan.after, [
    "## Pomodoros",
    "- [ ] () — BUILD",
    "\t- build work",
    "- [ ] () — EMAIL",
    "\t- email one",
    "\t- email two",
  ].join("\n"));

  const mixedContent = [
    "## Pomodoros",
    "- [ ] () — BUILD + DETAIL",
    "  - parent",
    "    - nested detail",
  ].join("\n");
  const mixedDiscovery = helpers.discoverMovablePomodoroBulletTargets(
    mixedContent,
    3,
    0,
  );
  const mixedPlan = helpers.planPomodoroBulletSplit(mixedContent, {
    targets: mixedDiscovery.targets,
    sourceEntryLine: mixedDiscovery.entryLine,
    splitName: "detail",
  });
  assert.equal(mixedPlan.valid, true);
  assert.equal(mixedPlan.after, [
    "## Pomodoros",
    "- [ ] () — BUILD",
    "  - parent",
    "- [ ] () — DETAIL",
    "\t- nested detail",
  ].join("\n"));
});

test("planPomodoroBulletSplit preserves ledger position, newlines, and future/timed/cancelled headers", () => {
  const buildContent = (eol, trailingNewline) =>
    [
      "## Pomodoros",
      "- [ ] () — BEFORE",
      "\t- before work",
      "- [ ] (**0920-0950** [t:: 30m]) — BUILD + EMAIL",
      "\t- build work",
      "\t- email work",
      "- [ ] () — AFTER",
      "\t- after work",
    ].join(eol) + (trailingNewline ? eol : "");

  for (const eol of ["\n", "\r\n"]) {
    for (const trailingNewline of [false, true]) {
      const content = buildContent(eol, trailingNewline);
      const discovery = helpers.discoverMovablePomodoroBulletTargets(
        content,
        5,
        0,
      );
      const plan = helpers.planPomodoroBulletSplit(content, {
        targets: discovery.targets,
        sourceEntryLine: discovery.entryLine,
        splitName: "email",
      });
      assert.equal(plan.valid, true, `${JSON.stringify(eol)} ${trailingNewline}`);
      assert.equal(
        plan.after,
        [
          "## Pomodoros",
          "- [ ] () — BEFORE",
          "\t- before work",
          "- [ ] (**0920-0950** [t:: 30m]) — BUILD",
          "\t- build work",
          "- [ ] () — EMAIL",
          "\t- email work",
          "- [ ] () — AFTER",
          "\t- after work",
        ].join(eol) + (trailingNewline ? eol : ""),
        `${JSON.stringify(eol)} ${trailingNewline}`,
      );
    }
  }

  const futureContent = [
    "## Pomodoros",
    "- [ ] () — BUILD + EMAIL",
    "\t- email work",
  ].join("\n");
  const futurePlan = helpers.planPomodoroBulletSplit(futureContent, {
    targets: helpers.discoverMovablePomodoroBulletTargets(futureContent, 2, 0)
      .targets,
    sourceEntryLine: 1,
    splitName: "email",
  });
  assert.equal(futurePlan.valid, true);
  assert.equal(futurePlan.after, [
    "## Pomodoros",
    "- [ ] () — BUILD",
    "- [ ] () — EMAIL",
    "\t- email work",
  ].join("\n"));

  const cancelledContent = [
    "## Pomodoros",
    "- [-] (**0900-0930**) — BUILD + EMAIL",
    "\t- email work",
  ].join("\n");
  const cancelledPlan = helpers.planPomodoroBulletSplit(cancelledContent, {
    targets: helpers.discoverMovablePomodoroBulletTargets(
      cancelledContent,
      2,
      0,
    ).targets,
    sourceEntryLine: 1,
    splitName: "email",
  });
  assert.equal(cancelledPlan.valid, true);
  assert.equal(cancelledPlan.after, [
    "## Pomodoros",
    "- [-] (**0900-0930**) — BUILD",
    "- [ ] () — EMAIL",
    "\t- email work",
  ].join("\n"));
});

test("Pomodoro bullet move picker typing =NAME or Escape does not write", async () => {
  notices.length = 0;
  const content = [
    "## Pomodoros",
    "- [ ] () — BUILD + EMAIL",
    "\t- email work",
  ].join("\n");
  const { editor, plugin, view } = createPomodoroMovePickerHarness({
    content,
    cursor: { line: 2, ch: 0 },
  });

  assert.equal(plugin.openPomodoroBulletMovePicker(editor, view), true);
  const picker = plugin.activeTaskMoveDestinationPicker;
  picker.inputEl = { value: "=email" };
  picker.visibleItems = picker.getFilteredItems();
  assert.equal(picker.visibleItems[0].kind, "split");
  assert.equal(editor.getValue(), content);
  assert.equal(editor.transactions.length, 0);

  picker.close();
  assert.equal(plugin.activeTaskMoveDestinationPicker, null);
  assert.equal(editor.getValue(), content);
  assert.equal(editor.transactions.length, 0);
});

test("planPomodoroEntryRename renames a named entry and names unnamed placeholder/timespan entries", () => {
  const content = pomodoroFixtureLines().join("\n");

  const renamedNamed = helpers.planPomodoroEntryRename(content, {
    sourceEntryLine: 9,
    sourceRawLine: "- [ ] () — BODY",
    name: "renamed body",
  });
  assert.equal(renamedNamed.valid, true);
  assert.equal(renamedNamed.after.split("\n")[9], "- [ ] () — RENAMED BODY");
  assert.equal(renamedNamed.previousName, "BODY");
  const namedLines = content.split("\n");
  const afterNamedLines = renamedNamed.after.split("\n");
  for (let i = 0; i < namedLines.length; i += 1) {
    if (i !== 9) {
      assert.equal(afterNamedLines[i], namedLines[i]);
    }
  }

  const namedPlaceholder = helpers.planPomodoroEntryRename(content, {
    sourceEntryLine: 6,
    sourceRawLine: "- [ ] ()",
    name: "fresh",
  });
  assert.equal(namedPlaceholder.valid, true);
  assert.equal(namedPlaceholder.after.split("\n")[6], "- [ ] () — FRESH");
  assert.equal(namedPlaceholder.previousName, "");

  const namedTimespan = helpers.planPomodoroEntryRename(content, {
    sourceEntryLine: 4,
    sourceRawLine: "- [ ] (**0920-0950** [t:: 30m])",
    name: "focus",
  });
  assert.equal(namedTimespan.valid, true);
  assert.equal(
    namedTimespan.after.split("\n")[4],
    "- [ ] (**0920-0950** [t:: 30m]) — FOCUS",
  );
  assert.equal(namedTimespan.previousName, "");
});

test("planPomodoroEntryRename normalizes the typed name and rejects empty/over-length names", () => {
  const content = "## Pomodoros\n- [ ] () — OLD";
  const plan = helpers.planPomodoroEntryRename(content, {
    sourceEntryLine: 1,
    sourceRawLine: "- [ ] () — OLD",
    name: "  new — name  ",
  });
  assert.equal(plan.valid, true);
  assert.equal(plan.name, "NEW NAME");

  const empty = helpers.planPomodoroEntryRename(content, {
    sourceEntryLine: 1,
    sourceRawLine: "- [ ] () — OLD",
    name: "   ",
  });
  assert.equal(empty.valid, false);
  assert.match(empty.error, /empty/);

  const overLength = helpers.planPomodoroEntryRename(content, {
    sourceEntryLine: 1,
    sourceRawLine: "- [ ] () — OLD",
    name: "X".repeat(helpers.POMODORO_NAME_MAX_LENGTH + 1),
  });
  assert.equal(overLength.valid, false);
  assert.match(overLength.error, /exceed/);
});

test("planPomodoroEntryRename reports unchanged when the normalized name matches the current name", () => {
  const content = "## Pomodoros\n- [ ] () — BODY";
  const plan = helpers.planPomodoroEntryRename(content, {
    sourceEntryLine: 1,
    sourceRawLine: "- [ ] () — BODY",
    name: "  body ",
  });
  assert.equal(plan.valid, true);
  assert.equal(plan.unchanged, true);
  assert.equal(plan.after, content);
  assert.equal(plan.name, "BODY");
  assert.equal(plan.previousName, "BODY");
});

test("planPomodoroEntryRename rejects unsupported trailing content and a stale source line", () => {
  const content = "## Pomodoros\n- [ ] () extra text no dash";
  const unsupported = helpers.planPomodoroEntryRename(content, {
    sourceEntryLine: 1,
    name: "NEW",
  });
  assert.equal(unsupported.valid, false);
  assert.match(unsupported.error, /unsupported trailing content/);

  const staleContent = "## Pomodoros\n- [ ] () — OLD";
  const stale = helpers.planPomodoroEntryRename(staleContent, {
    sourceEntryLine: 1,
    sourceRawLine: "- [ ] () — DIFFERENT",
    name: "NEW",
  });
  assert.equal(stale.valid, false);
  assert.match(stale.error, /changed before it could be moved/);
});

test("planPomodoroEntryRename renames closed and cancelled entries the same way as open ones", () => {
  for (const status of [" ", "x", "-"]) {
    const content = `## Pomodoros\n- [${status}] () — OLD`;
    const plan = helpers.planPomodoroEntryRename(content, {
      sourceEntryLine: 1,
      sourceRawLine: `- [${status}] () — OLD`,
      name: "NEW",
    });
    assert.equal(plan.valid, true);
    assert.equal(plan.after, `## Pomodoros\n- [${status}] () — NEW`);
  }
});

test("planPomodoroEntryMerge resolves all direction-table cases with survivor-first bullets and names", () => {
  {
    const content = [
      "## Pomodoros",
      "- [ ] () — BUILD",
      "\t- build existing",
      "\t- duplicate",
      "- [ ] () — REVIEW",
      "\t- review first",
      "\t\t- review detail",
      "\t- duplicate",
      "- [ ] () — WRAP",
      "\t- wrap stays put",
    ].join("\n");
    const plan = helpers.planPomodoroEntryMerge(content, {
      invokedEntryLine: 1,
      invokedRawLine: "- [ ] () — BUILD",
      selectedEntryLine: 4,
      selectedRawLine: "- [ ] () — REVIEW",
    });
    assert.equal(plan.valid, true);
    assert.equal(plan.survivorOriginalEntryLine, 4);
    assert.equal(plan.absorbedOriginalEntryLine, 1);
    assert.equal(plan.finalName, "REVIEW + BUILD");
    assert.equal(plan.transferredBulletCount, 2);
    assert.equal(plan.after, [
      "## Pomodoros",
      "- [ ] () — REVIEW + BUILD",
      "\t- review first",
      "\t\t- review detail",
      "\t- duplicate",
      "\t- build existing",
      "\t- duplicate",
      "- [ ] () — WRAP",
      "\t- wrap stays put",
    ].join("\n"));
  }

  for (const [label, invokedEntryLine, selectedEntryLine] of [
    ["future invokes current", 5, 1],
    ["current invokes future", 1, 5],
  ]) {
    const content = [
      "## Pomodoros",
      "- [ ] (**0920-0950** [t:: 30m]) — BUILD",
      "\t- existing build bullet",
      "- [ ] () — HOLD",
      "\t- untouched",
      "- [ ] () — REVIEW",
      "\t- first review bullet",
      "\t\t- review detail",
      "\t- second review bullet",
    ].join("\n");
    const plan = helpers.planPomodoroEntryMerge(content, {
      invokedEntryLine,
      invokedRawLine:
        invokedEntryLine === 1
          ? "- [ ] (**0920-0950** [t:: 30m]) — BUILD"
          : "- [ ] () — REVIEW",
      selectedEntryLine,
      selectedRawLine:
        selectedEntryLine === 1
          ? "- [ ] (**0920-0950** [t:: 30m]) — BUILD"
          : "- [ ] () — REVIEW",
    });
    assert.equal(plan.valid, true, label);
    assert.equal(plan.survivorOriginalEntryLine, 1, label);
    assert.equal(plan.absorbedOriginalEntryLine, 5, label);
    assert.equal(plan.finalName, "BUILD + REVIEW", label);
    assert.equal(plan.after, [
      "## Pomodoros",
      "- [ ] (**0920-0950** [t:: 30m]) — BUILD + REVIEW",
      "\t- existing build bullet",
      "\t- first review bullet",
      "\t\t- review detail",
      "\t- second review bullet",
      "- [ ] () — HOLD",
      "\t- untouched",
    ].join("\n"), label);
  }
});

test("planPomodoroEntryMerge handles empty placeholders, unnamed entries, equal names, plus names, and the name limit", () => {
  const emptyAbsorbed = [
    "## Pomodoros",
    "- [ ] () — SOURCE",
    "\t- ",
    "- [ ] () — DEST",
    "\t- keep",
  ].join("\n");
  const emptyPlan = helpers.planPomodoroEntryMerge(emptyAbsorbed, {
    invokedEntryLine: 1,
    selectedEntryLine: 3,
  });
  assert.equal(emptyPlan.valid, true);
  assert.equal(emptyPlan.transferredBulletCount, 0);
  assert.equal(emptyPlan.finalName, "DEST + SOURCE");
  assert.equal(emptyPlan.after, [
    "## Pomodoros",
    "- [ ] () — DEST + SOURCE",
    "\t- keep",
  ].join("\n"));

  const unnamed = [
    "## Pomodoros",
    "- [ ] ()",
    "\t- source",
    "- [ ] () — FOCUS + REVIEW",
    "\t- dest",
  ].join("\n");
  const unnamedPlan = helpers.planPomodoroEntryMerge(unnamed, {
    invokedEntryLine: 1,
    selectedEntryLine: 3,
  });
  assert.equal(unnamedPlan.valid, true);
  assert.equal(unnamedPlan.finalName, "FOCUS + REVIEW");
  assert.equal(unnamedPlan.after, [
    "## Pomodoros",
    "- [ ] () — FOCUS + REVIEW",
    "\t- dest",
    "\t- source",
  ].join("\n"));

  const equalNames = [
    "## Pomodoros",
    "- [ ] () — SAME",
    "\t- source",
    "- [ ] () — SAME",
    "\t- dest",
  ].join("\n");
  const equalPlan = helpers.planPomodoroEntryMerge(equalNames, {
    invokedEntryLine: 1,
    selectedEntryLine: 3,
  });
  assert.equal(equalPlan.valid, true);
  assert.equal(equalPlan.finalName, "SAME + SAME");

  const exact = helpers.planPomodoroEntryMerge(
    [
      "## Pomodoros",
      "- [ ] () — " + "A".repeat(20),
      "\t- source",
      "- [ ] () — " + "B".repeat(25),
      "\t- dest",
    ].join("\n"),
    { invokedEntryLine: 1, selectedEntryLine: 3 },
  );
  assert.equal(exact.valid, true);
  assert.equal(exact.finalName.length, helpers.POMODORO_NAME_MAX_LENGTH);

  const over = helpers.planPomodoroEntryMerge(
    [
      "## Pomodoros",
      "- [ ] () — " + "A".repeat(21),
      "\t- source",
      "- [ ] () — " + "B".repeat(25),
      "\t- dest",
    ].join("\n"),
    { invokedEntryLine: 1, selectedEntryLine: 3 },
  );
  assert.equal(over.valid, false);
  assert.match(over.error, /shorten a name/);
});

test("planPomodoroEntryMerge refuses stale, ineligible, two-timed, unsupported, and lossy merges without mutation", () => {
  const cases = [
    {
      label: "self",
      content: "## Pomodoros\n- [ ] () — A\n\t- one",
      options: { invokedEntryLine: 1, selectedEntryLine: 1 },
      pattern: /different Pomodoro/,
    },
    {
      label: "stale invoked",
      content: "## Pomodoros\n- [ ] () — A\n- [ ] () — B",
      options: {
        invokedEntryLine: 1,
        invokedRawLine: "- [ ] () — OLD",
        selectedEntryLine: 2,
      },
      pattern: /changed before it could be merged/,
    },
    {
      label: "closed",
      content: "## Pomodoros\n- [x] () — A\n\t- one\n- [ ] () — B",
      options: { invokedEntryLine: 1, selectedEntryLine: 3 },
      pattern: /Only open current or future/,
    },
    {
      label: "two timed",
      content: [
        "## Pomodoros",
        "- [ ] (**0900-0930** [t:: 30m]) — A",
        "- [ ] (09:30-10:00 [t:: 30m]) — B",
      ].join("\n"),
      options: { invokedEntryLine: 1, selectedEntryLine: 2 },
      pattern: /Two timed Pomodoros/,
    },
    {
      label: "unsupported tail",
      content: "## Pomodoros\n- [ ] () extra\n- [ ] () — B",
      options: { invokedEntryLine: 1, selectedEntryLine: 2 },
      pattern: /unsupported trailing content/,
    },
    {
      label: "lossy child",
      content: "## Pomodoros\n- [ ] () — A\n\tstray note\n- [ ] () — B",
      options: { invokedEntryLine: 1, selectedEntryLine: 3 },
      pattern: /content that cannot be moved/,
    },
  ];

  for (const { label, content, options, pattern } of cases) {
    const plan = helpers.planPomodoroEntryMerge(content, options);
    assert.equal(plan.valid, false, label);
    assert.match(plan.error, pattern, label);
    assert.equal(plan.after, content, label);
  }
});

