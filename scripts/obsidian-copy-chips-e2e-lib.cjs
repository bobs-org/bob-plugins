"use strict";

const path = require("node:path");
const fs = require("node:fs");

const NOTE = "Copy chips e2e.md";
const EMBED_NOTE = "Copy chips embed.md";

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

module.exports = {
  NOTE,
  EMBED_NOTE,
  notePath,
  seedNote,
  embedNote,
  baseConfigYaml,
  expectedChipPayloads,
};
