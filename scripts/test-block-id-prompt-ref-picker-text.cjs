// Picker text for reference reading tasks (ref-glyph): a `#ref` tag
// directly after `#task` is dropped from display text like `#task`
// is, and the display gains the `📖` prefix, so the task picker
// reads `📖 Harness Engineering`. Contract: bob-cli
// `docs/task-tag-marks.md` "Reference reading tasks".
const test = require("node:test");
const assert = require("node:assert/strict");
const { helpers } = require("./block-id-prompt-harness.cjs");

const { collectTaskPickerItems } = helpers;

function displayTexts(content) {
  return collectTaskPickerItems(content).map((item) => item.displayText);
}

test("the task picker drops the paired #ref and prefixes the book", () => {
  assert.deepEqual(
    displayTexts("- [ ] #task #ref Harness Engineering"),
    ["📖 Harness Engineering"],
  );
  assert.deepEqual(displayTexts("- [ ] #task Plain work"), ["Plain work"]);
  assert.deepEqual(displayTexts("- [ ] #task #REF Loud"), ["📖 Loud"]);
  assert.deepEqual(displayTexts("- [ ] #task   #ref Extra spaces"), [
    "📖 Extra spaces",
  ]);
  assert.deepEqual(displayTexts("- [ ] #task #ref Titled ^tided-id"), [
    "📖 Titled",
  ]);
});

test("near-miss spellings never pair and never prefix", () => {
  assert.deepEqual(displayTexts("- [ ] #task #references Not a ref"), [
    "#references Not a ref",
  ]);
  assert.deepEqual(displayTexts("- [ ] #ref #task Reversed"), [
    "#ref Reversed",
  ]);
  // `#ref` alone is not a `#task` line, so the picker never lists it.
  assert.deepEqual(displayTexts("- [ ] #ref Alone"), []);
});
