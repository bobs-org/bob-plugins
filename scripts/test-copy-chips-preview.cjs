#!/usr/bin/env node
// Offline check for scripts/preview-copy-chips.cjs: the page assembles
// from the built plugin under Obsidian's button rules, and the matrix
// covers every state, surface, card, and sweep layout. No browser.
"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

test("preview-copy-chips --self-test", () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, "preview-copy-chips.cjs"), "--self-test"], { encoding: "utf8", timeout: 60_000 });
  assert.equal(result.status, 0, (result.stdout || "") + "\n" + (result.stderr || ""));
  assert.match(String(result.stdout || ""), /offline self-test complete/);
});
