const test = require("node:test");
const assert = require("node:assert/strict");
const {
  Plugin,
  helpers,
  resetNotices,
  lastNotice,
  createEditor,
} = require("./block-id-prompt-harness.cjs");

test("ID-less task identity relocates only to one exact line", () => {
  const task = { line: 1, rawLine: "- [x] #task Finished task" };
  assert.deepEqual(
    helpers.taskWikilinkLineForIdentity(`heading\nother\n${task.rawLine}`, task),
    { line: 2, rawLine: task.rawLine },
  );
  assert.equal(
    helpers.taskWikilinkLineForIdentity(`heading\n${task.rawLine}\n${task.rawLine}`, {
      ...task,
      line: 0,
    }),
    null,
  );
  assert.deepEqual(
    helpers.taskWikilinkLineForIdentity(`heading\n${task.rawLine}`, task),
    { line: 1, rawLine: task.rawLine },
  );
});

test("wikilink naming validates closed tasks and rejects duplicate target IDs", async () => {
  const sourceLine = "- [ ] #task Source ((query))";
  const startCh = sourceLine.indexOf("((");
  const editor = createEditor(sourceLine, { line: 0, ch: startCh + 2 });
  const task = {
    line: 0,
    rawLine: "- [x] #task Finished task",
    notePath: "Tasks.md",
  };
  const source = {
    trigger: "((",
    sourcePath: "Daily.md",
    editor,
    line: 0,
    startCh,
    endCh: sourceLine.length,
    replaceStart: startCh,
    replaceEnd: sourceLine.length,
    raw: sourceLine.slice(startCh),
    targetText: "Tasks",
    task,
  };
  const plugin = new Plugin();
  plugin.readDestinationForValidation = async () => ({
    file: { path: "Tasks.md" },
    content: task.rawLine,
  });

  assert.deepEqual(await plugin.validateTaskWikilinkId(source, "finished"), {
    valid: true,
    message: "Ready to add the ID and link",
  });
  plugin.readDestinationForValidation = async () => ({
    file: { path: "Tasks.md" },
    content: `${task.rawLine}\n- [ ] #task Other ^taken`,
  });
  assert.deepEqual(await plugin.validateTaskWikilinkId(source, "taken"), {
    valid: false,
    message: "^taken already exists in Tasks.md",
  });
});

test("wikilink naming adds an ID to a moved closed task and links the original token", async () => {
  resetNotices();
  const sourceLine = "- [ ] #task Source ((query))";
  const startCh = sourceLine.indexOf("((");
  const editor = createEditor(sourceLine, { line: 0, ch: startCh + 2 });
  const rawLine = "- [x] #task Finished task";
  const source = {
    trigger: "((",
    kind: "link-task-complete",
    sourcePath: "Daily.md",
    editor,
    line: 0,
    startCh,
    endCh: sourceLine.length,
    replaceStart: startCh,
    replaceEnd: sourceLine.length,
    raw: sourceLine.slice(startCh),
    targetText: "Tasks",
    blockPrefix: "#^",
    aliasSuffix: "",
    task: { line: 1, rawLine, notePath: "Tasks.md", displayText: "Finished task" },
  };
  const plugin = new Plugin();
  const targetContent = `Heading\n- [ ] #task Inserted above\n${rawLine}`;
  let plannedStart = null;
  plugin.readDestinationForValidation = async () => ({
    file: { path: "Tasks.md" },
    content: targetContent,
  });
  plugin.resolveReferenceDestination = () => ({ path: "Tasks.md" });
  plugin.applyTargetTaskPlan = async (_file, _source, plan) => {
    plannedStart = plan.edits[0].start;
    return true;
  };
  plugin.adjustSourceForPlan = (value) => value;
  plugin.completeTaskSourceLink = (_source, id, path) => {
    assert.equal(id, "finished");
    assert.equal(path, "Tasks.md");
    return { removedCount: 0 };
  };
  plugin.suppressEditorScans = () => {};

  const accepted = await plugin.submitLinkTaskBlockId(source, "finished");
  assert.equal(accepted, true);
  assert.equal(plannedStart, targetContent.indexOf(rawLine));
  assert.equal(lastNotice(), "Added ^finished to Tasks.md");
});

test("^^ naming preserves a cross-note target and alias through the final link", async () => {
  resetNotices();
  const targetContent = "- [ ] #task Ship it";
  const task = helpers.collectTaskPickerItems(targetContent)[0];
  const sourceLine = "  - [[Tasks#^^|alias]]";
  const markerCh = sourceLine.indexOf("^^") + 2;
  const editor = createEditor(sourceLine, { line: 0, ch: markerCh });
  const marker = helpers.findTaskPickerMarkerNearCursor(sourceLine, markerCh);
  const source = {
    ...marker,
    trigger: "^^",
    editor,
    sourcePath: "Daily.md",
    line: 0,
  };
  const plugin = new Plugin();
  plugin.now = () => new Date(2026, 9, 30);
  plugin.getFreshnessStampLine = () => (line) => line;
  plugin.getFreshnessDateText = () => "2026-10-30";
  plugin.suppressEditorScans = () => {};
  plugin.readDestinationForValidation = async () => ({
    file: { path: "Tasks.md" },
    content: targetContent,
  });
  plugin.resolveReferenceDestination = () => ({ path: "Tasks.md" });
  plugin.applyTargetTaskPlan = async () => true;

  const selected = await plugin.selectTaskLinkTask(source, task);
  assert.equal(selected.promptSource.targetText, "Tasks");
  assert.equal(selected.promptSource.blockPrefix, "#^");
  assert.equal(selected.promptSource.aliasSuffix, "|alias");
  assert.equal(await plugin.submitLinkTaskBlockId(selected.promptSource, "ship"), true);
  assert.equal(editor.getLine(0), "  - [[Tasks#^ship|alias]]");
});
