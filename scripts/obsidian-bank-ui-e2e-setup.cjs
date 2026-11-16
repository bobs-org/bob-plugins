#!/usr/bin/env node
// Real-Obsidian e2e for the Bank Setup header, Category-card New category,
// and Bank setup card. Isolated git scratch vault + profile, owned Obsidian
// under xvfb-run -a, CDP probes. Never opens the live vault.
//
//   xvfb-run -a node scripts/obsidian-bank-ui-e2e-setup.cjs [--out DIR] [-e PATH] [-r REPORT]
"use strict";

const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const lib = require("./obsidian-startup-smoke-lib.cjs");
const bank = require("./obsidian-bank-ui-e2e-lib.cjs");

const OVERALL_TIMEOUT_MS = 480_000;
const VAULT_PATH_PROBE = `(() => { try {
  const adapter = window.app && window.app.vault && window.app.vault.adapter;
  return adapter && typeof adapter.basePath === "string" ? adapter.basePath : null;
} catch { return null; } })()`;

function fail(message, code) {
  const error = new Error(message);
  error.exitCode = code || 1;
  throw error;
}

function findExecutable(override) {
  const candidates = [];
  if (override) candidates.push(override);
  if (process.env.OBSIDIAN_BIN) candidates.push(process.env.OBSIDIAN_BIN);
  candidates.push("/snap/obsidian/current/app/obsidian", "/snap/bin/obsidian");
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch { /* keep looking */ }
  }
  return candidates[0] || "/snap/bin/obsidian";
}

function probeExecutable(executable) {
  try { fs.accessSync(executable, fs.constants.X_OK); } catch {
    return { ok: false, reason: `Obsidian executable is not executable: ${executable}` };
  }
  const scratch = fs.mkdtempSync(path.join("/tmp/bse2e-probe-"));
  let probed;
  try {
    probed = spawnSync(executable, ["--no-sandbox", `--user-data-dir=${scratch}`, "--help"], {
      encoding: "utf8",
      timeout: 20_000,
    });
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  const combined = String((probed.stdout || "") + (probed.stderr || ""));
  if (/unable to find Obsidian/i.test(combined)) {
    return {
      ok: false,
      reason: `executable ${executable} is the Obsidian CLI shim, not the Electron app; pass the Electron binary with -e/--executable`,
    };
  }
  return { ok: true };
}

function findRealBob() {
  const candidates = [];
  if (process.env.BOB_BIN) candidates.push(process.env.BOB_BIN);
  candidates.push("/home/bryan/.cargo/bin/bob", path.join(os.homedir(), ".cargo/bin/bob"), path.join(os.homedir(), ".local/bin/bob"), "bob");
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if (candidate === "bob") {
        const which = spawnSync("which", ["bob"], { encoding: "utf8" });
        if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
        continue;
      }
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch { /* keep looking */ }
  }
  return "";
}

function writeNote(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function copyPluginFiles(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const file of ["manifest.json", "main.js", "styles.css"]) {
    const source = path.join(sourceDir, file);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(targetDir, file));
  }
}

function markdownViewState(mode) {
  if (mode === "preview" || mode === "reading") return { mode: "preview", source: false };
  if (mode === "source") return { mode: "source", source: true };
  return { mode: "source", source: false };
}

function writeBobConfig(configDir, bobPath) {
  fs.mkdirSync(path.join(configDir, "bob"), { recursive: true });
  fs.writeFileSync(path.join(configDir, "bob", "config.yml"), [
    "stats:",
    `  bob_path: ${JSON.stringify(bobPath)}`,
    "  bank_badge: true",
    "  bank_chip: true",
    "  bank_marks: true",
    "  day_strip: false",
    "",
  ].join("\n"));
}

function writeSetupShim(dir, realBob) {
  fs.mkdirSync(dir, { recursive: true });
  const shimPath = path.join(dir, "bob");
  const script = `#!/usr/bin/env node
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const dir = ${JSON.stringify(dir)};
const argv = process.argv.slice(2);
const inputArg = argv.findIndex((arg) => arg === "-i" || arg === "--input");
const expectsInput = inputArg >= 0 && argv[inputArg + 1] === "-";
let input = "";
if (expectsInput) {
  try { input = fs.readFileSync(0, "utf8"); } catch {}
}
const record = { t: Date.now(), argv, cwd: process.cwd(), bobDir: process.env.BOB_DIR || "", expectsInput, stdinBytes: Buffer.byteLength(input) };
fs.appendFileSync(path.join(dir, "argv.jsonl"), JSON.stringify(record) + "\\n");
let realBob = "";
try { realBob = fs.readFileSync(path.join(dir, "real-bob-path.txt"), "utf8").trim(); } catch {}
if (!realBob) {
  process.stderr.write("setup e2e shim: real bob path missing\\n");
  process.exit(127);
}
const spawned = spawnSync(realBob, argv, {
  encoding: "utf8",
  env: { ...process.env, NO_COLOR: "1" },
  input,
  timeout: 60_000,
  maxBuffer: 32 * 1024 * 1024,
});
if (spawned.stdout) process.stdout.write(spawned.stdout);
if (spawned.stderr) process.stderr.write(spawned.stderr);
process.exit(spawned.status == null ? 1 : spawned.status);
`;
  fs.writeFileSync(shimPath, script, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, "argv.jsonl"), "");
  fs.writeFileSync(path.join(dir, "real-bob-path.txt"), realBob ? String(realBob) : "");
  return shimPath;
}

function buildFixture(vaultDir) {
  const notes = bank.setupFixtureNotes();
  for (const [name, body] of Object.entries(notes)) writeNote(path.join(vaultDir, name), body);
  const enabled = [];
  for (const id of ["bob-ledger-tools", "task-status-cycler"]) {
    const source = path.join(repoRoot, "plugins", id);
    if (!fs.existsSync(path.join(source, "manifest.json"))) continue;
    copyPluginFiles(source, path.join(vaultDir, ".obsidian", "plugins", id));
    enabled.push(id);
  }
  fs.mkdirSync(path.join(vaultDir, ".obsidian"), { recursive: true });
  fs.writeFileSync(path.join(vaultDir, ".obsidian", "community-plugins.json"), JSON.stringify(enabled, null, 2));
  fs.writeFileSync(path.join(vaultDir, ".obsidian", "app.json"), JSON.stringify({
    livePreview: true, showLineNumber: false, showInlineTitle: false, showUnsupportedFiles: true,
  }, null, 2));
  fs.writeFileSync(path.join(vaultDir, ".obsidian", "appearance.json"), JSON.stringify({
    cssTheme: "", theme: "moonstone",
  }, null, 2));
  fs.writeFileSync(path.join(vaultDir, ".obsidian", "core-plugins.json"), JSON.stringify([
    "file-explorer", "global-search", "switcher", "page-preview", "command-palette", "editor-status", "outline", "daily-notes",
  ], null, 2));
  fs.writeFileSync(path.join(vaultDir, ".gitignore"), [
    ".obsidian/",
    ".bob-deploy.json",
    "",
  ].join("\n"));
  return { notes: Object.keys(notes), enabled };
}

function ensureGitWorktree(vaultDir) {
  if (fs.existsSync(path.join(vaultDir, ".git"))) return;
  const run = (args) => spawnSync("git", args, { cwd: vaultDir, encoding: "utf8", timeout: 20_000 });
  const origin = `${vaultDir}.origin.git`;
  if (!fs.existsSync(origin)) {
    spawnSync("git", ["init", "-q", "--bare", origin], { encoding: "utf8", timeout: 20_000 });
    spawnSync("git", ["--git-dir", origin, "symbolic-ref", "HEAD", "refs/heads/master"], { encoding: "utf8", timeout: 20_000 });
  }
  run(["init", "-q"]);
  run(["symbolic-ref", "HEAD", "refs/heads/master"]);
  run(["config", "user.email", "bank-setup-e2e@example.com"]);
  run(["config", "user.name", "Bank Setup E2E"]);
  run(["remote", "add", "origin", origin]);
  run(["add", "."]);
  run(["commit", "-q", "-m", "bank setup e2e fixture"]);
  run(["push", "-q", "-u", "origin", "master"]);
}

function gitCount(vaultDir) {
  const run = spawnSync("git", ["rev-list", "--count", "HEAD"], { cwd: vaultDir, encoding: "utf8", timeout: 20_000 });
  return Number(String(run.stdout || "").trim());
}

function gitSubjects(vaultDir, count) {
  const run = spawnSync("git", ["log", `--max-count=${count}`, "--format=%s"], {
    cwd: vaultDir,
    encoding: "utf8",
    timeout: 20_000,
  });
  return String(run.stdout || "").split("\n").filter(Boolean);
}

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function coffeeLineHidden(text) {
  const line = String(text).split("\n").find((row) => /^\s*coffee:/.test(row)) || "";
  return /hidden:\s*true/.test(line);
}

