const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const originalLoad = Module._load;
function parseTestYaml(text) {
  const result = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#") || /^\s/.test(line)) {
      continue;
    }
    const match = /^([^:]+):(.*)$/.exec(line);
    if (!match) {
      throw new Error("malformed yaml");
    }
    const key = match[1].trim();
    let value = match[2].trim().replace(/\s+#.*$/, "");
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value || null;
  }
  return result;
}

Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    class EmptyClass {}
    return {
      MarkdownView: EmptyClass,
      Modal: EmptyClass,
      Notice: EmptyClass,
      Plugin: EmptyClass,
      parseYaml: parseTestYaml,
    };
  }
  if (request === "@codemirror/view") {
    return { EditorView: class EditorView {} };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const NavigationHotkeysPlugin = require("../plugins/bob-navigation-hotkeys/main.js");
const { helpers } = NavigationHotkeysPlugin;
Module._load = originalLoad;

test("project schedule validation accepts only real YYYY-MM-DD dates", () => {
  assert.equal(helpers.validateProjectScheduledDate("2028-02-29").valid, true);
  assert.equal(helpers.validateProjectScheduledDate("2026-02-29").valid, false);
  assert.equal(helpers.validateProjectScheduledDate("2026-7-10").valid, false);
  assert.equal(helpers.validateProjectScheduledDate("").valid, false);
});

test("source task schedule is extracted without losing task metadata", () => {
  const parsed = helpers.parseProjectSourceTaskLine(
    "- [/] #task Ship it [scheduled:: 2026-07-16] [p::3] ^ship-it",
  );
  assert.deepEqual(
    {
      description: parsed.description,
      priority: parsed.priority,
      blockId: parsed.blockId,
      status: parsed.status,
      scheduled: parsed.scheduled,
      scheduleError: parsed.scheduleError,
    },
    {
      description: "Ship it",
      priority: "3",
      blockId: "ship-it",
      status: "/",
      scheduled: "2026-07-16",
      scheduleError: null,
    },
  );

  const extracted = helpers.extractProjectSourceSchedule(
    "Ship [scheduled:: 2026-07-16] [created:: 2026-07-01]",
  );
  assert.equal(extracted.scheduled, "2026-07-16");
  assert.equal(extracted.description, "Ship  [created:: 2026-07-01]");
});

test("source task schedule errors are focused and ambiguous fields fail", () => {
  const invalid = helpers.parseProjectSourceTaskLine(
    "- [ ] #task Ship [scheduled:: 2026-02-30]",
  );
  assert.match(invalid.scheduleError, /not a valid calendar date/);

  const ambiguous = helpers.parseProjectSourceTaskLine(
    "- [ ] #task Ship [scheduled:: 2026-07-16] [scheduled:: 2026-07-17]",
  );
  assert.match(ambiguous.scheduleError, /multiple/);
});

test("project creation frontmatter receives source scheduling atomically", () => {
  assert.deepEqual(
    helpers.applyProjectCreationFrontmatter(
      {},
      "[[Parent]]",
      "2026-07-16",
    ),
    {
      parent: "[[Parent]]",
      type: "[[project]]",
      status: "wip",
      scheduled: "2026-07-16",
    },
  );
  assert.deepEqual(
    helpers.applyProjectCreationFrontmatter({}, "[[Parent]]"),
    { parent: "[[Parent]]", type: "[[project]]", status: "wip" },
  );
});

test("future schedule labels use local date-only boundaries", () => {
  const now = new Date(2026, 6, 10, 23, 45);
  assert.deepEqual(
    helpers.getFutureProjectSchedule("2026-07-11", now),
    { scheduled: true, date: "2026-07-11", label: "Tomorrow" },
  );
  assert.equal(
    helpers.getFutureProjectSchedule("2026-07-16", now).label,
    "Jul 16",
  );
  assert.equal(
    helpers.getFutureProjectSchedule("2027-07-16", now).label,
    "Jul 16, 2027",
  );
  for (const value of ["2026-07-10", "2026-07-09", "2026-02-30"]) {
    assert.equal(helpers.getFutureProjectSchedule(value, now).scheduled, false);
  }
});

test("picker metadata exposes future schedules to badges, search, and summary", () => {
  const now = new Date(2026, 6, 10, 12);
  const future = helpers.getChildNoteInfo(
    { type: "[[project]]", status: "wip", scheduled: "2026-07-11" },
    now,
  );
  const due = helpers.getChildNoteInfo(
    { type: "[[project]]", status: "done", scheduled: "2026-07-10" },
    now,
  );
  assert.equal(future.scheduled, true);
  assert.equal(due.scheduled, false);

  const file = { path: "Projects/Future.md", basename: "Future" };
  const search = helpers.getChildNoteSearchText(file, future);
  assert.match(search, /scheduled/);
  assert.match(search, /2026-07-11/);
  assert.match(search, /tomorrow/);

  const summary = helpers.getChildNoteSummary(
    [file, { path: "Projects/Due.md", basename: "Due" }],
    new Map([
      [file.path, future],
      ["Projects/Due.md", due],
    ]),
  );
  assert.ok(summary.includes("1 future-scheduled"));
});

test("project lifecycle task classification requires unfenced #task with trailing ^prj", () => {
  for (const line of [
    "- [ ] #task Legacy project ^prj",
    "- [/] #task #prj Current project #hide ^prj",
    "> 1. [x] #task Quoted ordered project ^prj",
  ]) {
    assert.equal(helpers.isProjectLifecycleTaskLine(line), true, line);
  }
  for (const line of [
    "- [ ] Ordinary task ^prj",
    "- Project-shaped prose #task ^prj",
    "- [ ] #task Non-trailing ^prj notes",
    "- [ ] #task Other anchor ^project",
    "- [ ] #taskish Wrong tag ^prj",
  ]) {
    assert.equal(helpers.isProjectLifecycleTaskLine(line), false, line);
  }

  const content = [
    "---",
    "type: \"[[project]]\"",
    "- [ ] #task YAML example ^prj",
    "---",
    "```md",
    "- [ ] #task Fenced example ^prj",
    "```",
    "- [ ] #task Real project ^prj",
  ].join("\n");
  assert.equal(helpers.isProjectLifecycleTaskAtLine(content, 2), false);
  assert.equal(helpers.isProjectLifecycleTaskAtLine(content, 5), false);
  assert.equal(helpers.isProjectLifecycleTaskAtLine(content, 7), true);
});

test("property targets use project YAML only for scheduled on ^prj", () => {
  const config = {
    properties: [
      { name: "scheduled", values: "date" },
      { name: "dependsOn", values: "local_task_id" },
    ],
  };
  const project = [
    "---",
    "type: [[project]]",
    "scheduled: 2026-07-16",
    "---",
    "- [ ] #task Ship [scheduled:: 2026-07-15] [dependsOn:: prep] ^prj",
  ].join("\n");
  const context = helpers.getProjectNotePropertyContext(project, 4);
  assert.equal(context.valid, true);
  const items = helpers.createBulletPropertyItems(
    config,
    project.split("\n")[4],
    context,
  );
  assert.deepEqual(
    items.map((item) => [item.property.name, item.target.kind, item.currentValue]),
    [
      ["scheduled", "project-frontmatter", "2026-07-16"],
      ["dependsOn", "inline", "prep"],
    ],
  );

  const ordinaryLine = "- [ ] #task Follow up [scheduled:: 2026-07-15]";
  const ordinary = helpers.createBulletPropertyItems(config, ordinaryLine, {});
  assert.equal(ordinary[0].target.kind, "inline");
  assert.equal(ordinary[0].currentValue, "2026-07-15");

  const unscheduledProject = project.replace("scheduled: 2026-07-16\n", "");
  const unscheduledContext = helpers.getProjectNotePropertyContext(
    unscheduledProject,
    3,
  );
  assert.equal(unscheduledContext.valid, true);
  const unscheduledItems = helpers.createBulletPropertyItems(
    config,
    unscheduledProject.split("\n")[3],
    unscheduledContext,
  );
  const unscheduledItem = unscheduledItems.find(
    (item) => item.property.name === "scheduled",
  );
  assert.equal(unscheduledItem.target.kind, "project-frontmatter");
  assert.equal(unscheduledItem.defined, false);
  assert.equal(unscheduledItem.currentValue, "");

  const malformed = project.replace("2026-07-16", "2026-02-30");
  const malformedContext = helpers.getProjectNotePropertyContext(malformed, 4);
  assert.equal(malformedContext.valid, false);
  assert.match(malformedContext.error, /valid calendar date/);
});

test("project schedule update coordinates YAML, inline cleanup, and visibility", () => {
  const input = [
    "---",
    "type: \"[[project]]\"",
    "status: wip",
    "---",
    "- [ ] #task Ship [scheduled:: 2026-07-12] [p:: 1] ^prj",
    "- [/] #task Work #hide #hide ^work",
  ].join("\n");
  const result = helpers.planProjectScheduledUpdate(
    input,
    4,
    "2026-07-16",
    new Date(2026, 6, 11, 23, 59),
  );
  assert.equal(result.valid, true);
  assert.equal(result.cursorLine, 5);
  assert.equal(
    result.content,
    [
      "---",
      "type: \"[[project]]\"",
      "status: wip",
      "scheduled: 2026-07-16",
      "---",
      "- [ ] #task Ship [p:: 1] #hide ^prj",
      "- [/] #task Work #hide ^work",
    ].join("\n"),
  );

  const deleted = helpers.planProjectScheduledDelete(result.content, 5);
  assert.equal(deleted.valid, true);
  assert.equal(deleted.cursorLine, 4);
  assert.doesNotMatch(deleted.content, /^scheduled:/m);
  assert.match(deleted.content, /Ship \[p:: 1\] #hide \^prj/);
  assert.match(deleted.content, /Work #hide \^work/);
});

test("future schedule normalizes every real Markdown task to one #hide", () => {
  const input = [
    "---",
    "type: [[project]]",
    "---",
    "- [ ] #task Ship [p:: 1] ^prj",
    "  - [/] #task Nested ^nested",
    "1. [x] Completed #hide",
    "> - [-] Canceled #hidden",
    "- [*] #task Next #hide #hide   ",
    "```md",
    "- [ ] fenced example",
    "```",
    "This mentions - [ ] checkbox prose",
  ].join("\r\n");
  const result = helpers.planProjectScheduleVisibility(
    input,
    "2026-07-12",
    new Date(2026, 6, 11, 23, 59),
  );
  assert.equal(result.valid, true);
  assert.equal(result.taskCount, 5);
  assert.equal(result.content.includes("\r\n"), true);
  assert.match(result.content, /\[p:: 1\] #hide \^prj/);
  assert.match(result.content, /Nested #hide \^nested/);
  assert.match(result.content, /Completed #hide/);
  assert.match(result.content, /Canceled #hidden #hide/);
  assert.match(result.content, /Next #hide   \r\n/);
  assert.match(result.content, /```md\r\n- \[ \] fenced example\r\n```/);
  assert.match(result.content, /This mentions - \[ \] checkbox prose/);
  for (const task of helpers.getRealMarkdownTaskLines(result.content)) {
    assert.equal(
      helpers.getWholeTaskTagSpans(task.text, "#hide").length,
      1,
      task.text,
    );
  }
  assert.equal(
    helpers.planProjectScheduleVisibility(
      result.content,
      "2026-07-12",
      new Date(2026, 6, 11),
    ).changed,
    false,
  );
});

test("today and past schedules show ordinary tasks and honor the ^prj exception", () => {
  const multiple = [
    "---",
    "type: [[project]]",
    "---",
    "- [ ] #task Ship #hide #hide ^prj",
    "- [x] Done #hidden #hide",
    "- [-] Canceled #hide",
  ].join("\n");
  for (const date of ["2026-07-11", "2026-07-10"]) {
    const shown = helpers.planProjectScheduleVisibility(
      multiple,
      date,
      new Date(2026, 6, 11, 0, 1),
    );
    assert.match(shown.content, /Ship #hide #hide \^prj/);
    assert.match(shown.content, /Done #hidden$/m);
    assert.match(shown.content, /Canceled$/m);
  }

  const sole = [
    "---",
    "type: [[project]]",
    "---",
    "- [ ] #task Ship #hide #hide ^prj",
  ].join("\n");
  const shownSole = helpers.planProjectScheduleVisibility(
    sole,
    "2026-07-11",
    new Date(2026, 6, 11, 23, 59),
  );
  assert.match(shownSole.content, /Ship \^prj$/);
  assert.doesNotMatch(shownSole.content, /#hide/);
});

test("schedule deletion removes stale inline fields without changing visibility", () => {
  const input = [
    "---",
    "type: [[project]]",
    "scheduled: '2026-07-16'",
    "---",
    "- [ ] #task Ship #hide [scheduled:: 2026-07-15] [p:: 2] [scheduled:: old] ^prj",
    "- [ ] #task Work #hide",
  ].join("\r\n");
  const deleted = helpers.planProjectScheduledDelete(input, 4);
  assert.equal(deleted.valid, true);
  assert.equal(
    deleted.content,
    [
      "---",
      "type: [[project]]",
      "---",
      "- [ ] #task Ship #hide [p:: 2] ^prj",
      "- [ ] #task Work #hide",
    ].join("\r\n"),
  );
});

test("dependency bullets render one canonical transclusion per target", () => {
  assert.equal(
    helpers.formatDependencyNavigationBullet(["a", "b"], "\t"),
    "\t- ![[#^a]]\n\t- ![[#^b]]",
  );
  assert.equal(
    helpers.formatDependencyNavigationBullet(
      { blockId: "remote", note: "projects/Other" },
      "  ",
    ),
    "  - ![[projects/Other#^remote]]",
  );
  assert.deepEqual(
    helpers.parseDependencyTransclusionBulletDetails("  - ![[Other#^remote]]"),
    {
      indent: "  ",
      marker: "-",
      note: "Other",
      blockId: "remote",
      blockIds: ["remote"],
      transcluded: true,
      terminal: false,
    },
  );
  assert.deepEqual(
    helpers.parseDependencyTransclusionBulletDetails(
      "\t- ~~[[Other#^remote]]~~",
    ),
    {
      indent: "\t",
      marker: "-",
      note: "Other",
      blockId: "remote",
      blockIds: ["remote"],
      transcluded: false,
      terminal: true,
    },
  );
});

test("dependency IDs encode root and nested Markdown paths deterministically", () => {
  assert.equal(helpers.dependencyId("cash.md", "unemployment"), "cash__unemployment");
  assert.equal(
    helpers.dependencyId("projects\\Shared.md", "review"),
    "projects__Shared__review",
  );
  assert.equal(
    helpers.dependencyId("done/team/Archive.md", "ship"),
    "done__team__Archive__ship",
  );
  assert.throws(() => helpers.dependencyId("My Notes.md", "ship"), /unsupported/);
});

test("dependency sync splits legacy bullets and protects unrelated transclusions", () => {
  const input = [
    "- [ ] #task Parent [dependsOn:: a, b] ^parent",
    "  - 🔗 **DEPENDS ON:** [[#^a]] • [[#^b]]",
    "  - ![[ref/chat/example#^ref]]",
    "- [ ] #task A [id:: a] ^a",
    "- [ ] #task B [id:: b] ^b",
  ].join("\n");
  const plan = helpers.planDependencyNavigationBulletSync(input, 0, ["a", "b"]);
  assert.equal(plan.operation, "rewrite");
  assert.deepEqual(plan.lineTexts, ["  - ![[#^a]]", "  - ![[#^b]]"]);

  const canonical = [
    "- [ ] #task Parent [dependsOn:: a, b] ^parent",
    "  - ![[#^a]]",
    "  - ![[#^b]]",
    "  - ![[ref/chat/example#^ref]]",
    "- [ ] #task A [id:: a] ^a",
    "- [ ] #task B [id:: b] ^b",
  ].join("\n");
  const collection = helpers.collectDependencyNavigationBullets(canonical, 0);
  assert.deepEqual(collection.blockIds, ["a", "b"]);
  assert.deepEqual(collection.lineIndices, [1, 2]);
  assert.equal(
    helpers.planDependencyNavigationBulletSync(canonical, 0, ["a", "b"]).changed,
    false,
  );
});

test("dependency sync inserts, removes, and preserves arbitrary child bullets", () => {
  const propertyOnly = [
    "- Parent [dependsOn:: a]",
    "  - Keep me",
    "- [ ] #task A [id:: a] ^a",
  ].join("\n");
  const insert = helpers.planDependencyNavigationBulletSync(propertyOnly, 0, ["a"]);
  assert.equal(insert.operation, "insert");
  assert.equal(insert.insertLine, 1);
  assert.equal(insert.lineText, "  - ![[#^a]]");

  const canonical = propertyOnly.replace(
    "  - Keep me",
    "  - ![[#^a]]\n  - Keep me",
  );
  const remove = helpers.planDependencyNavigationBulletSync(
    canonical.replace("[dependsOn:: a]", "[dependsOn:: ]"),
    0,
    [],
    { managedBlockIds: ["a"] },
  );
  assert.equal(remove.operation, "delete");
  assert.deepEqual(remove.deleteLines, [1]);

  const mixedIndent = [
    "- [ ] #task Parent [dependsOn:: a]",
    "  - 🔗 **DEPENDS ON:** [[#^a]]",
    "\t- arbitrary child",
    "- [ ] #task A [id:: a] ^a",
  ].join("\n");
  const mixedPlan = helpers.planDependencyNavigationBulletSync(
    mixedIndent,
    0,
    ["a"],
  );
  assert.equal(mixedPlan.operation, "rewrite");
  assert.equal(mixedPlan.replaceLine, 1);

  const nested = [
    "- [ ] #task Parent [dependsOn:: a]",
    "  - arbitrary child",
    "    - ![[#^a]]",
    "- [ ] #task A [id:: a] ^a",
  ].join("\n");
  const nestedCollection = helpers.collectDependencyNavigationBullets(nested, 0);
  assert.deepEqual(nestedCollection.blockIds, []);
  assert.equal(
    helpers.planDependencyNavigationBulletSync(nested, 0, ["a"]).operation,
    "insert",
  );
});

test("dependency sync preserves terminal struck dependencies and protects unrelated strikes", () => {
  const input = [
    "- [ ] #task Parent [dependsOn:: a, b] ^parent",
    "  - ~~[[#^a]]~~",
    "  - ~~[[#^ref]]~~",
    "- [x] #task A [id:: a] ^a",
    "- [ ] #task B [id:: b] ^b",
  ].join("\n");
  const collection = helpers.collectDependencyNavigationBullets(input, 0);
  assert.deepEqual(collection.blockIds, ["a"]);
  assert.deepEqual(collection.lineIndices, [1]);

  const plan = helpers.planDependencyNavigationBulletSync(input, 0, ["a", "b"]);
  assert.equal(plan.operation, "rewrite");
  assert.deepEqual(plan.lineTexts, ["  - ~~[[#^a]]~~", "  - ![[#^b]]"]);

  const canonical = [
    "- [ ] #task Parent [dependsOn:: a, b] ^parent",
    "  - ~~[[#^a]]~~",
    "  - ![[#^b]]",
    "  - ~~[[#^ref]]~~",
    "- [x] #task A [id:: a] ^a",
    "- [ ] #task B [id:: b] ^b",
  ].join("\n");
  assert.equal(
    helpers.planDependencyNavigationBulletSync(canonical, 0, ["a", "b"])
      .changed,
    false,
  );

  const remove = helpers.planDependencyNavigationBulletSync(
    canonical.replace("[dependsOn:: a, b]", "[dependsOn:: ]"),
    0,
    [],
    { managedBlockIds: ["a", "b"] },
  );
  assert.equal(remove.operation, "delete");
  assert.deepEqual(remove.deleteLines, [1, 2]);
});

test("same-file dependency toggle synchronizes dependsOn and target id", () => {
  const input = [
    "- [ ] #task Parent ^parent",
    "  - [[#^child]]",
    "- [ ] #task Child ^child",
  ].join("\n");
  const added = helpers.planSameFileDependencyToggle(
    input,
    1,
    "  - ![[#^child]]",
    "projects/Here.md",
  );
  assert.equal(added.qualified, true);
  assert.match(added.content, /Parent \[dependsOn:: projects__Here__child\] \^parent/);
  assert.match(added.content, /Child \[id:: projects__Here__child\] \^child/);

  const removed = helpers.planSameFileDependencyToggle(
    added.content,
    1,
    "  - [[#^child]]",
    "projects/Here.md",
  );
  assert.equal(removed.qualified, true);
  assert.doesNotMatch(removed.content, /dependsOn/);
  assert.match(removed.content, /Child \[id:: projects__Here__child\] \^child/);

  const unrelated = helpers.planSameFileDependencyToggle(
    input.replace("[[#^child]]", "[[#^ref]]"),
    1,
    "  - ![[#^ref]]",
  );
  assert.equal(unrelated.qualified, false);
});

test("runtime dependency toggle synchronizes a cross-file target", async () => {
  class TestEditor {
    constructor(content) {
      this.content = content;
    }
    getValue() {
      return this.content;
    }
    replaceRange(text, from, to = from) {
      const offset = (position) => {
        const lines = this.content.split("\n");
        return (
          lines.slice(0, position.line).reduce((sum, line) => sum + line.length + 1, 0) +
          position.ch
        );
      };
      const start = offset(from);
      const end = offset(to);
      this.content = this.content.slice(0, start) + text + this.content.slice(end);
    }
  }

  const activeFile = { path: "Here.md", extension: "md" };
  const targetFile = { path: "Other.md", extension: "md" };
  let targetContent = "- [ ] #task Target ^target";
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => activeFile },
    metadataCache: {
      getFirstLinkpathDest: (target) => (target === "Other" ? targetFile : null),
    },
    vault: {
      cachedRead: async () => targetContent,
      getAbstractFileByPath: (filePath) =>
        filePath === activeFile.path ? activeFile : null,
      process: async (_file, transform) => {
        targetContent = transform(targetContent);
      },
    },
  };
  const editor = new TestEditor(
    "- [ ] #task Parent ^parent\n  - [[Other#^target]]",
  );
  assert.equal(
    await plugin.applyDependencyAwareTransclusionChanges(editor, [
      { line: 1, nextLineText: "  - ![[Other#^target]]" },
    ]),
    true,
  );
  assert.match(editor.content, /Parent \[dependsOn:: Other__target\] \^parent/);
  assert.match(targetContent, /Target \[id:: Other__target\] \^target/);

  assert.equal(
    await plugin.applyDependencyAwareTransclusionChanges(editor, [
      { line: 1, nextLineText: "  - [[Other#^target]]" },
    ]),
    true,
  );
  assert.doesNotMatch(editor.content, /dependsOn/);
  assert.match(targetContent, /Target \[id:: Other__target\] \^target/);
});

test("counted transclusion toggle evaluates each line independently", () => {
  const result = helpers.toggleLineRangeTransclusions(
    ["- [[a]] and ![[b]]", "- ![[c]]"],
    0,
    1,
  );
  assert.deepEqual(
    result.changesByLine.map((change) => change.nextLineText),
    ["- ![[a]] and ![[b]]", "- [[c]]"],
  );
  assert.equal(
    helpers.toggleLineTransclusions("prefix [[a]] and [[b]]").line,
    "prefix ![[a]] and ![[b]]",
  );
});

test("migration transform handles tasks, plain bullets, cross-note targets, and idempotency", () => {
  const input = [
    "- [ ] #task Parent [dependsOn:: a, remote, missing]",
    "  - 🔗 **DEPENDENCIES:** [[#^a]] • [[#^remote]]",
    "- Plain parent [dependsOn:: a]",
    "\t- arbitrary child",
    "- [ ] #task A [id:: a] ^a",
  ].join("\n");
  const resolutions = new Map([
    ["a", { filePath: "Here.md", blockId: "a" }],
    ["remote", { filePath: "folder/Other.md", blockId: "actual" }],
  ]);
  const migrated = helpers.transformDependencyBulletsInContent(
    input,
    "Here.md",
    resolutions,
  );
  assert.equal(migrated.changed, true);
  assert.match(migrated.content, /  - !\[\[#\^a\]\]/);
  assert.match(migrated.content, /  - !\[\[Other#\^actual\]\]/);
  assert.match(migrated.content, /- Plain parent \[dependsOn:: a\]\n\t- !\[\[#\^a\]\]/);
  assert.equal(migrated.unresolved.length, 1);
  assert.equal(migrated.unresolved[0].id, "missing");
  const second = helpers.transformDependencyBulletsInContent(
    migrated.content,
    "Here.md",
    resolutions,
  );
  assert.equal(second.changed, false);
});
