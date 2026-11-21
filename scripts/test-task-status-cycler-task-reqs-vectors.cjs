// Task requirement (RQ) and task block layout (RL) twins (bob-cli-on.10.1.1):
// every bob-cli RQ and RL vector runs through the built cycler's exported
// helpers. bob-cli owns the fixtures; the plugin copies them byte for byte.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { helpers } = require("./task-status-cycler-harness.cjs");

const {
  TASK_REQ_MAX_DEPTH,
  taskReqForest,
  taskReqNoteTasks,
  taskReqOwnerOfLine,
  taskReqIsReqLine,
  taskReqPathText,
  taskReqRowKey,
  taskReqCheckboxMarkWithoutFilter,
  taskReqForestForOwner,
  taskBlockClassifyChild,
  taskBlockZoneOf,
  taskBlockFindTask,
  taskBlockInsertionSlot,
  taskBlockLayoutViolations,
  taskBlockPlanTidy,
  taskBlockNoteHome,
  taskBlockEnsureNotesDrawer,
  taskBlockDrawerHeaderOffset,
  taskBlockScoopLooseNotes,
} = helpers;

const FIXTURE_DIR = path.join(__dirname, "../plugins/task-status-cycler/scripts/fixtures/task_reqs");
const CANONICAL_DIR = path.join(__dirname, "..", "..", "..", "..", "..", "tests", "fixtures", "task_reqs");
const readFixture = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8"));
const vectors = readFixture("vectors.json");
const layout = readFixture("layout.json");

function sourceOf(testCase) {
  const ending = testCase.eol === "crlf" ? "\r\n" : "\n";
  return testCase.source_lines.join(ending) + ending;
}

function linesOf(contents) {
  const text = contents.endsWith("\n") ? contents.slice(0, -1) : contents;
  return text.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
}

function digest8(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex").slice(0, 8);
}

function taskAt(contents, testCase) {
  const task = taskBlockFindTask(contents, testCase.task - 1);
  assert.ok(task, `${testCase.id} has a task at line ${testCase.task}`);
  return task;
}

function nodeJson(node) {
  const json = {
    line: node.line,
    depth: node.depth,
    parent: node.parent,
    owner: node.owner,
    mark: node.mark,
    state: node.state,
    text: node.text,
    anchor: node.anchor,
    path: taskReqPathText(node),
    subtree_end: node.subtreeEndIndex + 1,
    notes: node.noteRangeIndexes.map(([start, end]) => [start + 1, end + 1]),
  };
  if (node.state === "excluded") {
    json.excluded_by = node.excludedBy;
    json.excluded_because = node.excludedBecause;
  }
  if (node.depth_exceeded) json.depth_exceeded = true;
  return json;
}

test("fixture copies match bob-cli byte for byte when the bob-cli checkout is present", (t) => {
  if (!fs.existsSync(CANONICAL_DIR)) {
    t.skip("bob-cli fixtures are not beside this checkout");
    return;
  }
  for (const name of ["README.md", "vectors.json", "layout.json"]) {
    assert.ok(
      fs.readFileSync(path.join(FIXTURE_DIR, name)).equals(fs.readFileSync(path.join(CANONICAL_DIR, name))),
      `${name} is a byte-for-byte copy of bob-cli's fixture`,
    );
  }
});

test("RQ fixture lists every case in order and pins the depth bound", () => {
  assert.equal(vectors.schema_version, 1);
  assert.equal(vectors.max_depth, TASK_REQ_MAX_DEPTH);
  vectors.cases.forEach((testCase, index) => assert.equal(testCase.id, `RQ${index + 1}`));
});

for (const testCase of vectors.cases) {
  test(`${testCase.id} ${testCase.title}`, () => {
    const contents = sourceOf(testCase);
    const forest = taskReqForest(contents);
    assert.deepEqual(forest.map(nodeJson), testCase.expect.nodes, `${testCase.id} nodes`);
    // The per-owner entry point agrees with the whole-note forest.
    const perOwner = taskReqNoteTasks(contents).flatMap((task) => taskReqForestForOwner(contents, task.lineIndex));
    assert.deepEqual(perOwner.map(nodeJson), testCase.expect.nodes, `${testCase.id} per-owner nodes`);
    for (const probe of testCase.expect.probes || []) {
      const index = probe.line - 1;
      assert.equal(
        taskReqOwnerOfLine(contents, index),
        probe.owner === null ? null : probe.owner - 1,
        `${testCase.id} owner at line ${probe.line}`,
      );
      assert.equal(taskReqIsReqLine(contents, index), probe.is_req, `${testCase.id} is_req at line ${probe.line}`);
    }
    if (testCase.expect.assert_distinct_keys) {
      const ownerKey = testCase.expect.owner_key;
      const keys = forest.map((node) => {
        const key = taskReqRowKey(ownerKey, node, digest8);
        assert.ok(key.startsWith(`${ownerKey}/req/${taskReqPathText(node)}~`), `${testCase.id} key shape ${key}`);
        assert.match(key.split("~").pop(), /^[0-9a-f]{8}$/, `${testCase.id} key digest ${key}`);
        return key;
      });
      assert.equal(new Set(keys).size, forest.length, `${testCase.id} distinct row keys`);
    }
  });
}

