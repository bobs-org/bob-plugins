#!/usr/bin/env node
// Verify a trusted Tab key opens Command Mode argument mode in real Obsidian.
"use strict";

const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const PLUGIN_ID = "bob-command-mode";
const CATALOG = {
  schema_version: 1,
  ok: true,
  bob_version: "e2e",
  features: [],
  sections: [{ id: "e2e", title: "E2E" }],
  aliases: [],
  excluded: [],
  entries: [{
    id: "e2e-argument-fixture",
    path: ["e2e", "echo"],
    fixed: [],
    title: "Argument fixture",
    about: "Command Mode Tab routing fixture",
    section: "e2e",
    keywords: ["argument", "fixture"],
    effect: "reads",
    network: false,
    presentation: "action",
    policy: "run",
    preview: [],
    confirm: null,
    budget_secs: 60,
    args: [],
    exit_codes: [],
    adapter: null,
    hosts: [],
    invalidates: [],
  }],
};

function parseArgs(argv) {
  const args = { executable: null, help: false, selfTest: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "-e" || token === "--executable") {
      const value = argv[++index];
      if (!value || value.startsWith("-")) throw new Error("--executable requires a PATH");
      args.executable = value;
    } else if (token === "-h" || token === "--help") args.help = true;
    else if (token === "-s" || token === "--self-test") args.selfTest = true;
    else throw new Error("Unknown argument: " + token);
  }
  return args;
}

function findExecutable(override) {
  if (override) return override;
  return process.env.OBSIDIAN_BIN || "/snap/bin/obsidian";
}

function probeExecutable(executable) {
  try {
    fs.accessSync(executable, fs.constants.X_OK);
  } catch {
    return { ok: false, reason: "Obsidian executable is unavailable: " + executable };
  }
  const result = spawnSync(executable, ["--help"], { encoding: "utf8", timeout: 20_000 });
  if (/unable to find Obsidian/i.test(String(result.stdout || "") + String(result.stderr || ""))) {
    return { ok: false, reason: "executable is the Obsidian CLI shim, not Electron: " + executable };
  }
  return { ok: true };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function focusScratchObsidianWindow(windowTitle) {
  const found = spawnSync("xdotool", ["search", "--onlyvisible", "--name", windowTitle], { encoding: "utf8", timeout: 10_000 });
  if (found.error || found.status !== 0 || !String(found.stdout || "").trim()) {
    throw new Error("could not find the scratch Obsidian window for a trusted Tab keypress: " + (found.stderr || found.error || "no matching window"));
  }
  const windowId = String(found.stdout).trim().split(/\s+/).at(-1);
  const focused = spawnSync("xdotool", ["windowfocus", "--sync", windowId], { encoding: "utf8", timeout: 10_000 });
  if (focused.error || focused.status !== 0) {
    throw new Error("could not focus the scratch Obsidian window: " + (focused.stderr || focused.error || "xdotool failed"));
  }
  return { windowTitle, windowId };
}

function dispatchTrustedTab() {
  const pressed = spawnSync("xdotool", ["key", "--clearmodifiers", "Tab"], { encoding: "utf8", timeout: 10_000 });
  if (pressed.error || pressed.status !== 0) {
    throw new Error("could not send a trusted Tab keypress: " + (pressed.stderr || pressed.error || "xdotool failed"));
  }
  return true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function seedProfileVault(profileDir, vaultPath) {
  const id = crypto.randomBytes(8).toString("hex");
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, "obsidian.json"), JSON.stringify({
    vaults: { [id]: { path: vaultPath, ts: Date.now(), open: true } },
  }, null, 2));
}

