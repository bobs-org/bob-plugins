// Offline guard for the real-Obsidian Cabinets acceptance runner.
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const lib = require("./obsidian-cabinets-e2e-lib.cjs");
const runner = require("./obsidian-cabinets-e2e.cjs");
const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownRenderChild: class {}, Notice: class {}, Plugin: class {},
    Platform: { isDesktopApp: true }, normalizePath: (value) => value,
  };
  if (request === "@codemirror/state" || request === "@codemirror/view") return {};
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
Module._load = originalLoad;

test("Cabinets runner self-test is offline", () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, "obsidian-cabinets-e2e.cjs"), "--self-test"], {
    encoding: "utf8", timeout: 20_000,
  });
  assert.equal(result.status, 0, `${result.stdout || ""}\n${result.stderr || ""}`);
  assert.match(String(result.stdout || ""), /offline self-test complete/);
  assert.match(String(result.stdout || ""), /no Obsidian launched/);
});

test("fixtures cover every property-card species and high-content catalogs", () => {
  lib.selfTest();
  const notes = lib.fixtureNotes();
  assert.equal(lib.SPECS.length, 16);
  for (const spec of lib.SPECS) assert.ok(notes[spec.path], spec.key);
  assert.equal(lib.countCatalogRows(notes[lib.PATHS.project], "Projects"), 64);
  assert.equal(lib.countCatalogRows(notes[lib.PATHS.album], "Records"), 106);
  assert.match(notes[lib.PATHS.area], /\[!areas\]/);
  assert.match(notes[lib.PATHS.area], /\[!projects\]/);
  assert.match(notes[lib.PATHS.area], /\[!notebooks\]/);
  assert.match(notes[lib.PATHS.area], /\[!albums\]/);
  assert.doesNotMatch(notes[lib.PATHS.untyped], /^type:/m);
});

test("screenshot inventory covers the full theme, width, mode, and state matrix", () => {
  const needs = lib.screenshotNeeds();
  assert.equal(needs.length, 58);
  assert.equal(new Set(needs).size, needs.length);
  for (const name of [
    "area-live-light-narrow", "area-reading-dark-wide", "area-live-dark-narrow-armed",
    "area-reading-light-wide-armed", "album-live-dark-wide", "bank-reading-light-narrow",
    "prose-live-dark-narrow", "record-reading-dark-wide", "footer-live-light-wide-armed",
    "area-live-light-wide-reduced-motion", "area-live-light-wide-forced-colors",
  ]) assert.ok(needs.includes(name), name);
});

test("browser probe is valid and runner covers acceptance-critical interactions", () => {
  assert.doesNotThrow(() => new Function("return " + runner.PROBE_SOURCE));
  const source = fs.readFileSync(path.join(__dirname, "obsidian-cabinets-e2e.cjs"), "utf8");
  for (const check of [
    "gate-closed-inline-baseline", "area-content-parity-gate-closed", "palette-arms-pick",
    "fast-underscore-one-no-overlay-flash", "hidden-status-bar-uses-fallback-strip",
    "reading-hides-managed-headings-and-callouts", "embed-shows-stored-catalog",
    "hover-shows-stored-catalog", "print-pdf-shows-stored-catalog",
    "forced-mount-error-reveals-native-section", "plugin-disable-restores-stored-section",
    "vim-motions-and-arrows-no-invisible-cursor", "passive-actions-zero-bob-spawns",
    "passive-actions-zero-markdown-writes", "screenshot-matrix-captured",
  ]) assert.ok(source.includes(check), `runner includes ${check}`);
  assert.match(source, /cabinetsPreview: true/);
  assert.match(source, /cardPreviewKinds: \["notebook", "prose"\]/);
  assert.match(source, /refCardPreview: true/);
  assert.match(source, /Unexpected bob spawn in cabinet acceptance/);
  assert.match(source, /markdownFilesHash/);
  assert.match(source, /collapseSidebars\(client\)/);
  assert.doesNotMatch(source, /TMPDIR:\s*["']\/tmp["']/);
});

test("report fixtures provide the read-only album and bank data the visual matrix needs", () => {
  const albums = runner.FIXTURE_BOB_REPORTS.albums;
  assert.equal(albums.ok, true);
  assert.deepEqual(albums.albums.map((entry) => entry.path), ["eat.md", "empty.md", "subscriptions.md"]);
  assert.ok(albums.albums.every((entry) => Array.isArray(entry.fields) && entry.index.state === "current"));
  assert.equal(runner.FIXTURE_BOB_REPORTS.bank.state, "valid");
  assert.equal(runner.FIXTURE_BOB_REPORTS.bank.accounts[0].alias, "checking");
  const decodedAlbums = LedgerToolsPlugin.helpers.albumDecodeListReport(JSON.stringify(albums));
  const decodedBank = LedgerToolsPlugin.helpers.bankDecodeConfig(JSON.stringify(runner.FIXTURE_BOB_REPORTS.bank), "");
  assert.equal(decodedAlbums.ok, true);
  assert.equal(decodedBank.ok, true);
});

test("Obsidian child inherits disk-backed temporary storage", () => {
  const env = runner.obsidianChildEnvironment("/profile", "/shim", { TMPDIR: "/var/tmp", PATH: "/usr/bin" });
  assert.equal(env.TMPDIR, "/var/tmp");
  assert.ok(env.PATH.startsWith("/shim" + path.delimiter));
  assert.equal(runner.obsidianChildEnvironment("/profile", "/shim", {}).TMPDIR, os.tmpdir());
});
