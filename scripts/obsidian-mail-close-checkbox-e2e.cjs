#!/usr/bin/env node
// Real-Obsidian e2e for Gmail Task checkbox clicks opening the Mail Close Card.
// Isolated scratch vault + profile, owned Obsidian process, CDP probes.
// Never opens the live vault. Follows scripts/obsidian-decay-ladder-e2e.cjs.
//
//   xvfb-run -a node scripts/obsidian-mail-close-checkbox-e2e.cjs [--out DIR] [-e PATH] [-r REPORT]
//   node scripts/obsidian-mail-close-checkbox-e2e.cjs --self-test
"use strict";

const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const lib = require("./obsidian-startup-smoke-lib.cjs");

const OVERALL_TIMEOUT_MS = 360_000;

const TASKS_DATA = {
  globalFilter: "#task",
  taskFormat: "dataview",
  statusSettings: {
    coreStatuses: [
      { symbol: " ", name: "Ready", type: "TODO" },
      { symbol: "x", name: "Done", type: "DONE" },
    ],
    customStatuses: [
      { symbol: "*", name: "Next", type: "ON_HOLD" },
      { symbol: "?", name: "Blocked", type: "TODO" },
      { symbol: "/", name: "In Progress", type: "IN_PROGRESS" },
      { symbol: "-", name: "Canceled", type: "CANCELLED" },
    ],
  },
};

const HELP_TEXT = [
  "Usage: node scripts/obsidian-mail-close-checkbox-e2e.cjs [OPTIONS]",
  "",
  "Drive Gmail Task checkbox clicks in an isolated scratch vault through CDP.",
  "Never opens the live vault. Run under xvfb-run -a on Linux.",
  "",
  "Options:",
  "  -e, --executable PATH   Obsidian executable (default: /snap/bin/obsidian)",
  "  -h, --help              Print this help and exit",
  "  -o, --out DIRECTORY     Screenshot output directory",
  "  -r, --report PATH       Write the structured JSON report to PATH",
  "  -s, --self-test         Run offline self-tests (no Obsidian needed)",
].join("\n");

function parseArgs(argv) {
  const args = { executable: null, help: false, out: null, report: null, selfTest: false };
  const list = Array.isArray(argv) ? argv.slice() : [];
  for (let index = 0; index < list.length; index += 1) {
    const token = list[index];
    if (token === "-e" || token === "--executable" || token === "--obsidian-bin") {
      const value = list[++index];
      if (!value || value.startsWith("-")) throw new Error("--executable requires a PATH value");
      args.executable = value;
    } else if (token === "-h" || token === "--help") {
      args.help = true;
    } else if (token === "-o" || token === "--out") {
      const value = list[++index];
      if (!value || value.startsWith("-")) throw new Error("--out requires a DIRECTORY value");
      args.out = value;
    } else if (token === "-r" || token === "--report") {
      const value = list[++index];
      if (!value || value.startsWith("-")) throw new Error("--report requires a PATH value");
      args.report = value;
    } else if (token === "-s" || token === "--self-test") {
      args.selfTest = true;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
}

function fail(message, code) {
  const error = new Error(message);
  error.exitCode = code || 1;
  throw error;
}

function findExecutable(override) {
  const candidates = [];
  if (override) candidates.push(override);
  if (process.env.OBSIDIAN_BIN) candidates.push(process.env.OBSIDIAN_BIN);
  candidates.push("/snap/bin/obsidian");
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Keep looking.
    }
  }
  return candidates[0] || "/snap/bin/obsidian";
}

function probeExecutable(executable) {
  try {
    fs.accessSync(executable, fs.constants.X_OK);
  } catch {
    return { ok: false, reason: `Obsidian executable is not executable: ${executable}` };
  }
  return { ok: true };
}

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

function readExpectedPlugins() {
  const pluginsDir = path.join(repoRoot, "plugins");
  const expected = [];
  for (const entry of fs.readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(pluginsDir, entry.name, "manifest.json");
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      if (manifest && typeof manifest.id === "string") expected.push({ id: manifest.id });
    } catch {
      // Build gate owns malformed manifests.
    }
  }
  expected.sort((a, b) => a.id.localeCompare(b.id));
  return expected;
}

