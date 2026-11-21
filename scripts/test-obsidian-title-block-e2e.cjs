#!/usr/bin/env node
// Offline wrapper for the real-Obsidian title-block walkthrough. It validates
// fixtures, inventory completeness, argument handling, and probe syntax; it
// never launches Obsidian or bob and is not the real-Obsidian proof.
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const lib = require("./obsidian-title-block-e2e-lib.cjs");
const runner = require("./obsidian-title-block-e2e.cjs");

const RUNNER = path.join(__dirname, "obsidian-title-block-e2e.cjs");

function spawnRunner(args, timeout = 20_000) {
  return spawnSync(process.execPath, [RUNNER, ...args], { encoding: "utf8", timeout });
}

test("obsidian-title-block-e2e --self-test", () => {
  const result = spawnRunner(["--self-test"]);
  assert.equal(result.status, 0, `${result.stdout || ""}\n${result.stderr || ""}`);
  assert.match(String(result.stdout || ""), /offline self-test complete/);
  assert.match(String(result.stdout || ""), /no Obsidian or bob launched/);
  assert.match(String(result.stdout || ""), /title-block/);
});

test("the phase field names fail-open-proof and retains the walkthrough", () => {
  assert.equal(lib.PHASE, "fail-open-proof");
  assert.equal(runner.PHASE, "fail-open-proof");
  assert.ok(lib.REQUIRED_CHECKS.includes("species-album-live"));
  assert.ok(lib.REQUIRED_CHECKS.includes("edit-undo-restores-bytes"));
  assert.ok(lib.REQUIRED_CHECKS.includes("source-mode-fails-open"));
  assert.ok(lib.REQUIRED_CHECKS.includes("title-slot-insert-failure-fallback"));
  assert.ok(lib.REQUIRED_CHECKS.includes("surface-canvas-day"));
  assert.ok(lib.REQUIRED_CHECKS.includes("print-exclusion-cdp"));
});

test("every mandatory check is listed once and missing or failed names cannot pass", () => {
  assert.equal(new Set(runner.REQUIRED_CHECKS).size, runner.REQUIRED_CHECKS.length);
  assert.deepEqual(runner.REQUIRED_CHECKS, lib.REQUIRED_CHECKS);
  for (const name of [
    "plugins-loaded", "test-clock-agrees",
    "species-album-live", "species-album-reading",
    "species-album-h1less-live", "species-album-h1less-reading",
    "species-album-authored-h1-live", "species-album-authored-h1-reading",
    "species-record-live", "species-record-reading",
    "species-day-today-live", "species-day-today-reading",
    "species-day-past-live", "species-day-empty-live", "species-day-future-live",
    "species-day-legacy-2024-live", "species-day-legacy-2024-reading",
    "species-day-legacy-2025-live", "species-day-legacy-2025-reading",
    "species-day-legacy-2026-live", "species-day-legacy-2026-reading",
    "species-week-live", "species-week-reading",
    "species-quarter-live", "species-quarter-reading",
    "species-year-live", "species-year-reading",
    "scope-same-note-two-panes", "scope-unrelated-note",
    "scope-frontmatter-cursor-keeps-hidden", "scope-restored-cursor-outside-range",
    "vim-gg-across-hidden", "vim-jk-across-hidden", "vim-search-into-hidden-title",
    "outline-jump-live", "outline-jump-reading",
    "heading-link-live", "heading-link-reading",
    "edit-revealed-h1-stays-visible", "edit-undo-restores-bytes",
    "passive-bytes-neutral", "screenshots-captured", "no-console-exceptions",
    "source-mode-fails-open", "source-mode-remounts", "file-switch-restores-native",
    "leaf-close-clears-owner", "plugin-disable-restores-native",
    "title-slot-unavailable-fallback", "title-slot-insert-failure-fallback",
    "plugin-reenable-remounts", "title-slot-unavailable-recovers",
    "title-slot-insert-failure-recovers", "repaint-failure-restores-native",
    "surface-embed-album", "surface-embed-record", "surface-embed-day",
    "surface-hover-album", "surface-hover-record", "surface-hover-day",
    "surface-canvas-album", "surface-canvas-record", "surface-canvas-day",
    "print-exclusion-cdp", "lifecycle-bytes-neutral",
  ]) {
    assert.ok(runner.REQUIRED_CHECKS.includes(name), name);
  }
  const healthy = lib.REQUIRED_CHECKS.map((name) => ({ name, status: "pass", mandatory: true }));
  assert.equal(lib.inventoryStatus(healthy).ok, true);
  assert.equal(lib.inventoryStatus(healthy).complete, true);
  assert.deepEqual(lib.inventoryStatus(healthy.filter((row) => row.name !== "outline-jump-live")).missing, ["outline-jump-live"]);
  assert.equal(lib.inventoryStatus(healthy.filter((row) => row.name !== "outline-jump-live")).ok, false);
  const failed = healthy.map((row) => row.name === "edit-undo-restores-bytes" ? { ...row, status: "fail" } : row);
  assert.deepEqual(lib.inventoryStatus(failed).failed, ["edit-undo-restores-bytes"]);
  assert.equal(lib.inventoryStatus(failed).ok, false);
  const skipped = healthy.map((row) => row.name === "vim-gg-across-hidden" ? { ...row, status: "skip" } : row);
  assert.equal(lib.inventoryStatus(skipped).ok, false);
  assert.deepEqual(lib.inventoryStatus(skipped).failed, ["vim-gg-across-hidden"]);
  assert.equal(lib.inventoryStatus([]).ok, false);
  assert.equal(lib.inventoryStatus([]).complete, false);
  assert.deepEqual(lib.inventoryStatus([]).missing, lib.REQUIRED_CHECKS.slice());
});

