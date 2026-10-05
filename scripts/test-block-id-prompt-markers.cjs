const test = require("node:test");
const assert = require("node:assert/strict");
const {
  Plugin,
  helpers,
  createEditor,
  sourceForTaskPicker,
} = require("./block-id-prompt-harness.cjs");

test("single caret relocation preserves embedding and removes aliases", () => {
  const line = "  - ![[Projects|Work queue]]^";
  const marker = helpers.findMarkerLinkNearCursor(line, line.length);

  assert.deepEqual(
    {
      kind: marker.kind,
      raw: marker.raw,
      startCh: marker.startCh,
      endCh: marker.endCh,
      insertionCh: marker.insertionCh,
      finalCursorCh: marker.finalCursorCh,
      plainReplacement: marker.plainReplacement,
      completionReplacement: marker.completionReplacement,
    },
    {
      kind: "file-link-jump",
      raw: "[[Projects|Work queue]]^",
      startCh: line.indexOf("[["),
      endCh: line.length,
      insertionCh: line.indexOf("[[") + 2 + "Projects".length,
      finalCursorCh: line.indexOf("[[") + 3 + "Projects".length,
      plainReplacement: "[[Projects]]",
      completionReplacement: "[[Projects^]]",
    },
  );

  const editor = createEditor(line);
  assert.equal(
    helpers.applyFileLinkBlockCompletionWithEditorApi(editor, 0, marker),
    true,
  );
  assert.equal(editor.getValue(), "  - ![[Projects^]]");
  assert.deepEqual(editor.cursor, { line: 0, ch: marker.finalCursorCh });
});

test("single caret relocation resets aliased block links", () => {
  const line = "  - [[Projects#^existing|Ship it]]^";
  const marker = helpers.findMarkerLinkNearCursor(line, line.length);

  assert.deepEqual(
    {
      raw: marker.raw,
      insertionCh: marker.insertionCh,
      finalCursorCh: marker.finalCursorCh,
      plainReplacement: marker.plainReplacement,
      completionReplacement: marker.completionReplacement,
    },
    {
      raw: "[[Projects#^existing|Ship it]]^",
      insertionCh: line.indexOf("[[") + 2 + "Projects#".length,
      finalCursorCh: line.indexOf("[[") + 3 + "Projects#".length,
      plainReplacement: "[[Projects#]]",
      completionReplacement: "[[Projects#^]]",
    },
  );

  const editor = createEditor(line);
  assert.equal(
    helpers.applyFileLinkBlockCompletionWithEditorApi(editor, 0, marker),
    true,
  );
  assert.equal(editor.getValue(), "  - [[Projects#^]]");
  assert.deepEqual(editor.cursor, { line: 0, ch: marker.finalCursorCh });
});

test("single caret relocation strips heading and block subpaths", () => {
  const cases = [
    ["[[Projects#Heading]]^", "[[Projects#^]]"],
    ["[[Projects#^existing]]^", "[[Projects#^]]"],
    ["[[Projects^existing]]^", "[[Projects#^]]"],
  ];

  for (const [line, expected] of cases) {
    const marker = helpers.findMarkerLinkNearCursor(line, line.length);
    assert.ok(marker, line);

    const editor = createEditor(line);
    assert.equal(
      helpers.applyFileLinkBlockCompletionWithEditorApi(editor, 0, marker),
      true,
      line,
    );
    assert.equal(editor.getValue(), expected, line);
  }
});

test("task picker normalizes every supported wiki block-link form", () => {
  const cases = [
    {
      line: "[[note]]^^",
      targetText: "note",
      aliasSuffix: "",
      blockPrefix: "^",
      revert: "[[note^]]",
    },
    {
      line: "[[note^^]]",
      targetText: "note",
      aliasSuffix: "",
      blockPrefix: "^",
      revert: "[[note^]]",
    },
    {
      line: "[[note#^^]]",
      targetText: "note",
      aliasSuffix: "",
      blockPrefix: "#^",
      revert: "[[note#^]]",
    },
    {
      line: "[[note#^abc]]^^",
      targetText: "note",
      aliasSuffix: "",
      blockPrefix: "#^",
      revert: "[[note#^]]",
    },
    {
      line: "[[note#^abc^^]]",
      targetText: "note",
      aliasSuffix: "",
      blockPrefix: "#^",
      revert: "[[note#^]]",
    },
    {
      line: "[[note#Heading]]^^",
      targetText: "note",
      aliasSuffix: "",
      blockPrefix: "#^",
      revert: "[[note#^]]",
    },
    {
      line: "[[note#Heading^^]]",
      targetText: "note",
      aliasSuffix: "",
      blockPrefix: "#^",
      revert: "[[note#^]]",
    },
    {
      line: "[[^^]]",
      targetText: "",
      aliasSuffix: "",
      blockPrefix: "^",
      revert: "[[^]]",
    },
    {
      line: "[[#^^]]",
      targetText: "",
      aliasSuffix: "",
      blockPrefix: "#^",
      revert: "[[#^]]",
    },
    {
      line: "[[#^abc]]^^",
      targetText: "",
      aliasSuffix: "",
      blockPrefix: "#^",
      revert: "[[#^]]",
    },
    {
      line: "[[note|alias]]^^",
      targetText: "note",
      aliasSuffix: "|alias",
      blockPrefix: "^",
      revert: "[[note^|alias]]",
    },
    {
      line: "![[note]]^^",
      targetText: "note",
      aliasSuffix: "",
      blockPrefix: "^",
      revert: "[[note^]]",
    },
    {
      line: "[[note^abc]]^^",
      targetText: "note",
      aliasSuffix: "",
      blockPrefix: "#^",
      revert: "[[note#^]]",
    },
    {
      line: "[[note^]]^^",
      targetText: "note",
      aliasSuffix: "",
      blockPrefix: "#^",
      revert: "[[note#^]]",
    },
  ];

  for (const expected of cases) {
    const cursorCh = expected.line.lastIndexOf("^^") + 2;
    const marker = helpers.findTaskPickerMarkerNearCursor(
      expected.line,
      cursorCh,
    );
    assert.ok(marker, expected.line);
    assert.equal(marker.targetText, expected.targetText, expected.line);
    assert.equal(marker.aliasSuffix, expected.aliasSuffix, expected.line);
    assert.equal(marker.blockPrefix, expected.blockPrefix, expected.line);
    assert.equal(marker.startCh, expected.line.indexOf("[["), expected.line);
    assert.equal(marker.endCh, expected.line.length, expected.line);
    assert.equal(
      expected.line.slice(marker.startCh, marker.endCh),
      marker.raw,
      expected.line,
    );
    assert.equal(
      helpers.taskPickerRevertReplacement(marker),
      expected.revert,
      expected.line,
    );
    assert.equal(
      helpers.taskPickerRevertCursorCh(marker),
      marker.startCh +
        2 +
        expected.targetText.length +
        expected.blockPrefix.length,
      expected.line,
    );
  }

  const rapid = helpers.findTaskPickerMarkerNearCursor(
    "[[note]]^^",
    "[[note]]^^".length,
  );
  const staged = helpers.findTaskPickerMarkerNearCursor(
    "[[note^^]]",
    "[[note^^]]".indexOf("^^") + 2,
  );
  for (const property of ["kind", "targetText", "aliasSuffix", "blockPrefix"]) {
    assert.equal(rapid[property], staged[property]);
  }
});

