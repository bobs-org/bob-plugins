"use strict";

const path = require("node:path");
const fs = require("node:fs");

const NOTE = "Copy chips e2e.md";
const EMBED_NOTE = "Copy chips embed.md";
const AUTHOR_NOTE = "Copy chips authoring e2e.md";

function notePath() {
  return NOTE;
}

function seedNote() {
  const vectors = JSON.parse(
    fs.readFileSync(path.join(__dirname, "fixtures", "copy-chips-vectors.json"), "utf8"),
  );
  const lines = ["# Copy chips e2e", ""];
  lines.push("Start here with `copy: ssh apollo` and `copy: pwd` on one line.");
  lines.push("");
  for (const vector of vectors.chips) {
    lines.push(vector.line);
  }
  lines.push("");
  lines.push("Not chips stay plain code: `copy:` and `Copy: x` and `copy x`.");
  lines.push("");
  lines.push("Table row:");
  lines.push("");
  lines.push("| cmd | `copy: a\\|b` |");
  lines.push("| --- | --- |");
  lines.push("| ssh | `copy: ssh apollo` |");
  lines.push("");
  lines.push("Double-backtick payload with backticks inside:");
  lines.push("");
  lines.push("``copy: run `bob plan` first``");
  lines.push("");
  lines.push("Fence card:");
  lines.push("");
  lines.push("```bob-copy Weekly status");
  lines.push("Hi team —");
  lines.push("Here is where things stand this week:");
  lines.push("```");
  lines.push("");
  lines.push("Fence with an interior blank line:");
  lines.push("");
  lines.push("```bob-copy");
  lines.push("line one");
  lines.push("");
  lines.push("line three");
  lines.push("```");
  lines.push("");
  lines.push("Fence with a trailing blank line:");
  lines.push("");
  lines.push("```bob-copy Trailing");
  lines.push("hello");
  lines.push("");
  lines.push("```");
  lines.push("");
  lines.push("List-nested fence:");
  lines.push("");
  lines.push("- item");
  lines.push("  ```bob-copy Nested");
  lines.push("  nested body");
  lines.push("  ```");
  lines.push("");
  lines.push("Long fence (folds):");
  lines.push("");
  lines.push("```bob-copy Long");
  for (let index = 1; index <= 10; index += 1) lines.push("line " + index);
  lines.push("```");
  lines.push("");
  lines.push("Callout fence (generic title):");
  lines.push("");
  lines.push("> [!note] Callout card");
  lines.push("> ```bob-copy");
  lines.push("> callout body");
  lines.push("> ```");
  lines.push("");
  lines.push("Embed below:");
  lines.push("");
  lines.push("![[" + EMBED_NOTE + "]]");
  lines.push("");
  lines.push("Dataview spans stay untouched: `= dataview` and `$= 1 + 1`.");
  lines.push("");
  return lines.join("\n");
}

function embedNote() {
  return ["# Copy chips embed", "", "Embedded chip: `copy: embedded-payload`.", ""].join("\n");
}

function authorNotePath() {
  return AUTHOR_NOTE;
}

function authorSeedNote() {
  return [
    "# Copy chips authoring e2e",
    "",
    "WRAP_ONE wrap this phrase here",
    "",
    "LIST_WRAP",
    "- item first line",
    "  second line",
    "",
    "EDIT_INLINE `copy: old-inline`",
    "",
    "EDIT_BLOCK",
    "```bob-copy Old fence",
    "old body",
    "```",
    "",
    "CONVERT_SPAN `plain span here`",
    "",
    "INSERT_HERE",
    "",
    "TABLE_CELL",
    "| a | b |",
    "| --- | --- |",
    "| keep | cell |",
    "",
    "BACKTICKS see inner ticks here",
    "",
    "UNDO_LINE type-before SELECT_ME",
    "",
    "ALT_CLICK `copy: alt-target`",
    "",
    "IDENTICAL `copy: twin` and `copy: twin`",
    "",
    "PALETTE_HERE",
    "",
    "VISUAL wrap visual phrase now",
    "",
  ].join("\n");
}

function baseConfigYaml() {
  return ["copy:", "  templates:", "    - label: Note link", '      template: "[[{note_name}]]"', ""].join("\n");
}

function expectedChipPayloads() {
  const vectors = JSON.parse(
    fs.readFileSync(path.join(__dirname, "fixtures", "copy-chips-vectors.json"), "utf8"),
  );
  const out = [];
  for (const vector of vectors.chips) {
    for (const chip of vector.expected) {
      out.push({ id: vector.id, label: chip.label, text: chip.text });
    }
  }
  return Object.freeze(out);
}

// The exact payloads the seeded fences must copy, byte for byte. The e2e
// pins Obsidian's real `source` shape (trailing newline, list-nested
// indentation) through these clipboard bytes.
function expectedFencePayloads() {
  return Object.freeze([
    { id: "weekly", label: "Weekly status", text: "Hi team —\nHere is where things stand this week:" },
    { id: "blank", label: null, text: "line one\n\nline three" },
    { id: "trailing", label: "Trailing", text: "hello\n" },
    { id: "nested", label: "Nested", text: "nested body" },
    {
      id: "long",
      label: "Long",
      text: "line 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7\nline 8\nline 9\nline 10",
    },
    { id: "callout", label: null, text: "callout body" },
  ]);
}

module.exports = {
  NOTE,
  EMBED_NOTE,
  AUTHOR_NOTE,
  notePath,
  seedNote,
  embedNote,
  authorNotePath,
  authorSeedNote,
  baseConfigYaml,
  expectedChipPayloads,
  expectedFencePayloads,
};
