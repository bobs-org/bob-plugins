const test = require("node:test");
const assert = require("node:assert/strict");
const { helpers } = require("./navigation-hotkeys-harness.cjs");

test("section heading labels unwrap Markdown landmarks and preserve tags", () => {
  assert.equal(
    helpers.cleanSectionHeadingLabel(
      "**Bold** _em_ foo_bar_baz `code` [[path/to/File.md]] [[target|Alias]] [web](https://example.test) ![chart](chart.png) ![[embed.png]] %%comment%% ^block-id ###",
    ),
    "Bold em foo_bar_baz code path/to/File Alias web chart",
  );
  assert.equal(
    helpers.cleanSectionHeadingLabel("<i>HTML</i> #tag 😀 ~~old~~ ==marked=="),
    "HTML #tag 😀 old marked",
  );
  assert.equal(helpers.cleanSectionHeadingLabel("  %%only a comment%%  "), "(untitled)");
  assert.equal(helpers.cleanSectionHeadingLabel(""), "(untitled)");
});

test("the shared heading walker keeps navigation scope and adds level, label, and outline depth", () => {
  const lines = [
    "---",
    "# Frontmatter heading",
    "---",
    "# Root",
    "### Skipped level",
    "#### Child",
    "## Sibling child",
    "# Next root",
    "~~~md",
    "## Fenced heading",
    "~~~",
    "## [[Page.md|Linked title]] ###",
  ];
  const headings = helpers.getSectionHeadingEntries(lines);

  assert.deepEqual(
    headings.map(({ line, level, depth, label }) => ({ line, level, depth, label })),
    [
      { line: 3, level: 1, depth: 0, label: "Root" },
      { line: 4, level: 3, depth: 1, label: "Skipped level" },
      { line: 5, level: 4, depth: 2, label: "Child" },
      { line: 6, level: 2, depth: 1, label: "Sibling child" },
      { line: 7, level: 1, depth: 0, label: "Next root" },
      { line: 11, level: 2, depth: 1, label: "Linked title" },
    ],
  );
  assert.deepEqual(
    helpers.getSectionHeaderLines(lines),
    headings.map((heading) => heading.line),
  );
});

test("Section Map model reports current/from rows, real jump chips, counter, and aria sentence", () => {
  const lines = ["# Alpha", "body", "## Beta", "details", "# Gamma"];
  const model = helpers.buildSectionMapModel(lines, {
    cursorLine: 3,
    fromLine: 1,
    direction: 1,
    wrapped: false,
  });

  assert.equal(model.counter, "2 / 3");
  assert.equal(model.currentLine, 2);
  assert.equal(model.fromLine, 0);
  assert.equal(model.ariaSentence, "Section 2 of 3, Beta; next Gamma; previous Beta");
  assert.deepEqual(
    model.chips.map(({ direction, shortcut, targetLine, wrapped }) => ({
      direction,
      shortcut,
      targetLine,
      wrapped,
    })),
    [
      { direction: -1, shortcut: "⌃K", targetLine: 2, wrapped: false },
      { direction: 1, shortcut: "⌃J", targetLine: 4, wrapped: false },
    ],
  );
  const alpha = model.rows.find((row) => row.line === 0);
  const beta = model.rows.find((row) => row.line === 2);
  assert.equal(alpha.from, true);
  assert.equal(beta.current, true);
  assert.equal(beta.chips.length, 1);
  assert.equal(beta.chips[0].shortcut, "⌃K");
});

test("Section Map windows follow direction, pin ancestors and chip targets, and count gaps exactly", () => {
  const lines = Array.from({ length: 40 }, (_unused, index) => `# Heading ${index}`);
  const down = helpers.buildSectionMapModel(lines, {
    cursorLine: 20,
    direction: 1,
  });
  const up = helpers.buildSectionMapModel(lines, {
    cursorLine: 20,
    direction: -1,
  });
  const peek = helpers.buildSectionMapModel(lines, {
    cursorLine: 20,
    direction: 0,
  });
  assert.deepEqual(down.window.visibleLines, [18, 19, 20, 21, 22, 23, 24, 25]);
  assert.deepEqual(up.window.visibleLines, [15, 16, 17, 18, 19, 20, 21, 22]);
  assert.deepEqual(peek.window.visibleLines, [17, 18, 19, 20, 21, 22, 23, 24]);

  const wrapped = helpers.buildSectionMapModel(lines, {
    cursorLine: 39,
    direction: 1,
  });
  assert.equal(wrapped.chips.find((chip) => chip.direction === 1).targetLine, 0);
  assert.equal(wrapped.chips.find((chip) => chip.direction === 1).wrapped, true);
  assert.ok(wrapped.rows.some((row) => row.line === 0 && row.chipTarget));
  assert.equal(
    wrapped.rows.filter((row) => row.type === "gap").reduce((sum, row) => sum + row.count, 0),
    31,
  );

  const deepLines = ["# Root", "## A", "### B", "#### C"];
  for (let index = 0; index < 18; index += 1) {
    deepLines.push(`#### Sibling ${index}`);
  }
  const deep = helpers.buildSectionMapModel(deepLines, {
    cursorLine: 15,
    direction: 1,
    maxRows: 5,
  });
  assert.ok(deep.rows.some((row) => row.line === 0));
  assert.ok(deep.rows.some((row) => row.line === 2));
  assert.ok(deep.rows.filter((row) => row.type === "heading").length >= 5);
});

