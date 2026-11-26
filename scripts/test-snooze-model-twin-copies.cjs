const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  CANONICAL_DIR,
  IMPLEMENTED_GROUPS,
  readSnoozeVectors,
} = require("./snooze-model-vectors.cjs");
const { helpers: ledgerTools } = require("./ledger-tools-harness.cjs");
const { helpers: navigation } = require("./navigation-hotkeys-harness.cjs");
const { helpers: blockIdPrompt } = require("./block-id-prompt-harness.cjs");
const { helpers: taskStatusCycler } = require("./task-status-cycler-harness.cjs");

const ROOT = path.join(__dirname, "..");
const PLUGINS = Object.freeze([
  { id: "bob-ledger-tools", helpers: ledgerTools, firstPrefix: 61, export: "380-snooze-model-exports.js" },
  { id: "bob-navigation-hotkeys", helpers: navigation, firstPrefix: 91, export: "736-snooze-model-exports.js" },
  { id: "block-id-prompt", helpers: blockIdPrompt, firstPrefix: 91, export: "173-snooze-model-exports.js" },
  { id: "task-status-cycler", helpers: taskStatusCycler, firstPrefix: 91, export: "214-snooze-model-exports.js" },
]);
const SUFFIXES = ["rows-twin.js", "when-twin.js", "state-twin.js", "cleanup-twin.js"];
const fragment = (prefix, suffix) => String(prefix).padStart(3, "0") + "-snooze-" + suffix;
const src = (plugin, name) => path.join(ROOT, "plugins", plugin, "src", name);
const manifest = (plugin) => JSON.parse(fs.readFileSync(src(plugin, "fragments.json"), "utf8"));

test("all snooze model source twins are byte-identical to ledger-tools", () => {
  for (let index = 0; index < SUFFIXES.length; index += 1) {
    const suffix = SUFFIXES[index];
    const source = fs.readFileSync(src("bob-ledger-tools", fragment(61 + index, suffix)));
    for (const plugin of PLUGINS.slice(1)) {
      const copyName = fragment(plugin.firstPrefix + index, suffix);
      assert.ok(fs.readFileSync(src(plugin.id, copyName)).equals(source), plugin.id + " " + copyName + " matches ledger-tools");
    }
  }
});

test("model fragments are ordered before consumers and present verbatim in each built bundle", () => {
  for (const plugin of PLUGINS) {
    const files = manifest(plugin.id);
    const modelNames = SUFFIXES.map((suffix, index) => fragment(plugin.firstPrefix + index, suffix));
    const positions = modelNames.map((name) => files.indexOf(name));
    positions.forEach((position, index) => {
      assert.ok(position >= 0, plugin.id + " lists " + modelNames[index]);
      if (index > 0) assert.ok(position > positions[index - 1], plugin.id + " keeps the model fragment order");
    });
    assert.ok(files.indexOf(plugin.export) > positions[positions.length - 1], plugin.id + " exports after model definitions");
    const bundle = fs.readFileSync(path.join(ROOT, "plugins", plugin.id, "main.js"), "utf8");
    for (const name of modelNames) {
      const text = fs.readFileSync(src(plugin.id, name), "utf8");
      assert.ok(bundle.includes("// ---- src/" + name + " ----\n" + text), plugin.id + " bundle includes " + name);
    }
  }
  const modelKeys = Object.keys(ledgerTools.snoozeModel).sort();
  for (const plugin of PLUGINS.slice(1)) assert.deepEqual(Object.keys(plugin.helpers.snoozeModel).sort(), modelKeys, plugin.id + " exposes the same model surface");
  assert.deepEqual(IMPLEMENTED_GROUPS, ["rows", "when", "live", "cleanup"]);
});

test("all plugin snooze fixture copies match the canonical bob-cli fixture", () => {
  const canonical = fs.readFileSync(path.join(CANONICAL_DIR, "vectors.json"));
  for (const plugin of PLUGINS) {
    const copy = path.join(ROOT, "plugins", plugin.id, "scripts", "fixtures", "snooze", "vectors.json");
    assert.ok(fs.readFileSync(copy).equals(canonical), plugin.id + " snooze vectors match bob-cli byte for byte");
    const fixture = readSnoozeVectors(plugin.id);
    assert.deepEqual(Object.keys(fixture.groups).sort(), ["cleanup", "live", "rows", "snooze", "wake", "when"]);
  }
});
