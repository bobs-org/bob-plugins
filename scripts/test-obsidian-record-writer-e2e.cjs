#!/usr/bin/env node
// Offline self-test for the record-writer real-bob acceptance.
// Never launches Obsidian.
"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

test("obsidian-record-writer-e2e --self-test", (t) => {
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, "obsidian-record-writer-e2e.cjs"), "--self-test"],
    { encoding: "utf8", timeout: 300_000 },
  );
  assert.equal(result.status, 0, `${result.stdout || ""}\n${result.stderr || ""}`);
  if (/^UNRUN:/m.test(String(result.stdout || ""))) {
    t.skip(String(result.stdout || "").trim());
    return;
  }
  assert.match(String(result.stdout || ""), /offline record-writer self-test complete/);
});