test("Section Map handles empty and one-heading edge states", () => {
  const empty = helpers.buildSectionMapModel(["body"], { cursorLine: 0 });
  assert.equal(empty.visible, false);
  assert.deepEqual(empty.rows, []);
  assert.equal(empty.counter, "– / 0");
  assert.equal(empty.ariaSentence, "No sections");

  const single = helpers.buildSectionMapModel(["body", "# Only"], {
    cursorLine: 1,
    wrapped: true,
  });
  assert.equal(single.counter, "1 / 1");
  assert.equal(single.onlySection, true);
  assert.equal(single.wrapped, false);
  assert.deepEqual(single.chips, []);
  assert.equal(single.ariaSentence, "Section 1 of 1, Only; only section");
});

test("Section Map chips stay in parity with the heading jump picker over generated documents", () => {
  let seed = 0x5eed1234;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };

  for (let document = 0; document < 32; document += 1) {
    const lines = [];
    const lineCount = 8 + Math.floor(random() * 45);
    for (let line = 0; line < lineCount; line += 1) {
      const roll = random();
      if (roll < 0.28) {
        const level = 1 + Math.floor(random() * 6);
        lines.push(`${"#".repeat(level)} Heading ${document}-${line}`);
      } else if (roll < 0.34) {
        lines.push(`   ${"#".repeat(1 + Math.floor(random() * 6))} Indented ${line}`);
      } else if (roll < 0.40) {
        lines.push(`####### Not a heading ${line}`);
      } else {
        lines.push(`Body ${document}-${line}`);
      }
    }

    const headings = helpers.getSectionHeadingEntries(lines);
    for (let cursorLine = -1; cursorLine <= lineCount; cursorLine += 1) {
      for (const direction of [-1, 1]) {
        const targetLine = helpers.getSectionHeaderJumpLine(lines, cursorLine, direction);
        assert.equal(
          helpers.getSectionHeaderJumpLineFromEntries(headings, cursorLine, direction),
          targetLine,
        );

        const model = helpers.buildSectionMapModel(lines, {
          headings,
          cursorLine,
          direction,
        });
        const chip = model.chips.find((candidate) => candidate.direction === direction);
        if (targetLine === null || targetLine === cursorLine) {
          assert.equal(chip, undefined);
          continue;
        }
        assert.equal(chip.targetLine, targetLine);
        assert.ok(model.rows.some((row) => row.line === targetLine && row.chipTarget));
        const shouldWrap = direction > 0
          ? !headings.some((heading) => heading.line > cursorLine)
          : !headings.some((heading) => heading.line < cursorLine);
        assert.equal(chip.wrapped, shouldWrap);
      }
    }
  }
});

test("every window budget paints the current section, including short upward landings", () => {
  const lines = Array.from({ length: 42 }, (_unused, index) => `# Heading ${index}`);
  const nested = ["# Root", "## A", "### B", "#### C"];
  for (let index = 0; index < 18; index += 1) nested.push(`#### Sibling ${index}`);

  for (const direction of [-1, 0, 1]) {
    for (let maxRows = 1; maxRows <= 12; maxRows += 1) {
      for (const cursorLine of [0, 1, 15, 20, 39, 41, 80, -1]) {
        const model = helpers.buildSectionMapModel(lines, { cursorLine, direction, maxRows });
        const headings = helpers.getSectionHeadingEntries(lines);
        const containing = headings.reduce(
          (found, heading, index) => (heading.line <= cursorLine ? index : found),
          -1,
        );
        if (containing >= 0 && model.visible) {
          const current = model.rows.find((row) => row.type === "heading" && row.current === true);
          assert.ok(current, `dir=${direction} maxRows=${maxRows} cursor=${cursorLine}`);
          assert.equal(current.line, headings[containing].line);
        }
      }
    }
  }

  const audit = helpers.buildSectionMapModel(lines, {
    cursorLine: 20,
    direction: -1,
    maxRows: 5,
  });
  assert.ok(audit.rows.some((row) => row.type === "heading" && row.current === true));
  assert.ok(audit.window.visibleLines.includes(20));
  assert.equal(audit.window.end - audit.window.start, 5);
  assert.ok(audit.window.start <= 20 && 20 < audit.window.end);

  const wrapDown = helpers.buildSectionMapModel(lines, { cursorLine: 41, direction: 1, maxRows: 3 });
  assert.ok(wrapDown.rows.some((row) => row.line === 0 && row.chipTarget));
  assert.ok(wrapDown.rows.some((row) => row.type === "heading" && row.current === true));

  const wrapUp = helpers.buildSectionMapModel(lines, { cursorLine: 0, direction: -1, maxRows: 3 });
  assert.ok(wrapUp.rows.some((row) => row.line === 41 && row.chipTarget));

  const deep = helpers.buildSectionMapModel(nested, { cursorLine: 20, direction: -1, maxRows: 4 });
  assert.ok(deep.rows.some((row) => row.type === "heading" && row.current === true));
  assert.ok(deep.rows.some((row) => row.line === 0));
});
