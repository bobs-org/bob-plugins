const test = require("node:test");
const assert = require("node:assert/strict");
const {
  Plugin,
  helpers,
  createEditor,
  applyPlannedEdits,
  sourceForTaskPicker,
} = require("./block-id-prompt-harness.cjs");

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
