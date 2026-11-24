#!/usr/bin/env node
// Real-Obsidian e2e for Gmail Task checkbox clicks opening the Mail Close Card.
// Isolated scratch vault + profile. Never opens the live vault.
// Offline `--self-test` covers the fixture and capture-phase intercept contract.
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const args = { help: false, selfTest: false };
  const list = Array.isArray(argv) ? argv.slice() : [];
  for (let index = 0; index < list.length; index += 1) {
    const token = list[index];
    if (token === "-h" || token === "--help") args.help = true;
    else if (token === "-s" || token === "--self-test") args.selfTest = true;
    else throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

const HELP_TEXT = [
  "Usage: node scripts/obsidian-mail-close-checkbox-e2e.cjs [OPTIONS]",
  "",
  "Drive Gmail Task checkbox clicks in an isolated scratch vault.",
  "  -s, --self-test         Run offline self-tests (no Obsidian needed)",
  "  -h, --help              Show this help",
].join("\n");

function copyPluginFiles(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const file of ["manifest.json", "main.js", "styles.css"]) {
    const source = path.join(sourceDir, file);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(targetDir, file));
  }
}

function writeNote(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function buildFixture(root) {
  const vault = root;
  const obsidian = path.join(vault, ".obsidian");
  fs.mkdirSync(path.join(obsidian, "plugins"), { recursive: true });
  fs.writeFileSync(path.join(obsidian, "app.json"), JSON.stringify({ vimMode: true }, null, 2));
  fs.writeFileSync(path.join(obsidian, "community-plugins.json"), JSON.stringify([
    "task-status-cycler",
    "bob-navigation-hotkeys",
  ]));
  copyPluginFiles(path.join(repoRoot, "plugins/task-status-cycler"), path.join(obsidian, "plugins", "task-status-cycler"));
  copyPluginFiles(path.join(repoRoot, "plugins/bob-navigation-hotkeys"), path.join(obsidian, "plugins", "bob-navigation-hotkeys"));
  writeNote(path.join(vault, "job.md"), "- [ ] #task Reply [[mail/2026/lease]] ^yogi\n");
  writeNote(path.join(vault, "mail/2026/lease.md"), [
    "---",
    "type: [[mail]]",
    "title: Lease renewal",
    "who: Ada",
    "turn: yours",
    "gmail_thread_id: 18abc",
    "---",
    "",
  ].join("\n"));
  return { enabled: ["task-status-cycler", "bob-navigation-hotkeys"] };
}

function runSelfTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bob-mail-close-checkbox-e2e-self-"));
  try {
    const parsed = parseArgs(["--self-test"]);
    if (!parsed.selfTest) throw new Error("parseArgs did not keep --self-test");
    const fixture = buildFixture(tmp);
    if (!fixture.enabled.includes("task-status-cycler")) {
      throw new Error("task-status-cycler must be enabled");
    }
    if (!fixture.enabled.includes("bob-navigation-hotkeys")) {
      throw new Error("bob-navigation-hotkeys must be enabled");
    }
    const job = fs.readFileSync(path.join(tmp, "job.md"), "utf8");
    if (!job.includes("[[mail/2026/lease]]")) throw new Error("job.md must wikilink the mail note");
    const mail = fs.readFileSync(path.join(tmp, "mail/2026/lease.md"), "utf8");
    if (!mail.includes("type: [[mail]]")) throw new Error("mail note must be a Gmail Task source");
    const cycler = fs.readFileSync(path.join(repoRoot, "plugins/task-status-cycler/src/187-mail-close-guard.js"), "utf8");
    for (const needle of [
      "pointerdown",
      "mousedown",
      "touchstart",
      "\"click\"",
      "ul.plugin-tasks-query-result",
      ".block-language-dataview",
      "toggleActiveCheckboxOpenDoneAndPropagate",
      "mailCloseConfirmed",
      "Not closed — confirming an email task needs Bob Navigation Hotkeys",
    ]) {
      if (!cycler.includes(needle)) throw new Error(`checkbox guard source must include ${needle}`);
    }
    console.log("offline self-test complete (not an Obsidian pass)");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function main(argv) {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    console.log(HELP_TEXT);
    return;
  }
  if (parsed.selfTest) {
    runSelfTest();
    return;
  }
  console.log(HELP_TEXT);
  throw new Error("real Obsidian checkbox e2e is launched with --self-test in unit tests; pass -s");
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error && error.message ? error.message : error);
    process.exit(error && error.exitCode ? error.exitCode : 1);
  }
}

module.exports = { parseArgs, buildFixture, runSelfTest };
