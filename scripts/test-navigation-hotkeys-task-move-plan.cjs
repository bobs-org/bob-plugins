const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  helpers,
} = require("./navigation-hotkeys-harness.cjs");

test("task moves carry the Depends-On line and repath stranded same-note links", () => {
  const source = [
    "- [ ] #task One [dependsOn:: Source__two] ^one",
    "  - ⛓️ **DEPENDS ON:** [[#^two]]",
    "- [ ] #task Two ^two",
  ].join("\n");
  const destination = [
    "---",
    'type: "[[project]]"',
    "status: waiting",
    "---",
    "## Tasks",
    "",
  ].join("\n");
  const discovery = helpers.discoverMovableObsidianTaskTargets(source, 0, 0);
  const plan = helpers.planTaskMoveAcrossFiles({
    sourcePath: "Source.md",
    destinationPath: "Dest.md",
    sourceContent: source,
    destinationContent: destination,
    targets: discovery.targets,
  });
  assert.equal(plan.valid, true, plan.error);
  const nextDestination = plan.changes.get("Dest.md").after;
  assert.match(
    nextDestination,
    /\[dependsOn:: Source__two\]/,
  );
  assert.match(
    nextDestination,
    /⛓️ \*\*DEPENDS ON:\*\* \[\[Source#\^two\]\]/,
  );
  const nextSource = plan.changes.get("Source.md").after;
  assert.doesNotMatch(nextSource, /#task One/);
  assert.match(nextSource, /- \[ \] #task Two \^two/);
});

test("task moves keep pathless links when the target moves along", () => {
  const source = [
    "- [ ] #task One [dependsOn:: Source__two] ^one",
    "  - ⛓️ **DEPENDS ON:** [[#^two]]",
    "- [ ] #task Two ^two",
  ].join("\n");
  const destination = [
    "---",
    'type: "[[project]]"',
    "status: waiting",
    "---",
    "## Tasks",
    "",
  ].join("\n");
  const discovery = helpers.discoverMovableObsidianTaskTargets(source, 0, 1);
  const plan = helpers.planTaskMoveAcrossFiles({
    sourcePath: "Source.md",
    destinationPath: "Dest.md",
    sourceContent: source,
    destinationContent: destination,
    targets: discovery.targets,
  });
  assert.equal(plan.valid, true, plan.error);
  const nextDestination = plan.changes.get("Dest.md").after;
  assert.match(
    nextDestination,
    /⛓️ \*\*DEPENDS ON:\*\* \[\[#\^two\]\]/,
  );
  assert.match(nextDestination, /\[dependsOn:: Dest__two\]/);
});

test("counted task moves discover movable tasks without wrapping or examples", () => {
  const lines = [
    "---",
    "example: - [ ] #task YAML",
    "---",
    "- [ ] #task Start ^start",
    "prose",
    "- [x] #task Done ^done",
    "- [ ] #task Lifecycle ^prj",
    "```md",
    "- [ ] #task Fenced ^fake",
    "```",
    "- [?] #task Custom ^custom",
  ];
  const content = lines.join("\n");
  const result = helpers.discoverMovableObsidianTaskTargets(content, 3, 3);
  assert.equal(result.valid, true);
  assert.equal(result.requestedCount, 4);
  assert.equal(result.actualCount, 3);
  assert.equal(result.clamped, true);
  assert.deepEqual(
    result.targets.map((target) => target.line),
    [3, 5, 10],
  );
  assert.match(
    helpers.discoverMovableObsidianTaskTargets(content, 6, 0).error,
    /lifecycle/,
  );
  assert.match(
    helpers.discoverMovableObsidianTaskTargets(content, 4, 0).error,
    /real #task/,
  );
});

test("task move ranges preserve quoted subtrees and collapse overlapping selections", () => {
  const content = [
    "Intro",
    "> - [ ] #task Parent ^parent",
    ">   Explanation",
    ">",
    ">   - [x] #task Child ^child",
    ">     - ![[#^dependency]]",
    "> - [ ] #task Sibling ^sibling",
    "Tail",
  ].join("\n");
  const discovery = helpers.discoverMovableObsidianTaskTargets(content, 1, 1);
  assert.deepEqual(
    discovery.targets.map((target) => target.line),
    [1, 4],
  );
  const ranges = helpers.buildTaskMoveRanges(content, discovery.targets);
  assert.equal(ranges.valid, true);
  assert.equal(ranges.ranges.length, 1);
  assert.deepEqual(ranges.ranges[0].selectedTargetLines, [1, 4]);
  assert.deepEqual(helpers.rebaseTaskMoveBlock(ranges.ranges[0]), [
    "- [ ] #task Parent ^parent",
    "  Explanation",
    "",
    "  - [x] #task Child ^child",
    "    - ![[#^dependency]]",
  ]);

  const childTarget = { line: 4, rawLine: content.split("\n")[4] };
  const childRange = helpers.buildTaskMoveRanges(content, [childTarget]);
  assert.deepEqual(helpers.rebaseTaskMoveBlock(childRange.ranges[0]), [
    "- [x] #task Child ^child",
    "  - ![[#^dependency]]",
  ]);
});

test("task move removal handles disjoint ranges, blank seams, and CRLF", () => {
  const content = [
    "Before",
    "",
    "- [ ] #task One",
    "  child",
    "",
    "- [/] #task Two",
    "",
    "After",
    "",
  ].join("\r\n");
  const discovery = helpers.discoverMovableObsidianTaskTargets(content, 2, 1);
  const ranges = helpers.buildTaskMoveRanges(content, discovery.targets);
  const removed = helpers.removeTaskMoveRanges(content, ranges.ranges);
  assert.equal(removed.valid, true);
  assert.equal(removed.content, "Before\r\n\r\nAfter\r\n");
  assert.equal(removed.nextLine, 2);
});

test("task move destinations include areas and only open projects", () => {
  const files = [
    { path: "z/Waiting.md", basename: "Waiting" },
    { path: "Source.md", basename: "Source" },
    { path: "a/Area.md", basename: "Area" },
    { path: "b/Wip.md", basename: "Wip" },
    { path: "c/Done.md", basename: "Done" },
    { path: "d/Unknown.md", basename: "Unknown" },
    { path: "_templates/new_project.md", basename: "new_project" },
  ];
  const info = new Map([
    ["z/Waiting.md", helpers.getChildNoteInfo({ type: "[[project]]", status: "waiting" })],
    ["Source.md", helpers.getChildNoteInfo({ type: "[[area]]" })],
    ["a/Area.md", helpers.getChildNoteInfo({ type: "[[area]]" })],
    ["b/Wip.md", helpers.getChildNoteInfo({ type: "[[project]]", status: "wip" })],
    ["c/Done.md", helpers.getChildNoteInfo({ type: "[[project]]", status: "done" })],
    ["d/Unknown.md", helpers.getChildNoteInfo({ type: "[[project]]", status: "mystery" })],
    ["_templates/new_project.md", helpers.getChildNoteInfo({ type: "[[area]]" })],
  ]);
  const destinations = helpers.collectTaskMoveDestinations(
    files,
    "Source.md",
    (file) => info.get(file.path),
  );
  assert.deepEqual(
    destinations.map((entry) => entry.file.path),
    ["a/Area.md", "b/Wip.md", "z/Waiting.md"],
  );
  assert.match(
    helpers.getChildNoteSearchText(
      destinations[0].file,
      destinations[0].noteInfo,
    ),
    /area/,
  );
  assert.match(
    helpers.getChildNoteSearchText(
      destinations[2].file,
      destinations[2].noteInfo,
    ),
    /waiting/,
  );
});