function installFixture(vaultDir, scratchDir) {
  const obsidianDir = path.join(vaultDir, ".obsidian");
  const pluginDir = path.join(obsidianDir, "plugins", PLUGIN_ID);
  fs.mkdirSync(pluginDir, { recursive: true });
  for (const file of ["manifest.json", "main.js", "styles.css"]) {
    const source = path.join(ROOT, "plugins", PLUGIN_ID, file);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(pluginDir, file));
  }
  fs.writeFileSync(path.join(obsidianDir, "community-plugins.json"), JSON.stringify([PLUGIN_ID], null, 2));
  fs.writeFileSync(path.join(obsidianDir, "app.json"), JSON.stringify({ livePreview: true }, null, 2));
  fs.writeFileSync(path.join(pluginDir, "data.json"), JSON.stringify({
    settings: { bobPath: path.join(scratchDir, "bob-stub"), osNotifications: false },
  }, null, 2));

  const catalogText = JSON.stringify(CATALOG);
  const stub = [
    "#!/bin/sh",
    'if [ "$1" = "__catalog" ]; then',
    "  cat <<'BOB_CATALOG'",
    catalogText,
    "BOB_CATALOG",
    'elif [ "$1" = "__complete" ]; then',
    "  printf 'north\\tNorth candidate\\tValues\\tspace\\nsouth\\tSouth candidate\\tValues\\tspace\\n'",
    "fi",
    "",
  ].join("\n");
  const stubPath = path.join(scratchDir, "bob-stub");
  fs.writeFileSync(stubPath, stub, { mode: 0o755 });
  fs.chmodSync(stubPath, 0o755);
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener("message", (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (!message.id || !this.pending.has(message.id)) return;
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      else pending.resolve(message.result || {});
    });
    socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("CDP socket closed"));
      }
      this.pending.clear();
    });
  }

  static async connect(endpoint) {
    let WebSocketClient = globalThis.WebSocket;
    if (typeof WebSocketClient !== "function") {
      try { WebSocketClient = require("undici").WebSocket; } catch { WebSocketClient = null; }
    }
    if (!WebSocketClient) throw new Error("Node WebSocket support is required");
    const socket = new WebSocketClient(endpoint);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP connect timed out")), 15_000);
      socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("CDP connect failed")); }, { once: true });
    });
    return new CdpClient(socket);
  }

  call(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(method + " timed out"));
      }, 10_000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.call("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (response.exceptionDetails) {
      const details = response.exceptionDetails;
      throw new Error((details.exception && details.exception.description) || details.text || "Runtime.evaluate failed");
    }
    return response.result && response.result.value;
  }

  close() {
    try { this.socket.close(); } catch { /* Already closed. */ }
  }
}

async function waitFor(client, expression, predicate, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await client.evaluate(expression);
      if (predicate(last)) return last;
    } catch (error) {
      last = String(error && error.message || error);
    }
    await sleep(100);
  }
  throw new Error("timed out waiting for " + label + ": " + JSON.stringify(last));
}

async function connectToOwnedPage(port, vaultPath) {
  const deadline = Date.now() + 30_000;
  let lastError = "";
  while (Date.now() < deadline) {
    let client = null;
    try {
      const response = await fetch("http://127.0.0.1:" + port + "/json/list");
      const targets = await response.json();
      const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
      if (page) {
        client = await CdpClient.connect(page.webSocketDebuggerUrl);
        const pathValue = await client.evaluate(`(() => {
          const adapter = window.app && window.app.vault && window.app.vault.adapter;
          return adapter && (adapter.basePath || (adapter.getBasePath && adapter.getBasePath())) || null;
        })()`);
        if (pathValue && path.resolve(pathValue) === path.resolve(vaultPath)) return client;
      }
    } catch (error) {
      lastError = String(error && error.message || error);
    }
    if (client) client.close();
    await sleep(250);
  }
  throw new Error("no CDP page target opened the scratch vault" + (lastError ? ": " + lastError : ""));
}

