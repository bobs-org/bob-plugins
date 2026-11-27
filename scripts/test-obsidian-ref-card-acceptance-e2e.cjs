"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const runner = require("./obsidian-ref-card-acceptance-e2e.cjs");

test("Ref acceptance fixture inventory separates library notes from non-claims", () => {
  const notes = runner.fixtureEntries();
  const eligible = runner.eligibleFixturePaths(notes);
  assert.ok(eligible.includes("ref/ref-finished-blog.md"));
  assert.ok(eligible.includes("ref/ref-arxiv-paper.md"));
  assert.ok(eligible.includes("ref/ref-legacy-book.md"));
  assert.ok(eligible.includes("ref/ref-title-mismatch.md"));
  assert.ok(eligible.includes("ref/ref-no-title.md"));
  for (const note of runner.NONCLAIMS) assert.ok(Object.hasOwn(notes, note), note);
  assert.ok(!eligible.includes("ref/ref-mixed-type.md"));
  assert.ok(!eligible.includes("ref/ref-sample.assets/note.md"));
  assert.ok(!eligible.includes("ref_history/old-capture.md"));
});

test("the screenshot matrix covers the approved visual review set", () => {
  const rows = runner.screenshotMatrix();
  const cardRows = rows.filter((row) => !["forced-colors", "grayscale", "recovery"].includes(row.label) && !row.label.startsWith("family-"));
  assert.equal(cardRows.length, 40);
  for (const label of ["finished-blog", "next-paper", "blocked-report", "legacy-book", "compact"]) {
    for (const mode of ["live", "reading"]) {
      for (const theme of ["light", "dark"]) {
        for (const width of ["narrow", "wide"]) {
          assert.ok(cardRows.some((row) => row.name === `${label}-${mode}-${theme}-${width}`));
        }
      }
    }
  }
  assert.ok(rows.some((row) => row.label === "forced-colors"));
  assert.ok(rows.some((row) => row.label === "grayscale"));
  assert.ok(rows.some((row) => row.label === "recovery"));
  assert.deepEqual(rows.filter((row) => row.label.startsWith("family-")).map((row) => row.label).filter((label, index, all) => all.indexOf(label) === index).sort(),
    ["family-album", "family-area", "family-notebook", "family-prose"]);
});

test("fixture helpers preserve H1 adoption cases and supply access assets", () => {
  const notes = runner.fixtureEntries();
  assert.equal(runner.matchingHeadingExpected(notes["ref/ref-finished-blog.md"]), true);
  assert.equal(runner.matchingHeadingExpected(notes["ref/ref-title-mismatch.md"]), false);
  assert.equal(runner.matchingHeadingExpected(notes["ref/ref-no-title.md"]), false);
  const binaries = runner.fixtureBinaryEntries();
  assert.equal(Object.keys(binaries).length, 3);
  assert.ok(binaries["lib/agentic-coding-ci.pdf"].toString("ascii").startsWith("%PDF-"));
  assert.ok(binaries["lib/agentic-coding-ci.pdf"].includes(Buffer.from("startxref")));
  assert.ok(binaries["lib/attention-is-all-you-need.pdf"].toString("ascii").startsWith("%PDF-"));
  assert.ok(binaries["lib/agentic-coding-ci.mp3"].toString("ascii").startsWith("ID3"));
});

