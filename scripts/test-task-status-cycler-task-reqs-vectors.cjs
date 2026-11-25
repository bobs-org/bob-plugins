// Task requirement (RQ), task block layout (RL), and requirement writer
// (RW) twins (bob-cli-on.10.1.1, bob-cli-on.10.1.2): every bob-cli RQ, RL,
// and RW vector runs through the built cycler's exported helpers. bob-cli
// owns the fixtures; the plugin copies them byte for byte.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { helpers } = require("./task-status-cycler-harness.cjs");
const {
  CANONICAL_DIR,
  TASK_REQ_FIXTURE_FILES,
  fixtureDir,
  readFixture,
  sourceOf,
  linesOf,
  digest8,
  nodeJson: nodeJsonFor,
  rlRunners,
  runWrite,
} = require("./task-reqs-vectors.cjs");

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
  taskBlockPlanTidy,
  taskBlockEnsureNotesDrawer,
  taskBlockDrawerHeaderOffset,
  taskBlockScoopLooseNotes,
  taskReqDrop,
  taskReqRestore,
  taskReqToggle,
  taskReqInsert,
} = helpers;

const FIXTURE_DIR = fixtureDir("task-status-cycler");
const vectors = readFixture("task-status-cycler", "vectors.json");
const layout = readFixture("task-status-cycler", "layout.json");
const writes = readFixture("task-status-cycler", "writes.json");
const nodeJson = (node) => nodeJsonFor(helpers, node);

