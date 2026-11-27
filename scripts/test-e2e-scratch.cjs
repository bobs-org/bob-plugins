"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const scratch = require("./e2e-scratch.cjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-scratch-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function run(root, prefix = "bob-home-cards-") {
  return scratch.createScratch({ root, prefix });
}

function age(dir, seconds) {
  const date = new Date(Date.now() - seconds * 1000);
  fs.utimesSync(dir, date, date);
}

test("successful runs remove their scratch", (t) => {
  const root = fixture(t);
  const current = run(root);
  assert.equal(fs.existsSync(current.dir), true);
  assert.equal(scratch.finishScratch(current, { success: true, log() {} }), null);
  assert.equal(fs.existsSync(current.dir), false);
});

test("failure retention keeps only the newest owned run for that runner", (t) => {
  const root = fixture(t);
  const retainedPaths = [];
  const first = run(root);
  scratch.finishScratch(first, { success: false, log() {} });
  age(first.dir, 30);
  retainedPaths.push(first.dir);

  const second = run(root);
  scratch.finishScratch(second, { success: false, log() {} });
  age(second.dir, 20);
  retainedPaths.push(second.dir);

  const third = run(root);
  let logged = "";
  assert.equal(scratch.finishScratch(third, { success: false, log: (line) => { logged += line; } }), third.dir);
  assert.match(logged, new RegExp(third.dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(fs.existsSync(retainedPaths[0]), false);
  assert.equal(fs.existsSync(retainedPaths[1]), false);
  assert.equal(fs.existsSync(third.dir), true);
  assert.equal(fs.readdirSync(root).filter((name) => name.startsWith("bob-home-cards-")).length, 1);
});

test("keep mode preserves successful runs and skips pruning", (t) => {
  const root = fixture(t);
  const oldRun = run(root);
  age(oldRun.dir, 10);
  scratch.finishScratch(oldRun, { success: false, log() {} });

  const keptRun = run(root);
  assert.equal(scratch.finishScratch(keptRun, { success: true, keep: true, log() {} }), keptRun.dir);
  assert.equal(fs.existsSync(oldRun.dir), true);
  assert.equal(fs.existsSync(keptRun.dir), true);

  const laterRun = run(root);
  scratch.finishScratch(laterRun, { success: false, log() {} });
  assert.equal(fs.existsSync(keptRun.dir), true);
  assert.equal(fs.existsSync(laterRun.dir), true);
});

test("pruning ignores other runner prefixes and symlinks", (t) => {
  const root = fixture(t);
  const unrelated = path.join(root, "bob-cabinets-e2e-unrelated");
  fs.mkdirSync(unrelated);
  const legacy = path.join(root, "bob-home-cards-legacy-leftover");
  fs.mkdirSync(legacy);
  const outside = path.join(root, "outside");
  fs.mkdirSync(outside);
  const link = path.join(root, "bob-home-cards-link");
  fs.symlinkSync(outside, link, "dir");

  for (let i = 0; i < 3; i++) {
    const current = run(root);
    scratch.finishScratch(current, { success: false, log() {} });
    age(current.dir, 30 - i * 10);
  }

  assert.equal(fs.existsSync(unrelated), true);
  assert.equal(fs.existsSync(legacy), true);
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
  assert.equal(fs.existsSync(outside), true);
});
