#!/usr/bin/env node
// Offline self-test for the real-Obsidian task requirements e2e.
"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { GROUPS, TOGGLE_CASES, TYPING_CASES, VIM_CASES, keyPayload } = require("./obsidian-task-reqs-e2e.cjs");

test("obsidian-task-reqs-e2e --self-test", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, "obsidian-task-reqs-e2e.cjs"), "--self-test"],
    { encoding: "utf8", timeout: 20_000 },
  );
  assert.equal(result.status, 0, (result.stdout || "") + "\n" + (result.stderr || ""));
  assert.match(String(result.stdout || ""), /offline self-test complete/);
});

test("every group has cases and every key builds a payload", () => {
  assert.deepEqual(GROUPS, ["typing", "vim", "toggle"]);
  for (const cases of [TYPING_CASES, VIM_CASES, TOGGLE_CASES]) {
    assert.ok(cases.length > 0);
    for (const entry of cases) {
      for (const input of entry.keys) assert.ok(keyPayload(input).key);
    }
  }
});

test("typing cases cover autopair on and off, absorption, Backspace, and Undo", () => {
  const names = TYPING_CASES.map((entry) => entry.name).join("\n");
  for (const needle of ["autopair on", "autopair off", "absorb", "atomic Backspace", "one Undo"]) {
    assert.ok(names.includes(needle), needle);
  }
});
