const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { BobCopyChipsPlugin, helpers } = require("./copy-chips-test-helpers.cjs");

const FIXTURES = path.join(__dirname, "fixtures");
const vectors = JSON.parse(
  fs.readFileSync(path.join(FIXTURES, "command-chips-vectors.json"), "utf8"),
);
const COPY_VECTORS_PATH = path.join(FIXTURES, "copy-chips-vectors.json");
// C11: copy chips stay byte-stable while command chips land. Changing the
// copy vectors is a deliberate copy-chip contract change: update this pin in
// the same commit and say why.
const COPY_VECTORS_SHA256 = "670fd49c0b8c7c1a2d264c9d412de535abce02124981da5ec5d4ad1aca5e0940";

function chipView(chip) {
  return {
    from: chip.from,
    to: chip.to,
    raw: chip.raw,
    label: chip.label,
    text: chip.text,
  };
}

function kindView(chip) {
  return { kind: chip.kind, ...chipView(chip) };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFrozen(value) {
  if (value === null || typeof value !== "object") return true;
  if (!Object.isFrozen(value)) return false;
  return Object.values(value).every(deepFrozen);
}

test("vector command chips match scanLine", () => {
  for (const vector of vectors.chips) {
    const found = helpers.runChipScanLine(vector.line, { table: Boolean(vector.table) });
    assert.deepEqual(found.map(chipView), vector.expected, vector.id);
  }
});

test("vector non-chips never scan as command chips", () => {
  for (const vector of vectors.not_chips) {
    const found = helpers.runChipScanLine(vector.line, { table: Boolean(vector.table) });
    assert.deepEqual(found.map(chipView), [], vector.id);
  }
});

test("vector mixed lines scan both kinds in one pass", () => {
  for (const vector of vectors.mixed) {
    const found = helpers.chipScanLine(vector.line, { table: Boolean(vector.table) });
    assert.deepEqual(found.map(kindView), vector.expected, vector.id);
    assert.deepEqual(
      helpers.copyChipScanLine(vector.line).map(chipView),
      vector.expected.filter((chip) => chip.kind === "copy").map(({ kind, ...rest }) => rest),
      vector.id + " copy filter",
    );
    assert.deepEqual(
      helpers.runChipScanLine(vector.line).map(chipView),
      vector.expected.filter((chip) => chip.kind === "run").map(({ kind, ...rest }) => rest),
      vector.id + " run filter",
    );
  }
});

test("vector serialize matches exact markdown", () => {
  for (const vector of vectors.serialize) {
    const result = helpers.runChipSerialize(vector.input, vector.opts || {});
    assert.deepEqual(plain(result), vector.expected, vector.id);
    assert.ok(Object.isFrozen(result), vector.id);
  }
});

test("vector fence_info matches parseFenceInfo", () => {
  for (const vector of vectors.fence_info) {
    assert.deepEqual(
      plain(helpers.runChipParseFenceInfo(vector.info)),
      vector.expected,
      vector.id,
    );
  }
});

test("vector link_spans match chipLinkSpans", () => {
  for (const vector of vectors.link_spans) {
    const spans = helpers.chipLinkSpans(vector.line);
    assert.deepEqual(plain(spans), vector.expected, vector.id);
    assert.ok(deepFrozen(spans), vector.id);
  }
});

test("vector chip_at follows the command-chip cursor rule", () => {
  for (const vector of vectors.chip_at) {
    const request = { lines: vector.lines, line: vector.line, ch: vector.ch };
    if (vector.scope) request.scope = vector.scope;
    const result = helpers.commandChipAt(request);
    assert.deepEqual(plain(result), vector.expected, vector.id);
    assert.ok(deepFrozen(result), vector.id);
  }
});

test("chip_at vectors cover every rule and result shape", () => {
  const seen = new Set();
  for (const vector of vectors.chip_at) {
    seen.add(vector.expected.state + ":" + (vector.expected.via || "-"));
  }
  for (const key of [
    "none:-",
    "ambiguous:line",
    "ambiguous:task",
    "ready:fence",
    "ready:cursor",
    "ready:line",
    "ready:task",
  ]) {
    assert.ok(seen.has(key), "missing chip_at coverage for " + key);
  }
});

test("copy vectors are unchanged and the shared scanner reproduces them", () => {
  const bytes = fs.readFileSync(COPY_VECTORS_PATH);
  assert.equal(
    crypto.createHash("sha256").update(bytes).digest("hex"),
    COPY_VECTORS_SHA256,
    "copy-chips-vectors.json changed; copy chips must stay byte-stable (C11)",
  );
  const copyVectors = JSON.parse(bytes.toString("utf8"));
  for (const vector of copyVectors.chips) {
    const found = helpers.chipScanLine(vector.line, { table: Boolean(vector.table) });
    assert.deepEqual(
      found.map(kindView),
      vector.expected.map((chip) => ({ kind: "copy", ...chip })),
      vector.id,
    );
    assert.deepEqual(helpers.runChipScanLine(vector.line, { table: Boolean(vector.table) }), [], vector.id);
  }
  for (const vector of copyVectors.not_chips) {
    const found = helpers.chipScanLine(vector.line, { table: Boolean(vector.table) });
    assert.deepEqual(found.filter((chip) => chip.kind === "copy"), [], vector.id);
  }
  for (const vector of copyVectors.fence_info) {
    assert.equal(helpers.runChipParseFenceInfo(vector.info), null, vector.id);
  }
});

test("kinds never compete in either cursor rule", () => {
  const line = "`copy: ssh apollo` `run: bob plan`";
  const copyHit = helpers.copyChipAt({ lines: [line], line: 0, ch: 25 });
  assert.equal(copyHit.state, "ready");
  assert.equal(copyHit.chip.text, "ssh apollo");
  assert.equal(copyHit.count, 1);
  const runHit = helpers.commandChipAt({ lines: [line], line: 0, ch: 2 });
  assert.equal(runHit.state, "ready");
  assert.equal(runHit.via, "line");
  assert.equal(runHit.chip.text, "bob plan");

  const lines = [
    "- [ ] #task Example",
    "  ```bob-run",
    "  bob plan",
    "  ```",
    "  - `copy: ssh apollo`",
  ];
  const scope = { kind: "task", lines: [0, 1, 2, 3, 4] };
  const copyTask = helpers.copyChipAt({ lines, line: 0, ch: 3, scope });
  assert.equal(copyTask.state, "ready");
  assert.equal(copyTask.chip.text, "ssh apollo");
  const runTask = helpers.commandChipAt({ lines, line: 0, ch: 3, scope });
  assert.equal(runTask.state, "ready");
  assert.equal(runTask.via, "task");
  assert.equal(runTask.chip.text, "bob plan");
  assert.equal(helpers.copyChipAt({ lines, line: 2, ch: 3 }).state, "none");
});

test("parse mirrors the copy grammar with the run prefix", () => {
  assert.deepEqual(plain(helpers.runChipParseContent("run: bob plan")), { label: null, text: "bob plan" });
  assert.deepEqual(plain(helpers.runChipParseContent("run[Sync \\]]: bob plan")), { label: "Sync ]", text: "bob plan" });
  assert.deepEqual(plain(helpers.runChipParseContent("run[  ]: bob plan")), { label: null, text: "bob plan" });
  assert.equal(helpers.runChipParseContent("run[a\nb]: bob plan"), null);
  assert.equal(helpers.runChipParseContent("copy: bob plan"), null);
  assert.equal(helpers.runChipParseContent("run:"), null);
  assert.equal(helpers.runChipParseContent(42), null);
  assert.ok(Object.isFrozen(helpers.runChipParseContent("run: x")));
});

test("shielded ranges skip delimiters inside code spans", () => {
  assert.deepEqual(plain(helpers.chipShieldedRanges("`$` x `$`")), []);
  assert.deepEqual(plain(helpers.chipShieldedRanges("`%%` `run: bob plan`")), []);
  assert.deepEqual(plain(helpers.chipShieldedRanges("$a$ and \\$b$")), [{ from: 0, to: 3 }]);
  assert.deepEqual(plain(helpers.chipShieldedRanges("a <!-- b --> c %% d")), [
    { from: 2, to: 12 },
    { from: 15, to: 19 },
  ]);
  assert.deepEqual(plain(helpers.chipShieldedRanges(null)), []);
});

test("garbage inputs never throw", () => {
  for (const value of [undefined, null, 42, {}, [], "`", "``run: x", "[[", "[a](", "<", "$"]) {
    assert.doesNotThrow(() => helpers.chipScanLine(value));
    assert.doesNotThrow(() => helpers.runChipScanLine(value));
    assert.doesNotThrow(() => helpers.chipLinkSpans(value));
    assert.doesNotThrow(() => helpers.runChipParseFenceInfo(value));
    assert.doesNotThrow(() => helpers.runChipSerialize(value));
    assert.doesNotThrow(() => helpers.commandChipAt(value));
    assert.doesNotThrow(() => helpers.commandChipAt({ lines: [value], line: 0, ch: 0 }));
  }
  assert.deepEqual(plain(helpers.commandChipAt(null)), { state: "none", count: 0 });
  assert.deepEqual(plain(helpers.runChipSerialize(null)), { ok: false, reason: "nothing to run" });
});

test("api.commandChips v1 is frozen, pure, and never throws", async () => {
  const plugin = new BobCopyChipsPlugin({});
  await plugin.onload();
  assert.ok(Object.isFrozen(plugin.api));
  assert.equal(plugin.api.copyChips.version, 2);
  const api = plugin.api.commandChips;
  assert.ok(Object.isFrozen(api));
  assert.deepEqual(Object.keys(api).sort(), [
    "chipAt",
    "fencePayload",
    "parse",
    "parseFenceInfo",
    "scanLine",
    "serialize",
    "version",
  ]);
  assert.equal(api.version, 1);
  assert.deepEqual(plain(api.parse("run: bob plan")), { label: null, text: "bob plan" });
  assert.equal(api.parse("copy: bob plan"), null);
  const scanned = api.scanLine("`copy: x` `run[Sync]: bob gcal sync`");
  assert.deepEqual(plain(scanned), [
    { from: 10, to: 36, raw: "`run[Sync]: bob gcal sync`", label: "Sync", text: "bob gcal sync" },
  ]);
  assert.deepEqual(plain(api.parseFenceInfo("bob-run Morning sync")), { label: "Morning sync" });
  assert.equal(api.parseFenceInfo("bob-copy Morning sync"), null);
  assert.equal(api.fencePayload(["bob plan", "bob gkeep pull"]), "bob plan\nbob gkeep pull");
  assert.equal(api.serialize({ text: "bob plan" }).markdown, "`run: bob plan`");
  assert.equal(api.serialize({ text: "bob plan\nbob gkeep pull" }, { table: true }).ok, false);
  const hit = api.chipAt({ lines: ["`run: bob plan`"], line: 0, ch: 2 });
  assert.equal(hit.state, "ready");
  assert.equal(hit.via, "cursor");
  assert.ok(Object.isFrozen(hit));
  for (const value of [undefined, null, 42, "nope", {}]) {
    assert.doesNotThrow(() => api.parse(value));
    assert.doesNotThrow(() => api.scanLine(value));
    assert.doesNotThrow(() => api.parseFenceInfo(value));
    assert.doesNotThrow(() => api.fencePayload(value));
    assert.doesNotThrow(() => api.serialize(value, value));
    assert.doesNotThrow(() => api.chipAt(value));
  }
  assert.deepEqual(plain(api.chipAt({ lines: "nope", line: 0, ch: 0 })), { state: "none", count: 0 });
});

test("the fallback namespace keeps the v1 shape", () => {
  const api = helpers.commandChipFallbackApi();
  assert.ok(Object.isFrozen(api));
  assert.deepEqual(Object.keys(api).sort(), Object.keys(helpers.commandChipBuildApi()).sort());
  assert.equal(api.version, 1);
  assert.equal(api.parse("run: bob plan"), null);
  assert.deepEqual(plain(api.scanLine("`run: bob plan`")), []);
  assert.deepEqual(plain(api.chipAt({ lines: ["`run: bob plan`"], line: 0, ch: 0 })), {
    state: "none",
    count: 0,
  });
});