function buildFixture(root) {
  const vault = root;
  const obsidian = path.join(vault, ".obsidian");
  fs.mkdirSync(path.join(obsidian, "plugins"), { recursive: true });
  fs.writeFileSync(path.join(obsidian, "app.json"), JSON.stringify({ vimMode: true, livePreview: true }, null, 2));
  const enabled = [];
  for (const plugin of readExpectedPlugins()) {
    if (plugin.id === "task-status-cycler" || plugin.id === "bob-navigation-hotkeys") {
      copyPluginFiles(path.join(repoRoot, "plugins", plugin.id), path.join(obsidian, "plugins", plugin.id));
      enabled.push(plugin.id);
    }
  }
  fs.writeFileSync(path.join(obsidian, "community-plugins.json"), JSON.stringify(enabled, null, 2));
  fs.writeFileSync(path.join(obsidian, "core-plugins.json"), JSON.stringify(["file-explorer"], null, 2));
  writeNote(path.join(vault, "job.md"), "- [ ] #task Reply [[mail/2026/lease]] ^yogi\n");
  writeNote(path.join(vault, "mail/2026/lease.md"), [
    "---",
    "type: [[mail]]",
    "title: Lease renewal",
    "who: Ada",
    "turn: yours",
    "turn_since: 2026-11-07T14:00:00",
    "gmail_url: https://mail.google.com/mail/u/0/#inbox/abc123",
    "gmail_thread_id: 18abc",
    "---",
    "",
  ].join("\n"));
  return { enabled };
}

