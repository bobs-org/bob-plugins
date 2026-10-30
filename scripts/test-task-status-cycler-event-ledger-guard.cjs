const assert = require("node:assert/strict");
const test = require("node:test");
const { helpers } = require("./task-status-cycler-harness.cjs");

const DATE = "2026-10-30";

test("task demotion refuses the Pomodoros destination", () => {
  const lines = [
    "## Events",
    "",
    "- [ ] #task **0900-0930** Dentist [root:: body] ^dentist",
    "## Pomodoros",
    "",
    "- [ ] () — MEET",
  ];
  const plan = helpers.getObsidianTaskToggleDocumentPlan(lines, 2, 0, DATE);
  assert.equal(plan.mode, "refuse");
  assert.match(plan.message, /stay out of the Pomodoros ledger/);
  assert.equal(plan.nextLines, undefined);
});

test("task demotion may still move into other sections", () => {
  const lines = [
    "## Notes",
    "",
    "- [ ] #task Ship it",
    "## Later",
  ];
  const plan = helpers.getObsidianTaskToggleDocumentPlan(lines, 2, 0, DATE);
  assert.equal(plan.mode, "move");
  assert.equal(plan.targetSection, "nextSection");
});

test("counted demotion refuses a Pomodoros destination if any moved row is a task", () => {
  const lines = [
    "## Events",
    "- [ ] #task First event",
    "- [ ] #task Second event",
    "## Pomodoros",
    "- [ ] () — MEET",
  ];
  const plan = helpers.getObsidianTaskToggleRangeDocumentPlan(lines, 1, 0, DATE, 1);
  assert.equal(plan.mode, "refuse");
});
