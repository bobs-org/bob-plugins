#!/usr/bin/env node
// Offline self-test for the real-Obsidian quick-roll e2e.
"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

test("obsidian-quick-roll-e2e --self-test", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, "obsidian-quick-roll-e2e.cjs"), "--self-test"],
    { encoding: "utf8", timeout: 20_000 },
  );
  assert.equal(result.status, 0, `${result.stdout || ""}\n${result.stderr || ""}`);
  assert.match(String(result.stdout || ""), /offline self-test complete/);
});
