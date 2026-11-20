#!/usr/bin/env node
// Offline wrapper for the real-Obsidian title-slot spike. It validates the
// fixtures, placement rules, verdict, arguments, and page-source syntax; it
// never launches Obsidian and is not the real-Obsidian proof.
"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const lib = require("./obsidian-title-slot-spike-lib.cjs");

test("obsidian-title-slot-spike --self-test", () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, "obsidian-title-slot-spike.cjs"), "--self-test"],
    { encoding: "utf8", timeout: 20_000 });
  assert.equal(result.status, 0, `${result.stdout || ""}\n${result.stderr || ""}`);
  assert.match(String(result.stdout || ""), /offline self-test complete/);
  assert.match(String(result.stdout || ""), /no Obsidian launched/);
});

test("computeVerdict: GO, partial GO, NO-GO, and a missing check", () => {
  const all = lib.passingReport();
  const go = lib.computeVerdict(all);
  assert.equal(go.verdict, "GO");
  assert.deepEqual(go.fallback, []);
  assert.equal(go.surfaces.live.failed.length + go.surfaces.reading.failed.length + go.surfaces.both.failed.length, 0);

  const readingOnly = lib.passingReport();
  for (const row of readingOnly.checks) if (row.surface === "live") row.status = "fail";
  const partial = lib.computeVerdict(readingOnly);
  assert.equal(partial.verdict, "GO (reading only; live preview falls back to body)");
  assert.deepEqual(partial.fallback, ["live"]);
  assert.equal(partial.partial, true);

  const liveOnly = lib.passingReport();
  for (const row of liveOnly.checks) if (row.name === "heading-jump-reading") row.status = "fail";
  assert.equal(lib.computeVerdict(liveOnly).verdict, "GO (live preview only; reading falls back to body)");

  const neither = lib.passingReport();
  for (const row of neither.checks) if (row.surface !== "both") row.status = "fail";
  assert.equal(lib.computeVerdict(neither).verdict, "NO-GO");

  const shared = lib.passingReport();
  for (const row of shared.checks) if (row.name === "teardown-plugin-disable") row.status = "fail";
  assert.equal(lib.computeVerdict(shared).verdict, "NO-GO", "a failed both-surface check blocks every GO");

  const missing = lib.passingReport();
  missing.checks = missing.checks.filter((row) => row.name !== "coords-at-pos");
  const verdict = lib.computeVerdict(missing);
  assert.notEqual(verdict.verdict, "GO");
  assert.deepEqual(verdict.missing, ["coords-at-pos"]);
  const missingBoth = lib.passingReport();
  missingBoth.checks = missingBoth.checks.filter((row) => row.name !== "bytes-unchanged");
  assert.equal(lib.computeVerdict(missingBoth).verdict, "NO-GO");

  const extra = lib.passingReport();
  extra.checks.push({ name: "coords-at-pos-unmeasured-control", status: "fail", mandatory: false });
  assert.equal(lib.computeVerdict(extra).verdict, "GO", "non-mandatory evidence never changes the verdict");
  const duplicate = lib.passingReport();
  duplicate.checks.push({ name: "split-panes", surface: "both", status: "fail", mandatory: true });
  assert.equal(lib.computeVerdict(duplicate).verdict, "NO-GO", "any failing row for a required check fails it");
  assert.equal(lib.computeVerdict({}).verdict, "NO-GO");
});

test("parseArgs accepts the documented flags and rejects bad input", () => {
  const args = lib.parseArgs(["--executable", "/x/obsidian", "--out", "/tmp/a", "--report", "/tmp/r.json", "-s", "-h"]);
  assert.deepEqual(args, { executable: "/x/obsidian", out: "/tmp/a", report: "/tmp/r.json", selfTest: true, help: true });
  assert.throws(() => lib.parseArgs(["-e"]), /--executable requires a PATH value/);
  assert.throws(() => lib.parseArgs(["-o", "--self-test"]), /--out requires a DIRECTORY value/);
  assert.throws(() => lib.parseArgs(["-r"]), /--report requires a PATH value/);
  assert.throws(() => lib.parseArgs(["--verbose"]), /Unknown argument: --verbose/);
  const help = spawnSync(process.execPath, [path.join(__dirname, "obsidian-title-slot-spike.cjs"), "--bogus"], { encoding: "utf8", timeout: 20_000 });
  assert.equal(help.status, 2);
  assert.match(help.stderr, /Unknown argument: --bogus/);
  assert.match(help.stderr, /Usage: node scripts\/obsidian-title-slot-spike\.cjs/);
});

test("every page-side source compiles without running", () => {
  for (const [name, source] of [["adapter", lib.ADAPTER_SOURCE], ["probe", lib.PROBE_SOURCE]]) {
    assert.doesNotThrow(() => new Function("return " + source), name);
    assert.match(source, /^\(\(\) => \{/, name + " is one IIFE");
  }
  assert.match(lib.ADAPTER_SOURCE, /constructor\.helpers/, "the adapter reads the primitive from the plugin on every call");
  for (const call of ["start(", "stop(", "pause(", "resume(", "setHeight(", "tryDenied(", "remount("]) assert.ok(lib.ADAPTER_SOURCE.includes(call), call);
});

test("placement rules and fixtures match the spike contract", () => {
  assert.deepEqual(lib.placementFailures(lib.syntheticProbe("live")), []);
  assert.deepEqual(lib.placementFailures(lib.syntheticProbe("reading")), []);
  const noTitle = lib.syntheticProbe("live", { title: { present: false, visible: false }, order: { titleBeforeCard: false, cardBeforeProperties: true, cardBeforeContent: true } });
  assert.deepEqual(lib.placementFailures(noTitle), [], "inline title off still places");
  const names = lib.REQUIRED_CHECKS.map((row) => row.name);
  for (const name of ["switch-file-live", "settings-matrix-reading", "click-accuracy", "coords-at-pos", "vim-gg-G", "deny-canvas", "teardown-plugin-disable", "bytes-unchanged"]) {
    assert.ok(names.includes(name), name);
  }
  assert.equal(lib.settingsMatrix().length, 24);
  assert.equal(lib.fixtureNotes()["alpha.md"].split("\n").filter((line) => line.startsWith("## Section")).length, 8);
});
