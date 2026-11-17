#!/usr/bin/env node
// Offline record-writer acceptance for the Record Card write machine.
// Exercises the real `bob records update -i -` writer against an isolated
// Git-backed scratch vault: status pick, stale/invalid/required-empty
// refusals, Undo, list round-trips, CRLF preserved, BOM refused.
// Never launches Obsidian and never opens the live vault.
"use strict";

const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function fail(message) {
  throw new Error(message);
}

function loadLedgerHelpers() {
  const Module = require("node:module");
  const originalLoad = Module._load;
  Module._load = function loadWithObsidianStubs(request, parent, isMain) {
    if (request === "obsidian") {
      return {
        MarkdownView: class {},
        Notice: class {},
        Platform: { isDesktopApp: true },
        Plugin: class {},
        normalizePath: (value) => value,
        parseYaml: () => ({}),
      };
    }
    if (request === "@codemirror/state") {
      return { Prec: { highest: (value) => value } };
    }
    if (request === "@codemirror/view") {
      return {
        EditorView: { updateListener: { of: (listener) => ({ listener }) } },
        keymap: { of: (value) => value },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
    return LedgerToolsPlugin.helpers;
  } finally {
    Module._load = originalLoad;
  }
}

function writeNote(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function findWorkspaceManifest() {
  let dir = path.resolve(__dirname, "..");
  for (let i = 0; i < 8; i += 1) {
    const candidate = path.join(dir, "Cargo.toml");
    try {
      const content = fs.readFileSync(candidate, "utf8");
      if (/name\s*=\s*"bob(-cli|-obsidian)?"/.test(content) || /\[workspace\]/.test(content)) {
        return candidate;
      }
    } catch {
      // Keep walking up.
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function findRealBob() {
  const candidates = [];
  if (process.env.BOB_BIN) candidates.push(process.env.BOB_BIN);
  if (process.env.BOB_CLI_BIN) candidates.push(process.env.BOB_CLI_BIN);
  const manifest = findWorkspaceManifest();
  if (manifest) {
    try {
      const meta = spawnSync("cargo", ["metadata", "--format-version", "1", "--no-deps", "--manifest-path", manifest], {
        encoding: "utf8",
        timeout: 20_000,
      });
      if (meta.status === 0 && meta.stdout) {
        const parsed = JSON.parse(meta.stdout);
        if (parsed && parsed.target_directory) {
          candidates.push(path.join(parsed.target_directory, "debug", "bob"));
          candidates.push(path.join(parsed.target_directory, "release", "bob"));
        }
      }
    } catch {
      // Fall back to installed bob.
    }
  }
  if (process.env.CARGO_TARGET_DIR) {
    candidates.push(path.join(process.env.CARGO_TARGET_DIR, "debug", "bob"));
  }
  candidates.push(
    path.join(os.homedir(), ".cargo", "bin", "bob"),
    path.join(os.homedir(), ".local", "bin", "bob"),
    "bob",
  );
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if (candidate === "bob") {
        const which = spawnSync("which", ["bob"], { encoding: "utf8", timeout: 5_000 });
        if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
        continue;
      }
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Keep looking.
    }
  }
  return "";
}

function bobEnv(vaultDir) {
  const env = { ...process.env };
  env.BOB_DIR = vaultDir;
  env.BOB_NOW = "2026-11-12 12:00:00";
  env.BOB_CONFIG_FILE = "/definitely/missing/bob-cli-test-config.yml";
  env.NO_COLOR = "1";
  return env;
}

function runBob(bobBin, vaultDir, args, stdin) {
  return spawnSync(bobBin, args, {
    encoding: "utf8",
    env: bobEnv(vaultDir),
    timeout: 60_000,
    maxBuffer: 32 * 1024 * 1024,
    input: stdin,
  });
}

function runJson(bobBin, vaultDir, args, stdin) {
  const result = runBob(bobBin, vaultDir, args, stdin);
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  let parsed = null;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    fail(`bob ${args.slice(0, 3).join(" ")} did not emit JSON: status=${result.status} stderr=${stderr.slice(0, 300)}`);
  }
  return { result, parsed, stdout, stderr };
}

function ensureGitWorktree(vaultDir) {
  if (fs.existsSync(path.join(vaultDir, ".git"))) return;
  const run = (args, cwd) => spawnSync("git", args, { cwd: cwd || vaultDir, encoding: "utf8", timeout: 20_000 });
  const origin = `${vaultDir}.origin.git`;
  if (!fs.existsSync(origin)) {
    spawnSync("git", ["init", "-q", "--bare", origin], { encoding: "utf8", timeout: 20_000 });
    spawnSync("git", ["--git-dir", origin, "symbolic-ref", "HEAD", "refs/heads/master"], { encoding: "utf8", timeout: 20_000 });
  }
  run(["init", "-q"]);
  run(["symbolic-ref", "HEAD", "refs/heads/master"]);
  run(["config", "user.email", "record-writer-e2e@example.com"]);
  run(["config", "user.name", "Record Writer E2E"]);
  run(["remote", "add", "origin", origin]);
  run(["add", "."]);
  run(["commit", "-q", "-m", "record writer e2e fixture"]);
  run(["push", "-q", "-u", "origin", "master"]);
}

function gitCount(vaultDir) {
  const run = spawnSync("git", ["rev-list", "--count", "HEAD"], { cwd: vaultDir, encoding: "utf8", timeout: 20_000 });
  return Number(String(run.stdout || "").trim());
}

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function fixtureNotes() {
  return {
    "area.md": [
      "---",
      'type: "[[area]]"',
      'parent: "[[type]]"',
      "---",
      "",
      "# Area",
      "",
    ].join("\n"),
    "type.md": "# Type\n",
    "body.md": [
      "---",
      'type: "[[area]]"',
      'parent: "[[area]]"',
      "---",
      "",
      "# Body",
      "",
    ].join("\n"),
    "eat.md": [
      "---",
      'type: "[[album]]"',
      'parent: "[[body]]"',
      "summary: Places to eat.",
      'emoji: "🍽️"',
      "record:",
      "  noun: restaurant",
      "  label: Restaurant",
      "  fields:",
      '    status: {required: true, values: {to_try: "To try", liked: "Liked"}}',
      "    category: {required: true}",
      "    location: {}",
      "    tags: {list: true}",
      "    rating: {values: number}",
      "---",
      "",
      "# Restaurants",
      "",
    ].join("\n"),
    "eat/ninja_sushi.md": [
      "---",
      "title: Ninja Sushi",
      'parent: "[[eat]]"',
      'type: "[[record]]"',
      "status: to_try",
      "category: Sushi",
      "location: Clark",
      "---",
      "",
      "# Ninja Sushi",
      "",
      "## Notes",
      "- 2025-01-02: First visit.",
      "",
    ].join("\n"),
  };
}

function envelope(expect, ops) {
  return JSON.stringify({ schema_version: 1, expect: String(expect || ""), ops: Array.isArray(ops) ? ops : [] });
}

function splitRecordsCallout(text) {
  const marker = "> [!records]";
  const start = text.indexOf(marker);
  if (start < 0) return { before: text, callout: "", after: "" };
  let cursor = start;
  while (cursor < text.length) {
    const lineEnd = text.indexOf("\n", cursor);
    const end = lineEnd < 0 ? text.length : lineEnd;
    const line = text.slice(cursor, end);
    if (cursor !== start && !line.startsWith(">") && line.trim() !== "") break;
    cursor = lineEnd < 0 ? text.length : lineEnd + 1;
    if (!line.startsWith(">") && line.trim() === "" && cursor > start) break;
  }
  return {
    before: text.slice(0, start),
    callout: text.slice(start, cursor),
    after: text.slice(cursor),
  };
}

function assertUpdateShape(parsed, { dryRun = false, ok = true } = {}) {
  if (!parsed || typeof parsed !== "object") fail("update result is not an object");
  if (parsed.schema_version !== 1) fail("schema_version must be 1");
  if (parsed.command !== "update") fail("command must be update");
  if (typeof parsed.ok !== "boolean") fail("ok must be boolean");
  if (parsed.ok !== ok) fail(`ok must be ${ok}, saw ${parsed.ok}`);
  if (parsed.dry_run !== dryRun) fail(`dry_run must be ${dryRun}`);
  if (!Array.isArray(parsed.changed)) fail("changed must be a string array");
  if (typeof parsed.fingerprint_before !== "string" || typeof parsed.fingerprint_after !== "string") {
    fail("fingerprints must be strings");
  }
  if (!Array.isArray(parsed.inverse_ops) || !Array.isArray(parsed.properties) || !Array.isArray(parsed.changes)) {
    fail("inverse_ops, properties, and changes must be arrays");
  }
}

async function selfTest() {
  const bobBin = process.env.BOB_BIN ? path.resolve(process.env.BOB_BIN) : findRealBob();
  if (!bobBin) {
    process.stdout.write("UNRUN: offline record-writer self-test skipped real-bob assertions (set BOB_BIN)\n");
    return;
  }
  try { fs.accessSync(bobBin, fs.constants.X_OK); }
  catch { fail(`BOB_BIN is not executable: ${bobBin}`); }

  const helpers = loadLedgerHelpers();
  const notes = fixtureNotes();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "bob-record-writer-e2e-"));
  try {
    const vaultDir = path.join(scratch, "vault");
    fs.mkdirSync(vaultDir, { recursive: true });
    for (const [name, body] of Object.entries(notes)) writeNote(path.join(vaultDir, name), body);
    ensureGitWorktree(vaultDir);

    const synced = runBob(bobBin, vaultDir, ["albums", "sync", "-f", "json"]);
    try {
      const syncReport = JSON.parse(String(synced.stdout || ""));
      if (!syncReport || syncReport.command !== "sync") fail("not a sync report");
    } catch {
      fail(`fixture sync failed: ${String(synced.stderr || "").slice(0, 300)}`);
    }

    const recordPath = path.join(vaultDir, "eat/ninja_sushi.md");
    const albumPath = path.join(vaultDir, "eat.md");
    const show = (stem) => runJson(bobBin, vaultDir, ["records", "show", "restaurant", stem, "-f", "json"]);
    const update = (stem, doc, extra = []) =>
      runJson(bobBin, vaultDir, ["records", "update", "restaurant", stem, "-f", "json", "-i", "-", ...extra], doc);

    const shown = show("ninja_sushi");
    const decodedShow = helpers.recordDecodeShowReport(shown.stdout, shown.stderr, shown.result.status);
    if (!decodedShow.ok || !decodedShow.report || decodedShow.report.ok !== true) {
      fail(`plugin show decoder rejected bob JSON: ${JSON.stringify(decodedShow)}`);
    }
    const fingerprint = shown.parsed.record.fingerprint;
    if (!fingerprint || !String(fingerprint).startsWith("sha256:")) fail("show must report a record fingerprint");

    const statusOps = [{ op: "field.set", field: "status", value: "liked" }];
    const recordBefore = fs.readFileSync(recordPath);
    const albumBefore = fs.readFileSync(albumPath, "utf8");
    const commitsBefore = gitCount(vaultDir);

    const dry = update("ninja_sushi", envelope(fingerprint, statusOps), ["-d"]);
    assertUpdateShape(dry.parsed, { dryRun: true, ok: true });
    const decodedDry = helpers.recordDecodeUpdateReport(dry.stdout, dry.stderr, dry.result.status);
    if (!decodedDry.ok || decodedDry.report.ok !== true) fail("plugin decoder rejected dry-run JSON");
    if (!Array.isArray(dry.parsed.changed) || dry.parsed.changed[0] !== "status") {
      fail(`dry-run changed must name status: ${JSON.stringify(dry.parsed.changed)}`);
    }
    if (hashFile(recordPath) !== crypto.createHash("sha256").update(recordBefore).digest("hex")) {
      fail("dry-run wrote the record");
    }
    if (fs.readFileSync(albumPath, "utf8") !== albumBefore) fail("dry-run wrote the album");
    if (gitCount(vaultDir) !== commitsBefore) fail("dry-run must not commit");

    const applied = update("ninja_sushi", envelope(fingerprint, statusOps));
    assertUpdateShape(applied.parsed, { dryRun: false, ok: true });
    const decodedApply = helpers.recordDecodeUpdateReport(applied.stdout, applied.stderr, applied.result.status);
    if (!decodedApply.ok || decodedApply.report.ok !== true) fail("plugin decoder rejected apply JSON");
    if (applied.parsed.changed.join(",") !== "status") fail(`apply changed ${JSON.stringify(applied.parsed.changed)}`);
    if (!applied.parsed.inverse_ops.length) fail("apply must return inverse ops");
    if (applied.parsed.fingerprint_after === applied.parsed.fingerprint_before) fail("apply must advance the fingerprint");

    const recordAfter = fs.readFileSync(recordPath, "utf8");
    const expectedRecord = Buffer.from(recordBefore).toString("utf8").replace("status: to_try", "status: liked");
    if (recordAfter !== expectedRecord) fail("status pick must rewrite only the status: span");
    const albumAfter = fs.readFileSync(albumPath, "utf8");
    const beforeParts = splitRecordsCallout(albumBefore);
    const afterParts = splitRecordsCallout(albumAfter);
    if (!afterParts.callout.includes("[!records]")) fail("apply must keep the records callout");
    if (beforeParts.before !== afterParts.before || beforeParts.after !== afterParts.after) {
      fail("apply must rewrite only the [!records] callout on the album");
    }
    if (beforeParts.callout === afterParts.callout) fail("status pick must regroup the records callout");
    if (gitCount(vaultDir) !== commitsBefore) fail("record apply must not add a git commit");

    const stale = update("ninja_sushi", envelope(fingerprint, statusOps));
    assertUpdateShape(stale.parsed, { dryRun: false, ok: false });
    if (stale.result.status !== 2) fail(`stale refusal must exit 2, saw ${stale.result.status}`);
    if (stale.parsed.error.code !== "stale_record") fail(`stale code: ${JSON.stringify(stale.parsed.error)}`);
    if (fs.readFileSync(recordPath, "utf8") !== recordAfter) fail("stale refusal wrote the record");
    if (fs.readFileSync(albumPath, "utf8") !== albumAfter) fail("stale refusal wrote the album");

    const currentFp = applied.parsed.fingerprint_after;
    const invalid = update("ninja_sushi", envelope(currentFp, [{ op: "field.set", field: "status", value: "bogus" }]));
    assertUpdateShape(invalid.parsed, { dryRun: false, ok: false });
    if (invalid.parsed.error.code !== "record_invalid_value") fail(`invalid code: ${JSON.stringify(invalid.parsed.error)}`);
    if (fs.readFileSync(recordPath, "utf8") !== recordAfter) fail("invalid refusal wrote the record");

    const requiredEmpty = update("ninja_sushi", envelope(currentFp, [{ op: "field.unset", field: "status" }]));
    assertUpdateShape(requiredEmpty.parsed, { dryRun: false, ok: false });
    if (requiredEmpty.parsed.error.code !== "record_required_empty") {
      fail(`required-empty code: ${JSON.stringify(requiredEmpty.parsed.error)}`);
    }
    if (fs.readFileSync(recordPath, "utf8") !== recordAfter) fail("required-empty refusal wrote the record");
    if (fs.readFileSync(albumPath, "utf8") !== albumAfter) fail("required-empty refusal wrote the album");

    const undone = update("ninja_sushi", envelope(currentFp, applied.parsed.inverse_ops));
    assertUpdateShape(undone.parsed, { dryRun: false, ok: true });
    const restoredRecord = fs.readFileSync(recordPath, "utf8");
    if (restoredRecord !== Buffer.from(recordBefore).toString("utf8")) fail("Undo must restore the record value");
    const restoredAlbum = fs.readFileSync(albumPath, "utf8");
    const restoredParts = splitRecordsCallout(restoredAlbum);
    const originalParts = splitRecordsCallout(albumBefore);
    if (restoredParts.callout !== originalParts.callout) fail("Undo must restore the records regrouping");
    if (undone.parsed.fingerprint_after !== fingerprint) fail("Undo must restore the original fingerprint");

    const listApply = update("ninja_sushi", envelope(fingerprint, [
      { op: "field.set", field: "tags", value: ["a,b", "c"] },
    ]));
    assertUpdateShape(listApply.parsed, { dryRun: false, ok: true });
    const listed = fs.readFileSync(recordPath, "utf8");
    if (!listed.includes('  - "a,b"\n  - "c"\n') && !listed.includes("  - \"a,b\"\n  - c\n")) {
      fail(`list round-trip missing comma item: ${listed}`);
    }
    const tags = (listApply.parsed.properties || []).find((row) => row && row.key === "tags");
    if (!tags || JSON.stringify(tags.value) !== JSON.stringify(["a,b", "c"])) {
      fail(`list property must round-trip JSON arrays: ${JSON.stringify(tags)}`);
    }
    const listUndo = update("ninja_sushi", envelope(listApply.parsed.fingerprint_after, listApply.parsed.inverse_ops));
    assertUpdateShape(listUndo.parsed, { dryRun: false, ok: true });
    if (fs.readFileSync(recordPath, "utf8").includes("tags:")) fail("list Undo must drop tags");

    const originalLf = fs.readFileSync(recordPath, "utf8");
    fs.writeFileSync(recordPath, originalLf.replace(/\n/g, "\r\n"));
    const crlfShow = show("ninja_sushi");
    const crlfFp = crlfShow.parsed.record.fingerprint;
    const crlfApply = update("ninja_sushi", envelope(crlfFp, statusOps));
    assertUpdateShape(crlfApply.parsed, { dryRun: false, ok: true });
    const crlfBytes = fs.readFileSync(recordPath);
    const crlfText = crlfBytes.toString("utf8");
    if (!crlfText.includes("\r\n")) fail("CRLF must be preserved");
    if (!crlfText.includes("status: liked")) fail("CRLF apply must rewrite status");
    if (!crlfText.includes("category: Sushi\r\n")) fail("CRLF apply must keep untouched field newlines");

    const bomText = `\u{feff}${originalLf}`;
    fs.writeFileSync(recordPath, bomText);
    const bomShow = show("ninja_sushi");
    const bomFp = bomShow.parsed.record.fingerprint;
    const bomBefore = fs.readFileSync(recordPath);
    const bomApply = update("ninja_sushi", envelope(bomFp, statusOps));
    assertUpdateShape(bomApply.parsed, { dryRun: false, ok: false });
    if (bomApply.parsed.error.code !== "record_uneditable") {
      fail(`BOM must refuse as record_uneditable, saw ${JSON.stringify(bomApply.parsed.error)}`);
    }
    const bomAfter = fs.readFileSync(recordPath);
    if (Buffer.compare(bomBefore, bomAfter) !== 0) fail("BOM refusal must keep every byte");

    const version = spawnSync(bobBin, ["--version"], { encoding: "utf8", timeout: 10_000 });
    process.stdout.write(`offline record-writer self-test complete (BOB_BIN=${bobBin}; ${String(version.stdout || version.stderr || "").trim()})\n`);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function main(argv) {
  const args = { help: false, selfTest: false };
  for (const token of argv) {
    if (token === "-h" || token === "--help") args.help = true;
    else if (token === "-s" || token === "--self-test") args.selfTest = true;
    else fail(`Unknown argument: ${token}`);
  }
  if (args.help) {
    process.stdout.write(
      [
        "Usage: node scripts/obsidian-record-writer-e2e.cjs [OPTIONS]",
        "",
        "Offline record-writer acceptance against the real bob writer in an",
        "isolated Git-backed scratch vault. Never launches Obsidian.",
        "",
        "Options:",
        "  -h, --help          Print this help and exit",
        "  -s, --self-test     Run offline checks (no Obsidian needed)",
      ].join("\n") + "\n",
    );
    return;
  }
  if (args.selfTest) return selfTest();
  fail("no CDP walkthrough here: real-Obsidian Record Card proof lives in a later phase; rerun with -s/--self-test");
}

Promise.resolve(main(process.argv.slice(2))).catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
  process.exitCode = 1;
});
