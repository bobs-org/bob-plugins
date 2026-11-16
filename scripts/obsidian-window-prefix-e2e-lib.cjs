// Fixture and signature helpers for the real-Obsidian window-prefix e2e.
//
// The spike harness drives real Obsidian through CDP in an owned scratch
// vault/profile (never the live vault). This module owns everything the
// offline self-test can check without Obsidian: the six fixture notes, the
// Mac-mirror hotkeys.json, the tiny PDF/PNG bytes, and the layout-signature
// grammar (`[ A  B* ] | [ C'  D ]`) that later phases reuse to build a layout
// from a signature and read the live layout back as the same signature.
//
// Signature notation (decision contract of
// plan:202611/obsidian_ctrl_w_window_prefix.md):
//   `*`  the focused (active) tab; pinned + active is `!*`
//   `'`  the selected tab of an unfocused split; pinned + selected is `!'`
//   `!`  a pinned tab
// Groups join with ` | `; tabs join with two spaces.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

// Named --only groups the harness accepts. `spike`, `actions`, `prefix`,
// and `visual` all run real probes; `visual` reports skipped only when its
// screenshots cannot run headlessly.
const GROUPS = Object.freeze(["spike", "actions", "prefix", "visual"]);

// Six fixture notes: enough distinct tabs for every decision-contract vector
// (one, two, three, and six columns plus pinned prefixes on both sides).
const FIXTURE_NOTES = Object.freeze([
  {
    name: "WP-A.md",
    body: [
      "# WP-A",
      "",
      "spike undo target alpha",
      "second line of A",
      "",
      "## Fold section A",
      "folded detail one",
      "folded detail two",
      "",
      "- [ ] spike task in A",
      "",
    ].join("\n"),
  },
  {
    name: "WP-B.md",
    body: [
      "# WP-B",
      "",
      "spike cursor line bravo",
      "second line of B",
      "",
      "## Fold section B",
      "folded detail one",
      "folded detail two",
      "",
      "- [ ] spike task in B",
      "",
    ].join("\n"),
  },
  {
    name: "WP-C.md",
    body: [
      "# WP-C",
      "",
      "spike join target charlie",
      "second line of C",
      "",
      "## Fold section C",
      "folded detail one",
      "folded detail two",
      "",
      "- [ ] spike task in C",
      "",
    ].join("\n"),
  },
  {
    name: "WP-D.md",
    body: [
      "# WP-D",
      "",
      "spike reading-view delta",
      "second line of D",
      "",
      "## Fold section D",
      "folded detail one",
      "folded detail two",
      "",
      "- [ ] spike task in D",
      "",
    ].join("\n"),
  },
  {
    name: "WP-E.md",
    body: [
      "# WP-E",
      "",
      "spike overflow echo",
      "second line of E",
      "",
      "## Fold section E",
      "folded detail one",
      "folded detail two",
      "",
      "- [ ] spike task in E",
      "",
    ].join("\n"),
  },
  {
    name: "WP-F.md",
    body: [
      "# WP-F",
      "",
      "spike overflow foxtrot",
      "second line of F",
      "",
      "## Fold section F",
      "folded detail one",
      "folded detail two",
      "",
      "- [ ] spike task in F",
      "",
    ].join("\n"),
  },
]);

const PNG_NAME = "pixel.png";
// A 1x1 transparent PNG: enough for an image leaf to mount and render.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const PDF_NAME = "tiny.pdf";
// A minimal one-page PDF: enough for a PDF leaf to mount and render.
const PDF_BYTES = [
  "%PDF-1.4",
  "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
  "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
  "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R>>endobj",
  "4 0 obj<</Length 44>>stream",
  "BT /F1 12 Tf 20 180 Td (spike pdf) Tj ET",
  "endstream endobj",
  "trailer<</Root 1 0 R>>",
  "%%EOF",
].join("\n");

// Mac-mirror hotkeys: Ctrl+W unbound (macOS leaves it free; Close tab is
// Cmd+W there) and Ctrl+L bound to a harmless core command so the
// suffix-collision probes are real: without a pushed Scope the chord must run
// the palette, with one it must not.
function macHotkeys() {
  return {
    "workspace:close": [],
    "command-palette:open": [{ modifiers: ["Ctrl"], key: "L" }],
  };
}

