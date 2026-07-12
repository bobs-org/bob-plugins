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

  return {
    getLine(line) {
      return value.split("\n")[line] || "";
    },
    getValue() {
      return value;
    },
    replaceRange(replacement, from, to = from) {
      assert.equal(from.line, to.line);
      const lines = value.split("\n");
      const line = lines[from.line];
      lines[from.line] =
        line.slice(0, from.ch) + replacement + line.slice(to.ch);
      value = lines.join("\n");
    },
    setCursor(nextCursor) {
      cursor = nextCursor;
    },
    get cursor() {
      return cursor;
    },
  };
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

test("single caret relocation preserves embedding and aliases", () => {
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
      plainReplacement: "[[Projects|Work queue]]",
      completionReplacement: "[[Projects^|Work queue]]",
    },
  );

  const editor = createEditor(line);
  assert.equal(
    helpers.applyFileLinkBlockCompletionWithEditorApi(editor, 0, marker),
    true,
  );
  assert.equal(editor.getValue(), "  - ![[Projects^|Work queue]]");
  assert.deepEqual(editor.cursor, { line: 0, ch: marker.finalCursorCh });
});

test("rapid external carets normalize to the staged task picker form", () => {
  const rapidLine = "  - [[Projects]]^^";
  const stagedLine = "  - [[Projects^^]]";
  const rapid = helpers.findTaskPickerMarkerNearCursor(
    rapidLine,
    rapidLine.length,
  );
  const staged = helpers.findTaskPickerMarkerNearCursor(
    stagedLine,
    stagedLine.indexOf("^^") + 2,
  );

  assert.ok(rapid);
  assert.ok(staged);
  for (const property of ["kind", "targetText", "aliasSuffix", "blockPrefix"]) {
    assert.equal(rapid[property], staged[property]);
  }
  assert.equal(rapid.raw, "[[Projects]]^^");
  assert.equal(rapid.startCh, rapidLine.indexOf("[["));
  assert.equal(rapid.endCh, rapidLine.length);
  assert.equal(rapidLine.slice(rapid.startCh, rapid.endCh), rapid.raw);
  assert.equal(helpers.taskPickerRevertReplacement(rapid), "[[Projects^]]");
  assert.equal(
    helpers.taskPickerRevertCursorCh(rapid),
    rapid.startCh + "[[Projects^".length,
  );
});

test("rapid caret task picker supports embedded, aliased, and block links", () => {
  const cases = [
    {
      line: "- ![[Projects|Work queue]]^^",
      targetText: "Projects",
      aliasSuffix: "|Work queue",
      blockPrefix: "^",
      revert: "[[Projects^|Work queue]]",
    },
    {
      line: "- [[Projects#^existing]]^^",
      targetText: "Projects",
      aliasSuffix: "",
      blockPrefix: "#^",
      revert: "[[Projects#^]]",
    },
    {
      line: "- [[#^existing]]^^",
      targetText: "",
      aliasSuffix: "",
      blockPrefix: "#^",
      revert: "[[#^]]",
    },
    {
      line: "- [[Projects#^]]^^",
      targetText: "Projects",
      aliasSuffix: "",
      blockPrefix: "#^",
      revert: "[[Projects#^]]",
    },
  ];

  for (const expected of cases) {
    const marker = helpers.findTaskPickerMarkerNearCursor(
      expected.line,
      expected.line.length,
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
    assert.equal(expected.line[marker.startCh - 1] === "!", expected.line.includes("![["));
  }
});

test("rapid caret recognition respects cursor proximity and fenced code", () => {
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

test("task promotion remains limited to open tasks under Pomodoro entries", () => {
  const ordinaryEditor = createEditor(
    ["- [ ] #task Parent", "  - [[Projects]]^^"].join("\n"),
  );
  const pomodoroEditor = createEditor(
    [
      "## Pomodoros",
      "- [ ] (**10:00 - 10:25**)",
      "  - [[Projects]]^^",
    ].join("\n"),
  );
  const ordinarySource = { editor: ordinaryEditor, line: 1 };
  const pomodoroSource = { editor: pomodoroEditor, line: 2 };

  assert.equal(
    helpers.shouldPromoteTaskToNext(ordinarySource, { status: " " }),
    false,
  );
  assert.equal(
    helpers.shouldPromoteTaskToNext(pomodoroSource, { status: " " }),
    true,
  );
  assert.equal(
    helpers.shouldPromoteTaskToNext(pomodoroSource, { status: "/" }),
    false,
  );
  assert.equal(
    helpers.shouldPromoteTaskToNext(pomodoroSource, { status: "*" }),
    false,
  );
});
