const test = require("node:test");
const assert = require("node:assert/strict");
const {
  helpers,
  notices,
  createTextEditor,
  noteLines,
  projectNoteLines,
  findHeading,
  resolvePrompt,
  openDemotionPicker,
  acceptPickerDestination,
  acceptSelectedPickerRow,
} = require("./task-status-cycler-harness.cjs");

test("eligible Tasks demotions prompt in project and non-project notes", () => {
  const created = "2026-08-20";
  const cases = [
    {
      name: "project zero extras",
      lines: projectNoteLines(),
      line: 5,
    },
    {
      name: "non-project zero extras",
      lines: noteLines(),
      line: 2,
    },
    {
      name: "one other section",
      lines: noteLines({ extraLines: ["", "## Notes"] }),
      line: 2,
    },
    {
      name: "many other sections",
      lines: noteLines({
        extraLines: ["", "## Notes", "", "## Future Work", "", "### Deep"],
      }),
      line: 2,
    },
  ];

  for (const testCase of cases) {
    const plan = helpers.getObsidianTaskToggleDocumentPlan(
      testCase.lines,
      testCase.line,
      0,
      created,
    );
    assert.equal(plan.mode, "prompt", testCase.name);
    assert.equal(plan.nextLines, undefined, testCase.name);
    assert.equal(
      helpers.isEligibleTasksSectionDemotion(
        testCase.lines,
        testCase.line,
        testCase.lines[testCase.line],
      ),
      true,
      testCase.name,
    );
  }
});

test("selectable headings skip YAML, fences, empty titles, and Tasks", () => {
  const lines = [
    "---",
    "## Frontmatter",
    "type: [[project]]",
    "---",
    "# Overview",
    "## Tasks",
    "",
    "- [ ] #task Ship it",
    "##",
    "```md",
    "## Fenced",
    "```",
    "### Details",
    "#### Deep",
  ];
  const headings = helpers.collectSelectableDemotionHeadings(lines);
  assert.deepEqual(
    headings.map((heading) => [heading.depth, heading.title, heading.line]),
    [
      [1, "Overview", 4],
      [3, "Details", 12],
      [4, "Deep", 13],
    ],
  );
  const prompt = helpers.getObsidianTaskToggleDocumentPlan(lines, 7, 0, "2026-08-20");
  assert.equal(prompt.mode, "prompt");
  assert.deepEqual(prompt.headings, headings);
});