test("RL fixture ids are unique and sequential across sections", () => {
  const ids = ["slots", "violations", "tidy", "note_homes"].flatMap((section) => layout[section].map((entry) => entry.id));
  const sorted = ids.slice().sort((left, right) => Number(left.slice(2)) - Number(right.slice(2)));
  sorted.forEach((id, index) => assert.equal(id, `RL${index + 1}`));
});

const RL_RUNNERS = {
  slots(testCase) {
    const contents = sourceOf(testCase);
    const slot = taskBlockInsertionSlot(contents, taskAt(contents, testCase), testCase.kind);
    return { line: slot.lineIndex + 1, indent: slot.indent };
  },
  violations(testCase) {
    const contents = sourceOf(testCase);
    return taskBlockLayoutViolations(contents, taskAt(contents, testCase))
      .map((violation) => ({ line: violation.lineIndex + 1, kind: violation.kind }));
  },
  tidy(testCase) {
    const contents = sourceOf(testCase);
    const plan = taskBlockPlanTidy(contents, taskAt(contents, testCase));
    if (!plan) return null;
    // A tidied block has no violations and tidies to nothing.
    const tidied = taskBlockFindTask(plan.updated, testCase.task - 1);
    assert.ok(tidied, `${testCase.id} task survives tidy`);
    assert.deepEqual(taskBlockLayoutViolations(plan.updated, tidied), [], `${testCase.id} leaves no violations`);
    assert.equal(taskBlockPlanTidy(plan.updated, tidied), null, `${testCase.id} is idempotent`);
    return {
      lines: linesOf(plan.updated),
      moves: plan.moves,
      notes_filed: plan.notesFiled,
      notes_created: plan.notesCreated,
    };
  },
  note_homes(testCase) {
    const contents = sourceOf(testCase);
    const home = taskBlockNoteHome(contents, taskAt(contents, testCase));
    if (home.home === "loose") return { home: "loose", line: home.slot.lineIndex + 1, indent: home.slot.indent };
    if (home.home === "notes") return { home: "notes", line: home.drawer.line };
    return { home: "new-notes" };
  },
};

for (const [section, run] of Object.entries(RL_RUNNERS)) {
  for (const testCase of layout[section]) {
    test(`${testCase.id} ${section}: ${testCase.title}`, () => {
      assert.deepEqual(run(testCase), testCase.expect);
    });
  }
}

// --- Mirrors of bob-cli's recognizer and layout unit tests -----------------

test("every checkbox mark parses as a requirement candidate", () => {
  for (const [line, mark] of [
    ["- [ ] text", "open"],
    ["- [-] text", "dropped"],
    ["- [>] [[#^id|Alias]]", "carried"],
    ["- [x] text", "legacy-met"],
    ["- [X] text", "legacy-met"],
    ["- [?] text", "unknown"],
    ["- [/] text", "unknown"],
    ["- [ ]", "open"],
  ]) {
    assert.equal(taskReqCheckboxMarkWithoutFilter(line), mark, line);
  }
  for (const line of ["- [ ] #task Real task", "- [x] #task Done task", "- [ ]Fix missing space", "- plain note", "> - [ ] quoted", "- NOTES"]) {
    assert.equal(taskReqCheckboxMarkWithoutFilter(line), null, line);
  }
  assert.equal(taskReqCheckboxMarkWithoutFilter("\t- [ ] #taskbar item"), "open", "#taskbar is not the filter");
});

test("child kinds detect requirements before authored notes and honor a custom filter", () => {
  assert.deepEqual(taskBlockClassifyChild("\t- [ ] a requirement", null), { type: "requirement", mark: "open" });
  assert.deepEqual(taskBlockClassifyChild("\t- [?] flagged", null), { type: "requirement", mark: "unknown" });
  assert.deepEqual(taskBlockClassifyChild("\t- [ ] #task nested", null), { type: "authored" });
  assert.deepEqual(taskBlockClassifyChild("\t- [ ] #task nested", true), { type: "nested-task", open: true });
  assert.deepEqual(taskBlockClassifyChild("\t- [x] #task closed", false), { type: "nested-task", open: false });
  assert.deepEqual(taskBlockClassifyChild("\t- NOTES", null), { type: "drawer", title: "NOTES" });
  assert.deepEqual(taskBlockClassifyChild("> - [ ] quoted", null), { type: "authored" });
  assert.deepEqual(taskBlockClassifyChild("\t- [ ] #todo real", null, "#todo"), { type: "authored" });
  assert.deepEqual(taskBlockClassifyChild("\t- [ ] plain", null, "#todo"), { type: "requirement", mark: "open" });
  assert.deepEqual(taskBlockClassifyChild("\t- [ ] #todo real", true, "#todo"), { type: "nested-task", open: true });
});

