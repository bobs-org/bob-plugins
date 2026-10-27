// Brand run indicator: model plus idempotent paint for indicator_label = brand,
// indicator_runs = all. Every run the engine owns lights it.
const test = require("node:test");
const assert = require("node:assert/strict");

const { helpers } = require("./command-mode-harness.cjs");

function chipEl() {
  const { ElementStub } = require("./modal-harness.cjs");
  return new ElementStub({ tag: "span", cls: "bob-cmd-chip" });
}

function run(id, elapsed, extra = {}) {
  const now = Date.parse("2026-10-26T15:00:00.000Z");
  return {
    id,
    title: extra.title || "Vault sync",
    outcome: extra.outcome || "running",
    effect: extra.effect || "writes",
    budget_secs: extra.budget_secs !== undefined ? extra.budget_secs : 180,
    started_at: new Date(now - elapsed).toISOString(),
    argv: extra.argv || ["/usr/bin/bob", "vault-sync", "run"],
    ...extra,
  };
}

const NOW = Date.parse("2026-10-26T15:00:00.000Z");

function labelText(chip) {
  const found = (chip.children || []).find((child) => (child.classes || []).includes("bob-cmd-chip-label"));
  return found ? found.textContent : "";
}

function clockText(chip) {
  const found = (chip.children || []).find((child) => (child.classes || []).includes("bob-cmd-chip-clock"));
  return found ? found.textContent : "";
}

test("hidden below 400 ms, and never settles for such runs", () => {
  const chip = chipEl();
  const state = { shown: new Set(), settle: null };
  const hidden = helpers.cmRenderStatusChip(chip, [run("one", 399, { title: "Quick" })], NOW, () => {}, () => "", state);
  assert.equal(hidden.visible, false);
  assert.equal(state.shown.size, 0);
  // A finish for a never-shown run must not settle.
  state.settle = null;
  const model = helpers.cmStatusChipModel([], NOW + 10, state, () => "");
  assert.equal(model.visible, false);
});

test("running keeps one mark element, brand label, tabular clock, and native tooltip", () => {
  const chip = chipEl();
  const opened = [];
  const state = { shown: new Set(), settle: null };
  const result = helpers.cmRenderStatusChip(chip, [run("one", 42000)], NOW, (id) => opened.push(id), () => "pulling", state);
  assert.equal(result.visible, true);
  const marks = (chip.children || []).filter((c) => (c.classes || []).includes("bob-cmd-chip-mark"));
  assert.equal(marks.length, 1);
  const first = marks[0];
  assert.equal(first.getAttribute("aria-hidden"), "true");
  helpers.cmRenderStatusChip(chip, [run("one", 42000)], NOW, () => {}, () => "pulling", state);
  const marksAfter = (chip.children || []).filter((c) => (c.classes || []).includes("bob-cmd-chip-mark"));
  assert.equal(marksAfter[0], first);
  assert.equal(labelText(chip), "bob");
  assert.equal(clockText(chip), "0:42");
  assert.match(chip.getAttribute("aria-label"), /Vault sync/);
  assert.match(chip.getAttribute("aria-label"), /bob vault-sync run/);
  assert.match(chip.getAttribute("aria-label"), /Last: pulling/);
  assert.equal(chip.getAttribute("title"), undefined);
  assert.equal(chip.getAttribute("data-tooltip-position"), "top");
});

test("two runs show count, longest clock, and click opens the newest", () => {
  const chip = chipEl();
  const opened = [];
  const state = { shown: new Set(), settle: null };
  const result = helpers.cmRenderStatusChip(
    chip,
    [run("one", 10000, { title: "Scan" }), run("two", 2000, { title: "Plan" })],
    NOW,
    (id) => opened.push(id),
    () => "",
    state,
  );
  assert.equal(result.runs, 2);
  assert.equal(labelText(chip), "bob ×2");
  assert.equal(clockText(chip), "0:10");
  chip.onclick();
  assert.deepEqual(opened, ["two"]);
});

