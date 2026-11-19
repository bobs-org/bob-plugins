const assert = require("node:assert/strict");
const test = require("node:test");
const { helpers: chipHelpers } = require("./copy-chips-test-helpers.cjs");
const { helpers: navHelpers } = require("./navigation-hotkeys-harness.cjs");
const {
  sampleCpuWork,
  isWithinCpuBudget,
  cpuBudgetDiagnostic,
} = require("./cpu-work-perf-support.cjs");

const BUDGET_MS = 50;

function makeTaskNote() {
  const lines = ["- [ ] #task Scope performance ^scope-perf"];
  let inline = 0;
  for (let index = 0; index < 400; index += 1) {
    if (index === 60 || index === 260) {
      lines.push("  ```bob-copy Scoped fence " + index);
      lines.push("  fence payload " + index);
      lines.push("  ```");
    } else if (index === 120 || index === 320) {
      lines.push("  ```js");
      lines.push("  `copy: inert fenced sample`");
      lines.push("  ```");
    } else if (inline < 38 && (index % 10 === 0 || index === 5 || index === 15)) {
      lines.push("  - `copy: payload-" + inline + "`");
      inline += 1;
    } else {
      lines.push("  - child note line " + index);
    }
  }
  for (let index = 0; index < 1591; index += 1) {
    lines.push("Top-level padding line " + index);
  }
  return { lines, inline };
}

test("2,000-line task, scope, and chip resolution fit the 50 ms CPU budget", () => {
  const { lines, inline } = makeTaskNote();
  assert.equal(lines.length, 2000);
  assert.equal(inline, 38);
  const taskRequest = [{
    anchor: { line: 0, ch: 0 },
    head: { line: 0, ch: 0 },
  }];
  let last = null;
  const makeRun = () => () => {
    const task = navHelpers.resolveCopyCardTask(lines, taskRequest);
    if (task.state !== "ready" || task.line !== 0) throw new Error("task did not resolve");
    const scope = navHelpers.copyCardTaskScopeLines(lines, task.line);
    if (scope.length < 400) throw new Error("scope lost child lines");
    const result = chipHelpers.copyChipAt({
      lines,
      line: 0,
      ch: 5,
      scope: { kind: "task", lines: scope },
    });
    if (result.state !== "ambiguous" || result.count !== 40 || result.scope !== "task") {
      throw new Error("expected 40 scoped chips, got " + JSON.stringify(result));
    }
    last = { task, scope, result };
  };
  const { cpuSamples, wallSamples } = sampleCpuWork(makeRun, { warmups: 3, samples: 7 });
  assert.equal(last.result.count, 40);
  assert.ok(
    isWithinCpuBudget(cpuSamples, BUDGET_MS),
    cpuBudgetDiagnostic("Copy card task-scope resolve (2,000 lines)", cpuSamples, wallSamples, BUDGET_MS),
  );
});
