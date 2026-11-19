const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { BobCopyChipsPlugin, helpers } = require("./copy-chips-test-helpers.cjs");

const vectors = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "copy-chips-vectors.json"), "utf8"),
);

function chipView(chip) {
  return {
    from: chip.from,
    to: chip.to,
    raw: chip.raw,
    label: chip.label,
    text: chip.text,
  };
}

test("vector chips match scanLine", () => {
  for (const vector of vectors.chips) {
    const found = helpers.copyChipScanLine(vector.line, { table: Boolean(vector.table) });
    assert.deepEqual(
      found.map(chipView),
      vector.expected,
      vector.id,
    );
  }
});

test("vector non-chips never scan", () => {
  for (const vector of vectors.not_chips) {
    const found = helpers.copyChipScanLine(vector.line, { table: Boolean(vector.table) });
    assert.deepEqual(found.map(chipView), [], vector.id);
  }
});

test("vector serialize matches exact markdown", () => {
  for (const vector of vectors.serialize) {
    const result = helpers.copyChipSerialize(vector.input, vector.opts || {});
    assert.deepEqual(result, vector.expected, vector.id);
  }
});

test("vector fence_info matches parseFenceInfo", () => {
  for (const vector of vectors.fence_info) {
    assert.deepEqual(
      helpers.copyChipParseFenceInfo(vector.info),
      vector.expected,
      vector.id,
    );
  }
});

test("grammar results are frozen", () => {
  const parsed = helpers.copyChipParseContent("copy: ssh");
  assert.ok(Object.isFrozen(parsed));
  const chips = helpers.copyChipScanLine("`copy: ssh`");
  assert.ok(Object.isFrozen(chips));
  assert.ok(Object.isFrozen(chips[0]));
  const serialized = helpers.copyChipSerialize({ label: null, text: "ssh" });
  assert.ok(Object.isFrozen(serialized));
  const info = helpers.copyChipParseFenceInfo("bob-copy Weekly");
  assert.ok(Object.isFrozen(info));
});

test("normalizeSpan follows CommonMark padding and table unescape", () => {
  assert.equal(helpers.copyChipNormalizeSpan("`copy: x`"), "copy: x");
  assert.equal(helpers.copyChipNormalizeSpan("`` copy: x` ``"), "copy: x`");
  assert.equal(helpers.copyChipNormalizeSpan("`copy: a\\|b`", { table: true }), "copy: a|b");
  assert.equal(helpers.copyChipNormalizeSpan("plain"), null);
});

test("fence payload joins with LF and keeps a trailing empty line", () => {
  assert.equal(helpers.copyChipFencePayload(["hello"]), "hello");
  assert.equal(helpers.copyChipFencePayload(["hello", ""]), "hello\n");
  assert.equal(helpers.copyChipFencePayload(["hello", "", "world"]), "hello\n\nworld");
  assert.equal(helpers.copyChipFencePayload([]), "");
});

test("the frozen api never throws and exposes grammar helpers", async () => {
  const plugin = new BobCopyChipsPlugin({});
  await plugin.onload();
  const api = plugin.api.copyChips;
  assert.equal(api.version, 1);
  assert.deepEqual(api.parse("copy: ssh"), { label: null, text: "ssh" });
  assert.equal(api.parse("Copy: ssh"), null);
  assert.equal(api.scanLine("`copy: ssh`").length, 1);
  assert.equal(api.serialize({ text: "ssh" }).markdown, "`copy: ssh`");
  assert.deepEqual(api.parseFenceInfo("bob-copy Zoom"), { label: "Zoom" });
  assert.equal(api.fencePayload(["a", "b"]), "a\nb");
  assert.equal(api.parse(undefined), null);
  assert.deepEqual(api.scanLine(null), []);
  assert.equal(api.serialize({ text: "  " }).ok, false);
});
