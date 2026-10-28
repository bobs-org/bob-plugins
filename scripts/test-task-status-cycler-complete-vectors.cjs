// Relation-complete `done` vectors: the cycler api v3 Done line rewrite
// and post-Done pass (`docs/task-relations.md` §18 CP8). bob-cli owns
// `tests/fixtures/relation_complete/vectors.json`; the copy under
// `plugins/bob-navigation-hotkeys/scripts/fixtures/relation_complete/`
// is byte-for-byte identical and is never hand-edited.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  TaskStatusCyclerPlugin,
  helpers,
  createTextEditor,
} = require("./task-status-cycler-harness.cjs");

const vectorsPath = path.join(
  __dirname,
  "../plugins/bob-navigation-hotkeys/scripts/fixtures/relation_complete/vectors.json",
);
const vectors = JSON.parse(fs.readFileSync(vectorsPath, "utf8"));

test("cycler api v3 exposes the Done line rewrite and post-Done pass frozen", () => {
  const plugin = new TaskStatusCyclerPlugin();
  plugin.addCommand = () => {};
  plugin.registerEvent = () => {};
  plugin.registerChildBulletInputListeners = () => {};
  plugin.registerPomodoroBulletToggleInputListeners = () => {};
  plugin.registerCountedTaskCycleInputListeners = () => {};
  plugin.app = {
    workspace: { on: () => ({}), onLayoutReady: () => {} },
    vault: { on: () => ({}) },
  };
  plugin.onload();

  assert.equal(plugin.api.version, 3);
  assert.equal(Object.isFrozen(plugin.api), true);
  assert.equal(typeof plugin.api.recoverBlockedDependents, "function");
  assert.equal(typeof plugin.api.completeTaskAtCursor, "function");
  assert.equal(typeof plugin.api.completeTaskLineText, "function");
  assert.equal(typeof plugin.api.finalizeClosedTasks, "function");
});

test("done vectors pin completeTaskLineText", () => {
  assert.ok(Array.isArray(vectors.done) && vectors.done.length > 0);
  assert.ok(Array.isArray(vectors.rule) && vectors.rule.length > 0);
  assert.ok(Array.isArray(vectors.key) && vectors.key.length > 0);
  assert.ok(Array.isArray(vectors.config) && vectors.config.length > 0);
  const plugin = new TaskStatusCyclerPlugin();
  for (const vector of vectors.done) {
    if (vector.expected.ok && !vector.expected.unchanged) {
      const actual = plugin.completeTaskLineText(vector.line, {
        date: vector.date,
      });
      assert.equal(actual, vector.expected.line, vector.name);
      // The api delegates to the same local-fallback bytes Ctrl+Enter writes.
      assert.equal(
        helpers.rewriteTaskLineForLocalFallback(vector.line, "x", vector.date),
        vector.expected.line,
        `${vector.name}: fallback`,
      );
      continue;
    }
    // Already-closed lines stay unchanged (the writer relabels only and
    // never asks the cycler to rewrite); recurring lines are refused.
    assert.equal(vector.expected.line, vector.line, vector.name);
    if (!vector.expected.ok) {
      assert.equal(vector.expected.reason, "recurring", vector.name);
    } else {
      assert.equal(vector.expected.unchanged, true, vector.name);
    }
  }
});

test("Ctrl+Enter local fallback shares the api Done bytes", () => {
  const plugin = new TaskStatusCyclerPlugin();
  for (const vector of vectors.done) {
    if (!vector.expected.ok || vector.expected.unchanged) {
      continue;
    }
    plugin.getCompletionDateString = () => vector.date;
    const editor = createTextEditor(vector.line, { line: 0, ch: 0 });
    const taskStatus = helpers.getTaskStatusForLine(vector.line, 0);
    assert.ok(taskStatus, vector.name);
    const wrote = plugin.setActiveCheckboxStatusLocalWithTaskMetadata(
      editor,
      taskStatus,
      "x",
    );
    assert.equal(wrote, true, vector.name);
    assert.equal(editor.getLine(0), vector.expected.line, vector.name);
  }
});