test("queued-only gives is-queued and overdue writer gives is-overdue with budget tooltip", () => {
  const chip = chipEl();
  const state = { shown: new Set(), settle: null };
  helpers.cmRenderStatusChip(chip, [run("q", 5000, { outcome: "queued" })], NOW, () => {}, () => "", state);
  assert.ok(chip.classList.contains("is-queued"));
  const chip2 = chipEl();
  const state2 = { shown: new Set(), settle: null };
  const overdue = helpers.cmRenderStatusChip(chip2, [run("late", 181000)], NOW, () => {}, () => "", state2);
  assert.equal(overdue.overdue, true);
  assert.ok(chip2.classList.contains("is-overdue"));
  assert.match(chip2.getAttribute("aria-label"), /past its ~3 min budget/);
});

test("settle shows outcome glyph for 1600 ms, then leaving, then hidden", () => {
  const chip = chipEl();
  const state = { shown: new Set(["done"]), settle: { runId: "done", title: "Deploy", outcome: "completed", durationMs: 4312, atMs: NOW } };
  const settled = helpers.cmRenderStatusChip(chip, [], NOW + 500, () => {}, () => "", state);
  assert.equal(settled.visible, true);
  assert.ok(chip.classList.contains("is-settled"));
  assert.ok(chip.classList.contains("is-completed"));
  assert.equal(clockText(chip), "0:04");
  assert.match(chip.getAttribute("aria-label"), /Deploy · Completed in 0:04/);
  const leavingAt = NOW + 1600 - 200;
  const leaving = helpers.cmRenderStatusChip(chip, [], leavingAt, () => {}, () => "", state);
  assert.equal(leaving.visible, true);
  assert.ok(chip.classList.contains("is-leaving"));
  const gone = helpers.cmRenderStatusChip(chip, [], NOW + 1700, () => {}, () => "", state);
  assert.equal(gone.visible, false);
  const failedState = { shown: new Set(["f"]), settle: { runId: "f", title: "Sync", outcome: "failed", durationMs: 1201, atMs: NOW } };
  const chip2 = chipEl();
  const failed = helpers.cmRenderStatusChip(chip2, [], NOW + 500, () => {}, () => "", failedState);
  assert.equal(failed.visible, true);
  assert.ok(chip2.classList.contains("is-failed"));
});

test("a new run during a settle shows running at once and click opens the settled run", () => {
  const chip = chipEl();
  const opened = [];
  const state = { shown: new Set(["done"]), settle: { runId: "done", title: "Deploy", outcome: "completed", durationMs: 4000, atMs: NOW } };
  const result = helpers.cmRenderStatusChip(chip, [run("next", 5000, { title: "Next" })], NOW + 600, (id) => opened.push(id), () => "", state);
  assert.equal(result.visible, true);
  assert.ok(chip.classList.contains("is-running"));
  assert.equal(state.settle, null);
  // Settle click and Enter open the settled run.
  const chip2 = chipEl();
  const opened2 = [];
  const state2 = { shown: new Set(["done"]), settle: { runId: "done", title: "Deploy", outcome: "completed", durationMs: 4000, atMs: NOW } };
  const settled = helpers.cmRenderStatusChip(chip2, [], NOW + 500, (id) => opened2.push(id), () => "", state2);
  assert.equal(settled.runId, "done");
  chip2.onclick();
  assert.deepEqual(opened2, ["done"]);
});

test("adopted unfinished runs appear flagged and all triggers light the indicator", () => {
  const chip = chipEl();
  const state = { shown: new Set(), settle: null };
  const adopted = run("adopt", 9000, { adopted: true, title: "Adopted" });
  const result = helpers.cmRenderStatusChip(chip, [adopted], NOW, () => {}, () => "", state);
  assert.equal(result.visible, true);
  assert.match(chip.getAttribute("aria-label"), /adopted after reload/);
  // indicator_runs = all: palette-triggered runs light the indicator (no sheet filter).
  const palette = run("pal", 5000, { title: "Palette", trigger: "command" });
  const model = helpers.cmStatusChipModel([palette], NOW, null, () => "");
  assert.equal(model.visible, true);
});
