#!/usr/bin/env node
// Offline checks for the real-Obsidian command-chips e2e harness: fixture,
// stub bob, isolation boundaries, and a graceful skip without Obsidian.
"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const SCRIPT = path.join(__dirname, "obsidian-command-chips-e2e.cjs");

test("obsidian-command-chips-e2e --self-test", () => {
  const result = spawnSync(process.execPath, [SCRIPT, "--self-test"], { encoding: "utf8", timeout: 60_000 });
  assert.equal(result.status, 0, (result.stdout || "") + "\n" + (result.stderr || ""));
  assert.match(String(result.stdout || ""), /offline self-test complete/);
});

test("a missing Obsidian binary reports a graceful skip", () => {
  const result = spawnSync(process.execPath, [SCRIPT, "--executable", path.join(__dirname, "missing-obsidian-binary")], {
    encoding: "utf8",
    timeout: 20_000,
  });
  assert.equal(result.status, 0, (result.stdout || "") + "\n" + (result.stderr || ""));
  const output = JSON.parse(String(result.stdout || "{}"));
  assert.equal(output.status, "skipped");
  assert.match(output.reason, /unavailable/);
});
