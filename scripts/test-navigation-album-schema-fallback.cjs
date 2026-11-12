const test = require("node:test");
const assert = require("node:assert/strict");

const { helpers } = require("./navigation-hotkeys-harness.cjs");

test("fallback yields to tasks, links, dependencies, counts, and direct stages", () => {
  const base = {
    countExplicit: false, hasTaskSession: false,
    initialProperty: null, initialTaskCardRow: null, directStage: false,
    reopenBlocks: false, reopenLinks: false, reopenLinkedFrom: false,
    isTask: false, isLink: false, hasDependencyEntry: false, isBullet: true,
  };
  assert.deepEqual(helpers.albumSchemaFallbackGate(base), { attempt: true, reason: "album-fallback" });
  // A real task row in an album keeps the Task Card.
  assert.equal(helpers.albumSchemaFallbackGate({ ...base, isTask: true }).attempt, false);
  // A dedicated Task Link row keeps the link picker.
  assert.equal(helpers.albumSchemaFallbackGate({ ...base, isLink: true }).attempt, false);
  // Managed dependency/relation child lines keep their existing stages.
  assert.equal(helpers.albumSchemaFallbackGate({ ...base, hasDependencyEntry: true }).attempt, false);
  // Counted sessions preserve counts and never fall back.
  assert.equal(helpers.albumSchemaFallbackGate({ ...base, countExplicit: true }).attempt, false);
  assert.equal(helpers.albumSchemaFallbackGate({ ...base, hasTaskSession: true }).attempt, false);
  // Direct and reopened stages never fall back.
  for (const options of [
    { initialProperty: "dependsOn" },
    { initialTaskCardRow: "depends-on" },
    { directStage: true },
    { reopenBlocks: true },
    { reopenLinks: true },
    { reopenLinkedFrom: true },
  ]) {
    assert.equal(helpers.albumSchemaFallbackGate({ ...base, ...options }).attempt, false, JSON.stringify(options));
  }
});

test("fallback only fires on bullets; prose and unrelated notes fall through", () => {
  const base = {
    countExplicit: false, hasTaskSession: false,
    initialProperty: null, initialTaskCardRow: null, directStage: false,
    reopenBlocks: false, reopenLinks: false, reopenLinkedFrom: false,
    isTask: false, isLink: false, hasDependencyEntry: false,
  };
  // A non-task album row (a bullet) attempts the album fallback.
  assert.equal(helpers.albumSchemaFallbackGate({ ...base, isBullet: true }).attempt, true);
  // Prose without a bullet falls through to the existing Task Card notice.
  const prose = helpers.albumSchemaFallbackGate({ ...base, isBullet: false });
  assert.equal(prose.attempt, false);
  assert.equal(prose.reason, "not-bullet");
});
