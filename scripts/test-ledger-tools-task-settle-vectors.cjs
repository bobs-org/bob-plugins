// Task settle twin vector test (bob-cli-q4.8.1.1 pure-twin).
//
// Runs every canonical settle vector through the built bob-ledger-tools
// bundle, asserting bytes, changed, surviving-line maps, warnings, and a
// second-pass no-op. The canonical contract is bob-cli's
// `tests/fixtures/task_settle/vectors.json`; the bundle copy must stay
// byte-identical (see test-ledger-tools-task-settle-copies.cjs).
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");
const {
  readFixture,
  assertSettleCase,
} = require("./task-settle-vectors.cjs");

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    class EmptyClass {}
    return {
      MarkdownRenderChild: EmptyClass,
      MarkdownView: EmptyClass,
      Notice: EmptyClass,
      Plugin: EmptyClass,
      normalizePath: (value) => value,
      parseYaml: () => ({}),
    };
  }
  if (request === "@codemirror/state") {
    return { Prec: { highest: (value) => value } };
  }
  if (request === "@codemirror/view") {
    return {
      EditorView: class EditorView {},
      keymap: { of: (value) => value },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers } = LedgerToolsPlugin;
Module._load = originalLoad;

const vectors = readFixture("bob-ledger-tools", "vectors.json");

test("settle vectors pin bytes, maps, and skip codes", () => {
  assert.equal(vectors.version, 1, "settle vectors version");
  for (const testCase of vectors.cases) {
    assertSettleCase(helpers, testCase, vectors);
  }
});

test("settle helpers are exported for tests", () => {
  for (const name of [
    "taskSettleFromStatusTypes",
    "taskSettleNote",
    "taskSettleTransform",
    "taskSettleLocalSchedules",
    "taskSettleGroupingEligible",
    "taskSettleCanonicalDailyDate",
    "taskSettleParseDayFileDate",
    "taskSettleIsBadgeRow",
    "taskSettleIsLegacyBadgeMarker",
    "taskSettleLogicalLines",
    "taskSettleTextValue",
  ]) {
    assert.equal(typeof helpers[name], "function", `${name} is exported`);
  }
});
