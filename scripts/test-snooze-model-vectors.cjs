const assert = require("node:assert/strict");
const test = require("node:test");
const { helpers: ledgerTools } = require("./ledger-tools-harness.cjs");
const { helpers: navigation } = require("./navigation-hotkeys-harness.cjs");
const { helpers: blockIdPrompt } = require("./block-id-prompt-harness.cjs");
const { helpers: taskStatusCycler } = require("./task-status-cycler-harness.cjs");
const {
  ALL_GROUPS,
  IMPLEMENTED_GROUPS,
  RESERVED_GROUPS,
  assertCleanupVector,
  assertLiveVector,
  assertParseVector,
  assertWhenVector,
  readSnoozeVectors,
  validateSnoozeVectors,
} = require("./snooze-model-vectors.cjs");

const PLUGINS = Object.freeze([
  ["bob-ledger-tools", ledgerTools],
  ["bob-navigation-hotkeys", navigation],
  ["block-id-prompt", blockIdPrompt],
  ["task-status-cycler", taskStatusCycler],
]);

test("canonical snooze fixture validates every group, mode, and runner", () => {
  const fixture = readSnoozeVectors("bob-ledger-tools");
  assert.deepEqual(Object.keys(fixture.groups).sort(), ALL_GROUPS.slice().sort());
  assert.deepEqual(
    Object.fromEntries(ALL_GROUPS.map((group) => [group, fixture.groups[group].length])),
    { rows: 17, when: 19, live: 13, snooze: 15, wake: 10, cleanup: 5 },
  );
  assert.throws(() => validateSnoozeVectors({ ...fixture, groups: { ...fixture.groups, surprise: [] } }), /unknown snooze vector group/);
  const badMode = structuredClone(fixture);
  badMode.groups.rows[0].mode = "scan";
  assert.throws(() => validateSnoozeVectors(badMode), /unknown mode/);
  const badRunner = structuredClone(fixture);
  badRunner.groups.rows[0].runners = ["javascript"];
  assert.throws(() => validateSnoozeVectors(badRunner), /unknown runner/);
});

test("mutation vectors reserved for later phases have explicit coverage", () => {
  const fixture = readSnoozeVectors("bob-ledger-tools");
  const coverage = Object.fromEntries(RESERVED_GROUPS.map((group) => [
    group,
    { cases: fixture.groups[group].length, modes: Array.from(new Set(fixture.groups[group].map((row) => row.mode))).sort() },
  ]));
  assert.deepEqual(coverage, {
    snooze: { cases: 15, modes: ["add", "drop"] },
    wake: { cases: 10, modes: ["wake"] },
  });
  assert.deepEqual(IMPLEMENTED_GROUPS, ["rows", "when", "live", "cleanup"]);
});

for (const [plugin, helpers] of PLUGINS) {
  test(plugin + " runs every canonical rows vector", () => {
    const fixture = readSnoozeVectors(plugin);
    const model = helpers.snoozeModel;
    assert.ok(model, plugin + " exports snoozeModel");
    for (const testCase of fixture.groups.rows) assertParseVector(model, testCase, assert);
  });
  test(plugin + " runs every canonical when vector", () => {
    const fixture = readSnoozeVectors(plugin);
    const model = helpers.snoozeModel;
    for (const testCase of fixture.groups.when) assertWhenVector(model, testCase, assert);
  });
  test(plugin + " runs every canonical live vector", () => {
    const fixture = readSnoozeVectors(plugin);
    const model = helpers.snoozeModel;
    for (const testCase of fixture.groups.live) assertLiveVector(model, testCase, assert);
  });
  test(plugin + " runs every canonical cleanup vector", () => {
    const fixture = readSnoozeVectors(plugin);
    const model = helpers.snoozeModel;
    for (const testCase of fixture.groups.cleanup) assertCleanupVector(model, testCase, assert);
  });
}

test("explicit row removal carries notes and preserves history, malformed rows, and line endings", () => {
  const source = "## Pomodoros\r\n\r\n## Snoozed\r\n\r\n- **1530** [[same#^move]]\r\n  - keep this note\r\n- **1900** [[same#^keep]]\r\n- ~~**1400** [[same#^move]]~~ · woke 14:02\r\n- **1500** [[same#^bad]] extra\r\n";
  const result = ledgerTools.snoozeModel.planRemoveRows(source, ["same.md#^move"], {
    resolveIdentity: (row) => ({ route: "same.md", blockId: row.blockId }),
  });
  assert.equal(result.postimage, "## Pomodoros\r\n\r\n## Snoozed\r\n\r\n- **1900** [[same#^keep]]\r\n- ~~**1400** [[same#^move]]~~ · woke 14:02\r\n- **1500** [[same#^bad]] extra\r\n");
  assert.deepEqual(result.removedIdentities, ["same.md#^move"]);
  assert.equal(result.detachedSubtrees.length, 1);
  assert.equal(result.detachedSubtrees[0].children, "  - keep this note\r\n");
  assert.equal(result.detachedSubtrees[0].source, "- **1530** [[same#^move]]\r\n  - keep this note\r\n");
  assert.equal(result.edits.length, 1);
  assert.ok(result.edits[0].end > result.edits[0].start);
});

test("explicit row removal deletes an empty heading but keeps prose", () => {
  const identity = "job.md#^x";
  const resolver = { resolveIdentity: () => identity };
  const empty = "## Snoozed\n\n- **1530** [[job#^x]]\n";
  assert.equal(ledgerTools.snoozeModel.planRemoveRows(empty, [identity], resolver).postimage, "");
  const prose = "## Snoozed\n\nParked for later.\n- **1530** [[job#^x]]\n";
  assert.equal(ledgerTools.snoozeModel.planRemoveRows(prose, [identity], resolver).postimage, "## Snoozed\n\nParked for later.\n");
});
