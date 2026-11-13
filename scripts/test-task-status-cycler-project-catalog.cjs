// Dual-format SUBOPEN catalog reader parity.
//
// Fixture: plugins/task-status-cycler/scripts/fixtures/project_catalog/vectors.json,
// a verbatim copy of bob-cli's tests/fixtures/project_catalog/vectors.json
// (sha256 c685dd31ee99ded534b8e5c0f0ff9d8679d1dab88c450f48f4e42e05ce8d19a9).
// Refresh the copy from bob-cli and update EXPECTED_FIXTURE_SHA together,
// never hand-edit the mirror.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { existsSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const { helpers } = require("./task-status-cycler-harness.cjs");

const EXPECTED_FIXTURE_SHA =
  "c685dd31ee99ded534b8e5c0f0ff9d8679d1dab88c450f48f4e42e05ce8d19a9";

const VECTORS_PATH = join(
  __dirname,
  "..",
  "plugins",
  "task-status-cycler",
  "scripts",
  "fixtures",
  "project_catalog",
  "vectors.json",
);

const CANONICAL_PATH = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "tests",
  "fixtures",
  "project_catalog",
  "vectors.json",
);

function prjLineOf(text) {
  const lines = String(text || "").split(/\r?\n/);
  for (let line = 0; line < lines.length; line += 1) {
    const trimmed = String(lines[line] || "").replace(/[ \t]+$/, "");
    if (trimmed === "^prj" || trimmed.endsWith(" ^prj") || trimmed.endsWith("\t^prj")) {
      return line;
    }
  }
  return 0;
}

test("project catalog vectors.json is the recorded bob-cli SHA-256", () => {
  const copied = readFileSync(VECTORS_PATH);
  const sha = createHash("sha256").update(copied).digest("hex");
  assert.equal(sha, EXPECTED_FIXTURE_SHA);
  if (existsSync(CANONICAL_PATH)) {
    assert.deepEqual(copied, readFileSync(CANONICAL_PATH));
  }
});

test("project catalog vectors match the dual-format JS reader", () => {
  const fixture = JSON.parse(readFileSync(VECTORS_PATH, "utf8"));
  assert.ok(Array.isArray(fixture.vectors) && fixture.vectors.length > 0);
  assert.equal(typeof helpers.projectChildCache, "function");
  assert.equal(typeof helpers.projectHasOpenChild, "function");
  assert.equal(typeof helpers.projectOpenChildCount, "function");

  for (const vector of fixture.vectors) {
    const lines = String(vector.text || "").split(/\r?\n/);
    const prjLine = prjLineOf(vector.text);
    const options = vector.closed_child
      ? { closedChildPaths: new Set([vector.closed_child]) }
      : {};
    const cache = helpers.projectChildCache(lines);
    const open = helpers.projectOpenChildCount(lines, prjLine, options);
    const hasOpen = helpers.projectHasOpenChild(lines, prjLine, options);

    if (vector.expect.source === "damaged") {
      assert.equal(cache.source, "damaged", vector.name);
      assert.equal(hasOpen, true, `${vector.name}: damage is open`);
      continue;
    }
    if (vector.expect.source === "catalog") {
      assert.equal(cache.source, "catalog", vector.name);
    } else {
      assert.equal(cache.source, "absent", `${vector.name}: ${vector.expect.source}`);
    }
    assert.equal(open, vector.expect.open, `${vector.name}: open count`);
    assert.equal(hasOpen, vector.expect.open > 0, `${vector.name}: has open`);
  }
});
