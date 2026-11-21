// Pure Bank row note normalizer, writer plan, and stage preview.
const assert = require("node:assert/strict");
const test = require("node:test");
const { LedgerToolsPlugin } = require("./ledger-tools-harness.cjs");

const h = LedgerToolsPlugin.helpers;
const path = "bank/2026-11.md";
const prefix = [
  "---", 'parent: "[[bank]]"', 'type: "[[bank_month]]"', "month: 2026-11", "---",
  "", "# 🏦 November 2026", "", "## Thu Nov 12", "",
];

function sourceFor(line, newline = "\n") { return [...prefix, line].join(newline); }
function captureFor(line, source = sourceFor(line)) {
  return h.bankCategoryCapture({ path, line: prefix.length + 1, lineText: line });
}
function plan(line, note, source = sourceFor(line), currentPath = path) {
  return h.bankNoteWritePlan({ capture: captureFor(line), currentPath, currentSource: source, text: note });
}
function token(line) { return h.bankTokenizeLine(line); }

test("normalizer applies each visible safety rewrite", () => {
  const cases = [
    ["  two\n\t lines  ", "two lines", "one line per row"],
    ["— leading", "leading", "the caption adds the dash"],
    ["-- leading", "leading", "the caption adds the dash"],
    ["a !! b", "a ‼ b", "!! would flag the row"],
    ["a ⚑ b", "a ⚐ b", "⚑ would flag the row"],
    ["[[target|alias]]", "alias", "links in notes would be learned into future imports"],
    ["[[target]]", "target", "links in notes would be learned into future imports"],
    ["[cat:: dining]", "(cat: dining)", "fields belong to the row"],
    ["#tag", "tag", "tags in notes are not supported yet"],
    ["#123", "#123", null],
    ["%% hidden", "% hidden", "%% opens a comment that hides text"],
    ["<!-- hidden -->", "< !-- hidden -->", "an HTML comment would hide text"],
    ["ref ^abc", "ref ^ abc", "it would become the row's block ID"],
  ];
  for (const [input, expected, why] of cases) {
    const result = h.bankNoteNormalize(input);
    assert.equal(result.ok, true, input);
    assert.equal(result.text, expected, input);
    if (why) assert.ok(result.changes.some((change) => change.why === why), input);
  }
  const task = h.bankNoteNormalize("email #task today");
  assert.equal(task.ok, false);
  assert.match(task.refusal, /#task/);
});

const shapes = [
  { name: "bank ID", line: "- [ ] $5.00 Cafe ^bank-ab12" },
  { name: "ID-less", line: "- [ ] $5.00 Cafe" },
  { name: "custom block ID", line: "- [ ] $5.00 Cafe ^receipt" },
  { name: "flag glyph", line: "- [ ] $5.00 Cafe ⚑ ^bank-ab12" },
  { name: "legacy flag", line: "- [ ] $5.00 Cafe !! ^bank-ab12" },
  { name: "link before flag", line: "- [ ] $5.00 Cafe [[people/kelly|Kelly]] ⚑ ^bank-ab12" },
  { name: "ASCII marker", line: "- [ ] $5.00 Cafe -- old note ^bank-ab12" },
];

test("insert, replace, and remove preserve row identity across supported shapes", () => {
  for (const shape of shapes) {
    const original = shape.line;
    const inserted = plan(original, "team lunch");
    assert.equal(inserted.ok, true, shape.name);
    assert.equal(inserted.action, shape.name === "ASCII marker" ? "replace" : "insert", shape.name);
    assert.equal(token(inserted.lineText).note, "team lunch", shape.name);
    assert.deepEqual(inserted.edits.length, 1, shape.name);
    const replaced = plan(inserted.lineText, "client lunch");
    assert.equal(replaced.ok, true, shape.name);
    assert.equal(replaced.action, "replace", shape.name);
    assert.equal(token(replaced.lineText).note, "client lunch", shape.name);
    if (shape.name === "ASCII marker") assert.ok(replaced.lineText.includes(" -- client lunch"));
    const removed = plan(replaced.lineText, "");
    assert.equal(removed.ok, true, shape.name);
    assert.equal(removed.action, "remove", shape.name);
    assert.equal(token(removed.lineText).note, null, shape.name);
    if (shape.name.includes("flag")) assert.equal(token(removed.lineText).flagged, true, shape.name);
    if (shape.name === "link before flag") assert.ok(token(removed.lineText).links.length === 1);
  }
});

test("CRLF source keeps row edits local and the normalizer outputs round-trip", () => {
  const line = "- [ ] $12.00 Lunch [cat:: dining] ⚑ ^bank-a1b2";
  const source = sourceFor(line, "\r\n");
  const inserted = plan(line, "[cat:: food] !! %% <!-- ^tail", source);
  assert.equal(inserted.ok, true);
  assert.match(inserted.lineText, /\(cat: food\) ‼ % < !-- \^ tail/);
  assert.ok(source.includes("\r\n"));
  const updated = source.split("\r\n");
  updated[prefix.length] = inserted.lineText;
  assert.equal(updated.join("\r\n").includes("\r\n"), true);
});

test("every normalizer vector safely inserts into each row shape", () => {
  const raw = ["plain words", "!!", "⚑", "[[x|label]]", "[kind:: value]", "#tag", "%%", "<!--", "tail ^id"];
  for (const text of raw) {
    const normalized = h.bankNoteNormalize(text);
    assert.equal(normalized.ok, true, text);
    for (const shape of shapes) {
      const result = plan(shape.line, text);
      assert.equal(result.ok, true, `${text} / ${shape.name}: ${result.message || ""}`);
      assert.equal(token(result.lineText).note, normalized.text, `${text} / ${shape.name}`);
      assert.deepEqual(token(result.lineText).status, token(shape.line).status);
      assert.deepEqual(token(result.lineText).cents, token(shape.line).cents);
      assert.deepEqual(token(result.lineText).payee, token(shape.line).payee);
      assert.deepEqual(token(result.lineText).flagged, token(shape.line).flagged);
      assert.deepEqual(token(result.lineText).bankId, token(shape.line).bankId);
      assert.deepEqual(token(result.lineText).customId, token(shape.line).customId);
    }
  }
});

test("refuses structured notes, #task, moved rows, and edited ID-less rows", () => {
  const structured = "- [ ] $5.00 Cafe — with [[people/kelly|Kelly]] at lunch";
  assert.match(plan(structured, "new text").message, /links or fields/);
  assert.match(plan("- [ ] $5.00 Cafe", "#task").message, /#task/);
  const line = "- [ ] $5.00 Cafe";
  const capture = captureFor(line);
  assert.equal(h.bankNoteWritePlan({ capture, currentPath: "bank/other.md", currentSource: sourceFor(line), text: "note" }).ok, false);
  const edited = sourceFor("- [ ] $5.00 Different Cafe");
  const stale = h.bankNoteWritePlan({ capture, currentPath: path, currentSource: edited, text: "note" });
  assert.equal(stale.ok, false);
});

test("preview copy matches insert, replace, remove, no-op, and refusal", () => {
  assert.deepEqual(h.bankNoteStagePreview({ draft: "new", existingNote: null }), {
    action: "insert", text: "new", changes: [], refusal: null,
    consequence: "Adds a note · stays on this row", keys: "↵ save · esc back",
  });
  assert.equal(h.bankNoteStagePreview({ draft: "new", existingNote: "old" }).consequence,
    "Updates the note · stays on this row");
  assert.equal(h.bankNoteStagePreview({ draft: "", existingNote: "old" }).keys,
    "↵ remove note · esc back");
  assert.equal(h.bankNoteStagePreview({ draft: "", existingNote: null }).consequence, "No change");
  assert.match(h.bankNoteStagePreview({ draft: "note", existingNote: "old", editable: false }).refusal,
    /links or fields/);
});
