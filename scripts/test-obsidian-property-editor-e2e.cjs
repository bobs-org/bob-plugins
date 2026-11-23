#!/usr/bin/env node
// Offline wrapper for the real-Obsidian Property Editor proof. It validates
// the fixtures and fake-bob JSON boundary without launching Obsidian.
"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const lib = require("./obsidian-property-editor-e2e-lib.cjs");
const runner = require("./obsidian-property-editor-e2e.cjs");

test("obsidian-property-editor-e2e --self-test", () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, "obsidian-property-editor-e2e.cjs"), "--self-test"], {
    encoding: "utf8", timeout: 20_000,
  });
  assert.equal(result.status, 0, `${result.stdout || ""}\n${result.stderr || ""}`);
  assert.match(String(result.stdout || ""), /offline self-test complete/);
  assert.match(String(result.stdout || ""), /no Obsidian launched/);
});

test("runner advertises the complete editor acceptance matrix", () => {
  assert.equal(new Set(lib.ACCEPTANCE_CHECKS).size, lib.ACCEPTANCE_CHECKS.length);
  for (const check of [
    "project-edit-and-undo-redo", "project-add", "project-delete-and-undo", "day-note-edit",
    "record-field-handoff", "derived-key-locked", "old-bob-read-only", "invalid-yaml-recovery",
    "untouched-frontmatter-bytes-preserved", "screenshots-light-dark-narrow-wide",
  ]) assert.ok(lib.ACCEPTANCE_CHECKS.includes(check), check);
  assert.equal(typeof runner.run, "function");
  assert.throws(() => lib.parseArgs(["--executable"]), /requires a PATH/);
});
