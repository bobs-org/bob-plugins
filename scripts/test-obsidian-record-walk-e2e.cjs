#!/usr/bin/env node
// Offline harness validation; real editor acceptance is the sibling script.
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");
const script = path.join(__dirname, "obsidian-record-walk-e2e.cjs");
test("record walk e2e validates canonical fixture lines offline", () => {
  const result = spawnSync(process.execPath, [script, "--self-test"], { encoding: "utf8", timeout: 20000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /offline record-walk self-test complete/);
});
test("unavailable Obsidian reports a skip, never a passing walkthrough", () => {
  const result = spawnSync(process.execPath, [script, "-e", path.join(__dirname, "missing-electron")], { encoding: "utf8", timeout: 20000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "skipped");
});
