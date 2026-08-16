const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    class EmptyClass {}
    return {
      MarkdownView: EmptyClass,
      Notice: EmptyClass,
      Plugin: EmptyClass,
      normalizePath: (value) => value,
    };
  }
  if (request === "@codemirror/state") {
    return { Prec: { highest: (value) => value } };
  }
  if (request === "@codemirror/view") {
    return {
      EditorView: class EditorView {},
      keymap: { of: (value) => value },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers } = LedgerToolsPlugin;
Module._load = originalLoad;

const FIXED_DATE = new Date(2026, 7, 16, 12, 0, 0); // 2026-08-16

test("parseTrigger parses D[-]<N> dated-entry triggers with offset and span", () => {
  assert.deepEqual(helpers.parseTrigger("D0"), {
    kind: "datedEntry",
    trigger: "D0",
    startCh: 0,
    endCh: 2,
    offset: 0,
  });

  assert.deepEqual(helpers.parseTrigger("D1"), {
    kind: "datedEntry",
    trigger: "D1",
    startCh: 0,
    endCh: 2,
    offset: 1,
  });

  assert.deepEqual(helpers.parseTrigger("D14"), {
    kind: "datedEntry",
    trigger: "D14",
    startCh: 0,
    endCh: 3,
    offset: 14,
  });

  assert.deepEqual(helpers.parseTrigger("D-1"), {
    kind: "datedEntry",
    trigger: "D-1",
    startCh: 0,
    endCh: 3,
    offset: -1,
  });

  assert.deepEqual(helpers.parseTrigger("D-30"), {
    kind: "datedEntry",
    trigger: "D-30",
    startCh: 0,
    endCh: 4,
    offset: -30,
  });

  assert.deepEqual(helpers.parseTrigger("Prefix D5"), {
    kind: "datedEntry",
    trigger: "D5",
    startCh: 7,
    endCh: 9,
    offset: 5,
  });

  assert.deepEqual(helpers.parseTrigger("- D-3"), {
    kind: "datedEntry",
    trigger: "D-3",
    startCh: 2,
    endCh: 5,
    offset: -3,
  });
});

test("computeSnippetExpansion formats D[-]<N> with markdown emphasis, em dash, trailing space, and cursor offset", () => {
  const expansion0 = helpers.computeSnippetExpansion(
    { kind: "datedEntry", trigger: "D0", offset: 0 },
    FIXED_DATE,
  );
  assert.equal(expansion0.replacement, "_2026-08-16_ \u2014 ");
  assert.equal(expansion0.replacement, "_2026-08-16_ — ");
  assert.equal(expansion0.cursorOffset, 15);
  assert.equal(expansion0.cursorOffset, expansion0.replacement.length);
  assert.equal(expansion0.text, "_2026-08-16_ — ");

  const expansionTomorrow = helpers.computeSnippetExpansion(
    { kind: "datedEntry", trigger: "D1", offset: 1 },
    FIXED_DATE,
  );
  assert.equal(expansionTomorrow.replacement, "_2026-08-17_ — ");
  assert.equal(expansionTomorrow.cursorOffset, 15);

  const expansionYesterday = helpers.computeSnippetExpansion(
    { kind: "datedEntry", trigger: "D-1", offset: -1 },
    FIXED_DATE,
  );
  assert.equal(expansionYesterday.replacement, "_2026-08-15_ — ");
  assert.equal(expansionYesterday.cursorOffset, 15);

  // Month and year boundaries using local-calendar date arithmetic
  const yearEnd = new Date(2026, 11, 31, 12, 0, 0); // 2026-12-31
  const expansionNewYear = helpers.computeSnippetExpansion(
    { kind: "datedEntry", trigger: "D1", offset: 1 },
    yearEnd,
  );
  assert.equal(expansionNewYear.replacement, "_2027-01-01_ — ");

  const expansionYearPrior = helpers.computeSnippetExpansion(
    { kind: "datedEntry", trigger: "D-365", offset: -365 },
    yearEnd,
  );
  assert.equal(expansionYearPrior.replacement, "_2025-12-31_ — ");

  // Leap year boundary (2024 is a leap year)
  const leapFeb28 = new Date(2024, 1, 28, 12, 0, 0);
  assert.equal(
    helpers.computeSnippetExpansion(
      { kind: "datedEntry", trigger: "D1", offset: 1 },
      leapFeb28,
    ).replacement,
    "_2024-02-29_ — ",
  );
  assert.equal(
    helpers.computeSnippetExpansion(
      { kind: "datedEntry", trigger: "D2", offset: 2 },
      leapFeb28,
    ).replacement,
    "_2024-03-01_ — ",
  );
});

test("expandLineAtCursor expands D[-]<N> in place and places cursor at the terminal stop without $1 notation", () => {
  // Terminal trigger at end of line
  const res1 = helpers.expandLineAtCursor("D0", 2, FIXED_DATE);
  assert.notEqual(res1, null);
  assert.equal(res1.line, "_2026-08-16_ — ");
  assert.equal(res1.cursorCh, 15);
  assert.equal(res1.line.includes("$1"), false);
  assert.equal(JSON.stringify(res1).includes("$1"), false);

  // Trigger with prefix
  const res2 = helpers.expandLineAtCursor("- D1", 4, FIXED_DATE);
  assert.notEqual(res2, null);
  assert.equal(res2.line, "- _2026-08-17_ — ");
  assert.equal(res2.cursorCh, 17); // 2 (prefix) + 15 (replacement)

  // Trigger with non-word suffix
  const res3 = helpers.expandLineAtCursor("D0: summary notes", 2, FIXED_DATE);
  assert.notEqual(res3, null);
  assert.equal(res3.line, "_2026-08-16_ — : summary notes");
  assert.equal(res3.cursorCh, 15); // immediately before ": summary notes"

  // Trigger with prefix and suffix
  const res4 = helpers.expandLineAtCursor("- D-1 [link]", 5, FIXED_DATE);
  assert.notEqual(res4, null);
  assert.equal(res4.line, "- _2026-08-15_ —  [link]");
  assert.equal(res4.cursorCh, 17); // 2 + 15 = 17, immediately before " [link]"
});

test("findExpansion and parseTrigger reject bare, malformed, and identifier-embedded D triggers", () => {
  // Bare D and D- without numbers
  assert.equal(helpers.parseTrigger("D"), null);
  assert.equal(helpers.parseTrigger("D-"), null);
  assert.equal(helpers.findExpansion("D", 1, FIXED_DATE), null);
  assert.equal(helpers.findExpansion("D-", 2, FIXED_DATE), null);

  // Embedded in word / identifier
  assert.equal(helpers.parseTrigger("xD0"), null);
  assert.equal(helpers.parseTrigger("word_D0"), null);
  assert.equal(helpers.findExpansion("xD0", 3, FIXED_DATE), null);
  assert.equal(helpers.findExpansion("word_D0", 7, FIXED_DATE), null);

  // Followed immediately by word character
  assert.equal(helpers.findExpansion("D0x", 2, FIXED_DATE), null);
  assert.equal(helpers.findExpansion("D01abc", 3, FIXED_DATE), null);

  // Allowed contexts
  assert.notEqual(helpers.findExpansion("  D0", 4, FIXED_DATE), null);
  assert.notEqual(helpers.findExpansion("* D0", 4, FIXED_DATE), null);
  assert.notEqual(helpers.findExpansion("> D0", 4, FIXED_DATE), null);
  assert.notEqual(helpers.findExpansion("(D0)", 3, FIXED_DATE), null);
  assert.notEqual(helpers.findExpansion("D0.", 2, FIXED_DATE), null);
});

test("compatibility: existing snippets remain unchanged and uppercase T/DT remain unsupported", () => {
  // Lowercase d still expands to bare ISO date
  assert.deepEqual(helpers.parseTrigger("d0"), {
    kind: "date",
    trigger: "d0",
    startCh: 0,
    endCh: 2,
    offset: 0,
  });
  const dateExpansion = helpers.expandLineAtCursor("d0", 2, FIXED_DATE);
  assert.notEqual(dateExpansion, null);
  assert.equal(dateExpansion.line, "2026-08-16");
  assert.equal(dateExpansion.cursorCh, 10);

  const negDateExpansion = helpers.expandLineAtCursor("d-1", 3, FIXED_DATE);
  assert.notEqual(negDateExpansion, null);
  assert.equal(negDateExpansion.line, "2026-08-15");
  assert.equal(negDateExpansion.cursorCh, 10);

  // Time snippet t
  assert.equal(helpers.parseTrigger("t0").kind, "time");

  // Datetime snippet dt
  assert.equal(helpers.parseTrigger("dt0").kind, "datetime");

  // Task snippet ta
  assert.equal(helpers.parseTrigger("ta").kind, "task");

  // Ledger range se
  assert.equal(helpers.parseTrigger("se").kind, "ledgerRange");

  // Case-sensitive exclusions: T, DT, dT, Dt, TA, SE must NOT be supported
  assert.equal(helpers.parseTrigger("T0"), null);
  assert.equal(helpers.parseTrigger("T-1"), null);
  assert.equal(helpers.parseTrigger("DT0"), null);
  assert.equal(helpers.parseTrigger("dT0"), null);
  assert.equal(helpers.parseTrigger("Dt0"), null);
  assert.equal(helpers.parseTrigger("TA"), null);
  assert.equal(helpers.parseTrigger("SE"), null);
});

test("expandFromEditor replaces D0 trigger in editor and sets cursor to trailing position", () => {
  const plugin = new LedgerToolsPlugin();
  let replacedRange = null;
  let cursorPosition = null;

  const mockEditor = {
    getCursor: () => ({ line: 1, ch: 4 }), // cursor is right after "- D0"
    getLine: (line) => (line === 1 ? "- D0 suffix" : ""),
    listSelections: () => [{ anchor: { line: 1, ch: 4 }, head: { line: 1, ch: 4 } }],
    replaceRange: (replacement, from, to) => {
      replacedRange = { replacement, from, to };
    },
    setCursor: (pos) => {
      cursorPosition = pos;
    },
  };

  const success = plugin.expandFromEditor(mockEditor);
  assert.equal(success, true);
  assert.notEqual(replacedRange, null);
  assert.equal(replacedRange.from.line, 1);
  assert.equal(replacedRange.from.ch, 2); // "D0" starts at index 2
  assert.equal(replacedRange.to.line, 1);
  assert.equal(replacedRange.to.ch, 4); // "D0" ends at index 4
  assert.match(replacedRange.replacement, /^_\d{4}-\d{2}-\d{2}_ — $/);
  assert.notEqual(cursorPosition, null);
  assert.equal(cursorPosition.line, 1);
  assert.equal(cursorPosition.ch, 2 + replacedRange.replacement.length);
});
