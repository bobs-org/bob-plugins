#!/usr/bin/env node
// Offline check for scripts/preview-group-rail.cjs (bob-cli-oj rail-proof):
// every fixture builds through the real Ledger Tools builders and carries
// the group row, arm states, skip marks, derived step row, track form, and
// album pill the matrix expects. No browser.
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
    "record-last-wraps-next", "record-screenshot-single-member", "record-ghost-head", "record-large-group-bar",
    "record-single-group", "album-walks-by",
  ]);
  for (const fixture of built) assert.deepEqual(fixture.problems, [], fixture.name);
  const html = Object.fromEntries(built.map((f) => [f.name, f.html]));
  assert.match(html["week-w47-into-2027"], /title="Week 8 of 14 in quarter Q4"/, "the centre's title carries the position");
  assert.doesNotMatch(html["week-w47-into-2027"], /bob-property-card-group-position-wide|bob-property-card-group-landing/);
  assert.match(html["week-w47-into-2027"], /data-icon="skip-back"><svg[^>]*viewBox="0 0 24 24"/);
  for (const f of built) assert.doesNotMatch(f.html, /group-glyph[^>]*>[«»]/, f.name);
  assert.doesNotMatch(html["record-screenshot-single-member"], /bob-property-card-group-center/, "one member: no centre");
  assert.match(html["record-screenshot-single-member"], /\]N · next section: 🤖 Agent CLIs → Memory/);
  assert.match(html["today-creatable-monday"], /Mon Nov 23 isn&#39;t created yet|Mon Nov 23 isn't created yet/);
  assert.doesNotMatch(html["year-no-row"], /bob-property-card-group-row/);
  assert.match(html["album-walks-by"], /walks by Section/);
});

test("preview-group-rail checks flag arm boxes, landings, missing marks, centre text, and narrow labels", () => {
  const fixture = { expect: { groupRow: true } };
  const arm = (owner, extra = {}) => ({ owner, width: 60, height: 26, borderStyle: "none", borderWidth: "0px", wrapsLines: false,
    spans: { label: { visible: true }, "label-narrow": { visible: false }, landing: null, sep: null },
    mark: { width: 12, height: 12, icon: "skip-back" }, underline: null, visibleText: "Q2", ...extra });
  const clean = { row: { scrollOverflow: 0, center: { title: "Week 4 of 13 in quarter Q3", visibleText: "" } },
    arms: [arm("arm:exists:prev")], items: [], texts: [], borders: [], fills: [] };
  assert.deepEqual(preview.checkMetrics(fixture, "normal", 760, clean), []);
  const boxed = { ...clean, arms: [arm("arm:creatable:next", { borderStyle: "dashed", borderWidth: "1px", underline: { style: "dashed" } })] };
  assert.match(preview.checkMetrics(fixture, "forced-colors", 760, boxed).join("; "), /draws a box around group arms/);
  const landing = { ...clean, arms: [arm("arm:exists:prev", { spans: { ...clean.arms[0].spans, landing: { visible: true } }, visibleText: "« Q2 · W14" })] };
  const landingFailures = preview.checkMetrics(fixture, "normal", 760, landing).join("; ");
  assert.match(landingFailures, /paints its landing/);
  assert.match(landingFailures, /shows « \/ »/);
  assert.match(preview.checkMetrics(fixture, "normal", 760, { ...clean, arms: [arm("arm:exists:prev", { mark: null })] }).join("; "), /draws no skip mark/);
  assert.match(preview.checkMetrics(fixture, "normal", 760, { ...clean, arms: [arm("arm:ghost:prev", { underline: { style: "dashed" }, ariaDisabled: "true" })] }).join("; "),
    /underline is dashed/);
  assert.match(preview.checkMetrics(fixture, "normal", 760, { ...clean, row: { ...clean.row, center: { title: "x", visibleText: "week 4 of 13" } } }).join("; "),
    /group centre shows text/);
  assert.match(preview.checkMetrics({ expect: { groupRow: true, track: "none" } }, "normal", 760, clean).join("; "), /one-member group draws a centre/);
  const narrow = { ...clean, arms: [arm("arm:exists:prev")] };
  assert.match(preview.checkMetrics(fixture, "normal", 375, narrow).join("; "), /shows its wide label at narrow width/);
  const metrics = clean;
  const faint = { ...metrics, arms: [], texts: [{ owner: "arm:ghost:prev", kind: "arm-label", ratio: 4.47, min: 4.5, fg: "#6d6d6d", bg: "#e7f1f1" }],
    fills: [{ owner: "bar", kind: "bar", ratio: 2, min: null, fg: "#b6b6b6", bg: "#ffffff" }] };
  assert.deepEqual(preview.checkMetrics(fixture, "normal", 760, faint), ["arm:ghost:prev arm-label contrast 4.47:1 < 4.5:1 (#6d6d6d on #e7f1f1)"]);
});

test("preview-group-rail --self-test", () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, "preview-group-rail.cjs"), "--self-test"], { encoding: "utf8", timeout: 60_000 });
  assert.equal(result.status, 0, (result.stdout || "") + "\n" + (result.stderr || ""));
  assert.match(String(result.stdout || ""), /16 fixtures built, 0 with problems/);
});
