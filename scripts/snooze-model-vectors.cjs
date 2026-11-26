// Shared driver for the canonical bob-cli Snoozed row-model vectors.
const fs = require("node:fs");
const path = require("node:path");

const CANONICAL_DIR = path.join(__dirname, "..", "..", "..", "..", "..", "tests", "fixtures", "snooze");
const FIXTURE_DIR = path.join(__dirname, "..", "plugins", "bob-ledger-tools", "scripts", "fixtures", "snooze");
const ALL_GROUPS = Object.freeze(["rows", "when", "live", "snooze", "wake", "cleanup"]);
const IMPLEMENTED_GROUPS = Object.freeze(["rows", "when", "live", "cleanup"]);
const RESERVED_GROUPS = Object.freeze(["snooze", "wake"]);
const MODES = Object.freeze({
  rows: ["parse"],
  when: ["resolve"],
  live: ["classify"],
  snooze: ["add", "drop"],
  wake: ["wake"],
  cleanup: ["cleanup"],
});
const RUNNERS = Object.freeze(["rust", "js"]);

function validateSnoozeVectors(fixture) {
  if (!fixture || typeof fixture !== "object" || fixture.schema_version !== 1) {
    throw new Error("snooze vectors must use schema_version 1");
  }
  const groups = fixture.groups;
  if (!groups || typeof groups !== "object" || Array.isArray(groups)) {
    throw new Error("snooze vectors must contain groups");
  }
  const names = Object.keys(groups);
  for (const name of names) {
    if (!ALL_GROUPS.includes(name)) throw new Error("unknown snooze vector group: " + name);
  }
  for (const required of ALL_GROUPS) {
    if (!Array.isArray(groups[required])) throw new Error("missing snooze vector group: " + required);
  }
  for (const [group, cases] of Object.entries(groups)) {
    for (const testCase of cases) {
      if (!testCase || typeof testCase.id !== "string" || !testCase.id) throw new Error("snooze vector has no id");
      if (!MODES[group].includes(testCase.mode)) throw new Error(group + " has unknown mode: " + testCase.mode);
      if (!Array.isArray(testCase.runners) || !testCase.runners.length) throw new Error(testCase.id + " has no runners");
      for (const runner of testCase.runners) {
        if (!RUNNERS.includes(runner)) throw new Error(testCase.id + " has unknown runner: " + runner);
      }
      if (!testCase.input || typeof testCase.input !== "object" || !testCase.expected || typeof testCase.expected !== "object") {
        throw new Error(testCase.id + " is missing input or expected output");
      }
    }
  }
  return fixture;
}

function readSnoozeVectors(pluginId) {
  const directory = path.join(__dirname, "..", "plugins", pluginId, "scripts", "fixtures", "snooze");
  return validateSnoozeVectors(JSON.parse(fs.readFileSync(path.join(directory, "vectors.json"), "utf8")));
}

function assertParseVector(model, testCase, assert) {
  const result = model.parseSection(testCase.input.note);
  const expected = testCase.expected;
  assert.equal(result ? result.headerNumber : null, expected.header, testCase.id + " header");
  assert.deepEqual(result ? result.duplicateNumbers : [], expected.duplicates, testCase.id + " duplicate headers");
  assert.deepEqual((result ? result.rows : []).map((row) => ({
    line: row.line,
    kind: row.kind,
    hhmm: row.hhmm,
    target: row.target,
    block: row.blockId,
    embedded: row.embedded,
    aliased: row.aliased,
    children: row.children,
    malformed_reason: row.malformedReason,
    woke: row.wokeHhmm,
  })), expected.rows, testCase.id + " rows");
}

function assertWhenVector(model, testCase, assert) {
  const input = testCase.input;
  const result = model.parseWhen(input.input, {
    date: input.date,
    now: input.now,
    zone: input.zone,
  });
  const expected = testCase.expected;
  if (expected.refusal) {
    assert.equal(result.ok, false, testCase.id + " refuses");
    assert.equal(result.refusal, expected.refusal, testCase.id + " refusal");
    return;
  }
  assert.equal(result.ok, true, testCase.id + " resolves");
  assert.equal(result.value.hhmm, expected.hhmm, testCase.id + " HHMM");
  assert.equal(result.value.minutes, expected.minutes, testCase.id + " minutes");
  assert.ok(result.value.rfc3339.includes(expected.rfc3339_contains), testCase.id + " RFC 3339 contains " + expected.rfc3339_contains);
}

function assertLiveVector(model, testCase, assert) {
  const input = testCase.input;
  const result = model.classifyRows({
    today: input.today,
    note_date: input.note_date,
    now: input.now,
    zone: input.zone || "UTC",
    rows: input.rows,
  });
  const expected = testCase.expected;
  assert.deepEqual(result.rows.map((row) => ({ line: row.line, state: row.state })), expected.states, testCase.id + " states");
  assert.deepEqual(result.planned, expected.planned, testCase.id + " planned identities");
  assert.deepEqual(result.blocked, expected.blocked, testCase.id + " blocked identities");
  assert.deepEqual(result.eventLints, expected.event_lints, testCase.id + " Event Task lints");
  if (expected.next_wake_at_contains === null) {
    assert.equal(result.nextWakeAt, null, testCase.id + " no live wake target");
  } else {
    assert.ok(result.nextWakeAt && result.nextWakeAt.includes(expected.next_wake_at_contains), testCase.id + " next wake target");
  }
}

function assertCleanupVector(model, testCase, assert) {
  const input = testCase.input;
  const result = model.planStatePrune(input.day, input.tasks, {
    date: input.date,
    now: input.now,
    zone: input.zone,
  });
  assert.equal(result.postimage, testCase.expected.day, testCase.id + " postimage");
}

module.exports = {
  CANONICAL_DIR,
  FIXTURE_DIR,
  ALL_GROUPS,
  IMPLEMENTED_GROUPS,
  RESERVED_GROUPS,
  MODES,
  RUNNERS,
  validateSnoozeVectors,
  readSnoozeVectors,
  assertParseVector,
  assertWhenVector,
  assertLiveVector,
  assertCleanupVector,
};