test("zones name every task child kind", () => {
  for (const [line, zone] of [
    ["\t- ❌ **CANCEL LOG**", "cancel-log"],
    ["\t- ⛓️ **DEPENDS ON:** [[#^a]]", "managed-links"],
    ["\t- \u{1f9f1} **BLOCKS:** [[#^b]]", "managed-links"],
    ["\t- \u{1faa2} **LINKS:** [[#^c]]", "managed-links"],
    ["\t- \u{1faa2} **LINKED FROM:** [[#^d]]", "managed-links"],
    ["\t- \u{1f9e9} **Sub-projects:** [[P]]", "managed-links"],
    ["\t- [ ] a requirement", "reqs"],
    ["\t- [-] dropped requirement", "reqs"],
    ["\t- a plain note", "authored"],
    ["\t- [ ] #task nested task", "authored"],
    ["\t- NOTES", "drawers"],
    ["\t- FUTURE WORK", "drawers"],
    ["\t- \u{1f6e0}️ **WORK LOG**", "logs"],
    ["\t- \u{1f5d3}️ **SCHEDULE LOG**", "logs"],
    ["\t- \u{1f940} **ROTTEN LOG**", "logs"],
  ]) {
    assert.equal(taskBlockZoneOf(taskBlockClassifyChild(line, true, "#task")), zone, line);
  }
});

test("a created NOTES drawer lands first among the drawers", () => {
  const contents = [
    "- [ ] #task A ^a",
    "\t- [ ] req",
    "\t- FUTURE WORK",
    "\t\t- later",
    "\t- \u{1f6e0}️ **WORK LOG**",
    "",
  ].join("\n");
  const task = taskBlockFindTask(contents, 0);
  const ensured = taskBlockEnsureNotesDrawer(contents, task);
  assert.ok(ensured && ensured.created);
  assert.equal(ensured.drawer.title, "NOTES");
  assert.deepEqual(linesOf(ensured.updated), [
    "- [ ] #task A ^a",
    "\t- [ ] req",
    "\t- NOTES",
    "\t- FUTURE WORK",
    "\t\t- later",
    "\t- \u{1f6e0}️ **WORK LOG**",
  ]);
  assert.equal(taskBlockDrawerHeaderOffset(contents, task, false), contents.indexOf("\t- \u{1f6e0}"));
  assert.equal(taskBlockDrawerHeaderOffset(contents, task, true), contents.indexOf("\t- FUTURE"));
});

test("a note without a final newline keeps that state", () => {
  const contents = "- [ ] #task A ^a\n\t- loose\n\t- [ ] first req";
  const plan = taskBlockPlanTidy(contents, taskBlockFindTask(contents, 0));
  assert.equal(plan.updated, "- [ ] #task A ^a\n\t- [ ] first req\n\t- NOTES\n\t\t- loose");
  assert.deepEqual([plan.moves, plan.notesFiled, plan.notesCreated], [0, 1, true]);
});

test("tidy keeps a CRLF note CRLF and a done owner's block untouched", () => {
  const contents = ["- [ ] #task A ^a", "\t- loose", "\t- [ ] first req", ""].join("\r\n");
  const plan = taskBlockPlanTidy(contents, taskBlockFindTask(contents, 0));
  assert.equal(plan.updated, ["- [ ] #task A ^a", "\t- [ ] first req", "\t- NOTES", "\t\t- loose", ""].join("\r\n"));
  const done = contents.replace("- [ ]", "- [x]");
  assert.equal(taskBlockPlanTidy(done, taskBlockFindTask(done, 0)), null);
});

test("the first-req scoop files only the owner's loose notes and creates NOTES only when one moves", () => {
  const contents = [
    "- [ ] #task A ^a",
    "\t- [ ] req",
    "\t\t- req note",
    "\t- [ ] #task Nested ^n",
    "\t- loose one",
    "",
  ].join("\n");
  const scoop = taskBlockScoopLooseNotes(contents, 0);
  assert.deepEqual([scoop.filed, scoop.created], [1, true]);
  assert.deepEqual(linesOf(scoop.updated), [
    "- [ ] #task A ^a",
    "\t- [ ] req",
    "\t\t- req note",
    "\t- [ ] #task Nested ^n",
    "\t- NOTES",
    "\t\t- loose one",
  ]);
  assert.equal(taskBlockScoopLooseNotes("- [ ] #task A ^a\n\t- [ ] req\n", 0), null);
});

test("custom status types and global filter flow through the recognizer", () => {
  const contents = ["- [~] #todo Owner ^o", "\t- [ ] req", ""].join("\n");
  const options = { globalFilter: "#todo", statusTypes: { "~": "DONE" } };
  const [node] = taskReqForest(contents, options);
  assert.equal(node.state, "met");
  assert.equal(node.ownerName, "Owner");
  assert.equal(taskReqForest(contents).length, 0, "the default filter sees no task here");
});
