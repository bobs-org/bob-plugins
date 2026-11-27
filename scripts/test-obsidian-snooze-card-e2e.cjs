"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

test("obsidian-snooze-card-e2e --self-test", () => {
  const runner = path.join(__dirname, "obsidian-snooze-card-e2e.cjs");
  const result = spawnSync(process.execPath, [runner, "--self-test"], {
    encoding: "utf8",
    timeout: 20_000,
    env: { ...process.env, TMPDIR: process.cwd() },
  });
  assert.equal(result.status, 0, `${result.stdout || ""}\n${result.stderr || ""}`);
  assert.match(String(result.stdout || ""), /offline self-test complete/);
});
