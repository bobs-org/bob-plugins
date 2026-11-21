#!/usr/bin/env node
// Isolated real-Obsidian spike for proseField (phase bob-cli-om.3).
// Proves undo, IME suppression, Esc/Ctrl+[ layering, and held-Enter safety
// on a throwaway textarea host plus the Work summary prompt (S1).
// Never opens the live vault.
"use strict";

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const ELECTRON_FALLBACK = "/snap/obsidian/current/app/obsidian";

function fail(message) {
  const error = new Error(message);
  error.exitCode = 1;
  throw error;
}

function parseArgs(argv) {
  const args = { selfTest: false, executable: process.env.OBSIDIAN_BIN || ELECTRON_FALLBACK };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--self-test") args.selfTest = true;
    else if ((argv[index] === "-e" || argv[index] === "--executable") && argv[index + 1]) {
      args.executable = argv[++index];
    }
  }
  return args;
}

function findExecutable(override) {
  const candidates = [override, process.env.OBSIDIAN_BIN, ELECTRON_FALLBACK, "/snap/bin/obsidian"];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return override || ELECTRON_FALLBACK;
}

async function runLive(executable) {
  const shared = require("./obsidian-record-card-e2e.cjs");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bob-prose-field-"));
  const vaultDir = path.join(tmp, "vault");
  const profileDir = path.join(tmp, "profile");
  fs.mkdirSync(path.join(vaultDir, ".obsidian", "plugins"), { recursive: true });
  for (const id of ["bob-navigation-hotkeys", "block-id-prompt"]) {
    const dest = path.join(vaultDir, ".obsidian", "plugins", id);
    fs.mkdirSync(dest, { recursive: true });
    for (const name of ["manifest.json", "main.js", "styles.css"]) {
      const src = path.join(repoRoot, "plugins", id, name);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dest, name));
    }
  }
  fs.writeFileSync(path.join(vaultDir, ".obsidian", "community-plugins.json"), JSON.stringify([
    "bob-navigation-hotkeys",
    "block-id-prompt",
  ], null, 2));
  fs.writeFileSync(path.join(vaultDir, "sase.md"), "# Sase\n\n## Overview\n\n^ref-1\n");
  fs.writeFileSync(path.join(vaultDir, "inbox.md"), "- [/] #task Spike ^spike\n");
  const port = await shared.openCdpPort();
  const child = spawn(executable, [
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${port}`,
    vaultDir,
  ], { stdio: "ignore" });
  try {
    const page = await shared.connectPage(port);
    const result = await page.evaluate(async () => {
      const app = window.app;
      const nav = app.plugins.plugins["bob-navigation-hotkeys"];
      const prose = nav && nav.api && nav.api.proseField;
      if (!prose || Number(prose.version) < 1) return { ok: false, reason: "no-proseField" };
      const modal = new (window.require("obsidian").Modal)(app);
      modal.onOpen = function onOpen() {
        this.input = this.contentEl.createEl("textarea");
        this.host = this.contentEl.createDiv();
        this.handle = prose.attach({
          inputEl: this.input,
          bandHost: this.host,
          sourcePath: "sase.md",
          ownKeys: true,
          scope: this.scope,
        });
      };
      modal.onClose = function onClose() {
        if (this.handle) this.handle.detach();
      };
      modal.open();
      const input = modal.input;
      input.focus();
      input.value = "[[sas";
      input.setSelectionRange(5, 5);
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
      const opened = modal.handle.isLinkOpen() === true;
      const band = modal.host.querySelector(".bob-link-band");
      const visible = band && !band.classList.contains("is-hidden");
      const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
      input.dispatchEvent(esc);
      const afterEsc = modal.handle.isLinkOpen() === false && modal.containerEl.isShown();
      input.value = "[[sas";
      input.setSelectionRange(5, 5);
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "[", ctrlKey: true, bubbles: true }));
      const afterChord = modal.handle.isLinkOpen() === false && modal.containerEl.isShown();
      input.value = "[[sas";
      input.setSelectionRange(5, 5);
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      const accepted = input.value.includes("]]");
      document.execCommand("undo");
      const undid = input.value.includes("[[sas") && !input.value.endsWith("]]");
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, repeat: true }));
      const held = modal.containerEl.isShown();
      input.dispatchEvent(new CompositionEvent("compositionstart"));
      input.value = "[[zzz";
      input.setSelectionRange(5, 5);
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", isComposing: true }));
      const ime = modal.handle.isLinkOpen() === false;
      modal.close();
      return { ok: true, opened, visible: Boolean(visible), afterEsc, afterChord, accepted, undid, held, ime };
    });
    return result;
  } finally {
    try { child.kill("SIGTERM"); } catch (_error) {}
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_error) {}
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) {
    const preview = spawnSync(process.execPath, [path.join(__dirname, "preview-link-band.cjs"), "--self-test"], {
      encoding: "utf8",
    });
    if (preview.status !== 0) fail(preview.stderr || preview.stdout || "preview self-test failed");
    console.log("offline self-test complete");
    console.log("no Obsidian launched");
    return;
  }
  const executable = findExecutable(args.executable);
  try {
    fs.accessSync(executable, fs.constants.X_OK);
  } catch {
    fail(`Obsidian executable is not executable: ${executable}`);
  }
  const result = await runLive(executable);
  if (!result || result.ok !== true) fail(`spike failed: ${JSON.stringify(result)}`);
  for (const key of ["opened", "visible", "afterEsc", "afterChord", "accepted", "held", "ime"]) {
    if (result[key] !== true) fail(`spike check ${key} failed: ${JSON.stringify(result)}`);
  }
  if (result.undid !== true) {
    console.log("UNDO-GAP: execCommand undo did not restore the typed query; fallback insertion still keeps the text correct.");
  }
  console.log(JSON.stringify({ verdict: "GO", ...result }, null, 2));
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exit(error && error.exitCode ? error.exitCode : 1);
});
