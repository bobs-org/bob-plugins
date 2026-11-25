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
  isLinkedPluginCheckout,
  fixtureDir,
} = require("./task-settle-vectors.cjs");

const LEDGER = "bob-ledger-tools";

function requireCanonicalDir(t) {
  if (CANONICAL_DIR && fs.existsSync(CANONICAL_DIR)) return CANONICAL_DIR;
  assert.equal(
    isLinkedPluginCheckout(),
    false,
    "a linked bob-cli workspace must expose tests/fixtures/task_settle; refusing to skip",
  );
  t.diagnostic("bob-cli fixtures are not beside this checkout; skipped the canonical comparison");
  return null;
}

test("linked workspaces resolve bob-cli's canonical task_settle fixtures", (t) => {
  if (!isLinkedPluginCheckout()) {
    t.diagnostic("standalone plugin checkout; skipped the linked lookup assertion");
    return;
  }
  assert.ok(CANONICAL_DIR, "linked checkout must find tests/fixtures/task_settle");
  const resolved = path.resolve(CANONICAL_DIR).split(path.sep).join("/");
  assert.equal(
    resolved.includes("/sase/tests/"),
    false,
    "canonical dir must not resolve into sase/tests",
  );
  for (const name of TASK_SETTLE_FIXTURE_FILES) {
    assert.ok(
      fs.existsSync(path.join(CANONICAL_DIR, name)),
      `canonical ${name} exists at ${CANONICAL_DIR}`,
    );
  }
});

test("every ledger-tools copy of the task_settle fixtures is byte-identical", (t) => {
  const ledgerDir = fixtureDir(LEDGER);
  for (const name of TASK_SETTLE_FIXTURE_FILES) {
    const copy = path.join(ledgerDir, name);
    assert.ok(fs.existsSync(copy), `bob-ledger-tools ships ${name}`);
  }
  const canonicalDir = requireCanonicalDir(t);
  if (!canonicalDir) return;
  for (const name of TASK_SETTLE_FIXTURE_FILES) {
    const copyBytes = fs.readFileSync(path.join(ledgerDir, name));
    const canonicalBytes = fs.readFileSync(path.join(canonicalDir, name));
    assert.ok(
      copyBytes.equals(canonicalBytes),
      `${name} matches bob-cli's canonical fixture`,
    );
  }
});

test("the canonical README tells editors to update bob-cli first, then copy", (t) => {
  const canonicalDir = requireCanonicalDir(t);
  if (!canonicalDir) return;
  const readme = fs.readFileSync(path.join(canonicalDir, "README.md"), "utf8");
  assert.ok(
    readme.toLowerCase().includes("update bob-cli first, then copy"),
    "canonical README carries the update-bob-cli-first instruction",
  );
});
