const test = require("node:test");
const assert = require("node:assert/strict");

const { helpers, NavigationHotkeysPlugin } = require("./navigation-hotkeys-harness.cjs");

test("fallback yields to tasks, links, dependencies, counts, and direct stages", () => {
  const base = {
    countExplicit: false, hasTaskSession: false,
    initialProperty: null, initialTaskCardRow: null, directStage: false,
    reopenBlocks: false, reopenLinks: false, reopenLinkedFrom: false,
    isTask: false, isLink: false, hasDependencyEntry: false,
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

test("fallback is available on any unclaimed row; direct target resolution stays album-only", () => {
  const base = {
    countExplicit: false, hasTaskSession: false,
    initialProperty: null, initialTaskCardRow: null, directStage: false,
    reopenBlocks: false, reopenLinks: false, reopenLinkedFrom: false,
    isTask: false, isLink: false, hasDependencyEntry: false,
  };
  assert.equal(helpers.albumSchemaFallbackGate(base).attempt, true);
  assert.equal(helpers.albumSchemaFallbackGate({ ...base, isBullet: false }).attempt, true);
});

test("Task Card command routes a title row to the direct album Schema Card", () => {
  const plugin = new NavigationHotkeysPlugin();
  const opens = [];
  const ledger = {
    albumHeaderDesktop: () => true,
    albumSchemaEntryTargetForFile: (filePath) => ({
      ok: true, kind: filePath === "eat.md" ? "album" : "record", albumPath: "eat.md",
    }),
    openAlbumSchemaEntry: (options) => { opens.push(options); return { ok: true }; },
  };
  const editor = {
    getValue: () => "# Eat\n\n- [ ] task",
    getLine: (line) => ["# Eat", "", "- [ ] task"][line] ?? null,
    getCursor: () => ({ line: 0, ch: 2 }),
  };
  plugin.app = { plugins: { plugins: { "bob-ledger-tools": ledger } } };
  plugin.getActiveMarkdownView = () => ({ editor, file: { path: "eat.md" } });

  assert.equal(plugin.openBulletPropertyPicker(editor), true);
  assert.deepEqual(opens, [{ filePath: "eat.md" }]);
});