function linuxDefaultHotkeys() {
  // No workspace:close entry at all, so Obsidian's own Linux default applies.
  // Ctrl+L stays bound so the (f) preemption probe runs against a bound chord.
  return {
    "command-palette:open": [{ modifiers: ["Ctrl"], key: "L" }],
  };
}

function titleForFile(file) {
  return file.replace(/\.md$/, "");
}

function fileForTitle(title) {
  return `${title}.md`;
}

function parseLayoutSignature(text) {
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("layout signature must be a nonempty string");
  }
  const groups = text.split("|").map((part) => {
    const match = part.trim().match(/^\[(.*)\]$/s);
    if (!match) throw new Error("group is not wrapped in [ ]: " + part.trim());
    const tokens = match[1].trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) throw new Error("group has no tabs: " + part.trim());
    return {
      tabs: tokens.map((token) => {
        const tokenMatch = token.match(/^([^!*']+)(!)?([*'])?$/);
        if (!tokenMatch) throw new Error("bad signature token: " + token);
        return {
          title: tokenMatch[1],
          pinned: tokenMatch[2] === "!",
          mark: tokenMatch[3] || null,
        };
      }),
    };
  });
  const active = groups.flatMap((group) => group.tabs).filter((tab) => tab.mark === "*");
  if (active.length !== 1) {
    throw new Error(`signature needs exactly one active (*) tab, found ${active.length}: ${text}`);
  }
  return { groups };
}

function formatLayoutSignature(layout) {
  const groups = layout && layout.groups;
  if (!Array.isArray(groups) || !groups.length) {
    throw new Error("layout needs a nonempty groups array");
  }
  return groups
    .map((group) => {
      if (!group || !Array.isArray(group.tabs) || !group.tabs.length) {
        throw new Error("each group needs a nonempty tabs array");
      }
      return `[ ${group.tabs
        .map((tab) => `${tab.title}${tab.pinned ? "!" : ""}${tab.mark || ""}`)
        .join("  ")} ]`;
    })
    .join(" | ");
}

function normalizeSignature(text) {
  return formatLayoutSignature(parseLayoutSignature(text));
}

// Every decision-contract vector from the plan, as { from, to } signature
// pairs. The spike uses them for the offline grammar check; the actions
// phase reuses them as live move vectors.
const DECISION_VECTORS = Object.freeze([
  Object.freeze({ name: "create-right", from: "[ A  B* ]", to: "[ A' ] | [ B* ]" }),
  Object.freeze({ name: "create-left", from: "[ A  B* ]", to: "[ B* ] | [ A' ]" }),
  Object.freeze({ name: "join-right", from: "[ A  B* ] | [ C'  D ]", to: "[ A' ] | [ C  B*  D ]" }),
  Object.freeze({ name: "join-left", from: "[ A'  B ] | [ C*  D ]", to: "[ A  C*  B ] | [ D' ]" }),
  Object.freeze({ name: "last-tab-out", from: "[ A* ] | [ C  B' ]", to: "[ C  B  A* ]" }),
  Object.freeze({ name: "middle-out", from: "[ A' ] | [ B* ] | [ C' ]", to: "[ A  B* ] | [ C' ]" }),
  Object.freeze({ name: "only-tab", from: "[ A* ]", to: "[ A* ]" }),
  Object.freeze({ name: "edge-sole-tab", from: "[ A* ] | [ B' ]", to: "[ A* ] | [ B' ]" }),
  Object.freeze({
    name: "pinned-stays-pinned",
    from: "[ P!*  B ] | [ Q!  C' ]",
    to: "[ B' ] | [ Q!  P!*  C ]",
  }),
  Object.freeze({
    name: "unpinned-after-pins",
    from: "[ A*  B ] | [ Q!'  R!  C ]",
    to: "[ B' ] | [ Q!  R!  A*  C ]",
  }),
  Object.freeze({ name: "focus", from: "[ A* ] | [ B' ] | [ C' ]", to: "[ A' ] | [ B* ] | [ C' ]" }),
  Object.freeze({ name: "split", from: "[ A* ]", to: "[ A' ] | [ A* ]" }),
]);

