const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.join(__dirname, "..");
const pluginDir = path.join(repoRoot, "plugins", "bob-emoji");

test("generated catalog exactly matches the vendored gemoji database", () => {
  const result = spawnSync(process.execPath, [
    path.join(repoRoot, "scripts", "gen-emoji-catalog.mjs"),
    "--check",
  ], { cwd: repoRoot, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const fragments = JSON.parse(fs.readFileSync(path.join(pluginDir, "src", "fragments.json"), "utf8"))
    .filter((name) => /-emoji-catalog-[a-z]\.js$/.test(name));
  assert.ok(fragments.length >= 2);
  for (const fragment of fragments) {
    const contents = fs.readFileSync(path.join(pluginDir, "src", fragment), "utf8");
    assert.ok(contents.split(/\r?\n/).length - 1 <= 1000, fragment + " exceeds 1000 lines");
  }
});
