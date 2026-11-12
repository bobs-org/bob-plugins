#!/usr/bin/env node
// Offline self-test for the album UI real-Obsidian e2e.
// Never launches Obsidian.
"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

test("obsidian-album-ui-e2e --self-test", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, "obsidian-album-ui-e2e.cjs"), "--self-test"],
    { encoding: "utf8", timeout: 120_000 },
  );
  assert.equal(result.status, 0, `${result.stdout || ""}\n${result.stderr || ""}`);
  assert.match(String(result.stdout || ""), /offline self-test complete/);
});

const album = require("./obsidian-album-ui-e2e-lib.cjs");

test("header acceptance rejects duplicate chrome, false warnings, and callout headers", () => {
  const healthy = { activeHeaders: [{}], ancestryWarnings: [], headersInRecords: [] };
  assert.equal(album.assertHeaderIntegrity(healthy).ok, true);
  for (const invalid of [
    {},
    { ...healthy, activeHeaders: [] },
    { ...healthy, activeHeaders: [{}, {}] },
    { ...healthy, ancestryWarnings: [{}] },
    { ...healthy, headersInRecords: [{}] },
  ]) assert.equal(album.assertHeaderIntegrity(invalid).ok, false);
  const probe = album.albumUiProbe();
  assert.match(probe, /bob-album-header-ancestry-note/);
  assert.match(probe, /headersInRecords/);
});
