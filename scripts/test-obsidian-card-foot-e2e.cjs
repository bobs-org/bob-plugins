#!/usr/bin/env node
// Offline fixture and assertion checks for the real card-foot proof runner.
"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const lib = require("./obsidian-card-foot-e2e-lib.cjs");

test("foot fixtures cover every adopted species and edge cases", () => {
  const notes = lib.fixtureNotes();
  for (const name of [
    "eat.md",
    "eat/corner-bistro.md",
    "2026/20261120.md",
    "2026/2026-W47.md",
    "2026/2026-Q4.md",
    "2026.md",
    "bank.md",
    "2026/20261121.md",
    "snacks.md",
    "dup.md",
    "invalid.md",
    "unclosed.md",
  ]) {
    assert.ok(notes[name], "fixture missing " + name);
  }
  assert.match(notes["eat.md"], /type: "\[\[album\]\]"/);
  assert.match(notes["eat/corner-bistro.md"], /type: "\[\[record\]\]"/);
  assert.match(notes["2026/20261120.md"], /type: "\[\[day\]\]"/);
  assert.match(notes["bank.md"], /bank:/);
  assert.ok(!notes["2026/20261121.md"].includes("created:"), "identity-only day must stay quiet");
  assert.ok(!notes["snacks.md"].includes("created:"), "missing-created album must stay faint");
  const dupStatuses = notes["dup.md"].split("\n").filter((line) => /^status:/.test(line));
  assert.equal(dupStatuses.length, 2, "duplicate fixture must carry two status rows");
});

test("foot args accept full and foot scopes with self-test", () => {
  const parsed = lib.parseArgs(["-e", "/opt/obsidian", "-o", "/tmp/shots", "-r", "/tmp/report.json", "--self-test"]);
  assert.equal(parsed.executable, "/opt/obsidian");
  assert.equal(parsed.scope, "full");
  assert.equal(parsed.selfTest, true);
  assert.equal(lib.parseArgs(["--scope", "foot"]).scope, "foot");
  assert.throws(() => lib.parseArgs(["--scope", "sheet"]), /--scope requires full or foot/);
  assert.throws(() => lib.parseArgs(["--bogus"]), /Unknown argument/);
});

test("foot probe carries drawer semantics and parses", () => {
  const probe = lib.probeFootSource("eat.md");
  assert.match(probe, /\.bob-property-card-foot/);
  assert.match(probe, /aria-expanded/);
  assert.match(probe, /data-property-key/);
  new Function("return (" + probe + ");");
  const [down] = lib.keyEvents("=", 0);
  assert.equal(down.code, "Equal");
  assert.equal(lib.keyEvents("-", 0)[0].code, "Minus");
});

test("foot lib self-test passes without launching apps", () => {
  assert.equal(lib.selfTest(), true);
});

test("foot runner file parses and exposes provenance", () => {
  const runner = path.join(__dirname, "obsidian-card-foot-e2e.cjs");
  assert.ok(fs.existsSync(runner), "runner is missing");
  const checked = spawnSync(process.execPath, ["--check", runner], { encoding: "utf8" });
  assert.equal(checked.status, 0, checked.stderr);
  const proof = require("./obsidian-card-foot-e2e.cjs");
  assert.equal(typeof proof.findBobProvenance, "function");
  assert.equal(typeof proof.run, "function");
  assert.equal(proof.parseArgs(["--scope", "foot"]).scope, "foot");
});

test("foot kit and adapters never spawn subprocesses or write the vault", () => {
  const root = path.join(__dirname, "..", "plugins", "bob-ledger-tools", "src");
  const files = [
    "240m-plugin-property-card-created.js",
    "240n-plugin-property-card-inventory.js",
    "240o-plugin-property-card-foot-dom.js",
    "240p-plugin-property-card-foot-state.js",
    "240r-plugin-property-card-foot-adapter.js",
    "242kc-plugin-record-sheet-foot.js",
    "241va-plugin-album-header-foot.js",
    "296da-plugin-intention-card-foot.js",
    "248ca-plugin-bank-setup-foot.js",
    "248m-plugin-schema-double-equals.js",
  ];
  const banned = [
    /require\(["']node:child_process["']\)/,
    /from ["']node:child_process["']/,
    /spawnSync\s*\(/,
    /execFileSync?\s*\(/,
    /processFrontMatter\s*\(/,
    /vault\.(write|modify|create|delete|rename)\s*\(/,
    /adapter\.write\s*\(/,
  ];
  for (const name of files) {
    const file = path.join(root, name);
    assert.ok(fs.existsSync(file), "foot fragment is missing: " + name);
    const lines = fs.readFileSync(file, "utf8").split("\n");
    for (const [index, line] of lines.entries()) {
      if (/^\s*\/\//.test(line)) continue; // comments state the guarantee; code must keep it
      for (const pattern of banned) {
        assert.ok(!pattern.test(line), name + ":" + (index + 1) + " must stay read-only: " + line.trim().slice(0, 120));
      }
    }
  }
});
