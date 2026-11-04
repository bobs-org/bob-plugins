// Task-split vectors: the copied `scripts/fixtures/task_split/vectors.json`
// (SP1–SP30, bob-cli source of truth) drives `planSplitBullets` byte-for-byte.
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
    assert.deepEqual(
      plan.tasks.map((task) => ({
        path: task.path,
        block_id: task.block_id,
        title: task.title,
        anchor_reused: task.anchor_reused,
        child_lines: task.child_lines,
      })),
      expected.tasks,
      `${vector.id} tasks`,
    );
    assert.deepEqual(plan.cursor, expected.cursor, `${vector.id} cursor`);
    assert.equal(plan.notice, expected.notice, `${vector.id} notice`);
    if (expected.clamped !== undefined) {
      assert.deepEqual(plan.clamped, expected.clamped, `${vector.id} clamped`);
    } else {
      assert.equal(plan.clamped, undefined, `${vector.id} clamped`);
    }
    if (expected.owner_minted_id !== undefined) {
      assert.equal(
        plan.owner_minted_id,
        expected.owner_minted_id,
        `${vector.id} owner_minted_id`,
      );
    } else {
      assert.equal(
        plan.owner_minted_id,
        undefined,
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
