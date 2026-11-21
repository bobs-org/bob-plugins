#!/usr/bin/env node
// Isolated real-Obsidian walkthrough for representative proseField hosts.
// The disposable vault/profile is always removed; the live vault is never opened.
"use strict";

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const shared = require("./obsidian-record-card-e2e.cjs");

const repoRoot = path.resolve(__dirname, "..");
const fallback = "/snap/obsidian/current/app/obsidian";
const cases = [
  { id: "S1-work-summary", tag: "input", mode: "inline", query: "Review [[#ove", target: "Overview" },
  { id: "S10-schedule-summary", tag: "input", mode: "inline", query: "Review [[#ove", target: "Overview" },
  { id: "S11-scheduled-reason", tag: "input", mode: "inline", query: "Review [[#ove", target: "Overview" },
  { id: "S14-reflection", tag: "textarea", mode: "inline", query: "Review [[#ove", target: "Overview" },
  { id: "S15-text", tag: "textarea", mode: "inline", query: "Review [[#ove", target: "Overview" },
  { id: "S15-link-stage", tag: "input", mode: "field", query: "sase", target: "Sase" },
];

function fail(message) { throw new Error(message); }

function parseArgs(argv) {
  const args = { selfTest: false, executable: process.env.OBSIDIAN_BIN || fallback, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--self-test") args.selfTest = true;
    else if ((argv[index] === "-e" || argv[index] === "--executable") && argv[index + 1]) args.executable = argv[++index];
    else if ((argv[index] === "-o" || argv[index] === "--out") && argv[index + 1]) args.out = path.resolve(argv[++index]);
    else if (argv[index] === "--help" || argv[index] === "-h") args.help = true;
    else throw new Error("Unknown argument: " + argv[index]);
  }
  return args;
}

function copyPlugin(vaultDir, id) {
  const source = path.join(repoRoot, "plugins", id);
  const target = path.join(vaultDir, ".obsidian", "plugins", id);
  fs.mkdirSync(target, { recursive: true });
  for (const name of ["manifest.json", "main.js", "styles.css"]) {
    const file = path.join(source, name);
    if (fs.existsSync(file)) fs.copyFileSync(file, path.join(target, name));
  }
}

