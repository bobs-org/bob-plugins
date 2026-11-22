#!/usr/bin/env node
// Offline wrapper for the real-Obsidian frontmatter-ownership spike. It
// validates the fixtures, verdict, arguments, and page-source syntax; it
// never launches Obsidian and is not the real-Obsidian proof.
"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const lib = require("./obsidian-frontmatter-ownership-spike-lib.cjs");

test("obsidian-frontmatter-ownership-spike --self-test", () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, "obsidian-frontmatter-ownership-spike.cjs"), "--self-test"],
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

  const readingOnly = lib.passingReport();
  for (const row of readingOnly.checks) if (row.surface === "live") row.status = "fail";
  const partial = lib.computeVerdict(readingOnly);
  assert.equal(partial.verdict, "GO (reading only; live preview keeps per-row hiding)");
  assert.deepEqual(partial.fallback, ["live"]);
  assert.equal(partial.partial, true);

  const liveOnly = lib.passingReport();
  for (const row of liveOnly.checks) if (row.surface === "reading") row.status = "fail";
  assert.equal(lib.computeVerdict(liveOnly).verdict, "GO (live preview only; reading keeps per-row hiding)");

  const neither = lib.passingReport();
  for (const row of neither.checks) if (row.surface !== "both") row.status = "fail";
  assert.equal(lib.computeVerdict(neither).verdict, "NO-GO");

  const shared = lib.passingReport();
  for (const row of shared.checks) if (row.name === "plugin-loaded") row.status = "fail";
  assert.equal(lib.computeVerdict(shared).verdict, "NO-GO", "a failed both-surface check blocks every GO");

  const missing = lib.passingReport();
  missing.checks = missing.checks.filter((row) => row.name !== "own-live");
  const verdict = lib.computeVerdict(missing);
  assert.notEqual(verdict.verdict, "GO");
  assert.deepEqual(verdict.missing, ["own-live"]);
  assert.equal(lib.computeVerdict({}).verdict, "NO-GO");
});

test("parseArgs accepts the documented flags and rejects bad input", () => {
  const args = lib.parseArgs(["--executable", "/x/obsidian", "--out", "/tmp/a", "--report", "/tmp/r.json", "-s", "-h"]);
  assert.deepEqual(args, { executable: "/x/obsidian", out: "/tmp/a", report: "/tmp/r.json", selfTest: true, help: true });
  assert.throws(() => lib.parseArgs(["-e"]), /--executable requires a PATH value/);
  assert.throws(() => lib.parseArgs(["-o", "--self-test"]), /--out requires a DIRECTORY value/);
  assert.throws(() => lib.parseArgs(["-r"]), /--report requires a PATH value/);
  assert.throws(() => lib.parseArgs(["--verbose"]), /Unknown argument: --verbose/);
  const help = spawnSync(process.execPath, [path.join(__dirname, "obsidian-frontmatter-ownership-spike.cjs"), "--bogus"], { encoding: "utf8", timeout: 20_000 });
  assert.equal(help.status, 2);
  assert.match(help.stderr, /Unknown argument: --bogus/);
  assert.match(help.stderr, /Usage: node scripts\/obsidian-frontmatter-ownership-spike\.cjs/);
});

test("every page-side source compiles without running", () => {
  for (const [name, source] of [["adapter", lib.ADAPTER_SOURCE], ["probe", lib.PROBE_SOURCE]]) {
    assert.doesNotThrow(() => new Function("return " + source), name);
    assert.match(source, /^\(\(\) => \{/, name + " is one IIFE");
  }
  assert.match(lib.ADAPTER_SOURCE, /propertyCardOwnFrontmatter/, "the adapter owns through the kit primitive");
  assert.match(lib.PROBE_SOURCE, /Add file property/i, "the probe looks up the Add file property command");
});

test("required S1 checks cover both surfaces and the command id", () => {
  const names = lib.REQUIRED_CHECKS.map((row) => row.name);
  for (const name of ["own-live", "own-reading", "vim-k-gg-up-live", "tab-live", "tab-reading",
    "title-slot-anchor-live", "title-slot-anchor-reading", "add-file-property-command",
    "variables-live", "variables-reading", "source-toggle-releases", "path-change-releases", "deny-embed"]) {
    assert.ok(names.includes(name), name);
  }
  assert.ok(lib.REQUIRED_CHECKS.some((row) => row.surface === "live"));
  assert.ok(lib.REQUIRED_CHECKS.some((row) => row.surface === "reading"));
  assert.ok(lib.REQUIRED_CHECKS.some((row) => row.surface === "both"));
});
