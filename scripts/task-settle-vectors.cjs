// Shared drivers for bob-cli's task settle fixtures (`vectors.json`).
//
// Each runner takes the ledger-tools bundle's exported twin helpers, so the
// vector test and the fixture-copy test drive the same projection bob-cli's
// own tests use (`src/native/task_settle/tests.rs`).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PLUGINS_DIR = path.join(__dirname, "..", "plugins");
// bob-cli's canonical fixtures, present when this checkout is a linked repo
// inside a bob-cli workspace.
const CANONICAL_DIR = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "tests",
  "fixtures",
  "task_settle",
);
const TASK_SETTLE_FIXTURE_FILES = Object.freeze(["README.md", "vectors.json"]);

function fixtureDir(pluginId) {
  return path.join(PLUGINS_DIR, pluginId, "scripts", "fixtures", "task_settle");
}

function readFixture(pluginId, name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureDir(pluginId), name), "utf8"));
}

// A fixture text value joined with its line ending plus a final one.
function textOf(value) {
  const lines = value.lines || [];
  const ending = value.ending || "\n";
  let result = lines.join(ending);
  if (value.final_newline) result += ending;
  return result;
}

function classificationOf(helpers, classification) {
  return helpers.taskSettleFromStatusTypes(
    classification.global_filter,
    (classification.status_types || []).map((status) => ({
      symbol: Array.from(status.symbol)[0],
      type: status.type,
    })),
  );
}

// One settle case through the helper, in the fixture's `expect` shape.
function runSettle(helpers, testCase, vectors) {
  const classification = classificationOf(helpers, vectors.classification);
  const input = textOf(testCase.input);
  const result = helpers.taskSettleNote(
    testCase.path,
    input,
    vectors.today,
    classification,
    vectors.daily_path,
  );
  return { input, classification, result };
}

function expectedMap(helpers, testCase, input) {
  if (testCase.expect.line_map === "identity") {
    const map = {};
    helpers.taskSettleLogicalLines(input).forEach((_, index) => {
      map[index] = index;
    });
    return map;
  }
  return Object.fromEntries(testCase.expect.line_map);
}

function assertSettleCase(helpers, testCase, vectors) {
  const { input, classification, result } = runSettle(helpers, testCase, vectors);
  const expected = testCase.expect;
  assert.equal(result.contents, textOf(expected.text), `${testCase.id} bytes`);
  assert.equal(result.changed, expected.changed, `${testCase.id} changed`);
  assert.deepEqual(result.lineMap, expectedMap(helpers, testCase, input), `${testCase.id} line_map`);
  assert.deepEqual(
    result.warnings.map((warning) => warning.code),
    expected.warning_codes,
    `${testCase.id} warning_codes`,
  );
  // A settled note settles to a fixed point.
  const second = helpers.taskSettleNote(
    testCase.path,
    result.contents,
    vectors.today,
    classification,
    vectors.daily_path,
  );
  assert.equal(second.contents, result.contents, `${testCase.id} second pass bytes`);
  assert.equal(second.changed, false, `${testCase.id} second pass is a no-op`);
}

module.exports = {
  CANONICAL_DIR,
  TASK_SETTLE_FIXTURE_FILES,
  fixtureDir,
  readFixture,
  textOf,
  classificationOf,
  runSettle,
  expectedMap,
  assertSettleCase,
};
