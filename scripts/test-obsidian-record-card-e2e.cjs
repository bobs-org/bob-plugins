#!/usr/bin/env node
// Offline fixture and assertion checks for the real Record Card proof runner.
"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

test("obsidian-record-card-e2e --self-test", (t) => {
  const result = spawnSync(process.execPath, [path.join(__dirname, "obsidian-record-card-e2e.cjs"), "--self-test"], {
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(result.status, 0, String(result.stdout || "") + "\n" + String(result.stderr || ""));
  assert.match(String(result.stdout || ""), /offline self-test complete/);
  assert.doesNotMatch(String(result.stdout || ""), /^UNRUN:/m);
});

test("hide assertion refuses absent native UI and incorrect visibility", () => {
  const { assertNativeVisibility } = require("./obsidian-record-card-e2e-lib.cjs");
  assert.throws(() => assertNativeVisibility({
    status: "pass",
    properties: { present: false, display: "none", visibility: "hidden", rectVisible: false },
    inlineTitle: { present: true, display: "none", visibility: "hidden", rectVisible: false },
  }, true), /is absent/);
  assert.throws(() => assertNativeVisibility({
    status: "pass",
    properties: { present: true, display: "block", visibility: "visible", rectVisible: true },
    inlineTitle: { present: true, display: "none", visibility: "hidden", rectVisible: false },
  }, false), /visibility mismatch/);
});

test("frontmatter cursor expression keeps escaped newlines valid for CDP evaluation", () => {
  const { frontmatterBodyCursorExpression } = require("./obsidian-record-card-e2e-lib.cjs");
  const expression = frontmatterBodyCursorExpression("zettels/bead_lifecycle.md");
  assert.match(expression, /text\.indexOf\("\\n---"/);
  assert.match(expression, /split\(\/\\r\?\\n\//);
  assert.doesNotThrow(() => new Function("return " + expression + ";"));
});

test("frontmatter cursor reaches the closing delimiter even after sync appends a walk footer", () => {
  const { frontmatterBodyCursorExpression } = require("./obsidian-record-card-e2e-lib.cjs");
  const path = "zettels/frontmatter-only.md";
  const frontmatter = '---\ntitle: Frontmatter Only\n---';
  for (const text of [frontmatter, frontmatter + '\n\n[[zettels|⬆]] · [[zettels/next|→]]\n']) {
    const cm = {
      state: { doc: { toString: () => text, length: text.length }, selection: { main: { head: 0 } } },
      dispatch: ({ selection }) => { cm.state.selection.main.head = selection.anchor; },
    };
    const app = { workspace: { getLeavesOfType: () => [{ view: { file: { path }, editor: { cm } } }] } };
    const result = new Function("app", "return " + frontmatterBodyCursorExpression(path, true))(app);
    assert.equal(result.ok, true);
    assert.equal(result.target, frontmatter.length);
    assert.equal(result.delimiter, "---");
    assert.equal(cm.state.selection.main.head, frontmatter.length);
  }
});

test("fixture album sync accepts only its exact malformed-schema and outside-folder findings", () => {
  const { isExpectedFixtureAlbumSync } = require("./obsidian-record-card-e2e-lib.cjs");
  const expected = {
    exitCode: 1,
    signal: null,
    report: {
      command: "sync",
      ok: false,
      schema_version: 1,
      counts: { errors: 2, damaged: 1, warnings: 0 },
      sync: { pre: "ok", post: "ok" },
      io_errors: [],
      findings: [
        { path: "broken.md", code: "album_index_damaged", severity: "error" },
        { path: "broken.md", code: "album_schema_invalid", severity: "error" },
        { path: "misfiled.md", code: "album_child_reparent", severity: "info" },
      ],
    },
  };
  assert.equal(isExpectedFixtureAlbumSync(expected), true);
  assert.equal(isExpectedFixtureAlbumSync({ ...expected, exitCode: 0 }), false);
  assert.equal(isExpectedFixtureAlbumSync({
    ...expected,
    report: { ...expected.report, findings: [...expected.report.findings, { path: "unexpected.md", code: "new_error", severity: "error" }] },
  }), false);
  assert.equal(isExpectedFixtureAlbumSync({
    ...expected,
    report: { ...expected.report, counts: { ...expected.report.counts, errors: 3 } },
  }), false);
});

test("fixture album list accepts only its exact findings while requiring record_values_v1", () => {
  const { isExpectedFixtureAlbumList } = require("./obsidian-record-card-e2e-lib.cjs");
  const expected = {
    args: ["albums", "list", "-f", "json"],
    exitCode: 0,
    signal: null,
    report: {
      ok: false,
      schema_version: 1,
      capabilities: ["record_values_v1"],
      counts: { albums: 6, errors: 2, warnings: 0, records: 10 },
      albums: [
        { path: "broken.md", issues: [
          { path: "broken.md", code: "album_index_damaged", severity: "error" },
          { path: "broken.md", code: "album_schema_invalid", severity: "error" },
        ] },
        { path: "movies.md", issues: [
          { path: "misfiled.md", code: "album_child_reparent", severity: "info" },
        ] },
      ],
    },
  };
  assert.equal(isExpectedFixtureAlbumList(expected), true);
  assert.equal(isExpectedFixtureAlbumList({ ...expected, exitCode: 1 }), false);
  assert.equal(isExpectedFixtureAlbumList({ ...expected, args: ["albums", "sync", "-f", "json"] }), false);
  assert.equal(isExpectedFixtureAlbumList({
    ...expected,
    report: { ...expected.report, capabilities: [] },
  }), false);
  assert.equal(isExpectedFixtureAlbumList({
    ...expected,
    report: { ...expected.report, albums: [...expected.report.albums, { path: "surprise.md", issues: [{ path: "surprise.md", code: "new_issue", severity: "error" }] }] },
  }), false);
});
