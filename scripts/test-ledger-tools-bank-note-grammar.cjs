// Shared bank-row note cleaner, disjoint note spans, and whole-row `$`
// protection. The vector table is byte-identical with bob-cli's
// tests/fixtures/bank_notes/note_cleaner.json.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { LedgerToolsPlugin } = require("./ledger-tools-harness.cjs");

const h = LedgerToolsPlugin.helpers;
const fixturePath = path.join(
  __dirname,
  "../plugins/bob-ledger-tools/scripts/fixtures/bank/note-cleaner.json",
);
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

function tokenOf(line) {
  const token = h.bankTokenizeLine(line);
  assert.ok(token, `expected a bank row token for ${line}`);
  return token;
}

function addRange(ranges, span, name) {
  if (!span || !Number.isInteger(span.start) || !Number.isInteger(span.end) || span.end <= span.start) {
    return;
  }
  ranges.push({ name, start: span.start, end: span.end, text: span.text });
}

function disjointRanges(token) {
  const ranges = [];
  addRange(ranges, token.amount, "amount");
  addRange(ranges, token.payeeSpan, "payee");
  addRange(ranges, token.category && token.category.span, "cat");
  addRange(ranges, token.account && token.account.span, "acct");
  addRange(ranges, token.flagSpan, "flag");
  addRange(ranges, token.noteMarkerSpan, "marker");
  addRange(ranges, token.noteSpan, "note");
  addRange(ranges, token.bankIdSpan, "id");
  addRange(ranges, token.customIdSpan, "custom");
  for (const link of token.links || []) {
    addRange(ranges, link, "link");
  }
  for (const field of token.extraFields || []) {
    addRange(ranges, field.span, "field");
  }
  ranges.sort((left, right) => left.start - right.start || left.end - right.end);
  for (let index = 1; index < ranges.length; index += 1) {
    assert.ok(
      ranges[index - 1].end <= ranges[index].start,
      `${ranges[index - 1].name} overlaps ${ranges[index].name} on ${token.payee}`,
    );
  }
  return ranges;
}

function onlyWhitespaceBetween(line, from, to) {
  return /^\s*$/.test(line.slice(from, to));
}

test("shared note-cleaner vectors stay in lockstep with bob-cli", () => {
  assert.equal(Array.isArray(fixture.cases), true);
  for (const expected of fixture.cases) {
    const token = tokenOf(expected.line);
    assert.equal(token.payee, expected.payee, expected.line);
    assert.equal(token.flagged, expected.flagged, expected.line);
    assert.equal(token.note, expected.note, expected.line);
  }
});

test("note spans cover the first prose run and stay disjoint from other tokens", () => {
  const marked = tokenOf("- [ ] $23.21 Amazon Reta* 125dt [cat:: kids] — LEGO set for Max's birthday ^bank-8f3a2c1d");
  assert.equal(marked.note, "LEGO set for Max's birthday");
  assert.equal(marked.noteSpan.text, "LEGO set for Max's birthday");
  assert.equal(marked.noteMarkerSpan.text, "—");
  assert.equal(marked.noteEditable, true);
  assert.equal(marked.bankId, "8f3a2c1d");
  assert.ok(onlyWhitespaceBetween(
    "- [ ] $23.21 Amazon Reta* 125dt [cat:: kids] — LEGO set for Max's birthday ^bank-8f3a2c1d",
    marked.noteMarkerSpan.end,
    marked.noteSpan.start,
  ));
  disjointRanges(marked);

  const ascii = tokenOf("- [ ] $5.00 Corner Cafe -- ascii marker note");
  assert.equal(ascii.note, "ascii marker note");
  assert.equal(ascii.noteMarkerSpan.text, "--");
  assert.equal(ascii.noteSpan.text, "ascii marker note");
  assert.equal(ascii.noteEditable, true);
  assert.equal(ascii.bankId, null);
  disjointRanges(ascii);

  const flagged = tokenOf("- [x] $13.71 Smashburger !! -- with Kelly");
  assert.equal(flagged.note, "with Kelly");
  assert.equal(flagged.flagSpan.text, "!!");
  assert.equal(flagged.noteMarkerSpan.text, "--");
  assert.equal(flagged.noteSpan.text, "with Kelly");
  assert.equal(flagged.noteEditable, true);
  disjointRanges(flagged);

  const flagOpened = tokenOf("- [ ] $5.00 Thing !! look");
  assert.equal(flagOpened.note, "look");
  assert.equal(flagOpened.noteMarkerSpan, null);
  assert.equal(flagOpened.noteSpan.text, "look");
  assert.equal(flagOpened.noteEditable, true);
  disjointRanges(flagOpened);

  const idless = tokenOf("- [ ] $5.00 Corner Cafe — wow! great");
  assert.equal(idless.noteSpan.text, "wow! great");
  assert.equal(idless.noteMarkerSpan.text, "—");
  assert.equal(idless.bankIdSpan, null);
  disjointRanges(idless);

  const linksBefore = tokenOf("- [ ] $5.00 Corner Cafe [[eat/cafe|☕]] ⚑ — ask Kelly ^bank-ab12");
  assert.equal(linksBefore.note, "ask Kelly");
  assert.equal(linksBefore.noteSpan.text, "ask Kelly");
  assert.equal(linksBefore.links[0].text, "[[eat/cafe|☕]]");
  assert.ok(linksBefore.links[0].end <= linksBefore.flagSpan.start);
  assert.ok(linksBefore.flagSpan.end <= linksBefore.noteMarkerSpan.start);
  disjointRanges(linksBefore);

  const linksAfter = tokenOf("- [ ] $5.00 Corner Cafe — with [[people/kelly|Kelly]] at lunch");
  assert.equal(linksAfter.note, "with at lunch");
  assert.equal(linksAfter.noteSpan.text, "with");
  assert.equal(linksAfter.noteEditable, false);
  assert.equal(linksAfter.links[0].text, "[[people/kelly|Kelly]]");
  assert.ok(linksAfter.noteSpan.end <= linksAfter.links[0].start);
  disjointRanges(linksAfter);

  const multiRun = tokenOf("- [ ] $5.00 Corner Cafe — note [x:: y] tail");
  assert.equal(multiRun.note, "note tail");
  assert.equal(multiRun.noteSpan.text, "note");
  assert.equal(multiRun.noteEditable, false);
  disjointRanges(multiRun);
});

test("token dollars cover every $ on the row, including notes", () => {
  const token = tokenOf("- [ ] $12.00 Lunch — split $25 w/ Alex, $10 tip");
  assert.equal(token.note, "split $25 w/ Alex, $10 tip");
  assert.deepEqual(
    token.dollars.map((offset) => token.amount.text && offset),
    token.dollars,
  );
  const line = "- [ ] $12.00 Lunch — split $25 w/ Alex, $10 tip";
  const expected = [];
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === "$") expected.push(index);
  }
  assert.deepEqual(token.dollars, expected);
  assert.equal(token.dollars.length, 3);
});