function seedProfileVault(profileDir, vaultRealPath) {
  const id = crypto.randomBytes(8).toString("hex");
  const payload = { vaults: { [id]: { path: vaultRealPath, ts: Date.now(), open: true } } };
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, "obsidian.json"), JSON.stringify(payload, null, 2));
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;
    socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (pending.timer) clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message || "cdp error"}`));
        else pending.resolve(message.result || {});
      }
    });
    socket.addEventListener("close", () => {
      this.closed = true;
      for (const [, pending] of this.pending) {
        if (pending.timer) clearTimeout(pending.timer);
        pending.reject(new Error(`${pending.method}: CDP socket closed`));
      }
      this.pending.clear();
    });
  }

  static connect(endpoint, timeoutMs) {
    let WS = typeof globalThis.WebSocket === "function" ? globalThis.WebSocket : null;
    if (!WS) {
      try {
        WS = require("undici").WebSocket;
      } catch {
        WS = null;
      }
    }
    if (!WS) throw new Error("WebSocket is required for the CDP client (Node 22+ or undici)");
    return lib.withTimeout(new Promise((resolve, reject) => {
      let socket;
      try {
        socket = new WS(endpoint);
      } catch (error) {
        reject(error);
        return;
      }
      socket.addEventListener("open", () => resolve(new CdpClient(socket)), { once: true });
      socket.addEventListener("error", (event) => reject(new Error(`CDP connect failed`)), { once: true });
    }), timeoutMs || lib.CONNECT_TIMEOUT_MS, "CDP connect");
  }

  call(method, params, timeoutMs) {
    if (this.closed) return Promise.reject(new Error(`${method}: CDP socket is closed`));
    const id = this.nextId++;
    return lib.withTimeout(new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs || lib.RPC_TIMEOUT_MS);
      if (timer && typeof timer.unref === "function") timer.unref();
      this.pending.set(id, { resolve, reject, method, timer });
      try {
        this.socket.send(JSON.stringify({ id, method, params: params || {} }));
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    }), (timeoutMs || lib.RPC_TIMEOUT_MS) + 1000, method);
  }

  evaluate(expression, timeoutMs) {
    return this.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true }, timeoutMs)
      .then((response) => {
        if (response.exceptionDetails) throw new Error("Runtime.evaluate failed");
        return response.result && response.result.value;
      });
  }

  close() {
    try {
      this.socket.close();
    } catch {
      // Best effort.
    }
  }
}

const VAULT_PATH_PROBE = `(() => { try {
  const app = window.app;
  const adapter = app && app.vault && app.vault.adapter;
  if (adapter && typeof adapter.basePath === "string" && adapter.basePath) return adapter.basePath;
  return null;
} catch { return null; } })()`;

const MAIL_CARD_PROBE = `(() => { try {
  const app = window.app;
  const doc = app && app.workspace && app.workspace.containerEl && app.workspace.containerEl.ownerDocument;
  const root = (doc || document).querySelector(".bob-mail-close-card");
  if (!root) return { open: false };
  const title = (root.querySelector(".bob-mail-close-title") || {}).textContent || "";
  const footer = (root.querySelector(".bob-mail-close-footer") || {}).textContent || "";
  return { open: true, title: String(title).trim(), footer: String(footer).trim() };
} catch (e) { return { open: false, error: String(e && e.message || e) }; } })()`;

const FOCUS_FIX_PROBE = `(() => { try {
  const app = window.app;
  if (!app || !app.workspace) return { fixed: false };
  try {
    const settings = document.querySelector(".modal.mod-settings");
    if (settings) {
      const close = settings.querySelector('[aria-label="Close"]');
      if (close) close.click();
    }
  } catch {}
  try {
    const leaf = app.workspace.getMostRecentLeaf && app.workspace.getMostRecentLeaf();
    if (leaf && leaf.view && leaf.view.editor && leaf.view.editor.focus) leaf.view.editor.focus();
  } catch {}
  return { fixed: true };
} catch (e) { return { fixed: false, error: String(e && e.message || e) }; } })()`;

function runSelfTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bob-mail-close-checkbox-e2e-self-"));
  try {
    const parsed = parseArgs(["--self-test"]);
    if (!parsed.selfTest) throw new Error("parseArgs did not keep --self-test");
    const fixture = buildFixture(tmp);
    if (!fixture.enabled.includes("task-status-cycler")) throw new Error("task-status-cycler must be enabled");
    if (!fixture.enabled.includes("bob-navigation-hotkeys")) throw new Error("bob-navigation-hotkeys must be enabled");
    const job = fs.readFileSync(path.join(tmp, "job.md"), "utf8");
    if (!job.includes("[[mail/2026/lease]]")) throw new Error("job.md must wikilink the mail note");
    const mail = fs.readFileSync(path.join(tmp, "mail/2026/lease.md"), "utf8");
    if (!mail.includes("type: [[mail]]")) throw new Error("mail note must be a Gmail Task source");
    const guard = fs.readFileSync(path.join(repoRoot, "plugins/task-status-cycler/src/187-mail-close-guard.js"), "utf8");
    const helpers = fs.readFileSync(path.join(repoRoot, "plugins/task-status-cycler/src/187a-mail-close-guard-helpers.js"), "utf8");
    const combined = `${guard}\n${helpers}`;
    for (const needle of ["pointerdown", "mousedown", "touchstart", '"click"', "posAtDOM", "getSectionInfo", "window-open", "toggleActiveCheckboxOpenDoneAndPropagate", "mailCloseConfirmed"]) {
      if (!combined.includes(needle)) throw new Error(`checkbox guard source must include ${needle}`);
    }
    console.log("offline self-test complete (not an Obsidian pass)");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function runReal(options) {
  const executable = findExecutable(options.executable);
  const probe = probeExecutable(executable);
  if (!probe.ok) fail(probe.reason);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "bob-mail-close-e2e-"));
  const vaultDir = path.join(scratch, "vault");
  const profileDir = path.join(scratch, "profile");
  const outDir = options.out ? path.resolve(options.out) : path.join(scratch, "out");
  fs.mkdirSync(outDir, { recursive: true });
  buildFixture(vaultDir);
  seedProfileVault(profileDir, vaultDir);
  const port = await freePort();
  const child = spawn(executable, ["--no-sandbox", `--user-data-dir=${profileDir}`, `--remote-debugging-port=${port}`, vaultDir], { stdio: "ignore", detached: true });
  child.unref();
  const report = { ok: false, steps: [], vault: vaultDir };
  const record = (name, ok, detail) => {
    report.steps.push({ name, ok, detail: detail || null });
    if (!ok) throw new Error(`e2e step failed: ${name}${detail ? ` — ${detail}` : ""}`);
  };
  try {
    const endpoint = await lib.waitForDebugger(port, OVERALL_TIMEOUT_MS);
    const client = await CdpClient.connect(endpoint, lib.CONNECT_TIMEOUT_MS);
    try {
      await sleep(8000);
      const vaultPath = await client.evaluate(VAULT_PATH_PROBE, 15000);
      record("scratch vault is open (never the live vault)", typeof vaultPath === "string" && vaultPath.length > 0 && !vaultPath.includes(`${path.sep}bob${path.sep}`), vaultPath);
      await client.evaluate(FOCUS_FIX_PROBE, 15000);
      record("Settings closed and vault window refocused (bob-cli-ox stays the owner)", true);
      for (const mode of ["live", "reading"]) {
        await client.evaluate(`(() => { const app = window.app; const leaf = app.workspace.getMostRecentLeaf(); return app.commands.executeCommandById("markdown:toggle-preview"); })()`, 15000).catch(() => null);
        await sleep(1500);
        const before = await client.evaluate(`(() => { const f = window.app.vault.getAbstractFileByPath("job.md"); return window.app.vault.cachedRead(f); })()`, 15000);
        await client.evaluate(`(() => { const el = document.querySelector("input.task-list-item-checkbox"); if (!el) throw new Error("checkbox not found"); el.click(); return true; })()`, 15000);
        await sleep(1500);
        const card = await client.evaluate(MAIL_CARD_PROBE, 15000);
        record(`Mail Close Card shows in ${mode}`, card && card.open === true, JSON.stringify(card));
        const afterClick = await client.evaluate(`(() => { const f = window.app.vault.getAbstractFileByPath("job.md"); return window.app.vault.cachedRead(f); })()`, 15000);
        record(`line is unchanged while the card is open (${mode})`, afterClick === before, null);
        await client.evaluate(`(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true })); return true; })()`, 15000);
        await sleep(1000);
        const kept = await client.evaluate(`(() => { const f = window.app.vault.getAbstractFileByPath("job.md"); return window.app.vault.cachedRead(f); })()`, 15000);
        record(`a key other than y keeps the task (${mode})`, kept === before, null);
        await client.evaluate(`(() => { const el = document.querySelector("input.task-list-item-checkbox"); if (el) el.click(); return true; })()`, 15000).catch(() => null);
        await sleep(1000);
        await client.evaluate(`(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "y", bubbles: true })); return true; })()`, 15000);
        await sleep(2000);
        const closed = await client.evaluate(`(() => { const f = window.app.vault.getAbstractFileByPath("job.md"); return window.app.vault.cachedRead(f); })()`, 15000);
        record(`y closes through the managed Ctrl+Enter path (${mode})`, /- \[[xX-]\]/.test(closed), closed.slice(0, 120));
        await client.evaluate(`(() => { const f = window.app.vault.getAbstractFileByPath("job.md"); return window.app.vault.write(f, "- [ ] #task Reply [[mail/2026/lease]] ^yogi\\n"); })()`, 15000);
        await sleep(1000);
      }
      report.ok = true;
    } finally {
      client.close();
    }
  } finally {
    try {
      process.kill(child.pid, "SIGTERM");
    } catch {
      // Best effort.
    }
    if (options.report) fs.writeFileSync(path.resolve(options.report), JSON.stringify(report, null, 2));
    if (!report.ok) console.error(JSON.stringify(report, null, 2));
  }
  return report;
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
  return runReal(parsed);
}

if (require.main === module) {
  const deadline = setTimeout(() => {
    console.error("overall timeout");
    process.exit(2);
  }, OVERALL_TIMEOUT_MS + 60000);
  if (deadline && typeof deadline.unref === "function") deadline.unref();
  Promise.resolve()
    .then(() => main(process.argv.slice(2)))
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error && error.message ? error.message : error);
      process.exit(error && error.exitCode ? error.exitCode : 1);
    });
}

module.exports = { parseArgs, buildFixture, runSelfTest };
