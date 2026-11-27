// Guard: unit/perf processes cannot see the real vault or state.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const SENTINEL_VAULT = "/definitely/missing/bob-plugins-test-vault";
const REPO_ROOT = path.join(__dirname, "..");
const PLUGIN_BOOTING_HARNESSES = [
  "scripts/block-id-prompt-harness.cjs",
  "scripts/command-mode-harness.cjs",
  "scripts/ledger-tools-harness.cjs",
  "scripts/navigation-dependencies-stage-harness.cjs",
  "scripts/navigation-hotkeys-harness.cjs",
  "scripts/navigation-review-gestures-harness.cjs",
  "scripts/task-status-cycler-harness.cjs",
];

test("unit and perf processes pin a missing vault and tmp state", () => {
  assert.equal(process.env.BOB_DIR, SENTINEL_VAULT);
  assert.ok(
    typeof process.env.XDG_STATE_HOME === "string"
      && process.env.XDG_STATE_HOME.startsWith(os.tmpdir()),
    `XDG_STATE_HOME ${process.env.XDG_STATE_HOME} is under os.tmpdir()`,
  );
});

test("test:unit and test:perf preload the hermetic env", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  for (const script of ["test:unit", "test:perf"]) {
    const command = pkg.scripts[script];
    assert.ok(
      command.includes("--require ./scripts/hermetic-bob-env.cjs"),
      `${script} preloads hermetic-bob-env.cjs: ${command.slice(0, 80)}…`,
    );
  }
});

test("plugin-booting harnesses require the hermetic env", () => {
  for (const relative of PLUGIN_BOOTING_HARNESSES) {
    const source = fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
    assert.ok(
      source.includes('require("./hermetic-bob-env.cjs")'),
      `${relative} requires hermetic-bob-env.cjs`,
    );
  }
});
