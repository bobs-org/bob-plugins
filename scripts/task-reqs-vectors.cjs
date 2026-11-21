// Shared drivers for bob-cli's task requirement fixtures (RQ `vectors.json`,
// RL `layout.json`, RW `writes.json`). Each runner takes a plugin's exported
// twin helpers, so the cycler's vector test and the cross-plugin twin copy
// test drive every copy through the same projection bob-cli's own tests use
// (`src/native/task_block_layout/tests.rs`).
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const PLUGINS_DIR = path.join(__dirname, "..", "plugins");
// bob-cli's canonical fixtures, present when this checkout is a linked repo
// inside a bob-cli workspace.
const CANONICAL_DIR = path.join(__dirname, "..", "..", "..", "..", "..", "tests", "fixtures", "task_reqs");
const TASK_REQ_FIXTURE_FILES = Object.freeze(["README.md", "vectors.json", "layout.json", "writes.json"]);

function fixtureDir(pluginId) {
  return path.join(PLUGINS_DIR, pluginId, "scripts", "fixtures", "task_reqs");
}

function readFixture(pluginId, name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureDir(pluginId), name), "utf8"));
}

// `source_lines` joined with the case's line ending plus a final one.
function sourceOf(testCase) {
  const ending = testCase.eol === "crlf" ? "\r\n" : "\n";
  return testCase.source_lines.join(ending) + ending;
}

// Lines without their endings (bob-cli `lines_of`).
function linesOf(contents) {
  const text = contents.endsWith("\n") ? contents.slice(0, -1) : contents;
  return text.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
}

function digest8(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex").slice(0, 8);
}

// One forest row in the fixture's `expect.nodes` shape.
function nodeJson(helpers, node) {
  const json = {
    line: node.line,
    depth: node.depth,
    parent: node.parent,
    owner: node.owner,
    mark: node.mark,
    state: node.state,
    text: node.text,
    anchor: node.anchor,
    path: helpers.taskReqPathText(node),
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

// An RQ case's forest in the fixture shape.
function runRq(helpers, testCase) {
  return helpers.taskReqForest(sourceOf(testCase)).map((node) => nodeJson(helpers, node));
}

function taskAt(helpers, contents, testCase) {
  const task = helpers.taskBlockFindTask(contents, testCase.task - 1);
  assert.ok(task, `${testCase.id} has a task at line ${testCase.task}`);
  return task;
}

// RL runners by `layout.json` section.
function rlRunners(helpers) {
  return {
    slots(testCase) {
      const contents = sourceOf(testCase);
      const slot = helpers.taskBlockInsertionSlot(contents, taskAt(helpers, contents, testCase), testCase.kind);
      return { line: slot.lineIndex + 1, indent: slot.indent };
    },
    violations(testCase) {
      const contents = sourceOf(testCase);
      return helpers.taskBlockLayoutViolations(contents, taskAt(helpers, contents, testCase))
        .map((violation) => ({ line: violation.lineIndex + 1, kind: violation.kind }));
    },
    tidy(testCase) {
      const contents = sourceOf(testCase);
      const plan = helpers.taskBlockPlanTidy(contents, taskAt(helpers, contents, testCase));
      if (!plan) return null;
      // A tidied block has no violations and tidies to nothing.
      const tidied = helpers.taskBlockFindTask(plan.updated, testCase.task - 1);
      assert.ok(tidied, `${testCase.id} task survives tidy`);
      assert.deepEqual(helpers.taskBlockLayoutViolations(plan.updated, tidied), [], `${testCase.id} leaves no violations`);
      assert.equal(helpers.taskBlockPlanTidy(plan.updated, tidied), null, `${testCase.id} is idempotent`);
      return {
        lines: linesOf(plan.updated),
        moves: plan.moves,
        notes_filed: plan.notesFiled,
        notes_created: plan.notesCreated,
      };
    },
    note_homes(testCase) {
      const contents = sourceOf(testCase);
      const home = helpers.taskBlockNoteHome(contents, taskAt(helpers, contents, testCase));
      if (home.home === "loose") return { home: "loose", line: home.slot.lineIndex + 1, indent: home.slot.indent };
      if (home.home === "notes") return { home: "notes", line: home.drawer.line };
      return { home: "new-notes" };
    },
  };
}

// The written note's lines, asserting a CRLF note stays CRLF.
function rejoined(testCase, updated) {
  if (testCase.eol === "crlf") {
    assert.equal(
      (updated.match(/\n/g) || []).length,
      (updated.match(/\r\n/g) || []).length,
      `${testCase.id}: CRLF note stays CRLF`,
    );
  }
  return linesOf(updated);
}

// One RW case in the fixture's `expect` shape (bob-cli `run_write`).
function runWrite(helpers, testCase, date) {
  const contents = sourceOf(testCase);
  const physical = linesOf(contents);
  const target = (key) => {
    const lineIndex = testCase[key] - 1;
    const preimage = typeof testCase.preimage === "string"
      ? testCase.preimage
      : physical[lineIndex] === undefined ? "" : physical[lineIndex];
    return { lineIndex, preimage };
  };
  let write;
  if (testCase.op === "drop") write = helpers.taskReqDrop(contents, target("line"), date, testCase.reason || "");
  else if (testCase.op === "restore") write = helpers.taskReqRestore(contents, target("line"));
  else if (testCase.op === "toggle") write = helpers.taskReqToggle(contents, target("line"));
  else if (testCase.op === "insert") write = helpers.taskReqInsert(contents, target("task"), testCase.blocks);
  else throw new Error(`unknown op ${testCase.op}`);
  if (!write.ok) {
    assert.equal(typeof write.message, "string", `${testCase.id} refusal copy`);
    assert.ok(write.message.length > 0, `${testCase.id} refusal copy is nonempty`);
    return { refused: write.code };
  }
  const lines = rejoined(testCase, write.updated);
  if (testCase.op === "drop") return { lines, log: write.log, descendants: write.descendants };
  if (testCase.op === "restore") return { lines, descendants: write.descendants };
  if (testCase.op === "toggle") {
    return {
      lines,
      direction: write.direction,
      line: write.lineIndex + 1,
      depth: write.depth,
      scooped: write.scooped,
      notes_created: write.notesCreated,
    };
  }
  return {
    lines,
    first_line: write.firstLine + 1,
    line_count: write.lineCount,
    scooped: write.scooped,
    notes_created: write.notesCreated,
  };
}

module.exports = {
  CANONICAL_DIR,
  TASK_REQ_FIXTURE_FILES,
  fixtureDir,
  readFixture,
  sourceOf,
  linesOf,
  digest8,
  nodeJson,
  runRq,
  rlRunners,
  runWrite,
};
