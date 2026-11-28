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
  assert.match(notes[lib.PATHS.album], /## Notes\s*\n+\[\[eat#Records\|Jump to Records\]\]/);
  assert.match(notes[lib.PATHS.area], /\[!areas\]/);
  assert.match(notes[lib.PATHS.area], /\[!projects\]/);
  assert.match(notes[lib.PATHS.area], /\[!notebooks\]/);
  assert.match(notes[lib.PATHS.area], /\[!albums\]/);
  assert.doesNotMatch(notes[lib.PATHS.untyped], /^type:/m);
});

test("screenshot inventory covers the full theme, width, mode, and state matrix", () => {
  const needs = lib.screenshotNeeds();
  assert.equal(needs.length, 70);
  assert.equal(new Set(needs).size, needs.length);
  for (const name of [
    "area-live-light-narrow", "area-reading-dark-wide", "area-live-dark-narrow-armed",
    "area-reading-light-wide-armed", "album-live-dark-wide", "bank-reading-light-narrow",
    "prose-live-dark-narrow", "record-reading-dark-wide", "footer-live-light-wide-armed",
    "area-live-light-wide-reduced-motion", "area-live-light-wide-forced-colors",
    "ref-live-light-wide", "ref-reading-dark-narrow", "area-source-light-wide",
    "find-strict-inside-reveals-stored-source", "outline-pane-reveals-cabinet",
    "records-link-reveals-cabinet",
  ]) assert.ok(needs.includes(name), name);
});

