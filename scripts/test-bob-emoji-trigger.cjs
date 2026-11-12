const test = require("node:test");
const assert = require("node:assert/strict");
const { helpers, makeEditor, syntaxNode } = require("./bob-emoji-test-helpers.cjs");

const suggest = new helpers.BobEmojiSuggest({}, {});

test("trigger opens at line start and after whitespace, including a bare colon", () => {
  const lineStart = ":fi";
  assert.deepEqual(
    suggest.onTrigger({ line: 0, ch: lineStart.length }, makeEditor(lineStart)),
    { start: { line: 0, ch: 0 }, end: { line: 0, ch: 3 }, query: "fi" },
  );
  const afterSpace = "Hello :";
  assert.deepEqual(
    suggest.onTrigger({ line: 0, ch: afterSpace.length }, makeEditor(afterSpace)),
    { start: { line: 0, ch: 6 }, end: { line: 0, ch: 7 }, query: "" },
  );
});

test("trigger excludes mid-word, clock, dataview, doubled, and punctuated colons", () => {
  for (const line of ["a:b", "3:30", "word:", "[cat:: x", "::", "key::", "https://host"]) {
    assert.equal(suggest.onTrigger({ line: 0, ch: line.length }, makeEditor(line)), null, line);
  }
  const punctuated = " :fire.";
  assert.equal(suggest.onTrigger({ line: 0, ch: punctuated.length }, makeEditor(punctuated)), null);
  const plusAlias = " :+1";
  assert.equal(
    suggest.onTrigger({ line: 0, ch: plusAlias.length }, makeEditor(plusAlias)).query,
    "+1",
  );
});

test("closing colon remains literal and does not autocommit", () => {
  const line = ":fire:";
  assert.equal(suggest.onTrigger({ line: 0, ch: line.length }, makeEditor(line)), null);
});

test("syntax tree guards code, math, comments, and frontmatter", () => {
  for (const name of ["FencedCode", "InlineCode", "Math", "HTMLComment", "Frontmatter"]) {
    global.__bobEmojiSyntaxTree = { resolveInner() { return syntaxNode(name); } };
    const line = " :fire";
    assert.equal(
      suggest.onTrigger({ line: 0, ch: line.length }, makeEditor(line)),
      null,
      name,
    );
  }
  delete global.__bobEmojiSyntaxTree;
});

test("missing or failing syntax APIs allow the trigger", () => {
  const line = " :fire";
  assert.ok(suggest.onTrigger(
    { line: 0, ch: line.length },
    makeEditor(line, { noCodeMirror: true }),
  ));
  global.__bobEmojiSyntaxTreeError = true;
  assert.ok(suggest.onTrigger({ line: 0, ch: line.length }, makeEditor(line)));
  delete global.__bobEmojiSyntaxTreeError;
});
