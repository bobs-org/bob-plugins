#!/usr/bin/env node
// Offline self-test for the real-Obsidian task drawers e2e.
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const {
  GROUPS,
  TYPING_CASES,
  VIM_CASES,
  TOGGLE_CASES,
  REQ_CASES,
} = require("./obsidian-task-drawers-e2e.cjs");
const look = require("./obsidian-task-drawers-look-e2e.cjs");
const conversion = require("./obsidian-task-drawers-conversion-e2e.cjs");
const { keyPayload } = require("./obsidian-task-reqs-e2e.cjs");

test("obsidian-task-drawers-e2e --self-test", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, "obsidian-task-drawers-e2e.cjs"), "--self-test"],
    { encoding: "utf8", timeout: 20_000 },
  );
  assert.equal(result.status, 0, (result.stdout || "") + "\n" + (result.stderr || ""));
  assert.match(String(result.stdout || ""), /offline self-test complete/);
});

test("every group has cases and every typing key builds a payload", () => {
  assert.deepEqual(GROUPS, ["typing", "vim", "toggle", "req", "conversion", "look"]);
  assert.ok(TYPING_CASES.length > 0);
  assert.ok(VIM_CASES.length > 0);
  assert.ok(TOGGLE_CASES.length > 0);
  assert.ok(REQ_CASES.length > 0);
  assert.ok(conversion.CASES.length > 0);
  assert.ok(look.CASES.length > 0);
  for (const entry of TYPING_CASES.concat(VIM_CASES, REQ_CASES)) {
    for (const input of entry.keys || []) assert.ok(keyPayload(input).key);
  }
});

test("typing cases cover autopair on and off, Undo, Enter, overtype, and Backspace", () => {
  const names = TYPING_CASES.map((entry) => entry.name).join("\n");
  for (const needle of [
    "autopair on",
    "autopair off",
    "one Undo returns the literal star",
    "smart Enter nested note",
    "overtype closing stars",
    "atomic Backspace",
    "ordinary italic",
  ]) {
    assert.ok(names.includes(needle), needle);
  }
});

test("toggle, conversion, and look cover wrap, refusal, titles, and themes", () => {
  const toggle = TOGGLE_CASES.map((entry) => entry.name).join("\n");
  assert.ok(toggle.includes("wraps a plain title"));
  assert.ok(toggle.includes("unwraps a bold header"));
  assert.ok(toggle.includes("legacy drawer"));
  assert.ok(toggle.includes("reserved title"));
  assert.ok(conversion.AREA.includes("**API Design**"));
  assert.ok(conversion.AREA.includes("**API  Design**"));
  assert.ok(conversion.AREA.includes("**C++ Notes**"));
  assert.ok(conversion.AREA.includes("**Q1: Goals**"));
  assert.ok(conversion.AREA.includes("**Café**"));
  assert.ok(conversion.AREA.includes("**Empty**"));
  assert.ok(conversion.REFUSAL_PROJECT.includes("## Options:"));
  const lookNames = look.CASES.map((entry) => entry.name).join("\n");
  assert.ok(lookNames.includes("light live"));
  assert.ok(lookNames.includes("dark reading"));
  const lookSource = fs.readFileSync(path.join(__dirname, "obsidian-task-drawers-look-e2e.cjs"), "utf8");
  for (const assertion of [
    "foldedOpen.folded, true",
    "foldedOpen.after, /2/",
    "drawer count refresh after an edit",
    "refoldedOpen.after, /3/",
    "native delimiters restore their resting appearance",
    "drawer descendants keep ordinary note typography",
    "settings off removes every owned drawer attribute",
    "settings off does not change Markdown",
    "tray width",
  ]) {
    assert.ok(lookSource.includes(assertion), assertion);
  }
  assert.ok(REQ_CASES[0].keys.includes("["));
});
