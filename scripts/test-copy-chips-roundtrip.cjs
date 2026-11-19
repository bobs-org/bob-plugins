const assert = require("node:assert/strict");
const test = require("node:test");
const { helpers } = require("./copy-chips-test-helpers.cjs");

const ITERATIONS = 5000;
const ALPHABET = [
  "`", "\\", "[", "]", "|", " ", "\t", "\n",
  "a", "b", "c", "x", "z", ":", "/", ".",
  "é", "中", "🙂", "0", "1",
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
  const alphabet = ALPHABET.filter((character) => character !== "\n");
  return randomString(rand, alphabet, 0, 12);
}

function randomText(rand, multiline) {
  const alphabet = multiline ? ALPHABET : ALPHABET.filter((character) => character !== "\n");
  let text = randomString(rand, alphabet, 0, 24);
  if (multiline && !text.includes("\n")) text += "\n" + randomString(rand, alphabet, 0, 8);
  if (rand() < 0.2) text += "`";
  if (rand() < 0.15) text = "  " + text;
  if (rand() < 0.15) text += "  ";
  return text;
}

function parseSerializedFence(markdown) {
  const lines = markdown.split("\n");
  const open = lines[0];
  const close = lines[lines.length - 1];
  const body = lines.slice(1, -1);
  const fenceMatch = /^(?:`{3,}|~{3,})/.exec(open);
  if (!fenceMatch) return null;
  const fence = fenceMatch[0];
  if (close !== fence) return null;
  return {
    info: open.slice(fence.length),
    payload: helpers.copyChipFencePayload(body),
  };
}

test("serialize round-trips through scanLine and fence payload", () => {
  const seed = Number(process.env.COPY_CHIPS_ROUNDTRIP_SEED || 20261119);
  const rand = mulberry32(seed);
  try {
    for (let step = 0; step < ITERATIONS; step += 1) {
      const label = randomLabel(rand);
      const multiline = rand() < 0.45;
      const text = randomText(rand, multiline);
      const table = !multiline && rand() < 0.35;
      const result = helpers.copyChipSerialize({ label, text }, { table });
      const normalizedLabel = label == null ? null : String(label).trim() === "" ? null : String(label).trim();
      if (label != null && String(label).includes("\n")) {
        assert.equal(result.ok, false, "newline label must refuse");
        assert.equal(result.reason, helpers.COPY_CHIP_LABELS_ARE_ONE_LINE);
        continue;
      }
      if (!/\S/.test(text)) {
        assert.equal(result.ok, false, "whitespace text must refuse");
        assert.equal(result.reason, helpers.COPY_CHIP_NOTHING_TO_COPY);
        continue;
      }
      assert.equal(result.ok, true);
      if (text.includes("\n") || text.includes("\r")) {
        assert.equal(result.form, "block");
        const parsed = parseSerializedFence(result.markdown);
        assert.ok(parsed, "serialized fence must parse");
        const infoLabel = helpers.copyChipParseFenceInfo(parsed.info);
        const expectedInfo = helpers.copyChipParseFenceInfo(
          normalizedLabel == null ? "bob-copy" : "bob-copy " + normalizedLabel,
        );
        assert.deepEqual(infoLabel, expectedInfo);
        assert.equal(parsed.payload, text.replace(/\r\n|\r/g, "\n"));
        continue;
      }
      assert.equal(result.form, "inline");
      const chips = helpers.copyChipScanLine(result.markdown, { table });
      assert.equal(chips.length, 1, "inline serialize must scan as one chip");
      assert.equal(chips[0].label, normalizedLabel);
      assert.equal(chips[0].text, text);
    }
  } catch (error) {
    error.message = `copy-chips roundtrip failed with seed ${seed}: ${error.message}`;
    throw error;
  }
});
