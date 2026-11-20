#!/usr/bin/env node
// Offline check for scripts/preview-command-chips-author.cjs: every case's
// kind, validity, warning, Add bob, and preview form match the production
// card's model, verdicts come from Command Mode's resolver, and the page
// assembles from the built plugin. No browser.
"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

test("preview-command-chips-author --self-test", () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, "preview-command-chips-author.cjs"), "--self-test"], { encoding: "utf8", timeout: 60_000 });
  assert.equal(result.status, 0, (result.stdout || "") + "\n" + (result.stderr || ""));
  assert.match(String(result.stdout || ""), /offline self-test complete/);
});
