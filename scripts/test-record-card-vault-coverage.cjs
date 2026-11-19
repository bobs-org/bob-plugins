"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

test("read-only vault coverage: offline discovery, YAML, homes, findings and stability", () => {
  const result = spawnSync("python3", [path.join(__dirname, "test-record-card-vault-coverage.py"), "-v"], {
    encoding: "utf8", timeout: 30_000,
  });
  assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
});
