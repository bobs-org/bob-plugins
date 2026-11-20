const assert = require("node:assert/strict");
const test = require("node:test");
const { helpers } = require("./copy-chips-test-helpers.cjs");

const ITERATIONS = 5000;
const ALPHABET = [
  "`", "``", "```", "~~~", "\\", "[", "]", "|", " ", "  ", "\t", "\n",
  "bob ", "gcal sync", " && ", "-n 2", "\"", "'", ":", "$", "%%", "<!--", "-->",
  "a", "x", "é", "中", "🙂", "0",
];

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let next = state;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rand, values) {
  return values[Math.floor(rand() * values.length)];
}

function randomString(rand, alphabet, min, max) {
  const length = min + Math.floor(rand() * (max - min + 1));
  let text = "";
  for (let index = 0; index < length; index += 1) text += pick(rand, alphabet);
  return text;
}

function randomLabel(rand) {
  const roll = rand();
  if (roll < 0.35) return null;
  if (roll < 0.4) return "\nlabel";
  const alphabet = ALPHABET.filter((atom) => !atom.includes("\n"));
  return randomString(rand, alphabet, 0, 8);
}

function randomText(rand, multiline) {
  const alphabet = multiline ? ALPHABET : ALPHABET.filter((atom) => !atom.includes("\n"));
  let text = randomString(rand, alphabet, 0, 14);
  if (multiline && !text.includes("\n")) text += "\n" + randomString(rand, alphabet, 0, 6);
  if (rand() < 0.2) text += "`";
  if (rand() < 0.15) text = "  " + text;
  if (rand() < 0.15) text += "  ";
  return text;
}

function normalizedLabel(label) {
  if (label == null) return null;
  const trimmed = String(label).trim();
  return trimmed === "" ? null : trimmed;
}

test("run serialize round-trips through scanLine and the fence cursor rule", () => {
  const seed = Number(process.env.COMMAND_CHIPS_ROUNDTRIP_SEED || 20261120);
  const rand = mulberry32(seed);
  let inline = 0;
  let block = 0;
  try {
    for (let step = 0; step < ITERATIONS; step += 1) {
      const label = randomLabel(rand);
      const multiline = rand() < 0.45;
      const text = randomText(rand, multiline);
      const table = !multiline && rand() < 0.35;
      const indent = multiline && rand() < 0.3 ? "  " : "";
      const result = helpers.runChipSerialize({ label, text }, { table, indent });
      if (label != null && String(label).includes("\n")) {
        assert.equal(result.ok, false, "newline label must refuse");
        assert.equal(result.reason, "labels are one line");
        continue;
      }
      if (!/\S/.test(text)) {
        assert.equal(result.ok, false, "whitespace text must refuse");
        assert.equal(result.reason, helpers.RUN_CHIP_NOTHING_TO_RUN);
        continue;
      }
      assert.equal(result.ok, true);
      if (text.includes("\n") || text.includes("\r")) {
        block += 1;
        assert.equal(result.form, "block");
        const lines = result.markdown.split("\n");
        const opening = helpers.copyChipFenceOpeningFromLine(lines[0]);
        assert.ok(opening, "serialized fence must open");
        assert.deepEqual(
          { ...helpers.runChipParseFenceInfo(opening.info) },
          { label: normalizedLabel(label) },
        );
        const hit = helpers.commandChipAt({ lines, line: 1, ch: 0 });
        assert.equal(hit.state, "ready");
        assert.equal(hit.via, "fence");
        assert.equal(hit.chip.form, "block");
        assert.equal(hit.chip.label, normalizedLabel(label));
        assert.equal(hit.chip.text, text.replace(/\r\n|\r/g, "\n"));
        assert.deepEqual({ ...hit.chip.fence }, { open: 0, close: lines.length - 1 });
        continue;
      }
      inline += 1;
      assert.equal(result.form, "inline");
      const chips = helpers.runChipScanLine(result.markdown, { table });
      assert.equal(chips.length, 1, "inline serialize must scan as one command chip");
      assert.equal(chips[0].label, normalizedLabel(label));
      assert.equal(chips[0].text, text);
      assert.deepEqual(helpers.copyChipScanLine(result.markdown, { table }), []);
    }
    assert.ok(inline > 1000 && block > 1000, "both forms must be exercised");
  } catch (error) {
    error.message = `command-chips roundtrip failed with seed ${seed}: ${error.message}`;
    throw error;
  }
});

test("a multiline run payload is refused in a table cell", () => {
  for (let lines = 2; lines <= 4; lines += 1) {
    const text = Array.from({ length: lines }, (_, index) => "bob step " + index).join("\n");
    assert.deepEqual(
      { ...helpers.runChipSerialize({ label: null, text }, { table: true }) },
      { ok: false, reason: helpers.RUN_CHIP_TABLE_BLOCK },
    );
  }
});