test("fixture copies match bob-cli byte for byte when the bob-cli checkout is present", (t) => {
  if (!fs.existsSync(CANONICAL_DIR)) {
    t.skip("bob-cli fixtures are not beside this checkout");
    return;
  }
  for (const name of TASK_REQ_FIXTURE_FILES) {
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

const RL_RUNNERS = rlRunners(helpers);

for (const [section, run] of Object.entries(RL_RUNNERS)) {
  for (const testCase of layout[section]) {
    test(`${testCase.id} ${section}: ${testCase.title}`, () => {
      assert.deepEqual(run(testCase), testCase.expect);
    });
  }
}

test("RW fixture ids are sequential and pin one vector date", () => {
  assert.equal(writes.schema_version, 1);
  assert.match(writes.date, /^\d{4}-\d{2}-\d{2}$/);
  writes.cases.forEach((testCase, index) => assert.equal(testCase.id, `RW${index + 1}`));
  assert.deepEqual(
    [...new Set(writes.cases.map((testCase) => testCase.op))].sort(),
    ["drop", "insert", "restore", "toggle"],
  );
});

for (const testCase of writes.cases) {
  test(`${testCase.id} ${testCase.op}: ${testCase.title}`, () => {
    assert.deepEqual(runWrite(helpers, testCase, writes.date), testCase.expect);
  });
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
  assert.equal(ensured.drawer.title, "Notes");
  assert.deepEqual(linesOf(ensured.updated), [
    "- [ ] #task A ^a",
    "\t- [ ] req",
    "\t- **Notes**",
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
  assert.equal(plan.updated, "- [ ] #task A ^a\n\t- [ ] first req\n\t- **Notes**\n\t\t- loose");
  assert.deepEqual([plan.moves, plan.notesFiled, plan.notesCreated], [0, 1, true]);
});

test("tidy keeps a CRLF note CRLF and a done owner's block untouched", () => {
  const contents = ["- [ ] #task A ^a", "\t- loose", "\t- [ ] first req", ""].join("\r\n");
  const plan = taskBlockPlanTidy(contents, taskBlockFindTask(contents, 0));
  assert.equal(plan.updated, ["- [ ] #task A ^a", "\t- [ ] first req", "\t- **Notes**", "\t\t- loose", ""].join("\r\n"));
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
    "\t- **Notes**",
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

// --- Writer (RW) twin behavior beyond the shared vectors ---------------------

const OWNER = [
  "- [ ] #task Ship the exporter ^export",
  "\t- [ ] Handles supported inputs",
  "\t\t- [ ] Handles Windows files",
  "\t- [-] Handles empty input",
  "\t\t- [ ] Nested under a drop",
  "\t- [>] [[#^carried|Carried]]",
  "\t- [x] Hand-ticked",
  "\t- loose note",
  "\t\t- note under a note",
  "\t- NOTES",
  "\t\t- filed entry",
  "",
].join("\n");
const at = (contents, lineIndex) => ({ lineIndex, preimage: linesOf(contents)[lineIndex] });

test("every writer refuses a stale or missing target line before writing", () => {
  const stale = { lineIndex: 1, preimage: "\t- [ ] Handles supported inputs (edited)" };
  const refusal = { ok: false, code: "req_stale", message: "The line changed — try again" };
  assert.deepEqual(taskReqDrop(OWNER, stale, "2026-11-21", "why"), refusal);
  assert.deepEqual(taskReqRestore(OWNER, stale), refusal);
  assert.deepEqual(taskReqToggle(OWNER, stale), refusal);
  assert.deepEqual(taskReqInsert(OWNER, { lineIndex: 0, preimage: "- [ ] #task Renamed" }, ["- [ ] x"]), refusal);
  assert.deepEqual(taskReqToggle(OWNER, { lineIndex: 99, preimage: "" }), refusal);
  assert.deepEqual(taskReqToggle(OWNER, { lineIndex: -1, preimage: "" }), refusal);
});

test("refusals carry bob-cli's codes and exact copy", () => {
  const refused = (write) => [write.code, write.message];
  assert.deepEqual(refused(taskReqDrop(OWNER, at(OWNER, 3), "2026-11-21", "")), ["req_dropped", "Already dropped"]);
  assert.deepEqual(refused(taskReqDrop(OWNER, at(OWNER, 4), "2026-11-21", "")), [
    "req_excluded",
    "Its parent requirement was dropped — restore it first",
  ]);
  assert.deepEqual(refused(taskReqDrop(OWNER, at(OWNER, 5), "2026-11-21", "")), ["req_carried", "Carried — open the linked task"]);
  assert.deepEqual(refused(taskReqDrop(OWNER, at(OWNER, 6), "2026-11-21", "")), ["req_met", "Already met"]);
  assert.deepEqual(refused(taskReqDrop(OWNER, at(OWNER, 7), "2026-11-21", "")), ["not_a_req", "This line is not a requirement"]);
  assert.deepEqual(refused(taskReqRestore(OWNER, at(OWNER, 1))), [
    "req_not_dropped",
    "Requirements are met when “Ship the exporter” closes — Ctrl+Enter on the task",
  ]);
  assert.deepEqual(refused(taskReqRestore(OWNER, at(OWNER, 5))), ["req_carried", "Carried — open the linked task"]);
  assert.deepEqual(refused(taskReqToggle(OWNER, at(OWNER, 3))), ["req_dropped", "Dropped — restore it first"]);
  assert.deepEqual(refused(taskReqToggle(OWNER, at(OWNER, 1))), [
    "req_has_nested",
    "“Handles supported inputs” has 1 nested requirement — carry it or toggle them first",
  ]);
  assert.deepEqual(refused(taskReqToggle(OWNER, at(OWNER, 8))), [
    "req_parent",
    "A requirement needs a task or requirement directly above it",
  ]);
  assert.deepEqual(refused(taskReqToggle(OWNER, at(OWNER, 10))), [
    "req_in_drawer",
    "Drawers hold notes — put the requirement directly under the task",
  ]);
  assert.deepEqual(refused(taskReqToggle(OWNER, at(OWNER, 9))), ["not_a_note", "Only a note can become a requirement"]);
  assert.deepEqual(refused(taskReqToggle(OWNER, at(OWNER, 0))), ["not_a_note", "Only a note can become a requirement"]);
  assert.deepEqual(refused(taskReqInsert(OWNER, at(OWNER, 1), ["- [ ] x"])), ["not_a_task", "This line is not a task"]);
  assert.deepEqual(refused(taskReqInsert(OWNER, at(OWNER, 0), [])), ["req_empty", "Nothing to insert"]);
  assert.deepEqual(refused(taskReqInsert(OWNER, at(OWNER, 0), ["- [x] already met"])), [
    "req_state",
    "Requirements start open — they're met when the task closes",
  ]);
  const deep = ["- [ ] #task Deep ^deep"];
  for (let depth = 1; depth <= TASK_REQ_MAX_DEPTH; depth += 1) deep.push(`${"\t".repeat(depth)}- [ ] level ${depth}`);
  deep.push(`${"\t".repeat(TASK_REQ_MAX_DEPTH + 1)}- one too deep`, "");
  const deepNote = deep.join("\n");
  assert.deepEqual(refused(taskReqToggle(deepNote, at(deepNote, TASK_REQ_MAX_DEPTH + 1))), [
    "req_depth",
    "Requirements nest at most 16 deep — carry this branch into its own task",
  ]);
});

test("insert reports the number of newly owned requirements at every depth", () => {
  const nested = "- [ ] head\n\t- [ ] nested one\n\t\t- [ ] nested two";
  const empty = "- [ ] #task A ^a\n";
  assert.equal(taskReqInsert(empty, at(empty, 0), [nested]).added, 3);

  const existing = "- [ ] #task A ^a\n\t- [ ] old one\n\t- [ ] old two\n";
  assert.equal(taskReqInsert(existing, at(existing, 0), ["- [ ] new"]).added, 1);

  const loose = "- [ ] #task A ^a\n\t- loose note\n";
  const scooped = taskReqInsert(loose, at(loose, 0), ["- [ ] new"]);
  assert.equal(scooped.scooped, 1);
  assert.equal(scooped.added, 1, "scooped notes are not requirements");
});

test("the toggle reports firstReq only when a note becomes its owner's first req", () => {
  const fresh = ["- [ ] #task Fresh ^f", "\t- first note", "\t- second note", ""].join("\n");
  const first = taskReqToggle(fresh, at(fresh, 2));
  assert.equal(first.ok, true);
  assert.deepEqual([first.direction, first.depth, first.firstReq, first.scooped, first.notesCreated], ["note-to-req", 1, true, 1, true]);
  assert.deepEqual(linesOf(first.updated), ["- [ ] #task Fresh ^f", "\t- [ ] second note", "\t- **Notes**", "\t\t- first note"]);
  assert.equal(first.lineIndex, 1);
  const owned = ["- [ ] #task Owned ^o", "\t- [ ] existing req", "\t- a note", ""].join("\n");
  const second = taskReqToggle(owned, at(owned, 2));
  assert.deepEqual([second.ok, second.depth, second.firstReq, second.scooped], [true, 1, false, 0]);
  const deeper = "- [ ] #task A ^a\n\t- [ ] req\n\t\t- note under req\n";
  const nested = taskReqToggle(deeper, at(deeper, 2));
  assert.deepEqual([nested.ok, nested.depth, nested.firstReq, nested.lineIndex], [true, 2, false, 2]);
  assert.equal(linesOf(nested.updated)[2], "\t\t- [ ] note under req");
  const back = taskReqToggle(first.updated, at(first.updated, 1));
  assert.deepEqual([back.ok, back.direction, back.firstReq], [true, "req-to-note", false]);
});

test("drop collapses whitespace in the reason and keeps a history without gaps", () => {
  const contents = ["- [ ] #task A ^a", "\t- [ ] req", ""].join("\n");
  const once = taskReqDrop(contents, at(contents, 1), "2026-11-21", "  not \t needed  ");
  assert.deepEqual(linesOf(once.updated), [
    "- [ ] #task A ^a",
    "\t- [-] req",
    "\t\t- ❌ **CANCEL LOG**",
    "\t\t\t- *2026-11-21* — not needed",
  ]);
  const restored = taskReqRestore(once.updated, at(once.updated, 1));
  assert.deepEqual([restored.ok, restored.log], [true, "none"]);
  const twice = taskReqDrop(restored.updated, at(restored.updated, 1), "2026-11-22", "");
  assert.equal(twice.log, "prepended");
  assert.deepEqual(linesOf(twice.updated).slice(2), [
    "\t\t- ❌ **CANCEL LOG**",
    "\t\t\t- *2026-11-22* — 🤷 no reason given",
    "\t\t\t- *2026-11-21* — not needed",
  ]);
  const silent = taskReqDrop(contents, at(contents, 1), "2026-11-21", " \t ");
  assert.deepEqual([silent.log, linesOf(silent.updated)], ["none", ["- [ ] #task A ^a", "\t- [-] req"]]);
  assert.throws(() => taskReqDrop(contents, at(contents, 1), "11/21/2026", ""), TypeError);
});

test("writers keep a missing final newline and every untouched line ending", () => {
  const bare = "- [ ] #task A ^a\n\t- [ ] req";
  assert.equal(taskReqDrop(bare, at(bare, 1), "2026-11-21", "why").updated,
    "- [ ] #task A ^a\n\t- [-] req\n\t\t- ❌ **CANCEL LOG**\n\t\t\t- *2026-11-21* — why");
  assert.equal(taskReqToggle(bare, at(bare, 1)).updated, "- [ ] #task A ^a\n\t- **Notes**\n\t\t- req");
  assert.equal(taskReqInsert(bare, at(bare, 0), ["- [ ] two"]).updated, "- [ ] #task A ^a\n\t- [ ] req\n\t- [ ] two");
  const mixed = "- [ ] #task A ^a\r\n\t- [ ] req\n\t- note\r\n";
  const dropped = taskReqDrop(mixed, at(mixed, 1), "2026-11-21", "why");
  assert.equal(dropped.updated,
    "- [ ] #task A ^a\r\n\t- [-] req\n\t\t- ❌ **CANCEL LOG**\r\n\t\t\t- *2026-11-21* — why\r\n\t- note\r\n");
});

test("writers honor a custom global filter and status types", () => {
  const options = { globalFilter: "#todo", statusTypes: { "~": "DONE" } };
  const contents = ["- [~] #todo Owner ^o", "\t- [-] dropped req", "\t- [ ] #task not a task here", ""].join("\n");
  const restored = taskReqRestore(contents, at(contents, 1), options);
  assert.equal(linesOf(restored.updated)[1], "\t- [ ] dropped req");
  assert.equal(taskReqRestore(contents, at(contents, 1)).code, "not_a_req", "the default filter sees no task here");
  const pending = taskReqRestore(restored.updated, at(restored.updated, 1), options);
  assert.equal(pending.message, "Requirements are met when “Owner” closes — Ctrl+Enter on the task");
});