async function live(executable, outDir) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bob-prose-field-"));
  const vaultDir = path.join(tmp, "vault");
  const profileDir = path.join(tmp, "profile");
  let child = null;
  let client = null;
  fs.mkdirSync(path.join(vaultDir, ".obsidian", "plugins"), { recursive: true });
  const pluginIds = ["bob-navigation-hotkeys", "block-id-prompt", "bob-ledger-tools", "bob-mail"];
  for (const id of pluginIds) copyPlugin(vaultDir, id);
  fs.writeFileSync(path.join(vaultDir, ".obsidian", "community-plugins.json"), JSON.stringify(pluginIds, null, 2));
  fs.writeFileSync(path.join(vaultDir, ".obsidian", "app.json"), JSON.stringify({ showLineNumber: false }));
  fs.writeFileSync(path.join(vaultDir, "sase.md"), [
    "# Sase", "", "## Overview", "", "## Other", "", "Walkthrough reference note.", "",
  ].join("\n"));
  try {
    const port = await shared.freePort();
    child = spawn(executable, [
      "--no-sandbox", `--user-data-dir=${profileDir}`, `--remote-debugging-port=${port}`,
      "--remote-allow-origins=http://127.0.0.1/*", vaultDir,
    ], { stdio: "ignore", env: { ...process.env, HOME: profileDir } });
    const target = await shared.selectTarget(port, vaultDir, () => child && child.exitCode == null);
    client = target.client;
    await client.call("Runtime.enable");
    await client.call("Page.enable");
    const ready = await client.evaluate(`(async () => {
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        const plugin = window.app?.plugins?.plugins?.["bob-navigation-hotkeys"];
        const cache = window.app?.metadataCache?.getCache?.("sase.md");
        if (plugin?.api?.proseField?.version >= 1 && cache?.headings?.some((h) => h.heading === "Overview")) return true;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return false;
    })()`);
    if (ready !== true) fail("Obsidian did not load nav proseField and the fixture heading index");

    const results = [];
    for (const surface of cases) {
      const setup = await client.evaluate(`(() => {
        const app = window.app;
        const nav = app.plugins.plugins["bob-navigation-hotkeys"];
        const modal = new (window.require("obsidian").Modal)(app);
        modal.submits = 0;
        modal.onOpen = function () {
          this.contentEl.createDiv({ text: ${JSON.stringify(surface.id)} });
          this.field = this.contentEl.createEl(${JSON.stringify(surface.tag)});
          this.field.setAttribute("aria-label", ${JSON.stringify(surface.id)});
          this.field.addEventListener("keydown", (event) => {
            if (event.key === "Enter" && !event.defaultPrevented) this.submits += 1;
          });
          this.bandHost = this.contentEl.createDiv();
          this.handle = nav.api.proseField.attach({
            inputEl: this.field,
            bandHost: this.bandHost,
            sourcePath: "sase.md",
            ownKeys: true,
            mode: ${JSON.stringify(surface.mode)},
          });
        };
        modal.onClose = function () { this.handle?.detach(); };
        modal.open();
        window.__bobProseWalk = modal;
        const field = modal.field;
        field.focus();
        field.value = ${JSON.stringify(surface.query)};
        field.setSelectionRange(field.value.length, field.value.length);
        field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
        return { opened: modal.handle.isLinkOpen(), value: field.value };
      })()`);
      if (!setup || setup.opened !== true) fail(`${surface.id}: typing [[ did not open the LINK band`);
      await new Promise((resolve) => setTimeout(resolve, 350));
      const visible = await client.evaluate(`(() => {
        const modal = window.__bobProseWalk;
        const band = modal?.bandHost?.querySelector?.(".bob-link-band");
        const rows = Array.from(band?.querySelectorAll?.(".bob-link-band-row:not(.is-empty)") || []);
        return { shown: Boolean(band && !band.classList.contains("is-hidden")), rows: rows.map((row) => row.innerText || row.textContent || "") };
      })()`);
      if (!visible?.shown || !visible.rows.some((row) => row.includes(surface.target))) fail(`${surface.id}: filtered target row missing: ${JSON.stringify(visible)}`);
      const screenshot = await shared.capture(client, outDir, surface.id, 1280, "moonstone", "link-band");

      const finished = await client.evaluate(`(async () => {
        const app = window.app;
        const modal = window.__bobProseWalk;
        const field = modal.field;
        const send = (key, options = {}) => field.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options }));
        send("Enter");
        const accepted = field.value;
        const enterPrevented = accepted.includes("]]" ) && modal.submits === 0;
        document.execCommand("undo");
        const undoRestored = field.value === ${JSON.stringify(surface.query)};
        field.value = ${JSON.stringify(surface.query)};
        field.setSelectionRange(field.value.length, field.value.length);
        field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
        await new Promise((resolve) => setTimeout(resolve, 200));
        send("Enter");
        send("Enter", { repeat: true });
        const heldEnterSafe = modal.submits === 0 && modal.containerEl.isShown();
        field.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
        field.value = ${JSON.stringify(surface.query)};
        field.setSelectionRange(field.value.length, field.value.length);
        field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
        await new Promise((resolve) => setTimeout(resolve, 200));
        send("Escape");
        const escLayers = modal.handle.isLinkOpen() === false && modal.containerEl.isShown();
        const savedPath = "prose-walkthrough-${surface.id}.md";
        await app.vault.create(savedPath, accepted + "\\n");
        const savedText = await app.vault.read(app.vault.getAbstractFileByPath(savedPath));
        modal.close();
        return { accepted, enterPrevented, undoRestored, heldEnterSafe, escLayers, savedPath, savedText };
      })()`);
      if (!finished?.enterPrevented || !finished.undoRestored || !finished.heldEnterSafe || !finished.escLayers) {
        fail(`${surface.id}: acceptance, undo, Enter safety, or Escape layering failed: ${JSON.stringify(finished)}`);
      }
      if (!finished.savedText.includes("]]")) fail(`${surface.id}: accepted link was not written into its disposable note`);
      results.push({ id: surface.id, ...finished, screenshot });
    }
    return { verdict: "GO", vaultDir, results };
  } finally {
    try { client?.close?.(); } catch (_) {}
    try { child?.kill("SIGTERM"); } catch (_) {}
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node scripts/obsidian-prose-field-e2e.cjs [-e OBSIDIAN] [-o SCREENSHOT_DIR] [--self-test]");
    return;
  }
  if (args.selfTest) {
    if (!cases.some((item) => item.id === "S15-link-stage" && item.mode === "field")) fail("field-mode walkthrough case missing");
    console.log("offline self-test complete");
    console.log("no Obsidian launched");
    return;
  }
  const executable = args.executable;
  try { fs.accessSync(executable, fs.constants.X_OK); }
  catch (_) { fail(`Obsidian executable is not executable: ${executable}. Set OBSIDIAN_BIN or pass --executable.`); }
  const outDir = args.out || path.join(repoRoot, "artifacts", "prose-field-walkthrough");
  fs.mkdirSync(outDir, { recursive: true });
  const result = await live(executable, outDir);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exitCode = 1;
});
