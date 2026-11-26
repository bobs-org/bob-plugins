#!/usr/bin/env node
// Offline wrapper for the real-Obsidian cabinet-absorption spike. It validates
// the fixtures, ladder, verdict, arguments, and page-source syntax; it never
// launches Obsidian and is not the real-Obsidian proof.
"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const lib = require("./obsidian-cabinet-absorption-spike-lib.cjs");

test("cabinet-absorption spike --self-test", () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, "obsidian-cabinet-absorption-spike.cjs"), "--self-test"],
    { encoding: "utf8", timeout: 20_000 });
  assert.equal(result.status, 0, `${result.stdout || ""}\n${result.stderr || ""}`);
  assert.match(String(result.stdout || ""), /offline self-test complete/);
  assert.match(String(result.stdout || ""), /no Obsidian launched/);
});

test("computeVerdict: GO, partial GO, NO-GO, and a missing check", () => {
  const all = lib.passingReport();
  assert.equal(lib.computeVerdict(all).verdict, "GO");

  const readingOnly = lib.passingReport();
  for (const row of readingOnly.checks) if (row.surface === "live") row.status = "fail";
  assert.equal(lib.computeVerdict(readingOnly).verdict, "GO (reading only; live preview falls back to body)");

  const liveOnly = lib.passingReport();
  for (const row of liveOnly.checks) if (row.surface === "reading") row.status = "fail";
  assert.equal(lib.computeVerdict(liveOnly).verdict, "GO (live preview only; reading falls back to body)");

  const neither = lib.passingReport();
  for (const row of neither.checks) if (row.surface !== "both") row.status = "fail";
  assert.equal(lib.computeVerdict(neither).verdict, "NO-GO");

  const bothFail = lib.passingReport();
  for (const row of bothFail.checks) if (row.name === "teardown-plugin-disable") row.status = "fail";
  assert.equal(lib.computeVerdict(bothFail).verdict, "NO-GO", "a failed both-surface check blocks every GO");

  const missing = lib.passingReport();
  missing.checks = missing.checks.filter((row) => row.name !== "vim-gg-G");
  const verdict = lib.computeVerdict(missing);
  assert.notEqual(verdict.verdict, "GO");
  assert.deepEqual(verdict.missing, ["vim-gg-G"]);

  const bothMissing = lib.passingReport();
  bothMissing.checks = bothMissing.checks.filter((row) => row.name !== "bytes-unchanged");
  assert.equal(lib.computeVerdict(bothMissing).verdict, "NO-GO");
  assert.equal(lib.computeVerdict({}).verdict, "NO-GO");
});

test("parseArgs accepts the documented flags and rejects bad input", () => {
  const args = lib.parseArgs(["--executable", "/x/obsidian", "--out", "/tmp/a", "--report", "/tmp/r.json", "-s", "-h"]);
  assert.deepEqual(args, { executable: "/x/obsidian", out: "/tmp/a", report: "/tmp/r.json", selfTest: true, help: true });
  assert.throws(() => lib.parseArgs(["-e"]), /--executable requires a PATH value/);
  assert.throws(() => lib.parseArgs(["-o", "--self-test"]), /--out requires a DIRECTORY value/);
  assert.throws(() => lib.parseArgs(["-r"]), /--report requires a PATH value/);
  assert.throws(() => lib.parseArgs(["--verbose"]), /Unknown argument: --verbose/);
  const help = spawnSync(process.execPath, [path.join(__dirname, "obsidian-cabinet-absorption-spike.cjs"), "--bogus"], { encoding: "utf8", timeout: 20_000 });
  assert.equal(help.status, 2);
  assert.match(help.stderr, /Unknown argument: --bogus/);
  assert.match(help.stderr, /Usage: node scripts\/obsidian-cabinet-absorption-spike\.cjs/);
});

test("every page-side source compiles without running", () => {
  for (const [name, source] of [["adapter", lib.ADAPTER_SOURCE], ["probe", lib.PROBE_SOURCE]]) {
    assert.doesNotThrow(() => new Function("return " + source), name);
    assert.match(source, /^\(\(\) => \{/, name + " is one IIFE");
  }
  assert.match(lib.ADAPTER_SOURCE, /constructor\?\.helpers/, "the adapter reads the primitive from the plugin on every call");
  assert.match(lib.ADAPTER_SOURCE, /propertyCardCatalogRegionForHide/, "the adapter recognizes through the shipped recognizer");
  assert.match(lib.ADAPTER_SOURCE, /propertyCardCabinetAbsorbInEditor/, "the adapter hides through the shipped primitive");
  assert.match(lib.ADAPTER_SOURCE, /window\.__bobCabinetSpike = \{ hide \}/, "the adapter publishes one hide entry");
});

test("placement rules, fixtures, and ladder match the spike contract", () => {
  assert.deepEqual(lib.placementFailures(lib.syntheticProbe("live")), []);
  assert.deepEqual(lib.placementFailures(lib.syntheticProbe("reading")), []);
  const changed = lib.syntheticProbe("live", { bytesChanged: true });
  assert.ok(lib.placementFailures(changed).includes("note bytes changed while hidden"));
  const names = lib.REQUIRED_CHECKS.map((row) => row.name);
  for (const name of ["hide-live", "hide-reading", "vim-j-k", "vim-gg-G", "heading-jump-reading", "find-reveals", "no-invisible-cursor", "teardown-plugin-disable", "bytes-unchanged"]) {
    assert.ok(names.includes(name), name);
  }
  assert.equal(lib.LADDER_RUNGS.length, 3);
  assert.deepEqual(lib.LADDER_RUNGS.map((rung) => rung.id), ["a", "b", "c"]);
  const lines = lib.fixtureNotes()["host.md"].split("\n");
  assert.match(lines[6], /^## Projects/, "the hideable span starts at its H2");
  assert.match(lines[8], /> \[!projects\]/, "the callout follows one blank line down");
});
