const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  notices,
  NavigationHotkeysPlugin,
  helpers,
  TransactionEditor,
  createTaskMoveDestinationFocusHarness,
} = require("./navigation-hotkeys-harness.cjs");

test("task move insertion preserves exact task and section spacing", () => {
  const moved = [
    [
      "- [x] #task Moved [p::3] ^moved",
      "  child",
      "",
      "  continuation",
    ],
    ["- [ ] #task Second ^second"],
  ];
  assert.deepEqual(helpers.flattenTaskMoveBlocks(moved), [
    "- [x] #task Moved [p::3] ^moved",
    "  child",
    "",
    "  continuation",
    "- [ ] #task Second ^second",
  ]);

  const existing = [
    "---",
    "type: \"[[project]]\"",
    "status: wip",
    "---",
    "## Tasks",
    "",
    "- [ ] #task Existing ^existing",
    "",
    "## Notes",
    "Keep",
  ].join("\n");
  const appended = helpers.insertTaskMoveBlocks(existing, moved, "project");
  assert.equal(appended.valid, true);
  assert.equal(appended.content, [
    "---",
    "type: \"[[project]]\"",
    "status: wip",
    "---",
    "## Tasks",
    "",
    "- [ ] #task Existing ^existing",
    "- [x] #task Moved [p::3] ^moved",
    "  child",
    "",
    "  continuation",
    "- [ ] #task Second ^second",
    "",
    "## Notes",
    "Keep",
  ].join("\n"));
  assert.equal(
    appended.content.split(/\r?\n/)[appended.insertedLine],
    moved[0][0],
  );

  const existingCRLF = existing.replace(/\n/g, "\r\n");
  const appendedCRLF = helpers.insertTaskMoveBlocks(existingCRLF, moved, "project");
  assert.equal(appendedCRLF.valid, true);
  assert.equal(
    appendedCRLF.content.split(/\r?\n/)[appendedCRLF.insertedLine],
    moved[0][0],
  );

  const emptySection = ["## Tasks", "## Notes", "Keep"].join("\n");
  const insertedIntoEmptySection = helpers.insertTaskMoveBlocks(
    emptySection,
    moved,
    "project",
  );
  assert.equal(insertedIntoEmptySection.valid, true);
  assert.equal(insertedIntoEmptySection.content, [
    "## Tasks",
    "",
    "- [x] #task Moved [p::3] ^moved",
    "  child",
    "",
    "  continuation",
    "- [ ] #task Second ^second",
    "## Notes",
    "Keep",
  ].join("\n"));
  assert.equal(
    insertedIntoEmptySection.content.split(/\r?\n/)[
      insertedIntoEmptySection.insertedLine
    ],
    moved[0][0],
  );

  const trailingBlankBeforeLaterHeader = [
    "## Tasks",
    "",
    "- [ ] #task Existing ^existing",
    "",
    "",
    "## Notes",
    "Keep",
  ].join("\n");
  const insertedBeforeTrailingBlanks = helpers.insertTaskMoveBlocks(
    trailingBlankBeforeLaterHeader,
    moved,
    "project",
  );
  assert.equal(insertedBeforeTrailingBlanks.valid, true);
  assert.equal(insertedBeforeTrailingBlanks.content, [
    "## Tasks",
    "",
    "- [ ] #task Existing ^existing",
    "- [x] #task Moved [p::3] ^moved",
    "  child",
    "",
    "  continuation",
    "- [ ] #task Second ^second",
    "",
    "",
    "## Notes",
    "Keep",
  ].join("\n"));
  assert.equal(
    insertedBeforeTrailingBlanks.content.split(/\r?\n/)[
      insertedBeforeTrailingBlanks.insertedLine
    ],
    moved[0][0],
  );

  const project = [
    "---",
    "type: \"[[project]]\"",
    "status: wip",
    "---",
    "## Tasks",
    "",
    "- [ ] #task (REPLACE WITH TASK DESCRIPTION)",
    "",
    "## Notes",
    "Keep",
  ].join("\n");
  const inserted = helpers.insertTaskMoveBlocks(project, moved, "project");
  assert.equal(inserted.valid, true);
  assert.equal(inserted.content, [
    "---",
    "type: \"[[project]]\"",
    "status: wip",
    "---",
    "## Tasks",
    "",
    "- [x] #task Moved [p::3] ^moved",
    "  child",
    "",
    "  continuation",
    "- [ ] #task Second ^second",
    "",
    "## Notes",
    "Keep",
  ].join("\n"));
  assert.equal(
    inserted.content.split(/\r?\n/)[inserted.insertedLine],
    moved[0][0],
  );

  const area = [
    "---",
    "type: \"[[area]]\"",
    "---",
    "# Area",
    "Body",
    "",
  ].join("\r\n");
  const created = helpers.insertTaskMoveBlocks(area, moved, "area");
  assert.equal(created.valid, true);
  assert.equal(created.content, [
    "---",
    "type: \"[[area]]\"",
    "---",
    "# Area",
    "Body",
    "",
    "## Tasks",
    "",
    "- [x] #task Moved [p::3] ^moved",
    "  child",
    "",
    "  continuation",
    "- [ ] #task Second ^second",
    "",
  ].join("\r\n"));
  assert.equal(
    created.content.split(/\r?\n/)[created.insertedLine],
    moved[0][0],
  );

  const areaWithoutTerminalNewline = area.slice(0, -2);
  const createdWithoutTerminalNewline = helpers.insertTaskMoveBlocks(
    areaWithoutTerminalNewline,
    moved,
    "area",
  );
  assert.equal(createdWithoutTerminalNewline.valid, true);
  assert.equal(createdWithoutTerminalNewline.content.endsWith("\r\n"), false);
  assert.match(
    createdWithoutTerminalNewline.content,
    /Body\r\n\r\n## Tasks\r\n\r\n- \[x\]/,
  );
  assert.equal(
    createdWithoutTerminalNewline.content.split(/\r?\n/)[
      createdWithoutTerminalNewline.insertedLine
    ],
    moved[0][0],
  );

  const invalidProject = helpers.insertTaskMoveBlocks(project.replace("## Tasks", "## Work"), moved, "project");
  assert.equal(invalidProject.valid, false);
  assert.match(invalidProject.error, /no valid ## Tasks/);
});

test("task move planning migrates identities and links across every affected note", () => {
  const source = [
    "- [ ] #task One [id:: Source__one] [dependsOn:: Source__two] ^one",
    "  - ![[#^two|Two]]",
    "  - [[#^stay|Stay]]",
    "- [/] #task Two [id:: Source__two] ^two",
    "- [ ] #task Stay [dependsOn:: Source__one] ^stay",
    "  - [[#^one|Moved]]",
  ].join("\n");
  const destination = [
    "---",
    "type: \"[[project]]\"",
    "status: waiting",
    "---",
    "## Tasks",
    "",
    "- [ ] #task Existing [id:: Projects__Dest__existing] ^existing",
    "",
    "## Notes",
    "Keep",
  ].join("\n");
  const refs = [
    "- [ ] #task Ref [dependsOn:: Source__one]",
    "![[Source#^one|Embedded alias]]",
    "[Second](Source.md#^two)",
  ].join("\n");
  const discovery = helpers.discoverMovableObsidianTaskTargets(source, 0, 1);
  const plan = helpers.planTaskMoveAcrossFiles({
    sourcePath: "Source.md",
    destinationPath: "Projects/Dest.md",
    sourceContent: source,
    destinationContent: destination,
    otherContents: new Map([["Refs.md", refs]]),
    targets: discovery.targets,
  });
  assert.equal(plan.valid, true, plan.error);
  const nextSource = plan.changes.get("Source.md").after;
  assert.match(nextSource, /dependsOn:: Projects__Dest__one/);
  assert.match(nextSource, /\[\[Projects\/Dest#\^one\|Moved\]\]/);
  assert.doesNotMatch(nextSource, /#task One|#task Two/);

  const nextDestination = plan.changes.get("Projects/Dest.md").after;
  assert.equal(nextDestination, [
    "---",
    "type: \"[[project]]\"",
    "status: waiting",
    "---",
    "## Tasks",
    "",
    "- [ ] #task Existing [id:: Projects__Dest__existing] ^existing",
    "- [ ] #task One [id:: Projects__Dest__one] [dependsOn:: Projects__Dest__two] ^one",
    "  - ![[#^two|Two]]",
    "  - [[Source#^stay|Stay]]",
    "- [/] #task Two [id:: Projects__Dest__two] ^two",
    "",
    "## Notes",
    "Keep",
  ].join("\n"));

  const nextRefs = plan.changes.get("Refs.md").after;
  assert.match(nextRefs, /dependsOn:: Projects__Dest__one/);
  assert.match(nextRefs, /!\[\[Projects\/Dest#\^one\|Embedded alias\]\]/);
  assert.match(nextRefs, /\(Projects\/Dest\.md#\^two\)/);

  assert.equal(
    nextDestination.split("\n")[plan.destinationLine],
    plan.destinationAnchorText,
  );
  assert.equal(
    plan.destinationAnchorText,
    "- [ ] #task One [id:: Projects__Dest__one] [dependsOn:: Projects__Dest__two] ^one",
  );
  assert.equal(plan.destinationBlockId, "one");
});

test("task move planning exposes a destination anchor for area destinations and counted moves", () => {
  const countedSource = [
    "- [ ] #task First",
    "- [ ] #task Second ^second",
    "- [ ] #task Third ^third",
    "- [ ] #task Stay",
  ].join("\n");
  const areaDestination = [
    "---",
    "type: \"[[area]]\"",
    "---",
    "# Area",
    "Body",
  ].join("\n");
  const discovery = helpers.discoverMovableObsidianTaskTargets(countedSource, 0, 2);
  assert.equal(discovery.actualCount, 3);
  const plan = helpers.planTaskMoveAcrossFiles({
    sourcePath: "Source.md",
    destinationPath: "Area.md",
    sourceContent: countedSource,
    destinationContent: areaDestination,
    targets: discovery.targets,
  });
  assert.equal(plan.valid, true, plan.error);
  const nextDestination = plan.changes.get("Area.md").after;
  assert.equal(
    nextDestination.split("\n")[plan.destinationLine],
    plan.destinationAnchorText,
  );
  assert.equal(plan.destinationAnchorText, "- [ ] #task First");
  assert.equal(plan.destinationBlockId, null);
});

test("task move planning rejects destination collisions and malformed identities", () => {
  const destination = [
    "---",
    "type: \"[[area]]\"",
    "---",
    "## Tasks",
    "- [ ] #task Existing ^same",
  ].join("\n");
  const collisionSource = "- [ ] #task Move ^same";
  let discovery = helpers.discoverMovableObsidianTaskTargets(collisionSource, 0, 0);
  let plan = helpers.planTaskMoveAcrossFiles({
    sourcePath: "Source.md",
    destinationPath: "Area.md",
    sourceContent: collisionSource,
    destinationContent: destination,
    targets: discovery.targets,
  });
  assert.equal(plan.valid, false);
  assert.match(plan.error, /already contains block ID/);

  const malformed = "- [ ] #task Move [id:: wrong] ^move";
  discovery = helpers.discoverMovableObsidianTaskTargets(malformed, 0, 0);
  plan = helpers.planTaskMoveAcrossFiles({
    sourcePath: "Source.md",
    destinationPath: "Area.md",
    sourceContent: malformed,
    destinationContent: destination.replace("^same", "^other"),
    targets: discovery.targets,
  });
  assert.equal(plan.valid, false);
  assert.match(plan.error, /ambiguous \[id::\]/);
});

test("resolveTaskMoveDestinationLine resolves via planned, block-id, text, and clamped fallbacks", () => {
  const content = [
    "## Tasks",
    "",
    "- [ ] #task Existing ^existing",
    "- [ ] #task Moved ^moved",
  ].join("\n");
  const anchor = { line: 3, text: "- [ ] #task Moved ^moved", blockId: "moved" };
  assert.deepEqual(helpers.resolveTaskMoveDestinationLine(content, anchor), {
    line: 3,
    source: "planned",
  });

  const shiftedByFrontmatter = [
    "---",
    "task_count: 1",
    "---",
    "## Tasks",
    "",
    "- [ ] #task Existing ^existing",
    "- [ ] #task Moved ^moved",
  ].join("\n");
  assert.deepEqual(
    helpers.resolveTaskMoveDestinationLine(shiftedByFrontmatter, anchor),
    { line: 6, source: "block-id" },
  );
  assert.deepEqual(
    helpers.resolveTaskMoveDestinationLine(shiftedByFrontmatter, {
      line: 3,
      text: "- [ ] #task Moved ^moved",
      blockId: null,
    }),
    { line: 6, source: "text" },
  );

  const anchorText = "- [ ] #task Fenced ^fenced";
  const fencedOnly = [
    "## Tasks",
    "",
    "```",
    anchorText,
    "```",
    "- [ ] #task Real ^real",
  ].join("\n");
  assert.deepEqual(
    helpers.resolveTaskMoveDestinationLine(fencedOnly, {
      line: 1,
      text: anchorText,
      blockId: null,
    }),
    { line: 1, source: "clamped" },
  );

  const frontmatterAnchorText = "type: \"[[project]]\"";
  const frontmatterOnly = [
    "---",
    frontmatterAnchorText,
    "---",
    "## Tasks",
    "- [ ] #task Real ^real",
  ].join("\n");
  assert.deepEqual(
    helpers.resolveTaskMoveDestinationLine(frontmatterOnly, {
      line: 3,
      text: frontmatterAnchorText,
      blockId: null,
    }),
    { line: 3, source: "clamped" },
  );

  const shrunken = "- [ ] #task Only ^only";
  assert.deepEqual(
    helpers.resolveTaskMoveDestinationLine(shrunken, {
      line: 5,
      text: "- [ ] #task Missing ^missing",
      blockId: null,
    }),
    { line: 0, source: "clamped" },
  );

  assert.deepEqual(
    helpers.resolveTaskMoveDestinationLine("", {
      line: 3,
      text: "x",
      blockId: null,
    }),
    { line: 0, source: "clamped" },
  );
});

test("focusTaskMoveDestination opens the destination file and anchors the cursor", async () => {
  const editor = new TransactionEditor(
    ["- [ ] #task Existing ^existing", "- [ ] #task Moved ^moved"].join("\n"),
    { line: 0, ch: 0 },
  );
  const destinationFile = { path: "Area.md", basename: "Area", extension: "md" };
  const { plugin, captureCalls, openCalls } = createTaskMoveDestinationFocusHarness({
    getActiveMarkdownView: () => ({ file: destinationFile, editor }),
  });
  const anchor = { line: 1, text: "- [ ] #task Moved ^moved", blockId: "moved" };

  const result = await plugin.focusTaskMoveDestination(destinationFile, anchor);

  assert.equal(result, true);
  assert.equal(captureCalls.length, 1);
  assert.equal(openCalls.length, 1);
  assert.equal(openCalls[0].file, destinationFile);
  assert.deepEqual(editor.getCursor(), { line: 1, ch: 0 });
});

test("focusTaskMoveDestination returns false without moving the cursor when the open fails", async () => {
  const editor = new TransactionEditor(
    ["- [ ] #task Existing ^existing"].join("\n"),
    { line: 0, ch: 0 },
  );
  const destinationFile = { path: "Area.md", basename: "Area", extension: "md" };
  const { plugin, openCalls } = createTaskMoveDestinationFocusHarness({
    openResult: false,
    getActiveMarkdownView: () => ({ file: destinationFile, editor }),
  });
  const anchor = {
    line: 0,
    text: "- [ ] #task Existing ^existing",
    blockId: "existing",
  };

  const result = await plugin.focusTaskMoveDestination(destinationFile, anchor);

  assert.equal(result, false);
  assert.equal(openCalls.length, 1);
  assert.deepEqual(editor.getCursor(), { line: 0, ch: 0 });
  assert.equal(editor.setCursorCalls.length, 0);
});

test("focusTaskMoveDestination re-anchors by block ID when the destination content drifted", async () => {
  const editor = new TransactionEditor(
    [
      "---",
      "task_count: 1",
      "---",
      "## Tasks",
      "",
      "- [ ] #task Existing ^existing",
      "- [ ] #task Moved ^moved",
    ].join("\n"),
    { line: 0, ch: 0 },
  );
  const destinationFile = { path: "Area.md", basename: "Area", extension: "md" };
  const { plugin } = createTaskMoveDestinationFocusHarness({
    getActiveMarkdownView: () => ({ file: destinationFile, editor }),
  });
  // Planned index (3) pointed at the moved task before bob-project-tasks inserted
  // frontmatter lines after the write; block-ID re-anchoring must still find it.
  const anchor = { line: 3, text: "- [ ] #task Moved ^moved", blockId: "moved" };

  const result = await plugin.focusTaskMoveDestination(destinationFile, anchor);

  assert.equal(result, true);
  assert.deepEqual(editor.getCursor(), { line: 6, ch: 0 });
});

test("physical task move chord declines auto-repeat and consumes Vim normal input once", () => {
  const makeEvent = (overrides = {}) => {
    const calls = { prevent: 0, stop: 0, immediate: 0 };
    return {
      key: "M",
      code: "KeyM",
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false,
      repeat: false,
      preventDefault: () => calls.prevent += 1,
      stopPropagation: () => calls.stop += 1,
      stopImmediatePropagation: () => calls.immediate += 1,
      calls,
      ...overrides,
    };
  };
  const inputState = {
    keyBuffer: [],
    repeat: null,
    getRepeat: () => null,
  };
  const cm = {
    state: { vim: { mode: "normal", inputState } },
    getCursor: () => ({ line: 0, ch: 0 }),
  };
  const editor = { cm: { cm } };
  const view = { editor };
  const plugin = new NavigationHotkeysPlugin();
  plugin.handledCountedTaskMoveEvents = new WeakSet();
  let focusedViewReads = 0;
  plugin.getFocusedMarkdownEditorView = () => {
    focusedViewReads += 1;
    return view;
  };
  const opens = [];
  plugin.openTaskMoveDestinationPicker = (_editor, _view, options) => {
    opens.push(options);
    return true;
  };

  const repeated = makeEvent({ repeat: true });
  assert.equal(plugin.handleCountedTaskMovePhysicalKeydown(repeated), false);
  assert.deepEqual(repeated.calls, { prevent: 0, stop: 0, immediate: 0 });
  assert.equal(focusedViewReads, 0);
  assert.deepEqual(opens, []);

  const bare = makeEvent();
  assert.equal(plugin.handleCountedTaskMovePhysicalKeydown(bare), true);
  assert.equal(focusedViewReads, 1);
  assert.deepEqual(opens[0], { countExplicit: false, additionalTaskCount: 0 });
  assert.deepEqual(bare.calls, { prevent: 1, stop: 1, immediate: 1 });
  assert.equal(plugin.handleCountedTaskMovePhysicalKeydown(bare), false);

  inputState.keyBuffer = ["2"];
  inputState.repeat = 2;
  inputState.getRepeat = () => 2;
  const counted = makeEvent();
  assert.equal(plugin.handleCountedTaskMovePhysicalKeydown(counted), true);
  assert.deepEqual(opens[1], { countExplicit: true, additionalTaskCount: 2 });
  assert.deepEqual(inputState.keyBuffer, []);
  assert.equal(inputState.repeat, null);

  for (const mode of ["insert", "visual", "visual-line", "replace"]) {
    cm.state.vim.mode = mode;
    const event = makeEvent();
    assert.equal(plugin.handleCountedTaskMovePhysicalKeydown(event), false);
    assert.equal(event.calls.prevent, 0);
  }
  cm.state.vim.mode = "normal";
  for (const overrides of [
    { ctrlKey: false },
    { shiftKey: false },
    { altKey: true },
    { metaKey: true },
    { code: "KeyN", key: "N" },
  ]) {
    const event = makeEvent(overrides);
    assert.equal(plugin.handleCountedTaskMovePhysicalKeydown(event), false);
    assert.equal(event.calls.prevent, 0);
  }
});

test("physical transclusion toggle owns bare and counted Vim normal input", () => {
  const makeEvent = (overrides = {}) => {
    const calls = { prevent: 0, stop: 0, immediate: 0 };
    return {
      key: "!",
      code: "Digit1",
      ctrlKey: false,
      shiftKey: true,
      altKey: false,
      metaKey: false,
      repeat: false,
      preventDefault: () => {
        calls.prevent += 1;
      },
      stopPropagation: () => {
        calls.stop += 1;
      },
      stopImmediatePropagation: () => {
        calls.immediate += 1;
      },
      calls,
      ...overrides,
    };
  };
  const inputState = {
    keyBuffer: [],
    repeat: null,
    reason: "",
    getRepeat: () => null,
  };
  const cm = {
    state: { vim: { mode: "normal", inputState } },
    getCursor: () => ({ line: 0, ch: 4 }),
  };
  const editor = {
    cm: { cm },
    getCursor: () => ({ line: 0, ch: 4 }),
    getLine: () => "- [[Target]]",
  };
  const view = { editor };
  const plugin = new NavigationHotkeysPlugin();
  plugin.handledCountedTransclusionToggleEvents = new WeakSet();
  let focusedViewReads = 0;
  plugin.getFocusedMarkdownEditorView = () => {
    focusedViewReads += 1;
    return view;
  };
  const singles = [];
  const counteds = [];
  plugin.toggleCurrentLineTransclusions = (receivedEditor) => {
    singles.push(receivedEditor);
    return true;
  };
  plugin.toggleCountedLineTransclusions = (receivedEditor, cursor, repeat) => {
    counteds.push({ editor: receivedEditor, cursor, repeat });
    return true;
  };

  inputState.keyBuffer = ["g"];
  const bare = makeEvent();
  assert.equal(plugin.handleCountedTransclusionTogglePhysicalKeydown(bare), true);
  assert.deepEqual(bare.calls, { prevent: 1, stop: 1, immediate: 1 });
  assert.deepEqual(inputState.keyBuffer, []);
  assert.equal(inputState.repeat, null);
  assert.equal(inputState.reason, "transclusion-toggle");
  assert.deepEqual(singles, [editor]);
  assert.deepEqual(counteds, []);

  assert.equal(plugin.handleCountedTransclusionTogglePhysicalKeydown(bare), false);
  assert.equal(singles.length, 1);

  inputState.keyBuffer = ["3"];
  inputState.repeat = 3;
  inputState.reason = "";
  inputState.getRepeat = () => 3;
  const counted = makeEvent();
  assert.equal(
    plugin.handleCountedTransclusionTogglePhysicalKeydown(counted),
    true,
  );
  assert.deepEqual(counted.calls, { prevent: 1, stop: 1, immediate: 1 });
  assert.equal(inputState.repeat, null);
  assert.equal(inputState.reason, "counted-transclusion-toggle");
  assert.deepEqual(counteds, [
    { editor, cursor: { line: 0, ch: 4 }, repeat: 3 },
  ]);
  assert.equal(singles.length, 1);

  const repeated = makeEvent({ repeat: true });
  const focusedBeforeRepeat = focusedViewReads;
  assert.equal(
    plugin.handleCountedTransclusionTogglePhysicalKeydown(repeated),
    false,
  );
  assert.deepEqual(repeated.calls, { prevent: 0, stop: 0, immediate: 0 });
  assert.equal(focusedViewReads, focusedBeforeRepeat);

  for (const mode of ["insert", "visual", "visual-line", "replace"]) {
    cm.state.vim.mode = mode;
    const event = makeEvent();
    assert.equal(plugin.handleCountedTransclusionTogglePhysicalKeydown(event), false);
    assert.equal(event.calls.prevent, 0);
  }

  cm.state.vim.mode = "normal";
  for (const overrides of [
    { ctrlKey: true },
    { altKey: true },
    { metaKey: true },
    { key: "1", shiftKey: false },
  ]) {
    const event = makeEvent(overrides);
    assert.equal(plugin.handleCountedTransclusionTogglePhysicalKeydown(event), false);
    assert.equal(event.calls.prevent, 0);
  }

  editor.getLine = () => "- no links";
  const noLink = makeEvent();
  assert.equal(plugin.handleCountedTransclusionTogglePhysicalKeydown(noLink), false);
  assert.deepEqual(noLink.calls, { prevent: 0, stop: 0, immediate: 0 });

  editor.getLine = () => "- [[Target]]";
  delete cm.state.vim;
  const unavailable = makeEvent();
  assert.equal(
    plugin.handleCountedTransclusionTogglePhysicalKeydown(unavailable),
    false,
  );
  assert.equal(unavailable.calls.prevent, 0);

  cm.state.vim = { mode: "normal", inputState };
  plugin.getFocusedMarkdownEditorView = () => null;
  const unfocused = makeEvent();
  assert.equal(plugin.handleCountedTransclusionTogglePhysicalKeydown(unfocused), false);
  assert.equal(unfocused.calls.prevent, 0);
});

test("runtime task move writes destination before source and rolls back source failures", async () => {
  notices.length = 0;
  const sourceFile = { path: "Source.md", basename: "Source", extension: "md" };
  const destinationFile = { path: "Dest.md", basename: "Dest", extension: "md" };
  const sourceContent = "- [ ] #task Move ^move\n- [ ] #task Stay ^stay";
  const destinationContent = [
    "---",
    "type: \"[[area]]\"",
    "---",
    "# Destination",
  ].join("\n");
  class FailingSourceEditor extends TransactionEditor {
    transaction() {
      throw new Error("injected source failure");
    }
  }
  const sourceEditor = new FailingSourceEditor(sourceContent, { line: 0, ch: 4 });
  const contents = new Map([
    [sourceFile.path, sourceContent],
    [destinationFile.path, destinationContent],
  ]);
  const writeOrder = [];
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    vault: {
      getMarkdownFiles: () => [sourceFile, destinationFile],
      cachedRead: async (file) => contents.get(file.path),
      process: async (file, transform) => {
        writeOrder.push(file.path);
        contents.set(file.path, transform(contents.get(file.path)));
      },
    },
    workspace: {},
  };
  plugin.getActiveMarkdownView = () => ({ file: sourceFile, editor: sourceEditor });
  plugin.getOpenMarkdownEditorForPath = (path) =>
    path === sourceFile.path ? sourceEditor : null;
  const discovery = helpers.discoverMovableObsidianTaskTargets(sourceContent, 0, 0);
  const session = {
    sourceFile,
    sourcePath: sourceFile.path,
    sourceView: null,
    editor: sourceEditor,
    sourceContent,
    cursor: { line: 0, ch: 4 },
    scroll: null,
    discovery,
  };
  const result = await plugin.commitTaskMoveSession(session, {
    file: destinationFile,
  });
  assert.equal(result, false);
  assert.equal(sourceEditor.content, sourceContent);
  assert.equal(contents.get(destinationFile.path), destinationContent);
  assert.deepEqual(writeOrder, ["Dest.md", "Dest.md"]);
  assert.match(notices.at(-1), /rolled back.*source tasks were retained/);
});

test("runtime task move groups open-editor source and destination changes", async () => {
  notices.length = 0;
  const sourceFile = { path: "Source.md", basename: "Source", extension: "md" };
  const destinationFile = { path: "Dest.md", basename: "Dest", extension: "md" };
  const sourceContent = "- [ ] #task Move ^move\n- [ ] #task Stay ^stay";
  const destinationContent = [
    "---",
    "type: \"[[project]]\"",
    "status: wip",
    "---",
    "## Tasks",
    "",
    "- [ ] #task Existing ^existing",
  ].join("\n");
  const sourceEditor = new TransactionEditor(sourceContent, { line: 0, ch: 3 });
  const destinationEditor = new TransactionEditor(destinationContent, { line: 6, ch: 0 });
  const plugin = new NavigationHotkeysPlugin();
  plugin.filePositions = new Map();
  plugin.app = {
    vault: {
      getMarkdownFiles: () => [sourceFile, destinationFile],
      cachedRead: async () => "",
      process: async () => {
        throw new Error("open editors should not use vault.process");
      },
    },
    workspace: {},
  };
  plugin.getActiveMarkdownView = () => ({ file: sourceFile, editor: sourceEditor });
  plugin.getOpenMarkdownEditorForPath = (path) =>
    path === sourceFile.path
      ? sourceEditor
      : path === destinationFile.path
        ? destinationEditor
        : null;
  const discovery = helpers.discoverMovableObsidianTaskTargets(sourceContent, 0, 0);
  const session = {
    sourceFile,
    sourcePath: sourceFile.path,
    editor: sourceEditor,
    sourceContent,
    cursor: { line: 0, ch: 3 },
    scroll: null,
    discovery,
  };
  const result = await plugin.commitTaskMoveSession(session, { file: destinationFile });
  assert.equal(result, true);
  assert.equal(sourceEditor.undoGroups, 1);
  assert.equal(destinationEditor.undoGroups, 1);
  assert.doesNotMatch(sourceEditor.content, /#task Move/);
  assert.match(destinationEditor.content, /#task Move \[id:: Dest__move\] \^move/);
  assert.deepEqual(sourceEditor.cursor, { line: 0, ch: 3 });
  assert.match(notices.at(-1), /Moved 1 task to Dest/);
});

test("runtime task move guards destination, auxiliary, and rollback failures", async () => {
  const sourceFile = { path: "Source.md", basename: "Source", extension: "md" };
  const destinationFile = { path: "Dest.md", basename: "Dest", extension: "md" };
  const refsFile = { path: "Refs.md", basename: "Refs", extension: "md" };
  const sourceContent = "- [ ] #task Move ^move\n- [ ] #task Stay ^stay";
  const destinationContent = [
    "---",
    "type: \"[[area]]\"",
    "---",
    "# Destination",
  ].join("\n");
  const refsContent = "![[Source#^move|Moved]]";

  const run = async (failure) => {
    notices.length = 0;
    const sourceEditor = new TransactionEditor(sourceContent, { line: 0, ch: 0 });
    const contents = new Map([
      [sourceFile.path, sourceContent],
      [destinationFile.path, destinationContent],
      [refsFile.path, refsContent],
    ]);
    const plugin = new NavigationHotkeysPlugin();
    plugin.app = {
      vault: {
        getMarkdownFiles: () => [sourceFile, destinationFile, refsFile],
        cachedRead: async (file) => contents.get(file.path),
        process: async (file, transform) => {
          const current = contents.get(file.path);
          if (failure === "destination" && file.path === destinationFile.path) {
            throw new Error("injected destination failure");
          }
          if (failure !== "destination" && file.path === refsFile.path) {
            throw new Error("injected auxiliary failure");
          }
          if (
            failure === "rollback" &&
            file.path === destinationFile.path &&
            current !== destinationContent
          ) {
            throw new Error("injected rollback failure");
          }
          contents.set(file.path, transform(current));
        },
      },
      workspace: {},
    };
    plugin.getActiveMarkdownView = () => ({ file: sourceFile, editor: sourceEditor });
    plugin.getOpenMarkdownEditorForPath = (path) =>
      path === sourceFile.path ? sourceEditor : null;
    const discovery = helpers.discoverMovableObsidianTaskTargets(sourceContent, 0, 0);
    const result = await plugin.commitTaskMoveSession(
      {
        sourceFile,
        sourcePath: sourceFile.path,
        editor: sourceEditor,
        sourceContent,
        cursor: { line: 0, ch: 0 },
        scroll: null,
        discovery,
      },
      { file: destinationFile },
    );
    return { result, contents, sourceEditor, notice: notices.at(-1) };
  };

  const destinationFailure = await run("destination");
  assert.equal(destinationFailure.result, false);
  assert.equal(destinationFailure.contents.get("Dest.md"), destinationContent);
  assert.equal(destinationFailure.sourceEditor.content, sourceContent);

  const auxiliaryFailure = await run("auxiliary");
  assert.equal(auxiliaryFailure.result, false);
  assert.equal(auxiliaryFailure.contents.get("Dest.md"), destinationContent);
  assert.equal(auxiliaryFailure.contents.get("Refs.md"), refsContent);
  assert.equal(auxiliaryFailure.sourceEditor.content, sourceContent);
  assert.match(auxiliaryFailure.notice, /rolled back/);

  const rollbackFailure = await run("rollback");
  assert.equal(rollbackFailure.result, false);
  assert.notEqual(rollbackFailure.contents.get("Dest.md"), destinationContent);
  assert.equal(rollbackFailure.sourceEditor.content, sourceContent);
  assert.match(rollbackFailure.notice, /recoverable duplicates.*Dest\.md/);
});

test("task move insertion separates the section's first task from preamble and placeholders", () => {
  const first = "- [ ] #task Moved ^moved";
  const moved = [[first]];
  const cases = [
    {
      name: "bare empty heading at EOF",
      destination: ["## Tasks"].join("\n"),
      expected: ["## Tasks", "", first].join("\n"),
    },
    {
      name: "bare empty heading before another heading",
      destination: ["## Tasks", "## Notes", "Keep"].join("\n"),
      expected: ["## Tasks", "", first, "## Notes", "Keep"].join("\n"),
    },
    {
      name: "count-only section at EOF",
      destination: ["## Tasks", "Task count: 0", ""].join("\n"),
      expected: ["## Tasks", "Task count: 0", "", first, ""].join("\n"),
    },
    {
      name: "count-only section before another heading",
      destination: ["## Tasks", "Task count: 0", "", "## Notes", "Keep"].join("\n"),
      expected: ["## Tasks", "Task count: 0", "", first, "", "## Notes", "Keep"].join(
        "\n",
      ),
    },
    {
      name: "count-only section without a terminal newline",
      destination: ["## Tasks", "Task count: 0"].join("\n"),
      expected: ["## Tasks", "Task count: 0", "", first].join("\n"),
    },
    {
      name: "inline-code count preamble",
      destination: ["## Tasks", "`Task count: 2`", ""].join("\n"),
      expected: ["## Tasks", "`Task count: 2`", "", first, ""].join("\n"),
    },
    {
      name: "closed fenced preamble holding a fake task",
      destination: ["## Tasks", "```dataview", "- [ ] #task fake", "```", ""].join("\n"),
      expected: ["## Tasks", "```dataview", "- [ ] #task fake", "```", "", first, ""].join(
        "\n",
      ),
    },
    {
      name: "whitespace-only blank after the preamble",
      destination: ["## Tasks", "Task count: 0", "   ", ""].join("\n"),
      expected: ["## Tasks", "Task count: 0", "", first, "   ", ""].join("\n"),
    },
    {
      name: "un-separated placeholder replacement",
      destination: ["## Tasks", "- [ ] #task (REPLACE WITH TASK DESCRIPTION)", ""].join("\n"),
      expected: ["## Tasks", "", first, ""].join("\n"),
    },
    {
      name: "placeholder replacement keeps its existing blank",
      destination: ["## Tasks", "", "- [ ] #task (REPLACE WITH TASK DESCRIPTION)", ""].join(
        "\n",
      ),
      expected: ["## Tasks", "", first, ""].join("\n"),
    },
    {
      name: "count preamble plus placeholder keeps the template and separates the move",
      destination: ["## Tasks", "Task count: 0", "- [ ] #task (REPLACE WITH TASK DESCRIPTION)", ""].join(
        "\n",
      ),
      expected: [
        "## Tasks",
        "Task count: 0",
        "- [ ] #task (REPLACE WITH TASK DESCRIPTION)",
        "",
        first,
        "",
      ].join("\n"),
    },
  ];
  for (const { name, destination, expected } of cases) {
    const result = helpers.insertTaskMoveBlocks(destination, moved, "project");
    assert.equal(result.valid, true, name);
    assert.equal(result.content, expected, name);
    assert.equal(result.content.split(/\r?\n/)[result.insertedLine], first, name);
  }

  const crlfDestination = ["## Tasks", "Task count: 0", "", ""].join("\r\n");
  const crlfResult = helpers.insertTaskMoveBlocks(crlfDestination, moved, "project");
  assert.equal(crlfResult.valid, true);
  assert.equal(
    crlfResult.content,
    ["## Tasks", "Task count: 0", "", first, "", ""].join("\r\n"),
  );
  assert.equal(crlfResult.content.split(/\r?\n/)[crlfResult.insertedLine], first);

  const areaResult = helpers.insertTaskMoveBlocks(
    ["## Tasks", "Task count: 0", ""].join("\n"),
    moved,
    "area",
  );
  assert.equal(areaResult.valid, true);
  assert.equal(
    areaResult.content,
    ["## Tasks", "Task count: 0", "", first, ""].join("\n"),
  );
  assert.equal(areaResult.content.split(/\r?\n/)[areaResult.insertedLine], first);
});

test("task move insertion keeps populated sections compact and second moves stable", () => {
  const moved = [["- [ ] #task Moved ^moved"]];
  for (const existing of [
    "- [ ] #task Existing ^existing",
    "- [x] #task Done ^done",
    "- [/] #task Pending ^pending",
  ]) {
    const result = helpers.insertTaskMoveBlocks(
      ["## Tasks", "", existing, ""].join("\n"),
      moved,
      "project",
    );
    assert.equal(result.valid, true, existing);
    assert.equal(
      result.content,
      ["## Tasks", "", existing, "- [ ] #task Moved ^moved", ""].join("\n"),
      existing,
    );
    assert.equal(
      result.content.split(/\r?\n/)[result.insertedLine],
      "- [ ] #task Moved ^moved",
      existing,
    );
  }

  const withChildren = helpers.insertTaskMoveBlocks(
    ["## Tasks", "", "- [ ] #task Parent ^parent", "  child", ""].join("\n"),
    moved,
    "project",
  );
  assert.equal(
    withChildren.content,
    [
      "## Tasks",
      "",
      "- [ ] #task Parent ^parent",
      "  child",
      "- [ ] #task Moved ^moved",
      "",
    ].join("\n"),
  );

  const firstMove = helpers.insertTaskMoveBlocks(
    ["## Tasks", "Task count: 0", ""].join("\n"),
    moved,
    "project",
  );
  const secondMove = helpers.insertTaskMoveBlocks(
    firstMove.content,
    [["- [ ] #task Again ^again"]],
    "project",
  );
  assert.equal(
    secondMove.content,
    [
      "## Tasks",
      "Task count: 0",
      "",
      "- [ ] #task Moved ^moved",
      "- [ ] #task Again ^again",
      "",
    ].join("\n"),
  );
  assert.equal(
    secondMove.content.split(/\r?\n/)[secondMove.insertedLine],
    "- [ ] #task Again ^again",
  );
});

test("task move planning separates a counted move into a count-only section", () => {
  const source = [
    "- [ ] #task One ^one",
    "  child one",
    "",
    "  continuation one",
    "- [ ] #task Two ^two",
    "- [ ] #task Stay ^stay",
  ].join("\n");
  const destination = [
    "---",
    "type: \"[[project]]\"",
    "status: wip",
    "---",
    "## Tasks",
    "Task count: 0",
    "",
  ].join("\n");
  const discovery = helpers.discoverMovableObsidianTaskTargets(source, 0, 1);
  assert.equal(discovery.valid, true);
  assert.equal(discovery.actualCount, 2);
  const plan = helpers.planTaskMoveAcrossFiles({
    sourcePath: "Source.md",
    destinationPath: "Projects/Dest.md",
    sourceContent: source,
    destinationContent: destination,
    targets: discovery.targets,
  });
  assert.equal(plan.valid, true, plan.error);
  const nextSource = plan.changes.get("Source.md").after;
  assert.equal(nextSource, "- [ ] #task Stay ^stay");
  const nextDestination = plan.changes.get("Projects/Dest.md").after;
  assert.equal(nextDestination, [
    "---",
    "type: \"[[project]]\"",
    "status: wip",
    "---",
    "## Tasks",
    "Task count: 0",
    "",
    "- [ ] #task One [id:: Projects__Dest__one] ^one",
    "  child one",
    "",
    "  continuation one",
    "- [ ] #task Two [id:: Projects__Dest__two] ^two",
    "",
  ].join("\n"));
  assert.equal(
    nextDestination.split("\n")[plan.destinationLine],
    plan.destinationAnchorText,
  );
  assert.equal(
    plan.destinationAnchorText,
    "- [ ] #task One [id:: Projects__Dest__one] ^one",
  );
  assert.equal(plan.destinationBlockId, "one");
});

test("runtime counted move into a count-only section focuses the first moved task", async () => {
  notices.length = 0;
  const sourceFile = { path: "Source.md", basename: "Source", extension: "md" };
  const destinationFile = { path: "Dest.md", basename: "Dest", extension: "md" };
  const sourceContent = [
    "- [ ] #task One ^one",
    "  child one",
    "- [ ] #task Two ^two",
    "- [ ] #task Stay ^stay",
  ].join("\n");
  const destinationContent = [
    "---",
    "type: \"[[project]]\"",
    "status: wip",
    "---",
    "## Tasks",
    "Task count: 0",
    "",
  ].join("\n");
  const sourceEditor = new TransactionEditor(sourceContent, { line: 0, ch: 3 });
  const destinationEditor = new TransactionEditor(destinationContent, { line: 6, ch: 0 });
  const plugin = new NavigationHotkeysPlugin();
  plugin.filePositions = new Map();
  plugin.app = {
    vault: {
      getMarkdownFiles: () => [sourceFile, destinationFile],
      cachedRead: async () => "",
      process: async () => {
        throw new Error("open editors should not use vault.process");
      },
    },
    workspace: {},
  };
  plugin.getActiveMarkdownView = () => ({ file: sourceFile, editor: sourceEditor });
  plugin.getOpenMarkdownEditorForPath = (path) =>
    path === sourceFile.path
      ? sourceEditor
      : path === destinationFile.path
        ? destinationEditor
        : null;
  const discovery = helpers.discoverMovableObsidianTaskTargets(sourceContent, 0, 1);
  assert.equal(discovery.actualCount, 2);
  const session = {
    sourceFile,
    sourcePath: sourceFile.path,
    editor: sourceEditor,
    sourceContent,
    cursor: { line: 0, ch: 3 },
    scroll: null,
    discovery,
  };
  assert.equal(await plugin.commitTaskMoveSession(session, { file: destinationFile }), true);
  assert.equal(sourceEditor.content, "- [ ] #task Stay ^stay");
  const destLines = destinationEditor.content.split("\n");
  const firstMovedLine = destLines.findIndex((line) => line.includes("^one"));
  assert.notEqual(firstMovedLine, -1);
  assert.equal(destLines[firstMovedLine - 1], "");
  assert.equal(destLines[firstMovedLine], "- [ ] #task One [id:: Dest__one] ^one");
  assert.deepEqual(destLines.slice(firstMovedLine, firstMovedLine + 3), [
    "- [ ] #task One [id:: Dest__one] ^one",
    "  child one",
    "- [ ] #task Two [id:: Dest__two] ^two",
  ]);
  assert.match(notices.at(-1), /Moved 2 tasks to Dest/);

  const focusEditor = new TransactionEditor(destinationEditor.content, { line: 0, ch: 0 });
  const { plugin: focusPlugin } = createTaskMoveDestinationFocusHarness({
    getActiveMarkdownView: () => ({ file: destinationFile, editor: focusEditor }),
  });
  assert.equal(
    await focusPlugin.focusTaskMoveDestination(destinationFile, {
      line: firstMovedLine,
      text: destLines[firstMovedLine],
      blockId: "one",
    }),
    true,
  );
  assert.deepEqual(focusEditor.getCursor(), { line: firstMovedLine, ch: 0 });
});

