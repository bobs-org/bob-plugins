// Offline guard for the real-Obsidian home-card acceptance runner.
"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const lib = require("./obsidian-home-cards-e2e-lib.cjs");
const runner = require("./obsidian-home-cards-e2e.cjs");

test("home-card real-Obsidian runner self-test is offline", () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, "obsidian-home-cards-e2e.cjs"), "--self-test"], {
    encoding: "utf8", timeout: 20_000,
  });
  assert.equal(result.status, 0, `${result.stdout || ""}\n${result.stderr || ""}`);
  assert.match(String(result.stdout || ""), /offline self-test complete/);
  assert.match(String(result.stdout || ""), /no Obsidian launched/);
});

test("fixtures cover home species, ancestry, inbox, every local project state, and no-goal repair", () => {
  lib.selfTest();
  const fixtures = lib.fixtureNotes();
  for (const key of ["area", "subarea", "inbox", "wip", "blocked", "scheduled", "done", "canceled", "legacy", "missing"]) {
    assert.ok(fixtures[lib.PATHS[key]], key);
  }
  assert.ok(fixtures[lib.PATHS.subarea].includes('parent: "[[dev]]"'));
  assert.match(fixtures[lib.PATHS.area], /# Development/);
  assert.match(fixtures[lib.PATHS.inbox], /Mac Inbox/);
  assert.match(fixtures[lib.PATHS.scheduled], /\[scheduled:: 2026-12-02\]/);
  assert.match(fixtures[lib.PATHS.legacy], /theme: "BUILD"/);
});

test("card acceptance rejects missing native Properties, wrong species, and wrong lifecycle", () => {
  const base = {
    path: lib.PATHS.blocked, mode: "reading", kind: "project", title: "blocked_plan",
    ariaLabel: "Project: blocked_plan", icon: "target", tileForm: "pennant",
    footPresent: true, nativePropertiesVisible: true, lifecycle: "BLOCKED", pills: [], chips: [],
    chipCount: 0, metaPresent: false,
  };
  assert.deepEqual(lib.cardFailures(base, lib.PATHS.blocked, "reading"), []);
  for (const delta of [
    { nativePropertiesVisible: false }, { kind: "area" }, { lifecycle: "WIP" },
    { tileForm: "field" }, { footPresent: false },
  ]) assert.ok(lib.cardFailures({ ...base, ...delta }, lib.PATHS.blocked, "reading").length, JSON.stringify(delta));
});

test("screenshot inventory covers both species and terminal project across light/dark and narrow/wide", () => {
  const needs = lib.screenshotNeeds();
  assert.equal(needs.length, 24);
  assert.ok(needs.includes("dev-live-light-wide"));
  assert.ok(needs.includes("root_plan-reading-dark-narrow"));
  assert.ok(needs.includes("done_plan-live-dark-wide"));
  assert.equal(new Set(needs).size, needs.length);
});

test("CLI arguments and the page probe are valid", () => {
  assert.deepEqual(lib.parseArgs(["-e", "/x/obsidian", "-o", "/tmp/shots", "-r", "/tmp/report.json", "-s"]), {
    executable: "/x/obsidian", out: "/tmp/shots", report: "/tmp/report.json", selfTest: true, help: false,
  });
  assert.throws(() => lib.parseArgs(["--executable"]), /requires a PATH value/);
  assert.throws(() => lib.parseArgs(["--unknown"]), /Unknown argument/);
  assert.doesNotThrow(() => new Function("return " + runner.PROBE_SOURCE));
  assert.match(runner.PROBE_SOURCE, /bob-home-card/);
});