test("acceptance runner reuses shared harness and records required live evidence", () => {
  const source = fs.readFileSync(path.join(__dirname, "obsidian-ref-card-acceptance-e2e.cjs"), "utf8");
  assert.match(source, /obsidian-frontmatter-takeover-e2e-lib\.cjs/);
  assert.match(source, /obsidian-record-card-e2e\.cjs/);
  assert.match(source, /refCardPreview: true/);
  assert.match(source, /source-mode-restores-native-properties/);
  assert.match(source, /single-owner-nonclaims/);
  assert.match(source, /passive-fold-drawer-resize/);
  assert.match(source, /keys-and-focus-open-reference-editor/);
  assert.match(source, /reference-editor-settings-contract/);
  assert.match(source, /annotation-identity-lineage-and-access-readouts/);
  assert.match(source, /identity-only-shell-without-report-row/);
  assert.match(source, /protected-fixture-and-pdf-bytes-unchanged/);
  assert.match(source, /visualVerdict: "pending inspection"/);
  assert.doesNotMatch(source, /propertyCardOwnFrontmatter\(/);
});

test("offline self-test runs without launching Obsidian", () => {
  runner.selfTest();
  const result = spawnSync(process.execPath, [path.join(__dirname, "obsidian-ref-card-acceptance-e2e.cjs"), "--self-test"], {
    encoding: "utf8", timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no Obsidian launched/);
});

test("runner arguments reject missing values and unknown options", () => {
  assert.equal(runner.parseArgs(["--self-test", "--out", "/tmp/ref"]).selfTest, true);
  assert.throws(() => runner.parseArgs(["--out"]), /requires/);
  assert.throws(() => runner.parseArgs(["--unknown"]), /Unknown argument/);
});

test("species-distinction shots cover every family tile under forced colors and grayscale", () => {
  const rows = runner.screenshotMatrix();
  for (const label of ["forced-colors", "grayscale"]) {
    assert.ok(rows.some((row) => row.name === `species-${label}` && row.effect === label));
    for (const family of ["family-album", "family-area", "family-notebook", "family-prose"]) {
      assert.ok(rows.some((row) => row.name === `${family}-${label}` && row.effect === label), `${family}-${label}`);
    }
  }
  // Only effect rows carry an effect, so ordinary shots always reset media.
  assert.ok(rows.filter((row) => row.effect).every((row) => ["forced-colors", "grayscale"].includes(row.effect)));
});

test("interactive flows record every required concern after the passive hash check", () => {
  const flows = fs.readFileSync(path.join(__dirname, "obsidian-ref-card-acceptance-e2e-flows.cjs"), "utf8");
  for (const name of [
    "native-embed-no-card", "native-hover-no-card", "native-canvas-no-card", "native-print-no-card",
    "native-mobile-emulation", "native-failed-mount", "native-closed-gate-is-todays-rendering",
    "native-unload-and-disabled-ledger-tools", "native-source-cache-mismatch-releases",
    "native-rename-while-open", "native-scan-rewrite-while-open",
    "capability-props-v1-pending-absent-failed-keep-native", "capability-no-ref-contract-title-fallback",
    "capability-failing-report-identity-only", "capability-late-snapshot-keeps-layout", "capability-stale-snapshot-kept",
    "data-today-pill-from-ledger-cache", "data-annotation-jump", "data-identifier-copy", "data-pdf-and-listen-open-on-linux",
    "keys-plus-opens-property-editor", "keys-minus-opens-drawer", "keys-underscore-compacts-card",
    "keys-vim-gg-k-up-stay-in-visible-body", "keys-tab-never-enters-hidden-properties",
    "editor-reference-rows", "editor-title-preview-names-marker-and-link-text", "editor-owned-row-routes",
    "editor-refusals-protected-keys", "editor-esc-q-ctrl-bracket-ladder",
  ]) assert.ok(flows.includes(`"${name}"`), name);
  const runnerSource = fs.readFileSync(path.join(__dirname, "obsidian-ref-card-acceptance-e2e.cjs"), "utf8");
  assert.ok(runnerSource.indexOf('check("protected-fixture-and-pdf-bytes-unchanged"') < runnerSource.indexOf("flows.runFlows("));
});

test("the bob shim forwards stdin envelopes and honors acceptance flags", () => {
  const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "ref-shim-test-"));
  try {
    const real = path.join(dir, "real-bob");
    fs.writeFileSync(real, "#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({ args: process.argv.slice(2), input: require('node:fs').readFileSync(0, 'utf8') }));\n");
    fs.chmodSync(real, 0o755);
    const shim = runner.writeBobShim(dir, path.join(dir, "log.jsonl"), real, dir);
    const piped = spawnSync(shim, ["props", "update", "note.md", "-i", "-"], { input: '{"ops":[]}', encoding: "utf8" });
    assert.equal(piped.status, 0, piped.stderr);
    assert.equal(JSON.parse(piped.stdout).input, '{"ops":[]}');
    fs.writeFileSync(path.join(dir, "ref-list-fail"), "1");
    const failed = spawnSync(shim, ["ref", "list", "-A"], { encoding: "utf8" });
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /forced bob ref list failure/);
    const log = fs.readFileSync(path.join(dir, "log.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.ok(log.some((row) => row.forced === "ref-list-fail"));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
