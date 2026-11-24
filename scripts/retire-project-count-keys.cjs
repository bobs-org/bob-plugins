#!/usr/bin/env node
// Read candidates locally; bob is the only YAML parser and writer.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const KEYS = ["task_count", "open_task_count"];

function optionsFromArgs(args, env = process.env) {
  const options = {
    apply: false,
    vault: env.BOB_DIR || path.join(os.homedir(), "bob"),
    bob: env.BOB_BIN || "bob",
  };
  let mode = null;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--apply" || arg === "--dry-run") {
      if (mode && mode !== arg) throw new Error("Choose --apply or --dry-run");
      mode = arg;
      options.apply = arg === "--apply";
    } else if (arg === "--bob-dir" && args[i + 1]) {
      options.vault = args[++i];
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }
  options.vault = path.resolve(options.vault);
  return options;
}

function* markdownNotes(root, relative = "") {
  const entries = fs.readdirSync(path.join(root, relative), { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    // No symlink traversal; bob also enforces confinement at apply time.
    if ([".git", ".obsidian", ".bob"].includes(entry.name) || entry.isSymbolicLink()) continue;
    const name = path.join(relative, entry.name);
    if (entry.isDirectory()) yield* markdownNotes(root, name);
    else if (entry.isFile() && /\.md$/i.test(entry.name)) yield name;
  }
}

function runBob(options, args, input) {
  const result = spawnSync(options.bob, args, {
    encoding: "utf8",
    input: input === undefined ? undefined : JSON.stringify(input),
    env: { ...process.env, BOB_DIR: options.vault, NO_COLOR: "1" },
    // Ownership discovery scans the vault; a full live vault can exceed 30s.
    timeout: 120000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  let report;
  try { report = JSON.parse(result.stdout); } catch (_) {
    throw new Error((result.stderr || result.stdout || `bob exited ${result.status}`).trim());
  }
  if (result.status !== 0 || report.ok === false) {
    throw new Error(JSON.stringify(report.error || report));
  }
  return report;
}

function sweep(options, invoke = runBob, output = console.log) {
  const catalog = invoke(options, ["__catalog", "--protocol", "1"]);
  if (!catalog.features?.includes("props_v1")) {
    throw new Error("bob lacks props_v1; set BOB_BIN to a current bob build");
  }
  const totals = { changed: 0, skipped: 0, keys: 0 };
  output("Note\tResult\tKeys / reason");
  for (const note of markdownNotes(options.vault)) {
    try {
      // A broad lexical prefilter includes quoted and flow-map keys. The
      // properties report, never this scan, decides what is actually a key.
      const bytes = fs.readFileSync(path.join(options.vault, note), "utf8");
      if (!KEYS.some((key) => bytes.includes(key))) continue;
      const report = invoke(options, ["props", "show", note, "-f", "json"]);
      if (report.frontmatter?.state === "absent") continue;
      if (!report.fingerprint || report.frontmatter?.state !== "ok") {
        throw new Error("Invalid or ambiguous frontmatter; repair it before retrying");
      }
      const present = KEYS.filter((key) => report.properties.some((prop) => prop.key === key));
      if (!present.length) continue;
      // Unsetting an absent key is refused by props, so single-key notes
      // receive one op; notes with both keys receive both in one transaction.
      const request = {
        schema_version: 1,
        expect: report.fingerprint,
        ops: present.map((key) => ({ op: "prop.unset", key })),
      };
      const args = ["props", "update", note, "-f", "json", "-i", "-"];
      if (!options.apply) args.push("-d");
      const updated = invoke(options, args, request);
      if (!updated.changed) throw new Error("bob reported no change; inspect and retry");
      totals.changed += 1;
      totals.keys += present.length;
      output(`${note}\t${options.apply ? "removed" : "would remove"}\t${present.join(", ")}`);
    } catch (error) {
      totals.skipped += 1;
      output(`${note}\tskipped\t${String(error.message).replace(/[\r\n\t]+/g, " ")}`);
    }
  }
  output(`Total: ${totals.changed} notes, ${totals.keys} keys ${options.apply ? "removed" : "to remove"}, ${totals.skipped} skipped`);
  return totals;
}

if (require.main === module) {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("Usage: node scripts/retire-project-count-keys.cjs [--dry-run | --apply] [--bob-dir DIR]\nDefaults: dry-run, BOB_DIR or ~/bob, BOB_BIN or bob. Includes done/. Exit 1 if any note is skipped.");
  } else {
    try {
      process.exitCode = sweep(optionsFromArgs(process.argv.slice(2))).skipped ? 1 : 0;
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}

module.exports = { optionsFromArgs, sweep };
