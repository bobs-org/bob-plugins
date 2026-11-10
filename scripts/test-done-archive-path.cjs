// done/ path contract parity test.
//
// Fixtures: plugins/<plugin>/scripts/fixtures/done_archive_paths/vectors.json,
// each a verbatim copy of bob-cli's
// tests/fixtures/done_archive_paths/vectors.json
// (sha256 9b9ce16d92be39e364a6e85084990f2596c96f02e7ae173002ba5d3bd4088383).
// The hash assertions below fail loudly on local edits: refresh every copy
// from bob-cli and update EXPECTED_FIXTURE_SHA together, never hand-edit a
// mirror.
//
// For every vector this runs each plugin's `isDoneArchivePath` helper and
// asserts it agrees with bob-cli's `done_archive::is_archive_path`, so every
// done/ check in the vault agrees on what done/ means: the first path
// segment equals `done` exactly and case-sensitively.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const blockIdPrompt = require("./block-id-prompt-harness.cjs");
const navigationHotkeys = require("./navigation-hotkeys-harness.cjs");
const ledgerTools = require("./ledger-tools-harness.cjs");
const taskStatusCycler = require("./task-status-cycler-harness.cjs");

const EXPECTED_FIXTURE_SHA =
  "9b9ce16d92be39e364a6e85084990f2596c96f02e7ae173002ba5d3bd4088383";

const PLUGINS = [
  { name: "block-id-prompt", helpers: blockIdPrompt.helpers },
  { name: "bob-navigation-hotkeys", helpers: navigationHotkeys.helpers },
  { name: "bob-ledger-tools", helpers: ledgerTools.helpers },
  { name: "task-status-cycler", helpers: taskStatusCycler.helpers },
];

function fixturePath(pluginName) {
  return join(
    __dirname,
    "..",
    "plugins",
    pluginName,
    "scripts",
    "fixtures",
    "done_archive_paths",
    "vectors.json",
  );
}

test("done/ fixtures mirror bob-cli byte for byte", () => {
  for (const { name } of PLUGINS) {
    const sha = createHash("sha256")
      .update(readFileSync(fixturePath(name)))
      .digest("hex");
    assert.equal(sha, EXPECTED_FIXTURE_SHA, name);
  }
});

test("every plugin helper agrees with the shared vectors", () => {
  const fixture = JSON.parse(
    readFileSync(fixturePath("block-id-prompt"), "utf8"),
  );
  assert.ok(fixture.length > 0, "vectors are non-empty");
  for (const { name, helpers } of PLUGINS) {
    assert.equal(
      typeof helpers.isDoneArchivePath,
      "function",
      `${name} exports isDoneArchivePath`,
    );
    for (const vector of fixture) {
      assert.equal(
        helpers.isDoneArchivePath(vector.path),
        vector.archive,
        `${name} ${vector.id}`,
      );
    }
  }
});
