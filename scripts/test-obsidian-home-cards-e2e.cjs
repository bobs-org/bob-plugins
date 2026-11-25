// Offline guard for the real-Obsidian home-card acceptance runner.
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
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
  for (const key of [
    "area", "subarea", "inbox", "nestedInbox", "wip", "blocked", "scheduled", "done",
    "canceled", "legacy", "missing", "archived", "lateTitle", "deep", "long",
    "shadowed", "invalidClock", "mixedClock", "capOff", "createdMissing",
    "createdInvalid", "complete", "nestedPrj", "depBlocked", "subBlocked",
    "doneUndated", "untyped",
  ]) {
    assert.ok(fixtures[lib.PATHS[key]], key);
  }
  assert.ok(fixtures[lib.PATHS.subarea].includes('parent: "[[dev]]"'));
  assert.match(fixtures[lib.PATHS.area], /# Development/);
  assert.match(fixtures[lib.PATHS.inbox], /Mac Inbox/);
  assert.match(fixtures[lib.PATHS.nestedInbox], /Nested Inbox/);
  assert.match(fixtures[lib.PATHS.scheduled], /\[scheduled:: 2026-12-02\]/);
  assert.match(fixtures[lib.PATHS.legacy], /theme: "BUILD"/);
  assert.match(fixtures[lib.PATHS.complete], /Close this completion fixture/);
  assert.doesNotMatch(fixtures[lib.PATHS.untyped], /^type:/m);
  assert.match(fixtures[lib.PATHS.untyped], /aliases:/);
});

test("card acceptance rejects missing native Properties, wrong species, and wrong lifecycle", () => {
  const base = {
    path: lib.PATHS.blocked, mode: "reading", kind: "project", title: "blocked_plan",
    ariaLabel: "Project: blocked_plan", icon: "target", tileForm: "pennant",
    footPresent: true, nativePropertiesVisible: true, lifecycle: "BLOCKED", pills: [], chips: [],
    chipCount: 0, metaPresent: false, goalDecorated: true,
  };
  assert.deepEqual(lib.cardFailures(base, lib.PATHS.blocked, "reading"), []);
  for (const delta of [
    { nativePropertiesVisible: false }, { kind: "area" }, { lifecycle: "WIP" },
    { tileForm: "field" }, { footPresent: false },
  ]) assert.ok(lib.cardFailures({ ...base, ...delta }, lib.PATHS.blocked, "reading").length, JSON.stringify(delta));
});

test("screenshot inventory covers both species and terminal project across light/dark and narrow/wide", () => {
  const needs = lib.screenshotNeeds();
  assert.equal(needs.length, 28);
  assert.ok(needs.includes("dev-live-light-wide"));
  assert.ok(needs.includes("root_plan-reading-dark-narrow"));
  assert.ok(needs.includes("done_plan-live-dark-wide"));
  assert.ok(needs.includes("long_area-live-light-wide-collapsed"));
  assert.ok(needs.includes("long_area-live-light-wide-drawer"));
  assert.ok(needs.includes("root_plan-live-light-wide-reduced"));
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
  assert.match(runner.PROBE_SOURCE, /cardWidth/);
  assert.match(runner.PROBE_SOURCE, /nativePropertiesVisible/);
  assert.match(runner.PROBE_SOURCE, /drawerOpen/);
  const runnerSource = fs.readFileSync(path.join(__dirname, "obsidian-home-cards-e2e.cjs"), "utf8");
  assert.match(runnerSource, /command\.editorCallback\(editor\)/);
  assert.match(runnerSource, /openBulletPropertyPicker\(editor\)/);
  assert.match(runnerSource, /lib\.bobConfigYaml\(\)/);
  assert.match(runnerSource, /XDG_CONFIG_HOME/);
  assert.doesNotMatch(runnerSource, /missing-test-config\.yml/);
  assert.match(runnerSource, /async function openCardNote/);
  assert.match(runnerSource, /workspace\.getLeaf\(true\)/);
  assert.match(runnerSource, /homeCardSetCollapsed\(notePath, false\)/);
  assert.match(runnerSource, /underscore-collapses-area/);
  assert.match(runnerSource, /underscore-collapses-project/);
  const geo = lib.inspectGeometry({
    cardWidth: 360, cardHeight: 140, collapsed: true, drawerOpen: false,
    lifecycleVisible: true, nativePropertiesVisible: true,
  }, { narrow: true, collapsed: true });
  assert.deepEqual(geo.failures, []);
  assert.equal(geo.container.width, 360);
});
