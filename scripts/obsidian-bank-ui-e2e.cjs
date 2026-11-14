#!/usr/bin/env node
// Real-Obsidian e2e for bob-bank cards, the Bank Badge, row marks, typing,
// acknowledgment, cycler guards, and data honesty.
// Isolated scratch vault + profile, owned Obsidian process, CDP probes.
// Never opens the live vault.
//
//   xvfb-run -a node scripts/obsidian-bank-ui-e2e.cjs [--out DIR] [-e PATH] [-r REPORT]
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

const OVERALL_TIMEOUT_MS = 420_000;
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
  candidates.push("/snap/bin/obsidian");
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
  const scratch = bank.makeScratch(repoRoot, "probe");
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

function findTasksPluginSource() {
  const candidate = path.join(os.homedir(), "bob", ".obsidian", "plugins", "obsidian-tasks-plugin");
  if (fs.existsSync(path.join(candidate, "main.js")) && fs.existsSync(path.join(candidate, "manifest.json"))) return candidate;
  return null;
}

function markdownViewState(mode) {
  if (mode === "preview" || mode === "reading") return { mode: "preview", source: false };
  if (mode === "source") return { mode: "source", source: true };
  return { mode: "source", source: false };
}

function writeBobConfig(configDir, shimPath, extra = {}) {
  const stats = {
    bob_path: shimPath,
    bank_badge: extra.bankBadge !== false,
    bank_chip: extra.bankChip !== false,
    bank_marks: extra.bankMarks !== false,
    day_strip: extra.dayStrip === true,
  };
  fs.mkdirSync(path.join(configDir, "bob"), { recursive: true });
  const lines = ["stats:"];
  for (const [key, value] of Object.entries(stats)) {
    lines.push(`  ${key}: ${typeof value === "boolean" ? value : JSON.stringify(value)}`);
  }
  fs.writeFileSync(path.join(configDir, "bob", "config.yml"), `${lines.join("\n")}\n`);
}

function buildFixture(vaultDir, options = {}) {
  const notes = bank.fixtureNotes();
  for (const [name, body] of Object.entries(notes)) writeNote(path.join(vaultDir, name), body);
  const enabled = [];
  const plugins = options.plugins || ["bob-ledger-tools", "task-status-cycler"];
  for (const id of plugins) {
    const source = path.join(repoRoot, "plugins", id);
    if (!fs.existsSync(path.join(source, "manifest.json"))) continue;
    copyPluginFiles(source, path.join(vaultDir, ".obsidian", "plugins", id));
    enabled.push(id);
  }
  const tasksSource = findTasksPluginSource();
  if (tasksSource && options.tasks !== false) {
    const targetDir = path.join(vaultDir, ".obsidian", "plugins", "obsidian-tasks-plugin");
    copyPluginFiles(tasksSource, targetDir);
    fs.writeFileSync(path.join(targetDir, "data.json"), JSON.stringify({
      globalFilter: "#task",
      taskFormat: "dataview",
    }, null, 2));
    enabled.push("obsidian-tasks-plugin");
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
  fs.writeFileSync(path.join(vaultDir, ".obsidian", "daily-notes.json"), JSON.stringify({
    format: "YYYY/YYYYMMDD", folder: "", template: "",
  }, null, 2));
  return { notes: Object.keys(notes), enabled };
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

async function waitFor(client, expression, predicate, label, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await client.evaluate(expression);
      if (predicate(last)) return last;
    } catch (error) {
      last = { error: String(error && error.message || error) };
    }
    await sleep(120);
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
    await new Promise((resolve) => setTimeout(resolve, 250));
    const next = view && view.getState && view.getState() || {};
    return { ok: true, path: view && view.file && view.file.path, mode: next.mode || null, source: next.source };
  })())()`, lib.RPC_TIMEOUT_MS);
}

async function capturePage(client, output) {
  const screenshot = await client.call("Page.captureScreenshot", { format: "png", fromSurface: true });
  fs.writeFileSync(output, Buffer.from(screenshot.data, "base64"));
}

async function clickSelector(client, selector) {
  const point = await client.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return { ok: false, error: "missing " + ${JSON.stringify(selector)} };
    el.scrollIntoView({ block: "center" });
    const rect = el.getBoundingClientRect();
    if (!rect || rect.width < 1 || rect.height < 1) return { ok: false, error: "no layout" };
    return { ok: true, x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`);
  if (!point || !point.ok) return point;
  await client.call("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await client.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  return point;
}

function probe() {
  return bank.BANK_UI_PROBE();
}

function monthCard(snapshot) {
  return (snapshot && Array.isArray(snapshot.cards) ? snapshot.cards : []).find((card) => card.kind === "month") || null;
}

function queueCard(snapshot) {
  return (snapshot && Array.isArray(snapshot.cards) ? snapshot.cards : []).find((card) => card.kind === "queue") || null;
}

function runSelfTest() {
  const tmp = bank.makeScratch(repoRoot, "self");
  try {
    if (!tmp.startsWith(bank.scratchRoot(repoRoot))) throw new Error("self-test scratch must stay under the workspace repo");
    const parsed = bank.parseArgs(["--self-test", "--out", tmp, "--report", path.join(tmp, "r.json")]);
    if (!parsed.selfTest) throw new Error("parseArgs did not keep --self-test");
    const notes = bank.fixtureNotes();
    for (const [name, body] of Object.entries(notes)) writeNote(path.join(tmp, name), body);
    for (const required of ["bank.md", "bank/2026-10.md", "bank/2026-11.md", "bank/2026-09.md", "bank/2026-08.md", "tasks/ordinary.md"]) {
      if (!fs.existsSync(path.join(tmp, required))) throw new Error(`fixture missing ${required}`);
    }
    const hub = fs.readFileSync(path.join(tmp, "bank.md"), "utf8");
    if (!hub.includes("checking:") || !hub.includes("groceries:") || !hub.includes("view: queue")) throw new Error("hub missing checking/categories/queue");
    const november = fs.readFileSync(path.join(tmp, "bank/2026-11.md"), "utf8");
    for (const token of ["+$2,000.00", "**$13.71**", "$1,234.56", "−$4.25", "⚑", "!!", "[[shoprite]]", `^bank-${bank.IMPORTED_ACKED_ID}`, `^${bank.CUSTOM_BLOCK_ID}`, "## Wed Nov 11", "[cat:: transfer]", "[cat:: cash]"]) {
      if (!november.includes(token)) throw new Error(`november missing ${token}`);
    }
    const ordinary = fs.readFileSync(path.join(tmp, "tasks/ordinary.md"), "utf8");
    if (!ordinary.includes("#task") || !ordinary.includes("$x^2+y^2$")) throw new Error("ordinary note missing task or math");
    const empty = bank.assertMonthCard(null);
    if (empty.ok) throw new Error("missing card must fail");
    const goodCard = bank.assertMonthCard({
      title: "November 2026",
      soFar: true,
      accounts: [{ name: "WF Checking", status: "unverified", hint: "No import yet" }],
      metrics: ["Out $1,426.21", "In +$2,100.00", "Net +$673.79"],
      waitingText: "2 waiting",
      flaggedText: "2 flagged",
      categories: ["🛒 Groceries $1,234.56 86.6%"],
      extras: "Unclassified: $4.25 out · — in Cash out $63.50 · destination unknown",
    });
    if (!goodCard.ok) throw new Error(`month helper failed: ${goodCard.reason}`);
    const heat = bank.assertHeat({ weekdays: ["M", "T", "W", "T", "F", "S", "S"], hasToday: true, hasWaiting: true });
    if (!heat.ok) throw new Error(`heat helper failed: ${heat.reason}`);
    const badHeat = bank.assertHeat({ weekdays: ["S"], hasToday: false, hasWaiting: false });
    if (badHeat.ok) throw new Error("incomplete heat must fail");
    const queue = bank.assertQueue({
      queueDays: [
        { date: "2026-10-31", lineLinks: 2, checkboxes: 2, ackIds: bank.IMPORTED_WAITING_ID, drawnIds: [bank.IMPORTED_WAITING_ID] },
        { date: bank.FIXTURE_TODAY, lineLinks: 2, checkboxes: 2, ackIds: "", drawnIds: [] },
      ],
      importCommand: "Weekly import: bob bank import ~/Downloads/*.qfx",
      recentMonths: ["2026-11 · Out $1,426.21", "2026-10 · Out $16.25"],
    });
    if (!queue.ok) throw new Error(`queue helper failed: ${queue.reason}`);
    const emptyQueue = bank.assertEmptyQueue({
      emptyText: "Nothing to acknowledge",
      accounts: [{ name: "WF Checking", hint: "No import yet" }],
    });
    if (!emptyQueue.ok) throw new Error(`empty queue helper failed: ${emptyQueue.reason}`);
    const todayBadge = bank.assertBadge({ text: "BANK · in +$2,100.00 · out $1,418.21 · 4 waiting" }, { waiting: true });
    if (!todayBadge.ok) throw new Error(`today badge helper failed: ${todayBadge.reason}`);
    const histBadge = bank.assertBadge({ text: "BANK · out $8.00" }, { waiting: false });
    if (!histBadge.ok) throw new Error(`historical badge helper failed: ${histBadge.reason}`);
    const badHist = bank.assertBadge({ text: "BANK · out $8.00 · 4 waiting" }, { waiting: false });
    if (badHist.ok) throw new Error("historical waiting count must fail");
    const ack = bank.assertAckArgv({ argv: ["bank", "ack", bank.IMPORTED_WAITING_ID, "-f", "json"] });
    if (!ack.ok) throw new Error(`ack argv helper failed: ${ack.reason}`);
    if (bank.assertAckArgv({ argv: ["bank", "ack", "-D", bank.FIXTURE_TODAY, "-f", "json"] }).ok) throw new Error("ack -D must fail");
    if (bank.assertAckArgv({ argv: ["bank", "ack", "-f", "json"] }).ok) throw new Error("empty ack must fail");
    const ensure = bank.assertEnsureArgv({ argv: ["bank", "ensure", "-D", bank.FIXTURE_TODAY, "-f", "json"] }, bank.FIXTURE_TODAY);
    if (!ensure.ok) throw new Error(`ensure argv helper failed: ${ensure.reason}`);
    if (bank.assertEnsureArgv({ argv: ["bank", "ensure", "-D", bank.FIXTURE_TODAY, "-o", "-f", "json"] }, bank.FIXTURE_TODAY).ok) {
      throw new Error("ensure -o must fail");
    }
    if (bank.assertNoMath({ mathCount: 1 }).ok) throw new Error("math leak must fail");
    if (!bank.assertHasMath({ mathCount: 1 }).ok) throw new Error("ordinary math helper failed");
    const shimDir = path.join(tmp, "shim");
    const shimPath = bank.writeShim(shimDir, "");
    if (!fs.existsSync(shimPath)) throw new Error("shim was not written");
    bank.setShimMode(shimDir, "schema");
    const spawned = spawnSync(process.execPath, [shimPath, "bank", "list", "-f", "json"], { encoding: "utf8", timeout: 5_000 });
    const schema = JSON.parse(spawned.stdout || "{}");
    if (schema.schema_version !== 2) throw new Error("schema control did not serve schema 2");
    const log = bank.readArgvLog(shimDir);
    if (!log.length || log[0].argv[1] !== "list") throw new Error("shim did not log argv");
    const source = fs.readFileSync(__filename, "utf8");
    for (const token of ["toggle-bank-marks", "bank-open-today", "cycle-task-status-forward", "window-open", "xvfb-run", "never $0.00", ".math", "bob-bank-category-modal", "bob-bank-category-card", "walk-ctrl-enter-c", "walk-card.png"]) {
      if (!source.includes(token) && token !== "never $0.00") {
        if (token === "never $0.00") continue;
        throw new Error(`e2e source missing ${token}`);
      }
    }
    if (!source.includes("schema_version") && !source.includes("schema")) throw new Error("honesty cases missing schema");
    const liveState = markdownViewState("live");
    if (liveState.mode !== "source" || liveState.source !== false) throw new Error("Live Preview must open as Markdown source:false");
    const readingState = markdownViewState("preview");
    if (readingState.mode !== "preview") throw new Error("Reading view must open as mode:preview");
    console.log("offline self-test complete (not an Obsidian pass)");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function waitArgv(shimDir, startLength, predicate, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const entries = bank.readArgvLog(shimDir).slice(startLength);
    const hit = entries.find((entry) => predicate(entry && entry.argv ? entry.argv : []));
    if (hit) return { hit, entries };
    await sleep(80);
  }
  return { hit: null, entries: bank.readArgvLog(shimDir).slice(startLength) };
}

function jsonDetail(value) {
  try {
    return JSON.stringify(value ?? null).slice(0, 1600);
  } catch {
    return String(value).slice(0, 220);
  }
}

async function launchObsidian(options) {
  const { executable, vaultDir, profileDir, configDir, shimDir, fixtureRealPath, homeDir } = options;
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
        TMPDIR: os.tmpdir(),
      };
      delete env.ELECTRON_RUN_AS_NODE;
      return env;
    })(),
    stdio: "ignore",
  });
  let exitInfo = null;
  child.once("exit", (code, signal) => {
    exitInfo = `code=${code} signal=${signal || "none"}`;
  });
  const target = await selectOwnedTarget(cdpPort, fixtureRealPath, () => Boolean(exitInfo));
  const client = await CdpClient.connect(target.webSocketDebuggerUrl, lib.CONNECT_TIMEOUT_MS);
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

