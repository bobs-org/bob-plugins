#!/usr/bin/env node
// Offline contract checks for the real-Obsidian requirement close-card e2e.
"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { cases, selfTest } = require("./obsidian-req-close-card-e2e.cjs");

test("obsidian-req-close-card-e2e offline self-test", () => {
  assert.doesNotThrow(selfTest);
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, "obsidian-req-close-card-e2e.cjs"), "--self-test"],
    { encoding: "utf8", timeout: 20_000 },
  );
  assert.equal(result.status, 0, (result.stdout || "") + "\n" + (result.stderr || ""));
  assert.match(String(result.stdout || ""), /offline requirement close-card e2e self-test/);
});

test("real Obsidian close-card cases cover the required public gestures", () => {
  const names = cases.map((entry) => entry.name).join("\n");
  for (const needle of [
    "idless Ctrl+Enter shows requirements first",
    "drop writes receipt and guarded Undo keeps owner Done",
    "carry creates task and carried stub",
    "nested requirement pin lands then Ctrl+O returns",
    "Esc writes no requirement bytes",
    "direct Ctrl+Shift+T carries and Ctrl+O returns",
  ]) assert.ok(names.includes(needle), needle);
});
