#!/usr/bin/env node
// Offline wrapper for the real-Obsidian intention card runner. It validates
// fixtures, clocks, byte boundaries, keys, and probe syntax; it never
// launches Obsidian or bob and is not real-Obsidian acceptance.
"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const lib = require("./obsidian-intention-card-e2e-lib.cjs");
const runner = require("./obsidian-intention-card-e2e.cjs");

test("obsidian-intention-card-e2e --self-test", () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, "obsidian-intention-card-e2e.cjs"), "--self-test"],
    { encoding: "utf8", timeout: 20_000 });
  assert.equal(result.status, 0, `${result.stdout || ""}\n${result.stderr || ""}`);
  assert.match(String(result.stdout || ""), /offline self-test complete/);
  assert.match(String(result.stdout || ""), /no Obsidian or bob launched/);
});

test("fixtures are relative to the run date and keep boundary notes missing", () => {
  const { plan, notes } = lib.fixturePlan("2027-01-04");
  assert.equal(plan.paths.today, "2027/20270104.md");
  assert.equal(plan.week, "2027-W01");
  assert.equal(plan.paths.week, "2027/2027-W01.md");
  assert.equal(plan.quarter, "2027-Q1");
  assert.equal(plan.paths.yesterday, "2027/20270103.md");
  assert.ok(notes[plan.paths.yesterday].includes("[[2026/2026-W53|W53]]"), "yesterday belongs to ISO 2026-W53");
  for (const missing of [plan.paths.tomorrow, plan.paths.year, plan.paths.boundaryPrevDay, plan.paths.boundaryNextQuarter]) {
    assert.equal(notes[missing], undefined, missing + " must stay missing");
  }
});

test("every mandatory check is listed once and the runner fails on an unrun check", () => {
  assert.equal(new Set(runner.REQUIRED_CHECKS).size, runner.REQUIRED_CHECKS.length);
  for (const name of ["yesterday-prev-note-double-equals-r", "yesterday-double-equals-bracket-r", "stale-refusal-keeps-draft",
    "body-edit-survives-save", "old-bob-keeps-card-and-recovery", "display-seven-owned-keys-reading", "yaml-invalid-stays-recoverable"]) {
    assert.ok(runner.REQUIRED_CHECKS.includes(name), name);
  }
});

test("the old-bob shim answers like a bob without periods update", () => {
  assert.match(lib.OLD_BOB_STDERR, /^error: unrecognized subcommand 'update'/);
  assert.match(lib.OLD_BOB_STDERR, /bob periods/);
});
