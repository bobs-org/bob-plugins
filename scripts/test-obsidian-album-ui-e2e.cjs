#!/usr/bin/env node
// Offline self-test for the album UI real-Obsidian e2e.
// Never launches Obsidian.
"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

test("obsidian-album-ui-e2e --self-test", (t) => {
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, "obsidian-album-ui-e2e.cjs"), "--self-test"],
    { encoding: "utf8", timeout: 120_000 },
  );
  assert.equal(result.status, 0, `${result.stdout || ""}\n${result.stderr || ""}`);
  if (/^UNRUN:/m.test(String(result.stdout || ""))) {
    t.skip(String(result.stdout || "").trim());
    return;
  }
  assert.match(String(result.stdout || ""), /offline self-test complete/);
});

test("real-Bob logging shim forwards and accounts for JSON stdin", () => {
  const source = require("node:fs").readFileSync(path.join(__dirname, "obsidian-album-ui-e2e.cjs"), "utf8");
  assert.match(source, /const expectsInput = inputArg >= 0 && argv\[inputArg \+ 1\] === "-"/);
  assert.match(source, /if \(expectsInput\) \{\s*try \{ input = fs\.readFileSync\(0, "utf8"\)/);
  assert.match(source, /input = fs\.readFileSync\(0, "utf8"\)/);
  assert.match(source, /stdinBytes: Buffer\.byteLength\(input\)/);
  assert.match(source, /inputJsonValid/);
  assert.match(source, /env, input, timeout: 30000/);
  assert.match(source, /schema-preview-envelope-forwarded/);
  assert.match(source, /albumReportState: \(\(\) =>/);
  assert.match(source, /targetCount: content\?\.querySelectorAll/);
  assert.match(source, /bobInvocations = shimInvocationSummary/);
});

test("keyboard staging targets the row selected after navigation", () => {
  const source = require("node:fs").readFileSync(path.join(__dirname, "obsidian-album-ui-e2e.cjs"), "utf8");
  assert.match(source, /\[data-target-key\]\.is-selected/);
  assert.match(source, /selected\.dispatchEvent\(new KeyboardEvent\("keydown", \{ key: "Enter"/);
});

test("album UI e2e probes field keycap geometry and captures light/dark/375 shots", () => {
  const source = require("node:fs").readFileSync(path.join(__dirname, "obsidian-album-ui-e2e.cjs"), "utf8");
  assert.match(source, /schema-field-rest-transparent/);
  assert.match(source, /schema-label-axis/);
  assert.match(source, /schema-keycap-size/);
  assert.match(source, /schema-filled-trailing/);
  assert.match(source, /schema-label-axis-375/);
  assert.match(source, /1\.45 \* fontSize/);
  assert.match(source, /fieldLefts/);
  assert.match(source, /isMarkdownSource/);
  assert.match(source, /schema-group-break/);
  assert.match(source, /schema-hint-strip-bounds/);
  assert.match(source, /album-schema-fields-light\.png/);
  assert.match(source, /album-schema-fields-375\.png/);
});

test("album UI e2e captures the Emoji Slot in both themes", () => {
  const source = require("node:fs").readFileSync(path.join(__dirname, "obsidian-album-ui-e2e.cjs"), "utf8");
  assert.match(source, /\[data-emoji-well\]/);
  assert.match(source, /captureEmojiThemes\("empty"\)/);
  assert.match(source, /captureEmojiThemes\("filtered"\)/);
  assert.match(source, /captureEmojiThemes\("browse"\)/);
  assert.match(source, /album-schema-emoji-\$\{stem\}-375-dark\.png/);
});

const album = require("./obsidian-album-ui-e2e-lib.cjs");
const properties = require("./obsidian-album-properties-e2e.cjs");

test("Properties acceptance requires the actual row and byte-identical record block", () => {
  const before = properties.recordBlock(properties.ROUNDTRIP_NOTE);
  assert.match(before, /  legacy:\n    - lid\n    - source_\*/);
  assert.equal(properties.recordBlock(properties.ROUNDTRIP_NOTE.replace("Before the Properties edit.", "Changed.")), before);
  assert.notEqual(properties.recordBlock(properties.ROUNDTRIP_NOTE.replace("    - lid", "  - lid")), before);
  assert.throws(() => properties.recordBlock("record: []\n"));
  const hidden = { path: "eat.md", rows: [{ visible: false }] };
  assert.equal(properties.propertyVisibility(hidden, "eat.md", false), true);
  assert.equal(properties.propertyVisibility(hidden, "eat.md", true), false);
  assert.equal(properties.propertyVisibility(hidden, "other.md", false), false);
  assert.equal(properties.propertyVisibility({ path: "eat.md", rows: [] }, "eat.md", false), false);
});

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
  assert.match(probe, /const schemaRoot = plugin\?\.albumSchemaCardModal\?\.contentEl \|\| document/);
  assert.match(probe, /schemaPick\("\.bob-album-schema-dialog"\)/);
});

test("header acceptance requires the title-slot card, its identity, and one visible heading", () => {
  const card = {
    slot: "mod-header", next: "metadata-container", kind: "album", label: "Album: Eat",
    inlineTitleHidden: true, visibleLevelOne: 1,
  };
  const reading = { activeHeaders: [{}], ancestryWarnings: [], headersInRecords: [], mode: "preview", activeCard: card };
  assert.equal(album.assertHeaderIntegrity(reading, { title: "Eat" }).ok, true);
  const live = { ...reading, mode: "source", activeCard: { ...card, slot: "cm-sizer" } };
  assert.equal(album.assertHeaderIntegrity(live, { title: "Eat" }).ok, true);
  for (const [name, invalid, expect] of [
    ["missing card", { ...reading, activeCard: null }, {}],
    ["body placement", { ...reading, activeCard: { ...card, slot: "" } }, {}],
    ["wrong mode slot", { ...live, activeCard: card }, {}],
    ["after Properties", { ...reading, activeCard: { ...card, next: "el-h1" } }, {}],
    ["no kind", { ...reading, activeCard: { ...card, kind: "" } }, {}],
    ["wrong name", reading, { title: "Restaurants" }],
    ["inline title shown", { ...reading, activeCard: { ...card, inlineTitleHidden: false } }, {}],
    ["two headings", { ...reading, activeCard: { ...card, visibleLevelOne: 2 } }, {}],
    ["no heading", { ...reading, activeCard: { ...card, visibleLevelOne: 0 } }, {}],
  ]) assert.equal(album.assertHeaderIntegrity(invalid, expect).ok, false, name);
  const probe = album.albumUiProbe();
  assert.match(probe, /activeCard/);
  assert.match(probe, /visibleLevelOne/);
  assert.match(probe, /inlineTitleHidden/);
  assert.match(probe, /data-album-body/);
  const notes = album.fixtureNotes();
  assert.match(notes["h1less-album.md"], /\ntitle: Bites\n/, "the post-tidy fixture carries title: and no H1");
  const source = require("node:fs").readFileSync(path.join(__dirname, "obsidian-album-ui-e2e.cjs"), "utf8");
  for (const name of ["reading-h1-hidden", "live-title-blanks-collapse-and-reveal", "schema-fold-default", "card-identity",
    "post-tidy-title-hides-nothing", "-title-block-before-report", "-body-joins-same-node"]) {
    assert.ok(source.includes(name), name);
  }
});
