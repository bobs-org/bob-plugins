const test = require("node:test");
const assert = require("node:assert/strict");
const {
  helpers,
  notices,
  noteLines,
  findPromptHeading,
  getSectionPrompt,
  resolveSectionPrompt,
  openDemotionPicker,
  acceptPickerDestination,
  acceptSelectedPickerRow,
} = require("./task-status-cycler-harness.cjs");

test("promotion prompts default to Tasks in ordinary and project notes", () => {
  const ordinary = ["## Ideas", "", "- Ship it", "\t- child", "", "## Tasks", "", "## Notes"];
  const project = [
    "---",
    "type: [[project]]",
    "---",
    "## Ideas",
    "",
    "- Ship it",
    "",
    "## Tasks",
  ];

  for (const [lines, activeLine] of [[ordinary, 2], [project, 5]]) {
    const prompt = getSectionPrompt(lines, activeLine, 2);
    assert.equal(prompt.promptKind, "promotion");
    assert.deepEqual(
      prompt.headings.map((heading) => heading.title),
      lines === ordinary ? ["Tasks", "Notes"] : ["Tasks"],
    );
    assert.equal(prompt.previewText, "- Ship it");

    const state = helpers.createDemotionSectionPickerState(
      prompt.headings,
      "",
      prompt.promptKind,
    );
    const model = helpers.getDemotionSectionPickerModel(state);
    assert.equal(model.selectedIndex, 0);
    assert.equal(model.selectedRow.title, "Tasks");
    assert.equal(model.inputPlaceholder, "Filter or type a new section");
    assert.equal(model.statusText, "Move to existing Tasks");
  }

  const moved = resolveSectionPrompt(ordinary, 2, {
    kind: "existing",
    heading: findPromptHeading(getSectionPrompt(ordinary, 2), "Tasks"),
  }, 2);
  assert.deepEqual(moved.nextLines, [
    "## Tasks",
    "",
    "- [ ] #task Ship it [created::2026-08-20]",
    "\t- child",
    "## Notes",
  ]);
  assert.equal(
    moved.nextLines.join("\n").match(/#task/g).length,
    1,
  );
  assert.equal(moved.cursorLine, 2);
  assert.equal(moved.cursorCh, 12);
});

test("promotion routes plain bullets to existing, typed, and duplicate non-Tasks sections", () => {
  const lines = [
    "## Notes",
    "",
    "- already top",
    "## Ideas",
    "",
    "- Ship it",
    "\t- child",
    "## Tasks",
    "",
    "## Notes",
    "",
    "- already bottom",
  ];
  const prompt = getSectionPrompt(lines, 5, 2);
  assert.deepEqual(
    prompt.headings.map((heading) => [heading.title, heading.line]),
    [
      ["Tasks", 7],
      ["Notes", 0],
      ["Notes", 9],
    ],
  );

  const firstNotes = helpers.resolveObsidianTaskPromptDestination(prompt, {
    kind: "existing",
    heading: findPromptHeading(prompt, "Notes", 0),
  });
  assert.deepEqual(firstNotes.nextLines, [
    "## Notes",
    "",
    "- already top",
    "- Ship it",
    "\t- child",
    "## Tasks",
    "",
    "## Notes",
    "",
    "- already bottom",
  ]);
  assert.equal(firstNotes.nextLines.join("\n").includes("#task"), false);
  assert.equal(firstNotes.cursorLine, 3);
  assert.equal(firstNotes.cursorCh, 2);

  const secondNotes = helpers.resolveObsidianTaskPromptDestination(prompt, {
    kind: "existing",
    heading: findPromptHeading(prompt, "Notes", 1),
  });
  assert.deepEqual(secondNotes.nextLines.slice(-4), [
    "",
    "- already bottom",
    "- Ship it",
    "\t- child",
  ]);
  assert.equal(secondNotes.cursorLine, 8);

  const typedReuseState = helpers.setDemotionPickerQuery(
    helpers.createDemotionSectionPickerState(prompt.headings, "", prompt.promptKind),
    " notes ",
  );
  const typedReuseModel = helpers.getDemotionSectionPickerModel(typedReuseState);
  assert.deepEqual(
    typedReuseModel.rows.map((row) => [row.title, row.heading && row.heading.line]),
    [
      ["Notes", 0],
      ["Notes", 9],
    ],
  );

  const createNewState = helpers.setDemotionPickerQuery(
    helpers.createDemotionSectionPickerState(prompt.headings, "", prompt.promptKind),
    "Future Work",
  );
  const createNewModel = helpers.getDemotionSectionPickerModel(createNewState);
  assert.equal(createNewModel.primary.kind, "create");
  assert.equal(createNewModel.primary.title, "Future Work");
  const created = helpers.resolveObsidianTaskPromptDestination(
    prompt,
    helpers.getDemotionDestinationFromSelectedRow(createNewModel),
  );
  assert.deepEqual(created.nextLines.slice(-4), [
    "## Future Work",
    "",
    "- Ship it",
    "\t- child",
  ]);
  assert.equal(created.nextLines.join("\n").includes("#task"), false);
});

test("promotion command writes only on accept and Enter selects Tasks", () => {
  const source = ["## Ideas", "", "- Ship it", "\t- child", "", "## Tasks"].join("\n");
  const { editor, view, plugin, centered } = openDemotionPicker(source, {
    line: 2,
    ch: 2,
  });
  plugin.getCreatedDateString = () => "2026-08-20";

  assert.equal(plugin.handleToggleObsidianTaskCommand(true, editor, view), true);
  assert.equal(editor.getValue(), source);
  assert.ok(!plugin.demotionSectionPicker);

  assert.equal(plugin.handleToggleObsidianTaskCommand(false, editor, view), true);
  assert.equal(editor.getValue(), source);
  const picker = plugin.demotionSectionPicker;
  assert.ok(picker);
  assert.equal(picker.statusEl.textContent, "Move to existing Tasks");
  assert.equal(picker.rowEls.length, 1);

  assert.equal(acceptSelectedPickerRow(plugin), true);
  assert.equal(
    editor.getValue(),
    [
      "## Tasks",
      "",
      "- [ ] #task Ship it [created::2026-08-20]",
      "\t- child",
    ].join("\n"),
  );
  assert.deepEqual(editor.getCursor(), { line: 2, ch: 12 });
  assert.deepEqual(centered, [{ line: 2, ch: 12, sameEditor: true }]);
});

test("promotion removes only genuinely empty source sections", () => {
  const removedBeforeDestination = resolveSectionPrompt(
    ["## Ideas", "", "- Ship it", "", "## Tasks"],
    2,
    { kind: "existing", heading: { line: 4, depth: 2, title: "Tasks" } },
  );
  assert.deepEqual(removedBeforeDestination.nextLines, [
    "## Tasks",
    "",
    "- [ ] #task Ship it [created::2026-08-20]",
  ]);

  const removedAfterDestination = resolveSectionPrompt(
    ["## Tasks", "", "## Ideas", "", "- Ship it"],
    4,
    { kind: "existing", heading: { line: 0, depth: 2, title: "Tasks" } },
  );
  assert.deepEqual(removedAfterDestination.nextLines, [
    "## Tasks",
    "",
    "- [ ] #task Ship it [created::2026-08-20]",
  ]);

  const finalNewline = resolveSectionPrompt(
    ["## Tasks", "", "## Ideas", "", "- Ship it", ""],
    4,
    { kind: "existing", heading: { line: 0, depth: 2, title: "Tasks" } },
  );
  assert.deepEqual(finalNewline.nextLines, [
    "## Tasks",
    "",
    "- [ ] #task Ship it [created::2026-08-20]",
    "",
  ]);

  const retainedCases = [
    {
      name: "another bullet",
      lines: ["## Ideas", "", "- Ship it", "- Keep", "", "## Tasks"],
      expected: "- Keep",
    },
    {
      name: "prose",
      lines: ["## Ideas", "", "- Ship it", "Keep this paragraph.", "", "## Tasks"],
      expected: "Keep this paragraph.",
    },
    {
      name: "fence",
      lines: ["## Ideas", "", "- Ship it", "```md", "example", "```", "## Tasks"],
      expected: "```md",
    },
    {
      name: "child heading",
      lines: ["## Ideas", "", "- Ship it", "", "### Details", "", "## Tasks"],
      expected: "### Details",
    },
  ];

  for (const retained of retainedCases) {
    const prompt = getSectionPrompt(retained.lines, 2);
    const moved = helpers.resolveObsidianTaskPromptDestination(prompt, {
      kind: "existing",
      heading: findPromptHeading(prompt, "Tasks"),
    });
    assert.ok(moved.nextLines.includes("## Ideas"), retained.name);
    assert.ok(moved.nextLines.includes(retained.expected), retained.name);
  }

  const preamble = getSectionPrompt(["- Ship it", "## Tasks", "", "## Notes"], 0);
  const preambleMoved = helpers.resolveObsidianTaskPromptDestination(preamble, {
    kind: "existing",
    heading: findPromptHeading(preamble, "Tasks"),
  });
  assert.deepEqual(preambleMoved.nextLines, [
    "## Tasks",
    "",
    "- [ ] #task Ship it [created::2026-08-20]",
    "## Notes",
  ]);
});

test("promotions, out-of-Tasks demotions, and ineligible shapes keep prior routing", () => {
  const created = "2026-08-20";

  const promoteLines = [
    "---",
    "type: [[project]]",
    "---",
    "- Ship it",
    "",
    "## Tasks",
  ];
  const promotePlan = helpers.getObsidianTaskToggleDocumentPlan(
    promoteLines,
    3,
    0,
    created,
  );
  assert.equal(promotePlan.mode, "prompt");
  assert.equal(promotePlan.promptKind, "promotion");
  assert.equal(promotePlan.nextLines, undefined);
  const promoteMoved = helpers.resolveObsidianTaskPromptDestination(promotePlan, {
    kind: "existing",
    heading: findPromptHeading(promotePlan, "Tasks"),
  });
  assert.equal(promoteMoved.mode, "move");
  assert.equal(promoteMoved.targetSection, "tasks");
  assert.equal(promoteMoved.nextLines.includes("## Requirements"), false);
  assert.match(
    promoteMoved.nextLines.join("\n"),
    /## Tasks\n\n- \[ \] #task Ship it \[created::2026-08-20\]/,
  );

  const noTasks = ["## Ideas", "", "- Ship it"];
  const noTasksPlan = helpers.getObsidianTaskToggleDocumentPlan(
    noTasks,
    2,
    0,
    created,
  );
  assert.equal(noTasksPlan.mode, "replace");
  assert.equal(noTasksPlan.line, 2);

  const outside = [
    "## Notes",
    "",
    "- [ ] #task Ship it",
    "## Later",
  ];
  const outsidePlan = helpers.getObsidianTaskToggleDocumentPlan(
    outside,
    2,
    0,
    created,
  );
  assert.equal(outsidePlan.mode, "move");
  assert.equal(outsidePlan.targetSection, "nextSection");
  assert.deepEqual(outsidePlan.nextLines, [
    "## Notes",
    "",
    "## Later",
    "",
    "- Ship it",
  ]);

  const wrongSection = [
    "## Notes",
    "",
    "- [ ] #task Ship it",
  ];
  const wrongPlan = helpers.getObsidianTaskToggleDocumentPlan(
    wrongSection,
    2,
    0,
    created,
  );
  assert.equal(wrongPlan.mode, "replace");

  const indented = noteLines({
    taskLines: ["- parent", "\t- [ ] #task child"],
  });
  const indentedPlan = helpers.getObsidianTaskToggleDocumentPlan(
    indented,
    3,
    0,
    created,
  );
  assert.equal(indentedPlan.mode, "replace");
  assert.equal(indentedPlan.line, 3);

  const star = noteLines({ taskLine: "* [ ] #task Ship it" });
  const starPlan = helpers.getObsidianTaskToggleDocumentPlan(star, 2, 0, created);
  assert.equal(starPlan.mode, "replace");

  const starPromote = ["* Ship it", "## Tasks"];
  const starPromotePlan = helpers.getObsidianTaskToggleDocumentPlan(
    starPromote,
    0,
    0,
    created,
  );
  assert.equal(starPromotePlan.mode, "replace");

  const indentedPromote = ["## Tasks", "", "- parent", "\t- child"];
  const indentedPromotePlan = helpers.getObsidianTaskToggleDocumentPlan(
    indentedPromote,
    3,
    0,
    created,
  );
  assert.equal(indentedPromotePlan.mode, "replace");
  assert.equal(indentedPromotePlan.line, 3);
});

test("Tasks-only preamble promotions prompt and blank Enter moves into Tasks", () => {
  const lines = ["- Ship it", "\t- child", "## Tasks"];
  const prompt = getSectionPrompt(lines, 0, 2);
  assert.equal(prompt.promptKind, "promotion");
  assert.deepEqual(
    prompt.headings.map((heading) => heading.title),
    ["Tasks"],
  );
  assert.equal(prompt.previewText, "- Ship it");

  const blankState = helpers.createDemotionSectionPickerState(
    prompt.headings,
    "",
    prompt.promptKind,
  );
  const blankModel = helpers.getDemotionSectionPickerModel(blankState);
  assert.equal(blankModel.selectedRow.title, "Tasks");
  assert.equal(blankModel.statusText, "Move to existing Tasks");
  assert.equal(blankModel.inputPlaceholder, "Filter or type a new section");

  const moved = helpers.resolveObsidianTaskPromptDestination(
    prompt,
    helpers.getDemotionDestinationFromSelectedRow(blankModel),
  );
  assert.deepEqual(moved.nextLines, [
    "## Tasks",
    "",
    "- [ ] #task Ship it [created::2026-08-20]",
    "\t- child",
  ]);
  assert.equal(moved.nextLines.join("\n").match(/#task/g).length, 1);
  assert.equal(moved.cursorLine, 2);
  assert.equal(moved.cursorCh, 12);
  assert.equal(moved.targetSection, "tasks");

  const source = lines.join("\n");
  const { editor, view, plugin, centered } = openDemotionPicker(source, {
    line: 0,
    ch: 2,
  });
  plugin.getCreatedDateString = () => "2026-08-20";
  assert.equal(plugin.handleToggleObsidianTaskCommand(true, editor, view), true);
  assert.equal(editor.getValue(), source);
  assert.equal(plugin.handleToggleObsidianTaskCommand(false, editor, view), true);
  assert.equal(editor.getValue(), source);
  assert.equal(acceptSelectedPickerRow(plugin), true);
  assert.equal(
    editor.getValue(),
    [
      "## Tasks",
      "",
      "- [ ] #task Ship it [created::2026-08-20]",
      "\t- child",
    ].join("\n"),
  );
  assert.deepEqual(editor.getCursor(), { line: 2, ch: 12 });
  assert.deepEqual(centered, [{ line: 2, ch: 12, sameEditor: true }]);
});

test("plain bullets already in Tasks prompt and blank Enter promotes in place", () => {
  const lines = [
    "## Tasks",
    "",
    "- Keep first",
    "- Ship it",
    "\t- child",
    "  continued",
    "- Keep last",
    "",
    "## Notes",
  ];
  const prompt = getSectionPrompt(lines, 3, 2);
  assert.equal(prompt.promptKind, "promotion");
  assert.deepEqual(
    prompt.headings.map((heading) => [heading.title, heading.line]),
    [
      ["Tasks", 0],
      ["Notes", 8],
    ],
  );
  assert.equal(prompt.sourceHeading.title, "Tasks");

  const blankModel = helpers.getDemotionSectionPickerModel(
    helpers.createDemotionSectionPickerState(
      prompt.headings,
      "",
      prompt.promptKind,
    ),
  );
  assert.equal(blankModel.selectedRow.title, "Tasks");
  assert.equal(blankModel.selectedRow.heading.line, 0);

  const inPlace = helpers.resolveObsidianTaskPromptDestination(
    prompt,
    helpers.getDemotionDestinationFromSelectedRow(blankModel),
  );
  assert.deepEqual(inPlace.nextLines, [
    "## Tasks",
    "",
    "- Keep first",
    "- [ ] #task Ship it [created::2026-08-20]",
    "\t- child",
    "  continued",
    "- Keep last",
    "",
    "## Notes",
  ]);
  assert.equal(inPlace.nextLines.join("\n").match(/#task/g).length, 1);
  assert.equal(inPlace.cursorLine, 3);
  assert.equal(inPlace.cursorCh, 12);
  assert.equal(inPlace.targetSection, "tasks");

  const tasksOnly = ["## Tasks", "", "- Keep first", "- Ship it", "- Keep last"];
  const tasksOnlyPrompt = getSectionPrompt(tasksOnly, 3, 2);
  assert.deepEqual(
    tasksOnlyPrompt.headings.map((heading) => heading.title),
    ["Tasks"],
  );
  const tasksOnlyInPlace = helpers.resolveObsidianTaskPromptDestination(
    tasksOnlyPrompt,
    { kind: "existing", heading: findPromptHeading(tasksOnlyPrompt, "Tasks") },
  );
  assert.deepEqual(tasksOnlyInPlace.nextLines, [
    "## Tasks",
    "",
    "- Keep first",
    "- [ ] #task Ship it [created::2026-08-20]",
    "- Keep last",
  ]);

  const source = lines.join("\n");
  const { editor, view, plugin, centered } = openDemotionPicker(source, {
    line: 3,
    ch: 2,
  });
  plugin.getCreatedDateString = () => "2026-08-20";
  assert.equal(plugin.handleToggleObsidianTaskCommand(false, editor, view), true);
  assert.equal(editor.getValue(), source);
  assert.equal(acceptSelectedPickerRow(plugin), true);
  assert.equal(
    editor.getValue(),
    [
      "## Tasks",
      "",
      "- Keep first",
      "- [ ] #task Ship it [created::2026-08-20]",
      "\t- child",
      "  continued",
      "- Keep last",
      "",
      "## Notes",
    ].join("\n"),
  );
  assert.deepEqual(editor.getCursor(), { line: 3, ch: 12 });
  assert.deepEqual(centered, [{ line: 3, ch: 12, sameEditor: true }]);
});

test("promotion from Tasks-only or Tasks body can choose existing or typed non-Tasks sections", () => {
  const preamble = ["- Ship it", "\t- child", "## Tasks", "", "## Notes", "", "- already"];
  const preamblePrompt = getSectionPrompt(preamble, 0, 2);
  assert.deepEqual(
    preamblePrompt.headings.map((heading) => heading.title),
    ["Tasks", "Notes"],
  );

  const toNotes = helpers.resolveObsidianTaskPromptDestination(preamblePrompt, {
    kind: "existing",
    heading: findPromptHeading(preamblePrompt, "Notes"),
  });
  assert.deepEqual(toNotes.nextLines, [
    "## Tasks",
    "",
    "## Notes",
    "",
    "- already",
    "- Ship it",
    "\t- child",
  ]);
  assert.equal(toNotes.nextLines.join("\n").includes("#task"), false);

  const createFromPreambleState = helpers.setDemotionPickerQuery(
    helpers.createDemotionSectionPickerState(
      preamblePrompt.headings,
      "",
      preamblePrompt.promptKind,
    ),
    "Future Work",
  );
  const createFromPreambleModel = helpers.getDemotionSectionPickerModel(
    createFromPreambleState,
  );
  assert.equal(createFromPreambleModel.primary.kind, "create");
  assert.equal(createFromPreambleModel.selectedRow.title, "Future Work");
  const createdFromPreamble = helpers.resolveObsidianTaskPromptDestination(
    preamblePrompt,
    helpers.getDemotionDestinationFromSelectedRow(createFromPreambleModel),
  );
  assert.deepEqual(createdFromPreamble.nextLines, [
    "## Tasks",
    "",
    "## Notes",
    "",
    "- already",
    "",
    "## Future Work",
    "",
    "- Ship it",
    "\t- child",
  ]);
  assert.equal(createdFromPreamble.nextLines.join("\n").includes("#task"), false);
  assert.equal(
    createdFromPreamble.nextLines.filter((line) => line === "## Future Work").length,
    1,
  );

  const tasksOnly = ["- Ship it", "\t- child", "## Tasks"];
  const tasksOnlyPrompt = getSectionPrompt(tasksOnly, 0);
  const createdFromTasksOnly = helpers.resolveObsidianTaskPromptDestination(
    tasksOnlyPrompt,
    { kind: "create", title: "Inbox" },
  );
  assert.deepEqual(createdFromTasksOnly.nextLines, [
    "## Tasks",
    "",
    "## Inbox",
    "",
    "- Ship it",
    "\t- child",
  ]);
  assert.equal(createdFromTasksOnly.nextLines.join("\n").includes("#task"), false);

  const insideTasks = [
    "## Tasks",
    "",
    "- Keep",
    "- Ship it",
    "\t- child",
    "## Notes",
    "",
    "- already",
  ];
  const insidePrompt = getSectionPrompt(insideTasks, 3, 2);
  assert.deepEqual(
    insidePrompt.headings.map((heading) => heading.title),
    ["Tasks", "Notes"],
  );

  const insideToNotes = helpers.resolveObsidianTaskPromptDestination(insidePrompt, {
    kind: "existing",
    heading: findPromptHeading(insidePrompt, "Notes"),
  });
  assert.deepEqual(insideToNotes.nextLines, [
    "## Tasks",
    "",
    "- Keep",
    "## Notes",
    "",
    "- already",
    "- Ship it",
    "\t- child",
  ]);
  assert.equal(insideToNotes.nextLines.join("\n").includes("#task"), false);
  assert.ok(insideToNotes.nextLines.includes("## Tasks"));

  const createdFromInside = helpers.resolveObsidianTaskPromptDestination(
    insidePrompt,
    { kind: "create", title: "Future Work" },
  );
  assert.deepEqual(createdFromInside.nextLines, [
    "## Tasks",
    "",
    "- Keep",
    "## Notes",
    "",
    "- already",
    "",
    "## Future Work",
    "",
    "- Ship it",
    "\t- child",
  ]);
  assert.equal(createdFromInside.nextLines.join("\n").includes("#task"), false);
  assert.ok(createdFromInside.nextLines.includes("## Tasks"));
});

test("always-prompt promotions keep reuse, duplicates, cleanup, CRLF, and cancellation", () => {
  const reuseLines = [
    "## Tasks",
    "",
    "- Ship it",
    "\t- child",
    "##   notes  ##",
    "",
    "- already",
  ];
  const reusePrompt = getSectionPrompt(reuseLines, 2);
  const reuseState = helpers.setDemotionPickerQuery(
    helpers.createDemotionSectionPickerState(
      reusePrompt.headings,
      "",
      reusePrompt.promptKind,
    ),
    " NOTES ",
  );
  const reuseModel = helpers.getDemotionSectionPickerModel(reuseState);
  assert.equal(reuseModel.primary, null);
  assert.equal(reuseModel.selectedRow.title, "notes");
  const reused = helpers.resolveObsidianTaskPromptDestination(
    reusePrompt,
    helpers.getDemotionDestinationFromSelectedRow(reuseModel),
  );
  assert.equal(
    reused.nextLines.filter(
      (line) => /^##\s+notes\s+##$/i.test(line) || line === "## Notes",
    ).length,
    1,
  );
  assert.deepEqual(reused.nextLines.slice(-3), [
    "- already",
    "- Ship it",
    "\t- child",
  ]);
  assert.equal(reused.nextLines.join("\n").includes("#task"), false);

  const duplicates = [
    "## Notes",
    "",
    "- already top",
    "## Tasks",
    "",
    "- Keep",
    "- Ship it",
    "\t- child",
    "## Notes",
    "",
    "- already bottom",
    "## Tasks",
    "",
    "- other tasks",
  ];
  const duplicatePrompt = getSectionPrompt(duplicates, 6);
  assert.deepEqual(
    duplicatePrompt.headings.map((heading) => [heading.title, heading.line]),
    [
      ["Tasks", 3],
      ["Tasks", 11],
      ["Notes", 0],
      ["Notes", 8],
    ],
  );
  const sameTasks = helpers.resolveObsidianTaskPromptDestination(duplicatePrompt, {
    kind: "existing",
    heading: findPromptHeading(duplicatePrompt, "Tasks", 0),
  });
  assert.equal(sameTasks.nextLines[5], "- Keep");
  assert.equal(
    sameTasks.nextLines[6],
    "- [ ] #task Ship it [created::2026-08-20]",
  );
  assert.equal(sameTasks.nextLines[7], "\t- child");
  assert.ok(sameTasks.nextLines.includes("- other tasks"));

  const otherTasks = helpers.resolveObsidianTaskPromptDestination(duplicatePrompt, {
    kind: "existing",
    heading: findPromptHeading(duplicatePrompt, "Tasks", 1),
  });
  assert.deepEqual(otherTasks.nextLines.slice(-5), [
    "## Tasks",
    "",
    "- other tasks",
    "- [ ] #task Ship it [created::2026-08-20]",
    "\t- child",
  ]);
  assert.ok(otherTasks.nextLines.includes("- Keep"));

  const sourceBefore = resolveSectionPrompt(
    ["## Ideas", "", "- Ship it", "", "## Tasks"],
    2,
    { kind: "existing", heading: { line: 4, depth: 2, title: "Tasks" } },
  );
  assert.deepEqual(sourceBefore.nextLines, [
    "## Tasks",
    "",
    "- [ ] #task Ship it [created::2026-08-20]",
  ]);

  const sourceAfter = resolveSectionPrompt(
    ["## Tasks", "", "## Ideas", "", "- Ship it"],
    4,
    { kind: "existing", heading: { line: 0, depth: 2, title: "Tasks" } },
  );
  assert.deepEqual(sourceAfter.nextLines, [
    "## Tasks",
    "",
    "- [ ] #task Ship it [created::2026-08-20]",
  ]);

  const withFinalNewline = resolveSectionPrompt(
    ["## Tasks", "", "- Ship it", ""],
    2,
    { kind: "existing", heading: { line: 0, depth: 2, title: "Tasks" } },
  );
  assert.deepEqual(withFinalNewline.nextLines, [
    "## Tasks",
    "",
    "- [ ] #task Ship it [created::2026-08-20]",
    "",
  ]);

  const withoutFinalNewline = resolveSectionPrompt(
    ["## Tasks", "", "- Ship it"],
    2,
    { kind: "existing", heading: { line: 0, depth: 2, title: "Tasks" } },
  );
  assert.deepEqual(withoutFinalNewline.nextLines, [
    "## Tasks",
    "",
    "- [ ] #task Ship it [created::2026-08-20]",
  ]);

  const retained = resolveSectionPrompt(
    ["## Ideas", "", "- Ship it", "- Keep", "", "## Tasks"],
    2,
    { kind: "existing", heading: { line: 5, depth: 2, title: "Tasks" } },
  );
  assert.ok(retained.nextLines.includes("## Ideas"));
  assert.ok(retained.nextLines.includes("- Keep"));

  const crlfSource = [
    "## Tasks",
    "",
    "- Keep first",
    "- Ship it",
    "\t- child",
    "- Keep last",
  ].join("\r\n");
  const crlf = openDemotionPicker(crlfSource, { line: 3, ch: 2 });
  crlf.plugin.getCreatedDateString = () => "2026-08-20";
  assert.equal(
    crlf.plugin.handleToggleObsidianTaskCommand(false, crlf.editor, crlf.view),
    true,
  );
  assert.equal(crlf.editor.getValue(), crlfSource);
  assert.equal(acceptSelectedPickerRow(crlf.plugin), true);
  assert.match(
    crlf.editor.getValue(),
    /- Keep first\r?\n- \[ \] #task Ship it \[created::2026-08-20\]\r?\n\t- child\r?\n- Keep last/,
  );
  assert.deepEqual(crlf.editor.getCursor(), { line: 3, ch: 12 });

  notices.length = 0;
  const cancelledSource = ["- Ship it", "## Tasks"].join("\n");
  const cancelled = openDemotionPicker(cancelledSource, { line: 0, ch: 0 });
  assert.equal(
    cancelled.plugin.handleToggleObsidianTaskCommand(
      false,
      cancelled.editor,
      cancelled.view,
    ),
    true,
  );
  cancelled.plugin.demotionSectionPicker.close();
  assert.equal(cancelled.editor.getValue(), cancelledSource);
  assert.equal(cancelled.plugin.demotionSectionPicker, null);

  const repeated = openDemotionPicker(cancelledSource, { line: 0, ch: 0 });
  assert.equal(
    repeated.plugin.handleToggleObsidianTaskCommand(
      false,
      repeated.editor,
      repeated.view,
    ),
    true,
  );
  const firstPicker = repeated.plugin.demotionSectionPicker;
  assert.equal(
    repeated.plugin.handleToggleObsidianTaskCommand(
      false,
      repeated.editor,
      repeated.view,
    ),
    true,
  );
  assert.equal(repeated.plugin.demotionSectionPicker, firstPicker);
  assert.equal(repeated.editor.getValue(), cancelledSource);

  notices.length = 0;
  const stale = openDemotionPicker(cancelledSource, { line: 0, ch: 0 });
  assert.equal(
    stale.plugin.handleToggleObsidianTaskCommand(false, stale.editor, stale.view),
    true,
  );
  stale.editor.replaceRange("x", { line: 0, ch: 0 });
  const changedValue = stale.editor.getValue();
  assert.equal(acceptSelectedPickerRow(stale.plugin), false);
  assert.equal(stale.editor.getValue(), changedValue);
  assert.match(notices.at(-1), /note changed/i);

  notices.length = 0;
  const missing = openDemotionPicker(cancelledSource, { line: 0, ch: 0 });
  assert.equal(
    missing.plugin.handleToggleObsidianTaskCommand(
      false,
      missing.editor,
      missing.view,
    ),
    true,
  );
  assert.equal(
    acceptPickerDestination(missing.plugin, {
      kind: "existing",
      heading: { line: 99, depth: 2, title: "Ghost" },
    }),
    false,
  );
  assert.equal(missing.editor.getValue(), cancelledSource);
  assert.match(notices.at(-1), /no longer available/i);
});

