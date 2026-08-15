const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const noticeMessages = [];
let obsidianStubs = null;

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    class EmptyClass {}
    class NoticeStub {
      constructor(message) {
        noticeMessages.push(message);
      }
    }
    obsidianStubs = {
      MarkdownView: EmptyClass,
      Modal: EmptyClass,
      Notice: NoticeStub,
      normalizePath: (value) =>
        String(value || "").replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, ""),
      Plugin: EmptyClass,
      Setting: EmptyClass,
      TFile: EmptyClass,
      setIcon: () => {},
    };
    return obsidianStubs;
  }
  if (request === "@codemirror/view") {
    class EditorView {}
    EditorView.updateListener = { of: (callback) => ({ callback }) };
    return { EditorView };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const Plugin = require("../plugins/block-id-prompt/main.js");
Module._load = originalLoad;
const { helpers } = Plugin;

function resetNotices() {
  noticeMessages.length = 0;
}

function lastNotice() {
  return noticeMessages[noticeMessages.length - 1];
}

function localDate(year, month, day) {
  return new Date(year, month - 1, day);
}

const WORK_LOG_DATE = { year: 2026, month: 8, day: 15 };

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
    getCursor() {
      return cursor;
    },
    listSelections() {
      return cursor ? [{ anchor: cursor, head: cursor }] : [];
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

function sourceForPomodoroLink(editor, sourcePath, line) {
  const lineText = editor.getLine(line);
  const task = helpers.findDirectPomodoroLinkTask(lineText, line);
  assert.ok(task);
  return { kind: "link-task-pomodoro", editor, sourcePath, line, task: { ...task } };
}

function createTFile(path) {
  const file = new obsidianStubs.TFile();
  file.path = path;
  file.extension = path.split(".").pop();
  return file;
}

function createMarkdownView(file) {
  const view = new obsidianStubs.MarkdownView();
  view.file = file;
  return view;
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

test("task picker includes Blocked tasks and excludes closed, hidden, and untagged lines", () => {
  const content = [
    "- [ ] #task Ready",
    "- [/] #task Active",
    "- [*] #task Next",
    "- [?] #task Blocked",
    "- [x] #task Done lowercase",
    "- [X] #task Done uppercase",
    "- [-] #task Canceled",
    "- [?] Missing project tag",
    "- [?] #task Hidden #hide",
  ].join("\n");

  const tasks = helpers.collectTaskPickerItems(content);

  assert.deepEqual(tasks.map((task) => task.status), [" ", "/", "*", "?"]);
  assert.deepEqual(tasks.map((task) => task.line), [0, 1, 2, 3]);
});

test("task blocked state unifies status and dependency reasons", () => {
  const noDependencies = {
    depIds: [],
    unmetBlockers: [],
    metCount: 0,
    unresolvedIds: [],
    isBlocked: false,
  };
  const unmetDependency = {
    depIds: ["blocked-target", "done-target", "missing-target"],
    unmetBlockers: [
      { id: "blocked-target", title: "Blocked target", line: 8, status: " " },
    ],
    metCount: 1,
    unresolvedIds: ["missing-target"],
    isBlocked: true,
  };

  assert.deepEqual(
    helpers.taskBlockedState({ status: "?", dependency: noDependencies }),
    {
      isBlocked: true,
      statusBlocked: true,
      dependencyBlocked: false,
      depCount: 0,
      metCount: 0,
      unmetCount: 0,
      unresolvedCount: 0,
      unmetBlockers: [],
    },
  );
  assert.deepEqual(
    helpers.taskBlockedState({ status: " ", dependency: unmetDependency }),
    {
      isBlocked: true,
      statusBlocked: false,
      dependencyBlocked: true,
      depCount: 3,
      metCount: 1,
      unmetCount: 1,
      unresolvedCount: 1,
      unmetBlockers: unmetDependency.unmetBlockers,
    },
  );
  assert.deepEqual(
    helpers.taskBlockedState({ status: "?", dependency: unmetDependency }),
    {
      isBlocked: true,
      statusBlocked: true,
      dependencyBlocked: true,
      depCount: 3,
      metCount: 1,
      unmetCount: 1,
      unresolvedCount: 1,
      unmetBlockers: unmetDependency.unmetBlockers,
    },
  );
  assert.deepEqual(
    helpers.taskBlockedState({ status: " ", dependency: noDependencies }),
    {
      isBlocked: false,
      statusBlocked: false,
      dependencyBlocked: false,
      depCount: 0,
      metCount: 0,
      unmetCount: 0,
      unresolvedCount: 0,
      unmetBlockers: [],
    },
  );
});

test("task picker partition sinks blocked tasks while preserving group order", () => {
  const dependencyBlocked = {
    depIds: ["target"],
    unmetBlockers: [
      { id: "target", title: "Target", line: 10, status: " " },
    ],
    metCount: 0,
    unresolvedIds: [],
    isBlocked: true,
  };
  const tasks = [
    { line: 0, status: " " },
    { line: 1, status: "?" },
    { line: 2, status: " ", dependency: dependencyBlocked },
    { line: 3, status: "/" },
    { line: 4, status: "?", dependency: dependencyBlocked },
  ];

  const groups = helpers.partitionTaskPickerItems(tasks);

  assert.deepEqual(groups.unblocked.map((task) => task.line), [0, 3]);
  assert.deepEqual(groups.blocked.map((task) => task.line), [1, 2, 4]);
});

test("blocked chip labels show useful unmet dependency counts", () => {
  assert.equal(
    helpers.blockedChipLabel({
      dependencyBlocked: true,
      depCount: 1,
      unmetCount: 1,
    }),
    "Blocked",
  );
  assert.equal(
    helpers.blockedChipLabel({
      dependencyBlocked: true,
      depCount: 3,
      unmetCount: 2,
    }),
    "Blocked · 2",
  );
  assert.equal(
    helpers.blockedChipLabel({
      dependencyBlocked: false,
      depCount: 0,
      unmetCount: 0,
    }),
    "Blocked",
  );
});

test("blocked tooltips explain dependency and status-only reasons", () => {
  const dependencyBlocked = helpers.taskBlockedState({
    status: " ",
    dependency: {
      depIds: ["a", "b", "c", "d", "missing-a", "missing-b"],
      unmetBlockers: [
        { id: "a", title: "Alpha" },
        { id: "b", title: "Beta" },
        { id: "c", title: "Gamma" },
        { id: "d", title: "Delta" },
      ],
      metCount: 0,
      unresolvedIds: ["missing-a", "missing-b"],
      isBlocked: true,
    },
  });
  assert.equal(
    helpers.buildBlockedTooltip(dependencyBlocked),
    "Blocked by: Alpha, Beta, Gamma, +1 more; 2 unresolved",
  );

  assert.equal(
    helpers.buildBlockedTooltip(
      helpers.taskBlockedState({ status: "?" }),
    ),
    "Marked Blocked in the note; no dependencies listed",
  );

  const unresolved = helpers.taskBlockedState({
    status: "?",
    dependency: {
      depIds: ["missing-a", "missing-b"],
      unmetBlockers: [],
      metCount: 0,
      unresolvedIds: ["missing-a", "missing-b"],
      isBlocked: false,
    },
  });
  assert.equal(
    helpers.buildBlockedTooltip(unresolved),
    "Marked Blocked in the note; 2 unresolved dependency references",
  );

  const allDone = helpers.taskBlockedState({
    status: "?",
    dependency: {
      depIds: ["done-a", "done-b"],
      unmetBlockers: [],
      metCount: 2,
      unresolvedIds: [],
      isBlocked: false,
    },
  });
  assert.equal(
    helpers.buildBlockedTooltip(allDone),
    "Marked Blocked in the note; all 2 dependencies are done",
  );
});

test("task status classes cover every open task status", () => {
  assert.equal(helpers.taskStatusClass(" "), "todo");
  assert.equal(helpers.taskStatusClass("/"), "active");
  assert.equal(helpers.taskStatusClass("*"), "next");
  assert.equal(helpers.taskStatusClass("?"), "blocked");
});

test("Blocked tasks remain unmet dependency targets", () => {
  const content = [
    "- [ ] #task Parent [dependsOn:: target] ^parent",
    "- [?] #task Target ^target",
  ].join("\n");
  const parent = helpers.collectTaskPickerItems(content)[0];

  assert.equal(parent.dependency.isBlocked, true);
  assert.equal(parent.dependency.unmetBlockers.length, 1);
  assert.equal(parent.dependency.unmetBlockers[0].status, "?");
});

test("blocked task count covers both reasons without double-counting", () => {
  const dependencyBlocked = {
    depIds: ["target"],
    unmetBlockers: [{ id: "target", title: "Target" }],
    metCount: 0,
    unresolvedIds: [],
    isBlocked: true,
  };
  const tasks = [
    { status: "?" },
    { status: " ", dependency: dependencyBlocked },
    { status: "?", dependency: dependencyBlocked },
    { status: " " },
  ];

  assert.equal(helpers.countBlockedTasks(tasks), 3);
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

test("Pomodoro activation eligibility requires a sole-content sub-bullet", () => {
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
      helpers.sourceQualifiesForPomodoroActivation(source),
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
    helpers.sourceQualifiesForPomodoroActivation(ordinarySource),
    false,
  );
});

test("Pomodoro activation eligibility requires an open owner, rejecting completed and canceled history", () => {
  for (const [ownerLine, expected] of [
    ["- [ ] Open ()", true],
    ["- [ ] (**10:00 - 10:25**)", true],
    ["- [/] Running (**10:00 - 10:25**)", true],
    ["- [x] Complete (1030-1055)", false],
    ["- [-] Canceled ()", false],
  ]) {
    const editor = createEditor(
      ["## Pomodoros", ownerLine, "  - [[note]]^^"].join("\n"),
    );
    const source = sourceForTaskPicker(editor, "Daily.md", 2);
    assert.equal(
      helpers.sourceQualifiesForPomodoroActivation(source),
      expected,
      ownerLine,
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
  plugin.applyTargetTaskPlan = async () => {
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

// --- Future-scheduled Pomodoro activation -----------------------------------

test("calendar date parsing rejects malformed width and impossible dates", () => {
  assert.deepEqual(helpers.parseStrictCalendarDate("2026-07-17"), {
    year: 2026,
    month: 7,
    day: 17,
  });
  assert.deepEqual(helpers.parseStrictCalendarDate("2028-02-29"), {
    year: 2028,
    month: 2,
    day: 29,
  });
  assert.equal(helpers.parseStrictCalendarDate("2026-02-29"), null, "non-leap Feb 29");
  assert.equal(helpers.parseStrictCalendarDate("2026-02-30"), null, "impossible day");
  assert.equal(helpers.parseStrictCalendarDate("2026-13-01"), null, "impossible month");
  assert.equal(helpers.parseStrictCalendarDate("2026-00-10"), null, "zero month");
  assert.equal(helpers.parseStrictCalendarDate("2026-07-00"), null, "zero day");
  assert.equal(helpers.parseStrictCalendarDate("2026-7-20"), null, "single-digit month");
  assert.equal(helpers.parseStrictCalendarDate("2026-07-2"), null, "single-digit day");
  assert.equal(helpers.parseStrictCalendarDate("26-07-20"), null, "two-digit year");
  assert.equal(helpers.parseStrictCalendarDate(""), null);
  assert.equal(helpers.parseStrictCalendarDate(null), null);
});

test("future scheduled field detection respects the yesterday/today/tomorrow boundary", () => {
  const today = { year: 2026, month: 7, day: 16 };
  assert.equal(
    helpers.findSingleFutureScheduledField("- [ ] #task X [scheduled:: 2026-07-15]", today),
    null,
    "yesterday",
  );
  assert.equal(
    helpers.findSingleFutureScheduledField("- [ ] #task X [scheduled:: 2026-07-16]", today),
    null,
    "today",
  );
  const tomorrow = helpers.findSingleFutureScheduledField(
    "- [ ] #task X [scheduled:: 2026-07-17]",
    today,
  );
  assert.ok(tomorrow, "tomorrow");
  assert.deepEqual(tomorrow.date, { year: 2026, month: 7, day: 17 });

  assert.ok(
    helpers.findSingleFutureScheduledField("- [ ] #task X [scheduled:: 2028-02-29]", {
      year: 2028,
      month: 2,
      day: 27,
    }),
    "future leap day",
  );
  assert.equal(
    helpers.findSingleFutureScheduledField("- [ ] #task X [scheduled:: 2026-02-30]", today),
    null,
    "impossible date",
  );
  assert.equal(
    helpers.findSingleFutureScheduledField("- [ ] #task X [scheduled:: 2026-7-20]", today),
    null,
    "malformed width",
  );
});

test("scheduled field recognition covers bracket and paren forms in any position and on quoted/numbered lines", () => {
  assert.equal(
    helpers.findScheduledFieldMatches(
      "- [ ] #task X [scheduled:: 2026-07-17] [priority:: high]",
    )[0].value,
    "2026-07-17",
  );
  assert.equal(
    helpers.findScheduledFieldMatches(
      "- [ ] #task X [priority:: high] (scheduled:: 2026-07-18)",
    )[0].value,
    "2026-07-18",
  );
  assert.equal(
    helpers.findScheduledFieldMatches(
      "> - [?] #task Quoted [scheduled:: 2026-07-19] ^quoted",
    )[0].value,
    "2026-07-19",
  );
  assert.equal(
    helpers.findScheduledFieldMatches(
      "1. [?] #task Numbered [scheduled:: 2026-07-20] ^numbered",
    )[0].value,
    "2026-07-20",
  );
  assert.equal(
    helpers.findScheduledFieldMatches(
      "- [ ] #task X (scheduled::   2026-07-18  )",
    )[0].value,
    "2026-07-18",
    "surrounding whitespace is trimmed for validation",
  );
});

test("planTargetTaskUpdate removes a future schedule and promotes Ready/Blocked to Next", () => {
  const now = localDate(2026, 7, 16);
  for (const status of ["?", " "]) {
    const content = `- [${status}] #task Ship it [scheduled:: 2026-07-20] ^ship`;
    const plan = helpers.planTargetTaskUpdate(content, 0, { activationEligible: true, now });
    assert.ok(plan, status);
    assert.equal(plan.removedFutureSchedule, true, status);
    assert.equal(plan.statusChanged, true, status);
    assert.equal(plan.newStatus, "*", status);
    assert.equal(plan.content, "- [*] #task Ship it ^ship", status);
  }
});

test("planTargetTaskUpdate unschedules a future task while preserving Next/In-Progress status", () => {
  const now = localDate(2026, 7, 16);
  for (const status of ["*", "/"]) {
    const content = `- [${status}] #task Ship it [scheduled:: 2026-07-20] ^ship`;
    const plan = helpers.planTargetTaskUpdate(content, 0, { activationEligible: true, now });
    assert.equal(plan.removedFutureSchedule, true, status);
    assert.equal(plan.statusChanged, false, status);
    assert.equal(plan.newStatus, status, status);
    assert.equal(plan.content, `- [${status}] #task Ship it ^ship`, status);
  }
});

test("planTargetTaskUpdate keeps the legacy unscheduled Ready promotion and Blocked non-promotion", () => {
  const now = localDate(2026, 7, 16);
  const ready = helpers.planTargetTaskUpdate("- [ ] #task Ship it ^ship", 0, {
    activationEligible: true,
    now,
  });
  assert.equal(ready.removedFutureSchedule, false);
  assert.equal(ready.newStatus, "*");
  assert.equal(ready.content, "- [*] #task Ship it ^ship");

  const blocked = helpers.planTargetTaskUpdate("- [?] #task Ship it ^ship", 0, {
    activationEligible: true,
    now,
  });
  assert.equal(blocked.hasChanges, false);
  assert.equal(blocked.newStatus, "?");
  assert.equal(blocked.content, "- [?] #task Ship it ^ship");
});

test("planTargetTaskUpdate leaves an already Next or In-Progress task alone when there is no future schedule", () => {
  const now = localDate(2026, 7, 16);
  for (const status of ["*", "/"]) {
    const content = `- [${status}] #task Ship it ^ship`;
    const plan = helpers.planTargetTaskUpdate(content, 0, { activationEligible: true, now });
    assert.equal(plan.hasChanges, false, status);
    assert.equal(plan.content, content, status);
  }
});

test("planTargetTaskUpdate leaves today and past schedules untouched", () => {
  const now = localDate(2026, 7, 16);
  const today = helpers.planTargetTaskUpdate(
    "- [ ] #task Ship it [scheduled:: 2026-07-16] ^ship",
    0,
    { activationEligible: true, now },
  );
  assert.equal(today.removedFutureSchedule, false);
  assert.equal(today.newStatus, "*");
  assert.equal(today.content, "- [*] #task Ship it [scheduled:: 2026-07-16] ^ship");

  const past = helpers.planTargetTaskUpdate(
    "- [?] #task Ship it [scheduled:: 2026-07-01] ^ship",
    0,
    { activationEligible: true, now },
  );
  assert.equal(past.removedFutureSchedule, false);
  assert.equal(past.hasChanges, false);
  assert.equal(past.content, "- [?] #task Ship it [scheduled:: 2026-07-01] ^ship");
});

test("planTargetTaskUpdate never touches status or schedule when the source is not activation-eligible", () => {
  const now = localDate(2026, 7, 16);
  for (const status of [" ", "?", "*", "/"]) {
    const content = `- [${status}] #task Ship it [scheduled:: 2026-07-20] ^ship`;
    const plan = helpers.planTargetTaskUpdate(content, 0, { activationEligible: false, now });
    assert.equal(plan.hasChanges, false, status);
    assert.equal(plan.content, content, status);
  }
});

test("two or more recognized scheduled fields are ambiguous and never touch the Schedule Log, even when a marker exists", () => {
  const now = localDate(2026, 7, 16);
  const content = [
    "- [?] #task Ship it [scheduled:: 2026-07-20] [scheduled:: 2026-07-25] ^ship",
    "  - 🗓️ **SCHEDULE LOG**",
  ].join("\n");
  const plan = helpers.planTargetTaskUpdate(content, 0, { activationEligible: true, now });
  assert.equal(plan.removedFutureSchedule, false);
  assert.equal(plan.logEntryAdded, false);
  assert.equal(plan.hasChanges, false);
  assert.equal(plan.content, content);
});

test("a malformed single scheduled field is never treated as future", () => {
  const now = localDate(2026, 7, 16);
  const content = "- [?] #task Ship it [scheduled:: 2026-02-30] ^ship";
  const plan = helpers.planTargetTaskUpdate(content, 0, { activationEligible: true, now });
  assert.equal(plan.removedFutureSchedule, false);
  assert.equal(plan.hasChanges, false);
  assert.equal(plan.content, content);
});

test("an ambiguous scheduled field does not block the legacy Ready promotion", () => {
  const now = localDate(2026, 7, 16);
  const content = "- [ ] #task Ship it [scheduled:: 2026-07-20] [scheduled:: 2026-07-25] ^ship";
  const plan = helpers.planTargetTaskUpdate(content, 0, { activationEligible: true, now });
  assert.equal(plan.removedFutureSchedule, false);
  assert.equal(plan.newStatus, "*");
  assert.match(plan.content, /\[scheduled:: 2026-07-20\] \[scheduled:: 2026-07-25\]/);
});

test("planTargetTaskUpdate activation works on quoted and numbered task lines and preserves unrelated fields", () => {
  const now = localDate(2026, 8, 15);
  const quoted = helpers.planTargetTaskUpdate(
    "> - [?] #task Quoted [priority:: high] [scheduled:: 2026-08-20] ^quoted",
    0,
    { activationEligible: true, now },
  );
  assert.equal(quoted.content, "> - [*] #task Quoted [priority:: high] ^quoted");

  const numbered = helpers.planTargetTaskUpdate(
    "1. [ ] #task Numbered [scheduled:: 2026-08-20] [dependsOn:: x] ^numbered",
    0,
    { activationEligible: true, now },
  );
  assert.equal(numbered.content, "1. [*] #task Numbered [dependsOn:: x] ^numbered");
});

test("Schedule Log marker recognition covers canonical, emoji-less, and legacy forms, and ignores nested grandchildren", () => {
  const canonical = [
    "- [?] #task Ship it ^ship",
    "  - 🗓️ **SCHEDULE LOG**",
    "    - _2026-08-01 → 2026-08-20_ — waiting on review",
  ];
  assert.deepEqual(helpers.findScheduleLogMarker(canonical, 0), {
    line: 1,
    indent: "  ",
    marker: "-",
  });

  assert.deepEqual(
    helpers.findScheduleLogMarker(["- [?] #task X ^x", "  - **SCHEDULE LOG**"], 0),
    { line: 1, indent: "  ", marker: "-" },
    "emoji-less form",
  );
  assert.deepEqual(
    helpers.findScheduleLogMarker(["- [?] #task X ^x", "  - **Schedule log:**"], 0),
    { line: 1, indent: "  ", marker: "-" },
    "legacy form",
  );

  const nested = [
    "- [?] #task X ^x",
    "  - Some other child",
    "    - 🗓️ **SCHEDULE LOG**",
  ];
  assert.equal(helpers.findScheduleLogMarker(nested, 0), null, "nested grandchild is ignored");
  assert.equal(helpers.findScheduleLogMarker(["- [?] #task X ^x"], 0), null, "no marker at all");
});

test("Schedule Log entry indentation reuses an existing entry or falls back to marker indent plus a tab", () => {
  const withEntry = [
    "- [?] #task X ^x",
    "  - 🗓️ **SCHEDULE LOG**",
    "    - _2026-08-01 → 2026-08-20_ — waiting on review",
  ];
  assert.equal(helpers.findScheduleLogEntryIndent(withEntry, 1), "    ");

  const withoutEntry = ["- [?] #task X ^x", "  - 🗓️ **SCHEDULE LOG**"];
  assert.equal(helpers.findScheduleLogEntryIndent(withoutEntry, 1), "  \t");
});

test("planTargetTaskUpdate prepends a newest-first Schedule Log entry when a marker already exists", () => {
  const now = localDate(2026, 8, 15);
  const content = [
    "- [?] #task Ship it [scheduled:: 2026-08-20] ^ship",
    "  - 🗓️ **SCHEDULE LOG**",
    "    - _2026-08-01 → 2026-08-20_ — waiting on review",
  ].join("\n");
  const plan = helpers.planTargetTaskUpdate(content, 0, { activationEligible: true, now });

  assert.equal(plan.removedFutureSchedule, true);
  assert.equal(plan.logEntryAdded, true);
  assert.equal(plan.logInsertLine, 2);
  assert.equal(
    plan.content,
    [
      "- [*] #task Ship it ^ship",
      "  - 🗓️ **SCHEDULE LOG**",
      "    - _2026-08-20 → 2026-08-15_ — 🍅 pulled into today's Pomodoro",
      "    - _2026-08-01 → 2026-08-20_ — waiting on review",
    ].join("\n"),
  );
});

test("planTargetTaskUpdate creates the first entry using marker indent plus a tab when the marker has none yet", () => {
  const now = localDate(2026, 8, 15);
  const content = [
    "- [ ] #task Ship it [scheduled:: 2026-08-20] ^ship",
    "  - 🗓️ **SCHEDULE LOG**",
  ].join("\n");
  const plan = helpers.planTargetTaskUpdate(content, 0, { activationEligible: true, now });

  assert.equal(
    plan.content,
    [
      "- [*] #task Ship it ^ship",
      "  - 🗓️ **SCHEDULE LOG**",
      "  \t- _2026-08-20 → 2026-08-15_ — 🍅 pulled into today's Pomodoro",
    ].join("\n"),
  );
});

test("planTargetTaskUpdate never creates a Schedule Log for a task that keeps none", () => {
  const now = localDate(2026, 8, 15);
  const plan = helpers.planTargetTaskUpdate(
    "- [?] #task Ship it [scheduled:: 2026-08-20] ^ship",
    0,
    { activationEligible: true, now },
  );
  assert.equal(plan.removedFutureSchedule, true);
  assert.equal(plan.logEntryAdded, false);
  assert.equal(plan.content, "- [*] #task Ship it ^ship");
});

test("planTargetTaskUpdate preserves CRLF line endings, inheriting the marker's line ending for the new entry", () => {
  const now = localDate(2026, 8, 15);
  const content = [
    "- [?] #task Ship it [scheduled:: 2026-08-20] ^ship",
    "  - 🗓️ **SCHEDULE LOG**",
    "    - _2026-08-01 → 2026-08-20_ — waiting on review",
  ].join("\r\n");
  const plan = helpers.planTargetTaskUpdate(content, 0, { activationEligible: true, now });

  assert.equal(
    plan.content,
    [
      "- [*] #task Ship it ^ship",
      "  - 🗓️ **SCHEDULE LOG**",
      "    - _2026-08-20 → 2026-08-15_ — 🍅 pulled into today's Pomodoro",
      "    - _2026-08-01 → 2026-08-20_ — waiting on review",
    ].join("\r\n"),
  );
});

test("planTargetTaskUpdate preserves a missing trailing newline when the log lands at end of file", () => {
  const now = localDate(2026, 8, 15);
  const content = [
    "- [?] #task Ship it [scheduled:: 2026-08-20] ^ship",
    "  - 🗓️ **SCHEDULE LOG**",
  ].join("\n");
  const plan = helpers.planTargetTaskUpdate(content, 0, { activationEligible: true, now });

  assert.equal(plan.content.endsWith("\n"), false);
  assert.equal(
    plan.content,
    [
      "- [*] #task Ship it ^ship",
      "  - 🗓️ **SCHEDULE LOG**",
      "  \t- _2026-08-20 → 2026-08-15_ — 🍅 pulled into today's Pomodoro",
    ].join("\n"),
  );
});

test("planTargetTaskUpdate preserves a trailing newline when one was already present", () => {
  const now = localDate(2026, 8, 15);
  const content =
    ["- [?] #task Ship it [scheduled:: 2026-08-20] ^ship", "  - 🗓️ **SCHEDULE LOG**"].join(
      "\n",
    ) + "\n";
  const plan = helpers.planTargetTaskUpdate(content, 0, { activationEligible: true, now });

  assert.equal(plan.content.endsWith("\n"), true);
});

test("planTargetTaskUpdate never mutates the exact whitespace of a scheduled field it does not remove", () => {
  const now = localDate(2026, 7, 16);
  const content = "- [?] #task Ship it (scheduled::   2026-07-01  ) ^ship";
  const plan = helpers.planTargetTaskUpdate(content, 0, { activationEligible: true, now });
  assert.equal(plan.content, content);
});

test("planTargetTaskUpdate keeps a new block ID as the final token after unschedule, status, and log changes", () => {
  const now = localDate(2026, 8, 15);
  const content = [
    "- [?] #task Ship it [scheduled:: 2026-08-20] [priority:: high]",
    "  - 🗓️ **SCHEDULE LOG**",
  ].join("\n");
  const plan = helpers.planTargetTaskUpdate(content, 0, {
    activationEligible: true,
    newBlockId: "ship",
    now,
  });

  assert.equal(plan.blockIdAppended, true);
  assert.equal(
    plan.content,
    [
      "- [*] #task Ship it [priority:: high] ^ship",
      "  - 🗓️ **SCHEDULE LOG**",
      "  \t- _2026-08-20 → 2026-08-15_ — 🍅 pulled into today's Pomodoro",
    ].join("\n"),
  );
});

test("planTargetTaskUpdate never duplicates an existing block ID on the existing-ID path", () => {
  const now = localDate(2026, 8, 15);
  const plan = helpers.planTargetTaskUpdate("- [ ] #task Ship it ^ship", 0, {
    activationEligible: true,
    now,
  });
  assert.equal(plan.blockIdAppended, false);
  assert.equal((plan.content.match(/\^ship/g) || []).length, 1);
});

test("existing-ID activation runtime: cross-note guarded write, canonical link, and success notice", async () => {
  resetNotices();
  const editor = createEditor(
    ["## Pomodoros", "- [ ] Current ()", "  - [[Tasks]]^^"].join("\n"),
  );
  const source = sourceForTaskPicker(editor, "Daily.md", 2);
  const destinationContent = [
    "- [?] #task Ship it [scheduled:: 2026-08-20] ^ship",
    "  - 🗓️ **SCHEDULE LOG**",
    "    - _2026-08-01 → 2026-08-20_ — waiting on review",
  ].join("\n");
  const task = helpers.collectTaskPickerItems(destinationContent)[0];
  const plugin = new Plugin();
  plugin.now = () => localDate(2026, 8, 15);
  let written = null;
  plugin.readDestinationForValidation = async () => ({
    file: { path: "Tasks.md" },
    content: destinationContent,
  });
  plugin.app = {
    vault: {
      read: async (file) => (file.path === "Tasks.md" ? destinationContent : null),
      modify: async (file, content) => {
        written = { path: file.path, content };
      },
    },
  };
  plugin.resolveReferenceDestination = () => ({ path: "Tasks.md" });
  plugin.suppressEditorScans = () => {};

  const result = await plugin.completeTaskLinkWithExistingId(source, task);

  assert.deepEqual(result, { completed: true });
  assert.ok(written);
  assert.equal(written.path, "Tasks.md");
  assert.equal(
    written.content,
    [
      "- [*] #task Ship it ^ship",
      "  - 🗓️ **SCHEDULE LOG**",
      "    - _2026-08-20 → 2026-08-15_ — 🍅 pulled into today's Pomodoro",
      "    - _2026-08-01 → 2026-08-20_ — waiting on review",
    ].join("\n"),
  );
  assert.match(editor.getValue(), /\[\[Tasks#\^ship\]\]/);
  assert.equal(
    lastNotice(),
    "Linked task block · removed future schedule · set Next · logged schedule change",
  );
});

test("new-ID activation runtime: cross-note guarded write, appended ID stays final, and success notice", async () => {
  resetNotices();
  const editor = createEditor(
    ["## Pomodoros", "- [ ] Current ()", "  - [[Tasks]]^^"].join("\n"),
  );
  const source = sourceForTaskPicker(editor, "Daily.md", 2);
  const destinationContent = [
    "- [ ] #task Ship it [scheduled:: 2026-08-20] [priority:: high]",
    "  - 🗓️ **SCHEDULE LOG**",
  ].join("\n");
  const task = helpers.collectTaskPickerItems(destinationContent)[0];
  const plugin = new Plugin();
  plugin.now = () => localDate(2026, 8, 15);
  let written = null;
  plugin.readDestinationForValidation = async () => ({
    file: { path: "Tasks.md" },
    content: destinationContent,
  });
  plugin.app = {
    vault: {
      read: async (file) => (file.path === "Tasks.md" ? destinationContent : null),
      modify: async (file, content) => {
        written = { path: file.path, content };
      },
    },
  };
  plugin.resolveReferenceDestination = () => ({ path: "Tasks.md" });
  plugin.suppressEditorScans = () => {};

  const result = await plugin.submitLinkTaskBlockId(
    { ...source, kind: "link-task-complete", task },
    "ship",
  );

  assert.equal(result, true);
  assert.ok(written);
  assert.equal(
    written.content,
    [
      "- [*] #task Ship it [priority:: high] ^ship",
      "  - 🗓️ **SCHEDULE LOG**",
      "  \t- _2026-08-20 → 2026-08-15_ — 🍅 pulled into today's Pomodoro",
    ].join("\n"),
  );
  assert.match(editor.getValue(), /\[\[Tasks#\^ship\]\]/);
  assert.equal(
    lastNotice(),
    "Added block ID and linked task · removed future schedule · set Next · logged schedule change",
  );
});

test("activation runtime aborts without any write when the target preimage goes stale", async () => {
  resetNotices();
  const editor = createEditor(
    ["## Pomodoros", "- [ ] Current ()", "  - [[Tasks]]^^"].join("\n"),
  );
  const before = editor.getValue();
  const source = sourceForTaskPicker(editor, "Daily.md", 2);
  const plannedContent = [
    "- [?] #task Ship it [scheduled:: 2026-08-20] ^ship",
    "  - 🗓️ **SCHEDULE LOG**",
  ].join("\n");
  const staleContent = plannedContent.replace("Ship it", "Ship it NOW");
  const task = helpers.collectTaskPickerItems(plannedContent)[0];
  const plugin = new Plugin();
  plugin.now = () => localDate(2026, 8, 15);
  let modifyCalled = false;
  plugin.readDestinationForValidation = async () => ({
    file: { path: "Tasks.md" },
    content: plannedContent,
  });
  plugin.app = {
    vault: {
      read: async () => staleContent,
      modify: async () => {
        modifyCalled = true;
      },
    },
  };
  plugin.resolveReferenceDestination = () => ({ path: "Tasks.md" });
  plugin.suppressEditorScans = () => {};

  const result = await plugin.completeTaskLinkWithExistingId(source, task);

  assert.equal(result, null);
  assert.equal(modifyCalled, false);
  assert.equal(editor.getValue(), before);
  assert.equal(lastNotice(), "Task link stopped: Tasks.md changed before update");
});

test("same-note activation shifts the Pomodoro source line when the Schedule Log entry lands before it", async () => {
  resetNotices();
  const editor = createEditor(
    [
      "- [?] #task Ship it [scheduled:: 2026-08-20] ^ship",
      "  - 🗓️ **SCHEDULE LOG**",
      "    - _2026-08-01 → 2026-08-20_ — waiting on review",
      "## Pomodoros",
      "- [ ] Current ()",
      "  - [[^^]]",
      "- [ ] Later ()",
      "  - [[#^ship]]",
      "## Notes",
      "- keep this section",
    ].join("\n"),
  );
  const source = sourceForTaskPicker(editor, "Daily.md", 5);
  const task = helpers.collectTaskPickerItems(editor.getValue())[0];
  const plugin = new Plugin();
  plugin.now = () => localDate(2026, 8, 15);
  plugin.readDestinationForValidation = async () => ({
    file: { path: "Daily.md" },
    content: editor.getValue(),
  });
  plugin.resolveReferenceDestination = (reference) =>
    reference.targetText === "" ? { path: "Daily.md" } : null;
  plugin.suppressEditorScans = () => {};

  const result = await plugin.completeTaskLinkWithExistingId(source, task);

  assert.deepEqual(result, { completed: true });
  assert.equal(
    editor.getValue(),
    [
      "- [*] #task Ship it ^ship",
      "  - 🗓️ **SCHEDULE LOG**",
      "    - _2026-08-20 → 2026-08-15_ — 🍅 pulled into today's Pomodoro",
      "    - _2026-08-01 → 2026-08-20_ — waiting on review",
      "## Pomodoros",
      "- [ ] Current ()",
      "  - [[#^ship]]",
      "- [ ] Later ()",
      "## Notes",
      "- keep this section",
    ].join("\n"),
  );
  assert.deepEqual(editor.cursor, {
    line: 6,
    ch: source.startCh + "[[#^ship]]".length,
  });
});

test("same-note activation leaves the Pomodoro source line untouched when the Schedule Log entry lands after it", async () => {
  resetNotices();
  const editor = createEditor(
    [
      "## Pomodoros",
      "- [ ] Current ()",
      "  - [[^^]]",
      "- [?] #task Ship it [scheduled:: 2026-08-20] ^ship",
      "  - 🗓️ **SCHEDULE LOG**",
    ].join("\n"),
  );
  const source = sourceForTaskPicker(editor, "Daily.md", 2);
  const task = helpers.collectTaskPickerItems(editor.getValue())[0];
  const plugin = new Plugin();
  plugin.now = () => localDate(2026, 8, 15);
  plugin.readDestinationForValidation = async () => ({
    file: { path: "Daily.md" },
    content: editor.getValue(),
  });
  plugin.resolveReferenceDestination = (reference) =>
    reference.targetText === "" ? { path: "Daily.md" } : null;
  plugin.suppressEditorScans = () => {};

  const result = await plugin.completeTaskLinkWithExistingId(source, task);

  assert.deepEqual(result, { completed: true });
  assert.equal(
    editor.getValue(),
    [
      "## Pomodoros",
      "- [ ] Current ()",
      "  - [[#^ship]]",
      "- [*] #task Ship it ^ship",
      "  - 🗓️ **SCHEDULE LOG**",
      "  \t- _2026-08-20 → 2026-08-15_ — 🍅 pulled into today's Pomodoro",
    ].join("\n"),
  );
  assert.deepEqual(editor.cursor, {
    line: 2,
    ch: source.startCh + "[[#^ship]]".length,
  });
});

test("a source marker edited after a successful existing-ID target write reports an accurate partial notice", async () => {
  resetNotices();
  const editor = createEditor(
    ["## Pomodoros", "- [ ] Current ()", "  - [[Tasks]]^^"].join("\n"),
  );
  const source = sourceForTaskPicker(editor, "Daily.md", 2);
  const destinationContent = [
    "- [?] #task Ship it [scheduled:: 2026-08-20] ^ship",
    "  - 🗓️ **SCHEDULE LOG**",
  ].join("\n");
  const task = helpers.collectTaskPickerItems(destinationContent)[0];
  const plugin = new Plugin();
  plugin.now = () => localDate(2026, 8, 15);
  let written = null;
  plugin.readDestinationForValidation = async () => ({
    file: { path: "Tasks.md" },
    content: destinationContent,
  });
  plugin.app = {
    vault: {
      read: async () => destinationContent,
      modify: async (file, content) => {
        written = { path: file.path, content };
        // Simulate the user editing the source link away right as the target
        // write lands, before source-link completion runs.
        editor.replaceRange(
          "typed over",
          { line: source.line, ch: source.startCh },
          { line: source.line, ch: source.endCh },
        );
      },
    },
  };
  plugin.resolveReferenceDestination = () => ({ path: "Tasks.md" });
  plugin.suppressEditorScans = () => {};

  const result = await plugin.completeTaskLinkWithExistingId(source, task);

  assert.equal(result, null);
  assert.ok(written, "target note was still written");
  assert.match(editor.getValue(), /typed over/);
  assert.equal(
    lastNotice(),
    "Task unscheduled, set Next, logged, but the source link changed before completion",
  );
});

test("a source marker edited after a successful new-ID target write reports an accurate partial notice", async () => {
  resetNotices();
  const editor = createEditor(
    ["## Pomodoros", "- [ ] Current ()", "  - [[Tasks]]^^"].join("\n"),
  );
  const source = sourceForTaskPicker(editor, "Daily.md", 2);
  const destinationContent = "- [ ] #task Ship it [scheduled:: 2026-08-20]";
  const task = helpers.collectTaskPickerItems(destinationContent)[0];
  const plugin = new Plugin();
  plugin.now = () => localDate(2026, 8, 15);
  plugin.readDestinationForValidation = async () => ({
    file: { path: "Tasks.md" },
    content: destinationContent,
  });
  plugin.app = {
    vault: {
      read: async () => destinationContent,
      modify: async () => {
        editor.replaceRange(
          "typed over",
          { line: source.line, ch: source.startCh },
          { line: source.line, ch: source.endCh },
        );
      },
    },
  };
  plugin.resolveReferenceDestination = () => ({ path: "Tasks.md" });
  plugin.suppressEditorScans = () => {};

  const result = await plugin.submitLinkTaskBlockId(
    { ...source, kind: "link-task-complete", task },
    "ship",
  );

  assert.equal(result, true);
  assert.match(editor.getValue(), /typed over/);
  assert.equal(
    lastNotice(),
    "Task block ID added and unscheduled, set Next, but the source link changed before completion",
  );
});

// ---------------------------------------------------------------------------
// Ctrl+Shift+Enter direct Pomodoro link.
// ---------------------------------------------------------------------------

test("planTargetTaskUpdate forceNext promotes every open status to Next, unlike plain activationEligible", () => {
  const now = localDate(2026, 8, 15);
  for (const status of [" ", "/", "*", "?"]) {
    const plan = helpers.planTargetTaskUpdate(`- [${status}] #task Do it`, 0, {
      forceNext: true,
      now,
    });
    assert.equal(plan.newStatus, "*");
    assert.equal(plan.statusChanged, status !== "*");
  }
});

test("planTargetTaskUpdate without forceNext leaves an In Progress task and an unscheduled Blocked task alone", () => {
  const now = localDate(2026, 8, 15);
  const inProgress = helpers.planTargetTaskUpdate("- [/] #task Do it", 0, {
    activationEligible: true,
    now,
  });
  assert.equal(inProgress.newStatus, "/");
  assert.equal(inProgress.statusChanged, false);

  const blockedNoSchedule = helpers.planTargetTaskUpdate("- [?] #task Do it", 0, {
    activationEligible: true,
    now,
  });
  assert.equal(blockedNoSchedule.newStatus, "?");
  assert.equal(blockedNoSchedule.statusChanged, false);
});

test("planTargetTaskUpdate forceNext still removes a uniquely future schedule and logs it against an existing Schedule Log", () => {
  const now = localDate(2026, 8, 15);
  const content = [
    "- [?] #task Ship it [scheduled:: 2026-08-20]",
    "  - 🗓️ **SCHEDULE LOG**",
  ].join("\n");
  const plan = helpers.planTargetTaskUpdate(content, 0, { forceNext: true, now });
  assert.equal(plan.removedFutureSchedule, true);
  assert.equal(plan.newStatus, "*");
  assert.equal(plan.logEntryAdded, true);
});

test("planTargetTaskUpdate forceNext never creates a Schedule Log for a task that keeps none", () => {
  const now = localDate(2026, 8, 15);
  const plan = helpers.planTargetTaskUpdate(
    "- [?] #task Ship it [scheduled:: 2026-08-20]",
    0,
    { forceNext: true, now },
  );
  assert.equal(plan.removedFutureSchedule, true);
  assert.equal(plan.newStatus, "*");
  assert.equal(plan.logEntryAdded, false);
  assert.equal(plan.content, "- [*] #task Ship it");
});

test("findDirectPomodoroLinkTask includes a #hide project task, unlike the task-picker's own listing", () => {
  const line = "- [ ] #task #hide Secret errand";
  const task = helpers.findDirectPomodoroLinkTask(line, 0);
  assert.ok(task);
  assert.equal(task.status, " ");
  assert.equal(helpers.collectTaskPickerItems(line).length, 0);
});

test("findDirectPomodoroLinkTask rejects closed/canceled tasks and non-task lines", () => {
  assert.equal(helpers.findDirectPomodoroLinkTask("- [x] #task Done already", 0), null);
  assert.equal(helpers.findDirectPomodoroLinkTask("- [-] #task Canceled", 0), null);
  assert.equal(helpers.findDirectPomodoroLinkTask("Just a paragraph.", 0), null);
  assert.equal(helpers.findDirectPomodoroLinkTask("- plain list item, not a task", 0), null);
  assert.equal(helpers.findDirectPomodoroLinkTask("- [ ] no task tag here", 0), null);
});

test("findDirectPomodoroLinkTask accepts every open status and carries the existing block ID", () => {
  for (const status of [" ", "/", "*", "?"]) {
    const task = helpers.findDirectPomodoroLinkTask(`- [${status}] #task Ship it ^ship`, 3);
    assert.ok(task);
    assert.equal(task.status, status);
    assert.equal(task.existingId, "ship");
    assert.equal(task.line, 3);
  }
});

test("todayDailyPath formats the default YYYY/YYYYMMDD layout under the configured folder", () => {
  const path = helpers.todayDailyPath(localDate(2026, 8, 5), {
    folder: "Daily",
    format: "YYYY/YYYYMMDD",
  });
  assert.equal(path, "Daily/2026/20260805.md");
});

test("todayDailyPath honors a custom Daily Notes format and an empty folder", () => {
  const path = helpers.todayDailyPath(localDate(2026, 3, 9), { folder: "", format: "YYYY-MM-DD" });
  assert.equal(path, "2026-03-09.md");
});

test("formatDailyDate resolves bracketed literal text alongside date tokens", () => {
  const text = helpers.formatDailyDate(localDate(2026, 1, 2), "[Day] YYYY-MM-DD");
  assert.equal(text, "Day 2026-01-02");
});

test("getDailyNotesOptions reads the daily-notes core plugin's configured options", () => {
  const app = {
    internalPlugins: {
      plugins: {
        "daily-notes": { instance: { options: { folder: "Daily", format: "YYYY/YYYYMMDD" } } },
      },
    },
  };
  assert.deepEqual(helpers.getDailyNotesOptions(app), { folder: "Daily", format: "YYYY/YYYYMMDD" });
  assert.deepEqual(helpers.getDailyNotesOptions({}), {});
});

test("computeFencedLineFlags marks opening and closing fence lines and everything between", () => {
  const lines = ["before", "```", "inside", "```", "after"];
  assert.deepEqual(helpers.computeFencedLineFlags(lines), [false, true, true, true, false]);
});

test("selectPomodoroInsertionTarget prefers the single open timed entry over a placeholder", () => {
  const lines = ["## Pomodoros", "- [ ] Next ()", "- [ ] Current (10:00-10:25)"];
  const section = { startLine: 1, endLine: 2 };
  const fenced = helpers.computeFencedLineFlags(lines);
  assert.deepEqual(helpers.selectPomodoroInsertionTarget(lines, section, fenced), {
    entryLine: 2,
  });
});

test("selectPomodoroInsertionTarget falls back to the first open placeholder when nothing is timed", () => {
  const lines = ["## Pomodoros", "- [x] Done (09:00-09:25)", "- [ ] Later ()", "- [ ] Even later ()"];
  const section = { startLine: 1, endLine: 3 };
  const fenced = helpers.computeFencedLineFlags(lines);
  assert.deepEqual(helpers.selectPomodoroInsertionTarget(lines, section, fenced), {
    entryLine: 2,
  });
});

test("selectPomodoroInsertionTarget rejects more than one open timed entry", () => {
  const lines = ["## Pomodoros", "- [ ] A (10:00-10:25)", "- [ ] B (11:00-11:25)"];
  const section = { startLine: 1, endLine: 2 };
  const fenced = helpers.computeFencedLineFlags(lines);
  assert.deepEqual(helpers.selectPomodoroInsertionTarget(lines, section, fenced), {
    error: "multiple-open-timed",
  });
});

test("selectPomodoroInsertionTarget ignores fenced and nested entries and picks the remaining eligible one", () => {
  const lines = [
    "## Pomodoros",
    "```",
    "- [ ] Fake (10:00-10:25)",
    "```",
    "- [ ] Real ()",
    "  - [ ] #task nested, not a top-level entry (12:00-12:25)",
  ];
  const section = { startLine: 1, endLine: 5 };
  const fenced = helpers.computeFencedLineFlags(lines);
  assert.deepEqual(helpers.selectPomodoroInsertionTarget(lines, section, fenced), {
    entryLine: 4,
  });
});

test("findPomodoroChildIndentation reuses an existing child bullet, then the section's, then falls back to two spaces", () => {
  const withOwnChild = ["## Pomodoros", "- [ ] Current ()", "\t- existing child"];
  assert.equal(
    helpers.findPomodoroChildIndentation(withOwnChild, 1, 2, { startLine: 1, endLine: 2 }),
    "\t",
  );

  const withSectionChild = ["## Pomodoros", "- [ ] Current ()", "- [ ] Other ()", "\t- other's child"];
  assert.equal(
    helpers.findPomodoroChildIndentation(withSectionChild, 1, 1, { startLine: 1, endLine: 3 }),
    "\t",
  );

  const withNoChild = ["## Pomodoros", "- [ ] Current ()"];
  assert.equal(
    helpers.findPomodoroChildIndentation(withNoChild, 1, 1, { startLine: 1, endLine: 1 }),
    "  ",
  );
});

test("planPomodoroLinkInsertion inserts under the selected entry using an existing child's indentation", () => {
  const daily = [
    "## Pomodoros",
    "- [x] Done (09:00-09:25) old task",
    "- [ ] Current (10:00-10:25) something",
    "  - [[Other#^abc]]",
    "- [ ] Next ()",
  ].join("\n");
  const plan = helpers.planPomodoroLinkInsertion(daily, {
    blockId: "foobar",
    targetPath: "Tasks.md",
    sourcePath: "Daily.md",
    resolveTarget: (reference) =>
      reference.oldId === "abc" ? "Other.md" : reference.oldId === "foobar" ? "Tasks.md" : null,
    linkText: "[[Tasks#^foobar]]",
  });
  assert.equal(plan.entryLine, 2);
  assert.equal(plan.alreadyLinked, false);
  assert.equal(plan.removedCount, 0);
  assert.equal(
    plan.content,
    [
      "## Pomodoros",
      "- [x] Done (09:00-09:25) old task",
      "- [ ] Current (10:00-10:25) something",
      "  - [[Other#^abc]]",
      "  - [[Tasks#^foobar]]",
      "- [ ] Next ()",
    ].join("\n"),
  );
});

test("planPomodoroLinkInsertion is idempotent and prunes a matching link from a later open Pomodoro", () => {
  const daily = [
    "## Pomodoros",
    "- [ ] Current (10:00-10:25)",
    "  - [[Tasks#^foobar]]",
    "- [ ] Next ()",
    "  - [[Tasks#^foobar]]",
  ].join("\n");
  const plan = helpers.planPomodoroLinkInsertion(daily, {
    blockId: "foobar",
    targetPath: "Tasks.md",
    sourcePath: "Daily.md",
    resolveTarget: (reference) => (reference.oldId === "foobar" ? "Tasks.md" : null),
    linkText: "[[Tasks#^foobar]]",
  });
  assert.equal(plan.alreadyLinked, true);
  assert.equal(plan.removedCount, 1);
  assert.equal(
    plan.content,
    ["## Pomodoros", "- [ ] Current (10:00-10:25)", "  - [[Tasks#^foobar]]", "- [ ] Next ()", ""].join(
      "\n",
    ),
  );
});

test("planPomodoroLinkInsertion reports no-section, no-eligible-entry, and multiple-open-timed without any edits", () => {
  const base = {
    blockId: "foobar",
    targetPath: "Tasks.md",
    sourcePath: "Daily.md",
    resolveTarget: () => null,
    linkText: "[[Tasks#^foobar]]",
  };
  assert.deepEqual(helpers.planPomodoroLinkInsertion("# Notes\nhello", base), {
    error: "no-section",
  });
  assert.deepEqual(
    helpers.planPomodoroLinkInsertion(["## Pomodoros", "- [x] Done (10:00-10:25)"].join("\n"), base),
    { error: "no-eligible-entry" },
  );
  assert.deepEqual(
    helpers.planPomodoroLinkInsertion(
      ["## Pomodoros", "- [ ] A (10:00-10:25)", "- [ ] B (11:00-11:25)"].join("\n"),
      base,
    ),
    { error: "multiple-open-timed" },
  );
});

test("planFuturePomodoroLinkCleanup accepts a direct ownerLine/section context, bypassing findPomodoroSourceContext", () => {
  const content = [
    "## Pomodoros",
    "- [ ] Current (10:00-10:25)",
    "- [ ] Later ()",
    "  - [[Tasks#^ship]]",
  ].join("\n");
  const result = helpers.planFuturePomodoroLinkCleanup(content, {
    ownerLine: 1,
    section: { startLine: 1, endLine: 3 },
    sourcePath: "Daily.md",
    targetPath: "Tasks.md",
    targetBlockId: "ship",
    resolveTarget: (reference) => (reference.oldId === "ship" ? "Tasks.md" : null),
  });
  assert.equal(result.removedCount, 1);
});

test("all-open cleanup removes current and future links while preserving history and unresolved links", () => {
  const content = [
    "## Pomodoros",
    "- [x] Earlier done (09:00-09:25)",
    "  - [[#^ship]]",
    "- [ ] Current (10:00-10:25)",
    "  - [[#^ship]]",
    "    - remove this child too",
    "- [/] Running ()",
    "  - Keep ![[Alias#^ship|Ship]] and [[Other#^ship]] and [[Missing#^ship]]",
    "  ```md",
    "  - [[#^ship]]",
    "  ```",
    "- [ ] Later ()",
    "  - [[../daily/Daily#^ship]]",
    "- [-] Canceled ()",
    "  - [[#^ship]]",
    "## Notes",
    "- [[#^ship]]",
  ].join("\n");
  const paths = new Map([
    ["", "daily/Daily.md"],
    ["Alias", "daily/Daily.md"],
    ["../daily/Daily", "daily/Daily.md"],
    ["Other", "projects/Other.md"],
  ]);

  const plan = helpers.planAllOpenPomodoroLinkCleanup(content, {
    sourcePath: "daily/Daily.md",
    targetPath: "daily/Daily.md",
    targetBlockId: "ship",
    resolveTarget: (reference) => paths.get(reference.targetText) || null,
  });
  const result = applyPlannedEdits(content, plan.edits);

  assert.equal(plan.removedCount, 3);
  assert.equal(plan.hasChanges, true);
  assert.doesNotMatch(result, /remove this child too/);
  assert.match(result, /Keep  and \[\[Other#\^ship\]\] and \[\[Missing#\^ship\]\]/);
  assert.match(result, /```md\n  - \[\[#\^ship\]\]\n  ```/);
  assert.match(result, /\[x\] Earlier done[\s\S]*\[\[#\^ship\]\]/);
  assert.match(result, /\[-\] Canceled[\s\S]*\[\[#\^ship\]\]/);
  assert.match(result, /## Notes\n- \[\[#\^ship\]\]/);
  assert.doesNotMatch(result, /Alias#\^ship/);
  assert.doesNotMatch(result, /\.\.\/daily\/Daily#\^ship/);
});

test("all-open cleanup treats missing section, no open entries, and no matches as no-op successes", () => {
  const base = {
    sourcePath: "Daily.md",
    targetPath: "Tasks.md",
    targetBlockId: "ship",
    resolveTarget: () => "Tasks.md",
  };

  for (const content of [
    "# Notes\n- [[Tasks#^ship]]",
    ["## Pomodoros", "- [x] Done (09:00-09:25)", "  - [[Tasks#^ship]]"].join("\n"),
    ["## Pomodoros", "- [ ] Current ()", "  - [[Tasks#^other]]"].join("\n"),
  ]) {
    const plan = helpers.planAllOpenPomodoroLinkCleanup(content, base);
    assert.equal(plan.removedCount, 0);
    assert.equal(plan.hasChanges, false);
    assert.deepEqual(plan.edits, []);
    assert.equal(plan.content, content);
  }
});

test("work summary normalization trims, collapses whitespace, preserves Markdown, and flags Dataview fields", () => {
  assert.equal(helpers.normalizeWorkSummary("  Added   guarded\ncleanup\tcoverage  "), "Added guarded cleanup coverage");
  assert.equal(helpers.normalizeWorkSummary(" \n\t "), "");
  assert.equal(
    helpers.normalizeWorkSummary("Kept [[Project|project]], `code`, and **bold**"),
    "Kept [[Project|project]], `code`, and **bold**",
  );
  assert.equal(
    helpers.formatWorkLogEntry("  Kept [[Project|project]], `code`, and **bold**  ", WORK_LOG_DATE),
    "*2026-08-15* — Kept [[Project|project]], `code`, and **bold**",
  );
  assert.equal(helpers.formatWorkLogEntry(" \n\t ", WORK_LOG_DATE), "");
  assert.equal(helpers.workSummaryContainsDataviewInlineField("progress:: shipped"), true);
  assert.deepEqual(helpers.workSummaryPromptState("  ", { date: WORK_LOG_DATE }), {
    summary: "",
    date: WORK_LOG_DATE,
    formattedEntry: "",
    isBlank: true,
    hasDataviewWarning: false,
    primaryButtonText: "Set Open",
  });
  assert.deepEqual(helpers.workSummaryPromptState("progress:: shipped", { date: WORK_LOG_DATE }), {
    summary: "progress:: shipped",
    date: WORK_LOG_DATE,
    formattedEntry: "*2026-08-15* — progress:: shipped",
    isBlank: false,
    hasDataviewWarning: true,
    primaryButtonText: "Set Open & log",
  });
});

test("work log date helpers use local calendar components", () => {
  class LocalLateNightDate extends Date {
    getFullYear() {
      return 2026;
    }

    getMonth() {
      return 7;
    }

    getDate() {
      return 15;
    }

    toISOString() {
      return "2026-08-16T03:30:00.000Z";
    }
  }

  const localParts = helpers.localTodayParts(new LocalLateNightDate());
  assert.deepEqual(localParts, WORK_LOG_DATE);
  assert.equal(helpers.formatWorkLogEntry("Added guarded cleanup", localParts), "*2026-08-15* — Added guarded cleanup");
});

test("planWorkLogInsertion creates the canonical marker as the final direct-child subtree", () => {
  const content = [
    "- [ ] #task Ship it ^ship",
    "  - Keep this child",
    "- [ ] #task Sibling",
  ].join("\n");
  const plan = helpers.planWorkLogInsertion(content, 0, "Added guarded cleanup", {
    date: WORK_LOG_DATE,
  });

  assert.equal(plan.workLogEntryAdded, true);
  assert.deepEqual(plan.workLogDate, WORK_LOG_DATE);
  assert.equal(plan.workLogFormattedEntry, "*2026-08-15* — Added guarded cleanup");
  assert.equal(
    plan.content,
    [
      "- [ ] #task Ship it ^ship",
      "  - Keep this child",
      "  - 🛠️ **WORK LOG**",
      "    - *2026-08-15* — Added guarded cleanup",
      "- [ ] #task Sibling",
    ].join("\n"),
  );
});

test("planWorkLogInsertion prepends newest-first entries into existing marker spellings", () => {
  const canonical = [
    "- [ ] #task Ship it ^ship",
    "  * 🛠️ **WORK LOG**",
    "    * Yesterday's work",
  ].join("\n");
  assert.equal(
    helpers.planWorkLogInsertion(canonical, 0, "Today", { date: WORK_LOG_DATE }).content,
    [
      "- [ ] #task Ship it ^ship",
      "  * 🛠️ **WORK LOG**",
      "    * *2026-08-15* — Today",
      "    * Yesterday's work",
    ].join("\n"),
  );

  const legacy = [
    "- [ ] #task Ship it ^ship",
    "  + **Work log:**",
  ].join("\n");
  assert.equal(
    helpers.planWorkLogInsertion(legacy, 0, "Legacy marker", { date: WORK_LOG_DATE }).content,
    [
      "- [ ] #task Ship it ^ship",
      "  + **Work log:**",
      "    + *2026-08-15* — Legacy marker",
    ].join("\n"),
  );

  const emojiLess = [
    "- [ ] #task Ship it ^ship",
    "  - **WORK LOG**",
  ].join("\n");
  assert.ok(helpers.findWorkLogMarker(emojiLess.split("\n"), 0));
});

test("planWorkLogInsertion ignores nested child-task markers and preserves CRLF", () => {
  const nested = [
    "- [ ] #task Parent ^parent",
    "  - [ ] #task Child ^child",
    "    - **WORK LOG**",
    "      - Child work",
  ].join("\n");
  assert.equal(
    helpers.planWorkLogInsertion(nested, 0, "Parent work", { date: WORK_LOG_DATE }).content,
    [
      "- [ ] #task Parent ^parent",
      "  - [ ] #task Child ^child",
      "    - **WORK LOG**",
      "      - Child work",
      "  - 🛠️ **WORK LOG**",
      "    - *2026-08-15* — Parent work",
    ].join("\n"),
  );

  const crlf = ["- [ ] #task Ship ^ship", "  - 🛠️ **WORK LOG**", "    - Old"].join("\r\n");
  const plan = helpers.planWorkLogInsertion(crlf, 0, "New", { date: WORK_LOG_DATE });
  assert.doesNotMatch(plan.content, /(^|[^\r])\n/);
  assert.match(plan.content, /\*2026-08-15\* — New\r\n    - Old/);
});

test("planWorkLogInsertion treats blank summaries as no-op structural edits", () => {
  const content = ["- [ ] #task Ship it ^ship", "  - 🛠️ **WORK LOG**"].join("\n");
  const plan = helpers.planWorkLogInsertion(content, 0, " \n\t ");

  assert.equal(plan.workLogEntryAdded, false);
  assert.equal(plan.workLogDate, null);
  assert.equal(plan.workLogFormattedEntry, "");
  assert.equal(plan.hasChanges, false);
  assert.deepEqual(plan.edits, []);
  assert.equal(plan.content, content);
});

test("planTargetTaskOpenUpdate changes only an original Next checkbox to Open", () => {
  const content = [
    "- [*] #task Ship it [scheduled:: 2026-08-20] [priority:: high] ^ship",
    "  - 🗓️ **SCHEDULE LOG**",
    "  \t- _2026-08-10 → 2026-08-15_ — already logged",
    "",
  ].join("\r\n");
  const plan = helpers.planTargetTaskOpenUpdate(content, 0);
  const result = applyPlannedEdits(content, plan.edits);

  assert.equal(plan.oldStatus, "*");
  assert.equal(plan.newStatus, " ");
  assert.equal(plan.statusChanged, true);
  assert.equal(plan.removedFutureSchedule, false);
  assert.equal(plan.logEntryAdded, false);
  assert.equal(plan.workLogEntryAdded, false);
  assert.equal(plan.blockIdAppended, false);
  assert.equal(plan.edits.length, 1);
  assert.equal(result, content.replace("- [*]", "- [ ]"));
  assert.equal(plan.content, result);
  assert.doesNotMatch(result, /(^|[^\r])\n/);
  assert.equal(helpers.planTargetTaskOpenUpdate("- [ ] #task Ship it ^ship", 0), null);
});

test("planTargetTaskOpenUpdate can pause only an In Progress task and append one Work Log entry", () => {
  const content = ["- [/] #task Ship it ^ship", "  - Keep detail"].join("\n");
  const plan = helpers.planTargetTaskOpenUpdate(content, 0, {
    expectedStatus: "/",
    workSummary: "  Added\ncoverage  ",
    workLogDate: WORK_LOG_DATE,
  });

  assert.equal(plan.oldStatus, "/");
  assert.equal(plan.newStatus, " ");
  assert.equal(plan.workLogEntryAdded, true);
  assert.equal(
    plan.content,
    [
      "- [ ] #task Ship it ^ship",
      "  - Keep detail",
      "  - 🛠️ **WORK LOG**",
      "    - *2026-08-15* — Added coverage",
    ].join("\n"),
  );
  assert.equal(
    helpers.planTargetTaskOpenUpdate("- [*] #task Ship it", 0, { expectedStatus: "/" }),
    null,
  );
});

test("Ctrl+Shift+Enter is registered as the link-task-to-pomodoro command", () => {
  const plugin = new Plugin();
  const commands = [];
  plugin.addCommand = (command) => commands.push(command);
  plugin.registerEditorExtension = () => {};
  plugin.register = () => {};

  plugin.onload();

  assert.ok(commands.find((entry) => entry.id === "rename-selected-block-id"));

  const command = commands.find((entry) => entry.id === "link-task-to-pomodoro");
  assert.ok(command);
  assert.equal(command.name, "Toggle task Pomodoro link");
  assert.deepEqual(command.hotkeys, [{ modifiers: ["Ctrl", "Shift"], key: "Enter" }]);
  assert.equal(typeof command.editorCallback, "function");

  let calledWith = null;
  plugin.openPomodoroTaskLink = (editor, view) => {
    calledWith = [editor, view];
  };
  const fakeEditor = {};
  const fakeView = {};
  command.editorCallback(fakeEditor, fakeView);
  assert.deepEqual(calledWith, [fakeEditor, fakeView]);
});

test("resolvePomodoroLinkTaskFromEditor requires a single cursor", () => {
  const plugin = new Plugin();
  const editor = createEditor("- [ ] #task Ship it");
  assert.deepEqual(plugin.resolvePomodoroLinkTaskFromEditor(editor), {
    error: "No active Markdown task selected",
  });

  editor.setCursor({ line: 0, ch: 5 });
  editor.listSelections = () => [
    { head: { line: 0, ch: 5 } },
    { head: { line: 0, ch: 6 } },
  ];
  assert.deepEqual(plugin.resolvePomodoroLinkTaskFromEditor(editor), {
    error: "No active Markdown task selected",
  });
});

test("resolvePomodoroLinkTaskFromEditor rejects a cursor inside a fenced code block", () => {
  const plugin = new Plugin();
  const editor = createEditor(["```", "- [ ] #task Fake", "```"].join("\n"));
  editor.setCursor({ line: 1, ch: 2 });
  assert.deepEqual(plugin.resolvePomodoroLinkTaskFromEditor(editor), {
    error: "Cannot link a task inside a code block",
  });
});

test("resolvePomodoroLinkTaskFromEditor rejects a non-task line and a closed task", () => {
  const plugin = new Plugin();
  const paragraph = createEditor("Just a paragraph.");
  paragraph.setCursor({ line: 0, ch: 0 });
  assert.deepEqual(plugin.resolvePomodoroLinkTaskFromEditor(paragraph), {
    error: "No open task under cursor",
  });

  const closed = createEditor("- [x] #task Already done");
  closed.setCursor({ line: 0, ch: 0 });
  assert.deepEqual(plugin.resolvePomodoroLinkTaskFromEditor(closed), {
    error: "No open task under cursor",
  });
});

test("resolvePomodoroLinkTaskFromEditor accepts a #hide project task directly under the cursor", () => {
  const plugin = new Plugin();
  const editor = createEditor("- [ ] #task #hide Secret errand");
  editor.setCursor({ line: 0, ch: 0 });
  const result = plugin.resolvePomodoroLinkTaskFromEditor(editor);
  assert.ok(result.task);
  assert.equal(result.task.displayText, "Secret errand");
});

test("resolvePomodoroLinkTaskFromEditor rejects a block ID duplicated elsewhere in the same note", () => {
  const plugin = new Plugin();
  const editor = createEditor(
    ["- [ ] #task Ship it ^dup", "- [ ] #task Also uses it ^dup"].join("\n"),
  );
  editor.setCursor({ line: 0, ch: 0 });
  assert.deepEqual(plugin.resolvePomodoroLinkTaskFromEditor(editor), {
    error: "Block ID 'dup' is duplicated in this note",
  });
});

test("In Progress Ctrl+Shift+Enter opens the work-summary prompt without early daily-note I/O", async () => {
  resetNotices();
  const editor = createEditor("- [/] #task Ship it ^ship");
  editor.setCursor({ line: 0, ch: 4 });
  const file = createTFile("Tasks.md");
  const view = createMarkdownView(file);
  const plugin = new Plugin();
  let openedSource = null;
  let dailyResolved = false;
  plugin.app = {
    workspace: {
      getActiveViewOfType: () => view,
      getActiveFile: () => file,
    },
  };
  plugin.openWorkSummaryPrompt = (source) => {
    openedSource = source;
  };
  plugin.resolveTodayDailyFile = () => {
    dailyResolved = true;
    return null;
  };

  await plugin.openPomodoroTaskLink(editor, view);

  assert.ok(openedSource);
  assert.equal(openedSource.task.status, "/");
  assert.equal(openedSource.task.existingId, "ship");
  assert.equal(dailyResolved, false);
  assert.equal(editor.getValue(), "- [/] #task Ship it ^ship");
  assert.equal(noticeMessages.length, 0);
});

test("existing-ID Pomodoro link runtime: cross-note guarded write, canonical link, forced Next, and success notice", async () => {
  resetNotices();
  const editor = createEditor("- [?] #task Ship it [scheduled:: 2026-08-20] ^ship");
  const source = sourceForPomodoroLink(editor, "Tasks.md", 0);
  const dailyContent = ["## Pomodoros", "- [ ] Current (10:00-10:25)"].join("\n");
  const plugin = new Plugin();
  plugin.now = () => localDate(2026, 8, 15);
  plugin.resolveTodayDailyFile = () => ({ path: "Daily.md" });
  plugin.resolveTaskFile = (path) => (path === "Tasks.md" ? { path: "Tasks.md" } : null);
  let written = null;
  plugin.app = {
    vault: {
      read: async (file) => (file.path === "Daily.md" ? dailyContent : null),
      modify: async (file, content) => {
        written = { path: file.path, content };
      },
    },
    metadataCache: {
      fileToLinktext: (file) => file.path.replace(/\.md$/, ""),
    },
  };
  plugin.resolveReferenceDestination = () => null;
  plugin.suppressEditorScans = () => {};

  const result = await plugin.completePomodoroTaskLink(source, "ship");

  assert.equal(result, true);
  assert.equal(editor.getValue(), "- [*] #task Ship it ^ship");
  assert.ok(written);
  assert.equal(written.path, "Daily.md");
  assert.equal(
    written.content,
    ["## Pomodoros", "- [ ] Current (10:00-10:25)", "  - [[Tasks#^ship]]"].join("\n"),
  );
  assert.equal(lastNotice(), "Linked task to Pomodoro · removed future schedule · set Next");
});

test("new-ID Pomodoro link runtime: cross-note guarded write, appended ID stays final, forced Next for a Ready task", async () => {
  resetNotices();
  const editor = createEditor("- [ ] #task Ship it [priority:: high]");
  const source = sourceForPomodoroLink(editor, "Tasks.md", 0);
  const dailyContent = ["## Pomodoros", "- [ ] Later ()"].join("\n");
  const plugin = new Plugin();
  plugin.now = () => localDate(2026, 8, 15);
  plugin.resolveTodayDailyFile = () => ({ path: "Daily.md" });
  plugin.resolveTaskFile = (path) => (path === "Tasks.md" ? { path: "Tasks.md" } : null);
  let written = null;
  plugin.app = {
    vault: {
      read: async (file) => (file.path === "Daily.md" ? dailyContent : null),
      modify: async (file, content) => {
        written = { path: file.path, content };
      },
    },
    metadataCache: {
      fileToLinktext: (file) => file.path.replace(/\.md$/, ""),
    },
  };
  plugin.resolveReferenceDestination = () => null;
  plugin.suppressEditorScans = () => {};

  const result = await plugin.submitPomodoroTaskLinkBlockId(source, "ship");

  assert.equal(result, true);
  assert.equal(editor.getValue(), "- [*] #task Ship it [priority:: high] ^ship");
  assert.ok(written);
  assert.equal(
    written.content,
    ["## Pomodoros", "- [ ] Later ()", "  - [[Tasks#^ship]]"].join("\n"),
  );
  assert.equal(lastNotice(), "Added block ID and linked task to Pomodoro · set Next");
});

test("submitPomodoroTaskLinkBlockId rejects a newly duplicated ID discovered at submit time", async () => {
  resetNotices();
  const editor = createEditor(["- [ ] #task Ship it", "- [ ] #task Other ^dup"].join("\n"));
  const source = sourceForPomodoroLink(editor, "Tasks.md", 0);

  const plugin = new Plugin();
  const result = await plugin.submitPomodoroTaskLinkBlockId(source, "dup");

  assert.equal(result, false);
  assert.equal(lastNotice(), "Block ID 'dup' already exists in Tasks.md");
});

test("submitPomodoroTaskLinkBlockId aborts when the task text changed while the modal was open", async () => {
  resetNotices();
  const editor = createEditor("- [ ] #task Ship it");
  const source = sourceForPomodoroLink(editor, "Tasks.md", 0);
  editor.replaceRange(
    "- [ ] #task Ship it NOW",
    { line: 0, ch: 0 },
    { line: 0, ch: editor.getLine(0).length },
  );

  const plugin = new Plugin();
  const result = await plugin.submitPomodoroTaskLinkBlockId(source, "ship");

  assert.equal(result, false);
  assert.equal(lastNotice(), "Task link blocked: selected task changed in Tasks.md");
});

test("same-note Pomodoro link runtime: task and ledger edits merge into one transaction", async () => {
  resetNotices();
  const editor = createEditor(
    [
      "- [?] #task Ship it [scheduled:: 2026-08-20] ^ship",
      "  - 🗓️ **SCHEDULE LOG**",
      "## Pomodoros",
      "- [ ] Current (10:00-10:25)",
    ].join("\n"),
  );
  const source = sourceForPomodoroLink(editor, "Daily.md", 0);
  const plugin = new Plugin();
  plugin.now = () => localDate(2026, 8, 15);
  plugin.resolveTodayDailyFile = () => ({ path: "Daily.md" });
  plugin.resolveTaskFile = (path) => (path === "Daily.md" ? { path: "Daily.md" } : null);
  plugin.resolveReferenceDestination = (reference) =>
    reference.targetText === "" ? { path: "Daily.md" } : null;
  plugin.suppressEditorScans = () => {};

  const result = await plugin.completePomodoroTaskLink(source, "ship");

  assert.equal(result, true);
  assert.equal(
    editor.getValue(),
    [
      "- [*] #task Ship it ^ship",
      "  - 🗓️ **SCHEDULE LOG**",
      "  \t- _2026-08-20 → 2026-08-15_ — 🍅 pulled into today's Pomodoro",
      "## Pomodoros",
      "- [ ] Current (10:00-10:25)",
      "  - [[#^ship]]",
    ].join("\n"),
  );
  assert.equal(
    lastNotice(),
    "Linked task to Pomodoro · removed future schedule · set Next · logged schedule change",
  );
});

test("non-Next Pomodoro link command does not duplicate an existing current link", async () => {
  resetNotices();
  const editor = createEditor("- [ ] #task Ship it ^ship");
  const source = sourceForPomodoroLink(editor, "Tasks.md", 0);
  const dailyContent = ["## Pomodoros", "- [ ] Current (10:00-10:25)", "  - [[Tasks#^ship]]"].join(
    "\n",
  );
  const plugin = new Plugin();
  plugin.now = () => localDate(2026, 8, 15);
  plugin.resolveTodayDailyFile = () => ({ path: "Daily.md" });
  plugin.resolveTaskFile = (path) => (path === "Tasks.md" ? { path: "Tasks.md" } : null);
  let modifyCalled = false;
  plugin.app = {
    vault: {
      read: async (file) => (file.path === "Daily.md" ? dailyContent : null),
      modify: async () => {
        modifyCalled = true;
      },
    },
    metadataCache: {
      fileToLinktext: (file) => file.path.replace(/\.md$/, ""),
    },
  };
  plugin.resolveReferenceDestination = (reference) =>
    reference.targetText === "Tasks" ? { path: "Tasks.md" } : null;
  plugin.suppressEditorScans = () => {};

  const result = await plugin.completePomodoroTaskLink(source, "ship");

  assert.equal(result, true);
  assert.equal(modifyCalled, false);
  assert.equal(editor.getValue(), "- [*] #task Ship it ^ship");
  assert.equal(lastNotice(), "Task already linked to Pomodoro · set Next");
});

test("Next task without a block ID toggles Open without prompting or resolving today's note", async () => {
  resetNotices();
  const editor = createEditor("- [*] #task Ship it [scheduled:: 2026-08-20]");
  editor.setCursor({ line: 0, ch: 4 });
  const file = createTFile("Tasks.md");
  const view = createMarkdownView(file);
  const plugin = new Plugin();
  let prompted = false;
  let dailyResolved = false;
  plugin.app = {
    workspace: {
      getActiveViewOfType: () => view,
      getActiveFile: () => file,
    },
  };
  plugin.openBlockIdPrompt = () => {
    prompted = true;
  };
  plugin.resolveTodayDailyFile = () => {
    dailyResolved = true;
    return null;
  };
  plugin.suppressEditorScans = () => {};

  await plugin.openPomodoroTaskLink(editor, view);

  assert.equal(prompted, false);
  assert.equal(dailyResolved, false);
  assert.equal(plugin.promptOpen, false);
  assert.equal(editor.getValue(), "- [ ] #task Ship it [scheduled:: 2026-08-20]");
  assert.deepEqual(editor.cursor, { line: 0, ch: 4 });
  assert.equal(lastNotice(), "Task set Open · no current/future Pomodoro links removed");
});

test("Next task with a block ID still becomes Open when today's daily note is missing", async () => {
  resetNotices();
  const editor = createEditor("- [*] #task Ship it ^ship");
  const source = sourceForPomodoroLink(editor, "Tasks.md", 0);
  const plugin = new Plugin();
  plugin.resolveTaskFile = (path) => (path === "Tasks.md" ? { path: "Tasks.md" } : null);
  plugin.resolveTodayDailyFile = () => null;
  plugin.suppressEditorScans = () => {};

  const result = await plugin.applyPomodoroTaskUnlink(source);

  assert.equal(result, true);
  assert.equal(editor.getValue(), "- [ ] #task Ship it ^ship");
  assert.equal(lastNotice(), "Task set Open · no current/future Pomodoro links removed");
});

test("In Progress pause with blank summary sets Open without a Work Log or daily-note lookup when no block ID exists", async () => {
  resetNotices();
  const editor = createEditor("- [/] #task Ship it");
  const source = sourceForPomodoroLink(editor, "Tasks.md", 0);
  const plugin = new Plugin();
  let dailyResolved = false;
  plugin.resolveTaskFile = (path) => (path === "Tasks.md" ? { path: "Tasks.md" } : null);
  plugin.resolveTodayDailyFile = () => {
    dailyResolved = true;
    return null;
  };
  plugin.suppressEditorScans = () => {};

  const result = await plugin.submitPomodoroWorkSummary(source, " \n\t ");

  assert.equal(result, true);
  assert.equal(dailyResolved, false);
  assert.equal(editor.getValue(), "- [ ] #task Ship it");
  assert.equal(lastNotice(), "Task set Open · no current/future Pomodoro links removed");
});

test("In Progress pause with a summary sets Open and creates a Work Log", async () => {
  resetNotices();
  const editor = createEditor(["- [/] #task Ship it", "  - Keep detail"].join("\n"));
  const source = sourceForPomodoroLink(editor, "Tasks.md", 0);
  const plugin = new Plugin();
  plugin.resolveTaskFile = (path) => (path === "Tasks.md" ? { path: "Tasks.md" } : null);
  plugin.suppressEditorScans = () => {};
  plugin.now = () => localDate(2026, 8, 15);

  const result = await plugin.submitPomodoroWorkSummary(source, " Added\ncoverage ");

  assert.equal(result, true);
  assert.equal(
    editor.getValue(),
    [
      "- [ ] #task Ship it",
      "  - Keep detail",
      "  - 🛠️ **WORK LOG**",
      "    - *2026-08-15* — Added coverage",
    ].join("\n"),
  );
  assert.equal(lastNotice(), "Task set Open · logged work · no current/future Pomodoro links removed");
});

test("In Progress pause revalidates task text and block-ID uniqueness at confirmation", async () => {
  resetNotices();
  const changedEditor = createEditor("- [/] #task Ship it ^ship");
  const changedSource = sourceForPomodoroLink(changedEditor, "Tasks.md", 0);
  changedEditor.replaceRange(
    "- [/] #task Ship it NOW ^ship",
    { line: 0, ch: 0 },
    { line: 0, ch: changedEditor.getLine(0).length },
  );
  const changedPlugin = new Plugin();
  let dailyResolved = false;
  changedPlugin.resolveTodayDailyFile = () => {
    dailyResolved = true;
    return null;
  };

  assert.equal(await changedPlugin.submitPomodoroWorkSummary(changedSource, "Worked"), false);
  assert.equal(dailyResolved, false);
  assert.equal(lastNotice(), "Task pause blocked: selected task changed in Tasks.md");

  resetNotices();
  const duplicateEditor = createEditor("- [/] #task Ship it ^ship");
  const duplicateSource = sourceForPomodoroLink(duplicateEditor, "Tasks.md", 0);
  duplicateEditor.replaceRange(
    "\n- [ ] #task Other ^ship",
    { line: 0, ch: duplicateEditor.getLine(0).length },
  );
  const duplicatePlugin = new Plugin();

  assert.equal(await duplicatePlugin.submitPomodoroWorkSummary(duplicateSource, "Worked"), false);
  assert.equal(lastNotice(), "Block ID 'ship' is duplicated in this note");
});

test("Next task unlink removes current and future links before changing cross-note task status", async () => {
  resetNotices();
  const editor = createEditor("- [*] #task Ship it ^ship");
  const source = sourceForPomodoroLink(editor, "Tasks.md", 0);
  const dailyContent = [
    "## Pomodoros",
    "- [ ] Current (10:00-10:25)",
    "  - [[Tasks#^ship]]",
    "    - nested note",
    "- [ ] Later ()",
    "  - Work [[Tasks#^ship|Ship]] and [[Other#^ship]]",
    "- [x] Done (09:00-09:25)",
    "  - [[Tasks#^ship]]",
  ].join("\n");
  const plugin = new Plugin();
  plugin.resolveTodayDailyFile = () => ({ path: "Daily.md" });
  plugin.resolveTaskFile = (path) => (path === "Tasks.md" ? { path: "Tasks.md" } : null);
  let written = null;
  plugin.app = {
    vault: {
      read: async (file) => (file.path === "Daily.md" ? dailyContent : null),
      modify: async (file, content) => {
        assert.equal(editor.getValue(), "- [*] #task Ship it ^ship");
        written = { path: file.path, content };
      },
    },
  };
  plugin.resolveReferenceDestination = (reference) =>
    reference.targetText === "Tasks" ? { path: "Tasks.md" } : { path: "Other.md" };
  plugin.suppressEditorScans = () => {};

  const result = await plugin.applyPomodoroTaskUnlink(source);

  assert.equal(result, true);
  assert.equal(editor.getValue(), "- [ ] #task Ship it ^ship");
  assert.deepEqual(written, {
    path: "Daily.md",
    content: [
      "## Pomodoros",
      "- [ ] Current (10:00-10:25)",
      "- [ ] Later ()",
      "  - Work  and [[Other#^ship]]",
      "- [x] Done (09:00-09:25)",
      "  - [[Tasks#^ship]]",
    ].join("\n"),
  });
  assert.equal(lastNotice(), "Task set Open · removed 2 current/future Pomodoro links");
});

test("In Progress pause removes cross-note Pomodoro links before setting Open and logging work", async () => {
  resetNotices();
  const editor = createEditor("- [/] #task Ship it ^ship");
  const source = sourceForPomodoroLink(editor, "Tasks.md", 0);
  const dailyContent = [
    "## Pomodoros",
    "- [ ] Current (10:00-10:25)",
    "  - [[Tasks#^ship]]",
    "- [x] Done (09:00-09:25)",
    "  - [[Tasks#^ship]]",
  ].join("\n");
  const plugin = new Plugin();
  plugin.resolveTodayDailyFile = () => ({ path: "Daily.md" });
  plugin.resolveTaskFile = (path) => (path === "Tasks.md" ? { path: "Tasks.md" } : null);
  let written = null;
  plugin.app = {
    vault: {
      read: async (file) => (file.path === "Daily.md" ? dailyContent : null),
      modify: async (file, content) => {
        assert.equal(editor.getValue(), "- [/] #task Ship it ^ship");
        written = { path: file.path, content };
      },
    },
  };
  plugin.resolveReferenceDestination = (reference) =>
    reference.targetText === "Tasks" ? { path: "Tasks.md" } : null;
  plugin.suppressEditorScans = () => {};
  plugin.now = () => localDate(2026, 8, 15);

  const result = await plugin.submitPomodoroWorkSummary(source, "Finished cleanup");

  assert.equal(result, true);
  assert.deepEqual(written, {
    path: "Daily.md",
    content: [
      "## Pomodoros",
      "- [ ] Current (10:00-10:25)",
      "- [x] Done (09:00-09:25)",
      "  - [[Tasks#^ship]]",
    ].join("\n"),
  });
  assert.equal(
    editor.getValue(),
    [
      "- [ ] #task Ship it ^ship",
      "  - 🛠️ **WORK LOG**",
      "    - *2026-08-15* — Finished cleanup",
    ].join("\n"),
  );
  assert.equal(lastNotice(), "Task set Open · logged work · removed 1 current/future Pomodoro link");
});

test("same-note Next unlink merges status and all-open cleanup in the active editor", async () => {
  resetNotices();
  const editor = createEditor(
    [
      "- [*] #task Ship it ^ship",
      "## Pomodoros",
      "- [ ] Current (10:00-10:25)",
      "  - [[#^ship]]",
      "- [ ] Later ()",
      "  - Keep [[#^ship]] and notes",
      "- [x] Done (09:00-09:25)",
      "  - [[#^ship]]",
    ].join("\n"),
  );
  editor.setCursor({ line: 0, ch: 9 });
  const source = {
    ...sourceForPomodoroLink(editor, "Daily.md", 0),
    file: { path: "Daily.md" },
  };
  const plugin = new Plugin();
  plugin.resolveTodayDailyFile = () => ({ path: "Daily.md" });
  plugin.resolveReferenceDestination = (reference) =>
    reference.targetText === "" ? { path: "Daily.md" } : null;
  plugin.suppressEditorScans = () => {};

  const result = await plugin.applyPomodoroTaskUnlink(source);

  assert.equal(result, true);
  assert.equal(
    editor.getValue(),
    [
      "- [ ] #task Ship it ^ship",
      "## Pomodoros",
      "- [ ] Current (10:00-10:25)",
      "- [ ] Later ()",
      "  - Keep  and notes",
      "- [x] Done (09:00-09:25)",
      "  - [[#^ship]]",
    ].join("\n"),
  );
  assert.deepEqual(editor.cursor, { line: 0, ch: 9 });
  assert.equal(lastNotice(), "Task set Open · removed 2 current/future Pomodoro links");
});

test("same-note In Progress pause merges cleanup, status, and Work Log in the active editor", async () => {
  resetNotices();
  const editor = createEditor(
    [
      "- [/] #task Ship it ^ship",
      "## Pomodoros",
      "- [ ] Current (10:00-10:25)",
      "  - [[#^ship]]",
      "- [x] Done (09:00-09:25)",
      "  - [[#^ship]]",
    ].join("\n"),
  );
  editor.setCursor({ line: 0, ch: 9 });
  const source = {
    ...sourceForPomodoroLink(editor, "Daily.md", 0),
    file: { path: "Daily.md" },
  };
  const plugin = new Plugin();
  plugin.resolveTodayDailyFile = () => ({ path: "Daily.md" });
  plugin.resolveReferenceDestination = (reference) =>
    reference.targetText === "" ? { path: "Daily.md" } : null;
  plugin.suppressEditorScans = () => {};
  plugin.now = () => localDate(2026, 8, 15);

  const result = await plugin.submitPomodoroWorkSummary(source, "Paused after tests");

  assert.equal(result, true);
  assert.equal(
    editor.getValue(),
    [
      "- [ ] #task Ship it ^ship",
      "  - 🛠️ **WORK LOG**",
      "    - *2026-08-15* — Paused after tests",
      "## Pomodoros",
      "- [ ] Current (10:00-10:25)",
      "- [x] Done (09:00-09:25)",
      "  - [[#^ship]]",
    ].join("\n"),
  );
  assert.deepEqual(editor.cursor, { line: 0, ch: 9 });
  assert.equal(lastNotice(), "Task set Open · logged work · removed 1 current/future Pomodoro link");
});

test("Next unlink stops before status when daily cleanup write is stale", async () => {
  resetNotices();
  const editor = createEditor("- [*] #task Ship it ^ship");
  const source = sourceForPomodoroLink(editor, "Tasks.md", 0);
  const plannedDaily = ["## Pomodoros", "- [ ] Current ()", "  - [[Tasks#^ship]]"].join("\n");
  const staleDaily = plannedDaily.replace("Current", "Current NOW");
  const plugin = new Plugin();
  plugin.resolveTodayDailyFile = () => ({ path: "Daily.md" });
  plugin.resolveTaskFile = (path) => (path === "Tasks.md" ? { path: "Tasks.md" } : null);
  let readCount = 0;
  let modifyCalled = false;
  plugin.app = {
    vault: {
      read: async () => {
        readCount += 1;
        return readCount === 1 ? plannedDaily : staleDaily;
      },
      modify: async () => {
        modifyCalled = true;
      },
    },
  };
  plugin.resolveReferenceDestination = () => ({ path: "Tasks.md" });
  plugin.suppressEditorScans = () => {};

  const result = await plugin.applyPomodoroTaskUnlink(source);

  assert.equal(result, false);
  assert.equal(modifyCalled, false);
  assert.equal(editor.getValue(), "- [*] #task Ship it ^ship");
  assert.equal(lastNotice(), "Task toggle stopped: Daily.md changed before update");
});

test("Next unlink reports retryable partial failure when cleanup succeeds but task status is stale", async () => {
  resetNotices();
  const editor = createEditor("- [*] #task Ship it ^ship");
  const source = sourceForPomodoroLink(editor, "Tasks.md", 0);
  const dailyContent = ["## Pomodoros", "- [ ] Current ()", "  - [[Tasks#^ship]]"].join("\n");
  const plugin = new Plugin();
  plugin.resolveTodayDailyFile = () => ({ path: "Daily.md" });
  plugin.resolveTaskFile = (path) => (path === "Tasks.md" ? { path: "Tasks.md" } : null);
  let written = null;
  plugin.app = {
    vault: {
      read: async () => dailyContent,
      modify: async (file, content) => {
        written = { path: file.path, content };
        editor.replaceRange(
          "- [*] #task Ship it NOW ^ship",
          { line: 0, ch: 0 },
          { line: 0, ch: editor.getLine(0).length },
        );
      },
    },
  };
  plugin.resolveReferenceDestination = () => ({ path: "Tasks.md" });
  plugin.suppressEditorScans = () => {};

  const result = await plugin.applyPomodoroTaskUnlink(source);

  assert.equal(result, false);
  assert.deepEqual(written, {
    path: "Daily.md",
    content: ["## Pomodoros", "- [ ] Current ()", ""].join("\n"),
  });
  assert.equal(editor.getValue(), "- [*] #task Ship it NOW ^ship");
  assert.equal(lastNotice(), "Removed 1 current/future Pomodoro link, but task remains Next");
});

test("In Progress pause reports retryable partial failure when cleanup succeeds but status/logging is stale", async () => {
  resetNotices();
  const editor = createEditor("- [/] #task Ship it ^ship");
  const source = sourceForPomodoroLink(editor, "Tasks.md", 0);
  const dailyContent = ["## Pomodoros", "- [ ] Current ()", "  - [[Tasks#^ship]]"].join("\n");
  const plugin = new Plugin();
  plugin.resolveTodayDailyFile = () => ({ path: "Daily.md" });
  plugin.resolveTaskFile = (path) => (path === "Tasks.md" ? { path: "Tasks.md" } : null);
  let written = null;
  plugin.app = {
    vault: {
      read: async () => dailyContent,
      modify: async (file, content) => {
        written = { path: file.path, content };
        editor.replaceRange(
          "- [/] #task Ship it NOW ^ship",
          { line: 0, ch: 0 },
          { line: 0, ch: editor.getLine(0).length },
        );
      },
    },
  };
  plugin.resolveReferenceDestination = () => ({ path: "Tasks.md" });
  plugin.suppressEditorScans = () => {};

  const result = await plugin.submitPomodoroWorkSummary(source, "Logged locally");

  assert.equal(result, false);
  assert.deepEqual(written, {
    path: "Daily.md",
    content: ["## Pomodoros", "- [ ] Current ()", ""].join("\n"),
  });
  assert.equal(editor.getValue(), "- [/] #task Ship it NOW ^ship");
  assert.equal(
    lastNotice(),
    "Removed 1 current/future Pomodoro link, but task remains In Progress and work summary was not logged",
  );
});

test("Pomodoro link stops before any mutation when today's daily note is missing", async () => {
  resetNotices();
  const editor = createEditor("- [ ] #task Ship it ^ship");
  const before = editor.getValue();
  const source = sourceForPomodoroLink(editor, "Tasks.md", 0);
  const plugin = new Plugin();
  plugin.resolveTodayDailyFile = () => null;

  const result = await plugin.completePomodoroTaskLink(source, "ship");

  assert.equal(result, false);
  assert.equal(editor.getValue(), before);
  assert.equal(lastNotice(), "Task link blocked: today's daily note could not be found");
});

test("Pomodoro link stops before any task mutation when the daily note has no Pomodoros section", async () => {
  resetNotices();
  const editor = createEditor("- [ ] #task Ship it ^ship");
  const before = editor.getValue();
  const source = sourceForPomodoroLink(editor, "Tasks.md", 0);
  const plugin = new Plugin();
  plugin.resolveTodayDailyFile = () => ({ path: "Daily.md" });
  plugin.resolveTaskFile = (path) => (path === "Tasks.md" ? { path: "Tasks.md" } : null);
  let modifyCalled = false;
  plugin.app = {
    vault: {
      read: async () => "# Notes\nNothing here",
      modify: async () => {
        modifyCalled = true;
      },
    },
  };

  const result = await plugin.completePomodoroTaskLink(source, "ship");

  assert.equal(result, false);
  assert.equal(modifyCalled, false);
  assert.equal(editor.getValue(), before);
  assert.equal(lastNotice(), "Task link blocked: Daily.md has no Pomodoros section");
});

test("Pomodoro link stops before any task mutation when the daily note has multiple open timed Pomodoros", async () => {
  resetNotices();
  const editor = createEditor("- [ ] #task Ship it ^ship");
  const before = editor.getValue();
  const source = sourceForPomodoroLink(editor, "Tasks.md", 0);
  const plugin = new Plugin();
  plugin.resolveTodayDailyFile = () => ({ path: "Daily.md" });
  plugin.resolveTaskFile = (path) => (path === "Tasks.md" ? { path: "Tasks.md" } : null);
  let modifyCalled = false;
  plugin.app = {
    vault: {
      read: async () =>
        ["## Pomodoros", "- [ ] A (10:00-10:25)", "- [ ] B (11:00-11:25)"].join("\n"),
      modify: async () => {
        modifyCalled = true;
      },
    },
  };

  const result = await plugin.completePomodoroTaskLink(source, "ship");

  assert.equal(result, false);
  assert.equal(modifyCalled, false);
  assert.equal(editor.getValue(), before);
  assert.equal(
    lastNotice(),
    "Task link blocked: Daily.md has multiple open timed Pomodoros",
  );
});

test("Pomodoro link aborts without any write when the task line changed since it was selected", async () => {
  resetNotices();
  const editor = createEditor("- [ ] #task Ship it ^ship");
  const source = sourceForPomodoroLink(editor, "Tasks.md", 0);
  editor.replaceRange(
    "- [ ] #task Ship it NOW ^ship",
    { line: 0, ch: 0 },
    { line: 0, ch: editor.getLine(0).length },
  );
  const plugin = new Plugin();
  let dailyResolved = false;
  plugin.resolveTodayDailyFile = () => {
    dailyResolved = true;
    return { path: "Daily.md" };
  };

  const result = await plugin.completePomodoroTaskLink(source, "ship");

  assert.equal(result, false);
  assert.equal(dailyResolved, false);
  assert.equal(lastNotice(), "Task link blocked: selected task changed in Tasks.md");
});

test("Pomodoro link reports the exact partial result when the daily note write fails after the task write succeeds", async () => {
  resetNotices();
  const editor = createEditor("- [?] #task Ship it [scheduled:: 2026-08-20] ^ship");
  const source = sourceForPomodoroLink(editor, "Tasks.md", 0);
  const plannedDaily = ["## Pomodoros", "- [ ] Current (10:00-10:25)"].join("\n");
  const staleDaily = plannedDaily.replace("Current", "Current NOW");
  const plugin = new Plugin();
  plugin.now = () => localDate(2026, 8, 15);
  plugin.resolveTodayDailyFile = () => ({ path: "Daily.md" });
  plugin.resolveTaskFile = (path) => (path === "Tasks.md" ? { path: "Tasks.md" } : null);
  let readCount = 0;
  plugin.app = {
    vault: {
      read: async (file) => {
        if (file.path !== "Daily.md") {
          return null;
        }
        readCount += 1;
        return readCount === 1 ? plannedDaily : staleDaily;
      },
      modify: async () => {
        throw new Error("should not be called");
      },
    },
    metadataCache: {
      fileToLinktext: (file) => file.path.replace(/\.md$/, ""),
    },
  };
  plugin.resolveReferenceDestination = () => null;
  plugin.suppressEditorScans = () => {};

  const result = await plugin.completePomodoroTaskLink(source, "ship");

  assert.equal(result, false);
  assert.equal(editor.getValue(), "- [*] #task Ship it ^ship");
  assert.equal(lastNotice(), "Task unscheduled, set Next, but Daily.md could not be updated");
});

test("canceling the Pomodoro block-ID modal leaves the note untouched", () => {
  resetNotices();
  const editor = createEditor("- [ ] #task Ship it");
  const source = {
    kind: "link-task-pomodoro",
    editor,
    sourcePath: "Tasks.md",
    line: 0,
    task: { line: 0, rawLine: "- [ ] #task Ship it" },
  };
  const plugin = new Plugin();
  const before = editor.getValue();

  plugin.cancelBlockIdPrompt(source);

  assert.equal(editor.getValue(), before);
});
