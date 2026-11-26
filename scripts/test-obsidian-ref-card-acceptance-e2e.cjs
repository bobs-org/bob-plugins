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
