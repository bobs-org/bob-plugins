#!/usr/bin/env node
// Offline wrapper for the real-Obsidian frontmatter-takeover matrix. It
// validates fixtures, verdict, arguments, and page-source syntax; it never
// launches Obsidian and is not the real-Obsidian proof.
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const lib = require("./obsidian-frontmatter-takeover-e2e-lib.cjs");

test("obsidian-frontmatter-takeover-e2e --self-test", () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, "obsidian-frontmatter-takeover-e2e.cjs"), "--self-test"],
    { encoding: "utf8", timeout: 20_000 });
  assert.equal(result.status, 0, `${result.stdout || ""}\n${result.stderr || ""}`);
  assert.match(String(result.stdout || ""), /offline self-test complete/);
  assert.match(String(result.stdout || ""), /no Obsidian launched/);
});

test("computeVerdict: GO, partial GO, NO-GO, and a missing check", () => {
  const all = lib.passingReport();
  assert.equal(lib.computeVerdict(all).verdict, "GO");
  const liveOnly = lib.passingReport();
  for (const row of liveOnly.checks) if (row.surface === "live") row.status = "fail";
  assert.equal(lib.computeVerdict(liveOnly).verdict, "GO (reading only; live preview keeps per-row hiding)");
  const neither = lib.passingReport();
  for (const row of neither.checks) if (row.surface !== "both") row.status = "fail";
  assert.equal(lib.computeVerdict(neither).verdict, "NO-GO");
  const missing = lib.passingReport();
  missing.checks = missing.checks.filter((row) => row.name !== "own-day-live");
  assert.deepEqual(lib.computeVerdict(missing).missing, ["own-day-live"]);
});

test("parseArgs accepts the documented flags and rejects bad input", () => {
  const args = lib.parseArgs(["--executable", "/x/obsidian", "--out", "/tmp/a", "--report", "/tmp/r.json", "-s", "-h"]);
  assert.deepEqual(args, { executable: "/x/obsidian", out: "/tmp/a", report: "/tmp/r.json", selfTest: true, help: true });
  assert.throws(() => lib.parseArgs(["-e"]), /--executable requires a PATH value/);
  assert.throws(() => lib.parseArgs(["--verbose"]), /Unknown argument: --verbose/);
  const help = spawnSync(process.execPath, [path.join(__dirname, "obsidian-frontmatter-takeover-e2e.cjs"), "--bogus"], { encoding: "utf8", timeout: 20_000 });
  assert.equal(help.status, 2);
  assert.match(help.stderr, /Unknown argument: --bogus/);
});

test("every page-side source compiles and observes production adapters", () => {
  assert.doesNotThrow(() => new Function("return " + lib.PROBE_SOURCE));
  assert.match(lib.PROBE_SOURCE, /^\(\(\) => \{/);
  assert.match(lib.PROBE_SOURCE, /propertyCardFrontmatterActualOwnership/);
  assert.match(lib.PROBE_SOURCE, /propertyCardFrontmatterOwnMounted/);
  assert.doesNotMatch(lib.PROBE_SOURCE, /propertyCardOwnFrontmatter\(/);
  assert.match(fs.readFileSync(path.join(__dirname, "obsidian-frontmatter-takeover-e2e.cjs"), "utf8"), /Never calls/);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, "obsidian-frontmatter-takeover-e2e.cjs"), "utf8"), /propertyCardOwnFrontmatter\(/);
});

test("required takeover checks cover both surfaces, denials, and command routing", () => {
  const names = lib.REQUIRED_CHECKS.map((row) => row.name);
  for (const name of [
    "own-day-live", "own-day-reading", "own-week-live", "own-record-live", "own-album-reading",
    "own-quarter-live", "own-year-live", "own-identity-day-live",
    "source-toggle-releases", "deny-embed", "deny-hover", "deny-canvas", "deny-print", "deny-mobile",
    "deny-malformed", "deny-unclosed", "stale-cache-releases", "same-pane-file-change",
    "injected-mount-failure", "replaced-container-reapplies", "disable-unload-restores",
    "pending-capability-native", "absent-old-bob-native", "failed-probe-native", "path-switch-native",
    "late-after-unload-native", "mod-semicolon-add-owned", "palette-add-owned", "custom-shortcut-add-owned",
    "bank-native", "ordinary-native", "sidebar-native", "field-focused-helper", "failed-opener-fallback",
    "vim-k-gg-up-live", "tab-live", "title-slot-anchor-live", "drawer-exposes-every-key",
    "bytes-unchanged", "no-paint-spawn", "screenshots-captured",
  ]) {
    assert.ok(names.includes(name), name);
  }
  assert.ok(lib.REQUIRED_CHECKS.some((row) => row.surface === "live"));
  assert.ok(lib.REQUIRED_CHECKS.some((row) => row.surface === "reading"));
  assert.ok(lib.REQUIRED_CHECKS.some((row) => row.surface === "both"));
});

test("ownership and native restoration probes reject the opposite state", () => {
  const owned = {
    mode: "live", scopeClass: true, actualOwned: true, containerPresent: true, containerVisible: false,
    containerInert: true, ariaHidden: "true", display: "none", cardPresent: true, footPresent: true,
  };
  assert.deepEqual(lib.ownedFailures(owned, "live"), []);
  assert.ok(lib.ownedFailures({ ...owned, containerVisible: true }, "live").length > 0);
  assert.ok(lib.nativeFailures(owned, "owned").length > 0);
  assert.deepEqual(lib.nativeFailures({
    scopeClass: false, actualOwned: false, containerPresent: true, containerInert: false, ariaHidden: null,
  }, "native"), []);
});

test("screenshot inventory covers the required light/dark × narrow/wide matrix", () => {
  const needed = lib.screenshotNeeds();
  assert.ok(needed.includes("day-live-light-wide"));
  assert.ok(needed.includes("bank-reading-dark-narrow"));
  assert.ok(needed.includes("ordinary-add-light-wide"));
  assert.equal(needed.length, 44);
});

test("takeover runner file parses and reuses provenance", () => {
  const runner = path.join(__dirname, "obsidian-frontmatter-takeover-e2e.cjs");
  const checked = spawnSync(process.execPath, ["--check", runner], { encoding: "utf8" });
  assert.equal(checked.status, 0, checked.stderr);
  const proof = require("./obsidian-frontmatter-takeover-e2e.cjs");
  assert.equal(typeof proof.findBobProvenance, "function");
  assert.equal(typeof proof.run, "function");
});

test("runner creates the profile directory before writing bob-control.json", () => {
  const source = fs.readFileSync(path.join(__dirname, "obsidian-frontmatter-takeover-e2e.cjs"), "utf8");
  const mkdir = source.indexOf("fs.mkdirSync(profileDir, { recursive: true })");
  const write = source.indexOf('writeControl(controlPath, "pass")');
  assert.ok(mkdir >= 0, "mkdirSync(profileDir) is missing");
  assert.ok(write >= 0, "writeControl(controlPath) is missing");
  assert.ok(mkdir < write, "profileDir must exist before the first writeControl");
  assert.match(source, /fs\.mkdirSync\(path\.dirname\(file\), \{ recursive: true \}\)/);
});