test("three or more carets never trigger the task picker", () => {
  for (const line of ["[[note^^^]]", "[[note#^^^]]", "[[note]]^^^"]) {
    assert.equal(
      helpers.findTaskPickerMarkerNearCursor(
        line,
        line.indexOf("^^") + 2,
      ),
      null,
      line,
    );
  }
});

test("rapid aliased task picker completion preserves the alias", async () => {
  const editor = createEditor("- ![[Tasks|Work queue]]^^");
  const source = sourceForTaskPicker(editor, "Daily.md", 0);
  const destinationContent = "- [ ] #task Ship it ^ship";
  const task = helpers.collectTaskPickerItems(destinationContent)[0];
  const plugin = new Plugin();
  plugin.readDestinationForValidation = async () => ({
    file: { path: "Tasks.md" },
    content: destinationContent,
  });
  plugin.suppressEditorScans = () => {};

  assert.equal(source.aliasSuffix, "|Work queue");
  assert.equal(
    helpers.taskPickerRevertReplacement(source),
    "[[Tasks^|Work queue]]",
  );

  const result = await plugin.completeTaskLinkWithExistingId(source, task);

  assert.deepEqual(result, { completed: true });
  assert.equal(editor.getValue(), "- ![[Tasks#^ship|Work queue]]");
  assert.deepEqual(editor.cursor, {
    line: 0,
    ch: source.startCh + "[[Tasks#^ship|Work queue]]".length,
  });
});

test("task picker recognition is independent of Markdown source context", () => {
  const cases = [
    {
      name: "prose paragraph",
      lines: ["## Pomodoros", "- [ ] Open ()", "Text [[note]]^^"],
      line: 2,
    },
    {
      name: "ATX heading",
      lines: ["## Pomodoros", "- [ ] Open ()", "### [[note]]^^"],
      line: 2,
    },
    {
      name: "blockquote",
      lines: ["## Pomodoros", "- [ ] Open ()", "> [[note]]^^"],
      line: 2,
    },
    {
      name: "table cell",
      lines: ["## Pomodoros", "- [ ] Open ()", "| x | [[note]]^^ |"],
      line: 2,
    },
    {
      name: "top-level bullet",
      lines: ["## Pomodoros", "- [ ] Open ()", "- [[note]]^^"],
      line: 2,
    },
    {
      name: "deeply nested bullet",
      lines: ["- Parent", "        - [[note]]^^"],
      line: 1,
    },
    {
      name: "ordinary task line",
      lines: [
        "## Pomodoros",
        "- [ ] Open ()",
        "- [ ] #task [[note]]^^",
      ],
      line: 2,
    },
    {
      name: "ordinary task sub-bullet",
      lines: [
        "## Pomodoros",
        "- [ ] #task Parent",
        "  - [[note]]^^",
      ],
      line: 2,
    },
    {
      name: "note without a Pomodoros section",
      lines: ["- [ ] Open ()", "  - [[note]]^^"],
      line: 1,
    },
  ];

  for (const context of cases) {
    const editor = createEditor(context.lines.join("\n"));
    const source = sourceForTaskPicker(editor, "Note.md", context.line);
    assert.equal(source.targetText, "note", context.name);
    assert.equal(
      helpers.sourceQualifiesForPomodoroActivation(source),
      false,
      context.name,
    );
  }
});

test("task picker recognition respects cursor proximity and fenced code", () => {
  const line = "prefix text  - [[Projects]]^^";
  assert.equal(helpers.findTaskPickerMarkerNearCursor(line, 0), null);
  assert.ok(helpers.findTaskPickerMarkerNearCursor(line, line.length));
  assert.equal(
    helpers.findTaskPickerMarkerNearCursor("- [[Projects]]^^^", 18),
    null,
  );

  const editor = createEditor(["```md", "- [[Projects]]^^", "```"].join("\n"));
  assert.ok(
    helpers.findTaskPickerMarkerNearCursor(
      editor.getLine(1),
      editor.getLine(1).length,
    ),
  );
  assert.equal(helpers.lineIsInsideCodeFence(editor, 1), true);
});