function seedProfileVault(profileDir, vaultRealPath) {
  const id = crypto.randomBytes(8).toString("hex");
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, "obsidian.json"), JSON.stringify({
    vaults: { [id]: { path: vaultRealPath, ts: Date.now(), open: true } },
  }, null, 2));
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
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (pending.timer) clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message || JSON.stringify(message.error)}`));
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
    let WebSocketClient = typeof globalThis.WebSocket === "function" ? globalThis.WebSocket : null;
    if (!WebSocketClient) {
      try { WebSocketClient = require("undici").WebSocket; } catch { WebSocketClient = null; }
    }
    if (!WebSocketClient) throw new Error("WebSocket is required for the CDP client (Node 22+ or undici)");
    return lib.withTimeout(new Promise((resolve, reject) => {
      let socket;
      try { socket = new WebSocketClient(endpoint); } catch (error) { reject(error); return; }
      socket.addEventListener("open", () => resolve(new CdpClient(socket)), { once: true });
      socket.addEventListener("error", (event) => reject(new Error(`CDP connect failed: ${event && event.message ? event.message : "socket error"}`)), { once: true });
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
      try { this.socket.send(JSON.stringify({ id, method, params: params || {} })); } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    }), (timeoutMs || lib.RPC_TIMEOUT_MS) + 1000, method);
  }

  evaluate(expression, timeoutMs) {
    return this.call("Runtime.evaluate", {
      expression, awaitPromise: true, returnByValue: true, userGesture: true,
    }, timeoutMs).then((response) => {
      if (response.exceptionDetails) {
        const details = response.exceptionDetails;
        throw new Error((details.exception && details.exception.description) || details.text || "Runtime.evaluate failed");
      }
      return response.result && response.result.value;
    });
  }

  close() {
    try { this.socket.close(); } catch { /* dead socket */ }
  }
}

async function selectOwnedTarget(cdpPort, fixtureRealPath, shouldStop) {
  const deadline = Date.now() + lib.CONNECT_TIMEOUT_MS * 2;
  let lastError = "";
  while (Date.now() < deadline) {
    if (shouldStop && shouldStop()) throw new Error("owned Obsidian process exited while waiting for the fixture vault window");
    let targets = [];
    try {
      const response = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
      if (response.ok) targets = await response.json();
    } catch (error) {
      lastError = error && error.message ? error.message : String(error);
      await sleep(300);
      continue;
    }
    const pages = (Array.isArray(targets) ? targets : []).filter((item) => item && item.type === "page" && item.webSocketDebuggerUrl);
    for (const page of pages) {
      let probeClient = null;
      try {
        probeClient = await CdpClient.connect(page.webSocketDebuggerUrl, 5000);
        const vaultPath = await probeClient.evaluate(VAULT_PATH_PROBE, 5000);
        if (lib.verifyVaultPath(vaultPath, fixtureRealPath)) return page;
      } catch (error) {
        lastError = error && error.message ? error.message : String(error);
      } finally {
        if (probeClient) probeClient.close();
      }
    }
    await sleep(500);
  }
  throw new Error(`no CDP page target reports the fixture vault${lastError ? `; last probe: ${lastError.slice(0, 160)}` : ""}`);
}

async function dismissTrustModal(client) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const clicked = await client.evaluate(`(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      const trust = buttons.find((button) => /Trust author and enable plugins/i.test(button.textContent || ""));
      if (!trust) return { clicked: false };
      trust.click();
      return { clicked: true };
    })()`).catch(() => ({ clicked: false }));
    if (clicked && clicked.clicked) {
      await sleep(400);
      return true;
    }
    await sleep(200);
  }
  return false;
}

async function waitCard(client, predicate, label, timeoutMs = 15000) {
  return waitFor(client, `(() => {
    const plugin = window.app.plugins.plugins["bob-ledger-tools"];
    const modal = plugin && plugin.bankSetupCardModal;
    const state = modal && modal.session && typeof modal.session.getState === "function" ? modal.session.getState() : null;
    return {
      open: Boolean(modal && modal.closed !== true),
      readOnly: Boolean(modal && modal.readOnly),
      section: modal && modal.section || "",
      selection: modal && modal.selection && modal.selection.id || "",
      stage: modal && modal.stage && modal.stage.kind || "",
      canApply: Boolean(state && state.canApply),
      consequence: String((document.querySelector(".bob-bank-setup-card-consequence") || {}).textContent || "").trim(),
      refusal: String((document.querySelector(".bob-bank-setup-card-refusal") || {}).textContent || "").trim(),
      stale: modal && modal.staleMessage || "",
      saved: modal && modal.savedMessage || "",
    };
  })()`, predicate, label, timeoutMs);
}

async function waitFor(client, expression, predicate, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await client.evaluate(expression);
      if (predicate(last)) return last;
    } catch (error) {
      last = { error: String(error && error.message || error) };
    }
    await sleep(150);
  }
  throw new Error(`timed out waiting for ${label}: ${JSON.stringify(last).slice(0, 400)}`);
}

async function openNote(client, file, mode) {
  const state = markdownViewState(mode);
  return client.evaluate(`(() => (async () => {
    const target = ${JSON.stringify(file)};
    const wantState = ${JSON.stringify(state)};
    const abstract = window.app.vault.getAbstractFileByPath(target);
    if (!abstract) return { ok: false, error: "missing " + target };
    const leaf = window.app.workspace.getLeaf(false);
    await leaf.openFile(abstract, { state: wantState });
    const view = leaf.view;
    if (view && typeof view.setState === "function") {
      const current = view.getState && view.getState() || {};
      await view.setState(Object.assign({}, current, wantState), { history: false });
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await new Promise((resolve) => setTimeout(resolve, 350));
    const next = view && view.getState && view.getState() || {};
    return { ok: true, path: view && view.file && view.file.path, mode: next.mode || null, source: next.source };
  })())()`, lib.RPC_TIMEOUT_MS);
}

async function collapseWorkspaceSplits(client) {
  await client.evaluate(`(() => {
    try {
      const workspace = window.app && window.app.workspace;
      if (workspace && workspace.leftSplit && typeof workspace.leftSplit.collapse === "function") workspace.leftSplit.collapse();
      if (workspace && workspace.rightSplit && typeof workspace.rightSplit.collapse === "function") workspace.rightSplit.collapse();
    } catch (_) {}
    return true;
  })()`);
}

async function scrollIntoViewSelector(client, selector) {
  if (!selector) return false;
  return client.evaluate(`(() => {
    const nodes = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
    const el = nodes.find((node) => {
      const r = node.getBoundingClientRect();
      return r.width > 8 && r.height > 8;
    }) || nodes[0];
    if (!el) return false;
    try { el.scrollIntoView({ block: "start", inline: "nearest" }); } catch (_) {}
    return true;
  })()`);
}

function clipFromRect(r) {
  if (!r) return null;
  const width = Number(r.w || r.width || 0);
  const height = Number(r.h || r.height || 0);
  if (!(width > 8 && height > 8)) return null;
  const x0 = Number.isFinite(r.x) ? r.x : 0;
  const y0 = Number.isFinite(r.y) ? r.y : 0;
  const pad = 12;
  const x = Math.max(0, Math.floor(x0 - pad));
  const y = Math.max(0, Math.floor(y0 - pad));
  return { x, y, width: Math.max(1, Math.ceil(width + pad * 2)), height: Math.max(1, Math.ceil(height + pad * 2)), scale: 1 };
}

async function probeSelector(client, selector) {
  return client.evaluate(`(() => {
    const nodes = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
    const boxes = nodes.map((el) => {
      const r = el.getBoundingClientRect();
      return { w: r.width, h: r.height, x: r.x, y: r.y };
    }).filter((box) => box.w > 8 && box.h > 8);
    boxes.sort((a, b) => (b.w * b.h) - (a.w * a.h));
    const r = boxes[0] || null;
    return { ok: Boolean(r), count: nodes.length, visible: boxes.length, w: r && r.w || 0, h: r && r.h || 0, x: r && r.x || 0, y: r && r.y || 0, title: document.title || "" };
  })()`);
}

async function probePluginModal(client) {
  return client.evaluate(`(() => {
    const plugin = window.app && window.app.plugins && window.app.plugins.plugins && window.app.plugins.plugins["bob-ledger-tools"];
    const modal = plugin && (plugin.bankSetupCardModal || plugin.bankCategoryModal) || null;
    if (!modal) return { ok: false, reason: "no-plugin-modal" };
    const host = modal.modalEl || modal.containerEl || modal.contentEl || null;
    const card = modal.contentEl && typeof modal.contentEl.querySelector === "function"
      ? (modal.contentEl.querySelector(".bob-bank-setup-card, .bob-bank-category-card, .bob-bank-category-stage, input[data-bank-new-field]") || null)
      : null;
    const node = (card && card.isConnected ? card : null) || (host && host.isConnected ? host : null);
    const r = node && node.getBoundingClientRect ? node.getBoundingClientRect() : null;
    return {
      ok: Boolean(r && r.width > 8 && r.height > 8),
      ctor: modal.constructor && modal.constructor.name || "",
      closed: modal.closed === true,
      modalConnected: Boolean(modal.modalEl && modal.modalEl.isConnected),
      contentConnected: Boolean(modal.contentEl && modal.contentEl.isConnected),
      hasCard: Boolean(card),
      w: r && r.width || 0,
      h: r && r.height || 0,
      x: r && r.x || 0,
      y: r && r.y || 0,
      className: node && String(node.className || ""),
    };
  })()`);
}

async function listCdpPages(cdpPort) {
  if (!Number.isInteger(cdpPort)) return [];
  try {
    const response = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
    const targets = response.ok ? await response.json() : [];
    return (Array.isArray(targets) ? targets : []).filter((item) => item && item.webSocketDebuggerUrl && item.type !== "service_worker" && item.type !== "worker");
  } catch {
    return [];
  }
}

async function findVisibleSelector(client, selector) {
  const primary = await probeSelector(client, selector).catch((error) => ({ ok: false, error: String(error.message || error) }));
  if (primary && primary.ok) return { ...primary, via: "primary" };
  const plugin = await probePluginModal(client).catch((error) => ({ ok: false, error: String(error.message || error) }));
  if (plugin && plugin.ok) return { ...plugin, via: "plugin-modal" };
  const pages = await listCdpPages(client.cdpPort);
  for (const page of pages) {
    let candidate = null;
    try {
      candidate = await CdpClient.connect(page.webSocketDebuggerUrl, 3000);
      await candidate.call("Runtime.enable", {}).catch(() => {});
      await candidate.call("Page.enable", {}).catch(() => {});
      const probe = await probeSelector(candidate, selector).catch(() => null);
      if (probe && probe.ok) {
        candidate.close();
        return { ...probe, via: "cdp", url: page.url, title: page.title, ws: page.webSocketDebuggerUrl };
      }
    } catch {
      /* try the next target */
    } finally {
      if (candidate) candidate.close();
    }
  }
  return { ok: false, primary, plugin };
}

async function waitVisible(client, selector, label, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await findVisibleSelector(client, selector);
    if (last && last.ok) return last;
    await sleep(200);
  }
  throw new Error(`timed out waiting for ${label}: ${JSON.stringify(last).slice(0, 800)}`);
}

async function captureFromClient(client, output, clipSelector, fromSurface = true) {
  if (clipSelector) {
    await scrollIntoViewSelector(client, clipSelector).catch(() => false);
    await sleep(120);
  }
  const params = { format: "png", fromSurface };
  if (clipSelector) {
    const box = await probeSelector(client, clipSelector).catch(() => null);
    const clip = clipFromRect(box);
    if (clip) params.clip = clip;
  }
  const screenshot = await client.call("Page.captureScreenshot", params);
  fs.writeFileSync(output, Buffer.from(screenshot.data, "base64"));
}

async function revealPluginModal(client) {
  return client.evaluate(`(() => {
    const plugin = window.app && window.app.plugins && window.app.plugins.plugins && window.app.plugins.plugins["bob-ledger-tools"];
    const modal = plugin && (plugin.bankSetupCardModal || plugin.bankCategoryModal);
    const nodes = [modal && modal.containerEl, modal && modal.modalEl, modal && modal.contentEl].filter(Boolean);
    for (const el of nodes) {
      try {
        el.style.setProperty("opacity", "1", "important");
        el.style.setProperty("visibility", "visible", "important");
        el.style.setProperty("display", el.classList && el.classList.contains("modal-container") ? "flex" : "", "important");
      } catch (_) {}
    }
    return { count: nodes.length, ctor: modal && modal.constructor && modal.constructor.name || "" };
  })()`);
}

async function capturePluginModal(client, output) {
  const placed = await client.evaluate(`(() => {
    const plugin = window.app && window.app.plugins && window.app.plugins.plugins && window.app.plugins.plugins["bob-ledger-tools"];
    const modal = plugin && (plugin.bankSetupCardModal || plugin.bankCategoryModal);
    const src = modal && (modal.contentEl || modal.modalEl);
    if (!src || typeof src.cloneNode !== "function") return { ok: false, reason: "no-src" };
    const prev = document.getElementById("bob-e2e-modal-shot");
    if (prev) prev.remove();
    const holder = document.createElement("div");
    holder.id = "bob-e2e-modal-shot";
    holder.style.cssText = "position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483647;background:color-mix(in srgb, black 45%, transparent);display:flex;align-items:center;justify-content:center;opacity:1;visibility:visible;";
    const clone = src.cloneNode(true);
    clone.style.cssText = [clone.getAttribute("style") || "", "opacity:1", "visibility:visible", "display:block", "max-height:90vh", "overflow:auto", "background:var(--background-primary)"].join(";");
    holder.appendChild(clone);
    document.body.appendChild(holder);
    const r = clone.getBoundingClientRect();
    return {
      ok: r.width > 8 && r.height > 8,
      text: String(clone.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 240),
      w: r.width, h: r.height, x: r.x, y: r.y,
      ctor: modal.constructor && modal.constructor.name || "",
    };
  })()`);
  await sleep(200);
  const clip = clipFromRect(placed);
  const params = { format: "png", fromSurface: true };
  if (clip) params.clip = clip;
  const screenshot = await client.call("Page.captureScreenshot", params);
  fs.writeFileSync(output, Buffer.from(screenshot.data, "base64"));
  await client.evaluate(`(() => { const el = document.getElementById("bob-e2e-modal-shot"); if (el) el.remove(); return true; })()`).catch(() => false);
  return placed;
}

async function capturePage(client, output, options = {}) {
  const scroll = options.scroll || "";
  const clipSelector = options.clip || "";
  if (options.collapse) await collapseWorkspaceSplits(client);
  if (scroll) {
    await scrollIntoViewSelector(client, scroll);
    await sleep(180);
  }
  if (clipSelector) await revealPluginModal(client).catch(() => null);
  if (!clipSelector) {
    await captureFromClient(client, output, "");
    return;
  }
  const cloned = await capturePluginModal(client, output).catch(() => null);
  if (cloned && cloned.ok) return;
  const found = await findVisibleSelector(client, clipSelector).catch(() => null);
  if (found && found.via === "cdp" && found.ws) {
    let candidate = null;
    try {
      candidate = await CdpClient.connect(found.ws, 4000);
      await candidate.call("Runtime.enable", {}).catch(() => {});
      await candidate.call("Page.enable", {}).catch(() => {});
      await captureFromClient(candidate, output, clipSelector, true);
      return;
    } catch {
      /* fall through to the primary page */
    } finally {
      if (candidate) candidate.close();
    }
  }
  if (found && found.via === "plugin-modal") {
    const clip = clipFromRect(found);
    const params = { format: "png", fromSurface: true };
    if (clip) params.clip = clip;
    const screenshot = await client.call("Page.captureScreenshot", params);
    fs.writeFileSync(output, Buffer.from(screenshot.data, "base64"));
    return;
  }
  await captureFromClient(client, output, clipSelector, true);
}

async function setViewport(client, width, height = 812) {
  await client.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  if (width <= 480) await collapseWorkspaceSplits(client);
  await client.evaluate(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  await sleep(220);
}

async function setDark(client, on) {
  await client.evaluate(`(() => {
    const body = document.body;
    if (!body) return false;
    if (${on ? "true" : "false"}) body.classList.add("theme-dark");
    else body.classList.remove("theme-dark");
    return body.classList.contains("theme-dark");
  })()`);
}

async function invalidateBank(client) {
  await client.evaluate(`(() => {
    const plugin = window.app.plugins.plugins["bob-ledger-tools"];
    if (plugin && typeof plugin.apiBankInvalidate === "function") plugin.apiBankInvalidate("e2e");
    return true;
  })()`);
}

function probe() {
  return bank.SETUP_UI_PROBE();
}

function jsonDetail(value) {
  try {
    return JSON.stringify(value ?? null).slice(0, 1600);
  } catch {
    return String(value).slice(0, 220);
  }
}

function runSelfTest() {
  const tmp = bank.makeSetupScratch(repoRoot, "self");
  try {
    if (!tmp.startsWith(bank.setupScratchRoot(repoRoot))) throw new Error("self-test scratch must stay under the workspace repo");
    const parsed = bank.parseArgs(["--self-test", "--out", tmp, "--report", path.join(tmp, "r.json")]);
    if (!parsed.selfTest) throw new Error("parseArgs did not keep --self-test");
    const notes = bank.setupFixtureNotes();
    for (const name of bank.setupRequiredNoteNames()) {
      if (!notes[name] || !String(notes[name]).trim()) throw new Error(`missing setup fixture ${name}`);
    }
    for (const [name, body] of Object.entries(notes)) writeNote(path.join(tmp, name), body);
    const hub = fs.readFileSync(path.join(tmp, "bank.md"), "utf8");
    if (!hub.includes("checking:") || !hub.includes('hotkey: "1"') || !hub.includes("kids: { label: 🧸 Kids, hidden: true }") || hub.includes("hotkey: none") || /rules:/.test(hub)) {
      throw new Error("live hub must be one account, quoted digit hotkeys, hidden kids without a hotkey, no rules");
    }
    const invalid = bank.invalidHubNote();
    if (!invalid.includes("hotkey: c") || !invalid.includes("unknown_cat") || !invalid.includes("cafe:")) {
      throw new Error("invalid hub missing duplicate hotkey or unknown cat");
    }
    if (/^bank:/m.test(bank.missingHubNote().split("---")[1] || "bank:")) {
      // missingHubNote frontmatter must omit bank:
    }
    const missingFm = bank.missingHubNote().split("---")[1] || "";
    if (/\nbank:/.test(missingFm)) throw new Error("missing hub still has bank:");
    if (!bank.unrelatedBankNote().includes("bank: leftover-string")) throw new Error("unrelated note missing bank property");
    if (!bank.waitingMonthNote().includes("$6.45 Corner Cafe")) throw new Error("waiting month missing row");
    const collapsed = bank.assertLiveCollapsed({
      header: true, headerCount: 1, headerAria: "Bank setup", expanded: "false",
      collapsed: "🏦 WF Checking · 9 categories · 1 hidden · no rules",
    });
    if (!collapsed.ok) throw new Error(`collapsed helper failed: ${collapsed.reason}`);
    if (bank.assertLiveCollapsed({ header: false }).ok) throw new Error("missing header must fail");
    const missing = bank.assertMissingMapping({ header: true, collapsed: "Setup · no bank: mapping yet" });
    if (!missing.ok) throw new Error(`missing helper failed: ${missing.reason}`);
    const invalidProbe = bank.assertInvalidHeader({
      header: true, expanded: "true", bannerRole: "alert",
      findings: [{ text: "dup", line: "12" }, { text: "unknown", line: "20" }],
    });
    if (!invalidProbe.ok) throw new Error(`invalid helper failed: ${invalidProbe.reason}`);
    const hide = bank.assertScopedHide({ surface: true, hubNote: false, bankProps: [{ inSurface: true, display: "none", visible: false }] }, true);
    if (!hide.ok) throw new Error(`scoped hide helper failed: ${hide.reason}`);
    if (bank.assertScopedHide({ surface: true, hubNote: true, bankProps: [] }, true).ok) {
      throw new Error("legacy hub-note class must fail");
    }
    ensureGitWorktree(tmp);
    if (!fs.existsSync(path.join(tmp, ".git"))) throw new Error("git worktree missing");
    if (gitCount(tmp) < 1) throw new Error("git fixture commit missing");
    const shimDir = path.join(tmp, "shim");
    const shimPath = writeSetupShim(shimDir, "/bin/true");
    if (!fs.existsSync(shimPath)) throw new Error("setup shim was not written");
    const source = fs.readFileSync(__filename, "utf8");
    for (const token of [
      "bob-bank-setup", "aria-expanded", "Copy starter", "no bank: mapping yet",
      "bank: has", "edit-bank-setup", "processFrontMatter", "stale_config",
      "disablePlugin", "bob-bank-setup-surface", "data-bank-new-field",
      "openNewCategoryStage", "stageUndo", "setSection", "expectsInput", "stdinBytes",
      "xvfb-run", "Input.dispatchKeyEvent", "Emulation.setDeviceMetricsOverride",
      "leftSplit.collapse", "scrollIntoView", "json/list", "bob-e2e-modal-shot",
      "setup-collapsed-375-light", "setup-invalid-375-dark", "setup-card-categories",
    ]) {
      if (!source.includes(token)) throw new Error(`e2e source missing ${token}`);
    }
    const liveState = markdownViewState("live");
    if (liveState.mode !== "source" || liveState.source !== false) throw new Error("Live Preview must open as Markdown source:false");
    const readingState = markdownViewState("preview");
    if (readingState.mode !== "preview") throw new Error("Reading view must open as mode:preview");
    if (!bank.SETUP_HELP_TEXT.includes("Never opens the live vault")) throw new Error("setup help missing live-vault guard");
    console.log("offline self-test complete (not an Obsidian pass)");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(`${tmp}.origin.git`, { recursive: true, force: true });
  }
}

async function launchObsidian(options) {
  const { executable, vaultDir, profileDir, configDir, shimDir, fixtureRealPath, homeDir } = options;
  fs.mkdirSync("/tmp/bse2e", { recursive: true });
  seedProfileVault(profileDir, fixtureRealPath);
  const cdpPort = await freePort();
  const child = spawn(executable, [
    "--no-sandbox",
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${cdpPort}`,
    "--remote-allow-origins=http://127.0.0.1/*",
    fixtureRealPath,
  ], {
    cwd: fixtureRealPath,
    env: (() => {
      const env = {
        ...process.env,
        HOME: homeDir,
        BOB_DIR: fixtureRealPath,
        BOB_NOW: `${bank.FIXTURE_TODAY}T12:00:00-05:00`,
        XDG_CONFIG_HOME: configDir,
        PATH: `${shimDir}${path.delimiter}${process.env.PATH || ""}`,
        TMPDIR: "/tmp/bse2e",
        DISPLAY: process.env.DISPLAY || ":99",
      };
      delete env.ELECTRON_RUN_AS_NODE;
      return env;
    })(),
    stdio: ["ignore", "ignore", "pipe"],
  });
  const launchLog = path.join("/tmp/bse2e", "obsidian-stderr.log");
  try {
    const stream = fs.createWriteStream(launchLog, { flags: "a" });
    if (child.stderr) child.stderr.pipe(stream);
  } catch { /* best-effort */ }
  let exitInfo = null;
  child.once("exit", (code, signal) => {
    exitInfo = `code=${code} signal=${signal || "none"}`;
  });
  const target = await selectOwnedTarget(cdpPort, fixtureRealPath, () => Boolean(exitInfo));
  const client = await CdpClient.connect(target.webSocketDebuggerUrl, lib.CONNECT_TIMEOUT_MS);
  client.cdpPort = cdpPort;
  client.vaultPath = fixtureRealPath;
  await client.call("Page.enable", {}, lib.RPC_TIMEOUT_MS);
  await client.call("Runtime.enable", {}, lib.RPC_TIMEOUT_MS);
  await client.call("Input.enable", {}, lib.RPC_TIMEOUT_MS).catch(() => ({}));
  const layoutDeadline = Date.now() + lib.LAYOUT_READY_TIMEOUT_MS;
  while (Date.now() < layoutDeadline) {
    const ready = await client.evaluate("Boolean(window.app && window.app.workspace && window.app.workspace.layoutReady)").catch(() => false);
    if (ready) break;
    await sleep(250);
  }
  await client.evaluate(`(() => (async () => {
    const plugins = window.app && window.app.plugins;
    if (!plugins || typeof plugins.isEnabled !== "function") return { error: "plugin manager unavailable" };
    if (!plugins.isEnabled()) await plugins.setEnable(true);
    return { enabled: Boolean(plugins.isEnabled()) };
  })())()`, lib.RPC_TIMEOUT_MS);
  await dismissTrustModal(client);
  await sleep(600);
  return { child, client, exitInfo: () => exitInfo };
}

