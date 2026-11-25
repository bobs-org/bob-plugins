// Task settle fixture drift test (bob-cli-q4.8.1.1 pure-twin).
//
// The ledger-tools twin owns no canonical bytes: bob-cli's
// `tests/fixtures/task_settle/` directory is authoritative, and every plugin
// copy stays byte-identical. A standalone plugin checkout (no bob-cli beside
// it) skips only the canonical comparison, never its own vector suite.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  CANONICAL_DIR,
  TASK_SETTLE_FIXTURE_FILES,
  fixtureDir,
} = require("./task-settle-vectors.cjs");

const LEDGER = "bob-ledger-tools";

test("every ledger-tools copy of the task_settle fixtures is byte-identical", (t) => {
  const ledgerDir = fixtureDir(LEDGER);
  for (const name of TASK_SETTLE_FIXTURE_FILES) {
    const copy = path.join(ledgerDir, name);
    assert.ok(fs.existsSync(copy), `bob-ledger-tools ships ${name}`);
  }
  if (!fs.existsSync(CANONICAL_DIR)) {
    t.diagnostic("bob-cli fixtures are not beside this checkout; skipped the canonical comparison");
    return;
  }
  for (const name of TASK_SETTLE_FIXTURE_FILES) {
    assert.ok(
      fs.readFileSync(path.join(ledgerDir, name)).equals(fs.readFileSync(path.join(CANONICAL_DIR, name))),
      `${name} matches bob-cli's canonical fixture`,
    );
  }
});

test("the canonical README tells editors to update bob-cli first, then copy", (t) => {
  if (!fs.existsSync(CANONICAL_DIR)) {
    t.diagnostic("bob-cli fixtures are not beside this checkout; skipped the README check");
    return;
  }
  const readme = fs.readFileSync(path.join(CANONICAL_DIR, "README.md"), "utf8");
  assert.ok(
    readme.toLowerCase().includes("update bob-cli first, then copy"),
    "canonical README carries the update-bob-cli-first instruction",
  );
});
