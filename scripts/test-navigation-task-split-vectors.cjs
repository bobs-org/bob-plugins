// Task-split vectors: the copied `scripts/fixtures/task_split/vectors.json`
// (SP1–SP51, bob-cli source of truth) drives `planSplitBullets`
// byte-for-byte, including the requirement-carry cases (SP32–SP50). Like the
// Rust conformance test, optional `stubs`, `placement`, `owner_minted_id`,
// and `clamped` expectations are only compared when the vector records
// them, and carried tasks compare with the `req_depth`/`moves` shape.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const { helpers } = require("./navigation-hotkeys-harness.cjs");

const vectorsPath = path.join(
  __dirname,
  "../plugins/bob-navigation-hotkeys/scripts/fixtures/task_split/vectors.json",
);
const vectors = JSON.parse(fs.readFileSync(vectorsPath, "utf8"));

function rustTrimEnd(line) {
  return String(line || "").replace(
    /[\t\n\v\f\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+$/,
    "",
  );
}

function lineDigest(line) {
  return crypto
    .createHash("sha256")
    .update(rustTrimEnd(line), "utf8")
    .digest("hex")
    .slice(0, 8);
}

test("task-split vectors pin planSplitBullets byte-for-byte", () => {
  assert.equal(vectors.version, 1);
  assert.ok(
    Array.isArray(vectors.cases) && vectors.cases.length > 0,
    "vectors cases are present",
  );
  for (const vector of vectors.cases) {
    const input = vector.input || {};
    const request = {
      ownerPath: (input.owner || {}).path,
      ownerLine: (input.owner || {}).line,
      selection: input.selection,
      today: input.today,
      settings: input.settings,
    };
    const plan = helpers.planSplitBullets(input.files, request, {
      lineDigest,
    });
    const expected = vector.expect || {};
    assert.equal(plan.ok, expected.ok === true, `${vector.id} ok`);
    if (!plan.ok) {
      assert.equal(plan.code, expected.code, `${vector.id} code`);
      assert.equal(plan.message, expected.message, `${vector.id} message`);
      continue;
    }
    assert.deepEqual(plan.files, expected.files, `${vector.id} files`);
    // Mirrors the Rust `vector_task` shape: carried requirements compare
    // with their `req_depth` and 1-based `moves`; notes compare without.
    assert.deepEqual(
      plan.tasks.map((task) => {
        const shaped = {
          path: task.path,
          block_id: task.block_id,
          title: task.title,
          anchor_reused: task.anchor_reused,
          child_lines: task.child_lines,
        };
        if (task.req_depth !== undefined) {
          shaped.req_depth = task.req_depth;
          shaped.moves = task.moves;
        }
        return shaped;
      }),
      expected.tasks,
      `${vector.id} tasks`,
    );
    if (expected.stubs !== undefined) {
      assert.deepEqual(plan.stubs, expected.stubs, `${vector.id} stubs`);
    }
    assert.deepEqual(plan.cursor, expected.cursor, `${vector.id} cursor`);
    assert.equal(plan.notice, expected.notice, `${vector.id} notice`);
    if (expected.clamped !== undefined) {
      assert.deepEqual(plan.clamped, expected.clamped, `${vector.id} clamped`);
    }
    if (expected.owner_minted_id !== undefined) {
      assert.equal(
        plan.owner_minted_id,
        expected.owner_minted_id,
        `${vector.id} owner_minted_id`,
      );
    }
    if (expected.placement !== undefined) {
      assert.deepEqual(
        plan.placement,
        expected.placement,
        `${vector.id} placement`,
      );
    }
  }
});

test("task-split candidates list splittable bullets in order", () => {
  const first = vectors.cases[0];
  const listed = helpers.listTaskSplitCandidates(first.input.files, {
    ownerPath: first.input.owner.path,
    ownerLine: first.input.owner.line,
    selection: { kind: "cursor", line: 1 },
  });
  assert.equal(listed.ok, true);
  assert.equal(listed.owner_line, 1);
  assert.deepEqual(
    listed.candidates.map((candidate) => candidate.title),
    ["Ping Alice about the cutover window", "Write the rollback runbook"],
  );
});

test("task-split candidates expose requirement depth, mark, and state", () => {
  const vector = vectors.cases.find((entry) => entry.id === "SP34");
  const listed = helpers.listTaskSplitCandidates(vector.input.files, {
    ownerPath: vector.input.owner.path,
    ownerLine: vector.input.owner.line,
    selection: { kind: "cursor", line: 1 },
  });
  assert.equal(listed.ok, true);
  assert.deepEqual(
    listed.candidates.map((candidate) => candidate.title),
    [
      "Handles supported inputs",
      "Handles Windows files",
      "Preserves CRLF",
      "Handles empty input",
      "Benchmarks within 5% of v1",
    ],
  );
  const heads = listed.candidates.filter(
    (candidate) => candidate.req !== undefined,
  );
  assert.equal(heads.length, 5);
  assert.deepEqual(
    heads.map((candidate) => candidate.req.depth),
    [1, 2, 3, 2, 1],
  );
  for (const candidate of heads) {
    assert.equal(candidate.req.mark, "open");
    assert.equal(candidate.req.state, "pending");
    assert.equal(candidate.req.carriable, true);
  }
  assert.deepEqual(
    listed.candidates.filter((candidate) => candidate.req === undefined),
    [],
  );
});
