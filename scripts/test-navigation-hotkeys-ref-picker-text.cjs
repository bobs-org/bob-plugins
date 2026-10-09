// Picker text for reference reading tasks (ref-glyph): a `#ref` tag
// directly after `#task` is dropped from display text like `#task`
// is, and the display gains the `📖` prefix, so pickers, the Task
// Card header, and inbox-route subtitles read `📖 Harness
// Engineering`. Contract: bob-cli `docs/task-tag-marks.md`
// "Reference reading tasks".
const test = require("node:test");
const assert = require("node:assert/strict");
const { helpers } = require("./navigation-hotkeys-harness.cjs");

const { cleanTaskDisplayText, getOpenLocalTasks } = helpers;

test("reading tasks read with the book prefix, plain tasks unchanged", () => {
  assert.equal(
    cleanTaskDisplayText("- [ ] #task #ref Harness Engineering"),
    "📖 Harness Engineering",
  );
  assert.equal(
    cleanTaskDisplayText("- [ ] #task Harness Engineering"),
    "Harness Engineering",
  );
  // Case-insensitive partner and extra whitespace still pair.
  assert.equal(
    cleanTaskDisplayText("- [ ] #task #REF Loud"),
    "📖 Loud",
  );
  assert.equal(
    cleanTaskDisplayText("- [ ] #task   #ref Extra spaces"),
    "📖 Extra spaces",
  );
  // Lane statuses pair the same way.
  assert.equal(
    cleanTaskDisplayText("- [*] #task #ref Next book"),
    "📖 Next book",
  );
  assert.equal(
    cleanTaskDisplayText("- [/] #task #ref In progress book"),
    "📖 In progress book",
  );
  // Metadata still strips before the prefix applies.
  assert.equal(
    cleanTaskDisplayText("- [ ] #task #ref Titled ^tided-id"),
    "📖 Titled",
  );
  assert.equal(
    cleanTaskDisplayText(
      "- [ ] #task #ref Dated [priority:: high] [created:: 2026-10-07]",
    ),
    "📖 Dated",
  );
});

test("near-miss spellings never pair and never prefix", () => {
  // `#references` is a longer tag, not the partner.
  assert.equal(
    cleanTaskDisplayText("- [ ] #task #references Not a ref"),
    "#references Not a ref",
  );
  // Reversed order keeps both visible tags minus `#task`.
  assert.equal(
    cleanTaskDisplayText("- [ ] #ref #task Reversed"),
    "#ref Reversed",
  );
  // `#ref` alone is not a reading task.
  assert.equal(cleanTaskDisplayText("- [ ] #ref Alone"), "#ref Alone");
  // No whitespace between the tokens is not a pair.
  assert.equal(
    cleanTaskDisplayText("- [ ] #task#ref Glued"),
    "#task#ref Glued",
  );
  // A bare pair with no title stays the untitled placeholder.
  assert.equal(cleanTaskDisplayText("- [ ] #task #ref"), "(untitled task)");
  assert.equal(cleanTaskDisplayText("- [ ] #task"), "(untitled task)");
});

test("picker rows carry the book prefix in displayText", () => {
  const content = [
    "- [ ] #task #ref Harness Engineering",
    "- [ ] #task Plain work",
  ].join("\n");
  const rows = getOpenLocalTasks(content);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].displayText, "📖 Harness Engineering");
  assert.equal(rows[1].displayText, "Plain work");
});
