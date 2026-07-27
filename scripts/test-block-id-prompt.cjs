const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    class EmptyClass {}
    return {
      MarkdownView: EmptyClass,
      Modal: EmptyClass,
      Notice: EmptyClass,
      Plugin: EmptyClass,
      Setting: EmptyClass,
      TFile: EmptyClass,
      setIcon: () => {},
    };
  }
  if (request === "@codemirror/view") {
    return { EditorView: class EditorView {} };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const Plugin = require("../plugins/block-id-prompt/main.js");
Module._load = originalLoad;
const { helpers } = Plugin;

function createEditor(content) {
  let value = content;
  let cursor = null;

  function positionToIndex(position) {
    let index = 0;
    for (let line = 0; line < position.line; line += 1) {
      const newline = value.indexOf("\n", index);
      assert.notEqual(newline, -1);
      index = newline + 1;
    }

    return index + position.ch;
  }

  return {
    getLine(line) {
      return value.split("\n")[line] || "";
    },
    getValue() {
      return value;
    },
    replaceRange(replacement, from, to = from) {
      const start = positionToIndex(from);
      const end = positionToIndex(to);
      value = value.slice(0, start) + replacement + value.slice(end);
    },
    setCursor(nextCursor) {
      cursor = nextCursor;
    },
    get cursor() {
      return cursor;
    },
  };
}

function applyPlannedEdits(content, edits) {
  let result = content;
  for (const edit of [...edits].sort((left, right) => right.start - left.start)) {
    result =
      result.slice(0, edit.start) +
      edit.replacement +
      result.slice(edit.end);
  }
  return result;
}

function sourceForTaskPicker(editor, sourcePath, line) {
  const lineText = editor.getLine(line);
  const cursorCh = lineText.lastIndexOf("^^") + 2;
  const marker = helpers.findTaskPickerMarkerNearCursor(lineText, cursorCh);
  assert.ok(marker);
  return { ...marker, editor, sourcePath, line };
}

test("explicit task IDs exclusively own dependency lookup", () => {
  const content = [
    "- [ ] #task Parent [dependsOn:: projects__Shared__review] ^parent",
    "- [ ] #task Target [id:: projects__Shared__review] ^review",
  ].join("\n");
  const state = helpers.collectTaskPickerItems(content)[0].dependency;
  assert.equal(state.isBlocked, true);
  assert.equal(state.unmetBlockers[0].id, "projects__Shared__review");

  const stale = content.replace(
    "projects__Shared__review] ^parent",
    "review] ^parent",
  );
  const staleState = helpers.collectTaskPickerItems(stale)[0].dependency;
  assert.deepEqual(staleState.unresolvedIds, ["review"]);
  assert.equal(staleState.isBlocked, false);
});

test("legacy tasks without an id field still fall back to their block ID", () => {
  const content = [
    "- [ ] #task Parent [dependsOn:: review] ^parent",
    "- [ ] #task Legacy target ^review",
  ].join("\n");
  assert.equal(helpers.collectTaskPickerItems(content)[0].dependency.isBlocked, true);
});

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
      helpers.shouldPromoteTaskToNext(source, { status: " " }),
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

test("list item body bounds trim whitespace and reject empty bullets", () => {
  const line = "  - \t [[note]]^^ \t\r";
  assert.deepEqual(helpers.listItemBodyBounds(line), {
    start: line.indexOf("[["),
    end: line.indexOf("^^") + 2,
  });
  assert.deepEqual(helpers.listItemBodyBounds("  1. [[note]]^^"), {
    start: "  1. ".length,
    end: "  1. [[note]]^^".length,
  });
  assert.equal(helpers.listItemBodyBounds("  -   \r"), null);
  assert.equal(helpers.listItemBodyBounds("    [[note]]^^"), null);
});

test("task promotion requires a sole-content Pomodoro sub-bullet", () => {
  const cases = [
    ["    - [[note]]^^", true],
    ["    - ![[note]]^^", true],
    ["    - [[note]]^^   ", true],
    ["    - [[note#^abc^^]]", true],
    ["    1. [[note]]^^", true],
    ["        - [[note]]^^", true],
    ["    - working on [[note]]^^", false],
    ["    - [[note]]^^ — blocked on Bob", false],
    ["    - [[note]]^^ [[other]]", false],
    ["    - [ ] #task [[note]]^^", false],
    ["    [[note]]^^", false],
    ["- [[note]]^^", false],
  ];

  for (const [lineText, expected] of cases) {
    const editor = createEditor(
      [
        "## Pomodoros",
        "- [ ] (**10:00 - 10:25**)",
        lineText,
      ].join("\n"),
    );
    const source = sourceForTaskPicker(editor, "Daily.md", 2);
    assert.equal(
      helpers.shouldPromoteTaskToNext(source, { status: " " }),
      expected,
      lineText,
    );
  }

  const ordinaryEditor = createEditor(
    [
      "## Pomodoros",
      "- [ ] #task Ordinary task",
      "  - [[note]]^^",
    ].join("\n"),
  );
  const ordinarySource = sourceForTaskPicker(
    ordinaryEditor,
    "Daily.md",
    2,
  );
  assert.equal(
    helpers.shouldPromoteTaskToNext(ordinarySource, { status: " " }),
    false,
  );

  const pomodoroEditor = createEditor(
    [
      "## Pomodoros",
      "- [ ] (**10:00 - 10:25**)",
      "  - [[note]]^^",
    ].join("\n"),
  );
  const pomodoroSource = sourceForTaskPicker(
    pomodoroEditor,
    "Daily.md",
    2,
  );
  for (const status of ["/", "*"]) {
    assert.equal(
      helpers.shouldPromoteTaskToNext(pomodoroSource, { status }),
      false,
      status,
    );
  }
});

test("Pomodoro source context distinguishes ledger ancestry and open state", () => {
  const lines = [
    "## Pomodoros",
    "- [ ] Open ()",
    "  - [[Tasks]]^^",
    "- [/] Running (**10:00 - 10:25**)",
    "  - [[Tasks]]^^",
    "- [x] Complete (1030-1055)",
    "  - [[Tasks]]^^",
    "- [-] Canceled ()",
    "  - [[Tasks]]^^",
    "- [ ] #task Ordinary task",
    "  - [[Tasks]]^^",
    "## Notes",
    "  - [[Tasks]]^^",
  ];

  assert.deepEqual(
    helpers.findPomodoroSourceContext(lines, 2),
    {
      section: { startLine: 1, endLine: 10 },
      ownerLine: 1,
      status: " ",
      isOpen: true,
    },
  );
  assert.equal(helpers.findPomodoroSourceContext(lines, 4).isOpen, true);
  assert.equal(helpers.findPomodoroSourceContext(lines, 6).isOpen, false);
  assert.equal(helpers.findPomodoroSourceContext(lines, 8).isOpen, false);
  assert.equal(helpers.findPomodoroSourceContext(lines, 10), null);
  assert.equal(helpers.findPomodoroSourceContext(lines, 12), null);

  for (const sourceLine of [6, 8, 10, 12]) {
    const plan = helpers.planFuturePomodoroLinkCleanup(lines.join("\n"), {
      sourceLine,
      sourcePath: "Daily.md",
      targetPath: "Tasks.md",
      targetBlockId: "ship",
      resolveTarget: () => "Tasks.md",
    });
    assert.deepEqual(plan, { edits: [], removedCount: 0 });
  }
});

test("future cleanup touches only later open Pomodoros and counts duplicates", () => {
  const content = [
    "## Pomodoros",
    "- [ ] Earlier ()",
    "  - [[Alpha#^ship]]",
    "- [ ] Current ()",
    "  - [[Alpha]]^^",
    "- [ ] Later ()",
    "  - [[Alpha#^ship|Ship it]]",
    "    - Keep this nested continuation",
    "  - Keep [[Alpha#^ship]] and [[Beta#^other]]",
    "- [/] Running ()",
    "  - Note ~~[[Alias#^ship|Ship]]~~ remains",
    "- [x] Closed history (1100-1125)",
    "  - [[Alpha#^ship]]",
    "- [-] Canceled ()",
    "  - [[Alpha#^ship]]",
    "## Notes",
    "- [[Alpha#^ship]]",
  ].join("\n");

  const plan = helpers.planFuturePomodoroLinkCleanup(content, {
    sourceLine: 4,
    sourcePath: "Daily.md",
    targetPath: "projects/Alpha.md",
    targetBlockId: "ship",
    resolveTarget: (reference) =>
      ["Alpha", "Alias"].includes(reference.targetText)
        ? "projects/Alpha.md"
        : "projects/Beta.md",
  });
  const result = applyPlannedEdits(content, plan.edits);

  assert.equal(plan.removedCount, 3);
  assert.doesNotMatch(result, /Keep this nested continuation/);
  assert.match(result, /Keep  and \[\[Beta#\^other\]\]/);
  assert.match(result, /Note  remains/);
  assert.equal((result.match(/\[\[Alpha#\^ship\]\]/g) || []).length, 4);
  assert.doesNotMatch(result, /Ship it/);
});

test("cleanup resolves aliases, embeds, same-note links, and alternate paths", () => {
  const content = [
    "## Pomodoros",
    "- [ ] Current ()",
    "  - [[^^]]",
    "- [ ] Later ()",
    "  - [[#^same]]",
    "  - Keep ![[Alias#^same|Same task]]^ and [[Other#^same]]",
    "  - [[../daily/Daily#^same]]",
    "  - [[Missing#^same]]",
    "  ```md",
    "  - [[#^same]]",
    "  ```",
  ].join("\n");
  const paths = new Map([
    ["", "daily/Daily.md"],
    ["Alias", "daily/Daily.md"],
    ["../daily/Daily", "daily/Daily.md"],
    ["Other", "projects/Other.md"],
  ]);

  const plan = helpers.planFuturePomodoroLinkCleanup(content, {
    sourceLine: 2,
    sourcePath: "daily/Daily.md",
    targetPath: "daily/Daily.md",
    targetBlockId: "same",
    resolveTarget: (reference) => paths.get(reference.targetText) || null,
  });
  const result = applyPlannedEdits(content, plan.edits);

  assert.equal(plan.removedCount, 3);
  assert.match(result, /Keep  and \[\[Other#\^same\]\]/);
  assert.match(result, /\[\[Missing#\^same\]\]/);
  assert.match(result, /```md\n  - \[\[#\^same\]\]\n  ```/);
  assert.doesNotMatch(result, /Same task/);

  const noMatch = helpers.planFuturePomodoroLinkCleanup(content, {
    sourceLine: 2,
    sourcePath: "daily/Daily.md",
    targetPath: "projects/Absent.md",
    targetBlockId: "same",
    resolveTarget: (reference) => paths.get(reference.targetText) || null,
  });
  assert.deepEqual(noMatch, { edits: [], removedCount: 0 });
  assert.equal(applyPlannedEdits(content, noMatch.edits), content);
});

test("dedicated bullet subtree cleanup preserves CRLF line endings", () => {
  const content = [
    "## Pomodoros",
    "- [ ] Current ()",
    "  - [[Alpha]]^^",
    "- [ ] Later ()",
    "  - [[Alpha#^ship]]",
    "    continuation text",
    "  - Keep this bullet",
  ].join("\r\n");
  const expected = [
    "## Pomodoros",
    "- [ ] Current ()",
    "  - [[Alpha]]^^",
    "- [ ] Later ()",
    "  - Keep this bullet",
  ].join("\r\n");

  const plan = helpers.planFuturePomodoroLinkCleanup(content, {
    sourceLine: 2,
    sourcePath: "Daily.md",
    targetPath: "Alpha.md",
    targetBlockId: "ship",
    resolveTarget: () => "Alpha.md",
  });
  const result = applyPlannedEdits(content, plan.edits);

  assert.equal(plan.removedCount, 1);
  assert.equal(result, expected);
  assert.doesNotMatch(result, /(^|[^\r])\n/);
});

test("existing-ID task completion prunes future links in the source editor", async () => {
  const editor = createEditor(
    [
      "## Pomodoros",
      "- [ ] Current ()",
      "  - [[Tasks]]^^",
      "- [ ] Later ()",
      "  - [[Tasks#^ship|Ship]]",
    ].join("\n"),
  );
  const source = sourceForTaskPicker(editor, "Daily.md", 2);
  const destinationContent = "- [ ] #task Ship it ^ship";
  const task = helpers.collectTaskPickerItems(destinationContent)[0];
  const plugin = new Plugin();
  let promoted = false;
  plugin.readDestinationForValidation = async () => ({
    file: { path: "Tasks.md" },
    content: destinationContent,
  });
  plugin.applyTaskLineEdit = async () => {
    promoted = true;
    return true;
  };
  plugin.resolveReferenceDestination = () => ({ path: "Tasks.md" });
  plugin.suppressEditorScans = () => {};

  const result = await plugin.completeTaskLinkWithExistingId(source, task);

  assert.deepEqual(result, { completed: true });
  assert.equal(promoted, true);
  assert.match(editor.getValue(), /\[\[Tasks#\^ship\]\]/);
  assert.doesNotMatch(editor.getValue(), /Ship\]\]/);
  assert.deepEqual(editor.cursor, {
    line: 2,
    ch: source.startCh + "[[Tasks#^ship]]".length,
  });
});

test("new-ID same-file completion plans cleanup after the task edit", async () => {
  const editor = createEditor(
    [
      "- [ ] #task Ship it",
      "## Pomodoros",
      "- [ ] Current ()",
      "  - [[^^]]",
      "- [ ] Later ()",
      "  - [[#^ship]]",
    ].join("\n"),
  );
  const source = sourceForTaskPicker(editor, "Daily.md", 3);
  const task = helpers.collectTaskPickerItems(editor.getValue())[0];
  const plugin = new Plugin();
  plugin.readDestinationForValidation = async () => ({
    file: { path: "Daily.md" },
    content: editor.getValue(),
  });
  plugin.resolveReferenceDestination = (reference) =>
    reference.targetText === "" ? { path: "Daily.md" } : null;
  plugin.suppressEditorScans = () => {};

  const result = await plugin.submitLinkTaskBlockId(
    { ...source, kind: "link-task-complete", task },
    "ship",
  );

  assert.equal(result, true);
  assert.match(editor.getValue(), /^- \[\*\] #task Ship it \^ship/m);
  assert.match(editor.getValue(), /  - \[\[#\^ship\]\]/);
  assert.equal((editor.getValue().match(/\[\[#\^ship\]\]/g) || []).length, 1);
  assert.deepEqual(editor.cursor, {
    line: 3,
    ch: source.startCh + "[[#^ship]]".length,
  });
});
