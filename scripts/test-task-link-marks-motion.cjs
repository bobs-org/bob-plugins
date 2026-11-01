#!/usr/bin/env node
// Computed-style regression for task link mark motion (bob-cli-f5 closeout).
// Renders the production stylesheet in headless Chromium, once at normal
// motion and once with `--force-prefers-reduced-motion`, and asserts what
// `getComputedStyle` reports for a swapped ring: the swap animation and the
// 120 ms transition at normal motion, and neither under reduced motion.
// Checking that a media-query string exists in the CSS is not enough: the
// swap rule once outranked the reduced-motion reset, so a reduced-motion
// browser still computed `animation-name: bob-task-link-mark-swap`.
// Skips when no Chromium is installed (set CHROMIUM_PATH to point at one).
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const preview = require("./preview-task-link-marks.cjs");

test("checkMotionRings judges computed motion (offline)", () => {
  const ring = (swap, extra) => ({
    state: "ready",
    swap,
    animationName: swap ? "bob-task-link-mark-swap" : "none",
    animationDuration: swap ? "0.18s" : "0s",
    transitionProperty: "opacity, background-color",
    transitionDuration: "0.12s, 0.12s",
    ...extra,
  });
  const normal = { reduced: false, rings: [ring(true), ring(false)] };
  assert.deepEqual(preview.checkMotionRings(normal, false), []);
  // The audited defect: reduced motion matches but the swap still animates.
  const stuck = {
    reduced: true,
    rings: [ring(true, { transitionDuration: "0s" }), ring(false, { animationName: "none", transitionDuration: "0s" })],
  };
  const failures = preview.checkMotionRings(stuck, true);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /ready swap ring computes animation-name bob-task-link-mark-swap/);
  // Leftover transitions fail too, and a probe that never matched fails.
  assert.ok(preview.checkMotionRings({ reduced: true, rings: [ring(false, { transitionDuration: "0.12s" })] }, true).length >= 1);
  assert.ok(preview.checkMotionRings({ reduced: false, rings: [ring(true, { transitionDuration: "0s" })] }, true).length >= 1);
  assert.ok(preview.checkMotionRings({ reduced: false, rings: [] }, false).length >= 1);
  // Normal motion must keep the swap animation.
  assert.ok(preview.checkMotionRings({ reduced: false, rings: [ring(true, { animationName: "none" })] }, false).length >= 1);
});

test("production CSS computes no animation or transition under reduced motion", (t) => {
  let chromium = null;
  try {
    chromium = preview.findChromium();
  } catch (error) {
    t.skip(`no Chromium available: ${error.message}`);
    return;
  }
  const out = fs.mkdtempSync(path.join("/tmp", "tlm-motion-"));
  try {
    const result = spawnSync(
      process.execPath,
      [path.join(__dirname, "preview-task-link-marks.cjs"), "--out", out],
      { encoding: "utf8", timeout: 90_000, env: { ...process.env, CHROMIUM_PATH: chromium } },
    );
    const output = `${result.stdout || ""}\n${result.stderr || ""}`;
    assert.equal(result.status, 0, output);
    const summary = JSON.parse(fs.readFileSync(path.join(out, "summary.json"), "utf8"));
    assert.equal(summary.motion.normal.reduced, false);
    assert.equal(summary.motion.reduced.reduced, true);
    for (const ring of summary.motion.reduced.rings) {
      assert.equal(ring.animationName, "none", `${ring.state} swap=${ring.swap}`);
    }
    for (const ring of summary.motion.normal.rings.filter((entry) => entry.swap)) {
      assert.equal(ring.animationName, "bob-task-link-mark-swap", ring.state);
    }
    assert.deepEqual(summary.failures, [], output);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
