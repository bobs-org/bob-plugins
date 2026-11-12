#!/usr/bin/env node
// Offline self-test for the real-Obsidian Vim yank flash e2e.
"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { assertFlash } = require("./obsidian-vim-yank-flash-e2e.cjs");

test("obsidian-vim-yank-flash-e2e --self-test", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, "obsidian-vim-yank-flash-e2e.cjs"), "--self-test"],
    { encoding: "utf8", timeout: 20_000 },
  );
  assert.equal(result.status, 0, (result.stdout || "") + "\n" + (result.stderr || ""));
  assert.match(String(result.stdout || ""), /offline self-test complete/);
});

function observation(records, register, lines = [3, 4]) {
  return {
    observation: {
      records,
      baseline: lines.map((number) => ({ number })),
      visibleRanges: [{ from: 0, to: 20 }],
      remaining: [],
    },
    state: { ok: true, register, registers: {} },
  };
}

test("exact line oracle rejects wrong rows, wrong bytes, missing rows, and extra rows", () => {
  const expected = { lines: [3, 4], register: "right\n" };
  assert.doesNotThrow(() => assertFlash(
    observation([{ kind: "line", line: 3 }, { kind: "line", line: 4 }], "right\n"),
    expected,
    "valid",
  ));
  assert.throws(() => assertFlash(
    observation([{ kind: "line", line: 999 }], "right\n"),
    { lines: [3], register: "right\n" },
    "wrong location",
  ), /line coverage/);
  assert.throws(() => assertFlash(
    observation([{ kind: "line", line: 3 }, { kind: "line", line: 4 }], "WRONG\n"),
    expected,
    "wrong text",
  ), /register/);
  assert.throws(() => assertFlash(
    observation([{ kind: "line", line: 3 }], "right\n"),
    expected,
    "missing row",
  ), /line coverage/);
  assert.throws(() => assertFlash(
    observation([{ kind: "line", line: 3 }, { kind: "line", line: 4 }, { kind: "line", line: 8 }], "right\n", [3, 4, 8]),
    expected,
    "extra row",
  ), /line coverage/);
});

test("exact span oracle rejects wrong location, missing bytes, and extra coverage", () => {
  const visibleRanges = [{ from: 0, to: 20 }];
  const make = (spans) => ({
    observation: {
      records: [{ kind: "mark", spans }],
      baseline: [],
      visibleRanges,
      remaining: [],
    },
    state: { ok: true, register: "abc", registers: {} },
  });
  const expected = { spans: [[2, 5]], register: "abc" };
  assert.doesNotThrow(() => assertFlash(make([[2, 5]]), expected, "valid span"));
  assert.throws(() => assertFlash(make([[8, 11]]), expected, "wrong span"), /source coverage/);
  assert.throws(() => assertFlash(make([[2, 4]]), expected, "missing byte"), /source coverage/);
  assert.throws(() => assertFlash(make([[2, 5], [8, 9]]), expected, "extra span"), /source coverage/);
});