test("browser probe is valid and runner covers acceptance-critical interactions", () => {
  assert.doesNotThrow(() => new Function("return " + runner.PROBE_SOURCE));
  const source = fs.readFileSync(path.join(__dirname, "obsidian-cabinets-e2e.cjs"), "utf8");
  for (const check of [
    "area-content-parity-stored-regions", "palette-arms-pick",
    "fast-underscore-one-no-overlay-flash", "hidden-status-bar-uses-fallback-strip",
    "reading-hides-managed-headings-and-callouts", "embed-shows-stored-catalog",
    "hover-shows-stored-catalog", "print-media-reveals-stored-catalog",
    "closed-group-catalog-absorbed-with-kept-heading", "live-preview-hides-managed-headings-and-callouts",
    "live-preview-absorption-survives-cabinet-repaint", "cabinet-heads-left-aligned-single-line",
    "cabinet-paint-106-record-album-completes", "cabinet-paint-64-line-projects-host-completes",
    "area-reading-ready-after-plugin-reload", "area-reading-absorbed-after-plugin-reload", "source-shows-stored-section",
    "forced-mount-error-reveals-native-section", "plugin-disable-restores-stored-section",
    "vim-motions-and-arrows-no-invisible-cursor", "cursor-motions-no-console-errors",
    "no-console-errors", "areas-cabinet-single-title-row", "passive-actions-zero-bob-spawns",
    "passive-actions-zero-markdown-writes", "screenshot-matrix-captured",
    "reading-reload-loop-zero-misses", "reading-hides-album-records-section",
    "live-preview-hides-album-records-section-after-reading",
    "find-strict-inside-reveals-stored-source", "outline-pane-reveals-cabinet",
    "records-link-reveals-cabinet",
    "pick-overlay-whole-in-window", "armed footer overlay is not whole inside the window",
  ]) assert.ok(source.includes(check), `runner includes ${check}`);
  assert.match(source, /runReadingReloadLoop/);
  // Gate-free: the runner seeds no preview keys and never closes a gate.
  for (const retired of ["cabinetsPreview", "cardPreviewKinds", "refCardPreview", "gate-closed-inline-baseline",
    "perf-106-record-album-within-budget", "area-content-parity-gate-closed"]) {
    assert.ok(!source.includes(retired), `runner no longer carries ${retired}`);
  }
  assert.match(source, /mode: "gate-free"/);
  assert.match(source, /lib\.storedCatalogRows\(areaSource, kind\)/);
  assert.match(source, /Unexpected bob spawn in cabinet acceptance/);
  assert.match(source, /Runtime\.consoleAPICalled/);
  assert.match(source, /row\.type !== "error"/);
  assert.match(source, /markdownFilesHash/);
  // Obsidian's renderer target may not expose Page.printToPDF; the print
  // check must then say it relied on computed print styles, never claim a PDF.
  assert.match(source, /evidenceMode: pdfAvailable \? "generated-pdf-text" : "computed-print-styles"/);
  assert.match(source, /collapseSidebars\(client\)/);
  assert.match(source, /"outline"/);
  assert.match(source, /editor:open-search/);
  assert.doesNotMatch(source, /TMPDIR:\s*["']\/tmp["']/);
});

test("420px cabinet overlay sheds esc and keeps fixed labels and keycaps", () => {
  const css = fs.readFileSync(path.join(__dirname, "../plugins/bob-ledger-tools/styles.css"), "utf8");
  // Size containment zeroes the overlay's width inside Obsidian's
  // content-sized status bar, so the fit step sheds esc instead.
  const overlayRule = /\.bob-walker-footer-overlay\s*\{([^}]*)\}/.exec(css);
  assert.ok(overlayRule, "overlay rule");
  assert.doesNotMatch(overlayRule[1], /container-type|contain:/);
  assert.match(css, /\.bob-walker-footer-overlay-shed \.bob-walker-footer-overlay-cancel\s*\{\s*display:\s*none;/);
  assert.match(css, /\.bob-walker-footer-overlay-chip\s*\{[\s\S]*?min-width:\s*2em;/);
  assert.match(css, /\.bob-walker-footer-overlay-label,[\s\S]*?\.bob-walker-footer-overlay-cancel\s*\{\s*flex:\s*none;/);
  assert.match(css, /\.bob-walker-footer-overlay-noun\s*\{[\s\S]*?text-overflow:\s*ellipsis;/);
  assert.match(css, /\.bob-property-card \.bob-property-card-cabinets \.bob-areas-header,[\s\S]*?\.bob-property-card \.bob-property-card-cabinets \.bob-projects-header\s*\{\s*display:\s*none !important;/);
});

test("report fixtures provide valid read-only catalog data for the visual matrix", () => {
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
  const areas = LedgerToolsPlugin.helpers.areasDecodeListReport(JSON.stringify(runner.FIXTURE_BOB_REPORTS.areas));
  const projects = LedgerToolsPlugin.helpers.projectsDecodeListReport(JSON.stringify(runner.FIXTURE_BOB_REPORTS.projects));
  const notebooks = LedgerToolsPlugin.helpers.notebookDecodeListReport(JSON.stringify(runner.FIXTURE_BOB_REPORTS.notebooks));
  assert.equal(areas.ok, true);
  assert.equal(areas.report.catalogsByHostPath.has("cash.md"), true);
  assert.equal(projects.ok, true);
  assert.equal(projects.report.catalogsByHostPath.has("cash.md"), true);
  assert.equal(projects.report.projects.length, 66);
  assert.equal(notebooks.ok, true);
  assert.equal(notebooks.report.catalogsByHostPath.has("cash.md"), true);
  // Both property contracts, as the shipped bob advertises them, so the
  // contract probe parks instead of spawning on every leaf change.
  for (const feature of ["props_contract_v1", "props_ref_contract_v1"]) {
    assert.ok(runner.FIXTURE_BOB_REPORTS.capabilityCatalog.features.includes(feature), feature);
  }
});

test("Obsidian child inherits disk-backed temporary storage", () => {
  const env = runner.obsidianChildEnvironment("/profile", "/shim", { TMPDIR: "/var/tmp", PATH: "/usr/bin" });
  assert.equal(env.TMPDIR, "/var/tmp");
  assert.ok(env.PATH.startsWith("/shim" + path.delimiter));
  assert.equal(runner.obsidianChildEnvironment("/profile", "/shim", {}).TMPDIR, os.tmpdir());
});