async function stopObsidian(child, client) {
  if (client) client.close();
  try {
    if (child && child.exitCode == null && child.signalCode == null) child.kill("SIGTERM");
  } catch { /* already gone */ }
  if (!child) return;
  await new Promise((resolve) => {
    if (child.exitCode != null || child.signalCode != null) return resolve();
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* gone */ }
      resolve();
    }, 4000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function waitLoaded(client, pluginId, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const loaded = await client.evaluate(`Boolean(window.app && window.app.plugins && window.app.plugins.plugins && window.app.plugins.plugins[${JSON.stringify(pluginId)}])`).catch(() => false);
    if (loaded) return true;
    await sleep(300);
  }
  return false;
}

async function rewriteHub(client, vaultDir, body) {
  writeNote(path.join(vaultDir, "bank.md"), body);
  await client.evaluate(`(() => (async () => {
    const file = window.app.vault.getAbstractFileByPath("bank.md");
    if (!file) return { ok: false };
    await window.app.vault.adapter.read && window.app.vault.trigger && window.app.vault.trigger("modify", file);
    try { await window.app.vault.modify(file, ${JSON.stringify(body)}); } catch (error) {
      return { ok: false, error: String(error) };
    }
    const plugin = window.app.plugins.plugins["bob-ledger-tools"];
    if (plugin && typeof plugin.apiBankInvalidate === "function") plugin.apiBankInvalidate("e2e");
    return { ok: true };
  })())()`, 20000);
}

