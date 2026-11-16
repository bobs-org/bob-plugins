#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const PLUGIN_DIR = path.join(REPO_ROOT, "plugins", "bob-emoji");
const SOURCE_PATH = path.join(PLUGIN_DIR, "vendor", "gemoji-emoji.json");
const CLDR_PATH = path.join(PLUGIN_DIR, "vendor", "cldr-annotations-en.json");
const CLDR_DERIVED_PATH = path.join(PLUGIN_DIR, "vendor", "cldr-annotations-derived-en.json");
const SOURCE_RELATIVE = "vendor/gemoji-emoji.json + vendor/cldr-annotations-en.json + vendor/cldr-annotations-derived-en.json";
const OUTPUT_DIR = path.join(PLUGIN_DIR, "src");
const OUTPUT_NAMES = [
  "020-emoji-catalog-a.js",
  "021-emoji-catalog-b.js",
  "022-emoji-catalog-c.js",
  "023-emoji-catalog-d.js",
];
const GROUP_SIZE = 3;

const VS16_RE = /\uFE0F/g;
function stripVS16(value) {
  return typeof value === "string" ? value.replace(VS16_RE, "") : value;
}

// Small curated keyword supplement for gaps neither gemoji nor CLDR 49 covers.
// Keeps the documented regression set green (memory -> brain, find -> mag,
// automation/service -> gear/robot/hammer, ready -> check mark, seed -> seedling).
// Keys are VS16-stripped glyphs; values are lowercase keywords.
const SUPPLEMENT_KEYWORDS = {
  "🧠": ["memory", "mind", "remember"],
  "🔍": ["find"],
  "🔎": ["find"],
  "⚙": ["automation", "service", "settings"],
  "🛠": ["automation", "service"],
  "🤖": ["automation", "service"],
  "✅": ["ready"],
  "🌱": ["seed"],
};

function normalizeEntry(entry, index) {
  if (!entry || typeof entry.emoji !== "string" || !entry.emoji ||
      typeof entry.description !== "string" || !Array.isArray(entry.aliases) ||
      entry.aliases.length === 0 || !Array.isArray(entry.tags)) {
    throw new Error("invalid gemoji entry at index " + index);
  }
  const aliases = [...new Set(entry.aliases
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => value.trim().toLowerCase()))];
  const tags = [...new Set(entry.tags
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => value.trim().toLowerCase()))];
  if (!aliases.length) throw new Error("gemoji entry has no aliases at index " + index);
  const category = typeof entry.category === "string" && entry.category.trim()
    ? entry.category.trim()
    : "Symbols";
  return {
    emoji: entry.emoji,
    aliases,
    tags,
    description: entry.description,
    category,
  };
}

function readCldrKeywords(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const holder = raw.annotations || raw.annotationsDerived || raw;
  const table = holder && holder.annotations;
  if (!table || typeof table !== "object") throw new Error("unexpected CLDR shape in " + filePath);
  const byGlyph = new Map();
  for (const [glyph, record] of Object.entries(table)) {
    if (!record || typeof record !== "object") continue;
    const defaults = Array.isArray(record.default) ? record.default : [];
    const tts = typeof record.tts === "string" ? record.tts : "";
    const words = [];
    for (const keyword of defaults) {
      if (typeof keyword === "string" && keyword.trim()) words.push(keyword.trim().toLowerCase());
    }
    if (tts.trim()) words.push(tts.trim().toLowerCase());
    if (!words.length) continue;
    const key = stripVS16(glyph);
    const existing = byGlyph.get(key);
    if (existing) {
      for (const word of words) if (!existing.includes(word)) existing.push(word);
    } else {
      byGlyph.set(key, [...words]);
    }
  }
  return byGlyph;
}

