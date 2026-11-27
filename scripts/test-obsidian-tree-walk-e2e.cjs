#!/usr/bin/env node
// Offline validation for the real-Obsidian link-walk acceptance runner.
"use strict";
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");
const script = path.join(__dirname, "obsidian-tree-walk-e2e.cjs");

test("tree-walk runner validates all fixtures and keys offline", () => {
  const result = spawnSync(process.execPath, [script, "--self-test"], { encoding: "utf8", timeout: 20_000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /offline tree-walk self-test complete/);
});

test("unavailable Obsidian reports a skip, never a passing walkthrough", () => {
  const result = spawnSync(process.execPath, [script, "-e", path.join(__dirname, "missing-electron")], {
    encoding: "utf8", timeout: 20_000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "skipped");
});
