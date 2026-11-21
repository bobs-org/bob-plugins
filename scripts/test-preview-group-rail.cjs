#!/usr/bin/env node
// Offline check for scripts/preview-group-rail.cjs (bob-cli-oj rail-proof):
// every fixture builds through the real Ledger Tools builders and carries
// the group row, arm states, derived step row, track form, and album pill
// the matrix expects. No browser.
"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const preview = require("./preview-group-rail.cjs");

test("preview-group-rail fixtures build with the expected rails", () => {
  const built = preview.buildFixtures();
  assert.deepEqual(built.map((f) => f.name), [
    "day-midweek", "today-creatable-monday", "week-midquarter", "week-w47-into-2027", "week-w01-ghost",
    "quarter-q4-ghost", "year-no-row", "legacy-daily-derived", "record-first-wraps-prev", "record-middle",
    "record-last-wraps-next", "record-ghost-head", "record-large-group-bar", "record-single-group", "album-walks-by",
  ]);
  for (const fixture of built) assert.deepEqual(fixture.problems, [], fixture.name);
  const html = Object.fromEntries(built.map((f) => [f.name, f.html]));
  assert.match(html["week-w47-into-2027"], /week 8 of 14/);
  assert.match(html["today-creatable-monday"], /Mon Nov 23 isn&#39;t created yet|Mon Nov 23 isn't created yet/);
  assert.doesNotMatch(html["year-no-row"], /bob-property-card-group-row/);
  assert.match(html["album-walks-by"], /walks by Section/);
});

test("preview-group-rail checks flag forced-colors boxes and narrow landings", () => {
  const fixture = { expect: { groupRow: true } };
  const arm = (owner, extra = {}) => ({ owner, width: 60, height: 26, borderStyle: "solid", edgeRatio: 1, wrapsLines: false,
    spans: { label: { visible: true }, "label-narrow": { visible: false }, landing: { visible: true } }, ...extra });
  const metrics = { row: { scrollOverflow: 0 }, arms: [arm("arm:exists:prev", { edgeRatio: 8 })], items: [], texts: [], borders: [], fills: [] };
  assert.match(preview.checkMetrics(fixture, "forced-colors", 760, metrics).join("; "), /draws a box around existing arms/);
  const narrow = { ...metrics, arms: [arm("arm:exists:prev")] };
  assert.match(preview.checkMetrics(fixture, "normal", 375, narrow).join("; "), /shows its landing at narrow width/);
  const faint = { ...metrics, arms: [], texts: [{ owner: "arm:ghost:prev", kind: "arm-label", ratio: 4.47, min: 4.5, fg: "#6d6d6d", bg: "#e7f1f1" }],
    fills: [{ owner: "bar", kind: "bar", ratio: 2, min: null, fg: "#b6b6b6", bg: "#ffffff" }] };
  assert.deepEqual(preview.checkMetrics(fixture, "normal", 760, faint), ["arm:ghost:prev arm-label contrast 4.47:1 < 4.5:1 (#6d6d6d on #e7f1f1)"]);
});

test("preview-group-rail --self-test", () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, "preview-group-rail.cjs"), "--self-test"], { encoding: "utf8", timeout: 60_000 });
  assert.equal(result.status, 0, (result.stdout || "") + "\n" + (result.stderr || ""));
  assert.match(String(result.stdout || ""), /15 fixtures built, 0 with problems/);
});