function readCatalog() {
  const raw = JSON.parse(fs.readFileSync(SOURCE_PATH, "utf8"));
  if (!Array.isArray(raw)) throw new Error("gemoji source must be a JSON array");
  const cldr = readCldrKeywords(CLDR_PATH);
  const derived = readCldrKeywords(CLDR_DERIVED_PATH);
  for (const [glyph, words] of derived) {
    const existing = cldr.get(glyph);
    if (existing) {
      for (const word of words) if (!existing.includes(word)) existing.push(word);
    } else {
      cldr.set(glyph, [...words]);
    }
  }
  const entries = raw.map(normalizeEntry).map((entry) => {
    const key = stripVS16(entry.emoji);
    const cldrWords = cldr.get(key) || cldr.get(entry.emoji) || [];
    const aliasSet = new Set(entry.aliases);
    const tagSet = new Set(entry.tags);
    const seen = new Set();
    const keywords = [];
    const supplement = SUPPLEMENT_KEYWORDS[key] || SUPPLEMENT_KEYWORDS[entry.emoji] || [];
    for (const word of [...cldrWords, ...supplement]) {
      const lower = String(word).toLowerCase();
      if (!lower || seen.has(lower)) continue;
      seen.add(lower);
      if (aliasSet.has(lower) || tagSet.has(lower)) continue;
      keywords.push(lower);
    }
    return {
      emoji: entry.emoji,
      aliases: entry.aliases,
      tags: entry.tags,
      description: entry.description,
      category: entry.category,
      keywords,
    };
  });
  const primaryAliases = new Set();
  for (const entry of entries) {
    const primary = entry.aliases[0];
    if (primaryAliases.has(primary)) throw new Error("duplicate primary alias: " + primary);
    primaryAliases.add(primary);
  }
  return entries;
}

function formatEntries(entries) {
  const lines = [];
  for (let i = 0; i < entries.length; i += GROUP_SIZE) {
    lines.push("  " + entries.slice(i, i + GROUP_SIZE).map((entry) => JSON.stringify(entry)).join(", ") + ",");
  }
  return lines.join("\n");
}

function generateFragments(entries) {
  const size = Math.ceil(entries.length / OUTPUT_NAMES.length);
  return OUTPUT_NAMES.map((name, index) => {
    const chunk = entries.slice(index * size, (index + 1) * size);
    const declaration = index === 0
      ? "const BOB_EMOJI_CATALOG = [\n"
      : "BOB_EMOJI_CATALOG.push(...[\n";
    const closing = index === 0 ? "\n];\n" : "\n]);\n";
    const header = "// GENERATED by scripts/gen-emoji-catalog.mjs from " + SOURCE_RELATIVE + ". Regenerate; do not hand-edit.\n";
    return [name, header + declaration + formatEntries(chunk) + closing];
  });
}

function main() {
  const check = process.argv.includes("--check");
  const entries = readCatalog();
  const generated = generateFragments(entries);
  const wanted = new Set(generated.map(([name]) => name));
  const existing = fs.readdirSync(OUTPUT_DIR)
    .filter((name) => /^\d{3}-emoji-catalog-[a-z]\.js$/.test(name));
  const errors = [];
  for (const [name, contents] of generated) {
    const target = path.join(OUTPUT_DIR, name);
    if (!fs.existsSync(target)) {
      errors.push("missing " + path.relative(REPO_ROOT, target));
    } else if (fs.readFileSync(target, "utf8") !== contents) {
      errors.push("stale " + path.relative(REPO_ROOT, target));
    }
  }
  for (const name of existing) {
    if (!wanted.has(name)) errors.push("unexpected " + path.relative(REPO_ROOT, path.join(OUTPUT_DIR, name)));
  }
  if (check) {
    if (errors.length) {
      for (const error of errors) console.error(error);
      process.exitCode = 1;
    }
    return;
  }
  for (const name of existing) {
    if (!wanted.has(name)) fs.unlinkSync(path.join(OUTPUT_DIR, name));
  }
  for (const [name, contents] of generated) {
    fs.writeFileSync(path.join(OUTPUT_DIR, name), contents);
  }
  console.log("Generated " + generated.length + " emoji catalog fragments from " + entries.length + " entries.");
}

try {
  main();
} catch (error) {
  console.error(error && error.message ? error.message : error);
  process.exitCode = 1;
}