async function dismissTrustModal(client) {
  const state = await waitFor(client, `(() => {
    const button = Array.from(document.querySelectorAll("button"))
      .find((item) => /Trust author and enable plugins/i.test(item.textContent || ""));
    const plugin = window.app && window.app.plugins && window.app.plugins.plugins
      && window.app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    return { trustButton: Boolean(button), pluginLoaded: Boolean(plugin) };
  })()`,
  (value) => value && (value.trustButton || value.pluginLoaded),
  "vault trust prompt or plugin load",
  30_000);
  if (!state.trustButton) return false;
  const clicked = await client.evaluate(`(() => {
    const button = Array.from(document.querySelectorAll("button"))
      .find((item) => /Trust author and enable plugins/i.test(item.textContent || ""));
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error("Obsidian trust prompt disappeared before it could be accepted");
  await waitFor(client, `(() => {
    const trustButton = Array.from(document.querySelectorAll("button"))
      .some((item) => /Trust author and enable plugins/i.test(item.textContent || ""));
    const plugin = window.app && window.app.plugins && window.app.plugins.plugins
      && window.app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    return { trustButton, pluginLoaded: Boolean(plugin) };
  })()`,
  (value) => value && !value.trustButton && value.pluginLoaded,
  "trusted Command Mode plugin load",
  30_000);
  return true;
}

function report(status, fields = {}) {
  const result = { status, pass: status === "passed", ...fields };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function runE2e(args) {
  const executable = findExecutable(args.executable);
  const probe = probeExecutable(executable);
  if (!probe.ok) return report("skipped", { reason: probe.reason });
  if (!process.env.DISPLAY && !process.env.XVFB_RUN_TMPDIR) {
    return report("skipped", { reason: "no X display; rerun under xvfb-run -a" });
  }
  const xdotoolProbe = spawnSync("xdotool", ["version"], { encoding: "utf8", timeout: 10_000 });
  if (xdotoolProbe.error || xdotoolProbe.status !== 0) {
    return report("skipped", { reason: "xdotool is required to send a trusted Tab keypress to the real Obsidian window" });
  }

  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "bob-command-mode-tab-"));
  const vaultName = "bob-command-mode-tab-" + crypto.randomBytes(6).toString("hex");
  const vaultDir = path.join(scratchDir, vaultName);
  const profileDir = path.join(scratchDir, "profile");
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(profileDir, { recursive: true });
  installFixture(vaultDir, scratchDir);
  const vaultPath = fs.realpathSync(vaultDir);
  seedProfileVault(profileDir, vaultPath);

  const port = await freePort();
  const child = spawn(executable, [
    "--no-sandbox",
    "--user-data-dir=" + profileDir,
    "--remote-debugging-port=" + port,
    "--remote-allow-origins=http://127.0.0.1/*",
    vaultPath,
  ], {
    cwd: vaultPath,
    detached: process.platform !== "win32",
    env: (() => {
      const env = { ...process.env, BOB_DIR: vaultPath, TMPDIR: os.tmpdir() };
      delete env.ELECTRON_RUN_AS_NODE;
      return env;
    })(),
    stdio: "ignore",
  });
  let client = null;
  let modalClient = null;
  let trustButtonClicked = false;
  let openResult = null;
  let focusResult = null;
  let tabDispatch = null;
  try {
    client = await connectToOwnedPage(port, vaultPath);
    trustButtonClicked = await dismissTrustModal(client);
    await waitFor(client,
      `(() => { const app = window.app; const manager = app && app.plugins; const plugin = manager && manager.plugins && manager.plugins[${JSON.stringify(PLUGIN_ID)}]; const catalog = plugin && plugin.commandModeCatalog; const manifest = manager && manager.manifests && manager.manifests[${JSON.stringify(PLUGIN_ID)}]; return { configDir: app && app.vault && app.vault.configDir, pluginLoaded: Boolean(plugin), enabled: Boolean(manager && manager.enabledPlugins && manager.enabledPlugins.has(${JSON.stringify(PLUGIN_ID)})), manifest: manifest && { id: manifest.id, name: manifest.name, version: manifest.version, minAppVersion: manifest.minAppVersion }, pluginKeys: manager && manager.plugins ? Object.keys(manager.plugins) : [], state: plugin && plugin.commandModeState, bobPath: plugin && plugin.settings && plugin.settings.bobPath, catalogOk: Boolean(catalog && catalog.ok), entryIds: catalog && Array.isArray(catalog.entries) ? catalog.entries.map((entry) => entry.id) : [], bodyText: String(document.body && document.body.innerText || "").slice(0, 500), buttons: Array.from(document.querySelectorAll("button")).map((button) => String(button.textContent || "").trim()).filter(Boolean).slice(0, 12) }; })()`,
      (value) => value && value.entryIds.includes("e2e-argument-fixture"),
      "Command Mode stub catalog",
    );

    openResult = await client.evaluate(`(() => {
      const app = window.app;
      const id = ${JSON.stringify(PLUGIN_ID + ":open")};
      const commands = app && app.commands && app.commands.commands || {};
      const command = commands[id];
      const dispatched = app && app.commands && app.commands.executeCommandById(id);
      return { id, commandFound: Boolean(command), dispatched, commandKeys: Object.keys(commands).filter((key) => key.includes(${JSON.stringify(PLUGIN_ID)})) };
    })()`);
    await waitFor(client, `(() => {
      const plugin = window.app && window.app.plugins && window.app.plugins.plugins && window.app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      const sheet = plugin && plugin.commandModeSheet;
      const input = sheet && sheet.inputEl;
      const content = sheet && sheet.contentEl;
      return { input: Boolean(input), connected: Boolean(input && input.isConnected), sheetOpen: Boolean(sheet && sheet.sheetOpen), stage: sheet && sheet.stage, contentHtml: content && String(content.innerHTML || "").slice(0, 1000), documentUrl: location.href };
    })()`, (value) => value && value.input && value.connected, "Command Mode sheet");
    await client.evaluate(`(() => {
      const sheet = window.app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].commandModeSheet;
      sheet.inputEl.value = "argument fixture";
      sheet.inputEl.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
    await waitFor(client,
      `(() => { const plugin = window.app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}]; const sheet = plugin && plugin.commandModeSheet; const row = sheet && sheet.selectedRow && sheet.selectedRow(); return { query: sheet && sheet.query, rowKind: row && row.kind, entryId: row && row.entryId }; })()`,
      (value) => value && value.query === "argument fixture" && value.rowKind === "entry" && value.entryId === "e2e-argument-fixture",
      "selected catalog entry",
    );
    focusResult = await client.evaluate(`(() => {
      const sheet = window.app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].commandModeSheet;
      const original = sheet.handleSheetKeydown;
      sheet.handleSheetKeydown = function (event) {
        const result = original.call(this, event);
        window.__bobCommandModeTabEvent = { key: event.key, isTrusted: event.isTrusted, target: event.target && event.target.tagName, result, stage: this.stage };
        return result;
      };
      const ownerDocument = sheet.inputEl.ownerDocument;
      return { ownerTitle: ownerDocument && ownerDocument.title, ownerUrl: ownerDocument && ownerDocument.URL };
    })()`);
    focusResult.debugTargets = (await (await fetch("http://127.0.0.1:" + port + "/json/list")).json())
      .filter((target) => target.type === "page")
      .map((target) => ({ title: target.title, url: target.url, id: target.id, debugger: target.webSocketDebuggerUrl }));
    const modalTarget = focusResult.debugTargets.find((target) => target.title === focusResult.ownerTitle);
    if (!modalTarget) throw new Error("CDP did not expose the Obsidian document that owns the Command Mode modal: " + JSON.stringify(focusResult.debugTargets));
    focusResult.modalTarget = { title: modalTarget.title, url: modalTarget.url, id: modalTarget.id };
    modalClient = await CdpClient.connect(modalTarget.debugger);
    try { await modalClient.call("Page.bringToFront"); } catch { /* xvfb may ignore */ }
    const focusedInModal = await modalClient.evaluate(`(() => {
      const input = document.querySelector(".bob-cmd-sheet-input");
      if (!input) return false;
      input.focus();
      return document.activeElement === input;
    })()`);
    if (!focusedInModal) throw new Error("could not focus the Command Mode input in its owning Obsidian document");
    tabDispatch = focusScratchObsidianWindow(modalTarget.title);
    const focusedAfterWindowRaise = await modalClient.evaluate(`(() => {
      const input = document.querySelector(".bob-cmd-sheet-input");
      if (!input) return false;
      input.focus();
      return document.activeElement === input;
    })()`);
    if (!focusedAfterWindowRaise) throw new Error("Command Mode input lost focus while raising its Obsidian window");
    dispatchTrustedTab();
    const rendered = await waitFor(client, `(() => {
      const plugin = window.app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      const sheet = plugin && plugin.commandModeSheet;
      const input = sheet && sheet.inputEl;
      const pill = sheet && sheet.contentEl && sheet.contentEl.querySelector(".bob-cmd-stage-pill");
      return {
        stage: sheet && sheet.stage,
        query: sheet && sheet.query,
        placeholder: input && input.getAttribute("placeholder"),
        stagePill: pill && pill.textContent,
        tabEvent: window.__bobCommandModeTabEvent || null,
      };
    })()`,
    (value) => value && value.stage === "args" && value.placeholder === "Arguments…" && value.stagePill === "e2e echo" && value.tabEvent && value.tabEvent.isTrusted === true,
    "rendered argument stage",
    8_000);
    return report("passed", { executable, vault: vaultPath, key: "trusted Tab", tabDispatch, rendered });
  } catch (error) {
    report("failed", { executable, trustButtonClicked, openResult, focusResult, tabDispatch, error: String(error && error.stack || error) });
    process.exitCode = 1;
    return null;
  } finally {
    if (client) client.close();
    if (modalClient) modalClient.close();
    try {
      if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGTERM");
      else child.kill("SIGTERM");
    } catch { /* The owned process already exited. */ }
    await sleep(300);
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }
}

function selfTest() {
  if (CATALOG.entries.length !== 1 || CATALOG.entries[0].path.join(" ") !== "e2e echo") {
    throw new Error("fixture catalog is not the minimal argument-mode fixture");
  }
  console.log("offline self-test complete");
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log("Usage: node scripts/obsidian-command-mode-tab-e2e.cjs [--executable PATH] [--self-test]");
      return;
    }
    if (args.selfTest) return selfTest();
    await runE2e(args);
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  }
}

if (require.main === module) void main();

module.exports = { CATALOG, parseArgs, probeExecutable, runE2e };
