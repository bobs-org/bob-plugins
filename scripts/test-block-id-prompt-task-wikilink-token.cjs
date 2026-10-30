const test = require("node:test");
const assert = require("node:assert/strict");
const { helpers } = require("./block-id-prompt-harness.cjs");
const vectors = require("./fixtures/task_wikilinks/trigger_vectors.json");

function resolveCh(text, ch) {
  return ch === "end" ? text.length : ch;
}

function normalizeToken(token) {
  if (token === null || token === undefined) {
    return null;
  }
  return {
    query: token.query,
    replace: [token.replaceStart, token.replaceEnd],
    closed: token.closer !== null && token.closer !== undefined,
    removal: {
      start: token.removal.start,
      end: token.removal.end,
      caretCh: token.removal.caretCh,
    },
  };
}

test("task-wikilink trigger vectors match bob's shared core", () => {
  assert.ok(Array.isArray(vectors.tokens) && vectors.tokens.length > 0);
  for (const vector of vectors.tokens) {
    const actual = normalizeToken(
      helpers.findTaskWikilinkToken(vector.line, resolveCh(vector.line, vector.ch)),
    );
    assert.deepEqual(actual, vector.expected, vector.name);
  }
});

test("task-wikilink context vectors allow prose and exclude note-only spans", () => {
  assert.ok(Array.isArray(vectors.contexts) && vectors.contexts.length > 0);
  for (const vector of vectors.contexts) {
    const lineText = vector.doc[vector.line];
    const actual = helpers.taskWikilinkContextAt(
      vector.doc,
      vector.line,
      resolveCh(lineText, vector.ch),
    );
    assert.deepEqual(actual, vector.expected, vector.name);
  }
});

test("task-wikilink written-second-paren vectors gate auto-open on user input", () => {
  assert.ok(Array.isArray(vectors.writtenParen) && vectors.writtenParen.length > 0);
  for (const vector of vectors.writtenParen) {
    const token = helpers.findTaskWikilinkToken(vector.line, resolveCh(vector.line, vector.ch));
    assert.equal(
      helpers.taskWikilinkWrittenSecondParen(token, vector.ranges, vector.lineStart),
      vector.expected,
      vector.name,
    );
  }
});

test("findTaskWikilinkToken rejects unusable caret positions", () => {
  assert.equal(helpers.findTaskWikilinkToken("((", -1), null);
  assert.equal(helpers.findTaskWikilinkToken("((", 3), null);
  assert.equal(helpers.findTaskWikilinkToken("((", "end"), null);
  assert.equal(helpers.findTaskWikilinkToken("", 0), null);
  assert.equal(helpers.findTaskWikilinkToken(null, 0), null);
});

test("taskWikilinkContextAt rejects unusable positions", () => {
  assert.deepEqual(helpers.taskWikilinkContextAt([], 0, 0), { allowed: false, notice: null });
  assert.deepEqual(helpers.taskWikilinkContextAt(["ok"], 5, 0), { allowed: false, notice: null });
  assert.deepEqual(helpers.taskWikilinkContextAt(["ok"], 0, 9), { allowed: false, notice: null });
  assert.deepEqual(helpers.taskWikilinkContextAt(["ok"], 0, -1), { allowed: false, notice: null });
});

test("addTaskWikilinkChanges records insertions and maps earlier ranges forward", () => {
  const ranges = [];
  helpers.addTaskWikilinkChanges(ranges, [{ from: 10, to: 10, text: "((" }]);
  assert.deepEqual(ranges, [{ start: 10, end: 12 }]);

  helpers.addTaskWikilinkChanges(ranges, [{ from: 12, to: 12, text: "fo" }]);
  assert.deepEqual(ranges, [
    { start: 10, end: 12 },
    { start: 12, end: 14 },
  ]);
});

test("addTaskWikilinkChanges accepts the wrapper and CodeMirror spellings", () => {
  const fromArray = [];
  helpers.addTaskWikilinkChanges(fromArray, [{ from: 4, to: 4, text: "x" }]);
  const fromWrapper = [];
  helpers.addTaskWikilinkChanges(fromWrapper, { changes: [{ from: 4, to: 4, insert: "x" }] });
  assert.deepEqual(fromArray, fromWrapper);

  const replaced = [{ start: 0, end: 8 }];
  helpers.addTaskWikilinkChanges(replaced, [{ from: 2, to: 5, text: "xy" }]);
  assert.deepEqual(replaced, [
    { start: 0, end: 7 },
    { start: 2, end: 4 },
  ]);
});

test("mapTaskWikilinkRanges maps without recording", () => {
  const ranges = [{ start: 10, end: 12 }];
  const returned = helpers.mapTaskWikilinkRanges(ranges, [{ from: 0, to: 0, text: "ab" }]);
  assert.equal(returned, ranges);
  assert.deepEqual(ranges, [{ start: 12, end: 14 }]);

  const collapsed = [{ start: 5, end: 9 }];
  helpers.mapTaskWikilinkRanges(collapsed, [{ from: 4, to: 10, text: "" }]);
  assert.deepEqual(collapsed, [{ start: 4, end: 4 }]);
});

test("mapTaskWikilinkRanges tolerates array ranges and empty sets", () => {
  const ranges = [[10, 12]];
  helpers.mapTaskWikilinkRanges(ranges, [{ from: 0, to: 0, text: "ab" }]);
  assert.deepEqual(ranges, [[12, 14]]);

  const untouched = [{ start: 1, end: 2 }];
  helpers.mapTaskWikilinkRanges(untouched, []);
  helpers.mapTaskWikilinkRanges(untouched, null);
  assert.deepEqual(untouched, [{ start: 1, end: 2 }]);
});