test("fixtures cover album, record, day, period, and heading-link notes", () => {
  const { plan, notes } = lib.fixturePlan("2026-11-20");
  assert.equal(plan.paths.today, "2026/20261120.md");
  assert.equal(plan.paths.week, "2026/2026-W47.md");
  assert.equal(plan.paths.quarter, "2026/2026-Q4.md");
  assert.equal(plan.paths.year, "2026.md");
  assert.equal(plan.titles.today, "Fri, Nov 20, 2026");
  assert.equal(plan.titles.week, "2026-W47");
  assert.equal(plan.titles.quarter, "2026-Q4");
  assert.equal(plan.titles.year, "2026");
  assert.ok(notes["eat.md"].includes("\n# Eat\n"));
  assert.ok(!/\ntitle:/.test(notes["eat.md"]));
  assert.ok(notes["eat.md"].includes("## Source heading"));
  assert.ok(notes["bites.md"].includes("\ntitle: Bites\n"));
  assert.ok(!/\n# /.test(notes["bites.md"]));
  assert.ok(notes["authored.md"].includes("\n# Keep this heading\n"));
  assert.ok(notes["eat/ramen.md"].includes('title: "Ramen"'));
  assert.ok(notes["eat/ramen.md"].includes('type: "[[record]]"'));
  assert.ok(!/\n# /.test(notes["eat/ramen.md"]));
  assert.ok(notes[plan.paths.today].includes("GTD-ANCHOR"));
  assert.ok(notes[plan.paths.legacy2024].includes("\nday::2024-01-01 Mon\n"));
  assert.ok(!/\n# /.test(notes[plan.paths.legacy2024]));
  assert.ok(notes[plan.paths.legacy2025].includes("\nday::2025-03-01 Sat\n"));
  assert.ok(notes[plan.paths.legacy2026].includes("\n# 2026-06-01 Mon\n"));
  assert.ok(notes[plan.paths.legacy2026].includes(" | "));
  assert.equal(lib.expectedSpecies().legacy2026.keepsNav, true);
  assert.ok(notes[plan.paths.week].includes("\n# 2026-W47 · Nov 16 – 22\n"));
  assert.ok(notes[plan.paths.quarter].includes("\n# 2026-Q4 · W40–W53 · Sep 28, 2026 – Jan 3, 2027\n"));
  assert.ok(notes[plan.paths.year].includes("\n# 2026 · Dec 29, 2025 – Jan 3, 2027 · 53 weeks\n"));
  assert.ok(notes[plan.paths.year].includes("[[all_time|↑ All time]]"));
  const report = lib.albumListReport();
  assert.equal(report.schema_version, 1);
  assert.ok(report.capabilities.includes("record_values_v1"));
  assert.equal(report.albums[0].path, "eat.md");
  assert.equal(report.albums[0].last_record, "eat/ramen.md");
  assert.ok(notes["links.md"].includes("[[eat#Source heading]]"));
  assert.ok(notes["links.md"].includes("[[2026/20261120#Notes]]"));
  assert.ok(notes[plan.paths.surfaces].includes("![[eat]]"));
  assert.ok(notes[plan.paths.surfaces].includes("[[eat/ramen|Record target]]"));
  const canvas = JSON.parse(notes[plan.paths.canvas]);
  assert.deepEqual(canvas.nodes.map((node) => node.file), ["eat.md", "eat/ramen.md", plan.paths.today]);
  assert.match(notes[plan.paths.canvas], /^\{\n\t"nodes":\[/);
  assert.ok(!notes[plan.paths.canvas].endsWith("\n"), "Canvas fixture starts in Obsidian's stable serialization shape");
  assert.ok(!notes["links.md"].includes("[[\n"), "wikilinks stay on one line");
  assert.throws(() => lib.fixturePlan("2024-01-01"), /collides/);
  assert.throws(() => lib.fixturePlan("2025-03-01"), /collides/);
  assert.throws(() => lib.fixturePlan("2026-06-01"), /collides/);
});

test("parseArgs accepts the documented flags and rejects bad input", () => {
  const args = lib.parseArgs(["--executable", "/x/obsidian", "--out", "/tmp/a", "--report", "/tmp/r.json", "-s", "-h"]);
  assert.deepEqual(args, { executable: "/x/obsidian", out: "/tmp/a", report: "/tmp/r.json", selfTest: true, help: true });
  assert.throws(() => lib.parseArgs(["-e"]), /--executable requires a PATH value/);
  assert.throws(() => lib.parseArgs(["-o", "--self-test"]), /--out requires a DIRECTORY value/);
  assert.throws(() => lib.parseArgs(["-r"]), /--report requires a PATH value/);
  assert.throws(() => lib.parseArgs(["--verbose"]), /Unknown argument: --verbose/);
  const help = spawnRunner(["--bogus"]);
  assert.equal(help.status, 2);
  assert.match(help.stderr, /Unknown argument: --bogus/);
  assert.match(help.stderr, /Usage: node scripts\/obsidian-title-block-e2e\.cjs/);
  const printed = spawnRunner(["-h"]);
  assert.equal(printed.status, 0);
  assert.match(printed.stdout, /Default executable is \/snap\/bin\/obsidian/);
});

test("every page-side source compiles without running", () => {
  const source = lib.probeSource("eat.md");
  assert.doesNotThrow(() => new Function("return " + source));
  assert.match(source, /^\(\(\) => \{/);
  assert.match(source, /bob-property-card/);
  assert.match(source, /aria-level="1"/);
  assert.match(source, /markdown-embed/);
  const leafProbe = lib.probeSource("eat.md", { leafId: "leaf-abc" });
  assert.doesNotThrow(() => new Function("return " + leafProbe));
  assert.match(leafProbe, /getLeafById\("leaf-abc"\)/);
  assert.doesNotMatch(source, /getLeafById/);
  const album = {
    status: "pass", cardCount: 1, embedCardCount: 0, properties: { present: true },
    card: { kind: "album", species: "Album", tileForm: "stack", title: "Eat", slot: "cm-sizer", beforeProperties: true },
    title: { inlineTitle: false, levelOne: [{ text: "Eat", card: true }], h1Shown: [], navShown: 0 },
  };
  assert.deepEqual(lib.placementFailures(album, { ...lib.expectedSpecies().album, title: "Eat", mode: "live" }), []);
  const authored = {
    ...album,
    card: { ...album.card, title: "Authored" },
    title: { inlineTitle: false, levelOne: [{ text: "Authored", card: true }, { text: "Keep this heading", card: false }], h1Shown: ["Keep this heading"], navShown: 0 },
  };
  assert.deepEqual(lib.placementFailures(authored, { ...lib.expectedSpecies().authored, title: "Authored", mode: "live" }), []);
  assert.doesNotThrow(() => new Function("return " + lib.lifecycleSnapshotSource("eat.md", "leaf-abc")));
  assert.doesNotThrow(() => new Function("return " + lib.lifecycleObservationSource("eat.md", "leaf-abc", "async () => true")));
  assert.doesNotThrow(() => new Function("return " + lib.surfaceProbeSource("canvas", "eat.md", "Eat", "canvas", "eat.md", "owner")));
  const dayHidden = {
    ...album,
    card: { kind: "day", species: "Day", tileForm: "leaf", title: "Mon, Jun 1, 2026", slot: "cm-sizer", beforeProperties: true },
    title: { inlineTitle: false, levelOne: [{ text: "Mon, Jun 1, 2026", card: true }], h1Shown: [], navShown: 2 },
  };
  const dayExpect = { ...lib.expectedSpecies().legacy2026, title: "Mon, Jun 1, 2026", mode: "live" };
  assert.deepEqual(lib.placementFailures(dayHidden, dayExpect), []);
  assert.ok(lib.placementFailures(dayHidden, { ...dayExpect, keepsNav: false }).includes("nav visible"));
});

test("installVault enables Outline and copies only the working-tree plugin", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bob-tbe-offline-"));
  try {
    runner.installVault(root);
    const core = JSON.parse(fs.readFileSync(path.join(root, ".obsidian/core-plugins.json"), "utf8"));
    assert.ok(core.includes("outline"));
    assert.ok(core.includes("canvas"));
    assert.ok(core.includes("properties"));
    const app = JSON.parse(fs.readFileSync(path.join(root, ".obsidian/app.json"), "utf8"));
    assert.equal(app.vimMode, true);
    assert.equal(app.showInlineTitle, true);
    assert.equal(app.propertiesInDocument, "visible");
    assert.ok(fs.existsSync(path.join(root, ".obsidian/plugins/bob-ledger-tools/main.js")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