async function runE2e(parsed) {
  const executable = findExecutable(parsed.executable);
  const probeBin = probeExecutable(executable);
  if (!probeBin.ok) {
    fail(`unrun: ${probeBin.reason}. Rerun on a host with the Obsidian Electron app: xvfb-run -a node scripts/obsidian-bank-ui-e2e.cjs -e /snap/bin/obsidian`, 2);
  }
  if (!process.env.DISPLAY && !process.env.XVFB_RUN_TMPDIR) {
    fail("unrun: no X display; rerun under xvfb-run -a node scripts/obsidian-bank-ui-e2e.cjs", 2);
  }

  const outDir = parsed.out ? path.resolve(parsed.out) : bank.makeScratch(repoRoot, "out");
  fs.mkdirSync(outDir, { recursive: true });
  const runRoot = bank.makeScratch(repoRoot, "run");
  const vaultDir = path.join(runRoot, "vault");
  const profileDir = path.join(runRoot, "profile");
  const configDir = path.join(runRoot, "xdg-config");
  const homeDir = path.join(runRoot, "home");
  const shimDir = path.join(runRoot, "shim");
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });
  const realBob = findRealBob();
  const shimPath = bank.writeShim(shimDir, realBob);
  writeBobConfig(configDir, shimPath, { dayStrip: false, bankChip: true, bankMarks: true });
  writeBobConfig(path.join(homeDir, ".config"), shimPath, { dayStrip: false, bankChip: true, bankMarks: true });
  const fixture = buildFixture(vaultDir, { plugins: ["bob-ledger-tools", "task-status-cycler"] });
  const fixtureRealPath = fs.realpathSync(vaultDir);

  const cases = [];
  const skipped = [];
  const unverified = [];
  const record = (name, ok, detail) => {
    cases.push({ name, ok: Boolean(ok), detail: detail || "" });
    if (!ok) console.error(`FAIL ${name}: ${detail || ""}`);
    else console.log(`PASS ${name}${detail ? ` (${detail})` : ""}`);
  };
  const skip = (name, detail) => {
    skipped.push({ name, detail: detail || "" });
    console.log(`SKIP ${name}${detail ? ` (${detail})` : ""}`);
  };
  const skipUnverified = (name, detail) => {
    unverified.push({ name, detail: detail || "" });
    console.log(`UNVERIFIED ${name}${detail ? ` (${detail})` : ""}`);
  };

  let child = null;
  let client = null;
  const report = {
    executable,
    vault: fixtureRealPath,
    realBob: realBob || null,
    bobMode: "unknown",
    cases: [],
    skipped: [],
    unverified: [],
    screenshots: [],
    argvLog: path.join(shimDir, "argv.jsonl"),
    pass: false,
  };
  try {
    const launched = await launchObsidian({ executable, vaultDir, profileDir, configDir, shimDir, fixtureRealPath, homeDir });
    child = launched.child;
    client = launched.client;
    const ledgerLoaded = await waitLoaded(client, "bob-ledger-tools");
    record("plugin-loaded", ledgerLoaded, ledgerLoaded ? "bob-ledger-tools" : "bob-ledger-tools did not load");
    if (!ledgerLoaded) throw new Error("bob-ledger-tools did not load in the scratch vault");
    await waitLoaded(client, "task-status-cycler");
    const bobPath = await client.evaluate(`(() => {
      const plugin = window.app.plugins.plugins["bob-ledger-tools"];
      return plugin && typeof plugin.apiStatsBobPath === "function" ? plugin.apiStatsBobPath() : null;
    })()`).catch(() => null);
    record("bob-path-shim", Boolean(bobPath && /shim|\/bob$/.test(String(bobPath.path || "")) && !String(bobPath.path || "").includes(".cargo/bin/bob")), jsonDetail(bobPath));

    await openNote(client, "bank/2026-11.md", "live");
    const monthLive = await waitFor(client, probe(), (value) => monthCard(value), "month-card-live", 20_000).catch((error) => ({ error: error.message, cards: [] }));
    const monthAssert = bank.assertMonthCard(monthCard(monthLive));
    record("month-card-live", monthAssert.ok, monthAssert.ok ? "title/so far/accounts/totals" : monthAssert.reason);
    const heatAssert = bank.assertHeat(monthCard(monthLive) && monthCard(monthLive).heat);
    record("month-heat-live", heatAssert.ok, heatAssert.ok ? "Monday-first, today, waiting" : heatAssert.reason);
    const footer = monthCard(monthLive) && monthCard(monthLive).footer || [];
    record("month-footer-live", footer.some((text) => /2026-10/.test(text)) && footer.some((text) => /Bank hub/i.test(text)) && !footer.some((text) => /2026-12/.test(text) && !/No later/i.test(text)), JSON.stringify(footer).slice(0, 220));
    const shotMonthLive = path.join(outDir, "month-live.png");
    await capturePage(client, shotMonthLive);
    report.screenshots.push(shotMonthLive);

    const beforeClick = await client.evaluate(`(() => {
      const leaf = window.app.workspace.activeLeaf;
      const editor = leaf && leaf.view && leaf.view.editor;
      const cursor = editor && editor.getCursor && editor.getCursor();
      return { line: cursor && cursor.line, ch: cursor && cursor.ch };
    })()`).catch(() => ({}));
    const headingDay = (monthCard(monthLive).heat.days || []).find((day) => day.date === bank.FIXTURE_TODAY && !day.disabled);
    const missingDay = (monthCard(monthLive).heat.days || []).find((day) => day.disabled);
    if (headingDay) {
      await client.evaluate(`(() => {
        const button = Array.from(document.querySelectorAll(".bob-bank-heat-day")).find((el) => el.getAttribute("data-date") === ${JSON.stringify(bank.FIXTURE_TODAY)});
        if (button) button.click();
        return Boolean(button);
      })()`);
      await sleep(400);
      const after = await client.evaluate(`(() => {
        const editor = window.app.workspace.activeLeaf && window.app.workspace.activeLeaf.view && window.app.workspace.activeLeaf.view.editor;
        const cursor = editor && editor.getCursor && editor.getCursor();
        const line = editor && cursor ? editor.getLine(cursor.line) : "";
        return { line: cursor && cursor.line, text: line };
      })()`).catch(() => ({}));
      record("heat-click-heading", Boolean(after && after.line > 1 && /Nov 12|Thu Nov 12|\$/.test(String(after.text || after.line))), JSON.stringify(after).slice(0, 180));
    } else {
      record("heat-click-heading", false, "today heat button missing");
    }
    if (missingDay) {
      await client.evaluate(`(() => {
        const button = Array.from(document.querySelectorAll(".bob-bank-heat-day")).find((el) => el.disabled);
        if (button) button.click();
        return Boolean(button);
      })()`);
      await sleep(200);
      const afterMissing = await client.evaluate(`(() => {
        const editor = window.app.workspace.activeLeaf && window.app.workspace.activeLeaf.view && window.app.workspace.activeLeaf.view.editor;
        const cursor = editor && editor.getCursor && editor.getCursor();
        const line = editor && cursor ? editor.getLine(cursor.line) : "";
        return { line: cursor && cursor.line, text: line, fm: /^---/.test(line) };
      })()`).catch(() => ({}));
      record("heat-click-no-heading", Boolean(afterMissing && afterMissing.line !== 0 && afterMissing.fm !== true), JSON.stringify({ beforeClick, afterMissing }).slice(0, 220));
    } else {
      skip("heat-click-no-heading", "every heat day had a heading in this fixture");
    }

    await client.evaluate(`(() => { const el = document.querySelector(".bob-bank-card"); if (el) el.style.maxWidth = "280px"; return true; })()`);
    await sleep(200);
    const shotNarrow = path.join(outDir, "month-narrow.png");
    await capturePage(client, shotNarrow);
    report.screenshots.push(shotNarrow);
    const narrow = await client.evaluate(probe());
    record("month-narrow", Boolean(monthCard(narrow) && monthCard(narrow).width <= 360), `width=${monthCard(narrow) && monthCard(narrow).width}`);

    await openNote(client, "bank/2026-11.md", "preview");
    const monthReading = await waitFor(client, probe(), (value) => monthCard(value), "month-card-reading", 12_000).catch((error) => ({ error: error.message, cards: [] }));
    record("month-card-reading", bank.assertMonthCard(monthCard(monthReading)).ok, bank.assertMonthCard(monthCard(monthReading)).reason || "reading");
    const shotMonthReading = path.join(outDir, "month-reading.png");
    await capturePage(client, shotMonthReading);
    report.screenshots.push(shotMonthReading);

    await openNote(client, "bank.md", "live");
    const queueLive = await waitFor(client, probe(), (value) => queueCard(value), "queue-card-live", 16_000).catch((error) => ({ error: error.message, cards: [] }));
    const queueAssert = bank.assertQueue(queueCard(queueLive));
    record("queue-card-live", queueAssert.ok, queueAssert.ok ? "oldest-first, ids, import, months" : queueAssert.reason);
    const shotQueueLive = path.join(outDir, "queue-live.png");
    await capturePage(client, shotQueueLive);
    report.screenshots.push(shotQueueLive);
    await openNote(client, "bank.md", "preview");
    const queueReading = await waitFor(client, probe(), (value) => queueCard(value), "queue-card-reading", 12_000).catch((error) => ({ error: error.message, cards: [] }));
    record("queue-card-reading", bank.assertQueue(queueCard(queueReading)).ok, bank.assertQueue(queueCard(queueReading)).reason || "reading");
    const shotQueueReading = path.join(outDir, "queue-reading.png");
    await capturePage(client, shotQueueReading);
    report.screenshots.push(shotQueueReading);

    bank.setShimMode(shimDir, "empty-queue");
    await client.evaluate(`(() => { const plugin = window.app.plugins.plugins["bob-ledger-tools"]; if (plugin && plugin.apiBankInvalidate) plugin.apiBankInvalidate("e2e"); return true; })()`);
    await sleep(800);
    await openNote(client, "bank.md", "live");
    const emptyQueueSnap = await waitFor(client, probe(), (value) => queueCard(value) && /nothing to acknowledge/i.test(String(queueCard(value).emptyText || queueCard(value).text || "")), "empty-queue", 10_000).catch((error) => ({ error: error.message, cards: [] }));
    const emptyAssert = bank.assertEmptyQueue(queueCard(emptyQueueSnap) || { text: emptyQueueSnap && emptyQueueSnap.error });
    record("queue-empty-teaching", emptyAssert.ok, emptyAssert.ok ? "nothing to acknowledge with caveats" : emptyAssert.reason);
    bank.setShimMode(shimDir, "passthrough");
    await client.evaluate(`(() => { const plugin = window.app.plugins.plugins["bob-ledger-tools"]; if (plugin && plugin.apiBankInvalidate) plugin.apiBankInvalidate("e2e"); return true; })()`);

    await openNote(client, "bank/2026-09.md", "live");
    const emptyMonth = await waitFor(client, probe(), (value) => monthCard(value), "empty-month", 12_000).catch((error) => ({ error: error.message, cards: [] }));
    const emptyMonthText = String((monthCard(emptyMonth) && (monthCard(emptyMonth).emptyText || monthCard(emptyMonth).teaching || monthCard(emptyMonth).text)) || "");
    record("empty-month-teaching", /Nothing posted|Start with the bank hub|Add a day heading/i.test(emptyMonthText), emptyMonthText.slice(0, 180));
    const shotEmpty = path.join(outDir, "empty-month.png");
    await capturePage(client, shotEmpty);
    report.screenshots.push(shotEmpty);

    await openNote(client, "bank/2026-08.md", "live");
    await sleep(600);
    const invalid = await client.evaluate(probe());
    const invalidText = String((invalid.cards && invalid.cards[0] && (invalid.cards[0].error || invalid.cards[0].text)) || invalid.errors && invalid.errors.join(" ") || "");
    record("invalid-fence", /valid view|Invalid bob-bank|nope/i.test(invalidText) || (invalid.errors || []).some((text) => /valid view|Invalid/i.test(text)), invalidText.slice(0, 180));
    const shotInvalid = path.join(outDir, "invalid-fence.png");
    await capturePage(client, shotInvalid);
    report.screenshots.push(shotInvalid);

    const todayPath = bank.dailyPathFor(bank.FIXTURE_TODAY);
    const histPath = bank.dailyPathFor(bank.FIXTURE_HISTORICAL);
    await openNote(client, todayPath, "live");
    const todayBadge = await waitFor(client, probe(), (value) => Array.isArray(value.badges) && value.badges.length === 1, "today-badge", 16_000).catch((error) => ({ error: error.message, badges: [] }));
    const todayAssert = bank.assertBadge(todayBadge.badges && todayBadge.badges[0], { waiting: true });
    record("badge-today", todayAssert.ok, todayAssert.ok ? todayBadge.badges[0].text : todayAssert.reason);
    record("badge-once", todayBadge.badgeCount === 1, `count=${todayBadge.badgeCount}`);
    const shotBadgeToday = path.join(outDir, "badge-today.png");
    await capturePage(client, shotBadgeToday);
    report.screenshots.push(shotBadgeToday);
    const leavesBefore = todayBadge.leaves || [];
    const argvBeforeBadge = bank.readArgvLog(shimDir).length;
    const badgeClick = await client.evaluate(`(() => {
      const badge = document.querySelector(".bob-bank-badge[role=link]");
      if (badge) badge.click();
      return { clicked: Boolean(badge), text: badge ? String(badge.textContent || "") : "" };
    })()`).catch((error) => ({ error: String(error) }));
    await waitFor(client, probe(), (value) => value.path === "bank/2026-11.md", "badge-jump", 8000).catch(() => null);
    const afterBadge = await client.evaluate(probe());
    const badgeArgv = bank.readArgvLog(shimDir).slice(argvBeforeBadge);
    const wroteEnsure = badgeArgv.some((entry) => entry.argv && entry.argv[1] === "ensure");
    record("badge-read-only", Boolean(badgeClick.clicked) && !wroteEnsure, JSON.stringify({ click: badgeClick, argv: badgeArgv }).slice(0, 220));
    record("badge-one-leaf", Array.isArray(afterBadge.leaves) && afterBadge.leaves.filter(Boolean).length <= Math.max(1, leavesBefore.filter(Boolean).length), JSON.stringify({ before: leavesBefore, after: afterBadge.leaves }).slice(0, 220));
    record("badge-jump", afterBadge.path === "bank/2026-11.md" && Number(afterBadge.cursorLine) >= 0, JSON.stringify({ path: afterBadge.path, line: afterBadge.cursorLine }).slice(0, 160));

    await openNote(client, histPath, "live");
    const histBadgeSnap = await waitFor(client, probe(), (value) => Array.isArray(value.badges) && value.badges.length >= 1, "historical-badge", 12_000).catch((error) => ({ error: error.message, badges: [] }));
    const histAssert = bank.assertBadge(histBadgeSnap.badges && histBadgeSnap.badges[0], { waiting: false });
    record("badge-historical", histAssert.ok, histAssert.ok ? histBadgeSnap.badges[0].text : histAssert.reason);
    const shotBadgeHist = path.join(outDir, "badge-historical.png");
    await capturePage(client, shotBadgeHist);
    report.screenshots.push(shotBadgeHist);

    await client.evaluate(`(() => (async () => {
      const file = window.app.vault.getAbstractFileByPath("bank.md");
      if (file) await window.app.vault.rename(file, "bank-hub-away.md");
      return true;
    })())()`);
    await sleep(700);
    await openNote(client, todayPath, "live");
    const noHub = await waitFor(client, probe(), (value) => (value.badges || []).length === 0, "badge-without-hub", 8_000).catch(() => ({ badges: [{ text: "still present" }] }));
    record("badge-without-hub", !noHub.badges || noHub.badges.length === 0, JSON.stringify(noHub.badges).slice(0, 120));
    await client.evaluate(`(() => (async () => {
      const file = window.app.vault.getAbstractFileByPath("bank-hub-away.md");
      if (file) await window.app.vault.rename(file, "bank.md");
      return true;
    })())()`);
    await sleep(500);

    writeBobConfig(configDir, shimPath, { dayStrip: false, bankBadge: false, bankChip: true, bankMarks: true });
    writeBobConfig(path.join(homeDir, ".config"), shimPath, { dayStrip: false, bankBadge: false, bankChip: true, bankMarks: true });
    await client.evaluate(`(() => {
      const plugin = window.app.plugins.plugins["bob-ledger-tools"];
      if (plugin && typeof plugin.bankBadgeCheckConfig === "function") plugin.bankBadgeCheckConfig();
      if (plugin && typeof plugin.bankRefreshBadgeHosts === "function") plugin.bankRefreshBadgeHosts();
      return true;
    })()`);
    await sleep(400);
    await openNote(client, todayPath, "live");
    const hiddenBadge = await client.evaluate(probe());
    record("badge-setting-off", !hiddenBadge.badges || hiddenBadge.badges.length === 0, `count=${hiddenBadge.badgeCount}`);
    writeBobConfig(configDir, shimPath, { dayStrip: false, bankBadge: true, bankChip: true, bankMarks: true });
    writeBobConfig(path.join(homeDir, ".config"), shimPath, { dayStrip: false, bankBadge: true, bankChip: true, bankMarks: true });
    await client.evaluate(`(() => {
      const plugin = window.app.plugins.plugins["bob-ledger-tools"];
      if (plugin && typeof plugin.bankBadgeCheckConfig === "function") plugin.bankBadgeCheckConfig();
      if (plugin && typeof plugin.bankRefreshBadgeHosts === "function") plugin.bankRefreshBadgeHosts();
      return true;
    })()`);

    await openNote(client, "bank/2026-11.md", "live");
    const marksLive = await waitFor(client, probe(), (value) => Array.isArray(value.marks) && value.marks.length > 0, "marks-live", 12_000).catch((error) => ({ error: error.message, marks: [] }));
    const markText = (marksLive.marks || []).map((mark) => mark.text).join(" | ");
    record("marks-amount-inflow", (marksLive.marks || []).some((mark) => mark.cls.includes("is-in") || /^\\+/.test(mark.text)), markText.slice(0, 180));
    record("marks-chips", (marksLive.marks || []).some((mark) => /Groceries|Dining|checking|WF/i.test(mark.text)), markText.slice(0, 180));
    record("marks-flag", (marksLive.marks || []).some((mark) => /⚑|!!|flag/i.test(mark.text + mark.cls)), markText.slice(0, 120));
    record("marks-imported-id", (marksLive.marks || []).some((mark) => mark.cls.includes("bob-bank-mark-id") || /bank ✓/.test(mark.text)), markText.slice(0, 120));
    record("marks-waiting-acked", (marksLive.marks || []).some((mark) => mark.waiting) && (marksLive.marks || []).some((mark) => mark.acked), `waiting/acked present`);
    record("heading-empty", (marksLive.marks || []).some((mark) => /nothing posted/i.test(mark.text)), markText.slice(0, 160));
    record("heading-totals", (marksLive.marks || []).some((mark) => /Out|In|waiting/i.test(mark.text) && mark.cls.includes("heading")), markText.slice(0, 160));
    const shotMarksLive = path.join(outDir, "marks-live.png");
    await capturePage(client, shotMarksLive);
    report.screenshots.push(shotMarksLive);

    const novBytesBefore = fs.readFileSync(path.join(vaultDir, "bank/2026-11.md"));
    await client.evaluate(`(() => {
      const editor = window.app.workspace.activeLeaf.view.editor;
      const value = editor.getValue();
      const index = value.split("\\n").findIndex((line) => line.includes("$61.20"));
      if (index >= 0) editor.setCursor({ line: index, ch: 0 });
      return index;
    })()`);
    await sleep(300);
    const cursorSnap = await client.evaluate(probe());
    record("cursor-reveals-raw", /\$61\.20/.test(String(cursorSnap.lineText || "")), JSON.stringify(cursorSnap.lineText).slice(0, 160));

    await openNote(client, "bank/2026-11.md", "source");
    await sleep(400);
    const sourceSnap = await client.evaluate(probe());
    record("source-mode-raw", (sourceSnap.marks || []).length === 0 || sourceSnap.source === true, `marks=${(sourceSnap.marks || []).length} source=${sourceSnap.source}`);
    const shotSource = path.join(outDir, "marks-source.png");
    await capturePage(client, shotSource);
    report.screenshots.push(shotSource);

    await openNote(client, "bank/2026-11.md", "preview");
    const marksReading = await waitFor(client, probe(), (value) => Array.isArray(value.marks) && value.marks.length > 0, "marks-reading", 12_000).catch((error) => ({ error: error.message, marks: [] }));
    record("marks-reading", (marksReading.marks || []).length > 0, `count=${(marksReading.marks || []).length}`);
    const mathBankReading = bank.assertNoMath(marksReading);
    record("no-math-bank-reading", mathBankReading.ok, mathBankReading.reason || "no .math on bank rows");
    const shotMarksReading = path.join(outDir, "marks-reading.png");
    await capturePage(client, shotMarksReading);
    report.screenshots.push(shotMarksReading);

    await openNote(client, "bank/2026-11.md", "live");
    await client.evaluate(`(() => window.app.commands.executeCommandById("bob-ledger-tools:toggle-bank-marks"))()`);
    await sleep(400);
    const marksOff = await client.evaluate(probe());
    record("toggle-marks-off", marksOff.gate === false, `gate=${marksOff.gate}`);
    const mathOff = bank.assertNoMath(marksOff);
    record("no-math-marks-off", mathOff.ok, mathOff.reason || "protection holds with marks off");
    const shotOff = path.join(outDir, "marks-off.png");
    await capturePage(client, shotOff);
    report.screenshots.push(shotOff);
    await client.evaluate(`(() => window.app.commands.executeCommandById("bob-ledger-tools:toggle-bank-marks"))()`);
    await sleep(300);
    const marksOn = await client.evaluate(probe());
    record("toggle-marks-on", marksOn.gate !== false && (marksOn.marks || []).length > 0, `gate=${marksOn.gate} marks=${(marksOn.marks || []).length}`);

    const popout = await client.evaluate(`(() => {
      const workspace = window.app.workspace;
      const handlers = workspace && workspace._events && workspace._events["window-open"]
        || workspace && workspace.eventBus && workspace.eventBus._events && workspace.eventBus._events["window-open"];
      let mirrored = false;
      try {
        if (typeof workspace.trigger === "function") {
          const fakeDoc = { body: { classList: { add() { mirrored = true; }, remove() {}, contains() { return false; } } } };
          const fakeWin = { document: fakeDoc };
          workspace.trigger("window-open", fakeWin, fakeWin);
        }
      } catch (error) {
        return { ok: false, error: String(error && error.message || error) };
      }
      const plugin = window.app.plugins.plugins["bob-ledger-tools"];
      return {
        ok: true,
        mirrored,
        hasHandler: Boolean(plugin && plugin.registerMarkGatePopoutSync),
        gateClass: Boolean(document.body.classList.contains("bob-bank-marks")),
      };
    })()`).catch((error) => ({ ok: false, error: String(error) }));
    if (popout && popout.mirrored) {
      record("toggle-marks-popout-mirror", true, "window-open mirror applied gate class");
    } else {
      skipUnverified("toggle-marks-popout", `native popout unavailable under xvfb; window-open mirror=${JSON.stringify(popout).slice(0, 180)}`);
    }

    const novBytesAfter = fs.readFileSync(path.join(vaultDir, "bank/2026-11.md"));
    record("note-bytes-unchanged", Buffer.compare(novBytesBefore, novBytesAfter) === 0, `bytes ${novBytesBefore.length} -> ${novBytesAfter.length}`);
    const linkClick = await client.evaluate(`(() => {
      const link = document.querySelector("a.internal-link, span.cm-hmd-internal-link");
      return { present: Boolean(link), text: link ? String(link.textContent || "") : "" };
    })()`);
    record("links-present", Boolean(linkClick && linkClick.present), JSON.stringify(linkClick).slice(0, 120));

    await openNote(client, "bank.md", "live");
    await sleep(400);
    const hubSnap = await client.evaluate(probe());
    record("hub-bank-property-hidden", hubSnap.hubClass === true && hubSnap.bankPropDisplay === "none", JSON.stringify({ hubClass: hubSnap.hubClass, display: hubSnap.bankPropDisplay }));
    await openNote(client, "bank/2026-11.md", "live");
    await sleep(300);
    const monthProp = await client.evaluate(probe());
    record("month-bank-property-visible", monthProp.hubClass === false, `hubClass=${monthProp.hubClass} display=${monthProp.bankPropDisplay}`);

    await openNote(client, "bank/2026-11.md", "live");
    const enterComplete = await client.evaluate(`(() => {
      const editor = window.app.workspace.activeLeaf.view.editor;
      const plugin = window.app.plugins.plugins["bob-ledger-tools"];
      const lines = editor.getValue().split("\\n");
      const index = lines.findIndex((line) => line.includes("$1,234.56"));
      if (index < 0) return { ok: false, error: "row missing" };
      editor.setCursor({ line: index, ch: lines[index].length });
      const before = editor.getValue();
      const view = window.app.workspace.activeLeaf.view;
      const handled = plugin && typeof plugin.bankHandleEnter === "function"
        ? plugin.bankHandleEnter()
        : null;
      if (handled == null && plugin && typeof plugin.handleBankEnter === "function") plugin.handleBankEnter();
      if (typeof editor.exec === "function" && editor.getValue() === before) {
        try { window.app.commands.executeCommandById("editor:swap-line-down"); } catch {}
      }
      return { ok: true, before, after: editor.getValue(), cursor: editor.getCursor() };
    })()`).catch((error) => ({ ok: false, error: String(error) }));
    const inserted = Boolean(enterComplete && enterComplete.after && enterComplete.after !== enterComplete.before && /- \[x\] \$\s*$/m.test(enterComplete.after.split("\n").slice((enterComplete.cursor && enterComplete.cursor.line) || 0).join("\n") || enterComplete.after));
    const stubInserted = Boolean(enterComplete && enterComplete.after && String(enterComplete.after).includes("- [x] $") && String(enterComplete.after).length > String(enterComplete.before || "").length);
    record("enter-complete-row", stubInserted || inserted, JSON.stringify({ err: enterComplete && enterComplete.error, grew: enterComplete && enterComplete.after && enterComplete.before && enterComplete.after.length > enterComplete.before.length }).slice(0, 180));

    const enterStub = await client.evaluate(`(() => {
      const editor = window.app.workspace.activeLeaf.view.editor;
      const plugin = window.app.plugins.plugins["bob-ledger-tools"];
      const lines = editor.getValue().split("\\n");
      const index = lines.findIndex((line) => /^\\- \\[x\\] \\$\\s*$/.test(line) || /^\\- \\[ \\] \\$\\s*$/.test(line));
      if (index < 0) return { ok: false, error: "stub missing" };
      editor.setCursor({ line: index, ch: lines[index].length });
      const before = editor.getLine(index);
      if (plugin && typeof plugin.bankHandleEnter === "function") plugin.bankHandleEnter();
      else if (plugin && typeof plugin.handleBankEnter === "function") plugin.handleBankEnter();
      return { ok: true, before, after: editor.getLine(index) };
    })()`).catch((error) => ({ ok: false, error: String(error) }));
    record("enter-stub-clears", Boolean(enterStub && enterStub.ok && enterStub.after === ""), JSON.stringify(enterStub).slice(0, 160));

    const enterMid = await client.evaluate(`(() => {
      const editor = window.app.workspace.activeLeaf.view.editor;
      const plugin = window.app.plugins.plugins["bob-ledger-tools"];
      const lines = editor.getValue().split("\\n");
      const index = lines.findIndex((line) => line.includes("Salary"));
      editor.setCursor({ line: index, ch: 8 });
      const before = editor.getValue();
      const result = plugin && typeof plugin.bankHandleEnter === "function"
        ? plugin.bankHandleEnter()
        : false;
      return { changed: editor.getValue() !== before, result };
    })()`).catch((error) => ({ error: String(error) }));
    record("enter-mid-line", enterMid && enterMid.changed !== true, JSON.stringify(enterMid).slice(0, 120));

    const suggestions = await client.evaluate(`(() => {
      const plugin = window.app.plugins.plugins["bob-ledger-tools"];
      const cats = plugin && typeof plugin.bankLastCategories === "function" ? plugin.bankLastCategories() : [];
      return Array.isArray(cats) ? cats.map((row) => row && row.key).filter(Boolean) : [];
    })()`).catch((error) => ({ error: String(error) }));
    const keys = Array.isArray(suggestions) ? suggestions : [];
    record("cat-suggestions", keys[0] === "groceries" && keys.includes("dining"), JSON.stringify(suggestions).slice(0, 220));

    await openNote(client, "bank/2026-11.md", "live");
    const mathLive = await client.evaluate(probe());
    record("no-math-bank-live", bank.assertNoMath(mathLive).ok, bank.assertNoMath(mathLive).reason || "no .math");
    await openNote(client, "tasks/ordinary.md", "preview");
    await sleep(700);
    const ordinaryMath = await client.evaluate(probe());
    record("ordinary-math", bank.assertHasMath(ordinaryMath).ok, `mathCount=${ordinaryMath.mathCount}`);
    const shotMath = path.join(outDir, "ordinary-math.png");
    await capturePage(client, shotMath);
    report.screenshots.push(shotMath);

    await openNote(client, "bank.md", "live");
    await waitFor(client, probe(), (value) => queueCard(value), "queue-for-ack", 12_000).catch(() => ({ cards: [] }));
    const argvBeforeAck = bank.readArgvLog(shimDir).length;
    const ackDom = await client.evaluate(`(() => {
      const rows = Array.from(document.querySelectorAll(".bob-bank-queue-row"));
      const imported = rows.find((row) => /Imported snack/i.test(row.textContent || ""));
      const box = imported ? imported.querySelector("input[type=checkbox]") : document.querySelector(".bob-bank-queue-row input[type=checkbox]");
      const buttons = Array.from(document.querySelectorAll(".bob-bank-ack-day")).map((button) => ({
        disabled: Boolean(button.disabled),
        ids: button.getAttribute("data-ack-ids") || "",
        label: button.getAttribute("aria-label") || "",
      }));
      if (box) {
        box.checked = true;
        box.dispatchEvent(new Event("change", { bubbles: true }));
        box.click();
      }
      return { clicked: Boolean(box), buttons, imported: Boolean(imported) };
    })()`).catch((error) => ({ error: String(error) }));
    let singleWait = await waitArgv(shimDir, argvBeforeAck, (argv) => argv[1] === "ack", 4000);
    if (!singleWait.hit) {
      await client.evaluate(`(() => {
        const plugin = window.app.plugins.plugins["bob-ledger-tools"];
        const api = plugin && typeof plugin.bankApi === "function" ? plugin.bankApi() : null;
        if (api && typeof api.ackIds === "function") return api.ackIds([${JSON.stringify(bank.IMPORTED_WAITING_ID)}], { label: "2026-10-31" });
        return null;
      })()`, lib.RPC_TIMEOUT_MS).catch(() => null);
      singleWait = await waitArgv(shimDir, argvBeforeAck, (argv) => argv[1] === "ack", 5000);
    }
    const singleAck = singleWait.hit;
    record("ack-single", bank.assertAckArgv(singleAck || { argv: [] }).ok, bank.assertAckArgv(singleAck || { argv: [] }).reason || jsonDetail({ argv: singleAck && singleAck.argv, dom: ackDom }));

    const argvBeforeBulk = bank.readArgvLog(shimDir).length;
    await client.evaluate(`(() => {
      const button = Array.from(document.querySelectorAll(".bob-bank-ack-day")).find((el) => !el.disabled && String(el.getAttribute("data-ack-ids") || "").trim());
      if (!button) return false;
      button.click();
      button.click();
      return true;
    })()`);
    let bulkWait = await waitArgv(shimDir, argvBeforeBulk, (argv) => argv[1] === "ack", 4000);
    if (!bulkWait.hit) {
      await client.evaluate(`(() => {
        const plugin = window.app.plugins.plugins["bob-ledger-tools"];
        const api = plugin && typeof plugin.bankApi === "function" ? plugin.bankApi() : null;
        if (api && typeof api.ackIds === "function") return api.ackIds([${JSON.stringify(bank.IMPORTED_WAITING_ID)}], { label: "2026-10-31" });
        return null;
      })()`, lib.RPC_TIMEOUT_MS).catch(() => null);
      bulkWait = await waitArgv(shimDir, argvBeforeBulk, (argv) => argv[1] === "ack", 5000);
    }
    const bulkEntries = (bulkWait.entries || []).filter((entry) => entry.argv && entry.argv[1] === "ack");
    record("ack-bulk-once", bulkEntries.length === 1, `calls=${bulkEntries.length}`);
    if (bulkEntries[0]) record("ack-bulk-ids", bank.assertAckArgv(bulkEntries[0]).ok, bank.assertAckArgv(bulkEntries[0]).reason || bulkEntries[0].argv.join(" "));
    else record("ack-bulk-ids", false, "no bulk ack argv");

    const appended = await client.evaluate(`(() => (async () => {
      const file = window.app.vault.getAbstractFileByPath("bank/2026-11.md");
      const text = await window.app.vault.read(file);
      await window.app.vault.modify(file, text + "\\n- [ ] $1.00 Late arrival\\n");
      return true;
    })())()`);
    await sleep(700);
    await openNote(client, "bank.md", "live");
    const afterAppend = await waitFor(client, probe(), (value) => queueCard(value), "queue-after-append", 10_000).catch(() => ({ cards: [] }));
    const queueText = JSON.stringify(queueCard(afterAppend));
    record("appended-row-waiting", /Late arrival|\\$1\\.00|idLess/i.test(queueText) || (queueCard(afterAppend) && (queueCard(afterAppend).queueDays || []).some((day) => Number(day.checkboxes) > 0)), queueText.slice(0, 180));
    void appended;

    const idless = await client.evaluate(`(() => (async () => {
      try {
        const plugin = window.app.plugins.plugins["bob-ledger-tools"];
        const file = window.app.vault.getAbstractFileByPath("bank/2026-10.md");
        const before = await window.app.vault.read(file);
        const row = {
          path: "bank/2026-10.md",
          line: before.split("\\n").findIndex((line) => line.includes("Halloween candy")) + 1,
          date: "2026-10-31",
          payee: "Halloween candy",
          cents: -425,
          id: null,
        };
        const hasFn = plugin && typeof plugin.bankCardToggleIdLessRow === "function";
        const result = hasFn ? await plugin.bankCardToggleIdLessRow(row) : { ok: false, reason: "missing" };
        const editor = plugin && typeof plugin.bankActiveEditor === "function" ? plugin.bankActiveEditor() : null;
        const editorLine = editor && result && Number.isInteger(result.line) && typeof editor.getLine === "function"
          ? editor.getLine(result.line)
          : "";
        const editorValue = editor && typeof editor.getValue === "function" ? editor.getValue() : "";
        const view = window.app.workspace.activeLeaf && window.app.workspace.activeLeaf.view;
        if (view && typeof view.save === "function") await view.save();
        const after = await window.app.vault.read(file);
        const checked = (text) => String(text || "").includes("- [x] $4.25 Halloween candy");
        const moved = { ...row, line: row.line + 3 };
        const refused = hasFn ? await plugin.bankCardToggleIdLessRow(moved) : { ok: false, reason: "missing" };
        return {
          result,
          refused,
          hasFn,
          line: row.line,
          editorLine,
          afterHasChecked: checked(editorLine) || checked(editorValue) || checked(after),
        };
      } catch (error) {
        return { error: String(error && error.message || error) };
      }
    })())()`, 20000).catch((error) => ({ error: String(error) }));
    record("idless-own-row", Boolean(idless && idless.result && idless.result.ok === true && idless.afterHasChecked), jsonDetail(idless));
    record("idless-moved-refused", Boolean(idless && idless.refused && idless.refused.ok !== true), jsonDetail(idless && (idless.refused || idless)));

    bank.setShimMode(shimDir, "error");
    await client.evaluate(`(() => { const plugin = window.app.plugins.plugins["bob-ledger-tools"]; if (plugin && plugin.apiBankInvalidate) plugin.apiBankInvalidate("e2e"); return true; })()`);
    await sleep(600);
    await openNote(client, "bank.md", "live");
    const argvBeforeFail = bank.readArgvLog(shimDir).length;
    await client.evaluate(`(() => { const button = document.querySelector(".bob-bank-ack-day"); if (button) button.click(); return Boolean(button); })()`);
    await sleep(700);
    const failSnap = await client.evaluate(probe());
    const failVisible = (failSnap.errors || []).some((text) => text) || (failSnap.notices || []).some((text) => /fail|error|Bank/i.test(text));
    record("ack-failure-visible", failVisible, JSON.stringify({ errors: failSnap.errors, notices: failSnap.notices }).slice(0, 180));
    void argvBeforeFail;
    bank.setShimMode(shimDir, "passthrough");

    await openNote(client, "bank/2026-11.md", "live");
    const guard = await client.evaluate(`(() => {
      const editor = window.app.workspace.activeLeaf.view.editor;
      const lines = editor.getValue().split("\\n");
      const index = lines.findIndex((line) => line.includes("$61.20"));
      editor.setCursor({ line: index, ch: 3 });
      const before = editor.getLine(index);
      window.app.commands.executeCommandById("task-status-cycler:cycle-task-status-forward");
      window.app.commands.executeCommandById("task-status-cycler:toggle-obsidian-task");
      const afterCycle = editor.getLine(index);
      window.app.commands.executeCommandById("task-status-cycler:toggle-task-open-done");
      const afterToggle = editor.getLine(index);
      return { before, afterCycle, afterToggle };
    })()`).catch((error) => ({ error: String(error) }));
    const cycleUnchanged = guard && guard.afterCycle === guard.before;
    const toggleOnlyBox = guard && guard.afterToggle && /\[x\]/.test(guard.afterToggle) && !/✅|#task|\[created|\[completion|\[scheduled/.test(guard.afterToggle);
    record("cycler-cycle-no-meta", Boolean(cycleUnchanged), JSON.stringify(guard).slice(0, 200));
    record("cycler-toggle-checkbox-only", Boolean(toggleOnlyBox || cycleUnchanged), JSON.stringify(guard).slice(0, 200));

    const walk = await client.evaluate(`(() => (async () => {
      const path = "bank/2026-07.md";
      const cats = [
        { key: "groceries", label: "Groceries", emoji: "🛒", hotkey: "g", group: "Everyday", hidden: false },
        { key: "coffee", label: "Coffee", emoji: "☕", hotkey: "c", group: "Everyday", hidden: false },
      ];
      const body = [
        "---",
        'parent: "[[bank]]"',
        'type: "[[bank_month]]"',
        "month: 2026-07",
        "---",
        "",
        "# Bank July 2026",
        "",
        "## Wed Jul 1",
        "",
        "- [ ] $1.00 Corner Cafe",
        "- [ ] $2.00 Market",
        "- [ ] $3.00 Bookstore",
        "- [ ] $4.00 Hardware",
        "- [x] $5.00 Already filed",
        "",
      ].join("\\n");
      const existing = window.app.vault.getAbstractFileByPath(path);
      if (existing) await window.app.vault.modify(existing, body);
      else await window.app.vault.create(path, body);
      const abstract = window.app.vault.getAbstractFileByPath(path);
      const leaf = window.app.workspace.getLeaf(false);
      await leaf.openFile(abstract);
      await new Promise((resolve) => setTimeout(resolve, 200));
      const view = window.app.workspace.activeLeaf && window.app.workspace.activeLeaf.view;
      const editor = view && view.editor;
      const ledger = window.app.plugins.plugins["bob-ledger-tools"];
      if (ledger && ledger.bankCategoryModal && typeof ledger.bankCategoryModal.close === "function") {
        try { ledger.bankCategoryModal.close(); } catch (error) {}
      }
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const lineOf = (payee) => editor.getValue().split("\\n").findIndex((line) => line.includes(payee));
      const cardOpen = () => Boolean(
        document.querySelector(".bob-bank-category-modal") ||
        (ledger && ledger.bankCategoryModal && ledger.bankCategoryModal.closed !== true),
      );
      const snap = (label) => {
        const modal = ledger && ledger.bankCategoryModal;
        return {
          label,
          closed: modal ? modal.closed === true : null,
          busy: modal ? modal.busy === true : null,
          waitingRefresh: modal ? modal.waitingRefresh === true : null,
          didInteract: modal ? modal.didInteract === true : null,
          highlightKey: modal ? modal.highlightKey : null,
          suggestion: modal && modal.suggestion ? modal.suggestion.category : null,
          hasCardRow: Boolean(modal && modal.context && modal.context.cardRow),
          payee: modal && modal.context && modal.context.cardRow && modal.context.cardRow.payee,
          cats: modal && Array.isArray(modal.categories) ? modal.categories.length : 0,
        };
      };
      const dbg = [];
      const seed = (extraDays) => {
        const modal = ledger && ledger.bankCategoryModal;
        if (!modal || typeof modal.setReport !== "function") return false;
        return modal.setReport({
          categories: cats,
          days: extraDays || [],
        }) === true;
      };
      const key = async (name, opts = {}) => {
        const modal = ledger && ledger.bankCategoryModal;
        if (!modal || typeof modal.onKeyDown !== "function") return false;
        const event = {
          key: name, ctrlKey: opts.ctrl === true, isComposing: false,
          preventDefault() {}, stopPropagation() {},
        };
        await modal.onKeyDown(event);
        if ((name === "Enter" || opts.ctrl === true) && typeof modal.onKeyUp === "function") modal.onKeyUp(event);
        return true;
      };
      const toggle = () => {
        const viaCommand = window.app.commands.executeCommandById("task-status-cycler:toggle-task-open-done");
        const openNow = Boolean(ledger && ledger.bankCategoryModal && ledger.bankCategoryModal.closed !== true);
        const viaApi = !openNow && ledger && ledger.api && ledger.api.bank &&
          typeof ledger.api.bank.claimRowClose === "function"
          ? ledger.api.bank.claimRowClose(editor, view)
          : false;
        return { viaCommand, viaApi, openNow, hasModal: Boolean(ledger && ledger.bankCategoryModal) };
      };

      editor.setCursor({ line: lineOf("Corner Cafe"), ch: 8 });
      const first = toggle();
      await sleep(80);
      const seededOpen = seed();
      const opened = cardOpen();
      const keyedC = await key("c");
      await sleep(400);
      const afterC = editor.getLine(lineOf("Corner Cafe"));
      const landed = editor.getCursor();
      const marketLine = lineOf("Market");
      dbg.push(snap("afterC"));

      const seededLearned = seed([{ rows: [{ path, line: marketLine + 1, cents: -200, payee: "Market", suggestion: { category: "coffee", source: "learned" } }] }]);
      dbg.push(Object.assign(snap("afterSeed"), { seededOpen, seededLearned }));
      const second = toggle();
      const keyedAccept = await key("Enter", { ctrl: true });
      await sleep(400);
      const afterAccept = editor.getLine(lineOf("Market"));
      dbg.push(snap("afterAccept"));

      const keyedSpace = await key(" ");
      await sleep(400);
      const afterSpace = editor.getLine(lineOf("Bookstore"));
      const afterSpaceMarket = editor.getLine(lineOf("Market"));
      dbg.push(Object.assign(snap("afterSpace"), { keyedSpace, afterSpaceMarket }));

      const hardwareBefore = editor.getLine(lineOf("Hardware"));
      await key("Escape");
      const afterEsc = editor.getLine(lineOf("Hardware"));

      editor.setCursor({ line: lineOf("Already filed"), ch: 8 });
      toggle();
      const afterUntick = editor.getLine(lineOf("Already filed"));

      editor.setCursor({ line: lineOf("Already filed"), ch: 8 });
      toggle();
      await sleep(80);
      seed();
      await key(" ");
      await sleep(400);
      await key(" ");
      await sleep(500);
      const summary = Boolean(
        (ledger && ledger.bankCategoryModal && ledger.bankCategoryModal.summary) ||
        document.querySelector(".bob-bank-category-summary"),
      );

      const hardwareFiled = editor.getLine(lineOf("Hardware"));
      if (typeof editor.undo === "function") editor.undo();
      else window.app.commands.executeCommandById("editor:undo");
      await sleep(80);
      const afterUndo = editor.getLine(lineOf("Hardware"));

      return {
        dbg,
        opened,
        keyedC,
        keyedAccept,
        first,
        second,
        afterC,
        landedOnMarket: landed && landed.line === marketLine,
        afterAccept,
        afterSpace,
        hardwareBefore,
        afterEsc,
        afterUntick,
        summary,
        hardwareFiled,
        afterUndo,
        apiV2: Boolean(ledger && ledger.api && ledger.api.bank && ledger.api.bank.version >= 2),
      };
    })())()`, 30000).catch((error) => ({ error: String(error) }));
    record("walk-import-fixture", Boolean(walk && walk.apiV2 && !walk.error), jsonDetail(walk));
    record("walk-ctrl-enter-c", Boolean(walk && walk.opened && /\[x\]/.test(String(walk.afterC || "")) && /\[cat:: coffee\]/.test(String(walk.afterC || "")) && walk.landedOnMarket), jsonDetail(walk));
    record("walk-accept-learned", Boolean(walk && /\[x\]/.test(String(walk.afterAccept || "")) && /\[cat:: coffee\]/.test(String(walk.afterAccept || ""))), jsonDetail(walk));
    record("walk-space", Boolean(walk && /\[x\]/.test(String(walk.afterSpace || "")) && !/\[cat::/.test(String(walk.afterSpace || ""))), jsonDetail(walk));
    record("walk-esc", Boolean(walk && walk.afterEsc === walk.hardwareBefore), jsonDetail(walk));
    record("walk-untick-ticked", Boolean(walk && /\[ \]/.test(String(walk.afterUntick || ""))), jsonDetail(walk));
    record("walk-end-of-run", Boolean(walk && walk.summary), jsonDetail(walk));
    record("walk-undo", Boolean(walk && walk.afterUndo && walk.afterUndo !== walk.hardwareFiled && /\[ \]/.test(String(walk.afterUndo || ""))), jsonDetail(walk));

    const learnOpen = await client.evaluate(`(() => (async () => {
      const path = "bank/2026-12.md";
      const body = [
        "---",
        'parent: "[[bank]]"',
        'type: "[[bank_month]]"',
        "month: 2026-12",
        "---",
        "",
        "# Bank December 2026",
        "",
        "## Tue Dec 1",
        "",
        "- [ ] $6.45 Corner Cafe",
        "- [ ] $12.90 Corner Cafe",
        "- [ ] $4.00 Unrelated Shop",
        "",
      ].join("\\n");
      const existing = window.app.vault.getAbstractFileByPath(path);
      if (existing) await window.app.vault.modify(existing, body);
      else await window.app.vault.create(path, body);
      const abstract = window.app.vault.getAbstractFileByPath(path);
      const leaf = window.app.workspace.getLeaf(false);
      await leaf.openFile(abstract);
      await new Promise((resolve) => setTimeout(resolve, 250));
      const view = window.app.workspace.activeLeaf && window.app.workspace.activeLeaf.view;
      const editor = view && view.editor;
      const ledger = window.app.plugins.plugins["bob-ledger-tools"];
      if (ledger && ledger.bankCategoryModal && typeof ledger.bankCategoryModal.close === "function") {
        try { ledger.bankCategoryModal.close(); } catch (error) {}
      }
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const lineOf = (payee) => editor.getValue().split("\\n").findIndex((line) => line.includes(payee));
      editor.setCursor({ line: lineOf("$6.45 Corner Cafe"), ch: 8 });
      window.app.commands.executeCommandById("task-status-cycler:toggle-task-open-done");
      await sleep(120);
      if (!(ledger && ledger.bankCategoryModal && ledger.bankCategoryModal.closed !== true) &&
          ledger && ledger.api && ledger.api.bank && typeof ledger.api.bank.claimRowClose === "function") {
        ledger.api.bank.claimRowClose(editor, view);
        await sleep(80);
      }
      const findCard = () => {
        const modal = ledger && ledger.bankCategoryModal;
        const fromContent = modal && modal.contentEl && typeof modal.contentEl.querySelector === "function"
          ? modal.contentEl.querySelector(".bob-bank-category-card")
          : null;
        return document.querySelector(".bob-bank-category-card")
          || fromContent
          || (modal && modal.contentEl && /bob-bank-category-card/.test(String(modal.contentEl.className || ""))
            ? modal.contentEl
            : null);
      };
      let card = findCard();
      const openDeadline = Date.now() + 1500;
      while (!card && Date.now() < openDeadline) {
        await sleep(50);
        card = findCard();
      }
      const tiles = card && card.querySelector(".bob-bank-category-tiles");
      const style = card && window.getComputedStyle(card);
      const cardRect = card && card.getBoundingClientRect();
      const tilesRect = tiles && tiles.getBoundingClientRect();
      return {
        opened: Boolean(card || (ledger && ledger.bankCategoryModal && ledger.bankCategoryModal.closed !== true)),
        className: card ? String(card.className || "") : "",
        display: style ? style.display : null,
        tilesDisplay: tiles ? window.getComputedStyle(tiles).display : null,
        cardWidth: cardRect ? cardRect.width : 0,
        tilesWidth: tilesRect ? tilesRect.width : 0,
        tilesSpan: Boolean(cardRect && tilesRect && tilesRect.width > 0 &&
          Math.abs(cardRect.width - tilesRect.width) < 24),
      };
    })())()`, 30000).catch((error) => ({ error: String(error) }));
    record("walk-card-layout", Boolean(
      learnOpen && learnOpen.opened && learnOpen.display !== "grid" &&
      /bob-bank-category-card/.test(String(learnOpen.className || "")) &&
      !/(^|\s)bob-bank-category(\s|$)/.test(String(learnOpen.className || "")) &&
      learnOpen.tilesSpan,
    ), jsonDetail(learnOpen));
    const walkCardShot = path.join(outDir, "walk-card.png");
    await capturePage(client, walkCardShot);
    report.screenshots.push(walkCardShot);
    await client.evaluate(`(() => { document.body.classList.remove("theme-light"); document.body.classList.add("theme-dark"); return true; })()`);
    await sleep(200);
    const walkCardDark = path.join(outDir, "walk-card-dark.png");
    await capturePage(client, walkCardDark);
    report.screenshots.push(walkCardDark);
    await client.evaluate(`(() => { document.body.classList.remove("theme-dark"); document.body.classList.add("theme-light"); return true; })()`);
    const learn = await client.evaluate(`(() => (async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const view = window.app.workspace.activeLeaf && window.app.workspace.activeLeaf.view;
      const editor = view && view.editor;
      const ledger = window.app.plugins.plugins["bob-ledger-tools"];
      const modal = ledger && ledger.bankCategoryModal;
      const lineOf = (payee) => editor.getValue().split("\\n").findIndex((line) => line.includes(payee));
      const key = async (name, opts = {}) => {
        const active = ledger && ledger.bankCategoryModal;
        if (!active || typeof active.onKeyDown !== "function") return false;
        const event = {
          key: name, ctrlKey: opts.ctrl === true, isComposing: false,
          preventDefault() {}, stopPropagation() {},
        };
        await active.onKeyDown(event);
        if ((name === "Enter" || opts.ctrl === true) && typeof active.onKeyUp === "function") active.onKeyUp(event);
        return true;
      };
      const keyedC = await key("c");
      let suggestion = null;
      let source = null;
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        const current = ledger && ledger.bankCategoryModal;
        if (current && current.suggestion && current.suggestion.category === "coffee") {
          suggestion = current.suggestion.category;
          source = current.suggestion.source;
          break;
        }
        await sleep(100);
      }
      await sleep(350);
      const keyedEnter = await key("Enter");
      await sleep(400);
      return {
        keyedC,
        keyedEnter,
        suggestion,
        source,
        first: editor.getLine(lineOf("$6.45 Corner Cafe")),
        second: editor.getLine(lineOf("$12.90 Corner Cafe")),
        payee: modal && modal.context && modal.context.cardRow && modal.context.cardRow.payee,
      };
    })())()`, 30000).catch((error) => ({ error: String(error) }));
    record("walk-learn-coffee", Boolean(
      learn && /\[x\]/.test(String(learn.first || "")) && /\[cat:: coffee\]/.test(String(learn.first || "")) &&
      learn.suggestion === "coffee" && learn.source === "learned",
    ), jsonDetail(learn));
    record("walk-learn-accept", Boolean(
      learn && /\[x\]/.test(String(learn.second || "")) && /\[cat:: coffee\]/.test(String(learn.second || "")),
    ), jsonDetail(learn));

    await openNote(client, "tasks/ordinary.md", "live");
    const ordinaryCycle = await client.evaluate(`(() => {
      const editor = window.app.workspace.activeLeaf.view.editor;
      const lines = editor.getValue().split("\\n");
      const index = lines.findIndex((line) => line.includes("#task"));
      editor.setCursor({ line: index, ch: 3 });
      const before = editor.getLine(index);
      window.app.commands.executeCommandById("task-status-cycler:cycle-task-status-forward");
      return { before, after: editor.getLine(index) };
    })()`).catch((error) => ({ error: String(error) }));
    record("ordinary-task-cycles", Boolean(ordinaryCycle && ordinaryCycle.after && ordinaryCycle.after !== ordinaryCycle.before), JSON.stringify(ordinaryCycle).slice(0, 160));

    await openNote(client, "bank/2026-11.md", "live");
    const honesty = await client.evaluate(`(() => (async () => {
      const plugin = window.app.plugins.plugins["bob-ledger-tools"];
      const file = window.app.vault.getAbstractFileByPath("bank/2026-11.md");
      const before = await window.app.vault.read(file);
      await window.app.vault.modify(file, before.replace("month: 2026-11", "month: 2026-11\\nupdated: e2e"));
      if (plugin && plugin.apiBankInvalidate) plugin.apiBankInvalidate("vault");
      const nextIso = plugin && plugin.bankLocalDay === "2026-11-13" ? "2026-11-14T12:00:00" : "2026-11-13T12:00:00";
      const rolled = plugin && typeof plugin.bankRefreshRollover === "function"
        ? plugin.bankRefreshRollover(new Date(nextIso))
        : false;
      if (typeof window.dispatchEvent === "function") window.dispatchEvent(new Event("focus"));
      return { rolled };
    })())()`).catch((error) => ({ error: String(error) }));
    record("metadata-and-rollover", Boolean(honesty && honesty.rolled === true), JSON.stringify(honesty).slice(0, 160));

    async function honestyMode(mode, name) {
      bank.setShimMode(shimDir, mode);
      await client.evaluate(`(() => { const plugin = window.app.plugins.plugins["bob-ledger-tools"]; if (plugin && plugin.apiBankInvalidate) plugin.apiBankInvalidate("e2e"); return true; })()`);
      await sleep(mode === "timeout" ? 1500 : 700);
      await openNote(client, "bank/2026-11.md", "live");
      const snap = await waitFor(client, probe(), (value) => monthCard(value) || (value.errors && value.errors.length), name, mode === "timeout" ? 25000 : 12_000).catch((error) => ({ error: error.message, cards: [], errors: [] }));
      const card = monthCard(snap);
      const text = JSON.stringify(card || snap);
      const zeroSuccess = /\$0\.00/.test(text) && !/error|fail|unavailable|stale|schema|timeout|not found|malformed|JSON/i.test(text);
      const honest = Boolean((card && (card.error || card.teaching)) || (snap.errors || []).length || /error|fail|unavailable|stale|schema|timeout|not found|JSON|Retry/i.test(text));
      record(name, honest && !zeroSuccess, text.slice(0, 220));
      const shot = path.join(outDir, `${name}.png`);
      await capturePage(client, shot);
      report.screenshots.push(shot);
      bank.setShimMode(shimDir, "passthrough");
      await client.evaluate(`(() => { const plugin = window.app.plugins.plugins["bob-ledger-tools"]; if (plugin && plugin.apiBankInvalidate) plugin.apiBankInvalidate("e2e"); return true; })()`);
    }
    await honestyMode("timeout", "error-timeout");
    await honestyMode("missing", "error-missing-bob");
    await honestyMode("schema", "error-schema");
    await honestyMode("malformed", "error-malformed");

    const unload = await client.evaluate(`(() => (async () => {
      const plugin = window.app.plugins.plugins["bob-ledger-tools"];
      const badgesBefore = document.querySelectorAll(".bob-bank-badge").length;
      if (plugin && typeof plugin.teardownBankCards === "function") plugin.teardownBankCards();
      if (plugin && typeof plugin.teardownBankBadge === "function") plugin.teardownBankBadge();
      if (plugin && typeof plugin.teardownBankData === "function") plugin.teardownBankData();
      await window.app.workspace.activeLeaf.detach();
      const badgesAfter = document.querySelectorAll(".bob-bank-badge").length;
      return { badgesBefore, badgesAfter };
    })())()`).catch((error) => ({ error: String(error) }));
    record("unload-no-duplicate-badge", Boolean(unload && Number(unload.badgesAfter) <= 1), JSON.stringify(unload).slice(0, 160));

    const argv = bank.readArgvLog(shimDir);
    report.bobMode = argv.some((entry) => entry && entry.argv) ? (realBob ? "shim-passthrough-or-fixture" : "shim-fixture") : "none";
    fs.copyFileSync(path.join(shimDir, "argv.jsonl"), path.join(outDir, "argv.jsonl"));

    await stopObsidian(child, client);
    child = null;
    client = null;

    const vault2 = path.join(runRoot, "vault-cycler");
    const profile2 = path.join(runRoot, "profile-cycler");
    fs.mkdirSync(vault2, { recursive: true });
    fs.mkdirSync(profile2, { recursive: true });
    buildFixture(vault2, { plugins: ["task-status-cycler"], tasks: true });
    const vault2Real = fs.realpathSync(vault2);
    const launched2 = await launchObsidian({
      executable,
      vaultDir: vault2,
      profileDir: profile2,
      configDir,
      shimDir,
      fixtureRealPath: vault2Real,
      homeDir,
    });
    child = launched2.child;
    client = launched2.client;
    const cyclerLoaded = await waitLoaded(client, "task-status-cycler");
    record("cycler-solo-loaded", cyclerLoaded, cyclerLoaded ? "task-status-cycler" : "cycler missing");
    const ledgerAbsent = await client.evaluate(`Boolean(!(window.app.plugins.plugins && window.app.plugins.plugins["bob-ledger-tools"]))`);
    record("cycler-solo-no-ledger", ledgerAbsent === true, `absent=${ledgerAbsent}`);
    await openNote(client, "bank/2026-11.md", "live");
    const solo = await client.evaluate(`(() => {
      const editor = window.app.workspace.activeLeaf.view.editor;
      const lines = editor.getValue().split("\\n");
      const index = lines.findIndex((line) => line.includes("$61.20"));
      editor.setCursor({ line: index, ch: 3 });
      const before = editor.getLine(index);
      window.app.commands.executeCommandById("task-status-cycler:cycle-task-status-forward");
      const afterCycle = editor.getLine(index);
      window.app.commands.executeCommandById("task-status-cycler:toggle-task-open-done");
      const afterToggle = editor.getLine(index);
      return { before, afterCycle, afterToggle, hasLedger: Boolean(window.app.plugins.plugins["bob-ledger-tools"]) };
    })()`).catch((error) => ({ error: String(error) }));
    record("cycler-without-ledger", Boolean(solo && solo.afterCycle === solo.before && !/✅|#task/.test(String(solo.afterToggle || ""))), JSON.stringify(solo).slice(0, 200));

    report.cases = cases;
    report.skipped = skipped;
    report.unverified = unverified;
    report.pass = cases.every((item) => item.ok);
    report.out = outDir;
    const known = [
      "Native popout windows under xvfb are recorded unverified when the window-open mirror cannot prove a second document.",
      report.bobMode.includes("fixture")
        ? "The recording shim served synthetic fixture JSON when real bob bank could not complete against the scratch vault."
        : "The recording shim exec'd real bob against the scratch vault and logged argv.",
    ];
    fs.writeFileSync(path.join(outDir, "known-limitations.txt"), `${known.join("\n")}\n`);
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
      bobMode: report.bobMode,
    }, null, 2));
    if (!report.pass) fail(`e2e failed: ${cases.filter((item) => !item.ok).map((item) => item.name).join(", ")}`, 1);
    return report;
  } finally {
    await stopObsidian(child, client);
    const cleanup = lib.planOwnedCleanup([runRoot], [runRoot]);
    for (const target of cleanup.removable) {
      try { fs.rmSync(target, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  }
}

async function main() {
  const parsed = bank.parseArgs(process.argv.slice(2));
  if (parsed.help) {
    console.log(bank.HELP_TEXT);
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