async function runE2e(parsed) {
  const executable = findExecutable(parsed.executable);
  const probeBin = probeExecutable(executable);
  if (!probeBin.ok) {
    fail(`unrun: ${probeBin.reason}. Rerun on a host with the Obsidian Electron app: xvfb-run -a node scripts/obsidian-bank-ui-e2e-setup.cjs -e /snap/bin/obsidian`, 2);
  }
  if (!process.env.DISPLAY && !process.env.XVFB_RUN_TMPDIR) {
    fail("unrun: no X display; rerun under xvfb-run -a node scripts/obsidian-bank-ui-e2e-setup.cjs", 2);
  }
  const realBob = findRealBob();
  if (!realBob) fail("unrun: real bob is required for Setup e2e (set BOB_BIN or install ~/.cargo/bin/bob)", 2);
  const configProbe = spawnSync(realBob, ["bank", "config", "-f", "json"], {
    encoding: "utf8",
    timeout: 15_000,
    env: { ...process.env, BOB_DIR: "/tmp", NO_COLOR: "1" },
  });
  const configOut = String((configProbe.stdout || "") + (configProbe.stderr || ""));
  if (!/config|bank:|missing/i.test(configOut) && configProbe.status === 2 && /unrecognized|unknown/i.test(configOut)) {
    fail("unrun: installed bob lacks `bank config`; point BOB_BIN at a bob-cli that has it", 2);
  }

  const outDir = parsed.out ? path.resolve(parsed.out) : path.join("/tmp/bse2e", "out");
  fs.mkdirSync(outDir, { recursive: true });
  // Chrome's AF_UNIX singleton socket cannot live under the long workspace path.
  const shortRoot = "/tmp/bse2e";
  fs.mkdirSync(shortRoot, { recursive: true });
  const runRoot = fs.mkdtempSync(path.join(shortRoot, "run-"));
  const vaultDir = path.join(runRoot, "vault");
  const profileDir = path.join(runRoot, "profile");
  const configDir = path.join(runRoot, "xdg-config");
  const homeDir = path.join(runRoot, "home");
  const shimDir = path.join(runRoot, "shim");
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });
  const shimPath = writeSetupShim(shimDir, realBob);
  writeBobConfig(configDir, shimPath);
  writeBobConfig(path.join(homeDir, ".config"), shimPath);
  buildFixture(vaultDir);
  ensureGitWorktree(vaultDir);
  const fixtureRealPath = fs.realpathSync(vaultDir);
  const hubPath = path.join(vaultDir, "bank.md");

  const cases = [];
  const skipped = [];
  const unverified = [];
  const record = (name, ok, detail) => {
    cases.push({ name, ok: Boolean(ok), detail: detail || "" });
    if (!ok) console.error(`FAIL ${name}: ${detail || ""}`);
    else console.log(`PASS ${name}${detail ? ` (${detail})` : ""}`);
  };

  let child = null;
  let client = null;
  const report = {
    executable,
    vault: fixtureRealPath,
    realBob,
    cases: [],
    skipped: [],
    unverified: [],
    screenshots: [],
    pass: false,
  };

  try {
    const launched = await launchObsidian({
      executable, vaultDir, profileDir, configDir, shimDir, fixtureRealPath, homeDir,
    });
    child = launched.child;
    client = launched.client;
    const loaded = await waitLoaded(client, "bob-ledger-tools");
    record("ledger-loaded", loaded, loaded ? "bob-ledger-tools" : "plugin missing");

    const paintHashBefore = hashFile(hubPath);
    await openNote(client, "bank.md", "live");
    let live = await waitFor(client, probe(), (value) => value && value.header, "live setup header", 25000).catch((error) => ({ error: error.message }));
    const liveCheck = bank.assertLiveCollapsed(live);
    record("live-header-collapsed", liveCheck.ok, liveCheck.reason || jsonDetail(live));
    record("live-header-once", live && live.headerCount === 1, jsonDetail(live));
    const hideLive = bank.assertScopedHide(live, true);
    record("live-scoped-hide", hideLive.ok, hideLive.reason);
    record("paint-never-writes", hashFile(hubPath) === paintHashBefore, "bank.md hash after live paint");
    record("edit-command-registered", Boolean(live && live.commands && live.commands.editSetup), jsonDetail(live && live.commands));

    await setViewport(client, 375, 812);
    await setDark(client, false);
    const collapsedLight = path.join(outDir, "setup-collapsed-375-light.png");
    await capturePage(client, collapsedLight, { scroll: ".bob-bank-setup" });
    report.screenshots.push(collapsedLight);
    await setDark(client, true);
    const collapsedDark = path.join(outDir, "setup-collapsed-375-dark.png");
    await capturePage(client, collapsedDark, { scroll: ".bob-bank-setup" });
    report.screenshots.push(collapsedDark);
    await setDark(client, false);

    await client.evaluate(`(() => {
      const toggle = document.querySelector(".bob-bank-setup-toggle");
      if (toggle) toggle.click();
      return Boolean(toggle);
    })()`);
    live = await waitFor(client, probe(), (value) => value && value.expanded === "true", "expanded header", 8000).catch((error) => ({ error: error.message }));
    record("live-header-expands", Boolean(live && live.expanded === "true"), jsonDetail(live));
    const tileKeys = (live && live.tiles || []).map((tile) => tile.key);
    record("live-tiles-present", tileKeys.includes("coffee") && tileKeys.includes("housing") && tileKeys.includes("kids") && tileKeys.includes("misc"), jsonDetail(live && live.tiles));
    const coffee = (live && live.tiles || []).find((tile) => tile.key === "coffee");
    record("live-tile-aria", Boolean(coffee && /Coffee/i.test(coffee.aria) && /key C/i.test(coffee.aria)), jsonDetail(coffee));
    const kids = (live && live.tiles || []).find((tile) => tile.key === "kids");
    record("live-hotkey-none-dot", Boolean(kids && kids.none), jsonDetail(kids));
    const derived = (live && live.tiles || []).find((tile) => tile.key === "groceries" || tile.key === "dining");
    record("live-derived-keycap", Boolean(derived && derived.derived), jsonDetail(derived));
    const expandedLight = path.join(outDir, "setup-expanded-375-light.png");
    await capturePage(client, expandedLight, { scroll: ".bob-bank-setup" });
    report.screenshots.push(expandedLight);
    await setDark(client, true);
    const expandedDark = path.join(outDir, "setup-expanded-375-dark.png");
    await capturePage(client, expandedDark, { scroll: ".bob-bank-setup" });
    report.screenshots.push(expandedDark);
    await setDark(client, false);
    await setViewport(client, 1280, 900);

    await openNote(client, "bank.md", "preview");
    const reading = await waitFor(client, probe(), (value) => value && value.header, "reading setup header", 15000).catch((error) => ({ error: error.message }));
    record("reading-header-once", Boolean(reading && reading.headerCount === 1), jsonDetail(reading));

    await rewriteHub(client, vaultDir, bank.invalidHubNote());
    await openNote(client, "bank.md", "live");
    const invalid = await waitFor(client, probe(), (value) => (
      value && value.headerState === "invalid" && value.expanded === "true"
      && Array.isArray(value.findings) && value.findings.filter((item) => item.line).length >= 1
    ), "invalid auto-expand", 25000).catch((error) => ({ error: error.message }));
    const invalidCheck = bank.assertInvalidHeader(invalid);
    record("invalid-auto-expand", invalidCheck.ok, invalidCheck.reason || jsonDetail(invalid));
    record("invalid-located-findings", Boolean(invalid && invalid.findings && invalid.findings.filter((item) => item.line).length >= 1), jsonDetail(invalid && invalid.findings));
    const queueReady = /bank: has \d+ problems? — see Setup above/.test(String(invalid && invalid.queueText || ""))
      ? invalid
      : await waitFor(client, probe(), (value) => /bank: has \d+ problems? — see Setup above/.test(String(value && value.queueText || "")), "invalid queue pointer", 12000).catch((error) => ({ error: error.message, queueText: invalid && invalid.queueText }));
    record("invalid-queue-pointer", /bank: has \d+ problems? — see Setup above/.test(String(queueReady && queueReady.queueText || "")), String(queueReady && queueReady.queueText || "").slice(0, 200));
    record("invalid-live-region", invalid && (invalid.bannerRole === "alert" || /alert|polite/.test(String(invalid && invalid.bannerLive || ""))), jsonDetail({ role: invalid && invalid.bannerRole, live: invalid && invalid.bannerLive }));
    await setViewport(client, 375, 812);
    const invalidLight = path.join(outDir, "setup-invalid-375-light.png");
    await capturePage(client, invalidLight, { scroll: ".bob-bank-setup" });
    report.screenshots.push(invalidLight);
    await setDark(client, true);
    const invalidDark = path.join(outDir, "setup-invalid-375-dark.png");
    await capturePage(client, invalidDark, { scroll: ".bob-bank-setup" });
    report.screenshots.push(invalidDark);
    await setDark(client, false);
    await setViewport(client, 1280, 900);

    const jumped = await client.evaluate(`(() => (async () => {
      const plugin = window.app.plugins.plugins["bob-ledger-tools"];
      const findings = Array.from(document.querySelectorAll(".bob-bank-setup-finding-text[data-bank-setup-line]"));
      const finding = findings.find((el) => /^\\d+$/.test(el.getAttribute("data-bank-setup-line") || ""));
      const line = finding ? Number(finding.getAttribute("data-bank-setup-line")) : 0;
      if (finding) finding.click();
      else if (plugin && typeof plugin.bankSetupJumpYaml === "function") await plugin.bankSetupJumpYaml("bank.md", line || 1);
      else return { ok: false, reason: "no finding line" };
      await new Promise((resolve) => setTimeout(resolve, 700));
      const view = window.app.workspace.activeLeaf && window.app.workspace.activeLeaf.view;
      const state = view && view.getState && view.getState() || {};
      const cursor = view && view.editor && view.editor.getCursor && view.editor.getCursor();
      return { ok: state.mode === "source" && state.source === true, mode: state.mode, source: state.source, line: cursor && cursor.line, clicked: Boolean(finding) };
    })())()`).catch((error) => ({ error: String(error) }));
    record("invalid-jump-source", Boolean(jumped && jumped.ok), jsonDetail(jumped));
    const lint = await waitFor(client, probe(), (value) => value && Number(value.lint) > 0, "source lint marks", 8000).catch((error) => ({ error: error.message }));
    record("invalid-source-lint", Boolean(lint && Number(lint.lint) > 0), jsonDetail(lint));

    await rewriteHub(client, vaultDir, bank.missingHubNote());
    await openNote(client, "bank.md", "live");
    const missingSnap = await waitFor(client, probe(), (value) => value && /no bank: mapping yet/.test(String(value.collapsed || "")), "missing mapping", 20000).catch((error) => ({ error: error.message }));
    const missingCheck = bank.assertMissingMapping(missingSnap);
    record("missing-mapping", missingCheck.ok, missingCheck.reason || jsonDetail(missingSnap));
    await client.evaluate(`(() => {
      const toggle = document.querySelector(".bob-bank-setup-toggle");
      if (toggle && toggle.getAttribute("aria-expanded") !== "true") toggle.click();
      return true;
    })()`);
    await sleep(400);
    const missingExpanded = await client.evaluate(probe()).catch((error) => ({ error: String(error) }));
    record("missing-copy-starter", Boolean(missingExpanded && missingExpanded.copyStarter && missingExpanded.yaml), jsonDetail(missingExpanded));
    const copyBefore = hashFile(hubPath);
    if (missingExpanded && missingExpanded.copyStarter) {
      await client.evaluate(`(() => { const btn = document.querySelector(".bob-bank-setup-copy"); if (btn) btn.click(); return true; })()`);
      await sleep(300);
    }
    record("missing-copy-writes-nothing", hashFile(hubPath) === copyBefore, "bank.md hash after Copy starter");

    await openNote(client, "other.md", "live");
    await sleep(500);
    const other = await client.evaluate(probe()).catch((error) => ({ error: String(error) }));
    const otherVisible = Array.isArray(other && other.bankProps) && other.bankProps.some((row) => !row.inSurface && row.visible);
    record("unrelated-bank-row-visible", otherVisible || Boolean(other && !other.surface && other.bankProps && other.bankProps.length), jsonDetail(other));

    await rewriteHub(client, vaultDir, bank.liveHubNote());
    await sleep(400);
    const commitsBeforeAdd = gitCount(vaultDir);
    const hubBeforeAdd = fs.readFileSync(hubPath, "utf8");
    await openNote(client, "bank/2026-11.md", "live");
    const addFile = await client.evaluate(`(() => (async () => {
      const view = window.app.workspace.activeLeaf && window.app.workspace.activeLeaf.view;
      const editor = view && view.editor;
      const plugin = window.app.plugins.plugins["bob-ledger-tools"];
      if (!editor || !plugin) return { ok: false, reason: "no editor/plugin" };
      const lines = editor.getValue().split("\\n");
      const index = lines.findIndex((line) => line.includes("$6.45 Corner Cafe"));
      if (index < 0) return { ok: false, reason: "waiting row missing" };
      editor.setCursor({ line: index, ch: 8 });
      if (plugin.api && plugin.api.bank && typeof plugin.api.bank.claimRowClose === "function") {
        plugin.api.bank.claimRowClose(editor, view);
      }
      await new Promise((resolve) => setTimeout(resolve, 800));
      const modal = plugin.bankCategoryModal;
      if (!(modal && modal.closed !== true)) return { ok: false, reason: "category card did not open" };
      if (!modal.configFingerprint) {
        try {
          const result = await plugin.apiBankRefresh({ command: "config", force: true, wait: true });
          if (result && result.report && typeof modal.setReport === "function") modal.setReport(result.report);
        } catch (error) {
          return { ok: false, reason: "config refresh failed: " + String(error && error.message || error) };
        }
      }
      if (typeof modal.openNewCategoryStage !== "function") return { ok: false, reason: "openNewCategoryStage missing", fingerprint: modal.configFingerprint || "" };
      const opened = modal.openNewCategoryStage();
      await new Promise((resolve) => setTimeout(resolve, 400));
      if (typeof modal.onNewCategoryFieldInput === "function") modal.onNewCategoryFieldInput("label", "Snacks");
      await new Promise((resolve) => setTimeout(resolve, 200));
      const input = document.querySelector('input[data-bank-new-field="label"]');
      if (input) {
        input.focus();
        input.value = "Snacks";
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      return {
        ok: Boolean(opened && (input || modal.newStage)),
        opened: Boolean(opened),
        fingerprint: modal.configFingerprint || "",
        hasInput: Boolean(input),
      };
    })())()`, 25000).catch((error) => ({ error: String(error) }));
    record("add-then-file-stage", Boolean(addFile && addFile.ok), jsonDetail(addFile));
    const newStageVisible = await waitVisible(client, 'input[data-bank-new-field="label"], .bob-bank-category-stage, .bob-bank-category-card', "new category stage", 8000).catch((error) => ({ error: error.message }));
    record("add-then-file-stage-visible", Boolean(newStageVisible && newStageVisible.ok), jsonDetail(newStageVisible));
    const newShot = path.join(outDir, "setup-category-new.png");
    await capturePage(client, newShot, { collapse: true, clip: ".bob-bank-category-modal, .bob-bank-category-card, .modal" });
    report.screenshots.push(newShot);
    if (addFile && addFile.ok) {
      await waitFor(client, `(() => {
        const modal = window.app.plugins.plugins["bob-ledger-tools"].bankCategoryModal;
        const state = modal && modal.newSession && typeof modal.newSession.getState === "function" ? modal.newSession.getState() : null;
        return { canApply: Boolean(state && state.canApply), stage: Boolean(modal && modal.newStage) };
      })()`, (value) => value && value.canApply, "new category preview", 12000).catch(() => null);
      await client.evaluate(`(() => (async () => {
        const plugin = window.app.plugins.plugins["bob-ledger-tools"];
        const modal = plugin && plugin.bankCategoryModal;
        if (modal && typeof modal.applyNewCategoryAndFile === "function") await modal.applyNewCategoryAndFile();
        await new Promise((resolve) => setTimeout(resolve, 1200));
        return true;
      })())()`, 20000).catch(() => false);
    }
    const commitsAfterAdd = gitCount(vaultDir);
    const subjects = gitSubjects(vaultDir, 3);
    const hubAfterAdd = fs.readFileSync(hubPath, "utf8");
    const addedLine = hubAfterAdd.split("\n").filter((line) => /snacks/i.test(line));
    const otherBytesSame = hubBeforeAdd.split("\n").every((line) => hubAfterAdd.includes(line) || /categories:/.test(line));
    const configCommits = subjects.filter((line) => /bank: config \(\+/.test(line));
    record("add-then-file-one-commit", configCommits.length === 1, jsonDetail({ commitsBeforeAdd, commitsAfterAdd, subjects, configCommits }));
    record("add-then-file-flow-line", addedLine.length === 1 && /snacks:/i.test(addedLine[0] || ""), jsonDetail(addedLine));
    const monthAfter = fs.readFileSync(path.join(vaultDir, "bank/2026-11.md"), "utf8");
    record("add-then-file-row", /\[cat::/.test(monthAfter), monthAfter.split("\n").find((line) => line.includes("Corner Cafe")) || "");

    await rewriteHub(client, vaultDir, bank.liveHubNote());
    await openNote(client, "bank.md", "live");
    await waitFor(client, probe(), (value) => value && value.header, "setup header before card", 15000).catch(() => null);
    const openedEdit = await client.evaluate(`(() => (async () => {
      const plugin = window.app.plugins.plugins["bob-ledger-tools"];
      const btn = document.querySelector(".bob-bank-setup-edit");
      if (btn) btn.click();
      else if (plugin && typeof plugin.openBankSetupCard === "function") await plugin.openBankSetupCard();
      await new Promise((resolve) => setTimeout(resolve, 500));
      return Boolean(plugin && plugin.bankSetupCardModal && plugin.bankSetupCardModal.closed !== true);
    })())()`, 20000).catch((error) => ({ error: String(error) }));
    record("setup-card-from-edit", openedEdit === true, jsonDetail(openedEdit));
    let cardVisible = await waitVisible(client, ".bob-bank-setup-card-modal, .bob-bank-setup-card", "setup card modal", 8000).catch((error) => ({ error: error.message }));
    if (!(cardVisible && cardVisible.ok)) {
      await client.evaluate(`(() => (async () => {
        const plugin = window.app.plugins.plugins["bob-ledger-tools"];
        if (plugin && typeof plugin.openBankSetupCard === "function") await plugin.openBankSetupCard();
        return true;
      })())()`, 20000).catch(() => false);
      cardVisible = await waitVisible(client, ".bob-bank-setup-card-modal, .bob-bank-setup-card", "setup card modal retry", 8000).catch((error) => ({ error: error.message }));
    }
    record("setup-card-visible", Boolean(cardVisible && cardVisible.ok), jsonDetail(cardVisible));
    const cardShot = path.join(outDir, "setup-card-categories.png");
    await capturePage(client, cardShot, { collapse: true, clip: ".bob-bank-setup-card-modal, .bob-bank-setup-card" });
    report.screenshots.push(cardShot);

    const sections = [];
    for (const name of ["accounts", "rules", "checks"]) {
      const switched = await client.evaluate(`(() => {
        const modal = window.app.plugins.plugins["bob-ledger-tools"].bankSetupCardModal;
        if (modal && typeof modal.setSection === "function") return modal.setSection(${JSON.stringify(name)});
        const tab = document.querySelector('[data-setup-section="${name}"]');
        if (tab) tab.click();
        return Boolean(tab);
      })()`).catch(() => false);
      await sleep(250);
      await waitVisible(client, ".bob-bank-setup-card-modal, .bob-bank-setup-card", `setup card ${name}`, 4000).catch(() => null);
      const shot = path.join(outDir, `setup-card-${name}.png`);
      await capturePage(client, shot, { collapse: true, clip: ".bob-bank-setup-card-modal, .bob-bank-setup-card" });
      report.screenshots.push(shot);
      sections.push({ name, switched });
    }
    record("setup-card-sections", sections.every((item) => item.switched), jsonDetail(sections));

    await client.evaluate(`(() => {
      const modal = window.app.plugins.plugins["bob-ledger-tools"].bankSetupCardModal;
      if (modal && typeof modal.setSection === "function") modal.setSection("categories");
      return true;
    })()`);
    await sleep(200);
    const hideGesture = await client.evaluate(`(() => {
      const modal = window.app.plugins.plugins["bob-ledger-tools"].bankSetupCardModal;
      if (!modal) return { ok: false, reason: "no modal" };
      if (modal.readOnly) return { ok: false, reason: "readOnly" };
      const selected = typeof modal.selectItem === "function" ? modal.selectItem("category:coffee") : false;
      const started = typeof modal.beginSelectedGesture === "function" ? modal.beginSelectedGesture("hide") : false;
      return { ok: Boolean(started), selected, readOnly: modal.readOnly, selection: modal.selection && modal.selection.id };
    })()`).catch((error) => ({ error: String(error) }));
    const hideReady = hideGesture && hideGesture.ok
      ? await waitCard(client, (value) => value && value.canApply, "hide preview", 12000).catch((error) => ({ error: error.message }))
      : hideGesture;
    record("setup-card-hide-preview", Boolean(hideReady && (hideReady.canApply || hideReady.ok) && !hideReady.error), jsonDetail(hideReady));
    const commitsBeforeHide = gitCount(vaultDir);
    if (hideReady && (hideReady.canApply || hideReady.ok) && !hideReady.error) {
      await client.evaluate(`(() => (async () => {
        const modal = window.app.plugins.plugins["bob-ledger-tools"].bankSetupCardModal;
        if (modal && typeof modal.applyStage === "function") await modal.applyStage();
        await new Promise((resolve) => setTimeout(resolve, 800));
        return true;
      })())()`, 20000).catch(() => false);
      await waitCard(client, (value) => value && !value.stage && /Saved/i.test(String(value.saved || "")), "hide saved", 12000).catch(() => null);
    }
    const hideSubjects = gitSubjects(vaultDir, 4);
    record("setup-card-hide-commit", hideSubjects.some((line) => /bank: config \(coffee\)/.test(line)), jsonDetail(hideSubjects));

    const undoStarted = await client.evaluate(`(() => {
      const modal = window.app.plugins.plugins["bob-ledger-tools"].bankSetupCardModal;
      if (!modal || typeof modal.stageUndo !== "function") return { ok: false, reason: "no stageUndo" };
      return { ok: Boolean(modal.stageUndo()), stage: modal.stage && modal.stage.kind };
    })()`).catch((error) => ({ error: String(error) }));
    const undoPreview = undoStarted && undoStarted.ok
      ? await waitCard(client, (value) => value && value.stage === "undo" && value.canApply, "undo preview", 15000).catch((error) => ({ error: error.message }))
      : undoStarted;
    record("setup-card-undo-preview", Boolean(undoPreview && undoPreview.canApply && undoPreview.stage === "undo" && !undoPreview.error), jsonDetail(undoPreview));
    const hubBeforeUndo = fs.readFileSync(hubPath, "utf8");
    if (undoPreview && undoPreview.canApply && !undoPreview.error) {
      await client.evaluate(`(() => (async () => {
        const modal = window.app.plugins.plugins["bob-ledger-tools"].bankSetupCardModal;
        if (modal && typeof modal.applyStage === "function") await modal.applyStage();
        await new Promise((resolve) => setTimeout(resolve, 800));
        return true;
      })())()`, 20000).catch(() => false);
      await waitCard(client, (value) => value && !value.stage, "undo applied", 12000).catch(() => null);
    }
    const hubAfterUndo = fs.readFileSync(hubPath, "utf8");
    record("setup-card-undo-restores", hubAfterUndo !== hubBeforeUndo && /coffee:/i.test(hubAfterUndo) && !coffeeLineHidden(hubAfterUndo), jsonDetail({ hiddenBefore: coffeeLineHidden(hubBeforeUndo), hiddenAfter: coffeeLineHidden(hubAfterUndo) }));

    const removeRefusal = await client.evaluate(`(() => (async () => {
      const modal = window.app.plugins.plugins["bob-ledger-tools"].bankSetupCardModal;
      if (!modal) return { ok: false, reason: "no modal" };
      if (modal.stage && typeof modal.cancelStage === "function") modal.cancelStage();
      modal.setSection("categories");
      const selected = typeof modal.selectItem === "function" ? modal.selectItem("category:groceries") : false;
      const started = typeof modal.beginSelectedGesture === "function" ? modal.beginSelectedGesture("remove") : false;
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const refusal = document.querySelector(".bob-bank-setup-card-refusal");
      const text = String((refusal && refusal.textContent) || (modal.sessionState && modal.sessionState.refusal && modal.sessionState.refusal.message) || modal.errorMessage || "").trim();
      return { ok: Boolean(started) && /row use|in use|hide.{0,16}instead|cannot remove/i.test(text), started, selected, text, selection: modal.selection && modal.selection.id };
    })())()`, 20000).catch((error) => ({ error: String(error) }));
    const removeHash = hashFile(hubPath);
    record("setup-card-remove-in-use", Boolean(removeRefusal && removeRefusal.ok), jsonDetail(removeRefusal));
    record("setup-card-remove-writes-nothing", hashFile(hubPath) === removeHash, "hash after in-use remove preview");

    const addAccount = await client.evaluate(`(() => (async () => {
      const modal = window.app.plugins.plugins["bob-ledger-tools"].bankSetupCardModal;
      if (!modal) return { ok: false, reason: "no modal" };
      if (modal.stage && typeof modal.cancelStage === "function") modal.cancelStage();
      modal.setSection("accounts");
      const opened = typeof modal.openNewAccountStage === "function" ? modal.openNewAccountStage() : false;
      if (!opened) return { ok: false, reason: "new account stage refused", readOnly: modal.readOnly };
      modal.onFieldInput("label", "Savings");
      modal.onFieldInput("kind", "savings");
      modal.onFieldInput("start", "2026-11-01");
      return { ok: true, stage: modal.stage && modal.stage.kind };
    })())()`, 15000).catch((error) => ({ error: String(error) }));
    if (addAccount && addAccount.ok) {
      await waitCard(client, (value) => value && value.canApply, "new account preview", 12000).catch(() => null);
      await client.evaluate(`(() => (async () => {
        const modal = window.app.plugins.plugins["bob-ledger-tools"].bankSetupCardModal;
        if (modal && typeof modal.applyStage === "function") await modal.applyStage();
        await new Promise((resolve) => setTimeout(resolve, 800));
        return true;
      })())()`, 20000).catch(() => false);
    }
    record("setup-card-add-account", Boolean(addAccount && addAccount.ok) && /savings:/i.test(fs.readFileSync(hubPath, "utf8")), jsonDetail(addAccount));

    const addRule = await client.evaluate(`(() => (async () => {
      const modal = window.app.plugins.plugins["bob-ledger-tools"].bankSetupCardModal;
      if (!modal) return { ok: false, reason: "no modal" };
      if (modal.stage && typeof modal.cancelStage === "function") modal.cancelStage();
      modal.setSection("rules");
      const opened = typeof modal.openNewRuleStage === "function" ? modal.openNewRuleStage() : false;
      if (!opened) return { ok: false, reason: "new rule stage refused", readOnly: modal.readOnly };
      modal.onFieldInput("match", "CORNER CAFE");
      modal.onFieldInput("cat", "coffee");
      return { ok: true, stage: modal.stage && modal.stage.kind };
    })())()`, 15000).catch((error) => ({ error: String(error) }));
    if (addRule && addRule.ok) {
      await waitCard(client, (value) => value && value.canApply, "new rule preview", 12000).catch(() => null);
      await client.evaluate(`(() => (async () => {
        const modal = window.app.plugins.plugins["bob-ledger-tools"].bankSetupCardModal;
        if (modal && typeof modal.applyStage === "function") await modal.applyStage();
        await new Promise((resolve) => setTimeout(resolve, 800));
        return true;
      })())()`, 20000).catch(() => false);
    }
    record("setup-card-add-rule", Boolean(addRule && addRule.ok) && /CORNER CAFE/.test(fs.readFileSync(hubPath, "utf8")), jsonDetail(addRule));

    const yamlExcursion = await client.evaluate(`(() => (async () => {
      const modal = window.app.plugins.plugins["bob-ledger-tools"].bankSetupCardModal;
      if (modal && typeof modal.openYamlExcursion === "function") await modal.openYamlExcursion();
      else {
        const yaml = document.querySelector(".bob-bank-setup-card-yaml, .bob-bank-setup-yaml");
        if (yaml) yaml.click();
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
      const view = window.app.workspace.activeLeaf && window.app.workspace.activeLeaf.view;
      const state = view && view.getState && view.getState() || {};
      return { ok: state.mode === "source", mode: state.mode, source: state.source, done: Boolean(document.querySelector(".bob-yaml-done, .bob-excursion-done, button")) };
    })())()`, 20000).catch((error) => ({ error: String(error) }));
    record("setup-card-yaml-excursion", Boolean(yamlExcursion && yamlExcursion.ok), jsonDetail(yamlExcursion));

    await client.evaluate(`(() => {
      const plugin = window.app.plugins.plugins["bob-ledger-tools"];
      try { plugin && plugin.bankSetupCardModal && plugin.bankSetupCardModal.close(); } catch (error) {}
      return true;
    })()`);

    const paletteOpen = await client.evaluate(`(() => (async () => {
      window.app.commands.executeCommandById("bob-ledger-tools:edit-bank-setup");
      await new Promise((resolve) => setTimeout(resolve, 400));
      const plugin = window.app.plugins.plugins["bob-ledger-tools"];
      return Boolean(plugin && plugin.bankSetupCardModal && plugin.bankSetupCardModal.closed !== true);
    })())()`, 15000).catch((error) => ({ error: String(error) }));
    record("setup-card-from-command", paletteOpen === true, jsonDetail(paletteOpen));
    await client.evaluate(`(() => {
      const plugin = window.app.plugins.plugins["bob-ledger-tools"];
      try { plugin && plugin.bankSetupCardModal && plugin.bankSetupCardModal.close(); } catch (error) {}
      return true;
    })()`);

    await rewriteHub(client, vaultDir, bank.liveHubNote());
    await openNote(client, "bank.md", "live");
    const fpBefore = await client.evaluate(`(() => (async () => {
      const plugin = window.app.plugins.plugins["bob-ledger-tools"];
      const file = window.app.vault.getAbstractFileByPath("bank.md");
      const before = await window.app.vault.read(file);
      await window.app.fileManager.processFrontMatter(file, (fm) => { fm.summary = "Edited through processFrontMatter"; });
      await new Promise((resolve) => setTimeout(resolve, 400));
      if (plugin && typeof plugin.apiBankInvalidate === "function") plugin.apiBankInvalidate("e2e");
      return { beforeLen: before.length };
    })())()`, 20000).catch((error) => ({ error: String(error) }));
    await sleep(800);
    const afterFm = fs.readFileSync(hubPath, "utf8");
    record("properties-round-trip-summary", /Edited through processFrontMatter/.test(afterFm), jsonDetail(fpBefore));
    const headerAfterFm = await waitFor(client, probe(), (value) => value && value.header, "header after processFrontMatter", 15000).catch((error) => ({ error: error.message }));
    record("properties-round-trip-header", Boolean(headerAfterFm && headerAfterFm.header), jsonDetail(headerAfterFm));

    const staleOpened = await client.evaluate(`(() => (async () => {
      const plugin = window.app.plugins.plugins["bob-ledger-tools"];
      if (plugin && typeof plugin.openBankSetupCard === "function") await plugin.openBankSetupCard();
      await new Promise((resolve) => setTimeout(resolve, 500));
      const modal = plugin.bankSetupCardModal;
      if (!modal) return { ok: false, reason: "no modal" };
      if (modal.readOnly) return { ok: false, reason: "readOnly" };
      modal.setSection("categories");
      modal.selectItem("category:coffee");
      const started = modal.beginSelectedGesture("hide");
      return { ok: Boolean(started), readOnly: modal.readOnly, selection: modal.selection && modal.selection.id };
    })())()`, 20000).catch((error) => ({ error: String(error) }));
    if (staleOpened && staleOpened.ok) {
      await waitCard(client, (value) => value && value.canApply, "stale-race hide preview", 12000).catch(() => null);
    }
    const hubBeforeStale = fs.readFileSync(hubPath, "utf8");
    const staleMutated = await client.evaluate(`(() => (async () => {
      const file = window.app.vault.getAbstractFileByPath("bank.md");
      const current = await window.app.vault.read(file);
      await window.app.vault.modify(file, current.replace("label: ☕ Coffee", "label: ☕ CoffeeX"));
      return { ok: true };
    })())()`, 15000).catch((error) => ({ error: String(error) }));
    const stalePaint = staleMutated && staleMutated.ok
      ? await waitCard(client, (value) => (
        value && value.canApply === false
        && (/stale/i.test(String(value.stale || value.refusal || "")) || value.stage === "confirm")
      ), "stale refusal", 15000).catch((error) => ({ error: error.message }))
      : staleMutated;
    await client.evaluate(`(() => (async () => {
      const modal = window.app.plugins.plugins["bob-ledger-tools"].bankSetupCardModal;
      if (modal && typeof modal.applyStage === "function") await modal.applyStage();
      return true;
    })())()`, 15000).catch(() => false);
    const staleText = String((stalePaint && (stalePaint.stale || stalePaint.refusal)) || "");
    const hubAfterStale = fs.readFileSync(hubPath, "utf8");
    const hideAfterStale = coffeeLineHidden(hubAfterStale);
    record("two-pane-stale-config", !hideAfterStale && /CoffeeX/.test(hubAfterStale) && stalePaint && stalePaint.canApply === false, jsonDetail({ staleOpened, stalePaint, hideAfterStale, staleText, coffeeX: /CoffeeX/.test(hubAfterStale) }));

    await client.evaluate(`(() => {
      const plugin = window.app.plugins.plugins["bob-ledger-tools"];
      try { plugin && plugin.bankSetupCardModal && plugin.bankSetupCardModal.close(); } catch (error) {}
      return true;
    })()`);
    await rewriteHub(client, vaultDir, bank.liveHubNote());
    const cancelHash = hashFile(hubPath);
    await openNote(client, "bank.md", "live");
    await client.evaluate(`(() => (async () => {
      const plugin = window.app.plugins.plugins["bob-ledger-tools"];
      if (plugin && typeof plugin.openBankSetupCard === "function") await plugin.openBankSetupCard();
      await new Promise((resolve) => setTimeout(resolve, 300));
      try { plugin.bankSetupCardModal.close(); } catch (error) {}
      return true;
    })())()`);
    await sleep(300);
    record("cancelled-byte-identical", hashFile(hubPath) === cancelHash, "bank.md after cancelled card");

    await client.evaluate(`(async () => {
      await window.app.plugins.disablePlugin("bob-ledger-tools");
      return true;
    })()`);
    await sleep(400);
    await openNote(client, "bank.md", "live");
    const disabled = await client.evaluate(probe()).catch((error) => ({ error: String(error) }));
    const nativeVisible = Array.isArray(disabled && disabled.bankProps) && disabled.bankProps.some((row) => row.visible);
    record("plugin-disable-restores-bank-row", Boolean(nativeVisible || (disabled && !disabled.header && !disabled.surface)), jsonDetail(disabled));

    report.cases = cases;
    report.skipped = skipped;
    report.unverified = unverified;
    report.pass = cases.every((item) => item.ok);
    report.out = outDir;
    if (parsed.report) {
      fs.mkdirSync(path.dirname(path.resolve(parsed.report)), { recursive: true });
      fs.writeFileSync(parsed.report, JSON.stringify(report, null, 2));
    }
    console.log(JSON.stringify({
      pass: report.pass,
      failed: cases.filter((item) => !item.ok).map((item) => item.name),
      skipped: skipped.map((item) => item.name),
      unverified: unverified.map((item) => item.name),
      screenshots: report.screenshots,
      out: outDir,
    }, null, 2));
    if (!report.pass) fail(`e2e failed: ${cases.filter((item) => !item.ok).map((item) => item.name).join(", ")}`, 1);
    return report;
  } finally {
    await stopObsidian(child, client);
    const cleanup = lib.planOwnedCleanup([runRoot], [runRoot]);
    for (const target of cleanup.removable) {
      try { fs.rmSync(target, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
    try { fs.rmSync(`${vaultDir}.origin.git`, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

async function main() {
  const parsed = bank.parseArgs(process.argv.slice(2));
  if (parsed.help) {
    console.log(bank.SETUP_HELP_TEXT);
    return;
  }
  if (parsed.selfTest) {
    runSelfTest();
    return;
  }
  const overall = new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error("overall e2e watchdog fired")), OVERALL_TIMEOUT_MS);
    if (timer && typeof timer.unref === "function") timer.unref();
  });
  await Promise.race([runE2e(parsed), overall]);
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = error && error.exitCode ? error.exitCode : 1;
});
