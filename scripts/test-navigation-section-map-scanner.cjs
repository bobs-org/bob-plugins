const test = require("node:test");
const assert = require("node:assert/strict");
const { helpers } = require("./navigation-hotkeys-harness.cjs");

// Independent pre-epic scanner from 44425a49^ `getSectionHeaderLines`. Inlined
// so the oracle does not read git at runtime. Same walk, line numbers only.
const FRONTMATTER_DELIMITER_RE = /^\s*(?:---|\.\.\.)\s*$/;
const OPENING_FENCE_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const CLOSING_FENCE_RE = /^( {0,3})(`{3,}|~{3,})\s*$/;
const SECTION_HEADER_RE = /^ {0,3}#{1,6}(?:[ \t]|$)/;

function startsWithFrontmatter(lines) {
  return lines.length > 0 && /^\s*---\s*$/.test(lines[0]);
}

function getFenceOpening(line) {
  const match = String(line).match(OPENING_FENCE_RE);
  if (!match) return null;
  return { markerChar: match[2][0], markerLength: match[2].length };
}

function isClosingFence(line, openingFence) {
  const match = String(line).match(CLOSING_FENCE_RE);
  if (!match) return false;
  return match[2][0] === openingFence.markerChar && match[2].length >= openingFence.markerLength;
}

function getSectionHeaderLinesOracle(lines) {
  const sourceLines = Array.isArray(lines) ? lines : String(lines || "").split(/\r?\n/);
  const headerLines = [];
  let lineIndex = 0;
  let inFrontmatter = false;
  let inFence = null;

  if (startsWithFrontmatter(sourceLines)) {
    inFrontmatter = true;
    lineIndex = 1;
  }

  for (; lineIndex < sourceLines.length; lineIndex += 1) {
    const line = String(sourceLines[lineIndex] || "");
    if (inFrontmatter) {
      if (FRONTMATTER_DELIMITER_RE.test(line)) inFrontmatter = false;
      continue;
    }
    if (inFence) {
      if (isClosingFence(line, inFence)) inFence = null;
      continue;
    }
    const openingFence = getFenceOpening(line);
    if (openingFence) {
      inFence = openingFence;
      continue;
    }
    if (SECTION_HEADER_RE.test(line)) headerLines.push(lineIndex);
  }
  return headerLines;
}

function assertScannerParity(lines, label) {
  const oracle = getSectionHeaderLinesOracle(lines);
  const entries = helpers.getSectionHeadingEntries(lines);
  assert.deepEqual(
    entries.map((heading) => heading.line),
    oracle,
    label,
  );
  assert.deepEqual(helpers.getSectionHeaderLines(lines), oracle, `${label} lines helper`);
}

test("the live scanner matches the pre-epic heading-line oracle on generated fence and frontmatter notes", () => {
  let seed = 0x51ca11e;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const pick = (items) => items[Math.floor(random() * items.length)];

  const fixtures = [
    [
      "---",
      "title: Front",
      "# Frontmatter heading",
      "---",
      "# Root",
      "```",
      "# Fenced backtick heading",
      "```",
      "~~~~md",
      "## Fenced tilde heading",
      "~~~~",
      "```js",
      "# still fenced",
      "````",
      "# still waiting for a longer backtick close",
      "```",
      "# After mismatched fence",
      "   ## Indented",
      "####### Not a heading",
      "# Duplicate",
      "# Duplicate",
    ],
    [
      "body",
      "```",
      "# inside backticks",
      "```",
      "~~~",
      "# inside tildes",
      "~~~~",
      "# after longer tilde close",
      "    # four-space indented is not a heading",
      "   # three-space indented is a heading",
    ],
    ["# Only"],
    ["no headings at all", "just body"],
  ];

  for (const [index, lines] of fixtures.entries()) {
    assertScannerParity(lines, `hand fixture ${index}`);
  }

  for (let document = 0; document < 48; document += 1) {
    const lines = [];
    if (random() < 0.45) {
      lines.push("---", `title: gen-${document}`, "# hidden frontmatter", "---");
    }
    const lineCount = 10 + Math.floor(random() * 50);
    let openFence = null;
    for (let line = 0; line < lineCount; line += 1) {
      const roll = random();
      if (openFence) {
        if (roll < 0.25) {
          const extra = Math.floor(random() * 3);
          lines.push(openFence.char.repeat(openFence.length + extra));
          openFence = null;
        } else if (roll < 0.45) {
          lines.push(`${"#".repeat(1 + Math.floor(random() * 6))} Fenced heading ${document}-${line}`);
        } else {
          lines.push(`fenced body ${line}`);
        }
        continue;
      }
      if (roll < 0.22) {
        const level = 1 + Math.floor(random() * 6);
        const indent = random() < 0.2 ? "   " : "";
        lines.push(`${indent}${"#".repeat(level)} Heading ${document}-${line}`);
      } else if (roll < 0.28) {
        lines.push(`####### Not a heading ${line}`);
      } else if (roll < 0.36) {
        const char = pick(["`", "~"]);
        const length = 3 + Math.floor(random() * 3);
        openFence = { char, length };
        lines.push(char.repeat(length) + (random() < 0.4 ? "md" : ""));
      } else if (roll < 0.4) {
        lines.push(`   ${"#".repeat(1 + Math.floor(random() * 6))} Indented ${line}`);
      } else {
        lines.push(`Body ${document}-${line}`);
      }
    }
    if (openFence) lines.push(openFence.char.repeat(openFence.length));
    assertScannerParity(lines, `generated document ${document}`);
  }
});

test("Section Map chips stay in parity with the picker, and a single heading has no chips", () => {
  const lines = [
    "---",
    "# hidden",
    "---",
    "# Alpha",
    "```",
    "## fenced",
    "```",
    "## Beta",
    "~~~",
    "# tilde fenced",
    "~~~~",
    "# Gamma",
    "# Gamma",
  ];
  const headings = helpers.getSectionHeadingEntries(lines);
  assert.deepEqual(
    headings.map((heading) => heading.line),
    getSectionHeaderLinesOracle(lines),
  );
  for (let cursorLine = -1; cursorLine <= lines.length; cursorLine += 1) {
    for (const direction of [-1, 1]) {
      const targetLine = helpers.getSectionHeaderJumpLine(lines, cursorLine, direction);
      assert.equal(
        helpers.getSectionHeaderJumpLineFromEntries(headings, cursorLine, direction),
        targetLine,
      );
      const model = helpers.buildSectionMapModel(lines, { headings, cursorLine, direction });
      const chip = model.chips.find((candidate) => candidate.direction === direction);
      if (targetLine === null || targetLine === cursorLine) {
        assert.equal(chip, undefined);
        continue;
      }
      assert.equal(chip.targetLine, targetLine);
      assert.ok(model.rows.some((row) => row.line === targetLine && row.chipTarget));
    }
  }

  const single = helpers.buildSectionMapModel(["body", "# Only"], { cursorLine: 1, direction: 1 });
  assert.deepEqual(single.chips, []);
  assert.equal(single.onlySection, true);
});