test("duplicate heading identities stay distinct and route to the chosen occurrence", () => {
  const lines = [
    "## Notes",
    "",
    "- already top",
    "## Tasks",
    "",
    "- [ ] #task Ship it",
    "\t- child",
    "## Notes",
    "",
    "- already bottom",
  ];
  const prompt = helpers.getObsidianTaskToggleDocumentPlan(lines, 5, 4, "2026-08-20");
  assert.equal(prompt.mode, "prompt");
  const first = findHeading(lines, "Notes", 0);
  const second = findHeading(lines, "Notes", 1);
  assert.ok(first);
  assert.ok(second);
  assert.equal(helpers.headingIdentitiesEqual(first, second), false);

  const toFirst = helpers.resolveObsidianTaskDemotionDestination(prompt, {
    kind: "existing",
    heading: first,
  });
  assert.equal(toFirst.mode, "move");
  assert.deepEqual(toFirst.nextLines, [
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
  assert.equal(toFirst.cursorLine, 3);
  assert.equal(toFirst.nextLines[toFirst.cursorLine], "- Ship it");

  const toSecond = helpers.resolveObsidianTaskDemotionDestination(prompt, {
    kind: "existing",
    heading: second,
  });
  assert.deepEqual(toSecond.nextLines, [
    "## Notes",
    "",
    "- already top",
    "## Tasks",
    "",
    "## Notes",
    "",
    "- already bottom",
    "- Ship it",
    "\t- child",
  ]);
  assert.equal(toSecond.cursorLine, 8);
});

test("demotion picker defaults and typed names resolve without synthetic duplicates", () => {
  const none = noteLines();
  const nonePrompt = helpers.getObsidianTaskToggleDocumentPlan(none, 2, 0, "2026-08-20");
  const blankState = helpers.createDemotionSectionPickerState(nonePrompt.headings);
  const blankModel = helpers.getDemotionSectionPickerModel(blankState);
  assert.equal(blankModel.rows.length, 1);
  assert.equal(blankModel.primary.kind, "create");
  assert.equal(blankModel.primary.title, "Requirements");
  assert.equal(blankModel.selectedIndex, 0);
  assert.equal(blankModel.selectedRow.title, "Requirements");
  assert.equal(blankModel.inputPlaceholder, "Requirements");
  const created = helpers.resolveObsidianTaskDemotionDestination(
    nonePrompt,
    helpers.getDemotionDestinationFromSelectedRow(blankModel),
  );
  assert.deepEqual(created.nextLines, [
    "## Tasks",
    "",
    "## Requirements",
    "",
    "- Ship it",
  ]);
  assert.equal(created.nextLines[created.cursorLine], "- Ship it");

  const whitespaceModel = helpers.getDemotionSectionPickerModel(
    helpers.setDemotionPickerQuery(blankState, "   "),
  );
  assert.equal(whitespaceModel.rows.length, 1);
  assert.equal(whitespaceModel.primary.kind, "create");
  assert.equal(whitespaceModel.primary.title, "Requirements");

  const oneOther = noteLines({ extraLines: ["", "## Notes", "", "- already"] });
  const oneOtherPrompt = helpers.getObsidianTaskToggleDocumentPlan(
    oneOther,
    2,
    0,
    "2026-08-20",
  );
  const oneOtherModel = helpers.getDemotionSectionPickerModel(
    helpers.createDemotionSectionPickerState(oneOtherPrompt.headings),
  );
  assert.equal(oneOtherModel.primary, null);
  assert.equal(oneOtherModel.rows.length, 1);
  assert.equal(oneOtherModel.rows[0].type, "existing");
  assert.equal(oneOtherModel.rows[0].title, "Notes");
  assert.equal(oneOtherModel.inputPlaceholder, "Filter or type a new section");
  assert.equal(oneOtherModel.statusText, "Move to existing Notes");
  const movedToOnlyOther = helpers.resolveObsidianTaskDemotionDestination(
    oneOtherPrompt,
    helpers.getDemotionDestinationFromSelectedRow(oneOtherModel),
  );
  assert.deepEqual(movedToOnlyOther.nextLines.slice(-3), [
    "",
    "- already",
    "- Ship it",
  ]);
  assert.equal(movedToOnlyOther.nextLines.at(-1), "- Ship it");

  const existing = noteLines({
    extraLines: ["", "##   requirements  ##", "", "- already"],
  });
  const existingPrompt = helpers.getObsidianTaskToggleDocumentPlan(
    existing,
    2,
    0,
    "2026-08-20",
  );
  const existingModel = helpers.getDemotionSectionPickerModel(
    helpers.createDemotionSectionPickerState(existingPrompt.headings),
  );
  assert.equal(existingModel.primary, null);
  assert.equal(existingModel.rows.length, 1);
  assert.equal(existingModel.rows[0].title, "requirements");
  const reused = helpers.resolveObsidianTaskDemotionDestination(
    existingPrompt,
    helpers.getDemotionDestinationFromSelectedRow(existingModel),
  );
  assert.equal(
    reused.nextLines.filter((line) => /^##\s+requirements\s+##$/i.test(line) || line === "## Requirements").length,
    1,
  );
  assert.deepEqual(reused.nextLines.slice(-2), ["- already", "- Ship it"]);

  const requirementsAndOther = noteLines({
    extraLines: ["", "## Requirements", "", "### Notes", "", "# Later"],
  });
  const mixedModel = helpers.getDemotionSectionPickerModel(
    helpers.createDemotionSectionPickerState(
      helpers.getObsidianTaskToggleDocumentPlan(
        requirementsAndOther,
        2,
        0,
        "2026-08-20",
      ).headings,
    ),
  );
  assert.deepEqual(
    mixedModel.rows.map((row) => row.title),
    ["Requirements", "Notes", "Later"],
  );

  const typedCreate = helpers.getDemotionSectionPickerModel(
    helpers.setDemotionPickerQuery(blankState, "  Future Work  "),
  );
  assert.equal(typedCreate.primary.kind, "create");
  assert.equal(typedCreate.primary.title, "Future Work");
  const createdNamed = helpers.resolveObsidianTaskDemotionDestination(
    nonePrompt,
    helpers.getDemotionDestinationFromSelectedRow(typedCreate),
  );
  assert.deepEqual(createdNamed.nextLines.slice(-3), [
    "## Future Work",
    "",
    "- Ship it",
  ]);

  const typedCreateWithFuzzy = helpers.getDemotionSectionPickerModel(
    helpers.setDemotionPickerQuery(
      helpers.createDemotionSectionPickerState(oneOtherPrompt.headings),
      "Nte",
    ),
  );
  assert.equal(typedCreateWithFuzzy.primary.kind, "create");
  assert.equal(typedCreateWithFuzzy.primary.title, "Nte");
  assert.deepEqual(
    typedCreateWithFuzzy.rows.map((row) => [row.type, row.title]),
    [
      ["primary", "Nte"],
      ["existing", "Notes"],
    ],
  );

  const reuseTyped = helpers.getDemotionSectionPickerModel(
    helpers.setDemotionPickerQuery(
      helpers.createDemotionSectionPickerState(existingPrompt.headings),
      "REQUIREMENTS",
    ),
  );
  assert.equal(reuseTyped.primary, null);
  assert.deepEqual(
    reuseTyped.rows.map((row) => row.title),
    ["requirements"],
  );

  const duplicateRequirements = noteLines({
    extraLines: [
      "",
      "## Requirements",
      "",
      "## Readable Requirements",
      "",
      "### Requirements",
    ],
  });
  const duplicateTyped = helpers.getDemotionSectionPickerModel(
    helpers.setDemotionPickerQuery(
      helpers.createDemotionSectionPickerState(
        helpers.getObsidianTaskToggleDocumentPlan(
          duplicateRequirements,
          2,
          0,
          "2026-08-20",
        ).headings,
      ),
      " requirements ",
    ),
  );
  assert.equal(duplicateTyped.primary, null);
  assert.deepEqual(
    duplicateTyped.rows.map((row) => [row.title, row.heading.line]),
    [
      ["Requirements", 4],
      ["Requirements", 8],
      ["Readable Requirements", 6],
    ],
  );

  assert.equal(helpers.getDemotionPrimaryAction("", oneOtherPrompt.headings), null);
  assert.equal(
    helpers.getDemotionPrimaryAction("REQUIREMENTS", existingPrompt.headings),
    null,
  );
  const rejected = helpers.getDemotionPrimaryAction("Tasks", nonePrompt.headings);
  assert.equal(rejected.kind, "invalid");
  assert.match(rejected.statusText, /Tasks is not a valid destination/);
  assert.equal(
    helpers.resolveObsidianTaskDemotionDestination(nonePrompt, {
      kind: "create",
      title: "Tasks",
    }),
    null,
  );

  const fuzzy = helpers.filterSelectableDemotionHeadings(
    existingPrompt.headings,
    "req",
  );
  assert.equal(fuzzy.length, 1);
  assert.equal(fuzzy[0].title, "requirements");
});

test("picker keyboard state wraps, clamps, and refuses invalid Enter", () => {
  const headings = [
    { line: 0, depth: 2, title: "Notes" },
    { line: 8, depth: 3, title: "Details" },
  ];
  let state = helpers.createDemotionSectionPickerState(headings);
  let model = helpers.getDemotionSectionPickerModel(state);
  assert.equal(model.selectedIndex, 0);
  assert.equal(model.rows.length, 2);
  assert.equal(model.canSubmit, true);
  assert.deepEqual(
    helpers.getDemotionSectionPickerRowClasses(model.rows[0], true),
    ["tsc-sdp-row", "is-selected", "is-existing"],
  );
  assert.equal(model.selectedRow.heading.title, "Notes");

  state = helpers.moveDemotionPickerSelection(state, 1);
  model = helpers.getDemotionSectionPickerModel(state);
  assert.equal(model.selectedIndex, 1);
  assert.equal(model.selectedRow.heading.title, "Details");
  assert.equal(
    helpers.getDemotionDestinationFromSelectedRow(model).heading.line,
    8,
  );

  state = helpers.moveDemotionPickerSelection(state, -1);
  assert.equal(helpers.getDemotionSectionPickerModel(state).selectedIndex, 0);
  state = helpers.moveDemotionPickerSelection(state, -1);
  model = helpers.getDemotionSectionPickerModel(state);
  assert.equal(model.selectedIndex, 1);
  assert.equal(model.selectedRow.heading.title, "Details");

  state = helpers.setDemotionPickerQuery(state, "Tasks");
  model = helpers.getDemotionSectionPickerModel(state);
  assert.equal(model.selectedIndex, 0);
  assert.equal(model.primary.kind, "invalid");
  assert.equal(model.canSubmit, false);
  assert.equal(helpers.getDemotionDestinationFromSelectedRow(model), null);
});

test("new-section formatting keeps extra blanks, final newlines, and nested children", () => {
  const nested = noteLines({
    taskLines: ["- [ ] #task Parent", "\t- child", "\t\t- grand"],
  });
  const nestedMove = resolvePrompt(nested, 2, {
    kind: "create",
    title: "Requirements",
  }, 4);
  assert.deepEqual(nestedMove.nextLines, [
    "## Tasks",
    "",
    "## Requirements",
    "",
    "- Parent",
    "\t- child",
    "\t\t- grand",
  ]);
  assert.equal(nestedMove.cursorLine, 4);
  assert.equal(nestedMove.cursorCh, 2);

  const withFinalNewline = noteLines({ extraLines: [""] });
  const finalNewlineMove = resolvePrompt(withFinalNewline, 2, {
    kind: "create",
    title: "Requirements",
  });
  assert.equal(finalNewlineMove.nextLines.at(-1), "");
  assert.equal(finalNewlineMove.nextLines.at(-2), "- Ship it");

  const extraTrailing = noteLines({ extraLines: ["", "", ""] });
  const trailingMove = resolvePrompt(extraTrailing, 2, {
    kind: "create",
    title: "Requirements",
  });
  assert.deepEqual(trailingMove.nextLines, [
    "## Tasks",
    "",
    "## Requirements",
    "",
    "- Ship it",
    "",
  ]);

  const emptySection = noteLines({ extraLines: ["", "## Notes"] });
  const intoEmpty = resolvePrompt(emptySection, 2, {
    kind: "existing",
    heading: findHeading(emptySection, "Notes"),
  });
  assert.deepEqual(intoEmpty.nextLines.slice(-3), [
    "## Notes",
    "",
    "- Ship it",
  ]);

  const withBullet = noteLines({
    extraLines: ["", "## Notes", "", "- already", "\t- keep"],
  });
  const intoBullet = resolvePrompt(withBullet, 2, {
    kind: "existing",
    heading: findHeading(withBullet, "Notes"),
  });
  assert.deepEqual(intoBullet.nextLines.slice(-3), [
    "- already",
    "\t- keep",
    "- Ship it",
  ]);
});

test("existing-section insertion works before and after the source on CRLF-backed editors", () => {
  const lines = [
    "## Notes",
    "",
    "- already",
    "## Tasks",
    "",
    "- [ ] #task Ship it",
    "  continued",
    "## Later",
  ];
  const after = resolvePrompt(lines, 5, {
    kind: "existing",
    heading: findHeading(lines, "Later"),
  }, 8);
  assert.deepEqual(after.nextLines.slice(-4), [
    "## Later",
    "",
    "- Ship it",
    "  continued",
  ]);
  assert.equal(after.nextLines[after.cursorLine], "- Ship it");
  assert.equal(after.cursorCh, 2);

  const source = lines.join("\r\n");
  const { editor, view, plugin } = openDemotionPicker(source, { line: 5, ch: 0 });
  assert.equal(plugin.handleToggleObsidianTaskCommand(true, editor, view), true);
  assert.equal(editor.getValue(), source);
  assert.equal(plugin.handleToggleObsidianTaskCommand(false, editor, view), true);
  assert.equal(editor.getValue(), source);
  assert.equal(
    acceptPickerDestination(plugin, {
      kind: "create",
      title: "Requirements",
    }),
    true,
  );
  assert.match(editor.getValue(), /## Requirements/);
  assert.match(editor.getValue(), /- Ship it\r?\n  continued/);
});

test("command opens one picker, writes only on accept, and restores cursor plus center", () => {
  const source = noteLines({
    taskLines: ["- [ ] #task Ship it", "\t- child"],
  }).join("\n");
  const { editor, view, plugin, centered } = openDemotionPicker(source, {
    line: 2,
    ch: 8,
  });

  assert.equal(plugin.handleToggleObsidianTaskCommand(true, editor, view), true);
  assert.equal(editor.getValue(), source);
  assert.ok(!plugin.demotionSectionPicker);

  assert.equal(plugin.handleToggleObsidianTaskCommand(false, editor, view), true);
  assert.equal(editor.getValue(), source);
  const picker = plugin.demotionSectionPicker;
  assert.ok(picker);
  assert.equal(picker.inputEl.focused, true);
  assert.equal(picker.inputEl.getAttribute("aria-label"), "Section name or filter");
  assert.equal(picker.inputEl.getAttribute("placeholder"), "Requirements");
  assert.equal(picker.statusEl.textContent, "Create ## Requirements");
  assert.equal(picker.resultsEl.getAttribute("role"), "listbox");
  assert.ok(picker.rowEls[0].classes.includes("tsc-sdp-row"));
  assert.ok(picker.rowEls[0].classes.includes("is-selected"));
  assert.equal(picker.rowEls[0].getAttribute("role"), "option");

  const firstPicker = picker;
  assert.equal(plugin.handleToggleObsidianTaskCommand(false, editor, view), true);
  assert.equal(plugin.demotionSectionPicker, firstPicker);

  assert.equal(acceptSelectedPickerRow(plugin), true);
  assert.equal(
    editor.getValue(),
    [
      "## Tasks",
      "",
      "## Requirements",
      "",
      "- Ship it",
      "\t- child",
    ].join("\n"),
  );
  assert.deepEqual(editor.getCursor(), { line: 4, ch: 2 });
  assert.deepEqual(centered, [{ line: 4, ch: 2, sameEditor: true }]);
  assert.equal(plugin.demotionSectionPicker, null);
});

test("pointer activation, Escape, and double-submit protection leave a consistent note", () => {
  const source = noteLines({ extraLines: ["", "## Notes"] }).join("\n");
  const { editor, view, plugin } = openDemotionPicker(source, { line: 2, ch: 0 });
  assert.equal(plugin.handleToggleObsidianTaskCommand(false, editor, view), true);
  const picker = plugin.demotionSectionPicker;
  assert.equal(picker.inputEl.getAttribute("placeholder"), "Filter or type a new section");
  assert.equal(picker.statusEl.textContent, "Move to existing Notes");
  assert.equal(picker.rowEls.length, 1);
  picker.rowEls[0].dispatchEvent("mousedown", { preventDefault() {} });
  picker.rowEls[0].dispatchEvent("click");
  assert.match(editor.getValue(), /## Notes\n\n- Ship it/);
  assert.equal(plugin.demotionSectionPicker, null);
  assert.equal(picker.acceptSelected(), false);

  const cancelled = openDemotionPicker(source, { line: 2, ch: 0 });
  assert.equal(
    cancelled.plugin.handleToggleObsidianTaskCommand(
      false,
      cancelled.editor,
      cancelled.view,
    ),
    true,
  );
  cancelled.plugin.demotionSectionPicker.close();
  assert.equal(cancelled.editor.getValue(), source);
  assert.equal(cancelled.plugin.demotionSectionPicker, null);
});

test("stale document, changed editor, or missing heading notice without writing", () => {
  notices.length = 0;
  const source = noteLines({ extraLines: ["", "## Notes"] }).join("\n");
  const { editor, view, plugin } = openDemotionPicker(source, { line: 2, ch: 0 });
  assert.equal(plugin.handleToggleObsidianTaskCommand(false, editor, view), true);
  editor.replaceRange("x", { line: 0, ch: 0 });
  const changedValue = editor.getValue();
  assert.equal(acceptSelectedPickerRow(plugin), false);
  assert.equal(editor.getValue(), changedValue);
  assert.match(notices.at(-1), /note changed/i);
  assert.equal(plugin.demotionSectionPicker, null);

  notices.length = 0;
  const swapped = openDemotionPicker(source, { line: 2, ch: 0 });
  assert.equal(
    swapped.plugin.handleToggleObsidianTaskCommand(
      false,
      swapped.editor,
      swapped.view,
    ),
    true,
  );
  const otherEditor = createTextEditor(source, { line: 2, ch: 0 });
  swapped.view.editor = otherEditor;
  assert.equal(acceptSelectedPickerRow(swapped.plugin), false);
  assert.equal(swapped.editor.getValue(), source);
  assert.match(notices.at(-1), /note changed/i);

  notices.length = 0;
  const missing = openDemotionPicker(source, { line: 2, ch: 0 });
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
  assert.equal(missing.editor.getValue(), source);
  assert.match(notices.at(-1), /no longer available/i);
});