function assertDecisionVectorsRoundTrip() {
  const failures = [];
  for (const vector of DECISION_VECTORS) {
    for (const side of [vector.from, vector.to]) {
      try {
        const parsed = parseLayoutSignature(side);
        const formatted = formatLayoutSignature(parsed);
        const reparsed = parseLayoutSignature(formatted);
        if (JSON.stringify(parsed) !== JSON.stringify(reparsed)) {
          failures.push(`${vector.name}: unstable round-trip for ${side}`);
        }
      } catch (error) {
        failures.push(`${vector.name}: ${error && error.message ? error.message : error}`);
      }
    }
  }
  return { ok: failures.length === 0, failures };
}

function seedNotes() {
  return new Map(FIXTURE_NOTES.map((note) => [note.name, note.body]));
}

function writeFixtureFiles(vaultDir, hotkeys) {
  for (const note of FIXTURE_NOTES) {
    const target = path.join(vaultDir, note.name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, note.body);
  }
  fs.writeFileSync(path.join(vaultDir, PNG_NAME), Buffer.from(PNG_BASE64, "base64"));
  fs.writeFileSync(path.join(vaultDir, PDF_NAME), PDF_BYTES);
  const obsidianDir = path.join(vaultDir, ".obsidian");
  fs.mkdirSync(obsidianDir, { recursive: true });
  fs.writeFileSync(path.join(obsidianDir, "hotkeys.json"), JSON.stringify(hotkeys, null, 2));
  return {
    notes: FIXTURE_NOTES.map((note) => note.name),
    media: [PNG_NAME, PDF_NAME],
  };
}

function assertFixtureDir(vaultDir, hotkeys) {
  const failures = [];
  for (const note of FIXTURE_NOTES) {
    const file = path.join(vaultDir, note.name);
    if (!fs.existsSync(file)) failures.push("missing note " + note.name);
    else if (!fs.readFileSync(file, "utf8").includes("# " + titleForFile(note.name))) {
      failures.push("note body changed: " + note.name);
    }
  }
  if (!fs.existsSync(path.join(vaultDir, PNG_NAME))) failures.push("missing " + PNG_NAME);
  if (!fs.existsSync(path.join(vaultDir, PDF_NAME))) failures.push("missing " + PDF_NAME);
  const hotkeysPath = path.join(vaultDir, ".obsidian", "hotkeys.json");
  if (!fs.existsSync(hotkeysPath)) {
    failures.push("missing .obsidian/hotkeys.json");
  } else {
    try {
      const written = JSON.parse(fs.readFileSync(hotkeysPath, "utf8"));
      if (JSON.stringify(written) !== JSON.stringify(hotkeys)) {
        failures.push("hotkeys.json drifted from the requested hotkeys");
      }
      const close = written["workspace:close"];
      const palette = written["command-palette:open"];
      const ctrlL = Array.isArray(palette) && palette.some((binding) => binding.key === "L" && Array.isArray(binding.modifiers) && binding.modifiers.includes("Ctrl"));
      if (!ctrlL) failures.push("hotkeys.json does not bind Ctrl+L for the collision probe");
      if (hotkeys["workspace:close"] && !(Array.isArray(close) && close.length === 0)) {
        failures.push("mac hotkeys.json must unbind workspace:close with []");
      }
    } catch (error) {
      failures.push("hotkeys.json is not valid JSON");
    }
  }
  return { ok: failures.length === 0, failures };
}

module.exports = {
  GROUPS,
  FIXTURE_NOTES,
  PNG_NAME,
  PDF_NAME,
  PNG_BASE64,
  PDF_BYTES,
  DECISION_VECTORS,
  macHotkeys,
  linuxDefaultHotkeys,
  titleForFile,
  fileForTitle,
  parseLayoutSignature,
  formatLayoutSignature,
  normalizeSignature,
  assertDecisionVectorsRoundTrip,
  seedNotes,
  writeFixtureFiles,
  assertFixtureDir,
};
